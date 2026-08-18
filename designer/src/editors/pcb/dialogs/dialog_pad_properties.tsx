// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Pad Properties, board side. Counterpart:
 * `pcbnew/dialogs/dialog_pad_properties.cpp` — a General page (number, net,
 * type, shape, geometry, hole, layers) and a "Clearance Overrides & Settings"
 * page.
 *
 * Not here, for want of a model: padstack modes (per-layer pad shapes), custom
 * pad primitives (the model carries them but does not edit them), and the
 * per-pad thermal spoke angle.
 *
 * The decision logic lives in `pcbnew/src/pad_properties.ts`.
 */

import { useState, type JSX } from 'react';
import { pcbIuToMM, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import type { PadValues } from '@ziroeda/pcbnew/src/pad_properties.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

interface Props {
  initial: PadValues;
  nets: ReadonlyMap<number, string>;
  /** Every layer name the pad may sit on. */
  layers: readonly string[];
  onApply: (values: PadValues) => void;
  onClose: () => void;
}

type Tab = 'general' | 'overrides';

/** Keys that hold an IU length and are always present. */
type LengthKey =
  | 'x'
  | 'y'
  | 'sizeX'
  | 'sizeY'
  | 'deltaX'
  | 'deltaY'
  | 'holeW'
  | 'holeH'
  | 'holeOffsetX'
  | 'holeOffsetY';
/** Keys that hold an IU length but may be blank (inherit). */
type OverrideKey =
  | 'localClearance'
  | 'localSolderMaskMargin'
  | 'localSolderPasteMargin'
  | 'thermalBridgeWidth'
  | 'thermalGap'
  | 'padToDieLength';

export function DialogPadProperties({
  initial,
  nets,
  layers,
  onApply,
  onClose,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [tab, setTab] = useState<Tab>('general');
  const [v, setV] = useState<PadValues>(initial);
  const [text, setText] = useState<Record<string, string>>({});

  const set = (patch: Partial<PadValues>): void => setV((p) => ({ ...p, ...patch }));

  const mmField = (label: string, key: LengthKey, disabled = false): JSX.Element => (
    <label className={disabled ? 'disabled' : ''}>
      <span className="ze-tvp-label">{label}</span>
      <input
        type="text"
        className="ze-tvp-input"
        value={text[key] ?? String(pcbIuToMM(v[key]))}
        disabled={disabled}
        onChange={(e) => {
          setText((p) => ({ ...p, [key]: e.target.value }));
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set({ [key]: pcbMmToIU(n) } as Partial<PadValues>);
        }}
      />
      <span className="ze-tvp-unit">mm</span>
    </label>
  );

  /** Blank means inherit; 0 is a real override. */
  const overrideField = (label: string, key: OverrideKey, title?: string): JSX.Element => {
    const stored = v[key];
    return (
      <label title={title}>
        <span className="ze-tvp-label">{label}</span>
        <input
          type="text"
          className="ze-tvp-input"
          placeholder="—"
          value={text[key] ?? (stored === null ? '' : String(pcbIuToMM(stored)))}
          onChange={(e) => {
            const s = e.target.value;
            setText((p) => ({ ...p, [key]: s }));
            if (s.trim() === '') {
              set({ [key]: null } as Partial<PadValues>);
              return;
            }
            const n = Number(s);
            if (Number.isFinite(n)) set({ [key]: pcbMmToIU(n) } as Partial<PadValues>);
          }}
        />
        <span className="ze-tvp-unit">mm</span>
      </label>
    );
  };

  const toggleLayer = (layer: string): void =>
    set({
      layers: v.layers.includes(layer) ? v.layers.filter((l) => l !== layer) : [...v.layers, layer],
    });

  const tabButton = (id: Tab, label: string): JSX.Element => (
    <button
      type="button"
      className={`ze-tab${tab === id ? ' active' : ''}`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );

  const isRoundRect = v.shape === 'roundrect';
  const isTrapezoid = v.shape === 'trapezoid';

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-padprops-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Pad Properties
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-tabbar ze-fpprops-tabs">
          {tabButton('general', 'General')}
          {tabButton('overrides', 'Clearance Overrides & Settings')}
        </div>

        <div className="ze-modal-body ze-update-pcb-body ze-tvp-body">
          {tab === 'general' ? (
            <>
              <fieldset>
                <legend>Pad</legend>
                <label>
                  <span className="ze-tvp-label">Pad number:</span>
                  <input
                    type="text"
                    className="ze-tvp-input"
                    value={v.number}
                    onChange={(e) => set({ number: e.target.value })}
                  />
                </label>
                <label>
                  <span className="ze-tvp-label">Net:</span>
                  <select
                    className="ze-tvp-select"
                    value={String(v.net)}
                    onChange={(e) => set({ net: Number(e.target.value) })}
                  >
                    {[...nets.entries()].map(([code, name]) => (
                      <option key={code} value={code}>
                        {name === '' ? '<no net>' : name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="ze-tvp-label">Pad type:</span>
                  <select
                    className="ze-tvp-select"
                    value={v.type}
                    onChange={(e) => {
                      const type = e.target.value as PadValues['type'];
                      // SMD pads have no hole; through-hole pads must have one.
                      set({
                        type,
                        hasHole: type === 'thru_hole' || type === 'np_thru_hole',
                      });
                    }}
                  >
                    <option value="thru_hole">Through-hole</option>
                    <option value="smd">SMD</option>
                    <option value="connect">Edge connector</option>
                    <option value="np_thru_hole">NPTH, mechanical</option>
                  </select>
                </label>
                <label>
                  <span className="ze-tvp-label">Pad shape:</span>
                  <select
                    className="ze-tvp-select"
                    value={v.shape}
                    onChange={(e) => set({ shape: e.target.value as PadValues['shape'] })}
                  >
                    <option value="circle">Circular</option>
                    <option value="oval">Oval</option>
                    <option value="rect">Rectangular</option>
                    <option value="trapezoid">Trapezoidal</option>
                    <option value="roundrect">Rounded rectangle</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>
              </fieldset>

              <fieldset>
                <legend>Position &amp; Size</legend>
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
                      setText((p) => ({ ...p, orientation: e.target.value }));
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) set({ orientation: n });
                    }}
                  />
                  <span className="ze-tvp-unit">deg</span>
                </label>
                <div className="ze-tvp-row">
                  {mmField('Size X:', 'sizeX')}
                  {mmField('Y:', 'sizeY')}
                </div>
                <label className={isRoundRect ? '' : 'disabled'}>
                  <span className="ze-tvp-label">Corner radius ratio:</span>
                  <input
                    type="text"
                    className="ze-tvp-input"
                    value={text.rratio ?? String(v.roundrectRatio)}
                    disabled={!isRoundRect}
                    onChange={(e) => {
                      setText((p) => ({ ...p, rratio: e.target.value }));
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) set({ roundrectRatio: n });
                    }}
                  />
                  <span className="ze-tvp-unit">×</span>
                </label>
                <div className="ze-tvp-row">
                  {mmField('Trapezoid delta X:', 'deltaX', !isTrapezoid)}
                  {mmField('Y:', 'deltaY', !isTrapezoid)}
                </div>
              </fieldset>

              <fieldset>
                <legend>Hole</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={v.hasHole}
                    onChange={(e) => set({ hasHole: e.target.checked })}
                  />
                  Pad has a hole
                </label>
                <label className={v.hasHole ? '' : 'disabled'}>
                  <input
                    type="checkbox"
                    checked={v.holeOblong}
                    disabled={!v.hasHole}
                    onChange={(e) => set({ holeOblong: e.target.checked })}
                  />
                  Oval hole
                </label>
                <div className="ze-tvp-row">
                  {mmField('Hole size X:', 'holeW', !v.hasHole)}
                  {mmField('Y:', 'holeH', !v.hasHole || !v.holeOblong)}
                </div>
                <div className="ze-tvp-row">
                  {mmField('Hole offset X:', 'holeOffsetX', !v.hasHole)}
                  {mmField('Y:', 'holeOffsetY', !v.hasHole)}
                </div>
              </fieldset>

              <fieldset>
                <legend>Layers</legend>
                <div className="ze-zone-layers">
                  {layers.map((l) => (
                    <label key={l}>
                      <input
                        type="checkbox"
                        checked={v.layers.includes(l)}
                        onChange={() => toggleLayer(l)}
                      />
                      {l}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          ) : (
            <>
              <fieldset>
                <legend>Clearances</legend>
                <div className="ze-tvp-note" style={{ marginLeft: 0 }}>
                  Leave values blank to inherit from the footprint, then Board Setup.
                </div>
                {overrideField(
                  'Pad clearance:',
                  'localClearance',
                  'Local clearance for this pad. If blank, the footprint then the netclass value is used.',
                )}
                {overrideField('Solder mask expansion:', 'localSolderMaskMargin')}
                {overrideField('Solder paste clearance:', 'localSolderPasteMargin')}
                <label title="Solder paste clearance as a fraction of the pad size.">
                  <span className="ze-tvp-label">Paste clearance ratio:</span>
                  <input
                    type="text"
                    className="ze-tvp-input"
                    placeholder="—"
                    value={
                      text.ratio ??
                      (v.localSolderPasteMarginRatio === null
                        ? ''
                        : String(v.localSolderPasteMarginRatio))
                    }
                    onChange={(e) => {
                      const s = e.target.value;
                      setText((p) => ({ ...p, ratio: s }));
                      if (s.trim() === '') {
                        set({ localSolderPasteMarginRatio: null });
                        return;
                      }
                      const n = Number(s);
                      if (Number.isFinite(n)) set({ localSolderPasteMarginRatio: n });
                    }}
                  />
                  <span className="ze-tvp-unit">×</span>
                </label>
              </fieldset>

              <fieldset>
                <legend>Copper Zone Connection</legend>
                <label>
                  <span className="ze-tvp-label">Pad connection:</span>
                  <select
                    className="ze-tvp-select"
                    value={v.zoneConnection}
                    onChange={(e) =>
                      set({ zoneConnection: e.target.value as PadValues['zoneConnection'] })
                    }
                  >
                    <option value="inherited">Inherited</option>
                    <option value="full">Solid</option>
                    <option value="thermal">Thermal reliefs</option>
                    <option value="none">None</option>
                  </select>
                </label>
                {overrideField('Thermal relief gap:', 'thermalGap')}
                {overrideField('Thermal spoke width:', 'thermalBridgeWidth')}
              </fieldset>

              <fieldset>
                <legend>Fabrication</legend>
                {overrideField(
                  'Pad to die length:',
                  'padToDieLength',
                  'Trace length inside the package, added to the routed length when tuning.',
                )}
              </fieldset>
            </>
          )}
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
