/**
 * The canonical tag vocabulary, and the normaliser that keeps five spellings
 * of "AI slop" from becoming five separately-unsubscribable tags.
 *
 * ---------------------------------------------------------------------------
 * ONE RULE GOVERNS WHAT MAY BE ADDED HERE: TAGS DESCRIBE FORM, NEVER SUBSTANCE.
 * ---------------------------------------------------------------------------
 *
 * A form tag ("this is written as one sentence per line") cannot be aimed at
 * somebody who does not write that way. A substance tag ("this is wrong",
 * "this is a lie", "this is rage-bait") is pure ammunition, and in a small
 * industry where people tag posts by studios they may want work from, it will
 * be used as such. Substance tags will get requested. Don't.
 */

import type { SiteId } from './types.ts';

export interface TagDef {
  id: string;
  label: string;
  /** One line, shown in the picker and in the collapse stub. */
  hint: string;
  sites: readonly SiteId[];
}

export const TAGS: readonly TagDef[] = [
  // Shared across every site.
  { id: 'ai-text', label: 'AI text', hint: 'Written by a language model', sites: ['linkedin', 'reddit'] },
  { id: 'ai-image', label: 'AI image', hint: 'Generated still image', sites: ['linkedin', 'reddit'] },
  { id: 'ai-video', label: 'AI video', hint: 'Generated video', sites: ['linkedin', 'reddit'] },
  { id: 'engagement-bait', label: 'Engagement bait', hint: 'Written to farm comments', sites: ['linkedin', 'reddit'] },
  { id: 'listicle', label: 'Listicle', hint: 'Numbered filler', sites: ['linkedin', 'reddit'] },
  { id: 'repost', label: 'Repost', hint: 'Recycled from elsewhere', sites: ['linkedin', 'reddit'] },

  // LinkedIn-shaped.
  { id: 'broetry', label: 'Broetry', hint: 'One sentence per line, for effect', sites: ['linkedin'] },
  { id: 'humblebrag', label: 'Humblebrag', hint: 'A flex wearing a humility costume', sites: ['linkedin'] },
  { id: 'hashtag-spam', label: 'Hashtag spam', hint: 'Tag wall at the bottom', sites: ['linkedin'] },

  // Reddit-shaped. Reddit's problem is not broetry.
  { id: 'karma-farm', label: 'Karma farm', hint: 'Reposted for the numbers', sites: ['reddit'] },
  { id: 'ai-comment', label: 'AI comment', hint: 'Generated reply', sites: ['reddit'] },
];

export const CANONICAL_TAGS: readonly string[] = TAGS.map((t) => t.id);

const BY_ID = new Map(TAGS.map((t) => [t.id, t]));

export function tagDef(id: string): TagDef | undefined {
  return BY_ID.get(id);
}

export function tagsForSite(site: SiteId): TagDef[] {
  return TAGS.filter((t) => t.sites.includes(site));
}

export function tagLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

/**
 * Free text people actually type, mapped onto canonical ids. Everything here
 * is matched *after* slugification, so "AI Slop!" and "ai  slop" both arrive
 * as "ai-slop".
 */
const ALIASES: Record<string, string> = {
  'ai-slop': 'ai-text',
  slop: 'ai-text',
  ai: 'ai-text',
  gpt: 'ai-text',
  chatgpt: 'ai-text',
  llm: 'ai-text',
  'ai-written': 'ai-text',
  'ai-generated': 'ai-text',
  'ai-art': 'ai-image',
  midjourney: 'ai-image',
  'mid-journey': 'ai-image',
  dalle: 'ai-image',
  'dall-e': 'ai-image',
  'stable-diffusion': 'ai-image',
  'genai-image': 'ai-image',
  sora: 'ai-video',
  'genai-video': 'ai-video',
  'ai-reel': 'ai-video',
  bait: 'engagement-bait',
  clickbait: 'engagement-bait',
  'comment-bait': 'engagement-bait',
  'reply-bait': 'engagement-bait',
  'agree-question': 'engagement-bait',
  'linkedin-poetry': 'broetry',
  poetry: 'broetry',
  'one-line-per-sentence': 'broetry',
  brag: 'humblebrag',
  flex: 'humblebrag',
  'humble-brag': 'humblebrag',
  hashtags: 'hashtag-spam',
  'tag-wall': 'hashtag-spam',
  reposted: 'repost',
  recycled: 'repost',
  'karma-farming': 'karma-farm',
  karmafarm: 'karma-farm',
  'bot-comment': 'ai-comment',
  'ai-reply': 'ai-comment',
  numbered: 'listicle',
  'listicle-spam': 'listicle',
};

const MAX_TAG_LEN = 32;

/** Lowercase, strip accents and punctuation, collapse whitespace to hyphens. */
export function slugifyTag(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TAG_LEN)
    .replace(/-+$/g, '');
}

export interface NormalizedTag {
  tag: string;
  /** False means it stays private to its author until enough installs use it. */
  canonical: boolean;
  /** Set when a fuzzy match folded a near-miss into a canonical id. */
  mergedFrom?: string;
}

/**
 * Levenshtein, iterative, two rows. Inputs here are <= 32 chars so the naive
 * implementation is the right one.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] ?? 0;
}

/**
 * Fuzzy-fold a slug onto a canonical id.
 *
 * Deliberately timid: a single edit, both strings at least six characters, and
 * a shared three-character prefix. Loosen it and unrelated words start folding
 * into each other, which is worse than carrying a duplicate tag - a wrong merge
 * is invisible and permanent, a duplicate is visible and mergeable later.
 */
function fuzzyCanonical(slug: string): string | null {
  if (slug.length < 6) return null;
  for (const id of CANONICAL_TAGS) {
    if (id.length < 6) continue;
    if (id.slice(0, 3) !== slug.slice(0, 3)) continue;
    if (editDistance(slug, id) <= 1) return id;
  }
  return null;
}

export function normalizeTag(raw: string): NormalizedTag | null {
  const slug = slugifyTag(raw);
  if (!slug) return null;

  if (BY_ID.has(slug)) return { tag: slug, canonical: true };

  const alias = ALIASES[slug];
  if (alias) return { tag: alias, canonical: true, mergedFrom: slug };

  const fuzzy = fuzzyCanonical(slug);
  if (fuzzy) return { tag: fuzzy, canonical: true, mergedFrom: slug };

  return { tag: slug, canonical: false };
}

/** Empty subscription list means "everything". */
export function isSubscribed(tag: string, subscribed: readonly string[]): boolean {
  return subscribed.length === 0 || subscribed.includes(tag);
}
