// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `WX_GRID` (common/widgets/wx_grid.tsx) and `GRID_TRICKS` (common/
 * grid_tricks.ts) over the headless wxGrid. Each expectation is the C++ walked
 * by hand: wx_grid.cpp's CommitPendingChanges / OnDeleteRows / OnMoveRow /
 * ShowHideColumns, and grid_tricks.cpp's getSelectedArea, cutcopy,
 * paste_text (wxTOKEN_RET_EMPTY), toggleCell, the key hooks and the menus.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { GetClipboardText, SaveClipboard } from '@ziroeda/common/clipboard.js';
import {
  GRID_TRICKS,
  GRIDTRICKS_FIRST_SHOWHIDE,
  GRIDTRICKS_ID_CUT,
  GRIDTRICKS_ID_DELETE,
  GRIDTRICKS_ID_PASTE,
} from '@ziroeda/common/grid_tricks.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import {
  wxEVT_GRID_CELL_CHANGED,
  wxEVT_GRID_CELL_CHANGING,
  wxEVT_GRID_CELL_LEFT_CLICK,
  wxEVT_GRID_CELL_RIGHT_CLICK,
  wxEVT_GRID_LABEL_RIGHT_CLICK,
  wxGridCellAttr,
  wxGridCellBoolRenderer,
  wxGridEvent,
  wxGridSelectionModes,
  wxGridStringTable,
} from '@ziroeda/common/wx/grid.js';
import type { wxMenu } from '@ziroeda/common/wx/menu.js';
import {
  WXK,
  wxEVT_CHAR_HOOK,
  wxEVT_KEY_DOWN,
  wxEVT_UPDATE_UI,
  wxKeyEvent,
  wxUpdateUIEvent,
} from '@ziroeda/common/wx/wx_event.js';

/** A 3x3 WX_GRID reading "rc" in each cell, with GRID_TRICKS on it. */
function make(
  aMode = wxGridSelectionModes.wxGridSelectCells,
  aRows = 3,
): { g: WX_GRID; tricks: GRID_TRICKS; added: number[] } {
  const g = new WX_GRID();
  g.SetTable(new wxGridStringTable(aRows, 3), true, aMode);
  for (let r = 0; r < aRows; ++r) for (let c = 0; c < 3; ++c) g.SetCellValue(r, c, `${r}${c}`);
  const added: number[] = [];
  const tricks = new GRID_TRICKS(g, () => {
    g.AppendRows(1);
    added.push(g.GetNumberRows() - 1);
  });
  return { g, tricks, added };
}

/** A key through the hook, then (if the hook skips it) key-down, as wx sends them. */
function key(g: WX_GRID, aCode: number, aCtrl = false, aObject: unknown = null): void {
  const hook = new wxKeyEvent(wxEVT_CHAR_HOOK);
  hook.m_keyCode = aCode;
  hook.state.SetControlDown(aCtrl);
  hook.SetEventObject(aObject);
  if (g.ProcessEvent(hook)) return;

  const down = new wxKeyEvent(wxEVT_KEY_DOWN);
  down.m_keyCode = aCode;
  down.state.SetControlDown(aCtrl);
  g.ProcessEvent(down);
}

const click = (g: WX_GRID, r: number, c: number, type = wxEVT_GRID_CELL_LEFT_CLICK): boolean =>
  g.ProcessEvent(new wxGridEvent(type, g, r, c));

const values = (g: WX_GRID): string[][] =>
  Array.from({ length: g.GetNumberRows() }, (_, r) =>
    Array.from({ length: g.GetNumberCols() }, (_, c) => g.GetCellValue(r, c)),
  );

beforeEach(() => SaveClipboard(''));

