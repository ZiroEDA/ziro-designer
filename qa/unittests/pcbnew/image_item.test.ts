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
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  allBoardItemIds,
  boardItemBBox,
  boardItemsInBox,
  deleteBoardItems,
  hitTestBoard,
  isBoardItemLocked,
  moveBoardItems,
} from '@ziroeda/pcbnew/src/edit-board.js';
import { itemAnchorPoint } from '@ziroeda/pcbnew/src/move_exact.js';
import {
  DEFAULT_SELECTION_FILTER,
  itemPassesFilter,
} from '@ziroeda/pcbnew/src/filter_selection.js';
import {
  FALLBACK_PIXELS,
  imageBBox,
  imageSizeIU,
  iuPerPixel,
} from '@ziroeda/pcbnew/src/image_geometry.js';
import { DEFAULT_PPI, pngPPI, pngPixelSize } from '@ziroeda/common/src/png_meta.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const IMG = 'image:0';

/** Build a PNG header with the given pixel size and optional pHYs density. */
function png(w: number, h: number, ppuX?: number, unit = 1): string {
  const bytes: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const be32 = (n: number): number[] => [
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
  ];
  // IHDR: length 13, type, width, height, then the rest of the header.
  bytes.push(
    ...be32(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...be32(w),
    ...be32(h),
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  );
  if (ppuX !== undefined) {
    // pHYs: length 9, type, ppuX, ppuY, unit byte.
    bytes.push(...be32(9), 0x70, 0x48, 0x59, 0x73, ...be32(ppuX), ...be32(ppuX), unit, 0, 0, 0, 0);
  }
  // IEND, so the chunk walk terminates the way a real file does.
  bytes.push(...be32(0), 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0);
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

const read = (...extra: string[]): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${extra.join('\n  ')}
)`),
  );

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

  it('reads a stated density', () => {
    expect(pngPPI(PNG_100x50_600DPI)).toBe(600);
  });

  it('ignores a density whose unit is unknown', () => {
    // Unit 0 is an aspect ratio only and says nothing about physical size.
    expect(pngPPI(png(100, 50, 23622, 0))).toBe(DEFAULT_PPI);
  });
});

describe('how much board an image covers', () => {
  it('turns pixels into IU through the resolution', () => {
    // 100 px at 300 ppi is a third of an inch, 8.4667 mm.
    const size = imageSizeIU(read(IMAGE()).images[0]!);

    expect(size.w / iuPerPixel(300) / 100).toBeCloseTo(1, 6);
    expect(size.w / MM(25.4 / 3)).toBeCloseTo(1, 4);
  });

  it('halves with twice the resolution', () => {
    // The same picture at 600 ppi is half as wide on the board.
    const at300 = imageSizeIU(read(IMAGE(PNG_100x50)).images[0]!);
    const at600 = imageSizeIU(read(IMAGE(PNG_100x50_600DPI)).images[0]!);

    expect(at600.w / at300.w).toBeCloseTo(0.5, 6);
  });

  it('multiplies by the scale, rather than replacing the resolution', () => {
    const plain = imageSizeIU(read(IMAGE()).images[0]!);
    const scaled = imageSizeIU(read(IMAGE(PNG_100x50, '(scale 2)')).images[0]!);

    expect(scaled.w / plain.w).toBeCloseTo(2, 6);
  });

  it('keeps the aspect ratio', () => {
    const size = imageSizeIU(read(IMAGE()).images[0]!);

    expect(size.w / size.h).toBeCloseTo(2, 6);
  });

  it('falls back to a small square when the payload cannot be read', () => {
    // So a broken image is still selectable rather than a zero-size ghost.
    const broken = read(IMAGE(btoa('garbage'))).images[0]!;
    const size = imageSizeIU(broken);

    expect(size.w).toBe(Math.round(FALLBACK_PIXELS.w * iuPerPixel(DEFAULT_PPI)));
    expect(size.w).toBeGreaterThan(0);
  });
});

describe('the bounding box', () => {
  it('is centred on the position, not cornered at it', () => {
    // REFERENCE_IMAGE::GetBoundingBox is BOX2I::ByCenter. Reading `(at …)` as a
    // top-left would put every image half its own size out of place.
    const img = read(IMAGE()).images[0]!;
    const b = imageBBox(img);
    const size = imageSizeIU(img);

    // ByCenter truncates the half-size, so an odd size leaves the centre half
    // an IU off — a nanometre. The width, though, is exact.
    expect((b.minX + b.maxX) / 2).toBeCloseTo(MM(50), -1);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(MM(40), -1);
    expect(b.maxX - b.minX).toBe(size.w);
    expect(b.maxY - b.minY).toBe(size.h);
  });

  it('grows about the same centre as the scale grows', () => {
    const b1 = imageBBox(read(IMAGE()).images[0]!);
    const b2 = imageBBox(read(IMAGE(PNG_100x50, '(scale 2)')).images[0]!);

    expect((b2.minX + b2.maxX) / 2).toBe((b1.minX + b1.maxX) / 2);
    expect(b2.maxX - b2.minX).toBeGreaterThan(b1.maxX - b1.minX);
  });
});

describe('images as board items', () => {
  it('are enumerated', () => {
    expect(allBoardItemIds(read(IMAGE()))).toContain(IMG);
  });

  it('report a bounding box through the board', () => {
    expect(boardItemBBox(read(IMAGE()), IMG)).not.toBeNull();
    expect(boardItemBBox(read(IMAGE()), 'image:9')).toBeNull();
  });

  it('are clickable anywhere inside', () => {
    expect(hitTestBoard(read(IMAGE()), { x: MM(50), y: MM(40) }, 0)).toBe(IMG);
  });

  it('are not clickable well outside', () => {
    expect(hitTestBoard(read(IMAGE()), { x: MM(200), y: MM(200) }, MM(0.2))).toBeNull();
  });

  it('are taken by a box that crosses them', () => {
    expect(boardItemsInBox(read(IMAGE()), MM(49), MM(39), MM(51), MM(41), false)).toContain(IMG);
  });

  it('follow the layer-based graphics filter', () => {
    const f = (over = {}) => ({ ...DEFAULT_SELECTION_FILTER, ...over });

    expect(itemPassesFilter(read(IMAGE()), IMG, f({ techLayers: true }))).toBe(true);
    expect(itemPassesFilter(read(IMAGE()), IMG, f({ techLayers: false }))).toBe(false);
    expect(
      itemPassesFilter(read(IMAGE(PNG_100x50, '', 'Edge.Cuts')), IMG, f({ boardOutline: false })),
    ).toBe(false);
  });

  it('anchor on the centre, which is the position', () => {
    expect(itemAnchorPoint(read(IMAGE()), IMG)).toEqual({ x: MM(50), y: MM(40) });
  });

  it('read the locked flag', () => {
    expect(isBoardItemLocked(read(IMAGE(PNG_100x50, '(locked yes)')), IMG)).toBe(true);
    expect(isBoardItemLocked(read(IMAGE()), IMG)).toBe(false);
  });
});

describe('moving an image', () => {
  it('shifts the position', () => {
    const b = moveBoardItems(read(IMAGE()), new Set([IMG]), { x: MM(5), y: MM(-3) });

    expect(b.images[0]!.at).toEqual({ x: MM(55), y: MM(37) });
  });

  it('survives a save and reload', () => {
    const moved = moveBoardItems(read(IMAGE()), new Set([IMG]), { x: MM(5), y: 0 });
    const back = readBoard(parse(serializeBoard(moved)));

    expect(back.images[0]!.at).toEqual({ x: MM(55), y: MM(40) });
  });

  it('leaves the payload byte-for-byte alone', () => {
    // The data is megabytes in a real file; a mover that rebuilt the node would
    // rewrite all of it on every nudge.
    const moved = moveBoardItems(read(IMAGE()), new Set([IMG]), { x: MM(5), y: 0 });
    const back = readBoard(parse(serializeBoard(moved)));

    expect(back.images[0]!.data).toBe(PNG_100x50);
  });

  it('leaves an unselected image alone', () => {
    const b = moveBoardItems(read(IMAGE()), new Set(['shape:0']), { x: MM(5), y: 0 });

    expect(b.images[0]!.at).toEqual({ x: MM(50), y: MM(40) });
  });
});

describe('deleting an image', () => {
  it('removes it from the model and the file', () => {
    const out = serializeBoard(deleteBoardItems(read(IMAGE()), new Set([IMG])));

    expect(readBoard(parse(out)).images).toHaveLength(0);
    expect(out).not.toContain('(image');
  });
});
