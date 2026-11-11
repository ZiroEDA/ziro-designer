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
  isStoredPcbToggle,
  RADIO_GROUPS as PCB_GROUPS,
} from '@ziroeda/pcbnew/pcb_edit_frame.js';
import {
  applyToggle as fpApplyToggle,
  DEFAULT_TOGGLES as FP_TOGGLES,
  fpTogglesFromSettings,
  RADIO_GROUPS as FP_GROUPS,
} from '@ziroeda/pcbnew/footprint_edit_frame.js';
import {
  persistSymbolToggle,
  symbolTogglesFromSettings,
} from '@ziroeda/eeschema/symbol_editor/toggles.js';
import { SYMBOL_EDITOR_DEFAULTS } from '@ziroeda/eeschema/symbol_editor/symbol_editor_settings.js';
import { PCB_LEFT_TOOLBAR } from '@ziroeda/pcbnew/toolbars_pcb_editor.js';
import { LEFT_TOOLBAR as SCH_LEFT_TOOLBAR_ENTRIES } from '@ziroeda/eeschema/toolbars_sch_editor.js';

const sorted = (s: Iterable<string>): string[] => [...s].sort();

describe("PCB_EDIT_FRAME's opening toolbar state", () => {
  /**
   * Entry by entry:
   *
   *   toggleGrid         `window.grid.show` true        app_settings.cpp:555-556
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
   *
   * The units group is not here: it is checked off the frame's own units
   * (`cond.Units`, eda_draw_frame.cpp:1368-1370), which its LoadSettings reads
   * from `system.units` - pcb_edit_frame_settings.test.ts pins that a fresh
   * PCBNEW_SETTINGS opens the board in millimetres.
   */
  it('is the six buttons pcbnew seeds, and not ratsnestLineMode', () => {
    expect(sorted(PCB_TOGGLES)).toEqual([
      'crosshairSmall',
      'lineModeFree',
      'showLayersManager',
      'showProperties',
      'toggleGrid',
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
    // The crosshair group is exclusive too, or the canvas draws two cursors.
    const full = pcbApplyToggle(PCB_TOGGLES, 'crosshairFull');
    expect(sorted(full).filter((id) => id.startsWith('crosshair'))).toEqual(['crosshairFull']);
    // ...and the rest of the set is untouched by a group activation.
    expect(sorted(full).filter((id) => !id.startsWith('crosshair'))).toEqual([
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
    pcbApplyToggle(PCB_TOGGLES, 'crosshairFull');
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

describe("SCH_EDIT_FRAME's units group", () => {
  /**
   * The units group leads with INCHES in eeschema (`toolbars_sch_editor.cpp:82-84`) and with
   * millimetres in pcbnew (`toolbars_pcb_editor.cpp:165-167`). The units themselves are the
   * frame's (sch_edit_frame_load_settings); the panes are the window's AUI state.
   */
  it('cycles its units group in eeschema order, not pcbnew order', () => {
    const schUnits = SCH_LEFT_TOOLBAR_ENTRIES.find(
      (e) => typeof e === 'object' && e !== null && 'group' in e && e.group === 'Units',
    ) as { actions: { id: string }[] } | undefined;
    expect(schUnits?.actions.map((a) => a.id)).toEqual(['unitsInches', 'unitsMils', 'unitsMm']);
    const pcbUnits = PCB_LEFT_TOOLBAR.find(
      (e) => typeof e === 'object' && e !== null && 'group' in e && e.group === 'Units',
    ) as { actions: { id: string }[] } | undefined;
    expect(pcbUnits?.actions.map((a) => a.id)).toEqual(['unitsMm', 'unitsInches', 'unitsMils']);
  });
});

/**
 * GerbView's defaults are GERBVIEW_FRAME's own now, read off a fresh frame in
 * unittests/gerbview/gerbview_frame.test.ts, and pl_editor's are
 * PL_EDITOR_FRAME's, read off a fresh frame in pl_editor_settings.test.ts.
 */

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

/**
 * The Footprint Editor left the list of constant seeds when its sketch modes became the
 * `pcb_display.*` of `fpedit.json`: `fpTogglesFromSettings` is `DEFAULT_TOGGLES`, from
 * `footprint_edit_frame.ts` beside it, with the stored modes folded in - the PCB Editor's
 * reason below, for this frame's three CHECKs.
 */
describe('pcbnew/footprint_edit_frame_ui.tsx seeds its toolbar from fpedit.json', () => {
  const FP = '../../pcbnew/footprint_edit_frame_ui.tsx';

  it('seeds from fpTogglesFromSettings, not from a constant set or a table of its own', () => {
    const s = src(FP);
    expect(s).toContain('useState<Set<string>>(() => fpTogglesFromSettings(app.fpEdit()))');
    expect(s).not.toContain('new Set(DEFAULT_TOGGLES)');
    expect(s).not.toMatch(/const DEFAULT_TOGGLES\s*(:|=)/);
  });

  it('is DEFAULT_TOGGLES while every fill is on, the default', () => {
    const fills = { graphics_fill: true, text_fill: true, pad_fill: true, pad_numbers: true };
    expect([...fpTogglesFromSettings({ pcb_display: fills })].sort()).toEqual(
      [...FP_TOGGLES].sort(),
    );
  });

  it('lights each sketch mode whose fill is off, and only that one', () => {
    for (const [key, id] of [
      ['pad_fill', 'padDisplayMode'],
      ['graphics_fill', 'graphicsOutlines'],
      ['text_fill', 'textOutlines'],
    ] as const) {
      const fills = { graphics_fill: true, text_fill: true, pad_fill: true, pad_numbers: true };
      fills[key] = false;
      const on = fpTogglesFromSettings({ pcb_display: fills });

      expect(on.has(id), id).toBe(true);
      expect(on.size, id).toBe(FP_TOGGLES.size + 1);
    }
  });
});

/**
 * The PCB Editor left the list above when Preferences > PCB Editor > Display
 * Options gained its Grid Display and Cursor groups: Show Grid is
 * `window.grid.show` and the three crosshair shapes are
 * `window.cursor.cross_hair_mode`, so a `new Set(DEFAULT_TOGGLES)` seed cannot
 * show what `pcbnew.json` holds — the same reason the Symbol Editor below is
 * its own case. `pcbTogglesFromSettings` is still `DEFAULT_TOGGLES` with those
 * four folded in, so the table itself stays in `./toggles.js`.
 */
describe('pcbnew/pcb_edit_frame_ui.tsx seeds its toolbar from the settings file', () => {
  const PCB = '../../pcbnew/pcb_edit_frame_ui.tsx';

  it('seeds from pcbTogglesFromSettings, not from a constant set', () => {
    const s = src(PCB);
    expect(s).toContain('pcbTogglesFromSettings(pcbCfg)');
    expect(s).not.toContain('useState<Set<string>>(new Set(DEFAULT_TOGGLES))');
    expect(s).not.toMatch(/const DEFAULT_TOGGLES\s*(:|=)/);
  });

  it('folds the settings-backed toolbar ids back into the file, and only those', () => {
    // From the module rather than the source text: `foldPcbToggle` must write
    // for exactly the ids that ARE a PARAM upstream —
    //
    //   toggleGrid              window.grid.show              app_settings.cpp:555
    //   crosshairSmall/Full/45  window.cursor.cross_hair_mode app_settings.cpp:567
    //   togglePolarCoords       editing.polar_coords          pcbnew_settings.cpp:176
    //
    // — and for nothing else, because `updatePcbnew` persists and wakes the
    // account sync: a pane toggle running through it would push `pcbnew.json`
    // on every click of the left toolbar.
    for (const id of [
      'toggleGrid',
      'crosshairSmall',
      'crosshairFull',
      'crosshair45',
      'togglePolarCoords',
    ])
      expect(isStoredPcbToggle(id), id).toBe(true);
    // `unitsMm` (`system.units`) and `ratsnestLineMode` (`pcb_display.ratsnest_
    // curved`, pcbnew_settings.cpp:258) ARE PARAMs, but not folded here: their
    // buttons run COMMON_TOOLS::SwitchUnits and PCB_CONTROL::ToggleRatsnest on
    // the settings object, which the settings store writes back.
    // The Line modes buttons are BOARD_EDITOR_CONTROL::ChangeLineMode's
    // (`editing.pcb_angle_snap_mode`, pcbnew_settings.cpp:190), on the object.
    for (const id of [
      'unitsMm',
      'ratsnestLineMode',
      'lineModeFree',
      'lineMode45',
      'lineMode90',
      'zoneDisplayOutline',
      'zoneDisplayFilled',
      'showLayersManager',
      'showProperties',
      'highContrast',
    ])
      expect(isStoredPcbToggle(id), id).toBe(false);
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
  const SYM = '../../eeschema/symbol_editor/symbol_edit_frame_ui.tsx';

  it('draws the file’s toggles over the session set, not a constant set', () => {
    // The live window asks the frame's CHECK conditions on every render
    // (`symbolEditorCheckedIds`), which read the stored settings directly, as
    // HandleUpdateUIEvent asks them on every idle: nothing to go stale.
    const s = src(SYM);
    expect(s).toContain('symbolEditorCheckedIds(frame, [...symTopBar, ...symLeftBar])');
    // The bug this replaces: a `new Set(DEFAULT_TOGGLES)` seed cannot show a
    // stored Show Grid or Grid Overrides at all.
    expect(s).not.toContain('useState<Set<string>>(new Set(DEFAULT_TOGGLES))');
    expect(s).not.toMatch(/const DEFAULT_TOGGLES\s*(:|=)/);
  });

  it('writes back only stored settings, and none COMMON_TOOLS already writes', () => {
    const s = src(SYM);
    expect(s).toMatch(/import \{[^}]*\bpersistSymbolToggle\b[^}]*\} from '\.\/toggles\.js'/);
    // Guarded: `updateSymbolEditor` persists and wakes the account sync, so
    // calling it for a pane toggle would push `symbol_editor.json` on every
    // click of the left toolbar.
    expect(s).toContain('WINDOW_PERSISTED_TOGGLES.has(id)');
    const set = s.slice(s.indexOf('const WINDOW_PERSISTED_TOGGLES'));
    const ids = [...set.slice(0, set.indexOf(']);')).matchAll(/'(\w+)'/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(0);
    // The grid pair is COMMON_TOOLS' (SetGridVisibility / SetGridOverrides into
    // the settings object, stored by the frame's idle pass): writing it here
    // too flipped it straight back.
    expect(ids).not.toContain('toggleGrid');
    expect(ids).not.toContain('toggleGridOverrides');
  });

  it('the settings-backed id with no button is reachable from the View menu', () => {
    // Membership above is only half the rule: an id that folds but has no
    // control at all is a setting the user cannot reach. This is the other
    // half, and it is why `togglePinAltIcons` is allowed to have no button.
    const menubar = src('../../eeschema/symbol_editor/menubar_symbol_editor.ts');
    expect(menubar).toContain("chk(_('Show Pin Alternate Icons'), 'togglePinAltIcons')");
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
