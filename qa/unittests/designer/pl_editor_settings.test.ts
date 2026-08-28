// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pl_editor.json` — the Drawing Sheet Editor's own settings file.
 *
 * Every value here was session state until now: the units, the grid, the
 * crosshair, the background, the coordinate origin, the Properties pane width
 * and the preview page were seeded from literals on every mount and written
 * nowhere, so switching to millimetres and reloading snapped back to mils.
 *
 * The three rules that are easiest to get wrong, and are pinned below:
 *
 *  - the default is **MILS**, because `app_settings.cpp:228-238` names
 *    `pl_editor` alongside eeschema and the symbol editor in the imperial
 *    branch. It is not a value to "fix" to millimetres;
 *  - the title-block display mode is deliberately **not** persisted. No
 *    parameter binds `DS_DATA_MODEL::m_EditMode`, and `pl_editor_frame.cpp:105`
 *    forces it true on every construction, so a restart always comes back in
 *    edit mode;
 *  - a custom page edge loses its fraction of a mil on the way out
 *    (`double` on PAGE_INFO, `int` in the settings object) and is floored at
 *    10 mils on the way in.
 */
import { describe, it, expect } from 'vitest';
import {
  deepMerge,
  PL_EDITOR_DEFAULTS,
  SettingsManager,
  type PlEditorSettings,
} from '@ziroeda/designer/src/prefs/settings.js';
import {
  applyToggle,
  persistToggle,
  switchUnits,
  toggleIdUnits,
  toggleUnitsId,
  DEFAULT_TOGGLES,
  togglesFromSettings,
  unitsToggleId,
} from '@ziroeda/designer/src/editors/drawingsheet/toggles.js';
import {
  previewSettingsFromConfig,
  writePageToConfig,
} from '@ziroeda/designer/src/editors/drawingsheet/preview_settings.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cfg = (): PlEditorSettings => structuredClone(PL_EDITOR_DEFAULTS);

describe('the shipped defaults are KiCad’s', () => {
  it('opens in mils, the imperial branch pl_editor is named in', () => {
    // common/settings/app_settings.cpp:228-238 — `if( m_filename == "pl_editor"
    // || eeschema || symbol_editor ) -> EDA_UNITS::MILS`.
    expect(PL_EDITOR_DEFAULTS.system.units).toBe('mils');
  });

  it('remembers MM and MILS as the last of each family', () => {
    // app_settings.cpp:240-241 and :243-244. `last_imperial_units` is MILS and
    // NOT `COMMON_TOOLS`' `m_imperialUnit( EDA_UNITS::INCH )` ctor seed:
    // setupUnits (eda_draw_frame.cpp:1385) overwrites that seed with this.
    expect(PL_EDITOR_DEFAULTS.system.last_metric_units).toBe('mm');
    expect(PL_EDITOR_DEFAULTS.system.last_imperial_units).toBe('mils');
  });

  it('opens on grid index 4 — 0.50 mm — with the grid shown', () => {
    // defaultGridIdx, app_settings.cpp:468-471; window.grid.show, :555-556.
    expect(PL_EDITOR_DEFAULTS.window.grid.last_size_idx).toBe(4);
    expect(PL_EDITOR_DEFAULTS.window.grid.show).toBe(true);
  });

  it('opens on the small cross, always shown', () => {
    // app_settings.cpp:564-565, :567-568.
    expect(PL_EDITOR_DEFAULTS.window.cursor.crosshair).toBe('small');
    expect(PL_EDITOR_DEFAULTS.window.cursor.always_show_cursor).toBe(true);
  });

  it('carries pl_editor_settings.cpp’s own seven', () => {
    // pagelayout_editor/pl_editor_settings.cpp:45-58, in file order.
    expect(PL_EDITOR_DEFAULTS.properties_frame_width).toBe(150);
    expect(PL_EDITOR_DEFAULTS.corner_origin).toBe(0);
    expect(PL_EDITOR_DEFAULTS.black_background).toBe(false);
    expect(PL_EDITOR_DEFAULTS.last_paper_size).toBe('A3');
    expect(PL_EDITOR_DEFAULTS.last_custom_width).toBe(17000);
    expect(PL_EDITOR_DEFAULTS.last_custom_height).toBe(11000);
    expect(PL_EDITOR_DEFAULTS.last_was_portrait).toBe(false);
  });
});

