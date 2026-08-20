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

/**
 * `EDA_UNIT_UTILS::GetText` (`common/eda_units.cpp:144-176`) — the unit suffix
 * `MessageTextFromValue` appends when its `aAddUnitsText` is left at its
 * upstream default of true (`include/eda_units.h:226-232`). It carries its own
 * leading space, so `"16535.00" + unitText('mils')` is `"16535.00 mils"`.
 *
 * {@link messageTextFromValue} omits it, because every status-bar field that
 * calls it prints the unit once in its own field rather than on each number.
 * The message panel is the other case: `DS_DRAW_ITEM_BASE::GetMsgPanelInfo`
 * takes the default and its rows read `(0.00 mils, 1.97 mils)`.
 */
export function unitText(units: StatusUnits): string {
  return units === 'mm' ? ' mm' : units === 'mils' ? ' mils' : ' in';
}

/**
 * C's `%g` conversion, which `wxString::Format` hands straight to the C
 * library — `PL_EDITOR_FRAME::UpdateStatusBar` formats its coordinates with
 * `"X %.4g  Y %.4g"` (`pagelayout_editor/pl_editor_frame.cpp:770-771`).
 *
 * `%g` is not "4 significant digits": it is 4 significant digits *and* a switch
 * to exponent form once the exponent leaves the range `-4 <= e < precision`,
 * with trailing zeros trimmed and the exponent padded to two digits. That is
 * why a cold-open pl_editor reads `X 1.266e+04  Y 1.217e+04` and not
 * `X 12660  Y 12170`, which is what `Number(n.toPrecision(4))` gives.
 *
 * The exponent is taken AFTER rounding to `precision` digits, as C does, so
 * 9999.6 at `%.4g` is `1e+04` rather than `9999.6`.
 */
export function formatG(value: number, precision = 4): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';

  const p = precision <= 0 ? 1 : precision;
  const rounded = value.toExponential(p - 1);
  const exponent = Number(rounded.slice(rounded.indexOf('e') + 1));

  const trim = (text: string): string =>
    text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;

  if (exponent < -4 || exponent >= p) {
    const mantissa = trim(rounded.slice(0, rounded.indexOf('e')));
    const sign = exponent < 0 ? '-' : '+';
    return `${mantissa}e${sign}${String(Math.abs(exponent)).padStart(2, '0')}`;
  }
  return trim(value.toFixed(Math.max(0, p - 1 - exponent)));
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
