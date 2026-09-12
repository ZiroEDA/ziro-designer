// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The parts of KiCad's board model that live in the `.kicad_pcb` header —
 * `PAGE_INFO`, `TITLE_BLOCK`, the `LAYER` descriptors, `BOARD_STACKUP`,
 * `PCB_PLOT_PARAMS`, the `BOARD_DESIGN_SETTINGS` members the file carries
 * (the rest are project settings) — as plain data, one field per member the
 * C++ stores. `PCB_IO_KICAD_SEXPR_PARSER` fills them and
 * `PCB_IO_KICAD_SEXPR::format` writes them back; nothing between the two is
 * kept from the file text.
 *
 * Defaults are the C++ constructors' (board_design_settings.cpp:219-245,
 * pcb_plot_params.cpp:50-100, board_stackup.cpp:50-97), so a board that says
 * nothing about a setting is written the way KiCad writes it.
 */
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { B_Mask, B_Paste, B_SilkS, Edge_Cuts, F_Mask, F_Paste, F_SilkS } from './layer_ids.js';
import { LSET } from './lset.js';

// ---------------------------------------------------------------------------
// PAGE_INFO (include/page_info.h)
// ---------------------------------------------------------------------------

/** `PAGE_SIZE_TYPE`, spelled as `magic_enum::enum_name` spells it in the file. */
export type PageSizeType =
  | 'A5'
  | 'A4'
  | 'A3'
  | 'A2'
  | 'A1'
  | 'A0'
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'GERBER'
  | 'USLetter'
  | 'USLegal'
  | 'USLedger'
  | 'User';

export const PAGE_SIZE_TYPES: readonly PageSizeType[] = [
  'A5',
  'A4',
  'A3',
  'A2',
  'A1',
  'A0',
  'A',
  'B',
  'C',
  'D',
  'E',
  'GERBER',
  'USLetter',
  'USLegal',
  'USLedger',
  'User',
];

/** `EDA_UNIT_UTILS::Mm2mils`, a double — the metric sizes are not whole mils. */
const Mm2mils = (mm: number): number => (mm * 1000) / 25.4;

/**
 * `PAGE_INFO::standardPageSizes` (common/page_info.cpp:48-63): landscape sizes
 * in mils, the metric ones through `MMsize`. **Data**: KiCad's own table.
 */
export const STANDARD_PAGE_SIZES_MILS: Readonly<Record<PageSizeType, readonly [number, number]>> = {
  A5: [Mm2mils(210), Mm2mils(148)],
  A4: [Mm2mils(297), Mm2mils(210)],
  A3: [Mm2mils(420), Mm2mils(297)],
  A2: [Mm2mils(594), Mm2mils(420)],
  A1: [Mm2mils(841), Mm2mils(594)],
  A0: [Mm2mils(1189), Mm2mils(841)],
  A: [11000, 8500],
  B: [17000, 11000],
  C: [22000, 17000],
  D: [34000, 22000],
  E: [44000, 34000],
  GERBER: [32000, 32000],
  User: [17000, 11000],
  USLetter: [11000, 8500],
  USLegal: [14000, 8500],
  USLedger: [17000, 11000],
};

/** `PAGE_INFO`: the type, the size in mils (landscape unless portrait), and the orientation. */
export interface PageInfo {
  type: PageSizeType;
  /** `m_size`, mils, as stored: x is width, y is height, after any portrait swap. */
  widthMils: number;
  heightMils: number;
  portrait: boolean;
}

export function defaultPageInfo(): PageInfo {
  const [w, h] = STANDARD_PAGE_SIZES_MILS.A4;
  return { type: 'A4', widthMils: w, heightMils: h, portrait: false };
}

// ---------------------------------------------------------------------------
// TITLE_BLOCK (include/title_block.h)
// ---------------------------------------------------------------------------

export interface TitleBlock {
  title: string;
  date: string;
  revision: string;
  company: string;
  /** `GetComment( 0..8 )`. */
  comments: string[];
}

export function emptyTitleBlock(): TitleBlock {
  return { title: '', date: '', revision: '', company: '', comments: [] };
}

// ---------------------------------------------------------------------------
// LAYER (include/board.h)
// ---------------------------------------------------------------------------

/**
 * `LAYER_T`, spelled as `LAYER::ShowType` writes it (board.cpp:826-842).
 * `user` is not a type: `ParseType( "user" )` is LT_UNDEFINED, and a
 * non-copper layer is written with the literal word `user` instead of its
 * type (`formatBoardLayers`).
 */
