// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, expect, it } from 'vitest';
import {
  BOARD_CLASS_COUNT,
  BOARD_CLASS_ROWS,
  CORROSION_METALS,
  E24_VALUES,
  E96_VALUES,
  ESERIES_DISPLAY_SCALE,
  STANDARD_CABLE_CONDUCTOR_LIST,
  STANDARD_CABLE_TEMP_COEF_LIST,
  STANDARD_EPSILON_R_LIST,
  STANDARD_RESISTIVITY_LIST,
  colorCode,
  corrosionDeltaV,
  corrosionSignedDeltaV,
} from '@ziroeda/pcb_calculator';

describe('board classes memo', () => {
  it('matches KiCad: 5 rows, one value per class, KiCad values', () => {
    expect(BOARD_CLASS_ROWS).toHaveLength(5);
    for (const row of BOARD_CLASS_ROWS) expect(row.mm).toHaveLength(BOARD_CLASS_COUNT);
    const byLabel = (l: string) => BOARD_CLASS_ROWS.find((r) => r.label === l)!.mm;
    expect(byLabel('Lines width')).toEqual([0.8, 0.5, 0.31, 0.21, 0.15, 0.12]);
    expect(byLabel('Minimum clearance')).toEqual([0.68, 0.5, 0.31, 0.21, 0.15, 0.12]);
    expect(byLabel('Plated Pad: (diameter - drill)')).toEqual([1.19, 0.78, 0.6, 0.49, 0.39, 0.35]);
    // KiCad marks some entries N/A (NaN here).
    expect(Number.isNaN(byLabel('Via: (diameter - drill)')[0]!)).toBe(true);
    expect(Number.isNaN(byLabel('NP Pad: (diameter - drill)')[3]!)).toBe(true);
  });

  it('defined values tighten with class where applicable', () => {
    const lines = BOARD_CLASS_ROWS.find((r) => r.label === 'Lines width')!.mm;
    for (let i = 1; i < lines.length; i++) expect(lines[i]!).toBeLessThanOrEqual(lines[i - 1]!);
  });
});

describe('galvanic corrosion memo', () => {
  it('copper vs zinc is a risky pair, copper vs nickel is not', () => {
    const cu = CORROSION_METALS.findIndex((m) => m.name === 'Copper');
    const zn = CORROSION_METALS.findIndex((m) => m.name === 'Zinc');
    const ni = CORROSION_METALS.findIndex((m) => m.name === 'Nickel');
    expect(corrosionDeltaV(cu, zn)).toBeGreaterThan(0.3);
    expect(corrosionDeltaV(cu, ni)).toBeLessThanOrEqual(0.3);
    expect(corrosionDeltaV(cu, cu)).toBe(0);
  });
});

describe('resistor colour code', () => {
  it('4.7 kΩ 5 % four-band: yellow violet red gold', () => {
    const r = colorCode(4700, 5, 4);
    expect(r.error).toBeUndefined();
    expect(r.digits.map((d) => d.name)).toEqual(['Yellow', 'Violet']);
    expect(r.multiplier.name).toBe('Red');
    expect(r.tolerance?.name).toBe('Gold');
    expect(r.encodedOhms).toBe(4700);
  });

  it('12.4 kΩ 1 % five-band: brown red yellow red brown', () => {
    const r = colorCode(12400, 1, 5);
    expect(r.digits.map((d) => d.name)).toEqual(['Brown', 'Red', 'Yellow']);
    expect(r.multiplier.name).toBe('Red');
    expect(r.tolerance?.name).toBe('Brown');
  });

  it('sub-ohm values use silver/gold multipliers', () => {
    const r = colorCode(0.47, 5, 4);
    expect(r.multiplier.name).toBe('Silver');
    expect(r.encodedOhms).toBeCloseTo(0.47, 9);
  });

  it('rejects nonsense', () => {
    expect(colorCode(-1, 5, 4).error).toBeTruthy();
    expect(colorCode(Number.NaN, 5, 4).error).toBeTruthy();
  });

  it('rounds to the nearest encodable value', () => {
    const r = colorCode(4990, 5, 4);
    expect(r.encodedOhms).toBe(5000);
  });

  it('6-band adds a temperature-coefficient band', () => {
    const r = colorCode(4700, 1, 6, 50);
    expect(r.digits.map((d) => d.name)).toEqual(['Yellow', 'Violet', 'Black']);
    expect(r.tolerance?.name).toBe('Brown');
    expect(r.tempco?.name).toBe('Red'); // 50 ppm/K
    expect(r.tempco?.ppm).toBe(50);
  });

  it('4/5-band carry no tempco band', () => {
    expect(colorCode(4700, 5, 4).tempco).toBeNull();
    expect(colorCode(4700, 1, 5).tempco).toBeNull();
  });
});

