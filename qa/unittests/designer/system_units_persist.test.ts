// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `system.units`, and the assumption that hid its absence for four editors.
 *
 * `APP_SETTINGS_BASE::LoadFromFile` registers the PARAM unconditionally:
 *
 *     if( m_filename == wxS( "pl_editor" )
 *         || ( m_filename == wxS( "eeschema" ) || m_filename == wxS( "symbol_editor" ) ) )
 *         m_params.emplace_back( new PARAM<int>( "system.units", &m_System.units, MILS ) );
 *     else
 *         m_params.emplace_back( new PARAM<int>( "system.units", &m_System.units, MM ) );
 *     (`common/settings/app_settings.cpp:228-238`)
 *
 * The conditional picks the DEFAULT. Both arms register the key. `pl_editor`
 * and `gerbview` carried it here and `eeschema` and `symbol_editor` did not,
 * which read as "an extra those two apps have" and is not — it is the same key
 * with a different default, and the default is exactly what made the omission
 * invisible. A frame that always opens in mils and never remembers otherwise
 * looks right until you switch it.
 *
 * Two consequences, and the second is the one a user sees:
 *
 *  1. the toolbar's unit was session state, lost on reload;
 *  2. Preferences > Grids takes its `UNITS_PROVIDER` from the FRAME
 *     (`eeschema.cpp:254-268`, `:320-324`), so every grid row prints in the
 *     frame's live unit. With nothing storing it, those two pages read a
 *     constant and printed mils however the toolbar was set.
 *
 * `COMMON_TOOLS::SwitchUnits` and `ToggleUnits` are one tool on the shared
 * TOOL_MANAGER, so they are one module here — they had been copied into
 * `drawingsheet/toggles.ts` and inlined again in `gerbview/toggles.ts`, and the
 * gerbview copy had dropped the `last_*_units` half.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  EESCHEMA_DEFAULTS,
  GERBVIEW_DEFAULTS,
  PL_EDITOR_DEFAULTS,
  SYMBOL_EDITOR_DEFAULTS,
} from '@ziroeda/designer/src/prefs/settings.js';
import {
  isImperialUnits,
  switchUnits,
  toggleUnitsId,
  unitsToggleId,
  type UnitsSlice,
} from '@ziroeda/designer/src/ui/app_settings_units.js';
import {
  persistSymbolToggle,
  symbolTogglesFromSettings,
} from '@ziroeda/designer/src/editors/symbol/toggles.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/**
 * The same file with comments stripped.
 *
 * A negative assertion over raw source is satisfied — or broken — by the note
 * explaining the fix, which is how a check ends up testing prose. Both of these
 * files now carry `defaultUnits(` in a comment saying they used to call it.
 */
const code = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
const symCfg = (): typeof SYMBOL_EDITOR_DEFAULTS =>
  structuredClone(SYMBOL_EDITOR_DEFAULTS) as typeof SYMBOL_EDITOR_DEFAULTS;

describe('every app stores it, and the branch only picks the default', () => {
  it('all four settings objects carry the slice', () => {
    for (const [name, d] of [
      ['eeschema', EESCHEMA_DEFAULTS],
      ['symbol_editor', SYMBOL_EDITOR_DEFAULTS],
      ['pl_editor', PL_EDITOR_DEFAULTS],
      ['gerbview', GERBVIEW_DEFAULTS],
    ] as const) {
      expect(d.system.units, name).toBeDefined();
      expect(d.system.last_metric_units, name).toBe('mm');
      expect(d.system.last_imperial_units, name).toBe('mils');
    }
  });

  it('the three named apps default imperial and everything else metric', () => {
    // The `:228-238` conditional, which is about the DEFAULT and nothing else.
    expect(EESCHEMA_DEFAULTS.system.units).toBe('mils');
    expect(SYMBOL_EDITOR_DEFAULTS.system.units).toBe('mils');
    expect(PL_EDITOR_DEFAULTS.system.units).toBe('mils');
    expect(GERBVIEW_DEFAULTS.system.units).toBe('mm');
  });
});

