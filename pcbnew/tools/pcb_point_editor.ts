// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/tools/pcb_point_editor.cpp`: PCB_POINT_EDITOR and its POINT_EDIT_BEHAVIORs.
 */
import { PCB_TOOL_BASE } from './pcb_tool_base.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';

/**
 * `PCB_POINT_EDITOR` (pcb_point_editor.h), the class as far as it is ported:
 * registered under its name so `PCB_SELECTION_TOOL::Main` finds it, as it asks
 * before arming the disambiguation timer on a press
 * (`if( m_frame->ToolStackIsEmpty() && pt_tool && !pt_tool->HasPoint() )`).
 *
 * TRANSITIONAL (#636 stage 3): the point editing itself is still the window's
 * handle drag over the functions above, and the window keeps a press on a
 * handle off the tool dispatcher, so the selection tool never sees one and
 * `m_editedPoint` stays null. The PCB_POINT_EDITOR stage fills this class in.
 */
export class PCB_POINT_EDITOR extends PCB_TOOL_BASE {
  /** `EDIT_POINT* m_editedPoint`: currently edited point, null if there is none. */
  private m_editedPoint: object | null = null;

  constructor() {
    super('pcbnew.PointEditor');
  }

  /** `HasPoint()` (pcb_point_editor.h:70). */
  HasPoint(): boolean {
    return this.m_editedPoint !== null;
  }

  /**
   * `HasMidpoint()` (pcb_point_editor.h:71): the edited point is an EDIT_LINE.
   * TRANSITIONAL (#636 stage 3): the window edits points, so there is none here.
   */
  HasMidpoint(): boolean {
    return false;
  }

  /** `HasCorner()` (pcb_point_editor.h:72). TRANSITIONAL, as HasMidpoint. */
  HasCorner(): boolean {
    return this.HasPoint() && !this.HasMidpoint();
  }

  /** `CanAddCorner( const EDA_ITEM& )` (pcb_point_editor.cpp:1848). */
  static CanAddCorner(aItem: EDA_ITEM): boolean {
    const type = aItem.Type();

    if (type === KICAD_T.PCB_ZONE_T) return true;

    if (type === KICAD_T.PCB_SHAPE_T) {
      const shapeType = (aItem as unknown as { GetShape(): SHAPE_T }).GetShape();
      return (
        shapeType === SHAPE_T.SEGMENT || shapeType === SHAPE_T.POLY || shapeType === SHAPE_T.ARC
      );
    }

    return false;
  }

  /** `CanChamferCorner( const EDA_ITEM& )` (pcb_point_editor.cpp:1866). */
  static CanChamferCorner(aItem: EDA_ITEM): boolean {
    const type = aItem.Type();

    if (type === KICAD_T.PCB_ZONE_T) return true;

    if (type === KICAD_T.PCB_SHAPE_T) {
      const shapeType = (aItem as unknown as { GetShape(): SHAPE_T }).GetShape();
      return shapeType === SHAPE_T.POLY;
    }

    return false;
  }

  /**
   * `CanRemoveCorner( const SELECTION& )` (pcb_point_editor.cpp:3150): false
   * without an edited point. TRANSITIONAL, as HasMidpoint.
   */
  CanRemoveCorner(_aSelection: SELECTION): boolean {
    return this.m_editedPoint !== null;
  }
}
