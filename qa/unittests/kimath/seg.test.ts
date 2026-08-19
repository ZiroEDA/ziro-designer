// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SEG`, the single implementation.
 * Counterpart: `libs/kimath/src/geometry/seg.cpp`, and the cases below are
 * mostly upstream's own, transcribed from
 * `qa/tests/libs/kimath/geometry/test_segment.cpp` — its edge cases are worth
 * more than invented ones because they are the ones that have actually bitten.
 *
 * The router used to carry its own `Intersect`, `IntersectLines`, `LineProject`,
 * `LineDistance` and `Distance`, in doubles. Every assertion here that names a
 * rounding direction or an overflow is one those copies got wrong.
 */
import { describe, expect, it } from 'vitest';
import type { Seg } from '@ziroeda/kimath/src/geometry/corner_operations.js';
import {
  segCollinear,
  segContains,
  segDistance,
  segDistanceToPoint,
  segIntersect,
  segIntersectLines,
  segLineDistance,
  segLineProject,
  segNearestPoint,
  segSquaredDistanceToPoint,
} from '@ziroeda/kimath/src/geometry/seg.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const S = (ax: number, ay: number, bx: number, by: number): Seg => ({
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
});
const V = (x: number, y: number): Vec2 => ({ x, y });

// ---------------------------------------------------------------------------
// SEG::Intersect — upstream's `seg_intersect_cases` table, verbatim.
//
// Each row is checked in BOTH directions, as upstream's `SegIntersectCorrect`
// predicate does: `a.Intersect( b )` and `b.Intersect( a )` must agree on
// whether there is an intersection at all.

interface IntersectCase {
  name: string;
  a: Seg;
  b: Seg;
  ignoreEndpoints: boolean;
  lines: boolean;
  expect: Vec2 | null;
}

const NORMAL = { ignoreEndpoints: false, lines: false };
const LINES = { ignoreEndpoints: false, lines: true };

