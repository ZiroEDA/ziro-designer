// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Our KiCad netlist against the one `kicad-cli sch export netlist` writes for
 * the same design, whole file, line for line (qa/data/eeschema/netlist_oracle).
 *
 * complex_hierarchy is KiCad's own qa design: one sub-sheet used twice, and a
 * 20200512 file - references and units in the root's symbol_instances, sheet
 * fields named "Sheet name" / "Sheet file". It exercises per-instance
 * references, UpdateSymbolInstanceData, the legacy sheet-field names, the
 * libpart order and fp-filter tokenising in one go.
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
  it('complex_hierarchy matches line for line', () => {
    const dir = `${ORACLE}complex_hierarchy/`;
    const files = readdirSync(dir)
      .filter((n) => /\.(kicad_sch|kicad_pro)$|^sym-lib-table$/.test(n))
      .map((name) => ({ name, text: readFileSync(dir + name, 'utf8') }));
    const r = fetchNetlistFromSchematic(files, 'annotate', 'complex_hierarchy');
    if (!r.ok) throw new Error(`${r.error}: ${r.details ?? ''}`);

    const want = normalise(readFileSync(`${dir}complex_hierarchy.kicad-cli.net`, 'utf8')).split(
      '\n',
    );
    const got = normalise(r.netlistText).split('\n');
    const firstDiff = want.findIndex((line, i) => line !== got[i]);
    expect(
      firstDiff === -1 ? null : { line: firstDiff + 1, want: want[firstDiff], got: got[firstDiff] },
    ).toBeNull();
    expect(got.length).toBe(want.length);
  });
});
