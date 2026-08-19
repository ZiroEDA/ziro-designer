// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `printfG` against C's `printf("%g")`.
 *
 * The expectations are the output of the real C library on this machine:
 *
 *   printf '%g %g %g %g %g %g %g %g\n' 5 0.24 1e6 123456 1234567 0.0001 \
 *          0.00001 1.2345678
 *   -> 5 0.24 1e+06 123456 1.23457e+06 0.0001 1e-05 1.23457
 *
 * `String(Number)` — what the panels used before — agrees on the first two and
 * on nothing else, which is exactly the range an engineer types into a
 * calculator.
 */
import { printfF, printfG } from '@ziroeda/pcb_calculator';
import { describe, expect, it } from 'vitest';

describe('printfG is C printf %g', () => {
  const cases: [number, string][] = [
    [5, '5'],
    [0, '0'],
    [0.24, '0.24'],
    [0.242, '0.242'],
    [5.313, '5.313'],
    [-5.39, '-5.39'],
    // %f style while -4 <= exp < 6, six significant digits, zeros trimmed
    [123456, '123456'],
    [0.0001, '0.0001'],
    [1.2345678, '1.23457'],
    [1.5, '1.5'],
    [100, '100'],
    // %e style outside that window, exponent signed and at least two digits
    [1e6, '1e+06'],
    [1234567, '1.23457e+06'],
    [0.00001, '1e-05'],
    [-1e6, '-1e+06'],
    [1e100, '1e+100'],
    [1.5e-7, '1.5e-07'],
  ];

  for (const [v, want] of cases) {
    it(`${v} -> ${want}`, () => {
      expect(printfG(v)).toBe(want);
    });
  }

  it('switches style on the ROUNDED exponent, as C99 7.21.6.1 specifies', () => {
    // 999999.5 rounds to 1000000 at six significant digits, whose exponent is
    // 6, so C picks %e even though the unrounded value's exponent is 5.
    expect(printfG(999999.5)).toBe('1e+06');
  });

  it('honours an explicit precision, and treats 0 as 1', () => {
    expect(printfG(1.2345678, 3)).toBe('1.23');
    expect(printfG(1.2345678, 0)).toBe('1');
    expect(printfG(12345, 3)).toBe('1.23e+04');
  });

  it('names the non-finite values the way the C library does', () => {
    expect(printfG(Number.NaN)).toBe('nan');
    expect(printfG(Number.POSITIVE_INFINITY)).toBe('inf');
    expect(printfG(Number.NEGATIVE_INFINITY)).toBe('-inf');
  });
});

/**
 * `printfF` is C's `%f`: fixed notation, `precision` decimals, no trimming.
 * The Fusing Current page is the one that uses it, which is why that page reads
 * `0.100000` and `10.000000` where every other page reads `0.1` and `10`.
 *
 *   printf '%f %f %f %f\n' 0.1 10 0.01 0.089133
 *   -> 0.100000 10.000000 0.010000 0.089133
 */
describe('printfF is C printf %f', () => {
  it('always writes six decimals', () => {
    expect(printfF(0.1)).toBe('0.100000');
    expect(printfF(10)).toBe('10.000000');
    expect(printfF(0.01)).toBe('0.010000');
    expect(printfF(0.089133)).toBe('0.089133');
    expect(printfF(0.035)).toBe('0.035000');
  });

  it('does not switch to an exponent, however small the number', () => {
    expect(printfF(1e-8)).toBe('0.000000');
    expect(printfF(1e8)).toBe('100000000.000000');
  });

  it('honours an explicit precision', () => {
    expect(printfF(1.5, 2)).toBe('1.50');
    expect(printfF(1.5, 0)).toBe('2');
  });

  it('names the non-finite values the way the C library does', () => {
    expect(printfF(Number.NaN)).toBe('nan');
    expect(printfF(Number.POSITIVE_INFINITY)).toBe('inf');
  });
});
