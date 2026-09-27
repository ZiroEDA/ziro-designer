// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview.json` both ways, and the colour store: the page's settings slice (`prefs/settings.ts`,
 * which syncs to the account) and the `GERBVIEW_SETTINGS` object the frame
 * reads through `config()` / `gvconfig()`.
 *
 * Upstream these are one object, `JSON_SETTINGS::Load` filling it from the
 * file and `Store` writing it back. Here the file is the slice, so `Load`
 * copies slice -> object (into the SAME object, so the frame's `config()`
 * never changes identity) and `Store` copies back the fields the frame's
 * tools write - the display toggles, the element visibility, the grid index
 * and visibility, the cursor mode and the units.
 */

import { parseColor4d } from '@ziroeda/common/color4d.js';
import {
  GERBER_DRAW_LAYER,
  GERBER_DRAWLAYERS_COUNT,
  GERBVIEW_LAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { EdaUnitsFromInt, EdaUnitsToInt } from '@ziroeda/common/settings/app_settings.js';
import { GRID } from '@ziroeda/common/settings/grid_settings.js';
import { CROSS_HAIR_MODE } from '@ziroeda/common/gal/gal_display_options.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { wxUpdateUIEvent } from '@ziroeda/common/wx/wx_event.js';
import { GERBVIEW_ACTIONS } from '@ziroeda/gerbview/tools/gerbview_actions.js';
import {
  GERBVIEW_FIXED_LAYERS,
  graphicLayerKey,
} from '@ziroeda/gerbview/dialogs/panel_gerbview_color_settings.js';
import type { GERBVIEW_FRAME } from '@ziroeda/gerbview/gerbview_frame.js';
import type { GERBVIEW_SETTINGS } from '@ziroeda/gerbview/gerbview_settings.js';
import type { GerbviewSettings } from '../../prefs/settings.js';

/** `grid.style`'s stored integers (`common/settings/app_settings.cpp`): 0 dots, 1 lines, 2 crosses. */
const GRID_STYLE: readonly GerbviewSettings['window']['grid']['style'][] = [
  'dots',
  'lines',
  'crosses',
];

const CURSOR_MODE: Record<GerbviewSettings['window']['cursor']['crosshair'], CROSS_HAIR_MODE> = {
  small: CROSS_HAIR_MODE.SMALL_CROSS,
  full: CROSS_HAIR_MODE.FULLSCREEN_CROSS,
  '45': CROSS_HAIR_MODE.FULLSCREEN_DIAGONAL,
};

/** `JSON_SETTINGS::Load`: the slice into the frame's settings object. */
export function loadGerbviewSettings(aCfg: GERBVIEW_SETTINGS, aJson: GerbviewSettings): void {
  aCfg.m_System.units = EdaUnitsToInt(aJson.system.units);
  aCfg.m_System.last_metric_units = EdaUnitsToInt(aJson.system.last_metric_units);
  aCfg.m_System.last_imperial_units = EdaUnitsToInt(aJson.system.last_imperial_units);

  aCfg.m_ColorTheme = aJson.appearance.color_theme;
  aCfg.m_Appearance.show_border_and_titleblock = aJson.appearance.show_border_and_titleblock;
  aCfg.m_Appearance.show_dcodes = aJson.appearance.show_dcodes;
  aCfg.m_Appearance.show_negative_objects = aJson.appearance.show_negative_objects;
  aCfg.m_Appearance.page_type = aJson.appearance.page_type;

  const d = aCfg.m_Display;
  d.m_DisplayPageLimits = aJson.appearance.show_page_limit;
  d.m_OpacityModeAlphaValue = aJson.appearance.mode_opacity_value;
  d.m_DisplayFlashedItemsFill = aJson.display.flashed_items_fill;
  d.m_DisplayLinesFill = aJson.display.lines_fill;
  d.m_DisplayPolygonsFill = aJson.display.polygons_fill;
  d.m_ForceOpacityMode = aJson.display.force_opacity_mode;
  d.m_XORMode = aJson.display.xor_mode;
  d.m_HighContrastMode = aJson.display.high_contrast_mode;
  d.m_FlipGerberView = aJson.display.flip_gerber_view;

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

  aCfg.m_Window.cursor.cross_hair_mode = CURSOR_MODE[aJson.window.cursor.crosshair];
  aCfg.m_Window.cursor.always_show_cursor = aJson.window.cursor.always_show_cursor;

  const x = aCfg.m_ExcellonDefaults;
  x.m_UnitsMM = aJson.excellon_defaults.unit_mm;
  x.m_LeadingZero = aJson.excellon_defaults.lz_format;
  x.m_MmIntegerLen = aJson.excellon_defaults.mm_integer_len;
  x.m_MmMantissaLen = aJson.excellon_defaults.mm_mantissa_len;
  x.m_InchIntegerLen = aJson.excellon_defaults.inch_integer_len;
  x.m_InchMantissaLen = aJson.excellon_defaults.inch_mantissa_len;

  aCfg.m_BoardLayersCount = aJson.gerber_to_pcb_copperlayers_count;
  // `deepMerge` adopts a stored list whole, so a hand-edited file's non-numbers
  // are dropped here rather than handed to the dialog as layer ids.
  aCfg.m_GerberToPcbLayerMapping = aJson.gerber_to_pcb_layers.filter((v) => Number.isInteger(v));
}

/**
 * `JSON_SETTINGS::Store`: the fields the frame and its tools write, back into
 * the slice. Returns whether anything changed, so an unchanged frame does not
 * commit `gerbview.json` and wake the account sync.
 */
export function storeGerbviewSettings(aCfg: GERBVIEW_SETTINGS, aJson: GerbviewSettings): boolean {
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

  const a = aCfg.m_Appearance;
  set(aJson.appearance, 'show_border_and_titleblock', a.show_border_and_titleblock);
  set(aJson.appearance, 'show_dcodes', a.show_dcodes);
  set(aJson.appearance, 'show_negative_objects', a.show_negative_objects);
  set(aJson.appearance, 'page_type', a.page_type);

  const d = aCfg.m_Display;
  set(aJson.appearance, 'show_page_limit', d.m_DisplayPageLimits);
  set(aJson.display, 'flashed_items_fill', d.m_DisplayFlashedItemsFill);
  set(aJson.display, 'lines_fill', d.m_DisplayLinesFill);
  set(aJson.display, 'polygons_fill', d.m_DisplayPolygonsFill);
  set(aJson.display, 'force_opacity_mode', d.m_ForceOpacityMode);
  set(aJson.display, 'xor_mode', d.m_XORMode);
  set(aJson.display, 'high_contrast_mode', d.m_HighContrastMode);
  set(aJson.display, 'flip_gerber_view', d.m_FlipGerberView);

  const g = aCfg.m_Window.grid;
  set(aJson.window.grid, 'last_size_idx', g.last_size_idx);
  set(aJson.window.grid, 'show', g.show);

  const mode = aCfg.m_Window.cursor.cross_hair_mode;
  const crosshair = (Object.keys(CURSOR_MODE) as (keyof typeof CURSOR_MODE)[]).find(
    (k) => CURSOR_MODE[k] === mode,
  );
  if (crosshair) set(aJson.window.cursor, 'crosshair', crosshair);
  set(aJson.window.cursor, 'always_show_cursor', aCfg.m_Window.cursor.always_show_cursor);

  // Written by the Map Gerber Layers dialog's Store Choice (`OnStoreSetup`).
  set(aJson, 'gerber_to_pcb_copperlayers_count', aCfg.m_BoardLayersCount);
  const mapping = aCfg.m_GerberToPcbLayerMapping;
  const stored = aJson.gerber_to_pcb_layers;

  if (mapping.length !== stored.length || mapping.some((v, i) => v !== stored[i])) {
    aJson.gerber_to_pcb_layers = [...mapping];
    changed = true;
  }

  return changed;
}

/**
 * The frame's colour theme, loaded from the page's colour store: the Layers
 * manager and Preferences > Gerber Viewer > Colors both write that store, as
 * upstream both write the one COLOR_SETTINGS.
 */
export function loadGerbviewColors(
  aFrame: GERBVIEW_FRAME,
  aUserColors: Record<string, string>,
): void {
  const cs = aFrame.GetColorSettings();

  // Every row, not only the overridden ones: a row whose override was reset
  // has no key any more, and must go back to the theme's own colour rather
  // than keep the last one set.
  for (let row = 0; row < GERBER_DRAWLAYERS_COUNT; ++row) {
    const layer = GERBER_DRAW_LAYER(row);
    const value = aUserColors[graphicLayerKey(row)];

    cs.SetColor(layer, value ? parseColor4d(value) : cs.GetDefaultColor(layer));
  }

  for (const fixed of GERBVIEW_FIXED_LAYERS) {
    const value = aUserColors[fixed.key];
    const id = (GERBVIEW_LAYER_ID as unknown as Record<string, number>)[fixed.id];

    if (id !== undefined) cs.SetColor(id, value ? parseColor4d(value) : cs.GetDefaultColor(id));
  }
}

/** Toolbar and menu ids -> the TOOL_ACTION each one is upstream. */
export const ACTION_FOR_ID: Readonly<Record<string, TOOL_ACTION>> = {
  gerbClear: GERBVIEW_ACTIONS.clearAllLayers,
  gerbReload: GERBVIEW_ACTIONS.reloadAllLayers,
  gerbOpenAutodetected: GERBVIEW_ACTIONS.openAutodetected,
  gerbOpen: GERBVIEW_ACTIONS.openGerber,
  gerbOpenDrill: GERBVIEW_ACTIONS.openDrillFile,
  print: ACTIONS.print,
  zoomRedraw: ACTIONS.zoomRedraw,
  zoomIn: ACTIONS.zoomInCenter,
  zoomOut: ACTIONS.zoomOutCenter,
  zoomFit: ACTIONS.zoomFitScreen,
  zoomTool: ACTIONS.zoomTool,
  select: ACTIONS.selectionTool,
  measure: ACTIONS.measureTool,
  toggleGrid: ACTIONS.toggleGrid,
  togglePolar: ACTIONS.togglePolarCoords,
  unitsMm: ACTIONS.millimetersUnits,
  unitsInches: ACTIONS.inchesUnits,
  unitsMils: ACTIONS.milsUnits,
  crosshairSmall: ACTIONS.cursorSmallCrosshairs,
  crosshairFull: ACTIONS.cursorFullCrosshairs,
  crosshair45: ACTIONS.cursor45Crosshairs,
  flashedSketch: GERBVIEW_ACTIONS.flashedDisplayOutlines,
  linesSketch: GERBVIEW_ACTIONS.linesDisplayOutlines,
  polygonsSketch: GERBVIEW_ACTIONS.polygonsDisplayOutlines,
  showNegativeObjects: GERBVIEW_ACTIONS.negativeObjectDisplay,
  showDcodes: GERBVIEW_ACTIONS.dcodeDisplay,
  forceOpacityMode: GERBVIEW_ACTIONS.toggleForceOpacityMode,
  xorMode: GERBVIEW_ACTIONS.toggleXORMode,
  highContrast: ACTIONS.highContrastMode,
  flipView: GERBVIEW_ACTIONS.flipGerberView,
  showLayerManager: GERBVIEW_ACTIONS.toggleLayerManager,
};

/**
 * The check state of the toggle buttons and View menu rows: each control's
 * action asked through `wxEVT_UPDATE_UI`, which the frame answers from the
 * conditions `GERBVIEW_FRAME::setupUIConditions` registered
 * (`gerbview_frame.cpp:1105-1165`).
 */
export function checkedSet(aFrame: GERBVIEW_FRAME): Set<string> {
  const out = new Set<string>();

  for (const [id, action] of Object.entries(ACTION_FOR_ID)) {
    const event = new wxUpdateUIEvent(action.GetUIId());

    if (aFrame.ProcessUpdateUI(event) && event.GetChecked()) out.add(id);
  }

  return out;
}
