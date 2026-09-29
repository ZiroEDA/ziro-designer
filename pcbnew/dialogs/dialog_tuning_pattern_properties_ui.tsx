// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Length Tuning Settings. Counterpart:
 * `pcbnew/dialogs/dialog_tuning_pattern_properties_base.cpp`.
 *
 * The layout is one `singleTrackSizer` (horizontal): the mode legend bitmap
 * on the left, then a `wxGridBagSizer(4, 4)` of 7 columns (0-6) by 10 rows
 * (0-9). Column 3 and rows 3/4/7 hold nothing — `SetEmptyCellSize(10, 8)`
 * is what keeps that gap from collapsing to zero, which is why it is its own
 * grid track below rather than a bigger gap on its neighbours.
 *
 * All the decision logic is `dialog_tuning_pattern_properties.ts`: which
 * sentinel a blank field means, the skew-mode quirk in the constraint-match
 * branch, and the four controls' enabled state. This file is the widgets.
 */

import { useState, type JSX } from 'react';
import {
  NULL_TUNING_CONSTRAINT,
  initialTuningPatternValues,
  tuningPatternEnableState,
  tuningPatternOverrideToggled,
  tuningPatternRadioDelaySelected,
  tuningPatternRadioLengthSelected,
  tuningPatternSourceInfoText,
  tuningPatternTransferFromWindow,
  type TuningConstraintInput,
  type TuningPatternFormValues,
  type TuningPatternMode,
} from './dialog_tuning_pattern_properties.js';
import { MeanderStyle, type MeanderSettings } from '../router/pns_meander.js';
import { PnsRouterMode } from '../router/pns_router.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { pcbUnitText, unitLabel } from '../pcb_unit_binder.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';

interface Props {
  units: StatusUnits;
  settings: MeanderSettings;
  mode: TuningPatternMode;
  /** `DIALOG_TUNING_PATTERN_PROPERTIES( aFrame, aSettings, aMeanderType, aConstraint )`. */
  constraint?: TuningConstraintInput;
  onOk: (next: MeanderSettings) => void;
  onClose: () => void;
}

/** `m_cornerCtrlChoices` (`_base.cpp:118`), in its own order. */
const CORNER_STYLES: { value: MeanderStyle; label: string }[] = [
  { value: MeanderStyle.MEANDER_STYLE_CHAMFER, label: 'Chamfer' },
  { value: MeanderStyle.MEANDER_STYLE_ROUND, label: 'Fillet' },
];

/** `m_targetLengthLabel`/`m_targetDelayLabel` swap text in skew mode. */
function labels(mode: TuningPatternMode): { length: string; delay: string; title: string } {
  if (mode === PnsRouterMode.PNS_MODE_TUNE_DIFF_PAIR_SKEW) {
    return {
      length: 'Target Skew:',
      delay: 'Target Skew Delay:',
      title: 'Tuning Pattern Properties',
    };
  }
  return { length: 'Target Length:', delay: 'Target Delay:', title: 'Tuning Pattern Properties' };
}

