/**
 * Proof-of-work stamps on writes.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS: a report has to cost something.
 * ---------------------------------------------------------------------------
 *
 * `installId` is a UUID the client generates, so every threshold in the design
 * was a formality - the per-install rate limit is bypassed by minting a new
 * UUID, and on LinkedIn a single unauthenticated request hides a post for
 * everyone. See docs/TRUST.md.
 *
 * Raising the thresholds does not fix that. It costs an attacker one more UUID
 * per increment and makes the feature useless for a real community of thirty
 * people; it hurts only the honest side. The problem is not the numbers, it is
 * that manufacturing a report is free.
 *
 * A stamp is bound to the SPECIFIC post being tagged, so it cannot be minted
 * once and replayed across thousands of targets - each tag pays its own work.
 * At 16 bits that is around 65,000 hashes, a couple of hundred milliseconds,
 * which is nothing for someone clicking a button and roughly twenty minutes of
 * a single core for someone wanting ten thousand fake reports.
 *
 * WHAT THIS IS NOT: it is not proof of humanity, and it does not stop somebody
 * determined with a GPU. It converts "free" into "measurable", which is the
 * step that matters at community scale. The part that can actually damage a
 * person - promoting an author, and so hiding everything they post - is not
 * defended by this at all; it is gated on a human. Both, together.
 */

import { leadingZeroBits, sha256 } from './sha256.ts';
import type { SiteId } from './types.ts';

/**
 * Default difficulty, in leading zero bits of the digest.
 *
 * Servers may require more. The required value rides along in the snapshot, so
 * it can be raised without a store resubmission - the same "data over releases"
 * principle as the ruleset.
 */
export const DEFAULT_STAMP_BITS = 16;

/** Widest difficulty a client will attempt, so a hostile snapshot cannot wedge it. */
export const MAX_STAMP_BITS = 24;

/**
 * How long a stamp stays valid. Coarse buckets mean the server holds no state:
 * it recomputes the preimage for the current and previous bucket and checks the
 * work, so there is nothing to store and nothing to expire.
 */
export const STAMP_BUCKET_MS = 10 * 60 * 1000;

const encoder = new TextEncoder();

export interface StampInput {
  installId: string;
  site: SiteId;
  postId: string;
}

function preimage(input: StampInput, bucket: number, nonce: number): Uint8Array {
  return encoder.encode(`${input.installId}:${input.site}:${input.postId}:${bucket}:${nonce}`);
}

export function bucketFor(now: number): number {
  return Math.floor(now / STAMP_BUCKET_MS);
}

export interface Stamp {
  bucket: number;
  nonce: number;
  bits: number;
}

export function encodeStamp(s: Stamp): string {
  return `v1.${s.bucket}.${s.nonce}.${s.bits}`;
}

export function decodeStamp(raw: string): Stamp | null {
  const parts = raw.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const [bucket, nonce, bits] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![bucket, nonce, bits].every((n) => Number.isInteger(n) && n >= 0)) return null;
  return { bucket, nonce, bits };
}

/**
 * Mine a stamp. Synchronous and CPU-bound by design.
 *
 * Called from the background worker while draining the outbound queue, never
 * from a content script - the feed must not stutter because somebody clicked
 * the splat. `maxIterations` bounds the worst case so a bad difficulty cannot
 * spin forever; returning null is a normal outcome the caller must handle.
 */
export function mintStamp(
  input: StampInput,
  bits = DEFAULT_STAMP_BITS,
  now = Date.now(),
  maxIterations = 20_000_000,
): Stamp | null {
  const difficulty = Math.min(Math.max(1, Math.floor(bits)), MAX_STAMP_BITS);
  const bucket = bucketFor(now);

  for (let nonce = 0; nonce < maxIterations; nonce++) {
    if (leadingZeroBits(sha256(preimage(input, bucket, nonce))) >= difficulty) {
      return { bucket, nonce, bits: difficulty };
    }
  }
  return null;
}

export type StampFailure =
  | 'malformed'
  | 'stale'
  | 'from-the-future'
  | 'too-easy'
  | 'insufficient-work';

/**
 * Verify a stamp. One hash, no stored state.
 *
 * The bucket window accepts the current and previous bucket, which tolerates
 * clock skew and queue latency without letting a stamp be replayed for a day.
 */
export function verifyStamp(
  raw: string,
  input: StampInput,
  requiredBits = DEFAULT_STAMP_BITS,
  now = Date.now(),
): StampFailure | null {
  const stamp = decodeStamp(raw);
  if (!stamp) return 'malformed';

  // The claimed difficulty must meet the server's bar. Checked before the hash
  // so a client cannot claim 1 bit and get in on a lucky digest.
  if (stamp.bits < requiredBits) return 'too-easy';

  const current = bucketFor(now);
  if (stamp.bucket > current) return 'from-the-future';
  if (stamp.bucket < current - 1) return 'stale';

  const actual = leadingZeroBits(sha256(preimage(input, stamp.bucket, stamp.nonce)));
  if (actual < requiredBits) return 'insufficient-work';

  return null;
}
