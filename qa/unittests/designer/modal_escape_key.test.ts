// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The keystroke itself, not just the registry `modal_escape.test.ts` covers.
 *
 * `wxDialog` gets three things from being a window with a modal event loop
 * that we have to arrange by hand, and each is a way this goes wrong:
 *
 *   - the key reaches the dialog wherever the focus is, so Esc works after a
 *     click on the dimmed backdrop (the ad-hoc `onKeyDown` handlers this
 *     replaced did not);
 *   - the frame underneath never sees it, because an editor reads Esc as
 *     `ACTIONS::cancelInteractive` and cancelling a tool because a dialog
 *     closed is an edit nobody asked for;
 *   - and with no dialog open the frame *does* see it, so Esc still abandons
 *     the current tool.
 *
 * `window` is stubbed because `qa` runs in node with no DOM. The stub only has
 * to record listeners: the module registers one capture-phase `keydown` and
 * everything else is its own logic.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type Listener = (e: unknown) => void;

const listeners: { type: string; fn: Listener; capture: boolean }[] = [];

beforeAll(() => {
  (globalThis as { window?: unknown }).window = {
    addEventListener: (type: string, fn: Listener, capture?: boolean) => {
      listeners.push({ type, fn, capture: capture === true });
    },
    removeEventListener: () => {},
  };
});

const { cancelTopModal, pushModalCancel, resetModalStack } = await import(
  '@ziroeda/designer/src/ui/modal_escape.js'
);

afterEach(() => resetModalStack());

/** A keydown as the app would see it, with the two calls we care about spied. */
function keydown(key: string, defaultPrevented = false) {
  const e = {
    key,
    defaultPrevented,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  for (const l of listeners) if (l.type === 'keydown') l.fn(e);
  return e;
}

describe('Esc on the window', () => {
  it('listens in the capture phase', () => {
    // Bubble phase is too late: whatever has focus - a grid cell editor, a
    // combo - can swallow the key first.
    pushModalCancel(() => {});
    const keydowns = listeners.filter((l) => l.type === 'keydown');
    expect(keydowns.length).toBe(1);
    expect(keydowns[0]!.capture).toBe(true);
  });

  it('cancels the open dialog and stops the key there', () => {
    const cancel = vi.fn();
    pushModalCancel(cancel);

    const e = keydown('Escape');
    expect(cancel).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it('cancels only the topmost when dialogs nest', () => {
    // Schematic Setup with a colour picker over it. Closing both, or the one
    // underneath, are the two ways the sweep goes wrong: 15 of the dialogs it
    // touched had a listener of their own that did exactly that.
    const outer = vi.fn();
    const inner = vi.fn();
    pushModalCancel(outer);
    pushModalCancel(inner);

    keydown('Escape');
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });

  it('reaches the dialog underneath once the top one is gone', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    pushModalCancel(outer);
    const closeInner = pushModalCancel(inner);

    closeInner();
    keydown('Escape');
    expect(outer).toHaveBeenCalledOnce();
  });

  it('leaves the key alone when no dialog is open', () => {
    // The editor still needs it: Esc with nothing up is cancelInteractive.
    const e = keydown('Escape');
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
  });

  it('ignores every other key', () => {
    const cancel = vi.fn();
    pushModalCancel(cancel);

    keydown('Enter');
    keydown('a');
    keydown('Tab');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('leaves an Esc something else has already claimed', () => {
    // `DIALOG_SHIM::OnCharHook` gives the first Esc after an edit back to the
    // text control, which reverts itself and returns rather than skipping. A
    // handler that consumed the key says so the same way here.
    const cancel = vi.fn();
    pushModalCancel(cancel);

    keydown('Escape', true);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('agrees with cancelTopModal, which the rest of the tests drive', () => {
    const cancel = vi.fn();
    pushModalCancel(cancel);
    expect(cancelTopModal()).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
