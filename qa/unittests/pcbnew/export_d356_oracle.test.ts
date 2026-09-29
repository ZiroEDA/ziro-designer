// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The IPC-D-356 bare-board netlist against the one `kicad-cli pcb export
 * ipcd356` writes for the same board, whole file, byte for byte
 * (`qa/data/pcbnew/exporters_oracle/`, see its README). The format has no
 * date or tool-identity line, so nothing is masked.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { exportD356 } from '@ziroeda/pcbnew/exporters/export_d356.js';

const DIR = new URL('../../data/pcbnew/exporters_oracle/', import.meta.url).pathname;
const BOARDS = new URL('../../data/pcbnew/resave/', import.meta.url).pathname;

describe('the IPC-D-356 netlist, against kicad-cli', () => {
  for (const name of ['ecc83-pp', 'interf_u']) {
    it(`${name}.d356 matches byte for byte`, () => {
      const board = readBoard(readFileSync(`${BOARDS}${name}.kicad_pcb`, 'utf8'));
      const got = exportD356(board);

      const want = readFileSync(`${DIR}${name}.d356`, 'utf8');
      expect(got).toBe(want);
    });
  }
});
