// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Solving creepage between two nets.
 * Counterparts: `CREEPAGE_GRAPH::AddNetElements`, `GeneratePaths`,
 * `ConnectChildren` and `DRC_TEST_PROVIDER_CREEPAGE::testCreepage`.
 *
 * The geometry (`creepage_graph.ts`) answers "how far is it from this shape to
 * that one, and may a path go that way". This assembles those answers into a
 * graph and asks the question that actually matters: how far must a leakage
 * current crawl to get from *any* part of one net to *any* part of another.
 *
 * ## One search per net pair, not per shape pair
 *
 * Each net gets a **virtual node**, joined at zero cost to every landing point
 * on every shape it owns. A single shortest path between the two virtual nodes
 * is then the whole answer — the search picks which pad, which track and which
 * way round each cutout by itself. Comparing shapes pairwise instead would
 * measure straight lines and miss the route entirely.
 *
 * ## Landing points, and why sliding is not free
 *
 * A path does not connect two *shapes*, it connects two *points* — a specific
 * spot on a cutout's rim, a specific spot on a track's flank. So each candidate
 * path creates a node at each of its ends, and the nodes belonging to one shape
 * are then joined to each other by what it costs to travel between them **along
 * that shape's surface**:
 *
 * - along a straight track flank, the straight distance;
 * - around a circle or an arc, the *arc length* — `r · 2·asin(chord / 2r)`,
 *   upstream's formula, which is the shorter way round.
 *
 * Leaving that out is the single easiest way to get this badly wrong, and it
 * fails in the dangerous direction: a path could arrive on one side of a cutout
 * and depart from the other for nothing, reporting a creepage far shorter than
 * the board really has, on the check whose whole purpose is high-voltage
 * safety.
 *
 * ## Guards here that decide nothing
 *
 * Several early returns below are cost or clarity guards rather than
 * behaviour, and mutation testing says so. Named here so nobody mistakes the
 * gap in the tests for a gap in the cover:
 *
 * - **skipping same-net shape pairs** — they are already joined through the
 *   virtual node at no cost, so a direct edge between them is redundant;
 * - **the non-positive target, the empty-net check and the `joined` flag** —
 *   each is subsumed by the unreachable-result check at the end, which returns
 *   `null` for the same inputs a step later;
 * - **clamping the `asin` ratio** — it only fires if rounding pushes a chord
 *   past the diameter, which no fixture can reliably produce, and without it
 *   the result would be `NaN` rather than merely wrong;
 * - **refusing to traverse a bare point** — a point has one landing position,
 *   so there is never a second to travel to.
 *
 * They stay because each says something true about the intent, and because the
 * ones that guard against `NaN` are protecting a comparison that would fail
 * silently rather than loudly.
 */
import {
  CreepageGraph,
  isValidPath,
  pathsBetween,
  type BoardSurface,
  type CreepShape,
  type GraphNode,
} from './creepage_graph.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** Everything the solver needs about a board, on one layer. */
export interface CreepageShapes {
  /** The board itself: outer outline and cutouts. */
  surface: BoardSurface;
  /** Board-edge shapes — the obstacles a path must go round. */
  edges: readonly CreepShape[];
  /** Copper, by net code. */
  copperByNet: ReadonlyMap<number, readonly CreepShape[]>;
}

export interface CreepageResult {
  /** The surface distance between the two nets. */
  distance: number;
  /** The route it takes, for the marker. */
  path: Vec2[];
}

/** Distance between two points. */
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * What it costs to travel between two landing points along one shape.
 *
 * `null` when the shape cannot be traversed — a bare point has nowhere to go.
 */
function alongSurface(shape: CreepShape, a: Vec2, b: Vec2): number | null {
  switch (shape.kind) {
    case 'be-point':
      return null;

    case 'be-circle':
    case 'be-arc':
    case 'cu-arc': {
      // Arc length the short way round, upstream's `r · 2·asin(chord / 2r)`.
      // The clamp matters: rounding can push the chord a hair past the
      // diameter, and `asin` of anything over one is NaN — which would poison
      // every comparison it reached rather than failing loudly.
      const r = shape.radius;
      if (r <= 0) return null;
      const ratio = Math.min(dist(a, b) / (2 * r), 1);
      return r * 2 * Math.asin(ratio);
    }

    case 'cu-circle': {
      const r = shape.radius;
      if (r <= 0) return null;
      const ratio = Math.min(dist(a, b) / (2 * r), 1);
      return r * 2 * Math.asin(ratio);
    }

    // A track's flank is flat, so travelling along it is the straight distance.
    case 'cu-segment':
      return dist(a, b);
  }
}

