// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_IO_PADS` and `PADS_IO::BINARY_PARSER` against KiCad 10.0.6.
 *
 * The boards are KiCad's `qa/data/pcbnew/plugins/pads`, gzipped (a board in
 * a directory is named `<dir>_<file>`). Each `.asc.kicad_pcb` is
 * `kicad-cli pcb import -o <out> <in>` (10.0.6). Outline-font render caches
 * are stripped: the faces KiCad renders with are not ours.
 *
 * The design settings and netclasses do not reach a `.kicad_pcb`;
 * `design_settings.json` is KiCad's own plugin read through its python
 * module (`design_settings.py`). The two `.kicad_dru` are the diff-pair gap
 * rules kicad-cli wrote beside Ems4_Rev2 and Dexter_MotorCtrl.
 *
 * KiCad 10.0.6 does not build PCB_IO_PADS_BINARY (it is missing from
 * `pcb_io/pads/CMakeLists.txt`), so kicad-cli cannot import a `.pcb`. Its
 * parser is held to the C++ instead: `binary_oracle/dump.cpp` compiles
 * upstream's `pads_binary_parser.cpp` and prints what it read; one board per
 * format version (0x2021, 0x2025, 0x2026, 0x2027) is kept.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import type { NETCLASS } from '@ziroeda/common/netclass.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { FormatBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { BINARY_PARSER } from '@ziroeda/pcbnew/pcb_io/pads/pads_binary_parser.js';
import { PCB_IO_PADS } from '@ziroeda/pcbnew/pcb_io/pads/pcb_io_pads.js';
import { PCB_IO_PADS_BINARY } from '@ziroeda/pcbnew/pcb_io/pads/pcb_io_pads_binary.js';
import { installNodeOutlineFaces } from '../../../../perf/node_outline_faces.mjs';
import {
  firstDifference,
  normalizeBoard,
  readOracleFile,
  stripRenderCache,
} from '../pcb_io_oracle_support.js';

const DATA = fileURLToPath(new URL('../../../../data/pcbnew/pcb_io_oracle/pads/', import.meta.url));

const BOARDS = readdirSync(DATA)
  .filter((f) => f.endsWith('.asc.gz'))
  .map((f) => f.slice(0, -'.gz'.length));

const BINARIES = readdirSync(DATA)
  .filter((f) => f.endsWith('.pcb.gz'))
  .map((f) => f.slice(0, -'.gz'.length));

function load(aName: string): { board: BOARD; io: PCB_IO_PADS } {
  const io = new PCB_IO_PADS();
  io.SetFileReader((p) => (p === aName ? readOracleFile(`${DATA}${aName}.gz`) : null));
  return { board: io.LoadBoard(aName, null), io };
}

describe('PCB_IO_PADS::LoadBoard against kicad-cli 10.0.6', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
    installNodeOutlineFaces();
  });

  it('has the boards', () => {
    expect(BOARDS.length).toBe(34);
  });

  for (const name of BOARDS) {
    it(name, () => {
      const ours = stripRenderCache(normalizeBoard(FormatBoard(load(name).board, 'pcbnew')));
      const theirs = stripRenderCache(
        normalizeBoard(new TextDecoder().decode(readOracleFile(`${DATA}${name}.kicad_pcb.gz`))),
      );

      expect(firstDifference(ours, theirs)).toBe('');
    }, 120_000);
  }
});

