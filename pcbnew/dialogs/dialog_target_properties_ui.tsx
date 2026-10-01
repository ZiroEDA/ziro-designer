// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Alignment Target Properties. Counterpart: `dialog_target_properties_base.cpp`:
 *
 *     bSizerMain (V)
 *       bSizerUpper (V)                      wxALL|wxEXPAND 5
 *         fgSizer (3 cols, col 1 growable)   wxBOTTOM|wxEXPAND 5
 *           "Size:"      entry  unit
 *           "Thickness:" entry  unit
 *           "Shape:"     wxChoice { "+", "X" }
 *       wxStdDialogButtonSizer               wxBOTTOM|wxEXPAND|wxTOP 5
 *
 * The decisions are `dialog_target_properties.ts`; this is the controls. The
 * three distances are `UNIT_BINDER`s, so they show and read the frame's unit.
 */
import { useState, type JSX } from 'react';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import { TARGET_SHAPE_CHOICES, type TargetValues } from './dialog_target_properties.js';
import type { TransferResult } from './dialog_text_properties.js';

export function DialogTargetProperties({
  initial,
  units,
  onApply,
  onClose,
}: {
  initial: TargetValues;
  /** The frame's display units. */
  units: StatusUnits;
  /** `TransferDataFromWindow`: `ok` closes the dialog, a message stays up behind it. */
  onApply: (v: TargetValues) => TransferResult;
  onClose: () => void;
}): JSX.Element {
  useModalEscape(onClose);

  // A `UNIT_BINDER` holds text and parses on commit.
  const [size, setSize] = useState(() => pcbUnitText(initial.size, units));
  const [thickness, setThickness] = useState(() => pcbUnitText(initial.thickness, units));
  const [shape, setShape] = useState<0 | 1>(initial.shape);
  const [error, setError] = useState<string | null>(null);

  const apply = (): void => {
    const r = onApply({
      size: pcbUnitValue(size, units),
      thickness: pcbUnitValue(thickness, units),
      shape,
    });

    if (r.ok) onClose();
    else if (r.message) {
      setError(r.message);
      document.getElementById('ze-tgt-size')?.focus();
    }
  };

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-tgt-dialog" role="dialog" aria-modal="true">
        <div className="ze-modal-header">Alignment Target Properties</div>
        <div className="ze-modal-body ze-tgt-body">
          {error && (
            <div className="ze-pref-error" role="alert">
              {error}
            </div>
          )}
          <div className="ze-tgt-grid">
            <label className="lbl" htmlFor="ze-tgt-size">
              Size:
            </label>
            {/* `SetInitialFocus( m_sizeCtrl )`. */}
            <input
              id="ze-tgt-size"
              className="ze-search"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              // biome-ignore lint/a11y/noAutofocus: SetInitialFocus( m_sizeCtrl )
              autoFocus
            />
            <span className="unit">{unitLabel(units)}</span>

            <label className="lbl" htmlFor="ze-tgt-thickness">
              Thickness:
            </label>
            <input
              id="ze-tgt-thickness"
              className="ze-search"
              value={thickness}
              onChange={(e) => setThickness(e.target.value)}
            />
            <span className="unit">{unitLabel(units)}</span>

            <span className="lbl">Shape:</span>
            <Combo
              value={String(shape)}
              options={TARGET_SHAPE_CHOICES.map(([value, label]) => ({
                value: String(value),
                label,
              }))}
              onChange={(v) => setShape(v === '1' ? 1 : 0)}
              ariaLabel="Shape"
            />
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
