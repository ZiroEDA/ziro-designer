// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `UNIT_BINDER` (common/widgets/unit_binder.cpp) and the `EDA_UNIT_UTILS`
 * helpers it calls (common/eda_units.cpp).
 *
 * The Drawing Sheet Editor's properties panel used to hardcode millimetres and
 * a literal "mm" span while the frame's own toolbar offered mm / inch / mils,
 * so with the frame in mils — which is the unit `pl_editor` OPENS in — a text
 * item at (25 mm, 1 mm) read "25 mm" here and "984.25197 / 39.37008" there.
 *
 * Those two numbers were measured off a live `pl_editor` 10.0.5 during the
 * audit and are asserted verbatim below, because they pin BOTH halves of the
 * conversion at once: a wrong factor and a wrong digit count each break them,
 * whereas a test written against a round number like 1000 mils would pass
 * against either mistake.
 */
import { describe, it, expect } from 'vitest';
import { drawSheetIUScale, pcbIUScale, schIUScale } from '@ziroeda/common';
import {
  fromUserUnit,
  stringFromValue,
  toUserUnit,
  unitLabel,
  unitText,
} from '@ziroeda/designer/src/ui/unit_binder.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const PANEL = read('../../../designer/src/editors/drawingsheet/PropertiesFrame.tsx');
const EDITOR = read('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx');

describe('EDA_UNIT_UTILS::GetText / GetLabel', () => {
  it('is the unit word the binder writes beside the field', () => {
    // common/eda_units.cpp:144-160, then GetLabel (:180) trims the space.
    expect(unitLabel('mm')).toBe('mm');
    expect(unitLabel('in')).toBe('in');
    expect(unitLabel('mils')).toBe('mils');
  });

  it('keeps GetText’s leading space so "10 mm" has one', () => {
    expect(unitText('mm')).toBe(' mm');
    expect(unitText('in')).toBe(' in');
    expect(unitText('mils')).toBe(' mils');
  });
});

describe('EDA_UNIT_UTILS::UI::StringFromValue', () => {
  it('shows 25 mm as 984.25197 mils, the value measured in a live pl_editor', () => {
    expect(stringFromValue(25, 'mils')).toBe('984.25197');
  });

  it('shows 1 mm as 39.37008 mils, the Y of the same measured item', () => {
    expect(stringFromValue(1, 'mils')).toBe('39.37008');
  });

  it('shows the same 25 mm as 0.98425197 in, at inch’s own %.8f', () => {
    expect(stringFromValue(25, 'in')).toBe('0.98425197');
  });

  it('leaves millimetres alone', () => {
    expect(stringFromValue(25, 'mm')).toBe('25');
    expect(stringFromValue(1.5, 'mm')).toBe('1.5');
    expect(stringFromValue(0.15, 'mm')).toBe('0.15');
  });

  it('strips trailing zeros, and the point with them', () => {
    // removeTrailingZeros (common/eda_units.cpp:32): 0.01 mm is 0.39370 mils
    // at %.5f, which prints as 0.3937.
    expect(stringFromValue(0.01, 'mils')).toBe('0.3937');
    expect(stringFromValue(0, 'mils')).toBe('0');
    expect(stringFromValue(0, 'mm')).toBe('0');
    expect(stringFromValue(-2.5, 'mm')).toBe('-2.5');
  });

  it('appends the unit text only when asked, as Validate asks', () => {
    expect(stringFromValue(10, 'mm', true)).toBe('10 mm');
    expect(stringFromValue(10, 'mils', true)).toBe('393.70079 mils');
    expect(stringFromValue(10, 'in', true)).toBe('0.39370079 in');
  });

  it('drops a digit for the eeschema scale, as is_eeschema does', () => {
    // %.3f / %.6f instead of %.5f / %.8f. The drawing sheet counts microns, so
    // it takes the long form; the schematic would print 984.252.
    expect(stringFromValue(25, 'mils', false, schIUScale)).toBe('984.252');
    expect(stringFromValue(25, 'in', false, schIUScale)).toBe('0.984252');
    expect(stringFromValue(25, 'mils', false, pcbIUScale)).toBe('984.25197');
    expect(stringFromValue(25, 'mils', false, drawSheetIUScale)).toBe('984.25197');
  });

  it('re-prints at full precision a value that rounded away to nothing', () => {
    // 1e-7 mm is 0.00000000 in at %.8f; upstream falls back to %.10f rather
    // than showing a non-zero value as "0".
    expect(stringFromValue(1e-7, 'in')).toBe('0.0000000039');
  });
});

describe('EDA_UNIT_UTILS::UI::ToUserUnit / FromUserUnit', () => {
  it('converts as IU_TO_MILS / IU_TO_IN do with the scale divided out', () => {
    expect(toUserUnit('mm', 25)).toBe(25);
    expect(toUserUnit('mils', 25)).toBeCloseTo(984.2519685, 7);
    expect(toUserUnit('in', 25)).toBeCloseTo(0.9842519685, 10);
    expect(fromUserUnit('mm', 25)).toBe(25);
    expect(fromUserUnit('mils', 1000)).toBeCloseTo(25.4, 12);
    expect(fromUserUnit('in', 1)).toBeCloseTo(25.4, 12);
  });

  it('round-trips a display value back to itself', () => {
    for (const mm of [0.15, 1, 1.5, 25, 100, 210, 297]) {
      expect(fromUserUnit('mils', toUserUnit('mils', mm))).toBeCloseTo(mm, 9);
      expect(fromUserUnit('in', toUserUnit('in', mm))).toBeCloseTo(mm, 9);
    }
  });
});

describe('the panel no longer hardcodes a unit', () => {
  it('has no MmField and no literal unit span left', () => {
    expect(PANEL).not.toContain('MmField');
    // The old field rendered `<span className="ze-muted" …>mm</span>`.
    expect(PANEL).not.toMatch(/>\s*mm\s*</);
  });

  it('binds every distance field to the frame’s unit', () => {
    // Each UnitField tag carries `units={units}`; none may be left behind.
    const tags = PANEL.split('<UnitField')
      .slice(1)
      .map((t) => t.slice(0, t.indexOf('/>')));
    expect(tags.length).toBe(19);
    expect(tags.filter((t) => t.includes('units={units}'))).toHaveLength(tags.length);
    // …and every one names itself, which is what the error message quotes.
    expect(tags.filter((t) => /\blabel="/.test(t))).toHaveLength(tags.length);
  });

  it('takes the unit from the frame, which is the UNITS_PROVIDER', () => {
    expect(EDITOR).toContain("units={unit === 'inches' ? 'in' : unit}");
  });
});
