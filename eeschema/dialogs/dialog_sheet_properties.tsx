// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SHEET_PROPERTIES` (eeschema/dialogs/dialog_sheet_properties.cpp) over
 * `dialog_sheet_properties_base.cpp`, on a live SCH_SHEET, opened by SCH_EDIT_FRAME::
 * EditSheetProperties.
 *
 *   ┌ Fields ─────────────────────────────────────────────┐
 *   │ Name | Value | Show | Show Name | H Align | V Align │   <- FIELDS_GRID_TABLE
 *   │ [+] [↑] [↓]   [🗑]                                  │
 *   └─────────────────────────────────────────────────────┘
 *   ┌ Attributes ───────────┐ ┌ Style ─────────────────────┐
 *   │ Page number: [   ]    │ │ Border             Fill    │
 *   │ [ ] Exclude from sim… │ │ Width: [ ] mm Color: [ ]   Color: [ ]
 *   └───────────────────────┘ └────────────────────────────┘
 *   Hierarchical path: /sub/                    [ Cancel ] [ OK ]
 *
 * The sheet name and file name are the two mandatory rows of the fields grid. OK changes the
 * sheet's file through SCH_EDIT_FRAME::ChangeSheetFile when it was renamed (or the sheet is new),
 * asking first whether an absolute path should be made relative; the undo step is the caller's,
 * gated on the isUndoable out-parameter.
 */
import { type JSX, useReducer, useState } from 'react';
import { DisplayErrorMessage, ShowKicadMessageDialog } from '@ziroeda/common/confirm.js';
import { ensureFileExtension } from '@ziroeda/common/common.js';
import { useModalEscape } from '@ziroeda/common/dialog_shim.js';
import { type Color4d, color4dEquals } from '@ziroeda/common/gal/color4d.js';
import type { KiDialogRequest } from '@ziroeda/common/kidialog.js';
import type { KiDialogResult } from '@ziroeda/common/kidialog_do_not_show.js';
import { IsFullFileNameValid } from '@ziroeda/common/string_utils.js';
import {
  DO_TRANSLATE,
  FIELD_T,
  FieldNamesAreDuplicates,
  GetUserFieldName,
  SHEET_MANDATORY_FIELDS,
} from '@ziroeda/common/template_fieldnames.js';
import { KiCadSchematicFileExtension } from '@ziroeda/common/wildcards_and_files_ext.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import type { GRID_TEXT_BUTTON_HOST } from '@ziroeda/common/widgets/grid_text_button_helpers.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { UNIT_BINDER, unitLabel } from '@ziroeda/common/widgets/unit_binder.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { wxCENTER, wxICON_QUESTION, wxYES_DEFAULT, wxYES_NO } from '@ziroeda/common/wx/defs.js';
import { wxMakeRelativeTo } from '@ziroeda/common/wx/filefn.js';
import {
  type wxGridEvent,
  wxEVT_GRID_CELL_CHANGING,
  wxGridSelectionModes,
  wxGridTableRequest,
} from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';
import { wxID_YES } from '@ziroeda/common/wx/menu.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { FIELDS_DATA_COL_ORDER, FIELDS_GRID_TABLE } from '../fields_grid_table.js';
import type { SCH_EDIT_FRAME, SHEET_PROPERTIES_RESULT } from '../sch_edit_frame.js';
import { SCH_FIELD } from '../sch_field.js';
import { AUTOPLACE_ALGO } from '../sch_item.js';
import { SCH_SHEET } from '../sch_sheet.js';
import { SCH_SHEET_LIST, SCH_SHEET_PATH } from '../sch_sheet_path.js';

/** WX_GRID column widths from the base class, by position, for the eight shown columns. */
const GRID_COLUMNS = [
  { width: 72 },
  { width: 72 },
  { width: 48, center: true },
  { width: 72, center: true },
  { width: 72, center: true },
  { width: 48, center: true },
  { width: 48, center: true },
  { width: 84, center: true },
];