/** Landing points accumulated on one shape. */
interface ShapeNodes {
  shape: CreepShape;
  /** Keyed by position, so two paths reaching the same spot share a node. */
  nodes: Map<string, GraphNode>;
}

const keyOf = (p: Vec2): string => `${p.x},${p.y}`;

/**
 * The creepage distance between two nets, or `null` when no route within
 * `target` exists.
 *
 * `target` bounds the search as well as answering it: a route longer than the
 * creepage being asked for is not interesting, and leaving it out would make
 * the graph every shape against every other.
 */
export function creepageDistance(
  shapes: CreepageShapes,
  netA: number,
  netB: number,
  target: number,
): CreepageResult | null {
  if (target <= 0) return null;

  const copperA = shapes.copperByNet.get(netA) ?? [];
  const copperB = shapes.copperByNet.get(netB) ?? [];
  if (copperA.length === 0 || copperB.length === 0) return null;

  const graph = new CreepageGraph();

  // Board edges belong to no net; copper carries its own so the virtual nodes
  // can find it.
  const all: { entry: ShapeNodes; net: number }[] = [
    ...shapes.edges.map((shape) => ({ entry: { shape, nodes: new Map() }, net: -1 })),
    ...copperA.map((shape) => ({ entry: { shape, nodes: new Map() }, net: netA })),
    ...copperB.map((shape) => ({ entry: { shape, nodes: new Map() }, net: netB })),
  ];

  const nodeAt = (item: (typeof all)[number], pos: Vec2): GraphNode => {
    const key = keyOf(pos);
    const found = item.entry.nodes.get(key);
    if (found) return found;
    const node = graph.addNode(pos, item.net);
    item.entry.nodes.set(key, node);
    return node;
  };

  // Every candidate hop between two shapes, kept only if it stays on the board.
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const s1 = all[i]!;
      const s2 = all[j]!;

      // Two shapes of the same net need no path between them: they are already
      // one conductor, and the virtual node joins them for free.
      if (s1.net !== -1 && s1.net === s2.net) continue;

      for (const pc of pathsBetween(s1.entry.shape, s2.entry.shape, target)) {
        if (!isValidPath(pc, shapes.surface)) continue;
        graph.connect(nodeAt(s1, pc.a1), nodeAt(s2, pc.a2), pc.weight);
      }
    }
  }

  // Now join each shape's own landing points, so travelling along it costs what
  // it actually costs.
  for (const item of all) {
    const points = [...item.entry.nodes.values()];
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const cost = alongSurface(item.entry.shape, points[i]!.pos, points[j]!.pos);
        if (cost !== null) graph.connect(points[i]!, points[j]!, cost);
      }
    }
  }

  // The two virtual nodes. Position is arbitrary — nothing measures them — but
  // a real one keeps a debug dump readable.
  const virtualA = graph.addNode(copperA[0] ? shapePos(copperA[0]) : { x: 0, y: 0 }, netA);
  const virtualB = graph.addNode(copperB[0] ? shapePos(copperB[0]) : { x: 0, y: 0 }, netB);

  let joined = false;
  for (const item of all) {
    if (item.net === -1) continue;
    const virt = item.net === netA ? virtualA : virtualB;
    for (const node of item.entry.nodes.values()) {
      graph.connect(virt, node, 0);
      joined = true;
    }
  }

  // No landing point on either net means nothing came within `target` of
  // anything — which is the good answer, not an error.
  if (!joined) return null;

  const solved = graph.solve(virtualA, virtualB);
  if (!Number.isFinite(solved.weight)) return null;

  return {
    distance: solved.weight,
    // Drop the two virtual endpoints: they are bookkeeping, not places.
    path: solved.path.slice(1, -1).map((n) => n.pos),
  };
}

/** A representative position for a shape, for the virtual node's own place. */
function shapePos(shape: CreepShape): Vec2 {
  switch (shape.kind) {
    case 'be-point':
      return shape.pos;
    case 'be-circle':
    case 'be-arc':
    case 'cu-circle':
    case 'cu-arc':
      return shape.pos;
    case 'cu-segment':
      return shape.start;
  }
}
