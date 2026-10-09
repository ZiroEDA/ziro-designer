// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/altium/altium_parser_pcb.cpp` / `.h`: one record class per
 * Altium PCB stream (`Board6`, `Pads6`, `Tracks6`, …), each constructed by
 * reading its record off an `ALTIUM_BINARY_PARSER`, plus the enums those
 * records carry. Coordinates come out in KiCad units, Y down.
 */

import { ALTIUM_BINARY_PARSER } from '@ziroeda/common/io/altium/altium_binary_parser.js';
import {
  ALTIUM_PROPS_UTILS,
  type ALTIUM_PROPS,
} from '@ziroeda/common/io/altium/altium_props_utils.js';
import { THROW_IO_ERROR } from '@ziroeda/common/exceptions.js';
import { ToULong } from '@ziroeda/common/libc/stdlib.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

export { ALTIUM_BINARY_PARSER };

/** `wxLogError( … )`: to the log, which kicad-cli prints. */
export function wxLogError(aMessage: string): void {
  console.error(aMessage);
}

// tthis constant specifies an unconnected net
export const ALTIUM_NET_UNCONNECTED = 0xffff;

// this constant specifies a item which is not inside an component
export const ALTIUM_COMPONENT_NONE = 0xffff;

// this constant specifies a item which does not define a polygon
export const ALTIUM_POLYGON_NONE = 0xffff;

// 65534 seems to be belonging to board outline
export const ALTIUM_POLYGON_BOARD = 0xffff - 1;

export enum ALTIUM_UNIT {
  UNKNOWN = 0,

  INCH = 1,
  MILS = 2,
  MM = 3,
  CM = 4,
}

export enum ALTIUM_CLASS_KIND {
  UNKNOWN = -1,

  NET_CLASS = 0,
  SOURCE_SCHEMATIC_CLASS = 1,
  FROM_TO = 2,
  PAD_CLASS = 3,
  LAYER_CLASS = 4,
  UNKNOWN_CLASS = 5,
  DIFF_PAIR_CLASS = 6,
  POLYGON_CLASS = 7,
}

export enum ALTIUM_DIMENSION_KIND {
  UNKNOWN = 0,

  LINEAR = 1,
  ANGULAR = 2,
  RADIAL = 3,
  LEADER = 4,
  DATUM = 5,
  BASELINE = 6,
  CENTER = 7,
  UNKNOWN_2 = 8,
  LINEAR_DIAMETER = 9,
  RADIAL_DIAMETER = 10,
}

export enum ALTIUM_REGION_KIND {
  UNKNOWN = -1,

  COPPER = 0, // KIND=0
  POLYGON_CUTOUT = 1, // KIND=1
  DASHED_OUTLINE = 2, // KIND=2
  UNKNOWN_3 = 3, // KIND=3
  CAVITY_DEFINITION = 4, // KIND=4
  BOARD_CUTOUT = 5, // KIND=0 AND ISBOARDCUTOUT=TRUE
}

export enum ALTIUM_RULE_KIND {
  UNKNOWN = 0,

  CLEARANCE = 1,
  DIFF_PAIR_ROUTINGS = 2,
  HEIGHT = 3,
  HOLE_SIZE = 4,
  HOLE_TO_HOLE_CLEARANCE = 5,
  WIDTH = 6,
  PASTE_MASK_EXPANSION = 7,
  SOLDER_MASK_EXPANSION = 8,
  PLANE_CLEARANCE = 9,
  POLYGON_CONNECT = 10,
  ROUTING_VIAS = 11,
}

export enum ALTIUM_CONNECT_STYLE {
  UNKNOWN = 0,
  DIRECT = 1,
  RELIEF = 2,
  NONE = 3,
}

export enum ALTIUM_RECORD {
  UNKNOWN = -1,

  ARC = 1,
  PAD = 2,
  VIA = 3,
  TRACK = 4,
  TEXT = 5,
  FILL = 6,
  REGION = 11,
  MODEL = 12,
}

export enum ALTIUM_PAD_SHAPE {
  UNKNOWN = 0,
  CIRCLE = 1,
  RECT = 2,
  OCTAGONAL = 3,
}

export enum ALTIUM_PAD_SHAPE_ALT {
  UNKNOWN = 0,
  CIRCLE = 1,
  RECT = 2, // TODO: valid?
  OCTAGONAL = 3, // TODO: valid?
  ROUNDRECT = 9,
}

export enum ALTIUM_PAD_HOLE_SHAPE {
  UNKNOWN = -1,
  ROUND = 0,
  SQUARE = 1,
  SLOT = 2,
}

export enum ALTIUM_PAD_MODE {
  SIMPLE = 0,
  TOP_MIDDLE_BOTTOM = 1,
  FULL_STACK = 2,
}

export enum ALTIUM_MODE {
  UNKNOWN = -1,
  NONE = 0, // TODO: correct ID?
  RULE = 1,
  MANUAL = 2,
}

export enum ALTIUM_POLYGON_HATCHSTYLE {
  UNKNOWN = 0,

  SOLID = 1,
  DEGREE_45 = 2,
  DEGREE_90 = 3,
  HORIZONTAL = 4,
  VERTICAL = 5,
  NONE = 6,
}

export enum ALTIUM_TEXT_POSITION {
  MANUAL = 0, // only relevant for NAMEAUTOPOSITION and COMMENTAUTOPOSITION
  LEFT_TOP = 1,
  LEFT_CENTER = 2,
  LEFT_BOTTOM = 3,
  CENTER_TOP = 4,
  CENTER_CENTER = 5,
  CENTER_BOTTOM = 6,
  RIGHT_TOP = 7,
  RIGHT_CENTER = 8,
  RIGHT_BOTTOM = 9,
}

export enum ALTIUM_TEXT_TYPE {
  UNKNOWN = -1,

  STROKE = 0,
  TRUETYPE = 1,
  BARCODE = 2,
}

export enum ALTIUM_BARCODE_TYPE {
  CODE39 = 0,
  CODE128 = 1,
}

export class ALTIUM_VERTICE {
  readonly isRound: boolean;
  readonly radius: number;
  readonly startangle: number;
  readonly endangle: number;
  readonly position: VECTOR2I;
  readonly center: VECTOR2I;

  constructor(aPosition: VECTOR2I);
  constructor(
    aIsRound: boolean,
    aRadius: number,
    aStartAngle: number,
    aEndAngle: number,
    aPosition: VECTOR2I,
    aCenter: VECTOR2I,
  );
  constructor(
    a: VECTOR2I | boolean,
    aRadius = 0,
    aStartAngle = 0,
    aEndAngle = 0,
    aPosition?: VECTOR2I,
    aCenter?: VECTOR2I,
  ) {
    if (typeof a === 'boolean') {
      this.isRound = a;
      this.radius = aRadius | 0;
      this.startangle = aStartAngle;
      this.endangle = aEndAngle;
      this.position = aPosition!;
      this.center = aCenter!;
    } else {
      this.isRound = false;
      this.radius = 0;
      this.startangle = 0;
      this.endangle = 0;
      this.position = a;
      this.center = { x: 0, y: 0 };
    }
  }
}

/** `enum class ALTIUM_LAYER : uint32_t`. */
export enum ALTIUM_LAYER {
  UNKNOWN = 0,

  TOP_LAYER = 1,
  MID_LAYER_1 = 2,
  MID_LAYER_2 = 3,
  MID_LAYER_3 = 4,
  MID_LAYER_4 = 5,
  MID_LAYER_5 = 6,
  MID_LAYER_6 = 7,
  MID_LAYER_7 = 8,
  MID_LAYER_8 = 9,
  MID_LAYER_9 = 10,
  MID_LAYER_10 = 11,
  MID_LAYER_11 = 12,
  MID_LAYER_12 = 13,
  MID_LAYER_13 = 14,
  MID_LAYER_14 = 15,
  MID_LAYER_15 = 16,
  MID_LAYER_16 = 17,
  MID_LAYER_17 = 18,
  MID_LAYER_18 = 19,
  MID_LAYER_19 = 20,
  MID_LAYER_20 = 21,
  MID_LAYER_21 = 22,
  MID_LAYER_22 = 23,
  MID_LAYER_23 = 24,
  MID_LAYER_24 = 25,
  MID_LAYER_25 = 26,
  MID_LAYER_26 = 27,
  MID_LAYER_27 = 28,
  MID_LAYER_28 = 29,
  MID_LAYER_29 = 30,
  MID_LAYER_30 = 31,
  BOTTOM_LAYER = 32,

  TOP_OVERLAY = 33,
  BOTTOM_OVERLAY = 34,
  TOP_PASTE = 35,
  BOTTOM_PASTE = 36,
  TOP_SOLDER = 37,
  BOTTOM_SOLDER = 38,

  INTERNAL_PLANE_1 = 39,
  INTERNAL_PLANE_2 = 40,
  INTERNAL_PLANE_3 = 41,
  INTERNAL_PLANE_4 = 42,
  INTERNAL_PLANE_5 = 43,
  INTERNAL_PLANE_6 = 44,
  INTERNAL_PLANE_7 = 45,
  INTERNAL_PLANE_8 = 46,
  INTERNAL_PLANE_9 = 47,
  INTERNAL_PLANE_10 = 48,
  INTERNAL_PLANE_11 = 49,
  INTERNAL_PLANE_12 = 50,
  INTERNAL_PLANE_13 = 51,
  INTERNAL_PLANE_14 = 52,
  INTERNAL_PLANE_15 = 53,
  INTERNAL_PLANE_16 = 54,

  DRILL_GUIDE = 55,
  KEEP_OUT_LAYER = 56,

  MECHANICAL_1 = 57,
  MECHANICAL_2 = 58,
  MECHANICAL_3 = 59,
  MECHANICAL_4 = 60,
  MECHANICAL_5 = 61,
  MECHANICAL_6 = 62,
  MECHANICAL_7 = 63,
  MECHANICAL_8 = 64,
  MECHANICAL_9 = 65,
  MECHANICAL_10 = 66,
  MECHANICAL_11 = 67,
  MECHANICAL_12 = 68,
  MECHANICAL_13 = 69,
  MECHANICAL_14 = 70,
  MECHANICAL_15 = 71,
  MECHANICAL_16 = 72,

  DRILL_DRAWING = 73,
  MULTI_LAYER = 74,
  CONNECTIONS = 75,
  BACKGROUND = 76,
  DRC_ERROR_MARKERS = 77,
  SELECTIONS = 78,
  VISIBLE_GRID_1 = 79,
  VISIBLE_GRID_2 = 80,
  PAD_HOLES = 81,
  VIA_HOLES = 82,

  // V7 format layers
  V7_START = 0x01000000,

  V7_COPPER_BASE = 0x01000000,
  V7_TOP_LAYER = 0x01000000 + 1,
  V7_BOTTOM_LAYER = 0x01000000 + 65535,

  V7_MECHANICAL_BASE = 0x01020000,
  V7_MECHANICAL_1 = 0x01020000 + 1,
  V7_MECHANICAL_17 = 0x01020000 + 17,
  V7_MECHANICAL_LAST = 0x01020000 + 65535,

  // V8 format layers
  V8_OTHER_BASE = 0x01030000,
  V8_TOP_OVERLAY = 0x01030000 + 6,
  V8_BOTTOM_OVERLAY = 0x01030000 + 7,
  V8_TOP_PASTE = 0x01030000 + 8,
  V8_BOTTOM_PASTE = 0x01030000 + 9,
  V8_TOP_SOLDER = 0x01030000 + 10,
  V8_BOTTOM_SOLDER = 0x01030000 + 11,
  V8_DRILL_GUIDE = 0x01030000 + 12,
  V8_KEEP_OUT_LAYER = 0x01030000 + 13,
  V8_DRILL_DRAWING = 0x01030000 + 14,
  V8_MULTI_LAYER = 0x01030000 + 15,
  V8_CONNECTIONS = 0x01030000 + 16,
  V8_BACKGROUND = 0x01030000 + 17,
  V8_DRC_ERROR_MARKERS = 0x01030000 + 18,
  V8_SELECTIONS = 0x01030000 + 19,
  V8_VISIBLE_GRID_1 = 0x01030000 + 20,
  V8_VISIBLE_GRID_2 = 0x01030000 + 21,
  V8_PAD_HOLES = 0x01030000 + 22,
  V8_VIA_HOLES = 0x01030000 + 23,
  V8_TOP_PAD_MASTER = 0x01030000 + 24,
  V8_BOTTOM_PAD_MASTER = 0x01030000 + 25,
  V8_DRC_DETAIL_MARKERS = 0x01030000 + 26,
}

// Specifies values from LayerKindMapping
export enum ALTIUM_MECHKIND {
  UNKNOWN = 0,