describe('GRID_TRICKS cut, copy, paste and delete', () => {
  it('copies the selected block as tab- and newline-separated text', () => {
    const { g } = make();
    g.SelectBlock(0, 0, 1, 1);
    key(g, 'C'.charCodeAt(0), true);
    expect(GetClipboardText()).toBe('00\t01\n10\t11');
  });

  it('copies a hidden column as nothing at all, not even its separator', () => {
    const { g } = make();
    g.HideCol(1);
    g.SelectBlock(0, 0, 0, 2);
    key(g, 'C'.charCodeAt(0), true);
    expect(GetClipboardText()).toBe('00\t02');
  });

  it('copies the cursor cell when nothing is selected', () => {
    const { g } = make();
    g.SetGridCursor(2, 1);
    g.ClearSelection();
    key(g, 'C'.charCodeAt(0), true);
    expect(GetClipboardText()).toBe('21');
  });

  it('cuts: copies, then clears the writable text cells', () => {
    const { g } = make();
    g.SetReadOnly(0, 1);
    g.SelectBlock(0, 0, 0, 1);
    key(g, 'X'.charCodeAt(0), true);
    expect(GetClipboardText()).toBe('00\t01');
    expect(values(g)[0]).toEqual(['', '01', '02']);
  });

  it('deletes with Del, and copies nothing', () => {
    const { g } = make();
    SaveClipboard('untouched');
    g.SelectBlock(1, 1, 2, 1);
    key(g, WXK.WXK_DELETE);
    expect(values(g).map((r) => r[1])).toEqual(['01', '', '']);
    expect(GetClipboardText()).toBe('untouched');
  });

  it('pastes the whole clipboard from the cursor when nothing is selected', () => {
    const { g } = make();
    g.ClearSelection();
    g.SetGridCursor(1, 1);
    SaveClipboard('x\ty\nz');
    key(g, 'V'.charCodeAt(0), true);
    expect(values(g)).toEqual([
      ['00', '01', '02'],
      ['10', 'x', 'y'],
      ['20', 'z', '22'],
    ]);
  });

  it('adds rows through the add handler when the paste runs off the bottom', () => {
    const { g, added } = make();
    g.ClearSelection();
    g.SetGridCursor(2, 0);
    SaveClipboard('p\nq\n');
    key(g, 'V'.charCodeAt(0), true);
    expect(added).toEqual([3]);
    expect([g.GetCellValue(2, 0), g.GetCellValue(3, 0)]).toEqual(['p', 'q']);
  });

  it('fills a selection by repeating the clipboard, skipping read-only cells', () => {
    const { g } = make();
    g.SetReadOnly(1, 2);
    g.SelectBlock(0, 1, 1, 2);
    SaveClipboard('k\tm');
    key(g, 'V'.charCodeAt(0), true);
    expect(values(g)).toEqual([
      ['00', 'k', 'm'],
      ['10', 'k', '12'],
      ['20', '21', '22'],
    ]);
  });

  it('keeps an empty token in the middle (wxTOKEN_RET_EMPTY)', () => {
    const { g } = make();
    g.ClearSelection();
    g.SetGridCursor(0, 0);
    SaveClipboard('a\t\tc');
    key(g, 'V'.charCodeAt(0), true);
    expect(values(g)[0]).toEqual(['a', '', 'c']);
  });

  it('selects all with Ctrl+A', () => {
    const { g } = make();
    key(g, 'A'.charCodeAt(0), true);
    expect(g.GetSelectedRows()).toEqual([0, 1, 2]);
  });
});

describe('GRID_TRICKS keys with the cell editor open', () => {
  it('adds a row with Enter on the last row, and commits there when editing', () => {
    const { g, added } = make();
    g.SetGridCursor(1, 0);
    key(g, WXK.WXK_RETURN);
    expect(added).toEqual([]);
    g.SetGridCursor(2, 0);
    key(g, WXK.WXK_RETURN);
    expect(added).toEqual([3]);

    g.SetGridCursor(3, 0);
    g.EnableCellEditControl();
    g.GetCurrentEditor()!.m_value = 'typed';
    key(g, WXK.WXK_RETURN);
    expect(g.GetCellValue(3, 0)).toBe('typed');
    expect(added).toEqual([3]);
  });

  it('abandons the edit with Escape', () => {
    const { g } = make();
    g.SetGridCursor(1, 1);
    g.EnableCellEditControl();
    g.GetCurrentEditor()!.m_value = 'nope';
    key(g, WXK.WXK_ESCAPE);
    expect(g.IsCellEditControlShown()).toBe(false);
    expect(g.GetCellValue(1, 1)).toBe('11');
  });

  it('pastes a multi-cell clipboard into the editor as one line', () => {
    const { g } = make();
    g.SetGridCursor(0, 0);
    g.EnableCellEditControl();
    SaveClipboard('a\tb\nc');
    let written = '';
    key(g, 'V'.charCodeAt(0), true, {
      GetStringSelection: () => '',
      WriteText: (t: string) => {
        written = t;
      },
      IsEditable: () => true,
    });
    expect(written).toBe('a b c');
  });

  it("copies the editor's selected text, and the cell when there is none", () => {
    const { g } = make();
    g.SetGridCursor(0, 2);
    g.EnableCellEditControl();
    const entry = (sel: string) => ({
      GetStringSelection: () => sel,
      WriteText: () => {},
      IsEditable: () => true,
    });
    key(g, 'C'.charCodeAt(0), true, entry('0'));
    expect(GetClipboardText()).toBe('0');

    key(g, 'C'.charCodeAt(0), true, entry(''));
    expect(GetClipboardText()).toBe('02');
    expect(g.IsCellEditControlShown()).toBe(false);
  });
});

