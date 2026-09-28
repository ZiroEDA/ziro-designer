// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/length_delay_calculation/length_delay_calculation_item.h` / `.cpp`.
 *
 * Lightweight class which holds a pad, via, or a routed trace outline.  Proxied objects passed by pointer are not
 * owned by this container.
 */
import {
  IsCopperLayerLowerThan,
  type PCB_LAYER_ID,
  UNDEFINED_LAYER,
} from '@ziroeda/common/layer_id.js';
import type { NETCLASS } from '@ziroeda/common/netclass.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { BOARD } from '../board.js';
import type { PAD } from '../pad.js';
import type { PCB_VIA } from '../pcb_track.js';

/// The type of routing object this item proxies
export enum LENGTH_DELAY_CALCULATION_ITEM_TYPE {
  UNKNOWN,
  PAD,
  LINE,
  VIA,
}

/// Whether this item is UNMERGED, it has been merged and should be used (MERGED_IN_USE), or it has been merged
/// and has been retired from use (MERGED_RETIRED). MERGED_RETIRED essentially means the object has been merged
/// in to a MERGED_IN_USE item.
export enum MERGE_STATUS {
  UNMERGED,
  MERGED_IN_USE,
  MERGED_RETIRED,
}

// Only consider trace connections when determining via electrical span. Pads are excluded
// because they have their own pad-to-die length handling, and including them would cause
// through-hole vias to incorrectly span to layers where TH pads exist (e.g., connector pins)
// rather than just the layers where traces actually connect.
const traceTypes: readonly KICAD_T[] = [KICAD_T.PCB_TRACE_T, KICAD_T.PCB_ARC_T];

export class LENGTH_DELAY_CALCULATION_ITEM {
  /// A proxied PAD object. Set to nullptr if not proxying a PAD.
  protected m_pad: PAD | null = null;

  /// A proxied SHAPE_LINE_CHAIN object. Line is empty if not proxying a SHAPE_LINE_CHAIN.
  protected m_line = new SHAPE_LINE_CHAIN();

  /// A proxied PCB_VIA object. Set to nullptr if not proxying a VIA.
  protected m_via: PCB_VIA | null = null;

  /// The start board layer for the proxied object
  protected m_layerStart: PCB_LAYER_ID = UNDEFINED_LAYER;

  /// The end board layer for the proxied object
  protected m_layerEnd: PCB_LAYER_ID = UNDEFINED_LAYER;

  /// Flags whether this item has already been merged with another
  protected m_mergeStatus: MERGE_STATUS = MERGE_STATUS.UNMERGED;

  /// The routing object type of the proxied parent
  protected m_type: LENGTH_DELAY_CALCULATION_ITEM_TYPE = LENGTH_DELAY_CALCULATION_ITEM_TYPE.UNKNOWN;

  /// The net class of the object
  protected m_netClass: NETCLASS | null = null;

  /// Gets the routing item type
  Type(): LENGTH_DELAY_CALCULATION_ITEM_TYPE {
    return this.m_type;
  }

  /// Sets the parent PAD associated with this item
  SetPad(aPad: PAD): void {
    this.m_type = LENGTH_DELAY_CALCULATION_ITEM_TYPE.PAD;
    this.m_pad = aPad;
  }

  /// Gets the parent PAD associated with this item
  GetPad(): PAD | null {
    return this.m_pad;
  }

  /// Sets the source SHAPE_LINE_CHAIN of this item
  SetLine(aLine: SHAPE_LINE_CHAIN): void {
    this.m_type = LENGTH_DELAY_CALCULATION_ITEM_TYPE.LINE;
    this.m_line = aLine;
  }

  /// Gets the SHAPE_LINE_CHAIN associated with this item
  GetLine(): SHAPE_LINE_CHAIN {
    return this.m_line;
  }

  /// Sets the VIA associated with this item
  SetVia(aVia: PCB_VIA): void {
    this.m_type = LENGTH_DELAY_CALCULATION_ITEM_TYPE.VIA;
    this.m_via = aVia;
  }

  /// Gets the VIA associated with this item
  GetVia(): PCB_VIA | null {
    return this.m_via;
  }

  /// Sets the first and last layers associated with this item. Always stores in copper layer order
  /// (F_Cu to B_Cu)
  SetLayers(aStart: PCB_LAYER_ID, aEnd: PCB_LAYER_ID = UNDEFINED_LAYER): void {
    if (aEnd !== UNDEFINED_LAYER && IsCopperLayerLowerThan(aStart, aEnd)) {
      this.m_layerStart = aEnd;
      this.m_layerEnd = aStart;
    } else {
      this.m_layerStart = aStart;
      this.m_layerEnd = aEnd;
    }
  }

  /// Sets the MERGE_STATUS of this item. MERGED_RETIRED essentially means the object has been merged
  /// in to a MERGED_IN_USE item.
  SetMergeStatus(aStatus: MERGE_STATUS): void {
    this.m_mergeStatus = aStatus;
  }

  /// Gets the MERGE_STATUS of this item
  GetMergeStatus(): MERGE_STATUS {
    return this.m_mergeStatus;
  }

  /// Gets the upper and lower layers for the proxied item
  GetLayers(): [PCB_LAYER_ID, PCB_LAYER_ID] {
    return [this.m_layerStart, this.m_layerEnd];
  }

  /// Gets the start board layer for the proxied item
  GetStartLayer(): PCB_LAYER_ID {
    return this.m_layerStart;
  }

  /// Gets the end board layer for the proxied item.
  GetEndLayer(): PCB_LAYER_ID {
    return this.m_layerEnd;
  }

  /// Calculates active via payers for a proxied VIA object
  CalculateViaLayers(aBoard: BOARD): void {
    let top_layer: PCB_LAYER_ID = UNDEFINED_LAYER;
    let bottom_layer: PCB_LAYER_ID = UNDEFINED_LAYER;

    const layers = aBoard.GetDesignSettings().GetEnabledLayers();

    for (const layer of layers.CuStack()) {
      if (aBoard.GetConnectivity().IsConnectedOnLayer(this.m_via!, layer, traceTypes)) {
        if (top_layer === UNDEFINED_LAYER) top_layer = layer;
        else bottom_layer = layer;
      }
    }

    if (top_layer === UNDEFINED_LAYER) top_layer = this.m_via!.TopLayer();
    if (bottom_layer === UNDEFINED_LAYER) bottom_layer = this.m_via!.BottomLayer();

    this.SetLayers(top_layer, bottom_layer);
  }

  /// Sets the effective net class for the item
  SetEffectiveNetClass(aNetClass: NETCLASS | null): void {
    this.m_netClass = aNetClass;
  }

  /// Returns the effective net class for the item
  GetEffectiveNetClass(): NETCLASS | null {
    return this.m_netClass;
  }
}
