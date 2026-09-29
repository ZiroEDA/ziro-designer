// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The GenCAD 1.4 export against the one `kicad-cli pcb export gencad
 * --unique-footprints` writes for the same board
 * (`qa/data/pcbnew/exporters_oracle/ecc83-pp-unique.gencad`).
 *
 * `--unique-footprints` (`UseIndividualShapes`) only: the default mode's
 * `$SHAPES`/`$DEVICES` dedup groups footprints by a structural hash
 * (`hash_fp_item`) this port reproduces as a canonical string key (see
 * `export_gencad_writer.ts`'s header) rather than the exact hash — correct
 * on `ecc83-pp` (its two genuinely-differently-rotated `R_Axial` pairs split
 * as expected), but under-splits one shape group on `interf_u` (a 62-pad
 * card-edge connector that upstream's dedup treats as two shapes, this port
 * as one) for a reason not root-caused this session. `--unique-footprints`
 * sidesteps the hash entirely (each footprint gets its own named shape), so
 * it is the byte-exact-verifiable subset.
 *
 * `$ROUTES` is checked for the same *set* of lines, not the same *order*:
 * upstream sorts tracks with `std::sort`, not stable, and several segments
 * on this board tie on net + width + layer — the relative order of tied
 * segments is then libstdc++-implementation-defined, not reproducible from
 * the algorithm alone. Confirmed by inspection: every line before `$ROUTES`
 * matches exactly; the `$ROUTES` lines are the identical multiset, just a
 * different permutation within each tied run.
 *
 * The fixture was generated with:
 *   kicad-cli pcb export gencad -o ecc83-pp-unique.gencad --unique-footprints ecc83-pp.kicad_pcb
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { writeGenCad } from '@ziroeda/pcbnew/exporters/export_gencad_writer.js';

const DIR = new URL('../../data/pcbnew/exporters_oracle/', import.meta.url).pathname;
const BOARDS = new URL('../../data/pcbnew/resave/', import.meta.url).pathname;

/** `USER "KiCad <version>"` names KiCad by design upstream; `DRAWING` carries
 *  the file path, machine-specific here (kicad-cli was run from its own cwd). */
const normalise = (text: string): string =>
  text.replace(/^USER ".*"$/m, 'USER "X"').replace(/^DRAWING ".*"$/m, 'DRAWING "X"');

describe('the GenCAD export, against kicad-cli', () => {
  it('ecc83-pp-unique.gencad matches line for line before $ROUTES, same lines within it', () => {
    const board = readBoard(readFileSync(`${BOARDS}ecc83-pp.kicad_pcb`, 'utf8'));
    const got = normalise(writeGenCad(board.k!, { useIndividualShapes: true }));
    const want = normalise(readFileSync(`${DIR}ecc83-pp-unique.gencad`, 'utf8'));

    const [wantHead, wantRoutes] = splitAtRoutes(want);
    const [gotHead, gotRoutes] = splitAtRoutes(got);

    expect(gotHead).toBe(wantHead);
    expect(sortedLines(gotRoutes)).toEqual(sortedLines(wantRoutes));
  });
});

function splitAtRoutes(text: string): [string, string] {
  const i = text.indexOf('$ROUTES');
  return [text.slice(0, i), text.slice(i)];
}

function sortedLines(text: string): string[] {
  return text.split('\n').sort();
}