export type LayerT =
  | 'signal'
  | 'power'
  | 'mixed'
  | 'jumper'
  | 'auxiliary'
  | 'front'
  | 'back'
  | 'undefined';

/** `LAYER::ParseType`: the words it knows; anything else is `undefined`. */
export const LAYER_T_NAMES: readonly Exclude<LayerT, 'undefined'>[] = [
  'signal',
  'power',
  'mixed',
  'jumper',
  'auxiliary',
  'front',
  'back',
];

/** `LAYER`: one board layer's descriptor. */
export interface LayerDescr {
  /** `m_number`, the `PCB_LAYER_ID`. */
  number: number;
  /** `m_name`, the canonical name. */
  name: string;
  /** `m_userName`, the user's rename, or `''`. */
  userName: string;
  type: LayerT;
  visible: boolean;
}

// ---------------------------------------------------------------------------
// BOARD_STACKUP (pcbnew/board_stackup_manager/board_stackup.h)
// ---------------------------------------------------------------------------

export type StackupItemType = 'copper' | 'dielectric' | 'soldermask' | 'solderpaste' | 'silkscreen';

/** `NotSpecifiedPrm()`: the sentinel for an unspecified material or colour. */
export const NOT_SPECIFIED_PRM = 'Not specified';

/** `IsPrmSpecified`. */
export const IsPrmSpecified = (v: string): boolean =>
  v !== '' && v.toLowerCase() !== NOT_SPECIFIED_PRM.toLowerCase();

/** `DIELECTRIC_PRMS`: one sublayer's parameters. */
export interface DielectricPrms {
  material: string;
  thickness: number;
  thicknessLocked: boolean;
  epsilonR: number;
  lossTangent: number;
  color: string;
}

export function defaultDielectricPrms(): DielectricPrms {
  return {
    material: '',
    thickness: 0,
    thicknessLocked: false,
    epsilonR: 1.0,
    lossTangent: 0.0,
    color: '',
  };
}

/** `BOARD_STACKUP_ITEM`. */
export interface StackupItem {
  type: StackupItemType;
  /** `m_LayerId`; UNDEFINED_LAYER (-1) for a dielectric. */
  brdLayerId: number;
  /** `m_DielectricLayerId`, the `"dielectric N"` number. */
  dielectricLayerId: number;
  /** `m_TypeName`: `copper`, `core`, `prepreg`, `soldermask`, … */
  typeName: string;
  enabled: boolean;
  /** `m_DielectricPrmsList`, at least one entry. */
  sublayers: DielectricPrms[];
}

/** `BOARD_STACKUP_ITEM::GetCopperDefaultThickness` / `GetMaskDefaultThickness`. */
export const COPPER_DEFAULT_THICKNESS = pcbIUScale.mmToIU(0.035);
export const MASK_DEFAULT_THICKNESS = pcbIUScale.mmToIU(0.01);
export const DEFAULT_EPSILON_R_SOLDERMASK = 3.3;
export const DEFAULT_EPSILON_R_SILKSCREEN = 1.0;

/** `BOARD_STACKUP_ITEM::BOARD_STACKUP_ITEM( aType )`, the constructor's initial values. */
export function newStackupItem(type: StackupItemType): StackupItem {
  const p = defaultDielectricPrms();
  const item: StackupItem = {
    type,
    brdLayerId: -1,
    dielectricLayerId: 1,
    typeName: '',
    enabled: true,
    sublayers: [p],
  };
  switch (type) {
    case 'copper':
      item.typeName = 'copper';
      p.thickness = COPPER_DEFAULT_THICKNESS;
      break;
    case 'dielectric':
      item.typeName = 'core'; // or prepreg
      p.color = NOT_SPECIFIED_PRM;
      p.material = 'FR4'; // or other dielectric name
      p.lossTangent = 0.02; // for FR4
      p.epsilonR = 4.5; // for FR4
      break;
    case 'solderpaste':
      item.typeName = 'solderpaste';
      break;
    case 'soldermask':
      item.typeName = 'soldermask';
      p.color = NOT_SPECIFIED_PRM;
      p.material = NOT_SPECIFIED_PRM;
      p.thickness = MASK_DEFAULT_THICKNESS;
      p.epsilonR = DEFAULT_EPSILON_R_SOLDERMASK;
      break;
    case 'silkscreen':
      item.typeName = 'silkscreen';
      p.color = NOT_SPECIFIED_PRM;
      p.material = NOT_SPECIFIED_PRM;
      p.epsilonR = DEFAULT_EPSILON_R_SILKSCREEN;
      break;
  }
  return item;
}

