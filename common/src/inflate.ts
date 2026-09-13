// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * DEFLATE (RFC 1951) decompression and the zlib (RFC 1950) wrapper, the
 * decoding half of what libpng takes from zlib. The PNG reader in
 * `wx_image.ts` is the one caller; KiCad's `wxImage::LoadFile` reaches
 * libpng/zlib for the same bytes.
 *
 * A straight transcription of the format: stored blocks, fixed and dynamic
 * Huffman blocks, the 30 distance and 29 length codes with their extra bits.
 * No streaming: a PNG's IDAT payload is inflated in one call.
 */

/** Length codes 257..285: base length and extra bits (RFC 1951 3.2.5). */
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];

/** Distance codes 0..29: base distance and extra bits. */
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];

/** The order the code length code lengths are transmitted in (3.2.7). */
const CLC_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/**
 * A canonical Huffman decoding table: `count[len]` codes of each length and
 * the symbols in code order (the "puff" representation, which decodes bit by
 * bit and needs no table larger than the alphabet).
 */
interface HUFFMAN {
  count: Uint16Array; // 16 entries: number of codes of each length 0..15
  symbol: Uint16Array; // the symbols ordered by code
}

function buildHuffman(aLengths: Uint8Array | number[], aN: number): HUFFMAN {
  const count = new Uint16Array(16);
  const symbol = new Uint16Array(aN);

  for (let s = 0; s < aN; s++) count[aLengths[s]!]!++;

  count[0] = 0;

  const offs = new Uint16Array(16);

  for (let len = 1; len < 16; len++) offs[len] = offs[len - 1]! + count[len - 1]!;

  for (let s = 0; s < aN; s++) {
    if (aLengths[s] !== 0) symbol[offs[aLengths[s]!]!++] = s;
  }

  return { count, symbol };
}

class BIT_READER {
  private pos = 0;
  private bitBuf = 0;
  private bitCnt = 0;

  constructor(private readonly data: Uint8Array) {}

  bits(aNeed: number): number {
    let val = this.bitBuf;

    while (this.bitCnt < aNeed) {
      if (this.pos >= this.data.length) throw new Error('inflate: unexpected end of data');

      val |= this.data[this.pos++]! << this.bitCnt;
      this.bitCnt += 8;
    }

    this.bitBuf = val >>> aNeed;
    this.bitCnt -= aNeed;

    return val & ((1 << aNeed) - 1);
  }

  /** Drop the bits to the next byte boundary (a stored block starts on one). */
  alignToByte(): void {
    this.bitBuf = 0;
    this.bitCnt = 0;
  }

  byte(): number {
    if (this.pos >= this.data.length) throw new Error('inflate: unexpected end of data');

    return this.data[this.pos++]!;
  }

  decode(aH: HUFFMAN): number {
    let code = 0;
    let first = 0;
    let index = 0;

    for (let len = 1; len < 16; len++) {
      code |= this.bits(1);
      const count = aH.count[len]!;

      if (code - count < first) return aH.symbol[index + (code - first)]!;

      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }

    throw new Error('inflate: invalid Huffman code');
  }
}

/** The output buffer: grows by doubling; a PNG's raw size is known so it seldom does. */
class OUT {
  buf: Uint8Array;
  len = 0;

  constructor(aInitial: number) {
    this.buf = new Uint8Array(Math.max(aInitial, 1024));
  }

