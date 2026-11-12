// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_LIB_FIELDS_TABLE` (eeschema/dialogs/dialog_lib_fields_table.{h,cpp}): the symbol editor's
 * Symbol Fields Table - every symbol of the target library (or the target symbol's root and its
 * derived symbols) as rows of a LIB_FIELDS_EDITOR_GRID_DATA_MODEL, the field columns chosen in the
 * view-controls grid, applied back through the library manager.
 *
 * Not here: OnColMove (the grid has no column positions to drag, as in the schematic table); the
 * remembered column widths are kept, the AutoSizeColumns pass before them is not.
 */
import { type JSX, useEffect, useState } from 'react';
import { GetGeneratedFieldDisplayName, IsGeneratedField } from '@ziroeda/common/common.js';
import { DisplayErrorMessage, IsOK } from '@ziroeda/common/confirm.js';
import { horizPixelsFromDU, vertPixelsFromDU } from '@ziroeda/common/dialog_shim.js';
import { GetAssociatedDocument } from '@ziroeda/common/eda_doc.js';
import {
  GRIDTRICKS_FIRST_CLIENT_ID,
  GRIDTRICKS_FIRST_SHOWHIDE,
  GRID_TRICKS,
} from '@ziroeda/common/grid_tricks.js';
import { ESCAPE_CONTEXT, EscapeString } from '@ziroeda/common/string_utils.js';
import {
  DO_TRANSLATE,
  FIELD_T,
  FieldNamesAreDuplicates,
  GetCanonicalFieldName,
  GetDefaultFieldName,
} from '@ziroeda/common/template_fieldnames.js';
import { GRID_CELL_CHECKBOX_RENDERER } from '@ziroeda/common/widgets/grid_checkbox.js';
import {
  GRID_CELL_FPID_EDITOR,
  GRID_CELL_URL_EDITOR,
  type GRID_TEXT_BUTTON_HOST,
} from '@ziroeda/common/widgets/grid_text_button_helpers.js';
import { GRID_CELL_TEXT_RENDERER } from '@ziroeda/common/widgets/grid_text_helpers.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { GetTextExtent } from '@ziroeda/wx/controls.js';
import { wxALIGN_CENTER } from '@ziroeda/wx/defs.js';
import {
  wxEVT_GRID_CELL_CHANGED,
  wxEVT_GRID_CELL_LEFT_CLICK,
  wxEVT_GRID_COL_SORT,
  wxGridCellAttr,
  wxGridCellBoolRenderer,
  type wxGridEvent,
  wxGridSelectionModes,
  wxGridTableRequest,
} from '@ziroeda/wx/grid.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import { type wxMenu, type wxMenuEvent, wxID_CANCEL, wxID_OK } from '@ziroeda/wx/menu.js';
import {
  DISPLAY_NAME_COLUMN,
  GROUP_BY_COLUMN,
  LABEL_COLUMN,
  SHOW_FIELD_COLUMN,
  VIEW_CONTROLS_GRID_DATA_MODEL,
} from '../fields_data_model.js';
import { LIB_FIELDS_EDITOR_GRID_DATA_MODEL } from '../lib_fields_data_model.js';
import type { LIB_SYMBOL } from '../lib_symbol.js';
import type { SCH_FIELD } from '../sch_field.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import {
  currentSymbolEditorSettings,
  type SymbolEditorSettings,
} from '../symbol_editor/symbol_editor_settings.js';
import { DIALOG_LIB_FIELDS_TABLE_BASE } from './dialog_lib_fields_table_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** `COLUMN_MARGIN` (not __WXMAC__). [data] */
const COLUMN_MARGIN = 15;

/** `SetSize( wxSize( horizPixelsFromDU( 600 ), vertPixelsFromDU( 300 ) ) )`. */
const DEFAULT_DLG_SIZE = { width: horizPixelsFromDU(600), height: vertPixelsFromDU(300) };

/** `SCOPE`. */
export enum SCOPE {
  SCOPE_LIBRARY = 0,
  SCOPE_RELATED_SYMBOLS,
}

/** What wx gives the dialog that a page has to be handed. */
export interface DIALOG_LIB_FIELDS_TABLE_WINDOW {
  /** `wxTextEntryDialog( this, aMessage, aCaption, aValue )`: null on Cancel. */
  textEntry(aMessage: string, aCaption: string, aValue: string): Promise<string | null>;
  /** `HandleUnsavedChanges( this, aMessage, aSaveFunction )`: false = the close is cancelled. */
  handleUnsavedChanges(aMessage: string, aSave: () => boolean): Promise<boolean>;
  /** `wxMessageBox( aMessage )`. */
  messageBox(aMessage: string): void;
  /**
   * `DIALOG_NEW_SYMBOL dlg( frame, symbolNames, parentName, validator )`: the new name on OK,
   * null on Cancel.
   */
  newSymbol(
    aSymbolNames: readonly string[],
    aParentName: string,
    aValidator: (aName: string) => boolean,
  ): Promise<string | null>;
  /** The footprint chooser and document opener the FPID / URL cell editors use. */
  host: GRID_TEXT_BUTTON_HOST;
}

