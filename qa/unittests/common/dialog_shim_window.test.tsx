// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DialogShim, the window every dialog renders through (common/dialog_shim.cpp's DIALOG_SHIM):
 * Enter and the default button, Escape, the outside click a modal ignores, the initial focus and
 * selected text, and the geometry it remembers per dialog in the common settings.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogShim, getDialogKeyFromTitle, resetModalStack } from '@ziroeda/common/dialog_shim.js';
import {
  type COMMON_SETTINGS_INTERNALS,
  type COMMON_SETTINGS_LIKE,
  PGM_BASE,
  SETTINGS_MANAGER,
  SetPgm,
} from '@ziroeda/common/pgm_base.js';
import type { DialogControlValue } from '@ziroeda/common/settings/common_settings.js';
import { Button, CheckBox } from '@ziroeda/common/wx/controls.js';

/** m_dialogControlValues, in memory. */
let store: Record<string, Record<string, DialogControlValue>>;

beforeEach(() => {
  store = {};
  const internals: COMMON_SETTINGS_INTERNALS = {
    GetDialogControlValue: (d, c) => store[d]?.[c],
    SetDialogControlValue: (d, c, v) => {
      store[d] ??= {};
      store[d][c] = v;
    },
  };
  SetPgm(
    new PGM_BASE(
      { CsInternals: () => internals } as unknown as COMMON_SETTINGS_LIKE,
      new SETTINGS_MANAGER(),
    ),
  );
});
afterEach(() => {
  cleanup();
  resetModalStack();
  SetPgm(null);
});

function Form({
  onOk,
  onClose = () => {},
  modeless,
  okDisabled,
  processEnter,
}: {
  onOk: () => void;
  onClose?: () => void;
  modeless?: boolean;
  okDisabled?: boolean;
  processEnter?: () => void;
}) {
  const focusRef = useRef<HTMLInputElement>(null);
  return (
    <DialogShim title="Sample (U3)" onClose={onClose} modeless={modeless} initialFocus={focusRef}>
      <input aria-label="name" defaultValue="R1" />
      <input aria-label="value" defaultValue="10k" ref={focusRef} />
      <input
        aria-label="own enter"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && processEnter) {
            e.preventDefault();
            processEnter();
          }
        }}
      />
      <CheckBox label="Box" checked={false} onChange={() => {}} />
      <Button label="Cancel" onClick={onClose} />
      <Button label="OK" isDefault disabled={okDisabled} onClick={onOk} />
    </DialogShim>
  );
}

describe('getDialogKeyFromTitle (dialog_shim.cpp:85)', () => {
  it('cuts a trailing parenthesised part and the spaces before it', () => {
    expect(getDialogKeyFromTitle('Footprint Properties (U3)')).toBe('Footprint Properties');
    expect(getDialogKeyFromTitle('Find')).toBe('Find');
    // A title that starts with "(" keeps it: parenPos must be past the start.
    expect(getDialogKeyFromTitle('(odd)')).toBe('(odd)');
  });
});

describe('Enter and the default button', () => {
  it('Enter in a one-line entry presses the default button (activates-default)', () => {
    const onOk = vi.fn();
    render(<Form onOk={onOk} />);
    fireEvent.keyDown(screen.getByLabelText('name'), { key: 'Enter' });
    expect(onOk).toHaveBeenCalledTimes(1);
  });

  it('an entry that takes Enter itself (wxTE_PROCESS_ENTER) is not doubled by the default', () => {
    const onOk = vi.fn();
    const own = vi.fn();
    render(<Form onOk={onOk} processEnter={own} />);
    fireEvent.keyDown(screen.getByLabelText('own enter'), { key: 'Enter' });
    expect([own.mock.calls.length, onOk.mock.calls.length]).toEqual([1, 0]);
  });

  it('plain Enter on a checkbox is not the default button; Ctrl+Enter is wxID_OK from anywhere', () => {
    const onOk = vi.fn();
    render(<Form onOk={onOk} />);
    const box = screen.getByLabelText('Box');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onOk).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(onOk).toHaveBeenCalledTimes(1);
  });

  it('Enter on the window itself presses the default button (GtkWindow activate-default)', () => {
    const onOk = vi.fn();
    render(
      <DialogShim title="Bare" onClose={() => {}}>
        <Button label="OK" isDefault onClick={onOk} />
      </DialogShim>,
    );
    const dlg = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dlg);
    fireEvent.keyDown(dlg, { key: 'Enter' });
    expect(onOk).toHaveBeenCalledTimes(1);
  });

  it('a disabled default button is not pressed', () => {
    const onOk = vi.fn();
    render(<Form onOk={onOk} okDisabled />);
    fireEvent.keyDown(screen.getByLabelText('name'), { key: 'Enter' });
    expect(onOk).not.toHaveBeenCalled();
  });
});

