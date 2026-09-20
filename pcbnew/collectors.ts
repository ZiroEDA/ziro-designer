// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/collectors.h` + `.cpp`: the COLLECTOR implementations used to
 * augment the functionality of class PCB_EDIT_FRAME.
 *
 * `PCB_COLLECTOR`, `PCB_TYPE_COLLECTOR` and `PCB_LAYER_COLLECTOR` are here;
 * `GENERAL_COLLECTOR` (the selection tool's hit-testing collector, with its
 * guides) lands with PCB_SELECTION_TOOL (#636 stage 3).
 */
import { COLLECTOR } from '@ziroeda/common/src/collector.js';
import type { EDA_ITEM } from '@ziroeda/common/src/eda_item.js';
import { INSPECT_RESULT } from '@ziroeda/common/src/eda_item.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { BOARD_ITEM } from './board_item.js';

/**
 * Override #COLLECTOR to allow for #BOARD_ITEM specific access.
 */
export class PCB_COLLECTOR extends COLLECTOR {
  /**
   * Overload the COLLECTOR::operator[](int) to return a #BOARD_ITEM instead of an #EDA_ITEM.
   *
   * @param ndx The index into the list.
   * @return a board item or NULL.
   */
  override at(ndx: number): BOARD_ITEM | null {
    if (ndx >= 0 && ndx < this.GetCount()) return this.m_list[ndx] as BOARD_ITEM;

    return null;
  }
}

/**
 * Collect all #BOARD_ITEM objects of a given set of #KICAD_T type(s).
 */
export class PCB_TYPE_COLLECTOR extends PCB_COLLECTOR {
  /**
   * The examining function within the INSPECTOR which is passed to the Iterate function.
   *
   * @param testItem An EDA_ITEM to examine.
   * @param testData is not used in this class.
   * @return SEARCH_QUIT if the Iterator is to stop the scan, else SCAN_CONTINUE
   */
  override Inspect(testItem: EDA_ITEM, _testData: unknown): INSPECT_RESULT {
    // The Visit() function only visits the testItem if its type was in the the scanList,
    // so therefore we can collect anything given to us here.
    this.Append(testItem);

    return INSPECT_RESULT.CONTINUE; // always when collecting
  }

  /**
   * Collect #BOARD_ITEM objects using this class's Inspector method, which does the collection.
   *
   * @param aBoard The BOARD_ITEM to scan.
   * @param aTypes The KICAD_Ts to gather up.
   */
  Collect(aBoard: BOARD_ITEM, aTypes: readonly KICAD_T[]): void {
    this.Empty();
    aBoard.Visit(this.m_inspector, null, aTypes);
  }
}

/**
 * Collect all #BOARD_ITEM objects on a given layer.
 *
 * This only uses the primary object layer for comparison.
 */
export class PCB_LAYER_COLLECTOR extends PCB_COLLECTOR {
  private m_layer_id: PCB_LAYER_ID;

  constructor(aLayerId: PCB_LAYER_ID) {
    super();
    this.m_layer_id = aLayerId;
  }

  SetLayerId(aLayerId: PCB_LAYER_ID): void {
    this.m_layer_id = aLayerId;
  }

  /**
   * The examining function within the INSPECTOR which is passed to the iterate function.
   *
   * @param testItem An EDA_ITEM to examine.
   * @param testData is not used in this class.
   * @return SEARCH_QUIT if the Iterator is to stop the scan, else SCAN_CONTINUE
   */
  override Inspect(testItem: EDA_ITEM, _testData: unknown): INSPECT_RESULT {
    const item = testItem as BOARD_ITEM;

    if (item.IsOnLayer(this.m_layer_id)) this.Append(testItem);

    return INSPECT_RESULT.CONTINUE;
  }

  /**
   * Test a BOARD_ITEM using this class's Inspector method, which does the collection.
   *
   * @param aBoard The BOARD_ITEM to scan.
   * @param aTypes The KICAD_Ts to gather up.
   */
  Collect(aBoard: BOARD_ITEM, aTypes: readonly KICAD_T[]): void {
    this.Empty();
    aBoard.Visit(this.m_inspector, null, aTypes);
  }
}

/**
 * `GENERAL_COLLECTOR`'s scan-type lists (`collectors.cpp:41-150`).
 *
 * The collector proper — `Inspect()` and its `COLLECTORS_GUIDE` — is the
 * selection tool's hit-tester and lands with `PCB_SELECTION_TOOL` (#636
 * stage 3). These eight lists are data, not behaviour, and `BOARD::Visit()`
 * needs them now: they say which `KICAD_T`s a given traversal is asking for,
 * and the order is KiCad's own, so a `Visit` here reaches items in the order
 * upstream reaches them.
 */
export const GENERAL_COLLECTOR = {
  /** Used to identify:  all items except zones. */
  AllBoardItems: [
    KICAD_T.PCB_MARKER_T, // in m_markers
    KICAD_T.PCB_TEXT_T, // in m_drawings
    KICAD_T.PCB_REFERENCE_IMAGE_T, // in m_drawings
    KICAD_T.PCB_TEXTBOX_T, // in m_drawings
    KICAD_T.PCB_TABLE_T, // in m_drawings
    KICAD_T.PCB_TABLECELL_T, // in tables
    KICAD_T.PCB_SHAPE_T, // in m_drawings
    KICAD_T.PCB_DIM_ALIGNED_T, // in m_drawings
    KICAD_T.PCB_DIM_CENTER_T, // in m_drawings
    KICAD_T.PCB_DIM_RADIAL_T, // in m_drawings
    KICAD_T.PCB_DIM_ORTHOGONAL_T, // in m_drawings
    KICAD_T.PCB_DIM_LEADER_T, // in m_drawings
    KICAD_T.PCB_TARGET_T, // in m_drawings
    KICAD_T.PCB_VIA_T, // in m_tracks
    KICAD_T.PCB_TRACE_T, // in m_tracks
    KICAD_T.PCB_ARC_T, // in m_tracks
    KICAD_T.PCB_PAD_T, // in footprints
    KICAD_T.PCB_FIELD_T, // in footprints
    KICAD_T.PCB_FOOTPRINT_T, // in m_footprints
    KICAD_T.PCB_GROUP_T, // in m_groups
    KICAD_T.PCB_ZONE_T, // in m_zones
    KICAD_T.PCB_POINT_T, // in m_points
    KICAD_T.PCB_GENERATOR_T, // in m_generators
    KICAD_T.PCB_BARCODE_T, // in m_drawings
  ] as const satisfies readonly KICAD_T[],

  /** Used to identify board items at the board level, i.e. not inside a footprint. */
  BoardLevelItems: [
    KICAD_T.PCB_MARKER_T,
    KICAD_T.PCB_REFERENCE_IMAGE_T,
    KICAD_T.PCB_TEXT_T,
    KICAD_T.PCB_TEXTBOX_T,
    KICAD_T.PCB_TABLE_T,
    KICAD_T.PCB_SHAPE_T,
    KICAD_T.PCB_DIM_ALIGNED_T,
    KICAD_T.PCB_DIM_ORTHOGONAL_T,
    KICAD_T.PCB_DIM_CENTER_T,
    KICAD_T.PCB_DIM_RADIAL_T,
    KICAD_T.PCB_DIM_LEADER_T,
    KICAD_T.PCB_TARGET_T,
    KICAD_T.PCB_POINT_T,
    KICAD_T.PCB_VIA_T,
    KICAD_T.PCB_ARC_T,
    KICAD_T.PCB_TRACE_T,
    KICAD_T.PCB_FOOTPRINT_T,
    KICAD_T.PCB_GROUP_T,
    KICAD_T.PCB_ZONE_T,
    KICAD_T.PCB_GENERATOR_T,
    KICAD_T.PCB_BARCODE_T,
  ] as const satisfies readonly KICAD_T[],

  Footprints: [KICAD_T.PCB_FOOTPRINT_T] as const satisfies readonly KICAD_T[],

  PadsOrTracks: [
    KICAD_T.PCB_PAD_T,
    KICAD_T.PCB_VIA_T,
    KICAD_T.PCB_TRACE_T,
    KICAD_T.PCB_ARC_T,
  ] as const satisfies readonly KICAD_T[],

  FootprintItems: [
    KICAD_T.PCB_MARKER_T,
    KICAD_T.PCB_FIELD_T,
    KICAD_T.PCB_TEXT_T,
    KICAD_T.PCB_TEXTBOX_T,
    KICAD_T.PCB_TABLE_T,
    KICAD_T.PCB_TABLECELL_T,
    KICAD_T.PCB_SHAPE_T,
    KICAD_T.PCB_DIM_ALIGNED_T,
    KICAD_T.PCB_DIM_ORTHOGONAL_T,
    KICAD_T.PCB_DIM_CENTER_T,
    KICAD_T.PCB_DIM_RADIAL_T,
    KICAD_T.PCB_DIM_LEADER_T,
    KICAD_T.PCB_PAD_T,
    KICAD_T.PCB_ZONE_T,
    KICAD_T.PCB_GROUP_T,
    KICAD_T.PCB_POINT_T,
    KICAD_T.PCB_REFERENCE_IMAGE_T,
    KICAD_T.PCB_BARCODE_T,
  ] as const satisfies readonly KICAD_T[],

  Tracks: [
    KICAD_T.PCB_TRACE_T,
    KICAD_T.PCB_ARC_T,
    KICAD_T.PCB_VIA_T,
  ] as const satisfies readonly KICAD_T[],

  Dimensions: [
    KICAD_T.PCB_DIM_ALIGNED_T,
    KICAD_T.PCB_DIM_LEADER_T,
    KICAD_T.PCB_DIM_ORTHOGONAL_T,
    KICAD_T.PCB_DIM_CENTER_T,
    KICAD_T.PCB_DIM_RADIAL_T,
  ] as const satisfies readonly KICAD_T[],

  DraggableItems: [
    KICAD_T.PCB_TRACE_T,
    KICAD_T.PCB_VIA_T,
    KICAD_T.PCB_FOOTPRINT_T,
    KICAD_T.PCB_ARC_T,
  ] as const satisfies readonly KICAD_T[],
} as const;
