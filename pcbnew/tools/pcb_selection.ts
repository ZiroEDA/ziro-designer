// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/tools/pcb_selection.h` + `.cpp`: the board editor's SELECTION -
 * the VIEW_GROUP the selection tool puts on LAYER_SELECT_OVERLAY, whose draw
 * list is the selected items and their children (a footprint's pads, texts,
 * shapes and zones).
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { SELECTION } from '@ziroeda/common/tool/selection.js';
import type { VIEW_ITEM } from '@ziroeda/common/view/view_item.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { FOOTPRINT } from '../footprint.js';

export class PCB_SELECTION extends SELECTION {
  override GetTopLeftItem(aFootprintsOnly = false): EDA_ITEM | null {
    let topLeftItem: EDA_ITEM | null = null;

    // find the leftmost (smallest x coord) and highest (smallest y with the smallest x) item in the selection
    for (const item of this.m_items) {
      const pnt = item.GetPosition();

      if (item.Type() !== KICAD_T.PCB_FOOTPRINT_T && aFootprintsOnly) {
      } else {
        if (topLeftItem === null) {
          topLeftItem = item;
        } else if (
          pnt.x < topLeftItem.GetPosition().x ||
          (topLeftItem.GetPosition().x === pnt.x && pnt.y < topLeftItem.GetPosition().y)
        ) {
          topLeftItem = item;
        }
      }
    }

    return topLeftItem;
  }

  protected override updateDrawList(): VIEW_ITEM[] {
    const items: VIEW_ITEM[] = [];

    const addItem = (item: EDA_ITEM): void => {
      items.push(item);

      if (item.IsBOARD_ITEM()) {
        const boardItem = item as BOARD_ITEM;

        boardItem.RunOnChildren((childItem: BOARD_ITEM) => {
          addItem(childItem);
        }, RECURSE_MODE.NO_RECURSE);
      }
    };

    for (const item of this.m_items) addItem(item);

    return items;
  }

  override GetBoundingBox(): BOX2I {
    const bbox = new BOX2I();

    for (const item of this.m_items) {
      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        const footprint = item as FOOTPRINT;

        bbox.Merge(footprint.GetBoundingBox(true));
      } else {
        bbox.Merge(item.GetBoundingBox());
      }
    }

    return bbox;
  }
}
