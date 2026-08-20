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
  parseUnitValue,
  stringFromValue,
  toUserUnit,
  unitLabel,
  unitText,
  validateUnitValue,
  valueDescriptionFromLabel,
} from '@ziroeda/designer/src/ui/unit_binder.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const PANEL = read('../../../designer/src/editors/drawingsheet/PropertiesFrame.tsx');
const EDITOR = read('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx');
const FIELD = read('../../../designer/src/ui/UnitField.tsx');

/** The five ranges properties_frame.cpp passes to validateMM, in millimetres. */
const LINE_WIDTH = { min: 0.0, max: 10.0 };
const ITEM_TEXT_SIZE = { min: 0.0, max: 100.0 };
const DEFAULT_TEXT_SIZE = { min: 0.01, max: 100.0 };
const DEFAULT_TEXT_THICKNESS = { min: 0.0, max: 5.0 };

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
    expect(tags.length).toBe(17);
    expect(tags.filter((t) => t.includes('units={units}'))).toHaveLength(tags.length);
    // …and every one names itself, which is what the error message quotes.
    expect(tags.filter((t) => /\blabel="/.test(t))).toHaveLength(tags.length);
  });

  it('takes the unit from the frame, which is the UNITS_PROVIDER', () => {
    expect(EDITOR).toContain("units={unit === 'inches' ? 'in' : unit}");
  });
});

describe('UNIT_BINDER::Validate', () => {
  it('names the field by its label with the colon taken off', () => {
    // valueDescriptionFromLabel (unit_binder.cpp:356).
    expect(valueDescriptionFromLabel('Line width:')).toBe('Line width');
    expect(valueDescriptionFromLabel('Line width')).toBe('Line width');
    expect(valueDescriptionFromLabel('X:')).toBe('X');
  });

  it('passes anything inside the range', () => {
    expect(validateUnitValue('Line width:', 0, LINE_WIDTH, 'mm')).toBeNull();
    expect(validateUnitValue('Line width:', 0.15, LINE_WIDTH, 'mm')).toBeNull();
    expect(validateUnitValue('Line width:', 10, LINE_WIDTH, 'mm')).toBeNull();
    expect(validateUnitValue('Text width:', 100, ITEM_TEXT_SIZE, 'mm')).toBeNull();
    expect(validateUnitValue('Text width:', 0.01, DEFAULT_TEXT_SIZE, 'mm')).toBeNull();
    expect(validateUnitValue('Text thickness:', 5, DEFAULT_TEXT_THICKNESS, 'mm')).toBeNull();
  });

  it('refuses below the minimum with KiCad’s wording', () => {
    expect(validateUnitValue('Line width:', -0.001, LINE_WIDTH, 'mm')).toBe(
      'Line width must be at least 0 mm.',
    );
    expect(validateUnitValue('Text width:', 0, DEFAULT_TEXT_SIZE, 'mm')).toBe(
      'Text width must be at least 0.01 mm.',
    );
    expect(validateUnitValue('Text width:', 0.009, DEFAULT_TEXT_SIZE, 'mm')).toBe(
      'Text width must be at least 0.01 mm.',
    );
  });

  it('refuses above the maximum with KiCad’s wording — "less than", not "at most"', () => {
    expect(validateUnitValue('Line width:', 10.001, LINE_WIDTH, 'mm')).toBe(
      'Line width must be less than 10 mm.',
    );
    expect(validateUnitValue('Text width:', 100.001, ITEM_TEXT_SIZE, 'mm')).toBe(
      'Text width must be less than 100 mm.',
    );
    expect(validateUnitValue('Text thickness:', 5.001, DEFAULT_TEXT_THICKNESS, 'mm')).toBe(
      'Text thickness must be less than 5 mm.',
    );
  });

  it('quotes the limit in the unit the field is showing', () => {
    // The limits are always written in mm (validateMM), but the message goes
    // through StringFromValue with the binder's own unit, so the number it
    // names is one the user could type straight back into the field.
    expect(validateUnitValue('Line width:', 10.001, LINE_WIDTH, 'mils')).toBe(
      'Line width must be less than 393.70079 mils.',
    );
    expect(validateUnitValue('Line width:', 10.001, LINE_WIDTH, 'in')).toBe(
      'Line width must be less than 0.39370079 in.',
    );
    expect(validateUnitValue('Text width:', 0, DEFAULT_TEXT_SIZE, 'mils')).toBe(
      'Text width must be at least 0.3937 mils.',
    );
    expect(validateUnitValue('Text width:', 100.001, ITEM_TEXT_SIZE, 'mils')).toBe(
      'Text width must be less than 3937.00787 mils.',
    );
  });

  it('compares in whole internal units, as GetValue() does', () => {
    // GetValue() is integer IU, and the drawing sheet counts microns, so a
    // value that rounds up to the limit is inside it.
    expect(validateUnitValue('Text width:', 0.0099, DEFAULT_TEXT_SIZE, 'mm')).toBeNull();
    expect(validateUnitValue('Line width:', 10.0004, LINE_WIDTH, 'mm')).toBeNull();
    expect(validateUnitValue('Line width:', 10.0006, LINE_WIDTH, 'mm')).toBe(
      'Line width must be less than 10 mm.',
    );
    // …and a negative smaller than half a micron is zero, not a negative.
    expect(validateUnitValue('Line width:', -0.0004, LINE_WIDTH, 'mm')).toBeNull();
  });
});

