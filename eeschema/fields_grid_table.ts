// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/fields_grid_table.h` / `.cpp`: FIELDS_GRID_TABLE, the fields grid of the symbol,
 * sheet and label property dialogs, over copies of the live SCH_FIELDs.
 */

import {
  ConvertPathToFileUri,
  EscapeString,
  ESCAPE_CONTEXT,
  unescapeString,
} from '@ziroeda/common/string_utils.js';
import { ensureFileExtension } from '@ziroeda/common/common.js';
import type { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { FONT, KICAD_FONT_NAME } from '@ziroeda/common/font/font.js';
import { DEFAULT_FONT_NAME } from '@ziroeda/common/font/stroke_font.js';
import { BUNDLED_FAMILIES } from '@ziroeda/common/font/outline_fonts.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { parseColor4d, toCssString } from '@ziroeda/common/gal/color4d.js';
import { DO_TRANSLATE, FIELD_T, GetDefaultFieldName } from '@ziroeda/common/template_fieldnames.js';
import { FIELD_VALIDATOR } from '@ziroeda/common/validators.js';
import {
  fileFilter,
  KiCadSchematicFileExtension,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import { GRID_CELL_COMBOBOX } from '@ziroeda/common/widgets/grid_combobox.js';
import {
  GRID_CELL_FPID_EDITOR,
  GRID_CELL_PATH_EDITOR,
  GRID_CELL_URL_EDITOR,
  type GRID_TEXT_BUTTON_HOST,
} from '@ziroeda/common/widgets/grid_text_button_helpers.js';
import { GRID_CELL_TEXT_EDITOR } from '@ziroeda/common/widgets/grid_text_helpers.js';
import { INDETERMINATE_STATE } from '@ziroeda/common/widgets/ui_common.js';
import { type WX_GRID, WX_GRID_TABLE_BASE } from '@ziroeda/common/widgets/wx_grid.js';
import {
  type wxAttrKind,
  wxALIGN_CENTER,
  wxGRID_VALUE_BOOL,
  wxGRID_VALUE_STRING,
  wxGridCellAttr,
  wxGridCellBoolEditor,
  wxGridCellBoolRenderer,
  wxGridCellChoiceEditor,
} from '@ziroeda/common/wx/grid.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_HORIZONTAL, ANGLE_VERTICAL } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { LIB_SYMBOL } from './lib_symbol.js';
import type { SCH_BASE_FRAME } from './sch_base_frame.js';
import { SCH_FIELD } from './sch_field.js';
import { SCH_LABEL_BASE } from './sch_label.js';
import { SCH_SHEET } from './sch_sheet.js';
import { SCH_SYMBOL } from './sch_symbol.js';
import type { SCHEMATIC_SETTINGS } from './schematic_settings.js';

/** `DEFAULT_FONT_NAME` (fields_grid_table.cpp:60). */
const FIELDS_DEFAULT_FONT_NAME = DEFAULT_FONT_NAME;

/** `FIELDS_DATA_COL_ORDER` (fields_grid_table.h). */
export enum FIELDS_DATA_COL_ORDER {
  FDC_NAME = 0,
  FDC_VALUE,
  FDC_SHOWN,
  FDC_SHOW_NAME,
  FDC_H_ALIGN,
  FDC_V_ALIGN,
  FDC_ITALIC,
  FDC_BOLD,
  FDC_TEXT_SIZE,
  FDC_ORIENTATION,
  FDC_POSX,
  FDC_POSY,
  FDC_FONT,
  FDC_COLOR,
  FDC_ALLOW_AUTOPLACE,
  FDC_SCH_EDIT_COUNT,
  FDC_PRIVATE = FDC_SCH_EDIT_COUNT,
  FDC_SYMBOL_EDITOR_COUNT,
}

const {
  FDC_NAME,
  FDC_VALUE,
  FDC_SHOWN,
  FDC_SHOW_NAME,
  FDC_H_ALIGN,
  FDC_V_ALIGN,
  FDC_ITALIC,
  FDC_BOLD,
  FDC_TEXT_SIZE,
  FDC_ORIENTATION,
  FDC_POSX,
  FDC_POSY,
  FDC_FONT,
  FDC_COLOR,
  FDC_ALLOW_AUTOPLACE,
  FDC_SCH_EDIT_COUNT,
  FDC_PRIVATE,
  FDC_SYMBOL_EDITOR_COUNT,
} = FIELDS_DATA_COL_ORDER;

/** The dialog the table reports edits to (`DIALOG_SHIM::OnModify`). */
export interface FIELDS_GRID_DIALOG {
  OnModify(): void;
}

/**
 * `FIELDS_GRID_TABLE` (fields_grid_table.h): the fields grid of the symbol, sheet and label
 * dialogs, one row per copy of the parent's `SCH_FIELD`s (upstream inherits
 * `std::vector<SCH_FIELD>`; here the copies are {@link m_fields}). Upstream's four constructors are
 * one, which reads the parent's type as they do.
 *
 * Not here: the value column's Scintilla editor (`GRID_CELL_STC_EDITOR`) is the plain text
 * editor; `NUMERIC_EVALUATOR` (WX_GRID's documented gap); the inherited rows' italic grey text
 * (wxGridCellAttr carries no font or text colour here); the footprint editor's symbol netlist,
 * which arrives with DIALOG_SYMBOL_PROPERTIES.
 */
export class FIELDS_GRID_TABLE extends WX_GRID_TABLE_BASE {
  private readonly m_frame: SCH_BASE_FRAME;
  private readonly m_dialog: FIELDS_GRID_DIALOG;
  private readonly m_parentType: KICAD_T;
  private readonly m_part: LIB_SYMBOL | null;
  private readonly m_filesStack: EMBEDDED_FILES[] = [];
  private readonly m_symbolNetlist: string = '';
  private readonly m_curdir = { value: '' };

  private m_fields: SCH_FIELD[] = [];
  private m_isInherited: boolean[] = [];
  private m_parentFields: (SCH_FIELD | null)[] = [];

  private readonly m_fieldNameValidator: FIELD_VALIDATOR;
  private readonly m_referenceValidator: FIELD_VALIDATOR;
  private readonly m_valueValidator: FIELD_VALIDATOR;
  private readonly m_urlValidator: FIELD_VALIDATOR;
  private readonly m_nonUrlValidator: FIELD_VALIDATOR;
  private readonly m_filepathValidator: FIELD_VALIDATOR;

  private m_readOnlyAttr!: wxGridCellAttr;
  private m_fieldNameAttr!: wxGridCellAttr;
  private m_referenceAttr!: wxGridCellAttr;
  private m_valueAttr!: wxGridCellAttr;
  private m_footprintAttr!: wxGridCellAttr;
  private m_urlAttr!: wxGridCellAttr;
  private m_nonUrlAttr!: wxGridCellAttr;
  private m_filepathAttr!: wxGridCellAttr;
  private m_boolAttr!: wxGridCellAttr;
  private m_vAlignAttr!: wxGridCellAttr;
  private m_hAlignAttr!: wxGridCellAttr;
  private m_orientationAttr!: wxGridCellAttr;
  private m_netclassAttr!: wxGridCellAttr;
  private m_fontAttr!: wxGridCellAttr;
  private m_colorAttr!: wxGridCellAttr;

  constructor(
    aDialog: FIELDS_GRID_DIALOG,
    aFrame: SCH_BASE_FRAME,
    aGrid: WX_GRID,
    aParent: LIB_SYMBOL | SCH_SYMBOL | SCH_SHEET | SCH_LABEL_BASE,
    aHost: GRID_TEXT_BUTTON_HOST,
    aFilesStack: EMBEDDED_FILES[] = [],
  ) {
    super();
    this.m_frame = aFrame;
    this.m_dialog = aDialog;

    let validatorIds: [FIELD_T, FIELD_T, FIELD_T, FIELD_T] = [
      FIELD_T.USER,
      FIELD_T.REFERENCE,
      FIELD_T.VALUE,
      FIELD_T.SHEET_FILENAME,
    ];

    if (aParent instanceof LIB_SYMBOL) {
      this.m_parentType = KICAD_T.SCH_SYMBOL_T;
      this.m_part = aParent;
      this.m_filesStack = aFilesStack;
    } else if (aParent instanceof SCH_SYMBOL) {
      this.m_parentType = KICAD_T.SCH_SYMBOL_T;
      this.m_part = aParent.GetLibSymbolRef();
      const schematic = aParent.Schematic();
      if (schematic) this.m_filesStack.push(schematic);
      if (this.m_part) this.m_filesStack.push(this.m_part);
    } else if (aParent instanceof SCH_SHEET) {
      this.m_parentType = KICAD_T.SCH_SHEET_T;
      this.m_part = null;
      validatorIds = [FIELD_T.USER, FIELD_T.SHEET_NAME, FIELD_T.VALUE, FIELD_T.SHEET_FILENAME];
      const schematic = aParent.Schematic();
      if (schematic) this.m_filesStack.push(schematic);
    } else {
      this.m_parentType = KICAD_T.SCH_LABEL_LOCATE_ANY_T;
      this.m_part = null;
      validatorIds = [FIELD_T.USER, FIELD_T.USER, FIELD_T.USER, FIELD_T.USER];
      const schematic = aParent.Schematic();
      if (schematic) this.m_filesStack.push(schematic);
    }

    this.m_fieldNameValidator = new FIELD_VALIDATOR(validatorIds[0]);
    this.m_referenceValidator = new FIELD_VALIDATOR(validatorIds[1]);
    this.m_valueValidator = new FIELD_VALIDATOR(validatorIds[2]);
    this.m_urlValidator = new FIELD_VALIDATOR(FIELD_T.USER);
    this.m_nonUrlValidator = new FIELD_VALIDATOR(FIELD_T.USER);
    this.m_filepathValidator = new FIELD_VALIDATOR(validatorIds[3]);

    this.initGrid(aGrid, aHost);
  }

  /** The rows, for the dialog to read back (`*this` upstream). */
  Fields(): SCH_FIELD[] {
    return this.m_fields;
  }

  size(): number {
    return this.m_fields.length;
  }

  at(aRow: number): SCH_FIELD {
    return this.m_fields[aRow]!;
  }

  empty(): boolean {
    return this.m_fields.length === 0;
  }

  /** `erase( begin() + aRow )`: the vector's own erase, not EraseRow. */
  erase(aRow: number): void {
    this.m_fields.splice(aRow, 1);
  }

  override GetNumberRows(): number {
    return this.getVisibleRowCount();
  }

  override GetNumberCols(): number {
    return this.getColumnCount();
  }

  GetMandatoryRowCount(): number {
    let mandatoryRows = 0;

    for (const field of this.m_fields) {
      if (field.IsMandatory()) mandatoryRows++;
    }

    return mandatoryRows;
  }

  override IsEmptyCell(_row: number, _col: number): boolean {
    return false; // don't allow adjacent cell overflow, even if we are actually empty
  }

  push_back(aField: SCH_FIELD): void {
    this.m_fields.push(aField);

    while (this.m_isInherited.length < this.m_fields.length) this.m_isInherited.push(false);
    while (this.m_parentFields.length < this.m_fields.length) this.m_parentFields.push(null);
  }

  emplace_back(aField: SCH_FIELD): void {
    this.push_back(aField);
  }

  private initGrid(aGrid: WX_GRID, aHost: GRID_TEXT_BUTTON_HOST): void {
    // Build the various grid cell attributes.

    this.m_readOnlyAttr = new wxGridCellAttr();
    this.m_readOnlyAttr.SetReadOnly(true);

    this.m_fieldNameAttr = new wxGridCellAttr();
    const nameEditor = new GRID_CELL_TEXT_EDITOR();
    nameEditor.SetValidator(this.m_fieldNameValidator.GetCharExcludes());
    this.m_fieldNameAttr.SetEditor(nameEditor);

    this.m_referenceAttr = new wxGridCellAttr();
    const referenceEditor = new GRID_CELL_TEXT_EDITOR();
    referenceEditor.SetValidator(this.m_referenceValidator.GetCharExcludes());
    this.m_referenceAttr.SetEditor(referenceEditor);

    // LIB_SYMBOL_T gets a validated text editor; every other parent the STC editor, which is the
    // plain text editor here.
    this.m_valueAttr = new wxGridCellAttr();
    const valueEditor = new GRID_CELL_TEXT_EDITOR();
    if (this.m_parentType === KICAD_T.LIB_SYMBOL_T)
      valueEditor.SetValidator(this.m_valueValidator.GetCharExcludes());
    this.m_valueAttr.SetEditor(valueEditor);

    this.m_footprintAttr = new wxGridCellAttr();
    const fpIdEditor = new GRID_CELL_FPID_EDITOR(aHost, this.m_symbolNetlist);
    fpIdEditor.SetValidator(this.m_nonUrlValidator.GetCharExcludes());
    this.m_footprintAttr.SetEditor(fpIdEditor);

    this.m_urlAttr = new wxGridCellAttr();
    const urlEditor = new GRID_CELL_URL_EDITOR(aHost);
    urlEditor.SetValidator(this.m_urlValidator.GetCharExcludes());
    this.m_urlAttr.SetEditor(urlEditor);

    this.m_nonUrlAttr = new wxGridCellAttr();
    const nonUrlEditor = new GRID_CELL_TEXT_EDITOR();
    nonUrlEditor.SetValidator(this.m_nonUrlValidator.GetCharExcludes());
    this.m_nonUrlAttr.SetEditor(nonUrlEditor);

    this.m_curdir.value = this.m_frame.Prj().GetProjectPath();
    this.m_filepathAttr = new wxGridCellAttr();

    // Create a wild card using wxFileDialog syntax.
    const wildCard = [fileFilter('Schematic Files', [KiCadSchematicFileExtension])];

    const filepathEditor = new GRID_CELL_PATH_EDITOR(aHost, this.m_curdir, wildCard);
    filepathEditor.SetValidator(this.m_filepathValidator.GetCharExcludes());
    this.m_filepathAttr.SetEditor(filepathEditor);

    this.m_boolAttr = new wxGridCellAttr();
    this.m_boolAttr.SetRenderer(new wxGridCellBoolRenderer());
    this.m_boolAttr.SetEditor(new wxGridCellBoolEditor());
    this.m_boolAttr.SetAlignment(wxALIGN_CENTER, wxALIGN_CENTER);

    this.m_vAlignAttr = new wxGridCellAttr();
    this.m_vAlignAttr.SetEditor(new wxGridCellChoiceEditor(['Top', 'Center', 'Bottom']));
    this.m_vAlignAttr.SetAlignment(wxALIGN_CENTER, wxALIGN_CENTER);

    this.m_hAlignAttr = new wxGridCellAttr();
    this.m_hAlignAttr.SetEditor(new wxGridCellChoiceEditor(['Left', 'Center', 'Right']));
    this.m_hAlignAttr.SetAlignment(wxALIGN_CENTER, wxALIGN_CENTER);

    this.m_orientationAttr = new wxGridCellAttr();
    this.m_orientationAttr.SetEditor(new wxGridCellChoiceEditor(['Horizontal', 'Vertical']));
    this.m_orientationAttr.SetAlignment(wxALIGN_CENTER, wxALIGN_CENTER);

    const existingNetclasses: string[] = [];

    if (this.m_frame.GetFrameType() === FRAME_T.FRAME_SCH) {
      // Load the combobox with existing existingNetclassNames
      const settings = this.m_frame.Prj().GetProjectFile().NetSettings();

      existingNetclasses.push(settings.GetDefaultNetclass().GetName());

      for (const [name] of settings.GetNetclasses()) existingNetclasses.push(name);
    }

    this.m_netclassAttr = new wxGridCellAttr();
    this.m_netclassAttr.SetEditor(new GRID_CELL_COMBOBOX(existingNetclasses));

    // Fontconfig()->ListFonts(): the families the bundled faces provide, sorted.
    const fonts = [...BUNDLED_FAMILIES].sort();
    fonts.unshift(KICAD_FONT_NAME);
    fonts.unshift(FIELDS_DEFAULT_FONT_NAME);

    this.m_fontAttr = new wxGridCellAttr();
    this.m_fontAttr.SetEditor(new GRID_CELL_COMBOBOX(fonts));

    // GRID_CELL_COLOR_RENDERER / GRID_CELL_COLOR_SELECTOR: the view draws the swatch and opens
    // the picker for this column.
    this.m_colorAttr = new wxGridCellAttr();
    this.m_colorAttr.SetReadOnly(true);

    // aGrid->SetupColumnAutosizer( FDC_VALUE ): the view's `flexCol`.
    void aGrid;
  }

  private getColumnCount(): number {
    if (
      this.m_frame.GetFrameType() === FRAME_T.FRAME_SCH ||
      this.m_frame.GetFrameType() === FRAME_T.FRAME_SCH_VIEWER
    ) {
      return FDC_SCH_EDIT_COUNT;
    }

    return FDC_SYMBOL_EDITOR_COUNT;
  }

  private getVisibleRowCount(): number {
    if (
      this.m_frame.GetFrameType() === FRAME_T.FRAME_SCH ||
      this.m_frame.GetFrameType() === FRAME_T.FRAME_SCH_VIEWER
    ) {
      let visibleRows = 0;

      for (const field of this.m_fields) {
        if (!field.IsPrivate()) visibleRows++;
      }

      return visibleRows;
    }

    return this.m_fields.length;
  }

  private getField(aRow: number): SCH_FIELD {
    if (
      this.m_frame.GetFrameType() === FRAME_T.FRAME_SCH ||
      this.m_frame.GetFrameType() === FRAME_T.FRAME_SCH_VIEWER
    ) {
      let visibleRow = 0;

      for (const field of this.m_fields) {
        if (field.IsPrivate()) continue;

        if (visibleRow === aRow) return field;

        ++visibleRow;
      }

      console.assert(false, 'Row index off end of visible row count');
    }

    return this.m_fields[aRow]!;
  }

  override GetColLabelValue(aCol: number): string {
    switch (aCol) {
      case FDC_NAME:
        return 'Name';
      case FDC_VALUE:
        return 'Value';
      case FDC_SHOWN:
        return 'Show';
      case FDC_SHOW_NAME:
        return 'Show Name';
      case FDC_H_ALIGN:
        return 'H Align';
      case FDC_V_ALIGN:
        return 'V Align';
      case FDC_ITALIC:
        return 'Italic';
      case FDC_BOLD:
        return 'Bold';
      case FDC_TEXT_SIZE:
        return 'Text Size';
      case FDC_ORIENTATION:
        return 'Orientation';
      case FDC_POSX:
        return 'X Position';
      case FDC_POSY:
        return 'Y Position';
      case FDC_FONT:
        return 'Font';
      case FDC_COLOR:
        return 'Color';
      case FDC_ALLOW_AUTOPLACE:
        return 'Allow Autoplacement';
      case FDC_PRIVATE:
        return 'Private';
      default:
        console.assert(false);
        return '';
    }
  }

  override CanGetValueAs(_aRow: number, aCol: number, aTypeName: string): boolean {
    switch (aCol) {
      case FDC_NAME:
      case FDC_VALUE:
      case FDC_H_ALIGN:
      case FDC_V_ALIGN:
      case FDC_TEXT_SIZE:
      case FDC_ORIENTATION:
      case FDC_POSX:
      case FDC_POSY:
      case FDC_FONT:
      case FDC_COLOR:
        return aTypeName === wxGRID_VALUE_STRING;

      case FDC_SHOWN:
      case FDC_SHOW_NAME:
      case FDC_ITALIC:
      case FDC_BOLD:
      case FDC_ALLOW_AUTOPLACE:
      case FDC_PRIVATE:
        return aTypeName === wxGRID_VALUE_BOOL;

      default:
        console.assert(false);
        return false;
    }
  }

  override CanSetValueAs(aRow: number, aCol: number, aTypeName: string): boolean {
    return this.CanGetValueAs(aRow, aCol, aTypeName);
  }

  override GetAttr(aRow: number, aCol: number, aKind: wxAttrKind): wxGridCellAttr | null {
    if (aRow >= this.GetNumberRows()) return null;

    const field = this.getField(aRow);
    let attr: wxGridCellAttr | null = null;

    switch (aCol) {
      case FDC_NAME:
        if (field.IsMandatory()) {
          attr = this.m_fieldNameAttr.Clone();
          attr.SetReadOnly(true);
        } else {
          attr = this.m_fieldNameAttr;
        }

        break;

      case FDC_VALUE:
        if (field.GetId() === FIELD_T.REFERENCE) {
          attr = this.m_referenceAttr;
        } else if (field.GetId() === FIELD_T.VALUE) {
          attr = this.m_valueAttr;
        } else if (field.GetId() === FIELD_T.FOOTPRINT) {
          // Power symbols have do not appear in the board, so don't allow
          // a footprint (m_part can be nullptr when loading a old schematic
          // (for instance Kicad 4) with libraries missing)
          if (this.m_part?.IsPower()) attr = this.m_readOnlyAttr;
          else attr = this.m_footprintAttr;
        } else if (field.GetId() === FIELD_T.DATASHEET) {
          attr = this.m_urlAttr;
        } else if (field.GetId() === FIELD_T.SHEET_NAME) {
          attr = this.m_referenceAttr;
        } else if (field.GetId() === FIELD_T.SHEET_FILENAME) {
          attr = this.m_filepathAttr;
        } else if (
          this.m_parentType === KICAD_T.SCH_LABEL_LOCATE_ANY_T &&
          field.GetCanonicalName() === 'Netclass'
        ) {
          attr = this.m_netclassAttr;
        } else {
          const fn = this.GetValue(aRow, FDC_NAME);

          const settings = this.m_frame.Prj().GetProjectFile()
            .m_SchematicSettings as unknown as SCHEMATIC_SETTINGS | null;

          const templateFn = settings ? settings.m_TemplateFieldNames.GetFieldName(fn) : null;

          if (templateFn?.m_URL || field.HasHypertext()) attr = this.m_urlAttr;
          else attr = this.m_nonUrlAttr;
        }

        break;

      case FDC_TEXT_SIZE:
      case FDC_POSX:
      case FDC_POSY:
        break;

      case FDC_H_ALIGN:
        attr = this.m_hAlignAttr;
        break;

      case FDC_V_ALIGN:
        attr = this.m_vAlignAttr;
        break;

      case FDC_ORIENTATION:
        attr = this.m_orientationAttr;
        break;

      case FDC_SHOWN:
      case FDC_SHOW_NAME:
      case FDC_ITALIC:
      case FDC_BOLD:
      case FDC_ALLOW_AUTOPLACE:
      case FDC_PRIVATE:
        attr = this.m_boolAttr;
        break;

      case FDC_FONT:
        attr = this.m_fontAttr;
        break;

      case FDC_COLOR:
        attr = this.m_colorAttr;
        break;

      default:
        attr = null;
        break;
    }

    if (!attr) return null;

    return this.enhanceAttr(attr, aRow, aCol, aKind);
  }

  override GetValue(aRow: number, aCol: number): string {
    if (aRow >= this.GetNumberRows()) return '';

    const field = this.getField(aRow);

    switch (aCol) {
      case FDC_NAME:
        // Use default field names for mandatory and system fields because they are translated
        // according to the current locale
        if (this.m_parentType === KICAD_T.SCH_LABEL_LOCATE_ANY_T) {
          return SCH_LABEL_BASE.GetDefaultFieldName(field.GetCanonicalName(), false);
        } else if (field.IsMandatory()) {
          return GetDefaultFieldName(field.GetId(), DO_TRANSLATE);
        } else {
          return field.GetName(false);
        }

      case FDC_VALUE:
        return EscapeString(unescapeString(field.GetText()), ESCAPE_CONTEXT.CTX_LINE);

      case FDC_SHOWN:
        return this.StringFromBool(field.IsVisible());

      case FDC_SHOW_NAME:
        return this.StringFromBool(field.IsNameShown());

      case FDC_H_ALIGN:
        switch (field.GetEffectiveHorizJustify()) {
          case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT:
            return 'Left';
          case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER:
            return 'Center';
          case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT:
            return 'Right';
          case GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_INDETERMINATE:
            return INDETERMINATE_STATE;
        }

        break;

      case FDC_V_ALIGN:
        switch (field.GetEffectiveVertJustify()) {
          case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP:
            return 'Top';
          case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER:
            return 'Center';
          case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM:
            return 'Bottom';
          case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_INDETERMINATE:
            return INDETERMINATE_STATE;
        }

        break;

      case FDC_ITALIC:
        return this.StringFromBool(field.IsItalic());

      case FDC_BOLD:
        return this.StringFromBool(field.IsBold());

      case FDC_TEXT_SIZE:
        return this.m_frame.GetUnitsProvider().StringFromValue(field.GetTextHeight(), true);

      case FDC_ORIENTATION:
        if (field.GetTextAngle().IsHorizontal()) return 'Horizontal';
        else return 'Vertical';

      case FDC_POSX:
        return this.m_frame.GetUnitsProvider().StringFromValue(field.GetTextPos().x, true);

      case FDC_POSY:
        return this.m_frame.GetUnitsProvider().StringFromValue(field.GetTextPos().y, true);

      case FDC_FONT:
        if (field.GetFont()) return field.GetFont()!.GetName();
        else return FIELDS_DEFAULT_FONT_NAME;

      case FDC_COLOR:
        return toCssString(field.GetTextColor());

      case FDC_ALLOW_AUTOPLACE:
        return this.StringFromBool(field.CanAutoplace());

      case FDC_PRIVATE:
        return this.StringFromBool(field.IsPrivate());

      default:
        // we can't assert here because wxWidgets sometimes calls this without checking
        // the column type when trying to see if there's an overflow
        break;
    }

    return 'bad wxWidgets!';
  }

  override GetValueAsBool(aRow: number, aCol: number): boolean {
    if (aRow >= this.GetNumberRows()) return false;

    const field = this.getField(aRow);

    switch (aCol) {
      case FDC_SHOWN:
        return field.IsVisible();
      case FDC_SHOW_NAME:
        return field.IsNameShown();
      case FDC_ITALIC:
        return field.IsItalic();
      case FDC_BOLD:
        return field.IsBold();
      case FDC_ALLOW_AUTOPLACE:
        return field.CanAutoplace();
      case FDC_PRIVATE:
        return field.IsPrivate();
      default:
        console.assert(false, `column ${aCol} doesn't hold a bool value`);
        return false;
    }
  }

  override SetValue(aRow: number, aCol: number, aValue: string): void {
    if (aRow >= this.GetNumberRows()) return;

    const field = this.getField(aRow);
    let value = aValue;

    if (aCol !== FDC_VALUE) value = value.trim();

    const units = this.m_frame.GetUnitsProvider();

    switch (aCol) {
      case FDC_NAME:
        field.SetName(value);
        break;

      case FDC_VALUE:
        if (this.m_parentType === KICAD_T.SCH_SHEET_T && field.GetId() === FIELD_T.SHEET_FILENAME) {
          value = ensureFileExtension(value, KiCadSchematicFileExtension);
        } else if (this.m_parentType === KICAD_T.LIB_SYMBOL_T && field.GetId() === FIELD_T.VALUE) {
          value = EscapeString(value, ESCAPE_CONTEXT.CTX_LIBID);
        } else {
          value = ConvertPathToFileUri(value, this.m_frame.Prj());
        }

        field.SetText(unescapeString(value));
        break;

      case FDC_SHOWN:
        field.SetVisible(this.BoolFromString(value));
        break;

      case FDC_SHOW_NAME:
        field.SetNameShown(this.BoolFromString(value));
        break;

      case FDC_H_ALIGN: {
        let horizontalJustification = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;

        if (value === 'Left') horizontalJustification = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
        else if (value === 'Center')
          horizontalJustification = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;
        else if (value === 'Right')
          horizontalJustification = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;

        // Note that we must set justifications before we can ask if they're flipped.  If the old
        // justification is center then it won't know (whereas if the new justification is center
        // the we don't care).
        field.SetHorizJustify(horizontalJustification);

        if (field.IsHorizJustifyFlipped())
          field.SetHorizJustify(EDA_TEXT.MapHorizJustify(-horizontalJustification));

        break;
      }

      case FDC_V_ALIGN: {
        let verticalJustification = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM;

        if (value === 'Top') verticalJustification = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP;
        else if (value === 'Center')
          verticalJustification = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER;
        else if (value === 'Bottom')
          verticalJustification = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM;

        field.SetVertJustify(verticalJustification);

        if (field.IsVertJustifyFlipped())
          field.SetVertJustify(EDA_TEXT.MapVertJustify(-verticalJustification));

        break;
      }

      case FDC_ITALIC:
        field.SetItalic(this.BoolFromString(value));
        break;

      case FDC_BOLD:
        field.SetBold(this.BoolFromString(value));
        break;

      case FDC_TEXT_SIZE:
        field.SetTextSize({ x: units.ValueFromString(value), y: units.ValueFromString(value) });
        break;

      case FDC_ORIENTATION:
        if (value === 'Horizontal') field.SetTextAngle(ANGLE_HORIZONTAL);
        else if (value === 'Vertical') field.SetTextAngle(ANGLE_VERTICAL);
        else console.assert(false, `unknown orientation: ${value}`);

        break;

      case FDC_POSX:
      case FDC_POSY: {
        const pos = { ...field.GetTextPos() };

        if (aCol === FDC_POSX) pos.x = units.ValueFromString(value);
        else pos.y = units.ValueFromString(value);

        field.SetTextPos(pos);
        break;
      }

      case FDC_FONT:
        if (value === FIELDS_DEFAULT_FONT_NAME) field.SetFont(null);
        else if (value === KICAD_FONT_NAME)
          field.SetFont(FONT.GetFont('', field.IsBold(), field.IsItalic()));
        else field.SetFont(FONT.GetFont(aValue, field.IsBold(), field.IsItalic()));

        break;

      case FDC_COLOR:
        field.SetTextColor(parseColor4d(value));
        break;

      case FDC_ALLOW_AUTOPLACE:
        field.SetCanAutoplace(this.BoolFromString(value));
        break;

      case FDC_PRIVATE:
        field.SetPrivate(this.BoolFromString(value));
        break;

      default:
        console.assert(false, `column ${aCol} doesn't hold a string value`);
        break;
    }

    this.m_dialog.OnModify();

    this.GetView()?.Refresh();
  }

  override SetValueAsBool(aRow: number, aCol: number, aValue: boolean): void {
    if (aRow >= this.GetNumberRows()) return;

    const field = this.getField(aRow);

    switch (aCol) {
      case FDC_SHOWN:
        field.SetVisible(aValue);
        break;
      case FDC_SHOW_NAME:
        field.SetNameShown(aValue);
        break;
      case FDC_ITALIC:
        field.SetItalic(aValue);
        break;
      case FDC_BOLD:
        field.SetBold(aValue);
        break;
      case FDC_ALLOW_AUTOPLACE:
        field.SetCanAutoplace(aValue);
        break;
      case FDC_PRIVATE:
        field.SetPrivate(aValue);
        break;
      default:
        console.assert(false, `column ${aCol} doesn't hold a bool value`);
        break;
    }

    this.m_dialog.OnModify();
  }

  StringFromBool(aValue: boolean): string {
    return aValue ? '1' : '0';
  }

  BoolFromString(aValue: string): boolean {
    if (aValue === '1') return true;
    if (aValue === '0') return false;

    console.assert(
      false,
      `string '${aValue}' can't be converted to boolean correctly and will be perceived as FALSE`,
    );
    return false;
  }

  GetField(aFieldId: FIELD_T): SCH_FIELD | null {
    for (const field of this.m_fields) {
      if (field.GetId() === aFieldId) return field;
    }

    return null;
  }

  GetFieldRow(aFieldId: FIELD_T): number {
    for (let ii = 0; ii < this.m_fields.length; ++ii) {
      if (this.m_fields[ii]!.GetId() === aFieldId) return ii;
    }

    return -1;
  }

  AddInheritedField(aParent: SCH_FIELD): void {
    this.push_back(SCH_FIELD.copyOf(aParent));
    this.m_fields[this.m_fields.length - 1]!.SetParent(this.m_part);
    this.m_isInherited[this.m_isInherited.length - 1] = true;
    this.m_parentFields[this.m_parentFields.length - 1] = aParent;
  }

  SetFieldInherited(aRow: number, aParent: SCH_FIELD): void {
    while (this.m_isInherited.length <= aRow) this.m_isInherited.push(false);
    while (this.m_parentFields.length <= aRow) this.m_parentFields.push(null);

    this.m_parentFields[aRow] = aParent;
    this.m_isInherited[aRow] = true;
  }

  IsInherited(aRow: number): boolean {
    if (aRow >= this.m_isInherited.length || aRow >= this.m_parentFields.length) return false;

    return (
      this.m_isInherited[aRow] === true &&
      this.m_parentFields[aRow]?.GetText() === this.m_fields[aRow]!.GetText()
    );
  }

  ParentField(aRow: number): SCH_FIELD | null {
    return this.m_parentFields[aRow] ?? null;
  }

  EraseRow(aRow: number): boolean {
    if (this.m_isInherited.length > aRow) {
      // You can't erase inherited fields, but you can reset them to the parent value.
      if (this.m_isInherited[aRow]) {
        this.m_fields[aRow] = SCH_FIELD.copyOf(this.m_parentFields[aRow]!);
        return false;
      }

      this.m_isInherited.splice(aRow, 1);
    }

    if (this.m_parentFields.length > aRow) this.m_parentFields.splice(aRow, 1);

    this.m_fields.splice(aRow, 1);
    return true;
  }

  SwapRows(a: number, b: number): void {
    if (a >= this.m_fields.length || b >= this.m_fields.length) return;
    if (
      a >= this.m_isInherited.length ||
      b >= this.m_isInherited.length ||
      a >= this.m_parentFields.length ||
      b >= this.m_parentFields.length
    )
      return;

    [this.m_fields[a], this.m_fields[b]] = [this.m_fields[b]!, this.m_fields[a]!];
    [this.m_isInherited[a], this.m_isInherited[b]] = [
      this.m_isInherited[b]!,
      this.m_isInherited[a]!,
    ];
    [this.m_parentFields[a], this.m_parentFields[b]] = [
      this.m_parentFields[b]!,
      this.m_parentFields[a]!,
    ];
  }

  DetachFields(): void {
    for (const field of this.m_fields) field.SetParent(null);

    for (const field of this.m_parentFields) field?.SetParent(null);
  }
}
