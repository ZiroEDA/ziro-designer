// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `core/typeinfo.h`: the set of class identification values stored in
 * `EDA_ITEM::m_structType`, and the type predicates over it.
 */

/**
 * The set of class identification values stored in #EDA_ITEM::m_structType
 */
export enum KICAD_T {
  NOT_USED = -1, ///< the 3d code uses this value

  TYPE_NOT_INIT = 0,
  PCB_T = 1,
  SCREEN_T = 2, ///< not really an item, used to identify a screen

  // Items in pcb
  PCB_FOOTPRINT_T = 3, ///< class FOOTPRINT, a footprint
  PCB_PAD_T = 4, ///< class PAD, a pad in a footprint
  PCB_SHAPE_T = 5, ///< class PCB_SHAPE, a segment not on copper layers
  PCB_REFERENCE_IMAGE_T = 6, ///< class PCB_REFERENCE_IMAGE, bitmap on a layer
  PCB_FIELD_T = 7, ///< class PCB_FIELD, text associated with a footprint property
  PCB_GENERATOR_T = 8, ///< class PCB_GENERATOR, generator on a layer
  PCB_TEXT_T = 9, ///< class PCB_TEXT, text on a layer
  PCB_TEXTBOX_T = 10, ///< class PCB_TEXTBOX, wrapped text on a layer
  PCB_TABLE_T = 11, ///< class PCB_TABLE, table of PCB_TABLECELLs
  PCB_TABLECELL_T = 12, ///< class PCB_TABLECELL, PCB_TEXTBOX for use in tables
  PCB_TRACE_T = 13, ///< class PCB_TRACK, a track segment (segment on a copper layer)
  PCB_VIA_T = 14, ///< class PCB_VIA, a via (like a track segment on a copper layer)
  PCB_ARC_T = 15, ///< class PCB_ARC, an arc track segment on a copper layer
  PCB_MARKER_T = 16, ///< class PCB_MARKER, a marker used to show something
  PCB_DIMENSION_T = 17, ///< class PCB_DIMENSION_BASE: abstract dimension meta-type
  PCB_BARCODE_T = 18, ///< class PCB_BARCODE, a barcode (graphic item)
  PCB_DIM_ALIGNED_T = 19, ///< class PCB_DIM_ALIGNED, a linear dimension (graphic item)
  PCB_DIM_LEADER_T = 20, ///< class PCB_DIM_LEADER, a leader dimension (graphic item)
  PCB_DIM_CENTER_T = 21, ///< class PCB_DIM_CENTER, a center point marking (graphic item)
  PCB_DIM_RADIAL_T = 22, ///< class PCB_DIM_RADIAL, a radius or diameter dimension
  PCB_DIM_ORTHOGONAL_T = 23, ///< class PCB_DIM_ORTHOGONAL, a linear dimension constrained to x/y
  PCB_TARGET_T = 24, ///< class PCB_TARGET, a target (graphic item)
  PCB_ZONE_T = 25, ///< class ZONE, a copper pour area
  PCB_ITEM_LIST_T = 26, ///< class BOARD_ITEM_LIST, a list of board items
  PCB_NETINFO_T = 27, ///< class NETINFO_ITEM, a description of a net
  PCB_GROUP_T = 28, ///< class PCB_GROUP, a set of BOARD_ITEMs
  PCB_BOARD_OUTLINE_T = 29, ///< class PCB_BOARD_OUTLINE_T, a pcb board outline item
  PCB_POINT_T = 30, ///< class PCB_POINT, a 0-dimensional point

  // Be prudent with these types:
  // they should be used only to locate a specific field type among PCB_FIELD_Ts
  // N.B. If you add a type here, be sure to add it below to the BaseType()
  PCB_FIELD_LOCATE_REFERENCE_T = 31,
  PCB_FIELD_LOCATE_VALUE_T = 32,
  PCB_FIELD_LOCATE_FOOTPRINT_T = 33,
  PCB_FIELD_LOCATE_DATASHEET_T = 34,

  // Be prudent with these types:
  // they should be used only to locate specific item sub-types
  // N.B. If you add a type here, be sure to add it below to the BaseType()
  PCB_LOCATE_STDVIA_T = 35,
  PCB_LOCATE_UVIA_T = 36,
  PCB_LOCATE_BLINDVIA_T = 37,
  PCB_LOCATE_BURIEDVIA_T = 38,
  PCB_LOCATE_TEXT_T = 39,
  PCB_LOCATE_HOLE_T = 40,
  PCB_LOCATE_PTH_T = 41,
  PCB_LOCATE_NPTH_T = 42,
  PCB_LOCATE_BOARD_EDGE_T = 43,

