/**
 * Shared vocabulary for every layer of Sloppy.
 *
 * This module is deliberately dependency-free and DOM-free. Anything that
 * needs `document`, `chrome.*` or `fetch` belongs in the extension or an
 * adapter, never here.
 */

/**
 * The site list is the source of truth and the type is derived from it, not the
 * other way round. Declaring the union separately meant the schema had to cast
 * `SITE_IDS` to a loose string tuple, and every value parsed out of the wire
 * came back as `string` - so a `SiteId` parameter would silently accept "".
 */
export const SITE_IDS = ['linkedin', 'reddit'] as const;

export type SiteId = (typeof SITE_IDS)[number];

export type MediaKind = 'image' | 'video' | 'document' | 'link';

export interface MediaRef {
  kind: MediaKind;
  /** Intrinsic width in px, when the DOM exposes it. */
  w?: number;
  h?: number;
  /** LinkedIn renders a Content Credentials marker on C2PA-signed media. */
  hasC2PABadge?: boolean;
  src?: string;
}

/**
 * `/company/` posts and `/in/` posts want different author thresholds: a studio
 * account posting daily hits five flags far faster than an individual, and
 * that is usually correct rather than a false positive.
 */
export type AuthorKind = 'person' | 'org' | 'unknown';

export interface PostFeatures {
  site: SiteId;
  /**
   * Canonical id first, then any nested reshare originals. A hit on *any* of
   * these collapses the post - otherwise the same slop walks past every time
   * somebody amplifies it.
   */
  postIds: string[];
  authorId: string | null;
  authorKind: AuthorKind;
  /** Hashtag block already stripped; see `stripTrailingHashtags`. */
  text: string;
  media: MediaRef[];
}

export type Verdict =
  | { action: 'show' }
  | { action: 'collapse'; reason: string; source: 'post' | 'author' | 'rule' };

export const SHOW: Verdict = { action: 'show' };

export interface TagEvent {
  site: SiteId;
  postId: string;
  authorId: string | null;
  authorKind: AuthorKind;
  tag: string;
  /** Non-reversible digest of the post text, for offline rule mining. */
  textHash: string;
  ts: number;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface SnapshotPost {
  id: string;
  /** Winning canonical tag, used verbatim in the collapse stub. */
  tag: string;
  /** Distinct installs that tagged it. */
  n: number;
}

export interface SnapshotAuthor {
  id: string;
  kind: AuthorKind;
  tag: string;
  flaggedPosts: number;
  reporters: number;
}

export interface Snapshot {
  site: SiteId;
  /** Epoch ms the rollup was built. */
  generatedAt: number;
  rulesVersion: number;
  posts: SnapshotPost[];
  authors: SnapshotAuthor[];
  /** Proof-of-work difficulty this server requires on writes. */
  stampBits?: number;
}

export function emptySnapshot(site: SiteId): Snapshot {
  return { site, generatedAt: 0, rulesVersion: 0, posts: [], authors: [] };
}

/**
 * Maps built once per snapshot load. `decide()` runs on every post in a feed,
 * so it must never do a linear scan.
 */
export interface SnapshotIndex {
  site: SiteId;
  posts: Map<string, SnapshotPost>;
  authors: Map<string, SnapshotAuthor>;
  generatedAt: number;
}

export function indexSnapshot(snap: Snapshot): SnapshotIndex {
  return {
    site: snap.site,
    generatedAt: snap.generatedAt,
    posts: new Map(snap.posts.map((p) => [p.id, p])),
    authors: new Map(snap.authors.map((a) => [a.id, a])),
  };
}

// ---------------------------------------------------------------------------
// Preferences and per-adapter policy
// ---------------------------------------------------------------------------

export interface Prefs {
  enabled: boolean;
  sites: Record<SiteId, boolean>;
  /** Empty means "every canonical tag". */
  subscribedTags: string[];
  /** Rules-engine aggressiveness. Lower hides more. */
  threshold: number;
  rulesEnabled: boolean;
}

export function defaultPrefs(): Prefs {
  return {
    enabled: true,
    sites: { linkedin: true, reddit: true },
    subscribedTags: [],
    threshold: 5,
    rulesEnabled: true,
  };
}

/**
 * Propagation is a per-site property, not a constant.
 *
 * LinkedIn feeds are personalised, so overlap between two users is low and a
 * single tag has to propagate or the post has decayed before consensus is
 * reached. Reddit shows everyone the same objects, so consensus is actually
 * reachable and a threshold of 1 would hand one user too much reach.
 */
export interface AdapterPolicy {
  postHideThreshold: number;
  authorPosts: number;
  authorReporters: number;
  windowDays: number;
}

export const DEFAULT_POLICY: AdapterPolicy = {
  postHideThreshold: 1,
  authorPosts: 5,
  authorReporters: 2,
  windowDays: 90,
};
