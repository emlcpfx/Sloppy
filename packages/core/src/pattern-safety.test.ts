import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkPattern, sanitizeRuleset } from './pattern-safety.ts';

const codes = (ps: { code: string }[]) => ps.map((p) => p.code);

test('the antithesis rule from the plan is allowed through', () => {
  const pattern =
    "\\b(it'?s|this is)\\s+not\\s+(just\\s+)?[^.,;—]{2,40}[,.]?\\s*[—-]?\\s*(it'?s|it is)\\s";
  assert.deepEqual(checkPattern(pattern, 'i'), []);
});

test('the classic ReDoS shape is rejected', () => {
  assert.ok(codes(checkPattern('(a+)+b')).includes('nested-quantifier'));
  assert.ok(codes(checkPattern('(a|aa)+b')).includes('nested-quantifier'));
  assert.ok(codes(checkPattern('(?:a*)*b')).includes('nested-quantifier'));
  assert.ok(codes(checkPattern('(\\s+|\\w+)*$')).includes('nested-quantifier'));
});

test('adjacent unbounded quantifiers are rejected even with no group', () => {
  // a*a*b has no nested group at all and is every bit as catastrophic.
  assert.ok(codes(checkPattern('a*a*b')).includes('adjacent-quantifiers'));
  assert.ok(codes(checkPattern('.*.*$')).includes('adjacent-quantifiers'));
});

test('a quantified group with a safe body is fine', () => {
  assert.deepEqual(checkPattern('(hello)+'), []);
  assert.deepEqual(checkPattern('(?:\\d,)+\\d'), []);
});

test('escapes and character classes do not fool the scanner', () => {
  assert.deepEqual(checkPattern('\\(a\\)[+*]'), []);
  assert.deepEqual(checkPattern('([+*])'), []);
});

test('stateful flags are rejected at the gate, not just stripped at runtime', () => {
  assert.ok(codes(checkPattern('slop', 'gi')).includes('bad-flags'));
  assert.ok(codes(checkPattern('slop', 'y')).includes('bad-flags'));
  assert.deepEqual(checkPattern('slop', 'imsu'), []);
});

test('backreferences and lookbehind are rejected, with reasons', () => {
  assert.ok(codes(checkPattern('(\\w+)\\s+\\1')).includes('backreference'));
  assert.ok(codes(checkPattern('(?<=foo)bar')).includes('lookbehind'));
  assert.deepEqual(checkPattern('foo(?=bar)'), []);
});

test('length and repetition counts are capped', () => {
  assert.ok(codes(checkPattern('a'.repeat(301))).includes('too-long'));
  assert.ok(codes(checkPattern('a{5000}')).includes('huge-repetition'));
  assert.ok(codes(checkPattern('a{1,9999}')).includes('huge-repetition'));
  assert.deepEqual(checkPattern('a{2,40}'), []);
});

test('an uncompilable pattern is rejected rather than shipped dead', () => {
  assert.ok(codes(checkPattern('([unclosed')).includes('uncompilable'));
});

test('every catastrophic pattern trips at least one gate, and none of them hang', () => {
  // The gate must never EXECUTE a pattern that already failed a structural
  // check - the first version timed `(.*a){20}$` against a 5,000-character
  // string and hung its own test suite for two minutes.
  const t0 = performance.now();
  for (const p of ['(a+)+$', '(a*)*$', '(.*a){20}$', '(a|a?)+$', 'a*a*a*a*b']) {
    assert.ok(checkPattern(p).length > 0, `no gate tripped for ${p}`);
  }
  assert.ok(performance.now() - t0 < 1000, 'the gate must not reproduce the attack it detects');
});

// ---------------------------------------------------------------------------
// The runtime gate
// ---------------------------------------------------------------------------

const safeFeature = { id: 'safe', type: 'regex', pattern: '\\bhumbled to announce\\b', weight: 2 };
const metricFeature = { id: 'lines', type: 'metric', metric: 'shortLineRatio', gte: 0.6, weight: 2 };
const hostileFeature = { id: 'hostile', type: 'regex', pattern: '(a+)+$', weight: 9 };

test('a hostile pattern is dropped and the rest of the ruleset survives', () => {
  const { ruleset, dropped } = sanitizeRuleset({
    version: 3,
    features: [safeFeature, hostileFeature, metricFeature],
    threshold: { default: 5 },
  });

  assert.deepEqual(ruleset.features.map((f) => f.id), ['safe', 'lines']);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0]?.id, 'hostile');
  assert.ok(codes(dropped[0]!.problems).includes('nested-quantifier'));
});

test('DROP, never reject wholesale', () => {
  // Rejecting the whole ruleset on one bad rule would hand anyone who can
  // influence it a one-line way to switch filtering off entirely.
  const { ruleset } = sanitizeRuleset({
    version: 3,
    features: [hostileFeature, safeFeature],
    threshold: { default: 5 },
  });
  assert.equal(ruleset.features.length, 1);
  assert.equal(ruleset.features[0]?.id, 'safe');
});

test('metric features have no pattern to analyse and always survive', () => {
  const { ruleset, dropped } = sanitizeRuleset({
    version: 1,
    features: [metricFeature],
    threshold: { default: 5 },
  });
  assert.equal(ruleset.features.length, 1);
  assert.deepEqual(dropped, []);
});

test('sanitizing does not mutate the input', () => {
  const input = { version: 1, features: [hostileFeature], threshold: { default: 5 } };
  sanitizeRuleset(input);
  assert.equal(input.features.length, 1, 'the caller keeps what it passed in');
});
