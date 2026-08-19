// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The kimath primitives the teardrop generator is built on: the convex hull,
 * segment/chain intersection, chain area, circle tessellation and the Bezier
 * flattener.
 */
import { describe, it, expect } from 'vitest';
import { buildConvexHull } from '@ziroeda/kimath/src/geometry/convex_hull.js';
import { chainArea, chainIntersect, segIntersect } from '@ziroeda/kimath/src/geometry/seg.js';
import {
  circleToEndSegmentDeltaRadius,
  ErrorLoc,
  getArcToSegmentCount,
  transformCircleToPolygon,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';

describe('KiROUND', () => {
  it('rounds halves away from zero, unlike Math.round', () => {
    expect(KiROUND(2.5)).toBe(3);
    expect(KiROUND(-2.5)).toBe(-3);
    expect(Math.round(-2.5)).toBe(-2);
    expect(KiROUND(2.4)).toBe(2);
    expect(KiROUND(-2.4)).toBe(-2);
  });
});

describe('buildConvexHull', () => {
  it('returns the hull counter-clockwise, dropping interior points', () => {
    const hull = buildConvexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }, // inside
    ]);

    expect(hull).toHaveLength(4);
    // Counter-clockwise in raw coordinates: positive shoelace.
    expect(chainArea(hull, false)).toBeGreaterThan(0);
  });

  it('drops collinear points, keeping only true corners', () => {
    const hull = buildConvexHull([
      { x: 0, y: 0 },
      { x: 5, y: 0 }, // on the bottom edge
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);

    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual({ x: 5, y: 0 });
  });

  it('does not repeat the first point at the end', () => {
    const hull = buildConvexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]);

    expect(hull).toHaveLength(3);
  });

  it('returns nothing for fewer than two points', () => {
    expect(buildConvexHull([{ x: 1, y: 1 }])).toEqual([]);
  });
});

describe('segIntersect', () => {
  it('finds a proper crossing', () => {
    expect(
      segIntersect({ a: { x: -10, y: 0 }, b: { x: 10, y: 0 } }, { a: { x: 0, y: -10 }, b: { x: 0, y: 10 } }),
    ).toEqual({ x: 0, y: 0 });
  });

  it('misses when the segments do not reach each other', () => {
    expect(
      segIntersect({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, { a: { x: 5, y: -5 }, b: { x: 5, y: 5 } }),
    ).toBeNull();
  });

  it('counts a touch at an endpoint', () => {
    expect(
      segIntersect({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, { a: { x: 10, y: 0 }, b: { x: 10, y: 10 } }),
    ).toEqual({ x: 10, y: 0 });
  });

  it('reports no crossing for parallel segments', () => {
    expect(
      segIntersect({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, { a: { x: 0, y: 5 }, b: { x: 10, y: 5 } }),
    ).toBeNull();
  });
});

describe('chainIntersect', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('returns both crossings, nearest to the ray origin first', () => {
    const hits = chainIntersect(square, { x: -5, y: 5 }, { x: 15, y: 5 });

    expect(hits).toHaveLength(2);
    expect(hits[0]!.p).toEqual({ x: 0, y: 5 });
    expect(hits[1]!.p).toEqual({ x: 10, y: 5 });
  });

  it('closes the chain: the last-to-first edge counts', () => {
    // A ray that can only exit through the closing edge x = 0.
    const hits = chainIntersect(square, { x: 5, y: 5 }, { x: -5, y: 5 });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.p).toEqual({ x: 0, y: 5 });
  });
});

describe('chainArea', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('defaults to the absolute area, as SHAPE_LINE_CHAIN::Area does', () => {
    expect(chainArea(square)).toBe(100);
    expect(chainArea([...square].reverse())).toBe(100);
  });

  it('signs the area by winding when asked', () => {
    expect(chainArea(square, false)).toBe(100);
    expect(chainArea([...square].reverse(), false)).toBe(-100);
  });
});

