// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The router's spatial index: everything on the board, filed by layer and by
 * net so a collision search touches as little of it as possible.
 * Counterparts: `pcbnew/router/pns_index.h` and `pns_index.cpp` (`INDEX`), over
 * `libs/kimath/include/geometry/shape_index.h` (`SHAPE_INDEX`).
 *
 * Three views of the same items, kept in step by `add`/`remove`:
 *
 *  - **one bucket per layer**, holding the items present on that layer, which is
 *    what a proximity query walks;
 *  - **one list per net**, which is how "everything on this net" is answered
 *    without touching geometry at all;
 *  - **one set of everything**, which is what `size()`, iteration, and
 *    `contains()` read.
 *
 * A multilayer item is in *several* layer buckets and is therefore visited once
 * per layer by a query that spans them. That is not a defect to be deduplicated
 * here — the caller's obstacle set does the collapsing, keyed on the pair of
 * items, which is precisely why that set exists.
 *
 * ## What replaces the R-tree, and what that costs
 *
 * Upstream's per-layer bucket is a copy-on-write R-tree. Here it is an
 * insertion-ordered array with a bounding-box test per entry. The *candidate
 * set* is identical — an R-tree query is a bounding-box overlap query and
 * nothing more, with the exact test left to the visitor — so every collision
 * verdict is unchanged. Three differences are worth naming:
 *
 *  - **Order.** The R-tree visits in tree order, which depends on insertion
 *    history and node splits; this visits in insertion order, which is
 *    deterministic. Deterministic is the better of the two for a port.
 *  - **Early-out.** Upstream's visitor returning false aborts only the *leaf*
 *    it is in; the search then carries on with the tree's other leaves. Here it
 *    stops the bucket. Upstream's behaviour is not reproducible without its tree
 *    topology, and stopping is what its own documentation says happens.
 *  - **Complexity.** Linear per bucket rather than logarithmic. The buckets are
 *    per layer, so this is the honest cost of not porting the R-tree, and it is
 *    the piece to replace first if the router ever needs to be fast.
 *
 * `clone` is likewise a shallow array copy rather than a refcount bump: same
 * observable result, O(n) instead of O(1).
 *
 * ## Deferred mode
 *
 * `setDeferred(true)` makes `add` register an item in the net map and the
 * all-items set but skip the layer buckets; `buildSpatialIndex()` then fills
 * every bucket in one pass. Upstream does this so a board can be loaded without
 * paying for an R-tree insertion per item. It is kept because `NODE::BeginBulkAdd`
 * calls it, and because it has an observable consequence: between the two calls,
 * queries find nothing while `getItemsForNet` finds everything.
 */
import { shapeBBox } from '../drc/drc_geometry.js';
import { hasNet, type NetHandle } from './pns_collision.js';
import { PnsKind, type PnsItem } from './pns_item.js';
import type { Shape } from '../drc/drc_geometry.js';

/** An axis-aligned box, as `BOX2I`. */
interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const boxesOverlap = (a: Box, b: Box): boolean =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

const inflate = (a: Box, d: number): Box => ({
  minX: a.minX - d,
  minY: a.minY - d,
  maxX: a.maxX + d,
  maxY: a.maxY + d,
});

/**
 * A visitor. Returning false stops the scan of the bucket it is in — see the
 * early-out note in the module docblock.
 */
export interface IndexVisitor {
  (item: PnsItem): boolean;
  /** `LAYER_CONTEXT_SETTER`: which sub-index is being walked right now. */
  setLayerContext?(layer: number): void;
  clearLayerContext?(): void;
}

/** One layer's bucket: `SHAPE_INDEX<ITEM*>` for that layer. */
class LayerSubIndex {
  private entries: { item: PnsItem; box: Box }[] = [];

  constructor(private readonly shapeLayer: number) {}

  clone(): LayerSubIndex {
    const c = new LayerSubIndex(this.shapeLayer);
    c.entries = this.entries.map((e) => ({ item: e.item, box: e.box }));
    return c;
  }

