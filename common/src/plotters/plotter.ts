// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PLOTTER` — the base every plot backend derives from, KiCad's
 * `include/plotters/plotter.h`.
 *
 * Upstream declares the two line-width sentinels **once**, as statics on
 * `PLOTTER` (plotter.h:139-140), and `PS_PLOTTER`, `SVG_PLOTTER`,
 * `PDF_PLOTTER`, `DXF_PLOTTER` and `GERBER_PLOTTER` all inherit that one pair.
 * We had re-declared them in each backend; they live here now for the same
 * reason KiCad puts them on the base — a backend that disagreed about which
 * of -1/-2 means "skip" would silently plot a different line width.
 *
 * The backends themselves still sit in `pcbnew/`, where the first one was
 * written; upstream keeps all of them in `common/plotters/`, because eeschema
 * plots through the same classes. Moving them is a separate job.
 */

/**
 * `PLOTTER::DO_NOT_SET_LINE_WIDTH` (plotter.h:139) — "Skip selection". The pen
 * is left exactly as it is; `SetCurrentLineWidth` returns without touching it.
 */
export const DO_NOT_SET_LINE_WIDTH = -2;

/**
 * `PLOTTER::USE_DEFAULT_LINE_WIDTH` (plotter.h:140) — "use the default pen",
 * i.e. resolve through `RENDER_SETTINGS::GetDefaultPenWidth()`.
 */
export const USE_DEFAULT_LINE_WIDTH = -1;

// Must be in the same order as the drop-down list in the plot dialog inside pcbnew
// Units (inch/mm for DXF plotter
export enum DXF_UNITS {
  INCH = 0, // Do not use MM: it conficts with a Windows header
  MM = 1,
}

/**
 * The set of supported output plot formats.
 *
 * They should be kept in order of the radio buttons in the plot panel/windows.
 */
export enum PLOT_FORMAT {
  UNDEFINED = -1,
  FIRST_FORMAT = 0,
  HPGL = FIRST_FORMAT,
  GERBER,
  POST,
  DXF,
  PDF,
  SVG,
  LAST_FORMAT = SVG,
}

/**
 * Options to draw items with thickness ( segments, arcs, circles, texts...)
 */
export enum DXF_OUTLINE_MODE {
  SKETCH = 0, // sketch mode: draw segments outlines only
  FILLED = 1, // normal mode: solid segments
}

/**
 * Which kind of text to output with the PSLIKE plotters.
 *
 * You can:
 * 1) only use the internal vector font
 * 2) only use native postscript fonts
 * 3) use the internal vector font and add 'phantom' text to aid
 *    searching
 * 4) keep the default for the plot driver
 *
 * This is recognized by the DXF driver too, where NATIVE emits
 * TEXT entities instead of stroking the text
 */
export enum PLOT_TEXT_MODE {
  STROKE = 0,
  NATIVE,
  PHANTOM,
  DEFAULT,
}

export class PLOT_PARAMS {
  GetDXFPlotMode(): DXF_OUTLINE_MODE {
    return DXF_OUTLINE_MODE.FILLED; // wxFAIL
  }

  GetTextMode(): PLOT_TEXT_MODE {
    return PLOT_TEXT_MODE.DEFAULT;
  }
}

/**
 * @enum DXF_LAYER_OUTPUT_MODE
 * @brief Specifies the output mode for the DXF layer.
 *
 * This enumeration is used to define the mode of output for the DXF layer.
 * It allows the user to choose between retrieving the layer name or the color name.
 */
export enum DXF_LAYER_OUTPUT_MODE {
  Layer_Name = 0,
  Layer_Color_Name,
  Current_Layer_Name,
  Current_Layer_Color_Name,
}