  // Same for locating shapes types from PCB_SHAPE_T items
  PCB_SHAPE_LOCATE_SEGMENT_T = 44,
  PCB_SHAPE_LOCATE_RECT_T = 45,
  PCB_SHAPE_LOCATE_CIRCLE_T = 46,
  PCB_SHAPE_LOCATE_ARC_T = 47,
  PCB_SHAPE_LOCATE_POLY_T = 48,
  PCB_SHAPE_LOCATE_BEZIER_T = 49,

  /*
   * Draw items in library symbol.
   *
   * The order of these items effects the sort order for items inside the
   * "DRAW/ENDDRAW" section of the symbol definition in a library file.
   * If you add a new draw item, type, please make sure you add it so the
   * sort order is logical.
   */
  LIB_SYMBOL_T = 50,
  SCH_SHAPE_T = 51,
  SCH_FIELD_T = 52,
  SCH_TEXT_T = 53,
  SCH_TEXTBOX_T = 54,
  SCH_PIN_T = 55,

  // Schematic draw Items.  The order of these items effects the sort order.
  // It is currently ordered to mimic the old Eeschema locate behavior where
  // the smallest item is the selected item.
  SCH_MARKER_T = 56,
  SCH_JUNCTION_T = 57,
  SCH_NO_CONNECT_T = 58,
  SCH_BUS_WIRE_ENTRY_T = 59,
  SCH_BUS_BUS_ENTRY_T = 60,
  SCH_LINE_T = 61,
  SCH_BITMAP_T = 62,
  SCH_TABLE_T = 63,
  SCH_TABLECELL_T = 64,
  SCH_LABEL_T = 65,
  SCH_GLOBAL_LABEL_T = 66,
  SCH_HIER_LABEL_T = 67,
  SCH_RULE_AREA_T = 68,
  SCH_DIRECTIVE_LABEL_T = 69,
  SCH_SYMBOL_T = 70,
  SCH_GROUP_T = 71,
  SCH_SHEET_PIN_T = 72,
  SCH_SHEET_T = 73,

  // Be prudent with these types:
  // they should be used only to locate a specific field type among SCH_FIELD_Ts
  // N.B. If you add a type here, be sure to add it below to the BaseType()
  SCH_FIELD_LOCATE_REFERENCE_T = 74,
  SCH_FIELD_LOCATE_VALUE_T = 75,
  SCH_FIELD_LOCATE_FOOTPRINT_T = 76,
  SCH_FIELD_LOCATE_DATASHEET_T = 77,

  // Same for picking wires, buses and graphics from SCH_ITEM_T items
  SCH_ITEM_LOCATE_WIRE_T = 78,
  SCH_ITEM_LOCATE_BUS_T = 79,
  SCH_ITEM_LOCATE_GRAPHIC_LINE_T = 80,

  // Same for picking labels, or labels attached to wires and/or buses
  SCH_LABEL_LOCATE_ANY_T = 81,
  SCH_LABEL_LOCATE_WIRE_T = 82,
  SCH_LABEL_LOCATE_BUS_T = 83,

  // Same for picking symbols which are power symbols
  SCH_SYMBOL_LOCATE_POWER_T = 84,

  // matches any type
  SCH_LOCATE_ANY_T = 85,

  // General
  SCH_SCREEN_T = 86,

  SCHEMATIC_T = 87,

  /*
   * For GerbView: item types:
   */
  GERBER_LAYOUT_T = 88,
  GERBER_DRAW_ITEM_T = 89,
  GERBER_IMAGE_T = 90,

  /*
   * For Pl_Editor: item types:
   */
  WSG_LINE_T = 91,
  WSG_RECT_T = 92,
  WSG_POLY_T = 93,
  WSG_TEXT_T = 94,
  WSG_BITMAP_T = 95,
  WSG_PAGE_T = 96,

  // serialized layout used in undo/redo commands
  WS_PROXY_UNDO_ITEM_T = 97, // serialized layout used in undo/redo commands
  WS_PROXY_UNDO_ITEM_PLUS_T = 98, // serialized layout plus page and title block settings

