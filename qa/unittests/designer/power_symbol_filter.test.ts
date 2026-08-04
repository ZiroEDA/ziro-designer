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
