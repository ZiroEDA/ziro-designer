// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The per-shape-pair collision table.
 * Counterpart: `libs/kimath/src/geometry/shape_collisions.cpp`.
 *
 * Almost every test here is about **where** two shapes were said to have met,
 * because that is the only thing the port adds over the collider it replaces and
 * it is the thing a plausible rewrite would get wrong. `aLocation` is not the
 * point of closest approach and it is not the same kind of point twice running:
 *
 * - two circles report the midpoint of their **centres**, which is nowhere near
 *   either circumference;
 * - two segments report a point on the **first argument's** segment, so the same
 *   pair collided in the other order answers somewhere else;
 * - a chain that encloses the other shape reports the *enclosed* point — the
 *   segment's `A` end, the other chain's point `0`, the circle's centre — and
 *   never anything on the chain itself.
 *
 * The tests are written with the numbers worked out by hand so that a
 * "simplification" that happens to still collide is still caught.
 */
import { describe, expect, it } from 'vitest';
import {
  arcIsEffectiveLine,
  arcNearestPointsArc,
  arcSliceContainsPoint,
  chainPointInside,
  circleIntersectCircle,
  circleIntersectSeg,
  collideShapes,
} from '@ziroeda/pcbnew/src/drc/shape_collisions.js';
import { shapeDist, type Shape } from '@ziroeda/pcbnew/src/drc/drc_geometry.js';

// ----- fixtures ----------------------------------------------------------------

const circle = (x: number, y: number, r: number): Shape => ({ kind: 'circle', c: { x, y }, r });

const stadium = (ax: number, ay: number, bx: number, by: number, r = 0): Shape => ({
  kind: 'stadium',
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  r,
});

const poly = (pts: [number, number][], r = 0): Shape => ({
  kind: 'poly',
  pts: pts.map(([x, y]) => ({ x, y })),
  r,
});

/** The unit square 0..100, wound clockwise from the origin. */
const square = (r = 0): Shape =>
  poly(
    [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ],
    r,
  );

// ----- circle against circle ---------------------------------------------------

describe('circle against circle', () => {
  it('reports the midpoint of the two centres, which lies outside both circles', () => {
    const hit = collideShapes(circle(0, 0, 100), circle(300, 0, 100), 200);

    expect(hit.collides).toBe(true);
    expect(hit.actual).toBe(100);
    // Not a contact point: it is 150 from each centre, and each radius is 100.
    expect(hit.location).toEqual({ x: 150, y: 0 });
  });

  it('the midpoint is the answer even when one circle swallows the other', () => {
    // A point of closest approach would be somewhere on the small circle; the
    // midpoint of the centres is inside both.
    const hit = collideShapes(circle(0, 0, 500), circle(100, 0, 10), 0);

    expect(hit.collides).toBe(true);
    expect(hit.location).toEqual({ x: 50, y: 0 });
  });

  it('two exactly touching circles do not collide, at zero clearance or below', () => {
    // `dist_sq < min_dist_sq` with min_dist = clearance + rA + rB, so touching
    // needs a strictly positive clearance. The stand-in collider disagrees: it
    // reads `d === 0` off the *clamped* gap and calls this a collision.
    const a = circle(0, 0, 100);
    const b = circle(200, 0, 100);

    expect(shapeDist(a, b)).toBe(0);
    expect(collideShapes(a, b, 0).collides).toBe(false);
    expect(collideShapes(a, b, -1).collides).toBe(false);
    expect(collideShapes(a, b, 1).collides).toBe(true);
  });

  it('co-centred circles collide at any clearance, because dist_sq is zero', () => {
    // The `dist_sq == 0` arm is about the *centres* coinciding, not about the
    // shapes overlapping — which is why it survives a negative clearance.
    const hit = collideShapes(circle(0, 0, 50), circle(0, 0, 10), -1000);

    expect(hit.collides).toBe(true);
    expect(hit.actual).toBe(0);
    expect(hit.location).toEqual({ x: 0, y: 0 });
  });

  it('does not collide when it does not, and then has no location at all', () => {
    const hit = collideShapes(circle(0, 0, 10), circle(500, 0, 10), 100);

    expect(hit.collides).toBe(false);
    expect(hit.location).toBeNull();
  });
});

