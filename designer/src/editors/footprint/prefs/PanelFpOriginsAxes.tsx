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
 * The sizer tree of what is left (`panel_pcbnew_display_origin_base.cpp:48-88`):
 *
 *     bLeftSizer (V)
 *       "X Axis" + wxStaticLine
 *       gSizer2 (wxGridSizer 0,1,4,0)               wxEXPAND|wxALL 10
 *         m_xIncreasesRight (wxRB_GROUP) / m_xIncreasesLeft
 *       "Y Axis" + wxStaticLine
 *       gSizer4 (wxGridSizer 0,1,4,0)               wxEXPAND|wxTOP|wxRIGHT|wxLEFT 10
 *         m_yIncreasesUp (wxRB_GROUP) / m_yIncreasesDown
 *
 * Note which button each group's *first* is, because it decides what an unset
 * setting looks like: X defaults to Increases **right** and Y to Increases
 * **up**, and the loader picks the second button only when the stored flag is
 * set (`panel_pcbnew_display_origin.cpp:44-56`). So `origin_invert_y_axis`
 * false means "Increases down" — the panel writes `m_DisplayInvertYAxis =
 * m_yIncreasesUp->GetValue()`, which is the button ABOVE the default one.
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
import { Group, Radio } from '../../../dialogs/prefs/widgets.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

/** `m_xIncreasesRight` / `m_xIncreasesLeft`, in the base file's order. */
const X_AXIS_CHOICES = [
  [false, 'Increases right'],
  [true, 'Increases left'],
] as const;

/** `m_yIncreasesUp` / `m_yIncreasesDown`, in the base file's order. */
const Y_AXIS_CHOICES = [
  [true, 'Increases up'],
  [false, 'Increases down'],
] as const;

export function PanelFpOriginsAxes({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { fpEdit, upFp } = ctx;
  return (
    <div>
      <Group title="X Axis">
        {/* `wxGridSizer( 0, 1, 4, 0 )` — a 4 px vgap between the two buttons,
            and `wxEXPAND|wxALL, 10` around the pair. */}
        <Radio
          name="fp-x-axis"
          value={fpEdit.origin_invert_x_axis ? 1 : 0}
          options={X_AXIS_CHOICES.map(([v, l]) => [v ? 1 : 0, l] as const)}
          onChange={(v) =>
            upFp((s) => {
              s.origin_invert_x_axis = v === 1;
            })
          }
        />
      </Group>
      <Group title="Y Axis">
        <Radio
          name="fp-y-axis"
          value={fpEdit.origin_invert_y_axis ? 1 : 0}
          options={Y_AXIS_CHOICES.map(([v, l]) => [v ? 1 : 0, l] as const)}
          onChange={(v) =>
            upFp((s) => {
              s.origin_invert_y_axis = v === 1;
            })
          }
        />
      </Group>
    </div>
  );
}
