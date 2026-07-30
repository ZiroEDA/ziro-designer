// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Wire/bus/line and junction properties. Counterparts:
 * `eeschema/dialogs/dialog_wire_bus_properties.cpp` (DIALOG_WIRE_BUS_PROPERTIES,
 * line width and style) and `dialog_junction_props.cpp` (DIALOG_JUNCTION_PROPS,
 * junction diameter). Widths/diameters are entered in millimetres; 0 = "use the
 * netclass/schematic default".
 */
import { useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common';

/** KiCad line styles (`(stroke (type ..))`) with the upstream display names
 *  (common/stroke_params.cpp lineTypeNames), in the dialog's dropdown order. */
const LINE_STYLES: { value: string; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'solid', label: 'Solid' },
  { value: 'dash', label: 'Dashed' },
  { value: 'dot', label: 'Dotted' },
  { value: 'dash_dot', label: 'Dash-Dot' },
  { value: 'dash_dot_dot', label: 'Dash-Dot-Dot' },
];

/** Item colour as stored: [r, g, b] 0-255 plus alpha 0-1; unset = layer colour. */
export type ItemColor = readonly [number, number, number, number];

const toHex = (c: ItemColor): string =>
  `#${[c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): ItemColor => [
  Number.parseInt(h.slice(1, 3), 16),
  Number.parseInt(h.slice(3, 5), 16),
  Number.parseInt(h.slice(5, 7), 16),
  1,
];

interface WireProps {
  kind: 'wire';
  widthIU: number;
  style: string;
  color?: ItemColor;
  onOk: (widthIU: number, style: string, color?: ItemColor) => void;
  onCancel: () => void;
}
interface JunctionProps {
  kind: 'junction';
  diameterIU: number;
  color?: ItemColor;
  onOk: (diameterIU: number, color?: ItemColor) => void;
  onCancel: () => void;
}

export function DialogLineProperties(props: WireProps | JunctionProps): JSX.Element {
  const mm = (iu: number): string => (iu === 0 ? '0' : String(iuToMM(iu)));
  const [width, setWidth] = useState(props.kind === 'wire' ? mm(props.widthIU) : '0');
  const [style, setStyle] = useState(props.kind === 'wire' ? props.style : 'default');
  const [diameter, setDiameter] = useState(props.kind === 'junction' ? mm(props.diameterIU) : '0');
  const [color, setColor] = useState<ItemColor | undefined>(props.color);

  const submit = (): void => {
    if (props.kind === 'wire') props.onOk(mmToIU(Number(width) || 0), style, color);
    else props.onOk(mmToIU(Number(diameter) || 0), color);
  };

  // COLOR_SWATCH: a picker plus "Clear color" back to the layer default.
  const colorRow = (
    <label className="row">
      <span>Color:</span>
      <input
        type="color"
        value={color ? toHex(color) : '#000000'}
        onChange={(e) => setColor(fromHex(e.target.value))}
        style={{ width: 44, height: 24, padding: 0, border: 'none', background: 'none' }}
      />
      <button
        className="ze-btn"
        style={{ fontSize: 11 }}
        title="Clear color to use Schematic Editor colors."
        disabled={!color}
        onClick={() => setColor(undefined)}
      >
        Clear
      </button>
      {!color && (
        <span className="ze-muted" style={{ fontSize: 11 }}>
          (using Schematic Editor colors)
        </span>
      )}
    </label>
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={props.onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {props.kind === 'wire' ? 'Wire & Bus Properties' : 'Junction Properties'}
          <span className="x" title="Cancel" onClick={props.onCancel}>
            ✕
          </span>
        </div>
        <div
          className="ze-label-dialog-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {props.kind === 'wire' ? (
            <>
              <label className="row">
                <span>Width:</span>
                <input
                  className="ze-search"
                  autoFocus
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') submit();
                  }}
                />
                <span className="ze-muted" style={{ fontSize: 11 }}>
                  mm
                </span>
              </label>
              {colorRow}
              <label className="row">
                <span>Style:</span>
                <select
                  className="ze-select"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                >
                  {LINE_STYLES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="ze-muted" style={{ fontSize: 11, marginTop: 4 }}>
                Set width to 0 to use schematic's default line width.
              </div>
            </>
          ) : (
            <>
              <label className="row">
                <span>Diameter:</span>
                <input
                  className="ze-search"
                  autoFocus
                  value={diameter}
                  onChange={(e) => setDiameter(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') submit();
                  }}
                />
                <span className="ze-muted" style={{ fontSize: 11 }}>
                  mm
                </span>
              </label>
              {colorRow}
              <div className="ze-muted" style={{ fontSize: 11, marginTop: 4 }}>
                Set diameter to 0 to use schematic's default junction dot size.
              </div>
            </>
          )}
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={props.onCancel}>
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
