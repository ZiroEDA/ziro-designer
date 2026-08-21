// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The grid is anchored on the board's grid origin, not on the world origin.
 *
 * A board carries `(setup (grid_origin x y))`, and pcbnew installs it on the GAL
 * the moment the board opens (`pcb_base_edit_frame.cpp`:
 * `GetGAL()->SetGridOrigin( aBoard->GetDesignSettings().GetGridOrigin() )`).
 * Everything grid-shaped then measures from it: `CAIRO_GAL_BASE::DrawGrid`
 * offsets every dot by `m_gridOrigin`, and `GRID_HELPER::AlignGrid` rounds about
 * `GRID_HELPER::GetOrigin()`, which reads the same value straight back off the
 * GAL.
 *
 * We had (0, 0) hardcoded into both. On a board whose origin is a whole number
 * of steps from the world origin that is invisible — which is most of them, and
 * why it lasted — and on one where it is not, every dot sits a fixed fraction of
 * a step away from the tracks and pads KiCad placed on the grid.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { boardGridOrigin } from '@ziroeda/pcbnew/src/plot_gerber.js';
import { snapToGridSize } from '@ziroeda/designer/src/editors/pcb/pcb_grid.js';
import { pcbGridOptions } from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { drawGrid, visibleGridStep } from '@ziroeda/designer/src/ui/grid_cursor.js';

const MM = 1e6;

