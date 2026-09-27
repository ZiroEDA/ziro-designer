// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LIB_TABLE_GRID_DATA_MODEL` (common/libraries/lib_table_grid_data_model.cpp,
 * include/lib_table_grid_data_model.h): a working copy of one LIBRARY_TABLE
 * as a WX_GRID table, the model under every library-table notebook page.
 *
 * The columns are `COL_ORDER`: a status button, Enable, Show, Nickname,
 * Library Path, Library Format, Options, Description. A read-only table
 * (`LIBRARY_TABLE::IsReadOnly`) refuses every edit but Enable and Show, and
 * adds or deletes no rows.
 *
 * Web delta: the Library Path cell is a text editor. Upstream's is
 * `GRID_CELL_PATH_EDITOR`, a text box with a file-browse button; a browser
 * page has no file system to browse, so `getFileTypes`, which only that
 * button asks, is not here either.
 */
import { KiBitmapBundle } from '../bitmap.js';
import { BITMAPS } from '../bitmaps/bitmaps_list.js';
import { escapeLibId, unescapeString } from '../string_utils.js';
import { GRID_BITMAP_BUTTON_RENDERER } from '../widgets/grid_button.js';
import { GRID_CELL_TEXT_EDITOR } from '../widgets/grid_text_helpers.js';
import { WX_GRID_TABLE_BASE } from '../widgets/wx_grid.js';
import {
  type wxAttrKind,
  wxALIGN_CENTER,
  wxGRID_VALUE_BOOL,
  wxGRID_VALUE_STRING,
  wxGridCellAttr,
  wxGridCellBoolRenderer,
  wxGridCellChoiceEditor,
  wxGridTableRequest,
} from '../wx/grid.js';
import type { LIBRARY_MANAGER_ADAPTER } from './library_manager.js';
import { type LIBRARY_TABLE, LIBRARY_TABLE_ROW } from './library_table.js';

/** `COL_ORDER`: the library table grid column order. */
export enum COL_ORDER {
  COL_STATUS,
  COL_ENABLED,
  COL_VISIBLE,
  COL_NICKNAME,
  COL_URI,
  COL_TYPE,
  COL_OPTIONS,
  COL_DESCR,
  /** keep as last */
  COL_COUNT,
}

export const {
  COL_STATUS,
  COL_ENABLED,
  COL_VISIBLE,
  COL_NICKNAME,
  COL_URI,
  COL_TYPE,
  COL_OPTIONS,
  COL_DESCR,
  COL_COUNT,
} = COL_ORDER;

export class LIB_TABLE_GRID_DATA_MODEL extends WX_GRID_TABLE_BASE {
  /** Working copy of a table. */
  protected m_table: LIBRARY_TABLE;
  protected m_changeCallback: (() => void) | null = null;

  protected m_uriEditor: wxGridCellAttr;
  protected m_typesEditor: wxGridCellAttr;
  protected m_boolAttr: wxGridCellAttr;
  protected m_readOnlyAttr: wxGridCellAttr;
  protected m_warningAttr: wxGridCellAttr;
  protected m_noStatusAttr: wxGridCellAttr;
  protected m_editSettingsAttr: wxGridCellAttr;
  protected m_openTableAttr: wxGridCellAttr;

  /** Handle to the adapter for the type of table this grid represents (may be null). */
  protected m_adapter: LIBRARY_MANAGER_ADAPTER | null;

