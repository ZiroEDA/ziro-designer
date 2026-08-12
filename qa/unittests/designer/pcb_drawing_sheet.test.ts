// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board's page frame is the same drawing as the schematic's.
 *
 * pcbnew and eeschema render one drawing sheet in KiCad, from one description.
 * Here the board had a second, hand-drawn one: fixed margins, a fixed double
 * border and a title block laid out from remembered dimensions. It looked close
 * and was not the same drawing, so a board beside the same board in KiCad did
 * not line up, and a project's own `.kicad_wks` did nothing to it.
 *
 * Comparing the two layouts directly is what keeps them from drifting apart
 * again: the assertion is not "the board draws something", it is "the board
 * draws what the schematic draws".
 */
import { describe, it, expect } from 'vitest';
import {
  defaultDrawingSheet,
  layoutDrawingSheet,
  PCB_IU_PER_MM,
  type WksResolveContext,
} from '@ziroeda/common';
import { drawDrawingSheet } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';

const A4 = { widthMM: 297, heightMM: 210 };

const context = (over: Partial<WksResolveContext> = {}): WksResolveContext => ({
  pageNumber: 1,
  sheetCount: 1,
  title: 'Carrier',
  rev: 'B',
  date: '2026-08-12',
  company: 'ZiroEDA',
  comments: ['first', 'second'],
  paper: 'A4',
  fileName: 'board.kicad_pcb',
  sheetPath: '/',
  appVersion: 'ZiroEDA',
  ...over,
});

describe('the board page frame', () => {
  it('is laid out by the shared engine, not a second implementation', () => {
    const items = layoutDrawingSheet(defaultDrawingSheet(), A4, context());

    // The default sheet is a frame plus a title block, so this is a real
    // drawing rather than an empty list quietly standing in for one.
    expect(items.length).toBeGreaterThan(20);
  });

  it('substitutes the title block from the board, comments included', () => {
    const texts = layoutDrawingSheet(defaultDrawingSheet(), A4, context())
      .map((i) => (i as { text?: string }).text)
      .filter((t): t is string => typeof t === 'string');

    expect(texts.join('\n')).toContain('Carrier');
    expect(texts.join('\n')).toContain('board.kicad_pcb');
    // The comment lines are the part a hand-rolled title block leaves out, and
    // the board model has carried them all along.
    expect(texts.join('\n')).toContain('first');
    expect(texts.join('\n')).toContain('second');
  });

  it('moves the frame with the page size, rather than assuming one', () => {
    const a4 = layoutDrawingSheet(defaultDrawingSheet(), A4, context());
    const a3 = layoutDrawingSheet(
      defaultDrawingSheet(),
      { widthMM: 420, heightMM: 297 },
      context({ paper: 'A3' }),
    );

    /** The rightmost x any item reaches, whatever kind of item it is. */
    const far = (items: typeof a4): number => {
      let max = 0;
      const walk = (v: unknown): void => {
        if (!v || typeof v !== 'object') return;
        const o = v as Record<string, unknown>;
        if (typeof o.x === 'number') max = Math.max(max, o.x);
        for (const child of Object.values(o)) walk(child);
      };
      walk(items);
      return max;
    };

    expect(far(a3)).toBeGreaterThan(far(a4));
  });
});

/**
 * A canvas that records where the drawing actually lands, in the units the
 * board's own transform is in.
 *
 * The engine lays out in schematic internal units and the board canvas is in
 * board units, a hundred times finer. Testing `layoutDrawingSheet` on its own
 * says nothing about that: the first version of this change asked for the page
 * in the wrong units *and* drew the result at 1/100 scale, and every assertion
 * against the engine still passed while the sheet was invisible on screen.
 */
function recordingCtx(): { ctx: CanvasRenderingContext2D; extent: () => number } {
  let scale = 1;
  let max = 0;
  const note = (x: number): void => {
    max = Math.max(max, Math.abs(x) * scale);
  };
  const ctx = {
    save() {},
    restore() {},
    scale(sx: number) {
      scale *= sx;
    },
    beginPath() {},
    closePath() {},
    stroke() {},
    fill() {},
    moveTo: (x: number) => note(x),
    lineTo: (x: number) => note(x),
    rect: (x: number, _y: number, w: number) => note(x + w),
    strokeRect: (x: number, _y: number, w: number) => note(x + w),
    fillRect: (x: number, _y: number, w: number) => note(x + w),
    arc: (x: number) => note(x),
    quadraticCurveTo: (_cx: number, _cy: number, x: number) => note(x),
    bezierCurveTo: (_a: number, _b: number, _c: number, _d: number, x: number) => note(x),
    setTransform() {},
    translate() {},
    rotate() {},
    measureText: () => ({ width: 0 }),
    fillText: (_t: string, x: number) => note(x),
    strokeText: (_t: string, x: number) => note(x),
    set lineWidth(_v: number) {},
    set strokeStyle(_v: string) {},
    set fillStyle(_v: string) {},
    set font(_v: string) {},
    set lineCap(_v: string) {},
    set lineJoin(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, extent: () => max };
}

describe('the board page frame, as the board draws it', () => {
  it('lands at board scale, spanning the page', () => {
    const { ctx, extent } = recordingCtx();

    drawDrawingSheet(ctx, {
      paper: 'A4',
      titleBlock: { title: 'Carrier' },
      fileName: 'b.kicad_pcb',
    });

    // An A4 page is 297 mm wide, so the frame has to reach most of the way
    // across it in board units. A hundredfold error in either direction — the
    // page size or the item scale — fails this by orders of magnitude.
    const mm = extent() / PCB_IU_PER_MM;
    expect(mm).toBeGreaterThan(250);
    expect(mm).toBeLessThan(300);
  });

  it('draws nothing for a page size it does not know', () => {
    const { ctx, extent } = recordingCtx();
    drawDrawingSheet(ctx, { paper: 'Origami' });
    expect(extent()).toBe(0);
  });
});