export function DialogTuningPatternProperties({
  units,
  settings,
  mode,
  constraint = NULL_TUNING_CONSTRAINT,
  onOk,
  onClose,
}: Props): JSX.Element {
  useModalEscape(onClose);

  const [v, setV] = useState<TuningPatternFormValues>(() =>
    initialTuningPatternValues(settings, mode, units),
  );

  const enable = tuningPatternEnableState(v, constraint);
  const label = labels(mode);
  const set = (patch: Partial<TuningPatternFormValues>): void =>
    setV((prev) => ({ ...prev, ...patch }));

  const accept = (): void => {
    onOk(
      tuningPatternTransferFromWindow(
        v,
        mode,
        enable.radioLengthEnabled,
        settings,
        constraint,
        units,
      ),
    );
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-tuning-pattern-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {label.title}
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-tuning-pattern-body">
          {/* m_legend: a static bitmap re-set per mode; the browser has no
              per-mode bundled bitmap asset, so the swatch stands in for it. */}
          <div className={`ze-tuning-pattern-legend ze-tuning-pattern-legend-${mode}`} />

          <div className="ze-tuning-pattern-grid">
            <label className="ze-tp-cell ze-tp-r0c0">
              <input
                type="radio"
                name="ze-tp-domain"
                checked={v.lengthSelected}
                disabled={!enable.radioLengthEnabled}
                onChange={() => set(tuningPatternRadioLengthSelected(v))}
              />
              {label.length}
            </label>
            <input
              className="ze-tp-cell ze-tp-r0c1"
              type="text"
              value={v.targetLengthText}
              disabled={!enable.targetLengthEnabled}
              onChange={(e) => set({ targetLengthText: e.target.value })}
            />
            <span className="ze-tp-cell ze-tp-r0c2 ze-unit-label">{unitLabel(units)}</span>

            <label className="ze-tp-cell ze-tp-r1c0">
              <input
                type="radio"
                name="ze-tp-domain"
                checked={!v.lengthSelected}
                disabled={!enable.radioDelayEnabled}
                onChange={() => set(tuningPatternRadioDelaySelected(v))}
              />
              {label.delay}
            </label>
            <input
              className="ze-tp-cell ze-tp-r1c1"
              type="text"
              value={v.targetDelayText}
              disabled={!enable.targetDelayEnabled}
              onChange={(e) => set({ targetDelayText: e.target.value })}
            />
            <span className="ze-tp-cell ze-tp-r1c2 ze-unit-label">ps</span>

            <label className="ze-tp-cell ze-tp-r0c4">
              <input
                type="checkbox"
                checked={v.overrideCustomRules}
                onChange={(e) =>
                  set(tuningPatternOverrideToggled(v, e.target.checked, constraint, units))
                }
              />
              Override custom rules
            </label>

            {enable.sourceInfoVisible && (
              <span className="ze-tp-cell ze-tp-r2c1">
                {tuningPatternSourceInfoText(constraint)}
              </span>
            )}

            <span className="ze-tp-cell ze-tp-r5c0">Minimum amplitude (A):</span>
            <input
              className="ze-tp-cell ze-tp-r5c1"
              type="text"
              value={pcbUnitText(v.minAmplitude, units)}
              onChange={(e) => set({ minAmplitude: Number(e.target.value) || 0 })}
            />
            <span className="ze-tp-cell ze-tp-r5c2 ze-unit-label">{unitLabel(units)}</span>
            <span className="ze-tp-cell ze-tp-r5c4">Maximum amplitude (A):</span>
            <input
              className="ze-tp-cell ze-tp-r5c5"
              type="text"
              value={pcbUnitText(v.maxAmplitude, units)}
              onChange={(e) => set({ maxAmplitude: Number(e.target.value) || 0 })}
            />
            <span className="ze-tp-cell ze-tp-r5c6 ze-unit-label">{unitLabel(units)}</span>

            <span className="ze-tp-cell ze-tp-r6c0">Spacing (s):</span>
            <input
              className="ze-tp-cell ze-tp-r6c1"
              type="text"
              title="Minimum spacing between adjacent tuning segments. The resulting spacing may be greater based on design rules."
              value={pcbUnitText(v.spacing, units)}
              onChange={(e) => set({ spacing: Number(e.target.value) || 0 })}
            />
            <span className="ze-tp-cell ze-tp-r6c2 ze-unit-label">{unitLabel(units)}</span>

            <span className="ze-tp-cell ze-tp-r8c0">Corner style:</span>
            <div className="ze-tp-cell ze-tp-r8c1">
              <Combo
                value={String(v.cornerStyle)}
                options={CORNER_STYLES.map((c) => ({ value: String(c.value), label: c.label }))}
                onChange={(value) => set({ cornerStyle: Number(value) as MeanderStyle })}
              />
            </div>
            <span className="ze-tp-cell ze-tp-r8c4">Radius (r):</span>
            <input
              className="ze-tp-cell ze-tp-r8c5"
              type="text"
              value={String(v.cornerRadiusPercentage)}
              onChange={(e) => set({ cornerRadiusPercentage: Number(e.target.value) || 0 })}
            />
            <span className="ze-tp-cell ze-tp-r8c6 ze-unit-label">%</span>

            <label className="ze-tp-cell ze-tp-r9c1">
              <input
                type="checkbox"
                checked={v.singleSided}
                onChange={(e) => set({ singleSided: e.target.checked })}
              />
              Single-sided
            </label>
          </div>
        </div>

        {/* m_stdButtons: wxStdDialogButtonSizer, GTK order Cancel then OK. */}
        <div className="ze-modal-footer">
          <button type="button" className="ze-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ze-btn primary" onClick={accept}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
