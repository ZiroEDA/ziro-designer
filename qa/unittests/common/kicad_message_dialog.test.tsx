// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * KICAD_MESSAGE_DIALOG (confirm.h, the native message box on GTK): the style word picks one button
 * or two, SetOKCancelLabels names them, wxCANCEL_DEFAULT moves the default, and ShowModal answers
 * wxID_OK / wxID_CANCEL.
 */
import { ShowKicadMessageDialog } from '@ziroeda/common/confirm.js';
import { InstallMessageDialogPresenter } from '@ziroeda/common/confirm_ui.js';
import { wxCANCEL, wxCANCEL_DEFAULT, wxICON_QUESTION, wxOK } from '@ziroeda/common/wx/defs.js';
import { wxID_CANCEL, wxID_OK } from '@ziroeda/common/wx/menu.js';
import { act } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => InstallMessageDialogPresenter());
afterEach(() => {
  document.body.innerHTML = '';
});

const buttons = () => [...document.querySelectorAll('button')] as HTMLButtonElement[];
const flush = () => act(async () => {});

describe('ShowKicadMessageDialog', () => {
  it('an OK-only box has one button and answers wxID_OK', async () => {
    const answer = ShowKicadMessageDialog({ message: 'Done.', caption: 'Rescue', style: wxOK });
    await flush();
    expect(document.body.textContent).toContain('Done.');
    expect(buttons().map((b) => b.textContent)).toEqual(['OK']);
    act(() => buttons()[0]!.click());
    expect(await answer).toBe(wxID_OK);
  });

  it('OK|CANCEL shows the SetOKCancelLabels pair, defaults per wxCANCEL_DEFAULT, and Cancel is wxID_CANCEL', async () => {
    const answer = ShowKicadMessageDialog({
      message: 'Load anyway?',
      caption: 'Schematic Load Error',
      style: wxOK | wxCANCEL | wxCANCEL_DEFAULT | wxICON_QUESTION,
      okLabel: 'Use partial schematic',
      cancelLabel: 'Cancel',
    });
    await flush();
    const labels = buttons().map((b) => b.textContent);
    expect(labels).toContain('Use partial schematic');
    expect(document.activeElement?.textContent).toBe('Cancel');
    act(() =>
      buttons()
        .find((b) => b.textContent === 'Cancel')!
        .click(),
    );
    expect(await answer).toBe(wxID_CANCEL);
  });

  it('OK on the two-button box is wxID_OK', async () => {
    const answer = ShowKicadMessageDialog({ message: 'm', caption: 'c', style: wxOK | wxCANCEL });
    await flush();
    act(() =>
      buttons()
        .find((b) => b.textContent === 'OK')!
        .click(),
    );
    expect(await answer).toBe(wxID_OK);
  });
});
