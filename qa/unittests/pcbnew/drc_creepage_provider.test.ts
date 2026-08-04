// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Creepage, end to end.
 * Counterpart: `DRC_TEST_PROVIDER_CREEPAGE`.
 *
 * The check earns its existence in one fixture, near the bottom of this file:
 * two nets, unmoved, and a slot milled between them turns a violation into a
 * pass. Nothing about clearance changes — the nets are exactly as far apart as
 * they were — but the distance a leakage current has to crawl goes up by seven
 * millimetres, which is the entire reason anyone cuts one.
 *
 * Everything else here is about not being wrong in the dangerous direction. A
 * creepage check that misses a violation is worse than none at all, because a
 * green result on a safety property is read as permission to ship. So the
 * tests are weighted towards *under*-reporting: shape kinds that must be
 * included, and the off switch that must be explicit rather than a silent
 * default.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import {
  boardEdgeShapes,
  boardSurface,
  copperShapesByNet,
} from '@ziroeda/pcbnew/src/drc/creepage_shapes.js';
import type { Board, PcbShape, PcbTrack } from '@ziroeda/pcbnew/src/types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const MM = (n: number): number => mmToIU(n);
const P = (x: number, y: number): Vec2 => ({ x: MM(x), y: MM(y) });
const EMPTY = { kind: 'list' as const, items: [] };

const line = (x1: number, y1: number, x2: number, y2: number): PcbShape => ({
  kind: 'line',
  start: P(x1, y1),
  end: P(x2, y2),
  layer: 'Edge.Cuts',
  width: MM(0.1),
  fill: false,
  source: EMPTY,
});

const track = (x1: number, y1: number, x2: number, y2: number, net: number): PcbTrack => ({
  start: P(x1, y1),
  end: P(x2, y2),
  width: MM(1),
  layer: 'F.Cu',
  net,
  source: EMPTY,
});

/** A 60 x 30 board outline. */
const RECT_OUTLINE = [
  line(0, 0, 60, 0),
  line(60, 0, 60, 30),
  line(60, 30, 0, 30),
  line(0, 30, 0, 0),
];
/** A closed slot between x = 28 and x = 32, clear of both board edges. */
const SLOT = [line(28, 5, 32, 5), line(32, 5, 32, 25), line(32, 25, 28, 25), line(28, 25, 28, 5)];

/** Two 1 mm tracks whose facing ends are 30 mm apart, so 29 mm of copper gap. */
const TWO_NETS = [track(5, 15, 15, 15, 1), track(45, 15, 55, 15, 2)];

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'HV'],
    [2, 'LV'],
  ]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: RECT_OUTLINE,
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  groups: [],
  source: EMPTY,
  ...over,
});

