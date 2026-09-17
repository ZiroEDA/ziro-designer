// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * MurmurHash3 x64_128, faithful port of KiCad's MMH3_HASH
 * (libs/kimath/include/mmh3_hash.h, itself based on Austin Appleby's
 * public-domain MurmurHash3) and HASH_128::ToString (hash_128.h): the digest
 * prints as %016X%016X, h1 then h2, uppercase hex.
 *
 * Two tail treatments exist upstream: the correct one (`addData`) and the
 * pre-fix `addDataV1`, which rounded the tail up to 4-byte alignment, counted
 * that padding in `len`, and zeroed only the padding bytes. Files saved with
 * the old hashes must still validate, so both digests are exposed.
 */

/**
 * The 64-bit lanes as (hi, lo) pairs of uint32: BigInt arithmetic allocates
 * per operation and made `IsTriangulationUpToDate`'s checksum of a zone
 * fill the cost of drawing it; these are the same operations on halves.
 */
const C1_HI = 0x87c37b91;
const C1_LO = 0x114253d5;
const C2_HI = 0x4cf5ad43;
const C2_LO = 0x2745937f;

// The results of an operation are handed back through these, to avoid an
// allocation per step.
let rHi = 0;
let rLo = 0;

/** (aHi:aLo) * (bHi:bLo) mod 2^64. */
function mul64(aHi: number, aLo: number, bHi: number, bLo: number): void {
  const a0 = aLo & 0xffff;
  const a1 = aLo >>> 16;
  const b0 = bLo & 0xffff;
  const b1 = bLo >>> 16;

  // low 32 bits of aLo * bLo, with carry into the high word
  const p00 = a0 * b0;
  const p01 = a0 * b1;
  const p10 = a1 * b0;
  const p11 = a1 * b1;

  let mid = (p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff);
  const lo = ((mid & 0xffff) << 16) | (p00 & 0xffff);
  mid = mid >>> 16;
  const carry = (p11 + (p01 >>> 16) + (p10 >>> 16) + mid) >>> 0;

  const hi = (carry + Math.imul(aHi, bLo) + Math.imul(aLo, bHi)) >>> 0;

  rHi = hi;
  rLo = lo >>> 0;
}

/** (aHi:aLo) + (bHi:bLo) mod 2^64. */
function add64(aHi: number, aLo: number, bHi: number, bLo: number): void {
  const lo = (aLo >>> 0) + (bLo >>> 0);
  rLo = lo >>> 0;
  rHi = (aHi + bHi + (lo > 0xffffffff ? 1 : 0)) >>> 0;
}

/** rotl64 by r (0 < r < 64). */
function rotl64(hi: number, lo: number, r: number): void {
  if (r >= 32) {
    const t = hi;
    hi = lo;
    lo = t;
    r -= 32;
  }

  if (r === 0) {
    rHi = hi >>> 0;
    rLo = lo >>> 0;
    return;
  }

  rHi = ((hi << r) | (lo >>> (32 - r))) >>> 0;
  rLo = ((lo << r) | (hi >>> (32 - r))) >>> 0;
}

/** fmix64. */
function fmix64(hi: number, lo: number): void {
  // k ^= k >> 33
  lo = (lo ^ (hi >>> 1)) >>> 0;
  // k *= 0xff51afd7ed558ccd
  mul64(hi, lo, 0xff51afd7, 0xed558ccd);
  hi = rHi;
  lo = rLo;
  lo = (lo ^ (hi >>> 1)) >>> 0;
  mul64(hi, lo, 0xc4ceb9fe, 0x1a85ec53);
  hi = rHi;
  lo = rLo;
  lo = (lo ^ (hi >>> 1)) >>> 0;
  rHi = hi;
  rLo = lo;
}

/** Little-endian uint32 read of 4 bytes at `off`. */
const word32 = (d: Uint8Array, off: number): number =>
  (d[off]! | (d[off + 1]! << 8) | (d[off + 2]! << 16) | (d[off + 3]! << 24)) >>> 0;

