import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decide, explain } from './decide.ts';
import type { DecideContext } from './decide.ts';
import { EMPTY_RULESET } from './rules.ts';
import type { Ruleset } from './rules.ts';
import { DEFAULT_POLICY, defaultPrefs, indexSnapshot } from './types.ts';
import type { PostFeatures, Snapshot } from './types.ts';

const SNAPSHOT: Snapshot = {
  site: 'linkedin',
  generatedAt: 1,
  rulesVersion: 1,
  posts: [
    { id: 'urn:li:activity:1111111111111111111', tag: 'ai-text', n: 1 },
    { id: 'urn:li:activity:2222222222222222222', tag: 'ai-image', n: 3 },
  ],
  authors: [
    { id: 'urn:li:member:9', kind: 'person', tag: 'ai-text', flaggedPosts: 6, reporters: 3 },
    { id: 'urn:li:member:8', kind: 'person', tag: 'ai-text', flaggedPosts: 6, reporters: 1 },
    { id: 'urn:li:member:7', kind: 'person', tag: 'ai-text', flaggedPosts: 2, reporters: 4 },
  ],
};

function ctx(over: Partial<DecideContext> = {}): DecideContext {
  return {
    index: indexSnapshot(SNAPSHOT),
    prefs: defaultPrefs(),
    policy: DEFAULT_POLICY,
    ruleset: EMPTY_RULESET,
    ...over,
  };
}

function post(over: Partial<PostFeatures> = {}): PostFeatures {
  return {
    site: 'linkedin',
    postIds: ['urn:li:activity:0000000000000000000'],
    authorId: 'urn:li:member:1',
    authorKind: 'person',
    text: 'Shipped the lighting pass today.',
    media: [],
    ...over,
  };
}

test('an untagged post is shown', () => {
  assert.deepEqual(decide(post(), ctx()), { action: 'show' });
});

test('a tagged post collapses with the tag as the reason', () => {
  const v = decide(post({ postIds: ['urn:li:activity:1111111111111111111'] }), ctx());
  assert.deepEqual(v, { action: 'collapse', reason: 'AI text', source: 'post' });
});

test('a reshare of tagged slop collapses on the nested id', () => {
  // The outer commentary is untagged; the original inside it is not.
  const v = decide(
    post({ postIds: ['urn:li:activity:5555555555555555555', 'urn:li:activity:1111111111111111111'] }),
    ctx(),
  );
  assert.equal(v.action, 'collapse');
  assert.equal(v.action === 'collapse' && v.source, 'post');
});

test('LinkedIn propagates on a single tag, Reddit waits for three', () => {
  const single = post({ postIds: ['urn:li:activity:1111111111111111111'] });
  assert.equal(decide(single, ctx()).action, 'collapse');

  const redditPolicy = { ...DEFAULT_POLICY, postHideThreshold: 3 };
  assert.equal(decide(single, ctx({ policy: redditPolicy })).action, 'show');

  // n=3 clears the Reddit bar.
  const three = post({ postIds: ['urn:li:activity:2222222222222222222'] });
  assert.equal(decide(three, ctx({ policy: redditPolicy })).action, 'collapse');
});

test('author promotion needs both the post count and distinct reporters', () => {
  assert.equal(decide(post({ authorId: 'urn:li:member:9' }), ctx()).action, 'collapse');
  // 6 posts but only 1 reporter - one person cannot promote an author alone.
  assert.equal(decide(post({ authorId: 'urn:li:member:8' }), ctx()).action, 'show');
  // 4 reporters but only 2 posts.
  assert.equal(decide(post({ authorId: 'urn:li:member:7' }), ctx()).action, 'show');
});

test('the author stub says why it is an author hit', () => {
  const v = decide(post({ authorId: 'urn:li:member:9' }), ctx());
  assert.equal(v.action === 'collapse' && v.reason, 'AI text - repeat poster');
});

