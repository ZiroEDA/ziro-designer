// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Image-file metadata for the Image Converter, the browser stand-in for what
 * `BITMAP2CMP_PANEL::OpenProjectFiles` reads through wxImage: the embedded
 * resolution (`wxIMAGE_OPTION_RESOLUTIONX/Y`, converted from per-cm when
 * needed) and the bitmap depth shown as "BPP". Canvas decoding flattens both
 * away, so the resolution is parsed from the file bytes: PNG `pHYs`, JPEG JFIF
 * density, BMP `biXPelsPerMeter`. Anything else falls back to KiCad's
 * DEFAULT_DPI (300). The depth is not a file-header fact -- see `bitmapDepth`.
 */

const DEFAULT_DPI = 300;

export interface ImageMeta {
  dpiX: number;
  dpiY: number;
}

/**
 * The "BPP" readout, `m_Pict_Bitmap.GetDepth()` in
 * `BITMAP2CMP_PANEL::updateImageInfo` (bitmap2cmp_panel.cpp:297), where
 * `m_Pict_Bitmap` is `wxBitmap( m_Pict_Image )`.
 *
 * The depth is NOT the file's declared channel count. wxImage only keeps an
 * alpha channel when the decoder found a pixel that is not fully opaque (the
 * PNG handler's Transparency_None case throws it away), and wxBitmap is then
 * 24-bit. Probed against the installed wxGTK 3.2, the library KiCad 10.0.5
 * links: an RGBA PNG whose alpha is 255 everywhere reports 24, the same file
 * with one pixel at alpha 0 or 128 reports 32, a plain RGB PNG reports 24.
 *
 * Reading the canvas' own RGBA buffer instead reports 32 for everything, which
 * is why a screenshot that KiCad calls 24-bit read as 32-bit here.
 */
export function bitmapDepth(pixels: Uint8ClampedArray): number {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i]! < 255) return 32;
  }
  return 24;
}

const u32be = (b: Uint8Array, o: number): number =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16be = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const u32le = (b: Uint8Array, o: number): number =>
  ((b[o + 3]! << 24) | (b[o + 2]! << 16) | (b[o + 1]! << 8) | b[o]!) >>> 0;

const isPng = (b: Uint8Array): boolean =>
  b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array): boolean => b.length > 4 && b[0] === 0xff && b[1] === 0xd8;
const isBmp = (b: Uint8Array): boolean => b.length > 46 && b[0] === 0x42 && b[1] === 0x4d;

function pngMeta(b: Uint8Array): ImageMeta {
  let dpiX = 0;
  let dpiY = 0;
  let off = 8;
  while (off + 8 <= b.length) {
    const len = u32be(b, off);
    const type = String.fromCharCode(b[off + 4]!, b[off + 5]!, b[off + 6]!, b[off + 7]!);
    if (type === 'pHYs' && len >= 9) {
      const d = off + 8;
      if (b[d + 8] === 1) {
        // pixels per metre → DPI
        dpiX = Math.round(u32be(b, d) * 0.0254);
        dpiY = Math.round(u32be(b, d + 4) * 0.0254);
      }
      break;
    }
    if (type === 'IDAT' || type === 'IEND') break;
    off += 12 + len;
  }
  return { dpiX, dpiY };
}

function jpegMeta(b: Uint8Array): ImageMeta {
  // Walk the JFIF APP0 marker: units byte then X/Y density.
  let off = 2;
  while (off + 4 <= b.length && b[off] === 0xff) {
    const marker = b[off + 1]!;
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan
    const len = u16be(b, off + 2);
    if (marker === 0xe0 && len >= 16) {
      const d = off + 4;
      const jfif = String.fromCharCode(b[d]!, b[d + 1]!, b[d + 2]!, b[d + 3]!);
      if (jfif === 'JFIF') {
        const units = b[d + 7]!;
        const dx = u16be(b, d + 8);
        const dy = u16be(b, d + 10);
        if (units === 1) return { dpiX: dx, dpiY: dy };
        if (units === 2) return { dpiX: Math.round(dx * 2.54), dpiY: Math.round(dy * 2.54) };
        return { dpiX: 0, dpiY: 0 };
      }
    }
    off += 2 + len;
  }
  return { dpiX: 0, dpiY: 0 };
}

function bmpMeta(b: Uint8Array): ImageMeta {
  // BITMAPINFOHEADER at offset 14: XPelsPerMeter/YPelsPerMeter at +24/+28.
  const ppmX = u32le(b, 14 + 24);
  const ppmY = u32le(b, 14 + 28);
  return { dpiX: Math.round(ppmX * 0.0254), dpiY: Math.round(ppmY * 0.0254) };
}

/**
 * Read the resolution and depth of an image file. Mirrors KiCad's fallback:
 * a resolution is only trusted when both axes are > 1, otherwise DEFAULT_DPI.
 */
export function imageMeta(bytes: Uint8Array): ImageMeta {
  let m: ImageMeta = { dpiX: 0, dpiY: 0 };
  if (isPng(bytes)) m = pngMeta(bytes);
  else if (isJpeg(bytes)) m = jpegMeta(bytes);
  else if (isBmp(bytes)) m = bmpMeta(bytes);
  if (!(m.dpiX > 1 && m.dpiY > 1)) {
    m.dpiX = DEFAULT_DPI;
    m.dpiY = DEFAULT_DPI;
  }
  return m;
}
