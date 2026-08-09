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

import { KiROUND, rescale, rescale64 } from '../math/util.js';
import type { Vec2, VECTOR2I } from '../math/vector2.js';
import type { Seg } from './corner_operations.js';

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
// `KiROUND` is here to *convert*, not to round faithfully: `BigInt()` throws
// on a fractional number and a Vec2 could carry one. Board coordinates are
// integers, so swapping it for `Math.round` changes no answer on any real
// input — mutation testing confirms that — and the two differ only on a
// negative half, which no caller here produces. Kept for the KiCad rounding
// convention rather than on the strength of a test.
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

/** `std::numeric_limits<VECTOR2I::coord_type>` — the range an intersection must land in. */
const COORD_MAX = 2147483647n;
const COORD_MIN = -2147483648n;

const bigCross = (ax: bigint, ay: bigint, bx: bigint, by: bigint): bigint => ax * by - ay * bx;

/**
 * `SEG::IntersectLines` — `Intersect( aSeg, false, true )` (`seg.cpp`).
 *
 * The intersection of the **infinite lines** through two segments, not of the
 * segments themselves. That is a different question from {@link segIntersect}
 * in three ways, and every one of them is load bearing:
 *
 * 1. **No bounding-box rejection.** Upstream skips it explicitly for line mode,
 *    "since infinite lines can intersect anywhere". Two segments nowhere near
 *    each other still have crossing lines.
 * 2. **No parameter range check.** `segIntersect` refuses a result outside
 *    `[0, 1]` on both segments; here that is the normal case.
 * 3. **Collinear lines intersect.** Where `segIntersect` answers null, upstream
 *    answers a point — and which point is spelled out rather than derived: a
 *    degenerate `aSeg` gives its own start, a degenerate receiver gives *its*
 *    start, and otherwise the **midpoint of the two starts**, which upstream's
 *    comment calls "a reasonable choice" for an ambiguous answer. Parallel but
 *    *not* collinear is still null.
 *
 * The arithmetic is exact. `determinant`, both parameter numerators and the
 * scaled direction are computed in BigInt, because the determinant of two
 * board-scale vectors is order 1e16 — already past 2^53, where a double stops
 * representing consecutive integers and `rescale`'s half-away-from-zero
 * correction stops landing where C++ lands it. A fractional implementation
 * diverges by a unit and then feeds that unit into `LineProject`.
 *
 * The overflow guard is upstream's too: an intersection can exist
 * mathematically and still not fit a 32-bit coordinate, and upstream answers
 * "no intersection" rather than truncating. Two nearly-parallel lines are
 * exactly the case that produces it.
 */
export function segIntersectLines(
  a1: VECTOR2I,
  a2: VECTOR2I,
  b1: VECTOR2I,
  b2: VECTOR2I,
): VECTOR2I | null {
  const d1x = BigInt(KiROUND(a2.x - a1.x));
  const d1y = BigInt(KiROUND(a2.y - a1.y));
  const d2x = BigInt(KiROUND(b2.x - b1.x));
  const d2y = BigInt(KiROUND(b2.y - b1.y));
  const ox = BigInt(KiROUND(b1.x - a1.x));
  const oy = BigInt(KiROUND(b1.y - a1.y));

  const determinant = bigCross(d2x, d2y, d1x, d1y);

  if (determinant === 0n) {
    // Parallel but not collinear: upstream returns nothing.
    if (bigCross(d1x, d1y, ox, oy) !== 0n) return null;

    // Collinear. The intersection of two identical infinite lines is the whole
    // line, so upstream picks a representative rather than failing.
    if (b1.x === b2.x && b1.y === b2.y) return { x: b1.x, y: b1.y };
    if (a1.x === a2.x && a1.y === a2.y) return { x: a1.x, y: a1.y };

    // `( A + aSeg.A ) / 2` is VECTOR2I's integer divide, truncating per
    // component toward zero — not a rounded midpoint.
    return {
      x: Math.trunc((a1.x + b1.x) / 2),
      y: Math.trunc((a1.y + b1.y) / 2),
    };
  }

  // `param1_num = e x ac`, the parameter along *this* segment. Upstream then
  // evaluates the point on the OTHER segment's line, `aSeg.A + (q/d) * f`.
  const param1Num = bigCross(d1x, d1y, ox, oy);

  const rx = BigInt(KiROUND(b1.x)) + rescale64(param1Num, d2x, determinant);
  const ry = BigInt(KiROUND(b1.y)) + rescale64(param1Num, d2y, determinant);

  if (rx > COORD_MAX || rx < COORD_MIN || ry > COORD_MAX || ry < COORD_MIN) return null;

  return { x: Number(rx), y: Number(ry) };
}

// ---------------------------------------------------------------------------
// The remaining `SEG` members `CIRCLE::ConstructFromTanTanPt` is built on.
//
// These take a `Seg` object rather than four endpoints, because three of them
// *return* a segment and upstream's `SEG` is a value type. `Seg` is imported
// from `corner_operations.ts` rather than declared again — it is already
// `{ a: Vec2; b: Vec2 }` there, and structurally the same as the `Seg` the PNS
// router passes around, so no adapter is needed at any call site.

