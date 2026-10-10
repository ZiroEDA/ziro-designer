// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * EXPORTER_VRML against `kicad-cli pcb export vrml --units mm` (KiCad 10.0.6) on the boards in
 * qa/data/pcbnew/vrml_oracle (regen.sh: model paths unresolvable, so the board alone). Origin as
 * the CLI picks it with no --user-origin: the centre of ComputeBoundingBox( true, true ).
 * Byte for byte.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { EXPORTER_VRML } from '@ziroeda/pcbnew/exporters/exporter_vrml.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const DIR = new URL('../../../data/pcbnew/vrml_oracle/', import.meta.url).pathname;
const BOARDS = new URL('../../../data/pcbnew/resave/', import.meta.url).pathname;
const CASES = readdirSync(DIR)
  .filter((f) => f.endsWith('.wrl.gz'))
  .map((f) => f.slice(0, -7))
  .sort();

describe('EXPORTER_VRML against kicad-cli 10.0.6', () => {
  it('has oracles', () => expect(CASES.length).toBeGreaterThanOrEqual(7));

  it.each(CASES)('%s', async (aName) => {
    const board = ParseBoard(readFileSync(`${BOARDS}${aName}.kicad_pcb`, 'utf8'));
    board.SetFileName(`${BOARDS}${aName}.kicad_pcb`);

    const bbox = board.ComputeBoundingBox(true, true);
    const messages: string[] = [];
    const got = new EXPORTER_VRML(board).ExportVRML_File(
      messages,
      1.0,
      true,
      true,
      false,
      false,
      '',
      pcbIUScale.iuToMM(bbox.GetCenter().x),
      pcbIUScale.iuToMM(bbox.GetCenter().y),
    );

    expect(messages).toEqual([]);
    if (process.env.VRML_DUMP)
      (await import('node:fs')).writeFileSync(`${process.env.VRML_DUMP}/${aName}.wrl`, got ?? '');

    const want = gunzipSync(readFileSync(`${DIR}${aName}.wrl.gz`)).toString('utf8');
    const g = (got ?? '').split('\n');
    const w = want.split('\n');
    const first = w.findIndex((l, i) => l !== g[i]);

    // The first differing line, with context, before the whole-file check.
    if (first >= 0)
      expect(g.slice(Math.max(0, first - 3), first + 3)).toEqual(
        w.slice(Math.max(0, first - 3), first + 3),
      );

    expect(g.length).toBe(w.length);
  }, 300_000);
});
