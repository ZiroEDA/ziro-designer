// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Shape properties: border and fill of a rectangle, circle, arc or polyline.
 * Counterpart: `eeschema/dialogs/dialog_shape_properties.cpp`
 * (DIALOG_SHAPE_PROPERTIES), in its schematic-editor form.
 *
 * The symbol-editor form of this dialog has more in it (private, apply to all
 * units / body styles, and fill-with-body-colour radio buttons). In a schematic
 * a shape has no parent symbol and no body colour, so upstream shows a plain
 * fill combo and a colour swatch instead, which is what this is.
 *
 * "Border" is a checkbox rather than a width of zero: unchecking it stores a
 * width of -1, KiCad's "no border at all", which is distinct from 0 meaning
 * "use the schematic default width".
 */
import { useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common';
import type { ItemColor } from './dialog_line_properties.js';
import {
  LINE_STYLE_NAMES,
  lineStyleComboValue,
  type LineStyleToken,
} from '@ziroeda/common/src/stroke_params.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

/**
 * UI_FILL_MODE (include/eda_shape.h) in its declared order, which is the
 * combo's order. The stored `(fill (type …))` token for each is what
 * SetFillModeProp maps it to.
 */
const FILL_MODES: { value: string; label: string }[] = [
  { value: 'none', label: 'Do not fill' },
  { value: 'color', label: 'Fill with:' },
  { value: 'hatch', label: 'Hatch' },
  { value: 'reverse_hatch', label: 'Reverse hatch' },
  { value: 'cross_hatch', label: 'Cross-hatch' },
];

export interface ShapePropsResult {
  /** false = no border at all (KiCad stores width -1). */
  border: boolean;
  borderWidthIU: number;
  borderStyle: string;
  borderColor?: ItemColor;
  fillType: string;
  fillColor?: ItemColor;
}

interface Props {
  /** Shown in the title, as upstream names the dialog after the shape. */
  shapeName: string;
  initial: ShapePropsResult;
  onOk: (r: ShapePropsResult) => void;
  onCancel: () => void;
}

const toHex = (c: ItemColor): string =>
  `#${[c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): ItemColor => [
  Number.parseInt(h.slice(1, 3), 16),
  Number.parseInt(h.slice(3, 5), 16),
  Number.parseInt(h.slice(5, 7), 16),
  1,
];

export function DialogShapeProperties({ shapeName, initial, onOk, onCancel }: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [border, setBorder] = useState(initial.border);
  const [width, setWidth] = useState(
    initial.borderWidthIU <= 0 ? '0' : String(iuToMM(initial.borderWidthIU)),
  );
  // DIALOG_SHAPE_PROPERTIES fills the combo from `lineTypeNames` alone, so it
  // cannot say DEFAULT; a shape that has no style of its own shows Solid
  // (dialog_shape_properties.cpp:147) and is written back as solid.
  const [style, setStyle] = useState(lineStyleComboValue(initial.borderStyle));
  const [borderColor, setBorderColor] = useState(initial.borderColor);
  const [fillType, setFillType] = useState(initial.fillType);
  const [fillColor, setFillColor] = useState(initial.fillColor);

  const filled = fillType !== 'none';

  const submit = (): void =>
    onOk({
      border,
      borderWidthIU: border ? mmToIU(Number(width) || 0) : -1,
      borderStyle: style,
      ...(borderColor ? { borderColor } : {}),
      fillType,
      ...(filled && fillColor ? { fillColor } : {}),
    });

  const swatch = (
    value: ItemColor | undefined,
    set: (c: ItemColor | undefined) => void,
    enabled: boolean,
  ): JSX.Element => (
    <>
      <input
        type="color"
        disabled={!enabled}
        value={value ? toHex(value) : '#000000'}
        onChange={(e) => set(fromHex(e.target.value))}
        style={{ width: 44, height: 24, padding: 0, border: 'none', background: 'none' }}
      />
      <button
        className="ze-btn"
        style={{ fontSize: 11 }}
        title="Clear colors to use Schematic Editor colors."
        disabled={!enabled || !value}
        onClick={() => set(undefined)}
      >
        Clear
      </button>
    </>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {shapeName} Properties
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div
          className="ze-label-dialog-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <label className="row">
            <input type="checkbox" checked={border} onChange={(e) => setBorder(e.target.checked)} />
            <span>Border</span>
          </label>
          <label className="row">
            <span>Width:</span>
            <input
              className="ze-search"
              style={{ width: 90 }}
              disabled={!border}
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span className="ze-muted">mm</span>
          </label>
          <label className="row">
            <span>Style:</span>
            <select
              className="ze-select"
              disabled={!border}
              value={style}
              onChange={(e) => setStyle(e.target.value as LineStyleToken)}
            >
              {LINE_STYLE_NAMES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="row">
            <span>Color:</span>
            {swatch(borderColor, setBorderColor, border)}
          </label>

          <label className="row">
            <span>Fill:</span>
            <select
              className="ze-select"
              value={fillType}
              onChange={(e) => setFillType(e.target.value)}
            >
              {FILL_MODES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="row">
            {/* The colour label and swatch are disabled with the fill itself
                (onFillChoice), since there is nothing for a colour to apply to. */}
            <span>Fill color:</span>
            {swatch(fillColor, setFillColor, filled)}
          </label>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