  ASSEMBLY_TOP = 0x01,
  ASSEMBLY_BOT = 0x02,

  ASSEMBLY_NOTES = 0x03,
  BOARD = 0x04,

  COATING_TOP = 0x05,
  COATING_BOT = 0x06,

  COMPONENT_CENTER_TOP = 0x07,
  COMPONENT_CENTER_BOT = 0x08,

  COMPONENT_OUTLINE_TOP = 0x09,
  COMPONENT_OUTLINE_BOT = 0x0a,

  COURTYARD_TOP = 0x0b,
  COURTYARD_BOT = 0x0c,

  DESIGNATOR_TOP = 0x0d,
  DESIGNATOR_BOT = 0x0e,

  DIMENSIONS = 0x0f,
  DIMENSIONS_TOP = 0x10,
  DIMENSIONS_BOT = 0x11,

  FAB_NOTES = 0x12,

  GLUE_POINTS_TOP = 0x13,
  GLUE_POINTS_BOT = 0x14,

  GOLD_PLATING_TOP = 0x15,
  GOLD_PLATING_BOT = 0x16,

  VALUE_TOP = 0x17,
  VALUE_BOT = 0x18,

  V_CUT = 0x19,

  BODY_3D_TOP = 0x1a,
  BODY_3D_BOT = 0x1b,

  ROUTE_TOOL_PATH = 0x1c,
  SHEET = 0x1d,
  BOARD_SHAPE = 0x1e,
}

export enum AEXTENDED_PRIMITIVE_INFORMATION_TYPE {
  UNKNOWN = -1,

  MASK = 0,
}

/*
 * Returns an Altium layer id from V6 and V7 file format data, compatible with the rest of the parser.
 */
export function altium_versioned_layer(
  aV6Layer: ALTIUM_LAYER,
  aV7Layer: ALTIUM_LAYER,
): ALTIUM_LAYER {
  if (aV7Layer >= ALTIUM_LAYER.V7_MECHANICAL_17 && aV7Layer <= ALTIUM_LAYER.V7_MECHANICAL_LAST)
    return aV7Layer;

  return aV6Layer;
}

/**
 * Return true if an Altium rule scope expression targets polygon pour primitives
 * (matches InPolygon, InPoly, IsPolygon, or IsPoly).
 */
export function altiumScopeExprMatchesPolygon(aExpr: string): boolean {
  // INPOLY/ISPOLY are prefixes of INPOLYGON/ISPOLYGON, so two checks cover all four tokens.
  const upper = aExpr.toUpperCase();
  return upper.includes('INPOLY') || upper.includes('ISPOLY');
}

/**
 * Select the highest Altium-priority rule whose scope references polygons.
 *
 * Altium priority 1 is the most specific; larger numeric values are more general.
 * @p aRulesByPriorityAsc must be sorted by ARULE6::priority in ascending numeric
 * order so the first polygon-scoped match is also the highest Altium priority.
 *
 * Returns nullptr if no rule references polygons.
 */
export function selectAltiumPolygonRule(aRulesByPriorityAsc: readonly ARULE6[]): ARULE6 | null {
  for (const rule of aRulesByPriorityAsc) {
    if (
      altiumScopeExprMatchesPolygon(rule.scope1expr) ||
      altiumScopeExprMatchesPolygon(rule.scope2expr)
    ) {
      return rule;
    }
  }

  return null;
}

/**
 * Decide whether one side of an Altium via should be tented when imported into KiCad.
 *
 * Returns the explicit Altium tent flag, except when the via uses a manual solder mask expansion
 * measured from the hole edge.  KiCad vias cannot represent a hole-referenced opening, so when the
 * resulting opening (hole + 2 * expansion) does not clear the via land the pad copper is covered
 * and the side is treated as tented.
 */
export function altiumViaSideIsTented(
  aTentFlag: boolean,
  aManual: boolean,
  aFromHole: boolean,
  aHoleSize: number,
  aMaskExpansion: number,
  aLandDiameter: number,
): boolean {
  if (aTentFlag) return true;

  if (aManual && aFromHole) {
    const opening = (aHoleSize >>> 0) + 2 * aMaskExpansion;

    return opening <= aLandDiameter;
  }

  return false;
}

const LAYER_FROM_NAME = new Map<string, ALTIUM_LAYER>([
  ['TOP', ALTIUM_LAYER.TOP_LAYER],
  ['MID1', ALTIUM_LAYER.MID_LAYER_1],
  ['MID2', ALTIUM_LAYER.MID_LAYER_2],
  ['MID3', ALTIUM_LAYER.MID_LAYER_3],
  ['MID4', ALTIUM_LAYER.MID_LAYER_4],
  ['MID5', ALTIUM_LAYER.MID_LAYER_5],
  ['MID6', ALTIUM_LAYER.MID_LAYER_6],
  ['MID7', ALTIUM_LAYER.MID_LAYER_7],
  ['MID8', ALTIUM_LAYER.MID_LAYER_8],
  ['MID9', ALTIUM_LAYER.MID_LAYER_9],
  ['MID10', ALTIUM_LAYER.MID_LAYER_10],
  ['MID11', ALTIUM_LAYER.MID_LAYER_11],
  ['MID12', ALTIUM_LAYER.MID_LAYER_12],
  ['MID13', ALTIUM_LAYER.MID_LAYER_13],
  ['MID14', ALTIUM_LAYER.MID_LAYER_14],
  ['MID15', ALTIUM_LAYER.MID_LAYER_15],
  ['MID16', ALTIUM_LAYER.MID_LAYER_16],
  ['MID17', ALTIUM_LAYER.MID_LAYER_17],
  ['MID18', ALTIUM_LAYER.MID_LAYER_18],
  ['MID19', ALTIUM_LAYER.MID_LAYER_19],
  ['MID20', ALTIUM_LAYER.MID_LAYER_20],
  ['MID21', ALTIUM_LAYER.MID_LAYER_21],
  ['MID22', ALTIUM_LAYER.MID_LAYER_22],
  ['MID23', ALTIUM_LAYER.MID_LAYER_23],
  ['MID24', ALTIUM_LAYER.MID_LAYER_24],
  ['MID25', ALTIUM_LAYER.MID_LAYER_25],
  ['MID26', ALTIUM_LAYER.MID_LAYER_26],
  ['MID27', ALTIUM_LAYER.MID_LAYER_27],
  ['MID28', ALTIUM_LAYER.MID_LAYER_28],
  ['MID29', ALTIUM_LAYER.MID_LAYER_29],
  ['MID30', ALTIUM_LAYER.MID_LAYER_30],
  ['BOTTOM', ALTIUM_LAYER.BOTTOM_LAYER],

  ['TOPOVERLAY', ALTIUM_LAYER.TOP_OVERLAY],
  ['BOTTOMOVERLAY', ALTIUM_LAYER.BOTTOM_OVERLAY],
  ['TOPPASTE', ALTIUM_LAYER.TOP_PASTE],
  ['BOTTOMPASTE', ALTIUM_LAYER.BOTTOM_PASTE],
  ['TOPSOLDER', ALTIUM_LAYER.TOP_SOLDER],
  ['BOTTOMSOLDER', ALTIUM_LAYER.BOTTOM_SOLDER],

  ['PLANE1', ALTIUM_LAYER.INTERNAL_PLANE_1],
  ['PLANE2', ALTIUM_LAYER.INTERNAL_PLANE_2],
  ['PLANE3', ALTIUM_LAYER.INTERNAL_PLANE_3],
  ['PLANE4', ALTIUM_LAYER.INTERNAL_PLANE_4],
  ['PLANE5', ALTIUM_LAYER.INTERNAL_PLANE_5],
  ['PLANE6', ALTIUM_LAYER.INTERNAL_PLANE_6],
  ['PLANE7', ALTIUM_LAYER.INTERNAL_PLANE_7],
  ['PLANE8', ALTIUM_LAYER.INTERNAL_PLANE_8],
  ['PLANE9', ALTIUM_LAYER.INTERNAL_PLANE_9],
  ['PLANE10', ALTIUM_LAYER.INTERNAL_PLANE_10],
  ['PLANE11', ALTIUM_LAYER.INTERNAL_PLANE_11],
  ['PLANE12', ALTIUM_LAYER.INTERNAL_PLANE_12],
  ['PLANE13', ALTIUM_LAYER.INTERNAL_PLANE_13],
  ['PLANE14', ALTIUM_LAYER.INTERNAL_PLANE_14],
  ['PLANE15', ALTIUM_LAYER.INTERNAL_PLANE_15],
  ['PLANE16', ALTIUM_LAYER.INTERNAL_PLANE_16],

  ['DRILLGUIDE', ALTIUM_LAYER.DRILL_GUIDE],
  ['KEEPOUT', ALTIUM_LAYER.KEEP_OUT_LAYER],

  ['MECHANICAL1', ALTIUM_LAYER.MECHANICAL_1],
  ['MECHANICAL2', ALTIUM_LAYER.MECHANICAL_2],
  ['MECHANICAL3', ALTIUM_LAYER.MECHANICAL_3],
  ['MECHANICAL4', ALTIUM_LAYER.MECHANICAL_4],
  ['MECHANICAL5', ALTIUM_LAYER.MECHANICAL_5],
  ['MECHANICAL6', ALTIUM_LAYER.MECHANICAL_6],
  ['MECHANICAL7', ALTIUM_LAYER.MECHANICAL_7],
  ['MECHANICAL8', ALTIUM_LAYER.MECHANICAL_8],
  ['MECHANICAL9', ALTIUM_LAYER.MECHANICAL_9],
  ['MECHANICAL10', ALTIUM_LAYER.MECHANICAL_10],
  ['MECHANICAL11', ALTIUM_LAYER.MECHANICAL_11],
  ['MECHANICAL12', ALTIUM_LAYER.MECHANICAL_12],
  ['MECHANICAL13', ALTIUM_LAYER.MECHANICAL_13],
  ['MECHANICAL14', ALTIUM_LAYER.MECHANICAL_14],
  ['MECHANICAL15', ALTIUM_LAYER.MECHANICAL_15],
  ['MECHANICAL16', ALTIUM_LAYER.MECHANICAL_16],

  ['DRILLDRAWING', ALTIUM_LAYER.DRILL_DRAWING],
  ['MULTILAYER', ALTIUM_LAYER.MULTI_LAYER],

  // FIXME: the following mapping is just a guess
  ['CONNECTIONS', ALTIUM_LAYER.CONNECTIONS],
  ['BACKGROUND', ALTIUM_LAYER.BACKGROUND],
  ['DRCERRORMARKERS', ALTIUM_LAYER.DRC_ERROR_MARKERS],
  ['SELECTIONS', ALTIUM_LAYER.SELECTIONS],
  ['VISIBLEGRID1', ALTIUM_LAYER.VISIBLE_GRID_1],
  ['VISIBLEGRID2', ALTIUM_LAYER.VISIBLE_GRID_2],
  ['PADHOLES', ALTIUM_LAYER.PAD_HOLES],
  ['VIAHOLES', ALTIUM_LAYER.VIA_HOLES],
]);

/*
 * Returns V7 layer ids for Mechanical 17 and above. Otherwise, V6 layer ids.
 */
export function altium_layer_from_name(aName: string): ALTIUM_LAYER {
  if (aName === '') return ALTIUM_LAYER.UNKNOWN;

  const it = LAYER_FROM_NAME.get(aName);

  if (it !== undefined) return it;

  // Try V7 format mechanical layers
  const mechanicalStr = 'MECHANICAL';

  if (aName.startsWith(mechanicalStr)) {
    const val = ToULong(aName.substring(mechanicalStr.length));

    if (val.ok) return ALTIUM_LAYER.V7_MECHANICAL_BASE + val.value;
  }

  wxLogError(`Unknown mapping of the Altium layer '${aName}'.`);
  return ALTIUM_LAYER.UNKNOWN;
}

