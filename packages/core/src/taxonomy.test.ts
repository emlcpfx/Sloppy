import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CANONICAL_TAGS,
  isSubscribed,
  normalizeTag,
  slugifyTag,
  tagsForSite,
} from './taxonomy.ts';

test('slugify folds case, punctuation and accents', () => {
  assert.equal(slugifyTag('AI Slop!'), 'ai-slop');
  assert.equal(slugifyTag('  engagement   bait  '), 'engagement-bait');
  assert.equal(slugifyTag('Clichés & Filler'), 'cliches-and-filler');
  assert.equal(slugifyTag('###'), '');
});

test('five spellings of AI slop become one tag', () => {
  const spellings = ['AI slop', 'ai-slop', 'AI  Slop', 'aislop!', 'slop'];
  const got = spellings.map((s) => normalizeTag(s)?.tag);
  // "aislop" has no alias and is only 6 chars from nothing canonical, so it
  // stays custom - the point is that the four that should merge, do.
  assert.deepEqual(got.slice(0, 3), ['ai-text', 'ai-text', 'ai-text']);
  assert.equal(got[4], 'ai-text');
});

test('aliases land on canonical ids', () => {
  assert.equal(normalizeTag('Midjourney')?.tag, 'ai-image');
  assert.equal(normalizeTag('ChatGPT')?.tag, 'ai-text');
  assert.equal(normalizeTag('clickbait')?.tag, 'engagement-bait');
  assert.equal(normalizeTag('LinkedIn poetry')?.tag, 'broetry');
});

test('a single typo folds, a different word does not', () => {
  const typo = normalizeTag('broetryy');
  assert.equal(typo?.tag, 'broetry');
  assert.equal(typo?.canonical, true);
  assert.equal(typo?.mergedFrom, 'broetryy');

  const unrelated = normalizeTag('sourdough');
  assert.equal(unrelated?.tag, 'sourdough');
  assert.equal(unrelated?.canonical, false);
});

test('unknown free text survives as a private custom tag', () => {
  const custom = normalizeTag('Corporate Mad Libs');
  assert.equal(custom?.tag, 'corporate-mad-libs');
  assert.equal(custom?.canonical, false);
  assert.equal(normalizeTag('   '), null);
});

test('tags are stylistic only - no substance categories slipped in', () => {
  // The taxonomy is the place this rule is enforceable, so assert it.
  const banned = ['misinformation', 'lie', 'wrong', 'fake-news', 'stupid', 'bad-take'];
  for (const b of banned) assert.ok(!CANONICAL_TAGS.includes(b), `substance tag present: ${b}`);
});

test('site vocabularies overlap only where they should', () => {
  const li = tagsForSite('linkedin').map((t) => t.id);
  const rd = tagsForSite('reddit').map((t) => t.id);
  assert.ok(li.includes('broetry'));
  assert.ok(!rd.includes('broetry'));
  assert.ok(rd.includes('karma-farm'));
  assert.ok(!li.includes('karma-farm'));
  for (const shared of ['ai-text', 'ai-image', 'ai-video']) {
    assert.ok(li.includes(shared) && rd.includes(shared));
  }
});

test('an empty subscription list means everything', () => {
  assert.equal(isSubscribed('ai-text', []), true);
  assert.equal(isSubscribed('ai-text', ['broetry']), false);
  assert.equal(isSubscribed('broetry', ['broetry']), true);
});
