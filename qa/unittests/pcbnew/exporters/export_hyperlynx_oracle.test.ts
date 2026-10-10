// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * HYPERLYNX_EXPORTER against real pcbnew 10.0.6's File > Export > Hyperlynx... on the boards in
 * qa/data/pcbnew/hyperlynx_oracle (qa/probes/pcb_export_oracle/hyp_oracle.sh drives the GUI over
 * AT-SPI; neither kicad-cli nor the python module exports HyperLynx). Byte for byte, except the
 * {BOARD line's file name, which is wherever the oracle's pcbnew had the board open.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HYPERLYNX_EXPORTER } from '@ziroeda/pcbnew/exporters/export_hyperlynx.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const DIR = new URL('../../../data/pcbnew/hyperlynx_oracle/', import.meta.url).pathname;
const BOARDS = new URL('../../../data/pcbnew/resave/', import.meta.url).pathname;
const CASES = readdirSync(DIR)
  .filter((f) => f.endsWith('.hyp'))
  .map((f) => f.slice(0, -4))
  .sort();

const maskBoard = (s: string): string => s.replace(/^\{BOARD ".*"$/m, '{BOARD "F"');

describe('HYPERLYNX_EXPORTER against pcbnew 10.0.6', () => {
  it('has oracles', () => expect(CASES.length).toBeGreaterThanOrEqual(7));

  it.each(CASES)('%s', (aName) => {
    const board = ParseBoard(readFileSync(`${BOARDS}${aName}.kicad_pcb`, 'utf8'));
    board.SetFileName(`${BOARDS}${aName}.kicad_pcb`);

    let out = '';
    const exporter = new HYPERLYNX_EXPORTER();
    exporter.SetBoard(board);
    exporter.SetOutputFilename(`${aName}.hyp`);
    exporter.SetFileWriter((_p, d) => {
      out = new TextDecoder().decode(d);
    });
    expect(exporter.Run()).toBe(true);

    const want = readFileSync(`${DIR}${aName}.hyp`, 'utf8');
    expect(maskBoard(out).split('\n')).toEqual(maskBoard(want).split('\n'));
  }, 120_000);
});
