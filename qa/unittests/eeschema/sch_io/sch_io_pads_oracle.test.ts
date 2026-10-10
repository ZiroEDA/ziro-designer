// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The PADS Logic schematic importer against real eeschema 10.0.6.
 *
 * KiCad's own eight PADS Logic samples, unedited (qa/data/eeschema/plugins/pads): single and
 * multi-sheet designs, multi-gate parts, connectors, power symbols, off-page connectors, a
 * PowerLogic header and a CP1250 code page. Each `kicad/` folder is what eeschema wrote after
 * File > Import > Non-KiCad Schematic... and File > Save (qa/probes/schio_oracle/oracle.sh).
 * A PADS import writes no library: its symbols are embedded, and its power symbols name KiCad's
 * own `power:` library, which UpdateSymbolLinks resolves through the global table. That table
 * here holds the three symbols the samples use, copied unedited from the installed 10.0.6
 * power.kicad_sym (KiCad libraries: CC-BY-SA 4.0 with the design exception).
 *
 * Every sheet must match item for item. Set aside, by name: an instance's `(pin ...)` order,
 * heap order upstream (import_arm.ts pinsAsSet).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { importThroughFrame, minus, pinsAsSet, SCH_FILE_T, topLevelItems } from './import_arm.js';

const DIR = resolve(__dirname, '../../../data/eeschema/import_oracle/pads');

describe('SCH_IO_PADS against eeschema 10.0.6', () => {
  beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
  afterEach(() => SetPgm(null));

  it.each([
    'simple_schematic',
    'parts_schematic',
    'symbols_schematic',
    'signals_schematic',
    'multigate_schematic',
    'powerlogic_schematic',
    'issue23420_codepage_schematic',
    'issue24284_multisheet_text',
  ])('%s', (aName) => {
    const kicadDir = join(DIR, aName, 'kicad');
    const ours = importThroughFrame(
      join(DIR, aName, `${aName}.txt`),
      SCH_FILE_T.SCH_PADS,
      undefined,
      {
        power: join(DIR, 'power.kicad_sym'),
      },
    );

    const kicadSheets = readdirSync(kicadDir).filter((f) => f.endsWith('.kicad_sch'));
    expect([...ours.sheets.keys()].sort()).toEqual(kicadSheets.sort());

    for (const sheet of kicadSheets) {
      const kicad = topLevelItems(readFileSync(join(kicadDir, sheet), 'utf8')).map(pinsAsSet);
      const mine = topLevelItems(ours.sheets.get(sheet)!).map(pinsAsSet);

      expect(minus(mine, kicad), `${sheet}: items only ours`).toEqual([]);
      expect(minus(kicad, mine), `${sheet}: items only KiCad's`).toEqual([]);
    }
    // A whole import, with the frame's cleanup: seconds, not milliseconds.
  }, 60_000);
});
