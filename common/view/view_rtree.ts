// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `view/view_rtree.h`: `KIGFX::VIEW_RTREE`, the per-layer spatial index of a
 * VIEW, on KiCad's R-tree (`RTree<VIEW_ITEM*, int, 2, double>`).
 */

import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { INT_MAX, INT_MIN } from '@ziroeda/kimath/src/math/util.js';
import { RTree } from '@ziroeda/kimath/src/thirdparty/rtree.js';
import type { VIEW_ITEM } from './view_item.js';

/**
 * Implement an R-tree for fast spatial and layer indexing of VIEW_ITEMs.
 *
 * Non-owning.
 */
export class VIEW_RTREE extends RTree<VIEW_ITEM> {
  constructor() {
    super(2);
  }

  /**
   * Insert an item into the tree.
   *
   * Item's bounding box is taken via its ViewBBox() method.
   */
  InsertItem(aItem: VIEW_ITEM, bbox: BOX2I): void {
    const mmin = [Math.min(bbox.GetX(), bbox.GetRight()), Math.min(bbox.GetY(), bbox.GetBottom())];
    const mmax = [Math.max(bbox.GetX(), bbox.GetRight()), Math.max(bbox.GetY(), bbox.GetBottom())];

    this.Insert(mmin, mmax, aItem);
  }

  /**
   * Remove an item from the tree.
   *
   * Removal is done by comparing pointers, attempting to remove a copy of the item will fail.
   */
  RemoveItem(aItem: VIEW_ITEM, aBbox: BOX2I | null): void {
    // const BOX2I&    bbox    = aItem->ViewBBox();

    if (aBbox) {
      const mmin = [
        Math.min(aBbox.GetX(), aBbox.GetRight()),
        Math.min(aBbox.GetY(), aBbox.GetBottom()),
      ];
      const mmax = [
        Math.max(aBbox.GetX(), aBbox.GetRight()),
        Math.max(aBbox.GetY(), aBbox.GetBottom()),
      ];
      this.Remove(mmin, mmax, aItem);
      return;
    }

    // FIXME: use cached bbox or ptr_map to speed up pointer <-> node lookups.
    const mmin = [INT_MIN, INT_MIN];
    const mmax = [INT_MAX, INT_MAX];

    this.Remove(mmin, mmax, aItem);
  }

  /**
   * Execute a function object \a aVisitor for each item whose bounding box intersects
   * with \a aBounds.
   */
  Query(aBounds: BOX2I, aVisitor: (aItem: VIEW_ITEM) => boolean): void {
    const mmin = [
      Math.min(aBounds.GetX(), aBounds.GetRight()),
      Math.min(aBounds.GetY(), aBounds.GetBottom()),
    ];
    const mmax = [
      Math.max(aBounds.GetX(), aBounds.GetRight()),
      Math.max(aBounds.GetY(), aBounds.GetBottom()),
    ];

    // We frequently use the maximum bounding box to recache all items
    // or for any item that overflows the integer width limits of BBOX2I
    // in this case, we search the full rtree whose bounds are absolute
    // coordinates rather than relative
    const max_box = new BOX2I();
    max_box.SetMaximum();

    if (aBounds.equals(max_box)) {
      mmin[0] = mmin[1] = INT_MIN;
      mmax[0] = mmax[1] = INT_MAX;
    }

    this.Search(mmin, mmax, aVisitor);
  }
}
