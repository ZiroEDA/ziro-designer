// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SYMBOL_PROPERTIES` (eeschema/dialogs/dialog_symbol_properties.cpp) with its
 * `SCH_PIN_TABLE_DATA_MODEL`, over `dialog_symbol_properties_base.cpp`, on a live SCH_SYMBOL.
 * Opened by SCH_EDIT_TOOL::Properties, which reads the return code (wxID_OK, or one of the
 * SYMBOL_PROPS_* hand-offs) and acts on it.
 *
 * General page: the fields grid (FIELDS_GRID_TABLE), then General (unit, body style, angle,
 * mirror, pin text), Attributes and the hand-off buttons. Pin Functions: the pins of the chosen
 * unit with their alternate assignments. Embedded Files: the library symbol's files, shown.
 *
 * Not here: DIALOG_SIM_MODEL behind "Simulation Model..." (the simulator is not in this build),
 * PANEL_EMBEDDED_FILES' add / remove / export, and KIUI::SelectReferenceNumber on first focus.
 */
import { Button, CheckBox } from '@ziroeda/common/wx/controls.js';
import { type JSX, useReducer, useState } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import { PIN_NUMBERS } from '@ziroeda/common/pin_numbers.js';
import { strNumCmp, unescapeString } from '@ziroeda/common/string_utils.js';
import {
  DO_TRANSLATE,
  FIELD_T,
  FieldNamesAreDuplicates,
  GetUserFieldName,
} from '@ziroeda/common/template_fieldnames.js';
import { GRID_CELL_COMBOBOX } from '@ziroeda/common/widgets/grid_combobox.js';
import { GRID_CELL_ICON_TEXT_RENDERER } from '@ziroeda/common/widgets/grid_icon_text_helpers.js';
import type { GRID_TEXT_BUTTON_HOST } from '@ziroeda/common/widgets/grid_text_button_helpers.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { WX_GRID, WX_GRID_TABLE_BASE } from '@ziroeda/common/widgets/wx_grid.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import {
  type wxAttrKind,
  type wxGridEvent,
  wxEVT_GRID_CELL_CHANGING,
  wxEVT_GRID_COL_SORT,
  wxGridCellAttr,
  wxGridSelectionModes,
  wxGridTableRequest,
} from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import { wxID_OK } from '@ziroeda/common/wx/menu.js';
import { FIELDS_DATA_COL_ORDER, FIELDS_GRID_TABLE } from '../fields_grid_table.js';
import type { LIB_SYMBOL } from '../lib_symbol.js';
import { PinShapeIcons, PinShapeNames, PinTypeIcons, PinTypeNames } from '../pin_type.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_FIELD } from '../sch_field.js';
import { SCH_PIN } from '../sch_pin.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';
import { SYMBOL_ORIENTATION_T } from '../symbol.js';
import { SYMBOL_PROPS_RETVALUE } from '../tools/sch_edit_tool.js';

/** The pin table's columns (dialog_symbol_properties.cpp:58). */
export enum PIN_TABLE_COL_ORDER {
  COL_NUMBER,
  COL_BASE_NAME,
  COL_ALT_NAME,
  COL_TYPE,
  COL_SHAPE,

  COL_COUNT, // keep as last
}

const { COL_NUMBER, COL_BASE_NAME, COL_ALT_NAME, COL_TYPE, COL_SHAPE, COL_COUNT } =
  PIN_TABLE_COL_ORDER;

/** `SCH_PIN_TABLE_DATA_MODEL`: copies of the symbol's pins, their alternates editable. */
export class SCH_PIN_TABLE_DATA_MODEL extends WX_GRID_TABLE_BASE {
  private m_pins: SCH_PIN[] = [];
  private m_nameAttrs: wxGridCellAttr[] = [];
  private m_readOnlyAttr: wxGridCellAttr | null = null;
  private m_typeAttr: wxGridCellAttr | null = null;
  private m_shapeAttr: wxGridCellAttr | null = null;

  Pins(): readonly SCH_PIN[] {
    return this.m_pins;
  }

  push_back(aPin: SCH_PIN): void {
    this.m_pins.push(aPin);
  }

  clear(): void {
    this.m_pins = [];
  }

  BuildAttrs(): void {
    this.m_nameAttrs = [];

    this.m_readOnlyAttr = new wxGridCellAttr();
    this.m_readOnlyAttr.SetReadOnly(true);

    for (const pin of this.m_pins) {
      const lib_pin = pin.GetLibPin();
      const attr = new wxGridCellAttr();

      if (!lib_pin || lib_pin.GetAlternates().size === 0) {
        attr.SetReadOnly(true);
        // KIPLATFORM::UI::GetDialogBGColour(): wxSYS_COLOUR_BTNFACE
        attr.SetBackgroundColour('var(--ctl-face)');
      } else {
        const choices = [lib_pin.GetName()];

        for (const alt of lib_pin.GetAlternates().keys()) choices.push(alt);

        attr.SetEditor(new GRID_CELL_COMBOBOX(choices));
      }

      this.m_nameAttrs.push(attr);
    }

    this.m_typeAttr = new wxGridCellAttr();
    this.m_typeAttr.SetRenderer(new GRID_CELL_ICON_TEXT_RENDERER(PinTypeIcons(), PinTypeNames()));
    this.m_typeAttr.SetReadOnly(true);

    this.m_shapeAttr = new wxGridCellAttr();
    this.m_shapeAttr.SetRenderer(
      new GRID_CELL_ICON_TEXT_RENDERER(PinShapeIcons(), PinShapeNames()),
    );
    this.m_shapeAttr.SetReadOnly(true);
  }

