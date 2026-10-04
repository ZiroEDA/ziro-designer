// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The footprint autoplacer: AR_AUTOPLACER's cost matrix, its cost function and,
 * above all, the sequence it places in, on the live BOARD.
 *
 * A placer that puts every part somewhere plausible looks right and can still
 * disagree with KiCad on every board, because the layout is decided by three
 * things that a re-derivation gets wrong silently: which footprint is chosen
 * next, which of several equally-priced positions wins, and what a cell of the
 * grid costs. Each of those has its own group below, and each assertion says
 * what a divergence would look like on a real board.
 */
import { describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { BOARD_COMMIT } from '@ziroeda/pcbnew/board_commit.js';
import { ADD_MODE } from '@ziroeda/pcbnew/board_item_container.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { NETINFO_ITEM } from '@ziroeda/pcbnew/netinfo.js';
import { PAD } from '@ziroeda/pcbnew/pad.js';
import { PAD_SHAPE, PADSTACK } from '@ziroeda/pcbnew/padstack.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';
import { AR_AUTOPLACER, AR_RESULT } from '@ziroeda/pcbnew/autorouter/ar_autoplacer.js';
import {
  AR_MATRIX,
  AR_SIDE_BOTTOM,
  AR_SIDE_TOP,
  CELL_IS_MODULE,
  CELL_IS_ZONE,
  CELL_OP,
} from '@ziroeda/pcbnew/autorouter/ar_matrix.js';
import { AUTOPLACE_TOOL } from '@ziroeda/pcbnew/autorouter/autoplace_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { select, type TOOL_HARNESS, toolHarness } from './support/pcb_tool_harness.js';
import { TEST_PCB_FRAME } from './support/test_pcb_frame.js';

const MM = (n: number): number => mmToIU(n);
const P = (x: number, y: number): VECTOR2I => ({ x: MM(x), y: MM(y) });

/** AR_AUTOPLACER's private half, which these tests drive one step at a time. */
interface PLACER_INTERNALS {
  m_matrix: AR_MATRIX;
  genPlacementRoutingMatrix(): number;
  genModuleOnRoutingMatrix(aFootprint: FOOTPRINT): void;
  computePlacementRatsnestCost(aFootprint: FOOTPRINT, aOffset: VECTOR2I): number;
}

const internals = (aPlacer: AR_AUTOPLACER): PLACER_INTERNALS =>
  aPlacer as unknown as PLACER_INTERNALS;

interface PadSpec {
  number?: string;
  net?: number;
  size?: [number, number];
  shape?: PAD_SHAPE;
  angle?: number;
  layers?: PCB_LAYER_ID[];
}

interface FpSpec {
  ref: string;
  at: [number, number];
  pads?: (PadSpec & { at: [number, number] })[];
  shapes?: { from: [number, number]; to: [number, number]; layer: PCB_LAYER_ID }[];
  locked?: boolean;
}

const segment = (
  parent: BOARD | FOOTPRINT,
  from: [number, number],
  to: [number, number],
  layer: PCB_LAYER_ID,
): PCB_SHAPE => {
  const s = new PCB_SHAPE(parent, SHAPE_T.SEGMENT);
  s.SetStart(P(...from));
  s.SetEnd(P(...to));
  s.SetLayer(layer);
  s.SetWidth(0);
  return s;
};

const netOf = (b: BOARD, code: number): NETINFO_ITEM => {
  let net = b.FindNet(code);

  if (!net) {
    net = new NETINFO_ITEM(b, `N${code}`, code);
    b.Add(net);
  }

  return net;
};

/**
 * A live board: footprints placed where the spec says (pads at absolute
 * positions), a rectangular Edge.Cuts outline drawn as four segments, and any
 * extra board graphics.
 */
function board(
  fps: FpSpec[],
  edge: [number, number, number, number] | null,
  extra: { from: [number, number]; to: [number, number]; layer: PCB_LAYER_ID }[] = [],
): BOARD {
  const b = new BOARD();
  b.SetCopperLayerCount(2);

  for (const f of fps) {
    const fp = new FOOTPRINT(b);
    fp.SetPosition(P(...f.at));
    fp.SetReference(f.ref);

    for (const ps of f.pads ?? []) {
      const pad = new PAD(fp);
      pad.SetNumber(ps.number ?? '1');
      pad.SetShape(PADSTACK.ALL_LAYERS, ps.shape ?? PAD_SHAPE.RECTANGLE);
      pad.SetSize(PADSTACK.ALL_LAYERS, P(...(ps.size ?? [1, 1])));
      pad.SetLayerSet(new LSET(ps.layers ?? [PCB_LAYER_ID.F_Cu]));
      fp.Add(pad, ADD_MODE.APPEND);
      pad.SetPosition(P(...ps.at));
      if (ps.angle) pad.SetOrientation(new EDA_ANGLE(ps.angle));
      if (ps.net) pad.SetNet(netOf(b, ps.net));
    }

    for (const s of f.shapes ?? []) fp.Add(segment(fp, s.from, s.to, s.layer), ADD_MODE.APPEND);

    if (f.locked) fp.SetLocked(true);

    b.Add(fp, ADD_MODE.APPEND);
  }

  if (edge) {
    const [x0, y0, x1, y1] = edge;
    for (const [from, to] of [
      [
        [x0, y0],
        [x1, y0],
      ],
      [
        [x1, y0],
        [x1, y1],
      ],
      [
        [x1, y1],
        [x0, y1],
      ],
      [
        [x0, y1],
        [x0, y0],
      ],
    ] as [number, number][][]) {
      b.Add(segment(b, from!, to!, PCB_LAYER_ID.Edge_Cuts), ADD_MODE.APPEND);
    }
  }

  for (const s of extra) b.Add(segment(b, s.from, s.to, s.layer), ADD_MODE.APPEND);

  return b;
}

/** A two-pad part, anchored on its first pad. */
const part = (ref: string, x: number, y: number, netA: number, netB: number): FpSpec => ({
  ref,
  at: [x, y],
  pads: [
    { at: [x, y], net: netA },
    { at: [x + 2, y], number: '2', net: netB },
  ],
});

const fpOf = (b: BOARD, ref: string): FOOTPRINT =>
  b.Footprints().find((f) => f.GetReference() === ref)!;

const posOf = (b: BOARD, ref: string): { x: number; y: number } => {
  const at = fpOf(b, ref).GetPosition();
  return { x: at.x / MM(1), y: at.y / MM(1) };
};

/** `AUTOPLACE_TOOL::autoplace`'s run: the placer on a commit, pushed on completion. */
function autoplace(b: BOARD, refs: string[], aPlaceOffboard = false): AR_RESULT {
  const commit = new BOARD_COMMIT(new TEST_PCB_FRAME(b));
  const result = new AR_AUTOPLACER(b).AutoplaceFootprints(
    refs.map((r) => fpOf(b, r)),
    commit,
    aPlaceOffboard,
  );

  if (result === AR_RESULT.AR_COMPLETED) commit.Push('Autoplace Footprints');
  else commit.Revert();

  return result;
}

/** A placer with its matrix built at the 1 mm grid, as AutoplaceFootprints builds it. */
function builtPlacer(b: BOARD): { placer: AR_AUTOPLACER; m: AR_MATRIX } {
  const placer = new AR_AUTOPLACER(b);
  const inner = internals(placer);
  inner.m_matrix.m_GridRouting = MM(1);
  inner.genPlacementRoutingMatrix();
  return { placer, m: inner.m_matrix };
}

const matrix = (w: number, h: number): AR_MATRIX => {
  const m = new AR_MATRIX();
  m.m_GridRouting = MM(1);
  m.m_RoutingLayersCount = 2;
  m.ComputeMatrixSize(new BOX2I({ x: 0, y: 0 }, { x: MM(w), y: MM(h) }));
  m.InitRoutingMatrix();
  return m;
};

// ---------------------------------------------------------------------------

describe('the placement matrix', () => {
  it('snaps the board box onto the grid by truncating, not flooring', () => {
    const m = new AR_MATRIX();
    m.m_GridRouting = MM(1);
    // A board straddling the origin: -2.5 mm to 7.5 mm across.
    m.ComputeMatrixSize(new BOX2I(P(-2.5, -2.5), P(10, 10)));

    // `x - x % grid` truncates towards zero, so a negative origin moves *in*
    // to -2 mm rather than out to -3 mm. Flooring here would shift every row
    // and column of the grid by one on any board drawn at negative coordinates.
    expect(m.m_BrdBox.GetX()).toBe(MM(-2));
    expect(m.m_BrdBox.GetY()).toBe(MM(-2));

    // The end (-2.5 + 10 = 7.5, dragged to 8 by the origin move) truncates down
    // to 8 and is then pushed out by one whole grid step.
    expect(m.m_BrdBox.GetRight()).toBe(MM(9));

    // 11 mm across at 1 mm spacing is 11 columns, plus upstream's spare one.
    expect(m.m_Ncols).toBe(12);
    expect(m.m_Nrows).toBe(12);
  });

  it('accumulates keep-out cost on the bottom side and takes the maximum on the top', () => {
    const m = matrix(20, 20);
    const both = new LSET([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu]);
    m.CreateKeepOutRectangle(MM(5), MM(5), MM(10), MM(10), MM(2), 500, both);
    m.CreateKeepOutRectangle(MM(5), MM(5), MM(10), MM(10), MM(2), 500, both);

    // Upstream writes `dist + keepOut` on the bottom but `max(dist, keepOut)` on
    // the top: two footprints stacked over the same cell price it at 1000 from
    // the back and 500 from the front.
    expect(m.GetDist(7, 7, AR_SIDE_BOTTOM)).toBe(1000);
    expect(m.GetDist(7, 7, AR_SIDE_TOP)).toBe(500);
  });

  it('fades the keep-out cost off across the far margin band only', () => {
    const m = matrix(20, 20);

    // 6 mm to 12 mm square, with a 3 mm margin band: rows and columns 3 to 15.
    m.CreateKeepOutRectangle(
      MM(6),
      MM(6),
      MM(12),
      MM(12),
      MM(3),
      256,
      new LSET([PCB_LAYER_ID.B_Cu]),
    );

    // Inside, the whole keep-out. Across the far band, a share that falls
    // linearly in 1/256ths to nothing.
    expect(m.GetDist(9, 9, AR_SIDE_BOTTOM)).toBe(256);
    expect(m.GetDist(13, 9, AR_SIDE_BOTTOM)).toBe(170);
    expect(m.GetDist(14, 9, AR_SIDE_BOTTOM)).toBe(85);
    expect(m.GetDist(15, 9, AR_SIDE_BOTTOM)).toBe(0);

    // The near band does not fade: upstream's test is `row < pmarge`, the
    // absolute row index against the band width, not the distance from the
    // band's own first row.
    expect(m.GetDist(3, 9, AR_SIDE_BOTTOM)).toBe(256);
    expect(m.GetDist(9, 3, AR_SIDE_BOTTOM)).toBe(256);

    // Both axes fade together where the bands cross: 170 * 170 / 256.
    expect(m.GetDist(13, 13, AR_SIDE_BOTTOM)).toBe(112);
  });

  it('swaps a pad rectangle at 90 and 270 degrees, and -90 is stored as 270', () => {
    const trace = (angle: number): { wide: boolean; tall: boolean } => {
      const m = matrix(20, 20);
      const b = board(
        [{ ref: 'U1', at: [10, 10], pads: [{ at: [10, 10], size: [6, 1], angle }] }],
        null,
      );
      m.PlacePad(b.Footprints()[0]!.Pads()[0]!, CELL_IS_MODULE, 0, CELL_OP.WRITE_OR_CELL);
      return {
        wide: m.GetCell(10, 12, AR_SIDE_TOP) === CELL_IS_MODULE,
        tall: m.GetCell(12, 10, AR_SIDE_TOP) === CELL_IS_MODULE,
      };
    };

    expect(trace(0)).toEqual({ wide: true, tall: false });
    expect(trace(90)).toEqual({ wide: false, tall: true });
    expect(trace(270)).toEqual({ wide: false, tall: true });
    // `PAD::SetOrientation` normalises, so the raw `== ANGLE_270` sees 270.
    expect(trace(-90)).toEqual({ wide: false, tall: true });
  });

  it('traces a circular pad as a circle of half its width', () => {
    const m = matrix(20, 20);
    const b = board(
      [
        {
          ref: 'U1',
          at: [10, 10],
          pads: [{ at: [10, 10], size: [6, 6], shape: PAD_SHAPE.CIRCLE }],
        },
      ],
      null,
    );
    m.PlacePad(b.Footprints()[0]!.Pads()[0]!, CELL_IS_MODULE, 0, CELL_OP.WRITE_OR_CELL);

    // Radius 3 mm: (12, 12) is 2.8 mm out and inside, (13, 12) is 3.6 mm out.
    // A rectangle of the same size would claim both.
    expect(m.GetCell(12, 12, AR_SIDE_TOP)).toBe(CELL_IS_MODULE);
    expect(m.GetCell(13, 12, AR_SIDE_TOP)).toBe(0);
  });

  it('traces an arc along the diagonal, as upstream mis-typed it', () => {
    const m = matrix(40, 40);

    // A quarter turn of radius 10 mm centred at (20, 20), starting at (30, 20).
    (
      m as unknown as {
        traceArc(
          ...a: [number, number, number, number, number, number, PCB_LAYER_ID, number, CELL_OP]
        ): void;
      }
    ).traceArc(
      MM(20),
      MM(20),
      MM(30),
      MM(20),
      90,
      MM(0.5),
      PCB_LAYER_ID.UNDEFINED_LAYER,
      CELL_IS_MODULE,
      CELL_OP.WRITE_OR_CELL,
    );

    // `y1 = KiROUND( radius * angle.Cos() )` — Cos where every sibling uses Sin.
    // Every sample therefore lands on the line y = x offset from the centre.
    // Repairing it would give a different occupancy grid from KiCad's on any
    // board with an arc off Edge.Cuts, so it is mirrored, not fixed.
    expect(m.GetCell(25, 29, AR_SIDE_BOTTOM)).toBe(0);
    expect(m.GetCell(25, 25, AR_SIDE_BOTTOM)).toBe(CELL_IS_MODULE);
  });
});

describe('the board outline on the grid', () => {
  it('sizes the matrix from Edge.Cuts alone', () => {
    const b = board(
      [{ ref: 'U1', at: [200, 200] }],
      [0, 0, 40, 30],
      [{ from: [-50, -50], to: [90, 80], layer: PCB_LAYER_ID.F_SilkS }],
    );
    const { m } = builtPlacer(b);

    // Silkscreen is not the board edge, and neither is a footprint sitting off
    // the board: a matrix sized from either would be enormous.
    expect(m.m_BrdBox.GetX()).toBe(0);
    expect(m.m_BrdBox.GetY()).toBe(0);
    expect(m.m_Ncols).toBe(42);
    expect(m.m_Nrows).toBe(32);
  });

  it('never marks the top row of the matrix as inside the board', () => {
    const { m } = builtPlacer(board([], [0, 0, 20, 20]));

    // `fillMatrix` skips `idy <= 0`, so row 0 stays out of the board however
    // the outline is drawn.
    expect(m.GetCell(0, 5, AR_SIDE_BOTTOM) & CELL_IS_ZONE).toBe(0);
    expect(m.GetCell(1, 5, AR_SIDE_BOTTOM) & CELL_IS_ZONE).toBe(CELL_IS_ZONE);

    // Columns are not treated the same way: `idx * step >= seg_start_x`, so a
    // column sitting exactly on the edge is inside.
    expect(m.GetCell(1, 0, AR_SIDE_BOTTOM) & CELL_IS_ZONE).toBe(CELL_IS_ZONE);

    // Both sides start the same (the memcpy at the end of genPlacementRoutingMatrix).
    expect(m.GetCell(1, 5, AR_SIDE_TOP) & CELL_IS_ZONE).toBe(CELL_IS_ZONE);
  });

  it('turns every board graphic that is not Edge.Cuts into a hole', () => {
    const { m } = builtPlacer(
      board([], [0, 0, 20, 20], [{ from: [2, 10], to: [18, 10], layer: PCB_LAYER_ID.F_SilkS }]),
    );

    // Upstream tests only "is this Edge.Cuts?" before tracing a drawing as an
    // obstacle, so a silkscreen line blocks placement exactly as a slot would.
    expect(m.GetCell(10, 10, AR_SIDE_BOTTOM) & CELL_IS_ZONE).toBe(0);
    expect(m.GetCell(12, 10, AR_SIDE_BOTTOM) & CELL_IS_ZONE).toBe(CELL_IS_ZONE);
  });

  it('widens the cost halo by one grid step for every sixteen pads', () => {
    // Every pad stacked on the anchor, so the extents stay the same and only
    // the pad count changes.
    const halo = (padCount: number): number[] => {
      const pads = Array.from({ length: padCount }, (_, i) => ({
        at: [10, 10] as [number, number],
        number: String(i + 1),
        size: [0.2, 0.2] as [number, number],
      }));
      const b = board([{ ref: 'U1', at: [10, 10], pads }], [0, 0, 40, 40]);
      const { placer, m } = builtPlacer(b);
      internals(placer).genModuleOnRoutingMatrix(b.Footprints()[0]!);
      return [9, 10, 11, 12, 20].map((c) => m.GetDist(10, c, AR_SIDE_TOP));
    };

    // `margin = grid * padCount / AR_GAIN` with AR_GAIN 16.
    expect(halo(16)).toEqual([500, 500, 0, 0, 0]);
    expect(halo(32)).toEqual([500, 500, 250, 0, 0]);
  });

  it('refuses a board with no edges rather than inventing extents', () => {
    const b = board([part('R1', 5, 5, 1, 2)], null);

    // AR_FAILURE, and the tool reverts: the footprint stays where it was.
    expect(autoplace(b, ['R1'])).toBe(AR_RESULT.AR_FAILURE);
    expect(posOf(b, 'R1')).toEqual({ x: 5, y: 5 });
  });
});

describe('the ratsnest cost function', () => {
  const cost = (from: [number, number], to: [number, number]): number => {
    const b = board(
      [
        { ref: 'A', at: from, pads: [{ at: from, net: 7 }] },
        { ref: 'B', at: to, pads: [{ at: to, net: 7 }] },
      ],
      [0, 0, 100, 100],
    );
    const { placer } = builtPlacer(b);
    return internals(placer).computePlacementRatsnestCost(fpOf(b, 'A'), { x: 0, y: 0 });
  };

  it('charges a horizontal airwire its bare length', () => {
    expect(cost([10, 10], [30, 10])).toBeCloseTo(MM(20), 0);
    expect(cost([10, 10], [10, 30])).toBeCloseTo(MM(20), 0);
  });

  it('penalises a diagonal airwire by doubling its shorter axis', () => {
    // 20 across and 20 down is `hypot(20, 40)`: the penalty peaks at 45 degrees.
    expect(cost([10, 10], [30, 30])).toBeCloseTo(MM(Math.hypot(20, 40)), 0);
  });

  it('doubles the shorter axis and not the longer one', () => {
    const shallow = cost([10, 10], [50, 20]); // dx 40, dy 10
    const steep = cost([10, 10], [20, 50]); // dx 10, dy 40
    expect(shallow).toBeCloseTo(steep, 0);
    expect(shallow).toBeCloseTo(MM(Math.hypot(40, 20)), 0);
  });

  it('measures from where the offset puts the pad', () => {
    const b = board(
      [
        { ref: 'A', at: [10, 10], pads: [{ at: [10, 10], net: 7 }] },
        { ref: 'B', at: [30, 10], pads: [{ at: [30, 10], net: 7 }] },
      ],
      [0, 0, 100, 100],
    );
    const { placer } = builtPlacer(b);

    // An offset of -5 mm in x moves A's pad to 15 mm: 15 mm of airwire.
    expect(internals(placer).computePlacementRatsnestCost(fpOf(b, 'A'), P(-5, 0))).toBeCloseTo(
      MM(15),
      0,
    );
  });

  it('charges every pad separately, even when they share a target', () => {
    const b = board(
      [
        {
          ref: 'A',
          at: [10, 10],
          pads: [
            { at: [10, 10], net: 7 },
            { at: [20, 10], number: '2', net: 7 },
          ],
        },
        { ref: 'T', at: [50, 10], pads: [{ at: [50, 10], net: 7 }] },
      ],
      [0, 0, 100, 100],
    );
    const { placer } = builtPlacer(b);

    // `nearestPad` is per pad, not a spanning tree: both pads pay to reach the
    // one pad on the other part (40 mm + 30 mm).
    expect(
      internals(placer).computePlacementRatsnestCost(fpOf(b, 'A'), { x: 0, y: 0 }),
    ).toBeCloseTo(MM(70), 0);
  });

  it('ignores pads with no net, pads on the footprint being placed, and off-board footprints', () => {
    const b = board(
      [
        {
          ref: 'A',
          at: [10, 10],
          pads: [
            { at: [10, 10] },
            { at: [12, 10], number: '2', net: 7 },
            { at: [14, 10], number: '3', net: 8 },
          ],
        },
        {
          ref: 'B',
          at: [40, 10],
          pads: [{ at: [40, 10] }, { at: [42, 10], number: '2', net: 7 }],
        },
        // Net 8's only partner is outside the matrix box: `nearestPad` skips it.
        { ref: 'C', at: [300, 10], pads: [{ at: [300, 10], net: 8 }] },
      ],
      [0, 0, 100, 100],
    );
    const { placer } = builtPlacer(b);

    // Only the net-7 pair contributes: 30 mm.
    expect(
      internals(placer).computePlacementRatsnestCost(fpOf(b, 'A'), { x: 0, y: 0 }),
    ).toBeCloseTo(MM(30), 0);
  });
});

describe('choosing which footprint to place next', () => {
  const pick = (fps: FpSpec[], needs: string[]): string | null => {
    const b = board(fps, [0, 0, 100, 100]);
    const { placer } = builtPlacer(b);
    for (const fp of b.Footprints()) fp.SetNeedsPlaced(needs.includes(fp.GetReference()));
    return placer.pickFootprint()?.GetReference() ?? null;
  };

  const sized = (ref: string, x: number, y: number, w: number, net: number): FpSpec => ({
    ref,
    at: [x, y],
    pads: [{ at: [x, y], net, size: [w, 1] }],
  });

  it('takes the largest connected footprint first', () => {
    const small = sized('R1', 10, 10, 1, 5);
    const large = sized('U1', 40, 10, 20, 5);

    // Both have one ratsnest edge, so the tie falls back to area.
    expect(pick([small, large], ['R1', 'U1'])).toBe('U1');
    expect(pick([large, small], ['R1', 'U1'])).toBe('U1');
  });

  it('ranks by area times pad count when the ratsnest ranking ties', () => {
    // GetArea is the text-excluded box, seeded at the anchor and inflated by
    // 0.25 mm: U1 is 4 x 4 mm (16 mm², one airwire) and J1 is 4 x 2 mm
    // (8 mm², two airwires). area x ratsnest ties at 16, so the first sort
    // decides — area x pad count, where J1 wins 32 to 16.
    const big: FpSpec = { ref: 'U1', at: [10, 10], pads: [{ at: [10, 10], net: 1, size: [4, 4] }] };
    const many: FpSpec = {
      ref: 'J1',
      at: [31.5, 10],
      pads: [
        { at: [30, 10], number: '1', net: 1, size: [1, 2] },
        { at: [31, 10], number: '2', net: 2, size: [1, 2] },
        { at: [32, 10], number: '3', size: [1, 2] },
        { at: [33, 10], number: '4', size: [1, 2] },
      ],
    };
    const far: FpSpec = { ref: 'R9', at: [60, 10], pads: [{ at: [60, 10], net: 2 }] };

    expect(pick([big, many, far], ['U1', 'J1'])).toBe('J1');
  });

  it('ranks by area times ratsnest, not ratsnest count alone', () => {
    // 16 mm² with one airwire beats about 4 mm² with two.
    const big: FpSpec = { ref: 'U1', at: [10, 10], pads: [{ at: [10, 10], net: 1, size: [4, 4] }] };
    const busy: FpSpec = {
      ref: 'J1',
      at: [30, 10],
      pads: [
        { at: [30, 10], number: '1', net: 2 },
        { at: [31, 11], number: '2', net: 3 },
      ],
    };
    const partners: FpSpec[] = [
      { ref: 'R1', at: [60, 10], pads: [{ at: [60, 10], net: 1 }] },
      { ref: 'R2', at: [70, 10], pads: [{ at: [70, 10], net: 2 }] },
      { ref: 'R3', at: [80, 10], pads: [{ at: [80, 10], net: 3 }] },
    ];

    expect(pick([big, busy, ...partners], ['U1', 'J1'])).toBe('U1');
  });

  it('skips a footprint with no ratsnest in favour of a smaller one that has some', () => {
    const bigLoner: FpSpec = { ref: 'M1', at: [10, 10], pads: [{ at: [10, 10], size: [30, 30] }] };

    // A mounting hole is the biggest thing on many boards and has nowhere it
    // needs to be.
    expect(
      pick([bigLoner, sized('R1', 50, 10, 1, 5), sized('R2', 60, 10, 1, 5)], ['M1', 'R1', 'R2']),
    ).not.toBe('M1');
  });

  it('falls back to the last footprint scanned when nothing has a ratsnest', () => {
    const big = sized('U1', 10, 10, 20, 0);
    const small = sized('R1', 50, 10, 1, 0);

    // With every flag zero `altFootprint` holds the *last* one seen in the
    // complexity order — the least complex.
    expect(pick([big, small], ['U1', 'R1'])).toBe('R1');
    expect(pick([small, big], ['U1', 'R1'])).toBe('R1');
  });

  it('counts an airwire internal to a footprint, despite being asked to skip it', () => {
    const selfConnected: FpSpec = {
      ref: 'J1',
      at: [10, 10],
      pads: [
        { at: [10, 10], net: 5 },
        { at: [20, 10], number: '2', net: 5 },
      ],
    };
    const loner: FpSpec = { ref: 'M1', at: [60, 10], pads: [{ at: [60, 10], size: [30, 30] }] };

    // `GetRatsnestForComponent( fp, true )` skips nothing: an edge with both
    // ends on the component is picked up by the `else if( srcFound || dstFound )`.
    expect(pick([selfConnected, loner], ['J1', 'M1'])).toBe('J1');
  });

  it('ignores footprints that are not waiting to be placed', () => {
    const fixed = sized('U1', 10, 10, 20, 5);
    const wanted = sized('R1', 50, 10, 1, 5);

    expect(pick([fixed, wanted], ['R1'])).toBe('R1');
    expect(pick([fixed, wanted], [])).toBeNull();
  });

  it('does not let tracks shorten the ratsnest it ranks by', () => {
    const b = board([sized('R1', 10, 10, 20, 5), sized('R2', 50, 10, 1, 5)], [0, 0, 100, 100]);
    const track = new PCB_TRACK(b);
    track.SetStart(P(10, 10));
    track.SetEnd(P(50, 10));
    track.SetWidth(MM(0.25));
    track.SetLayer(PCB_LAYER_ID.F_Cu);
    track.SetNet(netOf(b, 5));
    b.Add(track, ADD_MODE.APPEND);

    const { placer } = builtPlacer(b);
    for (const fp of b.Footprints()) fp.SetNeedsPlaced(true);

    // AR_AUTOPLACER builds its own CONNECTIVITY_DATA from footprints only, so
    // the wire between R1 and R2 is invisible to it and the larger R1 goes first.
    expect(placer.pickFootprint()?.GetReference()).toBe('R1');
  });
});

describe('choosing where to put it', () => {
  it('breaks a tie towards the far corner, not the near one', () => {
    const b = board([part('R1', 50, 50, 0, 0)], [0, 0, 20, 20]);
    expect(autoplace(b, ['R1'])).toBe(AR_RESULT.AR_COMPLETED);

    // With nothing else on the board every position costs the same, and
    // upstream accepts a new best on `min_cost >= Score`, so the last position
    // swept wins. The box is 49.5..52.5 x 49.5..50.5 about an anchor at
    // (50, 50); the sweep ends at x = 20 - 2.5 - 1 = 16.5 -> 17 on the 1 mm
    // lattice that starts at 1, and y likewise at 18.
    expect(posOf(b, 'R1')).toEqual({ x: 17, y: 18 });
  });

  it('pulls a connected part towards the part it connects to', () => {
    const b = board(
      [
        { ref: 'U1', at: [5, 5], pads: [{ at: [5, 5], net: 9 }] },
        { ref: 'R1', at: [50, 50], pads: [{ at: [50, 50], net: 9 }] },
      ],
      [0, 0, 40, 40],
    );
    autoplace(b, ['R1']);

    const p = posOf(b, 'R1');
    expect(p.x).toBeLessThan(15);
    expect(p.y).toBeLessThan(15);
    // U1 is not in the placement set: it stays put.
    expect(posOf(b, 'U1')).toEqual({ x: 5, y: 5 });
  });

  it('moves the footprint whole: pads travel with the anchor', () => {
    const b = board([part('R1', 50, 50, 0, 0)], [0, 0, 20, 20]);
    autoplace(b, ['R1']);

    const fp = fpOf(b, 'R1');
    const at = fp.GetPosition();
    expect(
      fp.Pads().map((p) => ({ x: p.GetPosition().x - at.x, y: p.GetPosition().y - at.y })),
    ).toEqual([
      { x: 0, y: 0 },
      { x: MM(2), y: 0 },
    ]);
  });

  it('keeps a placed footprint out of the cells another one already claimed', () => {
    const b = board([part('R1', 50, 50, 1, 2), part('R2', 55, 50, 1, 2)], [0, 0, 20, 20]);
    autoplace(b, ['R1', 'R2']);

    const p1 = posOf(b, 'R1');
    const p2 = posOf(b, 'R2');

    // Each placement is written into the matrix as CELL_IS_MODULE before the
    // next one is scored, so two parts cannot land on the same cells.
    expect(Math.abs(p1.x - p2.x) >= 3 || Math.abs(p1.y - p2.y) >= 1).toBe(true);
  });

  it('does not block a footprint out of the position it is already in', () => {
    const b = board(
      [
        { ref: 'U1', at: [4, 4], pads: [{ at: [4, 4], net: 9 }] },
        // (7, 4) is where the placer puts R1 from anywhere else on this board.
        { ref: 'R1', at: [7, 4], pads: [{ at: [7, 4], net: 9 }] },
      ],
      [0, 0, 20, 20],
    );
    autoplace(b, ['R1']);

    // Only the footprints that are *not* being placed are burned into the
    // matrix up front.
    expect(posOf(b, 'R1')).toEqual({ x: 7, y: 4 });
  });

  it('parks a footprint too big for the board at the matrix origin', () => {
    const b = board(
      [{ ref: 'X1', at: [5, 5], pads: [{ at: [5, 5], size: [60, 60] }] }],
      [0, 0, 20, 20],
    );

    // `getOptimalFPPlacement` returns 1 with `lastPosOK` still at the box
    // origin, and upstream places the footprint there anyway: the
    // AR_ABORT_PLACEMENT branch can never fire.
    expect(autoplace(b, ['X1'])).toBe(AR_RESULT.AR_COMPLETED);
    expect(posOf(b, 'X1')).toEqual({ x: 0, y: 0 });
    expect(fpOf(b, 'X1').IsPlaced()).toBe(true);
  });
});

describe('the placement run', () => {
  it('leaves footprints outside the placement set alone by default', () => {
    const b = board([part('U1', 8, 8, 1, 2), part('R1', 50, 50, 1, 2)], [0, 0, 30, 30]);
    autoplace(b, ['R1']);

    expect(posOf(b, 'U1')).toEqual({ x: 8, y: 8 });
    expect(fpOf(b, 'U1').IsPlaced()).toBe(false);
    expect(fpOf(b, 'R1').IsPlaced()).toBe(true);
  });

  it('adds the off-board footprints when asked to', () => {
    const b = board([part('U1', 80, 80, 1, 2), part('R1', 10, 10, 1, 2)], [0, 0, 30, 30]);
    autoplace(b, [], true);

    // R1 is inside the box and stays where it is; U1 is a stray and is placed.
    expect(posOf(b, 'R1')).toEqual({ x: 10, y: 10 });
    expect(posOf(b, 'U1')).not.toEqual({ x: 80, y: 80 });
  });

  it('places every requested footprint exactly once and clears the flag', () => {
    const b = board(
      [part('R1', 50, 50, 1, 2), part('R2', 55, 50, 1, 3), part('R3', 60, 50, 2, 3)],
      [0, 0, 30, 30],
    );
    autoplace(b, ['R1', 'R2', 'R3']);

    for (const fp of b.Footprints()) {
      expect(fp.IsPlaced()).toBe(true);
      expect(fp.NeedsPlaced()).toBe(false);
      const at = fp.GetPosition();
      expect(at.x).toBeLessThanOrEqual(MM(30));
      expect(at.y).toBeLessThanOrEqual(MM(30));
    }
  });

  it('is one undoable commit', () => {
    const b = board([part('R1', 50, 50, 0, 0)], [0, 0, 20, 20]);
    const frame = new TEST_PCB_FRAME(b);
    const commit = new BOARD_COMMIT(frame);
    new AR_AUTOPLACER(b).AutoplaceFootprints([fpOf(b, 'R1')], commit, false);
    commit.Revert();

    // `aCommit->Modify( footprint )` before it moves, so Revert puts it back.
    expect(posOf(b, 'R1')).toEqual({ x: 50, y: 50 });
  });
});

describe('how a footprint is measured (FOOTPRINT::GetBoundingBox( false ))', () => {
  const box = (spec: FpSpec): BOX2I => board([spec], null).Footprints()[0]!.GetBoundingBox(false);

  it('measures the anchor even when the footprint has no geometry near it', () => {
    // Seeded at the anchor and inflated by 0.25 mm before anything is merged:
    // the sweep positions the *anchor*, so dropping the seed would let it leave the board.
    const b = box({ ref: 'U1', at: [10, 10], pads: [{ at: [30, 10] }] });
    expect(b.GetX()).toBe(MM(9.75));
    expect(b.GetRight()).toBe(MM(30.5));
  });

  it('excludes annotation layers from a sided footprint, but not silkscreen', () => {
    const withNote = box({
      ref: 'U1',
      at: [10, 10],
      pads: [{ at: [10, 10] }],
      shapes: [{ from: [0, 0], to: [40, 40], layer: PCB_LAYER_ID.Cmts_User }],
    });
    const withSilk = box({
      ref: 'U1',
      at: [10, 10],
      pads: [{ at: [10, 10] }],
      shapes: [{ from: [0, 0], to: [40, 40], layer: PCB_LAYER_ID.F_SilkS }],
    });

    expect([withNote.GetX(), withNote.GetY(), withNote.GetWidth(), withNote.GetHeight()]).toEqual([
      MM(9.5),
      MM(9.5),
      MM(1),
      MM(1),
    ]);
    expect(withSilk.GetWidth()).toBeGreaterThanOrEqual(MM(40));
  });

  it('measures the fields only when the footprint has nothing else', () => {
    const named = (pads: FpSpec['pads']): number => {
      const b = board([{ ref: 'Conn_01x08_Pin_Header', at: [10, 10], pads }], null);
      return b.Footprints()[0]!.GetBoundingBox(false).GetWidth();
    };

    // `noDrawItems`: a footprint of nothing but its fields is measured by them.
    expect(named([])).toBeGreaterThan(MM(5));
    // With a pad, the reference is text and the text-excluded box ignores it.
    expect(named([{ at: [10, 10] }])).toBe(MM(1));
  });

  it('ranks by GetArea, the text-excluded box', () => {
    const b = board([{ ref: 'U1', at: [10, 10], pads: [{ at: [10, 10], size: [10, 10] }] }], null);
    expect(b.Footprints()[0]!.GetArea()).toBe(MM(10) * MM(10));
  });
});

// ---- AUTOPLACE_TOOL ---------------------------------------------------------

const TOOL_BOARD = (edges: boolean): string => `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (footprint "L:R" (layer "F.Cu") (at 50 50) (uuid "00000000-0000-4000-8000-000000000011")
    (property "Reference" "R1" (at 0 -2 0) (layer "F.Cu") (uuid "00000000-0000-4000-8000-000000000012"))
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (uuid "00000000-0000-4000-8000-000000000013")))
  (footprint "L:R" (locked yes) (layer "F.Cu") (at 60 50) (uuid "00000000-0000-4000-8000-000000000021")
    (property "Reference" "R2" (at 0 -2 0) (layer "F.Cu") (uuid "00000000-0000-4000-8000-000000000022"))
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (uuid "00000000-0000-4000-8000-000000000023")))
  (footprint "L:R" (layer "F.Cu") (at 10 10) (uuid "00000000-0000-4000-8000-000000000031")
    (property "Reference" "R3" (at 0 -2 0) (layer "F.Cu") (uuid "00000000-0000-4000-8000-000000000032"))
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (uuid "00000000-0000-4000-8000-000000000033")))
  ${
    edges
      ? `(gr_rect (start 0 0) (end 20 20) (stroke (width 0.1) (type solid)) (fill no) (layer "Edge.Cuts") (uuid "00000000-0000-4000-8000-000000000041"))`
      : ''
  }
  (gr_line (start 30 30) (end 35 30) (stroke (width 0.1) (type solid)) (layer "F.Cu") (uuid "00000000-0000-4000-8000-000000000051"))
)
`;

class AUTOPLACE_FRAME extends TEST_PCB_FRAME {
  infoBarErrors: string[] = [];

  override ShowInfoBarError(aErrorMsg: string): void {
    this.infoBarErrors.push(aErrorMsg);
  }
}

describe('AUTOPLACE_TOOL', () => {
  const harness = (edges: boolean): TOOL_HARNESS<AUTOPLACE_FRAME> =>
    toolHarness(
      TOOL_BOARD(edges),
      (b) => new AUTOPLACE_FRAME(b),
      () => [new AUTOPLACE_TOOL()],
    );

  it('places the selected footprints on one undoable commit', () => {
    const h = harness(true);
    select(h, 11);
    h.mgr.RunAction(PCB_ACTIONS.autoplaceSelectedComponents);

    expect(posOf(h.board, 'R1')).not.toEqual({ x: 50, y: 50 });
    // R3 was not selected and is on the board: it stays.
    expect(posOf(h.board, 'R3')).toEqual({ x: 10, y: 10 });

    expect(h.frame.GetUndoCommandCount()).toBe(1);
    h.frame.RestoreCopyFromUndoList();
    expect(posOf(h.board, 'R1')).toEqual({ x: 50, y: 50 });
  });

  it('drops locked footprints unless locks are overridden', () => {
    const h = harness(true);
    select(h, 11, 21);
    h.mgr.RunAction(PCB_ACTIONS.autoplaceSelectedComponents);

    expect(posOf(h.board, 'R2')).toEqual({ x: 60, y: 50 });
    expect(posOf(h.board, 'R1')).not.toEqual({ x: 50, y: 50 });
  });

  it('places a locked footprint when locks are overridden', () => {
    const h = harness(true);
    h.frame.m_overrideLocksCb = { GetValue: () => true };
    select(h, 21);
    h.mgr.RunAction(PCB_ACTIONS.autoplaceSelectedComponents);

    expect(posOf(h.board, 'R2')).not.toEqual({ x: 60, y: 50 });
  });

  it('ignores selected items that are not footprints', () => {
    const h = harness(true);
    select(h, 51);
    h.mgr.RunAction(PCB_ACTIONS.autoplaceSelectedComponents);

    // Nothing to place: the run completes with an empty commit and no footprint moves.
    expect(posOf(h.board, 'R1')).toEqual({ x: 50, y: 50 });
    expect(posOf(h.board, 'R3')).toEqual({ x: 10, y: 10 });
    expect(h.frame.infoBarErrors).toEqual([]);
  });

  it('places what is outside the board outline with Place Off-Board Footprints', () => {
    const h = harness(true);
    h.mgr.RunAction(PCB_ACTIONS.autoplaceOffboardComponents);

    // R1 is off the outline and unlocked; R2 is off it but locked; R3 is inside.
    expect(posOf(h.board, 'R1')).not.toEqual({ x: 50, y: 50 });
    expect(posOf(h.board, 'R2')).toEqual({ x: 60, y: 50 });
    expect(posOf(h.board, 'R3')).toEqual({ x: 10, y: 10 });
  });

  it('says why when the board has no edges, and moves nothing', () => {
    const h = harness(false);
    select(h, 11);
    h.mgr.RunAction(PCB_ACTIONS.autoplaceSelectedComponents);

    expect(h.frame.infoBarErrors).toEqual(['Board edges must be defined on the Edge.Cuts layer.']);
    expect(posOf(h.board, 'R1')).toEqual({ x: 50, y: 50 });
    expect(h.frame.GetUndoCommandCount()).toBe(0);
  });
});
