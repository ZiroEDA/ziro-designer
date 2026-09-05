// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The footprint autoplacer: AR_AUTOPLACER's cost matrix, its cost function and,
 * above all, the sequence it places in.
 *
 * A placer that puts every part somewhere plausible looks right and can still
 * disagree with KiCad on every board, because the layout is decided by three
 * things that a re-derivation gets wrong silently: which footprint is chosen
 * next, which of several equally-priced positions wins, and what a cell of the
 * grid costs. Each of those has its own group below, and each assertion says
 * what a divergence would look like on a real board.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  Autoplacer,
  autoplaceFootprints,
  boardEdgesBoundingBox,
  boardOutlineRings,
  footprintArea,
  footprintExtent,
} from '@ziroeda/pcbnew/src/autoplace_footprints.js';
import {
  AR_SIDE_BOTTOM,
  AR_SIDE_TOP,
  ArMatrix,
  CELL_IS_MODULE,
  CELL_IS_ZONE,
} from '@ziroeda/pcbnew/src/autoplace_matrix.js';
import type { Board, PcbFootprint, PcbPad, PcbShape } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const line = (x0: number, y0: number, x1: number, y1: number, layer = 'Edge.Cuts'): PcbShape => ({
  kind: 'line',
  start: { x: MM(x0), y: MM(y0) },
  end: { x: MM(x1), y: MM(y1) },
  width: 0,
  fill: false,
  layer,
  source: EMPTY,
});

/** A rectangular board outline drawn as four separate Edge.Cuts segments. */
const outline = (x0: number, y0: number, x1: number, y1: number): PcbShape[] => [
  line(x0, y0, x1, y0),
  line(x1, y0, x1, y1),
  line(x1, y1, x0, y1),
  line(x0, y1, x0, y0),
];

const pad = (x: number, y: number, over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at: { x: MM(x), y: MM(y) },
  angle: 0,
  size: { x: MM(1), y: MM(1) },
  layers: ['F.Cu'],
  net: 0,
  source: EMPTY,
  ...over,
});

const footprint = (over: Partial<PcbFootprint> = {}): PcbFootprint => ({
  lib: 'L:F',
  reference: 'U1',
  at: { x: MM(5), y: MM(5) },
  angle: 0,
  layer: 'F.Cu',
  pads: [],
  shapes: [],
  texts: [],
  points: [],
  barcodes: [],
  models: [],
  source: EMPTY,
  ...over,
});

const board = (footprints: PcbFootprint[], shapes: PcbShape[] = []): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([[0, '']]),
  footprints,
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes,
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  barcodes: [],
  groups: [],
  source: EMPTY,
});

/** No design rules to consult: every test states its own clearances in geometry. */
const NO_CLEARANCE = { padClearance: (): number => 0 };

/** A two-pad part `w` millimetres wide, anchored on its first pad. */
const part = (ref: string, x: number, y: number, netA: number, netB: number): PcbFootprint =>
  footprint({
    reference: ref,
    at: { x: MM(x), y: MM(y) },
    pads: [pad(x, y, { net: netA }), pad(x + 2, y, { number: '2', net: netB })],
  });

const posOf = (b: Board, ref: string): { x: number; y: number } => {
  const fp = b.footprints.find((f) => f.reference === ref)!;
  return { x: fp.at.x / MM(1), y: fp.at.y / MM(1) };
};

// ---------------------------------------------------------------------------

