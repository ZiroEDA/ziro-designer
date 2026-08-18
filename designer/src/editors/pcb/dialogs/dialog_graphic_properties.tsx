// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text and Shape properties for board graphics. Counterparts:
 * `pcbnew/dialogs/dialog_text_properties.cpp` and
 * `pcbnew/dialogs/dialog_shape_properties.cpp`.
 *
 * Two dialogs in one file because they are the same item to the board — a
 * graphic on a layer with a stroke and a lock — and share every control except
 * the middle.
 *
 * Upstream's shape dialog offers several geometry *entry modes* (By Endpoints,
 * By Center/Radius, By Length and Angle, …). Only the direct one is here: the
 * others are alternative ways to type the same two points, and the point editor
 * already covers dragging them.
 *
 * The decision logic lives in `pcbnew/src/graphic_properties.ts`.
 */

import { useState, type JSX } from 'react';
import { pcbIuToMM, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import type { ShapeValues, TextValues } from '@ziroeda/pcbnew/src/graphic_properties.js';
import { shapePointsUsed } from '@ziroeda/pcbnew/src/graphic_properties.js';
import type { PcbShape } from '@ziroeda/pcbnew/src/types.js';
import { LINE_STYLE_NAMES, lineStyleComboValue } from '@ziroeda/common/src/stroke_params.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

/** A millimetre text box bound to an IU value. */
function useMmText(): [Record<string, string>, (k: string, s: string) => void] {
  const [text, setText] = useState<Record<string, string>>({});
  return [text, (k, s) => setText((p) => ({ ...p, [k]: s }))];
}

interface TextProps {
  initial: TextValues;
  layers: readonly string[];
  onApply: (v: TextValues) => void;
  onClose: () => void;
}

export function DialogTextProperties({
  initial,
  layers,
  onApply,
  onClose,
}: TextProps): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [v, setV] = useState<TextValues>(initial);
  const [text, setText] = useMmText();
  const set = (patch: Partial<TextValues>): void => setV((p) => ({ ...p, ...patch }));

  const mmField = (
    label: string,
    key: 'x' | 'y' | 'width' | 'height' | 'thickness',
  ): JSX.Element => (
    <label>
      <span className="ze-tvp-label">{label}</span>
      <input
        type="text"
        className="ze-tvp-input"
        value={text[key] ?? String(pcbIuToMM(v[key]))}
        onChange={(e) => {
          setText(key, e.target.value);
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set({ [key]: pcbMmToIU(n) } as Partial<TextValues>);
        }}
      />
      <span className="ze-tvp-unit">mm</span>
    </label>
  );

  const check = (
    label: string,
    key: 'bold' | 'italic' | 'mirrored' | 'hidden' | 'knockout' | 'locked',
    title?: string,
  ): JSX.Element => (
    <label title={title}>
      <input
        type="checkbox"
        checked={v[key]}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<TextValues>)}
      />
      {label}
    </label>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-graphic-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Text Properties
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-update-pcb-body ze-tvp-body">
          <fieldset>
            <legend>Text</legend>
            <label>
              <span className="ze-tvp-label">Text:</span>
              <input
                type="text"
                className="ze-tvp-select"
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
            {check('Knockout', 'knockout', 'Cut the glyphs out of a filled box.')}
            {check('Show', 'hidden')}
            {check('Locked', 'locked')}
          </fieldset>

          <fieldset>
            <legend>Font</legend>
            <div className="ze-tvp-row">
              {mmField('Width:', 'width')}
              {mmField('Height:', 'height')}
            </div>
            {mmField('Thickness:', 'thickness')}
            {check('Bold', 'bold')}
            {check('Italic', 'italic')}
            {check('Mirrored', 'mirrored')}
          </fieldset>

          <fieldset>
            <legend>Position</legend>
            <div className="ze-tvp-row">
              {mmField('Position X:', 'x')}
              {mmField('Y:', 'y')}
            </div>
            <label>
              <span className="ze-tvp-label">Orientation:</span>
              <input
                type="text"
                className="ze-tvp-input"
                value={text.orientation ?? String(v.orientation)}
                onChange={(e) => {
                  setText('orientation', e.target.value);
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) set({ orientation: n });
                }}
              />
              <span className="ze-tvp-unit">deg</span>
            </label>
          </fieldset>
        </div>

        <div className="ze-modal-footer">
          <span style={{ flex: 1 }} />
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

interface ShapeProps {
  initial: ShapeValues;
  kind: PcbShape['kind'];
  layers: readonly string[];
  onApply: (v: ShapeValues) => void;
  onClose: () => void;
}

