// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `TransferDataToWindow` / `TransferDataFromWindow` of every Board Setup
 * panel, over the live objects — `BOARD`, its `BOARD_DESIGN_SETTINGS`, the
 * `PROJECT_FILE` — the way the panels in `pcbnew/dialogs/panel_setup_*.cpp`
 * and `board_stackup_manager/panel_board_*.cpp` read and write them.
 *
 * Upstream each panel holds wx controls and transfers into them; ours draw
 * from one `BoardSetupValues`, so the transfers are gathered here, one pair
 * per panel in the dialog's page order. Nothing in this file touches a file:
 * the `.kicad_pro` comes out of `SETTINGS_MANAGER::SaveProject()` afterwards
 * and the board out of the normal save.
 */
import { LINE_STYLES, type NetClass, type NetClassesData } from '@ziroeda/common';
import { COLOR4D_UNSPECIFIED, parseColor4d, toCssColor } from '@ziroeda/common/color4d.js';
import { pcbIUScale, schIUScale } from '@ziroeda/common/eda_units.js';
import { EMBEDDED_FILE, EMBEDDED_FILES, FILE_TYPE } from '@ziroeda/common/embedded_files.js';
import { IsCopperLayer, IsCopperLayerLowerThan, PCB_LAYER_ID } from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import { NETCLASS } from '@ziroeda/common/netclass.js';
import type { PROJECT } from '@ziroeda/common/project.js';
import {
  COMPONENT_CLASS_ASSIGNMENT_DATA,
  CONDITION_TYPE,
  CONDITIONS_OPERATOR,
} from '@ziroeda/common/project/component_class_settings.js';
import {
  DELAY_PROFILE_TRACK_PROPAGATION_ENTRY,
  DELAY_PROFILE_VIA_OVERRIDE_ENTRY,
  TUNING_PROFILE,
  TUNING_PROFILE_TYPE,
} from '@ziroeda/common/project/tuning_profiles.js';
import {
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_IGNORE,
  RPT_SEVERITY_WARNING,
  type Severity,
} from '@ziroeda/common/reporter.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  DIFF_PAIR_DIMENSION,
  LAYER_CLASS,
  VIA_DIMENSION,
} from '@ziroeda/pcbnew/board_design_settings.js';
import {
  BOARD_STACKUP,
  BOARD_STACKUP_ITEM,
  BOARD_STACKUP_ITEM_TYPE,
  type BS_EDGE_CONNECTOR_CONSTRAINTS,
  KEY_COPPER,
  KEY_CORE,
  KEY_PREPREG,
} from '@ziroeda/pcbnew/board_stackup_manager/board_stackup.js';
import { LAYER_T } from '@ziroeda/pcbnew/board_types.js';
import { DRC_ITEM } from '@ziroeda/pcbnew/drc/drc_item.js';
import {
  DIM_PRECISION,
  DIM_TEXT_POSITION,
  DIM_UNITS_FORMAT,
  DIM_UNITS_MODE,
} from '@ziroeda/pcbnew/pcb_dimension_types.js';
import { MeanderStyle, type MeanderSettings } from '@ziroeda/pcbnew/router/pns_meander.js';
import { TARGET_TD } from '@ziroeda/pcbnew/teardrop/teardrop_parameters.js';
import {
  ISLAND_REMOVAL_MODE,
  ZONE_BORDER_DISPLAY_STYLE,
  ZONE_LAYER_PROPERTIES,
} from '@ziroeda/pcbnew/zone_settings.js';
import { ZONE_CONNECTION } from '@ziroeda/pcbnew/zones.js';
import {
  type BoardLayer,
  type BoardSetupValues,
  clampMaxErrorMM,
  defaultBoardSetup,
  defaultLayers,
  type DielectricSublayer,
  MANDATORY_LAYERS,
  type StackupLayer,
  type TeardropShape,
  type TuningPattern,
  type ZoneLayerPropertiesMap,
} from '../board_settings.js';
import type { EmbeddedFile } from '../../schematic/schematic_settings.js';

const mmOf = (iu: number): number => pcbIUScale.iuToMM(iu);
const iuOf = (mm: number): number => pcbIUScale.mmToIU(mm);

// ---------------------------------------------------------------------------
// The choice lists, in the panels' selection order.

/** `m_dimensionUnits` (panel_setup_dimensions_base.cpp): DIM_UNITS_MODE order. */
const DIM_UNITS = ['Inches', 'Mils', 'Millimeters', 'Automatic'] as const;
const DIM_FORMATS = ['1234', '1234 mm', '1234 (mm)'] as const;
const DIM_PRECISIONS = ['0', '0.0', '0.00', '0.000', '0.0000', '0.00000'] as const;
const DIM_POSITIONS = ['Outside', 'Inline'] as const;
/** ZONE_CONNECTION: NONE=0, THERMAL=1, FULL=2, THT_THERMAL=3. */
const PAD_CONNECTIONS = ['None', 'Thermal reliefs', 'Solid', 'Reliefs for PTH'] as const;
/** ZONE_BORDER_DISPLAY_STYLE: NO_HATCH=0, DIAGONAL_FULL=1, DIAGONAL_EDGE=2. */
const BORDER_STYLES = ['Line', 'Fully hatched', 'Hatched'] as const;
const CORNER_SMOOTHINGS = ['None', 'Chamfer', 'Fillet'] as const;
const REMOVE_ISLANDS = ['Always', 'Never', 'Below area limit'] as const;
const COPPER_TYPES = ['signal', 'power', 'mixed', 'jumper'] as const;
/** `GetStandardCopperFinishes( false )`, the finish choice list. */
const EDGE_CONNECTORS = ['None', 'Yes', 'Yes, bevelled'] as const;

/** `COMPONENT_CLASS_ASSIGNMENT_DATA::GetConditionName` ↔ the panel's labels. */
const CONDITION_LABELS: readonly [CONDITION_TYPE, string][] = [
  [CONDITION_TYPE.REFERENCE, 'Reference'],
  [CONDITION_TYPE.SIDE, 'Side'],
  [CONDITION_TYPE.ROTATION, 'Rotation'],
  [CONDITION_TYPE.FOOTPRINT, 'Footprint'],
  [CONDITION_TYPE.FOOTPRINT_FIELD, 'Footprint Field'],
  [CONDITION_TYPE.CUSTOM, 'Custom'],
  [CONDITION_TYPE.SHEET_NAME, 'Sheet Name'],
];

/** The stackup rows' type strings: the file's keys for the three the file abbreviates. */
const STACKUP_TYPE_LABEL: Record<string, string> = {
  [KEY_COPPER]: 'Copper',
  [KEY_CORE]: 'Core',
  [KEY_PREPREG]: 'Prepreg',
};
const STACKUP_TYPE_KEY: Record<string, string> = {
  Copper: KEY_COPPER,
  Core: KEY_CORE,
  Prepreg: KEY_PREPREG,
};
/** `F.SilkS` shows as `F.Silkscreen` in the stackup rows (the layer's default name). */
const STACKUP_DISPLAY_NAME: Record<string, string> = {
  'F.SilkS': 'F.Silkscreen',
  'B.SilkS': 'B.Silkscreen',
};

