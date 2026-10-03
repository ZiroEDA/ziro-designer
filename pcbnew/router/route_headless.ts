// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The interactive router without the mouse, for scripted routing (the AI):
 * `PnsSession`s from a point to a point, kept only when one arrives.
 *
 * ROUTER_TOOL's own flow, minus the clicks: StartRouting at one end, a click
 * at each waypoint (Move + FixRoute, which fixes the track so far and routes
 * on from there), Move to the far end and FixRoute( forceFinish ). Two things
 * a person at the mouse does without thinking have to be done on purpose:
 *
 * - A person creeps the cursor towards the target and the head is solved
 *   again at every step; one jump across a crowded board can exhaust the
 *   walkaround's iteration budget and come back with nothing. Walkaround is
 *   also directional (it leaves the start and hugs obstacles towards the
 *   cursor), so a boxed-in pad may be reachable from the other end only.
 *   So: walkaround one way, then the other, with a larger budget, then the
 *   same with shove, which pushes other nets' tracks aside (KiCad's other
 *   interactive mode).
 * - An interactive route that cannot reach its target still commits as a
 *   stub. Scripted, that would litter the board, so a result is refused
 *   unless a new segment ends on the far end.
 */
import type { BOARD } from '../board.js';
import { boardLayerFromPnsLayer } from './pns_kicad_iface.js';
import { PnsKind, type PnsItem } from './pns_item.js';
import { DEFAULT_ROUTING_SETTINGS, PnsMode } from './pns_routing_settings.js';
import type { PnsSegment } from './pns_segment.js';
import { PnsSession, type PnsSessionOptions } from './router_tool.js';

type Vec2 = { x: number; y: number };

/** Where a new segment ends, on which board layer (F.Cu...). */
export interface RouteEnd extends Vec2 {
  layer: string;
}

export interface HeadlessRoute {
  ok: boolean;
  reason: string;
  /** The ends of the segments the route added; empty when it was refused. */
  ends: readonly RouteEnd[];
}

/**
 * The scripted walkaround's iteration budget. KiCad's default (40) is sized
 * for a head solved again every few pixels of mouse travel; one solve across
 * a whole connection needs more room.
 */
export const SCRIPTED_WALKAROUND_ITERATIONS = 200;

/** The endpoints of the segments among `items`. */
export function routeEnds(items: readonly PnsItem[], copperLayers: number): RouteEnd[] {
  const out: RouteEnd[] = [];
  for (const item of items) {
    if (item.kind() !== PnsKind.SEGMENT_T) continue;
    const seg = item as PnsSegment;
    const layer = boardLayerFromPnsLayer(seg.layers().start(), copperLayers);
    const s = seg.seg();
    out.push({ x: s.a.x, y: s.a.y, layer }, { x: s.b.x, y: s.b.y, layer });
  }
  return out;
}

/**
 * One session: start at `from`, click each waypoint, finish at `to`. With no
 * commit host in `opts` it only records what the router would add.
 */
function attempt(
  board: BOARD,
  from: Vec2,
  through: readonly Vec2[],
  to: Vec2,
  layer: string,
  opts: PnsSessionOptions,
  copperLayers: number,
  arrived: (end: RouteEnd) => boolean,
): HeadlessRoute {
  const session = new PnsSession(board, { ...opts, view: null });
  try {
    if (!session.start(from, layer))
      return {
        ok: false,
        reason: session.failureReason || 'the start point violates DRC',
        ends: [],
      };
    for (const p of through) {
      session.move(p);
      // A click: fix what is routed so far and carry on from there.
      if (session.fix(p)) break;
    }
    session.move(to);
    session.fix(to, true);
    const reason = session.failureReason;
    session.commit();
    const added = session.addedItems();
    if (added.length === 0) return { ok: false, reason: reason || 'no path found', ends: [] };
    const ends = routeEnds(added, copperLayers);
    if (!ends.some(arrived))
      return { ok: false, reason: 'the router could not reach the target (blocked)', ends: [] };
    return { ok: true, reason: '', ends };
  } finally {
    session.dispose();
  }
}

/**
 * Route between `from` and `to` on `layer`, through `through` in order.
 * `atFrom` / `atTo` say whether a segment end is on that end (the caller
 * knows what is there: a pad, and on which layers). Tries walkaround both
 * ways, then shove both ways; the first that arrives wins, and is then routed
 * again through `opts.commitHost` - so a route that does not arrive never
 * reaches the board.
 */
export function routeHeadless(
  board: BOARD,
  from: Vec2,
  to: Vec2,
  layer: string,
  opts: PnsSessionOptions,
  copperLayers: number,
  atFrom: (end: RouteEnd) => boolean,
  atTo: (end: RouteEnd) => boolean,
  through: readonly Vec2[] = [],
): HeadlessRoute {
  const base = opts.settings ?? DEFAULT_ROUTING_SETTINGS;
  const { commitHost, ...dry } = opts;
  const reasons: string[] = [];
  for (const routingMode of [PnsMode.RM_Walkaround, PnsMode.RM_Shove]) {
    const settings = {
      ...base,
      routingMode,
      walkaroundIterationLimit: Math.max(
        base.walkaroundIterationLimit,
        SCRIPTED_WALKAROUND_ITERATIONS,
      ),
    };
    const ways: [Vec2, readonly Vec2[], Vec2, (e: RouteEnd) => boolean][] = [
      [from, through, to, atTo],
      [to, [...through].reverse(), from, atFrom],
    ];
    for (const [a, via, b, arrived] of ways) {
      const r = attempt(board, a, via, b, layer, { ...dry, settings }, copperLayers, arrived);
      if (r.ok) {
        // The same route again, this time onto the board.
        if (commitHost)
          attempt(board, a, via, b, layer, { ...dry, settings, commitHost }, copperLayers, arrived);
        return r;
      }
      reasons.push(r.reason);
    }
  }
  // Every try failed: say the most informative thing any of them said.
  const blocked = (r: string) => r.startsWith('the router could not reach');
  const reason =
    reasons.find((r) => r !== 'no path found' && !blocked(r)) ??
    (reasons.some(blocked)
      ? 'the router could not reach the target in walkaround or shove (blocked: move parts, add waypoints, use the other layer or a via)'
      : 'no path found in walkaround or shove (move parts, add waypoints, use the other layer or a via)');
  return { ok: false, reason, ends: [] };
}
