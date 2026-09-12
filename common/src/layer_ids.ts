// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/layer_ids.h` and `common/layer_id.cpp`: every layer id KiCad has,
 * the predicates on them, `LayerName`, `FlipLayer` and the legacy/3D maps.
 *
 * A quick note on layer IDs:
 *
 * The layers are stored in separate enums so that certain functions can
 * take in the enums as data types and don't have to know about layers from
 * other applications.
 *
 * Layers that are shared between applications should be in the GAL_LAYER_ID enum.
 *
 * The PCB_LAYER_ID struct must start at zero for compatibility with legacy board files.
 *
 * Some functions accept any layer ID, so they start at zero (i.e. F_Cu) and go up to
 * the LAYER_ID_COUNT, which needs to be kept up-to-date if new enums are added.
 *
 * Each enum's members are also exported as bare constants, as C++'s unscoped
 * enums put them in the enclosing scope.
 */

import { BASE_SET } from './base_set.js';

/**
 * This is the definition of all layers used in Pcbnew.
 *
 * The PCB layer types are fixed at value 0 through #LAYER_ID_COUNT to ensure compatibility
 * with legacy board files.
 */
export enum PCB_LAYER_ID {
  UNDEFINED_LAYER = -1,
  UNSELECTED_LAYER = -2,
  F_Cu = 0,
  B_Cu = 2,
  In1_Cu = 4,
  In2_Cu = 6,
  In3_Cu = 8,
  In4_Cu = 10,
  In5_Cu = 12,
  In6_Cu = 14,
  In7_Cu = 16,
  In8_Cu = 18,
  In9_Cu = 20,
  In10_Cu = 22,
  In11_Cu = 24,
  In12_Cu = 26,
  In13_Cu = 28,
  In14_Cu = 30,
  In15_Cu = 32,
  In16_Cu = 34,
  In17_Cu = 36,
  In18_Cu = 38,
  In19_Cu = 40,
  In20_Cu = 42,
  In21_Cu = 44,
  In22_Cu = 46,
  In23_Cu = 48,
  In24_Cu = 50,
  In25_Cu = 52,
  In26_Cu = 54,
  In27_Cu = 56,
  In28_Cu = 58,
  In29_Cu = 60,
  In30_Cu = 62,
  F_Mask = 1,
  B_Mask = 3,
  F_SilkS = 5,
  B_SilkS = 7,
  F_Adhes = 9,
  B_Adhes = 11,
  F_Paste = 13,
  B_Paste = 15,
  Dwgs_User = 17,
  Cmts_User = 19,
  Eco1_User = 21,
  Eco2_User = 23,
  Edge_Cuts = 25,
  Margin = 27,
  B_CrtYd = 29,
  F_CrtYd = 31,
  B_Fab = 33,
  F_Fab = 35,
  Rescue = 37,
  User_1 = 39,
  User_2 = 41,
  User_3 = 43,
  User_4 = 45,
  User_5 = 47,
  User_6 = 49,
  User_7 = 51,
  User_8 = 53,
  User_9 = 55,
  User_10 = 57,
  User_11 = 59,
  User_12 = 61,
  User_13 = 63,
  User_14 = 65,
  User_15 = 67,
  User_16 = 69,
  User_17 = 71,
  User_18 = 73,
  User_19 = 75,
  User_20 = 77,
  User_21 = 79,
  User_22 = 81,
  User_23 = 83,
  User_24 = 85,
  User_25 = 87,
  User_26 = 89,
  User_27 = 91,
  User_28 = 93,
  User_29 = 95,
  User_30 = 97,
  User_31 = 99,
  User_32 = 101,
  User_33 = 103,
  User_34 = 105,
  User_35 = 107,
  User_36 = 109,
  User_37 = 111,
  User_38 = 113,
  User_39 = 115,
  User_40 = 117,
  User_41 = 119,
  User_42 = 121,
  User_43 = 123,
  User_44 = 125,
  User_45 = 127,
  PCB_LAYER_ID_COUNT = 128,
}

export const {
  UNDEFINED_LAYER,
  UNSELECTED_LAYER,
  F_Cu,
  B_Cu,
  In1_Cu,
  In2_Cu,
  In3_Cu,
  In4_Cu,
  In5_Cu,
  In6_Cu,
  In7_Cu,
  In8_Cu,
  In9_Cu,
  In10_Cu,
  In11_Cu,
  In12_Cu,
  In13_Cu,
  In14_Cu,
  In15_Cu,
  In16_Cu,
  In17_Cu,
  In18_Cu,
  In19_Cu,
  In20_Cu,
  In21_Cu,
  In22_Cu,
  In23_Cu,
  In24_Cu,
  In25_Cu,
  In26_Cu,
  In27_Cu,
  In28_Cu,
  In29_Cu,
  In30_Cu,
  F_Mask,
  B_Mask,
  F_SilkS,
  B_SilkS,
  F_Adhes,
  B_Adhes,
  F_Paste,
  B_Paste,
  Dwgs_User,
  Cmts_User,
  Eco1_User,
  Eco2_User,
  Edge_Cuts,
  Margin,
  B_CrtYd,
  F_CrtYd,
  B_Fab,
  F_Fab,
  Rescue,
  User_1,
  User_2,
  User_3,
  User_4,
  User_5,
  User_6,
  User_7,
  User_8,
  User_9,
  User_10,
  User_11,
  User_12,
  User_13,
  User_14,
  User_15,
  User_16,
  User_17,
  User_18,
  User_19,
  User_20,
  User_21,
  User_22,
  User_23,
  User_24,
  User_25,
  User_26,
  User_27,
  User_28,
  User_29,
  User_30,
  User_31,
  User_32,
  User_33,
  User_34,
  User_35,
  User_36,
  User_37,
  User_38,
  User_39,
  User_40,
  User_41,
  User_42,
  User_43,
  User_44,
  User_45,
  PCB_LAYER_ID_COUNT,
} = PCB_LAYER_ID;

export const PCBNEW_LAYER_ID_START: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu;

export const MAX_CU_LAYERS = 32;
export const MAX_USER_DEFINED_LAYERS = 45;

/**
 * Enum used during connectivity building to ensure we do not query connectivity while building
 * the database.
 */
export enum FLASHING {
  DEFAULT = 0, ///< Flashing follows connectivity.
  ALWAYS_FLASHED = 1, ///< Always flashed for connectivity.
  NEVER_FLASHED = 2, ///< Never flashed for connectivity.
}

/// Dedicated layers for net names used in Pcbnew.
export enum NETNAMES_LAYER_ID {
  NETNAMES_LAYER_ID_START = PCB_LAYER_ID.PCB_LAYER_ID_COUNT,

  /// Reserved space for board layer netnames.
  NETNAMES_LAYER_ID_RESERVED = NETNAMES_LAYER_ID_START + PCB_LAYER_ID.PCB_LAYER_ID_COUNT,

  /// Additional netnames layers (not associated with a PCB layer).
  LAYER_PAD_FR_NETNAMES = NETNAMES_LAYER_ID_RESERVED + 1,
  LAYER_PAD_BK_NETNAMES = NETNAMES_LAYER_ID_RESERVED + 2,
  LAYER_PAD_NETNAMES = NETNAMES_LAYER_ID_RESERVED + 3,
  LAYER_VIA_NETNAMES = NETNAMES_LAYER_ID_RESERVED + 4,

  NETNAMES_LAYER_ID_END = NETNAMES_LAYER_ID_RESERVED + 5,
}

export const {
  NETNAMES_LAYER_ID_START,
  NETNAMES_LAYER_ID_RESERVED,
  LAYER_PAD_FR_NETNAMES,
  LAYER_PAD_BK_NETNAMES,
  LAYER_PAD_NETNAMES,
  LAYER_VIA_NETNAMES,
  NETNAMES_LAYER_ID_END,
} = NETNAMES_LAYER_ID;

/// Macro for obtaining netname layer for a given PCB layer
export const NETNAMES_LAYER_INDEX = (layer: number): number =>
  NETNAMES_LAYER_ID.NETNAMES_LAYER_ID_START + layer;

export const GAL_UI_LAYER_COUNT = 10;

/**
 *  GAL layers are "virtual" layers, i.e. not tied into design data.
 *
 *  Some layers here are shared between applications.
 *
 *  @note Be very careful where you add new layers here.  Layers up to #GAL_LAYER_ID_BITMASK_END
 *  must never be re-ordered and new layers must always be added after this value, because the
 *  layers before this value are mapped to bit locations in legacy board files.
 *
 *  The values in this enum that are used to store visibility state are explicitly encoded with an
 *  offset from #GAL_LAYER_ID_START, which is explicitly encoded itself. The exact value of
 *  #GAL_LAYER_ID_START is not that sensitive, but the offsets should never be changed or else any
 *  existing visibility settings will be disrupted.
 */
export enum GAL_LAYER_ID {
  GAL_LAYER_ID_START = NETNAMES_LAYER_ID.NETNAMES_LAYER_ID_END,

