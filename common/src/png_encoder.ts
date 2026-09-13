// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A byte-exact PNG writer, standing in for `cairo_surface_write_to_png`.
 *
 * **This has no upstream counterpart.** KiCad's PNG back-end hands its image
 * surface to Cairo, which hands the pixels to libpng; neither exists here, and
 * neither can be ported, so the bytes have to be produced by us. What *is*
 * pinned to upstream is the surface convention the writer consumes and the
 * un-premultiply arithmetic it applies on the way out — see
 * {@link pngUnpremultiplyArgb32} — because those are cairo's, not ours, and a
 * different rounding there is a different image.
 *
 * The file this emits is a PNG/1.2 conforming stream and nothing more:
 *
 *     89 50 4E 47 0D 0A 1A 0A     signature
 *     IHDR                        w, h, bit depth 8, colour type 6 (RGBA),
 *                                 compression 0, filter 0, interlace 0
 *     [pHYs]                      only when a `ppi` is asked for; cairo never
 *                                 writes one, so it is off by default
 *     IDAT                        one chunk, a zlib stream over filter-0 rows
 *     IEND
 *
 * The zlib stream uses **stored** (uncompressed) deflate blocks. That is a
 * legal deflate stream — every decoder must accept BTYPE=00 — and it is the
 * only encoding whose output is a pure function of the input with no tuning
 * knobs, which is what makes the bytes assertable. It costs size, not validity.
 * A caller who wants a small file can post-process; a caller who wants a
 * *correct* file gets one here.
 *
 * Everything is plain arithmetic on `Uint8Array`, so `qa` can run it: there is
 * no `CompressionStream`, no `Buffer`, no canvas.
 */

/** The eight-byte PNG signature (PNG 1.2 §5.2). */
export const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The CRC-32 table PNG 1.2 §D specifies: the reflected polynomial 0xEDB88320,
 * built once. The spec's own sample code builds exactly this.
 */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n++) {
    let c = n >>> 0;

    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;

    table[n] = c >>> 0;
  }

  return table;
})();

/**
 * PNG's CRC-32: the table-driven reflected CRC, pre-conditioned with all ones
 * and post-conditioned by complementing. Computed over the chunk *type* and
 * *data* — never over the length field.
 */
