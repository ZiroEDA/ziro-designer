// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rule areas as DRC rules, and the area predicates a condition can ask about.
 *
 * Upstream turns every rule area into an implicit `disallow` rule conditioned
 * on `A.intersectsArea('<uuid>')` (`DRC_ENGINE::loadImplicitRules`), so a
 * keepout and a hand-written rule reach the checks by exactly the same path.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  areaOutline,
  areasMatching,
  deflatePolygon,
  shapesEnclosedByArea,
  shapesIntersectArea,
} from '@ziroeda/pcbnew/src/drc/drc_areas.js';
import { type DrcOptions, runDrc, ruleAreaRules } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import { parseDrcRules } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import type { Board, PcbTrack, PcbVia, PcbZone } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

/** A square from (x0,y0) to (x1,y1). */
const box = (x0: number, y0: number, x1: number, y1: number) => [
  { x: MM(x0), y: MM(y0) },
  { x: MM(x1), y: MM(y0) },
  { x: MM(x1), y: MM(y1) },
  { x: MM(x0), y: MM(y1) },
];

const ruleArea = (over: Partial<PcbZone> = {}): PcbZone => ({
  net: 0,
  layers: ['F.Cu'],
  fills: [],
  outline: box(10, 0, 20, 10),
  uuid: 'area-1',
  name: 'ko',
  ruleArea: { tracks: true, vias: true, pads: false, copperPour: false, footprints: false },
  source: EMPTY,
  ...over,
});

const track = (x0: number, x1: number, layer = 'F.Cu'): PcbTrack => ({
  start: { x: MM(x0), y: MM(5) },
  end: { x: MM(x1), y: MM(5) },
  width: MM(0.2),
  layer,
  net: 1,
  source: EMPTY,
});

const via = (x: number): PcbVia => ({
  at: { x: MM(x), y: MM(5) },
  size: MM(0.6),
  drill: MM(0.3),
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net: 1,
  source: EMPTY,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'N1'],
  ]),
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
  points: [],
  groups: [],
  source: EMPTY,
  ...over,
});

const BASE: DrcOptions = {
  minClearance: MM(0.05),
  minTrackWidth: MM(0.05),
  minViaDiameter: MM(0.2),
  minViaAnnulus: MM(0.02),
  minThroughHole: MM(0.1),
  minHoleToHole: MM(0.1),
};

const notAllowed = (b: Board, opts: Partial<DrcOptions> = {}) =>
  runDrc(b, { ...BASE, ...opts }).filter((v) => v.code === 'items_not_allowed');

describe('deflatePolygon', () => {
  it('shrinks a square by the offset on every side', () => {
    const out = deflatePolygon(box(0, 0, 10, 10), MM(1));

    expect(Math.min(...out.map((p) => p.x))).toBeCloseTo(MM(1), -3);
    expect(Math.max(...out.map((p) => p.x))).toBeCloseTo(MM(9), -3);
  });

  it('shrinks an anti-clockwise ring inward too, not outward', () => {
    // The inward normal flips with the winding; getting it wrong would grow
    // the area instead of shrinking it, and silently invert every keepout.
    const out = deflatePolygon([...box(0, 0, 10, 10)].reverse(), MM(1));

    expect(Math.max(...out.map((p) => p.x))).toBeCloseTo(MM(9), -3);
  });

  it('leaves a degenerate outline alone rather than losing its area', () => {
    expect(
      deflatePolygon(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        MM(1),
      ),
    ).toHaveLength(2);
  });
});

describe('areasMatching', () => {
  const zones = [
    ruleArea({ uuid: 'u1', name: 'HV_keepout' }),
    ruleArea({ uuid: 'u2', name: 'HV_other' }),
    ruleArea({ uuid: 'u3', name: 'LV' }),
  ];

  it('matches a uuid exactly', () => {
    expect(areasMatching(zones, 'u2')).toHaveLength(1);
  });

  it('matches a name with wildcards, and may select several', () => {
    expect(areasMatching(zones, 'HV_*')).toHaveLength(2);
    expect(areasMatching(zones, 'LV')).toHaveLength(1);
    expect(areasMatching(zones, 'nothing')).toHaveLength(0);
  });
});

describe('the predicates', () => {
  const outline = areaOutline(ruleArea())!;
  const circleAt = (x: number, r: number) => [
    { kind: 'circle' as const, c: { x: MM(x), y: MM(5) }, r: MM(r) },
  ];

  it('intersects when the item overlaps', () => {
    expect(shapesIntersectArea(circleAt(15, 1), outline)).toBe(true);
  });

  it('does not intersect when the item is clear of it', () => {
    expect(shapesIntersectArea(circleAt(5, 1), outline)).toBe(false);
  });

  it('intersects when the item merely straddles the border', () => {
    expect(shapesIntersectArea(circleAt(9.5, 1), outline)).toBe(true);
  });

  it('encloses only when the whole item is inside', () => {
    expect(shapesEnclosedByArea(circleAt(15, 1), outline)).toBe(true);
    // Straddling the border is an intersection but not an enclosure.
    expect(shapesEnclosedByArea(circleAt(9.5, 1), outline)).toBe(false);
    expect(shapesEnclosedByArea(circleAt(5, 1), outline)).toBe(false);
  });

  it('reports nothing as enclosed by an area', () => {
    // An item with no geometry (a footprint, whose courtyard we do not model)
    // must not come back "enclosed" by default.
    expect(shapesEnclosedByArea([], outline)).toBe(false);
  });
});

