// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_SHEET_PATH / SCH_SHEET_LIST symbol gathering on the live model (sch_sheet_path.cpp:619-680,
 * 1336-1470). The hierarchy expectations are kicad-cli's own netlist of the same project.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import {
  SCH_REFERENCE_LIST,
  type SCH_MULTI_UNIT_REFERENCE_MAP,
} from '@ziroeda/eeschema/sch_reference_list.js';
import { SYMBOL_FILTER } from '@ziroeda/eeschema/sch_sheet_path.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The files kicad-cli made the netlist from: the old format, whose root keeps every instance's
// reference in `symbol_instances` (the per-file .pass1 re-saves lost that table).
const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const NETLIST = join(ORACLE, 'complex_hierarchy.kicad-cli.net');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch'];
const DIR = '/complex_hierarchy';

const hooks: SCH_EDIT_FRAME_HOOKS = {
  crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
  highlightNet: () => {},
  syncSelection: () => {},
  assignFootprints: () => {},
  saveProject: () => true,
  getNetlist: () => null,
};

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function openHierarchy(): SCHEMATIC {
  const frame = new SCH_EDIT_FRAME(hooks);
  frame.OpenProjectFiles([`${DIR}/${SHEETS[0]}`], 0, (p) => {
    const n = SHEETS.find((s) => p === `${DIR}/${s}`);
    return n ? readFileSync(join(ORACLE, n), 'utf8') : null;
  });
  return frame.Schematic();
}

/** kicad-cli's components by sheet path name: one comp per reference, units merged. */
function netlistComps(): Map<string, string[]> {
  const text = readFileSync(NETLIST, 'utf8');
  const comps = text.slice(text.indexOf('(components'), text.indexOf('(libparts'));
  const out = new Map<string, string[]>();

  for (const c of comps.split('\t\t(comp\n').slice(1)) {
    const ref = /\(ref "([^"]*)"\)/.exec(c)![1]!;
    const path = /\(sheetpath\s*\(names "([^"]*)"\)/.exec(c)![1]!;
    out.set(path, [...(out.get(path) ?? []), ref]);
  }

  return out;
}

const uniqueRefs = (list: SCH_REFERENCE_LIST) =>
  [...new Set(list.GetSymbolInstances().map((i) => i.m_Reference))].sort();

describe('SCH_SHEET_LIST::GetSymbols over a reused sheet', () => {
  it('has the oracle', () => {
    expect([...netlistComps().values()].map((v) => v.length)).toEqual([10, 29, 29]);
  });

  it('gathers every non-power symbol of every sheet instance, as kicad-cli lists them', () => {
    const refs = new SCH_REFERENCE_LIST();
    openHierarchy().Hierarchy().GetSymbols(refs, SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER);
    expect(uniqueRefs(refs)).toEqual([...netlistComps().values()].flat().sort());
  });

  it('within a path, gathers only that instance', () => {
    const schematic = openHierarchy();
    const hierarchy = schematic.Hierarchy();
    const comps = netlistComps();

    for (const name of ['/ampli_ht_vertical/', '/ampli_ht_horizontal/', '/']) {
      const path = hierarchy.find((p) => p.PathHumanReadable() === name)!;
      const refs = new SCH_REFERENCE_LIST();
      hierarchy.GetSymbolsWithinPath(refs, path, SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER);
      // The root contains everything; a leaf only itself.
      const want = name === '/' ? [...comps.values()].flat() : comps.get(name)!;
      expect(uniqueRefs(refs), name).toEqual([...want].sort());
    }
  });

  it('numbers each reference with its sheet page number', () => {
    const hierarchy = openHierarchy().Hierarchy();
    const refs = new SCH_REFERENCE_LIST();
    hierarchy.GetSymbols(refs, SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER);

    for (let i = 0; i < refs.GetCount(); i++) {
      const r = refs.at(i);
      expect(r.m_sheetNum).toBe(r.GetSheetPath().GetPageNumberAsInt());
    }
    expect(new Set(refs.GetSymbolInstances().map((_, i) => refs.at(i).m_sheetNum)).size).toBe(3);
  });

  it('merges multi-unit lists by reference across the sheets', () => {
    const hierarchy = openHierarchy().Hierarchy();
    const map: SCH_MULTI_UNIT_REFERENCE_MAP = new Map();
    hierarchy.GetMultiUnitSymbols(map, SYMBOL_FILTER.SYMBOL_FILTER_ALL);
    const all = new SCH_REFERENCE_LIST();
    hierarchy.GetSymbols(all, SYMBOL_FILTER.SYMBOL_FILTER_ALL);
    const instances = all.GetSymbolInstances();

    for (const [ref, list] of map) {
      // Every placed unit of that reference, on whichever sheet it sits.
      expect(list.GetCount(), ref).toBe(instances.filter((i) => i.m_Reference === ref).length);
      expect(list.at(0).GetLibPart()!.GetUnitCount()).toBeGreaterThan(1);
    }
    // ...and no multi-unit reference is missed.
    const multi = instances.filter((_, i) => all.at(i).GetLibPart()!.GetUnitCount() > 1);
    expect([...map.keys()].sort()).toEqual([...new Set(multi.map((i) => i.m_Reference))].sort());
    expect(map.size).toBeGreaterThan(0);
  });
});

