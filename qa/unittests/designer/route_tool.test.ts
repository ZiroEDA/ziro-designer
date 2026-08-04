// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the Route Single Track tool decides when the cursor moves.
 * Counterpart: `ROUTER_TOOL`'s posture, plus the walkaround run over it.
 *
 * This was the last untested link in the router chain. Hulls, chain operations,
 * walkaround and its driver each have a suite; the glue deciding *when* to use
 * them had none, because it lived in a `.tsx` the qa package cannot import.
 * That is exactly the seam where a chain of individually-correct pieces goes
 * wrong — the bug fixed in #372 survived two PRs in precisely that gap.
 *
 * The behaviour worth pinning is the **fallback**. When no clear route exists
 * the tool draws the direct path rather than nothing, and that has never been
 * asserted anywhere: a router that goes blank when the board gets tight is one
 * people stop trusting, and it would have failed silently.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { posturePath, routedPath } from '@ziroeda/designer/src/editors/pcb/route_tool.js';
import { boardObstacleHulls } from '@ziroeda/pcbnew/src/router/pns_obstacles.js';
import { pointInside, pointOnEdge } from '@ziroeda/pcbnew/src/router/pns_chain.js';
import type { Board, PcbTrack, PcbVia } from '@ziroeda/pcbnew/src/types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const MM = (n: number): number => mmToIU(n);
const P = (x: number, y: number): Vec2 => ({ x: MM(x), y: MM(y) });
const EMPTY = { kind: 'list' as const, items: [] };

const track = (x1: number, y1: number, x2: number, y2: number, net: number): PcbTrack => ({
  start: P(x1, y1),
  end: P(x2, y2),
  width: MM(0.25),
  layer: 'F.Cu',
  net,
  source: EMPTY,
});

const via = (x: number, y: number, net: number, diameter = 0.8): PcbVia => ({
  kind: 'through',
  at: P(x, y),
  size: MM(diameter),
  drill: MM(diameter / 2),
  net,
  layers: ['F.Cu', 'B.Cu'],
  source: EMPTY,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [{ id: 0, name: 'F.Cu', kind: 'signal' }],
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
  groups: [],
  source: EMPTY,
  ...over,
});

const ctx = (b: Board, over: Partial<Parameters<typeof routedPath>[2]> = {}) => ({
  board: b,
  net: 1,
  layer: 'F.Cu',
  width: MM(0.25),
  clearance: MM(0.2),
  ...over,
});

describe('the 45° posture', () => {
  it('runs along the dominant axis, then cuts the diagonal', () => {
    // 30 across and 10 down: 20 of straight run, then the 45° into the cursor.
    expect(posturePath(P(0, 0), P(30, 10))).toEqual([P(20, 0), P(30, 10)]);
  });

  it('leads with whichever axis dominates, not a fixed one', () => {
    // Leading with x on a mostly-vertical move would set the track off in
    // visibly the wrong direction before turning back.
    expect(posturePath(P(0, 0), P(10, 30))).toEqual([P(0, 20), P(10, 30)]);
  });

  it('leaves an axis-aligned move alone', () => {
    expect(posturePath(P(0, 0), P(30, 0))).toEqual([P(30, 0)]);
    expect(posturePath(P(0, 0), P(0, 30))).toEqual([P(0, 30)]);
  });

  it('leaves an exact diagonal alone', () => {
    expect(posturePath(P(0, 0), P(30, 30))).toEqual([P(30, 30)]);
  });

  it('works in every quadrant', () => {
    expect(posturePath(P(0, 0), P(-30, -10))).toEqual([P(-20, 0), P(-30, -10)]);
    expect(posturePath(P(0, 0), P(-10, 30))).toEqual([P(0, 20), P(-10, 30)]);
  });
});

describe('when avoidance applies', () => {
  const blocked = board({ vias: [via(15, 0, 2)] });

  it('bends the route round copper in the way', () => {
    const path = routedPath(P(0, 0), P(30, 0), ctx(blocked));
    const hulls = boardObstacleHulls(blocked, {
      net: 1,
      layer: 'F.Cu',
      width: MM(0.25),
      clearance: MM(0.2),
    });

    // More points than the direct run, and none of them through the via.
    expect(path.length).toBeGreaterThan(1);
    for (const p of path)
      for (const h of hulls) expect(pointInside(h, p) && !pointOnEdge(h, p)).toBe(false);
  });

  it('still finishes where the cursor is', () => {
    // A detour that does not arrive is not a route.
    const path = routedPath(P(0, 0), P(30, 0), ctx(blocked));

    expect(path[path.length - 1]).toEqual(P(30, 0));
  });
});

