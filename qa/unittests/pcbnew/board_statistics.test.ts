// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board statistics.
 * Counterparts: `pcbnew/board_statistics.cpp` and
 * `pcbnew/board_statistics_report.cpp`.
 *
 * The arithmetic here is trivial and the classification is not, so the tests
 * are about what gets counted and what does not: which footprints have a side,
 * which holes are the same hole, and what a board whose Edge.Cuts does not
 * close is allowed to report. Expected areas are computed from the rectangle
 * dimensions by hand rather than by re-running the code.
 */
import { describe, expect, it } from 'vitest';
import {
  collectDrillLineItems,
  computeBoardStatistics,
  getBoardPolygonOutlines,
  initialiseBoardStatisticsData,
  sameDrillLineItem,
  STATISTICS_INT_MAX,
} from '@ziroeda/pcbnew/src/board_statistics.js';
import type {
  Board,
  PcbFootprint,
  PcbPad,
  PcbShape,
  PcbTextItem,
  PcbTrack,
  PcbVia,
} from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };
const P = (x: number, y: number) => ({ x, y });

/** 1 mm in internal units. */
const MM = 1_000_000;

const pad = (over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at: P(0, 0),
  angle: 0,
  size: P(MM, MM),
  layers: ['F.Cu', 'F.Mask', 'F.Paste'],
  source: EMPTY,
  ...over,
});

const thtPad = (over: Partial<PcbPad> = {}): PcbPad =>
  pad({
    type: 'thru_hole',
    shape: 'circle',
    layers: ['*.Cu', '*.Mask'],
    drill: { oblong: false, w: 800_000, h: 800_000 },
    ...over,
  });

const via = (over: Partial<PcbVia> = {}): PcbVia => ({
  at: P(0, 0),
  size: 600_000,
  drill: 300_000,
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net: 1,
  source: EMPTY,
  ...over,
});

const track = (over: Partial<PcbTrack> = {}): PcbTrack => ({
  start: P(0, 0),
  end: P(MM, 0),
  width: 250_000,
  layer: 'F.Cu',
  net: 1,
  source: EMPTY,
  ...over,
});

const fp = (over: Partial<PcbFootprint> = {}): PcbFootprint => ({
  lib: 'Lib:Part',
  at: P(0, 0),
  angle: 0,
  layer: 'F.Cu',
  reference: 'R1',
  pads: [],
  shapes: [],
  texts: [],
  models: [],
  source: EMPTY,
  ...over,
});

const line = (a: { x: number; y: number }, b: { x: number; y: number }): PcbShape => ({
  kind: 'line',
  start: a,
  end: b,
  width: 100_000,
  fill: false,
  layer: 'Edge.Cuts',
  source: EMPTY,
});

/** A closed Edge.Cuts rectangle, drawn as four separate lines. */
const outlineLines = (x0: number, y0: number, x1: number, y1: number): PcbShape[] => [
  line(P(x0, y0), P(x1, y0)),
  line(P(x1, y0), P(x1, y1)),
  line(P(x1, y1), P(x0, y1)),
  line(P(x0, y1), P(x0, y0)),
];

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 2, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([[0, '']]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  groups: [],
  source: EMPTY,
  ...over,
});

// ---------------------------------------------------------------------------

describe('the entry tables', () => {
  it('lists rows in the order the dialog and the saved report print them', () => {
    // The order is output, not an implementation detail: it is the row order of
    // four grids and of the text report. Reordering silently rewrites both.
    const data = initialiseBoardStatisticsData();

    expect(data.footprintEntries.map((e) => e.title)).toEqual(['THT:', 'SMD:', 'Unspecified:']);
    expect(data.padEntries.map((e) => e.title)).toEqual([
      'Through hole:',
      'SMD:',
      'Connector:',
      'NPTH:',
    ]);
    expect(data.padPropertyEntries.map((e) => e.title)).toEqual(['Castellated:', 'Press-fit:']);
    expect(data.viaEntries.map((e) => e.title)).toEqual([
      'Through vias:',
      'Blind vias:',
      'Buried vias:',
      'Micro vias:',
    ]);
  });

  it('starts the minima at INT_MAX, not at zero', () => {
    // A board with no tracks must report "unknown"-sized minima, and the dialog
    // tells that from the sentinel. Zero would read as a 0 nm track.
    const data = computeBoardStatistics(board());

    expect(data.minTrackWidth).toBe(STATISTICS_INT_MAX);
    expect(data.minDrillSize).toBe(STATISTICS_INT_MAX);
  });
});

