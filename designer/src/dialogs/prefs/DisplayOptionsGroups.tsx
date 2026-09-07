// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
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
import type { JSX } from 'react';
import { Check, Group, Sel } from './widgets.js';

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
