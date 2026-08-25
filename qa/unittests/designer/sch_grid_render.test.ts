// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Schematic grid painting (designer/src/editors/schematic/render/renderer.ts
 * drawGrid), against OPENGL_GAL::DrawGrid + GAL::GetVisibleGridSize:
 *
 *  - every m_gridTick-th (10th) line is drawn at double width, SetCoarseGrid( 10 )
 *    in the GAL constructor, and the reason KiCad's grid has a coarse pattern;
 *  - the pen is `scaleFactor * <setting> + 0.25` floored at one pixel
 *    (GAL::updatedGalDisplayOptions), and a tick line is twice that;
 *  - DOTS is the stencilled *intersection* of the horizontal and vertical pens,
 *    so a node is minor x minor, minor x major or major x major;
 *  - when the grid is too dense GetVisibleGridSize multiplies the spacing by a
 *    whole tick (x10), it does not double;
 *  - SMALL_CROSS needs twice the spacing and its arms are 2 x the pen width.
 *
 * The call-count assertions are a cost guard as well. Issuing one draw call per
 * node put ~12k `fillRect`s into every frame of a 1550x967 view, about 20 ms,
 * paid on every pan, drag and mouse move, and entirely independent of how big
 * the schematic is.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  renderSchematic,
  DEFAULT_RENDER_OPTS,
  type RenderOpts,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';

interface Call {
  op: string;
  args: unknown[];
}

/** A 2D context stand-in recording every method call and property set. */
function recorder(): CanvasRenderingContext2D & { __calls: Call[] } {
  const calls: Call[] = [];
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === '__calls') return calls;
        return (...args: unknown[]) => calls.push({ op: String(prop), args });
      },
      set(_t, prop, value) {
        calls.push({ op: `set:${String(prop)}`, args: [value] });
        return true;
      },
    },
  ) as CanvasRenderingContext2D & { __calls: Call[] };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Path2D stand-in: node has none, and the geometry is what we assert on. */
class FakePath2D {
  static built: FakePath2D[] = [];
  rects: Rect[] = [];
  segs: number[][] = [];
  private pen: [number, number] = [0, 0];
  constructor() {
    FakePath2D.built.push(this);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, w, h });
  }
  moveTo(x: number, y: number): void {
    this.pen = [x, y];
  }
  lineTo(x: number, y: number): void {
    this.segs.push([this.pen[0], this.pen[1], x, y]);
    this.pen = [x, y];
  }
}

const EMPTY = readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));
const MIL = 25400 / 1000; // IU per mil (1 IU = 100 nm)
const GRID_50_MIL = 50 * MIL; // 12700 IU, eeschema's default grid

/** Grid only: no page frame, no drawing sheet, nothing else on the canvas. */
function gridOnly(overrides: Partial<RenderOpts['grid']> = {}): RenderOpts {
  return {
    ...DEFAULT_RENDER_OPTS,
    showPageLimits: false,
    showDrawingSheet: false,
    grid: { ...DEFAULT_RENDER_OPTS.grid, sizeIU: GRID_50_MIL, devicePixelRatio: 1, ...overrides },
  };
}

// The renderer retains the grid geometry across frames and only rebuilds it
// when the view or the settings change, so a repeat of an earlier paint would
// legitimately build no path at all. Nudging the canvas height keeps every
// assertion below looking at freshly built geometry.
let paintSeq = 0;

function paint(
  width: number,
  height: number,
  opts: RenderOpts,
  scale = 20 / GRID_50_MIL, // 50 mil == 20 device px unless a test says otherwise
): { calls: Call[]; paths: FakePath2D[] } {
  FakePath2D.built = [];
  const ctx = recorder();
  renderSchematic(
    ctx,
    EMPTY,
    { scale, offsetX: 0, offsetY: 0 },
    KICAD_DEFAULT,
    width,
    height + paintSeq++,
    new Set(),
    undefined,
    opts,
  );
  return { calls: ctx.__calls, paths: FakePath2D.built };
}

const origPath2D = globalThis.Path2D;
beforeAll(() => {
  (globalThis as { Path2D?: unknown }).Path2D = FakePath2D;
});
afterAll(() => {
  (globalThis as { Path2D?: unknown }).Path2D = origPath2D;
});

// GAL::updatedGalDisplayOptions: scaleFactor * setting + 0.25, floored at 1 px.
const pen = (setting: number, dpr: number) => Math.max(1, dpr * setting + 0.25);

/**
 * The whole device pixels a mark of that width lights. MEASURED off a live
 * KiCad 10.0.5 pl_editor on this machine: at the default `grid.line_width` of
 * 1.0 a minor mark is 1x1 px, a mark on a tick column 3 wide, one on a tick
 * row 3 tall, and a tick crossing 3x3 — with no anti-aliased pixel anywhere in
 * the capture. Spelled out here rather than imported, so a mutant in the
 * renderer's own helper cannot compute the answer it is checked against.
 */
const litPixels = (width: number) => (width === 1.25 ? 1 : width === 2.5 ? 3 : Number.NaN);

/**
 * The device pixel a mark is centred ON. Its geometric centre is that pixel's
 * centre, i.e. a half-integer, so `Math.round` would tip every mark one pixel
 * to the right; `Math.floor` names the pixel itself.
 */
const centrePixel = (r: { x: number; w: number }) => Math.floor(r.x + r.w / 2);

