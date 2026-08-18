// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Field properties. Counterpart: `eeschema/dialogs/dialog_field_properties.cpp`
 * (DIALOG_FIELD_PROPERTIES), opened by E on a single symbol field.
 *
 * A field is a piece of text with a position of its own, so this is the text
 * attributes (visible, name shown, font, size, bold, italic, colour,
 * orientation, both justifications) plus its position, which is shown
 * symbol-relative the way the symbol properties grid shows it.
 *
 * Two rules come from upstream rather than from the controls:
 *
 *  - a mandatory field cannot be renamed. Reference, Value, Footprint and
 *    Datasheet are addressed by name everywhere, so the name is read-only and
 *    only the value is editable.
 *  - Sheetfile is refused outright, with upstream's own wording: it names the
 *    file the sheet points at, and changing it here would leave the sheet
 *    pointing somewhere the project does not know about.
 */
import { useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common';
import type { TextEffects } from '@ziroeda/eeschema';
import type { ItemColor } from './dialog_line_properties.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

/** DEFAULT_SIZE_TEXT, 50 mil, the size a field falls back to. */
const DEFAULT_TEXT_SIZE = mmToIU(1.27);

export interface FieldPropsResult {
  key: string;
  value: string;
  /** Symbol-relative position in IU, as the dialog shows it. */
  at: { x: number; y: number };
  /** 0 (horizontal) or 90 (vertical); upstream offers only these two. */
  angle: number;
  effects: TextEffects;
  nameShown: boolean;
  /** Inverted from the "Allow automatic placement" checkbox. */
  doNotAutoplace: boolean;
}

interface Props {
  initial: FieldPropsResult;
  /** Reference / Value / Footprint / Datasheet cannot be renamed. */
  mandatory: boolean;
  onOk: (r: FieldPropsResult) => void;
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

const H_ALIGN = ['left', 'center', 'right'] as const;
const V_ALIGN = ['top', 'center', 'bottom'] as const;

const alignOf = (fx: TextEffects, axis: 'h' | 'v'): string => {
  const set = axis === 'h' ? H_ALIGN : V_ALIGN;
  return (fx.justify ?? []).find((t) => (set as readonly string[]).includes(t)) ?? 'center';
};

export function DialogFieldProperties({ initial, mandatory, onOk, onCancel }: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  const [key, setKey] = useState(initial.key);
  const [value, setValue] = useState(initial.value);
  const [x, setX] = useState(String(iuToMM(initial.at.x)));
  const [y, setY] = useState(String(iuToMM(initial.at.y)));
  const [vertical, setVertical] = useState(initial.angle === 90);
  const [visible, setVisible] = useState(!initial.effects.hidden);
  const [nameShown, setNameShown] = useState(initial.nameShown);
  const [autoplace, setAutoplace] = useState(!initial.doNotAutoplace);
  const [bold, setBold] = useState(!!initial.effects.bold);
  const [italic, setItalic] = useState(!!initial.effects.italic);
  const [size, setSize] = useState(
    String(iuToMM(initial.effects.fontSize?.[0] ?? DEFAULT_TEXT_SIZE)),
  );
  const [color, setColor] = useState<ItemColor | undefined>(initial.effects.color);
  const [hAlign, setHAlign] = useState(alignOf(initial.effects, 'h'));
  const [vAlign, setVAlign] = useState(alignOf(initial.effects, 'v'));
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const name = key.trim();
    if (!name) {
      setError('Fields must have a name');
      return;
    }
    const sizeIU = mmToIU(Number(size) || 0) || DEFAULT_TEXT_SIZE;
    const justify = [hAlign, vAlign].filter((t) => t !== 'center');
    const effects: TextEffects = {
      hidden: !visible,
      fontSize: [sizeIU, sizeIU],
      ...(bold ? { bold: true } : {}),
      ...(italic ? { italic: true } : {}),
      ...(color ? { color } : {}),
      ...(justify.length ? { justify } : {}),
    };
    onOk({
      key: name,
      value,
      at: { x: mmToIU(Number(x) || 0), y: mmToIU(Number(y) || 0) },
      angle: vertical ? 90 : 0,
      effects,
      nameShown,
      doNotAutoplace: !autoplace,
    });
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Field Properties
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>
        <div
          className="ze-label-dialog-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {error && (
            <div className="ze-props-error" onClick={() => setError(null)}>
              {error}, click to dismiss
            </div>
          )}

          <label className="row">
            <span>Name:</span>
            {mandatory ? (
              // A mandatory field is addressed by name everywhere; renaming it
              // would orphan every reference to it.
              <span className="ze-cell-ro">{key}</span>
            ) : (
              <input
                className="ze-search"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            )}
          </label>
          <label className="row">
            <span>Text:</span>
            <input
              className="ze-search"
              // biome-ignore lint/a11y/noAutofocus: matches m_delayedFocusCtrl
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') submit();
              }}
            />
          </label>

          <label className="row">
            <input
              type="checkbox"
              checked={visible}
              onChange={(e) => setVisible(e.target.checked)}
            />
            <span>Visible</span>
          </label>
          <label className="row" title="Show the field name in addition to its value">
            <input
              type="checkbox"
              checked={nameShown}
              onChange={(e) => setNameShown(e.target.checked)}
            />
            <span>Show field name</span>
          </label>
          <label className="row" title="Allow automatic placement of this field in the schematic">
            <input
              type="checkbox"
              checked={autoplace}
              onChange={(e) => setAutoplace(e.target.checked)}
            />
            <span>Allow automatic placement</span>
          </label>

          <label className="row">
            <span>Text size:</span>
            <input
              className="ze-search"
              style={{ width: 80 }}
              value={size}
              onChange={(e) => setSize(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span className="ze-muted">mm</span>
            <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} />
            <span>Bold</span>
            <input type="checkbox" checked={italic} onChange={(e) => setItalic(e.target.checked)} />
            <span>Italic</span>
          </label>

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
          </label>

          <label className="row">
            <span>Orientation:</span>
            <select
              className="ze-select"
              value={vertical ? 'vertical' : 'horizontal'}
              onChange={(e) => setVertical(e.target.value === 'vertical')}
            >
              <option value="horizontal">Horizontal text</option>
              <option value="vertical">Vertical text</option>
            </select>
          </label>
          <label className="row">
            <span>Align:</span>
            <select
              className="ze-select"
              value={hAlign}
              onChange={(e) => setHAlign(e.target.value)}
            >
              <option value="left">Align left</option>
              <option value="center">Align horizontal center</option>
              <option value="right">Align right</option>
            </select>
            <select
              className="ze-select"
              value={vAlign}
              onChange={(e) => setVAlign(e.target.value)}
            >
              <option value="top">Align top</option>
              <option value="center">Align vertical center</option>
              <option value="bottom">Align bottom</option>
            </select>
          </label>

          <label className="row">
            <span>Position X:</span>
            <input
              className="ze-search"
              style={{ width: 90 }}
              value={x}
              onChange={(e) => setX(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span className="ze-muted">mm</span>
          </label>
          <label className="row">
            <span>Position Y:</span>
            <input
              className="ze-search"
              style={{ width: 90 }}
              value={y}
              onChange={(e) => setY(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') submit();
              }}
            />
            <span className="ze-muted">mm</span>
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
