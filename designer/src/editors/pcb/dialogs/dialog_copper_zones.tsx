// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Copper Zone Properties. Counterparts:
 * `pcbnew/dialogs/dialog_copper_zones.cpp` (the frame) over
 * `pcbnew/dialogs/panel_zone_properties.cpp` (every field), whose layout is a
 * name/net/layers header, then "Clearances && Pad Connections", then
 * "Display Overrides", then the fill options.
 *
 * Single-zone, so unlike Track & Via Properties there is nothing three-state
 * here: every control carries a value. The decision logic lives in
 * `pcbnew/src/zone_properties.ts`.
 */

import { useState, type JSX } from 'react';
import { pcbIuToMM, pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import type { ZoneValues } from '@ziroeda/pcbnew/src/zone_properties.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

interface Props {
  initial: ZoneValues;
  /** Net codes and names. */
  nets: ReadonlyMap<number, string>;
  /** Copper layer names, for the layer list. */
  layers: readonly string[];
  onApply: (values: ZoneValues) => void;
  onClose: () => void;
}

export function DialogCopperZones({ initial, nets, layers, onApply, onClose }: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [v, setV] = useState<ZoneValues>(initial);
  // Millimetre boxes are held as text so a half-typed number survives the caret.
  const [mmText, setMmText] = useState<Record<string, string>>({});

  const set = (patch: Partial<ZoneValues>): void => setV((prev) => ({ ...prev, ...patch }));

  /** A millimetre field bound to an IU value. */
  const mmField = (
    label: string,
    key: keyof ZoneValues,
    title?: string,
    disabled = false,
  ): JSX.Element => {
    const text = mmText[key] ?? String(pcbIuToMM(v[key] as number));
    return (
      <label className={disabled ? 'disabled' : ''} title={title}>
        <span className="ze-tvp-label">{label}</span>
        <input
          type="text"
          className="ze-tvp-input"
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setMmText((p) => ({ ...p, [key]: e.target.value }));
            const n = Number(e.target.value);
            if (Number.isFinite(n)) set({ [key]: pcbMmToIU(n) } as Partial<ZoneValues>);
          }}
        />
        <span className="ze-tvp-unit">mm</span>
      </label>
    );
  };

  /** A plain number field (degrees, ratios, mm² — not IU). */
  const numField = (
    label: string,
    key: keyof ZoneValues,
    unit: string,
    title?: string,
    disabled = false,
  ): JSX.Element => (
    <label className={disabled ? 'disabled' : ''} title={title}>
      <span className="ze-tvp-label">{label}</span>
      <input
        type="text"
        className="ze-tvp-input"
        value={String(v[key])}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set({ [key]: n } as Partial<ZoneValues>);
        }}
      />
      <span className="ze-tvp-unit">{unit}</span>
    </label>
  );

  const choice = <K extends keyof ZoneValues>(
    label: string,
    key: K,
    options: readonly { value: string; label: string }[],
    title?: string,
    disabled = false,
  ): JSX.Element => (
    <label className={disabled ? 'disabled' : ''} title={title}>
      <span className="ze-tvp-label">{label}</span>
      <select
        className="ze-tvp-select"
        value={String(v[key])}
        disabled={disabled}
        onChange={(e) => set({ [key]: e.target.value } as unknown as Partial<ZoneValues>)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  const check = (label: string, key: 'locked' | 'filled', title?: string): JSX.Element => (
    <label title={title}>
      <input
        type="checkbox"
        checked={v[key]}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<ZoneValues>)}
      />
      {label}
    </label>
  );

  const toggleLayer = (layer: string): void => {
    const has = v.layers.includes(layer);
    // A zone has to be on at least one layer; refuse to clear the last.
    if (has && v.layers.length === 1) return;
    set({ layers: has ? v.layers.filter((l) => l !== layer) : [...v.layers, layer] });
  };

  const hatched = v.fillMode === 'hatch';

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-zone-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Copper Zone Properties
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-update-pcb-body ze-tvp-body">
          <fieldset>
            <legend>Zone</legend>
            <label title="A unique name for this zone, used to identify it in DRC rules">
              <span className="ze-tvp-label">Zone name:</span>
              <input
                type="text"
                className="ze-tvp-select"
                value={v.name}
                onChange={(e) => set({ name: e.target.value })}
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
            <div className="ze-tvp-sub">Layers</div>
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
            {check('Locked', 'locked')}
          </fieldset>

          <fieldset>
            <legend>Clearances &amp; Pad Connections</legend>
            {mmField(
              'Clearance:',
              'clearance',
              'Copper clearance for this zone (set to 0 to use the netclass clearance)',
            )}
            {mmField('Minimum width:', 'minThickness', 'Minimum thickness of filled areas.')}
            {choice(
              'Pad connections:',
              'padConnection',
              [
                { value: 'full', label: 'Solid' },
                { value: 'thermal', label: 'Thermal reliefs' },
                { value: 'thru_hole_only', label: 'Reliefs for PTH' },
                { value: 'none', label: 'None' },
              ],
              'Default pad connection type to zone.\nThis setting can be overridden by local pad settings',
            )}
            {mmField(
              'Thermal relief gap:',
              'thermalGap',
              'The distance that will be kept clear between the filled area of the zone and a pad connected by thermal relief spokes.',
            )}
            {mmField(
              'Thermal spoke width:',
              'thermalBridgeWidth',
              'Width of copper in thermal reliefs.',
            )}
          </fieldset>

          <fieldset>
            <legend>Display Overrides</legend>
            {choice('Outline display:', 'hatchStyle', [
              { value: 'none', label: 'Line' },
              { value: 'edge', label: 'Hatched' },
              { value: 'full', label: 'Fully hatched' },
            ])}
            {mmField('Outline hatch pitch:', 'hatchPitch')}
          </fieldset>

          <fieldset>
            <legend>Fill</legend>
            {check('Filled', 'filled', 'Whether the zone is poured at all.')}
            {choice('Fill type:', 'fillMode', [
              { value: 'solid', label: 'Solid fill' },
              { value: 'hatch', label: 'Hatch pattern' },
              { value: 'thieving', label: 'Copper thieving' },
            ])}
            {mmField('Hatch width:', 'hatchThickness', undefined, !hatched)}
            {mmField('Hatch gap:', 'hatchGap', undefined, !hatched)}
            {numField('Orientation:', 'hatchOrientation', 'deg', undefined, !hatched)}
            {numField(
              'Smoothing effort:',
              'hatchSmoothingLevel',
              '',
              'Value of smoothing effort\n0 = no smoothing\n1 = chamfer\n2 = round corners\n3 = round corners (finer shape)',
              !hatched,
            )}
            {numField(
              'Smoothing amount:',
              'hatchSmoothingValue',
              '',
              'Ratio between smoothed corners size and the gap between lines\n0 = no smoothing\n1.0 = max radius/chamfer size (half gap value)',
              !hatched,
            )}

            <div className="ze-tvp-sub">Outline</div>
            {choice('Corner smoothing:', 'cornerSmoothing', [
              { value: 'none', label: 'None' },
              { value: 'chamfer', label: 'Chamfer' },
              { value: 'fillet', label: 'Fillet' },
            ])}
            {mmField('Radius:', 'cornerRadius', undefined, v.cornerSmoothing === 'none')}

            <div className="ze-tvp-sub">Islands</div>
            {choice(
              'Remove islands:',
              'islandRemovalMode',
              [
                { value: 'always', label: 'Always' },
                { value: 'never', label: 'Never' },
                { value: 'area', label: 'Below area limit' },
              ],
              'Choose what to do with unconnected copper islands',
            )}
            {numField(
              'Area limit:',
              'islandAreaMin',
              'mm²',
              'Isolated islands smaller than this will be removed',
              v.islandRemovalMode !== 'area',
            )}

            {numField('Priority:', 'priority', '', 'A higher priority zone is poured first.')}
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
