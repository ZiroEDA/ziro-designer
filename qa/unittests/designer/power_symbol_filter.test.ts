// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Chooser's power filter, #102's one real claim.
 *
 * `LIB_SYMBOL::IsPower` is a property of the *symbol*, not of the library it
 * lives in. KiCad can filter on it directly because it holds the whole index in
 * memory; we load libraries lazily, so the flag has to travel with the index or
 * the filter is reduced to guessing from the library's name — which is wrong in
 * both directions.
 */
import { describe, it, expect } from 'vitest';
import {
  isPowerSymbol,
  type LibIndexEntry,
} from '@ziroeda/designer/src/editors/schematic/symbols/index.js';
import { LibTreeModelAdapter } from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';
import { LibTreeNode, LibTreeNodeType } from '@ziroeda/designer/src/widgets/lib_tree_model.js';

const entry = (over: Partial<LibIndexEntry> = {}): LibIndexEntry => ({
  name: 'Device',
  count: 2,
  symbols: ['R', 'C'],
  ...over,
});

describe('with power flags in the index', () => {
  const lib = entry({ name: 'power', symbols: ['VCC', 'GND', 'PWR_FLAG'], power: ['VCC', 'GND'] });

  it('admits a symbol the index marks as power', () => {
    expect(isPowerSymbol(lib, 'VCC')).toBe(true);
    expect(isPowerSymbol(lib, 'GND')).toBe(true);
  });

  it('rejects an ordinary symbol even in a library called "power"', () => {
    // The bug this fixes: the library name used to admit everything in it.
    expect(isPowerSymbol(lib, 'PWR_FLAG')).toBe(false);
  });

  it('admits a power symbol in a library not called "power"', () => {
    // The same bug in the other direction: previously hidden until the library
    // happened to be loaded.
    const custom = entry({ name: 'MyParts', symbols: ['+5VA'], power: ['+5VA'] });
    expect(isPowerSymbol(custom, '+5VA')).toBe(true);
  });

  it('treats an empty power list as "no power symbols here"', () => {
    const none = entry({ name: 'power', symbols: ['X'], power: [] });
    expect(isPowerSymbol(none, 'X')).toBe(false);
  });
});

describe('without power flags — an index generated before they existed', () => {
  it('falls back to the library name', () => {
    expect(isPowerSymbol(entry({ name: 'power', symbols: ['VCC'] }), 'VCC')).toBe(true);
    expect(isPowerSymbol(entry({ name: 'Device', symbols: ['R'] }), 'R')).toBe(false);
  });

  it('matches the name case-insensitively, as the old test did', () => {
    expect(isPowerSymbol(entry({ name: 'Power_Supply' }), 'anything')).toBe(true);
  });

  it('is a guess, and the flag overrides it', () => {
    // Same library name, opposite answers — which is the whole point of
    // carrying the flag.
    const guessed = entry({ name: 'power', symbols: ['PWR_FLAG'] });
    const known = entry({ name: 'power', symbols: ['PWR_FLAG'], power: [] });
    expect(isPowerSymbol(guessed, 'PWR_FLAG')).toBe(true);
    expect(isPowerSymbol(known, 'PWR_FLAG')).toBe(false);
  });
});

describe('the filter reaches the tree, not just the scores', () => {
  const makeTree = () => {
    const adapter = new LibTreeModelAdapter();
    const lib = adapter.addLibrary('power', '', false);
    for (const name of ['VCC', 'PWR_FLAG']) {
      const item = new LibTreeNode();
      item.type = LibTreeNodeType.ITEM;
      item.parent = lib;
      item.name = name;
      item.libNickname = 'power';
      item.isPower = name === 'VCC';
      lib.children.push(item);
    }
    adapter.finishLibrary(lib);
    const other = adapter.addLibrary('Device', '', false);
    const r = new LibTreeNode();
    r.type = LibTreeNodeType.ITEM;
    r.parent = other;
    r.name = 'R';
    r.libNickname = 'Device';
    other.children.push(r);
    adapter.finishLibrary(other);
    return { adapter, lib, other };
  };

  it('hides a non-power symbol with no search query', () => {
    // The bug: the flattening consulted scores only while searching, and the
    // filter only ever reached the display through scores — so with an empty
    // search box "Place Power Symbol" listed everything.
    const { adapter, lib } = makeTree();
    adapter.setFilter((n) => n.isPower);
    const [vcc, pwrFlag] = lib.children;
    expect(adapter.isVisible(vcc!, false)).toBe(true);
    expect(adapter.isVisible(pwrFlag!, false)).toBe(false);
  });

  it('hides a library with nothing matching, rather than showing an empty header', () => {
    const { adapter, lib, other } = makeTree();
    adapter.setFilter((n) => n.isPower);
    expect(adapter.isVisible(lib, false)).toBe(true);
    expect(adapter.isVisible(other, false)).toBe(false);
  });

  it('keeps an as-yet-unloaded library, whose symbols are unknown', () => {
    // It has no children to test, and hiding it would make a library the user
    // is about to open disappear.
    const { adapter } = makeTree();
    const unloaded = adapter.addLibrary('Connector', '', false);
    adapter.setFilter((n) => n.isPower);
    expect(unloaded.children.length).toBe(0);
    expect(adapter.isVisible(unloaded, false)).toBe(true);
  });

  it('still drops zero-score rows while a query is running', () => {
    const { adapter, lib } = makeTree();
    adapter.setFilter(null);
    const vcc = lib.children[0]!;
    vcc.score = 0;
    expect(adapter.isVisible(vcc, true)).toBe(false);
    expect(adapter.isVisible(vcc, false)).toBe(true);
  });

  it('shows everything when no filter is set', () => {
    const { adapter, lib, other } = makeTree();
    adapter.setFilter(null);
    expect(adapter.isVisible(lib, false)).toBe(true);
    expect(adapter.isVisible(other, false)).toBe(true);
    expect(adapter.isVisible(lib.children[1]!, false)).toBe(true);
  });
});