function setup() {
  const project = new PROJECT();
  project.setProjectFile(new PROJECT_FILE('t.kicad_pro'));
  const schematic = new SCHEMATIC(project);
  schematic.CreateDefaultScreens();
  const sheet = schematic.Hierarchy()[0]!;
  schematic.SetCurrentSheet(sheet);
  return { schematic, sheet, screen: sheet.LastScreen()! };
}

function place(env: ReturnType<typeof setup>, lib: LIB_SYMBOL, ref: string, unit = 1) {
  const sym = new SCH_SYMBOL(lib, new LIB_ID('Lib', lib.GetName()), env.sheet, unit, 0, {
    x: 0,
    y: 0,
  });
  env.screen.Append(sym);
  sym.SetRef(env.sheet, ref);
  return sym;
}

describe('SCH_SHEET_PATH symbol filters', () => {
  const build = () => {
    const env = setup();
    const r = new LIB_SYMBOL('R');
    const gnd = new LIB_SYMBOL('GND');
    gnd.SetGlobalPower();
    const u = new LIB_SYMBOL('LM358');
    u.SetUnitCount(2, true);
    place(env, r, 'R1');
    place(env, gnd, '#PWR01');
    place(env, r, 'R2').SetLibSymbol(null); // an orphan: its library symbol is gone
    place(env, u, 'U1', 1);
    place(env, u, 'U1', 2);
    place(env, u, 'U?', 1);
    return env;
  };
  const refsOf = (filter: SYMBOL_FILTER, orphans = false) => {
    const env = build();
    const list = new SCH_REFERENCE_LIST();
    env.sheet.GetSymbols(list, filter, orphans);
    return list.GetSymbolInstances().map((i) => i.m_Reference);
  };

  it('picks power, non-power or all by the leading #, and orphans only when forced', () => {
    expect(refsOf(SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER)).toEqual(['R1', 'U1', 'U1', 'U?']);
    expect(refsOf(SYMBOL_FILTER.SYMBOL_FILTER_POWER)).toEqual(['#PWR01']);
    expect(refsOf(SYMBOL_FILTER.SYMBOL_FILTER_ALL)).toEqual(['R1', '#PWR01', 'U1', 'U1', 'U?']);
    expect(refsOf(SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER, true)).toEqual([
      'R1',
      'R2',
      'U1',
      'U1',
      'U?',
    ]);
  });

  it('locks only annotated multi-unit references', () => {
    const env = build();
    const map: SCH_MULTI_UNIT_REFERENCE_MAP = new Map();
    env.sheet.GetMultiUnitSymbols(map, SYMBOL_FILTER.SYMBOL_FILTER_ALL);
    expect([...map.keys()]).toEqual(['U1']);
    expect(map.get('U1')!.GetCount()).toBe(2);
  });
});

describe('SCH_SHEET_LIST::AnnotatePowerSymbols', () => {
  it('works on its own copies: the symbols keep their references', () => {
    // Upstream never calls UpdateAnnotation here (sch_sheet_path.cpp:1336-1404).
    const env = setup();
    const gnd = new LIB_SYMBOL('GND');
    gnd.SetGlobalPower();
    const a = place(env, gnd, '#PWR01');
    const b = place(env, gnd, '#PWR01');
    const c = place(env, gnd, 'PWR3');
    env.schematic.Hierarchy().AnnotatePowerSymbols();
    expect([a, b, c].map((s) => s.GetRef(env.sheet))).toEqual(['#PWR01', '#PWR01', 'PWR3']);
  });
});
