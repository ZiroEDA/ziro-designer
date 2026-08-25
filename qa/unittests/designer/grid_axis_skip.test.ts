// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * With the axes on, the grid line that would sit under an axis is not drawn.
 *
 * `OPENGL_GAL::DrawGrid` paints the axes first and then guards each lattice
 * line (`common/gal/opengl/opengl_gal.cpp:2000-2004` for the rows,
 * `:2027-2031` for the columns):
 *
 *     // If axes are drawn, skip the lines that would cover them
 *     if( m_axesEnabled && y == 0.0 )
 *         continue;
 *
 * so the axis keeps its own colour instead of being overpainted in grid grey.
 * `CAIRO_GAL_BASE::DrawGrid` carries the same two tests
 * (`common/gal/cairo/cairo_gal.cpp:1825-1827`, `:1839-1841`).
 *
 * Which styles it applies to is NOT the same in the two backends, and that
 * difference was settled by measurement rather than by reading — see
 * `qa/probes/grid_axis_skip/measure.py`, which captured a live GerbView 10.0.5
 * on this machine at each of the three grid styles and read the axis pixels:
 *
 *   LINES    axis stays blue                     -> skipped
 *   DOTS     the whole row and column of dots on the axes are absent, the
 *            columns running ..., 817, 835, [853 gone], 871, 889 at a 17.8 px
 *            pitch                               -> skipped (and Cairo, whose
 *            dots branch has no skip at all, is thereby ruled out)
 *   CROSSES  the axis crossing paints grid grey  -> NOT skipped
 *
 * Ours drew the line in every case, because the lattice is a retained `Path2D`
 * that knows only its own anchor.
 */
import { describe, it, expect } from 'vitest';
import {
  axisLineIndex,
  drawGrid,
  worldToDeviceX,
  worldToDeviceY,
  type GridStyle,
  type GridView,
} from '@ziroeda/designer/src/ui/grid_cursor.js';

// ---------------------------------------------------------------------------
// A recording canvas
// ---------------------------------------------------------------------------

interface Op {
  path: object;
  kind: 'move' | 'line' | 'rect';
  a: number;
  b: number;
  c: number;
  d: number;
}

let ops: Op[] = [];

class RecordingPath2D {
  moveTo(x: number, y: number): void {
    ops.push({ path: this, kind: 'move', a: x, b: y, c: 0, d: 0 });
  }
  lineTo(x: number, y: number): void {
    ops.push({ path: this, kind: 'line', a: x, b: y, c: 0, d: 0 });
  }
  rect(x: number, y: number, w: number, h: number): void {
    ops.push({ path: this, kind: 'rect', a: x, b: y, c: w, d: h });
  }
}
(globalThis as { Path2D?: unknown }).Path2D = RecordingPath2D;

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Run one `drawGrid` and return what it put on the canvas, in ABSOLUTE device
 * pixels — the painter retains its lattice anchor-relative and translates it
 * once, so the translation has to be folded back in.
 *
 * `ctx` is a parameter so a test can hand the SAME context to two calls, which
 * is what exercises the retained-path cache.
 */
function paint(
  style: GridStyle,
  view: GridView,
  axes: boolean,
  ctx: CanvasRenderingContext2D & { _t: { x: number; y: number } },
  /**
   * `GAL_DISPLAY_OPTIONS::m_gridMinSpacing`. Only the cache test sets it: a
   * SMALL_CROSS grid needs twice the room a dot does
   * (`cairo_gal.cpp:1787-1788`), so at KiCad's default 10 px the density loop
   * steps a crosses lattice a whole tick further out than a lines one and the
   * two stop being comparable. Lowering it keeps both at the same 20 px pitch.
   */
  minSpacingPx = 10,
): { segments: Segment[]; rects: Rect[]; rebuilt: boolean } {
  ops = [];
  ctx._t.x = 0;
  ctx._t.y = 0;
  drawGrid(ctx, view, 400, 300, {
    sizeIU: 100,
    color: '#888888',
    style,
    lineWidthPx: 1,
    minSpacingPx,
    devicePixelRatio: 1,
    axes: axes ? { color: '#0000ff' } : null,
  });
  const { x: tx, y: ty } = ctx._t;
  const segments: Segment[] = [];
  const rects: Rect[] = [];
  let pending: Op | null = null;
  for (const op of ops) {
    if (op.kind === 'move') pending = op;
    else if (op.kind === 'line' && pending && pending.path === op.path) {
      segments.push({
        x1: pending.a + tx,
        y1: pending.b + ty,
        x2: op.a + tx,
        y2: op.b + ty,
      });
      pending = null;
    } else if (op.kind === 'rect') {
      rects.push({ x: op.a + tx, y: op.b + ty, w: op.c, h: op.d });
    }
  }
  // The painter retains its lattice per context and only translates it, so a
  // frame that recorded no path operations at all was served from the cache.
  return { segments, rects, rebuilt: ops.length > 0 };
}

