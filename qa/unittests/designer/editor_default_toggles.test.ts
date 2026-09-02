// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What each drawing frame's left toolbar looks like the moment it opens.
 *
 * Every one of these sets is a transcription of settings KiCad seeds in its own
 * constructors, so every entry has a C++ line behind it. They were not testable
 * before: `PcbEditor.tsx` and `FootprintEditor.tsx` declared theirs inside the
 * component file, and `qa`'s tsconfig compiles `.ts` only — importing a *value*
 * out of a `.tsx` fails with TS6142. A default nothing can import is a default
 * nothing checks, and the sweep below found two wrong ones on the board editor
 * the first time it could read them.
 *
 * Each frame is asserted as a WHOLE sorted set, so changing *any* single entry
 * fails here — a "contains X" check would pass with a wrong neighbour sitting
 * beside it, which is exactly the shape of bug this file exists to catch. The
 * expectations are literals; nothing here calls the module to work out what it
 * should have said.
 *
 * The units member of each set is checked in `opening_units.test.ts` against
 * `APP_SETTINGS_BASE`'s branch; here it is simply part of the set.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyToggle as pcbApplyToggle,
  DEFAULT_TOGGLES as PCB_TOGGLES,
  RADIO_GROUPS as PCB_GROUPS,
} from '@ziroeda/designer/src/editors/pcb/toggles.js';
import {
  applyToggle as fpApplyToggle,
  DEFAULT_TOGGLES as FP_TOGGLES,
  RADIO_GROUPS as FP_GROUPS,
} from '@ziroeda/designer/src/editors/footprint/toggles.js';
import {
  applyToggle as schApplyToggle,
  DEFAULT_TOGGLES as SCH_TOGGLES,
  RADIO_GROUPS as SCH_GROUPS,
} from '@ziroeda/designer/src/editors/schematic/toggles.js';
import { DEFAULT_TOGGLES as GBR_TOGGLES } from '@ziroeda/designer/src/editors/gerbview/toggles.js';
import { DEFAULT_TOGGLES as DS_TOGGLES } from '@ziroeda/designer/src/editors/drawingsheet/toggles.js';
import {
  persistSymbolToggle,
  SYMBOL_SETTING_TOGGLES,
  symbolTogglesFromSettings,
} from '@ziroeda/designer/src/editors/symbol/toggles.js';
import { SYMBOL_EDITOR_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';

const sorted = (s: Iterable<string>): string[] => [...s].sort();

describe("PCB_EDIT_FRAME's opening toolbar state", () => {
  /**
   * Entry by entry:
   *
   *   toggleGrid         `window.grid.show` true        app_settings.cpp:555-556
   *   unitsMm            filename "pcbnew"              app_settings.cpp:228-238
   *                                                     pcbnew_settings.cpp:50
   *   crosshairSmall     CROSS_HAIR_MODE::SMALL_CROSS   gal_display_options.cpp:52
   *   lineModeFree       LEADER_MODE::DIRECT            pcbnew_settings.cpp:59
   *                      -> PCB_ACTIONS::lineModeFree   board_editor_control.cpp:364
   *   zoneDisplayFilled  ZONE_DISPLAY_MODE::SHOW_FILLED pcb_display_options.h:35
   *   showLayersManager  `aui.show_layer_manager` true  pcbnew_settings.cpp:78-79
   *   showProperties     `aui.show_properties` true     pcbnew_settings.cpp:110-111
   *
   * Two of those were wrong: ours had `lineMode90` (the DEG90 arm, which is no
   * pcbnew-family frame's default) and carried `ratsnestLineMode`, whose
   * condition is `m_Display.m_DisplayRatsnestLinesCurved`
   * (`pcb_edit_frame.cpp:1150-1155`), default **false**
   * (`pcbnew_settings.cpp:258-259`) — so a fresh board drew curved ratsnest
   * lines where KiCad draws straight ones.
   */
  it('is the seven buttons pcbnew seeds, and not ratsnestLineMode', () => {
    expect(sorted(PCB_TOGGLES)).toEqual([
      'crosshairSmall',
      'lineModeFree',
      'showLayersManager',
      'showProperties',
      'toggleGrid',
      'unitsMm',
      'zoneDisplayFilled',
    ]);
  });

  /** Exactly one member of each cycling group is in force at boot. */
  it('starts with one member of each radio group', () => {
    for (const group of PCB_GROUPS)
      expect(group.filter((id) => PCB_TOGGLES.has(id))).toHaveLength(1);
  });

  /**
   * A group member REPLACES its group; anything else flips. The zone pair is a
   * group here even though upstream appends the two separately
   * (`toolbars_pcb_editor.cpp:186-188`), because both read one
   * `ZONE_DISPLAY_MODE` and the renderer asks for a single answer
   * (`zoneOutline: toggles.has('zoneDisplayOutline')`).
   */
  it('replaces a group rather than adding to it', () => {
    const outline = pcbApplyToggle(PCB_TOGGLES, 'zoneDisplayOutline');
    expect(outline.has('zoneDisplayOutline')).toBe(true);
    expect(outline.has('zoneDisplayFilled')).toBe(false);
    // Re-activating the member already on leaves it on.
    expect(pcbApplyToggle(outline, 'zoneDisplayOutline').has('zoneDisplayOutline')).toBe(true);
    // The units group is exclusive too, or the status bar shows two units.
    const mils = pcbApplyToggle(PCB_TOGGLES, 'unitsMils');
    expect(sorted(mils).filter((id) => id.startsWith('units'))).toEqual(['unitsMils']);
    // ...and the rest of the set is untouched by a group activation.
    expect(sorted(mils).filter((id) => !id.startsWith('units'))).toEqual([
      'crosshairSmall',
      'lineModeFree',
      'showLayersManager',
      'showProperties',
      'toggleGrid',
      'zoneDisplayFilled',
    ]);
  });

  it('flips a non-group button', () => {
    expect(pcbApplyToggle(PCB_TOGGLES, 'toggleGrid').has('toggleGrid')).toBe(false);
    expect(pcbApplyToggle(PCB_TOGGLES, 'padDisplayMode').has('padDisplayMode')).toBe(true);
  });

  it('does not mutate the set it is given', () => {
    const before = sorted(PCB_TOGGLES);
    pcbApplyToggle(PCB_TOGGLES, 'unitsMils');
    expect(sorted(PCB_TOGGLES)).toEqual(before);
  });
});

describe("FOOTPRINT_EDIT_FRAME's opening toolbar state", () => {
  /**
   * `lineMode45`, not the board editor's `lineModeFree`:
   * `m_AngleSnapMode( LEADER_MODE::DEG45 )`
   * (`footprint_editor_settings.cpp:55`), which
   * `FOOTPRINT_EDITOR_CONTROL::OnAngleSnapModeChanged` maps to
   * `PCB_ACTIONS::lineMode45` (`footprint_editor_control.cpp:1042-1043`). The
   * three panes are the frame's own `m_auimgr.GetPane( … ).Show( … )` calls
   * (`footprint_edit_frame.cpp:262-264`), all defaulting true.
   */
  it('is the seven buttons the fp editor seeds', () => {
    expect(sorted(FP_TOGGLES)).toEqual([
      'crosshairSmall',
      'lineMode45',
      'showLayersManager',
      'showLibraryTree',
      'showProperties',
      'toggleGrid',
      'unitsMm',
    ]);
  });

  /**
   * The two pcbnew-family frames disagree on the line mode ON PURPOSE, so
   * neither may be copied from the other. This is the assertion that fails if
   * someone "unifies" them.
   */
  it('differs from the board editor on the line mode', () => {
    expect(FP_TOGGLES.has('lineMode45')).toBe(true);
    expect(PCB_TOGGLES.has('lineMode45')).toBe(false);
    expect(PCB_TOGGLES.has('lineModeFree')).toBe(true);
    expect(FP_TOGGLES.has('lineModeFree')).toBe(false);
  });

  it('starts with one member of each radio group', () => {
    for (const group of FP_GROUPS) expect(group.filter((id) => FP_TOGGLES.has(id))).toHaveLength(1);
  });

  it('replaces a group rather than adding to it, and flips everything else', () => {
    const free = fpApplyToggle(FP_TOGGLES, 'lineModeFree');
    expect(free.has('lineModeFree')).toBe(true);
    expect(free.has('lineMode45')).toBe(false);
    expect(fpApplyToggle(free, 'lineModeFree').has('lineModeFree')).toBe(true);
    expect(fpApplyToggle(FP_TOGGLES, 'showProperties').has('showProperties')).toBe(false);
    expect(fpApplyToggle(FP_TOGGLES, 'textOutlines').has('textOutlines')).toBe(true);
  });
});

describe("SCH_EDIT_FRAME's opening toolbar state", () => {
  /**
   * Only what eeschema keeps in session state. Grid, crosshair, line mode,
   * hidden pins/fields and auto-annotate are `EESCHEMA_SETTINGS` keys and are
   * derived from the settings store each render, so they are not in this set.
   *
   *   unitsMils       filename "eeschema"                  app_settings.cpp:228-238
   *                                                        eeschema_settings.cpp:177
   *   showHierarchy   `aui.show_schematic_hierarchy` true  eeschema_settings.cpp:246-247
   *   showProperties  `aui.show_properties` true           eeschema_settings.cpp:318-319
   *
   * `aui.show_search` (:297-298) and `aui.show_net_nav_panel` (:300-301) both
   * default false, which is why neither pane is here.
   */
  it('is the two panes plus the unit, with search and the net navigator shut', () => {
    expect(sorted(SCH_TOGGLES)).toEqual(['showHierarchy', 'showProperties', 'unitsMils']);
  });

  /**
   * The units group leads with INCHES in eeschema
   * (`toolbars_sch_editor.cpp:82-84`) and with millimetres in pcbnew
   * (`toolbars_pcb_editor.cpp:165-167`). The order is what the button cycles
   * through, so the two must not be shared.
   */
  it('cycles its units group in eeschema order, not pcbnew order', () => {
    expect(SCH_GROUPS[0]).toEqual(['unitsInches', 'unitsMils', 'unitsMm']);
    expect(PCB_GROUPS[0]).toEqual(['unitsMm', 'unitsInches', 'unitsMils']);
  });

  it('replaces the units group rather than adding to it', () => {
    const inches = schApplyToggle(SCH_TOGGLES, 'unitsInches');
    expect(sorted(inches)).toEqual(['showHierarchy', 'showProperties', 'unitsInches']);
    expect(schApplyToggle(inches, 'unitsInches').has('unitsInches')).toBe(true);
    expect(schApplyToggle(SCH_TOGGLES, 'showProperties').has('showProperties')).toBe(false);
    expect(schApplyToggle(SCH_TOGGLES, 'showNetNavigator').has('showNetNavigator')).toBe(true);
  });
});

describe('the two frames that already had their defaults in a .ts', () => {
  /**
   * GerbView: grid on (`app_settings.cpp:555-556`), millimetres (the `else`
   * arm), the layer manager, and SMALL_CROSS
   * (`gal_display_options.cpp:52`).
   */
  it('opens GerbView with four buttons', () => {
    expect(sorted(GBR_TOGGLES)).toEqual([
      'crosshairSmall',
      'showLayerManager',
      'toggleGrid',
      'unitsMm',
    ]);
  });

  /**
   * pl_editor: grid on, mils (the first imperial name), and EDIT mode —
   * `DS_DATA_MODEL::GetTheInstance().m_EditMode = true` runs unconditionally in
   * PL_EDITOR_FRAME's constructor (`pl_editor_frame.cpp:105`) and nothing
   * persists it.
   */
  it('opens the drawing sheet editor with three buttons', () => {
    expect(sorted(DS_TOGGLES)).toEqual(['layoutEditMode', 'toggleGrid', 'unitsMils']);
  });
});

// ---------------------------------------------------------------------------
// the seam a `.ts` module cannot cover
// ---------------------------------------------------------------------------

/**
 * Extracting the table only helps if the frame still SEEDS ITSELF FROM IT, and
 * that last inch lives in a `.tsx`. There is no DOM test environment here, so
 * it cannot be executed — a mutation sweep confirmed it: putting
 * `new Set(['unitsMm', 'showHierarchy', 'showProperties'])` back into
 * `SchematicEditor.tsx`, which is precisely the bug this branch fixes, failed
 * NOT ONE test with only the module-level assertions above.
 *
 * So this is a source-text check, and it is honest about being one: it pins
 * spelling, not behaviour. `drawing_sheet_palette.test.ts` already guards its
 * frame the same way (`expect(EDITOR).toContain('togglesFromSettings(...)')`).
 * It is written per FILE rather than as one scan of the directory, because the
 * rule is per-occurrence: a frame that re-localised its table would otherwise
 * hide behind five that did not.
 */
const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

describe.each([
  ['editors/schematic/SchematicEditor.tsx'],
  ['editors/pcb/PcbEditor.tsx'],
  ['editors/footprint/FootprintEditor.tsx'],
])('%s seeds its toolbar from its toggles module', (rel) => {
  it('takes DEFAULT_TOGGLES from ./toggles.js', () => {
    expect(src(rel)).toMatch(/import \{[^}]*\bDEFAULT_TOGGLES\b[^}]*\} from '\.\/toggles\.js'/);
  });

  it('seeds the state with it and not with a literal of its own', () => {
    const s = src(rel);
    expect(s).toContain('useState<Set<string>>(new Set(DEFAULT_TOGGLES))');
    // A second, local `const DEFAULT_TOGGLES = new Set([...])` would satisfy the
    // line above while restating the table. That is exactly how the schematic's
    // wrong unit shipped, so the declaration must not exist here at all.
    expect(s).not.toMatch(/const DEFAULT_TOGGLES\s*(:|=)/);
  });
});

