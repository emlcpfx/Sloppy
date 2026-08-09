import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { leadingZeroBits, sha256, sha256Hex } from './sha256.ts';
import {
  DEFAULT_STAMP_BITS,
  MAX_STAMP_BITS,
  STAMP_BUCKET_MS,
  decodeStamp,
  encodeStamp,
  mintStamp,
  verifyStamp,
} from './stamp.ts';
import type { StampInput } from './stamp.ts';

// ---------------------------------------------------------------------------
// The hash has to actually be SHA-256
// ---------------------------------------------------------------------------

test('matches the NIST vectors', () => {
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test('agrees with node crypto across lengths and block boundaries', () => {
  // 55/56/63/64/65 are the padding edge cases that a hand-written SHA-256 gets
  // wrong, so they are all covered explicitly.
  for (const len of [0, 1, 55, 56, 63, 64, 65, 127, 128, 129, 1000]) {
    const bytes = randomBytes(len);
    const expected = createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha256Hex(new Uint8Array(bytes)), expected, `length ${len}`);
  }
});

test('leadingZeroBits counts bits, not bytes', () => {
  assert.equal(leadingZeroBits(new Uint8Array([0xff])), 0);
  assert.equal(leadingZeroBits(new Uint8Array([0x7f])), 1);
  assert.equal(leadingZeroBits(new Uint8Array([0x01])), 7);
  assert.equal(leadingZeroBits(new Uint8Array([0x00, 0xff])), 8);
  assert.equal(leadingZeroBits(new Uint8Array([0x00, 0x01])), 15);
  assert.equal(leadingZeroBits(new Uint8Array([0x00, 0x00, 0x00, 0x00])), 32);
});

// ---------------------------------------------------------------------------
// Stamps
// ---------------------------------------------------------------------------

const NOW = 1_800_000_000_000;
const input: StampInput = {
  installId: '11111111-2222-3333-4444-555555555555',
  site: 'linkedin',
  postId: 'urn:li:activity:1111111111111111111',
};

test('a freshly minted stamp verifies', () => {
  const stamp = mintStamp(input, 12, NOW);
  assert.ok(stamp);
  assert.equal(verifyStamp(encodeStamp(stamp), input, 12, NOW), null);
});

test('a stamp is bound to the post, so it cannot be replayed across targets', () => {
  // This is the property that makes the work per-report rather than per-attacker.
  const stamp = mintStamp(input, 12, NOW);
  assert.ok(stamp);
  const elsewhere = { ...input, postId: 'urn:li:activity:9999999999999999999' };
  assert.equal(verifyStamp(encodeStamp(stamp), elsewhere, 12, NOW), 'insufficient-work');
});

test('a stamp is bound to the install and the site', () => {
  const stamp = mintStamp(input, 12, NOW);
  assert.ok(stamp);
  assert.equal(
    verifyStamp(encodeStamp(stamp), { ...input, installId: 'someone-else' }, 12, NOW),
    'insufficient-work',
  );
  assert.equal(verifyStamp(encodeStamp(stamp), { ...input, site: 'reddit' }, 12, NOW), 'insufficient-work');
});

test('claiming a difficulty you did not do is rejected', () => {
  const stamp = mintStamp(input, 8, NOW);
  assert.ok(stamp);
  // Honest stamp, but the server wants more work than it represents.
  assert.equal(verifyStamp(encodeStamp(stamp), input, 16, NOW), 'too-easy');

  // And lying about the difficulty in the encoding does not help: the hash is
  // still checked against what the server requires.
  const liar = encodeStamp({ ...stamp, bits: 24 });
  assert.equal(verifyStamp(liar, input, 16, NOW), 'insufficient-work');
});

test('stamps expire, and cannot be dated forward', () => {
  const stamp = mintStamp(input, 12, NOW);
  assert.ok(stamp);
  const encoded = encodeStamp(stamp);

  // Still good one bucket later - covers clock skew and queue latency.
  assert.equal(verifyStamp(encoded, input, 12, NOW + STAMP_BUCKET_MS), null);
  // Two buckets later it is stale.
  assert.equal(verifyStamp(encoded, input, 12, NOW + 2 * STAMP_BUCKET_MS), 'stale');
  // And a stamp minted for a future bucket is refused rather than banked.
  assert.equal(verifyStamp(encoded, input, 12, NOW - 2 * STAMP_BUCKET_MS), 'from-the-future');
});

test('malformed stamps are refused without hashing anything', () => {
  for (const bad of ['', 'nonsense', 'v2.1.2.3', 'v1.a.b.c', 'v1.1.2', 'v1.-1.2.3']) {
    assert.equal(verifyStamp(bad, input, 12, NOW), 'malformed', bad);
  }
});

test('difficulty is clamped, so a hostile snapshot cannot wedge the miner', () => {
  const stamp = mintStamp(input, 999, NOW, 1);
  // Either it fails to find one within the iteration bound (null), or the
  // difficulty it claims is clamped - never 999.
  if (stamp) assert.ok(stamp.bits <= MAX_STAMP_BITS);
});

test('mining is bounded and reports failure rather than spinning', () => {
  assert.equal(mintStamp(input, 24, NOW, 10), null);
});

test('the default difficulty costs something, but not much', () => {
  const t0 = performance.now();
  const stamp = mintStamp(input, DEFAULT_STAMP_BITS, NOW);
  const ms = performance.now() - t0;
  assert.ok(stamp, 'a stamp should be findable at the default difficulty');
  // Deliberately loose - this is a smoke test that the default has not been set
  // to something that would make tagging feel broken, not a benchmark.
  assert.ok(ms < 10_000, `minting took ${ms.toFixed(0)}ms at ${DEFAULT_STAMP_BITS} bits`);
  console.log(`[stamp] ${DEFAULT_STAMP_BITS} bits took ${ms.toFixed(0)}ms, nonce ${stamp!.nonce}`);
});

test('encode and decode round-trip', () => {
  const s = { bucket: 12345, nonce: 678, bits: 16 };
  assert.deepEqual(decodeStamp(encodeStamp(s)), s);
});