  LAYER_VIAS = GAL_LAYER_ID_START + 0,
  LAYER_VIA_MICROVIA = GAL_LAYER_ID_START + 1,
  LAYER_VIA_BLIND = GAL_LAYER_ID_START + 2,
  LAYER_VIA_BURIED = GAL_LAYER_ID_START + 3,
  LAYER_VIA_THROUGH = GAL_LAYER_ID_START + 4,
  LAYER_NON_PLATEDHOLES = GAL_LAYER_ID_START + 5,
  LAYER_FP_TEXT = GAL_LAYER_ID_START + 6,
  LAYER_ANCHOR = GAL_LAYER_ID_START + 8,
  LAYER_RATSNEST = GAL_LAYER_ID_START + 11,
  LAYER_GRID = GAL_LAYER_ID_START + 12,
  LAYER_GRID_AXES = GAL_LAYER_ID_START + 13,
  LAYER_FOOTPRINTS_FR = GAL_LAYER_ID_START + 15,
  LAYER_FOOTPRINTS_BK = GAL_LAYER_ID_START + 16,
  LAYER_FP_VALUES = GAL_LAYER_ID_START + 17,
  LAYER_FP_REFERENCES = GAL_LAYER_ID_START + 18,
  LAYER_TRACKS = GAL_LAYER_ID_START + 19,
  LAYER_PAD_PLATEDHOLES = GAL_LAYER_ID_START + 21,
  LAYER_VIA_HOLES = GAL_LAYER_ID_START + 22,
  LAYER_DRC_ERROR = GAL_LAYER_ID_START + 23,
  LAYER_DRAWINGSHEET = GAL_LAYER_ID_START + 24,
  LAYER_GP_OVERLAY = GAL_LAYER_ID_START + 25,
  LAYER_SELECT_OVERLAY = GAL_LAYER_ID_START + 26,
  LAYER_PCB_BACKGROUND = GAL_LAYER_ID_START + 27,
  LAYER_CURSOR = GAL_LAYER_ID_START + 28,
  LAYER_AUX_ITEMS = GAL_LAYER_ID_START + 29,
  LAYER_DRAW_BITMAPS = GAL_LAYER_ID_START + 30,
  GAL_LAYER_ID_BITMASK_END = GAL_LAYER_ID_START + 31,
  LAYER_PADS = GAL_LAYER_ID_START + 32,
  LAYER_ZONES = GAL_LAYER_ID_START + 33,
  LAYER_PAD_HOLEWALLS = GAL_LAYER_ID_START + 34,
  LAYER_VIA_HOLEWALLS = GAL_LAYER_ID_START + 35,
  LAYER_DRC_WARNING = GAL_LAYER_ID_START + 36,
  LAYER_DRC_EXCLUSION = GAL_LAYER_ID_START + 37,
  LAYER_MARKER_SHADOWS = GAL_LAYER_ID_START + 38,
  LAYER_LOCKED_ITEM_SHADOW = GAL_LAYER_ID_START + 39,
  LAYER_CONFLICTS_SHADOW = GAL_LAYER_ID_START + 40,
  LAYER_FILLED_SHAPES = GAL_LAYER_ID_START + 41,
  LAYER_DRC_SHAPES = GAL_LAYER_ID_START + 42,
  LAYER_BOARD_OUTLINE_AREA = GAL_LAYER_ID_START + 44,
  LAYER_POINTS = GAL_LAYER_ID_START + 45,

  // Add layers below this point that do not have visibility controls, so don't need explicit
  // enum values
  LAYER_DRAWINGSHEET_PAGE1 = LAYER_POINTS + 1, ///< Sheet Editor previewing first page.
  LAYER_DRAWINGSHEET_PAGEn = LAYER_POINTS + 2, ///< Sheet Editor previewing pages after first page.
  LAYER_PAGE_LIMITS = LAYER_POINTS + 3, ///< Color for drawing the page extents (visibility stored in
  ///< PCBNEW_SETTINGS::m_ShowPageLimits)

  /// Virtual layers for stacking zones and tracks on a given copper layer.
  LAYER_ZONE_START = LAYER_PAGE_LIMITS + 1,
  LAYER_ZONE_END = LAYER_ZONE_START + PCB_LAYER_ID.PCB_LAYER_ID_COUNT,

  /// Virtual layers for pad copper on a given copper layer.
  LAYER_PAD_COPPER_START = LAYER_ZONE_END + 1,
  LAYER_PAD_COPPER_END = LAYER_PAD_COPPER_START + PCB_LAYER_ID.PCB_LAYER_ID_COUNT,

  /// Virtual layers for via copper on a given copper layer.
  LAYER_VIA_COPPER_START = LAYER_PAD_COPPER_END + 1,
  LAYER_VIA_COPPER_END = LAYER_VIA_COPPER_START + PCB_LAYER_ID.PCB_LAYER_ID_COUNT,

  /// Virtual layers for pad/via/track clearance outlines for a given copper layer.
  LAYER_CLEARANCE_START = LAYER_VIA_COPPER_END + 1,
  LAYER_CLEARANCE_END = LAYER_CLEARANCE_START + PCB_LAYER_ID.PCB_LAYER_ID_COUNT,

  /// Virtual layers for background images per board layer.
  LAYER_BITMAP_START = LAYER_CLEARANCE_END + 1,
  LAYER_BITMAP_END = LAYER_BITMAP_START + PCB_LAYER_ID.PCB_LAYER_ID_COUNT,

  /// Virtual layers for points per board layer.
  LAYER_POINT_START = LAYER_BITMAP_END + 1,
  LAYER_POINT_END = LAYER_POINT_START + PCB_LAYER_ID.PCB_LAYER_ID_COUNT,

  // Layers for drawing on-canvas UI
  LAYER_UI_START = LAYER_POINT_END + 1,
  LAYER_UI_END = LAYER_UI_START + GAL_UI_LAYER_COUNT,

  GAL_LAYER_ID_END = LAYER_UI_END + 1,
}

export const {
  GAL_LAYER_ID_START,
  LAYER_VIAS,
  LAYER_VIA_MICROVIA,
  LAYER_VIA_BLIND,
  LAYER_VIA_BURIED,
  LAYER_VIA_THROUGH,
  LAYER_NON_PLATEDHOLES,
  LAYER_FP_TEXT,
  LAYER_ANCHOR,
  LAYER_RATSNEST,
  LAYER_GRID,
  LAYER_GRID_AXES,
  LAYER_FOOTPRINTS_FR,
  LAYER_FOOTPRINTS_BK,
  LAYER_FP_VALUES,
  LAYER_FP_REFERENCES,
  LAYER_TRACKS,
  LAYER_PAD_PLATEDHOLES,
  LAYER_VIA_HOLES,
  LAYER_DRC_ERROR,
  LAYER_DRAWINGSHEET,
  LAYER_GP_OVERLAY,
  LAYER_SELECT_OVERLAY,
  LAYER_PCB_BACKGROUND,
  LAYER_CURSOR,
  LAYER_AUX_ITEMS,
  LAYER_DRAW_BITMAPS,
  GAL_LAYER_ID_BITMASK_END,
  LAYER_PADS,
  LAYER_ZONES,
  LAYER_PAD_HOLEWALLS,
  LAYER_VIA_HOLEWALLS,
  LAYER_DRC_WARNING,
  LAYER_DRC_EXCLUSION,
  LAYER_MARKER_SHADOWS,
  LAYER_LOCKED_ITEM_SHADOW,
  LAYER_CONFLICTS_SHADOW,
  LAYER_FILLED_SHAPES,
  LAYER_DRC_SHAPES,
  LAYER_BOARD_OUTLINE_AREA,
  LAYER_POINTS,
  LAYER_DRAWINGSHEET_PAGE1,
  LAYER_DRAWINGSHEET_PAGEn,
  LAYER_PAGE_LIMITS,
  LAYER_ZONE_START,
  LAYER_ZONE_END,
  LAYER_PAD_COPPER_START,
  LAYER_PAD_COPPER_END,
  LAYER_VIA_COPPER_START,
  LAYER_VIA_COPPER_END,
  LAYER_CLEARANCE_START,
  LAYER_CLEARANCE_END,
  LAYER_BITMAP_START,
  LAYER_BITMAP_END,
  LAYER_POINT_START,
  LAYER_POINT_END,
  LAYER_UI_START,
  LAYER_UI_END,
  GAL_LAYER_ID_END,
} = GAL_LAYER_ID;

/// Use this macro to convert a #GAL layer to a 0-indexed offset from #LAYER_VIAS.
export const GAL_LAYER_INDEX = (x: number): number => x - GAL_LAYER_ID.GAL_LAYER_ID_START;

/// Macros for getting the extra layers for a given board layer.
export const BITMAP_LAYER_FOR = (boardLayer: number): number =>
  GAL_LAYER_ID.LAYER_BITMAP_START + boardLayer;
export const ZONE_LAYER_FOR = (boardLayer: number): number =>
  GAL_LAYER_ID.LAYER_ZONE_START + boardLayer;
export const PAD_COPPER_LAYER_FOR = (boardLayer: number): number =>
  GAL_LAYER_ID.LAYER_PAD_COPPER_START + boardLayer;
export const VIA_COPPER_LAYER_FOR = (boardLayer: number): number =>
  GAL_LAYER_ID.LAYER_VIA_COPPER_START + boardLayer;
export const CLEARANCE_LAYER_FOR = (boardLayer: number): number =>
  GAL_LAYER_ID.LAYER_CLEARANCE_START + boardLayer;
export const POINT_LAYER_FOR = (boardLayer: number): number =>
  GAL_LAYER_ID.LAYER_POINT_START + boardLayer;

export const GAL_LAYER_ID_COUNT = GAL_LAYER_ID.GAL_LAYER_ID_END - GAL_LAYER_ID.GAL_LAYER_ID_START;

export function ToGalLayer(aInteger: number): GAL_LAYER_ID {
  console.assert(
    aInteger >= GAL_LAYER_ID.GAL_LAYER_ID_START && aInteger <= GAL_LAYER_ID.GAL_LAYER_ID_END,
  );
  return aInteger as GAL_LAYER_ID;
}

/// Helper for storing and iterating over GAL_LAYER_IDs.
export class GAL_SET extends BASE_SET {
  private static readonly start: number = GAL_LAYER_ID.GAL_LAYER_ID_START;

