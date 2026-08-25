// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The unit drop-downs, against `pcb_calculator/widgets/unit_selector.cpp`.
 *
 * Upstream these are twelve `wxChoice` subclasses. Thirty-nine selectors across
 * eight panels are instances of one of them, so a spelling can only be got
 * wrong once — and ours were per-panel copies until they were consolidated,
 * with `um` having drifted to `µm` in one of them. Every entry of every list is
 * its own expectation below: changing one label, one order or one scale must
 * fail exactly one test.
 *
 * The scales are `GetUnitScale()`'s, stated as the multiplier that takes a
 * typed number to SI. Two of `units_scales.h`'s constants are written the other
 * way round (`UNIT_MILLIVOLT 1e+3`) because the panels that use them multiply on
 * display; the note beside each says so.
 */
import { describe, it, expect } from 'vitest';
import {
  ANGLE_UNITS,
  CABLE_LEN_UNITS,
  FREQ_UNITS,
  LEN_UNITS,
  LIN_RES_UNITS,
  POWER_UNITS,
  RES_UNITS,
  SPEED_UNITS,
  THICK_UNITS,
  TIME_UNITS,
  type UnitOpt,
  unitIndex,
  VOLTAGE_UNITS,
} from '@ziroeda/designer/src/editors/calculator/unit_selector.js';

/** One upstream `UNIT_SELECTOR` subclass: its `Append` calls and its
 *  `GetUnitScale()` switch, in order. */
interface Table {
  /** The C++ class, and where its constructor is. */
  cls: string;
  ours: UnitOpt[];
  entries: [label: string, mult: number][];
}

const TABLES: Table[] = [
  {
    cls: 'UNIT_SELECTOR_LEN (unit_selector.cpp:34-38, scales :47-56)',
    ours: LEN_UNITS,
    entries: [
      // `Append( _( "um" ) )` — an ASCII u. Only THICKNESS spells it `µm`.
      ['mm', 1e-3],
      ['um', 1e-6],
      ['cm', 1e-2],
      ['mil', 25.4e-6],
      ['inch', 25.4e-3],
    ],
  },
  {
    cls: 'UNIT_SELECTOR_THICKNESS (unit_selector.cpp:66-71, scales :79-89)',
    ours: THICK_UNITS,
    entries: [
      ['mm', 1e-3],
      // `wxT( "µm" )`, the micro sign, in this list and no other.
      ['µm', 1e-6],
      ['cm', 1e-2],
      ['mil', 25.4e-6],
      ['inch', 25.4e-3],
      // UNIT_OZSQFT = 34.40 * UNIT_MICRON (units_scales.h:39).
      ['oz/ft²', 34.4e-6],
    ],
  },
  {
    cls: 'UNIT_SELECTOR_FREQUENCY (unit_selector.cpp:98-101, scales :108-116)',
    ours: FREQ_UNITS,
    entries: [
      ['GHz', 1e9],
      ['MHz', 1e6],
      ['kHz', 1e3],
      ['Hz', 1],
    ],
  },
  {
    cls: 'UNIT_SELECTOR_ANGLE (unit_selector.cpp:126-127, scales :135-140)',
    ours: ANGLE_UNITS,
    // Radians first, so Ang_l opens in radians.
    entries: [
      ['rad', 1],
      ['deg', Math.PI / 180],
    ],
  },
  {
    cls: 'UNIT_SELECTOR_RESISTOR (unit_selector.cpp:150-151, scales :160-166)',
    ours: RES_UNITS,
    entries: [
      ['Ω', 1],
      ['kΩ', 1e3],
    ],
  },
  {
    cls: 'UNIT_SELECTOR_LINEAR_RESISTANCE (unit_selector.cpp:172-175, scales :183-192)',
    ours: LIN_RES_UNITS,
    entries: [
      ['Ω/m', 1],
      ['Ω/km', 1e-3],
      // UNIT_OHM_PER_FEET / UNIT_OHM_PER_1000FEET, verbatim: 3.28084, NOT
      // 1 / 0.3048, which differs in the sixth significant figure and so in a
      // `%g` field (units_scales.h:52-55).
      ['Ω/ft', 3.28084],
      ['Ω/1000ft', 3.28084e-3],
    ],
  },
  {
    cls: 'UNIT_SELECTOR_LEN_CABLE (unit_selector.cpp:198-202, scales :210-220)',
    ours: CABLE_LEN_UNITS,
    entries: [
      // A different list from LEN: it starts at cm, has metres in it, and
      // spells the last entry "feet" rather than "ft".
      ['cm', 1e-2],
      ['m', 1],
      ['km', 1e3],
      ['inch', 25.4e-3],
      ['feet', 0.3048],
    ],
  },
  {
    cls: 'UNIT_SELECTOR_VOLTAGE (unit_selector.cpp:257-258)',
    ours: VOLTAGE_UNITS,
    // UNIT_MILLIVOLT is 1e+3 upstream because panel_cable_size.cpp:536
    // multiplies on display; the same conversion, the other way round.
    entries: [
      ['mV', 1e-3],
      ['V', 1],
    ],
  },
  {
    cls: 'UNIT_SELECTOR_POWER (unit_selector.cpp:278-279)',
    ours: POWER_UNITS,
    entries: [
      ['mW', 1e-3],
      ['W', 1],
    ],
  },
  {
    cls: 'UNIT_SELECTOR_SPEED (unit_selector.cpp:287-291, scales :299-309)',
    ours: SPEED_UNITS,
    entries: [
      ['m/s', 1],
      ['ft/s', 0.3048],
      ['km/h', 1 / 3.6],
      // UNIT_MILES_PER_HOUR is 1609.34 (units_scales.h:68) — the mile in
      // METRES, where miles per hour is 0.44704. panel_wavelength.cpp:118
      // divides by it, so KiCad prints the speed of light as 186411 under a
      // "mi/h" label. Upstream's bug, and this is [data] we mirror rather than
      // correct: the point is that the two panels agree.
      ['mi/h', 1609.34],
    ],
  },
  {
    cls: 'UNIT_SELECTOR_TIME (unit_selector.cpp:322-323)',
    ours: TIME_UNITS,
    // TWO entries. Ours used to have five: s, ms, µs, ns, ps. A wxChoice is as
    // wide as its widest entry, so an invented list shows even unopened.
    entries: [
      ['ns', 1e-9],
      ['ps', 1e-12],
    ],
  },
];