describe('counting footprints', () => {
  it('splits THT, SMD and unspecified by the attribute mask', () => {
    // The masks are (THT), (SMD) and (THT|SMD)==0, tested in that order with a
    // break, so a footprint claiming both lands in THT.
    const b = board({
      footprints: [
        fp({ attributes: ['through_hole'], pads: [thtPad()] }),
        fp({ attributes: ['smd'], pads: [pad()] }),
        fp({ attributes: [], pads: [pad()] }),
        fp({ attributes: ['through_hole', 'smd'], pads: [pad()] }),
      ],
    });

    const counts = computeBoardStatistics(b).footprintEntries.map((e) => e.frontCount);
    expect(counts).toEqual([2, 1, 1]);
  });

  it('counts a back-side footprint in the back column only', () => {
    const b = board({
      footprints: [fp({ layer: 'B.Cu', attributes: ['smd'], pads: [pad({ layers: ['B.Cu'] })] })],
    });

    const smd = computeBoardStatistics(b).footprintEntries[1]!;
    expect([smd.frontCount, smd.backCount]).toEqual([0, 1]);
  });

  it('gives no side to a footprint with nothing on a side-specific layer', () => {
    // GetSide returns UNDEFINED_LAYER and the switch increments neither column,
    // so the footprint is matched, consumed by the break, and counted nowhere.
    // A mounting hole whose only pad is an Edge.Cuts aperture behaves this way.
    const b = board({
      footprints: [
        fp({
          attributes: ['through_hole'],
          pads: [pad({ layers: ['Edge.Cuts'] })],
          shapes: [
            {
              kind: 'line',
              start: P(0, 0),
              end: P(MM, 0),
              width: 100_000,
              fill: false,
              layer: 'User.Drawings',
              source: EMPTY,
            },
          ],
        }),
      ],
    });

    const tht = computeBoardStatistics(b).footprintEntries[0]!;
    expect([tht.frontCount, tht.backCount]).toEqual([0, 0]);
  });

  it('does not let reference text alone give a footprint a side', () => {
    // Reference and Value are PCB_FIELDs, held in m_fields; GetSide walks
    // m_drawings. Counting them would give a side to footprints KiCad leaves
    // in neither column.
    const ref: PcbTextItem = {
      kind: 'reference',
      text: 'R1',
      at: P(0, 0),
      angle: 0,
      layer: 'F.SilkS',
      size: P(MM, MM),
      source: EMPTY,
    };

    const withField = board({
      footprints: [
        fp({ attributes: ['smd'], pads: [pad({ layers: ['Edge.Cuts'] })], texts: [ref] }),
      ],
    });
    expect(computeBoardStatistics(withField).footprintEntries[1]!.frontCount).toBe(0);

    // The same text as a user PCB_TEXT *is* in m_drawings and does give a side.
    const withText = board({
      footprints: [
        fp({
          attributes: ['smd'],
          pads: [pad({ layers: ['Edge.Cuts'] })],
          texts: [{ ...ref, kind: 'user' }],
        }),
      ],
    });
    expect(computeBoardStatistics(withText).footprintEntries[1]!.frontCount).toBe(1);
  });

  it('drops pinless footprints from the component counts when asked', () => {
    // The option defaults off, so a test that never turns it on leaves the
    // whole branch unexercised.
    // The pinless one needs a silkscreen graphic, or GetSide would leave it out
    // of both columns anyway and the option would look like it did nothing.
    const b = board({
      footprints: [
        fp({ attributes: ['smd'], pads: [pad()] }),
        fp({ attributes: ['smd'], shapes: [{ ...line(P(0, 0), P(MM, 0)), layer: 'F.SilkS' }] }),
      ],
    });

    expect(computeBoardStatistics(b).footprintEntries[1]!.frontCount).toBe(2);

    const excluded = computeBoardStatistics(b, {
      excludeFootprintsWithoutPads: true,
      subtractHolesFromBoardArea: false,
      subtractHolesFromCopperAreas: false,
    });
    expect(excluded.footprintEntries[1]!.frontCount).toBe(1);
  });
});

