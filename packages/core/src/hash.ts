/**
 * A lossy 64-bit fingerprint of post text.
 *
 * Deliberately NOT a cryptographic hash and not described as one anywhere
 * user-facing. Its job is to let the server notice that the same body has been
 * posted by many different accounts - the repost / karma-farm signal - without
 * the server ever receiving the text itself.
 *
 * It is a one-way *lossy* mapping: 64 bits cannot reconstruct a paragraph. It
 * is not resistant to a dictionary attack against a known candidate text, so
 * never fingerprint anything that isn't already public on the page.
 */

const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/** Whitespace and case folded, so trivial edits still collide. */
export function normalizeForFingerprint(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function fingerprint(text: string): string {
  const bytes = new TextEncoder().encode(normalizeForFingerprint(text));
  let h = OFFSET;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * PRIME) & MASK;
  }
  return h.toString(16).padStart(16, '0');
}
