// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pads/pads_layer_mapper.cpp` / `.h`: PADS layer numbers and
 * names to KiCad layers.
 */

import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { INPUT_LAYER_DESC } from '../common/plugin_common_layer_mapping.js';

export enum PADS_LAYER_TYPE {
  UNKNOWN,
  COPPER_TOP,
  COPPER_BOTTOM,
  COPPER_INNER,
  SILKSCREEN_TOP,
  SILKSCREEN_BOTTOM,
  SOLDERMASK_TOP,
  SOLDERMASK_BOTTOM,
  PASTE_TOP,
  PASTE_BOTTOM,
  ASSEMBLY_TOP,
  ASSEMBLY_BOTTOM,
  DOCUMENTATION,
  BOARD_OUTLINE,
  DRILL_DRAWING,
}

export interface PADS_LAYER_INFO {
  padsLayerNum: number; ///< PADS layer number
  name: string; ///< Layer name as it appears in PADS file
  type: PADS_LAYER_TYPE; ///< Categorized layer type
  required: boolean; ///< Whether this layer must be mapped
}

const T = PADS_LAYER_TYPE;

export class PADS_LAYER_MAPPER {
  static readonly LAYER_PAD_STACK_TOP = -2; ///< Pad stack: Top copper
  static readonly LAYER_PAD_STACK_BOTTOM = -1; ///< Pad stack: Bottom copper
  static readonly LAYER_PAD_STACK_INNER = 0; ///< Pad stack: Inner copper
  static readonly LAYER_DRILL_DRAWING = 18;
  static readonly LAYER_DIMENSIONS = 19;
  static readonly LAYER_PLACEMENT_OUTLINE = 20;
  static readonly LAYER_ASSEMBLY_TOP = 21;
  static readonly LAYER_ASSEMBLY_BOTTOM = 22;
  static readonly LAYER_SOLDERMASK_TOP = 25;
  static readonly LAYER_SILKSCREEN_TOP = 26;
  static readonly LAYER_SILKSCREEN_BOTTOM = 27;
  static readonly LAYER_SOLDERMASK_BOTTOM = 28;
  static readonly LAYER_PASTE_TOP = 29;
  static readonly LAYER_PASTE_BOTTOM = 30;
  static readonly LAYER_BOARD_OUTLINE = 1;

  private m_copperLayerCount = 2;
  private m_layerNameMap = new Map<string, PADS_LAYER_TYPE>([
    ['silkscreen top', T.SILKSCREEN_TOP],
    ['silk top', T.SILKSCREEN_TOP],
    ['sst', T.SILKSCREEN_TOP],
    ['top silk', T.SILKSCREEN_TOP],
    ['top overlay', T.SILKSCREEN_TOP],
    ['silkscreen bottom', T.SILKSCREEN_BOTTOM],
    ['silk bottom', T.SILKSCREEN_BOTTOM],
    ['ssb', T.SILKSCREEN_BOTTOM],
    ['bottom silk', T.SILKSCREEN_BOTTOM],
    ['bottom overlay', T.SILKSCREEN_BOTTOM],
    ['solder mask top', T.SOLDERMASK_TOP],
    ['soldermask top', T.SOLDERMASK_TOP],
    ['smt', T.SOLDERMASK_TOP],
    ['top mask', T.SOLDERMASK_TOP],
    ['top solder mask', T.SOLDERMASK_TOP],
    ['solder mask bottom', T.SOLDERMASK_BOTTOM],
    ['soldermask bottom', T.SOLDERMASK_BOTTOM],
    ['smb', T.SOLDERMASK_BOTTOM],
    ['bottom mask', T.SOLDERMASK_BOTTOM],
    ['bottom solder mask', T.SOLDERMASK_BOTTOM],
    ['paste top', T.PASTE_TOP],
    ['paste mask top', T.PASTE_TOP],
    ['solder paste top', T.PASTE_TOP],
    ['top paste', T.PASTE_TOP],
    ['paste bottom', T.PASTE_BOTTOM],
    ['paste mask bottom', T.PASTE_BOTTOM],
    ['solder paste bottom', T.PASTE_BOTTOM],
    ['bottom paste', T.PASTE_BOTTOM],
    ['assembly top', T.ASSEMBLY_TOP],
    ['top assembly', T.ASSEMBLY_TOP],
    ['assy top', T.ASSEMBLY_TOP],
    ['component outline top', T.ASSEMBLY_TOP],
    ['assembly bottom', T.ASSEMBLY_BOTTOM],
    ['bottom assembly', T.ASSEMBLY_BOTTOM],
    ['assy bottom', T.ASSEMBLY_BOTTOM],
    ['component outline bottom', T.ASSEMBLY_BOTTOM],
    ['board outline', T.BOARD_OUTLINE],
    ['board', T.BOARD_OUTLINE],
    ['outline', T.BOARD_OUTLINE],
    ['board geometry', T.BOARD_OUTLINE],
    ['documentation', T.DOCUMENTATION],
    ['doc', T.DOCUMENTATION],
  ]);

