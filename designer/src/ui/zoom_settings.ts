// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/zoom_defines.h` and `COMMON_TOOLS::doZoomInOut`
 * (`common/tool/common_tools.cpp:252-291`) — the zoom presets every frame steps
 * through, and the search that turns a Zoom In into one of them.
 *
 * Upstream this is a header in `include/` and a method in `common/tool/`, i.e.
 * one table shared by every app, reached through
 * `APP_SETTINGS_BASE::DefaultZoomList` (`common/settings/app_settings.cpp:572-586`)
 * switching on the settings filename. It is a shared module here for the same
 * reason `ui/grid_settings.ts` is: pcbnew had already grown a private copy of
 * its row.
 *
 * Why this matters to a user rather than to a maintainer: KiCad never lands on
 * an arbitrary zoom. Every Zoom In / Zoom Out snaps to the next entry of the
 * table, the canvas context menu offers those same entries by name
 * (`ZOOM_MENU::update`, `common/tool/zoom_menu.cpp:60-81`), and the entry
 * matching the current zoom is checked — so the zoom is a repeatable, nameable
 * place you can return to. A bare `scale *= 1.3` gives none of that.
 */

import { scaleForZoomFactor, zoomFactorForScale } from './status_format.js';

/** Which row of `DefaultZoomList()`'s switch a frame lands on. */
export type ZoomApp = 'eeschema' | 'symbol_editor' | 'pl_editor' | 'gerbview' | 'pcbnew';

/** `zoom_defines.h`, verbatim. */
export const ZOOM_LIST: Record<ZoomApp, readonly number[]> = {
  // ZOOM_LIST_EESCHEMA (zoom_defines.h:41-42) — the symbol editor shares it.
  eeschema: [
    0.05, 0.07, 0.1, 0.15, 0.2, 0.3, 0.5, 0.7, 1.0, 1.5, 2.0, 3.0, 4.5, 6.5, 10.0, 15.0, 20.0, 30.0,
    45.0, 65.0, 100.0,
  ],
  symbol_editor: [
    0.05, 0.07, 0.1, 0.15, 0.2, 0.3, 0.5, 0.7, 1.0, 1.5, 2.0, 3.0, 4.5, 6.5, 10.0, 15.0, 20.0, 30.0,
    45.0, 65.0, 100.0,
  ],
  // ZOOM_LIST_PL_EDITOR (zoom_defines.h:38-39).
  pl_editor: [
    0.022, 0.035, 0.05, 0.08, 0.13, 0.22, 0.35, 0.6, 1.0, 2.2, 3.5, 5.0, 8.0, 13.0, 22.0, 35.0,
    50.0, 80.0, 130.0, 220.0,
  ],
  // ZOOM_LIST_GERBVIEW (zoom_defines.h:29-30).
  gerbview: [
    0.022, 0.035, 0.05, 0.08, 0.13, 0.22, 0.35, 0.6, 1.0, 2.2, 3.5, 5.0, 8.0, 13.0, 22.0, 35.0,
    50.0, 80.0, 130.0, 220.0,
  ],
  // ZOOM_LIST_PCBNEW (zoom_defines.h:32-33) — the footprint editor shares it.
  pcbnew: [
    0.13, 0.22, 0.35, 0.6, 1.0, 1.5, 2.2, 3.5, 5.0, 8.0, 13.0, 20.0, 35.0, 50.0, 80.0, 130.0, 220.0,
    300.0,
  ],
};

/**
 * `COMMON_TOOLS::doZoomInOut` (`common/tool/common_tools.cpp:252-291`): the
 * zoom a Zoom In or Zoom Out lands on, given the one it is leaving.
 *
 * The multiply by 1.3 is not the answer, it is the *floor* — "Step must be AT
 * LEAST 1.3" — and the answer is then the nearest table entry beyond it, pegged
 * to the end of the list rather than running off it. So repeatedly zooming in
 * walks the table one entry at a time once the entries are more than 30 % apart,
 * and skips entries where they are closer together.
 */
