// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_FIELD_PROPERTIES` (eeschema/dialogs/dialog_field_properties.cpp) over
 * `dialog_field_properties_base.cpp`, on a live SCH_FIELD. Opened by E, by the U/V/F keys and by a
 * double-click on a field (SCH_EDIT_TOOL::editFieldText, which applies `UpdateField` to its own
 * commit).
 *
 *     Value:  [ entry                                      ] [lib] Unit: [A]
 *     [ ] Visible      [ ] Show field name     [ ] Allow automatic placement
 *     Font:      [Default Font] | B I | ⇤ ⇔ ⇥ | ⤒ ⇕ ⤓ | ⇉ ⇊ |
 *     Text size: [    ] mils   Color: [swatch]
 *     Position X:[    ] mils
 *     Position Y:[    ] mils
 *                                              [ Cancel ] [ OK ]
 *
 *  - there is no Name box: the field's name is the label of the value entry
 *    (`m_textLabel->SetLabel( aField->GetName() + wxS( ":" ) )`);
 *  - the alignment controls are BITMAP_BUTTONs in the shared formatting bar;
 *  - the three numeric fields are UNIT_BINDERs on the frame, in its units.
 *
 * Not here: the Scintilla value editor and its auto-complete (a plain entry), and
 * `KIUI::SelectReferenceNumber` on first focus.
 */
import { Button, CheckBox } from '@ziroeda/common/wx/controls.js';
import { type JSX, useState } from 'react';
import { DisplayErrorMessage, DisplayInfoMessage } from '@ziroeda/common/confirm.js';
import { ensureFileExtension } from '@ziroeda/common/common.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import {
  ConvertPathToFileUri,
  ESCAPE_CONTEXT,
  EscapeString,
  unescapeString,
} from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { GetFieldValidationErrorMessage } from '@ziroeda/common/validators.js';
import { KiCadSchematicFileExtension } from '@ziroeda/common/wildcards_and_files_ext.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { FontChoice } from '@ziroeda/common/widgets/font_choice.js';
import type { GRID_TEXT_BUTTON_HOST } from '@ziroeda/common/widgets/grid_text_button_helpers.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import {
  type HAlign,
  TextFormatBar,
  type VAlign,
} from '@ziroeda/common/widgets/text_format_bar.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_HORIZONTAL, ANGLE_VERTICAL } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { LIB_SYMBOL } from '../lib_symbol.js';
import type { SCH_BASE_FRAME } from '../sch_base_frame.js';
import { CollectOtherUnits } from '../sch_collectors.js';
import type { SCH_COMMIT } from '../sch_commit.js';
import { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_FIELD } from '../sch_field.js';
import { AUTOPLACE_ALGO, type SCH_ITEM } from '../sch_item.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';

export interface FIELD_DIALOG_VALUES {
  /** m_TextCtrl / m_StyledTextCtrl, escaped for one line. */
  text: string;
  /** m_unitChoice's selection, 0-based; -1 while it is hidden. */
  unit: number;
  /** FONT_CHOICE: '' is "Default Font". */
  face: string;
  /** The three UNIT_BINDERs' texts, in the frame's units. */
  posX: string;
  posY: string;
  size: string;
  vertical: boolean;
  italic: boolean;
  bold: boolean;
  color: Color4d;
  hAlign: GR_TEXT_H_ALIGN_T;
  vAlign: GR_TEXT_V_ALIGN_T;
  visible: boolean;
  nameVisible: boolean;
  allowAutoplace: boolean;
}

/** The symbol netlist the footprint chooser filters by: `pin<TAB>pin…\rfilter filter…\r`. */
function symbolNetlist(aSymbol: LIB_SYMBOL | null): string {
  let netlist = '';
  const pins: string[] = [];

  for (const pin of aSymbol?.GetGraphicalPins(0 /* all units */, 1 /* single bodyStyle */) ?? []) {
    const valid = { value: false };
    const expanded = pin.GetStackedPinNumbers(valid);

    if (valid.value && expanded.length > 0) {
      for (const num of expanded) pins.push(`${num} ${pin.GetShownName()}`);
    } else {
      pins.push(`${pin.GetNumber()} ${pin.GetShownName()}`);
    }
  }

  if (pins.length > 0) netlist += EscapeString(pins.join('\t'), ESCAPE_CONTEXT.CTX_LINE);

  netlist += '\r';

  const fpFilters = aSymbol?.GetFPFilters() ?? [];

  if (fpFilters.length > 0) netlist += EscapeString(fpFilters.join(' '), ESCAPE_CONTEXT.CTX_LINE);

  netlist += '\r';

  return netlist;
}

