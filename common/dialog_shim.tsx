// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_SHIM` (common/dialog_shim.cpp), the base every KiCad dialog derives
 * from, as far as a React dialog needs it: the size floor
 * (`finishDialogSettings` -> `SetSizeHints`), Escape closing the topmost
 * dialog (wx's `wxID_CANCEL` on Escape, which `ShowModal` /
 * `ShowQuasiModal` route to the dialog in front), and the standard button row
 * each `_base.cpp` builds. Until 09-26 these were four files
 * (`dialog_shim_buttons`, `dialogs/dialog_size_hints`, `dialogs/modal_escape`,
 * `dialogs/use_modal_escape`).
 */
import { type JSX, type ReactNode, useEffect, useRef } from 'react';
import { wasBrowserSuppressed } from './browser_hotkeys.js';

// ---------------------------------------------------------------------------
// finishDialogSettings / SetSizeHints: the size floor.

export interface Size {
  readonly w: number;
  readonly h: number;
}

/**
 * `wxSize::IncTo` -- a componentwise maximum, which is why a wx dialog only
 * ever grows.
 *
 * An unmeasured element is ignored rather than treated as zero. A dialog that
 * is not laid out yet, or is display:none, reports 0 for both, and clamping the
 * floor down to that would put back exactly the tracking behaviour this exists
 * to remove -- while looking like it was working.
 */
export function heldSize(floor: Size, measured: Size): Size {
  return {
    w: measured.w > 0 ? Math.max(floor.w, measured.w) : floor.w,
    h: measured.h > 0 ? Math.max(floor.h, measured.h) : floor.h,
  };
}

/** Dialogs that state their own size, and must not be given a second answer. */
const EXEMPT = [
  // Its own port of the same upstream behaviour, and a closer one: upstream
  // re-fits a PAGED_DIALOG on every page change, with a floor and a ceiling
  // the C++ names. See `paged_dialog_size.ts`.
  '.ze-paged-dialog',
].join(',');

/**
 * Give every dialog a size floor that rises with its content and never falls.
 *
 * Idempotent, and safe to call before anything is on screen: dialogs are found
 * as they are added.
 */
export function installDialogSizeHints(): void {
  if (typeof document === 'undefined' || typeof ResizeObserver === 'undefined') return;

  const held = new WeakMap<HTMLElement, Size>();

  const hold = (el: HTMLElement): void => {
    const floor = held.get(el) ?? { w: 0, h: 0 };
    const rect = el.getBoundingClientRect();
    // Ceil, because a fractional floor and a fractional measurement disagree
    // forever: the element lands a hundredth of a pixel under its own minimum
    // and the observer fires again on every frame.
    const next = heldSize(floor, { w: Math.ceil(rect.width), h: Math.ceil(rect.height) });
    if (next.w === floor.w && next.h === floor.h) return;
    held.set(el, next);
    // A minimum rather than a fixed size: `SetSizeHints` sets the floor, and a
    // dialog the user can drag larger stays larger. It also means this can only
    // ever reveal content, never clip it.
    if (next.w > 0) el.style.minWidth = `${next.w}px`;
    if (next.h > 0) el.style.minHeight = `${next.h}px`;
  };

  // The floor only rises, so writing it back cannot make the element smaller
  // and the loop converges after one further callback.
  const sizes = new ResizeObserver((entries) => {
    for (const e of entries) hold(e.target as HTMLElement);
  });

  const watch = (el: HTMLElement): void => {
    if (held.has(el) || el.matches(EXEMPT)) return;
    held.set(el, { w: 0, h: 0 });
    sizes.observe(el);
  };

  const scan = (root: ParentNode): void => {
    for (const el of root.querySelectorAll<HTMLElement>('.ze-modal')) watch(el);
  };

  scan(document);
  new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.classList.contains('ze-modal')) watch(node);
        scan(node);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// Escape is wxID_CANCEL for the dialog in front: the hook a dialog calls.

