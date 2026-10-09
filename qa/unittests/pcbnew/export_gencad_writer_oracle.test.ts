// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The GenCAD 1.4 export against what `kicad-cli pcb export gencad` (10.0.6)
 * wrote for the same boards (`qa/data/pcbnew/exporters_oracle/*.gencad`):
 * shared shapes (the default) and `--unique-footprints` (UseIndividualShapes),
 * on ecc83-pp and interf_u. Every line must match, `$ROUTES` included — the
 * writer sorts with libstdc++'s std::sort, so tracks that tie on net, width
 * and layer come out in its order — except `USER`, which names the program,
 * and `DRAWING`, the path kicad-cli was given.
 *
 * Regenerate with `regen.sh` in that directory.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { writeGenCad } from '@ziroeda/pcbnew/exporters/export_gencad_writer.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const DIR = new URL('../../data/pcbnew/exporters_oracle/', import.meta.url).pathname;
const BOARDS = new URL('../../data/pcbnew/resave/', import.meta.url).pathname;

const normalise = (text: string): string =>
  text.replace(/^USER ".*"$/m, 'USER "X"').replace(/^DRAWING ".*"$/m, 'DRAWING "X"');

describe('the GenCAD export, against kicad-cli', () => {
  for (const board of ['ecc83-pp', 'interf_u']) {
    for (const mode of ['shared', 'unique'] as const) {
      it(`${board}-${mode}.gencad`, () => {
        const b = ParseBoard(readFileSync(`${BOARDS}${board}.kicad_pcb`, 'utf8'));
        const got = normalise(writeGenCad(b, { useIndividualShapes: mode === 'unique' }));
        const want = normalise(readFileSync(`${DIR}${board}-${mode}.gencad`, 'utf8'));

        expect(got).toBe(want);
      });
    }
  }
});