export class DIALOG_FIELD_PROPERTIES {
  private readonly m_parent: SCH_BASE_FRAME;
  private readonly m_title: string;
  private readonly m_field: SCH_FIELD;
  private readonly m_host: GRID_TEXT_BUTTON_HOST;
  private readonly m_posX: UNIT_BINDER;
  private readonly m_posY: UNIT_BINDER;
  private readonly m_textSize: UNIT_BINDER;

  private m_text: string;
  private m_font;
  private m_isItalic: boolean;
  private m_isBold: boolean;
  private m_color: Color4d;
  private m_position: { x: number; y: number };
  private m_size: number;
  private m_isVertical: boolean;
  private m_verticalJustification: GR_TEXT_V_ALIGN_T;
  private m_horizontalJustification: GR_TEXT_H_ALIGN_T;
  private m_isVisible: boolean;
  private m_isNameVisible: boolean;
  private m_allowAutoplace: boolean;
  private m_unitSelection = -1;
  private readonly m_isSheetFilename: boolean;
  private readonly m_fieldId: FIELD_T;
  private readonly m_netlist: string = '';

  /** What init() shows, for the form. */
  readonly m_label: string;
  readonly m_useTextCtrl: boolean;
  readonly m_textEnabled: boolean;
  readonly m_showUnitSelector: boolean;
  readonly m_showSelectButton: boolean;
  readonly m_unitChoices: string[] = [];

  constructor(
    aParent: SCH_BASE_FRAME,
    aTitle: string,
    aField: SCH_FIELD,
    aHost: GRID_TEXT_BUTTON_HOST,
  ) {
    this.m_parent = aParent;
    this.m_title = aTitle;
    this.m_field = aField;
    this.m_host = aHost;
    this.m_posX = new UNIT_BINDER(aParent, 'Position X:', (aMessage) =>
      DisplayErrorMessage(aMessage),
    );
    this.m_posY = new UNIT_BINDER(aParent, 'Position Y:', (aMessage) =>
      DisplayErrorMessage(aMessage),
    );
    this.m_textSize = new UNIT_BINDER(aParent, 'Text size:', (aMessage) =>
      DisplayErrorMessage(aMessage),
    );

    // show text variable cross-references in a human-readable format
    const schematic = aField.Schematic();

    if (schematic) {
      const sheetPath = schematic.CurrentSheet();
      const variant = schematic.GetCurrentVariant();

      this.m_text = schematic.ConvertKIIDsToRefs(aField.GetText(sheetPath, variant));
    } else {
      this.m_text = aField.GetText();
    }

    this.m_font = aField.GetFont();
    this.m_isItalic = aField.IsItalic();
    this.m_isBold = aField.IsBold();
    this.m_color = aField.GetTextColor();
    this.m_size = aField.GetTextWidth();
    this.m_isVertical = aField.GetTextAngle().IsVertical();
    this.m_isVisible = aField.IsVisible();

    this.m_fieldId = aField.GetId();

    const parent = aField.GetParent();

    if (parent && parent.Type() === KICAD_T.LIB_SYMBOL_T) {
      this.m_netlist = symbolNetlist(aField.GetParentSymbol() as LIB_SYMBOL);
    } else if (parent && parent.Type() === KICAD_T.SCH_SYMBOL_T) {
      // We need the list of pins of the lib symbol, not just the pins of the current
      // sch symbol, that can be just an unit of a multi-unit symbol, to be able to
      // select/filter right footprints
      this.m_netlist = symbolNetlist((aField.GetParentSymbol() as SCH_SYMBOL).GetLibSymbolRef());
    }

    this.m_isSheetFilename = aField.GetId() === FIELD_T.SHEET_FILENAME;

    this.m_label = `${aField.GetName()}:`;

    this.m_position = aField.GetPosition();

    this.m_isNameVisible = aField.IsNameShown();
    this.m_allowAutoplace = aField.CanAutoplace();

    this.m_horizontalJustification = aField.GetEffectiveHorizJustify();
    this.m_verticalJustification = aField.GetEffectiveVertJustify();

    // init(): predefined fields cannot contain some chars and cannot be empty, so they need a
    // SCH_FIELD_VALIDATOR (m_StyledTextCtrl cannot use a SCH_FIELD_VALIDATOR).
    this.m_useTextCtrl =
      this.m_fieldId === FIELD_T.REFERENCE ||
      this.m_fieldId === FIELD_T.FOOTPRINT ||
      this.m_fieldId === FIELD_T.DATASHEET ||
      this.m_fieldId === FIELD_T.SHEET_NAME ||
      this.m_fieldId === FIELD_T.SHEET_FILENAME;

    // Show the unit selector for reference fields on multi-unit schematic symbols
    const parentSymbol = aField.GetParentSymbol();
    this.m_showUnitSelector =
      this.m_fieldId === FIELD_T.REFERENCE &&
      !!parentSymbol &&
      parentSymbol.Type() === KICAD_T.SCH_SYMBOL_T &&
      parentSymbol.IsMultiUnit();

    // Show the footprint selection dialog if this is the footprint field.
    this.m_showSelectButton = this.m_fieldId === FIELD_T.FOOTPRINT;

    this.m_textEnabled = !(this.m_isSheetFilename || aField.IsGeneratedField());
  }

