// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/altium/altium_pcb.cpp` / `.h`: `ALTIUM_PCB`, which walks an
 * Altium PCB compound file stream by stream (`Parse`) or one footprint of a
 * PCB library (`ParseFootprint`) and builds the BOARD / FOOTPRINT items.
 *
 * The progress reporter's `checkpoint()`, the reporter messages and the
 * thread-pool compression of embedded models are upstream's; the pool is a
 * plain loop here (the work and its result are the same).
 */

import { AltiumUniqueIdToKiid } from '@ziroeda/common/io/altium/altium_project_variants.js';
import {
  ALTIUM_BINARY_PARSER,
  FormatPath,
} from '@ziroeda/common/io/altium/altium_binary_parser.js';
import {
  AltiumPcbSpecialStringsToKiCadStrings,
  AltiumToKiCadLibID,
} from '@ziroeda/common/io/altium/altium_parser_utils.js';
import { ALTIUM_PROPS_UTILS } from '@ziroeda/common/io/altium/altium_props_utils.js';
import type { COMPOUND_FILE_ENTRY } from '@ziroeda/common/io/altium/compoundfilereader.js';
import { EDA_SHAPE, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { EMBEDDED_FILE, EMBEDDED_FILES, FILE_TYPE } from '@ziroeda/common/embedded_files.js';
import { THROW_IO_ERROR } from '@ziroeda/common/exceptions.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { KIID_PATH, kiidFromString } from '@ziroeda/common/kiid.js';
import {
  CopperLayerToOrdinal,
  IsCopperLayer,
  MAX_USER_DEFINED_LAYERS,
  PCB_LAYER_ID,
} from '@ziroeda/common/layer_id.js';
import { LAYER_RANGE } from '@ziroeda/common/layer_range.js';
import { LSET } from '@ziroeda/common/lset.js';
import { NETCLASS } from '@ziroeda/common/netclass.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/progress_reporter.js';
import {
  type Reporter,
  RPT_SEVERITY_DEBUG,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_INFO,
  RPT_SEVERITY_WARNING,
} from '@ziroeda/common/reporter.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { inflateZlib } from '@ziroeda/common/wx/inflate.js';
import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import {
  ERROR_LOC,
  RECT_CHAMFER_ALL,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ANGLE_45, ANGLE_90, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { cos, sin } from '@ziroeda/kimath/src/math/libm.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  Distance,
  EuclideanNormI,
  Perpendicular,
  ResizeI,
  type VECTOR2I,
  add,
  equal,
  sub,
} from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint, RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from '../../board.js';
import {
  BOARD_STACKUP_ITEM_TYPE,
  NotSpecifiedPrm,
} from '../../board_stackup_manager/board_stackup.js';
import type { BOARD_ITEM } from '../../board_item.js';
import { ADD_MODE } from '../../board_item_container.js';
import { BOARD_CONNECTED_ITEM } from '../../board_connected_item.js';
import { LAYER_T } from '../../board_types.js';
import { DEFAULT_BOARD_THICKNESS_MM } from '../../board_design_settings_defaults.js';
import { FOOTPRINT, FP_3DMODEL } from '../../footprint.js';
import { LENGTH_TUNING_MODE, PCB_TUNING_PATTERN } from '../../generators/pcb_tuning_pattern.js';
import { GENERATORS_MGR } from '../../generators_mgr.js';
import { NETINFO_ITEM } from '../../netinfo_item.js';
import { NETINFO_LIST } from '../../netinfo_list.js';
import { PAD } from '../../pad.js';
import { PAD_ATTRIB, PAD_DRILL_SHAPE, PAD_SHAPE, PADSTACK, PADSTACK_MODE } from '../../padstack.js';
import { BARCODE_T, PCB_BARCODE } from '../../pcb_barcode.js';
import { DIM_ARROW_DIRECTION, type DIM_PRECISION, DIM_UNITS_FORMAT } from '../../pcb_dimension.js';
import { PCB_DIM_ALIGNED, PCB_DIM_CENTER, PCB_DIM_RADIAL } from '../../pcb_dimension.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TEXT } from '../../pcb_text.js';
import { PCB_TEXTBOX } from '../../pcb_textbox.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA } from '../../pcb_track.js';
import { TENTING_MODE, VIATYPE } from '../../pcb_track_types.js';
import { TEARDROP_TYPE } from '../../teardrop/teardrop_parameters.js';
import { ZONE } from '../../zone.js';
import { ZONE_BORDER_DISPLAY_STYLE, ZONE_FILL_MODE } from '../../zone_settings.js';
import { ZONE_CONNECTION } from '../../zones.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type {
  INPUT_LAYER_DESC,
  LAYER_MAPPING_HANDLER,
} from '../common/plugin_common_layer_mapping.js';
import {
  AARC6,
  ABOARD6,
  type ABOARD6_LAYER_STACKUP,
  ACLASS6,
  ACOMPONENT6,
  ACOMPONENTBODY6,
  ADIMENSION6,
  AEXTENDED_PRIMITIVE_INFORMATION,
  AEXTENDED_PRIMITIVE_INFORMATION_TYPE,
  AFILL6,
  ALIBRARY,
  ALTIUM_BARCODE_TYPE,
  ALTIUM_CLASS_KIND,
  ALTIUM_COMPONENT_NONE,
  ALTIUM_CONNECT_STYLE,
  ALTIUM_DIMENSION_KIND,
  ALTIUM_LAYER,
  ALTIUM_MECHKIND,
  ALTIUM_MODE,
  ALTIUM_NET_UNCONNECTED,
  ALTIUM_PAD_HOLE_SHAPE,
  ALTIUM_PAD_MODE,
  ALTIUM_PAD_SHAPE,
  ALTIUM_PAD_SHAPE_ALT,
  ALTIUM_POLYGON_BOARD,
  ALTIUM_POLYGON_HATCHSTYLE,
  ALTIUM_POLYGON_NONE,
  ALTIUM_RECORD,
  ALTIUM_REGION_KIND,
  ALTIUM_RULE_KIND,
  ALTIUM_TEXT_POSITION,
  ALTIUM_TEXT_TYPE,
  ALTIUM_UNIT,
  type ALTIUM_VERTICE,
  AMODEL,
  ANET6,
  APAD6,
  APOLYGON6,
  AREGION6,
  ARULE6,
  ASMARTUNION6,
  ATEXT6,
  ATRACK6,
  AVIA6,
  selectAltiumPolygonRule,
  altiumViaSideIsTented,
} from './altium_parser_pcb.js';
import type { ALTIUM_PCB_COMPOUND_FILE } from './altium_pcb_compound_file.js';

const {
  UNDEFINED_LAYER,
  F_Cu,
  B_Cu,
  In1_Cu,
  F_SilkS,
  B_SilkS,
  F_Paste,
  B_Paste,
  F_Mask,
  B_Mask,
  Dwgs_User,
  Cmts_User,
  Eco1_User,
  Margin,
  Edge_Cuts,
  F_CrtYd,
  B_CrtYd,
  F_Fab,
  B_Fab,
  F_Adhes,
  B_Adhes,
  User_1,
} = PCB_LAYER_ID;

export enum ALTIUM_PCB_DIR {
  FILE_HEADER,

  ADVANCEDPLACEROPTIONS6,
  ARCS6,
  BOARD6,
  BOARDREGIONS,
  CLASSES6,
  COMPONENTBODIES6,
  COMPONENTS6,
  CONNECTIONS6,
  COORDINATES6,
  DESIGNRULECHECKEROPTIONS6,
  DIFFERENTIALPAIRS6,
  DIMENSIONS6,
  EMBEDDEDBOARDS6,
  EMBEDDEDFONTS6,
  EMBEDDEDS6,
  EXTENDPRIMITIVEINFORMATION,
  FILEVERSIONINFO,
  FILLS6,
  FROMTOS6,
  MODELS,
  MODELSNOEMBED,
  NETS6,
  PADS6,
  PADVIALIBRARY,
  PADVIALIBRARYCACHE,
  PADVIALIBRARYLINKS,
  PINSWAPOPTIONS6,
  PINPAIRSSECTION,
  POLYGONS6,
  REGIONS6,
  RULES6,
  SHAPEBASEDCOMPONENTBODIES6,
  SHAPEBASEDREGIONS6,
  SIGNALCLASSES,
  SMARTUNIONS,
  TEXTS,
  TEXTS6,
  TEXTURES,
  TRACKS6,
  UNIONNAMES,
  UNIQUEIDPRIMITIVEINFORMATION,
  VIAS6,
  WIDESTRINGS6,
}

// Structure for storing embedded model data
export class ALTIUM_EMBEDDED_MODEL_DATA {
  m_modelname: string;
  m_rotation: { x: number; y: number; z: number };
  m_z_offset: number;
  m_data: Uint8Array;

  constructor(
    name: string,
    rotation: { x: number; y: number; z: number },
    z_offset: number,
    data: Uint8Array,
  ) {
    this.m_modelname = name;
    this.m_rotation = rotation;
    this.m_z_offset = z_offset;
    this.m_data = data;
  }
}

type PARSE_FUNCTION_POINTER_fp = (
  aFile: ALTIUM_PCB_COMPOUND_FILE,
  aEntry: COMPOUND_FILE_ENTRY,
) => void;

/** An `EDA_TEXT&` the importer fills: a board text, a text box or a field. */
type EDA_TEXT = PCB_TEXT | PCB_TEXTBOX;

const BOLD_FACTOR = 1.75; // CSS font-weight-normal is 400; bold is 700

