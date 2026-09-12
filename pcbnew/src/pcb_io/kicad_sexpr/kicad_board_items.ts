// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board items as KiCad's classes hold them (pcbnew/pad.h, padstack.h,
 * pcb_text.h, pcb_field.h, pcb_textbox.h, pcb_table.h, pcb_dimension.h,
 * pcb_reference_image.h, pcb_barcode.h, footprint.h, pcb_track.h, zone.h,
 * pcb_group.h, pcb_generator.h, pcb_point.h): one field per member the
 * parser sets and the formatter reads, with the constructors' defaults.
 * Plain data; no `source` node anywhere.
 *
 * Coordinates follow the file: a footprint child is footprint-relative (its
 * `at`), taken through KiCad's read/write rounding (`fpRoundTrip`); angles
 * of pads and footprint texts are board-frame absolute, as the file has them.
 */
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { newKiid } from '@ziroeda/common/src/kiid.js';
import {
  B_Adhes,
  B_CrtYd,
  B_Cu,
  B_Fab,
  B_Mask,
  B_Paste,
  B_SilkS,
  F_Adhes,
  F_CrtYd,
  F_Cu,
  F_Fab,
  F_Mask,
  F_Paste,
  F_SilkS,
  UNDEFINED_LAYER,
} from '../../layer_ids.js';
import { LSET } from '../../lset.js';
import type { EmbeddedFiles, ZoneLayerProperties } from '../../board_file_model.js';
import type { TeardropParams } from '../../types.js';
import type { KPcbShape, NetRef, OutlineEntry, StrokeParams } from './pcb_io_kicad_sexpr_items.js';

// ---------------------------------------------------------------------------
// EDA_TEXT / PCB_TEXT / PCB_FIELD
// ---------------------------------------------------------------------------

/** `EDA_TEXT`'s attributes (include/eda_text.h, text_attributes.h). */
export interface KEdaText {
  text: string;
  /** `m_attributes.m_Font` name, `''` for the stroke font. */
  fontName: string;
  /** `GetTextSize()`: x is width, y is height. */
  size: Vec2;
  /** `GetTextThickness()`; 0 with `GetAutoThickness()` true. */
  thickness: number;
  autoThickness: boolean;
  lineSpacing: number;
  bold: boolean;
  italic: boolean;
  mirrored: boolean;
  hJustify: 'left' | 'center' | 'right';
  vJustify: 'top' | 'center' | 'bottom';
  /** `(color r g b a)` in the font block, UNSPECIFIED when absent. */
  color?: { r: number; g: number; b: number; a: number };
  hyperlink: string;
  /** `GetTextPos()`. */
  pos: Vec2;
  /** `GetTextAngle()` in degrees. */
  angle: number;
  visible: boolean;
  /** `(render_cache "text" angle (polygon (pts …)) …)`, kept as read. */
  renderCache?: { text: string; angle: number; glyphs: OutlineEntry[][][] };
}

/** `DEFAULT_SIZE_TEXT` (include/eda_text.h): 50 mils. */
export const DEFAULT_SIZE_TEXT_IU = pcbIUScale.milsToIU(50);

export function defaultEdaText(): KEdaText {
  return {
    text: '',
    fontName: '',
    size: { x: DEFAULT_SIZE_TEXT_IU, y: DEFAULT_SIZE_TEXT_IU },
    thickness: 0,
    autoThickness: true,
    lineSpacing: 1.0,
    bold: false,
    italic: false,
    mirrored: false,
    hJustify: 'center',
    vJustify: 'center',
    hyperlink: '',
    pos: { x: 0, y: 0 },
    angle: 0,
    visible: true,
  };
}

/** `PCB_TEXT`. */
export interface KPcbText extends KEdaText {
  layer: number;
  knockout: boolean;
  locked: boolean;
  keepUpright: boolean;
  uuid: string;
}

