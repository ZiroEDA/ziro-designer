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
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
  deepMerge,
  PL_EDITOR_DEFAULTS,
  SettingsManager,
  type PlEditorSettings,
} from '@ziroeda/designer/src/prefs/settings.js';
import {
  ACTION_FOR_ID,
  loadPlEditorSettings,
  storePlEditorSettings,
  uiState,
} from '@ziroeda/pagelayout_editor/pl_editor_settings_bridge.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import { CROSS_HAIR_MODE } from '@ziroeda/common/gal/gal_display_options.js';
import { PAGE_INFO } from '@ziroeda/common/page_info.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { EDA_UNITS_INT } from '@ziroeda/common/settings/app_settings.js';
import { toggleIdUnits, unitsToggleId } from '@ziroeda/common/settings/app_settings_units.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { PL_ACTIONS } from '@ziroeda/pagelayout_editor/tools/pl_actions.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Harness, makeHarness } from '../pagelayout_editor/pl_editor_fixture.js';

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

/** A frame over `aJson`, loaded as the page loads it. */
function frameOver(aJson: PlEditorSettings): Harness {
  return makeHarness(EDA_UNITS_INT.MILS, 0, (c) => loadPlEditorSettings(c, aJson));
}

/** `pl_editor.json` as the page would store it after the frame's SaveSettings. */
function stored(h: Harness, aJson = cfg()): { json: PlEditorSettings; changed: boolean } {
  h.frame.SaveSettings(h.cfg);
  const changed = storePlEditorSettings(h.cfg, aJson);
  return { json: aJson, changed };
}

let model: DS_DATA_MODEL;

beforeEach(() => {
  SetPgm(new PGM_BASE());
  model = new DS_DATA_MODEL();
  DS_DATA_MODEL.SetAltInstance(model);
});

afterEach(() => {
  DS_DATA_MODEL.SetAltInstance(null);
  SetPgm(null);
});

describe('replaying the file onto the frame (setupUnits, LoadSettings)', () => {
  it('a fresh profile shows mils, the grid, the arrow and edit mode', () => {
    const h = frameOver(cfg());

    expect([...uiState(h.frame, ACTION_FOR_ID).checked].sort()).toEqual([
      'layoutEditMode',
      'select',
      'toggleGrid',
      'unitsMils',
    ]);
  });

  it('brings back millimetres', () => {
    const s = cfg();
    s.system.units = 'mm';
    const checked = uiState(frameOver(s).frame, ACTION_FOR_ID).checked;
    expect(checked.has('unitsMm')).toBe(true);
    expect(checked.has('unitsMils')).toBe(false);
  });

  it('brings back inches', () => {
    const s = cfg();
    s.system.units = 'in';
    expect(uiState(frameOver(s).frame, ACTION_FOR_ID).checked.has('unitsInches')).toBe(true);
  });

  it('brings back a hidden grid and a full-window crosshair', () => {
    const s = cfg();
    s.window.grid.show = false;
    s.window.cursor.crosshair = 'full';
    const h = frameOver(s);

    expect(uiState(h.frame, ACTION_FOR_ID).checked.has('toggleGrid')).toBe(false);
    expect(h.frame.GetGalDisplayOptions().m_crossHairMode).toBe(CROSS_HAIR_MODE.FULLSCREEN_CROSS);
  });

  it('lands a unit a frame cannot display on millimetres', () => {
    // setupUnits' switch (eda_draw_frame.cpp:1390-1396) puts `default:` on the
    // MM arm - the corrupt-file case, which is not the fresh-profile case.
    const s = cfg();
    s.system.units = 'um';
    expect(frameOver(s).frame.GetUserUnits()).toBe('mm');
  });

  it('always comes back in title-block edit mode', () => {
    // pl_editor_frame.cpp:105 sets m_EditMode = true unconditionally and no
    // parameter binds it, so this cannot be turned off by a settings file.
    model.m_EditMode = false;
    const checked = uiState(frameOver(cfg()).frame, ACTION_FOR_ID).checked;
    expect(checked.has('layoutEditMode')).toBe(true);
    expect(checked.has('layoutNormalMode')).toBe(false);
  });
});

