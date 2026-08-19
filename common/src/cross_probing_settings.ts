// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CROSS_PROBING_SETTINGS` (include/settings/app_settings.h:32-39).
 *
 * Upstream hangs one of these off `APP_SETTINGS_BASE` (app_settings.h:226), so
 * every frame that can *receive* a cross-probe carries its own copy: eeschema's
 * governs what happens in the schematic when the board probes it, pcbnew's what
 * happens on the board when the schematic probes it. The struct itself is
 * declared once in `common/`, which is why it lives here and not in either
 * editor.
 *
 * The keys and defaults are `APP_SETTINGS_BASE::APP_SETTINGS_BASE`
 * (common/settings/app_settings.cpp:290-303): four default true, `flash_selection`
 * false.
 */

export interface CrossProbingSettings {
  /** Synchronize the selection for multiple items too. */
  on_selection: boolean;
  /** Automatically pan to cross-probed items. */
  center_on_items: boolean;
  /** Zoom to fit items (ignored if `center_on_items` is off). */
  zoom_to_fit: boolean;
  /** Automatically turn on highlight mode in the target frame. */
  auto_highlight: boolean;
  /** Flash newly cross-probed selection (visual attention aid). */
  flash_selection: boolean;
}

export const CROSS_PROBING_DEFAULTS: CrossProbingSettings = {
  on_selection: true,
  center_on_items: true,
  zoom_to_fit: true,
  auto_highlight: true,
  flash_selection: false,
};