// ----- circle against segment --------------------------------------------------

describe('circle against stadium', () => {
  it('reports a point on the segment, and answers the same in either order', () => {
    const c = circle(0, -50, 10);
    const s = stadium(0, 0, 100, 0, 5);

    // gap = 50 - 10 - 5 = 35, so 40 of clearance collides.
    const forwards = collideShapes(c, s, 40);
    const backwards = collideShapes(s, c, 40);

    expect(forwards.collides).toBe(true);
    expect(forwards.actual).toBe(35);
    expect(forwards.location).toEqual({ x: 0, y: 0 });

    // `CollCaseReversed<SHAPE_SEGMENT, SHAPE_CIRCLE>` puts the circle first
    // whichever way the caller asked, so this pair *is* symmetric.
    expect(backwards).toEqual(forwards);
  });

  it('picks the circle/segment intersection when the segment runs through the centre', () => {
    // `dist_sq == 0` and the circle cuts the segment, so `aLocation` is
    // `Intersect( aSeg )[0]` rather than the nearest point (which is the centre).
    const hit = collideShapes(circle(50, 0, 10), stadium(0, 0, 100, 0), 1);

    expect(hit.collides).toBe(true);
    expect(hit.location).not.toEqual({ x: 50, y: 0 });
    expect(
      circleIntersectSeg({ c: { x: 50, y: 0 }, r: 10 }, { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }),
    ).toHaveLength(2);
    expect(hit.location?.y).toBe(0);
    expect(Math.abs((hit.location?.x ?? 0) - 50)).toBeCloseTo(10, 9);
  });
});

// ----- segment against segment -------------------------------------------------

describe('stadium against stadium', () => {
  // Two parallel zero-width segments 20 apart, overlapping in x over [50, 100].
  // Every point of that interval is a closest approach, so which one comes back
  // is entirely `SEG::NearestPoint`'s candidate ranking — and it differs by
  // argument order.
  const a = stadium(0, 0, 100, 0);
  const b = stadium(50, 20, 150, 20);

  it('reports a point on the FIRST argument, so the pair is asymmetric', () => {
    const forwards = collideShapes(a, b, 30);
    const backwards = collideShapes(b, a, 30);

    expect(forwards.collides).toBe(true);
    expect(backwards.collides).toBe(true);
    expect(forwards.actual).toBe(20);
    expect(backwards.actual).toBe(20);

    expect(forwards.location).toEqual({ x: 100, y: 0 });
    expect(backwards.location).toEqual({ x: 50, y: 20 });
  });

  it('the half-widths are folded into the clearance and taken back off the gap', () => {
    const wide = stadium(0, 0, 100, 0, 6);
    const other = stadium(50, 20, 150, 20, 4);

    // Centreline distance 20, so the copper gap is 20 - 6 - 4 = 10.
    expect(collideShapes(wide, other, 11).actual).toBe(10);
    expect(collideShapes(wide, other, 10).collides).toBe(false);
  });
});

// ----- chain against segment ---------------------------------------------------

describe('poly against stadium', () => {
  it("reports the segment's A endpoint when the polygon encloses it", () => {
    const s = stadium(50, 50, 500, 50);

    const hit = collideShapes(square(), s, 0);

    expect(hit.collides).toBe(true);
    expect(hit.actual).toBe(0);
    expect(hit.location).toEqual({ x: 50, y: 50 });
  });

  it('...specifically A, not whichever end is inside', () => {
    // The same segment with its endpoints exchanged: now `A` is outside, the
    // containment shortcut does not fire, and the answer is a point where the
    // segment crosses the outline instead.
    const hit = collideShapes(square(), stadium(500, 50, 50, 50), 0);

    expect(hit.collides).toBe(true);
    expect(hit.location).toEqual({ x: 100, y: 50 });
  });

  it('always puts the chain first, so this pair is symmetric', () => {
    const s = stadium(50, 50, 500, 50);

    expect(collideShapes(s, square(), 0)).toEqual(collideShapes(square(), s, 0));
  });
});