export function pngCrc32(aData: Uint8Array, aStart = 0, aEnd = aData.length): number {
  let c = 0xffffffff;

  for (let i = aStart; i < aEnd; i++) c = (CRC_TABLE[(c ^ aData[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;

  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Adler-32 (RFC 1950 §9): two sums modulo 65521, the low one seeded with 1 and
 * the high one with 0, packed high-first. The modulo is taken every byte here
 * rather than every 5552 as zlib does — same answer, less bookkeeping.
 */
export function adler32(aData: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;

  for (let i = 0; i < aData.length; i++) {
    s1 = (s1 + aData[i]!) % 65521;
    s2 = (s2 + s1) % 65521;
  }

  return ((s2 << 16) | s1) >>> 0;
}

/** Big-endian uint32 into `aOut` at `aOff`; returns the next offset. */
function put32(aOut: Uint8Array, aOff: number, aValue: number): number {
  aOut[aOff] = (aValue >>> 24) & 0xff;
  aOut[aOff + 1] = (aValue >>> 16) & 0xff;
  aOut[aOff + 2] = (aValue >>> 8) & 0xff;
  aOut[aOff + 3] = aValue & 0xff;
  return aOff + 4;
}

/**
 * A zlib stream (RFC 1950) wrapping stored deflate blocks (RFC 1951 §3.2.4).
 *
 * The two header bytes are 0x78 0x01: CM = 8 (deflate), CINFO = 7 (a 32 KiB
 * window, the only value libpng-era decoders universally accept), FDICT = 0,
 * FLEVEL = 0 (fastest), and FCHECK chosen so the big-endian pair is a multiple
 * of 31 — 0x7801 is 30721, which is 31 x 991.
 *
 * Each stored block carries at most 65535 bytes: one header byte holding
 * BFINAL in bit 0 and BTYPE = 00 in bits 1-2 (the rest are the padding to a
 * byte boundary that §3.2.4 mandates), then LEN and its ones' complement NLEN,
 * both **little-endian** — the one place in a PNG where a length is not
 * big-endian. Empty input still emits one final empty block, because a zlib
 * stream with no deflate block in it is not a stream.
 */
export function zlibStored(aData: Uint8Array): Uint8Array {
  const MAX_BLOCK = 0xffff;
  const blocks = Math.max(1, Math.ceil(aData.length / MAX_BLOCK));
  const out = new Uint8Array(2 + blocks * 5 + aData.length + 4);

  out[0] = 0x78;
  out[1] = 0x01;

  let off = 2;
  let pos = 0;

  for (let b = 0; b < blocks; b++) {
    const len = Math.min(MAX_BLOCK, aData.length - pos);
    const final = b === blocks - 1 ? 1 : 0;

    out[off++] = final;
    out[off++] = len & 0xff;
    out[off++] = (len >>> 8) & 0xff;
    out[off++] = ~len & 0xff;
    out[off++] = (~len >>> 8) & 0xff;
    out.set(aData.subarray(pos, pos + len), off);
    off += len;
    pos += len;
  }

  put32(out, off, adler32(aData));

  return out;
}

/**
 * One PNG chunk: a big-endian length covering the *data only*, the four-byte
 * type, the data, and a CRC over type-and-data.
 */
export function pngChunk(aType: string, aData: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + aData.length);

  put32(out, 0, aData.length);

  for (let i = 0; i < 4; i++) out[4 + i] = aType.charCodeAt(i) & 0xff;

  out.set(aData, 8);
  put32(out, 8 + aData.length, pngCrc32(out, 4, 8 + aData.length));

  return out;
}

/** Options for {@link pngEncodeRgba8}. */
export interface PngEncodeOptions {
  /**
   * Pixels per inch to record in a `pHYs` chunk. Omitted by default, because
   * `cairo_surface_write_to_png` writes no `pHYs` and a plot that gained one
   * would not be the file KiCad produces. `common/src/png_meta.ts` is the
   * reader that would see it.
   */
  ppi?: number;
}

/**
 * Encode straight (**not** premultiplied) 8-bit RGBA into a PNG.
 *
 * `aPixels` is row-major, four bytes per pixel, exactly `aWidth * aHeight * 4`
 * long — a short or long buffer is a caller bug and throws rather than
 * producing a file whose IHDR lies about its own IDAT.
 *
 * Every scanline is prefixed with filter type 0 (None). Adaptive filtering
 * would shrink the file and change nothing a decoder sees; it would also make
 * the output depend on a heuristic, and this encoder's contract is that it
 * does not.
 */
export function pngEncodeRgba8(
  aWidth: number,
  aHeight: number,
  aPixels: Uint8Array,
  aOptions: PngEncodeOptions = {},
): Uint8Array {
  if (!Number.isInteger(aWidth) || !Number.isInteger(aHeight) || aWidth <= 0 || aHeight <= 0)
    throw new Error(`PNG dimensions must be positive integers, got ${aWidth}x${aHeight}`);

  if (aPixels.length !== aWidth * aHeight * 4)
    throw new Error(
      `PNG pixel buffer is ${aPixels.length} bytes, expected ${aWidth * aHeight * 4}`,
    );

  const stride = aWidth * 4;
  const raw = new Uint8Array(aHeight * (stride + 1));

  for (let y = 0; y < aHeight; y++) {
    // The filter byte; 0 is None. The row follows it, unmodified.
    raw[y * (stride + 1)] = 0;
    raw.set(aPixels.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  put32(ihdr, 0, aWidth);
  put32(ihdr, 4, aHeight);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6: truecolour with alpha
  ihdr[10] = 0; // compression method: deflate
  ihdr[11] = 0; // filter method: adaptive with five filter types
  ihdr[12] = 0; // interlace method: none

  const parts: Uint8Array[] = [Uint8Array.from(PNG_SIGNATURE), pngChunk('IHDR', ihdr)];

  if (aOptions.ppi !== undefined) {
    // pHYs states pixels per unit; unit 1 is the metre, and an inch is exactly
    // 0.0254 m by definition, so ppi / 0.0254 is the conversion.
    const perMetre = Math.round(aOptions.ppi / 0.0254);
    const phys = new Uint8Array(9);
    put32(phys, 0, perMetre);
    put32(phys, 4, perMetre);
    phys[8] = 1;
    parts.push(pngChunk('pHYs', phys));
  }

  parts.push(pngChunk('IDAT', zlibStored(raw)));
  parts.push(pngChunk('IEND', new Uint8Array(0)));

  let total = 0;
  for (const p of parts) total += p.length;

  const file = new Uint8Array(total);
  let off = 0;

  for (const p of parts) {
    file.set(p, off);
    off += p.length;
  }

  return file;
}

/**
 * `unpremultiply_data` from cairo-png.c, byte for byte.
 *
 * A `CAIRO_FORMAT_ARGB32` surface holds each pixel as one native-endian 32-bit
 * word — so, little-endian, the bytes run B, G, R, A — with the colour channels
 * already multiplied by alpha. PNG stores straight RGBA, so cairo divides the
 * multiplication back out on the way to libpng:
 *
 * - alpha 0 writes four zero bytes. Not "transparent black by arithmetic" —
 *   the division is undefined there, so cairo special-cases it, and a pixel
 *   whose colour bytes are non-zero under a zero alpha (which an ARGB32 surface
 *   should never contain, but nothing enforces) loses them.
 * - otherwise each channel is `(c * 255 + alpha / 2) / alpha`, integer
 *   division throughout, with `alpha / 2` also integer — a round-half-up that
 *   is *not* the same as rounding the exact quotient. At alpha 3 and c 1, the
 *   exact value is 85, and `(255 + 1) / 3` is 85 too; at alpha 255 the term is
 *   127 and `(c * 255 + 127) / 255` is c, which is what makes an opaque pixel
 *   survive the round trip unchanged.
 *
 * The result is a fresh straight-RGBA buffer ready for {@link pngEncodeRgba8}.
 * `aStride` is the surface's byte stride, which cairo pads to a multiple of
 * four and may make wider than `aWidth * 4`.
 */
export function pngUnpremultiplyArgb32(
  aWidth: number,
  aHeight: number,
  aData: Uint8Array,
  aStride: number = aWidth * 4,
): Uint8Array {
  const out = new Uint8Array(aWidth * aHeight * 4);

  for (let y = 0; y < aHeight; y++) {
    const src = y * aStride;
    const dst = y * aWidth * 4;

    for (let x = 0; x < aWidth; x++) {
      // Little-endian ARGB32: byte 0 is blue, byte 3 is alpha.
      const b = aData[src + x * 4]!;
      const g = aData[src + x * 4 + 1]!;
      const r = aData[src + x * 4 + 2]!;
      const a = aData[src + x * 4 + 3]!;

      if (a === 0) {
        out[dst + x * 4] = 0;
        out[dst + x * 4 + 1] = 0;
        out[dst + x * 4 + 2] = 0;
        out[dst + x * 4 + 3] = 0;
      } else {
        const half = (a / 2) | 0;
        out[dst + x * 4] = ((r * 255 + half) / a) | 0;
        out[dst + x * 4 + 1] = ((g * 255 + half) / a) | 0;
        out[dst + x * 4 + 2] = ((b * 255 + half) / a) | 0;
        out[dst + x * 4 + 3] = a;
      }
    }
  }

  return out;
}

/**
 * The inverse of {@link pngUnpremultiplyArgb32}: straight RGBA in, a
 * little-endian premultiplied ARGB32 surface buffer out.
 *
 * Cairo's `premultiply_data` uses `(c * a + 127) / 255`, the same round-half-up
 * the wxImage path in `PNG_PLOTTER::PlotImage` spells out by hand. It is used
 * here to build source surfaces out of straight-alpha image data, which is what
 * `PlotImage` does.
 */
export function pngPremultiplyRgba8(
  aWidth: number,
  aHeight: number,
  aPixels: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(aWidth * aHeight * 4);

  for (let i = 0; i < aWidth * aHeight; i++) {
    const r = aPixels[i * 4]!;
    const g = aPixels[i * 4 + 1]!;
    const b = aPixels[i * 4 + 2]!;
    const a = aPixels[i * 4 + 3]!;

    out[i * 4] = ((b * a + 127) / 255) | 0;
    out[i * 4 + 1] = ((g * a + 127) / 255) | 0;
    out[i * 4 + 2] = ((r * a + 127) / 255) | 0;
    out[i * 4 + 3] = a;
  }

  return out;
}