const at = <T>(list: readonly T[], i: number, fallback: T): T => list[i] ?? fallback;
const indexOr = <T>(list: readonly T[], v: T, fallback: number): number => {
  const i = list.indexOf(v);
  return i < 0 ? fallback : i;
};

/** The CSS colour the panels edit; `COLOR4D::UNSPECIFIED` is the blank. */
function colorToCss(c: ReturnType<typeof parseColor4d>): string {
  return c.a === 0
    ? ''
    : toCssColor(c).replace(/^rgb\((\d+),(\d+),(\d+)\)$/, (_m, r, g, b) => {
        const hex = (x: string): string => Number(x).toString(16).padStart(2, '0');
        return `#${hex(r)}${hex(g)}${hex(b)}`;
      });
}

function cssToColor(css: string): ReturnType<typeof parseColor4d> {
  return css === '' ? COLOR4D_UNSPECIFIED : parseColor4d(css);
}

const numStr = (v: number | undefined): string => (v === undefined ? '' : String(v));

// ===========================================================================
// TransferDataToWindow

/** Every panel's `TransferDataToWindow`, over the board's live objects. */
export function BoardSetupToWindow(
  aBoard: BOARD,
  aProject: PROJECT,
  aRulesText: string,
): BoardSetupValues {
  const bds = aBoard.GetDesignSettings();
  const file = aProject.GetProjectFile();
  const v = defaultBoardSetup();

  // ----- PANEL_SETUP_LAYERS::TransferDataToWindow
  v.layers = layersToWindow(aBoard);

  // ----- PANEL_SETUP_BOARD_STACKUP: the descriptor, synchronised to the board
  const stackup = bds.GetStackupDescriptor();
  stackup.SynchronizeWithBoard(bds);
  v.physicalStackup = {
    copperCount: aBoard.GetCopperLayerCount(),
    impedanceControlled: stackup.m_HasDielectricConstrains,
    layers: stackup
      .GetList()
      .filter((i) => i.IsEnabled())
      .map(stackupItemToWindow),
  };

  // ----- PANEL_SETUP_BOARD_FINISH
  v.boardFinish = {
    copperFinish: stackup.m_FinishType,
    edgeCardConnectors: at(EDGE_CONNECTORS, stackup.m_EdgeConnectorConstraints, 'None'),
    platedBoardEdge: stackup.m_EdgePlating,
  };

  // ----- PANEL_SETUP_MASK_AND_PASTE
  v.maskPaste = {
    maskExpansionMM: mmOf(bds.m_SolderMaskExpansion),
    maskMinWebMM: mmOf(bds.m_SolderMaskMinWidth),
    maskToCopperMM: mmOf(bds.m_SolderMaskToCopperClearance),
    tentFront: bds.m_TentViasFront,
    tentBack: bds.m_TentViasBack,
    pasteClearanceMM: mmOf(bds.m_SolderPasteMargin),
    pasteRelativePct: bds.m_SolderPasteMarginRatio * 100,
    allowBridged: bds.m_AllowSoldermaskBridgesInFPs,
  };

  // ----- PANEL_SETUP_ZONE_HATCH_OFFSETS: a row per enabled copper layer
  const zlp: ZoneLayerPropertiesMap = {};
  for (const layer of LSET.AllCuMask().UIOrder()) {
    if (!bds.IsLayerEnabled(layer)) continue;
    const props = bds.m_ZoneLayerProperties.get(layer);
    zlp[LSET.Name(layer)] = props?.hatching_offset
      ? { hatchingOffset: { x: mmOf(props.hatching_offset.x), y: mmOf(props.hatching_offset.y) } }
      : {};
  }
  v.zoneLayerProperties = zlp;

  // ----- PANEL_SETUP_TEXT_AND_GRAPHICS + PANEL_SETUP_DIMENSIONS
  v.textGraphics = {
    rows: [
      LAYER_CLASS.LAYER_CLASS_SILK,
      LAYER_CLASS.LAYER_CLASS_COPPER,
      LAYER_CLASS.LAYER_CLASS_EDGES,
      LAYER_CLASS.LAYER_CLASS_COURTYARD,
      LAYER_CLASS.LAYER_CLASS_FAB,
      LAYER_CLASS.LAYER_CLASS_OTHERS,
    ].map((cls) => ({
      lineThickness: mmOf(bds.m_LineThickness[cls]!),
      textWidth: mmOf(bds.m_TextSize[cls]!.x),
      textHeight: mmOf(bds.m_TextSize[cls]!.y),
      textThickness: mmOf(bds.m_TextThickness[cls]!),
      italic: bds.m_TextItalic[cls]!,
      keepUpright: bds.m_TextUpright[cls]!,
    })),
    dimensions: {
      units: at(DIM_UNITS, bds.m_DimensionUnitsMode, 'Automatic'),
      format: at(DIM_FORMATS, bds.m_DimensionUnitsFormat, '1234'),
      precision: at(DIM_PRECISIONS, bds.m_DimensionPrecision, '0.0000'),
      suppressTrailingZeroes: bds.m_DimensionSuppressZeroes,
      textPosition: at(DIM_POSITIONS, bds.m_DimensionTextPosition, 'Outside'),
      keepTextAligned: bds.m_DimensionKeepTextAligned,
      arrowLengthMM: mmOf(bds.m_DimensionArrowLength),
      extLineOffsetMM: mmOf(bds.m_DimensionExtensionOffset),
    },
  };

  // ----- PANEL_SETUP_FORMATTING
  const plot = aBoard.GetPlotOptions();
  v.formatting = {
    dashLengthRatio: plot.GetDashedLineDashRatio(),
    gapLengthRatio: plot.GetDashedLineGapRatio(),
    applyFields: bds.m_StyleFPFields,
    applyText: bds.m_StyleFPText,
    applyShapes: bds.m_StyleFPShapes,
    applyDimensions: bds.m_StyleFPDimensions,
    applyBarcodes: bds.m_StyleFPBarcodes,
  };

  // ----- PANEL_TEXT_VARIABLES: the project's text_variables
  v.textVars = [...file.m_TextVars].map(([name, value]) => ({ name, value }));

  // ----- PANEL_SETUP_CONSTRAINTS
  v.constraints = {
    minClearanceMM: mmOf(bds.m_MinClearance),
    minTrackMM: mmOf(bds.m_TrackMinWidth),
    minConnectionMM: mmOf(bds.m_MinConn),
    minAnnularMM: mmOf(bds.m_ViasMinAnnularWidth),
    minViaMM: mmOf(bds.m_ViasMinSize),
    minUViaMM: mmOf(bds.m_MicroViasMinSize),
    minUViaHoleMM: mmOf(bds.m_MicroViasMinDrill),
    copperToHoleMM: mmOf(bds.m_HoleClearance),
    copperToEdgeMM: mmOf(bds.m_CopperEdgeClearance),
    minThroughHoleMM: mmOf(bds.m_MinThroughDrill),
    minHoleToHoleMM: mmOf(bds.m_HoleToHoleMin),
    silkClearanceMM: mmOf(bds.m_SilkClearance),
    minTextHeightMM: mmOf(bds.m_MinSilkTextHeight),
    minTextThicknessMM: mmOf(bds.m_MinSilkTextThickness),
    maxDeviationMM: mmOf(bds.m_MaxError),
    allowFilletsOutside: bds.m_ZoneKeepExternalFillets,
    minThermalSpokes: bds.m_MinResolvedSpokes,
    includeStackupHeight: bds.m_UseHeightForLengthCalcs,
  };

  // ----- PANEL_SETUP_TRACKS_AND_VIAS: skip the first item, the current netclass value
  v.trackWidthsMM = bds.m_TrackWidthList.slice(1).map(mmOf);
  v.viaSizesMM = bds.m_ViasDimensionsList
    .slice(1)
    .map((d) => ({ diameter: mmOf(d.m_Diameter), drill: mmOf(d.m_Drill) }));
  v.diffPairsMM = bds.m_DiffPairDimensionsList
    .slice(1)
    .map((d) => ({ width: mmOf(d.m_Width), gap: mmOf(d.m_Gap), viaGap: mmOf(d.m_ViaGap) }));

  // ----- PANEL_SETUP_TEARDROPS
  const tdl = bds.GetTeadropParamsList();
  const shape = (t: TARGET_TD): TeardropShape => {
    const p = tdl.GetParameters(t);
    return {
      maxLengthMM: mmOf(p.m_TdMaxLen),
      maxWidthMM: mmOf(p.m_TdMaxWidth),
      bestLengthPct: p.m_BestLengthRatio * 100.0,
      bestWidthPct: p.m_BestWidthRatio * 100.0,
      trackWidthLimitPct: p.m_WidthtoSizeFilterRatio * 100.0,
      preferZoneConnection: !p.m_TdOnPadsInZones,
      allowSpanTwoSegments: p.m_AllowUseTwoTracks,
      curvedEdges: p.m_CurvedEdges,
    };
  };
  v.teardrops = {
    round: shape(TARGET_TD.TARGET_ROUND),
    rect: shape(TARGET_TD.TARGET_RECT),
    trackToTrack: shape(TARGET_TD.TARGET_TRACK),
    targets: {
      vias: tdl.m_TargetVias,
      pthPads: tdl.m_TargetPTHPads,
      smdPads: tdl.m_TargetSMDPads,
      trackToTrack: tdl.m_TargetTrack2Track,
      roundShapesOnly: tdl.m_UseRoundShapesOnly,
    },
  };

  // ----- PANEL_SETUP_TUNING_PATTERNS
  const pattern = (s: MeanderSettings): TuningPattern => ({
    minAmplitudeMM: mmOf(s.minAmplitude),
    maxAmplitudeMM: mmOf(s.maxAmplitude),
    spacingMM: mmOf(s.spacing),
    cornerStyle: s.cornerStyle === MeanderStyle.MEANDER_STYLE_ROUND ? 'Fillet' : 'Chamfer',
    radiusPct: s.cornerRadiusPercentage,
    singleSided: s.singleSided,
  });
  v.tuning = {
    singleTrack: pattern(bds.m_SingleTrackMeanderSettings),
    diffPair: pattern(bds.m_DiffPairMeanderSettings),
    diffPairSkew: pattern(bds.m_SkewMeanderSettings),
  };

  // ----- PANEL_SETUP_TUNING_PROFILES: a page per profile, LoadProfile on each
  const layerNameOf = (l: PCB_LAYER_ID): string =>
    l === PCB_LAYER_ID.UNDEFINED_LAYER ? '' : LSET.Name(l);
  v.tuningProfiles = {
    profiles: file
      .TuningProfileParameters()
      .GetTuningProfiles()
      .map((p) => ({
        name: p.m_ProfileName,
        type: p.m_Type === TUNING_PROFILE_TYPE.DIFFERENTIAL ? 'Differential' : 'Single',
        targetImpedance: p.m_TargetImpedance,
        enableTimeDomain: p.m_EnableTimeDomainTuning,
        viaPropDelay: p.m_ViaPropagationDelay,
        trackEntries: p.m_TrackPropagationEntries.map((e) => ({
          signalLayer: layerNameOf(e.GetSignalLayer()),
          topReference: layerNameOf(e.GetTopReferenceLayer()),
          bottomReference: layerNameOf(e.GetBottomReferenceLayer()),
          widthMM: mmOf(e.GetWidth()),
          diffPairGapMM: mmOf(e.GetDiffPairGap()),
          delay: e.GetDelay(true),
        })),
        viaOverrides: p.m_ViaOverrides.map((o) => ({
          signalLayerFrom: layerNameOf(o.m_SignalLayerFrom),
          signalLayerTo: layerNameOf(o.m_SignalLayerTo),
          viaLayerFrom: layerNameOf(o.m_ViaLayerFrom),
          viaLayerTo: layerNameOf(o.m_ViaLayerTo),
          delay: o.m_Delay,
        })),
      })),
  };

  // ----- PANEL_SETUP_NETCLASSES: the project file's NET_SETTINGS
  v.netClasses = netClassesToWindow(file.NetSettings().GetDefaultNetclass(), file.NetSettings());

  // ----- PANEL_ASSIGN_COMPONENT_CLASSES
  const ccs = file.ComponentClassSettings();
  v.componentClasses = {
    assignPerSheet: ccs.GetEnableSheetComponentClasses(),
    assignments: ccs.GetComponentClassAssignments().map((a) => ({
      componentClass: a.GetComponentClass(),
      matchMode: a.GetConditionsOperator() === CONDITIONS_OPERATOR.ANY ? 'any' : 'all',
      conditions: a.GetConditions().map(([type, primary]) => ({
        type: (CONDITION_LABELS.find(([t]) => t === type)?.[1] ??
          'Reference') as BoardSetupValues['componentClasses']['assignments'][number]['conditions'][number]['type'],
        value: primary,
      })),
    })),
  };

  // ----- PANEL_SETUP_RULES: the .kicad_dru text is the frame's, handed in
  v.customRules = { text: aRulesText };

  // ----- PANEL_SETUP_SEVERITIES
  const severities: Record<string, 'error' | 'warning' | 'ignore'> = {};
  for (const item of DRC_ITEM.GetItemsWithSeverities()) {
    const key = item.GetSettingsKey();
    if (key === '') continue;
    const s = bds.GetSeverity(item.GetErrorCode());
    severities[key] =
      s === RPT_SEVERITY_WARNING ? 'warning' : s === RPT_SEVERITY_IGNORE ? 'ignore' : 'error';
  }
  v.drcSeverities = severities;

  // ----- PANEL_EMBEDDED_FILES
  const ef = aBoard.GetEmbeddedFiles();
  v.embeddedFiles = {
    embedFonts: ef.GetAreFontsEmbedded(),
    files: [...ef.EmbeddedFileMap().values()].map((f) => ({
      name: f.name,
      reference: ef.GetEmbeddedFileLink(f),
    })),
  };

  // ----- PANEL_SETUP_ZONES: the default zone settings
  const zs = bds.GetDefaultZoneSettings();
  v.zones = {
    name: zs.m_Name,
    clearanceMM: mmOf(zs.m_ZoneClearance),
    minWidthMM: mmOf(zs.m_ZoneMinThickness),
    padConnection: at(PAD_CONNECTIONS, zs.GetPadConnection(), 'Thermal reliefs'),
    thermalGapMM: mmOf(zs.m_ThermalReliefGap),
    thermalSpokeMM: mmOf(zs.m_ThermalReliefSpokeWidth),
    outlineDisplay: at(BORDER_STYLES, zs.m_ZoneBorderDisplayStyle, 'Hatched'),
    outlineHatchPitchMM: mmOf(zs.m_BorderHatchPitch),
    cornerSmoothing: at(CORNER_SMOOTHINGS, zs.GetCornerSmoothingType(), 'None'),
    smoothingRadiusMM: mmOf(zs.GetCornerRadius()),
    removeIslands: at(REMOVE_ISLANDS, zs.GetIslandRemovalMode(), 'Always'),
    areaLimitMM2: zs.GetMinIslandArea() / (pcbIUScale.IU_PER_MM * pcbIUScale.IU_PER_MM),
    locked: zs.m_Locked,
  };

  return v;
}

