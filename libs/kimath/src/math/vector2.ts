// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * VECTOR2I, the integer 2D vector KiCad uses for board coordinates
 * (libs/kimath/include/math/vector2.h). KiCad's VECTOR2<T> is a rich template;
 * this port provides the mutable {x,y} struct plus the operations the pcbnew
 * classes actually call. Coordinates are internal units (nanometres in KiCad;
 * see units.ts for our IU).
 */

import { hypot } from './libm.js';
import { INT_MAX, INT_MIN, KiROUND, rescale64, toInt } from './util.js';

/** 2D point/vector in integer internal units (100 nm). Immutable variant. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface VECTOR2I {
  x: number;
  y: number;
}

// `+ 0` folds a `-0` (the negation of an int 0 in double arithmetic) into the
// int's only zero, so that a rotated (0, 0) compares equal to (0, 0).
export const VECTOR2I = (x = 0, y = 0): VECTOR2I => ({ x: x + 0, y: y + 0 });

export const add = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });

/**
 * `VECTOR2<int>( const VECTOR2<double>& )`: the casting constructor, which
 * `static_cast`s each coordinate — truncation toward zero, not rounding —
 * after clamping to the int range.
 */
export const toVECTOR2I = (v: VECTOR2I): VECTOR2I => ({
  x: toInt(Math.min(Math.max(v.x, INT_MIN), INT_MAX)),
  y: toInt(Math.min(Math.max(v.y, INT_MIN), INT_MAX)),
});
export const sub = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });
export const equal = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

/** Euclidean length (KiCad VECTOR2::EuclideanNorm). */
export const EuclideanNorm = (v: VECTOR2I): number => Math.hypot(v.x, v.y);
/** Squared length (KiCad VECTOR2::SquaredEuclideanNorm). */
export const SquaredEuclideanNorm = (v: VECTOR2I): number => v.x * v.x + v.y * v.y;
/** Distance between two points (KiCad VECTOR2::Distance). */
export const Distance = (a: VECTOR2I, b: VECTOR2I): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * `VECTOR2<int>::EuclideanNorm`, the *integer* instantiation.
 *
 * `EuclideanNorm` above is the floating-point one. This is not that value
 * rounded at the call site: the rounding is `KiROUND`, halves away from zero,
 * where `Math.round` would take halves towards +infinity. Callers that divide
 * the result by a fixed step to decide how many samples to take see the
 * difference as a whole extra sample.
 *
 * The three short-circuits are upstream's; the 45° one is written as `|x|·√2`
 * rather than a hypot. No integer input has been found where the two disagree
 * after rounding, so it is kept for shape rather than for arithmetic — but it
 * is upstream's shape, and dropping it would be a divergence to re-derive
 * rather than one to read.
 */
export const EuclideanNormI = (v: VECTOR2I): number => {
  // 45° are common in KiCad, so upstream optimises the calculation.
  if (Math.abs(v.x) === Math.abs(v.y)) return KiROUND(Math.abs(v.x) * Math.SQRT2);
  if (v.x === 0) return Math.abs(v.y);
  if (v.y === 0) return Math.abs(v.x);
  return KiROUND(hypot(v.x, v.y));
};

/**
 * `VECTOR2<int>::operator/(double)`: divide per component and **round**.
 *
 * Deliberately not truncation. A step vector built this way can overshoot the
 * far end of the segment it subdivides, where a truncating one would always
 * undershoot — different points get sampled.
 */
export const divideI = (v: VECTOR2I, factor: number): VECTOR2I => ({
  x: KiROUND(v.x / factor),
  y: KiROUND(v.y / factor),
});

/** `VECTOR2::Perpendicular`: rotated a quarter turn, `(-y, x)`. */
export const Perpendicular = (v: VECTOR2I): VECTOR2I => ({ x: -v.y, y: v.x });

/** `sign`: -1, 0 or +1. Upstream's `(T(0) < val) - (val < T(0))`. */
const sgn = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

