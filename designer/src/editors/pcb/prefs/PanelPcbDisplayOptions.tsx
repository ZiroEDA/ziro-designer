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
 * Moved verbatim out of `prefs/PreferencesDialog.tsx`'s `switch (page)`;
 * no behaviour change.
 */
import type { JSX } from 'react';
import { CrossProbingGroup } from '../../../dialogs/prefs/CrossProbingGroup.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';
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

/** `RESETTABLE_PANEL::ResetPanel`: the pcbnew settings back to PCBNEW_SETTINGS' defaults. */
export function resetPcbDisplayOptions(ctx: PrefsContext): void {
  ctx.setPcbnew(structuredClone(PCBNEW_DEFAULTS));
}
