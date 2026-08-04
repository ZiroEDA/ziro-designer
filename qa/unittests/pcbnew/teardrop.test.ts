// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Teardrops (TEARDROP_MANAGER): the copper flare where a thin track enters a
 * via, a pad, or a fatter track.
 */
import { describe, it, expect } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  addTeardropsOnTracks,
  computeChordThroughShape,
  computeTeardropPolygon,
  defaultTeardropParameters,
  defaultTeardropParametersList,
  getWidth,
  isRound,
  setTeardropPriorities,
  teardropZones,
  updateTeardrops,
  MAGIC_TEARDROP_ZONE_ID,
  type Teardrop,
  type TeardropParameters,
} from '@ziroeda/pcbnew/src/teardrop.js';
import type {
  Board,
  PcbFootprint,
  PcbPad,
  PcbTrack,
  PcbVia,
  PcbZone,
} from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };
const MM = (n: number): number => mmToIU(n);

const via = (at: { x: number; y: number }, net = 1, size = MM(0.8)): PcbVia => ({
  at,
  size,
  drill: MM(0.4),
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net,
  source: EMPTY,
});

const track = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  width = MM(0.25),
  net = 1,
): PcbTrack => ({ start, end, width, layer: 'F.Cu', net, source: EMPTY });

const pad = (at: { x: number; y: number }, over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'circle',
  at,
  angle: 0,
  size: { x: MM(1.5), y: MM(1.5) },
  layers: ['F.Cu'],
  net: 1,
  source: EMPTY,
  ...over,
});

const footprint = (pads: PcbPad[]): PcbFootprint => ({
  lib: 'R',
  at: { x: 0, y: 0 },
  angle: 0,
  layer: 'F.Cu',
  pads,
  shapes: [],
  texts: [],
  models: [],
  source: EMPTY,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [],
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
  groups: [],
  source: EMPTY,
  ...over,
});

const enabled = (over: Partial<TeardropParameters> = {}): TeardropParameters => ({
  ...defaultTeardropParameters(),
  enabled: true,
  ...over,
});

/** Signed area doubled; the sign tells the winding. */
const area2 = (pts: { x: number; y: number }[]): number => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    a += pts[j]!.x * pts[i]!.y - pts[i]!.x * pts[j]!.y;
  return a;
};

/** Do two closed segments cross away from their shared endpoints? */
const crosses = (
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): boolean => {
  const d = (
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: { x: number; y: number },
  ) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const s1 = Math.sign(d(a1, a2, b1));
  const s2 = Math.sign(d(a1, a2, b2));
  const s3 = Math.sign(d(b1, b2, a1));
  const s4 = Math.sign(d(b1, b2, a2));
  return s1 !== 0 && s2 !== 0 && s3 !== 0 && s4 !== 0 && s1 !== s2 && s3 !== s4;
};

/**
 * Every pair of non-adjacent edges misses. A teardrop that folds into a bowtie
 * still has a plausible bounding box and a plausible corner count, so nothing
 * short of this catches a wrong C/E assignment.
 */
const isSimplePolygon = (pts: { x: number; y: number }[]): boolean => {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges (including the wrap-around pair).
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (crosses(pts[i]!, pts[(i + 1) % n]!, pts[j]!, pts[(j + 1) % n]!)) return false;
    }
  }
  return true;
};

