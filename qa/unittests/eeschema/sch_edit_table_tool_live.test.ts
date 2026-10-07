// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_EDIT_TABLE_TOOL (tools/sch_edit_table_tool.cpp) and EDIT_TABLE_TOOL_BASE
 * (include/tool/edit_table_tool_base.h) on the TOOL_MANAGER, against a live SCH_TABLE.
 */
import { resolve } from 'node:path';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { wxFD_OVERWRITE_PROMPT, wxFD_SAVE } from '@ziroeda/common/wx/defs.js';
import { SCH_TABLE } from '@ziroeda/eeschema/sch_table.js';
import { SCH_TABLECELL } from '@ziroeda/eeschema/sch_tablecell.js';
import type { SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];
const G = 50 * 254;
const FAR = 3000 * G;
const P = (x: number, y: number) => ({ x: FAR + x * G, y: FAR + y * G });

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const h = schToolHarness(schFrame(aHooks));
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  h.frame.SetCurrentSheet(
    h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => p.size() === 1)!,
  );
  const mgr = h.frame.GetToolManager()!;
  const sel = mgr.GetTool(SCH_SELECTION_TOOL)!;

  // A 2 x 2 table: columns 10 and 20 grid wide, rows 5 and 7 high, cells A B / C D.
  const table = new SCH_TABLE();
  table.SetColCount(2);
  for (const text of ['A', 'B', 'C', 'D']) {
    const cell = new SCH_TABLECELL();
    cell.SetText(text);
    table.AddCell(cell);
  }
  table.SetColWidth(0, 10 * G);
  table.SetColWidth(1, 20 * G);
  table.SetRowHeight(0, 5 * G);
  table.SetRowHeight(1, 7 * G);
  table.SetPosition(P(0, 0));
  table.Normalize();
  h.frame.AddToScreen(table, h.frame.GetScreen());

  const select = (...items: EDA_ITEM[]) => {
    sel.ClearSelection(true);
    for (const i of items) sel.AddItemToSel(i, true);
  };
  const texts = () => {
    const rows: string[][] = [];
    for (let r = 0; r < table.GetRowCount(); ++r) {
      const row: string[] = [];
      for (let c = 0; c < table.GetColCount(); ++c) row.push(table.GetCell(r, c)!.GetText());
      rows.push(row);
    }
    return rows;
  };
  return { ...h, mgr, sel, table, select, texts };
}

