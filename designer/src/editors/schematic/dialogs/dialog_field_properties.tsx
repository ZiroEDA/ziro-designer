// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Field properties. Counterpart: `eeschema/dialogs/dialog_field_properties.cpp`
 * (DIALOG_FIELD_PROPERTIES) over `dialog_field_properties_base.cpp`, opened by
 * E, by the U/V/F keys and by a double-click on a symbol field.
 *
 *     Value:  [ entry                                              ]
 *     [ ] Visible      [ ] Show field name     [ ] Allow automatic placement
 *     Font:      [Default Font] | B I | ⇤ ⇔ ⇥ | ⤒ ⇕ ⤓ | ⇉ ⇊ |
 *     Text size: [    ] mils   Color: [swatch]
 *     Position X:[    ] mils
 *     Position Y:[    ] mils
 *                                              [ Cancel ] [ OK ]
 *
 * Three things about it are easy to get wrong, and were:
 *
 *  - **there is no Name box.** The field's name is the LABEL of the value
 *    entry: `m_textLabel->SetLabel( aField->GetName() + wxS( ":" ) )`
 *    (dialog_field_properties.cpp:281). A field is renamed in the Symbol
 *    Properties grid, never here, so a Name row is a control upstream does not
 *    have — and with it goes the "mandatory fields cannot be renamed" rule,
 *    which was our own answer to our own extra control.
 *  - **the alignment controls are bitmap toggle buttons, not dropdowns.** They
 *    are `BITMAP_BUTTON`s with `SetIsRadioButton()`
 *    (dialog_field_properties.cpp:100-131) in the same formatting bar every
 *    other text dialog builds, which is `ui/TextFormatBar.tsx` here.
 *  - **the three numeric fields carry the frame's units, not "mm".** Each is a
 *    `UNIT_BINDER( aParent, label, ctrl, units, true )`
 *    (dialog_field_properties.cpp:52-54), so the suffix and the precision are
 *    whatever the editor's units are set to — "mils" on an imperial board.
 *
 * `m_commonToAllUnits` and `m_commonToAllBodyStyles` are built by the base and
 * then hidden by `init()` (dialog_field_properties.cpp:317-319); the unit
 * chooser and the footprint browse button are shown only for the Reference
 * field of a multi-unit symbol and for the Footprint field respectively
 * (`:345-357`), neither of which this dialog reaches yet.
 */
import { useState, type JSX } from 'react';
import { schIUScale } from '@ziroeda/common';
import type { TextEffects } from '@ziroeda/eeschema';
import { ColorSwatch } from '../../../ui/ColorSwatch.js';
import { FontChoice, TextFormatBar, type HAlign, type VAlign } from '../../../ui/TextFormatBar.js';
import { parseUnitValue, stringFromValue, unitLabel } from '../../../ui/unit_binder.js';
import type { StatusUnits } from '../../../ui/status_format.js';
import { color4dToItemColor, type ItemColor, itemColorToColor4d } from './item_color.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

/** DEFAULT_SIZE_TEXT, 50 mil, the size a field falls back to. */
const DEFAULT_TEXT_SIZE = schIUScale.mmToIU(1.27);

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
  /**
   * The frame's display units, which every `UNIT_BINDER` in the dialog reads
   * off its `aParent`. Defaults to millimetres so a caller that has not been
   * given the frame's units still gets a working dialog, not a blank suffix.
   */
  units?: StatusUnits;
  onOk: (r: FieldPropsResult) => void;
  onCancel: () => void;
}

const H_ALIGN: readonly string[] = ['left', 'center', 'right'];
const V_ALIGN: readonly string[] = ['top', 'center', 'bottom'];

const hAlignOf = (fx: TextEffects): HAlign =>
  ((fx.justify ?? []).find((t) => H_ALIGN.includes(t)) as HAlign | undefined) ?? 'center';
const vAlignOf = (fx: TextEffects): VAlign =>
  ((fx.justify ?? []).find((t) => V_ALIGN.includes(t)) as VAlign | undefined) ?? 'center';

