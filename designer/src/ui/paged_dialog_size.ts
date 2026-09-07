// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * How a `PAGED_DIALOG` is sized when the page changes — stated once, because
 * upstream states it once.
 *
 * `PAGED_DIALOG::onPageChanged` (common/widgets/paged_dialog.cpp:424-451) runs
 * on every page change:
 *
 *     m_treebook->InvalidateBestSize();
 *     SetMinSize( wxDefaultSize );                       // (1)
 *     wxSize minSize = GetBestSize();                    // (2)
 *     minSize.IncTo( FromDIP( wxSize(  600, 500 ) ) );
 *     minSize.DecTo( FromDIP( wxSize( 1500, 900 ) ) );   // failsafe
 *     minSize.DecTo( display client area - margins );
 *     SetMinSize( minSize );                             // (3)
 *
 *     wxSize currentSize = GetSize();
 *     wxSize newSize = currentSize;
 *     newSize.IncTo( minSize );                          // (4)
 *     if( newSize != currentSize )
 *         SetSize( newSize );
 *
 * There are TWO quantities here and reading them as one is the whole trap.
 *
 *  - The **minimum**, lines (1) to (3), is recomputed from scratch every time:
 *    the previous minimum is CLEARED before `GetBestSize()` is asked, and
 *    `m_treebook->SetFitToCurrentPage( true )` (`:73`) makes that answer the
 *    CURRENT page rather than the largest. So the minimum is not monotone — it
 *    comes back DOWN on a narrower page, which is what lets the user drag the
 *    window smaller there.
 *  - The **size**, line (4), only ever grows, and it grows against the LIVE
 *    `GetSize()`. Nothing remembers a high-water mark: the window simply keeps
 *    whatever size it has, and a page needing more raises it. That is why a wx
 *    dialog settles at the largest page the user has walked to and then stops
 *    moving, and equally why a drag to make it narrower is respected.
 *
 * A CSS dialog does the opposite by default: `.ze-modal` is
 * `width: max-content`, so it tracks the current page and both shrinks and
 * grows the moment another one is selected. So the size is stated — from the
 * subclass's own `aInitialSize` — and this hook is lines (1) to (4) on top of
 * it.
 *
 * The 600 x 500 floor, the 1500 x 900 failsafe and the display clamp live in
 * `.ze-modal.ze-paged-dialog` and `.ze-modal` rather than here, since CSS can
 * state a range without measuring anything — and the measurement below is
 * taken with the inline size cleared, so those bounds apply to it exactly as
 * wx applies its own to `GetBestSize()`.
 */
import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * `DIALOG_SHIM`'s remembered geometry (`common/dialog_shim.cpp:445-495` to
 * read, `:653-671` on close to write) — the other half of the size rule, and
 * the reason a real Board Setup appears never to resize.
 *
 * `Show()` looks up `m_dialogControlValues[key]["__geometry"]` and sizes the
 * dialog to it before it is ever painted; the key is
 * `getDialogKeyFromTitle( GetTitle() )` (`:79-93`), the title with any
 * trailing " (…)" removed. So a user who has grown Board Setup once gets that
 * larger size on every later open and never sees it move again.
 *
 * What `Show()` does with the restored size is the part that is easy to get
 * wrong, and upstream spells it out:
 *
 *     SetSize( pos.x, pos.y,
 *              std::max( wxDialog::GetSize().x, restoredSize.x ),
 *              std::max( wxDialog::GetSize().y, restoredSize.y ), 0 );
 *
 *     // Reset minimum size so the user can resize the dialog smaller than
 *     // the saved size. …
 *     SetMinSize( wxDefaultSize );
 *     InvalidateBestSize();
 *     SetMinSize( GetBestSize() );
 *
 * The remembered size raises the STARTING size and nothing else; the three
 * lines after it exist only to make sure it cannot become a floor. Ours wrote
 * it to `min-width`/`min-height`, which is what left a dialog stuck at a width
 * it had grown to once — a layout fix that made a page narrower could not be
 * seen, and the user could not drag it back either.
 *
 * Ours is localStorage, which is where this app's settings live.
 */
/**
 * A remembered size is right while the layout is right — and a trap while it
 * is not: a dialog that grew because of a layout bug opens at the grown size
 * for that user forever, and fixing the bug does nothing they can see.
 * `DIALOG_SHIM` has the same property upstream; it just does not ship layout
 * fixes to a running browser.
 *
 * The epoch is the answer: bump it in the same commit as a fix that should
 * make dialogs smaller, and every stored size from before it is ignored once.
 * It is NOT a schema version — the shape has not changed — so old entries are
 * left to be evicted rather than migrated.
 *
 * v2: the Text & Graphics Defaults grid was ~260 px wider than upstream's
 * (no column widths, and "(mm)" appended to every header), and
 * `.ze-grid-pane` let that width reach the dialog.
 *
 * v3: two at once. Board Setup > Constraints laid its two halves out at
 * `flex: 1` where `bScrolledSizer` adds both at proportion 0, which made the
 * page ~115 px wider than KiCad's; and this file stored the running MINIMUM
 * rather than the size and applied it as a floor on the next open, so no page
 * could ever get narrower again.
 */
