// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_IO_PCAD` against KiCad 10.0.6's own reading of the same files.
 *
 * `pcad_4layer_glyph_test_ascii.PCB` is KiCad's `qa/data/pcbnew/plugins/pcad`
 * sample, gzipped; it holds only texts, lines, an arc and polygons.
 * `synthetic_ziro_features.PCB` is ours (`synthetic_ziro_features.make.py`
 * writes it): patterns old and extended, pads of every style, a pin map,
 * vias, nets with overbars, pours, cutouts, planes with and without content,
 * a keepout, the board outline and an incomplete stackup. Each
 * `.PCB.kicad_pcb` is `kicad-cli pcb import --format pcad -o <out> <in>`
 * (10.0.6).
 */

import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_IO_PCAD } from '@ziroeda/pcbnew/pcb_io/pcad/pcb_io_pcad.js';
import { FormatBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { installNodeOutlineFaces } from '../../../../perf/node_outline_faces.mjs';
import {
  firstDifference,
  normalizeBoard,
  readOracleFile,
  stripRenderCache,
} from '../pcb_io_oracle_support.js';

const DATA = fileURLToPath(new URL('../../../../data/pcbnew/pcb_io_oracle/pcad/', import.meta.url));

const BOARDS = ['pcad_4layer_glyph_test_ascii.PCB', 'synthetic_ziro_features.PCB'];

function io(aName: string, aData?: Uint8Array): PCB_IO_PCAD {
  const plugin = new PCB_IO_PCAD();
  plugin.SetFileReader((p) =>
    p === aName ? (aData ?? readOracleFile(`${DATA}${aName}.gz`)) : null,
  );
  return plugin;
}

describe('PCB_IO_PCAD::LoadBoard against kicad-cli 10.0.6', () => {
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
    }, 120_000);
  }

  it('reads only a .pcb file that starts "ACCEL_ASCII"', () => {
    const fake = new TextEncoder().encode('A fake Board file for testing');

    expect(io('fake.pcb', fake).CanReadBoard('fake.pcb')).toBe(false);
    expect(io(BOARDS[0]!).CanReadBoard(BOARDS[0]!)).toBe(true);
  });

  it('refuses any other file, as LoadInputFile does', () => {
    const fake = new TextEncoder().encode('ACCEL_ASCI "short"\n');

    expect(() => io('fake.pcb', fake).LoadBoard('fake.pcb', null)).toThrow('Unknown file type');
  });

  it('a stray closing parenthesis is an error', () => {
    const bad = new TextEncoder().encode('ACCEL_ASCII "x"\n(asciiHeader))\n');

    expect(() => io('bad.pcb', bad).LoadBoard('bad.pcb', null)).toThrow('Unexpected right paren');
  });
});

describe('PCB_IO_MGR finds the P-CAD plugin', () => {
  it('a .PCB board is P-Cad', async () => {
    const { PCB_IO_MGR, PCB_FILE_T } = await import('@ziroeda/pcbnew/pcb_io/pcb_io_mgr.js');
    const name = BOARDS[0]!;
    const read = (p: string) => (p === name ? readOracleFile(`${DATA}${name}.gz`) : null);

    expect(await PCB_IO_MGR.FindPluginTypeFromBoardPath(name, read)).toBe(PCB_FILE_T.PCAD);
    expect(PCB_IO_MGR.ShowType(PCB_FILE_T.PCAD)).toBe('P-Cad');
  });
});