/**
 * Close this dialog when Esc is pressed and it is the topmost one.
 *
 * `cancel` is read through a ref rather than captured by the effect, because a
 * dialog's close handler is usually an inline arrow and so has a new identity
 * every render. Depending on it would re-register on each one, and each
 * re-registration moves the dialog to the top of the stack - so a repainting
 * background dialog would start swallowing the Esc meant for the one in front
 * of it.
 *
 * `enabled` is for a dialog that renders while closed. Passing `false`
 * unregisters it, so it does not sit on the stack absorbing the key.
 */
export function useModalEscape(cancel: () => void, enabled = true): void {
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  useEffect(() => {
    if (!enabled) return undefined;
    return pushModalCancel(() => cancelRef.current());
  }, [enabled]);
}

// ---------------------------------------------------------------------------
// ... and the stack it registers on, oldest dialog first.

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

// ---------------------------------------------------------------------------
// The standard button row.

/**
 * Counterpart: `wxStdDialogButtonSizer`, which is what every KiCad dialog uses —
 * wxFormBuilder emits `m_sdbSizer1` / `m_sdbSizer1OK` / `m_sdbSizer1Cancel` and
 * a `Realize()` into each `*_base.cpp`, so no dialog upstream states the row
 * itself.
 *
 * Here, eighty-nine dialogs each wrote their own `<div className="ze-modal-footer">`
 * with two hand-made buttons, and they had already drifted: some gave the
 * buttons `className="ze-btn"` and some nothing, some set `type="button"` and
 * some left it to default to `submit`. That is the whole reason wx has a sizer
 * for this.
 *
 * ## Order is the platform's, not the call site's
 *
 * `Realize()` is where wx applies the platform convention, and the two disagree:
 * GTK follows the GNOME HIG and puts the affirmative button **last**
 * (Cancel, then OK), Windows puts it first. Our parity target is the GTK build
 * on this machine, so Cancel comes first — and it is settled here once rather
 * than at each call site, which is exactly what stopped the 89 copies agreeing.
 *
 * The OK button is the dialog's default: `SetAffirmativeButton` is what makes
 * Enter activate it.
 */
export interface StdDialogButtonsProps {
  /** `wxID_CANCEL`'s handler. Also what Esc runs, via `useModalEscape`. */
  onCancel: () => void;
  /** `wxID_OK`'s handler — the affirmative, and the dialog's default button. */
  onOk: () => void;
  /**
   * Stock label overrides. wx takes these from the stock ids (`wxID_OK` → "OK",
   * `wxID_CANCEL` → "Cancel"); a dialog that renames one does it deliberately,
   * as `DIALOG_SHIM`'s `SetOKCancelLabels` callers do.
   */
  okLabel?: string;
  cancelLabel?: string;
  /** `m_sdbSizerOK->Enable( false )`. */
  okDisabled?: boolean;
  /** A tooltip on Cancel — `SetToolTip` on the stock button. */
  cancelTitle?: string;
  /**
   * Anything the dialog puts at the *left* of the row — a Help button, a
   * "Reset to Defaults", a status line. `wxStdDialogButtonSizer` grows a
   * stretch spacer between those and the affirmative pair.
   */
  children?: ReactNode;
}

export function StdDialogButtons({
  onCancel,
  onOk,
  okLabel = 'OK',
  cancelLabel = 'Cancel',
  okDisabled,
  cancelTitle,
  children,
}: StdDialogButtonsProps): JSX.Element {
  return (
    <div className="ze-modal-footer">
      {children}
      {children ? <span className="ze-sdb-spacer" /> : null}
      <button type="button" className="ze-btn" title={cancelTitle} onClick={onCancel}>
        {cancelLabel}
      </button>
      <button type="button" className="ze-btn primary" disabled={okDisabled} onClick={onOk}>
        {okLabel}
      </button>
    </div>
  );
}
