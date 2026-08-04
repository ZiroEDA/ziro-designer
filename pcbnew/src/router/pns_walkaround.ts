// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Routing a line around an obstacle.
 * Counterpart: `LINE::Walkaround` (pcbnew/router/pns_line.cpp).
 *
 * Given a path that runs into an obstacle's hull and the hull itself, produce
 * the path that goes *round* it instead. This is the first piece of the router
 * with behaviour anyone can see: a track that meets a pad and bends past it
 * rather than through it.
 *
 * ## It is a graph walk, not a clipping operation
 *
 * The obvious approach — cut the path where it crosses, splice in the arc of
 * hull between the two crossings — falls apart as soon as a path crosses the
 * hull more than twice, or starts on the boundary, or ends inside. Upstream
 * instead builds one graph out of *both* point sets:
 *
 * - every point of the path, classified inside the hull, outside it, or exactly
 *   on its edge, linked to its neighbours along the path;
 * - every point of the hull, linked to the next one round.
 *
 * Then it walks from the path's first point to its last. The rules are short:
 * from an **outside** point, carry on along the path; from a point **on the
 * edge**, leave for the first outside point if there is one, and otherwise
 * carry on round the hull. There is deliberately no rule for an inside point —
 * the walk never steps onto one, which is what keeps the result clear of the
 * obstacle.
 *
 * ## Direction is the caller's choice
 *
 * Left or right past an obstacle are both valid and neither is always shorter,
 * so `cw` picks which, and the router asks for both and compares. The hull's
 * winding is what encodes the choice — it is reversed for the anticlockwise
 * walk — and that is why `segmentHull` guarantees a clockwise result whichever
 * way its segment ran.
 *
 * ## Most of this is fallback, and most of the fallback is unreachable
 *
 * Worth stating plainly, because the tests cover a smaller fraction of the
 * lines here than anywhere else in this port. Upstream layers three attempts
 * inside the on-edge case and a fallback inside the outside case, and says of
 * the deepest one: *"I guess we should never reach this part of the code, but
 * who really knows?"* Mutation testing agrees — with square hulls, octagonal
 * via hulls, track hulls, diagonals, zig-zags and paths that end inside the
 * obstacle, these never fire:
 *
 * - the **start-inside guard**, because a walk beginning on an inside vertex
 *   finds no legal step and returns null a few lines later anyway;
 * - **splicing crossings into the hull** and **promoting on-edge path points to
 *   hull vertices**, which are two routes to the same end — removing *either*
 *   changes nothing and removing *both* breaks ten tests;
 * - the **backward path links**, since the walk only ever advances;
 * - **refusing an inside neighbour** from an outside vertex, and the
 *   **path-adjacency test** beside it: a crossing is always spliced between an
 *   outside point and an inside one, so the two are never neighbours;
 * - the **already-visited check**, which the iteration limit also catches.
 *
 * None of them is deleted. Stripping the loop protection out of a graph walk
 * whose own author is unsure it terminates, to raise a score, would be the
 * wrong trade — and the pair that mask each other are each doing real work on
 * some input, just not one this file can reach.
 */
import {
  findPoint,
  hullIntersection,
  pointInside,
  pointOnEdge,
  splitAt,
  type Chain,
} from './pns_chain.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** How a point stands relative to the hull. */
enum VertexType {
  Inside = 0,
  Outside = 1,
  OnEdge = 2,
}

interface Vertex {
  type: VertexType;
  /** Came from the hull rather than the path. */
  isHull: boolean;
  pos: Vec2;
  neighbours: Vertex[];
  /** Index in the split path, or -1. */
  indexp: number;
  /** Index in the split hull, or -1. */
  indexh: number;
  visited: boolean;
}

const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * `SHAPE_LINE_CHAIN::Append`: a point identical to the last one is dropped.
 *
 * Upstream appends the current position twice in the outside branch, which the
 * deduplication silently swallows. That redundant second append is not ported —
 * it has no effect there and reads as a mistake here — but the deduplication is,
 * because a vertex belonging to both the path and the hull can otherwise be
 * emitted twice in a row.
 */
function append(out: Chain, p: Vec2): void {
  const last = out[out.length - 1];
  if (last && same(last, p)) return;
  out.push({ x: p.x, y: p.y });
}

/** Adjacent along the path — upstream's `areNeighbours`. */
function areNeighbours(x: number, y: number, max: number): boolean {
  if (x > 0 && x - 1 === y) return true;
  if (x < max - 1 && x + 1 === y) return true;
  return false;
}

/** Distance from a point to a segment's nearest point, and that point. */
function nearestOnSeg(a: Vec2, b: Vec2, p: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: Math.round(a.x + dx * t), y: Math.round(a.y + dy * t) };
}

/**
 * Route `line` around `hull`, or `null` when it cannot be done.
 *
 * Null is a real answer and not an error: a path that *begins* inside the hull
 * has nowhere to walk from — its start is already in the obstacle — and the
 * router's answer there is to reject the move, not to invent a route. The
 * iteration limit is upstream's too, and for the same stated reason: the graph
 * is built from geometry that has been through rounding, and a cycle in it is
 * cheaper to bail out of than to prove impossible.
 */