/**
 * The Galvanic Corrosion table, driven side by side against pcb_calculator
 * 10.0.5: its first four rows read, in millivolts,
 *   Rh  0 -30 -100 -160 -250 -250 -260 -280 -280
 *   Pt  30 0 -70 -130 -220 -220 -230 -250 -250
 *   Pd  100 70 0 -60 -150 -150 -160 -180 -180
 *   Au  160 130 60 0 -90 -90 -100 -120 -120
 * The SIGN is the load-bearing part: it decides whether a cell takes the blue
 * ramp or the orange one, i.e. which of the two metals is the one at risk.
 */
describe('galvanic corrosion table, as the real grid prints it', () => {
  const mv = (i: number, j: number): number => Math.round(corrosionSignedDeltaV(i, j) * 1000);

  it('row 0 (Rh) matches the binary, signs included', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((j) => mv(0, j))).toStrictEqual([
      0, -30, -100, -160, -250, -250, -260, -280, -280,
    ]);
  });

  it('row 1 (Pt) matches, and is the negation of column 1', () => {
    expect([0, 1, 2, 3].map((j) => mv(1, j))).toStrictEqual([30, 0, -70, -130]);
    expect(mv(1, 0)).toBe(-mv(0, 1));
  });

  it('rows 2 and 3 match', () => {
    expect([0, 1, 2, 3].map((j) => mv(2, j))).toStrictEqual([100, 70, 0, -60]);
    expect([0, 1, 2, 3, 4].map((j) => mv(3, j))).toStrictEqual([160, 130, 60, 0, -90]);
  });

  it('the diagonal is zero and the matrix is antisymmetric', () => {
    for (let i = 0; i < 6; i++) {
      expect(mv(i, i)).toBe(0);
      // `+ 0` normalises -0, which Object.is separates from 0.
      for (let j = 0; j < 6; j++) expect(mv(i, j) + 0).toBe(-mv(j, i) + 0);
    }
  });

  it('corrosionDeltaV stays absolute, because the threshold compares magnitudes', () => {
    expect(corrosionDeltaV(0, 1)).toBeCloseTo(Math.abs(corrosionSignedDeltaV(0, 1)), 12);
    expect(corrosionDeltaV(1, 0)).toBe(corrosionDeltaV(0, 1));
  });
});

/**
 * The E-Series memo page prints the tables' own `uint16_t` entries — 100, 102,
 * 105 — via `wxString( "" ) << seriesEntry` (panel_eseries_display.cpp:177).
 */
describe('E-series memo display scale', () => {
  it('turns the decade-normalised values into KiCad’s integers', () => {
    expect(Math.round(1.0 * ESERIES_DISPLAY_SCALE)).toBe(100);
    expect(Math.round(1.02 * ESERIES_DISPLAY_SCALE)).toBe(102);
    expect(Math.round(8.2 * ESERIES_DISPLAY_SCALE)).toBe(820);
  });

  it('reproduces the four stripe heads the real grid shows', () => {
    // Row 0 of each of the four stripes: E24 100/180/330/560.
    const s = (n: number): number => Math.round(n * ESERIES_DISPLAY_SCALE);
    expect([0, 6, 12, 18].map((i) => s(E24_VALUES[i] ?? 0))).toStrictEqual([100, 180, 330, 560]);
    // and E96 100/178/316/562.
    expect([0, 24, 48, 72].map((i) => s(E96_VALUES[i] ?? 0))).toStrictEqual([100, 178, 316, 562]);
  });
});

/** `common_data.cpp`'s pick-lists, which the `...` buttons write into a field. */
describe('the ... pick-lists are common_data.cpp verbatim', () => {
  it('the cable conductor list is five entries, copper first', () => {
    expect(STANDARD_CABLE_CONDUCTOR_LIST.map((e) => e.value)).toStrictEqual([
      '1.72e-8',
      '2.62e-8',
      '100e-8',
      '9.71e-8',
      '5.6e-8',
    ]);
    expect(STANDARD_CABLE_CONDUCTOR_LIST[0]?.name).toBe('Cu, Copper');
  });

  it('the temperature-coefficient list lines up with it, entry for entry', () => {
    expect(STANDARD_CABLE_TEMP_COEF_LIST.map((e) => e.name)).toStrictEqual(
      STANDARD_CABLE_CONDUCTOR_LIST.map((e) => e.name),
    );
    expect(STANDARD_CABLE_TEMP_COEF_LIST.map((e) => e.value)).toStrictEqual([
      '3.93e-3',
      '4.29e-3',
      '0.4e-3',
      '5e-3',
      '4.5e-3',
    ]);
  });

  it('the resistivity list has ten metals and the dielectric list seventeen', () => {
    expect(STANDARD_RESISTIVITY_LIST).toHaveLength(10);
    expect(STANDARD_EPSILON_R_LIST).toHaveLength(17);
    expect(STANDARD_EPSILON_R_LIST[0]).toStrictEqual({ value: '4.5', name: 'FR4' });
  });
});
