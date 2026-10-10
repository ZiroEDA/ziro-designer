// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The CADSTAR Schematic Archive importer against real eeschema 10.0.6.
 *
 * KiCad ships no importable .csa, so the two inputs are written by
 * qa/probes/schio_oracle/make_cadstar_samples.py to the grammar cadstar_sch_archive_parser.cpp
 * reads: basic.csa (one sheet: parts plain, rotated and mirrored, power symbols, named and
 * unnamed nets, junctions, danglers, a bus with bus terminals, texts in every alignment,
 * figures with arcs, visible and hidden attributes; format version 9) and hierarchy.csa (two
 * sheets joined by a block, a two-gate part split across them, a signal reference,
 * documentation symbols, a scaled symbol, ALL_SHEETS text; format version 8). Each `kicad/`
 * folder is what eeschema wrote after File > Import > Non-KiCad Schematic... and File > Save
 * (qa/probes/schio_oracle/oracle.sh): every page, the `<project>.kicad_sym` library and the
 * sym-lib-table row.
 *
 * Every sheet must match item for item, the table byte for byte and the library symbol for
 * symbol. Set aside, by name: an instance's `(pin ...)` order, heap order upstream
 * (import_arm.ts pinsAsSet), and the library's `(generator ...)`, ours by design.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { importThroughFrame, minus, pinsAsSet, SCH_FILE_T, topLevelItems } from './import_arm.js';

const DIR = resolve(__dirname, '../../../data/eeschema/import_oracle/cadstar');

/** A library's top-level `(symbol "...")` blocks, the file's own closing parenthesis dropped. */
function librarySymbols(aText: string): string[] {
  const blocks = aText.split(/\n(?=\t\(symbol ")/).slice(1);
  if (blocks.length > 0)
    blocks[blocks.length - 1] = blocks[blocks.length - 1]!.replace(/\n\)\s*$/, '');
  return blocks;
}

describe('SCH_IO_CADSTAR_ARCHIVE against eeschema 10.0.6', () => {
  beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
  afterEach(() => SetPgm(null));

  it.each(['basic', 'hierarchy'])('%s', (aName) => {
    const kicadDir = join(DIR, aName, 'kicad');
    const ours = importThroughFrame(
      join(DIR, aName, `${aName}.csa`),
      SCH_FILE_T.SCH_CADSTAR_ARCHIVE,
    );

    const kicadSheets = readdirSync(kicadDir).filter((f) => f.endsWith('.kicad_sch'));
    expect([...ours.sheets.keys()].sort()).toEqual(kicadSheets.sort());

    for (const sheet of kicadSheets) {
      const kicad = topLevelItems(readFileSync(join(kicadDir, sheet), 'utf8')).map(pinsAsSet);
      const mine = topLevelItems(ours.sheets.get(sheet)!).map(pinsAsSet);

      expect(minus(mine, kicad), `${sheet}: items only ours`).toEqual([]);
      expect(minus(kicad, mine), `${sheet}: items only KiCad's`).toEqual([]);
    }

    const written = (aFile: string): string => {
      const data = ours.written.Read(aFile);
      if (!data) throw new Error(`the import wrote no ${aFile}`);
      return new TextDecoder().decode(data);
    };

    expect(written('sym-lib-table')).toBe(readFileSync(join(kicadDir, 'sym-lib-table'), 'utf8'));

    const lib = `${aName}.kicad_sym`;
    const kicadLib = librarySymbols(readFileSync(join(kicadDir, lib), 'utf8'));
    const myLib = librarySymbols(written(lib));

    expect(myLib.length).toBe(kicadLib.length);
    expect(minus(myLib, kicadLib)).toEqual([]);
    // A whole import, with the frame's cleanup: seconds, not milliseconds.
  }, 60_000);
});
