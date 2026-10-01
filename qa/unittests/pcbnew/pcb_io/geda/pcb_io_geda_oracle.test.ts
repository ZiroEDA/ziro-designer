// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_IO_GEDA` against KiCad 10.0.6's own reading of the same files.
 *
 * The boards are KiCad's `qa/data/pcbnew/io/geda`, gzipped, and
 * `synthetic_ziro_features.pcb` (ours; `synthetic_ziro_features.make.py`
 * writes it): arcs on copper and elsewhere, the old "(" units, Pin( and Pad(
 * forms, every layer name mapLayer knows, a comment inside a parameter list,
 * a non-ASCII byte, a text with no scale, a polygon. Each `.pcb.kicad_pcb` is
 * `kicad-cli pcb import -o <out> <in>` (10.0.6).
 *
 * `gedalib` is a footprint library directory of ours, and `gedalib.pretty`
 * is `kicad-cli fp upgrade --force` of it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { PCB_IO_GEDA } from '@ziroeda/pcbnew/pcb_io/geda/pcb_io_geda.js';
import {
  FormatBoard,
  FormatFootprintForLibrary,
  footprintSaveClone,
  ParseFootprintFile,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { installNodeOutlineFaces } from '../../../../perf/node_outline_faces.mjs';
import {
  firstDifference,
  normalizeBoard,
  normalizeFootprint,
  readOracleFile,
  stripRenderCache,
} from '../pcb_io_oracle_support.js';

const DATA = fileURLToPath(new URL('../../../../data/pcbnew/pcb_io_oracle/geda/', import.meta.url));

const BOARDS = [
  'goodfet50.pcb',
  'minimal_test.pcb',
  'multilayer_test.pcb',
  'onsolder_test.pcb',
  'powermeter.pcb',
  'scsi2sd.pcb',
  'synthetic_ziro_features.pcb',
];

function io(aName: string, aData?: Uint8Array): PCB_IO_GEDA {
  const plugin = new PCB_IO_GEDA();
  plugin.SetFileReader((p) =>
    p === aName ? (aData ?? readOracleFile(`${DATA}${aName}.gz`)) : null,
  );
  return plugin;
}

describe('PCB_IO_GEDA::LoadBoard against kicad-cli 10.0.6', () => {
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

  it('reads only a .pcb file with "PCB[" or "PCB(" in its first 20 lines', () => {
    const name = 'non_geda.pcb';

    expect(io(name).CanReadBoard(name)).toBe(false);
    expect(io(BOARDS[0]!).CanReadBoard(BOARDS[0]!)).toBe(true);

    const late = new TextEncoder().encode(`${'#\n'.repeat(20)}PCB["late" 1000 1000]\n`);
    expect(io('late.pcb', late).CanReadBoard('late.pcb')).toBe(false);
  });

  // The message is kicad-cli's for the same file.
  it('a via with too few parameters is an error, as upstream', () => {
    const bad = new TextEncoder().encode('PCB["x" 1000 1000]\nVia[1 2 3 4]\n');

    expect(() => io('bad.pcb', bad).LoadBoard('bad.pcb', null)).toThrow(
      'Via token contains 7 parameters, expected at least 10.',
    );
  });
});

describe('PCB_IO_GEDA footprint library against kicad-cli 10.0.6', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
    installNodeOutlineFaces();
  });

  const LIB = 'gedalib';

  function libIo(): PCB_IO_GEDA {
    const plugin = new PCB_IO_GEDA();
    plugin.SetDirectoryLister((d) => (d === LIB ? readdirSync(`${DATA}${LIB}`) : null));
    plugin.SetFileReader((p) =>
      p.startsWith(`${LIB}/`) ? new Uint8Array(readFileSync(`${DATA}${p}`)) : null,
    );
    return plugin;
  }

  it('gedalib: every footprint', () => {
    const plugin = libIo();
    const names: string[] = [];

    plugin.FootprintEnumerate(names, LIB, true, null);

    const written = readdirSync(`${DATA}gedalib.pretty`)
      .filter((f) => f.endsWith('.kicad_mod'))
      .map((f) => f.slice(0, -'.kicad_mod'.length));

    expect([...names].sort()).toEqual([...written].sort());

    for (const name of written) {
      const fp = plugin.FootprintLoad(LIB, name, false, null);
      expect(fp, name).not.toBeNull();

      const saved = fp!.Clone() as FOOTPRINT;
      footprintSaveClone(saved);

      expect(
        stripRenderCache(normalizeFootprint(FormatFootprintForLibrary(saved, 'pcbnew'))),
        name,
      ).toBe(
        stripRenderCache(
          normalizeFootprint(
            FormatFootprintForLibrary(
              ParseFootprintFile(readFileSync(`${DATA}gedalib.pretty/${name}.kicad_mod`, 'utf8')),
              'pcbnew',
            ),
          ),
        ),
      );
    }
  }, 120_000);

  it('a missing library directory: nothing with best efforts, an error without', () => {
    const plugin = libIo();
    const names: string[] = [];

    plugin.FootprintEnumerate(names, 'nowhere', true, null);
    expect(names).toEqual([]);
    expect(() => plugin.FootprintEnumerate(names, 'nowhere', false, null)).toThrow(
      "Footprint library 'nowhere' not found.",
    );
  });

  it('ImportFootprint reads the first Element past comments', () => {
    const out = { value: '' };
    const fp = libIo().ImportFootprint(`${LIB}/R0805.fp`, out, null);

    expect(out.value).toBe('R0805');
    expect(fp?.GetFPID().GetLibItemName()).toBe('R0805');
    expect(libIo().ImportFootprint(`${LIB}/notfp.txt`, { value: '' }, null)).toBeNull();
  });
});

describe('PCB_IO_MGR finds the gEDA plugin', () => {
  it('a gEDA .pcb board is gEDA / Lepton EDA', async () => {
    const { PCB_IO_MGR, PCB_FILE_T } = await import('@ziroeda/pcbnew/pcb_io/pcb_io_mgr.js');
    const name = BOARDS[1]!;
    const read = (p: string) => (p === name ? readOracleFile(`${DATA}${name}.gz`) : null);

    expect(await PCB_IO_MGR.FindPluginTypeFromBoardPath(name, read)).toBe(PCB_FILE_T.GEDA_PCB);
    expect(PCB_IO_MGR.ShowType(PCB_FILE_T.GEDA_PCB)).toBe('gEDA / Lepton EDA');
  });
});
