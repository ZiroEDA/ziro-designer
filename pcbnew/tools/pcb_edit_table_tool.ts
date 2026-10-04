// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_EDIT_TABLE_TOOL (`pcbnew/tools/pcb_edit_table_tool.cpp/.h`): the table
 * cell rows of the selection tool's context menu — add and delete rows and
 * columns, merge and unmerge, Edit Table..., Export to CSV — over
 * EDIT_TABLE_TOOL_BASE, which it shares with eeschema.
 */

import { applyMixins } from '@ziroeda/core/mixins.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { EDIT_TABLE_TOOL_BASE } from '@ziroeda/common/tool/edit_table_tool_base.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { fileFilter } from '@ziroeda/common/wildcards_and_files_ext.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_TABLE } from '../pcb_table.js';
import { PCB_TABLECELL } from '../pcb_tablecell.js';
import { PCB_SELECTION_TOOL } from './pcb_selection_tool.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';

/** The frame the table tool's two dialogs need. */
interface TABLE_TOOL_FRAME {
  ShowTablePropertiesDialog(aTable: PCB_TABLE): Promise<boolean>;
  ShowSaveFileDialog?(
    aTitle: string,
    aDefaultName: string,
    aWildcard: ReturnType<typeof fileFilter>,
    aCheckbox: null,
  ): Promise<{ path: string } | null>;
  WriteTextFile?(aPath: string, aText: string): boolean;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (EDIT_TABLE_TOOL_BASE, see libs/core/mixins.ts)
export class PCB_EDIT_TABLE_TOOL extends PCB_TOOL_BASE {
  constructor() {
    super('pcbnew.TableEditor');
  }

