// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `std::unordered_map<std::string, T>` as libstdc++ (GCC 13, the toolchain KiCad 10.0.6 is
 * built with here) keeps one, for the places KiCad's output order IS that map's iteration
 * order: REFDES_TRACKER::Serialize writes its prefixes in it, into the `.kicad_pro`.
 *
 * Only what decides the order is ported:
 *  - `std::hash<std::string>`: `_Hash_bytes( data, len, 0xc70f6907 )` (hash_bytes.cc,
 *    64-bit size_t), over the string's bytes (UTF-8 here, as KiCad's std::string holds).
 *  - `_Hashtable`: one singly-linked list, each bucket pointing at the node BEFORE its first;
 *    an insert goes to the front of its bucket, or of the whole list when the bucket is empty
 *    (`_M_insert_bucket_begin`); a rehash relinks in list order (`_M_rehash_aux`, unique
 *    keys); `clear()` keeps the bucket count and the rehash state.
 *  - `_Prime_rehash_policy` at max load 1.0: an empty table first grows to room for 11
 *    (`_M_need_rehash`), then to the next listed prime at or above max(n + 1, 2 * buckets)
 *    (`_M_next_bkt`).
 *
 * `_M_need_rehash` and `_M_next_bkt` are compiled into libstdc++.so, not the headers, so
 * their prime table and growth were measured with qa/probes/std_unordered_map_probe.cpp, as
 * was the hash.
 */

const MASK = (1n << 64n) - 1n;
const MUL = 0xc6a4a7935bd1e995n;
const SEED = 0xc70f6907n;

const shiftMix = (v: bigint) => v ^ (v >> 47n);

/** `std::_Hash_bytes( ptr, len, seed )` for a 64-bit size_t. */
export function Hash_bytes(aBytes: Uint8Array, aSeed: bigint = SEED): bigint {
  const len = aBytes.length;
  const lenAligned = len & ~7;
  let hash = (aSeed ^ ((BigInt(len) * MUL) & MASK)) & MASK;

  for (let p = 0; p < lenAligned; p += 8) {
    let load = 0n;

    for (let i = 7; i >= 0; i--) load = (load << 8n) | BigInt(aBytes[p + i]!);

    const data = (shiftMix((load * MUL) & MASK) * MUL) & MASK;
    hash ^= data;
    hash = (hash * MUL) & MASK;
  }

  if ((len & 7) !== 0) {
    // load_bytes: the tail, little-endian.
    let data = 0n;

    for (let i = len - 1; i >= lenAligned; i--) data = (data << 8n) | BigInt(aBytes[i]!);

    hash ^= data;
    hash = (hash * MUL) & MASK;
  }

  hash = (shiftMix(hash) * MUL) & MASK;
  return shiftMix(hash);
}

const utf8 = new TextEncoder();

/** `std::hash<std::string>()( aKey )`. */
export function hashString(aKey: string): bigint {
  return Hash_bytes(utf8.encode(aKey));
}

/**
 * `std::hash<std::wstring>()( aKey )`, which is wxString's std::hash (wx/string.h hashes
 * `ToStdWstring()`): the string as 4-byte wchar_t code points, little-endian.
 */
export function hashWString(aKey: string): bigint {
  const points = [...aKey].map((c) => c.codePointAt(0)!);
  const bytes = new Uint8Array(points.length * 4);
  const view = new DataView(bytes.buffer);

  points.forEach((cp, i) => view.setUint32(i * 4, cp, true));

  return Hash_bytes(bytes);
}

/** `std::hash<int>()( aValue )`: the value as a size_t (sign-extended). */
export function hashInt(aValue: number): bigint {
  return BigInt.asUintN(64, BigInt(aValue));
}

/** `_Prime_rehash_policy::_M_next_bkt`'s fast table, for n < 14. */
const FAST_BKT = [2, 2, 2, 3, 5, 5, 7, 7, 11, 11, 11, 11, 13, 13];

