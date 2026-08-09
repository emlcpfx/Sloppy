/**
 * Cloudflare Worker + D1.
 *
 * Three routes and a cron. The whole design is shaped by one rule from the
 * plan: NO PER-POST QUERIES. The client pulls the entire snapshot on a timer
 * and matches locally, so this Worker is never asked about a specific post -
 * which is what makes "we cannot know which posts you looked at" a structural
 * property rather than a promise.
 *
 * The snapshot is edge-cached, so most read traffic never reaches the Worker at
 * all and the free tier goes a very long way.
 */

import {
  CANONICAL_TAGS,
  DEFAULT_STAMP_BITS,
  MAX_STAMP_BITS,
  normalizeTag,
  SITE_IDS,
  verifyStamp,
  type SiteId,
  type Snapshot,
} from '@sloppy/core';
import { zRuleset, zTagRequest } from '@sloppy/core/schema';
import RULES from '@sloppy/ruleset/rules.json' with { type: 'json' };
import { DEFAULT_ROLLUP, promotableTags, rollupAuthors, rollupPosts, type TagRow } from './rollup.ts';

export interface Env {
  DB: D1Database;
  /** Optional: a comma-separated allowlist. Empty means any origin. */
  ALLOWED_ORIGINS?: string;
  /** Proof-of-work difficulty required on writes. Raise it if abused. */
  STAMP_BITS?: string;
}

/**
 * Difficulty required on writes, advertised in the snapshot so clients can pick
 * up a change without a store resubmission. Clamped, because a typo here would
 * otherwise either disable the defence or make tagging impossible.
 */
function requiredStampBits(env: Env): number {
  const configured = Number(env.STAMP_BITS ?? '');
  if (!Number.isInteger(configured) || configured < 1) return DEFAULT_STAMP_BITS;
  return Math.min(configured, MAX_STAMP_BITS);
}

/** Matches the snapshot's own freshness. A stale-by-15-minutes list is fine. */
const EDGE_CACHE_SECONDS = 900;
const SNAPSHOT_WINDOW_DAYS = 14;
/** Per install, per hour. Generous for a human, useless for a script. */
const RATE_LIMIT = 300;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return preflight(request, env);

    try {
      if (url.pathname === '/tag' && request.method === 'POST') return await handleTag(request, env);
      if (url.pathname === '/snapshot' && request.method === 'GET') return await handleSnapshot(url, env);
      if (url.pathname === '/ruleset' && request.method === 'GET') return handleRuleset(request, env);
      if (url.pathname === '/health') return json({ ok: true }, request, env);
      return json({ error: 'not found' }, request, env, 404);
    } catch (err) {
      console.error(err);
      return json({ error: 'internal error' }, request, env, 500);
    }
  },

  /** Rebuild the author list on the rolling window. Wire to a cron trigger. */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await rebuildAuthors(env);
  },
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async function handleTag(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null);
  const parsed = zTagRequest.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid tag', detail: parsed.error.issues[0]?.message }, request, env, 400);
  }
  const t = parsed.data;

  /**
   * PROOF OF WORK FIRST, before touching the database.
   *
   * `installId` is a UUID the client picks, so the rate limit below constrains
   * honest clients and nobody else - minting a new UUID resets it. The stamp is
   * what makes a report cost something, and it is bound to this specific post
   * so it cannot be minted once and replayed across thousands of targets.
   *
   * Checked before the rate-limit query so that unstamped junk costs us a hash
   * rather than a D1 read. See docs/TRUST.md.
   */
  const stampBits = requiredStampBits(env);
  const failure = verifyStamp(
    request.headers.get('x-sloppy-stamp') ?? '',
    { installId: t.installId, site: t.site, postId: t.postId },
    stampBits,
  );
  if (failure) {
    return json({ error: 'invalid stamp', reason: failure, stampBits }, request, env, 400);
  }

  if (await overRateLimit(env, t.installId)) {
    return json({ error: 'rate limited' }, request, env, 429);
  }

  /**
   * Normalise ON WRITE, not on read. Do it here once and you never end up with
   * five unsubscribable spellings of "AI slop" in the taxonomy; do it on read
   * and every consumer has to remember to.
   */
  const normalized = normalizeTag(t.tag);
  if (!normalized) return json({ error: 'empty tag' }, request, env, 400);

  await env.DB.prepare(
    `INSERT INTO tags (post_id, author_id, author_kind, site, tag, install_id, text_hash, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (post_id, install_id, tag) DO NOTHING`,
  )
    .bind(
      t.postId,
      t.authorId,
      t.authorKind,
      t.site,
      normalized.tag,
      t.installId,
      t.textHash,
      Date.now(),
    )
    .run();

  return json({ ok: true, tag: normalized.tag }, request, env);
}