export function DialogShapeProperties({
  initial,
  kind,
  layers,
  onApply,
  onClose,
}: ShapeProps): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  // A stroke with no style of its own selects Solid, since the combo cannot
  // express DEFAULT (dialog_shape_properties.cpp:1129-1132, `else SetSelection( 0 )`).
  const [v, setV] = useState<ShapeValues>({
    ...initial,
    strokeType: lineStyleComboValue(initial.strokeType),
  });
  const [text, setText] = useMmText();
  const set = (patch: Partial<ShapeValues>): void => setV((p) => ({ ...p, ...patch }));

  const used = shapePointsUsed(kind);

  /** One coordinate of one of the shape's points. */
  const ptField = (
    label: string,
    key: 'start' | 'end' | 'mid' | 'center',
    axis: 'x' | 'y',
  ): JSX.Element => {
    const id = `${key}.${axis}`;
    return (
      <label>
        <span className="ze-tvp-label">{label}</span>
        <input
          type="text"
          className="ze-tvp-input"
          value={text[id] ?? String(pcbIuToMM(v[key][axis]))}
          onChange={(e) => {
            setText(id, e.target.value);
            const n = Number(e.target.value);
            if (Number.isFinite(n)) set({ [key]: { ...v[key], [axis]: pcbMmToIU(n) } });
          }}
        />
        <span className="ze-tvp-unit">mm</span>
      </label>
    );
  };

  const point = (label: string, key: 'start' | 'end' | 'mid' | 'center'): JSX.Element => (
    <div className="ze-tvp-row">
      {ptField(`${label} X:`, key, 'x')}
      {ptField('Y:', key, 'y')}
    </div>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-graphic-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Shape Properties
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-update-pcb-body ze-tvp-body">
          <fieldset>
            <legend>Geometry</legend>
            {used.center && point('Center', 'center')}
            {used.start && point('Start', 'start')}
            {used.mid && point('Mid', 'mid')}
            {used.end && point(kind === 'circle' ? 'Radius point' : 'End', 'end')}
            {!used.start && !used.end && !used.center && (
              <div className="ze-tvp-note" style={{ marginLeft: 0 }}>
                A polygon's corners are edited on the canvas, not here.
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend>Stroke &amp; Fill</legend>
            <label>
              <span className="ze-tvp-label">Line width:</span>
              <input
                type="text"
                className="ze-tvp-input"
                value={text.lineWidth ?? String(pcbIuToMM(v.lineWidth))}
                onChange={(e) => {
                  setText('lineWidth', e.target.value);
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) set({ lineWidth: pcbMmToIU(n) });
                }}
              />
              <span className="ze-tvp-unit">mm</span>
            </label>
            <label>
              <span className="ze-tvp-label">Line style:</span>
              <select
                className="ze-tvp-select"
                value={v.strokeType}
                onChange={(e) => set({ strokeType: e.target.value as ShapeValues['strokeType'] })}
              >
                {/* lineTypeNames — pcbnew/dialogs/dialog_shape_properties.cpp:1024.
                    Five entries; the board's shape dialog has no "Default". */}
                {LINE_STYLE_NAMES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={v.filled}
                onChange={(e) => set({ filled: e.target.checked })}
              />
              Filled
            </label>
          </fieldset>

          <fieldset>
            <legend>Layer</legend>
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
            <div className="ze-tvp-sub">Technical Layers</div>
            <label>
              <input
                type="checkbox"
                checked={v.hasMask}
                onChange={(e) => set({ hasMask: e.target.checked })}
              />
              Solder mask
            </label>
            <label
              className={v.hasMask ? '' : 'disabled'}
              title="Local clearance between the shape and the solder mask opening. Leave blank to use the Board Setup value."
            >
              <span className="ze-tvp-label">Expansion:</span>
              <input
                type="text"
                className="ze-tvp-input"
                placeholder="—"
                disabled={!v.hasMask}
                value={
                  text.maskMargin ?? (v.maskMargin === null ? '' : String(pcbIuToMM(v.maskMargin)))
                }
                onChange={(e) => {
                  const s = e.target.value;
                  setText('maskMargin', s);
                  if (s.trim() === '') {
                    set({ maskMargin: null });
                    return;
                  }
                  const n = Number(s);
                  if (Number.isFinite(n)) set({ maskMargin: pcbMmToIU(n) });
                }}
              />
              <span className="ze-tvp-unit">mm</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={v.locked}
                onChange={(e) => set({ locked: e.target.checked })}
              />
              Locked
            </label>
          </fieldset>
        </div>

        <div className="ze-modal-footer">
          <span style={{ flex: 1 }} />
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
