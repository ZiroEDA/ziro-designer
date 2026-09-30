// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/eagle/pcb_io_eagle.cpp` / `.h`: the Eagle 6.x XML board
 * (`.brd`) and footprint library (`.lbr`) importer.
 *
 * Browser deviations:
 *  - files are read through `IO_BASE::m_readFile`, not opened by path;
 *  - `LoadBoard` cannot write the `.kicad_dru` sidecar upstream writes next to
 *    the board when the Eagle classes carry a clearance matrix. The rules text
 *    is kept on the plugin (`GetCustomRules()`) for the caller to store;
 *  - `wxLogMessage` / `wxLogError` go to the plugin's reporter.
 */

import {
  ConvertArcCenter,
  convertDescription,
  EAGLE_LAYER,
  ECIRCLE,
  ECLASS,
  ECOORD,
  EAGLE_UNIT,
  EATTR,
  EDIMENSION,
  EELEMENT,
  EHOLE,
  ELAYER,
  ENET,
  EPAD,
  type EPAD_COMMON,
  EPOLYGON,
  ERECT,
  escapeName,
  ESMD,
  ETEXT,
  EURN,
  EVERTEX,
  EVIA,
  EWIRE,
  interpretText,
  MapChildren,
  opt_wxString,
  XML_PARSER_ERROR,
  XPATH,
} from '@ziroeda/common/io/eagle/eagle_parser.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { pcbIUScale, stringFromValue } from '@ziroeda/common/eda_units.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import {
  B_Adhes,
  B_CrtYd,
  B_Cu,
  B_Fab,
  B_Mask,
  B_Paste,
  B_SilkS,
  BoardLayerFromLegacyId,
  Cmts_User,
  CopperLayerToOrdinal,
  Dwgs_User,
  Eco1_User,
  Eco2_User,
  Edge_Cuts,
  F_Adhes,
  F_CrtYd,
  F_Cu,
  F_Fab,
  F_Mask,
  F_Paste,
  F_SilkS,
  IsCopperLayer,
  Margin,
  PCB_LAYER_ID,
  UNDEFINED_LAYER,
  UNSELECTED_LAYER,
  User_1,
  User_2,
  User_3,
  User_4,
  User_5,
  User_6,
  User_7,
  User_8,
  User_9,
} from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { atoi, ToCDouble } from '@ziroeda/common/libc/stdlib.js';
import { LSET } from '@ziroeda/common/lset.js';
import { NETCLASS } from '@ziroeda/common/netclass.js';
import { RPT_SEVERITY_ERROR, RPT_SEVERITY_INFO } from '@ziroeda/common/reporter.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { ReplaceIllegalFileNameChars, UnescapeHTML } from '@ziroeda/common/string_utils.js';
import { wxXmlDocumentLoad, wxXmlParseError, type wxXmlNode } from '@ziroeda/common/wx/xml.js';
import { wxCmp, wxCmpNoCase } from '@ziroeda/common/wx/wxstring.js';
import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import { RECT_CHAMFER_ALL } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import { ANGLE_0, ANGLE_360, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { GetArcToSegmentCount } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { CornerStrategy, SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { atan2, cos, hypot, sin } from '@ziroeda/kimath/src/math/libm.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { add, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { CalcArcMid, RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { BOARD } from '../../board.js';
import { ADD_MODE } from '../../board_item_container.js';
import { LAYER_T } from '../../board_types.js';
import {
  DEFAULT_COURTYARD_WIDTH,
  DEFAULT_EDGE_WIDTH,
  DEFAULT_LINE_WIDTH,
  DEFAULT_SILK_LINE_WIDTH,
} from '../../board_design_settings_defaults.js';
import { FOOTPRINT } from '../../footprint.js';
import { NETINFO_ITEM } from '../../netinfo_item.js';
import { NETINFO_LIST } from '../../netinfo_list.js';
import { PAD } from '../../pad.js';
import { PAD_ATTRIB, PAD_SHAPE, PADSTACK, PADSTACK_MODE } from '../../padstack.js';
import { DIM_PRECISION } from '../../pcb_dimension_types.js';
import { PCB_DIM_ALIGNED, PCB_DIM_LEADER, PCB_DIM_RADIAL } from '../../pcb_dimension.js';
import type { PCB_FIELD } from '../../pcb_field.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TEXT } from '../../pcb_text.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA } from '../../pcb_track.js';
import { VIATYPE } from '../../pcb_track_types.js';
import { ZONE } from '../../zone.js';
import {
  ISLAND_REMOVAL_MODE,
  ZONE_BORDER_DISPLAY_STYLE,
  ZONE_FILL_MODE,
} from '../../zone_settings.js';
import { ZONE_CONNECTION, ZONE_THICKNESS_MIN_VALUE_MM } from '../../zones.js';
import {
  type INPUT_LAYER_DESC,
  LAYER_MAPPABLE_PLUGIN,
  type LAYER_MAPPING_HANDLER,
} from '../common/plugin_common_layer_mapping.js';
import { PCB_IO, type PCB_IO_PROJECT, type PCB_IO_PROPERTIES } from '../pcb_io.js';

const INT_MAX = 2147483647;

/** `EDA_UNIT_UTILS::Mils2IU( pcbIUScale, mils )`. */
function Mils2IU(aMils: number): number {
  return Math.trunc(aMils * pcbIUScale.IU_PER_MILS);
}

/// Parse an eagle distance which is either mm, or mils if there is "mil" suffix.
/// Return is in BIU.
function parseEagle(aDistance: string): number {
  const unit = aDistance.includes('mil') ? EAGLE_UNIT.EU_MIL : EAGLE_UNIT.EU_MM;

  const coord = new ECOORD(aDistance, unit);

  return coord.ToPcbUnits();
}

// In Eagle one can specify DRC rules where min value > max value,
// in such case the max value has the priority
function eagleClamp(aMin: number, aValue: number, aMax: number): number {
  const ret = Math.max(aMin, aValue);
  return Math.min(aMax, ret);
}

/// Assemble a two part key as a simple concatenation of aFirst and aSecond parts,
/// using a separator.
function makeKey(aFirst: string, aSecond: string): string {
  return `${aFirst}\x02${aSecond}`;
}

/** `value.ToCDouble( &out )`: `out` takes whatever prefix converts, else is left alone. */
function toCDouble(aValue: string, aOld: number): number {
  return ToCDouble(aValue, aOld);
}

/** `std::map<wxString, T>` iteration: keys in `wxString::compare` order. */
function sortedByKey<T>(aMap: ReadonlyMap<string, T>): [string, T][] {
  return [...aMap].sort(([a], [b]) => wxCmp(a, b));
}

/// subset of eagle.drawing.board.designrules in the XML document
export class ERULES {
  ///< percent over 100%.  0-> not elongated, 100->twice as wide as is tall
  ///< Goes into making a scaling factor for "long" pads.
  psElongationLong = 100;
  psElongationOffset = 0; ///< the offset of the hole within the "long" pad.

  ///< solder mask, expressed as percentage of the smaller pad/via dimension
  mvStopFrame = 1.0;
  ///< solderpaste mask, expressed as percentage of the smaller pad/via dimension
  mvCreamFrame = 0.0;
  mlMinStopFrame = Mils2IU(4.0); ///< solder mask, minimum size (Eagle mils, here nanometers)
  mlMaxStopFrame = Mils2IU(4.0); ///< solder mask, maximum size (Eagle mils, here nanometers)
  mlMinCreamFrame = Mils2IU(0.0); ///< solder paste mask, minimum size
  mlMaxCreamFrame = Mils2IU(0.0); ///< solder paste mask, maximum size

  psTop = EPAD.UNDEF; ///< Shape of the top pads
  psBottom = EPAD.UNDEF; ///< Shape of the bottom pads
  psFirst = EPAD.UNDEF; ///< Shape of the first pads

  srRoundness = 0.0; ///< corner rounding ratio for SMD pads (percentage)
  ///< corner rounding radius, minimum size (Eagle mils, here nanometers)
  srMinRoundness = Mils2IU(0.0);
  ///< corner rounding radius, maximum size (Eagle mils, here nanometers)
  srMaxRoundness = Mils2IU(0.0);

  rvPadTop = 0.25; ///< top pad size as percent of drill size
  // double   rvPadBottom;    ///< bottom pad size as percent of drill size

  rlMinPadTop = Mils2IU(10); ///< Minimum top layer copper annulus on through hole pads.
  rlMaxPadTop = Mils2IU(20); ///< Maximum top layer copper annulus on through hole pads
  rlMinPadInner = 0.0; ///< Minimum inner layer copper annulus on through hole pads.
  rlMaxPadInner = 0.0; ///< Maximum inner layer copper annulus on through hole pads.
  rlMinPadBottom = 0.0; ///< Minimum bottom layer copper annulus on through hole pads.
  rlMaxPadBottom = 0.0; ///< Maximum bottom layer copper annulus on through hole pads.

  rvViaOuter = 0.25; ///< copper annulus is this percent of via hole
  rlMinViaOuter = Mils2IU(10); ///< minimum copper annulus on via
  rlMaxViaOuter = Mils2IU(20); ///< maximum copper annulus on via
  mdWireWire = 0; ///< wire to wire spacing I presume.

  parse(aRules: wxXmlNode, aCheckpoint: () => void): void {
    let child = aRules.GetChildren();

    while (child) {
      aCheckpoint();

      if (child.GetName() === 'param') {
        const name = child.GetAttribute('name');
        const value = child.GetAttribute('value');

        if (name === 'psElongationLong') this.psElongationLong = atoi(value);
        else if (name === 'psElongationOffset') this.psElongationOffset = atoi(value);
        else if (name === 'mvStopFrame') this.mvStopFrame = toCDouble(value, this.mvStopFrame);
        else if (name === 'mvCreamFrame') this.mvCreamFrame = toCDouble(value, this.mvCreamFrame);
        else if (name === 'mlMinStopFrame') this.mlMinStopFrame = parseEagle(value);
        else if (name === 'mlMaxStopFrame') this.mlMaxStopFrame = parseEagle(value);
        else if (name === 'mlMinCreamFrame') this.mlMinCreamFrame = parseEagle(value);
        else if (name === 'mlMaxCreamFrame') this.mlMaxCreamFrame = parseEagle(value);
        else if (name === 'srRoundness') this.srRoundness = toCDouble(value, this.srRoundness);
        else if (name === 'srMinRoundness') this.srMinRoundness = parseEagle(value);
        else if (name === 'srMaxRoundness') this.srMaxRoundness = parseEagle(value);
        else if (name === 'psTop') this.psTop = atoi(value);
        else if (name === 'psBottom') this.psBottom = atoi(value);
        else if (name === 'psFirst') this.psFirst = atoi(value);
        else if (name === 'rvPadTop') this.rvPadTop = toCDouble(value, this.rvPadTop);
        else if (name === 'rlMinPadTop') this.rlMinPadTop = parseEagle(value);
        else if (name === 'rlMaxPadTop') this.rlMaxPadTop = parseEagle(value);
        else if (name === 'rlMinPadInner') this.rlMinPadInner = parseEagle(value);
        else if (name === 'rlMaxPadInner') this.rlMaxPadInner = parseEagle(value);
        else if (name === 'rlMinPadBottom') this.rlMinPadBottom = parseEagle(value);
        else if (name === 'rlMaxPadBottom') this.rlMaxPadBottom = parseEagle(value);
        else if (name === 'rvViaOuter') this.rvViaOuter = toCDouble(value, this.rvViaOuter);
        else if (name === 'rlMinViaOuter') this.rlMinViaOuter = parseEagle(value);
        else if (name === 'rlMaxViaOuter') this.rlMaxViaOuter = parseEagle(value);
        else if (name === 'mdWireWire') this.mdWireWire = parseEagle(value);
      }

      child = child.GetNext();
    }
  }
}

const DIMENSION_PRECISION = DIM_PRECISION.X_XX; // 0.01 mm

type ALIGN = [GR_TEXT_V_ALIGN_T, GR_TEXT_H_ALIGN_T];

const V = GR_TEXT_V_ALIGN_T;
const H = GR_TEXT_H_ALIGN_T;

const ALIGNMENT_MAP: ReadonlyArray<[number, ALIGN]> = [
  [ETEXT.BOTTOM_LEFT, [V.GR_TEXT_V_ALIGN_BOTTOM, H.GR_TEXT_H_ALIGN_LEFT]],
  [ETEXT.BOTTOM_RIGHT, [V.GR_TEXT_V_ALIGN_BOTTOM, H.GR_TEXT_H_ALIGN_RIGHT]],
  [ETEXT.BOTTOM_CENTER, [V.GR_TEXT_V_ALIGN_BOTTOM, H.GR_TEXT_H_ALIGN_CENTER]],
  [ETEXT.CENTER_RIGHT, [V.GR_TEXT_V_ALIGN_CENTER, H.GR_TEXT_H_ALIGN_RIGHT]],
  [ETEXT.CENTER, [V.GR_TEXT_V_ALIGN_CENTER, H.GR_TEXT_H_ALIGN_CENTER]],
  [ETEXT.CENTER_LEFT, [V.GR_TEXT_V_ALIGN_CENTER, H.GR_TEXT_H_ALIGN_LEFT]],
  [ETEXT.TOP_CENTER, [V.GR_TEXT_V_ALIGN_TOP, H.GR_TEXT_H_ALIGN_CENTER]],
  [ETEXT.TOP_LEFT, [V.GR_TEXT_V_ALIGN_TOP, H.GR_TEXT_H_ALIGN_LEFT]],
  [ETEXT.TOP_RIGHT, [V.GR_TEXT_V_ALIGN_TOP, H.GR_TEXT_H_ALIGN_RIGHT]],
];

export function KiCadAlignmentFromEagle(aAlign: number): ALIGN {
  const hit = ALIGNMENT_MAP.find(([a]) => a === aAlign);

  // operator[] on a missing key: a value-initialised tuple, both enums 0 (centre)
  return hit ? hit[1] : [0 as GR_TEXT_V_ALIGN_T, 0 as GR_TEXT_H_ALIGN_T];
}

export function EagleAlignmentFromKiCad(aAlign: ALIGN): number {
  const hit = ALIGNMENT_MAP.find(([, [v, h]]) => v === aAlign[0] && h === aAlign[1]);

  return hit ? hit[0] : 0;
}

export function EaglePcbTextToKiCadAlignment(
  aTxt: PCB_TEXT,
  aTxtAlign: number,
  aTxtDegrees: number,
  aTxtMirror: boolean,
  aTxtSpin: boolean,
  aElementDegrees = 0.0,
  aElementMirror = false,
  aElementSpin = false,
): void {
  let align = aTxtAlign;

  const spin = aTxtSpin !== aElementSpin;
  const mirror = aTxtMirror !== aElementMirror;

  const textDefDegrees = new EDA_ANGLE(aTxtDegrees).Normalize().AsDegrees();
  const elementDegrees = new EDA_ANGLE(aElementDegrees).Normalize().AsDegrees();
  let degrees = (aTxtMirror ? -1.0 : 1.0) * textDefDegrees + elementDegrees;
  degrees = new EDA_ANGLE(degrees).Normalize().AsDegrees();

  if (!spin) {
    if (
      (!aTxtMirror && degrees > 90 && degrees <= 270) ||
      (aTxtMirror && degrees >= 90 && degrees < 270)
    ) {
      align = -align;
      degrees = degrees - 180;
    }
  }

  if (aElementMirror) degrees = -degrees;

  aTxt.SetTextAngle(new EDA_ANGLE(degrees).Normalize());
  aTxt.SetMirrored(mirror);
  aTxt.SetKeepUpright(false); // we just aligned the text exactly as EAGLE does

  const [valign, halign] = KiCadAlignmentFromEagle(align);

  aTxt.SetHorizJustify(halign);
  aTxt.SetVertJustify(valign);
}

/** `NET_MAP`: `std::map<wxString, ENET>`. */
type NET_MAP = Map<string, ENET>;

export class PCB_IO_EAGLE extends PCB_IO {
  private readonly m_layerMappable = new LAYER_MAPPABLE_PLUGIN();

  private m_cu_map: number[] = new Array(17).fill(-1); ///< map eagle to KiCad, cu layers only.
  private m_eagleLayers = new Map<number, ELAYER>(); ///< Eagle layer data stored by layer number
  private m_eagleLayersIds = new Map<string, number>(); ///< Eagle layer ids stored by layer name
  private m_layer_map = new Map<string, PCB_LAYER_ID>(); ///< Map of Eagle layers to KiCad layers

  ///< Eagle class number to KiCad netclass
  private m_classMap = new Map<string, NETCLASS>();

  private m_customRules = '';

  private m_rules = new ERULES(); ///< Eagle design rules.
  private m_xpath = new XPATH(); ///< keeps track of what we are working on within
  ///< XML document during a Load().

  private m_hole_count = 0; ///< generates unique footprint names from eagle "hole"s.

  private m_pads_to_nets: NET_MAP = new Map(); ///< net list

  /** is part of a FOOTPRINT factory that operates using copy construction. */
  private m_templates = new Map<string, FOOTPRINT>();

  private m_doneCount = 0;
  private m_lastProgressCount = 0;
  private m_totalCount = 0; ///< for progress reporting

  private m_min_trace = 0; ///< smallest trace we find on Load(), in BIU.
  private m_min_hole = 0; ///< smallest diameter hole we find on Load(), in BIU.
  private m_min_via = 0; ///< smallest via we find on Load(), in BIU.
  private m_min_annulus = 0; ///< smallest via annulus we find on Load(), in BIU.

  private m_lib_path = '';
  private m_timestamp = 0;

  constructor() {
    super('Eagle');

    this.init(null);
    this.clear_cu_map();
    this.RegisterCallback((aDescs) => this.DefaultLayerMappingCallback(aDescs));
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Eagle ver. 6.x XML PCB files', ['brd']);
  }

  GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('Eagle ver. 6.x XML library files', ['lbr']);
  }

  RegisterCallback(aLayerMappingHandler: LAYER_MAPPING_HANDLER): void {
    this.m_layerMappable.RegisterCallback(aLayerMappingHandler);
  }

  /** The `.kicad_dru` text upstream writes beside the board (see the file header). */
  GetCustomRules(): string {
    return this.m_customRules;
  }

  override CanReadBoard(aFileName: string): boolean {
    if (!super.CanReadBoard(aFileName)) return false;

    return this.checkHeader(aFileName);
  }

  override CanReadLibrary(aFileName: string): boolean {
    if (!super.CanReadLibrary(aFileName)) return false;

    return this.checkHeader(aFileName);
  }

  override CanReadFootprint(aFileName: string): boolean {
    return this.CanReadLibrary(aFileName);
  }

  private checkHeader(aFileName: string): boolean {
    const data = this.m_readFile(aFileName);

    if (!data) return false;

    // wxTextInputStream::ReadLine over the first eight lines
    const text = new TextDecoder('utf-8').decode(data.subarray(0, 65536));
    const lines = text.split(/\r\n|\r|\n/);

    for (let i = 0; i < 8; i++) {
      if (i >= lines.length || (i === lines.length - 1 && lines[i] === '')) return false;

      if (lines[i]!.includes('<eagle')) return true;
    }

    return false;
  }

  private checkpoint(): void {
    const PROGRESS_DELTA = 50;

    if (this.m_progressReporter) {
      if (++this.m_doneCount > this.m_lastProgressCount + PROGRESS_DELTA) {
        this.m_progressReporter.SetCurrentProgress(
          this.m_doneCount / Math.max(1, this.m_totalCount),
        );

        if (!this.m_progressReporter.KeepRefreshing())
          throw new IO_ERROR('File import canceled by user.');

        this.m_lastProgressCount = this.m_doneCount;
      }
    }
  }

  /// Convert an Eagle distance to a KiCad distance.
  private kicad_y(y: ECOORD): number {
    return -y.ToPcbUnits() | 0;
  }

  private kicad_x(x: ECOORD): number {
    return x.ToPcbUnits();
  }

  /// create a font size (fontz) from an eagle font size scalar and KiCad font thickness
  private kicad_fontsize(d: ECOORD, aTextThickness: number): VECTOR2I {
    // Eagle includes stroke thickness in the text size, KiCAD does not
    const kz = d.ToPcbUnits();
    return { x: kz - aTextThickness, y: kz - aTextThickness };
  }

  private wxLogMessage(aMsg: string): void {
    this.Report(aMsg, RPT_SEVERITY_INFO);
  }

  private wxLogError(aMsg: string): void {
    this.Report(aMsg, RPT_SEVERITY_ERROR);
  }

  override LoadBoard(
    aFileName: string,
    aAppendToMe: BOARD | null,
    aProperties: PCB_IO_PROPERTIES | null = null,
    _aProject: PCB_IO_PROJECT | null = null,
  ): BOARD {
    this.init(aProperties);

    const board = aAppendToMe ?? new BOARD();
    this.m_board = board;

    // Give the filename to the board if it's new
    if (!aAppendToMe) board.SetFileName(aFileName);

    try {
      if (this.m_progressReporter) {
        this.m_progressReporter.Report(`Loading ${aFileName}...`);

        if (!this.m_progressReporter.KeepRefreshing())
          throw new IO_ERROR('File import canceled by user.');
      }

      // Load the document
      const data = this.m_readFile(aFileName);
      let doc: wxXmlNode;

      try {
        if (!data) throw new wxXmlParseError('no file');

        doc = wxXmlDocumentLoad(new TextDecoder('utf-8').decode(data));
      } catch (e) {
        if (!(e instanceof wxXmlParseError)) throw e;

        throw new IO_ERROR(`Unable to read file '${aFileName}'`);
      }

      this.m_min_trace = INT_MAX;
      this.m_min_hole = INT_MAX;
      this.m_min_via = INT_MAX;
      this.m_min_annulus = INT_MAX;

      this.loadAllSections(doc);

      const bds = board.GetDesignSettings();

      if (this.m_min_trace < bds.m_TrackMinWidth) bds.m_TrackMinWidth = this.m_min_trace;

      if (this.m_min_via < bds.m_ViasMinSize) bds.m_ViasMinSize = this.m_min_via;

      if (this.m_min_hole < bds.m_MinThroughDrill) bds.m_MinThroughDrill = this.m_min_hole;

      if (this.m_min_annulus < bds.m_ViasMinAnnularWidth)
        bds.m_ViasMinAnnularWidth = this.m_min_annulus;

      if (this.m_rules.mdWireWire) bds.m_MinClearance = KiROUND(this.m_rules.mdWireWire);

      const defaults = new NETCLASS('dummy');

      const finishNetclass = (netclass: NETCLASS): void => {
        // If Eagle has a clearance matrix then we'll build custom rules from that.
        // For classes with a clearance-to-default, use that; otherwise use board minimum.
        if (!netclass.HasClearance()) netclass.SetClearance(KiROUND(bds.m_MinClearance));

        if (netclass.GetTrackWidth() === INT_MAX) netclass.SetTrackWidth(defaults.GetTrackWidth());

        if (netclass.GetViaDiameter() === INT_MAX)
          netclass.SetViaDiameter(defaults.GetViaDiameter());

        if (netclass.GetViaDrill() === INT_MAX) netclass.SetViaDrill(defaults.GetViaDrill());
      };

      const netSettings = bds.m_NetSettings;

      finishNetclass(netSettings.GetDefaultNetclass());

      for (const [, netclass] of sortedByKey(netSettings.GetNetclasses())) finishNetclass(netclass);

      board.m_LegacyNetclassesLoaded = true;
      board.m_LegacyDesignSettingsLoaded = true;

      // Only emit a design rules sidecar when the Eagle board carried an actual
      // clearance matrix. A version-only file has no rules and is just clutter.
      // (Not written here: see GetCustomRules() and the file header.)

      // should be empty, else missing m_xpath->pop()
      console.assert(this.m_xpath.Contents().length === 0);
    } catch (exc) {
      if (exc instanceof XML_PARSER_ERROR) {
        let errmsg = exc.message;
        errmsg += '\n@ ';
        errmsg += this.m_xpath.Contents();

        throw new IO_ERROR(errmsg);
      }

      throw exc;
    }

    // IO_ERROR exceptions are left uncaught, they pass upwards from here.

    board.SetCopperLayerCount(this.getMinimumCopperLayerCount());

    const enabledLayers = new LSET(board.GetDesignSettings().GetEnabledLayers());

    for (const [, layer] of this.m_layer_map) {
      if (layer >= 0 && layer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT) enabledLayers.set(layer);
    }

    board.GetDesignSettings().SetEnabledLayers(enabledLayers);

    this.centerBoard();

    return board;
  }

  override GetImportedCachedLibraryFootprints(): FOOTPRINT[] {
    const retval: FOOTPRINT[] = [];

    for (const [, footprint] of sortedByKey(this.m_templates))
      retval.push(footprint.Clone() as FOOTPRINT);

    return retval;
  }

  /// initialize PLUGIN like a constructor would, and futz with fresh BOARD if needed.
  private init(aProperties: PCB_IO_PROPERTIES | null): void {
    this.m_hole_count = 0;
    this.m_min_trace = 0;
    this.m_min_hole = 0;
    this.m_min_via = 0;
    this.m_min_annulus = 0;
    this.m_xpath.clear();
    this.m_pads_to_nets.clear();

    this.m_board = null;
    this.m_props = aProperties;

    this.m_rules = new ERULES();
  }

  private clear_cu_map(): void {
    // All cu layers are invalid until we see them in the <layers> section while
    // loading either a board or library.  See loadLayerDefs().
    for (let i = 0; i < this.m_cu_map.length; ++i) this.m_cu_map[i] = -1;
  }

  private loadAllSections(aDoc: wxXmlNode): void {
    const drawing = MapChildren(aDoc).get('drawing') ?? null;
    const drawingChildren = MapChildren(drawing);

    const board = drawingChildren.get('board') ?? null;
    const boardChildren = MapChildren(board);

    const count_children = (aNode: wxXmlNode | null): void => {
      if (aNode) {
        let child = aNode.GetChildren();

        while (child) {
          this.m_totalCount++;
          child = child.GetNext();
        }
      }
    };

    const designrules = boardChildren.get('designrules') ?? null;
    const layers = drawingChildren.get('layers') ?? null;
    const plain = boardChildren.get('plain') ?? null;
    const classes = boardChildren.get('classes') ?? null;
    const signals = boardChildren.get('signals') ?? null;
    let libs = boardChildren.get('libraries') ?? null;
    const elems = boardChildren.get('elements') ?? null;

    if (this.m_progressReporter) {
      this.m_totalCount = 0;
      this.m_doneCount = 0;

      count_children(designrules);
      count_children(layers);
      count_children(plain);
      count_children(signals);
      count_children(elems);

      while (libs) {
        count_children(MapChildren(libs).get('packages') ?? null);
        libs = libs.GetNext();
      }

      // Rewind
      libs = boardChildren.get('libraries') ?? null;
    }

    this.m_xpath.push('eagle.drawing');

    {
      this.m_xpath.push('board');

      this.loadDesignRules(designrules);

      this.m_xpath.pop();
    }

    {
      this.m_xpath.push('layers');

      this.loadLayerDefs(layers);
      this.mapEagleLayersToKicad();

      this.m_xpath.pop();
    }

    {
      this.m_xpath.push('board');

      this.loadPlain(plain);
      this.loadClasses(classes);
      this.loadSignals(signals);
      this.loadLibraries(libs);
      this.loadElements(elems);

      this.m_xpath.pop();
    }

    this.m_xpath.pop(); // "eagle.drawing"
  }

  private loadDesignRules(aDesignRules: wxXmlNode | null): void {
    if (aDesignRules) {
      this.m_xpath.push('designrules');
      this.m_rules.parse(aDesignRules, () => this.checkpoint());
      this.m_xpath.pop(); // "designrules"
    }
  }

  private loadLayerDefs(aLayers: wxXmlNode | null): void {
    if (!aLayers) return;

    const cu: ELAYER[] = []; // copper layers

    // Get the first layer and iterate
    let layerNode = aLayers.GetChildren();

    this.m_eagleLayers.clear();
    this.m_eagleLayersIds.clear();

    while (layerNode) {
      const elayer = new ELAYER(layerNode);

      // std::map::insert: the first of a key stays
      if (!this.m_eagleLayers.has(elayer.number)) this.m_eagleLayers.set(elayer.number, elayer);
      if (!this.m_eagleLayersIds.has(elayer.name))
        this.m_eagleLayersIds.set(elayer.name, elayer.number);

      // find the subset of layers that are copper and active
      if (
        elayer.number >= 1 &&
        elayer.number <= 16 &&
        (elayer.active === undefined || elayer.active)
      ) {
        cu.push(elayer);
      }

      layerNode = layerNode.GetNext();
    }

    // establish cu layer map:
    let ki_layer_count = 0;

    for (let it = 0; it < cu.length; ++it, ++ki_layer_count) {
      const number = cu[it]!.number;

      if (ki_layer_count === 0) {
        this.m_cu_map[number] = F_Cu;
      } else if (ki_layer_count === cu.length - 1) {
        this.m_cu_map[number] = B_Cu;
      } else {
        // some eagle boards do not have contiguous layer number sequences.
        this.m_cu_map[number] = BoardLayerFromLegacyId(ki_layer_count);
      }
    }

    // Set the layer names and cu count if we're loading a board.
    if (this.m_board) {
      this.m_board.SetCopperLayerCount(cu.length);

      for (const it of cu) {
        const layer = this.kicad_layer(it.number);

        // these function provide their own protection against non enabled layers:
        if (layer >= 0 && layer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT) {
          // layer should be valid
          this.m_board.SetLayerName(layer, it.name);
          this.m_board.SetLayerType(layer, LAYER_T.LT_SIGNAL);
        }

        // could map the colors here
      }
    }
  }

  private loadPlain(aGraphics: wxXmlNode | null): void {
    if (!aGraphics) return;

    const board = this.m_board!;

    this.m_xpath.push('plain');

    // Get the first graphic and iterate
    let gr = aGraphics.GetChildren();

    // (polygon | wire | text | circle | rectangle | frame | hole)*
    while (gr) {
      this.checkpoint();

      const grName = gr.GetName();

      if (grName === 'wire') {
        this.m_xpath.push('wire');

        const w = new EWIRE(gr);
        const layer = this.kicad_layer(w.layer);
        const start = { x: this.kicad_x(w.x1), y: this.kicad_y(w.y1) };
        const end = { x: this.kicad_x(w.x2), y: this.kicad_y(w.y2) };

        if (layer !== UNDEFINED_LAYER) {
          const shape = new PCB_SHAPE(board);
          let width = w.width.ToPcbUnits();

          // KiCad cannot handle zero or negative line widths
          if (width <= 0) width = board.GetDesignSettings().GetLineThickness(layer);

          board.Add(shape, ADD_MODE.APPEND);

          if (w.curve === undefined) {
            shape.SetShape(SHAPE_T.SEGMENT);
            shape.SetStart(start);
            shape.SetEnd(end);
          } else {
            const center = ConvertArcCenter(start, end, w.curve);

            shape.SetShape(SHAPE_T.ARC);
            shape.SetCenter(center);
            shape.SetStart(start);
            shape.SetArcAngleAndEnd(new EDA_ANGLE(w.curve).negate(), true); // KiCad rotates the other way
          }

          shape.SetLayer(layer);
          shape.SetStroke(new STROKE_PARAMS(width, LINE_STYLE.SOLID));
        }

        this.m_xpath.pop();
      } else if (grName === 'text') {
        this.m_xpath.push('text');

        const t = new ETEXT(gr);
        const layer = this.kicad_layer(t.layer);

        if (layer !== UNDEFINED_LAYER) {
          const pcbtxt = new PCB_TEXT(board);
          board.Add(pcbtxt, ADD_MODE.APPEND);

          pcbtxt.SetLayer(layer);
          const kicadText = interpretText(t.text);
          pcbtxt.SetText(kicadText);

          const ratio = t.ratio !== undefined ? t.ratio : 8; // DTD says 8 is default
          const textThickness = KiROUND((t.size.ToPcbUnits() * ratio) / 100.0);
          pcbtxt.SetTextThickness(textThickness);
          pcbtxt.SetTextSize(this.kicad_fontsize(t.size, textThickness));
          pcbtxt.SetKeepUpright(false);

          const eagleAnchor = { x: this.kicad_x(t.x), y: this.kicad_y(t.y) };
          pcbtxt.SetTextPos(eagleAnchor);

          const align = t.align !== undefined ? t.align : ETEXT.BOTTOM_LEFT;
          const degrees = t.rot ? t.rot.degrees : 0.0;
          const mirror = t.rot ? t.rot.mirror : false;
          const spin = t.rot ? t.rot.spin : false;

          EaglePcbTextToKiCadAlignment(pcbtxt, align, degrees, mirror, spin);
        }

        this.m_xpath.pop();
      } else if (grName === 'circle') {
        this.m_xpath.push('circle');

        const c = new ECIRCLE(gr);

        const width = c.width.ToPcbUnits();
        const radius = c.radius.ToPcbUnits();

        if (
          c.layer === EAGLE_LAYER.TRESTRICT ||
          c.layer === EAGLE_LAYER.BRESTRICT ||
          c.layer === EAGLE_LAYER.VRESTRICT
        ) {
          const zone = new ZONE(board);
          board.Add(zone, ADD_MODE.APPEND);

          this.setKeepoutSettingsToZone(zone, c.layer);

          this.appendCircleOutline(
            zone,
            { x: this.kicad_x(c.x), y: this.kicad_y(c.y) },
            radius,
            width,
          );
        } else {
          const layer = this.kicad_layer(c.layer);

          if (layer !== UNDEFINED_LAYER) {
            // unsupported layer
            const shape = new PCB_SHAPE(board, SHAPE_T.CIRCLE);
            board.Add(shape, ADD_MODE.APPEND);
            shape.SetFilled(false);
            shape.SetLayer(layer);
            shape.SetStart({ x: this.kicad_x(c.x), y: this.kicad_y(c.y) });
            shape.SetEnd({ x: this.kicad_x(c.x) + radius, y: this.kicad_y(c.y) });
            shape.SetStroke(new STROKE_PARAMS(width, LINE_STYLE.SOLID));
          }
        }

        this.m_xpath.pop();
      } else if (grName === 'rectangle') {
        // This seems to be a simplified rectangular [copper] zone, cannot find any
        // net related info on it from the DTD.
        this.m_xpath.push('rectangle');

        const r = new ERECT(gr);
        const layer = this.kicad_layer(r.layer);

        if (layer !== UNDEFINED_LAYER) {
          const zone = new ZONE(board);

          board.Add(zone, ADD_MODE.APPEND);

          zone.SetLayer(layer);
          zone.SetNetCode(NETINFO_LIST.UNCONNECTED);

          const outline_hatch = ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE;

          const outlineIdx = -1; // this is the id of the copper zone main outline
          zone.AppendCorner({ x: this.kicad_x(r.x1), y: this.kicad_y(r.y1) }, outlineIdx);
          zone.AppendCorner({ x: this.kicad_x(r.x2), y: this.kicad_y(r.y1) }, outlineIdx);
          zone.AppendCorner({ x: this.kicad_x(r.x2), y: this.kicad_y(r.y2) }, outlineIdx);
          zone.AppendCorner({ x: this.kicad_x(r.x1), y: this.kicad_y(r.y2) }, outlineIdx);

          if (r.rot) {
            const center = {
              x: Math.trunc((this.kicad_x(r.x1) + this.kicad_x(r.x2)) / 2),
              y: Math.trunc((this.kicad_y(r.y1) + this.kicad_y(r.y2)) / 2),
            };
            zone.Rotate(center, new EDA_ANGLE(r.rot.degrees));
          }

          // this is not my fault:
          zone.SetBorderDisplayStyle(outline_hatch, ZONE.GetDefaultHatchPitch(), true);
        }

        this.m_xpath.pop();
      } else if (grName === 'hole') {
        this.m_xpath.push('hole');

        // Fabricate a FOOTPRINT with a single PAD_ATTRIB::NPTH pad.
        // Use m_hole_count to gen up a unique reference designator.
        const footprint = new FOOTPRINT(board);
        board.Add(footprint, ADD_MODE.APPEND);
        const hole_count = this.m_hole_count++;
        footprint.SetReference(`UNK_HOLE_${hole_count}`);
        footprint.Reference().SetVisible(false);
        // Mandatory: gives a dummy but valid LIB_ID
        const fpid = new LIB_ID('', `dummyfp${hole_count}`);
        footprint.SetFPID(fpid);
        this.packageHole(footprint, gr, true);

        this.m_xpath.pop();
      } else if (grName === 'frame') {
        // picture this
      } else if (grName === 'polygon') {
        this.m_xpath.push('polygon');
        this.loadPolygon(gr);
        this.m_xpath.pop(); // "polygon"
      } else if (grName === 'dimension') {
        const designSettings = board.GetDesignSettings();

        const d = new EDIMENSION(gr);
        const layer = this.kicad_layer(d.layer);
        const pt1 = { x: this.kicad_x(d.x1), y: this.kicad_y(d.y1) };
        const pt2 = { x: this.kicad_x(d.x2), y: this.kicad_y(d.y2) };
        const pt3 = { x: this.kicad_x(d.x3), y: this.kicad_y(d.y3) };
        let textSize = designSettings.GetTextSize(layer);
        let textThickness = designSettings.GetLineThickness(layer);

        if (d.textsize) {
          const ratio = 8; // DTD says 8 is default
          textThickness = KiROUND((d.textsize.ToPcbUnits() * ratio) / 100.0);
          textSize = this.kicad_fontsize(d.textsize, textThickness);
        }

        if (layer !== UNDEFINED_LAYER) {
          if (d.dimensionType === 'angle') {
            // Kicad doesn't (at present) support angle dimensions
          } else if (d.dimensionType === 'radius') {
            const dimension = new PCB_DIM_RADIAL(board);
            board.Add(dimension, ADD_MODE.APPEND);

            dimension.SetLayer(layer);
            dimension.SetPrecision(DIMENSION_PRECISION);

            dimension.SetStart(pt1);
            dimension.SetEnd(pt2);
            dimension.SetTextPos(pt3);
            dimension.SetTextSize(textSize);
            dimension.SetTextThickness(textThickness);
            dimension.SetLineThickness(designSettings.GetLineThickness(layer));
            dimension.SetUnits('mm');
          } else if (d.dimensionType === 'leader') {
            const leader = new PCB_DIM_LEADER(board);
            board.Add(leader, ADD_MODE.APPEND);

            leader.SetLayer(layer);
            leader.SetPrecision(DIMENSION_PRECISION);

            leader.SetStart(pt1);
            leader.SetEnd(pt2);
            leader.SetTextPos(pt3);
            leader.SetTextSize(textSize);
            leader.SetTextThickness(textThickness);
            leader.SetOverrideText('');
            leader.SetLineThickness(designSettings.GetLineThickness(layer));
          } else {
            // horizontal, vertical, <default>, diameter
            const dimension = new PCB_DIM_ALIGNED(board);
            board.Add(dimension, ADD_MODE.APPEND);

            if (d.dimensionType !== undefined) {
              // Eagle dimension graphic arms may have different lengths, but they look
              // incorrect in KiCad (the graphic is tilted). Make them even length in
              // such case.
              if (d.dimensionType === 'horizontal') {
                const newY = Math.trunc((pt1.y + pt2.y) / 2);
                pt1.y = newY;
                pt2.y = newY;
              } else if (d.dimensionType === 'vertical') {
                const newX = Math.trunc((pt1.x + pt2.x) / 2);
                pt1.x = newX;
                pt2.x = newX;
              }
            }

            dimension.SetLayer(layer);
            dimension.SetPrecision(DIMENSION_PRECISION);

            // The origin and end are assumed to always be in this order from eagle
            dimension.SetStart(pt1);
            dimension.SetEnd(pt2);
            dimension.SetTextSize(textSize);
            dimension.SetTextThickness(textThickness);
            dimension.SetLineThickness(designSettings.GetLineThickness(layer));
            dimension.SetUnits('mm');

            // check which axis the dimension runs in
            // because the "height" of the dimension is perpendicular to that axis
            // Note the check is just if two axes are close enough to each other
            // Eagle appears to have some rounding errors
            if (Math.abs(pt1.x - pt2.x) < 50000) {
              // 50000 nm = 0.05 mm
              const offset = pt3.x - pt1.x;

              if (pt1.y > pt2.y) dimension.SetHeight(offset);
              else dimension.SetHeight(-offset);
            } else if (Math.abs(pt1.y - pt2.y) < 50000) {
              const offset = pt3.y - pt1.y;

              if (pt1.x > pt2.x) dimension.SetHeight(-offset);
              else dimension.SetHeight(offset);
            } else {
              // VECTOR2I::Distance: ( pt3 - pt1 ).EuclideanNorm(), std::hypot
              const offset = KiROUND(hypot(pt3.x - pt1.x, pt3.y - pt1.y));

              if (pt1.y > pt2.y) dimension.SetHeight(offset);
              else dimension.SetHeight(-offset);
            }
          }
        }
      }

      // Get next graphic
      gr = gr.GetNext();
    }

    this.m_xpath.pop();
  }

  /** The circle-as-polygon keepout outline `loadPlain` and `packageCircle` both build. */
  private appendCircleOutline(aZone: ZONE, center: VECTOR2I, radius: number, width: number): void {
    // approximate circle as polygon
    const outlineRadius = radius + Math.trunc(width / 2);
    let segsInCircle = GetArcToSegmentCount(outlineRadius, ARC_HIGH_DEF, ANGLE_360);
    let delta = ANGLE_360.divide(segsInCircle);

    for (let angle = ANGLE_0; angle.lt(ANGLE_360); angle = angle.add(delta)) {
      const rotatedPoint = RotatePoint({ x: outlineRadius, y: 0 }, angle);
      aZone.AppendCorner(add(center, rotatedPoint), -1);
    }

    if (width > 0) {
      aZone.NewHole();
      const innerRadius = radius - Math.trunc(width / 2);
      segsInCircle = GetArcToSegmentCount(innerRadius, ARC_HIGH_DEF, ANGLE_360);
      delta = ANGLE_360.divide(segsInCircle);

      for (let angle = ANGLE_0; angle.lt(ANGLE_360); angle = angle.add(delta)) {
        const rotatedPoint = RotatePoint({ x: innerRadius, y: 0 }, angle);
        aZone.AppendCorner(add(center, rotatedPoint), 0);
      }
    }

    aZone.SetBorderDisplayStyle(
      ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
      ZONE.GetDefaultHatchPitch(),
      true,
    );
  }

  private setKeepoutSettingsToZone(aZone: ZONE, aLayer: number): void {
    if (aLayer === EAGLE_LAYER.TRESTRICT || aLayer === EAGLE_LAYER.BRESTRICT) {
      aZone.SetIsRuleArea(true);
      aZone.SetDoNotAllowVias(true);
      aZone.SetDoNotAllowTracks(true);
      aZone.SetDoNotAllowZoneFills(true);
      aZone.SetDoNotAllowPads(true);
      aZone.SetDoNotAllowFootprints(false);

      if (aLayer === EAGLE_LAYER.TRESTRICT)
        // front layer keepout
        aZone.SetLayer(F_Cu);
      // bottom layer keepout
      else aZone.SetLayer(B_Cu);
    } else if (aLayer === EAGLE_LAYER.VRESTRICT) {
      aZone.SetIsRuleArea(true);
      aZone.SetDoNotAllowVias(true);
      aZone.SetDoNotAllowTracks(false);
      aZone.SetDoNotAllowZoneFills(false);
      aZone.SetDoNotAllowPads(false);
      aZone.SetDoNotAllowFootprints(false);

      aZone.SetLayerSet(new LSET(LSET.AllCuMask()));
    } else {
      // copper pour cutout
      aZone.SetIsRuleArea(true);
      aZone.SetDoNotAllowVias(false);
      aZone.SetDoNotAllowTracks(false);
      aZone.SetDoNotAllowZoneFills(true);
      aZone.SetDoNotAllowPads(false);
      aZone.SetDoNotAllowFootprints(false);

      aZone.SetLayerSet(new LSET([this.kicad_layer(aLayer)]));
    }
  }

  private loadLibrary(aLib: wxXmlNode | null, aLibName: string | null): void {
    if (!aLib) return;

    const urn = aLib.GetAttribute('urn');

    // Parse the URN with EURN so the asset id matches the one extracted by
    // EELEMENT in loadElements(); using raw urn.AfterLast(':') would leave the
    // version component attached for URNs like
    // "urn:adsk.eagle:library:38243636/1", and the two halves would build
    // keys that no longer compare equal.
    const libraryUrn = new EURN();

    if (urn !== '') libraryUrn.Parse(urn);

    // library will have <xmlattr> node, skip that and get the single packages node
    const packages = MapChildren(aLib).get('packages');

    if (!packages) return;

    this.m_xpath.push('packages');

    // Build the per-library half of the m_templates key once. Eagle managed
    // libraries can carry the same library name at multiple URN versions in
    // the same board; the URN asset id disambiguates them. The package name
    // itself is left untouched so the FPID written into the board (and the
    // .pretty filename) matches the schematic importer's footprint field.
    let libKey = '';

    if (aLibName !== null) {
      libKey = aLibName;

      if (libraryUrn.IsValid()) libKey += `_${libraryUrn.assetId}`;
    }

    // Create a FOOTPRINT for all the eagle packages, for use later via a copy constructor
    // to instantiate needed footprints in our BOARD.  Save the FOOTPRINT templates in
    // a FOOTPRINT_MAP using a single lookup key consisting of libname+pkgname.

    // Get the first package and iterate
    let pkg = packages.GetChildren();

    while (pkg) {
      this.checkpoint();

      this.m_xpath.push('package', 'name');

      const pack_ref = ReplaceIllegalFileNameChars(pkg.GetAttribute('name'), '_');

      this.m_xpath.Value(pack_ref);

      const key = aLibName !== null ? makeKey(libKey, pack_ref) : pack_ref;

      const footprint = this.makeFootprint(pkg, pack_ref);

      // add the templating FOOTPRINT to the FOOTPRINT template factory "m_templates"
      if (this.m_templates.has(key)) {
        const lib = aLibName !== null ? aLibName : this.m_lib_path;
        const emsg = `<package> '${pack_ref}' duplicated in <library> '${lib}'`;
        throw new IO_ERROR(emsg);
      }

      this.m_templates.set(key, footprint);

      this.m_xpath.pop();

      pkg = pkg.GetNext();
    }

    this.m_xpath.pop(); // "packages"
  }

  private loadLibraries(aLibs: wxXmlNode | null): void {
    if (!aLibs) return;

    this.m_xpath.push('libraries.library', 'name');

    // Get the first library and iterate
    let library = aLibs.GetChildren();

    while (library) {
      const lib_name = library.GetAttribute('name');

      this.m_xpath.Value(lib_name);
      this.loadLibrary(library, lib_name);
      library = library.GetNext();
    }

    this.m_xpath.pop();
  }

  private loadElements(aElements: wxXmlNode | null): void {
    if (!aElements) return;

    const board = this.m_board!;

    this.m_xpath.push('elements.element', 'name');

    const name = new EATTR();
    const value = new EATTR();
    let refanceNamePresetInPackageLayout: boolean;
    let valueNamePresetInPackageLayout: boolean;

    // Get the first element and iterate
    let element = aElements.GetChildren();

    while (element) {
      this.checkpoint();

      if (element.GetName() !== 'element') {
        // Get next item
        element = element.GetNext();
        continue;
      }

      const e = new EELEMENT(element);

      // use "NULL-ness" as an indication of presence of the attribute:
      let nameAttr: EATTR | null = null;
      let valueAttr: EATTR | null = null;

      this.m_xpath.Value(e.name);

      // Mirror loadLibrary(): the package name is taken verbatim from Eagle,
      // and the library key is disambiguated with the library URN ordinal so
      // multiple managed-library versions resolve to the right footprint.
      let libKey = e.library;

      if (e.library_urn) libKey += `_${e.library_urn.assetId}`;

      const pkg_key = makeKey(libKey, e.package);

      const it = this.m_templates.get(pkg_key);

      if (it === undefined) {
        const emsg = `No '${e.package}' package in library '${e.library}'.`;
        throw new IO_ERROR(emsg);
      }

      const footprint = it.Duplicate(false) as FOOTPRINT;

      board.Add(footprint, ADD_MODE.APPEND);

      // update the nets within the pads of the clone
      for (const pad of footprint.Pads()) {
        const pn_key = makeKey(e.name, pad.GetNumber());

        const ni = this.m_pads_to_nets.get(pn_key);

        if (ni !== undefined) {
          const enet = ni;
          pad.SetNetCode(enet.netcode);
        }
      }

      refanceNamePresetInPackageLayout = true;
      valueNamePresetInPackageLayout = true;
      footprint.SetPosition({ x: this.kicad_x(e.x), y: this.kicad_y(e.y) });

      // Is >NAME field set in package layout ?
      if (footprint.GetReference().length === 0) {
        footprint.Reference().SetVisible(false); // No so no show
        refanceNamePresetInPackageLayout = false;
      }

      // Is >VALUE field set in package layout
      if (footprint.GetValue().length === 0) {
        footprint.Value().SetVisible(false); // No so no show
        valueNamePresetInPackageLayout = false;
      }

      let reference = e.name;

      // EAGLE allows references to be single digits.  This breaks KiCad
      // netlisting, which requires parts to have non-digit + digit
      // annotation.  If the reference begins with a number, we prepend
      // 'UNK' (unknown) for the symbol designator.
      if (!/^[^0-9]/.test(reference)) reference = `UNK${reference}`;

      // EAGLE allows designator to start with # but that is used in KiCad
      // for symbols which do not have a footprint
      if (!/^[^#]/.test(reference)) reference = `UNK${reference}`;

      // reference must end with a number but EAGLE does not enforce this
      if (!/[0-9]$/.test(reference)) reference = `${reference}0`;

      footprint.SetReference(reference);
      footprint.SetValue(e.value);

      if (e.smashed === undefined) {
        // Not smashed so show NAME & VALUE
        if (valueNamePresetInPackageLayout) footprint.Value().SetVisible(true); // Only if place holder in package layout

        if (refanceNamePresetInPackageLayout) footprint.Reference().SetVisible(true); // Only if place holder in package layout
      } else if (e.smashed === true) {
        // Smashed so set default to no show for NAME and VALUE
        footprint.Value().SetVisible(false);
        footprint.Reference().SetVisible(false);

        // initialize these to default values in case the <attribute> elements are not present.
        this.m_xpath.push('attribute', 'name');

        // VALUE and NAME can have something like our text "effects" overrides
        // in SWEET and new schematic.  Eagle calls these XML elements "attribute".
        // There can be one for NAME and/or VALUE both.  Features present in the
        // EATTR override the ones established in the package only if they are
        // present here (except for rot, which if not present means angle zero).
        // So the logic is a bit different than in packageText() and in plain text.

        // Get the first attribute and iterate
        let attribute = element.GetChildren();

        while (attribute) {
          if (attribute.GetName() !== 'attribute') {
            attribute = attribute.GetNext();
            continue;
          }

          const a = new EATTR(attribute);

          if (a.name === 'NAME') {
            name.assign(a);
            nameAttr = name;

            // do we have a display attribute ?
            if (a.display !== undefined) {
              // Yes!
              switch (a.display) {
                case EATTR.VALUE: {
                  nameAttr.name = reference;

                  if (refanceNamePresetInPackageLayout) footprint.Reference().SetVisible(true);

                  break;
                }

                case EATTR.NAME:
                  if (refanceNamePresetInPackageLayout) {
                    footprint.SetReference('NAME');
                    footprint.Reference().SetVisible(true);
                  }

                  break;

                case EATTR.BOTH:
                  if (refanceNamePresetInPackageLayout) footprint.Reference().SetVisible(true);

                  nameAttr.name = `${nameAttr.name} = ${e.name}`;
                  footprint.SetReference(`NAME = ${e.name}`);
                  break;

                case EATTR.Off:
                  footprint.Reference().SetVisible(false);
                  break;

                default:
                  nameAttr.name = e.name;

                  if (refanceNamePresetInPackageLayout) footprint.Reference().SetVisible(true);
              }
            } else {
              // No display, so default is visible, and show value of NAME
              footprint.Reference().SetVisible(true);
            }
          } else if (a.name === 'VALUE') {
            value.assign(a);
            valueAttr = value;

            if (a.display !== undefined) {
              // Yes!
              switch (a.display) {
                case EATTR.VALUE:
                  valueAttr.value = opt_wxString(e.value);
                  footprint.SetValue(e.value);

                  if (valueNamePresetInPackageLayout) footprint.Value().SetVisible(true);

                  break;

                case EATTR.NAME:
                  if (valueNamePresetInPackageLayout) footprint.Value().SetVisible(true);

                  footprint.SetValue('VALUE');
                  break;

                case EATTR.BOTH:
                  if (valueNamePresetInPackageLayout) footprint.Value().SetVisible(true);

                  valueAttr.value = opt_wxString(`VALUE = ${e.value}`);
                  footprint.SetValue(`VALUE = ${e.value}`);
                  break;

                case EATTR.Off:
                  footprint.Value().SetVisible(false);
                  break;

                default:
                  valueAttr.value = opt_wxString(e.value);

                  if (valueNamePresetInPackageLayout) footprint.Value().SetVisible(true);
              }
            } else {
              // No display, so default is visible, and show value of NAME
              footprint.Value().SetVisible(true);
            }
          }

          attribute = attribute.GetNext();
        }

        this.m_xpath.pop(); // "attribute"
      }

      this.orientFootprintAndText(footprint, e, nameAttr, valueAttr);

      this.adjustFootprintForDesignRules(footprint);

      // Get next element
      element = element.GetNext();
    }

    this.m_xpath.pop(); // "elements.element"
  }

  /** The arc-tessellated corner list `loadPolygon` and `packagePolygon` both walk. */
  private polygonPoints(aVertices: readonly EVERTEX[], aNoZeroRadius: boolean): VECTOR2I[] {
    const pts: VECTOR2I[] = [];
    const vertices = [...aVertices, aVertices[0]!];

    for (let i = 0; i < vertices.length - 1; i++) {
      const v1 = vertices[i]!;

      // Append the corner
      pts.push({ x: this.kicad_x(v1.x), y: this.kicad_y(v1.y) });

      if (v1.curve !== undefined) {
        const v2 = vertices[i + 1]!;
        const center = ConvertArcCenter(
          { x: this.kicad_x(v1.x), y: this.kicad_y(v1.y) },
          { x: this.kicad_x(v2.x), y: this.kicad_y(v2.y) },
          v1.curve,
        );
        const angle = (v1.curve * Math.PI) / 180.0;
        const end_angle = atan2(this.kicad_y(v2.y) - center.y, this.kicad_x(v2.x) - center.x);
        const rx = center.x - this.kicad_x(v1.x);
        const ry = center.y - this.kicad_y(v1.y);
        let radius = Math.sqrt(rx * rx + ry * ry);

        // Don't allow a zero-radius curve
        if (aNoZeroRadius && KiROUND(radius) === 0) radius = 1.0;

        const segCount = GetArcToSegmentCount(
          KiROUND(radius),
          ARC_HIGH_DEF,
          new EDA_ANGLE(v1.curve),
        );
        const delta_angle = angle / segCount;

        for (
          let a = end_angle + angle;
          Math.abs(a - end_angle) > Math.abs(delta_angle);
          a -= delta_angle
        ) {
          pts.push({
            x: KiROUND(radius * cos(a)) + center.x,
            y: KiROUND(radius * sin(a)) + center.y,
          });
        }
      }
    }

    return pts;
  }

  private loadPolygon(aPolyNode: wxXmlNode): ZONE | null {
    const board = this.m_board!;
    const p = new EPOLYGON(aPolyNode);
    const layer = this.kicad_layer(p.layer);
    const keepout =
      p.layer === EAGLE_LAYER.TRESTRICT ||
      p.layer === EAGLE_LAYER.BRESTRICT ||
      p.layer === EAGLE_LAYER.VRESTRICT;

    if (layer === UNDEFINED_LAYER) {
      this.wxLogMessage(
        `Ignoring a polygon since Eagle layer '${this.eagle_layer_name(p.layer)}' (${p.layer}) was not mapped`,
      );
      return null;
    }

    // use a "netcode = 0" type ZONE:
    const zone = new ZONE(board);

    if (!keepout) zone.SetLayer(layer);
    else this.setKeepoutSettingsToZone(zone, p.layer);

    // Get the first vertex and iterate
    let vertex = aPolyNode.GetChildren();
    const vertices: EVERTEX[] = [];

    // Create a circular vector of vertices
    // The "curve" parameter indicates a curve from the current
    // to the next vertex, so we keep the first at the end as well
    // to allow the curve to link back
    while (vertex) {
      if (vertex.GetName() === 'vertex') vertices.push(new EVERTEX(vertex));

      vertex = vertex.GetNext();
    }

    // According to Eagle's doc, by default, the orphans (islands in KiCad parlance)
    // are always removed
    if (!p.orphans) zone.SetIslandRemovalMode(ISLAND_REMOVAL_MODE.ALWAYS);
    else zone.SetIslandRemovalMode(ISLAND_REMOVAL_MODE.NEVER);

    if (vertices.length < 3) {
      this.wxLogMessage(
        `Skipping a polygon on layer '${this.eagle_layer_name(p.layer)}' (${p.layer}): less than 3 vertices`,
      );
      return null;
    }

    const polygon = new SHAPE_POLY_SET();
    polygon.NewOutline();

    for (const pt of this.polygonPoints(vertices, false)) polygon.Append(pt.x, pt.y);

    // Eagle traces the zone such that half of the pen width is outside the polygon.
    // We trace the zone such that the copper is completely inside.
    if (p.width.ToPcbUnits() > 0) {
      polygon.Inflate(
        Math.trunc(p.width.ToPcbUnits() / 2),
        CornerStrategy.ALLOW_ACUTE_CORNERS,
        ARC_HIGH_DEF,
        true,
      );
    }

    if (polygon.OutlineCount() !== 1) {
      this.wxLogMessage(
        `Skipping a polygon on layer '${this.eagle_layer_name(p.layer)}' (${p.layer}): outline count is not 1`,
      );
      return null;
    }

    zone.AddPolygon(polygon.COutline(0));

    // If the pour is a cutout it needs to be set to a keepout
    if (p.pour === EPOLYGON.ECUTOUT) {
      zone.SetIsRuleArea(true);
      zone.SetDoNotAllowVias(false);
      zone.SetDoNotAllowTracks(false);
      zone.SetDoNotAllowPads(false);
      zone.SetDoNotAllowFootprints(false);
      zone.SetDoNotAllowZoneFills(true);
      zone.SetHatchStyle(ZONE_BORDER_DISPLAY_STYLE.NO_HATCH);
    } else if (p.pour === EPOLYGON.EHATCH) {
      const spacing = p.spacing ? p.spacing.ToPcbUnits() : 50 * pcbIUScale.IU_PER_MILS;

      zone.SetFillMode(ZONE_FILL_MODE.HATCH_PATTERN);
      zone.SetHatchThickness(p.width.ToPcbUnits());
      zone.SetHatchGap(Math.trunc(spacing - p.width.ToPcbUnits()));
      zone.SetHatchOrientation(ANGLE_0);
    }

    // We divide the thickness by half because we are tracing _inside_ the zone outline
    // This means the radius of curvature will be twice the size for an equivalent EAGLE zone
    zone.SetMinThickness(
      Math.max(
        Math.trunc(ZONE_THICKNESS_MIN_VALUE_MM * pcbIUScale.IU_PER_MM),
        Math.trunc(p.width.ToPcbUnits() / 2),
      ),
    );

    if (p.isolate) zone.SetLocalClearance(p.isolate.ToPcbUnits());
    else zone.SetLocalClearance(1); // @todo: set minimum clearance value based on board settings

    // missing == yes per DTD.
    const thermals = p.thermals === undefined || p.thermals;
    zone.SetPadConnection(thermals ? ZONE_CONNECTION.THERMAL : ZONE_CONNECTION.FULL);

    if (thermals) {
      // FIXME: eagle calculates dimensions for thermal spokes
      //        based on what the zone is connecting to.
      //        (i.e. width of spoke is half of the smaller side of an smd pad)
      //        This is a basic workaround
      zone.SetThermalReliefGap(p.width.ToPcbUnits() + 50000); // 50000nm == 0.05mm
      zone.SetThermalReliefSpokeWidth(p.width.ToPcbUnits() + 50000);
    }

    const rank = p.rank !== undefined ? EPOLYGON.max_priority - p.rank : EPOLYGON.max_priority;
    zone.SetAssignedPriority(rank);

    board.Add(zone, ADD_MODE.APPEND);
    return zone;
  }

  private orientFootprintAndText(
    aFootprint: FOOTPRINT,
    e: EELEMENT,
    aNameAttr: EATTR | null,
    aValueAttr: EATTR | null,
  ): void {
    const textRotDefs: [PCB_FIELD, number, boolean, boolean, EATTR | null][] = [];

    const fields: PCB_FIELD[] = [];
    aFootprint.GetFields(fields, false);

    for (const field of fields) {
      const defDegrees = field.GetTextAngle().AsDegrees();
      const defMirror = field.IsMirrored();
      const defSpin = !field.IsKeepUpright();
      let attr: EATTR | null = null;

      if (field === aFootprint.Reference()) attr = aNameAttr;
      else if (field === aFootprint.Value()) attr = aValueAttr;

      textRotDefs.push([field, defDegrees, defMirror, defSpin, attr]);
    }

    if (e.rot) {
      if (e.rot.mirror) {
        aFootprint.SetOrientation(new EDA_ANGLE(e.rot.degrees + 180.0));
        aFootprint.Flip(aFootprint.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);
      } else {
        aFootprint.SetOrientation(new EDA_ANGLE(e.rot.degrees));
      }
    }

    for (const [field, defDegrees, defMirror, defSpin, attr] of textRotDefs)
      this.orientFPText(aFootprint, e, field, attr, defDegrees, defMirror, defSpin);
  }

  private orientFPText(
    _aFootprint: FOOTPRINT,
    e: EELEMENT,
    aFPText: PCB_TEXT,
    aAttr: EATTR | null,
    aTextDefAngle = 0.0,
    aTextDefMirror = false,
    aTextDefSpin = false,
  ): void {
    // Smashed part ?
    if (aAttr) {
      // Yes
      const a = aAttr;

      if (a.value !== undefined) aFPText.SetText(a.value);

      if (a.x && a.y) {
        // std::optional
        const pos = { x: this.kicad_x(a.x), y: this.kicad_y(a.y) };
        aFPText.SetTextPos(pos);
      }

      // Even though size and ratio are both optional, I am not seeing
      // a case where ratio is present but size is not.
      let ratio = 8;

      if (a.ratio !== undefined) ratio = a.ratio;

      let fontz = aFPText.GetTextSize();
      const textThickness = KiROUND((fontz.y * ratio) / 100.0);

      aFPText.SetTextThickness(textThickness);

      if (a.size) {
        fontz = this.kicad_fontsize(a.size, textThickness);
        aFPText.SetTextSize(fontz);
      }

      let align: number = ETEXT.BOTTOM_LEFT; // bottom-left is eagle default

      if (a.align !== undefined) align = a.align;

      // The "rot" in a EATTR seems to be assumed to be zero if it is not
      // present, and this zero rotation becomes an override to the
      // package's text field.  If they did not want zero, they specify
      // what they want explicitly.
      const degrees = a.rot ? a.rot.degrees : 0.0;
      const mirror = a.rot ? a.rot.mirror : false;
      const spin = a.rot ? a.rot.spin : false;

      EaglePcbTextToKiCadAlignment(aFPText, align, degrees, mirror, spin);
    } else {
      // Part is not smash so use Lib default for NAME/VALUE
      // the text is per the original package, sans <attribute>.
      const align = EagleAlignmentFromKiCad([aFPText.GetVertJustify(), aFPText.GetHorizJustify()]);
      const elementAngle = e.rot ? e.rot.degrees : 0.0;
      const elementMirror = e.rot ? e.rot.mirror : false;
      const elementSpin = e.rot ? e.rot.spin : false;

      // To mimic EAGLE correctly, we need to know here in addition to the element rotation specification
      // the rotation specification (i.e. angle, mirror flag and spin flag) of the original <text ...>
      // definition within the package
      EaglePcbTextToKiCadAlignment(
        aFPText,
        align,
        aTextDefAngle,
        aTextDefMirror,
        aTextDefSpin,
        elementAngle,
        elementMirror,
        elementSpin,
      );
    }
  }

  private adjustFootprintForDesignRules(aFootprint: FOOTPRINT | null): void {
    // If there is no `designrules` section in the board or library file, there is nothing to do.
    if (!aFootprint || !this.m_rules) return;

    // Adjust through hole pads per rlMinPadTop, rlMinPadInner, and rlMinPatBottom design rule settings.
    for (const pad of aFootprint.Pads()) {
      if (!pad || !pad.HasDrilledHole() || pad.GetFrontShape() !== PAD_SHAPE.CIRCLE) continue;

      // `int adjustedPadDiameter`: each sum below is narrowed to int
      let adjustedPadDiameter = 0;
      const padstack = pad.Padstack();

      if (this.m_rules.rlMinPadTop !== 0.0 && padstack.LayerSet().test(F_Cu)) {
        adjustedPadDiameter = Math.trunc(padstack.Drill().size.x + this.m_rules.rlMinPadTop * 2);

        if (padstack.Size(F_Cu).x < adjustedPadDiameter)
          padstack.SetSize({ x: adjustedPadDiameter, y: adjustedPadDiameter }, F_Cu);

        // For normal pad stacks, the first layer defines the pad for all layers.
        if (padstack.Mode() === PADSTACK_MODE.NORMAL) continue;
      }

      if (this.m_rules.rlMinPadBottom !== 0.0 && padstack.LayerSet().test(B_Cu)) {
        adjustedPadDiameter = Math.trunc(padstack.Drill().size.x + this.m_rules.rlMinPadBottom * 2);

        if (padstack.Size(B_Cu).x < adjustedPadDiameter)
          padstack.SetSize({ x: adjustedPadDiameter, y: adjustedPadDiameter }, B_Cu);
      }

      if (this.m_rules.rlMinPadInner !== 0.0) {
        const innerLayers = new LSET(padstack.LayerSet()).and(LSET.InternalCuMask());

        for (const layerId of innerLayers.Seq()) {
          if (!padstack.LayerSet().test(layerId)) continue;

          adjustedPadDiameter = Math.trunc(
            padstack.Drill().size.x + this.m_rules.rlMinPadInner * 2,
          );

          if (padstack.Size(layerId).x < adjustedPadDiameter)
            padstack.SetSize({ x: adjustedPadDiameter, y: adjustedPadDiameter }, layerId);
        }
      }
    }
  }

  private makeFootprint(aPackage: wxXmlNode, aPkgName: string): FOOTPRINT {
    const m = new FOOTPRINT(this.m_board);

    const fpID = new LIB_ID();
    fpID.Parse(aPkgName, true);
    m.SetFPID(fpID);

    // Get the first package item and iterate
    let packageItem = aPackage.GetChildren();

    // layer 27 is default layer for tValues
    // set default layer for created footprint
    const layer = this.kicad_layer(27);
    m.Value().SetLayer(layer);

    while (packageItem) {
      const itemName = packageItem.GetName();

      if (itemName === 'description') {
        const descr = convertDescription(UnescapeHTML(packageItem.GetNodeContent()));
        m.SetLibDescription(descr);
      } else if (itemName === 'wire') this.packageWire(m, packageItem);
      else if (itemName === 'pad') this.packagePad(m, packageItem);
      else if (itemName === 'text') this.packageText(m, packageItem);
      else if (itemName === 'rectangle') this.packageRectangle(m, packageItem);
      else if (itemName === 'polygon') this.packagePolygon(m, packageItem);
      else if (itemName === 'circle') this.packageCircle(m, packageItem);
      else if (itemName === 'hole') this.packageHole(m, packageItem, false);
      else if (itemName === 'smd') this.packageSMD(m, packageItem);

      packageItem = packageItem.GetNext();
    }

    return m;
  }

  private packageWire(aFootprint: FOOTPRINT, aTree: wxXmlNode): void {
    const w = new EWIRE(aTree);
    const layer = this.kicad_layer(w.layer);
    const start = { x: this.kicad_x(w.x1), y: this.kicad_y(w.y1) };
    const end = { x: this.kicad_x(w.x2), y: this.kicad_y(w.y2) };
    let width = w.width.ToPcbUnits();

    if (layer === UNDEFINED_LAYER) {
      this.wxLogMessage(
        `Ignoring a wire since Eagle layer '${this.eagle_layer_name(w.layer)}' (${w.layer}) was not mapped`,
      );
      return;
    }

    // KiCad cannot handle zero or negative line widths which apparently have meaning in Eagle.
    if (width <= 0) {
      const board = aFootprint.GetBoard();

      if (board) {
        width = board.GetDesignSettings().GetLineThickness(layer);
      } else {
        // When loading footprint libraries, there is no board so use the default KiCad
        // line widths.
        switch (layer) {
          case Edge_Cuts:
            width = pcbIUScale.mmToIU(DEFAULT_EDGE_WIDTH);
            break;

          case F_SilkS:
          case B_SilkS:
            width = pcbIUScale.mmToIU(DEFAULT_SILK_LINE_WIDTH);
            break;

          case F_CrtYd:
          case B_CrtYd:
            width = pcbIUScale.mmToIU(DEFAULT_COURTYARD_WIDTH);
            break;

          default:
            width = pcbIUScale.mmToIU(DEFAULT_LINE_WIDTH);
            break;
        }
      }
    }

    // FIXME: the cap attribute is ignored because KiCad can't create lines with flat ends.
    let dwg: PCB_SHAPE;

    if (w.curve === undefined) {
      dwg = new PCB_SHAPE(aFootprint, SHAPE_T.SEGMENT);

      dwg.SetStart(start);
      dwg.SetEnd(end);
    } else {
      dwg = new PCB_SHAPE(aFootprint, SHAPE_T.ARC);
      const center = ConvertArcCenter(start, end, w.curve);

      dwg.SetCenter(center);
      dwg.SetStart(start);
      dwg.SetArcAngleAndEnd(new EDA_ANGLE(w.curve).negate(), true); // KiCad rotates the other way
    }

    dwg.SetLayer(layer);
    dwg.SetStroke(new STROKE_PARAMS(width, LINE_STYLE.SOLID));
    dwg.Rotate({ x: 0, y: 0 }, aFootprint.GetOrientation());
    dwg.Move(aFootprint.GetPosition());

    aFootprint.Add(dwg);
  }

  private packagePad(aFootprint: FOOTPRINT, aTree: wxXmlNode): void {
    // this is thru hole technology here, no SMDs
    const e = new EPAD(aTree);
    let shape = EPAD.UNDEF;
    const eagleDrillz = e.drill ? e.drill.ToPcbUnits() : 0;

    const pad = new PAD(aFootprint);
    this.transferPad(e, pad);

    if (e.first && this.m_rules.psFirst !== EPAD.UNDEF) shape = this.m_rules.psFirst;
    else if (aFootprint.GetLayer() === F_Cu && this.m_rules.psTop !== EPAD.UNDEF)
      shape = this.m_rules.psTop;
    else if (aFootprint.GetLayer() === B_Cu && this.m_rules.psBottom !== EPAD.UNDEF)
      shape = this.m_rules.psBottom;

    pad.SetDrillSize({ x: eagleDrillz, y: eagleDrillz });
    pad.SetLayerSet(new LSET(LSET.AllCuMask()));

    if (eagleDrillz < this.m_min_hole) this.m_min_hole = eagleDrillz;

    // Solder mask
    if (e.stop === undefined || e.stop === true)
      // enabled by default
      pad.SetLayerSet(new LSET(pad.GetLayerSet()).set(B_Mask).set(F_Mask));

    if (shape === EPAD.ROUND || shape === EPAD.SQUARE || shape === EPAD.OCTAGON) e.shape = shape;

    if (e.shape !== undefined) {
      switch (e.shape) {
        case EPAD.ROUND:
          pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
          break;

        case EPAD.OCTAGON:
          pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CHAMFERED_RECT);
          pad.SetChamferPositions(PADSTACK.ALL_LAYERS, RECT_CHAMFER_ALL);
          pad.SetChamferRectRatio(PADSTACK.ALL_LAYERS, 1 - Math.SQRT1_2); // Regular polygon
          break;

        case EPAD.LONG:
          pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.OVAL);
          break;

        case EPAD.SQUARE:
          pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.RECTANGLE);
          break;

        case EPAD.OFFSET:
          pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.OVAL);
          break;
      }
    } else {
      // if shape is not present, our default is circle and that matches their default "round"
    }

    if (e.diameter && e.diameter.value > 0) {
      const diameter = e.diameter.ToPcbUnits();
      pad.SetSize(PADSTACK.ALL_LAYERS, { x: diameter, y: diameter });
    } else {
      const drillz = pad.GetDrillSize().x;
      let annulus = drillz * this.m_rules.rvPadTop; // copper annulus, eagle "restring"
      annulus = eagleClamp(this.m_rules.rlMinPadTop, annulus, this.m_rules.rlMaxPadTop);
      const diameter = KiROUND(drillz + 2 * annulus);
      pad.SetSize(PADSTACK.ALL_LAYERS, { x: diameter, y: diameter });
    }

    if (pad.GetShape(PADSTACK.ALL_LAYERS) === PAD_SHAPE.OVAL) {
      // The Eagle "long" pad is wider than it is tall; m_elongation is percent elongation
      const sz = { ...pad.GetSize(PADSTACK.ALL_LAYERS) };
      sz.x = Math.trunc((sz.x * (100 + this.m_rules.psElongationLong)) / 100);
      pad.SetSize(PADSTACK.ALL_LAYERS, sz);

      if (e.shape === EPAD.OFFSET) {
        const offset = KiROUND((sz.x - sz.y) / 2.0);
        pad.SetOffset(PADSTACK.ALL_LAYERS, { x: offset, y: 0 });
      }
    }

    if (e.rot) pad.SetOrientation(new EDA_ANGLE(e.rot.degrees));

    // Eagle spokes are always '+'
    pad.SetThermalSpokeAngle(ANGLE_0);

    if (pad.GetSizeX() > 0 && pad.GetSizeY() > 0 && pad.HasHole()) {
      aFootprint.Add(pad);
    } else {
      const fileName = this.m_lib_path.substring(this.m_lib_path.lastIndexOf('/') + 1);

      if (this.m_board)
        this.wxLogError(`Invalid zero-sized pad ignored in\nfile: ${this.m_board.GetFileName()}`);
      else this.wxLogError(`Invalid zero-sized pad ignored in\nfile: ${fileName}`);
    }
  }

  private packageText(aFootprint: FOOTPRINT, aTree: wxXmlNode): void {
    const t = new ETEXT(aTree);
    const layer = this.kicad_layer(t.layer);

    if (layer === UNDEFINED_LAYER) {
      this.wxLogMessage(
        `Ignoring a text since Eagle layer '${this.eagle_layer_name(t.layer)}' (${t.layer}) was not mapped`,
      );
      return;
    }

    let textItem: PCB_TEXT;

    if (t.text.toUpperCase() === '>NAME' && aFootprint.GetReference() === '') {
      textItem = aFootprint.Reference();

      textItem.SetText('REF**');
    } else if (t.text.toUpperCase() === '>VALUE' && aFootprint.GetValue() === '') {
      textItem = aFootprint.Value();

      textItem.SetText(aFootprint.GetFPID().GetLibItemName());
    } else {
      textItem = new PCB_TEXT(aFootprint);
      aFootprint.Add(textItem);

      textItem.SetText(interpretText(t.text));
    }

    const pos = { x: this.kicad_x(t.x), y: this.kicad_y(t.y) };

    textItem.SetPosition(pos);
    textItem.SetLayer(layer);

    const ratio = t.ratio !== undefined ? t.ratio : 8; // DTD says 8 is default
    const textThickness = KiROUND((t.size.ToPcbUnits() * ratio) / 100.0);

    textItem.SetTextThickness(textThickness);
    textItem.SetTextSize(this.kicad_fontsize(t.size, textThickness));

    const align = t.align !== undefined ? t.align : ETEXT.BOTTOM_LEFT; // bottom-left is eagle default

    // An eagle package is never rotated, the DTD does not allow it.
    // angle -= aFootprint->GetOrienation();

    const degrees = t.rot ? t.rot.degrees : 0.0; // range used by EAGLE is [0° ; 360°[
    const mirror = t.rot ? t.rot.mirror : false;
    const spin = t.rot ? t.rot.spin : false;

    textItem.SetKeepUpright(!spin);

    if (mirror) textItem.SetMirrored(mirror);

    const [valign, halign] = KiCadAlignmentFromEagle(align);
    textItem.SetHorizJustify(halign);
    textItem.SetVertJustify(valign);

    textItem.SetTextAngle(new EDA_ANGLE(degrees));
    textItem.SetTextAngle(new EDA_ANGLE(degrees));

    // EaglePcbTextToKiCadAlignment (called from orientFPText) will tidy up the final orientation on the PCB
  }

  private packageRectangle(aFootprint: FOOTPRINT, aTree: wxXmlNode): void {
    const r = new ERECT(aTree);

    if (
      r.layer === EAGLE_LAYER.TRESTRICT ||
      r.layer === EAGLE_LAYER.BRESTRICT ||
      r.layer === EAGLE_LAYER.VRESTRICT
    ) {
      const zone = new ZONE(aFootprint);
      aFootprint.Add(zone, ADD_MODE.APPEND);

      this.setKeepoutSettingsToZone(zone, r.layer);

      const outlineIdx = -1; // this is the id of the copper zone main outline
      zone.AppendCorner({ x: this.kicad_x(r.x1), y: this.kicad_y(r.y1) }, outlineIdx);
      zone.AppendCorner({ x: this.kicad_x(r.x2), y: this.kicad_y(r.y1) }, outlineIdx);
      zone.AppendCorner({ x: this.kicad_x(r.x2), y: this.kicad_y(r.y2) }, outlineIdx);
      zone.AppendCorner({ x: this.kicad_x(r.x1), y: this.kicad_y(r.y2) }, outlineIdx);

      if (r.rot) {
        const center = {
          x: Math.trunc((this.kicad_x(r.x1) + this.kicad_x(r.x2)) / 2),
          y: Math.trunc((this.kicad_y(r.y1) + this.kicad_y(r.y2)) / 2),
        };
        zone.Rotate(center, new EDA_ANGLE(r.rot.degrees));
      }

      zone.SetBorderDisplayStyle(
        ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
        ZONE.GetDefaultHatchPitch(),
        true,
      );
    } else {
      const layer = this.kicad_layer(r.layer);

      if (layer === UNDEFINED_LAYER) {
        this.wxLogMessage(
          `Ignoring a rectangle since Eagle layer '${this.eagle_layer_name(r.layer)}' (${r.layer}) was not mapped`,
        );
        return;
      }

      const dwg = new PCB_SHAPE(aFootprint, SHAPE_T.POLY);

      aFootprint.Add(dwg);

      dwg.SetLayer(layer);
      dwg.SetStroke(new STROKE_PARAMS(0));
      dwg.SetFilled(true);

      const pts: VECTOR2I[] = [];

      const start = { x: this.kicad_x(r.x1), y: this.kicad_y(r.y1) };
      const end = { x: this.kicad_x(r.x1), y: this.kicad_y(r.y2) };

      pts.push(start);
      pts.push({ x: this.kicad_x(r.x2), y: this.kicad_y(r.y1) });
      pts.push({ x: this.kicad_x(r.x2), y: this.kicad_y(r.y2) });
      pts.push(end);

      dwg.SetPolyPoints(pts);

      if (r.rot) dwg.Rotate(dwg.GetCenter(), new EDA_ANGLE(r.rot.degrees));

      dwg.Rotate({ x: 0, y: 0 }, aFootprint.GetOrientation());
      dwg.Move(aFootprint.GetPosition());
    }
  }

  private packagePolygon(aFootprint: FOOTPRINT, aTree: wxXmlNode): void {
    const p = new EPOLYGON(aTree);

    // Get the first vertex and iterate
    let vertex = aTree.GetChildren();
    const vertices: EVERTEX[] = [];

    // Create a circular vector of vertices
    // The "curve" parameter indicates a curve from the current
    // to the next vertex, so we keep the first at the end as well
    // to allow the curve to link back
    while (vertex) {
      if (vertex.GetName() === 'vertex') vertices.push(new EVERTEX(vertex));

      vertex = vertex.GetNext();
    }

    const pts = this.polygonPoints(vertices, true);

    const layer = this.kicad_layer(p.layer);

    if (
      (p.pour === EPOLYGON.ECUTOUT && layer !== UNDEFINED_LAYER) ||
      p.layer === EAGLE_LAYER.TRESTRICT ||
      p.layer === EAGLE_LAYER.BRESTRICT ||
      p.layer === EAGLE_LAYER.VRESTRICT
    ) {
      const zone = new ZONE(aFootprint);
      aFootprint.Add(zone, ADD_MODE.APPEND);

      this.setKeepoutSettingsToZone(zone, p.layer);

      const outline = new SHAPE_LINE_CHAIN(pts);
      outline.SetClosed(true);
      zone.Outline().AddOutline(outline);

      zone.SetBorderDisplayStyle(
        ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
        ZONE.GetDefaultHatchPitch(),
        true,
      );
    } else {
      if (layer === UNDEFINED_LAYER) {
        this.wxLogMessage(
          `Ignoring a polygon since Eagle layer '${this.eagle_layer_name(p.layer)}' (${p.layer}) was not mapped`,
        );
        return;
      }

      const dwg = new PCB_SHAPE(aFootprint, SHAPE_T.POLY);

      aFootprint.Add(dwg);

      dwg.SetStroke(new STROKE_PARAMS(0));
      dwg.SetFilled(true);
      dwg.SetLayer(layer);

      dwg.SetPolyPoints(pts);
      dwg.Rotate({ x: 0, y: 0 }, aFootprint.GetOrientation());
      dwg.Move(aFootprint.GetPosition());
      dwg
        .GetPolyShape()
        .Inflate(
          Math.trunc(p.width.ToPcbUnits() / 2),
          CornerStrategy.ALLOW_ACUTE_CORNERS,
          ARC_HIGH_DEF,
        );
    }
  }

  private packageCircle(aFootprint: FOOTPRINT, aTree: wxXmlNode): void {
    const e = new ECIRCLE(aTree);

    let width = e.width.ToPcbUnits();
    let radius = e.radius.ToPcbUnits();

    if (
      e.layer === EAGLE_LAYER.TRESTRICT ||
      e.layer === EAGLE_LAYER.BRESTRICT ||
      e.layer === EAGLE_LAYER.VRESTRICT
    ) {
      const zone = new ZONE(aFootprint);
      aFootprint.Add(zone, ADD_MODE.APPEND);

      this.setKeepoutSettingsToZone(zone, e.layer);

      this.appendCircleOutline(zone, { x: this.kicad_x(e.x), y: this.kicad_y(e.y) }, radius, width);
    } else {
      let layer = this.kicad_layer(e.layer);

      if (layer === UNDEFINED_LAYER) {
        this.wxLogMessage(
          `Ignoring a circle since Eagle layer '${this.eagle_layer_name(e.layer)}' (${e.layer}) was not mapped`,
        );
        return;
      }

      const gr = new PCB_SHAPE(aFootprint, SHAPE_T.CIRCLE);

      // width == 0 means filled circle
      if (width <= 0) {
        width = radius;
        radius = Math.trunc(radius / 2);
        gr.SetFilled(true);
      }

      aFootprint.Add(gr);
      gr.SetStroke(new STROKE_PARAMS(width, LINE_STYLE.SOLID));

      switch (layer as number) {
        case UNDEFINED_LAYER:
          layer = Cmts_User;
          break;
        default:
          break;
      }

      gr.SetLayer(layer);
      gr.SetStart({ x: this.kicad_x(e.x), y: this.kicad_y(e.y) });
      gr.SetEnd({ x: this.kicad_x(e.x) + radius, y: this.kicad_y(e.y) });
      gr.Rotate({ x: 0, y: 0 }, aFootprint.GetOrientation());
      gr.Move(aFootprint.GetPosition());
    }
  }

  private packageHole(aFootprint: FOOTPRINT, aTree: wxXmlNode, aCenter: boolean): void {
    const e = new EHOLE(aTree);

    if (e.drill.value === 0) return;

    // we add a PAD_ATTRIB::NPTH pad to this footprint.
    const pad = new PAD(aFootprint);
    aFootprint.Add(pad);

    pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.CIRCLE);
    pad.SetAttribute(PAD_ATTRIB.NPTH);

    // Mechanical purpose only:
    // no offset, no net name, no pad name allowed
    // pad->SetOffset( VECTOR2I( 0, 0 ) );
    // pad->SetNumber( wxEmptyString );

    const padpos = { x: this.kicad_x(e.x), y: this.kicad_y(e.y) };

    if (aCenter) {
      aFootprint.SetPosition(padpos);
      pad.SetPosition(padpos);
    } else {
      pad.SetPosition(add(padpos, aFootprint.GetPosition()));
    }

    const sz = { x: e.drill.ToPcbUnits(), y: e.drill.ToPcbUnits() };

    pad.SetDrillSize(sz);
    pad.SetSize(PADSTACK.ALL_LAYERS, sz);

    pad.SetLayerSet(new LSET(LSET.AllCuMask()).set(B_Mask).set(F_Mask));
  }

  private packageSMD(aFootprint: FOOTPRINT, aTree: wxXmlNode): void {
    const e = new ESMD(aTree);
    const layer = this.kicad_layer(e.layer);

    if (!IsCopperLayer(layer) || e.dx.value === 0 || e.dy.value === 0) return;

    const pad = new PAD(aFootprint);
    aFootprint.Add(pad);
    this.transferPad(e, pad);

    pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.RECTANGLE);
    pad.SetAttribute(PAD_ATTRIB.SMD);

    const padSize = { x: e.dx.ToPcbUnits(), y: e.dy.ToPcbUnits() };
    pad.SetSize(PADSTACK.ALL_LAYERS, padSize);
    pad.SetLayer(layer);

    const front = new LSET([F_Cu, F_Paste, F_Mask]);
    const back = new LSET([B_Cu, B_Paste, B_Mask]);

    if (layer === F_Cu) pad.SetLayerSet(front);
    else if (layer === B_Cu) pad.SetLayerSet(back);

    const minPadSize = Math.min(padSize.x, padSize.y);

    // Rounded rectangle pads
    const roundRadius = eagleClamp(
      this.m_rules.srMinRoundness * 2,
      Math.trunc(minPadSize * this.m_rules.srRoundness) | 0,
      this.m_rules.srMaxRoundness * 2,
    );

    if (e.roundness !== undefined || roundRadius > 0) {
      let roundRatio = roundRadius / minPadSize / 2.0;

      // Eagle uses a different definition of roundness, hence division by 200
      if (e.roundness !== undefined) roundRatio = Math.max(e.roundness / 200.0, roundRatio);

      pad.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.ROUNDRECT);
      pad.SetRoundRectRadiusRatio(PADSTACK.ALL_LAYERS, roundRatio);
    }

    if (e.rot) pad.SetOrientation(new EDA_ANGLE(e.rot.degrees));

    // Eagle spokes are always '+'
    pad.SetThermalSpokeAngle(ANGLE_0);

    pad.SetLocalSolderPasteMargin(
      -eagleClamp(
        this.m_rules.mlMinCreamFrame,
        Math.trunc(this.m_rules.mvCreamFrame * minPadSize) | 0,
        this.m_rules.mlMaxCreamFrame,
      ),
    );

    // Solder mask
    if (e.stop !== undefined && e.stop === false) {
      // enabled by default
      if (layer === F_Cu) pad.SetLayerSet(new LSET(pad.GetLayerSet()).set(F_Mask, false));
      else if (layer === B_Cu) pad.SetLayerSet(new LSET(pad.GetLayerSet()).set(B_Mask, false));
    }

    // Solder paste (only for SMD pads)
    if (e.cream !== undefined && e.cream === false) {
      // enabled by default
      if (layer === F_Cu) pad.SetLayerSet(new LSET(pad.GetLayerSet()).set(F_Paste, false));
      else if (layer === B_Cu) pad.SetLayerSet(new LSET(pad.GetLayerSet()).set(B_Paste, false));
    }
  }

  ///< Handles common pad properties
  private transferPad(aEaglePad: EPAD_COMMON, aPad: PAD): void {
    aPad.SetNumber(aEaglePad.name);

    const padPos = { x: this.kicad_x(aEaglePad.x), y: this.kicad_y(aEaglePad.y) };

    // Solder mask
    const padSize = aPad.GetSize(PADSTACK.ALL_LAYERS);

    aPad.SetLocalSolderMaskMargin(
      eagleClamp(
        this.m_rules.mlMinStopFrame,
        Math.trunc(this.m_rules.mvStopFrame * Math.min(padSize.x, padSize.y)) | 0,
        this.m_rules.mlMaxStopFrame,
      ),
    );

    // Solid connection to copper zones
    if (aEaglePad.thermals !== undefined && !aEaglePad.thermals)
      aPad.SetLocalZoneConnection(ZONE_CONNECTION.FULL);

    const footprint = aPad.GetParentFootprint();

    if (!footprint) return;

    const rotated = RotatePoint(padPos, footprint.GetOrientation());
    aPad.SetPosition(add(rotated, footprint.GetPosition()));
  }

  ///< Deletes the footprint templates list
  private deleteTemplates(): void {
    for (const [, footprint] of this.m_templates) footprint.SetParent(null);

    this.m_templates.clear();
  }

  private loadClasses(aClasses: wxXmlNode | null): void {
    // Eagle board DTD defines the "classes" element as 0 or 1.
    if (!aClasses) return;

    const bds = this.m_board!.GetDesignSettings();

    this.m_xpath.push('classes.class', 'number');

    const eClasses: ECLASS[] = [];
    let classNode = aClasses.GetChildren();

    while (classNode) {
      this.checkpoint();

      const eClass = new ECLASS(classNode);
      let netclass: NETCLASS;

      if (wxCmpNoCase(eClass.name, 'default') === 0) {
        netclass = bds.m_NetSettings.GetDefaultNetclass();
      } else {
        netclass = new NETCLASS(eClass.name);
        bds.m_NetSettings.SetNetclass(eClass.name, netclass);
      }

      netclass.SetTrackWidth(INT_MAX);
      netclass.SetViaDiameter(INT_MAX);
      netclass.SetViaDrill(INT_MAX);

      eClasses.push(eClass);
      this.m_classMap.set(eClass.number, netclass);

      // Set netclass clearance to the clearance-to-default-class value
      const clearanceToDefaultIt = eClass.clearanceMap.get('0');

      if (clearanceToDefaultIt !== undefined)
        netclass.SetClearance(clearanceToDefaultIt.ToPcbUnits());

      // Get next class
      classNode = classNode.GetNext();
    }

    this.m_customRules = '(version 1)';

    for (const eClass of eClasses) {
      for (const [className, pt] of sortedByKey(eClass.clearanceMap)) {
        // Skip clearances to default class (class "0") - these are handled via netclass clearances
        if (className === '0') continue;

        // m_classMap[className]: operator[] inserts a null entry for an unknown class
        if (!this.m_classMap.has(className)) this.m_classMap.set(className, null as never);

        const target = this.m_classMap.get(className);

        if (target) {
          const rule =
            `(rule "class ${eClass.number}:${className}"\n` +
            `  (condition "A.NetClass == '${eClass.name}' && B.NetClass == '${target.GetName()}'")\n` +
            `  (constraint clearance (min ${stringFromValue(pcbIUScale, 'mm', pt.ToPcbUnits())}mm)))\n`;
          this.m_customRules += `\n${rule}`;
        }
      }
    }

    this.m_xpath.pop(); // "classes.class"
  }

  private loadSignals(aSignals: wxXmlNode | null): void {
    // Eagle board DTD defines the "signals" element as 0 or 1.
    if (!aSignals) return;

    const board = this.m_board!;
    const bds = board.GetDesignSettings();
    const zones: ZONE[] = []; // per net
    let netCode = 1;

    this.m_xpath.push('signals.signal', 'name');

    // Get the first signal and iterate
    let net = aSignals.GetChildren();

    while (net) {
      this.checkpoint();

      let sawPad = false;

      zones.length = 0;

      const netName = escapeName(net.GetAttribute('name'));
      const netInfo = new NETINFO_ITEM(board, netName, netCode);
      let netclass: NETCLASS | null = null;

      if (net.HasAttribute('class')) {
        const netclassIt = this.m_classMap.get(net.GetAttribute('class'));

        // (a null entry, left by loadClasses' operator[], would crash upstream; skipped)
        if (netclassIt) {
          bds.m_NetSettings.SetNetclassPatternAssignment(netName, netclassIt.GetName());
          netInfo.SetNetClass(netclassIt);
          netclass = netclassIt;
        }
      }

      board.Add(netInfo);

      this.m_xpath.Value(netName);

      // Get the first net item and iterate
      let netItem = net.GetChildren();

      // (contactref | polygon | wire | via)*
      while (netItem) {
        const itemName = netItem.GetName();

        if (itemName === 'wire') {
          this.m_xpath.push('wire');

          const w = new EWIRE(netItem);
          const layer = this.kicad_layer(w.layer);

          if (IsCopperLayer(layer)) {
            const start = { x: this.kicad_x(w.x1), y: this.kicad_y(w.y1) };
            const end = { x: this.kicad_x(w.x2), y: this.kicad_y(w.y2) };

            const width = w.width.ToPcbUnits();

            if (width < this.m_min_trace) this.m_min_trace = width;

            if (netclass && width < netclass.GetTrackWidth()) netclass.SetTrackWidth(width);

            if (w.curve !== undefined) {
              const center = ConvertArcCenter(start, end, w.curve);
              const rx = center.x - this.kicad_x(w.x1);
              const ry = center.y - this.kicad_y(w.y1);
              const radius = Math.sqrt(rx * rx + ry * ry);
              let mid = CalcArcMid(start, end, center, true);
              let otherMid = CalcArcMid(start, end, center, false);

              // VECTOR2I::EuclideanNorm is std::hypot
              const radiusA = hypot(mid.x - center.x, mid.y - center.y);
              const radiusB = hypot(otherMid.x - center.x, otherMid.y - center.y);

              if (Math.abs(radiusA - radius) > Math.abs(radiusB - radius))
                [mid, otherMid] = [otherMid, mid];

              const arc = new PCB_ARC(board);

              arc.SetPosition(start);
              arc.SetMid(mid);
              arc.SetEnd(end);
              arc.SetWidth(width);
              arc.SetLayer(layer);
              arc.SetNetCode(netCode);

              board.Add(arc);
            } else {
              const track = new PCB_TRACK(board);

              track.SetPosition(start);
              track.SetEnd({ x: this.kicad_x(w.x2), y: this.kicad_y(w.y2) });
              track.SetWidth(width);
              track.SetLayer(layer);
              track.SetNetCode(netCode);

              board.Add(track);
            }
          } else {
            // put non copper wires where the sun don't shine.
          }

          this.m_xpath.pop();
        } else if (itemName === 'via') {
          this.m_xpath.push('via');
          const v = new EVIA(netItem);

          if (v.layer_front_most > v.layer_back_most)
            [v.layer_front_most, v.layer_back_most] = [v.layer_back_most, v.layer_front_most];

          const layer_front_most = this.kicad_layer(v.layer_front_most);
          const layer_back_most = this.kicad_layer(v.layer_back_most);

          if (
            IsCopperLayer(layer_front_most) &&
            IsCopperLayer(layer_back_most) &&
            layer_front_most !== layer_back_most
          ) {
            let kidiam: number;
            const drillz = v.drill.ToPcbUnits();
            const via = new PCB_VIA(board);
            board.Add(via);

            if (v.diam) {
              kidiam = v.diam.ToPcbUnits();
              via.SetWidth(PADSTACK.ALL_LAYERS, kidiam);
            } else {
              let annulus = drillz * this.m_rules.rvViaOuter; // eagle "restring"
              annulus = eagleClamp(this.m_rules.rlMinViaOuter, annulus, this.m_rules.rlMaxViaOuter);
              kidiam = KiROUND(drillz + 2 * annulus);
              via.SetWidth(PADSTACK.ALL_LAYERS, kidiam);
            }

            via.SetDrill(drillz);

            // make sure the via diameter respects the restring rules

            const via_width = via.GetWidth(PADSTACK.ALL_LAYERS);

            if (!v.diam || via_width <= via.GetDrill()) {
              const annular_width = (via_width - via.GetDrill()) / 2.0;
              const clamped_annular_width = eagleClamp(
                this.m_rules.rlMinViaOuter,
                annular_width,
                this.m_rules.rlMaxViaOuter,
              );
              // SetWidth( int ): the double sum narrowed to int
              via.SetWidth(PADSTACK.ALL_LAYERS, Math.trunc(drillz + 2 * clamped_annular_width));
            }

            if (kidiam < this.m_min_via) this.m_min_via = kidiam;

            if (netclass && kidiam < netclass.GetViaDiameter()) netclass.SetViaDiameter(kidiam);

            if (drillz < this.m_min_hole) this.m_min_hole = drillz;

            if (netclass && drillz < netclass.GetViaDrill()) netclass.SetViaDrill(drillz);

            if (Math.trunc((kidiam - drillz) / 2) < this.m_min_annulus)
              this.m_min_annulus = Math.trunc((kidiam - drillz) / 2);

            if (layer_front_most === F_Cu && layer_back_most === B_Cu) {
              via.SetViaType(VIATYPE.THROUGH);
            } else if (layer_front_most === F_Cu || layer_back_most === B_Cu) {
              via.SetViaType(VIATYPE.BLIND);
            } else {
              via.SetViaType(VIATYPE.BURIED);
            }

            const pos = { x: this.kicad_x(v.x), y: this.kicad_y(v.y) };

            via.SetLayerPair(layer_front_most, layer_back_most);
            via.SetPosition(pos);
            via.SetEnd(pos);

            via.SetNetCode(netCode);
          }

          this.m_xpath.pop();
        } else if (itemName === 'contactref') {
          this.m_xpath.push('contactref');
          // <contactref element="RN1" pad="7"/>

          const reference = netItem.GetAttribute('element');
          const pad = netItem.GetAttribute('pad');
          const key = makeKey(reference, pad);

          this.m_pads_to_nets.set(key, new ENET(netCode, netName));

          this.m_xpath.pop();

          sawPad = true;
        } else if (itemName === 'polygon') {
          this.m_xpath.push('polygon');
          const zone = this.loadPolygon(netItem);

          if (zone) {
            zones.push(zone);

            if (!zone.GetIsRuleArea()) zone.SetNetCode(netCode);
          }

          this.m_xpath.pop(); // "polygon"
        }

        netItem = netItem.GetNext();
      }

      if (zones.length && !sawPad) {
        // KiCad does not support an unconnected zone with its own non-zero netcode,
        // but only when assigned netcode = 0 w/o a name...
        for (const zone of zones) zone.SetNetCode(NETINFO_LIST.UNCONNECTED);

        // therefore omit this signal/net.
      }

      //Next signal needs a new netCode
      netCode++;

      // Get next signal
      net = net.GetNext();
    }

    this.m_xpath.pop(); // "signals.signal"
  }

  /**
   * Return the automapped layers.
   */
  DefaultLayerMappingCallback(
    aInputLayerDescriptionVector: readonly INPUT_LAYER_DESC[],
  ): Map<string, PCB_LAYER_ID> {
    const layer_map = new Map<string, PCB_LAYER_ID>();

    for (const layer of aInputLayerDescriptionVector) {
      const layerId = this.defaultKicadLayer(this.eagle_layer_id(layer.Name))[0];

      // emplace: the first of a name stays
      if (!layer_map.has(layer.Name)) layer_map.set(layer.Name, layerId);
    }

    return layer_map;
  }

  private mapEagleLayersToKicad(aIsLibraryCache = false): void {
    const inputDescs: INPUT_LAYER_DESC[] = [];

    for (const [, eLayer] of [...this.m_eagleLayers].sort(([a], [b]) => a - b)) {
      const [AutoMapLayer, PermittedLayers, Required] = this.defaultKicadLayer(
        eLayer.number,
        aIsLibraryCache,
      );

      if (AutoMapLayer === UNDEFINED_LAYER) continue; // Ignore unused copper layers

      inputDescs.push({ Name: eLayer.name, AutoMapLayer, PermittedLayers, Required });
    }

    this.m_layer_map = this.m_layerMappable.m_layer_mapping_handler(inputDescs);
  }

  /// Convert an Eagle layer to a KiCad layer.
  private kicad_layer(aEagleLayer: number): PCB_LAYER_ID {
    const result = this.m_layer_map.get(this.eagle_layer_name(aEagleLayer));
    return result === undefined ? UNDEFINED_LAYER : result;
  }

  private defaultKicadLayer(
    aEagleLayer: number,
    aIsLibraryCache = false,
  ): [PCB_LAYER_ID, LSET, boolean] {
    // eagle copper layer:
    if (aEagleLayer >= 1 && aEagleLayer < this.m_cu_map.length) {
      const copperLayers = new LSET();

      for (const copperLayer of this.m_cu_map) {
        if (copperLayer >= 0) copperLayers.set(copperLayer);
      }

      return [this.m_cu_map[aEagleLayer] as PCB_LAYER_ID, copperLayers, true];
    }

    let kiLayer: number = UNSELECTED_LAYER;
    let required = false;
    let permittedLayers = new LSET();

    permittedLayers.set();

    // translate non-copper eagle layer to pcbnew layer
    switch (aEagleLayer) {
      // Eagle says "Dimension" layer, but it's for board perimeter
      case EAGLE_LAYER.DIMENSION:
        kiLayer = Edge_Cuts;
        required = true;
        permittedLayers = new LSET([Edge_Cuts]);
        break;

      case EAGLE_LAYER.TPLACE:
        kiLayer = F_SilkS;
        break;
      case EAGLE_LAYER.BPLACE:
        kiLayer = B_SilkS;
        break;
      case EAGLE_LAYER.TNAMES:
        kiLayer = F_SilkS;
        break;
      case EAGLE_LAYER.BNAMES:
        kiLayer = B_SilkS;
        break;
      case EAGLE_LAYER.TVALUES:
        kiLayer = F_Fab;
        break;
      case EAGLE_LAYER.BVALUES:
        kiLayer = B_Fab;
        break;
      case EAGLE_LAYER.TSTOP:
        kiLayer = F_Mask;
        break;
      case EAGLE_LAYER.BSTOP:
        kiLayer = B_Mask;
        break;
      case EAGLE_LAYER.TCREAM:
        kiLayer = F_Paste;
        break;
      case EAGLE_LAYER.BCREAM:
        kiLayer = B_Paste;
        break;
      case EAGLE_LAYER.TFINISH:
        kiLayer = F_Mask;
        break;
      case EAGLE_LAYER.BFINISH:
        kiLayer = B_Mask;
        break;
      case EAGLE_LAYER.TGLUE:
        kiLayer = F_Adhes;
        break;
      case EAGLE_LAYER.BGLUE:
        kiLayer = B_Adhes;
        break;
      case EAGLE_LAYER.DOCUMENT:
        kiLayer = Cmts_User;
        break;
      case EAGLE_LAYER.REFERENCELC:
        kiLayer = Cmts_User;
        break;
      case EAGLE_LAYER.REFERENCELS:
        kiLayer = Cmts_User;
        break;

      // Packages show the future chip pins on SMD parts using layer 51.
      // This is an area slightly smaller than the PAD/SMD copper area.
      // Carry those visual aids into the FOOTPRINT on the fabrication layer,
      // not silkscreen. This is perhaps not perfect, but there is not a lot
      // of other suitable paired layers
      case EAGLE_LAYER.TDOCU:
        kiLayer = F_Fab;
        break;
      case EAGLE_LAYER.BDOCU:
        kiLayer = B_Fab;
        break;

      // these layers are defined as user layers. put them on ECO layers
      case EAGLE_LAYER.USERLAYER1:
        kiLayer = Eco1_User;
        break;
      case EAGLE_LAYER.USERLAYER2:
        kiLayer = Eco2_User;
        break;
      case EAGLE_LAYER.USERDRAWINGS:
        kiLayer = Dwgs_User;
        break;
      case EAGLE_LAYER.USERMARGIN:
        kiLayer = Margin;
        break;
      case EAGLE_LAYER.USER1:
        kiLayer = User_1;
        break;
      case EAGLE_LAYER.USER2:
        kiLayer = User_2;
        break;
      case EAGLE_LAYER.USER3:
        kiLayer = User_3;
        break;
      case EAGLE_LAYER.USER4:
        kiLayer = User_4;
        break;
      case EAGLE_LAYER.USER5:
        kiLayer = User_5;
        break;
      case EAGLE_LAYER.USER6:
        kiLayer = User_6;
        break;
      case EAGLE_LAYER.USER7:
        kiLayer = User_7;
        break;
      case EAGLE_LAYER.USER8:
        kiLayer = User_8;
        break;
      case EAGLE_LAYER.USER9:
        kiLayer = User_9;
        break;

      // these will also appear in the ratsnest, so there's no need for a warning
      case EAGLE_LAYER.UNROUTED:
        kiLayer = Dwgs_User;
        break;

      case EAGLE_LAYER.TKEEPOUT:
        kiLayer = F_CrtYd;
        break;
      case EAGLE_LAYER.BKEEPOUT:
        kiLayer = B_CrtYd;
        break;

      default:
        // MILLING, TTEST, BTEST, HOLES and the rest
        if (aIsLibraryCache) kiLayer = UNDEFINED_LAYER;
        else kiLayer = UNSELECTED_LAYER;

        break;
    }

    return [kiLayer as PCB_LAYER_ID, permittedLayers, required];
  }

  /// Get Eagle layer name by its number
  private eagle_layer_name(aLayer: number): string {
    const it = this.m_eagleLayers.get(aLayer);
    return it === undefined ? 'unknown' : it.name;
  }

  /// Get Eagle layer number by its name
  private eagle_layer_id(aLayerName: string): number {
    const it = this.m_eagleLayersIds.get(aLayerName);
    return it === undefined ? -1 : it;
  }

  /// move the BOARD into the center of the page
  private centerBoard(): void {
    if (this.m_props) {
      const page_width = this.m_props.get('page_width') ?? '';
      const page_height = this.m_props.get('page_height') ?? '';

      if (page_width !== '' && page_height !== '') {
        const board = this.m_board!;
        const bbbox = board.GetBoardEdgesBoundingBox();

        const w = atoi(page_width);
        const h = atoi(page_height);

        const desired_x = Math.trunc((w - bbbox.GetWidth()) / 2);
        const desired_y = Math.trunc((h - bbbox.GetHeight()) / 2);

        const movementVector = { x: desired_x - bbbox.GetX(), y: desired_y - bbbox.GetY() };

        board.Move(movementVector);

        const bds = board.GetDesignSettings();
        bds.SetAuxOrigin(add(bds.GetAuxOrigin(), movementVector));
        bds.SetGridOrigin(add(bds.GetGridOrigin(), movementVector));

        board.SetModified();
      }
    }
  }

  GetLibraryTimestamp(aPath: string): number {
    // File hasn't been loaded yet.
    if (aPath === '') return Date.now();

    // The browser's files carry no modification time; a readable library is timestamp 1.
    return this.m_readFile(aPath) ? 1 : 0;
  }

  /// This PLUGIN only caches one footprint library, this determines which one.
  private cacheLib(aLibPath: string): void {
    try {
      const timestamp = this.GetLibraryTimestamp(aLibPath);

      if (aLibPath !== this.m_lib_path || this.m_timestamp !== timestamp) {
        this.deleteTemplates();

        // Set this before completion of loading, since we rely on it for
        // text of an exception.  Delay setting m_mod_time until after successful load
        // however.
        this.m_lib_path = aLibPath;

        // Load the document
        const data = this.m_readFile(aLibPath);

        if (!data) throw new IO_ERROR(`Unable to read file '${aLibPath}'.`);

        let doc: wxXmlNode;

        try {
          doc = wxXmlDocumentLoad(new TextDecoder('utf-8').decode(data));
        } catch (e) {
          if (!(e instanceof wxXmlParseError)) throw e;

          throw new IO_ERROR(`Unable to read file '${aLibPath}'.`);
        }

        const drawing = MapChildren(doc).get('drawing') ?? null;
        const drawingChildren = MapChildren(drawing);

        // clear the cu map and then rebuild it.
        this.clear_cu_map();

        this.m_xpath.push('eagle.drawing.layers');
        const layers = drawingChildren.get('layers') ?? null;
        this.loadLayerDefs(layers);
        this.mapEagleLayersToKicad(true);
        this.m_xpath.pop();

        this.m_xpath.push('eagle.drawing.library');
        const library = drawingChildren.get('library') ?? null;
        this.loadLibrary(library, null);
        this.m_xpath.pop();

        this.m_timestamp = timestamp;
      }
    } catch {
      // catch( ... ) {}: upstream swallows every error here
    }
  }

  override FootprintEnumerate(
    aFootprintNames: string[],
    aLibraryPath: string,
    aBestEfforts: boolean,
    aProperties: PCB_IO_PROPERTIES | null = null,
  ): void {
    let errorMsg = '';

    this.init(aProperties);

    try {
      this.cacheLib(aLibraryPath);
    } catch (ioe) {
      if (!(ioe instanceof IO_ERROR)) throw ioe;

      errorMsg = ioe.What();
    }

    // Some of the files may have been parsed correctly so we want to add the valid files to
    // the library.

    for (const [name] of sortedByKey(this.m_templates)) aFootprintNames.push(name);

    if (errorMsg !== '' && !aBestEfforts) throw new IO_ERROR(errorMsg);
  }

  override FootprintLoad(
    aLibraryPath: string,
    aFootprintName: string,
    _aKeepUUID = false,
    aProperties: PCB_IO_PROPERTIES | null = null,
  ): FOOTPRINT | null {
    this.init(aProperties);
    this.cacheLib(aLibraryPath);
    const it = this.m_templates.get(aFootprintName);

    if (it === undefined) return null;

    // Return a copy of the template
    const copy = it.Duplicate(false) as FOOTPRINT;
    copy.SetParent(null);
    return copy;
  }

  override IsLibraryWritable(_aLibraryPath: string): boolean {
    return false; // until someone writes others like FootprintSave(), etc.
  }

  /// Determines the minimum copper layer stackup count that includes all mapped layers.
  private getMinimumCopperLayerCount(): number {
    let minLayerCount = 2;

    for (const [, layerId] of this.m_layer_map) {
      if (!IsCopperLayer(layerId) || layerId === F_Cu || layerId === B_Cu) continue;

      const ordinal = CopperLayerToOrdinal(layerId);

      if (ordinal + 2 > minLayerCount) minLayerCount = ordinal + 2;
    }

    // Ensure the copper layers count is a multiple of 2
    // Pcbnew does not like boards with odd layers count
    // (these boards cannot exist. they actually have a even layers count)
    if (minLayerCount % 2 !== 0) minLayerCount++;

    return minLayerCount;
  }
}
