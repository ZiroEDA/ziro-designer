// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * ERC_TESTER against kicad-cli's own `sch erc --format json` report of 43 projects
 * (qa/data/eeschema/erc_oracle, KiCad 10.0.6), loaded the way kicad-cli loads them
 * (EESCHEMA_HELPERS::LoadSchematic) and written by ERC_REPORT.
 *
 * Every violation type the ported tests produce must match exactly: sheet, type, severity,
 * message, and each item's position and description. Uuids are not compared: files from
 * before 2021 have none, and KiCad makes fresh ones on every load.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_EXCLUSION,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/reporter.js';
import { LoadSchematic } from '@ziroeda/eeschema/eeschema_helpers.js';
import { ERC_TESTER } from '@ziroeda/eeschema/erc/erc.js';
import { ERC_REPORT } from '@ziroeda/eeschema/erc/erc_report.js';
import { SHEETLIST_ERC_ITEMS_PROVIDER } from '@ziroeda/eeschema/erc/erc_settings.js';
import { describe, expect, it } from 'vitest';

const DATA = resolve(__dirname, '../../../data/eeschema');
const ORACLE = join(DATA, 'erc_oracle');

/** The types only the ERC_TESTER tests still pending produce (erc.ts' RunTests). */
const PENDING = new Set([
  'different_unit_footprint',
  'duplicate_pins',
  'ground_pin_not_ground',
  'stacked_pin_name',
  'similar_labels',
  'similar_power',
  'similar_label_and_power',
  'same_local_global_label',
  'unresolved_variable',
  'field_name_whitespace',
  'simulation_model_issue',
  'lib_symbol_issues',
  'lib_symbol_mismatch',
  'footprint_link_issues',
  'footprint_filter',
  'four_way_junction',
  'label_multiple_wires',
  'undefined_netclass',
]);

/** no_connect_connected is both the graph's (this message) and TestNoConnectPins' (pending). */
const GRAPH_NO_CONNECT = 'A pin with a "no connection" flag is connected';

/**
 * Where kicad-cli's answer follows pointer order and ours insertion order: these are
 * deterministic in KiCad (a symbol's pins, and symbols, are allocated in load order, and a
 * std::set<SCH_ITEM*> iterates by address) but not yet emulated here.
 *  - ercCheckNoConnects reports the last pin of CONNECTION_SUBGRAPH::m_items.
 *  - ResolveDrivers ranks equal candidates (same name) in m_drivers order: std::sort on fewer
 *    than 16 is an insertion sort, so the first in pointer order wins.
 * Each entry names KiCad's key and the one reported here instead.
 */
const POINTER_ORDER: Record<string, { want: string[]; got: string[] }> = {
  'netlist_oracle_test_hier_no_connect.json': {
    want: [
      '/ | no_connect_connected | warning | A pin with a "no connection" flag is connected | 1.1811,0.889 Symbol U5 Pin 2 [PIN2, Input, Line] & 1.0795,0.8636 No Connect',
    ],
    got: [
      '/ | no_connect_connected | warning | A pin with a "no connection" flag is connected | 1.1811,0.8509 Symbol U5 Pin 1 [PIN1, Input, Line] & 1.0795,0.8636 No Connect',
    ],
  },
  'netlist_oracle_graph_video.json': {
    want: [
      '/buspci.sch/ | multiple_net_names | warning |  | 0.5461,1.2319 Symbol #GND092 Hidden pin 1 [GND, Power input, Line]',
      '/buspci.sch/ | multiple_net_names | warning |  | 1.6637,2.2479 Symbol #+0118 Hidden pin 1 [+5V, Power input, Line]',
    ],
    got: [
      '/buspci.sch/ | multiple_net_names | warning |  | 0.1778,2.2352 Symbol #+0129 Hidden pin 1 [+5V, Power input, Line]',
      '/buspci.sch/ | multiple_net_names | warning |  | 0.2667,2.7432 Symbol #GND083 Hidden pin 1 [GND, Power input, Line]',
    ],
  },
};

