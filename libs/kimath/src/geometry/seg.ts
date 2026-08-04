// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SEG intersection and the SHAPE_LINE_CHAIN queries built on it.
 * Counterparts: `libs/kimath/src/geometry/seg.cpp` (`SEG::intersects`) and
 * `libs/kimath/src/geometry/shape_line_chain.cpp` (`Intersect( const SEG& )`,
 * `Area`).
 *
 * Exact-integer throughout, as upstream: the cross products decide inclusion by
 * comparing against the determinant rather than dividing, so a crossing exactly
 * on a vertex is classified the same way KiCad classifies it.
 */

import { KiROUND, rescale } from '../math/util.js';
import type { VECTOR2I } from '../math/vector2.js';

/** One crossing found by {@link chainIntersect}. */
export interface Intersection {
  /** The crossing point. */
  p: VECTOR2I;
  /** Index of the chain segment that was crossed. */
  indexOur: number;
}

const cross = (a: VECTOR2I, b: VECTOR2I): number => a.x * b.y - a.y * b.x;

/**
 * SEG::Intersect for two closed segments, returning null when they miss.
 *
 * `aLines`/`aIgnoreEndpoints` are not ported: the teardrop code only ever asks
 * the plain segment-vs-segment question.
 */
export function segIntersect(
  a1: VECTOR2I,
  a2: VECTOR2I,
  b1: VECTOR2I,
  b2: VECTOR2I,
): VECTOR2I | null {
  // Bounding-box rejection, as upstream.
  if (
    Math.max(a1.x, a2.x) < Math.min(b1.x, b2.x) ||
    Math.max(b1.x, b2.x) < Math.min(a1.x, a2.x) ||
    Math.max(a1.y, a2.y) < Math.min(b1.y, b2.y) ||
    Math.max(b1.y, b2.y) < Math.min(a1.y, a2.y)
  ) {
    return null;
  }

  const dir1 = { x: a2.x - a1.x, y: a2.y - a1.y };
  const dir2 = { x: b2.x - b1.x, y: b2.y - b1.y };
  const offset = { x: b1.x - a1.x, y: b1.y - a1.y };
  const determinant = cross(dir2, dir1);

  if (determinant === 0) {
    // Parallel: upstream walks the collinear-overlap path here. The teardrop
    // caller treats a collinear graze as "no crossing" either way, because a
    // crossing point on an edge it runs along carries no usable direction.
    return null;
  }

  const param2Num = cross(dir2, offset);
  const param1Num = cross(dir1, offset);

  if (determinant > 0) {
    if (param1Num < 0 || param1Num > determinant || param2Num < 0 || param2Num > determinant) {
      return null;
    }
  } else {
    if (param1Num > 0 || param1Num < determinant || param2Num > 0 || param2Num < determinant) {
      return null;
    }
  }

  return {
    x: b1.x + rescale(param1Num, dir2.x, determinant),
    y: b1.y + rescale(param1Num, dir2.y, determinant),
  };
}

/**
 * SHAPE_LINE_CHAIN::Intersect( const SEG&, INTERSECTIONS& ) over a closed chain.
 *
 * Results come back sorted by distance from `segA`, which is what lets the
 * caller take `pts[0]` as "where the track first enters the pad".
 */
export function chainIntersect(
  chain: readonly VECTOR2I[],
  segA: VECTOR2I,
  segB: VECTOR2I,
): Intersection[] {
  const out: Intersection[] = [];
  const n = chain.length;

  const segMinX = Math.min(segA.x, segB.x);
  const segMaxX = Math.max(segA.x, segB.x);
  const segMinY = Math.min(segA.y, segB.y);
  const segMaxY = Math.max(segA.y, segB.y);

  for (let s = 0; s < n; s++) {
    const ptA = chain[s]!;
    const ptB = chain[s + 1 < n ? s + 1 : 0]!;

    if (
      Math.max(ptA.x, ptB.x) < segMinX ||
      Math.min(ptA.x, ptB.x) > segMaxX ||
      Math.max(ptA.y, ptB.y) < segMinY ||
      Math.min(ptA.y, ptB.y) > segMaxY
    ) {
      continue;
    }

    const p = segIntersect(ptA, ptB, segA, segB);

    if (p) out.push({ p, indexOur: s });
  }

  out.sort(
    (a, b) =>
      Math.hypot(a.p.x - segA.x, a.p.y - segA.y) - Math.hypot(b.p.x - segA.x, b.p.y - segA.y),
  );

  return out;
}

/** Crossings of a closed chain against a polyline, in polyline order. */
export function chainIntersectChain(
  chain: readonly VECTOR2I[],
  poly: readonly VECTOR2I[],
): Intersection[] {
  const out: Intersection[] = [];

  for (let ii = 0; ii + 1 < poly.length; ii++) {
    for (const hit of chainIntersect(chain, poly[ii]!, poly[ii + 1]!)) out.push(hit);
  }

  return out;
}

