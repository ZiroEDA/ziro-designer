// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/dialogs/panel_pl_editor_color_settings.cpp`:
 * `PANEL_PL_EDITOR_COLOR_SETTINGS`' engine half - its `ResetPanel`. The
 * panel is `panel_pl_editor_color_settings_ui.tsx`.
 */
import { resetKeys } from '@ziroeda/common/settings/json_settings.js';
import type { PL_PREFS_CONTEXT } from '../pl_editor.js';
import { PL_EDITOR_DEFAULTS } from '../pl_editor_settings.js';

/**
 * `PANEL_PL_EDITOR_COLOR_SETTINGS::ResetPanel`
 * (`pagelayout_editor/dialogs/panel_pl_editor_color_settings.cpp:82-85`) is one
 * line — `m_themes->SetStringSelection( _( "KiCad Default" ) )` — and it moves
 * the choice, nothing else. There are no swatches on this page to put back, so
 * unlike eeschema's Colors reset this one does **not** clear `userColors`.
 */
export function resetPlEditorColorSettings(ctx: PL_PREFS_CONTEXT): void {
  ctx.upPl((s) => {
    resetKeys(s.appearance, PL_EDITOR_DEFAULTS.appearance, ['color_theme']);
  });
}
