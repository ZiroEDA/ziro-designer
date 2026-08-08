// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Small numeric helpers. Counterpart: `libs/kimath/include/math/util.h`.
 */

/**
 * KiROUND: round to nearest, halves away from zero.
 *
 * Not `Math.round`, which rounds halves toward +infinity and so disagrees on
 * every negative coordinate ending in .5 — the kind of one-IU divergence that
 * makes a ported polygon miscompare against KiCad's.
 */
export const KiROUND = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

/** rescale( n, v, d ) = n * v / d, rounded like KiROUND. */
export const rescale = (numerator: number, value: number, denominator: number): number =>
  KiROUND((numerator * value) / denominator);

/**
 * `rescale< int64_t >( a, b, d )` (`math/util.cpp`): `(a*b ± d/2) / d`, rounding
 * half **away from zero**, with the sign of the correction following
 * `(numerator < 0) ^ (denominator < 0)`.
 *
 * The `__int128_t` arm is the one transcribed, because it is the one every
 * non-MSVC build takes and the only one whose arithmetic is stated rather than
 * assembled. The two fallbacks compute the same quantity by long multiplication
 * and by bitwise long division respectively; BigInt gives it directly.
 *
 * `d / 2` is itself a truncating integer division, which is why the rounding is
 * not exactly half for an odd denominator, and BigInt `/` truncates toward zero
 * exactly as C++ does.
 *
 * Distinct from {@link rescale}, which is the `double` form: that one rounds
 * through `KiROUND` after a floating divide, and past 2^53 it no longer
 * represents consecutive integers. Anything feeding a coordinate through a
 * determinant needs this one.
 */
export function rescale64(aNumerator: bigint, aValue: bigint, aDenominator: bigint): bigint {
  const numerator = aNumerator * aValue;
  const half = aDenominator / 2n;

  return numerator < 0n !== aDenominator < 0n
    ? (numerator - half) / aDenominator
    : (numerator + half) / aDenominator;
}
