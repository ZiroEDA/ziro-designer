// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/dialogs/panel_pl_editor_display_options.cpp`:
 * `PANEL_PL_EDITOR_DISPLAY_OPTIONS`' engine half - its `ResetPanel`. The
 * panel is `panel_pl_editor_display_options_ui.tsx`.
 */
import { resetKeys } from '@ziroeda/common/settings/json_settings.js';
import type { PL_PREFS_CONTEXT } from '../pl_editor.js';
import { PL_EDITOR_DEFAULTS } from '../pl_editor_settings.js';

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
export function resetPlEditorDisplayOptions(ctx: PL_PREFS_CONTEXT): void {
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
