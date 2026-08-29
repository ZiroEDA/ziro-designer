// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RESETTABLE_PANEL::ResetPanel` for the Drawing Sheet Editor's Preferences
 * pages.
 *
 * Split from the `.tsx` panels for the same reason the schematic's are
 * (`editors/schematic/prefs/resets.ts`): `qa`'s tsconfig sets no `--jsx`, and
 * "resetting one page leaves the others alone" is exactly what has to be
 * tested.
 */
import { PL_EDITOR_DEFAULTS } from '../../../prefs/settings.js';
import { resetKeys } from '../../../dialogs/prefs/reset.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { resetToolbarsPanel } from '../../../dialogs/prefs/toolbar_reset.js';

/**
 * `PANEL_PL_EDITOR_DISPLAY_OPTIONS::ResetPanel`
 * (`pagelayout_editor/dialogs/panel_pl_editor_display_options.cpp:66-72`):
 *
 *     PL_EDITOR_SETTINGS cfg;
 *     cfg.Load();                       // defaults, no file
 *     m_galOptsPanel->ResetPanel( &cfg );
 *
 * — the embedded `PANEL_GAL_OPTIONS` and nothing else, so the slice is exactly
 * what that panel's `TransferDataToWindow` reads: the four grid appearance keys
 * and the two cursor ones. The grid *list*, its two fast-switch indices and the
 * overrides belong to the Grids page, and the colour theme to Colors.
 */
export function resetPlEditorDisplayOptions(ctx: PrefsContext): void {
  ctx.upPl((s) => {
    resetKeys(s.window.grid, PL_EDITOR_DEFAULTS.window.grid, [
      'style',
      'line_width',
      'min_spacing',
      'snap',
    ]);
    resetKeys(s.window.cursor, PL_EDITOR_DEFAULTS.window.cursor, [
      'crosshair',
      'always_show_cursor',
    ]);
  });
}

/**
 * `PANEL_GRID_SETTINGS::ResetPanel` (`common/dialogs/panel_grid_settings.cpp:
 * 110-113`) — the same two lines for every frame that constructs the panel, so
 * the slice is the same as the schematic's Grids page over this editor's
 * settings object.
 */
export function resetPlEditorGrids(ctx: PrefsContext): void {
  ctx.upPl((s) => {
    resetKeys(s.window.grid, PL_EDITOR_DEFAULTS.window.grid, [
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
 * `PANEL_PL_EDITOR_COLOR_SETTINGS::ResetPanel`
 * (`pagelayout_editor/dialogs/panel_pl_editor_color_settings.cpp:82-85`) is one
 * line — `m_themes->SetStringSelection( _( "KiCad Default" ) )` — and it moves
 * the choice, nothing else. There are no swatches on this page to put back, so
 * unlike eeschema's Colors reset this one does **not** clear `userColors`.
 */
export function resetPlEditorColorSettings(ctx: PrefsContext): void {
  ctx.upPl((s) => {
    resetKeys(s.appearance, PL_EDITOR_DEFAULTS.appearance, ['color_theme']);
  });
}

/**
 * `PANEL_TOOLBAR_CUSTOMIZATION::ResetPanel`
 * (`common/dialogs/panel_toolbar_customization.cpp:243-267`) over this app's
 * toolbars, through the shared implementation. It does not touch
 * `appearance.custom_toolbars`: upstream's ResetPanel refills `m_toolbars` and
 * leaves `m_CustomToolbars` exactly as the user left it.
 */
export function resetPlEditorToolbars(ctx: PrefsContext): void {
  ctx.upTb('pl_editor', (s) => {
    resetToolbarsPanel(s);
  });
}
