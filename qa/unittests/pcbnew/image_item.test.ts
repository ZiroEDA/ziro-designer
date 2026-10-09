// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reference images as real board items, and how much board they cover.
 * Counterparts: `BITMAP_BASE::GetSize`, `REFERENCE_IMAGE::GetBoundingBox`
 * (which is `BOX2I::ByCenter`), and `PCB_REFERENCE_IMAGE::HitTest`.
 *
 * Two rules carry this:
 *
 * - **`(at …)` is the middle of the picture, not a corner.** `GetBoundingBox`
 *   is `ByCenter`. Reading it as a top-left would put every image half its own
 *   size out of place — consistently enough to look deliberate rather than
 *   broken.
 * - **Pixels become board units through the file's own resolution.** A pixel
 *   spans 25.4 mm / ppi, from the PNG's `pHYs` chunk, falling back to
 *   `BITMAP_BASE`'s 300. `(scale …)` multiplies that rather than replacing it,
 *   so the same picture at 600 ppi covers a quarter of the area it does at 300.
 *
 * The fixtures are real PNG bytes built here rather than opaque blobs, so the
 * header offsets being parsed are the ones a KiCad file actually carries.
 */
import { describe, expect, it } from 'vitest';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { PCB_REFERENCE_IMAGE } from '@ziroeda/pcbnew/pcb_reference_image.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { FALLBACK_PIXELS, imageSizeIU, iuPerPixel } from '@ziroeda/pcbnew/pcb_reference_image.js';
import { DEFAULT_PPI, pngPPI, pngPixelSize } from '@ziroeda/common/wx/png_meta.js';
import { pngCrc32 } from '@ziroeda/common/png_encoder.js';
import { WX_IMAGE } from '@ziroeda/common/wx/wx_image.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';

const MM = (n: number): number => mmToIU(n);

/** Build a PNG header with the given pixel size and optional pHYs density. */
/**
 * A real PNG of `w` x `h` pixels — `wxImage::SaveFile` through WX_IMAGE, so
 * that `BITMAP_BASE::ReadImageFile` (libpng: CRCs checked, an IDAT required)
 * accepts it — with a `pHYs` of `ppuX` pixels per unit spliced in after the
 * IHDR when one is asked for, the unit byte as given (1 = metre).
 */
function png(w: number, h: number, ppuX?: number, unit = 1): string {
  const image = new WX_IMAGE(w, h);
  const base = image.SaveFilePng()!;
  if (ppuX === undefined) return btoa(String.fromCharCode(...base));
  const be32 = (n: number): number[] => [
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
  ];
  // pHYs: length 9, type, ppuX, ppuY, unit byte, then the CRC of type + data.
  const chunk = [...be32(9), 0x70, 0x48, 0x59, 0x73, ...be32(ppuX), ...be32(ppuX), unit];
  const crcOver = Uint8Array.from(chunk.slice(4));
  chunk.push(...be32(pngCrc32(crcOver)));
  // The IHDR chunk is the first after the 8-byte signature: 4 + 4 + 13 + 4 bytes.
  const afterIhdr = 8 + 4 + 4 + 13 + 4;
  const bytes = [...base.slice(0, afterIhdr), ...chunk, ...base.slice(afterIhdr)];
  return btoa(String.fromCharCode(...bytes));
}

/** The raw bytes behind a base64 fixture, so a test can corrupt one byte. */
const bytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** 300 ppi is the fallback, so this PNG states no density. */
const PNG_100x50 = png(100, 50);
/** 600 ppi: 23622 pixels per metre is 600 dpi. */
const PNG_100x50_600DPI = png(100, 50, 23622);

const IMAGE = (data = PNG_100x50, extra = '', layer = 'F.SilkS'): string => `(image
    (at 50 40)
    (layer "${layer}")
    ${extra}
    (data "${data}")
    (uuid "aaaaaaaa-1111-2222-3333-444444444444"))`;

