// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/footprint_courtyard_index.h` / `.cpp` (new in 10.0.6):
 * `FOOTPRINT_COURTYARD_INDEX`, a spatial index over footprint courtyard
 * bounding boxes.
 *
 * `intersectsCourtyard()`-style rule predicates otherwise scan every footprint
 * on the board for each item under test, which is O(items x footprints) and
 * dominates DRC on dense boards with courtyard rules. Indexing the courtyards
 * lets those predicates visit only the footprints whose courtyard can
 * actually reach the item, while the precise per-side collision test
 * downstream is unchanged.
 */
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { RTree } from '@ziroeda/kimath/src/thirdparty/rtree.js';
import type { BOARD } from './board.js';
import type { FOOTPRINT } from './footprint.js';

export class FOOTPRINT_COURTYARD_INDEX {
  /** `RTree<FOOTPRINT*, int, 2, double> m_tree`. */
  private readonly m_tree = new RTree<FOOTPRINT>(2);

  /** Build the index from the board's footprint courtyards (which DRC has already cached). */
  constructor(aBoard: BOARD) {
    for (const footprint of aBoard.Footprints()) {
      let bbox: BOX2I | null = null;

      // Index by the union of the front and back courtyard bounds so a single query serves
      // intersectsCourtyard/Front/Back; the downstream per-side test discards any extra hits.
      for (const side of [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu]) {
        const courtyard = footprint.GetCourtyard(side);

        if (courtyard.OutlineCount() === 0) continue;

        if (bbox) bbox.Merge(courtyard.BBox());
        else bbox = courtyard.BBox();
      }

      if (!bbox) continue;

      this.m_tree.Insert(
        [bbox.GetLeft(), bbox.GetTop()],
        [bbox.GetRight(), bbox.GetBottom()],
        footprint,
      );
    }
  }

  /**
   * Visit every footprint whose courtyard bounding box overlaps aBox. The visitor returns true
   * to keep searching and false to stop early, mirroring a linear scan's short-circuit.
   */
  QueryOverlapping(aBox: BOX2I, aVisitor: (aFootprint: FOOTPRINT) => boolean): void {
    this.m_tree.Search(
      [aBox.GetLeft(), aBox.GetTop()],
      [aBox.GetRight(), aBox.GetBottom()],
      aVisitor,
    );
  }
}
