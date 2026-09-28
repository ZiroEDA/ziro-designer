// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/excellon_defaults.h`: the values a drill file is read with when it
 * does not state them itself. "Some important parameters are not defined in
 * drill files, and some others can be missing in poor drill files."
 *
 * Preferences > Gerber Viewer > Excellon Options edits all six;
 * `GERBVIEW_SETTINGS::GetExcellonDefaults` hands them to
 * `EXCELLON_IMAGE::LoadFile`.
 */

/** Number of digits in mantissa, mm. [data] */
export const FMT_MANTISSA_MM = 3;
/** Number of digits in mantissa, inch. [data] */
export const FMT_MANTISSA_INCH = 4;
/** Number of digits, integer part, mm. [data] */
export const FMT_INTEGER_MM = 3;
/** Number of digits, integer part, inch. [data] */
export const FMT_INTEGER_INCH = 2;

/** `EXCELLON_DEFAULTS`. */
export class EXCELLON_DEFAULTS {
  /** false = inch, true = mm. */
  m_UnitsMM = false;
  /** True = LZ false = TZ. */
  m_LeadingZero = true;
  /** Number of digits for the integer part of a coordinate in mm. */
  m_MmIntegerLen = FMT_INTEGER_MM;
  /** Number of digits for the mantissa part of a coordinate in mm. */
  m_MmMantissaLen = FMT_MANTISSA_MM;
  /** Number of digits for the integer part of a coordinate in inch. */
  m_InchIntegerLen = FMT_INTEGER_INCH;
  /** Number of digits for the mantissa part of a coordinate in inch. */
  m_InchMantissaLen = FMT_MANTISSA_INCH;

  constructor() {
    this.ResetToDefaults();
  }

  ResetToDefaults(): void {
    this.m_UnitsMM = false;
    this.m_LeadingZero = true;
    this.m_MmIntegerLen = FMT_INTEGER_MM;
    this.m_MmMantissaLen = FMT_MANTISSA_MM;
    this.m_InchIntegerLen = FMT_INTEGER_INCH;
    this.m_InchMantissaLen = FMT_MANTISSA_INCH;
  }
}
