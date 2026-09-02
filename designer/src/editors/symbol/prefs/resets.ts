// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RESETTABLE_PANEL::ResetPanel` for the Symbol Editor's Preferences pages.
 *
 * Split from the `.tsx` panels for the same reason every other `resets.ts` here
 * is: `qa`'s tsconfig sets no `--jsx`, and "resetting one page leaves the others
 * alone" is exactly what has to be tested.
 *
 * Each of these names the slice its page's `TransferDataToWindow` reads, and no
 * more. Upstream that bound falls out of the widget tree — `ResetPanel`
 * default-constructs a `SYMBOL_EDITOR_SETTINGS` and pushes it at this panel's
 * own controls, so `TransferDataFromWindow` writes back only those. We have no
 * widget tree, so the slice is stated; see `dialogs/prefs/reset.ts`.
 */
import { SYMBOL_EDITOR_DEFAULTS } from '../../../prefs/settings.js';
import { resetKeys } from '../../../dialogs/prefs/reset.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { resetToolbarsPanel } from '../../../dialogs/prefs/toolbar_reset.js';

/**
 * `PANEL_GRID_SETTINGS::ResetPanel`
 * (`common/dialogs/panel_grid_settings.cpp:110-113`):
 *
 *     APP_SETTINGS_BASE cfg;
 *     m_grids = cfg.m_Window.grid.grids;
 *
 * — the same two lines for every frame that constructs the panel, so the slice
 * is the schematic's and the drawing sheet's over this editor's settings
 * object. The appearance keys (`style`, `line_width`, `min_spacing`, `snap`)
 * and the cursor belong to Display Options and are pointedly absent.
 */
export function resetSymbolEditorGrids(ctx: PrefsContext): void {
  ctx.upSym((s) => {
    resetKeys(s.window.grid, SYMBOL_EDITOR_DEFAULTS.window.grid, [
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
 * `PANEL_SYM_DISPLAY_OPTIONS::ResetPanel`
 * (`eeschema/dialogs/panel_sym_display_options.cpp:76-85`):
 *
 *     SYMBOL_EDITOR_SETTINGS cfg;
 *     cfg.Load();                    // defaults, no file
 *     loadSymEditorSettings( &cfg );
 *     m_galOptsPanel->ResetPanel( &cfg );
 *
 * — the four Appearance checkboxes `loadSymEditorSettings` writes (`:41-47`),
 * plus the embedded `PANEL_GAL_OPTIONS`' six.
 */
export function resetSymbolEditorDisplayOptions(ctx: PrefsContext): void {
  ctx.upSym((s) => {
    resetKeys(s, SYMBOL_EDITOR_DEFAULTS, [
      'show_hidden_lib_pins',
      'show_hidden_lib_fields',
      'show_pin_electrical_type',
      'show_pin_alt_icons',
    ]);
    resetKeys(s.window.grid, SYMBOL_EDITOR_DEFAULTS.window.grid, [
      'style',
      'line_width',
      'min_spacing',
      'snap',
    ]);
    resetKeys(s.window.cursor, SYMBOL_EDITOR_DEFAULTS.window.cursor, [
      'crosshair',
      'always_show_cursor',
    ]);
  });
}

/**
 * `PANEL_SYM_EDITING_OPTIONS::ResetPanel`
 * (`eeschema/dialogs/panel_sym_editing_options.cpp:108-114`) — the eight values
 * `loadSymEditorSettings` pushes at the controls (`:53-63`): the five
 * `defaults.*`, the two `repeat.*`, and `drag_pins_along_with_edges`.
 */
export function resetSymbolEditorEditingOptions(ctx: PrefsContext): void {
  ctx.upSym((s) => {
    resetKeys(s, SYMBOL_EDITOR_DEFAULTS, ['defaults', 'repeat', 'drag_pins_along_with_edges']);
  });
}

/**
 * The Colors page has **no** reset.
 *
 * `PANEL_SYM_COLOR_SETTINGS` derives from `PANEL_SYM_COLOR_SETTINGS_BASE`,
 * which is a plain `wxPanel` (`panel_sym_color_settings_base.h`), not a
 * `RESETTABLE_PANEL` — unlike every other page under this heading. So
 * `PAGED_DIALOG::UpdateResetButton` (`common/widgets/paged_dialog.cpp:329-355`)
 * greys the button out on it, and the way to say that here is to export no
 * reset and register none. This comment stands in for the function that must
 * not exist.
 */

/**
 * `PANEL_TOOLBAR_CUSTOMIZATION::ResetPanel`
 * (`common/dialogs/panel_toolbar_customization.cpp:243-267`) over this app's
 * toolbars, through the shared implementation. It does not touch
 * `appearance.custom_toolbars`: upstream's ResetPanel refills `m_toolbars` and
 * leaves `m_CustomToolbars` exactly as the user left it.
 */
export function resetSymbolEditorToolbars(ctx: PrefsContext): void {
  ctx.upTb('symbol_editor', (s) => {
    resetToolbarsPanel(s);
  });
}
