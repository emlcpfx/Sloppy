import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, fetchRuleset, fetchSnapshot, isValidApiBase, normalizeApiBase } from './api.ts';

test('https addresses are accepted, with trailing slashes trimmed', () => {
  assert.equal(normalizeApiBase('https://api.example.workers.dev'), 'https://api.example.workers.dev');
  assert.equal(normalizeApiBase('https://api.example.workers.dev///'), 'https://api.example.workers.dev');
  assert.equal(normalizeApiBase('  https://api.example.dev/base  '), 'https://api.example.dev/base');
});

test('plain http is refused, because it can be read and rewritten in transit', () => {
  // The consequence is not just eavesdropping: whoever is on the path also
  // controls the ruleset, and the ruleset is code that runs on every post.
  assert.throws(() => normalizeApiBase('http://api.example.dev'), ApiError);
  assert.match(
    (() => {
      try {
        normalizeApiBase('http://api.example.dev');
        return '';
      } catch (e) {
        return String((e as Error).message);
      }
    })(),
    /https/,
  );
});

test('loopback over http is the one exception, for wrangler dev', () => {
  assert.equal(normalizeApiBase('http://localhost:8787'), 'http://localhost:8787');
  assert.equal(normalizeApiBase('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  // A host that merely CONTAINS localhost is not loopback.
  assert.throws(() => normalizeApiBase('http://localhost.evil.example'), ApiError);
});

test('other schemes are refused outright', () => {
  for (const bad of ['ftp://example.dev', 'file:///etc/passwd', 'data:text/plain,x']) {
    assert.throws(() => normalizeApiBase(bad), ApiError, bad);
  }
  // javascript: is not a fetchable scheme, but it must not be stored either.
  assert.equal(isValidApiBase('javascript:alert(1)'), false);
});

test('empty and malformed addresses are refused', () => {
  assert.throws(() => normalizeApiBase(''), ApiError);
  assert.throws(() => normalizeApiBase('   '), ApiError);
  assert.throws(() => normalizeApiBase('api.example.dev'), ApiError);
});

test('isValidApiBase answers without throwing, for the options page', () => {
  assert.equal(isValidApiBase('https://api.example.dev'), true);
  assert.equal(isValidApiBase('http://api.example.dev'), false);
  assert.equal(isValidApiBase(''), false);
});

// ---------------------------------------------------------------------------
// The runtime gate, exercised through the real fetch path
// ---------------------------------------------------------------------------


function serve(body: unknown, headers: Record<string, string> = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', ...headers },
    });
  return () => {
    globalThis.fetch = original;
  };
}

test('a hostile server cannot get a catastrophic regex past the client', async () => {
  const restore = serve({
    version: 9,
    features: [
      { id: 'legit', type: 'regex', pattern: '\\bhumbled to announce\\b', weight: 2 },
      { id: 'redos', type: 'regex', pattern: '(a+)+$', weight: 9 },
      { id: 'redos2', type: 'regex', pattern: 'a*a*a*a*b', weight: 9 },
    ],
    threshold: { default: 5 },
  });

  try {
    const { ruleset, dropped } = await fetchRuleset('https://hostile.example');
    // The good rule survives; the two that would hang a tab do not.
    assert.deepEqual(ruleset.features.map((f) => f.id), ['legit']);
    assert.deepEqual(dropped.map((d) => d.id).sort(), ['redos', 'redos2']);
  } finally {
    restore();
  }
});

test('one bad rule does not discard the whole ruleset', async () => {
  // Otherwise appending a single hostile rule is a way to switch filtering off.
  const restore = serve({
    version: 1,
    features: [
      { id: 'redos', type: 'regex', pattern: '(a|aa)+$', weight: 9 },
      { id: 'metric', type: 'metric', metric: 'shortLineRatio', gte: 0.6, weight: 2 },
    ],
    threshold: { default: 5 },
  });
  try {
    const { ruleset } = await fetchRuleset('https://hostile.example');
    assert.equal(ruleset.features.length, 1);
    assert.equal(ruleset.features[0]?.id, 'metric');
  } finally {
    restore();
  }
});

test('an oversized response is refused before it is parsed', async () => {
  const huge = JSON.stringify({
    site: 'linkedin',
    generatedAt: 1,
    rulesVersion: 1,
    posts: [],
    authors: [],
    filler: 'x'.repeat(300_000),
  });
  const restore = serve(huge, { 'content-length': String(10_000_000) });
  try {
    await assert.rejects(() => fetchSnapshot('https://hostile.example', 'linkedin'), /too large/);
  } finally {
    restore();
  }
});

test('a snapshot beyond the entry caps is refused', async () => {
  const restore = serve({
    site: 'linkedin',
    generatedAt: 1,
    rulesVersion: 1,
    posts: Array.from({ length: 50_001 }, (_, i) => ({ id: `p${i}`, tag: 'ai-text', n: 1 })),
    authors: [],
  });
  try {
    await assert.rejects(() => fetchSnapshot('https://hostile.example', 'linkedin'), /validation/);
  } finally {
    restore();
  }
});

test('the snapshot URL carries nothing a caller can vary but the site', async () => {
  let seen = '';
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    seen = String(input);
    return new Response(
      JSON.stringify({ site: 'linkedin', generatedAt: 1, rulesVersion: 1, posts: [], authors: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    await fetchSnapshot('https://api.example.dev', 'linkedin');
    assert.equal(seen, 'https://api.example.dev/snapshot?site=linkedin');
    assert.ok(!seen.includes('since'), 'a varying URL is a varying edge-cache key');
  } finally {
    globalThis.fetch = original;
  }
});
