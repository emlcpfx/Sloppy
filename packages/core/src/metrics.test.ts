import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeMetrics, isGeneratorNativeSize, stripTrailingHashtags } from './metrics.ts';

const BROETRY = [
  'I fired my best engineer today.',
  '',
  'Read that again.',
  '',
  'Let it sink in.',
  '',
  "I'll wait.",
].join('\n');

test('the tag wall comes off before phrasing is scored', () => {
  const withWall = 'Real body text here.\n\n#leadership #innovation #ai\n#growth';
  assert.equal(stripTrailingHashtags(withWall).trim(), 'Real body text here.');

  // An inline hashtag mid-sentence is not a wall and must survive.
  const inline = 'We shipped #vfx work this week.';
  assert.equal(stripTrailingHashtags(inline), inline);
});

test('hashtags are counted even though they are stripped from the body', () => {
  const m = computeMetrics('Body.\n\n#one #two #three');
  assert.equal(m.hashtagCount, 3);
  // Body words only - the wall must not inflate the word count.
  assert.equal(m.words, 1);
});

test('broetry reads as a high short-line ratio', () => {
  const m = computeMetrics(BROETRY);
  assert.equal(m.lines, 4);
  assert.ok(m.shortLineRatio >= 0.6, `shortLineRatio=${m.shortLineRatio}`);
  assert.ok(m.avgLineWords < 7);
});

test('ordinary prose does not', () => {
  const prose =
    'We spent the week rebuilding the compositing setup for the third act, ' +
    'which had been fighting us since the previz stage and finally needed a ' +
    'proper rethink rather than another round of patches.';
  const m = computeMetrics(prose);
  assert.ok(m.shortLineRatio < 0.6);
});

test('em dashes are measured as a rate, not a count', () => {
  const short = computeMetrics('This — that.');
  const long = computeMetrics(`This — that. ${'filler word '.repeat(50)}`);
  assert.ok(short.emDashPer100w > long.emDashPer100w);
});

test('media signals ride the same metric bag as text', () => {
  const m = computeMetrics('Look at this.', [
    { kind: 'image', w: 1024, h: 1024, hasC2PABadge: true },
    { kind: 'image', w: 1600, h: 900 },
    { kind: 'video' },
  ]);
  assert.equal(m.imageCount, 2);
  assert.equal(m.videoCount, 1);
  assert.equal(m.c2paBadgeCount, 1);
  assert.equal(m.genNativeDimCount, 1);
});

test('generator-native sizes are recognised, ordinary crops are not', () => {
  assert.equal(isGeneratorNativeSize(1024, 1024), true);
  assert.equal(isGeneratorNativeSize(1792, 1024), true);
  assert.equal(isGeneratorNativeSize(1920, 1080), false);
  assert.equal(isGeneratorNativeSize(undefined, 1024), false);
});

test('empty text does not divide by zero', () => {
  const m = computeMetrics('');
  for (const [k, v] of Object.entries(m)) {
    assert.ok(Number.isFinite(v), `${k} is ${v}`);
  }
});
