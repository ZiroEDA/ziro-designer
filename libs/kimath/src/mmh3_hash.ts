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

const MASK = (1n << 64n) - 1n;
const C1 = 0x87c37b91114253d5n;
const C2 = 0x4cf5ad432745937fn;

const rotl64 = (x: bigint, r: bigint): bigint => ((x << r) | (x >> (64n - r))) & MASK;

const fmix64 = (k0: bigint): bigint => {
  let k = k0;
  k ^= k >> 33n;
  k = (k * 0xff51afd7ed558ccdn) & MASK;
  k ^= k >> 33n;
  k = (k * 0xc4ceb9fe1a85ec53n) & MASK;
  k ^= k >> 33n;
  return k;
};

/** Little-endian uint64 read of 8 bytes at `off`. */
const block64 = (d: Uint8Array, off: number): bigint => {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[off + i]!);
  return v;
};

function mmh3_x64_128(data: Uint8Array, seed: number, v1Tail: boolean): { h1: bigint; h2: bigint } {
  let h1 = BigInt(seed >>> 0);
  let h2 = BigInt(seed >>> 0);

  const nblocks = Math.floor(data.length / 16);
  for (let i = 0; i < nblocks; i++) {
    let k1 = block64(data, i * 16);
    let k2 = block64(data, i * 16 + 8);

    k1 = (k1 * C1) & MASK;
    k1 = rotl64(k1, 31n);
    k1 = (k1 * C2) & MASK;
    h1 ^= k1;

    h1 = rotl64(h1, 27n);
    h1 = (h1 + h2) & MASK;
    h1 = (h1 * 5n + 0x52dce729n) & MASK;

    k2 = (k2 * C2) & MASK;
    k2 = rotl64(k2, 33n);
    k2 = (k2 * C1) & MASK;
    h2 ^= k2;

    h2 = rotl64(h2, 31n);
    h2 = (h2 + h1) & MASK;
    h2 = (h2 * 5n + 0x38495ab5n) & MASK;
  }

  const remaining = data.length - nblocks * 16;
  // The streaming class hashes the tail from its 16-byte block buffer. addData
  // zeroes the whole remainder; addDataV1 only zeroed up to 4-byte alignment
  // and counted the padding in len, for a single buffer the stale bytes
  // beyond the padding are zero too (fresh block), so only `len` differs.
  // V1's padding is 4 − ((remaining+4) % 4), never 0: a 4-aligned tail gains
  // 4 zero bytes, and a 12-byte tail pads len to a full block whose bytes then
  // vanish from the hash entirely (len & 15 == 0). That is the V1 bug.
  let len = BigInt(nblocks * 16 + remaining);
  if (v1Tail && remaining > 0) len += BigInt(4 - ((remaining + 4) % 4));

  const tail = data.subarray(nblocks * 16);
  // hashTail switches on len & 15, with V1 padding this can shorten (or zero)
  // the tail bytes considered, exactly like the padded block upstream.
  const tailLen = Number(len & 15n);
  let k1 = 0n;
  let k2 = 0n;
  const t = (i: number): bigint => BigInt(i < tail.length ? tail[i]! : 0);
  if (tailLen >= 9) {
    for (let i = Math.min(tailLen, 15) - 1; i >= 8; i--) k2 = (k2 << 8n) | t(i);
    k2 = (k2 * C2) & MASK;
    k2 = rotl64(k2, 33n);
    k2 = (k2 * C1) & MASK;
    h2 ^= k2;
  }
  if (tailLen >= 1) {
    for (let i = Math.min(tailLen, 8) - 1; i >= 0; i--) k1 = (k1 << 8n) | t(i);
    k1 = (k1 * C1) & MASK;
    k1 = rotl64(k1, 31n);
    k1 = (k1 * C2) & MASK;
    h1 ^= k1;
  }

  h1 ^= len;
  h2 ^= len;
  h1 = (h1 + h2) & MASK;
  h2 = (h2 + h1) & MASK;
  h1 = fmix64(h1);
  h2 = fmix64(h2);
  h1 = (h1 + h2) & MASK;
  h2 = (h2 + h1) & MASK;

  return { h1, h2 };
}

const hex16 = (v: bigint): string => v.toString(16).toUpperCase().padStart(16, '0');

/** MMH3_HASH(seed).add(data).digest().ToString(), the current algorithm. */
export function mmh3HashToString(data: Uint8Array, seed: number): string {
  const { h1, h2 } = mmh3_x64_128(data, seed, false);
  return hex16(h1) + hex16(h2);
}

/** The addDataV1 variant, for validating files saved before the tail fix. */
export function mmh3HashToStringV1(data: Uint8Array, seed: number): string {
  const { h1, h2 } = mmh3_x64_128(data, seed, true);
  return hex16(h1) + hex16(h2);
}