async function handleSnapshot(url: URL, env: Env): Promise<Response> {
  const site = url.searchParams.get('site');
  if (!isSiteId(site)) return new Response(JSON.stringify({ error: 'unknown site' }), { status: 400 });

  const cutoff = Date.now() - SNAPSHOT_WINDOW_DAYS * 86_400_000;

  const { results } = await env.DB.prepare(
    `SELECT post_id, author_id, author_kind, site, tag, install_id, ts
       FROM tags WHERE site = ? AND ts >= ? ORDER BY post_id`,
  )
    .bind(site, cutoff)
    .all<TagRow>();

  const rows = results ?? [];
  const publicTags = new Set([...CANONICAL_TAGS, ...promotableTags(rows, CANONICAL_TAGS)]);

  /**
   * `authors` now contains ONLY entries a human approved.
   *
   * The cron writes candidates to `author_candidates` and never to this table.
   * Promoting an author hides everything they post for everyone subscribed to
   * that tag, which is the one thing in this system that can damage a person's
   * livelihood - so it does not happen because a counter crossed a threshold.
   * See docs/TRUST.md and docs/APPEALS.md.
   */
  const authorRows = await env.DB.prepare(
    `SELECT author_id AS id, kind, tag, flagged_posts AS flaggedPosts, distinct_reporters AS reporters
       FROM authors WHERE site = ? AND approved_at IS NOT NULL`,
  )
    .bind(site)
    .all<{ id: string; kind: string; tag: string; flaggedPosts: number; reporters: number }>();

  const snapshot: Snapshot = {
    site,
    generatedAt: Date.now(),
    rulesVersion: (RULES as { version: number }).version,
    stampBits: requiredStampBits(env),
    // A coined tag stays private to its author until enough installs use it.
    posts: rollupPosts(rows).filter((p) => publicTags.has(p.tag)),
    authors: (authorRows.results ?? []).map((a) => ({
      id: a.id,
      kind: a.kind as Snapshot['authors'][number]['kind'],
      tag: a.tag,
      flaggedPosts: a.flaggedPosts,
      reporters: a.reporters,
    })),
  };

  const headers = new Headers({
    'content-type': 'application/json',
    // Most reads should die at the edge and never bill a Worker invocation.
    'cache-control': `public, max-age=60, s-maxage=${EDGE_CACHE_SECONDS}`,
    'access-control-allow-origin': '*',
  });

  // THE URL CARRIES NOTHING A CALLER CAN VARY except the site.
  //
  // There used to be a `since` parameter. It was accepted, echoed back in a
  // header, and never used to filter anything - the payload is always complete,
  // because a delta protocol would need tombstones for un-tagged posts and a
  // list this size does not justify that. What it did do was vary the URL, and
  // the URL is the edge cache key: anyone could bypass the cache and force this
  // whole rollup to run at the origin, once per request, for free.
  return new Response(JSON.stringify(snapshot), { headers });
}