describe('counting pads and vias', () => {
  it('counts pads by attribute and, separately, by property', () => {
    // A castellated pad is counted once as a through-hole pad and once as a
    // castellated one: the two lists are independent, so the property rows are
    // not part of the pad total.
    const b = board({
      footprints: [
        fp({
          pads: [
            thtPad({ padProperty: 'pad_prop_castellated' }),
            thtPad({ type: 'np_thru_hole' }),
            pad({ type: 'connect' }),
            pad({ padProperty: 'pad_prop_pressfit' }),
            pad({ padProperty: 'pad_prop_heatsink' }),
          ],
        }),
      ],
    });

    const data = computeBoardStatistics(b);
    expect(data.padEntries.map((e) => e.quantity)).toEqual([1, 2, 1, 1]);
    // A heatsink pad matches neither counted property and is in no row.
    expect(data.padPropertyEntries.map((e) => e.quantity)).toEqual([1, 1]);
  });

  it('counts vias by type', () => {
    const b = board({
      vias: [
        via(),
        via(),
        via({ kind: 'blind', layers: ['F.Cu', 'In1.Cu'] }),
        via({ kind: 'micro' }),
      ],
    });

    // Buried stays zero: our board model reads `(via buried …)` as a through
    // via, so the row exists but can never be reached.
    expect(computeBoardStatistics(b).viaEntries.map((e) => e.quantity)).toEqual([2, 1, 0, 1]);
  });

  it('takes the minimum track width from straight tracks only', () => {
    // Upstream tests PCB_TRACE_T before the filter that admits arcs and vias,
    // so a hair-thin arc never narrows the reported minimum.
    const b = board({
      tracks: [track({ width: 250_000 }), track({ width: 150_000 })],
      arcs: [
        {
          start: P(0, 0),
          mid: P(MM, MM),
          end: P(2 * MM, 0),
          width: 50_000,
          layer: 'F.Cu',
          net: 1,
          source: EMPTY,
        },
      ],
    });

    expect(computeBoardStatistics(b).minTrackWidth).toBe(150_000);
  });
});

