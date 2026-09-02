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
import type { SymbolEditorSettings } from '../../prefs/settings.js';
import { unitCount, unitsLocked } from './edits.js';

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
 * What a fresh SYMBOL_EDIT_FRAME shows.
 *
 * The units entry is NOT written here. `system.units`' default is one branch in
 * `APP_SETTINGS_BASE` (`common/settings/app_settings.cpp:228-238`) and
 * `symbol_editor` is on its imperial side, so this frame opens in mils —
 * `grid 50`, not `grid 1.27`. See `ui/app_settings_units.ts`.
 */
export const DEFAULT_TOGGLES: ReadonlySet<string> = new Set([
  'toggleGrid',
  defaultUnitsToggle('symbol_editor'),
  'showLibraryTree',
  'showProperties',
  // `cursorSmallCrosshairs` is the group's first action, so it is the one the
  // crosshair button shows on open.
  'crosshairSmall',
]);

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
  const out = new Set(DEFAULT_TOGGLES);
  if (cfg.window.grid.show) out.add('toggleGrid');
  else out.delete('toggleGrid');
  if (cfg.window.grid.overrides_enabled) out.add('toggleGridOverrides');
  else out.delete('toggleGridOverrides');
  return out;
}

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
  if (id === 'toggleGrid') {
    cfg.window.grid.show = !cfg.window.grid.show;
    return true;
  }
  if (id === 'toggleGridOverrides') {
    cfg.window.grid.overrides_enabled = !cfg.window.grid.overrides_enabled;
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
]);
