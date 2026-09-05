// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RESETTABLE_PANEL::ResetPanel` for the Footprint Editor's Preferences pages.
 *
 * Kept out of the panel's `.tsx` so `qa` — whose tsconfig sets no `--jsx` — can
 * import and exercise it. See `editors/pcb/prefs/resets.ts`.
 */
import { FPEDIT_DEFAULTS } from '../../../prefs/settings.js';
import { resetKeys } from '../../../dialogs/prefs/reset.js';
import { resetToolbarsPanel } from '../../../dialogs/prefs/toolbar_reset.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

/**
 * `PANEL_TOOLBAR_CUSTOMIZATION::ResetPanel`
 * (`common/dialogs/panel_toolbar_customization.cpp:243-267`) over this app's
 * toolbars, through the shared implementation. It does not touch
 * `appearance.custom_toolbars`: upstream's ResetPanel refills `m_toolbars` and
 * leaves `m_CustomToolbars` exactly as the user left it.
 */
export function resetFpToolbars(ctx: PrefsContext): void {
  ctx.upTb('fpedit', (s) => {
    resetToolbarsPanel(s);
  });
}

/**
 * `PANEL_DISPLAY_OPTIONS::ResetPanel` (`pcbnew/dialogs/panel_display_options.cpp:
 * 114-129`) in its footprint-editor branch, which is one line:
 *
 *     m_galOptsPanel->ResetPanel( nullptr );
 *
 * `loadPCBSettings` is not called and no `FOOTPRINT_EDITOR_SETTINGS` is
 * constructed, because everything else on the page belongs to the PCB branch —
 * see the note in `PanelFpDisplayOptions.tsx`. So the slice is
 * `PANEL_GAL_OPTIONS`' own: the four grid-appearance keys and the two cursor
 * ones, and NOT the grid list beside them, which is the Grids page's.
 */
export function resetFpDisplayOptions(ctx: PrefsContext): void {
  ctx.upFp((s) => {
    resetKeys(s.window.grid, FPEDIT_DEFAULTS.window.grid, [
      'style',
      'line_width',
      'min_spacing',
      'snap',
    ]);
    resetKeys(s.window.cursor, FPEDIT_DEFAULTS.window.cursor, ['crosshair', 'always_show_cursor']);
  });
}

/**
 * `PANEL_GRID_SETTINGS::ResetPanel`
 * (`common/dialogs/panel_grid_settings.cpp:110-113`) — the same two lines for
 * every frame that constructs the panel, over this app's settings object.
 */
export function resetFpGrids(ctx: PrefsContext): void {
  ctx.upFp((s) => {
    resetKeys(s.window.grid, FPEDIT_DEFAULTS.window.grid, [
      'sizes',
      'last_size_idx',
      'fast_grid_1',
      'fast_grid_2',
      'overrides_enabled',
      'overrides',
    ]);
  });
}

/**
 * `PANEL_PCBNEW_DISPLAY_ORIGIN::ResetPanel`
 * (`pcbnew/dialogs/panel_pcbnew_display_origin.cpp:118-133`) in its
 * footprint-editor branch: default-construct a `FOOTPRINT_EDITOR_SETTINGS` and
 * re-run `loadSettings` on it, which touches the two axis radio groups and
 * nothing else. The Display Origin group is not on this page in this frame, so
 * it is not in the slice either.
 */
export function resetFpOriginsAxes(ctx: PrefsContext): void {
  ctx.upFp((s) => {
    resetKeys(s, FPEDIT_DEFAULTS, ['origin_invert_x_axis', 'origin_invert_y_axis']);
  });
}