describe('when it falls back to the direct path', () => {
  // The behaviour that had no test anywhere, and fails silently when wrong.
  const direct = posturePath(P(0, 0), P(30, 10));

  it('does so when no clearance is configured', () => {
    // Zero clearance means the board has not asked for avoidance; drawing the
    // posture path is the honest answer rather than pretending to avoid at 0.
    const b = board({ vias: [via(15, 0, 2)] });

    expect(routedPath(P(0, 0), P(30, 10), ctx(b, { clearance: 0 }))).toEqual(direct);
  });

  it('does so when nothing is on the layer to avoid', () => {
    expect(routedPath(P(0, 0), P(30, 10), ctx(board()))).toEqual(direct);
  });

  it('does so when everything in the way is on the route’s own net', () => {
    const ownNet = board({ vias: [via(15, 0, 1)] });

    expect(routedPath(P(0, 0), P(30, 10), ctx(ownNet))).toEqual(direct);
  });

  it('does so rather than drawing nothing when the route is boxed in', () => {
    // The route starts *inside* another net's via, which walkaround refuses.
    // A tool that went blank here is one people stop trusting; DRC will flag
    // the direct line instead.
    const boxedIn = board({ vias: [via(0, 0, 2)] });
    const path = routedPath(P(0, 0), P(30, 10), ctx(boxedIn));

    expect(path).toEqual(direct);
    expect(path.length).toBeGreaterThan(0);
  });

  it('discards a half-finished detour rather than committing it', () => {
    // The case the previous test cannot reach. Refusing at the first step
    // leaves the path untouched, so returning it *or* the direct path looks
    // identical; here the walk gets several corners in before giving up, and a
    // partial detour that stops short of the cursor is worse than the straight
    // line. This obstacle field was found by search — a crowded start is what
    // it takes.
    const crowded = board({
      vias: [via(2.0, 9.88, 2, 3.5), via(12.82, 13.46, 2, 4.1), via(4.32, 10.88, 2, 2.53)],
    });

    const from = P(0, 10);
    const to = P(40, 10);
    const straight = posturePath(from, to);

    expect(routedPath(from, to, ctx(crowded))).toEqual(straight);
  });
});

describe('tidying the walk before it is drawn', () => {
  // Three vias in a row, routed past. Walkaround hugs each octagon in turn —
  // six points per via — which is correct and is not what anybody would draw.
  const row = board({ vias: [via(5, 0, 2), via(10, 0, 2), via(15, 0, 2)] });
  const hulls = boardObstacleHulls(row, {
    net: 1,
    layer: 'F.Cu',
    width: MM(0.25),
    clearance: MM(0.2),
  });

  /** Samples every segment rather than trusting the corners. */
  const entersCopper = (from: Vec2, path: readonly Vec2[]): boolean => {
    const full = [from, ...path];
    for (let i = 0; i + 1 < full.length; i++) {
      const a = full[i]!;
      const b = full[i + 1]!;
      for (let t = 0; t <= 400; t++) {
        const q = { x: a.x + ((b.x - a.x) * t) / 400, y: a.y + ((b.y - a.y) * t) / 400 };
        for (const h of hulls) if (pointInside(h, q) && !pointOnEdge(h, q)) return true;
      }
    }
    return false;
  };

  it('takes a route that hugged three vias down to a handful of corners', () => {
    // Raw walkaround gives 19 points here; one rise, one straight run over all
    // three, one descent is what a person would have drawn.
    expect(routedPath(P(0, 0), P(20, 0), ctx(row))).toHaveLength(3);
  });

  it('keeps the tidied route clear of the copper it went round', () => {
    // The one that has to hold. The cheapest route between two points either
    // side of a via goes straight through it, so tidying without re-checking
    // would undo precisely the detour walkaround just found.
    expect(entersCopper(P(0, 0), routedPath(P(0, 0), P(20, 0), ctx(row)))).toBe(false);
  });

  it('would cut straight through if the tidy were unchecked', () => {
    // Stated so the previous test is visibly load bearing: the straight line
    // from start to cursor is both the cheapest route and an illegal one.
    expect(entersCopper(P(0, 0), [P(20, 0)])).toBe(true);
  });

  it('still arrives exactly at the cursor', () => {
    const path = routedPath(P(0, 0), P(20, 0), ctx(row));

    expect(path[path.length - 1]).toEqual(P(20, 0));
  });
});

describe('what the caller receives', () => {
  it('is the points after the start, never the start itself', () => {
    // The component appends these to the point it already has; returning the
    // start would lay a zero-length track segment.
    const b = board({ vias: [via(15, 0, 2)] });

    expect(routedPath(P(0, 0), P(30, 0), ctx(b))[0]).not.toEqual(P(0, 0));
    expect(routedPath(P(0, 0), P(30, 10), ctx(board()))[0]).not.toEqual(P(0, 0));
  });
});
