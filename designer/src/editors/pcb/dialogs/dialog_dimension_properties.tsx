// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Dimension properties.
 * Counterpart: `pcbnew/dialogs/dialog_dimension_properties.cpp`.
 *
 * Which groups appear depends on the kind — `dimensionDialogFields` holds those
 * rules and the reasoning behind them, and this file only reads them. The
 * collect/apply decisions live in `pcbnew/src/dimension_properties.ts`.
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

import { useState, type JSX } from 'react';
import { pcbIuToMM, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import type { DimensionValues } from '@ziroeda/pcbnew/src/dimension_properties.js';
import type { DimensionKind } from '@ziroeda/pcbnew/src/types.js';
import { dimensionDialogFields } from '../dimension_tools.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

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
  initial: DimensionValues;
  kind: DimensionKind;
  layers: readonly string[];
  onApply: (v: DimensionValues) => void;
  onClose: () => void;
}

export function DialogDimensionProperties({
  initial,
  kind,
  layers,
  onApply,
  onClose,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [v, setV] = useState<DimensionValues>(initial);
  const [text, setText] = useState<Record<string, string>>({});
  const set = (patch: Partial<DimensionValues>): void => setV((p) => ({ ...p, ...patch }));
  const show = dimensionDialogFields(kind);

  const mmField = (label: string, key: MmKey, disabled = false): JSX.Element => (
    <label>
      <span className="ze-tvp-label">{label}</span>
      <input
        type="text"
        className="ze-tvp-input"
        disabled={disabled}
        value={text[key] ?? String(pcbIuToMM(v[key]))}
        onChange={(e) => {
          setText((p) => ({ ...p, [key]: e.target.value }));
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set({ [key]: pcbMmToIU(n) } as Partial<DimensionValues>);
        }}
      />
      <span className="ze-tvp-unit">mm</span>
    </label>
  );

  const choice = (
    label: string,
    key: 'units' | 'unitsFormat' | 'precision' | 'textPositionMode' | 'textFrame',
    options: readonly string[],
  ): JSX.Element => (
    <label>
      <span className="ze-tvp-label">{label}</span>
      <select
        className="ze-tvp-select"
        value={String(v[key])}
        onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<DimensionValues>)}
      >
        {options.map((o, i) => (
          <option key={o} value={String(i)}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );

  const check = (
    label: string,
    key: 'suppressZeroes' | 'keepTextAligned' | 'bold' | 'italic' | 'mirrored' | 'locked',
  ): JSX.Element => (
    <label>
      <input
        type="checkbox"
        checked={v[key]}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<DimensionValues>)}
      />
      {label}
    </label>
  );

  const manual = v.textPositionMode === 2;

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-graphic-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Dimension Properties
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-update-pcb-body ze-tvp-body">
          <fieldset>
            <legend>Dimension</legend>
            <label>
              <span className="ze-tvp-label">Layer:</span>
              <select
                className="ze-tvp-select"
                value={v.layer}
                onChange={(e) => set({ layer: e.target.value })}
              >
                {layers.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {check('Locked', 'locked')}
          </fieldset>

          {show.format && (
            <fieldset>
              <legend>Format</legend>
              {/* The checkbox is the mode; the box alone cannot tell an empty
                  override from an absent one. */}
              <label title="Show this text instead of the measured value.">
                <input
                  type="checkbox"
                  checked={v.overrideValue !== undefined}
                  onChange={(e) => set({ overrideValue: e.target.checked ? '' : undefined })}
                />
                Override value
              </label>
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
              {show.textPositionMode &&
                choice('Position mode:', 'textPositionMode', POSITION_MODES)}
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
                <select
                  className="ze-tvp-select"
                  value={v.arrowDirection}
                  onChange={(e) =>
                    set({ arrowDirection: e.target.value === 'inward' ? 'inward' : 'outward' })
                  }
                >
                  <option value="inward">Inward</option>
                  <option value="outward">Outward</option>
                </select>
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
      </div>
    </div>
  );
}