const intersectCases: IntersectCase[] = [
  // Basic crossing cases
  {
    name: 'Crossing at origin',
    a: S(-10, 0, 10, 0),
    b: S(0, -10, 0, 10),
    ...NORMAL,
    expect: V(0, 0),
  },
  { name: 'Crossing at (5,5)', a: S(0, 5, 10, 5), b: S(5, 0, 5, 10), ...NORMAL, expect: V(5, 5) },
  {
    name: 'T-junction intersection',
    a: S(0, 0, 10, 0),
    b: S(5, -5, 5, 0),
    ...NORMAL,
    expect: V(5, 0),
  },

  // Non-intersecting cases
  { name: 'Parallel segments', a: S(0, 0, 10, 0), b: S(0, 5, 10, 5), ...NORMAL, expect: null },
  { name: 'Separated segments', a: S(0, 0, 5, 0), b: S(10, 0, 15, 0), ...NORMAL, expect: null },
  {
    name: 'Lines would intersect, but segments do not',
    a: S(0, 0, 2, 0),
    b: S(5, -5, 5, 5),
    ...NORMAL,
    expect: null,
  },

  // Endpoint intersection cases
  {
    name: 'Endpoint touching - should intersect',
    a: S(0, 0, 10, 0),
    b: S(10, 0, 20, 0),
    ...NORMAL,
    expect: V(10, 0),
  },
  {
    name: 'Endpoint touching - ignore endpoints',
    a: S(0, 0, 10, 0),
    b: S(10, 0, 20, 0),
    ignoreEndpoints: true,
    lines: false,
    expect: null,
  },
  {
    name: 'Endpoint touching at angle',
    a: S(0, 0, 10, 0),
    b: S(10, 0, 15, 5),
    ...NORMAL,
    expect: V(10, 0),
  },

  // Collinear cases
  {
    name: 'Collinear overlapping segments',
    a: S(0, 0, 10, 0),
    b: S(5, 0, 15, 0),
    ...NORMAL,
    expect: V(7, 0),
  },
  {
    name: 'Collinear non-overlapping segments',
    a: S(0, 0, 5, 0),
    b: S(10, 0, 15, 0),
    ...NORMAL,
    expect: null,
  },
  {
    name: 'Collinear touching at endpoint',
    a: S(0, 0, 10, 0),
    b: S(10, 0, 20, 0),
    ...NORMAL,
    expect: V(10, 0),
  },
  {
    name: 'Collinear contained segment',
    a: S(0, 0, 20, 0),
    b: S(5, 0, 15, 0),
    ...NORMAL,
    expect: V(10, 0),
  },
  {
    name: 'Collinear vertical overlapping',
    a: S(5, 0, 5, 10),
    b: S(5, 5, 5, 15),
    ...NORMAL,
    expect: V(5, 7),
  },

  // Line mode cases (infinite lines)
  {
    name: 'Lines intersect, segments do not',
    a: S(0, 0, 2, 0),
    b: S(5, -5, 5, 5),
    ...LINES,
    expect: V(5, 0),
  },
  {
    name: 'Parallel lines (infinite)',
    a: S(0, 0, 10, 0),
    b: S(0, 5, 10, 5),
    ...LINES,
    expect: null,
  },
  {
    name: 'Collinear lines (infinite)',
    a: S(0, 0, 10, 0),
    b: S(20, 0, 30, 0),
    ...LINES,
    expect: V(10, 0),
  },

  // Edge cases
  {
    name: 'Zero-length segment intersection',
    a: S(5, 5, 5, 5),
    b: S(0, 5, 10, 5),
    ...NORMAL,
    expect: V(5, 5),
  },
  {
    name: 'Both zero-length, same point',
    a: S(5, 5, 5, 5),
    b: S(5, 5, 5, 5),
    ...NORMAL,
    expect: V(5, 5),
  },
  {
    name: 'Both zero-length, different points',
    a: S(5, 5, 5, 5),
    b: S(10, 10, 10, 10),
    ...NORMAL,
    expect: null,
  },

  // Diagonal intersection cases
  {
    name: '45-degree crossing',
    a: S(0, 0, 10, 10),
    b: S(0, 10, 10, 0),
    ...NORMAL,
    expect: V(5, 5),
  },
  {
    name: 'Arbitrary angle crossing',
    a: S(0, 0, 6, 8),
    b: S(0, 8, 6, 0),
    ...NORMAL,
    expect: V(3, 4),
  },

  // Bounding box optimisation cases
  {
    name: 'Far apart horizontal segments',
    a: S(0, 0, 10, 0),
    b: S(100, 0, 110, 0),
    ...NORMAL,
    expect: null,
  },
  {
    name: 'Far apart vertical segments',
    a: S(0, 0, 0, 10),
    b: S(0, 100, 0, 110),
    ...NORMAL,
    expect: null,
  },
  {
    name: 'Far apart diagonal segments',
    a: S(0, 0, 10, 10),
    b: S(100, 100, 110, 110),
    ...NORMAL,
    expect: null,
  },
];

describe("segIntersect — upstream's own case table", () => {
  for (const c of intersectCases) {
    it(c.name, () => {
      const ab = segIntersect(c.a, c.b, c.ignoreEndpoints, c.lines);
      const ba = segIntersect(c.b, c.a, c.ignoreEndpoints, c.lines);

      // Upstream's predicate requires the two directions to agree on existence.
      expect(ab === null).toBe(ba === null);

      if (c.expect === null) expect(ab).toBeNull();
      else expect(ab).toEqual(c.expect);
    });
  }
});

