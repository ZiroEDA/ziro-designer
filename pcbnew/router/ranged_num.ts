// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A number with an asymmetric tolerance band.
 * Counterpart: `pcbnew/router/ranged_num.h` (`RANGED_NUM<T>`).
 *
 * The router uses exactly one of these, `DIFF_PAIR::m_gapConstraint`, and it is
 * the reason a coupled pair is allowed to wander: `Matches` is what decides
 * whether two segments are running "at the gap" or merely near each other.
 *
 * Two upstream details that a reimplementation would quietly lose:
 *
 *  - `operator T()` yields the **value**, so passing a `RANGED_NUM` where an
 *    `int` is wanted (which `DIFF_PAIR::BuildInitial` does, handing it to
 *    `checkGap`) silently drops the tolerances. {@link RangedNum.value} is that
 *    conversion, spelled out.
 *  - `operator=( T )` assigns the value and **leaves the tolerances alone**, so
 *    `DIFF_PAIR( aGap )`'s `m_gapConstraint = aGap` produces a band of zero
 *    width around `aGap`, while `SetGap` replaces the whole object with a
 *    ±10000 band. The two constructions are not interchangeable and the
 *    difference is observable in `CoupledSegmentPairs`.
 *
 * Immutable here rather than assignable: every upstream mutation is one of the
 * two forms above, and both are expressible as building a new one.
 */

/** `RANGED_NUM<T>`, instantiated at `int` — the only instantiation upstream has. */
export class RangedNum {
  readonly value: number;
  readonly tolerancePlus: number;
  readonly toleranceMinus: number;

  constructor(aValue = 0, aTolerancePlus = 0, aToleranceMinus = 0) {
    this.value = aValue;
    this.tolerancePlus = aTolerancePlus;
    this.toleranceMinus = aToleranceMinus;
  }

  /** `operator=( const T aValue )`: a new value, the same (usually zero) band. */
  withValue(aValue: number): RangedNum {
    return new RangedNum(aValue, this.tolerancePlus, this.toleranceMinus);
  }

  /** `Matches`: inclusive at both ends. */
  matches(aOther: number): boolean {
    return aOther >= this.value - this.toleranceMinus && aOther <= this.value + this.tolerancePlus;
  }
}