  /**
   * `boundingBox( aItem, m_shapeLayer )`. Upstream would dereference a null
   * shape here; an item with no shape on this layer is simply not filed on it,
   * which is the same choice `INDEX::Query` already makes on the way out.
   */
  add(aItem: PnsItem): void {
    const shape = aItem.shape(this.shapeLayer);

    if (!shape) return;

    this.entries.push({ item: aItem, box: shapeBBox(shape) });
  }

  addWithBox(aItem: PnsItem, aBox: Box): void {
    this.entries.push({ item: aItem, box: aBox });
  }

  /**
   * Upstream removes by searching the tree with the item's *current* bounding
   * box, so an item whose shape moved since it was added can survive removal.
   * Removal is by identity here, which cannot fail that way.
   */
  remove(aItem: PnsItem): void {
    const i = this.entries.findIndex((e) => e.item === aItem);

    if (i >= 0) this.entries.splice(i, 1);
  }

  /** `BulkLoad`: replaces all existing content. */
  bulkLoad(aItems: { item: PnsItem; box: Box }[]): void {
    this.entries = aItems.map((e) => ({ item: e.item, box: e.box }));
  }

  /**
   * Visit every item whose box lies within `aMinDistance` of the query shape's
   * box. Returns how many were found, counting the one that stopped the scan.
   */
  query(aShape: Shape, aMinDistance: number, aVisitor: IndexVisitor): number {
    const box = inflate(shapeBBox(aShape), aMinDistance);
    let found = 0;

    for (const e of this.entries) {
      if (!boxesOverlap(e.box, box)) continue;

      found++;

      if (!aVisitor(e.item)) return found;
    }

    return found;
  }

  size(): number {
    return this.entries.length;
  }
}

/**
 * Custom spatial index, holding the board items and allowing for very fast
 * searches. Items are assigned to separate sub-indices depending on the layers
 * they span, reducing overlap and improving search time.
 */
export class PnsIndex {
  private subIndices: LayerSubIndex[] = [];
  private netMap = new Map<NetHandle, PnsItem[]>();
  private allItems = new Set<PnsItem>();
  private deferred = false;

  /**
   * When deferred, `add` registers items in the metadata but skips the layer
   * buckets. Call `buildSpatialIndex()` to fill them in one pass.
   */
  setDeferred(aDeferred: boolean): void {
    this.deferred = aDeferred;
  }

  /** Fill the layer buckets from every registered item. */
  buildSpatialIndex(): void {
    // Group items by sub-index layer.
    const layerItems = new Map<number, { item: PnsItem; box: Box }[]>();

    for (const item of this.allItems) {
      const range = item.layers();

      for (let i = range.start(); i <= range.end(); i++) {
        const shape = item.shape(i);

        if (!shape) continue;

        let bucket = layerItems.get(i);

        if (!bucket) {
          bucket = [];
          layerItems.set(i, bucket);
        }

        bucket.push({ item, box: shapeBBox(shape) });
      }
    }

    for (const [layerId, items] of layerItems) {
      const sub = this.subIndices[layerId];

      if (sub) sub.bulkLoad(items);
    }
  }

  /**
   * A copy of this index. The buckets and the net lists are new containers over
   * the same items; the deferred flag is *not* carried over, matching upstream's
   * clone, which builds a default-constructed `INDEX` and fills three fields.
   */
  clone(): PnsIndex {
    const c = new PnsIndex();
    c.subIndices = this.subIndices.map((si) => si.clone());

    for (const [net, items] of this.netMap) c.netMap.set(net, [...items]);

    c.allItems = new Set(this.allItems);
    return c;
  }