const MECHKIND_FROM_NAME = new Map<string, ALTIUM_MECHKIND>([
  ['AssemblyTop', ALTIUM_MECHKIND.ASSEMBLY_TOP],
  ['AssemblyBottom', ALTIUM_MECHKIND.ASSEMBLY_BOT],

  ['AssemblyNotes', ALTIUM_MECHKIND.ASSEMBLY_NOTES],
  ['Board', ALTIUM_MECHKIND.BOARD],

  ['CoatingTop', ALTIUM_MECHKIND.COATING_TOP],
  ['CoatingBottom', ALTIUM_MECHKIND.COATING_BOT],

  ['ComponentCenterTop', ALTIUM_MECHKIND.COMPONENT_CENTER_TOP],
  ['ComponentCenterBottom', ALTIUM_MECHKIND.COMPONENT_CENTER_BOT],

  ['ComponentOutlineTop', ALTIUM_MECHKIND.COMPONENT_OUTLINE_TOP],
  ['ComponentOutlineBottom', ALTIUM_MECHKIND.COMPONENT_OUTLINE_BOT],

  ['CourtyardTop', ALTIUM_MECHKIND.COURTYARD_TOP],
  ['CourtyardBottom', ALTIUM_MECHKIND.COURTYARD_BOT],

  ['DesignatorTop', ALTIUM_MECHKIND.DESIGNATOR_TOP],
  ['DesignatorBottom', ALTIUM_MECHKIND.DESIGNATOR_BOT],

  ['Dimensions', ALTIUM_MECHKIND.DIMENSIONS],
  ['DimensionsTop', ALTIUM_MECHKIND.DIMENSIONS_TOP],
  ['DimensionsBottom', ALTIUM_MECHKIND.DIMENSIONS_BOT],

  ['FabNotes', ALTIUM_MECHKIND.FAB_NOTES],

  ['GluePointsTop', ALTIUM_MECHKIND.GLUE_POINTS_TOP],
  ['GluePointsBottom', ALTIUM_MECHKIND.GLUE_POINTS_BOT],

  ['GoldPlatingTop', ALTIUM_MECHKIND.GOLD_PLATING_TOP],
  ['GoldPlatingBottom', ALTIUM_MECHKIND.GOLD_PLATING_BOT],

  ['ValueTop', ALTIUM_MECHKIND.VALUE_TOP],
  ['ValueBottom', ALTIUM_MECHKIND.VALUE_BOT],

  ['VCut', ALTIUM_MECHKIND.V_CUT],

  ['3DBodyTop', ALTIUM_MECHKIND.BODY_3D_TOP],
  ['3DBodyBottom', ALTIUM_MECHKIND.BODY_3D_BOT],

  ['RouteToolPath', ALTIUM_MECHKIND.ROUTE_TOOL_PATH],
  ['Sheet', ALTIUM_MECHKIND.SHEET],
  ['BoardShape', ALTIUM_MECHKIND.BOARD_SHAPE],
]);

export function altium_mechkind_from_name(aName: string): ALTIUM_MECHKIND {
  const it = MECHKIND_FROM_NAME.get(aName);

  if (it !== undefined) {
    return it;
  } else {
    wxLogError(`Unknown mapping of the Altium layer kind '${aName}'.`);
    return ALTIUM_MECHKIND.UNKNOWN;
  }
}

export function altium_parse_polygons(aProps: ALTIUM_PROPS, aVertices: ALTIUM_VERTICE[]): void {
  for (let i = 0; ; i++) {
    const si = String(i);

    const vxi = `VX${si}`;
    const vyi = `VY${si}`;

    if (!aProps.has(vxi) || !aProps.has(vyi)) break; // it doesn't seem like we know beforehand how many vertices are inside a polygon

    const isRound = ALTIUM_PROPS_UTILS.ReadInt(aProps, `KIND${si}`, 0) !== 0;
    const radius = ALTIUM_PROPS_UTILS.ReadKicadUnit(aProps, `R${si}`, '0mil');
    const sa = ALTIUM_PROPS_UTILS.ReadDouble(aProps, `SA${si}`, 0);
    const ea = ALTIUM_PROPS_UTILS.ReadDouble(aProps, `EA${si}`, 0);
    const vp = {
      x: ALTIUM_PROPS_UTILS.ReadKicadUnit(aProps, vxi, '0mil'),
      y: -ALTIUM_PROPS_UTILS.ReadKicadUnit(aProps, vyi, '0mil') + 0,
    };
    const cp = {
      x: ALTIUM_PROPS_UTILS.ReadKicadUnit(aProps, `CX${si}`, '0mil'),
      y: -ALTIUM_PROPS_UTILS.ReadKicadUnit(aProps, `CY${si}`, '0mil') + 0,
    };

    aVertices.push(new ALTIUM_VERTICE(isRound, radius, sa, ea, vp, cp));
  }
}

function ReadAltiumModeFromProperties(aProps: ALTIUM_PROPS, aKey: string): ALTIUM_MODE {
  const mode = ALTIUM_PROPS_UTILS.ReadString(aProps, aKey, '');

  if (mode === 'None') return ALTIUM_MODE.NONE;
  else if (mode === 'Rule') return ALTIUM_MODE.RULE;
  else if (mode === 'Manual') return ALTIUM_MODE.MANUAL;

  wxLogError(`Unknown Mode string: '${mode}'.`);
  return ALTIUM_MODE.UNKNOWN;
}

function ReadAltiumRecordFromProperties(aProps: ALTIUM_PROPS, aKey: string): ALTIUM_RECORD {
  const record = ALTIUM_PROPS_UTILS.ReadString(aProps, aKey, '');

  if (record === 'Arc') return ALTIUM_RECORD.ARC;
  else if (record === 'Pad') return ALTIUM_RECORD.PAD;
  else if (record === 'Via') return ALTIUM_RECORD.VIA;
  else if (record === 'Track') return ALTIUM_RECORD.TRACK;
  else if (record === 'Text') return ALTIUM_RECORD.TEXT;
  else if (record === 'Fill') return ALTIUM_RECORD.FILL;
  else if (record === 'Region')
    // correct?
    return ALTIUM_RECORD.REGION;
  else if (record === 'Model') return ALTIUM_RECORD.MODEL;

  wxLogError(`Unknown Record name string: '${record}'.`);
  return ALTIUM_RECORD.UNKNOWN;
}

function ReadAltiumExtendedPrimitiveInformationTypeFromProperties(
  aProps: ALTIUM_PROPS,
  aKey: string,
): AEXTENDED_PRIMITIVE_INFORMATION_TYPE {
  const parsedType = ALTIUM_PROPS_UTILS.ReadString(aProps, aKey, '');

  if (parsedType === 'Mask') return AEXTENDED_PRIMITIVE_INFORMATION_TYPE.MASK;

  wxLogError(`Unknown Extended Primitive Information type: '${parsedType}'.`);
  return AEXTENDED_PRIMITIVE_INFORMATION_TYPE.UNKNOWN;
}

/**
 *  Throw an IO_ERROR if the actual length is less than the expected length.
 *
 * @param aStreamType the current stream type (e.g. 'Pads6')
 * @param aSubrecordName the current subrecord name (e.g. 'subrecord5')
 * @param aExpectedLength the expected length needed to parse the stream
 * @param aActualLength the actual length of the subrecord encountered
 */
function ExpectSubrecordLengthAtLeast(
  aStreamType: string,
  aSubrecordName: string,
  aExpectedLength: number,
  aActualLength: number,
): void {
  if (aActualLength < aExpectedLength) {
    THROW_IO_ERROR(
      `${aStreamType} stream ${aSubrecordName} has length ${aActualLength}, which is unexpected (expected at least ${aExpectedLength})`,
    );
  }
}

/** `uint16_t`, `uint8_t` narrowing of `int` results. */
const u16 = (v: number): number => v & 0xffff;
const u8 = (v: number): number => v & 0xff;

export class AEXTENDED_PRIMITIVE_INFORMATION {
  primitiveIndex: number;
  primitiveObjectId: ALTIUM_RECORD;

  type: AEXTENDED_PRIMITIVE_INFORMATION_TYPE;

  // Type == Mask
  pastemaskexpansionmode: ALTIUM_MODE;
  pastemaskexpansionmanual: number;
  soldermaskexpansionmode: ALTIUM_MODE;
  soldermaskexpansionmanual: number;

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    const props = aReader.ReadProperties();

    if (props.size === 0) THROW_IO_ERROR('ExtendedPrimitiveInformation stream has no properties!');

    this.primitiveIndex = ALTIUM_PROPS_UTILS.ReadInt(props, 'PRIMITIVEINDEX', -1);
    this.primitiveObjectId = ReadAltiumRecordFromProperties(props, 'PRIMITIVEOBJECTID');
    this.type = ReadAltiumExtendedPrimitiveInformationTypeFromProperties(props, 'TYPE');

    this.pastemaskexpansionmode = ReadAltiumModeFromProperties(props, 'PASTEMASKEXPANSIONMODE');
    this.pastemaskexpansionmanual = ALTIUM_PROPS_UTILS.ReadKicadUnit(
      props,
      'PASTEMASKEXPANSION_MANUAL',
      '0mil',
    );
    this.soldermaskexpansionmode = ReadAltiumModeFromProperties(props, 'SOLDERMASKEXPANSIONMODE');
    this.soldermaskexpansionmanual = ALTIUM_PROPS_UTILS.ReadKicadUnit(
      props,
      'SOLDERMASKEXPANSION_MANUAL',
      '0mil',
    );
  }
}

export class ABOARD6_LAYER_STACKUP {
  layerId = 0;
  name: string;

  nextId: number;
  prevId: number;

  copperthick: number;

  dielectricconst: number;
  dielectricthick: number;
  dielectricmaterial: string;
  dielectriclosstangent = 0;

  mechenabled = false;
  mechkind: ALTIUM_MECHKIND = ALTIUM_MECHKIND.UNKNOWN;

  constructor(aProps: ALTIUM_PROPS, aPrefix: string, aLayerIdFallback: number) {
    // LAYERID is specific to V7 format
    this.layerId =
      ALTIUM_PROPS_UTILS.ReadInt(aProps, `${aPrefix}LAYERID`, aLayerIdFallback | 0) >>> 0;

    this.name = ALTIUM_PROPS_UTILS.ReadString(aProps, `${aPrefix}NAME`, '');
    // size_t from an int: a negative wraps to a huge id, which the stackup walk never reaches
    this.nextId = ALTIUM_PROPS_UTILS.ReadInt(aProps, `${aPrefix}NEXT`, 0);
    this.prevId = ALTIUM_PROPS_UTILS.ReadInt(aProps, `${aPrefix}PREV`, 0);
    if (this.nextId < 0) this.nextId += 2 ** 64;
    if (this.prevId < 0) this.prevId += 2 ** 64;
    this.copperthick = ALTIUM_PROPS_UTILS.ReadKicadUnit(aProps, `${aPrefix}COPTHICK`, '1.4mil');

    this.dielectricconst = ALTIUM_PROPS_UTILS.ReadDouble(aProps, `${aPrefix}DIELCONST`, 0);
    this.dielectricthick = ALTIUM_PROPS_UTILS.ReadKicadUnit(
      aProps,
      `${aPrefix}DIELHEIGHT`,
      '60mil',
    );
    this.dielectricmaterial = ALTIUM_PROPS_UTILS.ReadString(
      aProps,
      `${aPrefix}DIELMATERIAL`,
      'FR-4',
    );

    // TODO: In some component libraries MECHENABLED may be FALSE but the layers show up as used.
    // (we should check if any objects exists on these layers?)
    const mechEnabled = ALTIUM_PROPS_UTILS.ReadString(aProps, `${aPrefix}MECHENABLED`, '');

    this.mechenabled = !mechEnabled.includes('FALSE');

    if (this.mechenabled) {
      const mechKind = ALTIUM_PROPS_UTILS.ReadString(aProps, `${aPrefix}MECHKIND`, '');

      if (mechKind !== '') this.mechkind = altium_mechkind_from_name(mechKind);
    }
  }
}

/** `wxString::Format( wxT( "%s|%d|%d" ), aMaterial, aHeight, (int) std::lround( aConst * 1000.0 ) )`. */
function MakeAltiumDielectricKey(aMaterial: string, aHeight: number, aConst: number): string {
  const v = aConst * 1000.0;
  // std::lround: halves away from zero
  const r = v < 0 ? -Math.round(-v) : Math.round(v);
  return `${aMaterial}|${aHeight}|${r | 0}`;
}