const boardWith = (setup: string) =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  ${setup}
)`),
  );

describe('boardGridOrigin', () => {
  it('reads the setup entry, and defaults to the world origin without one', () => {
    // Whole internal units, as KiCad stores them — 33.02 mm * 1e6 is not
    // exactly representable, so `mmToIU` rounds and this must not be spelled
    // as the float product.
    expect(boardGridOrigin(boardWith('(setup (grid_origin 33.02 118.745))'))).toEqual({
      x: 33_020_000,
      y: 118_745_000,
    });
    expect(boardGridOrigin(boardWith('(setup)'))).toEqual({ x: 0, y: 0 });
  });
});

describe('snapping (GRID_HELPER::computeNearest)', () => {
  const step = 0.5 * MM;

  it('lands on nodes of the origin-anchored grid', () => {
    const origin = { x: 33.02 * MM, y: 118.745 * MM };
    // A point already on that grid is left exactly where it is — which is the
    // property that matters, because it is where KiCad put the track.
    const onGrid = { x: origin.x + 7 * step, y: origin.y - 3 * step };
    expect(snapToGridSize(onGrid, step, origin)).toEqual(onGrid);
    // And the same point snapped to a grid anchored at zero is moved, so the
    // two answers really do differ on this board.
    expect(snapToGridSize(onGrid, step, { x: 0, y: 0 })).not.toEqual(onGrid);
  });

  it('rounds to the nearest node, not toward the origin', () => {
    const origin = { x: 1000, y: 1000 };
    expect(snapToGridSize({ x: 1000 + step * 0.6, y: 1000 }, step, origin).x).toBe(1000 + step);
    expect(snapToGridSize({ x: 1000 + step * 0.4, y: 1000 }, step, origin).x).toBe(1000);
    // Negative offsets round the same way rather than truncating toward zero.
    expect(snapToGridSize({ x: 1000 - step * 0.6, y: 1000 }, step, origin).x).toBe(1000 - step);
  });

  it('leaves a point alone rather than dividing by a zero grid', () => {
    expect(snapToGridSize({ x: 7, y: 9 }, 0, { x: 0, y: 0 })).toEqual({ x: 7, y: 9 });
  });
});

/** Every dot `drawGrid` paints, as device-pixel centres. */
function gridDots(origin: { x: number; y: number }, size: number): { x: number; y: number }[] {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  // The painter retains the lattice in anchor-relative space and translates it,
  // so the translation has to be added back to get absolute device pixels.
  let tx = 0;
  let ty = 0;
  const ctx = {
    setTransform: () => {
      tx = 0;
      ty = 0;
    },
    translate: (x: number, y: number) => {
      tx += x;
      ty += y;
    },
    save: () => {},
    restore: () => {},
    setLineDash: () => {},
    stroke: () => {},
    fill: () => {},
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
  const realPath2D = globalThis.Path2D;
  (globalThis as { Path2D?: unknown }).Path2D = class {
    rect(x: number, y: number, w: number, h: number): void {
      rects.push({ x, y, w, h });
    }
  };
  try {
    // 1 px per 0.1 mm, so a 0.5 mm grid is 5 px and the dots are countable.
    const scale = 1 / (0.1 * MM);
    drawGrid(
      ctx,
      { scale, tx: 0, ty: 0 },
      200,
      200,
      pcbGridOptions({ sizeIU: size, origin, devicePixelRatio: 1 }),
    );
  } finally {
    (globalThis as { Path2D?: unknown }).Path2D = realPath2D;
  }
  return rects.map((r) => ({ x: r.x + r.w / 2 + tx, y: r.y + r.h / 2 + ty }));
}

describe('drawGrid (GAL::DrawGrid, DOTS)', () => {
  const size = 0.5 * MM;
  /** 1 px per 0.1 mm. */
  const px = (iu: number): number => iu / (0.1 * MM);

  it('puts a dot on the grid origin itself', () => {
    // 0.12 mm is not a multiple of 0.5 mm, so an origin-blind grid cannot.
    //
    // To the nearest pixel, because `drawGridPoint` snaps every mark:
    // `roundp` is floor(x + 0.5) (+0.5 for an odd pen), so a dot whose device
    // position is 1.2 px is drawn at 1. Asking for 1.2 exactly would be
    // asking for the blurred grid this snapping exists to avoid.
    const origin = { x: 0.12 * MM, y: 0.12 * MM };
    const dots = gridDots(origin, size);
    const want = px(origin.x); // 1.2 device px
    expect(dots.some((d) => Math.abs(d.x - want) <= 0.5 && Math.abs(d.y - want) <= 0.5)).toBe(true);
  });

  it('shifts the whole grid with the origin', () => {
    const at0 = gridDots({ x: 0, y: 0 }, size);
    const shifted = gridDots({ x: 0.12 * MM, y: 0 }, size);
    expect(at0.length).toBeGreaterThan(0);
    const xs = (d: { x: number; y: number }[]): number[] =>
      [...new Set(d.map((p) => Number(p.x.toFixed(6))))].sort((a, b) => a - b);
    const a = xs(at0);
    const b = xs(shifted);
    // The same lattice, moved bodily by 0.12 mm = 1.2 device px — landing
    // within half a pixel of that, since every mark is snapped.
    const target = a[1]! + px(0.12 * MM);
    expect(b.some((x) => Math.abs(x - target) <= 0.5)).toBe(true);
    expect(b).not.toEqual(a);
  });

  it('keeps the pitch, which the origin does not change', () => {
    // At 1 px per 0.1 mm a 0.5 mm grid would be 5 px apart, under the 10 px
    // minimum, so GetVisibleGridSize steps it up a whole tick to 5 mm.
    const step = visibleGridStep(size, 1 / (0.1 * MM), 'dots', 10, 1);
    expect(step).toBe(5 * MM);
    const pitch = (d: { x: number; y: number }[]): number => {
      const xs = [...new Set(d.map((p) => Number(p.x.toFixed(6))))].sort((a, b) => a - b);
      return Number((xs[1]! - xs[0]!).toFixed(6));
    };
    // Within a pixel, and for the same reason: snapping each mark makes the
    // drawn spacing alternate around the true pitch when the pitch is not a
    // whole number of pixels. KiCad's does too — that is the cost of a sharp
    // dot, and it is the trade upstream makes.
    // Within a pixel, and two separate reasons why it cannot be exact:
    // snapping each mark makes the drawn spacing alternate around the true
    // pitch, and this helper measures CENTRES, so a tick — twice as wide as a
    // minor dot — has its centre half a pixel further along. KiCad's grid has
    // both properties; they are the cost of a sharp dot.
    for (const origin of [
      { x: 0, y: 0 },
      { x: 0.12 * MM, y: 0 },
    ]) {
      expect(Math.abs(pitch(gridDots(origin, size)) - px(step))).toBeLessThanOrEqual(1);
    }
  });
});
