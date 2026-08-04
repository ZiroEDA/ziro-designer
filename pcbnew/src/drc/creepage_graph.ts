// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The creepage graph: shortest path *over the board surface*.
 * Counterpart: `CREEPAGE_GRAPH`, `GRAPH_NODE`, `GRAPH_CONNECTION` and the
 * `CREEP_SHAPE::Paths` family (pcbnew/drc/drc_creepage_utils.*).
 *
 * Creepage is not clearance. Clearance is how far apart two things are through
 * the air; creepage is how far a leakage current would have to travel *across
 * the board's surface* to get from one to the other. The difference is what
 * slots are for: a cutout between two high-voltage nets does not move them
 * apart at all, but it makes the surface path go the long way round, and that
 * is the whole reason anyone mills one.
 *
 * So the measurement is a shortest-path problem, and this is the graph it runs
 * on. Nodes are points on board edges and on copper; an edge exists between two
 * nodes when a straight line between them stays on the board. Dijkstra over
 * that gives the surface distance, and a slot in the way shows up as the direct
 * connection simply not existing.
 *
 * ## What this file covers
 *
 * The straight-edge subset — points, board-edge segments and copper track
 * segments. Upstream also models circles and arcs, on both the board-edge and
 * the copper side, which is another thirty-odd pairwise path functions; those
 * come next. **Nothing here reports a violation**, deliberately: a creepage
 * check that silently under-reports because it cannot see a rounded pad is
 * worse than no check at all, since creepage is a safety property and a green
 * result is taken as permission to ship. The consumer lands with the geometry
 * it needs, not before.
 *
 * ## Weights are edge to edge
 *
 * A copper segment's path endpoints are pushed out of its centreline by half
 * its width, and the weight has both half-widths subtracted, floored at zero.
 * Creepage is measured between the *copper surfaces*, not between the
 * centrelines the router happens to store.
 */
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** One candidate straight hop, and what it costs. */
export interface PathConnection {
  a1: Vec2;
  a2: Vec2;
  weight: number;
}

/** A point on a board edge — a corner, or the end of an edge segment. */
export interface BePoint {
  kind: 'be-point';
  pos: Vec2;
}

/** A straight run of board edge. */
export interface BeSegment {
  kind: 'be-segment';
  start: Vec2;
  end: Vec2;
}

/** A copper track segment, which has width and so a surface rather than a line. */
export interface CuSegment {
  kind: 'cu-segment';
  start: Vec2;
  end: Vec2;
  width: number;
}

export type CreepShape = BePoint | BeSegment | CuSegment;

/** Whether a shape is copper: only copper carries a half-width. */
export const isConductive = (s: CreepShape): boolean => s.kind === 'cu-segment';

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const norm = (v: Vec2): number => Math.hypot(v.x, v.y);

/** `VECTOR2I::Resize`: same direction, given length. A zero vector stays zero. */
function resize(v: Vec2, len: number): Vec2 {
  const n = norm(v);
  if (n === 0) return { x: 0, y: 0 };
  return { x: Math.round((v.x * len) / n), y: Math.round((v.y * len) / n) };
}

/** The point of segment a→b nearest `p`, clamped to the segment. */
export function closestPointOnSegment(a: Vec2, b: Vec2, p: Vec2): Vec2 {
  const d = sub(b, a);
  const len2 = dot(d, d);
  if (len2 === 0) return { x: a.x, y: a.y };
  let t = dot(sub(p, a), d) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: Math.round(a.x + d.x * t), y: Math.round(a.y + d.y * t) };
}

const endpointsOf = (s: BeSegment | CuSegment): [Vec2, Vec2] => [s.start, s.end];

/**
 * The candidate paths between two shapes, or none when they are further apart
 * than `maxWeight`.
 *
 * Upstream returns a *vector* because a circle or an arc can face another shape
 * along two different tangents. For the straight-edge subset there is only ever
 * one nearest approach, so this returns at most one — but the shape of the
 * return value is kept, because the arc work will need it.
 */
