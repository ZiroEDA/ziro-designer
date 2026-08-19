// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Library-tree model + adapter (counterparts common/lib_tree_model.cpp and
 * common/lib_tree_model_adapter.cpp): search scoring, best-match/alphabetic
 * sorting, group and pinned-library ordering, and unit sub-nodes.
 */
import { describe, it, expect } from 'vitest';
import { searchTerm } from '@ziroeda/common/src/eda_pattern_match.js';
import { strNumCmp } from '@ziroeda/common/src/string_utils.js';
import {
  LibTreeNode,
  LibTreeNodeType,
  makeItemNode,
  makeUnitNode,
} from '@ziroeda/designer/src/widgets/lib_tree_model.js';
import {
  LibTreeModelAdapter,
  SortMode,
} from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';

function addItem(lib: LibTreeNode, name: string, keywords = '', desc = ''): LibTreeNode {
  const item = makeItemNode(lib, lib.name, name);
  item.desc = desc;
  // The item's own terms; AssignIntrinsicRanks rebuilds `searchTerms` from
  // these plus the shown columns' values, exactly as upstream does.
  item.sourceSearchTerms = [
    searchTerm(lib.name, 4),
    searchTerm(name, 8, true),
    searchTerm(`${lib.name}:${name}`, 16, true),
    ...keywords
      .split(/\s+/)
      .filter(Boolean)
      .map((kw) => searchTerm(kw, 4)),
    searchTerm(keywords, 1),
    searchTerm(desc, 1),
  ];
  item.rebuildSearchTerms([]);
  return item;
}

function buildAdapter(): LibTreeModelAdapter {
  const adapter = new LibTreeModelAdapter();
  const device = adapter.addLibrary('Device', '', false);
  addItem(device, 'R', 'res resistor', 'Resistor');
  addItem(device, 'C', 'cap capacitor', 'Unpolarized capacitor');
  addItem(device, 'R_Variable', 'resistor variable', 'Variable resistor');
  const logic = adapter.addLibrary('74xGxx', '', false);
  addItem(logic, '74LVC1GU04DRL', 'single inverter', 'Single inverter gate');
  device.assignIntrinsicRanks();
  logic.assignIntrinsicRanks();
  adapter.tree.assignIntrinsicRanks();
  return adapter;
}

describe('LibTreeModelAdapter search', () => {
  it('selects the exact name match over longer incidental matches', () => {
    const adapter = buildAdapter();
    const best = adapter.updateSearchString('R');
    expect(best?.libId).toBe('Device:R');
    expect(best?.exactMatch).toBe(true);
  });

  it('hides non-matching items (score 0) and keeps matching ones', () => {
    const adapter = buildAdapter();
    adapter.updateSearchString('resistor');
    const device = adapter.tree.children.find((l) => l.name === 'Device')!;
    const byName = new Map(device.children.map((c) => [c.name, c.score]));
    expect(byName.get('R')).toBeGreaterThan(0);
    expect(byName.get('R_Variable')).toBeGreaterThan(0);
    expect(byName.get('C')).toBe(0);
  });

  it('requires every token to match (AND semantics)', () => {
    const adapter = buildAdapter();
    adapter.updateSearchString('resistor variable');
    const device = adapter.tree.children.find((l) => l.name === 'Device')!;
    const r = device.children.find((c) => c.name === 'R')!;
    const rvar = device.children.find((c) => c.name === 'R_Variable')!;
    expect(r.score).toBe(0);
    expect(rvar.score).toBeGreaterThan(0);
  });

  it('sorts alphabetically when the sort mode says so', () => {
    const adapter = buildAdapter();
    adapter.setSortMode(SortMode.ALPHABETIC);
    adapter.updateSearchString('');
    const device = adapter.tree.children.find((l) => l.name === 'Device')!;
    expect(device.children.map((c) => c.name)).toEqual(['C', 'R', 'R_Variable']);
  });
});

describe('LibTreeModelAdapter columns and fallbacks', () => {
  it('keeps Item first and makes shown columns searchable', () => {
    const adapter = buildAdapter();
    const device = adapter.tree.children.find((l) => l.name === 'Device')!;
    const r = device.children.find((c) => c.name === 'R')!;
    r.fields.set('Manufacturer', 'Yageo');
    adapter.addColumnIfNecessary('Manufacturer');
    expect(adapter.getAvailableColumns()).toContain('Manufacturer');

    // Not a shown column yet: its value is not scored.
    adapter.updateSearchString('yageo');
    expect(r.score).toBe(0);

    adapter.setShownColumns(['Manufacturer', 'Item']);
    expect(adapter.getShownColumns()[0]).toBe('Item');
    adapter.updateSearchString('yageo');
    expect(r.score).toBeGreaterThan(0);
  });

  it('counts the group libraries in the item count, like GetItemCount', () => {
    const adapter = buildAdapter();
    const before = adapter.getItemCount();
    const recent = adapter.addGroup('-- Recently Used --');
    recent.isRecentlyUsedGroup = true;
    makeItemNode(recent, 'Device', 'R');
    expect(adapter.getItemCount()).toBe(before + 1);
  });

  it('falls back to the first item when only one library is present', () => {
    const adapter = new LibTreeModelAdapter();
    const only = adapter.addLibrary('Device', '', false);
    addItem(only, 'R');
    addItem(only, 'C');
    adapter.finishLibrary(only);
    // No query and no preselect: showResults expands the single library.
    expect(adapter.updateSearchString('')?.name).toBe('C');
  });

  it('shows nothing by default when several libraries could be expanded', () => {
    const adapter = buildAdapter();
    expect(adapter.updateSearchString('')).toBeNull();
  });
});

