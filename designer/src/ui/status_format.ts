// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The number formatting every KiCad frame's status bar shares.
 *
 * Counterparts:
 *   - `EDA_UNIT_UTILS::UI::MessageTextFromValue` (common/eda_units.cpp:417)
 *   - `EDA_DRAW_FRAME::GetZoomLevelIndicator` / `DisplayUnitsMsg` /
 *     `DisplayGridMsg` (common/eda_draw_frame.cpp:865 / :763 / :747)
 *   - `GRID::MessageText` (common/settings/grid_settings.cpp:27)
 *   - `SCH_BASE_FRAME::UpdateStatusBar` (eeschema/sch_base_frame.cpp:252),
 *     `PCB_BASE_FRAME::UpdateStatusBar` (pcbnew/pcb_base_frame.cpp:761),
 *     `GERBVIEW_FRAME::UpdateStatusBar` (gerbview/gerbview_frame.cpp:962)
 *
 * These live apart from `KiStatusBar.tsx` so the renderer can share
 * `GAL_SCREEN_DPI` without pulling React into a canvas module.
 */

import { PCB_IU_PER_MM, SCH_IU_PER_MM } from '@ziroeda/common';

/**
 * The DPI GAL assumes when it converts a view scale to a zoom factor
 * (`GAL::computeWorldScale`, common/gal/graphics_abstraction_layer.cpp — the
 * `m_worldScale = m_screenDPI * m_zoomFactor / IU_per_inch` relation).
 */
export const GAL_SCREEN_DPI = 91;

/** The unit a status bar reports in (`EDA_UNITS`, minus the ones no frame shows). */
export type StatusUnits = 'mm' | 'in' | 'mils';

/**
 * `GAL::GetZoomFactor()` as `EDA_DRAW_FRAME::GetZoomLevelIndicator` reads it.
 *
 * `scale` here is *device* pixels per IU while GAL's is physical screen pixels,
 * so the device-pixel ratio divides out: on a HiDPI display GAL renders into a
 * larger framebuffer without changing the zoom it reports.
 */
export function zoomFactorForScale(
  scale: number,
  dpr: number,
  iuPerMM: number = PCB_IU_PER_MM,
): number {
  return (scale / Math.max(dpr, 1e-9)) * ((iuPerMM * 25.4) / GAL_SCREEN_DPI);
}

/** The inverse, for the zoom selector (`EDA_DRAW_FRAME::OnUpdateSelectZoom`). */
export function scaleForZoomFactor(
  zoom: number,
  dpr: number,
  iuPerMM: number = PCB_IU_PER_MM,
): number {
  return (zoom * GAL_SCREEN_DPI * Math.max(dpr, 1e-9)) / (iuPerMM * 25.4);
}

/** Field 1: `wxString::Format( "Z %.2f", zoom )`. */
export function zoomMsg(zoom: number): string {
  return `Z ${Number.isFinite(zoom) && zoom > 0 ? zoom.toFixed(2) : '-'}`;
}

/**
 * Field 5: `EDA_DRAW_FRAME::DisplayUnitsMsg` — the *word*, not the abbreviation.
 * `EDA_UNITS::INCH` prints "inches", never "in".
 */
export function unitsMsg(units: StatusUnits): string {
  return units === 'in' ? 'inches' : units === 'mils' ? 'mils' : 'mm';
}

/**
 * `MessageTextFromValue`, the lower-precision (readable) formatter every
 * status-bar coordinate goes through.
 *
 * `short_form` is `aIuScale.IU_PER_MM == SCH_IU_PER_MM` upstream, so eeschema
 * and the symbol editor print one digit fewer than pcbnew everywhere, and mm
 * gets the extra "2-1/2 digits" trim (common/eda_units.cpp:497-503).
 */
export function messageTextFromValue(
  mm: number,
  units: StatusUnits,
  iuPerMM: number = PCB_IU_PER_MM,
): string {
  const shortForm = iuPerMM === SCH_IU_PER_MM;
  const value = units === 'mm' ? mm : units === 'mils' ? (mm / 25.4) * 1000 : mm / 25.4;
  const digits =
    units === 'mm'
      ? shortForm
        ? 3
        : 4
      : units === 'mils'
        ? shortForm
          ? 0
          : 2
        : shortForm
          ? 3
          : 4;

  let text = value.toFixed(digits);

  // Non-zero values that round to all zeros fall back to scientific notation.
  if (value !== 0 && !/[1-9]/.test(text)) text = value.toExponential(3);

  // Trim to 2-1/2 digits after the decimal place for short-form mm.
  if (shortForm && units === 'mm') {
    const n = text.length;
    if (n > 4 && text[n - 4] === '.' && text[n - 1] === '0') text = text.slice(0, n - 1);
  }

  return text;
}

/** Field 2: `"X %s  Y %s"` (two spaces), or the placeholder off-canvas. */
export function coordsMsg(x: string | null, y?: string): string {
  return x === null || y === undefined ? 'X, Y -' : `X ${x}  Y ${y}`;
}

/** Field 3, cartesian: `"dx %s  dy %s  dist %s"`. */
export function deltasMsg(dx: string | null, dy?: string, dist?: string): string {
  return dx === null || dy === undefined || dist === undefined
    ? 'dx, dy, dist -'
    : `dx ${dx}  dy ${dy}  dist ${dist}`;
}

/** Field 3, polar (`GetShowPolarCoords()`): `"r %s  theta %.3f"`. */
export function polarMsg(r: string | null, thetaDeg?: number): string {
  return r === null || thetaDeg === undefined
    ? 'r, theta -'
    : `r ${r}  theta ${thetaDeg.toFixed(3)}`;
}

/**
 * Field 4: `_( "grid %s" )` over `GRID::MessageText`, which collapses a square
 * grid to one number and prints `"%s x %s"` only when x and y differ.
 */
export function gridMsg(x: string, y: string = x): string {
  return `grid ${x === y ? x : `${x} x ${y}`}`;
}
