// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SHEET_PIN_PROPERTIES` (eeschema/dialogs/dialog_sheet_pin_properties.cpp) over
 * DIALOG_SHEET_PIN_PROPERTIES_BASE, on a live SCH_SHEET_PIN: the name (a wxComboBox of the sheet's
 * hierarchical labels, SCH_NETNAME_VALIDATOR on OK), the text size through `m_textSize`, a
 * UNIT_BINDER in the frame's units, the font, colour and shape; picking a hierarchical label's
 * name takes its shape (`onComboBox`); Syntax help is SCH_TEXT::ShowSyntaxHelp's window.
 */
import { type JSX, useState } from 'react';
import { MessageDialogOk } from '@ziroeda/common/dialogs/dialog_message.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { FONT } from '@ziroeda/common/font/font.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_HIERLABEL } from '../sch_label.js';
import { LABEL_FLAG_SHAPE } from '../sch_label.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SHEET_PIN } from '../sch_sheet_pin.js';
import { SCH_NETNAME_VALIDATOR } from '../sch_validators.js';
import { DIALOG_SHEET_PIN_PROPERTIES_BASE } from './dialog_sheet_pin_properties_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** The Shape radio buttons, in the base dialog's order. */
const SHAPES: { shape: LABEL_FLAG_SHAPE; label: string }[] = [
  { shape: LABEL_FLAG_SHAPE.L_INPUT, label: _HKI('Input') },
  { shape: LABEL_FLAG_SHAPE.L_OUTPUT, label: _HKI('Output') },
  { shape: LABEL_FLAG_SHAPE.L_BIDI, label: _HKI('Bidirectional') },
  { shape: LABEL_FLAG_SHAPE.L_TRISTATE, label: _HKI('Tri-state') },
  { shape: LABEL_FLAG_SHAPE.L_UNSPECIFIED, label: _HKI('Passive') },
];

export interface SHEET_PIN_DIALOG_VALUES {
  /** m_comboName's choices: the hierarchical labels of the pin's sheet. */
  names: string[];
  name: string;
  /** FONT_CHOICE: '' is "Default Font". */
  face: string;
  bold: boolean;
  italic: boolean;
  /** `m_textSizeCtrl`'s text. */
  textSize: string;
  color: Color4d;
  shape: LABEL_FLAG_SHAPE;
}

export class DIALOG_SHEET_PIN_PROPERTIES {
  private readonly m_frame: SCH_EDIT_FRAME;
  private readonly m_sheetPin: SCH_SHEET_PIN;
  private readonly m_textSize: UNIT_BINDER;

  constructor(aParent: SCH_EDIT_FRAME, aPin: SCH_SHEET_PIN) {
    this.m_frame = aParent;
    this.m_sheetPin = aPin;
    this.m_textSize = new UNIT_BINDER(aParent, _('Text size:'), (m) => DisplayErrorMessage(m));
  }

  /** `SetSwatchBackground( schematicBackground )`. */
  SwatchBackground(): Color4d {
    return this.m_frame.GetDrawBgColor();
  }

  /** `OnSyntaxHelp()`: SCH_LABEL_BASE::ShowSyntaxHelp, the frame's syntax help window. */
  ShowSyntaxHelp(): void {
    this.m_frame.ShowBusSyntaxHelp();
  }

  /**
   * `onComboBox()`: the shape of the first hierarchical label on the pin's sheet whose text
   * matches \a aName, case-insensitively (`CmpNoCase`); null when none does.
   */
  ShapeOfHierLabel(aName: string): LABEL_FLAG_SHAPE | null {
    const screen = (this.m_sheetPin.GetParent() as SCH_SHEET).GetScreen();
    const want = aName.toLowerCase();

    for (const item of screen?.Items().OfType(KICAD_T.SCH_HIER_LABEL_T) ?? []) {
      const label = item as SCH_HIERLABEL;
      if (label.GetText().toLowerCase() === want) return label.GetShape();
    }

    return null;
  }

  /** The SCH_NETNAME_VALIDATOR's verdict on the name: the message, or '' when it is valid. */
  ValidateName(aName: string): string {
    return new SCH_NETNAME_VALIDATOR(true).IsValid(aName);
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
      textSize: ((): string => {
        this.m_textSize.SetValue(this.m_sheetPin.GetTextWidth());
        return this.m_textSize.GetText();
      })(),
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
    this.m_textSize.SetText(aValues.textSize);
    this.m_sheetPin.SetTextSize({
      x: this.m_textSize.GetIntValue(),
      y: this.m_textSize.GetIntValue(),
    });

    // Must come after SetTextSize()
    this.m_sheetPin.SetBold(aValues.bold);
    this.m_sheetPin.SetItalic(aValues.italic);

    this.m_sheetPin.SetTextColor(aValues.color);
    this.m_sheetPin.SetShape(aValues.shape);

    if (!commit.Empty()) commit.Push(_('Edit Sheet Pin Properties'));

    return true;
  }
}

export function DialogSheetPinProperties({
  dlg,
  initial,
  units,
  onOk,
  onCancel,
}: {
  dlg: DIALOG_SHEET_PIN_PROPERTIES;
  initial: SHEET_PIN_DIALOG_VALUES;
  /** The frame's units, which `m_textSize` labels its entry with. */
  units: StatusUnits;
  onOk: (aValues: SHEET_PIN_DIALOG_VALUES) => void;
  onCancel: () => void;
}): JSX.Element {
  const [v, setV] = useState(initial);
  const [invalid, setInvalid] = useState<string | null>(null);
  const set = (patch: Partial<SHEET_PIN_DIALOG_VALUES>): void => setV((p) => ({ ...p, ...patch }));
  const shapeIndex = Math.max(
    0,
    SHAPES.findIndex((s) => s.shape === v.shape),
  );

  /** wxDialog's OK: the validator first (NETNAME_VALIDATOR::Validate), then the caller. */
  const ok = (): void => {
    const msg = dlg.ValidateName(v.name);
    if (msg) setInvalid(msg);
    else onOk(v);
  };

  return (
    <>
      <DIALOG_SHEET_PIN_PROPERTIES_BASE
        m_comboName={v.name}
        comboNameChoices={v.names}
        onComboName={(t) => set({ name: t })}
        onComboBox={(t) => {
          const shape = dlg.ShapeOfHierLabel(t);
          if (shape !== null) set({ name: t, shape });
        }}
        onSyntaxHelp={() => dlg.ShowSyntaxHelp()}
        shape={shapeIndex}
        onShape={(i) => set({ shape: SHAPES[i]!.shape })}
        font={v.face}
        onFont={(f) => set({ face: f })}
        m_bold={v.bold}
        onBold={() => set({ bold: !v.bold })}
        m_italic={v.italic}
        onItalic={() => set({ italic: !v.italic })}
        m_textSizeCtrl={v.textSize}
        onTextSize={(t) => set({ textSize: t })}
        units={unitLabel(units)}
        m_textColorSwatch={v.color}
        swatchBackground={dlg.SwatchBackground()}
        onTextColor={(c) => set({ color: c })}
        onOK={ok}
        onCancel={onCancel}
      />
      {invalid && (
        // wxMessageBox( errormsg, _( "Invalid signal name" ), wxOK | wxICON_EXCLAMATION ).
        <MessageDialogOk
          caption={_('Invalid signal name')}
          icon="warning"
          message={invalid}
          onClose={() => setInvalid(null)}
        />
      )}
    </>
  );
}
