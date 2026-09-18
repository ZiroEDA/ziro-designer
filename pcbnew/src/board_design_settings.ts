// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/board_design_settings.h` / `pcbnew/board_design_settings.cpp`:
 * `BOARD_DESIGN_SETTINGS`, the settings a board carries with it.
 *
 * IN PROGRESS (#636 stage 1): every member whose type exists is here with
 * its constructor default — the layer counts and enabled set, the per-class
 * line/text defaults, the minimums, the mask and paste margins, the via
 * tenting/covering/plugging flags, the custom track/via/diff-pair values,
 * the origins, `m_NetSettings`, `m_TeardropParamsList`, `m_Pad_Master`,
 * `m_stackup` and `m_ZoneLayerProperties`. Still to land with their own
 * classes: the three `MEANDER_SETTINGS`; and the
 * `NESTED_SETTINGS` JSON registration is not ported (the file parser sets
 * the fields directly).
 */

import { ADVANCED_CFG } from '@ziroeda/common/src/advanced_config.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import {
  DIM_PRECISION,
  DIM_TEXT_POSITION,
  DIM_UNITS_FORMAT,
  DIM_UNITS_MODE,
} from './pcb_dimension_types.js';
import { IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_IGNORE,
  RPT_SEVERITY_WARNING,
  type Severity,
} from '@ziroeda/common/src/reporter.js';
import { PCB_DRC_CODE } from './drc/drc_item.js';
import { ARC_HIGH_DEF } from '@ziroeda/kimath/src/base_units.js';
import { NET_SETTINGS } from '@ziroeda/common/src/project/net_settings.js';
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
export class BOARD_DESIGN_SETTINGS {
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

  constructor() {
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
}
