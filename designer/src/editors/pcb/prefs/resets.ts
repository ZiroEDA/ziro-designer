// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RESETTABLE_PANEL::ResetPanel` for the PCB Editor's Preferences pages.
 *
 * Kept out of the panel's `.tsx` so `qa` — whose tsconfig sets no `--jsx` — can
 * import and exercise it. See `editors/schematic/prefs/resets.ts`.
 */
import {
  PCBNEW_DEFAULTS,
  PCB_DISPLAY_DEFAULTS,
  PCB_EDITING_DEFAULTS,
  VIEWER3D_CAMERA_DEFAULTS,
  VIEWER3D_RENDER_DEFAULTS,
} from '../../../prefs/settings.js';
import { resetKeys } from '../../../dialogs/prefs/reset.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { resetToolbarsPanel } from '../../../dialogs/prefs/toolbar_reset.js';

/**
 * `PANEL_DISPLAY_OPTIONS::ResetPanel` (`pcbnew/dialogs/panel_display_options.cpp`)
 * default-constructs a `PCBNEW_SETTINGS` and calls `loadPCBSettings` on it,
 * which sets this panel's controls and no others.
 *
 * `loadPCBSettings` (`:56-70`) sets `pcb_display`'s seven and `cross_probing`'s
 * five, and `m_galOptsPanel->ResetPanel( &cfg )` (`:126`) then resets the GAL
 * half — which is `window.cursor` whole, and the FOUR appearance keys of
 * `window.grid` and not its list: `PANEL_GAL_OPTIONS::ResetPanel` writes only
 * what `TransferDataFromWindow` writes (`common/dialogs/panel_gal_options.cpp`),
 * so the user's grid sizes and their last selection survive a reset of this
 * page. Resetting the entire `PCBNEW_SETTINGS` -- as this used to -- also
 * discarded the active colour theme, every plot/print setting and the PNS
 * router's `tools.pns` block, none of which this page shows.
 */
export function resetPcbDisplayOptions(ctx: PrefsContext): void {
  ctx.upP((s) => {
    resetKeys(s, PCBNEW_DEFAULTS, ['cross_probing']);
    // `pcb_display` is ONE JSON block and THREE pages edit it, so this names
    // keys: `loadPCBSettings` (`panel_display_options.cpp:56-70`) sets exactly
    // these seven and leaves the origin trio and the ratsnest four — which
    // belong to Origins & Axes and to Editing Options — alone.
    resetKeys(s.pcb_display, PCB_DISPLAY_DEFAULTS, [
      'net_names_mode',
      'pad_numbers',
      'track_clearance_mode',
      'pad_clearance',
      'pad_use_via_color_for_normal_th_padstacks',
      'force_show_fields_when_fp_selected',
      'live_3d_refresh',
    ]);
    resetKeys(s.window, PCBNEW_DEFAULTS.window, ['cursor']);
    resetKeys(s.window.grid, PCBNEW_DEFAULTS.window.grid, [
      'style',
      'line_width',
      'min_spacing',
      'snap',
    ]);
  });
}

/**
 * `PANEL_PCBNEW_DISPLAY_ORIGIN::ResetPanel` — `loadSettings` over a
 * default-constructed `PCBNEW_SETTINGS`, which in the `FRAME_PCB_EDITOR` branch
 * (`panel_pcbnew_display_origin.cpp:57-77`) sets the display origin and the two
 * axis flags and nothing else.
 */
export function resetPcbOriginsAxes(ctx: PrefsContext): void {
  ctx.upP((s) => {
    resetKeys(s.pcb_display, PCB_DISPLAY_DEFAULTS, [
      'origin_mode',
      'origin_invert_x_axis',
      'origin_invert_y_axis',
    ]);
  });
}

/**
 * `PANEL_EDIT_OPTIONS::ResetPanel` — `loadPCBSettings`
 * (`panel_edit_options.cpp:102-147`), which is the whole `editing` slice this
 * page draws plus the four `pcb_display.*` keys that sit beside it.
 *
 * `editing.polar_coords` is NOT here: it is `ACTIONS::togglePolarCoords`, a
 * toolbar button, and `loadPCBSettings` never touches it.
 */
