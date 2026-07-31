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