describe('the placement matrix', () => {
  it('snaps the board box onto the grid by truncating, not flooring', () => {
    const m = new ArMatrix();
    m.gridRouting = MM(1);
    // A board straddling the origin: -2.5 mm to 7.5 mm across.
    m.computeMatrixSize({ x: MM(-2.5), y: MM(-2.5), w: MM(10), h: MM(10) });

    // `x - x % grid` truncates towards zero, so a negative origin moves *in*
    // to -2 mm rather than out to -3 mm. Flooring here would shift every row
    // and column of the grid by one on any board drawn at negative coordinates,
    // which is most boards imported from another tool.
    expect(m.brdBox.x).toBe(MM(-2));
    expect(m.brdBox.y).toBe(MM(-2));

    // The end (-2.5 + 10 = 7.5, dragged to 8 by the origin move) truncates down
    // to 8 and is then pushed out by one whole grid step.
    expect(m.brdBox.x + m.brdBox.w).toBe(MM(9));

    // 11 mm across at 1 mm spacing is 11 columns, plus upstream's spare one.
    expect(m.ncols).toBe(12);
    expect(m.nrows).toBe(12);
  });

  it('accumulates keep-out cost on the bottom side and takes the maximum on the top', () => {
    const m = new ArMatrix();
    m.gridRouting = MM(1);
    m.routingLayersCount = 2;
    m.computeMatrixSize({ x: 0, y: 0, w: MM(20), h: MM(20) });
    m.initRoutingMatrix();

    const both = ['F.Cu', 'B.Cu'];
    m.createKeepOutRectangle(MM(5), MM(5), MM(10), MM(10), MM(2), 500, both);
    m.createKeepOutRectangle(MM(5), MM(5), MM(10), MM(10), MM(2), 500, both);

    // Upstream writes `dist + keepOut` on the bottom but `max(dist, keepOut)` on
    // the top. Two footprints stacked over the same cell therefore price it at
    // 1000 from the back and 500 from the front, and a part on the back of a
    // crowded board is pushed away harder than the same part on the front.
    expect(m.getDist(7, 7, AR_SIDE_BOTTOM)).toBe(1000);
    expect(m.getDist(7, 7, AR_SIDE_TOP)).toBe(500);
  });

  it('fades the keep-out cost off across the far margin band only', () => {
    const m = new ArMatrix();
    m.gridRouting = MM(1);
    m.routingLayersCount = 2;
    m.computeMatrixSize({ x: 0, y: 0, w: MM(20), h: MM(20) });
    m.initRoutingMatrix();

    // 6 mm to 12 mm square, with a 3 mm margin band: rows and columns 3 to 15.
    m.createKeepOutRectangle(MM(6), MM(6), MM(12), MM(12), MM(3), 256, ['B.Cu']);

    // Inside, the whole keep-out. Across the far band, a share that falls
    // linearly in 1/256ths to nothing — that gradient is what makes the placer
    // prefer the near edge of a crowded area over its middle.
    expect(m.getDist(9, 9, AR_SIDE_BOTTOM)).toBe(256);
    expect(m.getDist(13, 9, AR_SIDE_BOTTOM)).toBe(170);
    expect(m.getDist(14, 9, AR_SIDE_BOTTOM)).toBe(85);
    expect(m.getDist(15, 9, AR_SIDE_BOTTOM)).toBe(0);

    // The near band does not fade. Upstream's test is `row < pmarge` — the
    // absolute row index against the band width, not the distance from the
    // band's own first row — so a rectangle more than `marge` from the matrix
    // origin has a hard edge on its top and left and a gradient on its bottom
    // and right. The cost surface a footprint sees is lopsided, and a placer
    // that measured the fade from `rowMin` would pull parts the other way.
    expect(m.getDist(3, 9, AR_SIDE_BOTTOM)).toBe(256);
    expect(m.getDist(9, 3, AR_SIDE_BOTTOM)).toBe(256);

    // Both axes fade together where the bands cross: 170 * 170 / 256.
    expect(m.getDist(13, 13, AR_SIDE_BOTTOM)).toBe(112);
  });

  it('swaps a pad rectangle at 270 degrees but not at -90', () => {
    const trace = (angle: number): { wide: boolean; tall: boolean } => {
      const m = new ArMatrix();
      m.gridRouting = MM(1);
      m.routingLayersCount = 2;
      m.computeMatrixSize({ x: 0, y: 0, w: MM(20), h: MM(20) });
      m.initRoutingMatrix();
      m.placePad(
        pad(10, 10, { shape: 'rect', size: { x: MM(6), y: MM(1) }, angle, layers: ['F.Cu'] }),
        CELL_IS_MODULE,
        0,
        'or',
      );
      return {
        wide: m.getCell(10, 12, AR_SIDE_TOP) === CELL_IS_MODULE,
        tall: m.getCell(12, 10, AR_SIDE_TOP) === CELL_IS_MODULE,
      };
    };

    // 270 and -90 are the same direction, but upstream compares the raw stored
    // angle against ANGLE_270 with an exact `==`. A pad written as -90 takes the
    // cardinal branch and skips the axis swap, so its footprint is blocked out
    // the wrong way round on the grid. Both halves are pinned: correcting the
    // comparison would break the second, dropping the swap the first.
    expect(trace(270)).toEqual({ wide: false, tall: true });
    expect(trace(-90)).toEqual({ wide: true, tall: false });
  });

  it('traces an arc along the diagonal, as upstream mis-typed it', () => {
    const m = new ArMatrix();
    m.gridRouting = MM(1);
    m.routingLayersCount = 2;
    m.computeMatrixSize({ x: 0, y: 0, w: MM(40), h: MM(40) });
    m.initRoutingMatrix();

    // A quarter turn of radius 10 mm centred at (20, 20), starting at (30, 20).
    m.traceArc(MM(20), MM(20), MM(30), MM(20), 90, MM(0.5), null, CELL_IS_MODULE, 'or');

    // `y1 = KiROUND( radius * angle.Cos() )` — Cos where every sibling uses Sin.
    // Every sample therefore lands on the line y = x offset from the centre, so
    // the cells marked run diagonally away from the centre instead of round the
    // sweep. Repairing it would give a different occupancy grid from KiCad's on
    // any board with an arc off Edge.Cuts, so it is mirrored, not fixed.
    // (25, 29) is 30 degrees round the true sweep, well inside the traced
    // width; (25, 25) is nowhere near the arc but sits on the line y = x
    // through the centre.
    expect(m.getCell(25, 29, AR_SIDE_BOTTOM)).toBe(0);
    expect(m.getCell(25, 25, AR_SIDE_BOTTOM)).toBe(CELL_IS_MODULE);
  });
});