  constructor();
  constructor(aOther: BASE_SET);
  constructor(aArray: readonly GAL_LAYER_ID[]);
  constructor(a?: BASE_SET | readonly GAL_LAYER_ID[]) {
    if (a instanceof BASE_SET) super(a);
    else {
      super(GAL_LAYER_ID_COUNT);

      if (a) for (const layer of a) this.setLayer(layer);
    }
  }

  /** `set( GAL_LAYER_ID aPos, bool aVal )`: the layer's bit, offset from the start. */
  setLayer(aPos: GAL_LAYER_ID, aVal = true): this {
    super.set(aPos - GAL_SET.start, aVal);
    return this;
  }

  Contains(aPos: GAL_LAYER_ID): boolean {
    return this.test(aPos - GAL_SET.start);
  }

  Seq(): GAL_LAYER_ID[] {
    const ret: GAL_LAYER_ID[] = [];

    for (let i = 0; i < this.size(); ++i) {
      if (this.test(i)) ret.push((i + GAL_LAYER_ID.GAL_LAYER_ID_START) as GAL_LAYER_ID);
    }

    return ret;
  }

  static DefaultVisible(): GAL_SET {
    const visible: GAL_LAYER_ID[] = [
      GAL_LAYER_ID.LAYER_VIAS,
      GAL_LAYER_ID.LAYER_VIA_MICROVIA,
      GAL_LAYER_ID.LAYER_VIA_BLIND,
      GAL_LAYER_ID.LAYER_VIA_BURIED,
      GAL_LAYER_ID.LAYER_VIA_THROUGH,
      // LAYER_HIDDEN_TEXT,    // DEPCREATED SINCE 9.0. Invisible text hidden by default
      GAL_LAYER_ID.LAYER_ANCHOR,
      GAL_LAYER_ID.LAYER_RATSNEST,
      GAL_LAYER_ID.LAYER_GRID,
      GAL_LAYER_ID.LAYER_GRID_AXES,
      GAL_LAYER_ID.LAYER_FOOTPRINTS_FR,
      GAL_LAYER_ID.LAYER_FOOTPRINTS_BK,
      GAL_LAYER_ID.LAYER_FP_TEXT,
      GAL_LAYER_ID.LAYER_FP_VALUES,
      GAL_LAYER_ID.LAYER_FP_REFERENCES,
      GAL_LAYER_ID.LAYER_TRACKS,
      GAL_LAYER_ID.LAYER_PAD_PLATEDHOLES,
      GAL_LAYER_ID.LAYER_NON_PLATEDHOLES,
      GAL_LAYER_ID.LAYER_PAD_HOLEWALLS,
      GAL_LAYER_ID.LAYER_VIA_HOLES,
      GAL_LAYER_ID.LAYER_VIA_HOLEWALLS,
      GAL_LAYER_ID.LAYER_DRC_ERROR,
      GAL_LAYER_ID.LAYER_DRC_WARNING,
      GAL_LAYER_ID.LAYER_DRC_SHAPES,
      // LAYER_DRC_EXCLUSION,      // DRC exclusions hidden by default
      GAL_LAYER_ID.LAYER_DRAWINGSHEET,
      GAL_LAYER_ID.LAYER_GP_OVERLAY,
      GAL_LAYER_ID.LAYER_SELECT_OVERLAY,
      GAL_LAYER_ID.LAYER_PCB_BACKGROUND,
      GAL_LAYER_ID.LAYER_CURSOR,
      GAL_LAYER_ID.LAYER_AUX_ITEMS,
      GAL_LAYER_ID.LAYER_DRAW_BITMAPS,
      GAL_LAYER_ID.LAYER_PADS,
      GAL_LAYER_ID.LAYER_ZONES,
      GAL_LAYER_ID.LAYER_FILLED_SHAPES,
      GAL_LAYER_ID.LAYER_LOCKED_ITEM_SHADOW,
      // LAYER_BOARD_OUTLINE_AREA,    // currently hidden by default
      GAL_LAYER_ID.LAYER_CONFLICTS_SHADOW,
      GAL_LAYER_ID.LAYER_POINTS,
    ];

    return new GAL_SET(visible);
  }
}

/// Eeschema drawing layers.
export enum SCH_LAYER_ID {
  SCH_LAYER_ID_START = GAL_LAYER_ID.GAL_LAYER_ID_END,

  LAYER_WIRE = SCH_LAYER_ID_START + 0,
  LAYER_BUS = SCH_LAYER_ID_START + 1,
  LAYER_JUNCTION = SCH_LAYER_ID_START + 2,
  LAYER_LOCLABEL = SCH_LAYER_ID_START + 3,
  LAYER_GLOBLABEL = SCH_LAYER_ID_START + 4,
  LAYER_HIERLABEL = SCH_LAYER_ID_START + 5,
  LAYER_PINNUM = SCH_LAYER_ID_START + 6,
  LAYER_PINNAM = SCH_LAYER_ID_START + 7,
  LAYER_REFERENCEPART = SCH_LAYER_ID_START + 8,
  LAYER_VALUEPART = SCH_LAYER_ID_START + 9,
  LAYER_FIELDS = SCH_LAYER_ID_START + 10,
  LAYER_INTERSHEET_REFS = SCH_LAYER_ID_START + 11,
  LAYER_NETCLASS_REFS = SCH_LAYER_ID_START + 12,
  LAYER_RULE_AREAS = SCH_LAYER_ID_START + 13,
  LAYER_DEVICE = SCH_LAYER_ID_START + 14,
  LAYER_NOTES = SCH_LAYER_ID_START + 15,
  LAYER_PRIVATE_NOTES = SCH_LAYER_ID_START + 16,
  LAYER_NOTES_BACKGROUND = SCH_LAYER_ID_START + 17,
  LAYER_PIN = SCH_LAYER_ID_START + 18,
  LAYER_SHEET = SCH_LAYER_ID_START + 19,
  LAYER_SHEETNAME = SCH_LAYER_ID_START + 20,
  LAYER_SHEETFILENAME = SCH_LAYER_ID_START + 21,
  LAYER_SHEETFIELDS = SCH_LAYER_ID_START + 22,
  LAYER_SHEETLABEL = SCH_LAYER_ID_START + 23,
  LAYER_NOCONNECT = SCH_LAYER_ID_START + 24,
  LAYER_DANGLING = SCH_LAYER_ID_START + 25,
  LAYER_DNP_MARKER = SCH_LAYER_ID_START + 26,
  LAYER_ERC_WARN = SCH_LAYER_ID_START + 27,
  LAYER_ERC_ERR = SCH_LAYER_ID_START + 28,
  LAYER_ERC_EXCLUSION = SCH_LAYER_ID_START + 29,
  LAYER_EXCLUDED_FROM_SIM = SCH_LAYER_ID_START + 30,
  LAYER_SHAPES_BACKGROUND = SCH_LAYER_ID_START + 31,
  LAYER_DEVICE_BACKGROUND = SCH_LAYER_ID_START + 32,
  LAYER_SHEET_BACKGROUND = SCH_LAYER_ID_START + 33,
  LAYER_SCHEMATIC_GRID = SCH_LAYER_ID_START + 34,
  LAYER_SCHEMATIC_GRID_AXES = SCH_LAYER_ID_START + 35,
  LAYER_SCHEMATIC_BACKGROUND = SCH_LAYER_ID_START + 36,
  LAYER_SCHEMATIC_CURSOR = SCH_LAYER_ID_START + 37,
  LAYER_HOVERED = SCH_LAYER_ID_START + 38,
  LAYER_BRIGHTENED = SCH_LAYER_ID_START + 39,
  LAYER_HIDDEN = SCH_LAYER_ID_START + 40,
  LAYER_NET_COLOR_HIGHLIGHT = SCH_LAYER_ID_START + 41,
  LAYER_DRAG_NET_COLLISION = SCH_LAYER_ID_START + 42,
  LAYER_SELECTION_SHADOWS = SCH_LAYER_ID_START + 43,
  LAYER_SCHEMATIC_DRAWINGSHEET = SCH_LAYER_ID_START + 44,
  LAYER_SCHEMATIC_PAGE_LIMITS = SCH_LAYER_ID_START + 45,
  LAYER_BUS_JUNCTION = SCH_LAYER_ID_START + 46,
  LAYER_SCHEMATIC_AUX_ITEMS = SCH_LAYER_ID_START + 47,
  LAYER_SCHEMATIC_ANCHOR = SCH_LAYER_ID_START + 48,
  LAYER_OP_VOLTAGES = SCH_LAYER_ID_START + 49,
  LAYER_OP_CURRENTS = SCH_LAYER_ID_START + 50,
  LAYER_GROUP = SCH_LAYER_ID_START + 51,
  SCH_LAYER_ID_END = SCH_LAYER_ID_START + 52,
}

