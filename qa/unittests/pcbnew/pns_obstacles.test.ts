// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a route has to get past: a board turned into obstacle hulls.
 * Counterpart: the part of `PNS::NODE` the walkaround driver asks for.
 *
 * This is where the board finally meets the router, and the rules that matter
 * are about what counts as an obstacle rather than about geometry:
 *
 * - **A net is not an obstacle to itself.** A track runs into its own net
 *   freely — that is what arriving at a pad looks like — so filtering by net is
 *   the difference between a router that can finish a connection and one that
 *   can only ever approach it.
 * - **A via blocks every layer it spans**, unlike a track, which blocks only
 *   its own.
 *
 * The last group routes a real board end to end, because the point of the whole
 * exercise is that a track bends round the copper that is in its way.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { boardObstacleHulls } from '@ziroeda/pcbnew/src/router/pns_obstacles.js';
import { routeShortest } from '@ziroeda/pcbnew/src/router/pns_walkaround.js';
import { pointInside, pointOnEdge } from '@ziroeda/pcbnew/src/router/pns_chain.js';
import type { Board, PcbFootprint, PcbTrack, PcbVia } from '@ziroeda/pcbnew/src/types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const MM = (n: number): number => mmToIU(n);
const P = (x: number, y: number): Vec2 => ({ x: MM(x), y: MM(y) });
const EMPTY = { kind: 'list' as const, items: [] };

const track = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  net: number,
  layer = 'F.Cu',
): PcbTrack => ({
  start: P(x1, y1),
  end: P(x2, y2),
  width: MM(0.25),
  layer,
  net,
  source: EMPTY,
});

const via = (x: number, y: number, net: number): PcbVia => ({
  kind: 'through',
  at: P(x, y),
  size: MM(0.8),
  drill: MM(0.4),
  net,
  layers: ['F.Cu', 'B.Cu'],
  source: EMPTY,
});

const footprintWith = (pads: PcbFootprint['pads']): PcbFootprint =>
  ({
    ref: 'U1',
    value: '',
    at: P(0, 0),
    angle: 0,
    layer: 'F.Cu',
    pads,
    shapes: [],
    texts: [],
    source: EMPTY,
  }) as unknown as PcbFootprint;

const pad = (x: number, y: number, net: number, shape = 'circle', angle = 0) =>
  ({
    number: '1',
    shape,
    at: P(x, y),
    angle,
    size: { x: MM(1), y: MM(0.6) },
    layers: ['F.Cu'],
    net,
    source: EMPTY,
  }) as unknown as PcbFootprint['pads'][number];

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'A'],
    [2, 'B'],
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

const QUERY = { net: 1, layer: 'F.Cu', width: MM(0.25), clearance: MM(0.2) };

describe('a net is not an obstacle to itself', () => {
  it('leaves out copper on the net being routed', () => {
    // Otherwise a track could never reach the pad it is being drawn to.
    const b = board({ tracks: [track(20, 0, 20, 40, 1)] });

    expect(boardObstacleHulls(b, QUERY)).toEqual([]);
  });

  it('includes copper on any other net', () => {
    const b = board({ tracks: [track(20, 0, 20, 40, 2)] });

    expect(boardObstacleHulls(b, QUERY)).toHaveLength(1);
  });

  it('treats unassigned copper as foreign', () => {
    // Net 0 is the absence of a net, not membership of the one being routed.
    const b = board({ tracks: [track(20, 0, 20, 40, 0)] });

    expect(boardObstacleHulls(b, QUERY)).toHaveLength(1);
  });

  it('lets unassigned copper claim the exemption from unassigned copper', () => {
    // Routing net 0 — a track drawn on no net at all, which pcbnew allows.
    // `collideSimple`'s third term, `aHead->Net()`, is a **null-pointer** test,
    // not a net-code test: `NET_HANDLE` is `void*`, and KiCad hands net code 0
    // a real `NETINFO_ITEM` via `NETINFO_LIST::OrphanedItem()`. The items that
    // term excludes are the net-less synthetic solids built for keepouts and
    // the board outline, not net-0 copper. So two unconnected traces are on the
    // same net as each other and do not collide.
    const b = board({ tracks: [track(20, 0, 20, 40, 0)] });

    expect(boardObstacleHulls(b, { ...QUERY, net: 0 })).toEqual([]);
  });

  it('still blocks a net-0 route with ordinary copper', () => {
    const b = board({ tracks: [track(20, 0, 20, 40, 2)] });

    expect(boardObstacleHulls(b, { ...QUERY, net: 0 })).toHaveLength(1);
  });
});

describe('which layer an obstacle blocks', () => {
  it('is only its own, for a track', () => {
    const b = board({ tracks: [track(20, 0, 20, 40, 2, 'B.Cu')] });

    expect(boardObstacleHulls(b, QUERY)).toEqual([]);
  });

  it('is every layer it spans, for a via', () => {
    // A via in the way is in the way whichever side of the board you are on.
    const b = board({ vias: [via(10, 20, 2)] });

    expect(boardObstacleHulls(b, QUERY)).toHaveLength(1);
    expect(boardObstacleHulls(b, { ...QUERY, layer: 'B.Cu' })).toHaveLength(1);
  });

  it('is the pad’s own layers', () => {
    const b = board({ footprints: [footprintWith([pad(5, 5, 2)])] });

    expect(boardObstacleHulls(b, QUERY)).toHaveLength(1);
    expect(boardObstacleHulls(b, { ...QUERY, layer: 'B.Cu' })).toEqual([]);
  });
});

