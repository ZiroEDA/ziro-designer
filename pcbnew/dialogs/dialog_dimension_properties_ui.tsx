// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Dimension properties.
 * Counterpart: `pcbnew/dialogs/dialog_dimension_properties.cpp`.
 *
 * Which groups appear depends on the kind — `dimensionDialogFields` holds those
 * rules and the reasoning behind them, and this file only reads them. The
 * collect/apply decisions live in `pcbnew/dialogs/dialog_dimension_properties.ts`.
 *
 * Two controls are worth explaining here:
 *
 * - **Value** is the override text, and it is a *mode*: empty-but-set is not
 *   the same as unset. The checkbox is what distinguishes them, because a text
 *   box alone cannot — clearing it would otherwise be indistinguishable from
 *   never having typed anything, and the dimension would silently go back to
 *   showing its measurement.
 * - **Position** is only editable in Manual mode; in the other two the geometry
 *   places the text, so the boxes would be lying about who is in charge.
 *
 * Left out: KiCad's cross-references (`${REF:FIELD}` in the prefix/suffix, which
 * needs the board-level KIID resolver), font selection, and the driving/driven
 * value modes from the newer constraint system.
 */

import { CheckBox, Combo } from '@ziroeda/common/wx/controls.js';
import { useState, type JSX } from 'react';
import { pcbIuToMM, pcbMmToIU } from '@ziroeda/common/eda_units.js';
import type { DimensionValues } from './dialog_dimension_properties.js';
import type { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { dimensionDialogFields } from './dialog_dimension_properties.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';

const UNITS = ['Inches', 'Mils', 'Millimeters', 'Automatic'];
const FORMATS = ['1234', '1234 mm', '1234 (mm)'];
const PRECISIONS = ['0', '0.0', '0.00', '0.000', '0.0000', '0.00000'];
const POSITION_MODES = ['Outside', 'Inline', 'Manual'];
const TEXT_FRAMES = ['None', 'Rectangle', 'Circle', 'Rounded rectangle'];

type MmKey =
  | 'lineThickness'
  | 'arrowLength'
  | 'extensionOffset'
  | 'extensionOvershoot'
  | 'textWidth'
  | 'textHeight'
  | 'textThickness'
  | 'textX'
  | 'textY';

interface Props {
  /**
   * The frame's display units. Every distance in this dialog is a
   * `UNIT_BINDER` upstream, so it shows and reads the frame's unit rather than
   * a fixed millimetre.
   */
  units: StatusUnits;
  initial: DimensionValues;
  /** `m_dimension->Type()`: which groups the dialog shows. */
  type: KICAD_T;
  layers: readonly string[];
  onApply: (v: DimensionValues) => void;
  onClose: () => void;
}

export function DialogDimensionProperties({
  initial,
  units,
  type,
  layers,
  onApply,
  onClose,
}: Props): JSX.Element {
  const [v, setV] = useState<DimensionValues>(initial);
  const [text, setText] = useState<Record<string, string>>({});
  const set = (patch: Partial<DimensionValues>): void => setV((p) => ({ ...p, ...patch }));
  const show = dimensionDialogFields(type);

  const mmField = (label: string, key: MmKey, disabled = false): JSX.Element => (
    <label>
      <span className="ze-tvp-label">{label}</span>
      <input
        type="text"
        className="ze-tvp-input"
        disabled={disabled}
        value={text[key] ?? pcbUnitText(v[key], units)}
        onChange={(e) => {
          setText((p) => ({ ...p, [key]: e.target.value }));
          const iu = pcbUnitValue(e.target.value, units);
          if (Number.isFinite(iu)) set({ [key]: iu } as Partial<DimensionValues>);
        }}
      />
      <span className="ze-unit-label">{unitLabel(units)}</span>
    </label>
  );

  const choice = (
    label: string,
    key: 'units' | 'unitsFormat' | 'precision' | 'textPositionMode' | 'textFrame',
    options: readonly string[],
  ): JSX.Element => (
    <label>
      <span className="ze-tvp-label">{label}</span>
      <Combo
        value={String(String(v[key]))}
        options={options.map((o, i) => ({ value: String(String(i)), label: o }))}
        className="ze-tvp-select"
        onChange={(aValue) => set({ [key]: Number(aValue) } as Partial<DimensionValues>)}
      />
    </label>
  );

  const check = (
    label: string,
    key: 'suppressZeroes' | 'keepTextAligned' | 'bold' | 'italic' | 'mirrored' | 'locked',
  ): JSX.Element => (
    <CheckBox
      label={label}
      checked={v[key]}
      onChange={(aChecked) => set({ [key]: aChecked } as Partial<DimensionValues>)}
    />
  );

  const manual = v.textPositionMode === 2;

  return (
    <DialogShim title="Dimension Properties" onClose={onClose} className="ze-graphic-dialog">
      <div className="ze-modal-body ze-update-pcb-body ze-tvp-body">
        <fieldset>
          <legend>Dimension</legend>
          <label>
            <span className="ze-tvp-label">Layer:</span>
            <Combo
              value={String(v.layer)}
              options={layers.map((l) => ({ value: String(l), label: l }))}
              className="ze-tvp-select"
              onChange={(aValue) => set({ layer: aValue })}
            />
          </label>
        </fieldset>

        {show.format && (
          <fieldset>
            <legend>Format</legend>
            {/* The checkbox is the mode; the box alone cannot tell an empty
              override from an absent one. */}
            <CheckBox
              label="Override value"
              checked={v.overrideValue !== undefined}
              title="Show this text instead of the measured value."
              onChange={(aChecked) => set({ overrideValue: aChecked ? '' : undefined })}
            />
            <label>
              <span className="ze-tvp-label">Value:</span>
              <input
                type="text"
                className="ze-tvp-select"
                disabled={v.overrideValue === undefined}
                value={v.overrideValue ?? ''}
                onChange={(e) => set({ overrideValue: e.target.value })}
              />
            </label>
            <div className="ze-tvp-row">
              <label>
                <span className="ze-tvp-label">Prefix:</span>
                <input
                  type="text"
                  className="ze-tvp-input"
                  value={v.prefix}
                  onChange={(e) => set({ prefix: e.target.value })}
                />
              </label>
              <label>
                <span className="ze-tvp-label">Suffix:</span>
                <input
                  type="text"
                  className="ze-tvp-input"
                  value={v.suffix}
                  onChange={(e) => set({ suffix: e.target.value })}
                />
              </label>
            </div>
            {choice('Units:', 'units', UNITS)}
            {choice('Units format:', 'unitsFormat', FORMATS)}
            {choice('Precision:', 'precision', PRECISIONS)}
            {check('Suppress trailing zeroes', 'suppressZeroes')}
          </fieldset>
        )}

        {show.text && (
          <fieldset>
            <legend>Text</legend>
            <div className="ze-tvp-row">
              {mmField('Width:', 'textWidth')}
              {mmField('Height:', 'textHeight')}
            </div>
            {mmField('Thickness:', 'textThickness')}
            <label>
              <span className="ze-tvp-label">Orientation:</span>
              <input
                type="text"
                className="ze-tvp-input"
                value={String(v.textOrientation)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) set({ textOrientation: n });
                }}
              />
              <span className="ze-tvp-unit">°</span>
            </label>
            {check('Bold', 'bold')}
            {check('Italic', 'italic')}
            {check('Mirrored', 'mirrored')}
            {check('Keep aligned with dimension', 'keepTextAligned')}
            {show.textPositionMode && choice('Position mode:', 'textPositionMode', POSITION_MODES)}
            {/* Only Manual owns the position; otherwise the geometry places it. */}
            <div className="ze-tvp-row">
              {mmField('Position X:', 'textX', !manual)}
              {mmField('Position Y:', 'textY', !manual)}
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend>Dimension line</legend>
          {mmField('Line thickness:', 'lineThickness')}
          {show.arrowLength && mmField('Arrow length:', 'arrowLength')}
          {show.extensionOffset && mmField('Extension line offset:', 'extensionOffset')}
          {show.extensionOvershoot && mmField('Extension line overshoot:', 'extensionOvershoot')}
          {show.arrowDirection && (
            <label>
              <span className="ze-tvp-label">Arrow direction:</span>
              <Combo
                value={String(v.arrowDirection)}
                options={[
                  { value: String('inward'), label: 'Inward' },
                  { value: String('outward'), label: 'Outward' },
                ]}
                className="ze-tvp-select"
                onChange={(aValue) =>
                  set({ arrowDirection: aValue === 'inward' ? 'inward' : 'outward' })
                }
              />
            </label>
          )}
          {show.textFrame && choice('Text frame:', 'textFrame', TEXT_FRAMES)}
        </fieldset>
      </div>

      <div className="ze-modal-footer">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={() => onApply(v)}>
          OK
        </button>
      </div>
    </DialogShim>
  );
}
