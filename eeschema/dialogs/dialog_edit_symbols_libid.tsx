// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/dialogs/dialog_edit_symbols_libid.cpp`: DIALOG_EDIT_SYMBOLS_LIBID, the dialog to
 * remap the library id of symbols to another library id, on the live schematic.
 *
 * Every symbol of the hierarchy, orphans included, grouped by library id - one WX_GRID row per
 * id, its references auto-wrapped, an orphan's id in bold italic. Map Orphans looks for a part of
 * the same name in every loaded library; a double click on a row browses for one; OK reloads the
 * chosen symbols from their new library in one SCH_COMMIT.
 *
 * GRIDCELL_AUTOWRAP_STRINGRENDERER (wxWidgets' line breaking, to size the rows) is the browser's
 * own wrapping here; OnSizeGrid / AdjustGridColumns are the grid view's column sizing.
 */
import { type JSX, useReducer } from 'react';
import { DisplayErrorMessage, DisplayInfoMessage } from '@ziroeda/common/confirm.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { ESCAPE_CONTEXT, EscapeString, unescapeString } from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import {
  wxEVT_GRID_CELL_LEFT_DCLICK,
  type wxGridEvent,
  wxGridSelectionModes,
} from '@ziroeda/wx/grid.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/wx/menu.js';
import { wxCmp, wxFormat } from '@ziroeda/wx/wxstring.js';
import { SymbolLibAdapter } from '../project_sch.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_REFERENCE_LIST } from '../sch_reference_list.js';
import type { SCH_SCREEN } from '../sch_screen.js';
import { SYMBOL_FILTER } from '../sch_sheet_path.js';
import type { SCH_SYMBOL } from '../sch_symbol.js';
import { DIALOG_EDIT_SYMBOLS_LIBID_BASE } from './dialog_edit_symbols_libid_base.js';
import { _ } from '@ziroeda/wx/translation.js';

export const COL_REFS = 0;
export const COL_CURR_LIBID = 1;
export const COL_NEW_LIBID = 2;

/** A helper to handle symbols to edit. */
class SYMBOL_CANDIDATE {
  /** the schematic symbol */
  m_Symbol: SCH_SYMBOL;
  /** the row index in m_grid */
  m_Row = -1;
  /** the screen where m_Symbol lives */
  m_Screen: SCH_SCREEN | null = null;
  /** the schematic reference, only to display it in list */
  m_Reference = '';
  /** the Lib Id of the symbol before any change. */
  m_InitialLibId: string;
  /** true if a symbol has no corresponding symbol found in libs. */
  m_IsOrphan = false;

  constructor(aSymbol: SCH_SYMBOL) {
    this.m_Symbol = aSymbol;
    this.m_InitialLibId = this.m_Symbol.GetLibId().Format();
  }

  /** Return a string like mylib:symbol_name from the #LIB_ID of the symbol. */
  GetStringLibId(): string {
    return this.m_Symbol.GetLibId().GetUniStringLibId();
  }
}

/** A sort compare function to sort symbols list by LIB_ID and then reference. */
function sort_by_libid(aCandidate1: SYMBOL_CANDIDATE, aCandidate2: SYMBOL_CANDIDATE): number {
  const c = aCandidate1.m_Symbol.GetLibId().compare(aCandidate2.m_Symbol.GetLibId());

  if (c === 0) return wxCmp(aCandidate1.m_Reference, aCandidate2.m_Reference);

  return c;
}

/** `getLibIdValue( aGrid, aRow, aCol )`: the cell's library id, each part escaped. */
export function getLibIdValue(aGrid: WX_GRID, aRow: number, aCol: number): string {
  const rawValue = aGrid.GetCellValue(aRow, aCol);

  if (rawValue === '') return rawValue;

  // wxString::BeforeFirst( ':', &rest ): with no ':' the rest is empty.
  const colon = rawValue.indexOf(':');
  const libName = colon < 0 ? rawValue : rawValue.slice(0, colon);
  const itemName = colon < 0 ? '' : rawValue.slice(colon + 1);

  return `${EscapeString(libName, ESCAPE_CONTEXT.CTX_LIBID)}:${EscapeString(itemName, ESCAPE_CONTEXT.CTX_LIBID)}`;
}

