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

import {
  EdaIuScale,
  messageTextFromValue as EdaMessageTextFromValue,
  PCB_IU_PER_MM,
  unitLabelText,
} from '@ziroeda/common';

/**
 * The DPI GAL assumes when it converts a view scale to a zoom factor
 * (`GAL::computeWorldScale`, common/gal/graphics_abstraction_layer.cpp — the
 * `m_worldScale = m_screenDPI * m_zoomFactor / IU_per_inch` relation).
 */
export const GAL_SCREEN_DPI = 91;

/**
 * `GAL::computeWorldScale`'s last two lines
 * (`include/gal/graphics_abstraction_layer.h:1066-1074`):
 *
 *     m_worldScale = m_screenDPI * m_worldUnitLength * m_zoomFactor;
 *     if( pgm && pgm->GetCommonSettings() )
 *         m_worldScale *= pgm->GetCommonSettings()->m_Appearance.zoom_correction_factor;
 *
 * The correction sits between the ZOOM FACTOR and the world scale, and that
 * placement is the whole design: a view's scale changes, so a millimetre drawn
 * is a millimetre measured with a real ruler, while the zoom the status bar and
 * the zoom selector talk about does NOT — 1.00 still means 1.00. Both of those
 * conversions go through the two functions below, which is why this is the only
 * place in the app that has to know about it, exactly as `computeWorldScale` is
 * upstream's only place.
 *
 * **Pushed, not pulled, and that is not a preference.** Upstream asks
 * `PgmOrNull()` at compute time; reading `settings.common` from here is a
 * cycle — `prefs/settings.ts` imports `ui/grid_settings.ts` for its grid
 * tables, so a module this low importing the settings store leaves
 * `GRID_SIZE_LIST` undefined at import time and every editor test dies in
 * `settings.ts`'s initialiser. `ui/common_appearance.ts` owns the reading and
 * calls the setter below, which is the same shape `CommonSettingsChanged` has:
 * the settings change, and each thing that depends on them is told.
 */
let g_zoomCorrection = 1;

/**
 * `PARAM<double>( "appearance.zoom_correction_factor", …, 1.0, 0.1, 10.0 )`
 * (`common_settings.cpp:125-126`). A stored zero or a negative would divide the
 * zoom readout by zero, so the range is enforced here rather than trusted —
 * localStorage is hand-editable and this is the only guard between it and every
 * canvas transform in the app.
 */
export function setZoomCorrection(factor: number): void {
  g_zoomCorrection = Number.isFinite(factor) && factor >= 0.1 && factor <= 10 ? factor : 1;
}

/** What the canvases are currently scaling by. Exported for its own tests. */
export function zoomCorrection(): number {
  return g_zoomCorrection;
}

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
  return ((scale / Math.max(dpr, 1e-9)) * ((iuPerMM * 25.4) / GAL_SCREEN_DPI)) / zoomCorrection();
}

/** The inverse, for the zoom selector (`EDA_DRAW_FRAME::OnUpdateSelectZoom`). */
export function scaleForZoomFactor(
  zoom: number,
  dpr: number,
  iuPerMM: number = PCB_IU_PER_MM,
): number {
  return ((zoom * GAL_SCREEN_DPI * Math.max(dpr, 1e-9)) / (iuPerMM * 25.4)) * zoomCorrection();
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
 * status-bar coordinate goes through — {@link EdaMessageTextFromValue} in
 * `common/`, which is where KiCad keeps it (`common/eda_units.cpp:417`).
 *
 * This wrapper exists only to keep the status bar's call shape: a length in
 * **millimetres**, and no unit label, because every status-bar field prints
 * its unit once in its own pane rather than on each number. Everything about
 * *how* the number is written — the per-unit precision, the scientific-notation
 * fallback, the 2-1/2-digit mm trim — belongs to the shared function and is
 * asked for, never restated here.
 *
 * `short_form` is `aIuScale.IU_PER_MM == SCH_IU_PER_MM` upstream, so eeschema
 * and the symbol editor print one digit fewer than pcbnew everywhere.
 */
export function messageTextFromValue(
  mm: number,
  units: StatusUnits,
  iuPerMM: number = PCB_IU_PER_MM,
): string {
  return EdaMessageTextFromValue(new EdaIuScale(iuPerMM), units, mm * iuPerMM, false);
}

/**
 * `EDA_UNIT_UTILS::GetText` (`common/eda_units.cpp:143-176`) — the unit suffix
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
  return unitLabelText(units);
}

/**
 * C's `%g` conversion — {@link formatG} in `common/`, re-exported here because
 * `PL_EDITOR_FRAME::UpdateStatusBar` formats its coordinates with `"X %.4g  Y
 * %.4g"` (`pagelayout_editor/pl_editor_frame.cpp:770-771`) and the board's
 * message panel writes a footprint's rotation with the same conversion
 * (`pcbnew/footprint.cpp:2170`). One implementation, two callers.
 */
export { formatG } from '@ziroeda/common';

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

/**
 * `LEADER_MODE`, the angle-snap mode a frame's drawing tools work in. Each
 * editor stores it as one of the three `lineMode…` toolbar radio ids; these are
 * the enumerators those ids stand for.
 */
export type AngleSnapMode = 'direct' | 'deg90' | 'deg45';

/** The three `lineMode…` toolbar ids, as `OnAngleSnapModeChanged` maps them. */
export function angleSnapModeOf(toggles: ReadonlySet<string>): AngleSnapMode {
  if (toggles.has('lineMode45')) return 'deg45';
  if (toggles.has('lineMode90')) return 'deg90';
  return 'direct';
}

/**
 * Field 7, `DisplayConstraintsMsg` (`common/eda_draw_frame.cpp:738-744`, which
 * is `SetStatusText( msg, 7 )`). The text is `DRAWING_TOOL::UpdateStatusBar`
 * (`pcbnew/tools/drawing_tool.cpp:340-357`):
 *
 *     case LEADER_MODE::DEG45: … _( "Constrain to H, V, 45" )
 *     case LEADER_MODE::DEG90: … _( "Constrain to H, V" )
 *     default:                 … wxString( "" )
 *
 * It is **not** conditional on a drawing tool being armed. `UpdateStatusBar` is
 * called from `DRAWING_TOOL::Reset` (:329), which runs when the tool manager
 * resets every tool at frame construction, so the pane is filled before the
 * user touches anything — which is why a freshly-opened footprint editor reads
 * "Constrain to H, V, 45" with the selection tool active.
 */
export function constraintsMsg(mode: AngleSnapMode): string {
  switch (mode) {
    case 'deg45':
      return 'Constrain to H, V, 45';
    case 'deg90':
      return 'Constrain to H, V';
    default:
      return '';
  }
}
