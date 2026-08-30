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
 * `.ze-modal` is `width: max-content`, so it tracks the CURRENT page and
 * shrinks the moment a smaller one is selected. This hook is `IncTo`: it
 * measures the content after each page change and keeps a floor that never
 * comes down.
 *
 * The 600 x 500 floor and 1500 x 900 ceiling live in `.ze-modal.ze-paged-dialog`
 * rather than here, since CSS can state a range without measuring anything.
 * Note the asymmetry in the C++, which is deliberate and not a typo: `IncTo`
 * on the floor RAISES the minimum to at least 600 x 500, and `DecTo` on the
 * failsafe LOWERS it back to at most 1500 x 900.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** What the caller puts on the dialog element. */
export interface PagedDialogSize {
  /** Grows, never shrinks — `newSize.IncTo( minSize )`. */
  readonly style: { readonly minWidth?: number; readonly minHeight?: number };
  /** Attach to the element whose content decides the size. */
  readonly ref: (el: HTMLElement | null) => void;
}

/**
 * @param pageKey changes when the page does, which is when upstream recomputes.
 */
export function usePagedDialogSize(pageKey: string): PagedDialogSize {
  const elRef = useRef<HTMLElement | null>(null);
  const [floor, setFloor] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const ref = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
  }, []);

  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    // `GetBestSize()` after `InvalidateBestSize()`: what this page needs now.
    const rect = el.getBoundingClientRect();
    setFloor((prev) => {
      // `IncTo` — componentwise max, so neither axis can come down.
      const w = Math.max(prev.w, Math.ceil(rect.width));
      const h = Math.max(prev.h, Math.ceil(rect.height));
      return w === prev.w && h === prev.h ? prev : { w, h };
    });
  }, [pageKey]);

  return {
    ref,
    style: {
      ...(floor.w > 0 ? { minWidth: floor.w } : {}),
      ...(floor.h > 0 ? { minHeight: floor.h } : {}),
    },
  };
}
