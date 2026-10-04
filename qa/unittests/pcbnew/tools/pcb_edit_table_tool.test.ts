// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_EDIT_TABLE_TOOL (`pcbnew/tools/pcb_edit_table_tool.cpp`) over
 * EDIT_TABLE_TOOL_BASE (`include/tool/edit_table_tool_base.h`): rows and
 * columns added beside the selection, deleted with it, cells merged into the
 * block's top-left and back, the CSV export, each one undo step.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { PCB_TABLE } from '@ziroeda/pcbnew/pcb_table.js';
import { PCB_TABLECELL } from '@ziroeda/pcbnew/pcb_tablecell.js';
import { PCB_EDIT_TABLE_TOOL } from '@ziroeda/pcbnew/tools/pcb_edit_table_tool.js';
import { PCB_SELECTION_TOOL } from '@ziroeda/pcbnew/tools/pcb_selection_tool.js';
import { type TOOL_HARNESS, toolHarness } from '../support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = 1e6;

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user))
  (setup)
  (net 0 "")
)`;

let written: [string, string][] = [];
let editedTables: PCB_TABLE[] = [];

class TABLE_FRAME extends TEST_PCB_FRAME {
  override ShowTablePropertiesDialog(aTable: PCB_TABLE): Promise<boolean> {
    editedTables.push(aTable);
    return Promise.resolve(true);
  }
  ShowSaveFileDialog(): Promise<{ path: string; checked: boolean }> {
    return Promise.resolve({ path: 'out/table', checked: false });
  }
  WriteTextFile(aPath: string, aText: string): boolean {
    written.push([aPath, aText]);
    return true;
  }
}

let h: TOOL_HARNESS<TEST_PCB_FRAME>;
let table: PCB_TABLE;

/** A `cols` x `rows` table at (10, 10) mm, 10 x 5 mm cells, texts "r,c", as DrawTable builds one. */
function addTable(aCols: number, aRows: number): PCB_TABLE {
  const t = new PCB_TABLE(h.board, 0.1 * MM);
  t.SetLayer(PCB_LAYER_ID.F_SilkS);
  t.SetColCount(aCols);

  for (let c = 0; c < aCols; ++c) t.SetColWidth(c, 10 * MM);

  for (let r = 0; r < aRows; ++r) {
    t.SetRowHeight(r, 5 * MM);

    for (let c = 0; c < aCols; ++c) {
      const cell = new PCB_TABLECELL(t);
      cell.SetPosition({ x: (10 + c * 10) * MM, y: (10 + r * 5) * MM });
      cell.SetEnd({ x: (20 + c * 10) * MM, y: (15 + r * 5) * MM });
      cell.SetText(`${r},${c}`);
      t.AddCell(cell);
    }
  }

  t.Normalize();
  h.board.Add(t);
  return t;
}

const sel = (): PCB_SELECTION_TOOL => h.mgr.GetTool(PCB_SELECTION_TOOL)!;
const select = (...aCells: [number, number][]): void => {
  for (const [r, c] of aCells) sel().AddItemToSel(table.GetCell(r, c)!, true);
};
const texts = (): string[][] => {
  const out: string[][] = [];

  for (let r = 0; r < table.GetRowCount(); ++r) {
    const row: string[] = [];

    for (let c = 0; c < table.GetColCount(); ++c) row.push(table.GetCell(r, c)!.GetText());

    out.push(row);
  }

  return out;
};

beforeEach(() => {
  written = [];
  editedTables = [];
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new TABLE_FRAME(aBoard),
    () => [new PCB_EDIT_TABLE_TOOL()],
  );
  h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
  table = addTable(2, 2);
});

describe('adding rows and columns', () => {
  it('a row above the topmost selected cell, empty, its height copied from the row it pushes down', () => {
    table.SetRowHeight(1, 7 * MM);
    table.Normalize();
    select([1, 0], [1, 1]);
    h.mgr.RunAction(ACTIONS.addRowAbove);

    expect(texts()).toEqual([
      ['0,0', '0,1'],
      ['', ''],
      ['1,0', '1,1'],
    ]);
    // afterRow > row: the new row 1 keeps row 1's old height, the old row 1 moves to 2.
    expect([table.GetRowHeight(0), table.GetRowHeight(1), table.GetRowHeight(2)]).toEqual([
      5 * MM,
      7 * MM,
      7 * MM,
    ]);
    expect(table.GetPosition()).toEqual({ x: 10 * MM, y: 10 * MM });
  });

  it('a row below the bottommost selected cell', () => {
    select([0, 1]);
    h.mgr.RunAction(ACTIONS.addRowBelow);

    expect(texts()).toEqual([
      ['0,0', '0,1'],
      ['', ''],
      ['1,0', '1,1'],
    ]);
  });

  it('columns before the leftmost and after the rightmost', () => {
    select([0, 1]);
    h.mgr.RunAction(ACTIONS.addColBefore);
    expect(texts()).toEqual([
      ['0,0', '', '0,1'],
      ['1,0', '', '1,1'],
    ]);

    sel().ClearSelection();
    select([0, 0]);
    h.mgr.RunAction(ACTIONS.addColAfter);
    expect(texts()).toEqual([
      ['0,0', '', '', '0,1'],
      ['1,0', '', '', '1,1'],
    ]);
  });

  it('a new cell is a fresh item, not the source cell again', () => {
    select([0, 0]);
    h.mgr.RunAction(ACTIONS.addRowAbove);

    const uuids = table.GetCells().map((c) => c.m_Uuid);
    expect(new Set(uuids).size).toBe(uuids.length);
  });
});

describe('deleting', () => {
  it('a row with a selected cell goes; the others keep their heights', () => {
    table.SetRowHeight(1, 7 * MM);
    table.Normalize();
    select([0, 1]);
    h.mgr.RunAction(ACTIONS.deleteRows);

    expect(texts()).toEqual([['1,0', '1,1']]);
    expect(table.GetRowHeight(0)).toBe(7 * MM);
  });

  it('a column with a selected cell goes', () => {
    select([1, 0]);
    h.mgr.RunAction(ACTIONS.deleteColumns);

    expect(texts()).toEqual([['0,1'], ['1,1']]);
  });

  it('deleting every row removes the table', () => {
    select([0, 0], [1, 0]);
    h.mgr.RunAction(ACTIONS.deleteRows);

    expect(h.board.Drawings()).not.toContain(table);
  });
});

describe('merging', () => {
  it('merges the block into its top-left, texts joined by newlines, the rest emptied', () => {
    select([0, 0], [1, 1]);
    h.mgr.RunAction(ACTIONS.mergeCells);

    const tl = table.GetCell(0, 0)!;
    expect([tl.GetColSpan(), tl.GetRowSpan()]).toEqual([2, 2]);
    expect(tl.GetText()).toBe('0,0\n0,1\n1,0\n1,1');
    expect(table.GetCell(1, 1)!.GetText()).toBe('');
    expect(table.GetCell(1, 1)!.GetColSpan()).toBe(0);
    expect(tl.GetEnd()).toEqual({ x: 30 * MM, y: 20 * MM });
  });

  it('unmerging hands every cell its span of one back', () => {
    select([0, 0], [1, 1]);
    h.mgr.RunAction(ACTIONS.mergeCells);
    sel().ClearSelection();
    select([0, 0]);
    h.mgr.RunAction(ACTIONS.unmergeCells);

    for (const c of table.GetCells()) expect([c.GetColSpan(), c.GetRowSpan()]).toEqual([1, 1]);
  });

  it('getCellBlockBounds: a contiguous block, or null for an L-shape', () => {
    const t = h.mgr.GetTool(PCB_EDIT_TABLE_TOOL)!;
    select([0, 0], [0, 1]);
    expect(t.getCellBlockBounds(sel().GetSelection())).toEqual({
      colMin: 0,
      colMax: 2,
      rowMin: 0,
      rowMax: 1,
    });
    select([1, 0]);
    expect(t.getCellBlockBounds(sel().GetSelection())).toBeNull();
  });
});

describe('Edit Table... and Export to CSV', () => {
  it("Edit Table opens the dialog on the cells' table", async () => {
    select([0, 0]);
    h.mgr.RunAction(ACTIONS.editTable);
    await new Promise((r) => setTimeout(r, 0));

    expect(editedTables).toEqual([table]);
  });

  it('writes one line per row, the .csv extension added, fields with commas or quotes quoted', async () => {
    table.GetCell(0, 1)!.SetText('a,b');
    table.GetCell(1, 0)!.SetText('say "hi"');
    select([0, 0]);
    h.mgr.RunAction(ACTIONS.exportTableCSV);
    await new Promise((r) => setTimeout(r, 0));

    // "0,0" holds a comma, so it is quoted too.
    expect(written).toEqual([['out/table.csv', '"0,0","a,b"\n"say ""hi""","1,1"\n']]);
  });
});

describe('undo', () => {
  it('each edit is one undo step', () => {
    select([0, 0]);
    h.mgr.RunAction(ACTIONS.addRowAbove);
    expect(table.GetRowCount()).toBe(3);

    h.frame.RestoreCopyFromUndoList();
    const restored = h.board.Drawings().find((d) => d instanceof PCB_TABLE) as PCB_TABLE;
    expect(restored.GetRowCount()).toBe(2);
  });
});