export function nextZoomPreset(list: readonly number[], zoom: number, zoomIn: boolean): number {
  if (list.length === 0) return zoom;
  const target = zoomIn ? zoom * 1.3 : zoom / 1.3;

  if (zoomIn) {
    for (const z of list) {
      if (z >= target) return z;
    }
    return list[list.length - 1] as number;
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const z = list[i] as number;
    if (z <= target) return z;
  }
  return list[0] as number;
}

/**
 * `ZOOM_MENU::update` (`common/tool/zoom_menu.cpp:60-81`): the row label, and
 * which row carries the checkmark.
 *
 * The label is `_( "Zoom: %.2f" )` and the check is a *relative* comparison —
 * `std::fabs( zoomList[jj] - zoom ) / zoom < 0.1` — so a zoom arrived at by
 * dragging still marks the preset it is nearest to.
 */
export function zoomPresetLabel(factor: number): string {
  return `Zoom: ${factor.toFixed(2)}`;
}

/** True when `factor` is the row `ZOOM_MENU` would tick at the current zoom. */
export function isZoomPresetChecked(factor: number, zoom: number): boolean {
  return zoom > 0 && Math.abs(factor - zoom) / zoom < 0.1;
}

/* ---------------------------------------------------------------------------
   The zoomSelect TOOLBAR CONTROL (`ACTION_TOOLBAR_CONTROLS::zoomSelect`).

   Distinct from the context menu above, and the difference is not cosmetic: the
   menu is `ZOOM_MENU`, whose rows read "Zoom: %.2f" and whose check is a
   relative match; the toolbar box is `EDA_DRAW_FRAME::UpdateZoomSelectBox`,
   whose rows read "Zoom %.2f" -- no colon -- and whose selection is exact.
   --------------------------------------------------------------------------- */

/** `_( "Zoom Auto" )`, the row `UpdateZoomSelectBox` always appends first. */
export const ZOOM_AUTO_LABEL = 'Zoom Auto';

/**
 * `wxString::Format( _( "Zoom %.2f" ), current )`
 * (`common/eda_draw_frame.cpp:656`, and again at `:524` for the custom entry).
 * Note the missing colon against {@link zoomPresetLabel}'s "Zoom: %.2f".
 */
export function zoomSelectorLabel(zoom: number): string {
  return `Zoom ${zoom.toFixed(2)}`;
}

/** One row of the zoom selector. */
export interface ZoomChoice {
  label: string;
  /**
   * The `ACTIONS::zoomPreset` argument this row dispatches, in upstream's own
   * numbering -- `COMMON_TOOLS::doZoomToPreset` notes "idx == 0 is Auto; idx == 1
   * is first entry in zoomList" (`common/tool/common_tools.cpp:467-482`), and
   * idx 0 runs `ZoomFitScreen` rather than setting any scale (`:472-476`).
   *
   * `null` is the custom entry only: picking it means keep the current zoom, so
   * `EDA_DRAW_FRAME::OnSelectZoom` returns early without dispatching
   * (`common/eda_draw_frame.cpp:673-675`).
   */
  preset: number | null;
}

/**
 * The zoom selector's rows and the row it shows, for a canvas at `zoom`.
 *
 * Two upstream behaviours this carries, both from
 * `EDA_DRAW_FRAME::updateZoomSelectBox` (`common/eda_draw_frame.cpp:490-534`):
 *
 *  - a zoom that is **on** a preset selects that preset, index `jj + 1`,
 *    "because index 0 is Zoom Auto";
 *  - a zoom that is **off** every preset gets a row of its own carrying the
 *    exact value, inserted at index 1 -- below "Zoom Auto" and above the
 *    presets -- and selected. That is why a freshly-fitted GerbView reads
 *    "Zoom 0.58" and not "Zoom Auto".
 *
 * The match at `:502` is `zoomList[jj] == zoom`, an exact double comparison and
 * not {@link isZoomPresetChecked}'s 10 % window, so anything the user reached by
 * dragging lands in the custom row.
 */
export function zoomChoices(
  zoom: number,
  list: readonly number[],
): { choices: ZoomChoice[]; selected: number } {
  const presets = list.map((z, i) => ({ label: zoomSelectorLabel(z), preset: i + 1 }));
  const auto = { label: ZOOM_AUTO_LABEL, preset: 0 };
  const onPreset = list.findIndex((z) => z === zoom);

  if (onPreset !== -1) return { choices: [auto, ...presets], selected: onPreset + 1 };

  return {
    choices: [auto, { label: zoomSelectorLabel(zoom), preset: null }, ...presets],
    selected: 1,
  };
}

