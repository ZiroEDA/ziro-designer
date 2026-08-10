// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Ratsnest computation, a compact port of pcbnew's RN_NET / CONNECTIVITY_DATA
 * pipeline (connectivity/connectivity_algo.cpp + ratsnest/ratsnest_data.cpp):
 * per net, cluster the copper items that are already physically connected
 * (pads, track/arc segments, vias, filled zones), then emit the shortest edges
 * that would join the remaining clusters, which are the airwires the canvas
 * draws and the "Unrouted" count.
 *
 * Two items of a net are connected on exactly the terms CN_VISITOR::operator()
 * sets: their effective copper shapes collide on a common layer. Anything that
 * touches counts, a track teeing off the *middle* of another track, a track
 * crossing a pad it does not end on, two track ends that overlap only by their
 * width, so copper that really is joined never keeps an airwire drawn over it.
 * The shapes are the ones DRC collides ({@link padShapes}, {@link shapeDist}),
 * KiCad's GetEffectiveShape()->Collide() pair.
 */

import { arcShape, padShapes } from './drc/drc_engine.js';
import { shapeBBox, shapeDist, type Shape } from './drc/drc_geometry.js';
import type { Board, PcbPad } from './types.js';
import type { Vec2 } from '@ziroeda/kimath';

/** Copper scope of a shape or anchor: one layer, or through-hole (all). */
type AnchorLayer = string | 'through';

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** One copper shape of one board item, with the layer it sits on. */
interface Piece {
  /**
   * Union-find index of the *item* (CN_ITEM) the shape belongs to, so the
   * several shapes of one pad, or the two ends of one segment, cluster as one
   * thing without a collision test.
   */
  item: number;
  layer: AnchorLayer;
  shape: Shape;
  box: BBox;
}

/** A point an airwire may end on (CN_ITEM's anchors): pad/via centre, track end. */
interface Anchor {
  x: number;
  y: number;
  layer: AnchorLayer;
  item: number;
  /** Index of the footprint this anchor's pad belongs to; absent for bare copper. */
  footprint?: number;
}

/** One airwire between two unconnected clusters of a net. */
export interface RatsnestEdge {
  net: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  aLayer: AnchorLayer;
  bLayer: AnchorLayer;
  /**
   * The footprint each end belongs to, by board index, when that end is a pad
   * anchor; absent when it is a track end, a via or a zone. This is
   * `CN_ANCHOR::Parent()` narrowed to the one question
   * `CONNECTIVITY_DATA::GetRatsnestForComponent` asks of it — which component
   * an airwire leaves from. Nothing draws with it.
   */
  aFootprint?: number;
  bFootprint?: number;
}

const layersCompatible = (a: AnchorLayer, b: AnchorLayer): boolean =>
  a === 'through' || b === 'through' || a === b;

/** Copper scope of a pad: through-hole pads join every layer. */
function padLayer(pad: PcbPad): AnchorLayer {
  if (pad.type === 'thru_hole' || pad.type === 'np_thru_hole') return 'through';
  if (pad.layers.some((l) => l === '*.Cu')) return 'through';
  const cu = pad.layers.find((l) => /\.Cu$/.test(l));
  return cu ?? 'through';
}

/** The copper of one net: the shapes to collide, and the anchors to draw from. */
interface NetGeometry {
  pieces: Piece[];
  anchors: Anchor[];
  /** Number of items handed out so far, the union-find's size. */
  items: number;
}

/** Build the airwire list for every net on the board. */
export interface RatsnestOptions {
  /**
   * Only compute these nets, leaving the rest to the caller.
   *
   * A drag moves a handful of nets and leaves the other few hundred exactly as
   * they were, so recomputing all of them every frame is wasted work — 20 ms a
   * frame on the coldfire demo, which is most of a frame's budget. KiCad
   * likewise recomputes only the nets its moved items belong to. Bucketing the
   * board is still linear and cheap; it is the per-net clustering and spanning
   * tree that this skips.
   */
  onlyNets?: ReadonlySet<number>;
}

export function buildRatsnest(board: Board, opts: RatsnestOptions = {}): RatsnestEdge[] {
  return solveNets(bucketNets(board), opts.onlyNets);
}

/**
 * Bucket the board's connected copper per net code (net 0 = no net).
 *
 * Split from the solve so a drag can do it once instead of once a frame, which
 * is what KiCad's connectivity does: `calculateSelectionRatsnest` builds the
 * moving items' `CONNECTIVITY_DATA` on the first frame, blocks them out of the
 * board's own graph with `BlockRatsnestItems`, and thereafter only calls
 * `m_dynamicData->Move( aDelta )`.
 */
