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
import type { CrossProbingGroup } from '@ziroeda/common/dialogs/cross_probing_group.js';
import { PanelGalOptions } from '@ziroeda/common/dialogs/panel_gal_options.js';
import { wxEXPAND, wxRIGHT } from '@ziroeda/wx/defs.js';
import { SizerItem } from '@ziroeda/wx/sizer.js';
import { PANEL_DISPLAY_OPTIONS_BASE } from './panel_display_options_base.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

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
  [0, _HKI('Do not show clearances')],
  [1, _HKI('Show when routing')],
  [2, _HKI('Show when routing w/ via clearance at end')],
  [3, _HKI('Show when routing and editing')],
  [4, _HKI('Show always')],
];

/**
 * `m_ShowNetNamesOptionChoices` (`panel_display_options_base.cpp:123-124`).
 *
 * Here the selection index IS the stored value —
 * `m_ShowNetNamesOption->SetSelection( aCfg->m_Display.m_NetNames )` with no
 * map in between (`panel_display_options.cpp:64`).
 */
export const NET_NAMES_CHOICES: readonly (readonly [number, string])[] = [
  [0, _HKI('Do not show')],
  [1, _HKI('Show on pads')],
  [2, _HKI('Show on tracks')],
  [3, _HKI('Show on pads & tracks')],
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

/** `m_galOptionsSizer->Add( m_galOptsPanel, 1, wxEXPAND|wxRIGHT, 5 )`. */
function galPanel(
  aWin: GalWin,
  aUpdate: (fn: (w: GalWin) => void) => void,
  aIdPrefix: string,
): JSX.Element {
  return (
    <SizerItem proportion={1} flag={wxEXPAND | wxRIGHT} border={5}>
      <PanelGalOptions win={aWin} update={aUpdate} idPrefix={aIdPrefix} />
    </SizerItem>
  );
}

const check = (aValue: boolean, aOn: (v: boolean) => void) => ({ value: aValue, onChange: aOn });

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

  const cp = pcbnew.cross_probing;
  const setCp =
    (
      aKey:
        | 'on_selection'
        | 'center_on_items'
        | 'zoom_to_fit'
        | 'auto_highlight'
        | 'flash_selection',
    ) =>
    (aOn: boolean) =>
      upP((s) => {
        s.cross_probing[aKey] = aOn;
      });

  return (
    <PANEL_DISPLAY_OPTIONS_BASE
      m_galOptionsSizer={galPanel(pcbnew.window, (fn) => upP((s) => fn(s.window)), 'pcb')}
      m_OptUseViaColorForNormalTHPadstacks={check(
        display.pad_use_via_color_for_normal_th_padstacks,
        (v) => setDisplay({ pad_use_via_color_for_normal_th_padstacks: v }),
      )}
      // clearanceModeMap is the identity on TRACK_CLEARANCE_MODE.
      m_OptDisplayTracksClearance={{
        value: display.track_clearance_mode,
        onChange: (i) => setDisplay({ track_clearance_mode: i as TrackClearanceMode }),
      }}
      m_OptDisplayPadClearence={check(display.pad_clearance, (v) =>
        setDisplay({ pad_clearance: v }),
      )}
      optionsPage={1}
      m_ShowNetNamesOption={{
        value: display.net_names_mode,
        onChange: (i) => setDisplay({ net_names_mode: i as 0 | 1 | 2 | 3 }),
      }}
      m_OptDisplayPadNumber={check(display.pad_numbers, (v) => setDisplay({ pad_numbers: v }))}
      m_checkForceShowFieldsWhenFPSelected={check(display.force_show_fields_when_fp_selected, (v) =>
        setDisplay({ force_show_fields_when_fp_selected: v }),
      )}
      m_checkCrossProbeOnSelection={check(cp.on_selection, setCp('on_selection'))}
      m_checkCrossProbeCenter={check(cp.center_on_items, setCp('center_on_items'))}
      m_checkCrossProbeZoom={check(cp.zoom_to_fit, setCp('zoom_to_fit'))}
      m_checkCrossProbeAutoHighlight={check(cp.auto_highlight, setCp('auto_highlight'))}
      m_checkCrossProbeFlash={check(cp.flash_selection, setCp('flash_selection'))}
      m_live3Drefresh={check(display.live_3d_refresh, (v) => setDisplay({ live_3d_refresh: v }))}
    />
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

  const setPc = (patch: Partial<PadsAndClearanceValue>): void =>
    setPadsAndClearance((v) => ({ ...v, ...patch }));
  // Page 0 of m_optionsBook is empty, so the PCB page's controls are drawn by nobody; they are
  // given inert values only because the base takes them.
  const off = check(false, () => {});

  return (
    <PANEL_DISPLAY_OPTIONS_BASE
      m_galOptionsSizer={galPanel(fpEdit.window, (fn) => upFp((s) => fn(s.window)), 'fp')}
      m_OptUseViaColorForNormalTHPadstacks={check(
        padsAndClearance.pad_use_via_color_for_normal_th_padstacks,
        (v) => setPc({ pad_use_via_color_for_normal_th_padstacks: v }),
      )}
      m_OptDisplayTracksClearance={{
        value: padsAndClearance.track_clearance_mode,
        onChange: (i) => setPc({ track_clearance_mode: i as TrackClearanceMode }),
      }}
      m_OptDisplayPadClearence={check(padsAndClearance.pad_clearance, (v) =>
        setPc({ pad_clearance: v }),
      )}
      optionsPage={0}
      m_ShowNetNamesOption={{ value: 0, onChange: () => {} }}
      m_OptDisplayPadNumber={off}
      m_checkForceShowFieldsWhenFPSelected={off}
      m_checkCrossProbeOnSelection={off}
      m_checkCrossProbeCenter={off}
      m_checkCrossProbeZoom={off}
      m_checkCrossProbeAutoHighlight={off}
      m_checkCrossProbeFlash={off}
      m_live3Drefresh={off}
    />
  );
}