// Build a lookup from the modern physical stackup keys (LAYER_V8_<n> / V9_STACK_LAYER<n>) so we
// can recover dielectric properties that the legacy LAYER<n> keys do not carry. Currently only the
// loss tangent is missing from the legacy records, so we key the lookup on the dielectric material,
// height and permittivity that both formats share. If two distinct dielectrics share the same key
// but report different loss tangents the mapping is ambiguous, so we flag it and skip the backfill
// for that key rather than guess.
function ReadAltiumDielectricLossTangents(aProps: ALTIUM_PROPS): Map<string, number> {
  const tangents = new Map<string, number>();
  const ambiguous = new Set<string>();

  const scan = (aFamily: string): void => {
    for (let i = 0; ; i++) {
      const prefix = aFamily + String(i);

      if (!aProps.has(`${prefix}NAME`)) break;

      if (!aProps.has(`${prefix}DIELLOSSTANGENT`)) continue;

      const material = ALTIUM_PROPS_UTILS.ReadString(aProps, `${prefix}DIELMATERIAL`, '');
      const height = ALTIUM_PROPS_UTILS.ReadKicadUnit(aProps, `${prefix}DIELHEIGHT`, '0mil');
      const diconst = ALTIUM_PROPS_UTILS.ReadDouble(aProps, `${prefix}DIELCONST`, 0);
      const tangent = ALTIUM_PROPS_UTILS.ReadDouble(aProps, `${prefix}DIELLOSSTANGENT`, 0);

      const key = MakeAltiumDielectricKey(material, height, diconst);

      const it = tangents.get(key);

      if (it === undefined) tangents.set(key, tangent);
      else if (Math.abs(it - tangent) > 1e-9) ambiguous.add(key);
    }
  };

  // Prefer V9 keys (most recent); fall back to the V8 physical stackup keys only for dielectrics
  // the V9 scan did not already provide.
  scan('V9_STACK_LAYER');
  scan('LAYER_V8_');

  for (const key of ambiguous) tangents.delete(key);

  return tangents;
}

function ReadAltiumStackupFromProperties(aProps: ALTIUM_PROPS): ABOARD6_LAYER_STACKUP[] {
  const stackup: ABOARD6_LAYER_STACKUP[] = [];

  for (let i = 1; ; i++) {
    const layeri = `LAYER${i}`;
    const layername = `${layeri}NAME`;

    if (!aProps.has(layername)) break;

    const l = new ABOARD6_LAYER_STACKUP(aProps, layeri, i);
    stackup.push(l);
  }

  // V7 format layers
  for (let i = 0; ; i++) {
    const layeri = `LAYERV7_${i}`;
    const layername = `${layeri}NAME`;

    if (!aProps.has(layername)) break;

    const l = new ABOARD6_LAYER_STACKUP(aProps, layeri, 0);
    stackup.push(l);
  }

  // The legacy LAYER<n> records do not store the dielectric loss tangent, but the modern V8/V9
  // physical stackup keys do. Backfill it onto the matching dielectric records.
  const tangents = ReadAltiumDielectricLossTangents(aProps);

  if (tangents.size !== 0) {
    for (const l of stackup) {
      const key = MakeAltiumDielectricKey(
        l.dielectricmaterial,
        l.dielectricthick,
        l.dielectricconst,
      );

      const it = tangents.get(key);

      if (it !== undefined) l.dielectriclosstangent = it;
    }
  }

  return stackup;
}

/** Ensure that layer names are unique in KiCad: `"%s %d"` from 2 on. */
function uniqueLayerNames(aStackup: ABOARD6_LAYER_STACKUP[], aLayerNames: Set<string>): void {
  for (const l of aStackup) {
    const originalName = l.name;

    for (let ii = 2; aLayerNames.has(l.name); ii++) l.name = `${originalName} ${ii}`;

    aLayerNames.add(l.name);
  }
}

export class ALIBRARY {
  layercount: number;
  stackup: ABOARD6_LAYER_STACKUP[];
  layerNames = new Set<string>();

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    const props = aReader.ReadProperties();

    if (props.size === 0) THROW_IO_ERROR('Library stream has no properties!');

    this.layercount = ALTIUM_PROPS_UTILS.ReadInt(props, 'LAYERSETSCOUNT', 1) + 1;

    this.stackup = ReadAltiumStackupFromProperties(props);

    // Ensure that layer names are unique in KiCad
    uniqueLayerNames(this.stackup, this.layerNames);

    if (aReader.HasParsingError()) THROW_IO_ERROR('Library stream was not parsed correctly!');
  }
}

export class ABOARD6 {
  sheetpos: VECTOR2I;
  /** `wxSize sheetsize`. */
  sheetsize: { x: number; y: number };

  layercount: number;
  stackup: ABOARD6_LAYER_STACKUP[];
  layerNames = new Set<string>();

  board_vertices: ALTIUM_VERTICE[] = [];

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    const props = aReader.ReadProperties();

    if (props.size === 0) THROW_IO_ERROR('Board6 stream has no properties!');

    this.sheetpos = {
      x: ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'SHEETX', '0mil'),
      y: -ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'SHEETY', '0mil') + 0,
    };
    this.sheetsize = {
      x: ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'SHEETWIDTH', '0mil'),
      y: ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'SHEETHEIGHT', '0mil'),
    };

    this.layercount = ALTIUM_PROPS_UTILS.ReadInt(props, 'LAYERSETSCOUNT', 1) + 1;

    this.stackup = ReadAltiumStackupFromProperties(props);

    // Ensure that layer names are unique in KiCad
    uniqueLayerNames(this.stackup, this.layerNames);

    altium_parse_polygons(props, this.board_vertices);

    if (aReader.HasParsingError()) THROW_IO_ERROR('Board6 stream was not parsed correctly!');
  }
}

export class ACLASS6 {
  name: string;
  uniqueid: string;

  kind: ALTIUM_CLASS_KIND;

  names: string[] = [];

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    const properties = aReader.ReadProperties();

    if (properties.size === 0) THROW_IO_ERROR('Classes6 stream has no properties!');

    this.name = ALTIUM_PROPS_UTILS.ReadString(properties, 'NAME', '');
    this.uniqueid = ALTIUM_PROPS_UTILS.ReadString(properties, 'UNIQUEID', '');
    this.kind = ALTIUM_PROPS_UTILS.ReadInt(properties, 'KIND', -1) as ALTIUM_CLASS_KIND;

    for (let i = 0; ; i++) {
      const mit = properties.get(`M${i}`);

      if (mit === undefined) break; // it doesn't seem like we know beforehand how many components are in the netclass

      this.names.push(mit);
    }

    if (aReader.HasParsingError()) THROW_IO_ERROR('Classes6 stream was not parsed correctly');
  }
}

export class ACOMPONENT6 {
  layer: ALTIUM_LAYER;
  position: VECTOR2I;
  rotation: number;
  locked: boolean;
  nameon: boolean;
  commenton: boolean;
  sourceUniqueID: string;
  sourceHierachicalPath: string;
  sourcedesignator: string;
  sourcefootprintlibrary: string;
  pattern: string;
  sourcecomponentlibrary: string;
  sourcelibreference: string;

  nameautoposition: ALTIUM_TEXT_POSITION;
  commentautoposition: ALTIUM_TEXT_POSITION;

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    const props = aReader.ReadProperties();

    if (props.size === 0) THROW_IO_ERROR('Components6 stream has no props');

    this.layer = altium_layer_from_name(ALTIUM_PROPS_UTILS.ReadString(props, 'LAYER', ''));
    this.position = {
      x: ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'X', '0mil'),
      y: -ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'Y', '0mil') + 0,
    };
    this.rotation = ALTIUM_PROPS_UTILS.ReadDouble(props, 'ROTATION', 0);
    this.locked = ALTIUM_PROPS_UTILS.ReadBool(props, 'LOCKED', false);
    this.nameon = ALTIUM_PROPS_UTILS.ReadBool(props, 'NAMEON', true);
    this.commenton = ALTIUM_PROPS_UTILS.ReadBool(props, 'COMMENTON', false);
    this.sourcedesignator = ALTIUM_PROPS_UTILS.ReadString(props, 'SOURCEDESIGNATOR', '');

    this.sourceUniqueID = ALTIUM_PROPS_UTILS.ReadString(props, 'SOURCEUNIQUEID', '');

    // Remove leading backslash from sourceUniqueID to match schematic component unique IDs
    if (this.sourceUniqueID.startsWith('\\'))
      this.sourceUniqueID = this.sourceUniqueID.substring(1);

    this.sourceHierachicalPath = ALTIUM_PROPS_UTILS.ReadString(props, 'SOURCEHIERARCHICALPATH', '');
    this.sourcefootprintlibrary = ALTIUM_PROPS_UTILS.ReadUnicodeString(
      props,
      'SOURCEFOOTPRINTLIBRARY',
      '',
    );
    this.pattern = ALTIUM_PROPS_UTILS.ReadUnicodeString(props, 'PATTERN', '');

    this.sourcecomponentlibrary = ALTIUM_PROPS_UTILS.ReadString(
      props,
      'SOURCECOMPONENTLIBRARY',
      '',
    );
    this.sourcelibreference = ALTIUM_PROPS_UTILS.ReadString(props, 'SOURCELIBREFERENCE', '');

    this.nameautoposition = ALTIUM_PROPS_UTILS.ReadInt(
      props,
      'NAMEAUTOPOSITION',
      0,
    ) as ALTIUM_TEXT_POSITION;
    this.commentautoposition = ALTIUM_PROPS_UTILS.ReadInt(
      props,
      'COMMENTAUTOPOSITION',
      0,
    ) as ALTIUM_TEXT_POSITION;

    if (aReader.HasParsingError()) THROW_IO_ERROR('Components6 stream was not parsed correctly');
  }
}

export class ADIMENSION6 {
  layer_v6: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer_v7: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  kind: ALTIUM_DIMENSION_KIND;

  textformat: string;
  textprefix: string;
  textsuffix: string;

  height: number;
  angle: number;

  /** `uint32_t`s: a negative KiCad unit wraps. */
  linewidth: number;
  textheight: number;
  textlinewidth: number;
  textprecision: number;
  textgap: number;
  textbold: boolean;
  textitalic: boolean;

  arrowsize: number;

  textunit: ALTIUM_UNIT;

  xy1: VECTOR2I;

  referencePoint: VECTOR2I[] = [];
  textPoint: VECTOR2I[] = [];

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    aReader.Skip(2);

    const props = aReader.ReadProperties();

    if (props.size === 0) THROW_IO_ERROR('Dimensions6 stream has no props');

    this.layer_v6 = altium_layer_from_name(ALTIUM_PROPS_UTILS.ReadString(props, 'LAYER', ''));
    this.layer_v7 = altium_layer_from_name(ALTIUM_PROPS_UTILS.ReadString(props, 'LAYER_V7', ''));
    this.kind = ALTIUM_PROPS_UTILS.ReadInt(props, 'DIMENSIONKIND', 0) as ALTIUM_DIMENSION_KIND;

    this.textformat = ALTIUM_PROPS_UTILS.ReadString(props, 'TEXTFORMAT', '');
    this.textprefix = ALTIUM_PROPS_UTILS.ReadString(props, 'TEXTPREFIX', '');
    this.textsuffix = ALTIUM_PROPS_UTILS.ReadString(props, 'TEXTSUFFIX', '');

    this.height = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'HEIGHT', '0mil');
    this.angle = ALTIUM_PROPS_UTILS.ReadDouble(props, 'ANGLE', 0);

    this.linewidth = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'LINEWIDTH', '10mil') >>> 0;
    this.textheight = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'TEXTHEIGHT', '10mil') >>> 0;
    this.textlinewidth = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'TEXTLINEWIDTH', '6mil') >>> 0;
    this.textprecision = ALTIUM_PROPS_UTILS.ReadInt(props, 'TEXTPRECISION', 2);
    this.textbold = ALTIUM_PROPS_UTILS.ReadBool(props, 'TEXTLINEWIDTH', false);
    this.textitalic = ALTIUM_PROPS_UTILS.ReadBool(props, 'ITALIC', false);
    this.textgap = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'TEXTGAP', '10mil') >>> 0;

    this.arrowsize = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'ARROWSIZE', '60mil');

    // text_position_raw = ReadString( props, "TEXTPOSITION", "" ): read, unused

    this.xy1 = {
      x: ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'X1', '0mil'),
      y: -ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'Y1', '0mil') + 0,
    };

    const refcount = ALTIUM_PROPS_UTILS.ReadInt(props, 'REFERENCES_COUNT', 0);

    for (let i = 0; i < refcount; i++) {
      const ref = `REFERENCE${i}POINT`;
      this.referencePoint.push({
        x: ALTIUM_PROPS_UTILS.ReadKicadUnit(props, `${ref}X`, '0mil'),
        y: -ALTIUM_PROPS_UTILS.ReadKicadUnit(props, `${ref}Y`, '0mil') + 0,
      });
    }

    for (let i = 1; ; i++) {
      const texti = `TEXT${i}`;
      const textix = `${texti}X`;
      const textiy = `${texti}Y`;

      if (!props.has(textix) || !props.has(textiy)) break; // it doesn't seem like we know beforehand how many vertices are inside a polygon

      this.textPoint.push({
        x: ALTIUM_PROPS_UTILS.ReadKicadUnit(props, textix, '0mil'),
        y: -ALTIUM_PROPS_UTILS.ReadKicadUnit(props, textiy, '0mil') + 0,
      });
    }

    const dimensionunit = ALTIUM_PROPS_UTILS.ReadString(props, 'TEXTDIMENSIONUNIT', 'Millimeters');

    if (dimensionunit === 'Inches') this.textunit = ALTIUM_UNIT.INCH;
    else if (dimensionunit === 'Mils') this.textunit = ALTIUM_UNIT.MILS;
    else if (dimensionunit === 'Millimeters') this.textunit = ALTIUM_UNIT.MM;
    else if (dimensionunit === 'Centimeters') this.textunit = ALTIUM_UNIT.CM;
    else this.textunit = ALTIUM_UNIT.UNKNOWN;

    this.layer = altium_versioned_layer(this.layer_v6, this.layer_v7);

    if (aReader.HasParsingError()) THROW_IO_ERROR('Dimensions6 stream was not parsed correctly');
  }
}

