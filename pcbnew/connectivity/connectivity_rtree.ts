// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `pcbnew/connectivity/connectivity_rtree.h`. */
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { RTree } from '@ziroeda/kimath/src/thirdparty/rtree.js';

/** `std::numeric_limits<int>::max()` / `min()`: the layer axis of the tree is an `int`. */
export const INT_MAX = 2147483647;
export const INT_MIN = -2147483648;

/** The shape of a CN_ITEM as the tree sees it. */
export interface CN_RTREE_ITEM {
  BBox(): BOX2I;
  StartLayer(): number;
  EndLayer(): number;
}

/**
 * CN_RTREE -
 * Implements an R-tree for fast spatial indexing of connectivity items.
 * Non-owning.
 */
export class CN_RTREE<T extends CN_RTREE_ITEM> {
  private m_tree: RTree<T>;

  constructor() {
    this.m_tree = new RTree<T>(3);
  }

  /**
   * Function Insert()
   * Inserts an item into the tree. Item's bounding box is taken via its BBox() method.
   */
  Insert(aItem: T): void {
    const bbox = aItem.BBox();
    const mmin = [aItem.StartLayer(), bbox.GetX(), bbox.GetY()];
    const mmax = [aItem.EndLayer(), bbox.GetRight(), bbox.GetBottom()];

    this.m_tree.Insert(mmin, mmax, aItem);
  }

  /**
   * Function Remove()
   * Removes an item from the tree. Removal is done by comparing pointers, attempting
   * to remove a copy of the item will fail.
   */
  Remove(aItem: T): void {
    // First, attempt to remove the item using its given BBox
    const bbox = aItem.BBox();
    const mmin = [aItem.StartLayer(), bbox.GetX(), bbox.GetY()];
    const mmax = [aItem.EndLayer(), bbox.GetRight(), bbox.GetBottom()];

    // If we are not successful ( 1 == not found ), then we expand
    // the search to the full tree
    if (this.m_tree.Remove(mmin, mmax, aItem)) {
      // N.B. We must search the whole tree for the pointer to remove
      // because the item may have been moved before we have the chance to
      // delete it from the tree
      const mmin2 = [INT_MIN, INT_MIN, INT_MIN];
      const mmax2 = [INT_MAX, INT_MAX, INT_MAX];
      this.m_tree.Remove(mmin2, mmax2, aItem);
    }
  }

  /**
   * Function RemoveAll()
   * Removes all items from the RTree
   */
  RemoveAll(): void {
    this.m_tree.RemoveAll();
  }

  /**
   * Function Query()
   * Executes a function object aVisitor for each item whose bounding box intersects
   * with aBounds.
   */
  Query(
    aBounds: BOX2I,
    aStartLayer: number,
    aEndLayer: number,
    aVisitor: (aItem: T) => boolean,
  ): void {
    const start_layer = aStartLayer === PCB_LAYER_ID.B_Cu ? INT_MAX : aStartLayer;
    const end_layer = aEndLayer === PCB_LAYER_ID.B_Cu ? INT_MAX : aEndLayer;

    const mmin = [start_layer, aBounds.GetX(), aBounds.GetY()];
    const mmax = [end_layer, aBounds.GetRight(), aBounds.GetBottom()];

    this.m_tree.Search(mmin, mmax, aVisitor);
  }
}
