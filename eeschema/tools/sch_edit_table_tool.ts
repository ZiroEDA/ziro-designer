// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDIT_TABLE_TOOL` (eeschema/tools/sch_edit_table_tool.{h,cpp}): rows, columns, merging,
 * the table properties dialog and the CSV export, on EDIT_TABLE_TOOL_BASE's shared algorithms.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { newKiid } from '@ziroeda/common/kiid.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { EDIT_TABLE_TOOL_BASE } from '@ziroeda/common/tool/edit_table_tool_base.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import type { BASE_SCREEN_LIKE } from '@ziroeda/common/undo_redo_container.js';
import { wxFD_OVERWRITE_PROMPT, wxFD_SAVE, wxICON_ERROR, wxOK } from '@ziroeda/common/wx/defs.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_COLLECTOR } from '../sch_collectors.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_TABLE } from '../sch_table.js';
import { SCH_TABLECELL } from '../sch_tablecell.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';

const TABLE_TOOL_BASE = EDIT_TABLE_TOOL_BASE<
  SCH_TABLE,
  SCH_TABLECELL,
  SCH_COMMIT,
  typeof SCH_TOOL_BASE<SCH_EDIT_FRAME>
>(SCH_TOOL_BASE<SCH_EDIT_FRAME>, (aToolMgr) => new SCH_COMMIT(aToolMgr));

export class SCH_EDIT_TABLE_TOOL extends TABLE_TOOL_BASE {
  constructor() {
    super('eeschema.TableEditor');
  }

  override Init(): boolean {
    super.Init();

    this.addMenus(this.m_selectionTool!.GetToolMenu().GetMenu());

    return true;
  }

  AddRowAbove(aEvent: TOOL_EVENT): number {
    return this.doAddRowAbove(aEvent);
  }

  AddRowBelow(aEvent: TOOL_EVENT): number {
    return this.doAddRowBelow(aEvent);
  }

  AddColumnBefore(aEvent: TOOL_EVENT): number {
    return this.doAddColumnBefore(aEvent);
  }

  AddColumnAfter(aEvent: TOOL_EVENT): number {
    return this.doAddColumnAfter(aEvent);
  }

  DeleteRows(aEvent: TOOL_EVENT): number {
    return this.doDeleteRows(aEvent);
  }

  DeleteColumns(aEvent: TOOL_EVENT): number {
    return this.doDeleteColumns(aEvent);
  }

  MergeCells(aEvent: TOOL_EVENT): number {
    return this.doMergeCells(aEvent);
  }

  UnmergeCells(aEvent: TOOL_EVENT): number {
    return this.doUnmergeCells(aEvent);
  }

  /** The one table every selected item is a cell of, else null (both handlers' first loop). */
  private parentTableOf(aItems: readonly EDA_ITEM[]): SCH_TABLE | null | undefined {
    let parentTable: SCH_TABLE | null = null;

    for (const item of aItems) {
      // `return 0`: a selection holding anything but cells is no table's.
      if (item.Type() !== KICAD_T.SCH_TABLECELL_T) return undefined;

      const table = item.GetParent() as unknown as SCH_TABLE;

      if (!parentTable) {
        parentTable = table;
      } else if (parentTable !== table) {
        parentTable = null;
        break;
      }
    }

    return parentTable;
  }

  *EditTable(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const selection = this.m_selectionTool!.RequestSelection(SCH_COLLECTOR.EditableItems);
    const clearSelection = selection.IsHover();
    const parentTable = this.parentTableOf(selection.Items());

    if (parentTable === undefined) return 0;

    if (parentTable) {
      // QuasiModal required for Scintilla auto-complete
      yield* this.RunMainStackModal(() =>
        this.m_frame!.ShowModalDialog('DIALOG_TABLE_PROPERTIES', [parentTable]),
      );
    }

    if (clearSelection) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    return 0;
  }

