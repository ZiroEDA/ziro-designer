// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint position files against the ones `kicad-cli pcb export pos`
 * writes for the same board, whole file, line for line
 * (`qa/data/pcbnew/exporters_oracle/`, see its README).
 *
 * The ASCII file's "created on <date>" and "Printed by <version>" lines are
 * masked (the second one names KiCad by design here — `GENERATOR_APPLICATION`
 * exists precisely so a file we write does not claim to be KiCad's); the CSV
 * has neither and matches unmasked.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { genPositionData } from '@ziroeda/pcbnew/exporters/place_file_exporter.js';

const DIR = new URL('../../data/pcbnew/exporters_oracle/', import.meta.url).pathname;
const BOARDS = new URL('../../data/pcbnew/resave/', import.meta.url).pathname;

const normaliseAscii = (text: string): string =>
  text
    .replace(/^### Footprint positions - created on .*$/m, '<date>')
    .replace(/^### Printed by .*$/m, '<tool>');

describe('the footprint position file, against kicad-cli', () => {
  for (const name of ['ecc83-pp', 'interf_u']) {
    it(`${name}.pos (ASCII) matches line for line`, () => {
      const board = readBoard(readFileSync(`${BOARDS}${name}.kicad_pcb`, 'utf8'));
      const { data } = genPositionData(board, {
        unitsMM: false,
        frontSide: true,
        backSide: true,
        formatCSV: false,
        creationDate: 'X',
      });

      const want = normaliseAscii(readFileSync(`${DIR}${name}.pos`, 'utf8'));
      expect(normaliseAscii(data)).toBe(want);
    });

    it(`${name}-pos.csv matches byte for byte`, () => {
      const board = readBoard(readFileSync(`${BOARDS}${name}.kicad_pcb`, 'utf8'));
      const { data } = genPositionData(board, {
        unitsMM: false,
        frontSide: true,
        backSide: true,
        formatCSV: true,
      });

      const want = readFileSync(`${DIR}${name}-pos.csv`, 'utf8');
      expect(data).toBe(want);
    });
  }
});
