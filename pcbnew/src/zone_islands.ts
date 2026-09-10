// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CONNECTIVITY_DATA::FillIsolatedIslandsMap` — which outlines of a zone's
 * fill are islands — as the connectivity engine decides it
 * (`connectivity_algo.cpp`: `CN_VISITOR`, `SearchClusters`,
 * `FillIsolatedIslandsMap`; `connectivity_items.h`: `CN_ZONE_LAYER`).
 *
 * Every copper item of a net is a CN_ITEM: a pad (anchored at its shape
 * position, on every copper layer for a through-hole pad and on its one
 * layer otherwise), a track or arc (anchored at both ends), a via (anchored
 * at its centre, spanning its layers), a copper graphic, and — this is what
 * the fill adds — ONE ITEM PER OUTLINE of each zone's fill on each layer.
 * Items connect when their effective shapes collide on a common layer; an
 * item connects to a fill outline when one of its anchors is inside the
 * outline, or failing that when its shape collides with it; two fill
 * outlines connect only when a VERTEX of one lies inside the other. The
 * transitive closure is a cluster, and a cluster with no PAD in it is
 * orphaned (`CN_CLUSTER::IsOrphaned`): every fill outline in it is an
 * island. A track that reaches the pour but no pad anchors nothing.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { arcShape, graphicShapes, padShapes } from './drc/drc_engine.js';
import { chainPointInside } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { segSquaredDistance } from '@ziroeda/kimath/src/trigo.js';
import { shapeBBox, shapeDist, type Shape } from './drc/drc_geometry.js';
import { padShapePos } from './padstack.js';
import type { Board } from './types.js';

/** A fill outline's copper: one fractured ring on one layer of one zone. */
export interface FillOutline {
  zone: number;
  layer: string;
  index: number;
  ring: Vec2[];
}

interface Item {
  /** `CN_CLUSTER::m_originPad`: whether this item is a pad. */
  pad: boolean;
  net: number;
  /** Copper layers the item is on; `null` means every copper layer. */
  layers: Set<string> | null;
  anchors: Vec2[];
  shapes: Shape[];
  outline?: FillOutline;
  box: { minX: number; minY: number; maxX: number; maxY: number };
}

const isCopper = (layer: string): boolean => /\.Cu$/.test(layer);

/** `PAD::IsOnLayer( aLayer )` for copper: a through-hole pad is on them all. */
function padLayers(pad: { type: string; layers: string[] }): Set<string> | null {
  if (pad.type === 'thru_hole' || pad.type === 'np_thru_hole') return null;
  return new Set(pad.layers.filter(isCopper));
}

const boxOfPoints = (pts: readonly Vec2[]): Item['box'] => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};
const boxesIntersect = (a: Item['box'], b: Item['box']): boolean =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
const boxContains = (b: Item['box'], p: Vec2): boolean =>
  p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/**
 * `CN_ZONE_LAYER::ContainsPoint`: the point collides with one of the fill
 * outline's triangles — `SHAPE_LINE_CHAIN_BASE::Collide( aP, 0 )`, which is
 * `PointInside( aP )` (the +x ray cast in `rescale` integer arithmetic) or an
 * edge whose `SEG::SquaredDistance( aP )` — a KiROUNDed integer — is 0: a
 * point within about 0.7 units of an edge is ON it. The outline stands in
 * for its triangles: a point inside the outline is inside some triangle, and
 * a point on the outline is on a triangle's edge.
 */
function outlineContains(ring: Vec2[], p: Vec2): boolean {
  const n = ring.length;
  if (n < 3) return false;
  if (chainPointInside(ring, p)) return true;
  for (let i = 0, j = n - 1; i < n; j = i++)
    if (segSquaredDistance(p, ring[j]!, ring[i]!) === 0) return true;
  return false;
}

/**
 * `FillIsolatedIslandsMap`: for every (zone, layer) in `fills`, the indices of
 * the fill outlines whose cluster holds no pad. `fills` is the whole board's
 * copper as it stands — the fills of zones not being asked about count as
 * copper too.
 */
