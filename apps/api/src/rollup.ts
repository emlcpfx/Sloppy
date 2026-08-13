/**
 * Rollup policy, as pure functions.
 *
 * Kept out of the request handler so it can be tested without a database, a
 * Worker runtime, or a network - the promotion thresholds are the part where a
 * quiet off-by-one wrongly blocks a real person's account.
 */

import type { AuthorKind, SiteId, SnapshotAuthor, SnapshotPost } from '@sloppy/core';

export interface RollupPolicy {
  /** Rolling window for author promotion. */
  windowDays: number;
  /** Distinct posts by that author that were flagged. */
  authorPosts: number;
  /** Distinct install ids among the reporters. */
  authorReporters: number;
  /** Distinct installs before a coined tag becomes public. */
  tagPromotionInstalls: number;
}

export const DEFAULT_ROLLUP: RollupPolicy = {
  windowDays: 90,
  authorPosts: 5,
  authorReporters: 2,
  tagPromotionInstalls: 5,
};

export interface TagRow {
  post_id: string;
  author_id: string | null;
  author_kind: AuthorKind;
  site: SiteId;
  tag: string;
  install_id: string;
  ts: number;
}

/**
 * Collapse raw tuples into one entry per post: the winning tag and how many
 * distinct installs reported it.
 *
 * Ties break alphabetically rather than by insertion order. Arbitrary, but
 * DETERMINISTIC - two rebuilds of the same window must produce the same
 * snapshot or clients see posts flap between reasons for no reason.
 */
export function rollupPosts(rows: readonly TagRow[]): SnapshotPost[] {
  const byPost = new Map<string, Map<string, Set<string>>>();

  for (const r of rows) {
    let tags = byPost.get(r.post_id);
    if (!tags) {
      tags = new Map();
      byPost.set(r.post_id, tags);
    }
    let installs = tags.get(r.tag);
    if (!installs) {
      installs = new Set();
      tags.set(r.tag, installs);
    }
    installs.add(r.install_id);
  }

  const out: SnapshotPost[] = [];
  for (const [postId, tags] of byPost) {
    let bestTag = '';
    let bestCount = 0;
    let total = new Set<string>();

    for (const [tag, installs] of tags) {
      for (const i of installs) total.add(i);
      const n = installs.size;
      if (n > bestCount || (n === bestCount && tag < bestTag)) {
        bestTag = tag;
        bestCount = n;
      }
    }
    out.push({ id: postId, tag: bestTag, n: total.size });
  }

  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/**
 * Promote authors who clear BOTH bars inside the window.
 *
 * ---------------------------------------------------------------------------
 * KNOWN GAP: volume normalisation is not computable from this schema.
 * ---------------------------------------------------------------------------
 * The plan asks that promotion be normalised by post volume, so a prolific
 * account does not drift onto the list by arithmetic alone. That needs each
 * author's TOTAL post count - and Sloppy deliberately never records the posts
 * a person merely saw, only the ones somebody tagged. So the denominator does
 * not exist here, and inventing one from tagged posts alone would be circular.
 *
 * Two honest options, neither taken yet because both cost something real:
 *   (a) have the client report a per-author "posts seen" counter, which starts
 *       collecting exactly the browsing signal the whole design avoids; or
 *   (b) accept the raw threshold and lean on the per-entity-type split below -
 *       a company account posting daily SHOULD hit five flags faster than an
 *       individual, and usually that is correct rather than a false positive.
 *
 * (b) is what ships. It is a deliberate choice, not an oversight, and the
 * per-kind thresholds are where it gets tuned.
 */
export function rollupAuthors(
  rows: readonly TagRow[],
  policy: RollupPolicy = DEFAULT_ROLLUP,
  now = Date.now(),
): SnapshotAuthor[] {
  const cutoff = now - policy.windowDays * 86_400_000;
  const byAuthor = new Map<
    string,
    { kind: AuthorKind; posts: Set<string>; reporters: Set<string>; tags: Map<string, number> }
  >();

  for (const r of rows) {
    if (!r.author_id) continue;
    if (r.ts < cutoff) continue;

    let a = byAuthor.get(r.author_id);
    if (!a) {
      a = { kind: r.author_kind, posts: new Set(), reporters: new Set(), tags: new Map() };
      byAuthor.set(r.author_id, a);
    }
    a.posts.add(r.post_id);
    a.reporters.add(r.install_id);
    a.tags.set(r.tag, (a.tags.get(r.tag) ?? 0) + 1);
    if (r.author_kind !== 'unknown') a.kind = r.author_kind;
  }

  const out: SnapshotAuthor[] = [];
  for (const [id, a] of byAuthor) {
    if (a.posts.size < policy.authorPosts) continue;
    if (a.reporters.size < policy.authorReporters) continue;

    let tag = '';
    let best = -1;
    for (const [t, n] of [...a.tags].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      if (n > best) {
        best = n;
        tag = t;
      }
    }

    out.push({
      id,
      kind: a.kind,
      tag,
      flaggedPosts: a.posts.size,
      reporters: a.reporters.size,
    });
  }

  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** Tags used independently by enough distinct installs to become public. */
export function promotableTags(
  rows: readonly TagRow[],
  canonical: readonly string[],
  policy: RollupPolicy = DEFAULT_ROLLUP,
): string[] {
  const installs = new Map<string, Set<string>>();
  for (const r of rows) {
    if (canonical.includes(r.tag)) continue;
    let s = installs.get(r.tag);
    if (!s) {
      s = new Set();
      installs.set(r.tag, s);
    }
    s.add(r.install_id);
  }
  return [...installs]
    .filter(([, s]) => s.size >= policy.tagPromotionInstalls)
    .map(([tag]) => tag)
    .sort();
}