function bucketNets(board: Board): Map<number, NetGeometry> {
  const nets = new Map<number, NetGeometry>();
  const forNet = (net: number): NetGeometry => {
    let n = nets.get(net);
    if (!n) {
      n = { pieces: [], anchors: [], items: 0 };
      nets.set(net, n);
    }
    return n;
  };
  const addShape = (g: NetGeometry, item: number, layer: AnchorLayer, shape: Shape): void => {
    g.pieces.push({ item, layer, shape, box: shapeBBox(shape) });
  };

  board.footprints.forEach((fp, fpIndex) => {
    for (const pad of fp.pads) {
      if (!pad.net || pad.net <= 0) continue;
      const g = forNet(pad.net);
      const item = g.items++;
      const layer = padLayer(pad);
      for (const shape of padShapes(pad)) addShape(g, item, layer, shape);
      g.anchors.push({ x: pad.at.x, y: pad.at.y, layer, item, footprint: fpIndex });
    }
  });
  for (const t of board.tracks) {
    if (t.net <= 0) continue;
    const g = forNet(t.net);
    const item = g.items++;
    addShape(g, item, t.layer, { kind: 'stadium', a: t.start, b: t.end, r: t.width / 2 });
    g.anchors.push({ x: t.start.x, y: t.start.y, layer: t.layer, item });
    g.anchors.push({ x: t.end.x, y: t.end.y, layer: t.layer, item });
  }
  for (const a of board.arcs) {
    if (a.net <= 0) continue;
    const g = forNet(a.net);
    const item = g.items++;
    addShape(g, item, a.layer, arcShape(a.start, a.mid, a.end, a.width));
    g.anchors.push({ x: a.start.x, y: a.start.y, layer: a.layer, item });
    g.anchors.push({ x: a.end.x, y: a.end.y, layer: a.layer, item });
  }
  for (const v of board.vias) {
    if (v.net <= 0) continue;
    const g = forNet(v.net);
    const item = g.items++;
    addShape(g, item, 'through', { kind: 'circle', c: v.at, r: v.size / 2 });
    g.anchors.push({ x: v.at.x, y: v.at.y, layer: 'through', item });
  }
  for (const z of board.zones) {
    if (z.net <= 0) continue;
    if (z.fills.length === 0) continue; // unfilled zone: no copper, no connection
    const g = forNet(z.net);
    const item = g.items++;
    // A poured zone connects every same-net item its copper touches. Use the
    // zone outline rather than the fill polygons: a thermal-relieved pad sits in
    // the fill's clearance hole, so it misses the fill even though a spoke
    // connects it, the outline captures that, matching what KiCad's
    // connectivity reports. A zone contributes no anchor: airwires are drawn
    // between pads, vias and track ends, as RN_NET's anchors are.
    if (z.outline && z.outline.length >= 3) {
      for (const layer of z.layers)
        addShape(g, item, layer, { kind: 'poly', pts: z.outline, r: 0 });
    } else {
      // No stored outline, fall back to the fill polygons.
      for (const f of z.fills)
        for (const poly of f.polys)
          if (poly.length >= 3) addShape(g, item, f.layer, { kind: 'poly', pts: poly, r: 0 });
    }
  }

  return nets;
}