describe('a button press reaching the settings file', () => {
  it('flips window.grid.show, reading its own current value', () => {
    // COMMON_TOOLS::ToggleGrid - SetGridVisibility( !IsGridVisible() ),
    // common_tools.cpp:595-598, both halves through the settings object.
    const h = frameOver(cfg());

    h.mgr.RunAction(ACTIONS.toggleGrid);
    expect(stored(h).json.window.grid.show).toBe(false);

    h.mgr.RunAction(ACTIONS.toggleGrid);
    expect(stored(h).json.window.grid.show).toBe(true);
  });

  it('moves only the family the new unit belongs to', () => {
    // COMMON_TOOLS::SwitchUnits, common_tools.cpp:656-668.
    const h = frameOver(cfg());

    h.mgr.RunAction(ACTIONS.inchesUnits);
    let s = stored(h).json;
    expect(s.system.units).toBe('in');
    expect(s.system.last_imperial_units).toBe('in');
    expect(s.system.last_metric_units).toBe('mm');

    h.mgr.RunAction(ACTIONS.millimetersUnits);
    s = stored(h).json;
    expect(s.system.units).toBe('mm');
    expect(s.system.last_metric_units).toBe('mm');
    expect(s.system.last_imperial_units).toBe('in');
  });

  it('leaves the settings alone for a session-only button', () => {
    const h = frameOver(cfg());

    h.mgr.RunAction(PL_ACTIONS.layoutNormalMode);
    h.mgr.RunAction(PL_ACTIONS.layoutEditMode);

    const { json, changed } = stored(h);
    expect(changed).toBe(false);
    expect(json).toEqual(PL_EDITOR_DEFAULTS);
  });
});

describe('Ctrl+U swaps families and returns to the last member of the other', () => {
  it('goes to the last metric unit from an imperial one', () => {
    // COMMON_TOOLS::ToggleUnits, common_tools.cpp:671-677.
    const h = frameOver(cfg());
    h.mgr.RunAction(ACTIONS.toggleUnits);
    expect(h.frame.GetUserUnits()).toBe('mm');
  });

  it('comes back to inches once inches have been used, across a reload', () => {
    const h = frameOver(cfg());
    h.mgr.RunAction(ACTIONS.inchesUnits);
    h.mgr.RunAction(ACTIONS.millimetersUnits);

    const reloaded = frameOver(stored(h).json);
    reloaded.mgr.RunAction(ACTIONS.toggleUnits);
    expect(reloaded.frame.GetUserUnits()).toBe('in');
  });
});

