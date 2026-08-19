// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > PCB Editor > Display Options — `PANEL_DISPLAY_OPTIONS`
 * (`pcbnew/dialogs/panel_display_options_base.cpp`), which upstream is one
 * class the PCB and Footprint editors both take with an `isFootprintEditor`
 * flag; pcbnew constructs it for `PANEL_PCB_DISPLAY_OPTS`
 * (`pcbnew/pcbnew.cpp:401-450`).
 *
 * Only its Cross-probing group is ported: the panel's other sections
 * (Annotations, Clearance Outlines, the 3D-view and ratsnest options) have
 * no store behind them here yet.
 *
 * Which copy of CROSS_PROBING_SETTINGS this edits is pcbnew's, because
 * upstream the frame that *receives* a probe owns the settings deciding what
 * it does. See PR 543.
 *
 * Moved verbatim out of the Preferences dialog's `switch (page)` (as it stood
 * at 5d6a2f40, in prefs/PreferencesDialog.tsx); no behaviour change.
 */
import type { JSX } from 'react';
import { CrossProbingGroup } from '../../../dialogs/prefs/CrossProbingGroup.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
import { resetKeys } from '../../../dialogs/prefs/reset.js';
import { PCBNEW_DEFAULTS } from '../../../prefs/settings.js';

export function PanelPcbDisplayOptions({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { pcbnew, upP } = ctx;
  return (
    <CrossProbingGroup
      peer="schematic"
      value={pcbnew.cross_probing}
      onChange={(fn) => upP((s) => fn(s.cross_probing))}
    />
  );
}

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
