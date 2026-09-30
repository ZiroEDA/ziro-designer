// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_IO_EAGLE` against KiCad 10.0.6's own import of the same files.
 *
 * The `.brd`s and `.lbr`s are KiCad's qa samples
 * (`qa/data/pcbnew/plugins/eagle/`, gzipped; the Adafruit board keeps its
 * CC BY-SA licence beside it). Each `.kicad_pcb` is
 * `kicad-cli pcb import --format eagle -o <out> <in>` and each `.pretty` is
 * `kicad-cli fp upgrade --force -o <out> <in>.lbr`, both 10.0.6. See
 * `../pcb_io_oracle_support.ts` for what the board comparison sets aside.
 *
 * The boards subsume upstream's `test_eagle_board_import.cpp`
 * (ViaNetAssignment on Adafruit, TextJustification on test_eagle) and
 * `test_eagle_managed_lib_naming.cpp` (issue18515): every via net, text
 * justification and footprint name those check is in the compared text.
 * The libraries are `test_eagle_lbr_import.cpp`'s EagleLbrLibImport, plus
 * `user-layers-test.lbr`, the library upstream's UserLayerMapping reads.
 *
 * `synthetic.brd` is ours, written to reach what the qa samples do not: design
 * rules (restring clamps, elongation, roundness, mask and paste frames), a
 * clearance matrix, inner layers and blind / buried vias, ranked, hatched and
 * cutout polygons, keepouts on the restrict layers, every dimension type,
 * smashed attributes under each display mode, long / offset / octagon pads.
 * Its `.kicad_pcb` and `.kicad_dru` are what kicad-cli 10.0.6 wrote for it.
 *
 * The design settings and netclasses do not reach a `.kicad_pcb`;
 * `design_settings.json` is what KiCad 10.0.6's own `PCB_IO_EAGLE` leaves in
 * them, read through its python module (`design_settings.py`).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import {
  FormatBoard,
  FormatFootprintForLibrary,
  ParseFootprintFile,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { NETCLASS } from '@ziroeda/common/netclass.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_IO_EAGLE } from '@ziroeda/pcbnew/pcb_io/eagle/pcb_io_eagle.js';
import {
  firstDifference,
  normalizeBoard,
  normalizeFootprint,
  readOracleFile,
} from '../pcb_io_oracle_support.js';

const DATA = fileURLToPath(
  new URL('../../../../data/pcbnew/pcb_io_oracle/eagle/', import.meta.url),
);

/** `aName.brd` loaded by our plugin. */
function loadEagle(aName: string): { io: PCB_IO_EAGLE; board: BOARD } {
  const io = new PCB_IO_EAGLE();
  io.SetFileReader((p) => (p === aName ? readOracleFile(`${DATA}${aName}.brd.gz`) : null));
  return { io, board: io.LoadBoard(aName, null) };
}

/** Import `aName.brd` and write it the way kicad-cli's `SaveBoard` does. */
function importEagle(aName: string): string {
  return FormatBoard(loadEagle(aName).board, 'pcbnew');
}

function compare(aName: string): void {
  const theirs = new TextDecoder().decode(readOracleFile(`${DATA}${aName}.kicad_pcb.gz`));

  expect(firstDifference(normalizeBoard(importEagle(aName)), normalizeBoard(theirs))).toBe('');
}

interface NETCLASS_VALUES {
  clearance: number;
  trackWidth: number;
  viaDiameter: number;
  viaDrill: number;
}

/** What `design_settings.py` reads off KiCad's board. */
function designSettings(aBoard: BOARD): Record<string, unknown> {
  const bds = aBoard.GetDesignSettings();
  const ns = bds.m_NetSettings;
  const nc = (c: NETCLASS): NETCLASS_VALUES => ({
    clearance: c.GetClearance(),
    trackWidth: c.GetTrackWidth(),
    viaDiameter: c.GetViaDiameter(),
    viaDrill: c.GetViaDrill(),
  });
  const netclasses: Record<string, NETCLASS_VALUES> = { Default: nc(ns.GetDefaultNetclass()) };

  for (const [name, c] of ns.GetNetclasses()) netclasses[name] = nc(c);

  return {
    copperLayers: aBoard.GetCopperLayerCount(),
    m_MinClearance: bds.m_MinClearance,
    m_MinThroughDrill: bds.m_MinThroughDrill,
    m_TrackMinWidth: bds.m_TrackMinWidth,
    m_ViasMinAnnularWidth: bds.m_ViasMinAnnularWidth,
    m_ViasMinSize: bds.m_ViasMinSize,
    netclasses,
  };
}

describe('PCB_IO_EAGLE::LoadBoard against kicad-cli 10.0.6', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  it('issue18515_managed_lib: managed-library URNs, package names without the URN', () => {
    compare('issue18515_managed_lib');
  }, 60_000);

  it('test_eagle: text justification under element rotation and mirroring', () => {
    compare('test_eagle');
  }, 60_000);

  it('Adafruit_AHT20: signals, vias, polygons, classes, smashed attributes', () => {
    compare('Adafruit_AHT20');
  }, 120_000);

  it('synthetic: design rules, inner layers, keepouts, every polygon and pad kind', () => {
    compare('synthetic');
  }, 60_000);

  it("synthetic: the clearance matrix is kicad-cli's .kicad_dru, character for character", () => {
    const { io } = loadEagle('synthetic');

    expect(io.GetCustomRules()).toBe(readFileSync(`${DATA}synthetic.kicad_dru`, 'utf8'));
  }, 60_000);
});

