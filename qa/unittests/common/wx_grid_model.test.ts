// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `common/wx/grid.ts`, the headless wxGrid. The selection is checked line for
 * line against `grid_selection_oracle.txt`, which `qa/probes/
 * grid_selection_probe.cpp` printed from wxGTK 3.2.4 itself; the replay below
 * performs the same steps in the same order. The cursor and the cell-editor
 * lifecycle follow grid.cpp's SetCurrentCell / DoSaveEditControlValue.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  wxEVT_GRID_CELL_CHANGED,
  wxEVT_GRID_CELL_CHANGING,
  wxEVT_GRID_EDITOR_HIDDEN,
  wxEVT_GRID_EDITOR_SHOWN,
  wxEVT_GRID_SELECT_CELL,
  wxGrid,
  type wxGridEvent,
  wxGridSelectionModes,
} from '@ziroeda/common/wx/grid.js';

const ORACLE = readFileSync(
  fileURLToPath(new URL('./grid_selection_oracle.txt', import.meta.url)),
  'utf8',
)
  .split('\n')
  .filter((l) => l !== '' && !l.startsWith('#'));

/** The probe's `dump`. */
function dump(g: wxGrid, aTag: string): string {
  const cells = (a: { GetRow(): number; GetCol(): number }[]): string =>
    a.map((c) => `${c.GetRow()}:${c.GetCol()},`).join('');
  return (
    `${aTag}|rows=${g
      .GetSelectedRows()
      .map((r) => `${r},`)
      .join('')} cols=${g
      .GetSelectedCols()
      .map((c) => `${c},`)
      .join('')} cells=${cells(g.GetSelectedCells())} tl=${cells(g.GetSelectionBlockTopLeft())}` +
    ` br=${cells(g.GetSelectionBlockBottomRight())} cursor=${g.GetGridCursorRow()}:${g.GetGridCursorCol()}` +
    ` sel22=${g.IsInSelection(2, 2) ? 1 : 0} any=${g.IsSelection() ? 1 : 0}`
  );
}

describe('wxGrid selection, as wxGTK 3.2.4 answers it', () => {
  const ours: string[] = [];
  const g = new wxGrid();
  g.CreateGrid(5, 4);

  const MODES: [string, wxGridSelectionModes][] = [
    ['cells', wxGridSelectionModes.wxGridSelectCells],
    ['rows', wxGridSelectionModes.wxGridSelectRows],
    ['cols', wxGridSelectionModes.wxGridSelectColumns],
    ['rowsorcols', wxGridSelectionModes.wxGridSelectRowsOrColumns],
  ];

  for (const [name, mode] of MODES) {
    g.SetSelectionMode(mode);
    ours.push(`== ${name} mode=${g.GetSelectionMode()}`);

    const step = (aTag: string, aDo: () => void): void => {
      g.ClearSelection();
      g.SetGridCursor(0, 0);
      aDo();
      ours.push(dump(g, aTag));
    };

    step('none', () => {});
    step('cursor13', () => g.SetGridCursor(1, 3));
    step('row2', () => g.SelectRow(2));
    step('row2+row4', () => {
      g.SelectRow(2);
      g.SelectRow(4, true);
    });
    step('row2 then row4', () => {
      g.SelectRow(2);
      g.SelectRow(4);
    });
    step('col1', () => g.SelectCol(1));
    step('col1+col3', () => {
      g.SelectCol(1);
      g.SelectCol(3, true);
    });
    step('block1122', () => g.SelectBlock(1, 1, 2, 2));
    step('block2211', () => g.SelectBlock(2, 2, 1, 1));
    step('block+block', () => {
      g.SelectBlock(0, 0, 0, 1);
      g.SelectBlock(3, 2, 4, 3, true);
    });
    step('blockfullrow', () => g.SelectBlock(1, 0, 1, 3));
    step('blockfullcol', () => g.SelectBlock(0, 2, 4, 2));
    step('all', () => g.SelectAll());
    step('row2 deselect', () => {
      g.SelectRow(2);
      g.DeselectRow(2);
    });
    step('all deselectcell', () => {
      g.SelectAll();
      g.DeselectCell(2, 2);
    });
  }

  it.each(ORACLE.map((line, i) => [i, line] as const))('line %i', (i, line) => {
    expect(ours[i]).toBe(line);
  });

  it('replays every line and no more', () => {
    expect(ours.length).toBe(ORACLE.length);
  });
});

describe('wxGrid rows coming and going (Redimension, UpdateRows)', () => {
  it('puts the cursor on 0,0 once the grid has cells, and clamps it after a delete', () => {
    const g = new wxGrid();
    g.CreateGrid(0, 3);
    expect(g.GetGridCursorRow()).toBe(-1);

    g.AppendRows(4);
    expect([g.GetGridCursorRow(), g.GetGridCursorCol()]).toEqual([0, 0]);

    g.SetGridCursor(3, 2);
    g.DeleteRows(2, 2);
    expect([g.GetGridCursorRow(), g.GetGridCursorCol()]).toEqual([1, 2]);

    g.DeleteRows(0, 2);
    expect(g.GetGridCursorRow()).toBe(-1);
  });

  it('shifts a selection below an insert, and drops one a delete swallows', () => {
    const g = new wxGrid();
    g.CreateGrid(6, 2, wxGridSelectionModes.wxGridSelectRows);
    g.SelectRow(3);
    g.InsertRows(1, 2);
    expect(g.GetSelectedRows()).toEqual([5]);

    g.DeleteRows(4, 3);
    expect(g.GetSelectedRows()).toEqual([]);
    expect(g.GetSelectionBlockTopLeft()).toEqual([]);
  });

  it('lists selected rows sorted, whatever order they were added in', () => {
    const g = new wxGrid();
    g.CreateGrid(6, 2, wxGridSelectionModes.wxGridSelectRows);
    g.SelectRow(4);
    g.SelectRow(1, true);
    expect(g.GetSelectedRows()).toEqual([1, 4]);
  });
});

