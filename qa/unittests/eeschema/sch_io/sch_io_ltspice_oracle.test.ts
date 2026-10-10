// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The LTspice importer against real eeschema 10.0.6.
 *
 * input/<name>/ is one of LTspice's own example schematics with a lib/ beside it holding only
 * the symbols and sub-schematics it places (qa/probes/schio_oracle/make_ltspice_fixtures.py):
 * eeschema finds LTspice's library through that lib/ folder when none is installed for it, and
 * so does the port, so both read exactly these files. kicad/<name>/ is what eeschema wrote after
 * File > Import > Non-KiCad Schematic... and File > Save (qa/probes/schio_oracle/oracle.sh,
 * SCHIO_SIBLINGS=1).
 *
 * Every sheet must match item for item. Set aside, by name: an instance's `(pin ...)` order,
 * heap order upstream (import_arm.ts pinsAsSet).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { importThroughFrame, minus, pinsAsSet, SCH_FILE_T, topLevelItems } from './import_arm.js';

const DIR = resolve(__dirname, '../../../data/eeschema/import_oracle/ltspice');
const CASES = readdirSync(join(DIR, 'kicad')).sort();

describe('SCH_IO_LTSPICE against eeschema 10.0.6', () => {
  beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
  afterEach(() => SetPgm(null));

  it.each(CASES)('%s', (aName) => {
    const kicadDir = join(DIR, 'kicad', aName);
    const ours = importThroughFrame(
      join(DIR, 'input', aName, `${aName}.asc`),
      SCH_FILE_T.SCH_LTSPICE,
    );

    const kicadSheets = readdirSync(kicadDir).filter((f) => f.endsWith('.kicad_sch'));
    expect([...ours.sheets.keys()].sort()).toEqual(kicadSheets.sort());

    for (const sheet of kicadSheets) {
      const kicad = topLevelItems(readFileSync(join(kicadDir, sheet), 'utf8')).map(pinsAsSet);
      const mine = topLevelItems(ours.sheets.get(sheet)!).map(pinsAsSet);

      expect(minus(mine, kicad), `${sheet}: items only ours`).toEqual([]);
      expect(minus(kicad, mine), `${sheet}: items only KiCad's`).toEqual([]);
    }
  }, 60_000);
});
