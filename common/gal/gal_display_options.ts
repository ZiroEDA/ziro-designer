// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `include/gal/gal_display_options.h` + `common/gal/gal_display_options.cpp`. */
import { OBSERVABLE } from '@ziroeda/core/src/observable.js';

/**
 * Type definition of the grid style.
 */
export enum GRID_STYLE {
  DOTS, ///< Use dots for the grid
  LINES, ///< Use lines for the grid
  SMALL_CROSS, ///< Use small cross instead of dots for the grid
}

export enum GAL_ANTIALIASING_MODE {
  AA_NONE,
  AA_FAST,
  AA_HIGHQUALITY,
}

export enum GRID_SNAPPING {
  ALWAYS,
  WITH_GRID,
  NEVER,
}

export enum CROSS_HAIR_MODE {
  SMALL_CROSS,
  FULLSCREEN_CROSS,
  FULLSCREEN_DIAGONAL,
}

export interface GAL_DISPLAY_OPTIONS_OBSERVER {
  OnGalDisplayOptionsChanged(aOptions: GAL_DISPLAY_OPTIONS): void;
}

/**
 * `DPI_SCALING::GetDefaultScaleFactor()`: 0 means "read it from the system"
 * (`common/dpi_scaling.cpp`); the browser's devicePixelRatio is that system
 * answer, asked by the canvas.
 */
export function DPI_SCALING_GetDefaultScaleFactor(): number {
  return 0.0;
}

export class GAL_DISPLAY_OPTIONS extends OBSERVABLE<GAL_DISPLAY_OPTIONS_OBSERVER> {
  antialiasing_mode: GAL_ANTIALIASING_MODE = GAL_ANTIALIASING_MODE.AA_NONE;

  ///< The grid style to draw the grid in
  m_gridStyle: GRID_STYLE = GRID_STYLE.DOTS;

  ///< Snapping options for the grid
  m_gridSnapping: GRID_SNAPPING = GRID_SNAPPING.ALWAYS;

  ///< Thickness to render grid lines/dots
  m_gridLineWidth = 1.0;

  ///< Minimum pixel distance between displayed grid lines
  m_gridMinSpacing = 10.0;

  ///< Whether or not to draw the coordinate system axes
  m_axesEnabled = false;

  ///< Cursor display mode option
  m_crossHairMode: CROSS_HAIR_MODE = CROSS_HAIR_MODE.SMALL_CROSS;

  ///< Force cursor display
  m_forceDisplayCursor = false;

  ///< The pixel scale factor (>1 for hi-DPI scaled displays)
  m_scaleFactor: number = DPI_SCALING_GetDefaultScaleFactor();

  SetCursorMode(aMode: CROSS_HAIR_MODE): void {
    this.m_crossHairMode = aMode;
  }

  GetCursorMode(): CROSS_HAIR_MODE {
    return this.m_crossHairMode;
  }

  /**
   * `GAL_DISPLAY_OPTIONS_IMPL::ReadCommonConfig` (gal_display_options_common.cpp:82-92):
   * the antialiasing mode from COMMON_SETTINGS `graphics.antialiasing_mode`.
   * The DPI half is the canvas's own devicePixelRatio here.
   */
  ReadCommonConfig(aSettings: { graphics: { antialiasing_mode: number } }): void {
    this.antialiasing_mode = aSettings.graphics.antialiasing_mode as GAL_ANTIALIASING_MODE;
    this.NotifyChanged();
  }

  NotifyChanged(): void {
    this.Notify((o) => o.OnGalDisplayOptionsChanged(this));
  }
}
