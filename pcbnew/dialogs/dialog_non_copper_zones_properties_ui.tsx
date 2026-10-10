// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_NON_COPPER_ZONES_EDITOR's window
 * (dialog_non_copper_zones_properties_base.cpp): the layer list on the left,
 * then the Shape box (Locked, outline style and hatch pitch, minimum width,
 * corner smoothing and its distance) and the Fill box (solid or hatch, and
 * the hatch's orientation, width, gap and smoothing), then OK / Cancel.
 */
import { type JSX, useState } from 'react';
import { DialogShim, StdDialogButtons } from '@ziroeda/common/dialog_shim.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import type {
  DIALOG_NON_COPPER_ZONES_EDITOR,
  NonCopperZoneValues,
} from './dialog_non_copper_zones_properties.js';

/** `m_OutlineDisplayCtrlChoices` (_base.cpp:62). */
const OUTLINE_STYLES = [
  { value: 'none', label: 'Line' },
  { value: 'edge', label: 'Hatched' },
  { value: 'full', label: 'Fully hatched' },
] as const;

/** `m_cornerSmoothingChoiceChoices` (_base.cpp:93). */
const SMOOTHING = [
  { value: 'none', label: 'None' },
  { value: 'chamfer', label: 'Chamfer' },
  { value: 'fillet', label: 'Fillet' },
] as const;

/** `m_GridStyleCtrlChoices` (_base.cpp:131). */
const FILL_TYPES = [
  { value: 'solid', label: 'Solid fill' },
  { value: 'hatch', label: 'Hatch pattern' },
] as const;

type LengthKey = 'hatchPitch' | 'minThickness' | 'cornerRadius' | 'hatchThickness' | 'hatchGap';