export const {
  SCH_LAYER_ID_START,
  LAYER_WIRE,
  LAYER_BUS,
  LAYER_JUNCTION,
  LAYER_LOCLABEL,
  LAYER_GLOBLABEL,
  LAYER_HIERLABEL,
  LAYER_PINNUM,
  LAYER_PINNAM,
  LAYER_REFERENCEPART,
  LAYER_VALUEPART,
  LAYER_FIELDS,
  LAYER_INTERSHEET_REFS,
  LAYER_NETCLASS_REFS,
  LAYER_RULE_AREAS,
  LAYER_DEVICE,
  LAYER_NOTES,
  LAYER_PRIVATE_NOTES,
  LAYER_NOTES_BACKGROUND,
  LAYER_PIN,
  LAYER_SHEET,
  LAYER_SHEETNAME,
  LAYER_SHEETFILENAME,
  LAYER_SHEETFIELDS,
  LAYER_SHEETLABEL,
  LAYER_NOCONNECT,
  LAYER_DANGLING,
  LAYER_DNP_MARKER,
  LAYER_ERC_WARN,
  LAYER_ERC_ERR,
  LAYER_ERC_EXCLUSION,
  LAYER_EXCLUDED_FROM_SIM,
  LAYER_SHAPES_BACKGROUND,
  LAYER_DEVICE_BACKGROUND,
  LAYER_SHEET_BACKGROUND,
  LAYER_SCHEMATIC_GRID,
  LAYER_SCHEMATIC_GRID_AXES,
  LAYER_SCHEMATIC_BACKGROUND,
  LAYER_SCHEMATIC_CURSOR,
  LAYER_HOVERED,
  LAYER_BRIGHTENED,
  LAYER_HIDDEN,
  LAYER_NET_COLOR_HIGHLIGHT,
  LAYER_DRAG_NET_COLLISION,
  LAYER_SELECTION_SHADOWS,
  LAYER_SCHEMATIC_DRAWINGSHEET,
  LAYER_SCHEMATIC_PAGE_LIMITS,
  LAYER_BUS_JUNCTION,
  LAYER_SCHEMATIC_AUX_ITEMS,
  LAYER_SCHEMATIC_ANCHOR,
  LAYER_OP_VOLTAGES,
  LAYER_OP_CURRENTS,
  LAYER_GROUP,
  SCH_LAYER_ID_END,
} = SCH_LAYER_ID;

export const SCH_LAYER_ID_COUNT = SCH_LAYER_ID.SCH_LAYER_ID_END - SCH_LAYER_ID.SCH_LAYER_ID_START;
export const SCH_LAYER_INDEX = (x: number): number => x - SCH_LAYER_ID.SCH_LAYER_ID_START;

/// Number of draw layers in Gerbview.
export const GERBER_DRAWLAYERS_COUNT: number = PCB_LAYER_ID.PCB_LAYER_ID_COUNT;

/// Gerbview draw layers.
export enum GERBVIEW_LAYER_ID {
  GERBVIEW_LAYER_ID_START = SCH_LAYER_ID.SCH_LAYER_ID_END,

  /// Gerbview draw layers and d-code layers
  GERBVIEW_LAYER_ID_RESERVED = GERBVIEW_LAYER_ID_START + 2 * PCB_LAYER_ID.PCB_LAYER_ID_COUNT,

  LAYER_DCODES = GERBVIEW_LAYER_ID_RESERVED + 1,
  LAYER_NEGATIVE_OBJECTS = GERBVIEW_LAYER_ID_RESERVED + 2,
  LAYER_GERBVIEW_GRID = GERBVIEW_LAYER_ID_RESERVED + 3,
  LAYER_GERBVIEW_AXES = GERBVIEW_LAYER_ID_RESERVED + 4,
  LAYER_GERBVIEW_BACKGROUND = GERBVIEW_LAYER_ID_RESERVED + 5,
  LAYER_GERBVIEW_DRAWINGSHEET = GERBVIEW_LAYER_ID_RESERVED + 6,
  LAYER_GERBVIEW_PAGE_LIMITS = GERBVIEW_LAYER_ID_RESERVED + 7,

  GERBVIEW_LAYER_ID_END = GERBVIEW_LAYER_ID_RESERVED + 8,
}

export const {
  GERBVIEW_LAYER_ID_START,
  GERBVIEW_LAYER_ID_RESERVED,
  LAYER_DCODES,
  LAYER_NEGATIVE_OBJECTS,
  LAYER_GERBVIEW_GRID,
  LAYER_GERBVIEW_AXES,
  LAYER_GERBVIEW_BACKGROUND,
  LAYER_GERBVIEW_DRAWINGSHEET,
  LAYER_GERBVIEW_PAGE_LIMITS,
  GERBVIEW_LAYER_ID_END,
} = GERBVIEW_LAYER_ID;

export const GERBER_DRAW_LAYER = (x: number): number =>
  GERBVIEW_LAYER_ID.GERBVIEW_LAYER_ID_START + x;
export const GERBER_DCODE_LAYER = (x: number): number => GERBER_DRAWLAYERS_COUNT + x;
export const GERBER_DRAW_LAYER_INDEX = (x: number): number =>
  x - GERBVIEW_LAYER_ID.GERBVIEW_LAYER_ID_START;

/// 3D Viewer virtual layers for color settings
export enum LAYER_3D_ID {
  LAYER_3D_START = GERBVIEW_LAYER_ID.GERBVIEW_LAYER_ID_END,

  LAYER_3D_BACKGROUND_BOTTOM = LAYER_3D_START + 1,
  LAYER_3D_BACKGROUND_TOP = LAYER_3D_START + 2,
  LAYER_3D_BOARD = LAYER_3D_START + 3,
  LAYER_3D_COPPER_TOP = LAYER_3D_START + 4,
  LAYER_3D_COPPER_BOTTOM = LAYER_3D_START + 5,
  LAYER_3D_SILKSCREEN_BOTTOM = LAYER_3D_START + 6,
  LAYER_3D_SILKSCREEN_TOP = LAYER_3D_START + 7,
  LAYER_3D_SOLDERMASK_BOTTOM = LAYER_3D_START + 8,
  LAYER_3D_SOLDERMASK_TOP = LAYER_3D_START + 9,
  LAYER_3D_SOLDERPASTE = LAYER_3D_START + 10,
  LAYER_3D_ADHESIVE = LAYER_3D_START + 11,
  LAYER_3D_USER_COMMENTS = LAYER_3D_START + 12,
  LAYER_3D_USER_DRAWINGS = LAYER_3D_START + 13,
  LAYER_3D_USER_ECO1 = LAYER_3D_START + 14,
  LAYER_3D_USER_ECO2 = LAYER_3D_START + 15,
  LAYER_3D_USER_1 = LAYER_3D_START + 16,
  LAYER_3D_USER_2 = LAYER_3D_START + 17,
  LAYER_3D_USER_3 = LAYER_3D_START + 18,
  LAYER_3D_USER_4 = LAYER_3D_START + 19,
  LAYER_3D_USER_5 = LAYER_3D_START + 20,
  LAYER_3D_USER_6 = LAYER_3D_START + 21,
  LAYER_3D_USER_7 = LAYER_3D_START + 22,
  LAYER_3D_USER_8 = LAYER_3D_START + 23,
  LAYER_3D_USER_9 = LAYER_3D_START + 24,
  LAYER_3D_USER_10 = LAYER_3D_START + 25,
  LAYER_3D_USER_11 = LAYER_3D_START + 26,
  LAYER_3D_USER_12 = LAYER_3D_START + 27,
  LAYER_3D_USER_13 = LAYER_3D_START + 28,
  LAYER_3D_USER_14 = LAYER_3D_START + 29,
  LAYER_3D_USER_15 = LAYER_3D_START + 30,
  LAYER_3D_USER_16 = LAYER_3D_START + 31,
  LAYER_3D_USER_17 = LAYER_3D_START + 32,
  LAYER_3D_USER_18 = LAYER_3D_START + 33,
  LAYER_3D_USER_19 = LAYER_3D_START + 34,
  LAYER_3D_USER_20 = LAYER_3D_START + 35,
  LAYER_3D_USER_21 = LAYER_3D_START + 36,
  LAYER_3D_USER_22 = LAYER_3D_START + 37,
  LAYER_3D_USER_23 = LAYER_3D_START + 38,
  LAYER_3D_USER_24 = LAYER_3D_START + 39,
  LAYER_3D_USER_25 = LAYER_3D_START + 40,
  LAYER_3D_USER_26 = LAYER_3D_START + 41,
  LAYER_3D_USER_27 = LAYER_3D_START + 42,
  LAYER_3D_USER_28 = LAYER_3D_START + 43,
  LAYER_3D_USER_29 = LAYER_3D_START + 44,
  LAYER_3D_USER_30 = LAYER_3D_START + 45,
  LAYER_3D_USER_31 = LAYER_3D_START + 46,
  LAYER_3D_USER_32 = LAYER_3D_START + 47,
  LAYER_3D_USER_33 = LAYER_3D_START + 48,
  LAYER_3D_USER_34 = LAYER_3D_START + 49,
  LAYER_3D_USER_35 = LAYER_3D_START + 50,
  LAYER_3D_USER_36 = LAYER_3D_START + 51,
  LAYER_3D_USER_37 = LAYER_3D_START + 52,
  LAYER_3D_USER_38 = LAYER_3D_START + 53,
  LAYER_3D_USER_39 = LAYER_3D_START + 54,
  LAYER_3D_USER_40 = LAYER_3D_START + 55,
  LAYER_3D_USER_41 = LAYER_3D_START + 56,
  LAYER_3D_USER_42 = LAYER_3D_START + 57,
  LAYER_3D_USER_43 = LAYER_3D_START + 58,
  LAYER_3D_USER_44 = LAYER_3D_START + 59,
  LAYER_3D_USER_45 = LAYER_3D_START + 60,
  LAYER_3D_TH_MODELS = LAYER_3D_START + 61,
  LAYER_3D_SMD_MODELS = LAYER_3D_START + 62,
  LAYER_3D_VIRTUAL_MODELS = LAYER_3D_START + 63,
  LAYER_3D_MODELS_NOT_IN_POS = LAYER_3D_START + 64,
  LAYER_3D_MODELS_MARKED_DNP = LAYER_3D_START + 65,
  LAYER_3D_NAVIGATOR = LAYER_3D_START + 66,
  LAYER_3D_BOUNDING_BOXES = LAYER_3D_START + 67,
  LAYER_3D_OFF_BOARD_SILK = LAYER_3D_START + 68,
  LAYER_3D_PLATED_BARRELS = LAYER_3D_START + 69,
  LAYER_3D_END = LAYER_3D_START + 70,
}

