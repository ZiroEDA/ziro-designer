// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `CIRCLE::IntersectLine` and `CIRCLE::ConstructFromTanTanPt`, plus the `SEG`
 * members and `CalcArcMid` they are built on.
 *
 * The `IntersectLine` and `ConstructFromTanTanPt` cases are transcribed from
 * KiCad's own `qa/tests/libs/kimath/geometry/test_circle.cpp`, including its
 * comments about which values came from LibreCAD and which upstream had to
 * amend to match its own integer arithmetic. Those amended values are the
 * interesting ones: they are what upstream *actually computes*, so agreeing
 * with them is evidence the rounding chain matches rather than merely that the
 * geometry is roughly right.
 */
import { describe, expect, it } from 'vitest';
import {
  type Circle,
  circleIntersectLine,
  constructFromTanTanPt,
} from '@ziroeda/kimath/src/geometry/circle.js';
import type { Seg } from '@ziroeda/kimath/src/geometry/corner_operations.js';
import {
  segApproxParallel,
  segCenter,
  segLineDistance,
  segLineProject,
  segParallelSeg,
  segPerpendicularSeg,
} from '@ziroeda/kimath/src/geometry/seg.js';
import { CalcArcMid } from '@ziroeda/kimath/src/trigo.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });
const S = (ax: number, ay: number, bx: number, by: number): Seg => ({ a: V(ax, ay), b: V(bx, by) });

/** `SHAPE::MIN_PRECISION_IU`, the tolerance upstream's own test uses. */
const MIN_PRECISION_IU = 4;

/** `CompareLength` from upstream's test file. */
const expectLength = (got: number, want: number): void => {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(MIN_PRECISION_IU);
};

/** `CompareVector2I` from upstream's test file. */
const expectPoint = (got: Vec2, want: Vec2): void => {
  expectLength(got.x, want.x);
  expectLength(got.y, want.y);
};

// ---------------------------------------------------------------------------

describe('SEG members ConstructFromTanTanPt needs', () => {
  it('segCenter rounds the midpoint half away from zero, it does not truncate', () => {
    // `A + ( B - A ) / 2`, and VECTOR2I's only divide is `operator/( double )`,
    // whose integral body is `KiROUND( x / aFactor )` (`vector2d.h:536`).
    // B - A = (3, 3), halved is (2, 2), so the centre lands one unit *past*
    // true centre — and one unit before it when the segment runs backwards,
    // because KiROUND takes a negative half away from zero.
    expect(segCenter(S(0, 0, 3, 3))).toEqual(V(2, 2));
    expect(segCenter(S(3, 3, 0, 0))).toEqual(V(1, 1));
    expect(segCenter(S(0, 0, 4, 4))).toEqual(V(2, 2));
  });

  it('segParallelSeg carries the whole slope vector, not a unit direction', () => {
    // Upstream adds `B - A`, so the new segment has the same length as well as
    // the same direction. Anything that measured the result's length would see
    // the difference.
    expect(segParallelSeg(S(0, 0, 10, 4), V(100, 100))).toEqual({
      a: V(100, 100),
      b: V(110, 104),
    });
  });

  it('segPerpendicularSeg turns the slope by (-y, x), not (y, -x)', () => {
    // The two differ by a half turn, which flips the sign of `Side` and of the
    // signed `LineDistance` about the result.
    expect(segPerpendicularSeg(S(0, 0, 10, 4), V(100, 100))).toEqual({
      a: V(100, 100),
      b: V(96, 110),
    });
  });

  it('segLineProject treats the segment as an infinite line', () => {
    // The foot is well past B, which `NearestPoint` would have clamped.
    expect(segLineProject(S(0, 0, 10, 0), V(500, 37))).toEqual(V(500, 0));
    // A zero-length segment defines no line; upstream answers A.
    expect(segLineProject(S(7, 9, 7, 9), V(500, 37))).toEqual(V(7, 9));
  });

  it('segLineDistance signs the distance by side only when asked', () => {
    expect(segLineDistance(S(0, 0, 1000, 0), V(500, 300))).toBe(300);
    // `Side` is positive for a point below a left-to-right segment in screen
    // coordinates, so the signed answer is +300 there and -300 above.
    expect(segLineDistance(S(0, 0, 1000, 0), V(500, 300), true)).toBe(300);
    expect(segLineDistance(S(0, 0, 1000, 0), V(500, -300), true)).toBe(-300);
    // Unsigned is the absolute value, not the signed one.
    expect(segLineDistance(S(0, 0, 1000, 0), V(500, -300))).toBe(300);
  });

  it('segLineDistance truncates like isqrt, exactly, past 2^53', () => {
    // A 3-4-5 triangle scaled to 1e8: `det * det` is order 1e34, so a double
    // implementation has nothing left to truncate correctly with.
    expect(segLineDistance(S(0, 0, 400000000, 300000000), V(0, 500000000))).toBe(400000000);
    // The floor is taken of `rescale( det, det, l )`, not of the true
    // quotient — and `rescale` has already rounded half away from zero. So the
    // true distance 1/sqrt(2) = 0.707 becomes isqrt( (1 + 1) / 2 ) = 1, where a
    // plain `trunc( sqrt( det*det / l ) )` would answer 0. That one-unit
    // difference is the whole reason this is not the `pns_multi_dragger.ts`
    // implementation.
    expect(segLineDistance(S(0, 0, 1, 1), V(1, 0))).toBe(1);
    // 3/sqrt(2) = 2.12: isqrt( (9 + 1) / 2 ) = isqrt( 5 ) = 2.
    expect(segLineDistance(S(0, 0, 1, 1), V(3, 0))).toBe(2);
  });

  it('segLineDistance answers 0 for a degenerate segment', () => {
    expect(segLineDistance(S(5, 5, 5, 5), V(1000, 1000))).toBe(0);
  });

  it('segApproxParallel is signed, so a crossing segment is not parallel', () => {
    expect(segApproxParallel(S(0, 0, 1000, 0), S(0, 50, 1000, 50))).toBe(true);
    // Equal magnitudes, opposite signs — collinear-style tests would pass this.
    expect(segApproxParallel(S(0, 0, 1000, 0), S(400, -50, 600, 50))).toBe(false);
  });
});

