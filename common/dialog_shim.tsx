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
import {
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  type CSSProperties,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { PgmOrNull } from './pgm_base.js';
import { DIALOG_GEOMETRY_KEY } from './settings/common_settings.js';
import { Button } from './wx/controls.js';
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
   * A `wxID_APPLY` button. `wxStdDialogButtonSizer::Realize` on GTK puts it
   * between Cancel and the affirmative button: Cancel, Apply, OK.
   */
  onApply?: () => void;
  applyLabel?: string;
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
  onApply,
  applyLabel = 'Apply',
  children,
}: StdDialogButtonsProps): JSX.Element {
  return (
    <div className="ze-modal-footer">
      {children}
      {children ? <span className="ze-sdb-spacer" /> : null}
      <Button label={cancelLabel} title={cancelTitle} onClick={onCancel} />
      {onApply ? <Button label={applyLabel} onClick={onApply} /> : null}
      <Button label={okLabel} isDefault disabled={okDisabled} onClick={onOk} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The dialog window.

/**
 * `getDialogKeyFromTitle` (dialog_shim.cpp:85-101): the title, cut before a trailing
 * parenthesised part, so "Footprint Properties (U3)" and "... (R1)" share one remembered state.
 */
export function getDialogKeyFromTitle(aTitle: string): string {
  const parenPos = aTitle.lastIndexOf('(');

  if (parenPos > 0) {
    let end = parenPos;

    while (end > 0 && aTitle[end - 1] === ' ') end--;

    return aTitle.substring(0, end);
  }

  return aTitle;
}

/** A one-line text entry: what GTK's `activates-default` applies to. */
function isSingleLineEntry(aEl: EventTarget | null): boolean {
  if (!(aEl instanceof HTMLInputElement)) return false;
  return ['', 'text', 'number', 'search', 'email', 'url', 'tel', 'password'].includes(aEl.type);
}

/** The height of the title bar a saved position must keep on screen (`FromDIP( 15 )`). */
const TITLE_GRAB = 15; // [data] dialog_shim.cpp:549, the point tested inside the title bar

export interface DialogShimProps {
  /** The window title (`SetTitle`), drawn centred in the title bar. */
  title: string;
  /** The title bar's close button, and Escape: `wxID_CANCEL`. */
  onClose: () => void;
  /**
   * `Show()` rather than `ShowModal()` / `ShowQuasiModal()`: no backdrop, the frame behind
   * stays live, and Escape acts only while the dialog has the focus - on the canvas it is the
   * tool's cancel, not the dialog's.
   */
  modeless?: boolean;
  /** The dialog's own layout class (its `_base.cpp` sizer tree), never its chrome. */
  className?: string;
  /** `SetInitialFocus( aWindow )`; the dialog itself when absent. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** `m_hash_key`, for a dialog whose title varies; the title's key otherwise. */
  hashKey?: string;
  /**
   * A size the dialog states: `SetSize` / `SetMinSize` from its constructor's `aInitialSize`
   * (data from its `_base.cpp`, never chrome). Position is DialogShim's own.
   */
  style?: CSSProperties;
  /** The window element, for a dialog that measures or focuses it. */
  frameRef?: Ref<HTMLDivElement>;
  /**
   * A subclass's `OnCharHook` override: it sees every key in the window first, and a key it
   * consumes (preventDefault) does not reach DIALOG_SHIM::OnCharHook's Escape and Enter.
   */
  onCharHook?: (aEvent: ReactKeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

/**
 * `DIALOG_SHIM`'s window: the class every KiCad dialog derives from, so no dialog draws its own
 * frame. The chrome - face, border, the two rounded top corners, the window shadow, the 37px
 * title bar - is `.ze-modal`'s and `.ze-modal-header`'s; a dialog supplies its title and its
 * sizer tree and nothing else. What DIALOG_SHIM does on top of wxDialog:
 *
 * - `Show`: opens where it was last closed (`"__geometry"` in the common settings' dialog map),
 *   else centred over the frame (`Centre( wxBOTH )`); re-centred if the title bar would land
 *   off screen. `SaveControlState` writes the geometry back when it closes.
 * - Moves by its title bar, like any window; a modal one ignores a click outside it, as the
 *   desktop does.
 * - Enter in a one-line entry presses the default button (GTK's `activates-default`), unless
 *   the entry took the key itself (`wxTE_PROCESS_ENTER`: its handler calls preventDefault);
 *   Ctrl+Enter, and Shift+Enter in a one-line entry, is wxID_OK from anywhere (`OnCharHook`,
 *   dialog_shim.cpp:1789-1835).
 * - On the first paint the text in every entry is selected (`SelectAllInTextCtrls`) and focus
 *   goes to the initial target, or the dialog itself so its keys still work
 *   (`forceInitialFocus`).
 */
export function DialogShim({
  title,
  onClose,
  modeless = false,
  className,
  initialFocus,
  hashKey,
  style,
  frameRef: outerFrameRef,
  onCharHook,
  children,
}: DialogShimProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(outerFrameRef, () => frameRef.current!, []);
  // The window's top-left; null until the first layout has placed it.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const key = hashKey ?? getDialogKeyFromTitle(title);
  useModalEscape(onClose, !modeless);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Show() runs once per showing; the key is read at that moment
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const r = frame.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const internals = PgmOrNull()?.GetCommonSettings()?.CsInternals?.() ?? null;
    const saved = internals?.GetDialogControlValue(key, DIALOG_GEOMETRY_KEY);
    let x = Math.round((vw - r.width) / 2);
    let y = Math.round((vh - r.height) / 2);

    if (typeof saved === 'object' && saved.w !== 0 && saved.h !== 0) {
      // Re-center if the title bar would land on no display.
      const grabX = saved.x + r.width / 2;
      const grabY = saved.y + TITLE_GRAB;

      if (grabX >= 0 && grabX < vw && grabY >= 0 && grabY < vh) {
        x = saved.x;
        y = saved.y;
      }
    }

    setPos({ x, y });

    // SelectAllInTextCtrls, then forceInitialFocus.
    for (const input of frame.querySelectorAll('input')) {
      if (isSingleLineEntry(input)) {
        try {
          input.setSelectionRange(0, input.value.length);
        } catch {
          /* a number entry has no selection API */
        }
      }
    }

    const target = initialFocus?.current;

    if (target && target.offsetParent !== null) target.focus();
    else if (!frame.contains(document.activeElement)) frame.focus();

    return () => {
      // SaveControlState: where it was and how big, as it closes.
      const at = posRef.current;
      const box = frame.getBoundingClientRect();

      if (at && internals)
        internals.SetDialogControlValue(key, DIALOG_GEOMETRY_KEY, {
          x: at.x,
          y: at.y,
          w: Math.round(box.width),
          h: Math.round(box.height),
        });
    };
  }, []);

  const onTitleDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || !pos || (e.target as HTMLElement).closest('.x')) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onTitleMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d) setPos({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
  };
  const onTitleUp = (): void => {
    drag.current = null;
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    onCharHook?.(e);

    if (e.defaultPrevented) return;

    if (e.key === 'Escape' && modeless) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key !== 'Enter') return;

    const entry = isSingleLineEntry(e.target);

    // Enter in an entry, on the window itself (GtkWindow binds Return to activate-default when
    // no widget takes it), or Ctrl/Shift+Enter anywhere: the default button, wxID_OK.
    if (!(entry || e.target === frameRef.current || e.ctrlKey)) return;

    const button = frameRef.current?.querySelector<HTMLButtonElement>(
      '.ze-btn.primary:not(:disabled)',
    );

    if (!button) return;

    e.preventDefault();
    e.stopPropagation();
    button.click();
  };

  const frame = (
    <div
      ref={frameRef}
      className={`ze-modal ze-shim${modeless ? ' ze-modeless' : ''}${className ? ` ${className}` : ''}`}
      // Where the window is: data the user put there, not chrome. Hidden for the one layout
      // before it is placed.
      style={{ ...style, ...(pos ? { left: pos.x, top: pos.y } : { visibility: 'hidden' }) }}
      role="dialog"
      aria-modal={!modeless}
      aria-label={title}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <div
        className="ze-modal-header"
        onPointerDown={onTitleDown}
        onPointerMove={onTitleMove}
        onPointerUp={onTitleUp}
      >
        {title}
        <span className="x" title="Close" onClick={onClose}>
          ✕
        </span>
      </div>
      {children}
    </div>
  );

  return modeless ? frame : <div className="ze-modal-backdrop">{frame}</div>;
}