describe('the board outline on the grid', () => {
  it('measures the board from Edge.Cuts alone and chains it into a ring', () => {
    const b = board(
      [footprint({ at: { x: MM(200), y: MM(200) } })],
      [...outline(0, 0, 40, 30), line(-50, -50, 90, 80, 'F.SilkS')],
    );

    // Silkscreen is not the board edge, and neither is a footprint sitting
    // off the board: a matrix sized from either would be enormous and the
    // sweep would spend its time on positions no board exists at.
    expect(boardEdgesBoundingBox(b)).toEqual({ x: 0, y: 0, w: MM(40), h: MM(30) });
    expect(boardOutlineRings(b)).toHaveLength(1);
    expect(boardOutlineRings(b)[0]).toHaveLength(4);
  });

  it('never marks the top row of the matrix as inside the board', () => {
    const placer = new Autoplacer(board([], outline(0, 0, 20, 20)), NO_CLEARANCE);
    placer.matrix.gridRouting = MM(1);
    placer.genPlacementRoutingMatrix();

    // `fillMatrix` skips `idy <= 0`, so row 0 stays out of the board however
    // the outline is drawn. Without it a footprint could be placed one whole
    // grid step higher than KiCad ever places one.
    expect(placer.matrix.getCell(0, 5, AR_SIDE_BOTTOM) & CELL_IS_ZONE).toBe(0);
    expect(placer.matrix.getCell(1, 5, AR_SIDE_BOTTOM) & CELL_IS_ZONE).toBe(CELL_IS_ZONE);

    // Columns are not treated the same way: the scanline fills from the first
    // grid column at or after the left crossing, `idx * step >= seg_start_x`,
    // so a column sitting exactly on the edge is inside. Making that test
    // strict would lose the leftmost column of every board drawn on the grid,
    // and with it every position whose footprint reaches the left edge.
    expect(placer.matrix.getCell(1, 0, AR_SIDE_BOTTOM) & CELL_IS_ZONE).toBe(CELL_IS_ZONE);
  });

  it('turns every board graphic that is not Edge.Cuts into a hole', () => {
    const placer = new Autoplacer(
      board([], [...outline(0, 0, 20, 20), line(2, 10, 18, 10, 'F.SilkS')]),
      NO_CLEARANCE,
    );
    placer.matrix.gridRouting = MM(1);
    placer.genPlacementRoutingMatrix();

    // Upstream tests only "is this Edge.Cuts?" before tracing a drawing as an
    // obstacle, so a silkscreen line blocks placement exactly as a slot would.
    // Filtering to real obstacles here would let parts sit where KiCad refuses.
    expect(placer.matrix.getCell(10, 10, AR_SIDE_BOTTOM) & CELL_IS_ZONE).toBe(0);
    expect(placer.matrix.getCell(12, 10, AR_SIDE_BOTTOM) & CELL_IS_ZONE).toBe(CELL_IS_ZONE);
  });

  it('widens the cost halo by one grid step for every sixteen pads', () => {
    // Every pad stacked on the anchor, so the extents stay the same and only
    // the pad count changes.
    const halo = (padCount: number): number[] => {
      const pads = Array.from({ length: padCount }, (_, i) =>
        pad(10, 10, { number: String(i + 1), size: { x: MM(0.2), y: MM(0.2) } }),
      );
      const placer = new Autoplacer(
        board([footprint({ at: { x: MM(10), y: MM(10) }, pads })], outline(0, 0, 40, 40)),
        NO_CLEARANCE,
      );
      placer.matrix.gridRouting = MM(1);
      placer.genPlacementRoutingMatrix();
      placer.genModuleOnRoutingMatrix(0);
      return [9, 10, 11, 12, 20].map((c) => placer.matrix.getDist(10, c, AR_SIDE_TOP));
    };

    // `margin = grid * padCount / AR_GAIN` with AR_GAIN 16: sixteen pads buy a
    // one-millimetre band, thirty-two buy two. Drop the divisor and a 32-pad
    // connector poisons the cost of every cell within 32 mm of itself, which on
    // a small board is the whole thing — the placer would then have no gradient
    // left to work with and would fall back on the tie rule everywhere.
    expect(halo(16)).toEqual([500, 500, 0, 0, 0]);
    expect(halo(32)).toEqual([500, 500, 250, 0, 0]);
  });

  it('refuses a board with no edges rather than inventing extents', () => {
    const b = board([part('R1', 5, 5, 1, 2)]);
    const result = autoplaceFootprints(b, [0], NO_CLEARANCE);

    // AR_FAILURE. The board comes back untouched, which is what the tool's
    // commit path relies on to leave the user's positions alone.
    expect(result.status).toBe('failure');
    expect(result.order).toEqual([]);
    expect(result.board).toBe(b);
  });
});

