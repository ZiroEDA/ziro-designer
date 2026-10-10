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

import { Button, CheckBox, RadioButton, TextCtrl } from '@ziroeda/common/wx/controls.js';
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
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
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
    <DialogShim title={label.title} onClose={onClose} className="ze-tuning-pattern-dialog">
      <div className="ze-modal-body ze-tuning-pattern-body">
        {/* m_legend: a static bitmap re-set per mode; the browser has no
          per-mode bundled bitmap asset, so the swatch stands in for it. */}
        <div className={`ze-tuning-pattern-legend ze-tuning-pattern-legend-${mode}`} />

        <div className="ze-tuning-pattern-grid">
          <RadioButton
            label={label.length}
            name="ze-tp-domain"
            checked={v.lengthSelected}
            disabled={!enable.radioLengthEnabled}
            className="ze-tp-cell ze-tp-r0c0"
            onChange={() => set(tuningPatternRadioLengthSelected(v))}
          />
          <TextCtrl
            value={v.targetLengthText}
            onChange={(aValue) => set({ targetLengthText: aValue })}
            disabled={!enable.targetLengthEnabled}
            className="ze-tp-cell ze-tp-r0c1"
          />
          <span className="ze-tp-cell ze-tp-r0c2 ze-unit-label">{unitLabel(units)}</span>

          <RadioButton
            label={label.delay}
            name="ze-tp-domain"
            checked={!v.lengthSelected}
            disabled={!enable.radioDelayEnabled}
            className="ze-tp-cell ze-tp-r1c0"
            onChange={() => set(tuningPatternRadioDelaySelected(v))}
          />
          <TextCtrl
            value={v.targetDelayText}
            onChange={(aValue) => set({ targetDelayText: aValue })}
            disabled={!enable.targetDelayEnabled}
            className="ze-tp-cell ze-tp-r1c1"
          />
          <span className="ze-tp-cell ze-tp-r1c2 ze-unit-label">ps</span>

          <CheckBox
            label="Override custom rules"
            checked={v.overrideCustomRules}
            className="ze-tp-cell ze-tp-r0c4"
            onChange={(aChecked) =>
              set(tuningPatternOverrideToggled(v, aChecked, constraint, units))
            }
          />

          {enable.sourceInfoVisible && (
            <span className="ze-tp-cell ze-tp-r2c1">{tuningPatternSourceInfoText(constraint)}</span>
          )}

          <span className="ze-tp-cell ze-tp-r5c0">Minimum amplitude (A):</span>
          <TextCtrl
            value={pcbUnitText(v.minAmplitude, units)}
            onChange={(aValue) => set({ minAmplitude: Number(aValue) || 0 })}
            className="ze-tp-cell ze-tp-r5c1"
          />
          <span className="ze-tp-cell ze-tp-r5c2 ze-unit-label">{unitLabel(units)}</span>
          <span className="ze-tp-cell ze-tp-r5c4">Maximum amplitude (A):</span>
          <TextCtrl
            value={pcbUnitText(v.maxAmplitude, units)}
            onChange={(aValue) => set({ maxAmplitude: Number(aValue) || 0 })}
            className="ze-tp-cell ze-tp-r5c5"
          />
          <span className="ze-tp-cell ze-tp-r5c6 ze-unit-label">{unitLabel(units)}</span>

          <span className="ze-tp-cell ze-tp-r6c0">Spacing (s):</span>
          <TextCtrl
            value={pcbUnitText(v.spacing, units)}
            onChange={(aValue) => set({ spacing: Number(aValue) || 0 })}
            title="Minimum spacing between adjacent tuning segments. The resulting spacing may be greater based on design rules."
            className="ze-tp-cell ze-tp-r6c1"
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
          <TextCtrl
            value={String(v.cornerRadiusPercentage)}
            onChange={(aValue) => set({ cornerRadiusPercentage: Number(aValue) || 0 })}
            className="ze-tp-cell ze-tp-r8c5"
          />
          <span className="ze-tp-cell ze-tp-r8c6 ze-unit-label">%</span>

          <CheckBox
            label="Single-sided"
            checked={v.singleSided}
            className="ze-tp-cell ze-tp-r9c1"
            onChange={(aChecked) => set({ singleSided: aChecked })}
          />
        </div>
      </div>

      {/* m_stdButtons: wxStdDialogButtonSizer, GTK order Cancel then OK. */}
      <div className="ze-modal-footer">
        <Button label="Cancel" onClick={onClose} />
        <Button label="OK" isDefault onClick={accept} />
      </div>
    </DialogShim>
  );
}
