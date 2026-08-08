/**
 * All persisted state, and the merge that makes P0 work with no server at all.
 *
 * THE LOCAL LIST IS NOT A CACHE OF THE REMOTE ONE. Tagging a post writes it to
 * a local list immediately, and that list is merged over the fetched snapshot
 * every time a verdict is computed. That is what lets the whole product run
 * with sync switched off - which is the launch state, because a thing nobody
 * enjoys using locally will not get better by adding a server to it.
 */

import {
  defaultPrefs,
  emptySnapshot,
  indexSnapshot,
  type Prefs,
  type SiteId,
  type Snapshot,
  type SnapshotIndex,
  type SnapshotPost,
  type TagEvent,
} from '@sloppy/core';
import { EMPTY_RULESET, type Ruleset } from '@sloppy/core';
import { newInstallId, read, readSynced, write, writeSynced } from './browser.ts';

export const KEYS = {
  prefs: 'prefs',
  installId: 'installId',
  settings: 'settings',
  ruleset: 'ruleset',
  queue: 'queue',
  stats: 'stats',
  /** Unhide clicks. The only negative-label source there is. */
  negatives: 'negatives',
  snapshot: (site: SiteId) => `snapshot:${site}`,
  localTags: (site: SiteId) => `localTags:${site}`,
  health: (site: SiteId) => `health:${site}`,
} as const;

export interface Settings {
  /** Empty means local-only: nothing is ever sent anywhere. */
  apiBase: string;
  syncEnabled: boolean;
  /** Minutes between snapshot pulls. The alarm floor is 1; the plan says daily. */
  syncIntervalMinutes: number;
}

export function defaultSettings(): Settings {
  return { apiBase: '', syncEnabled: false, syncIntervalMinutes: 60 * 24 };
}

export interface Stats {
  collapsed: number;
  unhidden: number;
  tagged: number;
}

export interface Health {
  site: SiteId;
  checkedAt: number;
  feedFound: boolean;
  postCount: number;
  /** Which selector branch answered, per chain. */
  diagnostics: Record<string, string>;
}

/** A tag this install made. Local hides are immediate and never wait on sync. */
export interface LocalTag {
  postId: string;
  authorId: string | null;
  tag: string;
  ts: number;
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export const loadPrefs = () => readSynced<Prefs>(KEYS.prefs, defaultPrefs());
export const savePrefs = (p: Prefs) => writeSynced(KEYS.prefs, p);

export const loadSettings = () => readSynced<Settings>(KEYS.settings, defaultSettings());
export const saveSettings = (s: Settings) => writeSynced(KEYS.settings, s);

export const loadRuleset = () => read<Ruleset>('local', KEYS.ruleset, EMPTY_RULESET);
export const saveRuleset = (r: Ruleset) => write('local', KEYS.ruleset, r);

export const loadSnapshot = (site: SiteId) =>
  read<Snapshot>('local', KEYS.snapshot(site), emptySnapshot(site));
export const saveSnapshot = (site: SiteId, s: Snapshot) => write('local', KEYS.snapshot(site), s);

export const loadLocalTags = (site: SiteId) => read<LocalTag[]>('local', KEYS.localTags(site), []);
export const loadStats = () => read<Stats>('local', KEYS.stats, { collapsed: 0, unhidden: 0, tagged: 0 });
export const loadHealth = (site: SiteId) => read<Health | null>('local', KEYS.health(site), null);
export const saveHealth = (h: Health) => write('local', KEYS.health(h.site), h);

export async function installId(): Promise<string> {
  const existing = await readSynced<string>(KEYS.installId, '');
  if (existing) return existing;
  const fresh = newInstallId();
  await writeSynced(KEYS.installId, fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

/**
 * Record a tag locally, immediately.
 *
 * Deduped per (post, tag) so double-clicking the same chip does not inflate the
 * count that the hide threshold is compared against.
 */
export async function addLocalTag(site: SiteId, tag: LocalTag): Promise<void> {
  const tags = await loadLocalTags(site);
  if (tags.some((t) => t.postId === tag.postId && t.tag === tag.tag)) return;
  tags.push(tag);
  await write('local', KEYS.localTags(site), tags);
  await bumpStat('tagged');
}

export async function removeLocalTagsFor(site: SiteId, postIds: readonly string[]): Promise<void> {
  const tags = await loadLocalTags(site);
  const kept = tags.filter((t) => !postIds.includes(t.postId));
  if (kept.length !== tags.length) await write('local', KEYS.localTags(site), kept);
}

export async function bumpStat(key: keyof Stats, by = 1): Promise<void> {
  const stats = await loadStats();
  stats[key] += by;
  await write('local', KEYS.stats, stats);
}

/**
 * "Collapse, don't delete" is what makes this possible: every unhide is a human
 * saying "you were wrong about this one". Stored locally and never transmitted -
 * it is the corpus for tuning weights later, not telemetry.
 */
export async function recordUnhide(site: SiteId, postId: string, reason: string): Promise<void> {
  const negatives = await read<{ site: SiteId; postId: string; reason: string; ts: number }[]>(
    'local',
    KEYS.negatives,
    [],
  );
  negatives.push({ site, postId, reason, ts: Date.now() });
  // Bounded: this is a rolling sample, not an archive.
  await write('local', KEYS.negatives, negatives.slice(-500));
  await bumpStat('unhidden');
}

// ---------------------------------------------------------------------------
// The merge
// ---------------------------------------------------------------------------

/**
 * Remote snapshot + this install's own tags, as one index.
 *
 * A local tag counts as `n` at least the site's hide threshold, so your own tag
 * always hides the post for you even where the site's policy waits for three
 * reporters. Consensus governs what OTHER people see; it has no business
 * overruling you about your own feed.
 */
export function mergeIndex(snapshot: Snapshot, local: readonly LocalTag[], hideThreshold: number): SnapshotIndex {
  const index = indexSnapshot(snapshot);
  for (const t of local) {
    const existing = index.posts.get(t.postId);
    const merged: SnapshotPost = existing
      ? { ...existing, n: Math.max(existing.n, hideThreshold) }
      : { id: t.postId, tag: t.tag, n: hideThreshold };
    index.posts.set(t.postId, merged);
  }
  return index;
}

export function toTagEvent(site: SiteId, t: LocalTag, textHash: string): TagEvent {
  return {
    site,
    postId: t.postId,
    authorId: t.authorId,
    authorKind: 'unknown',
    tag: t.tag,
    textHash,
    ts: t.ts,
  };
}