/** `BOARD_STACKUP`. */
export interface BoardStackup {
  list: StackupItem[];
  /** `m_FinishType`. */
  finishType: string;
  /** `m_HasDielectricConstrains`. */
  hasDielectricConstraints: boolean;
  /** `m_EdgeConnectorConstraints`: 0 none, 1 in use, 2 bevelled. */
  edgeConnectorConstraints: 0 | 1 | 2;
  /** `m_CastellatedPads`. */
  castellatedPads: boolean;
  /** `m_EdgePlating`. */
  edgePlating: boolean;
}

export function emptyStackup(): BoardStackup {
  return {
    list: [],
    finishType: NOT_SPECIFIED_PRM,
    hasDielectricConstraints: false,
    edgeConnectorConstraints: 0,
    castellatedPads: false,
    edgePlating: false,
  };
}

// ---------------------------------------------------------------------------
// PCB_PLOT_PARAMS (pcbnew/pcb_plot_params.h)
// ---------------------------------------------------------------------------

/** `PLOT_FORMAT`, the numeric ids the file stores (include/plotter.h). */
export enum PLOT_FORMAT {
  UNDEFINED = -1,
  HPGL = 0,
  GERBER = 1,
  POST = 2,
  DXF = 3,
  PDF = 4,
  SVG = 5,
}

/** `DRILL_MARKS`. */
export enum DRILL_MARKS {
  NO_DRILL_SHAPE = 0,
  SMALL_DRILL_SHAPE = 1,
  FULL_DRILL_SHAPE = 2,
}

export const GBR_DEFAULT_PRECISION = 6;
export const SVG_PRECISION_MIN = 3;
export const SVG_PRECISION_MAX = 6;
export const SVG_PRECISION_DEFAULT = 4;

export interface PcbPlotParams {
  layerSelection: LSET;
  /** `m_plotOnAllLayersSequence`, kept as the set it is written back as. */
  plotOnAllLayersSelection: LSET;
  gerberDisableApertMacros: boolean;
  useGerberProtelExtensions: boolean;
  useGerberX2format: boolean;
  includeGerberNetlistInfo: boolean;
  createGerberJobFile: boolean;
  gerberPrecision: number;
  dashedLineDashRatio: number;
  dashedLineGapRatio: number;
  svgPrecision: number;
  plotDrawingSheet: boolean;
  /** `m_DXFPlotMode`: FILLED (1 in the file) or SKETCH (2). */
  dxfPlotModeSketch: boolean;
  useAuxOrigin: boolean;
  pdfFrontFPPropertyPopups: boolean;
  pdfBackFPPropertyPopups: boolean;
  pdfMetadata: boolean;
  pdfSingle: boolean;
  dxfPolygonMode: boolean;
  /** `m_DXFUnits == DXF_UNITS::INCH`. */
  dxfImperialUnits: boolean;
  /** `m_textMode != PLOT_TEXT_MODE::NATIVE`. */
  dxfUsePcbnewFont: boolean;
  negative: boolean;
  a4Output: boolean;
  blackAndWhite: boolean;
  sketchPadsOnFabLayers: boolean;
  plotPadNumbers: boolean;
  hideDNPFPsOnFabLayers: boolean;
  sketchDNPFPsOnFabLayers: boolean;
  crossoutDNPFPsOnFabLayers: boolean;
  subtractMaskFromSilk: boolean;
  format: PLOT_FORMAT;
  mirror: boolean;
  drillMarks: DRILL_MARKS;
  scaleSelection: number;
  outputDirectory: string;
  /** `m_plotViaOnMaskLayer`, a legacy token the parser folds into tenting. */
  legacyPlotViaOnMaskLayer?: boolean;
}

