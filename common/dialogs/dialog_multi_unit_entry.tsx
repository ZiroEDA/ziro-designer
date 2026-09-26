// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `WX_MULTI_ENTRY_DIALOG` (common/dialogs/dialog_multi_unit_entry.cpp): a
 * column of entries, each a unit-bound value (label / entry / unit) or a
 * checkbox across all three columns, built from the caller's list. The board
 * editor's Dogbone Corners asks through it (pcbnew/tools/edit_tool.cpp:1498-
 * 1530): "Arc radius:" and "Add slots in acute corners".
 *
 * The sizer: a wxGridBagSizer( 0, 0 ), value column growable, at
 * wxEXPAND|wxRIGHT|wxLEFT 5; a value row's label wxALIGN_CENTER_VERTICAL|
 * wxTOP|wxBOTTOM|wxLEFT 5, entry wxALL|wxEXPAND 5, unit wxTOP|wxBOTTOM|wxRIGHT
 * 5; a checkbox spans the three at wxALL 5; the std buttons wxALL|wxEXPAND 5.
 */
import { useState, type JSX } from 'react';
import { StdDialogButtons } from '../dialog_shim_buttons.js';
import type { EdaIuScale } from '../eda_units.js';
import { unitLabel, type EdaUnits } from '../widgets/unit_binder.js';
import { unitEntryText, unitEntryValue } from './dialog_unit_entry.js';
import { useModalEscape } from './use_modal_escape.js';

/** `ENTRY`: a label, a tooltip, and a UNIT_BOUND or CHECKBOX default. */
export interface MULTI_ENTRY {
  label: string;
  tooltip?: string;
  value: { UNIT_BOUND: number } | { CHECKBOX: boolean };
}

/** `RESULT`: IU for a unit-bound entry, the state for a checkbox. */
export type MULTI_ENTRY_RESULT = number | boolean;

export function WX_MULTI_ENTRY_DIALOG({
  caption,
  entries,
  units,
  iuScale,
  onResult,
}: {
  caption: string;
  entries: readonly MULTI_ENTRY[];
  units: EdaUnits;
  iuScale: EdaIuScale;
  /** `GetValues()` on wxID_OK, in entry order; `null` on wxID_CANCEL. */
  onResult: (values: MULTI_ENTRY_RESULT[] | null) => void;
}): JSX.Element {
  const [state, setState] = useState<(string | boolean)[]>(() =>
    entries.map((e) =>
      'UNIT_BOUND' in e.value
        ? unitEntryText(e.value.UNIT_BOUND, units, iuScale)
        : e.value.CHECKBOX,
    ),
  );
  useModalEscape(() => onResult(null));
  const set = (i: number, v: string | boolean): void =>
    setState((s) => s.map((x, j) => (j === i ? v : x)));
  const ok = (): void =>
    onResult(
      state.map((v) => {
        if (typeof v === 'boolean') return v;
        const n = unitEntryValue(v, units, iuScale);
        return Number.isFinite(n) ? n : 0;
      }),
    );

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-multientry" role="dialog" aria-modal="true" aria-label={caption}>
        <div className="ze-modal-header">{caption}</div>
        <div className="ze-multientry-grid">
          {entries.map((e, i) =>
            'UNIT_BOUND' in e.value ? (
              <div key={e.label} className="ze-multientry-row">
                <span className="ze-unitentry-label">{e.label}</span>
                <input
                  className="ze-search ze-multientry-ctrl"
                  aria-label={e.label}
                  title={e.tooltip}
                  value={state[i] as string}
                  onChange={(ev) => set(i, ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') ok();
                    ev.stopPropagation();
                  }}
                />
                <span className="ze-unitentry-unit">{unitLabel(units)}</span>
              </div>
            ) : (
              <label key={e.label} className="ze-check ze-multientry-check" title={e.tooltip}>
                <input
                  type="checkbox"
                  checked={state[i] as boolean}
                  onChange={(ev) => set(i, ev.target.checked)}
                />
                {e.label}
              </label>
            ),
          )}
        </div>
        <StdDialogButtons onCancel={() => onResult(null)} onOk={ok} />
      </div>
    </div>
  );
}