/**
 * `initialize_layers_controls` + `showBoardLayerNames` + `showLayerTypes`
 * + `showSelectedLayerCheckBoxes`: the rows in the panel's physical order —
 * front technical, the copper stack, back technical, the auxiliaries, and a
 * row for each *enabled* user-defined layer (the only ones the panel makes).
 */
function layersToWindow(aBoard: BOARD): BoardSetupValues['layers'] {
  const enabled = aBoard.GetEnabledLayers();
  const template = defaultLayers().layers;
  const rows: BoardLayer[] = [];

  const typeOf = (layer: PCB_LAYER_ID): LAYER_T => aBoard.GetLayerType(layer);

  for (const t of template) {
    if (t.kind === 'copper' || t.kind === 'user') continue;
    const layer = LSET.NameToLayer(t.id) as PCB_LAYER_ID;
    if (t.id === 'B.Mask') {
      for (const cu of LSET.AllCuMask(aBoard.GetCopperLayerCount()).UIOrder()) {
        const type = typeOf(cu);
        rows.push({
          id: LSET.Name(cu),
          name: aBoard.GetLayerName(cu),
          enabled: true,
          kind: 'copper',
          copperType: at(COPPER_TYPES, type, 'signal'),
        });
      }
    }
    rows.push({
      ...t,
      name: aBoard.GetLayerName(layer),
      enabled: enabled.test(layer) || MANDATORY_LAYERS.has(t.id),
    });
  }

  for (const layer of enabled.and(LSET.UserDefinedLayersMask()).UIOrder()) {
    const type = typeOf(layer);
    rows.push({
      id: LSET.Name(layer),
      name: aBoard.GetLayerName(layer),
      enabled: true,
      kind: 'user',
      userType: type === LAYER_T.LT_FRONT ? 'front' : type === LAYER_T.LT_BACK ? 'back' : 'aux',
    });
  }

  return { layers: rows };
}

