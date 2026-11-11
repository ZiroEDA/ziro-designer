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
import { type JSX, useState } from 'react';
import { DisplayErrorMessage, DisplayInfoMessage } from '@ziroeda/common/confirm.js';
import { ensureFileExtension } from '@ziroeda/common/common.js';
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
import type { GRID_TEXT_BUTTON_HOST } from '@ziroeda/common/widgets/grid_text_button_helpers.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import { DIALOG_FIELD_PROPERTIES_BASE } from './dialog_field_properties_base.js';
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
import { _ } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

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
    this.m_posX = new UNIT_BINDER(aParent, _('Position X:'), (aMessage) =>
      DisplayErrorMessage(aMessage),
    );
    this.m_posY = new UNIT_BINDER(aParent, _('Position Y:'), (aMessage) =>
      DisplayErrorMessage(aMessage),
    );
    this.m_textSize = new UNIT_BINDER(aParent, _('Text size:'), (aMessage) =>
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

  /** `m_textColorSwatch->SetSwatchBackground( schematicBackground )`. */
  SwatchBackground(): Color4d {
    return this.m_parent.GetDrawBgColor();
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

  /**
   * `UpdateField( SCH_FIELD* aField )` (dialog_field_properties.cpp:590), the symbol editor's:
   * the text, its look, the name and autoplace flags, the justification and the position, with
   * no commit and no other unit to keep in step. Or `UpdateField( SCH_COMMIT*, SCH_FIELD*,
   * SCH_SHEET_PATH* )`, below.
   */
  UpdateField(aField: SCH_FIELD): void;
  UpdateField(aCommit: SCH_COMMIT, aField: SCH_FIELD, aSheetPath: SCH_SHEET_PATH): void;
  UpdateField(
    aCommitOrField: SCH_COMMIT | SCH_FIELD,
    aField?: SCH_FIELD,
    aSheetPath?: SCH_SHEET_PATH,
  ): void {
    if (aField === undefined) {
      const field = aCommitOrField as SCH_FIELD;
      const schematic = field.Schematic();

      if (schematic)
        field.SetText(this.m_text, schematic.CurrentSheet(), schematic.GetCurrentVariant());
      else field.SetText(this.m_text);

      this.updateText(field);

      field.SetNameShown(this.m_isNameVisible);
      field.SetCanAutoplace(this.m_allowAutoplace);

      field.SetHorizJustify(EDA_TEXT.MapHorizJustify(this.m_horizontalJustification));
      field.SetVertJustify(EDA_TEXT.MapVertJustify(this.m_verticalJustification));
      field.SetTextPos(this.m_position);
      return;
    }

    this.updateFieldInSchematic(aCommitOrField as SCH_COMMIT, aField, aSheetPath!);
  }

  /** `UpdateField( SCH_COMMIT*, SCH_FIELD*, SCH_SHEET_PATH* )`. */
  private updateFieldInSchematic(
    aCommit: SCH_COMMIT,
    aField: SCH_FIELD,
    aSheetPath: SCH_SHEET_PATH,
  ): void {
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

/** formattingSizer's alignment buttons: value, bitmap, tooltip. */
const H_BUTTONS = [
  [GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT, 'text_align_left', _HKI('Align left')],
  [GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER, 'text_align_center', _HKI('Align horizontal center')],
  [GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT, 'text_align_right', _HKI('Align right')],
] as const;
const V_BUTTONS = [
  [GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP, 'text_valign_top', _HKI('Align top')],
  [GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER, 'text_valign_center', _HKI('Align vertical center')],
  [GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM, 'text_valign_bottom', _HKI('Align bottom')],
] as const;

/** DIALOG_FIELD_PROPERTIES' window over its base. */
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
  const [v, setV] = useState(initial);
  const set = (patch: Partial<FIELD_DIALOG_VALUES>): void => setV((p) => ({ ...p, ...patch }));
  const icon = (bitmap: string, tooltip: string, checked: boolean, onClick: () => void) => ({
    bitmap,
    tooltip,
    checked,
    onClick,
  });

  return (
    <DIALOG_FIELD_PROPERTIES_BASE
      title={dlg.GetTitle()}
      m_textLabel={dlg.m_label}
      m_text={v.text}
      onText={(t) => set({ text: t })}
      textEnabled={dlg.m_textEnabled}
      selectButtonShown={dlg.m_showSelectButton}
      onTextValueSelectButtonClick={() => {
        void dlg.OnTextValueSelectButtonClick(v.text).then((fpid) => {
          if (fpid !== null) set({ text: fpid });
        });
      }}
      unitShown={dlg.m_showUnitSelector}
      unitChoices={dlg.m_unitChoices}
      m_unitChoice={{ value: v.unit, onChange: (i) => set({ unit: i }) }}
      noteShown={dlg.ShowsNote()}
      m_visible={{ value: v.visible, onChange: (on) => set({ visible: on }) }}
      m_nameVisible={{ value: v.nameVisible, onChange: (on) => set({ nameVisible: on }) }}
      m_cbAllowAutoPlace={{
        value: v.allowAutoplace,
        onChange: (on) => set({ allowAutoplace: on }),
      }}
      font={v.face}
      onFont={(f) => set({ face: f })}
      m_bold={icon('text_bold', _('Bold'), v.bold, () => set({ bold: !v.bold }))}
      m_italic={icon('text_italic', _('Italic'), v.italic, () => set({ italic: !v.italic }))}
      hAlign={H_BUTTONS.map(([a, bitmap, tip]) =>
        icon(bitmap, tip, v.hAlign === a, () => set({ hAlign: a })),
      )}
      vAlign={V_BUTTONS.map(([a, bitmap, tip]) =>
        icon(bitmap, tip, v.vAlign === a, () => set({ vAlign: a })),
      )}
      orientation={[
        icon('text_horizontal', _('Horizontal text'), !v.vertical, () => set({ vertical: false })),
        icon('text_vertical', _('Vertical text'), v.vertical, () => set({ vertical: true })),
      ]}
      m_textSizeCtrl={v.size}
      onTextSize={(t) => set({ size: t })}
      m_xPosCtrl={v.posX}
      onXPos={(t) => set({ posX: t })}
      m_yPosCtrl={v.posY}
      onYPos={(t) => set({ posY: t })}
      units={unitLabel(units)}
      m_textColorSwatch={v.color}
      swatchBackground={dlg.SwatchBackground()}
      onTextColor={(c) => set({ color: c })}
      onOK={() => onOk(v)}
      onCancel={onCancel}
    />
  );
}