/** `PCB_TEXT::PCB_TEXT( FOOTPRINT* )` / `( BOARD_ITEM* )`. */
export function newPcbText(parentFP: { at: Vec2; layer: number } | null): KPcbText {
  const t: KPcbText = {
    ...defaultEdaText(),
    layer: F_SilkS,
    knockout: false,
    locked: false,
    keepUpright: false,
    uuid: newKiid(),
  };
  if (parentFP) {
    t.keepUpright = true;
    // The board position defaults to the parent's; relative that is the origin.
    t.pos = { x: 0, y: 0 };
    if (parentFP.layer === B_Cu) t.layer = B_SilkS;
  }
  return t;
}

/** `FIELD_T`. */
export type FieldT = 'reference' | 'value' | 'datasheet' | 'description' | 'user';

/** `PCB_FIELD`: a text with an id and a name; `GetCanonicalName()` is the file key. */
export interface KPcbField extends KPcbText {
  fieldId: FieldT;
  name: string;
}

export function fieldCanonicalName(f: KPcbField): string {
  switch (f.fieldId) {
    case 'reference':
      return 'Reference';
    case 'value':
      return 'Value';
    case 'datasheet':
      return 'Datasheet';
    case 'description':
      return 'Description';
    default:
      return f.name;
  }
}

// ---------------------------------------------------------------------------
// PCB_TEXTBOX / PCB_TABLE
// ---------------------------------------------------------------------------

export interface KPcbTextBox extends KEdaText {
  /** `GetShape()`: RECTANGLE (start/end) or POLY (outline). */
  shape: 'rectangle' | 'poly';
  start: Vec2;
  end: Vec2;
  outline?: OutlineEntry[];
  marginLeft: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  stroke: StrokeParams;
  borderEnabled: boolean;
  knockout: boolean;
  layer: number;
  locked: boolean;
  uuid: string;
}

export interface KPcbTableCell extends KPcbTextBox {
  colSpan: number;
  rowSpan: number;
}

export interface KPcbTable {
  colCount: number;
  uuid: string;
  locked: boolean;
  layer: number;
  strokeExternal: boolean;
  strokeHeaderSeparator: boolean;
  borderStroke: StrokeParams;
  strokeRows: boolean;
  strokeColumns: boolean;
  separatorsStroke: StrokeParams;
  colWidths: number[];
  rowHeights: number[];
  cells: KPcbTableCell[];
}

// ---------------------------------------------------------------------------
// PCB_DIMENSION_BASE
// ---------------------------------------------------------------------------

export type DimensionType = 'aligned' | 'orthogonal' | 'leader' | 'center' | 'radial';

export interface KPcbDimension {
  type: DimensionType;
  locked: boolean;
  layer: number;
  uuid: string;
  start: Vec2;
  end: Vec2;
  /** aligned / orthogonal */
  height: number;
  /** radial */
  leaderLength: number;
  /** orthogonal: 0 horizontal, 1 vertical */
  orientation: number;
  prefix: string;
  suffix: string;
  unitsMode: number;
  unitsFormat: number;
  precision: number;
  overrideTextEnabled: boolean;
  overrideText: string;
  suppressZeroes: boolean;
  lineThickness: number;
  arrowLength: number;
  textPositionMode: number;
  arrowDirection: 'inward' | 'outward';
  extensionHeight: number;
  /** leader */
  textBorder: number;
  extensionOffset: number;
  keepTextAligned: boolean;
  /** The `(gr_text …)` inside, `PCB_TEXT` members of the dimension itself. */
  text: KPcbText;
  /** `SetAutoUnits` from a legacy dimension. */
  autoUnits: boolean;
}

// ---------------------------------------------------------------------------
// PCB_REFERENCE_IMAGE / PCB_BARCODE / PCB_POINT / PCB_TARGET
// ---------------------------------------------------------------------------

export interface KPcbReferenceImage {
  pos: Vec2;
  layer: number;
  scale: number;
  locked: boolean;
  /** The `(data …)` base64, as read; re-encoded by the C++ from the decoded image. */
  data: string;
  uuid: string;
}