describe('replaying the file onto the toolbar', () => {
  it('a fresh profile shows mils, the grid, and edit mode', () => {
    expect([...togglesFromSettings(cfg())].sort()).toEqual([
      'layoutEditMode',
      'toggleGrid',
      'unitsMils',
    ]);
  });

  /**
   * The frame boots from `togglesFromSettings( settings.plEditor )`, so this
   * is the value it actually shows and not a second copy of the answer.
   */
  it('DEFAULT_TOGGLES is that set, derived rather than restated', () => {
    expect([...DEFAULT_TOGGLES].sort()).toEqual(['layoutEditMode', 'toggleGrid', 'unitsMils']);
  });

  it('brings back millimetres', () => {
    const s = cfg();
    s.system.units = 'mm';
    expect(togglesFromSettings(s).has('unitsMm')).toBe(true);
    expect(togglesFromSettings(s).has('unitsMils')).toBe(false);
  });

  it('brings back inches', () => {
    const s = cfg();
    s.system.units = 'in';
    expect(togglesFromSettings(s).has('unitsInches')).toBe(true);
  });

  it('brings back a hidden grid and a full-window crosshair', () => {
    const s = cfg();
    s.window.grid.show = false;
    s.window.cursor.crosshair = 'full';
    const t = togglesFromSettings(s);
    expect(t.has('toggleGrid')).toBe(false);
    expect(t.has('crosshairFull')).toBe(true);
  });

  it('lands a unit a frame cannot display on millimetres', () => {
    // setupUnits' switch (eda_draw_frame.cpp:1390-1396) puts `default:` on the
    // MM arm — the corrupt-file case, which is not the fresh-profile case.
    const s = cfg();
    s.system.units = 'um';
    expect(togglesFromSettings(s).has('unitsMm')).toBe(true);
  });

  it('always comes back in title-block edit mode', () => {
    // pl_editor_frame.cpp:105 sets m_EditMode = true unconditionally and no
    // parameter binds it, so this cannot be turned off by a settings file.
    const s = cfg();
    expect(togglesFromSettings(s).has('layoutEditMode')).toBe(true);
    expect(togglesFromSettings(s).has('layoutNormalMode')).toBe(false);
  });
});

describe('the unit group is a radio group', () => {
  it('replaces its group rather than adding to it', () => {
    const t = applyToggle(new Set(['unitsMils', 'toggleGrid']), 'unitsMm');
    expect(t.has('unitsMm')).toBe(true);
    expect(t.has('unitsMils')).toBe(false);
    expect(t.has('toggleGrid')).toBe(true);
  });

  it('re-activating the unit already in force leaves it in force', () => {
    expect(applyToggle(new Set(['unitsMm']), 'unitsMm').has('unitsMm')).toBe(true);
  });

  it('flips anything that is not a unit', () => {
    expect(applyToggle(new Set(['toggleGrid']), 'toggleGrid').has('toggleGrid')).toBe(false);
    expect(applyToggle(new Set(), 'crosshairFull').has('crosshairFull')).toBe(true);
  });
});

