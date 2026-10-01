// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_DISPLAY_OPTIONS` (`pcbnew/dialogs/panel_display_options.cpp` and its
 * `_base.cpp`): ONE class upstream that the PCB and Footprint editors both
 * take. It is written here as the two pages' bodies over one shared
 * `bSizerPads`, in the file upstream keeps them in. The three sections below
 * keep the header each had when they were separate modules.
 *
 * The panels read the Preferences working copy through the narrow structural
 * contexts `PANEL_DISPLAY_OPTIONS_PCB_CTX` / `_FP_CTX`: the app's `PrefsContext`
 * satisfies both, and this module names nothing of the designer.
 */
import { useState, type ComponentProps, type JSX } from 'react';
import { Check, Group, Sel } from '@ziroeda/common/wx/controls.js';
import { CrossProbingGroup } from '@ziroeda/common/dialogs/cross_probing_group.js';
import { PanelGalOptions } from '@ziroeda/common/dialogs/panel_gal_options.js';

type GalWin = ComponentProps<typeof PanelGalOptions>['win'];
type CrossProbing = ComponentProps<typeof CrossProbingGroup>['value'];

// ---------------------------------------------------------------------------
// bSizerPads: the Pads and Clearance Outlines groups
// ---------------------------------------------------------------------------
/**
 * `PANEL_DISPLAY_OPTIONS`' Pads and Clearance Outlines groups — `bSizerPads`
 * (`pcbnew/dialogs/panel_display_options_base.cpp:31-77`).
 *
 * They live in `bSizer11`, which is OUTSIDE the panel's `wxSimplebook`, so both
 * pcbnew frames draw them; only the PCB one loads and stores them, because
 * every read and write of the three is inside `if( m_isPCBEdit )`
 * (`panel_display_options.cpp:54-70`, `:89-108`) and
 * `FOOTPRINT_EDITOR_SETTINGS` registers no param for any of them.
 *
 * That is why this is a shared component and not a copy in each page: it is one
 * sizer upstream, and the two call sites differ only in what backs it — the
 * PCB editor's `pcb_display` slice, and local state that dies with the dialog
 * in the footprint editor.
 */

/**
 * `m_OptDisplayTracksClearanceChoices`
 * (`panel_display_options_base.cpp:64-66`), in the wxChoice's own order.
 *
 * The value is the `TRACK_CLEARANCE_MODE` enum (`pcbnew/pcbnew_settings.h:
 * 85-92`), which happens to run in the same order — `clearanceModeMap`
 * (`panel_display_options.cpp:29-36`) is an identity map whose only job is to
 * name `SHOW_WITH_VIA_WHILE_ROUTING` as the fallback for a value that is not in
 * the table. Stated as pairs rather than as an array index so that staying
 * identity is a property of this table and not an assumption elsewhere.
 */
export const TRACK_CLEARANCE_CHOICES: readonly (readonly [number, string])[] = [
  [0, 'Do not show clearances'],
  [1, 'Show when routing'],
  [2, 'Show when routing w/ via clearance at end'],
  [3, 'Show when routing and editing'],
  [4, 'Show always'],
];

/**
 * `m_ShowNetNamesOptionChoices` (`panel_display_options_base.cpp:123-124`).
 *
 * Here the selection index IS the stored value —
 * `m_ShowNetNamesOption->SetSelection( aCfg->m_Display.m_NetNames )` with no
 * map in between (`panel_display_options.cpp:64`).
 */
export const NET_NAMES_CHOICES: readonly (readonly [number, string])[] = [
  [0, 'Do not show'],
  [1, 'Show on pads'],
  [2, 'Show on tracks'],
  [3, 'Show on pads & tracks'],
];

/** The three values `bSizerPads` edits, whoever is holding them. */
export interface PadsAndClearanceValue {
  pad_use_via_color_for_normal_th_padstacks: boolean;
  /** `TRACK_CLEARANCE_MODE`, whose five values are the rows of the choice. */
  track_clearance_mode: TrackClearanceMode;
  pad_clearance: boolean;
}

/** `TRACK_CLEARANCE_MODE` (`pcbnew/pcbnew_settings.h:85-92`). */
export type TrackClearanceMode = 0 | 1 | 2 | 3 | 4;

export function PadsAndClearanceGroups({
  value,
  onChange,
}: {
  value: PadsAndClearanceValue;
  onChange: (patch: Partial<PadsAndClearanceValue>) => void;
}): JSX.Element {
  return (
    // `bSizerPads`, added `wxEXPAND|wxTOP|wxRIGHT|wxLEFT, 5` — the 5 on each
    // side is why KiCad's Pads rule starts and ends further out than the GAL
    // panel's above it.
    <div className="ze-display-opts-pads">
      <Group title="Pads">
        {/* `wxALL, 5` — the only row in this group, and it carries a top border. */}
        <Check
          label="Use via color for normal through hole padstacks"
          checked={value.pad_use_via_color_for_normal_th_padstacks}
          borders={['top', 'bottom']}
          onChange={(v) => onChange({ pad_use_via_color_for_normal_th_padstacks: v })}
        />
      </Group>
      <Group title="Clearance Outlines">
        <Sel
          label="Tracks:"
          value={value.track_clearance_mode}
          options={TRACK_CLEARANCE_CHOICES.map((c) => [c[0], c[1]] as [number, string])}
          onChange={(v) => onChange({ track_clearance_mode: v as TrackClearanceMode })}
        />
        {/* `wxALL, 5` again. */}
        <Check
          label="Show pad clearance"
          checked={value.pad_clearance}
          borders={['top', 'bottom']}
          onChange={(v) => onChange({ pad_clearance: v })}
        />
      </Group>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The PCB Editor's page
// ---------------------------------------------------------------------------
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

/** `PCBNEW_SETTINGS::m_Display` (+ its window and cross-probing) as this page reads it. */
export interface PANEL_DISPLAY_OPTIONS_PCB_SLICE {
  pcb_display: PadsAndClearanceValue & {
    net_names_mode: number;
    pad_numbers: boolean;
    force_show_fields_when_fp_selected: boolean;
    live_3d_refresh: boolean;
  };
  window: GalWin;
  cross_probing: CrossProbing;
}

export interface PANEL_DISPLAY_OPTIONS_PCB_CTX {
  pcbnew: PANEL_DISPLAY_OPTIONS_PCB_SLICE;
  upP: (fn: (s: PANEL_DISPLAY_OPTIONS_PCB_SLICE) => void) => void;
}

export function PanelPcbDisplayOptions({
  ctx,
}: {
  ctx: PANEL_DISPLAY_OPTIONS_PCB_CTX;
}): JSX.Element {
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

// ---------------------------------------------------------------------------
// The Footprint Editor's page
// ---------------------------------------------------------------------------
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

export interface PANEL_DISPLAY_OPTIONS_FP_CTX {
  fpEdit: { window: GalWin };
  upFp: (fn: (s: { window: GalWin }) => void) => void;
}

export function PanelFpDisplayOptions({ ctx }: { ctx: PANEL_DISPLAY_OPTIONS_FP_CTX }): JSX.Element {
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