describe('the ratsnest cost function', () => {
  const cost = (from: [number, number], to: [number, number]): number => {
    const a = footprint({
      reference: 'A',
      at: { x: MM(from[0]), y: MM(from[1]) },
      pads: [pad(from[0], from[1], { net: 7 })],
    });
    const b = footprint({
      reference: 'B',
      at: { x: MM(to[0]), y: MM(to[1]) },
      pads: [pad(to[0], to[1], { net: 7 })],
    });
    const placer = new Autoplacer(board([a, b], outline(0, 0, 100, 100)), NO_CLEARANCE);
    placer.matrix.gridRouting = MM(1);
    placer.genPlacementRoutingMatrix();
    return placer.computePlacementRatsnestCost(0, { x: 0, y: 0 });
  };

  it('charges a horizontal airwire its bare length', () => {
    // dy is zero, so `hypot(dx, 0)` is just the run: no penalty on an axis.
    expect(cost([10, 10], [30, 10])).toBeCloseTo(MM(20), 0);
    expect(cost([10, 10], [10, 30])).toBeCloseTo(MM(20), 0);
  });

  it('penalises a diagonal airwire by doubling its shorter axis', () => {
    // 20 across and 20 down is `hypot(20, 40)` = 44.7 mm of cost for 28.3 mm of
    // wire: the penalty peaks at 45 degrees, which is what makes the placer line
    // parts up in rows and columns rather than scattering them.
    expect(cost([10, 10], [30, 30])).toBeCloseTo(MM(Math.hypot(20, 40)), 0);
  });

  it('doubles the shorter axis and not the longer one', () => {
    // dx and dy are sorted so dx >= dy before the penalty is applied. Doubling
    // the wrong one would price a shallow diagonal far above a steep one of the
    // same length, and the placer would prefer tall stacks to wide rows.
    const shallow = cost([10, 10], [50, 20]); // dx 40, dy 10
    const steep = cost([10, 10], [20, 50]); // dx 10, dy 40 — same pair, swapped
    expect(shallow).toBeCloseTo(steep, 0);
    expect(shallow).toBeCloseTo(MM(Math.hypot(40, 20)), 0);
  });

  it('charges every pad separately, even when they share a target', () => {
    const target = footprint({
      reference: 'T',
      at: { x: MM(50), y: MM(10) },
      pads: [pad(50, 10, { net: 7 })],
    });
    const twoPads = footprint({
      reference: 'A',
      at: { x: MM(10), y: MM(10) },
      pads: [pad(10, 10, { net: 7 }), pad(20, 10, { number: '2', net: 7 })],
    });
    const placer = new Autoplacer(board([twoPads, target], outline(0, 0, 100, 100)), NO_CLEARANCE);
    placer.matrix.gridRouting = MM(1);
    placer.genPlacementRoutingMatrix();

    // `nearestPad` is per pad, not a spanning tree: both pads pay to reach the
    // one pad on the other part (40 mm + 30 mm), where a real ratsnest would
    // charge for one airwire. Summing a spanning tree instead would flatten the
    // cost of multi-pad nets and change which position wins.
    expect(placer.computePlacementRatsnestCost(0, { x: 0, y: 0 })).toBeCloseTo(MM(70), 0);
  });

  it('ignores pads with no net and pads on the footprint being placed', () => {
    const a = footprint({
      reference: 'A',
      at: { x: MM(10), y: MM(10) },
      pads: [pad(10, 10, { net: 0 }), pad(12, 10, { number: '2', net: 7 })],
    });
    const b = footprint({
      reference: 'B',
      at: { x: MM(40), y: MM(10) },
      pads: [pad(40, 10, { net: 0 }), pad(42, 10, { number: '2', net: 7 })],
    });
    const placer = new Autoplacer(board([a, b], outline(0, 0, 100, 100)), NO_CLEARANCE);
    placer.matrix.gridRouting = MM(1);
    placer.genPlacementRoutingMatrix();

    // Only the net-7 pair contributes: 30 mm. Counting net 0 would tie every
    // unconnected pad on the board to every other and swamp the real signal.
    expect(placer.computePlacementRatsnestCost(0, { x: 0, y: 0 })).toBeCloseTo(MM(30), 0);
  });
});

