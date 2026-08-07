// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `SEG` members the meander geometry works in.
 * Counterparts: `libs/kimath/include/geometry/seg.h` (`Length`,
 * `SquaredLength`) and `libs/kimath/src/geometry/seg.cpp` (`LineProject`,
 * `ReflectPoint`, `Contains`, `ApproxParallel`, `mutualDistanceSquared`), plus
 * the `int64_t` specialisation of `rescale` from `libs/kimath/src/math/util.cpp`.
 *
 * ## Free functions over the existing `Seg`, not a new class
 *
 * `Seg` is already `{ a, b }` in `pns_line.ts` and the whole router works on it
 * that way. Upstream's `SEG` is a struct with methods; the members that matter
 * here are pure, so they are pure functions. Nothing about the arithmetic
 * changes.
 *
 * ## Why BigInt, and what that claim is and is not
 *
 * Upstream computes `LineProject`, `ReflectPoint` and `mutualDistanceSquared`
 * in `ecoord` (int64) and *only* in int64. `l_squared = d.Dot( d )` for a
 * segment 10 cm long at 1e6 IU/mm is 1e16, already past 2^53;
 * `rescale( t, d.x, l_squared )` forms `t * d.x` on top of that, order 1e24;
 * and `mutualDistanceSquared` squares a determinant, order 1e36. Past 2^53 a
 * double no longer represents consecutive integers, so neither the truncating
 * division nor the `± l/2` half-away-from-zero correction that `rescale`
 * depends on is *guaranteed* to land where C++ lands it.
 *
 * The honest strength of the claim: a plain-double implementation of these
 * three functions agreed with this one on every case tried, including
 * adversarially near-parallel segments 400 mm long, because the quantities
 * being *returned* are coordinates of order 1e8 and a double's relative
 * precision leaves the absolute error around 1e-8 IU. What doubles cannot
 * promise is the tie-break — a quotient landing exactly on a half — and the
 * exactness of `l / 2` for an odd `l`. That, plus matching upstream's stated
 * arithmetic rather than an arithmetic that happens to agree, is the whole
 * reason. `libs/kimath/src/geometry/seg.ts` made the same choice for
 * `ApproxCollinear`, where the cancellation genuinely is catastrophic; this
 * follows it for consistency rather than out of a demonstrated failure.
 *
 * The inputs are board coordinates, which are integers by construction, but a
 * `Vec2` that has been through a floating-point transform can carry a fraction,
 * so every value entering BigInt goes through `KiROUND` first — exactly as
 * `seg.ts` does, and for the same reason (`BigInt()` throws on a fraction).
 */
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Seg } from './pns_line.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const big = (v: number): bigint => BigInt(KiROUND(v));

/** `-0` reads as a different value to `0` in a deep-equality assertion. */
const noNegZero = (v: number): number => (v === 0 ? 0 : v);

/** A number back out of BigInt. Board coordinates fit a double exactly. */
const num = (v: bigint): number => noNegZero(Number(v));

/**
 * `rescale< int64_t >( a, b, d )` (math/util.cpp): `(a*b ± d/2) / d`, rounding
 * half **away from zero**, with the sign of the correction following
 * `(numerator < 0) ^ (denominator < 0)`.
 *
 * `d / 2` is itself a truncating integer division, which is why the rounding is
 * not exactly half for an odd denominator. BigInt `/` truncates toward zero,
 * matching C++.
 */
export function rescale64(aNumerator: bigint, aValue: bigint, aDenominator: bigint): bigint {
  const numerator = aNumerator * aValue;
  const half = aDenominator / 2n;

  return numerator < 0n !== aDenominator < 0n
    ? (numerator - half) / aDenominator
    : (numerator + half) / aDenominator;
}

/** `SEG::SquaredLength`. */
export const segSquaredLength = (aSeg: Seg): number => {
  const dx = aSeg.a.x - aSeg.b.x;
  const dy = aSeg.a.y - aSeg.b.y;

  return dx * dx + dy * dy;
};