  /** Add an item to the index. */
  add(aItem: PnsItem): void {
    const range = aItem.layers();

    if (range.start() === -1 || range.end() === -1) {
      throw new Error('PNS: INDEX::Add of an item with no layers');
    }

    if (this.subIndices.length <= range.end()) {
      for (let i = this.subIndices.length; i <= range.end(); i++) {
        this.subIndices.push(new LayerSubIndex(i));
      }
    }

    if (!this.deferred) {
      for (let i = range.start(); i <= range.end(); i++) this.subIndices[i]?.add(aItem);
    }

    this.allItems.add(aItem);
    const net = aItem.net();

    if (hasNet(net)) {
      const list = this.netMap.get(net);

      if (list) list.push(aItem);
      else this.netMap.set(net, [aItem]);
    }
  }

  /**
   * Remove an item from the index.
   *
   * Note the early return: an item whose layers reach past the last bucket that
   * was ever created cannot be in the index, and upstream bails before touching
   * the all-items set or the net map. So does this.
   */
  remove(aItem: PnsItem): void {
    const range = aItem.layers();

    if (range.start() === -1 || range.end() === -1) {
      throw new Error('PNS: INDEX::Remove of an item with no layers');
    }

    if (this.subIndices.length <= range.end()) return;

    for (let i = range.start(); i <= range.end(); i++) this.subIndices[i]?.remove(aItem);

    this.allItems.delete(aItem);
    const net = aItem.net();

    if (hasNet(net)) {
      const list = this.netMap.get(net);

      // `std::list::remove` takes out *every* occurrence, and `add` does not
      // guard against filing the same item twice.
      if (list)
        this.netMap.set(
          net,
          list.filter((i) => i !== aItem),
        );
    }
  }

  /** Replace one item with another. */
  replace(aOldItem: PnsItem, aNewItem: PnsItem): void {
    this.remove(aOldItem);
    this.add(aNewItem);
  }

  /**
   * Search for items in proximity of `aItem`, on the layers it spans and only
   * there. The visitor is told which layer it is being called for.
   *
   * @returns the number of items found, summed across layers — a multilayer
   *          item in the way is counted once per shared layer.
   */
  query(aItem: PnsItem, aMinDistance: number, aVisitor: IndexVisitor): number {
    if (aItem.kind() === PnsKind.INVALID_T) return 0;

    let total = 0;
    const layers = aItem.layers();

    for (let i = layers.start(); i <= layers.end(); i++) {
      const shape = aItem.shape(i);

      if (shape) total += this.querySingle(i, shape, aMinDistance, aVisitor);
    }

    return total;
  }

  /**
   * Search for items in proximity of a bare shape. Every layer is searched and
   * all of them are treated as colliding.
   */
  queryShape(aShape: Shape, aMinDistance: number, aVisitor: IndexVisitor): number {
    let total = 0;

    for (let i = 0; i < this.subIndices.length; i++) {
      total += this.querySingle(i, aShape, aMinDistance, aVisitor);
    }

    return total;
  }

  private querySingle(
    aIndex: number,
    aShape: Shape,
    aMinDistance: number,
    aVisitor: IndexVisitor,
  ): number {
    const sub = this.subIndices[aIndex];

    if (!sub) return 0;

    // `LAYER_CONTEXT_SETTER`: scoped, and cleared however the query leaves.
    aVisitor.setLayerContext?.(aIndex);

    try {
      return sub.query(aShape, aMinDistance, aVisitor);
    } finally {
      aVisitor.clearLayerContext?.();
    }
  }

  /**
   * Every item on a net, or null if the net has never been filed. Note that a
   * net whose items have all been removed keeps an *empty* list rather than
   * disappearing, so this returns `[]` and not null for it.
   */
  getItemsForNet(aNet: NetHandle): PnsItem[] | null {
    return this.netMap.get(aNet) ?? null;
  }

  contains(aItem: PnsItem): boolean {
    return this.allItems.has(aItem);
  }

  size(): number {
    return this.allItems.size;
  }

  [Symbol.iterator](): Iterator<PnsItem> {
    return this.allItems[Symbol.iterator]();
  }
}