/** `VIEW_CONTROLS_GRID_TRICKS`: a show/hide pick resizes the grid's columns. */
class VIEW_CONTROLS_GRID_TRICKS extends GRID_TRICKS {
  constructor(
    aGrid: WX_GRID,
    private readonly m_onSize: () => void,
  ) {
    super(aGrid);
  }

  protected override doPopupSelection(aEvent: wxMenuEvent): void {
    // m_grid->PostSizeEvent()
    if (aEvent.GetId() >= GRIDTRICKS_FIRST_SHOWHIDE) this.m_onSize();

    super.doPopupSelection(aEvent);
  }
}

export const MYID_SELECT_FOOTPRINT = GRIDTRICKS_FIRST_CLIENT_ID;
export const MYID_SHOW_DATASHEET = GRIDTRICKS_FIRST_CLIENT_ID + 1;
export const MYID_REVERT_ROW = GRIDTRICKS_FIRST_CLIENT_ID + 2;
export const MYID_CLEAR_CELL = GRIDTRICKS_FIRST_CLIENT_ID + 3;
export const MYID_CREATE_DERIVED_SYMBOL = GRIDTRICKS_FIRST_CLIENT_ID + 4;

/** `LIB_FIELDS_EDITOR_GRID_TRICKS`: revert, clear, derive, and the footprint / datasheet rows. */
export class LIB_FIELDS_EDITOR_GRID_TRICKS extends GRID_TRICKS {
  constructor(
    private readonly m_dlg: DIALOG_LIB_FIELDS_TABLE,
    aGrid: WX_GRID,
    private readonly m_viewControlsDataModel: VIEW_CONTROLS_GRID_DATA_MODEL,
    private readonly m_dataModel: LIB_FIELDS_EDITOR_GRID_DATA_MODEL,
  ) {
    super(aGrid);
  }

  /** The right-clicked cell, as `XToCol` / `YToRow` find it; the grid view sets the cursor. */
  protected override showPopupMenu(aMenu: wxMenu, aEvent: wxGridEvent): void {
    const revertMenu = aMenu.Append(
      MYID_REVERT_ROW,
      _('Revert symbol'),
      _('Revert the symbol to its last saved state'),
    );
    const clearMenu = aMenu.Append(MYID_CLEAR_CELL, _('Clear cell'), _('Clear the cell value'));
    aMenu.AppendSeparator();
    const deriveMenu = aMenu.Append(
      MYID_CREATE_DERIVED_SYMBOL,
      _('Create Derived Symbol'),
      _('Create a new symbol derived from the selected one'),
    );

    const row = aEvent.GetRow() >= 0 ? aEvent.GetRow() : this.m_grid.GetGridCursorRow();
    const col = aEvent.GetCol() >= 0 ? aEvent.GetCol() : this.m_grid.GetGridCursorCol();

    this.m_grid.SetGridCursor(row, col);

    revertMenu.Enable(this.m_dataModel.IsCellEdited(row, col));
    clearMenu.Enable(!this.m_dataModel.IsCellClear(row, col));
    deriveMenu.Enable(this.m_dataModel.IsRowSingleSymbol(row));

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
    void this.DoPopupSelection(aEvent.GetId());
  }

  /** `doPopupSelection()` by id; async where a dialog is asked. */
  async DoPopupSelection(aId: number): Promise<void> {
    let row = this.m_grid.GetGridCursorRow();
    let col = this.m_grid.GetGridCursorCol();

    if (aId === MYID_REVERT_ROW) {
      if (this.m_grid.CommitPendingChanges(false)) this.m_dataModel.RevertRow(row);

      if (this.m_dataModel.IsEdited()) this.m_dlg.OnModify();
      else this.m_dlg.ClearModify();

      this.m_grid.ForceRefresh();
    } else if (aId === MYID_CLEAR_CELL) {
      if (this.m_grid.CommitPendingChanges(false)) this.m_dataModel.ClearCell(row, col);

      if (this.m_dataModel.IsEdited()) this.m_dlg.OnModify();
      else this.m_dlg.ClearModify();

      this.m_grid.ForceRefresh();
    } else if (aId === MYID_CREATE_DERIVED_SYMBOL) {
      const parentSymbol = this.m_dataModel.GetSymbolForRow(row);

      if (!parentSymbol) return; // wxCHECK( frame )

      const symbolNames: string[] = [];
      this.m_dataModel.GetSymbolNames(symbolNames);

      const validator = (newName: string): boolean => !symbolNames.includes(newName);

      const derivedName = await this.m_dlg.m_window.newSymbol(
        symbolNames,
        parentSymbol.GetName(),
        validator,
      );

      if (derivedName === null) return;

      this.m_dataModel.CreateDerivedSymbolImmediate(row, col, derivedName);

      if (this.m_dataModel.IsEdited()) this.m_dlg.OnModify();

      this.m_grid.ForceRefresh();
    } else if (aId === MYID_SELECT_FOOTPRINT) {
      // pick a footprint using the footprint picker.
      const fpid = this.m_grid.GetCellValue(row, col);
      const picked = await this.m_dlg.m_window.host.ChooseFootprint(fpid, '');

      if (picked !== null) this.m_grid.SetCellValue(row, col, picked);
    } else if (aId === MYID_SHOW_DATASHEET) {
      const datasheet_uri = this.m_grid.GetCellValue(row, col);
      const prj = this.m_dlg.m_parent.Prj();
      GetAssociatedDocument(datasheet_uri, (aToken) => prj.TextVarResolver(aToken));
    } else if (aId >= GRIDTRICKS_FIRST_SHOWHIDE) {
      if (!this.m_grid.CommitPendingChanges(false)) return;

      // Pop-up column order is the order of the shown fields, not the viewControls order
      col = aId - GRIDTRICKS_FIRST_SHOWHIDE;

      const show = !this.m_dataModel.GetShowColumn(col);

      this.m_dlg.ShowHideColumn(col, show);

      const fieldName = this.m_dataModel.GetColFieldName(col);

      for (row = 0; row < this.m_viewControlsDataModel.GetNumberRows(); row++) {
        if (this.m_viewControlsDataModel.GetCanonicalFieldName(row) === fieldName)
          this.m_viewControlsDataModel.SetValueAsBool(row, SHOW_FIELD_COLUMN, show);
      }

      this.m_viewControlsDataModel.GetView()?.ForceRefresh();
    } else {
      super.doPopupSelection({ GetId: () => aId } as wxMenuEvent);
    }

    this.m_dlg.notify();
  }
}