describe('the page half of Load/SaveSettings (pl_editor_frame.cpp:543-548, :563-566)', () => {
  it('restores a page that is NOT the default', () => {
    const s = cfg();
    s.last_paper_size = 'A4';
    s.last_was_portrait = true;
    s.last_custom_width = 8000;
    s.last_custom_height = 6000;
    const h = frameOver(s);

    expect(h.frame.GetPageSettings().GetTypeAsString()).toBe('A4');
    expect(h.frame.GetPageSettings().IsPortrait()).toBe(true);
    expect(PAGE_INFO.GetCustomWidthMils()).toBe(8000);
    expect(PAGE_INFO.GetCustomHeightMils()).toBe(6000);
  });

  it('leaves the title block blank - nothing persists it', () => {
    const tb = frameOver(cfg()).frame.GetTitleBlock();
    expect([tb.GetTitle(), tb.GetCompany(), tb.GetDate(), tb.GetRevision()]).toEqual([
      '',
      '',
      '',
      '',
    ]);
    for (let i = 0; i < 9; i++) expect(tb.GetComment(i)).toBe('');
  });

  it('writes the paper, the orientation and the two edges', () => {
    const h = frameOver(cfg());
    PAGE_INFO.SetCustomWidthMils(10000);
    PAGE_INFO.SetCustomHeightMils(5000);
    const user = new PAGE_INFO();
    user.SetType('User', true);
    h.frame.SetPageSettings(user);

    const s = stored(h).json;
    expect(s.last_paper_size).toBe('User');
    expect(s.last_custom_width).toBe(10000);
    expect(s.last_custom_height).toBe(5000);
  });

  it('loses the fraction of a mil, the way the int assignment does', () => {
    // `int m_LastCustomWidth` (pl_editor_settings.h:45) takes a `double`
    // GetCustomWidthMils() (include/page_info.h:197), so it truncates.
    const h = frameOver(cfg());
    PAGE_INFO.SetCustomWidthMils(3937.5);
    expect(stored(h).json.last_custom_width).toBe(3937);
  });

  it('floors a custom edge at 10 mils on the way back in', () => {
    // clampWidth / clampHeight, common/page_info.cpp:180-195.
    const s = cfg();
    s.last_custom_width = 3;
    s.last_custom_height = 0;
    frameOver(s);
    expect(PAGE_INFO.GetCustomWidthMils()).toBe(10);
    expect(PAGE_INFO.GetCustomHeightMils()).toBe(10);
  });

  it('the corner origin and the Properties width go back into the file', () => {
    const h = frameOver(cfg());
    h.frame.GetOriginSelectBox().SetSelection(3);
    h.frame.OnSelectCoordOriginCorner();
    h.frame.GetPropertiesFrame()!.SetWidth(312);

    const s = stored(h).json;
    expect(s.corner_origin).toBe(3);
    expect(s.properties_frame_width).toBe(312);
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

  it('the reloaded file boots the frame in millimetres', () => {
    globalThis.localStorage = fakeStorage();

    const first = new SettingsManager();
    // What the millimetres button stores (storePlEditorSettings).
    first.updatePlEditor((s) => {
      s.system.units = 'mm';
    });

    expect(frameOver(new SettingsManager().plEditor).frame.GetUserUnits()).toBe('mm');
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

const EDITOR = readFileSync(
  fileURLToPath(new URL('../../../pagelayout_editor/pl_editor_frame_ui.tsx', import.meta.url)),
  'utf8',
);

/**
 * The two cursor controls live in `PANEL_GAL_OPTIONS`, where upstream has
 * always had them; the page's Preferences is the shared `PAGED_DIALOG`.
 */
const GAL_PANEL = readFileSync(
  fileURLToPath(new URL('../../../common/dialogs/panel_gal_options.tsx', import.meta.url)),
  'utf8',
);

const PREFS_SHELL = readFileSync(
  fileURLToPath(new URL('../../../designer/src/dialogs/PreferencesDialog.tsx', import.meta.url)),
  'utf8',
);

/**
 * The page's half of JSON_SETTINGS::Load / Store: the frame is built over the
 * slice, and what its tools write goes back into it. The rules above run on
 * the bridge and the frame; this is the check that the page calls them.
 */
describe('the page loads and stores through the bridge', () => {
  it('builds the frame over the settings slice', () => {
    expect(EDITOR).toContain('loadPlEditorSettings(cfg, appRef.current.GetPlEditorSettings());');
    expect(EDITOR).toContain('loadPlEditorSettings(frame.config(), plCfg);');
  });

  it('writes what the frame changed back through storePlEditorSettings', () => {
    expect(EDITOR).toContain('frame.SaveSettings(cfg);');
    expect(EDITOR).toContain('storePlEditorSettings(cfg, s);');
  });

  it('reads black_background, but no control writes it - as upstream', () => {
    /*
     * `black_background` has no user interface at all. `LoadSettings` turns it
     * into the draw colour (pl_editor_frame.cpp:541) and `SaveSettings` writes
     * back whatever colour that is (:562); nothing else in pagelayout_editor
     * calls `SetDrawBgColor`.
     */
    expect(EDITOR).toContain('plCfg.black_background');
    expect(EDITOR).not.toContain('s.black_background =');
    expect(EDITOR).not.toContain('onBlackBackground');
  });

  it('writes the two cursor settings back through the shared Preferences panel', () => {
    // `PANEL_GAL_OPTIONS::TransferDataFromWindow` (panel_gal_options.cpp:110-124).
    for (const write of ['w.cursor.crosshair = v', 'w.cursor.always_show_cursor = v'])
      expect(GAL_PANEL, `${write} must be written by PANEL_GAL_OPTIONS`).toContain(write);
    expect(PREFS_SHELL).toContain(
      'settings.updatePlEditor((s) => Object.assign(s, draft.plEditor));',
    );
  });
});