describe('transformCircleToPolygon', () => {
  it('inscribes the polygon: every vertex sits on the circle', () => {
    const poly = transformCircleToPolygon(
      { x: 0, y: 0 },
      1_000_000,
      5_000,
      ErrorLoc.ERROR_INSIDE,
      16,
    );

    for (const p of poly) expect(Math.hypot(p.x, p.y)).toBeCloseTo(1_000_000, -1);
  });

  it('honours the minimum segment count and rounds it up to a multiple of 8', () => {
    // A tiny radius would otherwise get the 8-segment floor.
    const poly = transformCircleToPolygon({ x: 0, y: 0 }, 1_000, 5_000, ErrorLoc.ERROR_INSIDE, 16);

    expect(poly).toHaveLength(16);
    expect(poly.length % 8).toBe(0);
  });

  it('phases vertices by half a segment, so none lands on an axis', () => {
    const poly = transformCircleToPolygon({ x: 0, y: 0 }, 1_000, 5_000, ErrorLoc.ERROR_INSIDE, 16);

    for (const p of poly) {
      expect(p.x).not.toBe(0);
      expect(p.y).not.toBe(0);
    }
  });

  it('grows the radius for ERROR_OUTSIDE so the polygon encloses the circle', () => {
    const inside = transformCircleToPolygon(
      { x: 0, y: 0 },
      1_000_000,
      5_000,
      ErrorLoc.ERROR_INSIDE,
      16,
    );
    const outside = transformCircleToPolygon(
      { x: 0, y: 0 },
      1_000_000,
      5_000,
      ErrorLoc.ERROR_OUTSIDE,
      16,
    );

    expect(Math.hypot(outside[0]!.x, outside[0]!.y)).toBeGreaterThan(
      Math.hypot(inside[0]!.x, inside[0]!.y),
    );
  });
});

describe('getArcToSegmentCount', () => {
  it('asks for more segments as the error budget tightens', () => {
    const coarse = getArcToSegmentCount(1_000_000, 50_000, 360);
    const fine = getArcToSegmentCount(1_000_000, 1_000, 360);

    expect(fine).toBeGreaterThan(coarse);
  });

  it('never drops below two segments', () => {
    expect(getArcToSegmentCount(1, 1_000_000, 360)).toBeGreaterThanOrEqual(2);
  });
});

describe('BezierPoly', () => {
  it('starts and ends on the curve endpoints', () => {
    const poly = new BezierPoly(
      { x: 0, y: 0 },
      { x: 0, y: 100_000 },
      { x: 100_000, y: 100_000 },
      { x: 100_000, y: 0 },
    ).getPoly(1_000);

    expect(poly[0]).toEqual({ x: 0, y: 0 });
    expect(poly[poly.length - 1]).toEqual({ x: 100_000, y: 0 });
  });

  it('stays within the control polygon', () => {
    const poly = new BezierPoly(
      { x: 0, y: 0 },
      { x: 0, y: 100_000 },
      { x: 100_000, y: 100_000 },
      { x: 100_000, y: 0 },
    ).getPoly(1_000);

    for (const p of poly) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100_000);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100_000);
    }
  });

  it('spends more points on a tighter error budget', () => {
    const curve = (): BezierPoly =>
      new BezierPoly(
        { x: 0, y: 0 },
        { x: 0, y: 100_000 },
        { x: 100_000, y: 100_000 },
        { x: 100_000, y: 0 },
      );

    expect(curve().getPoly(100).length).toBeGreaterThan(curve().getPoly(10_000).length);
  });

  it('collapses a straight cubic to its endpoints', () => {
    const poly = new BezierPoly(
      { x: 0, y: 0 },
      { x: 10_000, y: 0 },
      { x: 20_000, y: 0 },
      { x: 30_000, y: 0 },
    ).getPoly(1_000);

    expect(poly).toEqual([
      { x: 0, y: 0 },
      { x: 30_000, y: 0 },
    ]);
  });

  it('flattens a quadratic too', () => {
    const poly = new BezierPoly([
      { x: 0, y: 0 },
      { x: 50_000, y: 100_000 },
      { x: 100_000, y: 0 },
    ]).getPoly(1_000);

    expect(poly.length).toBeGreaterThan(2);
    expect(poly[0]).toEqual({ x: 0, y: 0 });
    expect(poly[poly.length - 1]).toEqual({ x: 100_000, y: 0 });
  });
});

describe('circleToEndSegmentDeltaRadius', () => {
  it('measures the secant overshoot, not the chord sagitta', () => {
    // `aRadius` is the radius of the circle tangent to the middle of each
    // segment, so the circle through the segment *ends* has radius
    // r / cos(alpha) and the difference is r * (1 - 1/cos alpha). The
    // plausible-looking r * (1 - cos alpha) is the sagitta — how far a chord's
    // midpoint falls *inside* — a different quantity and always smaller.
    // At the 8-segment floor the two differ by 82 vs 76 on a 1000 radius.
    expect(circleToEndSegmentDeltaRadius(1000, 8)).toBe(82);
    expect(circleToEndSegmentDeltaRadius(1000, 16)).toBe(20);
  });

  it('clamps a degenerate segment count to three', () => {
    // Below three the quantity is not defined; upstream raises it to 3 rather
    // than dividing by a smaller count.
    expect(circleToEndSegmentDeltaRadius(1000, 2)).toBe(circleToEndSegmentDeltaRadius(1000, 3));
    expect(circleToEndSegmentDeltaRadius(1000, 0)).toBe(circleToEndSegmentDeltaRadius(1000, 3));
  });
});
