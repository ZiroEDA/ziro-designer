// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_IMPORT_MANAGER` (symbol_import_manager.cpp): the selection/
 * dependency state machine behind "Import Symbol(s)" - ancestor
 * auto-selection, descendant cascade, conflicts, and `std::map`/`std::set`
 * (code-unit-sorted) iteration order.
 */
import { SYMBOL_IMPORT_MANAGER } from '@ziroeda/eeschema/symbol_import_manager.js';
import { describe, expect, it } from 'vitest';

/** B derives from A, C derives from B: a 3-level chain, plus a standalone D. */
function chainManager(): SYMBOL_IMPORT_MANAGER {
  const m = new SYMBOL_IMPORT_MANAGER();
  m.AddSymbol('C', 'B', false);
  m.AddSymbol('A', '', false);
  m.AddSymbol('D', '', false);
  m.AddSymbol('B', 'A', false);
  m.BuildDependencyMaps();
  return m;
}

describe('GetSymbolNames', () => {
  it('returns names in code-unit sorted order regardless of add order', () => {
    const m = chainManager();
    expect(m.GetSymbolNames()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('GetSymbolCount matches the number of added symbols', () => {
    expect(chainManager().GetSymbolCount()).toBe(4);
  });
});

describe('BuildDependencyMaps / GetParent / GetDirectDerivatives / IsDerived', () => {
  it('records the parent of a derived symbol and none for a root', () => {
    const m = chainManager();
    expect(m.GetParent('B')).toBe('A');
    expect(m.GetParent('C')).toBe('B');
    expect(m.GetParent('A')).toBe('');
    expect(m.IsDerived('B')).toBe(true);
    expect(m.IsDerived('A')).toBe(false);
  });

  it('lists direct derivatives, in the sorted-map build order', () => {
    const m = new SYMBOL_IMPORT_MANAGER();
    m.AddSymbol('Z_CHILD', 'A', false);
    m.AddSymbol('A_CHILD', 'A', false);
    m.AddSymbol('A', '', false);
    m.BuildDependencyMaps();
    // BuildDependencyMaps iterates m_symbols in name order, so A's
    // derivatives list is built in that order: 'A_CHILD' before 'Z_CHILD'.
    expect(m.GetDirectDerivatives('A')).toEqual(['A_CHILD', 'Z_CHILD']);
  });

  it('an unknown symbol has no derivatives', () => {
    expect(chainManager().GetDirectDerivatives('nope')).toEqual([]);
  });
});

describe('GetAncestors / GetDescendants', () => {
  it('walks the full ancestor chain, sorted', () => {
    const m = chainManager();
    expect([...m.GetAncestors('C')]).toEqual(['A', 'B']);
    expect([...m.GetAncestors('B')]).toEqual(['A']);
    expect([...m.GetAncestors('A')]).toEqual([]);
  });

  it('stops the ancestor walk at a parent name not in the symbol set', () => {
    const m = new SYMBOL_IMPORT_MANAGER();
    m.AddSymbol('B', 'MISSING', false);
    m.BuildDependencyMaps();
    expect([...m.GetAncestors('B')]).toEqual([]);
  });

  it('walks all descendants recursively, sorted', () => {
    const m = chainManager();
    expect([...m.GetDescendants('A')]).toEqual(['B', 'C']);
    expect([...m.GetDescendants('B')]).toEqual(['C']);
    expect([...m.GetDescendants('C')]).toEqual([]);
  });
});

describe('SetSymbolSelected', () => {
  it('selecting a derived symbol auto-selects its ancestors and reports them', () => {
    const m = chainManager();
    const changed = m.SetSymbolSelected('C', true);
    expect(changed.sort()).toEqual(['A', 'B']);
    expect(m.GetSymbolInfo('C')!.m_checked).toBe(true);
    expect(m.GetSymbolInfo('B')!.m_autoSelected).toBe(true);
    expect(m.GetSymbolInfo('A')!.m_autoSelected).toBe(true);
  });

  it('does not auto-select an ancestor that is already manually checked', () => {
    const m = chainManager();
    m.SetSymbolSelected('A', true);
    const changed = m.SetSymbolSelected('C', true);
    // A was already m_checked, so it's not reported as newly auto-selected.
    expect(changed).toEqual(['B']);
    expect(m.GetSymbolInfo('A')!.m_checked).toBe(true);
    expect(m.GetSymbolInfo('A')!.m_autoSelected).toBe(false);
  });

  it('deselecting recalculates auto-selection for every other symbol', () => {
    const m = chainManager();
    m.SetSymbolSelected('C', true); // checks C, auto-selects A and B
    const changed = m.SetSymbolSelected('C', false);
    expect(changed.sort()).toEqual(['A', 'B', 'D']);
    expect(m.GetSymbolInfo('C')!.m_checked).toBe(false);
    expect(m.GetSymbolInfo('B')!.m_autoSelected).toBe(false); // no longer needed
    expect(m.GetSymbolInfo('A')!.m_autoSelected).toBe(false);
  });

  it('is a no-op returning [] for an unknown symbol name', () => {
    expect(chainManager().SetSymbolSelected('nope', true)).toEqual([]);
  });
});

describe('GetSelectedDescendants / DeselectWithDescendants', () => {
  it('reports which selected descendants would be orphaned', () => {
    const m = chainManager();
    m.SetSymbolSelected('C', true); // checks C; A, B auto-selected
    expect(m.GetSelectedDescendants('A')).toEqual(['C']); // only C is m_checked
  });

  it('deselects a symbol and every descendant, then recalculates', () => {
    const m = chainManager();
    m.SetSymbolSelected('C', true);
    m.DeselectWithDescendants('A');
    expect(m.GetSymbolInfo('A')!.m_checked).toBe(false);
    expect(m.GetSymbolInfo('B')!.m_checked).toBe(false);
    expect(m.GetSymbolInfo('C')!.m_checked).toBe(false);
    expect(m.GetSymbolInfo('A')!.m_autoSelected).toBe(false);
    expect(m.GetSymbolInfo('B')!.m_autoSelected).toBe(false);
  });
});

describe('SelectAll / DeselectAll', () => {
  it('selects every symbol with no filter, and auto-selection stays off (all manual)', () => {
    const m = chainManager();
    m.SelectAll();
    for (const name of m.GetSymbolNames()) {
      expect(m.GetSymbolInfo(name)!.m_checked).toBe(true);
    }
    expect(m.GetManualSelectionCount()).toBe(4);
    expect(m.GetAutoSelectionCount()).toBe(0);
  });

  it('honours a filter', () => {
    const m = chainManager();
    m.SelectAll((name) => name === 'D');
    expect(m.GetSymbolInfo('D')!.m_checked).toBe(true);
    expect(m.GetSymbolInfo('A')!.m_checked).toBe(false);
  });

  it('deselects every symbol with no filter', () => {
    const m = chainManager();
    m.SelectAll();
    m.DeselectAll();
    expect(m.GetManualSelectionCount()).toBe(0);
    expect(m.GetAutoSelectionCount()).toBe(0);
  });
});

describe('GetSymbolsToImport / counts / GetConflicts', () => {
  it('includes both manually- and auto-selected symbols, sorted', () => {
    const m = chainManager();
    m.SetSymbolSelected('C', true);
    expect(m.GetSymbolsToImport()).toEqual(['A', 'B', 'C']);
  });

  it('counts manual and auto selections separately', () => {
    const m = chainManager();
    m.SetSymbolSelected('C', true);
    expect(m.GetManualSelectionCount()).toBe(1);
    expect(m.GetAutoSelectionCount()).toBe(2);
  });

  it('flags conflicts among selected symbols that exist in the destination', () => {
    const m = chainManager();
    m.CheckExistingSymbols((name) => name === 'B' || name === 'D');
    m.SetSymbolSelected('C', true); // selects C, B (conflict), A
    expect(m.GetConflicts()).toEqual(['B']);
  });
});

describe('MatchesFilter', () => {
  it('is true for an empty filter', () => {
    expect(SYMBOL_IMPORT_MANAGER.MatchesFilter('anything', '')).toBe(true);
  });

  it('is a case-insensitive substring match', () => {
    expect(SYMBOL_IMPORT_MANAGER.MatchesFilter('LM358', 'lm3')).toBe(true);
    expect(SYMBOL_IMPORT_MANAGER.MatchesFilter('LM358', 'xyz')).toBe(false);
  });
});

describe('Clear', () => {
  it('empties symbols and dependency maps', () => {
    const m = chainManager();
    m.Clear();
    expect(m.GetSymbolCount()).toBe(0);
    expect(m.GetSymbolNames()).toEqual([]);
    expect(m.GetParent('B')).toBe('');
    expect(m.GetDirectDerivatives('A')).toEqual([]);
  });
});