  /*
   * FOR PROJECT::_ELEMs
   */
  SYMBOL_LIB_TABLE_T = 99,
  FP_LIB_TABLE_T = 100,
  DESIGN_BLOCK_LIB_TABLE_T = 101,
  SYMBOL_LIBS_T = 102,
  SEARCH_STACK_T = 103,
  S3D_CACHE_T = 104,

  // End value
  MAX_STRUCT_TYPE_ID = 105,
}

/**
 * Return the underlying type of the given type.
 *
 * This is useful for finding the element type given one of the "non-type" types such as
 * SCH_ITEM_LOCATE_WIRE_T.
 *
 * @param aType Given type to resolve.
 * @return Base type.
 */
export function BaseType(aType: KICAD_T): KICAD_T {
  switch (aType) {
    case KICAD_T.SCH_FIELD_LOCATE_REFERENCE_T:
    case KICAD_T.SCH_FIELD_LOCATE_VALUE_T:
    case KICAD_T.SCH_FIELD_LOCATE_FOOTPRINT_T:
    case KICAD_T.SCH_FIELD_LOCATE_DATASHEET_T:
      return KICAD_T.SCH_FIELD_T;

    case KICAD_T.SCH_ITEM_LOCATE_WIRE_T:
    case KICAD_T.SCH_ITEM_LOCATE_BUS_T:
    case KICAD_T.SCH_ITEM_LOCATE_GRAPHIC_LINE_T:
      return KICAD_T.SCH_LINE_T;

    case KICAD_T.SCH_LABEL_LOCATE_ANY_T:
    case KICAD_T.SCH_LABEL_LOCATE_WIRE_T:
    case KICAD_T.SCH_LABEL_LOCATE_BUS_T:
      return KICAD_T.SCH_LABEL_T;

    case KICAD_T.SCH_SYMBOL_LOCATE_POWER_T:
      return KICAD_T.SCH_SYMBOL_T;

    case KICAD_T.PCB_FIELD_LOCATE_REFERENCE_T:
    case KICAD_T.PCB_FIELD_LOCATE_VALUE_T:
    case KICAD_T.PCB_FIELD_LOCATE_FOOTPRINT_T:
    case KICAD_T.PCB_FIELD_LOCATE_DATASHEET_T:
      return KICAD_T.PCB_FIELD_T;

    case KICAD_T.PCB_LOCATE_HOLE_T:
    case KICAD_T.PCB_LOCATE_PTH_T:
    case KICAD_T.PCB_LOCATE_NPTH_T:
      return KICAD_T.PCB_LOCATE_HOLE_T;

    case KICAD_T.PCB_SHAPE_LOCATE_SEGMENT_T:
    case KICAD_T.PCB_SHAPE_LOCATE_RECT_T:
    case KICAD_T.PCB_SHAPE_LOCATE_CIRCLE_T:
    case KICAD_T.PCB_SHAPE_LOCATE_ARC_T:
    case KICAD_T.PCB_SHAPE_LOCATE_POLY_T:
    case KICAD_T.PCB_SHAPE_LOCATE_BEZIER_T:
      return KICAD_T.PCB_SHAPE_T;

    case KICAD_T.PCB_DIM_ALIGNED_T:
    case KICAD_T.PCB_DIM_CENTER_T:
    case KICAD_T.PCB_DIM_RADIAL_T:
    case KICAD_T.PCB_DIM_ORTHOGONAL_T:
    case KICAD_T.PCB_DIM_LEADER_T:
      return KICAD_T.PCB_DIMENSION_T;

    default:
      return aType;
  }
}

export function IsNullType(aType: KICAD_T): boolean {
  return aType <= 0;
}