  /** @copydoc TOOL_INTERACTIVE::Init() */
  override Init(): boolean {
    super.Init();

    this.addMenus(this.m_toolMgr!.GetTool(PCB_SELECTION_TOOL)!.GetToolMenu().GetMenu());

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

  /** The one table every selected cell belongs to, or null. */
  private parentTableOf(aSelection: SELECTION): PCB_TABLE | null | undefined {
    let parentTable: PCB_TABLE | null = null;

    for (const item of aSelection.Items()) {
      if (item.Type() !== KICAD_T.PCB_TABLECELL_T) return undefined;

      const table = item.GetParent() as unknown as PCB_TABLE;

      if (!parentTable) {
        parentTable = table;
      } else if (parentTable !== table) {
        parentTable = null;
        break;
      }
    }

    return parentTable;
  }

  EditTable(_aEvent: TOOL_EVENT): number {
    const selection = this.getTableCellSelection();
    const clearSelection = selection.IsHover();
    const parentTable = this.parentTableOf(selection);

    // `return 0` on a non-cell item, before the selection is cleared.
    if (parentTable === undefined) return 0;

    void (async (): Promise<void> => {
      if (parentTable) {
        // DIALOG_TABLE_PROPERTIES dlg( frame(), parentTable ); dlg.ShowQuasiModal();
        await this.frame<TABLE_TOOL_FRAME & PCB_BASE_EDIT_FRAME>().ShowTablePropertiesDialog(
          parentTable,
        );
      }

      if (clearSelection) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
    })();

    return 0;
  }

  ExportTableToCSV(_aEvent: TOOL_EVENT): number {
    const selection = this.getTableCellSelection();
    const clearSelection = selection.IsHover();

    // Find the table from the selection
    const parentTable = this.parentTableOf(selection);

    if (!parentTable) return 0;

    void (async (): Promise<void> => {
      const frame = this.frame<TABLE_TOOL_FRAME & PCB_BASE_EDIT_FRAME>();

      // Show file save dialog
      const saveDialog = await frame.ShowSaveFileDialog?.(
        'Export Table to CSV',
        '',
        fileFilter('CSV files', ['csv']),
        null,
      );

      if (!saveDialog) {
        if (clearSelection) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

        return;
      }

      let filePath = saveDialog.path;

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

      let outFile = '';

      // Export table data
      for (let row = 0; row < parentTable.GetRowCount(); ++row) {
        for (let col = 0; col < parentTable.GetColCount(); ++col) {
          const cell = parentTable.GetCell(row, col)!;

          // Get resolved text (with variables expanded)
          const cellText = cell.GetShownText(false, 0);

          // Write escaped cell text
          outFile += escapeCSV(cellText);

          // Add comma separator unless it's the last column
          if (col < parentTable.GetColCount() - 1) outFile += ',';
        }

        // End of row
        outFile += '\n';
      }

      // Open file for writing
      if (!frame.WriteTextFile?.(filePath, outFile))
        DisplayErrorMessage(`Failed to open file:\n${filePath}`);

      if (clearSelection) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
    })();

    return 0;
  }

  ///< Set up handlers for various events.
  protected override setTransitions(): void {
    const S = SYNC_HANDLER<PCB_EDIT_TABLE_TOOL>;

    this.Go(S(this.AddRowAbove), ACTIONS.addRowAbove.MakeEvent());
    this.Go(S(this.AddRowBelow), ACTIONS.addRowBelow.MakeEvent());
    this.Go(S(this.AddColumnBefore), ACTIONS.addColBefore.MakeEvent());
    this.Go(S(this.AddColumnAfter), ACTIONS.addColAfter.MakeEvent());
    this.Go(S(this.DeleteRows), ACTIONS.deleteRows.MakeEvent());
    this.Go(S(this.DeleteColumns), ACTIONS.deleteColumns.MakeEvent());
    this.Go(S(this.MergeCells), ACTIONS.mergeCells.MakeEvent());
    this.Go(S(this.UnmergeCells), ACTIONS.unmergeCells.MakeEvent());
    this.Go(S(this.EditTable), ACTIONS.editTable.MakeEvent());
    this.Go(S(this.ExportTableToCSV), ACTIONS.exportTableCSV.MakeEvent());
  }

  getToolMgr(): TOOL_MANAGER {
    return this.m_toolMgr!;
  }

  getScreen(): unknown {
    return null;
  }

  getTableCellSelection(): SELECTION {
    const selTool = this.m_toolMgr!.GetTool(PCB_SELECTION_TOOL)!;

    return selTool.RequestSelection((_aPt, aCollector) => {
      // Iterate from the back so we don't have to worry about removals.
      for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
        if (!(aCollector.At(i) instanceof PCB_TABLECELL)) aCollector.Remove(aCollector.At(i)!);
      }
    });
  }

  clearSelection(): void {
    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
  }

  copyCell(aSource: PCB_TABLECELL): PCB_TABLECELL {
    // Use copy constructor to copy all formatting properties (font, colors, borders, etc.)
    const cell = PCB_TABLECELL.copyOfCell(aSource);

    // Generate a new UUID to avoid duplicates (copy constructor preserves the old UUID)
    cell.ResetUuidDirect();

    // Clear text content - we only want the formatting, not the content
    cell.SetText('');

    // Position will be set by the caller, but preserve size from source
    cell.SetStart(aSource.GetStart());
    cell.SetEnd(aSource.GetEnd());

    return cell;
  }

  /** `BOARD_COMMIT commit( getToolMgr() )`: ours is built on the tool, whose manager it is. */
  makeCommit(): BOARD_COMMIT {
    return new BOARD_COMMIT(this);
  }

  asTableCell(aItem: EDA_ITEM): PCB_TABLECELL | null {
    return aItem instanceof PCB_TABLECELL ? aItem : null;
  }
}

export interface PCB_EDIT_TABLE_TOOL
  extends EDIT_TABLE_TOOL_BASE<PCB_TABLE, PCB_TABLECELL, BOARD_COMMIT> {}

applyMixins(PCB_EDIT_TABLE_TOOL, [EDIT_TABLE_TOOL_BASE]);
