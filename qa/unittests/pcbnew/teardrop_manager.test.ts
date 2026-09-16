// TEARDROP_MANAGER over the item classes, driven through BOARD_COMMIT (issue
// 636, stage 2). The oracle is qa/data/pcbnew/teardrop_spike.kicad_pcb,
// KiCad's own RegressionTeardropSpike fixture: pcbnew 10.0 generated its
// three teardrop zones. Two of them are what UpdateTeardrops builds, vertex
// for vertex — a curved teardrop is the convex hull anchors, the Bezier
// tessellation and the clamps all agreeing. The third carries the spike the
// fixture was filed for; KiCad's test only asks that the rebuilt teardrop
// stays inside the track/pad corridor, and so does this one.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { TOOL_MANAGER } from '@ziroeda/common/src/tool/tool_manager.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOARD } from '@ziroeda/pcbnew/src/board.js';
import { BOARD_COMMIT, SKIP_SET_DIRTY, SKIP_UNDO } from '@ziroeda/pcbnew/src/board_commit.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/src/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import { TEARDROP_MANAGER } from '@ziroeda/pcbnew/src/teardrop/teardrop.js';
import type { ZONE } from '@ziroeda/pcbnew/src/zone.js';

const DATA = fileURLToPath(new URL('../../data/pcbnew/', import.meta.url));

function load(name: string): BOARD {
  const f = `${DATA}${name}.kicad_pcb`;
  return new PCB_IO_KICAD_SEXPR_PARSER(readFileSync(f, 'utf8'), f).Parse() as BOARD;
}

const outline = (z: ZONE): string =>
  z
    .Outline()
    .Outline(0)
    .CPoints()
    .map((p) => `${p.x},${p.y}`)
    .join(' ');

beforeAll(async () => {
  await EMBEDDED_FILES.InitCodec();
});

describe('TEARDROP_MANAGER', () => {
  it('rebuilds KiCad’s teardrops on teardrop_spike vertex for vertex, without the spike', () => {
    const board = load('teardrop_spike');

    const theirs = board.Zones().filter((z) => z.IsTeardropArea());
    expect(theirs.length).toBe(3);
    const theirOutlines = theirs.map((z) => ({
      layer: z.GetLayer(),
      pts: outline(z),
      prio: z.GetAssignedPriority(),
    }));

    for (const z of theirs) board.Remove(z);
    board.BuildConnectivity();

    const toolMgr = new TOOL_MANAGER();
    toolMgr.SetEnvironment(board, null, null, null, null);

    const commit = new BOARD_COMMIT(toolMgr);
    const teardropMgr = new TEARDROP_MANAGER(board, toolMgr);
    teardropMgr.UpdateTeardrops(commit, [], new Set(), true);

    expect(commit.Empty()).toBe(false);
    commit.Push('Add teardrops', SKIP_UNDO | SKIP_SET_DIRTY);

    const ours = board.Zones().filter((z) => z.IsTeardropArea());
    expect(ours.length).toBeGreaterThan(0);

    // The two teardrops the spike fix did not touch are reproduced exactly:
    // 16 and 12 vertices, on F_Cu and B_Cu.
    const exact = theirOutlines.filter((t) => t.pts.split(' ').length !== 12 || t.layer !== 0);
    expect(exact.length).toBe(2);
    for (const t of exact) {
      const o = ours.find((z) => outline(z) === t.pts);
      expect(o, `KiCad's teardrop on layer ${t.layer}: ${t.pts.slice(0, 60)}…`).toBeDefined();
      expect(o!.GetLayer()).toBe(t.layer);
    }

    // The priorities: MAGIC_TEARDROP_ZONE_ID (30000) upwards per layer, largest area first.
    const prios = ours.map((z) => z.GetAssignedPriority()).sort((a, b) => a - b);
    expect(prios[0]).toBe(30000);
    expect(new Set(prios).size).toBeGreaterThan(1);

    // No teardrop sweeps outside its track/pad corridor (RegressionTeardropSpike).
    const maxError = board.GetDesignSettings().m_MaxError;

    for (const zone of ours) {
      const layer = zone.GetFirstLayer();
      const netcode = zone.GetNetCode();
      const corridor = new SHAPE_POLY_SET();

      for (const fp of board.Footprints()) {
        for (const pad of fp.Pads()) {
          if (pad.GetNetCode() === netcode && pad.IsOnLayer(layer))
            pad.TransformShapeToPolygon(corridor, layer, 0, maxError, ERROR_LOC.ERROR_OUTSIDE);
        }
      }

      for (const track of board.Tracks()) {
        if (track.GetNetCode() === netcode && track.IsOnLayer(layer))
          track.TransformShapeToPolygon(corridor, layer, 0, maxError, ERROR_LOC.ERROR_OUTSIDE);
      }

      corridor.Inflate(pcbIUScale.mmToIU(0.127), CornerStrategy.ROUND_ALL_CORNERS, maxError);
      corridor.Simplify();

      const outside = new SHAPE_POLY_SET(zone.Outline());
      outside.BooleanSubtract(corridor);

      const tdArea = Math.abs(zone.Outline().Area());
      const outArea = Math.abs(outside.Area());
      const ratio = tdArea > 0 ? outArea / tdArea : 0.0;

      expect(
        ratio,
        `teardrop on layer ${layer} sweeps ${(ratio * 100).toFixed(1)}% outside its corridor`,
      ).toBeLessThanOrEqual(0.02);
    }
  });

  it('a via with teardrops disabled gets none, and the commit stays empty', () => {
    const board = load('teardrop_spike');
    for (const z of board.Zones().filter((z) => z.IsTeardropArea())) board.Remove(z);
    board.BuildConnectivity();

    for (const fp of board.Footprints())
      for (const pad of fp.Pads()) pad.GetTeardropParams().m_Enabled = false;
    for (const t of board.Tracks()) t.GetTeardropParams().m_Enabled = false;
    board
      .GetDesignSettings()
      .GetTeadropParamsList()
      .GetParameters(2 /* TARGET_TRACK */).m_Enabled = false;

    const toolMgr = new TOOL_MANAGER();
    toolMgr.SetEnvironment(board, null, null, null, null);
    const commit = new BOARD_COMMIT(toolMgr);
    new TEARDROP_MANAGER(board, toolMgr).UpdateTeardrops(commit, [], new Set(), true);
    expect(commit.Empty()).toBe(true);
    expect(board.Zones().filter((z) => z.IsTeardropArea()).length).toBe(0);
  });
});