export interface SHEET_DIALOG_VALUES {
  /** m_borderWidth's text, in the frame's units. */
  borderWidth: string;
  borderColor: Color4d;
  backgroundColor: Color4d;
  excludeFromSim: boolean;
  excludeFromBom: boolean;
  excludeFromBoard: boolean;
  dnp: boolean;
  pageNumber: string;
}

function positioningChanged(a: SCH_FIELD, b: SCH_FIELD): boolean {
  const pa = a.GetPosition();
  const pb = b.GetPosition();

  if (pa.x !== pb.x || pa.y !== pb.y) return true;

  if (a.GetHorizJustify() !== b.GetHorizJustify()) return true;

  if (a.GetVertJustify() !== b.GetVertJustify()) return true;

  if (!a.GetTextAngle().equals(b.GetTextAngle())) return true;

  return false;
}

function sheetPositioningChanged(a: FIELDS_GRID_TABLE, b: SCH_SHEET): boolean {
  if (positioningChanged(a.GetField(FIELD_T.SHEET_NAME)!, b.GetField(FIELD_T.SHEET_NAME)!))
    return true;

  if (positioningChanged(a.GetField(FIELD_T.SHEET_FILENAME)!, b.GetField(FIELD_T.SHEET_FILENAME)!))
    return true;

  return false;
}

export class DIALOG_SHEET_PROPERTIES {
  private readonly m_frame: SCH_EDIT_FRAME;
  private readonly m_sheet: SCH_SHEET;
  private readonly m_result: SHEET_PROPERTIES_RESULT;
  private readonly m_sourceSheetFilename: string | null;
  private readonly m_ask: (aRequest: KiDialogRequest) => Promise<KiDialogResult>;
  private readonly m_grid = new WX_GRID();
  private readonly m_fields: FIELDS_GRID_TABLE;
  private readonly m_borderWidth: UNIT_BINDER;
  private readonly m_dummySheet: SCH_SHEET;
  private readonly m_dummySheetNameField: SCH_FIELD;

  constructor(
    aParent: SCH_EDIT_FRAME,
    aSheet: SCH_SHEET,
    aResult: SHEET_PROPERTIES_RESULT,
    aSourceSheetFilename: string | null,
    aHost: GRID_TEXT_BUTTON_HOST,
    aAsk: (aRequest: KiDialogRequest) => Promise<KiDialogResult>,
  ) {
    this.m_frame = aParent;
    this.m_sheet = aSheet;
    this.m_result = aResult;
    this.m_sourceSheetFilename = aSourceSheetFilename;
    this.m_ask = aAsk;
    this.m_borderWidth = new UNIT_BINDER(aParent, 'Width:', (aMessage) =>
      DisplayErrorMessage(aMessage),
    );
    this.m_dummySheet = SCH_SHEET.copyOf(aSheet);
    this.m_dummySheetNameField = new SCH_FIELD(this.m_dummySheet, FIELD_T.SHEET_NAME);

    this.m_fields = new FIELDS_GRID_TABLE(this, aParent, this.m_grid, aSheet, aHost);

    this.m_grid.SetTable(this.m_fields, false, wxGridSelectionModes.wxGridSelectRows);
    this.m_grid.ShowHideColumns('0 1 2 3 4 5 6 7');

    // wxFormBuilder doesn't include this event...
    this.m_grid.Connect(wxEVT_GRID_CELL_CHANGING, (aEvent: wxGridEvent) =>
      this.OnGridCellChanging(aEvent),
    );
  }

  Grid(): WX_GRID {
    return this.m_grid;
  }

  Fields(): FIELDS_GRID_TABLE {
    return this.m_fields;
  }

  /** `DIALOG_SHIM::OnModify()`: nothing reads the modified flag here. */
  OnModify(): void {}

