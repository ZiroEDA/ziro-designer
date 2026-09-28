// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `common/wx/grid_ui.tsx`, the page's wxGrid window, over a WX_GRID with
 * GRID_TRICKS: the page's clicks and keys reach the model the way wxGTK's
 * do, and the model's state is what the table draws.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GetClipboardText, SaveClipboard } from '@ziroeda/common/clipboard.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { wxGridSelectionModes, wxGridStringTable } from '@ziroeda/common/wx/grid.js';
import { WxGridView } from '@ziroeda/common/wx/grid_ui.js';

afterEach(cleanup);

function setup(aMode = wxGridSelectionModes.wxGridSelectCells) {
  const g = new WX_GRID();
  g.SetTable(new wxGridStringTable(3, 2), true, aMode);
  g.SetColLabelValue(0, 'Name');
  g.SetColLabelValue(1, 'Value');
  for (let r = 0; r < 3; ++r) for (let c = 0; c < 2; ++c) g.SetCellValue(r, c, `${r}${c}`);
  const tricks = new GRID_TRICKS(g, () => g.AppendRows(1));
  const view = render(<WxGridView grid={g} tricks={tricks} ariaLabel="grid" />);
  const cell = (r: number, c: number): HTMLElement =>
    view.container.querySelector(`td[data-row="${r}"][data-col="${c}"]`)!;
  return { g, view, cell, table: screen.getByLabelText('grid') };
}

describe('the grid window', () => {
  it('draws the labels and the values, and a filler past the last column', () => {
    const { view } = setup();
    expect([...view.container.querySelectorAll('th')].map((t) => t.textContent)).toEqual([
      'Name',
      'Value',
      '',
    ]);
    expect(view.container.querySelectorAll('tbody tr').length).toBe(3);
    expect(view.container.querySelector('th.ze-grid-filler')).not.toBeNull();
  });

  it('opens the editor on a click, when the button comes up', () => {
    const { g, cell } = setup();
    fireEvent.mouseDown(cell(1, 1), { button: 0 });
    expect([g.GetGridCursorRow(), g.GetGridCursorCol()]).toEqual([1, 1]);
    expect(cell(1, 1).querySelector('input')).toBeNull();

    fireEvent.mouseUp(cell(1, 1));
    const input = cell(1, 1).querySelector('input')!;
    expect(input.value).toBe('11');
  });

  it('commits with Enter and moves down, abandons with Escape', () => {
    const { g, cell } = setup();
    fireEvent.mouseDown(cell(0, 1), { button: 0 });
    fireEvent.mouseUp(cell(0, 1));
    const input = cell(0, 1).querySelector('input')!;
    fireEvent.change(input, { target: { value: 'typed' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(g.GetCellValue(0, 1)).toBe('typed');
    expect([g.GetGridCursorRow(), g.GetGridCursorCol()]).toEqual([1, 1]);

    fireEvent.mouseDown(cell(2, 0), { button: 0 });
    fireEvent.mouseUp(cell(2, 0));
    const input2 = cell(2, 0).querySelector('input')!;
    fireEvent.change(input2, { target: { value: 'nope' } });
    fireEvent.keyDown(input2, { key: 'Escape', code: 'Escape' });
    expect(g.GetCellValue(2, 0)).toBe('20');
    expect(cell(2, 0).querySelector('input')).toBeNull();
  });

  it('moves the cursor with the arrow keys and starts an edit from a typed key', () => {
    const { g, table, cell } = setup();
    act(() => g.SetGridCursor(0, 0));
    fireEvent.keyDown(table, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(table, { key: 'ArrowRight', code: 'ArrowRight' });
    expect([g.GetGridCursorRow(), g.GetGridCursorCol()]).toEqual([1, 1]);

    fireEvent.keyDown(table, { key: 'x', code: 'KeyX' });
    expect(cell(1, 1).querySelector('input')!.value).toBe('x');
  });

  it('copies the selection with Ctrl+C', () => {
    const { g, table } = setup();
    SaveClipboard('');
    act(() => g.SelectBlock(0, 0, 1, 1));
    fireEvent.keyDown(table, { key: 'c', code: 'KeyC', ctrlKey: true });
    expect(GetClipboardText()).toBe('00\t01\n10\t11');
  });

  it('pops up the cell menu on a right click and runs the item picked', () => {
    const { g, cell } = setup();
    act(() => g.SelectBlock(0, 0, 0, 1));
    fireEvent.contextMenu(cell(0, 0));
    fireEvent.click(screen.getByText('Delete'));
    expect([g.GetCellValue(0, 0), g.GetCellValue(0, 1)]).toEqual(['', '']);
  });

  it('hides a column from the label menu', () => {
    const { g, view } = setup();
    fireEvent.contextMenu(view.container.querySelectorAll('th')[1]!);
    const items = screen.getAllByText('Value');
    fireEvent.click(items[items.length - 1]!);
    expect(g.IsColShown(1)).toBe(false);
    expect([...view.container.querySelectorAll('th')].map((t) => t.textContent)).toEqual([
      'Name',
      '',
    ]);
  });

  it("fills the cursor's row in row mode (GRID_TRICKS::onUpdateUI keeps it selected)", () => {
    const { g, view } = setup(wxGridSelectionModes.wxGridSelectRows);
    act(() => {
      g.ClearSelection();
      g.SetGridCursor(2, 0);
    });
    const rows = [...view.container.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.classList.contains('selected'))).toEqual([false, false, true]);
  });
});
