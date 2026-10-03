// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_rtree.h`: `EE_RTREE`, the container a `SCH_SCREEN` keeps its items in: a
 * 3-D R-tree (`RTree<SCH_ITEM*, int, 3, double>`) keyed on (type, x, y) over each item's
 * bounding box inflated by its pen width, taken when the item is inserted. An item moved
 * without `SCH_SCREEN::Update` is found where it was, as upstream; `remove` searches the
 * whole tree when the item is not at its box any more.
 *
 * Iteration is the tree's node order (depth first, branches in order), which ERC reports
 * follow: TestMissingUnits, for one, reports on the first unit of a reference it meets.
 */
import { BaseType, KICAD_T } from '@ziroeda/core/typeinfo.js';
import { RTree } from '@ziroeda/kimath/src/thirdparty/rtree.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { SCH_ITEM } from './sch_item.js';

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

/** The item's (type, x, y) box as the tree stores it: inflated by the pen width. */
function treeRect(aItem: SCH_ITEM): [number[], number[]] {
  const bbox = aItem.GetBoundingBox();
  // Inflate a bit for safety, selection shadows, etc.
  bbox.Inflate(aItem.GetPenWidth());
  const type = aItem.Type() as number;
  return [
    [type, bbox.GetX(), bbox.GetY()],
    [type, bbox.GetRight(), bbox.GetBottom()],
  ];
}

/**
 * Implement an R-tree for fast spatial and type indexing of schematic items.
 * Non-owning.
 */
export class EE_RTREE implements Iterable<SCH_ITEM> {
  private m_tree = new RTree<SCH_ITEM>(3);
  private m_count = 0;

  /** Insert an item into the tree. */
  insert(aItem: SCH_ITEM): void {
    const [mmin, mmax] = treeRect(aItem);
    this.m_tree.Insert(mmin, mmax, aItem);
    this.m_count++;
  }

  /**
   * Remove an item from the tree.
   *
   * Removal is done by comparing pointers, attempting to remove a copy of the item will fail.
   */
  remove(aItem: SCH_ITEM): boolean {
    // First, attempt to remove the item using its given BBox
    const [mmin, mmax] = treeRect(aItem);

    // If we are not successful ( true == not found ), then we expand
    // the search to the full tree
    if (this.m_tree.Remove(mmin, mmax, aItem)) {
      // N.B. We must search the whole tree for the pointer to remove
      // because the item may have been moved before we have the chance to
      // delete it from the tree
      if (this.m_tree.Remove([INT_MIN, INT_MIN, INT_MIN], [INT_MAX, INT_MAX, INT_MAX], aItem))
        return false;
    }

    this.m_count--;
    return true;
  }

  /** Remove all items from the RTree. */
  clear(): void {
    this.m_tree.RemoveAll();
    this.m_count = 0;
  }

  /**
   * Determine if a given item exists in the tree.  Note that this does not search the full
   * tree so if the item has been moved, this will return false when it should be true.
   *
   * @param aItem Item that may potentially exist in the tree.
   * @param aRobust If true, search the whole tree, not just the bounding box.
   */
  contains(aItem: SCH_ITEM, aRobust = false): boolean {
    const [mmin, mmax] = treeRect(aItem);
    let found = false;

    const search = (aSearchItem: SCH_ITEM) => {
      if (aSearchItem === aItem) {
        found = true;
        return false;
      }

      return true;
    };

    this.m_tree.Search(mmin, mmax, search);

    if (!found && aRobust) {
      // N.B. We must search the whole tree for the pointer to remove
      // because the item may have been moved.  We do not expand the item
      // type search as this should not change.
      const type = aItem.Type() as number;
      this.m_tree.Search([type, INT_MIN, INT_MIN], [type, INT_MAX, INT_MAX], search);
    }

    return found;
  }

  /** Return the number of items in the tree. */
  size(): number {
    return this.m_count;
  }

  empty(): boolean {
    return this.m_count === 0;
  }

  /** `EE_TYPE`: the items of \a aType (SCH_LOCATE_ANY_T: every type) whose box meets \a aRect. */
  private eeType(aType: KICAD_T, aRect: BOX2I | null): SCH_ITEM[] {
    const type = BaseType(aType);
    const any = type === KICAD_T.SCH_LOCATE_ANY_T;
    const mmin = [
      any ? INT_MIN : type,
      aRect ? aRect.GetX() : INT_MIN,
      aRect ? aRect.GetY() : INT_MIN,
    ];
    const mmax = [
      any ? INT_MAX : type,
      aRect ? aRect.GetRight() : INT_MAX,
      aRect ? aRect.GetBottom() : INT_MAX,
    ];
    const out: SCH_ITEM[] = [];

    this.m_tree.Search(mmin, mmax, (aItem) => {
      out.push(aItem);
      return true;
    });

    return out;
  }

  /** Return the items of one type, in the tree's order. */
  OfType(aType: KICAD_T): SCH_ITEM[] {
    return this.eeType(aType, null);
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

    return this.eeType(aType ?? KICAD_T.SCH_LOCATE_ANY_T, rect);
  }

  *[Symbol.iterator](): Iterator<SCH_ITEM> {
    yield* this.eeType(KICAD_T.SCH_LOCATE_ANY_T, null);
  }
}

/** The forward-declaration name the item classes were written against. */
export type EE_RTREE_LIKE = EE_RTREE;
