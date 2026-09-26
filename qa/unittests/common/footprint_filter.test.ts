// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_LIST` / `FOOTPRINT_INFO` (common/footprint_info.cpp) and
 * `FOOTPRINT_FILTER` (common/footprint_filter.cpp), over pcbnew's
 * FOOTPRINT_LIST_IMPL. Orders and rules are read off the C++.
 */
import { FOOTPRINT_FILTER } from '@ziroeda/common/footprint_filter.js';
import { FOOTPRINT_LIST_IMPL } from '@ziroeda/pcbnew/footprint_info_impl.js';
import { describe, expect, it } from 'vitest';

const list = (): FOOTPRINT_LIST_IMPL => {
  const l = new FOOTPRINT_LIST_IMPL();
  l.ReadFootprintIndex([
    { name: 'Resistor_SMD', footprints: ['R_0805', 'R_0603', 'R_Array_4'], pads: [2, 2, 8] },
    { name: 'Capacitor_SMD', footprints: ['C_0805', 'C_10'], pads: [2, 2] },
    { name: 'capacitor_lower', footprints: ['C_0402'], pads: [2] },
  ]);
  return l;
};
const ids = (it: Iterable<{ GetLibNickname(): string; GetFootprintName(): string }>) =>
  [...it].map((fp) => `${fp.GetLibNickname()}:${fp.GetFootprintName()}`);

describe('FOOTPRINT_LIST_IMPL', () => {
  it('is sorted by operator<: nickname then name, StrNumCmp, case counted', () => {
    // StrNumCmp( …, false ): "Capacitor_SMD" < "Resistor_SMD" < "capacitor_lower"
    // (upper case first), and a digit run compares as a number: C_10 (10) comes
    // before C_0805 (805).
    expect(ids(list().GetList())).toEqual([
      'Capacitor_SMD:C_10',
      'Capacitor_SMD:C_0805',
      'Resistor_SMD:R_0603',
      'Resistor_SMD:R_0805',
      'Resistor_SMD:R_Array_4',
      'capacitor_lower:C_0402',
    ]);
  });

  it('GetFootprintInfo finds by LIB_ID or by nickname and name; an empty name never', () => {
    const l = list();
    expect(l.GetFootprintInfo('Resistor_SMD:R_0603')?.GetUniquePadCount()).toBe(2);
    expect(l.GetFootprintInfo('Resistor_SMD', 'R_Array_4')?.GetPadCount()).toBe(8);
    expect(l.GetFootprintInfo('Resistor_SMD:Nope')).toBeNull();
    expect(l.GetFootprintInfo('')).toBeNull();
    expect(l.GetFootprintInfo('Resistor_SMD', '')).toBeNull();
  });
});

describe('FOOTPRINT_FILTER', () => {
  it('unfiltered walks the whole list', () => {
    expect(ids(new FOOTPRINT_FILTER(list()))).toHaveLength(6);
  });

  it('by library: an empty name filters nothing', () => {
    const f = new FOOTPRINT_FILTER(list());
    f.FilterByLibrary('Capacitor_SMD');
    expect(ids(f)).toEqual(['Capacitor_SMD:C_10', 'Capacitor_SMD:C_0805']);
    const g = new FOOTPRINT_FILTER(list());
    g.FilterByLibrary('');
    expect(ids(g)).toHaveLength(6);
  });

  it('by pin count, which a negative count never matches', () => {
    const f = new FOOTPRINT_FILTER(list());
    f.FilterByPinCount(8);
    expect(ids(f)).toEqual(['Resistor_SMD:R_Array_4']);
    const g = new FOOTPRINT_FILTER(list());
    g.FilterByPinCount(-1);
    expect(ids(g)).toEqual([]);
  });

  it('by footprint filters: anchored, case-insensitive, nickname only with a colon', () => {
    const f = new FOOTPRINT_FILTER(list());
    f.FilterByFootprintFilters(['r_0?0?']);
    expect(ids(f)).toEqual(['Resistor_SMD:R_0603', 'Resistor_SMD:R_0805']);
    const g = new FOOTPRINT_FILTER(list());
    g.FilterByFootprintFilters(['CAPACITOR_*:C_*']);
    expect(ids(g)).toEqual([
      'Capacitor_SMD:C_10',
      'Capacitor_SMD:C_0805',
      'capacitor_lower:C_0402',
    ]);
    // Anchored: a pattern matching only part of the name does not match.
    const h = new FOOTPRINT_FILTER(list());
    h.FilterByFootprintFilters(['0805']);
    expect(ids(h)).toEqual([]);
    // …at the end too: "r_0" is a prefix of every resistor, and matches none.
    const k = new FOOTPRINT_FILTER(list());
    k.FilterByFootprintFilters(['r_0']);
    expect(ids(k)).toEqual([]);
  });

  it('ClearFilters forgets them', () => {
    const f = new FOOTPRINT_FILTER(list());
    f.FilterByPinCount(8);
    f.ClearFilters();
    expect(ids(f)).toHaveLength(6);
  });
});
