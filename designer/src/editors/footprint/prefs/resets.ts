// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RESETTABLE_PANEL::ResetPanel` for the Footprint Editor's Preferences pages.
 *
 * Kept out of the panel's `.tsx` so `qa` — whose tsconfig sets no `--jsx` — can
 * import and exercise it. See `editors/pcb/prefs/resets.ts`.
 */
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