describe('COMMON_TOOLS::SwitchUnits / ToggleUnits, once', () => {
  const slice = (): UnitsSlice => ({
    units: 'mils',
    last_metric_units: 'mm',
    last_imperial_units: 'mils',
  });

  it('IsImperialUnit is INCH and MILS, not INCH alone', () => {
    expect(isImperialUnits('in')).toBe(true);
    expect(isImperialUnits('mils')).toBe(true);
    expect(isImperialUnits('mm')).toBe(false);
  });

  it('remembers the choice as the last of its OWN family, and only that one', () => {
    const c = slice();
    switchUnits(c, 'unitsInches');
    expect(c.units).toBe('in');
    expect(c.last_imperial_units).toBe('in');
    expect(c.last_metric_units, 'the other family must not move').toBe('mm');
  });

  it('Ctrl+U crosses to the other family’s last member, BOTH ways', () => {
    const c = slice();
    switchUnits(c, 'unitsInches'); // imperial family now remembers inches
    switchUnits(c, 'unitsMm'); // cross over
    expect(c.units).toBe('mm');
    // From metric it lands on INCHES, not on the mils it started at — the
    // point of `last_imperial_units` being a stored setting rather than
    // COMMON_TOOLS' constructor seed.
    expect(toggleUnitsId(c)).toBe('unitsInches');

    // And from IMPERIAL it must land on the metric one. Testing only the first
    // direction is not enough: a `toggleUnitsId` that ignores its argument and
    // always returns `last_imperial_units` passes that half, which is exactly
    // what the mutant did.
    switchUnits(c, 'unitsInches');
    expect(isImperialUnits(c.units)).toBe(true);
    expect(toggleUnitsId(c)).toBe('unitsMm');
  });

  it('maps every unit to its toolbar id and back', () => {
    expect(unitsToggleId('in')).toBe('unitsInches');
    expect(unitsToggleId('mils')).toBe('unitsMils');
    expect(unitsToggleId('mm')).toBe('unitsMm');
  });
});

describe('the symbol editor remembers its unit', () => {
  it('opens on system.units, not on the app default', () => {
    const c = symCfg();
    c.system.units = 'mm';
    expect(symbolTogglesFromSettings(c).has('unitsMm')).toBe(true);
    expect(symbolTogglesFromSettings(c).has('unitsMils')).toBe(false);
  });

  it('picking a unit writes the file, and re-picking the same one does not', () => {
    // The radio-group rule: it REPLACES rather than flips, so the button
    // already lit is not a write — which is what keeps a mount from committing
    // symbol_editor.json and waking the account sync.
    const c = symCfg();
    expect(persistSymbolToggle(c, 'unitsMm')).toBe(true);
    expect(c.system.units).toBe('mm');
    expect(persistSymbolToggle(c, 'unitsMm')).toBe(false);
  });
});

describe('Preferences > Grids asks the frame, not a constant', () => {
  it('both schematic-side Grids pages read the stored unit', () => {
    // The bug: `toStatusUnits(defaultUnits('eeschema'))` cannot change, so the
    // page printed mils however the toolbar was set.
    for (const [rel, expr] of [
      ['editors/symbol/prefs/PanelSymbolEditorGrids.tsx', 'symbolEditor.system.units'],
      ['editors/schematic/prefs/PanelEeschemaGrids.tsx', 'eeschema.system.units'],
    ] as const) {
      const src = read(rel);
      expect(src, rel).toContain(`units={toStatusUnits(${expr})}`);
      expect(code(rel), `${rel} still reads a constant`).not.toContain('defaultUnits(');
    }
  });

  it('all four Grids pages now read their own app’s stored unit', () => {
    for (const [rel, expr] of [
      ['editors/symbol/prefs/PanelSymbolEditorGrids.tsx', 'symbolEditor.system.units'],
      ['editors/schematic/prefs/PanelEeschemaGrids.tsx', 'eeschema.system.units'],
      ['editors/drawingsheet/prefs/PanelPlEditorGrids.tsx', 'plEditor.system.units'],
      ['editors/gerbview/prefs/PanelGerbviewGrids.tsx', 'gerbview.system.units'],
    ] as const) {
      expect(read(rel), rel).toContain(`units={toStatusUnits(${expr})}`);
    }
  });
});

describe('one copy of the unit actions', () => {
  it('no editor re-implements the family bookkeeping', () => {
    // `drawingsheet/toggles.ts` had its own `isImperial` + `switchUnits`, and
    // `gerbview/toggles.ts` inlined the mapping both ways — and dropped the
    // `last_*_units` half, so Ctrl+U there came back to the default rather
    // than to the unit actually used last.
    for (const rel of [
      'editors/drawingsheet/toggles.ts',
      'editors/gerbview/toggles.ts',
      'editors/symbol/toggles.ts',
    ]) {
      const src = read(rel);
      expect(src, `${rel} declares its own isImperial`).not.toMatch(/function isImperial\b/);
      expect(src, `${rel} does not use the shared module`).toContain(
        "from '../../ui/app_settings_units.js'",
      );
    }
  });

  it('gerbview goes through switchUnits, so its last_* fields move', () => {
    const src = read('editors/gerbview/toggles.ts');
    expect(src).toContain('switchUnits(cfg.system, unitsId)');
  });
});