// ----- chain against chain -----------------------------------------------------

describe('poly against poly', () => {
  const inner = (start: number): Shape => {
    const corners: [number, number][] = [
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 20],
    ];
    return poly([...corners.slice(start), ...corners.slice(0, start)]);
  };

  it("reports the enclosed chain's point 0, not its centre or nearest corner", () => {
    expect(collideShapes(inner(0), square(), 0).location).toEqual({ x: 10, y: 10 });

    // Same polygon, same containment, different starting vertex — and the
    // answer follows the vertex list.
    expect(collideShapes(inner(2), square(), 0).location).toEqual({ x: 20, y: 20 });
  });

  it('lets the segment sort decide which of two crossings is reported', () => {
    // A bar crossing the square's left and right edges: both crossings are an
    // exact touch, and a strict `<` keeps whichever pair the double loop reaches
    // first. Upstream sorts both segment lists by `( A.x, A.y )` before looping,
    // which puts the left edge — `( 0, 100 ) -> ( 0, 0 )`, sorting on its `A` —
    // ahead of the right edge. In the square's own winding order the right edge
    // comes first instead, and the answer would be ( 100, 40 ).
    const bar = poly([
      [-200, 40],
      [300, 40],
      [300, 60],
      [-200, 60],
    ]);

    const hit = collideShapes(square(), bar, 30);

    expect(hit.collides).toBe(true);
    expect(hit.actual).toBe(0);
    expect(hit.location).toEqual({ x: 0, y: 40 });
  });

  it('reports a point on the first argument when neither encloses the other', () => {
    const left = poly([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
    const right = poly([
      [130, 0],
      [230, 0],
      [230, 100],
      [130, 100],
    ]);

    const hit = collideShapes(left, right, 40);

    expect(hit.collides).toBe(true);
    expect(hit.actual).toBe(30);
    expect(hit.location?.x).toBe(100);
  });
});

// ----- circle against chain ----------------------------------------------------

describe('circle against poly', () => {
  it("reports the circle's own centre when the polygon encloses it", () => {
    const hit = collideShapes(circle(50, 50, 10), square(), 0);

    expect(hit.collides).toBe(true);
    expect(hit.actual).toBe(0);
    expect(hit.location).toEqual({ x: 50, y: 50 });
  });

  it('always puts the circle first, so this pair is symmetric', () => {
    const c = circle(160, 50, 10);

    expect(collideShapes(square(), c, 70)).toEqual(collideShapes(c, square(), 70));
  });
});

// ----- the poly inflation bridge -----------------------------------------------

describe("a poly's inflation", () => {
  it('is folded into the clearance and taken back off the gap', () => {
    const pad = square(20); // a 100x100 outline inflated by 20 on every side
    const c = circle(160, 50, 10);

    // Copper gap: 60 from the centre to the x = 100 edge, less 10 of circle and
    // 20 of inflation, is 30.
    expect(collideShapes(c, pad, 40).actual).toBe(30);
    expect(collideShapes(c, pad, 30).collides).toBe(false);
    expect(collideShapes(c, pad, 31).collides).toBe(true);
  });

  it('reports a location on the IU grid, because `aLocation` is a VECTOR2I*', () => {
    // `SHAPE_SEGMENT::Collide( const SEG& )` writes `m_seg.NearestPoint( aSeg )`
    // into a `VECTOR2I*` (shape_segment.h:94), and `SEG::NearestPoint`'s interior
    // answer is `A + rescale( t, d, l_squared )` — an integer, rounded half away
    // from zero, never the exact foot of the perpendicular.
    //
    // Worked out by hand: A = (0,0)-(30,70), B = (10,20)-(10,-500). They do not
    // cross (A is at y = 23.3 where x = 10, B tops out at y = 20), so the answer
    // is the best of the four candidates. Candidate 3 — B's own A projected onto
    // A — wins at squared distance 2, against 100^2, 2900 and 250100. That
    // projection is t = 30*10 + 70*20 = 1700 over l^2 = 30^2 + 70^2 = 5800, so
    //   x = rescale( 1700, 30, 5800 ) = round( 8.7931 ) = 9
    //   y = rescale( 1700, 70, 5800 ) = round( 20.5172 ) = 21
    // The doubles this file used to carry answered (8.7931…, 20.5172…), which is
    // not a point any board item can sit on.
    const a: Shape = { kind: 'stadium', a: { x: 0, y: 0 }, b: { x: 30, y: 70 }, r: 0 };
    const b: Shape = { kind: 'stadium', a: { x: 10, y: 20 }, b: { x: 10, y: -500 }, r: 0 };

    expect(collideShapes(a, b, 2).location).toEqual({ x: 9, y: 21 });
  });

  it('leaves the location on the un-inflated outline', () => {
    // The copper boundary is at x = 120; the reported point is on the polygon
    // the inflation was applied to, at x = 100. That is upstream's behaviour for
    // any shape whose half-width is carried in the clearance, and it is why this
    // is a documented bridge rather than a new shape class.
    expect(collideShapes(circle(160, 50, 10), square(20), 40).location).toEqual({ x: 100, y: 50 });
  });
});

describe('SHAPE_LINE_CHAIN_BASE::PointInside', () => {
  it('needs three points, so a degenerate chain contains nothing', () => {
    expect(
      chainPointInside(
        {
          pts: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
        },
        { x: 5, y: 0 },
      ),
    ).toBe(false);
  });

  it('casts its ray in the positive x direction', () => {
    const sq = {
      pts: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    };

    expect(chainPointInside(sq, { x: 50, y: 50 })).toBe(true);
    expect(chainPointInside(sq, { x: 150, y: 50 })).toBe(false);
    expect(chainPointInside(sq, { x: -50, y: 50 })).toBe(false);
  });
});

describe('CIRCLE::Intersect( const CIRCLE& )', () => {
  it('returns nothing for co-centred circles, even when the radii match', () => {
    expect(
      circleIntersectCircle({ c: { x: 0, y: 0 }, r: 10 }, { c: { x: 0, y: 0 }, r: 10 }),
    ).toEqual([]);
  });

  it('returns one point for a tangency and two for a proper crossing', () => {
    expect(
      circleIntersectCircle({ c: { x: 0, y: 0 }, r: 10 }, { c: { x: 20, y: 0 }, r: 10 }),
    ).toEqual([{ x: 10, y: 0 }]);

    const two = circleIntersectCircle({ c: { x: 0, y: 0 }, r: 10 }, { c: { x: 10, y: 0 }, r: 10 });

    expect(two).toHaveLength(2);
    expect(two[0]?.x).toBeCloseTo(5, 9);
    expect(two[1]?.x).toBeCloseTo(5, 9);
    expect((two[0]?.y ?? 0) + (two[1]?.y ?? 0)).toBeCloseTo(0, 9);
  });
});

// ----- the arc pairs -----------------------------------------------------------

const arc = (cx: number, cy: number, rad: number, a0: number, sweep: number, r = 0): Shape => ({
  kind: 'arc',
  c: { x: cx, y: cy },
  rad,
  a0,
  sweep,
  r,
});

/** A quarter arc of radius 100 about the origin, from (100, 0) to (0, 100). */
const quarter = (r = 0): Shape => arc(0, 0, 100, 0, Math.PI / 2, r);

/** The same circle, closed — what `arcShape` builds when start and end coincide. */
const fullCircle = (r = 0): Shape => arc(0, 0, 100, 0, -2 * Math.PI, r);

describe('arc against circle', () => {
  it('reports the midpoint of the two nearest points, which is on neither shape', () => {
    // Nearest points: (100, 0) on the arc, (190, 0) on the circle. The midpoint
    // is 45 from each, in the empty space between them.
    const hit = collideShapes(quarter(), circle(200, 0, 10), 100);

    expect(hit.collides).toBe(true);
    expect(hit.actual).toBe(90);
    expect(hit.location).toEqual({ x: 145, y: 0 });
  });

  it('compares against the clearance alone, with no room for the circle radius', () => {
    // 8100 is the squared distance; the test is `dist_sq < aClearance²`.
    expect(collideShapes(quarter(), circle(200, 0, 10), 90).collides).toBe(false);
    expect(collideShapes(quarter(), circle(200, 0, 10), 91).collides).toBe(true);
  });

  it('puts the arc first whichever order it was asked in', () => {
    expect(collideShapes(circle(200, 0, 10), quarter(), 100)).toEqual(
      collideShapes(quarter(), circle(200, 0, 10), 100),
    );
  });
});

describe('arc against stadium', () => {
  it('reports the LAST colliding candidate, not the nearest one', () => {
    // The candidate list is: circle/segment intersections, then the segment's
    // nearest points to the centre and to each arc end, then the segment's own
    // two ends. Each colliding candidate overwrites the answer, so the segment's
    // `B` end wins even though it is the furthest of the five.
    //
    // Worked out: the candidates are (80,80) at 13, (130,30) at 33, (30,130) at
    // 33, (150,10) at 50 and (10,150) at 50 — all five collide at a clearance of
    // 55, and the reported gap is the last one's 50, not the nearest one's 13.
    const hit = collideShapes(quarter(), stadium(150, 10, 10, 150), 55);

    expect(hit.collides).toBe(true);
    expect(hit.actual).toBe(50);

    // ...and the location is the arc point under (10, 150), not the one under
    // (80, 80), which would be (70.71, 70.71).
    expect(hit.location?.x).toBeCloseTo(6.6519, 3);
    expect(hit.location?.y).toBeCloseTo(99.7787, 3);
  });

  it('measures in whole units, because the point routine rounds its distance', () => {
    // `KiROUND( dist )` is kept because it decides the `if( !dist )` branch, and
    // it makes every actual off this path an integer.
    const hit = collideShapes(quarter(), stadium(150, 10, 10, 150), 55);

    expect(Number.isInteger(hit.actual)).toBe(true);
  });
});

describe('a nearly-closed arc', () => {
  // A full circle: more than half a turn, with its two ends in the same place,
  // so `SHAPE_ARC::Collide( SEG )` treats it as a *disc* rather than a curve.
  it('is collided as a disc, so the location lands on the segment', () => {
    const hit = collideShapes(fullCircle(), stadium(-200, -105, 200, -105), 10);

    expect(hit.collides).toBe(true);
    expect(hit.actual).toBe(5);
    // On the segment — `SHAPE_CIRCLE::Collide( SEG )`'s nearest point — and not
    // the (0, -100) that lies on the arc itself.
    expect(hit.location).toEqual({ x: 0, y: -105 });
  });

  it('does not collide with a segment buried entirely inside its hole', () => {
    // Both segment ends are within `radius - clearance` of the centre, and
    // upstream returns false outright: a segment in the middle of a ring is not
    // touching the ring. There is no corresponding case for a curve.
    expect(collideShapes(fullCircle(), stadium(-50, 0, 50, 0), 10).collides).toBe(false);
  });

  it('is recognised as closed from its sweep, not from its recomputed ends', () => {
    // A *positive* full turn. `m_start != m_end` asked of the two recomputed
    // endpoints answers "not a full circle" here — `sin( 2pi )` is -2.4e-16, not
    // zero — and the angular test then runs with `rotatedEndAngle` at 0 and
    // `ccw` false, so every point but the start snaps to an endpoint 215 away
    // and nothing collides at all. Asked of the sweep, it answers correctly and
    // the far side of the circle is 15 from the segment, inside the 20 of width.
    const closed = arc(0, 0, 100, 0, 2 * Math.PI, 20);
    const hit = collideShapes(closed, stadium(-115, -200, -115, 200), 0);

    expect(hit.collides).toBe(true);
    expect(hit.actual).toBe(0);
    expect(hit.location).toEqual({ x: -100, y: 0 });
  });

  it('still knows it is closed, so its far side is inside the sweep', () => {
    // `m_start != m_end` cannot be asked of recomputed endpoints, so the port
    // asks it of the sweep. Get that wrong and the point at angle pi falls
    // outside the slice and snaps to an endpoint 200 away.
    const hit = collideShapes(fullCircle(), circle(-105, 0, 1), 10);

    expect(hit.collides).toBe(true);
    expect(hit.actual).toBe(4);
    expect(hit.location?.x).toBeCloseTo(-102, 9);
    expect(hit.location?.y).toBeCloseTo(0, 9);
  });
});

describe('arc against poly', () => {
  it("reports the arc's P0 when the polygon encloses it", () => {
    // Its *start* point — not the deepest point, not the nearest.
    const hit = collideShapes(arc(50, 50, 10, 0, Math.PI / 2), square(), 0);

    expect(hit.collides).toBe(true);
    expect(hit.actual).toBe(0);
    expect(hit.location).toEqual({ x: 60, y: 50 });
  });

  it('puts the arc first whichever order it was asked in', () => {
    const a = arc(50, 50, 10, 0, Math.PI / 2);

    expect(collideShapes(square(), a, 0)).toEqual(collideShapes(a, square(), 0));
  });
});

describe('arc against arc', () => {
  it('reports a shared endpoint exactly, with no width adjustment applied', () => {
    // Both arcs are 40 wide. The endpoint-against-circle pass finds an exact
    // zero and returns before `adjustForArcWidths` can push the points apart.
    const a = arc(0, 0, 100, 0, Math.PI / 2, 20);
    const b = arc(200, 0, 100, Math.PI, -Math.PI / 2, 20);

    const hit = collideShapes(a, b, 1);

    expect(hit.collides).toBe(true);
    expect(hit.actual).toBe(0);
    expect(hit.location).toEqual({ x: 100, y: 0 });
  });
});

describe('SHAPE_ARC::sliceContainsPoint', () => {
  it('includes both ends of the sweep', () => {
    const g = { c: { x: 0, y: 0 }, rad: 100, a0: 0, sweep: Math.PI / 2, halfWidth: 0 };

    expect(arcSliceContainsPoint(g, { x: 100, y: 0 })).toBe(true);
    expect(arcSliceContainsPoint(g, { x: 0, y: 100 })).toBe(true);
    expect(arcSliceContainsPoint(g, { x: 70, y: 70 })).toBe(true);
    expect(arcSliceContainsPoint(g, { x: -100, y: 0 })).toBe(false);
    expect(arcSliceContainsPoint(g, { x: 0, y: -100 })).toBe(false);
  });

  it('follows the sweep backwards when it is negative', () => {
    const g = { c: { x: 0, y: 0 }, rad: 100, a0: 0, sweep: -Math.PI / 2, halfWidth: 0 };

    expect(arcSliceContainsPoint(g, { x: 0, y: -100 })).toBe(true);
    expect(arcSliceContainsPoint(g, { x: 0, y: 100 })).toBe(false);
  });
});

describe('SHAPE_ARC::IsEffectiveLine', () => {
  const flat = {
    c: { x: 0, y: -1e7 },
    rad: 1e7,
    a0: Math.PI / 2,
    sweep: 1e-4,
    halfWidth: 0,
  };

  it('is true for an arc whose three points are collinear within a unit', () => {
    expect(arcIsEffectiveLine(flat)).toBe(true);
    expect(
      arcIsEffectiveLine({ c: { x: 0, y: 0 }, rad: 100, a0: 0, sweep: Math.PI / 2, halfWidth: 0 }),
    ).toBe(false);
  });

  it('is false for a closed arc, which doubles back rather than running straight', () => {
    // `ApproxCollinear` alone says yes — the chord is a diameter both ways — and
    // the dot product is what rejects it.
    expect(
      arcIsEffectiveLine({ c: { x: 0, y: 0 }, rad: 100, a0: 0, sweep: -2 * Math.PI, halfWidth: 0 }),
    ).toBe(false);
  });

  it('diverts a flat arc down the segment path, on the IU grid `SEG` works on', () => {
    // `SHAPE_ARC::IsEffectiveLine` sends this arc to `Collide( SEG, ... )`, and
    // `SEG` is a pair of `VECTOR2I`s — it cannot hold the `40.5` below. Upstream
    // never has to: a `SHAPE_SEGMENT` is built from integer board coordinates in
    // the first place. `SEG` therefore rounds it, half away from zero, to 41.
    //
    // The arc is centred at (0,-1e7) with radius 1e7 over 1e-4 rad, i.e. the
    // segment (0,0)-(-1000,0) once its own endpoints are rounded: its far end is
    // (-999.99999, -0.05). The other segment stands vertically at x = -500,
    // inside that span, so the gap is the pure vertical distance from y = 41 to
    // the rounded arc-chord at y = 0 — exactly 41.
    //
    // Before this file used kimath's `SEG` it kept every one of those fractions
    // and answered 40.525, which is not a number upstream's `int* aActual` can
    // hold.
    const s: Shape = { kind: 'stadium', a: { x: -500, y: 40.5 }, b: { x: -500, y: 200 }, r: 0 };
    const flatShape: Shape = {
      kind: 'arc',
      c: { x: 0, y: -1e7 },
      rad: 1e7,
      a0: Math.PI / 2,
      sweep: 1e-4,
      r: 0,
    };

    const hit = collideShapes(flatShape, s, 100);

    expect(hit.collides).toBe(true);
    expect(hit.actual).toBe(41);
  });
});

describe('SHAPE_ARC::NearestPoints( SHAPE_ARC ): the circle-pair selection', () => {
  const arc = (cx: number, cy: number, rad: number, a0: number, sweep: number, halfWidth = 0) => ({
    c: { x: cx, y: cy },
    rad,
    a0,
    sweep,
    halfWidth,
  });

  it('takes the furthest point on the inner circle when one arc contains the other', () => {
    // Arc B's circle sits strictly inside arc A's. Upstream splits on exactly
    // that: for the contained case the closest pair lies on the *same* side of
    // both centres, so the outer circle contributes its nearest point to the
    // inner centre and the inner circle its *furthest* from the outer centre.
    // Using nearest on both — the tidy, symmetric-looking version — puts B's
    // point at (-10, 0), which its slice does not contain, and the whole
    // circle-pair result is discarded.
    const a = arc(0, 0, 100, -Math.PI / 4, Math.PI / 2);
    const b = arc(10, 0, 20, -Math.PI / 4, Math.PI / 2);

    const { ptA, ptB } = arcNearestPointsArc(a, b);

    expect(ptA).toEqual({ x: 100, y: 0 });
    expect(ptB).toEqual({ x: 30, y: 0 });
  });

  it('scales the concentric epsilon by a thousandth, not a hundredth', () => {
    // `colocated` short-circuits before the circle-pair work *and before the
    // arc-width adjustment*, so widening the epsilon returns un-narrowed
    // points. Centres 10 apart on radius-2000 arcs: 10 clears an epsilon of
    // 2 and does not clear one of 20.
    const a = arc(0, 0, 2000, -Math.PI / 4, Math.PI / 2, 100);
    const b = arc(10, 0, 2000, (3 * Math.PI) / 4, Math.PI / 2, 100);

    const { distSq } = arcNearestPointsArc(a, b);
    const unadjusted = arcNearestPointsArc(
      arc(0, 0, 2000, -Math.PI / 4, Math.PI / 2),
      arc(10, 0, 2000, (3 * Math.PI) / 4, Math.PI / 2),
    ).distSq;

    // Both arcs are 100 wide, so the adjusted gap is 200 shorter than the
    // skeleton gap. A hundredth-scale epsilon would call these concentric and
    // return the skeleton distance untouched.
    expect(Math.sqrt(distSq)).toBeCloseTo(Math.sqrt(unadjusted) - 200, 6);
  });
});
