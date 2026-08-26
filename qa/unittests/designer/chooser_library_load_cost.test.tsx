// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What expanding a library in the chooser costs.
 *
 * Upstream this is free: `LIB_TREE::ExpandAll` (common/widgets/lib_tree.cpp:426-431)
 * walks the dataview and expands items, and `SYMBOL_TREE_MODEL_ADAPTER::AddLibraries`
 * reads `m_adapter->GetSymbols( lib )` out of the resident library manager
 * (eeschema/symbol_tree_model_adapter.cpp:148). Both are possible only because
 * `IFACE::PreloadLibraries` already ran.
 *
 * Ours loads on demand, so `onToggleLibrary` is the hook that pays. Two things
 * about it are load-bearing and neither was pinned:
 *
 *  1. **Expand All must not fire it.** It used to fire for every library in the
 *     tree, which against the hosted set is all 223 of them -- 219.7 MB.
 *  2. **Restored `open_libs` must fire it.** They seed `expanded` so the rows
 *     LOOK open, but the owner was never told, so a restored library sat there
 *     showing bare names. Upstream restores them through
 *     `PANEL_SYMBOL_CHOOSER::onOpenLibsTimer` ->
 *     `LIB_TREE_MODEL_ADAPTER::OpenLibs` (panel_symbol_chooser.cpp:534-538).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LibTree } from '@ziroeda/designer/src/widgets/lib_tree.js';
import { LibTreeModelAdapter } from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';
import {
  LibTreeNode,
  LibTreeNodeType,
} from '@ziroeda/designer/src/widgets/lib_tree_model.js';

afterEach(cleanup);

/**
 * A tree of libraries, each holding one single-unit part and one two-unit part.
 * Built the way `PanelSymbolChooser`'s index pass builds it
 * (panel_symbol_chooser.tsx:294-310), because Expand All has to open the unit
 * rows too: `LIB_TREE::ExpandAll` (common/widgets/lib_tree.cpp:426-431) calls
 * `ExpandChildren` on the whole control, not just the top level.
 */
function treeOf(...libs: string[]): LibTreeModelAdapter {
  const adapter = new LibTreeModelAdapter();
  for (const lib of libs) {
    const libNode = adapter.addLibrary(lib, `${lib} description`, false);
    for (const [name, units] of [
      ['R', 1],
      ['LM358', 2],
    ] as const) {
      const item = new LibTreeNode();
      item.type = LibTreeNodeType.ITEM;
      item.parent = libNode;
      item.name = name;
      item.libNickname = lib;
      item.libItemName = name;
      for (let u = 1; u <= units && units > 1; ++u) {
        const unit = new LibTreeNode();
        unit.type = LibTreeNodeType.UNIT;
        unit.parent = item;
        unit.name = `Unit ${String.fromCharCode(64 + u)}`;
        unit.unit = u;
        unit.libNickname = lib;
        unit.libItemName = name;
        item.children.push(unit);
      }
      libNode.children.push(item);
    }
    adapter.finishLibrary(libNode);
  }
  adapter.tree.assignIntrinsicRanks();
  return adapter;
}

/** The library / item / unit rows currently drawn. */
function rowNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.ze-libtree-row .col-item')].map(
    (el) => el.textContent ?? '',
  );
}

/**
 * A library with no children: one whose symbols have not been fetched yet.
 * That is exactly the state the lazy-load hook exists for, and it is NOT the
 * same fixture as `treeOf` -- a library that already has items gets expanded on
 * mount, because `regenerate` runs `expandAncestors` on the adapter's best
 * match (lib_tree.tsx:113-126, upstream `LIB_TREE::Regenerate` selecting and
 * revealing the best match).
 */
function bareTreeOf(...libs: string[]): LibTreeModelAdapter {
  const adapter = new LibTreeModelAdapter();
  for (const lib of libs) adapter.addLibrary(lib, `${lib} description`, false);
  return adapter;
}