  SetCopperLayerCount(aLayerCount: number): void {
    this.m_copperLayerCount = aLayerCount < 1 ? 1 : aLayerCount;
  }

  GetCopperLayerCount(): number {
    return this.m_copperLayerCount;
  }

  /** `std::tolower` byte by byte ("C" locale: ASCII only). */
  private normalizeLayerName(aName: string): string {
    return aName.replace(/[A-Z]/g, (c) => c.toLowerCase());
  }

  GetLayerType(aPadsLayer: number): PADS_LAYER_TYPE {
    const M = PADS_LAYER_MAPPER;

    if (aPadsLayer === M.LAYER_PAD_STACK_TOP) return T.COPPER_TOP;
    if (aPadsLayer === M.LAYER_PAD_STACK_BOTTOM) return T.COPPER_BOTTOM;
    if (aPadsLayer === M.LAYER_PAD_STACK_INNER) return T.COPPER_INNER;
    if (aPadsLayer === 1) return T.COPPER_TOP;
    if (aPadsLayer === this.m_copperLayerCount && this.m_copperLayerCount > 1)
      return T.COPPER_BOTTOM;
    if (aPadsLayer > 1 && aPadsLayer < this.m_copperLayerCount) return T.COPPER_INNER;
    if (aPadsLayer === M.LAYER_DRILL_DRAWING) return T.DRILL_DRAWING;
    if (aPadsLayer === M.LAYER_DIMENSIONS || aPadsLayer === M.LAYER_PLACEMENT_OUTLINE)
      return T.DOCUMENTATION;
    if (aPadsLayer === M.LAYER_ASSEMBLY_TOP) return T.ASSEMBLY_TOP;
    if (aPadsLayer === M.LAYER_ASSEMBLY_BOTTOM) return T.ASSEMBLY_BOTTOM;
    if (aPadsLayer === M.LAYER_SOLDERMASK_TOP) return T.SOLDERMASK_TOP;
    if (aPadsLayer === M.LAYER_SILKSCREEN_TOP) return T.SILKSCREEN_TOP;
    if (aPadsLayer === M.LAYER_SILKSCREEN_BOTTOM) return T.SILKSCREEN_BOTTOM;
    if (aPadsLayer === M.LAYER_SOLDERMASK_BOTTOM) return T.SOLDERMASK_BOTTOM;
    if (aPadsLayer === M.LAYER_PASTE_TOP) return T.PASTE_TOP;
    if (aPadsLayer === M.LAYER_PASTE_BOTTOM) return T.PASTE_BOTTOM;

    return T.UNKNOWN;
  }

  ParseLayerName(aLayerName: string): PADS_LAYER_TYPE {
    const normalized = this.normalizeLayerName(aLayerName);
    const it = this.m_layerNameMap.get(normalized);

    if (it !== undefined) return it;

    if (normalized.includes('top') || normalized.includes('layer 1') || normalized === '1')
      return T.COPPER_TOP;

    if (normalized.includes('bottom') || normalized.includes('bot')) return T.COPPER_BOTTOM;

    if (
      normalized.includes('inner') ||
      normalized.includes('mid') ||
      normalized.includes('internal')
    )
      return T.COPPER_INNER;

    return T.UNKNOWN;
  }

  private mapInnerCopperLayer(aPadsLayer: number): PCB_LAYER_ID {
    let innerIndex = aPadsLayer - 2;

    if (innerIndex < 0) innerIndex = 0;

    if (innerIndex >= 30) innerIndex = 29;

    return (PCB_LAYER_ID.In1_Cu + innerIndex * 2) as PCB_LAYER_ID;
  }

