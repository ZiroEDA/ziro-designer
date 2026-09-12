// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/libs/kimath/geometry/test_segment.cpp` (Segment), transcribed
 * against the `SEG` class. Every symmetric predicate is checked in both
 * directions, as the C++ helpers do.
 */
import { describe, expect, it } from 'vitest';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

type P = [number, number];
const S = (a: P, b: P): SEG => new SEG({ x: a[0], y: a[1] }, { x: b[0], y: b[1] });
const V = (p: P): VECTOR2I => ({ x: p[0], y: p[1] });

function segCollideCorrect(
  aSegA: SEG,
  aSegB: SEG,
  aClearance: number,
  aExp: boolean,
  name: string,
): void {
  const AtoB = aSegA.Collide(aSegB, aClearance);
  const BtoA = aSegB.Collide(aSegA, aClearance);
  expect(AtoB, `${name}: A->B`).toBe(aExp);
  expect(BtoA, `${name}: B->A`).toBe(aExp);
}

function segDistanceCorrect(aSegA: SEG, aSegB: SEG, aExp: number, name: string): void {
  expect(aSegA.Distance(aSegB), `${name}: A->B`).toBe(aExp);
  expect(aSegB.Distance(aSegA), `${name}: B->A`).toBe(aExp);
  // Sanity check: the collision should be consistent with the distance
  segCollideCorrect(aSegA, aSegB, 0, aExp === 0, name);
}

function segVecDistanceCorrect(aSeg: SEG, aVec: VECTOR2I, aExp: number, name: string): void {
  expect(aSeg.SquaredDistance(aVec), `${name}: squared`).toBeGreaterThanOrEqual(0);
  expect(aSeg.Distance(aVec), name).toBe(aExp);
}

const both = (
  fn: (a: SEG, b: SEG) => boolean,
  aSegA: SEG,
  aSegB: SEG,
  aExp: boolean,
  name: string,
): void => {
  expect(fn(aSegA, aSegB), `${name}: A->B`).toBe(aExp);
  expect(fn(aSegB, aSegA), `${name}: B->A`).toBe(aExp);
};