const bbox = (pts: { x: number; y: number }[]) => ({
  minX: Math.min(...pts.map((p) => p.x)),
  maxX: Math.max(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxY: Math.max(...pts.map((p) => p.y)),
});

describe('teardrop item queries', () => {
  it('takes a via width from its size and a pad width from its smaller side', () => {
    expect(getWidth(via({ x: 0, y: 0 }))).toBe(MM(0.8));
    expect(getWidth(pad({ x: 0, y: 0 }, { size: { x: MM(3), y: MM(1) } }))).toBe(MM(1));
  });

  it('counts an oval pad as round only when it is really a circle', () => {
    expect(isRound(via({ x: 0, y: 0 }))).toBe(true);
    expect(isRound(pad({ x: 0, y: 0 }, { shape: 'circle' }))).toBe(true);
    expect(isRound(pad({ x: 0, y: 0 }, { shape: 'oval', size: { x: MM(2), y: MM(2) } }))).toBe(
      true,
    );
    expect(isRound(pad({ x: 0, y: 0 }, { shape: 'oval', size: { x: MM(2), y: MM(1) } }))).toBe(
      false,
    );
    expect(isRound(pad({ x: 0, y: 0 }, { shape: 'rect' }))).toBe(false);
  });
});

describe('computeTeardropPolygon', () => {
  const V = via({ x: 0, y: 0 });

  it('builds a closed flare spanning the track and the via', () => {
    // A track leaving the via to the east, so its start is inside the via.
    const T = track({ x: 0, y: 0 }, { x: MM(5), y: 0 });
    const corners = computeTeardropPolygon(enabled(), T, V, V.at);

    expect(corners).not.toBeNull();
    // A, B, C, D, E for the straight-edged shape.
    expect(corners!).toHaveLength(5);

    const b = bbox(corners!);
    // It reaches back past the via centre and forward along the track.
    expect(b.minX).toBeLessThan(0);
    expect(b.maxX).toBeGreaterThan(0);
    // ...and never wider than the via.
    expect(b.maxY - b.minY).toBeLessThanOrEqual(MM(0.8));
  });

  it('does not fold into a bowtie', () => {
    // A, B, C, D, E in walk order: C must sit on B's side of the track axis and
    // E on A's, or the flanks cross over each other.
    const T = track({ x: 0, y: 0 }, { x: MM(5), y: 0 });
    const corners = computeTeardropPolygon(enabled(), T, V, V.at)!;

    const [A, B, C, , E] = corners;
    expect(Math.sign(C!.y)).toBe(Math.sign(B!.y));
    expect(Math.sign(E!.y)).toBe(Math.sign(A!.y));
    expect(isSimplePolygon(corners)).toBe(true);
  });

  it('stays simple with curved edges, and on a rectangular pad', () => {
    const T = track({ x: 0, y: 0 }, { x: MM(5), y: 0 });
    const P = pad({ x: 0, y: 0 }, { shape: 'rect', size: { x: MM(2), y: MM(1) } });

    expect(
      isSimplePolygon(computeTeardropPolygon(enabled({ curvedEdges: true }), T, V, V.at)!),
    ).toBe(true);
    expect(isSimplePolygon(computeTeardropPolygon(enabled(), T, P, P.at)!)).toBe(true);
    expect(
      isSimplePolygon(computeTeardropPolygon(enabled({ curvedEdges: true }), T, P, P.at)!),
    ).toBe(true);
  });

  it('stays simple for a track entering off the pad centre', () => {
    // Offset by 0.3 mm on a 0.8 mm via: enough to trip the symmetric-anchor
    // rebuild, which is where a sign slip folds C and E into a bowtie.
    const T = track({ x: 0, y: MM(0.3) }, { x: MM(5), y: MM(0.3) });
    const corners = computeTeardropPolygon(enabled(), T, V, V.at);

    expect(corners).not.toBeNull();
    expect(isSimplePolygon(corners!)).toBe(true);
  });

  it('keeps the same winding whichever side the track leaves from', () => {
    const east = computeTeardropPolygon(
      enabled(),
      track({ x: 0, y: 0 }, { x: MM(5), y: 0 }),
      V,
      V.at,
    );
    const west = computeTeardropPolygon(
      enabled(),
      track({ x: 0, y: 0 }, { x: -MM(5), y: 0 }),
      V,
      V.at,
    );

    expect(east).not.toBeNull();
    expect(west).not.toBeNull();
    expect(Math.sign(area2(east!))).toBe(Math.sign(area2(west!)));
  });

  it('mirrors the shape when the track direction is mirrored', () => {
    const east = computeTeardropPolygon(
      enabled(),
      track({ x: 0, y: 0 }, { x: MM(5), y: 0 }),
      V,
      V.at,
    )!;
    const west = computeTeardropPolygon(
      enabled(),
      track({ x: 0, y: 0 }, { x: -MM(5), y: 0 }),
      V,
      V.at,
    )!;

    const be = bbox(east);
    const bw = bbox(west);

    // Same extents, reflected through the via centre.
    expect(bw.maxX).toBe(-be.minX);
    expect(bw.minX).toBe(-be.maxX);
  });

  it('honours the max-length clamp', () => {
    // best_length_ratio 0.5 of a 0.8 mm via is 0.4 mm; clamp to 0.1 mm.
    const long = computeTeardropPolygon(
      enabled(),
      track({ x: 0, y: 0 }, { x: MM(5), y: 0 }),
      V,
      V.at,
    )!;
    const short = computeTeardropPolygon(
      enabled({ tdMaxLen: MM(0.1) }),
      track({ x: 0, y: 0 }, { x: MM(5), y: 0 }),
      V,
      V.at,
    )!;

    expect(bbox(short).maxX).toBeLessThan(bbox(long).maxX);
  });

  it('honours the max-width clamp', () => {
    const wide = computeTeardropPolygon(
      enabled(),
      track({ x: 0, y: 0 }, { x: MM(5), y: 0 }),
      V,
      V.at,
    )!;
    const narrow = computeTeardropPolygon(
      enabled({ tdMaxWidth: MM(0.4) }),
      track({ x: 0, y: 0 }, { x: MM(5), y: 0 }),
      V,
      V.at,
    )!;

    const bw = bbox(wide);
    const bn = bbox(narrow);
    expect(bn.maxY - bn.minY).toBeLessThan(bw.maxY - bw.minY);
    expect(bn.maxY - bn.minY).toBeLessThanOrEqual(MM(0.4));
  });

  it('emits a tessellated curve for curved edges, not five corners', () => {
    const straight = computeTeardropPolygon(
      enabled(),
      track({ x: 0, y: 0 }, { x: MM(5), y: 0 }),
      V,
      V.at,
    )!;
    const curved = computeTeardropPolygon(
      enabled({ curvedEdges: true }),
      track({ x: 0, y: 0 }, { x: MM(5), y: 0 }),
      V,
      V.at,
    )!;

    expect(straight).toHaveLength(5);
    expect(curved.length).toBeGreaterThan(straight.length);
    // Two Beziers plus point D, and the curve stays inside the straight hull's
    // reach: it is a flare, not an overshoot.
    expect(bbox(curved).maxX).toBeLessThanOrEqual(bbox(straight).maxX);
  });

  it('refuses a track that lies entirely outside the via', () => {
    const away = track({ x: MM(5), y: MM(5) }, { x: MM(9), y: MM(5) });
    expect(computeTeardropPolygon(enabled(), away, V, V.at)).toBeNull();
  });

  it('builds against a rectangular pad too', () => {
    const P = pad({ x: 0, y: 0 }, { shape: 'rect', size: { x: MM(2), y: MM(1) } });
    const corners = computeTeardropPolygon(
      enabled(),
      track({ x: 0, y: 0 }, { x: MM(5), y: 0 }),
      P,
      P.at,
    );

    expect(corners).not.toBeNull();
    // The width comes from the pad's smaller side, so it can never exceed 1 mm.
    const b = bbox(corners!);
    expect(b.maxY - b.minY).toBeLessThanOrEqual(MM(1));
  });
});

describe('computeChordThroughShape', () => {
  const V = via({ x: 0, y: 0 }, 1, MM(1));

  it('measures the full diameter for a track entering through the centre', () => {
    const chord = computeChordThroughShape(track({ x: 0, y: 0 }, { x: MM(5), y: 0 }), V, {
      x: 0,
      y: 0,
    });
    // The polygonal circle is inscribed, so the chord is a shade under 1 mm.
    expect(chord).toBeGreaterThan(MM(0.95));
    expect(chord).toBeLessThanOrEqual(MM(1));
  });

  it('measures a short chord for a track grazing the rim', () => {
    // A track that clips the top of the via: its inside end is near the rim.
    const grazing = track({ x: 0, y: MM(0.48) }, { x: MM(5), y: MM(0.48) });
    const chord = computeChordThroughShape(grazing, V, { x: 0, y: MM(0.48) });

    expect(chord).toBeLessThan(MM(0.35));
  });
});

describe('updateTeardrops', () => {
  const list = () => {
    const l = defaultTeardropParametersList();
    l.round.enabled = true;
    l.rect.enabled = true;
    return l;
  };

  it('flares a track where it lands on a via', () => {
    const b = board({
      vias: [via({ x: MM(10), y: MM(10) })],
      tracks: [track({ x: MM(10), y: MM(10) }, { x: MM(20), y: MM(10) })],
    });

    const tds = updateTeardrops(b, { list: list() });

    expect(tds).toHaveLength(1);
    expect(tds[0]!.type).toBe('viapad');
    expect(tds[0]!.layer).toBe('F.Cu');
    expect(tds[0]!.net).toBe(1);
    expect(tds[0]!.corners.length).toBeGreaterThanOrEqual(5);
  });

  it('produces nothing when the parameters are disabled', () => {
    const b = board({
      vias: [via({ x: MM(10), y: MM(10) })],
      tracks: [track({ x: MM(10), y: MM(10) }, { x: MM(20), y: MM(10) })],
    });

    expect(updateTeardrops(b, { list: defaultTeardropParametersList() })).toHaveLength(0);
  });

  it('skips a track as thick as the via it meets', () => {
    const b = board({
      vias: [via({ x: MM(10), y: MM(10) })],
      // 0.8 mm track into a 0.8 mm via: nothing to flare.
      tracks: [track({ x: MM(10), y: MM(10) }, { x: MM(20), y: MM(10) }, MM(0.8))],
    });

    expect(updateTeardrops(b, { list: list() })).toHaveLength(0);
  });

  it('flares both ends where a track crosses clean through a via', () => {
    const b = board({
      vias: [via({ x: MM(10), y: MM(10) })],
      tracks: [track({ x: MM(5), y: MM(10) }, { x: MM(15), y: MM(10) })],
    });

    const tds = updateTeardrops(b, { list: list() });

    // The pass-through case: one from each end back to the via centre.
    expect(tds.length).toBeGreaterThanOrEqual(2);
  });

  it('reaches pads through their footprints', () => {
    const P = pad({ x: MM(10), y: MM(10) });
    const b = board({
      footprints: [footprint([P])],
      tracks: [track({ x: MM(10), y: MM(10) }, { x: MM(20), y: MM(10) })],
    });

    expect(updateTeardrops(b, { list: list() })).toHaveLength(1);
  });

  it('leaves a pad alone when a filled zone already connects it', () => {
    const P = pad({ x: MM(10), y: MM(10) });
    const flood: PcbZone = {
      net: 1,
      layers: ['F.Cu'],
      outline: [],
      fills: [
        {
          layer: 'F.Cu',
          polys: [
            [
              { x: 0, y: 0 },
              { x: MM(40), y: 0 },
              { x: MM(40), y: MM(40) },
              { x: 0, y: MM(40) },
            ],
          ],
        },
      ],
      padConnection: 'thermal',
      source: EMPTY,
    };
    const b = board({
      footprints: [footprint([P])],
      tracks: [track({ x: MM(10), y: MM(10) }, { x: MM(20), y: MM(10) })],
      zones: [flood],
    });

    expect(updateTeardrops(b, { list: list() })).toHaveLength(0);

    // ...unless the parameters say to build them anyway.
    const l = list();
    l.round.tdOnPadsInZones = true;
    expect(updateTeardrops(b, { list: l })).toHaveLength(1);
  });

  it('honours the target filters', () => {
    const b = board({
      vias: [via({ x: MM(10), y: MM(10) })],
      tracks: [track({ x: MM(10), y: MM(10) }, { x: MM(20), y: MM(10) })],
    });

    const l = list();
    l.targetVias = false;
    expect(updateTeardrops(b, { list: l })).toHaveLength(0);
  });

  it('skips a non-round pad when only round shapes are targeted', () => {
    const P = pad({ x: MM(10), y: MM(10) }, { shape: 'rect', size: { x: MM(2), y: MM(2) } });
    const b = board({
      footprints: [footprint([P])],
      tracks: [track({ x: MM(10), y: MM(10) }, { x: MM(20), y: MM(10) })],
    });

    expect(updateTeardrops(b, { list: list() })).toHaveLength(1);

    const l = list();
    l.useRoundShapesOnly = true;
    expect(updateTeardrops(b, { list: l })).toHaveLength(0);
  });
});

describe('addTeardropsOnTracks', () => {
  it('flares the junction where a thin track meets a fat one', () => {
    const b = board({
      tracks: [
        track({ x: 0, y: 0 }, { x: MM(10), y: 0 }, MM(0.2)),
        track({ x: MM(10), y: 0 }, { x: MM(20), y: 0 }, MM(1.0)),
      ],
    });

    const l = defaultTeardropParametersList();
    l.track.enabled = true;
    l.targetTrack2Track = true;

    const tds = updateTeardrops(b, { list: l });

    expect(tds).toHaveLength(1);
    expect(tds[0]!.type).toBe('trackend');
  });

  it('leaves two tracks of the same width alone', () => {
    const b = board({
      tracks: [
        track({ x: 0, y: 0 }, { x: MM(10), y: 0 }, MM(0.5)),
        track({ x: MM(10), y: 0 }, { x: MM(20), y: 0 }, MM(0.5)),
      ],
    });

    const l = defaultTeardropParametersList();
    l.track.enabled = true;

    expect(addTeardropsOnTracks(b, l, MM(0.01), MM(0.005))).toHaveLength(0);
  });

  it('leaves widths within the filter threshold alone', () => {
    // 0.5 / 0.9 = 0.55, which is still under 0.6: no teardrop.
    const b = board({
      tracks: [
        track({ x: 0, y: 0 }, { x: MM(10), y: 0 }, MM(0.5)),
        track({ x: MM(10), y: 0 }, { x: MM(20), y: 0 }, MM(0.55)),
      ],
    });

    const l = defaultTeardropParametersList();
    l.track.enabled = true;

    expect(addTeardropsOnTracks(b, l, MM(0.01), MM(0.005))).toHaveLength(0);
  });

  it('yields to a via sitting at the junction', () => {
    const b = board({
      vias: [via({ x: MM(10), y: 0 }, 1, MM(1.2))],
      tracks: [
        track({ x: 0, y: 0 }, { x: MM(10), y: 0 }, MM(0.2)),
        track({ x: MM(10), y: 0 }, { x: MM(20), y: 0 }, MM(1.0)),
      ],
    });

    const l = defaultTeardropParametersList();
    l.track.enabled = true;

    expect(addTeardropsOnTracks(b, l, MM(0.01), MM(0.005))).toHaveLength(0);
  });
});

describe('setTeardropPriorities', () => {
  const td = (layer: string, outlineArea: number): Teardrop => ({
    type: 'viapad',
    layer,
    net: 1,
    corners: [],
    priority: 0,
    outlineArea,
  });

  it('counts up from the magic base within each layer, largest first', () => {
    const tds = [td('F.Cu', 10), td('B.Cu', 30), td('F.Cu', 50), td('B.Cu', 20)];

    setTeardropPriorities(tds);

    const byLayer = (l: string) =>
      tds.filter((t) => t.layer === l).map((t) => [t.outlineArea, t.priority]);

    expect(byLayer('B.Cu')).toEqual([
      [30, MAGIC_TEARDROP_ZONE_ID],
      [20, MAGIC_TEARDROP_ZONE_ID + 1],
    ]);
    expect(byLayer('F.Cu')).toEqual([
      [50, MAGIC_TEARDROP_ZONE_ID],
      [10, MAGIC_TEARDROP_ZONE_ID + 1],
    ]);
  });
});

describe('teardropZones', () => {
  it('fills each zone with its own outline and marks it as a teardrop', () => {
    const b = board({
      vias: [via({ x: MM(10), y: MM(10) })],
      tracks: [track({ x: MM(10), y: MM(10) }, { x: MM(20), y: MM(10) })],
    });

    const l = defaultTeardropParametersList();
    l.round.enabled = true;

    const zones = teardropZones(updateTeardrops(b, { list: l }));

    expect(zones).toHaveLength(1);
    expect(zones[0]!.teardropType).toBe('viapad');
    expect(zones[0]!.filled).toBe(true);
    expect(zones[0]!.priority).toBe(MAGIC_TEARDROP_ZONE_ID);
    // The fill is the outline, not a re-poured shape.
    expect(zones[0]!.fills[0]!.polys[0]).toEqual(zones[0]!.outline);
  });
});
