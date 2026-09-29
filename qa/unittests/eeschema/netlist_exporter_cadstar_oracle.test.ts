// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Our CadStar netlist against the one `kicad-cli sch export netlist --format
 * cadstar` writes for the same design, whole file, line for line.
 *
 * Reuses `qa/data/eeschema/netlist_oracle/`'s designs (the same set the
 * KiCad-format oracle already runs over), restricted to the ones that are a
 * single sheet: `netlistCadstar` — like the whole Export Netlist dialog it
 * belongs to — exports the open sheet only, where `kicad-cli` always exports
 * the whole project, so a hierarchical design in that folder is not
 * comparable here (`complex_hierarchy`, `issue14657`, `issue14818`,
 * `issue16003`, `test_global_promotion*`, `test_hier_no_connect`,
 * `top_level_hier_pins`).
 *
 * `test_multiunit_reannotate_2`/`_3` are also excluded: both place a second
 * reference ("U2") on two different library symbols with a blank Value field,
 * and `kicad-cli`'s output gives that reference the *other* symbol's value
 * ("LM2903") by some resolution this port does not reproduce — a real,
 * open discrepancy, not a masked line; see eeschema/STRUCTURE.md.
 *
 * The fixtures were generated with:
 *   kicad-cli sch export netlist --format cadstar \
 *     -o <name>.kicad-cli.cadstar.net <name>.kicad_sch
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { netlistCadstar } from '@ziroeda/eeschema/netlist_exporters/netlist_exporter_cadstar.js';

const ORACLE = new URL('../../data/eeschema/netlist_oracle/', import.meta.url).pathname;

/** Single-sheet designs only — see the file header. */
const DESIGNS = ['bus_entries', 'issue16439', 'issue24330'];

/** The two lines that name the machine and the moment. */
const normalise = (text: string): string =>
  text.replace(/^\.TIM .*$/m, '.TIM X').replace(/^\.APP ".*"$/m, '.APP "X"');

describe('the CadStar netlist, against kicad-cli', () => {
  for (const name of DESIGNS) {
    it(`${name} matches line for line`, () => {
      const dir = `${ORACLE}${name}/`;
      const doc = readSchematic(parse(readFileSync(`${dir}${name}.kicad_sch`, 'utf8')));
      const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
      const got = netlistCadstar(doc, libById, { source: `${name}.kicad_sch` });

      const want = normalise(readFileSync(`${dir}${name}.kicad-cli.cadstar.net`, 'utf8'));
      expect(normalise(got)).toBe(want);
    });
  }
});