  GetTitle(): string {
    return this.m_title;
  }

  /** m_note: shown for the sheet file name. */
  ShowsNote(): boolean {
    return this.m_isSheetFilename;
  }

  /** `OnTextValueSelectButtonClick`: the footprint chooser, fed the symbol netlist. */
  OnTextValueSelectButtonClick(aFpid: string): Promise<string | null> {
    return this.m_host.ChooseFootprint(aFpid, this.m_netlist);
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): FIELD_DIALOG_VALUES {
    if (this.m_showUnitSelector) {
      const symbol = this.m_field.GetParentSymbol() as SCH_SYMBOL;

      this.m_unitChoices.length = 0;

      for (let ii = 1; ii <= symbol.GetUnitCount(); ii++)
        this.m_unitChoices.push(symbol.GetUnitDisplayName(ii, false));

      if (symbol.GetUnit() <= this.m_unitChoices.length)
        this.m_unitSelection = symbol.GetUnit() - 1;
    }

    this.m_posX.SetValue(this.m_position.x);
    this.m_posY.SetValue(this.m_position.y);
    this.m_textSize.SetValue(this.m_size);

    return {
      text: EscapeString(this.m_text, ESCAPE_CONTEXT.CTX_LINE),
      unit: this.m_unitSelection,
      face: this.m_font?.GetName() ?? '',
      posX: this.m_posX.GetText(),
      posY: this.m_posY.GetText(),
      size: this.m_textSize.GetText(),
      vertical: this.m_isVertical,
      italic: this.m_isItalic,
      bold: this.m_isBold,
      color: this.m_color,
      hAlign: this.m_horizontalJustification,
      vAlign: this.m_verticalJustification,
      visible: this.m_isVisible,
      nameVisible: this.m_isNameVisible,
      allowAutoplace: this.m_allowAutoplace,
    };
  }

  /**
   * `Validate()` then `TransferDataFromWindow()`: the FIELD_VALIDATOR on m_TextCtrl refuses an
   * empty or ill-formed predefined field, and the dialog stays open.
   */
  TransferDataFromWindow(aValues: FIELD_DIALOG_VALUES): boolean {
    if (this.m_useTextCtrl && this.m_textEnabled) {
      const msg = GetFieldValidationErrorMessage(this.m_fieldId, aValues.text);

      if (msg !== '') {
        DisplayErrorMessage(msg);
        return false;
      }
    }

    this.m_text = unescapeString(aValues.text);

    if (this.m_fieldId === FIELD_T.SHEET_FILENAME)
      this.m_text = ensureFileExtension(this.m_text, KiCadSchematicFileExtension);

    this.m_posX.SetText(aValues.posX);
    this.m_posY.SetText(aValues.posY);
    this.m_textSize.SetText(aValues.size);

    this.m_position = { x: this.m_posX.GetIntValue(), y: this.m_posY.GetIntValue() };
    this.m_size = this.m_textSize.GetIntValue();

    this.m_font =
      aValues.face === '' ? null : FONT.GetFont(aValues.face, aValues.bold, aValues.italic);

    this.m_isVertical = aValues.vertical;

    this.m_isBold = aValues.bold;
    this.m_isItalic = aValues.italic;
    this.m_color = aValues.color;

    this.m_horizontalJustification = aValues.hAlign;
    this.m_verticalJustification = aValues.vAlign;

    this.m_isVisible = aValues.visible;
    this.m_isNameVisible = aValues.nameVisible;
    this.m_allowAutoplace = aValues.allowAutoplace;
    this.m_unitSelection = aValues.unit;

    return true;
  }

