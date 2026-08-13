import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeMetrics } from './metrics.ts';
import { _clearPatternCache, compileFeature, scoreText, thresholdFor } from './rules.ts';
import type { Ruleset } from './rules.ts';

const NEGATION =
  "\\b(it'?s|this is)\\s+not\\s+(just\\s+)?[^.,;—]{2,40}[,.]?\\s*[—-]?\\s*(it'?s|it is)\\s";

const RULESET: Ruleset = {
  version: 1,
  features: [
    {
      id: 'negation-antithesis',
      type: 'regex',
      pattern: NEGATION,
      flags: 'i',
      weight: 3,
      label: 'antithesis phrasing',
    },
    {
      id: 'short-line-density',
      type: 'metric',
      metric: 'shortLineRatio',
      gte: 0.6,
      weight: 2,
      label: 'one line per sentence',
    },
  ],
  threshold: { default: 5, bySite: { reddit: 7 } },
};

function score(text: string) {
  return scoreText(text, computeMetrics(text), RULESET);
}

test('weights add up rather than firing individually', () => {
  const both = score(
    ["It's not a bug, it's a feature ", 'Read that again.', 'Let it sink in.', "I'll wait."].join('\n'),
  );
  assert.equal(both.score, 5);
  assert.deepEqual(both.hits.map((h) => h.id), ['negation-antithesis', 'short-line-density']);

  // The antithesis alone is 3 - under any sane threshold. Cicero is safe.
  const cicero = score("It's not a bug, it's a feature, and that distinction has mattered " +
    'to writers for two thousand years of perfectly ordinary prose.');
  assert.equal(cicero.score, 3);
});

test('a post with neither feature scores zero', () => {
  const s = score('Shipped the lighting pass today. Notes from the review are in the sheet.');
  assert.equal(s.score, 0);
  assert.deepEqual(s.hits, []);
});

test('hits come back ordered by weight so the stub names the strongest', () => {
  const s = score(
    ["It's not a bug, it's a feature ", 'Read that again.', 'Let it sink in.', "I'll wait."].join('\n'),
  );
  assert.equal(s.hits[0]?.label, 'antithesis phrasing');
});

test('a malformed remote pattern scores zero instead of throwing', () => {
  const broken: Ruleset = {
    version: 1,
    features: [{ id: 'bad', type: 'regex', pattern: '([unclosed', weight: 9 }],
    threshold: { default: 5 },
  };
  const s = scoreText('anything at all', computeMetrics('anything at all'), broken);
  assert.equal(s.score, 0);
});

test('stateful flags are stripped, so repeated tests are stable', () => {
  _clearPatternCache();
  const re = compileFeature('slop', 'gi');
  assert.ok(re);
  assert.equal(re.flags.includes('g'), false);
  // With /g this second call would be false - the classic lastIndex bug.
  assert.equal(re.test('slop'), true);
  assert.equal(re.test('slop'), true);
});

test('a metric feature with no bounds is a config error, not match-everything', () => {
  const unbounded: Ruleset = {
    version: 1,
    features: [{ id: 'oops', type: 'metric', metric: 'words', weight: 9 }],
    threshold: { default: 5 },
  };
  assert.equal(scoreText('hello', computeMetrics('hello'), unbounded).score, 0);
});

test('remote patterns only ever walk a bounded amount of text', () => {
  const huge = 'x'.repeat(50_000) + "\nIt's not a bug, it's a feature ";
  const t0 = performance.now();
  scoreText(huge, computeMetrics(huge), RULESET);
  assert.ok(performance.now() - t0 < 250);
});

test('threshold resolution prefers the user slider, then site, then default', () => {
  assert.equal(thresholdFor(RULESET, 'linkedin'), 5);
  assert.equal(thresholdFor(RULESET, 'reddit'), 7);
  assert.equal(thresholdFor(RULESET, 'reddit', 2), 2);
});
