// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * wxDialog's wxEVT_CHAR_HOOK: the window sees a key before the focused control does, even a
 * control that stops the key's propagation; a key the hook consumes never reaches the control.
 */
import { Dialog } from '@ziroeda/wx/dialog.js';
import { WxTextEntryDialog } from '@ziroeda/wx/textdlg.js';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

describe('wxDialog char hook', () => {
  it('sees a key from a control that stops its propagation', () => {
    const hook = vi.fn();
    render(
      <Dialog title="T" onClose={() => {}} onCharHook={hook}>
        <input aria-label="entry" onKeyDown={(e) => e.stopPropagation()} />
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByLabelText('entry'), { key: 'F3' });
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('a key it consumes goes no further', () => {
    const control = vi.fn();
    render(
      <Dialog title="T" onClose={() => {}} onCharHook={(e) => e.key === 'F3' && e.preventDefault()}>
        <input aria-label="entry" onKeyDown={control} />
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByLabelText('entry'), { key: 'F3' });
    fireEvent.keyDown(screen.getByLabelText('entry'), { key: 'a' });
    expect(control).toHaveBeenCalledTimes(1);
  });
});

/**
 * Show(): the frame is measured hidden, then placed. What a dialog does once shown -
 * DIALOG_SHIM's SelectAllInTextCtrls and forceInitialFocus - needs it visible, since a hidden
 * control takes no focus; it ran while the frame was still hidden, and no dialog got its focus.
 */
describe('wxDialog shown', () => {
  it('is visible by the time onShown runs', () => {
    const seen: string[] = [];
    render(
      <Dialog title="T" onClose={() => {}} onShown={(aFrame) => seen.push(aFrame.style.visibility)}>
        <input aria-label="entry" />
      </Dialog>,
    );
    expect(seen).toEqual(['']);
  });

  it("wxTextEntryDialog's entry has the focus, its text selected", () => {
    render(
      <WxTextEntryDialog
        caption="T"
        message="Name:"
        value="New_Library"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    const entry = document.querySelector('.ze-modal input') as HTMLInputElement;
    expect(document.activeElement).toBe(entry);
    expect([entry.selectionStart, entry.selectionEnd]).toEqual([0, 'New_Library'.length]);
  });
});
