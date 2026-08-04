// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Merge, subtract and intersect polygons.
 * Counterparts: `POLYGON_BOOLEAN_ROUTINE`, `POLYGON_MERGE_ROUTINE`,
 * `POLYGON_SUBTRACT_ROUTINE` and `POLYGON_INTERSECT_ROUTINE`, over
 * `SHAPE_POLY_SET`'s Clipper-backed boolean ops.
 *
 * Results are checked by *area*, which is what the operations are actually
 * about and what stays meaningful when Clipper renumbers or reorders the
 * vertices. Two overlapping 10 mm squares offset by 5 mm give a union of 175
 * mm², a difference of 75 mm² and an intersection of 25 mm² — three numbers
 * that no two of the operations share, so a test cannot pass under the wrong
 * one.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  booleanableShapeCount,
  polygonBoolean,
  shapeAsPolygon,
} from '@ziroeda/pcbnew/src/polygon_booleans.js';
import {
  booleanAdd,
  booleanIntersection,
  booleanSubtract,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Board, PcbShape } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const rect = (x0: number, y0: number, x1: number, y1: number): PcbShape => ({
  kind: 'rect',
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: MM(0.15),
  fill: true,
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
  groups: [],
  source: EMPTY,
});

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `shape:${i}`);

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

const totalArea = (b: Board): number =>
  b.shapes.reduce((sum, s) => sum + (s.pts ? areaMM(s.pts) : 0), 0);

/** Two 10 mm squares overlapping by a 5 x 5 mm corner. */
const overlapping = (): PcbShape[] => [rect(0, 0, 10, 10), rect(5, 5, 15, 15)];

describe('what a shape contributes', () => {
  it('takes a polygon as it stands', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: MM(5), y: 0 },
      { x: 0, y: MM(5) },
    ];
    const poly: PcbShape = {
      kind: 'poly',
      pts,
      width: 0,
      fill: true,
      layer: 'F.SilkS',
      source: EMPTY,
    };

    expect(shapeAsPolygon(poly)).toEqual([pts]);
  });

  it('turns a rectangle into its four corners', () => {
    expect(shapeAsPolygon(rect(0, 0, 10, 4))![0]).toHaveLength(4);
  });

  it('turns a circle into a ring of about the right area', () => {
    const circle: PcbShape = {
      kind: 'circle',
      center: { x: 0, y: 0 },
      end: { x: MM(5), y: 0 },
      width: MM(0.2),
      fill: false,
      layer: 'F.SilkS',
      source: EMPTY,
    };
    const ring = shapeAsPolygon(circle)![0]!;

    expect(areaMM(ring) / (Math.PI * 25)).toBeGreaterThan(0.99);
    expect(ring[0]).not.toEqual(ring[ring.length - 1]);
  });

  it('refuses anything that is not an area', () => {
    const line: PcbShape = {
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: MM(10), y: 0 },
      width: MM(0.2),
      fill: false,
      layer: 'F.SilkS',
      source: EMPTY,
    };

    expect(shapeAsPolygon(line)).toBeNull();
  });

  it('counts what a boolean would consider', () => {
    const b = board([
      rect(0, 0, 10, 10),
      {
        kind: 'line',
        start: { x: 0, y: 0 },
        end: { x: MM(10), y: 0 },
        width: MM(0.2),
        fill: false,
        layer: 'F.SilkS',
        source: EMPTY,
      },
    ]);

    expect(booleanableShapeCount(b, ids(2))).toBe(1);
  });
});

describe('the underlying boolean ops', () => {
  const sq = (x0: number, y0: number, x1: number, y1: number) => [
    [
      { x: MM(x0), y: MM(y0) },
      { x: MM(x1), y: MM(y0) },
      { x: MM(x1), y: MM(y1) },
      { x: MM(x0), y: MM(y1) },
    ],
  ];

  it('unions two overlapping squares to 175 mm²', () => {
    const r = booleanAdd([sq(0, 0, 10, 10)], [sq(5, 5, 15, 15)]);

    expect(r).toHaveLength(1);
    expect(areaMM(r[0]![0]!)).toBeCloseTo(175, 3);
  });

  it('subtracts to 75 mm²', () => {
    const r = booleanSubtract([sq(0, 0, 10, 10)], [sq(5, 5, 15, 15)]);

    expect(areaMM(r[0]![0]!)).toBeCloseTo(75, 3);
  });

  it('intersects to 25 mm²', () => {
    const r = booleanIntersection([sq(0, 0, 10, 10)], [sq(5, 5, 15, 15)]);

    expect(areaMM(r[0]![0]!)).toBeCloseTo(25, 3);
  });

  it('returns nothing when there is no overlap to intersect', () => {
    expect(booleanIntersection([sq(0, 0, 10, 10)], [sq(50, 50, 60, 60)])).toEqual([]);
  });

  it('keeps disjoint results apart', () => {
    // A union of two squares that do not touch is two outlines, not one.
    const r = booleanAdd([sq(0, 0, 10, 10)], [sq(50, 50, 60, 60)]);

    expect(r).toHaveLength(2);
  });

  it('reports a hole as a hole, not as a second outline', () => {
    // A ring: a big square minus a small one wholly inside it. The result must
    // be one outline carrying one hole, not two separate outlines — the caller
    // relies on that grouping to know which ring to fracture into which.
    const r = booleanSubtract([sq(0, 0, 30, 30)], [sq(10, 10, 20, 20)]);

    expect(r).toHaveLength(1);
    expect(r[0]).toHaveLength(2);
    expect(areaMM(r[0]![0]!)).toBeCloseTo(900, 3);
    expect(areaMM(r[0]![1]!)).toBeCloseTo(100, 3);
  });
});

