// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOARD_EDGES_BOUNDING_ITEM` - `pcbnew/zone_manager/board_edges_bounding_item.{h,cpp}`:
 * a VIEW_ITEM standing for the bounding box of the board edges, on Edge_Cuts.
 * The zone preview's painter fills its `ViewBBox()`.
 */
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { VIEW_ITEM } from '@ziroeda/common/view/view_item.js';

export class BOARD_EDGES_BOUNDING_ITEM extends VIEW_ITEM {
  private m_box: BOX2I;

  constructor(aBox: BOX2I) {
    super();
    this.m_box = aBox;
  }

  GetClass(): string {
    return 'BOARD_EDGES_BOUNDING_ITEM';
  }

  ViewBBox(): BOX2I {
    return this.m_box;
  }

  ViewGetLayers(): number[] {
    return [PCB_LAYER_ID.Edge_Cuts];
  }
}
