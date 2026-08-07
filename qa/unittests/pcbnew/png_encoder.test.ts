// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The PNG writer, checked against the format rather than against a screenshot.
 *
 * Every structural claim is verified twice where it can be: once by reading the
 * bytes we emitted, and once by handing the same bytes to Node's zlib, which
 * knows nothing about this encoder. A PNG that is merely plausible is the exact
 * failure this file exists to prevent.
 */
import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import {
  adler32,
  PNG_SIGNATURE,
  pngChunk,
  pngCrc32,
  pngEncodeRgba8,
  pngPremultiplyRgba8,
  pngUnpremultiplyArgb32,
  zlibStored,
} from '@ziroeda/pcbnew/src/png_encoder.js';

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

const hex = (b: Uint8Array): string =>
  Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ');

const be32 = (b: Uint8Array, off: number): number =>
  ((b[off]! << 24) | (b[off + 1]! << 16) | (b[off + 2]! << 8) | b[off + 3]!) >>> 0;

interface Chunk {
  type: string;
  data: Uint8Array;
  crc: number;
  crcOk: boolean;
}

/** Walk a PNG into its chunks, validating each CRC the way a decoder would. */
function readChunks(aFile: Uint8Array): Chunk[] {
  const chunks: Chunk[] = [];
  let off = 8;

  while (off < aFile.length) {
    const len = be32(aFile, off);
    const type = String.fromCharCode(...aFile.subarray(off + 4, off + 8));
    const data = aFile.subarray(off + 8, off + 8 + len);
    const crc = be32(aFile, off + 8 + len);

    chunks.push({ type, data, crc, crcOk: crc === pngCrc32(aFile, off + 4, off + 8 + len) });
    off += 12 + len;
  }

  return chunks;
}

describe('pngCrc32', () => {
  it('matches the standard CRC-32 check value', () => {
    // The check value every CRC-32/ISO-HDLC implementation is defined against.
    expect(pngCrc32(ascii('123456789'))).toBe(0xcbf43926);
  });

  it('is the empty-input identity PNG relies on', () => {
    // CRC of nothing is 0; the IEND chunk's CRC is therefore purely crc("IEND").
    expect(pngCrc32(new Uint8Array(0))).toBe(0);
    expect(pngCrc32(ascii('IEND'))).toBe(0xae426082);
  });

  it('covers only the requested range', () => {
    const padded = ascii('xx123456789yy');
    expect(pngCrc32(padded, 2, 11)).toBe(0xcbf43926);
  });
});

describe('adler32', () => {
  it('matches RFC 1950s worked example', () => {
    expect(adler32(ascii('123456789'))).toBe(0x091e01de);
  });

  it('seeds s1 with one, so the empty checksum is 1 and not 0', () => {
    expect(adler32(new Uint8Array(0))).toBe(1);
  });

  it('stays inside 32 bits for a long input', () => {
    const big = new Uint8Array(200000).fill(0xff);
    const sum = adler32(big);
    expect(sum).toBeGreaterThanOrEqual(0);
    expect(sum).toBeLessThanOrEqual(0xffffffff);
    expect(sum & 0xffff).toBe((1 + 255 * 200000) % 65521);
  });
});

describe('pngChunk', () => {
  it('emits the canonical IEND, byte for byte', () => {
    expect(hex(pngChunk('IEND', new Uint8Array(0)))).toBe('00 00 00 00 49 45 4e 44 ae 42 60 82');
  });

  it('emits the canonical 1x1 RGBA IHDR, byte for byte', () => {
    const ihdr = Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    expect(hex(pngChunk('IHDR', ihdr))).toBe(
      '00 00 00 0d 49 48 44 52 00 00 00 01 00 00 00 01 08 06 00 00 00 1f 15 c4 89',
    );
  });

  it('lengths the data only, and CRCs the type and data only', () => {
    const chunk = pngChunk('IDAT', ascii('123456789'));
    // The length field excludes the 4 type bytes and the 4 CRC bytes.
    expect(be32(chunk, 0)).toBe(9);
    expect(chunk.length).toBe(21);
    // The CRC runs from the type to the end of the data, never over the length.
    expect(be32(chunk, 17)).toBe(pngCrc32(ascii('IDAT123456789')));
    expect(be32(chunk, 17)).not.toBe(pngCrc32(chunk.subarray(0, 17)));
  });
});