function stackupItemToWindow(item: BOARD_STACKUP_ITEM): StackupLayer {
  const isDielectric = item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC;
  const layerName = isDielectric
    ? `Dielectric ${item.GetDielectricLayerId()}`
    : (STACKUP_DISPLAY_NAME[LSET.Name(item.GetBrdLayerId())] ?? LSET.Name(item.GetBrdLayerId()));
  const row: StackupLayer = {
    name: layerName,
    type: STACKUP_TYPE_LABEL[item.GetTypeName()] ?? item.GetTypeName(),
    material: item.GetMaterial(0),
    thicknessMM: mmOf(item.GetThickness(0)),
    color: item.GetColor(0),
  };
  if (item.IsThicknessLocked(0)) row.locked = true;
  if (item.HasEpsilonRValue()) row.epsilonR = item.GetEpsilonR(0);
  if (item.HasLossTangentValue()) row.lossTan = item.GetLossTangent(0);

  if (item.GetSublayersCount() > 1) {
    const subs: DielectricSublayer[] = [];
    for (let i = 1; i < item.GetSublayersCount(); ++i) {
      const sub: DielectricSublayer = {
        material: item.GetMaterial(i),
        thicknessMM: mmOf(item.GetThickness(i)),
      };
      if (item.IsThicknessLocked(i)) sub.locked = true;
      if (item.HasEpsilonRValue()) sub.epsilonR = item.GetEpsilonR(i);
      if (item.HasLossTangentValue()) sub.lossTan = item.GetLossTangent(i);
      subs.push(sub);
    }
    row.sublayers = subs;
  }
  return row;
}

/** `PANEL_SETUP_NETCLASSES::TransferDataToWindow`: Default first, then by priority. */
function netClassesToWindow(
  aDefault: NETCLASS,
  aSettings: ReturnType<PROJECT['GetProjectFile']>['m_NetSettings'],
): NetClassesData {
  const toRow = (nc: NETCLASS): NetClass => ({
    name: nc.GetName(),
    clearance: nc.HasClearance() ? numStr(mmOf(nc.GetClearance())) : '',
    trackWidth: nc.HasTrackWidth() ? numStr(mmOf(nc.GetTrackWidth())) : '',
    viaSize: nc.HasViaDiameter() ? numStr(mmOf(nc.GetViaDiameter())) : '',
    viaHole: nc.HasViaDrill() ? numStr(mmOf(nc.GetViaDrill())) : '',
    uviaSize: nc.HasuViaDiameter() ? numStr(mmOf(nc.GetuViaDiameter())) : '',
    uviaHole: nc.HasuViaDrill() ? numStr(mmOf(nc.GetuViaDrill())) : '',
    dpWidth: nc.HasDiffPairWidth() ? numStr(mmOf(nc.GetDiffPairWidth())) : '',
    dpGap: nc.HasDiffPairGap() ? numStr(mmOf(nc.GetDiffPairGap())) : '',
    dpViaGap: nc.HasDiffPairViaGap() ? numStr(mmOf(nc.GetDiffPairViaGap())) : '',
    tuningProfile: nc.GetTuningProfile(),
    pcbColor: colorToCss(nc.GetPcbColor(true)),
    wireThickness: nc.HasWireWidth() ? numStr(schIUScale.iuToMils(nc.GetWireWidth())) : '',
    busThickness: nc.HasBusWidth() ? numStr(schIUScale.iuToMils(nc.GetBusWidth())) : '',
    color: colorToCss(nc.GetSchematicColor(true)),
    lineStyle: nc.HasLineStyle() ? (LINE_STYLES[nc.GetLineStyle()] ?? 'Solid') : 'Solid',
  });

  const rest = [...aSettings.GetNetclasses().values()].sort(
    (a, b) => a.GetPriority() - b.GetPriority(),
  );
  const netColors: Record<string, string> = {};
  for (const [net, color] of aSettings.GetNetColorAssignments()) netColors[net] = colorToCss(color);

  return {
    classes: [toRow(aDefault), ...rest.map(toRow)],
    assignments: aSettings
      .GetNetclassPatternAssignments()
      .map(([matcher, netClass]) => ({ pattern: matcher.GetPattern(), netClass })),
    netColors,
  };
}

// ===========================================================================
// TransferDataFromWindow

/**
 * Every panel's `TransferDataFromWindow`, into the board's live objects.
 * Returns true when something on the *board* side changed (the panels'
 * `m_frame->OnModify()`); project-side values never dirty the board.
 */
