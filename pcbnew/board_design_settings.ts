// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/board_design_settings.h` / `pcbnew/board_design_settings.cpp`:
 * `BOARD_DESIGN_SETTINGS`, the settings a board carries with it.
 *
 * A `NESTED_SETTINGS` at `board.design_settings` of the project file, with
 * the 85 params of the constructor and its two schema migrations. As
 * upstream, `m_resetParamsIfMissing` is off: a key the file lacks leaves the
 * value the board file parser set.
 */

import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { PCB_IU_PER_MM, pcbIUScale } from '@ziroeda/common/eda_units.js';
import {
  DIM_PRECISION,
  DIM_TEXT_POSITION,
  DIM_UNITS_FORMAT,
  DIM_UNITS_MODE,
} from './pcb_dimension_types.js';
import { IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { VIATYPE } from './pcb_track_types.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_IGNORE,
  RPT_SEVERITY_WARNING,
  type Severity,
  SeverityFromString,
  SeverityToString,
} from '@ziroeda/common/reporter.js';
import { DRC_ITEM, PCB_DRC_CODE } from './drc/drc_item.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import { NET_SETTINGS } from '@ziroeda/common/project/net_settings.js';
import {
  type JSON_SETTINGS,
  type JsonObject,
  type JsonValue,
  NESTED_SETTINGS,
  PARAM,
  PARAM_ENUM,
  PARAM_LAMBDA,
  PARAM_SCALED,
  ref,
} from '@ziroeda/common/settings/json_settings.js';
import { TEXT_MAX_SIZE_MM, TEXT_MIN_SIZE_MM } from '@ziroeda/common/eda_text.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import {
  ZONE_BORDER_HATCH_DIST_MM,
  ZONE_BORDER_HATCH_MAXDIST_MM,
  ZONE_BORDER_HATCH_MINDIST_MM,
  ZONE_CLEARANCE_MM,
  ZONE_CONNECTION,
  ZONE_THERMAL_RELIEF_COPPER_WIDTH_MM,
  ZONE_THERMAL_RELIEF_GAP_MM,
  ZONE_THICKNESS_MIN_VALUE_MM,
  ZONE_THICKNESS_MM,
} from './zones.js';
import { ISLAND_REMOVAL_MODE, ZONE_BORDER_DISPLAY_STYLE, ZONE_FILL_MODE } from './zone_settings.js';
import {
  GetTeardropTargetCanonicalName,
  GetTeardropTargetTypeFromCanonicalName,
  type TARGET_TD,
} from './teardrop/teardrop_parameters.js';
import {
  defaultMeanderSettings,
  type MeanderSettings,
  MeanderStyle,
} from './router/pns_meander.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { TEARDROP_PARAMETERS_LIST } from './teardrop/teardrop_parameters.js';
import { ZONE_SETTINGS, type ZONE_LAYER_PROPERTIES } from './zone_settings.js';
import { BOARD_STACKUP } from './board_stackup_manager/board_stackup.js';
import { PAD } from './pad.js';
import type { DRC_ENGINE } from './drc/drc_engine.js';
import { DRC_CONSTRAINT_T } from './drc/drc_rule.js';
import { PAD_DRILL_SHAPE, PAD_SHAPE, PADSTACK } from './padstack.js';
import { ANGLE_45, ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import {
  DEFAULT_COPPER_LINE_WIDTH,
  DEFAULT_COPPER_TEXT_SIZE,
  DEFAULT_COPPER_TEXT_WIDTH,
  DEFAULT_COPPEREDGECLEARANCE,
  DEFAULT_COURTYARD_WIDTH,
  DEFAULT_DIMENSION_ARROW_LENGTH,
  DEFAULT_DIMENSION_EXTENSION_OFFSET,
  DEFAULT_DP_MEANDER_SPACING,
  DEFAULT_MEANDER_SPACING,
  DEFAULT_CUSTOMDPAIRGAP,
  DEFAULT_CUSTOMDPAIRVIAGAP,
  DEFAULT_CUSTOMDPAIRWIDTH,
  DEFAULT_CUSTOMTRACKWIDTH,
  DEFAULT_EDGE_WIDTH,
  DEFAULT_HOLECLEARANCE,
  DEFAULT_HOLETOHOLEMIN,
  DEFAULT_LINE_WIDTH,
  DEFAULT_MICROVIASMINDRILL,
  DEFAULT_MICROVIASMINSIZE,
  DEFAULT_MINCLEARANCE,
  DEFAULT_MINCONNECTION,
  DEFAULT_MINGROOVEWIDTH,
  DEFAULT_MINRESOLVEDSPOKES,
  DEFAULT_MINTHROUGHDRILL,
  DEFAULT_PAD_DRILL_DIAMETER_MM,
  DEFAULT_PAD_HEIGTH_MM,
  DEFAULT_PAD_RR_RADIUS_RATIO,
  DEFAULT_PAD_WIDTH_MM,
  DEFAULT_SILK_LINE_WIDTH,
  DEFAULT_SILK_TEXT_SIZE,
  DEFAULT_SILK_TEXT_WIDTH,
  DEFAULT_SILKCLEARANCE,
  DEFAULT_BOARD_THICKNESS_MM,
  DEFAULT_SOLDERMASK_EXPANSION,
  DEFAULT_SOLDERMASK_MIN_WIDTH,
  DEFAULT_SOLDERMASK_TO_COPPER_CLEARANCE,
  DEFAULT_SOLDERPASTE_CLEARANCE,
  DEFAULT_SOLDERPASTE_RATIO,
  DEFAULT_TEXT_SIZE,
  DEFAULT_TEXT_WIDTH,
  DEFAULT_TRACKMINWIDTH,
  DEFAULT_VIASMINSIZE,
  MAXIMUM_CLEARANCE,
} from './board_design_settings_defaults.js';

export * from './board_design_settings_defaults.js';

/**
 * Container to handle a stock of specific vias each with unique diameter and drill sizes
 * in the #BOARD class.
 */
export class VIA_DIMENSION {
  m_Diameter: number; // <= 0 means use Netclass via diameter
  m_Drill: number; // <= 0 means use Netclass via drill

  constructor(aDiameter = 0, aDrill = 0) {
    this.m_Diameter = aDiameter;
    this.m_Drill = aDrill;
  }

  equals(aOther: VIA_DIMENSION): boolean {
    return this.m_Diameter === aOther.m_Diameter && this.m_Drill === aOther.m_Drill;
  }

  lt(aOther: VIA_DIMENSION): boolean {
    if (this.m_Diameter !== aOther.m_Diameter) return this.m_Diameter < aOther.m_Diameter;

    return this.m_Drill < aOther.m_Drill;
  }
}

/**
 * Container to handle a stock of specific differential pairs each with unique track width,
 * gap and via gap.
 */
export class DIFF_PAIR_DIMENSION {
  m_Width: number; // <= 0 means use Netclass differential pair width
  m_Gap: number; // <= 0 means use Netclass differential pair gap
  m_ViaGap: number; // <= 0 means use Netclass differential pair via gap

  constructor(aWidth = 0, aGap = 0, aViaGap = 0) {
    this.m_Width = aWidth;
    this.m_Gap = aGap;
    this.m_ViaGap = aViaGap;
  }

  equals(aOther: DIFF_PAIR_DIMENSION): boolean {
    return (
      this.m_Width === aOther.m_Width &&
      this.m_Gap === aOther.m_Gap &&
      this.m_ViaGap === aOther.m_ViaGap
    );
  }

  lt(aOther: DIFF_PAIR_DIMENSION): boolean {
    if (this.m_Width !== aOther.m_Width) return this.m_Width < aOther.m_Width;

    if (this.m_Gap !== aOther.m_Gap) return this.m_Gap < aOther.m_Gap;

    return this.m_ViaGap < aOther.m_ViaGap;
  }
}

export enum LAYER_CLASS {
  LAYER_CLASS_SILK = 0,
  LAYER_CLASS_COPPER = 1,
  LAYER_CLASS_EDGES = 2,
  LAYER_CLASS_COURTYARD = 3,
  LAYER_CLASS_FAB = 4,
  LAYER_CLASS_OTHERS = 5,

  LAYER_CLASS_COUNT = 6,
}

export const {
  LAYER_CLASS_SILK,
  LAYER_CLASS_COPPER,
  LAYER_CLASS_EDGES,
  LAYER_CLASS_COURTYARD,
  LAYER_CLASS_FAB,
  LAYER_CLASS_OTHERS,
  LAYER_CLASS_COUNT,
} = LAYER_CLASS;

export class TEXT_ITEM_INFO {
  m_Text: string;
  m_Visible: boolean;
  m_Layer: PCB_LAYER_ID;

  constructor(aText: string, aVisible: boolean, aLayer: PCB_LAYER_ID) {
    this.m_Text = aText;
    this.m_Visible = aVisible;
    this.m_Layer = aLayer;
  }

  equals(aOther: TEXT_ITEM_INFO): boolean {
    return (
      this.m_Text === aOther.m_Text &&
      this.m_Visible === aOther.m_Visible &&
      this.m_Layer === aOther.m_Layer
    );
  }
}

/**
 * Container for design settings for a #BOARD object.
 */
const bdsSchemaVersion = 2;

export class BOARD_DESIGN_SETTINGS extends NESTED_SETTINGS {
  // Note: the first value in each dimensions list is the current netclass value
  m_TrackWidthList: number[] = [];
  m_ViasDimensionsList: VIA_DIMENSION[] = [];
  m_DiffPairDimensionsList: DIFF_PAIR_DIMENSION[] = [];

  /**
   * The parameters of teardrops for the different teardrop targets (via/pad, track end).
   *
   * 3 set of parameters always exist: for round shapes, for rect shapes, for track ends.
   */
  m_TeardropParamsList = new TEARDROP_PARAMETERS_LIST();

  GetTeadropParamsList(): TEARDROP_PARAMETERS_LIST {
    return this.m_TeardropParamsList;
  }

  private m_defaultZoneSettings = new ZONE_SETTINGS();

  // Default settings for tuning patterns (PNS::MEANDER_SETTINGS)
  m_SingleTrackMeanderSettings: MeanderSettings = defaultMeanderSettings();
  m_SkewMeanderSettings: MeanderSettings = defaultMeanderSettings();
  m_DiffPairMeanderSettings: MeanderSettings = defaultMeanderSettings();

  m_CurrentViaType: VIATYPE; ///< (VIA_BLIND_BURIED, VIA_THROUGH, VIA_MICROVIA)

  m_UseConnectedTrackWidth: boolean; // use width of existing track when creating a new,
  // connected track
  m_TempOverrideTrackWidth: boolean; // use selected track width temporarily even when
  // using connected track width

  m_MinClearance: number; // overall min
  m_MinGrooveWidth: number; // Minimum groove width for creepage checks
  m_MinConn: number; // overall min connection width
  m_TrackMinWidth: number; // overall min track width
  m_ViasMinAnnularWidth: number; // overall minimum width of the via copper ring
  m_ViasMinSize: number; // overall vias (not micro vias) min diameter
  m_MinThroughDrill: number; // through hole (not micro vias) min drill diameter
  m_MicroViasMinSize: number; // micro vias min diameter
  m_MicroViasMinDrill: number; // micro vias min drill diameter
  m_CopperEdgeClearance: number;
  m_HoleClearance: number; // Hole to copper clearance
  m_HoleToHoleMin: number; // Min width of web between two drilled holes
  m_SilkClearance: number; // Min dist between two silk items
  m_MinResolvedSpokes: number; // Min spoke count to not be a starved thermal
  m_MinSilkTextHeight: number; // Min text height for silkscreen layers
  m_MinSilkTextThickness: number; // Min text thickness for silkscreen layers

  m_DrcExclusions = new Set<string>(); // Serialized excluded DRC markers
  m_DrcExclusionComments = new Map<string, string>(); // Map from serialization to comment

  // When smoothing the zone's outline there's the question of external fillets (that is, those
  // applied to concave corners).  While it seems safer to never have copper extend outside the
  // zone outline, 5.1.x and prior did indeed fill them so we leave the mode available.
  m_ZoneKeepExternalFillets: boolean;

  // Maximum error allowed when approximating circles and arcs to segments
  m_MaxError: number;

  // Global mask margins:
  m_SolderMaskExpansion: number; // Solder mask inflation around the pad or via
  m_SolderMaskMinWidth: number; // Solder mask min width (2 areas closer than this
  //   width are merged)
  m_SolderMaskToCopperClearance: number; // Min distance allowed from copper to a mask
  //   aperture of another net
  m_SolderPasteMargin: number; // Solder paste margin absolute value
  m_SolderPasteMarginRatio: number; // Solder mask margin ratio value of pad size
  // The final margin is the sum of these 2 values
  m_AllowSoldermaskBridgesInFPs: boolean;
  m_TentViasFront: boolean; // The default tenting option if not overridden on an
  m_TentViasBack: boolean; // individual via
  m_CoverViasFront: boolean; // The default covering option if not overridden on an
  m_CoverViasBack: boolean; // individual via
  m_PlugViasFront: boolean; // The default plugging option if not overridden on an
  m_PlugViasBack: boolean; // individual via
  m_CapVias: boolean; // The default capping option if not overridden on an
  // individual via
  m_FillVias: boolean; // The default filling option if not overridden on ana
  // individual via

  m_NetSettings: NET_SETTINGS;

  /** `std::shared_ptr<DRC_ENGINE> m_DRCEngine`: installed by the edit frame at board load. */
  m_DRCEngine: DRC_ENGINE | null = null;

  // Variables used in footprint editing (default value in item/footprint creation)
  m_DefaultFPTextItems: TEXT_ITEM_INFO[] = [];

  // Default zone hatching offsets
  m_ZoneLayerProperties = new Map<PCB_LAYER_ID, ZONE_LAYER_PROPERTIES>();

  // Map between user layer default names and custom names
  m_UserLayerNames = new Map<string, string>();

  // Arrays of default values for the various layer classes.
  m_LineThickness: number[] = new Array<number>(LAYER_CLASS.LAYER_CLASS_COUNT).fill(0);
  m_TextSize: VECTOR2I[] = Array.from({ length: LAYER_CLASS.LAYER_CLASS_COUNT }, () => ({
    x: 0,
    y: 0,
  }));
  m_TextThickness: number[] = new Array<number>(LAYER_CLASS.LAYER_CLASS_COUNT).fill(0);
  m_TextItalic: boolean[] = new Array<boolean>(LAYER_CLASS.LAYER_CLASS_COUNT).fill(false);
  m_TextUpright: boolean[] = new Array<boolean>(LAYER_CLASS.LAYER_CLASS_COUNT).fill(false);

  m_StyleFPFields: boolean;
  m_StyleFPText: boolean;
  m_StyleFPShapes: boolean;
  m_StyleFPDimensions: boolean;
  m_StyleFPBarcodes: boolean;

  m_DimensionUnitsMode: DIM_UNITS_MODE;
  m_DimensionPrecision: DIM_PRECISION; ///< Number of digits after the decimal
  m_DimensionUnitsFormat: DIM_UNITS_FORMAT;
  m_DimensionSuppressZeroes: boolean;
  m_DimensionTextPosition: DIM_TEXT_POSITION;
  m_DimensionKeepTextAligned: boolean;
  m_DimensionArrowLength: number;
  m_DimensionExtensionOffset: number;

  m_DRCSeverities = new Map<number, Severity>(); // Map from DRCErrorCode to SEVERITY

  // Set to true if the board has a stackup management.
  // If not set a default basic stackup will be used to generate the gbrjob file.
  // Could be removed later, or at least always set to true
  m_Pad_Master: PAD; // A dummy pad to store all default parameters
  // when importing values from a previously created board:

  m_HasStackup: boolean;

  /// Enable inclusion of stackup height in track length measurements and length tuning
  m_UseHeightForLengthCalcs: boolean;

  private m_auxOrigin: VECTOR2I = { x: 0, y: 0 }; ///< origin for plot exports
  private m_gridOrigin: VECTOR2I = { x: 0, y: 0 }; ///< origin for grid offsets

  // Indices into the trackWidth, viaSizes and diffPairDimensions lists.
  // The 0 index is always the current netclass value(s)
  private m_trackWidthIndex = 0;
  private m_viaSizeIndex = 0;
  private m_diffPairIndex = 0;

  // Custom values for track/via sizes (specified via dialog instead of netclass or lists)
  private m_useCustomTrackVia: boolean;
  private m_customTrackWidth: number;
  private m_customViaSize = new VIA_DIMENSION();

  // Custom values for differential pairs (specified via dialog instead of netclass/lists)
  private m_useCustomDiffPair: boolean;
  private m_customDiffPair = new DIFF_PAIR_DIMENSION();

  private m_copperLayerCount!: number; ///< Number of copper layers for this design
  private m_userDefinedLayerCount!: number; ///< Number of user defined layers for this design
  private m_enabledLayers: LSET; ///< Bit-mask for layer enabling

  private m_boardThickness = 0; ///< Board thickness for 3D viewer

  /// Current net class name used to display netclass info.
  /// This is also the last used netclass after starting a track.
  private m_currentNetClassName = '';

  /// Stack-up settings
  private m_stackup = new BOARD_STACKUP();

  constructor(aParent: JSON_SETTINGS | null = null, aPath = 'board.design_settings') {
    super('board_design_settings', bdsSchemaVersion, aParent, aPath, false);

    // We want to leave alone parameters that aren't found in the project JSON as they may be
    // initialized by the board file parser before NESTED_SETTINGS::LoadFromFile is called.
    this.m_resetParamsIfMissing = false;

    // Create a default NET_SETTINGS so that things don't break horribly if there's no project
    // loaded.  This also is used during file load for legacy boards that have netclasses stored
    // in the file.  After load, this information will be moved to the project and the pointer
    // updated.
    this.m_NetSettings = new NET_SETTINGS();

    this.m_HasStackup = false; // no stackup defined by default

    this.m_Pad_Master = new PAD(null);

    const all_set = new LSET().set();
    this.m_enabledLayers = all_set; // All layers enabled at first.
    // SetCopperLayerCount() will adjust this.

    // Default design is a double layer board with 4 user defined layers
    this.SetCopperLayerCount(2);
    this.SetUserDefinedLayerCount(4);

    this.m_CurrentViaType = VIATYPE.THROUGH;

    // if true, when creating a new track starting on an existing track, use this track width
    this.m_UseConnectedTrackWidth = false;
    this.m_TempOverrideTrackWidth = false;

    // First is always the reference designator
    this.m_DefaultFPTextItems.push(new TEXT_ITEM_INFO('REF**', true, PCB_LAYER_ID.F_SilkS));
    // Second is always the value
    this.m_DefaultFPTextItems.push(new TEXT_ITEM_INFO('', true, PCB_LAYER_ID.F_Fab));
    // Any following ones are freebies
    this.m_DefaultFPTextItems.push(new TEXT_ITEM_INFO('${REFERENCE}', true, PCB_LAYER_ID.F_Fab));

    this.m_LineThickness[LAYER_CLASS_SILK] = pcbIUScale.mmToIU(DEFAULT_SILK_LINE_WIDTH);
    this.m_TextSize[LAYER_CLASS_SILK] = {
      x: pcbIUScale.mmToIU(DEFAULT_SILK_TEXT_SIZE),
      y: pcbIUScale.mmToIU(DEFAULT_SILK_TEXT_SIZE),
    };
    this.m_TextThickness[LAYER_CLASS_SILK] = pcbIUScale.mmToIU(DEFAULT_SILK_TEXT_WIDTH);
    this.m_TextItalic[LAYER_CLASS_SILK] = false;
    this.m_TextUpright[LAYER_CLASS_SILK] = false;

    this.m_LineThickness[LAYER_CLASS_COPPER] = pcbIUScale.mmToIU(DEFAULT_COPPER_LINE_WIDTH);
    this.m_TextSize[LAYER_CLASS_COPPER] = {
      x: pcbIUScale.mmToIU(DEFAULT_COPPER_TEXT_SIZE),
      y: pcbIUScale.mmToIU(DEFAULT_COPPER_TEXT_SIZE),
    };
    this.m_TextThickness[LAYER_CLASS_COPPER] = pcbIUScale.mmToIU(DEFAULT_COPPER_TEXT_WIDTH);
    this.m_TextItalic[LAYER_CLASS_COPPER] = false;
    this.m_TextUpright[LAYER_CLASS_COPPER] = false;

    // Edges & Courtyards; text properties aren't used but better to have them holding
    // reasonable values than not.
    this.m_LineThickness[LAYER_CLASS_EDGES] = pcbIUScale.mmToIU(DEFAULT_EDGE_WIDTH);
    this.m_TextSize[LAYER_CLASS_EDGES] = {
      x: pcbIUScale.mmToIU(DEFAULT_TEXT_SIZE),
      y: pcbIUScale.mmToIU(DEFAULT_TEXT_SIZE),
    };
    this.m_TextThickness[LAYER_CLASS_EDGES] = pcbIUScale.mmToIU(DEFAULT_TEXT_WIDTH);
    this.m_TextItalic[LAYER_CLASS_EDGES] = false;
    this.m_TextUpright[LAYER_CLASS_EDGES] = false;

    this.m_LineThickness[LAYER_CLASS_COURTYARD] = pcbIUScale.mmToIU(DEFAULT_COURTYARD_WIDTH);
    this.m_TextSize[LAYER_CLASS_COURTYARD] = {
      x: pcbIUScale.mmToIU(DEFAULT_TEXT_SIZE),
      y: pcbIUScale.mmToIU(DEFAULT_TEXT_SIZE),
    };
    this.m_TextThickness[LAYER_CLASS_COURTYARD] = pcbIUScale.mmToIU(DEFAULT_TEXT_WIDTH);
    this.m_TextItalic[LAYER_CLASS_COURTYARD] = false;
    this.m_TextUpright[LAYER_CLASS_COURTYARD] = false;

    this.m_LineThickness[LAYER_CLASS_FAB] = pcbIUScale.mmToIU(DEFAULT_LINE_WIDTH);
    this.m_TextSize[LAYER_CLASS_FAB] = {
      x: pcbIUScale.mmToIU(DEFAULT_TEXT_SIZE),
      y: pcbIUScale.mmToIU(DEFAULT_TEXT_SIZE),
    };
    this.m_TextThickness[LAYER_CLASS_FAB] = pcbIUScale.mmToIU(DEFAULT_TEXT_WIDTH);
    this.m_TextItalic[LAYER_CLASS_FAB] = false;
    this.m_TextUpright[LAYER_CLASS_FAB] = false;

    this.m_LineThickness[LAYER_CLASS_OTHERS] = pcbIUScale.mmToIU(DEFAULT_LINE_WIDTH);
    this.m_TextSize[LAYER_CLASS_OTHERS] = {
      x: pcbIUScale.mmToIU(DEFAULT_TEXT_SIZE),
      y: pcbIUScale.mmToIU(DEFAULT_TEXT_SIZE),
    };
    this.m_TextThickness[LAYER_CLASS_OTHERS] = pcbIUScale.mmToIU(DEFAULT_TEXT_WIDTH);
    this.m_TextItalic[LAYER_CLASS_OTHERS] = false;
    this.m_TextUpright[LAYER_CLASS_OTHERS] = false;

    this.m_StyleFPFields = false;
    this.m_StyleFPText = false;
    this.m_StyleFPShapes = false;
    this.m_StyleFPDimensions = false;
    this.m_StyleFPBarcodes = false;

    this.m_DimensionPrecision = DIM_PRECISION.X_XXXX;
    this.m_DimensionUnitsMode = DIM_UNITS_MODE.AUTOMATIC;
    this.m_DimensionUnitsFormat = DIM_UNITS_FORMAT.NO_SUFFIX;
    this.m_DimensionSuppressZeroes = true;
    this.m_DimensionTextPosition = DIM_TEXT_POSITION.OUTSIDE;
    this.m_DimensionKeepTextAligned = true;
    this.m_DimensionArrowLength = pcbIUScale.milsToIU(DEFAULT_DIMENSION_ARROW_LENGTH);
    this.m_DimensionExtensionOffset = pcbIUScale.mmToIU(DEFAULT_DIMENSION_EXTENSION_OFFSET);

    this.m_useCustomTrackVia = false;
    this.m_customTrackWidth = pcbIUScale.mmToIU(DEFAULT_CUSTOMTRACKWIDTH);
    this.m_customViaSize.m_Diameter = pcbIUScale.mmToIU(DEFAULT_VIASMINSIZE);
    this.m_customViaSize.m_Drill = pcbIUScale.mmToIU(DEFAULT_MINTHROUGHDRILL);

    this.m_useCustomDiffPair = false;
    this.m_customDiffPair.m_Width = pcbIUScale.mmToIU(DEFAULT_CUSTOMDPAIRWIDTH);
    this.m_customDiffPair.m_Gap = pcbIUScale.mmToIU(DEFAULT_CUSTOMDPAIRGAP);
    this.m_customDiffPair.m_ViaGap = pcbIUScale.mmToIU(DEFAULT_CUSTOMDPAIRVIAGAP);

    this.m_MinClearance = pcbIUScale.mmToIU(DEFAULT_MINCLEARANCE);
    this.m_MinConn = pcbIUScale.mmToIU(DEFAULT_MINCONNECTION);
    this.m_TrackMinWidth = pcbIUScale.mmToIU(DEFAULT_TRACKMINWIDTH);
    this.m_ViasMinAnnularWidth = Math.trunc(
      pcbIUScale.mmToIU(DEFAULT_VIASMINSIZE - DEFAULT_MINTHROUGHDRILL) / 2,
    );
    this.m_ViasMinSize = pcbIUScale.mmToIU(DEFAULT_VIASMINSIZE);
    this.m_MinThroughDrill = pcbIUScale.mmToIU(DEFAULT_MINTHROUGHDRILL);
    this.m_MicroViasMinSize = pcbIUScale.mmToIU(DEFAULT_MICROVIASMINSIZE);
    this.m_MicroViasMinDrill = pcbIUScale.mmToIU(DEFAULT_MICROVIASMINDRILL);
    this.m_CopperEdgeClearance = pcbIUScale.mmToIU(DEFAULT_COPPEREDGECLEARANCE);
    this.m_HoleClearance = pcbIUScale.mmToIU(DEFAULT_HOLECLEARANCE);
    this.m_HoleToHoleMin = pcbIUScale.mmToIU(DEFAULT_HOLETOHOLEMIN);
    this.m_SilkClearance = pcbIUScale.mmToIU(DEFAULT_SILKCLEARANCE);
    this.m_MinResolvedSpokes = DEFAULT_MINRESOLVEDSPOKES;
    this.m_MinSilkTextHeight = pcbIUScale.mmToIU(DEFAULT_SILK_TEXT_SIZE * 0.8);
    this.m_MinSilkTextThickness = pcbIUScale.mmToIU(DEFAULT_SILK_TEXT_WIDTH * 0.8);
    this.m_MinGrooveWidth = pcbIUScale.mmToIU(DEFAULT_MINGROOVEWIDTH);

    for (let errorCode = PCB_DRC_CODE.DRCE_FIRST; errorCode <= PCB_DRC_CODE.DRCE_LAST; ++errorCode)
      this.m_DRCSeverities.set(errorCode, RPT_SEVERITY_ERROR);

    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_DRILLED_HOLES_COLOCATED, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_DRILLED_HOLES_TOO_CLOSE, RPT_SEVERITY_WARNING);

    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_MISSING_COURTYARD, RPT_SEVERITY_IGNORE);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_PTH_IN_COURTYARD, RPT_SEVERITY_ERROR);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_NPTH_IN_COURTYARD, RPT_SEVERITY_ERROR);

    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_DANGLING_TRACK, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_DANGLING_VIA, RPT_SEVERITY_WARNING);

    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_COPPER_SLIVER, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_ISOLATED_COPPER, RPT_SEVERITY_WARNING);

    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_PADSTACK, RPT_SEVERITY_WARNING);

    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_MISSING_FOOTPRINT, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_DUPLICATE_FOOTPRINT, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_EXTRA_FOOTPRINT, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_NET_CONFLICT, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_SCHEMATIC_PARITY, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_FOOTPRINT_FILTERS, RPT_SEVERITY_IGNORE);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_SCHEMATIC_FIELDS_PARITY, RPT_SEVERITY_WARNING);

    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_SILK_CLEARANCE, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_SILK_MASK_CLEARANCE, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_SILK_EDGE_CLEARANCE, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_TEXT_HEIGHT, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_TEXT_THICKNESS, RPT_SEVERITY_WARNING);

    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_FOOTPRINT_TYPE_MISMATCH, RPT_SEVERITY_IGNORE);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_ISSUES, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_CONNECTION_WIDTH, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_MIRRORED_TEXT_ON_FRONT_LAYER, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(
      PCB_DRC_CODE.DRCE_NONMIRRORED_TEXT_ON_BACK_LAYER,
      RPT_SEVERITY_WARNING,
    );
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_MISSING_TUNING_PROFILE, RPT_SEVERITY_WARNING);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_TUNING_PROFILE_IMPLICIT_RULES, RPT_SEVERITY_IGNORE);
    this.m_DRCSeverities.set(PCB_DRC_CODE.DRCE_TRACK_NOT_CENTERED_ON_VIA, RPT_SEVERITY_IGNORE);

    this.m_MaxError = ARC_HIGH_DEF;
    this.m_ZoneKeepExternalFillets = false;
    this.m_UseHeightForLengthCalcs = true;

    // Global mask margins:
    this.m_SolderMaskExpansion = pcbIUScale.mmToIU(DEFAULT_SOLDERMASK_EXPANSION);
    this.m_SolderMaskMinWidth = pcbIUScale.mmToIU(DEFAULT_SOLDERMASK_MIN_WIDTH);
    this.m_SolderMaskToCopperClearance = pcbIUScale.mmToIU(DEFAULT_SOLDERMASK_TO_COPPER_CLEARANCE);

    // Solder paste margin absolute value
    this.m_SolderPasteMargin = pcbIUScale.mmToIU(DEFAULT_SOLDERPASTE_CLEARANCE);
    // Solder paste margin as a ratio of pad size
    // The final margin is the sum of these 2 values
    // Usually < 0 because the mask is smaller than pad
    this.m_SolderPasteMarginRatio = DEFAULT_SOLDERPASTE_RATIO;

    this.m_AllowSoldermaskBridgesInFPs = false;
    this.m_TentViasFront = true;
    this.m_TentViasBack = true;

    this.m_CoverViasFront = false;
    this.m_CoverViasBack = false;

    this.m_PlugViasFront = false;
    this.m_PlugViasBack = false;

    this.m_CapVias = false;
    this.m_FillVias = false;

    // Layer thickness for 3D viewer
    this.m_boardThickness = pcbIUScale.mmToIU(DEFAULT_BOARD_THICKNESS_MM);

    // Default spacing for meanders
    this.m_SingleTrackMeanderSettings.spacing = pcbIUScale.mmToIU(DEFAULT_MEANDER_SPACING);
    this.m_SkewMeanderSettings.spacing = pcbIUScale.mmToIU(DEFAULT_MEANDER_SPACING);
    this.m_DiffPairMeanderSettings.spacing = pcbIUScale.mmToIU(DEFAULT_DP_MEANDER_SPACING);

    this.m_viaSizeIndex = 0;
    this.m_trackWidthIndex = 0;
    this.m_diffPairIndex = 0;

    // Parameters stored in JSON in the project file

    // NOTE: Previously, BOARD_DESIGN_SETTINGS stored the basic board layer information (layer
    // names and enable/disable state) in the project file even though this information is also
    // stored in the board file.  This was implemented for importing these settings from another
    // project.  Going forward, the import feature will just import from other board files (since
    // we could have multi-board projects in the future anyway) so this functionality is dropped.

    this.registerParams();

    this.registerMigration(0, 1, () => this.migrateSchema0to1());
    this.registerMigration(1, 2, () => {
      // Schema 1 to 2: move mask and paste margin settings back to board.
      // The parameters are removed, so we just have to manually load them here and
      // they will get saved with the board
      let optval = this.Get<number>('rules.solder_mask_clearance');
      if (optval !== undefined)
        this.m_SolderMaskExpansion = Math.trunc(optval * pcbIUScale.IU_PER_MM);

      optval = this.Get<number>('rules.solder_mask_min_width');
      if (optval !== undefined)
        this.m_SolderMaskMinWidth = Math.trunc(optval * pcbIUScale.IU_PER_MM);

      optval = this.Get<number>('rules.solder_paste_clearance');
      if (optval !== undefined)
        this.m_SolderPasteMargin = Math.trunc(optval * pcbIUScale.IU_PER_MM);

      optval = this.Get<number>('rules.solder_paste_margin_ratio');
      if (optval !== undefined) this.m_SolderPasteMarginRatio = optval;

      this.Erase('rules.solder_mask_clearance');
      this.Erase('rules.solder_mask_min_width');
      this.Erase('rules.solder_paste_clearance');
      this.Erase('rules.solder_paste_margin_ratio');

      return true;
    });

    if (aParent) this.LoadFromFile();
  }

  /** The 85 `m_params.emplace_back` of the constructor, in its order. */
  private registerParams(): void {
    const mm = (v: number): number => pcbIUScale.mmToIU(v);
    const MM_PER_IU = pcbIUScale.MM_PER_IU;
    const scaled = (
      aPath: string,
      aPtr: { get: () => number; set: (v: number) => void },
      aDefault: number,
      aMinMM: number,
      aMaxMM: number,
    ): void => {
      this.m_params.push(
        new PARAM_SCALED(aPath, aPtr, aDefault, mm(aMinMM), mm(aMaxMM), MM_PER_IU),
      );
    };

    this.m_params.push(
      new PARAM<boolean>(
        'rules.use_height_for_length_calcs',
        ref(this, 'm_UseHeightForLengthCalcs'),
        true,
      ),
    );

    scaled('rules.min_clearance', ref(this, 'm_MinClearance'), mm(DEFAULT_MINCLEARANCE), 0.0, 25.0);
    scaled('rules.min_connection', ref(this, 'm_MinConn'), mm(DEFAULT_MINCONNECTION), 0.0, 100.0);
    scaled(
      'rules.min_track_width',
      ref(this, 'm_TrackMinWidth'),
      mm(DEFAULT_TRACKMINWIDTH),
      0.0,
      25.0,
    );
    scaled(
      'rules.min_via_annular_width',
      ref(this, 'm_ViasMinAnnularWidth'),
      mm(DEFAULT_VIASMINSIZE),
      0.0,
      25.0,
    );
    scaled(
      'rules.min_via_diameter',
      ref(this, 'm_ViasMinSize'),
      mm(DEFAULT_VIASMINSIZE),
      0.0,
      25.0,
    );
    scaled(
      'rules.min_through_hole_diameter',
      ref(this, 'm_MinThroughDrill'),
      mm(DEFAULT_MINTHROUGHDRILL),
      0.0,
      25.0,
    );
    scaled(
      'rules.min_microvia_diameter',
      ref(this, 'm_MicroViasMinSize'),
      mm(DEFAULT_MICROVIASMINSIZE),
      0.0,
      10.0,
    );
    scaled(
      'rules.min_microvia_drill',
      ref(this, 'm_MicroViasMinDrill'),
      mm(DEFAULT_MICROVIASMINDRILL),
      0.0,
      10.0,
    );
    scaled(
      'rules.min_hole_to_hole',
      ref(this, 'm_HoleToHoleMin'),
      mm(DEFAULT_HOLETOHOLEMIN),
      0.0,
      10.0,
    );
    scaled(
      'rules.min_hole_clearance',
      ref(this, 'm_HoleClearance'),
      mm(DEFAULT_HOLECLEARANCE),
      0.0,
      100.0,
    );
    scaled(
      'rules.min_silk_clearance',
      ref(this, 'm_SilkClearance'),
      mm(DEFAULT_SILKCLEARANCE),
      -10.0,
      100.0,
    );
    scaled(
      'rules.min_groove_width',
      ref(this, 'm_MinGrooveWidth'),
      mm(DEFAULT_MINGROOVEWIDTH),
      0.0,
      25.0,
    );

    // While the maximum *effective* value is 4, we've had users interpret this as the count on
    // all layers, and enter something like 10.  They'll figure it out soon enough *unless* we
    // enforce a max of 4 (and therefore reset it back to the default of 2), at which point it
    // just looks buggy.
    this.m_params.push(
      new PARAM<number>(
        'rules.min_resolved_spokes',
        ref(this, 'm_MinResolvedSpokes'),
        DEFAULT_MINRESOLVEDSPOKES,
        0,
        99,
      ),
    );

    scaled(
      'rules.min_text_height',
      ref(this, 'm_MinSilkTextHeight'),
      mm(DEFAULT_SILK_TEXT_SIZE * 0.8),
      0.0,
      100.0,
    );
    scaled(
      'rules.min_text_thickness',
      ref(this, 'm_MinSilkTextThickness'),
      mm(DEFAULT_SILK_TEXT_WIDTH * 0.8),
      0.0,
      25.0,
    );

    // Note: a clearance of -0.01 is a flag indicating we should use the legacy (pre-6.0) method
    // based on the edge cut thicknesses.
    scaled(
      'rules.min_copper_edge_clearance',
      ref(this, 'm_CopperEdgeClearance'),
      mm(DEFAULT_COPPEREDGECLEARANCE),
      -0.01,
      25.0,
    );

    this.m_params.push(
      new PARAM_LAMBDA<JsonValue>(
        'rule_severities',
        () => {
          const ret: JsonObject = {};

          for (const item of DRC_ITEM.GetItemsWithSeverities()) {
            const name = item.GetSettingsKey();
            const code = item.GetErrorCode();

            if (name === '' || !this.m_DRCSeverities.has(code)) continue;

            ret[name] = SeverityToString(this.m_DRCSeverities.get(code)!);
          }

          return ret;
        },
        (aJson) => {
          if (aJson === null || typeof aJson !== 'object' || Array.isArray(aJson)) return;

          // Load V8 'hole_near_hole' token first (if present).  Any current 'hole_to_hole' token
          // found will then overwrite it.
          // We can't use the migration architecture because we forgot to bump the version number
          // when the change was made.  But this is a one-off as any future deprecations should
          // bump the version number and use registerMigration().
          if ('hole_near_hole' in aJson) {
            this.m_DRCSeverities.set(
              PCB_DRC_CODE.DRCE_DRILLED_HOLES_TOO_CLOSE,
              SeverityFromString(String(aJson.hole_near_hole)),
            );
          }

          for (const item of DRC_ITEM.GetItemsWithSeverities()) {
            const key = item.GetSettingsKey();

            if (key in aJson)
              this.m_DRCSeverities.set(item.GetErrorCode(), SeverityFromString(String(aJson[key])));
          }
        },
        {},
      ),
    );

    this.m_params.push(
      new PARAM_LAMBDA<JsonValue>(
        'drc_exclusions',
        () => {
          const js: JsonValue[] = [];

          for (const entry of this.m_DrcExclusions)
            js.push([entry, this.m_DrcExclusionComments.get(entry) ?? '']);

          return js;
        },
        (aObj) => {
          this.m_DrcExclusions.clear();

          if (!Array.isArray(aObj)) return;

          for (const entry of aObj) {
            if (Array.isArray(entry)) {
              const serialized = String(entry[0]);
              this.m_DrcExclusions.add(serialized);
              this.m_DrcExclusionComments.set(serialized, String(entry[1] ?? ''));
            } else if (typeof entry === 'string') {
              this.m_DrcExclusions.add(entry);
            }
          }
        },
        {},
      ),
    );

    this.m_params.push(
      new PARAM_LAMBDA<JsonValue>(
        'track_widths',
        () => this.m_TrackWidthList.map((width) => pcbIUScale.iuToMM(width)),
        (aJson) => {
          if (!Array.isArray(aJson)) return;

          this.m_TrackWidthList = [];

          for (const entry of aJson) {
            // `entry.empty()`: a null, an empty string, array or object.
            if (
              entry === null ||
              entry === '' ||
              (typeof entry === 'object' && Object.keys(entry).length === 0)
            )
              continue;

            this.m_TrackWidthList.push(pcbIUScale.mmToIU(Number(entry)));
          }
        },
        {},
      ),
    );

    this.m_params.push(
      new PARAM_LAMBDA<JsonValue>(
        'via_dimensions',
        () =>
          this.m_ViasDimensionsList.map((via) => ({
            diameter: pcbIUScale.iuToMM(via.m_Diameter),
            drill: pcbIUScale.iuToMM(via.m_Drill),
          })),
        (aObj) => {
          if (!Array.isArray(aObj)) return;

          this.m_ViasDimensionsList = [];

          for (const entry of aObj) {
            if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
            if (Object.keys(entry).length === 0) continue;

            if (!('diameter' in entry) || !('drill' in entry)) continue;

            const diameter = pcbIUScale.mmToIU(Number(entry.diameter));
            const drill = pcbIUScale.mmToIU(Number(entry.drill));

            this.m_ViasDimensionsList.push(new VIA_DIMENSION(diameter, drill));
          }
        },
        {},
      ),
    );

    this.m_params.push(
      new PARAM_LAMBDA<JsonValue>(
        'diff_pair_dimensions',
        () =>
          this.m_DiffPairDimensionsList.map((pair) => ({
            width: pcbIUScale.iuToMM(pair.m_Width),
            gap: pcbIUScale.iuToMM(pair.m_Gap),
            via_gap: pcbIUScale.iuToMM(pair.m_ViaGap),
          })),
        (aObj) => {
          if (!Array.isArray(aObj)) return;

          this.m_DiffPairDimensionsList = [];

          for (const entry of aObj) {
            if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
            if (Object.keys(entry).length === 0) continue;

            if (!('width' in entry) || !('gap' in entry) || !('via_gap' in entry)) continue;

            const width = pcbIUScale.mmToIU(Number(entry.width));
            const gap = pcbIUScale.mmToIU(Number(entry.gap));
            const via_gap = pcbIUScale.mmToIU(Number(entry.via_gap));

            this.m_DiffPairDimensionsList.push(new DIFF_PAIR_DIMENSION(width, gap, via_gap));
          }
        },
        {},
      ),
    );

    // Handle options for teardrops (targets and some others):
    this.m_params.push(
      new PARAM_LAMBDA<JsonValue>(
        'teardrop_options',
        () => [
          {
            td_onvia: this.m_TeardropParamsList.m_TargetVias,
            td_onpthpad: this.m_TeardropParamsList.m_TargetPTHPads,
            td_onsmdpad: this.m_TeardropParamsList.m_TargetSMDPads,
            td_ontrackend: this.m_TeardropParamsList.m_TargetTrack2Track,
            td_onroundshapesonly: this.m_TeardropParamsList.m_UseRoundShapesOnly,
          },
        ],
        (aObj) => {
          if (!Array.isArray(aObj)) return;

          for (const entry of aObj) {
            if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
            if (Object.keys(entry).length === 0) continue;

            if ('td_onvia' in entry)
              this.m_TeardropParamsList.m_TargetVias = Boolean(entry.td_onvia);

            if ('td_onpthpad' in entry)
              this.m_TeardropParamsList.m_TargetPTHPads = Boolean(entry.td_onpthpad);

            if ('td_onsmdpad' in entry)
              this.m_TeardropParamsList.m_TargetSMDPads = Boolean(entry.td_onsmdpad);

            if ('td_ontrackend' in entry)
              this.m_TeardropParamsList.m_TargetTrack2Track = Boolean(entry.td_ontrackend);

            if ('td_onroundshapesonly' in entry)
              this.m_TeardropParamsList.m_UseRoundShapesOnly = Boolean(entry.td_onroundshapesonly);

            // Legacy settings
            for (let ii = 0; ii < 3; ++ii) {
              const td_prm = this.m_TeardropParamsList.GetParameters(ii as TARGET_TD);

              if ('td_allow_use_two_tracks' in entry)
                td_prm.m_AllowUseTwoTracks = Boolean(entry.td_allow_use_two_tracks);

              if ('td_curve_segcount' in entry) {
                if (Number(entry.td_curve_segcount) > 0) td_prm.m_CurvedEdges = true;
              }

              if ('td_on_pad_in_zone' in entry)
                td_prm.m_TdOnPadsInZones = Boolean(entry.td_on_pad_in_zone);
            }
          }
        },
        {},
      ),
    );

    // Handle parameters (sizes, shape) for each type of teardrop:
    this.m_params.push(
      new PARAM_LAMBDA<JsonValue>(
        'teardrop_parameters',
        () => {
          const js: JsonValue[] = [];

          for (let ii = 0; ii < this.m_TeardropParamsList.GetParametersCount(); ii++) {
            const td_prm = this.m_TeardropParamsList.GetParameters(ii as TARGET_TD);

            js.push({
              td_target_name: GetTeardropTargetCanonicalName(ii as TARGET_TD),
              td_maxlen: pcbIUScale.iuToMM(td_prm.m_TdMaxLen),
              td_maxheight: pcbIUScale.iuToMM(td_prm.m_TdMaxWidth),
              td_length_ratio: td_prm.m_BestLengthRatio,
              td_height_ratio: td_prm.m_BestWidthRatio,
              td_curve_segcount: td_prm.m_CurvedEdges ? 1 : 0,
              td_width_to_size_filter_ratio: td_prm.m_WidthtoSizeFilterRatio,
              td_allow_use_two_tracks: td_prm.m_AllowUseTwoTracks,
              td_on_pad_in_zone: td_prm.m_TdOnPadsInZones,
            });
          }

          return js;
        },
        (aObj) => {
          if (!Array.isArray(aObj)) return;

          for (const entry of aObj) {
            if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
            if (Object.keys(entry).length === 0) continue;

            if (!('td_target_name' in entry)) continue;

            const idx = GetTeardropTargetTypeFromCanonicalName(String(entry.td_target_name));

            if (idx >= 0 && idx < 3) {
              const td_prm = this.m_TeardropParamsList.GetParameters(idx);

              if ('td_maxlen' in entry)
                td_prm.m_TdMaxLen = pcbIUScale.mmToIU(Number(entry.td_maxlen));

              if ('td_maxheight' in entry)
                td_prm.m_TdMaxWidth = pcbIUScale.mmToIU(Number(entry.td_maxheight));

              if ('td_length_ratio' in entry)
                td_prm.m_BestLengthRatio = Number(entry.td_length_ratio);

              if ('td_height_ratio' in entry)
                td_prm.m_BestWidthRatio = Number(entry.td_height_ratio);

              if ('td_curve_segcount' in entry) {
                if (Number(entry.td_curve_segcount) > 0) td_prm.m_CurvedEdges = true;
              }

              if ('td_width_to_size_filter_ratio' in entry)
                td_prm.m_WidthtoSizeFilterRatio = Number(entry.td_width_to_size_filter_ratio);

              if ('td_allow_use_two_tracks' in entry)
                td_prm.m_AllowUseTwoTracks = Boolean(entry.td_allow_use_two_tracks);

              if ('td_on_pad_in_zone' in entry)
                td_prm.m_TdOnPadsInZones = Boolean(entry.td_on_pad_in_zone);
            }
          }
        },
        {},
      ),
    );

    this.m_params.push(
      new PARAM_LAMBDA<JsonValue>(
        'tuning_pattern_settings',
        () => {
          const make_settings = (aSettings: MeanderSettings): JsonObject => ({
            min_amplitude: pcbIUScale.iuToMM(aSettings.minAmplitude),
            max_amplitude: pcbIUScale.iuToMM(aSettings.maxAmplitude),
            spacing: pcbIUScale.iuToMM(aSettings.spacing),
            corner_style: aSettings.cornerStyle === MeanderStyle.MEANDER_STYLE_CHAMFER ? 0 : 1,
            corner_radius_percentage: aSettings.cornerRadiusPercentage,
            single_sided: aSettings.singleSided,
          });

          return {
            single_track_defaults: make_settings(this.m_SingleTrackMeanderSettings),
            diff_pair_defaults: make_settings(this.m_DiffPairMeanderSettings),
            diff_pair_skew_defaults: make_settings(this.m_SkewMeanderSettings),
          };
        },
        (aObj) => {
          const read_settings = (entry: JsonValue): MeanderSettings => {
            const settings = defaultMeanderSettings();

            if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
              return settings;

            if ('min_amplitude' in entry)
              settings.minAmplitude = pcbIUScale.mmToIU(Number(entry.min_amplitude));

            if ('max_amplitude' in entry)
              settings.maxAmplitude = pcbIUScale.mmToIU(Number(entry.max_amplitude));

            if ('spacing' in entry) settings.spacing = pcbIUScale.mmToIU(Number(entry.spacing));

            if ('corner_style' in entry) {
              settings.cornerStyle =
                entry.corner_style === 0
                  ? MeanderStyle.MEANDER_STYLE_CHAMFER
                  : MeanderStyle.MEANDER_STYLE_ROUND;
            }

            if ('corner_radius_percentage' in entry)
              settings.cornerRadiusPercentage = Math.trunc(Number(entry.corner_radius_percentage));

            if ('single_sided' in entry) settings.singleSided = Boolean(entry.single_sided);

            return settings;
          };

          if (aObj === null || typeof aObj !== 'object' || Array.isArray(aObj)) return;

          if ('single_track_defaults' in aObj)
            this.m_SingleTrackMeanderSettings = read_settings(aObj.single_track_defaults);

          if ('diff_pair_defaults' in aObj)
            this.m_DiffPairMeanderSettings = read_settings(aObj.diff_pair_defaults);

          if ('diff_pair_skew_defaults' in aObj)
            this.m_SkewMeanderSettings = read_settings(aObj.diff_pair_skew_defaults);
        },
        {},
      ),
    );

    const minTextSize = mm(TEXT_MIN_SIZE_MM);
    const maxTextSize = mm(TEXT_MAX_SIZE_MM);
    const minStroke = 1;
    const maxStroke = mm(100);

    // `&m_LineThickness[cls]` and `&m_TextSize[cls].x`: the element, by index,
    // so a later assignment of the whole entry is still what the param reads.
    const lineRef = (cls: number) => ({
      get: () => this.m_LineThickness[cls]!,
      set: (v: number) => {
        this.m_LineThickness[cls] = v;
      },
    });
    const textThickRef = (cls: number) => ({
      get: () => this.m_TextThickness[cls]!,
      set: (v: number) => {
        this.m_TextThickness[cls] = v;
      },
    });
    const textSizeRef = (cls: number, axis: 'x' | 'y') => ({
      get: () => this.m_TextSize[cls]![axis],
      set: (v: number) => {
        this.m_TextSize[cls]![axis] = v;
      },
    });
    const boolRef = (arr: boolean[], cls: number) => ({
      get: () => arr[cls]!,
      set: (v: boolean) => {
        arr[cls] = v;
      },
    });
    const layerClass = (
      aPrefix: string,
      aLineDefault: number,
      aTextSize: number,
      aTextWidth: number,
      cls: number,
      aWithText: boolean,
    ): void => {
      this.m_params.push(
        new PARAM_SCALED(
          `defaults.${aPrefix}_line_width`,
          lineRef(cls),
          mm(aLineDefault),
          minStroke,
          maxStroke,
          MM_PER_IU,
        ),
      );

      if (!aWithText) return;

      this.m_params.push(
        new PARAM_SCALED(
          `defaults.${aPrefix}_text_size_v`,
          textSizeRef(cls, 'y'),
          mm(aTextSize),
          minTextSize,
          maxTextSize,
          MM_PER_IU,
        ),
      );
      this.m_params.push(
        new PARAM_SCALED(
          `defaults.${aPrefix}_text_size_h`,
          textSizeRef(cls, 'x'),
          mm(aTextSize),
          minTextSize,
          maxTextSize,
          MM_PER_IU,
        ),
      );
      this.m_params.push(
        new PARAM_SCALED(
          `defaults.${aPrefix}_text_thickness`,
          textThickRef(cls),
          mm(aTextWidth),
          minStroke,
          maxStroke,
          MM_PER_IU,
        ),
      );
      this.m_params.push(
        new PARAM<boolean>(
          `defaults.${aPrefix}_text_italic`,
          boolRef(this.m_TextItalic, cls),
          false,
        ),
      );
      this.m_params.push(
        new PARAM<boolean>(
          `defaults.${aPrefix}_text_upright`,
          boolRef(this.m_TextUpright, cls),
          true,
        ),
      );
    };

    layerClass(
      'silk',
      DEFAULT_SILK_LINE_WIDTH,
      DEFAULT_SILK_TEXT_SIZE,
      DEFAULT_SILK_TEXT_WIDTH,
      LAYER_CLASS_SILK,
      true,
    );
    layerClass(
      'copper',
      DEFAULT_COPPER_LINE_WIDTH,
      DEFAULT_COPPER_TEXT_SIZE,
      DEFAULT_COPPER_TEXT_WIDTH,
      LAYER_CLASS_COPPER,
      true,
    );
    layerClass('board_outline', DEFAULT_EDGE_WIDTH, 0, 0, LAYER_CLASS_EDGES, false);
    layerClass('courtyard', DEFAULT_COURTYARD_WIDTH, 0, 0, LAYER_CLASS_COURTYARD, false);
    layerClass(
      'fab',
      DEFAULT_LINE_WIDTH,
      DEFAULT_TEXT_SIZE,
      DEFAULT_TEXT_WIDTH,
      LAYER_CLASS_FAB,
      true,
    );
    layerClass(
      'other',
      DEFAULT_LINE_WIDTH,
      DEFAULT_TEXT_SIZE,
      DEFAULT_TEXT_WIDTH,
      LAYER_CLASS_OTHERS,
      true,
    );

    this.m_params.push(
      new PARAM_ENUM<DIM_UNITS_MODE>(
        'defaults.dimension_units',
        ref(this, 'm_DimensionUnitsMode'),
        DIM_UNITS_MODE.AUTOMATIC,
        DIM_UNITS_MODE.INCH,
        DIM_UNITS_MODE.AUTOMATIC,
      ),
    );

    this.m_params.push(
      new PARAM_ENUM<DIM_PRECISION>(
        'defaults.dimension_precision',
        ref(this, 'm_DimensionPrecision'),
        DIM_PRECISION.X_XXXX,
        DIM_PRECISION.X,
        DIM_PRECISION.V_VVVVV,
      ),
    );

    this.m_params.push(
      new PARAM_ENUM<DIM_UNITS_FORMAT>(
        'defaults.dimensions.units_format',
        ref(this, 'm_DimensionUnitsFormat'),
        DIM_UNITS_FORMAT.NO_SUFFIX,
        DIM_UNITS_FORMAT.NO_SUFFIX,
        DIM_UNITS_FORMAT.PAREN_SUFFIX,
      ),
    );

    this.m_params.push(
      new PARAM<boolean>(
        'defaults.dimensions.suppress_zeroes',
        ref(this, 'm_DimensionSuppressZeroes'),
        true,
      ),
    );

    // NOTE: excluding DIM_TEXT_POSITION::MANUAL from the valid range here
    this.m_params.push(
      new PARAM_ENUM<DIM_TEXT_POSITION>(
        'defaults.dimensions.text_position',
        ref(this, 'm_DimensionTextPosition'),
        DIM_TEXT_POSITION.OUTSIDE,
        DIM_TEXT_POSITION.OUTSIDE,
        DIM_TEXT_POSITION.INLINE,
      ),
    );

    this.m_params.push(
      new PARAM<boolean>(
        'defaults.dimensions.keep_text_aligned',
        ref(this, 'm_DimensionKeepTextAligned'),
        true,
      ),
    );

    this.m_params.push(
      new PARAM<number>(
        'defaults.dimensions.arrow_length',
        ref(this, 'm_DimensionArrowLength'),
        pcbIUScale.milsToIU(DEFAULT_DIMENSION_ARROW_LENGTH),
      ),
    );

    this.m_params.push(
      new PARAM<number>(
        'defaults.dimensions.extension_offset',
        ref(this, 'm_DimensionExtensionOffset'),
        mm(DEFAULT_DIMENSION_EXTENSION_OFFSET),
      ),
    );

    this.m_params.push(
      new PARAM<boolean>(
        'defaults.apply_defaults_to_fp_fields',
        ref(this, 'm_StyleFPFields'),
        false,
      ),
    );
    this.m_params.push(
      new PARAM<boolean>('defaults.apply_defaults_to_fp_text', ref(this, 'm_StyleFPText'), false),
    );
    this.m_params.push(
      new PARAM<boolean>(
        'defaults.apply_defaults_to_fp_shapes',
        ref(this, 'm_StyleFPShapes'),
        false,
      ),
    );
    this.m_params.push(
      new PARAM<boolean>(
        'defaults.apply_defaults_to_fp_dimensions',
        ref(this, 'm_StyleFPDimensions'),
        false,
      ),
    );
    this.m_params.push(
      new PARAM<boolean>(
        'defaults.apply_defaults_to_fp_barcodes',
        ref(this, 'm_StyleFPBarcodes'),
        false,
      ),
    );

    // `&m_defaultZoneSettings.<field>`: through the current object, which
    // SetDefaultZoneSettings replaces.
    const zoneRef = <K extends keyof ZONE_SETTINGS>(key: K) => ({
      get: () => this.m_defaultZoneSettings[key] as number,
      set: (v: number) => {
        (this.m_defaultZoneSettings as unknown as Record<K, number>)[key] = v;
      },
    });

    scaled(
      'defaults.zones.min_clearance',
      zoneRef('m_ZoneClearance'),
      mm(ZONE_CLEARANCE_MM),
      0.0,
      25.0,
    );
    scaled(
      'defaults.zones.min_thickness',
      zoneRef('m_ZoneMinThickness'),
      mm(ZONE_THICKNESS_MM),
      ZONE_THICKNESS_MIN_VALUE_MM,
      25.0,
    );

    this.m_params.push(
      new PARAM_ENUM<ZONE_FILL_MODE>(
        'defaults.zones.fill_mode',
        zoneRef('m_FillMode') as { get: () => ZONE_FILL_MODE; set: (v: ZONE_FILL_MODE) => void },
        ZONE_FILL_MODE.POLYGONS,
        ZONE_FILL_MODE.POLYGONS,
        ZONE_FILL_MODE.HATCH_PATTERN,
      ),
    );

    scaled(
      'defaults.zones.hatch_thickness',
      zoneRef('m_HatchThickness'),
      Math.max(mm(ZONE_THICKNESS_MM) * 4, mm(1.0)),
      0.0,
      25.0,
    );
    scaled(
      'defaults.zones.hatch_gap',
      zoneRef('m_HatchGap'),
      Math.max(mm(ZONE_THICKNESS_MM) * 6, mm(1.5)),
      0.0,
      25.0,
    );

    this.m_params.push(
      new PARAM_LAMBDA<number>(
        'defaults.zones.hatch_orientation',
        () => this.m_defaultZoneSettings.m_HatchOrientation.AsDegrees(),
        (aVal) => {
          this.m_defaultZoneSettings.m_HatchOrientation = new EDA_ANGLE(aVal);
        },
        0.0,
      ),
    );

    this.m_params.push(
      new PARAM<number>(
        'defaults.zones.hatch_smoothing_level',
        zoneRef('m_HatchSmoothingLevel'),
        0,
        0,
        2,
      ),
    );
    this.m_params.push(
      new PARAM<number>(
        'defaults.zones.hatch_smoothing_value',
        zoneRef('m_HatchSmoothingValue'),
        0.1,
        0.0,
        1.0,
      ),
    );

    this.m_params.push(
      new PARAM_ENUM<ZONE_BORDER_DISPLAY_STYLE>(
        'defaults.zones.border_display_style',
        zoneRef('m_ZoneBorderDisplayStyle') as {
          get: () => ZONE_BORDER_DISPLAY_STYLE;
          set: (v: ZONE_BORDER_DISPLAY_STYLE) => void;
        },
        ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
        ZONE_BORDER_DISPLAY_STYLE.NO_HATCH,
        ZONE_BORDER_DISPLAY_STYLE.INVISIBLE_BORDER,
      ),
    );

    scaled(
      'defaults.zones.border_hatch_pitch',
      zoneRef('m_BorderHatchPitch'),
      mm(ZONE_BORDER_HATCH_DIST_MM),
      ZONE_BORDER_HATCH_MINDIST_MM,
      ZONE_BORDER_HATCH_MAXDIST_MM,
    );
    scaled(
      'defaults.zones.thermal_relief_gap',
      zoneRef('m_ThermalReliefGap'),
      mm(ZONE_THERMAL_RELIEF_GAP_MM),
      0.0,
      25.0,
    );
    scaled(
      'defaults.zones.thermal_relief_spoke_width',
      zoneRef('m_ThermalReliefSpokeWidth'),
      mm(ZONE_THERMAL_RELIEF_COPPER_WIDTH_MM),
      0.0,
      25.0,
    );

    this.m_params.push(
      new PARAM_LAMBDA<number>(
        'defaults.zones.pad_connection',
        () => this.m_defaultZoneSettings.GetPadConnection() as number,
        (aVal) => {
          this.m_defaultZoneSettings.SetPadConnection(aVal as ZONE_CONNECTION);
        },
        ZONE_CONNECTION.THERMAL as number,
      ),
    );

    this.m_params.push(
      new PARAM_LAMBDA<number>(
        'defaults.zones.corner_smoothing',
        () => this.m_defaultZoneSettings.GetCornerSmoothingType(),
        (aVal) => {
          this.m_defaultZoneSettings.SetCornerSmoothingType(aVal);
        },
        ZONE_SETTINGS.SMOOTHING_NONE,
      ),
    );

    this.m_params.push(
      new PARAM_LAMBDA<number>(
        'defaults.zones.corner_radius',
        () => pcbIUScale.iuToMM(this.m_defaultZoneSettings.GetCornerRadius()),
        (aVal) => {
          this.m_defaultZoneSettings.SetCornerRadius(pcbIUScale.mmToIU(aVal));
        },
        0.0,
      ),
    );

    this.m_params.push(
      new PARAM_LAMBDA<number>(
        'defaults.zones.remove_islands',
        () => this.m_defaultZoneSettings.GetIslandRemovalMode() as number,
        (aVal) => {
          this.m_defaultZoneSettings.SetIslandRemovalMode(aVal as ISLAND_REMOVAL_MODE);
        },
        ISLAND_REMOVAL_MODE.ALWAYS as number,
      ),
    );

    this.m_params.push(
      new PARAM_LAMBDA<number>(
        'defaults.zones.min_island_area',
        () => {
          const iuPerMm2 = pcbIUScale.IU_PER_MM * pcbIUScale.IU_PER_MM;
          return this.m_defaultZoneSettings.GetMinIslandArea() / iuPerMm2;
        },
        (aVal) => {
          const iuPerMm2 = pcbIUScale.IU_PER_MM * pcbIUScale.IU_PER_MM;
          this.m_defaultZoneSettings.SetMinIslandArea(Math.trunc(aVal * iuPerMm2));
        },
        10.0,
      ),
    );

    this.m_params.push(
      new PARAM_LAMBDA<JsonValue>(
        'defaults.pads',
        () => ({
          width: pcbIUScale.iuToMM(this.m_Pad_Master.GetSize(PADSTACK.ALL_LAYERS).x),
          height: pcbIUScale.iuToMM(this.m_Pad_Master.GetSize(PADSTACK.ALL_LAYERS).y),
          drill: pcbIUScale.iuToMM(this.m_Pad_Master.GetDrillSize().x),
        }),
        (aJson) => {
          if (aJson === null || typeof aJson !== 'object' || Array.isArray(aJson)) return;

          if ('width' in aJson && 'height' in aJson && 'drill' in aJson) {
            const sz = {
              x: pcbIUScale.mmToIU(Number(aJson.width)),
              y: pcbIUScale.mmToIU(Number(aJson.height)),
            };
            this.m_Pad_Master.SetSize(PADSTACK.ALL_LAYERS, sz);
            const drill = pcbIUScale.mmToIU(Number(aJson.drill));
            this.m_Pad_Master.SetDrillSize({ x: drill, y: drill });
          }
        },
        {},
      ),
    );

    scaled('rules.max_error', ref(this, 'm_MaxError'), ARC_HIGH_DEF, 0.0001, 1.0);

    scaled(
      'rules.solder_mask_to_copper_clearance',
      ref(this, 'm_SolderMaskToCopperClearance'),
      mm(DEFAULT_SOLDERMASK_TO_COPPER_CLEARANCE),
      0.0,
      25.0,
    );

    this.m_params.push(
      new PARAM<boolean>(
        'zones_allow_external_fillets',
        ref(this, 'm_ZoneKeepExternalFillets'),
        false,
      ),
    );
  }

  /**
   * Schema 0 to 1: default dimension precision changed in meaning.
   * Previously it was an enum with the following meaning:
   *
   * 0: 0.01mm / 1 mil / 0.001 in
   * 1: 0.001mm / 0.1 mil / 0.0001 in
   * 2: 0.0001mm / 0.01 mil / 0.00001 in
   *
   * Now it is independent of display units and is an integer meaning the number of digits
   * displayed after the decimal point, so we have to migrate based on the default units.
   *
   * The units is an integer with the following mapping:
   *
   * 0: Inches
   * 1: Mils
   * 2: Millimeters
   */
  private migrateSchema0to1(): boolean {
    const units_ptr = 'defaults.dimension_units';
    const precision_ptr = 'defaults.dimension_precision';

    const units = this.Get<number>(units_ptr);
    let precision = this.Get<number>(precision_ptr);

    if (
      units === undefined ||
      precision === undefined ||
      !Number.isInteger(units) ||
      !Number.isInteger(precision)
    ) {
      // if either is missing or invalid, migration doesn't make sense
      return true;
    }

    // The enum maps directly to precision if the units is mils
    let extraDigits = 0;

    switch (units) {
      case 0:
        extraDigits = 3;
        break;
      case 2:
        extraDigits = 2;
        break;
      default:
        break;
    }

    precision += extraDigits;

    this.Set<number>(precision_ptr, precision);

    return true;
  }

  /**
   * Return a bit-mask of all the layers that are enabled.
   *
   * @return the enabled layers in bit-mapped form.
   */
  GetEnabledLayers(): LSET {
    return this.m_enabledLayers;
  }

  /**
   * Change the bit-mask of enabled layers to \a aMask.
   *
   * @param aMask = The new bit-mask of enabled layers.
   */
  SetEnabledLayers(aMask: LSET): void {
    this.m_enabledLayers = new LSET(aMask);

    // Ensures mandatory back and front layers are always enabled regardless of board file
    // configuration.
    this.m_enabledLayers
      .set(PCB_LAYER_ID.B_Cu)
      .set(PCB_LAYER_ID.F_Cu)
      .set(PCB_LAYER_ID.B_CrtYd)
      .set(PCB_LAYER_ID.F_CrtYd)
      .set(PCB_LAYER_ID.Edge_Cuts)
      .set(PCB_LAYER_ID.Margin);

    // update layer counts to ensure their consistency with m_EnabledLayers
    const copperLayers = new LSET(aMask);
    copperLayers.ClearNonCopperLayers();

    const userLayers = aMask.and(LSET.UserDefinedLayersMask());

    this.m_copperLayerCount = copperLayers.count();
    this.m_userDefinedLayerCount = userLayers.count();
  }

  /**
   * Test whether a given layer \a aLayerId is enabled.
   *
   * @param aLayerId = The layer to be tested.
   * @return true if the layer is enabled.
   */
  IsLayerEnabled(aLayerId: PCB_LAYER_ID): boolean {
    if (aLayerId >= 0 && aLayerId < PCB_LAYER_ID.PCB_LAYER_ID_COUNT)
      return this.m_enabledLayers.at(aLayerId);

    return false;
  }

  /**
   * @return the number of enabled copper layers.
   */
  GetCopperLayerCount(): number {
    return this.m_copperLayerCount;
  }

  /**
   * Set the copper layer count to \a aNewLayerCount.
   *
   * @param aNewLayerCount = The new number of enabled copper layers.
   */
  SetCopperLayerCount(aNewLayerCount: number): void {
    this.m_copperLayerCount = aNewLayerCount;

    // Update only enabled copper layers mask
    this.m_enabledLayers.ClearCopperLayers();

    if (aNewLayerCount > 0) this.m_enabledLayers.orAssign(LSET.AllCuMask(aNewLayerCount));
  }

  /**
   * Return a reference to the BOARD_STACKUP descriptor.
   */
  GetStackupDescriptor(): BOARD_STACKUP {
    return this.m_stackup;
  }

  GetDefaultZoneSettings(): ZONE_SETTINGS {
    return this.m_defaultZoneSettings;
  }

  SetDefaultZoneSettings(aSettings: ZONE_SETTINGS): void {
    this.m_defaultZoneSettings = aSettings.clone();
  }

  /** `BOARD_DESIGN_SETTINGS::GetDRCEpsilon` (board_design_settings.cpp:1671). */
  GetDRCEpsilon(): number {
    return pcbIUScale.mmToIU(ADVANCED_CFG.GetCfg().m_DRCEpsilon);
  }

  /**
   * Return the biggest clearance value found in NetClasses list.
   */
  GetBiggestClearanceValue(): number {
    let biggest = Math.max(this.m_MinClearance, this.m_HoleClearance);

    biggest = Math.max(biggest, this.m_HoleToHoleMin);
    biggest = Math.max(biggest, this.m_CopperEdgeClearance);

    if (this.m_DRCEngine) {
      // The C++ reuses one `constraint` across the six queries, so a type with
      // no rule leaves the previous minimum in it - which the max has already
      // taken. A null result is that.
      let constraint = this.m_DRCEngine.QueryWorstConstraint(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT);
      if (constraint) biggest = Math.max(biggest, constraint.Value().Min());

      constraint = this.m_DRCEngine.QueryWorstConstraint(
        DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT,
      );
      if (constraint) biggest = Math.max(biggest, constraint.Value().Min());

      constraint = this.m_DRCEngine.QueryWorstConstraint(
        DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT,
      );
      if (constraint) biggest = Math.max(biggest, constraint.Value().Min());

      constraint = this.m_DRCEngine.QueryWorstConstraint(
        DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT,
      );
      if (constraint) biggest = Math.max(biggest, constraint.Value().Min());

      constraint = this.m_DRCEngine.QueryWorstConstraint(
        DRC_CONSTRAINT_T.EDGE_CLEARANCE_CONSTRAINT,
      );
      if (constraint) biggest = Math.max(biggest, constraint.Value().Min());

      constraint = this.m_DRCEngine.QueryWorstConstraint(DRC_CONSTRAINT_T.HOLE_TO_HOLE_CONSTRAINT);
      if (constraint) biggest = Math.max(biggest, constraint.Value().Min());
    }

    // Clip to avoid integer overflows in subsequent calculations
    return Math.min(biggest, MAXIMUM_CLEARANCE);
  }

  /**
   * Return the smallest clearance value found in NetClasses list.
   */
  GetSmallestClearanceValue(): number {
    let clearance = this.m_NetSettings.GetDefaultNetclass().GetClearance();

    for (const [, netclass] of this.m_NetSettings.GetNetclasses())
      clearance = Math.min(clearance, netclass.GetClearance());

    return clearance;
  }

  /**
   * @return the number of enabled user defined layers.
   */
  GetUserDefinedLayerCount(): number {
    return this.m_userDefinedLayerCount;
  }

  /**
   * Set the number of user defined layers to \a aNewLayerCount.
   *
   * @param aNewLayerCount = The new number of enabled user defined layers.
   */
  SetUserDefinedLayerCount(aNewLayerCount: number): void {
    this.m_userDefinedLayerCount = aNewLayerCount;

    this.m_enabledLayers.ClearUserDefinedLayers();

    if (aNewLayerCount > 0)
      this.m_enabledLayers.orAssign(LSET.UserDefinedLayersMask(aNewLayerCount));
  }

  GetHolePlatingThickness(): number {
    return pcbIUScale.mmToIU(ADVANCED_CFG.GetCfg().m_HoleWallThickness);
  }

  /**
   * The full thickness of the board including copper and masks.
   */
  GetBoardThickness(): number {
    return this.m_boardThickness;
  }
  SetBoardThickness(aThickness: number): void {
    this.m_boardThickness = aThickness;
  }

  /**
   * Return the default graphic segment thickness from the layer class for the given layer.
   */
  /**
   * Return the severity of the DRC error code.
   */
  GetSeverity(aDRCErrorCode: number): Severity {
    return this.m_DRCSeverities.get(aDRCErrorCode)!;
  }

  /**
   * Return true if the DRC error code's severity is SEVERITY_IGNORE.
   */
  Ignore(aDRCErrorCode: number): boolean {
    return this.m_DRCSeverities.get(aDRCErrorCode) === RPT_SEVERITY_IGNORE;
  }

  GetLineThickness(aLayer: PCB_LAYER_ID): number {
    return this.m_LineThickness[this.GetLayerClass(aLayer)]!;
  }

  /**
   * Return the default text size from the layer class for the given layer.
   */
  GetTextSize(aLayer: PCB_LAYER_ID): VECTOR2I {
    return this.m_TextSize[this.GetLayerClass(aLayer)]!;
  }

  /**
   * Return the default text thickness from the layer class for the given layer.
   */
  GetTextThickness(aLayer: PCB_LAYER_ID): number {
    return this.m_TextThickness[this.GetLayerClass(aLayer)]!;
  }

  GetTextItalic(aLayer: PCB_LAYER_ID): boolean {
    return this.m_TextItalic[this.GetLayerClass(aLayer)]!;
  }

  /**
   * Set the default values of the master pad.
   */
  SetDefaultMasterPad(): void {
    this.m_Pad_Master.SetSizeX(pcbIUScale.mmToIU(DEFAULT_PAD_WIDTH_MM));
    this.m_Pad_Master.SetSizeY(pcbIUScale.mmToIU(DEFAULT_PAD_HEIGTH_MM));
    this.m_Pad_Master.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE);
    this.m_Pad_Master.SetDrillSize({ x: pcbIUScale.mmToIU(DEFAULT_PAD_DRILL_DIAMETER_MM), y: 0 });
    this.m_Pad_Master.SetShape(PADSTACK.ALL_LAYERS, PAD_SHAPE.ROUNDRECT);

    const RR_RADIUS = DEFAULT_PAD_HEIGTH_MM * DEFAULT_PAD_RR_RADIUS_RATIO;
    this.m_Pad_Master.SetRoundRectCornerRadius(PADSTACK.ALL_LAYERS, pcbIUScale.mmToIU(RR_RADIUS));

    if (this.m_Pad_Master.GetFrontShape() === PAD_SHAPE.CIRCLE)
      this.m_Pad_Master.SetThermalSpokeAngle(ANGLE_45);
    else this.m_Pad_Master.SetThermalSpokeAngle(ANGLE_90);
  }

  GetTextUpright(aLayer: PCB_LAYER_ID): boolean {
    return this.m_TextUpright[this.GetLayerClass(aLayer)]!;
  }

  // Return the layer class index { silk, copper, edges & courtyards, fab, others } of the
  // given layer.
  GetLayerClass(aLayer: PCB_LAYER_ID): number {
    if (aLayer === PCB_LAYER_ID.F_SilkS || aLayer === PCB_LAYER_ID.B_SilkS) return LAYER_CLASS_SILK;
    else if (IsCopperLayer(aLayer)) return LAYER_CLASS_COPPER;
    else if (aLayer === PCB_LAYER_ID.Edge_Cuts) return LAYER_CLASS_EDGES;
    else if (aLayer === PCB_LAYER_ID.F_CrtYd || aLayer === PCB_LAYER_ID.B_CrtYd)
      return LAYER_CLASS_COURTYARD;
    else if (aLayer === PCB_LAYER_ID.F_Fab || aLayer === PCB_LAYER_ID.B_Fab) return LAYER_CLASS_FAB;
    else return LAYER_CLASS_OTHERS;
  }

  SetAuxOrigin(aOrigin: VECTOR2I): void {
    this.m_auxOrigin = { x: aOrigin.x, y: aOrigin.y };
  }
  GetAuxOrigin(): VECTOR2I {
    return this.m_auxOrigin;
  }

  SetGridOrigin(aOrigin: VECTOR2I): void {
    this.m_gridOrigin = { x: aOrigin.x, y: aOrigin.y };
  }
  GetGridOrigin(): VECTOR2I {
    return this.m_gridOrigin;
  }

  GetCurrentNetClassName(): string {
    return this.m_currentNetClassName;
  }
  SetCurrentNetClassName(aName: string): void {
    this.m_currentNetClassName = aName;
  }

  /**
   * Return true if the current diff pair dimensions are custom.
   */
  UseCustomTrackViaSize(): boolean;
  UseCustomTrackViaSize(aEnabled: boolean): void;
  UseCustomTrackViaSize(aEnabled?: boolean): boolean | void {
    if (aEnabled === undefined) return this.m_useCustomTrackVia;

    this.m_useCustomTrackVia = aEnabled;
  }

  UseCustomDiffPairDimensions(): boolean;
  UseCustomDiffPairDimensions(aEnabled: boolean): void;
  UseCustomDiffPairDimensions(aEnabled?: boolean): boolean | void {
    if (aEnabled === undefined) return this.m_useCustomDiffPair;

    this.m_useCustomDiffPair = aEnabled;
  }

  /**
   * `SetTrackWidthIndex( aIndex )` (`board_design_settings.cpp:1518`).
   *
   * Clears the custom flag: choosing a preset is how a user turns "custom"
   * back off, and that is the part easiest to drop on a re-read.
   */
  SetTrackWidthIndex(aIndex: number): void {
    this.m_trackWidthIndex = Math.min(aIndex, this.m_TrackWidthList.length - 1);
    this.m_useCustomTrackVia = false;
  }

  /** `SetViaSizeIndex( aIndex )` (`board_design_settings.cpp:1489`). */
  SetViaSizeIndex(aIndex: number): void {
    this.m_viaSizeIndex = Math.min(aIndex, this.m_ViasDimensionsList.length - 1);
    this.m_useCustomTrackVia = false;
  }

  /**
   * `SetDiffPairIndex( aIndex )` (`board_design_settings.cpp:1537`).
   *
   *     if( !m_DiffPairDimensionsList.empty() )
   *         m_diffPairIndex = std::min( aIndex, (int) ...size() - 1 );
   *     m_useCustomDiffPair = false;
   *
   * The guard means an EMPTY list leaves the index alone — the two setters
   * above have no such guard and would clamp to -1 — while the flag is
   * cleared either way, outside the `if`.
   */
  SetDiffPairIndex(aIndex: number): void {
    if (this.m_DiffPairDimensionsList.length > 0)
      this.m_diffPairIndex = Math.min(aIndex, this.m_DiffPairDimensionsList.length - 1);

    this.m_useCustomDiffPair = false;
  }

  /** `UseNetClassTrack()` (`board_design_settings.h:304`). */
  UseNetClassTrack(): boolean {
    return this.m_trackWidthIndex <= 0 && !this.m_useCustomTrackVia;
  }

  /** `UseNetClassVia()` (`board_design_settings.h:309`). */
  UseNetClassVia(): boolean {
    return this.m_viaSizeIndex <= 0 && !this.m_useCustomTrackVia;
  }

  /** `UseNetClassDiffPair()` (`board_design_settings.h:314`) — `== 0`, not `<= 0`. */
  UseNetClassDiffPair(): boolean {
    return this.m_diffPairIndex === 0 && !this.m_useCustomDiffPair;
  }

  /** `GetCurrentTrackWidth()` (`board_design_settings.cpp:1477`). */
  GetCurrentTrackWidth(): number {
    if (this.m_useCustomTrackVia) return this.m_customTrackWidth;

    if (this.m_trackWidthIndex <= 0 || this.m_trackWidthIndex >= this.m_TrackWidthList.length)
      return this.m_NetSettings.GetDefaultNetclass().GetTrackWidth();

    return this.m_TrackWidthList[this.m_trackWidthIndex]!;
  }

  /** `GetCurrentViaSize()` (`board_design_settings.cpp:1496`). */
  GetCurrentViaSize(): number {
    if (this.m_useCustomTrackVia) return this.m_customViaSize.m_Diameter;

    if (this.m_viaSizeIndex <= 0 || this.m_viaSizeIndex >= this.m_ViasDimensionsList.length)
      return this.m_NetSettings.GetDefaultNetclass().GetViaDiameter();

    return this.m_ViasDimensionsList[this.m_viaSizeIndex]!.m_Diameter;
  }

  /**
   * `GetCurrentViaDrill()` (`board_design_settings.cpp:1507`).
   *
   * Returns -1, not 0, for "no drill": the callers test for a negative, and a
   * zero would read as a via with a zero-width hole.
   */
  GetCurrentViaDrill(): number {
    let drill: number;

    if (this.m_useCustomTrackVia) drill = this.m_customViaSize.m_Drill;
    else if (this.m_viaSizeIndex <= 0 || this.m_viaSizeIndex >= this.m_ViasDimensionsList.length)
      drill = this.m_NetSettings.GetDefaultNetclass().GetViaDrill();
    else drill = this.m_ViasDimensionsList[this.m_viaSizeIndex]!.m_Drill;

    return drill > 0 ? drill : -1;
  }

  /**
   * `GetCurrentDiffPairWidth()` (`board_design_settings.cpp:1546`).
   *
   * The netclass branch is not the obvious one: a class with no
   * differential-pair width falls back to its ORDINARY track width, not to
   * zero and not to the board minimum.
   */
  GetCurrentDiffPairWidth(): number {
    if (this.m_useCustomDiffPair) return this.m_customDiffPair.m_Width;

    if (this.m_diffPairIndex <= 0 || this.m_diffPairIndex >= this.m_DiffPairDimensionsList.length) {
      const nc = this.m_NetSettings.GetDefaultNetclass();

      return nc.HasDiffPairWidth() ? nc.GetDiffPairWidth() : nc.GetTrackWidth();
    }

    return this.m_DiffPairDimensionsList[this.m_diffPairIndex]!.m_Width;
  }

  /**
   * `GetCurrentDiffPairGap()` (`board_design_settings.cpp:1565`).
   *
   * A class with no differential-pair gap falls back to its CLEARANCE, the
   * same reasoning as the width falling back to the track width: the pair is
   * two ordinary tracks at the ordinary spacing until something says
   * otherwise.
   */
  GetCurrentDiffPairGap(): number {
    if (this.m_useCustomDiffPair) return this.m_customDiffPair.m_Gap;

    if (this.m_diffPairIndex <= 0 || this.m_diffPairIndex >= this.m_DiffPairDimensionsList.length) {
      const nc = this.m_NetSettings.GetDefaultNetclass();

      return nc.HasDiffPairGap() ? nc.GetDiffPairGap() : nc.GetClearance();
    }

    return this.m_DiffPairDimensionsList[this.m_diffPairIndex]!.m_Gap;
  }

  /**
   * `GetCurrentDiffPairViaGap()` (`board_design_settings.cpp:1584`).
   *
   * Its last fallback is `GetCurrentDiffPairGap()` — the RESOLVED gap, not the
   * netclass's raw one — so a board with a selected pre-defined row and a
   * netclass that names no via gap takes the via gap from that row's gap.
   */
  GetCurrentDiffPairViaGap(): number {
    if (this.m_useCustomDiffPair) return this.m_customDiffPair.m_ViaGap;

    if (this.m_diffPairIndex <= 0 || this.m_diffPairIndex >= this.m_DiffPairDimensionsList.length) {
      const nc = this.m_NetSettings.GetDefaultNetclass();

      return nc.HasDiffPairViaGap() ? nc.GetDiffPairViaGap() : this.GetCurrentDiffPairGap();
    }

    return this.m_DiffPairDimensionsList[this.m_diffPairIndex]!.m_ViaGap;
  }

  GetTrackWidthIndex(): number {
    return this.m_trackWidthIndex;
  }
  GetViaSizeIndex(): number {
    return this.m_viaSizeIndex;
  }
  GetDiffPairIndex(): number {
    return this.m_diffPairIndex;
  }

  GetCustomTrackWidth(): number {
    return this.m_customTrackWidth;
  }
  SetCustomTrackWidth(aWidth: number): void {
    this.m_customTrackWidth = aWidth;
  }

  GetCustomViaSize(): number {
    return this.m_customViaSize.m_Diameter;
  }
  SetCustomViaSize(aSize: number): void {
    this.m_customViaSize.m_Diameter = aSize;
  }
  GetCustomViaDrill(): number {
    return this.m_customViaSize.m_Drill;
  }
  SetCustomViaDrill(aDrill: number): void {
    this.m_customViaSize.m_Drill = aDrill;
  }

  GetCustomDiffPairWidth(): number {
    return this.m_customDiffPair.m_Width;
  }
  SetCustomDiffPairWidth(aWidth: number): void {
    this.m_customDiffPair.m_Width = aWidth;
  }
  GetCustomDiffPairGap(): number {
    return this.m_customDiffPair.m_Gap;
  }
  SetCustomDiffPairGap(aGap: number): void {
    this.m_customDiffPair.m_Gap = aGap;
  }
  GetCustomDiffPairViaGap(): number {
    return this.m_customDiffPair.m_ViaGap;
  }
  SetCustomDiffPairViaGap(aGap: number): void {
    this.m_customDiffPair.m_ViaGap = aGap;
  }
  /** The copy constructor: the same parent and path, then `initFromOther`. */
  static copyOf(aOther: BOARD_DESIGN_SETTINGS): BOARD_DESIGN_SETTINGS {
    const copy = new BOARD_DESIGN_SETTINGS(aOther.m_parent, aOther.GetFilename());
    copy.initFromOther(aOther);
    return copy;
  }

  /** `operator=`. */
  assign(aOther: BOARD_DESIGN_SETTINGS): this {
    this.initFromOther(aOther);
    return this;
  }

  /**
   * `initFromOther`: every value member copied, the `NET_SETTINGS` pointer
   * SHARED (`shared_ptr` assignment), the pad master, stackup and zone settings
   * deep-copied (`make_unique<PAD>( *aOther.m_Pad_Master )`, value members).
   */
  private initFromOther(aOther: BOARD_DESIGN_SETTINGS): void {
    // Copy of NESTED_SETTINGS around is not allowed, so let's just update the params.
    this.m_TrackWidthList = [...aOther.m_TrackWidthList];
    this.m_ViasDimensionsList = aOther.m_ViasDimensionsList.map(
      (v) => new VIA_DIMENSION(v.m_Diameter, v.m_Drill),
    );
    this.m_DiffPairDimensionsList = aOther.m_DiffPairDimensionsList.map(
      (d) => new DIFF_PAIR_DIMENSION(d.m_Width, d.m_Gap, d.m_ViaGap),
    );
    this.m_CurrentViaType = aOther.m_CurrentViaType;
    this.m_UseConnectedTrackWidth = aOther.m_UseConnectedTrackWidth;
    this.m_TempOverrideTrackWidth = aOther.m_TempOverrideTrackWidth;
    this.m_MinClearance = aOther.m_MinClearance;
    this.m_MinGrooveWidth = aOther.m_MinGrooveWidth;
    this.m_MinConn = aOther.m_MinConn;
    this.m_TrackMinWidth = aOther.m_TrackMinWidth;
    this.m_ViasMinAnnularWidth = aOther.m_ViasMinAnnularWidth;
    this.m_ViasMinSize = aOther.m_ViasMinSize;
    this.m_MinThroughDrill = aOther.m_MinThroughDrill;
    this.m_MicroViasMinSize = aOther.m_MicroViasMinSize;
    this.m_MicroViasMinDrill = aOther.m_MicroViasMinDrill;
    this.m_CopperEdgeClearance = aOther.m_CopperEdgeClearance;
    this.m_HoleClearance = aOther.m_HoleClearance;
    this.m_HoleToHoleMin = aOther.m_HoleToHoleMin;
    this.m_SilkClearance = aOther.m_SilkClearance;
    this.m_MinResolvedSpokes = aOther.m_MinResolvedSpokes;
    this.m_MinSilkTextHeight = aOther.m_MinSilkTextHeight;
    this.m_MinSilkTextThickness = aOther.m_MinSilkTextThickness;
    this.m_DRCSeverities = new Map(aOther.m_DRCSeverities);
    this.m_DrcExclusions = new Set(aOther.m_DrcExclusions);
    this.m_DrcExclusionComments = new Map(aOther.m_DrcExclusionComments);
    this.m_ZoneKeepExternalFillets = aOther.m_ZoneKeepExternalFillets;
    this.m_MaxError = aOther.m_MaxError;
    this.m_SolderMaskExpansion = aOther.m_SolderMaskExpansion;
    this.m_SolderMaskMinWidth = aOther.m_SolderMaskMinWidth;
    this.m_SolderMaskToCopperClearance = aOther.m_SolderMaskToCopperClearance;
    this.m_SolderPasteMargin = aOther.m_SolderPasteMargin;
    this.m_SolderPasteMarginRatio = aOther.m_SolderPasteMarginRatio;
    this.m_AllowSoldermaskBridgesInFPs = aOther.m_AllowSoldermaskBridgesInFPs;
    this.m_TentViasFront = aOther.m_TentViasFront;
    this.m_TentViasBack = aOther.m_TentViasBack;
    this.m_CoverViasFront = aOther.m_CoverViasFront;
    this.m_CoverViasBack = aOther.m_CoverViasBack;
    this.m_PlugViasFront = aOther.m_PlugViasFront;
    this.m_PlugViasBack = aOther.m_PlugViasBack;
    this.m_CapVias = aOther.m_CapVias;
    this.m_FillVias = aOther.m_FillVias;
    this.m_DefaultFPTextItems = aOther.m_DefaultFPTextItems.map(
      (t) => new TEXT_ITEM_INFO(t.m_Text, t.m_Visible, t.m_Layer),
    );
    this.m_UserLayerNames = new Map(aOther.m_UserLayerNames);

    this.m_LineThickness = [...aOther.m_LineThickness];
    this.m_TextSize = aOther.m_TextSize.map((v) => ({ x: v.x, y: v.y }));
    this.m_TextThickness = [...aOther.m_TextThickness];
    this.m_TextItalic = [...aOther.m_TextItalic];
    this.m_TextUpright = [...aOther.m_TextUpright];

    this.m_DimensionUnitsMode = aOther.m_DimensionUnitsMode;
    this.m_DimensionPrecision = aOther.m_DimensionPrecision;
    this.m_DimensionUnitsFormat = aOther.m_DimensionUnitsFormat;
    this.m_DimensionSuppressZeroes = aOther.m_DimensionSuppressZeroes;
    this.m_DimensionTextPosition = aOther.m_DimensionTextPosition;
    this.m_DimensionKeepTextAligned = aOther.m_DimensionKeepTextAligned;
    this.m_DimensionArrowLength = aOther.m_DimensionArrowLength;
    this.m_DimensionExtensionOffset = aOther.m_DimensionExtensionOffset;
    this.m_auxOrigin = { x: aOther.m_auxOrigin.x, y: aOther.m_auxOrigin.y };
    this.m_gridOrigin = { x: aOther.m_gridOrigin.x, y: aOther.m_gridOrigin.y };
    this.m_HasStackup = aOther.m_HasStackup;
    this.m_UseHeightForLengthCalcs = aOther.m_UseHeightForLengthCalcs;

    this.m_trackWidthIndex = aOther.m_trackWidthIndex;
    this.m_viaSizeIndex = aOther.m_viaSizeIndex;
    this.m_diffPairIndex = aOther.m_diffPairIndex;
    this.m_useCustomTrackVia = aOther.m_useCustomTrackVia;
    this.m_customTrackWidth = aOther.m_customTrackWidth;
    this.m_customViaSize = new VIA_DIMENSION(
      aOther.m_customViaSize.m_Diameter,
      aOther.m_customViaSize.m_Drill,
    );
    this.m_useCustomDiffPair = aOther.m_useCustomDiffPair;
    this.m_customDiffPair = new DIFF_PAIR_DIMENSION(
      aOther.m_customDiffPair.m_Width,
      aOther.m_customDiffPair.m_Gap,
      aOther.m_customDiffPair.m_ViaGap,
    );
    this.m_copperLayerCount = aOther.m_copperLayerCount;
    this.m_userDefinedLayerCount = aOther.m_userDefinedLayerCount;
    this.m_enabledLayers = new LSET(aOther.m_enabledLayers);
    this.m_boardThickness = aOther.m_boardThickness;
    this.m_currentNetClassName = aOther.m_currentNetClassName;
    this.m_stackup = BOARD_STACKUP.copyOf(aOther.m_stackup);
    this.m_NetSettings = aOther.m_NetSettings;
    this.m_Pad_Master = PAD.copyOfPad(aOther.m_Pad_Master);
    this.m_defaultZoneSettings = aOther.m_defaultZoneSettings.clone();

    this.m_StyleFPFields = aOther.m_StyleFPFields;
    this.m_StyleFPText = aOther.m_StyleFPText;
    this.m_StyleFPShapes = aOther.m_StyleFPShapes;
    this.m_StyleFPDimensions = aOther.m_StyleFPDimensions;
    this.m_StyleFPBarcodes = aOther.m_StyleFPBarcodes;
  }

  /**
   * `operator==`. Maps and sets compare as `std::map`/`std::set` do — same
   * size, every key present with an equal value — and the per-class arrays
   * element by element.
   */
  equals(aOther: BOARD_DESIGN_SETTINGS): boolean {
    const sameList = <T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean): boolean =>
      a.length === b.length && a.every((x, i) => eq(x, b[i]!));
    const sameMap = <K, V>(a: Map<K, V>, b: Map<K, V>, eq: (x: V, y: V) => boolean): boolean => {
      if (a.size !== b.size) return false;
      for (const [k, v] of a) {
        if (!b.has(k)) return false;
        if (!eq(v, b.get(k) as V)) return false;
      }
      return true;
    };
    const sameSet = (a: Set<string>, b: Set<string>): boolean =>
      a.size === b.size && [...a].every((v) => b.has(v));
    const same = <T>(x: T, y: T): boolean => x === y;
    const sameVec = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

    if (!sameList(this.m_TrackWidthList, aOther.m_TrackWidthList, same)) return false;
    if (!sameList(this.m_ViasDimensionsList, aOther.m_ViasDimensionsList, (a, b) => a.equals(b)))
      return false;
    if (
      !sameList(this.m_DiffPairDimensionsList, aOther.m_DiffPairDimensionsList, (a, b) =>
        a.equals(b),
      )
    )
      return false;
    if (this.m_CurrentViaType !== aOther.m_CurrentViaType) return false;
    if (this.m_UseConnectedTrackWidth !== aOther.m_UseConnectedTrackWidth) return false;
    if (this.m_TempOverrideTrackWidth !== aOther.m_TempOverrideTrackWidth) return false;
    if (this.m_MinClearance !== aOther.m_MinClearance) return false;
    if (this.m_MinGrooveWidth !== aOther.m_MinGrooveWidth) return false;
    if (this.m_MinConn !== aOther.m_MinConn) return false;
    if (this.m_TrackMinWidth !== aOther.m_TrackMinWidth) return false;
    if (this.m_ViasMinAnnularWidth !== aOther.m_ViasMinAnnularWidth) return false;
    if (this.m_ViasMinSize !== aOther.m_ViasMinSize) return false;
    if (this.m_MinThroughDrill !== aOther.m_MinThroughDrill) return false;
    if (this.m_MicroViasMinSize !== aOther.m_MicroViasMinSize) return false;
    if (this.m_MicroViasMinDrill !== aOther.m_MicroViasMinDrill) return false;
    if (this.m_CopperEdgeClearance !== aOther.m_CopperEdgeClearance) return false;
    if (this.m_HoleClearance !== aOther.m_HoleClearance) return false;
    if (this.m_HoleToHoleMin !== aOther.m_HoleToHoleMin) return false;
    if (this.m_SilkClearance !== aOther.m_SilkClearance) return false;
    if (this.m_MinResolvedSpokes !== aOther.m_MinResolvedSpokes) return false;
    if (this.m_MinSilkTextHeight !== aOther.m_MinSilkTextHeight) return false;
    if (this.m_MinSilkTextThickness !== aOther.m_MinSilkTextThickness) return false;
    if (!sameMap(this.m_DRCSeverities, aOther.m_DRCSeverities, same)) return false;
    if (!sameSet(this.m_DrcExclusions, aOther.m_DrcExclusions)) return false;
    if (!sameMap(this.m_DrcExclusionComments, aOther.m_DrcExclusionComments, same)) return false;
    if (this.m_ZoneKeepExternalFillets !== aOther.m_ZoneKeepExternalFillets) return false;
    if (this.m_MaxError !== aOther.m_MaxError) return false;
    if (this.m_SolderMaskExpansion !== aOther.m_SolderMaskExpansion) return false;
    if (this.m_SolderMaskMinWidth !== aOther.m_SolderMaskMinWidth) return false;
    if (this.m_SolderMaskToCopperClearance !== aOther.m_SolderMaskToCopperClearance) return false;
    if (this.m_SolderPasteMargin !== aOther.m_SolderPasteMargin) return false;
    if (this.m_SolderPasteMarginRatio !== aOther.m_SolderPasteMarginRatio) return false;
    if (this.m_AllowSoldermaskBridgesInFPs !== aOther.m_AllowSoldermaskBridgesInFPs) return false;
    if (this.m_TentViasFront !== aOther.m_TentViasFront) return false;
    if (this.m_TentViasBack !== aOther.m_TentViasBack) return false;
    if (this.m_CoverViasFront !== aOther.m_CoverViasFront) return false;
    if (this.m_CoverViasBack !== aOther.m_CoverViasBack) return false;
    if (this.m_PlugViasFront !== aOther.m_PlugViasFront) return false;
    if (this.m_PlugViasBack !== aOther.m_PlugViasBack) return false;
    if (this.m_CapVias !== aOther.m_CapVias) return false;
    if (this.m_FillVias !== aOther.m_FillVias) return false;
    if (!sameList(this.m_DefaultFPTextItems, aOther.m_DefaultFPTextItems, (a, b) => a.equals(b)))
      return false;
    if (!sameMap(this.m_UserLayerNames, aOther.m_UserLayerNames, same)) return false;

    if (!sameList(this.m_LineThickness, aOther.m_LineThickness, same)) return false;
    if (!sameList(this.m_TextSize, aOther.m_TextSize, sameVec)) return false;
    if (!sameList(this.m_TextThickness, aOther.m_TextThickness, same)) return false;
    if (!sameList(this.m_TextItalic, aOther.m_TextItalic, same)) return false;
    if (!sameList(this.m_TextUpright, aOther.m_TextUpright, same)) return false;

    if (this.m_DimensionUnitsMode !== aOther.m_DimensionUnitsMode) return false;
    if (this.m_DimensionPrecision !== aOther.m_DimensionPrecision) return false;
    if (this.m_DimensionUnitsFormat !== aOther.m_DimensionUnitsFormat) return false;
    if (this.m_DimensionSuppressZeroes !== aOther.m_DimensionSuppressZeroes) return false;
    if (this.m_DimensionTextPosition !== aOther.m_DimensionTextPosition) return false;
    if (this.m_DimensionKeepTextAligned !== aOther.m_DimensionKeepTextAligned) return false;
    if (this.m_DimensionArrowLength !== aOther.m_DimensionArrowLength) return false;
    if (this.m_DimensionExtensionOffset !== aOther.m_DimensionExtensionOffset) return false;
    if (!sameVec(this.m_auxOrigin, aOther.m_auxOrigin)) return false;
    if (!sameVec(this.m_gridOrigin, aOther.m_gridOrigin)) return false;
    if (this.m_HasStackup !== aOther.m_HasStackup) return false;
    if (this.m_UseHeightForLengthCalcs !== aOther.m_UseHeightForLengthCalcs) return false;
    if (this.m_trackWidthIndex !== aOther.m_trackWidthIndex) return false;
    if (this.m_viaSizeIndex !== aOther.m_viaSizeIndex) return false;
    if (this.m_diffPairIndex !== aOther.m_diffPairIndex) return false;
    if (this.m_useCustomTrackVia !== aOther.m_useCustomTrackVia) return false;
    if (this.m_customTrackWidth !== aOther.m_customTrackWidth) return false;
    if (!this.m_customViaSize.equals(aOther.m_customViaSize)) return false;
    if (this.m_useCustomDiffPair !== aOther.m_useCustomDiffPair) return false;
    if (!this.m_customDiffPair.equals(aOther.m_customDiffPair)) return false;
    if (this.m_copperLayerCount !== aOther.m_copperLayerCount) return false;
    if (this.m_userDefinedLayerCount !== aOther.m_userDefinedLayerCount) return false;
    if (!this.m_enabledLayers.equals(aOther.m_enabledLayers)) return false;
    if (this.m_boardThickness !== aOther.m_boardThickness) return false;
    if (this.m_currentNetClassName !== aOther.m_currentNetClassName) return false;
    if (!this.m_stackup.equals(aOther.m_stackup)) return false;
    if (!this.m_NetSettings.equals(aOther.m_NetSettings)) return false;
    if (!this.m_Pad_Master.equalsPad(aOther.m_Pad_Master)) return false;
    if (!this.m_defaultZoneSettings.equals(aOther.m_defaultZoneSettings)) return false;

    if (this.m_StyleFPFields !== aOther.m_StyleFPFields) return false;
    if (this.m_StyleFPText !== aOther.m_StyleFPText) return false;
    if (this.m_StyleFPShapes !== aOther.m_StyleFPShapes) return false;
    if (this.m_StyleFPDimensions !== aOther.m_StyleFPDimensions) return false;
    if (this.m_StyleFPBarcodes !== aOther.m_StyleFPBarcodes) return false;

    return true;
  }
}
