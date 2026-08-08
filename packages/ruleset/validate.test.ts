import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { checkPattern, validateRuleset } from './validate.ts';

const codes = (ps: { code: string }[]) => ps.map((p) => p.code);

test('the shipped ruleset passes its own gate', () => {
  const raw = JSON.parse(readFileSync(new URL('./rules.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateRuleset(raw), []);
  // Ships EMPTY at launch. Wired, but firing nothing.
  assert.equal(raw.features.length, 0);
});

test('the antithesis rule from the plan is allowed through', () => {
  const pattern =
    "\\b(it'?s|this is)\\s+not\\s+(just\\s+)?[^.,;—]{2,40}[,.]?\\s*[—-]?\\s*(it'?s|it is)\\s";
  assert.deepEqual(checkPattern('negation-antithesis', pattern, 'i'), []);
});

test('the classic ReDoS shape is rejected', () => {
  assert.ok(codes(checkPattern('x', '(a+)+b')).includes('nested-quantifier'));
  assert.ok(codes(checkPattern('x', '(a|aa)+b')).includes('nested-quantifier'));
  assert.ok(codes(checkPattern('x', '(?:a*)*b')).includes('nested-quantifier'));
  assert.ok(codes(checkPattern('x', '(\\s+|\\w+)*$')).includes('nested-quantifier'));
});

test('a quantified group with a safe body is fine', () => {
  // No inner quantifier, no alternation - this one is linear and useful.
  assert.deepEqual(checkPattern('x', '(hello)+'), []);
  assert.deepEqual(checkPattern('x', '(?:\\d,)+\\d'), []);
});

test('escapes and character classes do not fool the scanner', () => {
  // A literal "(" and a "+" inside a class are not a nested quantifier.
  assert.deepEqual(checkPattern('x', '\\(a\\)[+*]'), []);
  assert.deepEqual(checkPattern('x', '([+*])'), []);
});

test('stateful flags are rejected at the gate, not just stripped at runtime', () => {
  assert.ok(codes(checkPattern('x', 'slop', 'gi')).includes('bad-flags'));
  assert.ok(codes(checkPattern('x', 'slop', 'y')).includes('bad-flags'));
  assert.deepEqual(checkPattern('x', 'slop', 'imsu'), []);
});

test('backreferences and lookbehind are rejected, with reasons', () => {
  assert.ok(codes(checkPattern('x', '(\\w+)\\s+\\1')).includes('backreference'));
  assert.ok(codes(checkPattern('x', '(?<=foo)bar')).includes('lookbehind'));
  // Lookahead is fine - it is bounded and universally supported.
  assert.deepEqual(checkPattern('x', 'foo(?=bar)'), []);
});

test('length and repetition counts are capped', () => {
  assert.ok(codes(checkPattern('x', `${'a'.repeat(301)}`)).includes('too-long'));
  assert.ok(codes(checkPattern('x', 'a{5000}')).includes('huge-repetition'));
  assert.ok(codes(checkPattern('x', 'a{1,9999}')).includes('huge-repetition'));
  assert.deepEqual(checkPattern('x', 'a{2,40}'), []);
});

test('an uncompilable pattern fails the build instead of shipping dead', () => {
  assert.ok(codes(checkPattern('x', '([unclosed')).includes('uncompilable'));
});

test('every catastrophic pattern trips at least one gate', () => {
  // Either the grammar catches the shape or the timing budget does. Asserting
  // "some problem" rather than "the slow code" keeps this off the clock and out
  // of CI flake territory.
  for (const p of ['(a+)+$', '(a*)*$', '(.*a){20}$', '(a|a?)+$']) {
    assert.ok(checkPattern('x', p).length > 0, `no gate tripped for ${p}`);
  }
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
