// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Esc closes the topmost dialog, which `wxDialog` gives every KiCad dialog for
 * free by mapping it to `wxID_CANCEL`.
 *
 * The rule worth testing is the ordering. Dialogs nest - Schematic Setup opens
 * a colour picker, the Hotkey List opens "Set Hotkey" - and wx gets
 * topmost-only from modal event loops, which we do not have. Here the order is
 * kept by hand, so it is the part that can be wrong.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelTopModal,
  openModalCount,
  pushModalCancel,
  resetModalStack,
} from '@ziroeda/designer/src/ui/modal_escape.js';

afterEach(() => resetModalStack());

describe('the modal stack', () => {
  it('closes nothing when nothing is open', () => {
    expect(cancelTopModal()).toBe(false);
  });

  it('closes the one open dialog', () => {
    const cancel = vi.fn();
    pushModalCancel(cancel);
    expect(cancelTopModal()).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('closes only the topmost when dialogs nest', () => {
    // The Hotkey List is open and it has opened "Set Hotkey". Esc must dismiss
    // the prompt and leave the list up - closing both, or closing the one
    // underneath, are the two ways this goes wrong.
    const outer = vi.fn();
    const inner = vi.fn();
    pushModalCancel(outer);
    pushModalCancel(inner);

    cancelTopModal();
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });

  it('falls back to the one underneath once the top closes', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    pushModalCancel(outer);
    const closeInner = pushModalCancel(inner);

    closeInner();
    cancelTopModal();
    expect(outer).toHaveBeenCalledOnce();
  });

  it('removes a dialog closed from underneath another', () => {
    // A whole editor unmounting takes its dialogs with it, in whatever order
    // React runs the cleanups - so unregistering has to work on the middle of
    // the stack, not just the end.
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    pushModalCancel(a);
    const closeB = pushModalCancel(b);
    pushModalCancel(c);

    closeB();
    expect(openModalCount()).toBe(2);
    cancelTopModal();
    expect(c).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
  });

  it('is idempotent to unregister twice', () => {
    const a = vi.fn();
    const closeA = pushModalCancel(a);
    closeA();
    closeA();
    expect(openModalCount()).toBe(0);
  });

  it('does not lose the dialog below when the same cancel is pushed twice', () => {
    // Two dialogs can legitimately share a handler - two instances of the same
    // component - and each registration has to be its own entry.
    const shared = vi.fn();
    pushModalCancel(shared);
    const second = pushModalCancel(shared);
    second();
    expect(openModalCount()).toBe(1);
  });
});
