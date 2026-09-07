// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * How a `PAGED_DIALOG` is sized when the page changes — stated once, because
 * upstream states it once.
 *
 * `PAGED_DIALOG::UpdateResetButton`'s tail (common/widgets/paged_dialog.cpp:
 * 424-451) runs on every page change:
 *
 *     m_treebook->InvalidateBestSize();
 *     SetMinSize( wxDefaultSize );
 *     wxSize minSize = GetBestSize();
 *     minSize.IncTo( FromDIP( wxSize(  600, 500 ) ) );
 *     minSize.DecTo( FromDIP( wxSize( 1500, 900 ) ) );   // Failsafe
 *     ...
 *     SetMinSize( minSize );
 *
 *     wxSize currentSize = GetSize();
 *     wxSize newSize = currentSize;
 *     newSize.IncTo( minSize );
 *     if( newSize != currentSize )
 *         SetSize( newSize );
 *
 * The last four lines are the whole behaviour, and they are easy to read past:
 * `IncTo` is a componentwise MAXIMUM, so the dialog only ever GROWS. A page
 * needing more room enlarges it; a smaller page afterwards leaves it exactly
 * where it was. The dialog therefore settles at the largest page the user has
 * visited and stops moving — it does not resize itself under them each time
 * they click a row in the tree.
 *
 * That matters here because a CSS dialog does the opposite by default:
 * `.ze-modal` is `width: max-content`, so it tracks the CURRENT page and both
 * shrinks and GROWS the moment another one is selected. A floor cannot fix the
 * second half — `max-content` goes above a `min-width` as happily as below it —
 * so the size itself is stated, from the subclass's own `aInitialSize`, and
 * this hook is the `IncTo` floor on top of it: it measures the content after
 * each page change and keeps a minimum that never comes down.
 *
 * The 600 x 500 floor and 1500 x 900 ceiling live in `.ze-modal.ze-paged-dialog`
 * rather than here, since CSS can state a range without measuring anything.
 * Note the asymmetry in the C++, which is deliberate and not a typo: `IncTo`
 * on the floor RAISES the minimum to at least 600 x 500, and `DecTo` on the
 * failsafe LOWERS it back to at most 1500 x 900.
 */
import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * `DIALOG_SHIM`'s remembered geometry (`common/dialog_shim.cpp:445-483` to read,
 * `:554` on close to write) — the half of the size rule that was missing here,
 * and the reason a real Board Setup appears never to resize.
 *
 * Upstream, `Show()` looks up `m_dialogControlValues[key]["__geometry"]` and
 * `SetSize()`s the dialog to it before it is ever painted; the key is
 * `getDialogKeyFromTitle( GetTitle() )` (`:79-93`), the title with any trailing
 * " (…)" removed. So a user who has grown Board Setup once — by visiting the
 * Physical Stackup page, which needs more width than the stated
 * `wxSize( 980, 600 )` — gets that larger size on every later open and never
 * sees it move again. We had `IncTo`'s grow-only half and not this, so every
 * open started at 980 and re-grew on the first click.
 *
 * Ours is localStorage, which is where this app's settings live.
 */
/**
 * The stored geometry is only ever GROWN (`IncTo`), which is right while the
 * layout is right — and a trap while it is not: a dialog that blew up because
 * of a layout bug keeps the blown-up size for that user forever, and fixing the
 * bug does nothing they can see. `DIALOG_SHIM` has the same property upstream;
 * it just does not ship layout fixes to a running browser.
 *
 * The epoch is the answer: bump it in the same commit as a fix that should make
 * dialogs smaller, and every stored size from before it is ignored once. It is
 * NOT a schema version — the shape has not changed — so old entries are simply
 * left to be evicted rather than migrated.
 *
 * v2: the Text & Graphics Defaults grid was ~260 px wider than upstream's
 * (no column widths, and "(mm)" appended to every header), and
 * `.ze-grid-pane` let that width reach the dialog.
 */
const GEOMETRY_EPOCH = 'v2';
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
 * `Fit()` then `newSize.IncTo( minSize )` (`paged_dialog.cpp:427-443`), as
 * arithmetic, so it can be checked without a layout engine.
 *
 * @param aRect the box the dialog currently occupies.
 * @param aScrollWidth / @param aClientWidth the dialog element's own pair. Their
 *   difference is the width the content needs and did not get; a descendant
 *   that scrolls deliberately keeps its overflow to itself and contributes 0.
 * @param aFloor the running `IncTo` floor, which never comes down.
 */
export function fitFloor(
  aRect: { width: number; height: number },
  aScrollWidth: number,
  aClientWidth: number,
  aFloor: { w: number; h: number },
): { w: number; h: number } {
  const shortfall = Math.max(0, aScrollWidth - aClientWidth);
  return {
    w: Math.max(aFloor.w, Math.ceil(aRect.width + shortfall)),
    h: Math.max(aFloor.h, Math.ceil(aRect.height)),
  };
}

export function usePagedDialogSize(
  pageKey: string,
  initial?: InitialSize,
  /** The dialog's title, which is `DIALOG_SHIM`'s geometry key. */
  title?: string,
): (el: HTMLElement | null) => void {
  const elRef = useRef<HTMLElement | null>(null);
  const sized = useRef(false);
  const floor = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  const ref = useCallback(
    (el: HTMLElement | null) => {
      elRef.current = el;
      if (!el || sized.current || !initial) return;
      sized.current = true;

      // `DIALOG_SHIM::Show()` restores the remembered geometry BEFORE the
      // dialog is painted, and only falls back to `aInitialSize` when there is
      // none (`dialog_shim.cpp:445-510`). Opening at the size this dialog
      // already grew to is what stops it moving under the user on the first
      // page click — the `IncTo` floor below then has nothing left to do.
      const saved = title ? readDialogGeometry(title) : undefined;
      floor.current = saved ?? { w: 0, h: 0 };
      el.style.width = `${saved?.w ?? initial.width}px`;
      el.style.height = `${saved?.h ?? initial.height}px`;
      if (saved) {
        el.style.minWidth = `${saved.w}px`;
        el.style.minHeight = `${saved.h}px`;
      }
    },
    [initial?.width, initial?.height, title],
  );

  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    // `GetBestSize()` after `InvalidateBestSize()`: what this page needs now.
    const rect = el.getBoundingClientRect();

    // A page whose unscrolled chrome is wider than the dialog is exactly the
    // case `Fit()` exists for: wx GROWS the window to the sizer's minimum,
    // never clips. Measuring only the box we already drew could not see that —
    // the box IS the stated `aInitialSize`, and the content silently overflowed
    // it. Board Setup states `wxSize( 980, 600 )` and a real one opens ~1070
    // wide, because the Physical Stackup page's top row does not fit in 980.
    const { w, h } = fitFloor(rect, el.scrollWidth, el.clientWidth, floor.current);
    if (w === floor.current.w && h === floor.current.h) return;
    floor.current = { w, h };
    if (w > 0) el.style.minWidth = `${w}px`;
    if (h > 0) el.style.minHeight = `${h}px`;
    // `DIALOG_SHIM` writes the geometry back when the dialog closes; writing it
    // as it grows is the same end state and survives a tab that is never
    // "closed" in the wx sense.
    if (title && w > 0 && h > 0) writeDialogGeometry(title, { w, h });
  }, [pageKey, title]);

  return ref;
}
