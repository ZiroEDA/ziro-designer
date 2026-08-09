// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Show Grid" has to be honoured by `drawGrid` itself, not by whoever calls it.
 *
 * It used to be checked one level up, in `renderSchematic`, which was fine
 * while that was the only caller. Then the WebGL backend became the default
 * renderer: the grid is genuinely zoom-dependent and drawn in device space, so
 * it stays on the 2D layer underneath and `SchematicCanvas` calls `drawGrid`
 * directly on both GL paths. Those calls never saw the gate, so the toolbar's
 * grid button did nothing at all on the default renderer — the one place a
 * user would ever press it.
 *
 * The gate lives in `drawGrid` now, so a future caller cannot lose it again.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RENDER_OPTS,
  drawGrid,
  renderSchematic,
  setVectorText,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

// `drawGrid` batches its ticks into a cached `Path2D`, which Node has no
// implementation of. It is only ever handed back to `stroke`/`fill`, so an
// inert stand-in is enough to let the geometry pass run.
class FakePath2D {
  moveTo(): void {}
  lineTo(): void {}
  rect(): void {}
  arc(): void {}
  closePath(): void {}
  addPath(): void {}
}
(globalThis as { Path2D?: unknown }).Path2D ??= FakePath2D;

/** Counts every mark a grid could be drawn with: strokes, fills and arcs. */
function spy(): { marks: () => number; ctx: CanvasRenderingContext2D } {
  let n = 0;
  const noop = (): void => {};
  const bump = (): void => {
    n += 1;
  };
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    setTransform: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    bezierCurveTo: noop,
    clip: noop,
    fillText: noop,
    drawImage: noop,
    arc: bump,
    fill: bump,
    stroke: bump,
    fillRect: bump,
    strokeRect: bump,
  };
  return { marks: () => n, ctx: ctx as unknown as CanvasRenderingContext2D };
}

const VIEW = { scale: 0.02, offsetX: 0, offsetY: 0 };
const GRID = DEFAULT_RENDER_OPTS.grid;

describe('drawGrid honours Show Grid', () => {
  for (const style of ['dots', 'lines', 'crosses'] as const) {
    it(`draws something with ${style} when it is on`, () => {
      const s = spy();
      drawGrid(s.ctx, VIEW, KICAD_DEFAULT, 800, 600, { ...GRID, style, show: true });
      expect(s.marks()).toBeGreaterThan(0);
    });

    it(`and nothing at all with ${style} when it is off`, () => {
      const s = spy();
      drawGrid(s.ctx, VIEW, KICAD_DEFAULT, 800, 600, { ...GRID, style, show: false });
      expect(s.marks()).toBe(0);
    });
  }
});

describe('and so does the whole-scene painter, through it', () => {
  // An empty sheet, so the grid is the only thing that varies between the two
  // passes; the one mark left over with it off is the background fill.
  const doc: Schematic = readSchematic(parse('(kicad_sch (version 20250114) (lib_symbols))'));
  const paint = (show: boolean): number => {
    const s = spy();
    setVectorText(true);
    try {
      renderSchematic(s.ctx, doc, VIEW, KICAD_DEFAULT, 800, 600, undefined, undefined, {
        ...DEFAULT_RENDER_OPTS,
        grid: { ...GRID, show },
        showDrawingSheet: false,
      });
    } finally {
      setVectorText(false);
    }
    return s.marks();
  };

  it('paints the grid when it is on and not when it is off', () => {
    const off = paint(false);
    expect(paint(true)).toBeGreaterThan(off);
    // Nothing but the background: no tick survives the toggle.
    expect(off).toBe(1);
  });
});
