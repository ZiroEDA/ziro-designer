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
  powerSymbolTest,
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

/**
 * The per-entry test cannot be right on its own, because `power` is absent for
 * two unrelated reasons and the entry does not say which.
 *
 * KiCad's standard set makes this concrete rather than theoretical: four
 * libraries match /power/i and only `power` holds power symbols, so the other
 * three get the key omitted for "none" and were then re-admitted wholesale by
 * the name guess.
 */
describe('reading the index as a whole, not one entry at a time', () => {
  // The shape the real index has: one library with flags, three without,
  // all four named /power/i.
  const INDEX: LibIndexEntry[] = [
    entry({ name: 'power', count: 3, symbols: ['VCC', 'GND', 'PWR_FLAG'], power: ['VCC', 'GND'] }),
    entry({ name: 'Power_Management', count: 1, symbols: ['NCP1117'] }),
    entry({ name: 'Power_Protection', count: 1, symbols: ['SMAJ5_0A'] }),
    entry({ name: 'Device', count: 1, symbols: ['R'] }),
  ];
  const isPower = powerSymbolTest(INDEX);

  it('still admits the flagged power symbols', () => {
    expect(isPower(INDEX[0]!, 'VCC')).toBe(true);
    expect(isPower(INDEX[0]!, 'GND')).toBe(true);
    expect(isPower(INDEX[0]!, 'PWR_FLAG')).toBe(false);
  });

  it('keeps ordinary parts out of a power-*named* library', () => {
    // The live bug: `Power_Management` has no power symbols, so the generator
    // omits `power`, so the per-entry fallback matched its *name* and put every
    // regulator in it into the Place Power Port chooser.
    expect(isPower(INDEX[1]!, 'NCP1117')).toBe(false);
    expect(isPower(INDEX[2]!, 'SMAJ5_0A')).toBe(false);
    // And the per-entry primitive still gets it wrong, which is why the
    // chooser must not call it directly.
    expect(isPowerSymbol(INDEX[1]!, 'NCP1117')).toBe(true);
  });

  it('and a library that was never power-named is unaffected', () => {
    expect(isPower(INDEX[3]!, 'R')).toBe(false);
  });

  it('falls back to the name only when the whole index lacks the flag', () => {
    // An index generated before the flag existed: no entry carries `power`, so
    // there is nothing better to go on and the guess is all there is.
    const old: LibIndexEntry[] = [
      entry({ name: 'power', symbols: ['VCC'] }),
      entry({ name: 'Device', symbols: ['R'] }),
    ];
    const guess = powerSymbolTest(old);
    expect(guess(old[0]!, 'VCC')).toBe(true);
    expect(guess(old[1]!, 'R')).toBe(false);
  });

  it('treats one flagged library as proof the index carries flags', () => {
    // The discriminator: a single `power` key anywhere means the generator knew
    // about the flag, so every other absence is a real "none".
    const mixed = powerSymbolTest([
      entry({ name: 'MyParts', symbols: ['+5VA'], power: ['+5VA'] }),
      entry({ name: 'power', symbols: ['VCC'] }),
    ]);
    expect(mixed(entry({ name: 'power', symbols: ['VCC'] }), 'VCC')).toBe(false);
  });

  it('and an empty index does not crash or claim anything', () => {
    expect(powerSymbolTest([])(entry({ name: 'Device' }), 'R')).toBe(false);
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