/** What the dialog asks the window for. */
export interface DIALOG_EDIT_SYMBOLS_LIBID_HOST {
  /**
   * `GetParent()->PickSymbolFromLibrary( …, &preselected, … )`: the symbol chooser, answering the
   * picked library id, or null when cancelled.
   */
  pickSymbolFromLibrary(aPreselected: string): Promise<string | null>;
  /** `wxSingleChoiceDialog( this, msg, caption, choices ).ShowModal()`: the pick, or null. */
  singleChoice(
    aMessage: string,
    aCaption: string,
    aChoices: readonly string[],
  ): Promise<string | null>;
}

/**
 * Dialog to globally edit the #LIB_ID of groups if symbols having the same initial LIB_ID.
 *
 * This is useful when you want to:
 *  * move a symbol from a symbol library to another symbol library.
 *  * change the nickname of a library.
 *  * globally replace the symbol used by a group of symbols by another symbol.
 */
export class DIALOG_EDIT_SYMBOLS_LIBID {
  private readonly m_parent: SCH_EDIT_FRAME;
  private readonly m_host: DIALOG_EDIT_SYMBOLS_LIBID_HOST;
  readonly m_grid = new WX_GRID();
  readonly m_tricks: GRID_TRICKS;
  /** set to true if the schematic is modified */
  private m_isModified = false;
  /** list of rows containing orphan lib_id */
  readonly m_OrphansRowIndexes: number[] = [];
  private readonly m_symbols: SYMBOL_CANDIDATE[] = [];
  /** `m_buttonOrphanItems->Enable( … )` */
  m_buttonOrphanItemsEnabled = false;
  /** `m_checkBoxUpdateFields` */
  m_checkBoxUpdateFields = false;

  constructor(aParent: SCH_EDIT_FRAME, aHost: DIALOG_EDIT_SYMBOLS_LIBID_HOST) {
    this.m_parent = aParent;
    this.m_host = aHost;

    // DIALOG_EDIT_SYMBOLS_LIBID_BASE: `m_grid->CreateGrid( 5, 3 )` and its labels.
    this.m_grid.CreateGrid(5, 3);
    this.m_grid.SetColLabelValue(COL_REFS, _('Symbols'));
    this.m_grid.SetColLabelValue(COL_CURR_LIBID, _('Current Library Reference'));
    this.m_grid.SetColLabelValue(COL_NEW_LIBID, _('New Library Reference'));
    this.m_grid.Connect(wxEVT_GRID_CELL_LEFT_DCLICK, (aEvent: wxGridEvent) => {
      void this.onCellBrowseLib(aEvent);
    });

    this.m_tricks = new GRID_TRICKS(this.m_grid);

    this.initDlg();
  }

  GetParent(): SCH_EDIT_FRAME {
    return this.m_parent;
  }

  IsSchematicModified(): boolean {
    return this.m_isModified;
  }