describe('Expand All', () => {
  it('opens every library AND every multi-unit part, loading none of them', () => {
    // Both halves in one test on purpose. Asserting only "nothing was loaded"
    // is satisfied by doing nothing at all -- a mutant that replaced
    // `setExpanded(all)` with `setExpanded(new Set())` passed it, and the
    // absence was pinned while the behaviour was not.
    const onToggleLibrary = vi.fn();
    const { container } = render(
      <LibTree
        adapter={treeOf('Device', 'power')}
        onSelect={() => {}}
        onChoose={() => {}}
        onToggleLibrary={onToggleLibrary}
      />,
    );

    // Collapsed to begin with: two library rows and nothing beneath them.
    expect(rowNames(container)).toEqual(['Device', 'power']);

    fireEvent.click(screen.getByTitle('Sort and expand options'));
    fireEvent.click(screen.getByText('Expand All'));

    const after = rowNames(container);
    // Every library, every part, and the unit rows of the two-unit part.
    for (const lib of ['Device', 'power']) expect(after).toContain(lib);
    expect(after.filter((n) => n === 'R')).toHaveLength(2);
    expect(after.filter((n) => n === 'LM358')).toHaveLength(2);
    expect(after.filter((n) => n === 'Unit A')).toHaveLength(2);
    expect(after.filter((n) => n === 'Unit B')).toHaveLength(2);

    // And not one library was handed to the lazy-load hook.
    expect(onToggleLibrary).not.toHaveBeenCalled();
  });

  it('Collapse All puts them all back', () => {
    const { container } = render(
      <LibTree adapter={treeOf('Device', 'power')} onSelect={() => {}} onChoose={() => {}} />,
    );
    fireEvent.click(screen.getByTitle('Sort and expand options'));
    fireEvent.click(screen.getByText('Expand All'));
    expect(rowNames(container).length).toBeGreaterThan(2);
    fireEvent.click(screen.getByTitle('Sort and expand options'));
    fireEvent.click(screen.getByText('Collapse All'));
    expect(rowNames(container)).toEqual(['Device', 'power']);
  });

  it('but one twisty still does, because that IS the lazy-load hook', () => {
    const onToggleLibrary = vi.fn();
    const { container } = render(
      <LibTree
        adapter={bareTreeOf('Device')}
        onSelect={() => {}}
        onChoose={() => {}}
        onToggleLibrary={onToggleLibrary}
      />,
    );
    const twisty = container.querySelector('.ze-libtree-row.lib .twisty');
    expect(twisty).not.toBeNull();
    fireEvent.click(twisty!);
    expect(onToggleLibrary).toHaveBeenCalledTimes(1);
    expect(onToggleLibrary.mock.calls[0]?.[1]).toBe(true);
  });
});

describe('libraries restored from open_libs', () => {
  it('are handed to the owner on mount, so they are actually loaded', () => {
    const onToggleLibrary = vi.fn();
    render(
      <LibTree
        adapter={treeOf('Device', 'power', 'Connector_Generic')}
        openLibs={['Device', 'power']}
        onSelect={() => {}}
        onChoose={() => {}}
        onToggleLibrary={onToggleLibrary}
      />,
    );
    const opened = onToggleLibrary.mock.calls.map((c) => (c[0] as { name: string }).name).sort();
    expect(opened).toEqual(['Device', 'power']);
    for (const call of onToggleLibrary.mock.calls) expect(call[1]).toBe(true);
  });

  it('and a name no library in the tree carries is skipped, not passed on', () => {
    const onToggleLibrary = vi.fn();
    render(
      <LibTree
        adapter={treeOf('Device')}
        openLibs={['Device', 'a library that was removed from the table']}
        onSelect={() => {}}
        onChoose={() => {}}
        onToggleLibrary={onToggleLibrary}
      />,
    );
    expect(onToggleLibrary).toHaveBeenCalledTimes(1);
  });
});

describe('enriching one library is one request', () => {
  /**
   * Scoped to `ensureLibraryLoaded`'s own body rather than to the file, because
   * the rule is per-occurrence: `loadSymbol` is still the right call in
   * `onSelect`, three functions below, where it fetches the ONE part being
   * placed. What must not come back is the per-item loop this used to be.
   *
   * Measured, against the bucket: "Device" is 536 symbols, so the loop was
   * 536 requests / 2,486,139 B / 94.2 s at 6 in flight, against 1 request /
   * 2,414,640 B / 1.9 s for the library file. Same bytes, 536x the round trips.
   */
  // `import.meta.url` is not a file: URL under happy-dom, so the path is
  // resolved from vitest's root (`qa/`) instead.
  const src = readFileSync(
    resolve(process.cwd(), '../designer/src/editors/schematic/widgets/panel_symbol_chooser.tsx'),
    'utf8',
  );
  const start = src.indexOf('const ensureLibraryLoaded = useCallback(');
  const end = src.indexOf('[adapter, onItemCountChanged],', start);
  const body = src.slice(start, end);

  it('is found at all, so a rename fails here rather than silently passing', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('fetches the library, not each of its symbols', () => {
    expect(body).toContain('loadLibrarySymbols(libNickname)');
    expect(body).not.toMatch(/loadSymbol\(/);
    // And no fan-out: one await, not a Promise.all over the item nodes.
    expect(body).not.toMatch(/Promise\.all/);
  });
});