describe('SCH_EDIT_TABLE_TOOL', () => {
  it('adds an empty row below the selection, its height copied down, as one undo step', () => {
    const h = setUp();
    h.select(h.table.GetCell(0, 0)!);
    const undo = h.frame.GetUndoCommandCount();

    h.mgr.RunAction(ACTIONS.addRowBelow);

    expect(h.texts()).toEqual([
      ['A', 'B'],
      ['', ''],
      ['C', 'D'],
    ]);
    expect([0, 1, 2].map((r) => h.table.GetRowHeight(r) / G)).toEqual([5, 5, 7]);
    expect(h.table.GetPosition()).toEqual(P(0, 0));
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('adds a row above the topmost selected cell', () => {
    const h = setUp();
    h.select(h.table.GetCell(1, 1)!, h.table.GetCell(1, 0)!);

    h.mgr.RunAction(ACTIONS.addRowAbove);

    expect(h.texts()).toEqual([
      ['A', 'B'],
      ['', ''],
      ['C', 'D'],
    ]);
    expect([0, 1, 2].map((r) => h.table.GetRowHeight(r) / G)).toEqual([5, 7, 7]);
  });

  it('adds a column before the leftmost and after the rightmost selected cell', () => {
    const h = setUp();
    h.select(h.table.GetCell(0, 1)!);
    h.mgr.RunAction(ACTIONS.addColBefore);
    expect(h.texts()).toEqual([
      ['A', '', 'B'],
      ['C', '', 'D'],
    ]);
    expect([0, 1, 2].map((c) => h.table.GetColWidth(c) / G)).toEqual([10, 20, 20]);

    h.select(h.table.GetCell(0, 0)!);
    h.mgr.RunAction(ACTIONS.addColAfter);
    expect(h.texts()).toEqual([
      ['A', '', '', 'B'],
      ['C', '', '', 'D'],
    ]);
    expect([0, 1, 2, 3].map((c) => h.table.GetColWidth(c) / G)).toEqual([10, 10, 20, 20]);
  });

  it('a new cell is a copy with a fresh uuid and no text', () => {
    const h = setUp();
    h.select(h.table.GetCell(0, 0)!);
    h.mgr.RunAction(ACTIONS.addRowBelow);

    const copy = h.table.GetCell(1, 0)!;
    expect(copy.m_Uuid).not.toBe(h.table.GetCell(0, 0)!.m_Uuid);
    expect(copy.GetText()).toBe('');
  });

  it('deletes the rows and columns holding a selected cell, keeping the rest of the sizes', () => {
    const h = setUp();
    h.select(h.table.GetCell(0, 0)!);
    h.mgr.RunAction(ACTIONS.deleteRows);
    expect(h.texts()).toEqual([['C', 'D']]);
    expect(h.table.GetRowHeight(0) / G).toBe(7);

    h.select(h.table.GetCell(0, 0)!);
    h.mgr.RunAction(ACTIONS.deleteColumns);
    expect(h.texts()).toEqual([['D']]);
    expect(h.table.GetColWidth(0) / G).toBe(20);
  });

  it('deleting every row removes the table', () => {
    const h = setUp();
    h.select(h.table.GetCell(0, 0)!, h.table.GetCell(1, 1)!);
    h.mgr.RunAction(ACTIONS.deleteRows);

    expect([...h.frame.GetScreen()!.Items()].includes(h.table)).toBe(false);
  });

  it('merges a block into its top-left cell, joining the text, and unmerges it again', () => {
    const h = setUp();
    h.select(h.table.GetCell(0, 0)!, h.table.GetCell(0, 1)!);
    h.mgr.RunAction(ACTIONS.mergeCells);

    const topLeft = h.table.GetCell(0, 0)!;
    expect(topLeft.GetColSpan()).toBe(2);
    expect(topLeft.GetRowSpan()).toBe(1);
    expect(topLeft.GetText()).toBe('A\nB');
    expect(h.table.GetCell(0, 1)!.GetText()).toBe('');
    expect(topLeft.GetEnd().x - topLeft.GetStart().x).toBe(30 * G);

    h.select(topLeft);
    h.mgr.RunAction(ACTIONS.unmergeCells);
    expect(topLeft.GetColSpan()).toBe(1);
    expect(h.table.GetCell(0, 1)!.GetColSpan()).toBe(1);
    expect(topLeft.GetEnd().x - topLeft.GetStart().x).toBe(10 * G);
  });

  it('getCellBlockBounds: a block is its bounds, a gap is none; validatePasteIntoSelection says why', () => {
    const h = setUp();
    const tool = h.mgr.FindTool('eeschema.TableEditor') as unknown as {
      getCellBlockBounds(aSel: unknown): number[] | null;
      validatePasteIntoSelection(aSel: unknown): string | null;
    };
    h.select(h.table.GetCell(0, 0)!, h.table.GetCell(1, 0)!);
    expect(tool.getCellBlockBounds(h.sel.GetSelection())).toEqual([0, 1, 0, 2]);
    expect(tool.validatePasteIntoSelection(h.sel.GetSelection())).toBeNull();

    h.select(h.table.GetCell(0, 0)!, h.table.GetCell(1, 1)!);
    expect(tool.getCellBlockBounds(h.sel.GetSelection())).toBeNull();
    expect(tool.validatePasteIntoSelection(h.sel.GetSelection())).toBe(
      'Selected cells must form a contiguous block',
    );
  });

  it('exports the table as CSV, quoting commas and doubling quotes, adding .csv', async () => {
    const written: [string, string][] = [];
    const asked: unknown[][] = [];
    const h = setUp({
      fileDialog: (...args) => {
        asked.push(args);
        return '/proj/table';
      },
      writeTextFile: (aPath, aText) => {
        written.push([aPath, aText]);
        return true;
      },
    });
    h.table.GetCell(0, 1)!.SetText('x,y');
    h.table.GetCell(1, 0)!.SetText('q"r');
    h.select(h.table.GetCell(0, 0)!);

    h.mgr.RunAction(ACTIONS.exportTableCSV);
    await flush();

    expect(asked).toEqual([
      ['Export Table to CSV', '', '', 'CSV files (*.csv)|*.csv', wxFD_SAVE | wxFD_OVERWRITE_PROMPT],
    ]);
    expect(written).toEqual([['/proj/table.csv', 'A,"x,y"\n"q""r",D\n']]);
  });

  it('a cancelled export writes nothing', async () => {
    const written: string[] = [];
    const h = setUp({
      fileDialog: () => null,
      writeTextFile: (aPath) => {
        written.push(aPath);
        return true;
      },
    });
    h.select(h.table.GetCell(0, 0)!);
    h.mgr.RunAction(ACTIONS.exportTableCSV);
    await flush();

    expect(written).toEqual([]);
  });

  it('Edit Table opens DIALOG_TABLE_PROPERTIES on the cells’ table', async () => {
    const opened: [string, readonly EDA_ITEM[]][] = [];
    const h = setUp({
      showModal: (aDialog, aItems) => {
        opened.push([aDialog, aItems]);
        return 0;
      },
    });
    h.select(h.table.GetCell(1, 1)!);
    h.mgr.RunAction(ACTIONS.editTable);
    await flush();

    expect(opened.length).toBe(1);
    expect(opened[0]![0]).toBe('DIALOG_TABLE_PROPERTIES');
    expect(opened[0]![1].length).toBe(1);
    expect(opened[0]![1][0] === h.table).toBe(true);
  });
});
