// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Typing into a wxGrid that sits in a dialog, the way the Symbol Fields Table is used.
 *
 * Three things the blinky555 build hit there (2026-11-18), each against what wx does:
 *  - a click opens the cell editor with the whole value selected
 *    (`wxGridCellTextEditor::DoBeginEdit`: SetValue, SetInsertionPointEnd, SelectAll),
 *    so typing replaces the cell - ours put the caret at the end and appended;
 *  - a letter typed on a selected cell opens the editor holding that letter
 *    (`StartingKey`) - ours lost every letter the app has a hotkey for, because the
 *    browser suppressor marks those keys and the dialog read the mark as "handled";
 *  - Escape in an open cell editor cancels the edit (GRID_TRICKS::onCharHook) and leaves
 *    the dialog up - ours closed the dialog.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimBrowserHotkeys } from '@ziroeda/common/browser_hotkeys.js';
import { GRID_TRICKS } from '@ziroeda/common/grid_tricks.js';
import { WX_GRID } from '@ziroeda/common/widgets/wx_grid.js';
import { Dialog } from '@ziroeda/wx/dialog.js';
import { wxGridSelectionModes, wxGridStringTable } from '@ziroeda/wx/grid.js';
import { WxGridView } from '@ziroeda/wx/grid_ui.js';

let release: (() => void) | null = null;

afterEach(() => {
  release?.();
  release = null;
  cleanup();
});

function setup(aOnClose = (): void => {}) {
  const g = new WX_GRID();
  g.SetTable(new wxGridStringTable(3, 2), true, wxGridSelectionModes.wxGridSelectCells);
  g.SetCellValue(0, 1, '680nF');
  g.SetCellValue(1, 1, 'IN');
  const tricks = new GRID_TRICKS(g, () => g.AppendRows(1));
  const view = render(
    <Dialog title="Symbol Fields Table" onClose={aOnClose}>
      <WxGridView grid={g} tricks={tricks} ariaLabel="fields" />
    </Dialog>,
  );
  const cell = (r: number, c: number): HTMLElement =>
    view.container.ownerDocument.querySelector(`td[data-row="${r}"][data-col="${c}"]`)!;
  const editorIn = (r: number, c: number): HTMLInputElement | null =>
    cell(r, c).querySelector('input');
  return { g, cell, editorIn, table: screen.getByLabelText('fields') };
}

describe('a grid cell editor in a dialog', () => {
  it('opened by a click, holds the whole value selected, so typing replaces it', () => {
    const { cell, editorIn } = setup();
    fireEvent.mouseDown(cell(0, 1), { button: 0 });
    fireEvent.mouseUp(cell(0, 1));
    const input = editorIn(0, 1)!;
    expect(input.value).toBe('680nF');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
  });

  it('a click inside the open editor keeps it open, to place the caret (Sentry 1Z session)', () => {
    // The user's breadcrumbs: click after click on a Fields value. The first opened the editor
    // with its value selected; the next, meant to put the caret in it, closed it again.
    const { cell, editorIn } = setup();
    fireEvent.mouseDown(cell(0, 1), { button: 0 });
    fireEvent.mouseUp(cell(0, 1));
    const input = editorIn(0, 1)!;
    fireEvent.mouseDown(input, { button: 0 });
    fireEvent.mouseUp(input);
    fireEvent.click(input);
    expect(editorIn(0, 1)).toBe(input);
    expect(document.activeElement).toBe(input);
  });

  it('opened by a typed letter, holds that letter with the caret after it', () => {
    const { g, table, editorIn } = setup();
    act(() => g.SetGridCursor(1, 1));
    fireEvent.keyDown(table, { key: 'q', code: 'KeyQ' });
    const input = editorIn(1, 1)!;
    expect(input.value).toBe('q');
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 1]);
  });

  it('a click after a typed-key edit selects again: the editor is shared, the start is per edit', () => {
    const { g, table, cell, editorIn } = setup();
    act(() => g.SetGridCursor(1, 1));
    fireEvent.keyDown(table, { key: 'q', code: 'KeyQ' });
    fireEvent.keyDown(editorIn(1, 1)!, { key: 'Enter', code: 'Enter' });
    expect(g.GetCellValue(1, 1)).toBe('q');

    fireEvent.mouseDown(cell(0, 1), { button: 0 });
    fireEvent.mouseUp(cell(0, 1));
    const input = editorIn(0, 1)!;
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
  });

  it('gets a letter the app claims as a hotkey (R is rotate) - the browser suppression is not "handled"', () => {
    release = claimBrowserHotkeys(['R', 'Shift+R', 'X']).release;
    const { g, table, editorIn } = setup();
    act(() => g.SetGridCursor(1, 1));
    fireEvent.keyDown(table, { key: 'R', code: 'KeyR', shiftKey: true });
    expect(editorIn(1, 1)?.value).toBe('R');
  });

  it('Escape in an open cell editor cancels the edit and leaves the dialog up', () => {
    const onClose = vi.fn();
    const { g, cell, editorIn } = setup(onClose);
    fireEvent.mouseDown(cell(0, 1), { button: 0 });
    fireEvent.mouseUp(cell(0, 1));
    fireEvent.change(editorIn(0, 1)!, { target: { value: 'typed' } });
    fireEvent.keyDown(editorIn(0, 1)!, { key: 'Escape', code: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(editorIn(0, 1)).toBeNull();
    expect(g.GetCellValue(0, 1)).toBe('680nF');

    // ...and with no editor open, Escape is the dialog's again.
    fireEvent.keyDown(screen.getByLabelText('fields'), { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
