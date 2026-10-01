// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/tools/pcb_tool_utils.cpp`: helpers several PCB tools share.
 */
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_TRACK } from '../pcb_track.js';

/**
 * Get the width of a BOARD_ITEM, for items that have a meaningful width.
 *
 * @return the width, or null if the item has no meaningful width
 */
export function GetBoardItemWidth(aItem: BOARD_ITEM): number | null {
  switch (aItem.Type()) {
    case KICAD_T.PCB_SHAPE_T: {
      const shape = aItem as unknown as PCB_SHAPE;

      if (shape.GetShape() === SHAPE_T.SEGMENT) return shape.GetWidth();

      if (shape.GetWidth() && !shape.IsSolidFill()) return shape.GetWidth();

      break;
    }

    case KICAD_T.PCB_TRACE_T:
    case KICAD_T.PCB_ARC_T: {
      const track = aItem as unknown as PCB_TRACK;
      return track.GetWidth();
    }

    default:
      break;
  }

  return null;
}
