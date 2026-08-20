// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Esc closes the dialog, which in wxWidgets is not something a dialog opts into.
 *
 * `wxDialog` maps Esc to `wxID_CANCEL` for free: any dialog with a Cancel
 * button, or with `wxID_CANCEL` in its `wxStdDialogButtonSizer`, closes on Esc
 * without a line of code. Every KiCad dialog therefore does, and so does
 * `DIALOG_SHIM`, which is what all of ours are ports of.
 *
 * Ours are React components that each render their own backdrop, so each one
 * that wanted this had to write it, and most did not - 17 of 74 handled Esc at
 * all. Worse, the ones that did handled it with `onKeyDown` on the modal div,
 * which only fires when focus is already inside; press Esc after clicking the
 * dimmed backdrop and nothing happened.
 *
 * ## Why a stack
 *
 * Dialogs nest - Schematic Setup opens a colour picker, the Hotkey List opens
 * "Set Hotkey" - and Esc must close the top one only. wx gets this from modal
 * event loops: the inner dialog's loop has the keyboard and the outer one never
 * sees the key. There is no such loop here, so the order has to be kept
 * explicitly, and last-mounted-wins is that order.
 *
 * One listener, in capture phase on `window`, so it runs before whatever has
 * focus can swallow the key.
 *
 * ## What Esc means
 *
 * Cancel, not OK: `wxID_CANCEL`. A dialog's Esc handler must be the same thing
 * its Cancel button does - discard - and never its OK. That is the caller's
 * responsibility; this only decides *when*.
 */

import { wasBrowserSuppressed } from './browser_hotkeys.js';

/** A dialog's cancel, while it is on screen. */
type CancelFn = () => void;

/**
 * The open dialogs, oldest first. A plain array rather than a Set because the
 * order is the whole point.
 */
const stack: { cancel: CancelFn }[] = [];

let listening = false;

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  // `defaultPrevented` means someone already acted on this key — EXCEPT when it
  // was our own browser suppression. `browser_hotkeys` runs in capture phase and
  // calls `preventDefault()` on every combo the app CLAIMS, purely to stop the
  // browser acting on it; the event is meant to carry on to us. Esc is a claimed
  // combo, so by the time this listener runs `defaultPrevented` is already true
  // and every dialog in the app stopped closing on Esc.
  //
  // `useMenuHotkeys` had the identical bug and was fixed; this consumer of
  // `defaultPrevented` was missed, which is why the accelerators came back and
  // Esc did not.
  if (e.defaultPrevented && !wasBrowserSuppressed(e)) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  // Stop here rather than let it run on: an editor's key handler treats Esc as
  // "cancel the current tool", and cancelling a tool because a dialog closed is
  // an edit the user did not ask for.
  e.preventDefault();
  e.stopPropagation();
  top.cancel();
}

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  window.addEventListener('keydown', onKeyDown, true);
  listening = true;
}

/**
 * Put a dialog's cancel on top of the stack, and return the function that takes
 * it off again.
 *
 * The unregister is idempotent and order-independent: a dialog closed from
 * underneath another - which happens when a whole editor unmounts - is removed
 * from wherever it sits rather than popped.
 */
export function pushModalCancel(cancel: CancelFn): () => void {
  listen();
  const entry = { cancel };
  stack.push(entry);
  return () => {
    const i = stack.indexOf(entry);
    if (i !== -1) stack.splice(i, 1);
  };
}

/** How many dialogs are open. For tests, and for anything that needs to know. */
export const openModalCount = (): number => stack.length;

/** Close the topmost dialog, as Esc does. Exported so the rule can be tested. */
export function cancelTopModal(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.cancel();
  return true;
}

/** Drop every registration. Tests only - a leaked entry would outlive its test. */
export function resetModalStack(): void {
  stack.length = 0;
}