  override GetNumberRows(): number {
    return this.m_pins.length;
  }

  override GetNumberCols(): number {
    return COL_COUNT;
  }

  override GetColLabelValue(aCol: number): string {
    switch (aCol) {
      case COL_NUMBER:
        return 'Number';
      case COL_BASE_NAME:
        return 'Base Name';
      case COL_ALT_NAME:
        return 'Alternate Assignment';
      case COL_TYPE:
        return 'Electrical Type';
      case COL_SHAPE:
        return 'Graphic Style';
      default:
        console.assert(false);
        return '';
    }
  }

  override IsEmptyCell(_row: number, _col: number): boolean {
    return false; // don't allow adjacent cell overflow, even if we are actually empty
  }

  override CanSetValueAs(_aRow: number, _aCol: number, _aTypeName: string): boolean {
    // Don't accept random values; must use the popup to change to a known alternate
    return false;
  }

  override GetValue(aRow: number, aCol: number): string {
    return SCH_PIN_TABLE_DATA_MODEL.GetValue(this.m_pins[aRow]!, aCol);
  }

  static GetValue(aPin: SCH_PIN, aCol: number): string {
    if (aCol === COL_ALT_NAME) {
      if (!aPin.GetLibPin() || aPin.GetLibPin()!.GetAlternates().size === 0) return '';
      else if (aPin.GetAlt() === '') return aPin.GetName();
      else return aPin.GetAlt();
    }

    switch (aCol) {
      case COL_NUMBER:
        return aPin.GetNumber();
      case COL_BASE_NAME:
        return aPin.GetBaseName();
      case COL_TYPE:
        return PinTypeNames()[aPin.GetType()] ?? '';
      case COL_SHAPE:
        return PinShapeNames()[aPin.GetShape()] ?? '';
      default:
        console.assert(false);
        return '';
    }
  }

  override GetAttr(aRow: number, aCol: number, aKind: wxAttrKind): wxGridCellAttr | null {
    switch (aCol) {
      case COL_NUMBER:
      case COL_BASE_NAME:
        return this.enhanceAttr(this.m_readOnlyAttr, aRow, aCol, aKind);

      case COL_ALT_NAME:
        return this.enhanceAttr(this.m_nameAttrs[aRow] ?? null, aRow, aCol, aKind);

      case COL_TYPE:
        return this.enhanceAttr(this.m_typeAttr, aRow, aCol, aKind);

      case COL_SHAPE:
        return this.enhanceAttr(this.m_shapeAttr, aRow, aCol, aKind);

      default:
        console.assert(false);
        return null;
    }
  }

  override SetValue(aRow: number, aCol: number, aValue: string): void {
    const pin = this.m_pins[aRow]!;

    switch (aCol) {
      case COL_ALT_NAME:
        if (pin.GetLibPin() && aValue === pin.GetLibPin()!.GetName()) pin.SetAlt('');
        else pin.SetAlt(aValue);
        break;

      case COL_NUMBER:
      case COL_BASE_NAME:
      case COL_TYPE:
      case COL_SHAPE:
        // Read-only.
        break;

      default:
        console.assert(false);
        break;
    }
  }

  static compare(lhs: SCH_PIN, rhs: SCH_PIN, aSortCol: number, ascending: boolean): boolean {
    let sortCol = aSortCol;
    let lhStr = SCH_PIN_TABLE_DATA_MODEL.GetValue(lhs, sortCol);
    let rhStr = SCH_PIN_TABLE_DATA_MODEL.GetValue(rhs, sortCol);

    if (lhStr === rhStr) {
      // Secondary sort key is always COL_NUMBER
      sortCol = COL_NUMBER;
      lhStr = SCH_PIN_TABLE_DATA_MODEL.GetValue(lhs, sortCol);
      rhStr = SCH_PIN_TABLE_DATA_MODEL.GetValue(rhs, sortCol);
    }

    // N.B. To meet the iterator sort conditions, we cannot simply invert the truth
    // to get the opposite sort.  i.e. ~(a<b) != (a>b)
    const cmp = (a: number, b: number): boolean => (ascending ? a < b : b < a);

    switch (sortCol) {
      case COL_NUMBER:
      case COL_BASE_NAME:
      case COL_ALT_NAME:
        return cmp(PIN_NUMBERS.Compare(lhStr, rhStr), 0);
      case COL_TYPE:
      case COL_SHAPE: {
        const l = lhStr.toLowerCase();
        const r = rhStr.toLowerCase();
        return cmp(l < r ? -1 : l > r ? 1 : 0, 0);
      }
      default:
        return cmp(strNumCmp(lhStr, rhStr), 0);
    }
  }

  SortRows(aSortCol: number, ascending: boolean): void {
    this.m_pins.sort((lhs, rhs) =>
      SCH_PIN_TABLE_DATA_MODEL.compare(lhs, rhs, aSortCol, ascending)
        ? -1
        : SCH_PIN_TABLE_DATA_MODEL.compare(rhs, lhs, aSortCol, ascending)
          ? 1
          : 0,
    );
  }
}