  private updateText(aField: SCH_FIELD): void {
    if (aField.GetTextWidth() !== this.m_size)
      aField.SetTextSize({ x: this.m_size, y: this.m_size });

    aField.SetFont(this.m_font);
    aField.SetVisible(this.m_isVisible);
    aField.SetTextAngle(this.m_isVertical ? ANGLE_VERTICAL : ANGLE_HORIZONTAL);
    aField.SetItalic(this.m_isItalic);
    aField.SetBold(this.m_isBold);
    aField.SetTextColor(this.m_color);
  }

  /** `UpdateField( SCH_COMMIT*, SCH_FIELD*, SCH_SHEET_PATH* )`. */
  UpdateField(aCommit: SCH_COMMIT, aField: SCH_FIELD, aSheetPath: SCH_SHEET_PATH): void {
    const editFrame = this.m_parent instanceof SCH_EDIT_FRAME ? this.m_parent : null;
    const parent = aField.GetParent() as SCH_ITEM | null;
    let fieldTextSet = false;
    let sheetPath: SCH_SHEET_PATH | null = null;
    let variantName = '';
    const schematic = aField.Schematic();

    // convert any text variable cross-references to their UUIDs
    if (schematic) this.m_text = schematic.ConvertRefsToKIIDs(this.m_text);

    if (aField.GetId() !== FIELD_T.SHEET_FILENAME)
      this.m_text = ConvertPathToFileUri(this.m_text, this.m_parent.Prj());

    if (schematic) {
      sheetPath = schematic.CurrentSheet();
      variantName = schematic.GetCurrentVariant();
    }

    if (parent && parent.Type() === KICAD_T.SCH_SYMBOL_T) {
      const symbol = parent as SCH_SYMBOL;

      if (this.m_fieldId === FIELD_T.REFERENCE) symbol.SetRef(aSheetPath, this.m_text);
      else symbol.SetFieldText(aField.GetName(), this.m_text, sheetPath, variantName);

      fieldTextSet = true;

      // Set the unit selection in multiple units per package
      if (this.m_showUnitSelector) {
        const unit_selection = this.m_unitSelection + 1;
        symbol.SetUnitSelection(aSheetPath, unit_selection);
        symbol.SetUnit(unit_selection);
      }
    } else if (parent && parent.Type() === KICAD_T.SCH_SHEET_T) {
      const sheet = parent as SCH_SHEET;

      if (!aField.IsMandatory()) {
        sheet.SetFieldText(aField.GetName(), this.m_text, sheetPath, variantName);
        fieldTextSet = true;
      }
    } else if (parent && parent.Type() === KICAD_T.SCH_GLOBAL_LABEL_T) {
      if (this.m_fieldId === FIELD_T.INTERSHEET_REFS) {
        if (this.m_isVisible !== parent.Schematic()!.Settings().m_IntersheetRefsShow) {
          void DisplayInfoMessage(
            'Intersheet reference visibility is controlled globally from ' +
              'Schematic Setup > General > Formatting',
          );
        }
      }
    }

    let positioningModified = false;
    const pos = aField.GetPosition();

    if (pos.x !== this.m_position.x || pos.y !== this.m_position.y) positioningModified = true;

    if (aField.GetTextAngle().IsVertical() !== this.m_isVertical) positioningModified = true;

    if (aField.GetEffectiveHorizJustify() !== this.m_horizontalJustification)
      positioningModified = true;

    if (aField.GetEffectiveVertJustify() !== this.m_verticalJustification)
      positioningModified = true;

    // Changing a sheetname need to update the hierarchy navigator
    let needUpdateHierNav = false;

    if (this.m_fieldId === FIELD_T.SHEET_NAME) needUpdateHierNav = this.m_text !== aField.GetText();

    if (!fieldTextSet) aField.SetText(this.m_text);

    this.updateText(aField);
    aField.SetPosition(this.m_position);

    aField.SetNameShown(this.m_isNameVisible);
    aField.SetCanAutoplace(this.m_allowAutoplace);

    // Note that we must set justifications before we can ask if they're flipped.  If the old
    // justification is center then it won't know (whereas if the new justification is center
    // the we don't care).
    aField.SetHorizJustify(this.m_horizontalJustification);
    aField.SetVertJustify(this.m_verticalJustification);

    if (aField.IsHorizJustifyFlipped())
      aField.SetHorizJustify(EDA_TEXT.MapHorizJustify(-this.m_horizontalJustification));

    if (aField.IsVertJustifyFlipped())
      aField.SetVertJustify(EDA_TEXT.MapVertJustify(-this.m_verticalJustification));

    // The value, footprint and datasheet fields should be kept in sync in multi-unit parts.
    // Of course the symbol must be annotated to collect other units.
    if (editFrame && parent && parent.Type() === KICAD_T.SCH_SYMBOL_T) {
      const symbol = parent as SCH_SYMBOL;

      if (
        symbol.IsAnnotated(aSheetPath) &&
        (this.m_fieldId === FIELD_T.VALUE ||
          this.m_fieldId === FIELD_T.FOOTPRINT ||
          this.m_fieldId === FIELD_T.DATASHEET)
      ) {
        const ref = symbol.GetRef(aSheetPath);
        const unit = symbol.GetUnit();
        const libId = symbol.GetLibId();

        for (const sheet of editFrame.Schematic().Hierarchy()) {
          const screen = sheet.LastScreen();
          const otherUnits: SCH_SYMBOL[] = [];

          CollectOtherUnits(ref, unit, libId, sheet, otherUnits);

          for (const otherUnit of otherUnits) {
            aCommit.Modify(otherUnit, screen);
            otherUnit.GetField(this.m_fieldId)!.SetText(this.m_text, sheet, variantName);
            editFrame.UpdateItem(otherUnit, false, true);
          }
        }
      }
    }

    if (positioningModified && parent) parent.SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_NONE);