export function IsInstantiableType(aType: KICAD_T): boolean {
  if (IsNullType(aType)) return false;

  switch (aType) {
    case KICAD_T.SCH_LOCATE_ANY_T:

    case KICAD_T.SCH_FIELD_LOCATE_REFERENCE_T:
    case KICAD_T.SCH_FIELD_LOCATE_VALUE_T:
    case KICAD_T.SCH_FIELD_LOCATE_FOOTPRINT_T:
    case KICAD_T.SCH_FIELD_LOCATE_DATASHEET_T:

    case KICAD_T.SCH_ITEM_LOCATE_WIRE_T:
    case KICAD_T.SCH_ITEM_LOCATE_BUS_T:
    case KICAD_T.SCH_ITEM_LOCATE_GRAPHIC_LINE_T:

    case KICAD_T.SCH_LABEL_LOCATE_ANY_T:
    case KICAD_T.SCH_LABEL_LOCATE_WIRE_T:
    case KICAD_T.SCH_LABEL_LOCATE_BUS_T:

    case KICAD_T.SCH_SYMBOL_LOCATE_POWER_T:

    case KICAD_T.PCB_FIELD_LOCATE_REFERENCE_T:
    case KICAD_T.PCB_FIELD_LOCATE_VALUE_T:
    case KICAD_T.PCB_FIELD_LOCATE_FOOTPRINT_T:
    case KICAD_T.PCB_FIELD_LOCATE_DATASHEET_T:

    case KICAD_T.PCB_LOCATE_STDVIA_T:
    case KICAD_T.PCB_LOCATE_UVIA_T:
    case KICAD_T.PCB_LOCATE_BLINDVIA_T:
    case KICAD_T.PCB_LOCATE_BURIEDVIA_T:
    case KICAD_T.PCB_LOCATE_TEXT_T:
    case KICAD_T.PCB_LOCATE_HOLE_T:
    case KICAD_T.PCB_LOCATE_PTH_T:
    case KICAD_T.PCB_LOCATE_NPTH_T:
    case KICAD_T.PCB_LOCATE_BOARD_EDGE_T:

    case KICAD_T.PCB_SHAPE_LOCATE_SEGMENT_T:
    case KICAD_T.PCB_SHAPE_LOCATE_RECT_T:
    case KICAD_T.PCB_SHAPE_LOCATE_CIRCLE_T:
    case KICAD_T.PCB_SHAPE_LOCATE_ARC_T:
    case KICAD_T.PCB_SHAPE_LOCATE_POLY_T:
    case KICAD_T.PCB_SHAPE_LOCATE_BEZIER_T:

    case KICAD_T.PCB_DIMENSION_T:

    case KICAD_T.SCH_SCREEN_T:
    case KICAD_T.PCB_ITEM_LIST_T:
      return false;

    default:
      break;
  }

  return true;
}

export function IsEeschemaType(aType: KICAD_T): boolean {
  switch (aType) {
    case KICAD_T.SCH_MARKER_T:
    case KICAD_T.SCH_JUNCTION_T:
    case KICAD_T.SCH_NO_CONNECT_T:
    case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
    case KICAD_T.SCH_BUS_BUS_ENTRY_T:
    case KICAD_T.SCH_LINE_T:
    case KICAD_T.SCH_SHAPE_T:
    case KICAD_T.SCH_RULE_AREA_T:
    case KICAD_T.SCH_BITMAP_T:
    case KICAD_T.SCH_TEXT_T:
    case KICAD_T.SCH_TEXTBOX_T:
    case KICAD_T.SCH_TABLE_T:
    case KICAD_T.SCH_TABLECELL_T:
    case KICAD_T.SCH_LABEL_T:
    case KICAD_T.SCH_DIRECTIVE_LABEL_T:
    case KICAD_T.SCH_GLOBAL_LABEL_T:
    case KICAD_T.SCH_HIER_LABEL_T:
    case KICAD_T.SCH_FIELD_T:
    case KICAD_T.SCH_SYMBOL_T:
    case KICAD_T.SCH_SHEET_PIN_T:
    case KICAD_T.SCH_GROUP_T:
    case KICAD_T.SCH_SHEET_T:
    case KICAD_T.SCH_PIN_T:

    case KICAD_T.SCH_FIELD_LOCATE_REFERENCE_T:
    case KICAD_T.SCH_FIELD_LOCATE_VALUE_T:
    case KICAD_T.SCH_FIELD_LOCATE_FOOTPRINT_T:
    case KICAD_T.SCH_FIELD_LOCATE_DATASHEET_T:

    case KICAD_T.SCH_ITEM_LOCATE_WIRE_T:
    case KICAD_T.SCH_ITEM_LOCATE_BUS_T:
    case KICAD_T.SCH_ITEM_LOCATE_GRAPHIC_LINE_T:

    case KICAD_T.SCH_LABEL_LOCATE_ANY_T:
    case KICAD_T.SCH_LABEL_LOCATE_WIRE_T:
    case KICAD_T.SCH_LABEL_LOCATE_BUS_T:

    case KICAD_T.SCH_SYMBOL_LOCATE_POWER_T:
    case KICAD_T.SCH_LOCATE_ANY_T:

    case KICAD_T.SCH_SCREEN_T:
    case KICAD_T.SCHEMATIC_T:

    case KICAD_T.LIB_SYMBOL_T:
      return true;

    default:
      return false;
  }
}