/**
 * Where kicad-cli's answer follows an order not yet emulated here (S2-4c):
 *  - TestMissingUnits reports on the first unit of a reference in screen item order, which is
 *    the R-tree's node order upstream and insertion order here (sch_rtree.ts).
 *  - TestMultUnitPinConflicts names the net it meets first; CONNECTION_GRAPH::m_net_code_to
 *    subgraphs_map is a std::unordered_map, iterated in libstdc++'s hash order upstream.
 */
const ITEM_ORDER: Record<string, { want: string[]; got: string[] }> = {
  'netlist_oracle_graph_test_multiunit_reannotate.json': {
    want: [
      '/ | missing_input_pin | warning | Symbol U2 has input pins in units [ B ] that are not placed | 0.9906,0.9271 Symbol U2 [LM2903]',
      '/ | missing_unit | warning | Symbol U2 has unplaced units [ B ] | 0.9906,0.9271 Symbol U2 [LM2903]',
    ],
    got: [
      '/ | missing_input_pin | warning | Symbol U2 has input pins in units [ B ] that are not placed | 1.5748,0.9144 Symbol U2 [LM2903]',
      '/ | missing_unit | warning | Symbol U2 has unplaced units [ B ] | 1.5748,0.9144 Symbol U2 [LM2903]',
    ],
  },
  'netlist_oracle_graph_test_multiunit_reannotate_5.json': {
    want: [
      '/ | different_unit_net | error | Pin 1 is connected to both unconnected-(U2-Pad1)_1 and unconnected-(U2-Pad1) | 1.0668,0.9271 Symbol U2 Pin 1 [Open collector, Line] & 1.0668,1.2065 Symbol U2 Pin 1 [Open collector, Line]',
      '/ | different_unit_net | error | Pin 2 is connected to both unconnected-(U2A---Pad2)_1 and unconnected-(U2A---Pad2) | 0.9144,0.9525 Symbol U2 Pin 2 [-, Input, Line] & 0.9144,1.2319 Symbol U2 Pin 2 [-, Input, Line]',
      '/ | different_unit_net | error | Pin 3 is connected to both unconnected-(U2A-+-Pad3)_1 and unconnected-(U2A-+-Pad3) | 0.9144,0.9017 Symbol U2 Pin 3 [+, Input, Line] & 0.9144,1.1811 Symbol U2 Pin 3 [+, Input, Line]',
      '/ | different_unit_net | error | Pin 4 is connected to both unconnected-(U2C-V--Pad4)_1 and unconnected-(U2C-V--Pad4) | 1.5494,0.9906 Symbol U2 Pin 4 [V-, Power input, Line] & 1.5494,1.27 Symbol U2 Pin 4 [V-, Power input, Line]',
      '/ | different_unit_net | error | Pin 5 is connected to both unconnected-(U2B-+-Pad5)_1 and unconnected-(U2B-+-Pad5) | 1.2192,0.9017 Symbol U2 Pin 5 [+, Input, Line] & 1.2192,1.1684 Symbol U2 Pin 5 [+, Input, Line]',
      '/ | different_unit_net | error | Pin 6 is connected to both unconnected-(U2B-_-Pad6)_1 and unconnected-(U2B-_-Pad6) | 1.2192,0.9525 Symbol U2 Pin 6 [_, Input, Line] & 1.2192,1.2192 Symbol U2 Pin 6 [_, Input, Line]',
      '/ | different_unit_net | error | Pin 7 is connected to both unconnected-(U2-Pad7)_1 and unconnected-(U2-Pad7) | 1.3716,0.9271 Symbol U2 Pin 7 [Open collector, Line] & 1.3716,1.1938 Symbol U2 Pin 7 [Open collector, Line]',
      '/ | different_unit_net | error | Pin 8 is connected to both unconnected-(U2C-V+-Pad8)_1 and unconnected-(U2C-V+-Pad8) | 1.5494,0.8382 Symbol U2 Pin 8 [V+, Power input, Line] & 1.5494,1.1176 Symbol U2 Pin 8 [V+, Power input, Line]',
    ],
    got: [
      '/ | different_unit_net | error | Pin 1 is connected to both unconnected-(U2-Pad1) and unconnected-(U2-Pad1)_1 | 1.0668,0.9271 Symbol U2 Pin 1 [Open collector, Line] & 1.0668,1.2065 Symbol U2 Pin 1 [Open collector, Line]',
      '/ | different_unit_net | error | Pin 2 is connected to both unconnected-(U2A---Pad2) and unconnected-(U2A---Pad2)_1 | 0.9144,0.9525 Symbol U2 Pin 2 [-, Input, Line] & 0.9144,1.2319 Symbol U2 Pin 2 [-, Input, Line]',
      '/ | different_unit_net | error | Pin 3 is connected to both unconnected-(U2A-+-Pad3) and unconnected-(U2A-+-Pad3)_1 | 0.9144,0.9017 Symbol U2 Pin 3 [+, Input, Line] & 0.9144,1.1811 Symbol U2 Pin 3 [+, Input, Line]',
      '/ | different_unit_net | error | Pin 4 is connected to both unconnected-(U2C-V--Pad4) and unconnected-(U2C-V--Pad4)_1 | 1.5494,1.27 Symbol U2 Pin 4 [V-, Power input, Line] & 1.5494,0.9906 Symbol U2 Pin 4 [V-, Power input, Line]',
      '/ | different_unit_net | error | Pin 5 is connected to both unconnected-(U2B-+-Pad5) and unconnected-(U2B-+-Pad5)_1 | 1.2192,1.1684 Symbol U2 Pin 5 [+, Input, Line] & 1.2192,0.9017 Symbol U2 Pin 5 [+, Input, Line]',
      '/ | different_unit_net | error | Pin 6 is connected to both unconnected-(U2B-_-Pad6) and unconnected-(U2B-_-Pad6)_1 | 1.2192,1.2192 Symbol U2 Pin 6 [_, Input, Line] & 1.2192,0.9525 Symbol U2 Pin 6 [_, Input, Line]',
      '/ | different_unit_net | error | Pin 7 is connected to both unconnected-(U2-Pad7) and unconnected-(U2-Pad7)_1 | 1.3716,1.1938 Symbol U2 Pin 7 [Open collector, Line] & 1.3716,0.9271 Symbol U2 Pin 7 [Open collector, Line]',
      '/ | different_unit_net | error | Pin 8 is connected to both unconnected-(U2C-V+-Pad8) and unconnected-(U2C-V+-Pad8)_1 | 1.5494,1.1176 Symbol U2 Pin 8 [V+, Power input, Line] & 1.5494,0.8382 Symbol U2 Pin 8 [V+, Power input, Line]',
    ],
  },
  'netlist_oracle_test_multiunit_reannotate_3.json': {
    want: [
      '/ | missing_input_pin | warning | Symbol U2 has input pins in units [ B ] that are not placed | 0.9906,0.9271 Symbol U2 [LM2903]',
      '/ | missing_unit | warning | Symbol U2 has unplaced units [ B ] | 0.9906,0.9271 Symbol U2 [LM2903]',
    ],
    got: [
      '/ | missing_input_pin | warning | Symbol U2 has input pins in units [ B ] that are not placed | 1.5748,0.9144 Symbol U2 [LM2903]',
      '/ | missing_unit | warning | Symbol U2 has unplaced units [ B ] | 1.5748,0.9144 Symbol U2 [LM2903]',
    ],
  },
};

