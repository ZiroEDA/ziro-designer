// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Outset Items.
 * Counterpart: `pcbnew/dialogs/dialog_outset_items.cpp`.
 *
 * The geometry lives in pcbnew (outset_items.ts) where it is tested; this
 * collects the seven parameters `OUTSET_ROUTINE::PARAMETERS` carries.
 *
 * Two controls gate others, as upstream enables and disables them: the grid
 * pitch means nothing unless rounding is on, and the layer picker means nothing
 * while layers are being copied from the source.
 */
import { useState, type JSX, type Ref } from 'react';
import type { OutsetSettings } from '../outset_settings.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import { pcbUnitText, pcbUnitValue, unitLabel } from '../pcb_unit_binder.js';
import type { StatusUnits } from '../../../ui/status_format.js';

interface Props {
  /**
   * The frame's display units. Every distance in this dialog is a
   * `UNIT_BINDER` upstream, so it shows and reads the frame's unit rather than
   * a fixed millimetre.
   */
  units: StatusUnits;
  /** Layers offered when not copying from the source. */
  layers: string[];
  /** Remembered across openings, as upstream keeps its params on the tool. */
  initial: OutsetSettings;
  onApply: (settings: OutsetSettings) => void;
  onClose: () => void;
  rootRef?: Ref<HTMLDivElement>;
}

export function DialogOutsetItems({
  units,
  layers,
  initial,
  onApply,
  onClose,
  rootRef,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const [s, setS] = useState<OutsetSettings>(initial);
  const [distanceText, setDistanceText] = useState(pcbUnitText(initial.distanceIU, units));
  const [widthText, setWidthText] = useState(pcbUnitText(initial.lineWidthIU, units));
  const [gridText, setGridText] = useState(pcbUnitText(initial.gridPitchIU, units));

  /** `UNIT_BINDER::GetValue()`: board IU, read in the frame's units. */
  const num = (t: string): number => {
    const iu = pcbUnitValue(t, units);
    return Number.isFinite(iu) ? iu : 0;
  };

  const row = (label: string, control: JSX.Element, dim = false): JSX.Element => (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        opacity: dim ? 0.5 : 1,
      }}
    >
      <span style={{ width: 96, textAlign: 'right' }}>{label}</span>
      {control}
    </label>
  );

  const check = (
    label: string,
    value: boolean,
    set: (v: boolean) => void,
    indent = false,
  ): JSX.Element => (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        marginLeft: indent ? 104 : 0,
      }}
    >
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );

  const numberBox = (text: string, setText: (t: string) => void, disabled = false): JSX.Element => (
    <>
      <input
        type="text"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        style={{ width: 80, fontSize: 12, padding: '2px 4px' }}
      />
      <span className="ze-unit-label">{unitLabel(units)}</span>
    </>
  );

  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute',
        top: 80,
        left: 120,
        width: 360,
        background: 'var(--chrome-bg)',
        border: '1px solid var(--chrome-border)',
        borderRadius: 6,
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        zIndex: 40,
      }}
    >
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--chrome-border)',
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        Outset Items
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {row('Outset:', numberBox(distanceText, setDistanceText))}
        {check('Round corners', s.roundCorners, (v) => setS({ ...s, roundCorners: v }), true)}

        <div style={{ height: 4 }} />

        {check('Copy layers from source', s.useSourceLayers, (v) =>
          setS({ ...s, useSourceLayers: v }),
        )}
        {row(
          'Layer:',
          <select
            value={s.layer}
            disabled={s.useSourceLayers}
            onChange={(e) => setS({ ...s, layer: e.target.value })}
            style={{ flex: 1, fontSize: 12 }}
          >
            {layers.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>,
          s.useSourceLayers,
        )}

        {check('Copy widths from source', s.useSourceWidths, (v) =>
          setS({ ...s, useSourceWidths: v }),
        )}
        {row(
          'Line width:',
          numberBox(widthText, setWidthText, s.useSourceWidths),
          s.useSourceWidths,
        )}

        <div style={{ height: 4 }} />

        {check('Round to grid', s.roundToGrid, (v) => setS({ ...s, roundToGrid: v }))}
        {row('Grid:', numberBox(gridText, setGridText, !s.roundToGrid), !s.roundToGrid)}

        <div style={{ height: 4 }} />

        {check('Delete source items', s.deleteSourceItems, (v) =>
          setS({ ...s, deleteSourceItems: v }),
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '8px 10px',
          borderTop: '1px solid var(--chrome-border)',
        }}
      >
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() =>
            onApply({
              ...s,
              distanceIU: num(distanceText),
              lineWidthIU: num(widthText),
              gridPitchIU: num(gridText),
            })
          }
        >
          OK
        </button>
      </div>
    </div>
  );
}