export function pathsBetween(s1: CreepShape, s2: CreepShape, maxWeight: number): PathConnection[] {
  const maxSquared = maxWeight * maxWeight;

  // Point to point: the straight line, and the gate is on the *squared*
  // distance so the square root is only paid for a path that survives.
  if (s1.kind === 'be-point' && s2.kind === 'be-point') {
    const d = sub(s1.pos, s2.pos);
    const weightSq = dot(d, d);
    if (weightSq > maxSquared) return [];
    return [{ a1: s1.pos, a2: s2.pos, weight: Math.sqrt(weightSq) }];
  }

  const halfWidth = (s: CreepShape): number => (s.kind === 'cu-segment' ? s.width / 2 : 0);

  // Point to segment, either way round.
  if (s1.kind === 'be-point' || s2.kind === 'be-point') {
    const pt = (s1.kind === 'be-point' ? s1 : s2) as BePoint;
    const seg = (s1.kind === 'be-point' ? s2 : s1) as BeSegment | CuSegment;
    const [start, end] = endpointsOf(seg);
    const hw = halfWidth(seg);

    const onSeg = closestPointOnSegment(start, end, pt.pos);
    const dist = norm(sub(onSeg, pt.pos));
    const weight = Math.max(dist - hw, 0);
    if (weight > maxWeight) return [];

    // The path leaves the copper's *surface*, so it starts half a width out
    // from the centreline towards the other shape.
    const a1 = { x: onSeg.x, y: onSeg.y };
    const pushed = hw > 0 ? addVec(a1, resize(sub(pt.pos, a1), hw)) : a1;
    const conn: PathConnection = { a1: pushed, a2: pt.pos, weight };
    return [s1.kind === 'be-point' ? { a1: conn.a2, a2: conn.a1, weight } : conn];
  }

  // Segment to segment. Four candidate approaches — each endpoint of each
  // against the other segment — and the nearest wins. Two segments that cross
  // would give zero, which the floor below turns into a legal zero-cost hop
  // rather than a negative weight Dijkstra cannot take.
  const [a, b] = endpointsOf(s1);
  const [c, d] = endpointsOf(s2);
  const hw1 = halfWidth(s1);
  const hw2 = halfWidth(s2);

  const candidates: [Vec2, Vec2][] = [
    [closestPointOnSegment(a, b, c), c],
    [closestPointOnSegment(a, b, d), d],
    [a, closestPointOnSegment(c, d, a)],
    [b, closestPointOnSegment(c, d, b)],
  ];

  let best = candidates[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [p, q] of candidates) {
    const dd = sub(p, q);
    const dist2 = dot(dd, dd);
    if (dist2 < bestDist) {
      bestDist = dist2;
      best = [p, q];
    }
  }

  const [closest1, closest2] = best;
  const weight = Math.max(Math.sqrt(bestDist) - hw1 - hw2, 0);
  if (weight > maxWeight) return [];

  return [
    {
      a1: addVec(closest1, resize(sub(closest2, closest1), hw1)),
      a2: addVec(closest2, resize(sub(closest1, closest2), hw2)),
      weight,
    },
  ];
}

const addVec = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

/** Whether two segments properly cross (touching at an endpoint does not count). */
function segmentsCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);

  // A *proper* crossing: each segment must have the other's endpoints strictly
  // on opposite sides. A zero determinant means an endpoint lies on the other
  // segment, which is touching, not crossing — and touching is exactly what a
  // path hugging the rim of a cutout does at every corner it rounds. Testing
  // `(d1 > 0) !== (d2 > 0)` instead reads a zero as "not positive" and rejects
  // those paths, which is the whole route.
  const opposite = (x: number, y: number): boolean => (x > 0 && y < 0) || (x < 0 && y > 0);
  return opposite(d1, d2) && opposite(d3, d4);
}

/** Distance from a point to a segment, for the on-edge tolerance. */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const c = closestPointOnSegment(a, b, p);
  return Math.hypot(p.x - c.x, p.y - c.y);
}

/**
 * `SHAPE_POLY_SET::PointOnEdge`, with a tolerance.
 *
 * Load bearing rather than defensive: the paths creepage most cares about are
 * the ones hugging the rim of a cutout, and their midpoints land exactly on the
 * boundary — where ray casting answers whichever way the rounding fell.
 */
function pointOnEdge(p: Vec2, rings: readonly (readonly Vec2[])[], tolerance: number): boolean {
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      if (distToSegment(p, ring[i]!, ring[(i + 1) % ring.length]!) <= tolerance) return true;
    }
  }
  return false;
}

/** Ray-cast containment for a simple ring. */
function pointInRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/** The board: an outer outline and any number of cutouts. */
export interface BoardSurface {
  outline: readonly Vec2[];
  holes: readonly (readonly Vec2[])[];
}

/**
 * `PATH_CONNECTION::isValid`: may this straight hop be taken?
 *
 * Two conditions, and both matter for the same reason — a leakage path runs
 * *on* the board:
 *
 * 1. It must not cross a board edge. Crossing one means leaving the board and
 *    coming back, which is through the air, and that is clearance's business.
 * 2. Its midpoint must be on the board. This is what stops a hop straight
 *    across a cutout, whose two ends are both on copper but whose middle is
 *    over nothing. Upstream tests the midpoint specifically, with a 100 nm
 *    tolerance so a path running along the very rim still counts.
 *
 * The midpoint test is not redundant with the crossing test: a chord across a
 * *concave* notch can enter and leave through the notch's mouth without ever
 * properly crossing an edge segment.
 */