  *ExportTableToCSV(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const selection = this.m_selectionTool!.RequestSelection(SCH_COLLECTOR.EditableItems);
    const clearSelection = selection.IsHover();

    // Find the table from the selection
    const parentTable = this.parentTableOf(selection.Items());

    if (!parentTable) return 0;

    // Get current sheet path for variable resolution
    const currentSheet = this.m_frame!.GetCurrentSheet();

    // Show file save dialog
    let filePath = yield* this.RunMainStackModal(() =>
      this.m_frame!.ShowFileDialog(
        'Export Table to CSV',
        '',
        '',
        'CSV files (*.csv)|*.csv',
        wxFD_SAVE | wxFD_OVERWRITE_PROMPT,
      ),
    );

    if (filePath === null) {
      if (clearSelection) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
      return 0;
    }

    // Ensure .csv extension
    if (!filePath.toLowerCase().endsWith('.csv')) filePath += '.csv';

    // Helper function to escape CSV fields
    const escapeCSV = (field: string): string => {
      let escaped = field;

      // If field contains comma, quote, or newline, wrap in quotes and escape quotes
      if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')) {
        escaped = escaped.replaceAll('"', '""'); // Escape quotes by doubling them
        escaped = `"${escaped}"`;
      }

      return escaped;
    };

    // Export table data
    let out = '';

    for (let row = 0; row < parentTable.GetRowCount(); ++row) {
      for (let col = 0; col < parentTable.GetColCount(); ++col) {
        const cell = parentTable.GetCell(row, col)!;

        // Get resolved text (with variables expanded)
        const cellText = cell.GetShownText(null, currentSheet, false, 0);

        // Write escaped cell text
        out += escapeCSV(cellText);

        // Add comma separator unless it's the last column
        if (col < parentTable.GetColCount() - 1) out += ',';
      }

      // End of row
      out += '\n';
    }

    // Open file for writing
    if (!this.m_frame!.WriteTextFile(filePath, out)) {
      yield* this.RunMainStackModal(() =>
        this.m_frame!.ShowModalDialog('wxMessageBox', [], {
          message: `Failed to open file:\n${filePath}`,
          caption: 'Export Error',
          style: wxOK | wxICON_ERROR,
        }),
      );

      if (clearSelection) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
      return 0;
    }

    if (clearSelection) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    return 0;
  }

  copyCell(aSource: SCH_TABLECELL): SCH_TABLECELL {
    // Use copy constructor to copy all formatting properties (font, colors, borders, etc.)
    const cell = SCH_TABLECELL.copyOf(aSource);

    // Generate a new UUID to avoid duplicates (copy constructor preserves the old UUID)
    (cell as { m_Uuid: unknown }).m_Uuid = newKiid();

    // Clear text content - we only want the formatting, not the content
    cell.SetText('');

    // Position will be set by the caller, but preserve size from source
    cell.SetStart(aSource.GetStart());
    cell.SetEnd(aSource.GetEnd());

    return cell;
  }

  getTableCellSelection(): SELECTION {
    return this.m_selectionTool!.RequestSelection([KICAD_T.SCH_TABLECELL_T]);
  }

  getToolMgr(): TOOL_MANAGER {
    return this.m_toolMgr!;
  }

  getScreen(): BASE_SCREEN_LIKE | null {
    return this.m_frame!.GetScreen();
  }

  clearSelection(): void {
    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
  }

  protected override setTransitions(): void {
    this.Go(SYNC_HANDLER(this.AddRowAbove), ACTIONS.addRowAbove.MakeEvent());
    this.Go(SYNC_HANDLER(this.AddRowBelow), ACTIONS.addRowBelow.MakeEvent());

    this.Go(SYNC_HANDLER(this.AddColumnBefore), ACTIONS.addColBefore.MakeEvent());
    this.Go(SYNC_HANDLER(this.AddColumnAfter), ACTIONS.addColAfter.MakeEvent());

    this.Go(SYNC_HANDLER(this.DeleteRows), ACTIONS.deleteRows.MakeEvent());
    this.Go(SYNC_HANDLER(this.DeleteColumns), ACTIONS.deleteColumns.MakeEvent());

    this.Go(SYNC_HANDLER(this.MergeCells), ACTIONS.mergeCells.MakeEvent());
    this.Go(SYNC_HANDLER(this.UnmergeCells), ACTIONS.unmergeCells.MakeEvent());

    this.Go(this.EditTable, ACTIONS.editTable.MakeEvent());
    this.Go(this.ExportTableToCSV, ACTIONS.exportTableCSV.MakeEvent());
  }
}
