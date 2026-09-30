// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_IO_EASYEDAPRO` against KiCad 10.0.6's own import of the same projects.
 *
 * The archives are KiCad's qa samples (`qa/data/pcbnew/plugins/easyedapro/`,
 * MIT and CERN-OHL-S, see `sources.txt`), stored under short names; each is
 * handed to the plugin under its original name, because the footprint
 * library is named after the file.
 *
 * kicad-cli cannot import these: a project with several boards asks a chooser
 * the CLI never registers (`std::bad_function_call`). So each board's
 * `.kicad_pcb` is KiCad's own PCB_IO_EASYEDAPRO through its python module,
 * loading a copy of the archive whose `project.json` lists only that board,
 * saved by its s-expression writer (`board_oracle.py`); ours loads the
 * untouched archive with the `pcb_id` property naming the board, which is
 * the other way LoadBoard picks one. The single-board ControlBoard archive
 * is loaded with neither.
 *
 * Outline-font `render_cache` glyphs are set aside, as for the other
 * importers; everything else is compared.
 *
 * The footprints: `stm_controlboard.pretty` is `kicad-cli fp upgrade` of the
 * ControlBoard archive, and `efoo.pretty` is KiCad's FootprintLoad of the
 * lone `.efoo` saved by FootprintSave (`efoo_oracle.py`; fp upgrade does not
 * take an `.efoo`). The `.efoo` is upstream's PolygonPadImport sample.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { PAD_SHAPE, PADSTACK } from '@ziroeda/pcbnew/padstack.js';
import {
  FormatBoard,
  FormatFootprintForLibrary,
  footprintSaveClone,
  ParseFootprintFile,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_IO_EASYEDAPRO } from '@ziroeda/pcbnew/pcb_io/easyedapro/pcb_io_easyedapro.js';
import {
  firstDifference,
  normalizeBoard,
  normalizeFootprint,
  readOracleFile,
  stripRenderCache,
} from '../pcb_io_oracle_support.js';

const DATA = fileURLToPath(
  new URL('../../../../data/pcbnew/pcb_io_oracle/easyedapro/', import.meta.url),
);

/** The original archive names, and the short names they are stored under. */
const ARCHIVES: Record<string, string> = {
  'ProProject_Scanning Tunneling Microscope OpenSTM_2023-09-02.zip': 'stm_project.zip',
  'ProProject_Yuzuki_Chameleon_2022-08-21.zip': 'yuzuki_2022.zip',
  'Scanning Tunneling Microscope OpenSTM ControlBoard.zip': 'stm_controlboard.zip',
  'PDFN-8_L3.2-W3.1-P0.65-LS3.4-BL-EP2.efoo': 'PDFN-8_L3.2-W3.1-P0.65-LS3.4-BL-EP2.efoo',
};

function plugin(): PCB_IO_EASYEDAPRO {
  const io = new PCB_IO_EASYEDAPRO();
  io.SetFileReader((p) => (ARCHIVES[p] ? new Uint8Array(readFileSync(DATA + ARCHIVES[p])) : null));
  return io;
}

function compare(aArchive: string, aOracle: string, aPcbId: string | null): void {
  const props = aPcbId === null ? null : new Map([['pcb_id', aPcbId]]);
  const board = plugin().LoadBoard(aArchive, null, props);
  const ours = stripRenderCache(normalizeBoard(FormatBoard(board, 'pcbnew')));
  const theirs = stripRenderCache(
    normalizeBoard(new TextDecoder().decode(readOracleFile(`${DATA}${aOracle}`))),
  );

  expect(firstDifference(ours, theirs)).toBe('');
}

/** Each stored board of a project: its pcb id, from `<short>__<id>.kicad_pcb.gz`. */
function boardsOf(aShort: string): string[] {
  return readdirSync(DATA)
    .filter((f) => f.startsWith(`${aShort}__`))
    .map((f) => f.slice(aShort.length + 2, -'.kicad_pcb.gz'.length))
    .sort();
}

