// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GAL_DISPLAY_OPTIONS_IMPL` (include/gal_display_options_common.h,
 * common/gal_display_options_common.cpp): the GAL options a frame owns, read
 * from the frame's WINDOW_SETTINGS and from COMMON_SETTINGS, with the pixel
 * scale from `DPI_SCALING_COMMON`.
 */
import { DPI_SCALING_COMMON, type DPI_SCALING_CONFIG } from './dpi_scaling_common.js';
import {
  GAL_ANTIALIASING_MODE,
  GAL_DISPLAY_OPTIONS,
  GRID_SNAPPING,
  GRID_STYLE,
} from './gal/gal_display_options.js';
import type { PlatformWindow } from './kiplatform/ui.js';
import type { WINDOW_SETTINGS } from './settings/app_settings.js';

/** `UTIL::CFG_MAP` (include/config_map.h): enum value <-> stored integer. */
type CFG_MAP<T> = readonly (readonly [T, number])[];

const gridStyleConfigVals: CFG_MAP<GRID_STYLE> = [
  [GRID_STYLE.DOTS, 0],
  [GRID_STYLE.LINES, 1],
  [GRID_STYLE.SMALL_CROSS, 2],
];

const gridSnapConfigVals: CFG_MAP<GRID_SNAPPING> = [
  [GRID_SNAPPING.ALWAYS, 0],
  [GRID_SNAPPING.WITH_GRID, 1],
  [GRID_SNAPPING.NEVER, 2],
];

/** `UTIL::GetValFromConfig`: the value for a stored integer, else the map's first. */
function GetValFromConfig<T>(aMap: CFG_MAP<T>, aConf: number): T {
  return (aMap.find(([, c]) => c === aConf) ?? aMap[0]!)[0];
}

/** `UTIL::GetConfigForVal`: the stored integer for a value, else the map's first. */
function GetConfigForVal<T>(aMap: CFG_MAP<T>, aVal: T): number {
  return (aMap.find(([v]) => v === aVal) ?? aMap[0]!)[1];
}

/** The part of COMMON_SETTINGS `ReadCommonConfig` reads. */
export interface GAL_COMMON_CONFIG extends DPI_SCALING_CONFIG {
  m_Graphics: { aa_mode: number };
}

export class GAL_DISPLAY_OPTIONS_IMPL extends GAL_DISPLAY_OPTIONS {
  private m_dpi = new DPI_SCALING_COMMON(null, null);

  /** Read application and common configs. */
  ReadConfig(
    aCommonConfig: GAL_COMMON_CONFIG,
    aWindowConfig: WINDOW_SETTINGS,
    aWindow: PlatformWindow | null,
  ): void {
    this.ReadWindowSettings(aWindowConfig);
    this.ReadCommonConfig(aCommonConfig, aWindow);
  }

  /** Read GAL config options from application-level config. */
  ReadWindowSettings(aCfg: WINDOW_SETTINGS): void {
    this.m_gridStyle = GetValFromConfig(gridStyleConfigVals, aCfg.grid.style);
    this.m_gridSnapping = GetValFromConfig(gridSnapConfigVals, aCfg.grid.snap);
    this.m_gridLineWidth = aCfg.grid.line_width;
    this.m_gridMinSpacing = aCfg.grid.min_spacing;
    this.m_axesEnabled = aCfg.grid.axes_enabled;

    this.m_crossHairMode = aCfg.cursor.cross_hair_mode;
    this.m_forceDisplayCursor = aCfg.cursor.always_show_cursor;

    this.NotifyChanged();
  }

  /** Read GAL config options from the common config store. */
  ReadCommonConfig(aSettings: GAL_COMMON_CONFIG, aWindow: PlatformWindow | null): void {
    this.antialiasing_mode = aSettings.m_Graphics.aa_mode as GAL_ANTIALIASING_MODE;

    this.m_dpi = new DPI_SCALING_COMMON(aSettings, aWindow);
    this.UpdateScaleFactor();

    this.NotifyChanged();
  }

  /** Write GAL config options to application-level config (just the grid and cursor). */
  WriteConfig(aCfg: WINDOW_SETTINGS): void {
    aCfg.grid.style = GetConfigForVal(gridStyleConfigVals, this.m_gridStyle);
    aCfg.grid.snap = GetConfigForVal(gridSnapConfigVals, this.m_gridSnapping);
    aCfg.grid.line_width = this.m_gridLineWidth;
    aCfg.grid.min_spacing = this.m_gridMinSpacing;
    aCfg.grid.axes_enabled = this.m_axesEnabled;
    aCfg.cursor.cross_hair_mode = this.m_crossHairMode;
    aCfg.cursor.always_show_cursor = this.m_forceDisplayCursor;
  }

  UpdateScaleFactor(): void {
    if (this.m_scaleFactor !== this.m_dpi.GetScaleFactor()) {
      this.m_scaleFactor = this.m_dpi.GetScaleFactor();
      this.NotifyChanged();
    }
  }
}
