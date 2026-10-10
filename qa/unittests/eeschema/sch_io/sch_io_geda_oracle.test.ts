// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The gEDA / Lepton EDA schematic importer against real eeschema 10.0.6.
 *
 * input/ is KiCad's qa/data/eeschema/io/geda folder, unedited: the importer scans the
 * schematic's whole folder for .sym files and reads its gschemrc / lepton.conf, so every
 * sample is imported from inside the same folder eeschema imported it from. kicad/<name>/ is
 * what eeschema wrote after File > Import > Non-KiCad Schematic... and File > Save
 * (qa/probes/schio_oracle/oracle.sh, SCHIO_SIBLINGS=1). This machine has no gEDA install, so
 * symbols come from the folder, the built-in standard set, or placeholders - in both.
 *
 * input/ leaves out KiCad's priority_test/ and power_override_test/ sub-projects: each holds a
 * second resistor-1.sym / gnd-1.sym, and with two of a name upstream keeps whichever its
 * directory scan reaches last - filesystem order, so not reproducible. (The eeschema runs had
 * them present and kept ayab/stdlib's resistor-1.sym, the one left here.)
 *
 * Every sheet must match item for item. Set aside, by name: an instance's `(pin ...)` order,
 * heap order upstream (import_arm.ts pinsAsSet).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { SCH_IO_GEDA } from '@ziroeda/eeschema/sch_io/geda/sch_io_geda.js';
import { importThroughFrame, minus, pinsAsSet, SCH_FILE_T, topLevelItems } from './import_arm.js';

const DIR = resolve(__dirname, '../../../data/eeschema/import_oracle/geda');
const CASES = readdirSync(join(DIR, 'kicad')).sort();

describe('SCH_IO_GEDA against eeschema 10.0.6', () => {
  beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
  afterEach(() => SetPgm(null));

  it.each(CASES)('%s', (aName) => {
    const kicadDir = join(DIR, 'kicad', aName);
    const ours = importThroughFrame(join(DIR, 'input', `${aName}.sch`), SCH_FILE_T.SCH_GEDA);

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

describe('SCH_IO_GEDA refuses what eeschema refuses', () => {
  // KiCad's own negative samples: eeschema's importer declines both, so it writes nothing.
  it.each(['legacy_kicad', 'random'])('%s', (aName) => {
    const pi = new SCH_IO_GEDA();
    pi.SetFileReader((p) => {
      try {
        return new Uint8Array(readFileSync(p));
      } catch {
        return null;
      }
    });

    expect(pi.CanReadSchematicFile(join(DIR, 'input', `${aName}.sch`))).toBe(false);
  });
});
