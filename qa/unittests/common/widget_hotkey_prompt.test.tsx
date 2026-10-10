// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * WIDGET_HOTKEY_LIST's edit path (widget_hotkey_list.cpp): HK_PROMPT_DIALOG in DialogShim, a
 * reserved key refused through DisplayErrorMessage, and a key already in use asked about through
 * KICAD_MESSAGE_DIALOG( …, wxYES_NO | wxNO_DEFAULT ) - kept only on wxID_YES.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type KICAD_MESSAGE_DIALOG_ARG,
  SetErrorPresenter,
  SetMessageDialogPresenter,
} from '@ziroeda/common/confirm.js';
import { resetModalStack } from '@ziroeda/common/dialog_shim.js';
import type { HotkeySection } from '@ziroeda/common/hotkey_store.js';
import { WidgetHotkeyList } from '@ziroeda/common/widgets/widget_hotkey_list.js';
import { wxNO_DEFAULT, wxYES_NO } from '@ziroeda/common/wx/defs.js';
import { wxID_NO, wxID_YES } from '@ziroeda/common/wx/menu.js';

const entry = (name: string, command: string, keys: string) => ({
  name,
  command,
  keys,
  defaultKeys: keys,
  alt: '',
  description: '',
});
const ALL: HotkeySection[] = [
  { name: 'Common', entries: [entry('t.a', 'Alpha', ''), entry('t.b', 'Beta', 'Ctrl+K')] },
];

let asked: KICAD_MESSAGE_DIALOG_ARG[];
let answer: number;
let errors: string[];
beforeEach(() => {
  asked = [];
  errors = [];
  answer = wxID_YES;
  SetMessageDialogPresenter(async (a) => {
    asked.push(a);
    return answer;
  });
  SetErrorPresenter((aText) => {
    errors.push(aText);
  });
});
afterEach(() => {
  cleanup();
  resetModalStack();
});

function openPromptOn(aCommand: string) {
  fireEvent.doubleClick(screen.getByText(aCommand));
  expect(screen.getByRole('dialog', { name: 'Set Hotkey' })).toBeTruthy();
}

describe('HK_PROMPT_DIALOG', () => {
  it('is a DialogShim window that Escape closes without assigning anything', () => {
    const onSet = vi.fn();
    render(<WidgetHotkeyList all={ALL} filter="" onSet={onSet} />);
    openPromptOn('Alpha');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSet).not.toHaveBeenCalled();
  });

  it('a key already in use asks Yes/No with No the default, and keeps it only on Yes', async () => {
    const onSet = vi.fn();
    render(<WidgetHotkeyList all={ALL} filter="" onSet={onSet} />);
    openPromptOn('Alpha');
    answer = wxID_NO;
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    expect(asked.map((a) => [a.caption, a.style])).toEqual([
      ['Hotkey conflict', wxYES_NO | wxNO_DEFAULT],
    ]);
    expect(onSet).not.toHaveBeenCalled();

    openPromptOn('Alpha');
    answer = wxID_YES;
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    expect(onSet).toHaveBeenCalledWith('t.a', 'Ctrl+K');
  });

  it('Clear assigned hotkey assigns none', () => {
    const onSet = vi.fn();
    render(<WidgetHotkeyList all={ALL} filter="" onSet={onSet} />);
    openPromptOn('Beta');
    fireEvent.click(screen.getByRole('button', { name: 'Clear assigned hotkey' }));
    expect(onSet).toHaveBeenCalledWith('t.b', null);
  });
});