/**
 * `VECTOR2<int>::Resize`: the same direction, the given length.
 *
 * This is the **integer** instantiation, transcribed rather than simplified. It
 * is not `v * (len / |v|)` rounded: upstream computes each component as
 * `sqrt( rescale( len², x², l² ) )` and re-applies the component's sign, with
 * the intermediate rounded to an integer *before* the square root. The two
 * agree to within a unit almost everywhere and disagree on exactly the inputs
 * the router feeds it — a gap vector is resized once per differential-pair
 * gateway, and a one-unit difference in an anchor is a different anchor.
 *
 * There is an existing `resize` in `pcbnew/src/router/pns_hull.ts` and another
 * in `drc/shape_collisions.ts`; both are the floating-point shortcut and say
 * so. They are left alone — their callers only rank candidates.
 *
 * `len²·x²` reaches ~1e30 for metre-scale coordinates, far past 2^53, so the
 * product and the rounding division are done in BigInt. The quotient is bounded
 * by `len²`, which converts back exactly for the square root.
 *
 * Two upstream behaviours worth naming: a zero vector stays zero, and
 * `sign( aNewLength )` is a *factor*, so resizing to length 0 gives `(0, 0)`
 * and resizing to a negative length flips the direction.
 */
export const ResizeI = (v: VECTOR2I, aNewLengthIn: number): VECTOR2I => {
  if (v.x === 0 && v.y === 0) return { x: 0, y: 0 };

  // `Resize( T aNewLength )` with `T = int32_t`: a caller passing a double -
  // `PCB_MARKER` passes `2.5 * MarkerScale()` (pcb_marker.cpp:410) - has it
  // narrowed by the language, before any of the arithmetic below. Here the
  // parameter is a `number` and nothing narrows it, so the fraction survived
  // as far as `BigInt( aNewLength )`, which THROWS on one: "The number
  // 216617.9301680271 cannot be converted to a BigInt". That exception came
  // out of `EDA_DRAW_PANEL_GAL::DoRePaint` and left the whole board unpainted
  // for as long as the marker stayed selected.
  const aNewLength = toInt(aNewLengthIn);

  let newX: number;
  let newY: number;

  if (Math.abs(v.x) === Math.abs(v.y)) {
    newX = Math.abs(aNewLength) * Math.SQRT1_2;
    newY = newX;
  } else {
    const xSq = BigInt(v.x) * BigInt(v.x);
    const ySq = BigInt(v.y) * BigInt(v.y);
    const lSq = xSq + ySq;
    const newLengthSq = BigInt(aNewLength) * BigInt(aNewLength);

    newX = Math.sqrt(Number(rescale64(newLengthSq, xSq, lSq)));
    newY = Math.sqrt(Number(rescale64(newLengthSq, ySq, lSq)));
  }

  const s = sgn(aNewLength);

  // `|| 0` only normalises JavaScript's negative zero, which `-KiROUND(0)` and
  // `* 0` both produce and which compares unequal under a structural assert.
  return {
    x: (v.x < 0 ? -KiROUND(newX) : KiROUND(newX)) * s || 0,
    y: (v.y < 0 ? -KiROUND(newY) : KiROUND(newY)) * s || 0,
  };
};

/**
 * `VECTOR2I::ECOORD_MAX`, the `int64` sentinel the geometry starts a
 * "closest so far" search from. `2^63 - 1` is not a double, and every use is
 * a `<` comparison against a real squared distance (which fits 2^53), so the
 * largest exact integer serves.
 */
export const ECOORD_MAX = Number.MAX_SAFE_INTEGER;

/**
 * `VECTOR2<double>::Resize`: the same direction, the given length, with the
 * 45-degree short-circuit and the `sign( aNewLength )` factor of the template.
 * `rescale< double >` is a plain `a * b / c`.
 */
export const ResizeD = (v: Vec2, aNewLength: number): Vec2 => {
  if (v.x === 0 && v.y === 0) return { x: 0, y: 0 };

  let newX: number;
  let newY: number;

  if (Math.abs(v.x) === Math.abs(v.y)) {
    newX = newY = Math.abs(aNewLength) * Math.SQRT1_2;
  } else {
    const x_sq = v.x * v.x;
    const y_sq = v.y * v.y;
    const l_sq = x_sq + y_sq;
    const newLength_sq = aNewLength * aNewLength;
    newX = Math.sqrt((newLength_sq * x_sq) / l_sq);
    newY = Math.sqrt((newLength_sq * y_sq) / l_sq);
  }

  const s = sgn(aNewLength);

  return { x: (v.x < 0 ? -newX : newX) * s || 0, y: (v.y < 0 ? -newY : newY) * s || 0 };
};

/** `LexicographicalCompare( aA, aB )`: x first, then y; -1, 0 or 1. */
export function LexicographicalCompare(aA: Vec2, aB: Vec2): number {
  if (aA.x < aB.x) return -1;
  else if (aA.x > aB.x) return 1;
  else {
    // aA.x == aB.x
    if (aA.y < aB.y) return -1;
    else if (aA.y > aB.y) return 1;
    else return 0;
  }
}