describe('the cell editor (DoEnableCellEditControl / DoSaveEditControlValue)', () => {
  const setup = (): { g: wxGrid; log: string[] } => {
    const g = new wxGrid();
    g.CreateGrid(2, 2);
    g.SetCellValue(0, 0, 'old');
    const log: string[] = [];
    for (const [name, type] of [
      ['shown', wxEVT_GRID_EDITOR_SHOWN],
      ['hidden', wxEVT_GRID_EDITOR_HIDDEN],
      ['changing', wxEVT_GRID_CELL_CHANGING],
      ['changed', wxEVT_GRID_CELL_CHANGED],
    ] as const)
      g.Connect(type, (e: wxGridEvent) => {
        log.push(`${name}:${e.GetString()}`);
        e.Skip();
      });
    return { g, log };
  };

  it('applies an edit on accept: CHANGING carries the new value, CHANGED the old', () => {
    const { g, log } = setup();
    g.EnableCellEditControl();
    expect(g.IsCellEditControlShown()).toBe(true);

    g.GetCurrentEditor()!.m_value = 'new';
    g.DisableCellEditControl();

    expect(g.GetCellValue(0, 0)).toBe('new');
    expect(log).toEqual(['shown:', 'hidden:', 'changing:new', 'changed:old']);
    expect(g.IsCellEditControlShown()).toBe(false);
  });

  it('sends no change when the value did not change', () => {
    const { g, log } = setup();
    g.EnableCellEditControl();
    g.DisableCellEditControl();
    expect(log).toEqual(['shown:', 'hidden:']);
  });

  it('keeps the old value when CHANGING is vetoed, and puts it back when CHANGED is', () => {
    for (const type of [wxEVT_GRID_CELL_CHANGING, wxEVT_GRID_CELL_CHANGED]) {
      const { g } = setup();
      g.Connect(type, (e: wxGridEvent) => e.Veto());
      g.EnableCellEditControl();
      g.GetCurrentEditor()!.m_value = 'new';
      g.DisableCellEditControl();
      expect(g.GetCellValue(0, 0)).toBe('old');
    }
  });

  it('accepts the edit when the cursor moves, unless SELECT_CELL vetoes the move', () => {
    const { g } = setup();
    g.EnableCellEditControl();
    g.GetCurrentEditor()!.m_value = 'moved';
    g.SetGridCursor(1, 1);
    expect(g.GetCellValue(0, 0)).toBe('moved');

    g.Connect(wxEVT_GRID_SELECT_CELL, (e: wxGridEvent) => e.Veto());
    g.SetGridCursor(0, 1);
    expect([g.GetGridCursorRow(), g.GetGridCursorCol()]).toEqual([1, 1]);
  });

  it('does not open on a read-only cell or a grid that is not editable', () => {
    const { g } = setup();
    g.SetReadOnly(0, 0);
    g.EnableCellEditControl();
    expect(g.IsCellEditControlShown()).toBe(false);

    g.SetGridCursor(1, 1);
    g.EnableEditing(false);
    g.EnableCellEditControl();
    expect(g.IsCellEditControlShown()).toBe(false);
  });

  it('does not open when EDITOR_SHOWN is vetoed', () => {
    const { g } = setup();
    g.Connect(wxEVT_GRID_EDITOR_SHOWN, (e: wxGridEvent) => e.Veto());
    g.EnableCellEditControl();
    expect(g.IsCellEditControlShown()).toBe(false);
  });
});

describe('the type registry', () => {
  it('shares one editor per type, so the edit is there when a cell is asked again', () => {
    const g = new wxGrid();
    g.CreateGrid(2, 2);
    expect(g.GetCellEditor(0, 0)).toBe(g.GetCellEditor(1, 1));

    g.EnableCellEditControl();
    g.GetCurrentEditor()!.m_value = 'typed';
    expect(g.GetCellEditor(0, 0).m_value).toBe('typed');
  });
});

describe('columns and labels', () => {
  it('hides and shows a column, and labels columns A, B, … Z, AA', () => {
    const g = new wxGrid();
    g.CreateGrid(1, 28);
    g.HideCol(1);
    expect([g.IsColShown(0), g.IsColShown(1)]).toEqual([true, false]);
    g.ShowCol(1);
    expect(g.IsColShown(1)).toBe(true);
    expect([0, 25, 26, 27].map((c) => g.GetColLabelValue(c))).toEqual(['A', 'Z', 'AA', 'AB']);
    g.SetColLabelValue(0, 'Name');
    expect(g.GetColLabelValue(0)).toBe('Name');
  });
});
