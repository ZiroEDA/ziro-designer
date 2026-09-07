// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Footprint Editor > Origins & Axes —
 * `PANEL_PCBNEW_DISPLAY_ORIGIN` (`pcbnew/dialogs/panel_pcbnew_display_origin.cpp`
 * and its `_base.cpp`), which upstream is ONE class both pcbnew frames build,
 * told apart by the `FRAME_T` it is handed:
 *
 *     return new PANEL_PCBNEW_DISPLAY_ORIGIN( aParent,
 *             GetAppSettings<FOOTPRINT_EDITOR_SETTINGS>( "fpedit" ),
 *             FRAME_FOOTPRINT_EDITOR );
 *     (`pcbnew/pcbnew.cpp:326-328`)
 *
 * **The Display Origin group is not on this page in the footprint editor.**
 * The constructor's only statement is
 *
 *     m_displayOrigin->Show( m_frameType == FRAME_PCB_EDITOR );
 *     (`panel_pcbnew_display_origin.cpp:37`)
 *
 * and `m_displayOrigin` is the sizer holding the heading, its rule and all
 * three radio buttons (`_base.cpp:22-46`). Page origin / Drill-place file
 * origin / Grid origin choose where pcbnew's *coordinate readout* is measured
 * from, and a footprint has no page and no drill-place origin, so the group is
 * gone and this page is X Axis and Y Axis alone.
 *
 * The controls themselves are `dialogs/prefs/PanelDisplayOrigin.tsx`, written
 * once, because the PCB Editor's page is the same panel with that group shown.
 *
 * **What reads them.** `editors/footprint/coordinates.ts`, which is
 * `EDA_DRAW_FRAME::DisplayUnitsMsg`'s companion — `PCB_BASE_FRAME::
 * UpdateStatusBar` builds the X and Y panes through
 * `GetDisplayInvert{X,Y}Axis` and negates the value it prints
 * (`pcbnew/pcb_base_frame.cpp`, and `FOOTPRINT_EDIT_FRAME::GetDisplayInvertXAxis`
 * returns `GetFootprintEditorSettings()->m_DisplayInvertXAxis`). The canvas is
 * not mirrored and the geometry is untouched: this changes the *readout* and
 * the relative-coordinate arithmetic beside it, nothing on the board.
 */
import type { JSX } from 'react';
import { PanelDisplayOrigin } from '../../../dialogs/prefs/PanelDisplayOrigin.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export function PanelFpOriginsAxes({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { fpEdit, upFp } = ctx;
  return (
    <PanelDisplayOrigin
      idPrefix="fp"
      /* `m_displayOrigin->Show( m_frameType == FRAME_PCB_EDITOR )` — the whole
         of what this frame's variant is. */
      value={fpEdit}
      onChange={(patch) =>
        upFp((s) => {
          Object.assign(s, patch);
        })
      }
    />
  );
}
