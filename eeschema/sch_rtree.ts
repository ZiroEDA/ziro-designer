// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_rtree.h`: `EE_RTREE`, the container a `SCH_SCREEN` keeps its items in
 * (eeschema stage E3).
 *
 * Upstream is a 3-D R-tree keyed on (type, x, y) over each item's bounding box inflated
 * by its pen width, taken when the item is inserted. Here the items are kept per type in
 * insertion order, and a spatial query tests each item's box when it is asked; so a
 * query sees where an item is now, not where it was when it was inserted (upstream's
 * `remove` searches the whole tree for exactly that reason). Whole-tree iteration is by
 * type, then insertion order; upstream's is the tree's node order, which nothing that is
 * written to a file depends on (the writer sorts).
 */

import type { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { SCH_ITEM } from './sch_item.js';

/** The item's box as the tree stores it: inflated by the pen width. */
function treeBox(aItem: SCH_ITEM): BOX2I {
  const bbox = aItem.GetBoundingBox();

  // Inflate a bit for safety, selection shadows, etc.
  bbox.Inflate(aItem.GetPenWidth());
  return bbox;
}

/**
 * Implement an R-tree for fast spatial and type indexing of schematic items.
 * Non-owning.
 */
export class EE_RTREE implements Iterable<SCH_ITEM> {
  private m_tree = new Map<KICAD_T, SCH_ITEM[]>();
  private m_count = 0;

  /** Insert an item into the tree. */
  insert(aItem: SCH_ITEM): void {
    let bucket = this.m_tree.get(aItem.Type());

    if (!bucket) {
      bucket = [];
      this.m_tree.set(aItem.Type(), bucket);
    }

    bucket.push(aItem);
    this.m_count++;
  }

  /**
   * Remove an item from the tree.
   *
   * Removal is done by comparing pointers, attempting to remove a copy of the item will fail.
   */
  remove(aItem: SCH_ITEM): boolean {
    const bucket = this.m_tree.get(aItem.Type());
    const i = bucket ? bucket.indexOf(aItem) : -1;

    if (i < 0) return false;

    bucket!.splice(i, 1);
    this.m_count--;
    return true;
  }

  /** Remove all items from the RTree. */
  clear(): void {
    this.m_tree.clear();
    this.m_count = 0;
  }

  /**
   * Determine if a given item exists in the tree.  Upstream's non-robust test only
   * looks inside the item's box, which is where it always is here.
   */
  contains(aItem: SCH_ITEM, _aRobust = false): boolean {
    return this.m_tree.get(aItem.Type())?.includes(aItem) ?? false;
  }

  /** Return the number of items in the tree. */
  size(): number {
    return this.m_count;
  }

  empty(): boolean {
    return this.m_count === 0;
  }

  /** Return the items of one type. */
  OfType(aType: KICAD_T): SCH_ITEM[] {
    return [...(this.m_tree.get(aType) ?? [])];
  }

  /**
   * `Overlapping( aRect )`, `Overlapping( aPoint, aAccuracy )`, `Overlapping( aType, aPoint,
   * aAccuracy )`, `Overlapping( aType, aRect )`. A null type is every type.
   */
  Overlapping(aRect: BOX2I): SCH_ITEM[];
  Overlapping(aPoint: VECTOR2I, aAccuracy?: number): SCH_ITEM[];
  Overlapping(
    aType: KICAD_T | null,
    aPointOrRect: VECTOR2I | BOX2I,
    aAccuracy?: number,
  ): SCH_ITEM[];
  Overlapping(
    a: KICAD_T | null | BOX2I | VECTOR2I,
    b?: VECTOR2I | BOX2I | number,
    c?: number,
  ): SCH_ITEM[] {
    let aType: KICAD_T | null;
    let where: VECTOR2I | BOX2I;
    let accuracy: number;

    if (a === null || typeof a === 'number') {
      aType = a;
      where = b as VECTOR2I | BOX2I;
      accuracy = c ?? 0;
    } else {
      aType = null;
      where = a;
      accuracy = (b as number | undefined) ?? 0;
    }

    let rect: BOX2I;

    if (where instanceof BOX2I) {
      rect = where;
    } else {
      rect = new BOX2I(where, { x: 0, y: 0 });
      rect.Inflate(accuracy);
    }

    const out: SCH_ITEM[] = [];

    for (const item of aType === null ? this : (this.m_tree.get(aType) ?? [])) {
      if (treeBox(item).Intersects(rect)) out.push(item);
    }

    return out;
  }

  *[Symbol.iterator](): Iterator<SCH_ITEM> {
    const types = [...this.m_tree.keys()].sort((x, y) => x - y);

    for (const type of types) yield* [...this.m_tree.get(type)!];
  }
}

/** The forward-declaration name the item classes were written against. */
export type EE_RTREE_LIKE = EE_RTREE;