export interface SYMBOL_DIALOG_VALUES {
  /** m_unitChoice's selection, 0-based; -1 while it is disabled. */
  unit: number;
  /** m_bodyStyleChoice's selection, 0-based; -1 while it is disabled. */
  bodyStyle: number;
  /** m_orientationCtrl: 0, +90, -90, 180. */
  orientation: number;
  /** m_mirrorCtrl: not mirrored, around X, around Y. */
  mirror: number;
  excludeFromSim: boolean;
  excludeFromBom: boolean;
  excludeFromBoard: boolean;
  excludeFromPosFiles: boolean;
  dnp: boolean;
  showPinNumbers: boolean;
  showPinNames: boolean;
}

export class DIALOG_SYMBOL_PROPERTIES {
  private readonly m_parent: SCH_EDIT_FRAME;
  private readonly m_symbol: SCH_SYMBOL;
  private readonly m_part: LIB_SYMBOL | null;
  private readonly m_fieldsGrid = new WX_GRID();
  private readonly m_pinGrid = new WX_GRID();
  private readonly m_fields: FIELDS_GRID_TABLE;
  private readonly m_dataModel: SCH_PIN_TABLE_DATA_MODEL | null = null;

  readonly m_title: string;
  readonly m_unitChoices: string[] = [];
  readonly m_bodyStyleChoices: string[] = [];
  /** m_pinTablePage->Disable(): multiple body styles. */
  readonly m_pinsDisabled: boolean;
  /** m_spiceFieldsButton->Hide() for a power symbol. */
  readonly m_isPower: boolean;
  /** onUpdateEditSymbol / onUpdateEditLibrarySymbol: a library symbol to open. */
  readonly m_canEditSymbol: boolean;
  m_libraryId = '';

  constructor(aParent: SCH_EDIT_FRAME, aSymbol: SCH_SYMBOL, aHost: GRID_TEXT_BUTTON_HOST) {
    this.m_parent = aParent;
    this.m_symbol = aSymbol;
    this.m_part = aSymbol.GetLibSymbolRef();

    this.m_fields = new FIELDS_GRID_TABLE(this, aParent, this.m_fieldsGrid, aSymbol, aHost);

    this.m_fieldsGrid.SetTable(this.m_fields, false, wxGridSelectionModes.wxGridSelectRows);
    this.m_fieldsGrid.ShowHideColumns('0 1 2 3 4 5 6 7');

    if (this.m_part?.IsMultiBodyStyle()) {
      // Multiple body styles are a superclass of alternate pin assignments, so don't allow
      // free-form alternate assignments as well.  (We won't know how to map the alternates
      // back and forth when the body style is changed.)
      this.m_pinsDisabled = true;
    } else {
      this.m_pinsDisabled = false;
      const dataModel = new SCH_PIN_TABLE_DATA_MODEL();

      // Make a copy of the pins for editing
      for (const pin of aSymbol.GetRawPins()) dataModel.push_back(SCH_PIN.copyOf(pin));

      dataModel.SortRows(COL_NUMBER, true);
      dataModel.BuildAttrs();

      this.m_pinGrid.SetTable(dataModel, false, wxGridSelectionModes.wxGridSelectRows);
      this.m_dataModel = dataModel;
    }

    this.m_isPower = !!this.m_part?.IsPower();
    this.m_canEditSymbol = this.m_part !== null;

    // wxFormBuilder doesn't include this event...
    this.m_fieldsGrid.Connect(wxEVT_GRID_CELL_CHANGING, (aEvent: wxGridEvent) =>
      this.OnGridCellChanging(aEvent),
    );
    this.m_pinGrid.Connect(wxEVT_GRID_COL_SORT, (aEvent: wxGridEvent) =>
      this.OnPinTableColSort(aEvent),
    );

    // Remind user that they are editing the current variant.
    const variant = aParent.Schematic().GetCurrentVariant();
    this.m_title =
      variant === '' ? 'Symbol Properties' : `Symbol Properties - ${variant} Design Variant`;
  }

  FieldsGrid(): WX_GRID {
    return this.m_fieldsGrid;
  }

  PinGrid(): WX_GRID {
    return this.m_pinGrid;
  }

  Fields(): FIELDS_GRID_TABLE {
    return this.m_fields;
  }

  PinModel(): SCH_PIN_TABLE_DATA_MODEL | null {
    return this.m_dataModel;
  }