export class AMODEL {
  name: string;
  id: string;
  isEmbedded: boolean;

  rotation: { x: number; y: number; z: number };
  z_offset: number;
  checksum: number;

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    const properties = aReader.ReadProperties();

    if (properties.size === 0) THROW_IO_ERROR('Model stream has no properties!');

    this.name = ALTIUM_PROPS_UTILS.ReadString(properties, 'NAME', '');
    this.id = ALTIUM_PROPS_UTILS.ReadString(properties, 'ID', '');
    this.isEmbedded = ALTIUM_PROPS_UTILS.ReadBool(properties, 'EMBED', false);

    this.rotation = {
      x: ALTIUM_PROPS_UTILS.ReadDouble(properties, 'ROTX', 0),
      y: ALTIUM_PROPS_UTILS.ReadDouble(properties, 'ROTY', 0),
      z: ALTIUM_PROPS_UTILS.ReadDouble(properties, 'ROTZ', 0),
    };

    this.z_offset = ALTIUM_PROPS_UTILS.ReadDouble(properties, 'DZ', 0);
    this.checksum = ALTIUM_PROPS_UTILS.ReadInt(properties, 'CHECKSUM', 0);

    if (aReader.HasParsingError()) THROW_IO_ERROR('Model stream was not parsed correctly');
  }
}

export class ANET6 {
  name: string;

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    const properties = aReader.ReadProperties();

    if (properties.size === 0) THROW_IO_ERROR('Nets6 stream has no properties');

    this.name = ALTIUM_PROPS_UTILS.ReadString(properties, 'NAME', '');

    if (aReader.HasParsingError()) THROW_IO_ERROR('Nets6 stream was not parsed correctly');
  }
}

export class APOLYGON6 {
  layer_v6: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer_v7: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  net: number;
  locked: boolean;

  hatchstyle: ALTIUM_POLYGON_HATCHSTYLE;

  gridsize: number;
  trackwidth: number;
  minprimlength: number;
  useoctagons: boolean;

  // Note: Altium pour index is the opposite of KiCad zone priority!
  pourindex: number;

  vertices: ALTIUM_VERTICE[] = [];

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    const properties = aReader.ReadProperties();

    if (properties.size === 0) THROW_IO_ERROR('Polygons6 stream has no properties');

    this.layer_v6 = altium_layer_from_name(ALTIUM_PROPS_UTILS.ReadString(properties, 'LAYER', ''));
    this.layer_v7 = altium_layer_from_name(
      ALTIUM_PROPS_UTILS.ReadString(properties, 'LAYER_V7', ''),
    );
    this.net = u16(ALTIUM_PROPS_UTILS.ReadInt(properties, 'NET', ALTIUM_NET_UNCONNECTED));
    this.locked = ALTIUM_PROPS_UTILS.ReadBool(properties, 'LOCKED', false);

    // TODO: kind

    this.gridsize = ALTIUM_PROPS_UTILS.ReadKicadUnit(properties, 'GRIDSIZE', '0mil');
    this.trackwidth = ALTIUM_PROPS_UTILS.ReadKicadUnit(properties, 'TRACKWIDTH', '0mil');
    this.minprimlength = ALTIUM_PROPS_UTILS.ReadKicadUnit(properties, 'MINPRIMLENGTH', '0mil');
    this.useoctagons = ALTIUM_PROPS_UTILS.ReadBool(properties, 'USEOCTAGONS', false);

    this.pourindex = ALTIUM_PROPS_UTILS.ReadInt(properties, 'POURINDEX', 0);

    const hatchstyleraw = ALTIUM_PROPS_UTILS.ReadString(properties, 'HATCHSTYLE', '');

    if (hatchstyleraw === 'Solid') this.hatchstyle = ALTIUM_POLYGON_HATCHSTYLE.SOLID;
    else if (hatchstyleraw === '45Degree') this.hatchstyle = ALTIUM_POLYGON_HATCHSTYLE.DEGREE_45;
    else if (hatchstyleraw === '90Degree') this.hatchstyle = ALTIUM_POLYGON_HATCHSTYLE.DEGREE_90;
    else if (hatchstyleraw === 'Horizontal') this.hatchstyle = ALTIUM_POLYGON_HATCHSTYLE.HORIZONTAL;
    else if (hatchstyleraw === 'Vertical') this.hatchstyle = ALTIUM_POLYGON_HATCHSTYLE.VERTICAL;
    else if (hatchstyleraw === 'None') this.hatchstyle = ALTIUM_POLYGON_HATCHSTYLE.NONE;
    else this.hatchstyle = ALTIUM_POLYGON_HATCHSTYLE.UNKNOWN;

    altium_parse_polygons(properties, this.vertices);

    this.layer = altium_versioned_layer(this.layer_v6, this.layer_v7);

    if (aReader.HasParsingError()) THROW_IO_ERROR('Polygons6 stream was not parsed correctly');
  }
}

export class ARULE6 {
  name = '';
  priority = 0;

  kind: ALTIUM_RULE_KIND = ALTIUM_RULE_KIND.UNKNOWN;

  scope1expr = '';
  scope2expr = '';

  // ALTIUM_RULE_KIND::CLEARANCE
  // ALTIUM_RULE_KIND::HOLE_TO_HOLE_CLEARANCE
  clearanceGap = 0;

  // ALTIUM_RULE_KIND::WIDTH
  // ALTIUM_RULE_KIND::HOLE_SIZE
  minLimit = 0;
  maxLimit = 0;

  // ALTIUM_RULE_KIND::WIDTH
  preferredWidth = 0;

  // ALTIUM_RULE_KIND::ROUTING_VIAS
  width = 0;
  minWidth = 0;
  maxWidth = 0;
  holeWidth = 0;
  minHoleWidth = 0;
  maxHoleWidth = 0;

  // ALTIUM_RULE_KIND::PLANE_CLEARANCE
  planeclearanceClearance = 0;

  // ALTIUM_RULE_KIND::SOLDER_MASK_EXPANSION
  soldermaskExpansion = 0;

  // ALTIUM_RULE_KIND::PASTE_MASK_EXPANSION
  pastemaskExpansion = 0;

  // ALTIUM_RULE_KIND::POLYGON_CONNECT
  polygonconnectAirgapwidth = 0;
  polygonconnectReliefconductorwidth = 0;
  polygonconnectReliefentries = 0;
  polygonconnectStyle: ALTIUM_CONNECT_STYLE = ALTIUM_CONNECT_STYLE.UNKNOWN;

  // TODO: implement different types of rules we need to parse

  /** `ARULE6()` (default), or read from `aReader`. */
  constructor(aReader?: ALTIUM_BINARY_PARSER) {
    if (!aReader) return;

    aReader.Skip(2);

    const props = aReader.ReadProperties();

    if (props.size === 0) THROW_IO_ERROR('Rules6 stream has no props');

    this.name = ALTIUM_PROPS_UTILS.ReadString(props, 'NAME', '');
    this.priority = ALTIUM_PROPS_UTILS.ReadInt(props, 'PRIORITY', 1);

    this.scope1expr = ALTIUM_PROPS_UTILS.ReadString(props, 'SCOPE1EXPRESSION', '');
    this.scope2expr = ALTIUM_PROPS_UTILS.ReadString(props, 'SCOPE2EXPRESSION', '');

    const rulekind = ALTIUM_PROPS_UTILS.ReadString(props, 'RULEKIND', '');
    if (rulekind === 'Clearance') {
      this.kind = ALTIUM_RULE_KIND.CLEARANCE;
      this.clearanceGap = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'GAP', '10mil');
    } else if (rulekind === 'DiffPairsRouting') {
      this.kind = ALTIUM_RULE_KIND.DIFF_PAIR_ROUTINGS;
    } else if (rulekind === 'Height') {
      this.kind = ALTIUM_RULE_KIND.HEIGHT;
    } else if (rulekind === 'HoleSize') {
      this.kind = ALTIUM_RULE_KIND.HOLE_SIZE;
      this.minLimit = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'MINLIMIT', '1mil');
      this.maxLimit = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'MAXLIMIT', '150mil');
    } else if (rulekind === 'HoleToHoleClearance') {
      this.kind = ALTIUM_RULE_KIND.HOLE_TO_HOLE_CLEARANCE;
      this.clearanceGap = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'GAP', '10mil');
    } else if (rulekind === 'RoutingVias') {
      this.kind = ALTIUM_RULE_KIND.ROUTING_VIAS;
      this.width = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'WIDTH', '20mil');
      this.minWidth = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'MINWIDTH', '20mil');
      this.maxWidth = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'MAXWIDTH', '50mil');
      this.holeWidth = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'HOLEWIDTH', '10mil');
      this.minHoleWidth = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'MINHOLEWIDTH', '10mil');
      this.maxHoleWidth = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'MAXHOLEWIDTH', '28mil');
    } else if (rulekind === 'Width') {
      this.kind = ALTIUM_RULE_KIND.WIDTH;
      this.minLimit = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'MINLIMIT', '6mil');
      this.maxLimit = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'MAXLIMIT', '40mil');
      this.preferredWidth = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'PREFERREDWIDTH', '6mil');
    } else if (rulekind === 'PasteMaskExpansion') {
      this.kind = ALTIUM_RULE_KIND.PASTE_MASK_EXPANSION;
      this.pastemaskExpansion = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'EXPANSION', '0');
    } else if (rulekind === 'SolderMaskExpansion') {
      this.kind = ALTIUM_RULE_KIND.SOLDER_MASK_EXPANSION;
      this.soldermaskExpansion = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'EXPANSION', '4mil');
    } else if (rulekind === 'PlaneClearance') {
      this.kind = ALTIUM_RULE_KIND.PLANE_CLEARANCE;
      this.planeclearanceClearance = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'CLEARANCE', '10mil');
    } else if (rulekind === 'PolygonConnect') {
      this.kind = ALTIUM_RULE_KIND.POLYGON_CONNECT;
      this.polygonconnectAirgapwidth = ALTIUM_PROPS_UTILS.ReadKicadUnit(
        props,
        'AIRGAPWIDTH',
        '10mil',
      );
      this.polygonconnectReliefconductorwidth = ALTIUM_PROPS_UTILS.ReadKicadUnit(
        props,
        'RELIEFCONDUCTORWIDTH',
        '10mil',
      );
      this.polygonconnectReliefentries = ALTIUM_PROPS_UTILS.ReadInt(props, 'RELIEFENTRIES', 4);

      const style = ALTIUM_PROPS_UTILS.ReadString(props, 'CONNECTSTYLE', '');

      if (style === 'Direct') this.polygonconnectStyle = ALTIUM_CONNECT_STYLE.DIRECT;
      else if (style === 'Relief') this.polygonconnectStyle = ALTIUM_CONNECT_STYLE.RELIEF;
      else if (style === 'NoConnect') this.polygonconnectStyle = ALTIUM_CONNECT_STYLE.NONE;
      else this.polygonconnectStyle = ALTIUM_CONNECT_STYLE.UNKNOWN;
    } else {
      this.kind = ALTIUM_RULE_KIND.UNKNOWN;
    }

    if (aReader.HasParsingError()) THROW_IO_ERROR('Rules6 stream was not parsed correctly');
  }
}

// Interactive length-tuning meander, stored in the SmartUnions stream and referenced by
// copper primitives through their union index.  Altium commits the tuned copper as ordinary
// tracks and arcs, keeping the parametric meander definition here.
export class ASMARTUNION6 {
  unionindex = 0;
  is_tuning = false;
  is_diffpair = false;

  style = 0;
  gap = 0;
  amplitude = 0;
  minamplitude = 0;
  mitterradiusratio = 0.0;
  singleside = false;

  baseline: VECTOR2I[] = [];
  baselinecoupled: VECTOR2I[] = [];

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    const props = aReader.ReadProperties();

    if (props.size === 0) THROW_IO_ERROR('SmartUnions stream has no props');

