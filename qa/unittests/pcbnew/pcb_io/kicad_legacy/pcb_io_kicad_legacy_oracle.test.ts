// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_IO_KICAD_LEGACY` against KiCad 10.0.6's own reading of the same files.
 *
 * The boards are KiCad's `qa/data/pcbnew/plugins/legacy_demos` (the 2008
 * demos, `source.txt`), gzipped; each `.kicad_pcb` is
 * `kicad-cli pcb import -o <out> <in>` (10.0.6, format detected).
 *
 * The design settings and netclasses do not reach a `.kicad_pcb`;
 * `design_settings.json` is what KiCad's own plugin leaves in them, read
 * through its python module (`design_settings.py`).
 *
 * KiCad's qa has no legacy footprint library, so `interf_u.mod` is ours: the
 * interf_u board's thirteen distinct $MODULEs in a `PCBNEW-LibModule-V1`
 * library, the first repeated so the duplicate is renamed `_v2`.
 * `interf_u.pretty` is `kicad-cli fp upgrade --force` of it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import type { NETCLASS } from '@ziroeda/common/netclass.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { Dwgs_User, Edge_Cuts, F_Cu, F_SilkS } from '@ziroeda/common/layer_id.js';
import {
  FormatBoard,
  FormatFootprintForLibrary,
  footprintSaveClone,
  ParseFootprintFile,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_IO_KICAD_LEGACY } from '@ziroeda/pcbnew/pcb_io/kicad_legacy/pcb_io_kicad_legacy.js';
import {
  firstDifference,
  normalizeBoard,
  normalizeFootprint,
  readOracleFile,
} from '../pcb_io_oracle_support.js';

const DATA = fileURLToPath(
  new URL('../../../../data/pcbnew/pcb_io_oracle/kicad_legacy/', import.meta.url),
);

const BOARDS = [
  'ecc83-pp',
  'ecc83-pp_v2',
  'flat_hierarchy',
  'interf_u',
  'microwave',
  'pic_programmer',
  'sonde_xilinx',
  'carte_test',
  'video',
];

function load(aName: string): BOARD {
  const io = new PCB_IO_KICAD_LEGACY();
  const path = `${aName}.brd`;
  io.SetFileReader((p) => (p === path ? readOracleFile(`${DATA}${path}.gz`) : null));
  return io.LoadBoard(path, null);
}

describe('PCB_IO_KICAD_LEGACY::LoadBoard against kicad-cli 10.0.6', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  for (const name of BOARDS) {
    it(`${name}.brd`, () => {
      const ours = normalizeBoard(FormatBoard(load(name), 'pcbnew'));
      const theirs = normalizeBoard(
        new TextDecoder().decode(readOracleFile(`${DATA}${name}.kicad_pcb.gz`)),
      );

      expect(firstDifference(ours, theirs)).toBe('');
    }, 120_000);
  }
});

describe("PCB_IO_KICAD_LEGACY design settings against KiCad 10.0.6's python module", () => {
  const expected = JSON.parse(readFileSync(`${DATA}design_settings.json`, 'utf8')) as Record<
    string,
    unknown
  >;

  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  const nc = (c: NETCLASS) => ({
    clearance: c.GetClearance(),
    trackWidth: c.GetTrackWidth(),
    uViaDiameter: c.GetuViaDiameter(),
    uViaDrill: c.GetuViaDrill(),
    viaDiameter: c.GetViaDiameter(),
    viaDrill: c.GetViaDrill(),
  });

  for (const name of BOARDS) {
    it(`${name}: $SETUP, $NCLASS and the layer count`, () => {
      const board = load(name);
      const bds = board.GetDesignSettings();
      const ns = bds.m_NetSettings;
      const netclasses: Record<string, unknown> = { Default: nc(ns.GetDefaultNetclass()) };

      for (const [k, c] of ns.GetNetclasses()) netclasses[k] = nc(c);

      expect({
        copperLayers: board.GetCopperLayerCount(),
        lineThickness: [F_Cu, Edge_Cuts, F_SilkS, Dwgs_User].map((l) => bds.GetLineThickness(l)),
        m_MicroViasMinDrill: bds.m_MicroViasMinDrill,
        m_MicroViasMinSize: bds.m_MicroViasMinSize,
        m_MinThroughDrill: bds.m_MinThroughDrill,
        m_SolderMaskExpansion: bds.m_SolderMaskExpansion,
        m_SolderPasteMargin: bds.m_SolderPasteMargin,
        m_SolderPasteMarginRatio: bds.m_SolderPasteMarginRatio,
        m_TrackMinWidth: bds.m_TrackMinWidth,
        m_ViasMinSize: bds.m_ViasMinSize,
        netclasses,
        trackWidths: [...bds.m_TrackWidthList],
        viaSizes: bds.m_ViasDimensionsList.map((v) => [v.m_Diameter, v.m_Drill]),
        zoneClearance: bds.GetDefaultZoneSettings().m_ZoneClearance,
      }).toEqual(expected[name]);
    }, 120_000);
  }
});

describe('PCB_IO_KICAD_LEGACY footprint library against kicad-cli 10.0.6', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  it('interf_u.mod: every footprint, the duplicate renamed _v2', () => {
    const lib = 'interf_u.mod';
    const io = new PCB_IO_KICAD_LEGACY();
    io.SetFileReader((p) => (p === lib ? new Uint8Array(readFileSync(DATA + lib)) : null));

    const names: string[] = [];
    io.FootprintEnumerate(names, lib, true, null);

    const written = readdirSync(`${DATA}interf_u.pretty`)
      .filter((f) => f.endsWith('.kicad_mod'))
      .map((f) => f.slice(0, -'.kicad_mod'.length));

    expect([...names].sort()).toEqual([...written].sort());

    for (const name of written) {
      const fp = io.FootprintLoad(lib, name, false, null);
      expect(fp, name).not.toBeNull();

      const saved = fp!.Clone() as FOOTPRINT;
      footprintSaveClone(saved);

      expect(normalizeFootprint(FormatFootprintForLibrary(saved, 'pcbnew')), name).toBe(
        normalizeFootprint(
          FormatFootprintForLibrary(
            ParseFootprintFile(readFileSync(`${DATA}interf_u.pretty/${name}.kicad_mod`, 'utf8')),
            'pcbnew',
          ),
        ),
      );
    }
  }, 120_000);
});