export const {
  LAYER_3D_START,
  LAYER_3D_BACKGROUND_BOTTOM,
  LAYER_3D_BACKGROUND_TOP,
  LAYER_3D_BOARD,
  LAYER_3D_COPPER_TOP,
  LAYER_3D_COPPER_BOTTOM,
  LAYER_3D_SILKSCREEN_BOTTOM,
  LAYER_3D_SILKSCREEN_TOP,
  LAYER_3D_SOLDERMASK_BOTTOM,
  LAYER_3D_SOLDERMASK_TOP,
  LAYER_3D_SOLDERPASTE,
  LAYER_3D_ADHESIVE,
  LAYER_3D_USER_COMMENTS,
  LAYER_3D_USER_DRAWINGS,
  LAYER_3D_USER_ECO1,
  LAYER_3D_USER_ECO2,
  LAYER_3D_USER_1,
  LAYER_3D_USER_2,
  LAYER_3D_USER_3,
  LAYER_3D_USER_4,
  LAYER_3D_USER_5,
  LAYER_3D_USER_6,
  LAYER_3D_USER_7,
  LAYER_3D_USER_8,
  LAYER_3D_USER_9,
  LAYER_3D_USER_10,
  LAYER_3D_USER_11,
  LAYER_3D_USER_12,
  LAYER_3D_USER_13,
  LAYER_3D_USER_14,
  LAYER_3D_USER_15,
  LAYER_3D_USER_16,
  LAYER_3D_USER_17,
  LAYER_3D_USER_18,
  LAYER_3D_USER_19,
  LAYER_3D_USER_20,
  LAYER_3D_USER_21,
  LAYER_3D_USER_22,
  LAYER_3D_USER_23,
  LAYER_3D_USER_24,
  LAYER_3D_USER_25,
  LAYER_3D_USER_26,
  LAYER_3D_USER_27,
  LAYER_3D_USER_28,
  LAYER_3D_USER_29,
  LAYER_3D_USER_30,
  LAYER_3D_USER_31,
  LAYER_3D_USER_32,
  LAYER_3D_USER_33,
  LAYER_3D_USER_34,
  LAYER_3D_USER_35,
  LAYER_3D_USER_36,
  LAYER_3D_USER_37,
  LAYER_3D_USER_38,
  LAYER_3D_USER_39,
  LAYER_3D_USER_40,
  LAYER_3D_USER_41,
  LAYER_3D_USER_42,
  LAYER_3D_USER_43,
  LAYER_3D_USER_44,
  LAYER_3D_USER_45,
  LAYER_3D_TH_MODELS,
  LAYER_3D_SMD_MODELS,
  LAYER_3D_VIRTUAL_MODELS,
  LAYER_3D_MODELS_NOT_IN_POS,
  LAYER_3D_MODELS_MARKED_DNP,
  LAYER_3D_NAVIGATOR,
  LAYER_3D_BOUNDING_BOXES,
  LAYER_3D_OFF_BOARD_SILK,
  LAYER_3D_PLATED_BARRELS,
  LAYER_3D_END,
} = LAYER_3D_ID;

/// Must update this if you add any enums after Gerbview!
export const LAYER_ID_COUNT: number = LAYER_3D_ID.LAYER_3D_END;

/**
 * Returns the default display name for a given layer.  These are not the same as the canonical
 * name in LSET::Name(), which is used in board files and cannot be translated or changed.
 * WARNING: do not translate board physical layers names (F.Cu to User.9): because canonical names
 * are used in files (boards and fab files), using translated names in UI create mistakes for users.
 * Board physical layers names must be seen as proper nouns.
 */
export function LayerName(aLayer: number): string {
  switch (aLayer) {
    // PCB_LAYER_ID
    case PCB_LAYER_ID.UNDEFINED_LAYER:
      return 'undefined';

    // Copper
    case PCB_LAYER_ID.F_Cu:
      return 'F.Cu';
    case PCB_LAYER_ID.B_Cu:
      return 'B.Cu';

    // Technicals
    case PCB_LAYER_ID.B_Adhes:
      return 'B.Adhesive';
    case PCB_LAYER_ID.F_Adhes:
      return 'F.Adhesive';
    case PCB_LAYER_ID.B_Paste:
      return 'B.Paste';
    case PCB_LAYER_ID.F_Paste:
      return 'F.Paste';
    case PCB_LAYER_ID.B_SilkS:
      return 'B.Silkscreen';
    case PCB_LAYER_ID.F_SilkS:
      return 'F.Silkscreen';
    case PCB_LAYER_ID.B_Mask:
      return 'B.Mask';
    case PCB_LAYER_ID.F_Mask:
      return 'F.Mask';

    // Users
    case PCB_LAYER_ID.Dwgs_User:
      return 'User.Drawings';
    case PCB_LAYER_ID.Cmts_User:
      return 'User.Comments';
    case PCB_LAYER_ID.Eco1_User:
      return 'User.Eco1';
    case PCB_LAYER_ID.Eco2_User:
      return 'User.Eco2';
    case PCB_LAYER_ID.Edge_Cuts:
      return 'Edge.Cuts';
    case PCB_LAYER_ID.Margin:
      return 'Margin';

    // Footprint
    case PCB_LAYER_ID.F_CrtYd:
      return 'F.Courtyard';
    case PCB_LAYER_ID.B_CrtYd:
      return 'B.Courtyard';
    case PCB_LAYER_ID.F_Fab:
      return 'F.Fab';
    case PCB_LAYER_ID.B_Fab:
      return 'B.Fab';

    // Rescue
    case PCB_LAYER_ID.Rescue:
      return 'Rescue';

    // SCH_LAYER_ID
    case SCH_LAYER_ID.LAYER_WIRE:
      return 'Wires';
    case SCH_LAYER_ID.LAYER_BUS:
      return 'Buses';
    case SCH_LAYER_ID.LAYER_BUS_JUNCTION:
      return 'Bus junctions';
    case SCH_LAYER_ID.LAYER_JUNCTION:
      return 'Junctions';
    case SCH_LAYER_ID.LAYER_LOCLABEL:
      return 'Labels';
    case SCH_LAYER_ID.LAYER_GLOBLABEL:
      return 'Global labels';
    case SCH_LAYER_ID.LAYER_HIERLABEL:
      return 'Hierarchical labels';
    case SCH_LAYER_ID.LAYER_PINNUM:
      return 'Pin numbers';
    case SCH_LAYER_ID.LAYER_PINNAM:
      return 'Pin names';
    case SCH_LAYER_ID.LAYER_REFERENCEPART:
      return 'Symbol references';
    case SCH_LAYER_ID.LAYER_VALUEPART:
      return 'Symbol values';
    case SCH_LAYER_ID.LAYER_FIELDS:
      return 'Symbol fields';
    case SCH_LAYER_ID.LAYER_INTERSHEET_REFS:
      return 'Sheet references';
    case SCH_LAYER_ID.LAYER_NETCLASS_REFS:
      return 'Net class references';
    case SCH_LAYER_ID.LAYER_RULE_AREAS:
      return 'Rule areas';
    case SCH_LAYER_ID.LAYER_DEVICE:
      return 'Symbol body outlines';
    case SCH_LAYER_ID.LAYER_DEVICE_BACKGROUND:
      return 'Symbol body fills';
    case SCH_LAYER_ID.LAYER_SHAPES_BACKGROUND:
      return 'Shape fills';
    case SCH_LAYER_ID.LAYER_NOTES:
      return 'Schematic text && graphics';
    case SCH_LAYER_ID.LAYER_PRIVATE_NOTES:
      return 'Symbol private text && graphics';
    case SCH_LAYER_ID.LAYER_NOTES_BACKGROUND:
      return 'Schematic text && graphics backgrounds';
    case SCH_LAYER_ID.LAYER_PIN:
      return 'Pins';
    case SCH_LAYER_ID.LAYER_SHEET:
      return 'Sheet borders';
    case SCH_LAYER_ID.LAYER_SHEET_BACKGROUND:
      return 'Sheet backgrounds';
    case SCH_LAYER_ID.LAYER_SHEETNAME:
      return 'Sheet names';
    case SCH_LAYER_ID.LAYER_SHEETFIELDS:
      return 'Sheet fields';
    case SCH_LAYER_ID.LAYER_SHEETFILENAME:
      return 'Sheet file names';
    case SCH_LAYER_ID.LAYER_SHEETLABEL:
      return 'Sheet pins';
    case SCH_LAYER_ID.LAYER_NOCONNECT:
      return 'No-connect symbols';
    case SCH_LAYER_ID.LAYER_DNP_MARKER:
      return 'DNP markers';
    case SCH_LAYER_ID.LAYER_EXCLUDED_FROM_SIM:
      return 'Excluded-from-simulation markers';
    case SCH_LAYER_ID.LAYER_ERC_WARN:
      return 'ERC warnings';
    case SCH_LAYER_ID.LAYER_ERC_ERR:
      return 'ERC errors';
    case SCH_LAYER_ID.LAYER_ERC_EXCLUSION:
      return 'ERC exclusions';
    case SCH_LAYER_ID.LAYER_SCHEMATIC_ANCHOR:
      return 'Anchors';
    case SCH_LAYER_ID.LAYER_SCHEMATIC_AUX_ITEMS:
      return 'Helper items';
    case SCH_LAYER_ID.LAYER_SCHEMATIC_GRID:
      return 'Grid';
    case SCH_LAYER_ID.LAYER_SCHEMATIC_GRID_AXES:
      return 'Axes';
    case SCH_LAYER_ID.LAYER_SCHEMATIC_BACKGROUND:
      return 'Background';
    case SCH_LAYER_ID.LAYER_SCHEMATIC_CURSOR:
      return 'Cursor';
    case SCH_LAYER_ID.LAYER_HOVERED:
      return 'Hovered items';
    case SCH_LAYER_ID.LAYER_BRIGHTENED:
      return 'Highlighted items';
    case SCH_LAYER_ID.LAYER_HIDDEN:
      return 'Hidden items';
    case SCH_LAYER_ID.LAYER_NET_COLOR_HIGHLIGHT:
      return 'Net color highlight';
    case SCH_LAYER_ID.LAYER_DRAG_NET_COLLISION:
      return 'Drag net collisions';
    case SCH_LAYER_ID.LAYER_SELECTION_SHADOWS:
      return 'Selection highlight';
    case SCH_LAYER_ID.LAYER_SCHEMATIC_DRAWINGSHEET:
      return 'Drawing sheet';
    case SCH_LAYER_ID.LAYER_SCHEMATIC_PAGE_LIMITS:
      return 'Page limits';
    case SCH_LAYER_ID.LAYER_OP_VOLTAGES:
      return 'Operating point voltages';
    case SCH_LAYER_ID.LAYER_OP_CURRENTS:
      return 'Operating point currents';

    // GAL_LAYER_ID
    case GAL_LAYER_ID.LAYER_FOOTPRINTS_FR:
      return 'Footprints front';
    case GAL_LAYER_ID.LAYER_FOOTPRINTS_BK:
      return 'Footprints back';
    case GAL_LAYER_ID.LAYER_FP_VALUES:
      return 'Values';
    case GAL_LAYER_ID.LAYER_FP_REFERENCES:
      return 'Reference designators';
    case GAL_LAYER_ID.LAYER_FP_TEXT:
      return 'Footprint text';
    case GAL_LAYER_ID.LAYER_TRACKS:
      return 'Tracks';
    case GAL_LAYER_ID.LAYER_VIA_THROUGH:
      return 'Through vias';
    case GAL_LAYER_ID.LAYER_VIA_BLIND:
      return 'Blind vias';
    case GAL_LAYER_ID.LAYER_VIA_BURIED:
      return 'Buried vias';
    case GAL_LAYER_ID.LAYER_VIA_MICROVIA:
      return 'Micro-vias';
    case GAL_LAYER_ID.LAYER_VIA_HOLES:
      return 'Via holes';
    case GAL_LAYER_ID.LAYER_VIA_HOLEWALLS:
      return 'Via hole walls';
    case GAL_LAYER_ID.LAYER_PAD_PLATEDHOLES:
      return 'Plated holes';
    case GAL_LAYER_ID.LAYER_PAD_HOLEWALLS:
      return 'Plated hole walls';
    case GAL_LAYER_ID.LAYER_NON_PLATEDHOLES:
      return 'Non-plated holes';
    case GAL_LAYER_ID.LAYER_RATSNEST:
      return 'Ratsnest';
    case GAL_LAYER_ID.LAYER_DRC_WARNING:
      return 'DRC warnings';
    case GAL_LAYER_ID.LAYER_DRC_ERROR:
      return 'DRC errors';
    case GAL_LAYER_ID.LAYER_DRC_SHAPES:
      return 'DRC shapes';
    case GAL_LAYER_ID.LAYER_DRC_EXCLUSION:
      return 'DRC exclusions';
    case GAL_LAYER_ID.LAYER_MARKER_SHADOWS:
      return 'DRC marker shadows';
    case GAL_LAYER_ID.LAYER_ANCHOR:
      return 'Anchors';
    case GAL_LAYER_ID.LAYER_POINTS:
      return 'Points';
    case GAL_LAYER_ID.LAYER_DRAWINGSHEET:
      return 'Drawing sheet';
    case GAL_LAYER_ID.LAYER_PAGE_LIMITS:
      return 'Page limits';
    case GAL_LAYER_ID.LAYER_CURSOR:
      return 'Cursor';
    case GAL_LAYER_ID.LAYER_AUX_ITEMS:
      return 'Helper items';
    case GAL_LAYER_ID.LAYER_GRID:
      return 'Grid';
    case GAL_LAYER_ID.LAYER_GRID_AXES:
      return 'Grid axes';
    case GAL_LAYER_ID.LAYER_PCB_BACKGROUND:
      return 'Background';
    case GAL_LAYER_ID.LAYER_SELECT_OVERLAY:
      return 'Selection highlight';
    case GAL_LAYER_ID.LAYER_LOCKED_ITEM_SHADOW:
      return 'Locked item shadow';
    case GAL_LAYER_ID.LAYER_CONFLICTS_SHADOW:
      return 'Courtyard collision shadow';
    case GAL_LAYER_ID.LAYER_BOARD_OUTLINE_AREA:
      return 'Board outline area';
    case NETNAMES_LAYER_ID.NETNAMES_LAYER_ID_START:
      return 'Track net names';
    case NETNAMES_LAYER_ID.LAYER_PAD_NETNAMES:
      return 'Pad net names';
    case NETNAMES_LAYER_ID.LAYER_VIA_NETNAMES:
      return 'Via net names';

    default:
      // Catch the general board layers that have numerically increasing names
      if (aLayer > 0 && aLayer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT && aLayer & 1)
        return `User.${Math.trunc((aLayer - PCB_LAYER_ID.User_1) / 2) + 1}`;

      return `In${Math.trunc((aLayer - PCB_LAYER_ID.In1_Cu) / 2) + 1}.Cu`;
  }
}