/** `__prime_list` from index 6 on, as `_M_next_bkt` searches it (measured, to 5e6). */
const PRIME_LIST = [
  17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 103, 109, 113, 127,
  137, 139, 149, 157, 167, 179, 193, 199, 211, 227, 241, 257, 277, 293, 313, 337, 359, 383, 409,
  439, 467, 503, 541, 577, 619, 661, 709, 761, 823, 887, 953, 1031, 1109, 1193, 1289, 1381, 1493,
  1613, 1741, 1879, 2029, 2179, 2357, 2549, 2753, 2971, 3209, 3469, 3739, 4027, 4349, 4703, 5087,
  5503, 5953, 6427, 6949, 7517, 8123, 8783, 9497, 10273, 11113, 12011, 12983, 14033, 15173, 16411,
  17749, 19183, 20753, 22447, 24281, 26267, 28411, 30727, 33223, 35933, 38873, 42043, 45481, 49201,
  53201, 57557, 62233, 67307, 72817, 78779, 85229, 92203, 99733, 107897, 116731, 126271, 136607,
  147793, 159871, 172933, 187091, 202409, 218971, 236897, 256279, 277261, 299951, 324503, 351061,
  379787, 410857, 444487, 480881, 520241, 562841, 608903, 658753, 712697, 771049, 834181, 902483,
  976369, 1056323, 1142821, 1236397, 1337629, 1447153, 1565659, 1693859, 1832561, 1982627, 2144977,
  2320627, 2510653, 2716249, 2938679, 3179303, 3439651, 3721303, 4026031, 4355707, 4712381, 5098259,
];

interface Node<T, K> {
  key: K;
  value: T;
  code: bigint;
  next: Node<T, K> | null;
}

export class STD_UNORDERED_MAP<T, K = string> implements Iterable<[K, T]> {
  /**
   * \a aHash is the map's Hash (std::hash<std::string> by default), \a aEquals its KeyEqual.
   */
  constructor(
    private readonly m_hash: (aKey: K) => bigint = hashString as unknown as (aKey: K) => bigint,
    private readonly m_equals: (a: K, b: K) => boolean = Object.is,
  ) {}

  /// `_M_before_begin`: the list head; its `next` is the first element.
  private m_beforeBegin: Node<T, K> = {
    key: undefined as K,
    value: undefined as T,
    code: 0n,
    next: null,
  };
  /// Each bucket: the node before the bucket's first, or null for an empty bucket.
  private m_buckets: (Node<T, K> | null)[] = [null];
  private m_elementCount = 0;
  /// `_Prime_rehash_policy::_M_next_resize`.
  private m_nextResize = 0;

  private bucketIndex(aCode: bigint): number {
    return Number(aCode % BigInt(this.m_buckets.length));
  }

  private nextBkt(aN: number): number {
    if (aN < FAST_BKT.length) {
      if (aN === 0) return 1;

      this.m_nextResize = FAST_BKT[aN]!;
      return FAST_BKT[aN]!;
    }

    const bkt = PRIME_LIST.find((p) => p >= aN);

    if (bkt === undefined) throw new Error('STD_UNORDERED_MAP: past the measured prime table');

    this.m_nextResize = bkt;
    return bkt;
  }

  /** `_M_need_rehash( n_bkt, n_elt, 1 )`: the new bucket count, or 0 for none. */
  private needRehash(): number {
    const nBkt = this.m_buckets.length;
    const nElt = this.m_elementCount + 1;

    if (nElt > this.m_nextResize) {
      // If _M_next_resize is 0 it means that we have nothing allocated so far and that we
      // start inserting elements. In this case we start with an initial bucket size of 11.
      const minBkts = Math.max(nElt, this.m_nextResize ? 0 : 11);

      if (minBkts >= nBkt) return this.nextBkt(Math.max(minBkts + 1, nBkt * 2));

      this.m_nextResize = nBkt;
    }

    return 0;
  }