describe('zlibStored', () => {
  it('opens with the 0x78 0x01 header, which is a multiple of 31', () => {
    const z = zlibStored(ascii('abc'));
    expect(z[0]).toBe(0x78);
    expect(z[1]).toBe(0x01);
    expect((((z[0]! << 8) | z[1]!) >>> 0) % 31).toBe(0);
  });

  it('writes LEN little-endian and NLEN as its ones complement', () => {
    const z = zlibStored(ascii('abc'));
    // final block flag, then LEN = 3, then NLEN = ~3 = 0xFFFC, both LE.
    expect(hex(z.subarray(2, 10))).toBe('01 03 00 fc ff 61 62 63');
  });

  it('splits at 65535 bytes and only flags the last block final', () => {
    const data = new Uint8Array(65536).fill(7);
    const z = zlibStored(data);

    expect(z[2]).toBe(0); // first block: not final
    expect(z[3]! | (z[4]! << 8)).toBe(65535);

    const second = 2 + 5 + 65535;
    expect(z[second]).toBe(1); // second block: final
    expect(z[second + 1]! | (z[second + 2]! << 8)).toBe(1);
  });

  it('still emits one empty final block for empty input', () => {
    const z = zlibStored(new Uint8Array(0));
    expect(hex(z)).toBe('78 01 01 00 00 ff ff 00 00 00 01');
  });

  it('ends with the adler32 of the uncompressed data, big-endian', () => {
    const z = zlibStored(ascii('123456789'));
    expect(be32(z, z.length - 4)).toBe(0x091e01de);
  });

  it('round-trips through a decoder that has never heard of us', () => {
    for (const size of [0, 1, 3, 65534, 65535, 65536, 131071, 200000]) {
      const data = new Uint8Array(size);
      for (let i = 0; i < size; i++) data[i] = (i * 31 + 7) & 0xff;

      const back = new Uint8Array(inflateSync(Buffer.from(zlibStored(data))));
      expect(back.length, `size ${size}`).toBe(size);
      // Byte compare rather than a deep-equal on a 200 kB array: the assertion
      // is the same, the running time is not.
      expect(Buffer.compare(Buffer.from(back), Buffer.from(data)), `size ${size}`).toBe(0);
    }
  });
});

describe('pngEncodeRgba8', () => {
  const pixels = (w: number, h: number): Uint8Array => {
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < px.length; i++) px[i] = (i * 13 + 5) & 0xff;
    return px;
  };

  it('opens with the PNG signature', () => {
    const file = pngEncodeRgba8(2, 2, pixels(2, 2));
    expect(Array.from(file.subarray(0, 8))).toEqual([...PNG_SIGNATURE]);
  });

  it('emits IHDR, IDAT and IEND in that order, with valid CRCs and no pHYs', () => {
    const chunks = readChunks(pngEncodeRgba8(3, 5, pixels(3, 5)));

    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(chunks.every((c) => c.crcOk)).toBe(true);
  });

  it('states the size, an 8-bit RGBA non-interlaced image, in IHDR', () => {
    const ihdr = readChunks(pngEncodeRgba8(7, 11, pixels(7, 11)))[0]!.data;

    expect(be32(ihdr, 0)).toBe(7);
    expect(be32(ihdr, 4)).toBe(11);
    expect(ihdr[8]).toBe(8); // bit depth
    expect(ihdr[9]).toBe(6); // colour type 6 = truecolour with alpha
    expect(ihdr[10]).toBe(0); // deflate
    expect(ihdr[11]).toBe(0); // adaptive filtering
    expect(ihdr[12]).toBe(0); // no interlace
  });

  it('inflates to filter-0 scanlines carrying the pixels unchanged', () => {
    const w = 4;
    const h = 3;
    const px = pixels(w, h);
    const idat = readChunks(pngEncodeRgba8(w, h, px))[1]!.data;
    const raw = new Uint8Array(inflateSync(Buffer.from(idat)));

    expect(raw.length).toBe(h * (w * 4 + 1));

    for (let y = 0; y < h; y++) {
      expect(raw[y * (w * 4 + 1)], `filter byte of row ${y}`).toBe(0);
      expect(Array.from(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)))).toEqual(
        Array.from(px.subarray(y * w * 4, (y + 1) * w * 4)),
      );
    }
  });

  it('writes no pHYs unless asked — cairo writes none either', () => {
    expect(readChunks(pngEncodeRgba8(1, 1, pixels(1, 1))).map((c) => c.type)).not.toContain('pHYs');
  });

  it('writes pHYs in pixels per metre, between IHDR and IDAT, when asked', () => {
    const chunks = readChunks(pngEncodeRgba8(1, 1, pixels(1, 1), { ppi: 300 }));

    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);

    const phys = chunks[1]!.data;
    // 300 / 0.0254 = 11811.02...
    expect(be32(phys, 0)).toBe(11811);
    expect(be32(phys, 4)).toBe(11811);
    expect(phys[8]).toBe(1); // unit 1 = the metre
    expect(chunks[1]!.crcOk).toBe(true);
  });

  it('rejects a pixel buffer that does not match the stated size', () => {
    expect(() => pngEncodeRgba8(2, 2, new Uint8Array(15))).toThrow(/15 bytes, expected 16/);
    expect(() => pngEncodeRgba8(2, 2, new Uint8Array(17))).toThrow(/17 bytes, expected 16/);
  });

  it('rejects non-positive and non-integer dimensions', () => {
    expect(() => pngEncodeRgba8(0, 1, new Uint8Array(0))).toThrow(/positive integers/);
    expect(() => pngEncodeRgba8(1, -1, new Uint8Array(0))).toThrow(/positive integers/);
    expect(() => pngEncodeRgba8(1.5, 1, new Uint8Array(6))).toThrow(/positive integers/);
  });

  it('produces a file whose chunk lengths tile it exactly', () => {
    const file = pngEncodeRgba8(9, 9, pixels(9, 9));
    let off = 8;

    for (const chunk of readChunks(file)) off += 12 + chunk.data.length;

    expect(off).toBe(file.length);
  });
});

