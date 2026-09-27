// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pl_editor.json` both ways: the page's settings slice (`prefs/settings.ts`,
 * which syncs to the account) and the `PL_EDITOR_SETTINGS` object the frame
 * reads through `config()`. The gerbview bridge's shape
 * (`editors/gerbview/gerbview_settings_bridge.ts`), for the same reason:
 * upstream these are one object, `JSON_SETTINGS::Load` filling it and `Store`
 * writing it back; here the file is the slice, so `Load` copies slice ->
 * object (into the SAME object, so `config()` never changes identity) and
 * `Store` copies back what the frame writes - its `SaveSettings`, the units,
 * the grid index and visibility, and the cursor.
 *
 * Below the settings, the toolbar and menu ids each run as a TOOL_ACTION, and
 * the check / enable state every control asks the frame through
 * `wxEVT_UPDATE_UI`.
 */

import { EdaUnitsFromInt, EdaUnitsToInt } from '@ziroeda/common/settings/app_settings.js';
import { GRID } from '@ziroeda/common/settings/grid_settings.js';
import { CROSS_HAIR_MODE } from '@ziroeda/common/gal/gal_display_options.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { wxUpdateUIEvent } from '@ziroeda/common/wx/wx_event.js';
import type { PL_EDITOR_FRAME } from '@ziroeda/pagelayout_editor/pl_editor_frame.js';
import type { PL_EDITOR_SETTINGS } from '@ziroeda/pagelayout_editor/pl_editor_settings.js';
import { PL_ACTIONS } from '@ziroeda/pagelayout_editor/tools/pl_actions.js';
import type { PlEditorSettings } from '../../prefs/settings.js';

/** `grid.style`'s stored integers (`common/settings/app_settings.cpp`): 0 dots, 1 lines, 2 crosses. */
const GRID_STYLE: readonly PlEditorSettings['window']['grid']['style'][] = [
  'dots',
  'lines',
  'crosses',
];

const CURSOR_MODE: Record<PlEditorSettings['window']['cursor']['crosshair'], CROSS_HAIR_MODE> = {
  small: CROSS_HAIR_MODE.SMALL_CROSS,
  full: CROSS_HAIR_MODE.FULLSCREEN_CROSS,
  '45': CROSS_HAIR_MODE.FULLSCREEN_DIAGONAL,
};

/** A stored override's grid, as its index in the list (`override_*_idx`). */
function overrideIdx(aSizes: readonly { x: string }[], aSize: string): number {
  return Math.max(
    0,
    aSizes.findIndex((s) => s.x === aSize),
  );
}

/** `JSON_SETTINGS::Load`: the slice into the frame's settings object. */
export function loadPlEditorSettings(aCfg: PL_EDITOR_SETTINGS, aJson: PlEditorSettings): void {
  aCfg.m_System.units = EdaUnitsToInt(aJson.system.units);
  aCfg.m_System.last_metric_units = EdaUnitsToInt(aJson.system.last_metric_units);
  aCfg.m_System.last_imperial_units = EdaUnitsToInt(aJson.system.last_imperial_units);

  aCfg.m_ColorTheme = aJson.appearance.color_theme;
  aCfg.m_CustomToolbars = aJson.appearance.custom_toolbars;

  const g = aCfg.m_Window.grid;
  const jg = aJson.window.grid;
  g.grids = jg.sizes.map((e) => new GRID(e.name, e.x, e.y));
  g.last_size_idx = jg.last_size_idx;
  g.fast_grid_1 = jg.fast_grid_1;
  g.fast_grid_2 = jg.fast_grid_2;
  g.style = Math.max(0, GRID_STYLE.indexOf(jg.style));
  g.line_width = jg.line_width;
  g.min_spacing = jg.min_spacing;
  g.snap = jg.snap;
  g.show = jg.show;
  g.overrides_enabled = jg.overrides_enabled;
  g.override_text = jg.overrides.text.enabled;
  g.override_text_idx = overrideIdx(jg.sizes, jg.overrides.text.size);
  g.override_graphics = jg.overrides.graphics.enabled;
  g.override_graphics_idx = overrideIdx(jg.sizes, jg.overrides.graphics.size);

  aCfg.m_Window.cursor.cross_hair_mode = CURSOR_MODE[aJson.window.cursor.crosshair];
  aCfg.m_Window.cursor.always_show_cursor = aJson.window.cursor.always_show_cursor;

  // The seven PL_EDITOR_SETTINGS PARAMs (pl_editor_settings.cpp:45-58).
  aCfg.FromJson(aJson);
}

/**
 * `JSON_SETTINGS::Store`: the fields the frame writes, back into the slice.
 * Returns whether anything changed, so an unchanged frame does not commit
 * `pl_editor.json` and wake the account sync.
 */
