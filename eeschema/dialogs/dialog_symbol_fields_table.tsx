// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SYMBOL_FIELDS_TABLE` (eeschema/dialogs/dialog_symbol_fields_table.cpp): the Symbol
 * Fields Table and BOM export over `dialog_symbol_fields_table_base.tsx`. Modeless; it lists the
 * live schematic's symbols (SCH_REFERENCE_LIST) in a FIELDS_EDITOR_GRID_DATA_MODEL on a WX_GRID,
 * follows the schematic through SCHEMATIC_LISTENER, and applies its edits as one SCH_COMMIT.
 *
 * What wx gives the dialog - its sub-dialogs, files, showing - is the window's
 * ({@link DIALOG_SYMBOL_FIELDS_TABLE_WINDOW}). Not here: the variants panel (onAddVariant ..
 * syncVariantSelection), which stays greyed; the dialog follows the schematic's current variant.
 */
import { useEffect, useState, type JSX } from 'react';
import { horizPixelsFromDU, vertPixelsFromDU } from '@ziroeda/common/dialog_shim.js';
import {
  ExpandEnvVarSubstitutions,
  ExpandTextVars,
  GetGeneratedFieldDisplayName,
  IsGeneratedField,
} from '@ziroeda/common/common.js';
import {
  DisplayErrorMessage,
  DisplayInfoMessage,
  IsOK,
  OKOrCancelDialog,
} from '@ziroeda/common/confirm.js';
import {
  GRIDTRICKS_FIRST_CLIENT_ID,
  GRIDTRICKS_FIRST_SHOWHIDE,
  GRID_TRICKS,
} from '@ziroeda/common/grid_tricks.js';
import { BOM_FMT_PRESET, BOM_PRESET } from '@ziroeda/common/settings/bom_settings.js';
import {
  FIELD_T,
  FieldNamesAreDuplicates,
  GetCanonicalFieldName,
  GetDefaultFieldName,
  MANDATORY_FIELDS,
} from '@ziroeda/common/template_fieldnames.js';
import { GetAssociatedDocument } from '@ziroeda/common/eda_doc.js';
import { GRID_CELL_TEXT_RENDERER } from '@ziroeda/common/widgets/grid_text_helpers.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  wxEVT_GRID_CELL_CHANGED,
  wxEVT_GRID_CELL_LEFT_CLICK,
  wxEVT_GRID_COL_SORT,
  wxEVT_GRID_RANGE_SELECTED,
  wxGridCellAttr,
  wxGridCellBoolRenderer,
  type wxGridEvent,
  type wxGridRangeSelectEvent,
  wxGridSelectionModes,
  wxGridTableRequest,
} from '@ziroeda/wx/grid.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import { GetTextExtent } from '@ziroeda/wx/controls.js';
import { type wxMenu, type wxMenuEvent, wxID_CANCEL } from '@ziroeda/wx/menu.js';
import { ContextMenu, type MenuItem } from '@ziroeda/wx/menu_ui.js';
import {
  DISPLAY_NAME_COLUMN,
  FIELDS_EDITOR_GRID_DATA_MODEL,
  GROUP_BY_COLUMN,
  LABEL_COLUMN,
  SHOW_FIELD_COLUMN,
  VIEW_CONTROLS_GRID_DATA_MODEL,
} from '../fields_data_model.js';
import { SCH_COMMIT } from '../sch_commit.js';
import {
  type SCH_EDIT_FRAME,
  type DIALOG_SYMBOL_FIELDS_TABLE as DIALOG_SYMBOL_FIELDS_TABLE_FRAME,
  SCH_SEARCH_T,
} from '../sch_edit_frame.js';
import type { SCH_ITEM } from '../sch_item.js';
import { type SCH_REFERENCE, SCH_REFERENCE_LIST } from '../sch_reference_list.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import { SCH_SHEET_LIST, SCH_SHEET_PATH, SYMBOL_FILTER } from '../sch_sheet_path.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';
import type { SCHEMATIC, SCHEMATIC_LISTENER } from '../schematic.js';
import type { SCHEMATIC_SETTINGS } from '../schematic_settings.js';
import { SCH_EDITOR_CONTROL } from '../tools/sch_editor_control.js';
import { SCH_SELECTION_TOOL } from '../tools/sch_selection_tool.js';
import {
  DIALOG_SYMBOL_FIELDS_TABLE_BASE,
  type PRESET_CHOICE,
} from './dialog_symbol_fields_table_base.js';
import { _ } from '@ziroeda/wx/translation.js';

/** `COLUMN_MARGIN` (dialog_symbol_fields_table.cpp): the slack a column gets past its text. */
const COLUMN_MARGIN = 15; // [data]

/**
 * `SetSize( wxSize( horizPixelsFromDU( 600 ), vertPixelsFromDU( 300 ) ) )`, after
 * finishDialogSettings (dialog_symbol_fields_table.cpp:316): the dialog's own size, which a saved
 * one replaces. It said 1050 across, a guess; on this desktop 600 DU is 1200.
 */
const DEFAULT_DLG_SIZE = { width: horizPixelsFromDU(600), height: vertPixelsFromDU(300) };

/** EESCHEMA_SETTINGS::PANEL_SYMBOL_FIELDS_TABLE, the "field_editor.*" slice. */
export interface FIELD_EDITOR_PANEL_SETTINGS {
  field_widths: Record<string, number>;
  export_filename: string;
  selection_mode: number;
  sash_pos: number;
  variant_sash_pos: number;
  sidebar_collapsed: boolean;
}

/** What wx gives the dialog that a page has to be handed. */
export interface DIALOG_SYMBOL_FIELDS_TABLE_WINDOW {
  /** `wxTextEntryDialog( this, aMessage, aCaption, aValue )`: null on Cancel. */
  textEntry(aMessage: string, aCaption: string, aValue: string): Promise<string | null>;
  /** `EDA_LIST_DIALOG( this, aCaption, aHeaders, aItems )` + `SetListLabel`: the picked row. */
  listDialog(aCaption: string, aLabel: string, aItems: readonly string[]): Promise<string | null>;
  /** `HandleUnsavedChanges( this, aMessage, aSaveFunction )`: false = the close is cancelled. */
  handleUnsavedChanges(aMessage: string, aSave: () => boolean): Promise<boolean>;
  /**
   * `wxFileDialog( "Bill of Materials Output File", ..., CsvFileWildcard(), wxFD_SAVE )`. Absent:
   * no browse button - the BOM is downloaded, so there is no file on disk to pick and the output
   * file box is just its name.
   */
  saveFileDialog?(aDefaultName: string): Promise<string | null>;
  /** `wxFFile( aPath, "wb" ).Write( aText )`: false when the file cannot be written. */
  writeFile(aPath: string, aText: string): boolean;
  /** `KIWAY::Player( FRAME_FOOTPRINT_CHOOSER )->ShowModal( &fpid )`: the picked LIB_ID or null. */
  chooseFootprint(aCurrent: string): Promise<string | null>;
  /** `Show( aShow )` / `Raise()` / `Destroy()`: the React window. */
  show(aShow: boolean): void;
  raise(): void;
  destroy(): void;
  /** EESCHEMA_SETTINGS m_FieldEditorPanel, read when built and written back on close. */
  fieldEditorSettings(): FIELD_EDITOR_PANEL_SETTINGS;
  saveFieldEditorSettings(aValues: FIELD_EDITOR_PANEL_SETTINGS): void;
}

/** A row of a popup menu the dialog opens. */
export interface FieldsMenuRow {
  label: string;
  help?: string;
  checked?: boolean;
  sep?: boolean;
  action?: () => void | Promise<void>;
}

const MYID_SELECT_FOOTPRINT = GRIDTRICKS_FIRST_CLIENT_ID;
const MYID_SHOW_DATASHEET = GRIDTRICKS_FIRST_CLIENT_ID + 1;

/** `FIELDS_EDITOR_GRID_TRICKS` (dialog_symbol_fields_table.cpp:97). */
class FIELDS_EDITOR_GRID_TRICKS extends GRID_TRICKS {
  constructor(
    private readonly m_dlg: DIALOG_SYMBOL_FIELDS_TABLE,
    aGrid: WX_GRID,
    private readonly m_viewControlsDataModel: VIEW_CONTROLS_GRID_DATA_MODEL,
    private readonly m_dataModel: FIELDS_EDITOR_GRID_DATA_MODEL,
  ) {
    super(aGrid);
  }

  protected override showPopupMenu(aMenu: wxMenu, aEvent: wxGridEvent): void {
    const col = this.m_grid.GetGridCursorCol();

    if (this.m_dataModel.GetColFieldName(col) === GetCanonicalFieldName(FIELD_T.FOOTPRINT)) {
      aMenu.Append(MYID_SELECT_FOOTPRINT, _('Select Footprint...'), _('Browse for footprint'));
      aMenu.AppendSeparator();
    } else if (this.m_dataModel.GetColFieldName(col) === GetCanonicalFieldName(FIELD_T.DATASHEET)) {
      aMenu.Append(MYID_SHOW_DATASHEET, _('Show Datasheet'), _('Show datasheet in browser'));
      aMenu.AppendSeparator();
    }

    super.showPopupMenu(aMenu, aEvent);
  }

  protected override doPopupSelection(aEvent: wxMenuEvent): void {
    const row = this.m_grid.GetGridCursorRow();
    let col = this.m_grid.GetGridCursorCol();

    if (aEvent.GetId() === MYID_SELECT_FOOTPRINT) {
      // pick a footprint using the footprint picker.
      const fpid = this.m_grid.GetCellValue(row, col);

      void this.m_dlg.m_window.chooseFootprint(fpid).then((picked) => {
        if (picked !== null) this.m_grid.SetCellValue(row, col, picked);
      });
    } else if (aEvent.GetId() === MYID_SHOW_DATASHEET) {
      const datasheet_uri = this.m_grid.GetCellValue(row, col);
      const prj = this.m_dlg.m_parent.Prj();
      GetAssociatedDocument(datasheet_uri, (aToken) => prj.TextVarResolver(aToken), [
        this.m_dlg.m_parent.Schematic().GetEmbeddedFiles(),
      ]);
    } else if (aEvent.GetId() >= GRIDTRICKS_FIRST_SHOWHIDE) {
      if (!this.m_grid.CommitPendingChanges(false)) return;

      // Pop-up column order is the order of the shown fields, not the viewControls order
      col = aEvent.GetId() - GRIDTRICKS_FIRST_SHOWHIDE;

      const show = !this.m_dataModel.GetShowColumn(col);

      this.m_dlg.ShowHideColumn(col, show);

      const fieldName = this.m_dataModel.GetColFieldName(col);

      for (let r = 0; r < this.m_viewControlsDataModel.GetNumberRows(); r++) {
        if (this.m_viewControlsDataModel.GetCanonicalFieldName(r) === fieldName)
          this.m_viewControlsDataModel.SetValueAsBool(r, SHOW_FIELD_COLUMN, show);
      }

      this.m_viewControlsDataModel.GetView()?.ForceRefresh();
    } else {
      super.doPopupSelection(aEvent);
    }
  }
}

