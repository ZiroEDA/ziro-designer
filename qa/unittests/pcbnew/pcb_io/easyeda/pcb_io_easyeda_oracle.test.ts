// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_IO_EASYEDA` (EasyEDA / JLCEDA Std) against KiCad 10.0.6's own import
 * of the same files.
 *
 * The inputs are KiCad's qa samples (`qa/data/pcbnew/plugins/easyeda/`,
 * CC BY-NC-SA 3.0, see `sources.txt`): two board `.json`s, gzipped, and the
 * backup `.zip` holding the first. Each `.kicad_pcb` is
 * `kicad-cli pcb import -o <out> <in>` (10.0.6, format detected);
 * `smartwatch.pretty` is `kicad-cli fp upgrade --force -o <out> <in>.json`.
 *
 * Every text in these boards names an outline font (NotoSerifCJKsc-Medium,
 * which fontconfig here substitutes); its `render_cache` glyphs come from the
 * font engine and are set aside. The anchors, sizes and everything else are
 * compared.
 *
 * kicad-cli wrote 22 of the 23 packages and then dumped core: MOTOR_1020 has
 * no reference, so it is only required to load.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import {
  FormatBoard,
  FormatFootprintForLibrary,
  footprintSaveClone,
  ParseFootprintFile,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { PCB_IO_EASYEDA } from '@ziroeda/pcbnew/pcb_io/easyeda/pcb_io_easyeda_plugin.js';
import {
  firstDifference,
  normalizeBoard,
  normalizeFootprint,
  readOracleFile,
  stripRenderCache,
} from '../pcb_io_oracle_support.js';

const DATA = fileURLToPath(
  new URL('../../../../data/pcbnew/pcb_io_oracle/easyeda/', import.meta.url),
);

/** The plugin reading `aFile` (a `.json` stored gzipped, or the `.zip` as is). */
function plugin(aFile: string): PCB_IO_EASYEDA {
  const io = new PCB_IO_EASYEDA();
  const path = aFile.endsWith('.zip') ? `${DATA}${aFile}` : `${DATA}${aFile}.gz`;
  io.SetFileReader((p) => (p === aFile ? readOracleFile(path) : null));
  return io;
}

function compare(aFile: string, aOracle: string): void {
  const board = plugin(aFile).LoadBoard(aFile, null);
  const ours = stripRenderCache(normalizeBoard(FormatBoard(board, 'pcbnew')));
  const theirs = stripRenderCache(
    normalizeBoard(new TextDecoder().decode(readOracleFile(`${DATA}${aOracle}.kicad_pcb.gz`))),
  );

  expect(firstDifference(ours, theirs)).toBe('');
}

describe('PCB_IO_EASYEDA::LoadBoard against kicad-cli 10.0.6', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  it('smartwatch: 65 footprints, copper areas with fills, arcs, SVG 3D models', () => {
    compare('smartwatch.json', 'smartwatch');
  }, 120_000);

  it('usbmeter: a second board, CJK names', () => {
    compare('usbmeter.json', 'usbmeter');
  }, 120_000);

  it('backup.zip: the board found inside a project backup', () => {
    compare('backup.zip', 'backup');
  }, 120_000);
});

describe("PCB_IO_EASYEDA design settings against KiCad 10.0.6's python module", () => {
  // The default netclass never reaches a .kicad_pcb: design_settings.json is what
  // KiCad's own PCB_IO_EASYEDA leaves in it (design_settings.py).
  const expected = JSON.parse(readFileSync(`${DATA}design_settings.json`, 'utf8')) as Record<
    string,
    unknown
  >;

  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  for (const name of ['smartwatch', 'usbmeter']) {
    it(`${name}: the Default DRC rule in the default netclass, the centring offset`, () => {
      const file = `${name}.json`;
      const board = plugin(file).LoadBoard(file, null);
      const bds = board.GetDesignSettings();
      const c = bds.m_NetSettings.GetDefaultNetclass();
      const ao = bds.GetAuxOrigin();

      expect({
        auxOrigin: [ao.x, ao.y],
        copperLayers: board.GetCopperLayerCount(),
        default: {
          clearance: c.GetClearance(),
          trackWidth: c.GetTrackWidth(),
          viaDiameter: c.GetViaDiameter(),
          viaDrill: c.GetViaDrill(),
        },
      }).toEqual(expected[name]);
    }, 120_000);
  }
});

describe('PCB_IO_EASYEDA footprints against kicad-cli 10.0.6', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  it('smartwatch.json as a library: every package kicad-cli wrote', () => {
    const lib = 'smartwatch.json';
    const io = plugin(lib);

    const names: string[] = [];
    io.FootprintEnumerate(names, lib, true, null);

    const written = readdirSync(`${DATA}smartwatch.pretty`)
      .filter((f) => f.endsWith('.kicad_mod'))
      .map((f) => f.slice(0, -'.kicad_mod'.length));

    const unique = [...new Set(names)];
    expect(unique.length).toBe(23);
    expect(unique.filter((n) => !written.includes(n))).toEqual(['MOTOR_1020']);

    for (const name of unique) {
      const fp = io.FootprintLoad(lib, name, false, null);
      expect(fp, name).not.toBeNull();

      if (!written.includes(name)) continue;

      const kicadFp = ParseFootprintFile(
        readFileSync(`${DATA}smartwatch.pretty/${name}.kicad_mod`, 'utf8'),
      );

      // what FootprintSave does to its clone: orientation 0, on the front, detached
      const saved = fp!.Clone() as FOOTPRINT;
      footprintSaveClone(saved);

      expect(
        stripRenderCache(normalizeFootprint(FormatFootprintForLibrary(saved, 'pcbnew'))),
        name,
      ).toBe(stripRenderCache(normalizeFootprint(FormatFootprintForLibrary(kicadFp, 'pcbnew'))));
    }
  }, 120_000);
});
