// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `ZONE_FILLER::Fill` on the live BOARD, vertex for vertex against the fills
 * KiCad itself wrote into the `qa/data/zone_fill/` boards (see the README
 * there): read a board, pour every zone again, and every `filled_polygon` of
 * every zone-layer has to come back in sequence.
 *
 * `waveorder_1006` is the 10.0.6 refill of `waveorder`. 10.0.6 walks the zone
 * dependency DAG, releasing a zone's dependents the moment its fill
 * publishes, where 10.0.5 ran the zones in waves; on that board the two give
 * different answers on three zone-layers, and this one is KiCad's.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { SETTINGS_MANAGER } from '@ziroeda/common/pgm_base.js';
import type { JsonValue } from '@ziroeda/common/settings/json_settings.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { ZONE_LAYER_OVERRIDE } from '@ziroeda/pcbnew/board_item.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/drc/drc_engine.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import type { PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { ZONE_FILLER } from '@ziroeda/pcbnew/zone_filler.js';

const DATA = resolve(import.meta.dirname, '../../data/zone_fill');

/** `KI_TEST::LoadBoard`: the project into the board, the DRC engine on its rules. */
function load(stem: string): BOARD {
  const path = `${DATA}/${stem}_kicad_cli.kicad_pcb`;
  const projectFile = `${DATA}/${stem.replace(/_1006$/, '')}.kicad_pro`;
  const manager = new SETTINGS_MANAGER();
  const hasProject = existsSync(projectFile);

  if (hasProject)
    manager.LoadProject(projectFile, JSON.parse(readFileSync(projectFile, 'utf8')) as JsonValue);

  const board = ParseBoard(readFileSync(path, 'utf8'), path);

  if (hasProject) board.SetProject(manager.Prj());

  const engine = new DRC_ENGINE(board, board.GetDesignSettings());
  engine.InitEngine(null);
  board.GetDesignSettings().m_DRCEngine = engine;

  board.BuildListOfNets();
  board.BuildConnectivity();

  return board;
}

const ringsOf = (aPolys: SHAPE_POLY_SET): string[] => {
  const out: string[] = [];

  for (let i = 0; i < aPolys.OutlineCount(); i++)
    out.push(
      aPolys
        .Outline(i)
        .CPoints()
        .map((p) => `${p.x},${p.y}`)
        .join(' '),
    );

  return out;
};

/** Every zone-layer's fill, keyed by zone uuid and layer. */
function fillsOf(aBoard: BOARD): Map<string, string[]> {
  const out = new Map<string, string[]>();

  for (const zone of aBoard.Zones())
    for (const layer of zone.GetLayerSet().Seq())
      if (zone.HasFilledPolysForLayer(layer))
        out.set(`${zone.m_Uuid} ${LSET.Name(layer)}`, ringsOf(zone.GetFilledPolysList(layer)));

  return out;
}

/** The copper layers every via and pad is ZLO_FORCE_FLASHED on — what the file records. */
function flashingOf(aBoard: BOARD): Map<string, string> {
  const out = new Map<string, string>();
  const cu = LSET.AllCuMask(aBoard.GetCopperLayerCount());
  const flashed = (aItem: PCB_VIA | PAD): string =>
    cu
      .Seq()
      .filter((l) => aItem.GetZoneLayerOverride(l) === ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED)
      .map((l) => LSET.Name(l))
      .join(' ');

  for (const track of aBoard.Tracks())
    if (track.Type() === KICAD_T.PCB_VIA_T)
      out.set(`via ${track.m_Uuid}`, flashed(track as unknown as PCB_VIA));

  for (const fp of aBoard.Footprints())
    for (const pad of fp.Pads()) out.set(`pad ${pad.m_Uuid}`, flashed(pad));

  return out;
}

/** Pour every zone of `stem` and compare with what KiCad wrote. */
function refill(stem: string) {
  const board = load(stem);
  const kicad = fillsOf(board);
  const kicadFlashing = flashingOf(board);

  expect(new ZONE_FILLER(board).Fill([...board.Zones()])).toBe(true);

  return { board, kicad, ours: fillsOf(board), kicadFlashing, ourFlashing: flashingOf(board) };
}

beforeAll(async () => {
  await EMBEDDED_FILES.InitCodec();
});

describe("the live BOARD's pour is KiCad's, ring for ring", () => {
  const boards: [string, number][] = [
    // stem, zone-layers the file carries a fill (possibly empty) for
    ['ecc83-pp', 1],
    ['StickHub', 5],
    ['hatch40', 1],
    ['hatchpads', 1],
    ['hatchfull', 1],
    ['hatchsmall', 1],
    ['custompads', 1],
    ['blindvias', 1],
    ['blindvias2', 1],
    ['flashing', 15],
    ['waveorder_1006', 7],
    ['fillpaths', 0],
  ];

  for (const [stem, layers] of boards) {
    it(`${stem}: ${layers} zone-layer(s)`, () => {
      const { kicad, ours } = refill(stem);

      if (layers) expect(kicad.size).toBe(layers);
      expect([...ours.keys()].sort()).toEqual([...kicad.keys()].sort());

      for (const [key, rings] of kicad) expect(ours.get(key), key).toEqual(rings);
    }, 60_000);
  }

  it('flashing: the per-layer flashing the pour leaves behind is the file’s', () => {
    // Both passes: the outline test before the first pour (`PrepareBoardForFill`)
    // and the re-check against the actual fills after the last (issue 22010).
    const { kicadFlashing, ourFlashing } = refill('flashing');

    expect([...kicadFlashing.values()].some((v) => v !== '')).toBe(true);
    expect(ourFlashing).toEqual(kicadFlashing);
  }, 60_000);
});

describe('one pour changes no cached geometry it reads', () => {
  it('bounding boxes are copies: a second pour gives the first one’s fills', () => {
    // `GetBoundingBox()` returns the item's cache; the C++ returns a copy, so
    // inflating it for a knockout reach must not grow the cache. On `flashing`
    // a grown pad box let a VCC pad's hole into a SIG zone's knockouts and moved
    // a near-parallel Clipper intersection by 0.4 um.
    const { board, ours } = refill('flashing');

    new ZONE_FILLER(board).Fill([...board.Zones()]);

    expect(fillsOf(board)).toEqual(ours);
  }, 60_000);
});

describe('the waveorder board is the one 10.0.6 changed', () => {
  it('the 10.0.5 and 10.0.6 refills differ, so the DAG order is what is pinned', () => {
    const v5 = fillsOf(load('waveorder'));
    const v6 = fillsOf(load('waveorder_1006'));
    let differ = 0;

    for (const [key, rings] of v6)
      if (JSON.stringify(v5.get(key)) !== JSON.stringify(rings)) differ++;

    expect(differ).toBe(3);
  });
});

describe('fillpaths: the paths no other board takes (make_fillpaths_board.py)', () => {
  it('R: a via inside the pour outline but out of reach of its fill loses its flashing (issue 22010)', () => {
    const board = load('fillpaths');
    const via = board
      .Tracks()
      .find(
        (t) => t.Type() === KICAD_T.PCB_VIA_T && t.GetPosition().x === 15000000,
      ) as unknown as PCB_VIA;
    const flashed = () =>
      via.GetZoneLayerOverride(PCB_LAYER_ID.In1_Cu) === ZONE_LAYER_OVERRIDE.ZLO_FORCE_FLASHED;

    // The outline test alone flashes it...
    new ZONE_FILLER(board).PrepareBoardForFill();
    expect(flashed()).toBe(true);

    // ...and the pour takes it back, as KiCad's file says.
    const { kicadFlashing, ourFlashing } = refill('fillpaths');
    expect(ourFlashing).toEqual(kicadFlashing);
    expect(kicadFlashing.get(`via ${via.m_Uuid}`)).toBe('');
  }, 60_000);
});