describe('merging on the board', () => {
  it('replaces both sources with one shape of the union area', () => {
    const b = board(overlapping());
    const out = polygonBoolean(b, ids(2), 'merge');

    expect(out.successes).toBe(1);
    expect(out.board.shapes).toHaveLength(1);
    expect(totalArea(out.board)).toBeCloseTo(175, 3);
  });

  it('takes the layer, width and fill from the first source', () => {
    const shapes = overlapping();
    shapes[0] = { ...shapes[0]!, layer: 'B.SilkS', width: MM(0.4), fill: false };
    const out = polygonBoolean(board(shapes), ids(2), 'merge');

    expect(out.board.shapes[0]!.layer).toBe('B.SilkS');
    expect(out.board.shapes[0]!.width).toBe(MM(0.4));
    expect(out.board.shapes[0]!.fill).toBe(false);
  });

  it('leaves disjoint sources as separate shapes', () => {
    const b = board([rect(0, 0, 10, 10), rect(50, 50, 60, 60)]);
    const out = polygonBoolean(b, ids(2), 'merge');

    expect(out.board.shapes).toHaveLength(2);
    expect(totalArea(out.board)).toBeCloseTo(200, 3);
  });

  it('folds a third source into the running result', () => {
    const b = board([rect(0, 0, 10, 10), rect(5, 5, 15, 15), rect(10, 10, 20, 20)]);
    const out = polygonBoolean(b, ids(3), 'merge');

    expect(out.successes).toBe(2);
    expect(out.board.shapes).toHaveLength(1);
  });

  it('does nothing with a single polygon', () => {
    const b = board([rect(0, 0, 10, 10)]);

    expect(polygonBoolean(b, ids(1), 'merge').board).toBe(b);
  });

  it('ignores selected items that are not areas', () => {
    const b = board([
      rect(0, 0, 10, 10),
      {
        kind: 'line',
        start: { x: 0, y: 0 },
        end: { x: MM(10), y: 0 },
        width: MM(0.2),
        fill: false,
        layer: 'F.SilkS',
        source: EMPTY,
      },
    ]);

    expect(polygonBoolean(b, ids(2), 'merge').board).toBe(b);
  });
});

describe('subtracting on the board', () => {
  it('leaves the first source minus the rest', () => {
    const b = board(overlapping());
    const out = polygonBoolean(b, ids(2), 'subtract');

    expect(totalArea(out.board)).toBeCloseTo(75, 3);
  });

  it('depends on the order, unlike merging', () => {
    // First minus the rest: swapping the two gives the other 75 mm² piece, and
    // the shapes are in different places.
    const forward = polygonBoolean(board(overlapping()), ['shape:0', 'shape:1'], 'subtract');
    const backward = polygonBoolean(board(overlapping()), ['shape:1', 'shape:0'], 'subtract');

    expect(forward.board.shapes[0]!.pts).not.toEqual(backward.board.shapes[0]!.pts);
  });

  it('fractures a hole into the outline rather than losing it', () => {
    // Neither PcbShape nor `(gr_poly (pts …))` can hold a hole, so the ring is
    // slit open to the hole and back. The area is what proves the hole survived
    // at all: 900 - 100 = 800 mm².
    const b = board([rect(0, 0, 30, 30), rect(10, 10, 20, 20)]);
    const out = polygonBoolean(b, ids(2), 'subtract');

    expect(out.board.shapes).toHaveLength(1);
    expect(areaMM(out.board.shapes[0]!.pts!)).toBeCloseTo(800, 1);
  });

  it('splits a shape a subtraction cuts in two', () => {
    // A bar straight across the middle leaves two disconnected pieces, and each
    // becomes its own shape.
    const b = board([rect(0, 0, 30, 30), rect(-5, 12, 35, 18)]);
    const out = polygonBoolean(b, ids(2), 'subtract');

    expect(out.board.shapes).toHaveLength(2);
    expect(totalArea(out.board)).toBeCloseTo(720, 1);
  });
});

describe('intersecting on the board', () => {
  it('leaves only the overlap', () => {
    const b = board(overlapping());
    const out = polygonBoolean(b, ids(2), 'intersect');

    expect(totalArea(out.board)).toBeCloseTo(25, 3);
  });

  it('refuses a source that would erase everything', () => {
    // Intersecting with something that does not overlap would leave nothing at
    // all; upstream skips the source and reports it instead of committing.
    const b = board([rect(0, 0, 10, 10), rect(50, 50, 60, 60)]);
    const out = polygonBoolean(b, ids(2), 'intersect');

    expect(out.successes).toBe(0);
    expect(out.failures).toBe(1);
    expect(out.board).toBe(b);
  });

  it('keeps the sources when every fold fails', () => {
    const b = board([rect(0, 0, 10, 10), rect(50, 50, 60, 60)]);

    expect(polygonBoolean(b, ids(2), 'intersect').board.shapes).toHaveLength(2);
  });

  it('still folds in the sources that do overlap', () => {
    // Two that overlap and one that does not: two successes are impossible
    // here, but the overlapping one must go through and the other be reported.
    const b = board([rect(0, 0, 10, 10), rect(5, 5, 15, 15), rect(50, 50, 60, 60)]);
    const out = polygonBoolean(b, ids(3), 'intersect');

    expect(out.successes).toBe(1);
    expect(out.failures).toBe(1);
    expect(totalArea(out.board)).toBeCloseTo(25, 3);
  });
});