function makeCtx(): CanvasRenderingContext2D & { _t: { x: number; y: number } } {
  const t = { x: 0, y: 0 };
  const noop = (): void => {};
  return {
    _t: t,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    save: noop,
    restore: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fill: noop,
    setLineDash: noop,
    rect: noop,
    clip: noop,
    setTransform: (): void => {
      t.x = 0;
      t.y = 0;
    },
    translate: (x: number, y: number): void => {
      t.x += x;
      t.y += y;
    },
  } as unknown as CanvasRenderingContext2D & { _t: { x: number; y: number } };
}

/**
 * A 400x300 canvas at 0.2 device px per IU, world origin at device (100, 100).
 *
 * `GAL::GetVisibleGridSize` floors the grid at MIN_GRID_IU = 100 and the 10 px
 * minimum spacing works out at 50 IU here, so the step stays 100 IU and the
 * lattice pitch is a round **20 device px**: twenty columns across the canvas,
 * with a node exactly on each axis. Every expected coordinate below is read off
 * THIS transform by hand, never from the painter.
 */
const VIEW: GridView = { scale: 0.2, tx: 100, ty: 100 };
const AXIS_X = 100;
const AXIS_Y = 100;
/** Lattice pitch in device pixels: 100 IU x 0.2. */
const PITCH = 20;
/**
 * The same canvas panned so the world origin lands at device (300, 300).
 *
 * Chosen so that everything in the geometry cache key EXCEPT the axis position
 * is unchanged - same pitch, same 32x27 node counts, same pens - which is what
 * makes a rebuild attributable to the axis and nothing else. The tick-aligned
 * anchor moves a whole tick, so the axis sits on local index 20 rather than 10.
 */
const PANNED: GridView = { scale: 0.2, tx: 300, ty: 300 };

const horizontalAt = (segs: Segment[], y: number): Segment[] =>
  segs.filter((s) => s.y1 === y && s.y2 === y && s.x1 !== s.x2);
const verticalAt = (segs: Segment[], x: number): Segment[] =>
  segs.filter((s) => s.x1 === x && s.x2 === x && s.y1 !== s.y2);
/** Rects that light the given device column / row. */
const coveringColumn = (rs: Rect[], x: number): Rect[] =>
  rs.filter((r) => r.x <= x && x < r.x + r.w);
const coveringRow = (rs: Rect[], y: number): Rect[] => rs.filter((r) => r.y <= y && y < r.y + r.h);

describe('the view puts a lattice line on each axis', () => {
  it('so the skip has something to skip', () => {
    // Sanity on the fixture itself: with the axes OFF the painter draws a grid
    // line right where each axis would be. Without this the rest of the file
    // could pass on a view where no line was ever there.
    const { segments } = paint('lines', VIEW, false, makeCtx());
    expect(worldToDeviceX(VIEW, 0)).toBe(AXIS_X);
    expect(worldToDeviceY(VIEW, 0)).toBe(AXIS_Y);
    expect(horizontalAt(segments, AXIS_Y)).toHaveLength(1);
    expect(verticalAt(segments, AXIS_X)).toHaveLength(1);
  });
});

describe('GRID_STYLE::LINES', () => {
  it('drops the row and the column that lie on the axes', () => {
    const { segments } = paint('lines', VIEW, true, makeCtx());
    expect(horizontalAt(segments, AXIS_Y)).toHaveLength(0);
    expect(verticalAt(segments, AXIS_X)).toHaveLength(0);
  });

  it('drops only those two, not the lattice around them', () => {
    const on = paint('lines', VIEW, true, makeCtx()).segments;
    const off = paint('lines', VIEW, false, makeCtx()).segments;
    expect(on).toHaveLength(off.length - 2);
    // The neighbours one step either side are still there.
    for (const dy of [-PITCH, PITCH]) expect(horizontalAt(on, AXIS_Y + dy)).toHaveLength(1);
    for (const dx of [-PITCH, PITCH]) expect(verticalAt(on, AXIS_X + dx)).toHaveLength(1);
  });
});

describe('GRID_STYLE::DOTS', () => {
  it('drops the whole row and column of marks, as the stencil pass does', () => {
    const { rects } = paint('dots', VIEW, true, makeCtx());
    expect(rects.length).toBeGreaterThan(0);
    expect(coveringColumn(rects, AXIS_X)).toHaveLength(0);
    expect(coveringRow(rects, AXIS_Y)).toHaveLength(0);
  });

  it('draws them when the axes are off', () => {
    const { rects } = paint('dots', VIEW, false, makeCtx());
    expect(coveringColumn(rects, AXIS_X).length).toBeGreaterThan(0);
    expect(coveringRow(rects, AXIS_Y).length).toBeGreaterThan(0);
  });
});