describe('a button press reaching the settings file', () => {
  it('flips window.grid.show, reading its own current value', () => {
    // COMMON_TOOLS::ToggleGrid — SetGridVisibility( !IsGridVisible() ),
    // common_tools.cpp:595-598, both halves through the settings object.
    const s = cfg();
    expect(persistToggle(s, 'toggleGrid')).toBe(true);
    expect(s.window.grid.show).toBe(false);
    persistToggle(s, 'toggleGrid');
    expect(s.window.grid.show).toBe(true);
  });

  it('flips the crosshair between small and full', () => {
    const s = cfg();
    persistToggle(s, 'crosshairFull');
    expect(s.window.cursor.crosshair).toBe('full');
    persistToggle(s, 'crosshairFull');
    expect(s.window.cursor.crosshair).toBe('small');
  });

  it('moves only the family the new unit belongs to', () => {
    // COMMON_TOOLS::SwitchUnits, common_tools.cpp:656-668.
    const s = cfg();
    persistToggle(s, 'unitsInches');
    expect(s.system.units).toBe('in');
    expect(s.system.last_imperial_units).toBe('in');
    expect(s.system.last_metric_units).toBe('mm');

    persistToggle(s, 'unitsMm');
    expect(s.system.units).toBe('mm');
    expect(s.system.last_metric_units).toBe('mm');
    expect(s.system.last_imperial_units).toBe('in');
  });

  it('leaves the settings alone for a session-only button', () => {
    const s = cfg();
    expect(persistToggle(s, 'layoutEditMode')).toBe(false);
    expect(persistToggle(s, 'layoutNormalMode')).toBe(false);
    expect(s).toEqual(PL_EDITOR_DEFAULTS);
  });
});

describe('Ctrl+U swaps families and returns to the last member of the other', () => {
  it('goes to the last metric unit from an imperial one', () => {
    // COMMON_TOOLS::ToggleUnits, common_tools.cpp:671-677.
    expect(toggleUnitsId(cfg())).toBe('unitsMm');
  });

  it('comes back to inches once inches have been used', () => {
    const s = cfg();
    switchUnits(s, 'unitsInches');
    switchUnits(s, 'unitsMm');
    expect(toggleUnitsId(s)).toBe('unitsInches');
  });

  it('comes back to mils when mils were the last imperial unit', () => {
    const s = cfg();
    switchUnits(s, 'unitsInches');
    switchUnits(s, 'unitsMils');
    switchUnits(s, 'unitsMm');
    expect(toggleUnitsId(s)).toBe('unitsMils');
  });
});

describe('the unit id and the EDA_UNITS member map both ways', () => {
  it('round-trips the three a frame can display', () => {
    expect(unitsToggleId('mm')).toBe('unitsMm');
    expect(unitsToggleId('in')).toBe('unitsInches');
    expect(unitsToggleId('mils')).toBe('unitsMils');
    expect(toggleIdUnits('unitsMm')).toBe('mm');
    expect(toggleIdUnits('unitsInches')).toBe('in');
    expect(toggleIdUnits('unitsMils')).toBe('mils');
  });
});

describe('the preview page half of Load/SaveSettings', () => {
  it('restores A3 landscape and the 17000 x 11000 mil custom size', () => {
    // pl_editor_frame.cpp:543-548. 17000 mils = 431.8 mm, 11000 = 279.4 mm.
    const p = previewSettingsFromConfig(cfg());
    expect(p.paper).toBe('A3');
    expect(p.portrait).toBe(false);
    expect(p.customWidthMM).toBeCloseTo(431.8, 9);
    expect(p.customHeightMM).toBeCloseTo(279.4, 9);
  });

  it('restores a page that is NOT the default', () => {
    // The test above cannot fail on its own: `previewSettingsFromConfig`
    // starts from `defaultPreviewSettings()`, whose paper is already A3
    // landscape, so deleting the two lines that read the stored page leaves it
    // green. The mutation sweep found exactly that. A stored page has to be a
    // page the defaults do not already supply.
    const s = cfg();
    s.last_paper_size = 'A4';
    s.last_was_portrait = true;
    s.last_custom_width = 8000;
    s.last_custom_height = 6000;
    const p = previewSettingsFromConfig(s);
    expect(p.paper).toBe('A4');
    expect(p.portrait).toBe(true);
    expect(p.customWidthMM).toBeCloseTo(203.2, 9); // 8000 mils
    expect(p.customHeightMM).toBeCloseTo(152.4, 9); // 6000 mils
  });

  it('leaves the title block blank — nothing persists it', () => {
    const s = cfg();
    const p = previewSettingsFromConfig(s);
    expect(p.title).toBe('');
    expect(p.company).toBe('');
    expect(p.date).toBe('');
    expect(p.rev).toBe('');
    expect(p.comments).toEqual(['', '', '', '', '', '', '', '', '']);
  });

  it('writes the paper, the orientation and the two edges', () => {
    const s = cfg();
    writePageToConfig(s, {
      ...previewSettingsFromConfig(s),
      paper: 'User',
      portrait: true,
      customWidthMM: 254, // 10000 mils
      customHeightMM: 127, // 5000 mils
    });
    expect(s.last_paper_size).toBe('User');
    expect(s.last_was_portrait).toBe(true);
    expect(s.last_custom_width).toBe(10000);
    expect(s.last_custom_height).toBe(5000);
  });

  it('loses the fraction of a mil, the way the int assignment does', () => {
    // `int m_LastCustomWidth` (pl_editor_settings.h:45) takes a `double`
    // GetCustomWidthMils() (include/page_info.h:197), so it truncates. A file
    // holding more precision than KiCad's would restore a page KiCad cannot.
    const s = cfg();
    // 100.0127 mm is 3937.5 mils exactly.
    writePageToConfig(s, { ...previewSettingsFromConfig(s), customWidthMM: 100.0127 });
    expect(s.last_custom_width).toBe(3937);
  });

  it('floors a custom edge at 10 mils on the way back in', () => {
    // clampWidth / clampHeight, common/page_info.cpp:180-195.
    const s = cfg();
    s.last_custom_width = 3;
    s.last_custom_height = 0;
    const p = previewSettingsFromConfig(s);
    expect(p.customWidthMM).toBeCloseTo(0.254, 9);
    expect(p.customHeightMM).toBeCloseTo(0.254, 9);
  });
});