export function BoardSetupFromWindow(
  v: BoardSetupValues,
  aBoard: BOARD,
  aProject: PROJECT,
): boolean {
  const bds = aBoard.GetDesignSettings();
  const file = aProject.GetProjectFile();
  let modified = false;

  // ----- PANEL_SETUP_LAYERS::transferDataFromWindow
  modified = layersFromWindow(v, aBoard) || modified;

  // ----- PANEL_SETUP_BOARD_STACKUP::TransferDataFromWindow
  modified = stackupFromWindow(v, aBoard) || modified;

  // ----- PANEL_SETUP_BOARD_FINISH::TransferDataFromWindow( aStackup )
  {
    const st = bds.GetStackupDescriptor();
    const edge = indexOr(
      EDGE_CONNECTORS,
      v.boardFinish.edgeCardConnectors as (typeof EDGE_CONNECTORS)[number],
      0,
    );
    modified = st.m_FinishType !== v.boardFinish.copperFinish || modified;
    st.m_FinishType = v.boardFinish.copperFinish;
    modified =
      st.m_EdgeConnectorConstraints !== (edge as BS_EDGE_CONNECTOR_CONSTRAINTS) || modified;
    st.m_EdgeConnectorConstraints = edge as BS_EDGE_CONNECTOR_CONSTRAINTS;
    modified = st.m_EdgePlating !== v.boardFinish.platedBoardEdge || modified;
    st.m_EdgePlating = v.boardFinish.platedBoardEdge;
  }

  // ----- PANEL_SETUP_MASK_AND_PASTE (board-side values)
  {
    const mp = v.maskPaste;
    const next = {
      m_SolderMaskExpansion: iuOf(mp.maskExpansionMM),
      m_SolderMaskMinWidth: iuOf(mp.maskMinWebMM),
      m_SolderMaskToCopperClearance: iuOf(mp.maskToCopperMM),
      m_TentViasFront: mp.tentFront,
      m_TentViasBack: mp.tentBack,
      m_SolderPasteMargin: iuOf(mp.pasteClearanceMM),
      m_SolderPasteMarginRatio: mp.pasteRelativePct / 100,
      m_AllowSoldermaskBridgesInFPs: mp.allowBridged,
    };
    for (const [k, val] of Object.entries(next) as [keyof typeof next, number | boolean][]) {
      if ((bds as unknown as Record<string, unknown>)[k] !== val) modified = true;
      (bds as unknown as Record<string, unknown>)[k] = val;
    }
  }

  // ----- PANEL_SETUP_ZONE_HATCH_OFFSETS
  for (const [name, props] of Object.entries(v.zoneLayerProperties)) {
    const layer = LSET.NameToLayer(name) as PCB_LAYER_ID;
    if (layer < 0) continue;
    bds.m_ZoneLayerProperties.set(
      layer,
      new ZONE_LAYER_PROPERTIES(
        props.hatchingOffset
          ? { x: iuOf(props.hatchingOffset.x), y: iuOf(props.hatchingOffset.y) }
          : undefined,
      ),
    );
  }

  // ----- PANEL_SETUP_TEXT_AND_GRAPHICS
  v.textGraphics.rows.forEach((row, cls) => {
    bds.m_LineThickness[cls] = iuOf(row.lineThickness);
    if (cls === LAYER_CLASS.LAYER_CLASS_EDGES || cls === LAYER_CLASS.LAYER_CLASS_COURTYARD) return;
    bds.m_TextSize[cls] = { x: iuOf(row.textWidth), y: iuOf(row.textHeight) };
    bds.m_TextThickness[cls] = iuOf(row.textThickness);
    bds.m_TextItalic[cls] = row.italic;
    bds.m_TextUpright[cls] = row.keepUpright;
  });

  // ----- PANEL_SETUP_DIMENSIONS
  {
    const d = v.textGraphics.dimensions;
    bds.m_DimensionUnitsMode = indexOr(
      DIM_UNITS,
      d.units as (typeof DIM_UNITS)[number],
      DIM_UNITS_MODE.AUTOMATIC,
    ) as DIM_UNITS_MODE;
    bds.m_DimensionUnitsFormat = indexOr(
      DIM_FORMATS,
      d.format as (typeof DIM_FORMATS)[number],
      DIM_UNITS_FORMAT.NO_SUFFIX,
    ) as DIM_UNITS_FORMAT;
    bds.m_DimensionPrecision = indexOr(
      DIM_PRECISIONS,
      d.precision as (typeof DIM_PRECISIONS)[number],
      DIM_PRECISION.X_XXXX,
    ) as DIM_PRECISION;
    bds.m_DimensionSuppressZeroes = d.suppressTrailingZeroes;
    bds.m_DimensionTextPosition = indexOr(
      DIM_POSITIONS,
      d.textPosition as (typeof DIM_POSITIONS)[number],
      DIM_TEXT_POSITION.OUTSIDE,
    ) as DIM_TEXT_POSITION;
    bds.m_DimensionKeepTextAligned = d.keepTextAligned;
    bds.m_DimensionArrowLength = iuOf(d.arrowLengthMM);
    bds.m_DimensionExtensionOffset = iuOf(d.extLineOffsetMM);
  }

  // ----- PANEL_SETUP_FORMATTING
  {
    const plot = aBoard.GetPlotOptions();
    if (
      plot.GetDashedLineDashRatio() !== v.formatting.dashLengthRatio ||
      plot.GetDashedLineGapRatio() !== v.formatting.gapLengthRatio
    )
      modified = true;
    plot.SetDashedLineDashRatio(v.formatting.dashLengthRatio);
    plot.SetDashedLineGapRatio(v.formatting.gapLengthRatio);
    aBoard.SetPlotOptions(plot);
    bds.m_StyleFPFields = v.formatting.applyFields;
    bds.m_StyleFPText = v.formatting.applyText;
    bds.m_StyleFPShapes = v.formatting.applyShapes;
    bds.m_StyleFPDimensions = v.formatting.applyDimensions;
    bds.m_StyleFPBarcodes = v.formatting.applyBarcodes;
  }

  // ----- PANEL_TEXT_VARIABLES
  file.m_TextVars.clear();
  for (const t of v.textVars) if (t.name !== '') file.m_TextVars.set(t.name, t.value);

  // ----- PANEL_SETUP_CONSTRAINTS ("all stored in project file, not board")
  {
    const c = v.constraints;
    bds.m_UseHeightForLengthCalcs = c.includeStackupHeight;
    bds.m_MaxError = KiROUND(iuOf(clampMaxErrorMM(c.maxDeviationMM)));
    bds.m_ZoneKeepExternalFillets = c.allowFilletsOutside;
    bds.m_MinResolvedSpokes = c.minThermalSpokes;
    bds.m_MinClearance = iuOf(c.minClearanceMM);
    bds.m_MinConn = iuOf(c.minConnectionMM);
    bds.m_TrackMinWidth = iuOf(c.minTrackMM);
    bds.m_ViasMinAnnularWidth = iuOf(c.minAnnularMM);
    bds.m_ViasMinSize = iuOf(c.minViaMM);
    bds.m_HoleClearance = iuOf(c.copperToHoleMM);
    bds.m_CopperEdgeClearance = iuOf(c.copperToEdgeMM);
    bds.m_MinThroughDrill = iuOf(c.minThroughHoleMM);
    bds.m_HoleToHoleMin = iuOf(c.minHoleToHoleMM);
    bds.m_MicroViasMinSize = iuOf(c.minUViaMM);
    bds.m_MicroViasMinDrill = iuOf(c.minUViaHoleMM);
    bds.m_SilkClearance = iuOf(c.silkClearanceMM);
    bds.m_MinSilkTextHeight = iuOf(c.minTextHeightMM);
    bds.m_MinSilkTextThickness = iuOf(c.minTextThicknessMM);
  }

  // ----- PANEL_SETUP_TRACKS_AND_VIAS: sorted, a dummy "use netclass" first
  {
    const widths = v.trackWidthsMM.map(iuOf).sort((a, b) => a - b);
    const vias = v.viaSizesMM
      .map((d) => new VIA_DIMENSION(iuOf(d.diameter), iuOf(d.drill)))
      .sort((a, b) => a.m_Diameter - b.m_Diameter || a.m_Drill - b.m_Drill);
    const pairs = v.diffPairsMM
      .map((d) => new DIFF_PAIR_DIMENSION(iuOf(d.width), iuOf(d.gap), iuOf(d.viaGap)))
      .sort((a, b) => a.m_Width - b.m_Width || a.m_Gap - b.m_Gap || a.m_ViaGap - b.m_ViaGap);
    bds.m_TrackWidthList = [0, ...widths];
    bds.m_ViasDimensionsList = [new VIA_DIMENSION(0, 0), ...vias];
    bds.m_DiffPairDimensionsList = [new DIFF_PAIR_DIMENSION(0, 0, 0), ...pairs];
  }

  // ----- PANEL_SETUP_TEARDROPS
  {
    const tdl = bds.GetTeadropParamsList();
    const apply = (t: TARGET_TD, s: TeardropShape, withZone: boolean): void => {
      const p = tdl.GetParameters(t);
      p.m_BestLengthRatio = s.bestLengthPct / 100.0;
      p.m_BestWidthRatio = s.bestWidthPct / 100.0;
      p.m_TdMaxLen = iuOf(s.maxLengthMM);
      p.m_TdMaxWidth = iuOf(s.maxWidthMM);
      p.m_CurvedEdges = s.curvedEdges;
      p.m_WidthtoSizeFilterRatio = s.trackWidthLimitPct / 100.0;
      if (withZone) p.m_TdOnPadsInZones = !s.preferZoneConnection;
      p.m_AllowUseTwoTracks = s.allowSpanTwoSegments;
    };
    apply(TARGET_TD.TARGET_ROUND, v.teardrops.round, true);
    apply(TARGET_TD.TARGET_RECT, v.teardrops.rect, true);
    apply(TARGET_TD.TARGET_TRACK, v.teardrops.trackToTrack, false);
    tdl.m_TargetVias = v.teardrops.targets.vias;
    tdl.m_TargetPTHPads = v.teardrops.targets.pthPads;
    tdl.m_TargetSMDPads = v.teardrops.targets.smdPads;
    tdl.m_TargetTrack2Track = v.teardrops.targets.trackToTrack;
    tdl.m_UseRoundShapesOnly = v.teardrops.targets.roundShapesOnly;
  }

  // ----- PANEL_SETUP_TUNING_PATTERNS
  {
    const apply = (s: MeanderSettings, p: TuningPattern): void => {
      s.minAmplitude = iuOf(p.minAmplitudeMM);
      s.maxAmplitude = iuOf(p.maxAmplitudeMM);
      s.spacing = iuOf(p.spacingMM);
      s.cornerStyle =
        p.cornerStyle === 'Fillet'
          ? MeanderStyle.MEANDER_STYLE_ROUND
          : MeanderStyle.MEANDER_STYLE_CHAMFER;
      s.cornerRadiusPercentage = Math.trunc(p.radiusPct);
      s.singleSided = p.singleSided;
    };
    apply(bds.m_SingleTrackMeanderSettings, v.tuning.singleTrack);
    apply(bds.m_DiffPairMeanderSettings, v.tuning.diffPair);
    apply(bds.m_SkewMeanderSettings, v.tuning.diffPairSkew);
  }

  // ----- PANEL_SETUP_TUNING_PROFILES: ClearTuningProfiles, then each page's GetProfile
  {
    const tp = file.TuningProfileParameters();
    const layerOf = (name: string): PCB_LAYER_ID =>
      name === '' ? PCB_LAYER_ID.UNDEFINED_LAYER : (LSET.NameToLayer(name) as PCB_LAYER_ID);
    tp.ClearTuningProfiles();
    for (const row of v.tuningProfiles.profiles) {
      const p = new TUNING_PROFILE();
      p.m_ProfileName = row.name;
      p.m_Type =
        row.type === 'Differential' ? TUNING_PROFILE_TYPE.DIFFERENTIAL : TUNING_PROFILE_TYPE.SINGLE;
      p.m_EnableTimeDomainTuning = row.enableTimeDomain;
      p.m_ViaPropagationDelay = row.viaPropDelay;
      p.m_TargetImpedance = Number.isFinite(row.targetImpedance) ? row.targetImpedance : 0.0;

      for (const t of row.trackEntries) {
        const entry = new DELAY_PROFILE_TRACK_PROPAGATION_ENTRY();
        entry.SetSignalLayer(layerOf(t.signalLayer));
        entry.SetTopReferenceLayer(layerOf(t.topReference));
        entry.SetBottomReferenceLayer(layerOf(t.bottomReference));
        entry.SetWidth(iuOf(t.widthMM));
        entry.SetDiffPairGap(iuOf(t.diffPairGapMM));
        entry.SetDelay(t.delay);
        entry.SetEnableTimeDomainTuning(p.m_EnableTimeDomainTuning);
        p.m_TrackPropagationEntries.push(entry);
        p.m_TrackPropagationEntriesMap.set(entry.GetSignalLayer(), entry);
      }

      for (const o of row.viaOverrides) {
        let signalFrom = layerOf(o.signalLayerFrom);
        let signalTo = layerOf(o.signalLayerTo);
        let viaFrom = layerOf(o.viaLayerFrom);
        let viaTo = layerOf(o.viaLayerTo);

        // Order layers in stackup order (from F_Cu first)
        if (IsCopperLayerLowerThan(signalFrom, signalTo))
          [signalFrom, signalTo] = [signalTo, signalFrom];
        if (IsCopperLayerLowerThan(viaFrom, viaTo)) [viaFrom, viaTo] = [viaTo, viaFrom];

        p.m_ViaOverrides.push(
          new DELAY_PROFILE_VIA_OVERRIDE_ENTRY(signalFrom, signalTo, viaFrom, viaTo, o.delay),
        );
      }

      tp.AddTuningProfile(p);
    }
  }

  // ----- PANEL_SETUP_NETCLASSES
  netClassesFromWindow(v.netClasses, aProject);

  // ----- PANEL_ASSIGN_COMPONENT_CLASSES
  {
    const ccs = file.ComponentClassSettings();
    ccs.SetEnableSheetComponentClasses(v.componentClasses.assignPerSheet);
    ccs.ClearComponentClassAssignments();
    for (const a of v.componentClasses.assignments) {
      const data = new COMPONENT_CLASS_ASSIGNMENT_DATA();
      data.SetComponentClass(a.componentClass);
      data.SetConditionsOperation(
        a.matchMode === 'any' ? CONDITIONS_OPERATOR.ANY : CONDITIONS_OPERATOR.ALL,
      );
      for (const c of a.conditions) {
        const type =
          CONDITION_LABELS.find(([, label]) => label === c.type)?.[0] ?? CONDITION_TYPE.REFERENCE;
        data.AddCondition(type, c.value, '');
      }
      ccs.AddComponentClassAssignment(data);
    }
  }

  // ----- PANEL_SETUP_SEVERITIES
  for (const item of DRC_ITEM.GetItemsWithSeverities()) {
    const key = item.GetSettingsKey();
    const s = v.drcSeverities[key];
    if (key === '' || s === undefined) continue;
    const sev: Severity =
      s === 'warning'
        ? RPT_SEVERITY_WARNING
        : s === 'ignore'
          ? RPT_SEVERITY_IGNORE
          : RPT_SEVERITY_ERROR;
    bds.m_DRCSeverities.set(item.GetErrorCode(), sev);
  }

  // ----- PANEL_EMBEDDED_FILES::TransferDataFromWindow
  modified = embeddedFilesFromWindow(v.embeddedFiles, aBoard.GetEmbeddedFiles()) || modified;

  // ----- PANEL_SETUP_ZONES: PANEL_ZONE_PROPERTIES::TransferZoneSettingsFromWindow
  {
    const z = v.zones;
    const zs = bds.GetDefaultZoneSettings().clone();
    zs.m_Name = z.name;
    zs.m_ZoneClearance = iuOf(z.clearanceMM);
    zs.m_ZoneMinThickness = iuOf(z.minWidthMM);
    zs.SetPadConnection(
      indexOr(
        PAD_CONNECTIONS,
        z.padConnection as (typeof PAD_CONNECTIONS)[number],
        ZONE_CONNECTION.THERMAL,
      ) as ZONE_CONNECTION,
    );
    zs.m_ThermalReliefGap = iuOf(z.thermalGapMM);
    zs.m_ThermalReliefSpokeWidth = iuOf(z.thermalSpokeMM);
    zs.m_ZoneBorderDisplayStyle = indexOr(
      BORDER_STYLES,
      z.outlineDisplay as (typeof BORDER_STYLES)[number],
      ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
    ) as ZONE_BORDER_DISPLAY_STYLE;
    zs.m_BorderHatchPitch = iuOf(z.outlineHatchPitchMM);
    zs.SetCornerSmoothingType(
      indexOr(CORNER_SMOOTHINGS, z.cornerSmoothing as (typeof CORNER_SMOOTHINGS)[number], 0),
    );
    zs.SetCornerRadius(iuOf(z.smoothingRadiusMM));
    zs.SetIslandRemovalMode(
      indexOr(
        REMOVE_ISLANDS,
        z.removeIslands as (typeof REMOVE_ISLANDS)[number],
        ISLAND_REMOVAL_MODE.ALWAYS,
      ) as ISLAND_REMOVAL_MODE,
    );
    zs.SetMinIslandArea(Math.trunc(z.areaLimitMM2 * pcbIUScale.IU_PER_MM * pcbIUScale.IU_PER_MM));
    zs.m_Locked = z.locked;
    bds.SetDefaultZoneSettings(zs);
  }

  return modified;
}

