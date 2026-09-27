// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `common/tool/edit_points.cpp`, `edit_constraints.cpp` and
 * `preview_items/angle_item.cpp`. Every expectation is worked by hand from the
 * C++, never read back off the code.
 */
import { describe, expect, it } from 'vitest';
import type { Color4d } from '@ziroeda/common/color4d.js';
import { GAL_DISPLAY_OPTIONS } from '@ziroeda/common/gal/gal_display_options.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import '@ziroeda/common/font/stroke_font.js';
import { ANGLE_ITEM } from '@ziroeda/common/preview_items/angle_item.js';
import {
  computeNearest,
  EC_45DEGREE,
  EC_CIRCLE,
  EC_CONVERGING,
  EC_LINE,
  EC_PERPLINE,
  EC_VERTICAL,
  GRID_CONSTRAINT_TYPE,
  type GRID_HELPER,
} from '@ziroeda/common/tool/edit_constraints.js';
import { EDIT_LINE, EDIT_POINT, EDIT_POINTS } from '@ziroeda/common/tool/edit_points.js';
import type { VIEW } from '@ziroeda/common/view/view.js';
import type { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

const pos = (p: EDIT_POINT): VECTOR2I => p.GetPosition();

/** A GRID_HELPER on a grid of `aStep` at the origin. */
const grid = (aStep: number): GRID_HELPER => ({
  AlignGrid: (p) => computeNearest(p, { x: aStep, y: aStep }, { x: 0, y: 0 }),
});

describe('EDIT_LINE', () => {
  it('sits at the midpoint, each end halved and ROUNDED first (VECTOR2<int> / 2)', () => {
    // origin / 2 + end / 2: (1,1)/2 = (KiROUND 0.5, KiROUND 0.5) = (1,1);
    // (4,6)/2 = (2,3); the sum is (3,4), not the exact midpoint (2.5,3.5).
    const line = new EDIT_LINE(new EDIT_POINT({ x: 1, y: 1 }), new EDIT_POINT({ x: 4, y: 6 }));
    expect(line.GetPosition()).toEqual({ x: 3, y: 4 });
  });

  it('rounds a negative half away from zero, as KiROUND does', () => {
    // (-1,0)/2 = (KiROUND -0.5, 0) = (-1, 0); a truncating divide would give 0.
    const line = new EDIT_LINE(new EDIT_POINT({ x: -1, y: 0 }), new EDIT_POINT({ x: 0, y: 0 }));
    expect(line.GetPosition()).toEqual({ x: -1, y: 0 });
  });

  it('moves both ends by the same difference', () => {
    const o = new EDIT_POINT({ x: 0, y: 0 });
    const e = new EDIT_POINT({ x: 10, y: 0 });
    const line = new EDIT_LINE(o, e);
    line.SetPosition({ x: 15, y: 3 });
    expect([pos(o), pos(e)]).toEqual([
      { x: 10, y: 3 },
      { x: 20, y: 3 },
    ]);
  });

  it('snaps by grid, not to it (the constructor sets SNAP_BY_GRID)', () => {
    const line = new EDIT_LINE(new EDIT_POINT({ x: 0, y: 0 }), new EDIT_POINT({ x: 2, y: 2 }));
    expect(line.GetGridConstraint()).toBe(GRID_CONSTRAINT_TYPE.SNAP_BY_GRID);
    expect(new EDIT_POINT({ x: 0, y: 0 }).GetGridConstraint()).toBe(
      GRID_CONSTRAINT_TYPE.SNAP_TO_GRID,
    );
  });
});

describe('EDIT_POINTS contours', () => {
  /** Two contours: 0,1,2 | 3,4,5. */
  const twoContours = (): EDIT_POINTS => {
    const pts = new EDIT_POINTS(null);
    for (const x of [0, 10, 20]) pts.AddPoint({ x, y: 0 });
    pts.AddBreak();
    for (const x of [0, 10, 20]) pts.AddPoint({ x, y: 50 });
    return pts;
  };

  it('knows where each contour starts and ends', () => {
    const pts = twoContours();
    expect([0, 1, 2, 3, 4, 5].map((i) => pts.GetContourStartIdx(i))).toEqual([0, 0, 0, 3, 3, 3]);
    expect([0, 1, 2, 3, 4, 5].map((i) => pts.GetContourEndIdx(i))).toEqual([2, 2, 2, 5, 5, 5]);
    expect([0, 1, 2, 3, 4, 5].map((i) => pts.IsContourStart(i))).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
    expect([0, 1, 2, 3, 4, 5].map((i) => pts.IsContourEnd(i))).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
  });

  it('wraps within a contour when not traversing, and walks on when traversing', () => {
    const pts = twoContours();
    expect(pts.Previous(pts.Point(0), false)).toBe(pts.Point(2));
    expect(pts.Next(pts.Point(2), false)).toBe(pts.Point(0));
    expect(pts.Previous(pts.Point(3), false)).toBe(pts.Point(5));
    expect(pts.Next(pts.Point(2), true)).toBe(pts.Point(3));
    expect(pts.Previous(pts.Point(0), true)).toBe(pts.Point(5));
  });

  it('finds a point by POSITION (operator==), so the first of two coincident points answers', () => {
    const pts = new EDIT_POINTS(null);
    pts.AddPoint({ x: 0, y: 0 });
    pts.AddPoint({ x: 5, y: 5 });
    pts.AddPoint({ x: 5, y: 5 });
    // Previous( point 2 ) finds point 1 first - same position - and answers point 0.
    expect(pts.Previous(pts.Point(2))).toBe(pts.Point(0));
    // A handle that is not in the list at all, at a listed position, is found.
    expect(pts.Next(new EDIT_POINT({ x: 0, y: 0 }))).toBe(pts.Point(1));
  });

  it('merges a line into a box the points started', () => {
    const pts = new EDIT_POINTS(null);
    pts.AddPoint({ x: 0, y: 0 });
    pts.AddLine(new EDIT_POINT({ x: -5, y: 2 }), new EDIT_POINT({ x: 7, y: 9 }));
    const box = pts.ViewBBox();
    expect([box.GetX(), box.GetY(), box.GetRight(), box.GetBottom()]).toEqual([-5, 0, 7, 9]);
  });

  it('bounds the lines too', () => {
    const pts = new EDIT_POINTS(null);
    const a = new EDIT_POINT({ x: -5, y: 2 });
    const b = new EDIT_POINT({ x: 7, y: 9 });
    pts.AddLine(a, b);
    const box = pts.ViewBBox();
    expect([box.GetX(), box.GetY(), box.GetRight(), box.GetBottom()]).toEqual([-5, 2, 7, 9]);
  });
});

describe('the constraints', () => {
  it('EC_CONVERGING slides the far end along a sloping neighbour', () => {
    // (0,0) (10,0) (10,10) (0,20): the end side runs from (0,20) along (10,-10),
    // the line y = 20 - x. Drag the right edge to x = 14: its origin stays on
    // y = 0 at (14,0), and its end moves ALONG the neighbour to (14,6) - not
    // to (14,10), where the drag alone put it.
    const pts = new EDIT_POINTS(null);
    for (const p of [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 20 },
    ])
      pts.AddPoint(p);
    for (let i = 0; i < 4; ++i) pts.AddLine(pts.Point(i), pts.Point((i + 1) % 4));

    const right = pts.Line(1);
    const c = new EC_CONVERGING(right, pts);
    right.SetPosition({ x: 14, y: 5 });
    c.Apply(grid(1));

    expect([pos(pts.Point(1)), pos(pts.Point(2))]).toEqual([
      { x: 14, y: 0 },
      { x: 14, y: 6 },
    ]);
  });

  it('EC_VERTICAL aligns to the grid, then takes the constrainer X', () => {
    const handle = new EDIT_POINT({ x: 3, y: 7 });
    new EC_VERTICAL(handle, new EDIT_POINT({ x: 10, y: 0 })).Apply(grid(5));
    expect(pos(handle)).toEqual({ x: 10, y: 5 });
  });

  it('EC_45DEGREE snaps a near-horizontal run flat, onto the grid', () => {
    // (10,1) from the constrainer snaps to (10,0); AlignGrid on a 4 grid is
    // KiROUND( 10 / 4 = 2.5 ) * 4 = 3 * 4 = 12 - halves go away from zero.
    const handle = new EDIT_POINT({ x: 10, y: 1 });
    new EC_45DEGREE(handle, new EDIT_POINT({ x: 0, y: 0 })).Apply(grid(4));
    expect(pos(handle)).toEqual({ x: 12, y: 0 });
  });

  it('EC_LINE projects the handle back onto the line', () => {
    // The line is y = x through the origin; (10,0) projects along (-10,10) to (5,5).
    const handle = new EDIT_POINT({ x: 10, y: 10 });
    handle.SetGridConstraint(GRID_CONSTRAINT_TYPE.IGNORE_GRID);
    const c = new EC_LINE(handle, new EDIT_POINT({ x: 0, y: 0 }));
    handle.SetPosition({ x: 10, y: 0 });
    c.Apply(grid(1));
    expect(pos(handle)).toEqual({ x: 5, y: 5 });
  });

  it('EC_CIRCLE keeps the handle on the circle through the end point', () => {
    // Radius |(3,4)| = 5; the handle points straight down (+y), so (0,5).
    const handle = new EDIT_POINT({ x: 0, y: 10 });
    new EC_CIRCLE(handle, new EDIT_POINT({ x: 0, y: 0 }), new EDIT_POINT({ x: 3, y: 4 })).Apply(
      grid(1),
    );
    expect(pos(handle)).toEqual({ x: 0, y: 5 });
  });

  it('EC_PERPLINE slides the line along its own normal, off by the rounded halves', () => {
    // Line (0,0)-(10,0), mid (5,0). SetPosition( (8,7) ) moves both ends by
    // (3,7): (3,7) and (13,7). Read back, the centre is (3,7)/2 + (13,7)/2 with
    // each half ROUNDED - (2,4) + (7,4) = (9,8), not (8,7). Projected onto x = 5
    // from (9,8) it lands at (5,8), a move of (-4,0): the ends go to (-1,7)
    // and (9,7). KiCad's line, integer arithmetic and all.
    const o = new EDIT_POINT({ x: 0, y: 0 });
    const e = new EDIT_POINT({ x: 10, y: 0 });
    const line = new EDIT_LINE(o, e);
    const c = new EC_PERPLINE(line);
    line.SetPosition({ x: 8, y: 7 });
    c.Apply(grid(1));
    expect([pos(o), pos(e)]).toEqual([
      { x: -1, y: 7 },
      { x: 9, y: 7 },
    ]);
  });

  it('EC_CONVERGING keeps the neighbours on their own lines', () => {
    // A 10 x 10 square; drag its right edge to x = 14 (even, so the halved
    // centre reads back as it was set). The top and bottom edges keep their
    // direction, so the edge's ends land at (14,0) and (14,10).
    const pts = new EDIT_POINTS(null);
    for (const p of [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ])
      pts.AddPoint(p);
    for (let i = 0; i < 4; ++i) pts.AddLine(pts.Point(i), pts.Point((i + 1) % 4));

    const right = pts.Line(1);
    const c = new EC_CONVERGING(right, pts);
    right.SetPosition({ x: 14, y: 5 });
    c.Apply(grid(1));

    expect([pos(pts.Point(1)), pos(pts.Point(2))]).toEqual([
      { x: 14, y: 0 },
      { x: 14, y: 10 },
    ]);
  });
});

