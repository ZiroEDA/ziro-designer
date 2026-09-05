// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Outset Items.
 * Counterpart: `OUTSET_ROUTINE::ProcessItem`.
 *
 * The tool's purpose is making a courtyard, so what matters is that the result
 * stays a *clean* shape: a rectangle outset by 1 mm is still a rectangle, 2 mm
 * wider and 2 mm taller — not a polygon that happens to look like one. Each
 * case therefore checks the kind as well as the geometry.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  outsetItems,
  outsetSegmentRing,
  roundRectOutwards,
} from '@ziroeda/pcbnew/src/outset_items.js';
import type { Board, PcbShape } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const rect = (x0: number, y0: number, x1: number, y1: number): PcbShape => ({
  kind: 'rect',
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.15),
  fill: false,
  layer: 'F.SilkS',
  source: EMPTY,
});

const circle = (cx: number, cy: number, r: number): PcbShape => ({
  kind: 'circle',
  center: { x: MM(cx), y: MM(cy) },
  end: { x: MM(cx + r), y: MM(cy) },
  width: MM(0.15),
  fill: false,
  layer: 'F.SilkS',
  source: EMPTY,
});

const line = (x0: number, y0: number, x1: number, y1: number): PcbShape => ({
  kind: 'line',
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.15),
  fill: false,
  layer: 'F.SilkS',
  source: EMPTY,
});