export function storePlEditorSettings(aCfg: PL_EDITOR_SETTINGS, aJson: PlEditorSettings): boolean {
  let changed = false;
  const set = <T extends object, K extends keyof T>(aObj: T, aKey: K, aValue: T[K]): void => {
    if (aObj[aKey] !== aValue) {
      aObj[aKey] = aValue;
      changed = true;
    }
  };

  set(aJson.system, 'units', EdaUnitsFromInt(aCfg.m_System.units));
  set(aJson.system, 'last_metric_units', EdaUnitsFromInt(aCfg.m_System.last_metric_units));
  set(aJson.system, 'last_imperial_units', EdaUnitsFromInt(aCfg.m_System.last_imperial_units));

  const g = aCfg.m_Window.grid;
  set(aJson.window.grid, 'last_size_idx', g.last_size_idx);
  set(aJson.window.grid, 'show', g.show);

  const mode = aCfg.m_Window.cursor.cross_hair_mode;
  const crosshair = (Object.keys(CURSOR_MODE) as (keyof typeof CURSOR_MODE)[]).find(
    (k) => CURSOR_MODE[k] === mode,
  );
  if (crosshair) set(aJson.window.cursor, 'crosshair', crosshair);
  set(aJson.window.cursor, 'always_show_cursor', aCfg.m_Window.cursor.always_show_cursor);

  const own = aCfg.ToJson();
  for (const key of Object.keys(own) as (keyof typeof own)[]) set(aJson, key, own[key]);

  return changed;
}

/** Toolbar and menu ids -> the TOOL_ACTION each one is upstream (toolbars_pl_editor.cpp:35-113). */
export const ACTION_FOR_ID: Readonly<Record<string, TOOL_ACTION>> = {
  // TOP_MAIN
  new: ACTIONS.doNew,
  open: ACTIONS.open,
  save: ACTIONS.save,
  print: ACTIONS.print,
  undo: ACTIONS.undo,
  redo: ACTIONS.redo,
  zoomRedraw: ACTIONS.zoomRedraw,
  zoomIn: ACTIONS.zoomInCenter,
  zoomOut: ACTIONS.zoomOutCenter,
  zoomFit: ACTIONS.zoomFitScreen,
  zoomTool: ACTIONS.zoomTool,
  inspect: PL_ACTIONS.showInspector,
  previewSettings: PL_ACTIONS.previewSettings,
  layoutNormalMode: PL_ACTIONS.layoutNormalMode,
  layoutEditMode: PL_ACTIONS.layoutEditMode,
  // LEFT
  toggleGrid: ACTIONS.toggleGrid,
  gridProperties: ACTIONS.gridProperties,
  unitsMm: ACTIONS.millimetersUnits,
  unitsInches: ACTIONS.inchesUnits,
  unitsMils: ACTIONS.milsUnits,
  // RIGHT
  select: ACTIONS.selectionTool,
  dsAddLine: PL_ACTIONS.drawLine,
  dsAddRect: PL_ACTIONS.drawRectangle,
  dsAddText: PL_ACTIONS.placeText,
  dsAddBitmap: PL_ACTIONS.placeImage,
  appendSheet: PL_ACTIONS.appendImportedDrawingSheet,
  dsDelete: ACTIONS.deleteTool,
};

/** What `wxEVT_UPDATE_UI` answered for every control id the frame has conditions for. */
export interface UiState {
  /** Checked: the toggle buttons, the tool radio and the View rows. */
  checked: Set<string>;
  /** Disabled: Undo / Redo / Cut / Copy / Paste / Delete. */
  disabled: Set<string>;
}

/**
 * Each control's action asked through `wxEVT_UPDATE_UI`, which the frame
 * answers from the conditions `PL_EDITOR_FRAME::setupUIConditions` registered
 * (`pl_editor_frame.cpp:305-368`) on top of `EDA_DRAW_FRAME`'s.
 */
export function uiState(
  aFrame: PL_EDITOR_FRAME,
  aIds: Readonly<Record<string, TOOL_ACTION>>,
): UiState {
  const checked = new Set<string>();
  const disabled = new Set<string>();

  for (const [id, action] of Object.entries(aIds)) {
    const event = new wxUpdateUIEvent(action.GetUIId());

    if (!aFrame.ProcessUpdateUI(event)) continue;

    if (event.GetChecked()) checked.add(id);
    if (!event.GetEnabled()) disabled.add(id);
  }

  return { checked, disabled };
}

/** The Edit menu's rows, by the action each runs, for {@link uiState}. */
export const EDIT_MENU_ACTIONS: Readonly<Record<string, TOOL_ACTION>> = {
  undo: ACTIONS.undo,
  redo: ACTIONS.redo,
  cut: ACTIONS.cut,
  copy: ACTIONS.copy,
  paste: ACTIONS.paste,
  doDelete: ACTIONS.doDelete,
};
