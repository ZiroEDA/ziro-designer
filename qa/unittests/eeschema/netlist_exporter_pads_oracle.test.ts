// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Our PADS-PCB netlist against the one `kicad-cli sch export netlist --format
 * pads` writes for the same design, whole file, line for line.
 *
 * Reuses `qa/data/eeschema/netlist_oracle/`'s designs, restricted to the
 * single-sheet ones — see `netlist_exporter_cadstar_oracle.test.ts`'s header
 * for why (same reasons apply here: single-sheet scope, and the same
 * `test_multiunit_reannotate_2`/`_3` open discrepancy).
 *
 * The fixtures were generated with:
 *   kicad-cli sch export netlist --format pads \
 *     -o <name>.kicad-cli.pads.net <name>.kicad_sch
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { netlistPads } from '@ziroeda/eeschema/netlist_exporters/netlist_exporter_pads.js';

const ORACLE = new URL('../../data/eeschema/netlist_oracle/', import.meta.url).pathname;

/** Single-sheet designs only — see `netlist_exporter_cadstar_oracle.test.ts`. */
const DESIGNS = ['bus_entries', 'issue16439', 'issue24330'];

describe('the PADS netlist, against kicad-cli', () => {
  for (const name of DESIGNS) {
    it(`${name} matches line for line`, () => {
      const dir = `${ORACLE}${name}/`;
      const doc = readSchematic(parse(readFileSync(`${dir}${name}.kicad_sch`, 'utf8')));
      const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
      const got = netlistPads(doc, libById);

      const want = readFileSync(`${dir}${name}.kicad-cli.pads.net`, 'utf8');
      expect(got).toBe(want);
    });
  }
});