  /**
   * `( aParent, aGrid, aTableToEdit, aAdapter, aPluginChoices, aMRUDirectory,
   * aProjectPath )`; the dialog, the grid and the two paths were the path
   * editor's, which is not here (see the file comment).
   */
  constructor(
    aTableToEdit: LIBRARY_TABLE,
    aAdapter: LIBRARY_MANAGER_ADAPTER | null,
    aPluginChoices: readonly string[],
  ) {
    super();
    this.m_table = aTableToEdit.Clone();
    this.m_adapter = aAdapter;

    this.m_uriEditor = new wxGridCellAttr();
    this.m_uriEditor.SetEditor(new GRID_CELL_TEXT_EDITOR());

    this.m_typesEditor = new wxGridCellAttr();
    this.m_typesEditor.SetEditor(new wxGridCellChoiceEditor([...aPluginChoices]));

    this.m_boolAttr = new wxGridCellAttr();
    this.m_boolAttr.SetRenderer(new wxGridCellBoolRenderer());
    this.m_boolAttr.SetReadOnly(); // not really; we delegate interactivity to GRID_TRICKS
    this.m_boolAttr.SetAlignment(wxALIGN_CENTER, wxALIGN_CENTER);

    this.m_readOnlyAttr = new wxGridCellAttr();
    this.m_readOnlyAttr.SetReadOnly();

    this.m_warningAttr = new wxGridCellAttr();
    this.m_warningAttr.SetRenderer(
      new GRID_BITMAP_BUTTON_RENDERER(KiBitmapBundle(BITMAPS.small_warning)),
    );
    this.m_warningAttr.SetReadOnly();
    this.m_warningAttr.SetAlignment(wxALIGN_CENTER, wxALIGN_CENTER);

    this.m_noStatusAttr = new wxGridCellAttr();
    this.m_noStatusAttr.SetReadOnly();
    this.m_noStatusAttr.SetAlignment(wxALIGN_CENTER, wxALIGN_CENTER);

    this.m_editSettingsAttr = new wxGridCellAttr();
    this.m_editSettingsAttr.SetRenderer(
      new GRID_BITMAP_BUTTON_RENDERER(KiBitmapBundle(BITMAPS.config)),
    );
    this.m_editSettingsAttr.SetReadOnly(); // not really; we delegate interactivity to GRID_TRICKS
    this.m_editSettingsAttr.SetAlignment(wxALIGN_CENTER, wxALIGN_CENTER);

    this.m_openTableAttr = new wxGridCellAttr();
    this.m_openTableAttr.SetRenderer(
      new GRID_BITMAP_BUTTON_RENDERER(KiBitmapBundle(BITMAPS.small_new_window)),
    );
    this.m_openTableAttr.SetReadOnly(); // not really; we delegate interactivity to GRID_TRICKS
    this.m_openTableAttr.SetAlignment(wxALIGN_CENTER, wxALIGN_CENTER);
  }

  // ---- wxGridTableBase overloads ------------------------------------------

  GetNumberRows(): number {
    return this.size();
  }

  GetNumberCols(): number {
    return COL_COUNT;
  }

  GetValue(aRow: number, aCol: number): string {
    if (this.badCoords(aRow, aCol)) return '';

    const r = this.at(aRow);

    switch (aCol) {
      case COL_NICKNAME:
        return unescapeString(r.Nickname());
      case COL_URI:
        return r.URI();
      case COL_TYPE:
        return r.Type();
      case COL_OPTIONS:
        return r.Options();
      case COL_DESCR:
        return r.Description();
      case COL_ENABLED:
        return r.Disabled() ? '0' : '1';
      case COL_VISIBLE:
        return r.Hidden() ? '0' : '1';
      case COL_STATUS:
        if (!r.IsOk()) return r.ErrorDescription();

        if (this.m_adapter?.SupportsConfigurationDialog(r.Nickname())) return 'Edit settings';
        else if (r.Type() === LIBRARY_TABLE_ROW.TABLE_TYPE_NAME) return 'Open library table';

        return '';
      default:
        return '';
    }
  }