/** Turn bucketed nets into airwires, optionally only for some of them. */
function solveNets(nets: Map<number, NetGeometry>, onlyNets?: ReadonlySet<number>): RatsnestEdge[] {
  const edges: RatsnestEdge[] = [];
  for (const [net, g] of nets) {
    if (onlyNets && !onlyNets.has(net)) continue;
    // ----- cluster the items whose copper touches (CN_CONNECTIVITY_ALGO) -----
    const parent = Array.from({ length: g.items }, (_, i) => i);
    const find = (i: number): number => {
      let r = i;
      while (parent[r] !== r) r = parent[r]!;
      // Path compression.
      let c = i;
      while (parent[c] !== c) {
        const next = parent[c]!;
        parent[c] = r;
        c = next;
      }
      return r;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };

    // Sorting by left edge lets the sweep stop as soon as a candidate starts to
    // the right of the current shape (the broad phase runDrc uses; upstream has
    // an R-tree, CN_RTREE).
    const pieces = [...g.pieces].sort((p, q) => p.box.minX - q.box.minX);
    for (let i = 0; i < pieces.length; i++) {
      const A = pieces[i]!;
      for (let j = i + 1; j < pieces.length; j++) {
        const B = pieces[j]!;
        if (B.box.minX > A.box.maxX) break;
        if (A.item === B.item) continue;
        if (B.box.minY > A.box.maxY || A.box.minY > B.box.maxY) continue;
        if (!layersCompatible(A.layer, B.layer)) continue;
        if (find(A.item) === find(B.item)) continue; // already one cluster
        if (shapeDist(A.shape, B.shape) <= 0) union(A.item, B.item);
      }
    }

    // ----- join the clusters with the shortest airwires (RN_NET::kruskalMST) --
    const clusters = new Map<number, Anchor[]>();
    for (const a of g.anchors) {
      const root = find(a.item);
      const c = clusters.get(root);
      if (c) c.push(a);
      else clusters.set(root, [a]);
    }
    const groups = [...clusters.values()];
    if (groups.length < 2) continue;

    // Prim over the cluster graph, whose edge weight is the closest anchor pair
    // of the two clusters: the same minimum spanning tree, and each cluster pair
    // is measured exactly once.
    const inTree = new Array<boolean>(groups.length).fill(false);
    const link = groups.map(() => ({
      d: Infinity,
      from: null as Anchor | null,
      to: null as Anchor | null,
    }));
    const attach = (ci: number): void => {
      inTree[ci] = true;
      for (let j = 0; j < groups.length; j++) {
        if (inTree[j]) continue;
        const best = link[j]!;
        for (const a of groups[ci]!) {
          for (const b of groups[j]!) {
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < best.d) {
              best.d = d;
              best.from = a;
              best.to = b;
            }
          }
        }
      }
    };

    attach(0);
    for (let n = 1; n < groups.length; n++) {
      let pick = -1;
      for (let j = 0; j < groups.length; j++) {
        if (!inTree[j] && (pick < 0 || link[j]!.d < link[pick]!.d)) pick = j;
      }
      if (pick < 0) break;
      const { from, to } = link[pick]!;
      if (from && to) {
        edges.push({
          net,
          ax: from.x,
          ay: from.y,
          bx: to.x,
          by: to.y,
          aLayer: from.layer,
          bLayer: to.layer,
          aFootprint: from.footprint,
          bFootprint: to.footprint,
        });
      }
      attach(pick);
    }
  }

  return edges;
}

/**
 * A drag's airwires, bucketed once and thereafter only moved.
 *
 * This is KiCad's shape exactly. `calculateSelectionRatsnest` builds a
 * `CONNECTIVITY_DATA` holding just the moving items on the first frame and
 * calls `BlockRatsnestItems` so the board's own graph no longer contains them;
 * every frame after that it only calls `m_dynamicData->Move( aDelta )` before
 * joining the two with `ComputeLocalRatsnest`. Nothing is re-bucketed while
 * the mouse is down.
 *
 * Ours: the static board and the moving items are each bucketed once, and each
 * frame copies the handful of affected nets, appends the moving geometry
 * shifted by the delta, and solves only those. On the coldfire demo that takes
 * a drag frame from 13.1 ms to 8.1 ms; bucketing the whole board was most of
 * what it used to spend.
 */
export interface LocalRatsnest {
  /** The nets the moving items belong to; no others can change. */
  readonly nets: ReadonlySet<number>;
  /** Airwires for those nets, with the moving items shifted by `delta`. */
  at(delta: Vec2): RatsnestEdge[];
}

const shiftShape = (s: Shape, dx: number, dy: number): Shape => {
  switch (s.kind) {
    case 'stadium':
      return { ...s, a: { x: s.a.x + dx, y: s.a.y + dy }, b: { x: s.b.x + dx, y: s.b.y + dy } };
    case 'circle':
    case 'arc':
      return { ...s, c: { x: s.c.x + dx, y: s.c.y + dy } };
    case 'poly':
      return { ...s, pts: s.pts.map((p: Vec2) => ({ x: p.x + dx, y: p.y + dy })) };
  }
};

export function prepareLocalRatsnest(staticBoard: Board, movingBoard: Board): LocalRatsnest {
  const staticNets = bucketNets(staticBoard);
  const movingNets = bucketNets(movingBoard);
  return {
    nets: new Set(movingNets.keys()),
    at(delta: Vec2): RatsnestEdge[] {
      const merged = new Map<number, NetGeometry>();
      for (const [net, moving] of movingNets) {
        const base = staticNets.get(net);
        // The moving items' union-find indices continue after the static ones.
        const offset = base?.items ?? 0;
        const pieces = base ? base.pieces.slice() : [];
        const anchors = base ? base.anchors.slice() : [];
        for (const p of moving.pieces) {
          const shape = shiftShape(p.shape, delta.x, delta.y);
          pieces.push({ item: p.item + offset, layer: p.layer, shape, box: shapeBBox(shape) });
        }
        for (const a of moving.anchors)
          anchors.push({ ...a, x: a.x + delta.x, y: a.y + delta.y, item: a.item + offset });
        merged.set(net, { pieces, anchors, items: offset + moving.items });
      }
      return solveNets(merged);
    },
  };
}