describe('choosing which footprint to place next', () => {
  const pick = (fps: PcbFootprint[], needs: number[]): number | null => {
    const placer = new Autoplacer(board(fps, outline(0, 0, 100, 100)), NO_CLEARANCE);
    placer.matrix.gridRouting = MM(1);
    placer.genPlacementRoutingMatrix();
    for (const i of needs) placer.needsPlaced.add(i);
    return placer.pickFootprint();
  };

  const sized = (ref: string, x: number, y: number, w: number, net: number): PcbFootprint =>
    footprint({
      reference: ref,
      at: { x: MM(x), y: MM(y) },
      pads: [pad(x, y, { net, size: { x: MM(w), y: MM(1) } })],
    });

  it('takes the largest connected footprint first', () => {
    const small = sized('R1', 10, 10, 1, 5);
    const large = sized('U1', 40, 10, 20, 5);

    // Both have one ratsnest edge, so the tie falls back to area — and the big
    // part goes down first, which is the whole shape of the algorithm: place
    // the thing everything else has to reach, then crowd around it.
    expect(pick([small, large], [0, 1])).toBe(1);
    expect(pick([large, small], [0, 1])).toBe(0);
  });

  it('ranks by area times pad count when the ratsnest ranking ties', () => {
    // A 4 mm square single-pad part (16 mm², one airwire) and a 4 x 2 mm
    // four-pad part (8 mm², two airwires). The second sort keys on area times
    // ratsnest and they tie exactly at 16, so the *first* sort decides — and
    // that one keys on area times pad count, where the four-pad part wins 32
    // to 16.
    const big = footprint({
      reference: 'U1',
      at: { x: MM(10), y: MM(10) },
      pads: [pad(10, 10, { net: 1, size: { x: MM(4), y: MM(4) } })],
    });
    const many = footprint({
      reference: 'J1',
      at: { x: MM(30), y: MM(10) },
      pads: [
        pad(30, 10, { number: '1', net: 1, size: { x: MM(1), y: MM(2) } }),
        pad(31, 10, { number: '2', net: 2, size: { x: MM(1), y: MM(2) } }),
        pad(32, 10, { number: '3', net: 0, size: { x: MM(1), y: MM(2) } }),
        pad(33, 10, { number: '4', net: 0, size: { x: MM(1), y: MM(2) } }),
      ],
    });
    const far = footprint({
      reference: 'R9',
      at: { x: MM(60), y: MM(10) },
      pads: [pad(60, 10, { net: 2 })],
    });

    // Ranking on area alone would put the 16 mm² part first and lay the board
    // out around the wrong component. A pin count is what makes a part hard to
    // reach, which is why upstream weights by it.
    expect(pick([big, many, far], [0, 1])).toBe(1);
  });

  it('ranks by area times ratsnest, not ratsnest count alone', () => {
    // 16 mm² with one airwire beats 4 mm² with two.
    const big = footprint({
      reference: 'U1',
      at: { x: MM(10), y: MM(10) },
      pads: [pad(10, 10, { net: 1, size: { x: MM(4), y: MM(4) } })],
    });
    const busy = footprint({
      reference: 'J1',
      at: { x: MM(30), y: MM(10) },
      pads: [pad(30, 10, { number: '1', net: 2 }), pad(31, 11, { number: '2', net: 3 })],
    });
    const partners = [
      footprint({ reference: 'R1', at: { x: MM(60), y: MM(10) }, pads: [pad(60, 10, { net: 1 })] }),
      footprint({ reference: 'R2', at: { x: MM(70), y: MM(10) }, pads: [pad(70, 10, { net: 2 })] }),
      footprint({ reference: 'R3', at: { x: MM(80), y: MM(10) }, pads: [pad(80, 10, { net: 3 })] }),
    ];

    // Airwire count alone would pick the small two-net part. Weighting by area
    // keeps a big, sparsely connected part — a microcontroller with two nets
    // routed so far — ahead of a small busy one, which is what stops the placer
    // filling the middle of the board with passives.
    expect(pick([big, busy, ...partners], [0, 1])).toBe(0);
  });

  it('skips a footprint with no ratsnest in favour of a smaller one that has some', () => {
    const bigLoner = footprint({
      reference: 'M1',
      at: { x: MM(10), y: MM(10) },
      pads: [pad(10, 10, { net: 0, size: { x: MM(30), y: MM(30) } })],
    });
    const connectedA = sized('R1', 50, 10, 1, 5);
    const connectedB = sized('R2', 60, 10, 1, 5);

    // A mounting hole is the biggest thing on many boards and has nowhere it
    // needs to be. Sorting by area alone would place it first and wall off the
    // middle of the board before anything with a net got a look in.
    expect(pick([bigLoner, connectedA, connectedB], [0, 1, 2])).not.toBe(0);
  });

  it('falls back to the last footprint scanned when nothing has a ratsnest', () => {
    const big = sized('U1', 10, 10, 20, 0);
    const small = sized('R1', 50, 10, 1, 0);

    // With every flag zero the second sort keys on `area * 0` for everyone, so
    // the stable sort leaves the complexity order standing and the scan runs to
    // the end without ever finding a non-zero flag. `altFootprint` therefore
    // holds the *last* one seen — the least complex. Returning `bestFootprint`
    // or the first alternative instead would reverse the order of every
    // netless board.
    expect(pick([big, small], [0, 1])).toBe(1);
    expect(pick([small, big], [0, 1])).toBe(0);
  });

  it('counts an airwire internal to a footprint, despite being asked to skip it', () => {
    // Two pads of one part, alone on their net: the only airwire on the board
    // has both ends on this footprint.
    const selfConnected = footprint({
      reference: 'J1',
      at: { x: MM(10), y: MM(10) },
      pads: [pad(10, 10, { net: 5 }), pad(20, 10, { number: '2', net: 5 })],
    });
    const loner = footprint({
      reference: 'M1',
      at: { x: MM(60), y: MM(10) },
      pads: [pad(60, 10, { net: 0, size: { x: MM(30), y: MM(30) } })],
    });

    // `GetRatsnestForComponent( fp, true )` is called with "skip internal
    // connections" set, and skips nothing: an edge with both ends on the
    // component fails the first test for want of the flag and is picked up by
    // the `else if( srcFound || dstFound )` right after. So J1 counts as
    // connected and outranks the netless M1 even though M1 is far larger.
    // Honouring the flag would give J1 a zero ratsnest and place M1 first.
    expect(pick([selfConnected, loner], [0, 1])).toBe(0);
  });

  it('ignores footprints that are not waiting to be placed', () => {
    const fixed = sized('U1', 10, 10, 20, 5);
    const wanted = sized('R1', 50, 10, 1, 5);

    // Everything on the board is ranked, but only the ones flagged for
    // placement can be returned — otherwise a fixed part would be picked up and
    // moved by a placement the user restricted to a selection.
    expect(pick([fixed, wanted], [1])).toBe(1);
    expect(pick([fixed, wanted], [])).toBeNull();
  });

  it('does not let tracks shorten the ratsnest it ranks by', () => {
    const a = sized('R1', 10, 10, 20, 5); // the larger of the two
    const b = sized('R2', 50, 10, 1, 5);
    const routed = board([a, b], outline(0, 0, 100, 100));
    routed.tracks = [
      {
        start: { x: MM(10), y: MM(10) },
        end: { x: MM(50), y: MM(10) },
        width: MM(0.25),
        layer: 'F.Cu',
        net: 5,
        source: EMPTY,
      },
    ];

    const placer = new Autoplacer(routed, NO_CLEARANCE);
    placer.matrix.gridRouting = MM(1);
    placer.genPlacementRoutingMatrix();
    placer.needsPlaced.add(0);
    placer.needsPlaced.add(1);

    // AR_AUTOPLACER builds its own CONNECTIVITY_DATA and adds only footprints
    // to it, so no track, via or zone can ever merge two clusters. The wire
    // between R1 and R2 is invisible to it and both keep a ratsnest of one, so
    // the larger R1 goes down first. Feeding it the board's real connectivity
    // would zero both flags, and the run would fall through to the
    // no-ratsnest branch and place the *smaller* R2 first instead.
    expect(placer.pickFootprint()).toBe(0);
  });
});