  override GetAttr(aRow: number, aCol: number, aKind: wxAttrKind): wxGridCellAttr | null {
    if (this.badCoords(aRow, aCol)) return this.enhanceAttr(null, aRow, aCol, aKind);

    const tableRow = this.at(aRow);
    const readOnly = this.m_table.IsReadOnly();

    switch (aCol) {
      case COL_URI:
        if (readOnly) return this.enhanceAttr(this.m_readOnlyAttr, aRow, aCol, aKind);

        return this.enhanceAttr(this.m_uriEditor, aRow, aCol, aKind);

      case COL_TYPE:
        if (readOnly) return this.enhanceAttr(this.m_readOnlyAttr, aRow, aCol, aKind);

        return this.enhanceAttr(this.m_typesEditor, aRow, aCol, aKind);

      case COL_ENABLED:
      case COL_VISIBLE:
        return this.enhanceAttr(this.m_boolAttr, aRow, aCol, aKind);

      case COL_STATUS:
        if (!tableRow.IsOk()) return this.enhanceAttr(this.m_warningAttr, aRow, aCol, aKind);

        if (this.m_adapter?.SupportsConfigurationDialog(tableRow.Nickname()))
          return this.enhanceAttr(this.m_editSettingsAttr, aRow, aCol, aKind);
        else if (tableRow.Type() === LIBRARY_TABLE_ROW.TABLE_TYPE_NAME)
          return this.enhanceAttr(this.m_openTableAttr, aRow, aCol, aKind);

        return this.enhanceAttr(this.m_noStatusAttr, aRow, aCol, aKind);

      default:
        if (readOnly) return this.enhanceAttr(this.m_readOnlyAttr, aRow, aCol, aKind);

        return this.enhanceAttr(null, aRow, aCol, aKind);
    }
  }

  override CanGetValueAs(aRow: number, aCol: number, aTypeName: string): boolean {
    if (this.badCoords(aRow, aCol)) return false;

    switch (aCol) {
      case COL_ENABLED:
      case COL_VISIBLE:
        return aTypeName === wxGRID_VALUE_BOOL;
      default:
        return aTypeName === wxGRID_VALUE_STRING;
    }
  }

  override CanSetValueAs(aRow: number, aCol: number, aTypeName: string): boolean {
    return this.CanGetValueAs(aRow, aCol, aTypeName);
  }

  override GetValueAsBool(aRow: number, aCol: number): boolean {
    if (this.badCoords(aRow, aCol)) return false;

    if (aCol === COL_ENABLED) return !this.at(aRow).Disabled();
    else if (aCol === COL_VISIBLE) return !this.at(aRow).Hidden();
    else return false;
  }

  SetValue(aRow: number, aCol: number, aValue: string): void {
    if (this.badCoords(aRow, aCol)) return;

    // For read-only tables, only enable/visible changes are allowed
    if (this.m_table.IsReadOnly() && aCol !== COL_ENABLED && aCol !== COL_VISIBLE) return;

    const lrow = this.at(aRow);

    switch (aCol) {
      case COL_NICKNAME:
        lrow.SetNickname(escapeLibId(aValue));
        break;
      case COL_URI:
        lrow.SetURI(aValue);
        break;
      case COL_TYPE:
        lrow.SetType(aValue);
        break;
      case COL_OPTIONS:
        lrow.SetOptions(aValue);
        break;
      case COL_DESCR:
        lrow.SetDescription(aValue);
        break;
      case COL_ENABLED:
        lrow.SetDisabled(aValue === '0');
        break;
      case COL_VISIBLE:
        lrow.SetHidden(aValue === '0');
        break;
      case COL_STATUS:
        break;
    }

    if (aCol === COL_URI || aCol === COL_TYPE || aCol === COL_OPTIONS) {
      // GetView()->CallAfter( ... ): recheck once the edit has landed.
      queueMicrotask(() => {
        if (this.badCoords(aRow, aCol)) return;

        const r = this.at(aRow);
        this.m_adapter?.CheckTableRow(r);
        this.GetView()?.Refresh();
      });
    }

    this.m_changeCallback?.();
  }

  override SetValueAsBool(aRow: number, aCol: number, aValue: boolean): void {
    if (this.badCoords(aRow, aCol)) return;

    if (aCol === COL_ENABLED) this.at(aRow).SetDisabled(!aValue);
    else if (aCol === COL_VISIBLE) this.at(aRow).SetHidden(!aValue);

    this.m_changeCallback?.();
  }

  override IsEmptyCell(aRow: number, aCol: number): boolean {
    return !this.GetValue(aRow, aCol);
  }