export interface KPcbBarcode {
  locked: boolean;
  pos: Vec2;
  angle: number;
  layer: number;
  width: number;
  height: number;
  text: string;
  textHeight: number;
  kind: 'code39' | 'code128' | 'datamatrix' | 'qr' | 'microqr';
  ecc: 'L' | 'M' | 'Q' | 'H';
  showText: boolean;
  knockout: boolean;
  margin: Vec2;
  uuid: string;
}

export interface KPcbPoint {
  pos: Vec2;
  size: number;
  layer: number;
  uuid: string;
  locked: boolean;
}

export interface KPcbTarget {
  shape: number;
  pos: Vec2;
  size: number;
  width: number;
  layer: number;
  uuid: string;
}

// ---------------------------------------------------------------------------
// PADSTACK / PAD
// ---------------------------------------------------------------------------

export type PadShape =
  | 'circle'
  | 'rectangle'
  | 'oval'
  | 'trapezoid'
  | 'roundrect'
  | 'chamfered_rect'
  | 'custom';
export type PadAttrib = 'pth' | 'smd' | 'conn' | 'npth';
export type PadProp =
  | 'none'
  | 'bga'
  | 'fiducial_glbl'
  | 'fiducial_local'
  | 'testpoint'
  | 'heatsink'
  | 'castellated'
  | 'mechanical'
  | 'pressfit';
export type PadstackMode = 'normal' | 'front_inner_back' | 'custom';
export type UnconnectedLayerMode =
  | 'keep_all'
  | 'remove_all'
  | 'remove_except_start_and_end'
  | 'start_end_only';

/** `PADSTACK::INNER_LAYERS`, which is `In1_Cu`. */
export const PADSTACK_INNER_LAYERS = 4;
/** `PADSTACK::ALL_LAYERS`, which is `F_Cu`. */
export const PADSTACK_ALL_LAYERS = F_Cu;

export const RECT_CHAMFER_TOP_LEFT = 1;
export const RECT_CHAMFER_TOP_RIGHT = 2;
export const RECT_CHAMFER_BOTTOM_LEFT = 4;
export const RECT_CHAMFER_BOTTOM_RIGHT = 8;

/** `PADSTACK::SHAPE_PROPS`. */
export interface ShapeProps {
  shape: PadShape;
  anchorShape: PadShape;
  size: Vec2;
  offset: Vec2;
  roundRectRadiusRatio: number;
  chamferedRectRatio: number;
  chamferedRectPositions: number;
  trapezoidDeltaSize: Vec2;
}

/** `PADSTACK::SHAPE_PROPS::SHAPE_PROPS()`. */
export function defaultShapeProps(): ShapeProps {
  return {
    shape: 'circle',
    anchorShape: 'rectangle',
    size: { x: 0, y: 0 },
    offset: { x: 0, y: 0 },
    roundRectRadiusRatio: 0.0,
    chamferedRectRatio: 0.0,
    chamferedRectPositions: 0,
    trapezoidDeltaSize: { x: 0, y: 0 },
  };
}

/** `PADSTACK::COPPER_LAYER_PROPS`. */
export interface CopperLayerProps {
  shape: ShapeProps;
  zoneConnection?: number;
  thermalSpokeWidth?: number;
  thermalSpokeAngle?: number;
  thermalGap?: number;
  clearance?: number;
  /** `custom_shapes`, in pad-local coordinates at orientation 0. */
  customShapes: KPcbShape[];
}

export function defaultCopperLayerProps(): CopperLayerProps {
  return { shape: defaultShapeProps(), customShapes: [] };
}

/** `PADSTACK::MASK_LAYER_PROPS`. */
export interface MaskLayerProps {
  solderMaskMargin?: number;
  solderPasteMargin?: number;
  solderPasteMarginRatio?: number;
  hasSolderMask?: boolean;
  hasSolderPaste?: boolean;
  hasCovering?: boolean;
  hasPlugging?: boolean;
}

