// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Wire/bus/line and junction properties. Counterparts:
 * `eeschema/dialogs/dialog_wire_bus_properties.cpp` (DIALOG_WIRE_BUS_PROPERTIES,
 * line width and style) and `dialog_junction_props.cpp` (DIALOG_JUNCTION_PROPS,
 * junction diameter). Widths and diameters are entered in millimetres, and 0
 * means "use the netclass's value", which is what upstream's help text says and
 * what Reset to Defaults (wxID_APPLY) puts everything back to.
 *
 * The wire form also edits the junction size, because KiCad edits it here: a
 * selection of wires usually carries the junctions between them, and having to
 * open a second dialog for them would be the odd behaviour.
 */
import { useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common';
import { WIRE_STYLE_NAMES } from '@ziroeda/common/src/stroke_params.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import { ColorSwatch } from '../../../ui/ColorSwatch.js';
import { color4dToItemColor, type ItemColor, itemColorToColor4d } from './item_color.js';

// `ItemColor` and its COLOR4D conversion moved to `item_color.ts` when the six
// dialogs stopped each carrying their own copy of the hex round trip. Re-exported
// so nothing that imported the type from here had to change.
export type { ItemColor } from './item_color.js';

interface WireProps {
  kind: 'wire';
  widthIU: number;
  style: string;
  color?: ItemColor;
  /** Junction diameter for the junctions in scope; 0 = the netclass value. */
  junctionIU?: number;
  onOk: (widthIU: number, style: string, color?: ItemColor, junctionIU?: number) => void;
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
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(props.onCancel);

  const mm = (iu: number): string => (iu === 0 ? '0' : String(iuToMM(iu)));
  const [width, setWidth] = useState(props.kind === 'wire' ? mm(props.widthIU) : '0');
  const [style, setStyle] = useState(props.kind === 'wire' ? props.style : 'default');
  const [diameter, setDiameter] = useState(props.kind === 'junction' ? mm(props.diameterIU) : '0');
  const [junction, setJunction] = useState(props.kind === 'wire' ? mm(props.junctionIU ?? 0) : '0');
  const [color, setColor] = useState<ItemColor | undefined>(props.color);

  const submit = (): void => {
    if (props.kind === 'wire')
      props.onOk(mmToIU(Number(width) || 0), style, color, mmToIU(Number(junction) || 0));
    else props.onOk(mmToIU(Number(diameter) || 0), color);
  };

  // COLOR_SWATCH: a picker plus "Clear color" back to the layer default.
  const colorRow = (
    <label className="row">
      <span>Color:</span>
      {/* COLOR_SWATCH: it draws the colour and opens DIALOG_COLOR_PICKER
          (color_swatch.cpp:301-328). It was an <input type="color">,
          i.e. the desktop's picker as a popup anchored to the control -
          off-screen near the window edge, and unable to carry alpha. */}
      <ColorSwatch
        label="Color"
        color={itemColorToColor4d(color)}
        onChange={(c) => setColor(color4dToItemColor(c))}
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
                <span>Wire/bus width:</span>
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
                  {/* lineTypeNames, then "Default" appended after them —
                      dialog_wire_bus_properties.cpp:56-59. Only a wire or bus
                      takes its style from its net class, so only this dialog
                      offers Default, and upstream puts it last. */}
                  {WIRE_STYLE_NAMES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="row">
                {/* KiCad edits the junction size in this same dialog, since a
                    selection of wires usually carries the junctions between
                    them; 0 means "use the netclass value". */}
                <span>Junction size:</span>
                <input
                  className="ze-search"
                  value={junction}
                  onChange={(e) => setJunction(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') submit();
                  }}
                />
                <span className="ze-muted" style={{ fontSize: 11 }}>
                  mm
                </span>
              </label>
              <div className="ze-muted" style={{ fontSize: 11, marginTop: 4 }}>
                Set width to 0 to use netclass's wire/bus widths.
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
          {/* wxID_APPLY: back to "use the netclass / editor values", which is
              what a width of 0 and no colour mean. */}
          <button
            className="ze-btn"
            style={{ marginRight: 'auto' }}
            onClick={() => {
              setWidth('0');
              setJunction('0');
              setDiameter('0');
              setStyle('default');
              setColor(undefined);
            }}
          >
            Reset to Defaults
          </button>
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
