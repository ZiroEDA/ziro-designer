// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `RESETTABLE_PANEL::ResetPanel` for the PCB Editor's Preferences pages.
 *
 * Kept out of the panel's `.tsx` so `qa` — whose tsconfig sets no `--jsx` — can
 * import and exercise it. See `editors/schematic/prefs/resets.ts`.
 */
import { PCBNEW_DEFAULTS } from '../../../prefs/settings.js';
import { resetKeys } from '../../../dialogs/prefs/reset.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { resetToolbarsPanel } from '../../../dialogs/prefs/toolbar_reset.js';

/**
 * `PANEL_DISPLAY_OPTIONS::ResetPanel` (`pcbnew/dialogs/panel_display_options.cpp`)
 * default-constructs a `PCBNEW_SETTINGS` and calls `loadPCBSettings` on it,
 * which sets this panel's controls and no others.
 *
 * Only the Cross-probing group is ported here, so that is the whole slice.
 * Resetting the entire `PCBNEW_SETTINGS` -- as this used to -- also discarded
 * the active colour theme, every plot/print setting and the PNS router's
 * `tools.pns` block, none of which this page shows.
 */
export function resetPcbDisplayOptions(ctx: PrefsContext): void {
  ctx.upP((s) => {
    resetKeys(s, PCBNEW_DEFAULTS, ['cross_probing']);
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