/** `-0` reads as a different value to `0` in a deep-equality assertion. */
const noNegZero = (v: number): number => (v === 0 ? 0 : v);

/** A number back out of BigInt. Board coordinates fit a double exactly. */
const num = (v: bigint): number => noNegZero(Number(v));

/**
 * `isqrt` (`seg.cpp:57`): the largest integer whose square does not exceed `x`,
 * computed exactly.
 *
 * Upstream seeds from `(T) std::sqrt( (double) x )` and then corrects with two
 * `while` loops, precisely because the double is not trustworthy at int64
 * scale. The seed here is the same double; the corrections are the same, in
 * BigInt. `x` is a *squared* distance, so it reaches ~1e18 and the double's
 * ~1e-16 relative error puts the seed a unit or two either side of the truth —
 * which is exactly what the loops are for.
 *
 * Upstream's `x < 0` arm returns `sqrt_max`; it is unreachable from
 * {@link segLineDistance}, whose argument is a square, and is kept anyway.
 */
function isqrt64(x: bigint): bigint {
  const SQRT_INT64_MAX = 3037000499n;

  if (x < 0n) return SQRT_INT64_MAX;

  let r = BigInt(Math.trunc(Math.sqrt(Number(x))));

  while (r < SQRT_INT64_MAX && r * r < x) r++;
  while (r > SQRT_INT64_MAX || r * r > x) r--;

  return r;
}

/**
 * `SEG::LineProject( aP )` (`seg.cpp:681`): the foot of the perpendicular from
 * `aP` onto the segment's **infinite** line.
 *
 * A zero-length segment has no line, and upstream answers `A` rather than
 * dividing by zero.
 *
 * Moved down here from `pcbnew/src/router/pns_seg_ops.ts`, unchanged, so that
 * kimath's own geometry can call it; that module now re-exports this one. The
 * arithmetic is int64 throughout because `l_squared = d.Dot( d )` for a segment
 * 10 cm long at 1e6 IU/mm is already 1e16, past 2^53, and `rescale64` then
 * forms `t * d.x` on top of it — order 1e24. Past 2^53 neither the truncating
 * division nor the half-away-from-zero correction is guaranteed to land where
 * C++ lands it.
 *
 * Note there are two *other* `segLineProject`s in pcbnew — one private in
 * `drc/shape_collisions.ts`, one exported from `router/pns_multi_dragger.ts` —
 * which are the plain-double shortcut. They are left alone; their callers rank
 * candidates rather than build coordinates that feed further geometry.
 */
export function segLineProject(aSeg: Seg, aP: Vec2): Vec2 {
  const dx = big(aSeg.b.x) - big(aSeg.a.x);
  const dy = big(aSeg.b.y) - big(aSeg.a.y);
  const lSquared = dx * dx + dy * dy;

  if (lSquared === 0n) return { x: aSeg.a.x, y: aSeg.a.y };

  const t = dx * (big(aP.x) - big(aSeg.a.x)) + dy * (big(aP.y) - big(aSeg.a.y));

  return {
    x: num(big(aSeg.a.x) + rescale64(t, dx, lSquared)),
    y: num(big(aSeg.a.y) + rescale64(t, dy, lSquared)),
  };
}

/**
 * `SEG::mutualDistanceSquared` (`seg.cpp:760`): the two *signed* squared
 * distances from the shorter segment's endpoints to the longer segment's line,
 * or `null` when the longer segment is degenerate and defines no line.
 *
 * {@link segApproxCollinear} above has the same computation folded into its
 * body, but it needs only the magnitudes; `ApproxParallel` needs the signs, and
 * the difference is not cosmetic — see that function. This file is append-only
 * with respect to what is already exported, so the older one is left as it is
 * rather than rewritten to call this.
 *
 * The longer segment supplies the line; ties keep `aA`, because upstream swaps
 * only on a strict `<`.
 */
function mutualDistanceSquared(aA: Seg, aB: Seg): { d1: bigint; d2: bigint } | null {
  let a = aA;
  let b = aB;

  if (squaredLength(a.a, a.b) < squaredLength(b.a, b.b)) {
    const t = a;
    a = b;
    b = t;
  }

  const p = big(a.a.y) - big(a.b.y);
  const q = big(a.b.x) - big(a.a.x);
  const r = -p * big(a.a.x) - q * big(a.a.y);
  const l = p * p + q * q;

  if (l === 0n) return null;

  const det1 = p * big(b.a.x) + q * big(b.a.y) + r;
  const det2 = p * big(b.b.x) + q * big(b.b.y) + r;

  const sgn = (v: bigint): bigint => (v > 0n ? 1n : v < 0n ? -1n : 0n);

  return {
    d1: sgn(det1) * rescale64(det1, det1, l),
    d2: sgn(det2) * rescale64(det2, det2, l),
  };
}

