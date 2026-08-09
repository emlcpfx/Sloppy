import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateRuleset } from './validate.ts';

const codes = (ps: { code: string }[]) => ps.map((p) => p.code);

// The pattern analysis itself is tested in @sloppy/core, where it now lives -
// the extension runs the same checks at runtime, so they cannot be CI-only.
// What is tested here is the ruleset-level gate and its wiring to that analysis.

test('the shipped ruleset passes its own gate', () => {
  const raw = JSON.parse(readFileSync(new URL('./rules.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateRuleset(raw), []);
  // Ships EMPTY at launch. Wired, but firing nothing.
  assert.equal(raw.features.length, 0);
});

test('an unsafe pattern is reported against the feature that carries it', () => {
  const problems = validateRuleset({
    version: 1,
    features: [{ id: 'catastrophic', type: 'regex', pattern: '(a+)+$', weight: 3 }],
    threshold: { default: 5 },
  });
  assert.equal(problems[0]?.featureId, 'catastrophic');
  assert.ok(codes(problems).includes('nested-quantifier'));
});

test('a safe pattern passes the whole gate', () => {
  assert.deepEqual(
    validateRuleset({
      version: 1,
      features: [
        {
          id: 'negation-antithesis',
          type: 'regex',
          pattern: "\\b(it'?s|this is)\\s+not\\s+(just\\s+)?[^.,;—]{2,40}[,.]?\\s*[—-]?\\s*(it'?s|it is)\\s",
          flags: 'i',
          weight: 3,
        },
      ],
      threshold: { default: 5 },
    }),
    [],
  );
});

test('schema violations are reported per path', () => {
  const problems = validateRuleset({
    version: 1,
    features: [{ id: 'x', type: 'regex', pattern: 'a', weight: 999 }],
    threshold: { default: 5 },
  });
  assert.equal(problems[0]?.code, 'schema');
});

test('a metric feature with no bounds is a build failure', () => {
  const problems = validateRuleset({
    version: 1,
    features: [{ id: 'oops', type: 'metric', metric: 'words', weight: 2 }],
    threshold: { default: 5 },
  });
  assert.deepEqual(codes(problems), ['no-bounds']);
});

test('duplicate ids are caught', () => {
  const problems = validateRuleset({
    version: 1,
    features: [
      { id: 'dupe', type: 'metric', metric: 'words', gte: 1, weight: 1 },
      { id: 'dupe', type: 'metric', metric: 'lines', gte: 1, weight: 1 },
    ],
    threshold: { default: 5 },
  });
  assert.deepEqual(codes(problems), ['duplicate-id']);
});

test('an unknown metric name cannot ship', () => {
  const problems = validateRuleset({
    version: 1,
    features: [{ id: 'x', type: 'metric', metric: 'vibes', gte: 1, weight: 1 }],
    threshold: { default: 5 },
  });
  assert.equal(problems[0]?.code, 'schema');
});