/**
 * SHAPE_LINE_CHAIN::Area.
 *
 * `aAbsolute` defaults to true, as upstream's declaration does — and it matters:
 * the teardrop anchor search picks between two candidate corner assignments by
 * comparing areas, and the correct assignment is the one that encloses more
 * regardless of winding. Comparing signed areas there picks the self-crossing
 * bowtie, whose partial cancellation leaves it *algebraically* larger.
 */
export function chainArea(points: readonly VECTOR2I[], absolute = true): number {
  let area = 0.0;
  const size = points.length;

  for (let i = 0, j = size - 1; i < size; ++i) {
    area += (points[j]!.x + points[i]!.x) * (points[j]!.y - points[i]!.y);
    j = i;
  }

  // Negative when the points run anti-clockwise.
  return absolute ? Math.abs(area * 0.5) : -area * 0.5;
}

// ---------------------------------------------------------------------------
// Approximate collinearity (SEG::mutualDistanceSquared / SEG::ApproxCollinear)

/**
 * A board coordinate as an exact integer. Upstream's VECTOR2I *is* an integer,
 * so the rounding only formalises what the C++ type already guarantees — but it
 * is not optional here: `BigInt()` throws on a fractional number, and a Vec2
 * that has been through a floating-point transform can carry one.
 */
const big = (v: number): bigint => BigInt(KiROUND(v));

/** `(B - A).SquaredEuclideanNorm()` — over 2^53 at metre-scale coordinates. */
const squaredLength = (a: VECTOR2I, b: VECTOR2I): bigint => {
  const dx = big(b.x) - big(a.x);
  const dy = big(b.y) - big(a.y);
  return dx * dx + dy * dy;
};

/**
 * `SEG::ApproxCollinear` (seg.cpp:789) and the `mutualDistanceSquared`
 * (seg.cpp:760) it is built on, folded into one function because nothing else
 * needs the signed distances.
 *
 * ## Why this is BigInt and not `number`
 *
 * Upstream works in `ecoord` (int64). With 1e6 IU/mm, a coordinate near the
 * edge of KiCad's 3.5 km design space reaches ~1e9, so `p`/`q` reach ~1e9,
 * `det` ~1e18 and **`det * det` ~1e36** — far past the 2^53 where a double
 * stops representing consecutive integers. Even the `SquaredLength` comparison
 * that decides which segment supplies the line crosses 2^53 at ~9.5 cm. In
 * doubles the rounding noise swamps the ±1 IU threshold, so a pair of segments
 * a metre long would be judged collinear or not essentially at random. Every
 * value below is therefore exact.
 *
 * The `rescale( det, det, l )` is upstream's int64 specialisation
 * (math/util.cpp:76): round-half-away-from-zero, which for a non-negative
 * numerator and a positive denominator is `(det² + l/2) / l` truncated — and
 * `l / 2` is itself an integer division. That is why the effective threshold is
 * not exactly 1 IU of perpendicular offset but about 1.22 IU.
 *
 * The longer segment supplies the line; ties keep `a` (upstream swaps only on a
 * strict `<`). A zero-length longer segment has no line, and upstream returns
 * false rather than treating the degenerate case as collinear.
 */
export function segApproxCollinear(
  aA: VECTOR2I,
  aB: VECTOR2I,
  bA: VECTOR2I,
  bB: VECTOR2I,
  aDistanceThreshold = 1,
): boolean {
  let a1 = aA;
  let a2 = aB;
  let b1 = bA;
  let b2 = bB;

  if (squaredLength(a1, a2) < squaredLength(b1, b2)) {
    [a1, a2, b1, b2] = [b1, b2, a1, a2];
  }

  const p = big(a1.y) - big(a2.y);
  const q = big(a2.x) - big(a1.x);
  const r = -p * big(a1.x) - q * big(a1.y);
  const l = p * p + q * q;

  if (l === 0n) return false;

  const det1 = p * big(b1.x) + q * big(b1.y) + r;
  const det2 = p * big(b2.x) + q * big(b2.y) + r;

  // rescale( det, det, l ): the numerator is a square and `l` is positive, so
  // the sign branch upstream carries for negative operands cannot be taken.
  const half = l / 2n;
  const d1 = (det1 * det1 + half) / l;
  const d2 = (det2 * det2 + half) / l;

  // Upstream re-applies sgn(det) and then takes the absolute value again; the
  // pair cancels, so the comparison is against the unsigned squared distance.
  const thresholdSquared = big(aDistanceThreshold) * big(aDistanceThreshold);

  return d1 <= thresholdSquared && d2 <= thresholdSquared;
}
