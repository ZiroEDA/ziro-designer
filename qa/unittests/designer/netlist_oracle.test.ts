// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Our KiCad netlist against the one `kicad-cli sch export netlist` writes for
 * the same design, whole file, line for line (qa/data/eeschema/netlist_oracle).
 *
 * Every design is from KiCad's own qa/data/eeschema/netlists. complex_hierarchy
 * (one sub-sheet used twice, a 20200512 file with the root's symbol_instances
 * and "Sheet name" / "Sheet file" fields) exercises per-instance references,
 * UpdateSymbolInstanceData, the legacy sheet-field names, the libpart order
 * and fp-filter tokenising; the rest add the "~" rule, legacy descriptions,
 * multi-unit parts and hierarchical pins. A design joins the folder when it
 * matches.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fetchNetlistFromSchematic } from '@ziroeda/designer/src/editors/pcb/netlist_from_schematic.js';
import { describe, expect, it } from 'vitest';

const ORACLE = new URL('../../data/eeschema/netlist_oracle/', import.meta.url).pathname;

/** The three lines that name the machine and the moment. */
const normalise = (text: string): string =>
  text
    .replace(/\(source "[^"]*"\)/, '(source X)')
    .replace(/\(date "[^"]*"\)/, '(date X)')
    .replace(/\(tool "[^"]*"\)/, '(tool X)');

describe('the KiCad netlist, against kicad-cli', () => {
  // One folder per design; each passes whole or not at all.
  for (const name of readdirSync(ORACLE).filter((n) => !n.includes('.'))) {
    it(`${name} matches line for line`, () => {
      const dir = `${ORACLE}${name}/`;
      const files = readdirSync(dir)
        .filter((n) => /\.(kicad_sch|kicad_pro)$|^sym-lib-table$/.test(n))
        .map((n) => ({ name: n, text: readFileSync(dir + n, 'utf8') }));
      const r = fetchNetlistFromSchematic(files, 'annotate', name);
      if (!r.ok) throw new Error(`${r.error}: ${r.details ?? ''}`);

      const want = normalise(readFileSync(`${dir}${name}.kicad-cli.net`, 'utf8')).split('\n');
      const got = normalise(r.netlistText).split('\n');
      const firstDiff = want.findIndex((line, i) => line !== got[i]);
      expect(
        firstDiff === -1
          ? null
          : { line: firstDiff + 1, want: want[firstDiff], got: got[firstDiff] },
      ).toBeNull();
      expect(got.length).toBe(want.length);
    });
  }
});