describe('CalcArcMid', () => {
  it('bisects the minor arc by default and the major arc when asked', () => {
    // Quarter circle of radius 1000 about the origin, from (1000,0) to
    // (0,1000). The minor mid sits between them; the major mid is
    // diametrically opposite it, which is what `aMinArcAngle = false` adds a
    // half turn to reach.
    expectPoint(CalcArcMid(V(1000, 0), V(0, 1000), V(0, 0)), V(707, 707));
    expectPoint(CalcArcMid(V(1000, 0), V(0, 1000), V(0, 0), false), V(-707, -707));
  });

  it('takes its radius from aStart, not from aEnd', () => {
    // aEnd is at radius 2000 but the answer sits at aStart's radius of 1000 —
    // the result is aStart *rotated*, nothing more.
    const mid = CalcArcMid(V(1000, 0), V(0, 2000), V(0, 0));
    expectLength(Math.round(Math.hypot(mid.x, mid.y)), 1000);
  });
});

// ---------------------------------------------------------------------------
// `CIRCLE::IntersectLine` — upstream's `intersect_line_cases`.

describe('circleIntersectLine', () => {
  const C = (cx: number, cy: number, r: number): Circle => ({ c: V(cx, cy), r });

  const cases: Array<{ name: string; circle: Circle; seg: Seg; expected: Vec2[] }> = [
    {
      name: 'two point aligned',
      circle: C(0, 0, 20),
      seg: S(10, 45, 10, 40),
      expected: [V(10, -17), V(10, 17)],
    },
    {
      name: 'two point angled',
      circle: C(0, 0, 20),
      seg: S(-20, -40, 20, 40),
      expected: [V(8, 17), V(-8, -17)],
    },
    { name: 'tangent', circle: C(0, 0, 20), seg: S(20, 0, 20, 40), expected: [V(20, 0)] },
    { name: 'no intersection', circle: C(0, 0, 20), seg: S(25, 0, 25, 40), expected: [] },
    {
      name: 'intersection, seg end points inside circle',
      circle: C(0, 0, 20),
      seg: S(0, 10, 0, -10),
      expected: [V(0, 20), V(0, -20)],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const got = circleIntersectLine(c.circle, c.seg);

      expect(got).toHaveLength(c.expected.length);

      // Upstream's `CheckUnorderedMatches`: order is not part of the contract.
      for (const want of c.expected) {
        expect(got.some((p) => Math.abs(p.x - want.x) <= 4 && Math.abs(p.y - want.y) <= 4)).toBe(
          true,
        );
      }
    });
  }

  it('reports one point, not two, inside the MIN_PRECISION_IU band', () => {
    // The line is 18 IU from a centre with radius 20 — geometrically a chord,
    // but only 2 IU inside the 4 IU tangency band, so upstream answers the
    // projected midpoint alone. This is the branch a strict equality test for
    // tangency would get wrong.
    expect(circleIntersectLine(C(0, 0, 20), S(18, -100, 18, 100))).toEqual([V(18, 0)]);
    // 4 IU beyond the radius is still "tangent"; 5 IU is a miss.
    expect(circleIntersectLine(C(0, 0, 20), S(24, -100, 24, 100))).toEqual([V(24, 0)]);
    expect(circleIntersectLine(C(0, 0, 20), S(25, -100, 25, 100))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// `CIRCLE::ConstructFromTanTanPt` — upstream's `construct_tan_tan_pt_cases`.

describe('constructFromTanTanPt', () => {
  const cases: Array<{
    name: string;
    segA: Seg;
    segB: Seg;
    pt: Vec2;
    center: Vec2;
    radius: number;
  }> = [
    {
      // Result from simple geometric inference.
      name: '90 degree segs, point on seg',
      segA: S(0, 0, 0, 1000),
      segB: S(0, 0, 1000, 0),
      pt: V(0, 400),
      center: V(400, 400),
      radius: 400,
    },
    {
      // Result from LibreCAD 2.2.0-rc2.
      name: '90 degree segs, point floating',
      segA: S(0, 0, 0, 1000),
      segB: S(0, 0, 1000, 0),
      pt: V(200, 100),
      center: V(500, 500),
      radius: 500,
    },
    {
      // Result from LibreCAD 2.2.0-rc2.
      name: '45 degree segs, point on seg',
      segA: S(0, 0, 1000, 0),
      segB: S(0, 0, 1000, 1000),
      pt: V(400, 0),
      center: V(400, 166),
      radius: 166,
    },
    {
      // Result from LibreCAD 2.2.0-rc2.
      name: '45 degree segs, point floating',
      segA: S(0, 0, 1000000, 0),
      segB: S(0, 0, 1000000, 1000000),
      pt: V(200000, 100000),
      center: V(332439, 137701),
      radius: 137701,
    },
    {
      // Upstream amended this from LibreCAD's { 400000, 965686 }, 965686 "to
      // get the test to pass" — so it is KiCad's own integer answer, and
      // matching it to 4 IU is the strongest single check here.
      name: '135 degree segs, point on seg',
      segA: S(0, 0, 1000000, 0),
      segB: S(0, 0, -1000000, 1000000),
      pt: V(400000, 0),
      center: V(400009, 965709),
      radius: 965709,
    },
    {
      // Likewise amended, from LibreCAD's { 822, 1985 }, 1985.
      name: '135 degree segs, point floating',
      segA: S(0, 0, 1000, 0),
      segB: S(0, 0, -1000, 1000),
      pt: V(200, 100),
      center: V(814, 1964),
      radius: 1964,
    },
    {
      name: 'point on intersection',
      segA: S(10, 0, 1000, 0),
      segB: S(10, 0, -1000, 1000),
      pt: V(10, 0),
      center: V(10, 0),
      radius: 0, // special case: radius = 0
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const got = constructFromTanTanPt(c.segA, c.segB, c.pt);

      expectPoint(got.c, c.center);
      expectLength(got.r, c.radius);
    });
  }

  it('the circle really is tangent to both lines and through the point', () => {
    // An independent check of the contract rather than of a stored number: the
    // distance from the centre to each line is the radius, and the point is on
    // the circumference. Tolerances are upstream's own 4 IU.
    const segA = S(0, 0, 1000000, 0);
    const segB = S(0, 0, 700000, 900000);
    const pt = V(300000, 120000);
    const circle = constructFromTanTanPt(segA, segB, pt);

    expectLength(segLineDistance(segA, circle.c), circle.r);
    expectLength(segLineDistance(segB, circle.c), circle.r);
    expectLength(Math.round(Math.hypot(pt.x - circle.c.x, pt.y - circle.c.y)), circle.r);
  });

  it('parallel lines put the centre on the mid-line, nearest aLineA.A', () => {
    // No vertex exists, so the radius is half the separation and the centre is
    // whichever of the two mid-line crossings is closer to `aLineA.A`. Here the
    // lines are 1000 apart, so r = 500 and the centre is on y = 500 — and of
    // x = 200 ± sqrt(500² - 100²) it is the smaller root, being nearer (0, 0).
    const circle = constructFromTanTanPt(
      S(0, 0, 1000000, 0),
      S(0, 1000, 1000000, 1000),
      V(200, 600),
    );

    expect(circle.r).toBe(500);
    expect(circle.c.y).toBe(500);
    expect(circle.c.x).toBeLessThan(200);
    expectLength(Math.round(Math.hypot(200 - circle.c.x, 600 - circle.c.y)), 500);
  });

  it('a point at the vertex degenerates to a zero-radius circle there', () => {
    const circle = constructFromTanTanPt(S(50, 50, 1000, 50), S(50, 50, 50, 1000), V(50, 50));

    expect(circle).toEqual({ c: V(50, 50), r: 0 });
  });

  it('parallel lines too far from the point have no solution, and say so mid-build', () => {
    // `wxCHECK_MSG( ..., *this, ... )` returns the circle in the state it has
    // reached, which in the parallel branch already has Radius and Center
    // written. So the refusal is not a default-constructed circle: the radius
    // is the half-separation and the centre is the point itself.
    const circle = constructFromTanTanPt(
      S(0, 0, 1000000, 0),
      S(0, 1000, 1000000, 1000),
      V(200, 100000),
    );

    expect(circle).toEqual({ c: V(200, 100000), r: 500 });
  });
});

describe('segLineDistance: the integer square root', () => {
  it('is exact at board scale, where the squared distance passes 2^53', () => {
    // A vertical line through the origin puts the distance equal to |x|, so
    // this asserts the integer root directly with no other arithmetic in the
    // way. At px ~ 1e9 the squared distance is ~1e18, past 2^53, so the value
    // fed to `Math.sqrt(Number(x))` is already imprecise.
    //
    // UNPINNED: this does *not* reach `isqrt64`'s two correction loops.
    // Deleting them still passes, because for these inputs the squared
    // distance is an exact square and the double seed happens to land on it.
    // A search over ~2000 vertical cases found none that separates them. The
    // loops are upstream's and are kept for the inputs that would; what
    // triggers one is not established here.
    const vertical = { a: { x: 0, y: 0 }, b: { x: 0, y: 1000000 } };

    expect(segLineDistance(vertical, { x: 999999999, y: 0 })).toBe(999999999);
    expect(segLineDistance(vertical, { x: 1000000000, y: 0 })).toBe(1000000000);
  });

  it('answers zero for a degenerate segment rather than dividing by zero', () => {
    // `l` is `p^2 + q^2`, which is 0 when the segment is a point. Upstream's
    // `rescale( det, det, l )` would divide by zero there; the guard returns 0.
    //
    // The guard is provably equivalent to dividing by any non-zero denominator:
    // `l == 0` forces `p == q == 0`, hence `r == 0` and `det == 0`, so the
    // quotient is 0 either way. It exists to avoid the division, not to change
    // the answer — which is why mutating the denominator does not fail here.
    const point = { a: { x: 500, y: 500 }, b: { x: 500, y: 500 } };

    expect(segLineDistance(point, { x: 1000, y: 1000 })).toBe(0);
  });
});
