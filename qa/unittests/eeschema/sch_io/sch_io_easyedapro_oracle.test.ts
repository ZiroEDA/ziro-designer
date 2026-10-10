// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The EasyEDA Pro schematic importer against real eeschema 10.0.6.
 *
 * `chameleon.epro` is KiCad's own qa/data/pcbnew/plugins/easyedapro/"ProProject_Yuzuki
 * Chameleon_2023-09-02.epro" (CERN-OHL-S, licence beside it), unedited. `kicad/` is
 * what eeschema wrote after File > Import > Non-KiCad Schematic... on it, OK in
 * Choose Project to Import (row 0 is preselected) and File > Save
 * (qa/probes/schio_oracle/oracle.sh): five sheets, the project's symbol library and
 * the sym-lib-table row the import adds.
 *
 * Set aside, by name:
 *
 * - an instance's `(pin ...)` order: heap order upstream (import_arm.ts pinsAsSet);
 * - the embedded SVG logo in the drawing-frame symbols, which upstream imports into
 *   unit 0 (`Sheet_A3_0_0`, `Sheet_A4_0_0`) through GRAPHICS_IMPORTER_LIB_SYMBOL,
 *   whose port still yields records rather than live SCH_SHAPEs;
 * - the library's `(generator ...)`, ours by design (common/generator.ts).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import {
  type IMPORTED,
  importThroughFrame,
  minus,
  pinsAsSet,
  SCH_FILE_T,
  topLevelItems,
} from './import_arm.js';

const DIR = resolve(__dirname, '../../../data/eeschema/import_oracle/easyedapro');
const KICAD = join(DIR, 'kicad');

/** The unit-0 blocks that hold the SVG logo upstream, one per frame size the project uses. */
const SVG_UNITS = new Set(['Sheet_A3_0_0', 'Sheet_A4_0_0']);

/** A library's symbols and their unit sub-symbols, one string per `(symbol "...")` block. */
function symbolBlocks(aText: string): string[] {
  return aText.split(/\n(?=\t{1,3}\(symbol ")/).slice(1);
}

const blockName = (aBlock: string): string => /\(symbol "([^"]*)"/.exec(aBlock)![1]!;

const read = (aName: string): string => readFileSync(join(KICAD, aName), 'utf8');

describe('SCH_IO_EASYEDAPRO against eeschema 10.0.6', () => {
  let ours: IMPORTED;

  beforeAll(() => {
    SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER()));
    try {
      ours = importThroughFrame(join(DIR, 'chameleon.epro'), SCH_FILE_T.SCH_EASYEDAPRO);
    } finally {
      SetPgm(null);
    }
    // A whole import, with the frame's cleanup: seconds, not milliseconds.
  }, 60_000);
  beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
  afterEach(() => SetPgm(null));

  it('writes the same five sheets', () => {
    expect([...ours.sheets.keys()].sort()).toEqual([
      '1_POWER.kicad_sch',
      '2_DRAM.kicad_sch',
      '3_IO.kicad_sch',
      '4_PREP.kicad_sch',
      'chameleon.kicad_sch',
    ]);
  });

  it.each([
    'chameleon',
    '1_POWER',
    '2_DRAM',
    '3_IO',
    '4_PREP',
  ])('%s.kicad_sch matches item for item', (aSheet) => {
    const kicad = topLevelItems(read(`${aSheet}.kicad_sch`)).map(pinsAsSet);
    const mine = topLevelItems(ours.sheets.get(`${aSheet}.kicad_sch`)!).map(pinsAsSet);

    const isLib = (s: string) => s.startsWith('\t(lib_symbols');
    expect(
      minus(
        mine.filter((s) => !isLib(s)),
        kicad.filter((s) => !isLib(s)),
      ),
    ).toEqual([]);
    expect(
      minus(
        kicad.filter((s) => !isLib(s)),
        mine.filter((s) => !isLib(s)),
      ),
    ).toEqual([]);

    const kicadLib = symbolBlocks(kicad.find(isLib) ?? '');
    const myLib = symbolBlocks(mine.find(isLib) ?? '');
    expect(minus(myLib, kicadLib).map(blockName)).toEqual([]);

    const missing = minus(kicadLib, myLib).map(blockName);
    expect(missing.length).toBeLessThanOrEqual(1);
    expect(missing.every((n) => SVG_UNITS.has(n))).toBe(true);
  });

  it('adds the library to the project sym-lib-table exactly as eeschema does', () => {
    expect(new TextDecoder().decode(readWritten('sym-lib-table'))).toBe(read('sym-lib-table'));
  });

  it('writes the project symbol library, symbol for symbol', () => {
    const kicad = symbolBlocks(read('chameleon-easyedapro.kicad_sym'));
    const mine = symbolBlocks(
      new TextDecoder().decode(readWritten('chameleon-easyedapro.kicad_sym')),
    );

    expect(minus(mine, kicad).map(blockName)).toEqual([]);
    expect(minus(kicad, mine).map(blockName).sort()).toEqual([...SVG_UNITS].sort());
  });

  function readWritten(aName: string): Uint8Array {
    const data = ours.written.Read(aName);
    if (!data) throw new Error(`the import wrote no ${aName}`);
    return data;
  }
});