  /** m_infoBar: "Note: individual item colors overridden in Preferences." */
  ShowsOverrideNote(): boolean {
    return this.m_frame.GetColorSettings().GetOverrideSchItemColors();
  }

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): SHEET_DIALOG_VALUES {
    const instance = new SCH_SHEET_PATH(this.m_frame.GetCurrentSheet());
    const variantName = this.m_frame.Schematic().GetCurrentVariant();

    // Push a copy of each field into m_updateFields
    for (const field of this.m_sheet.GetFields()) {
      const field_copy = SCH_FIELD.copyOf(field);

      if (!field_copy.IsMandatory())
        field_copy.SetText(this.m_sheet.GetFieldText(field.GetName(), instance, variantName));

      // change offset to be symbol-relative
      const pos = this.m_sheet.GetPosition();
      field_copy.Offset({ x: -pos.x, y: -pos.y });

      this.m_fields.push_back(field_copy);
    }

    // notify the grid
    this.m_grid.ProcessTableMessage(
      wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED,
      this.m_fields.size(),
      0,
    );

    // border width
    this.m_borderWidth.SetValue(this.m_sheet.GetBorderWidth());

    const values: SHEET_DIALOG_VALUES = {
      borderWidth: this.m_borderWidth.GetText(),
      borderColor: this.m_sheet.GetBorderColor(),
      backgroundColor: this.m_sheet.GetBackgroundColor(),
      excludeFromSim: this.m_sheet.GetExcludedFromSim(instance, variantName),
      excludeFromBom: this.m_sheet.GetExcludedFromBOM(instance, variantName),
      excludeFromBoard: this.m_sheet.GetExcludedFromBoard(instance, variantName),
      dnp: this.m_sheet.GetDNP(instance, variantName),
      pageNumber: '',
    };

    instance.push_back(this.m_sheet);
    values.pageNumber = instance.GetPageNumber();

    return values;
  }

  /** `Validate()`: the grid's pending edit, and a name for every field that has text. */
  Validate(): boolean {
    if (!this.m_grid.CommitPendingChanges()) return false;

    // Check for missing field names.
    for (let i = 0; i < this.m_fields.size(); ++i) {
      const field = this.m_fields.at(i);

      if (field.IsMandatory()) continue;

      if (field.GetName(false) === '' && field.GetText() !== '') {
        DisplayErrorMessage('Fields must have a name.');
        this.m_grid.SetGridCursor(i, FIELDS_DATA_COL_ORDER.FDC_NAME);
        return false;
      }
    }

    return true;
  }

  /** `TransferDataFromWindow()`: false keeps the dialog open. */
  async TransferDataFromWindow(aValues: SHEET_DIALOG_VALUES): Promise<boolean> {
    if (!this.Validate()) return false;

    this.m_result.isUndoable = true;

    // Sheet file names can be relative or absolute.
    let sheetFileName = this.m_fields.GetField(FIELD_T.SHEET_FILENAME)!.GetText();

    // Ensure filepath is not empty.  (In normal use will be caught by grid validators,
    // but unedited data from existing files can be bad.)
    if (sheetFileName === '') {
      DisplayErrorMessage('A sheet must have a valid file name.');
      return false;
    }

    // Ensure the filename extension is OK.  (In normal use will be caught by grid validators,
    // but unedited data from existing files can be bad.)
    sheetFileName = ensureFileExtension(sheetFileName, KiCadSchematicFileExtension);

    // Ensure sheetFileName is legal
    if (!IsFullFileNameValid(sheetFileName)) {
      DisplayErrorMessage('A sheet must have a valid file name.');
      return false;
    }

    // Inside Eeschema, filenames are stored using unix notation
    let newRelativeFilename = sheetFileName.replace(/\\/g, '/');

    const oldFilename = this.m_sheet
      .GetField(FIELD_T.SHEET_FILENAME)!
      .GetText()
      .replace(/\\/g, '/');

    const filename_changed = oldFilename !== newRelativeFilename;

    if (filename_changed || this.m_sheet.IsNew()) {
      const currentScreen = this.m_frame.GetCurrentSheet().LastScreen();

      if (!currentScreen) return false;

      let clearFileName = false;

      // This can happen for the root sheet when opening Eeschema in the stand alone mode.
      if (currentScreen.GetFileName() === '') {
        clearFileName = true;
        currentScreen.SetFileName(this.m_frame.Prj().AbsolutePath('noname.kicad_sch'));
      }

      const screenFileName = currentScreen.GetFileName();

      if (newRelativeFilename.startsWith('/')) {
        const screenPath = screenFileName.slice(0, Math.max(0, screenFileName.lastIndexOf('/')));
        const relative = wxMakeRelativeTo(newRelativeFilename, screenPath);

        const answer = await ShowKicadMessageDialog({
          message: 'Use relative path for sheet file?',
          caption: 'Sheet File Path',
          style: wxYES_NO | wxYES_DEFAULT | wxICON_QUESTION | wxCENTER,
          extended:
            'Using relative hierarchical sheet file name paths improves schematic portability ' +
            'across systems and platforms.  Using absolute paths can result in portability issues.',
          okLabel: 'Use Relative Path',
          cancelLabel: 'Use Absolute Path',
        });

        if (answer === wxID_YES) {
          this.m_fields.GetField(FIELD_T.SHEET_FILENAME)!.SetText(relative);
          newRelativeFilename = relative;
        }
      }

      if (!(await this.onSheetFilenameChanged(newRelativeFilename))) {
        if (clearFileName) currentScreen.SetFileName('');
        else this.m_fields.GetField(FIELD_T.SHEET_FILENAME)!.SetText(oldFilename);

        return false;
      }

      this.m_result.updateHierarchyNavigator = true;

      if (clearFileName) currentScreen.SetFileName('');

      // One last validity check (and potential repair) just to be sure to be sure
      const repairedList = new SCH_SHEET_LIST();
      repairedList.BuildSheetList(this.m_frame.Schematic().Root(), true);
    }

    let newSheetname = this.m_fields.GetField(FIELD_T.SHEET_NAME)!.GetText();

    if (newSheetname !== this.m_sheet.GetName()) this.m_result.updateHierarchyNavigator = true;

    if (newSheetname === '') newSheetname = 'Untitled Sheet';

    this.m_fields.GetField(FIELD_T.SHEET_NAME)!.SetText(newSheetname);

    // Net names embed the sheet path, so retarget netclass/color assignments on a rename.
    const renamedPath = new SCH_SHEET_PATH(this.m_frame.GetCurrentSheet());
    renamedPath.push_back(this.m_sheet);
    const oldNetPrefix = renamedPath.PathHumanReadable(true, false, true);

    this.m_sheet.SetName(newSheetname);
    this.m_sheet.SetFileName(newRelativeFilename);

    const newNetPrefix = renamedPath.PathHumanReadable(true, false, true);

    if (oldNetPrefix !== newNetPrefix)
      this.m_frame
        .Prj()
        .GetProjectFile()
        .NetSettings()
        .RenameNetPathPrefix(oldNetPrefix, newNetPrefix);

    // change all field positions from relative to absolute
    for (const field of this.m_fields.Fields()) field.Offset(this.m_sheet.GetPosition());

    if (sheetPositioningChanged(this.m_fields, this.m_sheet))
      this.m_sheet.SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_NONE);

    const instance = new SCH_SHEET_PATH(this.m_frame.GetCurrentSheet());
    const variantName = this.m_frame.Schematic().GetCurrentVariant();

    let ordinal = 42; // Arbitrarily larger than any mandatory FIELD_T ids.

    for (const field of this.m_fields.Fields()) {
      const fieldName = field.GetCanonicalName();

      if (field.IsEmpty()) continue;
      else if (fieldName === '') field.SetName('untitled');

      const existingField = this.m_sheet.GetField(field.GetCanonicalName());
      let tmp: SCH_FIELD;

      if (!existingField) {
        tmp = this.m_sheet.AddField(field);
        tmp.SetParent(this.m_sheet);
      } else {
        const schematic = this.m_sheet.Schematic()!;
        const defaultText = schematic.ConvertRefsToKIIDs(existingField.GetText());
        tmp = existingField;

        field.Copy(tmp);
        tmp.SetParent(this.m_sheet);

        if (variantName !== '') {
          // Restore the default field text for existing fields.
          tmp.SetText(defaultText, instance);

          const variantText = schematic.ConvertRefsToKIIDs(field.GetText());
          tmp.SetText(variantText, instance, variantName);
        }
      }

      if (!field.IsMandatory()) field.SetOrdinal(ordinal++);
    }

    const sheetFields = this.m_sheet.GetFields();

    for (let ii = sheetFields.length - 1; ii >= 0; ii--) {
      const sheetField = sheetFields[ii]!;

      if (sheetField.IsMandatory()) continue;

      let found = false;

      for (const editedField of this.m_fields.Fields()) {
        if (editedField.GetName() === sheetField.GetName()) {
          found = true;
          break;
        }
      }

      if (!found) sheetFields.splice(ii, 1);
    }

    this.m_borderWidth.SetText(aValues.borderWidth);
    this.m_sheet.SetBorderWidth(this.m_borderWidth.GetIntValue());

    const colorSettings = this.m_frame.GetColorSettings();

    if (
      colorSettings.GetOverrideSchItemColors() &&
      (!color4dEquals(this.m_sheet.GetBorderColor(), aValues.borderColor) ||
        !color4dEquals(this.m_sheet.GetBackgroundColor(), aValues.backgroundColor))
    ) {
      await this.m_ask({
        caption: 'Warning',
        message: 'Note: item colors are overridden in the current color theme.',
        extendedMessage:
          // PANEL_EESCHEMA_COLOR_SETTINGS' m_optOverrideColors label (panel_color_settings_base.cpp:35)
          "To see individual item colors uncheck 'Override individual item colors'\n" +
          'in Preferences > Schematic Editor > Colors.',
        icon: 'warning',
        doNotShowKey: 'eeschema/dialogs/dialog_sheet_properties.cpp:TransferDataFromWindow',
      });
    }

    this.m_sheet.SetBorderColor(aValues.borderColor);
    this.m_sheet.SetBackgroundColor(aValues.backgroundColor);

    this.m_sheet.SetExcludedFromSim(aValues.excludeFromSim, instance, variantName);
    this.m_sheet.SetExcludedFromBOM(aValues.excludeFromBom, instance, variantName);
    this.m_sheet.SetExcludedFromBoard(aValues.excludeFromBoard);
    this.m_sheet.SetDNP(aValues.dnp, instance, variantName);

    instance.push_back(this.m_sheet);

    instance.SetPageNumber(aValues.pageNumber);

    this.m_frame.TestDanglingEnds();

    // Refresh all sheets in case ordering changed.
    for (const item of this.m_frame.GetScreen()!.Items().OfType(KICAD_T.SCH_SHEET_T))
      this.m_frame.UpdateItem(item);

    return true;
  }

  private onSheetFilenameChanged(aNewFilename: string): Promise<boolean> {
    const clearAnnotation = { value: this.m_result.clearAnnotation };
    const isUndoable = { value: this.m_result.isUndoable };

    return this.m_frame
      .ChangeSheetFile(
        this.m_sheet,
        aNewFilename,
        clearAnnotation,
        isUndoable,
        this.m_sourceSheetFilename,
      )
      .then((ok) => {
        this.m_result.clearAnnotation = clearAnnotation.value;
        this.m_result.isUndoable = isUndoable.value;
        return ok;
      });
  }

  /** `OnGridCellChanging( wxGridEvent& )`. */
  private OnGridCellChanging(aEvent: wxGridEvent): void {
    if (aEvent.GetCol() !== FIELDS_DATA_COL_ORDER.FDC_NAME) return;

    const newName = aEvent.GetString();

    for (let i = 0; i < this.m_grid.GetNumberRows(); ++i) {
      if (i === aEvent.GetRow()) continue;

      if (
        FieldNamesAreDuplicates(
          newName,
          this.m_grid.GetCellValue(i, FIELDS_DATA_COL_ORDER.FDC_NAME),
          SHEET_MANDATORY_FIELDS,
        )
      ) {
        DisplayErrorMessage(`Field name '${newName}' already in use.`);
        aEvent.Veto();
        break;
      }
    }
  }

  /** `OnAddField( wxCommandEvent& )`. */
  OnAddField(): void {
    this.m_grid.OnAddRow((): [number, number] => {
      const newField = new SCH_FIELD(
        this.m_sheet,
        FIELD_T.SHEET_USER,
        GetUserFieldName(this.m_fields.size(), DO_TRANSLATE),
      );

      newField.SetTextAngle(this.m_fields.GetField(FIELD_T.SHEET_NAME)!.GetTextAngle());
      newField.SetVisible(false);
      this.m_fields.push_back(newField);

      // notify the grid
      this.m_grid.ProcessTableMessage(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED, 1, 0);
      return [this.m_fields.size() - 1, FIELDS_DATA_COL_ORDER.FDC_NAME];
    });
  }

  /** `OnDeleteField( wxCommandEvent& )`. */
  OnDeleteField(): void {
    this.m_grid.OnDeleteRows(
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
        this.m_grid.ProcessTableMessage(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED, row, 1);
      },
    );
  }

  /** `OnMoveUp( wxCommandEvent& )`. */
  OnMoveUp(): void {
    this.m_grid.OnMoveRowUp(
      (row) => row > this.m_fields.GetMandatoryRowCount(),
      (row) => {
        this.m_fields.SwapRows(row, row - 1);
        this.m_grid.ForceRefresh();
      },
    );
  }

  /** `OnMoveDown( wxCommandEvent& )`: OnMoveRowUp upstream too (see the label dialog's). */
  OnMoveDown(): void {
    this.m_grid.OnMoveRowUp(
      (row) => row >= this.m_fields.GetMandatoryRowCount(),
      (row) => {
        this.m_fields.SwapRows(row, row + 1);
        this.m_grid.ForceRefresh();
      },
    );
  }

  /** OnUpdateUI's m_hierarchicalPath: the current path, then the sheet name as it will show. */
  HierarchicalPath(): string {
    let path = this.m_frame.GetCurrentSheet().PathHumanReadable(false);

    if (!path.endsWith('/')) path += '/';

    const sheetnameRow = this.m_fields.GetFieldRow(FIELD_T.SHEET_NAME);
    const editor = this.m_grid.GetCurrentEditor();
    const sheetName =
      editor &&
      this.m_grid.GetGridCursorRow() === sheetnameRow &&
      this.m_grid.GetGridCursorCol() === FIELDS_DATA_COL_ORDER.FDC_VALUE
        ? editor.m_value
        : this.m_grid.GetCellValue(sheetnameRow, FIELDS_DATA_COL_ORDER.FDC_VALUE);

    this.m_dummySheet.SetFields(this.m_fields.Fields());
    this.m_dummySheetNameField.SetText(sheetName);

    return path + this.m_dummySheetNameField.GetShownText(false);
  }
}

