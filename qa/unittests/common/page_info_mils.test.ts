// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PAGE_INFO's unit is MILS, and the metric sizes are rounded into it.
 *
 *     #define MMsize( x, y ) VECTOR2D( Mm2mils( x ), Mm2mils( y ) )   page_info.cpp:38
 *     int Mm2mils( double aVal ) { return KiROUND( aVal * 1000. / 25.4 ); }
 *                                                                    eda_units.cpp:76
 *     int GetWidthIU( double aIUScale ) const { return aIUScale * GetWidthMils(); }
 *                                                                    page_info.h:159
 *
 * Two integer steps, and both are visible. We stored exact millimetres and so
 * printed "Page Width 420.0000 mm" where a live pl_editor beside it printed
 * "419.9890 mm". Measured off Akshay's side-by-side capture, not derived from
 * our own code.
 */
import { describe, expect, it } from 'vitest';
import {
  DRAW_SHEET_IU_PER_MIL,
  PAPER_MILS,
  PAPER_MM,
  pageSizeDisplayMM,
  pageSizeIU,
} from '@ziroeda/common/src/page_info.js';

describe('the table is the C++ table, in mils', () => {
  // KiROUND( mm * 1000 / 25.4 ) for each metric size; the imperial ones are
  // declared directly as mils upstream and are exact.
  const EXPECTED: Record<string, [number, number]> = {
    A5: [8268, 5827],
    A4: [11693, 8268],
    A3: [16535, 11693],
    A2: [23386, 16535],
    A1: [33110, 23386],
    A0: [46811, 33110],
    A: [11000, 8500],
    B: [17000, 11000],
    E: [44000, 34000],
    GERBER: [32000, 32000],
    USLegal: [14000, 8500],
  };

  for (const [name, size] of Object.entries(EXPECTED)) {
    it(`${name} is ${size[0]} x ${size[1]} mils`, () => {
      expect(PAPER_MILS[name]).toStrictEqual(size);
    });
  }

  it('and every metric entry really is the rounding of its millimetres', () => {
    // Re-derived here rather than transcribed, so a typo in the table above
    // cannot agree with a typo in the table under test.
    const mm: Record<string, [number, number]> = {
      A5: [210, 148],
      A4: [297, 210],
      A3: [420, 297],
      A2: [594, 420],
      A1: [841, 594],
      A0: [1189, 841],
    };
    for (const [name, [w, h]] of Object.entries(mm)) {
      expect(PAPER_MILS[name], name).toStrictEqual([
        Math.round((w * 1000) / 25.4),
        Math.round((h * 1000) / 25.4),
      ]);
    }
  });
});

describe('A3 is not 420 mm', () => {
  it('is 419.989 mm wide, the mils rounding showing through', () => {
    expect(PAPER_MM.A3![0]).toBeCloseTo(419.989, 6);
    expect(PAPER_MM.A3![0]).not.toBe(420);
  });

  it('and the message panel prints 419.9890 / 297.0020', () => {
    // The exact strings on Akshay's pl_editor capture. The height is 297.0020
    // and NOT 297.0022 because GetWidthIU returns an int: 11693 * 25.4 is
    // 297002.2, which truncates to 297002 IU.
    const [w, h] = pageSizeDisplayMM('A3');
    expect(w.toFixed(4)).toBe('419.9890');
    expect(h.toFixed(4)).toBe('297.0020');
  });

  it('and the truncation is what makes the difference', () => {
    // Without it the height would print 297.0022 — right by arithmetic, wrong
    // against the program.
    const untruncated = (DRAW_SHEET_IU_PER_MIL * PAPER_MILS.A3![1]) / 1000;
    expect(untruncated.toFixed(4)).toBe('297.0022');
    expect(pageSizeIU('A3', DRAW_SHEET_IU_PER_MIL)).toStrictEqual([419989, 297002]);
  });
});

describe('an unknown paper name', () => {
  it('reports zero, so a caller can fall back to a custom size', () => {
    expect(pageSizeIU('nonesuch', DRAW_SHEET_IU_PER_MIL)).toStrictEqual([0, 0]);
  });
});