/**
 * The ruleset is served as DATA, interpreted by code that already shipped.
 * That is what keeps it on the right side of MV3's remote-code rule - and every
 * pattern in it has already been through the CI grammar and ReDoS gate before
 * it could reach this file.
 */
function handleRuleset(request: Request, env: Env): Response {
  const parsed = zRuleset.safeParse(RULES);
  if (!parsed.success) return json({ error: 'ruleset failed its own schema' }, request, env, 500);
  return json(parsed.data, request, env, 200, {
    'cache-control': `public, max-age=300, s-maxage=${EDGE_CACHE_SECONDS}`,
  });
}

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

/**
 * The cron proposes. A human disposes.
 *
 * This used to write straight into `authors`, which is the table the snapshot
 * serves - so crossing 5 posts from 2 reporters silenced somebody automatically.
 * With writes unauthenticated that was ten HTTP requests and two UUIDs; even
 * with the proof-of-work stamp it is minutes of CPU, which is not a bar worth
 * putting somebody's livelihood behind.
 *
 * So the rollup now only ever writes CANDIDATES. An operator reviews them with
 * `pnpm --filter @sloppy/api authors pending` and approves or rejects. Rejections
 * are remembered, or the same name would resurface every single night.
 */
async function rebuildAuthors(env: Env): Promise<void> {
  const now = Date.now();
  const cutoff = now - DEFAULT_ROLLUP.windowDays * 86_400_000;

  for (const site of SITE_IDS) {
    const { results } = await env.DB.prepare(
      `SELECT post_id, author_id, author_kind, site, tag, install_id, ts
         FROM tags WHERE site = ? AND ts >= ? AND author_id IS NOT NULL`,
    )
      .bind(site, cutoff)
      .all<TagRow>();

    const candidates = rollupAuthors(results ?? [], DEFAULT_ROLLUP, now);

    // Rebuild the candidate list rather than upserting it: an author who has
    // aged out of the window must LEAVE, and an incremental update quietly
    // never removes anybody. Decisions live in their own table and survive.
    const statements = [
      env.DB.prepare('DELETE FROM author_candidates WHERE site = ?').bind(site),
      ...candidates.map((a) =>
        env.DB.prepare(
          `INSERT INTO author_candidates
             (author_id, site, kind, tag, flagged_posts, distinct_reporters, window_end)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(a.id, site, a.kind, a.tag, a.flaggedPosts, a.reporters, now),
      ),
      // Keep the approved rows' counts current, but never add or remove one.
      ...candidates.map((a) =>
        env.DB.prepare(
          `UPDATE authors SET flagged_posts = ?, distinct_reporters = ?, tag = ?, window_end = ?
             WHERE author_id = ? AND site = ? AND approved_at IS NOT NULL`,
        ).bind(a.flaggedPosts, a.reporters, a.tag, now, a.id, site),
      ),
    ];

    await env.DB.batch(statements);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSiteId(v: string | null): v is SiteId {
  return v !== null && (SITE_IDS as readonly string[]).includes(v);
}

async function overRateLimit(env: Env, installId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM tags WHERE install_id = ? AND ts >= ?')
    .bind(installId, Date.now() - 3_600_000)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= RATE_LIMIT;
}

/**
 * CORS is REQUIRED here, not optional politeness.
 *
 * The extension's background worker fetches this from an origin the user
 * configures, so it cannot be covered by a static host_permissions entry -
 * which means the request is a genuine cross-origin fetch subject to CORS.
 * Without these headers every sync fails with an opaque network error.
 */
function corsHeaders(request: Request, env: Env): Record<string, string> {
  const allow = (env.ALLOWED_ORIGINS ?? '').trim();
  const origin = request.headers.get('origin') ?? '*';
  const allowed = allow === '' ? '*' : allow.split(',').includes(origin) ? origin : 'null';
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  };
}

function preflight(request: Request, env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

function json(
  body: unknown,
  request: Request,
  env: Env,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(request, env), ...extra },
  });
}
