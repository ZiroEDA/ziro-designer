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
import { resetSessionArcEditMode } from '../arc_edit_mode.js';
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

/**
 * `PANEL_EDIT_OPTIONS::ResetPanel`
 * (`pcbnew/dialogs/panel_edit_options.cpp:228-241`) in its footprint branch:
 * default-construct a `FOOTPRINT_EDITOR_SETTINGS` and re-run `loadFPSettings`,
 * which touches the five controls this page owns and no others.
 *
 * `m_ArcEditMode` is one of the five even though it never reaches the file —
 * `loadFPSettings` sets `m_arcEditMode->SetSelection(…)` unconditionally
 * (`:150`) — so the session value goes back to its default too.
 */
export function resetFpEditingOptions(ctx: PrefsContext): void {
  ctx.upFp((s) => {
    resetKeys(s.editing, FPEDIT_DEFAULTS.editing, [
      'rotation_angle',
      'magnetic_pads',
      'magnetic_graphics',
      'fp_angle_snap_mode',
    ]);
  });
  resetSessionArcEditMode();
}

/**
 * `PANEL_COLOR_SETTINGS::ResetPanel`
 * (`common/dialogs/panel_color_settings.cpp:70-95`), which reloads the
 * theme's own colours and returns EARLY on a read-only theme — so on a
 * built-in there is nothing to reset, and on "User" it is the overrides that
 * go.
 *
 * The theme choice itself is not in the slice: upstream's ResetPanel calls
 * `m_currentSettings->GetColor` over the CURRENT theme rather than selecting a
 * different one.
 */
export function resetFpColors(ctx: PrefsContext): void {
  if (ctx.fpEdit.appearance.color_theme !== 'user') return;
  ctx.setUserColors((c) => {
    const out = { ...c };
    for (const key of Object.keys(out)) {
      if (key.startsWith('board.')) delete out[key];
    }
    return out;
  });
}

/**
 * `PANEL_FP_EDITOR_FIELD_DEFAULTS::ResetPanel`
 * (`panel_fp_editor_field_defaults.cpp:334-341`): default-construct the
 * settings and reload, which refills both grids from
 * `m_DefaultFPTextItems` — one key, two grids.
 */
export function resetFpFootprintDefaults(ctx: PrefsContext): void {
  ctx.upFp((s) => {
    resetKeys(s.design_settings, FPEDIT_DEFAULTS.design_settings, ['default_footprint_text_items']);
  });
}

/**
 * `PANEL_FP_EDITOR_GRAPHICS_DEFAULTS::ResetPanel` (`:290-296`), whose
 * `loadFPSettings` fills the six layer-class rows AND calls
 * `m_dimensionsPanel->LoadFromSettings` (`:148`) — so the embedded
 * `PANEL_SETUP_DIMENSIONS` is reset with the grid, not separately.
 */
export function resetFpGraphicsDefaults(ctx: PrefsContext): void {
  ctx.upFp((s) => {
    resetKeys(s.design_settings, FPEDIT_DEFAULTS.design_settings, [
      'silk',
      'copper',
      'edges',
      'courtyard',
      'fab',
      'others',
      'dimensions',
    ]);
  });
}

/**
 * `PANEL_FP_USER_LAYER_NAMES::ResetPanel` (`panel_fp_user_layer_names.cpp:
 * 336-343`): the layer count and the name table, which are the page's two
 * controls.
 */
export function resetFpUserLayerNames(ctx: PrefsContext): void {
  ctx.upFp((s) => {
    resetKeys(s.design_settings, FPEDIT_DEFAULTS.design_settings, [
      'user_layer_count',
      'default_footprint_layer_names',
    ]);
  });
}