/** `PADSTACK::DRILL_PROPS`. */
export interface DrillProps {
  size: Vec2;
  shape: 'undefined' | 'circle' | 'oblong';
  start: number;
  end: number;
  isFilled?: boolean;
  isCapped?: boolean;
}

/** `PADSTACK::POST_MACHINING_PROPS`. */
export interface PostMachiningProps {
  mode?: 'not_post_machined' | 'counterbore' | 'countersink';
  size: number;
  depth: number;
  /** tenths of a degree. */
  angle: number;
}

/** `PADSTACK`. */
export interface KPadstack {
  mode: PadstackMode;
  layerSet: LSET;
  orientation: number;
  unconnectedLayerMode: UnconnectedLayerMode;
  customShapeInZoneMode: 'outline' | 'convexhull';
  /** `m_copperProps`, keyed by layer id — a `std::map`, so iteration is id order. */
  copperProps: Map<number, CopperLayerProps>;
  frontOuterLayers: MaskLayerProps;
  backOuterLayers: MaskLayerProps;
  drill: DrillProps;
  secondaryDrill: DrillProps;
  tertiaryDrill: DrillProps;
  frontPostMachining: PostMachiningProps;
  backPostMachining: PostMachiningProps;
}

/** `PADSTACK::PADSTACK( BOARD_ITEM* )`. */
export function newPadstack(): KPadstack {
  const all = defaultCopperLayerProps();
  all.thermalSpokeAngle = 45;
  return {
    mode: 'normal',
    layerSet: new LSET(),
    orientation: 0,
    unconnectedLayerMode: 'keep_all',
    customShapeInZoneMode: 'outline',
    copperProps: new Map([[PADSTACK_ALL_LAYERS, all]]),
    frontOuterLayers: {},
    backOuterLayers: {},
    drill: { size: { x: 0, y: 0 }, shape: 'circle', start: F_Cu, end: B_Cu },
    secondaryDrill: {
      size: { x: 0, y: 0 },
      shape: 'undefined',
      start: UNDEFINED_LAYER,
      end: UNDEFINED_LAYER,
    },
    tertiaryDrill: {
      size: { x: 0, y: 0 },
      shape: 'undefined',
      start: UNDEFINED_LAYER,
      end: UNDEFINED_LAYER,
    },
    frontPostMachining: { size: 0, depth: 0, angle: 0 },
    backPostMachining: { size: 0, depth: 0, angle: 0 },
  };
}

/** `IsFrontLayer` (layer_ids.h:781). */
export const isFrontLayer = (l: number): boolean =>
  l === F_Cu ||
  l === F_Adhes ||
  l === F_Paste ||
  l === F_SilkS ||
  l === F_Mask ||
  l === F_CrtYd ||
  l === F_Fab;
/** `IsBackLayer` (layer_ids.h:804). */
export const isBackLayer = (l: number): boolean =>
  l === B_Cu ||
  l === B_Adhes ||
  l === B_Paste ||
  l === B_SilkS ||
  l === B_Mask ||
  l === B_CrtYd ||
  l === B_Fab;

/**
 * `PADSTACK::CopperLayer( aLayer )` (padstack.cpp:1166), the non-const
 * accessor: creates the entry the mode addresses.
 */
export function copperLayerProps(ps: KPadstack, layer: number): CopperLayerProps {
  let key: number;
  if (ps.mode === 'normal') key = PADSTACK_ALL_LAYERS;
  else if (ps.mode === 'front_inner_back') {
    if (isFrontLayer(layer)) key = F_Cu;
    else if (isBackLayer(layer)) key = B_Cu;
    else key = PADSTACK_INNER_LAYERS;
  } else key = layer;
  let props = ps.copperProps.get(key);
  if (!props) {
    props = defaultCopperLayerProps();
    ps.copperProps.set(key, props);
  }
  return props;
}

