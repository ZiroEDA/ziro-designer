// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PIN_NUMBERS::Compare` (common/pin_numbers.cpp:135-211).
 *
 * The magnitudes are part of the contract, not an implementation detail:
 * `GetSummary` asserts the result is -1 or -2 and collapses a run of pins into
 * "1-8" only on -1, so a comparator that returned the sign alone would be a
 * correct sort and a broken summary. Both are pinned here.
 */
import { describe, expect, it } from 'vitest';
import { pinNumbersCompare } from '@ziroeda/common/src/pin_numbers.js';

describe('PIN_NUMBERS::Compare', () => {
  it('is a natural compare, so 10 comes after 9 and not after 1', () => {
    // The whole reason the pin table does not use a string sort.
    expect(pinNumbersCompare('9', '10')).toBeLessThan(0);
    expect(pinNumbersCompare('10', '9')).toBeGreaterThan(0);
    expect(['10', '2', '1'].slice().sort(pinNumbersCompare)).toStrictEqual(['1', '2', '10']);
  });

  it('distinguishes ADJACENT from apart by returning ±1 versus ±2', () => {
    // `if( val1 == val2 - 1 ) return -1; else return -2;` (:181-185).
    expect(pinNumbersCompare('1', '2')).toBe(-1);
    expect(pinNumbersCompare('2', '1')).toBe(1);
    expect(pinNumbersCompare('1', '3')).toBe(-2);
    expect(pinNumbersCompare('3', '1')).toBe(2);
  });

  it('equal numbers are 0, and a prefix runs out first', () => {
    expect(pinNumbersCompare('7', '7')).toBe(0);
    // `if( symbol1.empty() ) return -2;` (:150-154).
    expect(pinNumbersCompare('A', 'A1')).toBe(-2);
    expect(pinNumbersCompare('A1', 'A')).toBe(2);
  });

  it('compares group by group, so A2 follows A10 by the letters first', () => {
    // getNextSymbol splits "A10" into "A" then "10"; the letters tie, so the
    // numbers decide.
    expect(pinNumbersCompare('A2', 'A10')).toBeLessThan(0);
    expect(pinNumbersCompare('B1', 'A10')).toBeGreaterThan(0);
  });

  it('a numeric group sorts before a non-numeric one', () => {
    // `if( sym1_isnumeric ) { if( !sym2_isnumeric ) return -2; }` (:195-203).
    expect(pinNumbersCompare('1', 'A')).toBe(-2);
    expect(pinNumbersCompare('A', '1')).toBe(2);
  });

  it('treats a v/V inside a numeric group as a decimal point', () => {
    // `symbol1[v1] = '.'` (:164-172) — 3V3 is 3.3, which is why it sorts
    // between 3 and 4 rather than after 33.
    expect(pinNumbersCompare('3V3', '4')).toBeLessThan(0);
    expect(pinNumbersCompare('3V3', '3')).toBeGreaterThan(0);
    expect(pinNumbersCompare('3V3', '33')).toBeLessThan(0);
  });

  it('reads a leading sign as part of the number', () => {
    // getNextSymbol takes '+'/'-' into the numeric group when a digit follows
    // (common/pin_numbers.cpp:40-42).
    expect(pinNumbersCompare('-5', '5')).toBeLessThan(0);
    expect(pinNumbersCompare('-1', '0')).toBe(-1);
  });
});