describe('PCB_IO_EAGLE design settings and netclasses against KiCad 10.0.6', () => {
  const expected = JSON.parse(readFileSync(`${DATA}design_settings.json`, 'utf8')) as Record<
    string,
    unknown
  >;

  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  for (const name of ['issue18515_managed_lib', 'test_eagle', 'Adafruit_AHT20', 'synthetic']) {
    it(`${name}: minimum sizes, clearance and every netclass`, () => {
      expect(designSettings(loadEagle(name).board)).toEqual(expected[name]);
    }, 60_000);
  }
});

describe('PCB_IO_EAGLE footprint libraries against kicad-cli 10.0.6', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  for (const lib of ['SparkFun-GPS', 'user-layers-test']) {
    it(`EagleLbrLibImport ${lib}.lbr`, () => {
      const libPath = `${lib}.lbr`;
      const eaglePlugin = new PCB_IO_EAGLE();
      eaglePlugin.SetFileReader((p) =>
        p === libPath ? readOracleFile(`${DATA}lbr/${libPath}.gz`) : null,
      );

      const eagleFootprintNames: string[] = [];
      eaglePlugin.FootprintEnumerate(eagleFootprintNames, libPath, true, null);

      const kicadFootprintNames = readdirSync(`${DATA}lbr/${lib}.pretty`)
        .filter((f) => f.endsWith('.kicad_mod'))
        .map((f) => f.slice(0, -'.kicad_mod'.length));

      expect([...eagleFootprintNames].sort()).toEqual([...kicadFootprintNames].sort());

      for (const footprintName of eagleFootprintNames) {
        const eagleFp = eaglePlugin.FootprintLoad(libPath, footprintName, false, null);
        expect(eagleFp, footprintName).not.toBeNull();

        // Upstream's own checks, on its own library: user-layers-test's package has no
        // >NAME / >VALUE text, so its fields stay empty (the compared text pins that).
        if (lib === 'SparkFun-GPS') {
          expect(eagleFp!.GetReference()).toBe('REF**');
          expect(eagleFp!.GetValue()).toBe(footprintName);
        }

        const kicadFp = ParseFootprintFile(
          readFileSync(`${DATA}lbr/${lib}.pretty/${footprintName}.kicad_mod`, 'utf8'),
        );

        expect(
          normalizeFootprint(FormatFootprintForLibrary(eagleFp!, 'pcbnew')),
          footprintName,
        ).toBe(normalizeFootprint(FormatFootprintForLibrary(kicadFp, 'pcbnew')));
      }
    }, 120_000);
  }
});
