// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `PCB_IO_CADSTAR_ARCHIVE` against KiCad 10.0.6's own reading of the same
 * files.
 *
 * The archives are KiCad's `qa/data/pcbnew/plugins/cadstar` (route_offset
 * and lib), gzipped. Each `.cpa.kicad_pcb` is `kicad-cli pcb import -o <out>
 * <in>` (10.0.6); `footprint-with-thermal-pad.pretty` is `kicad-cli fp
 * upgrade --force` of the library archive (the `.pretty` KiCad's qa keeps
 * beside it is an older format). Outline-font render caches are stripped:
 * the CADSTAR font resolves to a different face here.
 *
 * `synthetic_ziro_features.cpa` is ours (`synthetic_ziro_features.make.py`
 * builds it from revision7): every pad shape, slots, pad exceptions, mirrored
 * and rotated components, groups, templates with poured and loose coppers,
 * hatching, areas, the four dimension kinds, vias, junctions and route
 * offsets, none of which KiCad's own samples reach.
 *
 * `design_settings.json` is what KiCad's own plugin leaves in the design
 * settings and netclasses (neither reaches a `.kicad_pcb`), read through its
 * python module (`design_settings.py`).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import type { NETCLASS } from '@ziroeda/common/netclass.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { PCB_IO_CADSTAR_ARCHIVE } from '@ziroeda/pcbnew/pcb_io/cadstar/pcb_io_cadstar_archive.js';
import {
  FormatBoard,
  FormatFootprintForLibrary,
  footprintSaveClone,
  ParseFootprintFile,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { installNodeOutlineFaces } from '../../../../perf/node_outline_faces.mjs';
import {
  firstDifference,
  normalizeBoard,
  normalizeFootprint,
  readOracleFile,
  stripRenderCache,
} from '../pcb_io_oracle_support.js';

const DATA = fileURLToPath(
  new URL('../../../../data/pcbnew/pcb_io_oracle/cadstar/', import.meta.url),
);

const BOARDS = [
  'minimal_route_offset_curved_track.cpa',
  'revision7_format_no_routewidth.cpa',
  'synthetic_ziro_features.cpa',
];

function io(aName: string): PCB_IO_CADSTAR_ARCHIVE {
  const plugin = new PCB_IO_CADSTAR_ARCHIVE();
  plugin.SetFileReader((p) => (p === aName ? readOracleFile(`${DATA}${aName}.gz`) : null));
  return plugin;
}

const load = (aName: string): BOARD => io(aName).LoadBoard(aName, null);

describe('PCB_IO_CADSTAR_ARCHIVE::LoadBoard against kicad-cli 10.0.6', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
    installNodeOutlineFaces();
  });

  for (const name of BOARDS) {
    it(name, () => {
      const ours = stripRenderCache(normalizeBoard(FormatBoard(load(name), 'pcbnew')));
      const theirs = stripRenderCache(
        normalizeBoard(new TextDecoder().decode(readOracleFile(`${DATA}${name}.kicad_pcb.gz`))),
      );

      expect(firstDifference(ours, theirs)).toBe('');
    }, 120_000);
  }

  it('refuses a library archive as a board, as KiCad does', () => {
    const name = 'footprint-with-thermal-pad.cpa';
    expect(() => io(name).LoadBoard(name, null)).toThrow(/CADSTAR library file/);
  });

  it('reads only a file that starts "(CADSTARPCB"', () => {
    const plugin = new PCB_IO_CADSTAR_ARCHIVE();
    plugin.SetFileReader((p) =>
      p === 'fake.cpa' ? new TextEncoder().encode('A fake Board file for testing') : null,
    );

    expect(plugin.CanReadBoard('fake.cpa')).toBe(false);
    expect(io(BOARDS[0]!).CanReadBoard(BOARDS[0]!)).toBe(true);
  });
});

describe("PCB_IO_CADSTAR_ARCHIVE design settings against KiCad 10.0.6's python module", () => {
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
    it(`${name}: rules, netclasses, stackup`, () => {
      const board = load(name);
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
        annular: bds.m_ViasMinAnnularWidth,
        copperLayers: board.GetCopperLayerCount(),
        customTrack: bds.GetCustomTrackWidth(),
        customVia: [bds.GetCustomViaSize(), bds.GetCustomViaDrill()],
        hasStackup: bds.m_HasStackup,
        holeClearance: bds.m_HoleClearance,
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
});

describe('PCB_IO_CADSTAR_ARCHIVE footprint library against kicad-cli 10.0.6', () => {
  beforeAll(async () => {
    await EMBEDDED_FILES.InitCodec();
    installNodeOutlineFaces();
  });

  it('footprint-with-thermal-pad.cpa: every footprint', () => {
    const lib = 'footprint-with-thermal-pad.cpa';
    const plugin = io(lib);

    const names: string[] = [];
    plugin.FootprintEnumerate(names, lib, true, null);

    const written = readdirSync(`${DATA}footprint-with-thermal-pad.pretty`)
      .filter((f) => f.endsWith('.kicad_mod'))
      .map((f) => f.slice(0, -'.kicad_mod'.length));

    expect([...names].sort()).toEqual([...written].sort());

    for (const name of written) {
      const fp = plugin.FootprintLoad(lib, name, false, null);
      expect(fp, name).not.toBeNull();

      const saved = fp!.Clone() as FOOTPRINT;
      footprintSaveClone(saved);

      expect(
        stripRenderCache(normalizeFootprint(FormatFootprintForLibrary(saved, 'pcbnew'))),
        name,
      ).toBe(
        stripRenderCache(
          normalizeFootprint(
            FormatFootprintForLibrary(
              ParseFootprintFile(
                readFileSync(`${DATA}footprint-with-thermal-pad.pretty/${name}.kicad_mod`, 'utf8'),
              ),
              'pcbnew',
            ),
          ),
        ),
      );
    }
  }, 120_000);
});

describe('PCB_IO_MGR finds the CADSTAR plugin', () => {
  it('a .cpa board is CADSTAR PCB Archive', async () => {
    const { PCB_IO_MGR, PCB_FILE_T } = await import('@ziroeda/pcbnew/pcb_io/pcb_io_mgr.js');
    const name = BOARDS[0]!;
    const read = (p: string) => (p === name ? readOracleFile(`${DATA}${name}.gz`) : null);

    expect(await PCB_IO_MGR.FindPluginTypeFromBoardPath(name, read)).toBe(
      PCB_FILE_T.CADSTAR_PCB_ARCHIVE,
    );
    expect(PCB_IO_MGR.ShowType(PCB_FILE_T.CADSTAR_PCB_ARCHIVE)).toBe('CADSTAR PCB Archive');
  });
});
