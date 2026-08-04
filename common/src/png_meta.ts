// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reading a PNG's pixel size and resolution out of a base64 payload.
 * Counterpart: what `BITMAP_BASE` gets from wxImage — `GetWidth`/`GetHeight`
 * and `GetPPI` from the file's own resolution.
 *
 * Deliberately **unit-agnostic**: it answers in pixels and ppi, and each editor
 * turns that into its own internal units. The schematic and the board disagree
 * about what an IU is (100 nm versus 1 nm), so a helper that returned IU would
 * only ever be right for one of them.
 *
 * Only the header is decoded. `pHYs` must precede `IDAT`, so a few kilobytes is
 * always enough — reading the whole payload to find it would mean decoding
 * megabytes of pixel data on every hit test.
 *
 * **Note on duplication:** `eeschema/src/tools/image_size.ts` carries its own
 * copy of this parsing. It predates this module and is owned by another effort;
 * pointing it here would be a tidy follow-up, but is not this change's to make.
 */

/** `BITMAP_BASE`'s default resolution when the file states none. */
export const DEFAULT_PPI = 300;

/** The PNG magic, which the payload must open with for the offsets to hold. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Big-endian uint32 at `off`. */
const be32 = (b: Uint8Array, off: number): number =>
  ((b[off]! << 24) | (b[off + 1]! << 16) | (b[off + 2]! << 8) | b[off + 3]!) >>> 0;

/**
 * The first `n` bytes of a base64 payload, decoded, or fewer when the payload
 * is shorter. Callers check the length they actually need.
 */
function head(data: string, n: number): Uint8Array | null {
  // 4 base64 characters carry 3 bytes, so ceil(n/3) quads cover n bytes.
  const chars = Math.ceil(n / 3) * 4;
  const all = data.replace(/\s+/g, '');
  // Slicing on a quad boundary keeps the remainder decodable; a shorter payload
  // is taken whole, padding included.
  const b64 = all.length <= chars ? all : all.slice(0, chars);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null; // not decodable base64; the caller falls back
  }
}

/**
 * A PNG's size in pixels, or null when the payload is not one we can read.
 *
 * The layout is fixed: 8 bytes of magic, then IHDR as a 4-byte length, the
 * 4-byte type, and width and height as big-endian uint32s.
 */
export function pngPixelSize(data: string): { w: number; h: number } | null {
  const b = head(data, 24);
  if (!b || b.length < 24) return null;
  for (let i = 0; i < PNG_MAGIC.length; i++) if (b[i] !== PNG_MAGIC[i]) return null;
  // Bytes 12..16 spell "IHDR"; anything else is a rearranged file we should not
  // guess at.
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  const w = be32(b, 16);
  const h = be32(b, 20);
  if (w === 0 || h === 0) return null;
  return { w, h };
}

/**
 * The image's own resolution, `BITMAP_BASE::GetPPI`.
 *
 * PNG states it in the optional `pHYs` chunk as pixels per unit, with a unit
 * byte where 1 means the metre. Unit 0 is "unknown" — an aspect ratio only,
 * which says nothing about physical size — so it falls back to the default
 * rather than being read as metres.
 */
export function pngPPI(data: string): number {
  const b = head(data, 4096);
  if (!b) return DEFAULT_PPI;
  let off = 8; // past the magic
  while (off + 8 <= b.length) {
    const len = be32(b, off);
    const type = String.fromCharCode(b[off + 4]!, b[off + 5]!, b[off + 6]!, b[off + 7]!);
    const data0 = off + 8;
    if (type === 'IDAT' || type === 'IEND') break; // pixel data starts; no pHYs
    if (type === 'pHYs' && data0 + 9 <= b.length) {
      const ppuX = be32(b, data0);
      const unit = b[data0 + 8];
      if (unit === 1 && ppuX > 0) return Math.round((ppuX / 100) * 2.54);
      return DEFAULT_PPI;
    }
    off = data0 + len + 4; // skip the payload and its CRC
    if (!Number.isSafeInteger(off) || len < 0) break;
  }
  return DEFAULT_PPI;
}