describe('UNIT_SELECTOR, entry by entry', () => {
  for (const t of TABLES) {
    describe(t.cls, () => {
      it(`has exactly ${t.entries.length} entries`, () => {
        expect(t.ours.length).toBe(t.entries.length);
      });

      t.entries.forEach(([label, mult], i) => {
        it(`entry ${i} is "${label}"`, () => {
          expect(t.ours[i]?.label).toBe(label);
        });
        it(`entry ${i} ("${label}") scales by ${mult}`, () => {
          expect(t.ours[i]?.mult).toBeCloseTo(mult, 15 + Math.max(0, -Math.log10(mult)));
        });
      });
    });
  }

  it('spells the micron differently in LEN and in THICKNESS, as upstream does', () => {
    // Stated once on purpose. A wxChoice is as wide as its widest entry and on
    // Track Width the two lists sit one above the other, so the inconsistency
    // is visible — and it is upstream's, not a typo of ours to tidy away.
    expect(LEN_UNITS[1]?.label).toBe('um');
    expect(THICK_UNITS[1]?.label).toBe('µm');
    expect(LEN_UNITS[1]?.label).not.toBe(THICK_UNITS[1]?.label);
  });

  it('LEN and LEN_CABLE are different lists', () => {
    expect(LEN_UNITS.map((u) => u.label)).not.toStrictEqual(CABLE_LEN_UNITS.map((u) => u.label));
  });
});

describe('unitIndex', () => {
  it('finds a label', () => {
    expect(unitIndex(THICK_UNITS, 'µm')).toBe(1);
    expect(unitIndex(LEN_UNITS, 'mil')).toBe(3);
  });

  it('falls back to the first entry rather than to -1', () => {
    // A -1 reaching `units[idx]` would silently scale by 1 — metres where
    // millimetres were meant, a factor of a thousand.
    expect(unitIndex(LEN_UNITS, 'furlong')).toBe(0);
  });
});
