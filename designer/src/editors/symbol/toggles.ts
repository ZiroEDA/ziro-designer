// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Editor's left-toolbar toggle state, as pure data and one function.
 *
 * Same shape, and the same reason, as `editors/gerbview/toggles.ts`: this lived
 * inside `SymbolEditor.tsx`, and `qa`'s tsconfig compiles `.ts` only, so
 * nothing in the suite could import it. The frame's opening units sat in there
 * as `'unitsMm'` — the wrong arm of `APP_SETTINGS_BASE`'s branch — through
 * every audit this editor has had, because no test could name the value.
 */

import type { LibSymbol } from '@ziroeda/eeschema/src/types.js';
import { defaultUnitsToggle } from '../../ui/app_settings_units.js';
import { SYMBOL_EDITOR_DEFAULTS, type SymbolEditorSettings } from '../../prefs/settings.js';
import { unitCount, unitsLocked } from './edits.js';
import { switchUnits, toggleIdUnits, unitsToggleId } from '../../ui/app_settings_units.js';

/**
 * The left toolbar's cycling groups — `AppendGroup( TOOLBAR_GROUP_CONFIG(...) )`
 * (`toolbars_symbol_editor.cpp:72-79`). One button each, showing the selected
 * action, so exactly one member is in `toggles` at a time.
 *
 * `showDeMorganStandard` / `showDeMorganAlternate` used to be a third pair here.
 * They were ours: neither name appears anywhere in KiCad 10.0.5, and the body
 * style is a CHOICE on the top bar upstream, not two toggle buttons.
 */
export const RADIO_GROUPS: readonly (readonly string[])[] = [
  ['unitsMm', 'unitsInches', 'unitsMils'],
  ['crosshairSmall', 'crosshairFull', 'crosshair45'],
];

/**
 * The half of the frame's opening state that is NOT in `symbol_editor.json`:
 * the two AUI panes.
 *
 * The UNIT used to be here, seeded from `defaultUnitsToggle('symbol_editor')`,
 * and that was wrong in a way the default hid: `system.units` is a PARAM on
 * every `APP_SETTINGS_BASE` — the `app_settings.cpp:228-238` conditional picks
 * its DEFAULT, not whether the key exists — so a real symbol editor remembers
 * the unit you picked. Ours reverted to mils on every reload, and Preferences >
 * Grids printed mils whatever the toolbar said, because nothing stored the
 * live answer for it to read.
 *
 * (`m_AuiPanels.show_properties` IS a stored key upstream; we do not model AUI
 * perspective at all, so the two panes stay session state here.)
 */
export const SESSION_TOGGLES: ReadonlySet<string> = new Set(['showLibraryTree', 'showProperties']);

/**
 * `m_SyncPinEdit` after `SYMBOL_EDIT_FRAME::SetCurSymbol`
 * (`symbol_edit_frame.cpp:968`):
 *
 *     // Ensure synchronized pin edit can be enabled only symbols with
 *     // interchangeable units
 *     m_SyncPinEdit = aSymbol && aSymbol->IsRoot() && aSymbol->IsMultiUnit()
 *                     && !aSymbol->UnitsLocked();
 *
 * It is NOT a sticky user preference: upstream recomputes it from the symbol
 * on every load, and the constructor sets it to `false` (`:128`), so a cold
 * frame shows the Synchronized Pins button unlit. `toggleSyncedPinsMode` used
 * to sit in {@link DEFAULT_TOGGLES}, which painted that button checked — and
 * checked *while disabled*, since `multiUnitModeCond` (:609-613) is false with
 * no symbol. KiCad's own cold frame paints it flat and grey.
 *
 * `IsRoot()` is `!extends`; `IsMultiUnit()` is `GetUnitCount() > 1`.
 */
export function syncPinEditOnLoad(symbol: LibSymbol | null): boolean {
  if (!symbol) return false;
  return symbol.extends === undefined && unitCount(symbol) > 1 && !unitsLocked(symbol);
}

/** {@link syncPinEditOnLoad} applied to a toggle set, for `SetCurSymbol`. */
export function withSyncPinEdit(prev: ReadonlySet<string>, symbol: LibSymbol | null): Set<string> {
  const next = new Set(prev);
  if (syncPinEditOnLoad(symbol)) next.add('toggleSyncedPinsMode');
  else next.delete('toggleSyncedPinsMode');
  return next;
}

/**
 * Activating `id`, given what is currently on.
 *
 * A member of a radio group REPLACES its group — including itself, so
 * re-activating the member already on leaves it on rather than turning it off.
 * Anything else flips.
 */
