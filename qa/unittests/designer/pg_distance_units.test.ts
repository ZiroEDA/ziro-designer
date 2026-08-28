// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A distance cell of the properties grid carries its unit.
 *
 * `PGPROPERTY_COORD` and `PGPROPERTY_SIZE` are both PGPROPERTY_DISTANCE
 * subclasses (`include/properties/pg_properties.h:104-165`), and every branch
 * of `PGPROPERTY_DISTANCE::DistanceToString`
 * (`common/properties/pg_properties.cpp:346-389`) ends in
 *
 *     m_parentFrame->StringFromValue( distanceIU, true, EDA_DATA_TYPE::DISTANCE )
 *
 * — `aAddUnitsText` TRUE. So Position X of a schematic symbol reads
 * `1900 mils`, not `1900` and not `1900.00`. eeschema's panel printed the bare
 * number because the frame handed the grid its MESSAGE-PANEL formatter, which
 * is `MessageTextFromValue` (a different precision) with no unit label.
 *
 * The expectations below are derived from `StringFromValue`
 * (common/eda_units.cpp:323-383) — the per-unit `wxT("%.Nf")` table at
 * `:358-367` with `is_eeschema = ( IU_PER_MM == SCH_IU_PER_MM )`, then
 * `removeTrailingZeros` — and from `EDA_UNIT_UTILS::GetText` (:143-176) for
 * the label, which carries its own leading space. They are NOT read back off
 * the implementation.
 */
import { describe, it, expect } from 'vitest';
import { pcbIUScale, schIUScale } from '@ziroeda/common';
import { distanceToString, stringToDistance } from '@ziroeda/designer/src/widgets/pg_properties.js';

/** 1900 mils at the eeschema scale: IU_PER_MILS is 1e4 * 0.0254 = 254. */
const MILS_1900 = 1900 * 254;

describe('a schematic distance cell prints StringFromValue with the unit', () => {
  it('reads "1900 mils", the way KiCad’s Position X does', () => {
    // %.3f -> "1900.000" -> removeTrailingZeros -> "1900", + " mils".
    expect(distanceToString(MILS_1900, 'mils', schIUScale)).toBe('1900 mils');
  });

  it('reads the same length as mm and as inches, each at its own precision', () => {
    // 1900 mils is 48.26 mm exactly: %.10f -> "48.2600000000" -> "48.26".
    expect(distanceToString(MILS_1900, 'mm', schIUScale)).toBe('48.26 mm');
    // and 1.9 in: %.6f -> "1.900000" -> "1.9".
    expect(distanceToString(MILS_1900, 'in', schIUScale)).toBe('1.9 in');
  });

  it('prints a zero offset as "0 mils" rather than an empty cell', () => {
    // Pin Name Position Offset on a placement is always 0 (symbol.h:71).
    expect(distanceToString(0, 'mils', schIUScale)).toBe('0 mils');
  });

  it('does not lose precision the way a fixed 2-decimal formatter would', () => {
    // The old eeschema formatter was `(mm / 0.0254).toFixed(2)`, which prints
    // this as "1.97" and cannot be typed back.
    expect(distanceToString(500, 'mils', schIUScale)).toBe('1.969 mils');
  });
});

describe('the same cell at the pcbnew scale keeps pcbnew’s precision', () => {
  it('is_eeschema is false there, so mils take %.5f and inches %.8f', () => {
    // 1900 mils at IU_PER_MILS = 1e6 * 0.0254 = 25400.
    const iu = 1900 * 25400;
    expect(distanceToString(iu, 'mils', pcbIUScale)).toBe('1900 mils');
    expect(distanceToString(pcbIUScale.mmToIU(1.27), 'mm', pcbIUScale)).toBe('1.27 mm');
  });
});

describe('the parse back is UNIT_BINDER’s, not Number()', () => {
  it('round-trips the displayed text', () => {
    expect(stringToDistance('1900', 'mils', schIUScale)).toBe(MILS_1900);
  });

  it('lets a trailing designator override the cell’s display unit', () => {
    // "1.5mm" typed into a mils cell means 1.5 mm.
    expect(stringToDistance('1.5mm', 'mils', schIUScale)).toBe(schIUScale.mmToIU(1.5));
  });

  it('rejects a cell with no leading number instead of reading it as zero', () => {
    // `PGPROPERTY_COORD::DoGetValidator` hands the grid a numeric validator.
    for (const text of ['', '   ', 'abc', 'mm']) {
      expect(stringToDistance(text, 'mils', schIUScale)).toBeNull();
    }
  });

  it('accepts a bare decimal point and a comma decimal separator', () => {
    expect(stringToDistance('.5', 'mm', schIUScale)).toBe(schIUScale.mmToIU(0.5));
    expect(stringToDistance(',5', 'mm', schIUScale)).toBe(schIUScale.mmToIU(0.5));
  });
});
