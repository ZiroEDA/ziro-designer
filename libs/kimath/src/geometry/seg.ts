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

import { KiROUND, rescale64 } from '../math/util.js';
import { divideI } from '../math/vector2.js';
import type { Vec2, VECTOR2I } from '../math/vector2.js';
import type { Seg } from './corner_operations.js';

/** One crossing found by {@link chainIntersect}. */
export interface Intersection {
  /** The crossing point. */
  p: VECTOR2I;
  /** Index of the chain segment that was crossed. */
  indexOur: number;
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

    const p = segIntersect({ a: ptA, b: ptB }, { a: segA, b: segB });

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

const absB = (v: bigint): bigint => (v < 0n ? -v : v);

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
 * `SEG::Center()` (`seg.h:379`): `A + ( B - A ) / 2`.
 *
 * `VECTOR2I` has exactly **one** division operator, `operator/( double )`
 * (`vector2d.h:536`), and for an integral `T` its body is
 * `VECTOR2<T>( KiROUND( x / aFactor ), KiROUND( y / aFactor ) )`. So the halving
 * **rounds half away from zero**; it does not truncate. A segment spanning an
 * odd number of units therefore has its centre on the *far* side of true
 * centre, not the `A` side.
 */
export function segCenter(aSeg: Seg): Vec2 {
  const half = divideI({ x: aSeg.b.x - aSeg.a.x, y: aSeg.b.y - aSeg.a.y }, 2);

  return { x: aSeg.a.x + half.x, y: aSeg.a.y + half.y };
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

// ---------------------------------------------------------------------------
// SEG intersection, collinearity and distance — the single implementation.
//
// Upstream has exactly one of each of these, in `seg.cpp`, and every caller
// (the PNS router included) goes through it. Everything below is that one
// implementation; the router-local copies that used to live in
// `pns_diff_pair.ts` and `pns_multi_dragger.ts` now re-export from here.

/**
 * `SEG::checkCollinearOverlap` (`seg.cpp:220`) — the branch `intersects` takes
 * once it knows the two segments lie on the *same* line.
 *
 * The answer is the **midpoint of the overlap region**, projected back onto the
 * line. Three details are upstream's and all three change the answer:
 *
 *  1. The projection axis is chosen by the caller (`|dir1.x| >= |dir1.y|`), so
 *     a near-vertical pair is compared on `y`. Comparing on the degenerate axis
 *     would make every pair "overlap".
 *  2. `( overlap_start + overlap_end ) / 2` is **integer** division of two
 *     `int`s. Upstream's own test data pins it: `(0,0)-(10,0)` against
 *     `(5,0)-(15,0)` is expected at `(7, 0)`, not `(7.5, 0)`
 *     (`qa/tests/libs/kimath/geometry/test_segment.cpp:872`).
 *  3. The other coordinate comes from `rescale`, not a plain divide — the
 *     result is an integer coordinate, rounded half away from zero.
 *
 * `aIgnoreEndpoints` drops a zero-extent overlap **only when the touch point is
 * an endpoint of both segments**. Upstream spells that condition out
 * (`isEndpointTouch`) rather than rejecting every zero-extent overlap, because a
 * degenerate segment sitting in the middle of a longer one also produces one and
 * is a genuine interior hit.
 */
function checkCollinearOverlap(
  aSeg: Seg,
  aOther: Seg,
  aUseXAxis: boolean,
  aIgnoreEndpoints: boolean,
): Vec2 | null {
  const along = (p: Vec2): number => (aUseXAxis ? p.x : p.y);
  const across = (p: Vec2): number => (aUseXAxis ? p.y : p.x);

  const seg1Start = along(aSeg.a);
  const seg1End = along(aSeg.b);
  const coord1Start = across(aSeg.a);
  const coord1End = across(aSeg.b);

  const seg1Min = Math.min(seg1Start, seg1End);
  const seg1Max = Math.max(seg1Start, seg1End);
  const seg2Min = Math.min(along(aOther.a), along(aOther.b));
  const seg2Max = Math.max(along(aOther.a), along(aOther.b));

  if (!(seg1Max >= seg2Min && seg2Max >= seg1Min)) return null;

  const overlapStart = Math.max(seg1Min, seg2Min);
  const overlapEnd = Math.min(seg1Max, seg2Max);

  if (aIgnoreEndpoints && overlapStart === overlapEnd) {
    const touchesSeg1End = overlapStart === seg1Min || overlapStart === seg1Max;
    const touchesSeg2End = overlapStart === seg2Min || overlapStart === seg2Max;

    if (touchesSeg1End && touchesSeg2End) return null;
  }

  // `( overlap_start + overlap_end ) / 2` between two `int`s: truncates.
  const proj = Math.trunc((overlapStart + overlapEnd) / 2);

  const other =
    seg1End !== seg1Start
      ? coord1Start +
        Number(
          rescale64(big(proj - seg1Start), big(coord1End - coord1Start), big(seg1End - seg1Start)),
        )
      : coord1Start;

  return aUseXAxis ? { x: proj, y: other } : { x: other, y: proj };
}

/**
 * `SEG::intersects( aSeg, aIgnoreEndpoints, aLines, aPt )` (`seg.cpp:312`) —
 * the one implementation every other intersection query upstream is written on
 * (`Intersect`, `Intersects`, `IntersectLines`).
 *
 * @param aIgnoreEndpoints don't treat "the end of one segment touches the
 *   other" as an intersection. Used to stop a polyline reporting every one of
 *   its own corners as a self-crossing.
 * @param aLines treat both segments as **infinite lines**. Skips the
 *   bounding-box rejection ("infinite lines can intersect anywhere") and the
 *   `[0, 1]` parameter check, and makes two collinear lines intersect.
 *
 * ## The parts that are load bearing
 *
 * **Exact integer arithmetic.** `determinant`, both parameter numerators and the
 * scaled direction are BigInt, because the determinant of two board-scale
 * vectors is of order 1e16 — already past 2^53, where a double stops
 * representing consecutive integers and the half-away-from-zero correction in
 * `rescale` stops landing where C++ lands it. Inclusion is decided by comparing
 * the numerators *against the determinant* rather than by dividing, so a
 * crossing exactly on a vertex is classified the way KiCad classifies it.
 *
 * **The overflow guard.** An intersection can exist mathematically and still not
 * fit a 32-bit coordinate; upstream answers "no intersection" rather than
 * truncating. Two nearly-parallel lines are exactly the case that produces it.
 *
 * **Collinear lines meet.** In `aLines` mode two collinear lines intersect
 * everywhere, and upstream picks a representative rather than failing: a
 * degenerate `aOther` gives its own start, a degenerate receiver gives *its*
 * start, and otherwise the midpoint of the two starts — through
 * `VECTOR2I::operator/( double )`, which is `KiROUND`, **not** truncation
 * (`vector2d.h:536`). Parallel but not collinear is still null.
 *
 * **Collinear segments meet over their overlap**, via
 * {@link checkCollinearOverlap} — they are not "parallel, therefore no
 * crossing".
 */
export function segIntersect(
  aSeg: Seg,
  aOther: Seg,
  aIgnoreEndpoints = false,
  aLines = false,
): Vec2 | null {
  // Quick rejection on bounding boxes; skipped for infinite lines.
  if (!aLines) {
    if (
      Math.max(aSeg.a.x, aSeg.b.x) < Math.min(aOther.a.x, aOther.b.x) ||
      Math.max(aOther.a.x, aOther.b.x) < Math.min(aSeg.a.x, aSeg.b.x) ||
      Math.max(aSeg.a.y, aSeg.b.y) < Math.min(aOther.a.y, aOther.b.y) ||
      Math.max(aOther.a.y, aOther.b.y) < Math.min(aSeg.a.y, aSeg.b.y)
    ) {
      return null;
    }
  }

  const d1x = big(aSeg.b.x) - big(aSeg.a.x);
  const d1y = big(aSeg.b.y) - big(aSeg.a.y);
  const d2x = big(aOther.b.x) - big(aOther.a.x);
  const d2y = big(aOther.b.y) - big(aOther.a.y);
  const ox = big(aOther.a.x) - big(aSeg.a.x);
  const oy = big(aOther.a.y) - big(aSeg.a.y);

  const determinant = bigCross(d2x, d2y, d1x, d1y);

  if (determinant === 0n) {
    // Parallel but not collinear: no intersection, in either mode.
    if (bigCross(d1x, d1y, ox, oy) !== 0n) return null;

    if (aLines) {
      if (aOther.a.x === aOther.b.x && aOther.a.y === aOther.b.y) {
        return { x: aOther.a.x, y: aOther.a.y };
      }

      if (aSeg.a.x === aSeg.b.x && aSeg.a.y === aSeg.b.y) return { x: aSeg.a.x, y: aSeg.a.y };

      // `( A + aSeg.A ) / 2` — VECTOR2I::operator/( double ), i.e. KiROUND.
      return divideI({ x: aSeg.a.x + aOther.a.x, y: aSeg.a.y + aOther.a.y }, 2);
    }

    // Overlap is measured on whichever axis this segment spans more of.
    const useXAxis = absB(d1x) >= absB(d1y);

    return checkCollinearOverlap(aSeg, aOther, useXAxis, aIgnoreEndpoints);
  }

  // `param2_num = f x ac` (parameter along aOther), `param1_num = e x ac`
  // (parameter along this segment).
  const param2Num = bigCross(d2x, d2y, ox, oy);
  const param1Num = bigCross(d1x, d1y, ox, oy);

  if (!aLines) {
    if (determinant > 0n) {
      if (param1Num < 0n || param1Num > determinant || param2Num < 0n || param2Num > determinant) {
        return null;
      }
    } else if (
      param1Num > 0n ||
      param1Num < determinant ||
      param2Num > 0n ||
      param2Num < determinant
    ) {
      return null;
    }

    if (
      aIgnoreEndpoints &&
      (param1Num === 0n || param1Num === determinant) &&
      (param2Num === 0n || param2Num === determinant)
    ) {
      return null;
    }
  }

  // `intersection = aSeg.A + (q/d) * f`.
  const rx = big(aOther.a.x) + rescale64(param1Num, d2x, determinant);
  const ry = big(aOther.a.y) + rescale64(param1Num, d2y, determinant);

  if (rx > COORD_MAX || rx < COORD_MIN || ry > COORD_MAX || ry < COORD_MIN) return null;

  return { x: num(rx), y: num(ry) };
}

/** `SEG::Intersects( aSeg )` (`seg.h:207`) — `intersects()` for its yes/no only. */
export const segIntersects = (aSeg: Seg, aOther: Seg): boolean =>
  segIntersect(aSeg, aOther) !== null;

/**
 * `SEG::IntersectLines( aSeg )` (`seg.h:220`) — literally
 * `Intersect( aSeg, false, true )`, the crossing of the two **infinite lines**.
 *
 * Written as the delegation upstream writes, so the two cannot drift: a fix to
 * the parallel handling or the overflow guard lands in both at once.
 */
export const segIntersectLines = (aSeg: Seg, aOther: Seg): Vec2 | null =>
  segIntersect(aSeg, aOther, false, true);

/** `SEG::Collinear( aSeg )` (`seg.h:286`): both of `aOther`'s ends within 1 IU
 * of this segment's line, measured through the **unnormalised** canonical
 * coefficients.
 *
 * Unnormalised is the point: the test is `|qa*x + qb*y + qc| <= 1` with `qa`,
 * `qb` the raw coordinate differences, so the tolerance tightens as this
 * segment gets longer. `DP_GATEWAYS::BuildGeneric` relies on that — its probe
 * segments are 200 units long, which makes "collinear" mean "within about
 * 1/200 of a unit of offset", i.e. exactly aligned.
 */
export function segCollinear(aSeg: Seg, aOther: Seg): boolean {
  const qa = big(aSeg.a.y) - big(aSeg.b.y);
  const qb = big(aSeg.b.x) - big(aSeg.a.x);
  const qc = -qa * big(aSeg.a.x) - qb * big(aSeg.a.y);

  const d1 = absB(big(aOther.a.x) * qa + big(aOther.a.y) * qb + qc);
  const d2 = absB(big(aOther.b.x) * qa + big(aOther.b.y) * qb + qc);

  return d1 <= 1n && d2 <= 1n;
}

/**
 * `SEG::NearestPoint( const VECTOR2I& )` (`seg.cpp:633`): the point *on the
 * segment* closest to `aP`, clamped to the ends.
 */
export function segNearestPoint(aSeg: Seg, aP: Vec2): Vec2 {
  const dx = big(aSeg.b.x) - big(aSeg.a.x);
  const dy = big(aSeg.b.y) - big(aSeg.a.y);
  const lSquared = dx * dx + dy * dy;

  if (lSquared === 0n) return { x: aSeg.a.x, y: aSeg.a.y };

  const t = dx * (big(aP.x) - big(aSeg.a.x)) + dy * (big(aP.y) - big(aSeg.a.y));

  if (t < 0n) return { x: aSeg.a.x, y: aSeg.a.y };
  if (t > lSquared) return { x: aSeg.b.x, y: aSeg.b.y };

  return {
    x: num(big(aSeg.a.x) + rescale64(t, dx, lSquared)),
    y: num(big(aSeg.a.y) + rescale64(t, dy, lSquared)),
  };
}

/**
 * `SEG::SquaredDistance( const VECTOR2I& )` (`seg.cpp:714`).
 *
 * The two clamped cases are exact integer arithmetic; the interior case is
 * `|ap|² - e²/f` with the **division done in double** and the result
 * `KiROUND`ed, which is upstream's own arithmetic and not an approximation of
 * it. Upstream's guard against a negative `g` — impossible in exact arithmetic,
 * reachable only through that double — is kept, along with its overflow arm.
 */
export function segSquaredDistanceToPoint(aSeg: Seg, aP: Vec2): number {
  const abx = big(aSeg.b.x) - big(aSeg.a.x);
  const aby = big(aSeg.b.y) - big(aSeg.a.y);
  const apx = big(aP.x) - big(aSeg.a.x);
  const apy = big(aP.y) - big(aSeg.a.y);

  const e = apx * abx + apy * aby;

  if (e <= 0n) return num(apx * apx + apy * apy);

  const f = abx * abx + aby * aby;

  if (e >= f) {
    const bpx = big(aP.x) - big(aSeg.b.x);
    const bpy = big(aP.y) - big(aSeg.b.y);

    return num(bpx * bpx + bpy * bpy);
  }

  const eD = Number(e);
  const g = Number(apx * apx + apy * apy) - (eD * eD) / Number(f);

  // `ECOORD_MAX` is `std::numeric_limits<int64_t>::max()`. Written as `2 ** 63`
  // because that is the double the literal 9223372036854775807 rounds to
  // anyway — the comparison is against int64's ceiling, not against an exactly
  // representable integer.
  if (g < 0 || g > 2 ** 63) return 0;

  return KiROUND(g);
}

/**
 * `SEG::Distance( const VECTOR2I& )` (`seg.cpp:708`):
 * `isqrt( SquaredDistance( aP ) )`.
 *
 * `isqrt` **floors** — it is the largest integer whose square does not exceed
 * the argument. It is not `round( hypot( … ) )`, and the difference is up to a
 * whole IU on every non-square distance: a point at true distance 1.7 is 1 here
 * and 2 under rounding, which is exactly the boundary
 * {@link segContains} sits on.
 */
export const segDistanceToPoint = (aSeg: Seg, aP: Vec2): number =>
  num(isqrt64(BigInt(segSquaredDistanceToPoint(aSeg, aP))));

/**
 * `SEG::Contains( const VECTOR2I& )` (`seg.cpp:627`): `SquaredDistance( aP ) <= 3`.
 *
 * Three square IU, an absolute tolerance rather than a relative one — so a point
 * 1 IU off the line counts as on it and a point 2 IU off does not.
 */
export const segContains = (aSeg: Seg, aP: Vec2): boolean =>
  segSquaredDistanceToPoint(aSeg, aP) <= 3;

/**
 * `SEG::SquaredDistance( const SEG& )` (`seg.cpp:80`).
 *
 * Zero-length segments are handled *first*, before the intersection test:
 * the cross product with a zero vector is always zero, so `Intersects` reports
 * a false positive for a point that is nowhere near the other segment.
 */
export function segSquaredDistanceToSeg(aSeg: Seg, aOther: Seg): number {
  const same = (p: Vec2, q: Vec2): boolean => p.x === q.x && p.y === q.y;

  if (same(aSeg.a, aSeg.b)) return segSquaredDistanceToPoint(aOther, aSeg.a);
  if (same(aOther.a, aOther.b)) return segSquaredDistanceToPoint(aSeg, aOther.a);

  if (segIntersects(aSeg, aOther)) return 0;

  const distSq = (p: Vec2, q: Vec2): number => {
    const dx = big(p.x) - big(q.x);
    const dy = big(p.y) - big(q.y);

    return num(dx * dx + dy * dy);
  };

  return Math.min(
    distSq(segNearestPoint(aOther, aSeg.a), aSeg.a),
    distSq(segNearestPoint(aOther, aSeg.b), aSeg.b),
    distSq(segNearestPoint(aSeg, aOther.a), aOther.a),
    distSq(segNearestPoint(aSeg, aOther.b), aOther.b),
  );
}

/** `SEG::Distance( const SEG& )` (`seg.cpp:702`): `isqrt( SquaredDistance( aSeg ) )`. */
export const segDistance = (aSeg: Seg, aOther: Seg): number =>
  num(isqrt64(BigInt(segSquaredDistanceToSeg(aSeg, aOther))));

/**
 * `SEG::NearestPoint( const SEG& )` (`seg.cpp:120`) — the point *on this
 * segment* closest to `aOther`, and upstream's source for `SHAPE::Collide`'s
 * `aLocation` on every segment pair.
 *
 * The four candidates are the two endpoints of *this* segment and the two
 * projections of `aOther`'s endpoints onto it, so the answer always lies on
 * `aSeg` — swapping the arguments moves the answer, deliberately. The ranking
 * is by how far the *counterpart* point is, and ties keep the earlier candidate
 * because upstream's comparison is a strict `<`.
 *
 * Crossing segments answer with the crossing itself, through
 * {@link segIntersect} — which means the overflow guard there applies: a
 * mathematically-real crossing outside `VECTOR2I`'s range falls through to the
 * four-candidate ranking rather than being reported at a truncated coordinate.
 *
 * Moved here from `pcbnew/src/drc/shape_collisions.ts`, which had it in
 * doubles; that module now re-exports this one.
 */
export function segNearestPointToSeg(aSeg: Seg, aOther: Seg): Vec2 {
  const p = segIntersect(aSeg, aOther);

  if (p !== null) return p;

  const ptsOrigin = [
    segNearestPoint(aOther, aSeg.a),
    segNearestPoint(aOther, aSeg.b),
    segNearestPoint(aSeg, aOther.a),
    segNearestPoint(aSeg, aOther.b),
  ] as const;

  const ptsOut = [aSeg.a, aSeg.b, ptsOrigin[2], ptsOrigin[3]] as const;

  const distSq = (p1: Vec2, p2: Vec2): number => {
    const dx = big(p1.x) - big(p2.x);
    const dy = big(p1.y) - big(p2.y);

    return num(dx * dx + dy * dy);
  };

  const ptsDist = [
    distSq(ptsOrigin[0], aSeg.a),
    distSq(ptsOrigin[1], aSeg.b),
    distSq(ptsOrigin[2], aOther.a),
    distSq(ptsOrigin[3], aOther.b),
  ] as const;

  let minI = 0;

  for (let i = 0; i < 4; i++) {
    if ((ptsDist[i] as number) < (ptsDist[minI] as number)) minI = i;
  }

  const out = ptsOut[minI] as Vec2;

  return { x: out.x, y: out.y };
}

/**
 * `SEG::Collide( const SEG&, int, int* )` (`seg.cpp:542`).
 *
 * Note the two ways this answers true without consulting the clearance at all —
 * an exact crossing, and any endpoint whose distance to the other segment is
 * exactly zero. Both are upstream's, and both mean two touching segments
 * collide even at zero clearance. A *negative* clearance, however, is rejected
 * outright before any of that, which is why the `clearance - 1` arithmetic in
 * `PNS::ITEM::collideSimple` can turn a touching pair into a miss.
 *
 * `aActual` is written on **every** path, including the false return
 * (`seg.cpp:620`), so it is returned as a plain field rather than modelled as
 * an optional out-parameter: there is no path on which upstream leaves the
 * caller's `int` alone.
 *
 * The distances are `SEG::Distance`/`SEG::SquaredDistance`, i.e. exact integer
 * arithmetic with a **flooring** `isqrt` — `actual` is the largest integer
 * whose square does not exceed the squared distance, never a rounded one.
 *
 * Moved here from `pcbnew/src/drc/shape_collisions.ts`, which had it in
 * doubles; that module now re-exports this one.
 */
export function segCollide(
  aSeg: Seg,
  aOther: Seg,
  aClearance: number,
): { collides: boolean; actual: number } {
  if (aClearance < 0) return { collides: false, actual: 0 };

  const same = (p: Vec2, q: Vec2): boolean => p.x === q.x && p.y === q.y;

  // Zero-length segments (points) are handled specially: the cross product with
  // a zero vector is always zero, which would be a false positive below.
  if (same(aSeg.a, aSeg.b)) {
    const dist = segDistanceToPoint(aOther, aSeg.a);

    return { collides: dist === 0 || dist < aClearance, actual: dist };
  }

  if (same(aOther.a, aOther.b)) {
    const dist = segDistanceToPoint(aSeg, aOther.a);

    return { collides: dist === 0 || dist < aClearance, actual: dist };
  }

  if (segIntersect(aSeg, aOther) !== null) return { collides: true, actual: 0 };

  const clearanceSq = aClearance * aClearance;
  let minDistSq = Number.POSITIVE_INFINITY;

  for (const d of [
    segSquaredDistanceToPoint(aSeg, aOther.a),
    segSquaredDistanceToPoint(aSeg, aOther.b),
    segSquaredDistanceToPoint(aOther, aSeg.a),
    segSquaredDistanceToPoint(aOther, aSeg.b),
  ]) {
    // upstream's `checkDistance`: an exact zero short-circuits the whole thing.
    if (d === 0) return { collides: true, actual: 0 };

    minDistSq = Math.min(minDistSq, d);
  }

  return {
    collides: minDistSq < clearanceSq,
    actual: num(isqrt64(BigInt(minDistSq))),
  };
}
