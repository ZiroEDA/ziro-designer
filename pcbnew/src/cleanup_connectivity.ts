// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The slice of pcbnew's connectivity engine the tracks cleaner needs.
 * Counterparts: `CN_VISITOR::operator()` (connectivity_algo.cpp:948) for the
 * link rule, `CN_CONNECTIVITY_ALGO::SearchClusters` (connectivity_algo.cpp:401)
 * for {@link CleanupConnectivity.cluster}, and `CN_ITEM::ConnectedItems()` for
 * {@link CleanupConnectivity.neighbours}.
 *
 * ## Two queries that must not be conflated
 *
 * The merge pass asks two different questions of the same graph and gets two
 * different answers:
 *
 *  - `neighbours` — what *touches* this item. `CN_ITEM::ConnectedItems()`.
 *    The merge candidate scan walks this.
 *  - `cluster` — the whole same-net connected component the item sits in,
 *    which is what `CONNECTIVITY_DATA::GetConnectedItems( item, 0 )` returns.
 *    `testMergeCollinearSegments` walks this.
 *
 * Answering the second with the first would silently loosen every merge test.
 *
 * ## Cross-net links are the point, not a bug
 *
 * `CN_VISITOR` refuses a link only when **neither** side can change net *and*
 * the nets differ. `CanChangeNet()` is false for a pad and true for a track, an
 * arc and any via that is not a free via (connectivity_items.cpp:145/192/208).
 * So track↔track and track↔pad links cross nets freely and only pad↔pad links
 * are net-gated — which is what lets the (unported) shorting pass see a short
 * at all, and what lets a *different-net* track of a different width block a
 * merge in the pass that is ported here.
 *
 * ## Deliberate omissions
 *
 * - **Zones do not participate.** Upstream gives a zone one `CN_ZONE_LAYER` per
 *   filled layer and links it by island containment. Omitting them cannot hide
 *   an item that touches a track end — such an item links to the track directly
 *   too, so it is in the cluster either way — it can only fail to *extend* a
 *   cluster through a pour, and the one thing a zone contributes to the merge
 *   test is `ZONE::HitTest`, which tests the drawn outline rather than the
 *   fill and so almost never fires at a track end.
 * - **Conditional flashing** (`UNCONNECTED_LAYER_MODE` other than `keep_all`)
 *   is not modelled: every pad and via is taken as flashed on every layer of
 *   its span, which is what `FLASHING::ALWAYS_FLASHED` gives for the default
 *   mode. A pad set to drop unused layers therefore links on layers upstream
 *   would not consider.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { padShapes } from './drc/drc_engine.js';
import { shapeBBox, shapeDist, type Shape } from './drc/drc_geometry.js';
import { boardItemId } from './edit-board.js';
import type { Board } from './types.js';

/** The `BOARD_CONNECTED_ITEM` types this graph carries. */
export type CleanupCnType = 'track' | 'arc' | 'via' | 'pad';

/**
 * One `CN_ITEM`. Every kind we model has exactly one, so the item *is* its own
 * connectivity entry and `ItemEntry( item ).GetItems()` is the identity — which
 * is the reason the merge scan's "for each end of the segment" loop runs once
 * rather than twice (see tracks_cleaner.ts).
 */
export interface CleanupCnItem {
  /** `boardItemId()` against the board the caller is working on. */
  id: string;
  type: CleanupCnType;
  net: number;
  /** `BOARD_CONNECTED_ITEM::GetLayerSet()`, already intersected with the
   *  board's enabled layers. Includes technical layers, as upstream's does. */
  layers: readonly string[];
  /** `GetEffectiveShape()`. Layer-independent in this model. */
  shapes: readonly Shape[];
  /** `CN_ITEM::CanChangeNet()`. */
  canChangeNet: boolean;
}

