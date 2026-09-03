// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Drawing Sheet Editor's toggle state, and the two directions it travels
 * between `PL_EDITOR_SETTINGS` and the toolbar.
 *
 * Upstream there is no "toggle set": each button reads and writes the settings
 * object directly — `ACTIONS::toggleGrid` flips `window.grid.show` through
 * `EDA_DRAW_FRAME::SetGridVisibility` (eda_draw_frame.cpp:593-598),
 * `ACTIONS::milsUnits` runs `COMMON_TOOLS::SwitchUnits`
 * (common_tools.cpp:656-668), and `EDA_DRAW_FRAME::setupUnits`
 * (eda_draw_frame.cpp:1378-1397) replays the stored values on the way back in.
 * Ours holds one `Set<string>` of button ids, so the mapping between that set
 * and the settings file has to live somewhere — and it lives here, in a `.ts`,
 * rather than inside `DrawingSheetEditor.tsx`, because there is no DOM test
 * environment in this repo and a rule that only a component knows is a rule
 * nothing can check. The same reason `editors/gerbview/toggles.ts` exists.
 */

import { PL_EDITOR_DEFAULTS, type PlEditorSettings } from '../../prefs/settings.js';
import type { EdaUnits } from '@ziroeda/common/src/eda_units.js';
import {
  switchUnits as sharedSwitchUnits,
  toggleIdUnits,
  toggleUnitsId as sharedToggleUnitsId,
  unitsToggleId,
} from '../../ui/app_settings_units.js';

/** `EDA_DRAW_FRAME`'s unit choice — one of three, never none and never two. */
export const UNIT_GROUP = ['unitsMm', 'unitsInches', 'unitsMils'];

/**
 * Activating `id`, given what is currently on.
 *
 * A member of the unit group REPLACES its group — including itself, so
 * re-activating the unit that is already in force leaves it in force rather
 * than turning it off. Anything else flips.
 */
export function applyToggle(prev: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(prev);

  if (UNIT_GROUP.includes(id)) {
    for (const g of UNIT_GROUP) next.delete(g);
    next.add(id);
  } else if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  return next;
}

/**
 * The button set a frame opens with, replayed off the settings file.
 *
 * `setupUnits` (eda_draw_frame.cpp:1378-1397), `IsGridVisible`
 * (eda_draw_frame.cpp:585-590) and `GAL_DISPLAY_OPTIONS::ReadWindowSettings`
 * (gal_display_options_common.cpp:64-78) between them decide every one of
 * these — and `system.units`' own default is one branch in `APP_SETTINGS_BASE`
 * (`app_settings.cpp:228-238`), which `PL_EDITOR_DEFAULTS` asks rather than
 * restates.
 *
 * `layoutEditMode` is the exception, and it is unconditional here for the same
 * reason it is unconditional upstream:
 *
 *     DS_DATA_MODEL::GetTheInstance().m_EditMode = true;   // pl_editor_frame.cpp:105
 *
 * runs on every construction and no parameter binds `m_EditMode` anywhere in
 * `PL_EDITOR_SETTINGS` — so the SECOND of the display-mode pair is the checked
 * button on launch **and stays that way across restarts no matter what the
 * user last picked**. `ds_data_item.cpp:543` then does
 * `m_FullText = m_TextBase`, which is why a real pl_editor opens showing
 * `${TITLE}`, `${COMPANY}` and `Id: ${#}/${##}`: the raw tokens are what you
 * came here to edit. Persisting this would be a divergence, not a fix.
 *
 * {@link DEFAULT_TOGGLES} is this function applied to `PL_EDITOR_DEFAULTS`
 * and nothing else. It used to be a hand-written set beside it, which is one
 * answer written twice: nothing in the app read it — the frame boots from
 * `togglesFromSettings( settings.plEditor )` — so it could have drifted from
 * what a fresh profile actually shows without anything noticing.
 */
export function togglesFromSettings(cfg: PlEditorSettings): Set<string> {
  const out = new Set<string>([unitsToggleId(cfg.system.units), 'layoutEditMode']);
  if (cfg.window.grid.show) out.add('toggleGrid');
  if (cfg.window.cursor.crosshair === 'full') out.add('crosshairFull');
  return out;
}

/**
 * `COMMON_TOOLS::SwitchUnits` (common_tools.cpp:656-668): picking a unit sets
 * the frame's unit **and** remembers it as the last of its own family, which
 * is what `ACTIONS::toggleUnits` (Ctrl+U) flips back to. Only one of the two
 * `last_*` fields moves, because the incoming unit belongs to one family.
 */
export function switchUnits(cfg: PlEditorSettings, id: string): void {
  sharedSwitchUnits(cfg.system, id);
}

/**
 * `COMMON_TOOLS::ToggleUnits` (common_tools.cpp:671-677): Ctrl+U swaps
 * families, landing on whichever member of the other family was used last.
 */
export function toggleUnitsId(cfg: PlEditorSettings): string {
  return sharedToggleUnitsId(cfg.system);
}

/**
 * Fold a toolbar activation into the settings file: the three unit buttons,
 * the grid button and the full-window crosshair.
 *
 * The two booleans read their own current value and invert it, exactly as
 * `COMMON_TOOLS::ToggleGrid` does —
 * `m_frame->SetGridVisibility( !m_frame->IsGridVisible() )`
 * (common_tools.cpp:595-598), where both halves go through the settings object
 * (eda_draw_frame.cpp:585-598). So the settings file is the state, not a copy
 * of it, and nothing has to hand this function the answer it is deriving.
 *
 * Anything else — the display-mode pair, the pane toggles — is session state
 * upstream and is left alone here. Returns whether `cfg` was touched.
 */
export function persistToggle(cfg: PlEditorSettings, id: string): boolean {
  if (UNIT_GROUP.includes(id)) {
    if (cfg.system.units === toggleIdUnits(id)) return false;
    switchUnits(cfg, id);
    return true;
  }

  if (id === 'toggleGrid') {
    cfg.window.grid.show = !cfg.window.grid.show;
    return true;
  }

  if (id === 'crosshairFull') {
    cfg.window.cursor.crosshair = cfg.window.cursor.crosshair === 'full' ? 'small' : 'full';
    return true;
  }

  return false;
}

/**
 * What a fresh profile shows, i.e. `PL_EDITOR_DEFAULTS` rendered as buttons —
 * derived, not restated. Read by the cross-editor boot-state sweeps in `qa`;
 * the frame itself calls {@link togglesFromSettings} on the live settings.
 */
export const DEFAULT_TOGGLES: ReadonlySet<string> = togglesFromSettings(PL_EDITOR_DEFAULTS);