describe('PCB_IO_EASYEDAPRO::LoadBoard against KiCad 10.0.6', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  it('ControlBoard: a one-board project, no pcb_id needed', () => {
    compare(
      'Scanning Tunneling Microscope OpenSTM ControlBoard.zip',
      'stm_controlboard.kicad_pcb.gz',
      null,
    );
  }, 120_000);

  for (const [original, short] of [
    ['ProProject_Scanning Tunneling Microscope OpenSTM_2023-09-02.zip', 'stm_project'],
    ['ProProject_Yuzuki_Chameleon_2022-08-21.zip', 'yuzuki_2022'],
  ] as const) {
    for (const id of boardsOf(short)) {
      it(`${short} board ${id}`, () => {
        compare(original, `${short}__${id}.kicad_pcb.gz`, id);
      }, 120_000);
    }
  }

  it('a project with several boards and no pcb_id asks the chooser', () => {
    const io = plugin();
    let offered: string[] = [];

    io.RegisterCallback((descs) => {
      offered = descs.map((d) => d.PCBId);
      return [];
    });

    // nothing chosen: no board (LoadBoard returns nullptr upstream)
    expect(io.LoadBoard('ProProject_Yuzuki_Chameleon_2022-08-21.zip', null)).toBeNull();
    expect(offered.sort()).toEqual(boardsOf('yuzuki_2022'));
  }, 60_000);
});

describe('PCB_IO_EASYEDAPRO footprints against KiCad 10.0.6', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  const saved = (fp: FOOTPRINT): string => {
    const clone = fp.Clone() as FOOTPRINT;
    footprintSaveClone(clone);
    return stripRenderCache(normalizeFootprint(FormatFootprintForLibrary(clone, 'pcbnew')));
  };

  const reference = (aDir: string, aName: string): string =>
    stripRenderCache(
      normalizeFootprint(
        FormatFootprintForLibrary(
          ParseFootprintFile(readFileSync(`${DATA}${aDir}/${aName}.kicad_mod`, 'utf8')),
          'pcbnew',
        ),
      ),
    );

  it('PolygonPadImport: the .efoo, its polygon pads custom, the whole footprint as KiCad loads it', () => {
    const lib = 'PDFN-8_L3.2-W3.1-P0.65-LS3.4-BL-EP2.efoo';
    const fpName = 'PDFN-8_L3.2-W3.1-P0.65-LS3.4-BL-EP2';
    const fp = plugin().FootprintLoad(lib, fpName, false, null);

    expect(fp).not.toBeNull();

    // upstream's checks: 8 numbered pads plus 2 polygon-shaped pads (9 and 10)
    expect(fp!.Pads().length).toBe(10);

    for (const n of ['9', '10']) {
      const pad = fp!.FindPadByNumber(n);
      expect(pad).not.toBeNull();
      expect(pad!.GetShape(PADSTACK.ALL_LAYERS)).toBe(PAD_SHAPE.CUSTOM);
      expect(pad!.GetPrimitives(PADSTACK.ALL_LAYERS).length).toBeGreaterThan(0);
    }

    expect(saved(fp!)).toBe(reference('efoo.pretty', fpName));
  }, 60_000);

  it('ControlBoard as a library: every footprint kicad-cli wrote', () => {
    const lib = 'Scanning Tunneling Microscope OpenSTM ControlBoard.zip';
    const io = plugin();

    const names: string[] = [];
    io.FootprintEnumerate(names, lib, true, null);

    const written = readdirSync(`${DATA}stm_controlboard.pretty`)
      .filter((f) => f.endsWith('.kicad_mod'))
      .map((f) => f.slice(0, -'.kicad_mod'.length));

    expect([...new Set(names)].sort()).toEqual([...written].sort());

    for (const name of written) {
      const fp = io.FootprintLoad(lib, name, false, null);
      expect(fp, name).not.toBeNull();
      expect(saved(fp!), name).toBe(reference('stm_controlboard.pretty', name));
    }
  }, 120_000);
});