/* ---------------------------------------------------------------------------
   Zoom LIMITS — a different table from the presets above, and the one that
   stops a canvas zooming for ever.
   --------------------------------------------------------------------------- */

/**
 * `include/zoom_defines.h:43-66`. Upstream's own comment says why these are not
 * the preset list:
 *
 *     // Zoom scale limits for zoom (especially mouse wheel)
 *     // the limits can differ from zoom list because the zoom list cannot be as
 *     // long as we want because the zoom list is displayed in menus.
 *     // But zoom by mouse wheel is limited mainly by the usability
 *
 * Each draw panel installs its own row exactly once, at construction:
 *
 *     pagelayout_editor/pl_draw_panel_gal.cpp:63   SetScaleLimits( 20, 0.05 )
 *     gerbview/gerbview_draw_panel_gal.cpp:55      SetScaleLimits( 5000, 0.02 )
 *     pcbnew/pcb_draw_panel_gal.cpp:420            SetScaleLimits( 50000, 0.1 )
 *     eeschema/sch_draw_panel.cpp:77               SetScaleLimits( 100, 0.01 )
 *
 * The symbol editor has no row of its own — it reuses eeschema's
 * (`symbol_editor_edit_tool.cpp:206`).
 *
 * The spread is enormous and deliberate: pcbnew goes to 50000x because a board
 * is inspected at track level, while the drawing sheet stops at 20x because
 * there is nothing on a sheet worth looking at closer than that.
 */
export const ZOOM_LIMITS: Record<ZoomApp, { min: number; max: number }> = {
  eeschema: { min: 0.01, max: 100 },
  symbol_editor: { min: 0.01, max: 100 },
  pl_editor: { min: 0.05, max: 20 },
  gerbview: { min: 0.02, max: 5000 },
  pcbnew: { min: 0.1, max: 50000 },
};

/**
 * `KIGFX::VIEW::SetScale`'s clamp (`common/view/view.cpp:583-588`):
 *
 *     if( aScale < m_minScale )      m_scale = m_minScale;
 *     else if( aScale > m_maxScale ) m_scale = m_maxScale;
 *     else                           m_scale = aScale;
 *
 * It lives inside `SetScale` rather than at each call site, which is why every
 * way of zooming in KiCad — the wheel, Zoom In/Out, a preset, the zoom-area
 * tool, Zoom to Fit — is limited by the same two numbers without any of them
 * knowing about it. A canvas that clamps in only one of its zoom paths has not
 * ported this.
 *
 * Note what `SetScale` does *around* the clamp: it takes the anchor's screen
 * position **before** changing the scale and re-centres on it after (`:581`,
 * `:593-595`), so a zoom that hits the limit stops dead rather than sliding the
 * view sideways.
 */
export function clampZoomFactor(zoom: number, app: ZoomApp): number {
  const { min, max } = ZOOM_LIMITS[app];
  if (!(zoom > 0)) return min;
  if (zoom < min) return min;
  if (zoom > max) return max;
  return zoom;
}

/**
 * The same clamp, expressed in a canvas' own scale rather than in zoom factor.
 *
 * KiCad's `m_scale` *is* the GAL zoom factor - `SetScale` ends with
 * `m_gal->SetZoomFactor( m_scale )` (`view.cpp:590`) - whereas ours is device
 * pixels per internal unit, which is the same quantity through
 * {@link ./status_format.js}'s `zoomFactorForScale`. Converting here rather
 * than at each canvas keeps the two numbers in `ZOOM_LIMITS` the only place
 * the limit is written.
 */
export function clampViewScale(
  scale: number,
  app: ZoomApp,
  dpr: number,
  iuPerMM: number,
): number {
  const zoom = zoomFactorForScale(scale, dpr, iuPerMM);
  const clamped = clampZoomFactor(zoom, app);
  return clamped === zoom ? scale : scaleForZoomFactor(clamped, dpr, iuPerMM);
}