const GEOMETRY_EPOCH = 'v3';
const GEOMETRY_KEY_PREFIX = `ze-dialog-geometry:${GEOMETRY_EPOCH}:`;

/** `getDialogKeyFromTitle( aTitle )` — the title minus a trailing " (…)". */
export function dialogGeometryKey(aTitle: string): string {
  const paren = aTitle.lastIndexOf('(');
  if (paren > 0) return aTitle.slice(0, paren).trimEnd();
  return aTitle;
}

/** The remembered `{ w, h }`, or undefined when nothing is stored yet. */
export function readDialogGeometry(aTitle: string): { w: number; h: number } | undefined {
  try {
    const raw = localStorage.getItem(GEOMETRY_KEY_PREFIX + dialogGeometryKey(aTitle));
    if (!raw) return undefined;
    const g = JSON.parse(raw) as { w?: unknown; h?: unknown };
    if (typeof g.w !== 'number' || typeof g.h !== 'number') return undefined;
    if (!(g.w > 0) || !(g.h > 0)) return undefined;
    return { w: g.w, h: g.h };
  } catch {
    // A private window, cleared site data, or a browser refusing storage. The
    // dialog opens at its stated aInitialSize, which is what upstream does the
    // first time too.
    return undefined;
  }
}

export function writeDialogGeometry(aTitle: string, aSize: { w: number; h: number }): void {
  try {
    localStorage.setItem(
      GEOMETRY_KEY_PREFIX + dialogGeometryKey(aTitle),
      JSON.stringify({ w: aSize.w, h: aSize.h }),
    );
  } catch {
    // Storage refused; the size simply is not remembered, as before.
  }
}

/** `PAGED_DIALOG`'s `aInitialSize`, which every subclass states as a literal. */
export interface InitialSize {
  readonly width: number;
  readonly height: number;
}

/**
 * @param pageKey changes when the page does, which is when upstream recomputes.
 * @param initial the subclass's `aInitialSize` — `wxSize( 980, 600 )` for
 *   Board Setup, `wxSize( 920, 460 )` for Schematic Setup. Omitted where the
 *   dialog's size is stated in CSS instead: Preferences is not a PAGED_DIALOG
 *   subclass upstream and has no such argument, so its size is a measurement of
 *   the real dialog and lives in `.ze-prefs-dialog` beside the note that
 *   derives it.
 * @returns the ref to put on the dialog element. Nothing else: the size is
 *   written to the element's own inline style rather than handed back as a
 *   React `style` prop, and that is deliberate. `.ze-paged-dialog` is
 *   `resize: both`, and a browser resize handle writes `width`/`height` into
 *   exactly that inline style — so a React-managed `style` would overwrite the
 *   user's drag on the next render (a keystroke in any field is one). Writing
 *   it once, imperatively, leaves the element's inline style the user's to
 *   change, which is what a resizable wxDialog is.
 */
/**
 * `GetBestSize()` as arithmetic, so it can be checked without a layout engine.
 *
 * @param aRect the box the dialog occupies with its inline size cleared —
 *   `SetMinSize( wxDefaultSize ); InvalidateBestSize();` before the ask, so
 *   the answer is the content's own requirement and not the size we last gave
 *   it.
 * @param aScrollWidth / @param aClientWidth the dialog element's own pair.
 *   Their difference is the width the content needs and did not get; a
 *   descendant that scrolls deliberately keeps its overflow to itself and
 *   contributes 0. This is the case `Fit()` exists for: wx GROWS the window to
 *   the sizer's minimum, never clips.
 */
export function bestSizeOf(
  aRect: { width: number; height: number },
  aScrollWidth: number,
  aClientWidth: number,
): { w: number; h: number } {
  const shortfall = Math.max(0, aScrollWidth - aClientWidth);
  return { w: Math.ceil(aRect.width + shortfall), h: Math.ceil(aRect.height) };
}

/**
 * `newSize = currentSize; newSize.IncTo( minSize );` — a componentwise maximum
 * against the window's LIVE size (`paged_dialog.cpp:444-450`).
 *
 * There is no high-water mark on either side of this. The window keeps
 * whatever size it has, and only a page that needs more raises it; that alone
 * is what makes a wx paged dialog settle at the largest page walked to and
 * then stop moving. Keeping a running maximum here instead — which is what
 * this file used to do — turns "grew for one page" into "can never be smaller
 * again", including across opens once it is written to storage.
 */
export function incTo(
  aCurrent: { w: number; h: number },
  aMin: { w: number; h: number },
): { w: number; h: number } {
  return { w: Math.max(aCurrent.w, aMin.w), h: Math.max(aCurrent.h, aMin.h) };
}