// Some elements do not have yet a visibility control
// from a dialog, but have a visibility control flag.
// Here is a mask to set them visible, to be sure they are displayed
// after loading a board for instance
export const MIN_VISIBILITY_MASK: number =
  (1 << GAL_LAYER_INDEX(GAL_LAYER_ID.LAYER_PAD_PLATEDHOLES)) +
  (1 << GAL_LAYER_INDEX(GAL_LAYER_ID.LAYER_VIA_HOLES)) +
  (1 << GAL_LAYER_INDEX(GAL_LAYER_ID.LAYER_SELECT_OVERLAY)) +
  (1 << GAL_LAYER_INDEX(GAL_LAYER_ID.LAYER_GP_OVERLAY)) +
  (1 << GAL_LAYER_INDEX(GAL_LAYER_ID.LAYER_RATSNEST));

/**
 * Test whether a given integer is a valid layer index, i.e. can
 * be safely put in a #PCB_LAYER_ID.
 *
 * @param aLayerId = Layer index to test. It can be an int, so its useful during I/O
 * @return true if aLayerIndex is a valid layer index
 */
export function IsValidLayer(aLayerId: number): boolean {
  return aLayerId >>> 0 < PCB_LAYER_ID.PCB_LAYER_ID_COUNT;
}

/**
 * Test whether a layer is a valid layer for Pcbnew
 *
 * @param aLayer = Layer to test
 * @return true if aLayer is a layer valid in Pcbnew
 */
export function IsPcbLayer(aLayer: number): boolean {
  return aLayer >= PCB_LAYER_ID.F_Cu && aLayer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT;
}

/**
 * Test whether a layer is a copper layer.
 *
 * @param aLayerId = Layer  to test
 * @param aIncludeSyntheticCopperLayers optionally include synthetic copper layers such as
 *        #LAYER_VIA_THROUGH, #LAYER_PADS_SMD_FR, etc.
 * @return true if aLayer is a valid copper layer
 */
export function IsCopperLayer(aLayerId: number, aIncludeSyntheticCopperLayers?: boolean): boolean {
  if (aIncludeSyntheticCopperLayers !== undefined) {
    if (aIncludeSyntheticCopperLayers) return !IsNonCopperLayer(aLayerId);
    else return IsCopperLayer(aLayerId);
  }

  return !(aLayerId & 1) && aLayerId < PCB_LAYER_ID.PCB_LAYER_ID_COUNT && aLayerId >= 0;
}

/**
 * Test whether a layer is an external (#F_Cu or #B_Cu) copper layer.
 *
 * @param aLayerId = Layer  to test
 * @return true if aLayer is a valid external copper layer
 */
export function IsExternalCopperLayer(aLayerId: number): boolean {
  return aLayerId === PCB_LAYER_ID.F_Cu || aLayerId === PCB_LAYER_ID.B_Cu;
}

/**
 * Test whether a layer is an inner (#In1_Cu to #In30_Cu) copper layer.
 *
 * @param aLayerId = Layer  to test
 * @return true if aLayer is a valid inner copper layer
 */
export function IsInnerCopperLayer(aLayerId: number): boolean {
  return IsCopperLayer(aLayerId) && !IsExternalCopperLayer(aLayerId);
}

/**
 * Test whether a layer is a non copper layer.
 *
 * @param aLayerId = Layer to test
 * @return true if aLayer is a non copper layer
 */
export function IsNonCopperLayer(aLayerId: number): boolean {
  return (aLayerId & 1) !== 0 && aLayerId <= PCB_LAYER_ID.PCB_LAYER_ID_COUNT;
}

export function IsViaPadLayer(aLayer: number): boolean {
  return (
    aLayer === GAL_LAYER_ID.LAYER_VIA_THROUGH ||
    aLayer === GAL_LAYER_ID.LAYER_VIA_MICROVIA ||
    aLayer === GAL_LAYER_ID.LAYER_VIA_BLIND ||
    aLayer === GAL_LAYER_ID.LAYER_VIA_BURIED
  );
}