export function DialogFieldProperties({
  initial,
  caption,
  units = 'mm',
  onOk,
  onCancel,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onCancel);

  // `UNIT_BINDER::SetValue` writes `StringFromValue( aValue, false )` into the
  // entry and puts the unit WORD in the static text beside it
  // (unit_binder.cpp:109-110, :215-230), so the entry holds a bare number;
  // `GetIntValue` reads it back through DoubleValueFromString + FromUserUnit.
  // Both halves are `ui/unit_binder.ts`, the shared port of that class — not
  // the properties grid's `distanceToString`, which appends the unit because a
  // grid cell has no separate label to carry it.
  const fmt = (iu: number): string =>
    stringFromValue(schIUScale.iuToMM(iu), units, false, schIUScale);
  const parse = (text: string): number =>
    Math.round(schIUScale.mmToIU(parseUnitValue(text, units, schIUScale)));

  const [value, setValue] = useState(initial.value);
  const [x, setX] = useState(() => fmt(initial.at.x));
  const [y, setY] = useState(() => fmt(initial.at.y));
  const [angle, setAngle] = useState(initial.angle === 90 ? 90 : 0);
  const [visible, setVisible] = useState(!initial.effects.hidden);
  const [nameShown, setNameShown] = useState(initial.nameShown);
  const [autoplace, setAutoplace] = useState(!initial.doNotAutoplace);
  const [bold, setBold] = useState(!!initial.effects.bold);
  const [italic, setItalic] = useState(!!initial.effects.italic);
  const [face, setFace] = useState(initial.effects.face ?? '');
  const [size, setSize] = useState(() => fmt(initial.effects.fontSize?.[0] ?? DEFAULT_TEXT_SIZE));
  const [color, setColor] = useState<ItemColor | undefined>(initial.effects.color);
  const [hAlign, setHAlign] = useState<HAlign>(hAlignOf(initial.effects));
  const [vAlign, setVAlign] = useState<VAlign>(vAlignOf(initial.effects));

  const submit = (): void => {
    const sizeIU = parse(size) || DEFAULT_TEXT_SIZE;
    const justify = [hAlign, vAlign].filter((t) => t !== 'center');
    const effects: TextEffects = {
      hidden: !visible,
      fontSize: [sizeIU, sizeIU],
      ...(face ? { face } : {}),
      ...(bold ? { bold: true } : {}),
      ...(italic ? { italic: true } : {}),
      ...(color ? { color } : {}),
      ...(justify.length ? { justify } : {}),
    };
    onOk({
      // `TransferDataFromWindow` never touches the field's NAME: there is no
      // control for it here.
      key: initial.key,
      value,
      at: { x: parse(x), y: parse(y) },
      angle,
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
        <div className="ze-label-dialog-body">
          {/* bTextValueBoxSizer: m_textLabel wears the field's own name. */}
          <label className="row">
            <span>{`${initial.key}:`}</span>
            <input
              className="ze-search"
              // biome-ignore lint/a11y/noAutofocus: SetInitialFocus( m_TextCtrl )
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') submit();
              }}
            />
          </label>

          {/* bSizer9: the three checkboxes on ONE row, spaced apart. */}
          <div className="ze-fieldprops-checks">
            <label className="chk">
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) => setVisible(e.target.checked)}
              />
              Visible
            </label>
            <label className="chk" title="Show the field name in addition to its value">
              <input
                type="checkbox"
                checked={nameShown}
                onChange={(e) => setNameShown(e.target.checked)}
              />
              Show field name
            </label>
            <label className="chk" title="Allow automatic placement of this field in the schematic">
              <input
                type="checkbox"
                checked={autoplace}
                onChange={(e) => setAutoplace(e.target.checked)}
              />
              Allow automatic placement
            </label>
          </div>

          {/* gbSizer1 row 0: m_fontLabel at (0,0), m_fontCtrl at (0,1) and the
              formatting bar at (0,3) — one row, not three. */}
          <div className="ze-lp-fmt-grid">
            <span className="ze-lp-fmt-label">Font:</span>
            <div className="ze-lp-sizerow">
              <FontChoice face={face} onChange={setFace} />
              <TextFormatBar
                bold={bold}
                onBold={setBold}
                italic={italic}
                onItalic={setItalic}
                hAlign={hAlign}
                onHAlign={setHAlign}
                vAlign={vAlign}
                onVAlign={setVAlign}
                angle={angle}
                onAngle={setAngle}
              />
            </div>

            {/* gbSizer1 row 1: bSizer71 — size, its units, Color: and the swatch. */}
            <span className="ze-lp-fmt-label">Text size:</span>
            <div className="ze-lp-sizerow">
              <input
                className="ze-lp-size"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <span className="ze-lp-units">{unitLabel(units)}</span>
              <span className="ze-lp-colorlabel">Color:</span>
              {/* m_panelBorderColor1, the wxBORDER_SIMPLE panel COLOR_SWATCH
                  sits in; the swatch itself draws with wxTRANSPARENT_PEN. */}
              <span className="ze-lp-swatch-frame">
                <ColorSwatch
                  className="ze-lp-swatch"
                  label="Color"
                  color={itemColorToColor4d(color)}
                  onChange={(c) => setColor(color4dToItemColor(c))}
                />
              </span>
            </div>

            {/* gbSizer1 rows 3 and 4. */}
            {/* gbSizer1 leaves row 2 empty at SetEmptyCellSize's 10 px: the
                size row is row 1 and Position X is row 3. */}
            <div className="ze-fieldprops-gap" />

            <span className="ze-lp-fmt-label">Position X:</span>
            <div className="ze-lp-sizerow">
              <input
                className="ze-lp-size"
                value={x}
                onChange={(e) => setX(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <span className="ze-lp-units">{unitLabel(units)}</span>
            </div>

            <span className="ze-lp-fmt-label">Position Y:</span>
            <div className="ze-lp-sizerow">
              <input
                className="ze-lp-size"
                value={y}
                onChange={(e) => setY(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') submit();
                }}
              />
              <span className="ze-lp-units">{unitLabel(units)}</span>
            </div>
          </div>
        </div>
        {/* m_sdbSizerButtons: GTK orders the standard sizer Cancel then OK. */}
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