/** `PANEL_SETUP_LAYERS::transferDataFromWindow`, the enabled set, names and types. */
function layersFromWindow(v: BoardSetupValues, aBoard: BOARD): boolean {
  let modified = false;
  const enabledLayers = new LSET();
  for (const row of v.layers.layers) {
    if (!row.enabled) continue;
    const layer = LSET.NameToLayer(row.id);
    if (layer >= 0) enabledLayers.set(layer);
  }
  const previousEnabled = aBoard.GetEnabledLayers();

  if (!enabledLayers.equals(previousEnabled)) {
    aBoard.SetEnabledLayers(enabledLayers);
    const changedLayers = enabledLayers.xor(previousEnabled);

    // Ensure enabled layers are also visible.  This is mainly to avoid mistakes if some
    // enabled layers are not visible when exiting this dialog.
    aBoard.SetVisibleLayers(aBoard.GetVisibleLayers().or(changedLayers));

    // Ensure items with through holes have all inner copper layers.  (For historical reasons
    // this is NOT trimmed to the currently-enabled inner layers.)
    for (const fp of aBoard.Footprints()) {
      for (const pad of fp.Pads()) {
        if (pad.HasHole() && pad.IsOnCopperLayer())
          pad.SetLayerSet(pad.GetLayerSet().or(LSET.InternalCuMask()));
      }
    }

    // Tracks do not change their layer; via layers are their start and end layer.
    modified = true;
  }

  for (const row of v.layers.layers) {
    if (!row.enabled) continue;
    const layer = LSET.NameToLayer(row.id) as PCB_LAYER_ID;
    if (layer < 0) continue;

    if (aBoard.GetLayerName(layer) !== row.name) {
      aBoard.SetLayerName(layer, row.name);
      modified = true;
    }

    if (IsCopperLayer(layer)) {
      const t = indexOr(COPPER_TYPES, row.copperType ?? 'signal', LAYER_T.LT_UNDEFINED) as LAYER_T;
      if (aBoard.GetLayerType(layer) !== t) {
        aBoard.SetLayerType(layer, t);
        modified = true;
      }
    } else if (layer >= PCB_LAYER_ID.User_1) {
      const t =
        row.userType === 'front'
          ? LAYER_T.LT_FRONT
          : row.userType === 'back'
            ? LAYER_T.LT_BACK
            : LAYER_T.LT_AUX;
      if (aBoard.GetLayerType(layer) !== t) {
        aBoard.SetLayerType(layer, t);
        modified = true;
      }
    }
  }

  return modified;
}

