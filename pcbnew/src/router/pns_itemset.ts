// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A list of board items that can be sieved by net, kind, layer or marker.
 * Counterparts: `pcbnew/router/pns_itemset.h` and `pns_itemset.cpp` (`ITEM_SET`).
 *
 * Despite the name it is a *sequence*, not a set: order is insertion order,
 * duplicates are permitted, and `operator[]` is meaningful. A joint's link list
 * is one of these, and `JOINT::IsLineCorner` reads `[0]` and `[1]` positionally,
 * so the ordering is not incidental.
 *
 * Every filter mutates in place and returns itself, which is what lets upstream
 * chain them. That is worth knowing before writing `const kept = set.filterNet(n)`
 * and expecting `set` to be untouched — it will not be.
 *
 * ## `filterMarker` ignores its `aInvert` argument
 *
 * Upstream takes the parameter, documents it by analogy with its three
 * siblings, and then never reads it — the body is a plain `if( item->Marker() &
 * aMarker )` with no `^ aInvert`. That is a bug, it is still there, and it is
 * reproduced here, because `ExcludeMarker` does not exist as a caller and
 * "fixing" it would make this port disagree with the router it is a port of.
 */
import { PnsLayerRange } from './pns_layerset.js';
import { PnsKind, type PnsItem } from './pns_item.js';
import type { NetHandle } from './pns_collision.js';
import type { Seg } from './pns_line.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** The `dyn_cast<SEGMENT*>` inside `FindVertex`, structurally. */
interface PnsSegmentLike {
  seg(): Seg;
}

/** `ITEM_SET`. */
export class PnsItemSet {
  private mItems: PnsItem[] = [];

  constructor(aInitialItem: PnsItem | null = null, aBecomeOwner = false) {
    if (aInitialItem) this.mItems.push(aInitialItem);

    if (aBecomeOwner && aInitialItem) aInitialItem.setOwner(this);
  }

  /** `ITEM_SET( const ITEM_SET& )`: the pointers are copied, the items are not. */
  clone(): PnsItemSet {
    const copy = new PnsItemSet();
    copy.mItems = [...this.mItems];
    return copy;
  }

  /**
   * How many items match the mask.
   *
   * `-1` and `ANY_T` short-circuit to the whole size, and that is not merely an
   * optimisation: the loop tests `kind & mask`, and `INVALID_T` is *zero*, so an
   * item of no kind matches no mask at all — not even `-1`. Without the
   * short-circuit, "how many items are in this set" would quietly under-count
   * exactly the items a caller is least likely to be expecting.
   */
  count(aKindMask = -1): number {
    if (aKindMask === -1 || aKindMask === PnsKind.ANY_T) return this.mItems.length;

    let n = 0;

    for (const item of this.mItems) {
      if (item.kind() & aKindMask) n++;
    }

    return n;
  }

  empty(): boolean {
    return this.mItems.length === 0;
  }

  /** The live backing array, as upstream hands back a mutable reference. */
  items(): PnsItem[] {
    return this.mItems;
  }

  citems(): readonly PnsItem[] {
    return this.mItems;
  }

  /** Keep the items overlapping the layer span. A negative end means one layer. */
  filterLayers(aStart: number, aEnd = -1, aInvert = false): this {
    const l = aEnd < 0 ? new PnsLayerRange(aStart) : new PnsLayerRange(aStart, aEnd);

    this.mItems = this.mItems.filter((item) => item.layers().overlaps(l) !== aInvert);
    return this;
  }

  filterKinds(aKindMask: number, aInvert = false): this {
    this.mItems = this.mItems.filter((item) => item.ofKind(aKindMask) !== aInvert);
    return this;
  }

  filterNet(aNet: NetHandle, aInvert = false): this {
    this.mItems = this.mItems.filter((item) => (item.net() === aNet) !== aInvert);
    return this;
  }

  /** Upstream never reads `aInvert` here; see the module note. */
  filterMarker(aMarker: number, _aInvert = false): this {
    this.mItems = this.mItems.filter((item) => (item.marker() & aMarker) !== 0);
    return this;
  }

  excludeLayers(aStart: number, aEnd = -1): this {
    return this.filterLayers(aStart, aEnd, true);
  }

  excludeKinds(aKindMask: number): this {
    return this.filterKinds(aKindMask, true);
  }

  excludeNet(aNet: NetHandle): this {
    return this.filterNet(aNet, true);
  }

  excludeItem(aItem: PnsItem): this {
    this.mItems = this.mItems.filter((item) => item !== aItem);
    return this;
  }

  size(): number {
    return this.mItems.length;
  }

  at(aIndex: number): PnsItem | undefined {
    return this.mItems[aIndex];
  }

  add(aItem: PnsItem, aBecomeOwner = false): void {
    this.mItems.push(aItem);

    if (aBecomeOwner) aItem.setOwner(this);
  }

  prepend(aItem: PnsItem, aBecomeOwner = false): void {
    this.mItems.unshift(aItem);

    if (aBecomeOwner) aItem.setOwner(this);
  }

  clear(): void {
    this.mItems = [];
  }

  contains(aItem: PnsItem): boolean {
    return this.mItems.includes(aItem);
  }

  /** Remove the first occurrence, if any. */
  erase(aItem: PnsItem): void {
    const i = this.mItems.indexOf(aItem);

    if (i >= 0) this.mItems.splice(i, 1);
  }

  /** The `aIndex`-th item matching the kind mask, or null. */
  findByKind(aKind: PnsKind, aIndex = 0): PnsItem | null {
    let n = 0;

    for (const item of this.mItems) {
      if (item.ofKind(aKind)) {
        if (aIndex === n) return item;
        n++;
      }
    }

    return null;
  }

  /** The first segment with an endpoint at `aV`. Upstream's `fixme: biconnected concept`. */
  findVertex(aV: Vec2): PnsItem | null {
    for (const item of this.mItems) {
      if (item.kind() !== PnsKind.SEGMENT_T) continue;

      const seg = (item as unknown as PnsSegmentLike).seg();

      if ((seg.a.x === aV.x && seg.a.y === aV.y) || (seg.b.x === aV.x && seg.b.y === aV.y)) {
        return item;
      }
    }

    return null;
  }

  [Symbol.iterator](): Iterator<PnsItem> {
    return this.mItems[Symbol.iterator]();
  }
}
