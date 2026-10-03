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
 * Where kicad-cli's answer follows pointer order: ResolveDrivers ranks equal candidates (same
 * name) in CONNECTION_SUBGRAPH::m_drivers order, a std::set<SCH_ITEM*> iterated by address,
 * and std::sort on fewer than 16 is an insertion sort, so the first by address wins. KiCad's
 * pick is stable here (a symbol's pins are allocated in load order) but not emulated.
 */
const POINTER_ORDER: Record<string, { want: string[]; got: string[] }> = {
  'netlist_oracle_graph_video.json': {
    want: [
      '/buspci.sch/ | multiple_net_names | warning |  | 0.5461,1.2319 Symbol #GND092 Hidden pin 1 [GND, Power input, Line]',
      '/buspci.sch/ | multiple_net_names | warning |  | 1.6637,2.2479 Symbol #+0118 Hidden pin 1 [+5V, Power input, Line]',
    ],
    got: [
      '/buspci.sch/ | multiple_net_names | warning |  | 0.2667,2.7432 Symbol #GND083 Hidden pin 1 [GND, Power input, Line]',
      '/buspci.sch/ | multiple_net_names | warning |  | 0.4826,2.5781 Symbol #+0123 Hidden pin 1 [+5V, Power input, Line]',
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
      const divergence = POINTER_ORDER[f] ?? { want: [], got: [] };
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
