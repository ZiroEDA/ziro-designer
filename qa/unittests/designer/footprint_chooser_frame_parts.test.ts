// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The parts of FOOTPRINT_CHOOSER_FRAME a screenshot against KiCad showed
 * missing: the "-- Recently Used --" group, the library rows' descriptions,
 * and the history rule behind the group.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  addFootprintToHistory,
  clearFootprintHistory,
  footprintHistory,
} from '@ziroeda/designer/src/editors/pcb/widgets/footprint_history.js';
import {
  addFootprintHistory,
  addFootprintLibraries,
} from '@ziroeda/designer/src/editors/pcb/widgets/fp_tree_model_adapter.js';
import {
  footprintLibraryDescription,
  symbolLibraryDescription,
} from '@ziroeda/designer/src/widgets/lib_table_descriptions.js';
import { LibTreeModelAdapter } from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';
import type { FpIndexEntry } from '@ziroeda/designer/src/widgets/footprint_list.js';

const INDEX: FpIndexEntry[] = [
  { name: 'Battery', footprints: ['BatteryClip_A', 'BatteryClip_B'], pads: [2, 2] },
  { name: 'Resistor_SMD', footprints: ['R_0805'], pads: [2], descr: ['Resistor SMD 0805'] },
];

describe('s_FootprintHistoryList', () => {
  beforeEach(clearFootprintHistory);

  it('inserts at the front and drops the duplicate', () => {
    addFootprintToHistory('A:1');
    addFootprintToHistory('B:2');
    addFootprintToHistory('A:1');
    expect([...footprintHistory()]).toEqual(['A:1', 'B:2']);
  });

  it('holds seven, because the trim is `>= s_FootprintHistoryMaxCount` (8)', () => {
    for (let i = 0; i < 12; i++) addFootprintToHistory(`L:${i}`);
    expect(footprintHistory().length).toBe(7);
    expect(footprintHistory()[0]).toBe('L:11');
  });
});

describe('the Recently Used group', () => {
  it('is built even when the history is empty, and sorts first', () => {
    const a = new LibTreeModelAdapter();
    addFootprintHistory(a, INDEX, []);
    addFootprintLibraries(a, INDEX);
    const group = a.tree.children.find((n) => n.name === '-- Recently Used --');
    expect(group).toBeDefined();
    expect(group!.isRecentlyUsedGroup).toBe(true);
    expect(group!.children.length).toBe(0);
  });

  it('lists the history in history order, with the index’s description', () => {
    const a = new LibTreeModelAdapter();
    addFootprintHistory(a, INDEX, ['Resistor_SMD:R_0805', 'Battery:BatteryClip_B']);
    const group = a.tree.children.find((n) => n.name === '-- Recently Used --')!;
    expect(group.children.map((c) => `${c.libNickname}:${c.libItemName}`)).toEqual([
      'Resistor_SMD:R_0805',
      'Battery:BatteryClip_B',
    ]);
    expect(group.children[0]!.desc).toBe('Resistor SMD 0805');
  });

  it('skips a LIB_ID the index does not have, as a failed load is skipped', () => {
    const a = new LibTreeModelAdapter();
    addFootprintHistory(a, INDEX, ['Gone:Nothing', 'Battery:BatteryClip_A']);
    const group = a.tree.children.find((n) => n.name === '-- Recently Used --')!;
    expect(group.children.length).toBe(1);
  });
});

describe('the library rows’ descriptions', () => {
  it('are the fp-lib-table’s `(descr …)`, not empty', () => {
    const a = new LibTreeModelAdapter();
    addFootprintLibraries(a, INDEX);
    const battery = a.tree.children.find((n) => n.name === 'Battery')!;
    expect(battery.desc).toBe('Battery and battery holder footprints');
  });

  it('come from the two shipped tables, verbatim', () => {
    // [data] the installed KiCad's own strings; a re-run of the vendoring
    // script is the only legitimate way these change.
    expect(footprintLibraryDescription('Battery')).toBe('Battery and battery holder footprints');
    expect(symbolLibraryDescription('Device')).toBe('Generic symbols for common devices');
    expect(footprintLibraryDescription('NoSuchLib')).toBe('');
  });

  it('the vendoring script exists, so the table is regenerated and not hand-edited', () => {
    const script = fileURLToPath(
      new URL('../../../designer/scripts/vendor-lib-table-descr.mjs', import.meta.url),
    );
    expect(existsSync(script)).toBe(true);
    const out = readFileSync(
      fileURLToPath(
        new URL('../../../designer/src/widgets/lib_table_descriptions.ts', import.meta.url),
      ),
      'utf8',
    );
    expect(out).toContain('GENERATED');
  });
});
