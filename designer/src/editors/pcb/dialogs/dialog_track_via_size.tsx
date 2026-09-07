// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Custom Track/Via Size — what `TRACK_WIDTH_MENU`'s "Use Custom Values..." row
 * opens. Counterparts: `pcbnew/dialogs/dialog_track_via_size.cpp` for the
 * behaviour and `dialog_track_via_size_base.cpp` for the layout.
 *
 * Three rows of `fgSizer1 = new wxFlexGridSizer( 0, 3, 0, 0 )` with
 * `AddGrowableCol( 1 )` — label, entry, unit — then a `wxStaticLine` and the
 * standard buttons. The values it writes are `m_customTrackWidth` and
 * `m_customViaSize`, which `GetCurrentTrackWidth()` and `GetCurrentViaSize()`
 * return whenever `m_useCustomTrackVia` is on.
 *
 * Two things it does that a plainer dialog would not:
 *
 *  - every field carries a `minSize` of `0.01 * IU_PER_MM`
 *    (`dialog_track_via_size.cpp:35`), passed to `UNIT_BINDER` as its lower
 *    bound rather than checked here;
 *  - OK runs `PCB_VIA::ValidateViaParameters` over the via pair and, on a
 *    failure, puts the caret in the field the error names — the SAME function
 *    Board Setup > Pre-defined Sizes validates its via grid with, so the two
 *    refuse the same values with the same words.
 */
import { useState, type JSX } from 'react';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { validateViaParameters } from '@ziroeda/pcbnew/src/pcb_track.js';
import type { ViaDimension } from '@ziroeda/pcbnew/src/board_design_settings_sizes.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import type { StatusUnits } from '../../../ui/status_format.js';

/** [data] `const int minSize = (int)( 0.01 * pcbIUScale.IU_PER_MM )`, `:35`. */
const MIN_SIZE = Math.round(0.01 * pcbIUScale.IU_PER_MM);

export interface CustomTrackViaSize {
  /** `GetCustomTrackWidth()`. */
  trackWidth: number;
  /** `GetCustomViaSize()` / `GetCustomViaDrill()`. */
  via: ViaDimension;
}

interface Props {
  value: CustomTrackViaSize;
  /** The frame's display units — every field here is a `UNIT_BINDER`. */
  units: StatusUnits;
  onOk: (next: CustomTrackViaSize) => void;
  onClose: () => void;
}

export function DialogTrackViaSize({ value, units, onOk, onClose }: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask.
  useModalEscape(onClose);

  // A `UNIT_BINDER` holds text and parses on commit; driving the model off
  // every keystroke rewrites "0." under the caret.
  const [trackWidth, setTrackWidth] = useState(() => pcbUnitText(value.trackWidth, units));
  const [viaDiameter, setViaDiameter] = useState(() => pcbUnitText(value.via.diameter, units));
  const [viaDrill, setViaDrill] = useState(() => pcbUnitText(value.via.drill, units));
  const [error, setError] = useState<{ message: string; field: 'diameter' | 'drill' } | null>(null);

  const row = (
    label: string,
    id: string,
    text: string,
    setText: (s: string) => void,
  ): JSX.Element => (
    <>
      {/* [data] the label's `wxALIGN_CENTER_VERTICAL|wxTOP|wxBOTTOM|wxRIGHT, 5`. */}
      <span className="lbl">{label}</span>
      <input id={id} className="ze-search" value={text} onChange={(e) => setText(e.target.value)} />
      {/* [data] the unit label's `wxALL|wxALIGN_CENTER_VERTICAL, 5`. */}
      <span className="unit">{unitLabel(units)}</span>
    </>
  );

  // `TransferDataFromWindow`: validate the via pair, then store all three.
  const apply = (): void => {
    const next: CustomTrackViaSize = {
      trackWidth: Math.max(MIN_SIZE, pcbUnitValue(trackWidth, units)),
      via: {
        diameter: Math.max(MIN_SIZE, pcbUnitValue(viaDiameter, units)),
        drill: Math.max(MIN_SIZE, pcbUnitValue(viaDrill, units)),
      },
    };

    const bad = validateViaParameters(next.via.diameter, next.via.drill);

    if (bad) {
      // `DisplayError( … ); m_viaDrillText->SetFocus();`
      setError(bad);
      document.getElementById(`ze-ctv-${bad.field}`)?.focus();
      return;
    }

    onOk(next);
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-ctv-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Track Width and Via Size
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        {/* [data] `bSizes->Add( fgSizer1, 1, wxEXPAND|wxALL, 10 )`. */}
        <div className="ze-modal-body ze-ctv-body">
          {error && (
            <div className="ze-pref-error" role="alert">
              {error.message}
            </div>
          )}
          <div className="ze-ctv-grid">
            {row('Track width:', 'ze-ctv-track', trackWidth, setTrackWidth)}
            {row('Via diameter:', 'ze-ctv-diameter', viaDiameter, setViaDiameter)}
            {row('Via hole:', 'ze-ctv-drill', viaDrill, setViaDrill)}
          </div>
        </div>

        <div className="ze-modal-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={apply}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
