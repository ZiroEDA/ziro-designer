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