describe("PCB_IO_PADS design settings against KiCad 10.0.6's python module", () => {
  const expected = JSON.parse(readFileSync(`${DATA}design_settings.json`, 'utf8')) as Record<
    string,
    unknown
  >;

  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
  });

  const nc = (c: NETCLASS) => ({
    clearance: c.GetClearance(),
    dpGap: c.GetDiffPairGap(),
    dpWidth: c.GetDiffPairWidth(),
    trackWidth: c.GetTrackWidth(),
    viaDiameter: c.GetViaDiameter(),
    viaDrill: c.GetViaDrill(),
  });

  for (const name of BOARDS) {
    it(`${name}: rules, netclasses, vias, stackup`, () => {
      const { board } = load(name);
      const bds = board.GetDesignSettings();
      const ns = bds.m_NetSettings;
      const netclasses: Record<string, unknown> = { Default: nc(ns.GetDefaultNetclass()) };

      for (const [k, c] of ns.GetNetclasses()) netclasses[k] = nc(c);

      const patterns: Record<string, string> = {};
      const names = [...board.GetNetInfo().NetsByName().keys()].filter((n) => n !== '').sort();

      for (const n of names) {
        const c = ns.GetEffectiveNetClass(n).GetName();

        if (c !== 'Default') patterns[n] = c;
      }

      expect({
        copperLayers: board.GetCopperLayerCount(),
        customTrack: bds.GetCustomTrackWidth(),
        customVia: [bds.GetCustomViaSize(), bds.GetCustomViaDrill()],
        hasStackup: bds.m_HasStackup,
        m_CopperEdgeClearance: bds.m_CopperEdgeClearance,
        m_HoleToHoleMin: bds.m_HoleToHoleMin,
        m_MinClearance: bds.m_MinClearance,
        m_MinThroughDrill: bds.m_MinThroughDrill,
        m_SilkClearance: bds.m_SilkClearance,
        m_SolderMaskExpansion: bds.m_SolderMaskExpansion,
        m_TrackMinWidth: bds.m_TrackMinWidth,
        m_ViasMinSize: bds.m_ViasMinSize,
        netclasses,
        patterns,
        thickness: bds.GetBoardThickness(),
        viaSizes: bds.m_ViasDimensionsList.map((v) => [v.m_Diameter, v.m_Drill]),
      }).toEqual(expected[name]);
    }, 120_000);
  }

  for (const name of ['Ems4_Rev2_Ems4_Rev2', 'Dexter_MotorCtrl_Dexter_MotorCtrl']) {
    it(`${name}.kicad_dru: the diff-pair gap rules`, () => {
      const { io } = load(`${name}.asc`);
      expect(io.GetCustomRules()).toBe(readFileSync(`${DATA}${name}.kicad_dru`, 'utf8'));
    }, 120_000);
  }

  it('writes no rules file when no diff pair has a gap', () => {
    expect(load('issue23352.asc').io.GetCustomRules()).toBe('');
  }, 120_000);
});

describe("PADS_IO::BINARY_PARSER against KiCad 10.0.6's own", () => {
  for (const name of BINARIES) {
    it(name, () => {
      const p = new BINARY_PARSER();
      p.Parse(readOracleFile(`${DATA}${name}.gz`));

      const ours = {
        layer_count: p.GetParameters().layer_count,
        origin: [p.GetParameters().origin.x, p.GetParameters().origin.y],
        parts: p.GetParts().map((x) => [x.name, x.location.x, x.location.y, x.rotation]),
        nets: p.GetNets().map((n) => n.name),
        decals: [...p.GetPartDecals()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, v.units]),
        texts: p
          .GetTexts()
          .map((t) => [
            t.content,
            t.location.x,
            t.location.y,
            t.height,
            t.width,
            t.layer,
            t.rotation,
          ]),
        outlines: p.GetBoardOutlines().map((o) => o.points.map((q) => [q.x, q.y])),
        routes: p.GetRoutes().map((r) => ({
          tracks: r.tracks.map((t) => [
            t.width,
            t.points[0]!.x,
            t.points[0]!.y,
            t.points[1]!.x,
            t.points[1]!.y,
          ]),
          vias: r.vias.map((v) => [v.location.x, v.location.y]),
        })),
      };

      const theirs = JSON.parse(
        new TextDecoder().decode(readOracleFile(`${DATA}${name}.parser.json.gz`)),
      );

      expect(ours).toEqual(theirs);
    });
  }

  it('PCB_IO_PADS_BINARY reads a .pcb and the ASCII plugin does not', () => {
    const name = 'LCORE_2.pcb';
    const reader = (p: string) => (p === name ? readOracleFile(`${DATA}${name}.gz`) : null);
    const bin = new PCB_IO_PADS_BINARY();
    bin.SetFileReader(reader);
    const asc = new PCB_IO_PADS();
    asc.SetFileReader(reader);

    expect(bin.CanReadBoard(name)).toBe(true);
    expect(asc.CanReadBoard(name)).toBe(false);

    const board = bin.LoadBoard(name, null);
    expect(board.Footprints().length).toBe(30);
    expect(board.Tracks().length).toBeGreaterThan(0);
  });
});

describe('PCB_IO_MGR finds the PADS plugin', () => {
  it('an .asc board is PADS; a binary .pcb is nobody’s, as in 10.0.6', async () => {
    const { PCB_IO_MGR, PCB_FILE_T } = await import('@ziroeda/pcbnew/pcb_io/pcb_io_mgr.js');
    const asc = 'LCORE_2_LCORE_2.asc';
    const pcb = 'LCORE_2.pcb';
    const read = (p: string) => (p === asc || p === pcb ? readOracleFile(`${DATA}${p}.gz`) : null);

    expect(await PCB_IO_MGR.FindPluginTypeFromBoardPath(asc, read)).toBe(PCB_FILE_T.PADS);
    expect(await PCB_IO_MGR.FindPluginTypeFromBoardPath(pcb, read)).toBe(PCB_FILE_T.FILE_TYPE_NONE);
    expect(PCB_IO_MGR.ShowType(PCB_FILE_T.PADS)).toBe('PADS');
  });
});