describe('Segment', () => {
  it('EndpointCtorMod', () => {
    const pointA = { x: 10, y: 20 };
    const pointB = { x: 100, y: 200 };

    // Build a segment referencing the previous points
    const segment = new SEG(pointA, pointB);

    expect(pointA).toEqual({ x: 10, y: 20 });
    expect(pointB).toEqual({ x: 100, y: 200 });

    // Modify the ends of the segments
    segment.A.x += 10;
    segment.A.y += 10;
    segment.B.x += 100;
    segment.B.y += 100;

    // Check that the ends in segment are modified
    expect(segment.A).toEqual({ x: 20, y: 30 });
    expect(segment.B).toEqual({ x: 200, y: 300 });
    // and the originals are not (SEG copies)
    expect(pointA).toEqual({ x: 10, y: 20 });
  });

  it('SegSegDistance', () => {
    const cases: [string, P, P, P, P, number][] = [
      ['Parallel, 10 apart', [0, 0], [10, 0], [0, 10], [10, 10], 10],
      ['Non-parallel, 10 apart', [0, -5], [10, 0], [0, 10], [10, 10], 10],
      ['Co-incident', [0, 0], [30, 0], [10, 0], [20, 0], 0],
      ['Crossing', [0, -10], [0, 10], [-20, 0], [20, 0], 0],
      ['T-junction', [0, -10], [0, 10], [-20, 0], [0, 0], 0],
      ['T-junction (no touch)', [0, -10], [0, 10], [-20, 0], [-2, 0], 2],
      ['Zero-length segment A', [0, 0], [0, 0], [10, 0], [20, 0], 10],
      ['Zero-length segment B', [10, 0], [20, 0], [0, 0], [0, 0], 10],
      ['Both zero-length', [0, 0], [0, 0], [10, 0], [10, 0], 10],
    ];
    for (const [name, a1, a2, b1, b2, exp] of cases)
      segDistanceCorrect(S(a1, a2), S(b1, b2), exp, name);
  });

  it('SegVecDistance', () => {
    const cases: [string, P, P, P, number][] = [
      ['On endpoint', [0, 0], [10, 0], [0, 0], 0],
      ['On segment', [0, 0], [10, 0], [3, 0], 0],
      ['At side', [0, 0], [10, 0], [3, 2], 2],
      ['At end (collinear)', [0, 0], [10, 0], [12, 0], 2],
      // sqrt(200^2 + 200^2) = 282.8, rounded to nearest
      ['At end (not collinear)', [0, 0], [1000, 0], [1000 + 200, 200], 282],
      [
        'Issue 18473 (inside hit with rounding error)',
        [187360000, 42510000],
        [105796472, 42510000],
        [106645000, 42510000],
        0,
      ],
      [
        'Straight line x distance',
        [187360000, 42510000],
        [105796472, 42510000],
        [197360000, 42510000],
        10000000,
      ],
      [
        'Straight line -x distance',
        [187360000, 42510000],
        [105796472, 42510000],
        [104796472, 42510000],
        1000000,
      ],
    ];
    for (const [name, a, b, v, exp] of cases) segVecDistanceCorrect(S(a, b), V(v), exp, name);
  });

  it('SegSegCollision', () => {
    const cases: [string, P, P, P, P, number, boolean][] = [
      ['Parallel, 10 apart, 5 clear', [0, 0], [10, 0], [0, 10], [10, 10], 5, false],
      ['Parallel, 10 apart, 10 clear', [0, 0], [10, 0], [0, 10], [10, 10], 10, false],
      ['Parallel, 10 apart, 11 clear', [0, 0], [10, 0], [0, 10], [10, 10], 11, true],
      ['T-junction, 2 apart, 2 clear', [0, -10], [0, 0], [-20, 0], [-2, 0], 2, false],
      ['T-junction, 2 apart, 3 clear', [0, -10], [0, 0], [-20, 0], [-2, 0], 3, true],
      ['Zero-length segment A, 10 apart', [0, 0], [0, 0], [10, 0], [20, 0], 0, false],
      ['Zero-length segment A, 10 apart, 9 clear', [0, 0], [0, 0], [10, 0], [20, 0], 9, false],
      ['Zero-length segment A, 10 apart, 10 clear', [0, 0], [0, 0], [10, 0], [20, 0], 10, false],
      ['Zero-length segment A, 10 apart, 11 clear', [0, 0], [0, 0], [10, 0], [20, 0], 11, true],
      ['Zero-length segment B, 10 apart', [10, 0], [20, 0], [0, 0], [0, 0], 0, false],
      ['Both zero-length, same point', [5, 5], [5, 5], [5, 5], [5, 5], 0, true],
      ['Both zero-length, 10 apart', [0, 0], [0, 0], [10, 0], [10, 0], 0, false],
      ['Zero-length on segment', [5, 0], [5, 0], [0, 0], [10, 0], 0, true],
      [
        'Zero-length near segment, x overlaps but y differs',
        [5, 5],
        [5, 5],
        [0, 0],
        [10, 0],
        0,
        false,
      ],
      [
        'Zero-length near segment, x overlaps but y differs, 4 clear',
        [5, 5],
        [5, 5],
        [0, 0],
        [10, 0],
        4,
        false,
      ],
      [
        'Zero-length near segment, x overlaps but y differs, 5 clear',
        [5, 5],
        [5, 5],
        [0, 0],
        [10, 0],
        5,
        false,
      ],
      [
        'Zero-length near segment, x overlaps but y differs, 6 clear',
        [5, 5],
        [5, 5],
        [0, 0],
        [10, 0],
        6,
        true,
      ],
    ];
    for (const [name, a1, a2, b1, b2, clr, exp] of cases)
      segCollideCorrect(S(a1, a2), S(b1, b2), clr, exp, name);
  });

  it('SegSegCollinear', () => {
    const cases: [string, P, P, P, P, boolean][] = [
      ['coincident', [0, 0], [10, 0], [0, 0], [10, 0], true],
      ['end-to-end', [0, 0], [10, 0], [10, 0], [20, 0], true],
      ['In segment', [0, 0], [10, 0], [4, 0], [7, 0], true],
      ['At side, parallel', [0, 0], [10, 0], [4, 1], [7, 1], false],
      ['crossing', [0, 0], [10, 0], [5, -5], [5, 5], false],
    ];
    for (const [name, a1, a2, b1, b2, exp] of cases)
      both((a, b) => a.Collinear(b), S(a1, a2), S(b1, b2), exp, name);
  });

  it('SegSegParallel', () => {
    const cases: [string, P, P, P, P, boolean][] = [
      ['coincident', [0, 0], [10, 0], [0, 0], [10, 0], true],
      ['end-to-end', [0, 0], [10, 0], [10, 0], [20, 0], true],
      ['In segment', [0, 0], [10, 0], [4, 0], [7, 0], true],
      ['At side, parallel', [0, 0], [10, 0], [4, 1], [7, 1], true],
      ['crossing', [0, 0], [10, 0], [5, -5], [5, 5], false],
    ];
    for (const [name, a1, a2, b1, b2, exp] of cases)
      both((a, b) => a.ApproxParallel(b), S(a1, a2), S(b1, b2), exp, name);
  });

  it('SegSegPerpendicular', () => {
    const cases: [string, P, P, P, P, boolean][] = [
      ['coincident', [0, 0], [10, 0], [0, 0], [10, 0], false],
      ['end-to-end', [0, 0], [10, 0], [10, 0], [20, 0], false],
      ['In segment', [0, 0], [10, 0], [4, 0], [7, 0], false],
      ['At side, parallel', [0, 0], [10, 0], [4, 1], [7, 1], false],
      ['crossing 45 deg', [0, 0], [10, 0], [0, 0], [5, 5], false],
      ['very nearly perpendicular', [0, 0], [10, 0], [0, 0], [1, 10], true], //allow error margin of 1 IU
      ['not really perpendicular', [0, 0], [10, 0], [0, 0], [3, 10], false],
      ['perpendicular', [0, 0], [10, 0], [0, 0], [0, 10], true],
      ['perpendicular not intersecting', [0, 0], [10, 0], [15, 5], [15, 10], true],
    ];
    for (const [name, a1, a2, b1, b2, exp] of cases)
      both((a, b) => a.ApproxPerpendicular(b), S(a1, a2), S(b1, b2), exp, name);
  });

  const segment_and_point_cases: [string, P, P, P][] = [
    ['Horizontal: point on edge of seg', [0, 0], [10, 0], [0, 0]],
    ['Horizontal: point in middle of seg', [0, 0], [10, 0], [5, 0]],
    ['Horizontal: point outside seg', [0, 0], [10, 0], [20, 20]],
    ['Vertical: point on edge of seg', [0, 0], [0, 10], [0, 0]],
    ['Vertical: point in middle of seg', [0, 0], [0, 10], [0, 5]],
    ['Vertical: point outside seg', [0, 0], [0, 10], [20, 20]],
  ];

  it('SegCreateParallel', () => {
    for (const [name, a, b, v] of segment_and_point_cases) {
      const seg = S(a, b);
      const parallel = seg.ParallelSeg(V(v));
      both((p, q) => p.ApproxParallel(q), parallel, seg, true, name);
      segVecDistanceCorrect(parallel, V(v), 0, name);
    }
  });

  it('SegCreatePerpendicular', () => {
    for (const [name, a, b, v] of segment_and_point_cases) {
      const seg = S(a, b);
      const perpendicular = seg.PerpendicularSeg(V(v));
      both((p, q) => p.ApproxPerpendicular(q), perpendicular, seg, true, name);
      segVecDistanceCorrect(perpendicular, V(v), 0, name);
    }
  });

  it('LineDistance', () => {
    const seg = S([0, 0], [10, 0]);
    expect(seg.LineDistance({ x: 5, y: 0 })).toBe(0);
    expect(seg.LineDistance({ x: 5, y: 8 })).toBe(8);
  });

  it('LineDistanceSided', () => {
    const seg = S([0, 0], [10, 0]);
    expect(seg.LineDistance({ x: 5, y: 8 }, true)).toBe(8);
    expect(seg.LineDistance({ x: 5, y: -8 }, true)).toBe(-8);
  });

  it('SegSegIntersection', () => {
    // name, a, b, ignoreEndpoints, lines, expIntersect, expPoint
    const cases: [string, P, P, P, P, boolean, boolean, boolean, P][] = [
      ['Crossing at origin', [-10, 0], [10, 0], [0, -10], [0, 10], false, false, true, [0, 0]],
      ['Crossing at (5,5)', [0, 5], [10, 5], [5, 0], [5, 10], false, false, true, [5, 5]],
      ['T-junction intersection', [0, 0], [10, 0], [5, -5], [5, 0], false, false, true, [5, 0]],
      ['Parallel segments', [0, 0], [10, 0], [0, 5], [10, 5], false, false, false, [0, 0]],
      ['Separated segments', [0, 0], [5, 0], [10, 0], [15, 0], false, false, false, [0, 0]],
      [
        "Lines would intersect, but segments don't",
        [0, 0],
        [2, 0],
        [5, -5],
        [5, 5],
        false,
        false,
        false,
        [0, 0],
      ],
      [
        'Endpoint touching - should intersect',
        [0, 0],
        [10, 0],
        [10, 0],
        [20, 0],
        false,
        false,
        true,
        [10, 0],
      ],
      [
        'Endpoint touching - ignore endpoints',
        [0, 0],
        [10, 0],
        [10, 0],
        [20, 0],
        true,
        false,
        false,
        [0, 0],
      ],
      [
        'Endpoint touching at angle',
        [0, 0],
        [10, 0],
        [10, 0],
        [15, 5],
        false,
        false,
        true,
        [10, 0],
      ],
      [
        'Collinear overlapping segments',
        [0, 0],
        [10, 0],
        [5, 0],
        [15, 0],
        false,
        false,
        true,
        [7, 0],
      ],
      [
        'Collinear non-overlapping segments',
        [0, 0],
        [5, 0],
        [10, 0],
        [15, 0],
        false,
        false,
        false,
        [0, 0],
      ],
      [
        'Collinear touching at endpoint',
        [0, 0],
        [10, 0],
        [10, 0],
        [20, 0],
        false,
        false,
        true,
        [10, 0],
      ],
      [
        'Collinear contained segment',
        [0, 0],
        [20, 0],
        [5, 0],
        [15, 0],
        false,
        false,
        true,
        [10, 0],
      ],
      [
        'Collinear vertical overlapping',
        [5, 0],
        [5, 10],
        [5, 5],
        [5, 15],
        false,
        false,
        true,
        [5, 7],
      ],
      [
        "Lines intersect, segments don't",
        [0, 0],
        [2, 0],
        [5, -5],
        [5, 5],
        false,
        true,
        true,
        [5, 0],
      ],
      ['Parallel lines (infinite)', [0, 0], [10, 0], [0, 5], [10, 5], false, true, false, [0, 0]],
      ['Collinear lines (infinite)', [0, 0], [10, 0], [20, 0], [30, 0], false, true, true, [10, 0]],
      [
        'Zero-length segment intersection',
        [5, 5],
        [5, 5],
        [0, 5],
        [10, 5],
        false,
        false,
        true,
        [5, 5],
      ],
      ['Both zero-length, same point', [5, 5], [5, 5], [5, 5], [5, 5], false, false, true, [5, 5]],
      [
        'Both zero-length, different points',
        [5, 5],
        [5, 5],
        [10, 10],
        [10, 10],
        false,
        false,
        false,
        [0, 0],
      ],
      ['45-degree crossing', [0, 0], [10, 10], [0, 10], [10, 0], false, false, true, [5, 5]],
      ['Arbitrary angle crossing', [0, 0], [6, 8], [0, 8], [6, 0], false, false, true, [3, 4]],
      [
        'Far apart horizontal segments',
        [0, 0],
        [10, 0],
        [100, 0],
        [110, 0],
        false,
        false,
        false,
        [0, 0],
      ],
      [
        'Far apart vertical segments',
        [0, 0],
        [0, 10],
        [0, 100],
        [0, 110],
        false,
        false,
        false,
        [0, 0],
      ],
      [
        'Far apart diagonal segments',
        [0, 0],
        [10, 10],
        [100, 100],
        [110, 110],
        false,
        false,
        false,
        [0, 0],
      ],
    ];

    for (const [name, a1, a2, b1, b2, ignore, lines, expInt, expPt] of cases) {
      const segA = S(a1, a2);
      const segB = S(b1, b2);
      const resultA = segA.Intersect(segB, ignore, lines);
      const resultB = segB.Intersect(segA, ignore, lines);
      expect(resultA !== undefined, `${name}: A->B`).toBe(expInt);
      expect(resultB !== undefined, `${name}: B->A`).toBe(expInt);

      if (expInt && (expPt[0] !== 0 || expPt[1] !== 0)) {
        const tolerance = 1;
        for (const p of [resultA!, resultB!]) {
          expect(Math.abs(p.x - expPt[0]), `${name}: x`).toBeLessThanOrEqual(tolerance);
          expect(Math.abs(p.y - expPt[1]), `${name}: y`).toBeLessThanOrEqual(tolerance);
        }
      }
    }
  });

  it('IntersectLargeCoordinates', () => {
    const segA = S([1000000000, 0], [-1000000000, 0]);
    const segB = S([0, 1000000000], [0, -1000000000]);
    const intersection = segA.Intersect(segB, false, false);
    expect(intersection).toEqual({ x: 0, y: 0 });
  });

  it('IntersectOverflowDetection', () => {
    const max_coord = 2147483647;
    const segA = S([0, 0], [max_coord, max_coord]);
    const segB = S([max_coord, 0], [0, max_coord]);
    // completes without throwing; the C++ only logs the outcome
    segA.Intersect(segB, false, false);
  });

  it('IntersectPrecisionEdgeCases', () => {
    const segA = S([0, 0], [1000000, 1]);
    const segB = S([500000, -1], [500000, 2]);
    const intersection = segA.Intersect(segB, false, false);
    expect(intersection).toBeDefined();
    expect(intersection!.x).toBe(500000);
    expect(intersection!.y >= 0 && intersection!.y <= 1).toBe(true);
  });

  it('IntersectIgnoreEndpointsEdgeCases', () => {
    const segA = S([0, 0], [10, 0]);
    const segB = S([5, -5], [5, 5]);
    expect(segA.Intersect(segB, false, false)).toEqual({ x: 5, y: 0 });
    expect(segA.Intersect(segB, true, false)).toEqual({ x: 5, y: 0 });

    const segC = S([10, 0], [20, 0]);
    expect(segA.Intersect(segC, false, false)).toEqual({ x: 10, y: 0 });
    expect(segA.Intersect(segC, true, false)).toBeUndefined();
  });

  it('IntersectCollinearRegressionTests', () => {
    const i1 = S([0, 5], [10, 5]).Intersect(S([5, 5], [15, 5]), false, false)!;
    expect(i1.y).toBe(5);
    expect(i1.x >= 5 && i1.x <= 10).toBe(true); // Should be in overlap region

    const i2 = S([3, 0], [3, 20]).Intersect(S([3, 5], [3, 15]), false, false)!;
    expect(i2.x).toBe(3);
    expect(i2.y >= 5 && i2.y <= 15).toBe(true); // Should be in contained segment

    const i3 = S([0, 0], [10, 10]).Intersect(S([5, 5], [15, 15]), false, false)!;
    expect(i3.x >= 5 && i3.x <= 10).toBe(true);
    expect(i3.y >= 5 && i3.y <= 10).toBe(true);
    expect(i3.x).toBe(i3.y); // Should maintain diagonal relationship

    const seg7 = S([0, 0], [5, 0]);
    const seg8 = S([5, 0], [10, 0]);
    expect(seg7.Intersect(seg8, false, false)).toEqual({ x: 5, y: 0 });
    expect(seg7.Intersect(seg8, true, false)).toBeUndefined();

    expect(S([0, 0], [5, 0]).Intersect(S([10, 0], [15, 0]), false, false)).toBeUndefined();
  });

  it('IntersectBoundingBoxOptimization', () => {
    expect(S([0, 0], [10, 10]).Intersect(S([100, 100], [110, 110]), false, false)).toBeUndefined();
    expect(S([0, 0], [10, 0]).Intersect(S([5, 5], [15, 5]), false, false)).toBeUndefined();
    expect(S([0, 0], [10, 10]).Intersect(S([10, 0], [0, 10]), false, false)).toEqual({
      x: 5,
      y: 5,
    });
  });

  it('IntersectLineVsSegmentMode', () => {
    const seg1 = S([0, 0], [5, 0]);
    const seg2 = S([10, -5], [10, 5]);
    expect(seg1.Intersect(seg2, false, false)).toBeUndefined();
    expect(seg1.Intersect(seg2, false, true)).toEqual({ x: 10, y: 0 });

    const seg3 = S([0, 0], [10, 0]);
    const seg4 = S([20, 0], [30, 0]);
    expect(seg3.Intersect(seg4, false, false)).toBeUndefined();
    expect(seg3.Intersect(seg4, false, true)).toBeDefined();
  });

  it('IntersectNumericalStability', () => {
    const i1 = S([0, 0], [1, 1]).Intersect(S([0, 1], [1, 0]), false, false)!;
    expect(i1.x >= 0 && i1.x <= 1).toBe(true);
    expect(i1.y >= 0 && i1.y <= 1).toBe(true);

    // Should be detected as parallel/non-intersecting
    expect(S([0, 0], [1000, 1]).Intersect(S([0, 1], [1000, 2]), false, false)).toBeUndefined();

    const i3 = S([0, 0], [1000000, 1]).Intersect(S([500000, -1], [500000, 2]), false, false)!;
    expect(i3.x).toBe(500000);
  });

  it('IntersectZeroLengthSegments', () => {
    const point1 = { x: 5, y: 5 };
    const point2 = { x: 10, y: 10 };
    const pointSeg1 = new SEG(point1, point1); // Zero-length segment (point)
    const pointSeg2 = new SEG(point2, point2); // Another zero-length segment
    const normalSeg = S([0, 5], [10, 5]); // Normal segment

    expect(pointSeg1.Intersect(normalSeg, false, false)).toEqual(point1);
    expect(pointSeg2.Intersect(normalSeg, false, false)).toBeUndefined();

    const pointSeg3 = new SEG(point1, point1);
    expect(pointSeg1.Intersect(pointSeg3, false, false)).toEqual(point1);
    expect(pointSeg1.Intersect(pointSeg2, false, false)).toBeUndefined();

    const lineSeg = S([0, 0], [1, 1]); // Diagonal line segment
    const pointOnLine = S([100, 100], [100, 100]); // Point on extended line
    expect(pointOnLine.Intersect(lineSeg, false, false)).toBeUndefined(); // Point not on segment
    expect(pointOnLine.Intersect(lineSeg, false, true)).toEqual({ x: 100, y: 100 }); // Point on infinite line
  });

  it('SegLineIntersection', () => {
    const cases: [string, P, P, number, number, boolean, P][] = [
      ['Horizontal segment, diagonal line', [0, 5], [10, 5], 1.0, 0.0, true, [5, 5]],
      ['Vertical segment, horizontal line', [5, 0], [5, 10], 0.0, 3.0, true, [5, 3]],
      ['Diagonal segment, horizontal line crossing', [0, 0], [10, 10], 0.0, 5.0, true, [5, 5]],
      [
        'Diagonal segment, vertical line (steep slope)',
        [0, 0],
        [10, 10],
        1000.0,
        -5000.0,
        true,
        [5, 5],
      ],
      ['Horizontal segment, parallel horizontal line', [0, 5], [10, 5], 0.0, 10.0, false, [0, 0]],
      ['Diagonal segment, parallel line', [0, 0], [10, 10], 1.0, 5.0, false, [0, 0]],
      ['Segment above line', [0, 10], [10, 10], 0.0, 5.0, false, [0, 0]],
      ['Segment to left of steep line', [0, 0], [2, 2], 1.0, 10.0, false, [0, 0]],
      ['Horizontal segment on horizontal line', [0, 5], [10, 5], 0.0, 5.0, true, [5, 5]],
      ['Diagonal segment on diagonal line', [0, 0], [10, 10], 1.0, 0.0, true, [5, 5]],
      [
        'Vertical segment, any line slope (collinear impossible)',
        [5, 0],
        [5, 10],
        2.0,
        -5.0,
        true,
        [5, 5],
      ],
      ['Zero-length segment (point) on line', [3, 7], [3, 7], 2.0, 1.0, true, [3, 7]],
      ['Zero-length segment (point) not on line', [3, 5], [3, 5], 2.0, 1.0, false, [0, 0]],
      ['Line with zero slope (horizontal)', [0, 0], [10, 5], 0.0, 2.5, true, [5, 2]],
      ['Very steep positive slope', [0, 0], [10, 1], 100.0, -250.0, true, [2, 0]],
      ['Very steep negative slope', [0, 0], [10, 10], -100.0, 505.0, true, [5, 5]],
      ['Fractional slope', [0, 0], [12, 8], 0.5, 1.0, true, [6, 4]],
      ['Line passes through segment start point', [2, 3], [80, 90], 1.0, 1.0, true, [2, 3]],
      ['Line passes through segment end point', [20, 30], [8, 9], 1.0, 1.0, true, [8, 9]],
      ['Line intersects near endpoint', [0, 0], [10, 0], 0.0, 0.0, true, [5, 0]],
      ['Nearly parallel lines', [0, 0], [1000, 1], 0.0011, -0.05, true, [500, 1]],
      ['Line intersection outside segment bounds', [5, 5], [10, 10], 1.0, -10.0, false, [0, 0]],
    ];

    for (const [name, a, b, slope, offset, expInt, expPt] of cases) {
      const intersection = { x: 0, y: 0 };
      const intersects = S(a, b).IntersectsLine(slope, offset, intersection);
      expect(intersects, name).toBe(expInt);

      if (expInt && (expPt[0] !== 0 || expPt[1] !== 0)) {
        expect(Math.abs(intersection.x - expPt[0]), `${name}: x`).toBeLessThanOrEqual(1);
        expect(Math.abs(intersection.y - expPt[1]), `${name}: y`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('IntersectLineVerticalSegments', () => {
    const verticalSeg = S([5, 0], [5, 10]);
    const intersection = { x: 0, y: 0 };

    expect(verticalSeg.IntersectsLine(0.0, 7.0, intersection)).toBe(true);
    expect(intersection).toEqual({ x: 5, y: 7 });

    expect(verticalSeg.IntersectsLine(2.0, -5.0, intersection)).toBe(true); // y = 2x - 5
    expect(intersection).toEqual({ x: 5, y: 5 }); // At x=5: y = 2*5 - 5 = 5

    expect(verticalSeg.IntersectsLine(1.0, 20.0, intersection)).toBe(false); // y = x + 20
  });

  it('IntersectLineVerticalSegmentsCorrection', () => {
    const verticalSeg = S([5, 0], [5, 10]);
    const intersection = { x: 0, y: 0 };

    expect(verticalSeg.IntersectsLine(1.0, 20.0, intersection)).toBe(false); // At x=5: y = 25, outside [0,10]

    expect(verticalSeg.IntersectsLine(0.5, 2.0, intersection)).toBe(true); // y = 0.5x + 2
    expect(intersection).toEqual({ x: 5, y: 5 }); // At x=5: y = 4.5 ≈ 5 (round up)
  });

  it('IntersectLineParallelDetection', () => {
    const horizontalSeg = S([0, 5], [10, 5]);
    const intersection = { x: 0, y: 0 };

    expect(horizontalSeg.IntersectsLine(0.0, 8.0, intersection)).toBe(false); // y = 8
    expect(horizontalSeg.IntersectsLine(0.0, 5.0, intersection)).toBe(true); // y = 5
    expect(intersection).toEqual({ x: 5, y: 5 }); // Midpoint

    const diagonalSeg = S([0, 0], [10, 10]);
    expect(diagonalSeg.IntersectsLine(1.0, 3.0, intersection)).toBe(false); // y = x + 3
    expect(diagonalSeg.IntersectsLine(1.0, 0.0, intersection)).toBe(true); // y = x
    expect(intersection).toEqual({ x: 5, y: 5 }); // Midpoint
  });

  it('IntersectLinePrecisionEdgeCases', () => {
    const shallowSeg = S([0, 100], [1000000, 101]); // Almost horizontal
    const intersection = { x: 0, y: 0 };

    if (shallowSeg.IntersectsLine(1000.0, -499900.0, intersection)) {
      expect(intersection.x >= 0 && intersection.x <= 1000000).toBe(true);
      expect(intersection.y >= 100 && intersection.y <= 101).toBe(true);
    }

    const largeSeg = S([1000000, 1000000], [2000000, 2000000]);
    expect(largeSeg.IntersectsLine(1.0, 0.0, intersection)).toBe(true); // y = x
    expect(intersection).toEqual({ x: 1500000, y: 1500000 }); // Midpoint
  });

  it('IntersectLineZeroLengthSegments', () => {
    const point = { x: 10, y: 20 };
    const pointSeg = new SEG(point, point);
    const intersection = { x: 0, y: 0 };

    expect(pointSeg.IntersectsLine(2.0, 0.0, intersection)).toBe(true); // Point (10, 20) is on line y = 2x
    expect(intersection).toEqual(point);

    expect(pointSeg.IntersectsLine(3.0, 0.0, intersection)).toBe(false); // would be y = 30

    expect(pointSeg.IntersectsLine(0.0, 20.0, intersection)).toBe(true); // y = 20
    expect(intersection).toEqual(point);
  });
});

// seg.h members the C++ suite does not exercise: transcribed semantics.
describe('SEG header members', () => {
  it('Side is the sign of the cross product', () => {
    const seg = S([0, 0], [10, 0]);
    expect(seg.Side({ x: 5, y: 5 })).toBe(1);
    expect(seg.Side({ x: 5, y: -5 })).toBe(-1);
    expect(seg.Side({ x: 5, y: 0 })).toBe(0);
  });

  it('Center rounds the half away from zero, Length is the integer norm', () => {
    expect(S([0, 0], [5, 0]).Center()).toEqual({ x: 3, y: 0 });
    expect(S([0, 0], [-5, 0]).Center()).toEqual({ x: -3, y: 0 });
    expect(S([0, 0], [3, 4]).Length()).toBe(5);
    expect(S([0, 0], [3, 4]).SquaredLength()).toBe(25);
  });

  it('Overlaps and Contains(SEG)', () => {
    const seg = S([0, 0], [10, 0]);
    expect(seg.Overlaps(S([5, 0], [15, 0]))).toBe(true);
    expect(seg.Overlaps(S([11, 0], [15, 0]))).toBe(true); // Contains( pt ) is SquaredDistance <= 3
    expect(seg.Overlaps(S([12, 0], [15, 0]))).toBe(false);
    expect(seg.Overlaps(S([5, 1], [15, 1]))).toBe(false);
    // a point at an endpoint does not overlap; one inside does
    expect(seg.Overlaps(S([10, 0], [10, 0]))).toBe(false);
    expect(seg.Overlaps(S([5, 0], [5, 0]))).toBe(true);
    expect(seg.Contains(S([2, 0], [8, 0]))).toBe(true);
    expect(seg.Contains(S([2, 0], [12, 0]))).toBe(false);
  });

  it('Reverse, Reversed, Index, TCoef, ReflectPoint, Angle', () => {
    const seg = new SEG({ x: 1, y: 2 }, { x: 3, y: 4 }, 7);
    expect(seg.Index()).toBe(7);
    expect(seg.Reversed().A).toEqual({ x: 3, y: 4 });
    seg.Reverse();
    expect(seg.A).toEqual({ x: 3, y: 4 });
    expect(S([0, 0], [10, 0]).TCoef({ x: 4, y: 9 })).toBe(40);
    expect(S([0, 0], [10, 0]).ReflectPoint({ x: 4, y: 3 })).toEqual({ x: 4, y: -3 });
    expect(
      S([0, 0], [10, 0])
        .Angle(S([0, 0], [0, 10]))
        .AsDegrees(),
    ).toBe(90);
    expect(
      S([0, 0], [10, 0])
        .Angle(S([0, 0], [-10, 0]))
        .AsDegrees(),
    ).toBe(180);
  });

  it('NearestPoints writes both points and the squared distance', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    const d = { value: -1 };
    expect(S([0, 0], [10, 0]).NearestPoints(S([5, 3], [5, 10]), a, b, d)).toBe(true);
    expect(a).toEqual({ x: 5, y: 0 });
    expect(b).toEqual({ x: 5, y: 3 });
    expect(d.value).toBe(9);
  });
});
