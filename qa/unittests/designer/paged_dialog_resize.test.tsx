// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A paged dialog is ONE size, for every page, for its whole life.
 *
 * `.ze-modal` is `width: max-content`, so a paged dialog re-sizes itself on
 * every row of the tree unless something stops it. Preferences stopped it with
 * a stated size and a `min-width: 0` page area, and Board Setup and Schematic
 * Setup now use the same two pieces — the size coming from the subclass's own
 * the size the dialog STATES rather than from a measurement of the page.
 *
 * Every previous attempt here grew the dialog instead, which is what upstream
 * does (`newSize.IncTo( minSize )`, plus `DIALOG_SHIM`'s remembered geometry),
 * and every one of them was wrong in a way the user saw: a floor that could
 * only rise, a remembered size applied as a minimum, a grown size that
 * evaporated when the next page lowered the minimum. So these cases assert the
 * absence of growth, not its shape.
 *
 * happy-dom lays nothing out, so the element reports its own inline size when
 * it has one and the current page's requirement when it does not — which is
 * exactly the signal a growing implementation would act on. If any of it comes
 * back, these fail.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useState, type JSX } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { usePagedDialogSize } from '@ziroeda/designer/src/ui/paged_dialog_size.js';

/** What each page would "need" if anything were measuring. */
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

/**
 * Board Setup's stated size. [px] 1227 x 786, measured off a live dialog — NOT
 * `aInitialSize`'s `wxSize( 980, 600 )`, which is the size the window opens at
 * before `onPageChanged` grows it into the showing page and which no user sees.
 */
const INITIAL = { width: 1227, height: 786 };

function Harness(): JSX.Element {
  const [page, setPage] = useState('narrow');
  const ref = usePagedDialogSize(INITIAL);
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

describe('the size is the one the dialog states', () => {
  it('states it on the element, because .ze-modal would otherwise track the page', () => {
    const { el } = open();

    expect(el.style.width).toBe(`${INITIAL.width}px`);
    expect(el.style.height).toBe(`${INITIAL.height}px`);
  });

  it('sets no minimum of its own', () => {
    // A minimum written here is how the dialog got stuck: it can only be the
    // measured requirement of some page, and every version of that measurement
    // outlived the page it came from. The 600 x 500 floor and 1500 x 900
    // failsafe are `.ze-modal.ze-paged-dialog`'s, stated in CSS where they
    // need no measuring.
    const { el } = open();

    expect(el.style.minWidth).toBe('');
    expect(el.style.minHeight).toBe('');
  });
});

describe('walking the tree does not resize it', () => {
  it('stays put on a page that would need more room', () => {
    // The wide page "needs" 1200. It scrolls instead: `.ze-paged-panel` is
    // `min-width: 0`, so its content cannot push the dialog wider.
    const { el, go } = open();

    go('wide');

    expect(el.style.width).toBe(`${INITIAL.width}px`);
    expect(el.style.height).toBe(`${INITIAL.height}px`);
  });

  it('stays put on the way back, and on every page after', () => {
    const { el, go } = open();

    go('wide');
    go('narrow');
    go('wide');
    go('narrow');

    expect(el.style.width).toBe(`${INITIAL.width}px`);
    expect(el.style.height).toBe(`${INITIAL.height}px`);
  });

  it('leaves a size the user dragged to exactly where they left it', () => {
    // `.ze-paged-dialog` is `resize: both`, and a drag writes the same inline
    // style this hook writes on mount. Writing it again on any later render is
    // how a React-managed `style` would undo the drag.
    const { el, go } = open();

    el.style.width = '1240px';
    go('wide');
    go('narrow');

    expect(el.style.width).toBe('1240px');
  });
});

describe('nothing is remembered between opens', () => {
  it('opens the second time at the same size as the first', () => {
    const { el, go } = open();
    go('wide');
    el.style.width = '1240px';
    cleanup();

    const second = open();

    expect(second.el.style.width).toBe(`${INITIAL.width}px`);
  });

  it('writes no geometry to storage', () => {
    // `DIALOG_SHIM` persists `ToDIP( GetSize() )` per dialog title and we
    // deliberately do not: a remembered size is a size that can be wrong, and
    // ours was — a dialog grown by a layout bug opened at the grown size long
    // after the bug was fixed.
    const { go } = open();

    go('wide');
    go('narrow');

    expect(Object.keys(localStorage)).toHaveLength(0);
  });
});