describe('schematic grid painting', () => {
  it('draws the dot lattice with a single fill, whatever the node count', () => {
    for (const [w, h] of [
      [400, 300],
      [1600, 1200],
    ] as const) {
      const { calls } = paint(w, h, gridOnly());
      expect(calls.filter((c) => c.op === 'fill')).toHaveLength(1);
      expect(calls.filter((c) => c.op === 'fillRect')).toHaveLength(1); // background clear only
    }
  });

  it('sizes each dot as the intersection of the two pens (GAL stencils DOTS)', () => {
    const dpr = 1;
    const minor = pen(DEFAULT_RENDER_OPTS.grid.lineWidthPx, dpr);
    const major = minor * 2;
    const { paths } = paint(900, 600, gridOnly({ devicePixelRatio: dpr }));
    const rects = paths.flatMap((p) => p.rects);
    expect(rects.length).toBeGreaterThan(100);

    // Only three node shapes exist, and they are exactly the pen products —
    // painted as whole device pixels, which is 1 and 3 for the default pen.
    expect([minor, major]).toEqual([1.25, 2.5]);
    const a = litPixels(minor);
    const b = litPixels(major);
    expect([a, b]).toEqual([1, 3]);
    const shapes = new Set(rects.map((r) => `${r.w}x${r.h}`));
    expect([...shapes].sort()).toEqual(
      [`${a}x${a}`, `${a}x${b}`, `${b}x${b}`, `${b}x${a}`]
        .filter((s, i, arr) => arr.indexOf(s) === i)
        .sort(),
    );

    // Each rect sits ON its node, to within the snapping. `drawGridPoint`
    // rounds the point to the pixel grid and then offsets by
    // `- floor( sw / 2 ) - 0.5`, so a 1.25 px dot is not centred on its node —
    // its left EDGE is the whole pixel, which is what makes it paint sharp.
    for (const r of rects.slice(0, 50)) {
      const node = Math.round((r.x + r.w / 2) / 20) * 20;
      expect(Math.abs(r.x + r.w / 2 - node)).toBeLessThanOrEqual(1);
    }
  });

  it('makes every tenth line coarse, anchored on the grid origin', () => {
    const { paths } = paint(900, 600, gridOnly());
    const minor = pen(DEFAULT_RENDER_OPTS.grid.lineWidthPx, 1);
    const rects = paths.flatMap((p) => p.rects);

    // Group by column: one column in ten is double width (SetCoarseGrid(10)).
    const widthByColumn = new Map<number, number>();
    for (const r of rects) widthByColumn.set(centrePixel(r), r.w);
    const columns = [...widthByColumn.entries()].sort((a, b) => a[0] - b[0]);
    const coarse = columns.filter(([, w]) => w > litPixels(minor));
    expect(coarse.length).toBeGreaterThan(0);
    expect(coarse.length / columns.length).toBeCloseTo(1 / 10, 1);

    // Coarse columns are 10 nodes apart, i.e. a whole tick.
    const xs = coarse.map(([x]) => x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBe(10 * 20);
    // ...and the pattern is anchored on the world origin, not on the viewport.
    expect(xs.every((x) => x % (10 * 20) === 0)).toBe(true);
  });

  it('steps the spacing up by a whole tick, not by doubling', () => {
    // 50 mil at 4 device px is below the 10 px minimum, so GetVisibleGridSize
    // jumps straight to 500 mil (x10), doubling to 100 mil would be wrong.
    const scale = 4 / GRID_50_MIL;
    const { paths } = paint(1200, 900, gridOnly({ minSpacingPx: 10 }), scale);
    const xs = [...new Set(paths.flatMap((p) => p.rects).map((r) => Math.round(r.x + r.w / 2)))]
      .sort((a, b) => a - b)
      .slice(0, 5);
    const pitch = xs[1]! - xs[0]!;
    // 500 mil x 4 px/50 mil = 40, to within a pixel: these are dot CENTRES and
    // a tick is twice as wide as a minor dot, so its centre sits half a pixel
    // further along — and `drawGridPoint` snaps every mark to the pixel grid,
    // which is what makes KiCad's dots sharp and its drawn spacing alternate.
    expect(Math.abs(pitch - 40)).toBeLessThanOrEqual(1);
  });

  it('batches the line and cross styles into one stroke per weight', () => {
    for (const style of ['lines', 'crosses'] as const) {
      const { calls } = paint(1600, 1200, gridOnly({ style }));
      // One stroke for the minor weight, one for the coarse weight.
      expect(calls.filter((c) => c.op === 'stroke')).toHaveLength(2);
      expect(calls.filter((c) => c.op === 'fillRect')).toHaveLength(1); // background clear only
    }
  });

  it('gives SMALL_CROSS arms of twice the pen width', () => {
    const minor = pen(DEFAULT_RENDER_OPTS.grid.lineWidthPx, 1);
    const major = minor * 2;
    const { paths } = paint(900, 600, gridOnly({ style: 'crosses' }));
    // A segment is [x1, y1, x2, y2], so a horizontal arm is one whose two y's
    // match, and its length is the span between the two x's.
    const horiz = paths.flatMap((p) => p.segs).filter(([, y1, , y2]) => y1 === y2);
    expect(horiz.length).toBeGreaterThan(50);
    const lengths = [...new Set(horiz.map(([x1, , x2]) => Math.abs(x2! - x1!)))].sort(
      (a, b) => a - b,
    );
    // DrawGrid: lineLen = 2 * GetLineWidth(), drawn either side of the node, so
    // a cross spans 4 pens. There are exactly two, the minor one and the coarse
    // one, and asserting the whole SET is what makes this sensitive: halving the
    // arm turns the coarse cross into something the minor width also produces,
    // so `contains 4 * minor` alone stays true through the bug.
    expect(lengths).toEqual([4 * minor, 4 * major]);
  });

  it('leaves the grid off entirely when it is hidden', () => {
    const { calls } = paint(1600, 1200, gridOnly({ show: false }));
    expect(calls.filter((c) => c.op === 'fill')).toHaveLength(0);
  });
});
