// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Export Netlist formats against what `kicad-cli sch export netlist --format <f>`
 * wrote for the same design (`<name>.kicad-cli.<f>.net`, and Allegro's `devices/`),
 * whole file, for every design in qa/data/eeschema/netlist_oracle and
 * netlist_oracle_graph - the designs `netlist_oracle.test.ts` holds the KiCad format to.
 *
 * Each exporter runs over the live SCHEMATIC and its CONNECTION_GRAPH, loaded the way
 * kicad-cli loads it (loadProjectSchematic). Only the lines that name the machine and
 * the moment are set aside: the date, the source path, the tool version.
 *
 * Known gap, as in netlist_oracle.test.ts: in the KiCad XML format the four
 * test_multiunit_reannotate* designs differ in the order of a 3+-unit part's
 * `<tstamps>`, which upstream takes from its R-tree's node order.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadProjectSchematic, symbolLibraryUri } from '@ziroeda/eeschema/cross-probing.js';
import {
  WriteNetListText,
  type NetlistFormat,
} from '@ziroeda/eeschema/netlist_exporters/netlist_generator.js';

const DATA = new URL('../../data/eeschema/', import.meta.url).pathname;
const ORACLES = [
  `${DATA}netlist_oracle/`,
  `${DATA}netlist_oracle_graph/`,
  `${DATA}netlist_oracle_cases/`,
];

const FORMATS: readonly NetlistFormat[] = ['orcadpcb2', 'cadstar', 'pads', 'kicadxml', 'allegro'];

/** The lines that name the machine and the moment, per format. */
const normalise = (text: string): string =>
  text
    .replace(/^\( \{ EESchema Netlist Version 1\.1 created {2}.* \}$/m, '( { HEADER }')
    .replace(/^\.TIM .*$/m, '.TIM X')
    .replace(/^\.APP ".*"$/m, '.APP X')
    .replace(/<source>[^<]*\.kicad_sch<\/source>/, '<source>X</source>')
    .replace(/<date>[^<]*<\/date>/, '<date>X</date>')
    .replace(/<tool>[^<]*<\/tool>/, '<tool>X</tool>')
    .replace(/^\(Source: .*\)$/m, '(Source: X)')
    .replace(/^\(Date: .*\)$/m, '(Date: X)');

const RTREE_ORDER_GAP = new Set([
  'test_multiunit_reannotate',
  'test_multiunit_reannotate_4',
  'test_multiunit_reannotate_5',
  'test_multiunit_reannotate_same_value',
]);

/** Every `<tstamps>…</tstamps>` of a component, its UUIDs sorted. */
const sortTstamps = (text: string): string =>
  text.replace(/<tstamps>([0-9a-f -]+)<\/tstamps>/g, (_m, list: string) => {
    const uuids = list.split(' ').filter(Boolean).sort();
    return `<tstamps>${uuids.join(' ')}</tstamps>`;
  });

function compare(aWant: string, aGot: string): void {
  const want = aWant.split('\n');
  const got = aGot.split('\n');
  const firstDiff = want.findIndex((line, i) => line !== got[i]);
  expect(
    firstDiff === -1
      ? null
      : {
          line: firstDiff + 1,
          want: want.slice(Math.max(0, firstDiff - 3), firstDiff + 3),
          got: got.slice(Math.max(0, firstDiff - 3), firstDiff + 3),
        },
  ).toBeNull();
  expect(got.length).toBe(want.length);
}

describe('the Export Netlist formats, against kicad-cli', () => {
  for (const oracle of ORACLES) {
    for (const name of readdirSync(oracle).filter((n) => !n.includes('.'))) {
      const dir = `${oracle}${name}/`;
      const files = readdirSync(dir)
        .filter((n) => /\.(kicad_sch|kicad_pro)$|^sym-lib-table$/.test(n))
        .map((n) => ({ name: n, text: readFileSync(dir + n, 'utf8') }));

      for (const format of FORMATS) {
        it(`${name}: ${format} matches line for line`, { timeout: 60000 }, () => {
          const schematic = loadProjectSchematic(files, `${name}.kicad_sch`, name);
          if (!schematic) throw new Error(`${name} did not load`);

          const out = WriteNetListText(format, schematic, `${name}.net`, symbolLibraryUri(files));

          let want = normalise(readFileSync(`${dir}${name}.kicad-cli.${format}.net`, 'utf8'));
          let got = normalise(out[0]!.text);

          if (format === 'kicadxml' && RTREE_ORDER_GAP.has(name)) {
            expect(got).not.toBe(want);
            want = sortTstamps(want);
            got = sortTstamps(got);
          }

          compare(want, got);

          // Allegro's device files: the same set of names, each byte for byte.
          if (format === 'allegro') {
            const devices = existsSync(`${dir}devices`) ? readdirSync(`${dir}devices`).sort() : [];
            const ours = out.slice(1);
            expect(ours.map((f) => f.path).sort()).toEqual(devices.map((d) => `devices/${d}`));

            for (const f of ours) compare(readFileSync(`${dir}${f.path}`, 'utf8'), f.text);
          }
        });
      }
    }
  }
});
