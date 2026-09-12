// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A board text in an outline face is filled glyph rings in the scene, not
 * a stroked Newstroke run — `PCB_PAINTER::draw( const PCB_TEXT* )` takes an
 * outline font's render cache to `DrawGlyphs` (pcb_painter.cpp:2573-2579),
 * which fills. And KiCad sizes an outline glyph by `glyphSize.x` across and
 * `glyphSize.y` down separately (outline_font.cpp:398-400), so a condensed
 * `(size 1.5 0.6)` text is condensed in the layout, not squeezed after.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import { buildScene } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import {
  getOutlineFont,
  resetOutlineFonts,
  setFaceFetcher,
} from '@ziroeda/designer/src/font/outline_fonts.js';

const FONTS = fileURLToPath(new URL('../../../designer/public/fonts/', import.meta.url));

/** A Path2D that keeps its points, so the scene's geometry can be read back. */
class RecordingPath2D {
  pts: { x: number; y: number }[] = [];
  rings = 0;
  moveTo(x: number, y: number): void {
    this.pts.push({ x, y });
  }
  lineTo(x: number, y: number): void {
    this.pts.push({ x, y });
  }
  closePath(): void {
    this.rings++;
  }
  arc(): void {}
  arcTo(): void {}
  rect(): void {}
  roundRect(): void {}
  addPath(): void {}
}
(globalThis as unknown as { Path2D: unknown }).Path2D = RecordingPath2D;

const board = (font: string): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  (gr_text "Hello" (at 50 50) (layer "F.SilkS")
    (uuid "11111111-0000-0000-0000-000000000001")
    (effects (font ${font})))
)`),
  );

type Buckets = {
  textBoard: Map<number, RecordingPath2D>;
  textBoardFill: RecordingPath2D;
  hasTextFill: boolean;
};
const silk = (font: string): Buckets =>
  buildScene(board(font)).layers.get('F.SilkS') as unknown as Buckets;

afterEach(() => resetOutlineFonts());

async function loadArial(): Promise<void> {
  setFaceFetcher(async (file) => {
    const b = readFileSync(FONTS + file);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
  getOutlineFont('Arial');
  await new Promise((r) => setTimeout(r, 30));
  expect(getOutlineFont('Arial')).not.toBeNull();
}

const extents = (pts: { x: number; y: number }[]) => ({
  w: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)),
  h: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)),
  cx: (Math.max(...pts.map((p) => p.x)) + Math.min(...pts.map((p) => p.x))) / 2,
});

describe('a board text in an outline face', () => {
  it('goes to the fill bucket as closed rings, and nothing to the stroke maps', async () => {
    await loadArial();
    const b = silk('(face "Arial") (size 1.5 1.5)');
    expect(b.hasTextFill).toBe(true);
    // "Hello": H, e (2), l, l, o (2) — seven rings.
    expect(b.textBoardFill.rings).toBe(7);
    expect(b.textBoard.size).toBe(0);
  });

  it('with no face, or a face not yet loaded, is stroked as before', () => {
    const b = silk('(size 1.5 1.5)');
    expect(b.hasTextFill).toBe(false);
    expect(b.textBoard.size).toBe(1);
    setFaceFetcher(() => new Promise(() => {}));
    const b2 = silk('(face "Arial") (size 1.5 1.5)');
    expect(b2.hasTextFill).toBe(false);
    expect(b2.textBoard.size).toBe(1);
  });

  it('is centred on its anchor, with the cap about the text height and an em 1.4 of it', async () => {
    await loadArial();
    const b = silk('(face "Arial") (size 1.5 1.5)');
    const e = extents(b.textBoardFill.pts);
    // Centre/centre justification: the run is centred by its ADVANCE
    // (`getLinePositions` uses the cursor extents), so the ink's middle is off
    // the anchor by the difference of the end bearings — under a tenth of an
    // em here, 0.21 mm at 1.4 × 1.5.
    expect(Math.abs(e.cx - mmToIU(50))).toBeLessThan(mmToIU(0.21));
    // 'H' to 'l' top and the 'o' overshoot bottom: Liberation Sans' ascender
    // of 'l' is 0.729 em, at 1.4 × 1.5 mm.
    expect(e.h).toBeGreaterThan(mmToIU(1.5));
    expect(e.h).toBeLessThan(mmToIU(1.6));
  });

  it('a condensed (size h w) text is narrower by w/h, in the layout itself', async () => {
    await loadArial();
    const square = extents(silk('(face "Arial") (size 1.5 1.5)').textBoardFill.pts);
    const condensed = extents(silk('(face "Arial") (size 1.5 0.6)').textBoardFill.pts);
    expect(condensed.w / square.w).toBeCloseTo(0.6 / 1.5, 2);
    expect(condensed.h).toBeCloseTo(square.h, -1);
  });
});