/** `PAGED_DIALOG`'s `aInitialSize`, which every subclass states as a literal. */
export interface InitialSize {
  readonly width: number;
  readonly height: number;
}

/**
 * @param pageKey changes when the page does, which is when upstream recomputes.
 * @param initial the subclass's `aInitialSize` — `wxSize( 980, 600 )` for
 *   Board Setup, `wxSize( 920, 460 )` for Schematic Setup. Omitted where the
 *   dialog's size is stated in CSS instead: Preferences is not a PAGED_DIALOG
 *   subclass upstream and has no such argument, so its size is a measurement of
 *   the real dialog and lives in `.ze-prefs-dialog` beside the note that
 *   derives it.
 * @param title `DIALOG_SHIM`'s geometry key. Omitted where nothing is
 *   remembered.
 * @returns the ref to put on the dialog element. Nothing else: the size is
 *   written to the element's own inline style rather than handed back as a
 *   React `style` prop, and that is deliberate. `.ze-paged-dialog` is
 *   `resize: both`, and a browser resize handle writes `width`/`height` into
 *   exactly that inline style — so a React-managed `style` would overwrite the
 *   user's drag on the next render (a keystroke in any field is one). Writing
 *   it imperatively, and only ever upward from what the element measures now,
 *   leaves the element's inline style the user's to change, which is what a
 *   resizable wxDialog is.
 */
export function usePagedDialogSize(
  pageKey: string,
  initial?: InitialSize,
  title?: string,
): (el: HTMLElement | null) => void {
  const elRef = useRef<HTMLElement | null>(null);
  const sized = useRef(false);

  const ref = useCallback(
    (el: HTMLElement | null) => {
      elRef.current = el;
      if (!el || sized.current || !initial) return;
      sized.current = true;

      // `DIALOG_SHIM::Show()`'s
      //     SetSize( …, max( GetSize().x, restoredSize.x ),
      //                 max( GetSize().y, restoredSize.y ), 0 )
      // — the remembered geometry raises the starting size and NOTHING else.
      // No `minWidth` here: the very next thing upstream does is
      // `SetMinSize( wxDefaultSize )`, so that the user can drag the dialog
      // below whatever was remembered.
      const saved = title ? readDialogGeometry(title) : undefined;
      el.style.width = `${Math.max(initial.width, saved?.w ?? 0)}px`;
      el.style.height = `${Math.max(initial.height, saved?.h ?? 0)}px`;
    },
    [initial?.width, initial?.height, title],
  );

  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;

    // (1) and (2): `SetMinSize( wxDefaultSize ); InvalidateBestSize();
    // GetBestSize()`. Clearing the inline width, height and minimum hands the
    // element back to `.ze-modal`'s `max-content` and to
    // `.ze-modal.ze-paged-dialog`'s 600 x 500 floor and 1500 x 900 failsafe,
    // which is where wx's own `IncTo`/`DecTo` pair lives here — so the answer
    // is the CURRENT page's requirement, already clamped, and no number in
    // this file states any of it.
    const held = { width: el.style.width, height: el.style.height };
    el.style.width = '';
    el.style.height = '';
    el.style.minWidth = '';
    el.style.minHeight = '';
    const min = bestSizeOf(el.getBoundingClientRect(), el.scrollWidth, el.clientWidth);
    el.style.width = held.width;
    el.style.height = held.height;

    // (3) `SetMinSize( minSize )` — the current page's, which is free to be
    // SMALLER than the last page's. That is what lets a narrower page be
    // dragged narrower.
    el.style.minWidth = `${min.w}px`;
    el.style.minHeight = `${min.h}px`;

    // (4) `newSize = GetSize(); newSize.IncTo( minSize ); SetSize( newSize )`.
    //
    // `GetSize()` is the window's real size, which wx has already forced to at
    // least the minimum. Here that is `max( inline width, min-width )`, which
    // is what the box measures now — so the `IncTo` has in a sense already
    // happened, and the work is writing the answer back to the inline width.
    //
    // That write is the load-bearing part, not a tidy-up. A `min-width` alone
    // renders the same size and then EVAPORATES: the next page lowers the
    // minimum and the box drops back to whatever the inline width still said,
    // which is the size two pages ago. The growth has to be recorded where a
    // falling minimum cannot reach it.
    const rect = el.getBoundingClientRect();
    const next = incTo({ w: Math.ceil(rect.width), h: Math.ceil(rect.height) }, min);
    el.style.width = `${next.w}px`;
    el.style.height = `${next.h}px`;

    // `SaveControlState` writes `ToDIP( GetSize() )` when the dialog closes.
    // Writing it as the size changes is the same end state and survives a tab
    // that is never "closed" in the wx sense.
    if (title) writeDialogGeometry(title, next);
  }, [pageKey, title]);

  return ref;
}