export function applyToggle(prev: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(prev);
  const group = RADIO_GROUPS.find((g) => g.includes(id));
  if (group) {
    for (const g of group) next.delete(g);
    next.add(id);
    return next;
  }
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * The two toolbar toggles that are **settings**, not session state, folded into
 * {@link DEFAULT_TOGGLES}.
 *
 * `ACTIONS::toggleGrid` and `ACTIONS::toggleGridOverrides` both go through the
 * settings object upstream — `EDA_DRAW_FRAME::SetGridVisibility` writes
 * `m_Window.grid.show` (`eda_draw_frame.cpp:585-598`) and
 * `COMMON_TOOLS::ToggleGridOverrides` flips
 * `m_Window.grid.overrides_enabled` — which is why both survive a restart and
 * why the frame must boot from the file rather than from a constant set.
 *
 * It matters for more than persistence here: `overrides_enabled` is what
 * `grid.ts`' `symbolGridForTool` tests, so a button that only flipped a React
 * set would leave the four Grid Overrides rows on the Preferences page
 * unreachable. `SYMBOL_EDITOR_DEFAULTS` has both true, which is
 * `app_settings.cpp:497-498` and `:555-556`, so a cold frame shows both lit —
 * ours showed Grid Overrides unlit, the same defect the schematic's default
 * had.
 */
export function symbolTogglesFromSettings(cfg: SymbolEditorSettings): Set<string> {
  const out = new Set(SESSION_TOGGLES);
  const flag = (id: string, on: boolean): void => {
    if (on) out.add(id);
  };
  // `COMMON_TOOLS::ToggleGrid` / `ToggleGridOverrides`, both through the
  // settings object (`eda_draw_frame.cpp:585-598`).
  flag('toggleGrid', cfg.window.grid.show);
  flag('toggleGridOverrides', cfg.window.grid.overrides_enabled);
  // `SYMBOL_EDIT_FRAME::setupUIConditions`' four CHECK conditions
  // (`symbol_edit_frame.cpp:566-606`), each of which reads
  // `libeditconfig()->m_Show*` and nothing else.
  flag('showHiddenPins', cfg.show_hidden_lib_pins);
  flag('showHiddenFields', cfg.show_hidden_lib_fields);
  flag('showElectricalTypes', cfg.show_pin_electrical_type);
  // `showPinAltIconsCond` — `return libeditconfig()->m_ShowPinAltIcons;`
  // (`symbol_edit_frame.cpp:583-587`), the FIFTH of those conditions. It has
  // no toolbar button, since upstream leaves that one commented out
  // (`toolbars_symbol_editor.cpp:85`), but it does have a View-menu CHECK
  // (`menubar_symbol_editor.cpp:142`), so the flag belongs in this set.
  flag('togglePinAltIcons', cfg.show_pin_alt_icons);
  // `EDA_DRAW_FRAME::setupUnits` (`eda_draw_frame.cpp:1378-1397`) — the frame
  // opens on `system.units`, not on the app's default.
  out.add(unitsToggleId(cfg.system.units));
  out.add(crosshairToggleId(cfg.window.cursor.crosshair));
  return out;
}

/**
 * `CURSOR_SETTINGS::cross_hair_mode` as the id of the crosshair group's checked
 * action — the three-way version of `drawingsheet/toggles.ts`' two-way one.
 *
 * The group's members are `ACTIONS::cursorSmallCrosshairs`,
 * `cursorFullWindowCrosshairs` and `cursor45DegreeCrosshairs`, and the mode is
 * a setting, so which of the three is lit must come from the file rather than
 * from "the group's first action". Ours hardcoded `crosshairSmall`, which is
 * the default and therefore invisible until someone changed it on Preferences
 * > Display Options and reopened the editor.
 */
export function crosshairToggleId(
  mode: SymbolEditorSettings['window']['cursor']['crosshair'],
): string {
  return mode === 'full' ? 'crosshairFull' : mode === '45' ? 'crosshair45' : 'crosshairSmall';
}

/** {@link crosshairToggleId} backwards: which mode a group member selects. */
export function crosshairToggleMode(
  id: string,
): SymbolEditorSettings['window']['cursor']['crosshair'] | null {
  if (id === 'crosshairFull') return 'full';
  if (id === 'crosshair45') return '45';
  if (id === 'crosshairSmall') return 'small';
  return null;
}

/**
 * What a fresh SYMBOL_EDIT_FRAME actually shows: {@link SESSION_TOGGLES} plus
 * everything `symbol_editor.json` decides, applied to that file's own defaults.
 *
 * Written this way round rather than as a hand-kept list, for the reason
 * `drawingsheet/toggles.ts` gives about its own: a second table beside the
 * derivation is one answer written twice, and nothing in the app reads it —
 * the frame boots from `symbolTogglesFromSettings( settings.symbolEditor )`.
 *
 * It used to be five ids, and three of them were wrong. `m_ShowPinElectricalType`,
 * `show_hidden_lib_pins` and `show_hidden_lib_fields` are all `PARAM<bool>( …,
 * true )` (`symbol_editor_settings.cpp:79-89`) and `overrides_enabled` is true
 * as well (`app_settings.cpp:497-498`), and every one of the four is a CHECK
 * condition on its toolbar button reading the settings object directly
 * (`symbol_edit_frame.cpp:566-606`). So a real cold KiCad opens with Show
 * Hidden Pins, Show Hidden Fields, Show Pin Electrical Type and Grid Overrides
 * all lit; ours opened with all four flat. Confirmed against the installed
 * build's own `~/.config/kicad/10.0/symbol_editor.json`, which is the parity
 * target.
 */

export const DEFAULT_TOGGLES: ReadonlySet<string> =
  symbolTogglesFromSettings(SYMBOL_EDITOR_DEFAULTS);

/**
 * Fold a toolbar activation into `symbol_editor.json`. Returns whether it did.
 *
 * Both branches read their own current value and invert it, exactly as
 * `COMMON_TOOLS::ToggleGrid` does — `SetGridVisibility( !IsGridVisible() )`
 * (`common/tool/common_tools.cpp:595-598`) — so the file is the state rather
 * than a copy of it. Anything else on this toolbar is session state upstream
 * too and is left alone.
 */
export function persistSymbolToggle(cfg: SymbolEditorSettings, id: string): boolean {
  // `COMMON_TOOLS::SwitchUnits` (`common_tools.cpp:656-668`), which also
  // remembers the choice as the last of its own family so Ctrl+U can come back
  // to it. Like the crosshair group below it REPLACES rather than flips, so
  // re-picking the unit already on writes nothing.
  if (RADIO_GROUPS[0]?.includes(id)) {
    if (cfg.system.units === toggleIdUnits(id)) return false;
    switchUnits(cfg.system, id);
    return true;
  }
  if (id === 'toggleGrid') {
    cfg.window.grid.show = !cfg.window.grid.show;
    return true;
  }
  if (id === 'toggleGridOverrides') {
    cfg.window.grid.overrides_enabled = !cfg.window.grid.overrides_enabled;
    return true;
  }
  // `SYMBOL_EDITOR_CONTROL::ToggleHiddenPins` / `ToggleHiddenFields` /
  // `TogglePinAltIcons` (`symbol_editor_control.cpp:714-752`) are all
  // `cfg->m_X = !cfg->m_X` followed by pushing the new value at the render
  // settings — the file is the state, the render settings are the copy.
  if (id === 'showHiddenPins') {
    cfg.show_hidden_lib_pins = !cfg.show_hidden_lib_pins;
    return true;
  }
  if (id === 'showHiddenFields') {
    cfg.show_hidden_lib_fields = !cfg.show_hidden_lib_fields;
    return true;
  }
  if (id === 'showElectricalTypes') {
    cfg.show_pin_electrical_type = !cfg.show_pin_electrical_type;
    return true;
  }
  // `SYMBOL_EDITOR_CONTROL::TogglePinAltIcons` is the fourth of that same
  // family (`symbol_editor_control.cpp:714-752`).
  if (id === 'togglePinAltIcons') {
    cfg.show_pin_alt_icons = !cfg.show_pin_alt_icons;
    return true;
  }
  // The crosshair group REPLACES rather than flips: re-activating the member
  // already on leaves it on, which is what `applyToggle` does to the set.
  const mode = crosshairToggleMode(id);
  if (mode !== null) {
    if (cfg.window.cursor.crosshair === mode) return false;
    cfg.window.cursor.crosshair = mode;
    return true;
  }
  return false;
}

/**
 * The ids {@link persistSymbolToggle} acts on, so a caller can ask without
 * mutating anything.
 *
 * The caller needs it because our settings manager persists and wakes the
 * account sync on every `update*` call, where upstream writes the file once at
 * exit — so "does this toggle touch the file at all" has to be answerable
 * before the write, not after.
 */
export const SYMBOL_SETTING_TOGGLES: ReadonlySet<string> = new Set([
  'toggleGrid',
  'toggleGridOverrides',
  'showHiddenPins',
  'showHiddenFields',
  'showElectricalTypes',
  'togglePinAltIcons',
  'unitsMm',
  'unitsInches',
  'unitsMils',
  'crosshairSmall',
  'crosshairFull',
  'crosshair45',
]);

/**
 * The toolbar state the frame actually DRAWS: session state for the ids that
 * are session state, and `symbol_editor.json` for the ids that are settings.
 *
 * Upstream there is no set to merge — a toolbar button's lit state is a
 * `CHECK( … )` condition evaluated on every idle, and the settings-backed ones
 * read the settings object directly (`SYMBOL_EDIT_FRAME::setupUIConditions`,
 * `symbol_edit_frame.cpp:566-606`). So Preferences > Symbol Editor > Display
 * Options pressing OK moves those buttons with no notification at all, and
 * `CommonSettingsChanged` (`:1560-1570`) pushes the same values at the render
 * settings.
 *
 * Ours holds one React set, which is initialised once and would therefore go
 * stale the moment the dialog wrote the file. This is that condition
 * re-evaluated: the settings ids are recomputed from the file every render and
 * the rest of the set is left alone.
 */
export function mergeSymbolToggles(
  session: ReadonlySet<string>,
  cfg: SymbolEditorSettings,
): Set<string> {
  const out = new Set(session);
  for (const id of SYMBOL_SETTING_TOGGLES) out.delete(id);
  for (const id of symbolTogglesFromSettings(cfg)) if (SYMBOL_SETTING_TOGGLES.has(id)) out.add(id);
  return out;
}