export function resetPcbEditingOptions(ctx: PrefsContext): void {
  ctx.upP((s) => {
    resetKeys(s.editing, PCB_EDITING_DEFAULTS, [
      'pcb_angle_snap_mode',
      'rotation_angle',
      'arc_edit_mode',
      'track_drag_action',
      'flip_left_right',
      'allow_free_pads',
      'auto_fill_zones',
      'magnetic_pads',
      'magnetic_tracks',
      'magnetic_graphics',
      'esc_clears_net_highlight',
      'show_courtyard_collisions',
      'ctrl_click_highlight',
    ]);
    resetKeys(s.pcb_display, PCB_DISPLAY_DEFAULTS, [
      'ratsnest_footprint',
      'ratsnest_curved',
      'ratsnest_thickness',
      'show_page_borders',
    ]);
  });
}

/**
 * `PANEL_COLOR_SETTINGS::ResetPanel` (`common/dialogs/panel_color_settings.cpp:
 * 72-90`): it returns early on a read-only theme, and otherwise sets every one
 * of `m_validLayers` back to `m_currentSettings`' default.
 *
 * The same body as `resetFpColors`, and for the same reason: both pages write
 * the `board` namespace of one file, so "reset this page" is "drop the `board.`
 * overrides". Dropping them is what restores the default, because
 * `pcbThemeWithOverrides` falls back to `BUILTIN_DEFAULT_THEME` for a key with
 * no override.
 */
export function resetPcbColors(ctx: PrefsContext): void {
  if (ctx.pcbnew.appearance.color_theme !== 'user') return;
  ctx.setUserColors((c) => {
    const out = { ...c };
    for (const key of Object.keys(out)) {
      if (key.startsWith('board.')) delete out[key];
    }
    return out;
  });
}

/**
 * `PANEL_TOOLBAR_CUSTOMIZATION::ResetPanel`
 * (`common/dialogs/panel_toolbar_customization.cpp:243-267`) over this app's
 * toolbars, through the shared implementation. It does not touch
 * `appearance.custom_toolbars`: upstream's ResetPanel refills `m_toolbars` and
 * leaves `m_CustomToolbars` exactly as the user left it.
 */
export function resetPcbToolbars(ctx: PrefsContext): void {
  ctx.upTb('pcbnew', (s) => {
    resetToolbarsPanel(s);
  });
}

/** The same panel, over the 3D Viewer's own `3d_viewer-toolbars` file. */
export function resetViewer3dToolbars(ctx: PrefsContext): void {
  ctx.upTb('3d_viewer', (s) => {
    resetToolbarsPanel(s);
  });
}

/**
 * `PANEL_GRID_SETTINGS::ResetPanel`
 * (`common/dialogs/panel_grid_settings.cpp:110-113`) — the same two lines for
 * every frame that constructs the panel, so this is the schematic and drawing
 * sheet pages' slice over pcbnew's settings object.
 */
export function resetPcbGrids(ctx: PrefsContext): void {
  ctx.upP((s) => {
    resetKeys(s.window.grid, PCBNEW_DEFAULTS.window.grid, [
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
 * `PANEL_3D_DISPLAY_OPTIONS::ResetPanel` — `loadViewSettings` over a
 * default-constructed `EDA_3D_VIEWER_SETTINGS` (`panel_3D_display_options.cpp:
 * 93-99`), which is the five Render Options and the three Camera Options and
 * nothing else. The Realtime Renderer's keys live in the same `render` block
 * and are that page's, which is why this names keys.
 */
export function resetViewer3dGeneral(ctx: PrefsContext): void {
  ctx.up3d((s) => {
    resetKeys(s.render, VIEWER3D_RENDER_DEFAULTS, [
      'clip_silk_on_via_annulus',
      'subtract_mask_from_silk',
      'show_zones',
      'plated_and_bare_copper',
      'material_mode',
    ]);
    resetKeys(s.camera, VIEWER3D_CAMERA_DEFAULTS, [
      'animation_enabled',
      'moving_speed_multiplier',
      'rotation_increment',
    ]);
  });
}

/**
 * `PANEL_3D_OPENGL_OPTIONS::ResetPanel` (`panel_3D_opengl_options.cpp:86-92`),
 * the nine `opengl_*` keys its `loadSettings` sets.
 */
export function resetViewer3dOpengl(ctx: PrefsContext): void {
  ctx.up3d((s) => {
    resetKeys(s.render, VIEWER3D_RENDER_DEFAULTS, [
      'opengl_show_model_bbox',
      'opengl_copper_thickness',
      'opengl_highlight_on_rollover',
      'opengl_AA_mode',
      'opengl_selection_color',
      'opengl_AA_disableOnMove',
      'opengl_thickness_disableOnMove',
      'opengl_vias_disableOnMove',
      'opengl_holes_disableOnMove',
    ]);
  });
}