export class DIALOG_LIB_FIELDS_TABLE {
  readonly m_parent: SYMBOL_EDIT_FRAME;
  readonly m_window: DIALOG_LIB_FIELDS_TABLE_WINDOW;
  m_scope: SCOPE;

  // The window's controls, as state:
  m_title = '';
  m_filter = '';
  /** m_choiceScope's selection. */
  m_choiceScope = 0;
  /** m_groupSymbolsBox: SetValue( true ) in the base. */
  m_groupSymbolsBox = true;
  /** DIALOG_SHIM's modified flag (OnModify / ClearModify). */
  m_modified = false;

  readonly m_viewControlsGrid = new WX_GRID();
  readonly m_grid = new WX_GRID();
  readonly m_viewControlsDataModel: VIEW_CONTROLS_GRID_DATA_MODEL;
  readonly m_dataModel: LIB_FIELDS_EDITOR_GRID_DATA_MODEL;
  readonly m_viewControlsTricks: VIEW_CONTROLS_GRID_TRICKS;
  readonly m_gridTricks: LIB_FIELDS_EDITOR_GRID_TRICKS;
  /** The view-controls grid window's width, for OnSizeViewControlsGrid. */
  private m_viewControlsWidth = 0;
  private m_symbolsList: LIB_SYMBOL[] = [];
  private readonly m_listeners = new Set<() => void>();

  constructor(aParent: SYMBOL_EDIT_FRAME, aScope: SCOPE, aWindow: DIALOG_LIB_FIELDS_TABLE_WINDOW) {
    this.m_parent = aParent;
    this.m_scope = aScope;
    this.m_window = aWindow;

    this.m_viewControlsDataModel = new VIEW_CONTROLS_GRID_DATA_MODEL(false);
    this.m_viewControlsGrid.SetTable(
      this.m_viewControlsDataModel,
      true,
      wxGridSelectionModes.wxGridSelectCells,
    );

    // add Cut, Copy, and Paste to wxGrid
    this.m_viewControlsTricks = new VIEW_CONTROLS_GRID_TRICKS(this.m_viewControlsGrid, () =>
      this.OnSizeViewControlsGrid(this.m_viewControlsWidth),
    );

    let attr = new wxGridCellAttr();
    attr.SetReadOnly(true);
    this.m_viewControlsDataModel.SetColAttr(attr, DISPLAY_NAME_COLUMN);

    for (const col of [SHOW_FIELD_COLUMN, GROUP_BY_COLUMN]) {
      attr = new wxGridCellAttr();
      attr.SetRenderer(new wxGridCellBoolRenderer());
      attr.SetReadOnly(); // not really; we delegate interactivity to GRID_TRICKS
      attr.SetAlignment(wxALIGN_CENTER, wxALIGN_CENTER);
      this.m_viewControlsDataModel.SetColAttr(attr, col);
    }

    this.m_dataModel = new LIB_FIELDS_EDITOR_GRID_DATA_MODEL();
    this.m_grid.SetTable(this.m_dataModel, true, wxGridSelectionModes.wxGridSelectCells);

    // add Cut, Copy, and Paste to wxGrid
    this.m_gridTricks = new LIB_FIELDS_EDITOR_GRID_TRICKS(
      this,
      this.m_grid,
      this.m_viewControlsDataModel,
      this.m_dataModel,
    );

    this.m_grid.ClearSelection();

    this.m_viewControlsGrid.ShowHideColumns('0 2 3');

    // Connect Events
    this.m_grid.Connect(wxEVT_GRID_COL_SORT, (e: wxGridEvent) => this.OnColSort(e));
    this.m_grid.Connect(wxEVT_GRID_CELL_LEFT_CLICK, (e: wxGridEvent) => this.OnTableCellClick(e));
    this.m_grid.Connect(wxEVT_GRID_CELL_CHANGED, () => this.OnTableValueChanged());
    this.m_viewControlsGrid.Connect(wxEVT_GRID_CELL_CHANGED, (e: wxGridEvent) =>
      this.OnViewControlsCellChanged(e),
    );
  }

