// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `printf("%g")`, which is how `pcb_calculator` writes almost every number it
 * puts back into a field (`txt.Printf( wxT( "%g" ), … )`, e.g.
 * `calculator_panels/panel_regulator.cpp:500-537`).
 *
 * JavaScript's `String(Number)` is NOT the same function and diverges exactly
 * where an engineer notices: `String(1e6)` is `"1000000"` where `%g` writes
 * `"1e+06"`, and `String(1.2345678)` keeps every digit where `%g` stops at six
 * significant figures. Matching KiCad's displayed text means implementing C's
 * rule, not approximating it.
 *
 * C99 7.21.6.1: with precision P (default 6, and P = 1 if 0 is given), let X be
 * the decimal exponent of the value rounded to P significant digits. If
 * P > X >= -4 the style is `%f` with precision P - 1 - X; otherwise the style is
 * `%e` with precision P - 1. In both cases trailing zeros are removed from the
 * fractional part, and the point goes with them if nothing follows it. The `%e`
 * exponent carries a sign and at least two digits.
 */

/** C's `printf("%g", value)` with the given precision (C's default is 6). */
export function printfG(value: number, precision = 6): string {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';

  const p = precision === 0 ? 1 : precision;

  if (value === 0) return '0';

  // Exponent of the value AFTER rounding to p significant digits — rounding
  // 9.9999e2 at p=3 gives 1.00e3, which changes the style C picks.
  const exp = Number(
    Math.abs(value)
      .toExponential(p - 1)
      .split('e')[1],
  );

  if (exp < -4 || exp >= p) {
    const [mantissa, e] = value.toExponential(p - 1).split('e');
    const sign = e!.startsWith('-') ? '-' : '+';
    const digits = e!.replace(/^[+-]/, '').padStart(2, '0');
    return `${trimZeros(mantissa!)}e${sign}${digits}`;
  }

  return trimZeros(value.toFixed(Math.max(0, p - 1 - exp)));
}

/** Drop trailing fractional zeros, and the decimal point if it is left bare. */
function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}
