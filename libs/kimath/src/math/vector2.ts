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

import { KiROUND } from './util.js';

/** 2D point/vector in integer internal units (100 nm). Immutable variant. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface VECTOR2I {
  x: number;
  y: number;
}

export const VECTOR2I = (x = 0, y = 0): VECTOR2I => ({ x, y });

export const add = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
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
  return KiROUND(Math.hypot(v.x, v.y));
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
