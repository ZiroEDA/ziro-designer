// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The library tree renders only the rows on screen.
 *
 * Upstream gets this for free: `wxDataViewCtrl` is a virtual control and
 * `LIB_TREE_MODEL_ADAPTER` is a `wxDataViewModel`, so the control asks
 * `GetValue` for the cells it is about to paint and for no others. That is why
 * KiCad can hold the whole 22 784-symbol standard set in the chooser and still
 * scroll it at frame rate.
 *
 * Ours rendered `rows.map(...)` in full. With the libraries expanded that put
 * 23 007 row elements — about 92 000 elements once each row's twisty and cells
 * are counted — into the document, and every scored keystroke re-rendered all
 * of them. It is the direct cause of both the scroll stall and the second-long
 * pause after typing.
 *
 * happy-dom does no layout, so the geometry the window is computed from is
 * stubbed below. That is the point of the test rather than a limitation of it:
 * the row pitch and the viewport height are exactly the two inputs, and pinning
 * the arithmetic against known values is what tells a working window from one
 * that silently falls back to rendering everything.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { LibTree } from '@ziroeda/designer/src/widgets/lib_tree.js';
import { LibTreeModelAdapter } from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';
import { makeItemNode } from '@ziroeda/designer/src/widgets/lib_tree_model.js';

/**
 * The row height and viewport the stubs report.
 *
 * `ROW_H` is `LIB_TREE::SetRowHeight`'s `FromDIP( 6 ) + GetTextExtent( "pdI" ).y`
 * = 24 on this theme, which `qa/probes/libtree_rowheight_probe.cpp` measured and
 * `--ui-text-height` / `--libtree-row-pad` in shell.css record. happy-dom
 * resolves no stylesheet, so the `row-gap` the widget reads comes back empty
 * and the pitch is the row height alone — hence GAP, which the expectations
 * below carry explicitly rather than assuming away.
 */
const ROW_H = 24;
const GAP = 0;
const PITCH = ROW_H + GAP;
/** A list pane 400 px tall, about what the chooser's sash leaves it. */
const VIEWPORT = 400;
/** `ROW_OVERSCAN` in lib_tree.tsx: rows kept beyond each edge. */
const OVERSCAN = 12;

const LIBRARY = 'Device';
const ITEMS = 5000;

/** One library holding `ITEMS` symbols, expanded — 1 + ITEMS flattened rows. */
function bigAdapter(): LibTreeModelAdapter {
  const adapter = new LibTreeModelAdapter();
  const lib = adapter.addLibrary(LIBRARY, '', false);
  for (let i = 0; i < ITEMS; i++) makeItemNode(lib, LIBRARY, `Sym${String(i).padStart(5, '0')}`);
  adapter.finishLibrary(lib);
  return adapter;
}

let restore: (() => void)[] = [];

beforeEach(() => {
  // happy-dom puts getBoundingClientRect on Element and clientHeight on
  // HTMLElement; stubbing the wrong one is silently shadowed by the real one.
  const rectDesc = Object.getOwnPropertyDescriptor(
    globalThis.Element.prototype,
    'getBoundingClientRect',
  );
  const heightDesc = Object.getOwnPropertyDescriptor(
    globalThis.HTMLElement.prototype,
    'clientHeight',
  );

  // Every element reports ROW_H tall; only `.ze-libtree-row` is ever measured.
  Object.defineProperty(globalThis.Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: Element) {
      return { height: ROW_H, width: 300, top: 0, left: 0, right: 300, bottom: ROW_H, x: 0, y: 0 };
    },
  });
  // The scroll container reports the viewport; nothing else reads clientHeight.
  Object.defineProperty(globalThis.HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
      return this.classList.contains('ze-libtree-list') ? VIEWPORT : 0;
    },
  });

  restore = [
    () => {
      if (rectDesc)
        Object.defineProperty(globalThis.Element.prototype, 'getBoundingClientRect', rectDesc);
    },
    () => {
      if (heightDesc)
        Object.defineProperty(globalThis.HTMLElement.prototype, 'clientHeight', heightDesc);
    },
  ];
});

afterEach(() => {
  cleanup();
  for (const r of restore) r();
});

function mount() {
  const result = render(
    <LibTree
      adapter={bigAdapter()}
      openLibs={[LIBRARY]}
      onSelect={() => {}}
      onChoose={() => {}}
    />,
  );
  const list = result.container.querySelector('.ze-libtree-list') as HTMLElement;
  return { ...result, list };
}

/** The window the widget builds: `ceil(viewport / pitch) + 2 * overscan`. */
const WINDOW = Math.ceil(VIEWPORT / PITCH) + 2 * OVERSCAN;

describe('the library tree row list', () => {
  it('puts only a window of rows in the DOM, not all 5001', () => {
    const { container } = mount();
    const rendered = container.querySelectorAll('.ze-libtree-row');

    // first = max(0, floor(0 / 24) - 12) = 0, so the window starts at the top.
    expect(rendered.length).toBe(WINDOW);
    // The thing this exists to prevent.
    expect(rendered.length).toBeLessThan(1 + ITEMS);
  });

  it('reserves the height of the rows it did not render, so the scrollbar is honest', () => {
    const { list } = mount();
    const spacers = [...list.children].filter((c) => !c.classList.contains('ze-libtree-row'));

    // Nothing above the window, so one spacer only, below it.
    expect(spacers.length).toBe(1);
    const rest = 1 + ITEMS - WINDOW;
    expect((spacers[0] as HTMLElement).style.height).toBe(`${rest * PITCH - GAP}px`);
  });

  it('moves the window when the pane is scrolled', () => {
    const { list, container } = mount();

    act(() => {
      list.scrollTop = 1000 * PITCH;
      fireEvent.scroll(list);
    });

    const first = 1000 - OVERSCAN;
    const rows = container.querySelectorAll('.ze-libtree-row');
    expect(rows.length).toBe(WINDOW);
    // Row 0 of the flattened list is the library; item i is at index i + 1.
    expect(rows[0]?.textContent).toContain(`Sym${String(first - 1).padStart(5, '0')}`);

    // The spacer above holds the rows that are no longer there, so the row the
    // user is looking at still lands at `index * pitch`.
    const above = list.children[0] as HTMLElement;
    expect(above.classList.contains('ze-libtree-row')).toBe(false);
    expect(above.style.height).toBe(`${first * PITCH - GAP}px`);
  });

  it('drops the trailing spacer at the end of the list rather than over-reserving', () => {
    const { list, container } = mount();

    act(() => {
      // Past the end; the window clamps to the last rows.
      list.scrollTop = (1 + ITEMS) * PITCH;
      fireEvent.scroll(list);
    });

    const first = 1 + ITEMS - OVERSCAN;
    expect(container.querySelectorAll('.ze-libtree-row').length).toBe(OVERSCAN);
    const spacers = [...list.children].filter((c) => !c.classList.contains('ze-libtree-row'));
    expect(spacers.length).toBe(1);
    expect((spacers[0] as HTMLElement).style.height).toBe(`${first * PITCH - GAP}px`);
  });
});