describe('grouping drill holes', () => {
  it('treats holes as the same only when all seven fields agree', () => {
    // Same diameter is not enough. A PTH and an NPTH of the same size are two
    // rows, and so are a pad hole and a via hole of the same size.
    const b = board({
      footprints: [
        fp({
          pads: [
            thtPad(),
            thtPad(),
            thtPad({ type: 'np_thru_hole' }),
            thtPad({ drill: { oblong: true, w: 800_000, h: 800_000 } }),
          ],
        }),
      ],
      vias: [via({ drill: 800_000 })],
    });

    const drills = collectDrillLineItems(b);
    expect(drills.map((d) => [d.xSize, d.shape, d.isPlated, d.isPad, d.qty])).toEqual([
      [800_000, 'circle', true, true, 2],
      [800_000, 'circle', false, true, 1],
      [800_000, 'oblong', true, true, 1],
      [800_000, 'circle', true, false, 1],
    ]);
  });

  it('separates holes that differ only in layer span', () => {
    // startLayer/stopLayer are part of the identity, so a blind via's hole is a
    // different row from a through via's of the same drill.
    const b = board({
      layers: [
        { id: 0, name: 'F.Cu', kind: 'signal' },
        { id: 4, name: 'In1.Cu', kind: 'signal' },
        { id: 2, name: 'B.Cu', kind: 'signal' },
      ],
      // SanitizeLayers forces a through via to F.Cu/B.Cu whatever the file
      // said, so the first two are one row and not two.
      vias: [
        via(),
        via({ layers: ['In1.Cu', 'In1.Cu'] }),
        via({ kind: 'blind', layers: ['In1.Cu', 'F.Cu'] }),
      ],
    });

    const drills = collectDrillLineItems(b);
    expect(drills.map((d) => [d.startLayer, d.stopLayer, d.qty])).toEqual([
      ['F.Cu', 'B.Cu', 2],
      // The blind pair is reordered by depth, not left in file order.
      ['F.Cu', 'In1.Cu', 1],
    ]);
  });

  it('leaves a pad with no copper layer at all on undefined layers', () => {
    // CuStack() is empty and upstream stores UNDEFINED_LAYER, which the dialog
    // prints as "N/A" rather than as a layer name.
    const b = board({
      footprints: [fp({ pads: [thtPad({ layers: ['F.Mask'] })] })],
    });

    const [drill] = collectDrillLineItems(b);
    expect(drill!.startLayer).toBeUndefined();
    expect(drill!.stopLayer).toBeUndefined();
  });

  it('ignores pads with no hole and vias with no drill', () => {
    const b = board({
      footprints: [fp({ pads: [pad(), thtPad({ drill: { oblong: false, w: 0, h: 800_000 } })] })],
      vias: [via({ drill: 0 })],
    });

    expect(collectDrillLineItems(b)).toEqual([]);
  });

  it('sorts the rows by descending count and takes the min drill from round holes', () => {
    // Only CIRCLE holes are candidates for the minimum drill diameter: a
    // narrower slot does not lower it.
    const b = board({
      footprints: [
        fp({
          pads: [
            thtPad({ drill: { oblong: true, w: 200_000, h: 900_000 } }),
            thtPad(),
            thtPad(),
            thtPad(),
          ],
        }),
      ],
    });

    const data = computeBoardStatistics(b);
    expect(data.drillEntries.map((d) => d.qty)).toEqual([3, 1]);
    expect(data.minDrillSize).toBe(800_000);
  });

  it('compares every identity field', () => {
    const base = collectDrillLineItems(board({ footprints: [fp({ pads: [thtPad()] })] }))[0]!;

    expect(sameDrillLineItem(base, { ...base, qty: 99 })).toBe(true);
    expect(sameDrillLineItem(base, { ...base, ySize: 1 })).toBe(false);
    expect(sameDrillLineItem(base, { ...base, stopLayer: 'In1.Cu' })).toBe(false);
  });
});

