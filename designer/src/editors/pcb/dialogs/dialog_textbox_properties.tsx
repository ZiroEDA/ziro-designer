// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text box properties.
 * Counterpart: `pcbnew/dialogs/dialog_textbox_properties.cpp`.
 *
 * The decisions live in `pcbnew/src/textbox_properties.ts`; this is layout.
 *
 * Two controls are worth a note:
 *
 * - **Border** is a mode, not a visibility toggle. `border no` means text with
 *   invisible margins, and the width and style stay editable so they survive
 *   being switched off and on again.
 * - **Justification** is two independent axes plus mirroring, all sharing one
 *   `(justify …)` token in the file. They are three controls here because they
 *   are three settings; the engine rebuilds the token from all three.
 *
 * Left out: font selection (we draw the stroke font only) and KiCad's
 * auto-thickness checkbox, which needs the font metrics we do not have.
 */

import { useState, type JSX } from 'react';
import { pcbIuToMM, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import type {
  HorizJustify,
  TextBoxValues,
  VertJustify,
} from '@ziroeda/pcbnew/src/textbox_properties.js';
import type { StrokeType } from '@ziroeda/pcbnew/src/types.js';

const STROKE_STYLES: StrokeType[] = ['solid', 'dash', 'dot', 'dash_dot', 'dash_dot_dot'];
const H_JUSTIFY: HorizJustify[] = ['left', 'center', 'right'];
const V_JUSTIFY: VertJustify[] = ['top', 'center', 'bottom'];

type MmKey =
  | 'width'
  | 'height'
  | 'thickness'
  | 'borderWidth'
  | 'marginLeft'
  | 'marginTop'
  | 'marginRight'
  | 'marginBottom';

interface Props {
  initial: TextBoxValues;
  layers: readonly string[];
  /** "OK" reads "Create" when the box is being placed rather than edited. */
  placing?: boolean;
  onApply: (v: TextBoxValues) => void;
  onClose: () => void;
}

export function DialogTextBoxProperties({
  initial,
  layers,
  placing = false,
  onApply,
  onClose,
}: Props): JSX.Element {
  const [v, setV] = useState<TextBoxValues>(initial);
  const [text, setText] = useState<Record<string, string>>({});
  const set = (patch: Partial<TextBoxValues>): void => setV((p) => ({ ...p, ...patch }));

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
          if (Number.isFinite(n)) set({ [key]: pcbMmToIU(n) } as Partial<TextBoxValues>);
        }}
      />
      <span className="ze-tvp-unit">mm</span>
    </label>
  );

  const check = (
    label: string,
    key: 'bold' | 'italic' | 'mirrored' | 'knockout' | 'locked' | 'border',
  ): JSX.Element => (
    <label>
      <input
        type="checkbox"
        checked={v[key]}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<TextBoxValues>)}
      />
      {label}
    </label>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-graphic-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Text Box Properties
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-update-pcb-body ze-tvp-body">
          <fieldset>
            <legend>Text</legend>
            <label>
              <span className="ze-tvp-label">Text:</span>
              <textarea
                className="ze-tvp-select"
                rows={3}
                value={v.text}
                onChange={(e) => set({ text: e.target.value })}
              />
            </label>
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
            {check('Knockout', 'knockout')}
          </fieldset>

          <fieldset>
            <legend>Font</legend>
            <div className="ze-tvp-row">
              {mmField('Width:', 'width')}
              {mmField('Height:', 'height')}
            </div>
            {mmField('Thickness:', 'thickness')}
            <label>
              <span className="ze-tvp-label">Orientation:</span>
              <input
                type="text"
                className="ze-tvp-input"
                value={String(v.orientation)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) set({ orientation: n });
                }}
              />
              <span className="ze-tvp-unit">°</span>
            </label>
            {check('Bold', 'bold')}
            {check('Italic', 'italic')}
            {check('Mirrored', 'mirrored')}
          </fieldset>

          <fieldset>
            <legend>Alignment</legend>
            {/* Two axes, one `(justify …)` token — the engine rebuilds it. */}
            <label>
              <span className="ze-tvp-label">Horizontal:</span>
              <select
                className="ze-tvp-select"
                value={v.horizJustify}
                onChange={(e) => set({ horizJustify: e.target.value as HorizJustify })}
              >
                {H_JUSTIFY.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="ze-tvp-label">Vertical:</span>
              <select
                className="ze-tvp-select"
                value={v.vertJustify}
                onChange={(e) => set({ vertJustify: e.target.value as VertJustify })}
              >
                {V_JUSTIFY.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
            </label>
            <div className="ze-tvp-row">
              {mmField('Margin left:', 'marginLeft')}
              {mmField('Margin top:', 'marginTop')}
            </div>
            <div className="ze-tvp-row">
              {mmField('Margin right:', 'marginRight')}
              {mmField('Margin bottom:', 'marginBottom')}
            </div>
          </fieldset>

          <fieldset>
            <legend>Border</legend>
            {check('Draw a border', 'border')}
            {/* Kept editable while off, so the width survives a toggle. */}
            {mmField('Border width:', 'borderWidth')}
            <label>
              <span className="ze-tvp-label">Border style:</span>
              <select
                className="ze-tvp-select"
                value={v.borderStyle}
                onChange={(e) => set({ borderStyle: e.target.value as StrokeType })}
              >
                {STROKE_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        </div>

        <div className="ze-modal-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onApply(v)}>
            {placing ? 'Create' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
