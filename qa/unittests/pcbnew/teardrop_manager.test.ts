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
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { BOARD_COMMIT, SKIP_SET_DIRTY, SKIP_UNDO } from '@ziroeda/pcbnew/board_commit.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import { TEARDROP_MANAGER } from '@ziroeda/pcbnew/teardrop/teardrop.js';
import type { ZONE } from '@ziroeda/pcbnew/zone.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FormatBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { TEARDROP_TYPE } from '@ziroeda/pcbnew/teardrop/teardrop_types.js';
import { ZONE_BORDER_DISPLAY_STYLE } from '@ziroeda/pcbnew/zone_settings.js';

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

// ---------------------------------------------------------------------------
// The cases the retired view-side generator (pcbnew/teardrop.ts) pinned,
// carried onto TEARDROP_MANAGER over hand-written boards. Where the old
// generator and teardrop.cpp disagreed, the C++ decides and the case says so.

const MM = (n: number): number => pcbIUScale.mmToIU(n);

let uuidSeq = 0;
/** A real KIID: a non-uuid string reads as a random one. */
const U = (): string => `00000000-0000-4000-8000-${(++uuidSeq).toString(16).padStart(12, '0')}`;

const TD_ON = '(teardrops (enabled yes))';

const viaAt = (x: number, y: number, size = 0.8, td = TD_ON): string =>
  `(via (at ${x} ${y}) (size ${size}) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) ${td} (uuid "${U()}"))`;

const seg = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width = 0.25,
  layer = '(layer "F.Cu")',
  extra = '',
): string =>
  `(segment (start ${x1} ${y1}) (end ${x2} ${y2}) (width ${width}) ${layer} (net 1) ${extra} (uuid "${U()}"))`;

const fpWithPad = (x: number, y: number, shape = 'circle', size = '1.5 1.5'): string =>
  `(footprint "R" (layer "F.Cu") (uuid "${U()}") (at ${x} ${y})
    (pad "1" smd ${shape} (at 0 0) (size ${size}) (layers "F.Cu") (net 1 "N1") ${TD_ON} (uuid "${U()}")))`;

