/**
 * The only code that talks to a server, and it is optional.
 *
 * NO PER-POST REQUESTS, EVER. The client pulls the whole blocklist on a timer
 * and matches locally. That is what keeps feed rendering off the network - and,
 * more importantly, it means the server never learns which posts a given person
 * is looking at, because it is never asked about one.
 *
 * The only outbound traffic is a tag POST when somebody clicks the splat, and
 * the periodic snapshot pull.
 *
 * EVERY RESPONSE FROM THIS SERVER IS UNTRUSTED INPUT. The address is
 * user-configurable, so "our server" is not a thing this file can assume. A
 * response decides what a person does and does not see, and in the ruleset's
 * case it carries regular expressions that will be executed on every post in
 * their feed. Each fetch is therefore bounded in size, validated against a
 * schema, and - for the ruleset - put through the same safety analysis that
 * gates CI.
 */

import { DEFAULT_STAMP_BITS, encodeStamp, mintStamp, sanitizeRuleset } from '@sloppy/core';
import { zRuleset, zSnapshot } from '@sloppy/core/schema';
import type { Ruleset, SiteId, Snapshot, TagEvent } from '@sloppy/core';

export class ApiError extends Error {}

const TIMEOUT_MS = 15_000;

/**
 * Response size caps.
 *
 * The schema caps the number of ENTRIES, but only after the whole body has been
 * buffered and parsed - which is far too late if the server sends a gigabyte.
 * These are enforced while reading, before any parsing happens.
 */
const MAX_SNAPSHOT_BYTES = 6_000_000;
const MAX_RULESET_BYTES = 256_000;

/**
 * The API address is typed in by a person, so it gets validated like any other
 * untrusted input.
 *
 * HTTPS or nothing. Over plain http an on-path attacker can read every tag and,
 * worse, substitute the ruleset and the blocklist - deciding what somebody sees
 * and what code runs against their feed. Loopback is the one exception, because
 * `wrangler dev` serves http on localhost and that traffic never leaves the
 * machine.
 */
export function normalizeApiBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) throw new ApiError('no API address configured');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ApiError(`not a valid URL: ${trimmed}`);
  }

  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol === 'https:') return trimmed;
  if (url.protocol === 'http:' && loopback) return trimmed;

  throw new ApiError(
    url.protocol === 'http:'
      ? 'the API address must use https - http can be read and rewritten in transit'
      : `unsupported scheme: ${url.protocol}`,
  );
}

/** True if this address is safe to use. For the options page. */
export function isValidApiBase(raw: string): boolean {
  try {
    normalizeApiBase(raw);
    return true;
  } catch {
    return false;
  }
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal, credentials: 'omit' });
    if (!res.ok) throw new ApiError(`${res.status} ${res.statusText}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a JSON body, refusing to buffer more than `maxBytes`.
 *
 * `content-length` is checked first as a cheap rejection, but it is advisory and
 * may be absent on a chunked response - so the stream is counted as it arrives
 * and cancelled the moment it goes over. Without this, `res.json()` happily
 * buffers whatever the server feels like sending.
 */
async function readJsonCapped(res: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(`response too large: ${declared} bytes, cap is ${maxBytes}`);
  }

  if (!res.body) {
    const text = await res.text();
    if (text.length > maxBytes) throw new ApiError(`response too large, cap is ${maxBytes}`);
    return JSON.parse(text);
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError(`response too large: over ${maxBytes} bytes`);
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    joined.set(c, at);
    at += c.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(joined));
}

function base(apiBase: string): string {
  return normalizeApiBase(apiBase);
}

/**
 * Fetch and VALIDATE.
 *
 * Note the absence of a `since` parameter. It used to be sent and then ignored
 * for filtering - the payload was always complete - which meant it did nothing
 * except vary the URL. A varying URL is a varying edge-cache key, so it handed
 * anyone a free way to bypass the cache and force origin work on every request.
 */
export async function fetchSnapshot(apiBase: string, site: SiteId): Promise<Snapshot> {
  const url = `${base(apiBase)}/snapshot?site=${encodeURIComponent(site)}`;
  const res = await request(url);
  const parsed = zSnapshot.safeParse(await readJsonCapped(res, MAX_SNAPSHOT_BYTES));
  if (!parsed.success) throw new ApiError(`snapshot failed validation: ${parsed.error.issues[0]?.message}`);
  return parsed.data as Snapshot;
}

export interface FetchedRuleset {
  ruleset: Ruleset;
  /** Features the runtime safety gate refused. Empty is the normal case. */
  dropped: { id: string; problems: { code: string; message: string }[] }[];
}

/**
 * Fetch, validate, and then RUN THE SAFETY GATE.
 *
 * The schema alone is not enough. It checks that a pattern is a string of at
 * most 300 characters with sane flags - it says nothing about whether that
 * string is `(a+)+$`, which compiles perfectly and then hangs the tab it runs
 * in. The CI gate catches those in this repository's own rules.json, and this
 * repository's rules.json is not what a user executes: the ruleset arrives over
 * the network, from an address they typed in.
 *
 * Unsafe features are DROPPED rather than the whole ruleset rejected, so one
 * bad rule cannot switch filtering off wholesale.
 */
export async function fetchRuleset(apiBase: string): Promise<FetchedRuleset> {
  const res = await request(`${base(apiBase)}/ruleset`);
  const parsed = zRuleset.safeParse(await readJsonCapped(res, MAX_RULESET_BYTES));
  if (!parsed.success) throw new ApiError(`ruleset failed validation: ${parsed.error.issues[0]?.message}`);

  const { ruleset, dropped } = sanitizeRuleset(parsed.data as Ruleset);
  if (dropped.length > 0) {
    console.warn(
      `[sloppy] dropped ${dropped.length} unsafe rule(s) from the fetched ruleset:`,
      dropped.map((d) => `${d.id}: ${d.problems.map((p) => p.code).join(', ')}`).join('; '),
    );
  }
  return { ruleset, dropped };
}

/**
 * Send one tag, with a proof-of-work stamp.
 *
 * MINTING IS SYNCHRONOUS AND CPU-BOUND, which is exactly why this is only ever
 * called from the background worker draining the outbound queue - never from a
 * content script. The feed must not stutter because somebody clicked the splat;
 * from their side the post is already hidden locally and the upload is
 * somebody else's problem.
 */
export async function postTag(
  apiBase: string,
  installId: string,
  event: TagEvent,
  stampBits = DEFAULT_STAMP_BITS,
): Promise<void> {
  const stamp = mintStamp({ installId, site: event.site, postId: event.postId }, stampBits);
  if (!stamp) throw new ApiError(`could not mint a stamp at ${stampBits} bits`);

  await request(`${base(apiBase)}/tag`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sloppy-stamp': encodeStamp(stamp) },
    body: JSON.stringify({
      site: event.site,
      postId: event.postId,
      authorId: event.authorId,
      authorKind: event.authorKind,
      tag: event.tag,
      textHash: event.textHash,
      installId,
    }),
  });
}
