// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `col->SetMinWidth( headerMinWidth.x )` — the floor a LIB_TREE column may be
 * dragged to (`common/lib_tree_model_adapter.cpp:490-495`), with upstream's own
 * arithmetic for it (`:481-486`):
 *
 *     // The extent of the text doesn't take into account the space on either
 *     // side in the header, so artificially pad it
 *     wxSize headerMinWidth = KIUI::GetTextSize( translatedHeader + wxT( "MMM" ), m_widget );
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A FILE OF ITS OWN
 * ---------------------------------------------------------------------------
 *
 * The floor is a MEASUREMENT, and happy-dom measures nothing: `getContext('2d')`
 * returns null there, so the widget's `headerMinWidth` answers 0 and the clamp
 * has nothing to clamp — a drag to a negative width is then rejected by
 * `IsValidColumnWidth` instead, and a test in that environment cannot tell the
 * clamp from its absence. A mutation sweep found exactly that: removing
 * `Math.max( min, … )` changed nothing observable, because the guard downstream
 * was doing the work.
 *
 * So this file stubs a text-measuring canvas — and it has to be a separate file
 * to do it, because the widget caches each header's extent in a module-level
 * map the first time it is asked. A file that has already rendered a tree has
 * 0 cached for "Item" and cannot be un-taught it; vitest gives every file its
 * own module registry, and this one stubs before the first render.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { LibTree } from '@ziroeda/designer/src/widgets/lib_tree.js';
import { LibTreeModelAdapter } from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';
import { makeItemNode } from '@ziroeda/designer/src/widgets/lib_tree_model.js';

afterEach(cleanup);

/** Eight pixels a character, so a header's extent is a number this file can do
 *  arithmetic with. The widget asks for `header + "MMM"`. */
const PX_PER_CHAR = 8;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        font: '',
        measureText: (text: string) => ({ width: text.length * PX_PER_CHAR }),
      }) as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => vi.restoreAllMocks());

const mount = (): { root: HTMLElement; adapter: LibTreeModelAdapter } => {
  const adapter = new LibTreeModelAdapter();
  const lib = adapter.addLibrary('Device', '', false);
  makeItemNode(lib, 'Device', 'R');
  adapter.finishLibrary(lib);
  const { container } = render(
    <LibTree adapter={adapter} onSelect={() => {}} onChoose={() => {}} />,
  );
  return { root: container, adapter };
};

const headWidth = (root: HTMLElement, i: number): number =>
  Number.parseFloat(
    (root.querySelectorAll('.ze-libtree-cols > span')[i] as HTMLElement).style.width,
  );

const drag = (root: HTMLElement, i: number, from: number, to: number): void => {
  const head = root.querySelectorAll('.ze-libtree-cols > span')[i] as HTMLElement;
  fireEvent.mouseDown(head.querySelector('.ze-libtree-colgrip')!, { clientX: from });
  fireEvent.mouseMove(document, { clientX: to });
  fireEvent.mouseUp(document);
};

describe('a column stops at its own header', () => {
  /** `"Item" + "MMM"` is seven characters, so 56 px in this file's font. */
  const ITEM_MIN = 'ItemMMM'.length * PX_PER_CHAR;

  it('a drag well past the header text stops at the header text', () => {
    const { root, adapter } = mount();
    expect(headWidth(root, 0)).toBe(300);
    // 300 -> would be 20 unclamped, which is narrower than the word "Item".
    drag(root, 0, 300, 20);
    expect(headWidth(root, 0)).toBe(ITEM_MIN);
    expect(adapter.getColumnWidth('Item')).toBe(ITEM_MIN);
  });

  it('and a drag that stays above it is not clamped at all', () => {
    const { root } = mount();
    drag(root, 0, 300, 200);
    expect(headWidth(root, 0)).toBe(200);
  });

  /**
   * The floor is PER COLUMN — `doAddColumn` computes it from each column's own
   * header, so a wider header has a wider floor. One shared minimum would pass
   * the first case above and fail this one.
   */
  it('and each column has its own floor, from its own header', () => {
    const { root, adapter } = mount();
    drag(root, 1, 600, 10);
    const descMin = 'DescriptionMMM'.length * PX_PER_CHAR;
    expect(descMin).toBeGreaterThan(ITEM_MIN);
    expect(headWidth(root, 1)).toBe(descMin);
    expect(adapter.getColumnWidth('Description')).toBe(descMin);
  });
});