/** A GAL that records what ANGLE_ITEM draws. */
class RECORDING_GAL extends GAL {
  lines: [Vec2, Vec2][] = [];
  arcs: { center: Vec2; radius: number; start: number; sweep: number }[] = [];
  texts: { text: string; at: VECTOR2I }[] = [];

  constructor() {
    super(new GAL_DISPLAY_OPTIONS());
  }

  override DrawLine(aStart: Vec2, aEnd: Vec2): void {
    this.lines.push([aStart, aEnd]);
  }

  override DrawArc(aCenter: Vec2, aRadius: number, aStart: EDA_ANGLE, aAngle: EDA_ANGLE): void {
    this.arcs.push({
      center: aCenter,
      radius: aRadius,
      start: aStart.AsDegrees(),
      sweep: aAngle.AsDegrees(),
    });
  }

  override BitmapText(aText: string, aPosition: VECTOR2I, _aAngle: EDA_ANGLE): void {
    this.texts.push({ text: aText, at: aPosition });
  }
}

/** A VIEW at scale 1: ToWorld is the identity, so size 4, border 2, radius 40. */
function drawAngles(aPoints: EDIT_POINTS): RECORDING_GAL {
  const gal = new RECORDING_GAL();
  const color: Color4d = { r: 1, g: 1, b: 1, a: 1 };
  const view = {
    GetGAL: () => gal,
    GetPainter: () => ({ GetSettings: () => ({ GetLayerColor: () => color }) }),
    ToWorld: (n: number) => n,
  } as unknown as VIEW;
  new ANGLE_ITEM(aPoints).ViewDraw(0, view);
  return gal;
}