  private initDlg(): void {
    // Clear the FormBuilder rows
    this.m_grid.ClearRows();

    this.m_isModified = false;

    // This option build the full symbol list.
    // In complex hierarchies, the same symbol is in fact duplicated, but
    // it is listed with different references (one by sheet instance)
    // the list is larger and looks like it contains all symbols.
    const references = new SCH_REFERENCE_LIST();

    // build the full list of symbols including symbol having no symbol in loaded libs
    // (orphan symbols)
    this.GetParent()
      .Schematic()
      .Hierarchy()
      .GetSymbols(references, SYMBOL_FILTER.SYMBOL_FILTER_ALL, true /* include orphan symbols */);

    for (let ii = 0; ii < references.GetCount(); ii++) {
      const item = references.at(ii);
      const candidate = new SYMBOL_CANDIDATE(item.GetSymbol());
      candidate.m_Screen = item.GetSheetPath().LastScreen();
      const sheetpath = item.GetSheetPath();
      candidate.m_Reference = candidate.m_Symbol.GetRef(sheetpath);
      const unitcount = candidate.m_Symbol.GetUnitCount();
      candidate.m_IsOrphan = unitcount === 0;
      this.m_symbols.push(candidate);
    }

    if (this.m_symbols.length === 0) return;

    // now sort by lib id to create groups of items having the same lib id
    this.m_symbols.sort(sort_by_libid);

    // Now, fill m_grid
    let last_str_libid = this.m_symbols[0]!.GetStringLibId();
    let row = 0;
    let refs = '';
    let last_ref = '';
    let mark_cell = this.m_symbols[0]!.m_IsOrphan;

    for (const symbol of this.m_symbols) {
      const str_libid = symbol.GetStringLibId();

      if (last_str_libid !== str_libid) {
        // Add last group to grid
        this.AddRowToGrid(mark_cell, refs, last_str_libid);

        // prepare next entry
        mark_cell = symbol.m_IsOrphan;
        last_str_libid = str_libid;
        refs = '';
        row++;
      } else if (symbol.m_Reference === last_ref) {
        symbol.m_Row = row;
        continue;
      }

      last_ref = symbol.m_Reference;

      if (refs !== '') refs += ', ';

      refs += symbol.m_Reference;
      symbol.m_Row = row;
    }

    // Add last symbol group:
    this.AddRowToGrid(mark_cell, refs, last_str_libid);

    // Allows only the selection by row
    this.m_grid.SetSelectionMode(wxGridSelectionModes.wxGridSelectRows);

    this.m_buttonOrphanItemsEnabled = this.m_OrphansRowIndexes.length > 0;
  }

  /**
   * Add a new row (new entry) in m_grid.
   *
   * @param aMarkRow set to true to use bold/italic font in column COL_CURR_LIBID.
   * @param aReferences is the value of cell( aRowId, COL_REFS).
   * @param aStrLibId is the value of cell( aRowId, COL_CURR_LIBID).
   */
  private AddRowToGrid(aMarkRow: boolean, aReferences: string, aStrLibId: string): void {
    const row = this.m_grid.GetNumberRows();

    // An orphaned symbol exists, set m_AsOrphanCmp as true.
    if (aMarkRow) this.m_OrphansRowIndexes.push(row);

    this.m_grid.AppendRows(1);

    this.m_grid.SetCellValue(row, COL_REFS, unescapeString(aReferences));
    this.m_grid.SetReadOnly(row, COL_REFS);

    this.m_grid.SetCellValue(row, COL_CURR_LIBID, unescapeString(aStrLibId));
    this.m_grid.SetReadOnly(row, COL_CURR_LIBID);

    // A symbol is not existing in libraries: the cell is marked bold italic (IsMarkedRow).
  }

  /** `SetCellFont( row, COL_CURR_LIBID, bold italic )` was called for \a aRow. */
  IsMarkedRow(aRow: number): boolean {
    return this.m_OrphansRowIndexes.includes(aRow);
  }

  /** returns true if all new lib id are valid */
  async validateLibIds(): Promise<boolean> {
    if (!this.m_grid.CommitPendingChanges()) return false;

    const row_max = this.m_grid.GetNumberRows() - 1;

    for (let row = 0; row <= row_max; row++) {
      const new_libid = getLibIdValue(this.m_grid, row, COL_NEW_LIBID);

      if (new_libid === '') continue;

      // a new lib id is found. validate this new value
      const id = new LIB_ID();
      id.Parse(new_libid);

      if (!id.IsValid()) {
        await DisplayInfoMessage(
          wxFormat(_('Symbol library identifier %s is not valid.'), new_libid),
        );

        this.m_grid.SetGridCursor(row, COL_NEW_LIBID);

        this.m_grid.EnableCellEditControl(true);

        return false;
      }
    }

    return true;
  }

  /** called on a right click or a left double click */
  async onCellBrowseLib(aEvent: wxGridEvent): Promise<void> {
    const row = aEvent.GetRow();
    this.m_grid.SelectRow(row); // only for user, to show the selected line

    await this.setLibIdByBrowser(row);
  }