/**
 * `SEG::ApproxParallel` (`seg.cpp:803`): the two endpoints of the shorter
 * segment sit at (near enough) the *same signed* distance from the longer one's
 * line.
 *
 * Signed is what makes this "parallel" rather than "collinear or crossing": a
 * segment that crosses the other's line has endpoints at equal magnitude but
 * opposite sign when it crosses at its midpoint, and the subtraction then gives
 * twice the distance rather than zero.
 *
 * A degenerate longer segment answers false.
 *
 * Moved down here from `pcbnew/src/router/pns_seg_ops.ts`, which now re-exports
 * it. The one change is that the length comparison choosing the longer segment
 * runs in BigInt like the rest, instead of in doubles — it crosses 2^53 at
 * around 9.5 cm.
 */
export function segApproxParallel(aA: Seg, aB: Seg, aDistanceThreshold = 1): boolean {
  const d = mutualDistanceSquared(aA, aB);

  if (!d) return false;

  const diff = d.d1 - d.d2;
  const abs = diff < 0n ? -diff : diff;

  return abs <= big(aDistanceThreshold) * big(aDistanceThreshold);
}

/**
 * `SEG::LineDistance( aP, aDetermineSide )` (`seg.cpp:742`): the distance to the
 * segment's **infinite** line, signed by which side `aP` falls on when asked.
 *
 * The sign is `sgn( det )`, the same determinant `SEG::Side` uses, so the two
 * agree on left and right.
 *
 * Exact: `det` is order 1e18 for board-scale coordinates and `rescale( det,
 * det, l )` squares it, so the whole chain is BigInt and the square root is the
 * integer {@link isqrt64} rather than a double `sqrt`. `pns_multi_dragger.ts`
 * exports a `segLineDistance` that is the double shortcut — that one is left
 * alone because `MULTI_DRAGGER` reads its sign and a coarse magnitude, whereas
 * `CIRCLE::ConstructFromTanTanPt` writes its `Radius` straight out of this.
 *
 * A degenerate segment gives `dist_sq = 0`, and upstream still applies the sign
 * of `det` — which for a degenerate segment is itself 0.
 */
export function segLineDistance(aSeg: Seg, aP: Vec2, aDetermineSide = false): number {
  const p = big(aSeg.a.y) - big(aSeg.b.y);
  const q = big(aSeg.b.x) - big(aSeg.a.x);
  const r = -p * big(aSeg.a.x) - q * big(aSeg.a.y);
  const l = p * p + q * q;
  const det = p * big(aP.x) + q * big(aP.y) + r;

  // `rescale( det, det, l )`: the numerator is a square and `l` is positive, so
  // the half-away-from-zero correction is always added.
  const distSq = l > 0n ? rescale64(det, det, l) : 0n;
  const dist = isqrt64(distSq);

  if (!aDetermineSide) return num(dist < 0n ? -dist : dist);

  const sgn = det > 0n ? 1n : det < 0n ? -1n : 0n;

  return num(sgn * dist);
}

/**
 * `SEG::Center()` (`seg.h:375`): `A + ( B - A ) / 2`.
 *
 * `VECTOR2I::operator/( int )` divides each component and **truncates toward
 * zero**, which is not the same as a rounded midpoint: the centre of a segment
 * spanning an odd number of units lands on the `A` side of true centre, and
 * which side that is depends on the sign of `B - A`.
 */
export function segCenter(aSeg: Seg): Vec2 {
  return {
    x: aSeg.a.x + noNegZero(Math.trunc((aSeg.b.x - aSeg.a.x) / 2)),
    y: aSeg.a.y + noNegZero(Math.trunc((aSeg.b.y - aSeg.a.y) / 2)),
  };
}

/**
 * `SEG::ParallelSeg( aP )` (`seg.cpp:529`): a segment through `aP` with this
 * segment's slope, and with this segment's *length* — upstream adds the whole
 * `B - A` vector, it does not normalise.
 */
export function segParallelSeg(aSeg: Seg, aP: Vec2): Seg {
  const slope = { x: aSeg.b.x - aSeg.a.x, y: aSeg.b.y - aSeg.a.y };

  return { a: { x: aP.x, y: aP.y }, b: { x: slope.x + aP.x, y: slope.y + aP.y } };
}

/**
 * `SEG::PerpendicularSeg( aP )` (`seg.cpp:520`): a segment through `aP` at right
 * angles to this one.
 *
 * `VECTOR2I::Perpendicular()` is `(-y, x)`, a quarter turn one specific way —
 * not `(y, -x)`. The two differ by a half turn and give the segment the
 * opposite direction, which flips the sign `SEG::Side` and the signed
 * `LineDistance` report about it.
 */
export function segPerpendicularSeg(aSeg: Seg, aP: Vec2): Seg {
  const slope = { x: aSeg.b.x - aSeg.a.x, y: aSeg.b.y - aSeg.a.y };

  return { a: { x: aP.x, y: aP.y }, b: { x: -slope.y + aP.x, y: slope.x + aP.y } };
}