/** An in-memory Storage, so no test touches a real localStorage. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe('the settings survive a reload', () => {
  it('a second manager reads back everything the first wrote', () => {
    globalThis.localStorage = fakeStorage();

    const first = new SettingsManager();
    first.updatePlEditor((s) => {
      s.system.units = 'mm';
      s.system.last_imperial_units = 'in';
      s.window.grid.last_size_idx = 7;
      s.window.grid.show = false;
      s.window.cursor.crosshair = 'full';
      s.properties_frame_width = 312;
      s.corner_origin = 3;
      s.black_background = true;
      s.last_paper_size = 'A4';
      s.last_was_portrait = true;
      s.last_custom_width = 9000;
      s.last_custom_height = 6000;
    });

    // A fresh manager is a fresh page load: it reads the store from scratch.
    const second = new SettingsManager();
    expect(second.plEditor.system.units).toBe('mm');
    expect(second.plEditor.system.last_imperial_units).toBe('in');
    expect(second.plEditor.system.last_metric_units).toBe('mm');
    expect(second.plEditor.window.grid.last_size_idx).toBe(7);
    expect(second.plEditor.window.grid.show).toBe(false);
    expect(second.plEditor.window.cursor.crosshair).toBe('full');
    expect(second.plEditor.properties_frame_width).toBe(312);
    expect(second.plEditor.corner_origin).toBe(3);
    expect(second.plEditor.black_background).toBe(true);
    expect(second.plEditor.last_paper_size).toBe('A4');
    expect(second.plEditor.last_was_portrait).toBe(true);
    expect(second.plEditor.last_custom_width).toBe(9000);
    expect(second.plEditor.last_custom_height).toBe(6000);
  });

  it('the reloaded file drives the toolbar back to millimetres', () => {
    globalThis.localStorage = fakeStorage();

    const first = new SettingsManager();
    // What the user actually does: press the millimetres button.
    first.updatePlEditor((s) => {
      persistToggle(s, 'unitsMm');
    });

    const reloaded = togglesFromSettings(new SettingsManager().plEditor);
    expect(reloaded.has('unitsMm')).toBe(true);
    expect(reloaded.has('unitsMils')).toBe(false);
  });

  it('a rewrite of one field leaves the rest of the record standing', () => {
    globalThis.localStorage = fakeStorage();

    const first = new SettingsManager();
    first.updatePlEditor((s) => {
      s.corner_origin = 2;
    });
    first.updatePlEditor((s) => {
      s.black_background = true;
    });

    const second = new SettingsManager();
    expect(second.plEditor.corner_origin).toBe(2);
    expect(second.plEditor.black_background).toBe(true);
  });

  it('keeps the default when the stored value is the wrong type', () => {
    // The store is hand-editable and survives across versions; a string where
    // a number belongs reaches the renderer and throws before React mounts.
    const damaged = deepMerge(structuredClone(PL_EDITOR_DEFAULTS), {
      properties_frame_width: 'wide',
      corner_origin: 4,
    });
    expect(damaged.properties_frame_width).toBe(150);
    expect(damaged.corner_origin).toBe(4);
  });
});

const CANVAS = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/drawingsheet/DrawingSheetCanvas.tsx', import.meta.url),
  ),
  'utf8',
);

const EDITOR = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx', import.meta.url),
  ),
  'utf8',
);

/**
 * The wiring itself. Every rule above is a pure function, and a pure function
 * that nothing calls passes its tests forever — the editor lives in a `.tsx`
 * and `qa` has no DOM, so reading it as text is the only way to see that the
 * store is actually reached. Crude, and it is the check that would catch a
 * revert to component-local state.
 */
