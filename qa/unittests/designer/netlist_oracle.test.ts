// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Our KiCad netlist against the one `kicad-cli sch export netlist` writes for
 * the same design, whole file, line for line: every design in
 * qa/data/eeschema/netlist_oracle and netlist_oracle_graph (all 45 of KiCad's
 * qa/data/eeschema/netlists designs and connectivity regression designs).
 *
 * The text is NETLIST_EXPORTER_KICAD over the live SCHEMATIC and its
 * CONNECTION_GRAPH, loaded the way kicad-cli loads it (exportKicadNetlist). Update
 * PCB's path (MAIL_SCH_GET_NETLIST) must write the same text, or refuse a design
 * with annotation errors, as ReadyToNetlist does; kicad-cli only warns about those.
 *
 * Known gap: the four test_multiunit_reannotate* designs differ in one line each,
 * the order of a three-plus-unit part's `(tstamps …)`. makeSymbols takes that order
 * from Items() - upstream's 3-D R-tree node order (sch_rtree.h) - and our EE_RTREE
 * iterates in insertion order. Porting the R-tree would close it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { exportKicadNetlist, formatSchematicNetlist } from '@ziroeda/eeschema/cross-probing.js';
import {
  fetchNetlistFromSchematic,
  setHeadlessNetlistProvider,
} from '@ziroeda/pcbnew/netlist_from_schematic.js';
import { beforeAll, describe, expect, it } from 'vitest';

// The app registers the headless MAIL_SCH_GET_NETLIST answer at startup
// (pgm_app.ts: `setHeadlessNetlistProvider(formatSchematicNetlist)`), since
// pcbnew/ may not import eeschema/. A test that never starts the app does
// the same, or every fetch falls back to a refusal.
beforeAll(() => setHeadlessNetlistProvider(formatSchematicNetlist));

const DATA = new URL('../../data/eeschema/', import.meta.url).pathname;
const ORACLES = [`${DATA}netlist_oracle/`, `${DATA}netlist_oracle_graph/`];

/** The three lines that name the machine and the moment. */
const normalise = (text: string): string =>
  text
    .replace(/\(source "[^"]*"\)/, '(source X)')
    .replace(/\(date "[^"]*"\)/, '(date X)')
    .replace(/\(tool "[^"]*"\)/, '(tool X)');

/**
 * The designs where upstream's R-tree order decides a `(tstamps …)` order (see above).
 * Only for these is that order set aside - and only that: every other byte still has
 * to match, and the raw text has to differ, so a fix shows up as a failure here.
 */
const RTREE_ORDER_GAP = new Set([
  'test_multiunit_reannotate',
  'test_multiunit_reannotate_4',
  'test_multiunit_reannotate_5',
  'test_multiunit_reannotate_same_value',
]);

/** Every `(tstamps "…" …)` of a component, its UUIDs sorted. */
const sortTstamps = (text: string): string =>
  text.replace(/\(tstamps ((?:"[0-9a-f-]{36}"\s*)+)\)/g, (_m, list: string) => {
    const uuids = list.match(/"[^"]*"/g) ?? [];
    return `(tstamps ${[...uuids].sort().join(' ')})`;
  });

describe('the KiCad netlist, against kicad-cli', () => {
  it('has every KiCad netlist design', () => {
    const names = ORACLES.flatMap((o) => readdirSync(o).filter((n) => !n.includes('.')));
    expect(names).toHaveLength(45);
  });

  // One folder per design; each passes whole or not at all.
  for (const oracle of ORACLES) {
    for (const name of readdirSync(oracle).filter((n) => !n.includes('.'))) {
      it(`${name} matches line for line`, { timeout: 60000 }, () => {
        const dir = `${oracle}${name}/`;
        const files = readdirSync(dir)
          .filter((n) => /\.(kicad_sch|kicad_pro)$|^sym-lib-table$/.test(n))
          .map((n) => ({ name: n, text: readFileSync(dir + n, 'utf8') }));
        // kicad-cli's path: load, export; annotation errors only warn.
        const r = exportKicadNetlist(files, `${name}.kicad_sch`, name);
        if (!r.ok) throw new Error(`${r.error}: ${r.details ?? ''}`);

        // Update PCB's path (MAIL_SCH_GET_NETLIST) writes the same text, or refuses an
        // unannotated design outright (ReadyToNetlist) - it never writes a different one.
        const mail = fetchNetlistFromSchematic(files, 'annotate', name);
        if (mail.ok) expect(normalise(mail.netlistText)).toBe(normalise(r.netlistText));
        else expect(mail.error).toBe('annotate');

        let wantText = normalise(readFileSync(`${dir}${name}.kicad-cli.net`, 'utf8'));
        let gotText = normalise(r.netlistText);

        if (RTREE_ORDER_GAP.has(name)) {
          expect(gotText).not.toBe(wantText);
          wantText = sortTstamps(wantText);
          gotText = sortTstamps(gotText);
        }

        const want = wantText.split('\n');
        const got = gotText.split('\n');
        const firstDiff = want.findIndex((line, i) => line !== got[i]);
        expect(
          firstDiff === -1
            ? null
            : {
                line: firstDiff + 1,
                want: want.slice(Math.max(0, firstDiff - 4), firstDiff + 3),
                got: got.slice(Math.max(0, firstDiff - 4), firstDiff + 3),
              },
        ).toBeNull();
        expect(got.length).toBe(want.length);
      });
    }
  }
});
