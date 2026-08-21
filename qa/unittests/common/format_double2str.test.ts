// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FormatDouble2Str` — `common/string_utils.cpp:1446-1473` — which is how KiCad
 * writes a bare double into an s-expression.
 *
 * Three different approximations of it had grown here and none matched, nor did
 * they match each other:
 *
 *   - the drawing sheet's `toFixed(6)` (`drawing_sheet/write.ts`);
 *   - `net_chains`'s `String(Number(v.toPrecision(10)))`;
 *   - `write-footprint`'s `toFixed(10)` — which is `%.10f`, not `%.10g`.
 *
 * Replacing all three with one port moved **zero** existing expectations, which
 * is the finding: nothing anywhere pinned the number format of a file another
 * tool opens.
 *
 * THE EXPECTATIONS ARE NOT DERIVED FROM OUR CODE. Every string below came out
 * of a C program that runs the C++ function's own body —
 * `snprintf("%.16f")` with the trailing-zero trim, else `snprintf("%.10g")`,
 * `fmt`'s `{:.16f}` / `{:.10g}` being printf's — compiled and run on this
 * machine. Re-deriving them any other way, in particular by printing what our
 * implementation returns, would make this file unable to fail.
 */
import { describe, expect, it } from 'vitest';
import { formatDouble2Str } from '@ziroeda/common/src/plotters/fmt.js';

describe('the %.10g branch', () => {
  it('keeps ten significant digits, not ten decimal places', () => {
    // The distinction `write-footprint`'s toFixed(10) got wrong.
    expect(formatDouble2Str(12345.6789012)).toBe('12345.6789');
    expect(formatDouble2Str(1 / 3)).toBe('0.3333333333');
  });

  it('switches to exponent form once the exponent reaches the precision', () => {
    // `%g` uses `%e` when the decimal exponent is < -4 or >= 10. This is what
    // `toPrecision(10)` piped through Number() never does.
    expect(formatDouble2Str(1e12)).toBe('1e+12');
    expect(formatDouble2Str(1234567890123)).toBe('1.23456789e+12');
  });

  it('trims trailing zeros and takes the exponent after rounding', () => {
    expect(formatDouble2Str(1.5)).toBe('1.5');
    expect(formatDouble2Str(10)).toBe('10');
    expect(formatDouble2Str(297)).toBe('297');
    expect(formatDouble2Str(0.1)).toBe('0.1');
    // 9.9999999999 rounds up into the next decade at ten digits.
    expect(formatDouble2Str(9.9999999999)).toBe('10');
  });

  it('sends exact zero down this branch, sign and all', () => {
    // `aValue != 0.0` is false for -0.0 too, so both take %g.
    expect(formatDouble2Str(0)).toBe('0');
    expect(formatDouble2Str(-0)).toBe('-0');
  });
});

describe('the |v| <= 0.0001 branch', () => {
  it('writes sixteen fixed places rather than an exponent', () => {
    // This is the whole reason the branch exists: %.10g would print 1e-08.
    expect(formatDouble2Str(1e-8)).toBe('0.00000001');
    expect(formatDouble2Str(-0.00005)).toBe('-0.00005');
  });

  it('takes the boundary on the absolute value', () => {
    expect(formatDouble2Str(0.0001)).toBe('0.0001');
    expect(formatDouble2Str(0.00011)).toBe('0.00011');
    expect(formatDouble2Str(-0.0001)).toBe('-0.0001');
  });

  /*
   * NO TEST DISTINGUISHES `<= 0.0001` FROM `< 0.0001`, AND NONE CAN.
   *
   * Mutating the comparison survives this file, which normally means the test
   * is too weak. Here it means the mutant is equivalent, and that was checked
   * rather than assumed: 0.0001 is the only input the two comparisons route
   * differently, and at exactly 0.0001 both branches produce the same string —
   * `%.16f` gives "0.0001000000000000", which the trim reduces to "0.0001",
   * and `%.10g` gives "0.0001" directly. Running the C++ body both ways over
   * the whole probe set produced byte-identical output.
   *
   * So the `<=` is kept because that is what `string_utils.cpp:1450` says, not
   * because anything observable depends on it. Do not invent a test for it.
   */

  it('collapses a value below the sixteenth place to a bare zero', () => {
    // "0.0000000000000000" loses every zero, then the point. KiCad prints "0"
    // here as well — the trim is not guarded against emptying the fraction.
    expect(formatDouble2Str(1e-20)).toBe('0');
  });
});

describe('the drawing sheet writes through it', () => {
  it('no longer rounds a small value to a flat zero', async () => {
    const { serializeDrawingSheet, defaultDrawingSheet } = await import(
      '@ziroeda/common/src/drawing_sheet/index.js'
    );
    const sheet = defaultDrawingSheet();
    // A pen width below 1e-7: toFixed(6) wrote `0`, which reads back as "use
    // the default" and is a different sheet.
    sheet.setup.lineWidth = 1e-8;
    const out = serializeDrawingSheet(sheet);
    expect(out).toContain('(linewidth 0.00000001)');
    expect(out).not.toContain('(linewidth 0)');
  });
});