describe('GRID_TRICKS clicks', () => {
  it('opens a text cell on one click (on the mouse-up), not a read-only one', () => {
    const { g } = make();
    g.SelectBlock(0, 0, 2, 2);
    expect(click(g, 1, 2)).toBe(true);
    expect([g.GetGridCursorRow(), g.GetGridCursorCol()]).toEqual([1, 2]);
    expect(g.IsWaitingForSlowClick()).toBe(true);
    // WX_GRID::onGridCellSelect selected the new cursor cell after the clear.
    expect(g.GetSelectionBlockTopLeft().map((c) => [c.GetRow(), c.GetCol()])).toEqual([]);

    const { g: g2 } = make();
    g2.SetReadOnly(1, 1);
    expect(click(g2, 1, 1)).toBe(false);
    expect(g2.IsWaitingForSlowClick()).toBe(false);
  });

  it('toggles a check box on one click and tells the clients', () => {
    const { g } = make();
    const attr = new wxGridCellAttr();
    attr.SetRenderer(new wxGridCellBoolRenderer());
    g.SetColAttr(2, attr);
    g.SetCellValue(0, 2, '');
    const changed: string[] = [];
    g.Connect(wxEVT_GRID_CELL_CHANGED, (e: wxGridEvent) => {
      changed.push(e.GetString());
      e.Skip();
    });

    click(g, 0, 2);
    expect(g.GetCellValue(0, 2)).toBe('1');
    click(g, 0, 2);
    expect(g.GetCellValue(0, 2)).toBe('0');
    expect(changed).toEqual(['1', '0']);
  });

  it('applies a check box click to every selected row', () => {
    const { g } = make(wxGridSelectionModes.wxGridSelectRows);
    const attr = new wxGridCellAttr();
    attr.SetRenderer(new wxGridCellBoolRenderer());
    g.SetColAttr(2, attr);
    for (const r of [0, 1, 2]) g.SetCellValue(r, 2, '0');
    g.SelectBlock(0, 0, 2, 2);

    click(g, 1, 2);
    expect([0, 1, 2].map((r) => g.GetCellValue(r, 2))).toEqual(['1', '1', '1']);
  });

  it('toggles the selected check boxes with space', () => {
    const { g } = make(wxGridSelectionModes.wxGridSelectRows);
    const attr = new wxGridCellAttr();
    attr.SetRenderer(new wxGridCellBoolRenderer());
    g.SetColAttr(0, attr);
    for (const r of [0, 1, 2]) g.SetCellValue(r, 0, '0');
    g.SelectRow(0);
    g.SelectRow(2, true);

    key(g, ' '.charCodeAt(0));
    expect([0, 1, 2].map((r) => g.GetCellValue(r, 0))).toEqual(['1', '0', '1']);
  });
});

describe('GRID_TRICKS menus', () => {
  const menuOf = (g: WX_GRID): { menu: wxMenu | null; pick: (id: number) => void } => {
    const box: { menu: wxMenu | null; pick: (id: number) => void } = { menu: null, pick: () => {} };
    g.SetPopupMenuPresenter((m, onSelect) => {
      box.menu = m;
      box.pick = onSelect;
    });
    return box;
  };

  it('offers a check item per column and hides or shows the one picked', () => {
    const { g } = make();
    g.SetColLabelValue(1, 'Value');
    g.HideCol(2);
    const box = menuOf(g);
    g.ProcessEvent(new wxGridEvent(wxEVT_GRID_LABEL_RIGHT_CLICK, g, -1, 1));

    const items = box.menu!.GetMenuItems().map((i) => [i.GetItemLabelText(), i.IsChecked()]);
    expect(items).toEqual([
      ['A', true],
      ['Value', true],
      ['C', false],
    ]);

    box.pick(GRIDTRICKS_FIRST_SHOWHIDE + 1);
    expect(g.IsColShown(1)).toBe(false);
  });

  it('enables Cut and Delete only over writable cells, Paste only with text to paste', () => {
    const { g } = make();
    g.SetReadOnly(0, 0);
    g.SelectBlock(0, 0, 0, 0);
    const box = menuOf(g);
    SaveClipboard('');
    g.ProcessEvent(new wxGridEvent(wxEVT_GRID_CELL_RIGHT_CLICK, g, 0, 0));
    expect(box.menu!.IsEnabled(GRIDTRICKS_ID_CUT)).toBe(false);
    expect(box.menu!.IsEnabled(GRIDTRICKS_ID_DELETE)).toBe(false);
    expect(box.menu!.IsEnabled(GRIDTRICKS_ID_PASTE)).toBe(true);

    g.SelectBlock(0, 0, 0, 1);
    g.ProcessEvent(new wxGridEvent(wxEVT_GRID_CELL_RIGHT_CLICK, g, 0, 1));
    expect(box.menu!.IsEnabled(GRIDTRICKS_ID_CUT)).toBe(true);

    box.pick(GRIDTRICKS_ID_DELETE);
    expect(values(g)[0]).toEqual(['00', '', '02']);
  });
});

