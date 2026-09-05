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
 * When the PCB Editor's own Display Options page is completed these two groups
 * become shared and move to `dialogs/prefs/`; they are here rather than there
 * today because `editors/pcb/prefs/PanelPcbDisplayOptions.tsx` still ports only
 * the book's Cross-probing group and has no store behind the left column.
 */
import { useState, type JSX } from 'react';
import { Check, Group, Sel } from '../../../dialogs/prefs/widgets.js';
import { PanelGalOptions } from '../../../dialogs/prefs/PanelGalOptions.js';
import type { PrefsContext } from '../../../dialogs/prefs/types.js';

/**
 * `m_OptDisplayTracksClearanceChoices`
 * (`panel_display_options_base.cpp:64-66`), in the wxChoice's own order.
 *
 * The stored value is NOT this index: `clearanceModeMap`
 * (`panel_display_options.cpp:29-36`) maps `TRACK_CLEARANCE_MODE` to it, and
 * the enum's order is different again. Nothing here needs the mapping, because
 * nothing here stores the value — see the note above — but the labels and their
 * order are what the user sees, so they are transcribed rather than guessed.
 */
const TRACK_CLEARANCE_CHOICES: [number, string][] = [
  [0, 'Do not show clearances'],
  [1, 'Show when routing'],
  [2, 'Show when routing w/ via clearance at end'],
  [3, 'Show when routing and editing'],
  [4, 'Show always'],
];

export function PanelFpDisplayOptions({ ctx }: { ctx: PrefsContext }): JSX.Element {
  const { fpEdit, upFp } = ctx;

  // The three controls upstream never loads and never saves in this frame.
  // `m_OptUseViaColorForNormalTHPadstacks` and `m_OptDisplayPadClearence` carry
  // no `SetValue` in the base file, so they start clear;
  // `m_OptDisplayTracksClearance->SetSelection( 0 )` starts on the first row.
  const [useViaColour, setUseViaColour] = useState(false);
  const [trackClearance, setTrackClearance] = useState(0);
  const [padClearance, setPadClearance] = useState(false);

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
      <Group title="Pads">
        {/* `wxALL, 5` — the only row in this group, and it carries a top border. */}
        <Check
          label="Use via color for normal through hole padstacks"
          checked={useViaColour}
          borders={['top', 'bottom']}
          onChange={setUseViaColour}
        />
      </Group>
      <Group title="Clearance Outlines">
        <Sel
          label="Tracks:"
          value={trackClearance}
          options={TRACK_CLEARANCE_CHOICES}
          onChange={setTrackClearance}
        />
        {/* `wxALL, 5` again. */}
        <Check
          label="Show pad clearance"
          checked={padClearance}
          borders={['top', 'bottom']}
          onChange={setPadClearance}
        />
      </Group>
    </div>
  );
}