export function walkaround(line: Chain, hull: Chain, cw: boolean): Chain | null {
  if (line.length < 2) return null;

  const pFirst = line[0]!;

  // Beginning inside the obstacle: there is no way round from in there. The
  // boundary is deliberately *not* inside — a path starting exactly on the hull
  // is the ordinary case of leaving a pad, and rejecting it makes a great many
  // legitimate routes unroutable.
  if (pointInside(hull, pFirst) && !pointOnEdge(hull, pFirst)) return null;

  let pnew: Chain = line.map((p) => ({ ...p }));
  let hnew: Chain = hull.map((p) => ({ ...p }));

  // Splice every crossing into both chains, so the two point sets meet.
  for (const ip of hullIntersection(hnew, pnew)) {
    if (findPoint(pnew, ip.p, 1) < 0) pnew = splitAt(pnew, ip.p, false).chain;
    if (findPoint(hnew, ip.p, 1) < 0) hnew = splitAt(hnew, ip.p, true).chain;
  }

  // A path point that lies on the hull without being one of its vertices has to
  // become one, or the walk cannot hand over between the two.
  for (const p of pnew) {
    if (!pointOnEdge(hnew, p)) continue;
    if (findPoint(hnew, p) < 0) hnew = splitAt(hnew, p, true).chain;
  }

  // The hull arrives clockwise; reversing it is what makes the walk go the
  // other way round.
  if (!cw) hnew = [...hnew].reverse();

  const vts: Vertex[] = [];
  const findVertex = (pos: Vec2): Vertex | undefined => vts.find((v) => same(v.pos, pos));

  for (let i = 0; i < pnew.length; i++) {
    const p = pnew[i]!;
    const onEdge = pointOnEdge(hnew, p);
    const inside = pointInside(hnew, p);

    vts.push({
      type: inside && !onEdge ? VertexType.Inside : onEdge ? VertexType.OnEdge : VertexType.Outside,
      isHull: false,
      pos: p,
      neighbours: [],
      indexp: i,
      indexh: -1,
      visited: false,
    });
  }

  // Along the path, in both directions.
  for (let i = 0; i < pnew.length - 1; i++) vts[i]!.neighbours.push(vts[i + 1]!);
  for (let i = 1; i < pnew.length; i++) vts[i]!.neighbours.push(vts[i - 1]!);

  // Hull points: reuse a path vertex standing at the same place rather than
  // adding a second one, or the two graphs never join.
  for (let i = 0; i < hnew.length; i++) {
    const hp = hnew[i]!;
    const existing = findVertex(hp);

    if (existing) {
      existing.isHull = true;
      existing.indexh = i;
    } else {
      vts.push({
        type: VertexType.OnEdge,
        isHull: true,
        pos: hp,
        neighbours: [],
        indexp: -1,
        indexh: i,
        visited: false,
      });
    }
  }

  // Round the hull, one way only: the direction *is* the choice of side.
  for (let i = 0; i < hnew.length; i++) {
    const vc = findVertex(hnew[i]!);
    const vnext = findVertex(hnew[(i + 1) % hnew.length]!);
    if (vc && vnext) vc.neighbours.push(vnext);
  }

  const last = line[line.length - 1]!;
  const inLast = pointInside(hull, last) && !pointOnEdge(hull, last);

  let v: Vertex | undefined = vts[0];
  let vPrev: Vertex | undefined;
  const out: Chain = [];
  let appendLast = true;
  let iterLimit = 1000;
  let lastDist = Number.POSITIVE_INFINITY;

  while (v && v.indexp !== pnew.length - 1) {
    if (--iterLimit === 0) return null;
    if (v.visited) break; // went in a circle

    append(out, v.pos);

    let vNext: Vertex | undefined;

    if (v.type === VertexType.Outside) {
      // Carry on along the path, so long as the next point is not inside.
      let fallback: Vertex | undefined;

      for (const vn of v.neighbours) {
        if (!areNeighbours(vn.indexp, v.indexp, pnew.length)) continue;
        if (vn.type === VertexType.Inside) continue;

        if (!vn.visited) {
          vNext = vn;
          break;
        }
        if (vn !== vPrev) fallback = vn;
      }

      vNext ??= fallback;
      if (!vNext) return null;
    } else if (v.type === VertexType.OnEdge) {
      // Leave for open board the moment there is somewhere to go.
      for (const vn of v.neighbours) {
        if (vn.type === VertexType.Outside && !vn.visited) {
          vNext = vn;
          break;
        }
      }

      // Otherwise carry on round the hull, preferring a point that is also on
      // the path — that is where the route rejoins it.
      if (!vNext) {
        for (const vn of v.neighbours) {
          if (
            vn.type === VertexType.OnEdge &&
            !vn.isHull &&
            areNeighbours(vn.indexp, v.indexp, pnew.length) &&
            vn.indexh === (v.indexh + 1) % hnew.length
          ) {
            vNext = vn;
            break;
          }
        }
      }

      // Still nothing: take the next hull point round, and let the hull be
      // walked again — going round twice is legitimate when the path re-enters.
      if (!vNext) {
        for (const vn of v.neighbours) {
          if (vn.type === VertexType.OnEdge && vn.indexh === (v.indexh + 1) % hnew.length) {
            vNext = vn;
            break;
          }
        }

        if (vNext) for (const vt of vts) if (vt.isHull) vt.visited = false;

        // The path ends *inside* the hull — the cursor is over the obstacle.
        // Rather than circle it forever, stop at the point on the hull nearest
        // where the path wanted to go.
        if (inLast && vNext) {
          const d = (vNext.pos.x - last.x) ** 2 + (vNext.pos.y - last.y) ** 2;

          if (d < lastDist) {
            lastDist = d;
          } else {
            append(out, nearestOnSeg(v.pos, vNext.pos, last));
            appendLast = false;
            break;
          }
        }
      }
    }

    v.visited = true;
    vPrev = v;
    v = vNext;

    if (!v) return null;
  }

  if (appendLast && v) append(out, v.pos);

  return out;
}