export function IsPcbnewType(aType: KICAD_T): boolean {
  switch (aType) {
    case KICAD_T.PCB_T:

    case KICAD_T.PCB_FOOTPRINT_T:
    case KICAD_T.PCB_PAD_T:
    case KICAD_T.PCB_SHAPE_T:
    case KICAD_T.PCB_REFERENCE_IMAGE_T:
    case KICAD_T.PCB_FIELD_T:
    case KICAD_T.PCB_TEXT_T:
    case KICAD_T.PCB_TEXTBOX_T:
    case KICAD_T.PCB_BARCODE_T:
    case KICAD_T.PCB_TABLE_T:
    case KICAD_T.PCB_TABLECELL_T:
    case KICAD_T.PCB_TRACE_T:
    case KICAD_T.PCB_VIA_T:
    case KICAD_T.PCB_ARC_T:
    case KICAD_T.PCB_MARKER_T:
    case KICAD_T.PCB_DIMENSION_T:
    case KICAD_T.PCB_DIM_ALIGNED_T:
    case KICAD_T.PCB_DIM_LEADER_T:
    case KICAD_T.PCB_DIM_CENTER_T:
    case KICAD_T.PCB_DIM_RADIAL_T:
    case KICAD_T.PCB_DIM_ORTHOGONAL_T:
    case KICAD_T.PCB_TARGET_T:
    case KICAD_T.PCB_POINT_T:
    case KICAD_T.PCB_ZONE_T:
    case KICAD_T.PCB_ITEM_LIST_T:
    case KICAD_T.PCB_NETINFO_T:
    case KICAD_T.PCB_GROUP_T:
    case KICAD_T.PCB_GENERATOR_T:

    case KICAD_T.PCB_FIELD_LOCATE_REFERENCE_T:
    case KICAD_T.PCB_FIELD_LOCATE_VALUE_T:
    case KICAD_T.PCB_FIELD_LOCATE_FOOTPRINT_T:
    case KICAD_T.PCB_FIELD_LOCATE_DATASHEET_T:
    case KICAD_T.PCB_LOCATE_STDVIA_T:
    case KICAD_T.PCB_LOCATE_UVIA_T:
    case KICAD_T.PCB_LOCATE_BLINDVIA_T:
    case KICAD_T.PCB_LOCATE_BURIEDVIA_T:
    case KICAD_T.PCB_LOCATE_TEXT_T:
    case KICAD_T.PCB_LOCATE_HOLE_T:
    case KICAD_T.PCB_LOCATE_PTH_T:
    case KICAD_T.PCB_LOCATE_NPTH_T:
    case KICAD_T.PCB_LOCATE_BOARD_EDGE_T:
    case KICAD_T.PCB_SHAPE_LOCATE_SEGMENT_T:
    case KICAD_T.PCB_SHAPE_LOCATE_RECT_T:
    case KICAD_T.PCB_SHAPE_LOCATE_CIRCLE_T:
    case KICAD_T.PCB_SHAPE_LOCATE_ARC_T:
    case KICAD_T.PCB_SHAPE_LOCATE_POLY_T:
    case KICAD_T.PCB_SHAPE_LOCATE_BEZIER_T:
    case KICAD_T.PCB_BOARD_OUTLINE_T:
      return true;

    default:
      return false;
  }
}

export function IsGerbviewType(aType: KICAD_T): boolean {
  switch (aType) {
    case KICAD_T.GERBER_LAYOUT_T:
    case KICAD_T.GERBER_DRAW_ITEM_T:
    case KICAD_T.GERBER_IMAGE_T:
      return true;

    default:
      return false;
  }
}

export function IsPageLayoutEditorType(aType: KICAD_T): boolean {
  switch (aType) {
    case KICAD_T.WSG_LINE_T:
    case KICAD_T.WSG_RECT_T:
    case KICAD_T.WSG_POLY_T:
    case KICAD_T.WSG_TEXT_T:
    case KICAD_T.WSG_BITMAP_T:
    case KICAD_T.WSG_PAGE_T:

    case KICAD_T.WS_PROXY_UNDO_ITEM_T:
    case KICAD_T.WS_PROXY_UNDO_ITEM_PLUS_T:
      return true;

    default:
      return false;
  }
}
