// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `MARGIN_OFFSET_BINDER` (common/widgets/margin_offset_binder.cpp): one field
 * for "offset + ratio", as KiCad 10 enters a solder paste clearance.
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import {
  MARGIN_OFFSET_BINDER,
  formatMarginOffset,
  parseMarginOffset,
} from '@ziroeda/common/widgets/margin_offset_binder.js';

const parse = (s: string) => parseMarginOffset(s, pcbIUScale, 'mm');
const format = (offset: number | undefined, ratio: number | undefined) =>
  formatMarginOffset({ offset, ratio }, pcbIUScale, 'mm');

describe('parseInput', () => {
  it('reads an offset, a ratio, or both, with a leading minus', () => {
    expect(parse('-2mm + 1%')).toStrictEqual({ offset: -2_000_000, ratio: 0.01 });
    expect(parse('0.5mm - 5%')).toStrictEqual({ offset: 500_000, ratio: -0.05 });
    expect(parse('0.5')).toStrictEqual({ offset: 500_000, ratio: undefined });
    expect(parse('-10%')).toStrictEqual({ offset: undefined, ratio: -0.1 });
  });

  it('reads a term in its own unit', () => {
    expect(parse('10mil')?.offset).toBe(254_000);
  });

  it('empty is both unset; nothing parseable is a failure', () => {
    expect(parse('  ')).toStrictEqual({ offset: undefined, ratio: undefined });
    expect(parse('abc')).toBeNull();
  });
});

describe('formatValue', () => {
  it('drops zero halves and joins with the ratio sign', () => {
    expect(format(0, 0)).toBe('');
    expect(format(-2_000_000, 0.01)).toBe('-2 + 1%');
    expect(format(500_000, -0.05)).toBe('0.5 - 5%');
    expect(format(undefined, -0.1)).toBe('-10%');
    // %.4g
    expect(format(undefined, 0.123456)).toBe('12.35%');
  });
});

describe('the binder', () => {
  it('reformats on kill focus and reports what it parsed', () => {
    const b = new MARGIN_OFFSET_BINDER(pcbIUScale, 'mm');
    b.SetOffsetValue(-100_000);
    b.SetRatioValue(0);
    expect(b.GetText()).toBe('-0.1');
    b.onTextChanged('-0.1mm-5%');
    b.onKillFocus();
    expect(b.GetText()).toBe('-0.1 - 5%');
    expect(b.GetOffsetValue()).toBe(-100_000);
    expect(b.GetRatioValue()).toBeCloseTo(-0.05);
  });

  it('reformats in new units', () => {
    const b = new MARGIN_OFFSET_BINDER(pcbIUScale, 'mm');
    b.SetOffsetValue(254_000);
    b.onUnitsChanged('mils');
    expect(b.GetText()).toBe('10');
  });
});