  override InsertRows(aPos = 0, aNumRows = 1): boolean {
    if (this.m_table.IsReadOnly()) return false;

    if (aPos < this.size()) {
      // Upstream inserts at begin() + i, whatever aPos is.
      for (let i = 0; i < aNumRows; i++) this.insert(i, this.makeNewRow());

      // use the (wxGridStringTable) source Luke.
      this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_INSERTED, aPos, aNumRows);

      this.m_changeCallback?.();
      return true;
    }

    return false;
  }

  override AppendRows(aNumRows = 1): boolean {
    if (this.m_table.IsReadOnly()) return false;

    // do not modify aNumRows, original value needed for wxGridTableMessage below
    for (let i = aNumRows; i; --i) this.push_back(this.makeNewRow());

    this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_APPENDED, aNumRows);

    this.m_changeCallback?.();
    return true;
  }

  override DeleteRows(aPos = 0, aNumRows = 1): boolean {
    if (this.m_table.IsReadOnly()) return false;

    // aPos may be a large positive, e.g. size_t(-1), and the sum of
    // aPos+aNumRows may wrap here, so both ends of the range are tested.
    if (aPos < this.size() && aPos + aNumRows <= this.size()) {
      this.erase(aPos, aPos + aNumRows);

      this.notify(wxGridTableRequest.wxGRIDTABLE_NOTIFY_ROWS_DELETED, aPos, aNumRows);

      this.m_changeCallback?.();
      return true;
    }

    return false;
  }

  override GetColLabelValue(aCol: number): string {
    switch (aCol) {
      case COL_NICKNAME:
        return 'Nickname';
      case COL_URI:
        return 'Library Path';
      // keep this "Library Format" text fairly long so column is sized wide enough
      case COL_TYPE:
        return 'Library Format';
      case COL_OPTIONS:
        return 'Options';
      case COL_DESCR:
        return 'Description';
      case COL_ENABLED:
        return 'Enable';
      case COL_VISIBLE:
        return 'Show';
      case COL_STATUS:
        return ' ';
      default:
        return '';
    }
  }

  ContainsNickname(aNickname: string): boolean {
    for (let i = 0; i < this.size(); ++i) if (this.at(i).Nickname() === aNickname) return true;

    return false;
  }

  At(aIndex: number): LIBRARY_TABLE_ROW {
    return this.at(aIndex);
  }

  Table(): LIBRARY_TABLE {
    return this.m_table;
  }

  Adapter(): LIBRARY_MANAGER_ADAPTER | null {
    return this.m_adapter;
  }

  /** `RecheckRows`: `CheckTableRow` every row, then redraw the status column. */
  RecheckRows(): void {
    if (!this.m_adapter) return;

    for (let row = 0; row < this.size(); ++row) this.m_adapter.CheckTableRow(this.at(row));

    if (this.GetNumberRows() > 0) this.GetView()?.Refresh();
  }

  SetChangeCallback(aCallback: (() => void) | null): void {
    this.m_changeCallback = aCallback;
  }

  protected badCoords(aRow: number, aCol: number): boolean {
    if (aRow < 0 || aRow >= this.size()) return true;

    if (aCol < 0 || aCol >= this.GetNumberCols()) return true;

    return false;
  }

  protected at(aIndex: number): LIBRARY_TABLE_ROW {
    const row = this.m_table.Rows()[aIndex];

    // std::deque::at throws on a bad index.
    if (row === undefined) throw new RangeError(`LIB_TABLE_GRID_DATA_MODEL: no row ${aIndex}`);

    return row;
  }

  protected size(): number {
    return this.m_table.Rows().length;
  }

  protected makeNewRow(): LIBRARY_TABLE_ROW {
    return this.m_table.MakeRow();
  }

  protected insert(aIndex: number, aRow: LIBRARY_TABLE_ROW): void {
    this.m_table.Rows().splice(aIndex, 0, aRow);
  }

  protected push_back(aRow: LIBRARY_TABLE_ROW): void {
    this.m_table.Rows().push(aRow);
  }

  protected erase(aFirst: number, aLast: number): void {
    this.m_table.Rows().splice(aFirst, aLast - aFirst);
  }
}
