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
import { ColorSwatch } from '../../../ui/ColorSwatch.js';
import { color4dToItemColor, type ItemColor, itemColorToColor4d } from './item_color.js';
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
  /**
   * The window caption, which upstream's caller computes rather than the
   * dialog: `DIALOG_FIELD_PROPERTIES dlg( m_frame, caption, aField )`
   * (sch_edit_tool.cpp:2353) and `DIALOG_FIELD_PROPERTIES_BASE( aParent,
   * wxID_ANY, aTitle )` (dialog_field_properties.cpp:52). See
   * `fieldEditCaption`.
   */
  caption: string;
  /** Reference / Value / Footprint / Datasheet cannot be renamed. */
  mandatory: boolean;
  onOk: (r: FieldPropsResult) => void;
  onCancel: () => void;
}

const H_ALIGN = ['left', 'center', 'right'] as const;
const V_ALIGN = ['top', 'center', 'bottom'] as const;

const alignOf = (fx: TextEffects, axis: 'h' | 'v'): string => {
  const set = axis === 'h' ? H_ALIGN : V_ALIGN;
  return (fx.justify ?? []).find((t) => (set as readonly string[]).includes(t)) ?? 'center';
};

export function DialogFieldProperties({
  initial,
  caption,
  mandatory,
  onOk,
  onCancel,
}: Props): JSX.Element {
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
          {caption}
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
            {/* COLOR_SWATCH: it draws the colour and opens DIALOG_COLOR_PICKER
            (color_swatch.cpp:301-328), where an <input type="color"> handed
            the job to the desktop's own popup - anchored to the control, so
            off-screen near the window edge, and unable to carry alpha. */}
            <ColorSwatch
              label="Color"
              color={itemColorToColor4d(color)}
              onChange={(c) => setColor(color4dToItemColor(c))}
            />
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