describe('the editor reads and writes the store', () => {
  it('seeds its toolbar from the settings rather than a literal', () => {
    expect(EDITOR).toContain('togglesFromSettings(settings.plEditor)');
    // The old local set, which is what made every toggle session-only.
    expect(EDITOR).not.toContain('const DEFAULT_TOGGLES = new Set([');
  });

  it('seeds every other control from the settings too', () => {
    for (const seed of [
      'previewSettingsFromConfig(settings.plEditor)',
      'settings.plEditor.corner_origin',
      'settings.plEditor.properties_frame_width',
      'settings.plEditor.window.grid.last_size_idx',
    ]) {
      expect(EDITOR, `${seed} must seed a control`).toContain(seed);
    }
  });

  it('reads black_background, but no control writes it — as upstream', () => {
    /*
     * `black_background` is the one setting in this file with no user interface
     * at all. `LoadSettings` turns it into the canvas colour
     * (`SetDrawBgColor( cfg->m_BlackBackground ? BLACK : WHITE )`,
     * pl_editor_frame.cpp:541) and `SaveSettings` writes back whatever colour
     * the canvas has (:562) — and nothing else in `pagelayout_editor` ever
     * calls `SetDrawBgColor`, so no action, menu item or Preferences control
     * can move it. Grep the reference tree: the only other hits are the two
     * lines of the printout that force white paper.
     *
     * We had invented a checkbox for it. This expectation moved from "a
     * control is seeded from it and writes it back" to "it is read and never
     * written", and the derivation for the new one is the paragraph above, not
     * what the code now happens to print.
     */
    expect(EDITOR).toContain('plCfg.black_background');
    expect(EDITOR).not.toContain('s.black_background =');
    // The checkbox's prop. The LABEL is asserted in ds_preferences.test.ts,
    // which filters comments out first — this file does not, and the comment
    // recording why the control was removed names it.
    expect(EDITOR).not.toContain('onBlackBackground');
  });

  it('takes the always-show crosshair from the settings, not a literal', () => {
    // The canvas drew the crosshair with `alwaysShow: true` hardcoded, under a
    // comment naming `always_show_cursor` — the value KiCad reads out of its
    // settings object (app_settings.cpp:564-565) written as a literal at the
    // call site instead. Both halves have to exist: the canvas has to read a
    // prop, and the editor has to feed it from the file.
    expect(CANVAS).toContain('alwaysShow: alwaysShowCursor');
    expect(CANVAS).not.toContain('alwaysShow: true');
    expect(EDITOR).toContain('alwaysShowCursor={plCfg.window.cursor.always_show_cursor}');
  });

  it('writes each of them back', () => {
    for (const write of [
      'persistToggle(s, id)',
      's.corner_origin = idx',
      's.properties_frame_width = w',
      's.window.grid.last_size_idx = idx',
      // `s.black_background = on` is deliberately absent — see above.
      's.window.cursor.crosshair = mode',
      's.window.cursor.always_show_cursor = v',
      'writePageToConfig(s, next)',
    ]) {
      expect(EDITOR, `${write} must reach updatePlEditor`).toContain(write);
    }
  });
});
