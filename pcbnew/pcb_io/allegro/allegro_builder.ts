// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright Quilter and The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/allegro/allegro_builder.h` / `.cpp`: phase 2 of the Allegro
 * import - the BRD_DB the parser filled, turned into KiCad BOARD items.
 *
 * Where upstream iterates a `std::unordered_map` and the order reaches the
 * board (the layer mapper's class lists and named layers, `s_LayerKiMap`, the
 * dialog names, the collected copper fills), the map is common/libc's
 * STD_UNORDERED_MAP, which keeps libstdc++'s order; where it only looks keys
 * up, a JS Map. A `std::map< wxString, ... >` iterates in wxString order:
 * code points, compared as UTF-32.
 *
 * The C++ narrows freely - `scale( int )` called with a uint32_t or a
 * double - and each such call site says how it narrows (`| 0` for an
 * integer's wrap, `Math.trunc` for a double's).
 */
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { THROW_IO_ERROR } from '@ziroeda/common/exceptions.js';
import { GR_TEXT_H_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { GetPenSizeForNormal } from '@ziroeda/common/gr_text.js';
import {
  IsUserLayer,
  LayerName,
  MAX_USER_DEFINED_LAYERS,
  PCB_LAYER_ID,
  ToLAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { STD_UNORDERED_MAP, hashInt, hashWString } from '@ziroeda/common/libc/unordered_map.js';
import { LSET } from '@ziroeda/common/lset.js';
import { NETCLASS } from '@ziroeda/common/netclass.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/progress_reporter.js';
import {
  type Reporter,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/reporter.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import {
  ANGLE_0,
  ANGLE_180,
  ANGLE_360,
  ANGLE_90,
  EDA_ANGLE,
  EDA_ANGLE_T,
  FULL_CIRCLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { type POLYGON, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import {
  KIGEOM_MakeCrossSegments,
  KIGEOM_MakeRegularPolygonPoints,
} from '@ziroeda/kimath/src/geometry/shape_utils.js';
import { RECT_CHAMFER_ALL } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from '../../board.js';
import { ADD_MODE, type BOARD_ITEM_CONTAINER } from '../../board_item_container.js';
import type { BOARD_ITEM } from '../../board_item.js';
import { FOOTPRINT } from '../../footprint.js';
import { NETINFO_ITEM } from '../../netinfo_item.js';
import { NETINFO_LIST } from '../../netinfo_list.js';
import { PAD } from '../../pad.js';
import {
  PAD_ATTRIB,
  PAD_DRILL_SHAPE,
  PAD_SHAPE,
  PADSTACK,
  PADSTACK_COPPER_LAYER_PROPS,
  PADSTACK_MODE,
} from '../../padstack.js';
import { PCB_FIELD } from '../../pcb_field.js';
import { PCB_GROUP } from '../../pcb_group.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TEXT } from '../../pcb_text.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA } from '../../pcb_track.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ZONE } from '../../zone.js';
import { TEARDROP_TYPE } from '../../teardrop/teardrop_parameters.js';
import {
  ISLAND_REMOVAL_MODE,
  ZONE_BORDER_DISPLAY_STYLE,
  ZONE_FILL_MODE,
} from '../../zone_settings.js';
import { MergeZonesWithSameOutline } from '../../zone_utils.js';
import { ZONE_CONNECTION } from '../../zones.js';
import type {
  INPUT_LAYER_DESC,
  LAYER_MAPPING_HANDLER,
} from '../common/plugin_common_layer_mapping.js';
import { type BRD_DB, type VIEW_OBJS } from './convert/allegro_db.js';
import {
  BLK_0x01_ARC,
  type BLK_0x03_FIELD,
  type BLK_0x04_NET_ASSIGNMENT,
  type BLK_0x05_TRACK,
  type BLK_0x07_COMPONENT_INST,
  type BLK_0x0C_PIN_DEF,
  type BLK_0x0D_PAD,
  type BLK_0x0E_RECT,
  type BLK_0x14_GRAPHIC,
  type BLK_0x15_16_17_SEGMENT,
  type BLK_0x1B_NET,
  type BLK_0x1C_PADSTACK,
  type BLK_0x1D_CONSTRAINT_SET,
  type BLK_0x24_RECT,
  type BLK_0x26_MATCH_GROUP,
  type BLK_0x28_SHAPE,
  type BLK_0x2A_LAYER_LIST,
  type BLK_0x2B_FOOTPRINT_DEF,
  type BLK_0x2C_TABLE,
  type BLK_0x2D_FOOTPRINT_INST,
  type BLK_0x30_STR_WRAPPER,
  type BLK_0x31_SGRAPHIC,
  type BLK_0x32_PLACED_PAD,
  type BLK_0x33_VIA,
  type BLK_0x34_KEEPOUT,
  type BLK_0x36_DEF_TABLE,
  type BLK_0x37_PTR_ARRAY,
  type BLK_0x3C_KEY_LIST,
  type BLOCK,
  type BLOCK_BASE,
  BLOCK_TYPE,
  BOARD_UNITS,
  FIELD_KEYS,
  FMT_VER,
  FontDef_X08,
  HEADER_v16x,
  type LAYER_INFO,
  LAYER_CLASS,
  LAYER_COMP_SLOT,
  LAYER_SUBCLASS,
  type LINKED_LIST,
  MARKER_SHAPE,
  PADSTACK_COMPONENT_TYPE,
  PADSTACK_SLOTS,
  TABLE_SUBTYPE,
  TEXT_ALIGNMENT,
  TEXT_REVERSAL,
} from './convert/allegro_pcb_structs.js';

/** `%#010x`. */
const hex010 = (v: number): string =>
  v === 0 ? '0000000000' : `0x${v.toString(16).padStart(8, '0')}`;
/** `%#04x`. */
const hex04 = (v: number): string => (v === 0 ? '0000' : `0x${v.toString(16).padStart(2, '0')}`);

const trace = (..._aArgs: unknown[]): void => {
  // wxLogTrace( traceAllegroBuilder, ... ): off unless the trace mask is set.
};

/** `std::round`: halves away from zero. */
const stdRound = (v: number): number => (v < 0 ? -Math.round(-v) : Math.round(v));

/** A wxString `std::map` key order: code points, compared as UTF-32. */
function wxStringLess(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();

  for (;;) {
    const ca = ia.next();
    const cb = ib.next();

    if (ca.done) return cb.done ? 0 : -1;
    if (cb.done) return 1;

    const d = ca.value.codePointAt(0)! - cb.value.codePointAt(0)!;
    if (d !== 0) return d;
  }
}

/** `wxString::CmpNoCase( b ) == 0`. */
const eqNoCase = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const BlockDataAs = <T>(aBlock: BLOCK_BASE): T => (aBlock as BLOCK<T>).GetData();

/** `std::hash<LAYER_INFO>`: `( m_Class << 8 ) + m_Subclass`, which is also the map key here. */
const layerKey = (aInfo: LAYER_INFO): number => (aInfo.m_Class << 8) + aInfo.m_Subclass;
const layerFromKey = (aKey: number): LAYER_INFO => ({
  m_Class: aKey >> 8,
  m_Subclass: aKey & 0xff,
});
const hashLayerKey = (aKey: number): bigint => BigInt(aKey);

/**
 * Gets the next block in the linked list. Exactly which member does this depends on the block type.
 *
 * It's not yet clear if any blocks can be in multiple linked lists at once - for now just follow the "main"
 * one.
 */
function GetPrimaryNext(aBlock: BLOCK_BASE): number {
  switch (aBlock.GetBlockType()) {
    case 0x01:
    case 0x03:
    case 0x04:
    case 0x05:
    case 0x0e:
    case 0x14:
    case 0x15:
    case 0x16:
    case 0x17:
    case 0x1b:
    case 0x1d:
    case 0x1e:
    case 0x1f:
    case 0x2b:
    case 0x2d:
    case 0x2e:
    case 0x30:
    case 0x32:
    case 0x24:
    case 0x28:
    case 0x2c:
    case 0x33:
    case 0x36:
    case 0x37:
      return BlockDataAs<{ m_Next: number }>(aBlock).m_Next;
    case 0x31:
      return 0; // Doesn't exist
    default:
      return 0;
  }
}

/**
 * "Get Next" function for the pad list in a footprint's 0x32 list.
 */
function PadGetNextInFootprint(aBlock: BLOCK_BASE): number {
  const type = aBlock.GetBlockType();

  if (type !== 0x32) {
    THROW_IO_ERROR(
      `Unexpected next item in 0x32 pad list: block type ${hex04(type)}, offset 0x${aBlock.GetOffset().toString(16)}, key ${hex010(aBlock.GetKey())}`,
    );
  }

  // When iterating in a footprint use this field, not m_Next.
  return BlockDataAs<BLK_0x32_PLACED_PAD>(aBlock).m_NextInFp;
}

type NEXT_FUNC_T = (aBlock: BLOCK_BASE) => number;

/** `LL_WALKER`: follows a block chain from a head key to a tail key. */
class LL_WALKER implements Iterable<BLOCK_BASE> {
  private readonly m_head: number;
  private readonly m_tail: number;
  private readonly m_board: BRD_DB;
  // This is the function that can get the next item in a list. By default
  private m_nextFunction: NEXT_FUNC_T = GetPrimaryNext;

  constructor(aHead: number, aTail: number, aBoard: BRD_DB);
  constructor(aList: LINKED_LIST, aBoard: BRD_DB);
  constructor(a: number | LINKED_LIST, b: number | BRD_DB, c?: BRD_DB) {
    if (typeof a === 'number') {
      this.m_head = a;
      this.m_tail = b as number;
      this.m_board = c!;
    } else {
      this.m_head = a.m_Head;
      this.m_tail = a.m_Tail;
      this.m_board = b as BRD_DB;
    }
  }

  SetNextFunc(aNextFunc: NEXT_FUNC_T): void {
    this.m_nextFunction = aNextFunc;
  }

  *[Symbol.iterator](): Iterator<BLOCK_BASE> {
    // iterator( m_head, ... ): an unresolvable head is the end
    let current = this.m_head;
    let currBlock = this.m_board.GetObjectByKey(current);

    if (!currBlock) current = 0;

    // `it != end()` compares m_current against end()'s 0
    while (current !== 0) {
      yield currBlock!;

      // operator++
      if (current === this.m_tail || !currBlock) {
        current = 0;
      } else {
        current = this.m_nextFunction(currBlock);

        if (current === this.m_tail || this.m_board.IsSentinel(current)) {
          current = 0;
        } else {
          currBlock = this.m_board.GetObjectByKey(current);

          if (currBlock === null) current = 0;
        }
      }
    }
  }
}

const L = (c: number, s: number): number => layerKey({ m_Class: c, m_Subclass: s });
const C = LAYER_CLASS;
const S = LAYER_SUBCLASS;

/**
 * Map of the pre-set class:subclass pairs to standard layers.
 *
 * Allegro doesn't really have a neat mapping onto KiCad layers. In theory, we could use the Films to
 * map things that actually end up on the silkscreen layer (films can pick things out by class:subclass),
 * but that would be quite fiddly and would fail if the films weren't configured right.
 */
const s_LayerKiMap = new STD_UNORDERED_MAP<PCB_LAYER_ID, number>(hashLayerKey);

for (const [k, v] of [
  [L(C.BOARD_GEOMETRY, S.BGEOM_OUTLINE), PCB_LAYER_ID.Edge_Cuts],
  [L(C.BOARD_GEOMETRY, S.BGEOM_DESIGN_OUTLINE), PCB_LAYER_ID.Edge_Cuts],
  [L(C.BOARD_GEOMETRY, S.BGEOM_SILKSCREEN_TOP), PCB_LAYER_ID.F_SilkS],
  [L(C.BOARD_GEOMETRY, S.BGEOM_SILKSCREEN_BOTTOM), PCB_LAYER_ID.B_SilkS],
  [L(C.BOARD_GEOMETRY, S.BGEOM_SOLDERMASK_TOP), PCB_LAYER_ID.F_Mask],
  [L(C.BOARD_GEOMETRY, S.BGEOM_SOLDERMASK_BOTTOM), PCB_LAYER_ID.B_Mask],

  [L(C.COMPONENT_VALUE, S.ASSEMBLY_BOTTOM), PCB_LAYER_ID.B_Fab],
  [L(C.COMPONENT_VALUE, S.ASSEMBLY_TOP), PCB_LAYER_ID.F_Fab],

  [L(C.DEVICE_TYPE, S.ASSEMBLY_BOTTOM), PCB_LAYER_ID.B_Fab],
  [L(C.DEVICE_TYPE, S.ASSEMBLY_TOP), PCB_LAYER_ID.F_Fab],

  [L(C.PACKAGE_GEOMETRY, S.PGEOM_SILKSCREEN_BOTTOM), PCB_LAYER_ID.B_SilkS],
  [L(C.PACKAGE_GEOMETRY, S.PGEOM_SILKSCREEN_TOP), PCB_LAYER_ID.F_SilkS],
  [L(C.PACKAGE_GEOMETRY, S.PGEOM_ASSEMBLY_BOTTOM), PCB_LAYER_ID.B_Fab],
  [L(C.PACKAGE_GEOMETRY, S.PGEOM_ASSEMBLY_TOP), PCB_LAYER_ID.F_Fab],
  [L(C.PACKAGE_GEOMETRY, S.PGEOM_PLACE_BOUND_BOTTOM), PCB_LAYER_ID.B_CrtYd],
  [L(C.PACKAGE_GEOMETRY, S.PGEOM_PLACE_BOUND_TOP), PCB_LAYER_ID.F_CrtYd],
  [L(C.PACKAGE_GEOMETRY, S.PGEOM_PASTEMASK_BOTTOM), PCB_LAYER_ID.B_Paste],
  [L(C.PACKAGE_GEOMETRY, S.PGEOM_PASTEMASK_TOP), PCB_LAYER_ID.F_Paste],

  [L(C.REF_DES, S.SILKSCREEN_BOTTOM), PCB_LAYER_ID.B_SilkS],
  [L(C.REF_DES, S.SILKSCREEN_TOP), PCB_LAYER_ID.F_SilkS],
  [L(C.REF_DES, S.ASSEMBLY_BOTTOM), PCB_LAYER_ID.B_Fab],
  [L(C.REF_DES, S.ASSEMBLY_TOP), PCB_LAYER_ID.F_Fab],

  [L(C.MANUFACTURING, S.MFR_AUTOSILK_BOTTOM), PCB_LAYER_ID.B_SilkS],
  [L(C.MANUFACTURING, S.MFR_AUTOSILK_TOP), PCB_LAYER_ID.F_SilkS],
] as const)
  s_LayerKiMap.emplace(k, v);

/**
 * Names for custom KiCad layers that correspond to pre-defined Allegro layers.
 *
 * Multiple class:subclasses can share a layer name, in which case, they will share a layer.
 *
 * This is a balance between running out of layers and dumping too much unrelated stuff on the same layer.
 */
const s_OptionalFixedMappings = new Map<number, string>([
  [L(C.PACKAGE_GEOMETRY, S.PGEOM_DISPLAY_TOP), 'DISPLAY_TOP'],
  [L(C.PACKAGE_GEOMETRY, S.PGEOM_DISPLAY_BOTTOM), 'DISPLAY_BOTTOM'],
  [L(C.PACKAGE_GEOMETRY, S.PGEOM_BODY_CENTER), 'BODY_CENTER'],

  [L(C.BOARD_GEOMETRY, S.BGEOM_DIMENSION), 'DIMENSION'],

  [L(C.DRAWING_FORMAT, S.DFMT_OUTLINE), 'PAGE_OUTLINE'],

  [L(C.COMPONENT_VALUE, S.DISPLAY_BOTTOM), 'DISPLAY_BOTTOM'],
  [L(C.COMPONENT_VALUE, S.DISPLAY_TOP), 'DISPLAY_TOP'],
  [L(C.COMPONENT_VALUE, S.SILKSCREEN_BOTTOM), 'COMPVAL_TYPE_BOTTOM'],
  [L(C.COMPONENT_VALUE, S.SILKSCREEN_TOP), 'COMPVAL_TYPE_TOP'],

  [L(C.DEVICE_TYPE, S.DISPLAY_BOTTOM), 'DISPLAY_BOTTOM'],
  [L(C.DEVICE_TYPE, S.DISPLAY_TOP), 'DISPLAY_TOP'],
  [L(C.DEVICE_TYPE, S.SILKSCREEN_BOTTOM), 'DEVICE_TYPE_BOTTOM'],
  [L(C.DEVICE_TYPE, S.SILKSCREEN_TOP), 'DEVICE_TYPE_TOP'],

  [L(C.TOLERANCE, S.DISPLAY_BOTTOM), 'DISPLAY_BOTTOM'],
  [L(C.TOLERANCE, S.DISPLAY_TOP), 'DISPLAY_TOP'],
  [L(C.TOLERANCE, S.SILKSCREEN_BOTTOM), 'TOLERANCE_BOTTOM'],
  [L(C.TOLERANCE, S.SILKSCREEN_TOP), 'TOLERANCE_TOP'],

  [L(C.USER_PART_NUMBER, S.DISPLAY_BOTTOM), 'DISPLAY_BOTTOM'],
  [L(C.USER_PART_NUMBER, S.DISPLAY_TOP), 'DISPLAY_TOP'],
  [L(C.USER_PART_NUMBER, S.SILKSCREEN_BOTTOM), 'USER_PART_NUM_BOTTOM'],
  [L(C.USER_PART_NUMBER, S.SILKSCREEN_TOP), 'USER_PART_NUM_TOP'],

  [L(C.MANUFACTURING, S.MFR_XSECTION_CHART), 'XSECTION_CHART'],
]);

const s_ClassNames = new Map<number, string>([
  [C.BOARD_GEOMETRY, 'Board Geometry'],
  [C.COMPONENT_VALUE, 'Component Value'],
  [C.DEVICE_TYPE, 'Device Type'],
  [C.DRAWING_FORMAT, 'Drawing Format'],
  [C.ETCH, 'Etch'],
  [C.MANUFACTURING, 'Manufacturing'],
  [C.PACKAGE_GEOMETRY, 'Package Geometry'],
  [C.PACKAGE_KEEPIN, 'Package Keepin'],
  [C.PACKAGE_KEEPOUT, 'Package Keepout'],
  [C.PIN, 'Pin'],
  [C.REF_DES, 'Ref Des'],
  [C.ROUTE_KEEPIN, 'Route Keepin'],
  [C.ROUTE_KEEPOUT, 'Route Keepout'],
  [C.TOLERANCE, 'Tolerance'],
  [C.USER_PART_NUMBER, 'User Part Number'],
  [C.VIA_CLASS, 'Via Class'],
  [C.VIA_KEEPOUT, 'Via Keepout'],
  [C.ANTI_ETCH, 'Anti Etch'],
  [C.BOUNDARY, 'Boundary'],
  [C.CONSTRAINTS_REGION, 'Constraints Region'],
]);

const s_BoardGeomSubclassNames = new Map<number, string>([
  [S.BGEOM_OUTLINE, 'Outline'],
  [S.BGEOM_CONSTRAINT_AREA, 'Constraint Area'],
  [S.BGEOM_OFF_GRID_AREA, 'Off Grid Area'],
  [S.BGEOM_SOLDERMASK_BOTTOM, 'Soldermask Bottom'],
  [S.BGEOM_SOLDERMASK_TOP, 'Soldermask Top'],
  [S.BGEOM_ASSEMBLY_DETAIL, 'Assembly Detail'],
  [S.BGEOM_SILKSCREEN_BOTTOM, 'Silkscreen Bottom'],
  [S.BGEOM_SILKSCREEN_TOP, 'Silkscreen Top'],
  [S.BGEOM_SWITCH_AREA_BOTTOM, 'Switch Area Bottom'],
  [S.BGEOM_SWITCH_AREA_TOP, 'Switch Area Top'],
  [S.BGEOM_BOTH_ROOMS, 'Both Rooms'],
  [S.BGEOM_BOTTOM_ROOM, 'Bottom Room'],
  [S.BGEOM_TOP_ROOM, 'Top Room'],
  [S.BGEOM_PLACE_GRID_BOTTOM, 'Place Grid Bottom'],
  [S.BGEOM_PLACE_GRID_TOP, 'Place Grid Top'],
  [S.BGEOM_DIMENSION, 'Dimension'],
  [S.BGEOM_TOOLING_CORNERS, 'Tooling Corners'],
  [S.BGEOM_ASSEMBLY_NOTES, 'Assembly Notes'],
  [S.BGEOM_PLATING_BAR, 'Plating Bar'],
  [S.BGEOM_DESIGN_OUTLINE, 'Design Outline'],
]);

const s_ComponentValueSubclassNames = new Map<number, string>([
  [S.DISPLAY_BOTTOM, 'Display Bottom'],
  [S.DISPLAY_TOP, 'Display Top'],
  [S.SILKSCREEN_BOTTOM, 'Silkscreen Bottom'],
  [S.SILKSCREEN_TOP, 'Silkscreen Top'],
  [S.ASSEMBLY_BOTTOM, 'Assembly Bottom'],
  [S.ASSEMBLY_TOP, 'Assembly Top'],
]);

const s_DrawingFormatSubclassNames = new Map<number, string>([
  [S.DFMT_REVISION_DATA, 'Revision Data'],
  [S.DFMT_REVISION_BLOCK, 'Revision Block'],
  [S.DFMT_TITLE_DATA, 'Title Data'],
  [S.DFMT_TITLE_BLOCK, 'Title Block'],
  [S.DFMT_OUTLINE, 'Outline'],
]);

const s_PackageGeometrySubclassNames = new Map<number, string>([
  [S.PGEOM_PASTEMASK_BOTTOM, 'Pastemask Bottom'],
  [S.PGEOM_PASTEMASK_TOP, 'Pastemask Top'],
  [S.PGEOM_DFA_BOUND_BOTTOM, 'DFA Bound Bottom'],
  [S.PGEOM_DFA_BOUND_TOP, 'DFA Bound Top'],
  [S.PGEOM_DISPLAY_BOTTOM, 'Display Bottom'],
  [S.PGEOM_DISPLAY_TOP, 'Display Top'],
  [S.PGEOM_SOLDERMASK_BOTTOM, 'Soldermask Bottom'],
  [S.PGEOM_SOLDERMASK_TOP, 'Soldermask Top'],
  [S.PGEOM_BODY_CENTER, 'Body Center'],
  [S.PGEOM_SILKSCREEN_BOTTOM, 'Silkscreen Bottom'],
  [S.PGEOM_SILKSCREEN_TOP, 'Silkscreen Top'],
  [S.PGEOM_PAD_STACK_NAME, 'Pad Stack Name'],
  [S.PGEOM_PIN_NUMBER, 'Pin Number'],
  [S.PGEOM_PLACE_BOUND_BOTTOM, 'Place Bound Bottom'],
  [S.PGEOM_PLACE_BOUND_TOP, 'Place Bound Top'],
  [S.PGEOM_ASSEMBLY_BOTTOM, 'Assembly Bottom'],
  [S.PGEOM_ASSEMBLY_TOP, 'Assembly Top'],
]);

const s_ManufacturingSubclassNames = new Map<number, string>([
  [S.MFR_XSECTION_CHART, 'X-Section Chart'],
  [S.MFR_NO_PROBE_BOTTOM, 'No Probe Bottom'],
  [S.MFR_NO_PROBE_TOP, 'No Probe Top'],
  [S.MFR_AUTOSILK_BOTTOM, 'AutoSilk Bottom'],
  [S.MFR_AUTOSILK_TOP, 'AutoSilk Top'],
  [S.MFR_PROBE_BOTTOM, 'Probe Bottom'],
  [S.MFR_PROBE_TOP, 'Probe Top'],
  [S.MFR_NCDRILL_FIGURE, 'NC Drill Figure'],
  [S.MFR_NCDRILL_LEGEND, 'NC Drill Legend'],
  [S.MFR_NO_GLOSS_INTERNAL, 'No Gloss Internal'],
  [S.MFR_NO_GLOSS_BOTTOM, 'No Gloss Bottom'],
  [S.MFR_NO_GLOSS_TOP, 'No Gloss Top'],
  [S.MFR_NO_GLOSS_ALL, 'No Gloss All'],
  [S.MFR_PHOTOPLOT_OUTLINE, 'Photoplot Outline'],
]);

const s_AnalysisSubclassNames = new Map<number, string>([
  [S.ANALYSIS_PCB_TEMPERATURE, 'PCB Temperature'],
  [S.ANALYSIS_HIGH_ISOCONTOUR, 'High IsoContour'],
  [S.ANALYSIS_MEDIUM3_ISOCONTOUR, 'Medium3 IsoContour'],
  [S.ANALYSIS_MEDIUM2_ISOCONTOUR, 'Medium2 IsoContour'],
  [S.ANALYSIS_MEDIUM1_ISOCONTOUR, 'Medium1 IsoContour'],
  [S.ANALYSIS_LOW_ISOCONTOUR, 'Low IsoContour'],
]);

const s_ConstraintSubclassNames = new Map<number, string>([[S.CREG_ALL, 'All']]);

const s_KeepinSubclassNames = new Map<number, string>([[S.KEEPIN_ALL, 'All']]);

const s_KeepoutSubclassNames = new Map<number, string>([
  [S.KEEPOUT_ALL, 'All'],
  [S.KEEPOUT_TOP, 'Top'],
  [S.KEEPOUT_BOTTOM, 'Bottom'],
]);

const s_SubclassNameMaps = new Map<number, Map<number, string>>([
  [C.BOARD_GEOMETRY, s_BoardGeomSubclassNames],

  // These classes all share the same subclass names
  [C.COMPONENT_VALUE, s_ComponentValueSubclassNames],
  [C.DEVICE_TYPE, s_ComponentValueSubclassNames],
  [C.REF_DES, s_ComponentValueSubclassNames],
  [C.TOLERANCE, s_ComponentValueSubclassNames],
  [C.USER_PART_NUMBER, s_ComponentValueSubclassNames],

  [C.DRAWING_FORMAT, s_DrawingFormatSubclassNames],
  [C.PACKAGE_GEOMETRY, s_PackageGeometrySubclassNames],
  [C.MANUFACTURING, s_ManufacturingSubclassNames],
  [C.ANALYSIS, s_AnalysisSubclassNames],
  [C.CONSTRAINTS_REGION, s_ConstraintSubclassNames],
  [C.PACKAGE_KEEPIN, s_KeepinSubclassNames],
  [C.PACKAGE_KEEPOUT, s_KeepoutSubclassNames],
  [C.ROUTE_KEEPIN, s_KeepinSubclassNames],
  [C.ROUTE_KEEPOUT, s_KeepoutSubclassNames],
  [C.VIA_KEEPOUT, s_KeepoutSubclassNames],
]);

/** `%02X`. */
const hex2u = (v: number): string => v.toString(16).toUpperCase().padStart(2, '0');

/**
 * Build a unique display name for a LAYER_INFO entry from the static maps above,
 * suitable for presentation in the layer mapping dialog.
 *
 * Refer to https://www.artwork.com/all2dxf/alleggeo.htm for layer orders.
 */
function layerInfoDisplayName(aLayerInfo: LAYER_INFO): string {
  const className = s_ClassNames.get(aLayerInfo.m_Class) ?? `Class_${hex2u(aLayerInfo.m_Class)}`;

  let subclassName: string;

  // Find the right subclass name map for this class
  const subclassMap = s_SubclassNameMaps.get(aLayerInfo.m_Class);

  if (subclassMap) {
    // This subclass seems not to have a known name
    subclassName =
      subclassMap.get(aLayerInfo.m_Subclass) ?? `Subclass_${hex2u(aLayerInfo.m_Subclass)}`;
  } else {
    // Don't have a specific map for this class, just do a generic one.
    subclassName = `Subclass_${hex2u(aLayerInfo.m_Subclass)}`;
  }

  return `${className}/${subclassName}`;
}

/**
 * Some layers map to KiCad rule areas (zones) - for example a package keepout
 * on ALL maps to a rule area in KiCad.
 *
 * Keepins are bit trickier, but they're still rule areas and might need
 * custom DRC rules.
 *
 * In Allegro, zone-y/shape-y is distinguished by class/subclass rather than object type.
 */
function layerIsZone(aLayerInfo: LAYER_INFO): boolean {
  return (
    aLayerInfo.m_Class === C.CONSTRAINTS_REGION ||
    aLayerInfo.m_Class === C.BOUNDARY ||
    aLayerInfo.m_Class === C.PACKAGE_KEEPIN ||
    aLayerInfo.m_Class === C.ROUTE_KEEPIN ||
    aLayerInfo.m_Class === C.PACKAGE_KEEPOUT ||
    aLayerInfo.m_Class === C.ROUTE_KEEPOUT ||
    aLayerInfo.m_Class === C.VIA_KEEPOUT
  );
}

/**
 * Some blocks report layer info - if they do, return it else std::nullopt
 */
function tryLayerFromBlock(aBlock: BLOCK_BASE): LAYER_INFO | null {
  switch (aBlock.GetBlockType()) {
    case 0x0e:
      return BlockDataAs<BLK_0x0E_RECT>(aBlock).m_Layer;
    case 0x14:
      return BlockDataAs<BLK_0x14_GRAPHIC>(aBlock).m_Layer;
    case 0x24:
      return BlockDataAs<BLK_0x24_RECT>(aBlock).m_Layer;
    case 0x28:
      return BlockDataAs<BLK_0x28_SHAPE>(aBlock).m_Layer;
  }

  return null;
}

/**
 * Get a layer from a block that has layer info.
 *
 * It's an error to request this from a block that doesn't support it.
 */
function expectLayerFromBlock(aBlock: BLOCK_BASE): LAYER_INFO {
  // Programming error - should only call this function if we're sure the block has layer info
  return tryLayerFromBlock(aBlock) ?? { m_Class: 0, m_Subclass: 0 };
}

/**
 * Represents the information found in a single entry of a layer list.
 *
 * Will eventually become a KiCad layer.
 */
interface CUSTOM_LAYER {
  m_Name: string;
}

/**
 * Class to handle the mapping for Allegro CLASS/SUBCLASS idiom to KiCad layers.
 */
class LAYER_MAPPER {
  // Map of original layer list - we use this to store the CUSTOM_LAYERs, as well
  // as check that we only handle each one once
  private m_Lists = new Map<BLK_0x2A_LAYER_LIST, CUSTOM_LAYER[]>();

  // Which classes point to which layer lists (more than one class can point to one list.
  private m_ClassCustomLayerLists = new STD_UNORDERED_MAP<CUSTOM_LAYER[] | null, number>(hashInt);

  /**
   * The main map from CLASS:SUBCLASS custom mappings to KiCadLayers
   *
   * This doesn't cover all the fixed layers, just created custom ones,
   * including the copper layers.
   */
  private m_customLayerToKiMap = new Map<number, PCB_LAYER_ID>();

  /**
   * This is a map of optional, Allegro layers that we have mapped to KiCad layers with given names.
   *
   * This is done by name, because multiple class:subclass pairs may share the same name.
   */
  private m_MappedOptionalLayers = new STD_UNORDERED_MAP<PCB_LAYER_ID, string>(hashWString);

  /**
   * Overrides for the static s_LayerKiMap entries, populated by the layer mapping handler.
   */
  private m_staticLayerOverrides = new Map<number, PCB_LAYER_ID>();

  /**
   * Names used in the layer mapping dialog for custom (non-ETCH, non-static) layers.
   * Populated during FinalizeLayers(), consumed when applying the handler result.
   */
  private m_customLayerDialogNames = new STD_UNORDERED_MAP<string, number>(hashLayerKey);

  /**
   * A record of what we _failed_ to map.
   */
  private m_unknownLayers = new Map<number, number>();

  private m_numUserLayersUsed = 0;

  // The layer to use for mapping failures;
  private readonly m_unmappedLayer = PCB_LAYER_ID.Cmts_User;

  constructor(
    private readonly m_brdDb: BRD_DB,
    private readonly m_board: BOARD,
    private readonly m_layerMappingHandler: LAYER_MAPPING_HANDLER,
  ) {}

  ProcessLayerList(aClass: number, aList: BLK_0x2A_LAYER_LIST): void {
    // If we haven't seen this list yet, create and store the CUSTOM_LAYER list
    if (!this.m_Lists.has(aList)) {
      const classLayers: CUSTOM_LAYER[] = [];
      this.m_Lists.set(aList, classLayers);

      if (aList.m_RefEntries.has_value()) {
        for (const entry of aList.m_RefEntries.value())
          classLayers.push({ m_Name: this.m_brdDb.GetString(entry.mLayerNameId) });
      } else if (aList.m_NonRefEntries.has_value()) {
        for (const entry of aList.m_NonRefEntries.value())
          classLayers.push({ m_Name: entry.m_Name });
      } else {
        // Presumably a parsing error.
        THROW_IO_ERROR('No ETCH layer list found.');
      }

      trace('Added layers for class', classLayers.length, aClass, aList.m_Key);
    }

    // Store the class ID -> 0x2A mapping
    this.m_ClassCustomLayerLists.set(aClass, this.m_Lists.get(aList)!);
  }

  /**
   * Called after all the custom layers are loaded.
   *
   * Finalises things like layer counts and stores into the board
   */
  FinalizeLayers(): void {
    const etchLayers = this.m_ClassCustomLayerLists.get(C.ETCH);

    if (!etchLayers) {
      trace('No ETCH layer class found; cannot finalize layers');
      return;
    }

    const numCuLayers = etchLayers.length;

    this.m_board.GetDesignSettings().SetCopperLayerCount(numCuLayers);

    const inputLayers: INPUT_LAYER_DESC[] = [];

    for (let li = 0; li < numCuLayers; ++li) {
      inputLayers.push({
        Name: etchLayers[li]!.m_Name,
        AutoMapLayer: LAYER_MAPPER.getNthCopperLayer(li, numCuLayers),
        PermittedLayers: LSET.AllCuMask(),
        Required: true,
      });
    }

    // Add non-ETCH custom layers so they appear in the layer mapping dialog
    // `m_ClassCustomLayerLists[ETCH]`: operator[], which is there (checked above)
    const etchList = this.m_ClassCustomLayerLists.getOrInsert(C.ETCH, () => null);
    let nextAutoUser = 0;

    for (const [classId, layerList] of this.m_ClassCustomLayerLists) {
      if (classId === C.ETCH || layerList === etchList) continue;

      for (let si = 0; si < layerList!.length; ++si) {
        const li = layerKey({ m_Class: classId, m_Subclass: si & 0xff });

        // Skip entries already covered by s_LayerKiMap
        if (s_LayerKiMap.has(li)) continue;

        let name = layerInfoDisplayName(layerFromKey(li));

        if (layerList![si]!.m_Name.length > 0) name = layerList![si]!.m_Name;

        inputLayers.push({
          Name: name,
          AutoMapLayer: LAYER_MAPPER.getNthUserLayer(nextAutoUser++),
          PermittedLayers: LSET.AllLayersMask(),
          Required: false,
        });

        this.m_customLayerDialogNames.set(li, name);
      }
    }

    // The layers that maybe lump together multiple Allegro class:subclasses
    // into a single, named, KiCad layer
    for (const [layerName, kiLayer] of this.m_MappedOptionalLayers) {
      inputLayers.push({
        Name: layerName,
        AutoMapLayer: kiLayer,
        PermittedLayers: LSET.AllLayersMask(),
        Required: false,
      });
    }

    for (const [layerInfo, kiLayer] of s_LayerKiMap) {
      inputLayers.push({
        Name: layerInfoDisplayName(layerFromKey(layerInfo)),
        AutoMapLayer: kiLayer,
        PermittedLayers: LSET.AllLayersMask(),
        Required: false,
      });
    }

    // std::map<wxString, PCB_LAYER_ID>: iterated in key order below
    const resolvedMapping = this.m_layerMappingHandler(inputLayers);

    // Apply copper layer mapping
    for (let li = 0; li < numCuLayers; ++li) {
      const layerInfo = layerKey({ m_Class: C.ETCH, m_Subclass: li & 0xff });
      const layerName = etchLayers[li]!.m_Name;

      const lId = resolvedMapping.get(layerName) ?? LAYER_MAPPER.getNthCopperLayer(li, numCuLayers);

      this.m_customLayerToKiMap.set(layerInfo, lId);
      this.m_board.SetLayerName(lId, layerName);
    }

    // Apply non-copper static layer mapping from the handler result
    for (const [layerInfo] of s_LayerKiMap) {
      const displayName = layerInfoDisplayName(layerFromKey(layerInfo));

      const rm = resolvedMapping.get(displayName);

      if (rm !== undefined && rm !== PCB_LAYER_ID.UNDEFINED_LAYER)
        this.m_staticLayerOverrides.set(layerInfo, rm);
    }

    // Apply custom layer mapping from the handler result
    for (const [layerInfo, dialogName] of this.m_customLayerDialogNames) {
      const rm = resolvedMapping.get(dialogName);

      if (rm !== undefined && rm !== PCB_LAYER_ID.UNDEFINED_LAYER) {
        this.m_customLayerToKiMap.set(layerInfo, rm);
        this.m_board.SetLayerName(rm, dialogName);
      }
    }

    // Enable all the layers we ended up mapping to
    // `LSET enabledLayersMask = m_board.GetEnabledLayers()`: a copy - the layers are enabled
    // only at SetEnabledLayers below, so SetLayerName in this loop refuses the ones not yet on
    const enabledLayersMask = new LSET(this.m_board.GetEnabledLayers());
    let userLayers = 0;
    for (const name of [...resolvedMapping.keys()].sort(wxStringLess)) {
      const layerId = resolvedMapping.get(name)!;

      if (layerId !== PCB_LAYER_ID.UNDEFINED_LAYER) enabledLayersMask.orAssign(new LSET([layerId]));

      if (IsUserLayer(layerId)) userLayers++;

      this.m_board.SetLayerName(layerId, name);
    }
    this.m_board.SetEnabledLayers(enabledLayersMask);
    trace('After mapping, there are user layers', userLayers);
    this.m_board.GetDesignSettings().SetUserDefinedLayerCount(userLayers);
  }

  GetLayer(aLayerInfo: LAYER_INFO): PCB_LAYER_ID {
    const key = layerKey(aLayerInfo);

    // We already mapped and created the layer
    const mapped = this.m_customLayerToKiMap.get(key);
    if (mapped !== undefined) return mapped;

    // Check for user-remapped static layers first
    const override = this.m_staticLayerOverrides.get(key);
    if (override !== undefined) return override;

    // Next, have a look and see if the class:subclass was recorded as a custom layer
    if (this.m_ClassCustomLayerLists.has(aLayerInfo.m_Class)) {
      const cLayerList = this.m_ClassCustomLayerLists.get(aLayerInfo.m_Class)!;

      // If it is using the copper layer list and the subclass is within the
      // copper layer range, return the mapped copper layer. Non-ETCH classes
      // can share the same layer list pointer, but their subclass values may
      // exceed the copper layer count and must fall through to the custom
      // layer mapping below.
      if (
        this.m_ClassCustomLayerLists.has(C.ETCH) &&
        cLayerList === this.m_ClassCustomLayerLists.get(C.ETCH) &&
        aLayerInfo.m_Subclass < cLayerList!.length
      ) {
        const cuLayer = LAYER_MAPPER.getNthCopperLayer(aLayerInfo.m_Subclass, cLayerList!.length);
        // Remember this mapping
        this.m_customLayerToKiMap.set(key, cuLayer);
        return cuLayer;
      }

      if (aLayerInfo.m_Subclass < cLayerList!.length) {
        // This subclass maps to a custom layer in this class
        const cLayer = cLayerList![aLayerInfo.m_Subclass]!;
        return this.MapCustomLayer(aLayerInfo, cLayer.m_Name);
      }
    }

    // Now, there may be layers that map to custom layers in KiCad, but are fixed in Allegro
    // (perhaps, DFA_BOUND_TOP), which means we won't find them in the layer lists.
    // We add them if we encounter them, with the names defined.
    const fixedName = s_OptionalFixedMappings.get(key);
    if (fixedName !== undefined) return this.MapCustomLayer(aLayerInfo, fixedName);

    // Finally, fallback to the static mapping for any layers we haven't got a custom map for
    // We do this last so that it can be overridden for example if we want to remap
    // OUTLINE and DESIGN_OUTLINE to different layers.
    const fixed = s_LayerKiMap.get(key);
    if (fixed !== undefined) return fixed;

    // Keep a record of what we failed to map
    if (!this.m_unknownLayers.has(key)) {
      trace('Failed to map class:subclass to layer', aLayerInfo.m_Class, aLayerInfo.m_Subclass);
      this.m_unknownLayers.set(key, 1);
    }
    this.m_unknownLayers.set(key, this.m_unknownLayers.get(key)! + 1);

    // Dump everything else here
    return this.m_unmappedLayer;
  }

  /**
   * Return whether this layer ID is something we mapped to, or the catch-all unmapped layer.
   */
  IsLayerMapped(aLayerId: PCB_LAYER_ID): boolean {
    return aLayerId !== this.m_unmappedLayer;
  }

  /**
   * Allegro puts more graphics than just the polygon on PBT/B, but we don't want to always make a static
   * mapping, because some things on PBT/B _do_ belong to the courtyard layer in KiCad (polygons).
   *
   * Use this function to create/choose a user layer instead.
   */
  GetPlaceBounds(aTop: boolean): PCB_LAYER_ID {
    return this.mapCustomLayerByName(aTop ? 'PLACE_BOUND_TOP' : 'PLACE_BOUND_BOTTOM');
  }

  /**
   * Resolve the subclass name for a given class:subclass pair using the
   * per-class custom layer list. Returns empty string if not found.
   */
  IsOutlineLayer(aLayerInfo: LAYER_INFO): boolean {
    if (aLayerInfo.m_Class !== C.BOARD_GEOMETRY && aLayerInfo.m_Class !== C.DRAWING_FORMAT)
      return false;

    return aLayerInfo.m_Subclass === S.DFMT_OUTLINE || aLayerInfo.m_Subclass === S.BGEOM_OUTLINE;
  }

  /**
   * Record a specific class:subclass layer as mapping to some KiCad user layer, with a given name
   *
   * Usually, you don't need this as they are registered as needed based on layers found in the board,
   * but sometimes you need to override the default mapping, say when you detect that the
   * "lumped" layers need to be split.
   */
  MapCustomLayer(aLayerInfo: LAYER_INFO, aLayerName: string): PCB_LAYER_ID {
    const key = layerKey(aLayerInfo);

    // See if we have mapped this layer name under a different class:subclass
    if (this.m_MappedOptionalLayers.has(aLayerName)) {
      const existingLId = this.m_MappedOptionalLayers.get(aLayerName)!;
      // Record the reuse
      this.m_customLayerToKiMap.set(key, existingLId);
      return existingLId;
    }

    // First time we needed this name:
    // Add as a user layer and store for next time
    const lId = this.addUserLayer(aLayerName);
    this.m_customLayerToKiMap.set(key, lId);
    this.m_MappedOptionalLayers.set(aLayerName, lId);

    trace('Adding mapping', aLayerInfo.m_Class, aLayerInfo.m_Subclass, aLayerName);
    return lId;
  }

  GetRuleAreaLayers(aLayerInfo: LAYER_INFO): LSET {
    let layerSet = new LSET();

    switch (aLayerInfo.m_Class) {
      case C.ROUTE_KEEPOUT:
      case C.VIA_KEEPOUT:
      case C.PACKAGE_KEEPOUT: {
        switch (aLayerInfo.m_Subclass) {
          case S.KEEPOUT_ALL:
            layerSet = LSET.AllCuMask();
            break;
          case S.KEEPOUT_TOP:
            layerSet = new LSET([PCB_LAYER_ID.F_Cu]);
            break;
          case S.KEEPOUT_BOTTOM:
            layerSet = new LSET([PCB_LAYER_ID.B_Cu]);
            break;
          default:
            layerSet = new LSET([this.GetLayer(aLayerInfo)]);
            break;
        }
        break;
      }
      case C.ROUTE_KEEPIN:
      case C.PACKAGE_KEEPIN: {
        // This can be ALL, but can it be anything else?
        if (aLayerInfo.m_Subclass === S.KEEPOUT_ALL) layerSet = LSET.AllCuMask();
        else layerSet = new LSET([this.GetLayer(aLayerInfo)]);
        break;
      }
      default:
        trace('  Unhandled non-copper zone layer class, using default layers', aLayerInfo.m_Class);
        layerSet = new LSET([this.GetLayer(aLayerInfo)]);
        break;
    }

    return layerSet;
  }

  private static getNthCopperLayer(aNum: number, aTotal: number): PCB_LAYER_ID {
    if (aNum === 0) return PCB_LAYER_ID.F_Cu;
    if (aNum === aTotal - 1) return PCB_LAYER_ID.B_Cu;
    return ToLAYER_ID(2 * (aNum + 1));
  }

  private static getNthUserLayer(aNum: number): PCB_LAYER_ID {
    aNum = Math.min(aNum, MAX_USER_DEFINED_LAYERS - 1);
    return ToLAYER_ID(PCB_LAYER_ID.User_1 + 2 * aNum);
  }

  /**
   * Create or find a mapped layer with a given name, but not specifically bound to a specific class:subclass.
   *
   * This is useful when some items on a class:subclass need to be placed on a KiCad layer other than the usual
   * mapping (non-polygon PLACE_BOUND_TOP items, for example)
   */
  private mapCustomLayerByName(aLayerName: string): PCB_LAYER_ID {
    // If it's been added already, use it
    if (this.m_MappedOptionalLayers.has(aLayerName))
      return this.m_MappedOptionalLayers.get(aLayerName)!;

    const newLId = this.addUserLayer(aLayerName);
    this.m_MappedOptionalLayers.set(aLayerName, newLId);
    return newLId;
  }

  private addUserLayer(aName: string): PCB_LAYER_ID {
    const lId = LAYER_MAPPER.getNthUserLayer(this.m_numUserLayersUsed++);
    const bds = this.m_board.GetDesignSettings();
    bds.SetUserDefinedLayerCount(bds.GetUserDefinedLayerCount() + 1);
    this.m_board.SetLayerName(lId, aName);
    trace('Adding user layer', LayerName(lId), aName);
    return lId;
  }
}

/**
 * This is all the info needed to do the fill of one layer of one zone.
 */
interface FILL_INFO {
  m_Zone: ZONE;
  m_Layer: PCB_LAYER_ID;
  /// The wider filled area we will chop a piece out of for this layer of this zone
  m_CombinedFill: SHAPE_POLY_SET;
}

/**
 * Filled zones have their own outline and the fill itself comes from
 * a bunch of "related" spaces. To convert this to a KiCad-ish ZONE,
 * we need to chop out only the bit of the wider filled zone that applies
 * to the outline (i.e. intersection).
 *
 * Then that fill has to be fractured.
 *
 * This is all repeated for each layer's separated filled areas. Upstream runs the
 * fills on a thread pool, biggest first; each fill writes only its own zone's
 * layer, so the order does not reach the board and they run in turn here.
 */
class ZONE_FILL_HANDLER {
  private m_FillInfos: FILL_INFO[] = [];

  /**
   * Process the polygons (`COMPLEX_FIRST_FILL_TASK::task` for each).
   */
  ProcessPolygons(aSimplify: boolean): void {
    for (const fillInfo of this.m_FillInfos) {
      const finalFillPolys = new SHAPE_POLY_SET(fillInfo.m_Zone.Outline());

      finalFillPolys.ClearArcs();
      fillInfo.m_CombinedFill.ClearArcs();

      // Intersect the zone outline with the combined fill that was assembled
      // from all the related objects.
      finalFillPolys.BooleanIntersection(fillInfo.m_CombinedFill);
      finalFillPolys.Fracture(aSimplify);

      fillInfo.m_Zone.SetFilledPolysList(fillInfo.m_Layer, finalFillPolys);
    }
  }

  QueuePolygonForZone(aZone: ZONE, aFilledArea: SHAPE_POLY_SET, aLayer: PCB_LAYER_ID): void {
    // Rule areas don't need filling
    if (aZone.GetIsRuleArea()) return;

    this.m_FillInfos.push({ m_Zone: aZone, m_Layer: aLayer, m_CombinedFill: aFilledArea });
  }
}

function clampForScale(aValue: number): number {
  const result = stdRound(aValue);

  if (result > 2147483647) return 2147483647;

  if (result < -2147483648) return -2147483648;

  return result;
}

function fromMillidegrees(aMilliDegrees: number): EDA_ANGLE {
  return new EDA_ANGLE(aMilliDegrees / 1000.0, EDA_ANGLE_T.DEGREES_T);
}

const vsub = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });
const vadd = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
const veq = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;
/** `VECTOR2I / n`: `VECTOR2::operator/( double )`, which KiROUNDs each coordinate for an int vector. */
const vdiv = (a: VECTOR2I, d: number): VECTOR2I => ({ x: KiROUND(a.x / d), y: KiROUND(a.y / d) });
/** `KiROUND( VECTOR2D )`. */
const kiroundV = (x: number, y: number): VECTOR2I => ({ x: KiROUND(x), y: KiROUND(y) });

/** The arc's mid point, as every arc builder here computes it. */
function arcMid(
  aStart: VECTOR2I,
  aEnd: VECTOR2I,
  aCenter: VECTOR2I,
  aClockwise: boolean,
): VECTOR2I {
  const startangle = EDA_ANGLE.fromVector(vsub(aStart, aCenter));
  const endangle = EDA_ANGLE.fromVector(vsub(aEnd, aCenter));

  startangle.Normalize();
  endangle.Normalize();

  let angle = endangle.sub(startangle);

  if (aClockwise && angle.lt(ANGLE_0)) angle = angle.add(ANGLE_360);
  if (!aClockwise && angle.gt(ANGLE_0)) angle = angle.sub(ANGLE_360);

  return RotatePoint(aStart, aCenter, angle.negate().divide(2.0));
}

interface ZoneFillEntry {
  shape: BLK_0x28_SHAPE;
  netCode: number;
  layer: PCB_LAYER_ID;
}

interface CS_DEF {
  name: string;
  lineWidth: number;
  clearance: number;
  diffPairGap: number;
}

/**
 * Class that builds a KiCad board from a BRD_DB
 * (= FILE_HEADER + STRINGS + OBJECTS + bookkeeping)
 */
export class BOARD_BUILDER {
  // Cached list of font defs in the 0x36 node
  private m_fontDefList: FontDef_X08[] = [];

  // Cached list of KiCad nets corresponding to Allegro 0x1B NET keys
  private m_netCache = new Map<number, NETINFO_ITEM>();

  private m_zoneFillShapes = new STD_UNORDERED_MAP<ZoneFillEntry, number>(hashInt);

  // Keys that have been used as zone fills already
  private m_usedZoneFillShapes = new Set<number>();

  private readonly m_layerMapper: LAYER_MAPPER;

  // Cache of segment chains keyed by start key, avoiding redundant hole geometry rebuilds
  private m_segChainCache = new Map<number, SHAPE_LINE_CHAIN>();

  // Conversion factor from internal units to nanometers.
  private readonly m_scale: number;

  constructor(
    private readonly m_brdDb: BRD_DB,
    private readonly m_board: BOARD,
    private readonly m_reporter: Reporter,
    private readonly m_progressReporter: PROGRESS_REPORTER | null,
    private readonly m_layerMappingHandler: LAYER_MAPPING_HANDLER,
  ) {
    this.m_layerMapper = new LAYER_MAPPER(m_brdDb, m_board, m_layerMappingHandler);

    // Internal coordinates are stored in <base> / <divisor> units.
    const c_baseScales = new Map<BOARD_UNITS, number>([
      [BOARD_UNITS.MILS, pcbIUScale.milsToIU(1)],
      [BOARD_UNITS.INCHES, pcbIUScale.milsToIU(1000)],
      [BOARD_UNITS.MILLIMETERS, pcbIUScale.mmToIU(1)],
      [BOARD_UNITS.CENTIMETERS, pcbIUScale.mmToIU(10)],
      [BOARD_UNITS.MICROMETERS, pcbIUScale.mmToIU(0.001)],
    ]);

    const header = m_brdDb.m_Header!;

    if (header.m_UnitsDivisor === 0) THROW_IO_ERROR('Board units divisor is 0');

    if (!c_baseScales.has(header.m_BoardUnits)) THROW_IO_ERROR('Unknown board units');

    // `std::map<BOARD_UNITS, int>`: the base scale is an int
    const baseScale = c_baseScales.get(header.m_BoardUnits)!;

    this.m_scale = baseScale / header.m_UnitsDivisor;
  }

  private scaleV(aVector: VECTOR2I): VECTOR2I {
    return {
      x: clampForScale(aVector.x * this.m_scale),
      y: clampForScale(-aVector.y * this.m_scale),
    };
  }

  /** `scale( int )`: the argument already narrowed to an int by the caller. */
  private scale(aValue: number): number {
    return clampForScale(aValue * this.m_scale);
  }

  private scaleSize(aSize: VECTOR2I): VECTOR2I {
    return {
      x: clampForScale(Math.abs(aSize.x) * this.m_scale),
      y: clampForScale(Math.abs(aSize.y) * this.m_scale),
    };
  }

  private expectBlockByKey<T>(aKey: number, aType: number): T | null {
    if (aKey === 0) return null;

    const block = this.m_brdDb.GetObjectByKey(aKey);

    if (!block) {
      this.reportMissingBlock(aKey, aType);
      return null;
    }

    if (block.GetBlockType() !== aType) {
      this.reportUnexpectedBlockType(block.GetBlockType(), aType, aKey, block.GetOffset());
      return null;
    }

    return BlockDataAs<T>(block);
  }

  private reportMissingBlock(aKey: number, aType: number): void {
    this.m_reporter.Report(
      `Could not find expected block with key ${hex010(aKey)} and type ${hex04(aType)}`,
      RPT_SEVERITY_WARNING,
    );
  }

  private reportUnexpectedBlockType(
    aGot: number,
    aExpected: number,
    aKey = 0,
    aOffset = 0,
    aName = '',
  ): void {
    const name = aName === '' ? 'Object' : aName;
    const withKey = aKey === 0 ? '' : `, with key ${hex010(aKey)} `;
    const withOffset = aOffset === 0 ? '' : `, at offset 0x${aOffset.toString(16)} `;

    const s = `${name} has unexpected type ${hex04(aGot)} (expected ${hex04(aExpected)})${withKey}${withOffset}`;

    this.m_reporter.Report(s, RPT_SEVERITY_WARNING);
  }

  private getLayer(aLayerInfo: LAYER_INFO): PCB_LAYER_ID {
    return this.m_layerMapper.GetLayer(aLayerInfo);
  }

  /**
   * Get just the string value from a 0x31 STRING WRAPPER -> 0x30 STRING GRAPHIC pair
   *
   * Throws away all the other string data like pos/size/etc.
   */
  private get0x30StringValue(a0x30Key: number): string {
    const blk0x30 = this.expectBlockByKey<BLK_0x30_STR_WRAPPER>(a0x30Key, 0x30);

    if (blk0x30 === null) THROW_IO_ERROR('Failed to get 0x30 for string lookup');

    const blk0x31 = this.expectBlockByKey<BLK_0x31_SGRAPHIC>(blk0x30.m_StrGraphicPtr, 0x31);

    if (blk0x31 === null) THROW_IO_ERROR('Failed to get 0x31 for string lookup');

    return blk0x31.m_Value;
  }

  private cacheFontDefs(): void {
    const header = this.m_brdDb.m_Header!;
    const x36_walker = new LL_WALKER(
      header.m_LL_0x36.m_Head,
      header.m_LL_0x36.m_Tail,
      this.m_brdDb,
    );

    let encountered = false;

    for (const block of x36_walker) {
      if (block.GetBlockType() !== 0x36) continue;

      const blk0x36 = BlockDataAs<BLK_0x36_DEF_TABLE>(block);

      if (blk0x36.m_Code !== 0x08) continue;

      if (encountered) {
        // This would be bad, because we won't get the indexes into the list right if there
        // it's made up of entries from more than one list of entries.
        this.m_reporter.Report(
          'Found more than one font definition lists in the 0x36 list.',
          RPT_SEVERITY_WARNING,
        );
        break;
      }

      for (const item of blk0x36.m_Items) {
        // std::get<FontDef_X08>: throws if the variant holds anything else
        if (!(item instanceof FontDef_X08)) throw new Error('bad_variant_access');
        this.m_fontDefList.push(item);
      }

      encountered = true;
    }
  }

  private createNets(): void {
    trace('Creating nets from Allegro data');

    // Incrementing netcode. We could also choose to, say, use the 0x1B key if we wanted
    let netCode = 1;

    const bulkAdded: BOARD_ITEM[] = [];

    const netWalker = new LL_WALKER(this.m_brdDb.m_Header!.m_LL_0x1B_Nets, this.m_brdDb);

    for (const block of netWalker) {
      const type = block.GetBlockType();

      if (type !== BLOCK_TYPE.x1B_NET) {
        this.reportUnexpectedBlockType(type, BLOCK_TYPE.x1B_NET, 0, block.GetOffset(), 'Net');
        continue;
      }

      const netBlk = BlockDataAs<BLK_0x1B_NET>(block);

      let netName = this.m_brdDb.GetString(netBlk.m_NetName);

      // Allegro allows unnamed nets. KiCad's NETINFO_LIST matches nets by name, and all
      // empty-named nets would collapse to the unconnected net (code 0). Generate a unique
      // name so each Allegro net gets its own KiCad net code.
      if (netName === '') netName = `Net_${netCode}`;

      const kiNetInfo = new NETINFO_ITEM(this.m_board, netName, netCode);
      netCode++;

      this.m_netCache.set(netBlk.m_Key, kiNetInfo);
      bulkAdded.push(kiNetInfo);
      this.m_board.Add(kiNetInfo, ADD_MODE.BULK_APPEND);
    }

    this.m_board.FinalizeBulkAdd(bulkAdded);

    trace('Added nets', this.m_netCache.size);
  }

  /**
   * Extract constraint set name from a 0x03 FIELD block pointer.
   *
   * Some boards store the constraint set name in a FIELD block referenced by m_FieldPtr in
   * the 0x1D block instead of the main string table. The FIELD string is a schematic
   * cross-reference like "@lib.xxx(view):\CONSTRAINT_SET_NAME\".
   */
  private resolveConstraintSetNameFromField(aFieldKey: number): string {
    const fieldBlock = this.m_brdDb.GetObjectByKey(aFieldKey);

    if (!fieldBlock || fieldBlock.GetBlockType() !== 0x03) return '';

    const field = BlockDataAs<BLK_0x03_FIELD>(fieldBlock);
    const str = typeof field.m_Substruct === 'string' ? field.m_Substruct : null;

    if (str === null) return '';

    // Extract name from schematic cross-reference format: @lib.xxx(view):\NAME\.
    // Find the last colon-backslash separator in the raw std::string and extract from there.
    const sep = str.indexOf(':\\');

    if (sep < 0) return '';

    let extracted = str.substring(sep + 2);

    if (extracted !== '' && extracted.endsWith('\\')) extracted = extracted.slice(0, -1);

    return extracted;
  }

  private applyConstraintSets(): void {
    trace('Importing physical constraint sets from 0x1D blocks');

    const netSettings = this.m_board.GetDesignSettings().m_NetSettings;

    const isV172Plus = this.m_brdDb.m_FmtVer >= FMT_VER.V_172;

    // Map from constraint set name to its definition (std::map<wxString, CS_DEF>)
    const constraintSets = new Map<string, CS_DEF>();

    // Also map string table keys to set names for net lookup
    const keyToSetName = new Map<number, string>();

    let csIndex = 0;
    const csWalker = new LL_WALKER(this.m_brdDb.m_Header!.m_LL_0x1D_0x1E_0x1F, this.m_brdDb);

    for (const block of csWalker) {
      if (block.GetBlockType() !== 0x1d) continue;

      const csBlock = BlockDataAs<BLK_0x1D_CONSTRAINT_SET>(block);

      let setName = '';
      const resolved = this.m_brdDb.ResolveString(csBlock.m_NameStrKey);

      if (resolved !== null && resolved !== '') {
        setName = resolved;
      } else if (csBlock.m_FieldPtr !== 0) {
        // Some boards store the name in a 0x03 FIELD block as a schematic cross-reference
        setName = this.resolveConstraintSetNameFromField(csBlock.m_FieldPtr);
      }

      if (setName === '') setName = `CS_${csIndex}`;

      csIndex++;

      if (csBlock.m_DataB.length === 0) {
        trace('Constraint set has no DataB records, skipping', setName);
        continue;
      }

      // Parse first DataB record (first copper layer) as 14 x int32
      const record = csBlock.m_DataB[0]!;
      const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
      const fields = (i: number) => view.getInt32(i * 4, true);

      const def: CS_DEF = { name: setName, lineWidth: 0, clearance: 0, diffPairGap: 0 };

      if (isV172Plus) {
        def.lineWidth = this.scale(fields(1));
        def.clearance = this.scale(fields(4));
      } else {
        // Pre-V172: f[0] is preferred line width, f[1] is line spacing (used as clearance).
        // f[4] is sometimes also clearance when non-zero, but f[1] is the primary source.
        def.lineWidth = this.scale(fields(0));
        def.clearance = this.scale(fields(1));
      }

      def.diffPairGap = this.scale(fields(7));

      constraintSets.set(setName, def);
      keyToSetName.set(csBlock.m_NameStrKey, setName);
    }

    if (constraintSets.size === 0) {
      trace('No physical constraint sets found');
      return;
    }

    const sortedSets = [...constraintSets].sort(([a], [b]) => wxStringLess(a, b));

    // Create a netclass for each constraint set that has nonzero values
    for (const [name, def] of sortedSets) {
      let ncName = name;

      if (eqNoCase(ncName, NETCLASS.Default)) ncName = 'Allegro_Default';

      if (netSettings.HasNetclass(ncName)) continue;

      const nc = new NETCLASS(ncName);

      if (def.lineWidth > 0) nc.SetTrackWidth(def.lineWidth);

      if (def.clearance > 0) nc.SetClearance(def.clearance);

      if (def.diffPairGap > 0) {
        nc.SetDiffPairGap(def.diffPairGap);

        // Diff pair width is the same as track width for the pair's netclass
        if (def.lineWidth > 0) nc.SetDiffPairWidth(def.lineWidth);
      }

      netSettings.SetNetclass(ncName, nc);
    }

    // Walk all NETs and assign them to constraint set netclasses via field 0x1a0
    let defaultSetName = '';

    for (const [name] of sortedSets) {
      if (eqNoCase(name, 'DEFAULT')) {
        defaultSetName = name;
        break;
      }
    }

    this.m_brdDb.VisitNets((aView: VIEW_OBJS) => {
      if (!aView.m_Net) return;

      const net = aView.m_Net;

      // Field 0x1a0 references the constraint set. It can be an integer (string table key
      // that matches 0x1D.m_NameStrKey) or a direct string (the constraint set name).
      const csField = net.m_Fields.GetOptField(FIELD_KEYS.PHYS_CONSTRAINT_SET);

      let assignedSetName = '';

      if (csField !== null) {
        if (typeof csField === 'number') {
          const it = keyToSetName.get(csField);

          if (it !== undefined) assignedSetName = it;
        } else if (constraintSets.has(csField)) {
          assignedSetName = csField;
        }
      }

      // Nets without field 0x1a0 use the DEFAULT constraint set
      if (assignedSetName === '' && defaultSetName !== '') assignedSetName = defaultSetName;

      if (assignedSetName === '') return;

      let ncName = assignedSetName;

      if (eqNoCase(ncName, NETCLASS.Default)) ncName = 'Allegro_Default';

      if (!netSettings.HasNetclass(ncName)) return;

      const kiNet = this.m_netCache.get(net.GetKey());

      if (kiNet === undefined) return;

      netSettings.SetNetclassPatternAssignment(kiNet.GetNetname(), ncName);
      kiNet.SetNetClass(netSettings.GetNetClassByName(ncName));
    });

    trace('Applied physical constraint sets', constraintSets.size);
  }

  private applyNetConstraints(): void {
    trace('Applying per-net trace width constraints');

    const netSettings = this.m_board.GetDesignSettings().m_NetSettings;

    // Group nets by their minimum trace width to create netclasses.
    // Allegro stores per-net min/max trace width in FIELD blocks attached to each NET.
    const widthToNetKeys = new Map<number, number[]>();

    this.m_brdDb.VisitNets((aView: VIEW_OBJS) => {
      if (!aView.m_Net) return;

      const minWidth = aView.m_Net.GetNetMinLineWidth();

      if (minWidth === null || minWidth <= 0) return;

      const widthNm = this.scale(minWidth);
      if (!widthToNetKeys.has(widthNm)) widthToNetKeys.set(widthNm, []);
      widthToNetKeys.get(widthNm)!.push(aView.m_Net.GetKey());
    });

    if (widthToNetKeys.size === 0) {
      trace('No per-net trace width constraints found');
      return;
    }

    for (const [widthNm, netKeys] of [...widthToNetKeys].sort(([a], [b]) => a - b)) {
      const widthMils = Math.trunc((widthNm + 12700) / 25400);
      const ncName = `W${widthMils}mil`;

      if (netSettings.HasNetclass(ncName)) continue;

      const nc = new NETCLASS(ncName);
      nc.SetTrackWidth(widthNm);
      netSettings.SetNetclass(ncName, nc);

      for (const netKey of netKeys) {
        const kiNet = this.m_netCache.get(netKey);

        if (kiNet === undefined) continue;

        netSettings.SetNetclassPatternAssignment(kiNet.GetNetname(), ncName);
        kiNet.SetNetClass(nc);
      }
    }
  }

  /**
   * Follow m_MatchGroupPtr through the 0x26/0x2C pointer chain to get
   * the match group name for a NET.
   *
   * V172+: NET.m_MatchGroupPtr -> 0x26 -> m_GroupPtr -> 0x2C TABLE -> string
   * Pre-V172: NET.m_MatchGroupPtr -> 0x2C TABLE -> string
   *
   * @return the group name, or empty string if none
   */
  private resolveMatchGroupName(aNet: BLK_0x1B_NET): string {
    if (aNet.m_MatchGroupPtr === 0) return '';

    const block = this.m_brdDb.GetObjectByKey(aNet.m_MatchGroupPtr);

    if (!block) return '';

    let tableKey = 0;

    if (block.GetBlockType() === 0x26) {
      // V172+ path: NET -> 0x26 -> m_GroupPtr -> 0x2C TABLE
      tableKey = BlockDataAs<BLK_0x26_MATCH_GROUP>(block).m_GroupPtr;

      // Some boards have chained 0x26 blocks (m_GroupPtr -> another 0x26 -> 0x2C)
      if (tableKey !== 0) {
        const next = this.m_brdDb.GetObjectByKey(tableKey);

        if (next && next.GetBlockType() === 0x26)
          tableKey = BlockDataAs<BLK_0x26_MATCH_GROUP>(next).m_GroupPtr;
      }
    } else if (block.GetBlockType() === 0x2c) {
      // Pre-V172 path: NET -> 0x2C TABLE directly
      tableKey = aNet.m_MatchGroupPtr;
    } else {
      return '';
    }

    if (tableKey === 0) return '';

    // Verify the target is actually a 0x2C TABLE before calling expectBlockByKey to
    // avoid noisy warnings on boards with unexpected pointer chain configurations.
    const tableBlock = this.m_brdDb.GetObjectByKey(tableKey);

    if (!tableBlock || tableBlock.GetBlockType() !== 0x2c) return '';

    const tbl = this.expectBlockByKey<BLK_0x2C_TABLE>(tableKey, 0x2c);

    if (!tbl || tbl.m_StringPtr === 0) return '';

    return this.m_brdDb.GetString(tbl.m_StringPtr);
  }

  private applyMatchGroups(): void {
    trace('Applying match group / differential pair assignments');

    const netSettings = this.m_board.GetDesignSettings().m_NetSettings;

    // Group NET keys by their match group name
    const groupToNetKeys = new Map<string, number[]>();

    const netWalker = new LL_WALKER(this.m_brdDb.m_Header!.m_LL_0x1B_Nets, this.m_brdDb);

    for (const block of netWalker) {
      if (block.GetBlockType() !== BLOCK_TYPE.x1B_NET) continue;

      const netBlk = BlockDataAs<BLK_0x1B_NET>(block);
      const groupName = this.resolveMatchGroupName(netBlk);

      if (groupName === '') continue;

      if (!groupToNetKeys.has(groupName)) groupToNetKeys.set(groupName, []);
      groupToNetKeys.get(groupName)!.push(netBlk.m_Key);
    }

    if (groupToNetKeys.size === 0) {
      trace('No match groups found');
      return;
    }

    for (const [groupName, netKeys] of [...groupToNetKeys].sort(([a], [b]) => wxStringLess(a, b))) {
      // A diff pair has exactly 2 nets. We don't check P/N naming because Allegro doesn't
      // require any naming convention for paired nets.
      const isDiffPair = netKeys.length === 2;
      const ncPrefix = isDiffPair ? 'DP_' : 'MG_';
      const ncName = ncPrefix + groupName;

      if (netSettings.HasNetclass(ncName)) continue;

      const nc = new NETCLASS(ncName);

      // Inherit constraint set values from the first net's current netclass so that
      // clearance and track width from the underlying constraint set are not lost.
      for (const netKey of netKeys) {
        const kiNet = this.m_netCache.get(netKey);

        if (kiNet === undefined) continue;

        const existing = kiNet.GetNetClass();

        if (existing && existing.GetName() !== NETCLASS.Default) {
          if (existing.HasClearance()) nc.SetClearance(existing.GetClearance());

          if (existing.HasTrackWidth()) nc.SetTrackWidth(existing.GetTrackWidth());

          if (existing.HasDiffPairGap()) nc.SetDiffPairGap(existing.GetDiffPairGap());

          if (existing.HasDiffPairWidth()) nc.SetDiffPairWidth(existing.GetDiffPairWidth());

          break;
        }
      }

      netSettings.SetNetclass(ncName, nc);

      for (const netKey of netKeys) {
        const kiNet = this.m_netCache.get(netKey);

        if (kiNet === undefined) continue;

        netSettings.SetNetclassPatternAssignment(kiNet.GetNetname(), ncName);
        kiNet.SetNetClass(nc);
      }
    }
  }

  /**
   * Look through some lists for a list of layers used.
   *
   * This isn't yet exhaustive, not sure if it needs to be. We could scan every single
   * block if we wanted, but that would be a lot of blocks without layers. So walking
   * lists seems more efficient.
   *
   * The primary goal is to look for colliding layers like OUTLINE/DESIGN_OUTLINE
   * so that we can remap one of them to something else.
   */
  private static ScanForLayers(aDb: BRD_DB): Set<number> {
    const layersFound = new Set<number>();

    const simpleWalker = (aLL: LINKED_LIST) => {
      for (const block of new LL_WALKER(aLL, aDb)) {
        const info = tryLayerFromBlock(block);
        if (info !== null) layersFound.add(layerKey(info));
      }
    };

    const header = aDb.m_Header!;
    simpleWalker(header.m_LL_Shapes);
    simpleWalker(header.m_LL_0x24_0x28);
    simpleWalker(header.m_LL_0x14);

    return layersFound;
  }

  private setupLayers(): void {
    trace('Setting up layer mapping from Allegro to KiCad');

    const layerMap = this.m_brdDb.m_Header!.m_LayerMap;

    for (let i = 0; i < layerMap.length; ++i) {
      const classNum = i & 0xff;

      const x2aKey = layerMap[i]!.m_LayerList0x2A;

      if (x2aKey === 0) continue;

      const layerList = this.expectBlockByKey<BLK_0x2A_LAYER_LIST>(x2aKey, 0x2a);

      // Probably an error
      if (!layerList) continue;

      this.m_layerMapper.ProcessLayerList(classNum, layerList);
    }

    const layersFound = BOARD_BUILDER.ScanForLayers(this.m_brdDb);

    // The outline is sometimes on OUTLINE and sometimes on DESIGN_OUTLINE, and sometimes
    // on both. In the first two cases, whichever it is goes to Edge.Cuts, but in the both case,
    // we send one to a User layer
    const outlineInfo = { m_Class: C.BOARD_GEOMETRY, m_Subclass: S.BGEOM_OUTLINE };
    const designOutlineInfo = { m_Class: C.BOARD_GEOMETRY, m_Subclass: S.BGEOM_DESIGN_OUTLINE };

    if (layersFound.has(layerKey(outlineInfo)) && layersFound.has(layerKey(designOutlineInfo))) {
      // Both layers found, remap DESIGN_OUTLINE to a user layer
      this.m_layerMapper.MapCustomLayer(designOutlineInfo, layerInfoDisplayName(designOutlineInfo));
    }

    this.m_layerMapper.FinalizeLayers();
  }

  /**
   * Get the font definition for a given index in a 0x30, etc.
   *
   * @return the definition if it exists, else nullptr (which is probably an error in the
   * importer logic)
   */
  private getFontDef(aIndex: number): FontDef_X08 | null {
    if (aIndex === 0 || aIndex > this.m_fontDefList.length) {
      this.m_reporter.Report(
        `Font def index ${aIndex} requested, have ${this.m_fontDefList.length} entries`,
        RPT_SEVERITY_WARNING,
      );
      return null;
    }

    // The index appears to be 1-indexed (maybe 0 means something special?)
    return this.m_fontDefList[aIndex - 1]!;
  }

  /**
   * Build a single line segment
   */
  private buildLineSegment(
    aSegment: BLK_0x15_16_17_SEGMENT,
    _aLayerInfo: LAYER_INFO,
    aLayer: PCB_LAYER_ID,
    aParent: BOARD_ITEM_CONTAINER,
  ): PCB_SHAPE {
    const start = this.scaleV({ x: aSegment.m_StartX, y: aSegment.m_StartY });
    const end = this.scaleV({ x: aSegment.m_EndX, y: aSegment.m_EndY });
    // `scale( uint32_t )`: narrowed to int
    const width = this.scale(aSegment.m_Width | 0);

    const shape = new PCB_SHAPE(aParent as unknown as BOARD_ITEM, SHAPE_T.SEGMENT);
    shape.SetLayer(aLayer);
    shape.SetStart(start);
    shape.SetEnd(end);

    {
      let adjustedWidth = width;

      if (adjustedWidth <= 0)
        adjustedWidth = this.m_board.GetDesignSettings().GetLineThickness(aLayer);

      shape.SetWidth(adjustedWidth);
    }

    return shape;
  }

  private buildArc(
    aArc: BLK_0x01_ARC,
    _aLayerInfo: LAYER_INFO,
    aLayer: PCB_LAYER_ID,
    aParent: BOARD_ITEM_CONTAINER,
  ): PCB_SHAPE {
    let start: VECTOR2I = { x: aArc.m_StartX, y: aArc.m_StartY };
    let end: VECTOR2I = { x: aArc.m_EndX, y: aArc.m_EndY };

    const shape = new PCB_SHAPE(aParent as unknown as BOARD_ITEM, SHAPE_T.ARC);

    shape.SetLayer(aLayer);

    start = this.scaleV(start);
    end = this.scaleV(end);

    const c = this.scaleV(kiroundV(aArc.m_CenterX, aArc.m_CenterY));

    const radius = this.scale(KiROUND(aArc.m_Radius));

    const clockwise = (aArc.m_SubType & 0x40) !== 0;

    {
      let arcWidth = this.scale(aArc.m_Width | 0);

      if (arcWidth <= 0) arcWidth = this.m_board.GetDesignSettings().GetLineThickness(aLayer);

      shape.SetWidth(arcWidth);
    }

    if (veq(start, end)) {
      shape.SetShape(SHAPE_T.CIRCLE);
      shape.SetCenter(c);
      shape.SetRadius(radius);
    } else {
      shape.SetShape(SHAPE_T.ARC);
      shape.SetArcGeometry(start, arcMid(start, end, c, clockwise), end);
    }

    return shape;
  }

  private buildPcbText(
    aStrWrapper: BLK_0x30_STR_WRAPPER,
    aParent: BOARD_ITEM_CONTAINER,
  ): PCB_TEXT | null {
    // make_unique<PCB_TEXT>( &aParent ): the BOARD_ITEM* overload, whatever the container is
    const text = PCB_TEXT.withBoardItemParent(aParent as unknown as BOARD_ITEM);

    const layer = this.getLayer(aStrWrapper.m_Layer);
    text.SetLayer(layer);

    const strGraphic = this.expectBlockByKey<BLK_0x31_SGRAPHIC>(aStrWrapper.m_StrGraphicPtr, 0x31);

    if (!strGraphic) {
      this.m_reporter.Report(
        `Failed to find string graphic (0x31) with key ${hex010(aStrWrapper.m_StrGraphicPtr)} ` +
          `in string wrapper (0x30) with key ${hex010(aStrWrapper.m_Key)}`,
        RPT_SEVERITY_WARNING,
      );
      return null;
    }

    let props = aStrWrapper.m_Font.has_value() ? aStrWrapper.m_Font.value() : null;

    if (!props && aStrWrapper.m_Font16x.has_value()) props = aStrWrapper.m_Font16x.value();

    if (!props) {
      this.m_reporter.Report(
        `Expected one of the font properties fields in 0x30 object (key ${hex010(aStrWrapper.m_Key)}) to be set.`,
        RPT_SEVERITY_WARNING,
      );
      return null;
    }

    const fontDef = this.getFontDef(props.m_Key);

    if (!fontDef) return null;

    text.SetText(strGraphic.m_Value);
    text.SetTextWidth(this.scale(fontDef.m_CharWidth | 0));
    text.SetTextHeight(this.scale(fontDef.m_CharHeight | 0));

    if (fontDef.m_StrokeWidth > 0) text.SetTextThickness(this.scale(fontDef.m_StrokeWidth | 0));
    else text.SetTextThickness(GetPenSizeForNormal(this.scale(fontDef.m_CharHeight | 0)));

    const textAngle = fromMillidegrees(aStrWrapper.m_Rotation);
    text.SetTextAngle(textAngle);

    const textPos = this.scaleV({ x: aStrWrapper.m_CoordsX, y: aStrWrapper.m_CoordsY });

    // KiCad's stroke font has a different baseline than Allegro's, so apply a vertical offset to compensate.
    // The exact offset is a bit of guesswork based on visually matching Allegro and KiCad text, but the
    // stoke font itself isn't the same anyway, so we can't be 100% here.
    let textFontOffset: VECTOR2I = {
      x: 0,
      y: Math.trunc(-(this.scale(fontDef.m_CharHeight | 0) * 45) / 100),
    };
    textFontOffset = RotatePoint(textFontOffset, textAngle);
    text.SetPosition(vadd(textPos, textFontOffset));

    if (props.m_Reversal === TEXT_REVERSAL.REVERSED) text.SetMirrored(true);

    switch (props.m_Alignment) {
      case TEXT_ALIGNMENT.LEFT:
        text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
        break;
      case TEXT_ALIGNMENT.CENTER:
        text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
        break;
      case TEXT_ALIGNMENT.RIGHT:
        text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        break;
      default:
        break;
    }

    return text;
  }

  /**
   * Build a drill marker from a 0x0C PIN_DEF block
   */
  private buildDrillMarker(aPinDef: BLK_0x0C_PIN_DEF, aParent: BOARD_ITEM_CONTAINER): BOARD_ITEM[] {
    const MS = MARKER_SHAPE;
    const shapes: PCB_SHAPE[] = [];
    const parent = aParent as unknown as BOARD_ITEM;

    const markerShape = aPinDef.GetShape();

    const layer = this.getLayer(aPinDef.m_Layer);
    const center = this.scaleV({ x: aPinDef.m_Coords[0]!, y: aPinDef.m_Coords[1]! });
    const size = this.scaleSize({ x: aPinDef.m_Size[0]!, y: aPinDef.m_Size[1]! });

    const addLine = (aSeg: SEG) => {
      const shape = new PCB_SHAPE(parent, SHAPE_T.SEGMENT);
      shape.SetStart(aSeg.A);
      shape.SetEnd(aSeg.B);
      shapes.push(shape);
    };

    const addPolyPts = (aPts: VECTOR2I[]) => {
      const shape = new PCB_SHAPE(parent, SHAPE_T.POLY);
      shape.SetPolyPoints(aPts);
      shapes.push(shape);
    };

    switch (markerShape) {
      case MS.CIRCLE: {
        const shape = new PCB_SHAPE(parent, SHAPE_T.CIRCLE);
        shape.SetCenter(center);
        shape.SetRadius(Math.trunc(size.x / 2));
        shapes.push(shape);
        break;
      }
      case MS.SQUARE:
      case MS.RECTANGLE: {
        const shape = new PCB_SHAPE(parent, SHAPE_T.RECTANGLE);
        shape.SetStart(vsub(center, vdiv(size, 2)));
        shape.SetEnd(vadd(center, vdiv(size, 2)));
        shapes.push(shape);
        break;
      }
      case MS.CROSS: {
        for (const seg of KIGEOM_MakeCrossSegments(center, size, ANGLE_0)) addLine(seg);
        break;
      }
      case MS.OBLONG_X:
      case MS.OBLONG_Y: {
        const shape = new PCB_SHAPE(parent, SHAPE_T.RECTANGLE);
        shape.SetStart(vsub(center, vdiv(size, 2)));
        shape.SetEnd(vadd(center, vdiv(size, 2)));

        const minSize = Math.min(size.x, size.y);
        shape.SetCornerRadius(Math.trunc(minSize / 2));
        shapes.push(shape);
        break;
      }
      case MS.TRIANGLE: {
        // This triangle is point-up
        // Size follows fabmaster - the circumscribed circle of the triangle
        addPolyPts(
          KIGEOM_MakeRegularPolygonPoints(center, 3, Math.trunc(size.x / 2), true, ANGLE_90),
        );
        break;
      }
      case MS.DIAMOND: {
        addPolyPts(
          KIGEOM_MakeRegularPolygonPoints(center, 4, Math.trunc(size.x / 2), true, ANGLE_90),
        );
        break;
      }
      case MS.PENTAGON: {
        // Not 100% sure which way this should point
        addPolyPts(
          KIGEOM_MakeRegularPolygonPoints(center, 5, Math.trunc(size.x / 2), true, ANGLE_90),
        );
        break;
      }
      case MS.HEXAGON_X:
      case MS.HEXAGON_Y: {
        const startAngle = markerShape === MS.HEXAGON_X ? ANGLE_0 : ANGLE_90;
        addPolyPts(
          KIGEOM_MakeRegularPolygonPoints(center, 6, Math.trunc(size.x / 2), true, startAngle),
        );
        break;
      }
      case MS.OCTAGON: {
        const startAngle = FULL_CIRCLE.divide(16); // Start at 22.5 degrees to align flat sides with axes
        // Octagons are measured across flats
        addPolyPts(
          KIGEOM_MakeRegularPolygonPoints(center, 8, Math.trunc(size.x / 2), false, startAngle),
        );
        break;
      }
      default: {
        trace('Unsupported drill marker shape type', markerShape, aPinDef.m_Key);
        break;
      }
    }

    const items: BOARD_ITEM[] = [];
    for (const shape of shapes) {
      shape.SetLayer(layer);
      shape.SetWidth(0);

      items.push(shape);
    }

    return items;
  }

  /**
   * Build a list of graphic items, e.g. from a table's pointer list.
   */
  private buildGraphicItems(aBlock: BLOCK_BASE, aParent: BOARD_ITEM_CONTAINER): BOARD_ITEM[] {
    let newItems: BOARD_ITEM[] = [];

    switch (aBlock.GetBlockType()) {
      case 0x0c: {
        newItems = this.buildDrillMarker(BlockDataAs<BLK_0x0C_PIN_DEF>(aBlock), aParent);
        break;
      }
      case 0x0e: {
        const shape = this.buildRect0E(BlockDataAs<BLK_0x0E_RECT>(aBlock), aParent);
        if (shape) newItems.push(shape);
        break;
      }
      case 0x14: {
        for (const shape of this.buildShapes(BlockDataAs<BLK_0x14_GRAPHIC>(aBlock), aParent))
          newItems.push(shape);
        break;
      }
      case 0x24: {
        const shape = this.buildRect24(BlockDataAs<BLK_0x24_RECT>(aBlock), aParent);
        if (shape) newItems.push(shape);
        break;
      }
      case 0x28: {
        const shape = this.buildPolygon(BlockDataAs<BLK_0x28_SHAPE>(aBlock), aParent);
        if (shape) newItems.push(shape);
        break;
      }
      case 0x30: {
        const newItem = this.buildPcbText(BlockDataAs<BLK_0x30_STR_WRAPPER>(aBlock), aParent);
        if (newItem) newItems.push(newItem);
        break;
      }
      default: {
        trace('    Unhandled block type for buildItems', aBlock.GetBlockType());
        break;
      }
    }

    return newItems;
  }

  /**
   * Build the shapes from an 0x14 shape list
   */
  private buildShapes(aGraphic: BLK_0x14_GRAPHIC, aParent: BOARD_ITEM_CONTAINER): PCB_SHAPE[] {
    const shapes: PCB_SHAPE[] = [];

    let layer = this.getLayer(aGraphic.m_Layer);

    // Within the graphics list, we can get various lines and arcs on PLACE_BOUND_TOP, which
    // aren't actually the courtyard, which is a polygon in the 0x28 list. So, if we see such items,
    // remap them now to a specific other layer
    if (layer === PCB_LAYER_ID.F_CrtYd) layer = this.m_layerMapper.GetPlaceBounds(true);
    else if (layer === PCB_LAYER_ID.B_CrtYd) layer = this.m_layerMapper.GetPlaceBounds(false);

    const segWalker = new LL_WALKER(aGraphic.m_SegmentPtr, aGraphic.m_Key, this.m_brdDb);

    for (const segBlock of segWalker) {
      let shape: PCB_SHAPE | null = null;

      switch (segBlock.GetBlockType()) {
        case 0x01: {
          shape = this.buildArc(
            BlockDataAs<BLK_0x01_ARC>(segBlock),
            aGraphic.m_Layer,
            layer,
            aParent,
          );
          break;
        }
        case 0x15:
        case 0x16:
        case 0x17: {
          shape = this.buildLineSegment(
            BlockDataAs<BLK_0x15_16_17_SEGMENT>(segBlock),
            aGraphic.m_Layer,
            layer,
            aParent,
          );
          break;
        }
        default: {
          trace('    Unhandled block type in BLK_0x14_GRAPHIC', segBlock.GetBlockType());
          break;
        }
      }

      if (shape) shapes.push(shape);
    }

    return shapes;
  }

  /**
   * Build a rectangular shape from a 0x24 RECT block.
   */
  private buildRect24(aRect: BLK_0x24_RECT, aParent: BOARD_ITEM_CONTAINER): PCB_SHAPE {
    return this.buildRectShape(aRect.m_Layer, aRect.m_Coords, aRect.m_Rotation, aParent);
  }

  /**
   * Build a graphic polygon from a 0x0E RECT block.
   */
  private buildRect0E(aRect: BLK_0x0E_RECT, aParent: BOARD_ITEM_CONTAINER): PCB_SHAPE {
    return this.buildRectShape(aRect.m_Layer, aRect.m_Coords, aRect.m_Rotation, aParent);
  }

  /** The body both `buildRect` overloads share, line for line. */
  private buildRectShape(
    aLayerInfo: LAYER_INFO,
    aCoords: readonly number[],
    aRotation: number,
    aParent: BOARD_ITEM_CONTAINER,
  ): PCB_SHAPE {
    const shape = new PCB_SHAPE(aParent as unknown as BOARD_ITEM);

    const layer = this.getLayer(aLayerInfo);
    shape.SetLayer(layer);

    shape.SetShape(SHAPE_T.RECTANGLE);

    const cornerA = this.scaleV({ x: aCoords[0]!, y: aCoords[1]! });
    const cornerB = this.scaleV({ x: aCoords[2]!, y: aCoords[3]! });

    shape.SetStart(cornerA);
    shape.SetEnd(cornerB);

    const angle = fromMillidegrees(aRotation);
    shape.Rotate(cornerA, angle);

    const lineWidth = 0;
    shape.SetWidth(lineWidth);

    return shape;
  }

  /**
   * Build a graphic polygon from a 0x28 SHAPE block.
   */
  private buildPolygon(aPolygon: BLK_0x28_SHAPE, aParent: BOARD_ITEM_CONTAINER): PCB_SHAPE | null {
    const shape = new PCB_SHAPE(aParent as unknown as BOARD_ITEM);

    const layer = this.getLayer(aPolygon.m_Layer);
    shape.SetLayer(layer);

    shape.SetShape(SHAPE_T.POLY);

    const chain = this.buildOutline28(aPolygon);

    if (chain.PointCount() < 3) {
      trace('Polygon (0x28) has fewer than 3 points, skipping', aPolygon.m_Key);
      return null;
    }

    chain.SetClosed(true);
    shape.SetPolyShape(new SHAPE_POLY_SET(chain));

    const lineWidth = 0;
    shape.SetWidth(lineWidth);

    return shape;
  }

  /**
   * Build graphics from an 0x28 SHAPE, with separate items per segment/arc
   */
  private buildPolygonShapes(
    aShapeData: BLK_0x28_SHAPE,
    _aParent: BOARD_ITEM_CONTAINER,
  ): PCB_SHAPE[] {
    const shapes: PCB_SHAPE[] = [];

    const layer = this.getLayer(aShapeData.m_Layer);

    // Walk the segments in this shape and create PCB_SHAPE objects on Edge_Cuts
    const segWalker = new LL_WALKER(aShapeData.m_FirstSegmentPtr, aShapeData.m_Key, this.m_brdDb);

    for (const segBlock of segWalker) {
      const shape = new PCB_SHAPE(this.m_board as unknown as BOARD_ITEM);
      shape.SetLayer(layer);
      shape.SetWidth(this.m_board.GetDesignSettings().GetLineThickness(layer));

      switch (segBlock.GetBlockType()) {
        case 0x01: {
          const arc = BlockDataAs<BLK_0x01_ARC>(segBlock);

          const start = this.scaleV({ x: arc.m_StartX, y: arc.m_StartY });
          const end = this.scaleV({ x: arc.m_EndX, y: arc.m_EndY });
          const c = this.scaleV(kiroundV(arc.m_CenterX, arc.m_CenterY));

          // `scale( arc.m_Radius )`: the double narrowed to scale( int )'s int
          const radius = this.scale(arc.m_Radius | 0);
          if (veq(start, end)) {
            shape.SetShape(SHAPE_T.CIRCLE);
            shape.SetCenter(c);
            shape.SetRadius(radius);
          } else {
            shape.SetShape(SHAPE_T.ARC);

            const clockwise = (arc.m_SubType & 0x40) !== 0;

            shape.SetArcGeometry(start, arcMid(start, end, c, clockwise), end);
          }
          break;
        }
        case 0x15:
        case 0x16:
        case 0x17: {
          const seg = BlockDataAs<BLK_0x15_16_17_SEGMENT>(segBlock);
          const start = this.scaleV({ x: seg.m_StartX, y: seg.m_StartY });
          const end = this.scaleV({ x: seg.m_EndX, y: seg.m_EndY });

          shape.SetShape(SHAPE_T.SEGMENT);
          shape.SetStart(start);
          shape.SetEnd(end);
          shape.SetWidth(this.m_board.GetDesignSettings().GetLineThickness(layer));
          break;
        }
        default:
          trace('  Unhandled segment type in outline', segBlock.GetBlockType());
          continue;
      }

      shapes.push(shape);
    }

    return shapes;
  }

  /**
   * Look up 0x07 FP instance data (0x07) for a given 0x2D FP instance
   */
  private getFpInstRef(aFpInstance: BLK_0x2D_FOOTPRINT_INST): BLK_0x07_COMPONENT_INST | null {
    let refKey = 0x00;

    if (aFpInstance.m_InstRef.has_value()) refKey = aFpInstance.m_InstRef.value();

    if (!refKey && aFpInstance.m_InstRef16x.has_value()) refKey = aFpInstance.m_InstRef16x.value();

    // This can happen, for example for dimension "symbols".
    if (refKey === 0) return null;

    return this.expectBlockByKey<BLK_0x07_COMPONENT_INST>(refKey, 0x07);
  }

  /**
   * Construct "pad" items for a given 0x1C PADSTACK block.
   */
  private buildPadItems(
    aPadstack: BLK_0x1C_PADSTACK,
    aFp: FOOTPRINT,
    aPadName: string,
    aNetcode: number,
  ): BOARD_ITEM[] {
    // Not all Allegro PADSTACKS can be represented by a single KiCad pad. For example, the
    // paste and mask layers can have completely independent shapes in Allegro, but in KiCad that
    // would require a separate aperture pad.
    // Also if there are multiple drills, we will need to make a pad for each
    const padItems: BOARD_ITEM[] = [];

    const copperLayers: (PADSTACK_COPPER_LAYER_PROPS | null)[] = new Array(
      aPadstack.GetLayerCount(),
    ).fill(null);

    // Thermal relief gap from antipad/pad size difference on the first layer that has both.
    let thermalGap: number | null = null;

    const padStackName = this.m_brdDb.GetString(aPadstack.m_PadStr);

    // First, gather all the copper layers into a set of shape props, which we can then use to decide on the padstack mode
    for (let i = 0; i < aPadstack.GetLayerCount(); ++i) {
      const layerBaseIndex = aPadstack.m_NumFixedCompEntries + i * aPadstack.m_NumCompsPerLayer;
      const padComp = aPadstack.m_Components[layerBaseIndex + LAYER_COMP_SLOT.PAD]!;
      const antiPadComp = aPadstack.m_Components[layerBaseIndex + LAYER_COMP_SLOT.ANTIPAD]!;
      const thermalComp = aPadstack.m_Components[layerBaseIndex + LAYER_COMP_SLOT.THERMAL_RELIEF]!;

      // If this is zero just skip entirely - I don't think we can usefully make pads with just thermal relief
      // Flag up if that happens.
      if (padComp.m_Type === PADSTACK_COMPONENT_TYPE.TYPE_NULL) {
        if (antiPadComp.m_Type !== PADSTACK_COMPONENT_TYPE.TYPE_NULL) {
          this.m_reporter.Report(
            `Padstack ${padStackName}: Copper layer ${i} has no pad component, but has antipad`,
            RPT_SEVERITY_WARNING,
          );
        }
        if (thermalComp.m_Type !== PADSTACK_COMPONENT_TYPE.TYPE_NULL) {
          this.m_reporter.Report(
            `Copper layer ${i} has no pad component, but has thermal relief`,
            RPT_SEVERITY_WARNING,
          );
        }
        continue;
      }

      const layerCuProps = new PADSTACK_COPPER_LAYER_PROPS();
      copperLayers[i] = layerCuProps;

      switch (padComp.m_Type) {
        case PADSTACK_COMPONENT_TYPE.TYPE_RECTANGLE:
          layerCuProps.shape.shape = PAD_SHAPE.RECTANGLE;
          layerCuProps.shape.size = this.scaleSize({ x: padComp.m_W, y: padComp.m_H });
          layerCuProps.shape.offset = this.scaleV({ x: padComp.m_X3, y: padComp.m_X4 });
          break;
        case PADSTACK_COMPONENT_TYPE.TYPE_SQUARE:
          layerCuProps.shape.shape = PAD_SHAPE.RECTANGLE;
          layerCuProps.shape.size = this.scaleSize({ x: padComp.m_W, y: padComp.m_W });
          layerCuProps.shape.offset = this.scaleV({ x: padComp.m_X3, y: padComp.m_X4 });
          break;
        case PADSTACK_COMPONENT_TYPE.TYPE_CIRCLE:
          layerCuProps.shape.shape = PAD_SHAPE.CIRCLE;
          layerCuProps.shape.size = this.scaleSize({ x: padComp.m_W, y: padComp.m_H });
          layerCuProps.shape.offset = this.scaleV({ x: padComp.m_X3, y: padComp.m_X4 });
          break;
        case PADSTACK_COMPONENT_TYPE.TYPE_OBLONG_X:
        case PADSTACK_COMPONENT_TYPE.TYPE_OBLONG_Y:
          layerCuProps.shape.shape = PAD_SHAPE.OVAL;
          layerCuProps.shape.size = this.scaleSize({ x: padComp.m_W, y: padComp.m_H });
          layerCuProps.shape.offset = this.scaleV({ x: padComp.m_X3, y: padComp.m_X4 });
          break;
        case PADSTACK_COMPONENT_TYPE.TYPE_ROUNDED_RECTANGLE: {
          layerCuProps.shape.shape = PAD_SHAPE.ROUNDRECT;
          layerCuProps.shape.size = this.scaleSize({ x: padComp.m_W, y: padComp.m_H });
          layerCuProps.shape.offset = this.scaleV({ x: padComp.m_X3, y: padComp.m_X4 });

          const minDim = Math.min(Math.abs(padComp.m_W), Math.abs(padComp.m_H));

          if (padComp.m_Z1.has_value() && padComp.m_Z1.value() > 0 && minDim > 0)
            layerCuProps.shape.round_rect_radius_ratio = padComp.m_Z1.value() / minDim;
          else layerCuProps.shape.round_rect_radius_ratio = 0.25;

          break;
        }
        case PADSTACK_COMPONENT_TYPE.TYPE_CHAMFERED_RECTANGLE: {
          layerCuProps.shape.shape = PAD_SHAPE.CHAMFERED_RECT;
          layerCuProps.shape.size = this.scaleSize({ x: padComp.m_W, y: padComp.m_H });
          layerCuProps.shape.offset = this.scaleV({ x: padComp.m_X3, y: padComp.m_X4 });

          const minDim = Math.min(Math.abs(padComp.m_W), Math.abs(padComp.m_H));

          if (padComp.m_Z1.has_value() && padComp.m_Z1.value() > 0 && minDim > 0)
            layerCuProps.shape.chamfered_rect_ratio = padComp.m_Z1.value() / minDim;
          else layerCuProps.shape.chamfered_rect_ratio = 0.25;

          layerCuProps.shape.chamfered_rect_positions = RECT_CHAMFER_ALL;
          break;
        }
        case PADSTACK_COMPONENT_TYPE.TYPE_OCTAGON: {
          // Approximate octagon as a round rectangle with ~29.3% corner radius
          // (tan(22.5°) ≈ 0.414, half of that as ratio ≈ 0.207, but visually 0.293 is closer)
          layerCuProps.shape.shape = PAD_SHAPE.CHAMFERED_RECT;
          layerCuProps.shape.size = this.scaleSize({ x: padComp.m_W, y: padComp.m_H });
          layerCuProps.shape.offset = this.scaleV({ x: padComp.m_X3, y: padComp.m_X4 });
          layerCuProps.shape.chamfered_rect_ratio = 1.0 - 1.0 / Math.sqrt(2.0);
          layerCuProps.shape.chamfered_rect_positions = RECT_CHAMFER_ALL;
          break;
        }
        case PADSTACK_COMPONENT_TYPE.TYPE_SHAPE_SYMBOL: {
          // Custom shape defined by a 0x28 polygon. Walk the shape's segments and build
          // a polygon primitive for this pad.
          const shapeData = this.expectBlockByKey<BLK_0x28_SHAPE>(padComp.m_StrPtr, 0x28);

          if (!shapeData) {
            trace('Padstack SHAPE_SYMBOL has no 0x28 shape', padStackName, i, padComp.m_StrPtr);
            break;
          }

          const outline = new SHAPE_LINE_CHAIN(this.buildSegmentChain(shapeData.m_FirstSegmentPtr));

          if (outline.PointCount() >= 3) {
            outline.SetClosed(true);

            layerCuProps.shape.shape = PAD_SHAPE.CUSTOM;
            layerCuProps.shape.anchor_shape = PAD_SHAPE.CIRCLE;

            // Anchor size based on the shape's bounding box center
            const bbox = outline.BBox();
            let anchorSize = Math.trunc(Math.min(bbox.GetWidth(), bbox.GetHeight()) / 4);

            if (anchorSize < 1) anchorSize = 1;

            layerCuProps.shape.size = { x: anchorSize, y: anchorSize };

            const poly = new PCB_SHAPE(null, SHAPE_T.POLY);
            poly.SetPolyShape(new SHAPE_POLY_SET(outline));
            poly.SetFilled(true);
            poly.SetWidth(0);
            layerCuProps.custom_shapes.push(poly);
          } else {
            trace(
              'Padstack SHAPE_SYMBOL produced too few points',
              padStackName,
              i,
              outline.PointCount(),
            );
          }

          break;
        }
        case PADSTACK_COMPONENT_TYPE.TYPE_PENTAGON: {
          layerCuProps.shape.shape = PAD_SHAPE.CUSTOM;
          layerCuProps.shape.anchor_shape = PAD_SHAPE.CIRCLE;
          layerCuProps.shape.offset = this.scaleV({ x: padComp.m_X3, y: padComp.m_X4 });

          const w = Math.max(padComp.m_W, 300);
          const h = Math.max(padComp.m_H, 220);

          const outline = new SHAPE_LINE_CHAIN();
          const Sx = (x: number, y: number) => this.scaleV({ x, y });
          const div = (a: number, d: number) => Math.trunc(a / d);

          // Regular pentagon with flat bottom edge
          outline.Append(Sx(0, div(-h, 2)));
          outline.Append(Sx(div(w, 2), div(-h, 6)));
          outline.Append(Sx(div(w, 3), div(h, 2)));
          outline.Append(Sx(div(-w, 3), div(h, 2)));
          outline.Append(Sx(div(-w, 2), div(-h, 6)));
          outline.SetClosed(true);

          const bbox = outline.BBox();
          let anchorSize = Math.trunc(Math.min(bbox.GetWidth(), bbox.GetHeight()) / 7);

          if (anchorSize < 1) anchorSize = 1;

          layerCuProps.shape.size = { x: anchorSize, y: anchorSize };

          const poly = new PCB_SHAPE(null, SHAPE_T.POLY);
          poly.SetPolyShape(new SHAPE_POLY_SET(outline));
          poly.SetFilled(true);
          poly.SetWidth(0);
          layerCuProps.custom_shapes.push(poly);
          break;
        }
        default:
          this.m_reporter.Report(
            `Padstack ${padStackName}: unhandled copper pad shape type ${padComp.m_Type} on layer ${i}`,
            RPT_SEVERITY_WARNING,
          );
          break;
      }

      if (antiPadComp.m_Type !== PADSTACK_COMPONENT_TYPE.TYPE_NULL) {
        // `scale( ( antiPadComp.m_W - padComp.m_W ) / 2 )`: int arithmetic
        const clearanceX = this.scale(Math.trunc((antiPadComp.m_W - padComp.m_W) / 2));

        layerCuProps.clearance = clearanceX;
      }

      if (thermalComp.m_Type !== PADSTACK_COMPONENT_TYPE.TYPE_NULL && thermalGap === null) {
        // The thermal gap is the clearance between the pad copper and the surrounding zone.
        // We derive it from the antipad-to-pad size difference.
        if (antiPadComp.m_Type !== PADSTACK_COMPONENT_TYPE.TYPE_NULL && padComp.m_W > 0) {
          const gap = this.scale(Math.trunc((antiPadComp.m_W - padComp.m_W) / 2));

          if (gap > 0) thermalGap = gap;
        }
      }

      // Padstack-level keepouts (antipad relief geometry) are handled via the
      // antipad slot in copperLayers above. Board-level keepouts use BLK_0x34.
    }

    // We have now constructed a list of copper props. We can determine the PADSTACK mode now and assign the shapes
    const padStack = new PADSTACK(aFp);

    if (copperLayers.length === 0) {
      // SMD aperture PAD or something?
    } else {
      const layersEqual = (aFrom: number, aTo: number): boolean => {
        let eq = true;
        for (let i = aFrom + 1; i < aTo; ++i) {
          const prev = copperLayers[i - 1];
          const cur = copperLayers[i];

          if (!prev || !cur || !prev.equals(cur)) {
            eq = false;
            break;
          }
        }
        return eq;
      };

      padStack.SetLayerSet(PAD.PTHMask());

      const front = copperLayers[0];
      const back = copperLayers[copperLayers.length - 1];

      if (front && back && layersEqual(0, copperLayers.length)) {
        padStack.SetMode(PADSTACK_MODE.NORMAL);
        padStack.CopperLayerMut(PCB_LAYER_ID.F_Cu).assign(front);
      } else if (front && back && layersEqual(1, copperLayers.length - 1)) {
        padStack.SetMode(PADSTACK_MODE.FRONT_INNER_BACK);
        padStack.CopperLayerMut(PCB_LAYER_ID.F_Cu).assign(front);
        padStack.CopperLayerMut(PCB_LAYER_ID.B_Cu).assign(back);

        // May be B_Cu if layers = 2, but that's OK
        if (copperLayers.length > 2 && copperLayers[1])
          padStack.CopperLayerMut(PCB_LAYER_ID.In1_Cu).assign(copperLayers[1]);
      } else {
        padStack.SetMode(PADSTACK_MODE.CUSTOM);

        for (let i = 0; i < copperLayers.length; ++i) {
          const props = copperLayers[i];

          if (!props) continue;

          let layer = PCB_LAYER_ID.F_Cu;

          if (i === 0) layer = PCB_LAYER_ID.F_Cu;
          else if (i === copperLayers.length - 1) layer = PCB_LAYER_ID.B_Cu;
          else layer = ToLAYER_ID(PCB_LAYER_ID.In1_Cu + (i - 1) * 2);

          padStack.CopperLayerMut(layer).assign(props);
        }
      }
    }

    // The drill/slot dimensions are extracted in priority order:
    //
    // 1. V172+ m_SlotAndUnknownArr[0] and [3] hold the true slot outline dimensions (X and Y).
    //    For routed slots (round drill bit + routing path), m_DrillArr only has the bit diameter,
    //    while m_SlotAndUnknownArr has the full slot envelope.
    //
    // 2. V172+ m_DrillArr[4] (width) and m_DrillArr[7] (height, 0 for round).
    //    These match m_SlotAndUnknownArr for punched oblong drills but only have the bit
    //    diameter for routed slots.
    //
    // 3. Pre-V172 m_Drill field (drill diameter, always round).
    let drillW = 0;
    let drillH = 0;

    const hdr = aPadstack.m_Header;

    if (hdr instanceof HEADER_v16x) {
      if (hdr.m_SlotY > 0) {
        drillW = this.scale(hdr.m_SlotX | 0);
        drillH = this.scale(hdr.m_SlotY | 0);
      } else {
        drillW = this.scale(aPadstack.GetDrillSize() | 0);
      }
    } else {
      if (hdr.m_SlotY > 0) {
        drillW = this.scale(hdr.m_SlotX | 0);
        drillH = this.scale(hdr.m_SlotY | 0);
      } else {
        drillW = this.scale(hdr.m_DrillSize | 0);
      }
    }

    if (drillH === 0) drillH = drillW;

    // Allegro stores slot dimensions as (primary, secondary) regardless of orientation,
    // not as (X, Y). Compare the first copper layer pad's aspect ratio to determine if
    // the drill needs to be rotated 90 degrees.
    if (drillW !== drillH && aPadstack.GetLayerCount() > 0) {
      const firstCopperIdx = aPadstack.m_NumFixedCompEntries;
      const firstPadComp = aPadstack.m_Components[firstCopperIdx + LAYER_COMP_SLOT.PAD]!;

      const padIsTaller = Math.abs(firstPadComp.m_H) > Math.abs(firstPadComp.m_W);
      const drillIsTaller = drillH > drillW;

      if (padIsTaller !== drillIsTaller) [drillW, drillH] = [drillH, drillW];
    }

    const isSmd = drillW === 0 || aPadstack.GetLayerCount() === 1;

    if (isSmd) {
      padStack.Drill().size = { x: 0, y: 0 };
    } else {
      padStack.Drill().size = { x: drillW, y: drillH };

      if (drillW !== drillH) padStack.Drill().shape = PAD_DRILL_SHAPE.OBLONG;
      else padStack.Drill().shape = PAD_DRILL_SHAPE.CIRCLE;
    }

    const pad = new PAD(aFp);
    pad.SetPadstack(padStack);
    pad.SetNumber(aPadName);
    pad.SetNetCode(aNetcode);

    if (isSmd) {
      pad.SetAttribute(PAD_ATTRIB.SMD);
      pad.SetLayerSet(PAD.SMDMask());
    } else if (aPadstack.IsPlated()) {
      pad.SetAttribute(PAD_ATTRIB.PTH);
      pad.SetLayerSet(PAD.PTHMask());
    } else {
      pad.SetAttribute(PAD_ATTRIB.NPTH);
      pad.SetLayerSet(PAD.UnplatedHoleMask());
    }

    if (thermalGap !== null) pad.SetThermalGap(thermalGap);

    // Now, for each technical layer, we see if we can include it into the existing padstack, or if we need to add
    // it as a standalone pad
    for (let i = 0; i < aPadstack.m_NumFixedCompEntries; ++i) {
      const psComp = aPadstack.m_Components[i]!;

      // Knock off known layers that are clearly null
      if (psComp.m_Type === PADSTACK_COMPONENT_TYPE.TYPE_NULL) {
        const without = (aLayer: PCB_LAYER_ID) =>
          pad.SetLayerSet(new LSET(pad.GetLayerSet()).reset(aLayer));

        if (this.m_brdDb.m_FmtVer < FMT_VER.V_165) {
          if (i === PADSTACK_SLOTS.SOLDERMASK_TOP_V16X) without(PCB_LAYER_ID.F_Mask);
          else if (i === PADSTACK_SLOTS.PASTEMASK_TOP_V16X) without(PCB_LAYER_ID.F_Paste);
        } else if (this.m_brdDb.m_FmtVer < FMT_VER.V_172) {
          if (i === PADSTACK_SLOTS.SOLDERMASK_TOP_V165) without(PCB_LAYER_ID.F_Mask);
          else if (i === PADSTACK_SLOTS.PASTEMASK_TOP_V165) without(PCB_LAYER_ID.F_Paste);
        } else {
          if (i === PADSTACK_SLOTS.SOLDERMASK_TOP_V17X) without(PCB_LAYER_ID.F_Mask);
          else if (i === PADSTACK_SLOTS.SOLDERMASK_BOT_V17X) without(PCB_LAYER_ID.B_Mask);
          else if (i === PADSTACK_SLOTS.PASTEMASK_TOP_V17X) without(PCB_LAYER_ID.F_Paste);
          else if (i === PADSTACK_SLOTS.PASTEMASK_BOT_V17X) without(PCB_LAYER_ID.B_Paste);
        }

        continue;
      }

      // All fixed slots are technical layers (solder mask, paste mask, film mask,
      // assembly variant, etc). Custom mask expansion extraction is not yet implemented;
      // KiCad's default pad-matches-mask behavior applies.
    }

    padItems.push(pad);

    return padItems;
  }

  private buildFootprint(aFpInstance: BLK_0x2D_FOOTPRINT_INST): FOOTPRINT | null {
    const fp = new FOOTPRINT(this.m_board);

    const fpInstData = this.getFpInstRef(aFpInstance);

    const backSide = aFpInstance.m_Layer !== 0;

    let refDesStr = '';
    if (fpInstData) {
      refDesStr = this.m_brdDb.GetString(fpInstData.m_RefDesStrPtr);

      if (refDesStr === '') {
        // Does this happen even when there's an 0x07 block?
        this.m_reporter.Report(
          `Empty ref des for 0x2D key ${hex010(aFpInstance.m_Key)}`,
          RPT_SEVERITY_WARNING,
        );
      }
    }

    // We may update the PCB_FIELD layer if it's specified explicitly (e.g. with font size and so on),
    // but if not, set the refdes at least, but make it invisible
    fp.SetReference(refDesStr);
    fp.GetField(FIELD_T.REFERENCE)!.SetVisible(false);

    const fpPos = this.scaleV({ x: aFpInstance.m_CoordX, y: aFpInstance.m_CoordY });

    {
      let rotation = fromMillidegrees(aFpInstance.m_Rotation);

      if (backSide) rotation = ANGLE_180.sub(rotation);

      fp.SetPosition(fpPos);
      fp.SetOrientation(rotation);
    }

    // Allegro stores placed instance data in board-absolute form: bottom-side
    // components already have shapes on bottom layers with bottom-side positions.
    // KiCad stores footprints in canonical front-side form and uses Flip() to
    // mirror both positions and layers to the back side.
    //
    // Move back-layer items to their front-side counterpart so that fp->Flip()
    // consistently mirrors positions AND layers for all children.
    //
    // Even if there isn't a layer flip, the postions still need to be flipped.
    const canonicalizeLayer = (aItem: BOARD_ITEM) => {
      if (backSide) aItem.Flip(fpPos, FLIP_DIRECTION.LEFT_RIGHT);
    };

    const graphicsWalker = new LL_WALKER(aFpInstance.m_GraphicPtr, aFpInstance.m_Key, this.m_brdDb);

    for (const graphicsBlock of graphicsWalker) {
      const type = graphicsBlock.GetBlockType();

      if (type === 0x14) {
        const shapes = this.buildShapes(BlockDataAs<BLK_0x14_GRAPHIC>(graphicsBlock), fp);

        for (const shape of shapes) {
          canonicalizeLayer(shape);
          fp.Add(shape);
        }
      } else {
        this.m_reporter.Report(
          `Unexpected type in graphics list: ${hex04(type)}`,
          RPT_SEVERITY_WARNING,
        );
      }
    }

    let valueFieldSet = false;

    const textWalker = new LL_WALKER(aFpInstance.m_TextPtr, aFpInstance.m_Key, this.m_brdDb);

    for (const textBlock of textWalker) {
      if (textBlock.GetBlockType() !== 0x30) continue;

      const strWrapper = BlockDataAs<BLK_0x30_STR_WRAPPER>(textBlock);

      const text = this.buildPcbText(strWrapper, fp);

      if (!text) continue;

      canonicalizeLayer(text);

      const textClass = strWrapper.m_Layer.m_Class;
      const textSubclass = strWrapper.m_Layer.m_Subclass;

      const isSilk = textSubclass === S.SILKSCREEN_TOP || textSubclass === S.SILKSCREEN_BOTTOM;
      const isAssembly = textSubclass === S.ASSEMBLY_TOP || textSubclass === S.ASSEMBLY_BOTTOM;

      if (textClass === C.REF_DES && isSilk) {
        // Visible silkscreen refdes updates the built-in REFERENCE field.
        const refDes = fp.GetField(FIELD_T.REFERENCE)!;

        // KiCad netlisting requires non-digit + digit annotation.
        if (
          text.GetText() !== '' &&
          !/\p{Alphabetic}/u.test(String.fromCodePoint(text.GetText().codePointAt(0)!))
        )
          text.SetText(`UNK${text.GetText()}`);

        refDes.assignPcbField(new PCB_FIELD(text, FIELD_T.REFERENCE));
      } else if (textClass === C.REF_DES && isAssembly) {
        // Assembly refdes becomes a user field with the KiCad reference variable
        const field = new PCB_FIELD(text, FIELD_T.USER, 'Ref Des');
        field.SetText('${REFERENCE}');
        field.SetVisible(false);
        fp.Add(field, ADD_MODE.APPEND);
      } else if (textClass === C.COMPONENT_VALUE && isAssembly) {
        if (!valueFieldSet) {
          // First COMPONENT_VALUE on assembly updates the built-in VALUE field
          const valField = fp.GetField(FIELD_T.VALUE)!;
          valField.assignPcbField(new PCB_FIELD(text, FIELD_T.VALUE));
          valField.SetVisible(false);
          valueFieldSet = true;
        } else {
          const field = new PCB_FIELD(text, FIELD_T.USER, 'Component Value');
          field.SetVisible(false);
          fp.Add(field, ADD_MODE.APPEND);
        }
      } else if (textClass === C.DEVICE_TYPE) {
        const field = new PCB_FIELD(text, FIELD_T.USER, 'Device Type');
        field.SetVisible(!isAssembly);
        fp.Add(field, ADD_MODE.APPEND);
      } else if (textClass === C.TOLERANCE) {
        const field = new PCB_FIELD(text, FIELD_T.USER, 'Tolerance');
        field.SetVisible(isSilk);
        fp.Add(field, ADD_MODE.APPEND);
      } else if (textClass === C.USER_PART_NUMBER) {
        const field = new PCB_FIELD(text, FIELD_T.USER, 'User Part Number');
        field.SetVisible(isSilk);
        fp.Add(field, ADD_MODE.APPEND);
      } else if (textClass === C.COMPONENT_VALUE && isSilk) {
        const field = new PCB_FIELD(text, FIELD_T.USER, 'Component Value');
        field.SetVisible(true);
        fp.Add(field, ADD_MODE.APPEND);
      } else {
        fp.Add(text);
      }
    }

    // Assembly drawing
    const assemblyWalker = new LL_WALKER(
      aFpInstance.m_AssemblyPtr,
      aFpInstance.m_Key,
      this.m_brdDb,
    );

    for (const assemblyBlock of assemblyWalker) {
      for (const item of this.buildGraphicItems(assemblyBlock, fp)) {
        canonicalizeLayer(item);
        fp.Add(item);
      }
    }

    // Areas (courtyards, etc)
    const areaWalker = new LL_WALKER(aFpInstance.m_AreasPtr, aFpInstance.m_Key, this.m_brdDb);

    // Probably don't need this as we can't have filled zone, but it's cheap
    const zoneFillHandler = new ZONE_FILL_HANDLER();

    for (const areaBlock of areaWalker) {
      const layerInfo = tryLayerFromBlock(areaBlock);

      if (layerInfo !== null && layerIsZone(layerInfo)) {
        // Zone within a footprint - we can handle keepouts at least
        const zone = this.buildZone(areaBlock, [], zoneFillHandler);
        if (zone) {
          canonicalizeLayer(zone);
          fp.Add(zone);
        }
      } else {
        for (const item of this.buildGraphicItems(areaBlock, fp)) {
          canonicalizeLayer(item);

          // If we find shapes in the areas list, they are (presumably) filled.
          // Maybe there's a flag to look at rather than just assuming this?
          if (item.Type() === KICAD_T.PCB_SHAPE_T) {
            const shape = item as PCB_SHAPE;

            // But in KiCad, courtyards are usually not filled even if they come in as "areas"
            if (
              shape.GetLayer() !== PCB_LAYER_ID.F_CrtYd &&
              shape.GetLayer() !== PCB_LAYER_ID.B_CrtYd
            )
              shape.SetFilled(true);
          }

          fp.Add(item);
        }
      }
    }

    // Find the pads
    const padWalker = new LL_WALKER(aFpInstance.m_FirstPadPtr, aFpInstance.m_Key, this.m_brdDb);
    padWalker.SetNextFunc(PadGetNextInFootprint);
    for (const padBlock of padWalker) {
      const placedPadInfo = BlockDataAs<BLK_0x32_PLACED_PAD>(padBlock);

      const netAssignment = this.expectBlockByKey<BLK_0x04_NET_ASSIGNMENT>(
        placedPadInfo.m_NetPtr,
        0x04,
      );
      const padInfo = this.expectBlockByKey<BLK_0x0D_PAD>(placedPadInfo.m_PadPtr, 0x0d);

      if (!padInfo) continue;

      const padStack = this.expectBlockByKey<BLK_0x1C_PADSTACK>(padInfo.m_PadStack, 0x1c);

      if (!padStack) continue;

      let netCode = NETINFO_LIST.UNCONNECTED;

      if (netAssignment) {
        const kiNet = this.m_netCache.get(netAssignment.m_Net);
        if (kiNet !== undefined) netCode = kiNet.GetNetCode();
      }

      const padName = this.m_brdDb.GetString(padInfo.m_NameStrId);

      // 0x0D coordinates and rotation are in the footprint's local (unrotatesinced) space.
      // Use SetFPRelativePosition/Orientation to let KiCad handle the transform to
      // board-absolute coordinates (rotating by FP orientation and adding FP position).
      let padLocalPos = this.scaleV({ x: padInfo.m_CoordsX, y: padInfo.m_CoordsY });
      let padLocalRot = fromMillidegrees(padInfo.m_Rotation);

      // Unlike other items, pads in "canonical front side form" - a normal pad is on F.Cu already,
      // but the positions, like all the other items, are in board-absolute form, so we need to pre-transform
      // so that the final footprint flip puts them in the right place.
      if (backSide) {
        padLocalPos = RotatePoint(padLocalPos, ANGLE_180);
        padLocalRot = padLocalRot.add(ANGLE_180);
      }

      for (const item of this.buildPadItems(padStack, fp, padName, netCode)) {
        if (item.Type() === KICAD_T.PCB_PAD_T) (item as PAD).SetFPRelativeOrientation(padLocalRot);

        item.SetFPRelativePosition(padLocalPos);
        fp.Add(item);
      }
    }

    // Flip AFTER adding all children so that graphics, text, and pads all get
    // their layers and positions mirrored correctly for bottom-layer footprints.
    // We have carefully constructed a front-side canonical form by applying
    // pre-transforms to compensate for the coming Flip().
    if (backSide) fp.Flip(fpPos, FLIP_DIRECTION.LEFT_RIGHT);

    return fp;
  }

  private buildTrack(aTrackBlock: BLK_0x05_TRACK, aNetCode: number): BOARD_ITEM[] {
    const items: BOARD_ITEM[] = [];

    // Anti-etch tracks are thermal relief patterns generated by Allegro.
    // These are handled by pad-level thermal relief properties instead.
    if (aTrackBlock.m_Layer.m_Class === C.ANTI_ETCH) return items;

    const layer = this.getLayer(aTrackBlock.m_Layer);

    const segWalker = new LL_WALKER(aTrackBlock.m_FirstSegPtr, aTrackBlock.m_Key, this.m_brdDb);
    for (const block of segWalker) {
      const segType = block.GetBlockType();

      switch (segType) {
        case 0x15:
        case 0x16:
        case 0x17: {
          const segInfo = BlockDataAs<BLK_0x15_16_17_SEGMENT>(block);

          const start = { x: segInfo.m_StartX, y: segInfo.m_StartY };
          const end = { x: segInfo.m_EndX, y: segInfo.m_EndY };
          const width = segInfo.m_Width | 0;

          const seg = new PCB_TRACK(this.m_board as unknown as BOARD_ITEM);

          seg.SetNetCode(aNetCode);
          seg.SetLayer(layer);

          seg.SetStart(this.scaleV(start));
          seg.SetEnd(this.scaleV(end));
          seg.SetWidth(this.scale(width));

          items.push(seg);
          break;
        }
        case 0x01: {
          const arcInfo = BlockDataAs<BLK_0x01_ARC>(block);

          const start = this.scaleV({ x: arcInfo.m_StartX, y: arcInfo.m_StartY });
          const end = this.scaleV({ x: arcInfo.m_EndX, y: arcInfo.m_EndY });
          const c = this.scaleV(kiroundV(arcInfo.m_CenterX, arcInfo.m_CenterY));
          const width = this.scale(arcInfo.m_Width | 0);

          const clockwise = (arcInfo.m_SubType & 0x40) !== 0;

          const mid = arcMid(start, end, c, clockwise);

          const arc = new PCB_ARC(this.m_board as unknown as BOARD_ITEM);

          arc.SetNetCode(aNetCode);
          arc.SetLayer(layer);

          arc.SetStart(start);
          arc.SetMid(mid);
          arc.SetEnd(end);
          arc.SetWidth(width);

          items.push(arc);
          break;
        }
        default:
          trace('Unhandled segment type in track', segType);
          break;
      }
    }
    return items;
  }

  private buildVia(aViaData: BLK_0x33_VIA, aNetCode: number): BOARD_ITEM | null {
    const viaPos = { x: aViaData.m_CoordsX, y: aViaData.m_CoordsY };

    const viaPadstack = this.expectBlockByKey<BLK_0x1C_PADSTACK>(aViaData.m_Padstack, 0x1c);

    if (!viaPadstack) return null;

    const via = new PCB_VIA(this.m_board as unknown as BOARD_ITEM);
    via.SetPosition(this.scaleV(viaPos));
    via.SetNetCode(aNetCode);

    via.SetTopLayer(PCB_LAYER_ID.F_Cu);
    via.SetBottomLayer(PCB_LAYER_ID.B_Cu);

    // Extract via size from the first copper layer's pad component
    let viaWidth = 0;

    if (viaPadstack.GetLayerCount() > 0) {
      const layerBaseIndex = viaPadstack.m_NumFixedCompEntries;
      const padComp = viaPadstack.m_Components[layerBaseIndex + LAYER_COMP_SLOT.PAD]!;

      if (padComp.m_Type !== PADSTACK_COMPONENT_TYPE.TYPE_NULL) viaWidth = this.scale(padComp.m_W);
    }

    let viaDrill = this.scale(viaPadstack.GetDrillSize() | 0);

    if (viaDrill === 0) viaDrill = Math.trunc(viaWidth / 2);

    if (viaWidth <= 0) viaWidth = viaDrill * 2;

    via.SetWidth(PCB_LAYER_ID.F_Cu, viaWidth);
    via.SetDrill(viaDrill);

    return via;
  }

  private createTracks(): void {
    trace('Creating tracks, vias, and other routed items');

    const newItems: BOARD_ITEM[] = [];

    // We need to walk this list again - we could do this all in createNets, but this seems tidier.
    const netWalker = new LL_WALKER(this.m_brdDb.m_Header!.m_LL_0x1B_Nets, this.m_brdDb);
    for (const block of netWalker) {
      const type = block.GetBlockType();
      if (type !== BLOCK_TYPE.x1B_NET) {
        this.reportUnexpectedBlockType(type, BLOCK_TYPE.x1B_NET, 0, block.GetOffset(), 'Net');
        continue;
      }

      const net = BlockDataAs<BLK_0x1B_NET>(block);

      const kiNet = this.m_netCache.get(net.m_Key);

      if (kiNet === undefined) continue;

      const netCode = kiNet.GetNetCode();

      const assignmentWalker = new LL_WALKER(net.m_Assignment, net.m_Key, this.m_brdDb);
      for (const assignBlock of assignmentWalker) {
        if (assignBlock.GetBlockType() !== 0x04) {
          this.reportUnexpectedBlockType(
            assignBlock.GetBlockType(),
            0x04,
            0,
            block.GetOffset(),
            'Net assignment',
          );
          continue;
        }

        const assign = BlockDataAs<BLK_0x04_NET_ASSIGNMENT>(assignBlock);

        // Walk the 0x05/0x32/... list
        const connWalker = new LL_WALKER(assign.m_ConnItem, assign.m_Key, this.m_brdDb);
        for (const connItemBlock of connWalker) {
          const connType = connItemBlock.GetBlockType();

          // One connected item can be multiple KiCad objects, e.g.
          // 0x05 track -> list of segments/arcs
          let newItemList: (BOARD_ITEM | null)[] = [];

          switch (connType) {
            // Track
            case 0x05: {
              newItemList = this.buildTrack(BlockDataAs<BLK_0x05_TRACK>(connItemBlock), netCode);
              break;
            }
            case 0x33: {
              newItemList.push(this.buildVia(BlockDataAs<BLK_0x33_VIA>(connItemBlock), netCode));
              break;
            }
            case 0x32: {
              // This is a pad in a footprint - we don't need to handle this here, as we do all the footprint
              // pads, connected or not, in the footprint step.
              break;
            }
            case 0x28: {
              // 0x28 shapes on the net chain are computed copper fills.
              // Collect them for teardrop and polygon import.
              const fillShape = BlockDataAs<BLK_0x28_SHAPE>(connItemBlock);

              const fillLayer = this.getLayer(fillShape.m_Layer);

              if (fillLayer !== PCB_LAYER_ID.UNDEFINED_LAYER)
                this.m_zoneFillShapes.set(fillShape.m_Key, {
                  shape: fillShape,
                  netCode,
                  layer: fillLayer,
                });

              break;
            }
            default: {
              trace('  Unhandled connected item code', connType);
            }
          }

          for (const newItem of newItemList) {
            // `m_board.Add( nullptr )` asserts and adds nothing; newItems still holds the null
            newItems.push(newItem as BOARD_ITEM);
            this.m_board.Add(newItem, ADD_MODE.BULK_APPEND);
          }
        }
      }
    }

    this.m_board.FinalizeBulkAdd(newItems.filter((i) => i !== null));
  }

  private createBoardShapes(): void {
    trace('Creating shapes');

    const header = this.m_brdDb.m_Header!;

    // Walk through LL_0x24_0x28 which contains rectangles (0x24) and shapes (0x28)
    const shapeWalker = new LL_WALKER(header.m_LL_0x24_0x28, this.m_brdDb);

    const newItems: BOARD_ITEM[] = [];

    for (const block of shapeWalker) {
      switch (block.GetBlockType()) {
        case 0x24: {
          const rectData = BlockDataAs<BLK_0x24_RECT>(block);

          // These are zones, we don't handle them here
          if (layerIsZone(rectData.m_Layer)) continue;

          newItems.push(
            this.buildRect24(rectData, this.m_board as unknown as BOARD_ITEM_CONTAINER),
          );
          break;
        }
        case 0x28: {
          const shapeData = BlockDataAs<BLK_0x28_SHAPE>(block);

          // These are zones, we don't handle them here
          if (layerIsZone(shapeData.m_Layer)) continue;

          for (const shapeItem of this.buildPolygonShapes(
            shapeData,
            this.m_board as unknown as BOARD_ITEM_CONTAINER,
          ))
            newItems.push(shapeItem);
          break;
        }
        default: {
          trace('  Unhandled block type in outline walker', block.GetBlockType());
          break;
        }
      }
    }

    const outline2Walker = new LL_WALKER(header.m_LL_Shapes, this.m_brdDb);
    for (const block of outline2Walker) {
      switch (block.GetBlockType()) {
        case 0x0e: {
          const rectData = BlockDataAs<BLK_0x0E_RECT>(block);

          if (layerIsZone(rectData.m_Layer)) continue;

          newItems.push(
            this.buildRect0E(rectData, this.m_board as unknown as BOARD_ITEM_CONTAINER),
          );
          break;
        }
        case 0x24: {
          const rectData = BlockDataAs<BLK_0x24_RECT>(block);

          if (layerIsZone(rectData.m_Layer)) continue;

          newItems.push(
            this.buildRect24(rectData, this.m_board as unknown as BOARD_ITEM_CONTAINER),
          );
          break;
        }
        case 0x28: {
          const shapeData = BlockDataAs<BLK_0x28_SHAPE>(block);

          if (layerIsZone(shapeData.m_Layer)) continue;

          for (const shapeItem of this.buildPolygonShapes(
            shapeData,
            this.m_board as unknown as BOARD_ITEM_CONTAINER,
          ))
            newItems.push(shapeItem);
          break;
        }
        default: {
          trace('  Unhandled block type in outline walker', block.GetBlockType());
          break;
        }
      }
    }

    const graphicContainerWalker = new LL_WALKER(header.m_LL_0x14, this.m_brdDb);
    for (const block of graphicContainerWalker) {
      switch (block.GetBlockType()) {
        case 0x14: {
          const graphicContainer = BlockDataAs<BLK_0x14_GRAPHIC>(block);

          if (layerIsZone(graphicContainer.m_Layer)) continue;

          for (const item of this.buildShapes(
            graphicContainer,
            this.m_board as unknown as BOARD_ITEM_CONTAINER,
          ))
            newItems.push(item);
          break;
        }
        default: {
          trace('  Unhandled block type in graphic container walker', block.GetBlockType());
          break;
        }
      }
    }

    for (const item of newItems) this.m_board.Add(item, ADD_MODE.BULK_APPEND);

    this.m_board.FinalizeBulkAdd(newItems);
  }

  /**
   * Walk a geometry chain (0x01 arcs and 0x15-17 segments) starting from the given key,
   * following m_Next links. Used for building hole outlines from 0x34 KEEPOUT blocks.
   *
   * Returns the cached chain itself, as the C++ returns a const reference: every
   * caller takes a copy before changing it.
   */
  private buildSegmentChain(aStartKey: number): SHAPE_LINE_CHAIN {
    const cached = this.m_segChainCache.get(aStartKey);

    if (cached !== undefined) return cached;

    const outline = new SHAPE_LINE_CHAIN();
    this.m_segChainCache.set(aStartKey, outline);
    let currentKey = aStartKey;

    // Safety limit to prevent infinite loops on corrupt data
    const MAX_CHAIN_LENGTH = 50000;
    let visited = 0;

    while (currentKey !== 0 && visited < MAX_CHAIN_LENGTH) {
      const block = this.m_brdDb.GetObjectByKey(currentKey);

      if (!block) break;

      visited++;

      switch (block.GetBlockType()) {
        case 0x01: {
          const arc = BlockDataAs<BLK_0x01_ARC>(block);
          this.appendArc(outline, arc);
          currentKey = arc.m_Next;
          break;
        }
        case 0x15:
        case 0x16:
        case 0x17: {
          const seg = BlockDataAs<BLK_0x15_16_17_SEGMENT>(block);
          this.appendSegment(outline, seg);
          currentKey = seg.m_Next;
          break;
        }
        default:
          currentKey = 0;
          break;
      }
    }

    return outline;
  }

  /** The 0x01 arm both outline walkers share. */
  private appendArc(aOutline: SHAPE_LINE_CHAIN, aArc: BLK_0x01_ARC): void {
    const start = this.scaleV({ x: aArc.m_StartX, y: aArc.m_StartY });
    const end = this.scaleV({ x: aArc.m_EndX, y: aArc.m_EndY });
    const center = this.scaleV(kiroundV(aArc.m_CenterX, aArc.m_CenterY));

    if (veq(start, end)) {
      aOutline.Append(new SHAPE_ARC(center, start, ANGLE_360));
    } else {
      const clockwise = (aArc.m_SubType & 0x40) !== 0;
      aOutline.Append(new SHAPE_ARC(start, arcMid(start, end, center, clockwise), end, 0));
    }
  }

  /** The 0x15-17 arm both outline walkers share. */
  private appendSegment(aOutline: SHAPE_LINE_CHAIN, aSeg: BLK_0x15_16_17_SEGMENT): void {
    const start = this.scaleV({ x: aSeg.m_StartX, y: aSeg.m_StartY });

    if (aOutline.PointCount() === 0 || !veq(aOutline.CLastPoint(), start)) aOutline.Append(start);

    const end = this.scaleV({ x: aSeg.m_EndX, y: aSeg.m_EndY });
    aOutline.Append(end);
  }

  private buildRectOutline(aCoords: readonly number[], aRotation: number): SHAPE_LINE_CHAIN {
    const outline = new SHAPE_LINE_CHAIN();

    const topLeft = this.scaleV({ x: aCoords[0]!, y: aCoords[1]! });
    const botRight = this.scaleV({ x: aCoords[2]!, y: aCoords[3]! });
    const topRight = { x: botRight.x, y: topLeft.y };
    const botLeft = { x: topLeft.x, y: botRight.y };

    outline.Append(topLeft);
    outline.Append(topRight);
    outline.Append(botRight);
    outline.Append(botLeft);

    const angle = fromMillidegrees(aRotation);
    outline.Rotate(angle, topLeft);

    return outline;
  }

  /** `buildOutline( const BLK_0x0E_RECT& )`. */
  private buildOutline0E(aRect: BLK_0x0E_RECT): SHAPE_LINE_CHAIN {
    return this.buildRectOutline(aRect.m_Coords, aRect.m_Rotation);
  }

  /** `buildOutline( const BLK_0x24_RECT& )`. */
  private buildOutline24(aRect: BLK_0x24_RECT): SHAPE_LINE_CHAIN {
    return this.buildRectOutline(aRect.m_Coords, aRect.m_Rotation);
  }

  /** `buildOutline( const BLK_0x28_SHAPE& )`. */
  private buildOutline28(aShape: BLK_0x28_SHAPE): SHAPE_LINE_CHAIN {
    const outline = new SHAPE_LINE_CHAIN();
    const segWalker = new LL_WALKER(aShape.m_FirstSegmentPtr, aShape.m_Key, this.m_brdDb);

    for (const segBlock of segWalker) {
      switch (segBlock.GetBlockType()) {
        case 0x01:
          this.appendArc(outline, BlockDataAs<BLK_0x01_ARC>(segBlock));
          break;
        case 0x15:
        case 0x16:
        case 0x17:
          this.appendSegment(outline, BlockDataAs<BLK_0x15_16_17_SEGMENT>(segBlock));
          break;
        default:
          trace('    Unhandled segment type in shape outline', segBlock.GetBlockType());
          break;
      }
    }

    return outline;
  }

  private shapeToPolySet(aShape: BLK_0x28_SHAPE): SHAPE_POLY_SET {
    const polySet = new SHAPE_POLY_SET();
    const outline = new SHAPE_LINE_CHAIN(this.buildSegmentChain(aShape.m_FirstSegmentPtr));

    if (outline.PointCount() < 3) {
      trace('  Not enough points for polygon', outline.PointCount());
      return polySet;
    }

    outline.SetClosed(true);
    polySet.AddOutline(outline);

    // Walk 0x34 KEEPOUT chain from m_Ptr4 for holes
    let holeKey = aShape.m_FirstKeepoutPtr;

    while (holeKey !== 0) {
      const holeBlock = this.m_brdDb.GetObjectByKey(holeKey);

      if (!holeBlock || holeBlock.GetBlockType() !== 0x34) break;

      const keepout = BlockDataAs<BLK_0x34_KEEPOUT>(holeBlock);

      const holeOutline = new SHAPE_LINE_CHAIN(this.buildSegmentChain(keepout.m_FirstSegmentPtr));

      if (holeOutline.PointCount() >= 3) {
        holeOutline.SetClosed(true);
        polySet.AddHole(holeOutline);
      }

      holeKey = keepout.m_Next;
    }

    return polySet;
  }

  /**
   * Try to build a zone shape for the given block, with holes.
   */
  private tryBuildZoneShape(aBlock: BLOCK_BASE): SHAPE_POLY_SET {
    let polySet = new SHAPE_POLY_SET();

    switch (aBlock.GetBlockType()) {
      case 0x0e: {
        const chain = new SHAPE_LINE_CHAIN(this.buildOutline0E(BlockDataAs<BLK_0x0E_RECT>(aBlock)));
        chain.SetClosed(true);

        polySet = new SHAPE_POLY_SET(chain);
        break;
      }
      case 0x14: {
        const graphicContainer = BlockDataAs<BLK_0x14_GRAPHIC>(aBlock);

        const chain = new SHAPE_LINE_CHAIN(this.buildSegmentChain(graphicContainer.m_SegmentPtr));
        chain.SetClosed(true);

        polySet = new SHAPE_POLY_SET(chain);
        break;
      }
      case 0x24: {
        const chain = new SHAPE_LINE_CHAIN(this.buildOutline24(BlockDataAs<BLK_0x24_RECT>(aBlock)));
        chain.SetClosed(true);

        polySet = new SHAPE_POLY_SET(chain);
        break;
      }
      case 0x28: {
        polySet = this.shapeToPolySet(BlockDataAs<BLK_0x28_SHAPE>(aBlock));
        break;
      }
      default:
        trace('  Unhandled block type in tryBuildZoneShape', aBlock.GetBlockType());
    }

    return polySet;
  }

  /**
   * Build a ZONE from an 0x0E, 0x24 or 0x28 block.
   *
   * @param aRelatedBlocks are blocks to get net (0x1B) and fill (0x28) info from
   * @param aZoneFillHandler is a management object for efficiently dealing with filled zones
   */
  private buildZone(
    aBoundaryBlock: BLOCK_BASE,
    aRelatedBlocks: readonly (BLOCK_BASE | null)[],
    aZoneFillHandler: ZONE_FILL_HANDLER,
  ): ZONE | null {
    let netCode = NETINFO_LIST.UNCONNECTED;
    const layerInfo = expectLayerFromBlock(aBoundaryBlock);

    const isCopperZone = layerInfo.m_Class === C.ETCH || layerInfo.m_Class === C.BOUNDARY;

    let layer = PCB_LAYER_ID.UNDEFINED_LAYER;

    if (isCopperZone) {
      // BOUNDARY shares the ETCH layer list, so resolve subclass via ETCH class
      if (layerInfo.m_Class === C.BOUNDARY)
        layer = this.getLayer({ m_Class: C.ETCH, m_Subclass: layerInfo.m_Subclass });
      else layer = this.getLayer(layerInfo);
    } else {
      layer = PCB_LAYER_ID.F_Cu;
    }

    if (isCopperZone && layer === PCB_LAYER_ID.UNDEFINED_LAYER) {
      trace('  Skipping shape - unmapped copper layer', layerInfo.m_Class, layerInfo.m_Subclass);
      return null;
    }

    const zoneShape = this.tryBuildZoneShape(aBoundaryBlock);

    if (zoneShape.OutlineCount() !== 1) {
      trace(
        '  Skipping zone - failed to build outline',
        aBoundaryBlock.GetBlockType(),
        aBoundaryBlock.GetKey(),
      );
      return null;
    }

    const zone = new ZONE(this.m_board as unknown as BOARD_ITEM_CONTAINER);
    zone.SetHatchStyle(ZONE_BORDER_DISPLAY_STYLE.NO_HATCH);

    if (isCopperZone) {
      zone.SetLayer(layer);
      zone.SetFillMode(ZONE_FILL_MODE.POLYGONS);
    } else {
      const layerSet = this.m_layerMapper.GetRuleAreaLayers(layerInfo);

      const isRouteKeepout = layerInfo.m_Class === C.ROUTE_KEEPOUT;
      const isViaKeepout = layerInfo.m_Class === C.VIA_KEEPOUT;
      const isPackageKeepout = layerInfo.m_Class === C.PACKAGE_KEEPOUT;
      const isRouteKeepin = layerInfo.m_Class === C.ROUTE_KEEPIN;
      const isPackageKeepin = layerInfo.m_Class === C.PACKAGE_KEEPIN;

      zone.SetIsRuleArea(true);
      zone.SetLayerSet(layerSet);
      zone.SetDoNotAllowTracks(isRouteKeepout);
      zone.SetDoNotAllowVias(isViaKeepout);
      zone.SetDoNotAllowZoneFills(isRouteKeepout || isViaKeepout);
      zone.SetDoNotAllowPads(false);
      zone.SetDoNotAllowFootprints(isPackageKeepout);

      // Zones don't have native keepin functions, so we leave a note for the user here
      // Later, we could consider adding a custom DRC rule for this (or KiCad could add native keepin
      // zone support)
      if (isRouteKeepin) zone.SetZoneName('Route Keepin');
      else if (isPackageKeepin) zone.SetZoneName('Package Keepin');
    }

    const combinedFill = new SHAPE_POLY_SET();

    for (const block of aRelatedBlocks) {
      if (!block) continue;

      switch (block.GetBlockType()) {
        case 0x1b: {
          const kiNet = this.m_netCache.get(block.GetKey());

          if (kiNet !== undefined) {
            netCode = kiNet.GetNetCode();
          } else {
            this.m_reporter.Report(
              `Could not find net key ${hex010(block.GetKey())} in cache for BOUNDARY ${hex010(aBoundaryBlock.GetKey())}`,
              RPT_SEVERITY_WARNING,
            );
          }
          break;
        }
        case 0x28: {
          const fillPolySet = this.shapeToPolySet(BlockDataAs<BLK_0x28_SHAPE>(block));
          combinedFill.Append(fillPolySet);
          this.m_usedZoneFillShapes.add(block.GetKey());
          break;
        }
        default:
          break;
      }
    }

    // Set net code AFTER layer assignment. SetNetCode checks IsOnCopperLayer() and
    // forces net=0 if the zone isn't on a copper layer yet.
    zone.SetNetCode(netCode);

    for (const chain of zoneShape.CPolygon(0)) zone.AddPolygon(chain);

    // Add zone fills
    if (isCopperZone && !combinedFill.IsEmpty()) {
      // We don't do this here, though it feels like we should. We collect the
      // information for batch processing later on (which is conceptually
      // easier to parallelise compared to this function).
      zone.SetIsFilled(true);
      zone.SetNeedRefill(false);

      // Poke these relevant context in here for batch processing later on
      aZoneFillHandler.QueuePolygonForZone(zone, combinedFill, layer);
    }

    return zone;
  }

  /**
   * Get blocks that are related to the BOUNDARY shape, i.e. NET and SHAPE (fill) info.
   */
  private getShapeRelatedBlocks(aShape: BLK_0x28_SHAPE): (BLOCK_BASE | null)[] {
    // Follow pointer chain: BOUNDARY.TablePtr -> 0x2C TABLE -> Ptr1 -> 0x37 -> m_Ptrs
    const ret: (BLOCK_BASE | null)[] = [];
    const tableKey = aShape.GetTablePtr();

    if (tableKey === 0) return ret;

    const tbl = this.expectBlockByKey<BLK_0x2C_TABLE>(tableKey, 0x2c);

    if (!tbl) return ret;

    const ptrArray = this.expectBlockByKey<BLK_0x37_PTR_ARRAY>(tbl.m_Ptr1, 0x37);

    if (!ptrArray || ptrArray.m_Count === 0) return ret;

    const count = Math.min(Math.min(ptrArray.m_Count, ptrArray.m_Capacity), 100);

    for (let i = 0; i < count; i++) ret.push(this.m_brdDb.GetObjectByKey(ptrArray.m_Ptrs[i]!));

    return ret;
  }

  private createBoardText(): void {
    const textWalker = new LL_WALKER(this.m_brdDb.m_Header!.m_LL_0x03_0x30, this.m_brdDb);

    for (const block of textWalker) {
      if (block.GetBlockType() !== 0x30) continue;

      const strWrapper = BlockDataAs<BLK_0x30_STR_WRAPPER>(block);

      const text = this.buildPcbText(strWrapper, this.m_board as unknown as BOARD_ITEM_CONTAINER);

      if (!text) continue;

      // If the text is referenced from a group, it's not board-level text,
      // and we'll pick up up while iterating the group elsewhere.
      if (strWrapper.GetGroupPtr() !== 0) {
        // In a group
        continue;
      }

      this.m_board.Add(text, ADD_MODE.APPEND);
    }
  }

  private BulkAddToBoard(aItems: BOARD_ITEM[]): void {
    for (const item of aItems) this.m_board.Add(item, ADD_MODE.BULK_APPEND);

    this.m_board.FinalizeBulkAdd(aItems);
  }

  private createZones(): void {
    trace('Creating zones from m_LL_Shapes and m_LL_0x24_0x28');

    const newZones: ZONE[] = [];

    const zoneFillHandler = new ZONE_FILL_HANDLER();

    const header = this.m_brdDb.m_Header!;

    // Walk m_LL_Shapes to find BOUNDARY shapes (zone outlines).
    // BOUNDARY shapes use class 0x15 with copper layer subclass indices.
    const shapeWalker = new LL_WALKER(header.m_LL_Shapes, this.m_brdDb);

    for (const block of shapeWalker) {
      let zone: ZONE | null = null;

      switch (block.GetBlockType()) {
        case 0x0e: {
          const rectData = BlockDataAs<BLK_0x0E_RECT>(block);

          if (!layerIsZone(rectData.m_Layer)) continue;

          zone = this.buildZone(block, [], zoneFillHandler);
          break;
        }
        case 0x24: {
          const rectData = BlockDataAs<BLK_0x24_RECT>(block);

          if (!layerIsZone(rectData.m_Layer)) continue;

          zone = this.buildZone(block, [], zoneFillHandler);
          break;
        }
        case 0x28: {
          const shapeData = BlockDataAs<BLK_0x28_SHAPE>(block);

          if (!layerIsZone(shapeData.m_Layer)) continue;

          zone = this.buildZone(block, this.getShapeRelatedBlocks(shapeData), zoneFillHandler);
          break;
        }
        default: {
          trace('Unhandled block type in zone shape walker', block.GetBlockType(), block.GetKey());
          break;
        }
      }

      if (zone) newZones.push(zone);
    }

    // Walk m_LL_0x24_0x28 for keepout/in shapes
    const keepoutWalker = new LL_WALKER(header.m_LL_0x24_0x28, this.m_brdDb);

    for (const block of keepoutWalker) {
      let zone: ZONE | null = null;

      switch (block.GetBlockType()) {
        case 0x24: {
          const rectData = BlockDataAs<BLK_0x24_RECT>(block);

          if (!layerIsZone(rectData.m_Layer)) continue;

          zone = this.buildZone(block, [], zoneFillHandler);
          break;
        }
        case 0x28: {
          const shapeData = BlockDataAs<BLK_0x28_SHAPE>(block);

          if (!layerIsZone(shapeData.m_Layer)) continue;

          zone = this.buildZone(block, [], zoneFillHandler);
          break;
        }
        default:
          break;
      }

      if (zone) newZones.push(zone);
    }

    // Deal with all the collected zone fill polygons now, all at once
    zoneFillHandler.ProcessPolygons(true);

    // Merge zones with identical polygons and same net into multi-layer zones.
    // Allegro often defines the same zone outline on multiple copper layers (e.g.
    // a ground pour spanning all layers). KiCad represents this as a single zone
    // with multiple fill layers.
    //
    // Rule areas (keepouts) can also merge.
    const mergedZones = MergeZonesWithSameOutline(newZones);

    this.BulkAddToBoard(mergedZones);
  }

  private createTables(): void {
    trace('Creating tables from m_LL_0x2C');

    const tableWalker = new LL_WALKER(this.m_brdDb.m_Header!.m_LL_0x2C, this.m_brdDb);
    for (const block of tableWalker) {
      if (block.GetBlockType() !== 0x2c) continue;

      const tableData = BlockDataAs<BLK_0x2C_TABLE>(block);

      if (tableData.m_SubType !== TABLE_SUBTYPE.SUBTYPE_GRAPHICAL_GROUP) {
        // 0x2c tables can have lots of subtypes. Only 0x110 seems useful to iterate in this way for now.
        continue;
      }

      const tableName = this.m_brdDb.GetString(tableData.m_StringPtr);

      const newItems: BOARD_ITEM[] = [];

      const keyTableWalker = new LL_WALKER(tableData.m_Ptr1, block.GetKey(), this.m_brdDb);

      for (const keyTable of keyTableWalker) {
        if (!keyTable) {
          trace('    Key table pointer is invalid', tableData.m_Ptr1);
          continue;
        }

        switch (keyTable.GetBlockType()) {
          case 0x37: {
            const ptrArray = BlockDataAs<BLK_0x37_PTR_ARRAY>(keyTable);

            const count = Math.min(ptrArray.m_Count, ptrArray.m_Ptrs.length);

            for (let ptrIndex = 0; ptrIndex < count; ptrIndex++) {
              const ptrKey = ptrArray.m_Ptrs[ptrIndex]!;

              if (ptrKey === 0) continue;

              const entryBlock = this.m_brdDb.GetObjectByKey(ptrKey);

              if (!entryBlock) {
                trace('      Entry pointer is invalid', ptrKey);
                continue;
              }

              for (const newItem of this.buildGraphicItems(
                entryBlock,
                this.m_board as unknown as BOARD_ITEM_CONTAINER,
              ))
                newItems.push(newItem);
            }

            break;
          }
          case 0x3c: {
            trace(
              '    Key list with entries',
              BlockDataAs<BLK_0x3C_KEY_LIST>(keyTable).m_NumEntries,
            );
            break;
          }
          default: {
            trace('    Table has unhandled key table type', keyTable.GetBlockType());
            break;
          }
        }
      }

      if (newItems.length > 0) {
        const group = new PCB_GROUP(this.m_board as unknown as BOARD_ITEM);
        group.SetName(tableName);

        for (const item of newItems) group.AddItem(item);

        newItems.push(group);

        this.BulkAddToBoard(newItems);
      }
    }
  }

  private applyZoneFills(): void {
    if (this.m_zoneFillShapes.size() === 0) return;

    // Unmatched ETCH shapes are either standalone copper polygons or dynamic copper
    // (teardrops/fillets). On V172+ boards, m_Unknown2 bit 12 (0x1000) marks auto-generated
    // dynamic copper that maps to KiCad teardrop zones. Shapes without this flag are genuine
    // standalone copper imported as filled PCB_SHAPE.
    for (const [fillKey, fill] of this.m_zoneFillShapes) {
      if (this.m_usedZoneFillShapes.has(fillKey)) continue;

      const polySet = this.shapeToPolySet(fill.shape);
      polySet.Simplify();

      for (const poly of polySet.CPolygons()) {
        const fractured = new SHAPE_POLY_SET(poly as POLYGON);
        fractured.Fracture(/* aSimplify */ false);

        const isDynCopperShape = (fill.shape.m_Unknown2.value_or(0) & 0x1000) !== 0;

        if (isDynCopperShape) {
          const zone = new ZONE(this.m_board as unknown as BOARD_ITEM_CONTAINER);

          zone.SetTeardropAreaType(TEARDROP_TYPE.TD_VIAPAD);
          zone.SetLayer(fill.layer);
          zone.SetNetCode(fill.netCode);
          zone.SetLocalClearance(0);
          zone.SetPadConnection(ZONE_CONNECTION.FULL);
          zone.SetIslandRemovalMode(ISLAND_REMOVAL_MODE.NEVER);
          zone.SetHatchStyle(ZONE_BORDER_DISPLAY_STYLE.INVISIBLE_BORDER);

          for (const chain of poly) zone.AddPolygon(chain);

          zone.SetFilledPolysList(fill.layer, fractured);
          zone.SetIsFilled(true);
          zone.SetNeedRefill(false);
          zone.CalculateFilledArea();

          this.m_board.Add(zone, ADD_MODE.APPEND);
        } else {
          const shape = new PCB_SHAPE(this.m_board as unknown as BOARD_ITEM, SHAPE_T.POLY);
          shape.SetPolyShape(fractured);
          shape.SetFilled(true);
          shape.SetLayer(fill.layer);
          shape.SetNetCode(fill.netCode);
          shape.SetStroke(new STROKE_PARAMS(0, LINE_STYLE.SOLID));

          this.m_board.Add(shape, ADD_MODE.APPEND);
        }
      }
    }
  }

  private enablePadTeardrops(): void {
    const teardropsByNet = new Map<number, ZONE[]>();

    for (const zone of this.m_board.Zones()) {
      if (zone.IsTeardropArea()) {
        if (!teardropsByNet.has(zone.GetNetCode())) teardropsByNet.set(zone.GetNetCode(), []);
        teardropsByNet.get(zone.GetNetCode())!.push(zone);
      }
    }

    if (teardropsByNet.size === 0) return;

    for (const fp of this.m_board.Footprints()) {
      for (const pad of fp.Pads()) {
        const zones = teardropsByNet.get(pad.GetNetCode());

        if (zones === undefined) continue;

        for (const tdZone of zones) {
          if (!pad.IsOnLayer(tdZone.GetLayer())) continue;

          if (tdZone.Outline().Contains(pad.GetPosition())) {
            pad.SetTeardropsEnabled(true);
            break;
          }
        }
      }
    }

    for (const track of this.m_board.Tracks()) {
      if (track.Type() !== KICAD_T.PCB_VIA_T) continue;

      const via = track as PCB_VIA;
      const zones = teardropsByNet.get(via.GetNetCode());

      if (zones === undefined) continue;

      for (const tdZone of zones) {
        if (!via.IsOnLayer(tdZone.GetLayer())) continue;

        if (tdZone.Outline().Contains(via.GetPosition())) {
          via.SetTeardropsEnabled(true);
          break;
        }
      }
    }
  }

  BuildBoard(): boolean {
    if (this.m_progressReporter) {
      this.m_progressReporter.AddPhases(4);
      this.m_progressReporter.AdvancePhase('Constructing caches');
      this.m_progressReporter.KeepRefreshing();
    }

    this.cacheFontDefs();

    this.setupLayers();

    if (this.m_progressReporter) {
      this.m_progressReporter.AdvancePhase('Creating nets');
      this.m_progressReporter.KeepRefreshing();
    }

    this.createNets();

    if (this.m_progressReporter) {
      this.m_progressReporter.AdvancePhase('Creating tracks');
      this.m_progressReporter.KeepRefreshing();
    }

    this.createTracks();

    if (this.m_progressReporter) this.m_progressReporter.KeepRefreshing();

    this.createBoardShapes();

    this.createBoardText();

    this.createZones();

    this.createTables();

    if (this.m_progressReporter) this.m_progressReporter.KeepRefreshing();

    this.applyZoneFills();

    this.applyConstraintSets();

    this.applyNetConstraints();

    this.applyMatchGroups();

    if (this.m_progressReporter) {
      this.m_progressReporter.AdvancePhase('Converting footprints');
      this.m_progressReporter.KeepRefreshing();
    }

    const fpWalker = new LL_WALKER(this.m_brdDb.m_Header!.m_LL_0x2B, this.m_brdDb);
    const bulkAddedItems: BOARD_ITEM[] = [];

    for (const fpContainer of fpWalker) {
      if (fpContainer.GetBlockType() === 0x2b) {
        const fpBlock = BlockDataAs<BLK_0x2B_FOOTPRINT_DEF>(fpContainer);

        const instWalker = new LL_WALKER(fpBlock.m_FirstInstPtr, fpBlock.m_Key, this.m_brdDb);

        for (const instBlock of instWalker) {
          if (instBlock.GetBlockType() !== 0x2d) {
            this.m_reporter.Report(
              `Unexpected object of type ${hex04(instBlock.GetBlockType())} found in footprint ${hex010(fpBlock.m_Key)}`,
              RPT_SEVERITY_ERROR,
            );
          } else {
            const inst = BlockDataAs<BLK_0x2D_FOOTPRINT_INST>(instBlock);

            const fp = this.buildFootprint(inst);

            if (fp) {
              bulkAddedItems.push(fp);
              this.m_board.Add(fp, ADD_MODE.BULK_APPEND, true);
            } else {
              this.m_reporter.Report(
                `Failed to construct footprint for 0x2D key ${hex010(inst.m_Key)}`,
                RPT_SEVERITY_ERROR,
              );
            }
          }

          if (this.m_progressReporter) this.m_progressReporter.KeepRefreshing();
        }
      }
    }

    if (bulkAddedItems.length > 0) this.m_board.FinalizeBulkAdd(bulkAddedItems);

    this.enablePadTeardrops();

    return true;
  }
}
