// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `SYMBOL_TREE_MODEL_ADAPTER` (eeschema/symbol_tree_model_adapter.cpp):
 * the constructor's columns, `AddLibraries`' LOADED-only rule and its one
 * second retry timer, and the item nodes it builds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibTreeNode, LibTreeNodeType } from '@ziroeda/common/lib_tree_model.js';
import type { LibIndexEntry } from '@ziroeda/eeschema/libraries/symbol_library_adapter.js';
import type { LibTreeItem } from '@ziroeda/eeschema/lib_tree_item.js';
import {
  PENDING_LIBRARY_POLL_MS,
  SYMBOL_TREE_MODEL_ADAPTER,
  type SYMBOL_TREE_LIBRARY_SOURCE,
  addUnitRows,
  populateItemNode,
} from '@ziroeda/eeschema/symbol_tree_model_adapter.js';

const item = (name: string, over: Partial<LibTreeItem> = {}): LibTreeItem => ({
  name,
  description: `${name} description`,
  keywords: 'alpha beta',
  footprint: '',
  isPower: false,
  isRoot: true,
  pinCount: 2,
  unitCount: 1,
  chooserFields: [],
  ...over,
});

const INDEX: LibIndexEntry[] = [
  { name: 'Device', count: 2, symbols: ['R', 'C'], units: { C: 3 } } as LibIndexEntry,
  {
    name: 'power',
    count: 1,
    symbols: ['GND'],
    descr: 'Power symbols',
    units: { GND: 2 },
  } as LibIndexEntry,
];

function source(loaded: Set<string>, pinned: string[] = []): SYMBOL_TREE_LIBRARY_SOURCE {
  return {
    libraryLoaded: (lib) => loaded.has(lib),
    loadedLibraryItems: (lib) =>
      // The power library's items are not resident, so its rows carry the
      // index's power flag rather than a loaded item's.
      lib === 'Device' ? [item('R'), item('C', { unitCount: 3 })] : [],
    libraryDescription: (lib) => lib.descr ?? '',
    pinnedLibraries: () => pinned,
    powerSymbolTest: () => (entry, name) => entry.name === 'power' && name === 'GND',
  };
}

const libNames = (a: SYMBOL_TREE_MODEL_ADAPTER): string[] =>
  a.tree.children.filter((n) => n.type === LibTreeNodeType.LIBRARY).map((n) => n.name);

describe('SYMBOL_TREE_MODEL_ADAPTER constructor', () => {
  it('offers Value and Footprint, and takes the persisted sort mode and columns', () => {
    const a = new SYMBOL_TREE_MODEL_ADAPTER({ sortMode: 1, columns: ['Item', 'Value'] });
    expect(a.getAvailableColumns()).toContain('Value');
    expect(a.getAvailableColumns()).toContain('Footprint');
    expect(a.getSortMode()).toBe(1);
    expect(a.getShownColumns()).toEqual(['Item', 'Value']);
  });
});

describe('AddLibraries', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('adds only LOADED libraries and retries the rest every second', () => {
    const loaded = new Set(['Device']);
    const a = new SYMBOL_TREE_MODEL_ADAPTER({ sortMode: 0, columns: [] });
    const passes = vi.fn();
    a.SetLazyLoadHandler(passes);
    a.AddLibraries(INDEX, source(loaded));

    expect(libNames(a)).toEqual(['Device']);
    expect(a.PendingLibraries().map((l) => l.name)).toEqual(['power']);
    expect(passes).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PENDING_LIBRARY_POLL_MS - 1);
    expect(passes).toHaveBeenCalledTimes(1);

    loaded.add('power');
    vi.advanceTimersByTime(1);
    // The retry adds to the tree already built: Device is not added twice.
    expect(libNames(a).sort()).toEqual(['Device', 'power']);
    expect(a.PendingLibraries()).toEqual([]);
    expect(passes).toHaveBeenCalledTimes(2);

    // Nothing pending: the timer is stopped.
    vi.advanceTimersByTime(5 * PENDING_LIBRARY_POLL_MS);
    expect(passes).toHaveBeenCalledTimes(2);
  });

  it('builds the items: pinned flag, description, power flag and index unit rows', () => {
    const a = new SYMBOL_TREE_MODEL_ADAPTER({ sortMode: 0, columns: [] });
    a.AddLibraries(INDEX, source(new Set(['Device', 'power']), ['power']));
    const power = a.tree.children.find((n) => n.name === 'power')!;
    const device = a.tree.children.find((n) => n.name === 'Device')!;
    expect(power.pinned).toBe(true);
    expect(device.pinned).toBe(false);
    expect(power.desc).toBe('Power symbols');
    expect(power.children[0]!.isPower).toBe(true);
    // Not resident: the unit rows come from the index's count alone.
    expect(power.children[0]!.children.map((u) => u.unit)).toEqual([1, 2]);
    const c = device.children.find((n) => n.name === 'C')!;
    expect(c.children.map((u) => u.name)).toEqual(['Unit A', 'Unit B', 'Unit C']);
    expect(c.desc).toBe('C description');
  });

  it('StopPendingTimer ends the retries', () => {
    const a = new SYMBOL_TREE_MODEL_ADAPTER({ sortMode: 0, columns: [] });
    const passes = vi.fn();
    a.SetLazyLoadHandler(passes);
    a.AddLibraries(INDEX, source(new Set())); // nothing loaded
    a.StopPendingTimer();
    vi.advanceTimersByTime(10 * PENDING_LIBRARY_POLL_MS);
    expect(passes).toHaveBeenCalledTimes(1);
  });
});

describe('the item nodes', () => {
  it('cacheSearchTerms: nickname 4, name 8, LIB_ID 16, each keyword 4, keywords 1, description 1', () => {
    const node = new LibTreeNode();
    node.type = LibTreeNodeType.ITEM;
    node.name = 'R';
    node.libNickname = 'Device';
    node.libItemName = 'R';
    populateItemNode(node, item('R', { footprint: 'Resistor_SMD:R_0603' }));
    expect(node.sourceSearchTerms.map((t) => t.score)).toEqual([4, 8, 16, 4, 4, 1, 1, 1]);
    expect(node.fields.get('Keywords')).toBe('alpha beta');
  });

  it('addUnitRows adds a row per unit and is idempotent', () => {
    const node = new LibTreeNode();
    addUnitRows(node, 1);
    expect(node.children).toEqual([]);
    addUnitRows(node, 2);
    addUnitRows(node, 2);
    expect(node.children.map((u) => [u.name, u.unit, u.intrinsicRank])).toEqual([
      ['Unit A', 1, -1],
      ['Unit B', 2, -2],
    ]);
  });
});
