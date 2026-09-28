// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `libs/core/include/core/minoptmax.h`: `MINOPTMAX<T>`, a min/opt/max triple where any of the three may be unset. */

/** `std::numeric_limits<int>::max()`, the `Max()` of a triple with no max. */
const INT_MAX = 2147483647;

export class MINOPTMAX {
  private m_isNull = true;
  private m_min = 0;
  private m_opt = 0;
  private m_max = 0;
  private m_hasMin = false;
  private m_hasOpt = false;
  private m_hasMax = false;

  Min(): number {
    return this.m_hasMin ? this.m_min : 0;
  }
  Max(): number {
    return this.m_hasMax ? this.m_max : INT_MAX;
  }
  Opt(): number {
    return this.m_hasOpt ? this.m_opt : this.Min();
  }

  HasMin(): boolean {
    return this.m_hasMin;
  }
  HasMax(): boolean {
    return this.m_hasMax;
  }
  HasOpt(): boolean {
    return this.m_hasOpt;
  }

  SetMin(v: number): void {
    this.m_isNull = false;
    this.m_min = v;
    this.m_hasMin = true;
  }
  SetMax(v: number): void {
    this.m_isNull = false;
    this.m_max = v;
    this.m_hasMax = true;
  }
  SetOpt(v: number): void {
    this.m_isNull = false;
    this.m_opt = v;
    this.m_hasOpt = true;
  }

  IsNull(): boolean {
    return this.m_isNull;
  }

  /** A copy, as the C++ struct copies by value. */
  Clone(): MINOPTMAX {
    const c = new MINOPTMAX();
    c.m_isNull = this.m_isNull;
    c.m_min = this.m_min;
    c.m_opt = this.m_opt;
    c.m_max = this.m_max;
    c.m_hasMin = this.m_hasMin;
    c.m_hasOpt = this.m_hasOpt;
    c.m_hasMax = this.m_hasMax;
    return c;
  }
}