describe('implicit rules', () => {
  it('builds one disallow rule per rule area, keyed on its uuid', () => {
    const rules = ruleAreaRules(board({ zones: [ruleArea()] }));

    expect(rules).toHaveLength(1);
    expect(rules[0]!.condition).toBe("A.intersectsArea('area-1')");
    expect(rules[0]!.constraints[0]!.disallow).toEqual(['track', 'via']);
    expect(rules[0]!.name).toContain('ko');
  });

  it('builds one rule per layer for a multi-layer area', () => {
    // Upstream gives the rule a layer *set*; a DrcRule names one layer.
    const rules = ruleAreaRules(board({ zones: [ruleArea({ layers: ['F.Cu', 'B.Cu'] })] }));

    expect(rules.map((r) => r.layer)).toEqual(['F.Cu', 'B.Cu']);
  });

  it('skips an area that forbids nothing', () => {
    const none = ruleArea({
      ruleArea: { tracks: false, vias: false, pads: false, copperPour: false, footprints: false },
    });

    expect(ruleAreaRules(board({ zones: [none] }))).toHaveLength(0);
  });

  it('ignores an ordinary copper zone', () => {
    expect(ruleAreaRules(board({ zones: [ruleArea({ ruleArea: undefined })] }))).toHaveLength(0);
  });
});

describe('markers', () => {
  it('reports a track that runs into a keepout', () => {
    const b = board({ zones: [ruleArea()], tracks: [track(12, 18)] });
    const v = notAllowed(b);

    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain('keepout area');
  });

  it('leaves a track that stays clear of it', () => {
    expect(notAllowed(board({ zones: [ruleArea()], tracks: [track(0, 5)] }))).toHaveLength(0);
  });

  it('reports a track that only clips the edge', () => {
    expect(notAllowed(board({ zones: [ruleArea()], tracks: [track(0, 11)] }))).toHaveLength(1);
  });

  it('honours the area flags: a pad-allowing area lets a via through', () => {
    const noVias = ruleArea({
      ruleArea: { tracks: true, vias: false, pads: false, copperPour: false, footprints: false },
    });

    expect(notAllowed(board({ zones: [noVias], vias: [via(15)] }))).toHaveLength(0);
    expect(notAllowed(board({ zones: [ruleArea()], vias: [via(15)] }))).toHaveLength(1);
  });

  it('does not reach a track on a layer the area is not on', () => {
    const b = board({ zones: [ruleArea({ layers: ['B.Cu'] })], tracks: [track(12, 18, 'F.Cu')] });

    expect(notAllowed(b)).toHaveLength(0);
  });

  it('needs a common layer even when the rule names none', () => {
    // A user rule without `(layer …)` applies everywhere, so the layer test
    // has to happen inside the predicate: upstream intersects the area's layer
    // set with the item's and gives up when nothing is shared.
    const b = board({
      zones: [ruleArea({ ruleArea: undefined, layers: ['B.Cu'] })],
      tracks: [track(12, 18, 'F.Cu')],
    });
    const dru = `(version 1)
      (rule "mine" (constraint disallow track) (condition "A.intersectsArea('ko')"))`;

    expect(notAllowed(b, { customRules: parseDrcRules(dru) })).toHaveLength(0);

    // Same board, same rule, area moved onto the track's layer.
    const shared = board({
      zones: [ruleArea({ ruleArea: undefined, layers: ['F.Cu'] })],
      tracks: [track(12, 18, 'F.Cu')],
    });
    expect(notAllowed(shared, { customRules: parseDrcRules(dru) })).toHaveLength(1);
  });

  it('says nothing at all when the board has no rule areas', () => {
    expect(notAllowed(board({ tracks: [track(12, 18)] }))).toHaveLength(0);
  });

  it('lets a user rule reach the same area by name', () => {
    // The same predicate a keepout is built on is available to a hand-written
    // rule, which is the point of routing both through the engine.
    const b = board({ zones: [ruleArea({ ruleArea: undefined })], tracks: [track(12, 18)] });
    const dru = `(version 1)
      (rule "mine" (constraint disallow track) (condition "A.intersectsArea('ko')"))`;

    expect(notAllowed(b, { customRules: parseDrcRules(dru) })).toHaveLength(1);
  });

  it('reads insideArea as touching, not as containment', () => {
    // insideArea is upstream's deprecated spelling of intersectsArea. A track
    // that only clips the edge must still match.
    const b = board({ zones: [ruleArea({ ruleArea: undefined })], tracks: [track(0, 11)] });
    const dru = `(version 1)
      (rule "mine" (constraint disallow track) (condition "A.insideArea('ko')"))`;

    expect(notAllowed(b, { customRules: parseDrcRules(dru) })).toHaveLength(1);
  });

  it('distinguishes enclosedByArea from intersectsArea', () => {
    const b = (x0: number, x1: number) =>
      board({ zones: [ruleArea({ ruleArea: undefined })], tracks: [track(x0, x1)] });
    const dru = `(version 1)
      (rule "mine" (constraint disallow track) (condition "A.enclosedByArea('ko')"))`;

    // Wholly inside → enclosed. Straddling the border → not.
    expect(notAllowed(b(12, 18), { customRules: parseDrcRules(dru) })).toHaveLength(1);
    expect(notAllowed(b(0, 11), { customRules: parseDrcRules(dru) })).toHaveLength(0);
  });
});
