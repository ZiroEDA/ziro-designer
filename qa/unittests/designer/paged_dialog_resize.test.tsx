// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `usePagedDialogSize` driven through an actual page change, because the bug
 * it exists to avoid is not visible in either half on its own.
 *
 * `PAGED_DIALOG::onPageChanged` (`common/widgets/paged_dialog.cpp:424-451`)
 * keeps TWO quantities and they move differently:
 *
 *     SetMinSize( wxDefaultSize );          // clear it FIRST
 *     wxSize minSize = GetBestSize();       // the CURRENT page, because
 *                                           // SetFitToCurrentPage( true )
 *     SetMinSize( minSize );                // free to be SMALLER than before
 *
 *     wxSize currentSize = GetSize();
 *     wxSize newSize = currentSize;
 *     newSize.IncTo( minSize );             // the window only ever grows
 *
 * and `DIALOG_SHIM::Show()` (`dialog_shim.cpp:445-495`) restores the
 * remembered geometry as a SIZE, then immediately does
 * `SetMinSize( wxDefaultSize ); InvalidateBestSize(); SetMinSize( GetBestSize() )`
 * with the comment "Reset minimum size so the user can resize the dialog
 * smaller than the saved size."
 *
 * Ours had folded the two into one running maximum and persisted it, so a
 * dialog that grew once for a wide page could never be narrower again — not on
 * the next page, not on the next open, and not after the page itself was
 * fixed. That is a state no assertion on `bestSizeOf` or `incTo` alone can
 * reach.
 *
 * happy-dom lays nothing out, so the page's width is stubbed: the element
 * reports whatever the current page needs when its inline width is cleared,
 * which is exactly what `GetBestSize()` answers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useState, type JSX } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import {
  usePagedDialogSize,
  writeDialogGeometry,
} from '@ziroeda/designer/src/ui/paged_dialog_size.js';

/** What each page "needs", by page key — the stubbed `GetBestSize()`. */
const PAGE_SIZE: Record<string, { w: number; h: number }> = {
  narrow: { w: 700, h: 520 },
  wide: { w: 1200, h: 640 },
};

let current = 'narrow';
let realRect: typeof Element.prototype.getBoundingClientRect;

beforeEach(() => {
  localStorage.clear();
  current = 'narrow';
  realRect = Element.prototype.getBoundingClientRect;
  // The element reports its inline width when it has one, the current page's
  // requirement when it does not — which is the whole point of the measurement
  // pass clearing the inline size before it asks — and never less than its own
  // `min-width`.
  //
  // That last clause is what makes a floor bug visible at all. Without it the
  // element's reported size is independent of `min-width`, every assertion
  // still reads the same numbers, and a version of this hook that pins the
  // remembered size as a minimum passes the whole file. Three mutants survived
  // exactly that way before it was added.
  Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const need = PAGE_SIZE[current]!;
    const px = (v: string): number => (v.endsWith('px') ? Number.parseFloat(v) : 0);
    const w = Math.max(px(this.style.minWidth), px(this.style.width) || need.w);
    const h = Math.max(px(this.style.minHeight), px(this.style.height) || need.h);
    return { width: w, height: h, x: 0, y: 0, top: 0, left: 0, right: w, bottom: h } as DOMRect;
  } as typeof Element.prototype.getBoundingClientRect;
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  cleanup();
  localStorage.clear();
});

const INITIAL = { width: 980, height: 600 };

function Harness(): JSX.Element {
  const [page, setPage] = useState('narrow');
  const ref = usePagedDialogSize(page, INITIAL, 'Board Setup');
  current = page;
  return (
    <div ref={ref} data-testid="dlg">
      <button type="button" onClick={() => setPage('wide')}>
        wide
      </button>
      <button type="button" onClick={() => setPage('narrow')}>
        narrow
      </button>
    </div>
  );
}

function open(): { el: HTMLElement; go: (p: 'narrow' | 'wide') => void } {
  const { getByTestId, getByText } = render(<Harness />);
  const el = getByTestId('dlg');
  return {
    el,
    go: (p) => {
      current = p;
      act(() => {
        getByText(p).click();
      });
    },
  };
}

