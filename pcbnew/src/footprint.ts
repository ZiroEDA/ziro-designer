// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/footprint.h` / `footprint.cpp`: `FOOTPRINT`, over
 * `BOARD_ITEM_CONTAINER`, with the `LIB_TREE_ITEM` interface in place.
 *
 * Not here: `Serialize`/`Deserialize` (the protobuf API), the
 * `FOOTPRINT_DESC` property registration, and `FootprintNeedsUpdate` (which
 * lives in `footprint_needs_update.cpp`).
 *
 * `EMBEDDED_FILES` is the second base, mixed in with `applyMixins`.
 *
 * IN PROGRESS (#636): `EmbedFonts` waits on
 * `OUTLINE_FONT::GetEmbeddingPermission`,
 * `COMPONENT_CLASS_CACHE_PROXY` (the component class is empty),
 * `GENERAL_COLLECTOR` (`CoverageRatio` reads a transient
 * interface), `BOARD::GetMaxClearanceValue` and
 * `OUTLINE_FONT::GetEmbeddingPermission`.
 */

import { FIELD_T, GetCanonicalFieldName } from '@ziroeda/common/src/template_fieldnames.js';
import {
  FOOTPRINT_CHOOSER_FRAME_NAME,
  FOOTPRINT_EDIT_FRAME_NAME,
  FOOTPRINT_VIEWER_FRAME_NAME,
} from '@ziroeda/common/src/eda_draw_frame.js';
import type { EDA_DRAW_FRAME_LIKE, INSPECTOR } from '@ziroeda/common/src/eda_item.js';
import { EDA_ITEM, INSPECT_RESULT, RECURSE_MODE } from '@ziroeda/common/src/eda_item.js';
import {
  COURTYARD_CONFLICT,
  MALFORMED_B_COURTYARD,
  MALFORMED_COURTYARDS,
  MALFORMED_F_COURTYARD,
  STRUCT_DELETED,
} from '@ziroeda/common/src/eda_item_flags.js';
import type { EDA_SEARCH_DATA } from '@ziroeda/common/src/eda_search_data.js';
import { SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import { EDA_TEXT } from '@ziroeda/common/src/eda_text.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import type { OutStr } from '@ziroeda/common/src/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/font/text_attributes.js';
import { type KIID, newKiid, niluuid } from '@ziroeda/common/src/kiid.js';
import {
  FLASHING,
  FlipLayer,
  GAL_LAYER_ID,
  IsBackLayer,
  IsCopperLayer,
  IsValidLayer,
  PCB_LAYER_ID,
} from '@ziroeda/common/src/layer_ids.js';
import { LIB_ID } from '@ziroeda/common/src/lib_id.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { type SearchTerm, searchTerm } from '@ziroeda/common/src/eda_pattern_match.js';
import { GetRefDesPrefix } from '@ziroeda/common/src/refdes_utils.js';
import {
  GetDefaultVariantName,
  formatG,
  getTrailingInt,
  strNumCmp,
  unescapeString,
} from '@ziroeda/common/src/string_utils.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/src/units_provider.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/src/widgets/msgpanel.js';
import { FLIP_DIRECTION, MIRRORVAL } from '@ziroeda/core/src/mirror.js';
import { BaseType, KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { ARC_LOW_DEF } from '@ziroeda/kimath/src/base_units.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { buildConvexHullOfPolySet } from '@ziroeda/kimath/src/geometry/convex_hull.js';
import { ANGLE_0, ANGLE_180, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_BoxHitTestChain } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_COMPOUND } from '@ziroeda/kimath/src/geometry/shape_compound.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import {
  CornerStrategy,
  type HASH_128,
  SHAPE_POLY_SET,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_SIMPLE } from '@ziroeda/kimath/src/geometry/shape_simple.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { type VECTOR2I, add, equal, sub } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from './board.js';
import { BOARD_CONNECTED_ITEM } from './board_connected_item.js';
import { type BOARD_COMMIT_LIKE, BOARD_ITEM } from './board_item.js';
import { ADD_MODE, BOARD_ITEM_CONTAINER, REMOVE_MODE } from './board_item_container.js';
import { BOARD_USE } from './board_types.js';
import { DEFAULT_COURTYARD_WIDTH } from './board_design_settings_defaults.js';
import {
  ConvertOutlineToPolygon,
  type OUTLINE_ERROR_HANDLER,
} from './convert_shape_list_to_polygon.js';
import { PCB_DRC_CODE } from './drc/drc_item.js';
import { NETINFO_LIST } from './netinfo.js';
import { PAD } from './pad.js';
import { PAD_ATTRIB, PAD_PROP, PAD_SHAPE, PADSTACK_MODE } from './padstack.js';
import { PCB_FIELD } from './pcb_field.js';
import type { PCB_GROUP } from './pcb_group.js';
import { PCB_POINT } from './pcb_point.js';
import { PCB_SHAPE, type PCB_VIEW_FOR_LOD } from './pcb_shape.js';
import { PCB_TEXT } from './pcb_text.js';
import { PCB_TEXTBOX } from './pcb_textbox.js';
import type { PCB_TRACK } from './pcb_track.js';
import { ZONE } from './zone.js';
import { ZONE_CONNECTION } from './zones.js';
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import { applyMixins } from '@ziroeda/core/src/mixins.js';

// `class FOOTPRINT : public BOARD_ITEM_CONTAINER, public EMBEDDED_FILES`
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (EMBEDDED_FILES mixin)
export interface FOOTPRINT extends EMBEDDED_FILES {}

export enum INCLUDE_NPTH_T {
  DO_NOT_INCLUDE_NPTH = 0,
  INCLUDE_NPTH = 1,
}
export const DO_NOT_INCLUDE_NPTH = INCLUDE_NPTH_T.DO_NOT_INCLUDE_NPTH;
export const INCLUDE_NPTH = INCLUDE_NPTH_T.INCLUDE_NPTH;

/**
 * The set of attributes allowed within a FOOTPRINT, using FOOTPRINT::SetAttributes()
 * and FOOTPRINT::GetAttributes().  These are to be ORed together when calling
 * FOOTPRINT::SetAttributes()
 */
export enum FOOTPRINT_ATTR_T {
  FP_THROUGH_HOLE = 0x0001,
  FP_SMD = 0x0002,
  FP_EXCLUDE_FROM_POS_FILES = 0x0004,
  FP_EXCLUDE_FROM_BOM = 0x0008,
  FP_BOARD_ONLY = 0x0010, // Footprint has no corresponding symbol
  FP_JUST_ADDED = 0x0020, // Footprint just added by netlist update
  FP_DNP = 0x0040,
}
export const FP_THROUGH_HOLE = FOOTPRINT_ATTR_T.FP_THROUGH_HOLE;
export const FP_SMD = FOOTPRINT_ATTR_T.FP_SMD;
export const FP_EXCLUDE_FROM_POS_FILES = FOOTPRINT_ATTR_T.FP_EXCLUDE_FROM_POS_FILES;
export const FP_EXCLUDE_FROM_BOM = FOOTPRINT_ATTR_T.FP_EXCLUDE_FROM_BOM;
export const FP_BOARD_ONLY = FOOTPRINT_ATTR_T.FP_BOARD_ONLY;
export const FP_JUST_ADDED = FOOTPRINT_ATTR_T.FP_JUST_ADDED;
export const FP_DNP = FOOTPRINT_ATTR_T.FP_DNP;

export enum FOOTPRINT_STACKUP {
  /**
   * The 'normal' stackup handling, where there is a single inner layer
   * (In1) and rule areas using it expand to all inner layer on the host PCB.
   */
  EXPAND_INNER_LAYERS = 0,

  /**
   * Stackup handling where the footprint can have any number of copper layers,
   * and objects on those layers go to the matching inner layer on the host PCB.
   */
  CUSTOM_LAYERS = 1,
}

/** `VECTOR3D`. */
export interface VECTOR3D {
  x: number;
  y: number;
  z: number;
}

const vec3Equal = (a: VECTOR3D, b: VECTOR3D): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

export class FP_3DMODEL {
  m_Scale: VECTOR3D = { x: 1, y: 1, z: 1 }; ///< 3D model scaling factor (dimensionless)
  m_Rotation: VECTOR3D = { x: 0, y: 0, z: 0 }; ///< 3D model rotation (degrees)
  m_Offset: VECTOR3D = { x: 0, y: 0, z: 0 }; ///< 3D model offset (mm)
  m_Opacity = 1.0;
  m_Filename = ''; ///< The 3D shape filename in 3D library
  m_Show = true; ///< Include model in rendering

  clone(): FP_3DMODEL {
    const c = new FP_3DMODEL();
    c.m_Scale = { ...this.m_Scale };
    c.m_Rotation = { ...this.m_Rotation };
    c.m_Offset = { ...this.m_Offset };
    c.m_Opacity = this.m_Opacity;
    c.m_Filename = this.m_Filename;
    c.m_Show = this.m_Show;
    return c;
  }

  equals(aOther: FP_3DMODEL): boolean {
    return (
      vec3Equal(this.m_Scale, aOther.m_Scale) &&
      vec3Equal(this.m_Rotation, aOther.m_Rotation) &&
      vec3Equal(this.m_Offset, aOther.m_Offset) &&
      this.m_Opacity === aOther.m_Opacity &&
      this.m_Filename === aOther.m_Filename &&
      this.m_Show === aOther.m_Show
    );
  }
}

export class FOOTPRINT_COURTYARD_CACHE_DATA {
  front = new SHAPE_POLY_SET(); // Note that a footprint can have both front and back courtyards populated.
  back = new SHAPE_POLY_SET();
  front_hash: HASH_128 = '';
  back_hash: HASH_128 = '';
}

export class FOOTPRINT_GEOMETRY_CACHE_DATA {
  bounding_box = new BOX2I();
  bounding_box_timestamp = 0;
  text_excluded_bbox = new BOX2I();
  text_excluded_bbox_timestamp = 0;
  hull = new SHAPE_POLY_SET();
  hull_timestamp = 0;
}

/**
 * Variant information for a footprint.
 *
 * Footprint variants store per-variant overrides for DNP, exclusion flags, and field values.
 * These are synchronized with SCH_SYMBOL_VARIANT during Update PCB from Schematic operations.
 */
export class FOOTPRINT_VARIANT {
  private m_name: string;
  private m_dnp: boolean;
  private m_excludedFromBOM: boolean;
  private m_excludedFromPosFiles: boolean;
  private m_fields: Map<string, string>; ///< Field value overrides for this variant

  constructor(aName = '') {
    this.m_name = aName;
    this.m_dnp = false;
    this.m_excludedFromBOM = false;
    this.m_excludedFromPosFiles = false;
    this.m_fields = new Map();
  }

  clone(): FOOTPRINT_VARIANT {
    const c = new FOOTPRINT_VARIANT(this.m_name);
    c.m_dnp = this.m_dnp;
    c.m_excludedFromBOM = this.m_excludedFromBOM;
    c.m_excludedFromPosFiles = this.m_excludedFromPosFiles;
    c.m_fields = new Map(this.m_fields);
    return c;
  }

  GetName(): string {
    return this.m_name;
  }
  SetName(aName: string): void {
    this.m_name = aName;
  }

  GetDNP(): boolean {
    return this.m_dnp;
  }
  SetDNP(aDNP: boolean): void {
    this.m_dnp = aDNP;
  }

  GetExcludedFromBOM(): boolean {
    return this.m_excludedFromBOM;
  }
  SetExcludedFromBOM(aExclude: boolean): void {
    this.m_excludedFromBOM = aExclude;
  }

  GetExcludedFromPosFiles(): boolean {
    return this.m_excludedFromPosFiles;
  }
  SetExcludedFromPosFiles(aExclude: boolean): void {
    this.m_excludedFromPosFiles = aExclude;
  }

  /**
   * Get a field value override for this variant.
   * @param aFieldName The name of the field.
   * @return The field value, or empty string if not overridden or overridden to empty.
   */
  GetFieldValue(aFieldName: string): string {
    return this.m_fields.get(aFieldName) ?? '';
  }

  /**
   * Set a field value override for this variant.
   * @param aFieldName The name of the field.
   * @param aValue The value to set.
   */
  SetFieldValue(aFieldName: string, aValue: string): void {
    this.m_fields.set(aFieldName, aValue);
  }

  HasFieldValue(aFieldName: string): boolean {
    return this.m_fields.has(aFieldName);
  }

  GetFields(): ReadonlyMap<string, string> {
    return this.m_fields;
  }

  equals(aOther: FOOTPRINT_VARIANT): boolean {
    if (
      this.m_name !== aOther.m_name ||
      this.m_dnp !== aOther.m_dnp ||
      this.m_excludedFromBOM !== aOther.m_excludedFromBOM ||
      this.m_excludedFromPosFiles !== aOther.m_excludedFromPosFiles ||
      this.m_fields.size !== aOther.m_fields.size
    )
      return false;

    for (const [k, v] of this.m_fields) {
      if (aOther.m_fields.get(k) !== v) return false;
    }

    return true;
  }
}

/** `FOOTPRINT::FP_UNIT_INFO`. */
export interface FP_UNIT_INFO {
  m_unitName: string; // e.g. A
  m_pins: string[]; // pin numbers in this unit
}

/** The `GENERAL_COLLECTOR` members `CoverageRatio` reads, until the collectors land (#636 stage 4). */
export interface GENERAL_COLLECTOR_FOR_COVERAGE {
  GetGuide(): { Accuracy(): number };
  GetCount(): number;
  at(aIndex: number): BOARD_ITEM;
}

// m_footprintStatus bits:
export const FP_is_LOCKED = 0x01; ///< footprint LOCKED: no autoplace allowed
export const FP_is_PLACED = 0x02; ///< In autoplace: footprint automatically placed
export const FP_to_PLACE = 0x04; ///< In autoplace: footprint waiting for autoplace
export const FP_PADS_are_LOCKED = 0x08;

/** `wxString::CmpNoCase`. */
function cmpNoCase(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();

  return la < lb ? -1 : la > lb ? 1 : 0;
}

/**
 * Compare two points, returning undefined if they are identical.
 */
function cmp_points_opt(aPtA: VECTOR2I, aPtB: VECTOR2I): boolean | undefined {
  if (aPtA.x !== aPtB.x) return aPtA.x < aPtB.x;

  if (aPtA.y !== aPtB.y) return aPtA.y < aPtB.y;

  return undefined;
}

/** `std::vector<PCB_LAYER_ID>::operator<` over two layer sequences. */
function seqLess(a: readonly PCB_LAYER_ID[], b: readonly PCB_LAYER_ID[]): boolean {
  const n = Math.min(a.length, b.length);

  for (let i = 0; i < n; ++i) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }

  return a.length < b.length;
}