export function IsHoleLayer(aLayer: number): boolean {
  return (
    aLayer === GAL_LAYER_ID.LAYER_VIA_HOLES ||
    aLayer === GAL_LAYER_ID.LAYER_VIA_HOLEWALLS ||
    aLayer === GAL_LAYER_ID.LAYER_PAD_PLATEDHOLES ||
    aLayer === GAL_LAYER_ID.LAYER_PAD_HOLEWALLS ||
    aLayer === GAL_LAYER_ID.LAYER_NON_PLATEDHOLES
  );
}

export function IsSolderMaskLayer(aLayer: number): boolean {
  return aLayer === PCB_LAYER_ID.F_Mask || aLayer === PCB_LAYER_ID.B_Mask;
}

/**
 * Test whether a layer is a non copper and a non tech layer.
 *
 * @param aLayerId = Layer to test
 * @return true if aLayer is a user layer
 */
export function IsUserLayer(aLayerId: PCB_LAYER_ID): boolean {
  return (
    aLayerId === PCB_LAYER_ID.Dwgs_User ||
    aLayerId === PCB_LAYER_ID.Cmts_User ||
    aLayerId === PCB_LAYER_ID.Eco1_User ||
    aLayerId === PCB_LAYER_ID.Eco2_User ||
    (aLayerId >= PCB_LAYER_ID.User_1 && !IsCopperLayer(aLayerId))
  );
}

/*
 * IMPORTANT: If a layer is not a front layer that doesn't necessarily mean it's a back layer.
 *
 * So a layer can be:
 *   - Front
 *   - Back
 *   - Neither (internal or auxiliary)
 *
 * The check most frequent is for back layers, since it involves flips.
 */

/**
 * Layer classification: check if it's a front layer.
 */
export function IsFrontLayer(aLayerId: PCB_LAYER_ID): boolean {
  switch (aLayerId) {
    case PCB_LAYER_ID.F_Cu:
    case PCB_LAYER_ID.F_Adhes:
    case PCB_LAYER_ID.F_Paste:
    case PCB_LAYER_ID.F_SilkS:
    case PCB_LAYER_ID.F_Mask:
    case PCB_LAYER_ID.F_CrtYd:
    case PCB_LAYER_ID.F_Fab:
      return true;
    default:
  }

  return false;
}

/**
 * Layer classification: check if it's a back layer.
 */
export function IsBackLayer(aLayerId: PCB_LAYER_ID): boolean {
  switch (aLayerId) {
    case PCB_LAYER_ID.B_Cu:
    case PCB_LAYER_ID.B_Adhes:
    case PCB_LAYER_ID.B_Paste:
    case PCB_LAYER_ID.B_SilkS:
    case PCB_LAYER_ID.B_Mask:
    case PCB_LAYER_ID.B_CrtYd:
    case PCB_LAYER_ID.B_Fab:
      return true;
    default:
      return false;
  }
}

/**
 * Return true if copper aLayerA is placed lower than aLayerB, false otherwise.
 */
export function IsCopperLayerLowerThan(aLayerA: PCB_LAYER_ID, aLayerB: PCB_LAYER_ID): boolean {
  if (aLayerA === aLayerB) return false;

  if (aLayerA === PCB_LAYER_ID.B_Cu) return true;

  if (aLayerB === PCB_LAYER_ID.B_Cu) return false;

  return aLayerA > aLayerB;
}

/**
 * @param aLayerId = the PCB_LAYER_ID to flip
 * @param aCopperLayersCount = the number of copper layers. if 0 (in fact if < 4 )
 *  internal layers will be not flipped because the layer count is not known
 * @return the layer number after flipping an item
 * some (not all) layers: external copper, and paired layers( Mask, Paste, solder ... )
 * are swapped between front and back sides
 * internal layers are flipped only if the copper layers count is known
 */
export function FlipLayer(aLayerId: PCB_LAYER_ID, aCopperLayersCount = 0): PCB_LAYER_ID {
  switch (aLayerId) {
    case PCB_LAYER_ID.B_Cu:
      return PCB_LAYER_ID.F_Cu;
    case PCB_LAYER_ID.F_Cu:
      return PCB_LAYER_ID.B_Cu;

    case PCB_LAYER_ID.B_SilkS:
      return PCB_LAYER_ID.F_SilkS;
    case PCB_LAYER_ID.F_SilkS:
      return PCB_LAYER_ID.B_SilkS;

    case PCB_LAYER_ID.B_Adhes:
      return PCB_LAYER_ID.F_Adhes;
    case PCB_LAYER_ID.F_Adhes:
      return PCB_LAYER_ID.B_Adhes;

    case PCB_LAYER_ID.B_Mask:
      return PCB_LAYER_ID.F_Mask;
    case PCB_LAYER_ID.F_Mask:
      return PCB_LAYER_ID.B_Mask;

    case PCB_LAYER_ID.B_Paste:
      return PCB_LAYER_ID.F_Paste;
    case PCB_LAYER_ID.F_Paste:
      return PCB_LAYER_ID.B_Paste;

    case PCB_LAYER_ID.B_CrtYd:
      return PCB_LAYER_ID.F_CrtYd;
    case PCB_LAYER_ID.F_CrtYd:
      return PCB_LAYER_ID.B_CrtYd;

    case PCB_LAYER_ID.B_Fab:
      return PCB_LAYER_ID.F_Fab;
    case PCB_LAYER_ID.F_Fab:
      return PCB_LAYER_ID.B_Fab;

    default: // change internal layer if aCopperLayersCount is >= 4
      if (IsCopperLayer(aLayerId) && aCopperLayersCount >= 4) {
        const innerIndex = Math.trunc((aLayerId - PCB_LAYER_ID.In1_Cu) / 2);
        let flippedIndex = aCopperLayersCount - 3 - innerIndex;

        if (flippedIndex < 0) flippedIndex = 0;

        const maxIndex = aCopperLayersCount - 3;

        if (flippedIndex > maxIndex) flippedIndex = maxIndex;

        return (PCB_LAYER_ID.In1_Cu + flippedIndex * 2) as PCB_LAYER_ID;
      }

      // No change for the other layers
      return aLayerId;
  }
}

/**
 * Return a netname layer corresponding to the given layer.
 */
export function GetNetnameLayer(aLayer: number): number {
  if (IsCopperLayer(aLayer) || IsViaPadLayer(aLayer)) return NETNAMES_LAYER_INDEX(aLayer);

  // Fallback
  return PCB_LAYER_ID.Cmts_User;
}

/**
 * Test whether a layer is a netname layer.
 *
 * @param aLayer = Layer to test
 * @return true if aLayer is a valid netname layer
 */
export function IsNetnameLayer(aLayer: number): boolean {
  return (
    aLayer >= NETNAMES_LAYER_INDEX(PCB_LAYER_ID.F_Cu) &&
    aLayer < NETNAMES_LAYER_ID.NETNAMES_LAYER_ID_END
  );
}

export function IsZoneFillLayer(aLayer: number): boolean {
  return aLayer >= GAL_LAYER_ID.LAYER_ZONE_START && aLayer <= GAL_LAYER_ID.LAYER_ZONE_END;
}

export function IsPadCopperLayer(aLayer: number): boolean {
  return (
    aLayer >= GAL_LAYER_ID.LAYER_PAD_COPPER_START && aLayer <= GAL_LAYER_ID.LAYER_PAD_COPPER_END
  );
}

export function IsViaCopperLayer(aLayer: number): boolean {
  return (
    aLayer >= GAL_LAYER_ID.LAYER_VIA_COPPER_START && aLayer <= GAL_LAYER_ID.LAYER_VIA_COPPER_END
  );
}

export function IsClearanceLayer(aLayer: number): boolean {
  return aLayer >= GAL_LAYER_ID.LAYER_CLEARANCE_START && aLayer <= GAL_LAYER_ID.LAYER_CLEARANCE_END;
}

export function IsPointsLayer(aLayer: number): boolean {
  return aLayer >= GAL_LAYER_ID.LAYER_POINT_START && aLayer <= GAL_LAYER_ID.LAYER_POINT_END;
}

export function IsDCodeLayer(aLayer: number): boolean {
  return (
    aLayer >= GERBVIEW_LAYER_ID.GERBVIEW_LAYER_ID_START + GERBER_DRAWLAYERS_COUNT &&
    aLayer < GERBVIEW_LAYER_ID.GERBVIEW_LAYER_ID_START + 2 * GERBER_DRAWLAYERS_COUNT
  );
}

/// Converts KiCad copper layer enum to an ordinal between the front and back layers.
export function CopperLayerToOrdinal(aLayer: PCB_LAYER_ID): number {
  if (!IsCopperLayer(aLayer)) return 0;

  switch (aLayer) {
    case PCB_LAYER_ID.F_Cu:
      return 0;
    case PCB_LAYER_ID.B_Cu:
      return MAX_CU_LAYERS - 1;
    default:
      return Math.trunc((aLayer - PCB_LAYER_ID.B_Cu) / 2);
  }
}

/**
 * Retrieve a layer ID from an integer converted from a legacy (pre-V9) enum value.
 */