export function isValidPath(pc: PathConnection, surface: BoardSurface): boolean {
  const rings = [surface.outline, ...surface.holes];

  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const e1 = ring[i]!;
      const e2 = ring[(i + 1) % ring.length]!;
      if (segmentsCross(pc.a1, pc.a2, e1, e2)) return false;
    }
  }

  const mid = { x: Math.round((pc.a1.x + pc.a2.x) / 2), y: Math.round((pc.a1.y + pc.a2.y) / 2) };

  // Upstream's `Contains( mid ) || PointOnEdge( mid )`, at its 100 nm
  // tolerance. The second half is not a rounding nicety: a path running along
  // the rim of a cutout has its midpoint *on* the boundary, and that is the
  // most important kind of path there is here.
  if (pointOnEdge(mid, rings, ON_EDGE_TOLERANCE)) return true;

  if (!pointInRing(mid, surface.outline)) return false;
  for (const hole of surface.holes) if (pointInRing(mid, hole)) return false;

  return true;
}

/** Upstream's midpoint tolerance: 100 nm. */
const ON_EDGE_TOLERANCE = 100;

/** A node in the graph: a point, and which net's copper it belongs to. */
export interface GraphNode {
  id: number;
  pos: Vec2;
  /** -1 for a board-edge node, which belongs to no net. */
  net: number;
}

interface Connection {
  n1: number;
  n2: number;
  weight: number;
}

/**
 * The graph, and Dijkstra over it.
 *
 * The queue holds the tentative distance *captured at push time* rather than
 * reading the live distance map. Upstream carries a comment about why: a
 * comparator that read live distances would have its ordering silently
 * corrupted by a decrease-key reinsertion, and the target could then be popped
 * on a path that is not the shortest — at which point the early exit returns
 * the wrong answer. Stale entries are skipped instead, on the way out.
 */
export class CreepageGraph {
  private readonly nodes: GraphNode[] = [];
  private readonly adjacency = new Map<number, Connection[]>();

  addNode(pos: Vec2, net = -1): GraphNode {
    const node: GraphNode = { id: this.nodes.length, pos, net };
    this.nodes.push(node);
    this.adjacency.set(node.id, []);
    return node;
  }

  /**
   * Join two nodes.
   *
   * A negative weight is dropped rather than stored: Dijkstra cannot take one,
   * and upstream logs and ignores it at traversal time. Refusing it here means
   * the graph never holds an edge no algorithm over it can use.
   */
  connect(n1: GraphNode, n2: GraphNode, weight: number): void {
    if (weight < 0) return;
    this.adjacency.get(n1.id)?.push({ n1: n1.id, n2: n2.id, weight });
    this.adjacency.get(n2.id)?.push({ n1: n2.id, n2: n1.id, weight });
  }

  get nodeCount(): number {
    return this.nodes.length;
  }

  /**
   * The shortest surface distance between two nodes, and the path taken.
   *
   * `Infinity` when there is no path at all — which is the *good* answer for
   * creepage: it means no leakage route exists within the distance searched.
   */
  solve(from: GraphNode, to: GraphNode): { weight: number; path: GraphNode[] } {
    if (from.id === to.id) return { weight: 0, path: [from] };

    const dist = new Map<number, number>();
    const prev = new Map<number, number>();
    for (const n of this.nodes) dist.set(n.id, Number.POSITIVE_INFINITY);
    dist.set(from.id, 0);

    // A sorted array standing in for the priority queue: the graphs here are
    // small and bounded by the creepage distance, and a real heap would be
    // more machinery than the problem needs.
    const queue: { d: number; id: number }[] = [{ d: 0, id: from.id }];

    while (queue.length > 0) {
      queue.sort((x, y) => (x.d === y.d ? x.id - y.id : x.d - y.d));
      const { d, id } = queue.shift()!;

      // Left behind by a decrease-key push; its shorter copy already ran. This
      // is an optimisation and not a correctness guard, which is worth saying
      // because it looks like one: the relaxation below reads the *current*
      // distance rather than the `d` popped here, so re-processing a stale
      // entry recomputes the same answers. Mutation testing confirmed removing
      // it changes no result — only how much work is done.
      if (d > (dist.get(id) ?? Number.POSITIVE_INFINITY)) continue;
      if (id === to.id) break;

      for (const conn of this.adjacency.get(id) ?? []) {
        const alt = (dist.get(id) ?? Number.POSITIVE_INFINITY) + conn.weight;
        if (alt < (dist.get(conn.n2) ?? Number.POSITIVE_INFINITY)) {
          dist.set(conn.n2, alt);
          prev.set(conn.n2, id);
          queue.push({ d: alt, id: conn.n2 });
        }
      }
    }

    const weight = dist.get(to.id) ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(weight)) return { weight: Number.POSITIVE_INFINITY, path: [] };

    const path: GraphNode[] = [];
    let step: number | undefined = to.id;
    while (step !== undefined) {
      path.unshift(this.nodes[step]!);
      if (step === from.id) break;
      step = prev.get(step);
    }

    return { weight, path };
  }
}