export interface CleanupConnectivity {
  /** `CN_ITEM::ConnectedItems()` — items this one touches, in build order. */
  neighbours(aId: string): readonly CleanupCnItem[];
  /**
   * `CONNECTIVITY_DATA::GetConnectedItems( item, 0 )` — the whole same-net
   * cluster, the item itself included, in breadth-first order from it.
   *
   * Empty for an item with net <= 0: `SearchClusters`' seeding lambda drops
   * those outright when it is searching within nets, so no cluster contains
   * them and the caller gets nothing back. That is why an unnetted collinear
   * pair always merges — every attachment test the merge runs is vacuous.
   */
  cluster(aId: string): readonly CleanupCnItem[];
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const itemBBox = (aItem: CleanupCnItem): BBox => {
  const box: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  for (const shape of aItem.shapes) {
    const b = shapeBBox(shape);
    if (b.minX < box.minX) box.minX = b.minX;
    if (b.minY < box.minY) box.minY = b.minY;
    if (b.maxX > box.maxX) box.maxX = b.maxX;
    if (b.maxY > box.maxY) box.maxY = b.maxY;
  }

  return box;
};

const boxesIntersect = (a: BBox, b: BBox): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/**
 * `CN_VISITOR::operator()` for a pair of items.
 *
 * Upstream's `Dirty()` short-circuit — "if both are dirty, only one of the two
 * reciprocal searches does the expensive work" — is a scheduling detail of an
 * incremental rebuild; a full build like this one visits each unordered pair
 * once anyway, so there is nothing to de-duplicate.
 */
function itemsConnect(aA: CleanupCnItem, aB: CleanupCnItem): boolean {
  // Don't connect items in different nets that can't be changed.
  if (!aA.canChangeNet && !aB.canChangeNet && aA.net !== aB.net) return false;

  const commonLayers = aA.layers.filter((l) => aB.layers.includes(l));

  if (commonLayers.length === 0) return false;

  // The effective shape does not vary by layer in this model, so the first
  // common layer decides for all of them; upstream collides per layer and
  // links on the first hit.
  for (const shapeA of aA.shapes) {
    for (const shapeB of aB.shapes) {
      if (shapeDist(shapeA, shapeB) <= 0) return true;
    }
  }

  return false;
}

/**
 * Build the graph over a fixed set of items.
 *
 * Deliberately takes items rather than a `Board`: the cleaner runs its passes
 * over a working copy whose geometry has already been rewritten by earlier
 * merges, and upstream rebuilds connectivity from exactly that mutated board at
 * the top of every merge iteration. Handing this function a `Board` would make
 * it read stale geometry instead.
 */
export function buildCleanupConnectivity(aItems: readonly CleanupCnItem[]): CleanupConnectivity {
  const byId = new Map<string, CleanupCnItem>();
  const adjacency = new Map<string, CleanupCnItem[]>();

  for (const item of aItems) {
    byId.set(item.id, item);
    adjacency.set(item.id, []);
  }

  const boxes = aItems.map(itemBBox);

  for (let i = 0; i < aItems.length; i++) {
    const a = aItems[i]!;

    for (let j = i + 1; j < aItems.length; j++) {
      const b = aItems[j]!;

      if (!boxesIntersect(boxes[i]!, boxes[j]!)) continue;
      if (!itemsConnect(a, b)) continue;

      adjacency.get(a.id)!.push(b);
      adjacency.get(b.id)!.push(a);
    }
  }

  const clusters = new Map<string, readonly CleanupCnItem[]>();

  const cluster = (aId: string): readonly CleanupCnItem[] => {
    const cached = clusters.get(aId);
    if (cached) return cached;

    const root = byId.get(aId);

    // `withinAnyNet` is true for CSM_CONNECTIVITY_CHECK, so an item with no net
    // is never even seeded and lands in no cluster.
    if (!root || root.net <= 0) {
      clusters.set(aId, []);
      return [];
    }

    const out: CleanupCnItem[] = [];
    const visited = new Set<string>([root.id]);
    const queue: CleanupCnItem[] = [root];

    while (queue.length > 0) {
      const current = queue.shift()!;
      out.push(current);

      for (const n of adjacency.get(current.id) ?? []) {
        if (n.net !== root.net) continue;
        if (visited.has(n.id)) continue;

        visited.add(n.id);
        queue.push(n);
      }
    }

    clusters.set(aId, out);
    return out;
  };

  return {
    neighbours: (aId) => adjacency.get(aId) ?? [],
    cluster,
  };
}

// ---------------------------------------------------------------------------
// Board items as CN_ITEMs

/** A `*.Cu` / `*.Mask` / `*.Paste` wildcard against the board's real layers. */
const expandLayer = (aLayer: string, aEnabled: readonly string[]): string[] => {
  if (!aLayer.startsWith('*.')) return aEnabled.includes(aLayer) ? [aLayer] : [];

  const suffix = aLayer.slice(1); // ".Cu"
  return aEnabled.filter((l) => l.endsWith(suffix));
};

/**
 * Every pad of the board as a `CN_ITEM`.
 *
 * Pads are the only connected items the tracks cleaner never modifies, so they
 * are built once and reused across every rebuild of the graph.
 *
 * `PAD::GetLayerSet()` is the padstack's whole layer set — copper *and* the
 * paste and mask layers — and `CN_VISITOR` intersects those raw layer sets. A
 * pad and a track that share only `F.Mask` (a track with a solder-mask opening)
 * therefore link upstream, and do here.
 */
export function padCnItems(aBoard: Board): CleanupCnItem[] {
  const enabled = aBoard.layers.map((l) => l.name);
  const out: CleanupCnItem[] = [];

  aBoard.footprints.forEach((fp, fpIndex) => {
    fp.pads.forEach((pad, padIndex) => {
      out.push({
        id: boardItemId('pad', fpIndex, padIndex),
        type: 'pad',
        net: pad.net ?? 0,
        layers: pad.layers.flatMap((l) => expandLayer(l, enabled)),
        shapes: padShapes(pad),
        // CN_ITEM for a PAD is constructed with aCanChangeNet = false: a pad's
        // net comes from the netlist and connectivity may not overwrite it.
        canChangeNet: false,
      });
    });
  });

  return out;
}

/** `PAD::HitTest( aPosition, aAccuracy )`, the layer-agnostic overload. */
export function cnItemHitTest(aItem: CleanupCnItem, aPosition: Vec2, aAccuracy: number): boolean {
  const probe: Shape = { kind: 'circle', c: aPosition, r: aAccuracy };

  // Upstream tests `GetEffectivePolygon( layer, ERROR_INSIDE )->Contains()` on
  // each unique padstack layer and then ORs in the hole shape. Our shapes are
  // the exact geometry rather than an inscribed polygon approximation of it, so
  // this answers "is the point within aAccuracy of the copper" without the
  // sub-IU pessimism of the polygon, and the hole is inside the copper for
  // every pad shape we model.
  return aItem.shapes.some((s) => shapeDist(probe, s) <= 0);
}