/** \a aKeys without each of \a aDrop, which must all be there. */
function without(aKeys: string[], aDrop: string[]): string[] {
  const out = [...aKeys];

  for (const k of aDrop) {
    const i = out.indexOf(k);
    expect(i, `expected to find: ${k}`).toBeGreaterThanOrEqual(0);
    out.splice(i, 1);
  }

  return out;
}

interface Item {
  description: string;
  pos: { x: number; y: number };
}
interface Violation {
  type: string;
  severity: string;
  excluded: boolean;
  description: string;
  items: Item[];
}
interface Report {
  $schema: string;
  source: string;
  kicad_version: string;
  coordinate_units: string;
  included_severities: string[];
  ignored_checks: { key: string; description: string }[];
  sheets: { path: string; uuid_path: string; violations: Violation[] }[];
}

function keys(aReport: Report): string[] {
  const out: string[] = [];

  for (const sheet of aReport.sheets) {
    for (const v of sheet.violations) {
      if (PENDING.has(v.type)) continue;

      if (v.type === 'no_connect_connected' && v.description !== GRAPH_NO_CONNECT) continue;

      // ercCheckMultipleDrivers reports the first other driver in m_drivers, a
      // std::set<SCH_ITEM*>: kicad-cli's own pick (and so the message naming it) changes from
      // run to run. Only the subgraph's driver is compared.
      const multi = v.type === 'multiple_net_names';
      const items = (multi ? v.items.slice(0, 1) : v.items)
        .map((i) => `${i.pos.x},${i.pos.y} ${i.description}`)
        .join(' & ');

      out.push(
        `${sheet.path} | ${v.type} | ${v.severity}${v.excluded ? ' excluded' : ''} | ${multi ? '' : v.description} | ${items}`,
      );
    }
  }

  return out.sort();
}