    this.unionindex = ALTIUM_PROPS_UTILS.ReadInt(props, 'UNIONINDEX', 0);
    this.is_tuning = ALTIUM_PROPS_UTILS.ReadBool(props, 'TRACETUNINGVALID', false);

    // A tuned differential pair names its pair here; single-track tuning leaves it empty.
    this.is_diffpair = ALTIUM_PROPS_UTILS.ReadString(props, 'TUNEDOBJECTDIFFPAIR', '') !== '';

    this.style = ALTIUM_PROPS_UTILS.ReadInt(props, 'STYLE', 0);
    this.gap = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'GAP', '0mil');
    this.amplitude = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'AMPLITUDE', '0mil');
    this.minamplitude = ALTIUM_PROPS_UTILS.ReadKicadUnit(props, 'MINAMPLITUDE', '0mil');
    this.mitterradiusratio = ALTIUM_PROPS_UTILS.ReadDouble(props, 'MITTERRADIUSRATIO', 0.0);
    this.singleside = ALTIUM_PROPS_UTILS.ReadBool(props, 'SINGLESIDE', false);

    // The un-meandered route the accordion replaced, as consecutive LINE<n> segments.  Nothing
    // else records it, so it is the only source for KiCad's tuning-pattern baseline
    const readBaseline = (aPrefix: string, aOut: VECTOR2I[]): void => {
      for (let i = 0; ; ++i) {
        const prefix = `${aPrefix}${i}.`;
        const firstX = `${prefix}X1`;

        if (!props.has(firstX)) break;

        const a = {
          x: ALTIUM_PROPS_UTILS.ReadKicadUnit(props, firstX, '0mil'),
          y: -ALTIUM_PROPS_UTILS.ReadKicadUnit(props, `${prefix}Y1`, '0mil') + 0,
        };
        const b = {
          x: ALTIUM_PROPS_UTILS.ReadKicadUnit(props, `${prefix}X2`, '0mil'),
          y: -ALTIUM_PROPS_UTILS.ReadKicadUnit(props, `${prefix}Y2`, '0mil') + 0,
        };

        for (const pt of [a, b]) {
          const back = aOut[aOut.length - 1];
          if (aOut.length === 0 || back!.x !== pt.x || back!.y !== pt.y) aOut.push(pt);
        }
      }
    };

    readBaseline('LINE', this.baseline);
    readBaseline('LINEOTHER', this.baselinecoupled);

    if (aReader.HasParsingError()) THROW_IO_ERROR('SmartUnions stream was not parsed correctly');
  }
}

export class AARC6 {
  is_locked: boolean;
  is_keepout: boolean;
  is_polygonoutline: boolean;

  layer_v6: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer_v7: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  net: number;
  component: number;
  polygon: number;
  subpolyindex: number;
  keepoutrestrictions: number;
  unionindex = 0;

  center: VECTOR2I;
  /** `uint32_t`. */
  radius: number;
  startangle: number;
  endangle: number;
  /** `uint32_t`. */
  width: number;

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    const recordtype = aReader.ReadUint8() as ALTIUM_RECORD;
    if (recordtype !== ALTIUM_RECORD.ARC) {
      THROW_IO_ERROR('Arcs6 stream has invalid recordtype');
    }

    // Subrecord 1
    aReader.ReadAndSetSubrecordLength();

    this.layer_v6 = aReader.ReadUint8() as ALTIUM_LAYER;

    const flags1 = aReader.ReadUint8();
    this.is_locked = (flags1 & 0x04) === 0;
    this.is_polygonoutline = (flags1 & 0x02) !== 0;

    const flags2 = aReader.ReadUint8();
    this.is_keepout = flags2 === 2;

    this.net = aReader.ReadUint16();
    this.polygon = aReader.ReadUint16();
    this.component = aReader.ReadUint16();
    aReader.Skip(4);
    this.center = aReader.ReadVector2IPos();
    this.radius = aReader.ReadKicadUnit() >>> 0;
    this.startangle = aReader.ReadDouble();
    this.endangle = aReader.ReadDouble();
    this.width = aReader.ReadKicadUnit() >>> 0;
    this.subpolyindex = aReader.ReadUint16();

    const remaining = aReader.GetRemainingSubrecordBytes();

    if (remaining >= 9) {
      aReader.Skip(1);
      this.unionindex = aReader.ReadUint32();
      this.layer_v7 = aReader.ReadUint32() as ALTIUM_LAYER;
    }

    if (remaining >= 10) this.keepoutrestrictions = aReader.ReadUint8();
    else this.keepoutrestrictions = this.is_keepout ? 0x1f : 0;

    this.layer = altium_versioned_layer(this.layer_v6, this.layer_v7);

    aReader.SkipSubrecord();

    if (aReader.HasParsingError()) {
      THROW_IO_ERROR('Arcs6 stream was not parsed correctly');
    }
  }
}

export class ACOMPONENTBODY6 {
  component = 0;

  body_name = '';
  kind = 0;
  subpolyindex = 0;
  unionindex = 0;
  arc_resolution = 0;
  is_shape_based = false;
  cavity_height = 0;
  standoff_height = 0;
  overall_height = 0;
  body_projection = 0;
  body_color_3d = 0;
  body_opacity_3d = 0.0;
  identifier = '';
  texture = '';
  texture_center_x = 0;
  texture_center_y = 0;
  texture_size_x = 0;
  texture_size_y = 0;
  texture_rotation = 0;

  modelId = '';
  modelChecksum = '';
  modelIsEmbedded = false;
  modelName = '';
  modelType = 0;
  modelSource = 0;
  modelSnapCount = 0;

  modelPosition = { x: 0, y: 0, z: 0 };
  modelRotation = { x: 0, y: 0, z: 0 };
  rotation = 0.0;

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    const recordtype = aReader.ReadUint8() as ALTIUM_RECORD;

    if (recordtype !== ALTIUM_RECORD.MODEL)
      THROW_IO_ERROR('ComponentsBodies6 stream has invalid recordtype');

    aReader.ReadAndSetSubrecordLength();

    aReader.Skip(7);
    this.component = aReader.ReadUint16();
    aReader.Skip(9);

    const properties = aReader.ReadProperties();

    if (properties.size === 0) THROW_IO_ERROR('ComponentsBodies6 stream has no properties');

    this.modelName = ALTIUM_PROPS_UTILS.ReadString(properties, 'MODEL.NAME', '');
    this.modelId = ALTIUM_PROPS_UTILS.ReadString(properties, 'MODELID', '');
    this.modelIsEmbedded = ALTIUM_PROPS_UTILS.ReadBool(properties, 'MODEL.EMBED', false);

    this.modelPosition.x = ALTIUM_PROPS_UTILS.ReadKicadUnit(properties, 'MODEL.2D.X', '0mil');
    this.modelPosition.y = -ALTIUM_PROPS_UTILS.ReadKicadUnit(properties, 'MODEL.2D.Y', '0mil');
    this.modelPosition.z = ALTIUM_PROPS_UTILS.ReadKicadUnit(properties, 'MODEL.3D.DZ', '0mil');

    this.modelRotation.x = ALTIUM_PROPS_UTILS.ReadDouble(properties, 'MODEL.3D.ROTX', 0);
    this.modelRotation.y = ALTIUM_PROPS_UTILS.ReadDouble(properties, 'MODEL.3D.ROTY', 0);
    this.modelRotation.z = ALTIUM_PROPS_UTILS.ReadDouble(properties, 'MODEL.3D.ROTZ', 0);

    this.rotation = ALTIUM_PROPS_UTILS.ReadDouble(properties, 'MODEL.2D.ROTATION', 0);

    this.body_opacity_3d = ALTIUM_PROPS_UTILS.ReadDouble(properties, 'BODYOPACITY3D', 1);
    this.body_projection = ALTIUM_PROPS_UTILS.ReadInt(properties, 'BODYPROJECTION', 0);

    aReader.SkipSubrecord();

    if (aReader.HasParsingError()) THROW_IO_ERROR('Components6 stream was not parsed correctly');
  }
}

/** `wxSize`. */
export interface wxSize {
  x: number;
  y: number;
}

export class APAD6_SIZE_AND_SHAPE {
  holeshape: ALTIUM_PAD_HOLE_SHAPE = ALTIUM_PAD_HOLE_SHAPE.UNKNOWN;
  /** `uint32_t`. */
  slotsize = 0;
  slotrotation = 0;

  inner_size: wxSize[] = Array.from({ length: 29 }, () => ({ x: 0, y: 0 }));
  inner_shape: ALTIUM_PAD_SHAPE[] = new Array(29).fill(ALTIUM_PAD_SHAPE.UNKNOWN);
  holeoffset: VECTOR2I[] = Array.from({ length: 32 }, () => ({ x: 0, y: 0 }));
  alt_shape: ALTIUM_PAD_SHAPE_ALT[] = new Array(32).fill(ALTIUM_PAD_SHAPE_ALT.UNKNOWN);
  cornerradius: number[] = new Array(32).fill(0);
}

export class APAD6 {
  is_locked: boolean;
  is_tent_top: boolean;
  is_tent_bottom: boolean;
  is_test_fab_top: boolean;
  is_test_fab_bottom: boolean;

  name: string;

  layer_v6: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer_v7: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  net: number;
  component: number;

  position: VECTOR2I;
  topsize: VECTOR2I;
  midsize: VECTOR2I;
  botsize: VECTOR2I;
  /** `uint32_t`. */
  holesize: number;

  topshape: ALTIUM_PAD_SHAPE;
  midshape: ALTIUM_PAD_SHAPE;
  botshape: ALTIUM_PAD_SHAPE;

  padmode: ALTIUM_PAD_MODE;

  direction: number;
  plated: boolean;
  pastemaskexpansionmode: ALTIUM_MODE;
  pastemaskexpansionmanual: number;
  soldermaskexpansionmode: ALTIUM_MODE;
  soldermaskexpansionmanual: number;
  holerotation: number;

  tolayer: ALTIUM_LAYER;
  fromlayer: ALTIUM_LAYER;

  pad_to_die_length: number;
  pad_to_die_delay: number;

  sizeAndShape: APAD6_SIZE_AND_SHAPE | null = null;

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    const recordtype = aReader.ReadUint8() as ALTIUM_RECORD;

    if (recordtype !== ALTIUM_RECORD.PAD) THROW_IO_ERROR('Pads6 stream has invalid recordtype');

    // Subrecord 1
    const subrecord1 = aReader.ReadAndSetSubrecordLength();

    if (subrecord1 === 0) THROW_IO_ERROR('Pads6 stream has no subrecord1 data');

    this.name = aReader.ReadWxString();

    if (aReader.GetRemainingSubrecordBytes() !== 0)
      THROW_IO_ERROR('Pads6 stream has invalid subrecord1 length');

    aReader.SkipSubrecord();

    // Subrecord 2
    aReader.ReadAndSetSubrecordLength();
    aReader.SkipSubrecord();

    // Subrecord 3
    aReader.ReadAndSetSubrecordLength();
    aReader.SkipSubrecord();

    // Subrecord 4
    aReader.ReadAndSetSubrecordLength();
    aReader.SkipSubrecord();

    // Subrecord 5
    const subrecord5 = aReader.ReadAndSetSubrecordLength();

    ExpectSubrecordLengthAtLeast('Pads6', 'subrecord5', 110, subrecord5);

    this.layer_v6 = aReader.ReadUint8() as ALTIUM_LAYER;
    this.tolayer = ALTIUM_LAYER.UNKNOWN;
    this.fromlayer = ALTIUM_LAYER.UNKNOWN;

    const flags1 = aReader.ReadUint8();
    this.is_test_fab_top = (flags1 & 0x80) !== 0;
    this.is_tent_bottom = (flags1 & 0x40) !== 0;
    this.is_tent_top = (flags1 & 0x20) !== 0;
    this.is_locked = (flags1 & 0x04) === 0;

    const flags2 = aReader.ReadUint8();
    this.is_test_fab_bottom = (flags2 & 0x01) !== 0;

    this.net = aReader.ReadUint16();
    aReader.Skip(2);
    this.component = aReader.ReadUint16();
    aReader.Skip(4); // to 13

    this.position = aReader.ReadVector2IPos();
    this.topsize = aReader.ReadVector2ISize();
    this.midsize = aReader.ReadVector2ISize();
    this.botsize = aReader.ReadVector2ISize();
    this.holesize = aReader.ReadKicadUnit() >>> 0; // to 49

    this.topshape = aReader.ReadUint8() as ALTIUM_PAD_SHAPE;
    this.midshape = aReader.ReadUint8() as ALTIUM_PAD_SHAPE;
    this.botshape = aReader.ReadUint8() as ALTIUM_PAD_SHAPE;

