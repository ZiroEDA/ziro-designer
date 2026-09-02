// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Gerber Viewer > Excellon Options —
 * `PANEL_GERBVIEW_EXCELLON_SETTINGS`.
 *
 * The page is six controls, and every one of them is a value the drill reader
 * falls back on when a file's own header is silent — which is common enough
 * that upstream says so in the struct's header: "Some important parameters are
 * not defined in drill files, and some others can be missing in poor drill
 * files" (`gerbview/excellon_defaults.h:35-37`).
 *
 * So the assertions are about what the PARSER does with them, not about the
 * markup. A page of six controls that the reader ignored would render
 * identically.
 */
import { describe, it, expect } from 'vitest';
import { GERBVIEW_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';
import {
  EXCELLON_DIGIT_CHOICES,
  EXCELLON_DIGIT_RANGE,
  EXCELLON_STRINGS,
  EXCELLON_UNIT_CHOICES,
  EXCELLON_ZERO_CHOICES,
  unitIsMM,
  unitOf,
  zeroFormatOf,
  zeroIsLeading,
} from '@ziroeda/designer/src/editors/gerbview/prefs/excellon_options.js';
import { EXCELLON_STRUCT_DEFAULTS, parseExcellon, type ExcellonDefaults } from '@ziroeda/gerbview';

describe('the controls, against panel_gerbview_excellon_settings_base.cpp', () => {
  /**
   * `m_rbInches` then `m_rbMM` (`:37-44`). The labels are upstream's own
   * spelling — "Inches" capitalised, "mm" not — and the flag runs the other
   * way from the reading order, because it is `m_UnitsMM`.
   */
  it('offers Inches then mm, and maps them to m_UnitsMM', () => {
    expect(EXCELLON_UNIT_CHOICES).toEqual([
      ['inch', 'Inches'],
      ['mm', 'mm'],
    ]);
    expect(unitIsMM('inch')).toBe(false);
    expect(unitIsMM('mm')).toBe(true);
    expect(unitOf(false)).toBe('inch');
    expect(unitOf(true)).toBe('mm');
  });

  /**
   * `m_rbTZ` then `m_rbLZ` (`:50-56`). The labels look transposed and are not:
   * LZ keeps LEADING zeros and drops trailing ones, so the button selecting it
   * reads "No trailing zeros (LZ format)".
   */
  it('offers TZ then LZ, with upstream’s own back-to-front labels', () => {
    expect(EXCELLON_ZERO_CHOICES).toEqual([
      ['tz', 'No leading zeros (TZ format)'],
      ['lz', 'No trailing zeros (LZ format)'],
    ]);
    expect(zeroIsLeading('lz')).toBe(true);
    expect(zeroIsLeading('tz')).toBe(false);
    expect(zeroFormatOf(GERBVIEW_DEFAULTS.excellon_defaults.lz_format)).toBe('lz');
  });

  /**
   * `{ "2", "3", "4", "5", "6" }` (`:96`), read back as `GetSelection() +
   * FIRST_VALUE` with `#define FIRST_VALUE 2`
   * (`panel_gerbview_excellon_settings.cpp:62-67`) — so the list IS the value,
   * and the `PARAM<int>`s clamp to the same 2..6.
   */
  it('offers 2..6 digits, as values and not as indices', () => {
    expect(EXCELLON_DIGIT_CHOICES.map(([v]) => v)).toEqual([2, 3, 4, 5, 6]);
    expect(EXCELLON_DIGIT_CHOICES.map(([, l]) => l)).toEqual(['2', '3', '4', '5', '6']);
    expect(EXCELLON_DIGIT_RANGE).toEqual({ min: 2, max: 6 });
    for (const [v] of EXCELLON_DIGIT_CHOICES) {
      expect(v).toBeGreaterThanOrEqual(EXCELLON_DIGIT_RANGE.min);
      expect(v).toBeLessThanOrEqual(EXCELLON_DIGIT_RANGE.max);
    }
  });

  /** Every heading, help line and hint, verbatim. */
  it('says what upstream says, and no string of ours', () => {
    expect(EXCELLON_STRINGS).toEqual({
      fileFormat: 'File Format',
      fileFormatHelp: 'These parameters are usually specified in files, but not always.',
      units: 'File units:',
      zeroFormat: 'Zero format:',
      coordinates: 'Coordinates Format',
      coordinatesHelp: 'The coordinates format is not specified in Excellon format.',
      hint1: '(The decimal format does not use these settings)',
      formatMm: 'Format for mm:',
      formatInch: 'Format for inches:',
      hint2: 'Usually: 3:3 in mm and 2:4 in inches',
      separator: ':',
    });
  });

  /**
   * The stored defaults are `EXCELLON_DEFAULTS::ResetToDefaults()`'s, and the
   * parser's fallback struct must be the same six values — two copies that
   * disagreed would make "Reset to Defaults" change the drawing.
   */
  it('the settings file and the parser agree on the defaults', () => {
    const cfg = GERBVIEW_DEFAULTS.excellon_defaults;
    expect(EXCELLON_STRUCT_DEFAULTS).toEqual({
      unit_mm: cfg.unit_mm,
      lz_format: cfg.lz_format,
      m_MmIntegerLen: cfg.mm_integer_len,
      m_MmMantissaLen: cfg.mm_mantissa_len,
      m_InchIntegerLen: cfg.inch_integer_len,
      m_InchMantissaLen: cfg.inch_mantissa_len,
    });
    // …and they are `excellon_defaults.h:51-58`'s, not each other's.
    expect(EXCELLON_STRUCT_DEFAULTS).toEqual({
      unit_mm: false,
      lz_format: true,
      m_MmIntegerLen: 3,
      m_MmMantissaLen: 3,
      m_InchIntegerLen: 2,
      m_InchMantissaLen: 4,
    });
  });
});

/**
 * The half that makes the page mean anything: `LoadFile( aFullFileName,
 * aDefaults )` takes them, and `SelectUnits( aMetric, aDefaults )` picks the
 * pair for whichever unit the header turned out to name
 * (`excellon_read_drill_file.cpp:467-505`, `:1113-1170`).
 *
 * A drill file with a bare `T1C0.02` tool and coordinates carrying no decimal
 * point is the case the defaults exist for — nothing in it says how many digits
 * are integer and how many fractional, so the same bytes mean different
 * distances under different settings.
 */
describe('the drill reader falls back on them', () => {
  /** No FILE_FORMAT, no decimal points: the header settles the UNIT and nothing else. */
  const drill = (unitLine: string): string =>
    ['M48', unitLine, 'T1C0.020', '%', 'T1', 'X010000Y010000', 'M30'].join('\n');

  const xOf = (text: string, defaults?: ExcellonDefaults): number => {
    const img = parseExcellon(text, 'test.drl', defaults);
    expect(img.items.length).toBeGreaterThan(0);
    return img.items[0]?.start.x as number;
  };

  it('reads an inch file at the inch format, and the mm file at the mm one', () => {
    // 2:4 in inches — `010000` is 1.0000 in. 3:3 in mm — `010000` is 010.000 mm.
    const inch = xOf(drill('INCH,LZ'));
    const mm = xOf(drill('METRIC,LZ'));
    // 1 inch is 25.4 mm, so the inch file's point is the further out by far.
    expect(inch / mm).toBeCloseTo(25.4 / 10, 3);
  });

  it('a different integer:mantissa split moves the same bytes', () => {
    const asIs = xOf(drill('INCH,LZ'));
    // 3:3 instead of 2:4: `010000` becomes 010.000 in rather than 01.0000 in.
    const shifted = xOf(drill('INCH,LZ'), {
      ...EXCELLON_STRUCT_DEFAULTS,
      m_InchIntegerLen: 3,
      m_InchMantissaLen: 3,
    });
    expect(shifted / asIs).toBeCloseTo(10, 6);
  });

  it('the zero-format default decides how a short coordinate is padded', () => {
    // `X1` with six digits of format: LZ pads on the left (0.0001 in),
    // TZ pads on the right (1.0000 in). Four orders of magnitude apart.
    const short = ['M48', 'INCH', 'T1C0.020', '%', 'T1', 'X1Y1', 'M30'].join('\n');
    const lz = xOf(short, { ...EXCELLON_STRUCT_DEFAULTS, lz_format: true });
    const tz = xOf(short, { ...EXCELLON_STRUCT_DEFAULTS, lz_format: false });
    expect(tz / lz).toBeCloseTo(1e5, 0);
  });

  it('omitting the defaults is the struct’s own values, not a third set', () => {
    const text = drill('INCH,LZ');
    expect(xOf(text)).toBe(xOf(text, EXCELLON_STRUCT_DEFAULTS));
  });
});