  /** `_M_rehash_aux( n, true_type )`. */
  private rehash(aBucketCount: number): void {
    const newBuckets: (Node<T, K> | null)[] = new Array(aBucketCount).fill(null);
    let p = this.m_beforeBegin.next;
    this.m_beforeBegin.next = null;
    let bbeginBkt = 0;

    while (p) {
      const next = p.next;
      const bkt = Number(p.code % BigInt(aBucketCount));

      if (!newBuckets[bkt]) {
        p.next = this.m_beforeBegin.next;
        this.m_beforeBegin.next = p;
        newBuckets[bkt] = this.m_beforeBegin;

        if (p.next) newBuckets[bbeginBkt] = p;

        bbeginBkt = bkt;
      } else {
        p.next = newBuckets[bkt]!.next;
        newBuckets[bkt]!.next = p;
      }

      p = next;
    }

    this.m_buckets = newBuckets;
  }

  private find(aKey: K): Node<T, K> | null {
    for (let n = this.m_beforeBegin.next; n; n = n.next) if (this.m_equals(n.key, aKey)) return n;

    return null;
  }

  /** `emplace( aKey, aValue )`: inserts unless the key is there; true if it inserted. */
  emplace(aKey: K, aValue: T): boolean {
    if (this.find(aKey)) return false;

    const code = this.m_hash(aKey);
    const grow = this.needRehash();

    if (grow) this.rehash(grow);

    const node: Node<T, K> = { key: aKey, value: aValue, code, next: null };
    const bkt = this.bucketIndex(code);

    // _M_insert_bucket_begin
    const before = this.m_buckets[bkt];

    if (before) {
      node.next = before.next;
      before.next = node;
    } else {
      node.next = this.m_beforeBegin.next;
      this.m_beforeBegin.next = node;

      if (node.next) this.m_buckets[this.bucketIndex(node.next.code)] = node;

      this.m_buckets[bkt] = this.m_beforeBegin;
    }

    this.m_elementCount++;
    return true;
  }

  /** `operator[]`: the value at \a aKey, inserting \a aMake()'s first if it is not there. */
  getOrInsert(aKey: K, aMake: () => T): T {
    const node = this.find(aKey);

    if (node) return node.value;

    const value = aMake();
    this.emplace(aKey, value);
    return value;
  }

  /** `insert_or_assign( aKey, aValue )`: a key already there keeps its place. */
  set(aKey: K, aValue: T): void {
    const node = this.find(aKey);

    if (node) node.value = aValue;
    else this.emplace(aKey, aValue);
  }

  get(aKey: K): T | undefined {
    return this.find(aKey)?.value;
  }

  has(aKey: K): boolean {
    return this.find(aKey) !== null;
  }

  /** `erase( aKey )`: `_M_erase` and `_M_remove_bucket_begin`; true if it removed one. */
  erase(aKey: K): boolean {
    let prev = this.m_beforeBegin;

    while (prev.next && !this.m_equals(prev.next.key, aKey)) prev = prev.next;

    const n = prev.next;

    if (!n) return false;

    const bkt = this.bucketIndex(n.code);

    if (prev === this.m_buckets[bkt]) {
      const next = n.next;
      const nextBkt = next ? this.bucketIndex(next.code) : 0;

      if (!next || nextBkt !== bkt) {
        // Bucket is now empty.  First update next bucket if any
        if (next) this.m_buckets[nextBkt] = this.m_buckets[bkt]!;

        // Second update before begin node if necessary
        if (this.m_beforeBegin === this.m_buckets[bkt]) this.m_beforeBegin.next = next;

        this.m_buckets[bkt] = null;
      }
    } else if (n.next) {
      const nextBkt = this.bucketIndex(n.next.code);

      if (nextBkt !== bkt) this.m_buckets[nextBkt] = prev;
    }

    prev.next = n.next;
    this.m_elementCount--;
    return true;
  }

  /** `clear()`: the bucket count and the rehash state are kept. */
  clear(): void {
    this.m_buckets.fill(null);
    this.m_beforeBegin.next = null;
    this.m_elementCount = 0;
  }

  size(): number {
    return this.m_elementCount;
  }

  bucket_count(): number {
    return this.m_buckets.length;
  }

  *[Symbol.iterator](): Iterator<[K, T]> {
    for (let n = this.m_beforeBegin.next; n; n = n.next) yield [n.key, n.value];
  }

  *keys(): IterableIterator<K> {
    for (let n = this.m_beforeBegin.next; n; n = n.next) yield n.key;
  }
}