const board = (shapes: PcbShape[]): Board => ({
  version: 20240108,
  layers: [{ id: 0, name: 'F.Cu', kind: 'signal' }],
  nets: new Map([[0, '']]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes,
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  barcodes: [],
  groups: [],
  source: EMPTY,
});

/** Ring area by the shoelace formula, in mm². */
const areaMM = (pts: { x: number; y: number }[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2 / 1e12;
};

const last = (b: Board): PcbShape => b.shapes[b.shapes.length - 1]!;

describe('outsetting a rectangle', () => {
  it('stays a rectangle, grown by the distance on every side', () => {
    const out = outsetItems(board([rect(10, 10, 20, 20)]), ['shape:0'], { distance: MM(1) });
    const s = last(out.board);

    expect(out.successes).toBe(1);
    expect(s.kind).toBe('rect');
    expect(s.start).toEqual({ x: MM(9), y: MM(9) });
    expect(s.end).toEqual({ x: MM(21), y: MM(21) });
  });

  it('becomes a rounded rectangle when corners are rounded', () => {
    const out = outsetItems(board([rect(10, 10, 20, 20)]), ['shape:0'], {
      distance: MM(1),
      roundCorners: true,
    });
    const s = last(out.board);

    expect(s.kind).toBe('poly');
    // 12 x 12 square less the four corners the rounding cuts off:
    // 144 - (4 - pi) * 1² ≈ 143.14 mm². The ring inscribes the corner arcs, so
    // it comes out a hair under — a tenth of a percent covers the 5° step the
    // tessellator uses, and is far below anything a board cares about. The
    // upper bound is the half that matters: inscribed, never circumscribed.
    const exact = 144 - (4 - Math.PI);
    expect(areaMM(s.pts!) / exact).toBeGreaterThan(0.999);
    expect(areaMM(s.pts!) / exact).toBeLessThanOrEqual(1);
  });

  it('keeps the source unless asked to delete it', () => {
    const b = board([rect(10, 10, 20, 20)]);

    expect(outsetItems(b, ['shape:0'], { distance: MM(1) }).board.shapes).toHaveLength(2);
    expect(
      outsetItems(b, ['shape:0'], { distance: MM(1), deleteSourceItems: true }).board.shapes,
    ).toHaveLength(1);
  });

  it('takes the layer and width it is given', () => {
    const out = outsetItems(board([rect(10, 10, 20, 20)]), ['shape:0'], {
      distance: MM(1),
      layer: 'F.CrtYd',
      lineWidth: MM(0.05),
    });

    expect(last(out.board).layer).toBe('F.CrtYd');
    expect(last(out.board).width).toBe(MM(0.05));
  });

  it('falls back to the source layer and width', () => {
    const out = outsetItems(board([rect(10, 10, 20, 20)]), ['shape:0'], { distance: MM(1) });

    expect(last(out.board).layer).toBe('F.SilkS');
    expect(last(out.board).width).toBe(MM(0.15));
  });

  it('refuses a negative distance that would collapse it', () => {
    const out = outsetItems(board([rect(10, 10, 20, 20)]), ['shape:0'], { distance: MM(-6) });

    expect(out.successes).toBe(0);
    expect(out.failures).toBe(1);
    expect(out.board.shapes).toHaveLength(1);
  });

  it('shrinks for a negative distance that still leaves something', () => {
    // Inset is a legitimate use: the same tool, a smaller number.
    const out = outsetItems(board([rect(10, 10, 20, 20)]), ['shape:0'], { distance: MM(-2) });

    expect(last(out.board).start).toEqual({ x: MM(12), y: MM(12) });
    expect(last(out.board).end).toEqual({ x: MM(18), y: MM(18) });
  });

  it('normalises a rectangle drawn backwards', () => {
    // Dragged bottom-right to top-left, so start > end. Outsetting must still
    // grow it rather than turning it inside out.
    const out = outsetItems(board([rect(20, 20, 10, 10)]), ['shape:0'], { distance: MM(1) });

    expect(last(out.board).start).toEqual({ x: MM(9), y: MM(9) });
    expect(last(out.board).end).toEqual({ x: MM(21), y: MM(21) });
  });
});

describe('outsetting a circle', () => {
  it('stays a circle of the larger radius', () => {
    const out = outsetItems(board([circle(0, 0, 5)]), ['shape:0'], {
      distance: MM(1),
      roundCorners: true,
    });
    const s = last(out.board);

    expect(s.kind).toBe('circle');
    expect(s.center).toEqual({ x: 0, y: 0 });
    expect(s.end).toEqual({ x: MM(6), y: 0 });
  });

  it('becomes the square around it when corners are not rounded', () => {
    const out = outsetItems(board([circle(0, 0, 5)]), ['shape:0'], { distance: MM(1) });
    const s = last(out.board);

    // The square containing the *outset* circle: ±6 mm, not ±7. Applying the
    // distance a second time is the easy mistake here.
    expect(s.kind).toBe('rect');
    expect(s.start).toEqual({ x: MM(-6), y: MM(-6) });
    expect(s.end).toEqual({ x: MM(6), y: MM(6) });
  });

  it('refuses a distance that would leave no radius', () => {
    const out = outsetItems(board([circle(0, 0, 5)]), ['shape:0'], { distance: MM(-5) });

    expect(out.successes).toBe(0);
    expect(out.failures).toBe(1);
  });
});

describe('outsetting a segment', () => {
  it('produces the whole stadium, both sides', () => {
    // Which side the user wants cannot be told from the geometry, so upstream
    // makes the closed shape and lets them delete the half they do not want.
    const ring = outsetSegmentRing({ x: 0, y: 0 }, { x: MM(10), y: 0 }, MM(1), true);

    // A 10 x 2 mm rectangle plus two semicircular caps of radius 1: 20 + pi.
    expect(areaMM(ring)).toBeCloseTo(20 + Math.PI, 1);
  });

  it('produces a rectangle when corners are not rounded', () => {
    const ring = outsetSegmentRing({ x: 0, y: 0 }, { x: MM(10), y: 0 }, MM(1), false);

    // Extended by the distance at each end as well as each side: 12 x 2.
    expect(ring).toHaveLength(4);
    expect(areaMM(ring)).toBeCloseTo(24, 3);
  });

  it('is nothing for a zero-length segment', () => {
    expect(outsetSegmentRing({ x: 0, y: 0 }, { x: 0, y: 0 }, MM(1), true)).toEqual([]);
  });

  it('is nothing for a non-positive distance', () => {
    // Insetting a line has no meaning — there is nothing inside it.
    expect(outsetSegmentRing({ x: 0, y: 0 }, { x: MM(10), y: 0 }, 0, true)).toEqual([]);
  });

  it('is reported as a failure on the board', () => {
    const out = outsetItems(board([line(0, 0, 10, 0)]), ['shape:0'], { distance: 0 });

    expect(out.successes).toBe(0);
    expect(out.failures).toBe(1);
  });
});

describe('rounding out to a grid', () => {
  it('grows the box to the grid lines containing it', () => {
    const r = roundRectOutwards({ x: MM(1.2), y: MM(3.7) }, { x: MM(8.1), y: MM(9.2) }, MM(1));

    expect(r.min).toEqual({ x: MM(1), y: MM(3) });
    expect(r.max).toEqual({ x: MM(9), y: MM(10) });
  });

  it('never snaps inwards', () => {
    // A courtyard snapped inwards would be smaller than the clearance asked
    // for, which is the one direction that matters.
    const r = roundRectOutwards({ x: MM(1.9), y: MM(1.9) }, { x: MM(8.1), y: MM(8.1) }, MM(1));

    expect(r.min.x).toBeLessThanOrEqual(MM(1.9));
    expect(r.max.x).toBeGreaterThanOrEqual(MM(8.1));
  });

  it('leaves a box already on the grid alone', () => {
    const r = roundRectOutwards({ x: MM(2), y: MM(2) }, { x: MM(8), y: MM(8) }, MM(1));

    expect(r.min).toEqual({ x: MM(2), y: MM(2) });
    expect(r.max).toEqual({ x: MM(8), y: MM(8) });
  });

  it('applies to an outset rectangle', () => {
    const out = outsetItems(board([rect(10.3, 10.3, 20.4, 20.4)]), ['shape:0'], {
      distance: MM(0.5),
      gridRounding: MM(1),
    });
    const s = last(out.board);

    // 9.8 .. 20.9 rounded outwards onto a 1 mm grid.
    expect(s.start).toEqual({ x: MM(9), y: MM(9) });
    expect(s.end).toEqual({ x: MM(21), y: MM(21) });
  });
});

describe('anything else', () => {
  it('falls back to the bounding box', () => {
    // A polygon has no exact outset here, so it becomes a rectangle — an
    // approximation that looks like one, rather than one that pretends not to
    // be.
    const poly: PcbShape = {
      kind: 'poly',
      pts: [
        { x: 0, y: 0 },
        { x: MM(10), y: 0 },
        { x: 0, y: MM(10) },
      ],
      width: MM(0.15),
      fill: true,
      layer: 'F.SilkS',
      source: EMPTY,
    };
    const out = outsetItems(board([poly]), ['shape:0'], { distance: MM(1) });

    expect(last(out.board).kind).toBe('rect');
    // The bounding box includes the stroke, as EDA_SHAPE::GetBoundingBox does,
    // so the outset is measured from the drawn edge rather than the centreline:
    // 1 mm out from -0.075, not from 0.
    expect(last(out.board).start).toEqual({ x: MM(-1.075), y: MM(-1.075) });
    expect(last(out.board).end).toEqual({ x: MM(11.075), y: MM(11.075) });
  });

  it('reports an id that resolves to nothing', () => {
    const b = board([rect(0, 0, 10, 10)]);
    const out = outsetItems(b, ['shape:9'], { distance: MM(1) });

    expect(out.successes).toBe(0);
    expect(out.failures).toBe(1);
    expect(out.board).toBe(b);
  });

  it('handles several items at once', () => {
    const out = outsetItems(
      board([rect(0, 0, 10, 10), circle(50, 50, 5)]),
      ['shape:0', 'shape:1'],
      {
        distance: MM(1),
        roundCorners: true,
      },
    );

    expect(out.successes).toBe(2);
    expect(out.board.shapes).toHaveLength(4);
  });
});