/** `PADSTACK::CopperLayer( aLayer ) const` (padstack.cpp:1185): reads with the fallbacks. */
export function copperLayerPropsConst(ps: KPadstack, layer: number): CopperLayerProps {
  const m = ps.copperProps;
  if (ps.mode === 'front_inner_back') {
    if (isFrontLayer(layer) && m.has(F_Cu)) return m.get(F_Cu)!;
    if (isBackLayer(layer) && m.has(B_Cu)) return m.get(B_Cu)!;
    if (m.has(PADSTACK_INNER_LAYERS)) return m.get(PADSTACK_INNER_LAYERS)!;
  } else if (ps.mode === 'custom') {
    if (isFrontLayer(layer) && m.has(F_Cu)) return m.get(F_Cu)!;
    if (isBackLayer(layer) && m.has(B_Cu)) return m.get(B_Cu)!;
    if (m.has(layer)) return m.get(layer)!;
    if (m.has(PADSTACK_ALL_LAYERS)) return m.get(PADSTACK_ALL_LAYERS)!;
    return m.values().next().value!;
  }
  return m.get(PADSTACK_ALL_LAYERS)!;
}

/** `PADSTACK::ForEachUniqueLayer`. */
export function uniquePadstackLayers(ps: KPadstack): number[] {
  if (ps.mode === 'normal') return [PADSTACK_ALL_LAYERS];
  if (ps.mode === 'front_inner_back') return [F_Cu, PADSTACK_INNER_LAYERS, B_Cu];
  return [...ps.copperProps.keys()].sort((a, b) => a - b);
}

/** `PADSTACK::DefaultThermalSpokeAngleForShape( aLayer )`. */
export function defaultThermalSpokeAngleForShape(ps: KPadstack, layer: number): number {
  const s = copperLayerPropsConst(ps, layer).shape.shape;
  if (s === 'oval' || s === 'rectangle' || s === 'roundrect' || s === 'chamfered_rect') return 90;
  return 45;
}

/** `PADSTACK::ThermalSpokeAngle( aLayer )`. */
export function padstackThermalSpokeAngle(ps: KPadstack, layer: number): number {
  const p = copperLayerPropsConst(ps, layer);
  return p.thermalSpokeAngle ?? defaultThermalSpokeAngleForShape(ps, layer);
}

/** `PAD`. */
export interface KPad {
  number: string;
  attribute: PadAttrib;
  property: PadProp;
  /** `GetFPRelativePosition()`, through `fpRoundTrip`. */
  at: Vec2;
  /** `GetOrientation()`, board-frame absolute. */
  orientation: number;
  padstack: KPadstack;
  net: NetRef;
  pinFunction: string;
  pinType: string;
  padToDieLength: number;
  padToDieDelay: number;
  /**
   * The pad-level overrides (`GetLocalClearance`, `GetLocalSolderMaskMargin`,
   * `GetLocalZoneConnection`, the thermal overrides) live in the padstack:
   * the F_Cu copper entry and the front/back outer layers, as `PAD::SetLocal*`
   * puts them.
   */
  teardrops: TeardropParams;
  /** `GetZoneLayerOverride( layer ) == ZLO_FORCE_FLASHED` layers. */
  zoneLayerForceFlashed: Set<number>;
  uuid: string;
}

/** `TEARDROP_PARAMETERS` defaults (teardrop_parameters.h). */
export function defaultTeardropParams(): TeardropParams {
  return {
    enabled: false,
    allowUseTwoTracks: true,
    tdOnPadsInZones: false,
    bestLengthRatio: 0.5,
    tdMaxLen: pcbIUScale.mmToIU(1.0),
    bestWidthRatio: 1.0,
    tdMaxWidth: pcbIUScale.mmToIU(2.0),
    curvedEdges: false,
    widthtoSizeFilterRatio: 0.9,
  };
}