describe('the board outline', () => {
  it('measures a rectangle drawn as four separate lines', () => {
    const b = board({ shapes: outlineLines(0, 0, 100 * MM, 50 * MM) });
    const data = computeBoardStatistics(b);

    expect(data.hasOutline).toBe(true);
    expect(data.boardWidth).toBe(100 * MM);
    expect(data.boardHeight).toBe(50 * MM);
    expect(data.boardArea).toBe(100 * MM * (50 * MM));
  });

  it('reports nothing at all when Edge.Cuts is empty', () => {
    const data = computeBoardStatistics(board({ shapes: [] }));

    expect(data.hasOutline).toBe(false);
    expect([data.boardWidth, data.boardHeight, data.boardArea]).toEqual([0, 0, 0]);
  });

  it('reports nothing when the outline has a gap', () => {
    // doConvertOutlineToPolygon builds every contour and *then* refuses if any
    // one is open, before adding a single contour to the polygon set. Measuring
    // the three sides that did chain would invent a board.
    const sides = outlineLines(0, 0, 100 * MM, 50 * MM);
    const data = computeBoardStatistics(board({ shapes: sides.slice(0, 3) }));

    expect(data.hasOutline).toBe(false);
    expect([data.boardWidth, data.boardHeight, data.boardArea]).toEqual([0, 0, 0]);
  });

  it('closes a gap smaller than the chaining epsilon', () => {
    // 0.01 mm is DEFAULT_CHAINING_EPSILON_MM; a hand-drawn outline that misses
    // by less than that is still a board.
    const sides = outlineLines(0, 0, 100 * MM, 50 * MM);
    sides[3] = line(P(0, 50 * MM), P(0, 5_000));

    expect(computeBoardStatistics(board({ shapes: sides })).hasOutline).toBe(true);

    // Twice the epsilon does not close.
    sides[3] = line(P(0, 50 * MM), P(0, 20_000));
    expect(computeBoardStatistics(board({ shapes: sides })).hasOutline).toBe(false);
  });

  it('counts a cutout as board area unless asked to subtract it', () => {
    // "Area" is the gross outline area by default. A 10x10 mm window in a
    // 100x50 mm board changes nothing until the checkbox is ticked.
    const b = board({
      shapes: [
        ...outlineLines(0, 0, 100 * MM, 50 * MM),
        ...outlineLines(10 * MM, 10 * MM, 20 * MM, 20 * MM),
      ],
    });

    expect(computeBoardStatistics(b).boardArea).toBe(100 * MM * (50 * MM));

    const subtracted = computeBoardStatistics(b, {
      excludeFootprintsWithoutPads: false,
      subtractHolesFromBoardArea: true,
      subtractHolesFromCopperAreas: false,
    });
    expect(subtracted.boardArea).toBe(100 * MM * (50 * MM) - 10 * MM * (10 * MM));
  });

  it('adds a second disjoint outline to the area and to the bounding box', () => {
    // aAllowDisjoint is true for a board, so a panel of two boards measures as
    // both, and the dimensions are the bounding box over the pair.
    const b = board({
      shapes: [
        ...outlineLines(0, 0, 10 * MM, 10 * MM),
        ...outlineLines(20 * MM, 0, 30 * MM, 10 * MM),
      ],
    });
    const data = computeBoardStatistics(b);

    expect(data.boardArea).toBe(2 * (10 * MM * (10 * MM)));
    expect(data.boardWidth).toBe(30 * MM);
    expect(data.boardHeight).toBe(10 * MM);
  });

  it('subtracts every drilled hole once per outline, as upstream does', () => {
    // The pad and via loops sit *inside* the per-outline loop. On a two-outline
    // panel each hole is therefore subtracted twice. It reads as a bug and is
    // reproduced so that a board measured by KiCad and by us agrees.
    const holes = [fp({ pads: [thtPad({ drill: { oblong: false, w: 1 * MM, h: 1 * MM } })] })];
    const holeArea = Math.PI * 0.25 * MM * MM;

    const one = computeBoardStatistics(
      board({ shapes: outlineLines(0, 0, 10 * MM, 10 * MM), footprints: holes }),
      {
        excludeFootprintsWithoutPads: false,
        subtractHolesFromBoardArea: true,
        subtractHolesFromCopperAreas: false,
      },
    );
    expect(one.boardArea).toBeCloseTo(10 * MM * (10 * MM) - holeArea, 0);

    const two = computeBoardStatistics(
      board({
        shapes: [
          ...outlineLines(0, 0, 10 * MM, 10 * MM),
          ...outlineLines(20 * MM, 0, 30 * MM, 10 * MM),
        ],
        footprints: holes,
      }),
      {
        excludeFootprintsWithoutPads: false,
        subtractHolesFromBoardArea: true,
        subtractHolesFromCopperAreas: false,
      },
    );
    expect(two.boardArea).toBeCloseTo(2 * (10 * MM * (10 * MM)) - 2 * holeArea, 0);
  });

  it('takes a slot hole as a stadium, not as a circle', () => {
    // GetEffectiveHoleShape is a segment of width min(x,y) whose length is the
    // difference between the two drill dimensions.
    const b = board({
      shapes: outlineLines(0, 0, 10 * MM, 10 * MM),
      footprints: [fp({ pads: [thtPad({ drill: { oblong: true, w: 1 * MM, h: 3 * MM } })] })],
    });

    const data = computeBoardStatistics(b, {
      excludeFootprintsWithoutPads: false,
      subtractHolesFromBoardArea: true,
      subtractHolesFromCopperAreas: false,
    });

    // width 1 mm, segment length 2 mm: 2 mm² of body plus a 1 mm round cap.
    const slot = 2 * MM * MM + Math.PI * 0.25 * MM * MM;
    expect(data.boardArea).toBeCloseTo(10 * MM * (10 * MM) - slot, 0);
  });

  it('takes footprint Edge.Cuts graphics as part of the outline', () => {
    // BuildBoardPolygonOutlines collects PCB_SHAPEs from the whole board, so a
    // mounting-hole footprint that draws its own cutout is a hole in the board.
    const b = board({
      shapes: outlineLines(0, 0, 100 * MM, 50 * MM),
      footprints: [fp({ shapes: outlineLines(10 * MM, 10 * MM, 20 * MM, 20 * MM) })],
    });

    const data = computeBoardStatistics(b, {
      excludeFootprintsWithoutPads: false,
      subtractHolesFromBoardArea: true,
      subtractHolesFromCopperAreas: false,
    });
    expect(data.boardArea).toBe(100 * MM * (50 * MM) - 10 * MM * (10 * MM));
  });

  it('nests a cutout under its immediate parent, not under every ancestor', () => {
    // Parent parity decides: even means outline, odd means hole. An island
    // inside a cutout has two parents and is an outline again.
    const b = board({
      shapes: [
        ...outlineLines(0, 0, 100 * MM, 100 * MM),
        ...outlineLines(10 * MM, 10 * MM, 90 * MM, 90 * MM),
        ...outlineLines(40 * MM, 40 * MM, 60 * MM, 60 * MM),
      ],
    });

    const outlines = getBoardPolygonOutlines(b);
    expect(outlines.success).toBe(true);
    expect(outlines.polygons.length).toBe(2);
    expect(outlines.polygons.map((p) => p.holes.length).sort()).toEqual([0, 1]);
  });

  it('refuses the whole build when a graphic is malformed', () => {
    // A line with no end point still becomes a contour upstream, and a contour
    // that cannot close fails the build rather than being quietly dropped.
    const shapes = outlineLines(0, 0, 10 * MM, 10 * MM);
    shapes.push({
      kind: 'line',
      start: P(0, 0),
      width: 100_000,
      fill: false,
      layer: 'Edge.Cuts',
      source: EMPTY,
    });

    expect(getBoardPolygonOutlines(board({ shapes })).success).toBe(false);
  });

  it('measures an outline drawn as one closed rectangle graphic', () => {
    const b = board({
      shapes: [
        {
          kind: 'rect',
          start: P(0, 0),
          end: P(40 * MM, 25 * MM),
          width: 100_000,
          fill: false,
          layer: 'Edge.Cuts',
          source: EMPTY,
        },
      ],
    });
    const data = computeBoardStatistics(b);

    expect(data.hasOutline).toBe(true);
    expect(data.boardArea).toBe(40 * MM * (25 * MM));
  });

  it('ignores graphics on other layers', () => {
    const b = board({
      shapes: [
        ...outlineLines(0, 0, 10 * MM, 10 * MM),
        { ...line(P(0, 0), P(50 * MM, 0)), layer: 'F.SilkS' },
      ],
    });

    expect(computeBoardStatistics(b).boardWidth).toBe(10 * MM);
  });
});