test('unsubscribing from a tag shows its posts again', () => {
  const prefs = { ...defaultPrefs(), subscribedTags: ['broetry'] };
  const v = decide(post({ postIds: ['urn:li:activity:1111111111111111111'] }), ctx({ prefs }));
  assert.deepEqual(v, { action: 'show' });
});

test('the master switch and the per-site switch both short-circuit', () => {
  const tagged = post({ postIds: ['urn:li:activity:1111111111111111111'] });
  assert.equal(decide(tagged, ctx({ prefs: { ...defaultPrefs(), enabled: false } })).action, 'show');

  const siteOff = { ...defaultPrefs(), sites: { linkedin: false, reddit: true } };
  assert.equal(decide(tagged, ctx({ prefs: siteOff })).action, 'show');
});

test('rules only fire once a ruleset actually ships', () => {
  const broetry = post({
    text: ["It's not a bug, it's a feature ", 'Read that again.', 'Let it sink in.', "I'll wait."].join('\n'),
  });

  // Launch state: interpreter wired, ruleset empty.
  assert.equal(decide(broetry, ctx()).action, 'show');

  const live: Ruleset = {
    version: 1,
    features: [
      {
        id: 'negation-antithesis',
        type: 'regex',
        pattern: "\\b(it'?s|this is)\\s+not\\s+(just\\s+)?[^.,;—]{2,40}[,.]?\\s*[—-]?\\s*(it'?s|it is)\\s",
        flags: 'i',
        weight: 3,
        label: 'antithesis phrasing',
      },
      { id: 'short-lines', type: 'metric', metric: 'shortLineRatio', gte: 0.6, weight: 2, label: 'one line per sentence' },
    ],
    threshold: { default: 5 },
  };

  const v = decide(broetry, ctx({ ruleset: live }));
  assert.deepEqual(v, {
    action: 'collapse',
    reason: 'antithesis phrasing + one line per sentence',
    source: 'rule',
  });
});

test('the threshold slider is what decides a borderline post', () => {
  const live: Ruleset = {
    version: 1,
    features: [{ id: 'short-lines', type: 'metric', metric: 'shortLineRatio', gte: 0.6, weight: 2 }],
    threshold: { default: 5 },
  };
  const broetry = post({ text: 'Read that again.\nLet it sink in.\nI will wait.' });

  const strict = { ...defaultPrefs(), threshold: 2 };
  const relaxed = { ...defaultPrefs(), threshold: 4 };
  assert.equal(decide(broetry, ctx({ ruleset: live, prefs: strict })).action, 'collapse');
  assert.equal(decide(broetry, ctx({ ruleset: live, prefs: relaxed })).action, 'show');
});

test('explain carries the working, for the debug view', () => {
  const e = explain(post(), ctx());
  assert.equal(e.verdict.action, 'show');
  assert.equal(e.threshold, 5);
  // No ruleset shipped, so scoring never ran.
  assert.equal(e.rules, null);
});

test('a snapshot hit beats a rules hit, so the stub names the human reason', () => {
  const live: Ruleset = {
    version: 1,
    features: [{ id: 'short-lines', type: 'metric', metric: 'shortLineRatio', gte: 0.6, weight: 9 }],
    threshold: { default: 5 },
  };
  const v = decide(
    post({ postIds: ['urn:li:activity:1111111111111111111'], text: 'Short.\nLines.\nHere.' }),
    ctx({ ruleset: live }),
  );
  assert.equal(v.action === 'collapse' && v.source, 'post');
});

test('founder posts never collapse, even with a snapshot hit', () => {
  const v = decide(
    post({
      authorId: 'li:in:ericlevy',
      postIds: ['urn:li:activity:1111111111111111111'],
    }),
    ctx(),
  );
  assert.deepEqual(v, { action: 'show' });
});

test('a known founder activity is immune even without an author id', () => {
  const v = decide(post({ authorId: null, postIds: ['urn:li:activity:7493503286445273089'] }), ctx());
  assert.deepEqual(v, { action: 'show' });
});