describe('segIntersect — the answers that are not shapes', () => {
  it('takes the integer midpoint of a collinear overlap, not the fractional one', () => {
    // The overlap of [0,10] and [5,15] is [5,10]; `( 5 + 10 ) / 2` between two
    // ints is 7, and upstream's table pins exactly that. A `/ 2` in doubles
    // gives 7.5 and puts a fractional coordinate into the router.
    const p = segIntersect(S(0, 0, 10, 0), S(5, 0, 15, 0));

    expect(p).toEqual(V(7, 0));
    expect(Number.isInteger(p?.x)).toBe(true);
  });

  it('lifts the overlap midpoint back onto a sloped line with rescale', () => {
    // Two collinear segments on the line y = x/2. The projection axis is x
    // (|dx| >= |dy|); the overlap of [0,10] and [4,14] is [4,10], whose integer
    // midpoint is 7. The y that goes with it is rescale( 7, 5, 10 ), i.e.
    // ( 35 + 5 ) / 10 = 4 — rounded half away from zero. The true value is 3.5,
    // so a plain divide leaves a fractional coordinate and a truncating one
    // answers 3.
    expect(segIntersect(S(0, 0, 10, 5), S(4, 2, 14, 7))).toEqual(V(7, 4));
    expect(segIntersect(S(4, 2, 14, 7), S(0, 0, 10, 5))).toEqual(V(7, 4));
  });

  it('keeps an endpoint-only collinear touch when only one side has an endpoint there', () => {
    // Upstream's `isEndpointTouch` guard: a degenerate segment sitting in the
    // MIDDLE of a longer one is a zero-extent overlap too, but it is an
    // interior hit, not a corner, so aIgnoreEndpoints must not drop it.
    expect(segIntersect(S(0, 0, 10, 0), S(5, 0, 5, 0), true)).toEqual(V(5, 0));
    // Whereas a shared corner is dropped.
    expect(segIntersect(S(0, 0, 10, 0), S(10, 0, 20, 0), true)).toBeNull();
  });

  it('drops a crossing that is an endpoint of both, and keeps one that is not', () => {
    // Upstream's `IntersectIgnoreEndpointsEdgeCases`.
    expect(segIntersect(S(0, 0, 10, 0), S(5, -5, 5, 5), true)).toEqual(V(5, 0));
    expect(segIntersect(S(0, 0, 10, 0), S(10, 0, 20, 0), true)).toBeNull();
  });

  it('rounds a collinear line-mode midpoint half away from zero', () => {
    // `( A + aSeg.A ) / 2` is `VECTOR2I::operator/( double )`, whose integral
    // body is `KiROUND( x / aFactor )` (`vector2d.h:536`). There is no
    // truncating divide on VECTOR2 at all.
    expect(segIntersectLines(S(0, 0, 100, 0), S(3, 0, 103, 0))).toEqual(V(2, 0));
    expect(segIntersectLines(S(0, 0, 0, 100), S(0, -3, 0, 97))).toEqual(V(0, -2));
  });

  it('answers a degenerate argument’s own start before the midpoint', () => {
    expect(segIntersectLines(S(0, 0, 100, 0), S(40, 0, 40, 0))).toEqual(V(40, 0));
    expect(segIntersectLines(S(10, 0, 10, 0), S(0, 0, 100, 0))).toEqual(V(10, 0));
    expect(segIntersectLines(S(10, 0, 10, 0), S(40, 0, 40, 0))).toEqual(V(40, 0));
  });

  it('skips the bounding-box rejection in line mode', () => {
    // The defining difference: two segments with no shared box at all still
    // have crossing lines.
    expect(segIntersectLines(S(0, 0, 10, 0), S(1000, -500, 1000, -400))).toEqual(V(1000, 0));
    expect(segIntersect(S(0, 0, 10, 0), S(1000, -500, 1000, -400))).toBeNull();
  });
});