/**
 * `SEG::Length`: `( A - B ).EuclideanNorm()` returned as an `int`.
 *
 * The C++ return type is `int`, so the double norm is **truncated**, not
 * rounded. A base segment of 999.9 IU measures 999.
 */
export const segLength = (aSeg: Seg): number =>
  noNegZero(Math.trunc(Math.hypot(aSeg.a.x - aSeg.b.x, aSeg.a.y - aSeg.b.y)));

/**
 * `SEG::LineProject`: the foot of the perpendicular from `aP` onto the
 * segment's **infinite** line.
 *
 * A zero-length segment has no line, and upstream answers `A` rather than
 * dividing by zero.
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
 * `SEG::ReflectPoint`: `aP` mirrored across the segment's infinite line.
 *
 * Note it is *not* `2 * LineProject( aP ) - aP` written out: upstream reflects
 * a zero-length segment by taking the foot as `aP` itself, so the point comes
 * back unchanged rather than being flipped about `A`.
 */
export function segReflectPoint(aSeg: Seg, aP: Vec2): Vec2 {
  const dx = big(aSeg.b.x) - big(aSeg.a.x);
  const dy = big(aSeg.b.y) - big(aSeg.a.y);
  const lSquared = dx * dx + dy * dy;

  let cx: bigint;
  let cy: bigint;

  if (lSquared === 0n) {
    cx = big(aP.x);
    cy = big(aP.y);
  } else {
    const t = dx * (big(aP.x) - big(aSeg.a.x)) + dy * (big(aP.y) - big(aSeg.a.y));
    cx = big(aSeg.a.x) + rescale64(t, dx, lSquared);
    cy = big(aSeg.a.y) + rescale64(t, dy, lSquared);
  }

  return { x: num(2n * cx - big(aP.x)), y: num(2n * cy - big(aP.y)) };
}

/**
 * `SEG::Contains( const VECTOR2I& )`: `SquaredDistance( aP ) <= 3`.
 *
 * Three square IU, an absolute tolerance rather than a relative one — so a
 * point 1 IU off the line counts as on it and a point 2 IU off does not.
 */
export function segContains(aSeg: Seg, aP: Vec2): boolean {
  return segSquaredDistanceToPointExact(aSeg, aP) <= 3;
}

/**
 * `SEG::SquaredDistance( const VECTOR2I& )` (seg.cpp:710).
 *
 * The two clamped cases are exact integer arithmetic; the interior case is
 * `|ap|² - e²/f` with the **division done in double** and the result
 * `KiROUND`ed, which is upstream's own arithmetic and not an approximation of
 * it. Upstream's guard against a negative `g` — impossible in exact arithmetic,
 * reachable only through that double — is kept, along with its overflow arm.
 */
export function segSquaredDistanceToPointExact(aSeg: Seg, aP: Vec2): number {
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
 * `SEG::mutualDistanceSquared`: the two *signed* squared distances from the
 * shorter segment's endpoints to the longer segment's line, or `null` when the
 * longer segment is degenerate and defines no line.
 *
 * The longer segment supplies the line; ties keep `this`, because upstream
 * swaps only on a strict `<`.
 */
function mutualDistanceSquared(aA: Seg, aB: Seg): { d1: bigint; d2: bigint } | null {
  let a = aA;
  let b = aB;

  if (segSquaredLength(a) < segSquaredLength(b)) {
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
 * `SEG::ApproxParallel`: the two endpoints of the shorter segment sit at
 * (near enough) the *same signed* distance from the longer one's line.
 *
 * Signed is what makes this "parallel" rather than "collinear or crossing": a
 * segment that crosses the other's line has endpoints at equal magnitude but
 * opposite sign when it crosses at its midpoint, and the subtraction then gives
 * twice the distance rather than zero.
 *
 * A degenerate longer segment answers false.
 */
export function segApproxParallel(aA: Seg, aB: Seg, aDistanceThreshold = 1): boolean {
  const d = mutualDistanceSquared(aA, aB);

  if (!d) return false;

  const diff = d.d1 - d.d2;
  const abs = diff < 0n ? -diff : diff;

  return abs <= big(aDistanceThreshold) * big(aDistanceThreshold);
}
