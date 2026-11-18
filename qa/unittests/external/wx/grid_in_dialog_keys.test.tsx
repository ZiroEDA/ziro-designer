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
import { claimBrowserHotkeys, type FocusLike } from '@ziroeda/common/browser_hotkeys.js';
import { frameKeyBlocked, type HotkeyEvent } from '@ziroeda/common/tool/action_menu_hotkeys.js';
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

describe('a key in a modal dialog stays in it', () => {
  // KiCad: while a modal dialog is up the frame behind sees no key. The editor listens on the
  // window; a Shift+N pressed on the Label dialog's checkbox changed the schematic grid behind it
  // (uartbridge build, U-7) once the dialog let claimed keys through to its controls.
  const frameSees = (aModeless: boolean, aKey: { key: string; shiftKey?: boolean }) => {
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    release = claimBrowserHotkeys(['Shift+N', 'N']).release;
    try {
      render(
        <Dialog title="Label Properties" onClose={() => {}} modeless={aModeless}>
          <input type="checkbox" aria-label="Bold" />
        </Dialog>,
      );
      fireEvent.keyDown(screen.getByLabelText('Bold'), aKey);
    } finally {
      window.removeEventListener('keydown', seen);
      release?.();
      release = null;
      cleanup();
    }
    return seen.mock.calls.length > 0;
  };

  it('never reaches the frame behind a modal one, claimed hotkey or not', () => {
    expect(frameSees(false, { key: 'N', shiftKey: true })).toBe(false);
    expect(frameSees(false, { key: 'q' })).toBe(false);
  });

  it('a modeless dialog leaves the frame its keys', () => {
    expect(frameSees(true, { key: 'N', shiftKey: true })).toBe(true);
  });
});

describe("the frame's own keys while a modal is up", () => {
  // The other half of U-10: the Fields Table's focus went to the canvas with a cross-probe, so the
  // keys came from the canvas, never passed the dialog, and ran schematic tools behind it. KiCad's
  // frame is disabled behind a modal; frameKeyBlocked is what each editor's key handler asks first.
  it('stand down while a modal is open, and come back when it closes', () => {
    const canvas = { tagName: 'CANVAS' } as unknown as FocusLike;
    expect(frameKeyBlocked(canvas, { key: 'N', shiftKey: true } as HotkeyEvent)).toBe(false);
    const view = render(
      <Dialog title="Symbol Fields Table" onClose={() => {}}>
        <span />
      </Dialog>,
    );
    expect(frameKeyBlocked(canvas, { key: 'N', shiftKey: true } as HotkeyEvent)).toBe(true);
    view.unmount();
    expect(frameKeyBlocked(canvas, { key: 'N', shiftKey: true } as HotkeyEvent)).toBe(false);
  });

  it('a modeless dialog leaves them on', () => {
    const canvas = { tagName: 'CANVAS' } as unknown as FocusLike;
    render(
      <Dialog title="Find" onClose={() => {}} modeless>
        <span />
      </Dialog>,
    );
    expect(frameKeyBlocked(canvas, { key: 'N', shiftKey: true } as HotkeyEvent)).toBe(false);
  });
});