const OPTS: DrcOptions = {
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const creepage = (b: Board, minCreepage?: number) =>
  runDrc(b, { ...OPTS, minCreepage }).filter((v) => v.code === 'creepage');

describe('the board surface', () => {
  it('is the outline Edge.Cuts closes into', () => {
    const surface = boardSurface(board());

    expect(surface).not.toBeNull();
    expect(surface!.holes).toHaveLength(0);
  });

  it('takes the largest ring as the outline and the rest as cutouts', () => {
    // The slot is given *first*, so "whichever chained first" would pick it
    // and hand back a 4 mm board with a 60 mm hole in it.
    const surface = boardSurface(board({ shapes: [...SLOT, ...RECT_OUTLINE] }));
    const spanX = (ring: readonly Vec2[]) =>
      Math.max(...ring.map((p) => p.x)) - Math.min(...ring.map((p) => p.x));

    expect(surface!.holes).toHaveLength(1);
    expect(spanX(surface!.outline)).toBe(MM(60));
    expect(spanX(surface!.holes[0]!)).toBe(MM(4));
  });

  it('is nothing at all when Edge.Cuts closes into nothing', () => {
    // A board mid-edit. The invalid-outline check already says so; creepage
    // simply has no surface to crawl over.
    expect(boardSurface(board({ shapes: [line(0, 0, 10, 0)] }))).toBeNull();
  });
});

describe('board edges become corners', () => {
  it('contributes a straight edge’s endpoints and nothing between', () => {
    // A shortest path across a polygonal surface bends only at corners, so a
    // node in the middle of a straight run could never be on one.
    const shapes = boardEdgeShapes(board({ shapes: [line(0, 0, 60, 0)] }));

    expect(shapes).toHaveLength(2);
    expect(shapes.every((s) => s.kind === 'be-point')).toBe(true);
  });

  it('keeps a curved edge whole, because a path may leave it anywhere', () => {
    const arc: PcbShape = {
      kind: 'arc',
      start: P(10, 0),
      mid: P(0, 10),
      end: P(-10, 0),
      layer: 'Edge.Cuts',
      width: MM(0.1),
      fill: false,
      source: EMPTY,
    };

    expect(boardEdgeShapes(board({ shapes: [arc] }))[0]?.kind).toBe('be-arc');
  });

  it('ignores anything not on Edge.Cuts', () => {
    const silk = { ...line(0, 0, 10, 0), layer: 'F.SilkS' };

    expect(boardEdgeShapes(board({ shapes: [silk] }))).toEqual([]);
  });
});

describe('what counts as a net’s copper', () => {
  it('includes tracks, arcs, vias, pads and zone fills', () => {
    // Leaving a kind out does not make the check conservative — fewer shapes
    // means fewer routes, a longer reported distance, and a violation that
    // never fires.
    const b = board({
      tracks: [track(5, 15, 15, 15, 1)],
      vias: [
        {
          kind: 'through',
          at: P(20, 15),
          size: MM(0.8),
          drill: MM(0.4),
          net: 1,
          layers: ['F.Cu', 'B.Cu'],
          source: EMPTY,
        },
      ],
      zones: [
        {
          net: 1,
          layers: ['F.Cu'],
          fills: [{ layer: 'F.Cu', polys: [[P(30, 5), P(40, 5), P(40, 10), P(30, 10)]] }],
          outline: [P(30, 5), P(40, 5), P(40, 10), P(30, 10)],
          source: EMPTY,
        },
      ],
    });

    const shapes = copperShapesByNet(b, 'F.Cu').get(1) ?? [];

    expect(shapes.some((s) => s.kind === 'cu-segment')).toBe(true);
    expect(shapes.some((s) => s.kind === 'cu-circle')).toBe(true);
    // The fill's four boundary edges.
    expect(shapes.filter((s) => s.kind === 'cu-segment')).toHaveLength(5);
  });

  it('leaves net 0 out, which is the absence of a net rather than one', () => {
    expect(copperShapesByNet(board({ tracks: [track(5, 15, 15, 15, 0)] }), 'F.Cu').size).toBe(0);
  });

  it('keeps the layers apart', () => {
    expect(copperShapesByNet(board({ tracks: [track(5, 15, 15, 15, 1)] }), 'B.Cu').size).toBe(0);
  });
});

describe('through the DRC engine', () => {
  it('is off unless a creepage distance is asked for', () => {
    // There is no sensible default: the required distance depends on working
    // voltage and pollution degree, neither of which the board file records.
    expect(creepage(board({ tracks: TWO_NETS }))).toHaveLength(0);
    expect(creepage(board({ tracks: TWO_NETS }), 0)).toHaveLength(0);
  });

  it('says nothing when the surface distance is enough', () => {
    expect(creepage(board({ tracks: TWO_NETS }), MM(20))).toHaveLength(0);
  });

  it('reports the actual distance when it is not', () => {
    const found = creepage(board({ tracks: TWO_NETS }), MM(40));

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('actual 29 mm');
    expect(found[0]?.message).toContain('HV');
    expect(found[0]?.message).toContain('LV');
  });

  it('says nothing when there is no closed outline to crawl over', () => {
    expect(creepage(board({ tracks: TWO_NETS, shapes: [line(0, 0, 10, 0)] }), MM(40))).toHaveLength(
      0,
    );
  });

  it('does not compare a net with itself', () => {
    const oneNet = [track(5, 15, 15, 15, 1), track(45, 15, 55, 15, 1)];

    expect(creepage(board({ tracks: oneNet }), MM(40))).toHaveLength(0);
  });
});

describe('where the required distance comes from', () => {
  const byRule = (text: string) =>
    runDrc(board({ tracks: TWO_NETS }), { ...OPTS, customRules: parseDrcRules(text) }).filter(
      (v) => v.code === 'creepage',
    );

  it('is a .kicad_dru rule, since no Board Setup field could know it', () => {
    // The distance a board needs depends on working voltage and pollution
    // degree, neither of which the file records — so upstream has no setting
    // for it either, only the rule.
    expect(byRule('(version 1)\n(rule "hv" (constraint creepage (min 40mm)))')).toHaveLength(1);
  });

  it('is nothing at all when no rule asks for it', () => {
    // The 40 mm is deliberately large: a rule of *any* type would trip the
    // check if the constraint type were not filtered, and a small one would
    // pass either way and prove nothing.
    expect(byRule('(version 1)\n(rule "other" (constraint clearance (min 40mm)))')).toHaveLength(0);
  });

  it('is the strictest rule when several ask', () => {
    // 20 mm is satisfied by the 29 mm route and 40 mm is not; taking the
    // larger is what makes the strictest rule the one that must be met.
    const both = byRule(
      '(version 1)\n(rule "a" (constraint creepage (min 20mm)))\n(rule "b" (constraint creepage (min 40mm)))',
    );

    expect(both).toHaveLength(1);
    expect(both[0]?.message).toContain('creepage 40 mm');
  });
});

describe('a slot is the point of the whole check', () => {
  it('lengthens the creepage without moving the nets at all', () => {
    // Same two tracks, same 29 mm of air between them. The slot adds nearly
    // seven millimetres to the surface route.
    const plain = creepage(board({ tracks: TWO_NETS }), MM(40))[0];
    const slotted = creepage(
      board({ tracks: TWO_NETS, shapes: [...RECT_OUTLINE, ...SLOT] }),
      MM(40),
    )[0];

    expect(plain?.message).toContain('actual 29 mm');
    expect(slotted?.message).toMatch(/actual 35\./);
  });

  it('turns a failing board into a passing one', () => {
    // The reason the slot is there. At a 30 mm requirement the bare board
    // fails and the slotted one passes, and nothing moved.
    expect(creepage(board({ tracks: TWO_NETS }), MM(30))).toHaveLength(1);
    expect(
      creepage(board({ tracks: TWO_NETS, shapes: [...RECT_OUTLINE, ...SLOT] }), MM(30)),
    ).toHaveLength(0);
  });
});