/** `PAD::PAD( FOOTPRINT* )` (pad.cpp:79). */
export function newPad(): KPad {
  const ps = newPadstack();
  const all = ps.copperProps.get(PADSTACK_ALL_LAYERS)!;
  all.shape.size = { x: pcbIUScale.milsToIU(60), y: pcbIUScale.milsToIU(60) };
  ps.drill.size = { x: pcbIUScale.milsToIU(30), y: pcbIUScale.milsToIU(30) };
  all.shape.shape = 'circle';
  all.shape.anchorShape = 'circle';
  all.shape.roundRectRadiusRatio = 0.25;
  all.shape.chamferedRectRatio = 0.2;
  all.shape.chamferedRectPositions = 0;
  // `PTHMask()`: every copper layer and both masks.
  ps.layerSet = LSET.AllCuMask().or(new LSET([F_Mask, B_Mask]));
  return {
    number: '',
    attribute: 'pth',
    property: 'none',
    at: { x: 0, y: 0 },
    orientation: 0,
    padstack: ps,
    net: null,
    pinFunction: '',
    pinType: '',
    padToDieLength: 0,
    padToDieDelay: 0,
    teardrops: defaultTeardropParams(),
    zoneLayerForceFlashed: new Set(),
    uuid: newKiid(),
  };
}

// ---------------------------------------------------------------------------
// FP_3DMODEL / FOOTPRINT
// ---------------------------------------------------------------------------