describe('pngUnpremultiplyArgb32', () => {
  /** One little-endian ARGB32 pixel: bytes run B, G, R, A. */
  const argb = (b: number, g: number, r: number, a: number) => Uint8Array.from([b, g, r, a]);

  it('zeroes all four bytes at alpha 0, colour bytes included', () => {
    // Not "transparent by arithmetic" — cairo special-cases the undefined
    // division, and any colour left under a zero alpha is discarded.
    expect(Array.from(pngUnpremultiplyArgb32(1, 1, argb(9, 9, 9, 0)))).toEqual([0, 0, 0, 0]);
  });

  it('is the identity at alpha 255', () => {
    expect(Array.from(pngUnpremultiplyArgb32(1, 1, argb(1, 2, 3, 255)))).toEqual([3, 2, 1, 255]);
    expect(Array.from(pngUnpremultiplyArgb32(1, 1, argb(255, 128, 0, 255)))).toEqual([
      0, 128, 255, 255,
    ]);
  });

  it('divides with cairos round-half-up, not with a rounded exact quotient', () => {
    // (1 * 255 + 3/2) / 3 = (255 + 1) / 3 = 85, integer division throughout.
    expect(Array.from(pngUnpremultiplyArgb32(1, 1, argb(1, 1, 1, 3)))).toEqual([85, 85, 85, 3]);
    // (5 * 255 + 4) / 9 = 1279 / 9 = 142, where the exact quotient is 141.67.
    expect(pngUnpremultiplyArgb32(1, 1, argb(5, 5, 5, 9))[0]).toBe(142);
  });

  it('reads rows at the surface stride, not at the row width', () => {
    // A 1-pixel-wide surface with an 8-byte stride: four bytes of padding a
    // naive reader would take for the next row.
    const data = Uint8Array.from([10, 20, 30, 255, 0xaa, 0xaa, 0xaa, 0xaa, 40, 50, 60, 255]);
    expect(Array.from(pngUnpremultiplyArgb32(1, 2, data, 8))).toEqual([
      30, 20, 10, 255, 60, 50, 40, 255,
    ]);
  });
});

describe('pngPremultiplyRgba8', () => {
  it('is the identity at alpha 255, apart from the byte-order swap', () => {
    // In: R G B A. Out: B G R A.
    expect(Array.from(pngPremultiplyRgba8(1, 1, Uint8Array.from([1, 2, 3, 255])))).toEqual([
      3, 2, 1, 255,
    ]);
  });

  it('multiplies with cairos (c * a + 127) / 255', () => {
    // (200 * 128 + 127) / 255 = 25727 / 255 = 100.
    expect(Array.from(pngPremultiplyRgba8(1, 1, Uint8Array.from([200, 200, 200, 128])))).toEqual([
      100, 100, 100, 128,
    ]);
  });

  it('collapses to zero at alpha 0', () => {
    expect(Array.from(pngPremultiplyRgba8(1, 1, Uint8Array.from([255, 255, 255, 0])))).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it('round-trips an opaque image exactly', () => {
    const rgba = new Uint8Array(16);
    for (let i = 0; i < 4; i++) {
      rgba[i * 4] = i * 40;
      rgba[i * 4 + 1] = 255 - i * 40;
      rgba[i * 4 + 2] = i * 17;
      rgba[i * 4 + 3] = 255;
    }

    const argb32 = pngPremultiplyRgba8(2, 2, rgba);
    expect(Array.from(pngUnpremultiplyArgb32(2, 2, argb32))).toEqual(Array.from(rgba));
  });
});
