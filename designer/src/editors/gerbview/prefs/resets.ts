// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RESETTABLE_PANEL::ResetPanel` for the Gerber Viewer's Preferences pages.
 *
 * Split from the `.tsx` panels for the same reason the schematic's and the
 * Drawing Sheet Editor's are: `qa`'s tsconfig sets no `--jsx`, and "resetting
 * one page leaves the others alone" is exactly what has to be tested.
 */
import { GERBVIEW_DEFAULTS } from '../../../prefs/settings.js';
import { resetKeys } from '../../../dialogs/prefs/reset.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { resetToolbarsPanel } from '../../../dialogs/prefs/toolbar_reset.js';

/**
 * `PANEL_GERBVIEW_DISPLAY_OPTIONS::ResetPanel`
 * (`gerbview/dialogs/panel_gerbview_display_options.cpp:110-118`):
 *
 *     GERBVIEW_SETTINGS cfg;
 *     cfg.Load();                       // defaults, no file
 *     loadSettings( &cfg );
 *     m_galOptsPanel->ResetPanel( &cfg );
 *
 * Two calls, so two slices, and both are exactly what those two functions
 * read back:
 *
 *  - `loadSettings` (`:39-66`) touches the three fill flags, `show_dcodes`,
 *    `m_OpacityModeAlphaValue`, the seven page-size radios and
 *    `m_DisplayPageLimits` — this page's own controls, and nothing else on
 *    `m_Appearance` (`show_border_and_titleblock` and `show_negative_objects`
 *    are the layers manager's, not this page's, and stay put);
 *  - `PANEL_GAL_OPTIONS::ResetPanel` is the four grid appearance keys and the
 *    two cursor ones, the same slice every other Display Options page resets.
 *
 * The grid LIST, its two fast-switch indices and `overrides_enabled` belong to
 * the Grids page, and `color_theme` to Colors.
 */
export function resetGerbviewDisplayOptions(ctx: PrefsContext): void {
  ctx.upGbr((s) => {
    resetKeys(s.appearance, GERBVIEW_DEFAULTS.appearance, [
      'show_dcodes',
      'show_page_limit',
      'mode_opacity_value',
      'page_type',
    ]);
    resetKeys(s.display, GERBVIEW_DEFAULTS.display, [
      'flashed_items_fill',
      'lines_fill',
      'polygons_fill',
    ]);
    resetKeys(s.window.grid, GERBVIEW_DEFAULTS.window.grid, [
      'style',
      'line_width',
      'min_spacing',
      'snap',
    ]);
    resetKeys(s.window.cursor, GERBVIEW_DEFAULTS.window.cursor, [
      'crosshair',
      'always_show_cursor',
    ]);
  });
}

/**
 * `PANEL_GRID_SETTINGS::ResetPanel` (`common/dialogs/panel_grid_settings.cpp:
 * 110-113`) — the same two lines for every frame that constructs the panel, so
 * the slice is the same as the schematic's and the Drawing Sheet Editor's over
 * this editor's settings object.
 *
 * `overrides` is in the list even though gerbview draws no override row:
 * `TransferDataFromWindow` assigns the whole `m_grids` block back regardless,
 * and a key left out here is a field that silently never resets. It is empty
 * for this app, so resetting it is a no-op — which is the correct no-op, not an
 * omission.
 */
export function resetGerbviewGrids(ctx: PrefsContext): void {
  ctx.upGbr((s) => {
    resetKeys(s.window.grid, GERBVIEW_DEFAULTS.window.grid, [
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
 * `PANEL_COLOR_SETTINGS::ResetPanel` (`common/dialogs/panel_color_settings.cpp:
 * 72-87`):
 *
 *     if( !m_currentSettings || m_currentSettings->IsReadOnly() )
 *         return;
 *     for( … m_swatches )
 *         m_currentSettings->SetColor( layer, GetDefaultColor( layer ) );
 *
 * — every SWATCH back to its default, and nothing else. Two consequences that
 * are easy to get wrong:
 *
 *  - the THEME choice does not move. `m_cbTheme` is not a swatch, so a reset
 *    leaves the user on whatever theme they picked and puts that theme's
 *    colours back. eeschema's page resets `userColors` for the same reason;
 *    pl_editor's, which has no swatches at all, resets only the choice.
 *  - a read-only theme resets NOTHING. Our swatches are already unanswerable
 *    off the "User" theme, and the overrides being cleared are that theme's.
 *
 * Only this app's namespace is cleared. `colors/user.json` holds every app's
 * colours (upstream under `m_colorNamespace`, here in the key), and resetting
 * the Gerber Viewer's Colors page must not take the schematic's wires with it.
 */
export function resetGerbviewColorSettings(ctx: PrefsContext): void {
  ctx.setUserColors((c) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(c)) if (!k.startsWith('gerbview.')) out[k] = v;
    return out;
  });
}

/**
 * `PANEL_GERBVIEW_EXCELLON_SETTINGS::ResetPanel`
 * (`gerbview/dialogs/panel_gerbview_excellon_settings.cpp:72-76`):
 *
 *     EXCELLON_DEFAULTS defaults;
 *     applySettingsToPanel( defaults );
 *
 * — a DEFAULT-CONSTRUCTED `EXCELLON_DEFAULTS`, which runs `ResetToDefaults()`
 * in its constructor (`gerbview/excellon_defaults.h:49`). So the six values go
 * back to that struct's own, not to whatever is in `gerbview.json`, and they
 * are the whole slice: this page owns nothing else on the settings object.
 */
export function resetGerbviewExcellonSettings(ctx: PrefsContext): void {
  ctx.upGbr((s) => {
    resetKeys(s.excellon_defaults, GERBVIEW_DEFAULTS.excellon_defaults, [
      'unit_mm',
      'lz_format',
      'mm_integer_len',
      'mm_mantissa_len',
      'inch_integer_len',
      'inch_mantissa_len',
    ]);
  });
}

/**
 * `PANEL_TOOLBAR_CUSTOMIZATION::ResetPanel`
 * (`common/dialogs/panel_toolbar_customization.cpp:243-267`) over this app's
 * toolbars, through the shared implementation. It does not touch
 * `appearance.custom_toolbars`: upstream's ResetPanel refills `m_toolbars` and
 * leaves `m_CustomToolbars` exactly as the user left it.
 */
export function resetGerbviewToolbars(ctx: PrefsContext): void {
  ctx.upTb('gerbview', (s) => {
    resetToolbarsPanel(s);
  });
}