  subscribe(aListener: () => void): () => void {
    this.m_listeners.add(aListener);
    return () => this.m_listeners.delete(aListener);
  }

  notify(): void {
    for (const l of this.m_listeners) l();
  }

  /** `DIALOG_SHIM::OnModify()`. */
  OnModify(): void {
    this.m_modified = true;
  }

  /** `DIALOG_SHIM::ClearModify()`. */
  ClearModify(): void {
    this.m_modified = false;
  }

  /** `m_parent->libeditconfig()->m_LibFieldEditor`. */
  Settings(): SymbolEditorSettings['lib_field_editor'] {
    return (this.m_parent.GetSettings() ?? currentSymbolEditorSettings()).lib_field_editor;
  }

  /** `~DIALOG_LIB_FIELDS_TABLE()`: the sash and the shown columns' widths remembered. */
  Destroy(aSashPosition: number): void {
    const cfg = this.Settings();

    if (!cfg.sidebar_collapsed) cfg.sash_pos = aSashPosition;

    for (let i = 0; i < this.m_grid.GetNumberCols(); i++) {
      if (this.m_grid.IsColShown(i))
        cfg.field_widths[this.m_dataModel.GetColFieldName(i)] = this.m_grid.GetColSize(i);
    }
  }

  /** `SetupColumnProperties( aCol )`: the cell editor and renderer a column's field wants. */
  SetupColumnProperties(aCol: number): void {
    const attr = new wxGridCellAttr();
    attr.SetReadOnly(false);

    // Set some column types to specific editors
    if (this.m_dataModel.GetColFieldName(aCol) === GetCanonicalFieldName(FIELD_T.FOOTPRINT)) {
      // Create symbol netlist for footprint picker
      let symbolNetlist = '';

      if (this.m_symbolsList.length > 0) {
        // Use the first symbol's netlist (all symbols in lib should have similar pin structure)
        const symbol = this.m_symbolsList[0]!;
        const pins: string[] = [];

        for (const pin of symbol.GetGraphicalPins(0 /* all units */, 1 /* single bodyStyle */))
          pins.push(`${pin.GetNumber()} ${pin.GetShownName()}`);

        if (pins.length > 0)
          symbolNetlist += EscapeString(pins.join('\t'), ESCAPE_CONTEXT.CTX_LINE);

        symbolNetlist += '\r';

        const fpFilters = symbol.GetFPFilters();

        if (fpFilters.length > 0)
          symbolNetlist += EscapeString(fpFilters.join(' '), ESCAPE_CONTEXT.CTX_LINE);

        symbolNetlist += '\r';
      }

      attr.SetEditor(new GRID_CELL_FPID_EDITOR(this.m_window.host, symbolNetlist));
    } else if (
      this.m_dataModel.GetColFieldName(aCol) === GetCanonicalFieldName(FIELD_T.DATASHEET)
    ) {
      // set datasheet column viewer button
      attr.SetEditor(new GRID_CELL_URL_EDITOR(this.m_window.host));
    } else if (this.m_dataModel.ColIsCheck(aCol)) {
      attr.SetAlignment(wxALIGN_CENTER, wxALIGN_CENTER);
      attr.SetRenderer(new GRID_CELL_CHECKBOX_RENDERER());
    } else if (IsGeneratedField(this.m_dataModel.GetColFieldName(aCol))) {
      attr.SetReadOnly();
    } else {
      attr.SetRenderer(new GRID_CELL_TEXT_RENDERER());
    }

    this.m_dataModel.SetColAttr(attr, aCol);
  }