/** `std::map` ordered by key, for the few maps upstream iterates. */
function sortedEntries<K extends number | string, V>(aMap: Map<K, V>): [K, V][] {
  return [...aMap].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function IsAltiumLayerCopper(aLayer: ALTIUM_LAYER): boolean {
  return (
    (aLayer >= ALTIUM_LAYER.TOP_LAYER && aLayer <= ALTIUM_LAYER.BOTTOM_LAYER) ||
    aLayer === ALTIUM_LAYER.MULTI_LAYER
  ); // TODO: add IsAltiumLayerAPlane?
}

export function IsAltiumLayerAPlane(aLayer: ALTIUM_LAYER): boolean {
  return aLayer >= ALTIUM_LAYER.INTERNAL_PLANE_1 && aLayer <= ALTIUM_LAYER.INTERNAL_PLANE_16;
}

/** `DEG2RAD`. */
const DEG2RAD = (deg: number): number => (deg * Math.PI) / 180.0;

export function HelperShapeLineChainFromAltiumVertices(
  aLine: SHAPE_LINE_CHAIN,
  aVertices: readonly ALTIUM_VERTICE[],
): void {
  for (const vertex of aVertices) {
    if (vertex.isRound) {
      const angle = new EDA_ANGLE(vertex.endangle - vertex.startangle);
      angle.Normalize();

      const startradiant = DEG2RAD(vertex.startangle);
      const endradiant = DEG2RAD(vertex.endangle);
      const arcStartOffset = {
        x: KiROUND(cos(startradiant) * vertex.radius),
        y: KiROUND(-sin(startradiant) * vertex.radius),
      };

      const arcEndOffset = {
        x: KiROUND(cos(endradiant) * vertex.radius),
        y: KiROUND(-sin(endradiant) * vertex.radius),
      };

      const arcStart = add(vertex.center, arcStartOffset);
      const arcEnd = add(vertex.center, arcEndOffset);

      const isShort =
        Distance(arcStart, arcEnd) < pcbIUScale.mmToIU(0.001) || angle.AsDegrees() < 0.2;

      if (Distance(arcStart, vertex.position) < Distance(arcEnd, vertex.position)) {
        if (!isShort) {
          aLine.Append(new SHAPE_ARC(vertex.center, arcStart, angle.negate()));
        } else {
          aLine.Append(arcStart);
          aLine.Append(arcEnd);
        }
      } else {
        if (!isShort) {
          aLine.Append(new SHAPE_ARC(vertex.center, arcEnd, angle));
        } else {
          aLine.Append(arcEnd);
          aLine.Append(arcStart);
        }
      }
    } else {
      aLine.Append(vertex.position);
    }
  }

  aLine.SetClosed(true);
}

/// Normalize angle to be aMin < angle <= aMax angle is in degrees.
export function normalizeAngleDegrees(AngleIn: number, aMin: number, aMax: number): number {
  let Angle = AngleIn;

  while (Angle < aMin) Angle += 360.0;

  while (Angle >= aMax) Angle -= 360.0;

  return Angle;
}

// Helper to detect if a layer name indicates a courtyard layer
function IsLayerNameCourtyard(aName: string): boolean {
  const nameLower = aName.toLowerCase();
  return (
    nameLower.includes('courtyard') ||
    nameLower.includes('court yard') ||
    nameLower.includes('crtyd')
  );
}

// Helper to detect if a layer name indicates an assembly layer
function IsLayerNameAssembly(aName: string): boolean {
  const nameLower = aName.toLowerCase();
  return nameLower.includes('assembly') || nameLower.includes('assy');
}

// Helper to detect if a layer name indicates a top-side layer
function IsLayerNameTopSide(aName: string): boolean {
  let isTop = false;

  const check = (aTopCond: boolean, aBotCond: boolean): boolean => {
    if (aTopCond && aBotCond) return false;

    if (!aTopCond && !aBotCond) return false;

    isTop = aTopCond;
    return true;
  };

  const lower = aName.toLowerCase();

  if (check(lower.startsWith('top'), lower.startsWith('bot'))) return isTop;

  if (check(lower.endsWith('_t'), lower.endsWith('_b'))) return isTop;

  if (check(lower.endsWith('.t'), lower.endsWith('.b'))) return isTop;

  if (check(lower.includes('top'), lower.includes('bot'))) return isTop;

  return true; // Unknown
}

/** `wxFileName( aPath, wxPATH_WIN )`: the name part and the full name of a Windows path. */
function winPathName(aPath: string): { name: string; fullName: string } {
  const sep = Math.max(aPath.lastIndexOf('\\'), aPath.lastIndexOf('/'));
  const fullName = aPath.substring(sep + 1);
  const dot = fullName.lastIndexOf('.');
  // wxFileName: a leading dot starts the name, not an extension
  const name = dot > 0 ? fullName.substring(0, dot) : fullName;
  return { name, fullName };
}

/** `wxFileName::GetForbiddenChars()` on Unix. */
const FORBIDDEN_CHARS = '/';

export class ALTIUM_PCB {
  private m_board: BOARD;
  private m_components: FOOTPRINT[] = [];
  private m_polygons: (ZONE | null)[] = [];
  private m_radialDimensions: PCB_DIM_RADIAL[] = [];
  private m_unicodeStrings = new Map<number, string>();
  private m_altiumToKicadNetcodes: number[] = [];
  /** used to correctly map layers */
  private m_layermap = new Map<ALTIUM_LAYER, PCB_LAYER_ID>();
  private m_layerNames = new Map<ALTIUM_LAYER, string>();

  private m_EmbeddedModels = new Map<string, ALTIUM_EMBEDDED_MODEL_DATA>();
  private m_rules = new Map<ALTIUM_RULE_KIND, ARULE6[]>();
  /** `std::map<ALTIUM_RECORD, std::multimap<int, const AEXTENDED_PRIMITIVE_INFORMATION>>`. */
  private m_extendedPrimitiveInformationMaps = new Map<
    ALTIUM_RECORD,
    Map<number, AEXTENDED_PRIMITIVE_INFORMATION[]>
  >();

  private m_tuningUnions: ASMARTUNION6[] = [];
  private m_unionToBoardItems = new Map<number, BOARD_ITEM[]>();

  private m_outer_plane = new Map<ALTIUM_LAYER, ZONE>();

  private m_layerMappingHandler: LAYER_MAPPING_HANDLER;

  /** optional; may be nullptr */
  private m_progressReporter: PROGRESS_REPORTER | null;
  /** optional; may be nullptr */
  private m_reporter: Reporter | null;
  private m_doneCount: number;
  private m_lastProgressCount: number;
  /** for progress reporting */
  private m_totalCount: number;

  /** for footprint library loading error reporting */
  private m_library: string;
  /** for footprint library loading error reporting */
  private m_footprintName: string;

  /// Altium stores pour order across all layers
  private m_highest_pour_index: number;

  constructor(
    aBoard: BOARD,
    aProgressReporter: PROGRESS_REPORTER | null,
    aHandler: LAYER_MAPPING_HANDLER,
    aReporter: Reporter | null = null,
    aLibrary = '',
    aFootprintName = '',
  ) {
    this.m_board = aBoard;
    this.m_progressReporter = aProgressReporter;
    this.m_layerMappingHandler = aHandler;
    this.m_reporter = aReporter;
    this.m_doneCount = 0;
    this.m_lastProgressCount = 0;
    this.m_totalCount = 0;
    this.m_highest_pour_index = 0;
    this.m_library = aLibrary;
    this.m_footprintName = aFootprintName;
  }

  private report(aText: string, aSeverity: number): void {
    this.m_reporter?.report(aText, aSeverity);
  }

  private HelperGetFootprint(aComponent: number): FOOTPRINT {
    if (aComponent === ALTIUM_COMPONENT_NONE || this.m_components.length <= aComponent) {
      THROW_IO_ERROR(
        `Component creator tries to access component id ${aComponent} of ${this.m_components.length} existing components`,
      );
    }

    return this.m_components[aComponent]!;
  }

  GetKicadLayer(aAltiumLayer: ALTIUM_LAYER): PCB_LAYER_ID {
    const override = this.m_layermap.get(aAltiumLayer);

    if (override !== undefined) {
      return override;
    }

    if (
      aAltiumLayer >= ALTIUM_LAYER.V7_MECHANICAL_17 &&
      aAltiumLayer <= ALTIUM_LAYER.V7_MECHANICAL_LAST
    ) {
      // Layer "Mechanical 17" would correspond to altiumOrd 16
      const altiumOrd = aAltiumLayer - ALTIUM_LAYER.V7_MECHANICAL_1;

      if (altiumOrd + 1 > MAX_USER_DEFINED_LAYERS) return UNDEFINED_LAYER;

      // Convert to KiCad User_* layers
      return (User_1 + altiumOrd * 2) as PCB_LAYER_ID;
    }

    switch (aAltiumLayer) {
      case ALTIUM_LAYER.UNKNOWN:
        return UNDEFINED_LAYER;

      case ALTIUM_LAYER.TOP_LAYER:
        return F_Cu;
      case ALTIUM_LAYER.BOTTOM_LAYER:
        return B_Cu;

      case ALTIUM_LAYER.TOP_OVERLAY:
        return F_SilkS;
      case ALTIUM_LAYER.BOTTOM_OVERLAY:
        return B_SilkS;
      case ALTIUM_LAYER.TOP_PASTE:
        return F_Paste;
      case ALTIUM_LAYER.BOTTOM_PASTE:
        return B_Paste;
      case ALTIUM_LAYER.TOP_SOLDER:
        return F_Mask;
      case ALTIUM_LAYER.BOTTOM_SOLDER:
        return B_Mask;

      case ALTIUM_LAYER.DRILL_GUIDE:
        return Dwgs_User;
      case ALTIUM_LAYER.KEEP_OUT_LAYER:
        return Margin;

      case ALTIUM_LAYER.DRILL_DRAWING:
        return Dwgs_User;

      default:
        break;
    }

    // case ALTIUM_LAYER::MID_LAYER_n: return In<n>_Cu;
    if (aAltiumLayer >= ALTIUM_LAYER.MID_LAYER_1 && aAltiumLayer <= ALTIUM_LAYER.MID_LAYER_30)
      return (In1_Cu + (aAltiumLayer - ALTIUM_LAYER.MID_LAYER_1) * 2) as PCB_LAYER_ID;

    // case ALTIUM_LAYER::MECHANICAL_n: return User_n;
    if (aAltiumLayer >= ALTIUM_LAYER.MECHANICAL_1 && aAltiumLayer <= ALTIUM_LAYER.MECHANICAL_16)
      return (User_1 + (aAltiumLayer - ALTIUM_LAYER.MECHANICAL_1) * 2) as PCB_LAYER_ID;

    // INTERNAL_PLANE_n, MULTI_LAYER, CONNECTIONS, BACKGROUND, DRC_ERROR_MARKERS, SELECTIONS,
    // VISIBLE_GRID_1/2, PAD_HOLES, VIA_HOLES and anything else
    return UNDEFINED_LAYER;
  }

  GetKicadLayersToIterate(aAltiumLayer: ALTIUM_LAYER): PCB_LAYER_ID[] {
    if (aAltiumLayer === ALTIUM_LAYER.MULTI_LAYER || aAltiumLayer === ALTIUM_LAYER.KEEP_OUT_LAYER) {
      const layerCount = this.m_board ? this.m_board.GetCopperLayerCount() : 32;
      const layers: PCB_LAYER_ID[] = [];

      for (const layer of new LAYER_RANGE(F_Cu, B_Cu, layerCount)) {
        if (!this.m_board || this.m_board.IsLayerEnabled(layer)) layers.push(layer);
      }

      return layers;
    }

    const klayer = this.GetKicadLayer(aAltiumLayer);

    if (klayer === UNDEFINED_LAYER) return [];

    return [klayer];
  }

  private checkpoint(): void {
    const PROGRESS_DELTA = 250;

    if (this.m_progressReporter) {
      if (++this.m_doneCount > this.m_lastProgressCount + PROGRESS_DELTA) {
        this.m_progressReporter.SetCurrentProgress(
          this.m_doneCount / Math.max(1, this.m_totalCount),
        );

        if (!this.m_progressReporter.KeepRefreshing())
          THROW_IO_ERROR('File import canceled by user.');

        this.m_lastProgressCount = this.m_doneCount;
      }
    }
  }

  Parse(altiumPcbFile: ALTIUM_PCB_COMPOUND_FILE, aFileMapping: Map<ALTIUM_PCB_DIR, string>): void {
    // this vector simply declares in which order which functions to call.
    const parserOrder: [boolean, ALTIUM_PCB_DIR, PARSE_FUNCTION_POINTER_fp][] = [
      [true, ALTIUM_PCB_DIR.FILE_HEADER, (f, e) => this.ParseFileHeader(f, e)],
      [true, ALTIUM_PCB_DIR.BOARD6, (f, e) => this.ParseBoard6Data(f, e)],
      [
        false,
        ALTIUM_PCB_DIR.EXTENDPRIMITIVEINFORMATION,
        (f, e) => this.ParseExtendedPrimitiveInformationData(f, e),
      ],
      [true, ALTIUM_PCB_DIR.COMPONENTS6, (f, e) => this.ParseComponents6Data(f, e)],
      [
        false,
        ALTIUM_PCB_DIR.MODELS,
        (f, e) => {
          const dir = [aFileMapping.get(ALTIUM_PCB_DIR.MODELS)!];
          this.ParseModelsData(f, e, dir);
        },
      ],
      [true, ALTIUM_PCB_DIR.COMPONENTBODIES6, (f, e) => this.ParseComponentsBodies6Data(f, e)],
      [true, ALTIUM_PCB_DIR.NETS6, (f, e) => this.ParseNets6Data(f, e)],
      [true, ALTIUM_PCB_DIR.CLASSES6, (f, e) => this.ParseClasses6Data(f, e)],
      [true, ALTIUM_PCB_DIR.RULES6, (f, e) => this.ParseRules6Data(f, e)],
      [true, ALTIUM_PCB_DIR.DIMENSIONS6, (f, e) => this.ParseDimensions6Data(f, e)],
      [true, ALTIUM_PCB_DIR.POLYGONS6, (f, e) => this.ParsePolygons6Data(f, e)],
      [true, ALTIUM_PCB_DIR.ARCS6, (f, e) => this.ParseArcs6Data(f, e)],
      [true, ALTIUM_PCB_DIR.PADS6, (f, e) => this.ParsePads6Data(f, e)],
      [true, ALTIUM_PCB_DIR.VIAS6, (f, e) => this.ParseVias6Data(f, e)],
      [true, ALTIUM_PCB_DIR.TRACKS6, (f, e) => this.ParseTracks6Data(f, e)],
      [false, ALTIUM_PCB_DIR.SMARTUNIONS, (f, e) => this.ParseSmartUnions6Data(f, e)],
      [false, ALTIUM_PCB_DIR.WIDESTRINGS6, (f, e) => this.ParseWideStrings6Data(f, e)],
      [true, ALTIUM_PCB_DIR.TEXTS6, (f, e) => this.ParseTexts6Data(f, e)],
      [true, ALTIUM_PCB_DIR.FILLS6, (f, e) => this.ParseFills6Data(f, e)],
      [false, ALTIUM_PCB_DIR.BOARDREGIONS, (f, e) => this.ParseBoardRegionsData(f, e)],
      [true, ALTIUM_PCB_DIR.SHAPEBASEDREGIONS6, (f, e) => this.ParseShapeBasedRegions6Data(f, e)],
      [true, ALTIUM_PCB_DIR.REGIONS6, (f, e) => this.ParseRegions6Data(f, e)],
    ];

    if (this.m_progressReporter !== null) {
      // Count number of records we will read for the progress reporter
      for (const [, directory] of parserOrder) {
        if (directory === ALTIUM_PCB_DIR.FILE_HEADER) continue;

        const mappedDirectory = aFileMapping.get(directory);

        if (mappedDirectory === undefined) continue;

        const mappedFile = [mappedDirectory, 'Header'];
        const file = altiumPcbFile.FindStream(mappedFile);

        if (file === null) continue;

        const reader = new ALTIUM_BINARY_PARSER(altiumPcbFile, file);
        const numOfRecords = reader.ReadUint32();

        if (reader.HasParsingError()) {
          this.report(`'${FormatPath(mappedFile)}' was not parsed correctly.`, RPT_SEVERITY_ERROR);

          continue;
        }

        this.m_totalCount += numOfRecords;

        if (reader.GetRemainingBytes() !== 0) {
          this.report(`'${FormatPath(mappedFile)}' was not fully parsed.`, RPT_SEVERITY_ERROR);

          continue;
        }
      }
    }

    const boardDirectory = aFileMapping.get(ALTIUM_PCB_DIR.BOARD6);

    if (boardDirectory !== undefined) {
      const mappedFile = [boardDirectory, 'Data'];

      const file = altiumPcbFile.FindStream(mappedFile);

      if (!file) {
        THROW_IO_ERROR(
          'This file does not appear to be in a valid PCB Binary Version 6.0 format. In Altium Designer, make sure to save as "PCB Binary Files (*.PcbDoc)".',
        );
      }
    }

    // Parse data in specified order
    for (const [isRequired, directory, fp] of parserOrder) {
      const mappedDirectory = aFileMapping.get(directory);

      if (mappedDirectory === undefined) {
        console.assert(
          !isRequired,
          `Altium Directory of kind ${directory} was expected, but no mapping is present in the code`,
        );
        continue;
      }

      const mappedFile = [mappedDirectory];

      if (directory !== ALTIUM_PCB_DIR.FILE_HEADER) mappedFile.push('Data');

      const file = altiumPcbFile.FindStream(mappedFile);

      if (file !== null) {
        fp(altiumPcbFile, file);
      } else if (isRequired) {
        this.report(
          `File not found: '${FormatPath(mappedFile)}' for directory '${ALTIUM_PCB_DIR[directory]}'.`,
          RPT_SEVERITY_ERROR,
        );
      }
    }

    // Rebuild interactive length-tuning meanders from the SmartUnions definitions now that all
    // copper that the unions reference has been created and added to the board.
    this.HelperCreateTuningPatterns();

    // fixup zone priorities since Altium stores them in the opposite order
    for (const zone of this.m_polygons) {
      if (!zone) continue;

      // Altium "fills" - not poured in Altium
      if (zone.GetAssignedPriority() === 1000) {
        // Unlikely, but you never know
        if (this.m_highest_pour_index >= 1000)
          zone.SetAssignedPriority(this.m_highest_pour_index + 1);

        continue;
      }

      const priority = this.m_highest_pour_index - zone.GetAssignedPriority();

      zone.SetAssignedPriority(priority >= 0 ? priority : 0);
    }

    // change priority of outer zone to zero
    for (const [, zone] of sortedEntries(this.m_outer_plane)) zone.SetAssignedPriority(0);

    // Simplify and fracture zone fills in case we constructed them from tracks (hatched fill)
    for (const zone of this.m_polygons) {
      if (!zone) continue;

      for (const layer of zone.GetLayerSet()) {
        if (!zone.HasFilledPolysForLayer(layer)) continue;

        zone.GetFilledPolysList(layer).Fracture();
      }
    }

    // Altium doesn't appear to store either the dimension value nor the dimensioned object in
    // the dimension record.  (Yes, there is a REFERENCE0OBJECTID, but it doesn't point to the
    // dimensioned object.)  We attempt to plug this gap by finding a colocated arc or circle
    // and using its radius.  If there are more than one such arcs/circles, well, :shrug:.
    for (const dim of this.m_radialDimensions) {
      let radius = 0;

      for (const item of this.m_board.Drawings()) {
        if (item.Type() !== KICAD_T.PCB_SHAPE_T) continue;

        const shape = item as PCB_SHAPE;

        if (shape.GetShape() !== SHAPE_T.ARC && shape.GetShape() !== SHAPE_T.CIRCLE) continue;

        if (equal(shape.GetPosition(), dim.GetPosition())) {
          radius = shape.GetRadius();
          break;
        }
      }

      if (radius === 0) {
        for (const track of this.m_board.Tracks()) {
          if (track.Type() !== KICAD_T.PCB_ARC_T) continue;

          const arc = track as PCB_ARC;

          if (equal(arc.GetCenter(), dim.GetPosition())) {
            radius = arc.GetRadius();
            break;
          }
        }
      }

      // Move the radius point onto the circumference
      let radialLine = sub(dim.GetEnd(), dim.GetStart());
      const totalLength = EuclideanNormI(radialLine);

      // Enforce a minimum on the radialLine else we won't have enough precision to get the
      // angle from it.
      radialLine = ResizeI(radialLine, Math.max(radius, 2));
      dim.SetEnd(add(dim.GetStart(), radialLine));
      dim.SetLeaderLength(totalLength - radius);
      dim.Update();
    }

    // center board
    const bbbox = this.m_board.GetBoardEdgesBoundingBox();

    const w = this.m_board.GetPageSettings().GetWidthIU(pcbIUScale.IU_PER_MILS);
    const h = this.m_board.GetPageSettings().GetHeightIU(pcbIUScale.IU_PER_MILS);

    const desired_x = Math.trunc((w - bbbox.GetWidth()) / 2);
    const desired_y = Math.trunc((h - bbbox.GetHeight()) / 2);

    const movementVector = { x: desired_x - bbbox.GetX(), y: desired_y - bbbox.GetY() };
    this.m_board.Move(movementVector);

    const bds = this.m_board.GetDesignSettings();
    bds.SetAuxOrigin(add(bds.GetAuxOrigin(), movementVector));
    bds.SetGridOrigin(add(bds.GetGridOrigin(), movementVector));

    this.m_board.SetModified();
  }

  ParseFootprint(altiumLibFile: ALTIUM_PCB_COMPOUND_FILE, aFootprintName: string): FOOTPRINT {
    const footprint = new FOOTPRINT(this.m_board);

    this.m_unicodeStrings.clear();
    this.m_extendedPrimitiveInformationMaps.clear();

    const libStreamName = ['Library', 'Data'];
    const libStream = altiumLibFile.FindStream(libStreamName);

    if (libStream === null) {
      THROW_IO_ERROR(`File not found: '${FormatPath(libStreamName)}'.`);
    }

    const libParser = new ALTIUM_BINARY_PARSER(altiumLibFile, libStream);
    const libData = new ALIBRARY(libParser);

    this.HelperFillMechanicalLayerAssignments(libData.stackup);

    // TODO: WideStrings are stored as parameterMap in the case of footprints, not as binary

    const [fpDirName, footprintStream] = altiumLibFile.FindLibFootprintDirName(aFootprintName);

    if (fpDirName === '') {
      THROW_IO_ERROR(`Footprint directory not found: '${aFootprintName}'.`);
    }

    const streamName = [fpDirName, 'Data'];
    const footprintData = altiumLibFile.FindStream(footprintStream, ['Data']);

    if (footprintData === null) {
      THROW_IO_ERROR(`File not found: '${FormatPath(streamName)}'.`);
    }

    const parser = new ALTIUM_BINARY_PARSER(altiumLibFile, footprintData);

    parser.ReadAndSetSubrecordLength();
    //wxString footprintName = parser.ReadWxString(); // Not used (single-byte char set)
    parser.SkipSubrecord();

    const fpID = AltiumToKiCadLibID('', aFootprintName); // TODO: library name
    footprint.SetFPID(fpID);

    const parametersStreamName = [fpDirName, 'Parameters'];
    const parametersData = altiumLibFile.FindStream(footprintStream, ['Parameters']);

    if (parametersData !== null) {
      const parametersReader = new ALTIUM_BINARY_PARSER(altiumLibFile, parametersData);
      const parameterProperties = parametersReader.ReadProperties();
      const description = ALTIUM_PROPS_UTILS.ReadString(parameterProperties, 'DESCRIPTION', '');
      footprint.SetLibDescription(description);
    } else {
      this.report(`File not found: '${FormatPath(parametersStreamName)}'.`, RPT_SEVERITY_ERROR);

      footprint.SetLibDescription('');
    }

    const extendedPrimitiveInformationStreamName = ['ExtendedPrimitiveInformation', 'Data'];
    const extendedPrimitiveInformationData = altiumLibFile.FindStream(
      footprintStream,
      extendedPrimitiveInformationStreamName,
    );

    if (extendedPrimitiveInformationData !== null)
      this.ParseExtendedPrimitiveInformationData(altiumLibFile, extendedPrimitiveInformationData);

    footprint.SetReference('REF**');
    footprint.SetValue(aFootprintName);
    footprint.Reference().SetVisible(true); // TODO: extract visibility information
    footprint.Value().SetVisible(true);

    const defaultTextSize = { x: pcbIUScale.mmToIU(1.0), y: pcbIUScale.mmToIU(1.0) };
    const defaultTextThickness = pcbIUScale.mmToIU(0.15);

    for (const field of footprint.GetFields()) {
      field.SetTextSize(defaultTextSize);
      field.SetTextThickness(defaultTextThickness);
    }

    for (let primitiveIndex = 0; parser.GetRemainingBytes() >= 4; primitiveIndex++) {
      const recordtype = parser.PeekUint8() as ALTIUM_RECORD;

      switch (recordtype) {
        case ALTIUM_RECORD.ARC: {
          const arc = new AARC6(parser);
          this.ConvertArcs6ToFootprintItem(footprint, arc, primitiveIndex, false);
          break;
        }
        case ALTIUM_RECORD.PAD: {
          const pad = new APAD6(parser);
          this.ConvertPads6ToFootprintItem(footprint, pad);
          break;
        }
        case ALTIUM_RECORD.VIA: {
          const via = new AVIA6(parser);
          this.ConvertVias6ToFootprintItem(footprint, via);
          break;
        }
        case ALTIUM_RECORD.TRACK: {
          const track = new ATRACK6(parser);
          this.ConvertTracks6ToFootprintItem(footprint, track, primitiveIndex, false);
          break;
        }
        case ALTIUM_RECORD.TEXT: {
          const text = new ATEXT6(parser, this.m_unicodeStrings);
          this.ConvertTexts6ToFootprintItem(footprint, text);
          break;
        }
        case ALTIUM_RECORD.FILL: {
          const fill = new AFILL6(parser);
          this.ConvertFills6ToFootprintItem(footprint, fill, false);
          break;
        }
        case ALTIUM_RECORD.REGION: {
          const region = new AREGION6(parser, false);
          this.ConvertShapeBasedRegions6ToFootprintItem(footprint, region, primitiveIndex);
          break;
        }
        case ALTIUM_RECORD.MODEL: {
          const componentBody = new ACOMPONENTBODY6(parser);
          this.ConvertComponentBody6ToFootprintItem(altiumLibFile, footprint, componentBody);
          break;
        }
        default:
          THROW_IO_ERROR(`Record of unknown type: '${recordtype}'.`);
      }
    }

    // Loop over this multiple times to catch pads that are jumpered to each other by multiple shapes
    for (let changes = true; changes; ) {
      changes = false;

      const pads = footprint.Pads();

      // alg::for_all_pairs
      for (let i = 0; i < pads.length; i++) {
        for (let j = i + 1; j < pads.length; j++) {
          const aPad1 = pads[i]!;
          const aPad2 = pads[j]!;

          if (!((aPad1.GetNumber() === '') !== (aPad2.GetNumber() === ''))) continue;

          for (const layer of aPad1.GetLayerSet()) {
            const shape1 = aPad1.GetEffectiveShape(layer);
            const shape2 = aPad2.GetEffectiveShape(layer);

            if (shape1.Collide(shape2)) {
              if (aPad1.GetNumber() === '') aPad1.SetNumber(aPad2.GetNumber());
              else aPad2.SetNumber(aPad1.GetNumber());

              changes = true;
            }
          }
        }
      }
    }

    // Auto-position reference and value
    footprint.AutoPositionFields();

    if (parser.HasParsingError()) {
      THROW_IO_ERROR(`${FormatPath(streamName)} stream was not parsed correctly`);
    }

    if (parser.GetRemainingBytes() !== 0) {
      THROW_IO_ERROR(`${FormatPath(streamName)} stream is not fully parsed`);
    }

    return footprint;
  }

  private GetNetCode(aId: number): number {
    if (aId === ALTIUM_NET_UNCONNECTED) {
      return NETINFO_LIST.UNCONNECTED;
    } else if (this.m_altiumToKicadNetcodes.length < aId) {
      THROW_IO_ERROR(
        `Netcode with id ${aId} does not exist. Only ${this.m_altiumToKicadNetcodes.length} nets are known`,
      );
    } else {
      // operator[] one past the end reads whatever follows; upstream never has that case
      return this.m_altiumToKicadNetcodes[aId] ?? 0;
    }
  }

  private GetRule(aKind: ALTIUM_RULE_KIND, aName: string): ARULE6 | null {
    const rules = this.m_rules.get(aKind);

    if (rules === undefined) return null;

    for (const rule of rules) {
      if (rule.name === aName) return rule;
    }

    return null;
  }

  private GetRuleDefault(aKind: ALTIUM_RULE_KIND): ARULE6 | null {
    const rules = this.m_rules.get(aKind);

    if (rules === undefined) return null;

    for (const rule of rules) {
      if (rule.scope1expr === 'All' && rule.scope2expr === 'All') return rule;
    }

    return null;
  }

  private GetRuleForPolygon(aKind: ALTIUM_RULE_KIND): ARULE6 | null {
    const rules = this.m_rules.get(aKind);

    if (rules === undefined) return null;

    const match = selectAltiumPolygonRule(rules);

    if (match) return match;

    // Fall back to the default (All/All) rule
    return this.GetRuleDefault(aKind);
  }

  private ParseFileHeader(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    reader.ReadAndSetSubrecordLength();
    reader.ReadWxString(); // header: "PCB 5.0 Binary File"

    // TODO: does not seem to work all the time at the moment
    //if( reader.GetRemainingBytes() != 0 )
    //    THROW_IO_ERROR( "FileHeader stream is not fully parsed" );
  }

  private ParseExtendedPrimitiveInformationData(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading extended primitive information data...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    while (reader.GetRemainingBytes() >= 4 /* TODO: use Header section of file */) {
      this.checkpoint();
      const elem = new AEXTENDED_PRIMITIVE_INFORMATION(reader);

      let map = this.m_extendedPrimitiveInformationMaps.get(elem.primitiveObjectId);
      if (!map) {
        map = new Map();
        this.m_extendedPrimitiveInformationMaps.set(elem.primitiveObjectId, map);
      }
      const list = map.get(elem.primitiveIndex);
      if (list) list.push(elem);
      else map.set(elem.primitiveIndex, [elem]);
    }

    if (reader.GetRemainingBytes() !== 0)
      THROW_IO_ERROR('ExtendedPrimitiveInformation stream is not fully parsed');
  }

  private ParseBoard6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading board data...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    this.checkpoint();
    const elem = new ABOARD6(reader);

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('Board6 stream is not fully parsed');

    this.m_board.GetDesignSettings().SetAuxOrigin(elem.sheetpos);
    this.m_board.GetDesignSettings().SetGridOrigin(elem.sheetpos);

    // read layercount from stackup, because LAYERSETSCOUNT is not always correct?!
    let layercount = 0;
    let layerid: number = ALTIUM_LAYER.TOP_LAYER;

    while (layerid < elem.stackup.length && layerid !== 0) {
      layerid = elem.stackup[layerid - 1]!.nextId;
      layercount++;
    }

    const kicadLayercount = layercount % 2 === 0 ? layercount : layercount + 1;
    this.m_board.SetCopperLayerCount(kicadLayercount);

    const designSettings = this.m_board.GetDesignSettings();
    const stackup = designSettings.GetStackupDescriptor();

    // create board stackup
    stackup.RemoveAll(); // Just to be sure
    stackup.BuildDefaultStackupList(designSettings, layercount);

    const list = stackup.GetList();
    let it = 0;

    // find first copper layer
    for (
      ;
      it < list.length && list[it]!.GetType() !== BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_COPPER;
      ++it
    );

    const cuLayers = [...new LAYER_RANGE(F_Cu, B_Cu, 32)];
    let cuLayer = 0;

    for (
      let altiumLayerId = ALTIUM_LAYER.TOP_LAYER as number;
      altiumLayerId < elem.stackup.length && altiumLayerId !== 0;
      altiumLayerId = elem.stackup[altiumLayerId - 1]!.nextId
    ) {
      // array starts with 0, but stackup with 1
      const layer = elem.stackup[altiumLayerId - 1]!;

      // handle unused layer in case of odd layercount
      if (layer.nextId === 0 && layercount !== kicadLayercount) {
        this.m_board.SetLayerName(list[it]!.GetBrdLayerId(), '[unused]');

        if (list[it]!.GetType() !== BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_COPPER)
          THROW_IO_ERROR('Board6 stream, unexpected item while parsing stackup');

        list[it]!.SetThickness(0);

        ++it;

        if (list[it]!.GetType() !== BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC)
          THROW_IO_ERROR('Board6 stream, unexpected item while parsing stackup');

        list[it]!.SetThickness(0, 0);
        list[it]!.SetThicknessLocked(true, 0);
        ++it;
      }

      // std::map::insert: an existing entry stays
      if (!this.m_layermap.has(altiumLayerId as ALTIUM_LAYER))
        this.m_layermap.set(altiumLayerId as ALTIUM_LAYER, cuLayers[cuLayer]!);
      ++cuLayer;

      if (list[it]!.GetType() !== BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_COPPER)
        THROW_IO_ERROR('Board6 stream, unexpected item while parsing stackup');

      list[it]!.SetThickness(layer.copperthick);

      const alayer = altiumLayerId as ALTIUM_LAYER;
      const klayer = list[it]!.GetBrdLayerId();

      this.m_board.SetLayerName(klayer, layer.name);

      if (layer.copperthick === 0)
        this.m_board.SetLayerType(klayer, LAYER_T.LT_JUMPER); // used for things like wirebonding
      else if (IsAltiumLayerAPlane(alayer)) this.m_board.SetLayerType(klayer, LAYER_T.LT_POWER);

      if (klayer === B_Cu) {
        if (layer.nextId !== 0)
          THROW_IO_ERROR('Board6 stream, unexpected id while parsing last stackup layer');

        // overwrite entry from internal -> bottom
        this.m_layermap.set(alayer, B_Cu);
        break;
      }

      ++it;

      if (list[it]!.GetType() !== BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC)
        THROW_IO_ERROR('Board6 stream, unexpected item while parsing stackup');

      list[it]!.SetThickness(layer.dielectricthick, 0);
      list[it]!.SetMaterial(
        layer.dielectricmaterial === '' ? NotSpecifiedPrm() : layer.dielectricmaterial,
      );
      list[it]!.SetEpsilonR(layer.dielectricconst, 0);

      if (layer.dielectriclosstangent > 0) list[it]!.SetLossTangent(layer.dielectriclosstangent, 0);

      ++it;
    }

    this.HelperFillMechanicalLayerAssignments(elem.stackup);
    this.remapUnsureLayers(elem.stackup);

    // Set name of all non-cu layers
    for (const layer of elem.stackup) {
      const alayer = layer.layerId as ALTIUM_LAYER;

      if (
        (alayer >= ALTIUM_LAYER.TOP_OVERLAY && alayer <= ALTIUM_LAYER.BOTTOM_SOLDER) ||
        (alayer >= ALTIUM_LAYER.MECHANICAL_1 && alayer <= ALTIUM_LAYER.MECHANICAL_16) ||
        (alayer >= ALTIUM_LAYER.V7_MECHANICAL_17 && alayer <= ALTIUM_LAYER.V7_MECHANICAL_LAST)
      ) {
        const klayer = this.GetKicadLayer(alayer);
        this.m_board.SetLayerName(klayer, layer.name);
      }
    }

    this.HelperCreateBoardOutline(elem.board_vertices);
    this.m_board.GetDesignSettings().SetBoardThickness(stackup.BuildBoardThicknessFromStackup());
  }

  private remapUnsureLayers(aStackup: ABOARD6_LAYER_STACKUP[]): void {
    let enabledLayers = new LSET(this.m_board.GetEnabledLayers());
    const validRemappingLayers = new LSET(enabledLayers)
      .or(LSET.AllBoardTechMask())
      .or(LSET.UserMask())
      .or(LSET.UserDefinedLayersMask());

    if (aStackup.length === 0) return;

    const inputLayers: INPUT_LAYER_DESC[] = [];
    const altiumLayerNameMap = new Map<string, ALTIUM_LAYER>();

    let layer_num: ALTIUM_LAYER;

    // Track which courtyard layers we've mapped to avoid duplicates
    let frontCourtyardMapped = false;
    let backCourtyardMapped = false;

    for (let ii = 0; ii < aStackup.length; ii++) {
      const curLayer = aStackup[ii]!;
      layer_num = curLayer.layerId as ALTIUM_LAYER;

      // Skip UI-only layers and pseudo-layers that have no physical representation
      if (
        layer_num === ALTIUM_LAYER.MULTI_LAYER ||
        layer_num === ALTIUM_LAYER.CONNECTIONS ||
        layer_num === ALTIUM_LAYER.BACKGROUND ||
        layer_num === ALTIUM_LAYER.DRC_ERROR_MARKERS ||
        layer_num === ALTIUM_LAYER.SELECTIONS ||
        layer_num === ALTIUM_LAYER.VISIBLE_GRID_1 ||
        layer_num === ALTIUM_LAYER.VISIBLE_GRID_2 ||
        layer_num === ALTIUM_LAYER.PAD_HOLES ||
        layer_num === ALTIUM_LAYER.VIA_HOLES
      ) {
        continue;
      }

      // Skip disabled mechanical layers (mapped to UNDEFINED_LAYER by
      // HelperFillMechanicalLayerAssignments)
      const existingMapping = this.m_layermap.get(layer_num);

      if (existingMapping !== undefined && existingMapping === UNDEFINED_LAYER) {
        continue;
      }

      // Skip unused copper layers not present in the board's stackup. Used copper layers
      // were added to m_layermap during stackup parsing; any copper layer not in the map
      // is unused and should not appear in the dialog.
      if (
        layer_num >= ALTIUM_LAYER.TOP_LAYER &&
        layer_num <= ALTIUM_LAYER.BOTTOM_LAYER &&
        existingMapping === undefined
      ) {
        continue;
      }

      // INPUT_LAYER_DESC iLdesc is declared once outside the loop upstream: an AutoMapLayer
      // not assigned below keeps the previous layer's.
      const iLdesc: INPUT_LAYER_DESC = {
        Name: '',
        PermittedLayers: new LSET(),
        AutoMapLayer: inputLayers.length
          ? inputLayers[inputLayers.length - 1]!.AutoMapLayer
          : UNDEFINED_LAYER,
        Required: true,
      };

      // Use existing mapping as auto-match default if available
      if (existingMapping !== undefined) {
        iLdesc.AutoMapLayer = existingMapping;
      }
      // Check if the layer name indicates a courtyard layer
      else if (IsLayerNameCourtyard(curLayer.name)) {
        const isTopSide = IsLayerNameTopSide(curLayer.name);

        if (isTopSide && !frontCourtyardMapped) {
          iLdesc.AutoMapLayer = F_CrtYd;
          frontCourtyardMapped = true;
        } else if (!isTopSide && !backCourtyardMapped) {
          iLdesc.AutoMapLayer = B_CrtYd;
          backCourtyardMapped = true;
        } else if (!frontCourtyardMapped) {
          iLdesc.AutoMapLayer = F_CrtYd;
          frontCourtyardMapped = true;
        } else if (!backCourtyardMapped) {
          iLdesc.AutoMapLayer = B_CrtYd;
          backCourtyardMapped = true;
        } else {
          iLdesc.AutoMapLayer = this.GetKicadLayer(layer_num);
        }
      }
      // Check if the layer name indicates an assembly layer (map to Fab)
      else if (IsLayerNameAssembly(curLayer.name)) {
        const isTopSide = IsLayerNameTopSide(curLayer.name);
        iLdesc.AutoMapLayer = isTopSide ? F_Fab : B_Fab;
      } else {
        iLdesc.AutoMapLayer = this.GetKicadLayer(layer_num);
      }

      iLdesc.Name = curLayer.name;
      iLdesc.PermittedLayers = validRemappingLayers;
      iLdesc.Required =
        layer_num >= ALTIUM_LAYER.TOP_LAYER && layer_num <= ALTIUM_LAYER.BOTTOM_LAYER;

      inputLayers.push(iLdesc);
      if (!altiumLayerNameMap.has(curLayer.name)) altiumLayerNameMap.set(curLayer.name, layer_num);
      if (!this.m_layerNames.has(layer_num)) this.m_layerNames.set(layer_num, curLayer.name);
    }

    if (inputLayers.length === 0) return;

    // Callback:
    const reMappedLayers = this.m_layerMappingHandler(inputLayers);

    for (const [name, layer] of sortedEntries(reMappedLayers)) {
      if (layer === UNDEFINED_LAYER) {
        // Layer mapping handler returned UNDEFINED_LAYER - skip this layer
        // This can happen for layers that don't have a KiCad equivalent
        this.report(
          `Layer '${name}' could not be mapped and will be skipped.`,
          RPT_SEVERITY_WARNING,
        );

        continue;
      }

      const altiumID = altiumLayerNameMap.get(name);
      if (altiumID === undefined) throw new RangeError('map::at');
      this.m_layermap.set(altiumID, layer);
      enabledLayers = enabledLayers.or(new LSET([layer]));
    }

    // Explicitly mark unmatched dialog layers as UNDEFINED_LAYER so they are not imported
    // via the GetKicadLayer() hardcoded switch fallthrough
    for (const [name, altLayer] of sortedEntries(altiumLayerNameMap)) {
      if (!reMappedLayers.has(name) || reMappedLayers.get(name) === UNDEFINED_LAYER) {
        this.m_layermap.set(altLayer, UNDEFINED_LAYER);
      }
    }

    this.m_board.SetEnabledLayers(enabledLayers);
    this.m_board.SetVisibleLayers(enabledLayers);
  }

  private HelperFillMechanicalLayerAssignments(aStackup: readonly ABOARD6_LAYER_STACKUP[]): void {
    for (const layer of aStackup) {
      const alayer = layer.layerId as ALTIUM_LAYER;

      if (
        (alayer >= ALTIUM_LAYER.MECHANICAL_1 && alayer <= ALTIUM_LAYER.MECHANICAL_16) ||
        (alayer >= ALTIUM_LAYER.V7_MECHANICAL_17 && alayer <= ALTIUM_LAYER.V7_MECHANICAL_LAST)
      ) {
        if (!layer.mechenabled) {
          // std::map::emplace: an existing entry stays
          if (!this.m_layermap.has(alayer)) this.m_layermap.set(alayer, UNDEFINED_LAYER); // Disabled layer, do not import
          continue;
        }

        let target: PCB_LAYER_ID = UNDEFINED_LAYER;

        switch (layer.mechkind) {
          case ALTIUM_MECHKIND.ASSEMBLY_TOP:
            target = F_Fab;
            break;
          case ALTIUM_MECHKIND.ASSEMBLY_BOT:
            target = B_Fab;
            break;

          case ALTIUM_MECHKIND.COURTYARD_TOP:
            target = F_CrtYd;
            break;
          case ALTIUM_MECHKIND.COURTYARD_BOT:
            target = B_CrtYd;
            break;

          case ALTIUM_MECHKIND.GLUE_POINTS_TOP:
            target = F_Adhes;
            break;
          case ALTIUM_MECHKIND.GLUE_POINTS_BOT:
            target = B_Adhes;
            break;

          case ALTIUM_MECHKIND.ASSEMBLY_NOTES:
            target = Cmts_User;
            break;
          case ALTIUM_MECHKIND.FAB_NOTES:
            target = Cmts_User;
            break;

          case ALTIUM_MECHKIND.DIMENSIONS:
            target = Dwgs_User;
            break;

          case ALTIUM_MECHKIND.DIMENSIONS_TOP:
            target = F_Fab;
            break;
          case ALTIUM_MECHKIND.DIMENSIONS_BOT:
            target = B_Fab;
            break;

          case ALTIUM_MECHKIND.VALUE_TOP:
            target = F_Fab;
            break;
          case ALTIUM_MECHKIND.VALUE_BOT:
            target = B_Fab;
            break;

          case ALTIUM_MECHKIND.DESIGNATOR_TOP:
            target = F_Fab;
            break;
          case ALTIUM_MECHKIND.DESIGNATOR_BOT:
            target = B_Fab;
            break;

          case ALTIUM_MECHKIND.COMPONENT_OUTLINE_TOP:
            target = F_Fab;
            break;
          case ALTIUM_MECHKIND.COMPONENT_OUTLINE_BOT:
            target = B_Fab;
            break;

          case ALTIUM_MECHKIND.COMPONENT_CENTER_TOP:
            target = F_Fab;
            break;
          case ALTIUM_MECHKIND.COMPONENT_CENTER_BOT:
            target = B_Fab;
            break;

          case ALTIUM_MECHKIND.BOARD:
            target = Edge_Cuts;
            break;
          case ALTIUM_MECHKIND.BOARD_SHAPE:
            target = Edge_Cuts;
            break;
          case ALTIUM_MECHKIND.V_CUT:
            target = Edge_Cuts;
            break;

          default:
            break;
        }

        if (target !== UNDEFINED_LAYER && !this.m_layermap.has(alayer))
          this.m_layermap.set(alayer, target);
      }
    }
  }

  private HelperCreateBoardOutline(aVertices: readonly ALTIUM_VERTICE[]): void {
    const lineChain = new SHAPE_LINE_CHAIN();
    HelperShapeLineChainFromAltiumVertices(lineChain, aVertices);

    const stroke = new STROKE_PARAMS(
      this.m_board.GetDesignSettings().GetLineThickness(Edge_Cuts),
      LINE_STYLE.SOLID,
    );

    for (let i = 0; i <= lineChain.PointCount() && i !== -1; i = lineChain.NextShape(i)) {
      if (lineChain.IsArcStart(i)) {
        const currentArc = lineChain.Arc(lineChain.ArcIndex(i));

        const shape = new PCB_SHAPE(this.m_board, SHAPE_T.ARC);

        shape.SetStroke(stroke);
        shape.SetLayer(Edge_Cuts);
        shape.SetArcGeometry(currentArc.GetP0(), currentArc.GetArcMid(), currentArc.GetP1());

        this.m_board.Add(shape, ADD_MODE.APPEND);
      } else {
        const seg = lineChain.Segment(i);

        const shape = new PCB_SHAPE(this.m_board, SHAPE_T.SEGMENT);

        shape.SetStroke(stroke);
        shape.SetLayer(Edge_Cuts);
        shape.SetStart(seg.A);
        shape.SetEnd(seg.B);

        this.m_board.Add(shape, ADD_MODE.APPEND);
      }
    }
  }

  private ParseClasses6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading netclasses...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    while (reader.GetRemainingBytes() >= 4 /* TODO: use Header section of file */) {
      this.checkpoint();
      const elem = new ACLASS6(reader);

      if (elem.kind === ALTIUM_CLASS_KIND.NET_CLASS) {
        const nc = new NETCLASS(elem.name);

        for (const name of elem.names) {
          this.m_board
            .GetDesignSettings()
            .m_NetSettings.SetNetclassPatternAssignment(name, nc.GetName());
        }

        if (this.m_board.GetDesignSettings().m_NetSettings.HasNetclass(nc.GetName())) {
          // Name conflict, happens in some unknown circumstances
          // unique_ptr will delete nc on this code path
          this.report(
            `More than one Altium netclass with name '${elem.name}' found. Only the first one will be imported.`,
            RPT_SEVERITY_ERROR,
          );
        } else {
          this.m_board.GetDesignSettings().m_NetSettings.SetNetclass(nc.GetName(), nc);
        }
      }
    }

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('Classes6 stream is not fully parsed');

    // Now that all netclasses and pattern assignments are set up, resolve the pattern
    // assignments to direct netclass assignments on each net.
    const netSettings = this.m_board.GetDesignSettings().m_NetSettings;

    for (const net of this.m_board.GetNetInfo()) {
      if (net.GetNetCode() > 0) {
        const netclass = netSettings.GetEffectiveNetClass(net.GetNetname());

        if (netclass) net.SetNetClass(netclass);
      }
    }

    this.m_board.m_LegacyNetclassesLoaded = true;
  }

  private ParseComponents6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading components...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    while (reader.GetRemainingBytes() >= 4 /* TODO: use Header section of file */) {
      this.checkpoint();
      const elem = new ACOMPONENT6(reader);

      const footprint = new FOOTPRINT(this.m_board);

      // Altium stores the footprint library information needed to find the footprint in the
      // source library in the sourcefootprintlibrary field.  Since Altium is a Windows-only
      // program, the path separator is always a backslash.  We need strip the extra path information
      // here to prevent overly-long LIB_IDs because KiCad doesn't store the full path to the
      // footprint library in the design file, only in a library table.
      const libName = winPathName(elem.sourcefootprintlibrary);

      // The pattern field may also contain a path when Altium stores it with a full library path.
      // Extract just the footprint name portion to avoid creating invalid filenames.
      let fpName = elem.pattern;

      if (fpName.includes('\\') || fpName.includes('/')) {
        fpName = winPathName(fpName).fullName;
      }

      const fpID = AltiumToKiCadLibID(libName.name, fpName);

      footprint.SetFPID(fpID);

      footprint.SetPosition(elem.position);
      footprint.SetOrientationDegrees(elem.rotation);

      // KiCad netlisting requires parts to have non-digit + digit annotation.
      // If the reference begins with a number, we prepend 'UNK' (unknown) for the source designator
      let reference = elem.sourcedesignator;

      if (/^[0-9]*$/.test(reference)) reference = `UNK${reference}`;

      footprint.SetReference(reference);

      const id = AltiumUniqueIdToKiid(elem.sourceUniqueID);
      const pathid = kiidFromString(elem.sourceHierachicalPath);
      const path = new KIID_PATH();
      path.push_back(pathid);
      path.push_back(id);

      footprint.SetPath(path.steps());
      footprint.SetSheetname(elem.sourceHierachicalPath);
      footprint.SetSheetfile(`${elem.sourceHierachicalPath}.kicad_sch`);

      footprint.SetLocked(elem.locked);
      footprint.Reference().SetVisible(elem.nameon);
      footprint.Value().SetVisible(elem.commenton);
      footprint.SetLayer(elem.layer === ALTIUM_LAYER.TOP_LAYER ? F_Cu : B_Cu);

      this.m_components.push(footprint);
      this.m_board.Add(footprint, ADD_MODE.APPEND);
    }

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('Components6 stream is not fully parsed');
  }

  private ConvertComponentBody6ToFootprintItem(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aFootprint: FOOTPRINT,
    aElem: ACOMPONENTBODY6,
  ): void {
    this.m_progressReporter?.Report('Loading component 3D models...');

    if (!aElem.modelIsEmbedded) return;

    const model = aAltiumPcbFile.GetLibModel(aElem.modelId);

    if (!model) {
      this.report(
        `Model ${aElem.modelId} not found for footprint ${aFootprint.GetReference()}`,
        RPT_SEVERITY_ERROR,
      );

      return;
    }

    const file = new EMBEDDED_FILE();
    file.name = aElem.modelName;

    if (file.name === '') file.name = model[0].name;

    // Decompress the model data before assigning
    file.decompressedData = inflateZlib(model[1]);
    file.type = FILE_TYPE.MODEL;

    EMBEDDED_FILES.CompressAndEncode(file);
    aFootprint.GetEmbeddedFiles().AddFile(file);

    const modelSettings = new FP_3DMODEL();

    modelSettings.m_Filename = aFootprint.GetEmbeddedFiles().GetEmbeddedFileLink(file);

    modelSettings.m_Offset.x = pcbIUScale.iuToMM(Math.trunc(aElem.modelPosition.x));
    modelSettings.m_Offset.y = -pcbIUScale.iuToMM(Math.trunc(aElem.modelPosition.y));
    modelSettings.m_Offset.z = pcbIUScale.iuToMM(Math.trunc(aElem.modelPosition.z));

    let orientation = aFootprint.GetOrientation();

    if (aFootprint.IsFlipped()) {
      modelSettings.m_Offset.y = -modelSettings.m_Offset.y;
      orientation = orientation.negate();
    }

    const modelRotation = { ...aElem.modelRotation };

    if ((aElem.body_projection === 1) !== aFootprint.IsFlipped()) {
      modelRotation.x += 180;
      modelRotation.z = -modelRotation.z;

      modelSettings.m_Offset.z = -DEFAULT_BOARD_THICKNESS_MM - modelSettings.m_Offset.z;
    }

    const rotated = RotatePointD(
      { x: modelSettings.m_Offset.x, y: modelSettings.m_Offset.y },
      orientation,
    );
    modelSettings.m_Offset.x = rotated.x;
    modelSettings.m_Offset.y = rotated.y;

    modelSettings.m_Rotation.x = normalizeAngleDegrees(-modelRotation.x, -180, 180);
    modelSettings.m_Rotation.y = normalizeAngleDegrees(-modelRotation.y, -180, 180);
    modelSettings.m_Rotation.z = normalizeAngleDegrees(
      -modelRotation.z + aElem.rotation + orientation.AsDegrees(),
      -180,
      180,
    );
    modelSettings.m_Opacity = aElem.body_opacity_3d;

    aFootprint.Models().push(modelSettings);
  }

  private ParseComponentsBodies6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading component 3D models...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    while (reader.GetRemainingBytes() >= 4 /* TODO: use Header section of file */) {
      this.checkpoint();
      const elem = new ACOMPONENTBODY6(reader);

      // ADVANCED_CFG::GetCfg().m_ImportSkipComponentBodies defaults to false

      if (elem.component === ALTIUM_COMPONENT_NONE) continue; // TODO: we do not support components for the board yet

      if (this.m_components.length <= elem.component) {
        THROW_IO_ERROR(
          `ComponentsBodies6 stream tries to access component id ${elem.component} of ${this.m_components.length} existing components`,
        );
      }

      if (!elem.modelIsEmbedded) continue;

      const modelData = this.m_EmbeddedModels.get(elem.modelId);

      if (modelData === undefined) {
        this.report(
          `ComponentsBodies6 stream tries to access model id ${elem.modelId} which does not exist`,
          RPT_SEVERITY_ERROR,
        );

        continue;
      }

      const footprint = this.m_components[elem.component]!;

      const file = new EMBEDDED_FILE();
      file.name = modelData.m_modelname;

      file.decompressedData = inflateZlib(modelData.m_data);

      footprint.GetEmbeddedFiles().AddFile(file);

      EMBEDDED_FILES.CompressAndEncode(file);

      const modelSettings = new FP_3DMODEL();

      modelSettings.m_Filename = footprint.GetEmbeddedFiles().GetEmbeddedFileLink(file);
      const fpPosition = footprint.GetPosition();

      modelSettings.m_Offset.x = pcbIUScale.iuToMM(KiROUND(elem.modelPosition.x - fpPosition.x));
      modelSettings.m_Offset.y = -pcbIUScale.iuToMM(KiROUND(elem.modelPosition.y - fpPosition.y));
      modelSettings.m_Offset.z = pcbIUScale.iuToMM(KiROUND(elem.modelPosition.z));

      let orientation = footprint.GetOrientation();

      if (footprint.IsFlipped()) {
        modelSettings.m_Offset.y = -modelSettings.m_Offset.y;
        orientation = orientation.negate();
      }

      if ((elem.body_projection === 1) !== footprint.IsFlipped()) {
        elem.modelRotation.x += 180;
        elem.modelRotation.z = -elem.modelRotation.z;

        modelSettings.m_Offset.z =
          -pcbIUScale.iuToMM(this.m_board.GetDesignSettings().GetBoardThickness()) -
          modelSettings.m_Offset.z;
      }

      const rotated = RotatePointD(
        { x: modelSettings.m_Offset.x, y: modelSettings.m_Offset.y },
        orientation,
      );
      modelSettings.m_Offset.x = rotated.x;
      modelSettings.m_Offset.y = rotated.y;

      modelSettings.m_Rotation.x = normalizeAngleDegrees(-elem.modelRotation.x, -180, 180);
      modelSettings.m_Rotation.y = normalizeAngleDegrees(-elem.modelRotation.y, -180, 180);
      modelSettings.m_Rotation.z = normalizeAngleDegrees(
        -elem.modelRotation.z + elem.rotation + orientation.AsDegrees(),
        -180,
        180,
      );

      modelSettings.m_Opacity = elem.body_opacity_3d;

      footprint.Models().push(modelSettings);
    }

    if (reader.GetRemainingBytes() !== 0)
      THROW_IO_ERROR('ComponentsBodies6 stream is not fully parsed');
  }

  private HelperParseDimensions6Linear(aElem: ADIMENSION6): void {
    if (aElem.referencePoint.length !== 2)
      THROW_IO_ERROR('Incorrect number of reference points for linear dimension object');

    let klayer = this.GetKicadLayer(aElem.layer);

    if (klayer === UNDEFINED_LAYER) {
      this.report(
        `Dimension found on an Altium layer (${aElem.layer}) with no KiCad equivalent. It has been moved to KiCad layer Eco1_User.`,
        RPT_SEVERITY_INFO,
      );

      klayer = Eco1_User;
    }

    const referencePoint0 = aElem.referencePoint[0]!;
    const referencePoint1 = aElem.referencePoint[1]!;

    const dimension = new PCB_DIM_ALIGNED(this.m_board, KICAD_T.PCB_DIM_ALIGNED_T);

    dimension.SetPrecision(aElem.textprecision as DIM_PRECISION);
    dimension.SetLayer(klayer);
    dimension.SetStart(referencePoint0);

    if (!equal(referencePoint0, aElem.xy1)) {
      /**
       * Basically REFERENCE0POINT and REFERENCE1POINT are the two end points of the dimension.
       * XY1 is the position of the arrow above REFERENCE0POINT. those three points are not
       * necessarily in 90degree angle, but KiCad requires this to show the correct measurements.
       *
       * Therefore, we take the vector of REFERENCE0POINT -> XY1, calculate the normal, and
       * intersect it with REFERENCE1POINT pointing the same direction as REFERENCE0POINT -> XY1.
       * This should give us a valid measurement point where we can place the drawsegment.
       */
      const direction = sub(aElem.xy1, referencePoint0);
      const referenceDiff = sub(referencePoint1, referencePoint0);
      const directionNormalVector = Perpendicular(direction);
      const segm1 = new SEG(referencePoint0, add(referencePoint0, directionNormalVector));
      const segm2 = new SEG(referencePoint1, add(referencePoint1, direction));
      const intersection = segm1.Intersect(segm2, true, true);

      if (!intersection) THROW_IO_ERROR('Invalid dimension.  This should never happen.');

      dimension.SetEnd(intersection);

      let height = EuclideanNormI(direction);

      // VECTOR2I::Cross: int64 x1*y2 - y1*x2
      if (direction.x * referenceDiff.y - direction.y * referenceDiff.x > 0) height = -height;

      dimension.SetHeight(height);
    } else {
      dimension.SetEnd(referencePoint1);
    }

    dimension.SetLineThickness(aElem.linewidth | 0);

    dimension.SetUnitsFormat(DIM_UNITS_FORMAT.NO_SUFFIX);
    dimension.SetPrefix(aElem.textprefix);

    const dist = EuclideanNormI(sub(dimension.GetEnd(), dimension.GetStart()));

    if (dist < 3 * dimension.GetArrowLength())
      dimension.SetArrowDirection(DIM_ARROW_DIRECTION.INWARD);

    // Suffix normally (but not always) holds the units
    const units = /(mm)|(in)|(mils)|(thou)|(')|(")/;

    if (units.test(aElem.textsuffix)) dimension.SetUnitsFormat(DIM_UNITS_FORMAT.BARE_SUFFIX);
    else dimension.SetSuffix(aElem.textsuffix);

    dimension.SetTextThickness(aElem.textlinewidth | 0);
    dimension.SetTextSize({ x: aElem.textheight | 0, y: aElem.textheight | 0 });
    dimension.SetItalic(aElem.textitalic);

    // we don't currently support bold; map to thicker text
    if (aElem.textbold)
      dimension.SetTextThickness(Math.trunc(dimension.GetTextThickness() * BOLD_FACTOR));

    switch (aElem.textunit) {
      case ALTIUM_UNIT.INCH:
        dimension.SetUnits('in');
        break;
      case ALTIUM_UNIT.MILS:
        dimension.SetUnits('mils');
        break;
      case ALTIUM_UNIT.MM:
        dimension.SetUnits('mm');
        break;
      case ALTIUM_UNIT.CM:
        dimension.SetUnits('mm');
        break;
      default:
        break;
    }

    this.m_board.Add(dimension, ADD_MODE.APPEND);
  }

  private HelperParseDimensions6Radial(aElem: ADIMENSION6): void {
    if (aElem.referencePoint.length < 2)
      THROW_IO_ERROR('Not enough reference points for radial dimension object');

    let klayer = this.GetKicadLayer(aElem.layer);

    if (klayer === UNDEFINED_LAYER) {
      this.report(
        `Dimension found on an Altium layer (${aElem.layer}) with no KiCad equivalent. It has been moved to KiCad layer Eco1_User.`,
        RPT_SEVERITY_INFO,
      );

      klayer = Eco1_User;
    }

    const referencePoint0 = aElem.referencePoint[0]!;

    const dimension = new PCB_DIM_RADIAL(this.m_board);

    dimension.SetPrecision(aElem.textprecision as DIM_PRECISION);
    dimension.SetLayer(klayer);
    dimension.SetStart(referencePoint0);
    dimension.SetEnd(aElem.xy1);
    dimension.SetLineThickness(aElem.linewidth | 0);
    dimension.SetKeepTextAligned(false);

    dimension.SetPrefix(aElem.textprefix);

    // Suffix normally holds the units
    dimension.SetUnitsFormat(
      aElem.textsuffix === '' ? DIM_UNITS_FORMAT.NO_SUFFIX : DIM_UNITS_FORMAT.BARE_SUFFIX,
    );

    switch (aElem.textunit) {
      case ALTIUM_UNIT.INCH:
        dimension.SetUnits('in');
        break;
      case ALTIUM_UNIT.MILS:
        dimension.SetUnits('mils');
        break;
      case ALTIUM_UNIT.MM:
        dimension.SetUnits('mm');
        break;
      case ALTIUM_UNIT.CM:
        dimension.SetUnits('mm');
        break;
      default:
        break;
    }

    if (aElem.textPoint.length === 0) {
      this.report('No text position present for leader dimension object', RPT_SEVERITY_ERROR);

      return;
    }

    dimension.SetTextPos(aElem.textPoint[0]!);
    dimension.SetTextThickness(aElem.textlinewidth | 0);
    dimension.SetTextSize({ x: aElem.textheight | 0, y: aElem.textheight | 0 });
    dimension.SetItalic(aElem.textitalic);

    // we don't currently support bold; map to thicker text
    if (aElem.textbold)
      dimension.SetTextThickness(Math.trunc(dimension.GetTextThickness() * BOLD_FACTOR));

    // It's unclear exactly how Altium figures it's text positioning, but this gets us reasonably
    // close.
    dimension.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
    dimension.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);

    const yAdjust = dimension.GetTextBox(null).GetCenter().y - dimension.GetTextPos().y;
    dimension.SetTextPos(add(dimension.GetTextPos(), { x: 0, y: yAdjust + (aElem.textgap | 0) }));
    dimension.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);

    this.m_radialDimensions.push(dimension);
    this.m_board.Add(dimension, ADD_MODE.APPEND);
  }

  private HelperParseDimensions6Leader(aElem: ADIMENSION6): void {
    let klayer = this.GetKicadLayer(aElem.layer);

    if (klayer === UNDEFINED_LAYER) {
      this.report(
        `Dimension found on an Altium layer (${aElem.layer}) with no KiCad equivalent. It has been moved to KiCad layer Eco1_User.`,
        RPT_SEVERITY_ERROR,
      );

      klayer = Eco1_User;
    }

    if (aElem.referencePoint.length !== 0) {
      const referencePoint0 = aElem.referencePoint[0]!;

      // line
      let last = referencePoint0;
      for (let i = 1; i < aElem.referencePoint.length; i++) {
        const shape = new PCB_SHAPE(this.m_board, SHAPE_T.SEGMENT);

        shape.SetLayer(klayer);
        shape.SetStroke(new STROKE_PARAMS(aElem.linewidth | 0, LINE_STYLE.SOLID));
        shape.SetStart(last);
        shape.SetEnd(aElem.referencePoint[i]!);
        last = aElem.referencePoint[i]!;

        this.m_board.Add(shape, ADD_MODE.APPEND);
      }

      // arrow
      if (aElem.referencePoint.length >= 2) {
        const dirVec = sub(aElem.referencePoint[1]!, referencePoint0);

        if (dirVec.x !== 0 || dirVec.y !== 0) {
          const scaling = EuclideanNormI(dirVec) / aElem.arrowsize;
          let arrVec = { x: KiROUND(dirVec.x / scaling), y: KiROUND(dirVec.y / scaling) };
          arrVec = RotatePoint(arrVec, new EDA_ANGLE(20.0));

          {
            const shape1 = new PCB_SHAPE(this.m_board, SHAPE_T.SEGMENT);

            shape1.SetLayer(klayer);
            shape1.SetStroke(new STROKE_PARAMS(aElem.linewidth | 0, LINE_STYLE.SOLID));
            shape1.SetStart(referencePoint0);
            shape1.SetEnd(add(referencePoint0, arrVec));

            this.m_board.Add(shape1, ADD_MODE.APPEND);
          }

          arrVec = RotatePoint(arrVec, new EDA_ANGLE(-40.0));

          {
            const shape2 = new PCB_SHAPE(this.m_board, SHAPE_T.SEGMENT);

            shape2.SetLayer(klayer);
            shape2.SetStroke(new STROKE_PARAMS(aElem.linewidth | 0, LINE_STYLE.SOLID));
            shape2.SetStart(referencePoint0);
            shape2.SetEnd(add(referencePoint0, arrVec));

            this.m_board.Add(shape2, ADD_MODE.APPEND);
          }
        }
      }
    }

    if (aElem.textPoint.length === 0) {
      this.report('No text position present for leader dimension object', RPT_SEVERITY_ERROR);

      return;
    }

    const text = new PCB_TEXT(this.m_board);

    text.SetText(aElem.textformat);
    text.SetPosition(aElem.textPoint[0]!);
    text.SetLayer(klayer);
    text.SetTextSize({ x: aElem.textheight | 0, y: aElem.textheight | 0 }); // TODO: parse text width
    text.SetTextThickness(aElem.textlinewidth | 0);
    text.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
    text.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);

    this.m_board.Add(text, ADD_MODE.APPEND);
  }

  private HelperParseDimensions6Datum(aElem: ADIMENSION6): void {
    let klayer = this.GetKicadLayer(aElem.layer);

    if (klayer === UNDEFINED_LAYER) {
      this.report(
        `Dimension found on an Altium layer (${aElem.layer}) with no KiCad equivalent. It has been moved to KiCad layer Eco1_User.`,
        RPT_SEVERITY_INFO,
      );

      klayer = Eco1_User;
    }

    for (const referencePoint of aElem.referencePoint) {
      const shape = new PCB_SHAPE(this.m_board, SHAPE_T.SEGMENT);

      shape.SetLayer(klayer);
      shape.SetStroke(new STROKE_PARAMS(aElem.linewidth | 0, LINE_STYLE.SOLID));
      shape.SetStart(referencePoint);
      // shape->SetEnd( /* TODO: seems to be based on TEXTY */ );

      this.m_board.Add(shape, ADD_MODE.APPEND);
    }
  }

  private HelperParseDimensions6Center(aElem: ADIMENSION6): void {
    let klayer = this.GetKicadLayer(aElem.layer);

    if (klayer === UNDEFINED_LAYER) {
      this.report(
        `Dimension found on an Altium layer (${aElem.layer}) with no KiCad equivalent. It has been moved to KiCad layer Eco1_User.`,
        RPT_SEVERITY_INFO,
      );

      klayer = Eco1_User;
    }

    let vec = { x: 0, y: Math.trunc(aElem.height / 2) };
    vec = RotatePoint(vec, new EDA_ANGLE(aElem.angle));

    const dimension = new PCB_DIM_CENTER(this.m_board);

    dimension.SetLayer(klayer);
    dimension.SetLineThickness(aElem.linewidth | 0);
    dimension.SetStart(aElem.xy1);
    dimension.SetEnd(add(aElem.xy1, vec));

    this.m_board.Add(dimension, ADD_MODE.APPEND);
  }

  private ParseDimensions6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading dimension drawings...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    while (reader.GetRemainingBytes() >= 4 /* TODO: use Header section of file */) {
      this.checkpoint();
      const elem = new ADIMENSION6(reader);

      switch (elem.kind) {
        case ALTIUM_DIMENSION_KIND.LINEAR:
          this.HelperParseDimensions6Linear(elem);
          break;
        case ALTIUM_DIMENSION_KIND.ANGULAR:
          this.report('Ignored Angular dimension (not yet supported).', RPT_SEVERITY_INFO);
          break;
        case ALTIUM_DIMENSION_KIND.RADIAL:
          this.HelperParseDimensions6Radial(elem);
          break;
        case ALTIUM_DIMENSION_KIND.LEADER:
          this.HelperParseDimensions6Leader(elem);
          break;
        case ALTIUM_DIMENSION_KIND.DATUM:
          this.report('Ignored Datum dimension (not yet supported).', RPT_SEVERITY_INFO);
          // HelperParseDimensions6Datum( elem );
          break;
        case ALTIUM_DIMENSION_KIND.BASELINE:
          this.report('Ignored Baseline dimension (not yet supported).', RPT_SEVERITY_INFO);
          break;
        case ALTIUM_DIMENSION_KIND.CENTER:
          this.HelperParseDimensions6Center(elem);
          break;
        case ALTIUM_DIMENSION_KIND.LINEAR_DIAMETER:
          this.report('Ignored Linear dimension (not yet supported).', RPT_SEVERITY_INFO);
          break;
        case ALTIUM_DIMENSION_KIND.RADIAL_DIAMETER:
          this.report('Ignored Radial dimension (not yet supported).', RPT_SEVERITY_INFO);
          break;
        default:
          this.report(
            `Ignored dimension of kind ${elem.kind} (not yet supported).`,
            RPT_SEVERITY_INFO,
          );
          break;
      }
    }

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('Dimensions6 stream is not fully parsed');
  }

  private ParseModelsData(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
    aRootDir: readonly string[],
  ): void {
    this.m_progressReporter?.Report('Loading 3D models...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    if (reader.GetRemainingBytes() === 0) return;

    let idx = 0;
    const invalidChars = FORBIDDEN_CHARS;

    while (reader.GetRemainingBytes() >= 4 /* TODO: use Header section of file */) {
      this.checkpoint();
      const elem = new AMODEL(reader);

      const stepPath = [...aRootDir, String(idx)];

      const validName =
        elem.name !== '' &&
        // wxString::IsAscii
        [...elem.name].every((c) => c.charCodeAt(0) < 0x80) &&
        ![...elem.name].some((c) => invalidChars.includes(c));
      const storageName = validName ? elem.name : `model_${idx}`;

      idx++;

      const stepEntry = aAltiumPcbFile.FindStream(stepPath);

      if (stepEntry === null) {
        this.report(
          `File not found: '${FormatPath(stepPath)}'. 3D-model not imported.`,
          RPT_SEVERITY_ERROR,
        );

        continue;
      }

      const stepSize = stepEntry.size;
      const stepContent = new Uint8Array(stepSize);

      // read file into buffer
      aAltiumPcbFile.GetCompoundFileReader().ReadFile(stepEntry, 0, stepContent, stepSize);

      // std::map::insert: the first model for an id stays
      if (!this.m_EmbeddedModels.has(elem.id)) {
        this.m_EmbeddedModels.set(
          elem.id,
          new ALTIUM_EMBEDDED_MODEL_DATA(storageName, elem.rotation, elem.z_offset, stepContent),
        );
      }
    }

    // Append _<index> to duplicate filenames
    const nameIdMap = new Map<string, string[]>();

    for (const [id, data] of sortedEntries(this.m_EmbeddedModels)) {
      const ids = nameIdMap.get(data.m_modelname);
      if (ids) ids.push(id);
      else nameIdMap.set(data.m_modelname, [id]);
    }

    for (const [, ids] of sortedEntries(nameIdMap)) {
      for (let i = 1; i < ids.length; i++) {
        const id = ids[i]!;

        const modelTuple = this.m_EmbeddedModels.get(id);

        if (modelTuple === undefined) continue;

        const modelName = modelTuple.m_modelname;

        if (modelName.includes('.')) {
          const dot = modelName.lastIndexOf('.');
          const baseName = modelName.substring(0, dot);
          const ext = modelName.substring(dot + 1);

          modelTuple.m_modelname = `${baseName}_${i}.${ext}`;
        } else {
          modelTuple.m_modelname = `${modelName}_${i}`;
        }
      }
    }

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('Models stream is not fully parsed');
  }

  private ParseNets6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading nets...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    console.assert(this.m_altiumToKicadNetcodes.length === 0);

    while (reader.GetRemainingBytes() >= 4 /* TODO: use Header section of file */) {
      this.checkpoint();
      const elem = new ANET6(reader);

      const netInfo = new NETINFO_ITEM(this.m_board, elem.name, -1);
      this.m_board.Add(netInfo, ADD_MODE.APPEND);

      // needs to be called after m_board->Add() as assign us the NetCode
      this.m_altiumToKicadNetcodes.push(netInfo.GetNetCode());
    }

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('Nets6 stream is not fully parsed');
  }

  private ParsePolygons6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading polygons...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    while (reader.GetRemainingBytes() >= 4 /* TODO: use Header section of file */) {
      this.checkpoint();
      const elem = new APOLYGON6(reader);

      const linechain = new SHAPE_LINE_CHAIN();
      HelperShapeLineChainFromAltiumVertices(linechain, elem.vertices);

      if (linechain.PointCount() < 3) {
        // We have found multiple Altium files with polygon records containing nothing but two
        // coincident vertices.  These polygons do not appear when opening the file in Altium.
        // https://gitlab.com/kicad/code/kicad/-/issues/8183
        // Also, polygons with less than 3 points are not supported in KiCad.
        this.m_polygons.push(null);
        continue;
      }

      const outline = new SHAPE_POLY_SET(linechain);

      if (elem.hatchstyle !== ALTIUM_POLYGON_HATCHSTYLE.SOLID) {
        // Altium "Hatched" or "None" polygon outlines have thickness, convert it to KiCad's representation.
        outline.Inflate(
          Math.trunc(elem.trackwidth / 2),
          CornerStrategy.CHAMFER_ACUTE_CORNERS,
          ARC_HIGH_DEF,
          true,
        );
      }

      if (outline.OutlineCount() !== 1) {
        this.report(
          `Polygon outline count is ${outline.OutlineCount()}, expected 1.`,
          RPT_SEVERITY_ERROR,
        );
      }

      if (outline.OutlineCount() === 0) continue;

      const zone = new ZONE(this.m_board);

      // Be sure to set the zone layer before setting the net code
      // so that we know that this is a copper zone and so needs a valid net code.
      this.HelperSetZoneLayers(zone, elem.layer);
      zone.SetNetCode(this.GetNetCode(elem.net));
      zone.SetPosition(elem.vertices[0]!.position);
      zone.SetLocked(elem.locked);
      zone.SetAssignedPriority(elem.pourindex > 0 ? elem.pourindex : 0);
      zone.Outline().AddOutline(outline.Outline(0));

      if (elem.pourindex > this.m_highest_pour_index) this.m_highest_pour_index = elem.pourindex;

      const planeClearanceRule = this.GetRuleForPolygon(ALTIUM_RULE_KIND.PLANE_CLEARANCE);
      const zoneClearanceRule = this.GetRuleForPolygon(ALTIUM_RULE_KIND.CLEARANCE);
      let planeLayers = 0;
      let signalLayers = 0;
      let clearance = 0;

      for (const layer of zone.GetLayerSet()) {
        const layerType = this.m_board.GetLayerType(layer);

        if (layerType === LAYER_T.LT_POWER || layerType === LAYER_T.LT_MIXED) planeLayers++;

        if (layerType === LAYER_T.LT_SIGNAL || layerType === LAYER_T.LT_MIXED) signalLayers++;
      }

      if (planeLayers > 0 && planeClearanceRule)
        clearance = Math.max(clearance, planeClearanceRule.planeclearanceClearance);

      if (signalLayers > 0 && zoneClearanceRule)
        clearance = Math.max(clearance, zoneClearanceRule.clearanceGap);

      if (clearance > 0) zone.SetLocalClearance(clearance);

      const polygonConnectRule = this.GetRuleForPolygon(ALTIUM_RULE_KIND.POLYGON_CONNECT);

      if (polygonConnectRule !== null) {
        switch (polygonConnectRule.polygonconnectStyle) {
          case ALTIUM_CONNECT_STYLE.DIRECT:
            zone.SetPadConnection(ZONE_CONNECTION.FULL);
            break;

          case ALTIUM_CONNECT_STYLE.NONE:
            zone.SetPadConnection(ZONE_CONNECTION.NONE);
            break;

          default:
          case ALTIUM_CONNECT_STYLE.RELIEF:
            zone.SetPadConnection(ZONE_CONNECTION.THERMAL);
            break;
        }

        // TODO: correct variables?
        zone.SetThermalReliefSpokeWidth(polygonConnectRule.polygonconnectReliefconductorwidth);
        zone.SetThermalReliefGap(polygonConnectRule.polygonconnectAirgapwidth);

        if (polygonConnectRule.polygonconnectReliefconductorwidth < zone.GetMinThickness())
          zone.SetMinThickness(polygonConnectRule.polygonconnectReliefconductorwidth);
      }

      if (IsAltiumLayerAPlane(elem.layer)) {
        // outer zone will be set to priority 0 later.
        zone.SetAssignedPriority(1);

        // check if this is the outer zone by simply comparing the BBOX
        const outer_plane = this.m_outer_plane.get(elem.layer);
        if (
          outer_plane === undefined ||
          zone.GetBoundingBox().Contains(outer_plane.GetBoundingBox())
        ) {
          this.m_outer_plane.set(elem.layer, zone);
        }
      }

      if (
        elem.hatchstyle !== ALTIUM_POLYGON_HATCHSTYLE.SOLID &&
        elem.hatchstyle !== ALTIUM_POLYGON_HATCHSTYLE.UNKNOWN
      ) {
        zone.SetFillMode(ZONE_FILL_MODE.HATCH_PATTERN);
        zone.SetHatchThickness(elem.trackwidth);

        if (elem.hatchstyle === ALTIUM_POLYGON_HATCHSTYLE.NONE) {
          // use a small hack to get us only an outline (hopefully)
          const bbox = zone.GetBoundingBox();
          zone.SetHatchGap(Math.max(bbox.GetHeight(), bbox.GetWidth()));
        } else {
          zone.SetHatchGap(elem.gridsize - elem.trackwidth);
        }

        if (elem.hatchstyle === ALTIUM_POLYGON_HATCHSTYLE.DEGREE_45)
          zone.SetHatchOrientation(ANGLE_45);
      }

      zone.SetBorderDisplayStyle(
        ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
        ZONE.GetDefaultHatchPitch(),
        true,
      );

      this.m_polygons.push(zone);
      this.m_board.Add(zone, ADD_MODE.APPEND);
    }

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('Polygons6 stream is not fully parsed');
  }

  private ParseRules6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading rules...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    while (reader.GetRemainingBytes() >= 4 /* TODO: use Header section of file */) {
      this.checkpoint();
      const elem = new ARULE6(reader);

      const list = this.m_rules.get(elem.kind);
      if (list) list.push(elem);
      else this.m_rules.set(elem.kind, [elem]);
    }

    // Sort by ARULE6::priority ascending. Altium priority 1 is the most specific, so the
    // first element after sorting is the highest-priority Altium rule.
    //
    // std::sort is not stable; for equal priorities its introsort keeps the input order on
    // the short (<=16) runs insertion sort handles, which is every rule list seen in practice.
    for (const [, val] of this.m_rules) val.sort((lhs, rhs) => lhs.priority - rhs.priority);

    const clearanceRule = this.GetRuleDefault(ALTIUM_RULE_KIND.CLEARANCE);
    const trackWidthRule = this.GetRuleDefault(ALTIUM_RULE_KIND.WIDTH);
    const routingViasRule = this.GetRuleDefault(ALTIUM_RULE_KIND.ROUTING_VIAS);
    const holeToHoleRule = this.GetRuleDefault(ALTIUM_RULE_KIND.HOLE_TO_HOLE_CLEARANCE);

    if (clearanceRule) this.m_board.GetDesignSettings().m_MinClearance = clearanceRule.clearanceGap;

    if (trackWidthRule) {
      this.m_board.GetDesignSettings().m_TrackMinWidth = trackWidthRule.minLimit;
      // TODO: construct a custom rule for preferredWidth and maxLimit values
    }

    if (routingViasRule) {
      this.m_board.GetDesignSettings().m_ViasMinSize = routingViasRule.minWidth;
      this.m_board.GetDesignSettings().m_MinThroughDrill = routingViasRule.minHoleWidth;
    }

    // holeSizeRule: TODO: construct a custom rule for minLimit / maxLimit values

    if (holeToHoleRule)
      this.m_board.GetDesignSettings().m_HoleToHoleMin = holeToHoleRule.clearanceGap;

    const soldermaskRule = this.GetRuleDefault(ALTIUM_RULE_KIND.SOLDER_MASK_EXPANSION);
    const pastemaskRule = this.GetRuleDefault(ALTIUM_RULE_KIND.PASTE_MASK_EXPANSION);

    if (soldermaskRule)
      this.m_board.GetDesignSettings().m_SolderMaskExpansion = soldermaskRule.soldermaskExpansion;

    if (pastemaskRule)
      this.m_board.GetDesignSettings().m_SolderPasteMargin = pastemaskRule.pastemaskExpansion;

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('Rules6 stream is not fully parsed');
  }

  private ParseBoardRegionsData(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading board regions...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    while (reader.GetRemainingBytes() >= 4 /* TODO: use Header section of file */) {
      this.checkpoint();
      new AREGION6(reader, false);

      // TODO: implement?
    }

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('BoardRegions stream is not fully parsed');
  }

  private ParseShapeBasedRegions6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading polygons...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    /* TODO: use Header section of file */
    for (let primitiveIndex = 0; reader.GetRemainingBytes() >= 4; primitiveIndex++) {
      this.checkpoint();
      const elem = new AREGION6(reader, true);

      if (
        elem.component === ALTIUM_COMPONENT_NONE ||
        elem.kind === ALTIUM_REGION_KIND.BOARD_CUTOUT
      ) {
        // TODO: implement all different types for footprints
        this.ConvertShapeBasedRegions6ToBoardItem(elem);
      } else {
        const footprint = this.HelperGetFootprint(elem.component);
        this.ConvertShapeBasedRegions6ToFootprintItem(footprint, elem, primitiveIndex);
      }
    }

    if (reader.GetRemainingBytes() !== 0)
      THROW_IO_ERROR('ShapeBasedRegions6 stream is not fully parsed');
  }

  private ConvertShapeBasedRegions6ToBoardItem(aElem: AREGION6): void {
    if (aElem.kind === ALTIUM_REGION_KIND.BOARD_CUTOUT) {
      this.HelperCreateBoardOutline(aElem.outline);
    } else if (aElem.kind === ALTIUM_REGION_KIND.POLYGON_CUTOUT || aElem.is_keepout) {
      const linechain = new SHAPE_LINE_CHAIN();
      HelperShapeLineChainFromAltiumVertices(linechain, aElem.outline);

      if (linechain.PointCount() < 3) {
        // We have found multiple Altium files with polygon records containing nothing but
        // two coincident vertices.  These polygons do not appear when opening the file in
        // Altium.  https://gitlab.com/kicad/code/kicad/-/issues/8183
        // Also, polygons with less than 3 points are not supported in KiCad.
        return;
      }

      const zone = new ZONE(this.m_board);

      zone.SetIsRuleArea(true);

      if (aElem.is_keepout) {
        this.HelperSetZoneKeepoutRestrictions(zone, aElem.keepoutrestrictions);
      } else if (aElem.kind === ALTIUM_REGION_KIND.POLYGON_CUTOUT) {
        zone.SetDoNotAllowZoneFills(true);
        zone.SetDoNotAllowVias(false);
        zone.SetDoNotAllowTracks(false);
        zone.SetDoNotAllowPads(false);
        zone.SetDoNotAllowFootprints(false);
      }

      zone.SetPosition(aElem.outline[0]!.position);
      zone.Outline().AddOutline(linechain);

      this.HelperSetZoneLayers(zone, aElem.layer);

      zone.SetBorderDisplayStyle(
        ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
        ZONE.GetDefaultHatchPitch(),
        true,
      );

      this.m_board.Add(zone, ADD_MODE.APPEND);
    } else if (aElem.is_teardrop) {
      const linechain = new SHAPE_LINE_CHAIN();
      HelperShapeLineChainFromAltiumVertices(linechain, aElem.outline);

      if (linechain.PointCount() < 3) {
        // Polygons with less than 3 points are not supported in KiCad.
        return;
      }

      const zone = new ZONE(this.m_board);

      zone.SetPosition(aElem.outline[0]!.position);
      zone.Outline().AddOutline(linechain);

      this.HelperSetZoneLayers(zone, aElem.layer);
      zone.SetNetCode(this.GetNetCode(aElem.net));
      zone.SetTeardropAreaType(TEARDROP_TYPE.TD_UNSPECIFIED);
      zone.SetHatchStyle(ZONE_BORDER_DISPLAY_STYLE.INVISIBLE_BORDER);

      const fill = new SHAPE_POLY_SET();
      fill.Append(new SHAPE_POLY_SET(linechain));
      fill.Fracture();

      for (const klayer of this.GetKicadLayersToIterate(aElem.layer))
        zone.SetFilledPolysList(klayer, fill);

      zone.SetIsFilled(true);
      zone.SetNeedRefill(false);

      this.m_board.Add(zone, ADD_MODE.APPEND);
    } else if (aElem.kind === ALTIUM_REGION_KIND.DASHED_OUTLINE) {
      let klayer = this.GetKicadLayer(aElem.layer);

      if (klayer === UNDEFINED_LAYER) {
        this.report(
          `Dashed outline found on an Altium layer (${aElem.layer}) with no KiCad equivalent. It has been moved to KiCad layer Eco1_User.`,
          RPT_SEVERITY_ERROR,
        );

        klayer = Eco1_User;
      }

      const linechain = new SHAPE_LINE_CHAIN();
      HelperShapeLineChainFromAltiumVertices(linechain, aElem.outline);

      if (linechain.PointCount() < 3) {
        // We have found multiple Altium files with polygon records containing nothing but
        // two coincident vertices. These polygons do not appear when opening the file in
        // Altium. https://gitlab.com/kicad/code/kicad/-/issues/8183
        // Also, polygons with less than 3 points are not supported in KiCad.
        return;
      }

      const shape = new PCB_SHAPE(this.m_board, SHAPE_T.POLY);

      shape.SetPolyShape(new SHAPE_POLY_SET(linechain));
      shape.SetFilled(false);
      shape.SetLayer(klayer);
      shape.SetStroke(new STROKE_PARAMS(pcbIUScale.mmToIU(0.1), LINE_STYLE.DASH));

      this.m_board.Add(shape, ADD_MODE.APPEND);
    } else if (aElem.kind === ALTIUM_REGION_KIND.COPPER) {
      if (aElem.polygon === ALTIUM_POLYGON_NONE) {
        for (const klayer of this.GetKicadLayersToIterate(aElem.layer))
          this.ConvertShapeBasedRegions6ToBoardItemOnLayer(aElem, klayer);
      }
    } else {
      this.report(
        `Ignored polygon shape of kind ${aElem.kind} (not yet supported).`,
        RPT_SEVERITY_ERROR,
      );
    }
  }

  private ConvertShapeBasedRegions6ToFootprintItem(
    aFootprint: FOOTPRINT,
    aElem: AREGION6,
    aPrimitiveIndex: number,
  ): void {
    if (aElem.kind === ALTIUM_REGION_KIND.POLYGON_CUTOUT || aElem.is_keepout) {
      const linechain = new SHAPE_LINE_CHAIN();
      HelperShapeLineChainFromAltiumVertices(linechain, aElem.outline);

      if (linechain.PointCount() < 3) {
        // We have found multiple Altium files with polygon records containing nothing but
        // two coincident vertices. These polygons do not appear when opening the file in
        // Altium. https://gitlab.com/kicad/code/kicad/-/issues/8183
        // Also, polygons with less than 3 points are not supported in KiCad.
        return;
      }

      const zone = new ZONE(aFootprint);

      zone.SetIsRuleArea(true);

      if (aElem.is_keepout) {
        this.HelperSetZoneKeepoutRestrictions(zone, aElem.keepoutrestrictions);
      } else if (aElem.kind === ALTIUM_REGION_KIND.POLYGON_CUTOUT) {
        zone.SetDoNotAllowZoneFills(true);
        zone.SetDoNotAllowVias(false);
        zone.SetDoNotAllowTracks(false);
        zone.SetDoNotAllowPads(false);
        zone.SetDoNotAllowFootprints(false);
      }

      zone.SetPosition(aElem.outline[0]!.position);
      zone.Outline().AddOutline(linechain);

      this.HelperSetZoneLayers(zone, aElem.layer);

      zone.SetBorderDisplayStyle(
        ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
        ZONE.GetDefaultHatchPitch(),
        true,
      );

      aFootprint.Add(zone, ADD_MODE.APPEND);
    } else if (aElem.kind === ALTIUM_REGION_KIND.COPPER) {
      if (aElem.polygon === ALTIUM_POLYGON_NONE) {
        for (const klayer of this.GetKicadLayersToIterate(aElem.layer)) {
          this.ConvertShapeBasedRegions6ToFootprintItemOnLayer(
            aFootprint,
            aElem,
            klayer,
            aPrimitiveIndex,
          );
        }
      }
    } else if (
      aElem.kind === ALTIUM_REGION_KIND.DASHED_OUTLINE ||
      aElem.kind === ALTIUM_REGION_KIND.BOARD_CUTOUT
    ) {
      let klayer =
        aElem.kind === ALTIUM_REGION_KIND.BOARD_CUTOUT
          ? Edge_Cuts
          : this.GetKicadLayer(aElem.layer);

      if (klayer === UNDEFINED_LAYER) {
        if (this.m_footprintName !== '') {
          this.report(
            `Loading library '${this.m_library}':\nFootprint ${this.m_footprintName} contains a dashed outline on Altium layer (${aElem.layer}) with no KiCad equivalent. It has been moved to KiCad layer Eco1_User.`,
            RPT_SEVERITY_ERROR,
          );
        } else {
          this.report(
            `Footprint ${aFootprint.GetReference()} contains a dashed outline on Altium layer (${aElem.layer}) with no KiCad equivalent. It has been moved to KiCad layer Eco1_User.`,
            RPT_SEVERITY_ERROR,
          );
        }

        klayer = Eco1_User;
      }

      const linechain = new SHAPE_LINE_CHAIN();
      HelperShapeLineChainFromAltiumVertices(linechain, aElem.outline);

      if (linechain.PointCount() < 3) {
        // We have found multiple Altium files with polygon records containing nothing but
        // two coincident vertices. These polygons do not appear when opening the file in
        // Altium. https://gitlab.com/kicad/code/kicad/-/issues/8183
        // Also, polygons with less than 3 points are not supported in KiCad.
        return;
      }

      const shape = new PCB_SHAPE(aFootprint, SHAPE_T.POLY);

      shape.SetPolyShape(new SHAPE_POLY_SET(linechain));
      shape.SetFilled(false);
      shape.SetLayer(klayer);

      if (aElem.kind === ALTIUM_REGION_KIND.DASHED_OUTLINE)
        shape.SetStroke(new STROKE_PARAMS(pcbIUScale.mmToIU(0.1), LINE_STYLE.DASH));
      else shape.SetStroke(new STROKE_PARAMS(pcbIUScale.mmToIU(0.1), LINE_STYLE.SOLID));

      aFootprint.Add(shape, ADD_MODE.APPEND);
    } else {
      if (this.m_footprintName !== '') {
        this.report(
          `Error loading library '${this.m_library}':\nFootprint ${this.m_footprintName} contains polygon shape of kind ${aElem.kind} (not yet supported).`,
          RPT_SEVERITY_ERROR,
        );
      } else {
        this.report(
          `Footprint ${aFootprint.GetReference()} contains polygon shape of kind ${aElem.kind} (not yet supported).`,
          RPT_SEVERITY_ERROR,
        );
      }
    }
  }

  /** The outline and holes of a region, as the two `…OnLayer` converters build them. */
  private regionPolySet(aElem: AREGION6, linechain: SHAPE_LINE_CHAIN): SHAPE_POLY_SET {
    const polySet = new SHAPE_POLY_SET();
    polySet.AddOutline(linechain);

    for (const hole of aElem.holes) {
      const hole_linechain = new SHAPE_LINE_CHAIN();
      HelperShapeLineChainFromAltiumVertices(hole_linechain, hole);

      if (hole_linechain.PointCount() < 3) continue;

      polySet.AddHole(hole_linechain);
    }

    return polySet;
  }

  private ConvertShapeBasedRegions6ToBoardItemOnLayer(aElem: AREGION6, aLayer: PCB_LAYER_ID): void {
    const linechain = new SHAPE_LINE_CHAIN();
    HelperShapeLineChainFromAltiumVertices(linechain, aElem.outline);

    if (linechain.PointCount() < 3) {
      // We have found multiple Altium files with polygon records containing nothing
      // but two coincident vertices. These polygons do not appear when opening the
      // file in Altium. https://gitlab.com/kicad/code/kicad/-/issues/8183
      // Also, polygons with less than 3 points are not supported in KiCad.
      return;
    }

    const polySet = this.regionPolySet(aElem, linechain);

    const shape = new PCB_SHAPE(this.m_board, SHAPE_T.POLY);

    shape.SetPolyShape(polySet);
    shape.SetFilled(true);
    shape.SetLayer(aLayer);
    shape.SetStroke(new STROKE_PARAMS(0));

    if (IsCopperLayer(aLayer) && aElem.net !== ALTIUM_NET_UNCONNECTED) {
      shape.SetNetCode(this.GetNetCode(aElem.net));
    }

    this.m_board.Add(shape, ADD_MODE.APPEND);
  }

  private ConvertShapeBasedRegions6ToFootprintItemOnLayer(
    aFootprint: FOOTPRINT,
    aElem: AREGION6,
    aLayer: PCB_LAYER_ID,
    aPrimitiveIndex: number,
  ): void {
    const linechain = new SHAPE_LINE_CHAIN();
    HelperShapeLineChainFromAltiumVertices(linechain, aElem.outline);

    if (linechain.PointCount() < 3) {
      // We have found multiple Altium files with polygon records containing nothing
      // but two coincident vertices. These polygons do not appear when opening the
      // file in Altium. https://gitlab.com/kicad/code/kicad/-/issues/8183
      // Also, polygons with less than 3 points are not supported in KiCad.
      return;
    }

    const polySet = this.regionPolySet(aElem, linechain);

    if (aLayer === F_Cu || aLayer === B_Cu) {
      // TODO(JE) padstacks -- not sure what should happen here yet
      const pad = new PAD(aFootprint);

      const padLayers = new LSET();
      padLayers.set(aLayer);

      pad.SetAttribute(PAD_ATTRIB.SMD);
      pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CUSTOM);
      pad.SetThermalSpokeAngle(ANGLE_90);

      const anchorSize = 1;
      const anchorPos = linechain.CPoint(0);

      pad.SetAnchorPadShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
      pad.SetSize(PADSTACK.ALL_LAYERS, { x: anchorSize, y: anchorSize });
      pad.SetPosition(anchorPos);

      const shapePolys = new SHAPE_POLY_SET(polySet);
      shapePolys.Move({ x: -anchorPos.x, y: -anchorPos.y });
      pad.AddPrimitivePoly(PADSTACK.ALL_LAYERS, shapePolys, 0, true);

      const info = this.extendedInfo(ALTIUM_RECORD.REGION, aPrimitiveIndex)[0];

      if (info !== undefined) {
        if (info.pastemaskexpansionmode === ALTIUM_MODE.MANUAL) {
          pad.SetLocalSolderPasteMargin(info.pastemaskexpansionmanual);
        }

        if (info.soldermaskexpansionmode === ALTIUM_MODE.MANUAL) {
          pad.SetLocalSolderMaskMargin(info.soldermaskexpansionmanual);
        }

        if (info.pastemaskexpansionmode !== ALTIUM_MODE.NONE)
          padLayers.set(aLayer === F_Cu ? F_Paste : B_Paste);

        if (info.soldermaskexpansionmode !== ALTIUM_MODE.NONE)
          padLayers.set(aLayer === F_Cu ? F_Mask : B_Mask);
      }

      pad.SetLayerSet(padLayers);

      aFootprint.Add(pad, ADD_MODE.APPEND);
    } else {
      const shape = new PCB_SHAPE(aFootprint, SHAPE_T.POLY);

      shape.SetPolyShape(polySet);
      shape.SetFilled(true);
      shape.SetLayer(aLayer);
      shape.SetStroke(new STROKE_PARAMS(0));

      aFootprint.Add(shape, ADD_MODE.APPEND);
    }
  }

  /**
   * `m_extendedPrimitiveInformationMaps[aType]` then `equal_range( aPrimitiveIndex )`:
   * operator[] makes the per-record map when absent, as upstream's does.
   */
  private extendedInfo(
    aType: ALTIUM_RECORD,
    aPrimitiveIndex: number,
  ): AEXTENDED_PRIMITIVE_INFORMATION[] {
    let map = this.m_extendedPrimitiveInformationMaps.get(aType);

    if (!map) {
      map = new Map();
      this.m_extendedPrimitiveInformationMaps.set(aType, map);
    }

    return map.get(aPrimitiveIndex) ?? [];
  }

  private ParseRegions6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading zone fills...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    while (reader.GetRemainingBytes() >= 4 /* TODO: use Header section of file */) {
      this.checkpoint();
      const elem = new AREGION6(reader, false);

      if (elem.polygon !== ALTIUM_POLYGON_NONE) {
        if (this.m_polygons.length <= elem.polygon) {
          THROW_IO_ERROR(
            `Region stream tries to access polygon id ${elem.polygon} of ${this.m_polygons.length} existing polygons.`,
          );
        }

        const zone = this.m_polygons[elem.polygon];

        if (!zone) {
          continue; // we know the zone id, but because we do not know the layer we did not
          // add it!
        }

        const klayer = this.GetKicadLayer(elem.layer);

        if (klayer === UNDEFINED_LAYER) continue; // Just skip it for now. Users can fill it themselves.

        const linechain = new SHAPE_LINE_CHAIN();

        for (const vertice of elem.outline) linechain.Append(vertice.position);

        linechain.Append(elem.outline[0]!.position);
        linechain.SetClosed(true);

        const fill = new SHAPE_POLY_SET();
        fill.AddOutline(linechain);

        for (const hole of elem.holes) {
          const hole_linechain = new SHAPE_LINE_CHAIN();

          for (const vertice of hole) hole_linechain.Append(vertice.position);

          hole_linechain.Append(hole[0]!.position);
          hole_linechain.SetClosed(true);
          fill.AddHole(hole_linechain);
        }

        if (zone.HasFilledPolysForLayer(klayer)) fill.BooleanAdd(zone.GetFill(klayer)!);

        fill.Fracture();

        zone.SetFilledPolysList(klayer, fill);
        zone.SetIsFilled(true);
        zone.SetNeedRefill(false);
      }
    }

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('Regions6 stream is not fully parsed');
  }

  private ParseArcs6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading arcs...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    for (let primitiveIndex = 0; reader.GetRemainingBytes() >= 4; primitiveIndex++) {
      this.checkpoint();
      const elem = new AARC6(reader);

      if (elem.component === ALTIUM_COMPONENT_NONE) {
        this.ConvertArcs6ToBoardItem(elem, primitiveIndex);
      } else {
        const footprint = this.HelperGetFootprint(elem.component);
        this.ConvertArcs6ToFootprintItem(footprint, elem, primitiveIndex, true);
      }
    }

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('Arcs6 stream is not fully parsed');
  }

  private ConvertArcs6ToPcbShape(aElem: AARC6, aShape: PCB_SHAPE): void {
    if (aElem.startangle === 0 && aElem.endangle === 360) {
      aShape.SetShape(SHAPE_T.CIRCLE);

      // TODO: other variants to define circle?
      aShape.SetStart(aElem.center);
      aShape.SetEnd(sub(aElem.center, { x: 0, y: aElem.radius | 0 }));
    } else {
      aShape.SetShape(SHAPE_T.ARC);

      const includedAngle = new EDA_ANGLE(aElem.endangle - aElem.startangle);
      const startAngle = new EDA_ANGLE(aElem.endangle);

      const startOffset = {
        x: KiROUND(startAngle.Cos() * aElem.radius),
        y: -KiROUND(startAngle.Sin() * aElem.radius) + 0,
      };

      aShape.SetCenter(aElem.center);
      aShape.SetStart(add(aElem.center, startOffset));
      aShape.SetArcAngleAndEnd(includedAngle.Normalize(), true);
    }
  }

  /** `EDA_SHAPE::TransformShapeToPolygon` on a scratch shape, the upstream overload spelled out. */
  private static edaShapeToPolygon(aShape: PCB_SHAPE, aBuffer: SHAPE_POLY_SET): void {
    EDA_SHAPE.prototype.TransformShapeToPolygon.call(
      aShape,
      aBuffer,
      0,
      ARC_HIGH_DEF,
      ERROR_LOC.ERROR_INSIDE,
    );
  }

  private ConvertArcs6ToBoardItem(aElem: AARC6, aPrimitiveIndex: number): void {
    if (aElem.polygon !== ALTIUM_POLYGON_NONE && aElem.polygon !== ALTIUM_POLYGON_BOARD) {
      if (this.m_polygons.length <= aElem.polygon) {
        THROW_IO_ERROR(
          `Tracks stream tries to access polygon id ${aElem.polygon} of ${this.m_polygons.length} existing polygons.`,
        );
      }

      const zone = this.m_polygons[aElem.polygon];

      if (!zone) {
        return; // we know the zone id, but because we do not know the layer we did not
        // add it!
      }

      const klayer = this.GetKicadLayer(aElem.layer);

      if (klayer === UNDEFINED_LAYER) return; // Just skip it for now. Users can fill it themselves.

      if (!zone.HasFilledPolysForLayer(klayer)) return;

      const fill = zone.GetFill(klayer)!;

      // This is not the actual board item. We can use it to create the polygon for the region
      const shape = new PCB_SHAPE(null);

      this.ConvertArcs6ToPcbShape(aElem, shape);
      shape.SetStroke(new STROKE_PARAMS(aElem.width | 0, LINE_STYLE.SOLID));

      ALTIUM_PCB.edaShapeToPolygon(shape, fill);
      // Will be simplified and fractured later

      zone.SetIsFilled(true);
      zone.SetNeedRefill(false);

      return;
    }

    if (
      aElem.is_keepout ||
      aElem.layer === ALTIUM_LAYER.KEEP_OUT_LAYER ||
      IsAltiumLayerAPlane(aElem.layer)
    ) {
      // This is not the actual board item. We can use it to create the polygon for the region
      const shape = new PCB_SHAPE(null);

      this.ConvertArcs6ToPcbShape(aElem, shape);
      shape.SetStroke(new STROKE_PARAMS(aElem.width | 0, LINE_STYLE.SOLID));

      this.HelperPcpShapeAsBoardKeepoutRegion(shape, aElem.layer, aElem.keepoutrestrictions);
    } else {
      for (const klayer of this.GetKicadLayersToIterate(aElem.layer))
        this.ConvertArcs6ToBoardItemOnLayer(aElem, klayer);
    }

    for (const layerExpansionMask of this.HelperGetSolderAndPasteMaskExpansions(
      ALTIUM_RECORD.ARC,
      aPrimitiveIndex,
      aElem.layer,
    )) {
      const width = (aElem.width | 0) + layerExpansionMask[1] * 2;

      if (width > 1) {
        const arc = new PCB_SHAPE(this.m_board);

        this.ConvertArcs6ToPcbShape(aElem, arc);
        arc.SetStroke(new STROKE_PARAMS(width, LINE_STYLE.SOLID));
        arc.SetLayer(layerExpansionMask[0]);

        this.m_board.Add(arc, ADD_MODE.APPEND);
      }
    }
  }

  private ConvertArcs6ToFootprintItem(
    aFootprint: FOOTPRINT,
    aElem: AARC6,
    aPrimitiveIndex: number,
    aIsBoardImport: boolean,
  ): void {
    if (aElem.polygon !== ALTIUM_POLYGON_NONE) {
      console.assert(false, `Altium: Unexpected footprint Arc with polygon id ${aElem.polygon}`);
      return;
    }

    if (
      aElem.is_keepout ||
      aElem.layer === ALTIUM_LAYER.KEEP_OUT_LAYER ||
      IsAltiumLayerAPlane(aElem.layer)
    ) {
      // This is not the actual board item. We can use it to create the polygon for the region
      const shape = new PCB_SHAPE(null);

      this.ConvertArcs6ToPcbShape(aElem, shape);
      shape.SetStroke(new STROKE_PARAMS(aElem.width | 0, LINE_STYLE.SOLID));

      this.HelperPcpShapeAsFootprintKeepoutRegion(
        aFootprint,
        shape,
        aElem.layer,
        aElem.keepoutrestrictions,
      );
    } else {
      for (const klayer of this.GetKicadLayersToIterate(aElem.layer)) {
        if (aIsBoardImport && IsCopperLayer(klayer) && aElem.net !== ALTIUM_NET_UNCONNECTED) {
          // Special case: do to not lose net connections in footprints
          this.ConvertArcs6ToBoardItemOnLayer(aElem, klayer);
        } else {
          this.ConvertArcs6ToFootprintItemOnLayer(aFootprint, aElem, klayer);
        }
      }
    }

    for (const layerExpansionMask of this.HelperGetSolderAndPasteMaskExpansions(
      ALTIUM_RECORD.ARC,
      aPrimitiveIndex,
      aElem.layer,
    )) {
      const width = (aElem.width | 0) + layerExpansionMask[1] * 2;

      if (width > 1) {
        const arc = new PCB_SHAPE(aFootprint);

        this.ConvertArcs6ToPcbShape(aElem, arc);
        arc.SetStroke(new STROKE_PARAMS(width, LINE_STYLE.SOLID));
        arc.SetLayer(layerExpansionMask[0]);

        aFootprint.Add(arc, ADD_MODE.APPEND);
      }
    }
  }

  private ConvertArcs6ToBoardItemOnLayer(aElem: AARC6, aLayer: PCB_LAYER_ID): void {
    if (IsCopperLayer(aLayer) && aElem.net !== ALTIUM_NET_UNCONNECTED) {
      const includedAngle = new EDA_ANGLE(aElem.endangle - aElem.startangle);
      const startAngle = new EDA_ANGLE(aElem.endangle);

      includedAngle.Normalize();

      const startOffset = {
        x: KiROUND(startAngle.Cos() * aElem.radius),
        y: -KiROUND(startAngle.Sin() * aElem.radius) + 0,
      };

      if (includedAngle.AsDegrees() >= 0.1) {
        // TODO: This is not the actual board item. We use it for now to calculate the arc points. This could be improved!
        const shape = new PCB_SHAPE(null, SHAPE_T.ARC);

        shape.SetCenter(aElem.center);
        shape.SetStart(add(aElem.center, startOffset));
        shape.SetArcAngleAndEnd(includedAngle, true);

        // Create actual arc
        const shapeArc = new SHAPE_ARC(
          shape.GetCenter(),
          shape.GetStart(),
          shape.GetArcAngle(),
          aElem.width | 0,
        );
        const arc = new PCB_ARC(this.m_board, shapeArc);

        arc.SetWidth(aElem.width | 0);
        arc.SetLayer(aLayer);
        arc.SetNetCode(this.GetNetCode(aElem.net));

        this.m_board.Add(arc, ADD_MODE.APPEND);

        if (aElem.unionindex !== 0) this.unionItems(aElem.unionindex | 0).push(arc);
      }
    } else {
      const arc = new PCB_SHAPE(this.m_board);

      this.ConvertArcs6ToPcbShape(aElem, arc);
      arc.SetStroke(new STROKE_PARAMS(aElem.width | 0, LINE_STYLE.SOLID));
      arc.SetLayer(aLayer);

      this.m_board.Add(arc, ADD_MODE.APPEND);
    }
  }

  /** `m_unionToBoardItems[ aIndex ]`. */
  private unionItems(aIndex: number): BOARD_ITEM[] {
    let items = this.m_unionToBoardItems.get(aIndex);

    if (!items) {
      items = [];
      this.m_unionToBoardItems.set(aIndex, items);
    }

    return items;
  }

  private ConvertArcs6ToFootprintItemOnLayer(
    aFootprint: FOOTPRINT,
    aElem: AARC6,
    aLayer: PCB_LAYER_ID,
  ): void {
    const arc = new PCB_SHAPE(aFootprint);

    this.ConvertArcs6ToPcbShape(aElem, arc);
    arc.SetStroke(new STROKE_PARAMS(aElem.width | 0, LINE_STYLE.SOLID));
    arc.SetLayer(aLayer);

    aFootprint.Add(arc, ADD_MODE.APPEND);
  }

  private ParsePads6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading pads...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    while (reader.GetRemainingBytes() >= 4 /* TODO: use Header section of file */) {
      this.checkpoint();
      const elem = new APAD6(reader);

      if (elem.component === ALTIUM_COMPONENT_NONE) {
        this.ConvertPads6ToBoardItem(elem);
      } else {
        const footprint = this.HelperGetFootprint(elem.component);
        this.ConvertPads6ToFootprintItem(footprint, elem);
      }
    }

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('Pads6 stream is not fully parsed');
  }

  private ConvertPads6ToBoardItem(aElem: APAD6): void {
    // It is possible to place altium pads on non-copper layers -> we need to interpolate them using drawings!
    if (
      !IsAltiumLayerCopper(aElem.layer) &&
      !IsAltiumLayerAPlane(aElem.layer) &&
      aElem.layer !== ALTIUM_LAYER.MULTI_LAYER
    ) {
      this.ConvertPads6ToBoardItemOnNonCopper(aElem);
    } else {
      // We cannot add a pad directly into the PCB
      const footprint = new FOOTPRINT(this.m_board);
      footprint.SetPosition(aElem.position);

      this.ConvertPads6ToFootprintItemOnCopper(footprint, aElem);

      this.m_board.Add(footprint, ADD_MODE.APPEND);
    }
  }

  private ConvertVias6ToFootprintItem(aFootprint: FOOTPRINT, aElem: AVIA6): void {
    const pad = new PAD(aFootprint);

    pad.SetNumber('');
    pad.SetNetCode(this.GetNetCode(aElem.net));

    pad.SetPosition(aElem.position);
    pad.SetSize(PADSTACK.ALL_LAYERS, { x: aElem.diameter | 0, y: aElem.diameter | 0 });
    pad.SetDrillSize({ x: aElem.holesize | 0, y: aElem.holesize | 0 });
    pad.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE);
    pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
    pad.SetAttribute(PAD_ATTRIB.PTH);

    // Pads are always through holes in KiCad
    pad.SetLayerSet(new LSET(LSET.AllCuMask()));

    if (aElem.viamode === ALTIUM_PAD_MODE.SIMPLE) {
      pad.Padstack().SetMode(PADSTACK_MODE.NORMAL);
    } else if (aElem.viamode === ALTIUM_PAD_MODE.TOP_MIDDLE_BOTTOM) {
      pad.Padstack().SetMode(PADSTACK_MODE.FRONT_INNER_BACK);
      pad
        .Padstack()
        .SetSize(
          { x: aElem.diameter_by_layer[1]! | 0, y: aElem.diameter_by_layer[1]! | 0 },
          PADSTACK.INNER_LAYERS,
        );
    } else {
      pad.Padstack().SetMode(PADSTACK_MODE.CUSTOM);

      let cuLayers = new LSET(LSET.AllCuMask());

      if (this.m_board) cuLayers = cuLayers.and(this.m_board.GetEnabledLayers());

      for (const layer of cuLayers) {
        const altiumIdx = CopperLayerToOrdinal(layer);

        if (altiumIdx < 32) {
          pad.Padstack().SetSize(
            {
              x: aElem.diameter_by_layer[altiumIdx]! | 0,
              y: aElem.diameter_by_layer[altiumIdx]! | 0,
            },
            layer,
          );
        }
      }
    }

    if (aElem.is_tent_top) {
      pad.Padstack().FrontOuterLayers().has_solder_mask = true;
    } else {
      pad.Padstack().FrontOuterLayers().has_solder_mask = false;
      pad.SetLayerSet(new LSET(pad.GetLayerSet()).set(F_Mask));
    }

    if (aElem.is_tent_bottom) {
      pad.Padstack().BackOuterLayers().has_solder_mask = true;
    } else {
      pad.Padstack().BackOuterLayers().has_solder_mask = false;
      pad.SetLayerSet(new LSET(pad.GetLayerSet()).set(B_Mask));
    }

    if (aElem.is_locked) pad.SetLocked(true);

    if (aElem.soldermask_expansion_manual) {
      pad.Padstack().FrontOuterLayers().solder_mask_margin = aElem.soldermask_expansion_front;
      pad.Padstack().BackOuterLayers().solder_mask_margin = aElem.soldermask_expansion_back;
    }

    aFootprint.Add(pad, ADD_MODE.APPEND);
  }

  private ConvertPads6ToFootprintItem(aFootprint: FOOTPRINT, aElem: APAD6): void {
    // It is possible to place altium pads on non-copper layers -> we need to interpolate them using drawings!
    if (
      !IsAltiumLayerCopper(aElem.layer) &&
      !IsAltiumLayerAPlane(aElem.layer) &&
      aElem.layer !== ALTIUM_LAYER.MULTI_LAYER
    ) {
      this.ConvertPads6ToFootprintItemOnNonCopper(aFootprint, aElem);
    } else {
      this.ConvertPads6ToFootprintItemOnCopper(aFootprint, aElem);
    }
  }

  /** The two spellings of a pad message: loading a library names it, a board names the footprint. */
  private padMessage(aFootprint: FOOTPRINT, aLibraryText: string, aBoardText: string): string {
    return this.m_footprintName !== ''
      ? `Loading library '${this.m_library}':\nFootprint ${this.m_footprintName} ${aLibraryText}`
      : `Footprint ${aFootprint.GetReference()} ${aBoardText}`;
  }

  private ConvertPads6ToFootprintItemOnCopper(aFootprint: FOOTPRINT, aElem: APAD6): void {
    const pad = new PAD(aFootprint);

    pad.SetNumber(aElem.name);
    pad.SetNetCode(this.GetNetCode(aElem.net));

    pad.SetPosition(aElem.position);
    pad.SetOrientationDegrees(aElem.direction);
    pad.SetThermalSpokeAngle(ANGLE_90);

    if (aElem.holesize === 0) {
      pad.SetAttribute(PAD_ATTRIB.SMD);
    } else {
      if (aElem.layer !== ALTIUM_LAYER.MULTI_LAYER) {
        // TODO: I assume other values are possible as well?
        if (this.m_footprintName !== '') {
          this.report(
            `Error loading library '${this.m_library}':\nFootprint ${this.m_footprintName} pad ${aElem.name} is not marked as multilayer, but is a TH pad.`,
            RPT_SEVERITY_ERROR,
          );
        } else {
          this.report(
            `Footprint ${aFootprint.GetReference()} pad ${aElem.name} is not marked as multilayer, but is a TH pad.`,
            RPT_SEVERITY_ERROR,
          );
        }
      }

      pad.SetAttribute(aElem.plated ? PAD_ATTRIB.PTH : PAD_ATTRIB.NPTH);

      if (!aElem.sizeAndShape || aElem.sizeAndShape.holeshape === ALTIUM_PAD_HOLE_SHAPE.ROUND) {
        pad.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE);
        pad.SetDrillSize({ x: aElem.holesize | 0, y: aElem.holesize | 0 });
      } else {
        switch (aElem.sizeAndShape.holeshape) {
          case ALTIUM_PAD_HOLE_SHAPE.SQUARE:
            this.report(
              this.padMessage(
                aFootprint,
                `pad ${aElem.name} has a square hole (not yet supported).`,
                `pad ${aElem.name} has a square hole (not yet supported).`,
              ),
              RPT_SEVERITY_DEBUG,
            );

            pad.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE);
            pad.SetDrillSize({ x: aElem.holesize | 0, y: aElem.holesize | 0 }); // Workaround
            // TODO: elem.sizeAndShape->slotsize was 0 in testfile. Either use holesize in
            //  this case or rect holes have a different id
            break;

          case ALTIUM_PAD_HOLE_SHAPE.SLOT: {
            pad.SetDrillShape(PAD_DRILL_SHAPE.OBLONG);
            const slotRotation = new EDA_ANGLE(aElem.sizeAndShape.slotrotation);

            slotRotation.Normalize();

            if (slotRotation.IsHorizontal()) {
              pad.SetDrillSize({ x: aElem.sizeAndShape.slotsize | 0, y: aElem.holesize | 0 });
            } else if (slotRotation.IsVertical()) {
              pad.SetDrillSize({ x: aElem.holesize | 0, y: aElem.sizeAndShape.slotsize | 0 });
            } else {
              this.report(
                this.padMessage(
                  aFootprint,
                  `pad ${aElem.name} has a hole-rotation of ${KiROUND(slotRotation.AsDegrees())} degrees. KiCad only supports 90 degree rotations.`,
                  `pad ${aElem.name} has a hole-rotation of ${KiROUND(slotRotation.AsDegrees())} degrees. KiCad only supports 90 degree rotations.`,
                ),
                RPT_SEVERITY_DEBUG,
              );
            }

            break;
          }

          default:
            this.report(
              this.m_footprintName !== ''
                ? `Error loading library '${this.m_library}':\nFootprint ${this.m_footprintName} pad ${aElem.name} uses a hole of unknown kind ${aElem.sizeAndShape.holeshape}.`
                : `Footprint ${aFootprint.GetReference()} pad ${aElem.name} uses a hole of unknown kind ${aElem.sizeAndShape.holeshape}.`,
              RPT_SEVERITY_DEBUG,
            );

            pad.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE);
            pad.SetDrillSize({ x: aElem.holesize | 0, y: aElem.holesize | 0 }); // Workaround
            break;
        }
      }

      if (aElem.sizeAndShape) pad.SetOffset(PADSTACK.ALL_LAYERS, aElem.sizeAndShape.holeoffset[0]!);
    }

    const ps = pad.Padstack();

    const setCopperGeometry = (
      aLayer: PCB_LAYER_ID,
      aShape: ALTIUM_PAD_SHAPE,
      aSize: VECTOR2I,
    ): void => {
      const altLayer = CopperLayerToOrdinal(aLayer);

      ps.SetSize(aSize, aLayer);

      switch (aShape) {
        case ALTIUM_PAD_SHAPE.RECT:
          ps.SetShape(PAD_SHAPE.RECTANGLE, aLayer);
          break;

        case ALTIUM_PAD_SHAPE.CIRCLE:
          if (
            aElem.sizeAndShape &&
            aElem.sizeAndShape.alt_shape[altLayer] === ALTIUM_PAD_SHAPE_ALT.ROUNDRECT
          ) {
            ps.SetShape(PAD_SHAPE.ROUNDRECT, aLayer); // 100 = round, 0 = rectangular
            const ratio = aElem.sizeAndShape.cornerradius[altLayer]! / 200;
            ps.SetRoundRectRadiusRatio(ratio, aLayer);
          } else if (aElem.topsize.x === aElem.topsize.y) {
            ps.SetShape(PAD_SHAPE.CIRCLE, aLayer);
          } else {
            ps.SetShape(PAD_SHAPE.OVAL, aLayer);
          }

          break;

        case ALTIUM_PAD_SHAPE.OCTAGONAL:
          ps.SetShape(PAD_SHAPE.CHAMFERED_RECT, aLayer);
          ps.SetChamferPositions(RECT_CHAMFER_ALL, aLayer);
          ps.SetChamferRatio(0.25, aLayer);
          break;

        default:
          this.report(
            this.m_footprintName !== ''
              ? `Error loading library '${this.m_library}':\nFootprint ${this.m_footprintName} pad ${aElem.name} uses an unknown pad shape.`
              : `Footprint ${aFootprint.GetReference()} pad ${aElem.name} uses an unknown pad shape.`,
            RPT_SEVERITY_DEBUG,
          );
          break;
      }
    };

    switch (aElem.padmode) {
      case ALTIUM_PAD_MODE.SIMPLE:
        ps.SetMode(PADSTACK_MODE.NORMAL);
        setCopperGeometry(PADSTACK.ALL_LAYERS, aElem.topshape, aElem.topsize);
        break;

      case ALTIUM_PAD_MODE.TOP_MIDDLE_BOTTOM:
        ps.SetMode(PADSTACK_MODE.FRONT_INNER_BACK);
        setCopperGeometry(F_Cu, aElem.topshape, aElem.topsize);
        setCopperGeometry(PADSTACK.INNER_LAYERS, aElem.midshape, aElem.midsize);
        setCopperGeometry(B_Cu, aElem.botshape, aElem.botsize);
        break;

      case ALTIUM_PAD_MODE.FULL_STACK:
        ps.SetMode(PADSTACK_MODE.CUSTOM);

        setCopperGeometry(F_Cu, aElem.topshape, aElem.topsize);
        setCopperGeometry(B_Cu, aElem.botshape, aElem.botsize);
        setCopperGeometry(In1_Cu, aElem.midshape, aElem.midsize);

        if (aElem.sizeAndShape) {
          let i = 0;

          const intLayers = new LSET(aFootprint.BoardLayerSet()).and(LSET.InternalCuMask());
          intLayers.set(In1_Cu, false); // Already handled above

          for (const layer of intLayers) {
            setCopperGeometry(layer, aElem.sizeAndShape.inner_shape[i]!, {
              x: aElem.sizeAndShape.inner_size[i]!.x,
              y: aElem.sizeAndShape.inner_size[i]!.y,
            });
            i++;
          }
        }

        break;
    }

    switch (aElem.layer) {
      case ALTIUM_LAYER.TOP_LAYER:
        pad.SetLayer(F_Cu);
        pad.SetLayerSet(PAD.SMDMask());
        break;

      case ALTIUM_LAYER.BOTTOM_LAYER:
        pad.SetLayer(B_Cu);
        pad.SetLayerSet(PAD.SMDMask().FlipStandardLayers());
        break;

      case ALTIUM_LAYER.MULTI_LAYER:
        pad.SetLayerSet(aElem.plated ? PAD.PTHMask() : PAD.UnplatedHoleMask());
        break;

      default: {
        const klayer = this.GetKicadLayer(aElem.layer);
        pad.SetLayer(klayer);
        pad.SetLayerSet(new LSET([klayer]));
        break;
      }
    }

    if (aElem.pastemaskexpansionmode === ALTIUM_MODE.MANUAL)
      pad.SetLocalSolderPasteMargin(aElem.pastemaskexpansionmanual);

    if (aElem.soldermaskexpansionmode === ALTIUM_MODE.MANUAL)
      pad.SetLocalSolderMaskMargin(aElem.soldermaskexpansionmanual);

    if (aElem.is_tent_top) pad.SetLayerSet(new LSET(pad.GetLayerSet()).reset(F_Mask));

    if (aElem.is_tent_bottom) pad.SetLayerSet(new LSET(pad.GetLayerSet()).reset(B_Mask));

    pad.SetPadToDieLength(aElem.pad_to_die_length);
    pad.SetPadToDieDelay(aElem.pad_to_die_delay);

    aFootprint.Add(pad, ADD_MODE.APPEND);
  }

  private ConvertPads6ToBoardItemOnNonCopper(aElem: APAD6): void {
    let klayer = this.GetKicadLayer(aElem.layer);

    if (klayer === UNDEFINED_LAYER) {
      this.report(
        `Non-copper pad ${aElem.name} found on an Altium layer (${aElem.layer}) with no KiCad equivalent. It has been moved to KiCad layer Eco1_User.`,
        RPT_SEVERITY_INFO,
      );

      klayer = Eco1_User;
    }

    const pad = new PCB_SHAPE(this.m_board);

    this.HelperParsePad6NonCopper(aElem, klayer, pad);

    this.m_board.Add(pad, ADD_MODE.APPEND);
  }

  private ConvertPads6ToFootprintItemOnNonCopper(aFootprint: FOOTPRINT, aElem: APAD6): void {
    let klayer = this.GetKicadLayer(aElem.layer);

    if (klayer === UNDEFINED_LAYER) {
      this.report(
        this.m_footprintName !== ''
          ? `Loading library '${this.m_library}':\nFootprint ${this.m_footprintName} non-copper pad ${aElem.name} found on an Altium layer (${aElem.layer}) with no KiCad equivalent. It has been moved to KiCad layer Eco1_User.`
          : `Footprint ${aFootprint.GetReference()} non-copper pad ${aElem.name} found on an Altium layer (${aElem.layer}) with no KiCad equivalent. It has been moved to KiCad layer Eco1_User.`,
        RPT_SEVERITY_INFO,
      );

      klayer = Eco1_User;
    }

    const pad = new PCB_SHAPE(aFootprint);

    this.HelperParsePad6NonCopper(aElem, klayer, pad);

    aFootprint.Add(pad, ADD_MODE.APPEND);
  }

  private HelperParsePad6NonCopper(aElem: APAD6, aLayer: PCB_LAYER_ID, aShape: PCB_SHAPE): void {
    if (aElem.net !== ALTIUM_NET_UNCONNECTED) {
      this.report(
        `Non-copper pad ${aElem.name} is connected to a net, which is not supported.`,
        RPT_SEVERITY_DEBUG,
      );
    }

    if (aElem.holesize !== 0) {
      this.report(
        `Non-copper pad ${aElem.name} has a hole, which is not supported.`,
        RPT_SEVERITY_DEBUG,
      );
    }

    if (aElem.padmode !== ALTIUM_PAD_MODE.SIMPLE) {
      this.report(
        `Non-copper pad ${aElem.name} has a complex pad stack (not yet supported).`,
        RPT_SEVERITY_DEBUG,
      );
    }

    /** `int / 2`: C++ integer division truncates toward zero. */
    const half = (v: number): number => Math.trunc(v / 2);
    const pos = aElem.position;
    const size = aElem.topsize;

    switch (aElem.topshape) {
      case ALTIUM_PAD_SHAPE.RECT: {
        // filled rect
        aShape.SetShape(SHAPE_T.POLY);
        aShape.SetFilled(true);
        aShape.SetLayer(aLayer);
        aShape.SetStroke(new STROKE_PARAMS(0));

        aShape.SetPolyPoints([
          add(pos, { x: half(size.x), y: half(size.y) }),
          add(pos, { x: half(size.x), y: -half(size.y) }),
          add(pos, { x: -half(size.x), y: -half(size.y) }),
          add(pos, { x: -half(size.x), y: half(size.y) }),
        ]);

        if (aElem.direction !== 0) aShape.Rotate(pos, new EDA_ANGLE(aElem.direction));
        break;
      }

      case ALTIUM_PAD_SHAPE.CIRCLE:
        if (
          aElem.sizeAndShape &&
          aElem.sizeAndShape.alt_shape[0] === ALTIUM_PAD_SHAPE_ALT.ROUNDRECT
        ) {
          // filled roundrect
          const cornerradius = aElem.sizeAndShape.cornerradius[0]!;
          const offset = Math.trunc((Math.min(size.x, size.y) * cornerradius) / 200);

          aShape.SetLayer(aLayer);
          aShape.SetStroke(new STROKE_PARAMS(offset * 2, LINE_STYLE.SOLID));

          if (cornerradius < 100) {
            const offsetX = half(size.x) - offset;
            const offsetY = half(size.y) - offset;

            const p11 = add(pos, { x: offsetX, y: offsetY });
            const p12 = add(pos, { x: offsetX, y: -offsetY });
            const p22 = add(pos, { x: -offsetX, y: -offsetY });
            const p21 = add(pos, { x: -offsetX, y: offsetY });

            aShape.SetShape(SHAPE_T.POLY);
            aShape.SetFilled(true);
            aShape.SetPolyPoints([p11, p12, p22, p21]);
          } else if (size.x === size.y) {
            // circle
            aShape.SetShape(SHAPE_T.CIRCLE);
            aShape.SetFilled(true);
            aShape.SetStart(pos);
            aShape.SetEnd(sub(pos, { x: 0, y: Math.trunc(size.x / 4) }));
            aShape.SetStroke(new STROKE_PARAMS(half(size.x), LINE_STYLE.SOLID));
          } else if (size.x < size.y) {
            // short vertical line
            aShape.SetShape(SHAPE_T.SEGMENT);
            const pointOffset = { x: 0, y: half(size.y) - half(size.x) };
            aShape.SetStart(add(pos, pointOffset));
            aShape.SetEnd(sub(pos, pointOffset));
          } else {
            // short horizontal line
            aShape.SetShape(SHAPE_T.SEGMENT);
            const pointOffset = { x: half(size.x) - half(size.y), y: 0 };
            aShape.SetStart(add(pos, pointOffset));
            aShape.SetEnd(sub(pos, pointOffset));
          }

          if (aElem.direction !== 0) aShape.Rotate(pos, new EDA_ANGLE(aElem.direction));
        } else if (size.x === size.y) {
          // filled circle
          aShape.SetShape(SHAPE_T.CIRCLE);
          aShape.SetFilled(true);
          aShape.SetLayer(aLayer);
          aShape.SetStart(pos);
          aShape.SetEnd(sub(pos, { x: 0, y: Math.trunc(size.x / 4) }));
          aShape.SetStroke(new STROKE_PARAMS(half(size.x), LINE_STYLE.SOLID));
        } else {
          // short line
          aShape.SetShape(SHAPE_T.SEGMENT);
          aShape.SetLayer(aLayer);
          aShape.SetStroke(new STROKE_PARAMS(Math.min(size.x, size.y), LINE_STYLE.SOLID));

          if (size.x < size.y) {
            const offset = { x: 0, y: half(size.y) - half(size.x) };
            aShape.SetStart(add(pos, offset));
            aShape.SetEnd(sub(pos, offset));
          } else {
            const offset = { x: half(size.x) - half(size.y), y: 0 };
            aShape.SetStart(add(pos, offset));
            aShape.SetEnd(sub(pos, offset));
          }

          if (aElem.direction !== 0) aShape.Rotate(pos, new EDA_ANGLE(aElem.direction));
        }
        break;

      case ALTIUM_PAD_SHAPE.OCTAGONAL: {
        // filled octagon
        aShape.SetShape(SHAPE_T.POLY);
        aShape.SetFilled(true);
        aShape.SetLayer(aLayer);
        aShape.SetStroke(new STROKE_PARAMS(0));

        const p11 = add(pos, { x: half(size.x), y: half(size.y) });
        const p12 = add(pos, { x: half(size.x), y: -half(size.y) });
        const p22 = add(pos, { x: -half(size.x), y: -half(size.y) });
        const p21 = add(pos, { x: -half(size.x), y: half(size.y) });

        const chamfer = Math.trunc(Math.min(size.x, size.y) / 4);
        const chamferX = { x: chamfer, y: 0 };
        const chamferY = { x: 0, y: chamfer };

        aShape.SetPolyPoints([
          sub(p11, chamferX),
          sub(p11, chamferY),
          add(p12, chamferY),
          sub(p12, chamferX),
          add(p22, chamferX),
          add(p22, chamferY),
          sub(p21, chamferY),
          add(p21, chamferX),
        ]);

        if (aElem.direction !== 0) aShape.Rotate(pos, new EDA_ANGLE(aElem.direction));
        break;
      }

      default:
        this.report(`Non-copper pad ${aElem.name} uses an unknown pad shape.`, RPT_SEVERITY_DEBUG);

        break;
    }
  }

  private ParseVias6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading vias...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    while (reader.GetRemainingBytes() >= 4 /* TODO: use Header section of file */) {
      this.checkpoint();
      const elem = new AVIA6(reader);

      const via = new PCB_VIA(this.m_board);

      via.SetPosition(elem.position);
      via.SetDrill(elem.holesize | 0);
      via.SetNetCode(this.GetNetCode(elem.net));
      via.SetLocked(elem.is_locked);

      const start_layer_outside =
        elem.layer_start === ALTIUM_LAYER.TOP_LAYER ||
        elem.layer_start === ALTIUM_LAYER.BOTTOM_LAYER;
      const end_layer_outside =
        elem.layer_end === ALTIUM_LAYER.TOP_LAYER || elem.layer_end === ALTIUM_LAYER.BOTTOM_LAYER;

      if (start_layer_outside && end_layer_outside) {
        via.SetViaType(VIATYPE.THROUGH);
      } else if (!start_layer_outside && !end_layer_outside) {
        via.SetViaType(VIATYPE.BURIED);
      } else {
        via.SetViaType(VIATYPE.BLIND);
      }

      // TODO: Altium has a specific flag for microvias, independent of start/end layer

      const start_klayer = this.GetKicadLayer(elem.layer_start);
      const end_klayer = this.GetKicadLayer(elem.layer_end);

      if (!IsCopperLayer(start_klayer) || !IsCopperLayer(end_klayer)) {
        this.report(
          `Via from layer ${elem.layer_start} to ${elem.layer_end} uses a non-copper layer, which is not supported.`,
          RPT_SEVERITY_DEBUG,
        );

        continue; // just assume through-hole instead.
      }

      // we need VIATYPE set!
      via.SetLayerPair(start_klayer, end_klayer);

      switch (elem.viamode) {
        default:
        case ALTIUM_PAD_MODE.SIMPLE:
          via.SetWidth(PADSTACK.ALL_LAYERS, elem.diameter | 0);
          break;

        case ALTIUM_PAD_MODE.TOP_MIDDLE_BOTTOM:
          via.Padstack().SetMode(PADSTACK_MODE.FRONT_INNER_BACK);
          via.SetWidth(F_Cu, elem.diameter_by_layer[0]! | 0);
          via.SetWidth(PADSTACK.INNER_LAYERS, elem.diameter_by_layer[1]! | 0);
          via.SetWidth(B_Cu, elem.diameter_by_layer[31]! | 0);
          break;

        case ALTIUM_PAD_MODE.FULL_STACK: {
          via.Padstack().SetMode(PADSTACK_MODE.CUSTOM);

          const cuLayers = new LSET(this.m_board.GetEnabledLayers()).and(LSET.AllCuMask());

          for (const layer of cuLayers) {
            const altiumLayer = CopperLayerToOrdinal(layer);

            if (!(altiumLayer < 32)) {
              console.assert(false, 'Altium importer expects 32 or fewer copper layers');
              break;
            }

            via.SetWidth(layer, elem.diameter_by_layer[altiumLayer]! | 0);
          }

          break;
        }
      }

      // Altium can size the solder mask opening from the hole edge instead of the via land.
      // KiCad vias cannot represent a hole-referenced opening, so when the resulting opening
      // does not clear the via land the pad copper is covered and the via is effectively tented.
      const tentTop = altiumViaSideIsTented(
        elem.is_tent_top,
        elem.soldermask_expansion_manual,
        elem.soldermask_expansion_from_hole,
        elem.holesize,
        elem.soldermask_expansion_front,
        via.GetWidth(F_Cu),
      );

      const tentBottom = altiumViaSideIsTented(
        elem.is_tent_bottom,
        elem.soldermask_expansion_manual,
        elem.soldermask_expansion_from_hole,
        elem.holesize,
        elem.soldermask_expansion_back,
        via.GetWidth(B_Cu),
      );

      via.SetFrontTentingMode(tentTop ? TENTING_MODE.TENTED : TENTING_MODE.NOT_TENTED);
      via.SetBackTentingMode(tentBottom ? TENTING_MODE.TENTED : TENTING_MODE.NOT_TENTED);

      this.m_board.Add(via, ADD_MODE.APPEND);
    }

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('Vias6 stream is not fully parsed');
  }

  private ParseTracks6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading tracks...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    for (let primitiveIndex = 0; reader.GetRemainingBytes() >= 4; primitiveIndex++) {
      this.checkpoint();
      const elem = new ATRACK6(reader);

      if (elem.component === ALTIUM_COMPONENT_NONE) {
        this.ConvertTracks6ToBoardItem(elem, primitiveIndex);
      } else {
        const footprint = this.HelperGetFootprint(elem.component);
        this.ConvertTracks6ToFootprintItem(footprint, elem, primitiveIndex, true);
      }
    }

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('Tracks6 stream is not fully parsed');
  }

  private ConvertTracks6ToBoardItem(aElem: ATRACK6, aPrimitiveIndex: number): void {
    if (aElem.polygon !== ALTIUM_POLYGON_NONE && aElem.polygon !== ALTIUM_POLYGON_BOARD) {
      if (this.m_polygons.length <= aElem.polygon) {
        // Can happen when reading old Altium files: just skip this item
        this.report(
          `ATRACK6 stream tries to access polygon id ${aElem.polygon} of ${this.m_polygons.length} existing polygons; skipping it`,
          RPT_SEVERITY_DEBUG,
        );

        return;
      }

      const zone = this.m_polygons[aElem.polygon];

      if (!zone) {
        return; // we know the zone id, but because we do not know the layer we did not
        // add it!
      }

      const klayer = this.GetKicadLayer(aElem.layer);

      if (klayer === UNDEFINED_LAYER) return; // Just skip it for now. Users can fill it themselves.

      if (!zone.HasFilledPolysForLayer(klayer)) return;

      const fill = zone.GetFill(klayer)!;

      const shape = new PCB_SHAPE(null, SHAPE_T.SEGMENT);
      shape.SetStart(aElem.start);
      shape.SetEnd(aElem.end);
      shape.SetStroke(new STROKE_PARAMS(aElem.width | 0, LINE_STYLE.SOLID));

      ALTIUM_PCB.edaShapeToPolygon(shape, fill);
      // Will be simplified and fractured later

      zone.SetIsFilled(true);
      zone.SetNeedRefill(false);

      return;
    }

    if (
      aElem.is_keepout ||
      aElem.layer === ALTIUM_LAYER.KEEP_OUT_LAYER ||
      IsAltiumLayerAPlane(aElem.layer)
    ) {
      // This is not the actual board item. We can use it to create the polygon for the region
      const shape = new PCB_SHAPE(null, SHAPE_T.SEGMENT);
      shape.SetStart(aElem.start);
      shape.SetEnd(aElem.end);
      shape.SetStroke(new STROKE_PARAMS(aElem.width | 0, LINE_STYLE.SOLID));

      this.HelperPcpShapeAsBoardKeepoutRegion(shape, aElem.layer, aElem.keepoutrestrictions);
    } else {
      for (const klayer of this.GetKicadLayersToIterate(aElem.layer))
        this.ConvertTracks6ToBoardItemOnLayer(aElem, klayer);
    }

    for (const layerExpansionMask of this.HelperGetSolderAndPasteMaskExpansions(
      ALTIUM_RECORD.TRACK,
      aPrimitiveIndex,
      aElem.layer,
    )) {
      const width = (aElem.width | 0) + layerExpansionMask[1] * 2;
      if (width > 1) {
        const seg = new PCB_SHAPE(this.m_board, SHAPE_T.SEGMENT);

        seg.SetStart(aElem.start);
        seg.SetEnd(aElem.end);
        seg.SetStroke(new STROKE_PARAMS(width, LINE_STYLE.SOLID));
        seg.SetLayer(layerExpansionMask[0]);

        this.m_board.Add(seg, ADD_MODE.APPEND);
      }
    }
  }

  private ConvertTracks6ToFootprintItem(
    aFootprint: FOOTPRINT,
    aElem: ATRACK6,
    aPrimitiveIndex: number,
    aIsBoardImport: boolean,
  ): void {
    if (aElem.polygon !== ALTIUM_POLYGON_NONE) {
      console.assert(false, `Altium: Unexpected footprint Track with polygon id ${aElem.polygon}`);
      return;
    }

    if (
      aElem.is_keepout ||
      aElem.layer === ALTIUM_LAYER.KEEP_OUT_LAYER ||
      IsAltiumLayerAPlane(aElem.layer)
    ) {
      // This is not the actual board item. We can use it to create the polygon for the region
      const shape = new PCB_SHAPE(null, SHAPE_T.SEGMENT);
      shape.SetStart(aElem.start);
      shape.SetEnd(aElem.end);
      shape.SetStroke(new STROKE_PARAMS(aElem.width | 0, LINE_STYLE.SOLID));

      this.HelperPcpShapeAsFootprintKeepoutRegion(
        aFootprint,
        shape,
        aElem.layer,
        aElem.keepoutrestrictions,
      );
    } else {
      for (const klayer of this.GetKicadLayersToIterate(aElem.layer)) {
        if (aIsBoardImport && IsCopperLayer(klayer) && aElem.net !== ALTIUM_NET_UNCONNECTED) {
          // Special case: do to not lose net connections in footprints
          this.ConvertTracks6ToBoardItemOnLayer(aElem, klayer);
        } else {
          this.ConvertTracks6ToFootprintItemOnLayer(aFootprint, aElem, klayer);
        }
      }
    }

    for (const layerExpansionMask of this.HelperGetSolderAndPasteMaskExpansions(
      ALTIUM_RECORD.TRACK,
      aPrimitiveIndex,
      aElem.layer,
    )) {
      const width = (aElem.width | 0) + layerExpansionMask[1] * 2;
      if (width > 1) {
        const seg = new PCB_SHAPE(aFootprint, SHAPE_T.SEGMENT);

        seg.SetStart(aElem.start);
        seg.SetEnd(aElem.end);
        seg.SetStroke(new STROKE_PARAMS(width, LINE_STYLE.SOLID));
        seg.SetLayer(layerExpansionMask[0]);

        aFootprint.Add(seg, ADD_MODE.APPEND);
      }
    }
  }

  private ConvertTracks6ToBoardItemOnLayer(aElem: ATRACK6, aLayer: PCB_LAYER_ID): void {
    if (IsCopperLayer(aLayer) && aElem.net !== ALTIUM_NET_UNCONNECTED) {
      const track = new PCB_TRACK(this.m_board);

      track.SetStart(aElem.start);
      track.SetEnd(aElem.end);
      track.SetWidth(aElem.width | 0);
      track.SetLayer(aLayer);
      track.SetNetCode(this.GetNetCode(aElem.net));

      this.m_board.Add(track, ADD_MODE.APPEND);

      if (aElem.unionindex !== 0) this.unionItems(aElem.unionindex | 0).push(track);
    } else {
      const seg = new PCB_SHAPE(this.m_board, SHAPE_T.SEGMENT);

      seg.SetStart(aElem.start);
      seg.SetEnd(aElem.end);
      seg.SetStroke(new STROKE_PARAMS(aElem.width | 0, LINE_STYLE.SOLID));
      seg.SetLayer(aLayer);

      this.m_board.Add(seg, ADD_MODE.APPEND);
    }
  }

  private ConvertTracks6ToFootprintItemOnLayer(
    aFootprint: FOOTPRINT,
    aElem: ATRACK6,
    aLayer: PCB_LAYER_ID,
  ): void {
    const seg = new PCB_SHAPE(aFootprint, SHAPE_T.SEGMENT);

    seg.SetStart(aElem.start);
    seg.SetEnd(aElem.end);
    seg.SetStroke(new STROKE_PARAMS(aElem.width | 0, LINE_STYLE.SOLID));
    seg.SetLayer(aLayer);

    aFootprint.Add(seg, ADD_MODE.APPEND);
  }

  private ParseWideStrings6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading unicode strings...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    this.m_unicodeStrings = reader.ReadWideStringTable();

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('WideStrings6 stream is not fully parsed');
  }

  private ParseSmartUnions6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    while (reader.GetRemainingBytes() >= 4) {
      this.checkpoint();
      const elem = new ASMARTUNION6(reader);

      if (elem.is_tuning && elem.unionindex !== 0) this.m_tuningUnions.push(elem);
    }

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('SmartUnions6 stream is not fully parsed');
  }

  private HelperCreateTuningPatterns(): void {
    let created = 0;

    for (const tuning of this.m_tuningUnions) {
      const items = this.m_unionToBoardItems.get(tuning.unionindex);

      // Altium commits the tuned copper as ordinary tracks and arcs.  Without those primitives
      // there is nothing to wrap, so drop the meander rather than fabricate geometry.
      if (items === undefined || items.length === 0) continue;

      // Without a baseline the pattern can be neither re-tuned nor reset, so wrapping the copper
      // would only take it away from the user
      if (tuning.baseline.length < 2 || (tuning.is_diffpair && tuning.baselinecoupled.length < 2)) {
        continue;
      }

      const mode = tuning.is_diffpair ? LENGTH_TUNING_MODE.DIFF_PAIR : LENGTH_TUNING_MODE.SINGLE;

      const baseLine = new SHAPE_LINE_CHAIN(tuning.baseline);

      const layer = items[0]!.GetLayer();

      const generator = GENERATORS_MGR.Instance().CreateFromType('tuning_pattern');

      if (!generator) continue;

      const pattern = generator as PCB_TUNING_PATTERN;
      pattern.SetParent(this.m_board);
      pattern.SetLayer(layer);
      pattern.SetTuningMode(mode);

      pattern.SetMaxAmplitude(tuning.amplitude);
      pattern.SetMinAmplitude(tuning.minamplitude);
      pattern.SetSpacing(tuning.gap);
      pattern.SetSingleSided(tuning.singleside);

      // Altium "Style" selects mitered (chamfered) versus rounded corners.  The committed
      // copper carries the real geometry; this only governs a later interactive re-tune.
      pattern.SetRounded(tuning.style !== 0);

      if (tuning.mitterradiusratio > 0.0) {
        const percent = KiROUND(tuning.mitterradiusratio * 100.0);
        pattern.SetCornerRadiusPercentage(Math.min(Math.max(percent, 0), 100));
      }

      let netCode = -1;
      let singleNet = true;

      for (const item of items) {
        pattern.AddItem(item);

        if (item instanceof BOARD_CONNECTED_ITEM) {
          if (netCode < 0) netCode = item.GetNetCode();
          else if (netCode !== item.GetNetCode()) singleNet = false;
        }
      }

      // SetNetCode reassigns the net of every member, so only apply it when the union is on a
      // single net.  Differential-pair meanders span two nets that must both be preserved.
      if (netCode >= 0 && singleNet) {
        pattern.SetNetCode(netCode);
      } else {
        // Name the pattern after the net at the baseline start, the one an edit snaps to
        const origin = baseLine.CPoint(0);
        let bestDist = Number.MAX_SAFE_INTEGER;
        let bestNet = '';

        for (const item of items) {
          if (!(item instanceof PCB_TRACK)) continue;

          const dist = new SEG(item.GetStart(), item.GetEnd()).SquaredDistance(origin);

          if (dist < bestDist) {
            bestDist = dist;
            bestNet = item.GetNetname();
          }
        }

        pattern.SetLastNetName(bestNet);
      }

      if (items[0] instanceof PCB_TRACK) pattern.SetWidth(items[0].GetWidth());

      pattern.SetBaseLine(baseLine);
      pattern.SetPosition(baseLine.CPoint(0));
      pattern.SetEnd(baseLine.CLastPoint());

      if (mode === LENGTH_TUNING_MODE.DIFF_PAIR) {
        const baseLineCoupled = new SHAPE_LINE_CHAIN(tuning.baselinecoupled);

        pattern.SetBaseLineCoupled(baseLineCoupled);

        // SHAPE_LINE_CHAIN_BASE::Distance( aP, aOutlineOnly ): the int square root
        const centreToCentre = Math.trunc(
          Math.sqrt(baseLine.SquaredDistance(baseLineCoupled.CPoint(0), false)),
        );

        pattern.SetDiffPairGap(Math.max(centreToCentre - pattern.GetWidth(), 0));
      }

      this.m_board.Add(pattern, ADD_MODE.INSERT);
      created++;
    }

    if (created > 0) {
      this.report(`Imported ${created} length-tuning pattern(s).`, RPT_SEVERITY_INFO);
    }
  }

  private ParseTexts6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading text...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    while (reader.GetRemainingBytes() >= 4 /* TODO: use Header section of file */) {
      this.checkpoint();
      const elem = new ATEXT6(reader, this.m_unicodeStrings);

      if (elem.component === ALTIUM_COMPONENT_NONE) {
        this.ConvertTexts6ToBoardItem(elem);
      } else {
        const footprint = this.HelperGetFootprint(elem.component);
        this.ConvertTexts6ToFootprintItem(footprint, elem);
      }
    }

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('Texts6 stream is not fully parsed');
  }

  private ConvertTexts6ToBoardItem(aElem: ATEXT6): void {
    if (aElem.fonttype === ALTIUM_TEXT_TYPE.BARCODE) {
      for (const klayer of this.GetKicadLayersToIterate(aElem.layer))
        this.ConvertBarcodes6ToBoardItemOnLayer(aElem, klayer);
      return;
    }

    for (const klayer of this.GetKicadLayersToIterate(aElem.layer))
      this.ConvertTexts6ToBoardItemOnLayer(aElem, klayer);
  }

  private ConvertTexts6ToFootprintItem(aFootprint: FOOTPRINT, aElem: ATEXT6): void {
    if (aElem.fonttype === ALTIUM_TEXT_TYPE.BARCODE) {
      for (const klayer of this.GetKicadLayersToIterate(aElem.layer))
        this.ConvertBarcodes6ToFootprintItemOnLayer(aFootprint, aElem, klayer);
      return;
    }

    for (const klayer of this.GetKicadLayersToIterate(aElem.layer))
      this.ConvertTexts6ToFootprintItemOnLayer(aFootprint, aElem, klayer);
  }

  private ConvertTexts6ToBoardItemOnLayer(aElem: ATEXT6, aLayer: PCB_LAYER_ID): void {
    const pcbTextbox = new PCB_TEXTBOX(this.m_board);
    const pcbText = new PCB_TEXT(this.m_board);

    const isTextbox = aElem.isFrame && !aElem.isInverted; // Textbox knockout is not supported

    const variableMap = new Map([
      ['LAYER_NAME', 'LAYER'],
      ['PRINT_DATE', 'CURRENT_DATE'],
    ]);

    const kicadText = AltiumPcbSpecialStringsToKiCadStrings(aElem.text, variableMap);
    let item: PCB_TEXT | PCB_TEXTBOX = pcbText;
    let text: EDA_TEXT = pcbText;

    if (isTextbox) {
      item = pcbTextbox;
      text = pcbTextbox;
    }

    text.SetText(kicadText);

    // Set the layer before the alignment helpers run.  HelperSetTextAlignmentAndPos measures the
    // text via GetTextBox(), which resolves layer-dependent special strings such as ${LAYER}.
    item.SetLayer(aLayer);

    this.ConvertTexts6ToEdaTextSettings(aElem, text);

    if (isTextbox) this.HelperSetTextboxAlignmentAndPos(aElem, pcbTextbox);
    else this.HelperSetTextAlignmentAndPos(aElem, text);

    item.SetIsKnockout(aElem.isInverted);

    if (isTextbox) this.m_board.Add(pcbTextbox, ADD_MODE.APPEND);
    else this.m_board.Add(pcbText, ADD_MODE.APPEND);
  }

  private ConvertTexts6ToFootprintItemOnLayer(
    aFootprint: FOOTPRINT,
    aElem: ATEXT6,
    aLayer: PCB_LAYER_ID,
  ): void {
    const fpTextbox = new PCB_TEXTBOX(aFootprint);
    const fpText = new PCB_TEXT(aFootprint);

    let item: PCB_TEXT | PCB_TEXTBOX = fpText;
    let text: EDA_TEXT = fpText;

    const isTextbox = aElem.isFrame && !aElem.isInverted; // Textbox knockout is not supported
    let toAdd = false;

    if (aElem.isDesignator) {
      item = aFootprint.Reference(); // TODO: handle multiple layers
      text = aFootprint.Reference();
    } else if (aElem.isComment) {
      item = aFootprint.Value(); // TODO: handle multiple layers
      text = aFootprint.Value();
    } else {
      item = fpText;
      text = fpText;
      toAdd = true;
    }

    const variableMap = new Map([
      ['DESIGNATOR', 'REFERENCE'],
      ['COMMENT', 'VALUE'],
      ['VALUE', 'ALTIUM_VALUE'],
      ['LAYER_NAME', 'LAYER'],
      ['PRINT_DATE', 'CURRENT_DATE'],
    ]);

    if (isTextbox) {
      item = fpTextbox;
      text = fpTextbox;
    }

    const kicadText = AltiumPcbSpecialStringsToKiCadStrings(aElem.text, variableMap);

    text.SetText(kicadText);

    // Set the layer before the alignment helpers run.  HelperSetTextAlignmentAndPos measures the
    // text via GetTextBox(), which resolves layer-dependent special strings such as ${LAYER}.
    item.SetLayer(aLayer);

    this.ConvertTexts6ToEdaTextSettings(aElem, text);

    if (isTextbox) this.HelperSetTextboxAlignmentAndPos(aElem, fpTextbox);
    else this.HelperSetTextAlignmentAndPos(aElem, text);

    text.SetKeepUpright(false);
    item.SetIsKnockout(aElem.isInverted);

    if (toAdd) {
      if (isTextbox) aFootprint.Add(fpTextbox, ADD_MODE.APPEND);
      else aFootprint.Add(fpText, ADD_MODE.APPEND);
    }
  }

  private ConvertBarcodes6ToBoardItemOnLayer(aElem: ATEXT6, aLayer: PCB_LAYER_ID): void {
    const pcbBarcode = new PCB_BARCODE(this.m_board);

    pcbBarcode.SetLayer(aLayer);
    pcbBarcode.SetPosition(aElem.position);
    pcbBarcode.SetWidth(aElem.textbox_rect_width | 0);
    pcbBarcode.SetHeight(aElem.textbox_rect_height | 0);
    pcbBarcode.SetMargin(aElem.barcode_margin);
    pcbBarcode.SetText(aElem.text);

    switch (aElem.barcode_type) {
      case ALTIUM_BARCODE_TYPE.CODE39:
        pcbBarcode.SetKind(BARCODE_T.CODE_39);
        break;
      case ALTIUM_BARCODE_TYPE.CODE128:
        pcbBarcode.SetKind(BARCODE_T.CODE_128);
        break;
      default:
        pcbBarcode.SetKind(BARCODE_T.CODE_39);
        break;
    }

    pcbBarcode.SetIsKnockout(aElem.barcode_inverted);
    pcbBarcode.AssembleBarcode();

    this.m_board.Add(pcbBarcode, ADD_MODE.APPEND);
  }

  private ConvertBarcodes6ToFootprintItemOnLayer(
    aFootprint: FOOTPRINT,
    aElem: ATEXT6,
    aLayer: PCB_LAYER_ID,
  ): void {
    const fpBarcode = new PCB_BARCODE(aFootprint);

    fpBarcode.SetLayer(aLayer);
    fpBarcode.SetPosition(aElem.position);
    fpBarcode.SetWidth(aElem.textbox_rect_width | 0);
    fpBarcode.SetHeight(aElem.textbox_rect_height | 0);
    fpBarcode.SetMargin(aElem.barcode_margin);
    fpBarcode.SetText(aElem.text);

    switch (aElem.barcode_type) {
      case ALTIUM_BARCODE_TYPE.CODE39:
        fpBarcode.SetKind(BARCODE_T.CODE_39);
        break;
      case ALTIUM_BARCODE_TYPE.CODE128:
        fpBarcode.SetKind(BARCODE_T.CODE_128);
        break;
      default:
        fpBarcode.SetKind(BARCODE_T.CODE_39);
        break;
    }

    fpBarcode.SetIsKnockout(aElem.barcode_inverted);
    fpBarcode.AssembleBarcode();

    aFootprint.Add(fpBarcode, ADD_MODE.APPEND);
  }

  private HelperSetTextboxAlignmentAndPos(aElem: ATEXT6, aTextbox: PCB_TEXTBOX): void {
    const margin = (aElem.isOffsetBorder ? aElem.text_offset_width : aElem.margin_border_width) | 0;

    // Altium textboxes do not have borders
    aTextbox.SetBorderEnabled(false);

    // Calculate position
    const kposition = { ...aElem.position };

    if (aElem.isMirrored) kposition.x -= aElem.textbox_rect_width | 0;

    kposition.y -= aElem.textbox_rect_height | 0;

    aTextbox.SetMarginBottom(margin);
    aTextbox.SetMarginLeft(margin);
    aTextbox.SetMarginRight(margin);
    aTextbox.SetMarginTop(margin);

    aTextbox.SetEnd({ x: aElem.textbox_rect_width | 0, y: aElem.textbox_rect_height | 0 });

    const rotated = RotatePoint(kposition, aElem.position, new EDA_ANGLE(aElem.rotation));

    aTextbox.SetPosition(rotated);

    const justification = aElem.isJustificationValid
      ? aElem.textbox_rect_justification
      : ALTIUM_TEXT_POSITION.LEFT_BOTTOM;

    switch (justification) {
      case ALTIUM_TEXT_POSITION.LEFT_TOP:
      case ALTIUM_TEXT_POSITION.LEFT_CENTER:
      case ALTIUM_TEXT_POSITION.LEFT_BOTTOM:
        aTextbox.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
        aTextbox.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
        break;
      case ALTIUM_TEXT_POSITION.CENTER_TOP:
      case ALTIUM_TEXT_POSITION.CENTER_CENTER:
      case ALTIUM_TEXT_POSITION.CENTER_BOTTOM:
        aTextbox.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
        aTextbox.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
        break;
      case ALTIUM_TEXT_POSITION.RIGHT_TOP:
      case ALTIUM_TEXT_POSITION.RIGHT_CENTER:
      case ALTIUM_TEXT_POSITION.RIGHT_BOTTOM:
        aTextbox.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        aTextbox.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
        break;
      default:
        this.report(
          `Unknown textbox justification ${justification}, aText ${aElem.text}`,
          RPT_SEVERITY_DEBUG,
        );

        aTextbox.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
        aTextbox.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
        break;
    }

    aTextbox.SetTextAngle(new EDA_ANGLE(aElem.rotation));
  }

  private HelperSetTextAlignmentAndPos(aElem: ATEXT6, aText: EDA_TEXT): void {
    const kposition = { ...aElem.position };

    const margin = (aElem.isOffsetBorder ? aElem.text_offset_width : aElem.margin_border_width) | 0;
    let rectWidth = (aElem.textbox_rect_width | 0) - margin * 2;
    const rectHeight = aElem.height | 0;

    // Altium auto-sizes the bounding box of a free string (non-frame text) from its own glyph
    // rasterizer, and stores a slightly different width for otherwise identical strings placed on
    // different layers (e.g. the copper and soldermask copies of the same label, which Altium may
    // also give different stroke widths).  Anchoring the KiCad text to that per-record width drives
    // the two copies apart.  Center the text on its bare glyph run instead, measured from the
    // already-populated EDA_TEXT with the pen inflation removed, so copies that share a glyph run
    // stay coincident regardless of stroke width.
    if (!aElem.isFrame) {
      rectWidth = aText.GetTextBox(null).GetWidth();

      const font = aText.GetFont();

      if (!font || font.IsStroke()) rectWidth -= 3 * aText.GetEffectiveTextPenWidth();
    }

    if (aElem.isMirrored) rectWidth = -rectWidth;

    const justification = aElem.isJustificationValid
      ? aElem.textbox_rect_justification
      : ALTIUM_TEXT_POSITION.LEFT_BOTTOM;

    /** `int / 2`. */
    const half = (v: number): number => Math.trunc(v / 2);

    switch (justification) {
      case ALTIUM_TEXT_POSITION.LEFT_TOP:
        aText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
        aText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);

        kposition.y -= rectHeight;
        break;
      case ALTIUM_TEXT_POSITION.LEFT_CENTER:
        aText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
        aText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);

        kposition.y -= half(rectHeight);
        break;
      case ALTIUM_TEXT_POSITION.LEFT_BOTTOM:
        aText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
        aText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
        break;
      case ALTIUM_TEXT_POSITION.CENTER_TOP:
        aText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
        aText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);

        kposition.x += half(rectWidth);
        kposition.y -= rectHeight;
        break;
      case ALTIUM_TEXT_POSITION.CENTER_CENTER:
        aText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
        aText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);

        kposition.x += half(rectWidth);
        kposition.y -= half(rectHeight);
        break;
      case ALTIUM_TEXT_POSITION.CENTER_BOTTOM:
        aText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
        aText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);

        kposition.x += half(rectWidth);
        break;
      case ALTIUM_TEXT_POSITION.RIGHT_TOP:
        aText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        aText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);

        kposition.x += rectWidth;
        kposition.y -= rectHeight;
        break;
      case ALTIUM_TEXT_POSITION.RIGHT_CENTER:
        aText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        aText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);

        kposition.x += rectWidth;
        kposition.y -= half(rectHeight);
        break;
      case ALTIUM_TEXT_POSITION.RIGHT_BOTTOM:
        aText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
        aText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);

        kposition.x += rectWidth;
        break;
      default:
        aText.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
        aText.SetVertJustify(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM);
        break;
    }

    const charWidth = aText.GetTextWidth();
    const charHeight = aText.GetTextHeight();

    // Correct for KiCad's baseline offset.
    // Text height and font must be set correctly before calling.
    // `kposition.y -= charHeight * 0.0407`: int -= double narrows toward zero.
    const font = aText.GetFont();

    if (!font || font.IsStroke()) {
      switch (aText.GetVertJustify()) {
        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP:
          kposition.y = Math.trunc(kposition.y - charHeight * 0.0407);
          break;
        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER:
          kposition.y = Math.trunc(kposition.y + charHeight * 0.0355);
          break;
        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM:
          kposition.y = Math.trunc(kposition.y + charHeight * 0.1225);
          break;
        default:
          break;
      }
    } else {
      switch (aText.GetVertJustify()) {
        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP:
          kposition.y = Math.trunc(kposition.y - charWidth * 0.016);
          break;
        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER:
          kposition.y = Math.trunc(kposition.y + charWidth * 0.085);
          break;
        case GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM:
          kposition.y = Math.trunc(kposition.y + charWidth * 0.17);
          break;
        default:
          break;
      }
    }

    const rotated = RotatePoint(kposition, aElem.position, new EDA_ANGLE(aElem.rotation));

    aText.SetTextPos(rotated);
    aText.SetTextAngle(new EDA_ANGLE(aElem.rotation));
  }

  private ConvertTexts6ToEdaTextSettings(aElem: ATEXT6, aEdaText: EDA_TEXT): void {
    aEdaText.SetTextSize({ x: aElem.height | 0, y: aElem.height | 0 });

    if (aElem.fonttype === ALTIUM_TEXT_TYPE.TRUETYPE) {
      const font = FONT.GetFont(aElem.fontname, aElem.isBold, aElem.isItalic);
      aEdaText.SetFont(font);

      if (font.IsOutline()) {
        // TODO: why is this required? Somehow, truetype size is calculated differently
        // VECTOR2I( double, double ): each component truncated
        if (font.GetName().includes('Arial'))
          aEdaText.SetTextSize({
            x: Math.trunc((aElem.height | 0) * 0.63),
            y: Math.trunc((aElem.height | 0) * 0.63),
          });
        else
          aEdaText.SetTextSize({
            x: Math.trunc((aElem.height | 0) * 0.5),
            y: Math.trunc((aElem.height | 0) * 0.5),
          });
      }
    }

    aEdaText.SetTextThickness(aElem.strokewidth | 0);
    aEdaText.SetBoldFlag(aElem.isBold);
    aEdaText.SetItalic(aElem.isItalic);
    aEdaText.SetMirrored(aElem.isMirrored);
  }

  private ParseFills6Data(
    aAltiumPcbFile: ALTIUM_PCB_COMPOUND_FILE,
    aEntry: COMPOUND_FILE_ENTRY,
  ): void {
    this.m_progressReporter?.Report('Loading rectangles...');

    const reader = new ALTIUM_BINARY_PARSER(aAltiumPcbFile, aEntry);

    while (reader.GetRemainingBytes() >= 4 /* TODO: use Header section of file */) {
      this.checkpoint();
      const elem = new AFILL6(reader);

      if (elem.component === ALTIUM_COMPONENT_NONE) {
        this.ConvertFills6ToBoardItem(elem);
      } else {
        const footprint = this.HelperGetFootprint(elem.component);
        this.ConvertFills6ToFootprintItem(footprint, elem, true);
      }
    }

    if (reader.GetRemainingBytes() !== 0) THROW_IO_ERROR('Fills6 stream is not fully parsed');
  }

  /** `VECTOR2I( pos1.x / 2 + pos2.x / 2, pos1.y / 2 + pos2.y / 2 )`, int halves. */
  private static fillCenter(aElem: AFILL6): VECTOR2I {
    return {
      x: Math.trunc(aElem.pos1.x / 2) + Math.trunc(aElem.pos2.x / 2),
      y: Math.trunc(aElem.pos1.y / 2) + Math.trunc(aElem.pos2.y / 2),
    };
  }

  private ConvertFills6ToBoardItem(aElem: AFILL6): void {
    if (aElem.is_keepout || aElem.layer === ALTIUM_LAYER.KEEP_OUT_LAYER) {
      // This is not the actual board item. We can use it to create the polygon for the region
      const shape = new PCB_SHAPE(null, SHAPE_T.RECTANGLE);

      shape.SetStart(aElem.pos1);
      shape.SetEnd(aElem.pos2);
      shape.SetFilled(true);
      shape.SetStroke(new STROKE_PARAMS(0, LINE_STYLE.SOLID));

      if (aElem.rotation !== 0) {
        shape.Rotate(ALTIUM_PCB.fillCenter(aElem), new EDA_ANGLE(aElem.rotation));
      }

      this.HelperPcpShapeAsBoardKeepoutRegion(shape, aElem.layer, aElem.keepoutrestrictions);
    } else {
      for (const klayer of this.GetKicadLayersToIterate(aElem.layer))
        this.ConvertFills6ToBoardItemOnLayer(aElem, klayer);
    }
  }

  private ConvertFills6ToFootprintItem(
    aFootprint: FOOTPRINT,
    aElem: AFILL6,
    aIsBoardImport: boolean,
  ): void {
    if (aElem.is_keepout || aElem.layer === ALTIUM_LAYER.KEEP_OUT_LAYER) {
      // TODO: what about plane layers?
      // This is not the actual board item. We can use it to create the polygon for the region
      const shape = new PCB_SHAPE(null, SHAPE_T.RECTANGLE);

      shape.SetStart(aElem.pos1);
      shape.SetEnd(aElem.pos2);
      shape.SetFilled(true);
      shape.SetStroke(new STROKE_PARAMS(0, LINE_STYLE.SOLID));

      if (aElem.rotation !== 0) {
        shape.Rotate(ALTIUM_PCB.fillCenter(aElem), new EDA_ANGLE(aElem.rotation));
      }

      this.HelperPcpShapeAsFootprintKeepoutRegion(
        aFootprint,
        shape,
        aElem.layer,
        aElem.keepoutrestrictions,
      );
    } else if (
      aIsBoardImport &&
      IsAltiumLayerCopper(aElem.layer) &&
      aElem.net !== ALTIUM_NET_UNCONNECTED
    ) {
      // Special case: do to not lose net connections in footprints
      for (const klayer of this.GetKicadLayersToIterate(aElem.layer))
        this.ConvertFills6ToBoardItemOnLayer(aElem, klayer);
    } else {
      for (const klayer of this.GetKicadLayersToIterate(aElem.layer))
        this.ConvertFills6ToFootprintItemOnLayer(aFootprint, aElem, klayer);
    }
  }

  private ConvertFills6ToBoardItemOnLayer(aElem: AFILL6, aLayer: PCB_LAYER_ID): void {
    const fill = new PCB_SHAPE(this.m_board, SHAPE_T.RECTANGLE);

    fill.SetFilled(true);
    fill.SetLayer(aLayer);
    fill.SetStroke(new STROKE_PARAMS(0));

    fill.SetStart(aElem.pos1);
    fill.SetEnd(aElem.pos2);

    if (IsCopperLayer(aLayer) && aElem.net !== ALTIUM_NET_UNCONNECTED) {
      fill.SetNetCode(this.GetNetCode(aElem.net));
    }

    if (aElem.rotation !== 0) {
      // TODO: Do we need SHAPE_T::POLY for non 90° rotations?
      fill.Rotate(ALTIUM_PCB.fillCenter(aElem), new EDA_ANGLE(aElem.rotation));
    }

    this.m_board.Add(fill, ADD_MODE.APPEND);
  }

  private ConvertFills6ToFootprintItemOnLayer(
    aFootprint: FOOTPRINT,
    aElem: AFILL6,
    aLayer: PCB_LAYER_ID,
  ): void {
    if (aLayer === F_Cu || aLayer === B_Cu) {
      const pad = new PAD(aFootprint);

      const padLayers = new LSET();
      padLayers.set(aLayer);

      pad.SetAttribute(PAD_ATTRIB.SMD);
      const rotation = new EDA_ANGLE(aElem.rotation);

      // Handle rotation multiples of 90 degrees
      if (rotation.IsCardinal()) {
        pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.RECTANGLE);

        let width = Math.abs(aElem.pos2.x - aElem.pos1.x);
        let height = Math.abs(aElem.pos2.y - aElem.pos1.y);

        // Swap width and height for 90 or 270 degree rotations
        if (rotation.IsCardinal90()) [width, height] = [height, width];

        pad.SetSize(PADSTACK.ALL_LAYERS, { x: width, y: height });
        pad.SetPosition({
          x: Math.trunc(aElem.pos1.x / 2) + Math.trunc(aElem.pos2.x / 2),
          y: Math.trunc(aElem.pos1.y / 2) + Math.trunc(aElem.pos2.y / 2),
        });
      } else {
        pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CUSTOM);

        const anchorSize = Math.min(
          Math.abs(aElem.pos2.x - aElem.pos1.x),
          Math.abs(aElem.pos2.y - aElem.pos1.y),
        );
        const anchorPos = aElem.pos1;

        pad.SetAnchorPadShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
        pad.SetSize(PADSTACK.ALL_LAYERS, { x: anchorSize, y: anchorSize });
        pad.SetPosition(anchorPos);

        const shapePolys = new SHAPE_POLY_SET();
        shapePolys.NewOutline();
        shapePolys.Append(aElem.pos1.x - anchorPos.x, aElem.pos1.y - anchorPos.y);
        shapePolys.Append(aElem.pos2.x - anchorPos.x, aElem.pos1.y - anchorPos.y);
        shapePolys.Append(aElem.pos2.x - anchorPos.x, aElem.pos2.y - anchorPos.y);
        shapePolys.Append(aElem.pos1.x - anchorPos.x, aElem.pos2.y - anchorPos.y);
        shapePolys.Outline(0).SetClosed(true);

        const center = {
          x: Math.trunc(aElem.pos1.x / 2) + Math.trunc(aElem.pos2.x / 2) - anchorPos.x,
          y: Math.trunc(aElem.pos1.y / 2) + Math.trunc(aElem.pos2.y / 2) - anchorPos.y,
        };
        shapePolys.Rotate(new EDA_ANGLE(aElem.rotation), center);
        pad.AddPrimitivePoly(F_Cu, shapePolys, 0, true);
      }

      pad.SetThermalSpokeAngle(ANGLE_90);
      pad.SetLayerSet(padLayers);

      aFootprint.Add(pad, ADD_MODE.APPEND);
    } else {
      const fill = new PCB_SHAPE(aFootprint, SHAPE_T.RECTANGLE);

      fill.SetFilled(true);
      fill.SetLayer(aLayer);
      fill.SetStroke(new STROKE_PARAMS(0));

      fill.SetStart(aElem.pos1);
      fill.SetEnd(aElem.pos2);

      if (aElem.rotation !== 0) {
        fill.Rotate(ALTIUM_PCB.fillCenter(aElem), new EDA_ANGLE(aElem.rotation));
      }

      aFootprint.Add(fill, ADD_MODE.APPEND);
    }
  }

  private HelperSetZoneLayers(aZone: ZONE, aAltiumLayer: ALTIUM_LAYER): void {
    const layerSet = new LSET();

    for (const klayer of this.GetKicadLayersToIterate(aAltiumLayer)) layerSet.set(klayer);

    aZone.SetLayerSet(layerSet);
  }

  private HelperSetZoneKeepoutRestrictions(aZone: ZONE, aKeepoutRestrictions: number): void {
    const keepoutRestrictionVia = (aKeepoutRestrictions & 0x01) !== 0;
    const keepoutRestrictionTrack = (aKeepoutRestrictions & 0x02) !== 0;
    const keepoutRestrictionCopper = (aKeepoutRestrictions & 0x04) !== 0;
    const keepoutRestrictionSMDPad = (aKeepoutRestrictions & 0x08) !== 0;
    const keepoutRestrictionTHPad = (aKeepoutRestrictions & 0x10) !== 0;

    aZone.SetDoNotAllowVias(keepoutRestrictionVia);
    aZone.SetDoNotAllowTracks(keepoutRestrictionTrack);
    aZone.SetDoNotAllowZoneFills(keepoutRestrictionCopper);
    aZone.SetDoNotAllowPads(keepoutRestrictionSMDPad && keepoutRestrictionTHPad);
    aZone.SetDoNotAllowFootprints(false);
  }

  private HelperPcpShapeAsBoardKeepoutRegion(
    aShape: PCB_SHAPE,
    aAltiumLayer: ALTIUM_LAYER,
    aKeepoutRestrictions: number,
  ): void {
    const zone = new ZONE(this.m_board);

    zone.SetIsRuleArea(true);

    this.HelperSetZoneLayers(zone, aAltiumLayer);
    this.HelperSetZoneKeepoutRestrictions(zone, aKeepoutRestrictions);

    ALTIUM_PCB.edaShapeToPolygon(aShape, zone.Outline());

    zone.SetBorderDisplayStyle(
      ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
      ZONE.GetDefaultHatchPitch(),
      true,
    );

    this.m_board.Add(zone, ADD_MODE.APPEND);
  }

  private HelperPcpShapeAsFootprintKeepoutRegion(
    aFootprint: FOOTPRINT,
    aShape: PCB_SHAPE,
    aAltiumLayer: ALTIUM_LAYER,
    aKeepoutRestrictions: number,
  ): void {
    const zone = new ZONE(aFootprint);

    zone.SetIsRuleArea(true);

    this.HelperSetZoneLayers(zone, aAltiumLayer);
    this.HelperSetZoneKeepoutRestrictions(zone, aKeepoutRestrictions);

    ALTIUM_PCB.edaShapeToPolygon(aShape, zone.Outline());

    zone.SetBorderDisplayStyle(
      ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
      ZONE.GetDefaultHatchPitch(),
      true,
    );

    aFootprint.Add(zone, ADD_MODE.APPEND);
  }

  private HelperGetSolderAndPasteMaskExpansions(
    aType: ALTIUM_RECORD,
    aPrimitiveIndex: number,
    aAltiumLayer: ALTIUM_LAYER,
  ): [PCB_LAYER_ID, number][] {
    if (!this.m_extendedPrimitiveInformationMaps.has(aType)) return []; // there is nothing to parse

    // Upstream reads the TRACK map here whatever aType is.
    const elems = this.extendedInfo(ALTIUM_RECORD.TRACK, aPrimitiveIndex);

    if (elems.length === 0) return []; // there is nothing to parse

    const layerExpansionPairs: [PCB_LAYER_ID, number][] = [];

    for (const pInf of elems) {
      if (pInf.type === AEXTENDED_PRIMITIVE_INFORMATION_TYPE.MASK) {
        if (
          pInf.soldermaskexpansionmode === ALTIUM_MODE.MANUAL ||
          pInf.soldermaskexpansionmode === ALTIUM_MODE.RULE
        ) {
          // TODO: what layers can lead to solder or paste mask usage? E.g. KEEP_OUT_LAYER and other top/bottom layers
          if (
            aAltiumLayer === ALTIUM_LAYER.TOP_LAYER ||
            aAltiumLayer === ALTIUM_LAYER.MULTI_LAYER
          ) {
            layerExpansionPairs.push([F_Mask, pInf.soldermaskexpansionmanual]);
          }

          if (
            aAltiumLayer === ALTIUM_LAYER.BOTTOM_LAYER ||
            aAltiumLayer === ALTIUM_LAYER.MULTI_LAYER
          ) {
            layerExpansionPairs.push([B_Mask, pInf.soldermaskexpansionmanual]);
          }
        }
        if (
          pInf.pastemaskexpansionmode === ALTIUM_MODE.MANUAL ||
          pInf.pastemaskexpansionmode === ALTIUM_MODE.RULE
        ) {
          if (
            aAltiumLayer === ALTIUM_LAYER.TOP_LAYER ||
            aAltiumLayer === ALTIUM_LAYER.MULTI_LAYER
          ) {
            layerExpansionPairs.push([F_Paste, pInf.pastemaskexpansionmanual]);
          }

          if (
            aAltiumLayer === ALTIUM_LAYER.BOTTOM_LAYER ||
            aAltiumLayer === ALTIUM_LAYER.MULTI_LAYER
          ) {
            layerExpansionPairs.push([B_Paste, pInf.pastemaskexpansionmanual]);
          }
        }
      }
    }

    return layerExpansionPairs;
  }
}
