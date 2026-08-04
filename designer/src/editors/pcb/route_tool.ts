// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the Route Single Track tool decides when the cursor moves.
 * Counterpart: `ROUTER_TOOL`'s posture handling plus the walkaround it runs
 * over the result.
 *
 * Extracted from `PcbEditor.tsx` so it can be tested. It was the last untested
 * link in the router chain — hulls, chain operations, walkaround and its driver
 * all have suites of their own, and the glue that decides *when to use them*
 * had none, because the qa package cannot import a `.tsx`. That is exactly the
 * seam where a chain of individually-correct pieces goes wrong, and it is worth
 * saying that the same gap is how the bug fixed in #372 survived two PRs.
 *
 * There is no rendering here, and no board mutation: given where the route
 * starts, where the cursor is, and what is on the board, this says which points
 * the track should pass through. The component draws that as a preview and
 * commits the same list on click, so what is previewed and what is committed
 * cannot drift.
 */
import { boardObstacleHulls } from '@ziroeda/pcbnew/src/router/pns_obstacles.js';
import { optimize } from '@ziroeda/pcbnew/src/router/pns_optimizer.js';
import { nearestObstacle, routeShortest } from '@ziroeda/pcbnew/src/router/pns_walkaround.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * `ROUTER_TOOL`'s posture: the 45°-constrained two-segment path.
 *
 * A straight run along whichever axis dominates, then a 45° diagonal into the
 * cursor. When the move is already axis-aligned or already diagonal there is
 * nothing to break up and the cursor point stands alone.
 *
 * The *dominant* axis leads, not a fixed one. Leading with x always would put
 * the knee on the wrong side of a mostly-vertical move, and the track would
 * appear to set off in the wrong direction before turning back.
 */
export function posturePath(from: Vec2, to: Vec2): Vec2[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) return [to];

  if (Math.abs(dx) > Math.abs(dy))
    return [{ x: from.x + Math.sign(dx) * (Math.abs(dx) - Math.abs(dy)), y: from.y }, to];

  return [{ x: from.x, y: from.y + Math.sign(dy) * (Math.abs(dy) - Math.abs(dx)) }, to];
}

/** Everything the tool knows about the route in progress. */
export interface RouteContext {
  board: Board;
  net: number;
  layer: string;
  /** The width of the track being laid. */
  width: number;
  /** Clearance the route must keep from other nets; zero disables avoidance. */
  clearance: number;
}

/**
 * The points the track should pass through, obstacles accounted for.
 *
 * Returns the points *after* `from`, matching what the caller appends.
 *
 * ## Falling back is a feature
 *
 * When no clear route exists the direct path is returned rather than nothing.
 * That is upstream's `MARK_OBSTACLES` behaviour and the right default for a
 * tool that only suggests geometry: a track the user can see and DRC will flag
 * beats a tool that silently refuses to draw. A router that goes blank when the
 * board gets tight is one people stop trusting.
 *
 * The same fallback covers the cheap exits — no clearance configured, nothing
 * on the layer to avoid — so there is one answer for "avoidance did not apply"
 * rather than three.
 *
 * ## The walk is tidied before it is returned
 *
 * Walkaround's output is correct and is not what anybody would draw: it hugs
 * every hull it passes, tracing octagon corners that stop mattering the moment
 * the path is clear of them, so a route past three vias arrives as twenty
 * points. `optimize` takes that back to the few corners a person would have
 * used. It is the last step rather than a separate command because the user
 * never wants the untidied version — upstream optimises as part of placing.
 *
 * The collision test handed to it is `nearestObstacle` over the *same* hulls
 * the walk used. That matters more than it looks: the optimiser will only
 * accept a shortcut that this predicate calls clear, so tidying can never
 * produce a route walkaround would have rejected. One notion of "blocked",
 * used by both halves.
 */
export function routedPath(from: Vec2, to: Vec2, ctx: RouteContext): Vec2[] {
  const direct = posturePath(from, to);

  if (ctx.clearance <= 0) return direct;

  const hulls = boardObstacleHulls(ctx.board, {
    net: ctx.net,
    layer: ctx.layer,
    width: ctx.width,
    clearance: ctx.clearance,
  });
  // A cost guard, not a behavioural one: with no hulls the walk returns the
  // input untouched and the answer is the same either way. It is here so the
  // common case — an empty board, or a layer with nothing foreign on it —
  // never builds a graph to discover it has nothing to do.
  if (hulls.length === 0) return direct;

  const walked = routeShortest([from, ...direct], hulls);
  if (walked.status !== 'done') return direct;

  const tidied = optimize(walked.path, (path) => nearestObstacle(path, hulls) !== null);

  return tidied.slice(1);
}
