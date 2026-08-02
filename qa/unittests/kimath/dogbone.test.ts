// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Dogbone corners.
 * Counterpart: `ComputeDogbone` in `libs/kimath/src/geometry/corner_operations.cpp`.
 *
 * A dogbone replaces a sharp inside corner with a circular pocket, so a router
 * bit of that radius can cut it and a mating part with a sharp outside corner
 * still fits. The property that decides whether the result is usable is the
 * *mouth*: on an acute corner the pocket's opening ends up narrower than the
 * bit that has to reach into it, which is why the arc sweeping more than half a
 * turn is a distinct, reported outcome rather than just a bigger arc.
 *
 * Fixtures are in millimetres. The pocket centre is rounded to whole IU, so a
 * fixture measured in raw IU makes that rounding dominate everything.
 */
import { describe, expect, it } from 'vitest';
import {
  arcCentralAngle,
  bisectorOfCorner,
  circleSegmentIntersections,
  computeDogbone,
  threePointCentre,
  type Seg,
} from '@ziroeda/kimath/src/geometry/corner_operations.js';

const MM = (n: number): number => Math.round(n * 1e6);
const seg = (ax: number, ay: number, bx: number, by: number): Seg => ({
  a: { x: MM(ax), y: MM(ay) },
  b: { x: MM(bx), y: MM(by) },
});

const dist = (p: { x: number; y: number }, q: { x: number; y: number }): number =>
  Math.hypot(p.x - q.x, p.y - q.y);

/** A right-angled inside corner at the origin, arms along +x and +y. */
const rightAngle = (): [Seg, Seg] => [seg(50, 0, 0, 0), seg(0, 0, 0, 50)];

describe('the corner bisector', () => {
  it('points between the two arms', () => {
    const [a, b] = rightAngle();
    const bis = bisectorOfCorner(a, b, MM(10))!;

    // Arms along +x and +y, so the bisector runs at 45° into the quadrant.
    expect(bis.a).toEqual({ x: 0, y: 0 });
    expect(bis.b.x / bis.b.y).toBeCloseTo(1, 3);
    expect(dist(bis.a, bis.b) / MM(10)).toBeCloseTo(1, 5);
  });

  it('is the given length whatever the arms measure', () => {
    const bis = bisectorOfCorner(seg(5, 0, 0, 0), seg(0, 0, 0, 500), MM(10))!;

    expect(dist(bis.a, bis.b) / MM(10)).toBeCloseTo(1, 5);
  });

  it('does not lean towards the longer arm', () => {
    // The parallelogram only bisects when its sides are equal, so both arms are
    // resized before adding. A hundredfold difference in arm length must not
    // move the bisector at all.
    const even = bisectorOfCorner(seg(50, 0, 0, 0), seg(0, 0, 0, 50), MM(10))!;
    const lopsided = bisectorOfCorner(seg(5, 0, 0, 0), seg(0, 0, 0, 500), MM(10))!;

    expect(lopsided.b.x).toBeCloseTo(even.b.x, -3);
    expect(lopsided.b.y).toBeCloseTo(even.b.y, -3);
  });

  it('finds no direction for arms that double back', () => {
    // Collinear and opposed: the outward vectors cancel.
    expect(bisectorOfCorner(seg(50, 0, 0, 0), seg(0, 0, -50, 0), MM(10))).toBeNull();
  });

  it('needs a shared corner', () => {
    expect(bisectorOfCorner(seg(50, 0, 0, 0), seg(10, 10, 20, 20), MM(10))).toBeNull();
  });
});

describe('circle against segment', () => {
  it('finds both crossings', () => {
    const pts = circleSegmentIntersections({ x: 0, y: 0 }, MM(5), seg(-10, 0, 10, 0));

    expect(pts).toHaveLength(2);
    expect(pts.map((p) => p.x).sort((x, y) => x - y)).toEqual([MM(-5), MM(5)]);
  });

  it('finds only the crossing inside the segment', () => {
    const pts = circleSegmentIntersections({ x: 0, y: 0 }, MM(5), seg(0, 0, 10, 0));

    expect(pts).toHaveLength(1);
    expect(pts[0]!.x).toBe(MM(5));
  });

  it('finds none when the circle misses', () => {
    expect(circleSegmentIntersections({ x: 0, y: 0 }, MM(1), seg(-10, 5, 10, 5))).toEqual([]);
  });
});

describe('arc sweep', () => {
  it('measures a quarter turn', () => {
    // Through (5,0), (3.54,3.54), (0,5) about the origin.
    const a = arcCentralAngle(
      { x: MM(5), y: 0 },
      { x: MM(3.5355), y: MM(3.5355) },
      { x: 0, y: MM(5) },
    );

    expect(Math.abs(a)).toBeCloseTo(90, 1);
  });

  it('measures a three-quarter turn as more than half', () => {
    // The same endpoints, but the midpoint on the far side.
    const a = arcCentralAngle(
      { x: MM(5), y: 0 },
      { x: MM(-3.5355), y: MM(-3.5355) },
      { x: 0, y: MM(5) },
    );

    expect(Math.abs(a)).toBeGreaterThan(180);
  });

  it('is nothing for three points in a line', () => {
    expect(threePointCentre({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 })).toBeNull();
  });
});