/**
 * The Symbol Editor is the drawing sheet's shape, not the list above's: two of
 * its toolbar buttons are SETTINGS rather than session state, so the frame
 * cannot seed itself from a constant set.
 *
 * `ACTIONS::toggleGrid` writes `m_Window.grid.show` through
 * `EDA_DRAW_FRAME::SetGridVisibility` (`eda_draw_frame.cpp:585-598`) and
 * `ACTIONS::toggleGridOverrides` writes `m_Window.grid.overrides_enabled`, so
 * both survive a restart and both must come up showing
 * `symbol_editor.json`. `symbolTogglesFromSettings` is `DEFAULT_TOGGLES` with
 * those two folded in, which is why the "no local literal" rule above is still
 * satisfied one level down: the table itself is still `./toggles.js`'.
 *
 * Same source-text honesty as the block above — it pins spelling, not
 * behaviour, and `drawing_sheet_palette.test.ts` guards `pl_editor` this way
 * for the same reason.
 */
describe('editors/symbol/SymbolEditor.tsx seeds its toolbar from the settings file', () => {
  const SYM = 'editors/symbol/SymbolEditor.tsx';

  it('seeds from symbolTogglesFromSettings, not from a constant set', () => {
    const s = src(SYM);
    expect(s).toContain('symbolTogglesFromSettings(settings.symbolEditor)');
    // The bug this replaces: a `new Set(DEFAULT_TOGGLES)` seed cannot show a
    // stored Show Grid or Grid Overrides at all.
    expect(s).not.toContain('useState<Set<string>>(new Set(DEFAULT_TOGGLES))');
    expect(s).not.toMatch(/const DEFAULT_TOGGLES\s*(:|=)/);
  });

  it('writes the two settings toggles back, and only those two', () => {
    const s = src(SYM);
    expect(s).toMatch(/import \{[^}]*\bpersistSymbolToggle\b[^}]*\} from '\.\/toggles\.js'/);
    // Guarded by SYMBOL_SETTING_TOGGLES: `updateSymbolEditor` persists and
    // wakes the account sync, so calling it for a pane toggle would push
    // `symbol_editor.json` on every click of the left toolbar.
    expect(s).toContain('SYMBOL_SETTING_TOGGLES.has(id)');
  });

  it('the toggles module folds exactly the two KiCad stores', () => {
    // From the module, not the source text: a set that grew a third id would
    // be a setting the page cannot see being flipped by a button.
    expect([...SYMBOL_SETTING_TOGGLES].sort()).toEqual(['toggleGrid', 'toggleGridOverrides']);
  });

  it('opens with both lit, because both default true', () => {
    // `app_settings.cpp:497-498` (`overrides_enabled`) and `:555-556`
    // (`grid.show`) — the eeschema/symbol_editor arm and the else arm agree on
    // both. Confirmed against the installed build's own symbol_editor.json.
    const on = symbolTogglesFromSettings(SYMBOL_EDITOR_DEFAULTS);
    expect(on.has('toggleGrid')).toBe(true);
    expect(on.has('toggleGridOverrides')).toBe(true);
  });

  it('follows the file when either is off', () => {
    const cfg = structuredClone(SYMBOL_EDITOR_DEFAULTS);
    cfg.window.grid.show = false;
    cfg.window.grid.overrides_enabled = false;
    const off = symbolTogglesFromSettings(cfg);
    expect(off.has('toggleGrid')).toBe(false);
    expect(off.has('toggleGridOverrides')).toBe(false);
    // and nothing else moved with them
    expect(off.has('showLibraryTree')).toBe(true);
  });

  it('persistSymbolToggle inverts the stored value and returns whether it wrote', () => {
    const cfg = structuredClone(SYMBOL_EDITOR_DEFAULTS);
    expect(persistSymbolToggle(cfg, 'toggleGrid')).toBe(true);
    expect(cfg.window.grid.show).toBe(false);
    expect(persistSymbolToggle(cfg, 'toggleGridOverrides')).toBe(true);
    expect(cfg.window.grid.overrides_enabled).toBe(false);
    // A session-state button must not touch the file.
    const before = structuredClone(cfg);
    expect(persistSymbolToggle(cfg, 'showProperties')).toBe(false);
    expect(cfg).toEqual(before);
  });
});

