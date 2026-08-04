// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a route has to get past: a board turned into obstacle hulls.
 * Counterpart: the part of `PNS::NODE` the walkaround driver actually asks for
 * — `QueryColliding` over the items on a layer, minus the net being routed.
 *
 * The driver takes hulls rather than a board on purpose, so this is where the
 * board finally meets the router. It is deliberately *not* `PNS::NODE`: that
 * class is a branchable copy-on-write model with a spatial index and joint
 * tracking, and all of that exists to serve *shove*, which needs to try a move,
 * look at the consequences, and roll back. Walkaround never modifies the world,
 * so it needs none of it.
 *
 * ## Same net is not an obstacle
 *
 * A track may run into its own net freely — that is what arriving at a pad
 * looks like. Filtering by net is therefore not an optimisation but the
 * difference between a router that can finish a connection and one that can
 * only ever approach it.
 *
 * ## What is left out, and why that is safe here
 *
 * Zone fills are not turned into obstacles. A pour is an arbitrary non-convex
 * polygon, often with holes, and the hull machinery builds convex octagons
 * around primitives; wrapping a whole pour in one would block the entire region
 * it covers, including the parts a track may legitimately cross on another net's
 * thermal relief. Routing through a foreign pour is still caught by DRC, so the
 * failure mode is a violation the user is told about rather than a route
 * silently ruined — which is the right way round for a tool that only suggests
 * geometry.
 */
import { circleHull, rectHull, segmentHull, viaHull, type Hull } from './pns_hull.js';
import type { Board, PcbPad } from '../types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

export interface ObstacleQuery {
  /** The net being routed; its own copper is not an obstacle to it. */
  net: number;
  /** The copper layer being routed on. */
  layer: string;
  /** The width of the track being routed — half of it enters every hull. */
  width: number;
  /** Clearance required between the route and everything else. */
  clearance: number;
}

/** Whether a pad sits on the layer being routed. */
const padOnLayer = (pad: PcbPad, layer: string): boolean =>
  pad.layers.some((l) => l === layer || l === '*.Cu');

/** A plain circle, which the hull machinery models exactly. */
const isRoundPad = (pad: PcbPad): boolean =>
  pad.shape === 'circle' || (pad.shape === 'oval' && pad.size.x === pad.size.y);

/**
 * Every hull the route must stay outside of.
 *
 * Vias are obstacles on every layer they span, which is why they are not
 * filtered by `layer` the way tracks are: a via in the way is in the way
 * whichever side of the board the route is on.
 */
export function boardObstacleHulls(board: Board, q: ObstacleQuery): Hull[] {
  const out: Hull[] = [];
  const foreign = (net: number | undefined): boolean => (net ?? 0) !== q.net;

  for (const t of board.tracks) {
    if (t.layer !== q.layer || !foreign(t.net)) continue;
    out.push(segmentHull(t.start, t.end, t.width, q.clearance, q.width));
  }

  for (const a of board.arcs) {
    if (a.layer !== q.layer || !foreign(a.net)) continue;
    // A curved track is approximated by the chord's hull. That is wider than
    // the arc in the middle and never narrower, so a route clear of it is
    // clear of the arc — the error is in the direction that refuses a legal
    // route rather than allowing an illegal one.
    out.push(segmentHull(a.start, a.end, a.width, q.clearance, q.width));
  }

  for (const v of board.vias) {
    if (!foreign(v.net)) continue;
    out.push(viaHull(v.at, v.size, q.clearance, q.width));
  }

  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      if (!padOnLayer(pad, q.layer) || !foreign(pad.net)) continue;

      if (isRoundPad(pad)) {
        out.push(circleHull(pad.at, pad.size.x / 2, q.clearance + Math.trunc(q.width / 2)));
      } else {
        // A rotated pad's box is not axis-aligned, so the hull is built around
        // the extent it actually occupies. Wider than the pad on the diagonal,
        // and again wrong only in the direction that costs a route rather than
        // allows a short one.
        const ring = padRing(pad);
        const minX = Math.min(...ring.map((p) => p.x));
        const minY = Math.min(...ring.map((p) => p.y));
        const maxX = Math.max(...ring.map((p) => p.x));
        const maxY = Math.max(...ring.map((p) => p.y));

        out.push(
          rectHull(
            { x: minX, y: minY },
            { x: maxX - minX, y: maxY - minY },
            q.clearance + Math.trunc(q.width / 2),
          ),
        );
      }
    }
  }

  return out;
}

/** A pad's four corners, at its own rotation. */
function padRing(pad: PcbPad): Vec2[] {
  const hx = pad.size.x / 2;
  const hy = pad.size.y / 2;
  const a = ((pad.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);

  return [
    { x: -hx, y: -hy },
    { x: hx, y: -hy },
    { x: hx, y: hy },
    { x: -hx, y: hy },
  ].map((p) => ({
    x: Math.round(pad.at.x + p.x * cos - p.y * sin),
    y: Math.round(pad.at.y + p.x * sin + p.y * cos),
  }));
}