const polygon = (aCorners: VECTOR2I[]): EDIT_POINTS => {
  const pts = new EDIT_POINTS(null);
  for (const c of aCorners) pts.AddPoint(c);
  return pts;
};

describe('ANGLE_ITEM', () => {
  it('draws nothing when no point is active or hovered', () => {
    const gal = drawAngles(
      polygon([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ]),
    );
    expect([gal.lines.length, gal.arcs.length, gal.texts.length]).toEqual([0, 0, 0]);
  });

  it('marks the active corner and its two neighbours, square ones with a right-angle mark', () => {
    const pts = polygon([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    pts.Point(0).SetActive();
    const gal = drawAngles(pts);

    // Three corners, all 90 degrees, so all congruent: each draws the mark and
    // an inner one at 0.6 of the radius - four lines apiece.
    expect(gal.arcs).toEqual([]);
    expect(gal.lines).toHaveLength(12);
    // Corner (0,0): its sides run to (0,100) and (100,0); radius 40.
    expect(gal.lines.slice(0, 2)).toEqual([
      [
        { x: 0, y: 40 },
        { x: 40, y: 40 },
      ],
      [
        { x: 40, y: 0 },
        { x: 40, y: 40 },
      ],
    ]);
    expect(gal.texts.map((t) => t.text)).toEqual(['90.0°', '90.0°', '90.0°']);
  });

  it('arcs a non-right angle, and doubles only the angles that are equal', () => {
    // Right triangle: 90 at (0,0), 45 at (100,0) and at (0,100).
    const pts = polygon([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ]);
    pts.Point(1).SetHover();
    const gal = drawAngles(pts);

    // The 90 is alone: its mark, no inner one. The two 45s are congruent: an
    // arc and an inner arc each.
    expect(gal.lines).toHaveLength(2);
    expect(gal.arcs.map((a) => a.radius)).toEqual([40, 28, 40, 28]);
    expect(gal.texts.map((t) => t.text)).toEqual(['90.0°', '45.0°', '45.0°']);
    // At (100,0) the sides run to (0,0) and (0,100). EDA_ANGLE( VECTOR2D ) of
    // (-100,0) is -180, not 180 (`aVector.x < 0 ? -180.0 : 0.0`), and of
    // (-100,100) is 135; the sweep is ( 135 - -180 ).Normalize180() = -45.
    expect(gal.arcs[0]).toMatchObject({ center: { x: 100, y: 0 }, start: -180, sweep: -45 });
  });
});