describe('EDA_UNIT_UTILS::UI::DoubleValueFromString', () => {
  it('reads an EMPTY field as zero, which is what makes a minimum bite', () => {
    // Not "leave the model alone": upstream's ToDouble leaves dtmp at 0, the
    // panel then assigns it, and only Validate stops it. Clearing General
    // Options > Text width used to set the sheet default text size to 0 here.
    expect(parseUnitValue('', 'mm')).toBe(0);
    expect(parseUnitValue('   ', 'mils')).toBe(0);
    expect(
      validateUnitValue('Text width:', parseUnitValue('', 'mm'), DEFAULT_TEXT_SIZE, 'mm'),
    ).toBe('Text width must be at least 0.01 mm.');
  });

  it('parses only the leading numeric run', () => {
    expect(parseUnitValue('12abc', 'mm')).toBe(12);
    expect(parseUnitValue('abc', 'mm')).toBe(0);
    expect(parseUnitValue('-2.5', 'mm')).toBe(-2.5);
    expect(parseUnitValue('1,5', 'mm')).toBe(1.5);
  });

  it('lets a trailing unit designator override the display unit', () => {
    expect(parseUnitValue('1.5mm', 'mils')).toBe(1.5);
    expect(parseUnitValue('1000 mils', 'mm')).toBeCloseTo(25.4, 9);
    expect(parseUnitValue('1000 th', 'mm')).toBeCloseTo(25.4, 9);
    expect(parseUnitValue('1 in', 'mm')).toBeCloseTo(25.4, 9);
    expect(parseUnitValue('1"', 'mm')).toBeCloseTo(25.4, 9);
  });

  it('quantises to the frame’s internal unit, so a unit round-trip does not drift', () => {
    // This is upstream's toMM( binder.GetIntValue() ): the panel stores whole
    // microns. Without it, showing 25 mm in mils and reading it straight back
    // would store 25.000000038.
    for (const mm of [0.15, 1, 1.5, 25, 100, 210, 297]) {
      expect(parseUnitValue(stringFromValue(mm, 'mils'), 'mils')).toBe(mm);
      expect(parseUnitValue(stringFromValue(mm, 'in'), 'in')).toBe(mm);
      expect(parseUnitValue(stringFromValue(mm, 'mm'), 'mm')).toBe(mm);
      // mm -> mils -> inch -> mm, the whole toolbar in one pass.
      const viaMils = parseUnitValue(stringFromValue(mm, 'mils'), 'mils');
      expect(parseUnitValue(stringFromValue(viaMils, 'in'), 'in')).toBe(mm);
    }
  });
});

describe('the field refuses an out-of-range entry rather than applying it', () => {
  it('skips the assignment, selects the text and re-focuses', () => {
    // UNIT_BINDER::Validate does all three; the early return is the important
    // one, since applying a rejected value is exactly the old behaviour.
    const commit = FIELD.slice(FIELD.indexOf('const commit'), FIELD.indexOf('return ('));
    const errorBranch = commit.slice(commit.indexOf('if (error)'));
    expect(errorBranch).toContain('onError?.(error);');
    expect(errorBranch).toContain('.focus()');
    expect(errorBranch).toContain('.select()');
    // The early return sits before the onCommit call.
    expect(errorBranch.indexOf('return;')).toBeGreaterThan(-1);
    expect(errorBranch.indexOf('return;')).toBeLessThan(errorBranch.indexOf('onCommit'));
  });

  it('only validates when the panel gave it a range', () => {
    expect(FIELD).toContain(
      'const error = range ? validateUnitValue(label, mm, range, units) : null;',
    );
  });
});
