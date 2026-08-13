/**
 * Cheap, explainable numbers derived from a post's text and media.
 *
 * Every one of these is a *weak* signal on its own. They exist to be summed by
 * the rules interpreter, never to hide a post individually - see rules.ts for
 * why the engine is a weighted sum rather than a set of booleans.
 */

import type { MediaRef } from './types.ts';

export type MetricName =
  | 'words'
  | 'lines'
  | 'shortLineRatio'
  | 'avgLineWords'
  | 'emDashPer100w'
  | 'hashtagCount'
  | 'hashtagPer100w'
  | 'emojiLineRatio'
  | 'capsWordRatio'
  | 'questionRatio'
  | 'linkCount'
  | 'imageCount'
  | 'videoCount'
  | 'c2paBadgeCount'
  | 'genNativeDimCount';

export type Metrics = Record<MetricName, number>;

export const METRIC_NAMES: readonly MetricName[] = [
  'words',
  'lines',
  'shortLineRatio',
  'avgLineWords',
  'emDashPer100w',
  'hashtagCount',
  'hashtagPer100w',
  'emojiLineRatio',
  'capsWordRatio',
  'questionRatio',
  'linkCount',
  'imageCount',
  'videoCount',
  'c2paBadgeCount',
  'genNativeDimCount',
];

/** A line counts as "short" at or under this many words. */
const SHORT_LINE_WORDS = 6;

const HASHTAG_RE = /(?:^|\s)#[\p{L}\p{N}_]+/gu;
const LINK_RE = /https?:\/\/\S+/gi;
const EM_DASH_RE = /[—–]/g;
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const BULLET_LINE_RE = /^\s*(?:[\p{Extended_Pictographic}•▪●➡→➔]|[-*–—]\s|\d+[.)]\s)/u;

/**
 * LinkedIn's "tag wall" skews every phrasing metric if it is left in - twenty
 * hashtags is twenty one-word lines. Strip it before scoring, count it
 * separately.
 */
export function stripTrailingHashtags(text: string): string {
  const lines = text.split('\n');
  let end = lines.length;
  while (end > 0) {
    const line = (lines[end - 1] ?? '').trim();
    if (line === '') {
      end--;
      continue;
    }
    // A line that is nothing but hashtags is part of the wall.
    if (/^(?:#[\p{L}\p{N}_]+[\s,]*)+$/u.test(line)) {
      end--;
      continue;
    }
    break;
  }
  return lines.slice(0, end).join('\n');
}

function countMatches(text: string, re: RegExp): number {
  // Fresh lastIndex every call; these are module-level /g regexes.
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text) !== null) n++;
  re.lastIndex = 0;
  return n;
}

function words(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

/**
 * Image sizes that generators emit natively. Weak, free, and worth exactly what
 * it costs: a designer can pick 1024x1024 too.
 */
const GEN_NATIVE_DIMS = new Set([
  '512x512',
  '1024x1024',
  '2048x2048',
  '1024x1536',
  '1536x1024',
  '1024x1792',
  '1792x1024',
  '896x1152',
  '1152x896',
  '832x1216',
  '1216x832',
  '768x1344',
  '1344x768',
  '640x1536',
  '1536x640',
]);

export function isGeneratorNativeSize(w?: number, h?: number): boolean {
  if (!w || !h) return false;
  return GEN_NATIVE_DIMS.has(`${w}x${h}`);
}

export function computeMetrics(rawText: string, media: readonly MediaRef[] = []): Metrics {
  const hashtagCount = countMatches(rawText, HASHTAG_RE);
  const text = stripTrailingHashtags(rawText);

  const allLines = text.split('\n').map((l) => l.trim());
  const lines = allLines.filter((l) => l.length > 0);
  const allWords = words(text);
  const wordCount = allWords.length;

  let shortLines = 0;
  let emojiLines = 0;
  let questionLines = 0;
  for (const line of lines) {
    const n = words(line).length;
    if (n > 0 && n <= SHORT_LINE_WORDS) shortLines++;
    if (BULLET_LINE_RE.test(line)) emojiLines++;
    if (line.endsWith('?')) questionLines++;
  }

  let capsWords = 0;
  for (const w of allWords) {
    if (w.length >= 3 && w === w.toUpperCase() && /\p{Lu}/u.test(w)) capsWords++;
  }

  const per100 = wordCount > 0 ? 100 / wordCount : 0;
  const lineCount = lines.length;
  const safeLines = lineCount > 0 ? lineCount : 1;

  let imageCount = 0;
  let videoCount = 0;
  let c2paBadgeCount = 0;
  let genNativeDimCount = 0;
  for (const m of media) {
    if (m.kind === 'image') imageCount++;
    if (m.kind === 'video') videoCount++;
    if (m.hasC2PABadge) c2paBadgeCount++;
    if (isGeneratorNativeSize(m.w, m.h)) genNativeDimCount++;
  }

  return {
    words: wordCount,
    lines: lineCount,
    shortLineRatio: shortLines / safeLines,
    avgLineWords: wordCount / safeLines,
    emDashPer100w: countMatches(text, EM_DASH_RE) * per100,
    hashtagCount,
    hashtagPer100w: hashtagCount * per100,
    emojiLineRatio: emojiLines / safeLines,
    capsWordRatio: wordCount > 0 ? capsWords / wordCount : 0,
    questionRatio: questionLines / safeLines,
    linkCount: countMatches(text, LINK_RE),
    imageCount,
    videoCount,
    c2paBadgeCount,
    genNativeDimCount,
  };
}