export class DIALOG_SYMBOL_FIELDS_TABLE
  implements DIALOG_SYMBOL_FIELDS_TABLE_FRAME, SCHEMATIC_LISTENER
{
  // The window's controls, as state:
  /** m_nbPages: 0 Edit, 1 Export */
  m_nbPage = 0;
  m_filter = '';
  /** m_scope's selection */
  m_scope = 0;
  m_groupSymbols = false;
  m_textFieldDelimiter = '';
  m_textStringDelimiter = '';
  m_textRefDelimiter = '';
  m_textRefRangeDelimiter = '';
  m_checkKeepTabs = false;
  m_checkKeepLineBreaks = false;
  m_outputFileName = '';
  m_textOutput = '';
  m_status = '';
  /** m_cbBomPresets / m_cbBomFmtPresets: the choice rows and the selected index. */
  m_bomPresetChoices: string[] = [];
  m_bomPresetSelection = 0;
  m_bomFmtPresetChoices: string[] = [];
  m_bomFmtPresetSelection = 0;

  readonly m_parent: SCH_EDIT_FRAME;
  readonly m_window: DIALOG_SYMBOL_FIELDS_TABLE_WINDOW;
  private m_schSettings: SCHEMATIC_SETTINGS;
  private m_symbolsList = new SCH_REFERENCE_LIST();

  readonly m_viewControlsGrid = new WX_GRID();
  readonly m_grid = new WX_GRID();
  readonly m_viewControlsDataModel: VIEW_CONTROLS_GRID_DATA_MODEL;
  m_dataModel: FIELDS_EDITOR_GRID_DATA_MODEL;
  readonly m_viewControlsTricks: GRID_TRICKS;
  m_gridTricks: FIELDS_EDITOR_GRID_TRICKS;

  private m_mandatoryFieldListIndexes = new Map<FIELD_T, number>();

  private m_bomPresets = new Map<string, BOM_PRESET>();
  private m_currentBomPreset: BOM_PRESET | null = null;
  private m_lastSelectedBomPreset: BOM_PRESET | null = null;
  private m_bomPresetMRU: string[] = [];

  private m_bomFmtPresets = new Map<string, BOM_FMT_PRESET>();
  private m_currentBomFmtPreset: BOM_FMT_PRESET | null = null;
  private m_lastSelectedBomFmtPreset: BOM_FMT_PRESET | null = null;
  private m_bomFmtPresetMRU: string[] = [];

  private m_cfg: FIELD_EDITOR_PANEL_SETTINGS;
  private m_listeners = new Set<() => void>();
  private m_destroyed = false;
  private m_selectionEvents = false;

  constructor(aParent: SCH_EDIT_FRAME, aWindow: DIALOG_SYMBOL_FIELDS_TABLE_WINDOW) {
    this.m_parent = aParent;
    this.m_window = aWindow;
    this.m_schSettings = aParent.Schematic().Settings();
    this.m_cfg = structuredClone(aWindow.fieldEditorSettings());

    // Get all symbols from the list of schematic sheets
    aParent
      .Schematic()
      .Hierarchy()
      .GetSymbols(this.m_symbolsList, SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER);

    this.m_viewControlsDataModel = new VIEW_CONTROLS_GRID_DATA_MODEL(true);
    this.m_viewControlsGrid.SetTable(
      this.m_viewControlsDataModel,
      true,
      wxGridSelectionModes.wxGridSelectCells,
    );

    // add Cut, Copy, and Paste to wxGrid
    this.m_viewControlsTricks = new GRID_TRICKS(this.m_viewControlsGrid);

    let attr = new wxGridCellAttr();
    attr.SetReadOnly(true);
    this.m_viewControlsDataModel.SetColAttr(attr, DISPLAY_NAME_COLUMN);

    for (const col of [SHOW_FIELD_COLUMN, GROUP_BY_COLUMN]) {
      attr = new wxGridCellAttr();
      attr.SetRenderer(new wxGridCellBoolRenderer());
      attr.SetReadOnly(); // not really; we delegate interactivity to GRID_TRICKS
      this.m_viewControlsDataModel.SetColAttr(attr, col);
    }

    this.m_dataModel = this.makeDataModel();
    this.m_gridTricks = new FIELDS_EDITOR_GRID_TRICKS(
      this,
      this.m_grid,
      this.m_viewControlsDataModel,
      this.m_dataModel,
    );

    // Set the current variant for highlighting variant-specific field values
    this.m_dataModel.SetCurrentVariant(this.resolveVariant());

    this.m_grid.ClearSelection();

    this.m_viewControlsGrid.ShowHideColumns('0 1 2 3');

    this.m_outputFileName = this.m_schSettings.m_BomExportFileName;

    // Connect Events
    this.m_grid.Connect(wxEVT_GRID_COL_SORT, (e: wxGridEvent) => this.OnColSort(e));
    this.m_grid.Connect(wxEVT_GRID_CELL_LEFT_CLICK, (e: wxGridEvent) => this.OnTableCellClick(e));
    this.m_grid.Connect(wxEVT_GRID_CELL_CHANGED, () => this.OnTableValueChanged());
    this.m_viewControlsGrid.Connect(wxEVT_GRID_CELL_CHANGED, (e: wxGridEvent) =>
      this.OnViewControlsCellChanged(e),
    );

    // Start listening for schematic changes
    aParent.Schematic().AddListener(this);

    // finishDialogSettings() -> TransferDataToWindow()
    this.TransferDataToWindow();
  }

  /** `new FIELDS_EDITOR_GRID_DATA_MODEL( m_symbolsList, attr )` on m_grid. */
  private makeDataModel(): FIELDS_EDITOR_GRID_DATA_MODEL {
    const model = new FIELDS_EDITOR_GRID_DATA_MODEL(this.m_symbolsList, new wxGridCellAttr());
    this.m_grid.SetTable(model, true, wxGridSelectionModes.wxGridSelectCells);
    return model;
  }

  subscribe(aListener: () => void): () => void {
    this.m_listeners.add(aListener);
    return () => this.m_listeners.delete(aListener);
  }

  notify(): void {
    for (const l of this.m_listeners) l();
  }

  // ----- DIALOG_SYMBOL_FIELDS_TABLE_FRAME --------------------------------------------------------

  Show(aShow: boolean): void {
    this.m_window.show(aShow);
  }

  Raise(): void {
    this.m_window.raise();
  }

  /** `ShowEditTab()` (dialog_symbol_fields_table.cpp:1429). */
  ShowEditTab(): void {
    this.m_nbPage = 0;
    this.notify();
  }

  /** `ShowExportTab()` (dialog_symbol_fields_table.cpp:1435). */
  ShowExportTab(): void {
    this.m_nbPage = 1;
    this.OnPageChanged();
  }

  /** `~DIALOG_SYMBOL_FIELDS_TABLE` */
  Destroy(): void {
    if (this.m_destroyed) return;

    this.m_destroyed = true;
    this.savePresetsToSchematic();

    for (let i = 0; i < this.m_grid.GetNumberCols(); i++) {
      if (this.m_grid.IsColShown(i))
        this.m_cfg.field_widths[this.m_dataModel.GetColFieldName(i)] = this.m_grid.GetColSize(i);
    }

    this.m_window.saveFieldEditorSettings(this.m_cfg);
    this.m_window.destroy();
  }

  /**
   * TRANSITIONAL (S7, with sch_record_bridge.ts): the window's live mirror reopened the project and
   * the frame holds a new SCHEMATIC; the dialog lists the new one's symbols.
   */
  OnSchematicReplaced(): void {
    this.m_schSettings = this.m_parent.Schematic().Settings();
    this.m_symbolsList = new SCH_REFERENCE_LIST();
    this.m_parent
      .Schematic()
      .Hierarchy()
      .GetSymbols(this.m_symbolsList, SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER);

    const preset = this.m_dataModel.GetBomSettings();
    this.m_dataModel = this.makeDataModel();
    this.m_gridTricks = new FIELDS_EDITOR_GRID_TRICKS(
      this,
      this.m_grid,
      this.m_viewControlsDataModel,
      this.m_dataModel,
    );

    for (let i = 0; i < this.m_viewControlsDataModel.GetNumberRows(); i++) {
      this.m_dataModel.AddColumn(
        this.m_viewControlsDataModel.GetCanonicalFieldName(i),
        this.m_viewControlsDataModel.GetValue(i, LABEL_COLUMN),
        false,
      );
    }

    this.m_parent.Schematic().AddListener(this);
    this.doApplyBomPreset(preset);
    this.notify();
  }

  // ----- the dialog ------------------------------------------------------------------------------

  /** `SetupColumnProperties( aCol )` (dialog_symbol_fields_table.cpp:417). */
  SetupColumnProperties(aCol: number): void {
    const attr = new wxGridCellAttr();
    attr.SetReadOnly(false);

    // Set some column types to specific editors
    if (this.m_dataModel.ColIsReference(aCol)) {
      attr.SetReadOnly();
      attr.SetRenderer(new GRID_CELL_TEXT_RENDERER());
    } else if (this.m_dataModel.ColIsQuantity(aCol) || this.m_dataModel.ColIsItemNumber(aCol)) {
      attr.SetReadOnly();
    } else if (this.m_dataModel.ColIsAttribute(aCol)) {
      attr.SetRenderer(new wxGridCellBoolRenderer());
      attr.SetReadOnly(); // not really; we delegate interactivity to GRID_TRICKS
    } else if (IsGeneratedField(this.m_dataModel.GetColFieldName(aCol))) {
      attr.SetReadOnly();
    } else {
      attr.SetRenderer(new GRID_CELL_TEXT_RENDERER());
    }

    this.m_dataModel.SetColAttr(attr, aCol);
  }

  /** `SetupAllColumnProperties()` (dialog_symbol_fields_table.cpp:469). */
  SetupAllColumnProperties(): void {
    let sortCol = 0;
    let sortAscending = true;

    for (let col = 0; col < this.m_grid.GetNumberCols(); ++col) {
      this.SetupColumnProperties(col);

      if (col === this.m_dataModel.GetSortCol()) {
        sortCol = col;
        sortAscending = this.m_dataModel.GetSortAsc();
      }
    }

    // sync m_grid's column visibilities to Show checkboxes in m_viewControlsGrid
    for (let i = 0; i < this.m_viewControlsDataModel.GetNumberRows(); ++i) {
      const col = this.m_dataModel.GetFieldNameCol(
        this.m_viewControlsDataModel.GetCanonicalFieldName(i),
      );

      if (col === -1) continue;

      const show = this.m_viewControlsDataModel.GetValueAsBool(i, SHOW_FIELD_COLUMN);
      this.m_dataModel.SetShowColumn(col, show);

      if (show) {
        this.m_grid.ShowCol(col);

        const saved = this.m_cfg.field_widths[this.m_dataModel.GetColFieldName(col)];

        if (saved && saved > 0) {
          this.m_grid.SetColSize(col, saved);
        } else {
          const textWidth = this.m_dataModel.GetDataWidth(col) + COLUMN_MARGIN;
          const maxWidth = DEFAULT_DLG_SIZE.width / 3;

          this.m_grid.SetColSize(col, Math.min(Math.max(textWidth, 100), maxWidth));
        }
      } else {
        this.m_grid.HideCol(col);
      }
    }

    this.m_dataModel.SetSorting(sortCol, sortAscending);
    this.m_grid.SetSortingColumn(sortCol, sortAscending);
  }

  /** `TransferDataToWindow()` (dialog_symbol_fields_table.cpp:531). */
  TransferDataToWindow(): boolean {
    this.LoadFieldNames(); // loads rows into m_viewControlsDataModel and columns into m_dataModel

    // Load our BOM view presets
    this.SetUserBomPresets(this.m_schSettings.m_BomPresets);

    this.ApplyBomPresetByValue(structuredClone(this.m_schSettings.m_BomSettings));
    this.syncBomPresetSelection();

    // Load BOM export format presets
    this.SetUserBomFmtPresets(this.m_schSettings.m_BomFmtPresets);
    this.ApplyBomFmtPresetByValue(structuredClone(this.m_schSettings.m_BomFmtSettings));
    this.syncBomFmtPresetSelection();

    this.m_dataModel.SetGroupingEnabled(this.m_groupSymbols);

    this.setScope(this.m_scope);

    const selection = this.m_parent.GetToolManager()?.GetTool(SCH_SELECTION_TOOL)?.GetSelection();
    let symbol: SCH_SYMBOL | null = null;

    if (selection && selection.GetSize() === 1) {
      const item = selection.Front()!;

      if (item.Type() === KICAD_T.SCH_SYMBOL_T) symbol = item as unknown as SCH_SYMBOL;
      else if (item.GetParent()?.Type() === KICAD_T.SCH_SYMBOL_T)
        symbol = item.GetParent() as unknown as SCH_SYMBOL;
    }

    if (symbol) {
      for (let row = 0; row < this.m_dataModel.GetNumberRows(); ++row) {
        if (!this.m_dataModel.GetRowReferences(row).some((ref) => ref.GetSymbol() === symbol))
          continue;

        // Find the value column and the reference column if they're shown
        let valueCol = -1;
        let refCol = -1;
        let anyCol = -1;

        for (let col = 0; col < this.m_dataModel.GetNumberCols(); col++) {
          if (this.m_dataModel.ColIsValue(col)) valueCol = col;
          else if (this.m_dataModel.ColIsReference(col)) refCol = col;
          else if (anyCol === -1 && this.m_dataModel.GetShowColumn(col)) anyCol = col;
        }

        if (valueCol !== -1 && this.m_dataModel.GetShowColumn(valueCol))
          this.m_grid.GoToCell(row, valueCol);
        else if (refCol !== -1 && this.m_dataModel.GetShowColumn(refCol))
          this.m_grid.GoToCell(row, refCol);
        else if (anyCol !== -1) this.m_grid.GoToCell(row, anyCol);

        break;
      }
    }

    // We don't want table range selection events to happen until we've loaded the data.
    this.EnableSelectionEvents();

    return true;
  }

  /** `TransferDataFromWindow()` (dialog_symbol_fields_table.cpp:669). */
  TransferDataFromWindow(): boolean {
    if (!this.m_grid.CommitPendingChanges()) return false;

    const commit = new SCH_COMMIT(this.m_parent);
    const currentSheet = this.m_parent.GetCurrentSheet();
    const currentVariant = this.m_parent.Schematic().GetCurrentVariant();

    this.m_dataModel.ApplyData(commit, this.m_schSettings.m_TemplateFieldNames, currentVariant);

    if (!commit.Empty()) {
      commit.Push('Symbol Fields Table Edit'); // Push clears the commit buffer.
      this.m_parent.OnModify();
    }

    // Reset the view to where we left the user
    this.m_parent.SetCurrentSheet(currentSheet);
    this.m_parent.SyncView();
    this.m_parent.GetCanvas()?.Refresh();

    this.notify();
    return true;
  }

  /** `AddField( aFieldName, aLabelValue, show, groupBy, addedByUser )` (dialog_symbol_fields_table.cpp:704). */
  AddField(
    aFieldName: string,
    aLabelValue: string,
    show: boolean,
    groupBy: boolean,
    addedByUser = false,
  ): void {
    // Users can add fields with variable names that match the special names in the grid,
    // e.g. ${QUANTITY} so make sure we don't add them twice
    for (let row = 0; row < this.m_viewControlsDataModel.GetNumberRows(); row++) {
      if (
        FieldNamesAreDuplicates(this.m_viewControlsDataModel.GetCanonicalFieldName(row), aFieldName)
      )
        return;
    }

    this.m_dataModel.AddColumn(aFieldName, aLabelValue, addedByUser);

    this.m_grid.ProcessTableMessage(wxGridTableRequest.wxGRIDTABLE_NOTIFY_COLS_APPENDED, 1, 0);

    this.m_viewControlsGrid.OnAddRow(() => {
      this.m_viewControlsDataModel.AppendRow(aFieldName, aLabelValue, show, groupBy);
      return [this.m_viewControlsDataModel.GetNumberRows() - 1, -1];
    });
  }

  /** `LoadFieldNames()` (dialog_symbol_fields_table.cpp:733). */
  LoadFieldNames(): void {
    const addMandatoryField = (fieldId: FIELD_T, show: boolean, groupBy: boolean): void => {
      this.m_mandatoryFieldListIndexes.set(fieldId, this.m_viewControlsDataModel.GetNumberRows());

      this.AddField(
        GetCanonicalFieldName(fieldId),
        GetDefaultFieldName(fieldId, true),
        show,
        groupBy,
      );
    };

    // Add mandatory fields first            show   groupBy
    addMandatoryField(FIELD_T.REFERENCE, true, true);
    addMandatoryField(FIELD_T.VALUE, true, true);
    addMandatoryField(FIELD_T.FOOTPRINT, true, true);
    addMandatoryField(FIELD_T.DATASHEET, true, false);
    addMandatoryField(FIELD_T.DESCRIPTION, false, false);

    // Generated fields present only in the fields table
    this.AddField(FIELDS_EDITOR_GRID_DATA_MODEL.QUANTITY_VARIABLE, _('Qty'), true, false);
    this.AddField(FIELDS_EDITOR_GRID_DATA_MODEL.ITEM_NUMBER_VARIABLE, '#', true, false);

    // User field names are stored and matched case-sensitively (see issue #24021), so each
    // distinct name gets its own column rather than collapsing case variants together.
    const userFieldNames = new Set<string>();

    for (let ii = 0; ii < this.m_symbolsList.GetCount(); ++ii) {
      for (const field of this.m_symbolsList.GetItem(ii).GetSymbol()!.GetFields()) {
        if (!field.IsMandatory() && !field.IsPrivate()) userFieldNames.add(field.GetName());
      }
    }

    for (const fieldName of [...userFieldNames].sort())
      this.AddField(fieldName, GetGeneratedFieldDisplayName(fieldName), true, false);

    // Add any templateFieldNames which aren't already present.
    for (const tfn of this.m_schSettings.m_TemplateFieldNames.GetTemplateFieldNames()) {
      if (!userFieldNames.has(tfn.m_Name))
        this.AddField(tfn.m_Name, GetGeneratedFieldDisplayName(tfn.m_Name), false, false);
    }
  }

  /** `OnAddField()` (dialog_symbol_fields_table.cpp:782). */
  async OnAddField(): Promise<void> {
    const fieldName = await this.m_window.textEntry(_('New field name:'), _('Add Field'), '');

    if (fieldName === null) return;

    if (fieldName === '') {
      DisplayErrorMessage(_('Field must have a name.'));
      return;
    }

    for (let i = 0; i < this.m_dataModel.GetNumberCols(); ++i) {
      if (FieldNamesAreDuplicates(fieldName, this.m_dataModel.GetColFieldName(i))) {
        DisplayErrorMessage(`Field name '${fieldName}' already in use.`);
        return;
      }
    }

    this.AddField(fieldName, GetGeneratedFieldDisplayName(fieldName), true, false, true);

    this.SetupColumnProperties(this.m_dataModel.GetNumberCols() - 1);

    this.syncBomPresetSelection();
    this.notify();
  }

  /** `OnRemoveField()` (dialog_symbol_fields_table.cpp:815). */
  async OnRemoveField(): Promise<void> {
    const rows = this.m_viewControlsGrid.GetSelectedRows();

    if (rows.length === 0 && this.m_viewControlsGrid.GetGridCursorRow() >= 0)
      rows.push(this.m_viewControlsGrid.GetGridCursorRow());

    for (const row of rows) {
      for (const id of MANDATORY_FIELDS) {
        if (this.m_mandatoryFieldListIndexes.get(id) === row) {
          DisplayErrorMessage(
            `The first ${this.m_mandatoryFieldListIndexes.size} fields are mandatory.`,
          );
          return;
        }
      }

      const confirmed = await IsOK(
        `Are you sure you want to remove the field '${this.m_viewControlsDataModel.GetValue(row, DISPLAY_NAME_COLUMN)}'?`,
      );

      if (!confirmed) return;
    }

    this.m_viewControlsGrid.OnDeleteRows((row) => {
      const fieldName = this.m_viewControlsDataModel.GetCanonicalFieldName(row);
      const col = this.m_dataModel.GetFieldNameCol(fieldName);

      if (col !== -1) this.m_dataModel.RemoveColumn(col);

      this.m_viewControlsDataModel.DeleteRow(row);

      this.syncBomPresetSelection();
    });

    this.notify();
  }

  /** `OnRenameField()` (dialog_symbol_fields_table.cpp:849). */
  async OnRenameField(): Promise<void> {
    const selectedRows = this.m_viewControlsGrid.GetSelectedRows();

    if (selectedRows.length === 0 && this.m_viewControlsGrid.GetGridCursorRow() >= 0)
      selectedRows.push(this.m_viewControlsGrid.GetGridCursorRow());

    if (selectedRows.length === 0) return;

    const row = selectedRows[0]!;

    for (const id of MANDATORY_FIELDS) {
      if (this.m_mandatoryFieldListIndexes.get(id) === row) {
        DisplayErrorMessage(
          `The first ${this.m_mandatoryFieldListIndexes.size} fields are mandatory and names cannot be changed.`,
        );
        return;
      }
    }

    const fieldName = this.m_viewControlsDataModel.GetCanonicalFieldName(row);
    const label = this.m_viewControlsDataModel.GetValue(row, LABEL_COLUMN);
    const labelIsAutogenerated = label === GetGeneratedFieldDisplayName(fieldName);

    const col = this.m_dataModel.GetFieldNameCol(fieldName);

    if (col === -1) return; // wxCHECK_RET: "Existing field name missing from data model"

    const newFieldName = await this.m_window.textEntry(
      _('New field name:'),
      _('Rename Field'),
      fieldName,
    );

    if (newFieldName === null) return;

    // No change, no-op
    if (newFieldName === fieldName) return;

    // New field name already exists
    if (this.m_dataModel.GetFieldNameCol(newFieldName) !== -1) {
      DisplayErrorMessage(`Field name ${newFieldName} already exists.`);
      return;
    }

    this.m_dataModel.RenameColumn(col, newFieldName);
    this.m_viewControlsDataModel.SetCanonicalFieldName(row, newFieldName);
    this.m_viewControlsDataModel.SetValue(row, DISPLAY_NAME_COLUMN, newFieldName);

    if (labelIsAutogenerated) {
      this.m_viewControlsDataModel.SetValue(
        row,
        LABEL_COLUMN,
        GetGeneratedFieldDisplayName(newFieldName),
      );
      this.onViewControlsCellChanged(row, LABEL_COLUMN);
    }

    this.syncBomPresetSelection();
    this.notify();
  }

  /** `OnFilterText()` (dialog_symbol_fields_table.cpp:913). */
  OnFilterText(aText: string): void {
    this.m_filter = aText;
    this.m_dataModel.SetFilter(this.m_filter);
    this.m_dataModel.RebuildRows();
    this.m_grid.ForceRefresh();

    this.syncBomPresetSelection();
    this.notify();
  }

  /** `setScope( aScope )` (dialog_symbol_fields_table.cpp:941). */
  private setScope(aScope: number): void {
    this.m_dataModel.SetPath(this.m_parent.GetCurrentSheet());
    this.m_dataModel.SetScope(aScope);
    this.m_dataModel.RebuildRows();
  }

  /** `OnScope()` (dialog_symbol_fields_table.cpp:949). */
  OnScope(aSelection: number): void {
    this.m_scope = aSelection;

    switch (aSelection) {
      case 0:
        this.setScope(FIELDS_EDITOR_GRID_DATA_MODEL.SCOPE.SCOPE_ALL);
        break;
      case 1:
        this.setScope(FIELDS_EDITOR_GRID_DATA_MODEL.SCOPE.SCOPE_SHEET);
        break;
      case 2:
        this.setScope(FIELDS_EDITOR_GRID_DATA_MODEL.SCOPE.SCOPE_SHEET_RECURSIVE);
        break;
    }

    this.m_grid.ForceRefresh();
    this.notify();
  }

  /** `OnGroupSymbolsToggled()` (dialog_symbol_fields_table.cpp:960). */
  OnGroupSymbolsToggled(aValue: boolean): void {
    this.m_groupSymbols = aValue;
    this.m_dataModel.SetGroupingEnabled(aValue);
    this.m_dataModel.RebuildRows();
    this.m_grid.ForceRefresh();

    this.syncBomPresetSelection();
    this.notify();
  }

  /** `OnMenu()` (dialog_symbol_fields_table.cpp:970): the gear's popup. */
  OnMenu(): FieldsMenuRow[] {
    const cfg = this.m_cfg;
    const rebuild = (): void => {
      this.m_dataModel.RebuildRows();
      this.m_grid.ForceRefresh();
      this.syncBomPresetSelection();
      this.notify();
    };

    return [
      {
        label: _("Include 'DNP' Symbols"),
        help: _(
          "Show symbols marked 'DNP' in the table.  This setting also controls whether or not 'DNP' symbols are included on export.",
        ),
        checked: !this.m_dataModel.GetExcludeDNP(),
        action: () => {
          this.m_dataModel.SetExcludeDNP(!this.m_dataModel.GetExcludeDNP());
          rebuild();
        },
      },
      {
        label: _("Include 'Exclude from BOM' Symbols"),
        help: _(
          "Show symbols marked 'Exclude from BOM' in the table.  Symbols marked 'Exclude from BOM' are never included on export.",
        ),
        checked: this.m_dataModel.GetIncludeExcludedFromBOM(),
        action: () => {
          this.m_dataModel.SetIncludeExcludedFromBOM(!this.m_dataModel.GetIncludeExcludedFromBOM());
          rebuild();
        },
      },
      { label: '', sep: true },
      {
        label: _('Highlight on Cross-probe'),
        help: _('Highlight corresponding item on canvas when it is selected in the table'),
        checked: cfg.selection_mode === 0,
        action: () => {
          cfg.selection_mode = cfg.selection_mode !== 0 ? 0 : 2;
          this.notify();
        },
      },
      {
        label: _('Select on Cross-probe'),
        help: _('Select corresponding item on canvas when it is selected in the table'),
        checked: cfg.selection_mode === 1,
        action: () => {
          cfg.selection_mode = cfg.selection_mode !== 1 ? 1 : 2;
          this.notify();
        },
      },
    ];
  }

  /** `OnColSort( aEvent )` (dialog_symbol_fields_table.cpp:1037). */
  OnColSort(aEvent: wxGridEvent): void {
    const sortCol = aEvent.GetCol();

    // Don't sort by item number, it is generated by the sort
    if (this.m_dataModel.ColIsItemNumber(sortCol)) {
      aEvent.Veto();
      return;
    }

    // wxWidgets doesn't tell us ascending/descending in the event, and if we ask it will give
    // us pre-event info.
    const ascending = this.m_grid.IsSortingBy(sortCol) ? !this.m_grid.IsSortOrderAscending() : true;

    this.m_dataModel.SetSorting(sortCol, ascending);
    this.m_dataModel.RebuildRows();
    this.m_grid.ForceRefresh();

    this.syncBomPresetSelection();
    this.notify();
  }

  /** `ShowHideColumn( aCol, aShow )` (dialog_symbol_fields_table.cpp:1112). */
  ShowHideColumn(aCol: number, aShow: boolean): void {
    if (aShow) this.m_grid.ShowCol(aCol);
    else this.m_grid.HideCol(aCol);

    this.m_dataModel.SetShowColumn(aCol, aShow);

    this.syncBomPresetSelection();

    if (this.m_nbPage === 1) this.PreviewRefresh();
    else this.m_grid.ForceRefresh();

    this.notify();
  }

  /** `OnViewControlsCellChanged( aEvent )` (dialog_symbol_fields_table.cpp:1132). */
  /**
   * `OnSizeViewControlsGrid` (dialog_symbol_fields_table.cpp:1342): Include and Group By are
   * as wide as their labels, and Field and BOM Name share what the grid window has left -
   * so the grid always fits its pane, a long field name clipped in its cell.
   */
  OnSizeViewControlsGrid(aWidth: number): void {
    const grid = this.m_viewControlsGrid;
    const showColWidth = GetTextExtent(grid.GetColLabelValue(SHOW_FIELD_COLUMN)) + COLUMN_MARGIN;
    const groupByColWidth = GetTextExtent(grid.GetColLabelValue(GROUP_BY_COLUMN)) + COLUMN_MARGIN;
    const remainingWidth = aWidth - showColWidth - groupByColWidth;

    grid.SetColSize(SHOW_FIELD_COLUMN, showColWidth);
    grid.SetColSize(GROUP_BY_COLUMN, groupByColWidth);

    if (grid.IsColShown(DISPLAY_NAME_COLUMN) && grid.IsColShown(LABEL_COLUMN)) {
      const half = Math.trunc(remainingWidth / 2);
      grid.SetColSize(DISPLAY_NAME_COLUMN, Math.max(half, 60));
      grid.SetColSize(LABEL_COLUMN, Math.max(remainingWidth - half, 60));
    } else if (grid.IsColShown(DISPLAY_NAME_COLUMN)) {
      grid.SetColSize(DISPLAY_NAME_COLUMN, Math.max(remainingWidth, 60));
    } else if (grid.IsColShown(LABEL_COLUMN)) {
      grid.SetColSize(LABEL_COLUMN, Math.max(remainingWidth, 60));
    }
  }

  OnViewControlsCellChanged(aEvent: wxGridEvent): void {
    this.onViewControlsCellChanged(aEvent.GetRow(), aEvent.GetCol());
  }

  private onViewControlsCellChanged(row: number, aCol: number): void {
    if (row >= this.m_viewControlsGrid.GetNumberRows()) return;

    const fieldName = this.m_viewControlsDataModel.GetCanonicalFieldName(row);
    const dataCol = this.m_dataModel.GetFieldNameCol(fieldName);

    switch (aCol) {
      case LABEL_COLUMN: {
        const label = this.m_viewControlsDataModel.GetValue(row, LABEL_COLUMN);

        if (dataCol !== -1) {
          this.m_dataModel.SetColLabelValue(dataCol, label);
          this.m_grid.SetColLabelValue(dataCol, label);

          if (this.m_nbPage === 1) this.PreviewRefresh();
          else this.m_grid.ForceRefresh();

          this.syncBomPresetSelection();
        }

        break;
      }

      case SHOW_FIELD_COLUMN: {
        const value = this.m_viewControlsDataModel.GetValueAsBool(row, SHOW_FIELD_COLUMN);

        if (dataCol !== -1) this.ShowHideColumn(dataCol, value);

        break;
      }

      case GROUP_BY_COLUMN: {
        let value = this.m_viewControlsDataModel.GetValueAsBool(row, GROUP_BY_COLUMN);

        if (this.m_dataModel.ColIsQuantity(dataCol) && value) {
          DisplayErrorMessage(_('The Quantity column cannot be grouped by.'));

          value = false;
          this.m_viewControlsDataModel.SetValueAsBool(row, GROUP_BY_COLUMN, value);
          break;
        }

        if (this.m_dataModel.ColIsItemNumber(dataCol) && value) {
          DisplayErrorMessage(_('The Item Number column cannot be grouped by.'));

          value = false;
          this.m_viewControlsDataModel.SetValueAsBool(row, GROUP_BY_COLUMN, value);
          break;
        }

        this.m_dataModel.SetGroupColumn(dataCol, value);
        this.m_dataModel.RebuildRows();

        if (this.m_nbPage === 1) this.PreviewRefresh();
        else this.m_grid.ForceRefresh();

        this.syncBomPresetSelection();
        break;
      }

      default:
        break;
    }

    this.notify();
  }

  /** `OnTableValueChanged()` (dialog_symbol_fields_table.cpp:1218). */
  OnTableValueChanged(): void {
    this.m_grid.ForceRefresh();
    this.notify();
  }

  /** `OnRegroupSymbols()` (dialog_symbol_fields_table.cpp:1232). */
  OnRegroupSymbols(): void {
    this.m_dataModel.RebuildRows();
    this.m_grid.ForceRefresh();
    this.notify();
  }

  /** `OnTableCellClick( event )` (dialog_symbol_fields_table.cpp:1239). */
  OnTableCellClick(aEvent: wxGridEvent): void {
    if (this.m_dataModel.IsExpanderColumn(aEvent.GetCol())) {
      this.m_grid.ClearSelection();

      this.m_dataModel.ExpandCollapseRow(aEvent.GetRow());
      this.m_grid.SetGridCursor(aEvent.GetRow(), aEvent.GetCol());
      this.notify();
    } else {
      aEvent.Skip();
    }
  }

  /** `OnTableRangeSelected( aEvent )` (dialog_symbol_fields_table.cpp:1285). */
  OnTableRangeSelected(aEvent: wxGridRangeSelectEvent): void {
    const cfg = this.m_cfg;

    // Cross-probing should only work in Edit page
    if (this.m_nbPage !== 0) return;

    // Multi-select can grab the rows that are expanded child refs, and also the row
    // containing the list of all child refs. Make sure we add refs/symbols uniquely
    const refs = new Map<string, SCH_REFERENCE>();
    const symbols = new Set<SCH_ITEM>();

    // This handler handles selecting and deselecting
    if (aEvent.Selecting()) {
      const top = aEvent.GetTopLeftCoords().GetRow();
      const bottom = aEvent.GetBottomRightCoords().GetRow();

      for (let i = top; i <= bottom; i++) {
        for (const ref of this.m_dataModel.GetRowReferences(i)) refs.set(ref.GetFullPath(), ref);
      }

      for (const ref of refs.values()) symbols.add(ref.GetSymbol()!);
    }

    // std::set<SCH_REFERENCE>'s first, by full path
    const first = [...refs.keys()].sort()[0];

    if (cfg.selection_mode === 0) {
      const editor = this.m_parent.GetToolManager()?.GetTool(SCH_EDITOR_CONTROL);

      if (first !== undefined) {
        // Use of full path based on UUID allows select of not yet annotated or duplicated
        // symbols
        editor?.FindSymbolAndItem(first, null, true, SCH_SEARCH_T.HIGHLIGHT_SYMBOL, '');
      } else {
        this.m_parent.ClearFocus();
      }
    } else if (cfg.selection_mode === 1) {
      const selTool = this.m_parent.GetToolManager()?.GetTool(SCH_SELECTION_TOOL);

      if (first !== undefined)
        selTool?.SyncSelection(refs.get(first)!.GetSheetPath(), null, [...symbols]);
      else selTool?.ClearSelection();
    }
  }

  /** `OnSaveAndContinue()` (dialog_symbol_fields_table.cpp:1371): Apply, Save Schematic & Continue. */
  OnSaveAndContinue(): void {
    if (this.TransferDataFromWindow()) {
      this.m_schSettings.m_BomExportFileName = this.m_outputFileName;
      void this.m_parent.SaveProject();
    }
  }

  /** `OnPageChanged()` (dialog_symbol_fields_table.cpp:1382). */
  OnPageChanged(): void {
    if (this.m_dataModel.GetNumberCols()) this.PreviewRefresh();

    this.notify();
  }

  /** `OnPreviewRefresh()` (dialog_symbol_fields_table.cpp:1389). */
  OnPreviewRefresh(): void {
    this.PreviewRefresh();
    this.syncBomFmtPresetSelection();
    this.notify();
  }

  /** `PreviewRefresh()` (dialog_symbol_fields_table.cpp:1396). */
  PreviewRefresh(): void {
    const saveIncludeExcludedFromBOM = this.m_dataModel.GetIncludeExcludedFromBOM();

    this.m_dataModel.SetIncludeExcludedFromBOM(false);
    this.m_dataModel.RebuildRows();

    this.m_textOutput = this.m_dataModel.Export(this.GetCurrentBomFmtSettings());

    if (saveIncludeExcludedFromBOM) {
      this.m_dataModel.SetIncludeExcludedFromBOM(true);
      this.m_dataModel.RebuildRows();
    }
  }

  /** `GetCurrentBomFmtSettings()` (dialog_symbol_fields_table.cpp:1413). */
  GetCurrentBomFmtSettings(): BOM_FMT_PRESET {
    return {
      name: this.m_bomFmtPresetChoices[this.m_bomFmtPresetSelection] ?? '',
      fieldDelimiter: this.m_textFieldDelimiter,
      stringDelimiter: this.m_textStringDelimiter,
      refDelimiter: this.m_textRefDelimiter,
      refRangeDelimiter: this.m_textRefRangeDelimiter,
      keepTabs: this.m_checkKeepTabs,
      keepLineBreaks: this.m_checkKeepLineBreaks,
    };
  }

  /** `OnOutputFileBrowseClicked()` (dialog_symbol_fields_table.cpp:1441). */
  async OnOutputFileBrowseClicked(): Promise<void> {
    // Calculate the export filename
    const fn = this.m_parent.Prj().AbsolutePath(this.m_parent.Schematic().GetFileName());
    const fullName = fn.replace(/^.*\//, '').replace(/\.[^.]*$/, '.csv');
    let file = (await this.m_window.saveFileDialog?.(fullName)) ?? null;

    if (file === null) return;

    const defaultPath = fn.replace(/[^/]*$/, '');

    if (await IsOK(`Do you want to use a path relative to\n'${defaultPath}'?`)) {
      if (file.startsWith(defaultPath)) {
        file = file.slice(defaultPath.length);
      } else {
        DisplayErrorMessage(
          _('Cannot make path relative (target volume different from schematic file volume)!'),
        );
      }
    }

    this.m_outputFileName = file;
    this.notify();
  }

  /** `OnSidebarToggle()` (dialog_symbol_fields_table.cpp:1477). */
  OnSidebarToggle(): void {
    this.m_cfg.sidebar_collapsed = !this.m_cfg.sidebar_collapsed;
    this.notify();
  }

  /** `OnExport()` (dialog_symbol_fields_table.cpp:1498). */
  async OnExport(): Promise<void> {
    if (this.m_dataModel.IsEdited()) {
      if (
        (await OKOrCancelDialog(
          _('Unsaved data'),
          _('Changes have not yet been saved. Export unsaved data?'),
          '',
          _('OK'),
          _('Cancel'),
        )) === wxID_CANCEL
      ) {
        return;
      }
    }

    const schematic = this.m_parent.Schematic();
    let path = this.m_outputFileName;

    if (path === '') {
      DisplayErrorMessage(_('No output file specified in Export tab.'));
      return;
    }

    path = ExpandTextVars(path, (token) =>
      schematic.ResolveTextVar(schematic.CurrentSheet(), token, 0),
    );
    path = ExpandEnvVarSubstitutions(path, (token) => this.m_parent.Prj().TextVarResolver(token));

    // EnsureFileDirectoryExists( &outputFile, Prj().AbsolutePath( schematic file ) ): a relative
    // name is the schematic's folder's.
    if (!path.startsWith('/')) {
      const base = this.m_parent.Prj().AbsolutePath(schematic.GetFileName());
      path = base.replace(/[^/]*$/, '') + path;
    }

    this.PreviewRefresh();

    if (!this.m_window.writeFile(path, this.m_textOutput)) {
      DisplayErrorMessage(`Could not write BOM output '${path}'.`);
      return;
    }

    if (this.m_schSettings.m_BomExportFileName !== this.m_outputFileName) {
      this.m_schSettings.m_BomExportFileName = this.m_outputFileName;
      this.m_parent.OnModify();
    }

    void DisplayInfoMessage(`Wrote BOM output to '${path}'`);
    this.notify();
  }

  /** `OnCancel()` (dialog_symbol_fields_table.cpp:1577). */
  OnCancel(): void {
    // Discard any unsaved edit in the output filename field
    this.m_outputFileName = this.m_schSettings.m_BomExportFileName;
    void this.OnClose();
  }

  /** `OnOk()` (dialog_symbol_fields_table.cpp:1592). */
  OnOk(): void {
    this.TransferDataFromWindow();

    if (this.m_schSettings.m_BomExportFileName !== this.m_outputFileName) {
      this.m_schSettings.m_BomExportFileName = this.m_outputFileName;
      this.m_parent.OnModify();
    }

    void this.OnClose();
  }

  /** `OnClose( aEvent )` (dialog_symbol_fields_table.cpp:1659). */
  async OnClose(): Promise<void> {
    this.m_grid.CommitPendingChanges(true);

    if (this.m_dataModel.IsEdited()) {
      if (
        !(await this.m_window.handleUnsavedChanges(_('Save changes?'), () =>
          this.TransferDataFromWindow(),
        ))
      )
        return;
    }

    // Stop listening to schematic events
    this.m_parent.Schematic().RemoveListener(this);
    this.m_parent.ClearFocus();

    // wxQueueEvent( parent, EDA_EVT_CLOSE_DIALOG_SYMBOL_FIELDS_TABLE )
    this.m_parent.OnCloseSymbolFieldsTableDialog();
    this.Destroy();
  }

  // ----- BOM presets -----------------------------------------------------------------------------

  GetUserBomPresets(): BOM_PRESET[] {
    return [...this.m_bomPresets.values()].filter((p) => !p.readOnly);
  }

  /** `SetUserBomPresets( aPresetList )` (dialog_symbol_fields_table.cpp:1707). */
  SetUserBomPresets(aPresetList: readonly BOM_PRESET[]): void {
    // Reset to defaults
    this.loadDefaultBomPresets();

    for (const preset of aPresetList) {
      if (this.m_bomPresets.has(preset.name)) continue;

      this.m_bomPresets.set(preset.name, structuredClone(preset));
      this.m_bomPresetMRU.push(preset.name);
    }

    this.rebuildBomPresetsWidget();
  }

  /** `ApplyBomPreset( const BOM_PRESET& )` (dialog_symbol_fields_table.cpp:1735). */
  ApplyBomPresetByValue(aPreset: BOM_PRESET): void {
    this.m_currentBomPreset = this.m_bomPresets.get(aPreset.name) ?? null;
    this.m_lastSelectedBomPreset =
      this.m_currentBomPreset && !this.m_currentBomPreset.readOnly ? this.m_currentBomPreset : null;

    this.updateBomPresetSelection(aPreset.name);
    this.doApplyBomPreset(aPreset);
  }

  private loadDefaultBomPresets(): void {
    this.m_bomPresets.clear();
    this.m_bomPresetMRU = [];

    // Load the read-only defaults
    for (const preset of BOM_PRESET.BuiltInPresets()) {
      this.m_bomPresets.set(preset.name, { ...preset, readOnly: true });
      this.m_bomPresetMRU.push(preset.name);
    }
  }

  /** m_cbBomPresets' client data: the preset a row stands for (null for the three command rows). */
  private bomPresetAt(aIndex: number): BOM_PRESET | null {
    return this.m_bomPresets.get(this.m_bomPresetChoices[aIndex] ?? '') ?? null;
  }

  /** `rebuildBomPresetsWidget()` (dialog_symbol_fields_table.cpp:1768): sorted, as a std::map is. */
  private rebuildBomPresetsWidget(): void {
    const names = [...this.m_bomPresets.keys()].sort();
    const defaultIdx = Math.max(0, names.indexOf(BOM_PRESET.DefaultEditing().name));

    this.m_bomPresetChoices = [...names, '---', _('Save preset...'), _('Delete preset...')];
    this.m_bomPresetSelection = defaultIdx;
    this.m_currentBomPreset = this.bomPresetAt(defaultIdx);
  }

  /** `syncBomPresetSelection()` (dialog_symbol_fields_table.cpp:1797). */
  syncBomPresetSelection(): void {
    const current = this.m_dataModel.GetBomSettings();
    const shownOrGrouped = (aFields: BOM_PRESET['fieldsOrdered']) =>
      aFields.filter((f) => f.show || f.groupBy);

    const match = [...this.m_bomPresets.keys()].sort().find((name) => {
      const preset = this.m_bomPresets.get(name)!;

      // Check the simple settings first
      if (
        !(
          preset.sortAsc === current.sortAsc &&
          preset.filterString === current.filterString &&
          preset.groupSymbols === current.groupSymbols &&
          preset.excludeDNP === current.excludeDNP &&
          preset.includeExcludedFromBOM === current.includeExcludedFromBOM
        )
      ) {
        return false;
      }

      if (preset.sortField !== current.sortField) return false;

      // Only compare shown or grouped fields
      const A = shownOrGrouped(preset.fieldsOrdered);
      const B = shownOrGrouped(current.fieldsOrdered);

      return (
        A.length === B.length &&
        A.every(
          (f, i) =>
            f.name === B[i]!.name &&
            f.label === B[i]!.label &&
            f.show === B[i]!.show &&
            f.groupBy === B[i]!.groupBy,
        )
      );
    });

    this.m_bomPresetSelection =
      match !== undefined
        ? this.m_bomPresetChoices.indexOf(match)
        : this.m_bomPresetChoices.length - 3; // separator

    this.m_currentBomPreset = this.bomPresetAt(this.m_bomPresetSelection);
  }

  private updateBomPresetSelection(aName: string): void {
    const idx = this.m_bomPresetChoices.indexOf(aName);

    if (idx >= 0 && this.m_bomPresetSelection !== idx) {
      this.m_bomPresetSelection = idx;
      this.m_currentBomPreset = this.bomPresetAt(idx);
    } else if (idx < 0) {
      this.m_bomPresetSelection = this.m_bomPresetChoices.length - 3; // separator
    }
  }

  /** `onBomPresetChanged( aEvent )` (dialog_symbol_fields_table.cpp:1892). */
  async onBomPresetChanged(aIndex: number): Promise<void> {
    const count = this.m_bomPresetChoices.length;
    let index = aIndex;
    this.m_bomPresetSelection = index;

    const resetSelection = (): void => {
      this.m_bomPresetSelection = this.m_currentBomPreset
        ? this.m_bomPresetChoices.indexOf(this.m_currentBomPreset.name)
        : count - 3;
      this.notify();
    };

    if (index === count - 3) {
      // Separator: reject the selection
      resetSelection();
      return;
    } else if (index === count - 2) {
      // Save current state to new preset
      const name = await this.m_window.textEntry(
        _('BOM preset name:'),
        _('Save BOM Preset'),
        this.m_lastSelectedBomPreset?.name ?? '',
      );

      if (name === null) {
        resetSelection();
        return;
      }

      const exists = this.m_bomPresets.has(name);

      if (!exists)
        this.m_bomPresets.set(name, {
          ...this.m_dataModel.GetBomSettings(),
          readOnly: false,
          name,
        });

      const preset = this.m_bomPresets.get(name)!;

      if (!exists) {
        this.m_bomPresetChoices.splice(index - 1, 0, name);
        index -= 1;
      } else if (preset.readOnly) {
        DisplayErrorMessage(_('Default presets cannot be modified.\nPlease use a different name.'));
        resetSelection();
        return;
      } else {
        // Ask the user if they want to overwrite the existing preset
        if (!(await IsOK(_('Overwrite existing preset?')))) {
          resetSelection();
          return;
        }

        Object.assign(preset, this.m_dataModel.GetBomSettings(), { name });

        index = this.m_bomPresetChoices.indexOf(name);
        this.m_bomPresetMRU = this.m_bomPresetMRU.filter((n) => n !== name);
      }

      this.m_currentBomPreset = preset;
      this.m_bomPresetSelection = index;
      this.m_bomPresetMRU.unshift(name);
      this.notify();
      return;
    } else if (index === count - 1) {
      // Delete a preset
      const items = [...this.m_bomPresets.values()].filter((p) => !p.readOnly).map((p) => p.name);
      const presetName = await this.m_window.listDialog(
        _('Delete Preset'),
        _('Select preset:'),
        items,
      );

      if (presetName !== null) {
        const idx = this.m_bomPresetChoices.indexOf(presetName);

        if (idx >= 0) {
          this.m_bomPresets.delete(presetName);
          this.m_bomPresetChoices.splice(idx, 1);
          this.m_currentBomPreset = null;
        }

        this.m_bomPresetMRU = this.m_bomPresetMRU.filter((n) => n !== presetName);
      }

      resetSelection();
      return;
    }

    const preset = this.bomPresetAt(index);
    this.m_currentBomPreset = preset;
    this.m_lastSelectedBomPreset = !preset || preset.readOnly ? null : preset;

    if (preset) {
      this.doApplyBomPreset(preset);
      this.syncBomPresetSelection();
      this.m_currentBomPreset = preset;

      if (preset.name !== '') {
        this.m_bomPresetMRU = [
          preset.name,
          ...this.m_bomPresetMRU.filter((n) => n !== preset.name),
        ];
      }
    }

    this.notify();
  }

  /** `doApplyBomPreset( aPreset )` (dialog_symbol_fields_table.cpp:2039). */
  doApplyBomPreset(aPreset: BOM_PRESET): void {
    // Disable rebuilds while we're applying the preset otherwise we'll be
    // rebuilding the model constantly while firing off wx events
    this.m_dataModel.DisableRebuilds();

    // Basically, we apply the BOM preset to the data model and then
    // update our UI to reflect resulting the data model state, not the preset.
    this.m_dataModel.SetCurrentVariant(this.resolveVariant());
    this.m_dataModel.ApplyBomPreset(aPreset);

    // BOM Presets can add, but not remove, columns, so make sure the view controls
    // grid has all of them before starting
    for (let i = 0; i < this.m_dataModel.GetNumberCols(); i++) {
      const fieldName = this.m_dataModel.GetColFieldName(i);
      let found = false;

      for (let j = 0; j < this.m_viewControlsDataModel.GetNumberRows(); j++) {
        if (this.m_viewControlsDataModel.GetCanonicalFieldName(j) === fieldName) {
          found = true;
          break;
        }
      }

      // Properties like label, etc. will be added in the next loop
      if (!found) this.AddField(fieldName, GetGeneratedFieldDisplayName(fieldName), false, false);
    }

    // Sync all fields
    for (let i = 0; i < this.m_viewControlsDataModel.GetNumberRows(); i++) {
      const fieldName = this.m_viewControlsDataModel.GetCanonicalFieldName(i);
      const col = this.m_dataModel.GetFieldNameCol(fieldName);

      if (col === -1) continue;

      // Set column labels
      const label = this.m_dataModel.GetColLabelValue(col);
      this.m_viewControlsDataModel.SetValue(i, LABEL_COLUMN, label);
      this.m_grid.SetColLabelValue(col, label);

      const width = this.m_cfg.field_widths[fieldName];

      if (width !== undefined) this.m_grid.SetColSize(col, width);

      // Set shown columns
      const show = this.m_dataModel.GetShowColumn(col);
      this.m_viewControlsDataModel.SetValueAsBool(i, SHOW_FIELD_COLUMN, show);

      if (show) this.m_grid.ShowCol(col);
      else this.m_grid.HideCol(col);

      // Set grouped columns
      this.m_viewControlsDataModel.SetValueAsBool(
        i,
        GROUP_BY_COLUMN,
        this.m_dataModel.GetGroupColumn(col),
      );
    }

    this.m_grid.SetSortingColumn(this.m_dataModel.GetSortCol(), this.m_dataModel.GetSortAsc());
    this.m_groupSymbols = this.m_dataModel.GetGroupingEnabled();
    this.m_filter = this.m_dataModel.GetFilter();

    this.SetupAllColumnProperties();

    // This will rebuild all rows and columns in the model such that the order
    // and labels are right, then we refresh the shown grid data to match
    this.m_dataModel.EnableRebuilds();
    this.m_dataModel.RebuildRows();

    if (this.m_nbPage === 1) this.PreviewRefresh();
    else this.m_grid.ForceRefresh();
  }

  // ----- BOM format presets ----------------------------------------------------------------------

  GetUserBomFmtPresets(): BOM_FMT_PRESET[] {
    return [...this.m_bomFmtPresets.values()].filter((p) => !p.readOnly);
  }

  /** `SetUserBomFmtPresets( aPresetList )` (dialog_symbol_fields_table.cpp:2140). */
  SetUserBomFmtPresets(aPresetList: readonly BOM_FMT_PRESET[]): void {
    this.loadDefaultBomFmtPresets();

    for (const preset of aPresetList) {
      if (this.m_bomFmtPresets.has(preset.name)) continue;

      this.m_bomFmtPresets.set(preset.name, { ...preset });
      this.m_bomFmtPresetMRU.push(preset.name);
    }

    this.rebuildBomFmtPresetsWidget();
  }

  /** `ApplyBomFmtPreset( const BOM_FMT_PRESET& )` (dialog_symbol_fields_table.cpp:2168). */
  ApplyBomFmtPresetByValue(aPreset: BOM_FMT_PRESET): void {
    this.m_currentBomFmtPreset = this.m_bomFmtPresets.get(aPreset.name) ?? null;
    this.m_lastSelectedBomFmtPreset =
      this.m_currentBomFmtPreset && !this.m_currentBomFmtPreset.readOnly
        ? this.m_currentBomFmtPreset
        : null;

    this.updateBomFmtPresetSelection(aPreset.name);
    this.doApplyBomFmtPreset(aPreset);
  }

  private loadDefaultBomFmtPresets(): void {
    this.m_bomFmtPresets.clear();
    this.m_bomFmtPresetMRU = [];

    for (const preset of BOM_FMT_PRESET.BuiltInPresets()) {
      this.m_bomFmtPresets.set(preset.name, { ...preset, readOnly: true });
      this.m_bomFmtPresetMRU.push(preset.name);
    }
  }

  private bomFmtPresetAt(aIndex: number): BOM_FMT_PRESET | null {
    return this.m_bomFmtPresets.get(this.m_bomFmtPresetChoices[aIndex] ?? '') ?? null;
  }

  private rebuildBomFmtPresetsWidget(): void {
    const names = [...this.m_bomFmtPresets.keys()].sort();
    const defaultIdx = Math.max(0, names.indexOf(BOM_FMT_PRESET.CSV().name));

    this.m_bomFmtPresetChoices = [...names, '---', _('Save preset...'), _('Delete preset...')];
    this.m_bomFmtPresetSelection = defaultIdx;
    this.m_currentBomFmtPreset = this.bomFmtPresetAt(defaultIdx);
  }

  /** `syncBomFmtPresetSelection()` (dialog_symbol_fields_table.cpp:2229). */
  syncBomFmtPresetSelection(): void {
    const current = this.GetCurrentBomFmtSettings();

    const match = [...this.m_bomFmtPresets.keys()].sort().find((name) => {
      const p = this.m_bomFmtPresets.get(name)!;

      return (
        p.fieldDelimiter === current.fieldDelimiter &&
        p.stringDelimiter === current.stringDelimiter &&
        p.refDelimiter === current.refDelimiter &&
        p.refRangeDelimiter === current.refRangeDelimiter &&
        p.keepTabs === current.keepTabs &&
        p.keepLineBreaks === current.keepLineBreaks
      );
    });

    this.m_bomFmtPresetSelection =
      match !== undefined
        ? this.m_bomFmtPresetChoices.indexOf(match)
        : this.m_bomFmtPresetChoices.length - 3; // separator

    this.m_currentBomFmtPreset = this.bomFmtPresetAt(this.m_bomFmtPresetSelection);
  }

  private updateBomFmtPresetSelection(aName: string): void {
    const idx = this.m_bomFmtPresetChoices.indexOf(aName);

    if (idx >= 0 && this.m_bomFmtPresetSelection !== idx) {
      this.m_bomFmtPresetSelection = idx;
      this.m_currentBomFmtPreset = this.bomFmtPresetAt(idx);
    } else if (idx < 0) {
      this.m_bomFmtPresetSelection = this.m_bomFmtPresetChoices.length - 3; // separator
    }
  }

  /** `onBomFmtPresetChanged( aEvent )` (dialog_symbol_fields_table.cpp:2295). */
  async onBomFmtPresetChanged(aIndex: number): Promise<void> {
    const count = this.m_bomFmtPresetChoices.length;
    let index = aIndex;
    this.m_bomFmtPresetSelection = index;

    const resetSelection = (): void => {
      this.m_bomFmtPresetSelection = this.m_currentBomFmtPreset
        ? this.m_bomFmtPresetChoices.indexOf(this.m_currentBomFmtPreset.name)
        : count - 3;
      this.notify();
    };

    if (index === count - 3) {
      // Separator: reject the selection
      resetSelection();
      return;
    } else if (index === count - 2) {
      // Save current state to new preset
      const name = await this.m_window.textEntry(
        _('BOM preset name:'),
        _('Save BOM Preset'),
        this.m_lastSelectedBomFmtPreset?.name ?? '',
      );

      if (name === null) {
        resetSelection();
        return;
      }

      const exists = this.m_bomFmtPresets.has(name);

      if (!exists)
        this.m_bomFmtPresets.set(name, {
          ...this.GetCurrentBomFmtSettings(),
          readOnly: false,
          name,
        });

      const preset = this.m_bomFmtPresets.get(name)!;

      if (!exists) {
        this.m_bomFmtPresetChoices.splice(index - 1, 0, name);
        index -= 1;
      } else if (preset.readOnly) {
        DisplayErrorMessage(_('Default presets cannot be modified.\nPlease use a different name.'));
        resetSelection();
        return;
      } else {
        // Ask the user if they want to overwrite the existing preset
        if (!(await IsOK(_('Overwrite existing preset?')))) {
          resetSelection();
          return;
        }

        Object.assign(preset, this.GetCurrentBomFmtSettings(), { name });

        index = this.m_bomFmtPresetChoices.indexOf(name);
        this.m_bomFmtPresetMRU = this.m_bomFmtPresetMRU.filter((n) => n !== name);
      }

      this.m_currentBomFmtPreset = preset;
      this.m_bomFmtPresetSelection = index;
      this.m_bomFmtPresetMRU.unshift(name);
      this.notify();
      return;
    } else if (index === count - 1) {
      // Delete a preset
      const items = [...this.m_bomFmtPresets.values()]
        .filter((p) => !p.readOnly)
        .map((p) => p.name);
      const presetName = await this.m_window.listDialog(
        _('Delete Preset'),
        _('Select preset:'),
        items,
      );

      if (presetName !== null) {
        const idx = this.m_bomFmtPresetChoices.indexOf(presetName);

        if (idx >= 0) {
          this.m_bomFmtPresets.delete(presetName);
          this.m_bomFmtPresetChoices.splice(idx, 1);
          this.m_currentBomFmtPreset = null;
        }

        this.m_bomFmtPresetMRU = this.m_bomFmtPresetMRU.filter((n) => n !== presetName);
      }

      resetSelection();
      return;
    }

    const preset = this.bomFmtPresetAt(index);
    this.m_currentBomFmtPreset = preset;
    this.m_lastSelectedBomFmtPreset = !preset || preset.readOnly ? null : preset;

    if (preset) {
      this.doApplyBomFmtPreset(preset);
      this.syncBomFmtPresetSelection();
      this.m_currentBomFmtPreset = preset;

      if (preset.name !== '')
        this.m_bomFmtPresetMRU = [
          preset.name,
          ...this.m_bomFmtPresetMRU.filter((n) => n !== preset.name),
        ];
    }

    this.notify();
  }

  /** `doApplyBomFmtPreset( aPreset )` (dialog_symbol_fields_table.cpp:2442). */
  doApplyBomFmtPreset(aPreset: BOM_FMT_PRESET): void {
    this.m_textFieldDelimiter = aPreset.fieldDelimiter;
    this.m_textStringDelimiter = aPreset.stringDelimiter;
    this.m_textRefDelimiter = aPreset.refDelimiter;
    this.m_textRefRangeDelimiter = aPreset.refRangeDelimiter;
    this.m_checkKeepTabs = aPreset.keepTabs;
    this.m_checkKeepLineBreaks = aPreset.keepLineBreaks;

    // Refresh the preview if that's the current page
    if (this.m_nbPage === 1) this.PreviewRefresh();
  }

  /** `savePresetsToSchematic()` (dialog_symbol_fields_table.cpp:2457). */
  savePresetsToSchematic(): void {
    let modified = false;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

    const presets = this.GetUserBomPresets();

    if (!same(this.m_schSettings.m_BomPresets, presets)) {
      modified = true;
      this.m_schSettings.m_BomPresets = presets;
    }

    const bomSettings = this.m_dataModel.GetBomSettings();

    if (!same(this.m_schSettings.m_BomSettings, bomSettings)) {
      modified = true;
      this.m_schSettings.m_BomSettings = bomSettings;
    }

    const fmts = this.GetUserBomFmtPresets();

    if (!same(this.m_schSettings.m_BomFmtPresets, fmts)) {
      modified = true;
      this.m_schSettings.m_BomFmtPresets = fmts;
    }

    const fmtSettings = this.GetCurrentBomFmtSettings();

    if (!same(this.m_schSettings.m_BomFmtSettings, fmtSettings)) {
      modified = true;
      this.m_schSettings.m_BomFmtSettings = fmtSettings;
    }

    if (modified) this.m_parent.OnModify();
  }

  // ----- SCHEMATIC_LISTENER ----------------------------------------------------------------------

  /** Every field of the symbols again, in case one has a new one (the listener handlers' loop). */
  private addSymbolFields(aSymbols: Iterable<SCH_SYMBOL>): void {
    for (const symbol of aSymbols) {
      for (const field of symbol.GetFields())
        this.AddField(field.GetCanonicalName(), field.GetName(), true, false, true);
    }
  }

  /** `OnSchItemsAdded( aSch, aSchItem )` (dialog_symbol_fields_table.cpp:2508). */
  OnSchItemsAdded(_aSch: SCHEMATIC, aSchItem: SCH_ITEM[]): void {
    const savedSelection = this.SaveGridSelection();

    const allRefs = new SCH_REFERENCE_LIST();
    this.m_parent.Schematic().Hierarchy().GetSymbols(allRefs, SYMBOL_FILTER.SYMBOL_FILTER_ALL);

    for (const item of aSchItem) {
      if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
        const symbol = item as unknown as SCH_SYMBOL;

        // Don't add power symbols
        if (!symbol.IsMissingLibSymbol() && symbol.IsPower()) continue;

        this.addSymbolFields([symbol]);
        this.m_dataModel.AddReferences(this.getSymbolReferences(symbol, allRefs));
      } else if (item.Type() === KICAD_T.SCH_SHEET_T) {
        const refs = this.getSheetSymbolReferences(item as unknown as SCH_SHEET);

        this.addSymbolFields(new Set([...refs].map((r) => r.GetSymbol()!)));
        this.m_dataModel.AddReferences(refs);
      }
    }

    this.rebuildKeepingSelection(savedSelection);
  }

  /** `OnSchItemsRemoved( aSch, aSchItem )` (dialog_symbol_fields_table.cpp:2557). */
  OnSchItemsRemoved(_aSch: SCHEMATIC, aSchItem: SCH_ITEM[]): void {
    const savedSelection = this.SaveGridSelection();

    for (const item of aSchItem) {
      if (item.Type() === KICAD_T.SCH_SYMBOL_T)
        this.m_dataModel.RemoveSymbol(item as unknown as SCH_SYMBOL);
      else if (item.Type() === KICAD_T.SCH_SHEET_T)
        this.m_dataModel.RemoveReferences(
          this.getSheetSymbolReferences(item as unknown as SCH_SHEET),
        );
    }

    this.rebuildKeepingSelection(savedSelection);
  }

  /** `OnSchItemsChanged( aSch, aSchItem )` (dialog_symbol_fields_table.cpp:2576). */
  OnSchItemsChanged(_aSch: SCHEMATIC, aSchItem: SCH_ITEM[]): void {
    const savedSelection = this.SaveGridSelection();

    const allRefs = new SCH_REFERENCE_LIST();
    this.m_parent.Schematic().Hierarchy().GetSymbols(allRefs, SYMBOL_FILTER.SYMBOL_FILTER_ALL);

    for (const item of aSchItem) {
      if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
        const symbol = item as unknown as SCH_SYMBOL;

        // Don't add power symbols
        if (!symbol.IsMissingLibSymbol() && symbol.IsPower()) continue;

        this.addSymbolFields([symbol]);
        this.m_dataModel.UpdateReferences(this.getSymbolReferences(symbol, allRefs));
      } else if (item.Type() === KICAD_T.SCH_SHEET_T) {
        const refs = this.getSheetSymbolReferences(item as unknown as SCH_SHEET);

        this.addSymbolFields(new Set([...refs].map((r) => r.GetSymbol()!)));
        this.m_dataModel.UpdateReferences(refs);
      }
    }

    this.rebuildKeepingSelection(savedSelection);
  }

  /** `OnSchSheetChanged( aSch )` (dialog_symbol_fields_table.cpp:2625). */
  OnSchSheetChanged(aSch: SCHEMATIC): void {
    this.m_dataModel.SetPath(aSch.CurrentSheet());

    if (this.m_dataModel.GetScope() !== FIELDS_EDITOR_GRID_DATA_MODEL.SCOPE.SCOPE_ALL)
      this.rebuildKeepingSelection(this.SaveGridSelection());
  }

  /** The DisableSelectionEvents / RebuildRows / RestoreGridSelection / Enable sequence. */
  private rebuildKeepingSelection(aSaved: Set<string>): void {
    this.DisableSelectionEvents();
    this.m_dataModel.RebuildRows();
    this.RestoreGridSelection(aSaved);
    this.EnableSelectionEvents();
    this.notify();
  }

  private readonly onRangeSelected = (aEvent: wxGridRangeSelectEvent): void =>
    this.OnTableRangeSelected(aEvent);

  EnableSelectionEvents(): void {
    if (this.m_selectionEvents) return;

    this.m_selectionEvents = true;
    this.m_grid.Connect(wxEVT_GRID_RANGE_SELECTED, this.onRangeSelected);
  }

  DisableSelectionEvents(): void {
    this.m_selectionEvents = false;
    this.m_grid.Disconnect(wxEVT_GRID_RANGE_SELECTED, this.onRangeSelected);
  }

  /** `SaveGridSelection()` (dialog_symbol_fields_table.cpp:2667). */
  SaveGridSelection(): Set<string> {
    const selectedFullPaths = new Set<string>();
    const addRow = (aRow: number): void => {
      for (const ref of this.m_dataModel.GetRowReferences(aRow))
        selectedFullPaths.add(ref.GetFullPath());
    };

    const topLeft = this.m_grid.GetSelectionBlockTopLeft();
    const bottomRight = this.m_grid.GetSelectionBlockBottomRight();

    for (let i = 0; i < topLeft.length; ++i) {
      for (let row = topLeft[i]!.GetRow(); row <= bottomRight[i]!.GetRow(); ++row) addRow(row);
    }

    for (const row of this.m_grid.GetSelectedRows()) addRow(row);

    const cursorRow = this.m_grid.GetGridCursorRow();

    if (cursorRow >= 0 && selectedFullPaths.size === 0) addRow(cursorRow);

    return selectedFullPaths;
  }

  /** `RestoreGridSelection( aFullPaths )` (dialog_symbol_fields_table.cpp:2703). */
  RestoreGridSelection(aFullPaths: Set<string>): void {
    if (aFullPaths.size === 0) return;

    this.m_grid.ClearSelection();

    let firstSelection = true;

    for (let row = 0; row < this.m_dataModel.GetNumberRows(); ++row) {
      if (this.m_dataModel.GetRowReferences(row).some((ref) => aFullPaths.has(ref.GetFullPath()))) {
        this.m_grid.SelectRow(row, true);

        if (firstSelection) {
          this.m_grid.SetGridCursor(row, this.m_grid.GetGridCursorCol());
          firstSelection = false;
        }
      }
    }
  }

  /** `getSymbolReferences( aSymbol, aCachedRefs )` (dialog_symbol_fields_table.cpp:2735). */
  private getSymbolReferences(
    aSymbol: SCH_SYMBOL,
    aCachedRefs: SCH_REFERENCE_LIST,
  ): SCH_REFERENCE_LIST {
    const symbolRefs = new SCH_REFERENCE_LIST();

    for (let i = 0; i < aCachedRefs.GetCount(); i++) {
      const ref = aCachedRefs.GetItem(i);

      if (ref.GetSymbol() === aSymbol) {
        ref.Split(); // Figures out if we are annotated or not
        symbolRefs.AddItem(ref);
      }
    }

    return symbolRefs;
  }

  /** `getSheetSymbolReferences( aSheet )` (dialog_symbol_fields_table.cpp:2755). */
  private getSheetSymbolReferences(aSheet: SCH_SHEET): SCH_REFERENCE_LIST {
    const allSheets = this.m_parent.Schematic().Hierarchy();
    const sheetRefs = new SCH_REFERENCE_LIST();

    // We need to operate on all instances of the sheet
    for (const instance of aSheet.GetInstances()) {
      // For every sheet instance we need to get the current schematic sheet
      // instance that matches that particular sheet path from the root
      for (const basePath of allSheets) {
        if (basePath.Path().AsString() === instance.m_Path.AsString()) {
          const sheetPath = new SCH_SHEET_PATH(basePath);
          sheetPath.push_back(aSheet);

          // Create a list of all sheets in this path, starting with the path
          // of the sheet that we just deleted, then all of its subsheets
          const subSheets = new SCH_SHEET_LIST();
          subSheets.push(sheetPath);
          allSheets.GetSheetsWithinPath(subSheets, sheetPath);

          subSheets.GetSymbolsWithinPath(
            sheetRefs,
            sheetPath,
            SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER,
            false,
          );
          break;
        }
      }
    }

    for (const ref of sheetRefs) ref.Split();

    return sheetRefs;
  }

  /** `resolveVariant()` (dialog_symbol_fields_table.cpp:3132): the variants panel is greyed. */
  private resolveVariant(): string {
    return this.m_parent.Schematic().GetCurrentVariant();
  }

  /** The sashes, as the window reports them moved. */
  SetSashPosition(aPos: number): void {
    this.m_cfg.sash_pos = aPos;
  }

  SetVariantSashPosition(aPos: number): void {
    this.m_cfg.variant_sash_pos = aPos;
  }

  GetSettings(): FIELD_EDITOR_PANEL_SETTINGS {
    return this.m_cfg;
  }
}