describe('LibTreeNode ordering', () => {
  it('keeps the Recently Used group on top, then pinned libraries', () => {
    const adapter = buildAdapter();
    const recent = adapter.addGroup('-- Recently Used --');
    recent.isRecentlyUsedGroup = true;
    makeItemNode(recent, 'Device', 'R');
    const pinned = adapter.addLibrary('Connector', '', true);
    addItem(pinned, 'Conn_01x02');
    adapter.tree.assignIntrinsicRanks();
    adapter.updateSearchString('');
    const names = adapter.tree.children.map((n) => n.name);
    expect(names[0]).toBe('-- Recently Used --');
    expect(names[1]).toBe('Connector');
  });

  it('keeps unit sub-nodes in unit order and inherits match state', () => {
    const parent = new LibTreeNode();
    parent.type = LibTreeNodeType.ROOT;
    const lib = new LibTreeNode();
    lib.type = LibTreeNodeType.LIBRARY;
    lib.name = 'Amplifier_Operational';
    lib.parent = parent;
    parent.children.push(lib);
    const item = addItem(lib, 'LM324', 'quad opamp', 'Quad operational amplifier');
    makeUnitNode(item, 'Unit A', 1);
    makeUnitNode(item, 'Unit B', 2);
    const adapter = new LibTreeModelAdapter();
    adapter.tree.children.push(...parent.children);
    adapter.updateSearchString('lm324');
    expect(item.children.map((u) => u.name)).toEqual(['Unit A', 'Unit B']);
    expect(item.children.every((u) => u.score > 0)).toBe(true);
  });
});

/**
 * LIB_TREE_NODE::AssignIntrinsicRanks sorts with `StrNumCmp( a, b, true ) > 0`
 * (common/lib_tree_model.cpp:68) — a codepoint walk with a numeric-run rule,
 * NOT ICU collation. The two disagree on names that differ only in case, on
 * leading symbols and underscores, on hyphen vs underscore, on leading zeros
 * in a digit run, and on accented letters. Every list below is one the user
 * reads in the chooser.
 */
function displayedOrder(names: readonly string[]): string[] {
  const lib = new LibTreeNode();
  lib.type = LibTreeNodeType.LIBRARY;
  for (const name of names) makeItemNode(lib, 'Lib', name);
  lib.assignIntrinsicRanks();
  lib.sortNodes(false);
  return lib.children.map((n) => n.name);
}

describe('LibTreeNode intrinsic ranking follows StrNumCmp, not ICU collation', () => {
  it('orders the power library by codepoint, so + sorts before -', () => {
    // ICU gives -5V, -12V, #PWR, +3V3, +5V, +12V, …; KiCad walks codepoints,
    // where '#'(0x23) < '+'(0x2B) < '-'(0x2D).
    expect(displayedOrder(['+5V', '-12V', 'GND', '#PWR', '+3V3', '-5V', '+12V'])).toEqual([
      '#PWR',
      '+3V3',
      '+5V',
      '+12V',
      '-5V',
      '-12V',
      'GND',
    ]);
  });

  it('sorts a hyphen before a digit and both before an underscore', () => {
    // ICU treats '-' as a variable-weight separator and files R-Array_Convex
    // last; KiCad has '-'(0x2D) < '0'(0x30) < '_'(0x5F), so it comes first.
    expect(
      displayedOrder([
        'R_0603_1608Metric',
        'R-Array_Convex_2x0603',
        'R_0402_1005Metric',
        'R_Array_Concave_2x0603',
        'R_01005_0402Metric',
      ]),
    ).toEqual([
      'R-Array_Convex_2x0603',
      'R_0402_1005Metric',
      'R_0603_1608Metric',
      'R_01005_0402Metric',
      'R_Array_Concave_2x0603',
    ]);
  });

  it('files a leading underscore, tilde and accent after the plain letters', () => {
    // ICU folds 'Å' onto 'A' and gives leading punctuation a low weight, so it
    // returns _local_cache, ~scratch, Amplifier_Audio, Ångström_Parts, …
    expect(
      displayedOrder([
        '~scratch',
        'Connector_JST',
        '_local_cache',
        'Ångström_Parts',
        'Amplifier_Audio',
        'Connector-PhoenixContact',
      ]),
    ).toEqual([
      'Amplifier_Audio',
      'Connector-PhoenixContact',
      'Connector_JST',
      '_local_cache',
      '~scratch',
      'Ångström_Parts',
    ]);
  });

  it('compares digit runs numerically but keeps the underscore after them', () => {
    // ICU (numeric: true) puts LED_09/LED_9 first because '_' outranks a digit.
    expect(displayedOrder(['LED_9', 'LED10', 'LED9'])).toEqual(['LED9', 'LED10', 'LED_9']);
  });

  it('ignores case, so the lowercase stock libraries interleave', () => {
    // `power` and `pspice` are lowercase in a stock KiCad install. Case-
    // sensitively 'R'(0x52) < 'p'(0x70) and they would both sink to the bottom.
    expect(displayedOrder(['Relay', 'power', 'RF', 'Regulator_Linear', 'pspice'])).toEqual([
      'power',
      'pspice',
      'Regulator_Linear',
      'Relay',
      'RF',
    ]);
  });

  it('ties names that differ only in case or in a leading zero', () => {
    // StrNumCmp( …, true ) returns 0 for these; ICU broke the tie by falling
    // back to a case-sensitive locale compare, inventing an order KiCad has no
    // opinion about.
    expect(strNumCmp('device', 'Device', true)).toBe(0);
    expect(strNumCmp('R10', 'R010', true)).toBe(0);
    expect(strNumCmp('LED_9', 'LED_09', true)).toBe(0);
  });
});