// Calculate the area of a PolySet, polygons with hole are allowed.
function polygonArea(aPolySet: SHAPE_POLY_SET): number {
  // Ensure all outlines are closed, before calculating the SHAPE_POLY_SET area
  for (let ii = 0; ii < aPolySet.OutlineCount(); ii++) {
    const outline = aPolySet.Outline(ii);
    outline.SetClosed(true);

    for (let jj = 0; jj < aPolySet.HoleCount(ii); jj++) aPolySet.Hole(ii, jj).SetClosed(true);
  }

  return aPolySet.Area();
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: TS multiple inheritance (EMBEDDED_FILES mixin)
export class FOOTPRINT extends BOARD_ITEM_CONTAINER {
  private m_fields: PCB_FIELD[] = []; // Fields, mapped by name, owned by pointer
  private m_drawings: BOARD_ITEM[] = []; // Drawings in the footprint, owned by pointer
  private m_pads: PAD[] = []; // Pads, owned by pointer
  private m_zones: ZONE[] = []; // Rule area zones, owned by pointer
  private m_groups: PCB_GROUP[] = []; // Groups, owned by pointer
  private m_points: PCB_POINT[] = []; // Points, owned by pointer

  private m_orient: EDA_ANGLE; // Orientation
  private m_pos: VECTOR2I; // Position of footprint on the board in internal units.
  private m_fpid: LIB_ID; // The #LIB_ID of the FOOTPRINT.
  private m_attributes: number; // Flag bits (see FOOTPRINT_ATTR_T)
  private m_fpStatus: number; // For autoplace: flags (LOCKED, FIELDS_AUTOPLACED)
  private m_fileFormatVersionAtLoad: number;

  /// Variant data for this footprint, keyed by variant name
  private m_variants: Map<string, FOOTPRINT_VARIANT>;

  // Bounding box caching strategy:
  // While we attempt to notice the low-hanging fruit operations and update the bounding boxes
  // accordingly, we rely mostly on a "if anything changed then the caches are stale" approach.
  // We implement this by having PCB_BASE_FRAME's OnModify() method increment an operation
  // counter, and storing that as a timestamp for the various caches.
  // This means caches will get regenerated often -- but still far less often than if we had no
  // caches at all.  The principal opitmization would be to change to dirty flag and make sure
  // that any edit that could affect the bounding boxes (including edits to the footprint
  // children) marked the bounding boxes dirty.  It would definitely be faster -- but also more
  // fragile.
  private m_geometry_cache: FOOTPRINT_GEOMETRY_CACHE_DATA | null = null;

  // A list of pad groups, each of which is allowed to short nets within their group.
  // A pad group is a comma-separated list of pad numbers.
  private m_netTiePadGroups: string[];

  // A list of 1:N footprint item to allowed net numbers
  private m_netTieCache: Map<BOARD_ITEM, Set<number>>;

  /// A list of jumper pad groups, each of which is a set of pad numbers that should be jumpered
  /// together (treated as internally connected for the purposes of connectivity)
  private m_jumperPadGroups: Set<string>[];

  /// Flag that this footprint should automatically treat sets of two or more pads with the same
  /// number as jumpered pin groups
  private m_duplicatePadNumbersAreJumpers: boolean;

  private m_allowMissingCourtyard: boolean;
  private m_allowSolderMaskBridges: boolean;

  // Optional overrides
  private m_zoneConnection: ZONE_CONNECTION;
  private m_clearance: number | undefined;
  private m_solderMaskMargin: number | undefined; // Solder mask margin
  private m_solderPasteMargin: number | undefined; // Solder paste margin absolute value
  private m_solderPasteMarginRatio: number | undefined; // Solder mask margin ratio of pad size
  // The final margin is the sum of these 2 values

  private m_stackupLayers: LSET; // Layers in the stackup
  private m_stackupMode: FOOTPRINT_STACKUP; // Stackup mode for this footprint
  private m_privateLayers: LSET; // Layers visible only in the footprint editor

  private m_libDescription: string; // File name and path for documentation file.
  private m_keywords: string; // Search keywords to find footprint in library.
  private m_path: KIID[]; // Path to associated symbol ([sheetUUID, .., symbolUUID]).
  private m_sheetname: string; // Name of the sheet containing the symbol for this footprint
  private m_sheetfile: string; // File of the sheet containing the symbol for this footprint
  private m_filters: string; // Footprint filters from symbol
  private m_lastEditTime: number;
  private m_arflag: number; // Use to trace ratsnest and auto routing.
  private m_link: KIID; // Temporary logical link used during editing

  private m_3D_Drawings: FP_3DMODEL[]; // 3D models.
  private m_initial_comments: string[] | null; // s-expression comments in the footprint,
  //   lazily allocated only if needed for speed

  private m_courtyard_cache: FOOTPRINT_COURTYARD_CACHE_DATA | null = null;

  private m_transientComponentClassNames: Set<string>;
  // std::unique_ptr<COMPONENT_CLASS_CACHE_PROXY> m_componentClassCacheProxy;   -- COMPONENT_CLASS pending (#636)

  // Optional unit mapping information for multi-unit symbols
  private m_unitInfo: FP_UNIT_INFO[];

  private m_searchTerms: SearchTerm[];

  constructor(parent: BOARD | null) {
    super(parent as BOARD_ITEM | null, KICAD_T.PCB_FOOTPRINT_T);
    this.initEmbeddedFiles();

    this.m_orient = ANGLE_0;
    this.m_pos = { x: 0, y: 0 };
    this.m_fpid = new LIB_ID();
    this.m_attributes = 0;
    this.m_fpStatus = FP_PADS_are_LOCKED;
    this.m_fileFormatVersionAtLoad = 0;
    this.m_variants = new Map();
    this.m_netTiePadGroups = [];
    this.m_netTieCache = new Map();
    this.m_jumperPadGroups = [];
    this.m_duplicatePadNumbersAreJumpers = false;
    this.m_allowMissingCourtyard = false;
    this.m_allowSolderMaskBridges = false;
    this.m_zoneConnection = ZONE_CONNECTION.INHERITED;
    this.m_clearance = undefined;
    this.m_solderMaskMargin = undefined;
    this.m_solderPasteMargin = undefined;
    this.m_solderPasteMarginRatio = undefined;
    this.m_stackupLayers = new LSET([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.In1_Cu, PCB_LAYER_ID.B_Cu]);
    this.m_stackupMode = FOOTPRINT_STACKUP.EXPAND_INNER_LAYERS;
    this.m_privateLayers = new LSET();
    this.m_libDescription = '';
    this.m_keywords = '';
    this.m_path = [];
    this.m_sheetname = '';
    this.m_sheetfile = '';
    this.m_filters = '';
    this.m_lastEditTime = 0;
    this.m_arflag = 0;
    this.m_link = niluuid;
    this.m_3D_Drawings = [];
    this.m_initial_comments = null;
    this.m_transientComponentClassNames = new Set();
    this.m_unitInfo = [];
    this.m_searchTerms = [];

    this.m_layer = PCB_LAYER_ID.F_Cu;

    const addField = (id: FIELD_T, layer: PCB_LAYER_ID, visible: boolean): void => {
      const field = new PCB_FIELD(this, id);
      field.SetLayer(layer);
      field.SetVisible(visible);
      this.m_fields.push(field);
    };

    addField(FIELD_T.REFERENCE, PCB_LAYER_ID.F_SilkS, true);
    addField(FIELD_T.VALUE, PCB_LAYER_ID.F_Fab, true);
    addField(FIELD_T.DATASHEET, PCB_LAYER_ID.F_Fab, false);
    addField(FIELD_T.DESCRIPTION, PCB_LAYER_ID.F_Fab, false);

    this.m_3D_Drawings = [];
  }

  /** `FOOTPRINT( const FOOTPRINT& aFootprint )`. */
  static copyOfFootprint(aFootprint: FOOTPRINT): FOOTPRINT {
    const copy = new FOOTPRINT(null);
    BOARD_ITEM.copyBase(copy, aFootprint);

    copy.m_orient = aFootprint.m_orient;
    copy.m_pos = { ...aFootprint.m_pos };
    copy.m_fpid = aFootprint.m_fpid.clone();
    copy.m_attributes = aFootprint.m_attributes;
    copy.m_fpStatus = aFootprint.m_fpStatus;
    copy.m_fileFormatVersionAtLoad = aFootprint.m_fileFormatVersionAtLoad;
    copy.m_geometry_cache = null;

    copy.m_netTiePadGroups = [...aFootprint.m_netTiePadGroups];
    copy.m_jumperPadGroups = aFootprint.m_jumperPadGroups.map((g) => new Set(g));
    copy.m_duplicatePadNumbersAreJumpers = aFootprint.m_duplicatePadNumbersAreJumpers;
    copy.m_allowMissingCourtyard = aFootprint.m_allowMissingCourtyard;
    copy.m_allowSolderMaskBridges = aFootprint.m_allowSolderMaskBridges;

    copy.m_zoneConnection = aFootprint.m_zoneConnection;
    copy.m_clearance = aFootprint.m_clearance;
    copy.m_solderMaskMargin = aFootprint.m_solderMaskMargin;
    copy.m_solderPasteMargin = aFootprint.m_solderPasteMargin;
    copy.m_solderPasteMarginRatio = aFootprint.m_solderPasteMarginRatio;

    copy.m_stackupLayers = new LSET(aFootprint.m_stackupLayers);
    copy.m_stackupMode = aFootprint.m_stackupMode;

    copy.m_libDescription = aFootprint.m_libDescription;
    copy.m_keywords = aFootprint.m_keywords;
    copy.m_path = [...aFootprint.m_path];
    copy.m_sheetname = aFootprint.m_sheetname;
    copy.m_sheetfile = aFootprint.m_sheetfile;
    copy.m_filters = aFootprint.m_filters;
    copy.m_lastEditTime = aFootprint.m_lastEditTime;
    copy.m_arflag = 0;
    copy.m_link = aFootprint.m_link;
    copy.m_privateLayers = new LSET(aFootprint.m_privateLayers);
    copy.m_3D_Drawings = aFootprint.m_3D_Drawings.map((m) => m.clone());
    copy.m_initial_comments = aFootprint.m_initial_comments
      ? [...aFootprint.m_initial_comments]
      : null;
    copy.m_variants = new Map([...aFootprint.m_variants].map(([k, v]) => [k, v.clone()]));

    // m_componentClassCacheProxy->SetStaticComponentClass( ... )   -- COMPONENT_CLASS pending (#636)

    const ptrMap = new Map<EDA_ITEM, EDA_ITEM>();

    // Copy fields
    for (const field of aFootprint.m_fields) {
      if (field.IsMandatory()) {
        const existingField = copy.GetField(field.GetId())!;
        ptrMap.set(field, existingField);
        existingField.assignPcbText(field);
        existingField.SetParent(copy);
      } else {
        const newField = field.Clone();
        ptrMap.set(field, newField);
        copy.Add(newField);
      }
    }

    // Copy pads
    for (const pad of aFootprint.Pads()) {
      const newPad = pad.Clone();
      ptrMap.set(pad, newPad);
      copy.Add(newPad, ADD_MODE.APPEND); // Append to ensure indexes are identical
    }

    // Copy zones
    for (const zone of aFootprint.Zones()) {
      const newZone = zone.Clone();
      ptrMap.set(zone, newZone);
      copy.Add(newZone, ADD_MODE.APPEND); // Append to ensure indexes are identical

      // Ensure the net info is OK and especially uses the net info list
      // living in the current board
      // Needed when copying a fp from fp editor that has its own board
      // Must be NETINFO_LIST::ORPHANED_ITEM for a keepout that has no net.
      newZone.SetNetCode(-1);
    }

    // Copy drawings
    for (const item of aFootprint.GraphicalItems()) {
      const newItem = item.Clone() as BOARD_ITEM;
      ptrMap.set(item, newItem);
      copy.Add(newItem, ADD_MODE.APPEND); // Append to ensure indexes are identical
    }

    // Copy groups
    for (const group of aFootprint.Groups()) {
      const newGroup = group.Clone() as BOARD_ITEM;
      ptrMap.set(group, newGroup);
      copy.Add(newGroup, ADD_MODE.APPEND); // Append to ensure indexes are identical
    }

    for (const point of aFootprint.Points()) {
      const newPoint = point.Clone() as BOARD_ITEM;
      ptrMap.set(point, newPoint);
      copy.Add(newPoint, ADD_MODE.APPEND); // Append to ensure indexes are identical
    }

    // Rebuild groups
    for (const group of aFootprint.Groups()) {
      const newGroup = ptrMap.get(group) as PCB_GROUP;
      newGroup.GetItems().clear();

      for (const member of group.GetItems()) {
        if (ptrMap.has(member)) newGroup.AddItem(ptrMap.get(member)!);
      }
    }

    // Embedded files are inherited via the EMBEDDED_FILES copy constructor invoked in the
    // member initializer list above; the underlying file payloads are reference-counted so
    // cloning a footprint is cheap even when it carries large embedded models or fonts.
    copy.initEmbeddedFilesFrom(aFootprint);

    return copy;
  }

  /** `operator=( const FOOTPRINT& aOther )`. */
  assignFootprint(aOther: FOOTPRINT): this {
    this.assignBoardItem(aOther);

    this.m_courtyard_cache = null;
    this.m_geometry_cache = null;

    this.m_pos = { ...aOther.m_pos };
    this.m_fpid = aOther.m_fpid.clone();
    this.m_attributes = aOther.m_attributes;
    this.m_fpStatus = aOther.m_fpStatus;
    this.m_orient = aOther.m_orient;
    this.m_lastEditTime = aOther.m_lastEditTime;
    this.m_link = aOther.m_link;
    this.m_path = [...aOther.m_path];

    this.m_clearance = aOther.m_clearance;
    this.m_solderMaskMargin = aOther.m_solderMaskMargin;
    this.m_solderPasteMargin = aOther.m_solderPasteMargin;
    this.m_solderPasteMarginRatio = aOther.m_solderPasteMarginRatio;
    this.m_zoneConnection = aOther.m_zoneConnection;
    this.m_netTiePadGroups = [...aOther.m_netTiePadGroups];
    this.m_duplicatePadNumbersAreJumpers = aOther.m_duplicatePadNumbersAreJumpers;
    this.m_jumperPadGroups = aOther.m_jumperPadGroups.map((g) => new Set(g));
    this.m_variants = new Map([...aOther.m_variants].map(([k, v]) => [k, v.clone()]));

    // If this footprint is on a board, uncache all items before deleting them
    const board = this.GetBoard();

    if (board) {
      for (const field of this.m_fields) board.UncacheItemById(field.m_Uuid);

      for (const pad of this.m_pads) board.UncacheItemById(pad.m_Uuid);

      for (const zone of this.m_zones) board.UncacheItemById(zone.m_Uuid);

      for (const item of this.m_drawings) board.UncacheItemById(item.m_Uuid);

      for (const group of this.m_groups) board.UncacheItemById(group.m_Uuid);

      for (const point of this.m_points) board.UncacheItemById(point.m_Uuid);
    }

    const ptrMap = new Map<EDA_ITEM, EDA_ITEM>();

    // Copy fields
    this.m_fields = [];

    for (const field of aOther.m_fields) {
      const newField = PCB_FIELD.copyOfField(field);
      ptrMap.set(field, newField);
      this.Add(newField);
    }

    // Copy pads
    this.m_pads = [];

    for (const pad of aOther.Pads()) {
      const newPad = PAD.copyOfPad(pad);
      ptrMap.set(pad, newPad);
      this.Add(newPad);
    }

    // Copy zones
    this.m_zones = [];

    for (const zone of aOther.Zones()) {
      const newZone = zone.Clone();
      ptrMap.set(zone, newZone);
      this.Add(newZone);

      // Ensure the net info is OK and especially uses the net info list
      // living in the current board
      // Needed when copying a fp from fp editor that has its own board
      // Must be NETINFO_LIST::ORPHANED_ITEM for a keepout that has no net.
      newZone.SetNetCode(-1);
    }

    // Copy drawings
    this.m_drawings = [];

    for (const item of aOther.GraphicalItems()) {
      const newItem = item.Clone() as BOARD_ITEM;
      ptrMap.set(item, newItem);
      this.Add(newItem);
    }

    // Copy groups
    this.m_groups = [];

    for (const group of aOther.Groups()) {
      const newGroup = group.Clone() as PCB_GROUP;
      newGroup.GetItems().clear();

      for (const member of group.GetItems()) newGroup.AddItem(ptrMap.get(member)!);

      this.Add(newGroup);
    }

    // Copy points
    this.m_points = [];

    for (const point of aOther.Points()) {
      const newItem = point.Clone() as BOARD_ITEM;
      ptrMap.set(point, newItem);
      this.Add(newItem);
    }

    // Copy auxiliary data
    this.m_3D_Drawings = aOther.m_3D_Drawings.map((m) => m.clone());
    this.m_libDescription = aOther.m_libDescription;
    this.m_keywords = aOther.m_keywords;
    this.m_privateLayers = new LSET(aOther.m_privateLayers);
    this.m_initial_comments = aOther.m_initial_comments ? [...aOther.m_initial_comments] : null;

    // m_componentClassCacheProxy->SetStaticComponentClass( ... )   -- COMPONENT_CLASS pending (#636)
    this.assignEmbeddedFiles(aOther);

    return this;
  }

  override CopyFrom(aOther: BOARD_ITEM | null): void {
    if (!(aOther && aOther.Type() === KICAD_T.PCB_FOOTPRINT_T)) return; // wxCHECK

    this.assignFootprint(aOther as FOOTPRINT);

    for (const pad of this.m_pads) pad.SetDirty();
  }

  static ClassOf(aItem: { Type(): KICAD_T } | null): boolean {
    return !!aItem && aItem.Type() === KICAD_T.PCB_FOOTPRINT_T;
  }

  /// Resets the caches for this footprint, for example if it was modified via the API
  InvalidateGeometryCaches(): void {
    this.m_geometry_cache = null;
    this.m_courtyard_cache = null;
  }

  GetPrivateLayers(): LSET {
    return this.m_privateLayers;
  }
  SetPrivateLayers(aLayers: LSET): void {
    this.m_privateLayers = new LSET(aLayers);
  }

  ///< @copydoc BOARD_ITEM_CONTAINER::Add()
  override Add(
    aBoardItem: BOARD_ITEM,
    aMode: ADD_MODE = ADD_MODE.INSERT,
    aSkipConnectivity = false,
  ): void {
    switch (aBoardItem.Type()) {
      case KICAD_T.PCB_FIELD_T:
        this.m_fields.push(aBoardItem as PCB_FIELD);
        break;

      case KICAD_T.PCB_BARCODE_T:
      case KICAD_T.PCB_TEXT_T:
      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_LEADER_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
      case KICAD_T.PCB_SHAPE_T:
      case KICAD_T.PCB_TEXTBOX_T:
      case KICAD_T.PCB_TABLE_T:
      case KICAD_T.PCB_REFERENCE_IMAGE_T:
        if (aMode === ADD_MODE.APPEND) this.m_drawings.push(aBoardItem);
        else this.m_drawings.unshift(aBoardItem);

        break;

      case KICAD_T.PCB_PAD_T:
        if (aMode === ADD_MODE.APPEND) this.m_pads.push(aBoardItem as PAD);
        else this.m_pads.unshift(aBoardItem as PAD);

        break;

      case KICAD_T.PCB_ZONE_T:
        if (aMode === ADD_MODE.APPEND) this.m_zones.push(aBoardItem as ZONE);
        else this.m_zones.unshift(aBoardItem as ZONE);

        break;

      case KICAD_T.PCB_GROUP_T:
        if (aMode === ADD_MODE.APPEND) this.m_groups.push(aBoardItem as PCB_GROUP);
        else this.m_groups.unshift(aBoardItem as PCB_GROUP);

        break;

      case KICAD_T.PCB_MARKER_T:
        console.assert(
          false,
          'FOOTPRINT::Add(): Markers go at the board level, even in the footprint editor',
        );
        return;

      case KICAD_T.PCB_FOOTPRINT_T:
        console.assert(false, 'FOOTPRINT::Add(): Nested footprints not supported');
        return;

      case KICAD_T.PCB_POINT_T:
        if (aMode === ADD_MODE.APPEND) this.m_points.push(aBoardItem as PCB_POINT);
        else this.m_points.unshift(aBoardItem as PCB_POINT);

        break;

      default:
        console.assert(
          false,
          `FOOTPRINT::Add(): BOARD_ITEM type (${aBoardItem.Type()}) not handled`,
        );
        return;
    }

    aBoardItem.ClearEditFlags();
    aBoardItem.SetParent(this);

    // If this footprint is on a board, update the board's item-by-id cache
    const board = this.GetBoard();

    if (board) board.CacheItemById(aBoardItem);

    this.InvalidateGeometryCaches();
  }

  ///< @copydoc BOARD_ITEM_CONTAINER::Remove()
  override Remove(aBoardItem: BOARD_ITEM, aMode: REMOVE_MODE = REMOVE_MODE.NORMAL): void {
    const eraseFirst = <T>(list: T[], item: T): void => {
      const idx = list.indexOf(item);

      if (idx >= 0) list.splice(idx, 1);
    };

    switch (aBoardItem.Type()) {
      case KICAD_T.PCB_FIELD_T:
        eraseFirst(this.m_fields, aBoardItem as PCB_FIELD);
        break;

      case KICAD_T.PCB_BARCODE_T:
      case KICAD_T.PCB_TEXT_T:
      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_LEADER_T:
      case KICAD_T.PCB_SHAPE_T:
      case KICAD_T.PCB_TEXTBOX_T:
      case KICAD_T.PCB_TABLE_T:
      case KICAD_T.PCB_REFERENCE_IMAGE_T:
        eraseFirst(this.m_drawings, aBoardItem);
        break;

      case KICAD_T.PCB_PAD_T:
        eraseFirst(this.m_pads, aBoardItem as PAD);
        break;

      case KICAD_T.PCB_ZONE_T:
        eraseFirst(this.m_zones, aBoardItem as ZONE);
        break;

      case KICAD_T.PCB_GROUP_T:
        eraseFirst(this.m_groups, aBoardItem);
        break;

      case KICAD_T.PCB_POINT_T:
        eraseFirst(this.m_points, aBoardItem);
        break;

      default: {
        console.assert(
          false,
          `FOOTPRINT::Remove() needs work: BOARD_ITEM type (${aBoardItem.Type()}) not handled`,
        );
      }
    }

    // If this footprint is on a board, update the board's item-by-id cache
    const board = this.GetBoard();

    if (board) board.UncacheItemById(aBoardItem.m_Uuid);

    aBoardItem.SetFlags(STRUCT_DELETED);

    this.InvalidateGeometryCaches();
  }

  /**
   * Clear (i.e. force the ORPHANED dummy net info) the net info which
   * depends on a given board for all pads of the footprint.
   *
   * This is needed when a footprint is copied between the fp editor and
   * the board editor for instance, because net info become fully broken
   */
  ClearAllNets(): void {
    // Force the ORPHANED dummy net info on every BOARD_CONNECTED_ITEM descendant so that
    // operations which read through m_netinfo (e.g. library serialization) cannot chase a
    // dangling pointer when this footprint has been detached from its original parent board.
    // ORPHANED dummy net does not depend on a board.
    this.RunOnChildren((aItem: BOARD_ITEM) => {
      if (aItem instanceof BOARD_CONNECTED_ITEM)
        aItem.SetNetCode(NETINFO_LIST.ORPHANED, /* aNoAssert */ true);
    }, RECURSE_MODE.RECURSE);
  }

  /**
   * Old footprints do not always have a valid UUID (some can be set to null uuid)
   * However null UUIDs, having a special meaning in editor, create issues when
   * editing a footprint
   * So all null uuids a re replaced by a valid uuid
   * @return true if at least one uuid is changed, false if no change
   */
  FixUuids(): boolean {
    // replace null UUIDs if any by a valid uuid
    const item_list: BOARD_ITEM[] = [];

    for (const field of this.m_fields) item_list.push(field);

    for (const pad of this.m_pads) item_list.push(pad);

    for (const gr_item of this.m_drawings) item_list.push(gr_item);

    // Note: one cannot fix null UUIDs inside the group, but it should not happen
    // because null uuids can be found in old footprints, therefore without group
    for (const group of this.m_groups) item_list.push(group);

    // Probably not needed, because old fp do not have zones. But just in case.
    for (const zone of this.m_zones) item_list.push(zone);

    // Ditto
    for (const point of this.m_points) item_list.push(point);

    let changed = false;

    for (const item of item_list) {
      if (item.m_Uuid === niluuid) {
        (item as { m_Uuid: KIID }).m_Uuid = newKiid();
        changed = true;
      }
    }

    return changed;
  }

  /**
   * Return the bounding box containing pads when the footprint is on the front side,
   * orientation 0, position 0,0.
   *
   * Mainly used in Gerber place file to draw a footprint outline when the courtyard
   * is missing or broken.
   *
   * @return The rectangle containing the pads for the normalized footprint.
   */
  GetFpPadsLocalBbox(): BOX2I {
    const bbox = new BOX2I();

    // We want the bounding box of the footprint pads at rot 0, not flipped
    // Create such a image:
    const dummy = FOOTPRINT.copyOfFootprint(this);

    dummy.SetPosition({ x: 0, y: 0 });
    dummy.SetOrientation(ANGLE_0);

    if (dummy.IsFlipped()) dummy.Flip({ x: 0, y: 0 }, FLIP_DIRECTION.TOP_BOTTOM);

    for (const pad of dummy.Pads()) bbox.Merge(pad.GetBoundingBox());

    return bbox;
  }

  TextOnly(): boolean {
    for (const item of this.m_drawings) {
      if (this.m_privateLayers.test(item.GetLayer())) continue;

      if (item.Type() !== KICAD_T.PCB_FIELD_T && item.Type() !== KICAD_T.PCB_TEXT_T) return false;
    }

    return true;
  }

  /** `GetBoundingBox()` and `GetBoundingBox( bool aIncludeText )`. */
  override GetBoundingBox(aIncludeText = true): BOX2I {
    const board = this.GetBoard();

    if (board) {
      if (!this.m_geometry_cache) this.m_geometry_cache = new FOOTPRINT_GEOMETRY_CACHE_DATA();

      if (aIncludeText) {
        if (this.m_geometry_cache.bounding_box_timestamp >= board.GetTimeStamp())
          return this.m_geometry_cache.bounding_box;
      } else {
        if (this.m_geometry_cache.text_excluded_bbox_timestamp >= board.GetTimeStamp())
          return this.m_geometry_cache.text_excluded_bbox;
      }
    }

    const texts: PCB_TEXT[] = [];
    const isFPEdit = !!board && board.IsFootprintHolder();

    const bbox = new BOX2I(this.m_pos);
    bbox.Inflate(pcbIUScale.mmToIU(0.25)); // Give a min size to the bbox

    // Calculate the footprint side
    const footprintSide = this.GetSide();

    for (const item of this.m_drawings) {
      if (IsValidLayer(item.GetLayer()) && this.m_privateLayers.test(item.GetLayer()) && !isFPEdit)
        continue;

      // We want the bitmap bounding box just in the footprint editor
      // so it will start with the correct initial zoom
      if (item.Type() === KICAD_T.PCB_REFERENCE_IMAGE_T && !isFPEdit) continue;

      // Handle text separately
      if (item.Type() === KICAD_T.PCB_TEXT_T) {
        texts.push(item as PCB_TEXT);
        continue;
      }

      // If we're not including text then drop annotations as well -- unless, of course, it's
      // an unsided footprint -- in which case it's likely to be nothing *but* annotations.
      if (!aIncludeText && footprintSide !== PCB_LAYER_ID.UNDEFINED_LAYER) {
        if (BaseType(item.Type()) === KICAD_T.PCB_DIMENSION_T) continue;

        if (
          item.GetLayer() === PCB_LAYER_ID.Cmts_User ||
          item.GetLayer() === PCB_LAYER_ID.Dwgs_User ||
          item.GetLayer() === PCB_LAYER_ID.Eco1_User ||
          item.GetLayer() === PCB_LAYER_ID.Eco2_User
        ) {
          continue;
        }
      }

      bbox.Merge(item.GetBoundingBox());
    }

    for (const field of this.m_fields) {
      // Reference and value get their own processing
      if (field.IsReference() || field.IsValue()) continue;

      texts.push(field);
    }

    for (const pad of this.m_pads) bbox.Merge(pad.GetBoundingBox());

    for (const zone of this.m_zones) bbox.Merge(zone.GetBoundingBox());

    for (const point of this.m_points) bbox.Merge(point.GetBoundingBox());

    const noDrawItems =
      this.m_drawings.length === 0 && this.m_pads.length === 0 && this.m_zones.length === 0;

    // Groups do not contribute to the rect, only their members
    if (aIncludeText || noDrawItems) {
      // Only PCB_TEXT and PCB_FIELD items are independently selectable; PCB_TEXTBOX items go
      // in with other graphic items above.
      for (const text of texts) {
        if (!isFPEdit && this.m_privateLayers.test(text.GetLayer())) continue;

        if (text.Type() === KICAD_T.PCB_FIELD_T && !text.IsVisible()) continue;

        bbox.Merge(text.GetBoundingBox());
      }

      // This can be further optimized when aIncludeInvisibleText is true, but currently
      // leaving this as is until it's determined there is a noticeable speed hit.
      let valueLayerIsVisible = true;
      let refLayerIsVisible = true;

      if (board) {
        // The first "&&" conditional handles the user turning layers off as well as layers
        // not being present in the current PCB stackup.  Values, references, and all
        // footprint text can also be turned off via the GAL meta-layers, so the 2nd and
        // 3rd "&&" conditionals handle that.
        valueLayerIsVisible =
          board.IsLayerVisible(this.Value().GetLayer()) &&
          board.IsElementVisible(GAL_LAYER_ID.LAYER_FP_VALUES) &&
          board.IsElementVisible(GAL_LAYER_ID.LAYER_FP_TEXT);

        refLayerIsVisible =
          board.IsLayerVisible(this.Reference().GetLayer()) &&
          board.IsElementVisible(GAL_LAYER_ID.LAYER_FP_REFERENCES) &&
          board.IsElementVisible(GAL_LAYER_ID.LAYER_FP_TEXT);
      }

      if ((this.Value().IsVisible() && valueLayerIsVisible) || noDrawItems) {
        bbox.Merge(this.Value().GetBoundingBox());
      }

      if ((this.Reference().IsVisible() && refLayerIsVisible) || noDrawItems) {
        bbox.Merge(this.Reference().GetBoundingBox());
      }
    }

    if (board) {
      if (!this.m_geometry_cache) this.m_geometry_cache = new FOOTPRINT_GEOMETRY_CACHE_DATA();

      if (aIncludeText || noDrawItems) {
        this.m_geometry_cache.bounding_box_timestamp = board.GetTimeStamp();
        this.m_geometry_cache.bounding_box = bbox;
      } else {
        this.m_geometry_cache.text_excluded_bbox_timestamp = board.GetTimeStamp();
        this.m_geometry_cache.text_excluded_bbox = bbox;
      }
    }

    return bbox;
  }

  /**
   * Return the bounding box of the footprint on a given set of layers
   */
  GetLayerBoundingBox(aLayers: LSET): BOX2I {
    const board = this.GetBoard();
    const isFPEdit = !!board && board.IsFootprintHolder();

    // Start with an uninitialized bounding box
    const bbox = new BOX2I();

    for (const item of this.m_drawings) {
      if (IsValidLayer(item.GetLayer()) && this.m_privateLayers.test(item.GetLayer()) && !isFPEdit)
        continue;

      if (aLayers.and(item.GetLayerSet()).none()) continue;

      // We want the bitmap bounding box just in the footprint editor
      // so it will start with the correct initial zoom
      if (item.Type() === KICAD_T.PCB_REFERENCE_IMAGE_T && !isFPEdit) continue;

      bbox.Merge(item.GetBoundingBox());
    }

    for (const pad of this.m_pads) {
      if (aLayers.and(pad.GetLayerSet()).none()) continue;

      bbox.Merge(pad.GetBoundingBox());
    }

    for (const zone of this.m_zones) {
      if (aLayers.and(zone.GetLayerSet()).none()) continue;

      bbox.Merge(zone.GetBoundingBox());
    }

    for (const point of this.m_points) {
      if (this.m_privateLayers.test(point.GetLayer()) && !isFPEdit) continue;

      if (aLayers.and(point.GetLayerSet()).none()) continue;

      bbox.Merge(point.GetBoundingBox());
    }

    return bbox;
  }

  override GetCenter(): VECTOR2I {
    return this.GetBoundingBox(false).GetCenter();
  }

  Pads(): PAD[] {
    return this.m_pads;
  }
  GraphicalItems(): BOARD_ITEM[] {
    return this.m_drawings;
  }
  Zones(): ZONE[] {
    return this.m_zones;
  }
  Groups(): PCB_GROUP[] {
    return this.m_groups;
  }
  Points(): PCB_POINT[] {
    return this.m_points;
  }

  HasThroughHolePads(): boolean {
    for (const pad of this.Pads()) {
      if (pad.GetAttribute() !== PAD_ATTRIB.SMD) return true;
    }

    return false;
  }

  Models(): FP_3DMODEL[] {
    return this.m_3D_Drawings;
  }

  override SetPosition(aPos: VECTOR2I): void {
    const delta = sub(aPos, this.m_pos);

    this.m_pos = add(this.m_pos, delta);

    for (const field of this.m_fields) EDA_TEXT.prototype.Offset.call(field, delta);

    for (const pad of this.m_pads) pad.SetPosition(add(pad.GetPosition(), delta));

    for (const zone of this.m_zones) zone.Move(delta);

    for (const item of this.m_drawings) item.Move(delta);

    for (const point of this.m_points) point.Move(delta);

    if (this.m_geometry_cache) {
      this.m_geometry_cache.bounding_box.Move(delta);
      this.m_geometry_cache.text_excluded_bbox.Move(delta);
      this.m_geometry_cache.hull.Move(delta);
    }

    // The geometry work has been conserved by using Move(). But the hashes
    // need to be updated, otherwise the cached polygons will still be rebuild.
    if (this.m_courtyard_cache) {
      this.m_courtyard_cache.back.Move(delta);
      this.m_courtyard_cache.back_hash = this.m_courtyard_cache.back.GetHash();
      this.m_courtyard_cache.front.Move(delta);
      this.m_courtyard_cache.front_hash = this.m_courtyard_cache.front.GetHash();
    }
  }

  override GetPosition(): VECTOR2I {
    return this.m_pos;
  }

  SetOrientation(aNewAngle: EDA_ANGLE): void {
    const angleChange = aNewAngle.sub(this.m_orient); // change in rotation

    this.m_orient = aNewAngle.Clone();
    this.m_orient.Normalize180();

    const rotationCenter = this.GetPosition();

    for (const field of this.m_fields) field.Rotate(rotationCenter, angleChange);

    for (const pad of this.m_pads) pad.Rotate(rotationCenter, angleChange);

    for (const zone of this.m_zones) zone.Rotate(rotationCenter, angleChange);

    for (const item of this.m_drawings) item.Rotate(rotationCenter, angleChange);

    for (const point of this.m_points) point.Rotate(rotationCenter, angleChange);

    if (this.m_geometry_cache) this.m_geometry_cache.text_excluded_bbox_timestamp = 0;

    if (this.m_courtyard_cache) {
      this.m_courtyard_cache.front.Rotate(angleChange, rotationCenter);
      this.m_courtyard_cache.front_hash = this.m_courtyard_cache.front.GetHash();
      this.m_courtyard_cache.back.Rotate(angleChange, rotationCenter);
      this.m_courtyard_cache.back_hash = this.m_courtyard_cache.back.GetHash();
    }

    if (this.m_geometry_cache) this.m_geometry_cache.hull.Rotate(angleChange, rotationCenter);
  }

  GetOrientation(): EDA_ANGLE {
    return this.m_orient;
  }

  /**
   * Used as Layer property setter -- performs a flip if necessary to set the footprint layer
   * @param aLayer is the target layer (F_Cu or B_Cu)
   */
  SetLayerAndFlip(aLayer: PCB_LAYER_ID): void {
    console.assert(aLayer === PCB_LAYER_ID.F_Cu || aLayer === PCB_LAYER_ID.B_Cu);

    if (aLayer !== this.GetLayer()) this.Flip(this.GetPosition(), FLIP_DIRECTION.LEFT_RIGHT);
  }

  // to make property magic work
  override GetLayer(): PCB_LAYER_ID {
    return BOARD_ITEM.prototype.GetLayer.call(this);
  }

  // For property system:
  SetOrientationDegrees(aOrientation: number): void {
    this.SetOrientation(new EDA_ANGLE(aOrientation));
  }
  GetOrientationDegrees(): number {
    return this.m_orient.AsDegrees();
  }

  GetFPID(): LIB_ID {
    return this.m_fpid;
  }
  SetFPID(aFPID: LIB_ID): void {
    this.m_fpid = aFPID.clone();
  }

  GetFPIDAsString(): string {
    return this.m_fpid.Format();
  }
  SetFPIDAsString(aFPID: string): void {
    this.m_fpid.Parse(aFPID);
  }

  // LIB_TREE_ITEM interface
  GetLIB_ID(): LIB_ID {
    return this.m_fpid;
  }
  GetName(): string {
    return this.m_fpid.GetLibItemName();
  }
  GetLibNickname(): string {
    return this.m_fpid.GetLibNickname();
  }
  GetDesc(): string {
    return this.GetLibDescription();
  }
  GetPinCount(): number {
    return this.GetUniquePadCount(DO_NOT_INCLUDE_NPTH);
  }

  GetSearchTerms(): SearchTerm[] {
    this.m_searchTerms = [];

    this.m_searchTerms.push(searchTerm(this.GetLibNickname(), 4));
    this.m_searchTerms.push(searchTerm(this.GetName(), 8, true));
    this.m_searchTerms.push(searchTerm(this.GetLIB_ID().Format(), 16, true));

    for (const token of this.GetKeywords().split(/[ \t\r\n]+/)) {
      if (token !== '') this.m_searchTerms.push(searchTerm(token, 4));
    }

    this.m_searchTerms.push(searchTerm(this.GetKeywords(), 1));
    this.m_searchTerms.push(searchTerm(this.GetLibDescription(), 1));

    return this.m_searchTerms;
  }

  GetLibDescription(): string {
    return this.m_libDescription;
  }
  SetLibDescription(aDesc: string): void {
    this.m_libDescription = aDesc;
  }

  GetKeywords(): string {
    return this.m_keywords;
  }
  SetKeywords(aKeywords: string): void {
    this.m_keywords = aKeywords;
  }

  GetPath(): readonly KIID[] {
    return this.m_path;
  }
  SetPath(aPath: readonly KIID[]): void {
    this.m_path = [...aPath];
  }

  GetSheetname(): string {
    return this.m_sheetname;
  }
  SetSheetname(aSheetname: string): void {
    this.m_sheetname = aSheetname;
  }

  GetSheetfile(): string {
    return this.m_sheetfile;
  }
  SetSheetfile(aSheetfile: string): void {
    this.m_sheetfile = aSheetfile;
  }

  GetFilters(): string {
    return this.m_filters;
  }
  SetFilters(aFilters: string): void {
    this.m_filters = aFilters;
  }

  /**
   * `GetLocalClearance()` and `GetLocalClearance( wxString* aSource )`, which also reports the source.
   */
  GetLocalClearance(aSource?: OutStr | null): number | undefined {
    if (aSource !== undefined && this.m_clearance !== undefined && aSource)
      aSource.value = `footprint ${this.GetReference()}`;

    return this.m_clearance;
  }
  SetLocalClearance(aClearance: number | undefined): void {
    this.m_clearance = aClearance;
  }

  GetLocalSolderMaskMargin(): number | undefined {
    return this.m_solderMaskMargin;
  }
  SetLocalSolderMaskMargin(aMargin: number | undefined): void {
    this.m_solderMaskMargin = aMargin;
  }

  GetLocalSolderPasteMargin(): number | undefined {
    return this.m_solderPasteMargin;
  }
  SetLocalSolderPasteMargin(aMargin: number | undefined): void {
    this.m_solderPasteMargin = aMargin;
  }

  GetLocalSolderPasteMarginRatio(): number | undefined {
    return this.m_solderPasteMarginRatio;
  }
  SetLocalSolderPasteMarginRatio(aRatio: number | undefined): void {
    this.m_solderPasteMarginRatio = aRatio;
  }

  SetLocalZoneConnection(aType: ZONE_CONNECTION): void {
    this.m_zoneConnection = aType;
  }
  GetLocalZoneConnection(): ZONE_CONNECTION {
    return this.m_zoneConnection;
  }

  /**
   * Set the stackup mode for this footprint.
   *
   * This determines if the footprint lists its own layers or uses a default stackup,
   * with "expansion" of inner layers to the PCB's inner layers.
   */
  SetStackupMode(aMode: FOOTPRINT_STACKUP): void {
    this.m_stackupMode = aMode;

    if (this.m_stackupMode === FOOTPRINT_STACKUP.EXPAND_INNER_LAYERS) {
      // Reset the stackup layers to the default values
      this.m_stackupLayers = new LSET([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.In1_Cu, PCB_LAYER_ID.B_Cu]);
    }
  }

  GetStackupMode(): FOOTPRINT_STACKUP {
    return this.m_stackupMode;
  }

  /**
   * If the footprint has a non-default stackup, set the layers that
   * should be used for the stackup.
   */
  SetStackupLayers(aLayers: LSET): void {
    console.assert(this.m_stackupMode === FOOTPRINT_STACKUP.CUSTOM_LAYERS); // wxCHECK2

    if (this.m_stackupMode === FOOTPRINT_STACKUP.CUSTOM_LAYERS)
      this.m_stackupLayers = new LSET(aLayers);
  }

  GetStackupLayers(): LSET {
    return this.m_stackupLayers;
  }

  GetAttributes(): number {
    return this.m_attributes;
  }
  SetAttributes(aAttributes: number): void {
    this.m_attributes = aAttributes;
  }

  AllowMissingCourtyard(): boolean {
    return this.m_allowMissingCourtyard;
  }
  SetAllowMissingCourtyard(aAllow: boolean): void {
    this.m_allowMissingCourtyard = aAllow;
  }

  AllowSolderMaskBridges(): boolean {
    return this.m_allowSolderMaskBridges;
  }
  SetAllowSolderMaskBridges(aAllow: boolean): void {
    this.m_allowSolderMaskBridges = aAllow;
  }

  SetFlag(aFlag: number): void {
    this.m_arflag = aFlag;
  }
  IncrementFlag(): void {
    this.m_arflag += 1;
  }
  GetFlag(): number {
    return this.m_arflag;
  }

  IsNetTie(): boolean {
    for (const group of this.m_netTiePadGroups) {
      if (group !== '') return true;
    }

    return false;
  }

  /**
   * Return any local clearance overrides set in the "classic" (ie: pre-rule) system.
   *
   * @param aSource [out] optionally reports the source as a user-readable string.
   * @return the clearance in internal units.
   */
  GetClearanceOverrides(aSource: OutStr | null): number | undefined {
    return this.GetLocalClearance(aSource);
  }

  GetZoneConnectionOverrides(aSource: OutStr | null): ZONE_CONNECTION {
    if (this.m_zoneConnection !== ZONE_CONNECTION.INHERITED && aSource)
      aSource.value = `footprint ${this.GetReference()}`;

    return this.m_zoneConnection;
  }

  /**
   * @return a list of pad groups, each of which is allowed to short nets within their group.
   *         A pad group is a comma-separated list of pad numbers.
   */
  GetNetTiePadGroups(): readonly string[] {
    return this.m_netTiePadGroups;
  }

  ClearNetTiePadGroups(): void {
    this.m_netTiePadGroups = [];
  }

  AddNetTiePadGroup(aGroup: string): void {
    this.m_netTiePadGroups.push(aGroup);
  }

  /**
   * @return a map from pad numbers to net-tie group indices.  If a pad is not a member of
   *         a net-tie group its index will be -1.
   */
  MapPadNumbersToNetTieGroups(): Map<string, number> {
    const padNumberToGroupIdxMap = new Map<string, number>();

    for (const pad of this.m_pads) padNumberToGroupIdxMap.set(pad.GetNumber(), -1);

    const processPad = (aPad: string, aGroup: number): void => {
      aPad = aPad.trim();

      if (aPad !== '') padNumberToGroupIdxMap.set(aPad, aGroup);
    };

    for (let ii = 0; ii < this.m_netTiePadGroups.length; ++ii) {
      const group = this.m_netTiePadGroups[ii]!;
      let esc = false;
      let pad = '';

      for (const ch of group) {
        if (esc) {
          esc = false;
          pad += ch;
          continue;
        }

        switch (ch) {
          case '\\':
            esc = true;
            break;

          case ',':
            processPad(pad, ii);
            pad = '';
            break;

          default:
            pad += ch;
            break;
        }
      }

      processPad(pad, ii);
    }

    return padNumberToGroupIdxMap;
  }

  /**
   * @return a list of pads that appear in \a aPad's net-tie pad group.
   */
  GetNetTiePads(aPad: PAD): PAD[] {
    // First build a map from pad numbers to allowed-shorting-group indexes.  This ends up being
    // something like O(3n), but it still beats O(n^2) for large numbers of pads.
    const padToNetTieGroupMap = this.MapPadNumbersToNetTieGroups();
    const groupIdx = padToNetTieGroupMap.get(aPad.GetNumber()) ?? 0; // operator[] default-inserts 0
    const otherPads: PAD[] = [];

    if (groupIdx >= 0) {
      for (const pad of this.m_pads) {
        if ((padToNetTieGroupMap.get(pad.GetNumber()) ?? 0) === groupIdx) otherPads.push(pad);
      }
    }

    return otherPads;
  }

  /**
   * Returns the most likely attribute based on pads
   * Either FP_THROUGH_HOLE/FP_SMD/OTHER(0)
   * @return 0/FP_SMD/FP_THROUGH_HOLE
   */
  GetLikelyAttribute(): number {
    let smd_count = 0;
    let tht_count = 0;

    for (const pad of this.m_pads) {
      switch (pad.GetProperty()) {
        case PAD_PROP.FIDUCIAL_GLBL:
        case PAD_PROP.FIDUCIAL_LOCAL:
          continue;

        case PAD_PROP.HEATSINK:
        case PAD_PROP.CASTELLATED:
        case PAD_PROP.MECHANICAL:
          continue;

        case PAD_PROP.NONE:
        case PAD_PROP.BGA:
        case PAD_PROP.TESTPOINT:
        case PAD_PROP.PRESSFIT:
          break;
      }

      switch (pad.GetAttribute()) {
        case PAD_ATTRIB.PTH:
          tht_count++;
          break;

        case PAD_ATTRIB.SMD:
          if (pad.IsOnCopperLayer()) smd_count++;

          break;

        default:
          break;
      }
    }

    // Footprints with plated through-hole pads should usually be marked through hole even if they
    // also have SMD because they might not be auto-placed.  Exceptions to this might be shielded
    if (tht_count > 0) return FP_THROUGH_HOLE;

    if (smd_count > 0) return FP_SMD;

    return 0;
  }

  override Move(aMoveVector: VECTOR2I): void {
    if (aMoveVector.x === 0 && aMoveVector.y === 0) return;

    const newpos = add(this.m_pos, aMoveVector);
    this.SetPosition(newpos);
  }

  override Rotate(aRotCentre: VECTOR2I, aAngle: EDA_ANGLE): void {
    if (aAngle.equals(ANGLE_0)) return;

    const orientation = this.GetOrientation();
    const newOrientation = orientation.add(aAngle);
    let newpos = this.m_pos;
    newpos = RotatePoint(newpos, aRotCentre, aAngle);
    this.SetPosition(newpos);
    this.SetOrientation(newOrientation);

    for (const field of this.m_fields) field.KeepUpright();

    for (const item of this.m_drawings) {
      if (item.Type() === KICAD_T.PCB_TEXT_T) (item as PCB_TEXT).KeepUpright();
    }
  }

  override Flip(aCentre: VECTOR2I, aFlipDirection: FLIP_DIRECTION): void {
    // Move footprint to its final position:
    const finalPos = { ...this.m_pos };

    // Now Flip the footprint.
    // Flipping a footprint is a specific transform: it is not mirrored like a text.
    // We have to change the side, and ensure the footprint rotation is modified according to the
    // transform, because this parameter is used in pick and place files, and when updating the
    // footprint from library.
    // When flipped around the X axis (Y coordinates changed) orientation is negated
    // When flipped around the Y axis (X coordinates changed) orientation is 180 - old orient.
    // Because it is specific to a footprint, we flip around the X axis, and after rotate 180 deg

    finalPos.y = MIRRORVAL(finalPos.y, aCentre.y); /// Mirror the Y position (around the X axis)

    this.SetPosition(finalPos);

    // Flip layer
    const board = this.GetBoard();
    BOARD_ITEM.prototype.SetLayer.call(
      this,
      board ? board.FlipLayer(this.GetLayer()) : FlipLayer(this.GetLayer()),
    );

    // Calculate the new orientation, and then clear it for pad flipping.
    const newOrientation = this.m_orient.negate();
    newOrientation.Normalize180();
    this.m_orient = ANGLE_0;

    // Mirror fields to other side of board.
    for (const field of this.m_fields) field.Flip(this.m_pos, FLIP_DIRECTION.TOP_BOTTOM);

    // Mirror pads to other side of board.
    for (const pad of this.m_pads) pad.Flip(this.m_pos, FLIP_DIRECTION.TOP_BOTTOM);

    // Now set the new orientation.
    this.m_orient = newOrientation;

    // Mirror zones to other side of board.
    for (const zone of this.m_zones) zone.Flip(this.m_pos, FLIP_DIRECTION.TOP_BOTTOM);

    // Reverse mirror footprint graphics and texts.
    for (const item of this.m_drawings) item.Flip(this.m_pos, FLIP_DIRECTION.TOP_BOTTOM);

    // Points move but don't flip layer
    for (const point of this.m_points) point.Flip(this.m_pos, FLIP_DIRECTION.TOP_BOTTOM);

    // Swap the courtyard sides, then mirror in the same way as everything else.
    if (this.m_courtyard_cache) {
      [this.m_courtyard_cache.back, this.m_courtyard_cache.front] = [
        this.m_courtyard_cache.front,
        this.m_courtyard_cache.back,
      ];
      this.m_courtyard_cache.back.Mirror(this.m_pos, FLIP_DIRECTION.TOP_BOTTOM);
      this.m_courtyard_cache.back_hash = this.m_courtyard_cache.back.GetHash();
      this.m_courtyard_cache.front.Mirror(this.m_pos, FLIP_DIRECTION.TOP_BOTTOM);
      this.m_courtyard_cache.front_hash = this.m_courtyard_cache.front.GetHash();
    }

    if (this.m_geometry_cache)
      this.m_geometry_cache.hull.Mirror(this.m_pos, FLIP_DIRECTION.TOP_BOTTOM);

    // Now rotate 180 deg if required
    if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) this.Rotate(aCentre, ANGLE_180);

    if (this.m_geometry_cache) this.m_geometry_cache.text_excluded_bbox_timestamp = 0;
  }

  /**
   * Move the reference point of the footprint.
   *
   * It looks like a move footprint:
   * the footprints elements (pads, outlines, edges .. ) are moved
   * However:
   * - the footprint position is not modified.
   * - the relative (local) coordinates of these items are modified
   * (a move footprint does not change these local coordinates,
   * but changes the footprint position)
   */
  MoveAnchorPosition(aMoveVector: VECTOR2I): void {
    /*
     * Move the reference point of the footprint
     * the footprints elements (pads, outlines, edges .. ) are moved
     * but:
     * - the footprint position is not modified.
     * - the relative (local) coordinates of these items are modified
     * - Draw coordinates are updated
     */

    // Update (move) the relative coordinates relative to the new anchor point.
    let moveVector = { ...aMoveVector };
    moveVector = RotatePoint(moveVector, this.GetOrientation().negate());

    // Update field local coordinates
    for (const field of this.m_fields) field.Move(moveVector);

    // Update the pad local coordinates.
    for (const pad of this.m_pads) pad.Move(moveVector);

    // Update the draw element coordinates.
    for (const item of this.GraphicalItems()) item.Move(moveVector);

    // Update the keepout zones
    for (const zone of this.Zones()) zone.Move(moveVector);

    // Update the 3D models
    for (const model of this.Models()) {
      model.m_Offset.x += pcbIUScale.iuToMM(moveVector.x);
      model.m_Offset.y -= pcbIUScale.iuToMM(moveVector.y);
    }

    if (this.m_geometry_cache) {
      this.m_geometry_cache.bounding_box.Move(moveVector);
      this.m_geometry_cache.text_excluded_bbox.Move(moveVector);
      this.m_geometry_cache.hull.Move(moveVector);
    }

    // The geometry work have been conserved by using Move(). But the hashes
    // need to be updated, otherwise the cached polygons will still be rebuild.
    if (this.m_courtyard_cache) {
      this.m_courtyard_cache.back.Move(moveVector);
      this.m_courtyard_cache.back_hash = this.m_courtyard_cache.back.GetHash();
      this.m_courtyard_cache.front.Move(moveVector);
      this.m_courtyard_cache.front_hash = this.m_courtyard_cache.front.GetHash();
    }
  }

  /**
   * @return true if the footprint is flipped, i.e. on the back side of the board
   */
  IsFlipped(): boolean {
    return this.GetLayer() === PCB_LAYER_ID.B_Cu;
  }

  /**
   * Use instead of IsFlipped() when you also need to account for unsided footprints (those
   * purely on user-layers, etc.).
   */
  GetSide(): PCB_LAYER_ID {
    const board = this.GetBoard();

    if (board) {
      if (board.IsFootprintHolder()) return PCB_LAYER_ID.UNDEFINED_LAYER;
    }

    // Test pads first; they're the most likely to return a quick answer.
    for (const pad of this.m_pads) {
      if (LSET.SideSpecificMask().and(pad.GetLayerSet()).any()) return this.GetLayer();
    }

    for (const item of this.m_drawings) {
      if (IsValidLayer(item.GetLayer()) && LSET.SideSpecificMask().test(item.GetLayer()))
        return this.GetLayer();
    }

    for (const zone of this.m_zones) {
      if (LSET.SideSpecificMask().and(zone.GetLayerSet()).any()) return this.GetLayer();
    }

    return PCB_LAYER_ID.UNDEFINED_LAYER;
  }

  /**
   * @copydoc BOARD_ITEM::IsOnLayer
   */
  override IsOnLayer(aLayer: PCB_LAYER_ID): boolean {
    // If we have any pads, fall back on normal checking
    for (const pad of this.m_pads) {
      if (pad.IsOnLayer(aLayer)) return true;
    }

    for (const zone of this.m_zones) {
      if (zone.IsOnLayer(aLayer)) return true;
    }

    for (const field of this.m_fields) {
      if (field.IsOnLayer(aLayer)) return true;
    }

    for (const item of this.m_drawings) {
      if (item.IsOnLayer(aLayer)) return true;
    }

    return false;
  }

  override IsLocked(): boolean {
    return (this.m_fpStatus & FP_is_LOCKED) !== 0;
  }

  /**
   * Set the #MODULE_is_LOCKED bit in the m_ModuleStatus.
   *
   * @param isLocked true means turn on locked status, else unlock
   */
  override SetLocked(isLocked: boolean): void {
    if (isLocked) this.m_fpStatus |= FP_is_LOCKED;
    else this.m_fpStatus &= ~FP_is_LOCKED;
  }

  /**
   * @return true if the footprint is flagged with conflicting with some item
   */
  IsConflicting(): boolean {
    return this.HasFlag(COURTYARD_CONFLICT);
  }

  IsPlaced(): boolean {
    return (this.m_fpStatus & FP_is_PLACED) !== 0;
  }
  SetIsPlaced(isPlaced: boolean): void {
    if (isPlaced) this.m_fpStatus |= FP_is_PLACED;
    else this.m_fpStatus &= ~FP_is_PLACED;
  }

  NeedsPlaced(): boolean {
    return (this.m_fpStatus & FP_to_PLACE) !== 0;
  }
  SetNeedsPlaced(needsPlaced: boolean): void {
    if (needsPlaced) this.m_fpStatus |= FP_to_PLACE;
    else this.m_fpStatus &= ~FP_to_PLACE;
  }

  LegacyPadsLocked(): boolean {
    return (this.m_fpStatus & FP_PADS_are_LOCKED) !== 0;
  }

  /**
   * Test if footprint attributes for type (SMD/Through hole/Other) match the expected
   * type based on the pads in the footprint.
   * Footprints with plated through-hole pads should usually be marked through hole even if they
   * also have SMD because they might not be auto-placed.  Exceptions to this might be shielded
   * connectors.  Otherwise, footprints with SMD pads should be marked SMD.
   * Footprints with no connecting pads should be marked "Other"
   *
   * @param aErrorHandler callback to handle the error messages generated
   */
  CheckFootprintAttributes(aErrorHandler: ((aMsg: string) => void) | null): void {
    const likelyAttr = this.GetLikelyAttribute() & (FP_SMD | FP_THROUGH_HOLE);
    const setAttr = this.GetAttributes() & (FP_SMD | FP_THROUGH_HOLE);

    if (setAttr && likelyAttr && setAttr !== likelyAttr) {
      let msg = '';

      switch (likelyAttr) {
        case FP_THROUGH_HOLE:
          msg = `(expected 'Through hole'; actual '${this.GetTypeName()}')`;
          break;
        case FP_SMD:
          msg = `(expected 'SMD'; actual '${this.GetTypeName()}')`;
          break;
      }

      if (aErrorHandler) aErrorHandler(msg);
    }
  }

  /**
   * Run non-board-specific DRC checks on footprint's pads.  These are the checks supported by
   * both the PCB DRC and the Footprint Editor Footprint Checker.
   *
   * @param aErrorHandler callback to handle the error messages generated
   */
  CheckPads(
    aUnitsProvider: UNITS_PROVIDER,
    aErrorHandler: ((aPad: PAD, aErrorCode: number, aMsg: string) => void) | null,
  ): void {
    if (aErrorHandler === null) return;

    for (const pad of this.Pads()) {
      pad.CheckPad(aUnitsProvider, false, (errorCode: number, msg: string) => {
        aErrorHandler(pad, errorCode, msg);
      });
    }
  }

  /**
   * Check for overlapping, different-numbered, non-net-tie pads.
   *
   * @param aErrorHandler callback to handle the error messages generated
   */
  CheckShortingPads(
    aErrorHandler: (aPad: PAD, aOther: PAD, aErrorCode: number, aPos: VECTOR2I) => void,
  ): void {
    const checkedPairs = new Set<string>();
    const padIndex = new Map<PAD, number>();

    this.Pads().forEach((pad, idx) => padIndex.set(pad, idx));

    for (const pad of this.Pads()) {
      const netTiePads = this.GetNetTiePads(pad);

      for (const other of this.Pads()) {
        if (other === pad) continue;

        // store canonical order so we don't collide in both directions (a:b and b:a)
        let a = pad;
        let b = other;

        if (padIndex.get(a)! > padIndex.get(b)!) [a, b] = [b, a];

        const key = `${padIndex.get(a)}:${padIndex.get(b)}`;

        if (!checkedPairs.has(key)) {
          checkedPairs.add(key);

          if (pad.HasDrilledHole() && other.HasDrilledHole()) {
            const pos = pad.GetPosition();

            if (equal(pad.GetPosition(), other.GetPosition())) {
              aErrorHandler(pad, other, PCB_DRC_CODE.DRCE_DRILLED_HOLES_COLOCATED, pos);
            } else {
              const holeA = pad.GetEffectiveHoleShape();
              const holeB = other.GetEffectiveHoleShape();

              if (holeA.Collide(holeB.GetSeg(), 0))
                aErrorHandler(pad, other, PCB_DRC_CODE.DRCE_DRILLED_HOLES_TOO_CLOSE, pos);
            }
          }

          if (pad.SameLogicalPadAs(other) || netTiePads.includes(other)) continue;

          if (!pad.GetLayerSet().and(other.GetLayerSet()).and(LSET.AllCuMask()).any()) continue;

          if (pad.GetBoundingBox().Intersects(other.GetBoundingBox())) {
            const pos: VECTOR2I = { x: 0, y: 0 };

            for (const l of pad.Padstack().RelevantShapeLayers(other.Padstack())) {
              const padShape = pad.GetEffectiveShape(l);
              const otherShape = other.GetEffectiveShape(l);

              if (padShape.Collide(otherShape, 0, undefined, pos))
                aErrorHandler(pad, other, PCB_DRC_CODE.DRCE_SHORTING_ITEMS, pos);
            }
          }
        }
      }
    }
  }

  /**
   * Check for un-allowed shorting of pads in net-tie footprints.  If two pads are shorted,
   * they must both appear in one of the allowed-shorting lists.
   *
   * @param aErrorHandler callback to handle the error messages generated
   */
  CheckNetTies(
    aErrorHandler: (
      aItem: BOARD_ITEM,
      bItem: BOARD_ITEM,
      cItem: BOARD_ITEM | null,
      aPos: VECTOR2I,
    ) => void,
  ): void {
    // First build a map from pad numbers to allowed-shorting-group indexes.  This ends up being
    // something like O(3n), but it still beats O(n^2) for large numbers of pads.
    const padNumberToGroupIdxMap = this.MapPadNumbersToNetTieGroups();

    // Now collect all the footprint items which are on copper layers
    const copperItems: BOARD_ITEM[] = [];

    for (const item of this.m_drawings) {
      if (item.IsOnCopperLayer()) copperItems.push(item);

      item.RunOnChildren((descendent: BOARD_ITEM) => {
        if (descendent.IsOnCopperLayer()) copperItems.push(descendent);
      }, RECURSE_MODE.RECURSE);
    }

    for (const zone of this.m_zones) {
      if (!zone.GetIsRuleArea() && zone.IsOnCopperLayer()) copperItems.push(zone);
    }

    for (const field of this.m_fields) {
      if (field.IsOnCopperLayer()) copperItems.push(field);
    }

    for (const layer of [PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.In1_Cu, PCB_LAYER_ID.B_Cu]) {
      // Next, build a polygon-set for the copper on this layer.  We don't really care about
      // nets here, we just want to end up with a set of outlines describing the distinct
      // copper polygons of the footprint.
      const copperOutlines = new SHAPE_POLY_SET();
      const outlineIdxToPadsMap = new Map<number, PAD[]>();

      for (const item of copperItems) {
        if (item.IsOnLayer(layer))
          item.TransformShapeToPolygon(
            copperOutlines,
            layer,
            0,
            this.GetMaxError(),
            ERROR_LOC.ERROR_OUTSIDE,
          );
      }

      copperOutlines.Simplify();

      // Index each pad to the outline in the set that it is part of.
      for (const pad of this.m_pads) {
        for (let ii = 0; ii < copperOutlines.OutlineCount(); ++ii) {
          if (pad.GetEffectiveShape(layer).Collide(copperOutlines.Outline(ii), 0)) {
            let pads = outlineIdxToPadsMap.get(ii);

            if (!pads) {
              pads = [];
              outlineIdxToPadsMap.set(ii, pads);
            }

            pads.push(pad);
          }
        }
      }

      // Finally, ensure that each outline which contains multiple pads has all its pads
      // listed in an allowed-shorting group.
      for (const [outlineIdx, pads] of [...outlineIdxToPadsMap.entries()].sort(
        (a, b) => a[0] - b[0],
      )) {
        if (pads.length > 1) {
          const firstPad = pads[0]!;
          const firstGroupIdx = padNumberToGroupIdxMap.get(firstPad.GetNumber()) ?? 0;

          for (let ii = 1; ii < pads.length; ++ii) {
            const thisPad = pads[ii]!;
            const thisGroupIdx = padNumberToGroupIdxMap.get(thisPad.GetNumber()) ?? 0;

            if (thisGroupIdx < 0 || thisGroupIdx !== firstGroupIdx) {
              let shortingItem: BOARD_ITEM | null = null;
              let pos: VECTOR2I = {
                x: Math.trunc((firstPad.GetPosition().x + thisPad.GetPosition().x) / 2),
                y: Math.trunc((firstPad.GetPosition().y + thisPad.GetPosition().y) / 2),
              };

              pos = copperOutlines.Outline(outlineIdx).NearestPoint(pos);

              for (const item of copperItems) {
                if (item.HitTest(pos, 1)) {
                  shortingItem = item;
                  break;
                }
              }

              if (shortingItem) aErrorHandler(shortingItem, firstPad, thisPad, pos);
              else aErrorHandler(firstPad, thisPad, null, pos);
            }
          }
        }
      }
    }
  }

  /**
   * Sanity check net-tie pad groups.  Pads cannot be listed more than once, and pad numbers
   * must correspond to a pad.
   *
   * @param aErrorHandler callback to handle the error messages generated
   */
  CheckNetTiePadGroups(aErrorHandler: (aMsg: string) => void): void {
    const padNumbers = new Set<string>();
    let msg: string;

    for (const padNumber of [...this.MapPadNumbersToNetTieGroups().keys()].sort()) {
      const pad = this.FindPadByNumber(padNumber);

      if (!pad) {
        msg = `(net-tie pad group contains unknown pad number ${padNumber})`;
        aErrorHandler(msg);
      } else if (padNumbers.has(pad.GetNumber())) {
        msg = `(pad ${padNumber} appears in more than one net-tie pad group)`;
        aErrorHandler(msg);
      } else {
        padNumbers.add(pad.GetNumber());
      }
    }
  }

  CheckClippedSilk(
    aErrorHandler: (aItemA: BOARD_ITEM, aItemB: BOARD_ITEM, aPt: VECTOR2I) => void,
  ): void {
    const checkColliding = (item: BOARD_ITEM, other: BOARD_ITEM): void => {
      for (const silk of [PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.B_SilkS]) {
        const mask = silk === PCB_LAYER_ID.F_SilkS ? PCB_LAYER_ID.F_Mask : PCB_LAYER_ID.B_Mask;

        if (!item.IsOnLayer(silk) || !other.IsOnLayer(mask)) continue;

        const itemShape = item.GetEffectiveShape(silk);
        const otherShape = other.GetEffectiveShape(mask);
        const actual = { value: 0 };
        const pos: VECTOR2I = { x: 0, y: 0 };

        if (itemShape.Collide(otherShape, 0, actual, pos)) aErrorHandler(item, other, pos);
      }
    };

    for (const item of this.m_drawings) {
      for (const other of this.m_drawings) {
        if (other !== item) checkColliding(item, other);
      }

      for (const pad of this.m_pads) checkColliding(item, pad);
    }
  }

  /**
   * Cache the pads that are allowed to connect to each other in the footprint.
   */
  BuildNetTieCache(): void {
    this.m_netTieCache.clear();

    const map = this.MapPadNumbersToNetTieGroups();
    const layer_shapes = new Map<PCB_LAYER_ID, PCB_SHAPE[]>();
    const board = this.GetBoard();

    for (const item of this.m_drawings) {
      if (item.Type() !== KICAD_T.PCB_SHAPE_T) continue;

      for (const layer of item.GetLayerSet()) {
        if (!IsCopperLayer(layer)) continue;

        if (board && !board.GetEnabledLayers().Contains(layer)) continue;

        let shapes = layer_shapes.get(layer);

        if (!shapes) {
          shapes = [];
          layer_shapes.set(layer, shapes);
        }

        shapes.push(item as PCB_SHAPE);
      }
    }

    const cacheOf = (item: BOARD_ITEM): Set<number> => {
      let set = this.m_netTieCache.get(item);

      if (!set) {
        set = new Set();
        this.m_netTieCache.set(item, set);
      }

      return set;
    };

    for (let ii = 0; ii < this.m_pads.length; ++ii) {
      const pad = this.m_pads[ii]!;
      let has_nettie = false;

      const it = map.get(pad.GetNumber());

      if (it === undefined || it < 0) continue;

      for (let jj = ii + 1; jj < this.m_pads.length; ++jj) {
        const other = this.m_pads[jj]!;

        const it2 = map.get(other.GetNumber());

        if (it2 === undefined || it2 < 0) continue;

        if (it2 === it) {
          cacheOf(pad).add(pad.GetNetCode());
          cacheOf(pad).add(other.GetNetCode());
          cacheOf(other).add(other.GetNetCode());
          cacheOf(other).add(pad.GetNetCode());
          has_nettie = true;
        }
      }

      if (!has_nettie) continue;

      for (const [layer, shapes] of [...layer_shapes.entries()].sort((a, b) => a[0] - b[0])) {
        const pad_shape = pad.GetEffectiveShape(layer);

        for (const other_shape of shapes) {
          const shape = other_shape.GetEffectiveShape(layer);

          if (pad_shape.Collide(shape)) {
            const nettie = cacheOf(pad);
            const otherCache = cacheOf(other_shape);

            for (const n of nettie) otherCache.add(n);
          }
        }
      }
    }
  }

  /**
   * Get the set of net codes that are allowed to connect to a footprint item
   */
  GetNetTieCache(aItem: BOARD_ITEM): ReadonlySet<number> {
    const it = this.m_netTieCache.get(aItem);

    if (!it) return emptySet;

    return it;
  }

  /**
   * Generate pads shapes on layer \a aLayer as polygons and adds these polygons to
   * \a aBuffer.
   *
   * Useful to generate a polygonal representation of a footprint in 3D view and plot functions,
   * when a full polygonal approach is needed.
   *
   * @param aLayer is the layer to consider, or #UNDEFINED_LAYER to consider all layers.
   * @param aBuffer i the buffer to store polygons.
   * @param aClearance is an additional size to add to pad shapes.
   * @param aMaxError is the maximum deviation from true for arcs.
   */
  TransformPadsToPolySet(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aMaxError: number,
    aErrorLoc: ERROR_LOC,
  ): void {
    const processPad = (pad: PAD, padLayer: PCB_LAYER_ID): void => {
      const clearance: VECTOR2I = { x: aClearance, y: aClearance };

      switch (aLayer) {
        case PCB_LAYER_ID.F_Mask:
        case PCB_LAYER_ID.B_Mask:
          clearance.x += pad.GetSolderMaskExpansion(padLayer);
          clearance.y += pad.GetSolderMaskExpansion(padLayer);
          break;

        case PCB_LAYER_ID.F_Paste:
        case PCB_LAYER_ID.B_Paste: {
          const margin = pad.GetSolderPasteMargin(padLayer);
          clearance.x += margin.x;
          clearance.y += margin.y;
          break;
        }

        default:
          break;
      }

      // Our standard TransformShapeToPolygon() routines can't handle differing x:y clearance
      // values (which get generated when a relative paste margin is used with an oblong pad).
      // So we apply this huge hack and fake a larger pad to run the transform on.
      // Of course being a hack it falls down when dealing with custom shape pads (where the
      // size is only the size of the anchor), so for those we punt and just use clearance.x.

      if (
        (clearance.x < 0 || clearance.x !== clearance.y) &&
        pad.GetShape(padLayer) !== PAD_SHAPE.CUSTOM
      ) {
        const dummySize: VECTOR2I = {
          x: pad.GetSize(padLayer).x + clearance.x + clearance.x,
          y: pad.GetSize(padLayer).y + clearance.y + clearance.y,
        };

        if (dummySize.x <= 0 || dummySize.y <= 0) return;

        const dummy = PAD.copyOfPad(pad);
        dummy.SetSize(padLayer, dummySize);
        dummy.TransformShapeToPolygon(aBuffer, padLayer, 0, aMaxError, aErrorLoc);
      } else {
        pad.TransformShapeToPolygon(aBuffer, padLayer, clearance.x, aMaxError, aErrorLoc);
      }
    };

    for (const pad of this.m_pads) {
      if (!pad.FlashLayer(aLayer)) continue;

      if (aLayer === PCB_LAYER_ID.UNDEFINED_LAYER) {
        pad.Padstack().ForEachUniqueLayer((l: PCB_LAYER_ID) => {
          processPad(pad, l);
        });
      } else {
        processPad(pad, aLayer);
      }
    }
  }

  /**
   * Generate shapes of graphic items (outlines) on layer \a aLayer as polygons and adds these
   * polygons to \a aBuffer.
   *
   * Useful to generate a polygonal representation of a footprint in 3D view and plot functions,
   * when a full polygonal approach is needed.
   *
   * @param aLayer is the layer to consider, or #UNDEFINED_LAYER to consider all.
   * @param aBuffer is the buffer to store polygons.
   * @param aClearance is a value to inflate shapes.
   * @param aError is the maximum error between true arc and polygon approximation.
   * @param aIncludeText set to true to transform text shapes.
   * @param aIncludeShapes set to true to transform footprint shapes.
   */
  TransformFPShapesToPolySet(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aError: number,
    aErrorLoc: ERROR_LOC,
    aIncludeText = true,
    aIncludeShapes = true,
    aIncludePrivateItems = false,
  ): void {
    for (const item of this.GraphicalItems()) {
      if (this.GetPrivateLayers().test(item.GetLayer()) && !aIncludePrivateItems) continue;

      if (item.Type() === KICAD_T.PCB_TEXT_T && aIncludeText) {
        const text = item as PCB_TEXT;

        if (aLayer === PCB_LAYER_ID.UNDEFINED_LAYER || text.GetLayer() === aLayer)
          text.TransformTextToPolySet(aBuffer, aClearance, aError, aErrorLoc);
      }

      if (item.Type() === KICAD_T.PCB_TEXTBOX_T && aIncludeText) {
        const textbox = item as PCB_TEXTBOX;

        if (aLayer === PCB_LAYER_ID.UNDEFINED_LAYER || textbox.GetLayer() === aLayer) {
          // border
          if (textbox.IsBorderEnabled())
            // textbox->PCB_SHAPE::TransformShapeToPolygon( aBuffer, aLayer, 0, aError, aErrorLoc )
            (
              PCB_SHAPE.prototype.TransformShapeToPolygon as (
                this: PCB_SHAPE,
                aBuffer: SHAPE_POLY_SET,
                aLayer: PCB_LAYER_ID,
                aClearance: number,
                aError: number,
                aErrorLoc: ERROR_LOC,
              ) => void
            ).call(textbox, aBuffer, aLayer, 0, aError, aErrorLoc);

          // text
          textbox.TransformTextToPolySet(aBuffer, 0, aError, aErrorLoc);
        }
      }

      if (item.Type() === KICAD_T.PCB_SHAPE_T && aIncludeShapes) {
        const shape = item as PCB_SHAPE;

        if (aLayer === PCB_LAYER_ID.UNDEFINED_LAYER || shape.GetLayer() === aLayer)
          shape.TransformShapeToPolySet(aBuffer, aLayer, 0, aError, aErrorLoc);
      }

      if (item.Type() === KICAD_T.PCB_BARCODE_T && aIncludeShapes) {
        // const PCB_BARCODE* barcode = static_cast<PCB_BARCODE*>( item );
        // if( aLayer == UNDEFINED_LAYER || barcode->GetLayer() == aLayer )
        //     barcode->TransformShapeToPolySet( aBuffer, aLayer, 0, aError, aErrorLoc );
        //                                                     -- PCB_BARCODE pending (#636)
      }
    }

    if (aIncludeText) {
      for (const field of this.m_fields) {
        if (
          (aLayer === PCB_LAYER_ID.UNDEFINED_LAYER || field.GetLayer() === aLayer) &&
          field.IsVisible()
        )
          field.TransformTextToPolySet(aBuffer, aClearance, aError, aErrorLoc);
      }
    }
  }

  /**
   * This function is the same as TransformFPShapesToPolySet but only generates text.
   */
  TransformFPTextToPolySet(
    aBuffer: SHAPE_POLY_SET,
    aLayer: PCB_LAYER_ID,
    aClearance: number,
    aError: number,
    aErrorLoc: ERROR_LOC,
  ): void {
    this.TransformFPShapesToPolySet(aBuffer, aLayer, aClearance, aError, aErrorLoc, true, false);
  }

  /**
   * Return the list of system text vars for this footprint.
   */
  GetContextualTextVars(aVars: string[]): void {
    aVars.push('REFERENCE');
    aVars.push('VALUE');
    aVars.push('LAYER');
    aVars.push('FOOTPRINT_LIBRARY');
    aVars.push('FOOTPRINT_NAME');
    aVars.push('SHORT_NET_NAME(<pad_number>)');
    aVars.push('NET_NAME(<pad_number>)');
    aVars.push('NET_CLASS(<pad_number>)');
    aVars.push('PIN_NAME(<pad_number>)');
  }

  /**
   * Resolve any references to system tokens supported by the component.
   *
   * @param aDepth a counter to limit recursion and circular references.
   */
  ResolveTextVar(token: OutStr, aDepth = 0): boolean {
    if (this.GetBoard() && this.GetBoard()!.GetBoardUse() === BOARD_USE.FPHOLDER) return false;

    if (token.value === 'REFERENCE') {
      token.value = this.Reference().GetShownText(false, aDepth + 1);
      return true;
    } else if (token.value === 'VALUE') {
      token.value = this.Value().GetShownText(false, aDepth + 1);
      return true;
    } else if (token.value === 'LAYER') {
      token.value = this.GetLayerName();
      return true;
    } else if (token.value === 'FOOTPRINT_LIBRARY') {
      token.value = this.m_fpid.GetUniStringLibNickname();
      return true;
    } else if (token.value === 'FOOTPRINT_NAME') {
      token.value = this.m_fpid.GetUniStringLibItemName();
      return true;
    } else if (
      token.value.startsWith('SHORT_NET_NAME(') ||
      token.value.startsWith('NET_NAME(') ||
      token.value.startsWith('NET_CLASS(') ||
      token.value.startsWith('PIN_NAME(')
    ) {
      let padNumber = token.value.slice(token.value.indexOf('(') + 1);
      const close = padNumber.lastIndexOf(')');
      padNumber = close >= 0 ? padNumber.slice(0, close) : padNumber; // BeforeLast( ')' ): the whole string when no ')'

      for (const pad of this.Pads()) {
        if (pad.GetNumber() === padNumber) {
          if (token.value.startsWith('SHORT_NET_NAME')) token.value = pad.GetShortNetname();
          else if (token.value.startsWith('NET_NAME')) token.value = pad.GetNetname();
          else if (token.value.startsWith('NET_CLASS')) token.value = pad.GetNetClassName();
          else token.value = pad.GetPinFunction();

          return true;
        }
      }
    } else {
      const field = this.GetField(token.value);

      if (field) {
        token.value = field.GetShownText(false, aDepth + 1);
        return true;
      }
    }

    if (this.GetBoard() && this.GetBoard()!.ResolveTextVar(token, aDepth + 1)) return true;

    return false;
  }

  /// @copydoc EDA_ITEM::GetMsgPanelInfo
  override GetMsgPanelInfo(aFrame: EDA_DRAW_FRAME_LIKE, aList: MSG_PANEL_ITEM[]): void {
    let msg: string;
    let msg2: string;
    let variant = '';

    const board = this.GetBoard();

    if (board) variant = board.GetCurrentVariant();

    // Don't use GetShownText(); we want to see the variable references here
    aList.push(
      new MSG_PANEL_ITEM(
        unescapeString(this.Reference().GetText()),
        unescapeString(this.GetFieldValueForVariant(variant, GetCanonicalFieldName(FIELD_T.VALUE))),
      ),
    );

    const frameName = aFrame.GetName();

    if (
      frameName === FOOTPRINT_VIEWER_FRAME_NAME ||
      frameName === FOOTPRINT_CHOOSER_FRAME_NAME ||
      frameName === FOOTPRINT_EDIT_FRAME_NAME
    ) {
      const padCount = this.GetPadCount(DO_NOT_INCLUDE_NPTH);

      aList.push(new MSG_PANEL_ITEM('Library', this.GetFPID().GetLibNickname()));

      aList.push(new MSG_PANEL_ITEM('Footprint Name', this.GetFPID().GetLibItemName()));

      aList.push(new MSG_PANEL_ITEM('Pads', `${padCount}`));

      aList.push(
        new MSG_PANEL_ITEM(`Doc: ${this.GetLibDescription()}`, `Keywords: ${this.GetKeywords()}`),
      );

      return;
    }

    // aFrame is the board editor:
    switch (this.GetSide()) {
      case PCB_LAYER_ID.F_Cu:
        aList.push(new MSG_PANEL_ITEM('Board Side', 'Front'));
        break;
      case PCB_LAYER_ID.B_Cu:
        aList.push(new MSG_PANEL_ITEM('Board Side', 'Back (Flipped)'));
        break;
      default:
        /* unsided: user-layers only, etc. */ break;
    }

    aList.push(new MSG_PANEL_ITEM('Rotation', formatG(this.GetOrientation().AsDegrees(), 4)));

    const addToken = (aStr: string, aAttr: string): string => {
      if (aStr !== '') aStr += ', ';

      aStr += aAttr;
      return aStr;
    };

    let status = '';
    let attrs = '';

    if (this.IsLocked()) status = addToken(status, 'Locked');

    if (this.IsPlaced()) status = addToken(status, 'autoplaced');

    if (this.IsBoardOnly()) attrs = addToken(attrs, 'not in schematic');

    if (this.GetExcludedFromPosFilesForVariant(variant))
      attrs = addToken(attrs, 'exclude from pos files');

    if (this.GetExcludedFromBOMForVariant(variant)) attrs = addToken(attrs, 'exclude from BOM');

    if (this.GetDNPForVariant(variant)) attrs = addToken(attrs, 'DNP');

    aList.push(new MSG_PANEL_ITEM(`Status: ${status}`, `Attributes: ${attrs}`));

    // if( !m_componentClassCacheProxy->GetComponentClass()->IsEmpty() )
    //     aList.emplace_back( _( "Component Class" ), ...GetHumanReadableName() );   -- COMPONENT_CLASS pending (#636)

    msg = `Footprint: ${this.m_fpid.GetUniStringLibId()}`;
    msg2 = `3D-Shape: ${this.m_3D_Drawings.length === 0 ? '<none>' : this.m_3D_Drawings[0]!.m_Filename}`;
    aList.push(new MSG_PANEL_ITEM(msg, msg2));

    msg = `Doc: ${this.m_libDescription}`;
    msg2 = `Keywords: ${this.m_keywords}`;
    aList.push(new MSG_PANEL_ITEM(msg, msg2));
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I) return this.hitTestRect(a, b as boolean, c ?? 0);

    if ('x' in a && 'y' in a) return this.hitTestPoint(a, (b as number | undefined) ?? 0);

    return this.hitTestChain(a, b as boolean);
  }

  /** `HitTest( const VECTOR2I& aPosition, int aAccuracy )`. */
  private hitTestPoint(aPosition: VECTOR2I, aAccuracy: number): boolean {
    const rect = this.GetBoundingBox(false);
    return rect.Inflate(aAccuracy).Contains(aPosition);
  }

  override Matches(aSearchData: EDA_SEARCH_DATA, aAuxData: unknown): boolean {
    if (aSearchData.searchMetadata) {
      if (this.matchesText(this.GetFPIDAsString(), aSearchData)) return true;

      if (this.matchesText(this.GetLibDescription(), aSearchData)) return true;

      if (this.matchesText(this.GetKeywords(), aSearchData)) return true;
    }

    return false;
  }

  /**
   * Test if a point is inside the bounding polygon of the footprint.
   *
   * The other hit test methods are just checking the bounding box, which can be quite
   * inaccurate for rotated or oddly-shaped footprints.
   *
   * @param aPosition is the point to test
   * @return true if aPosition is inside the bounding polygon
   */
  HitTestAccurate(aPosition: VECTOR2I, aAccuracy = 0): boolean {
    return this.GetBoundingHull().Collide(aPosition, aAccuracy);
  }

  /** `HitTest( const BOX2I& aRect, bool aContained, int aAccuracy )`. */
  private hitTestRect(aRect: BOX2I, aContained: boolean, aAccuracy: number): boolean {
    const arect = new BOX2I(aRect.GetPosition(), aRect.GetSize());
    arect.Inflate(aAccuracy);

    if (aContained) {
      return arect.Contains(this.GetBoundingBox(false));
    } else {
      // If the rect does not intersect the bounding box, skip any tests
      if (!aRect.Intersects(this.GetBoundingBox(false))) return false;

      // If there are no pads, zones, or drawings, allow intersection with text
      if (this.m_pads.length === 0 && this.m_zones.length === 0 && this.m_drawings.length === 0)
        return this.GetBoundingBox(true).Intersects(arect);

      // Determine if any elements in the FOOTPRINT intersect the rect
      for (const pad of this.m_pads) {
        if (pad.HitTest(arect, false, 0)) return true;
      }

      for (const zone of this.m_zones) {
        if (zone.HitTest(arect, false, 0)) return true;
      }

      for (const point of this.m_points) {
        if (point.HitTest(arect, false, 0)) return true;
      }

      // PCB fields are selectable on their own, so they don't get tested

      for (const item of this.m_drawings) {
        // Text items are selectable on their own, and are therefore excluded from this
        // test.  TextBox items are NOT selectable on their own, and so MUST be included
        // here. Bitmaps aren't selectable since they aren't displayed.
        if (item.Type() !== KICAD_T.PCB_TEXT_T && item.HitTest(arect, false, 0)) return true;
      }

      // Groups are not hit-tested; only their members

      // No items were hit
      return false;
    }
  }

  /** `HitTest( const SHAPE_LINE_CHAIN& aPoly, bool aContained )`. */
  private hitTestChain(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean {
    // If there are no pads, zones, or drawings, test footprint text instead.
    if (this.m_pads.length === 0 && this.m_zones.length === 0 && this.m_drawings.length === 0)
      return KIGEOM_BoxHitTestChain(aPoly, this.GetBoundingBox(true), aContained);

    const hitTest = (aItem: BOARD_ITEM | null): boolean => {
      return !!aItem && aItem.HitTest(aPoly, aContained);
    };

    // Filter out text items from the drawings, since they are selectable on their own,
    // and we don't want to select the whole footprint when text is hit. TextBox items are NOT
    // selectable on their own, so they are not excluded here.
    const drawings = this.m_drawings.filter(
      (aItem) => !!aItem && aItem.Type() !== KICAD_T.PCB_TEXT_T,
    );

    // Test pads, zones and drawings with text excluded. PCB fields are also selectable
    // on their own, so they don't get tested. Groups are not hit-tested, only their members.
    // Bitmaps aren't selectable since they aren't displayed.
    if (aContained) {
      // All items must be contained in the selection poly.
      return drawings.every(hitTest) && this.m_pads.every(hitTest) && this.m_zones.every(hitTest);
    } else {
      // Any item intersecting the selection poly is sufficient.
      return drawings.some(hitTest) || this.m_pads.some(hitTest) || this.m_zones.some(hitTest);
    }
  }

  /**
   * Test if the point hits one or more of the footprint elements on a given layer.
   *
   * @param aPosition is the point to test
   * @param aAccuracy is the hit test accuracy
   * @param aLayer is the layer to test
   * @return true if aPosition hits a footprint element on aLayer
   */
  HitTestOnLayer(aPosition: VECTOR2I, aLayer: PCB_LAYER_ID, aAccuracy?: number): boolean;
  HitTestOnLayer(
    aRect: BOX2I,
    aContained: boolean,
    aLayer: PCB_LAYER_ID,
    aAccuracy?: number,
  ): boolean;
  HitTestOnLayer(
    a: VECTOR2I | BOX2I,
    b: PCB_LAYER_ID | boolean,
    c?: number | PCB_LAYER_ID,
    d?: number,
  ): boolean {
    if (a instanceof BOX2I) {
      const aRect = a;
      const aContained = b as boolean;
      const aLayer = c as PCB_LAYER_ID;
      const aAccuracy = d ?? 0;

      const items: BOARD_ITEM[] = [];

      for (const pad of this.m_pads) {
        if (pad.IsOnLayer(aLayer)) items.push(pad);
      }

      for (const zone of this.m_zones) {
        if (zone.IsOnLayer(aLayer)) items.push(zone);
      }

      for (const item of this.m_drawings) {
        if (item.Type() !== KICAD_T.PCB_TEXT_T && item.IsOnLayer(aLayer)) items.push(item);
      }

      // If we require the elements to be contained in the rect and any of them are not,
      // we can return false;
      // Conversely, if we just require any of the elements to have a hit, we can return true
      // when the first one is found.
      for (const item of items) {
        if (!aContained && item.HitTest(aRect, aContained, aAccuracy)) return true;
        else if (aContained && !item.HitTest(aRect, aContained, aAccuracy)) return false;
      }

      // If we didn't exit in the loop, that means that we did not return false for aContained or
      // we did not return true for !aContained.  So we can just return the bool with a test of
      // whether there were any elements or not.
      return items.length !== 0 && aContained;
    }

    const aPosition = a;
    const aLayer = b as PCB_LAYER_ID;
    const aAccuracy = (c as number | undefined) ?? 0;

    for (const pad of this.m_pads) {
      if (pad.IsOnLayer(aLayer) && pad.HitTest(aPosition, aAccuracy)) return true;
    }

    for (const zone of this.m_zones) {
      if (zone.IsOnLayer(aLayer) && zone.HitTest(aPosition, aAccuracy)) return true;
    }

    for (const item of this.m_drawings) {
      if (
        item.Type() !== KICAD_T.PCB_TEXT_T &&
        item.IsOnLayer(aLayer) &&
        item.HitTest(aPosition, aAccuracy)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * @return reference designator text.
   */
  GetReference(): string {
    return this.Reference().GetText();
  }

  /**
   * @param aReference A reference to a wxString object containing the reference designator
   *                   text.
   */
  SetReference(aReference: string): void {
    this.Reference().SetText(aReference);
  }

  // Property system doesn't like const references
  GetReferenceAsString(): string {
    return this.GetReference();
  }

  /**
   * Bump the current reference by \a aDelta.
   */
  IncrementReference(aDelta: number): void {
    const refdes = this.GetReference();

    this.SetReference(`${GetRefDesPrefix(refdes)}${getTrailingInt(refdes) + aDelta}`);
  }

  /**
   * @return the value text.
   */
  GetValue(): string {
    return this.Value().GetText();
  }

  /**
   * @param aValue A reference to a wxString object containing the value text.
   */
  SetValue(aValue: string): void {
    this.Value().SetText(aValue);
  }

  // Property system doesn't like const references
  GetValueAsString(): string {
    return this.GetValue();
  }

  /// read/write accessors:
  Value(): PCB_FIELD {
    return this.GetField(FIELD_T.VALUE);
  }
  Reference(): PCB_FIELD {
    return this.GetField(FIELD_T.REFERENCE);
  }

  //-----<Fields>-----------------------------------------------------------

  /**
   * Return a mandatory field in this footprint, creating it when it doesn't exist
   * (`GetField( FIELD_T )`), or a field by name, null when there is none (`GetField( const wxString& )`).
   */
  GetField(aFieldType: FIELD_T): PCB_FIELD;
  GetField(aFieldName: string): PCB_FIELD | null;
  GetField(a: FIELD_T | string): PCB_FIELD | null {
    if (typeof a === 'string') {
      for (const field of this.m_fields) {
        if (field.GetName() === a) return field;
      }

      return null;
    }

    for (const field of this.m_fields) {
      if (field.GetId() === a) return field;
    }

    const field = new PCB_FIELD(this, a);
    this.m_fields.push(field);
    return field;
  }

  HasField(aFieldName: string): boolean {
    return this.GetField(aFieldName) !== null;
  }

  /**
   * Populate a std::vector with PCB_TEXTs.
   *
   * @param aVector is the vector to populate.
   * @param aVisibleOnly is used to add only the fields that are visible and contain text.
   */
  GetFields(aVector: PCB_FIELD[], aVisibleOnly: boolean): void;
  /**
   * Return a reference to the deque holding the footprint's fields
   */
  GetFields(): PCB_FIELD[];
  GetFields(aVector?: PCB_FIELD[], aVisibleOnly?: boolean): PCB_FIELD[] | void {
    if (aVector === undefined) return this.m_fields;

    aVector.length = 0;

    for (const field of this.m_fields) {
      if (aVisibleOnly) {
        if (!field.IsVisible() || field.GetText() === '') continue;
      }

      aVector.push(field);
    }

    aVector.sort((lhs, rhs) => lhs.GetOrdinal() - rhs.GetOrdinal());
  }

  /**
   * Return the next ordinal for a user field for this footprint
   */
  GetNextFieldOrdinal(): number {
    let ordinal = 42; // Arbitrarily larger than any mandatory FIELD_T id

    for (const field of this.m_fields) ordinal = Math.max(ordinal, field.GetOrdinal() + 1);

    return ordinal;
  }

  /**
   * @brief Apply default board settings to the footprint field text properties.
   *
   * This is needed because the board settings are not available when the footprint is
   * being created in the footprint library cache, and we want these fields to have
   * the correct default text properties.
   */
  ApplyDefaultSettings(
    board: BOARD,
    aStyleFields: boolean,
    aStyleText: boolean,
    aStyleShapes: boolean,
    aStyleDimensions: boolean,
    aStyleBarcodes: boolean,
  ): void {
    if (aStyleFields) {
      for (const field of this.m_fields) field.StyleFromSettings(board.GetDesignSettings(), true);
    }

    for (const item of this.m_drawings) {
      switch (item.Type()) {
        case KICAD_T.PCB_TEXT_T:
        case KICAD_T.PCB_TEXTBOX_T:
          if (aStyleText) item.StyleFromSettings(board.GetDesignSettings(), true);

          break;

        case KICAD_T.PCB_SHAPE_T:
          if (aStyleShapes && !item.IsOnCopperLayer())
            item.StyleFromSettings(board.GetDesignSettings(), true);

          break;

        case KICAD_T.PCB_DIM_ALIGNED_T:
        case KICAD_T.PCB_DIM_LEADER_T:
        case KICAD_T.PCB_DIM_CENTER_T:
        case KICAD_T.PCB_DIM_RADIAL_T:
        case KICAD_T.PCB_DIM_ORTHOGONAL_T:
          if (aStyleDimensions) item.StyleFromSettings(board.GetDesignSettings(), true);

          break;

        case KICAD_T.PCB_BARCODE_T:
          if (aStyleBarcodes) item.StyleFromSettings(board.GetDesignSettings(), true);

          break;

        default:
          break;
      }
    }
  }

  SetUnitInfo(aUnits: FP_UNIT_INFO[]): void {
    this.m_unitInfo = aUnits.map((u) => ({ m_unitName: u.m_unitName, m_pins: [...u.m_pins] }));
  }
  GetUnitInfo(): readonly FP_UNIT_INFO[] {
    return this.m_unitInfo;
  }

  IsBoardOnly(): boolean {
    return (this.m_attributes & FP_BOARD_ONLY) !== 0;
  }
  SetBoardOnly(aIsBoardOnly = true): void {
    if (aIsBoardOnly) this.m_attributes |= FP_BOARD_ONLY;
    else this.m_attributes &= ~FP_BOARD_ONLY;
  }

  IsExcludedFromPosFiles(): boolean {
    return (this.m_attributes & FP_EXCLUDE_FROM_POS_FILES) !== 0;
  }
  SetExcludedFromPosFiles(aExclude = true): void {
    if (aExclude) this.m_attributes |= FP_EXCLUDE_FROM_POS_FILES;
    else this.m_attributes &= ~FP_EXCLUDE_FROM_POS_FILES;
  }

  IsExcludedFromBOM(): boolean {
    return (this.m_attributes & FP_EXCLUDE_FROM_BOM) !== 0;
  }
  SetExcludedFromBOM(aExclude = true): void {
    if (aExclude) this.m_attributes |= FP_EXCLUDE_FROM_BOM;
    else this.m_attributes &= ~FP_EXCLUDE_FROM_BOM;
  }

  IsDNP(): boolean {
    return (this.m_attributes & FP_DNP) !== 0;
  }
  SetDNP(aDNP = true): void {
    if (aDNP) this.m_attributes |= FP_DNP;
    else this.m_attributes &= ~FP_DNP;
  }

  // =====================================================================
  // Variant Support
  // =====================================================================

  /** `CASE_INSENSITIVE_MAP::find`: the stored key matching aVariantName case-insensitively. */
  private findVariantKey(aVariantName: string): string | undefined {
    for (const key of this.m_variants.keys()) {
      if (cmpNoCase(key, aVariantName) === 0) return key;
    }

    return undefined;
  }

  /**
   * Get a variant by name.
   * @param aVariantName The name of the variant.
   * @return Pointer to the variant, or nullptr if not found.
   */
  GetVariant(aVariantName: string): FOOTPRINT_VARIANT | null {
    const key = this.findVariantKey(aVariantName);
    return key !== undefined ? this.m_variants.get(key)! : null;
  }

  /**
   * Add or update a variant.
   * @param aVariant The variant to add or update.
   */
  SetVariant(aVariant: FOOTPRINT_VARIANT): void {
    if (aVariant.GetName() === '' || cmpNoCase(aVariant.GetName(), GetDefaultVariantName()) === 0) {
      return;
    }

    const key = this.findVariantKey(aVariant.GetName());

    if (key !== undefined) {
      const updated = aVariant.clone();
      updated.SetName(key);
      this.m_variants.set(key, updated);
      return;
    }

    this.m_variants.set(aVariant.GetName(), aVariant.clone());
  }

  /**
   * Add a new variant with the given name.
   * @param aVariantName The name of the variant to add.
   * @return Reference to the newly created variant.
   */
  AddVariant(aVariantName: string): FOOTPRINT_VARIANT | null {
    if (aVariantName === '' || cmpNoCase(aVariantName, GetDefaultVariantName()) === 0) {
      console.assert(false, 'Variant name cannot be empty or default.');
      return null;
    }

    const key = this.findVariantKey(aVariantName);

    if (key !== undefined) return this.m_variants.get(key)!;

    const variant = new FOOTPRINT_VARIANT(aVariantName);
    variant.SetDNP(this.IsDNP());
    variant.SetExcludedFromBOM(this.IsExcludedFromBOM());
    variant.SetExcludedFromPosFiles(this.IsExcludedFromPosFiles());

    this.m_variants.set(aVariantName, variant);
    return variant;
  }

  /**
   * Delete a variant by name.
   * @param aVariantName The name of the variant to delete.
   */
  DeleteVariant(aVariantName: string): void {
    const key = this.findVariantKey(aVariantName);

    if (key !== undefined) this.m_variants.delete(key);
  }

  /**
   * Rename a variant.
   * @param aOldName The current name of the variant.
   * @param aNewName The new name for the variant.
   */
  RenameVariant(aOldName: string, aNewName: string): void {
    if (aNewName === '' || cmpNoCase(aNewName, GetDefaultVariantName()) === 0) {
      return;
    }

    const key = this.findVariantKey(aOldName);

    if (key === undefined) return;

    const existingKey = this.findVariantKey(aNewName);

    if (existingKey !== undefined && existingKey !== key) return;

    if (key === aNewName) return;

    const variant = this.m_variants.get(key)!.clone();
    variant.SetName(aNewName);
    this.m_variants.delete(key);
    this.m_variants.set(aNewName, variant);
  }

  /**
   * Check if a variant exists.
   * @param aVariantName The name of the variant.
   * @return true if the variant exists.
   */
  HasVariant(aVariantName: string): boolean {
    return this.findVariantKey(aVariantName) !== undefined;
  }

  /**
   * Get all variants.
   * @return Map of variant name to variant data.
   */
  GetVariants(): ReadonlyMap<string, FOOTPRINT_VARIANT> {
    return this.m_variants;
  }

  /**
   * Get the DNP status for a specific variant.
   *
   * If the variant doesn't exist, returns the default DNP status.
   *
   * @param aVariantName The variant name (empty for default).
   * @return true if DNP is set for the specified variant.
   */
  GetDNPForVariant(aVariantName: string): boolean {
    // Empty variant name means default
    if (aVariantName === '' || cmpNoCase(aVariantName, GetDefaultVariantName()) === 0)
      return this.IsDNP();

    const variant = this.GetVariant(aVariantName);

    if (variant) return variant.GetDNP();

    // Fall back to default if variant doesn't exist
    return this.IsDNP();
  }

  /**
   * Get the exclude-from-BOM status for a specific variant.
   *
   * If the variant doesn't exist, returns the default exclude-from-BOM status.
   *
   * @param aVariantName The variant name (empty for default).
   * @return true if excluded from BOM for the specified variant.
   */
  GetExcludedFromBOMForVariant(aVariantName: string): boolean {
    // Empty variant name means default
    if (aVariantName === '' || cmpNoCase(aVariantName, GetDefaultVariantName()) === 0)
      return this.IsExcludedFromBOM();

    const variant = this.GetVariant(aVariantName);

    if (variant) return variant.GetExcludedFromBOM();

    // Fall back to default if variant doesn't exist
    return this.IsExcludedFromBOM();
  }

  /**
   * Get the exclude-from-position-files status for a specific variant.
   *
   * If the variant doesn't exist, returns the default exclude-from-position-files status.
   *
   * @param aVariantName The variant name (empty for default).
   * @return true if excluded from position files for the specified variant.
   */
  GetExcludedFromPosFilesForVariant(aVariantName: string): boolean {
    // Empty variant name means default
    if (aVariantName === '' || cmpNoCase(aVariantName, GetDefaultVariantName()) === 0)
      return this.IsExcludedFromPosFiles();

    const variant = this.GetVariant(aVariantName);

    if (variant) return variant.GetExcludedFromPosFiles();

    // Fall back to default if variant doesn't exist
    return this.IsExcludedFromPosFiles();
  }

  /**
   * Get a field value for a specific variant.
   *
   * If the variant doesn't exist or doesn't override the field, returns the default field value.
   *
   * @param aVariantName The variant name (empty for default).
   * @param aFieldName The field name.
   * @return The field value for the specified variant.
   */
  GetFieldValueForVariant(aVariantName: string, aFieldName: string): string {
    // Check variant-specific override first
    if (aVariantName !== '' && cmpNoCase(aVariantName, GetDefaultVariantName()) !== 0) {
      const variant = this.GetVariant(aVariantName);

      if (variant && variant.HasFieldValue(aFieldName)) return variant.GetFieldValue(aFieldName);
    }

    // Fall back to default field value
    const field = this.GetField(aFieldName);

    if (field) return field.GetText();

    return '';
  }

  SetFileFormatVersionAtLoad(aVersion: number): void {
    this.m_fileFormatVersionAtLoad = aVersion;
  }
  GetFileFormatVersionAtLoad(): number {
    return this.m_fileFormatVersionAtLoad;
  }

  /**
   * Return a #PAD with a matching number.
   *
   * @note Numbers may not be unique depending on how the footprint was created.
   *
   * @param aPadNumber the pad number to find.
   * @param aSearchAfterMe = not nullptr to find a pad living after aAfterMe
   * @return the first matching numbered #PAD is returned or NULL if not found.
   */
  FindPadByNumber(aPadNumber: string, aSearchAfterMe: PAD | null = null): PAD | null {
    let can_select = !aSearchAfterMe;

    for (const pad of this.m_pads) {
      if (!can_select && pad === aSearchAfterMe) {
        can_select = true;
        continue;
      }

      if (can_select && pad.GetNumber() === aPadNumber) return pad;
    }

    return null;
  }

  /**
   * Get a pad at \a aPosition on \a aLayerMask in the footprint.
   *
   * @param aPosition A VECTOR2I object containing the position to hit test.
   * @param aLayerMask A layer or layers to mask the hit test.
   * @return A pointer to a #PAD object if found otherwise NULL.
   */
  GetPad(aPosition: VECTOR2I, aLayerMask: LSET = LSET.AllLayersMask()): PAD | null {
    for (const pad of this.m_pads) {
      // ... and on the correct layer.
      if (!pad.GetLayerSet().and(aLayerMask).any()) continue;

      if (pad.HitTest(aPosition)) return pad;
    }

    return null;
  }

  GetPads(aPadNumber: string, aIgnore: PAD | null = null): PAD[] {
    const retv: PAD[] = [];

    for (const pad of this.m_pads) {
      if ((aIgnore && aIgnore === pad) || pad.GetNumber() !== aPadNumber) continue;

      retv.push(pad);
    }

    return retv;
  }

  /**
   * Return the number of pads.
   *
   * @param aIncludeNPTH includes non-plated through holes when true.  Does not include
   *                     non-plated through holes when false.
   * @return the number of pads according to \a aIncludeNPTH.
   */
  GetPadCount(aIncludeNPTH: INCLUDE_NPTH_T = INCLUDE_NPTH): number {
    if (aIncludeNPTH) return this.m_pads.length;

    let cnt = 0;

    for (const pad of this.m_pads) {
      if (pad.GetAttribute() === PAD_ATTRIB.NPTH) continue;

      cnt++;
    }

    return cnt;
  }

  /**
   * Return the number of unique non-blank pads.
   *
   * A complex pad can be built with many pads having the same pad name to create a complex
   * shape or fragmented solder paste areas.
   *
   * @param aIncludeNPTH includes non-plated through holes when true.  Does not include
   *                     non-plated through holes when false.
   * @return the number of unique pads according to \a aIncludeNPTH.
   */
  GetUniquePadCount(aIncludeNPTH: INCLUDE_NPTH_T = INCLUDE_NPTH): number {
    return this.GetUniquePadNumbers(aIncludeNPTH).size;
  }

  /**
   * Return the names of the unique, non-blank pads.
   */
  GetUniquePadNumbers(aIncludeNPTH: INCLUDE_NPTH_T = INCLUDE_NPTH): Set<string> {
    const usedNumbers = new Set<string>();

    // Create a set of used pad numbers
    for (const pad of this.m_pads) {
      // Skip pads not on copper layers (used to build complex
      // solder paste shapes for instance)
      if (pad.GetLayerSet().and(LSET.AllCuMask()).none()) continue;

      // Skip pads with no name, because they are usually "mechanical"
      // pads, not "electrical" pads
      if (pad.GetNumber() === '') continue;

      if (!aIncludeNPTH) {
        // skip NPTH
        if (pad.GetAttribute() === PAD_ATTRIB.NPTH) continue;
      }

      usedNumbers.add(pad.GetNumber());
    }

    return usedNumbers;
  }

  /**
   * Return the next available pad number in the footprint.
   *
   * @param aFillSequenceGaps true if the numbering should "fill in" gaps in the sequence,
   *                          else return the highest value + 1
   * @return the next available pad number
   */
  GetNextPadNumber(aLastPadNumber: string): string {
    const usedNumbers = new Set<string>();

    // Create a set of used pad numbers
    for (const pad of this.m_pads) usedNumbers.add(pad.GetNumber());

    // Pad numbers aren't technically reference designators, but the formatting is close enough
    // for these to give us what we need.
    const prefix = GetRefDesPrefix(aLastPadNumber);
    let num = getTrailingInt(aLastPadNumber);

    while (usedNumbers.has(`${prefix}${num}`)) num++;

    return `${prefix}${num}`;
  }

  GetDuplicatePadNumbersAreJumpers(): boolean {
    return this.m_duplicatePadNumbersAreJumpers;
  }
  SetDuplicatePadNumbersAreJumpers(aEnabled: boolean): void {
    this.m_duplicatePadNumbersAreJumpers = aEnabled;
  }

  /**
   * Each jumper pad group is a set of pad numbers that should be treated as internally connected.
   * @return The list of jumper pad groups in this footprint
   */
  JumperPadGroups(): Set<string>[] {
    return this.m_jumperPadGroups;
  }

  /// Retrieves the jumper group containing the specified pad number, if one exists
  GetJumperPadGroup(aPadNumber: string): ReadonlySet<string> | undefined {
    for (const group of this.m_jumperPadGroups) {
      if (group.has(aPadNumber)) return group;
    }

    return undefined;
  }

  /**
   * Position Reference and Value fields at the top and bottom of footprint's bounding box.
   */
  AutoPositionFields(): void {
    // Auto-position reference and value
    const bbox = this.GetBoundingBox(false);
    bbox.Inflate(pcbIUScale.mmToIU(0.2)); // Gap between graphics and text

    if (equal(this.Reference().GetPosition(), { x: 0, y: 0 })) {
      this.Reference().SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
      this.Reference().SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
      this.Reference().SetTextAngle(ANGLE_0);

      this.Reference().SetX(bbox.GetCenter().x);
      this.Reference().SetY(bbox.GetTop() - Math.trunc(this.Reference().GetTextSize().y / 2));
    }

    if (equal(this.Value().GetPosition(), { x: 0, y: 0 })) {
      this.Value().SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
      this.Value().SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
      this.Value().SetTextAngle(ANGLE_0);

      this.Value().SetX(bbox.GetCenter().x);
      this.Value().SetY(bbox.GetBottom() + Math.trunc(this.Value().GetTextSize().y / 2));
    }
  }

  /**
   * Get the type of footprint
   * @return "SMD"/"Through hole"/"Other" based on attributes
   */
  GetTypeName(): string {
    if ((this.m_attributes & FP_SMD) === FP_SMD) return 'SMD';

    if ((this.m_attributes & FP_THROUGH_HOLE) === FP_THROUGH_HOLE) return 'Through hole';

    return 'Other';
  }

  GetArea(aPadding = 0): number {
    const bbox = this.GetBoundingBox(false);

    const w = Math.abs(bbox.GetWidth()) + aPadding;
    const h = Math.abs(bbox.GetHeight()) + aPadding;
    return w * h;
  }

  GetLink(): KIID {
    return this.m_link;
  }
  SetLink(aLink: KIID): void {
    this.m_link = aLink;
  }

  override Duplicate(
    addToParentGroup: boolean,
    aCommit: BOARD_COMMIT_LIKE | null = null,
  ): BOARD_ITEM {
    const dupe = super.Duplicate(addToParentGroup, aCommit) as FOOTPRINT;

    dupe.RunOnChildren((child: BOARD_ITEM) => {
      (child as { m_Uuid: KIID }).m_Uuid = newKiid();
    }, RECURSE_MODE.RECURSE);

    return dupe;
  }

  /**
   * Duplicate a given item within the footprint, optionally adding it to the board.
   *
   * @return the new item, or NULL if the item could not be duplicated.
   */
  DuplicateItem(
    addToParentGroup: boolean,
    aCommit: BOARD_COMMIT_LIKE | null,
    aItem: BOARD_ITEM,
    addToFootprint = false,
  ): BOARD_ITEM | null {
    let new_item: BOARD_ITEM | null = null;

    switch (aItem.Type()) {
      case KICAD_T.PCB_PAD_T: {
        const new_pad = PAD.copyOfPad(aItem as PAD);
        (new_pad as { m_Uuid: KIID }).m_Uuid = newKiid();

        if (addToFootprint) this.m_pads.push(new_pad);

        new_item = new_pad;
        break;
      }

      case KICAD_T.PCB_ZONE_T: {
        const new_zone = ZONE.copyOfZone(aItem as ZONE);
        (new_zone as { m_Uuid: KIID }).m_Uuid = newKiid();

        if (addToFootprint) this.m_zones.push(new_zone);

        new_item = new_zone;
        break;
      }

      case KICAD_T.PCB_POINT_T: {
        const new_point = PCB_POINT.copyOf(aItem as PCB_POINT);
        (new_point as { m_Uuid: KIID }).m_Uuid = newKiid();

        if (addToFootprint) this.m_points.push(new_point);

        new_item = new_point;
        break;
      }

      case KICAD_T.PCB_FIELD_T:
      case KICAD_T.PCB_TEXT_T: {
        const new_text = PCB_TEXT.copyOf(aItem as PCB_TEXT);
        (new_text as { m_Uuid: KIID }).m_Uuid = newKiid();

        if (aItem.Type() === KICAD_T.PCB_FIELD_T) {
          switch ((aItem as PCB_FIELD).GetId()) {
            case FIELD_T.REFERENCE:
              new_text.SetText('${REFERENCE}');
              break;
            case FIELD_T.VALUE:
              new_text.SetText('${VALUE}');
              break;
            case FIELD_T.DATASHEET:
              new_text.SetText('${DATASHEET}');
              break;
            default:
              break;
          }
        }

        if (addToFootprint) this.Add(new_text);

        new_item = new_text;
        break;
      }

      case KICAD_T.PCB_SHAPE_T: {
        const new_shape = PCB_SHAPE.copyOf(aItem as PCB_SHAPE);
        (new_shape as { m_Uuid: KIID }).m_Uuid = newKiid();

        if (addToFootprint) this.Add(new_shape);

        new_item = new_shape;
        break;
      }

      case KICAD_T.PCB_BARCODE_T:
      case KICAD_T.PCB_REFERENCE_IMAGE_T: {
        // PCB_BARCODE( const PCB_BARCODE& ) / PCB_REFERENCE_IMAGE( ... ) -- pending (#636)
        const new_copy = aItem.Clone() as BOARD_ITEM;
        (new_copy as { m_Uuid: KIID }).m_Uuid = newKiid();

        if (addToFootprint) this.Add(new_copy);

        new_item = new_copy;
        break;
      }

      case KICAD_T.PCB_TEXTBOX_T: {
        const new_textbox = PCB_TEXTBOX.copyOf(aItem as PCB_TEXTBOX);
        (new_textbox as { m_Uuid: KIID }).m_Uuid = newKiid();

        if (addToFootprint) this.Add(new_textbox);

        new_item = new_textbox;
        break;
      }

      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_LEADER_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T: {
        const dimension = aItem.Duplicate(addToParentGroup, aCommit);

        if (addToFootprint) this.Add(dimension);

        new_item = dimension;
        break;
      }

      case KICAD_T.PCB_GROUP_T: {
        const group = (aItem as PCB_GROUP).DeepDuplicate(addToParentGroup, aCommit);

        if (addToFootprint) {
          group.RunOnChildren((aCurrItem: BOARD_ITEM) => {
            this.Add(aCurrItem);
          }, RECURSE_MODE.RECURSE);

          this.Add(group);
        }

        new_item = group;
        break;
      }

      case KICAD_T.PCB_FOOTPRINT_T:
        // Ignore the footprint itself
        break;

      default:
        // Un-handled item for duplication
        console.assert(false, `Duplication not supported for items of class ${aItem.GetClass()}`);
        break;
    }

    return new_item;
  }

  /**
   * Add \a a3DModel definition to the end of the 3D model list.
   *
   * @param a3DModel A pointer to a #FP_3DMODEL to add to the list.
   */
  Add3DModel(a3DModel: FP_3DMODEL | null): void {
    if (null === a3DModel) return;

    if (a3DModel.m_Filename !== '') this.m_3D_Drawings.push(a3DModel.clone());
  }

  override Visit(
    inspector: INSPECTOR,
    testData: unknown,
    aScanTypes: readonly KICAD_T[],
  ): INSPECT_RESULT {
    let drawingsScanned = false;

    for (const scanType of aScanTypes) {
      switch (scanType) {
        case KICAD_T.PCB_FOOTPRINT_T:
          if (inspector(this, testData) === INSPECT_RESULT.QUIT) return INSPECT_RESULT.QUIT;

          break;

        case KICAD_T.PCB_PAD_T:
          if (
            EDA_ITEM.IterateForward(this.m_pads, inspector, testData, [scanType]) ===
            INSPECT_RESULT.QUIT
          ) {
            return INSPECT_RESULT.QUIT;
          }

          break;

        case KICAD_T.PCB_ZONE_T:
          if (
            EDA_ITEM.IterateForward(this.m_zones, inspector, testData, [scanType]) ===
            INSPECT_RESULT.QUIT
          ) {
            return INSPECT_RESULT.QUIT;
          }

          break;

        case KICAD_T.PCB_FIELD_T:
          if (
            EDA_ITEM.IterateForward(this.m_fields, inspector, testData, [scanType]) ===
            INSPECT_RESULT.QUIT
          ) {
            return INSPECT_RESULT.QUIT;
          }

          break;

        case KICAD_T.PCB_TEXT_T:
        case KICAD_T.PCB_DIM_ALIGNED_T:
        case KICAD_T.PCB_DIM_LEADER_T:
        case KICAD_T.PCB_DIM_CENTER_T:
        case KICAD_T.PCB_DIM_RADIAL_T:
        case KICAD_T.PCB_DIM_ORTHOGONAL_T:
        case KICAD_T.PCB_SHAPE_T:
        case KICAD_T.PCB_BARCODE_T:
        case KICAD_T.PCB_TEXTBOX_T:
        case KICAD_T.PCB_TABLE_T:
        case KICAD_T.PCB_TABLECELL_T:
          if (!drawingsScanned) {
            if (
              EDA_ITEM.IterateForward(this.m_drawings, inspector, testData, aScanTypes) ===
              INSPECT_RESULT.QUIT
            ) {
              return INSPECT_RESULT.QUIT;
            }

            drawingsScanned = true;
          }

          break;

        case KICAD_T.PCB_GROUP_T:
          if (
            EDA_ITEM.IterateForward(this.m_groups, inspector, testData, [scanType]) ===
            INSPECT_RESULT.QUIT
          ) {
            return INSPECT_RESULT.QUIT;
          }

          break;

        case KICAD_T.PCB_POINT_T:
          if (
            EDA_ITEM.IterateForward(this.m_points, inspector, testData, [scanType]) ===
            INSPECT_RESULT.QUIT
          ) {
            return INSPECT_RESULT.QUIT;
          }

          break;

        default:
          break;
      }
    }

    return INSPECT_RESULT.CONTINUE;
  }

  GetClass(): string {
    return 'FOOTPRINT';
  }

  override GetItemDescription(aUnitsProvider: UNITS_PROVIDER | null, aFull: boolean): string {
    let reference = this.GetReference();

    if (reference === '') reference = '<no reference designator>';

    return `Footprint ${reference}`;
  }

  override DisambiguateItemDescription(
    aUnitsProvider: UNITS_PROVIDER | null,
    aFull: boolean,
  ): string {
    return `${this.GetItemDescription(aUnitsProvider, aFull)} (${this.GetFPIDAsString()})`;
  }

  override GetMenuImage(): string {
    return 'module';
  }

  override Clone(): FOOTPRINT {
    return FOOTPRINT.copyOfFootprint(this);
  }

  ///< @copydoc BOARD_ITEM::RunOnChildren
  override RunOnChildren(aFunction: (aItem: BOARD_ITEM) => void, aMode: RECURSE_MODE): void {
    for (const field of this.m_fields) aFunction(field);

    for (const pad of this.m_pads) aFunction(pad);

    for (const zone of this.m_zones) aFunction(zone);

    for (const group of this.m_groups) aFunction(group);

    for (const point of this.m_points) aFunction(point);

    for (const drawing of this.m_drawings) {
      aFunction(drawing);

      if (aMode === RECURSE_MODE.RECURSE) drawing.RunOnChildren(aFunction, RECURSE_MODE.RECURSE);
    }
  }

  override ViewGetLayers(): number[] {
    const layers: number[] = [];

    layers.push(GAL_LAYER_ID.LAYER_ANCHOR);

    switch (this.m_layer) {
      // biome-ignore lint/suspicious/noFallthroughSwitchClause: KI_FALLTHROUGH
      default:
        console.assert(false, 'Illegal layer'); // do you really have footprints placed
      // on other layers?
      // KI_FALLTHROUGH;

      case PCB_LAYER_ID.F_Cu:
        layers.push(GAL_LAYER_ID.LAYER_FOOTPRINTS_FR);
        break;

      case PCB_LAYER_ID.B_Cu:
        layers.push(GAL_LAYER_ID.LAYER_FOOTPRINTS_BK);
        break;
    }

    if (this.IsConflicting()) layers.push(GAL_LAYER_ID.LAYER_CONFLICTS_SHADOW);

    // If there are no pads, and only drawings on a silkscreen layer, then report the silkscreen
    // layer as well so that the component can be edited with the silkscreen layer
    let f_silk = false;
    let b_silk = false;
    let non_silk = false;

    for (const item of this.m_drawings) {
      if (item.GetLayer() === PCB_LAYER_ID.F_SilkS) f_silk = true;
      else if (item.GetLayer() === PCB_LAYER_ID.B_SilkS) b_silk = true;
      else non_silk = true;
    }

    if ((f_silk || b_silk) && !non_silk && this.m_pads.length === 0) {
      if (f_silk) layers.push(PCB_LAYER_ID.F_SilkS);

      if (b_silk) layers.push(PCB_LAYER_ID.B_SilkS);
    }

    return layers;
  }

  override ViewGetLOD(aLayer: number, aView: PCB_VIEW_FOR_LOD | null): number {
    if (!aView) return FOOTPRINT.LOD_SHOW;

    if (aLayer === GAL_LAYER_ID.LAYER_CONFLICTS_SHADOW && this.IsConflicting()) {
      // The locked shadow shape is shown only if the footprint itself is visible
      if (
        this.m_layer === PCB_LAYER_ID.F_Cu &&
        aView.IsLayerVisible(GAL_LAYER_ID.LAYER_FOOTPRINTS_FR)
      )
        return FOOTPRINT.LOD_SHOW;

      if (
        this.m_layer === PCB_LAYER_ID.B_Cu &&
        aView.IsLayerVisible(GAL_LAYER_ID.LAYER_FOOTPRINTS_BK)
      )
        return FOOTPRINT.LOD_SHOW;

      return FOOTPRINT.LOD_HIDE;
    }

    // Only show anchors if the layer the footprint is on is visible
    if (aLayer === GAL_LAYER_ID.LAYER_ANCHOR && !aView.IsLayerVisible(this.m_layer))
      return FOOTPRINT.LOD_HIDE;

    const layer =
      this.m_layer === PCB_LAYER_ID.F_Cu
        ? GAL_LAYER_ID.LAYER_FOOTPRINTS_FR
        : this.m_layer === PCB_LAYER_ID.B_Cu
          ? GAL_LAYER_ID.LAYER_FOOTPRINTS_BK
          : GAL_LAYER_ID.LAYER_ANCHOR;

    // Currently this is only pertinent for the anchor layer; everything else is drawn from the
    // children.
    // The "good" value is experimentally chosen.
    const MINIMAL_ZOOM_LEVEL_FOR_VISIBILITY = 1.5;

    if (aView.IsLayerVisible(layer)) return MINIMAL_ZOOM_LEVEL_FOR_VISIBILITY;

    return FOOTPRINT.LOD_HIDE;
  }

  override ViewBBox(): BOX2I {
    const area = this.GetBoundingBox(true);

    // Inflate in case clearance lines are drawn around pads, etc.
    const board = this.GetBoard();

    if (board) {
      // int biggest_clearance = board->GetMaxClearanceValue();   -- BOARD::GetMaxClearanceValue pending (#636)
      const biggest_clearance = board.GetDesignSettings().GetBiggestClearanceValue();
      area.Inflate(biggest_clearance);
    }

    return area;
  }

  /**
   * Test for validity of a name of a footprint to be used in a footprint library
   * ( no spaces, dir separators ... ).
   *
   * @param aName is the name in library to validate.
   * @return true if the given name is valid
   */
  static IsLibNameValid(aName: string): boolean {
    const invalids = FOOTPRINT.StringLibNameInvalidChars(false);

    for (const ch of aName) {
      if (invalids.includes(ch)) return false;
    }

    return true;
  }

  /**
   * Test for validity of the name in a library of the footprint ( no spaces, dir
   * separators ... ).
   *
   * @param aUserReadable set to false to get the list of invalid characters or  true to get
   *                      a readable form (i.e ' ' = 'space' '\\t'= 'tab').
   *
   * @return the list of invalid chars in the library name.
   */
  static StringLibNameInvalidChars(aUserReadable: boolean): string {
    // This list of characters is also duplicated in validators.cpp and
    // lib_id.cpp
    // TODO: Unify forbidden character lists - Warning, invalid filename characters are not the same
    // as invalid LIB_ID characters.  We will need to separate the FP filenames from FP names before this
    // can be unified
    const invalidChars = '%$<>\t\n\r"\\/:';
    const invalidCharsReadable = "% $ < > 'tab' 'return' 'line feed' \\ \" / :";

    if (aUserReadable) return invalidCharsReadable;
    else return invalidChars;
  }

  /**
   * Take ownership of caller's heap allocated aInitialComments block.
   *
   * The comments are single line strings already containing the s-expression comments with
   * optional leading whitespace and then a '#' character followed by optional single line
   * text (text with no line endings, not even one).  This block of single line comments
   * will be output upfront of any generated s-expression text in the PCBIO::Format() function.
   *
   * @note A block of single line comments constitutes a multiline block of single line
   *       comments.  That is, the block is made of consecutive single line comments.
   *
   * @param aInitialComments is a heap allocated wxArrayString or NULL, which the caller
   *                         gives up ownership of over to this FOOTPRINT.
   */
  SetInitialComments(aInitialComments: string[] | null): void {
    this.m_initial_comments = aInitialComments;
  }

  /**
   * Calculate the ratio of total area of the footprint pads and graphical items to the
   * area of the footprint. Used by selection tool heuristics.
   *
   * @return the ratio.
   */
  CoverageRatio(aCollector: GENERAL_COLLECTOR_FOR_COVERAGE): number {
    const textMargin = aCollector.GetGuide().Accuracy();

    const footprintRegion = new SHAPE_POLY_SET(this.GetBoundingHull());
    const coveredRegion = new SHAPE_POLY_SET();

    this.TransformPadsToPolySet(
      coveredRegion,
      PCB_LAYER_ID.UNDEFINED_LAYER,
      0,
      ARC_LOW_DEF,
      ERROR_LOC.ERROR_OUTSIDE,
    );

    this.TransformFPShapesToPolySet(
      coveredRegion,
      PCB_LAYER_ID.UNDEFINED_LAYER,
      textMargin,
      ARC_LOW_DEF,
      ERROR_LOC.ERROR_OUTSIDE,
      true /* include text */,
      false /* include shapes */,
      false /* include private items */,
    );

    for (let i = 0; i < aCollector.GetCount(); ++i) {
      const item = aCollector.at(i);

      switch (item.Type()) {
        case KICAD_T.PCB_FIELD_T:
        case KICAD_T.PCB_TEXT_T:
        case KICAD_T.PCB_TEXTBOX_T:
        case KICAD_T.PCB_SHAPE_T:
        case KICAD_T.PCB_BARCODE_T:
        case KICAD_T.PCB_TRACE_T:
        case KICAD_T.PCB_ARC_T:
        case KICAD_T.PCB_VIA_T:
          if (item.GetParent() !== this) {
            item.TransformShapeToPolygon(
              coveredRegion,
              PCB_LAYER_ID.UNDEFINED_LAYER,
              0,
              ARC_LOW_DEF,
              ERROR_LOC.ERROR_OUTSIDE,
            );
          }

          break;

        case KICAD_T.PCB_FOOTPRINT_T:
          if (item !== this) {
            const footprint = item as FOOTPRINT;
            coveredRegion.AddOutline(footprint.GetBoundingHull().Outline(0));
          }

          break;

        default:
          break;
      }
    }

    coveredRegion.BooleanIntersection(footprintRegion);

    const footprintRegionArea = polygonArea(footprintRegion);
    const uncoveredRegionArea = footprintRegionArea - polygonArea(coveredRegion);
    const coveredArea = footprintRegionArea - uncoveredRegionArea;

    // Avoid div-by-zero (this will result in the disambiguate dialog)
    if (footprintRegionArea === 0) return 1.0;

    const ratio = coveredArea / footprintRegionArea;

    // Test for negative ratio (should not occur).
    // better to be conservative (this will result in the disambiguate dialog)
    if (ratio < 0.0) return 1.0;

    return Math.min(ratio, 1.0);
  }

  static GetCoverageArea(aItem: BOARD_ITEM, aCollector: GENERAL_COLLECTOR_FOR_COVERAGE): number {
    const textMargin = aCollector.GetGuide().Accuracy();
    let poly = new SHAPE_POLY_SET();

    if (aItem.Type() === KICAD_T.PCB_MARKER_T) {
      // const PCB_MARKER* marker; marker->ShapeToPolygon( markerShape ); return markerShape.Area();
      //                                                     -- PCB_MARKER pending (#636)
      return 0;
    } else if (aItem.Type() === KICAD_T.PCB_GROUP_T || aItem.Type() === KICAD_T.PCB_GENERATOR_T) {
      let combinedArea = 0.0;

      for (const member of (aItem as PCB_GROUP).GetBoardItems())
        combinedArea += FOOTPRINT.GetCoverageArea(member, aCollector);

      return combinedArea;
    }

    if (aItem.Type() === KICAD_T.PCB_FOOTPRINT_T) {
      const footprint = aItem as FOOTPRINT;
      poly = footprint.GetBoundingHull();
    } else if (aItem.Type() === KICAD_T.PCB_FIELD_T || aItem.Type() === KICAD_T.PCB_TEXT_T) {
      const text = aItem as PCB_TEXT;
      text.TransformTextToPolySet(poly, textMargin, ARC_LOW_DEF, ERROR_LOC.ERROR_INSIDE);
    } else if (aItem.Type() === KICAD_T.PCB_TEXTBOX_T) {
      const tb = aItem as PCB_TEXTBOX;
      tb.TransformTextToPolySet(poly, textMargin, ARC_LOW_DEF, ERROR_LOC.ERROR_INSIDE);
    } else if (aItem.Type() === KICAD_T.PCB_SHAPE_T) {
      // Approximate "linear" shapes with just their width squared, as we don't want to consider
      // a linear shape as being much bigger than another for purposes of selection filtering
      // just because it happens to be really long.

      const shape = aItem as PCB_SHAPE;

      switch (shape.GetShape()) {
        case SHAPE_T.SEGMENT:
        case SHAPE_T.ARC:
        case SHAPE_T.BEZIER:
          return shape.GetWidth() * shape.GetWidth();

        case SHAPE_T.RECTANGLE:
        case SHAPE_T.CIRCLE:
        // biome-ignore lint/suspicious/noFallthroughSwitchClause: KI_FALLTHROUGH
        case SHAPE_T.POLY: {
          if (!shape.IsAnyFill()) return shape.GetWidth() * shape.GetWidth();

          // KI_FALLTHROUGH;
        }

        default:
          shape.TransformShapeToPolygon(
            poly,
            PCB_LAYER_ID.UNDEFINED_LAYER,
            0,
            ARC_LOW_DEF,
            ERROR_LOC.ERROR_OUTSIDE,
          );
      }
    } else if (aItem.Type() === KICAD_T.PCB_TRACE_T || aItem.Type() === KICAD_T.PCB_ARC_T) {
      const width = (aItem as PCB_TRACK).GetWidth();
      return width * width;
    } else if (aItem.Type() === KICAD_T.PCB_PAD_T) {
      (aItem as PAD).Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
        const layerPoly = new SHAPE_POLY_SET();
        aItem.TransformShapeToPolygon(layerPoly, aLayer, 0, ARC_LOW_DEF, ERROR_LOC.ERROR_OUTSIDE);
        poly.BooleanAdd(layerPoly);
      });
    } else if (aItem.Type() === KICAD_T.PCB_ZONE_T) {
      const zone = aItem as ZONE;

      if (zone.GetIsRuleArea()) {
        // Rule areas are never filled, so TransformShapeToPolygon would report a zero coverage
        // area and make them appear as the smallest item under the cursor.  That incorrectly
        // gives them selection precedence over the pads, tracks and footprints they enclose.
        // Use the outline area so an enclosed item is selected first while the rule area stays
        // available via its border and the disambiguation menu.
        poly = new SHAPE_POLY_SET(zone.Outline());
      } else {
        for (const layer of zone.GetLayerSet()) {
          const layerPoly = new SHAPE_POLY_SET();
          zone.TransformShapeToPolygon(layerPoly, layer, 0, ARC_LOW_DEF, ERROR_LOC.ERROR_OUTSIDE);
          poly.BooleanAdd(layerPoly);
        }

        // An unfilled zone has no filled polygons; fall back to the outline so it does not
        // collapse to a zero coverage area and steal precedence like a rule area would.
        if (poly.OutlineCount() === 0) poly = new SHAPE_POLY_SET(zone.Outline());
      }
    } else {
      aItem.TransformShapeToPolygon(
        poly,
        PCB_LAYER_ID.UNDEFINED_LAYER,
        0,
        ARC_LOW_DEF,
        ERROR_LOC.ERROR_OUTSIDE,
      );
    }

    return polygonArea(poly);
  }

  /// Return the initial comments block or NULL if none, without transfer of ownership.
  GetInitialComments(): readonly string[] | null {
    return this.m_initial_comments;
  }

  /**
   * Used in DRC to test the courtyard area (a complex polygon).
   *
   * @return the courtyard polygon.
   */
  GetCourtyard(aLayer: PCB_LAYER_ID): SHAPE_POLY_SET {
    if (
      !this.m_courtyard_cache ||
      this.m_courtyard_cache.front_hash !== this.m_courtyard_cache.front.GetHash() ||
      this.m_courtyard_cache.back_hash !== this.m_courtyard_cache.back.GetHash()
    ) {
      this.BuildCourtyardCaches();
    }

    return this.GetCachedCourtyard(aLayer);
  }

  /**
   * Return the cached courtyard area. No checks are performed.
   *
   * @return the cached courtyard polygon.
   */
  GetCachedCourtyard(aLayer: PCB_LAYER_ID): SHAPE_POLY_SET {
    if (!this.m_courtyard_cache) this.m_courtyard_cache = new FOOTPRINT_COURTYARD_CACHE_DATA();

    if (IsBackLayer(aLayer)) return this.m_courtyard_cache.back;
    else return this.m_courtyard_cache.front;
  }

  /**
   * Build complex polygons of the courtyard areas from graphic items on the courtyard layers.
   *
   * @note Set the #MALFORMED_F_COURTYARD and #MALFORMED_B_COURTYARD status flags if the given
   *       courtyard layer does not contain a (single) closed shape.
   */
  BuildCourtyardCaches(aErrorHandler: OUTLINE_ERROR_HANDLER | null = null): void {
    if (!this.m_courtyard_cache) this.m_courtyard_cache = new FOOTPRINT_COURTYARD_CACHE_DATA();

    this.m_courtyard_cache.front.RemoveAllContours();
    this.m_courtyard_cache.back.RemoveAllContours();
    this.ClearFlags(MALFORMED_COURTYARDS);

    // Build the courtyard area from graphic items on the courtyard.
    // Only PCB_SHAPE_T have meaning, graphic texts are ignored.
    // Collect items:
    const list_front: PCB_SHAPE[] = [];
    const list_back: PCB_SHAPE[] = [];
    const front_width_histogram = new Map<number, number>();
    const back_width_histogram = new Map<number, number>();

    for (const item of this.GraphicalItems()) {
      if (item.GetLayer() === PCB_LAYER_ID.B_CrtYd && item.Type() === KICAD_T.PCB_SHAPE_T) {
        const shape = item as PCB_SHAPE;
        list_back.push(shape);
        back_width_histogram.set(
          shape.GetStroke().GetWidth(),
          (back_width_histogram.get(shape.GetStroke().GetWidth()) ?? 0) + 1,
        );
      }

      if (item.GetLayer() === PCB_LAYER_ID.F_CrtYd && item.Type() === KICAD_T.PCB_SHAPE_T) {
        const shape = item as PCB_SHAPE;
        list_front.push(shape);
        front_width_histogram.set(
          shape.GetStroke().GetWidth(),
          (front_width_histogram.get(shape.GetStroke().GetWidth()) ?? 0) + 1,
        );
      }
    }

    if (!list_front.length && !list_back.length) return;

    const maxError = pcbIUScale.mmToIU(0.005); // max error for polygonization
    const chainingEpsilon = pcbIUScale.mmToIU(0.02); // max dist from one endPt to next startPt

    // std::max_element over a std::map: the first (lowest key) of the entries with the largest count
    const mostCommonWidth = (histogram: Map<number, number>): number => {
      let width = 0;
      let best = -1;

      for (const [key, count] of [...histogram.entries()].sort((a, b) => a[0] - b[0])) {
        if (count > best) {
          best = count;
          width = key;
        }
      }

      return width;
    };

    if (
      ConvertOutlineToPolygon(
        list_front,
        this.m_courtyard_cache.front,
        maxError,
        chainingEpsilon,
        true,
        aErrorHandler,
      )
    ) {
      let width = 0;

      // Touching courtyards, or courtyards -at- the clearance distance are legal.
      // Use maxError here because that is the allowed deviation when transforming arcs/circles to
      // polygons.
      this.m_courtyard_cache.front.Inflate(
        -maxError,
        CornerStrategy.CHAMFER_ACUTE_CORNERS,
        maxError,
      );

      this.m_courtyard_cache.front.CacheTriangulation(false);

      width = mostCommonWidth(front_width_histogram);

      if (width === 0) width = pcbIUScale.mmToIU(DEFAULT_COURTYARD_WIDTH);

      if (this.m_courtyard_cache.front.OutlineCount() > 0)
        this.m_courtyard_cache.front.Outline(0).SetWidth(width);
    } else {
      this.SetFlags(MALFORMED_F_COURTYARD);
    }

    if (
      ConvertOutlineToPolygon(
        list_back,
        this.m_courtyard_cache.back,
        maxError,
        chainingEpsilon,
        true,
        aErrorHandler,
      )
    ) {
      let width = 0;

      // Touching courtyards, or courtyards -at- the clearance distance are legal.
      this.m_courtyard_cache.back.Inflate(
        -maxError,
        CornerStrategy.CHAMFER_ACUTE_CORNERS,
        maxError,
      );

      this.m_courtyard_cache.back.CacheTriangulation(false);

      width = mostCommonWidth(back_width_histogram);

      if (width === 0) width = pcbIUScale.mmToIU(DEFAULT_COURTYARD_WIDTH);

      if (this.m_courtyard_cache.back.OutlineCount() > 0)
        this.m_courtyard_cache.back.Outline(0).SetWidth(width);
    } else {
      this.SetFlags(MALFORMED_B_COURTYARD);
    }

    this.m_courtyard_cache.front_hash = this.m_courtyard_cache.front.GetHash();
    this.m_courtyard_cache.back_hash = this.m_courtyard_cache.back.GetHash();
  }

  // @copydoc BOARD_ITEM::GetEffectiveShape
  override GetEffectiveShape(
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER,
    aFlash: FLASHING = FLASHING.DEFAULT,
  ): SHAPE {
    const shape = new SHAPE_COMPOUND();

    // There are several possible interpretations here:
    // 1) the bounding box (without or without invisible items)
    // 2) just the pads and "edges" (ie: non-text graphic items)
    // 3) the courtyard

    // We'll go with (2) for now, unless the caller is clearly looking for (3)

    if (aLayer === PCB_LAYER_ID.F_CrtYd || aLayer === PCB_LAYER_ID.B_CrtYd) {
      const courtyard = this.GetCourtyard(aLayer);

      if (courtyard.OutlineCount() === 0)
        // malformed/empty polygon
        return shape;

      shape.AddShape(new SHAPE_SIMPLE(courtyard.COutline(0)));
    } else {
      for (const pad of this.Pads()) shape.AddShape(pad.GetEffectiveShape(aLayer, aFlash).Clone());

      for (const item of this.GraphicalItems()) {
        if (item.Type() === KICAD_T.PCB_SHAPE_T)
          shape.AddShape(item.GetEffectiveShape(aLayer, aFlash).Clone());
        else if (item.Type() === KICAD_T.PCB_BARCODE_T)
          shape.AddShape(item.GetEffectiveShape(aLayer, aFlash).Clone());
      }
    }

    return shape;
  }

  /**
   * Return a bounding polygon for the shapes and pads in the footprint.
   *
   * This operation is slower but more accurate than calculating a bounding box.
   */
  GetBoundingHull(aLayer?: PCB_LAYER_ID): SHAPE_POLY_SET {
    const board = this.GetBoard();
    const isFPEdit = !!board && board.IsFootprintHolder();

    if (aLayer !== undefined) {
      const rawPolys = new SHAPE_POLY_SET();
      const hull = new SHAPE_POLY_SET();

      for (const item of this.m_drawings) {
        if (!isFPEdit && this.m_privateLayers.test(item.GetLayer())) continue;

        if (item.IsOnLayer(aLayer)) {
          if (
            item.Type() !== KICAD_T.PCB_FIELD_T &&
            item.Type() !== KICAD_T.PCB_REFERENCE_IMAGE_T
          ) {
            item.TransformShapeToPolygon(
              rawPolys,
              PCB_LAYER_ID.UNDEFINED_LAYER,
              0,
              ARC_LOW_DEF,
              ERROR_LOC.ERROR_OUTSIDE,
            );
          }

          // We intentionally exclude footprint fields from the bounding hull.
        }
      }

      for (const pad of this.m_pads) {
        if (pad.IsOnLayer(aLayer))
          pad.TransformShapeToPolygon(rawPolys, aLayer, 0, ARC_LOW_DEF, ERROR_LOC.ERROR_OUTSIDE);
      }

      for (const zone of this.m_zones) {
        if (zone.GetIsRuleArea()) continue;

        if (zone.IsOnLayer(aLayer)) {
          const layerPoly = zone.GetFilledPolysList(aLayer);

          for (let ii = 0; ii < layerPoly.OutlineCount(); ii++)
            rawPolys.AddOutline(layerPoly.COutline(ii));
        }
      }

      const convex_hull = buildConvexHullOfPolySet(rawPolys);

      hull.NewOutline();

      for (const pt of convex_hull) hull.Append(pt);

      return hull;
    }

    if (board) {
      if (this.m_geometry_cache && this.m_geometry_cache.hull_timestamp >= board.GetTimeStamp())
        return this.m_geometry_cache.hull;
    }

    const rawPolys = new SHAPE_POLY_SET();

    for (const item of this.m_drawings) {
      if (!isFPEdit && this.m_privateLayers.test(item.GetLayer())) continue;

      if (item.Type() !== KICAD_T.PCB_FIELD_T && item.Type() !== KICAD_T.PCB_REFERENCE_IMAGE_T) {
        item.TransformShapeToPolygon(
          rawPolys,
          PCB_LAYER_ID.UNDEFINED_LAYER,
          0,
          ARC_LOW_DEF,
          ERROR_LOC.ERROR_OUTSIDE,
        );
      }

      // We intentionally exclude footprint fields from the bounding hull.
    }

    for (const pad of this.m_pads) {
      pad.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
        pad.TransformShapeToPolygon(rawPolys, aLayer, 0, ARC_LOW_DEF, ERROR_LOC.ERROR_OUTSIDE);
      });

      // In case hole is larger than pad
      pad.TransformHoleToPolygon(rawPolys, 0, ARC_LOW_DEF, ERROR_LOC.ERROR_OUTSIDE);
    }

    for (const zone of this.m_zones) {
      for (const layer of zone.GetLayerSet()) {
        const layerPoly = zone.GetFilledPolysList(layer);

        for (let ii = 0; ii < layerPoly.OutlineCount(); ii++) {
          const poly = layerPoly.COutline(ii);
          rawPolys.AddOutline(poly);
        }
      }
    }

    // If there are some graphic items, build the actual hull.
    // However if no items, create a minimal polygon (can happen if a footprint
    // is created with no item: it contains only 2 texts.
    if (rawPolys.OutlineCount() === 0 || rawPolys.FullPointCount() < 3) {
      // generate a small dummy rectangular outline around the anchor
      const halfsize = pcbIUScale.mmToIU(1.0);

      rawPolys.NewOutline();

      // add a square:
      rawPolys.Append(this.GetPosition().x - halfsize, this.GetPosition().y - halfsize);
      rawPolys.Append(this.GetPosition().x + halfsize, this.GetPosition().y - halfsize);
      rawPolys.Append(this.GetPosition().x + halfsize, this.GetPosition().y + halfsize);
      rawPolys.Append(this.GetPosition().x - halfsize, this.GetPosition().y + halfsize);
    }

    const convex_hull = buildConvexHullOfPolySet(rawPolys);

    if (!this.m_geometry_cache) this.m_geometry_cache = new FOOTPRINT_GEOMETRY_CACHE_DATA();

    this.m_geometry_cache.hull.RemoveAllContours();
    this.m_geometry_cache.hull.NewOutline();

    for (const pt of convex_hull) this.m_geometry_cache.hull.Append(pt);

    if (board) this.m_geometry_cache.hull_timestamp = board.GetTimeStamp();

    return this.m_geometry_cache.hull;
  }

  override GetEmbeddedFiles(): EMBEDDED_FILES {
    return this;
  }

  /**
   * Get a list of outline fonts referenced in the footprint
   */
  GetFonts(): Set<unknown> {
    // for each text item: if the font is an outline font whose EMBEDDING_PERMISSION is EDITABLE
    // or INSTALLABLE, collect it        -- OUTLINE_FONT::GetEmbeddingPermission pending (#636)
    return new Set();
  }

  EmbedFonts(): void {
    // for( OUTLINE_FONT* font : GetFonts() ) GetEmbeddedFiles()->AddFile( font->GetFileName(), false )
    //                                                     -- OUTLINE_FONT embedding pending (#636)
  }

  Similarity(aOther: BOARD_ITEM): number {
    if (aOther.Type() !== KICAD_T.PCB_FOOTPRINT_T) return 0.0;

    const other = aOther as FOOTPRINT;

    let similarity = 1.0;

    for (const pad of this.m_pads) {
      const otherPad = other.FindPadByNumber(pad.GetNumber());

      if (!otherPad) continue;

      similarity *= pad.Similarity(otherPad);
    }

    return similarity;
  }

  /// Sets the component class object pointer for this footprint
  SetStaticComponentClass(aClass: unknown): void {
    // m_componentClassCacheProxy->SetStaticComponentClass( aClass );   -- COMPONENT_CLASS pending (#636)
  }

  /// Returns the component class for this footprint
  GetStaticComponentClass(): null {
    return null; // COMPONENT_CLASS pending (#636)
  }

  /// Returns the component class for this footprint
  GetComponentClass(): null {
    return null; // COMPONENT_CLASS pending (#636)
  }

  /// Used for display in the properties panel
  GetComponentClassAsString(): string {
    return ''; // COMPONENT_CLASS pending (#636): the class is empty
  }

  /// Forces immediate recalculation of the component class for this footprint
  RecomputeComponentClass(): void {}

  /// Forces deferred (on next access) recalculation of the component class for this footprint
  InvalidateComponentClassCache(): void {}

  /**
   * @brief Sets the transient component class names
   *
   * This is used during paste operations as we can't resolve the component classes immediately
   * until we have the true board context once the pasted items have been placed
   */
  SetTransientComponentClassNames(classNames: ReadonlySet<string>): void {
    this.m_transientComponentClassNames = new Set(classNames);
  }

  /// Gets the transient component class names
  GetTransientComponentClassNames(): ReadonlySet<string> {
    return this.m_transientComponentClassNames;
  }

  /// Remove the transient component class names
  ClearTransientComponentClassNames(): void {
    this.m_transientComponentClassNames.clear();
  }

  /// Resolves a set of component class names to this footprint's actual component class
  ResolveComponentClassNames(aBoard: BOARD, aComponentClassNames: ReadonlySet<string>): void {
    // aBoard->GetComponentClassManager().GetEffectiveStaticComponentClass( aComponentClassNames )
    //                                                     -- COMPONENT_CLASS pending (#636)
  }

  /// Used post-loading of a footprint to adjust the layers on pads to match board inner layers
  FixUpPadsForBoard(aBoard: BOARD | null): void {
    if (!aBoard) return;

    if (this.GetStackupMode() !== FOOTPRINT_STACKUP.EXPAND_INNER_LAYERS) return;

    const boardCopper = LSET.AllCuMask(aBoard.GetCopperLayerCount());

    for (const pad of this.Pads()) {
      if (pad.GetAttribute() === PAD_ATTRIB.PTH) {
        const padLayers = pad.GetLayerSet();
        padLayers.orAssign(boardCopper);
        pad.SetLayerSet(padLayers);
      }
    }
  }

  /** `operator==( const BOARD_ITEM& aOther )`. */
  equals(aOther: BOARD_ITEM): boolean {
    if (aOther.Type() !== KICAD_T.PCB_FOOTPRINT_T) return false;

    const other = aOther as FOOTPRINT;

    return this.equalsFootprint(other);
  }

  /** `operator==( const FOOTPRINT& aOther )`. */
  equalsFootprint(aOther: FOOTPRINT): boolean {
    if (this.m_pads.length !== aOther.m_pads.length) return false;

    for (let ii = 0; ii < this.m_pads.length; ++ii) {
      if (!this.m_pads[ii]!.equals(aOther.m_pads[ii]!)) return false;
    }

    if (this.m_drawings.length !== aOther.m_drawings.length) return false;

    for (let ii = 0; ii < this.m_drawings.length; ++ii) {
      if (!this.m_drawings[ii]!.equals(aOther.m_drawings[ii]!)) return false;
    }

    if (this.m_zones.length !== aOther.m_zones.length) return false;

    for (let ii = 0; ii < this.m_zones.length; ++ii) {
      if (!this.m_zones[ii]!.equals(aOther.m_zones[ii]!)) return false;
    }

    if (this.m_points.length !== aOther.m_points.length) return false;

    // Compare fields in ordinally-sorted order
    const fields: PCB_FIELD[] = [];
    const otherFields: PCB_FIELD[] = [];

    this.GetFields(fields, false);
    aOther.GetFields(otherFields, false);

    if (fields.length !== otherFields.length) return false;

    for (let ii = 0; ii < fields.length; ++ii) {
      if (fields[ii]) {
        if (!fields[ii]!.equals(otherFields[ii]!)) return false;
      }
    }

    return true;
  }

  /** `struct cmp_drawings`. */
  static cmp_drawings(itemA: BOARD_ITEM, itemB: BOARD_ITEM): boolean {
    if (itemA.Type() !== itemB.Type()) return itemA.Type() < itemB.Type();

    if (itemA.GetLayer() !== itemB.GetLayer()) return itemA.GetLayer() < itemB.GetLayer();

    switch (itemA.Type()) {
      case KICAD_T.PCB_SHAPE_T: {
        const dwgA = itemA as PCB_SHAPE;
        const dwgB = itemB as PCB_SHAPE;

        if (dwgA.GetShape() !== dwgB.GetShape()) return dwgA.GetShape() < dwgB.GetShape();

        // GetStart() and GetEnd() have no meaning with polygons.
        // We cannot use them for sorting polygons
        if (dwgA.GetShape() !== SHAPE_T.POLY) {
          let cmp = cmp_points_opt(dwgA.GetStart(), dwgB.GetStart());

          if (cmp !== undefined) return cmp;

          cmp = cmp_points_opt(dwgA.GetEnd(), dwgB.GetEnd());

          if (cmp !== undefined) return cmp;
        }

        if (dwgA.GetShape() === SHAPE_T.ARC) {
          const cmp = cmp_points_opt(dwgA.GetCenter(), dwgB.GetCenter());

          if (cmp !== undefined) return cmp;
        } else if (dwgA.GetShape() === SHAPE_T.BEZIER) {
          let cmp = cmp_points_opt(dwgA.GetBezierC1(), dwgB.GetBezierC1());

          if (cmp !== undefined) return cmp;

          cmp = cmp_points_opt(dwgA.GetBezierC2(), dwgB.GetBezierC2());

          if (cmp !== undefined) return cmp;
        } else if (dwgA.GetShape() === SHAPE_T.POLY) {
          if (dwgA.GetPolyShape().TotalVertices() !== dwgB.GetPolyShape().TotalVertices())
            return dwgA.GetPolyShape().TotalVertices() < dwgB.GetPolyShape().TotalVertices();

          for (let ii = 0; ii < dwgA.GetPolyShape().TotalVertices(); ++ii) {
            const cmp = cmp_points_opt(
              dwgA.GetPolyShape().CVertex(ii),
              dwgB.GetPolyShape().CVertex(ii),
            );

            if (cmp !== undefined) return cmp;
          }
        }

        if (dwgA.GetWidth() !== dwgB.GetWidth()) return dwgA.GetWidth() < dwgB.GetWidth();

        break;
      }

      case KICAD_T.PCB_TEXT_T: {
        const textA = itemA as PCB_TEXT;
        const textB = itemB as PCB_TEXT;

        const cmpPos = cmp_points_opt(textA.GetPosition(), textB.GetPosition());

        if (cmpPos !== undefined) return cmpPos;

        if (!textA.GetTextAngle().equals(textB.GetTextAngle()))
          return textA.GetTextAngle().lt(textB.GetTextAngle());

        const cmpSize = cmp_points_opt(textA.GetTextSize(), textB.GetTextSize());

        if (cmpSize !== undefined) return cmpSize;

        if (textA.GetTextThickness() !== textB.GetTextThickness())
          return textA.GetTextThickness() < textB.GetTextThickness();

        if (textA.IsBold() !== textB.IsBold())
          return Number(textA.IsBold()) < Number(textB.IsBold());

        if (textA.IsItalic() !== textB.IsItalic())
          return Number(textA.IsItalic()) < Number(textB.IsItalic());

        if (textA.IsMirrored() !== textB.IsMirrored())
          return Number(textA.IsMirrored()) < Number(textB.IsMirrored());

        if (textA.GetLineSpacing() !== textB.GetLineSpacing())
          return textA.GetLineSpacing() < textB.GetLineSpacing();

        if (textA.GetText() !== textB.GetText()) return textA.GetText() < textB.GetText(); // wxString::Cmp: code-point order

        break;
      }

      default: {
        // These items don't have their own specific sorting criteria.
        break;
      }
    }

    if (itemA.m_Uuid !== itemB.m_Uuid) return itemA.m_Uuid < itemB.m_Uuid;

    return false; // itemA < itemB on pointers: no address order for objects
  }

  /** `struct cmp_pads`. */
  static cmp_pads(aFirst: PAD, aSecond: PAD): boolean {
    if (aFirst.GetNumber() !== aSecond.GetNumber())
      return strNumCmp(aFirst.GetNumber(), aSecond.GetNumber()) < 0;

    const cmp = cmp_points_opt(aFirst.GetFPRelativePosition(), aSecond.GetFPRelativePosition());

    if (cmp !== undefined) return cmp;

    let padCopperMatches: boolean | undefined;

    // Pick the "most complex" padstack to iterate
    let checkPad = aFirst;

    if (
      aSecond.Padstack().Mode() === PADSTACK_MODE.CUSTOM ||
      (aSecond.Padstack().Mode() === PADSTACK_MODE.FRONT_INNER_BACK &&
        aFirst.Padstack().Mode() === PADSTACK_MODE.NORMAL)
    ) {
      checkPad = aSecond;
    }

    checkPad.Padstack().ForEachUniqueLayer((aLayer: PCB_LAYER_ID) => {
      if (aFirst.GetSize(aLayer).x !== aSecond.GetSize(aLayer).x)
        padCopperMatches = aFirst.GetSize(aLayer).x < aSecond.GetSize(aLayer).x;
      else if (aFirst.GetSize(aLayer).y !== aSecond.GetSize(aLayer).y)
        padCopperMatches = aFirst.GetSize(aLayer).y < aSecond.GetSize(aLayer).y;
      else if (aFirst.GetShape(aLayer) !== aSecond.GetShape(aLayer))
        padCopperMatches = aFirst.GetShape(aLayer) < aSecond.GetShape(aLayer);
    });

    if (padCopperMatches !== undefined) return padCopperMatches;

    if (!aFirst.GetLayerSet().equals(aSecond.GetLayerSet()))
      return seqLess(aFirst.GetLayerSet().Seq(), aSecond.GetLayerSet().Seq());

    if (aFirst.m_Uuid !== aSecond.m_Uuid) return aFirst.m_Uuid < aSecond.m_Uuid;

    return false; // aFirst < aSecond on pointers: no address order for objects
  }

  /** `struct cmp_zones`. */
  static cmp_zones(aFirst: ZONE, aSecond: ZONE): boolean {
    if (aFirst.GetAssignedPriority() !== aSecond.GetAssignedPriority())
      return aFirst.GetAssignedPriority() < aSecond.GetAssignedPriority();

    if (!aFirst.GetLayerSet().equals(aSecond.GetLayerSet()))
      return seqLess(aFirst.GetLayerSet().Seq(), aSecond.GetLayerSet().Seq());

    if (aFirst.Outline().TotalVertices() !== aSecond.Outline().TotalVertices())
      return aFirst.Outline().TotalVertices() < aSecond.Outline().TotalVertices();

    for (let ii = 0; ii < aFirst.Outline().TotalVertices(); ++ii) {
      const cmp = cmp_points_opt(aFirst.Outline().CVertex(ii), aSecond.Outline().CVertex(ii));

      if (cmp !== undefined) return cmp;
    }

    if (aFirst.m_Uuid !== aSecond.m_Uuid) return aFirst.m_Uuid < aSecond.m_Uuid;

    return false; // aFirst < aSecond on pointers: no address order for objects
  }

  protected override swapData(aImage: BOARD_ITEM): void {
    console.assert(aImage.Type() === KICAD_T.PCB_FOOTPRINT_T);

    const image = aImage as FOOTPRINT;

    // std::swap( *this, *image ): every member moves, the children included
    const mine = FOOTPRINT.copyOfFootprint(this);

    this.assignFootprint(image);
    (this as { m_Uuid: KIID }).m_Uuid = image.m_Uuid;
    this.m_arflag = image.m_arflag;

    image.assignFootprint(mine);
    (image as { m_Uuid: KIID }).m_Uuid = mine.m_Uuid;

    this.RunOnChildren((child: BOARD_ITEM) => {
      child.SetParent(this);
    }, RECURSE_MODE.NO_RECURSE);

    image.RunOnChildren((child: BOARD_ITEM) => {
      child.SetParent(image);
    }, RECURSE_MODE.NO_RECURSE);
  }
}

/** `static const std::set<int> emptySet` of `GetNetTieCache`. */
const emptySet: ReadonlySet<number> = new Set();

applyMixins(FOOTPRINT, [EMBEDDED_FILES]);