function toMenuItems(aRows: readonly FieldsMenuRow[]): MenuItem[] {
  return aRows.map((r) =>
    r.sep
      ? { sep: true }
      : {
          label: r.label,
          ...(r.checked !== undefined ? { checked: r.checked } : {}),
          action: () => void r.action?.(),
        },
  );
}

/** The dialog's window: DIALOG_SYMBOL_FIELDS_TABLE_BASE over the class's state. */
export function DialogSymbolFieldsTable({
  dialog,
}: {
  dialog: DIALOG_SYMBOL_FIELDS_TABLE;
}): JSX.Element {
  const [, force] = useState(0);
  useEffect(() => dialog.subscribe(() => force((n) => n + 1)), [dialog]);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const d = dialog;
  const cfg = d.GetSettings();

  const presetChoice = (
    aChoices: readonly string[],
    aSelection: number,
    aOnChange: (aIndex: number) => void,
  ): PRESET_CHOICE => ({
    value: `${aSelection}`,
    options: aChoices.map((label, i) => ({ value: `${i}`, label })),
    onChange: (v) => aOnChange(Number(v)),
  });

  const entry = (aValue: string, aSet: (t: string) => void) => ({
    value: aValue,
    onChange: (t: string) => {
      aSet(t);
      d.notify();
    },
  });

  const check = (aValue: boolean, aSet: (v: boolean) => void) => ({
    value: aValue,
    onChange: (v: boolean) => {
      aSet(v);
      d.notify();
    },
  });

  return (
    <DIALOG_SYMBOL_FIELDS_TABLE_BASE
      dialogSize={DEFAULT_DLG_SIZE}
      sashPosition={cfg.sash_pos}
      onSashPosition={(p) => d.SetSashPosition(p)}
      sidebarCollapsed={cfg.sidebar_collapsed}
      variantSashPosition={cfg.variant_sash_pos}
      onVariantSashPosition={(p) => d.SetVariantSashPosition(p)}
      m_viewControlsGrid={
        <WxGridView
          grid={d.m_viewControlsGrid}
          tricks={d.m_viewControlsTricks}
          ariaLabel={_('Fields')}
          fixedColumns
          onSize={(aWidth) => d.OnSizeViewControlsGrid(aWidth)}
        />
      }
      onAddField={() => void d.OnAddField()}
      onRenameField={() => void d.OnRenameField()}
      onRemoveField={() => void d.OnRemoveField()}
      m_cbBomPresets={presetChoice(
        d.m_bomPresetChoices,
        d.m_bomPresetSelection,
        (i) => void d.onBomPresetChanged(i),
      )}
      page={d.m_nbPage}
      onPageChanged={(aPage) => {
        d.m_nbPage = aPage;
        d.OnPageChanged();
      }}
      m_filter={{ value: d.m_filter, onChange: (t) => d.OnFilterText(t) }}
      scopeChoices={[_('Entire Project'), _('Current Sheet Only'), _('Current Sheet and Down')]}
      m_scope={{ value: d.m_scope, onChange: (i) => d.OnScope(i) }}
      m_groupSymbolsBox={{ value: d.m_groupSymbols, onChange: (v) => d.OnGroupSymbolsToggled(v) }}
      onRegroupSymbols={() => d.OnRegroupSymbols()}
      onMenu={() => setMenu(toMenuItems(d.OnMenu()))}
      menu={menu && <ContextMenu x={0} y={0} items={menu} onClose={() => setMenu(null)} />}
      m_grid={<WxGridView grid={d.m_grid} tricks={d.m_gridTricks} ariaLabel="Symbol fields" />}
      m_textFieldDelimiter={entry(d.m_textFieldDelimiter, (t) => (d.m_textFieldDelimiter = t))}
      m_textStringDelimiter={entry(d.m_textStringDelimiter, (t) => (d.m_textStringDelimiter = t))}
      m_textRefDelimiter={entry(d.m_textRefDelimiter, (t) => (d.m_textRefDelimiter = t))}
      m_textRefRangeDelimiter={entry(
        d.m_textRefRangeDelimiter,
        (t) => (d.m_textRefRangeDelimiter = t),
      )}
      m_checkKeepTabs={check(d.m_checkKeepTabs, (v) => (d.m_checkKeepTabs = v))}
      m_checkKeepLineBreaks={check(d.m_checkKeepLineBreaks, (v) => (d.m_checkKeepLineBreaks = v))}
      m_cbBomFmtPresets={presetChoice(
        d.m_bomFmtPresetChoices,
        d.m_bomFmtPresetSelection,
        (i) => void d.onBomFmtPresetChanged(i),
      )}
      m_outputFileName={{ ...entry(d.m_outputFileName, (t) => (d.m_outputFileName = t)), hint: '' }}
      onBrowse={d.m_window.saveFileDialog ? () => void d.OnOutputFileBrowseClicked() : undefined}
      onRefreshPreview={() => d.OnPreviewRefresh()}
      m_textOutput={d.m_textOutput}
      onSidebarToggle={() => d.OnSidebarToggle()}
      status={d.m_status}
      onExport={() => void d.OnExport()}
      onApply={() => d.OnSaveAndContinue()}
      onOK={() => d.OnOk()}
      onCancel={() => d.OnCancel()}
    />
  );
}