  /** `SetupAllColumnProperties()`: editors, shown columns and widths, and the sort. */
  SetupAllColumnProperties(): void {
    const cfg = this.Settings();

    let sortCol = 0;
    let sortAscending = true;

    // Find the symbol name column for initial sorting
    const nameCol = this.m_dataModel.GetFieldNameCol(LIB_FIELDS_EDITOR_GRID_DATA_MODEL.SYMBOL_NAME);

    // Set initial sort to VALUE field (ascending) if no previous sort preference exists
    if (this.m_dataModel.GetSortCol() === 0 && nameCol !== -1) {
      sortCol = nameCol;
      sortAscending = true;
      this.m_dataModel.SetSorting(sortCol, sortAscending);
    }

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

        const saved = cfg.field_widths[this.m_dataModel.GetColFieldName(col)];

        if (saved !== undefined && saved > 0) {
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

  /** `TransferDataToWindow()`. */
  TransferDataToWindow(): boolean {
    this.m_dataModel.SetGroupingEnabled(this.m_groupSymbolsBox);

    this.m_choiceScope = this.m_scope === SCOPE.SCOPE_LIBRARY ? 0 : 1;

    this.setScope(this.m_scope);

    return true;
  }

  /** `loadSymbols( aSymbolNames )`: the canvas's own symbol where it is one of them. */
  private loadSymbols(aSymbolNames: readonly string[]): void {
    // Clear any existing data
    this.m_symbolsList = [];

    const libName = this.m_parent.GetTreeLIBID().GetLibNickname();

    if (aSymbolNames.length === 0) {
      if (this.m_scope === SCOPE.SCOPE_RELATED_SYMBOLS)
        this.m_window.messageBox(wxFormat(_("No related symbols found in library '%s'."), libName));
      else this.m_window.messageBox(wxFormat(_("No symbols found in library '%s'."), libName));

      return;
    }

    // Load each symbol from the library manager and add it to our list
    for (const symbolName of aSymbolNames) {
      const canvasSymbol = this.m_parent.GetCurSymbol();

      if (
        canvasSymbol &&
        canvasSymbol.GetLibraryName() === libName &&
        canvasSymbol.GetName() === symbolName
      ) {
        this.m_symbolsList.push(canvasSymbol);
      } else {
        const symbol = this.m_parent.GetLibManager().GetSymbol(symbolName, libName);

        if (symbol) this.m_symbolsList.push(symbol);
      }
    }

    if (this.m_symbolsList.length === 0) {
      if (this.m_scope === SCOPE.SCOPE_RELATED_SYMBOLS)
        this.m_window.messageBox(_('No related symbols could be loaded from the library.'));
      else this.m_window.messageBox(_('No symbols could be loaded from the library.'));
    }

    this.m_dataModel.SetSymbols(this.m_symbolsList);
  }

  /** `TransferDataFromWindow()`: ApplyData through the library manager, then the tree. */
  TransferDataFromWindow(): boolean {
    if (!this.m_grid.CommitPendingChanges()) return false;

    let updateCanvas = false;

    this.m_dataModel.ApplyData(
      (symbol) => {
        this.m_parent.GetLibManager().UpdateSymbol(symbol, symbol.GetLibNickname());

        if (this.m_parent.GetCurSymbol() === symbol) updateCanvas = true;
      },
      () => {
        // Handle newly created derived symbols
        const createdSymbols = this.m_dataModel.GetAndClearCreatedDerivedSymbols();

        for (const [symbol, libraryName] of createdSymbols) {
          // Update the symbol in the library manager to properly register it
          if (libraryName !== '') this.m_parent.GetLibManager().UpdateSymbol(symbol, libraryName);
        }

        // Sync libraries and refresh tree if there were changes
        if (createdSymbols.length > 0) {
          // Synchronize libraries to update the tree view
          this.m_parent.SyncLibraries(false);

          // Ensure created symbols are still in the symbol list after sync
          for (const [symbol] of createdSymbols) {
            if (!this.m_symbolsList.some((s) => s.m_Uuid === symbol.m_Uuid))
              this.m_symbolsList.push(symbol);
          }
        }
      },
    );

    this.ClearModify();
    this.RegroupSymbols();

    this.m_parent.RefreshLibraryTree();

    if (updateCanvas) {
      this.m_parent.OnModify();
      this.m_parent.HardRedraw();
    }

    return true;
  }

  /** `OnAddField()`: a user column, named in a text entry. */
  async OnAddField(): Promise<void> {
    const fieldName = await this.m_window.textEntry(_('New field name:'), _('Add Field'), '');

    if (fieldName === null) return;

    if (fieldName === '') {
      DisplayErrorMessage(_('Field must have a name.'));
      return;
    }

    for (let i = 0; i < this.m_dataModel.GetNumberCols(); ++i) {
      if (FieldNamesAreDuplicates(fieldName, this.m_dataModel.GetColFieldName(i))) {
        DisplayErrorMessage(wxFormat(_("Field name '%s' already in use."), fieldName));
        return;
      }
    }

    this.AddField(fieldName, GetGeneratedFieldDisplayName(fieldName), true, false, true);
    this.SetupColumnProperties(this.m_dataModel.GetNumberCols() - 1);
    this.OnModify();
    this.notify();
  }

  /**
   * `OnRemoveField()`: each selected row asked about, then removed. (Upstream asks inside
   * OnDeleteRows' filter; the question is a modal here, so it is asked first.)
   */
  async OnRemoveField(): Promise<void> {
    const rows = this.m_viewControlsGrid.GetSelectedRows();

    if (rows.length === 0 && this.m_viewControlsGrid.GetGridCursorRow() >= 0)
      rows.push(this.m_viewControlsGrid.GetGridCursorRow());

    for (const row of rows) {
      const confirmed = await IsOK(
        wxFormat(
          _("Are you sure you want to remove the field '%s'?"),
          this.m_viewControlsDataModel.GetValue(row, DISPLAY_NAME_COLUMN),
        ),
      );

      if (!confirmed) return;
    }

    this.m_viewControlsGrid.OnDeleteRows((row) => {
      const fieldName = this.m_viewControlsDataModel.GetCanonicalFieldName(row);
      this.RemoveField(fieldName);
      this.m_viewControlsDataModel.DeleteRow(row);
      this.OnModify();
    });

    this.notify();
  }

  /** `OnRenameField()`: the selected row's field, renamed in a text entry. */
  async OnRenameField(): Promise<void> {
    const selectedRows = this.m_viewControlsGrid.GetSelectedRows();

    if (selectedRows.length === 0 && this.m_viewControlsGrid.GetGridCursorRow() >= 0)
      selectedRows.push(this.m_viewControlsGrid.GetGridCursorRow());

    if (selectedRows.length === 0) return;

    const row = selectedRows[0]!;
    const fieldName = this.m_viewControlsDataModel.GetCanonicalFieldName(row);
    const col = this.m_dataModel.GetFieldNameCol(fieldName);

    if (col === -1) return; // wxCHECK_RET "Existing field name missing from data model"

    const newFieldName = await this.m_window.textEntry(
      _('New field name:'),
      _('Rename Field'),
      fieldName,
    );

    if (newFieldName === null) return;

    if (newFieldName === fieldName) return;

    if (this.m_dataModel.GetFieldNameCol(newFieldName) !== -1) {
      DisplayErrorMessage(wxFormat(_("Field name '%s' already exists."), newFieldName));
      return;
    }

    this.RenameField(fieldName, newFieldName);

    this.m_viewControlsDataModel.SetCanonicalFieldName(row, newFieldName);
    this.m_viewControlsDataModel.SetValue(row, DISPLAY_NAME_COLUMN, newFieldName);
    this.m_viewControlsDataModel.SetValue(
      row,
      LABEL_COLUMN,
      GetGeneratedFieldDisplayName(newFieldName),
    );

    this.SetupColumnProperties(col);
    this.OnModify();
    this.notify();
  }

  /** `OnFilterText()`. */
  OnFilterText(aText: string): void {
    this.m_filter = aText;
    this.m_dataModel.SetFilter(aText);
    this.RegroupSymbols();
    this.notify();
  }

  /** `setScope( aScope )`: the target library's symbols, or the target symbol's family. */
  private setScope(aScope: SCOPE): void {
    const libMgr = this.m_parent.GetLibManager();
    const targetLib = this.m_parent.GetTargetLibId().GetLibNickname();
    const targetSymbol = this.m_parent.GetTargetLibId().GetLibItemName();
    const symbolNames: string[] = [];

    this.m_title = wxFormat(_("Symbol Fields Table ('%s' Library)"), targetLib);

    this.m_scope = aScope;

    if (this.m_scope === SCOPE.SCOPE_RELATED_SYMBOLS) {
      const symbol = libMgr.GetBufferedSymbol(targetSymbol, targetLib);
      const root = symbol ? symbol.GetRootSymbol() : null;

      if (root) {
        symbolNames.push(root.GetName());

        // Now we have the root symbol, collect all its derived symbols
        libMgr.GetDerivedSymbolNames(root.GetName(), targetLib, symbolNames);
      }
    } else {
      // Get all symbol names from the library manager
      libMgr.GetSymbolNames(targetLib, symbolNames);
    }

    // Get all symbols from the library
    this.loadSymbols(symbolNames);

    // Update the field list and refresh the grid
    this.UpdateFieldList();
    this.SetupAllColumnProperties();
    this.RegroupSymbols();
  }

  /** `OnScope()`. */
  OnScope(aSelection: number): void {
    this.m_choiceScope = aSelection;

    switch (aSelection) {
      case 0:
        this.setScope(SCOPE.SCOPE_LIBRARY);
        break;
      case 1:
        this.setScope(SCOPE.SCOPE_RELATED_SYMBOLS);
        break;
    }

    this.notify();
  }

  /** `OnRegroupSymbols()`. */
  OnRegroupSymbols(): void {
    this.RegroupSymbols();
    this.notify();
  }

  /** `OnTableValueChanged()`. */
  OnTableValueChanged(): void {
    this.m_grid.ForceRefresh();
    this.OnModify();
    this.notify();
  }

  /** `OnTableCellClick()`: a click in the expander column opens or closes a group. */
  OnTableCellClick(aEvent: wxGridEvent): void {
    if (this.m_dataModel.IsExpanderColumn(aEvent.GetCol())) {
      this.m_grid.ClearSelection();
      this.m_dataModel.ExpandCollapseRow(aEvent.GetRow());
      this.m_grid.SetGridCursor(aEvent.GetRow(), aEvent.GetCol());
      // Don't call event.Skip() - we've handled this event
      this.notify();
    } else {
      aEvent.Skip(); // Let normal cell editing proceed
    }
  }

  /** `OnGroupSymbolsToggled()`. */
  OnGroupSymbolsToggled(aValue: boolean): void {
    this.m_groupSymbolsBox = aValue;
    this.m_dataModel.SetGroupingEnabled(aValue);
    this.m_dataModel.RebuildRows();
    this.m_grid.ForceRefresh();
    this.notify();
  }

  /**
   * `OnSizeViewControlsGrid()`: Include and Group By as wide as their labels, Field and BOM Name
   * sharing what is left.
   */
  OnSizeViewControlsGrid(aWidth: number): void {
    this.m_viewControlsWidth = aWidth;

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

  /** `OnSidebarToggle()`: the left panel unsplit or split back at the remembered sash. */
  OnSidebarToggle(aSashPosition: number): void {
    const cfg = this.Settings();

    if (cfg.sidebar_collapsed) {
      cfg.sidebar_collapsed = false;
    } else {
      cfg.sash_pos = aSashPosition;
      cfg.sidebar_collapsed = true;
    }

    this.notify();
  }

  /** `OnApply()`. */
  OnApply(): void {
    this.TransferDataFromWindow();
    this.notify();
  }

  /** `OnCancel()` / `OnClose()`: unsaved edits are asked about. @return the return code, or null to stay. */
  async OnCancel(): Promise<number | null> {
    this.m_grid.CommitPendingChanges(true);

    if (this.m_dataModel.IsEdited()) {
      if (
        !(await this.m_window.handleUnsavedChanges(_('Save changes?'), () =>
          this.TransferDataFromWindow(),
        ))
      )
        return null;
    }

    return wxID_CANCEL;
  }

  /** `OnOk()`. */
  OnOk(): number | null {
    return this.TransferDataFromWindow() ? wxID_OK : null;
  }

  /** `UpdateFieldList()`: the name, the mandatory fields, Keywords, the attributes, then user fields. */
  UpdateFieldList(): void {
    const addMandatoryField = (fieldId: FIELD_T, show: boolean, groupBy: boolean): void =>
      this.AddField(
        GetCanonicalFieldName(fieldId),
        GetDefaultFieldName(fieldId, DO_TRANSLATE),
        show,
        groupBy,
      );

    this.AddField(LIB_FIELDS_EDITOR_GRID_DATA_MODEL.SYMBOL_NAME, _('Symbol Name'), true, false);

    // Add mandatory fields first      show   groupBy
    addMandatoryField(FIELD_T.REFERENCE, false, false);
    addMandatoryField(FIELD_T.VALUE, true, false);
    addMandatoryField(FIELD_T.FOOTPRINT, true, false);
    addMandatoryField(FIELD_T.DATASHEET, true, false);
    addMandatoryField(FIELD_T.DESCRIPTION, false, false);

    this.AddField('Keywords', 'Keywords', true, false);

    // Add attribute fields as checkboxes                           show  groupBy user  checkbox
    this.AddField('${EXCLUDE_FROM_BOM}', _('Exclude From BOM'), true, false, false, true);
    this.AddField('${EXCLUDE_FROM_SIM}', _('Exclude From Simulation'), true, false, false, true);
    this.AddField('${EXCLUDE_FROM_BOARD}', _('Exclude From Board'), true, false, false, true);
    this.AddField('Power', _('Power Symbol'), true, false, false, true);
    this.AddField('LocalPower', _('Local Power Symbol'), true, false, false, true);

    // User field names are stored and matched case-sensitively (see issue #24021), so each
    // distinct name gets its own column rather than collapsing case variants together.
    const userFieldNames = new Set<string>();

    for (const symbol of this.m_symbolsList) {
      const fields: SCH_FIELD[] = [];
      symbol.GetFields(fields);

      for (const field of fields) {
        if (!field.IsMandatory() && !field.IsPrivate()) userFieldNames.add(field.GetName());
      }
    }

    // std::set iterates in key order
    for (const fieldName of [...userFieldNames].sort())
      this.AddField(fieldName, GetGeneratedFieldDisplayName(fieldName), true, false);
  }

  /** `AddField( aFieldName, aLabelValue, show, groupBy, addedByUser, aIsCheckbox )`. */
  AddField(
    aFieldName: string,
    aLabelValue: string,
    show: boolean,
    groupBy: boolean,
    addedByUser = false,
    aIsCheckbox = false,
  ): void {
    // Users can add fields with variable names that match the special names in the grid,
    // e.g. ${QUANTITY} so make sure we don't add them twice
    for (let row = 0; row < this.m_viewControlsDataModel.GetNumberRows(); row++) {
      if (
        FieldNamesAreDuplicates(this.m_viewControlsDataModel.GetCanonicalFieldName(row), aFieldName)
      )
        return;
    }

    this.m_dataModel.AddColumn(aFieldName, aLabelValue, addedByUser, aIsCheckbox);

    this.m_grid.ProcessTableMessage(wxGridTableRequest.wxGRIDTABLE_NOTIFY_COLS_APPENDED, 1, 0);

    this.m_viewControlsGrid.OnAddRow(() => {
      this.m_viewControlsDataModel.AppendRow(aFieldName, aLabelValue, show, groupBy);
      return [this.m_viewControlsDataModel.GetNumberRows() - 1, -1];
    });
  }

  /** `RemoveField( fieldName )`. */
  RemoveField(fieldName: string): void {
    const col = this.m_dataModel.GetFieldNameCol(fieldName);

    if (col === -1) return; // wxCHECK_RET "Field name not found"

    this.m_dataModel.RemoveColumn(col);
  }

  /** `RenameField( oldName, newName )`. */
  RenameField(oldName: string, newName: string): void {
    const col = this.m_dataModel.GetFieldNameCol(oldName);

    if (col === -1) return; // wxCHECK_RET "Existing field name missing from data model"

    this.m_dataModel.RenameColumn(col, newName);
  }

  /** `RegroupSymbols()`. */
  RegroupSymbols(): void {
    this.m_dataModel.RebuildRows();
    this.m_grid.ForceRefresh();
  }

  /** `OnColSort()`: the same column inverts, another starts ascending. */
  OnColSort(aEvent: wxGridEvent): void {
    const sortCol = aEvent.GetCol();

    // This is bonkers, but wxWidgets doesn't tell us ascending/descending in the event, and
    // if we ask it will give us pre-event info.
    const ascending = this.m_grid.IsSortingBy(sortCol)
      ? // same column; invert ascending
        !this.m_grid.IsSortOrderAscending()
      : // different column; start with ascending
        true;

    this.m_dataModel.SetSorting(sortCol, ascending);
    this.RegroupSymbols();
    this.notify();
  }

  /** `ShowHideColumn( aCol, aShow )`. */
  ShowHideColumn(aCol: number, aShow: boolean): void {
    if (aShow) this.m_grid.ShowCol(aCol);
    else this.m_grid.HideCol(aCol);

    this.m_dataModel.SetShowColumn(aCol, aShow);
    this.m_grid.ForceRefresh();
    this.OnModify();
  }

  /** `OnViewControlsCellChanged()`: a field's label, its Include box, or its Group By box. */
  OnViewControlsCellChanged(aEvent: wxGridEvent): void {
    const row = aEvent.GetRow();

    if (row >= this.m_viewControlsGrid.GetNumberRows()) return; // wxCHECK

    const fieldName = this.m_viewControlsDataModel.GetCanonicalFieldName(row);
    const dataCol = this.m_dataModel.GetFieldNameCol(fieldName);

    switch (aEvent.GetCol()) {
      case DISPLAY_NAME_COLUMN: {
        const label = this.m_viewControlsDataModel.GetValue(row, DISPLAY_NAME_COLUMN);

        if (dataCol !== -1) {
          this.m_dataModel.SetColLabelValue(dataCol, label);
          this.m_grid.SetColLabelValue(dataCol, label);
          this.m_grid.ForceRefresh();
          this.OnModify();
        }

        break;
      }

      case SHOW_FIELD_COLUMN: {
        const value = this.m_viewControlsDataModel.GetValueAsBool(row, SHOW_FIELD_COLUMN);

        if (dataCol !== -1) this.ShowHideColumn(dataCol, value);

        break;
      }

      case GROUP_BY_COLUMN: {
        const value = this.m_viewControlsDataModel.GetValueAsBool(row, GROUP_BY_COLUMN);

        this.m_dataModel.SetGroupColumn(dataCol, value);
        this.m_dataModel.RebuildRows();
        this.m_grid.ForceRefresh();
        this.OnModify();
        break;
      }

      default:
        break;
    }

    this.notify();
  }
}

/** DIALOG_LIB_FIELDS_TABLE's window over its base; onClose carries the return code. */
export function DialogLibFieldsTable({
  dialog,
  onClose,
}: {
  dialog: DIALOG_LIB_FIELDS_TABLE;
  onClose: (aRetval: number) => void;
}): JSX.Element {
  const [, force] = useState(0);
  useEffect(() => dialog.subscribe(() => force((n) => n + 1)), [dialog]);
  const [sash, setSash] = useState(() => dialog.Settings().sash_pos);
  const d = dialog;
  const cfg = d.Settings();

  const close = (aRetval: number): void => {
    d.Destroy(sash);
    onClose(aRetval);
  };

  return (
    <DIALOG_LIB_FIELDS_TABLE_BASE
      title={d.m_title}
      dialogSize={DEFAULT_DLG_SIZE}
      sashPosition={sash}
      onSashPosition={setSash}
      sidebarCollapsed={cfg.sidebar_collapsed}
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
      m_filter={{ value: d.m_filter, onChange: (t) => d.OnFilterText(t) }}
      m_choiceScope={{ value: d.m_choiceScope, onChange: (i) => d.OnScope(i) }}
      m_groupSymbolsBox={{
        value: d.m_groupSymbolsBox,
        onChange: (v) => d.OnGroupSymbolsToggled(v),
      }}
      onRegroupSymbols={() => d.OnRegroupSymbols()}
      m_grid={<WxGridView grid={d.m_grid} tricks={d.m_gridTricks} ariaLabel="Symbol fields" />}
      onSidebarToggle={() => {
        d.OnSidebarToggle(sash);
        // SplitVertically( m_leftPanel, m_rightPanel, cfg.sash_pos ) when it opens again
        if (!d.Settings().sidebar_collapsed) setSash(d.Settings().sash_pos);
      }}
      onOK={() => {
        const r = d.OnOk();
        if (r !== null) close(r);
      }}
      onApply={() => d.OnApply()}
      onCancel={() =>
        void d.OnCancel().then((r) => {
          if (r !== null) close(r);
        })
      }
    />
  );
}
