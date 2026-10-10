// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The Altium schematic importer against real eeschema 10.0.6.
 *
 * Four of KiCad's own Altium documents, unedited (binary compound files):
 * qa/data/eeschema/plugins/altium's issue22943 1_cover.SchDoc (seven embedded BMP images,
 * text frames, harness sheet symbols with no file; CERN-OHL-S, licence beside it) and issue24861
 * (a sheet repeated three times as CH1..CH3), and the two sheets of
 * qa/data/pcbnew/plugins/altium/eDP_adapter_dvt1_source (power ports, buses, parameters).
 * Each `kicad/` folder is what eeschema wrote after File > Import > Non-KiCad Schematic... and
 * File > Save (qa/probes/schio_oracle/oracle.sh). 1_cover's sheet is gzipped: the BMPs make it
 * 7.5 MB as text.
 *
 * Every sheet must match item for item. Set aside, by name: an instance's `(pin ...)` order,
 * heap order upstream (import_arm.ts pinsAsSet). An Altium import writes no library.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { importThroughFrame, minus, pinsAsSet, SCH_FILE_T, topLevelItems } from './import_arm.js';

const DIR = resolve(__dirname, '../../../data/eeschema/import_oracle/altium');

function readSheet(aPath: string): string {
  return aPath.endsWith('.gz')
    ? gunzipSync(readFileSync(aPath)).toString('utf8')
    : readFileSync(aPath, 'utf8');
}

describe('SCH_IO_ALTIUM against eeschema 10.0.6', () => {
  beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
  afterEach(() => SetPgm(null));

  it.each([
    ['issue22943', '1_cover.SchDoc'],
    ['issue24861', 'Repeated_Schematic.SchDoc'],
    ['edp_power', 'power.SchDoc'],
    ['edp_it6251_core', 'it6251_core.SchDoc'],
  ])(
    '%s',
    (aCase, aInput) => {
      const kicadDir = join(DIR, aCase, 'kicad');
      const ours = importThroughFrame(join(DIR, aCase, aInput), SCH_FILE_T.SCH_ALTIUM);

      const kicadSheets = readdirSync(kicadDir).filter((f) => /\.kicad_sch(\.gz)?$/.test(f));
      const names = kicadSheets.map((f) => f.replace(/\.gz$/, ''));
      expect([...ours.sheets.keys()].sort()).toEqual(names.sort());

      for (const file of kicadSheets) {
        const sheet = file.replace(/\.gz$/, '');
        const kicad = topLevelItems(readSheet(join(kicadDir, file))).map(pinsAsSet);
        const mine = topLevelItems(ours.sheets.get(sheet)!).map(pinsAsSet);

        expect(minus(mine, kicad), `${sheet}: items only ours`).toEqual([]);
        expect(minus(kicad, mine), `${sheet}: items only KiCad's`).toEqual([]);
      }
      // A whole import, with the frame's cleanup: seconds, not milliseconds.
    },
    60_000,
  );
});