export function isolatedIslands(
  board: Board,
  fills: FillOutline[],
): Map<number, Map<string, number[]>> {
  const byNet = new Map<number, Item[]>();
  const add = (net: number, item: Item): void => {
    if (net <= 0) return;
    let list = byNet.get(net);
    if (!list) {
      list = [];
      byNet.set(net, list);
    }
    list.push(item);
  };

  for (const fp of board.footprints)
    for (const pad of fp.pads) {
      if (!pad.net || pad.net <= 0) continue;
      const shapes = padShapes(pad);
      add(pad.net, {
        pad: true,
        net: pad.net,
        layers: padLayers(pad),
        anchors: [padShapePos(pad)],
        shapes,
        box: boxOfPoints(
          shapes
            .flatMap((s) => [shapeBBox(s)])
            .flatMap((b) => [
              { x: b.minX, y: b.minY },
              { x: b.maxX, y: b.maxY },
            ]),
        ),
      });
    }
  for (const t of board.tracks) {
    const shape: Shape = { kind: 'stadium', a: t.start, b: t.end, r: t.width / 2 };
    const b = shapeBBox(shape);
    add(t.net, {
      pad: false,
      net: t.net,
      layers: new Set([t.layer]),
      anchors: [t.start, t.end],
      shapes: [shape],
      box: b,
    });
  }
  for (const a of board.arcs) {
    const shape = arcShape(a.start, a.mid, a.end, a.width);
    add(a.net, {
      pad: false,
      net: a.net,
      layers: new Set([a.layer]),
      anchors: [a.start, a.end],
      shapes: [shape],
      box: shapeBBox(shape),
    });
  }
  for (const v of board.vias) {
    const shape: Shape = { kind: 'circle', c: v.at, r: v.size / 2 };
    // `SetLayers( via->TopLayer(), via->BottomLayer() )`: a through via is on
    // every copper layer. (A blind/buried via's span is read as every layer
    // too; the boards this is measured on have none.)
    add(v.net, {
      pad: false,
      net: v.net,
      layers: null,
      anchors: [v.at],
      shapes: [shape],
      box: shapeBBox(shape),
    });
  }
  for (const s of [...board.shapes, ...board.footprints.flatMap((f) => f.shapes ?? [])]) {
    if (!s.net || s.net <= 0 || !isCopper(s.layer)) continue;
    const shapes = graphicShapes(s);
    if (shapes.length === 0) continue;
    // `PCB_SHAPE::GetConnectionPoints`: the ends of a segment or arc, the
    // corners of a rectangle or polygon, nothing for a circle.
    const anchors: Vec2[] = [];
    if (s.kind === 'line' || s.kind === 'arc') {
      if (s.start) anchors.push(s.start);
      if (s.end) anchors.push(s.end);
    } else if (s.kind === 'rect' && s.start && s.end) {
      anchors.push(s.start, { x: s.end.x, y: s.start.y }, s.end, { x: s.start.x, y: s.end.y });
    } else if (s.kind === 'poly' && s.pts) anchors.push(...s.pts);
    const boxes = shapes.map(shapeBBox);
    add(s.net, {
      pad: false,
      net: s.net,
      layers: new Set([s.layer]),
      anchors,
      shapes,
      box: boxOfPoints(
        boxes.flatMap((b) => [
          { x: b.minX, y: b.minY },
          { x: b.maxX, y: b.maxY },
        ]),
      ),
    });
  }
  for (const f of fills) {
    const zone = board.zones[f.zone]!;
    if (zone.net <= 0 || f.ring.length < 3) continue;
    add(zone.net, {
      pad: false,
      net: zone.net,
      layers: new Set([f.layer]),
      anchors: [],
      shapes: [],
      outline: f,
      box: boxOfPoints(f.ring),
    });
  }

  const result = new Map<number, Map<string, number[]>>();
  const record = (f: FillOutline): void => {
    let m = result.get(f.zone);
    if (!m) {
      m = new Map();
      result.set(f.zone, m);
    }
    let list = m.get(f.layer);
    if (!list) {
      list = [];
      m.set(f.layer, list);
    }
    list.push(f.index);
  };

  for (const items of byNet.values()) {
    // union-find over the net's items
    const parent = items.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };
    const unite = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };

    const connected = (a: Item, b: Item): boolean => {
      if (!boxesIntersect(a.box, b.box)) return false;
      if (a.outline && b.outline) {
        // `checkZoneZoneConnection`: the same layer, and a vertex of one inside the other.
        if (a.outline.layer !== b.outline.layer) return false;
        for (const pt of a.outline.ring)
          if (boxContains(b.box, pt) && outlineContains(b.outline.ring, pt)) return true;
        for (const pt of b.outline.ring)
          if (boxContains(a.box, pt) && outlineContains(a.outline.ring, pt)) return true;
        return false;
      }
      if (a.outline || b.outline) {
        // `checkZoneItemConnection`
        const z = a.outline ? a : b;
        const item = a.outline ? b : a;
        const layer = z.outline!.layer;
        if (item.layers !== null && !item.layers.has(layer)) return false;
        for (const p of item.anchors) if (outlineContains(z.outline!.ring, p)) return true;
        const zoneShape: Shape = { kind: 'poly', pts: z.outline!.ring, r: 0 };
        for (const s of item.shapes) if (shapeDist(s, zoneShape) <= 0) return true;
        return false;
      }
      // item to item: effective shapes collide on a common copper layer
      let common: boolean;
      if (a.layers === null) common = b.layers === null || b.layers.size > 0;
      else if (b.layers === null) common = a.layers.size > 0;
      else common = [...a.layers].some((l) => b.layers!.has(l));
      if (!common) return false;
      for (const sa of a.shapes) for (const sb of b.shapes) if (shapeDist(sa, sb) <= 0) return true;
      return false;
    };

    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++)
        if (find(i) !== find(j) && connected(items[i]!, items[j]!)) unite(i, j);

    const hasPad = new Map<number, boolean>();
    items.forEach((it, i) => {
      if (it.pad) hasPad.set(find(i), true);
    });
    items.forEach((it, i) => {
      if (it.outline && !hasPad.get(find(i))) record(it.outline);
    });
  }

  // `notInConnectivity`: a fill on a copper layer that no item joined at all
  // has its outline 0 listed too — here every fill outline is an item, so a
  // fill with outlines always is in the graph.
  return result;
}
