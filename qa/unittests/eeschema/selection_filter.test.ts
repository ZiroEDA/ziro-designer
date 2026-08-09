// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Selection filter (SCH_SELECTION_FILTER_OPTIONS + itemPassesFilter): locked
 * symbols are unselectable unless `lockedItems` is on, and each item-type
 * category gates its kinds.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import {
  defaultSelectionFilter,
  applySelectionFilter,
  clickTarget,
  itemPassesFilter,
} from '@ziroeda/eeschema/src/tools/sch_selection_filter.js';

const doc = readSchematic(
  parse(`(kicad_sch (version 20231120) (generator "test") (lib_symbols)
    (symbol (lib_id "Device:R") (at 10 10 0) (unit 1) (locked yes)
      (property "Reference" "R1" (at 0 0 0)) (property "Value" "1k" (at 0 0 0)) (uuid "r1"))
    (symbol (lib_id "Device:R") (at 20 10 0) (unit 1)
      (property "Reference" "R2" (at 0 0 0)) (property "Value" "1k" (at 0 0 0)) (uuid "r2"))
    (wire (pts (xy 10 10) (xy 20 10)) (uuid "w1"))
    (label "NET" (at 15 10 0) (uuid "l1")))`),
);

describe('applySelectionFilter', () => {
  it('drops a locked symbol by default, keeps it when lockedItems is on', () => {
    const all = new Set(['r1', 'r2', 'w1', 'l1']);
    const def = applySelectionFilter(doc, all, defaultSelectionFilter());
    expect(def.has('r1')).toBe(false); // locked
    expect(def.has('r2')).toBe(true);

    const withLocked = applySelectionFilter(doc, all, {
      ...defaultSelectionFilter(),
      lockedItems: true,
    });
    expect(withLocked.has('r1')).toBe(true);
  });

  it('gates each item type by its category', () => {
    const noWires = { ...defaultSelectionFilter(), wires: false };
    expect(itemPassesFilter(doc, 'w1', noWires)).toBe(false);
    expect(itemPassesFilter(doc, 'l1', noWires)).toBe(true);

    const noSymbols = { ...defaultSelectionFilter(), symbols: false };
    expect(itemPassesFilter(doc, 'r2', noSymbols)).toBe(false);

    const noLabels = { ...defaultSelectionFilter(), labels: false };
    expect(itemPassesFilter(doc, 'l1', noLabels)).toBe(false);
  });
});

describe('clickTarget (collectSelectable + narrowSelection)', () => {
  const noPins = { ...defaultSelectionFilter(), pins: false };

  it('passes an item the filter accepts straight through', () => {
    expect(clickTarget(doc, 'w1', defaultSelectionFilter())).toBe('w1');
    expect(clickTarget(doc, 'r2:pin0', defaultSelectionFilter())).toBe('r2:pin0');
  });

  it('resolves a pin to its symbol when Pins is off', () => {
    // "If pins are disabled in the filter, they will be removed later. Let's
    // add the parent so that people can use pins to select symbols in this
    // case." — SCH_SELECTION_TOOL::collectSelectable.
    expect(clickTarget(doc, 'r2:pin0', noPins)).toBe('r2');
  });

  it('does not resurrect a pin whose symbol the filter also rejects', () => {
    // R1 is locked, so the promoted parent fails the filter in its own right.
    expect(clickTarget(doc, 'r1:pin0', noPins)).toBe(null);
    expect(clickTarget(doc, 'r2:pin0', { ...noPins, symbols: false })).toBe(null);
  });

  it('rejects a filtered-out item that is not a pin', () => {
    expect(clickTarget(doc, 'w1', { ...defaultSelectionFilter(), wires: false })).toBe(null);
  });
});