describe('segIntersect — large coordinates, where 64-bit stops being optional', () => {
  it('crosses two segments a metre long at board scale', () => {
    // Upstream's `IntersectLargeCoordinates`. The determinant here is 4e18 —
    // two and a half orders of magnitude past 2^53.
    expect(
      segIntersect(S(1000000000, 0, -1000000000, 0), S(0, 1000000000, 0, -1000000000)),
    ).toEqual(V(0, 0));
  });

  it('is exact where a double would drift, at 1e9 coordinates', () => {
    // A shallow crossing at the far corner of KiCad's design space. Both
    // parameter numerators are order 1e18; the answer is an integer and a
    // fractional implementation need not land on it.
    const p = segIntersect(S(-1000000000, -3, 1000000000, 3), S(0, -1000000000, 0, 1000000000));

    expect(p).toEqual(V(0, 0));
  });

  it('answers null rather than truncating an intersection that overflows int32', () => {
    // Upstream's guard is the last thing before the return: the arithmetic
    // above it succeeded, the coordinate simply does not fit. Slopes 1e-6 and
    // 5e-7 with a 100000 offset put the crossing at x = 2e11.
    expect(segIntersectLines(S(0, 0, 1000000, 1), S(0, 100000, 2000000, 100001))).toBeNull();
  });

  it('reports a near-degenerate segment’s crossing without inventing one', () => {
    // Upstream's `IntersectPrecisionEdgeCases`: a segment one unit tall and a
    // million long, crossed in the middle.
    const p = segIntersect(S(0, 0, 1000000, 1), S(500000, -1, 500000, 2));

    expect(p).not.toBeNull();
    expect(p?.x).toBe(500000);
    expect(p?.y).toBeGreaterThanOrEqual(0);
    expect(p?.y).toBeLessThanOrEqual(1);
  });

  it('rounds the scaled direction with rescale, not by truncating the quotient', () => {
    // The unit square's diagonals cross at (0.5, 0.5), which no integer
    // coordinate can hold, so the answer is decided entirely by how
    // `rescale( param1_num, dir2, determinant )` rounds.
    //
    // param1_num = -1, determinant = -2, dir2 = (-1, 1). Upstream's int64
    // rescale is `( n*v ± d/2 ) / d` with the sign of the correction following
    // `(n*v < 0) ^ (d < 0)`: x gets ( 1 + 1 ) / -2 = -1 and y gets
    // ( -1 - 1 ) / -2 = 1, so the point is aSeg.A + (-1, 1) = (0, 1).
    //
    // Truncating the quotient instead — `trunc( -1 * -1 / -2 )` and
    // `trunc( -1 * 1 / -2 )`, both 0 — answers (1, 0). Same distance from the
    // true crossing, opposite corner.
    expect(segIntersect(S(0, 0, 1, 1), S(1, 0, 0, 1))).toEqual(V(0, 1));

    // Scaled up by a million so the products are past 2^53 and a double cannot
    // represent the quotient's tie exactly either.
    expect(segIntersect(S(0, 0, 1000000001, 1000000001), S(1000000001, 0, 0, 1000000001))).toEqual(
      V(500000000, 500000001),
    );
  });

  it('does not mistake two parallel shallow lines for a crossing', () => {
    // Both slopes are exactly 1/1000000. In doubles the determinant is a
    // rounding residue rather than zero, and the answer is a point invented by
    // noise.
    expect(segIntersectLines(S(0, 0, 1000000, 1), S(0, 1000000, 1000000, 1000001))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SEG::Distance, both overloads — upstream's tables.

describe('segDistance — upstream’s seg/seg table', () => {
  const cases: [string, Seg, Seg, number][] = [
    ['Parallel, 10 apart', S(0, 0, 10, 0), S(0, 10, 10, 10), 10],
    ['Non-parallel, 10 apart', S(0, -5, 10, 0), S(0, 10, 10, 10), 10],
    ['Co-incident', S(0, 0, 30, 0), S(10, 0, 20, 0), 0],
    ['Crossing', S(0, -10, 0, 10), S(-20, 0, 20, 0), 0],
    ['T-junction', S(0, -10, 0, 10), S(-20, 0, 0, 0), 0],
    ['T-junction (no touch)', S(0, -10, 0, 10), S(-20, 0, -2, 0), 2],
    ['Zero-length segment A', S(0, 0, 0, 0), S(10, 0, 20, 0), 10],
    ['Zero-length segment B', S(10, 0, 20, 0), S(0, 0, 0, 0), 10],
    ['Both zero-length', S(0, 0, 0, 0), S(10, 0, 10, 0), 10],
  ];

  for (const [name, a, b, exp] of cases) {
    it(name, () => {
      // Upstream's predicate demands the same answer in both directions.
      expect(segDistance(a, b)).toBe(exp);
      expect(segDistance(b, a)).toBe(exp);
    });
  }
});

describe('segDistanceToPoint — upstream’s seg/point table', () => {
  const cases: [string, Seg, Vec2, number][] = [
    ['On endpoint', S(0, 0, 10, 0), V(0, 0), 0],
    ['On segment', S(0, 0, 10, 0), V(3, 0), 0],
    ['At side', S(0, 0, 10, 0), V(3, 2), 2],
    ['At end (collinear)', S(0, 0, 10, 0), V(12, 0), 2],
    ['At end (not collinear)', S(0, 0, 1000, 0), V(1200, 200), 282],
    [
      'Issue 18473 (inside hit with rounding error)',
      S(187360000, 42510000, 105796472, 42510000),
      V(106645000, 42510000),
      0,
    ],
    [
      'Straight line x distance',
      S(187360000, 42510000, 105796472, 42510000),
      V(197360000, 42510000),
      10000000,
    ],
    [
      'Straight line -x distance',
      S(187360000, 42510000, 105796472, 42510000),
      V(104796472, 42510000),
      1000000,
    ],
  ];

  for (const [name, seg, p, exp] of cases) {
    it(name, () => {
      expect(segSquaredDistanceToPoint(seg, p)).toBeGreaterThanOrEqual(0);
      expect(segDistanceToPoint(seg, p)).toBe(exp);
    });
  }

  it('floors, it does not round — `isqrt` is not `round( hypot )`', () => {
    // 5 units up from a 45 degree line: the nearest point is 5/sqrt(2) = 3.53
    // away, and `isqrt` is the largest integer whose square does not exceed the
    // squared distance, so 3. Rounding gives 4.
    expect(segDistanceToPoint(S(-100, -100, 100, 100), V(0, 5))).toBe(3);
    // Squared distance 3: sqrt is 1.73, floors to 1, rounds to 2. This is the
    // exact boundary `SEG::Contains` sits on.
    expect(segDistanceToPoint(S(0, 0, 0, 0), V(1, 1))).toBe(1); // sqrt(2) = 1.41
    expect(segDistanceToPoint(S(0, 0, 100, 0), V(101, 1))).toBe(1); // sqrt(2)
  });

  it('is exact at board-scale coordinates', () => {
    // Squared distance here is 1e16, past 2^53, and the interior branch is the
    // one that runs.
    expect(segDistanceToPoint(S(0, 0, 1000000000, 0), V(500000000, 100000000))).toBe(100000000);
  });
});

describe('segContains', () => {
  it('is SquaredDistance <= 3, an absolute tolerance of three square IU', () => {
    // 1 IU off the line is contained (1 <= 3); 2 IU off is not (4 > 3).
    expect(segContains(S(0, 0, 10, 0), V(5, 1))).toBe(true);
    expect(segContains(S(0, 0, 10, 0), V(5, 2))).toBe(false);
    // A diagonal offset past the end squares to 2 and is still contained.
    expect(segContains(S(0, 0, 10, 0), V(11, 1))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SEG::LineProject / LineDistance / NearestPoint / Collinear

describe('segLineProject', () => {
  it('projects onto the INFINITE line, past both ends', () => {
    expect(segLineProject(S(0, 0, 10, 0), V(50, 20))).toEqual(V(50, 0));
    expect(segLineProject(S(0, 0, 10, 0), V(-50, 20))).toEqual(V(-50, 0));
  });

  it('answers A for a zero-length segment rather than dividing by zero', () => {
    expect(segLineProject(S(7, 7, 7, 7), V(50, 20))).toEqual(V(7, 7));
  });

  it('rounds half AWAY from zero, as rescale does, not half up', () => {
    // d = (2, 2), l² = 8, t = d.Dot( aP - A ) = 2. rescale( 2, 2, 8 ) is
    // ( 4 + 4 ) / 8 = 1 on the positive side and ( -4 - 4 ) / 8 = -1 mirrored.
    // `Math.round` gives 1 and 0 — the divergence the router-local copy had.
    expect(segLineProject(S(0, 0, 2, 2), V(2, 0))).toEqual(V(1, 1));
    expect(segLineProject(S(0, 0, -2, -2), V(-2, 0))).toEqual(V(-1, -1));
  });

  it('is exact at board scale, where t * d.x is order 1e24', () => {
    // A 1 m segment at 1e6 IU/mm has l² = 2e18, and the product feeding the
    // divide is past 1e27.
    const seg = S(0, 0, 1000000000, 1000000000);

    expect(segLineProject(seg, V(700000000, 700000000))).toEqual(V(700000000, 700000000));
    expect(segLineProject(seg, V(800000000, 600000000))).toEqual(V(700000000, 700000000));
  });
});

describe('segNearestPoint', () => {
  it('clamps to the ends, where LineProject does not', () => {
    expect(segNearestPoint(S(0, 0, 10, 0), V(50, 20))).toEqual(V(10, 0));
    expect(segNearestPoint(S(0, 0, 10, 0), V(-50, 20))).toEqual(V(0, 0));
    expect(segNearestPoint(S(0, 0, 10, 0), V(5, 20))).toEqual(V(5, 0));
  });

  it('answers A for a zero-length segment', () => {
    expect(segNearestPoint(S(7, 7, 7, 7), V(50, 20))).toEqual(V(7, 7));
  });
});

describe('segLineDistance', () => {
  it('matches upstream’s LineDistance cases', () => {
    expect(segLineDistance(S(0, 0, 10, 0), V(5, 0))).toBe(0);
    expect(segLineDistance(S(0, 0, 10, 0), V(5, 8))).toBe(8);
  });

  it('matches upstream’s LineDistanceSided cases', () => {
    expect(segLineDistance(S(0, 0, 10, 0), V(5, 8), true)).toBe(8);
    expect(segLineDistance(S(0, 0, 10, 0), V(5, -8), true)).toBe(-8);
  });

  it('measures to the infinite line, not to the segment', () => {
    // 50 units beyond the end and 8 to the side: the segment distance would be
    // sqrt(50² + 8²), the line distance is 8.
    expect(segLineDistance(S(0, 0, 10, 0), V(60, 8))).toBe(8);
  });

  it('floors isqrt of a ROUNDED rescale, not of the raw ratio', () => {
    // `rescale( det, det, l )` rounds half away from zero *before* the square
    // root. For a 45 degree line and a point one unit off it, det² / l = 1/2,
    // which rescale rounds to 1 and isqrt then answers 1 — where
    // `trunc( sqrt( 0.5 ) )`, the shortcut the router-local copy used, gives 0.
    expect(segLineDistance(S(0, 0, 10, 10), V(1, 0))).toBe(1);
    expect(segLineDistance(S(0, 0, 10, 10), V(0, 1))).toBe(1);
  });

  it('is exact at board scale', () => {
    expect(segLineDistance(S(0, 0, 1000000000, 0), V(-500000000, 123456789))).toBe(123456789);
  });
});

describe('segCollinear', () => {
  it('is measured through UNNORMALISED coefficients, so it tightens with length', () => {
    // `|qa*x + qb*y + qc| <= 1` with qa, qb the raw coordinate differences. For
    // a 200-unit probe segment — DP_GATEWAYS::BuildGeneric's length — that means
    // "within 1/200 of a unit", i.e. exactly aligned.
    expect(segCollinear(S(0, 0, 200, 0), S(500, 0, 700, 0))).toBe(true);
    expect(segCollinear(S(0, 0, 200, 0), S(500, 1, 700, 1))).toBe(false);
    // A one-unit-long segment tolerates the same one unit of numerator, which
    // is a whole unit of offset.
    expect(segCollinear(S(0, 0, 1, 0), S(500, 1, 700, 1))).toBe(true);
  });
});