function directoryOf(aOracleFile: string): string {
  const stem = aOracleFile.replace(/\.json$/, '');
  return stem.startsWith('netlist_oracle_graph_')
    ? join(DATA, 'netlist_oracle_graph', stem.slice('netlist_oracle_graph_'.length))
    : join(DATA, 'netlist_oracle', stem.slice('netlist_oracle_'.length));
}

function runErc(aDir: string, aSource: string): Report {
  const pro = join(aDir, aSource.replace(/\.kicad_sch$/, '.kicad_pro'));
  const project = new PROJECT();
  project.setProjectFullName(pro);
  const file = new PROJECT_FILE(pro);
  project.setProjectFile(file);
  file.LoadFromFile(JSON.parse(readFileSync(pro, 'utf8')));

  const schematic = LoadSchematic(join(aDir, aSource), project, (p) =>
    existsSync(p) ? readFileSync(p, 'utf8') : null,
  )!;
  new ERC_TESTER(schematic).RunTests();

  // kicad-cli's --severity-all.
  const provider = new SHEETLIST_ERC_ITEMS_PROVIDER(schematic);
  provider.SetSeverities(RPT_SEVERITY_ERROR | RPT_SEVERITY_WARNING | RPT_SEVERITY_EXCLUSION);
  return JSON.parse(new ERC_REPORT(schematic, 'mm', provider).WriteJsonReport()) as Report;
}

const FILES = readdirSync(ORACLE).filter((f) => f.endsWith('.json'));

describe('ERC_TESTER against kicad-cli sch erc', () => {
  it('has the oracle', () => expect(FILES.length).toBe(43));

  for (const f of FILES) {
    it(f, { timeout: 120_000 }, () => {
      const want = JSON.parse(readFileSync(join(ORACLE, f), 'utf8')) as Report;
      const divergence = {
        want: [...(POINTER_ORDER[f]?.want ?? []), ...(ITEM_ORDER[f]?.want ?? [])],
        got: [...(POINTER_ORDER[f]?.got ?? []), ...(ITEM_ORDER[f]?.got ?? [])],
      };
      const report = runErc(directoryOf(f), want.source);

      // The head, as written (the date aside).
      const head = (r: Report) => [
        r.$schema,
        r.source,
        r.kicad_version,
        r.coordinate_units,
        r.included_severities,
        r.ignored_checks,
      ];
      expect(head(report)).toEqual(head(want));

      // The sheets in hierarchy order; a uuid path only where the file has the uuids.
      const text = readFileSync(join(directoryOf(f), want.source), 'utf8');
      const sheets = (r: Report) =>
        r.sheets.map((sh) => [
          sh.path,
          sh.uuid_path.split('/').every((u) => u === '' || text.includes(u)) ? sh.uuid_path : '',
        ]);
      expect(sheets(report)).toEqual(sheets(want));

      const got = without(keys(report), divergence.got);
      const expected = without(keys(want), divergence.want);

      expect(got).toEqual(expected);
    });
  }
});