describe('Escape and the outside click', () => {
  it('a modal closes on Escape anywhere, and ignores a click outside it', () => {
    const onClose = vi.fn();
    const { container } = render(<Form onOk={() => {}} onClose={onClose} />);
    fireEvent.mouseDown(container.querySelector('.ze-modal-backdrop')!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a modeless one closes on Escape only with the focus inside it', () => {
    const onClose = vi.fn();
    render(<Form onOk={() => {}} onClose={onClose} modeless />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('name'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the close box is wxID_CANCEL', () => {
    const onClose = vi.fn();
    render(<Form onOk={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByText('✕'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the first paint', () => {
  it('focuses the initial target and selects the text in every entry', () => {
    render(<Form onOk={() => {}} />);
    const value = screen.getByLabelText('value') as HTMLInputElement;
    const name = screen.getByLabelText('name') as HTMLInputElement;
    expect(document.activeElement).toBe(value);
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, 2]);
    expect([value.selectionStart, value.selectionEnd]).toEqual([0, 3]);
  });

  it('with no initial target the dialog itself takes the focus, so its keys work', () => {
    render(
      <DialogShim title="Bare" onClose={() => {}}>
        <span>text</span>
      </DialogShim>,
    );
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });
});

describe('the geometry it remembers (__geometry)', () => {
  // happy-dom lays nothing out; give the window a size, since a saved 0 x 0 reads as nothing
  // saved (DIALOG_SHIM::Show tests GetSize() != 0).
  const W = 300;
  const H = 200;
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: W,
      bottom: H,
      width: W,
      height: H,
      toJSON: () => ({}),
    });
  });
  afterEach(() => vi.restoreAllMocks());
  const cx = (): number => Math.round((window.innerWidth - W) / 2);
  const cy = (): number => Math.round((window.innerHeight - H) / 2);

  const frameAt = (): { left: string; top: string } => {
    const el = screen.getByRole('dialog') as HTMLElement;
    return { left: el.style.left, top: el.style.top };
  };

  it('opens centred the first time, and saves where it was under the title key when it closes', () => {
    const { unmount } = render(<Form onOk={() => {}} />);
    const at = frameAt();
    expect(at).toEqual({ left: `${cx()}px`, top: `${cy()}px` });
    unmount();
    expect(store.Sample?.__geometry).toEqual({ x: cx(), y: cy(), w: W, h: H });
  });

  it('opens where it was dragged to last time', () => {
    const { unmount } = render(<Form onOk={() => {}} />);
    const bar = screen.getByRole('dialog').querySelector('.ze-modal-header') as HTMLElement;
    bar.setPointerCapture = () => {};
    act(() => {
      fireEvent.pointerDown(bar, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
      fireEvent.pointerMove(bar, { clientX: 60, clientY: 130, pointerId: 1 });
      fireEvent.pointerUp(bar, { pointerId: 1 });
    });
    const dragged = frameAt();
    unmount();
    render(<Form onOk={() => {}} />);
    expect(frameAt()).toEqual(dragged);
    expect(dragged).toEqual({ left: `${cx() - 40}px`, top: `${cy() + 30}px` });
  });

  it('re-centres when the saved title bar would be off screen', () => {
    store.Sample = { __geometry: { x: -5000, y: 20, w: 300, h: 200 } };
    render(<Form onOk={() => {}} />);
    expect(frameAt().left).toBe(`${cx()}px`);
  });
});
