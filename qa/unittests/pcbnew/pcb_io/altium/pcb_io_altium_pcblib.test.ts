// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/pcbnew/pcb_io/altium/test_altium_pcblib_import.cpp`: every
 * footprint of KiCad's three sample `.PcbLib`s against its KiCad reference
 * `.kicad_mod` (`qa/data/pcbnew/plugins/altium/pcblib/`, copied here with the
 * libraries gzipped).
 *
 * Upstream checks the enumerated names, REF** / the name as value, then
 * `KI_TEST::CheckFootprint` field by field. Here the two FOOTPRINTs are each
 * written by `FootprintSave`'s formatter and the texts compared, uuids masked
 * and children in writer-independent order: every field CheckFootprint reads
 * is in that text, and so is everything it skips.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import {
  FormatFootprintForLibrary,
  ParseFootprintFile,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_IO_ALTIUM_DESIGNER } from '@ziroeda/pcbnew/pcb_io/altium/pcb_io_altium_designer.js';
import { normalizeFootprint, readOracleFile } from '../pcb_io_oracle_support.js';

const DATA = fileURLToPath(
  new URL('../../../../data/pcbnew/pcb_io_oracle/altium/pcblib/', import.meta.url),
);

const altium_to_kicad_footprint_property: [string, string][] = [
  ['Tracks.v5.PcbLib', 'Tracks.pretty'],
  ['Tracks.v6.PcbLib', 'Tracks.pretty'],
  ['Espressif ESP32-WROOM-32.PcbLib', 'Espressif ESP32-WROOM-32.pretty'],
];

describe('AltiumPcbLibImport', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  for (const [altiumLibraryName, kicadLibraryName] of altium_to_kicad_footprint_property) {
    it(`AltiumPcbLibImport2 ${altiumLibraryName}`, () => {
      const altiumPlugin = new PCB_IO_ALTIUM_DESIGNER();
      altiumPlugin.SetFileReader((p) =>
        p === altiumLibraryName ? readOracleFile(`${DATA}${altiumLibraryName}.gz`) : null,
      );

      const altiumFootprintNames: string[] = [];
      altiumPlugin.FootprintEnumerate(altiumFootprintNames, altiumLibraryName, true, null);

      const kicadFootprintNames = readdirSync(`${DATA}${kicadLibraryName}`)
        .filter((f) => f.endsWith('.kicad_mod'))
        .map((f) => f.slice(0, -'.kicad_mod'.length));

      expect(altiumFootprintNames.length).toBe(kicadFootprintNames.length);

      for (const footprintName of altiumFootprintNames) {
        const altiumFp = altiumPlugin.FootprintLoad(altiumLibraryName, footprintName, false, null);
        expect(altiumFp, footprintName).not.toBeNull();

        expect(altiumFp!.GetReference()).toBe('REF**');
        expect(altiumFp!.GetValue()).toBe(footprintName);

        const kicadFp = ParseFootprintFile(
          readFileSync(`${DATA}${kicadLibraryName}/${footprintName}.kicad_mod`, 'utf8'),
        );

        expect(
          normalizeFootprint(FormatFootprintForLibrary(altiumFp!, 'pcbnew')),
          footprintName,
        ).toBe(normalizeFootprint(FormatFootprintForLibrary(kicadFp, 'pcbnew')));
      }
    }, 120_000);
  }
});