/**
 * `editors/gerbview/GerberViewer.tsx`, which is the same move the symbol
 * editor's block above describes and goes further: gerbview does not fold two
 * settings into its toggle set, it takes TWELVE plus the units and crosshair
 * groups out of `gerbview.json`, because upstream every one of those buttons
 * is a `gvconfig()` member and the frame's checked state is read straight back
 * off it (`gerbview/gerbview_frame.cpp:1126-1150`).
 *
 * `DEFAULT_TOGGLES` survives as the seed for the three ids that have no `PARAM`
 * behind them — the Layers manager pane, polar coordinates, the background row
 * — so the "no local literal" rule is satisfied one level down, exactly as it
 * is for the symbol editor.
 *
 * Source text again, and for the same reason the block at the top of this file
 * is: the seeding expression cannot be executed from `qa`.
 */
describe('editors/gerbview/GerberViewer.tsx seeds its toolbar from the settings file', () => {
  const GBR = 'editors/gerbview/GerberViewer.tsx';

  it('seeds from togglesFromSettings, not from a constant set', () => {
    const s = src(GBR);
    expect(s).toContain('togglesFromSettings(settings.gerbview, DEFAULT_TOGGLES)');
    // The bug this replaces: a `new Set(DEFAULT_TOGGLES)` seed opens the viewer
    // with the stock toggles whatever Preferences > Gerber Viewer > Display
    // Options was last set to, which is the page not working.
    expect(s).not.toContain('useState<Set<string>>(new Set(DEFAULT_TOGGLES))');
    expect(s).not.toMatch(/const DEFAULT_TOGGLES\s*(:|=)/);
  });

  it('takes DEFAULT_TOGGLES and the projection from ./toggles.js', () => {
    const s = src(GBR);
    expect(s).toMatch(/import \{[\s\S]*?\bDEFAULT_TOGGLES\b[\s\S]*?\} from '\.\/toggles\.js'/);
    expect(s).toMatch(/import \{[\s\S]*?\btogglesFromSettings\b[\s\S]*?\} from '\.\/toggles\.js'/);
    expect(s).toMatch(
      /import \{[\s\S]*?\bapplyTogglesToSettings\b[\s\S]*?\} from '\.\/toggles\.js'/,
    );
  });

  it('writes back through applyTogglesToSettings, guarded so a mount does not commit', () => {
    const s = src(GBR);
    // `updateGerbview` persists AND wakes the account sync, so an unguarded
    // write-back would push `gerbview.json` every time the viewer is opened.
    expect(s).toContain('if (!applyTogglesToSettings(probe, toggles)) return;');
    expect(s).toContain('settings.updateGerbview(');
  });
});