export function DialogNonCopperZonesProperties({
  dialog,
  units,
  layers,
  onResult,
}: {
  dialog: DIALOG_NON_COPPER_ZONES_EDITOR;
  /** The frame's units: the lengths are UNIT_BINDERs upstream. */
  units: StatusUnits;
  /** `SetupLayersList( m_layers, m_parent, LSET::AllNonCuMask() )`: the non-copper layers. */
  layers: readonly { name: string; color: string }[];
  /** OK (true, after the transfer took) or Cancel (false). */
  onResult: (aOk: boolean) => void;
}): JSX.Element {
  const [v, setV] = useState<NonCopperZoneValues>(() => dialog.TransferDataToWindow());
  // Lengths held as text while typed, so a half-typed number survives the caret.
  const [texts, setTexts] = useState<Partial<Record<LengthKey, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<NonCopperZoneValues>): void => setV((p) => ({ ...p, ...patch }));
  const hatch = v.fillMode === 'hatch';

  const length = (key: LengthKey, label: string, enabled = true): JSX.Element[] => [
    <span key={`${key}-l`} className={`lbl${enabled ? '' : ' disabled'}`}>
      {label}
    </span>,
    <input
      key={`${key}-e`}
      className="ze-search"
      disabled={!enabled}
      value={texts[key] ?? pcbUnitText(v[key], units)}
      onChange={(e) => {
        setTexts((t) => ({ ...t, [key]: e.target.value }));
        const iu = pcbUnitValue(e.target.value, units);
        if (Number.isFinite(iu)) set({ [key]: iu } as Partial<NonCopperZoneValues>);
      }}
    />,
    <span key={`${key}-u`} className={`unit${enabled ? '' : ' disabled'}`}>
      {unitLabel(units)}
    </span>,
  ];

  return (
    <DialogShim
      title="Non Copper Zone Properties"
      onClose={() => onResult(false)}
      className="ze-ncz"
    >
      <div className="ze-modal-body ze-ncz-upper">
        <div className="ze-ncz-left">
          <span className="ze-ncz-layers-label">Layers</span>
          <div className="ze-ncz-layer-list">
            {layers.map((l) => (
              <label key={l.name} className="ze-check">
                <input
                  type="checkbox"
                  checked={v.layers.includes(l.name)}
                  onChange={(e) =>
                    set({
                      layers: e.target.checked
                        ? [...v.layers, l.name]
                        : v.layers.filter((x) => x !== l.name),
                    })
                  }
                />
                <span className="ze-layer-swatch" style={{ background: l.color }} />
                {l.name}
              </label>
            ))}
          </div>
        </div>
        <div className="ze-ncz-middle">
          <fieldset className="ze-sbox ze-ncz-shape">
            <legend>Shape</legend>
            <div className="ze-ncz-grid">
              <label className="ze-check ze-ncz-locked">
                <input
                  type="checkbox"
                  checked={v.locked}
                  onChange={(e) => set({ locked: e.target.checked })}
                />
                Locked
              </label>
              <span className="ze-ncz-gap" />
              <span className="lbl">Outline style:</span>
              <Combo
                value={v.hatchStyle}
                options={OUTLINE_STYLES.map((o) => ({ value: o.value, label: o.label }))}
                onChange={(x: string) =>
                  set({ hatchStyle: x as NonCopperZoneValues['hatchStyle'] })
                }
              />
              <span />
              {length('hatchPitch', 'Outline hatch pitch:')}
              {length('minThickness', 'Minimum width:')}
              <span className="lbl">Corner smoothing:</span>
              <Combo
                value={v.cornerSmoothing}
                options={SMOOTHING.map((o) => ({ value: o.value, label: o.label }))}
                onChange={(x: string) =>
                  set({ cornerSmoothing: x as NonCopperZoneValues['cornerSmoothing'] })
                }
              />
              <span />
              {length(
                'cornerRadius',
                // OnUpdateUI: "Chamfer distance:" for a chamfer, else "Fillet radius:".
                v.cornerSmoothing === 'chamfer' ? 'Chamfer distance:' : 'Fillet radius:',
                v.cornerSmoothing !== 'none',
              )}
            </div>
          </fieldset>
          <fieldset className="ze-sbox ze-ncz-fill">
            <legend>Fill</legend>
            <div className="ze-ncz-grid">
              <span className="lbl">Fill type:</span>
              <Combo
                value={v.fillMode}
                options={FILL_TYPES.map((o) => ({ value: o.value, label: o.label }))}
                onChange={(x: string) => set({ fillMode: x as NonCopperZoneValues['fillMode'] })}
              />
              <span />
              <span className={`lbl${hatch ? '' : ' disabled'}`}>Orientation:</span>
              <input
                className="ze-search"
                disabled={!hatch}
                value={String(v.hatchOrientation)}
                onChange={(e) => {
                  const d = Number(e.target.value);
                  if (Number.isFinite(d)) set({ hatchOrientation: d });
                }}
              />
              <span className={`unit${hatch ? '' : ' disabled'}`}>degree</span>
              {length('hatchThickness', 'Hatch width:', hatch)}
              {length('hatchGap', 'Hatch gap:', hatch)}
              <span className={`lbl${hatch ? '' : ' disabled'}`}>Smoothing effort:</span>
              <input
                className="ze-search"
                type="number"
                min={0}
                max={3}
                disabled={!hatch}
                value={v.hatchSmoothingLevel}
                onChange={(e) => set({ hatchSmoothingLevel: Number(e.target.value) })}
              />
              <span />
              <span className={`lbl${hatch ? '' : ' disabled'}`}>Smoothing amount:</span>
              <input
                className="ze-search"
                type="number"
                min={0}
                max={1}
                step={0.1}
                disabled={!hatch}
                value={v.hatchSmoothingValue}
                onChange={(e) => set({ hatchSmoothingValue: Number(e.target.value) })}
              />
              <span />
            </div>
          </fieldset>
        </div>
      </div>
      {error && <div className="ze-prefs-error">{error}</div>}
      <StdDialogButtons
        onOk={() => {
          const r = dialog.TransferDataFromWindow(v);
          if (!r.ok) {
            setError(r.message ?? 'A value is out of range.');
            return;
          }
          onResult(true);
        }}
        onCancel={() => onResult(false)}
      />
    </DialogShim>
  );
}
