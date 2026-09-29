// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `generateSpiceModelNetlist` (netlist_exporter_spice_model.ts) against
 * `kicad-cli sch export netlist --format spicemodel`, whole file, for three
 * single-sheet designs in qa/data/eeschema — the same designs
 * netlist_formats_oracle.test.ts holds to the other five formats.
 *
 * Each design has exactly one Device:R symbol. Two independent base-class
 * quirks (`NETLIST_EXPORTER_SPICE::writeItems`'s own item order for 2+
 * symbols, which is not declaration order, and bus-vector hierarchical
 * labels needing expansion before `readPorts` sees them) are
 * `netlist_exporter_spice.ts`'s territory, not this file's four overrides —
 * one symbol and plain (non-vector) port names sidestep both so this test
 * pins only what NETLIST_EXPORTER_SPICE_MODEL itself adds: the `.subckt`
 * head/tail and the port-name substitution.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { generateSpiceModelNetlist } from '@ziroeda/eeschema/netlist_exporters/netlist_exporter_spice_model.js';

const DATA = new URL('../../data/eeschema/', import.meta.url).pathname;

const CASES: { schPath: string; oraclePath: string; projectName: string }[] = [
  {
    schPath: `${DATA}netlist_oracle/issue16003/untitled.kicad_sch`,
    oraclePath: `${DATA}netlist_oracle/issue16003/untitled.kicad-cli.spicemodel.net`,
    // Neither `untitled*.kicad_sch` has a project of its own, so
    // GetProjectName() is empty (`.subckt ` with nothing after it).
    projectName: '',
  },
  {
    schPath: `${DATA}netlist_oracle/issue16003/untitled2.kicad_sch`,
    oraclePath: `${DATA}netlist_oracle/issue16003/untitled2.kicad-cli.spicemodel.net`,
    projectName: '',
  },
  {
    // One symbol, two plain (non-vector) hierarchical-label ports: exercises
    // the port list and the pin-under-port-name substitution byte-exactly.
    schPath: `${DATA}netlist_oracle/issue14657/issue14657_2.kicad_sch`,
    oraclePath: `${DATA}netlist_oracle/issue14657/issue14657_2.kicad-cli.spicemodel.net`,
    // kicad-cli ran on the leaf sheet directly, not issue14657.kicad_pro's
    // root, so it has no project association and GetProjectName() is empty.
    projectName: '',
  },
];

describe('generateSpiceModelNetlist, against kicad-cli --format spicemodel', () => {
  for (const { schPath, oraclePath, projectName } of CASES) {
    it(`${schPath.split('/').slice(-2).join('/')} matches byte for byte`, () => {
      const text = readFileSync(schPath, 'utf8');
      const doc = readSchematic(parse(text));
      const lib = new Map(doc.libSymbols.map((l) => [l.libId, l]));
      const { text: got, errors } = generateSpiceModelNetlist(doc, lib, projectName);
      expect(errors).toEqual([]);
      const want = readFileSync(oraclePath, 'utf8');
      expect(got).toBe(want);
    });
  }

  it('never carries the plain-SPICE save options (no NET_TYPE_SPICE_MODEL case in createNetlist)', () => {
    const text = readFileSync(`${DATA}netlist_oracle/bus_entries/bus_entries.kicad_sch`, 'utf8');
    const doc = readSchematic(parse(text));
    const lib = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    const { text: got } = generateSpiceModelNetlist(doc, lib, 'bus_entries');
    expect(got).not.toContain('.save');
    expect(got).not.toContain('.probe');
  });

  it('forwards its resolve callback to the port-name lookup (GetShownText)', () => {
    const lib = `(lib_symbols
      (symbol "Device:R" (property "Reference" "R" (at 0 0 0))
        (symbol "R_1_1"
          (pin passive line (at 0 2.54 270) (length 0)
            (name "~" (effects (font (size 1.27 1.27))))
            (number "1" (effects (font (size 1.27 1.27)))))
          (pin passive line (at 0 -2.54 90) (length 0)
            (name "~" (effects (font (size 1.27 1.27))))
            (number "2" (effects (font (size 1.27 1.27))))))))`;
    const sch = `(kicad_sch (version 20230121) (generator eeschema) ${lib}
      (symbol (lib_id "Device:R") (at 10 10 90) (unit 1) (uuid "r1")
        (property "Reference" "R1" (at 0 0 0))
        (property "Value" "10k" (at 0 0 0)))
      (wire (pts (xy 0 10) (xy 7.46 10)) (uuid "wa"))
      (hierarchical_label "\${VAR}" (shape input) (at 0 10 180) (uuid "ha")))`;
    const doc = readSchematic(parse(sch));
    const libById = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    const resolve = (t: string): string => t.replace('${VAR}', 'VIN');
    const { text } = generateSpiceModelNetlist(doc, libById, 'p', null, { resolve });
    expect(text).toContain('+       VIN ; input');
    expect(text).toContain('R1 VIN');
  });
});