    this.direction = aReader.ReadDouble();
    this.plated = aReader.ReadUint8() !== 0;
    aReader.Skip(1);
    this.padmode = aReader.ReadUint8() as ALTIUM_PAD_MODE;
    aReader.Skip(23);
    this.pastemaskexpansionmanual = aReader.ReadKicadUnit();
    this.soldermaskexpansionmanual = aReader.ReadKicadUnit();
    aReader.Skip(7);
    this.pastemaskexpansionmode = aReader.ReadUint8() as ALTIUM_MODE;
    this.soldermaskexpansionmode = aReader.ReadUint8() as ALTIUM_MODE;
    aReader.Skip(3); // to 106

    this.pad_to_die_length = 0;
    this.pad_to_die_delay = 0;

    if (subrecord5 === 110) {
      // Don't know exactly what this is, but it's always been 0 in the files with 110-byte subrecord5.
      // e.g. https://gitlab.com/kicad/code/kicad/-/issues/16514
      const unknown = aReader.ReadKicadUnit() >>> 0; // to 110

      if (unknown !== 0) {
        THROW_IO_ERROR(
          `Pads6 stream subrecord5 + 106 has value ${unknown | 0}, which is unexpected`,
        );
      }
      this.holerotation = 0;
    } else {
      // More than 110, need at least 114
      ExpectSubrecordLengthAtLeast('Pads6', 'subrecord5', 114, subrecord5);
      this.holerotation = aReader.ReadDouble(); // to 114
    }

    if (subrecord5 >= 120) {
      this.tolayer = aReader.ReadUint8() as ALTIUM_LAYER;
      aReader.Skip(2);
      this.fromlayer = aReader.ReadUint8() as ALTIUM_LAYER;
      //aReader.skip( 2 );
    }

    if (subrecord5 >= 202) {
      aReader.Skip(40);
      this.pad_to_die_length = aReader.ReadKicadUnit();
      aReader.Skip(32);
      this.pad_to_die_delay = KiROUND(aReader.ReadDouble() * 1e18);
    }

    aReader.SkipSubrecord();

    // Subrecord 6
    const subrecord6 = aReader.ReadAndSetSubrecordLength();
    // Known lengths: 596, 628, 651
    // 596 is the number of bytes read in this code-block
    if (subrecord6 >= 596) {
      const sizeAndShape = new APAD6_SIZE_AND_SHAPE();
      this.sizeAndShape = sizeAndShape;

      for (const size of sizeAndShape.inner_size) size.x = aReader.ReadKicadUnitX();

      for (const size of sizeAndShape.inner_size) size.y = aReader.ReadKicadUnitY() + 0;

      for (let i = 0; i < sizeAndShape.inner_shape.length; i++)
        sizeAndShape.inner_shape[i] = aReader.ReadUint8() as ALTIUM_PAD_SHAPE;

      aReader.Skip(1);

      sizeAndShape.holeshape = ((aReader.ReadUint8() << 24) >> 24) as ALTIUM_PAD_HOLE_SHAPE;
      sizeAndShape.slotsize = aReader.ReadKicadUnit() >>> 0;
      sizeAndShape.slotrotation = aReader.ReadDouble();

      for (const pt of sizeAndShape.holeoffset) pt.x = aReader.ReadKicadUnitX();

      for (const pt of sizeAndShape.holeoffset) pt.y = aReader.ReadKicadUnitY() + 0;

      aReader.Skip(1);

      for (let i = 0; i < sizeAndShape.alt_shape.length; i++)
        sizeAndShape.alt_shape[i] = aReader.ReadUint8() as ALTIUM_PAD_SHAPE_ALT;

      for (let i = 0; i < sizeAndShape.cornerradius.length; i++)
        sizeAndShape.cornerradius[i] = aReader.ReadUint8();
    } else if (subrecord6 !== 0) {
      wxLogError(`Pads6 stream has unexpected length for subrecord 6: ${subrecord6}.`);
    }

    this.layer = altium_versioned_layer(this.layer_v6, this.layer_v7);

    aReader.SkipSubrecord();

    if (aReader.HasParsingError()) THROW_IO_ERROR('Pads6 stream was not parsed correctly');
  }
}

export class AVIA6 {
  is_locked = false;
  is_tent_top = false;
  is_tent_bottom = false;
  is_test_fab_top = false;
  is_test_fab_bottom = false;

  net = 0;

  position: VECTOR2I = { x: 0, y: 0 };
  pos_tolerance = 2147483640; // 2147483640 is N/A
  neg_tolerance = 2147483640; // 2147483640 is N/A
  /** `uint32_t`. */
  diameter = 0;
  /** `uint32_t`. */
  holesize = 0;

  thermal_relief_airgap = 0;
  thermal_relief_conductorcount = 0;
  thermal_relief_conductorwidth = 0;

  soldermask_expansion_front = 0;
  soldermask_expansion_back = 0;
  soldermask_expansion_manual = false;
  soldermask_expansion_linked = false;

  // When true, the manual solder mask expansion is measured outward from the hole edge rather
  // than from the via land (copper) edge.  Altium "Solder Mask Expansion From The Hole Edge".
  soldermask_expansion_from_hole = false;

  layer_start: ALTIUM_LAYER;
  layer_end: ALTIUM_LAYER;
  viamode: ALTIUM_PAD_MODE;

  // In PAD_MODE::SIMPLE, this is the same as the diameter
  // In PAD_MODE::TOP_MIDDLE_BOTTOM, layer 0 is top, layer 1 is middle, layer 31 is bottom
  // In PAD_MODE::FULL_STACK, layers correspond to the layer number
  /** `uint32_t diameter_by_layer[32]`. */
  diameter_by_layer: number[] = new Array(32).fill(0);

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    const recordtype = aReader.ReadUint8() as ALTIUM_RECORD;

    if (recordtype !== ALTIUM_RECORD.VIA) THROW_IO_ERROR('Vias6 stream has invalid recordtype');

    // Subrecord 1
    const subrecord1 = aReader.ReadAndSetSubrecordLength();

    aReader.Skip(1);
    const flags1 = aReader.ReadUint8();
    this.is_test_fab_top = (flags1 & 0x80) !== 0;
    this.is_tent_bottom = (flags1 & 0x40) !== 0;
    this.is_tent_top = (flags1 & 0x20) !== 0;
    this.is_locked = (flags1 & 0x04) === 0;

    const flags2 = aReader.ReadUint8();
    this.is_test_fab_bottom = (flags2 & 0x01) !== 0;

    this.net = aReader.ReadUint16();
    aReader.Skip(8);
    this.position = aReader.ReadVector2IPos();
    this.diameter = aReader.ReadKicadUnit() >>> 0;
    this.holesize = aReader.ReadKicadUnit() >>> 0;

    this.layer_start = aReader.ReadUint8() as ALTIUM_LAYER;
    this.layer_end = aReader.ReadUint8() as ALTIUM_LAYER;

    if (subrecord1 <= 74) {
      this.viamode = ALTIUM_PAD_MODE.SIMPLE;
    } else {
      let temp_byte = aReader.ReadUint8(); // Unknown.

      this.thermal_relief_airgap = aReader.ReadKicadUnit();
      this.thermal_relief_conductorcount = aReader.ReadUint8();
      aReader.Skip(1); // Unknown.

      this.thermal_relief_conductorwidth = aReader.ReadKicadUnit() >>> 0;

      aReader.ReadKicadUnit(); // Unknown.  20mil?
      aReader.ReadKicadUnit(); // Unknown.  20mil?

      aReader.Skip(4);
      this.soldermask_expansion_front = aReader.ReadKicadUnit();

      // Records that don't carry an explicit back expansion mirror the front value.
      this.soldermask_expansion_back = this.soldermask_expansion_front;

      aReader.Skip(8);

      temp_byte = aReader.ReadUint8();
      this.soldermask_expansion_manual = (temp_byte & 0x02) !== 0;

      this.soldermask_expansion_from_hole = (aReader.ReadUint8() & 0x01) !== 0;

      aReader.Skip(6);

      this.viamode = aReader.ReadUint8() as ALTIUM_PAD_MODE;

      for (let ii = 0; ii < 32; ++ii) {
        this.diameter_by_layer[ii] = aReader.ReadKicadUnit() >>> 0;
      }
    }

    if (subrecord1 >= 246) {
      aReader.Skip(38);
      this.soldermask_expansion_linked = (aReader.ReadUint8() & 0x01) !== 0;
      this.soldermask_expansion_back = aReader.ReadKicadUnit();

      if (this.soldermask_expansion_linked)
        this.soldermask_expansion_back = this.soldermask_expansion_front;
    }

    if (subrecord1 >= 307) {
      aReader.Skip(45);

      this.pos_tolerance = aReader.ReadKicadUnit() >>> 0;
      this.neg_tolerance = aReader.ReadKicadUnit() >>> 0;
    }

    aReader.SkipSubrecord();

    if (aReader.HasParsingError()) THROW_IO_ERROR('Vias6 stream was not parsed correctly');
  }
}

export class ATRACK6 {
  is_locked: boolean;
  is_keepout: boolean;
  is_polygonoutline: boolean;

  layer_v6: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer_v7: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  net: number;
  component: number;
  polygon: number;
  subpolyindex: number;
  keepoutrestrictions: number;
  unionindex = 0;

  start: VECTOR2I;
  end: VECTOR2I;
  /** `uint32_t`. */
  width: number;

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    const recordtype = aReader.ReadUint8() as ALTIUM_RECORD;

    if (recordtype !== ALTIUM_RECORD.TRACK) THROW_IO_ERROR('Tracks6 stream has invalid recordtype');

    // Subrecord 1
    aReader.ReadAndSetSubrecordLength();

    this.layer_v6 = aReader.ReadUint8() as ALTIUM_LAYER;

    const flags1 = aReader.ReadUint8();
    this.is_locked = (flags1 & 0x04) === 0;
    this.is_polygonoutline = (flags1 & 0x02) !== 0;

    const flags2 = aReader.ReadUint8();
    this.is_keepout = flags2 === 2;

    this.net = aReader.ReadUint16();
    this.polygon = aReader.ReadUint16();
    this.component = aReader.ReadUint16();
    aReader.Skip(4);
    this.start = aReader.ReadVector2IPos();
    this.end = aReader.ReadVector2IPos();
    this.width = aReader.ReadKicadUnit() >>> 0;
    this.subpolyindex = aReader.ReadUint16();
    aReader.Skip(1);

    const remaining = aReader.GetRemainingSubrecordBytes();

    if (remaining >= 9) {
      this.unionindex = aReader.ReadUint32();
      aReader.Skip(1);
      this.layer_v7 = aReader.ReadUint32() as ALTIUM_LAYER;
    }

    if (remaining >= 10) this.keepoutrestrictions = aReader.ReadUint8();
    else this.keepoutrestrictions = this.is_keepout ? 0x1f : 0;

    this.layer = altium_versioned_layer(this.layer_v6, this.layer_v7);

    aReader.SkipSubrecord();

    if (aReader.HasParsingError()) THROW_IO_ERROR('Tracks6 stream was not parsed correctly');
  }
}

export enum STROKE_FONT_TYPE {
  DEFAULT = 1,
  SANSSERIF = 2,
  SERIF = 3,
}

/** `UTF-16LE` of `char fontData[64]`, then `BeforeFirst( '\0' )`. */
function fontNameOf(aData: Uint8Array): string {
  const s = new TextDecoder('utf-16le').decode(aData);
  const nul = s.indexOf('\0');
  return nul === -1 ? s : s.slice(0, nul);
}

export class ATEXT6 {
  layer_v6: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer_v7: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  component = 0;

  position: VECTOR2I = { x: 0, y: 0 };
  /** `uint32_t`. */
  height = 0;
  rotation = 0.0;
  /** `uint32_t`. */
  strokewidth = 0;
  strokefonttype: STROKE_FONT_TYPE = STROKE_FONT_TYPE.DEFAULT;

  isBold = false;
  isItalic = false;
  isMirrored = false;
  isInverted = false;
  isInvertedRect = false;
  isFrame = false;
  isOffsetBorder = false;
  isJustificationValid = false;

  margin_border_width = 0;
  textbox_rect_width = 0;
  textbox_rect_height = 0;
  text_offset_width = 0;

  // Justification only applies when there is a text box size specified
  // Then, the text is justified within the box
  textbox_rect_justification: ALTIUM_TEXT_POSITION = ALTIUM_TEXT_POSITION.CENTER_CENTER;

  widestring_index = 0;

  isComment = false;
  isDesignator = false;

  fonttype: ALTIUM_TEXT_TYPE = ALTIUM_TEXT_TYPE.STROKE;
  fontname = '';
  barcode_fontname = '';