describe('choosing where to put it', () => {
  it('breaks a tie towards the far corner, not the near one', () => {
    const only = part('R1', 50, 50, 0, 0);
    const result = autoplaceFootprints(board([only], outline(0, 0, 20, 20)), [0], NO_CLEARANCE);

    // With nothing else on the board every position costs the same, and
    // upstream accepts a new best on `min_cost >= Score` — a tie replaces the
    // incumbent. The last position swept therefore wins, so the part goes to
    // the bottom-right of the free area. With `>` it would go to the top-left,
    // and every symmetric board would come out mirrored from KiCad's.
    const p = posOf(result.board, 'R1');
    expect(p.x).toBeGreaterThan(10);
    expect(p.y).toBeGreaterThan(10);
    expect(p).toEqual({ x: 17, y: 18 });
  });

  it('pulls a connected part towards the part it connects to', () => {
    const anchor = footprint({
      reference: 'U1',
      at: { x: MM(5), y: MM(5) },
      pads: [pad(5, 5, { net: 9 })],
    });
    const follower = footprint({
      reference: 'R1',
      at: { x: MM(50), y: MM(50) },
      pads: [pad(50, 50, { net: 9 })],
    });

    const result = autoplaceFootprints(
      board([anchor, follower], outline(0, 0, 40, 40)),
      [1],
      NO_CLEARANCE,
    );

    // U1 is not in the placement set, so it stays put and is burned into the
    // matrix; R1 is scored against it. The ratsnest term has to beat the tie
    // rule that otherwise parks everything bottom-right.
    const p = posOf(result.board, 'R1');
    expect(p.x).toBeLessThan(15);
    expect(p.y).toBeLessThan(15);
  });

  it('moves the footprint whole: pads travel with the anchor', () => {
    const only = part('R1', 50, 50, 0, 0);
    const before = only.pads.map((p) => ({ x: p.at.x - only.at.x, y: p.at.y - only.at.y }));
    const result = autoplaceFootprints(board([only], outline(0, 0, 20, 20)), [0], NO_CLEARANCE);

    // The board model keeps footprint children in absolute coordinates, so a
    // placement that only rewrote the anchor would tear the pads off the part
    // and every clearance the matrix charged for would be measured in the wrong
    // place from then on.
    const moved = result.board.footprints[0]!;
    const after = moved.pads.map((p) => ({ x: p.at.x - moved.at.x, y: p.at.y - moved.at.y }));
    expect(after).toEqual(before);
    expect(moved.at).not.toEqual(only.at);
  });

  it('keeps a placed footprint out of the cells another one already claimed', () => {
    const a = part('R1', 50, 50, 1, 2);
    const b = part('R2', 55, 50, 1, 2);
    const result = autoplaceFootprints(board([a, b], outline(0, 0, 20, 20)), [0, 1], NO_CLEARANCE);

    const p1 = posOf(result.board, 'R1');
    const p2 = posOf(result.board, 'R2');

    // Each placement is written into the matrix as CELL_IS_MODULE before the
    // next one is scored, so two parts cannot land on the same cells. Without
    // that write-back both would take the same "best" position and stack.
    expect(p1).not.toEqual(p2);
    expect(Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y)).toBeGreaterThanOrEqual(1);
  });

  it('does not block a footprint out of the position it is already in', () => {
    const anchor = footprint({
      reference: 'U1',
      at: { x: MM(4), y: MM(4) },
      pads: [pad(4, 4, { net: 9 })],
    });
    // (7, 4) is where the placer puts R1 from anywhere else on this board.
    const settled = footprint({
      reference: 'R1',
      at: { x: MM(7), y: MM(4) },
      pads: [pad(7, 4, { net: 9 })],
    });

    const result = autoplaceFootprints(
      board([anchor, settled], outline(0, 0, 20, 20)),
      [1],
      NO_CLEARANCE,
    );

    // Only the footprints that are *not* being placed are burned into the
    // matrix up front. Burning in the ones that are would mark their current
    // cells occupied and make their own best position unreachable, so a second
    // run of the tool would shuffle a board that was already settled.
    expect(posOf(result.board, 'R1')).toEqual({ x: 7, y: 4 });
  });

  it('parks a footprint too big for the board at the matrix origin', () => {
    const huge = footprint({
      reference: 'X1',
      at: { x: MM(5), y: MM(5) },
      pads: [pad(5, 5, { size: { x: MM(60), y: MM(60) } })],
    });
    const result = autoplaceFootprints(board([huge], outline(0, 0, 20, 20)), [0], NO_CLEARANCE);

    // `getOptimalFPPlacement` returns 1 with `lastPosOK` still at the box
    // origin, and upstream places the footprint there anyway rather than
    // leaving it alone — the `AR_ABORT_PLACEMENT` branch above it can never
    // fire, because that function only ever returns 0 or 1.
    expect(result.status).toBe('completed');
    expect(result.order).toEqual([0]);
    expect(posOf(result.board, 'X1')).toEqual({ x: 0, y: 0 });
  });
});

