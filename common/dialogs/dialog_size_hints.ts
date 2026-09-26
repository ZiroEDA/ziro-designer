// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A dialog settles at a size and stays there.
 *
 * Every KiCad dialog is sized the same way, and the order of the two calls is
 * the whole behaviour:
 *
 *     bMainSizer->Fit( this );            // size to the content -- ONCE
 *     GetSizer()->SetSizeHints( this );   // and never go below that again
 *
 * `.ze-modal` ports the first line as `width: max-content; height: max-content`,
 * which is right for the initial size and wrong afterwards, because CSS does
 * not do anything once. It tracks the content for the life of the dialog, so
 * every dialog in the app resizes under the user whenever its contents change:
 * pick a different radio whose explanation is a line longer, watch an error
 * appear, filter a list down, and the window jumps. `Fit()` runs at
 * construction and nothing calls it again, so upstream simply does not do this.
 *
 * `paged_dialog_size.ts` already found this and fixed it for `PAGED_DIALOG`,
 * where upstream re-fits on every page change and the fix had to be
 * `newSize.IncTo( minSize )` -- a floor that only ever rises. That is the same
 * answer every other dialog needs, so this is that behaviour, installed once
 * for all of them rather than added a dialog at a time.
 *
 * Installed at boot as a document-wide behaviour, the same shape as
 * `installOverlayScrollbars`: in wx this comes from the dialog base class, so
 * here it belongs to every `.ze-modal` by construction rather than to whoever
 * remembers to ask for it.
 */

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