export interface KFp3DModel {
  filename: string;
  show: boolean;
  opacity: number;
  offset: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

export interface KFpUnitInfo {
  unitName: string;
  pins: string[];
}

export interface KFootprintVariant {
  name: string;
  dnp?: boolean;
  excludedFromBOM?: boolean;
  excludedFromPosFiles?: boolean;
  /** `std::map<wxString, wxString>` fields, so name order. */
  fields: Map<string, string>;
}

export const FP_SMD = 1;
export const FP_THROUGH_HOLE = 2;
export const FP_BOARD_ONLY = 4;
export const FP_EXCLUDE_FROM_POS_FILES = 8;
export const FP_EXCLUDE_FROM_BOM = 16;
export const FP_DNP = 32;

export interface KFootprint {
  /** `GetFPID().Format()`: the lib id as written. */
  fpid: string;
  initialComments: string[] | null;
  fileFormatVersionAtLoad: number;
  locked: boolean;
  placed: boolean;
  layer: number;
  uuid: string;
  at: Vec2;
  orientation: number;
  libDescription: string;
  keywords: string;
  /** `GetFields()`: the four mandatory fields, then user fields in order. */
  fields: KPcbField[];
  /** `GetStaticComponentClass()` constituent names, or none. */
  componentClasses: string[];
  filters: string;
  path: string;
  sheetname: string;
  sheetfile: string;
  unitInfo: KFpUnitInfo[];
  localSolderMaskMargin?: number;
  localSolderPasteMargin?: number;
  localSolderPasteMarginRatio?: number;
  localClearance?: number;
  /** `ZONE_CONNECTION` (zones.h:46): INHERITED -1, NONE 0, THERMAL 1, FULL 2, THT_THERMAL 3. */
  localZoneConnection: number;
  attributes: number;
  allowMissingCourtyard: boolean;
  allowSolderMaskBridges: boolean;
  stackupMode: 'expand_inner_layers' | 'custom_layers';
  stackupLayers: LSET;
  privateLayers: LSET;
  netTiePadGroups: string[];
  duplicatePadNumbersAreJumpers: boolean;
  jumperPadGroups: Set<string>[];
  /** `GraphicalItems()`: shapes, texts, text boxes, tables, images, barcodes, dimensions, in file order. */
  graphicalItems: KFpGraphicalItem[];
  points: KPcbPoint[];
  pads: KPad[];
  zones: KZone[];
  groups: KPcbGroup[];
  /** `resolveGroups( footprint )`: group uuid -> the member uuids among its children. */
  groupMembers?: Map<string, string[]>;
  variants: KFootprintVariant[];
  embeddedFiles: EmbeddedFiles;
  models: KFp3DModel[];
}

export type KFpGraphicalItem =
  | { kind: 'shape'; item: KPcbShape }
  | { kind: 'text'; item: KPcbText }
  | { kind: 'textbox'; item: KPcbTextBox }
  | { kind: 'table'; item: KPcbTable }
  | { kind: 'image'; item: KPcbReferenceImage }
  | { kind: 'barcode'; item: KPcbBarcode }
  | { kind: 'dimension'; item: KPcbDimension };

// ---------------------------------------------------------------------------
// PCB_TRACK / PCB_ARC / PCB_VIA
// ---------------------------------------------------------------------------

export interface KPcbTrack {
  type: 'segment' | 'arc';
  start: Vec2;
  mid?: Vec2;
  end: Vec2;
  width: number;
  locked: boolean;
  layer: number;
  hasSolderMask: boolean;
  solderMaskMargin?: number;
  net: NetRef;
  uuid: string;
}

export interface KPcbVia {
  viaType: 'through' | 'blind' | 'buried' | 'micro';
  at: Vec2;
  /** `GetWidth( F_Cu )`: the padstack size on F_Cu. */
  padstack: KPadstack;
  /** `GetDrill()`; UNDEFINED_DRILL_DIAMETER (-1) when the netclass value. */
  drill: number;
  /** `LayerPair()`. */
  layer1: number;
  layer2: number;
  locked: boolean;
  isFree: boolean;
  zoneLayerForceFlashed: Set<number>;
  teardrops: TeardropParams;
  net: NetRef;
  uuid: string;
}

// ---------------------------------------------------------------------------
// ZONE
// ---------------------------------------------------------------------------

export interface KZoneFilledPolygon {
  layer: number;
  island: boolean;
  outline: OutlineEntry[];
}

export interface KZone {
  net: NetRef;
  locked: boolean;
  layerSet: LSET;
  uuid: string;
  name: string;
  hatchStyle: 'none' | 'edge' | 'full' | 'invisible';
  hatchPitch: number;
  priority: number;
  isTeardropArea: boolean;
  teardropType: 'padvia' | 'track_end';
  padConnection: number;
  localClearance: number;
  minThickness: number;
  isRuleArea: boolean;
  doNotAllowTracks: boolean;
  doNotAllowVias: boolean;
  doNotAllowPads: boolean;
  doNotAllowZoneFills: boolean;
  doNotAllowFootprints: boolean;
  placementEnabled: boolean;
  placementSourceType: 'sheetname' | 'component_class' | 'group' | 'design_block';
  placementSource: string;
  isFilled: boolean;
  fillMode: 'polygons' | 'hatch_pattern';
  thermalReliefGap: number;
  thermalReliefSpokeWidth: number;
  cornerSmoothingType: number;
  cornerRadius: number;
  islandRemovalMode: number;
  /** `GetMinIslandArea()`, in IU² as `m_minIslandArea` (a long long). */
  minIslandArea: number;
  hatchThickness: number;
  hatchGap: number;
  hatchOrientation: number;
  hatchSmoothingLevel: number;
  hatchSmoothingValue: number;
  hatchBorderAlgorithm: number;
  hatchHoleMinArea: number;
  layerProperties: Map<number, ZoneLayerProperties>;
  /** `Outline()->Polygon(0)`: the outline and its holes. */
  outline: OutlineEntry[][];
  /** The fills, in file order (the formatter regroups per layer). */
  filledPolygons: KZoneFilledPolygon[];
}

// ---------------------------------------------------------------------------
// PCB_GROUP / PCB_GENERATOR
// ---------------------------------------------------------------------------

export interface KPcbGroup {
  name: string;
  uuid: string;
  locked: boolean;
  libId: string;
  /** Member uuids as read; resolved to items at the end of the parse. */
  memberUuids: string[];
}

export interface KPcbGenerator extends KPcbGroup {
  generatorType: string;
  layer: number;
  /** The property list in file order, each a typed value. */
  properties: { key: string; value: GeneratorValue }[];
}

export type GeneratorValue =
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'xy'; value: Vec2 }
  | { kind: 'pts'; value: OutlineEntry[] }
  | { kind: 'string'; value: string };
