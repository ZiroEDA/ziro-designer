// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/tools/pl_selection.h` + `pl_selection.cpp`:
 * `PL_SELECTION`, the Drawing Sheet Editor's SELECTION.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { SELECTION } from '@ziroeda/common/tool/selection.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';

export class PL_SELECTION extends SELECTION {
  override GetTopLeftItem(_onlyModules = false): EDA_ITEM | null {
    let topLeftItem: EDA_ITEM | null = null;
    let topLeftItemBB: BOX2I | null = null;

    // find the leftmost (smallest x coord) and highest (smallest y with the smallest x) item in the selection
    for (const item of this.m_items) {
      const currentItemBB = item.GetBoundingBox();

      if (topLeftItem === null || topLeftItemBB === null) {
        topLeftItem = item;
        topLeftItemBB = currentItemBB;
      } else if (currentItemBB.GetLeft() < topLeftItemBB.GetLeft()) {
        topLeftItem = item;
        topLeftItemBB = currentItemBB;
      } else if (
        topLeftItemBB.GetLeft() === currentItemBB.GetLeft() &&
        currentItemBB.GetTop() < topLeftItemBB.GetTop()
      ) {
        topLeftItem = item;
        topLeftItemBB = currentItemBB;
      }
    }

    return topLeftItem;
  }
}