  GetAutoMapLayer(aPadsLayer: number, aType: PADS_LAYER_TYPE = T.UNKNOWN): PCB_LAYER_ID {
    if (aType === T.UNKNOWN) aType = this.GetLayerType(aPadsLayer);

    switch (aType) {
      case T.COPPER_TOP:
        return PCB_LAYER_ID.F_Cu;
      case T.COPPER_BOTTOM:
        return PCB_LAYER_ID.B_Cu;
      case T.COPPER_INNER:
        return this.mapInnerCopperLayer(aPadsLayer);
      case T.SILKSCREEN_TOP:
        return PCB_LAYER_ID.F_SilkS;
      case T.SILKSCREEN_BOTTOM:
        return PCB_LAYER_ID.B_SilkS;
      case T.SOLDERMASK_TOP:
        return PCB_LAYER_ID.F_Mask;
      case T.SOLDERMASK_BOTTOM:
        return PCB_LAYER_ID.B_Mask;
      case T.PASTE_TOP:
        return PCB_LAYER_ID.F_Paste;
      case T.PASTE_BOTTOM:
        return PCB_LAYER_ID.B_Paste;
      case T.ASSEMBLY_TOP:
        return PCB_LAYER_ID.F_Fab;
      case T.ASSEMBLY_BOTTOM:
        return PCB_LAYER_ID.B_Fab;
      case T.BOARD_OUTLINE:
        return PCB_LAYER_ID.Edge_Cuts;
      case T.DOCUMENTATION:
        return PCB_LAYER_ID.Cmts_User;
      case T.DRILL_DRAWING:
        return PCB_LAYER_ID.Dwgs_User;
      default:
        return PCB_LAYER_ID.UNDEFINED_LAYER;
    }
  }

  GetPermittedLayers(aType: PADS_LAYER_TYPE): LSET {
    const L = PCB_LAYER_ID;

    switch (aType) {
      case T.COPPER_TOP:
      case T.COPPER_BOTTOM:
      case T.COPPER_INNER:
        return LSET.AllCuMask();
      case T.SILKSCREEN_TOP:
      case T.SILKSCREEN_BOTTOM:
        return new LSET([L.F_SilkS, L.B_SilkS]);
      case T.SOLDERMASK_TOP:
      case T.SOLDERMASK_BOTTOM:
        return new LSET([L.F_Mask, L.B_Mask]);
      case T.PASTE_TOP:
      case T.PASTE_BOTTOM:
        return new LSET([L.F_Paste, L.B_Paste]);
      case T.ASSEMBLY_TOP:
      case T.ASSEMBLY_BOTTOM:
        return new LSET([L.F_Fab, L.B_Fab, L.F_CrtYd, L.B_CrtYd]);
      case T.BOARD_OUTLINE:
        return new LSET([L.Edge_Cuts]);
      case T.DOCUMENTATION:
        return LSET.AllNonCuMask();
      case T.DRILL_DRAWING:
        return new LSET([L.Dwgs_User, L.F_Fab, L.B_Fab, L.Cmts_User]);
      default:
        return LSET.AllLayersMask();
    }
  }

  BuildInputLayerDescriptions(aLayerInfos: readonly PADS_LAYER_INFO[]): INPUT_LAYER_DESC[] {
    return aLayerInfos.map((info) => ({
      Name: info.name,
      PermittedLayers: this.GetPermittedLayers(info.type),
      AutoMapLayer: this.GetAutoMapLayer(info.padsLayerNum, info.type),
      Required: info.required,
    }));
  }

  AddLayerNameMapping(aName: string, aType: PADS_LAYER_TYPE): void {
    this.m_layerNameMap.set(this.normalizeLayerName(aName), aType);
  }

  static LayerTypeToString(aType: PADS_LAYER_TYPE): string {
    switch (aType) {
      case T.COPPER_TOP:
        return 'Copper Top';
      case T.COPPER_BOTTOM:
        return 'Copper Bottom';
      case T.COPPER_INNER:
        return 'Copper Inner';
      case T.SILKSCREEN_TOP:
        return 'Silkscreen Top';
      case T.SILKSCREEN_BOTTOM:
        return 'Silkscreen Bottom';
      case T.SOLDERMASK_TOP:
        return 'Solder Mask Top';
      case T.SOLDERMASK_BOTTOM:
        return 'Solder Mask Bottom';
      case T.PASTE_TOP:
        return 'Paste Top';
      case T.PASTE_BOTTOM:
        return 'Paste Bottom';
      case T.ASSEMBLY_TOP:
        return 'Assembly Top';
      case T.ASSEMBLY_BOTTOM:
        return 'Assembly Bottom';
      case T.DOCUMENTATION:
        return 'Documentation';
      case T.BOARD_OUTLINE:
        return 'Board Outline';
      case T.DRILL_DRAWING:
        return 'Drill Drawing';
      default:
        return 'Unknown';
    }
  }
}