describe('the remembered geometry is a size, not a floor', () => {
  it('opens at the larger of aInitialSize and what was stored', () => {
    // `SetSize( …, max( GetSize().x, restoredSize.x ), max( …y, …y ) )`.
    writeDialogGeometry('Board Setup', { w: 1300, h: 700 });

    const { el } = open();

    expect(el.style.width).toBe('1300px');
    expect(el.style.height).toBe('700px');
  });

  it('does not let the stored size become a minimum', () => {
    // The three lines after the restore exist only to stop exactly this:
    // `SetMinSize( wxDefaultSize ); InvalidateBestSize(); SetMinSize( GetBestSize() )`.
    // With the stored 1300 as a floor, a user could neither drag the dialog
    // back nor see a layout fix that made the page narrower.
    writeDialogGeometry('Board Setup', { w: 1300, h: 700 });

    const { el } = open();

    expect(el.style.minWidth).toBe('700px');
    expect(el.style.minHeight).toBe('520px');
  });

  it('lets a page that has since been made narrower be narrow again', () => {
    // The regression, end to end: a stored size from before a layout fix must
    // bound nothing. The dialog opens wide because that is where the user left
    // it, and the minimum is the page's own, so it can come back down.
    writeDialogGeometry('Board Setup', { w: 1300, h: 700 });

    const { el, go } = open();
    el.style.width = '760px'; // the user drags it in, which the minimum allows

    expect(Number.parseFloat(el.style.minWidth)).toBeLessThan(760);
    // …and the next click in the tree leaves it there, rather than snapping it
    // back up to the size that was remembered.
    go('narrow');
    expect(el.style.width).toBe('760px');
  });
});

describe('the minimum tracks the page and the size only grows', () => {
  it('takes the first page’s requirement as the minimum', () => {
    const { el } = open();

    expect(el.style.minWidth).toBe('700px');
    // 980 is `aInitialSize` and it is larger than the page needs, so the
    // window stays there: `newSize.IncTo( minSize )` changes nothing.
    expect(el.style.width).toBe('980px');
  });

  it('grows the window to a page that needs more than it', () => {
    const { el, go } = open();

    go('wide');

    expect(el.style.minWidth).toBe('1200px');
    expect(el.style.width).toBe('1200px');
  });

  it('lowers the minimum on the way back but leaves the window where it is', () => {
    // Both halves in one assertion, and they disagree — which is the point.
    // `SetMinSize` is recomputed from the current page and comes DOWN; `IncTo`
    // is a maximum and the window does not.
    const { el, go } = open();

    go('wide');
    go('narrow');

    expect(el.style.minWidth).toBe('700px');
    expect(el.style.width).toBe('1200px');
  });

  it('respects a size the user dragged to rather than a size it remembers', () => {
    // `currentSize = GetSize()` reads the LIVE window. A running high-water
    // mark here would snap the user's drag back on their next click in the
    // tree.
    const { el, go } = open();

    go('wide');
    el.style.width = '800px'; // dragged in, still above the narrow page's 700
    go('narrow');

    expect(el.style.width).toBe('800px');
  });
});

describe('what is written back', () => {
  it('stores the size the window ended at, not the page minimum', () => {
    // `SaveControlState` writes `ToDIP( GetSize() )`.
    const { el, go } = open();

    go('wide');
    go('narrow');

    expect(el.style.width).toBe('1200px');
    const raw = localStorage.getItem('ze-dialog-geometry:v3:Board Setup');
    expect(raw && (JSON.parse(raw) as { w: number }).w).toBe(1200);
  });

  it('ignores a size stored under the previous epoch', () => {
    // v3 retires every size grown while Constraints was too wide and while
    // this hook was storing a floor.
    localStorage.setItem('ze-dialog-geometry:v2:Board Setup', JSON.stringify({ w: 1330, h: 700 }));

    const { el } = open();

    expect(el.style.width).toBe('980px');
  });
});