describe('the placement run', () => {
  it('leaves footprints outside the placement set alone by default', () => {
    const fixed = part('U1', 8, 8, 1, 2);
    const wanted = part('R1', 50, 50, 1, 2);
    const result = autoplaceFootprints(
      board([fixed, wanted], outline(0, 0, 30, 30)),
      [1],
      NO_CLEARANCE,
    );

    // The default has to be "only what was asked for": the tool's
    // autoplace-selection command passes a selection, and moving anything else
    // would silently rearrange a board the user thought they had pinned.
    expect(result.order).toEqual([1]);
    expect(result.board.footprints[0]!.at).toEqual(fixed.at);
  });

  it('adds the off-board footprints when asked to', () => {
    const offboard = part('U1', 80, 80, 1, 2);
    const onboard = part('R1', 10, 10, 1, 2);
    const result = autoplaceFootprints(board([offboard, onboard], outline(0, 0, 30, 30)), [], {
      ...NO_CLEARANCE,
      placeOffboardFootprints: true,
    });

    // This is the "Place Off-Board Footprints" command: an empty selection plus
    // the flag has to find the strays by itself, or the command does nothing.
    // R1 is inside the box and stays where it is.
    expect(result.order).toEqual([0]);
    expect(result.board.footprints[1]!.at).toEqual(onboard.at);
    expect(result.board.footprints[0]!.at).not.toEqual(offboard.at);
  });

  it('places every requested footprint exactly once', () => {
    const fps = [part('R1', 50, 50, 1, 2), part('R2', 55, 50, 1, 3), part('R3', 60, 50, 2, 3)];
    const result = autoplaceFootprints(board(fps, outline(0, 0, 30, 30)), [0, 1, 2], NO_CLEARANCE);

    // The loop ends when `pickFootprint` runs out of flagged footprints. A
    // footprint left flagged after being placed would spin forever; one cleared
    // early would never move.
    expect([...result.order].sort()).toEqual([0, 1, 2]);
  });

  it('honours a coarser grid', () => {
    const only = part('R1', 50, 50, 0, 0);
    const result = autoplaceFootprints(board([only], outline(0, 0, 40, 40)), [0], {
      ...NO_CLEARANCE,
      gridSize: MM(5),
    });

    // The sweep steps by the grid from an origin that is itself snapped to it,
    // so a 5 mm grid can only ever land the anchor on a 5 mm multiple offset by
    // the footprint's own extents. A grid that only changed the loop step would
    // leave the start position on the 1 mm lattice.
    const p = posOf(result.board, 'R1');
    expect(p.x % 5).toBe(0);
    expect(p.y % 5).toBe(0);
  });

  it('floors the grid at 0.25 mm however small a value it is given', () => {
    const only = part('R1', 20, 20, 0, 0);
    const tiny = autoplaceFootprints(board([only], outline(0, 0, 30, 30)), [0], {
      ...NO_CLEARANCE,
      gridSize: 1,
    });
    const floor = autoplaceFootprints(board([only], outline(0, 0, 30, 30)), [0], {
      ...NO_CLEARANCE,
      gridSize: MM(0.25),
    });

    // A one-nanometre grid would allocate a matrix of 10^15 cells. Upstream
    // clamps, and the clamped run has to be identical to asking for the floor
    // directly.
    expect(posOf(tiny.board, 'R1')).toEqual(posOf(floor.board, 'R1'));
  });
});

