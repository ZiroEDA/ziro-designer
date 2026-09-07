// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > PCB Editor > Display Options — `PANEL_DISPLAY_OPTIONS`
 * (`pcbnew/dialogs/panel_display_options.cpp` and its `_base.cpp`), which
 * upstream is ONE class the PCB and Footprint editors both take; pcbnew's
 * KIFACE constructs it for `PANEL_PCB_DISPLAY_OPTS` with `PCBNEW_SETTINGS`
 * (`pcbnew/pcbnew.cpp:401-450`), and the class tells the frames apart by asking
 * whether that object is a `PCBNEW_SETTINGS` (`:40`).
 *
 * **Two columns.** `bupperSizer` is horizontal (`_base.cpp:18`): `bSizer11` on
 * the left, a 15 px spacer, then `m_optionsBook` on the right. The book is a
 * `wxSimplebook` whose page 0 is EMPTY and whose page 1 carries Annotations,
 * Selection && Highlighting and Cross-probing, and the PCB editor gets page 1
 * (`m_optionsBook->SetSelection( m_isPCBEdit ? 1 : 0 )`). The footprint
 * editor's page is the left column alone, which is why
 * `PanelFpDisplayOptions` draws no right column and this one does.
 *
 *     bupperSizer (H)
 *       bSizer11 (V)                         proportion 1
 *         PANEL_GAL_OPTIONS                  Grid Display + Cursor
 *         (0, 8)
 *         bSizerPads (V)                     Pads + Clearance Outlines
 *       (15, 0) spacer
 *       m_optionsBook -> pcbPage (V)
 *         Annotations                        Net names, Show pad numbers
 *         Selection && Highlighting          Show all fields when …
 *         Cross-probing                      five + Refresh 3D view
 *
 * Every group but the last two is shared with the footprint editor's page and
 * lives in `dialogs/prefs/`; only the ones the book adds are written here.
 *
 * **What reads each of them.** A Preferences page is finished when something
 * outside the dialog reads its slice, so:
 *
 *  - Grid Display's Style, thickness and minimum spacing reach `drawGrid`
 *    through `pcbGridOptions` in `PcbEditor`'s paint pass; Snap to grid is the
 *    predicate `pcbSnappingEnabled` applies before `snapToGrid`.
 *  - Cursor is what `PcbEditor` hands `drawCrosshair` — the shape and
 *    `alwaysShow`, which was hardcoded true.
 *  - Net names, Show pad numbers, Show pad clearance and the via colour flag
 *    are `PcbDrawOptions` fields `renderBoard` already gates on; this page is
 *    what finally sets them from a stored value rather than from
 *    `DEFAULT_DRAW_OPTIONS`.
 *  - Show all fields when parent footprint is selected is
 *    `m_Display.m_ForceShowFieldsWhenFPSelected`, read by the selection pass.
 *  - Tracks: clearance outlines is read by the router's preview.
 *  - Refresh 3D view automatically is `Viewer3DFrame`'s live-reload gate.
 */
import type { JSX } from 'react';
import { Check, Group, Sel } from '../../../dialogs/prefs/widgets.js';
import {
  NET_NAMES_CHOICES,
  PadsAndClearanceGroups,
} from '../../../dialogs/prefs/DisplayOptionsGroups.js';
import { CrossProbingGroup } from '../../../dialogs/prefs/CrossProbingGroup.js';
import { PanelGalOptions } from '../../../dialogs/prefs/PanelGalOptions.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export function PanelPcbDisplayOptions({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { pcbnew, upP } = ctx;
  const display = pcbnew.pcb_display;
  const setDisplay = (patch: Partial<typeof display>): void =>
    upP((s) => {
      Object.assign(s.pcb_display, patch);
    });

  return (
    <div className="ze-display-opts">
      {/* `bSizer11`, `bupperSizer->Add( bSizer11, 1, wxEXPAND )`. */}
      <div className="ze-display-opts-col">
        {/* `m_galOptionsSizer`, `Add( …, 0, wxEXPAND|wxRIGHT, 10 )`, with the
            panel inside it carrying another `wxRIGHT, 5`. */}
        <div className="ze-display-opts-gal">
          <PanelGalOptions
            win={pcbnew.window}
            update={(fn) => upP((s) => fn(s.window))}
            idPrefix="pcb"
          />
        </div>
        <PadsAndClearanceGroups value={display} onChange={setDisplay} />
      </div>
      {/* `m_optionsBook`'s page 1. */}
      <div className="ze-display-opts-col">
        <Group title="Annotations">
          <Sel
            label="Net names:"
            value={display.net_names_mode}
            options={NET_NAMES_CHOICES.map((c) => [c[0], c[1]] as [number, string])}
            onChange={(v) => setDisplay({ net_names_mode: v as 0 | 1 | 2 | 3 })}
          />
          {/* `wxALL, 5`. */}
          <Check
            label="Show pad numbers"
            checked={display.pad_numbers}
            borders={['top', 'bottom']}
            onChange={(v) => setDisplay({ pad_numbers: v })}
          />
        </Group>
        {/* `_("Selection && Highlighting")` — the `&&` is wx's escape for one
            literal ampersand, not two. */}
        <Group title="Selection & Highlighting">
          <Check
            label="Show all fields when parent footprint is selected"
            checked={display.force_show_fields_when_fp_selected}
            borders={['top', 'bottom']}
            onChange={(v) => setDisplay({ force_show_fields_when_fp_selected: v })}
          />
        </Group>
        <CrossProbingGroup
          peer="schematic"
          value={pcbnew.cross_probing}
          onChange={(fn) => upP((s) => fn(s.cross_probing))}
        >
          {/* `m_live3Drefresh` is the sixth child of `bSizer8`, the
              Cross-probing group's own sizer (`_base.cpp:196-199`) — it is not
              a cross-probe setting, it just shares the box. */}
          <Check
            label="Refresh 3D view automatically"
            title="When enabled, edits to the board will cause the 3D view to refresh (may be slow with larger boards)"
            checked={display.live_3d_refresh}
            onChange={(v) => setDisplay({ live_3d_refresh: v })}
          />
        </CrossProbingGroup>
      </div>
    </div>
  );
}
