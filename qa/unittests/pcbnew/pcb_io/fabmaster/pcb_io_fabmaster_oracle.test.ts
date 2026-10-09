// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_IO_FABMASTER` against KiCad 10.0.6's own reading of the same files.
 *
 * The boards are KiCad's `qa/data/pcbnew/plugins/fabmaster`, gzipped, and
 * `synthetic_ziro_features.txt` (ours; `synthetic_ziro_features.make.py`
 * writes it): a LAYER_SORT section, FIG_RECTANGLE / DIAMOND / HEXAGON_Y
 * graphics, a circle with unequal radii, blind and buried vias, a refdes
 * placed twice, one that starts with a digit, an unplaced component, orphan
 * pins, a mirrored part, a zone fill matched to its outline, and rule areas.
 * Each `.txt.kicad_pcb` is `kicad-cli pcb import --format fabmaster -o <out>
 * <in>` (10.0.6).
 */

import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_IO_FABMASTER } from '@ziroeda/pcbnew/pcb_io/fabmaster/pcb_io_fabmaster.js';
import { FormatBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { installNodeOutlineFaces } from '../../../../perf/node_outline_faces.mjs';
import {
  firstDifference,
  normalizeBoard,
  readOracleFile,
  stripRenderCache,
} from '../pcb_io_oracle_support.js';

const DATA = fileURLToPath(
  new URL('../../../../data/pcbnew/pcb_io_oracle/fabmaster/', import.meta.url),
);

const BOARDS = [
  'cds2f_14066-20316FBRD.txt',
  'cds2f_issue7732_shape_pads2.txt',
  'cds2f_only_2_comp.txt',
  'cds2f_padstack_test.txt',
  'synthetic_ziro_features.txt',
];

function io(aName: string, aData?: Uint8Array): PCB_IO_FABMASTER {
  const plugin = new PCB_IO_FABMASTER();
  plugin.SetFileReader((p) =>
    p === aName ? (aData ?? readOracleFile(`${DATA}${aName}.gz`)) : null,
  );
  return plugin;
}

describe('PCB_IO_FABMASTER::LoadBoard against kicad-cli 10.0.6', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
    installNodeOutlineFaces();
  });

  for (const name of BOARDS) {
    it(name, () => {
      const board: BOARD = io(name).LoadBoard(name, null);
      board.SetFileName('');

      const ours = stripRenderCache(normalizeBoard(FormatBoard(board, 'pcbnew')));
      const theirs = stripRenderCache(
        normalizeBoard(new TextDecoder().decode(readOracleFile(`${DATA}${name}.kicad_pcb.gz`))),
      );

      expect(firstDifference(ours, theirs)).toBe('');
    }, 300_000);
  }

  it('reads only a .txt / .fab file with a keyword on a line of two or more "!"', () => {
    const enc = (s: string) => new TextEncoder().encode(s);

    expect(io('a.txt', enc('A!refdes!\nplain text\n')).CanReadBoard('a.txt')).toBe(true);
    expect(io('a.txt', enc('A!REFDES\nJ!x!y!\n')).CanReadBoard('a.txt')).toBe(false);
    expect(io('a.fab', enc(`${'x\n'.repeat(100)}A!REFDES!\n`)).CanReadBoard('a.fab')).toBe(false);
    expect(io('a.brd', enc('A!REFDES!COMP_CLASS!\n')).CanReadBoard('a.brd')).toBe(false);
  });
});

describe('PCB_IO_MGR finds the Fabmaster plugin', () => {
  it('a Fabmaster .txt board is Fabmaster', async () => {
    const { PCB_IO_MGR, PCB_FILE_T } = await import('@ziroeda/pcbnew/pcb_io/pcb_io_mgr.js');
    const name = BOARDS[3]!;
    const read = (p: string) => (p === name ? readOracleFile(`${DATA}${name}.gz`) : null);

    expect(await PCB_IO_MGR.FindPluginTypeFromBoardPath(name, read)).toBe(PCB_FILE_T.FABMASTER);
    expect(PCB_IO_MGR.ShowType(PCB_FILE_T.FABMASTER)).toBe('Fabmaster');
  });
});