/**
 * `transferDataFromUIToStackup()` + `PANEL_SETUP_BOARD_FINISH::TransferDataFromWindow`
 * into a scratch `BOARD_STACKUP`: what "Export to Clipboard" hands to
 * `BuildStackupReport` without touching the board.
 */
export function stackupFromView(
  aPhysical: BoardSetupValues['physicalStackup'],
  aFinish: BoardSetupValues['boardFinish'],
): BOARD_STACKUP {
  const st = new BOARD_STACKUP();
  let dielectricId = 1;
  for (const row of aPhysical.layers) {
    const item = stackupItemFromWindow(row, dielectricId);
    if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) {
      item.SetDielectricLayerId(dielectricId);
      dielectricId++;
    }
    st.Add(item);
  }
  st.m_HasDielectricConstrains = aPhysical.impedanceControlled;
  st.m_FinishType = aFinish.copperFinish;
  st.m_EdgeConnectorConstraints = indexOr(
    EDGE_CONNECTORS,
    aFinish.edgeCardConnectors as (typeof EDGE_CONNECTORS)[number],
    0,
  ) as BS_EDGE_CONNECTOR_CONSTRAINTS;
  st.m_EdgePlating = aFinish.platedBoardEdge;
  return st;
}

/** `PANEL_SETUP_BOARD_STACKUP::TransferDataFromWindow`: the rows into the descriptor. */
function stackupFromWindow(v: BoardSetupValues, aBoard: BOARD): boolean {
  const bds = aBoard.GetDesignSettings();
  const brd_stackup = bds.GetStackupDescriptor();
  const before = brd_stackup.GetList().map((i) => BOARD_STACKUP_ITEM.copyOf(i));

  brd_stackup.RemoveAll();
  let dielectricId = 1;
  for (const row of v.physicalStackup.layers) {
    const item = stackupItemFromWindow(row, dielectricId);
    if (item.GetType() === BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) {
      item.SetDielectricLayerId(dielectricId);
      dielectricId++;
    }
    brd_stackup.Add(item);
  }

  let modified =
    before.length !== brd_stackup.GetCount() ||
    before.some((b, i) => !b.equals(brd_stackup.GetStackupLayer(i)!));

  const thickness = brd_stackup.BuildBoardThicknessFromStackup();
  if (bds.GetBoardThickness() !== thickness) {
    bds.SetBoardThickness(thickness);
    modified = true;
  }

  if (brd_stackup.m_HasDielectricConstrains !== v.physicalStackup.impedanceControlled) {
    brd_stackup.m_HasDielectricConstrains = v.physicalStackup.impedanceControlled;
    modified = true;
  }

  if (!bds.m_HasStackup) {
    bds.m_HasStackup = true;
    modified = true;
  }

  return modified;
}

