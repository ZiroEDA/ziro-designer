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

/** Import `aName.brd` and write it the way kicad-cli's `SaveBoard` does. */
function importEagle(aName: string): string {
  const io = new PCB_IO_EAGLE();
  io.SetFileReader((p) => (p === aName ? readOracleFile(`${DATA}${aName}.brd.gz`) : null));
  const board = io.LoadBoard(aName, null);
  return FormatBoard(board, 'pcbnew');
}

function compare(aName: string): void {
  const theirs = new TextDecoder().decode(readOracleFile(`${DATA}${aName}.kicad_pcb.gz`));

  expect(firstDifference(normalizeBoard(importEagle(aName)), normalizeBoard(theirs))).toBe('');
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