  /** `DIALOG_SHIM::OnModify()`: nothing reads the modified flag here. */
  OnModify(): void {}

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): SYMBOL_DIALOG_VALUES {
    const schematic = this.m_parent.Schematic();
    const sheetPath = schematic.CurrentSheet();
    const variantName = schematic.GetCurrentVariant();
    const defined = new Set<string>();
    const pos = this.m_symbol.GetPosition();

    // Push a copy of each field into m_updateFields
    for (const srcField of this.m_symbol.GetFields()) {
      const field = SCH_FIELD.copyOf(srcField);

      // change offset to be symbol-relative
      field.Offset({ x: -pos.x, y: -pos.y });
      field.SetText(
        schematic.ConvertKIIDsToRefs(
          this.m_symbol.GetFieldText(field.GetName(), sheetPath, variantName),
        ),
      );

      defined.add(field.GetName());
      this.m_fields.push_back(field);
    }

    // Add in any template fieldnames not yet defined:
    for (const templateFieldname of schematic
      .Settings()
      .m_TemplateFieldNames.GetTemplateFieldNames()) {
      if (!defined.has(templateFieldname.m_Name)) {
        const field = new SCH_FIELD(this.m_symbol, FIELD_T.USER, templateFieldname.m_Name);
        field.SetVisible(templateFieldname.m_Visible);
        this.m_fields.push_back(field);
      }
    }

    // notify the grid
    this.m_fieldsGrid.ProcessTableMessage(
      wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED,
      this.m_fields.GetNumberRows(),
      0,
    );

    let unit = -1;

    // If a multi-unit symbol, set up the unit selector and interchangeable checkbox.
    if (this.m_symbol.IsMultiUnit()) {
      // Ensure symbol unit is the currently selected unit (mandatory in complex hierarchies)
      // from the current sheet path, because it can be modified by previous calculations
      this.m_symbol.SetUnit(this.m_symbol.GetUnitSelection(sheetPath));

      for (let ii = 1; ii <= this.m_symbol.GetUnitCount(); ii++)
        this.m_unitChoices.push(this.m_symbol.GetUnitDisplayName(ii, false));

      if (this.m_symbol.GetUnit() <= this.m_unitChoices.length) unit = this.m_symbol.GetUnit() - 1;
    }

    let bodyStyle = -1;

    if (this.m_part?.IsMultiBodyStyle()) {
      if (this.m_part.HasDeMorganBodyStyles()) {
        this.m_bodyStyleChoices.push('Standard', 'Alternate');
      } else {
        for (let ii = 0; ii < this.m_part.GetBodyStyleCount(); ii++)
          this.m_bodyStyleChoices.push(this.m_part.GetBodyStyleNames()[ii] ?? '???');
      }

      if (this.m_symbol.GetBodyStyle() <= this.m_bodyStyleChoices.length)
        bodyStyle = this.m_symbol.GetBodyStyle() - 1;
    }

    // Set the symbol orientation and mirroring.
    const orientation =
      this.m_symbol.GetOrientation() &
      ~(SYMBOL_ORIENTATION_T.SYM_MIRROR_X | SYMBOL_ORIENTATION_T.SYM_MIRROR_Y);
    let orientationSel = 0;

    switch (orientation) {
      case SYMBOL_ORIENTATION_T.SYM_ORIENT_90:
        orientationSel = 1;
        break;
      case SYMBOL_ORIENTATION_T.SYM_ORIENT_270:
        orientationSel = 2;
        break;
      case SYMBOL_ORIENTATION_T.SYM_ORIENT_180:
        orientationSel = 3;
        break;
      default:
        orientationSel = 0;
        break;
    }

    const mirror =
      this.m_symbol.GetOrientation() &
      (SYMBOL_ORIENTATION_T.SYM_MIRROR_X | SYMBOL_ORIENTATION_T.SYM_MIRROR_Y);

    // Set the symbol's library name.
    this.m_libraryId = unescapeString(this.m_symbol.GetLibId().Format());

    return {
      unit,
      bodyStyle,
      orientation: orientationSel,
      mirror:
        mirror === SYMBOL_ORIENTATION_T.SYM_MIRROR_X
          ? 1
          : mirror === SYMBOL_ORIENTATION_T.SYM_MIRROR_Y
            ? 2
            : 0,
      excludeFromSim: this.m_symbol.GetExcludedFromSim(sheetPath, variantName),
      excludeFromBom: this.m_symbol.GetExcludedFromBOM(sheetPath, variantName),
      excludeFromBoard: this.m_symbol.GetExcludedFromBoard(sheetPath, variantName),
      excludeFromPosFiles: this.m_symbol.GetExcludedFromPosFiles(sheetPath, variantName),
      dnp: this.m_symbol.GetDNP(sheetPath, variantName),
      showPinNumbers: this.m_part ? this.m_part.GetShowPinNumbers() : true,
      showPinNames: this.m_part ? this.m_part.GetShowPinNames() : true,
    };
  }

  /** `Validate()`: the grid's pending edit, and a name for every user field. */
  Validate(): boolean {
    if (!this.m_fieldsGrid.CommitPendingChanges()) return false;

    // Check for missing field names.
    for (let i = 0; i < this.m_fields.size(); ++i) {
      const field = this.m_fields.at(i);

      if (field.IsMandatory()) continue;

      if (field.GetName(false) === '') {
        DisplayErrorMessage('Fields must have a name.');
        this.m_fieldsGrid.SetGridCursor(i, FIELDS_DATA_COL_ORDER.FDC_VALUE);
        return false;
      }
    }

    return true;
  }

  /** `TransferDataFromWindow()`: false keeps the dialog open. */
  TransferDataFromWindow(aValues: SYMBOL_DIALOG_VALUES): boolean {
    if (!this.Validate()) return false;

    if (!this.m_fieldsGrid.CommitPendingChanges()) return false;

    if (!this.m_pinGrid.CommitPendingChanges()) return false;

    const commit = new SCH_COMMIT(this.m_parent);
    const currentScreen = this.m_parent.GetScreen();
    const currentSheet = this.m_parent.Schematic().CurrentSheet();
    const currentVariant = this.m_parent.Schematic().GetCurrentVariant();

    if (!currentScreen) return false;

    // This needs to be done before the LIB_ID is changed to prevent stale library symbols in
    // the schematic file.
    const replaceOnCurrentScreen = currentScreen.Remove(this.m_symbol);

    // save old cmp in undo list if not already in edit, or moving ...
    if (this.m_symbol.GetEditFlags() === 0) commit.Modify(this.m_symbol, currentScreen);

    // Save current flags which could be modified by next change settings
    const flags = this.m_symbol.GetFlags();

    // Set the part selection in multiple part per package
    const unit_selection = aValues.unit >= 0 ? aValues.unit + 1 : 1;
    this.m_symbol.SetUnitSelection(this.m_parent.GetCurrentSheet(), unit_selection);
    this.m_symbol.SetUnit(unit_selection);

    const bodyStyle_selection = aValues.bodyStyle >= 0 ? aValues.bodyStyle + 1 : 1;
    this.m_symbol.SetBodyStyle(bodyStyle_selection);

    switch (aValues.orientation) {
      case 0:
        this.m_symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_ORIENT_0);
        break;
      case 1:
        this.m_symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_ORIENT_90);
        break;
      case 2:
        this.m_symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_ORIENT_270);
        break;
      case 3:
        this.m_symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_ORIENT_180);
        break;
    }

    switch (aValues.mirror) {
      case 1:
        this.m_symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_MIRROR_X);
        break;
      case 2:
        this.m_symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_MIRROR_Y);
        break;
    }

    this.m_symbol.SetShowPinNames(aValues.showPinNames);
    this.m_symbol.SetShowPinNumbers(aValues.showPinNumbers);

    // Restore m_Flag modified by SetUnit() and other change settings from the dialog
    this.m_symbol.ClearFlags();
    this.m_symbol.SetFlags(flags);

    // change all field positions from relative to absolute
    for (const field of this.m_fields.Fields()) field.Offset(this.m_symbol.GetPosition());

    let ordinal = 42; // Arbitrarily larger than any mandatory FIELD_T ids.

    for (const field of this.m_fields.Fields()) {
      const fieldName = field.GetCanonicalName();

      if (fieldName === '' && field.GetText() === '') continue;
      else if (fieldName === '') field.SetName('untitled');

      const existingField = this.m_symbol.GetField(field.GetCanonicalName());
      let tmp: SCH_FIELD;

      if (!existingField) {
        tmp = this.m_symbol.AddField(field);
        tmp.SetParent(this.m_symbol);
      } else {
        const schematic = this.m_symbol.Schematic()!;
        const defaultText = schematic.ConvertRefsToKIIDs(existingField.GetText());
        tmp = existingField;

        field.Copy(tmp);
        tmp.SetParent(this.m_symbol);

        if (currentVariant !== '') {
          // Restore the default field text for existing fields.
          tmp.SetText(defaultText, currentSheet);

          const variantText = schematic.ConvertRefsToKIIDs(field.GetText());
          tmp.SetText(variantText, currentSheet, currentVariant);
        }
      }

      if (!field.IsMandatory()) field.SetOrdinal(ordinal++);
    }

    const symbolFields = this.m_symbol.GetFields();

    for (let ii = symbolFields.length - 1; ii >= 0; ii--) {
      const symbolField = symbolFields[ii]!;

      if (symbolField.IsMandatory()) continue;

      let found = false;

      for (const editedField of this.m_fields.Fields()) {
        if (editedField.GetName() === symbolField.GetName()) {
          found = true;
          break;
        }
      }

      if (!found) symbolFields.splice(ii, 1);
    }

    if (currentVariant === '') {
      // Reference has a specific initialization, depending on the current active sheet
      // because for a given symbol, in a complex hierarchy, there are more than one
      // reference.
      this.m_symbol.SetRef(
        this.m_parent.GetCurrentSheet(),
        this.m_fields.GetField(FIELD_T.REFERENCE)!.GetText(),
      );
    }

    this.m_symbol.SetExcludedFromSim(aValues.excludeFromSim, currentSheet, currentVariant);
    this.m_symbol.SetExcludedFromBOM(aValues.excludeFromBom, currentSheet, currentVariant);
    this.m_symbol.SetExcludedFromBoard(aValues.excludeFromBoard, currentSheet, currentVariant);
    this.m_symbol.SetExcludedFromPosFiles(
      aValues.excludeFromPosFiles,
      currentSheet,
      currentVariant,
    );
    this.m_symbol.SetDNP(aValues.dnp, currentSheet, currentVariant);

    // Update any assignments
    if (this.m_dataModel) {
      for (const model_pin of this.m_dataModel.Pins()) {
        // map from the edited copy back to the "real" pin(s) in the symbol.
        for (const src_pin of this.m_symbol.GetPinsByNumber(model_pin.GetNumber()))
          src_pin.SetAlt(model_pin.GetAlt());
      }
    }

    // Keep fields other than the reference, include/exclude flags, and alternate pin assignements
    // in sync in multi-unit parts.
    this.m_symbol.SyncOtherUnits(currentSheet, commit, null, currentVariant);

    if (replaceOnCurrentScreen) currentScreen.Append(this.m_symbol);

    if (!commit.Empty()) commit.Push('Edit Symbol Properties');

    return true;
  }

  /** `OnGridCellChanging( wxGridEvent& )`. */
  private OnGridCellChanging(aEvent: wxGridEvent): void {
    if (aEvent.GetCol() !== FIELDS_DATA_COL_ORDER.FDC_NAME) return;

    const newName = aEvent.GetString();

    for (let i = 0; i < this.m_fieldsGrid.GetNumberRows(); ++i) {
      if (i === aEvent.GetRow()) continue;

      if (
        FieldNamesAreDuplicates(
          newName,
          this.m_fieldsGrid.GetCellValue(i, FIELDS_DATA_COL_ORDER.FDC_NAME),
        )
      ) {
        DisplayErrorMessage(`Field name '${newName}' already in use.`);
        aEvent.Veto();
      }
    }
  }

  /** `OnAddField( wxCommandEvent& )`. */
  OnAddField(): void {
    this.m_fieldsGrid.OnAddRow((): [number, number] => {
      const newField = new SCH_FIELD(
        this.m_symbol,
        FIELD_T.USER,
        GetUserFieldName(this.m_fields.size(), DO_TRANSLATE),
      );

      newField.SetTextAngle(this.m_fields.GetField(FIELD_T.REFERENCE)!.GetTextAngle());
      newField.SetVisible(false);

      this.m_fields.push_back(newField);

      // notify the grid
      this.m_fieldsGrid.ProcessTableMessage(
        wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED,
        1,
        0,
      );
      this.OnModify();

      return [this.m_fields.size() - 1, FIELDS_DATA_COL_ORDER.FDC_NAME];
    });
  }

  /** `OnDeleteField( wxCommandEvent& )`. */
  OnDeleteField(): void {
    this.m_fieldsGrid.OnDeleteRows(
      (row) => {
        if (row < this.m_fields.GetMandatoryRowCount()) {
          DisplayErrorMessage(
            `The first ${this.m_fields.GetMandatoryRowCount()} fields are mandatory.`,
          );
          return false;
        }

        return true;
      },
      (row) => {
        this.m_fields.erase(row);

        // notify the grid
        this.m_fieldsGrid.ProcessTableMessage(
          wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED,
          row,
          1,
        );
      },
    );

    this.OnModify();
  }

  /** `OnMoveUp( wxCommandEvent& )`. */
  OnMoveUp(): void {
    this.m_fieldsGrid.OnMoveRowUp(
      (row) => row > this.m_fields.GetMandatoryRowCount(),
      (row) => {
        this.m_fields.SwapRows(row, row - 1);
        this.m_fieldsGrid.ForceRefresh();
        this.OnModify();
      },
    );
  }

  /** `OnMoveDown( wxCommandEvent& )`: OnMoveRowDown here (the label and sheet dialogs call Up). */
  OnMoveDown(): void {
    this.m_fieldsGrid.OnMoveRowDown(
      (row) => row >= this.m_fields.GetMandatoryRowCount(),
      (row) => {
        this.m_fields.SwapRows(row, row + 1);
        this.m_fieldsGrid.ForceRefresh();
        this.OnModify();
      },
    );
  }

  /**
   * `OnEditSymbol` / `OnEditLibrarySymbol` / `OnUpdateSymbol` / `OnExchangeSymbol`: apply the
   * dialog, then end with the hand-off for SCH_EDIT_TOOL to act on; null when the apply failed.
   */
  EndWith(aValues: SYMBOL_DIALOG_VALUES, aRetval: SYMBOL_PROPS_RETVALUE): number | null {
    return this.TransferDataFromWindow(aValues) ? aRetval : null;
  }

  /** `OnPinTableColSort( wxGridEvent& )`. */
  private OnPinTableColSort(aEvent: wxGridEvent): void {
    const sortCol = aEvent.GetCol();

    // This is bonkers, but wxWidgets doesn't tell us ascending/descending in the
    // event, and if we ask it will give us pre-event info.
    const ascending = this.m_pinGrid.IsSortingBy(sortCol)
      ? // same column; invert ascending
        !this.m_pinGrid.IsSortOrderAscending()
      : // different column; start with ascending
        true;

    this.m_dataModel?.SortRows(sortCol, ascending);
    this.m_dataModel?.BuildAttrs();
  }

  /** `OnUnitChoice( wxCommandEvent& )`: the pin page follows the unit the combo is on. */
  OnUnitChoice(aSelection: number): void {
    if (this.m_dataModel) {
      const flags = this.m_symbol.GetFlags();

      const unit_selection = aSelection + 1;

      // We need to select a new unit to build the new unit pin list
      // but we should not change the symbol, so the initial unit will be selected
      // after rebuilding the pin list
      const old_unit = this.m_symbol.GetUnit();
      this.m_symbol.SetUnit(unit_selection);

      // Rebuild a copy of the pins of the new unit for editing
      const rows = this.m_dataModel.GetNumberRows();
      this.m_dataModel.clear();
      this.m_pinGrid.ProcessTableMessage(
        wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED,
        0,
        rows,
      );

      for (const pin of this.m_symbol.GetRawPins()) this.m_dataModel.push_back(SCH_PIN.copyOf(pin));

      this.m_dataModel.SortRows(COL_NUMBER, true);
      this.m_dataModel.BuildAttrs();
      this.m_pinGrid.ProcessTableMessage(
        wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED,
        this.m_dataModel.GetNumberRows(),
        0,
      );

      this.m_symbol.SetUnit(old_unit);

      // Restore m_Flag modified by SetUnit()
      this.m_symbol.ClearFlags();
      this.m_symbol.SetFlags(flags);
    }

    this.OnModify();
  }
}

