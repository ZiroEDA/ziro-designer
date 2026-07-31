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

import type { SchImage } from '../types.js';

/**
 * `BITMAP_BASE::m_pixelSizeIu`, the IU one image pixel spans before scaling:
 * 25.4 mm over the default 300 ppi.
 */
export const IU_PER_PIXEL = 254000 / 300;

/** The PNG magic, which the payload must open with for the offsets to hold. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Big-endian uint32 at `off`. */
const be32 = (b: Uint8Array, off: number): number =>
  ((b[off]! << 24) | (b[off + 1]! << 16) | (b[off + 2]! << 8) | b[off + 3]!) >>> 0;

/** The first `n` bytes of a base64 payload, decoded. */
function head(data: string, n: number): Uint8Array | null {
  // 4 base64 characters carry 3 bytes, so ceil(n/3) quads cover n bytes.
  const chars = Math.ceil(n / 3) * 4;
  const b64 = data.replace(/\s+/g, '').slice(0, chars);
  if (b64.length < chars) return null;
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
 * `REFERENCE_IMAGE::GetSize`, the image's extent in IU: its pixel size times the
 * IU-per-pixel constant times the `(scale …)` factor.
 *
 * Falls back to a small square when the payload cannot be read, so an
 * undecodable image is still selectable rather than invisible to hit-testing.
 */
export function imageSizeIU(im: SchImage): { w: number; h: number } {
  const px = imagePixelSize(im.data) ?? { w: 40, h: 40 };
  return { w: px.w * IU_PER_PIXEL * im.scale, h: px.h * IU_PER_PIXEL * im.scale };
}
