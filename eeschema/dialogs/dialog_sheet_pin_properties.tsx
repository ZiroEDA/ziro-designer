// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SHEET_PIN_PROPERTIES` (eeschema/dialogs/dialog_sheet_pin_properties.cpp, with its
 * layout from dialog_sheet_pin_properties_base.cpp) on a live SCH_SHEET_PIN.
 *
 * The model half is the class: TransferDataToWindow reads the pin and the hierarchical labels of
 * the sheet it belongs to (the name combo's suggestions), TransferDataFromWindow applies one
 * SCH_COMMIT. The form below is the base sizer tree: Name (a wxComboBox) with Syntax help, then
 * the Shape radio box beside the Formatting box (font, bold, italic, text size, colour).
 */
import { useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { FONT } from '@ziroeda/common/font/font.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import { BitmapButton, BitmapButtonSeparator } from '@ziroeda/common/widgets/bitmap_button.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import {
  parseUnitValueDouble,
  stringFromValue,
  unitLabel,
} from '@ziroeda/common/widgets/unit_binder.js';
import { TextCombo } from '@ziroeda/common/widgets/wx_combobox.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_HIERLABEL } from '../sch_label.js';
import { LABEL_FLAG_SHAPE } from '../sch_label.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SHEET_PIN } from '../sch_sheet_pin.js';

/** The Shape radio buttons, in the base dialog's order. */
const SHAPES: { shape: LABEL_FLAG_SHAPE; label: string }[] = [
  { shape: LABEL_FLAG_SHAPE.L_INPUT, label: 'Input' },
  { shape: LABEL_FLAG_SHAPE.L_OUTPUT, label: 'Output' },
  { shape: LABEL_FLAG_SHAPE.L_BIDI, label: 'Bidirectional' },
  { shape: LABEL_FLAG_SHAPE.L_TRISTATE, label: 'Tri-state' },
  { shape: LABEL_FLAG_SHAPE.L_UNSPECIFIED, label: 'Passive' },
];

export interface SHEET_PIN_DIALOG_VALUES {
  /** m_comboName's choices: the hierarchical labels of the pin's sheet. */
  names: string[];
  name: string;
  /** FONT_CHOICE: '' is "Default Font". */
  face: string;
  bold: boolean;
  italic: boolean;
  textSize: number;
  color: Color4d;
  shape: LABEL_FLAG_SHAPE;
}

export class DIALOG_SHEET_PIN_PROPERTIES {
  private readonly m_frame: SCH_EDIT_FRAME;
  private readonly m_sheetPin: SCH_SHEET_PIN;

  constructor(aParent: SCH_EDIT_FRAME, aPin: SCH_SHEET_PIN) {
    this.m_frame = aParent;
    this.m_sheetPin = aPin;
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): SHEET_PIN_DIALOG_VALUES {
    const screen = (this.m_sheetPin.GetParent() as SCH_SHEET).GetScreen();
    const names: string[] = [];

    for (const item of screen?.Items().OfType(KICAD_T.SCH_HIER_LABEL_T) ?? []) {
      const txt = (item as SCH_HIERLABEL).GetText();

      if (!names.includes(txt)) names.push(txt);
    }

    return {
      names,
      name: unescapeString(this.m_sheetPin.GetText()),
      face: this.m_sheetPin.GetFont()?.GetName() ?? '',
      bold: this.m_sheetPin.IsBold(),
      italic: this.m_sheetPin.IsItalic(),
      // Currently, eeschema uses only the text width as text size
      // (only the text width is saved in files), and expects text width = text height
      textSize: this.m_sheetPin.GetTextWidth(),
      color: this.m_sheetPin.GetTextColor(),
      shape: this.m_sheetPin.GetShape(),
    };
  }

  /** `TransferDataFromWindow()`. */
  TransferDataFromWindow(aValues: SHEET_PIN_DIALOG_VALUES): boolean {
    const commit = new SCH_COMMIT(this.m_frame);

    if (!this.m_sheetPin.IsNew())
      commit.Modify(this.m_sheetPin.GetParent()!, this.m_frame.GetScreen());

    this.m_sheetPin.SetText(EscapeString(aValues.name, ESCAPE_CONTEXT.CTX_NETNAME));

    this.m_sheetPin.SetFont(
      aValues.face === '' ? null : FONT.GetFont(aValues.face, aValues.bold, aValues.italic),
    );

    // Currently, eeschema uses only the text width as text size,
    // and expects text width = text height
    this.m_sheetPin.SetTextSize({ x: aValues.textSize, y: aValues.textSize });

    // Must come after SetTextSize()
    this.m_sheetPin.SetBold(aValues.bold);
    this.m_sheetPin.SetItalic(aValues.italic);

    this.m_sheetPin.SetTextColor(aValues.color);
    this.m_sheetPin.SetShape(aValues.shape);

    if (!commit.Empty()) commit.Push('Edit Sheet Pin Properties');

    return true;
  }
}

/** The form over DIALOG_SHEET_PIN_PROPERTIES' values. */
export function DialogSheetPinProperties({
  initial,
  units,
  onOk,
  onCancel,
}: {
  initial: SHEET_PIN_DIALOG_VALUES;
  units: StatusUnits;
  onOk: (aValues: SHEET_PIN_DIALOG_VALUES) => void;
  onCancel: () => void;
}): JSX.Element {
  useModalEscape(onCancel);

  const [name, setName] = useState(initial.name);
  const [face, setFace] = useState(initial.face);
  const [bold, setBold] = useState(initial.bold);
  const [italic, setItalic] = useState(initial.italic);
  const [sizeText, setSizeText] = useState(stringFromValue(iuToMM(initial.textSize), units, false));
  const [color, setColor] = useState(initial.color);
  const [shape, setShape] = useState(initial.shape);

  const submit = (): void => {
    const mm = parseUnitValueDouble(sizeText, units);
    onOk({
      ...initial,
      name,
      face,
      bold,
      italic,
      textSize: Number.isFinite(mm) ? Math.round(mmToIU(mm)) : initial.textSize,
      color,
      shape,
    });
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-props" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">Sheet Pin Properties</div>
        <div className="ze-modal-body ze-lp-body">
          {/* fgSizer2: Name: and its wxComboBox, Syntax help under it. */}
          <div className="ze-lp-entry">
            <span className="ze-lp-caption">Name:</span>
            <TextCombo
              className="ze-lp-value"
              value={name}
              options={initial.names}
              onChange={setName}
              onEnter={submit}
              autoFocus
            />
          </div>
          <div className="ze-lp-entry-row2">
            <a
              className="ze-lp-syntax"
              href="https://docs.kicad.org/GetStarted#labels"
              target="_blank"
              rel="noreferrer"
              title="Show syntax help window"
            >
              Syntax help
            </a>
          </div>

          {/* optionsSizer: the Shape radio box beside the Formatting box. */}
          <div className="ze-lp-options">
            <fieldset className="ze-lp-shape">
              <legend>Shape</legend>
              {SHAPES.map((s) => (
                <label key={s.shape}>
                  <input
                    type="radio"
                    name="ze-spp-shape"
                    checked={shape === s.shape}
                    onChange={() => setShape(s.shape)}
                  />
                  {s.label}
                </label>
              ))}
            </fieldset>

            <fieldset className="ze-lp-formatting">
              <legend>Formatting</legend>
              <div className="ze-lp-fmt-grid">
                <span className="ze-lp-fmt-label">Font:</span>
                <FontChoice face={face} onChange={setFace} />
                <div className="ze-lp-iconbar">
                  <BitmapButtonSeparator />
                  <BitmapButton
                    bitmap="text_bold"
                    tooltip="Bold"
                    checked={bold}
                    onClick={() => setBold(!bold)}
                  />
                  <BitmapButton
                    bitmap="text_italic"
                    tooltip="Italic"
                    checked={italic}
                    onClick={() => setItalic(!italic)}
                  />
                  <BitmapButtonSeparator />
                </div>

                <span className="ze-lp-fmt-label">Text size:</span>
                <div className="ze-lp-sizerow">
                  <input
                    className="ze-lp-size"
                    value={sizeText}
                    onChange={(e) => setSizeText(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') submit();
                    }}
                  />
                  <span className="ze-lp-units">{unitLabel(units)}</span>
                  <span className="ze-lp-colorlabel">Color:</span>
                  <span className="ze-lp-swatch-frame">
                    <ColorSwatch
                      className="ze-lp-swatch"
                      label="Text color"
                      color={color}
                      onChange={setColor}
                    />
                  </span>
                </div>
              </div>
            </fieldset>
          </div>
        </div>

        <div className="ze-modal-footer">
          <button type="button" className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="ze-btn primary" onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