    // Update the hierarchy navigator labels if needed.
    if (editFrame && needUpdateHierNav) editFrame.UpdateLabelsHierarchyNavigator();
  }
}

const H_OF: Record<number, HAlign> = {
  [GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT]: 'left',
  [GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER]: 'center',
  [GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT]: 'right',
};
const V_OF: Record<number, VAlign> = {
  [GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP]: 'top',
  [GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER]: 'center',
  [GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM]: 'bottom',
};
const H_FROM: Record<HAlign, GR_TEXT_H_ALIGN_T> = {
  left: GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT,
  center: GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER,
  right: GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT,
};
const V_FROM: Record<VAlign, GR_TEXT_V_ALIGN_T> = {
  top: GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP,
  center: GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER,
  bottom: GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM,
};

/** The form over DIALOG_FIELD_PROPERTIES. */
export function DialogFieldProperties({
  dlg,
  initial,
  units,
  onOk,
  onCancel,
}: {
  dlg: DIALOG_FIELD_PROPERTIES;
  initial: FIELD_DIALOG_VALUES;
  units: StatusUnits;
  onOk: (aValues: FIELD_DIALOG_VALUES) => void;
  onCancel: () => void;
}): JSX.Element {
  const [text, setText] = useState(initial.text);
  const [unit, setUnit] = useState(initial.unit);
  const [face, setFace] = useState(initial.face);
  const [posX, setPosX] = useState(initial.posX);
  const [posY, setPosY] = useState(initial.posY);
  const [size, setSize] = useState(initial.size);
  const [vertical, setVertical] = useState(initial.vertical);
  const [italic, setItalic] = useState(initial.italic);
  const [bold, setBold] = useState(initial.bold);
  const [color, setColor] = useState(initial.color);
  const [hAlign, setHAlign] = useState<HAlign>(H_OF[initial.hAlign] ?? 'center');
  const [vAlign, setVAlign] = useState<VAlign>(V_OF[initial.vAlign] ?? 'center');
  const [visible, setVisible] = useState(initial.visible);
  const [nameVisible, setNameVisible] = useState(initial.nameVisible);
  const [allowAutoplace, setAllowAutoplace] = useState(initial.allowAutoplace);

  const submit = (): void =>
    onOk({
      text,
      unit,
      face,
      posX,
      posY,
      size,
      vertical,
      italic,
      bold,
      color,
      hAlign: H_FROM[hAlign],
      vAlign: V_FROM[vAlign],
      visible,
      nameVisible,
      allowAutoplace,
    });

  const enter = (e: React.KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <DialogShim title={dlg.GetTitle()} onClose={onCancel} className="ze-label-dialog">
      <div className="ze-label-dialog-body">
        {/* bTextValueBoxSizer: m_textLabel wears the field's own name. */}
        <label className="row">
          <span>{dlg.m_label}</span>
          <input
            className="ze-search"
            // biome-ignore lint/a11y/noAutofocus: SetInitialFocus( m_TextCtrl )
            autoFocus
            value={text}
            disabled={!dlg.m_textEnabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={enter}
          />
          {dlg.m_showSelectButton && (
            <StdBitmapButton
              bitmap="small_library"
              title="Select footprint"
              tooltip={null}
              onClick={() => {
                void dlg.OnTextValueSelectButtonClick(text).then((fpid) => {
                  if (fpid !== null) setText(fpid);
                });
              }}
            />
          )}
          {dlg.m_showUnitSelector && (
            <>
              <span className="ze-fieldprops-unit">Unit:</span>
              <Combo
                value={String(unit)}
                options={dlg.m_unitChoices.map((c, i) => ({ value: String(i), label: c }))}
                onChange={(v) => setUnit(Number(v))}
              />
            </>
          )}
        </label>
        {dlg.ShowsNote() && (
          <div className="ze-fieldprops-note">
            Sheet filename can only be modified in Sheet Properties dialog.
          </div>
        )}

        {/* bSizer9: the three checkboxes on ONE row, spaced apart. */}
        <div className="ze-fieldprops-checks">
          <CheckBox
            label="Visible"
            checked={visible}
            className="chk"
            onChange={(v) => setVisible(v)}
          />
          <CheckBox
            label="Show field name"
            checked={nameVisible}
            title="Show the field name in addition to its value"
            className="chk"
            onChange={(v) => setNameVisible(v)}
          />
          <CheckBox
            label="Allow automatic placement"
            checked={allowAutoplace}
            title="Allow automatic placement of this field in the schematic"
            className="chk"
            onChange={(v) => setAllowAutoplace(v)}
          />
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
              angle={vertical ? 90 : 0}
              onAngle={(a) => setVertical(a === 90)}
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
                color={color}
                onChange={setColor}
              />
            </span>
          </div>

          {/* gbSizer1 leaves row 2 empty at SetEmptyCellSize's 10 px: the
            size row is row 1 and Position X is row 3. */}
          <div className="ze-fieldprops-gap" />

          <span className="ze-lp-fmt-label">Position X:</span>
          <div className="ze-lp-sizerow">
            <input
              className="ze-lp-size"
              value={posX}
              onChange={(e) => setPosX(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span className="ze-lp-units">{unitLabel(units)}</span>
          </div>

          <span className="ze-lp-fmt-label">Position Y:</span>
          <div className="ze-lp-sizerow">
            <input
              className="ze-lp-size"
              value={posY}
              onChange={(e) => setPosY(e.target.value)}
              onKeyDown={enter}
            />
            <span className="ze-lp-units">{unitLabel(units)}</span>
          </div>
        </div>
      </div>
      {/* m_sdbSizerButtons: GTK orders the standard sizer Cancel then OK. */}
      <div className="ze-modal-footer">
        <Button label="Cancel" onClick={onCancel} />
        <Button label="OK" isDefault onClick={submit} />
      </div>
    </DialogShim>
  );
}