const read = (...extra: string[]): BOARD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user) (5 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${extra.join('\n  ')}
)`);
const imageOf = (b: BOARD): PCB_REFERENCE_IMAGE =>
  b.Drawings().find((d) => d.Type() === KICAD_T.PCB_REFERENCE_IMAGE_T) as PCB_REFERENCE_IMAGE;

describe('reading the PNG header', () => {
  it('reads the pixel size', () => {
    expect(pngPixelSize(PNG_100x50)).toEqual({ w: 100, h: 50 });
  });

  it('refuses something that is not a PNG', () => {
    expect(pngPixelSize(btoa('not a png at all, just some text here'))).toBeNull();
  });

  it('refuses undecodable base64', () => {
    expect(pngPixelSize('!!!not base64!!!')).toBeNull();
  });

  it('refuses a file with the right chunk but the wrong magic', () => {
    // Binds the magic check on its own. The generic "not a PNG" fixture above
    // fails the magic *and* the IHDR test, so each masks the other's removal —
    // dropping either alone still returned null and both mutations survived.
    const b = [...bytes(png(100, 50))];
    b[0] = 0x00; // break only the signature
    expect(pngPixelSize(btoa(String.fromCharCode(...b)))).toBeNull();
  });

  it('refuses a file whose first chunk is not IHDR', () => {
    // Binds the IHDR check on its own: valid magic, IDAT where IHDR belongs.
    const b = [...bytes(png(100, 50))];
    b[12] = 0x49;
    b[13] = 0x44;
    b[14] = 0x41;
    b[15] = 0x54; // "IDAT"
    expect(pngPixelSize(btoa(String.fromCharCode(...b)))).toBeNull();
  });

  it('falls back to 300 ppi when the file states none', () => {
    expect(pngPPI(PNG_100x50)).toBe(DEFAULT_PPI);
  });

  it('reads a stated density the way wx and BITMAP_BASE do', () => {
    // 600 dpi is 23622 px/m; wxPNGHandler makes that 236 dots/cm by integer division and
    // BITMAP_BASE::updatePPI KiROUNDs 236 x 2.54 = 599.44 -> 599. KiCad's own python
    // reads a 600 dpi PNG as 599 ppi (the board box is 13 px x 25400000 / 599 wide).
    expect(pngPPI(PNG_100x50_600DPI)).toBe(599);
  });

  it('ignores a density whose unit is unknown', () => {
    // Unit 0 is an aspect ratio only and says nothing about physical size.
    expect(pngPPI(png(100, 50, 23622, 0))).toBe(DEFAULT_PPI);
  });

  it('ignores a density too small to be a resolution', () => {
    // `BITMAP_BASE::updatePPI` (common/bitmap_base.cpp:113-125) takes the file's
    // resolution only `if( dpiX > 1 )` and keeps its 300 otherwise. Without that
    // test a pHYs of a couple of dozen pixels per metre rounds to a PPI of zero,
    // which every consumer then divides by, giving an image of infinite size.
    // Anything under 100 px/m is 0 dots/cm after wx's integer division, so it fails `dpiX > 1`.
    for (const ppuX of [1, 19, 40, 59, 99]) {
      expect(pngPPI(png(100, 50, ppuX))).toBe(DEFAULT_PPI);
      expect(Number.isFinite(imageSizeIU({ data: png(100, 50, ppuX) }).w)).toBe(true);
    }

    // 200 px/m is 2 dots/cm, which passes the test: 2 x 2.54 = 5.08 -> 5 ppi.
    expect(pngPPI(png(100, 50, 200))).toBe(5);
  });
});

describe('how much board an image covers (imageSizeIU)', () => {
  it('turns pixels into IU through the resolution', () => {
    // 100 px at 300 ppi is a third of an inch, 8.4667 mm.
    const size = imageSizeIU({ data: PNG_100x50 });

    expect(size.w / iuPerPixel(300) / 100).toBeCloseTo(1, 6);
    expect(size.w / MM(25.4 / 3)).toBeCloseTo(1, 4);
  });

  it('shrinks with the resolution: a "600 dpi" file reads as 599 ppi', () => {
    const at300 = imageSizeIU({ data: PNG_100x50 });
    const at600 = imageSizeIU({ data: PNG_100x50_600DPI });

    expect(at600.w / at300.w).toBeCloseTo(300 / 599, 6);
  });

  it('multiplies by the scale, rather than replacing the resolution', () => {
    const plain = imageSizeIU({ data: PNG_100x50 });
    const scaled = imageSizeIU({ data: PNG_100x50, scale: 2 });

    expect(scaled.w / plain.w).toBeCloseTo(2, 6);
  });

  it('keeps the aspect ratio', () => {
    const size = imageSizeIU({ data: PNG_100x50 });

    expect(size.w / size.h).toBeCloseTo(2, 6);
  });

  it('refuses a payload it cannot read, as the C++ parser does', () => {
    // `parsePCB_REFERENCE_IMAGE`: "Failed to read image data." — the board
    // does not load with a broken image in it.
    expect(() => read(IMAGE(btoa('garbage')))).toThrow('Failed to read image data.');
  });

  it('falls back to a small square for a payload it cannot read', () => {
    const size = imageSizeIU({ data: btoa('garbage') });

    expect(size.w).toBe(Math.round(FALLBACK_PIXELS.w * iuPerPixel(DEFAULT_PPI)));
    expect(size.w).toBeGreaterThan(0);
  });
});

describe('the bounding box (PCB_REFERENCE_IMAGE::GetBoundingBox)', () => {
  it('is centred on the position, not cornered at it', () => {
    // REFERENCE_IMAGE::GetBoundingBox is BOX2I::ByCenter. Reading `(at …)` as a
    // top-left would put every image half its own size out of place.
    const b = imageOf(read(IMAGE())).GetBoundingBox();
    const size = imageSizeIU({ data: PNG_100x50 });

    // ByCenter rounds the half-size (VECTOR2<int> / 2 is KiROUND), so an odd
    // size leaves the centre half an IU off. The width, though, is exact.
    expect(b.Centre().x).toBeCloseTo(MM(50), -1);
    expect(b.Centre().y).toBeCloseTo(MM(40), -1);
    expect(b.GetWidth()).toBe(size.w);
    expect(b.GetHeight()).toBe(size.h);
  });

  it('grows about the same centre as the scale grows', () => {
    const b1 = imageOf(read(IMAGE())).GetBoundingBox();
    const b2 = imageOf(read(IMAGE(PNG_100x50, '(scale 2)'))).GetBoundingBox();

    expect(b2.Centre().x).toBe(b1.Centre().x);
    expect(b2.GetWidth()).toBeGreaterThan(b1.GetWidth());
  });
});