function stackupItemFromWindow(row: StackupLayer, _aDielectricId: number): BOARD_STACKUP_ITEM {
  const typeKey = STACKUP_TYPE_KEY[row.type] ?? row.type;
  let type: BOARD_STACKUP_ITEM_TYPE;
  if (typeKey === KEY_COPPER) type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_COPPER;
  else if (typeKey === KEY_CORE || typeKey === KEY_PREPREG)
    type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC;
  else if (/Solder Paste/.test(row.type)) type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERPASTE;
  else if (/Solder Mask/.test(row.type)) type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SOLDERMASK;
  else type = BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_SILKSCREEN;

  const item = new BOARD_STACKUP_ITEM(type);
  item.SetTypeName(typeKey);
  if (type !== BOARD_STACKUP_ITEM_TYPE.BS_ITEM_TYPE_DIELECTRIC) {
    const fileName =
      row.name === 'F.Silkscreen' ? 'F.SilkS' : row.name === 'B.Silkscreen' ? 'B.SilkS' : row.name;
    item.SetBrdLayerId(LSET.NameToLayer(fileName) as PCB_LAYER_ID);
  }
  item.SetMaterial(row.material, 0);
  item.SetThickness(iuOf(row.thicknessMM), 0);
  item.SetThicknessLocked(row.locked ?? false, 0);
  item.SetColor(row.color, 0);
  if (row.epsilonR !== undefined) item.SetEpsilonR(row.epsilonR, 0);
  if (row.lossTan !== undefined) item.SetLossTangent(row.lossTan, 0);

  for (const [i, sub] of (row.sublayers ?? []).entries()) {
    item.AddDielectricPrms(i + 1);
    item.SetMaterial(sub.material, i + 1);
    item.SetThickness(iuOf(sub.thicknessMM), i + 1);
    item.SetThicknessLocked(sub.locked ?? false, i + 1);
    if (sub.epsilonR !== undefined) item.SetEpsilonR(sub.epsilonR, i + 1);
    if (sub.lossTan !== undefined) item.SetLossTangent(sub.lossTan, i + 1);
  }

  return item;
}

/** `PANEL_SETUP_NETCLASSES::TransferDataFromWindow` into the project's NET_SETTINGS. */
function netClassesFromWindow(data: NetClassesData, aProject: PROJECT): void {
  const settings = aProject.GetProjectFile().NetSettings();

  const parseMM = (s: string): number | undefined => {
    const t = s.trim();
    if (t === '') return undefined;
    const f = Number.parseFloat(t);
    return Number.isFinite(f) ? iuOf(f) : undefined;
  };
  const parseMils = (s: string): number | undefined => {
    const t = s.trim();
    if (t === '') return undefined;
    const f = Number.parseFloat(t);
    return Number.isFinite(f) ? schIUScale.milsToIU(f) : undefined;
  };

  const fill = (nc: NETCLASS, row: NetClass): void => {
    nc.SetClearance(parseMM(row.clearance));
    nc.SetTrackWidth(parseMM(row.trackWidth));
    nc.SetViaDiameter(parseMM(row.viaSize));
    nc.SetViaDrill(parseMM(row.viaHole));
    nc.SetuViaDiameter(parseMM(row.uviaSize));
    nc.SetuViaDrill(parseMM(row.uviaHole));
    nc.SetDiffPairWidth(parseMM(row.dpWidth));
    nc.SetDiffPairGap(parseMM(row.dpGap));
    nc.SetDiffPairViaGap(parseMM(row.dpViaGap));
    nc.SetTuningProfile(row.tuningProfile);
    nc.SetPcbColor(cssToColor(row.pcbColor));
    nc.SetWireWidth(parseMils(row.wireThickness));
    nc.SetBusWidth(parseMils(row.busThickness));
    nc.SetSchematicColor(cssToColor(row.color));
    nc.SetLineStyle(Math.max(0, LINE_STYLES.indexOf(row.lineStyle)));
  };

  const [dfltRow, ...rows] = data.classes;
  if (dfltRow) {
    const dflt = settings.GetDefaultNetclass();
    fill(dflt, dfltRow);
    settings.SetDefaultNetclass(dflt);
  }

  const classes = new Map<string, NETCLASS>();
  rows.forEach((row, i) => {
    const nc = new NETCLASS(row.name, false);
    nc.SetPriority(i);
    fill(nc, row);
    classes.set(row.name, nc);
  });
  settings.SetNetclasses(classes);

  settings.ClearNetclassPatternAssignments();
  for (const a of data.assignments) {
    if (a.pattern !== '' || a.netClass !== '')
      settings.SetNetclassPatternAssignment(a.pattern, a.netClass);
  }

  settings.GetNetColorAssignments().clear();
  for (const [net, css] of Object.entries(data.netColors)) {
    if (css !== '') settings.GetNetColorAssignments().set(net, parseColor4d(css));
  }

  settings.ClearAllCaches();
}

/** `PANEL_EMBEDDED_FILES::TransferDataFromWindow`: the panel's list replaces the board's. */
function embeddedFilesFromWindow(
  data: { files: EmbeddedFile[]; embedFonts: boolean },
  aFiles: EMBEDDED_FILES,
): boolean {
  let modified = aFiles.GetAreFontsEmbedded() !== data.embedFonts;
  aFiles.SetAreFontsEmbedded(data.embedFonts);

  const keep = new Map<string, EMBEDDED_FILE>();
  for (const f of data.files) {
    const existing = aFiles.GetEmbeddedFile(f.name);
    if (existing && !f.pendingBytes) {
      keep.set(f.name, existing);
      continue;
    }
    if (!f.pendingBytes) continue;
    const file = new EMBEDDED_FILE();
    file.name = f.name;
    file.type = FILE_TYPE.OTHER;
    file.decompressedData = f.pendingBytes;
    EMBEDDED_FILES.CompressAndEncode(file);
    keep.set(f.name, file);
    modified = true;
  }

  for (const name of [...aFiles.EmbeddedFileMap().keys()]) {
    if (!keep.has(name)) modified = true;
  }

  aFiles.ClearEmbeddedFiles();
  for (const file of keep.values()) aFiles.AddFile(file);

  return modified;
}