export function BoardLayerFromLegacyId(aLegacyId: number): PCB_LAYER_ID {
  switch (aLegacyId) {
    case 0:
      return PCB_LAYER_ID.F_Cu;
    case 31:
      return PCB_LAYER_ID.B_Cu;
    default:
      if (aLegacyId < 0)
        return aLegacyId === PCB_LAYER_ID.UNSELECTED_LAYER
          ? PCB_LAYER_ID.UNSELECTED_LAYER
          : PCB_LAYER_ID.UNDEFINED_LAYER;

      if (aLegacyId < 31) return (PCB_LAYER_ID.In1_Cu + (aLegacyId - 1) * 2) as PCB_LAYER_ID;

      switch (aLegacyId) {
        case 32:
          return PCB_LAYER_ID.B_Adhes;
        case 33:
          return PCB_LAYER_ID.F_Adhes;
        case 34:
          return PCB_LAYER_ID.B_Paste;
        case 35:
          return PCB_LAYER_ID.F_Paste;
        case 36:
          return PCB_LAYER_ID.B_SilkS;
        case 37:
          return PCB_LAYER_ID.F_SilkS;
        case 38:
          return PCB_LAYER_ID.B_Mask;
        case 39:
          return PCB_LAYER_ID.F_Mask;
        case 40:
          return PCB_LAYER_ID.Dwgs_User;
        case 41:
          return PCB_LAYER_ID.Cmts_User;
        case 42:
          return PCB_LAYER_ID.Eco1_User;
        case 43:
          return PCB_LAYER_ID.Eco2_User;
        case 44:
          return PCB_LAYER_ID.Edge_Cuts;
        case 45:
          return PCB_LAYER_ID.Margin;
        case 46:
          return PCB_LAYER_ID.B_CrtYd;
        case 47:
          return PCB_LAYER_ID.F_CrtYd;
        case 48:
          return PCB_LAYER_ID.B_Fab;
        case 49:
          return PCB_LAYER_ID.F_Fab;
        case 50:
          return PCB_LAYER_ID.User_1;
        case 51:
          return PCB_LAYER_ID.User_2;
        case 52:
          return PCB_LAYER_ID.User_3;
        case 53:
          return PCB_LAYER_ID.User_4;
        case 54:
          return PCB_LAYER_ID.User_5;
        case 55:
          return PCB_LAYER_ID.User_6;
        case 56:
          return PCB_LAYER_ID.User_7;
        case 57:
          return PCB_LAYER_ID.User_8;
        case 58:
          return PCB_LAYER_ID.User_9;
        case 59:
          return PCB_LAYER_ID.Rescue;
        default:
          return PCB_LAYER_ID.UNDEFINED_LAYER;
      }
  }
}

const PCB_TO_3D_LAYER: ReadonlyMap<PCB_LAYER_ID, LAYER_3D_ID> = new Map<PCB_LAYER_ID, LAYER_3D_ID>([
  // NOTE: User_1..User45 are NOT consecutive numbers!
  [PCB_LAYER_ID.F_Cu, LAYER_3D_ID.LAYER_3D_COPPER_TOP],
  [PCB_LAYER_ID.B_Cu, LAYER_3D_ID.LAYER_3D_COPPER_BOTTOM],
  [PCB_LAYER_ID.B_SilkS, LAYER_3D_ID.LAYER_3D_SILKSCREEN_BOTTOM],
  [PCB_LAYER_ID.F_SilkS, LAYER_3D_ID.LAYER_3D_SILKSCREEN_TOP],
  [PCB_LAYER_ID.B_Mask, LAYER_3D_ID.LAYER_3D_SOLDERMASK_BOTTOM],
  [PCB_LAYER_ID.F_Mask, LAYER_3D_ID.LAYER_3D_SOLDERMASK_TOP],
  [PCB_LAYER_ID.Cmts_User, LAYER_3D_ID.LAYER_3D_USER_COMMENTS],
  [PCB_LAYER_ID.Dwgs_User, LAYER_3D_ID.LAYER_3D_USER_DRAWINGS],
  [PCB_LAYER_ID.Eco1_User, LAYER_3D_ID.LAYER_3D_USER_ECO1],
  [PCB_LAYER_ID.Eco2_User, LAYER_3D_ID.LAYER_3D_USER_ECO2],

  [PCB_LAYER_ID.User_1, LAYER_3D_ID.LAYER_3D_USER_1],
  [PCB_LAYER_ID.User_2, LAYER_3D_ID.LAYER_3D_USER_2],
  [PCB_LAYER_ID.User_3, LAYER_3D_ID.LAYER_3D_USER_3],
  [PCB_LAYER_ID.User_4, LAYER_3D_ID.LAYER_3D_USER_4],
  [PCB_LAYER_ID.User_5, LAYER_3D_ID.LAYER_3D_USER_5],
  [PCB_LAYER_ID.User_6, LAYER_3D_ID.LAYER_3D_USER_6],
  [PCB_LAYER_ID.User_7, LAYER_3D_ID.LAYER_3D_USER_7],
  [PCB_LAYER_ID.User_8, LAYER_3D_ID.LAYER_3D_USER_8],
  [PCB_LAYER_ID.User_9, LAYER_3D_ID.LAYER_3D_USER_9],
  [PCB_LAYER_ID.User_10, LAYER_3D_ID.LAYER_3D_USER_10],
  [PCB_LAYER_ID.User_11, LAYER_3D_ID.LAYER_3D_USER_11],
  [PCB_LAYER_ID.User_12, LAYER_3D_ID.LAYER_3D_USER_12],
  [PCB_LAYER_ID.User_13, LAYER_3D_ID.LAYER_3D_USER_13],
  [PCB_LAYER_ID.User_14, LAYER_3D_ID.LAYER_3D_USER_14],
  [PCB_LAYER_ID.User_15, LAYER_3D_ID.LAYER_3D_USER_15],
  [PCB_LAYER_ID.User_16, LAYER_3D_ID.LAYER_3D_USER_16],
  [PCB_LAYER_ID.User_17, LAYER_3D_ID.LAYER_3D_USER_17],
  [PCB_LAYER_ID.User_18, LAYER_3D_ID.LAYER_3D_USER_18],
  [PCB_LAYER_ID.User_19, LAYER_3D_ID.LAYER_3D_USER_19],
  [PCB_LAYER_ID.User_20, LAYER_3D_ID.LAYER_3D_USER_20],
  [PCB_LAYER_ID.User_21, LAYER_3D_ID.LAYER_3D_USER_21],
  [PCB_LAYER_ID.User_22, LAYER_3D_ID.LAYER_3D_USER_22],
  [PCB_LAYER_ID.User_23, LAYER_3D_ID.LAYER_3D_USER_23],
  [PCB_LAYER_ID.User_24, LAYER_3D_ID.LAYER_3D_USER_24],
  [PCB_LAYER_ID.User_25, LAYER_3D_ID.LAYER_3D_USER_25],
  [PCB_LAYER_ID.User_26, LAYER_3D_ID.LAYER_3D_USER_26],
  [PCB_LAYER_ID.User_27, LAYER_3D_ID.LAYER_3D_USER_27],
  [PCB_LAYER_ID.User_28, LAYER_3D_ID.LAYER_3D_USER_28],
  [PCB_LAYER_ID.User_29, LAYER_3D_ID.LAYER_3D_USER_29],
  [PCB_LAYER_ID.User_30, LAYER_3D_ID.LAYER_3D_USER_30],
  [PCB_LAYER_ID.User_31, LAYER_3D_ID.LAYER_3D_USER_31],
  [PCB_LAYER_ID.User_32, LAYER_3D_ID.LAYER_3D_USER_32],
  [PCB_LAYER_ID.User_33, LAYER_3D_ID.LAYER_3D_USER_33],
  [PCB_LAYER_ID.User_34, LAYER_3D_ID.LAYER_3D_USER_34],
  [PCB_LAYER_ID.User_35, LAYER_3D_ID.LAYER_3D_USER_35],
  [PCB_LAYER_ID.User_36, LAYER_3D_ID.LAYER_3D_USER_36],
  [PCB_LAYER_ID.User_37, LAYER_3D_ID.LAYER_3D_USER_37],
  [PCB_LAYER_ID.User_38, LAYER_3D_ID.LAYER_3D_USER_38],
  [PCB_LAYER_ID.User_39, LAYER_3D_ID.LAYER_3D_USER_39],
  [PCB_LAYER_ID.User_40, LAYER_3D_ID.LAYER_3D_USER_40],
  [PCB_LAYER_ID.User_41, LAYER_3D_ID.LAYER_3D_USER_41],
  [PCB_LAYER_ID.User_42, LAYER_3D_ID.LAYER_3D_USER_42],
  [PCB_LAYER_ID.User_43, LAYER_3D_ID.LAYER_3D_USER_43],
  [PCB_LAYER_ID.User_44, LAYER_3D_ID.LAYER_3D_USER_44],
  [PCB_LAYER_ID.User_45, LAYER_3D_ID.LAYER_3D_USER_45],
]);

const LAYER_3D_TO_PCB: ReadonlyMap<LAYER_3D_ID, PCB_LAYER_ID> = new Map(
  [...PCB_TO_3D_LAYER.entries()].map(([pcb, l3d]) => [l3d, pcb]),
);

/** The `switch` in `layer_id.cpp`, one case per pair above; anything else is `UNDEFINED_LAYER`. */
export function Map3DLayerToPCBLayer(aLayer: number): PCB_LAYER_ID {
  return LAYER_3D_TO_PCB.get(aLayer as LAYER_3D_ID) ?? PCB_LAYER_ID.UNDEFINED_LAYER;
}

export function MapPCBLayerTo3DLayer(aLayer: PCB_LAYER_ID): number {
  return PCB_TO_3D_LAYER.get(aLayer) ?? PCB_LAYER_ID.UNDEFINED_LAYER;
}

export function ToLAYER_ID(aLayer: number): PCB_LAYER_ID {
  // We use std::numeric_limits<int>::max() to represent B_Cu for the connectivity_rtree
  if (aLayer === 2147483647) return PCB_LAYER_ID.B_Cu;

  console.assert(aLayer < GAL_LAYER_ID.GAL_LAYER_ID_END);
  return aLayer as PCB_LAYER_ID;
}