describe('a dogbone on a right angle', () => {
  it('puts a pocket of the asked-for radius at the corner', () => {
    const [a, b] = rightAngle();
    const r = computeDogbone(a, b, MM(5))!;
    const centre = threePointCentre(r.arc.start, r.arc.mid, r.arc.end)!;

    expect(dist(centre, r.arc.start) / MM(5)).toBeCloseTo(1, 3);
    expect(dist(centre, r.arc.end) / MM(5)).toBeCloseTo(1, 3);
  });

  it('passes through the original corner', () => {
    // The deepest point of the pocket is the corner itself: that is what makes
    // a mating sharp corner still seat.
    const [a, b] = rightAngle();

    expect(computeDogbone(a, b, MM(5))!.arc.mid).toEqual({ x: 0, y: 0 });
  });

  it('pulls both arms back to where the pocket meets them', () => {
    const [a, b] = rightAngle();
    const r = computeDogbone(a, b, MM(5))!;

    expect(r.updatedA!.a).toEqual({ x: MM(50), y: 0 });
    expect(r.updatedB!.a).toEqual({ x: 0, y: MM(50) });
    // Each now stops short of the corner.
    expect(r.updatedA!.b.x).toBeGreaterThan(0);
    expect(r.updatedB!.b.y).toBeGreaterThan(0);
  });

  it('reports a mouth wide enough to cut', () => {
    const [a, b] = rightAngle();

    expect(computeDogbone(a, b, MM(5))!.smallArcMouth).toBe(false);
  });

  it('refuses a radius too big to reach the arms', () => {
    const [a, b] = rightAngle();

    expect(computeDogbone(a, b, MM(500))).toBeNull();
  });

  it('refuses arms that do not meet', () => {
    expect(computeDogbone(seg(50, 0, 0, 0), seg(10, 10, 20, 20), MM(5))).toBeNull();
  });
});

describe('a dogbone on an acute corner', () => {
  // A 30° wedge: arms along +x and up-and-right at 30°.
  const wedge = (): [Seg, Seg] => [
    seg(50, 0, 0, 0),
    {
      a: { x: 0, y: 0 },
      b: { x: MM(50 * Math.cos(Math.PI / 6)), y: MM(50 * Math.sin(Math.PI / 6)) },
    },
  ];

  it('reports the mouth as too narrow', () => {
    // The pocket's opening is narrower than its own diameter, so no bit of that
    // radius can get in — the whole reason the slot variant exists.
    const [a, b] = wedge();

    expect(computeDogbone(a, b, MM(2))!.smallArcMouth).toBe(true);
  });

  it('still returns the plain pocket when slots are not asked for', () => {
    const [a, b] = wedge();
    const r = computeDogbone(a, b, MM(2), false)!;

    expect(r.arc.mid).toEqual({ x: 0, y: 0 });
  });

  it('pulls the arc back to a half turn when slots are asked for', () => {
    // A half turn exactly: the mouth is then as wide as the pocket, which is
    // the narrowest opening a bit of that radius can pass.
    const [a, b] = wedge();
    const r = computeDogbone(a, b, MM(2), true)!;
    const sweep = Math.abs(arcCentralAngle(r.arc.start, r.arc.mid, r.arc.end));

    expect(sweep).toBeCloseTo(180, 0);
  });

  it('opens the slot wider than the plain pocket would be', () => {
    const [a, b] = wedge();
    const plain = computeDogbone(a, b, MM(2), false)!;
    const slotted = computeDogbone(a, b, MM(2), true)!;

    expect(dist(slotted.arc.start, slotted.arc.end)).toBeGreaterThan(
      dist(plain.arc.start, plain.arc.end),
    );
  });

  it('runs the slot walls back to the original arms', () => {
    const [a, b] = wedge();
    const r = computeDogbone(a, b, MM(2), true)!;

    // Both arms still start from their far ends and now stop on the slot.
    expect(r.updatedA!.a).toEqual({ x: MM(50), y: 0 });
    expect(r.updatedA!.b.y).toBeCloseTo(0, -3);
  });

  it('keeps the slot the same size as the pocket', () => {
    // Pulling the arc back must not resize it: a slot cut with a 2 mm bit is
    // still 2 mm across.
    const [a, b] = wedge();
    const r = computeDogbone(a, b, MM(2), true)!;
    const centre = threePointCentre(r.arc.start, r.arc.mid, r.arc.end)!;

    expect(dist(centre, r.arc.start) / MM(2)).toBeCloseTo(1, 2);
  });
});