  /** Try to find a candidate for non existing symbols */
  async onClickOrphansButton(): Promise<void> {
    const adapter = SymbolLibAdapter(this.m_parent.Prj());
    const libs = adapter.GetLibraryNames();
    let aliasNames: string[] = [];
    let candidateSymbNames: string[] = [];

    let fixesCount = 0;

    // Try to find a candidate for non existing symbols in any loaded library
    for (const orphanRow of this.m_OrphansRowIndexes) {
      const orphanLibid = getLibIdValue(this.m_grid, orphanRow, COL_CURR_LIBID);
      const grid_row_idx = orphanRow; //row index in m_grid for the current item

      const curr_libid = new LIB_ID();
      curr_libid.Parse(orphanLibid, true);
      const symbolName = curr_libid.GetLibItemName();

      // number of full LIB_ID candidates (because we search for a symbol name
      // inside all available libraries, perhaps the same symbol name can be found
      // in more than one library, giving ambiguity
      let libIdCandidateCount = 0;
      candidateSymbNames = [];

      // now try to find a candidate
      for (const lib of libs) {
        aliasNames = [];

        try {
          aliasNames = adapter.GetSymbolNames(lib);
        } catch (e) {
          // ignore, it is handled below
          if (!(e instanceof IO_ERROR)) throw e;
        }

        if (aliasNames.length === 0) continue;

        // Find a symbol name in symbols inside this library:
        if (aliasNames.includes(symbolName)) {
          // a candidate is found!
          libIdCandidateCount++;
          const newLibid = `${lib}:${symbolName}`;

          // Uses the first found. Most of time, it is alone.
          // Others will be stored in a candidate list
          if (libIdCandidateCount <= 1) {
            this.m_grid.SetCellValue(grid_row_idx, COL_NEW_LIBID, unescapeString(newLibid));
            candidateSymbNames.push(this.m_grid.GetCellValue(grid_row_idx, COL_NEW_LIBID));
            fixesCount++;
          } else {
            // Store other candidates for later selection
            candidateSymbNames.push(unescapeString(newLibid));
          }
        }
      }

      // If more than one LIB_ID candidate, ask for selection between candidates:
      if (libIdCandidateCount > 1) {
        // Mainly for user: select the row being edited
        this.m_grid.SelectRow(grid_row_idx);

        const msg = wxFormat(
          _('Available Candidates for %s '),
          this.m_grid.GetCellValue(grid_row_idx, COL_CURR_LIBID),
        );

        const picked = await this.m_host.singleChoice(
          msg,
          wxFormat(_('Candidates count %d '), libIdCandidateCount),
          candidateSymbNames,
        );

        if (picked !== null) this.m_grid.SetCellValue(grid_row_idx, COL_NEW_LIBID, picked);
      }
    }

    // Not all orphan symbols are fixed.
    if (fixesCount < this.m_OrphansRowIndexes.length) {
      await DisplayInfoMessage(
        wxFormat(
          _('%u link(s) mapped, %u not found'),
          fixesCount,
          this.m_OrphansRowIndexes.length - fixesCount,
        ),
      );
    } else {
      await DisplayInfoMessage(wxFormat(_('All %u link(s) resolved'), fixesCount));
    }
  }

  /**
   * Run the lib browser and set the selected #LIB_ID for \a aRow.
   *
   * @param aRow is the row to edit.
   * @return false if the command was aborted.
   */
  async setLibIdByBrowser(aRow: number): Promise<boolean> {
    // Use library viewer to choose a symbol
    const preselected = new LIB_ID();
    let current = getLibIdValue(this.m_grid, aRow, COL_NEW_LIBID);

    if (current === '') current = getLibIdValue(this.m_grid, aRow, COL_CURR_LIBID);

    if (current !== '') preselected.Parse(current, true);

    const picked = await this.m_host.pickSymbolFromLibrary(preselected.Format());

    // command aborted
    if (picked === null || picked === '') return false;

    const sel = new LIB_ID();
    sel.Parse(picked, true);

    // Should not occur
    if (!sel.IsValid()) {
      await DisplayInfoMessage(_('Invalid symbol library identifier'));
      return false;
    }

    const new_libid = sel.Format();

    this.m_grid.SetCellValue(aRow, COL_NEW_LIBID, unescapeString(new_libid));

    return true;
  }

