// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Differential Pair Dimensions — what `DIFF_PAIR_MENU`'s "Use Custom Values..."
 * row opens. Counterparts: `pcbnew/dialogs/dialog_pns_diff_pair_dimensions.cpp`
 * and `dialog_pns_diff_pair_dimensions_base.cpp`.
 *
 * Three rows of `fgSizer1 = new wxFlexGridSizer( 0, 3, 5, 0 )` with
 * `AddGrowableCol( 1 )`, then one checkbox and the standard buttons.
 *
 * It is unlike its Track/Via sibling in three ways, and each is upstream's:
 *
 *  - it writes `PNS::SIZES_SETTINGS` rather than `BOARD_DESIGN_SETTINGS`, so
 *    what it sets is the live route's dimensions, not the board's stored
 *    custom values;
 *  - the "Via gap same as track gap" checkbox GREYS the via gap row rather than
 *    hiding it, and starts ticked — `m_viaTraceGapEqual->SetValue( true )` in
 *    the base file — so the via gap field is disabled on a first open;
 *  - it refuses a gap of zero with its own message ("Track gap must be greater
 *    than 0.") and focuses that field, and refuses NOTHING else. A width of
 *    zero is accepted.
 *
 * It also stamps `SetDiffPairGapSource( "user choice" )` and the width's, which
 * is the string `ROUTER_TOOL`'s status bar shows afterwards.
 */
import { useState, type JSX } from 'react';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import type { StatusUnits } from '../../../ui/status_format.js';

/** The `PNS::SIZES_SETTINGS` members this dialog reads and writes, in IU. */
export interface DiffPairDimensionsValue {
  /** `DiffPairWidth()`. */
  width: number;
  /** `DiffPairGap()`. */
  gap: number;
  /** The raw `m_diffPairViaGap`. */
  viaGap: number;
  /** `DiffPairViaGapSameAsTraceGap()`. */
  viaGapSameAsTraceGap: boolean;
}

interface Props {
  value: DiffPairDimensionsValue;
  /** The frame's display units — all three fields are `UNIT_BINDER`s. */
  units: StatusUnits;
  onOk: (next: DiffPairDimensionsValue) => void;
  onClose: () => void;
}

export function DialogPnsDiffPairDimensions({ value, units, onOk, onClose }: Props): JSX.Element {
  useModalEscape(onClose);

  const [width, setWidth] = useState(() => pcbUnitText(value.width, units));
  const [gap, setGap] = useState(() => pcbUnitText(value.gap, units));
  const [viaGap, setViaGap] = useState(() => pcbUnitText(value.viaGap, units));
  const [same, setSame] = useState(value.viaGapSameAsTraceGap);
  const [error, setError] = useState<string | null>(null);

  const row = (
    label: string,
    id: string,
    text: string,
    setText: (s: string) => void,
    disabled = false,
  ): JSX.Element => (
    <>
      <span className={`lbl${disabled ? ' disabled' : ''}`}>{label}</span>
      <input
        id={id}
        className="ze-search"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
      />
      <span className={`unit${disabled ? ' disabled' : ''}`}>{unitLabel(units)}</span>
    </>
  );

  // `TransferDataFromWindow`: the gap is the only value that can refuse.
  const apply = (): void => {
    const next: DiffPairDimensionsValue = {
      width: pcbUnitValue(width, units),
      gap: pcbUnitValue(gap, units),
      viaGap: pcbUnitValue(viaGap, units),
      viaGapSameAsTraceGap: same,
    };

    if (next.gap <= 0) {
      setError('Track gap must be greater than 0.');
      document.getElementById('ze-dpd-gap')?.focus();
      return;
    }

    onOk(next);
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-dpd-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Differential Pair Dimensions
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        {/* [data] `bSizer7->Add( fgSizer1, 0, wxEXPAND|wxTOP|wxRIGHT|wxLEFT, 10 )`. */}
        <div className="ze-modal-body ze-dpd-body">
          {error && (
            <div className="ze-pref-error" role="alert">
              {error}
            </div>
          )}
          <div className="ze-dpd-grid">
            {row('Width:', 'ze-dpd-width', width, setWidth)}
            {row('Track gap:', 'ze-dpd-gap', gap, setGap)}
            {/* `updateCheckbox()` disables the row rather than hiding it, so the
                value stays visible while it is not being used. */}
            {row('Via gap:', 'ze-dpd-via-gap', viaGap, setViaGap, same)}
          </div>

          {/* [data] `bSizer7->Add( m_viaTraceGapEqual, 0, wxALL|wxEXPAND, 10 )`. */}
          <label className="ze-pref-check ze-dpd-same">
            <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} />
            Via gap same as track gap
          </label>
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