  ensure(aExtra: number): void {
    if (this.len + aExtra <= this.buf.length) return;

    let n = this.buf.length * 2;

    while (n < this.len + aExtra) n *= 2;

    const next = new Uint8Array(n);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  push(aByte: number): void {
    this.ensure(1);
    this.buf[this.len++] = aByte;
  }
}

let fixedLit: HUFFMAN | null = null;
let fixedDist: HUFFMAN | null = null;

function fixedTables(): [HUFFMAN, HUFFMAN] {
  if (!fixedLit || !fixedDist) {
    const lengths = new Uint8Array(288);

    for (let s = 0; s < 144; s++) lengths[s] = 8;

    for (let s = 144; s < 256; s++) lengths[s] = 9;

    for (let s = 256; s < 280; s++) lengths[s] = 7;

    for (let s = 280; s < 288; s++) lengths[s] = 8;

    fixedLit = buildHuffman(lengths, 288);

    const dl = new Uint8Array(30).fill(5);
    fixedDist = buildHuffman(dl, 30);
  }

  return [fixedLit, fixedDist];
}

function inflateCodes(aIn: BIT_READER, aOut: OUT, aLit: HUFFMAN, aDist: HUFFMAN): void {
  for (;;) {
    let symbol = aIn.decode(aLit);

    if (symbol < 256) {
      aOut.push(symbol);
    } else if (symbol === 256) {
      return;
    } else {
      symbol -= 257;

      if (symbol >= 29) throw new Error('inflate: invalid length code');

      const len = LENGTH_BASE[symbol]! + aIn.bits(LENGTH_EXTRA[symbol]!);

      const dsym = aIn.decode(aDist);

      if (dsym >= 30) throw new Error('inflate: invalid distance code');

      const dist = DIST_BASE[dsym]! + aIn.bits(DIST_EXTRA[dsym]!);

      if (dist > aOut.len) throw new Error('inflate: distance too far back');

      aOut.ensure(len);

      for (let i = 0; i < len; i++) {
        aOut.buf[aOut.len] = aOut.buf[aOut.len - dist]!;
        aOut.len++;
      }
    }
  }
}

function inflateStored(aIn: BIT_READER, aOut: OUT): void {
  aIn.alignToByte();

  const len = aIn.byte() | (aIn.byte() << 8);
  const nlen = aIn.byte() | (aIn.byte() << 8);

  if ((len ^ 0xffff) !== nlen) throw new Error('inflate: stored block length mismatch');

  aOut.ensure(len);

  for (let i = 0; i < len; i++) aOut.buf[aOut.len++] = aIn.byte();
}

function inflateDynamic(aIn: BIT_READER, aOut: OUT): void {
  const nlen = aIn.bits(5) + 257;
  const ndist = aIn.bits(5) + 1;
  const ncode = aIn.bits(4) + 4;

  if (nlen > 286 || ndist > 30) throw new Error('inflate: bad counts');

  const lengths = new Uint8Array(320);

  for (let i = 0; i < ncode; i++) lengths[CLC_ORDER[i]!] = aIn.bits(3);

  const lencode = buildHuffman(lengths, 19);

  let index = 0;

  while (index < nlen + ndist) {
    const symbol = aIn.decode(lencode);

    if (symbol < 16) {
      lengths[index++] = symbol;
    } else {
      let len = 0;
      let repeat: number;

      if (symbol === 16) {
        if (index === 0) throw new Error('inflate: repeat with no first length');

        len = lengths[index - 1]!;
        repeat = 3 + aIn.bits(2);
      } else if (symbol === 17) {
        repeat = 3 + aIn.bits(3);
      } else {
        repeat = 11 + aIn.bits(7);
      }

      if (index + repeat > nlen + ndist) throw new Error('inflate: too many lengths');

      while (repeat--) lengths[index++] = len;
    }
  }

  if (lengths[256] === 0) throw new Error('inflate: no end-of-block code');

  const lit = buildHuffman(lengths.subarray(0, nlen), nlen);
  const dist = buildHuffman(lengths.subarray(nlen, nlen + ndist), ndist);

  inflateCodes(aIn, aOut, lit, dist);
}

/**
 * Inflate a raw DEFLATE stream.
 *
 * @param aExpected a size hint for the output buffer.
 */
export function inflateRaw(aData: Uint8Array, aExpected = 0): Uint8Array {
  const reader = new BIT_READER(aData);
  const out = new OUT(aExpected);
  let last: number;

  do {
    last = reader.bits(1);
    const type = reader.bits(2);

    if (type === 0) inflateStored(reader, out);
    else if (type === 1) {
      const [lit, dist] = fixedTables();
      inflateCodes(reader, out, lit, dist);
    } else if (type === 2) inflateDynamic(reader, out);
    else throw new Error('inflate: invalid block type');
  } while (!last);

  return out.buf.subarray(0, out.len);
}

/**
 * Inflate a zlib stream: the two-byte header (deflate method, a window size,
 * the check bits, no preset dictionary), the DEFLATE data, and an Adler-32
 * tail that is not verified here — libpng verifies it, but a broken tail
 * after correct data changes no pixel.
 */
export function inflateZlib(aData: Uint8Array, aExpected = 0): Uint8Array {
  if (aData.length < 2) throw new Error('inflate: zlib stream too short');

  const cmf = aData[0]!;
  const flg = aData[1]!;

  if ((cmf & 0x0f) !== 8) throw new Error('inflate: not a deflate stream');

  if (((cmf << 8) | flg) % 31 !== 0) throw new Error('inflate: bad zlib header check');

  if (flg & 0x20) throw new Error('inflate: preset dictionary not supported');

  return inflateRaw(aData.subarray(2), aExpected);
}