describe('every kind of copper becomes a hull', () => {
  it('counts tracks, arcs, vias and pads alike', () => {
    const b = board({
      tracks: [track(0, 0, 10, 0, 2)],
      arcs: [
        {
          start: P(20, 0),
          mid: P(25, 5),
          end: P(30, 0),
          width: MM(0.25),
          layer: 'F.Cu',
          net: 2,
          source: EMPTY,
        },
      ],
      vias: [via(40, 0, 2)],
      footprints: [footprintWith([pad(50, 0, 2)])],
    });

    expect(boardObstacleHulls(b, QUERY)).toHaveLength(4);
  });

  it('grows each by the clearance and half the routed width', () => {
    // The arithmetic the whole layer rests on: a centreline touching the hull
    // leaves an edge exactly at the clearance.
    const b = board({ vias: [via(0, 0, 2)] });
    const [hull] = boardObstacleHulls(b, QUERY);
    const reach = Math.max(...hull!.map((p) => p.x));

    // 0.4 via radius + 0.2 clearance + 0.125 half the routed track.
    expect(reach).toBe(MM(0.725));
  });

  it('widens with the track being routed', () => {
    const b = board({ vias: [via(0, 0, 2)] });
    const thin = Math.max(...boardObstacleHulls(b, QUERY)[0]!.map((p) => p.x));
    const fat = Math.max(...boardObstacleHulls(b, { ...QUERY, width: MM(1) })[0]!.map((p) => p.x));

    expect(fat - thin).toBe(MM(0.375));
  });
});

describe('pads', () => {
  it('gives a round pad an octagon and a rectangular one a box', () => {
    // Not interchangeable: a round pad's true offset is a circle, which the
    // octagon approximates, while a rectangle's corners stay square because
    // that is the safe side to be wrong on.
    const round = board({ footprints: [footprintWith([pad(5, 5, 2, 'circle')])] });
    const rect = board({ footprints: [footprintWith([pad(5, 5, 2, 'rect')])] });

    expect(boardObstacleHulls(round, QUERY)[0]).toHaveLength(8);
    expect(boardObstacleHulls(rect, QUERY)[0]).toHaveLength(4);
  });

  it('grows a round pad by the clearance and half the routed width', () => {
    // 0.5 pad radius + 0.2 clearance + 0.125 half the routed track.
    const b = board({ footprints: [footprintWith([pad(0, 0, 2, 'circle')])] });
    const hull = boardObstacleHulls(b, QUERY)[0]!;

    expect(Math.max(...hull.map((p) => p.x))).toBe(MM(0.825));
  });

  it('follows a rotated pad’s real extent, not its unrotated box', () => {
    // A 1 x 0.6 pad turned on its side is 0.6 wide and 1 tall. Taking the
    // box as drawn would leave the hull short on one axis and long on the
    // other — short is the dangerous direction.
    const b = board({ footprints: [footprintWith([pad(0, 0, 2, 'rect', 90)])] });
    const hull = boardObstacleHulls(b, QUERY)[0]!;
    const width = Math.max(...hull.map((p) => p.x)) - Math.min(...hull.map((p) => p.x));
    const height = Math.max(...hull.map((p) => p.y)) - Math.min(...hull.map((p) => p.y));

    // 0.6 across and 1 tall, each grown by 0.325 on both sides.
    expect(width).toBe(MM(0.6) + 2 * MM(0.325));
    expect(height).toBe(MM(1) + 2 * MM(0.325));
  });
});

describe('routing a real board', () => {
  // A via and a track of another net, straddling the route.
  const B = board({ tracks: [track(20, 0, 20, 40, 2)], vias: [via(10, 20, 2)] });
  const hulls = boardObstacleHulls(B, QUERY);

  const staysClear = (path: readonly Vec2[]): boolean => {
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      for (let t = 0; t <= 30; t++) {
        const p = {
          x: Math.round(a.x + ((b.x - a.x) * t) / 30),
          y: Math.round(a.y + ((b.y - a.y) * t) / 30),
        };
        for (const h of hulls) if (pointInside(h, p) && !pointOnEdge(h, p)) return false;
      }
    }
    return true;
  };

  it('bends the route round both of them', () => {
    const result = routeShortest([P(0, 20), P(40, 20)], hulls);

    expect(result.status).toBe('done');
    expect(staysClear(result.path)).toBe(true);
  });

  it('keeps the endpoints the user asked for', () => {
    const { path } = routeShortest([P(0, 20), P(40, 20)], hulls);

    expect(path[0]).toEqual(P(0, 20));
    expect(path[path.length - 1]).toEqual(P(40, 20));
  });

  it('leaves a route alone when the same copper is on its own net', () => {
    // The same board, routed as net 2: nothing is in the way at all.
    const own = boardObstacleHulls(B, { ...QUERY, net: 2 });

    expect(own).toEqual([]);
    expect(routeShortest([P(0, 20), P(40, 20)], own).path).toEqual([P(0, 20), P(40, 20)]);
  });
});