describe('GRID_STYLE::SMALL_CROSS', () => {
  it('keeps the cross on the origin: upstream has no skip in that branch', () => {
    // Measured: with crosses the axis crossing pixel comes back grid grey, so
    // the mark really is painted over the axes.
    const on = paint('crosses', VIEW, true, makeCtx()).segments;
    const off = paint('crosses', VIEW, false, makeCtx()).segments;
    expect(on).toHaveLength(off.length);
    expect(horizontalAt(on, AXIS_Y).some((s) => s.x1 < AXIS_X && s.x2 > AXIS_X)).toBe(true);
    expect(verticalAt(on, AXIS_X).some((s) => s.y1 < AXIS_Y && s.y2 > AXIS_Y)).toBe(true);
  });

  it('and does not pay for a skip it never applies', () => {
    // A crosses lattice is the expensive one - a mark per NODE, not per line -
    // and its geometry does not depend on where the axes are, so the axis
    // position must stay out of its cache key or panning with the axes on
    // rebuilds every cross for nothing.
    //
    // This is the only thing the `style !== 'crosses'` guard on the two skip
    // indices does, and without this assertion a mutation sweep reported that
    // guard as dead: the crosses BRANCH never reads them, so dropping the
    // guard changes no pixel, only the key.
    const ctx = makeCtx();
    expect(paint('crosses', VIEW, true, ctx, 2).rebuilt).toBe(true);
    expect(paint('crosses', PANNED, true, ctx, 2).rebuilt).toBe(false);

    // The contrast, at the same pitch over the same two views: a LINES lattice
    // DOES depend on the axis, so the same pan has to rebuild it. Without this
    // the assertion above would also pass on a painter that never rebuilt
    // anything.
    const lineCtx = makeCtx();
    expect(paint('lines', VIEW, true, lineCtx, 2).rebuilt).toBe(true);
    expect(paint('lines', PANNED, true, lineCtx, 2).rebuilt).toBe(true);
  });
});

describe('the retained lattice follows the axis as the view pans', () => {
  it('does not serve a path whose gap is in the wrong place', () => {
    // The same canvas twice: the geometry cache is keyed per context, so if the
    // key did not carry the skip, the second frame would reuse the first
    // frame's hole. Panning by 200 px moves the tick-aligned anchor a whole
    // tick, so the axis lands on a DIFFERENT local index (10, then 20) while
    // the retained path itself is otherwise identical — which is exactly the
    // case a key that ignored the skip would collide on.
    const ctx = makeCtx();
    const first = paint('lines', VIEW, true, ctx).segments;
    expect(horizontalAt(first, AXIS_X)).toHaveLength(0);

    const second = paint('lines', PANNED, true, ctx).segments;
    expect(verticalAt(second, 300)).toHaveLength(0);
    expect(horizontalAt(second, 300)).toHaveLength(0);
    // and the hole the first frame left is filled back in
    expect(verticalAt(second, AXIS_X)).toHaveLength(1);
    expect(horizontalAt(second, AXIS_Y)).toHaveLength(1);
  });
});

describe('axisLineIndex — which lattice line lands on the axis', () => {
  it('converts the global index the C++ tests into a local one', () => {
    // anchor -10, walking +1, 20 IU steps, no grid origin: the line at world 0
    // is global index 0, which is 10 steps along from the anchor.
    expect(axisLineIndex(-10, 1, 20, 0)).toBe(10);
  });

  it('counts backwards on a mirrored axis', () => {
    // pcbnew's flip-board view walks the lattice in the decreasing index
    // direction, so the same global index is a different local one.
    expect(axisLineIndex(10, -1, 20, 0)).toBe(10);
    expect(axisLineIndex(4, -1, 20, 0)).toBe(4);
  });

  it('accounts for a grid origin that is a whole number of steps out', () => {
    // origin 40 => the line at world 0 is global index -2.
    expect(axisLineIndex(0, 1, 20, 40)).toBe(-2);
  });

  it('finds nothing when no line can land on the axis', () => {
    // Upstream's test is `== 0.0` on the computed coordinate, so an origin off
    // the lattice means no line is ever skipped and the grid covers the axis.
    expect(axisLineIndex(0, 1, 20, 7)).toBeNull();
    expect(axisLineIndex(0, 1, 0, 0)).toBeNull();
  });
});
