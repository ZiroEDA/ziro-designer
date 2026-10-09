// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The Allegro importer end to end (PCB_IO_ALLEGRO: parser + BOARD_BUILDER) against
 * KiCad 10.0.6's own conversion of the same boards (`kicad-cli pcb import`), with the
 * oracle rules every importer is held to (pcb_io_oracle_support.ts).
 *
 * Seven boards from KiCad's corpus, V16.6 and V17.4: zones and copper fills, padstacks
 * and vias, footprint text and fields, layer mapping. The large boards (BeagleBone,
 * EVK, CutiePi, VCU118) are covered by the opt-in corpus sweep, not here.
 */
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { FormatBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_FILE_T, PCB_IO_MGR } from '@ziroeda/pcbnew/pcb_io/pcb_io_mgr.js';
import {
  firstDifference,
  normalizeBoard,
  readOracleFile,
  stripRenderCache,
} from '../pcb_io_oracle_support.js';

const DATA = fileURLToPath(
  new URL('../../../../data/pcbnew/pcb_io_oracle/allegro/', import.meta.url),
);

const BOARDS = [
  'copper_text',
  'rects',
  'led_youtube',
  'TRS80_POWER',
  'ProiectBoard',
  'mainBoard',
  'mainBoard2',
];

beforeAll(() => EMBEDDED_FILES.InitCodec());

describe('PCB_IO_ALLEGRO matches kicad-cli pcb import', () => {
  it('PCB_IO_MGR picks the Allegro plugin for a .brd', async () => {
    const name = 'rects.brd';
    const type = await PCB_IO_MGR.FindPluginTypeFromBoardPath(name, () =>
      readOracleFile(`${DATA}${name}.gz`),
    );
    expect(type).toBe(PCB_FILE_T.ALLEGRO);
  });

  for (const b of BOARDS) {
    it(`${b}.brd imports exactly`, async () => {
      const name = `${b}.brd`;
      const pi = (await PCB_IO_MGR.FindPlugin(PCB_FILE_T.ALLEGRO))!;
      pi.SetFileReader(() => readOracleFile(`${DATA}${name}.gz`));
      const ours = stripRenderCache(
        normalizeBoard(FormatBoard(pi.LoadBoard(name, null), 'pcbnew')),
      );
      const theirs = stripRenderCache(
        normalizeBoard(new TextDecoder().decode(readOracleFile(`${DATA}${name}.kicad_pcb.gz`))),
      );
      expect(firstDifference(ours, theirs)).toBe('');
    }, 120_000);
  }
});