function mmh3_x64_128(data: Uint8Array, seed: number, v1Tail: boolean): { h1: bigint; h2: bigint } {
  let h1Hi = 0;
  let h1Lo = seed >>> 0;
  let h2Hi = 0;
  let h2Lo = seed >>> 0;

  const nblocks = Math.floor(data.length / 16);
  for (let i = 0; i < nblocks; i++) {
    let k1Lo = word32(data, i * 16);
    let k1Hi = word32(data, i * 16 + 4);
    let k2Lo = word32(data, i * 16 + 8);
    let k2Hi = word32(data, i * 16 + 12);

    mul64(k1Hi, k1Lo, C1_HI, C1_LO);
    rotl64(rHi, rLo, 31);
    mul64(rHi, rLo, C2_HI, C2_LO);
    k1Hi = rHi;
    k1Lo = rLo;
    h1Hi = (h1Hi ^ k1Hi) >>> 0;
    h1Lo = (h1Lo ^ k1Lo) >>> 0;

    rotl64(h1Hi, h1Lo, 27);
    add64(rHi, rLo, h2Hi, h2Lo);
    mul64(rHi, rLo, 0, 5);
    add64(rHi, rLo, 0, 0x52dce729);
    h1Hi = rHi;
    h1Lo = rLo;

    mul64(k2Hi, k2Lo, C2_HI, C2_LO);
    rotl64(rHi, rLo, 33);
    mul64(rHi, rLo, C1_HI, C1_LO);
    k2Hi = rHi;
    k2Lo = rLo;
    h2Hi = (h2Hi ^ k2Hi) >>> 0;
    h2Lo = (h2Lo ^ k2Lo) >>> 0;

    rotl64(h2Hi, h2Lo, 31);
    add64(rHi, rLo, h1Hi, h1Lo);
    mul64(rHi, rLo, 0, 5);
    add64(rHi, rLo, 0, 0x38495ab5);
    h2Hi = rHi;
    h2Lo = rLo;
  }

  const remaining = data.length - nblocks * 16;
  // The streaming class hashes the tail from its 16-byte block buffer. addData
  // zeroes the whole remainder; addDataV1 only zeroed up to 4-byte alignment
  // and counted the padding in len, for a single buffer the stale bytes
  // beyond the padding are zero too (fresh block), so only `len` differs.
  // V1's padding is 4 − ((remaining+4) % 4), never 0: a 4-aligned tail gains
  // 4 zero bytes, and a 12-byte tail pads len to a full block whose bytes then
  // vanish from the hash entirely (len & 15 == 0). That is the V1 bug.
  let len = nblocks * 16 + remaining;
  if (v1Tail && remaining > 0) len += 4 - ((remaining + 4) % 4);

  const tail = data.subarray(nblocks * 16);
  // hashTail switches on len & 15, with V1 padding this can shorten (or zero)
  // the tail bytes considered, exactly like the padded block upstream.
  const tailLen = len & 15;
  const t = (i: number): number => (i < tail.length ? tail[i]! : 0);

  if (tailLen >= 9) {
    let k2Hi = 0;
    let k2Lo = 0;
    for (let i = Math.min(tailLen, 15) - 1; i >= 8; i--) {
      // k2 = (k2 << 8) | t(i)
      k2Hi = ((k2Hi << 8) | (k2Lo >>> 24)) >>> 0;
      k2Lo = ((k2Lo << 8) | t(i)) >>> 0;
    }
    mul64(k2Hi, k2Lo, C2_HI, C2_LO);
    rotl64(rHi, rLo, 33);
    mul64(rHi, rLo, C1_HI, C1_LO);
    h2Hi = (h2Hi ^ rHi) >>> 0;
    h2Lo = (h2Lo ^ rLo) >>> 0;
  }
  if (tailLen >= 1) {
    let k1Hi = 0;
    let k1Lo = 0;
    for (let i = Math.min(tailLen, 8) - 1; i >= 0; i--) {
      k1Hi = ((k1Hi << 8) | (k1Lo >>> 24)) >>> 0;
      k1Lo = ((k1Lo << 8) | t(i)) >>> 0;
    }
    mul64(k1Hi, k1Lo, C1_HI, C1_LO);
    rotl64(rHi, rLo, 31);
    mul64(rHi, rLo, C2_HI, C2_LO);
    h1Hi = (h1Hi ^ rHi) >>> 0;
    h1Lo = (h1Lo ^ rLo) >>> 0;
  }

  // h1 ^= len; h2 ^= len (len fits 53 bits; its high word is len / 2^32)
  const lenHi = Math.floor(len / 0x100000000) >>> 0;
  const lenLo = len >>> 0;
  h1Hi = (h1Hi ^ lenHi) >>> 0;
  h1Lo = (h1Lo ^ lenLo) >>> 0;
  h2Hi = (h2Hi ^ lenHi) >>> 0;
  h2Lo = (h2Lo ^ lenLo) >>> 0;

  add64(h1Hi, h1Lo, h2Hi, h2Lo);
  h1Hi = rHi;
  h1Lo = rLo;
  add64(h2Hi, h2Lo, h1Hi, h1Lo);
  h2Hi = rHi;
  h2Lo = rLo;

  fmix64(h1Hi, h1Lo);
  h1Hi = rHi;
  h1Lo = rLo;
  fmix64(h2Hi, h2Lo);
  h2Hi = rHi;
  h2Lo = rLo;

  add64(h1Hi, h1Lo, h2Hi, h2Lo);
  h1Hi = rHi;
  h1Lo = rLo;
  add64(h2Hi, h2Lo, h1Hi, h1Lo);
  h2Hi = rHi;
  h2Lo = rLo;

  return {
    h1: (BigInt(h1Hi) << 32n) | BigInt(h1Lo),
    h2: (BigInt(h2Hi) << 32n) | BigInt(h2Lo),
  };
}

const hex16 = (v: bigint): string => v.toString(16).toUpperCase().padStart(16, '0');

/**
 * `MMH3_HASH( seed ).add( data ).digest().ToString()` as KiCad MASTER computes it
 * (the tail fix). **Not** what the pinned 10.0.5 writes: its `addData`
 * (libs/kimath/include/mmh3_hash.h:73) is the padded variant below. Use
 * `mmh3HashToStringV1` for every checksum a 10.0.5 file carries.
 */
export function mmh3HashToString(data: Uint8Array, seed: number): string {
  const { h1, h2 } = mmh3_x64_128(data, seed, false);
  return hex16(h1) + hex16(h2);
}

/**
 * `MMH3_HASH::addData` of KiCad 10.0.5 (libs/kimath/include/mmh3_hash.h:73):
 * the tail is padded to 4 bytes and the padding counted in `len`. This is
 * the checksum every 10.0.5 `(embedded_files …)` block carries.
 */
export function mmh3HashToStringV1(data: Uint8Array, seed: number): string {
  const { h1, h2 } = mmh3_x64_128(data, seed, true);
  return hex16(h1) + hex16(h2);
}