  /** Automatically called when click on OK button */
  async TransferDataFromWindow(): Promise<boolean> {
    if (!(await this.validateLibIds())) return false;

    const commit = new SCH_COMMIT(this.GetParent());

    const getName = (aLibId: LIB_ID): string => unescapeString(aLibId.GetLibItemName());

    const row_max = this.m_grid.GetNumberRows() - 1;

    for (let row = 0; row <= row_max; row++) {
      const new_libid = getLibIdValue(this.m_grid, row, COL_NEW_LIBID);

      if (new_libid === '' || new_libid === getLibIdValue(this.m_grid, row, COL_CURR_LIBID))
        continue;

      // A new lib id is found and was already validated.
      const id = new LIB_ID();
      id.Parse(new_libid, true);

      for (const candidate of this.m_symbols) {
        if (candidate.m_Row !== row) continue;

        let symbol = null;

        try {
          symbol = SymbolLibAdapter(this.m_parent.Prj()).LoadSymbol(id);
        } catch (e) {
          if (!(e instanceof IO_ERROR)) throw e;

          DisplayErrorMessage(
            wxFormat(
              _('Error loading symbol %s from library %s.\n\n%s'),
              id.GetLibItemName(),
              id.GetLibNickname(),
              e.What(),
            ),
          );
        }

        if (symbol === null) continue;

        const screen = candidate.m_Screen!;

        commit.Modify(candidate.m_Symbol, screen);
        this.m_isModified = true;

        screen.Remove(candidate.m_Symbol);
        const value = candidate.m_Symbol.GetField(FIELD_T.VALUE)!;

        // If value is a proxy for the itemName then make sure it gets updated
        if (getName(candidate.m_Symbol.GetLibId()) === value.GetText())
          candidate.m_Symbol.SetValueFieldText(getName(id));

        candidate.m_Symbol.SetLibId(id);
        candidate.m_Symbol.SetLibSymbol(symbol.Flatten());
        screen.Append(candidate.m_Symbol);
        screen.SetContentModified();

        if (this.m_checkBoxUpdateFields) {
          candidate.m_Symbol.UpdateFields(
            null,
            false /* update style */,
            false /* update ref */,
            false /* update other fields */,
            false /* reset ref */,
            true /* reset other fields */,
          );
        }
      }
    }

    if (this.m_isModified) commit.Push('Change Symbol Library Indentifier');

    return true;
  }
}

/** The window: the base's sizer tree around the dialog's grid. */
export function DialogEditSymbolsLibId({
  dlg,
  onClose,
}: {
  dlg: DIALOG_EDIT_SYMBOLS_LIBID;
  /** `InvokeDialogEditSymbolsLibId`'s answer: wxID_OK when the schematic changed. */
  onClose: (aResult: number) => void;
}): JSX.Element {
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  return (
    <DIALOG_EDIT_SYMBOLS_LIBID_BASE
      m_grid={
        <WxGridView
          grid={dlg.m_grid}
          tricks={dlg.m_tricks}
          columns={[{ width: 280 }, { width: 280 }, { width: 280 }]}
          flexCol={COL_NEW_LIBID}
          ariaLabel="Symbol library references"
          renderCell={(row, col, value) => {
            // `m_autoWrapRenderer` on the references.
            if (col === COL_REFS)
              return (
                <span className="ze-grid-text" style={{ whiteSpace: 'normal' }}>
                  {value}
                </span>
              );

            // A symbol is not existing in libraries: `font.MakeBold(); font.MakeItalic()`.
            if (col === COL_CURR_LIBID && dlg.IsMarkedRow(row))
              return (
                <span className="ze-grid-text" style={{ fontWeight: 'bold', fontStyle: 'italic' }}>
                  {value}
                </span>
              );

            return null;
          }}
        />
      }
      m_buttonOrphanItems={{
        enabled: dlg.m_buttonOrphanItemsEnabled,
        onClick: () => void dlg.onClickOrphansButton(),
      }}
      m_checkBoxUpdateFields={{
        value: dlg.m_checkBoxUpdateFields,
        onChange: (aValue: boolean) => {
          dlg.m_checkBoxUpdateFields = aValue;
          repaint();
        },
      }}
      onOK={() =>
        void dlg.TransferDataFromWindow().then((aOk) => {
          if (aOk) onClose(dlg.IsSchematicModified() ? wxID_OK : wxID_CANCEL);
        })
      }
      onCancel={() => onClose(wxID_CANCEL)}
    />
  );
}
