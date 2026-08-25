// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which unit each drawing frame opens in.
 *
 * `APP_SETTINGS_BASE::APP_SETTINGS_BASE` registers `system.units` once, with a
 * default chosen by ONE branch on the settings filename
 * (`common/settings/app_settings.cpp:228-238`):
 *
 *     if( m_filename == wxS( "pl_editor" )
 *         || ( m_filename == wxS( "eeschema" ) || m_filename == wxS( "symbol_editor" ) ) )
 *         ... EDA_UNITS::MILS ...   // :231-232
 *     else
 *         ... EDA_UNITS::MM ...     // :236-237
 *
 * `EDA_UNITS` is `include/eda_units.h:47-62` — `MM = 1`, `MILS = 5`.
 *
 * Three of those filenames were restated by hand in five different frames, and
 * one of the five had picked the wrong arm: `SchematicEditor.tsx` booted
 * eeschema in **millimetres**. It survived because it lived in a `.tsx`, which
 * `qa`'s tsconfig does not compile, so no test could name the value.
 *
 * Every editor's boot set is asserted here — including the ones that were
 * already right — and each expectation is a literal, so a mutant that flips
 * `defaultUnits`' condition cannot compute the answer it is checked against.
 */
import { describe, expect, it } from 'vitest';
import {
  type AppSettingsName,
  defaultUnits,
  defaultUnitsToggle,
} from '@ziroeda/designer/src/ui/app_settings_units.js';
import { DEFAULT_TOGGLES as SCH_TOGGLES } from '@ziroeda/designer/src/editors/schematic/toggles.js';
import { DEFAULT_TOGGLES as SYM_TOGGLES } from '@ziroeda/designer/src/editors/symbol/toggles.js';
import { DEFAULT_TOGGLES as GBR_TOGGLES } from '@ziroeda/designer/src/editors/gerbview/toggles.js';
import { DEFAULT_TOGGLES as DS_TOGGLES } from '@ziroeda/designer/src/editors/drawingsheet/toggles.js';
import { DEFAULT_TOGGLES as FP_TOGGLES } from '@ziroeda/designer/src/editors/footprint/toggles.js';

/** The three unit buttons every `EDA_DRAW_FRAME` toolbar carries. */
const UNIT_IDS = ['unitsMm', 'unitsInches', 'unitsMils'] as const;

/** The unit id in a boot set, asserting there is exactly one. */
function bootUnit(toggles: Iterable<string>): string {
  const on = UNIT_IDS.filter((id) => [...toggles].includes(id));
  expect(on).toHaveLength(1);
  return on[0] as string;
}

describe("system.units' per-app default (app_settings.cpp:228-238)", () => {
  /**
   * The branch spelled out per filename. Both arms are represented, so a mutant
   * that returns one constant for everything fails on the other side.
   */
  it('puts pl_editor, eeschema and symbol_editor on the imperial side', () => {
    const table: Record<AppSettingsName, 'mm' | 'mils'> = {
      pl_editor: 'mils',
      eeschema: 'mils',
      symbol_editor: 'mils',
      pcbnew: 'mm',
      fpedit: 'mm',
      gerbview: 'mm',
      bitmap2component: 'mm',
      pcb_calculator: 'mm',
    };
    for (const [app, units] of Object.entries(table))
      expect(defaultUnits(app as AppSettingsName)).toBe(units);
  });

  /** The toolbar-id spelling of the same answer, per app. */
  it('spells the imperial arm unitsMils and the metric arm unitsMm', () => {
    expect(defaultUnitsToggle('pl_editor')).toBe('unitsMils');
    expect(defaultUnitsToggle('eeschema')).toBe('unitsMils');
    expect(defaultUnitsToggle('symbol_editor')).toBe('unitsMils');
    expect(defaultUnitsToggle('pcbnew')).toBe('unitsMm');
    expect(defaultUnitsToggle('fpedit')).toBe('unitsMm');
    expect(defaultUnitsToggle('gerbview')).toBe('unitsMm');
  });
});

describe('the unit each frame actually boots with', () => {
  /**
   * THE BUG. `SCH_EDIT_FRAME` reads `EESCHEMA_SETTINGS`, whose filename is
   * `"eeschema"` (`eeschema/eeschema_settings.cpp:177`) — the second name on
   * the imperial side of the branch. Ours had `'unitsMm'`, the other arm, so a
   * fresh schematic opened reading `mm` where a real eeschema reads `mils`.
   */
  it('opens the schematic editor in mils', () => {
    expect(bootUnit(SCH_TOGGLES)).toBe('unitsMils');
    expect(SCH_TOGGLES.has('unitsMm')).toBe(false);
  });

  /**
   * `SYMBOL_EDITOR_SETTINGS` passes `"symbol_editor"`
   * (`eeschema/symbol_editor/symbol_editor_settings.cpp:38`) — the third
   * imperial name. Already fixed; pinned here so the sweep covers it.
   */
  it('opens the symbol editor in mils', () => {
    expect(bootUnit(SYM_TOGGLES)).toBe('unitsMils');
  });

  /**
   * `PL_EDITOR_SETTINGS` passes `"pl_editor"`
   * (`pagelayout_editor/pl_editor_settings.cpp:34`) — the first imperial name.
   */
  it('opens the drawing sheet editor in mils', () => {
    expect(bootUnit(DS_TOGGLES)).toBe('unitsMils');
  });

  /**
   * `GERBVIEW_SETTINGS` passes `"gerbview"`
   * (`gerbview/gerbview_settings.cpp:40`), which is on neither imperial name,
   * so it takes the `else` arm.
   */
  it('opens gerbview in mm', () => {
    expect(bootUnit(GBR_TOGGLES)).toBe('unitsMm');
  });

  /**
   * `FOOTPRINT_EDITOR_SETTINGS` passes `"fpedit"`
   * (`pcbnew/footprint_editor_settings.cpp:46`) through
   * `PCB_VIEWERS_SETTINGS_BASE`'s forwarding constructor
   * (`pcbnew/pcbnew_settings.h:123-124`), so the branch sees `"fpedit"` and
   * takes the `else` arm.
   */
  it('opens the footprint editor in mm', () => {
    expect(bootUnit(FP_TOGGLES)).toBe('unitsMm');
  });

  /**
   * The two arms must really differ, or every assertion above passes on a
   * constant. eeschema and pcbnew are the two frames a user switches between
   * most, and they disagree upstream.
   */
  it('gives the schematic and the board different opening units', () => {
    expect(bootUnit(SCH_TOGGLES)).not.toBe(defaultUnitsToggle('pcbnew'));
  });
});