/** The base class's field-grid widths, for the eight shown columns. */
const FIELD_COLUMNS = [
  { width: 72 },
  { width: 120 },
  { width: 48, center: true },
  { width: 48, center: true },
  { width: 72, center: true },
  { width: 72, center: true },
  { width: 48, center: true },
  { width: 48, center: true },
];

/** The pin grid's widths (dialog_symbol_properties_base.cpp:279-283). */
const PIN_COLUMNS = [{ width: 66 }, { width: 140 }, { width: 140 }, { width: 120 }, { width: 120 }];

/** The form over DIALOG_SYMBOL_PROPERTIES; onClose carries the return code. */
export function DialogSymbolProperties({
  dlg,
  initial,
  onClose,
  onCancel,
}: {
  dlg: DIALOG_SYMBOL_PROPERTIES;
  initial: SYMBOL_DIALOG_VALUES;
  onClose: (aRetval: number) => void;
  onCancel: () => void;
}): JSX.Element {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [tab, setTab] = useState<'general' | 'pins'>('general');
  const [values, setValues] = useState(initial);
  const set = <K extends keyof SYMBOL_DIALOG_VALUES>(k: K, v: SYMBOL_DIALOG_VALUES[K]): void =>
    setValues((s) => ({ ...s, [k]: v }));

  const end = (aRetval: SYMBOL_PROPS_RETVALUE): void => {
    const code = dlg.EndWith(values, aRetval);
    if (code !== null) onClose(code);
  };

  const button = (aBitmap: string, aTip: string, aRun: () => void): JSX.Element => (
    <StdBitmapButton
      bitmap={aBitmap}
      title={aTip}
      onClick={() => {
        aRun();
        redraw();
      }}
    />
  );

  const check = (aKey: keyof SYMBOL_DIALOG_VALUES, aLabel: string, aTip?: string): JSX.Element => (
    <CheckBox
      label={aLabel}
      checked={values[aKey] as boolean}
      title={aTip}
      onChange={(v) => set(aKey, v as never)}
    />
  );

  const multiUnit = values.unit >= 0;
  const multiBodyStyle = values.bodyStyle >= 0;

  return (
    <DialogShim title={dlg.m_title} onClose={onCancel} className="ze-symprops">
      <div className="ze-symprops-body">
        {/* m_notebook1: a wxNotebook keeps every page, so the dialog fits the largest. */}
        <div className="ze-nb-frame">
          <div className="ze-nb-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'general'}
              className={tab === 'general' ? 'active' : ''}
              onClick={() => setTab('general')}
            >
              General
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'pins'}
              className={tab === 'pins' ? 'active' : ''}
              disabled={dlg.m_pinsDisabled}
              title={
                dlg.m_pinsDisabled
                  ? 'Alternate pin assignments are not available for symbols with multiple body styles.'
                  : undefined
              }
              onClick={() => {
                // OnPageChanging: a pending cell edit must commit first.
                if (dlg.FieldsGrid().CommitPendingChanges()) setTab('pins');
              }}
            >
              Pin Functions
            </button>
          </div>

          <div className="ze-nb-body">
            <div
              className="ze-symprops-page"
              aria-hidden={tab !== 'pins'}
              data-nbhide={tab !== 'pins' ? '' : undefined}
            >
              <div className="ze-grid-pane ze-symprops-pin-pane">
                {dlg.PinModel() && (
                  <WxGridView
                    grid={dlg.PinGrid()}
                    columns={PIN_COLUMNS}
                    ariaLabel="Pin functions"
                    onUpdate={redraw}
                  />
                )}
              </div>
            </div>

            <div
              className="ze-symprops-page"
              aria-hidden={tab !== 'general'}
              data-nbhide={tab !== 'general' ? '' : undefined}
            >
              {/* sbFields */}
              <fieldset className="ze-ds-group ze-symprops-fields">
                <legend>Fields</legend>
                <div className="ze-grid-pane ze-symprops-grid-pane">
                  <WxGridView
                    grid={dlg.FieldsGrid()}
                    columns={FIELD_COLUMNS}
                    flexCol={FIELDS_DATA_COL_ORDER.FDC_VALUE}
                    ariaLabel="Fields"
                    onUpdate={redraw}
                  />
                </div>

                {/* bButtonSize: add, up, down, a 20px spacer, delete. */}
                <div className="ze-grid-btns">
                  {button('small_plus', 'Add field', () => dlg.OnAddField())}
                  {button('small_up', 'Move up', () => dlg.OnMoveUp())}
                  {button('small_down', 'Move down', () => dlg.OnMoveDown())}
                  <span className="ze-symprops-btngap" />
                  {button('small_trash', 'Delete field', () => dlg.OnDeleteField())}
                </div>
              </fieldset>

              {/* bLowerSizer: General | Attributes | buttons. */}
              <div className="ze-symprops-lower">
                <fieldset className="ze-ds-group ze-symprops-general">
                  <legend>General</legend>
                  <div className="ze-symprops-gb">
                    <label
                      className={multiUnit ? 'ze-symprops-lbl' : 'ze-symprops-lbl disabled'}
                      htmlFor="ze-symprops-unit"
                    >
                      Unit:
                    </label>
                    <Combo
                      id="ze-symprops-unit"
                      ariaLabel="Unit"
                      disabled={!multiUnit}
                      value={String(values.unit)}
                      onChange={(v) => {
                        set('unit', Number(v));
                        dlg.OnUnitChoice(Number(v));
                        redraw();
                      }}
                      options={dlg.m_unitChoices.map((c, i) => ({ value: String(i), label: c }))}
                    />

                    <label
                      className={multiBodyStyle ? 'ze-symprops-lbl' : 'ze-symprops-lbl disabled'}
                      htmlFor="ze-symprops-bodystyle"
                    >
                      Body style:
                    </label>
                    <Combo
                      id="ze-symprops-bodystyle"
                      ariaLabel="Body style"
                      disabled={!multiBodyStyle}
                      value={String(values.bodyStyle)}
                      onChange={(v) => set('bodyStyle', Number(v))}
                      options={dlg.m_bodyStyleChoices.map((c, i) => ({
                        value: String(i),
                        label: c,
                      }))}
                    />

                    {/* gbSizer1 leaves row 2 empty at SetEmptyCellSize( -1, 12 ). */}
                    <span className="ze-symprops-gbgap" />

                    <label className="ze-symprops-lbl" htmlFor="ze-symprops-angle">
                      Angle:
                    </label>
                    <Combo
                      id="ze-symprops-angle"
                      ariaLabel="Angle"
                      value={String(values.orientation)}
                      onChange={(v) => set('orientation', Number(v))}
                      options={['0', '+90', '-90', '180'].map((label, i) => ({
                        value: String(i),
                        label,
                      }))}
                    />

                    <label className="ze-symprops-lbl" htmlFor="ze-symprops-mirror">
                      Mirror:
                    </label>
                    <Combo
                      id="ze-symprops-mirror"
                      ariaLabel="Mirror"
                      value={String(values.mirror)}
                      onChange={(v) => set('mirror', Number(v))}
                      options={['Not mirrored', 'Around X axis', 'Around Y axis'].map(
                        (label, i) => ({ value: String(i), label }),
                      )}
                    />
                  </div>

                  {/* bSizer11, inside the General box. */}
                  <div className="ze-symprops-pinchecks">
                    {check('showPinNumbers', 'Show pin numbers', 'Show or hide pin numbers')}
                    {check('showPinNames', 'Show pin names', 'Show or hide pin names')}
                  </div>
                </fieldset>

                {/* sbAttributes: simulation, a 10px spacer, BOM, board, position files, DNP. */}
                <fieldset className="ze-ds-group ze-symprops-attrs">
                  <legend>Attributes</legend>
                  {check('excludeFromSim', 'Exclude from simulation')}
                  <span className="ze-symprops-attrgap" />
                  {check(
                    'excludeFromBom',
                    'Exclude from bill of materials',
                    'This is useful for adding symbols for board footprints such as fiducials\n' +
                      'and logos that you do not want to appear in the bill of materials export',
                  )}
                  {check(
                    'excludeFromBoard',
                    'Exclude from board',
                    'This is useful for adding symbols that only get exported to the bill of materials but\n' +
                      'not required to layout the board such as mechanical fasteners and enclosures',
                  )}
                  {check(
                    'excludeFromPosFiles',
                    'Exclude from position files',
                    'This is useful for adding symbols that should not be included in the \n' +
                      'exported position files used for pick and place machines',
                  )}
                  {check('dnp', 'Do not populate')}
                </fieldset>

                {/* buttonsSizer: a 20px gap before the one that acts on the library part. */}
                <div className="ze-symprops-buttons">
                  <Button
                    label="Update Symbol from Library..."
                    onClick={() => end(SYMBOL_PROPS_RETVALUE.SYMBOL_PROPS_WANT_UPDATE_SYMBOL)}
                  />
                  <Button
                    label="Change Symbol..."
                    onClick={() => end(SYMBOL_PROPS_RETVALUE.SYMBOL_PROPS_WANT_EXCHANGE_SYMBOL)}
                  />
                  <Button
                    label="Edit Symbol..."
                    disabled={!dlg.m_canEditSymbol}
                    onClick={() => end(SYMBOL_PROPS_RETVALUE.SYMBOL_PROPS_EDIT_SCHEMATIC_SYMBOL)}
                  />
                  <span className="ze-symprops-btnsgap" />
                  <Button
                    label="Edit Library Symbol..."
                    disabled={!dlg.m_canEditSymbol}
                    onClick={() => end(SYMBOL_PROPS_RETVALUE.SYMBOL_PROPS_EDIT_LIBRARY_SYMBOL)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* bSizerBottom, outside the notebook. */}
      <div className="ze-modal-footer ze-symprops-foot">
        <span className="ze-symprops-libid-label">Library link:</span>
        <input
          className="ze-symprops-libid ze-bare"
          readOnly
          aria-readonly="true"
          aria-label="Library link"
          value={dlg.m_libraryId}
          title={dlg.m_libraryId}
        />
        {/* m_spiceFieldsButton: hidden for a power symbol; DIALOG_SIM_MODEL is not ported. */}
        {!dlg.m_isPower && (
          <Button
            label="Simulation Model..."
            disabled
            title="The simulator is not available in this build"
          />
        )}
        <Button label="Cancel" onClick={onCancel} />
        <Button
          label="OK"
          isDefault
          onClick={() => {
            if (dlg.TransferDataFromWindow(values)) onClose(wxID_OK);
          }}
        />
      </div>
    </DialogShim>
  );
}