describe('how a footprint is measured', () => {
  it('measures the anchor even when the footprint has no geometry near it', () => {
    const fp = footprint({ at: { x: MM(10), y: MM(10) }, pads: [pad(30, 10)] });

    // `GetBoundingBox( false )` seeds the box at the anchor and inflates it by
    // 0.25 mm before merging anything, so a footprint whose pads sit far from
    // its origin is measured from the origin outwards. The sweep positions the
    // *anchor*, so dropping the seed would let the anchor leave the board.
    const box = footprintExtent(fp);
    expect(box.x).toBe(MM(9.75));
    expect(box.x + box.w).toBe(MM(30.5));
  });

  it('excludes annotation layers from a sided footprint', () => {
    const withNote = footprint({
      at: { x: MM(10), y: MM(10) },
      pads: [pad(10, 10)],
      shapes: [line(0, 0, 40, 40, 'Cmts.User')],
    });
    const withSilk = footprint({
      at: { x: MM(10), y: MM(10) },
      pads: [pad(10, 10)],
      shapes: [line(0, 0, 40, 40, 'F.SilkS')],
    });

    // Comments, drawings and the two ECO layers are annotation, not extent —
    // a fabrication note drawn across the sheet would otherwise make the part
    // too big to place anywhere. Silkscreen is not annotation and does count.
    expect(footprintExtent(withNote)).toEqual({
      x: MM(9.5),
      y: MM(9.5),
      w: MM(1),
      h: MM(1),
    });
    expect(footprintExtent(withSilk).w).toBe(MM(40));
  });

  it('is area times pad count that ranks a footprint, not area alone', () => {
    const wide = footprint({
      at: { x: MM(10), y: MM(10) },
      pads: [pad(10, 10, { size: { x: MM(10), y: MM(10) } })],
    });

    // `GetArea` is |width| * |height| of the text-excluded box. Ranking is that
    // times the pad count, so a 10 mm square single-pad part ranks below a
    // 5 mm square four-pad one.
    expect(footprintArea(wide)).toBe(MM(10) * MM(10));
  });
});