const pcb = (...items: string[]): BOARD => {
  const text = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6) (legacy_teardrops no))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (1 "F.Mask" user) (3 "B.Mask" user) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (net 1 "N1")
  ${items.join('\n  ')}
)`;
  return new PCB_IO_KICAD_SEXPR_PARSER(text, 'case.kicad_pcb').Parse() as BOARD;
};

/** UpdateTeardrops( commit, nullptr, nullptr, true ), then Push. */
function teardrops(board: BOARD, trackToTrack = false): ZONE[] {
  if (trackToTrack)
    board
      .GetDesignSettings()
      .GetTeadropParamsList()
      .GetParameters(2 /* TARGET_TRACK */).m_Enabled = true;
  board.BuildConnectivity();
  const toolMgr = new TOOL_MANAGER();
  toolMgr.SetEnvironment(board, null, null, null, null);
  const commit = new BOARD_COMMIT(toolMgr);
  new TEARDROP_MANAGER(board, toolMgr).UpdateTeardrops(commit, [], new Set(), true);
  commit.Push('Add teardrops', SKIP_UNDO | SKIP_SET_DIRTY);
  return board.Zones().filter((z) => z.IsTeardropArea());
}

const pts = (z: ZONE) => z.Outline().Outline(0).CPoints();
const span = (z: ZONE, axis: 'x' | 'y'): number => {
  const v = pts(z).map((p) => p[axis]);
  return Math.max(...v) - Math.min(...v);
};
const maxX = (z: ZONE): number => Math.max(...pts(z).map((p) => p.x));

describe('TEARDROP_MANAGER: pads and vias', () => {
  it('flares a track where it lands on a via, as a filled, invisible-border zone', () => {
    const zones = teardrops(pcb(viaAt(10, 10), seg(10, 10, 20, 10)));

    expect(zones).toHaveLength(1);
    const z = zones[0]!;
    expect(z.GetTeardropAreaType()).toBe(TEARDROP_TYPE.TD_VIAPAD);
    expect(z.GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
    expect(z.GetNetCode()).toBe(1);
    expect(pts(z).length).toBeGreaterThanOrEqual(5);
    expect(z.GetHatchStyle()).toBe(ZONE_BORDER_DISPLAY_STYLE.INVISIBLE_BORDER);
    expect(z.GetAssignedPriority()).toBe(30000);
    // "the teardrop fill is the same as its outline" (teardrop.cpp createTeardrop).
    expect(z.IsFilled()).toBe(true);
    expect(z.GetFilledPolysList(PCB_LAYER_ID.F_Cu).Outline(0).CPoints()).toEqual(pts(z));
  });

  it('never grows wider than the via it flares into', () => {
    const z = teardrops(pcb(viaAt(10, 10), seg(10, 10, 20, 10)))[0]!;
    expect(span(z, 'y')).toBeLessThanOrEqual(MM(0.8));
  });

  it('skips a track as thick as the via it meets', () => {
    // 0.8 mm into a 0.8 mm via: width >= annular width * m_BestWidthRatio.
    expect(teardrops(pcb(viaAt(10, 10), seg(10, 10, 20, 10, 0.8)))).toHaveLength(0);
  });

  it('flares both ends where a track crosses clean through a via', () => {
    // teardrop.cpp tries the track as it is, then — the via centre being on
    // the track — its `reversed` copy once toward each end. The old view-side
    // generator only promised ">= 2"; the three attempts are the C++'s.
    expect(teardrops(pcb(viaAt(10, 10), seg(5, 10, 15, 10)))).toHaveLength(3);
  });

  it('reaches pads through their footprints, rectangular ones too', () => {
    expect(teardrops(pcb(fpWithPad(10, 10), seg(10, 10, 20, 10)))).toHaveLength(1);

    const rect = teardrops(pcb(fpWithPad(10, 10, 'rect', '2 1'), seg(10, 10, 20, 10)));
    expect(rect).toHaveLength(1);
    // GetWidth is the pad's smaller side.
    expect(span(rect[0]!, 'y')).toBeLessThanOrEqual(MM(1));
  });

  it('leaves a pad alone when a filled zone of its net already connects it', () => {
    const flood = (td: boolean) =>
      pcb(
        `(footprint "R" (layer "F.Cu") (uuid "${U()}") (at 10 10)
          (pad "1" smd circle (at 0 0) (size 1.5 1.5) (layers "F.Cu") (net 1 "N1")
            (teardrops (enabled yes) (prefer_zone_connections ${td ? 'no' : 'yes'})) (uuid "${U()}")))`,
        seg(10, 10, 20, 10),
        `(zone (net 1) (net_name "N1") (layer "F.Cu") (uuid "${U()}") (hatch edge 0.5)
          (connect_pads (clearance 0.5)) (min_thickness 0.25) (filled_areas_thickness no)
          (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
          (polygon (pts (xy 0 0) (xy 40 0) (xy 40 40) (xy 0 40)))
          (filled_polygon (layer "F.Cu") (pts (xy 0 0) (xy 40 0) (xy 40 40) (xy 0 40))))`,
      );

    expect(teardrops(flood(false))).toHaveLength(0);
    // ...unless the pad's parameters say to build them anyway (m_TdOnPadsInZones).
    expect(teardrops(flood(true))).toHaveLength(1);
  });

  it('builds on a non-round pad and on a disabled via-target list alike', () => {
    // The old generator filtered on the board list's m_TargetVias and
    // m_UseRoundShapesOnly. teardrop.cpp does not: UpdateTeardrops reads only
    // each item's own m_Enabled; the targets are Edit Teardrops' scope.
    const b = pcb(viaAt(10, 10), seg(10, 10, 20, 10));
    const list = b.GetDesignSettings().GetTeadropParamsList();
    list.m_TargetVias = false;
    list.m_UseRoundShapesOnly = true;
    expect(teardrops(b)).toHaveLength(1);
  });
});

describe('TEARDROP_MANAGER: the shape', () => {
  const via = (td: string) => teardrops(pcb(viaAt(0, 0, 0.8, td), seg(0, 0, 5, 0)))[0]!;

  it('honours the max-length clamp', () => {
    expect(maxX(via('(teardrops (enabled yes) (max_length 0.1))'))).toBeLessThan(maxX(via(TD_ON)));
  });

  it('honours the max-width clamp', () => {
    const narrow = via('(teardrops (enabled yes) (max_width 0.4))');
    expect(span(narrow, 'y')).toBeLessThan(span(via(TD_ON), 'y'));
    expect(span(narrow, 'y')).toBeLessThanOrEqual(MM(0.4));
  });

  it('tessellates curved edges, and the curve does not overshoot the straight flare', () => {
    const straight = via(TD_ON);
    const curved = via('(teardrops (enabled yes) (curved_edges yes))');
    expect(pts(curved).length).toBeGreaterThan(pts(straight).length);
    expect(maxX(curved)).toBeLessThanOrEqual(maxX(straight));
  });

  it('mirrors the shape when the track direction is mirrored', () => {
    const east = teardrops(pcb(viaAt(0, 0), seg(0, 0, 5, 0)))[0]!;
    const west = teardrops(pcb(viaAt(0, 0), seg(0, 0, -5, 0)))[0]!;
    const xs = (z: ZONE) => pts(z).map((p) => p.x);
    expect(Math.max(...xs(west))).toBe(-Math.min(...xs(east)));
    expect(Math.min(...xs(west))).toBe(-Math.max(...xs(east)));
  });
});

describe('TEARDROP_MANAGER: track to track', () => {
  it('flares the junction where a thin track meets a fat one', () => {
    const zones = teardrops(pcb(seg(0, 0, 10, 0, 0.2), seg(10, 0, 20, 0, 1.0)), true);
    expect(zones).toHaveLength(1);
    expect(zones[0]!.GetTeardropAreaType()).toBe(TEARDROP_TYPE.TD_TRACKEND);
  });

  it('only when TARGET_TRACK is enabled', () => {
    expect(teardrops(pcb(seg(0, 0, 10, 0, 0.2), seg(10, 0, 20, 0, 1.0)), false)).toHaveLength(0);
  });

  it('leaves two tracks of the same width alone', () => {
    expect(teardrops(pcb(seg(0, 0, 10, 0, 0.5), seg(10, 0, 20, 0, 0.5)), true)).toHaveLength(0);
  });

  it('leaves widths within the filter threshold alone', () => {
    // 0.5 / 0.9 = 0.555…, KiROUNDed to 555 556 nm, still over 0.55 mm.
    expect(teardrops(pcb(seg(0, 0, 10, 0, 0.5), seg(10, 0, 20, 0, 0.55)), true)).toHaveLength(0);
  });

  it('yields to a via sitting at the junction', () => {
    const b = pcb(viaAt(10, 0, 1.2, ''), seg(0, 0, 10, 0, 0.2), seg(10, 0, 20, 0, 1.0));
    expect(teardrops(b, true)).toHaveLength(0);
  });
});

describe('TEARDROP_MANAGER: priorities', () => {
  it('counts up from MAGIC_TEARDROP_ZONE_ID within each layer, largest first', () => {
    const b = pcb(
      viaAt(0, 0, 0.8),
      seg(0, 0, 5, 0, 0.25),
      viaAt(20, 0, 0.8, '(teardrops (enabled yes) (max_width 0.5))'),
      seg(20, 0, 25, 0, 0.25),
      seg(40, 0, 45, 0, 0.25, '(layer "B.Cu")'),
      viaAt(40, 0, 0.8),
    );
    const zones = teardrops(b);
    const on = (l: number) =>
      zones
        .filter((z) => z.GetLayer() === l)
        .map((z) => ({ area: Math.abs(z.Outline().Area()), prio: z.GetAssignedPriority() }))
        .sort((a, c) => a.prio - c.prio);

    const front = on(PCB_LAYER_ID.F_Cu);
    expect(front.map((t) => t.prio)).toEqual([30000, 30001]);
    expect(front[0]!.area).toBeGreaterThan(front[1]!.area);
    expect(on(PCB_LAYER_ID.B_Cu).map((t) => t.prio)).toEqual([30000]);
  });
});

describe('TEARDROP_MANAGER: the solder mask opening', () => {
  const masked = (layers: string, extra = '', expansion?: number) => {
    const b = pcb(viaAt(10, 10), seg(10, 10, 20, 10, 0.25, layers, extra));
    if (expansion !== undefined) b.GetDesignSettings().m_SolderMaskExpansion = expansion;
    const zones = teardrops(b);
    const isMask = (z: ZONE) =>
      z.GetLayer() === PCB_LAYER_ID.F_Mask || z.GetLayer() === PCB_LAYER_ID.B_Mask;
    return { copper: zones.find((z) => !isMask(z))!, mask: zones.find(isMask) };
  };

  it('is not built for a track with no mask opening', () => {
    expect(masked('(layer "F.Cu")').mask).toBeUndefined();
  });

  it('is built netless on the matching mask layer, B.Mask for B.Cu', () => {
    const f = masked('(layers "F.Cu" "F.Mask")');
    expect(f.mask!.GetLayer()).toBe(PCB_LAYER_ID.F_Mask);
    // A mask opening is not copper; a net on it would put it in the ratsnest.
    expect(f.mask!.GetNetCode()).toBe(0);
    expect(f.mask!.GetTeardropAreaType()).toBe(TEARDROP_TYPE.TD_VIAPAD);

    const b = teardrops(pcb(viaAt(10, 10), seg(10, 10, 20, 10, 0.25, '(layers "B.Cu" "B.Mask")')));
    expect(b.map((z) => z.GetLayer()).sort()).toEqual(
      [PCB_LAYER_ID.B_Cu, PCB_LAYER_ID.B_Mask].sort(),
    );
  });

  it('matches the copper shape when the expansion is zero', () => {
    const { copper, mask } = masked('(layers "F.Cu" "F.Mask")', '', 0);
    expect(pts(mask!)).toEqual(pts(copper));
  });

  it('grows by the board expansion, raising the zone min thickness to it', () => {
    const { copper, mask } = masked('(layers "F.Cu" "F.Mask")', '', MM(0.2));
    expect(span(mask!, 'x')).toBeGreaterThan(span(copper, 'x'));
    expect(mask!.GetMinThickness()).toBe(MM(0.2));
  });

  it('prefers the track’s own margin over the board default', () => {
    const { mask } = masked('(layers "F.Cu" "F.Mask")', '(solder_mask_margin 0.3)', MM(0.05));
    expect(mask!.GetMinThickness()).toBe(MM(0.3));
  });

  it('clamps a negative margin at half the track width, so the opening cannot invert', () => {
    const { copper, mask } = masked('(layers "F.Cu" "F.Mask")', '(solder_mask_margin -1)');
    expect(span(mask!, 'x')).toBeLessThan(span(copper, 'x'));
    expect(span(mask!, 'x')).toBeGreaterThan(0);
  });

  it('is written on its mask layer with the teardrop attribute and `hatch none`', () => {
    const b = pcb(viaAt(10, 10), seg(10, 10, 20, 10, 0.25, '(layers "F.Cu" "F.Mask")'));
    teardrops(b);
    const flat = FormatBoard(b).replace(/\s+/g, ' ').replace(/ \)/g, ')');
    expect(flat).toContain('(layer "F.Mask")');
    expect(flat).toContain('(attr (teardrop (type padvia)))');
    // INVISIBLE_BORDER has no token: the writer's switch falls to `default: none`.
    expect(flat).toContain('(hatch none ');
    expect(flat).not.toContain('invisible');
  });
});

describe('TEARDROP_MANAGER: the zones on the board', () => {
  it('is idempotent: a second full update replaces rather than accumulates', () => {
    const b = pcb(viaAt(10, 10), seg(10, 10, 20, 10));
    const once = teardrops(b).length;
    expect(once).toBe(1);
    expect(teardrops(b)).toHaveLength(once);
  });

  it('keeps user zones and replaces only the teardrop areas', () => {
    const b = pcb(
      viaAt(10, 10),
      seg(10, 10, 20, 10),
      `(zone (net 1) (net_name "N1") (layer "F.Cu") (uuid "${U()}") (hatch edge 0.5)
        (connect_pads (clearance 0.5)) (min_thickness 0.25)
        (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
        (polygon (pts (xy 0 0) (xy 40 0) (xy 40 40))))`,
    );
    teardrops(b);
    teardrops(b);
    expect(b.Zones().filter((z) => !z.IsTeardropArea())).toHaveLength(1);
    expect(b.Zones().filter((z) => z.IsTeardropArea())).toHaveLength(1);
  });

  it('writes the teardrop zones out, and reads them back the same', () => {
    const b = pcb(viaAt(10, 10), seg(10, 10, 20, 10));
    const ours = teardrops(b)[0]!;
    const text = FormatBoard(b);
    const flat = text.replace(/\s+/g, ' ').replace(/ \)/g, ')');
    expect(flat).toContain('(attr (teardrop (type padvia)))');
    expect(flat).toContain('(filled_polygon');
    expect(flat).toContain('(priority 30000)');

    const reread = (new PCB_IO_KICAD_SEXPR_PARSER(text, 'r.kicad_pcb').Parse() as BOARD)
      .Zones()
      .filter((z) => z.IsTeardropArea());
    expect(reread).toHaveLength(1);
    expect(reread[0]!.GetTeardropAreaType()).toBe(TEARDROP_TYPE.TD_VIAPAD);
    expect(reread[0]!.GetAssignedPriority()).toBe(30000);
    expect(reread[0]!.GetFilledPolysList(PCB_LAYER_ID.F_Cu).Outline(0).CPoints()).toEqual(
      ours.GetFilledPolysList(PCB_LAYER_ID.F_Cu).Outline(0).CPoints(),
    );
  });
});