/** The form over DIALOG_SHEET_PROPERTIES. */
export function DialogSheetProperties({
  dlg,
  initial,
  units,
  onOk,
  onCancel,
}: {
  dlg: DIALOG_SHEET_PROPERTIES;
  initial: SHEET_DIALOG_VALUES;
  units: StatusUnits;
  onOk: (aValues: SHEET_DIALOG_VALUES) => void;
  onCancel: () => void;
}): JSX.Element {
  useModalEscape(onCancel);

  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [borderWidth, setBorderWidth] = useState(initial.borderWidth);
  const [borderColor, setBorderColor] = useState(initial.borderColor);
  const [backgroundColor, setBackgroundColor] = useState(initial.backgroundColor);
  const [excludeFromSim, setExcludeFromSim] = useState(initial.excludeFromSim);
  const [excludeFromBom, setExcludeFromBom] = useState(initial.excludeFromBom);
  const [excludeFromBoard, setExcludeFromBoard] = useState(initial.excludeFromBoard);
  const [dnp, setDnp] = useState(initial.dnp);
  const [pageNumber, setPageNumber] = useState(initial.pageNumber);

  const submit = (): void =>
    onOk({
      borderWidth,
      borderColor,
      backgroundColor,
      excludeFromSim,
      excludeFromBom,
      excludeFromBoard,
      dnp,
      pageNumber,
    });

  const button = (aBitmap: string, aTip: string, aRun: () => void): JSX.Element => (
    <StdBitmapButton
      bitmap={aBitmap}
      title={aTip}
      tooltip={null}
      onClick={() => {
        aRun();
        redraw();
      }}
    />
  );

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-props" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Sheet Properties
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-lp-body">
          {dlg.ShowsOverrideNote() && (
            <div className="ze-infobar">
              Note: individual item colors overridden in Preferences.
            </div>
          )}

          {/* sbFields */}
          <fieldset className="ze-lp-fields">
            <legend>Fields</legend>
            <div className="ze-lp-grid-wrap">
              <WxGridView
                grid={dlg.Grid()}
                columns={GRID_COLUMNS}
                flexCol={FIELDS_DATA_COL_ORDER.FDC_VALUE}
                ariaLabel="Fields"
                onUpdate={redraw}
              />
            </div>
            <div className="ze-lp-fieldbtns">
              {button('small_plus', 'Add field', () => dlg.OnAddField())}
              {button('small_up', 'Move up', () => dlg.OnMoveUp())}
              {button('small_down', 'Move down', () => dlg.OnMoveDown())}
              <span className="ze-lp-gap" />
              {button('small_trash', 'Delete field', () => dlg.OnDeleteField())}
            </div>
          </fieldset>

          {/* bSizer5: Attributes beside Style. */}
          <div className="ze-lp-options">
            <fieldset className="ze-lp-shape">
              <legend>Attributes</legend>
              <label className="ze-lp-check">
                Page number:
                <input
                  className="ze-lp-size"
                  value={pageNumber}
                  onChange={(e) => setPageNumber(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </label>
              <label className="ze-lp-check">
                <input
                  type="checkbox"
                  checked={excludeFromSim}
                  onChange={(e) => setExcludeFromSim(e.target.checked)}
                />
                Exclude from simulation
              </label>
              <label
                className="ze-lp-check"
                title={
                  'This is useful for adding symbols for board footprints such as fiducials\n' +
                  'and logos that you do not want to appear in the bill of materials export'
                }
              >
                <input
                  type="checkbox"
                  checked={excludeFromBom}
                  onChange={(e) => setExcludeFromBom(e.target.checked)}
                />
                Exclude from bill of materials
              </label>
              <label
                className="ze-lp-check"
                title={
                  'This is useful for adding symbols that only get exported to the bill of materials but\n' +
                  'not required to layout the board such as mechanical fasteners and enclosures'
                }
              >
                <input
                  type="checkbox"
                  checked={excludeFromBoard}
                  onChange={(e) => setExcludeFromBoard(e.target.checked)}
                />
                Exclude from board
              </label>
              <label className="ze-lp-check">
                <input type="checkbox" checked={dnp} onChange={(e) => setDnp(e.target.checked)} />
                Do not populate
              </label>
            </fieldset>

            <fieldset className="ze-lp-formatting">
              <legend>Style</legend>
              <div className="ze-lp-fmt-grid">
                <span className="ze-lp-fmt-label">Border</span>
                <span className="ze-lp-fmt-label">Fill</span>
                <div className="ze-lp-sizerow">
                  <span className="ze-lp-fmt-label">Width:</span>
                  <input
                    className="ze-lp-size"
                    value={borderWidth}
                    onChange={(e) => setBorderWidth(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <span className="ze-lp-units">{unitLabel(units)}</span>
                  <span className="ze-lp-colorlabel">Color:</span>
                  <span className="ze-lp-swatch-frame">
                    <ColorSwatch
                      className="ze-lp-swatch"
                      label="Border color"
                      color={borderColor}
                      onChange={setBorderColor}
                    />
                  </span>
                </div>
                <div className="ze-lp-sizerow">
                  <span className="ze-lp-colorlabel">Color:</span>
                  <span className="ze-lp-swatch-frame">
                    <ColorSwatch
                      className="ze-lp-swatch"
                      label="Fill color"
                      color={backgroundColor}
                      onChange={setBackgroundColor}
                    />
                  </span>
                </div>
              </div>
            </fieldset>
          </div>
        </div>

        {/* m_sizerBottom: the hierarchical path beside the standard buttons. */}
        <div className="ze-modal-footer">
          <span className="ze-sheetprops-pathlabel">Hierarchical path:</span>
          <span className="ze-sheetprops-path">{dlg.HierarchicalPath()}</span>
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
