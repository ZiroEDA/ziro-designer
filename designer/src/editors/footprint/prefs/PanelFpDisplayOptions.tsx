// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Footprint Editor > Display Options — `PANEL_DISPLAY_OPTIONS`
 * (`pcbnew/dialogs/panel_display_options.cpp` and its `_base.cpp`), which
 * upstream is ONE class both pcbnew frames construct; pcbnew's KIFACE builds it
 * for `PANEL_FP_DISPLAY_OPTIONS` with the footprint editor's own settings
 * object and nothing else:
 *
 *     return new PANEL_DISPLAY_OPTIONS( aParent,
 *             GetAppSettings<FOOTPRINT_EDITOR_SETTINGS>( "fpedit" ) );
 *     (`pcbnew/pcbnew.cpp:305-306`)
 *
 * The class tells the two frames apart by asking whether that object is a
 * `PCBNEW_SETTINGS` (`panel_display_options.cpp:40`) and drives a
 * **`wxSimplebook`** off the answer: `m_optionsBook->SetSelection( m_isPCBEdit
 * ? 1 : 0 )`, where page 0 is an EMPTY `wxPanel` (`_base.cpp:88-97`) and page 1
 * carries Annotations, Selection && Highlighting and Cross-probing. So the
 * footprint editor's right column is blank, and this page is the left column
 * alone.
 *
 * The sizer tree of that left column (`panel_display_options_base.cpp:15-80`):
 *
 *     bSizer11 (V)
 *       m_galOptionsSizer (V) -> PANEL_GAL_OPTIONS   wxRIGHT 5, then wxRIGHT 10
 *       (0, 8) spacer
 *       bSizerPads (V)                               wxEXPAND|wxTOP|wxRIGHT|wxLEFT 5
 *         "Pads" + wxStaticLine
 *         m_OptUseViaColorForNormalTHPadstacks       wxALL 5
 *         (0, 8) spacer
 *         "Clearance Outlines" + wxStaticLine
 *         gbSizer2
 *           "Tracks:" + m_OptDisplayTracksClearance
 *           m_OptDisplayPadClearence
 *
 * **The Pads and Clearance Outlines groups are drawn here and read by nothing,
 * and that is upstream's behaviour, not a gap.** They sit in `bSizer11`, which
 * is outside the simplebook, so both frames draw them — but every one of the
 * three is loaded and stored only inside `if( m_isPCBEdit )`
 * (`panel_display_options.cpp:54-70`, `:89-108`), and
 * `FOOTPRINT_EDITOR_SETTINGS` has no param for any of them. In the footprint
 * editor they therefore open at the values the wxFormBuilder file sets —
 * unchecked, and choice index 0 — take a click, and are gone when the dialog
 * closes. Ours says the same thing the only way React can: local state seeded
 * from those initial values, and no `ctx` write anywhere near them. Storing
 * them in `fpedit.json` would be an invention; hiding them would be a different
 * page from KiCad's.
 *
 * The two groups themselves are `dialogs/prefs/DisplayOptionsGroups.tsx`, one
 * sizer written once, because the PCB Editor's page draws the same three
 * controls over its own `pcb_display` slice.
 */
import { useState, type JSX } from 'react';
import { PadsAndClearanceGroups } from '../../../dialogs/prefs/DisplayOptionsGroups.js';
import type { PadsAndClearanceValue } from '../../../dialogs/prefs/DisplayOptionsGroups.js';
import { PanelGalOptions } from '../../../dialogs/prefs/PanelGalOptions.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

export function PanelFpDisplayOptions({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { fpEdit, upFp } = ctx;

  // The three controls upstream never loads and never saves in this frame.
  // `m_OptUseViaColorForNormalTHPadstacks` and `m_OptDisplayPadClearence` carry
  // no `SetValue` in the base file, so they start clear;
  // `m_OptDisplayTracksClearance->SetSelection( 0 )` starts on the first row.
  const [padsAndClearance, setPadsAndClearance] = useState<PadsAndClearanceValue>({
    pad_use_via_color_for_normal_th_padstacks: false,
    track_clearance_mode: 0,
    pad_clearance: false,
  });

  return (
    <div>
      {/* `m_galOptsPanel = new PANEL_GAL_OPTIONS( this, aAppSettings )`
          (`panel_display_options.cpp:42`) — the shared panel over this editor's
          own settings object, which is the whole of what this page can change.

          Every control in it is live: Style, Grid thickness and Minimum grid
          spacing reach `drawGrid` through `pcbGridOptions`, Snap to grid is
          `footprintSnappingEnabled` in `editors/footprint/grid.ts`
          (`GAL::GetGridSnapping`), and the Cursor group is what
          `FootprintCanvas` hands `drawCrosshair`. */}
      <PanelGalOptions
        win={fpEdit.window}
        update={(fn) => upFp((s) => fn(s.window))}
        idPrefix="fp"
      />
      <PadsAndClearanceGroups
        value={padsAndClearance}
        onChange={(patch) => setPadsAndClearance((v) => ({ ...v, ...patch }))}
      />
    </div>
  );
}
