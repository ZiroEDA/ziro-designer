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