/** `PCB_PLOT_PARAMS::PCB_PLOT_PARAMS()`. */
export function defaultPlotParams(): PcbPlotParams {
  return {
    layerSelection: new LSET([F_SilkS, B_SilkS, F_Mask, B_Mask, F_Paste, B_Paste, Edge_Cuts]).or(
      LSET.AllCuMask(),
    ),
    plotOnAllLayersSelection: new LSET(),
    gerberDisableApertMacros: false,
    useGerberProtelExtensions: false,
    useGerberX2format: true,
    includeGerberNetlistInfo: true,
    createGerberJobFile: true,
    gerberPrecision: GBR_DEFAULT_PRECISION,
    dashedLineDashRatio: 12.0, // From ISO 128-2
    dashedLineGapRatio: 3.0, // From ISO 128-2
    svgPrecision: SVG_PRECISION_DEFAULT,
    plotDrawingSheet: false,
    dxfPlotModeSketch: false,
    useAuxOrigin: false,
    pdfFrontFPPropertyPopups: true,
    pdfBackFPPropertyPopups: true,
    pdfMetadata: true,
    pdfSingle: false,
    dxfPolygonMode: true,
    dxfImperialUnits: true,
    dxfUsePcbnewFont: true,
    negative: false,
    a4Output: false,
    blackAndWhite: true,
    sketchPadsOnFabLayers: false,
    plotPadNumbers: false,
    hideDNPFPsOnFabLayers: false,
    sketchDNPFPsOnFabLayers: true,
    crossoutDNPFPsOnFabLayers: true,
    subtractMaskFromSilk: false,
    format: PLOT_FORMAT.GERBER,
    mirror: false,
    drillMarks: DRILL_MARKS.SMALL_DRILL_SHAPE,
    scaleSelection: 1,
    outputDirectory: '',
  };
}

// ---------------------------------------------------------------------------
// BOARD_DESIGN_SETTINGS, the members the .kicad_pcb carries
// (pcbnew/board_design_settings.cpp:219-245)
// ---------------------------------------------------------------------------

/** `ZONE_LAYER_PROPERTIES`. */
export interface ZoneLayerProperties {
  hatchingOffset?: Vec2;
}

export interface BoardDesignSettingsFile {
  /** `m_HasStackup` + `GetStackupDescriptor()`. */
  hasStackup: boolean;
  stackup: BoardStackup;
  /** `GetBoardThickness()`, from `(general (thickness …))`. */
  boardThickness: number;
  solderMaskExpansion: number;
  solderMaskMinWidth: number;
  solderPasteMargin: number;
  solderPasteMarginRatio: number;
  allowSoldermaskBridgesInFPs: boolean;
  tentViasFront: boolean;
  tentViasBack: boolean;
  coverViasFront: boolean;
  coverViasBack: boolean;
  plugViasFront: boolean;
  plugViasBack: boolean;
  capVias: boolean;
  fillVias: boolean;
  /** `m_ZoneLayerProperties`, a `std::map` so iteration is by layer id. */
  zoneLayerProperties: Map<number, ZoneLayerProperties>;
  auxOrigin: Vec2;
  gridOrigin: Vec2;
  plotOptions: PcbPlotParams;
}

export function defaultDesignSettingsFile(): BoardDesignSettingsFile {
  return {
    hasStackup: false,
    stackup: emptyStackup(),
    boardThickness: pcbIUScale.mmToIU(1.6),
    solderMaskExpansion: 0,
    solderMaskMinWidth: 0,
    solderPasteMargin: 0,
    solderPasteMarginRatio: 0,
    allowSoldermaskBridgesInFPs: false,
    tentViasFront: true,
    tentViasBack: true,
    coverViasFront: false,
    coverViasBack: false,
    plugViasFront: false,
    plugViasBack: false,
    capVias: false,
    fillVias: false,
    zoneLayerProperties: new Map(),
    auxOrigin: { x: 0, y: 0 },
    gridOrigin: { x: 0, y: 0 },
    plotOptions: defaultPlotParams(),
  };
}

// ---------------------------------------------------------------------------
// EMBEDDED_FILES (include/embedded_files.h)
// ---------------------------------------------------------------------------

export type EmbeddedFileType = 'datasheet' | 'font' | 'model' | 'worksheet' | 'other';

/** `EMBEDDED_FILES::EMBEDDED_FILE`, kept in its on-disk form. */
export interface EmbeddedFile {
  name: string;
  type: EmbeddedFileType;
  /** `compressedEncodedData`: the base64 of the zstd stream, as the file carries it. */
  compressedEncodedData: string;
  /** `data_hash`. */
  dataHash: string;
}

export interface EmbeddedFiles {
  /** `m_files`, a `std::map` keyed by name so iteration is name order. */
  files: Map<string, EmbeddedFile>;
  areFontsEmbedded: boolean;
}

export function emptyEmbeddedFiles(): EmbeddedFiles {
  return { files: new Map(), areFontsEmbedded: false };
}

/** `BOARD::m_properties`, the `(property "k" "v")` rows, a `std::map` (key order). */
export type BoardProperties = Map<string, string>;

/** `BOARD::GetVariantNames()` + descriptions, in insertion order. */
export interface BoardVariant {
  name: string;
  description: string;
}
