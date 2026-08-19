// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The pixel size of an embedded image, read straight out of its header.
 *
 * KiCad's `BITMAP_BASE` keeps a decoded bitmap and takes `GetSizePixels` from
 * it, which everything geometric about a `SCH_BITMAP` is derived from: its
 * bounding box, its hit test, and the corner handles the point editor puts on
 * it. Our engine has no decoder and cannot wait for one either, because those
 * three run synchronously, per frame, off the document alone.
 *
 * It does not need one. A PNG states its dimensions in the IHDR chunk, which is
 * always the first chunk and always at a fixed offset, so the first 24 bytes of
 * the payload are enough. `(data …)` is PNG (SCH_IO_KICAD_SEXPR writes PNG, and
 * BITMAP_BASE::SaveData re-encodes to PNG), so this covers every image we can
 * be handed.
 */

import { schIUScale } from '@ziroeda/common/src/eda_units.js';
import { pixelSizeIu } from '@ziroeda/common/src/reference_image.js';
import type { SchImage } from '../types.js';

/** `BITMAP_BASE`'s default resolution when the file states none. */
export const DEFAULT_PPI = 300;

/**
 * The schematic's binding of `REFERENCE_IMAGE`, whose constructor takes the
 * frame's `EDA_IU_SCALE` (`SCH_BITMAP::m_referenceImage`, eeschema/sch_bitmap.h:137,
 * is built with `schIUScale`). The arithmetic itself is shared, exactly as
 * `REFERENCE_IMAGE::updatePixelSizeInIU` is shared upstream; only the scale is
 * the schematic's. Do not inline the number: 254000 is the schematic's IU per
 * inch and is wrong on a board by a factor of a hundred.
 */
export const iuPerPixel = (ppi: number): number => pixelSizeIu(schIUScale, ppi);

/** `m_pixelSizeIu` at the default resolution, the IU one pixel spans unscaled. */
export const IU_PER_PIXEL = iuPerPixel(DEFAULT_PPI);

/** The PNG magic, which the payload must open with for the offsets to hold. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Big-endian uint32 at `off`. */
const be32 = (b: Uint8Array, off: number): number =>
  ((b[off]! << 24) | (b[off + 1]! << 16) | (b[off + 2]! << 8) | b[off + 3]!) >>> 0;

/**
 * The first `n` bytes of a base64 payload, decoded, or fewer when the payload
 * is shorter than that. Callers check the length they actually need: the header
 * needs its 24 bytes, while a chunk scan is happy with whatever there is.
 */
function head(data: string, n: number): Uint8Array | null {
  // 4 base64 characters carry 3 bytes, so ceil(n/3) quads cover n bytes.
  const chars = Math.ceil(n / 3) * 4;
  const all = data.replace(/\s+/g, '');
  // Slicing on a quad boundary keeps the remainder decodable; a payload shorter
  // than that is taken whole, padding included.
  const b64 = all.length <= chars ? all : all.slice(0, chars);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    // Not decodable base64; the caller falls back.
    return null;
  }
}

/**
 * An image's size in pixels, or null if the payload is not a PNG we can read.
 *
 * The layout is fixed: 8 bytes of magic, then the IHDR chunk as a 4-byte
 * length, the 4-byte type, and width and height as big-endian uint32s.
 */
export function imagePixelSize(data: string): { w: number; h: number } | null {
  const b = head(data, 24);
  if (!b || b.length < 24) return null;
  for (let i = 0; i < PNG_MAGIC.length; i++) if (b[i] !== PNG_MAGIC[i]) return null;
  // Bytes 12..16 spell "IHDR"; anything else means a rearranged file we should
  // not guess at.
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  const w = be32(b, 16);
  const h = be32(b, 20);
  if (w === 0 || h === 0) return null;
  return { w, h };
}

/**
 * The image's own resolution, `BITMAP_BASE::GetPPI`.
 *
 * PNG states it in the optional pHYs chunk, as pixels per unit with a unit byte
 * where 1 means the metre. Upstream reads the same number through wxImage's
 * resolution options and rounds it to whole ppi. A file without the chunk keeps
 * BITMAP_BASE's 300, which is why every image looked like 300 ppi here before.
 */
export function imagePPI(data: string): number {
  // pHYs must precede IDAT, and the header plus a handful of ancillary chunks
  // fits well inside this; reading the whole payload to find it would mean
  // decoding megabytes of pixel data on every hit test.
  const b = head(data, 4096);
  if (!b) return DEFAULT_PPI;
  let off = 8; // past the magic
  while (off + 8 <= b.length) {
    const len = be32(b, off);
    const type = String.fromCharCode(b[off + 4]!, b[off + 5]!, b[off + 6]!, b[off + 7]!);
    const data0 = off + 8;
    if (type === 'IDAT' || type === 'IEND') break; // pixel data starts; no pHYs
    if (type === 'pHYs' && data0 + 9 <= b.length) {
      // unit 0 is "unknown", an aspect ratio only, which says nothing about size.
      const ppuX = be32(b, data0);
      const unit = b[data0 + 8];
      // `BITMAP_BASE::updatePPI` (common/bitmap_base.cpp:113-125) adopts the
      // file's resolution only `if( dpiX > 1 )` and keeps its 300 otherwise, so
      // GetPPI() is never zero and nothing downstream has to guard the division.
      // The same test is applied here, to the converted figure: without it a
      // pHYs stating a couple of dozen pixels per metre rounds to a PPI of zero,
      // and an image of infinite size is not a thing the canvas can draw.
      const ppi = Math.round((ppuX / 100) * 2.54);
      if (unit === 1 && ppi > 1) return ppi;
      return DEFAULT_PPI;
    }
    off = data0 + len + 4; // skip the payload and its CRC
    if (!Number.isSafeInteger(off) || len < 0) break;
  }
  return DEFAULT_PPI;
}

/**
 * `REFERENCE_IMAGE::GetSize`, the image's extent in IU: its pixel size times the
 * IU per pixel at its own resolution, times the `(scale …)` factor.
 *
 * Falls back to a small square when the payload cannot be read, so an
 * undecodable image is still selectable rather than invisible to hit-testing.
 */
export function imageSizeIU(im: SchImage): { w: number; h: number } {
  const px = imagePixelSize(im.data) ?? { w: 40, h: 40 };
  const k = iuPerPixel(imagePPI(im.data)) * im.scale;
  return { w: px.w * k, h: px.h * k };
}