describe('WX_GRID', () => {
  it('commits the open edit, calls the dialog modified, and can be vetoed', () => {
    const { g } = make();
    let modified = 0;
    g.SetModifyHandler(() => modified++);
    g.SetGridCursor(1, 0);
    g.EnableCellEditControl();
    g.GetCurrentEditor()!.m_value = 'new';
    expect(g.CommitPendingChanges()).toBe(true);
    expect([g.GetCellValue(1, 0), modified, g.IsCellEditControlShown()]).toEqual(['new', 1, false]);

    g.Connect(wxEVT_GRID_CELL_CHANGING, (e: wxGridEvent) => e.Veto());
    g.EnableCellEditControl();
    g.GetCurrentEditor()!.m_value = 'vetoed';
    expect(g.CommitPendingChanges()).toBe(false);
    expect(g.GetCellValue(1, 0)).toBe('new');

    // Quiet mode sends nothing, so nothing can veto it.
    g.EnableCellEditControl();
    g.GetCurrentEditor()!.m_value = 'quiet';
    expect(g.CommitPendingChanges(true)).toBe(true);
    expect(g.GetCellValue(1, 0)).toBe('quiet');
  });

  it('cancels the open edit', () => {
    const { g } = make();
    g.EnableCellEditControl();
    g.GetCurrentEditor()!.m_value = 'dropped';
    g.CancelPendingChanges();
    expect(g.GetCellValue(0, 0)).toBe('00');
    expect(g.IsCellEditControlShown()).toBe(false);
  });

  it('deletes the selected rows bottom-up and puts the cursor above the lowest', () => {
    const { g } = make(wxGridSelectionModes.wxGridSelectRows, 5);
    g.SelectRow(1);
    g.SelectRow(3, true);
    const deleted: number[] = [];
    g.OnDeleteRows((row) => {
      deleted.push(row);
      g.DeleteRows(row, 1);
    });
    expect(deleted).toEqual([3, 1]);
    expect(values(g).map((r) => r[0])).toEqual(['00', '20', '40']);
    expect(g.GetGridCursorRow()).toBe(0);
  });

  it('deletes nothing when the filter refuses a row', () => {
    const { g } = make(wxGridSelectionModes.wxGridSelectRows);
    g.SelectRow(0);
    g.SelectRow(1, true);
    const deleted: number[] = [];
    g.OnDeleteRows(
      (row) => row !== 1,
      (row) => deleted.push(row),
    );
    expect(deleted).toEqual([]);
  });

  it('moves a row up and down with the cursor, not past the ends', () => {
    const { g } = make();
    g.SetGridCursor(1, 2);
    expect(g.OnMoveRowUp((row) => g.SwapRows(row, row - 1))).toBe(true);
    expect([values(g)[0]![0], g.GetGridCursorRow(), g.GetGridCursorCol()]).toEqual(['10', 0, 2]);
    expect(g.OnMoveRowUp((row) => g.SwapRows(row, row - 1))).toBe(false);

    g.SetGridCursor(2, 0);
    expect(g.OnMoveRowDown((row) => g.SwapRows(row, row + 1))).toBe(false);
  });

  it('adds a row and opens its editor in the column asked for', () => {
    const { g } = make();
    g.OnAddRow(() => {
      g.AppendRows(1);
      return [3, 1];
    });
    expect([g.GetGridCursorRow(), g.GetGridCursorCol(), g.IsCellEditControlShown()]).toEqual([
      3,
      1,
      true,
    ]);
  });

  it('shows and hides columns from a string, and reports them as one', () => {
    const { g } = make();
    g.ShowHideColumns('0 2 9 x');
    expect(g.GetShownColumns()).toEqual([true, false, true]);
    expect(g.GetShownColumnsAsString()).toBe('0 2');
  });

  it('writes and reads a unit value through the units provider', () => {
    const { g } = make();
    g.SetUnitsProvider(new UNITS_PROVIDER(pcbIUScale, 'mm'));
    g.SetUnitValue(0, 0, 1_500_000);
    expect(g.GetCellValue(0, 0)).toBe('1.5 mm');
    g.SetCellValue(0, 1, '100 mil');
    expect(g.GetUnitValue(0, 1)).toBe(2_540_000);
    g.SetCellValue(0, 2, '');
    expect(g.GetOptionalUnitValue(0, 2)).toBeNull();
  });

  it('keeps the cursor row selected in row mode (onUpdateUI)', () => {
    const { g } = make(wxGridSelectionModes.wxGridSelectRows);
    g.ClearSelection();
    g.SetGridCursor(2, 0);
    g.ClearSelection();
    g.ProcessEvent(new wxUpdateUIEvent(wxEVT_UPDATE_UI));
    expect(g.GetSelectedRows()).toEqual([2]);
  });
});