  // Barcode specific parameters
  barcode_margin: VECTOR2I = { x: 0, y: 0 };
  barcode_type: ALTIUM_BARCODE_TYPE = ALTIUM_BARCODE_TYPE.CODE39;
  barcode_inverted = false;
  barcode_name = '';
  barcode_show_text = false;

  text = '';

  constructor(aReader: ALTIUM_BINARY_PARSER, aStringTable: Map<number, string>) {
    const recordtype = aReader.ReadUint8() as ALTIUM_RECORD;

    if (recordtype !== ALTIUM_RECORD.TEXT) THROW_IO_ERROR('Texts6 stream has invalid recordtype');

    // Subrecord 1 - Properties
    const subrecord1 = aReader.ReadAndSetSubrecordLength();

    this.layer_v6 = aReader.ReadUint8() as ALTIUM_LAYER;
    aReader.Skip(6);
    this.component = aReader.ReadUint16();
    aReader.Skip(4);
    this.position = aReader.ReadVector2IPos();
    this.height = aReader.ReadKicadUnit() >>> 0;
    this.strokefonttype = aReader.ReadUint16() as STROKE_FONT_TYPE;
    // TODO: The Serif font type doesn't match well with KiCad, we should replace it with a better match

    this.rotation = aReader.ReadDouble();
    this.isMirrored = aReader.ReadUint8() !== 0;
    this.strokewidth = aReader.ReadKicadUnit() >>> 0;

    if (subrecord1 < 123) {
      this.fonttype = ALTIUM_TEXT_TYPE.STROKE;
      aReader.SkipSubrecord();
      return;
    }

    this.isComment = aReader.ReadUint8() !== 0;
    this.isDesignator = aReader.ReadUint8() !== 0;
    aReader.Skip(1);
    this.fonttype = ((aReader.ReadUint8() << 24) >> 24) as ALTIUM_TEXT_TYPE;
    this.isBold = aReader.ReadUint8() !== 0;
    this.isItalic = aReader.ReadUint8() !== 0;

    const fontData = new Uint8Array(64);
    aReader.ReadBytes(fontData, fontData.length);
    this.fontname = fontNameOf(fontData);

    const tmpbyte = aReader.ReadUint8();
    this.isInverted = !!tmpbyte;
    this.margin_border_width = aReader.ReadKicadUnit() >>> 0; // "Margin Border"
    this.widestring_index = aReader.ReadUint32();
    aReader.Skip(4);

    // An inverted rect in Altium is like a text box with the text inverted.
    this.isInvertedRect = aReader.ReadUint8() !== 0;

    this.textbox_rect_width = aReader.ReadKicadUnit() >>> 0;
    this.textbox_rect_height = aReader.ReadKicadUnit() >>> 0;
    this.textbox_rect_justification = aReader.ReadUint8() as ALTIUM_TEXT_POSITION;
    this.text_offset_width = aReader.ReadKicadUnit() >>> 0; // "Text Offset"

    const remaining = aReader.GetRemainingSubrecordBytes();

    if (remaining >= 93) {
      aReader.ReadVector2ISize(); // unk_vec (traced)

      this.barcode_margin = aReader.ReadVector2ISize();

      aReader.ReadKicadUnit(); // unk32 (traced)

      this.barcode_type = aReader.ReadUint8() as ALTIUM_BARCODE_TYPE;
      aReader.ReadUint8(); // unk8 (traced)

      this.barcode_inverted = aReader.ReadUint8() !== 0;
      this.fonttype = ((aReader.ReadUint8() << 24) >> 24) as ALTIUM_TEXT_TYPE;

      aReader.ReadBytes(fontData, fontData.length);
      this.barcode_fontname = fontNameOf(fontData);

      aReader.ReadUint8();

      this.layer_v7 = aReader.ReadUint32() as ALTIUM_LAYER;
    }

    if (remaining >= 103) {
      // "Frame" text type flag
      this.isFrame = aReader.ReadUint8() !== 0;

      // Use "Offset" border value instead of "Margin"
      this.isOffsetBorder = aReader.ReadUint8() !== 0;

      for (let ii = 0; ii < 8; ++ii) {
        // Peek<uint8_t>() / Peek<uint32_t>() for the trace only
        aReader.Skip(1);
      }
    } else {
      this.isFrame = this.textbox_rect_height !== 0 && this.textbox_rect_width !== 0;
      this.isOffsetBorder = false;
    }

    if (remaining >= 115) {
      // textbox_rect_justification will be wrong (5) when this flag is unset,
      // in that case, we should always use the left bottom justification.
      this.isJustificationValid = aReader.ReadUint8() !== 0;
    } else {
      this.isJustificationValid = false;
    }

    aReader.SkipSubrecord();

    // Subrecord 2 - Legacy 8bit string, max 255 chars, unknown codepage
    aReader.ReadAndSetSubrecordLength();

    const entry = aStringTable.get(this.widestring_index);

    if (entry !== undefined) this.text = entry;
    else this.text = aReader.ReadWxString();

    // Normalize Windows line endings
    this.text = this.text.replaceAll('\r\n', '\n');

    aReader.SkipSubrecord();

    // Altium only supports inverting truetype fonts
    if (this.fonttype !== ALTIUM_TEXT_TYPE.STROKE) {
      this.isInverted = false;
      this.isInvertedRect = false;
    }

    this.layer = altium_versioned_layer(this.layer_v6, this.layer_v7);

    if (aReader.HasParsingError()) THROW_IO_ERROR('Texts6 stream was not parsed correctly');
  }
}

export class AFILL6 {
  is_locked: boolean;
  is_keepout: boolean;

  layer_v6: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer_v7: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  component: number;
  net: number;
  keepoutrestrictions: number;

  pos1: VECTOR2I;
  pos2: VECTOR2I;
  rotation: number;

  constructor(aReader: ALTIUM_BINARY_PARSER) {
    const recordtype = aReader.ReadUint8() as ALTIUM_RECORD;

    if (recordtype !== ALTIUM_RECORD.FILL) THROW_IO_ERROR('Fills6 stream has invalid recordtype');

    // Subrecord 1
    aReader.ReadAndSetSubrecordLength();

    this.layer_v6 = aReader.ReadUint8() as ALTIUM_LAYER;

    const flags1 = aReader.ReadUint8();
    this.is_locked = (flags1 & 0x04) === 0;

    const flags2 = aReader.ReadUint8();
    this.is_keepout = flags2 === 2;

    this.net = aReader.ReadUint16();
    aReader.Skip(2);
    this.component = aReader.ReadUint16();
    aReader.Skip(4);
    this.pos1 = aReader.ReadVector2IPos();
    this.pos2 = aReader.ReadVector2IPos();
    this.rotation = aReader.ReadDouble();

    const remaining = aReader.GetRemainingSubrecordBytes();

    if (remaining >= 9) {
      aReader.Skip(5);
      this.layer_v7 = aReader.ReadUint32() as ALTIUM_LAYER;
    }

    if (remaining >= 10) this.keepoutrestrictions = aReader.ReadUint8();
    else this.keepoutrestrictions = this.is_keepout ? 0x1f : 0;

    this.layer = altium_versioned_layer(this.layer_v6, this.layer_v7);

    aReader.SkipSubrecord();

    if (aReader.HasParsingError()) THROW_IO_ERROR('Fills6 stream was not parsed correctly');
  }
}

export class AREGION6 {
  is_locked: boolean;
  is_teardrop: boolean;
  is_keepout: boolean;

  is_shapebased: boolean;

  layer_v6: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer_v7: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  layer: ALTIUM_LAYER = ALTIUM_LAYER.UNKNOWN;
  net: number;
  component: number;
  polygon: number;
  subpolyindex: number;
  keepoutrestrictions: number;
  holecount: number;

  kind: ALTIUM_REGION_KIND; // I assume this means if normal or keepout?

  outline: ALTIUM_VERTICE[] = [];
  holes: ALTIUM_VERTICE[][] = [];

  constructor(aReader: ALTIUM_BINARY_PARSER, aExtendedVertices: boolean) {
    const recordtype = aReader.ReadUint8() as ALTIUM_RECORD;

    if (recordtype !== ALTIUM_RECORD.REGION)
      THROW_IO_ERROR('Regions6 stream has invalid recordtype');

    // Subrecord 1
    aReader.ReadAndSetSubrecordLength();

    this.layer_v6 = aReader.ReadUint8() as ALTIUM_LAYER;

    const flags1 = aReader.ReadUint8();
    this.is_locked = (flags1 & 0x04) === 0;
    this.is_teardrop = (flags1 & 0x10) !== 0;

    const flags2 = aReader.ReadUint8();
    this.is_keepout = flags2 === 2;

    this.net = aReader.ReadUint16();
    this.polygon = aReader.ReadUint16();
    this.component = aReader.ReadUint16();
    aReader.Skip(5);
    this.holecount = aReader.ReadUint16();
    aReader.Skip(2);

    const properties = aReader.ReadProperties();

    if (properties.size === 0) THROW_IO_ERROR('Regions6 stream has empty properties');

    this.layer_v7 = altium_layer_from_name(
      ALTIUM_PROPS_UTILS.ReadString(properties, 'V7_LAYER', ''),
    );

    const pkind = ALTIUM_PROPS_UTILS.ReadInt(properties, 'KIND', 0);
    const is_cutout = ALTIUM_PROPS_UTILS.ReadBool(properties, 'ISBOARDCUTOUT', false);

    this.is_shapebased = ALTIUM_PROPS_UTILS.ReadBool(properties, 'ISSHAPEBASED', false);
    this.keepoutrestrictions = u8(ALTIUM_PROPS_UTILS.ReadInt(properties, 'KEEPOUTRESTRIC', 0x1f));

    // TODO: this can differ from the other subpolyindex?!
    // Note: "the other subpolyindex" is "polygon"
    this.subpolyindex = u16(
      ALTIUM_PROPS_UTILS.ReadInt(properties, 'SUBPOLYINDEX', ALTIUM_POLYGON_NONE),
    );

    switch (pkind) {
      case 0:
        if (is_cutout) {
          this.kind = ALTIUM_REGION_KIND.BOARD_CUTOUT;
        } else {
          this.kind = ALTIUM_REGION_KIND.COPPER;
        }

        break;

      case 1:
        this.kind = ALTIUM_REGION_KIND.POLYGON_CUTOUT;
        break;

      case 2:
        this.kind = ALTIUM_REGION_KIND.DASHED_OUTLINE;
        break;

      case 3:
        this.kind = ALTIUM_REGION_KIND.UNKNOWN_3; // TODO: what kind is this?
        break;

      case 4:
        this.kind = ALTIUM_REGION_KIND.CAVITY_DEFINITION;
        break;

      default:
        this.kind = ALTIUM_REGION_KIND.UNKNOWN;
        break;
    }

    let num_outline_vertices = aReader.ReadUint32();

    if (aExtendedVertices) num_outline_vertices++; // Has a closing vertex

    // A short read leaves every later read at 0; stop there rather than loop out a garbage count
    // (the record throws below either way).
    for (let i = 0; i < num_outline_vertices && !aReader.HasParsingError(); i++) {
      if (aExtendedVertices) {
        const isRound = aReader.ReadUint8() !== 0;
        const position = aReader.ReadVector2IPos();
        const center = aReader.ReadVector2IPos();
        const radius = aReader.ReadKicadUnit();
        const angle1 = aReader.ReadDouble();
        const angle2 = aReader.ReadDouble();
        this.outline.push(new ALTIUM_VERTICE(isRound, radius, angle1, angle2, position, center));
      } else {
        // For some regions the coordinates are stored as double and not as int32_t
        const x = ALTIUM_PROPS_UTILS.ConvertToKicadUnit(aReader.ReadDouble());
        const y = ALTIUM_PROPS_UTILS.ConvertToKicadUnit(-aReader.ReadDouble());
        this.outline.push(new ALTIUM_VERTICE({ x, y }));
      }
    }

    this.holes = Array.from({ length: this.holecount }, () => []);
    for (let k = 0; k < this.holecount; k++) {
      const num_hole_vertices = aReader.ReadUint32();

      for (let i = 0; i < num_hole_vertices && !aReader.HasParsingError(); i++) {
        const x = ALTIUM_PROPS_UTILS.ConvertToKicadUnit(aReader.ReadDouble());
        const y = ALTIUM_PROPS_UTILS.ConvertToKicadUnit(-aReader.ReadDouble());
        this.holes[k]!.push(new ALTIUM_VERTICE({ x, y }));
      }
    }

    this.layer = altium_versioned_layer(this.layer_v6, this.layer_v7);

    aReader.SkipSubrecord();

    if (aReader.HasParsingError()) THROW_IO_ERROR('Regions6 stream was not parsed correctly');
  }
}
