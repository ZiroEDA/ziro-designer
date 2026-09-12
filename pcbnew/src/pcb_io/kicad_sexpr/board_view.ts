// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The editor's `Board` (types.ts) as a view of KiCad's own model, `KBoard`.
 *
 * `boardFromKBoard` derives every editor-facing field from the parsed model
 * — the same fields, in the same units and frames, that the old sexpr reader
 * produced (footprint children board-absolute, layers by canonical name,
 * nets by code, arcs in polygons tessellated) — and keeps the K item on
 * each view item as `k`. `kboardFromBoard` writes the view back: for each
 * item it derives the field again from `k` and, only where the editor's
 * value differs, applies the inverse mapping (the C++ setter the edit stands
 * for). An untouched item therefore writes the bytes it was read from, and
 * the K model — not a text tree — is what the file is formatted from.
 *
 * What the view does not model (design settings, stackup, plot parameters,
 * padstack layers other than the front, viastacks, render caches, variants,
 * embedded files, generators, a footprint's text boxes and tables) simply
 * stays in `k` and is written unchanged.
 */
import { newKiid } from '@ziroeda/common/src/kiid.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { FormatDouble2Str } from '@ziroeda/common/src/string_utils.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import {
  type BoardDesignSettingsFile,
  type LayerDescr,
  type LayerT,
  type PageInfo,
  type PageSizeType,
  PAGE_SIZE_TYPES,
  STANDARD_PAGE_SIZES_MILS,
  type TitleBlock,
  emptyTitleBlock,
} from '../../board_file_model.js';
import {
  B_Cu,
  B_Mask,
  F_Cu,
  F_Mask,
  IsCopperLayer,
  IsExternalCopperLayer,
  LSET_Name,
  LSET_NameToLayer,
  UNDEFINED_LAYER,
  User_1,
} from '../../layer_ids.js';
import { LSET } from '../../lset.js';
import type { PcbDrillSlot, PcbPostMachining } from '../../padstack_drill.js';
import type {
  BarcodeEcc,
  BarcodeKind,
  Board,
  DimensionFormat,
  DimensionStyle,
  DimTextBorder,
  DimTextPosition,
  DimUnitsFormat,
  DimUnitsMode,
  DimPrecision,
  Model3D,
  PadPrimitive,
  PadShape,
  PadType,
  PcbArcTrack,
  PcbBarcode,
  PcbDimension,
  PcbFootprint,
  PcbFootprintField,
  PcbGroup,
  PcbImage,
  PcbLayerDef,
  PcbPad,
  PcbPoint,
  PcbShape,
  PcbTable,
  PcbTableCell,
  PcbTextBox,
  PcbTextItem,
  PcbTrack,
  PcbVia,
  PcbZone,
  PcbZoneFill,
  PlacementSourceType,
  StrokeType,
  TeardropParams,
  UnconnectedLayerMode,
} from '../../types.js';
import {
  ZONE_CONNECTION_CODE,
  type ZoneConnection,
  zoneConnectionFromCode,
} from '../../zone_connection.js';
import type { PcbFillMode } from '../../shape_fill.js';
import { rotatePcb, tessellateArc } from '../../read-board.js';
import {
  copperLayerProps,
  copperLayerPropsConst,
  defaultTeardropParams,
  type DrillProps,
  fieldCanonicalName,
  FP_BOARD_ONLY,
  FP_DNP,
  FP_EXCLUDE_FROM_BOM,
  FP_EXCLUDE_FROM_POS_FILES,
  FP_SMD,
  FP_THROUGH_HOLE,
  type KEdaText,
  type KFootprint,
  type KFp3DModel,
  type KFpGraphicalItem,
  type KPad,
  type KPcbBarcode,
  type KPcbDimension,
  type KPcbField,
  type KPcbGroup,
  type KPcbPoint,
  type KPcbReferenceImage,
  type KPcbTable,
  type KPcbTableCell,
  type KPcbText,
  type KPcbTextBox,
  type KPcbTrack,
  type KPcbVia,
  type KZone,
  type KZoneFilledPolygon,
  newPad,
  newPcbText,
  PADSTACK_ALL_LAYERS,
  type PadShape as KPadShape,
  padstackThermalSpokeAngle,
  type PostMachiningProps,
} from './kicad_board_items.js';
import {
  type KBoard,
  type KBoardDrawing,
  type KBoardTrack,
  ParseBoard,
  resolveGroups,
} from './pcb_io_kicad_sexpr_board.js';
import { MAX_PAGE_SIZE_PCBNEW_MM, MIN_PAGE_SIZE_MM } from './pcb_io_kicad_sexpr_parser.js';
import {
  type KPcbShape,
  type NetRef,
  newFootprint,
  newTextBox,
  newVia,
  newZone,
  type OutlineEntry,
  setArcGeometry,
  type StrokeParams,
  trackLayerSet,
  UNDEFINED_DRILL_DIAMETER,
  viaSetLayerPair,
} from './pcb_io_kicad_sexpr_items.js';
import { isDefaultTeardropParameters } from './pcb_io_kicad_sexpr.js';

// ---------------------------------------------------------------------------
// Small conversions
// ---------------------------------------------------------------------------

/** The view's empty source node: the tree is gone, the type still names it. */
const NO_SOURCE = { kind: 'list' as const, items: [] };

const sameVec = (a: Vec2 | undefined, b: Vec2 | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && a.x === b.x && a.y === b.y);

const sameVecs = (a: readonly Vec2[] | undefined, b: readonly Vec2[] | undefined): boolean => {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameVec(a[i], b[i])) return false;
  return true;
};

const sameStrings = (
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** A footprint's placement, for the child transforms. */
interface FpTransform {
  pos: Vec2;
  angle: number;
}

/** Footprint-relative -> board, the way the old reader baked children (`rotatePcb` + translate). */
const toBoard = (local: Vec2, t: FpTransform | null): Vec2 => {
  if (!t) return local;
  const r = rotatePcb(local, t.angle);
  return { x: r.x + t.pos.x, y: r.y + t.pos.y };
};

/** Board -> footprint-relative: `formatInternalUnits( aCoord, aParentFP )` (:466). */
const toLocal = (board: Vec2, t: FpTransform | null): Vec2 => {
  if (!t) return board;
  const coord = { x: board.x - t.pos.x, y: board.y - t.pos.y };
  return t.angle === 0 ? coord : RotatePoint(coord, new EDA_ANGLE(-t.angle));
};

const layerName = (id: number): string => (id === UNDEFINED_LAYER ? '' : LSET_Name(id));

/** A canonical layer name back to its id; an unknown name is UNDEFINED. */
const layerId = (name: string): number => {
  if (name === '') return UNDEFINED_LAYER;
  const id = LSET_NameToLayer(name);
  return id;
};

/** `PCB_TRACK::GetLayerSet()`'s mask half, as the old reader's `maskLayerOf`. */
const maskLayerNameOf = (item: { layer: number; hasSolderMask: boolean }): string | undefined => {
  if (!item.hasSolderMask) return undefined;
  for (const l of trackLayerSet(item).Seq()) if (l === F_Mask || l === B_Mask) return LSET_Name(l);
  return undefined;
};

/** `(pts …)` as the old reader gave it: arcs tessellated, transformed to the board. */
function pointsOf(outline: readonly OutlineEntry[], t: FpTransform | null): Vec2[] {
  const out: Vec2[] = [];
  for (const e of outline) {
    if ('xy' in e) out.push(toBoard(e.xy, t));
    else for (const p of tessellateArc(e.arc.start, e.arc.mid, e.arc.end)) out.push(toBoard(p, t));
  }
  return out;
}

/** The reverse: an edited point list becomes a plain outline (an arc, once edited, is its points). */
const outlineOf = (pts: readonly Vec2[], t: FpTransform | null): OutlineEntry[] =>
  pts.map((p) => ({ xy: toLocal(p, t) }));

const netCode = (net: NetRef): number | undefined => (net ? net.code : undefined);

/** A view net code back to the model's net, through the board's net table. */
const netRefOf = (code: number | undefined, nets: Map<number, string>): NetRef => {
  if (code === undefined || code === 0) return null;
  if (code < 0) return { name: '', code };
  return { name: nets.get(code) ?? '', code };
};

const strokeOf = (
  width: number,
  type: StrokeType | undefined,
  prev?: StrokeParams,
): StrokeParams => ({
  width,
  type: type ?? prev?.type ?? 'solid',
  ...(prev?.color ? { color: prev.color } : {}),
});

// ---------------------------------------------------------------------------
// Layers: the `(layers …)` tokens of a multi-layer item, `formatLayers` (:1549)
// ---------------------------------------------------------------------------

/** The `(layers …)` tokens KiCad writes for a layer set, wildcards and all. */
export function layerTokens(layerMaskIn: LSET, copperLayerCount: number, isZone = false): string[] {
  const cu_all = LSET.AllCuMask();
  const fr_bk = new LSET([B_Cu, F_Cu]);
  const cu_board_mask = LSET.AllCuMask(copperLayerCount);
  let layerMask = layerMaskIn.clone();
  const out: string[] = [];
  if (layerMask.and(cu_board_mask).equals(cu_board_mask)) {
    out.push('*.Cu');
    layerMask = layerMask.andNot(cu_all);
  } else if (layerMask.and(cu_board_mask).equals(fr_bk)) {
    out.push(isZone ? 'F&B.Cu' : '*.Cu');
    layerMask = layerMask.andNot(fr_bk);
  }
  const pairs: [string, number, number][] = [
    ['*.Adhes', 9, 11],
    ['*.Paste', 13, 15],
    ['*.SilkS', 5, 7],
    ['*.Mask', 1, 3],
    ['*.CrtYd', 31, 29],
    ['*.Fab', 35, 33],
  ];
  for (const [name, a, b] of pairs) {
    const set = new LSET([a, b]);
    if (layerMask.and(set).equals(set)) {
      out.push(name);
      layerMask = layerMask.andNot(set);
    }
  }
  for (const layer of layerMask.Seq()) out.push(LSET_Name(layer));
  return out;
}

/** The parser's `m_layerMasks` for the canonical names and wildcards. */
const WILDCARD_MASKS: Record<string, () => LSET> = {
  '*.Cu': () => LSET.AllCuMask(),
  '*In.Cu': () => LSET.InternalCuMask(),
  'F&B.Cu': () => new LSET([F_Cu, B_Cu]),
  '*.Adhes': () => new LSET([9, 11]),
  '*.Paste': () => new LSET([13, 15]),
  '*.SilkS': () => new LSET([5, 7]),
  '*.Mask': () => new LSET([1, 3]),
  '*.CrtYd': () => new LSET([29, 31]),
  '*.Fab': () => new LSET([33, 35]),
};

/** `(layers …)` tokens back to a layer set, `parseBoardItemLayersAsMask`. */
export function layerSetOfTokens(tokens: readonly string[]): LSET {
  let set = new LSET();
  for (const tok of tokens) {
    const wild = WILDCARD_MASKS[tok];
    if (wild) {
      set = set.or(wild());
      continue;
    }
    const id = LSET_NameToLayer(tok);
    if (id >= 0) set.set(id);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Page and title block
// ---------------------------------------------------------------------------

/** The `(paper …)` token as the view keeps it: `"A4"`, `"A4 portrait"`, `"User 200 150"`. */
export function paperOfPageInfo(p: PageInfo): string {
  if (p.type === 'User')
    return `User ${FormatDouble2Str((p.widthMils * 25.4) / 1000.0)} ${FormatDouble2Str((p.heightMils * 25.4) / 1000.0)}`;
  return p.portrait ? `${p.type} portrait` : p.type;
}

/** `parsePAGE_INFO` (:1728) over the view's token. */
export function pageInfoOfPaper(paper: string, prev: PageInfo): PageInfo {
  const parts = paper.trim().split(/\s+/);
  const word = parts[0] ?? '';
  const type = PAGE_SIZE_TYPES.find((t) => t.toLowerCase() === word.toLowerCase());
  if (!type) return prev;
  const [w, h] = STANDARD_PAGE_SIZES_MILS[type as PageSizeType];
  const pageInfo: PageInfo = {
    type: type as PageSizeType,
    widthMils: w,
    heightMils: h,
    portrait: false,
  };
  if (pageInfo.type === 'User') {
    let width = Number(parts[1] ?? Number.NaN);
    let height = Number(parts[2] ?? Number.NaN);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return prev;
    // Perform some controls to avoid crashes if the size is edited by hands
    if (width < MIN_PAGE_SIZE_MM) width = MIN_PAGE_SIZE_MM;
    else if (width > MAX_PAGE_SIZE_PCBNEW_MM) width = MAX_PAGE_SIZE_PCBNEW_MM;
    if (height < MIN_PAGE_SIZE_MM) height = MIN_PAGE_SIZE_MM;
    else if (height > MAX_PAGE_SIZE_PCBNEW_MM) height = MAX_PAGE_SIZE_PCBNEW_MM;
    pageInfo.widthMils = (width * 1000.0) / 25.4;
    pageInfo.heightMils = (height * 1000.0) / 25.4;
    pageInfo.portrait = pageInfo.heightMils > pageInfo.widthMils;
  }
  if (parts.includes('portrait') && !pageInfo.portrait) {
    const t = pageInfo.widthMils;
    pageInfo.widthMils = pageInfo.heightMils;
    pageInfo.heightMils = t;
    pageInfo.portrait = pageInfo.heightMils > pageInfo.widthMils;
  }
  return pageInfo;
}

type ViewTitleBlock = NonNullable<Board['titleBlock']>;

function titleBlockView(tb: TitleBlock): ViewTitleBlock | undefined {
  const comments = tb.comments.some((c) => c) ? [...tb.comments] : undefined;
  if (!tb.title && !tb.date && !tb.revision && !tb.company && !comments) return undefined;
  return {
    title: tb.title || undefined,
    date: tb.date || undefined,
    rev: tb.revision || undefined,
    company: tb.company || undefined,
    comments,
  };
}

function titleBlockOfView(v: ViewTitleBlock | undefined): TitleBlock {
  const tb = emptyTitleBlock();
  if (!v) return tb;
  tb.title = v.title ?? '';
  tb.date = v.date ?? '';
  tb.revision = v.rev ?? '';
  tb.company = v.company ?? '';
  tb.comments = (v.comments ?? []).map((c) => c ?? '');
  return tb;
}

const sameTitleBlock = (a: ViewTitleBlock | undefined, b: ViewTitleBlock | undefined): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.title === b.title &&
    a.date === b.date &&
    a.rev === b.rev &&
    a.company === b.company &&
    sameStrings(a.comments, b.comments));

// ---------------------------------------------------------------------------
// The layer table
// ---------------------------------------------------------------------------

/** The `(layers …)` rows as `formatBoardLayers` (:659) writes them. */
function layerTableView(kb: Pick<KBoard, 'enabledLayers' | 'layerDescrs'>): PcbLayerDef[] {
  const nameOf = (layer: number): string => {
    const d = kb.layerDescrs.get(layer);
    return d && d.userName !== '' ? d.userName : LSET_Name(layer);
  };
  const typeOf = (layer: number): string => {
    const d = kb.enabledLayers.test(layer) ? kb.layerDescrs.get(layer) : undefined;
    let t: string;
    if (d) t = d.type;
    else if (layer >= User_1 && !IsCopperLayer(layer)) t = 'auxiliary';
    else if (IsCopperLayer(layer)) t = 'signal';
    else t = 'undefined';
    return t === 'undefined' ? 'signal' : t;
  };
  const rows: PcbLayerDef[] = [];
  for (const layer of kb.enabledLayers.CuStack()) {
    const user = nameOf(layer);
    rows.push({
      id: layer,
      name: LSET_Name(layer),
      kind: typeOf(layer),
      ...(user !== LSET_Name(layer) ? { userName: user } : {}),
    });
  }
  for (const layer of kb.enabledLayers.TechAndUserUIOrder()) {
    let printType = false;
    if (layer >= User_1) {
      if (IsCopperLayer(layer)) printType = true;
      const t = typeOf(layer);
      if (t === 'front' || t === 'back') printType = true;
    }
    const user = nameOf(layer);
    rows.push({
      id: layer,
      name: LSET_Name(layer),
      kind: printType ? typeOf(layer) : 'user',
      ...(user !== LSET_Name(layer) ? { userName: user } : {}),
    });
  }
  return rows;
}

const sameLayerRows = (a: readonly PcbLayerDef[], b: readonly PcbLayerDef[]): boolean =>
  a.length === b.length &&
  a.every((r, i) => {
    const s = b[i]!;
    return (
      r.id === s.id &&
      r.name === s.name &&
      r.kind === s.kind &&
      (r.userName ?? '') === (s.userName ?? '')
    );
  });

/** `LAYER::ParseType`: the words the file uses; anything else is LT_UNDEFINED. */
const LAYER_TYPES: readonly LayerT[] = [
  'signal',
  'power',
  'mixed',
  'jumper',
  'auxiliary',
  'front',
  'back',
];

/** `parseLayers` (:2258) over the view's rows: the enabled set, copper count and descriptors. */
function applyLayerTable(kb: KBoard, rows: readonly PcbLayerDef[]): void {
  const enabled = new LSET();
  const descrs = new Map<number, LayerDescr>();
  let copper = 0;
  for (const row of rows) {
    const id = row.id >= 0 && LSET_Name(row.id) === row.name ? row.id : LSET_NameToLayer(row.name);
    if (id < 0) continue;
    const type: LayerT = (LAYER_TYPES as readonly string[]).includes(row.kind)
      ? (row.kind as LayerT)
      : 'undefined';
    const prev = kb.layerDescrs.get(id);
    enabled.set(id);
    if (IsCopperLayer(id)) copper++;
    descrs.set(id, {
      number: id,
      name: LSET_Name(id),
      userName: row.userName && row.userName !== LSET_Name(id) ? row.userName : '',
      type,
      visible: prev?.visible ?? true,
    });
  }
  kb.enabledLayers = enabled;
  kb.copperLayerCount = copper;
  kb.layerDescrs = descrs;
}

// ---------------------------------------------------------------------------
// Texts: EDA_TEXT / PCB_TEXT / PCB_FIELD
// ---------------------------------------------------------------------------

/** The `(justify …)` words `EDA_TEXT::Format` writes, or none. */
function justifyWords(t: KEdaText): string[] | undefined {
  if (!t.mirrored && t.hJustify === 'center' && t.vJustify === 'center') return undefined;
  const words: string[] = [];
  if (t.hJustify !== 'center') words.push(t.hJustify === 'left' ? 'left' : 'right');
  if (t.vJustify !== 'center') words.push(t.vJustify === 'top' ? 'top' : 'bottom');
  if (t.mirrored) words.push('mirror');
  return words;
}

function applyJustify(
  t: KEdaText,
  words: readonly string[] | undefined,
  mirror: boolean | undefined,
): void {
  const w = words ?? [];
  t.hJustify = w.includes('left') ? 'left' : w.includes('right') ? 'right' : 'center';
  t.vJustify = w.includes('top') ? 'top' : w.includes('bottom') ? 'bottom' : 'center';
  t.mirrored = mirror ?? w.includes('mirror');
}

function textView(k: KPcbText, kind: PcbTextItem['kind'], t: FpTransform | null): PcbTextItem {
  const justify = justifyWords(k);
  return {
    kind,
    text: k.text,
    at: toBoard(k.pos, t),
    angle: k.angle,
    layer: layerName(k.layer),
    face: k.fontName || undefined,
    size: { x: k.size.x, y: k.size.y },
    thickness: k.autoThickness ? undefined : k.thickness,
    bold: k.bold,
    italic: k.italic,
    mirror: justify?.includes('mirror'),
    justify,
    keepUpright: k.keepUpright,
    hide: !k.visible,
    knockout: k.knockout,
    locked: k.locked,
    uuid: k.uuid,
    source: NO_SOURCE,
    k,
  };
}

/** The view's fields back into the text, where they differ from what it would show. */
function applyText(
  k: KPcbText,
  v: PcbTextItem,
  t: FpTransform | null,
  keepShownText: string,
): void {
  if (v.text !== keepShownText) k.text = v.text;
  if (!sameVec(toBoard(k.pos, t), v.at)) k.pos = toLocal(v.at, t);
  k.angle = v.angle;
  if (layerName(k.layer) !== v.layer) k.layer = layerId(v.layer);
  k.fontName = v.face ?? '';
  k.size = { x: v.size.x, y: v.size.y };
  if (v.thickness === undefined) k.autoThickness = true;
  else {
    k.autoThickness = false;
    k.thickness = v.thickness;
  }
  k.bold = v.bold ?? false;
  k.italic = v.italic ?? false;
  if (!sameStrings(justifyWords(k), v.justify) || (v.mirror ?? false) !== k.mirrored)
    applyJustify(k, v.justify, v.mirror);
  k.keepUpright = v.keepUpright ?? false;
  k.visible = !(v.hide ?? false);
  k.knockout = v.knockout ?? false;
  k.locked = v.locked ?? false;
  if (v.uuid) k.uuid = v.uuid;
}

/** A text the editor made without a model: `PCB_TEXT( parent )`, then the fields. */
function textOfView(v: PcbTextItem, t: FpTransform | null, parentLayer: number): KPcbText {
  const k = v.k ?? newPcbText(t ? { at: t.pos, layer: parentLayer } : null);
  applyText(k, v, t, k.text);
  return k;
}

// ---------------------------------------------------------------------------
// Shapes: PCB_SHAPE
// ---------------------------------------------------------------------------

const SHAPE_KIND: Record<KPcbShape['shape'], PcbShape['kind']> = {
  segment: 'line',
  rectangle: 'rect',
  arc: 'arc',
  circle: 'circle',
  poly: 'poly',
  bezier: 'curve',
};
const SHAPE_OF_KIND: Record<PcbShape['kind'], KPcbShape['shape']> = {
  line: 'segment',
  rect: 'rectangle',
  arc: 'arc',
  circle: 'circle',
  poly: 'poly',
  curve: 'bezier',
};
const FILL_MODE: Record<KPcbShape['fill'], PcbFillMode> = {
  no_fill: 'none',
  filled_shape: 'solid',
  hatch: 'hatch',
  reverse_hatch: 'reverse_hatch',
  cross_hatch: 'cross_hatch',
};
const FILL_OF_MODE: Record<PcbFillMode, KPcbShape['fill']> = {
  none: 'no_fill',
  solid: 'filled_shape',
  hatch: 'hatch',
  reverse_hatch: 'reverse_hatch',
  cross_hatch: 'cross_hatch',
};

function shapePoints(k: KPcbShape, t: FpTransform | null): Vec2[] | undefined {
  if (k.shape === 'poly') return pointsOf(k.outline ?? [], t);
  if (k.shape === 'bezier')
    return [k.start, k.bezierC1!, k.bezierC2!, k.end].map((p) => toBoard(p, t));
  return undefined;
}

function shapeView(k: KPcbShape, t: FpTransform | null): PcbShape {
  const kind = SHAPE_KIND[k.shape];
  const s: PcbShape = {
    ...(k.net ? { net: k.net.code, netName: k.net.name } : {}),
    kind,
    width: k.stroke.width,
    strokeType: k.stroke.type,
    cornerRadius: kind === 'rect' && k.cornerRadius !== 0 ? k.cornerRadius : undefined,
    fillMode: FILL_MODE[k.fill],
    layer: layerName(k.layer),
    maskLayer: maskLayerNameOf(k),
    solderMaskMargin: k.solderMaskMargin,
    locked: k.locked,
    uuid: k.uuid,
    source: NO_SOURCE,
    k,
  };
  if (kind === 'circle') {
    s.center = toBoard(k.start, t);
    s.end = toBoard(k.end, t);
  } else if (kind !== 'curve') {
    s.start = toBoard(k.start, t);
    s.end = toBoard(k.end, t);
    if (kind === 'arc') s.mid = toBoard(k.arcMid!, t);
  }
  const pts = shapePoints(k, t);
  if (pts) s.pts = pts;
  return s;
}

function applyShape(
  k: KPcbShape,
  v: PcbShape,
  t: FpTransform | null,
  nets: Map<number, string>,
): void {
  k.shape = SHAPE_OF_KIND[v.kind];
  const start = v.kind === 'circle' ? v.center : v.start;
  const end = v.end;
  let geometryChanged = false;
  if (start && !sameVec(toBoard(k.start, t), start)) {
    k.start = toLocal(start, t);
    geometryChanged = true;
  }
  if (end && !sameVec(toBoard(k.end, t), end)) {
    k.end = toLocal(end, t);
    geometryChanged = true;
  }
  if (
    v.kind === 'arc' &&
    v.mid &&
    (geometryChanged || !sameVec(toBoard(k.arcMid ?? k.start, t), v.mid))
  ) {
    // `SetArcGeometry( start, mid, end )`: the centre follows the three points.
    const g = setArcGeometry(k.start, toLocal(v.mid, t), k.end);
    k.start = g.start;
    k.end = g.end;
    k.arcCenter = g.center;
    k.arcMid = g.mid;
  }
  if (v.kind === 'poly' || v.kind === 'curve') {
    const pts = v.pts ?? [];
    if (!sameVecs(shapePoints(k, t), pts)) {
      if (v.kind === 'poly') k.outline = outlineOf(pts, t);
      else if (pts.length >= 4) {
        k.start = toLocal(pts[0]!, t);
        k.bezierC1 = toLocal(pts[1]!, t);
        k.bezierC2 = toLocal(pts[2]!, t);
        k.end = toLocal(pts[3]!, t);
      }
    }
  }
  k.stroke = strokeOf(v.width, v.strokeType, k.stroke);
  k.cornerRadius = v.kind === 'rect' ? (v.cornerRadius ?? 0) : k.cornerRadius;
  k.fill = FILL_OF_MODE[v.fillMode];
  if (layerName(k.layer) !== v.layer) k.layer = layerId(v.layer);
  k.hasSolderMask = v.maskLayer !== undefined;
  k.solderMaskMargin = v.solderMaskMargin;
  k.locked = v.locked ?? false;
  k.net = v.net !== undefined ? netRefOf(v.net, nets) : null;
  if (v.uuid) k.uuid = v.uuid;
}

/** `PCB_SHAPE( parent )` for a shape the editor drew. */
function newShape(): KPcbShape {
  return {
    shape: 'segment',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    cornerRadius: 0,
    stroke: { width: 0, type: 'default' },
    fill: 'no_fill',
    locked: false,
    layer: F_Cu,
    hasSolderMask: false,
    net: null,
    uuid: newKiid(),
    proxy: false,
  };
}

function shapeOfView(v: PcbShape, t: FpTransform | null, nets: Map<number, string>): KPcbShape {
  const k = v.k ?? newShape();
  applyShape(k, v, t, nets);
  return k;
}

// ---------------------------------------------------------------------------
// Pads
// ---------------------------------------------------------------------------

const PAD_TYPE: Record<KPad['attribute'], PadType> = {
  pth: 'thru_hole',
  smd: 'smd',
  conn: 'connect',
  npth: 'np_thru_hole',
};
const PAD_ATTRIB: Record<PadType, KPad['attribute']> = {
  thru_hole: 'pth',
  smd: 'smd',
  connect: 'conn',
  np_thru_hole: 'npth',
};
const PAD_SHAPE_VIEW: Record<KPadShape, PadShape> = {
  circle: 'circle',
  rectangle: 'rect',
  oval: 'oval',
  trapezoid: 'trapezoid',
  roundrect: 'roundrect',
  chamfered_rect: 'roundrect',
  custom: 'custom',
};
const PAD_PROPERTY: Record<KPad['property'], string | undefined> = {
  none: undefined,
  bga: 'pad_prop_bga',
  fiducial_glbl: 'pad_prop_fiducial_glob',
  fiducial_local: 'pad_prop_fiducial_loc',
  testpoint: 'pad_prop_testpoint',
  heatsink: 'pad_prop_heatsink',
  castellated: 'pad_prop_castellated',
  mechanical: 'pad_prop_mechanical',
  pressfit: 'pad_prop_pressfit',
};
const CHAMFER_WORDS: [number, string][] = [
  [1, 'top_left'],
  [2, 'top_right'],
  [4, 'bottom_left'],
  [8, 'bottom_right'],
];

const drillSlotView = (d: DrillProps): PcbDrillSlot | undefined =>
  d.size.x > 0 ? { size: d.size.x, start: layerName(d.start), end: layerName(d.end) } : undefined;

function applyDrillSlot(d: DrillProps, v: PcbDrillSlot | undefined): void {
  if (!v) {
    d.size = { x: 0, y: 0 };
    return;
  }
  d.size = { x: v.size, y: v.size };
  d.start = layerId(v.start);
  d.end = layerId(v.end);
}

const postMachiningView = (p: PostMachiningProps): PcbPostMachining | undefined =>
  p.mode === undefined || p.mode === 'not_post_machined'
    ? undefined
    : {
        mode: p.mode,
        ...(p.size > 0 ? { size: p.size } : {}),
        ...(p.depth > 0 ? { depth: p.depth } : {}),
        ...(p.angle > 0 ? { angle: p.angle } : {}),
      };

function applyPostMachining(p: PostMachiningProps, v: PcbPostMachining | undefined): void {
  if (!v) {
    p.mode = 'not_post_machined';
    return;
  }
  p.mode = v.mode;
  p.size = v.size ?? 0;
  p.depth = v.depth ?? 0;
  p.angle = v.angle ?? 0;
}

const teardropsView = (td: TeardropParams): TeardropParams | undefined =>
  isDefaultTeardropParameters(td) ? undefined : { ...td };

const PRIMITIVE_KIND = (p: KPcbShape): PadPrimitive['kind'] | undefined => {
  switch (p.shape) {
    case 'segment':
      return p.proxy ? 'gr_vector' : 'gr_line';
    case 'rectangle':
      return p.proxy ? undefined : 'gr_rect';
    case 'arc':
      return 'gr_arc';
    case 'circle':
      return 'gr_circle';
    case 'poly':
      return 'gr_poly';
    default:
      return undefined;
  }
};

function primitivesView(shapes: readonly KPcbShape[]): PadPrimitive[] | undefined {
  const out: PadPrimitive[] = [];
  for (const p of shapes) {
    const kind = PRIMITIVE_KIND(p);
    if (!kind) continue;
    out.push({
      kind,
      pts: p.shape === 'poly' ? pointsOf(p.outline ?? [], null) : undefined,
      start: p.shape === 'circle' ? undefined : p.start,
      mid: p.shape === 'arc' ? p.arcMid : undefined,
      end: p.end,
      center: p.shape === 'circle' ? p.start : undefined,
      width: p.stroke.width,
      fill: p.fill === 'filled_shape',
    });
  }
  return out.length > 0 ? out : undefined;
}

const samePrimitives = (
  a: readonly PadPrimitive[] | undefined,
  b: readonly PadPrimitive[] | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((p, i) => {
    const q = b[i]!;
    return (
      p.kind === q.kind &&
      p.width === q.width &&
      p.fill === q.fill &&
      sameVec(p.start, q.start) &&
      sameVec(p.mid, q.mid) &&
      sameVec(p.end, q.end) &&
      sameVec(p.center, q.center) &&
      sameVecs(p.pts, q.pts)
    );
  });
};

function primitivesOfView(prims: readonly PadPrimitive[]): KPcbShape[] {
  return prims.map((p) => {
    const k = newShape();
    k.proxy = p.kind === 'gr_vector';
    switch (p.kind) {
      case 'gr_line':
      case 'gr_vector':
        k.shape = 'segment';
        k.start = p.start ?? { x: 0, y: 0 };
        k.end = p.end ?? { x: 0, y: 0 };
        break;
      case 'gr_rect':
        k.shape = 'rectangle';
        k.start = p.start ?? { x: 0, y: 0 };
        k.end = p.end ?? { x: 0, y: 0 };
        break;
      case 'gr_arc': {
        k.shape = 'arc';
        const g = setArcGeometry(
          p.start ?? { x: 0, y: 0 },
          p.mid ?? p.start ?? { x: 0, y: 0 },
          p.end ?? { x: 0, y: 0 },
        );
        k.start = g.start;
        k.end = g.end;
        k.arcCenter = g.center;
        k.arcMid = g.mid;
        break;
      }
      case 'gr_circle':
        k.shape = 'circle';
        k.start = p.center ?? { x: 0, y: 0 };
        k.end = p.end ?? { x: 0, y: 0 };
        break;
      case 'gr_poly':
        k.shape = 'poly';
        k.outline = outlineOf(p.pts ?? [], null);
        break;
    }
    k.stroke = { width: p.width, type: 'solid' };
    k.fill = p.fill ? 'filled_shape' : 'no_fill';
    return k;
  });
}

function padView(k: KPad, t: FpTransform | null, copperLayerCount: number): PcbPad {
  const ps = k.padstack;
  const all = copperLayerPropsConst(ps, PADSTACK_ALL_LAYERS);
  const fcu = copperLayerPropsConst(ps, F_Cu);
  const s = all.shape;
  const view: PadPad = {
    number: k.number,
    type: PAD_TYPE[k.attribute],
    shape: PAD_SHAPE_VIEW[s.shape],
    at: toBoard(k.at, t),
    angle: k.orientation,
    size: { x: s.size.x, y: s.size.y },
    drill:
      ps.drill.size.x > 0 || ps.drill.size.y > 0
        ? {
            oblong: ps.drill.shape === 'oblong',
            w: ps.drill.size.x,
            h: ps.drill.size.y,
            ...(s.offset.x !== 0 || s.offset.y !== 0
              ? { offset: { x: s.offset.x, y: s.offset.y } }
              : {}),
          }
        : undefined,
    layers: layerTokens(ps.layerSet, copperLayerCount),
    roundrectRatio:
      s.shape === 'roundrect' || s.shape === 'chamfered_rect' ? s.roundRectRadiusRatio : undefined,
    chamferRatio: s.shape === 'chamfered_rect' ? s.chamferedRectRatio : undefined,
    chamfer:
      s.shape === 'chamfered_rect' && s.chamferedRectPositions !== 0
        ? CHAMFER_WORDS.filter(([bit]) => s.chamferedRectPositions & bit).map(([, w]) => w)
        : undefined,
    delta:
      s.trapezoidDeltaSize.x !== 0 || s.trapezoidDeltaSize.y !== 0
        ? { ...s.trapezoidDeltaSize }
        : undefined,
    net: netCode(k.net),
    pinFunction: k.pinFunction || undefined,
    padProperty: PAD_PROPERTY[k.property],
    pinType: k.pinType || undefined,
    primitives: s.shape === 'custom' ? primitivesView(all.customShapes) : undefined,
    localClearance: fcu.clearance,
    localSolderMaskMargin: ps.frontOuterLayers.solderMaskMargin,
    localSolderPasteMargin: ps.frontOuterLayers.solderPasteMargin,
    localSolderPasteMarginRatio: ps.frontOuterLayers.solderPasteMarginRatio,
    zoneConnection:
      fcu.zoneConnection !== undefined ? zoneConnectionFromCode(fcu.zoneConnection) : undefined,
    thermalBridgeWidth: fcu.thermalSpokeWidth,
    thermalGap: fcu.thermalGap,
    thermalSpokeAngle: padstackThermalSpokeAngle(ps, F_Cu),
    anchorShape:
      s.shape === 'custom' ? (s.anchorShape === 'rectangle' ? 'rect' : 'circle') : undefined,
    padToDieLength: k.padToDieLength !== 0 ? k.padToDieLength : undefined,
    backdrill: drillSlotView(ps.secondaryDrill),
    tertiaryDrill: drillSlotView(ps.tertiaryDrill),
    frontPostMachining: postMachiningView(ps.frontPostMachining),
    backPostMachining: postMachiningView(ps.backPostMachining),
    teardrops: teardropsView(k.teardrops),
    unconnectedLayerMode:
      ps.unconnectedLayerMode === 'keep_all' ? undefined : ps.unconnectedLayerMode,
    uuid: k.uuid,
    source: NO_SOURCE,
    k,
  };
  return view;
}
type PadPad = PcbPad;

function applyPad(
  k: KPad,
  v: PcbPad,
  t: FpTransform | null,
  nets: Map<number, string>,
  copperLayerCount: number,
): void {
  const ps = k.padstack;
  const all = copperLayerProps(ps, PADSTACK_ALL_LAYERS);
  const fcu = copperLayerProps(ps, F_Cu);
  const s = all.shape;
  k.number = v.number;
  k.attribute = PAD_ATTRIB[v.type];
  // `SetShape( ALL_LAYERS, … )`: a chamfered rect is a roundrect with corners.
  if (PAD_SHAPE_VIEW[s.shape] !== v.shape) {
    s.shape = v.shape === 'rect' ? 'rectangle' : v.shape;
  }
  if (v.shape === 'roundrect') {
    const positions = v.chamfer
      ? CHAMFER_WORDS.filter(([, w]) => v.chamfer!.includes(w)).reduce((m, [bit]) => m | bit, 0)
      : 0;
    s.chamferedRectPositions = positions;
    s.shape = positions !== 0 ? 'chamfered_rect' : 'roundrect';
    if (v.roundrectRatio !== undefined) s.roundRectRadiusRatio = v.roundrectRatio;
    if (v.chamferRatio !== undefined) s.chamferedRectRatio = v.chamferRatio;
  }
  if (!sameVec(toBoard(k.at, t), v.at)) k.at = toLocal(v.at, t);
  k.orientation = v.angle;
  s.size = { x: v.size.x, y: v.size.y };
  if (v.drill) {
    ps.drill.size = { x: v.drill.w, y: v.drill.h };
    ps.drill.shape = v.drill.oblong ? 'oblong' : 'circle';
    s.offset = v.drill.offset ? { x: v.drill.offset.x, y: v.drill.offset.y } : { x: 0, y: 0 };
  } else {
    ps.drill.size = { x: 0, y: 0 };
    s.offset = { x: 0, y: 0 };
  }
  if (!sameStrings(layerTokens(ps.layerSet, copperLayerCount), v.layers))
    ps.layerSet = layerSetOfTokens(v.layers);
  s.trapezoidDeltaSize = v.delta ? { x: v.delta.x, y: v.delta.y } : { x: 0, y: 0 };
  k.net = netRefOf(v.net, nets);
  k.pinFunction = v.pinFunction ?? '';
  k.pinType = v.pinType ?? '';
  k.property =
    (Object.entries(PAD_PROPERTY).find(
      ([, word]) => word === v.padProperty,
    )?.[0] as KPad['property']) ?? 'none';
  if (v.shape === 'custom') {
    s.anchorShape = v.anchorShape === 'rect' ? 'rectangle' : 'circle';
    if (!samePrimitives(primitivesView(all.customShapes), v.primitives))
      all.customShapes = primitivesOfView(v.primitives ?? []);
  }
  fcu.clearance = v.localClearance;
  ps.frontOuterLayers.solderMaskMargin = v.localSolderMaskMargin;
  ps.backOuterLayers.solderMaskMargin = v.localSolderMaskMargin;
  ps.frontOuterLayers.solderPasteMargin = v.localSolderPasteMargin;
  ps.backOuterLayers.solderPasteMargin = v.localSolderPasteMargin;
  ps.frontOuterLayers.solderPasteMarginRatio = v.localSolderPasteMarginRatio;
  ps.backOuterLayers.solderPasteMarginRatio = v.localSolderPasteMarginRatio;
  fcu.zoneConnection =
    v.zoneConnection !== undefined ? ZONE_CONNECTION_CODE[v.zoneConnection] : undefined;
  fcu.thermalSpokeWidth = v.thermalBridgeWidth;
  fcu.thermalGap = v.thermalGap;
  if (
    v.thermalSpokeAngle !== undefined &&
    padstackThermalSpokeAngle(ps, F_Cu) !== v.thermalSpokeAngle
  )
    all.thermalSpokeAngle = v.thermalSpokeAngle;
  k.padToDieLength = v.padToDieLength ?? 0;
  applyDrillSlot(ps.secondaryDrill, v.backdrill);
  applyDrillSlot(ps.tertiaryDrill, v.tertiaryDrill);
  applyPostMachining(ps.frontPostMachining, v.frontPostMachining);
  applyPostMachining(ps.backPostMachining, v.backPostMachining);
  k.teardrops = v.teardrops ? { ...v.teardrops } : defaultTeardropParams();
  ps.unconnectedLayerMode = v.unconnectedLayerMode ?? 'keep_all';
  if (v.uuid) k.uuid = v.uuid;
}

function padOfView(
  v: PcbPad,
  t: FpTransform | null,
  nets: Map<number, string>,
  copperLayerCount: number,
): KPad {
  const k = v.k ?? newPad();
  applyPad(k, v, t, nets, copperLayerCount);
  return k;
}

// ---------------------------------------------------------------------------
// Tracks, arcs, vias
// ---------------------------------------------------------------------------

function trackView(k: KPcbTrack): PcbTrack {
  return {
    start: k.start,
    end: k.end,
    width: k.width,
    layer: layerName(k.layer),
    net: k.net?.code ?? 0,
    maskLayer: maskLayerNameOf(k),
    solderMaskMargin: k.solderMaskMargin,
    locked: k.locked,
    uuid: k.uuid,
    source: NO_SOURCE,
    k,
  };
}

function arcView(k: KPcbTrack): PcbArcTrack {
  return { ...trackView(k), mid: k.mid! } as PcbArcTrack;
}

function applyTrack(k: KPcbTrack, v: PcbTrack | PcbArcTrack, nets: Map<number, string>): void {
  k.start = v.start;
  k.end = v.end;
  if ('mid' in v) k.mid = v.mid;
  k.width = v.width;
  if (layerName(k.layer) !== v.layer) k.layer = layerId(v.layer);
  k.hasSolderMask = v.maskLayer !== undefined;
  k.solderMaskMargin = v.solderMaskMargin;
  k.net = netRefOf(v.net, nets);
  k.locked = v.locked ?? false;
  if (v.uuid) k.uuid = v.uuid;
}

function newTrack(type: 'segment' | 'arc'): KPcbTrack {
  return {
    type,
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    ...(type === 'arc' ? { mid: { x: 0, y: 0 } } : {}),
    width: 0,
    locked: false,
    layer: F_Cu,
    hasSolderMask: false,
    net: null,
    uuid: newKiid(),
  };
}

const viaOptView = (
  front: boolean | undefined,
  back: boolean | undefined,
): { front?: boolean; back?: boolean } | undefined =>
  front === undefined && back === undefined ? undefined : { front, back };

function viaView(k: KPcbVia): PcbVia {
  const ps = k.padstack;
  return {
    at: k.at,
    size: copperLayerPropsConst(ps, F_Cu).shape.size.x,
    drill: k.drill === UNDEFINED_DRILL_DIAMETER ? 0 : k.drill,
    layers: [layerName(k.layer1), layerName(k.layer2)],
    kind: k.viaType,
    net: k.net?.code ?? 0,
    teardrops: teardropsView(k.teardrops),
    tenting: viaOptView(ps.frontOuterLayers.hasSolderMask, ps.backOuterLayers.hasSolderMask),
    covering: viaOptView(ps.frontOuterLayers.hasCovering, ps.backOuterLayers.hasCovering),
    plugging: viaOptView(ps.frontOuterLayers.hasPlugging, ps.backOuterLayers.hasPlugging),
    capping: ps.drill.isCapped,
    filling: ps.drill.isFilled,
    backdrill: drillSlotView(ps.secondaryDrill),
    tertiaryDrill: drillSlotView(ps.tertiaryDrill),
    frontPostMachining: postMachiningView(ps.frontPostMachining),
    backPostMachining: postMachiningView(ps.backPostMachining),
    unconnectedLayerMode:
      ps.unconnectedLayerMode === 'keep_all' ? undefined : ps.unconnectedLayerMode,
    locked: k.locked,
    uuid: k.uuid,
    source: NO_SOURCE,
    k,
  };
}

function applyVia(k: KPcbVia, v: PcbVia, nets: Map<number, string>): void {
  const ps = k.padstack;
  k.at = v.at;
  const all = copperLayerProps(ps, PADSTACK_ALL_LAYERS);
  all.shape.size = { x: v.size, y: v.size };
  if (!(k.drill === UNDEFINED_DRILL_DIAMETER && v.drill === 0)) k.drill = v.drill;
  ps.drill.size = { x: k.drill, y: k.drill };
  if (
    layerName(k.layer1) !== v.layers[0] ||
    layerName(k.layer2) !== v.layers[1] ||
    k.viaType !== v.kind
  ) {
    k.viaType = v.kind;
    viaSetLayerPair(k, layerId(v.layers[0]), layerId(v.layers[1]));
  }
  k.net = netRefOf(v.net, nets);
  k.teardrops = v.teardrops ? { ...v.teardrops } : defaultTeardropParams();
  ps.frontOuterLayers.hasSolderMask = v.tenting?.front;
  ps.backOuterLayers.hasSolderMask = v.tenting?.back;
  ps.frontOuterLayers.hasCovering = v.covering?.front;
  ps.backOuterLayers.hasCovering = v.covering?.back;
  ps.frontOuterLayers.hasPlugging = v.plugging?.front;
  ps.backOuterLayers.hasPlugging = v.plugging?.back;
  ps.drill.isCapped = v.capping;
  ps.drill.isFilled = v.filling;
  applyDrillSlot(ps.secondaryDrill, v.backdrill);
  applyDrillSlot(ps.tertiaryDrill, v.tertiaryDrill);
  applyPostMachining(ps.frontPostMachining, v.frontPostMachining);
  applyPostMachining(ps.backPostMachining, v.backPostMachining);
  ps.unconnectedLayerMode = v.unconnectedLayerMode ?? 'keep_all';
  k.locked = v.locked ?? false;
  if (v.uuid) k.uuid = v.uuid;
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

const PAD_CONNECTION_WORD: Record<number, NonNullable<PcbZone['padConnection']>> = {
  0: 'none',
  1: 'thermal',
  2: 'full',
  3: 'thru_hole_only',
};
const PAD_CONNECTION_CODE: Record<NonNullable<PcbZone['padConnection']>, number> = {
  none: 0,
  thermal: 1,
  full: 2,
  thru_hole_only: 3,
};

function zoneFillsView(polys: readonly KZoneFilledPolygon[]): PcbZoneFill[] {
  const fills: PcbZoneFill[] = [];
  for (const fp of polys) {
    const pts = pointsOf(fp.outline, null);
    if (pts.length < 3) continue;
    const layer = layerName(fp.layer);
    const existing = fills.find((f) => f.layer === layer);
    if (existing) existing.polys.push(pts);
    else fills.push({ layer, polys: [pts] });
  }
  return fills;
}

const sameFills = (a: readonly PcbZoneFill[], b: readonly PcbZoneFill[]): boolean =>
  a.length === b.length &&
  a.every((f, i) => {
    const g = b[i]!;
    return (
      f.layer === g.layer &&
      f.polys.length === g.polys.length &&
      f.polys.every((p, j) => sameVecs(p, g.polys[j]))
    );
  });

function zoneView(k: KZone, copperLayerCount: number): PcbZone {
  const outline = k.outline[0] ? pointsOf(k.outline[0], null) : [];
  // "The first polygon is the main outline. Others are holes inside the main outline."
  const holes = k.outline
    .slice(1)
    .map((h) => pointsOf(h, null))
    .filter((h) => h.length >= 3);
  const layerProperties: Record<string, { x: number; y: number }> = {};
  for (const [layer, props] of k.layerProperties) {
    if (props.hatchingOffset) layerProperties[layerName(layer)] = { ...props.hatchingOffset };
  }
  return {
    net: k.net?.code ?? 0,
    netName: k.net?.name,
    name: k.name || undefined,
    layers:
      k.layerSet.count() > 1
        ? layerTokens(k.layerSet, copperLayerCount, true)
        : k.layerSet.Seq().map(layerName),
    fills: zoneFillsView(k.filledPolygons),
    outline: outline.length >= 3 ? outline : undefined,
    ...(holes.length ? { holes } : {}),
    hatchStyle: k.isTeardropArea ? 'invisible' : k.hatchStyle,
    hatchPitch: k.hatchPitch,
    padConnection: PAD_CONNECTION_WORD[k.padConnection] ?? 'thermal',
    clearance: k.localClearance,
    minThickness: k.minThickness,
    thermalGap: k.thermalReliefGap,
    thermalBridgeWidth: k.thermalReliefSpokeWidth,
    cornerSmoothing:
      k.cornerSmoothingType === 1 ? 'chamfer' : k.cornerSmoothingType === 2 ? 'fillet' : 'none',
    cornerRadius: k.cornerRadius,
    fillMode: k.fillMode === 'hatch_pattern' ? 'hatch' : 'solid',
    hatchThickness: k.hatchThickness,
    hatchGap: k.hatchGap,
    hatchOrientation: k.hatchOrientation,
    hatchSmoothingLevel: k.hatchSmoothingLevel,
    hatchSmoothingValue: k.hatchSmoothingValue,
    hatchHoleMinArea: k.hatchHoleMinArea,
    layerProperties: Object.keys(layerProperties).length ? layerProperties : undefined,
    filled: k.isFilled,
    islandRemovalMode:
      k.islandRemovalMode === 1 ? 'never' : k.islandRemovalMode === 2 ? 'area' : 'always',
    // Stored in mm², not IU: upstream divides by IU_PER_MM when writing it.
    islandAreaMin: k.minIslandArea / pcbIUScale.IU_PER_MM,
    priority: k.priority,
    teardropType: k.isTeardropArea
      ? k.teardropType === 'padvia'
        ? 'viapad'
        : 'trackend'
      : undefined,
    ruleArea: k.isRuleArea
      ? {
          tracks: k.doNotAllowTracks,
          vias: k.doNotAllowVias,
          pads: k.doNotAllowPads,
          copperPour: k.doNotAllowZoneFills,
          footprints: k.doNotAllowFootprints,
        }
      : undefined,
    placementArea: k.isRuleArea
      ? {
          enabled: k.placementEnabled,
          sourceType: (k.placementSourceType === 'design_block'
            ? 'sheetname'
            : k.placementSourceType) as PlacementSourceType,
          source: k.placementSource,
        }
      : undefined,
    locked: k.locked,
    uuid: k.uuid,
    source: NO_SOURCE,
    k,
  };
}

function applyZone(
  k: KZone,
  v: PcbZone,
  nets: Map<number, string>,
  copperLayerCount: number,
): void {
  k.net = netRefOf(v.net, nets);
  k.name = v.name ?? '';
  const derivedLayers =
    k.layerSet.count() > 1
      ? layerTokens(k.layerSet, copperLayerCount, true)
      : k.layerSet.Seq().map(layerName);
  if (!sameStrings(derivedLayers, v.layers)) k.layerSet = layerSetOfTokens(v.layers);
  if (!sameFills(zoneFillsView(k.filledPolygons), v.fills)) {
    k.filledPolygons = [];
    for (const f of v.fills) {
      const layer = layerId(f.layer);
      for (const poly of f.polys)
        k.filledPolygons.push({ layer, island: false, outline: outlineOf(poly, null) });
    }
  }
  const derivedOutline = k.outline[0] ? pointsOf(k.outline[0], null) : [];
  const derivedHoles = k.outline
    .slice(1)
    .map((h) => pointsOf(h, null))
    .filter((h) => h.length >= 3);
  const viewOutline = v.outline ?? [];
  // `PcbZone.holes` is being added beside this; until it lands the field is read loosely.
  const viewHoles = (v as { holes?: Vec2[][] }).holes ?? [];
  const sameRings =
    sameVecs(derivedOutline.length >= 3 ? derivedOutline : [], viewOutline) &&
    derivedHoles.length === viewHoles.length &&
    derivedHoles.every((h, i) => sameVecs(h, viewHoles[i]));
  if (!sameRings) {
    k.outline =
      viewOutline.length > 0
        ? [outlineOf(viewOutline, null), ...viewHoles.map((h) => outlineOf(h, null))]
        : [];
  }
  k.isTeardropArea = v.teardropType !== undefined;
  if (k.isTeardropArea) k.teardropType = v.teardropType === 'viapad' ? 'padvia' : 'track_end';
  if (v.hatchStyle !== undefined && v.hatchStyle !== 'invisible') k.hatchStyle = v.hatchStyle;
  else if (v.hatchStyle === 'invisible' && !k.isTeardropArea) k.hatchStyle = 'none';
  if (v.hatchPitch !== undefined) k.hatchPitch = v.hatchPitch;
  k.padConnection = PAD_CONNECTION_CODE[v.padConnection ?? 'thermal'];
  if (v.clearance !== undefined) k.localClearance = v.clearance;
  if (v.minThickness !== undefined) k.minThickness = v.minThickness;
  if (v.thermalGap !== undefined) k.thermalReliefGap = v.thermalGap;
  if (v.thermalBridgeWidth !== undefined) k.thermalReliefSpokeWidth = v.thermalBridgeWidth;
  k.cornerSmoothingType =
    v.cornerSmoothing === 'chamfer' ? 1 : v.cornerSmoothing === 'fillet' ? 2 : 0;
  if (v.cornerRadius !== undefined) k.cornerRadius = v.cornerRadius;
  k.fillMode = v.fillMode === 'hatch' ? 'hatch_pattern' : 'polygons';
  if (v.hatchThickness !== undefined) k.hatchThickness = v.hatchThickness;
  if (v.hatchGap !== undefined) k.hatchGap = v.hatchGap;
  if (v.hatchOrientation !== undefined) k.hatchOrientation = v.hatchOrientation;
  if (v.hatchSmoothingLevel !== undefined) k.hatchSmoothingLevel = v.hatchSmoothingLevel;
  if (v.hatchSmoothingValue !== undefined) k.hatchSmoothingValue = v.hatchSmoothingValue;
  if (v.hatchHoleMinArea !== undefined) k.hatchHoleMinArea = v.hatchHoleMinArea;
  {
    const next = new Map(k.layerProperties);
    const wanted = v.layerProperties ?? {};
    for (const [layer, props] of next) {
      const name = layerName(layer);
      if (!(name in wanted)) next.set(layer, { ...props, hatchingOffset: undefined });
    }
    for (const [name, xy] of Object.entries(wanted)) {
      const id = layerId(name);
      const prev = next.get(id) ?? {};
      next.set(id, { ...prev, hatchingOffset: { x: xy.x, y: xy.y } });
    }
    k.layerProperties = next;
  }
  k.isFilled = v.filled ?? false;
  k.islandRemovalMode =
    v.islandRemovalMode === 'never' ? 1 : v.islandRemovalMode === 'area' ? 2 : 0;
  if (v.islandAreaMin !== undefined) k.minIslandArea = v.islandAreaMin * pcbIUScale.IU_PER_MM;
  k.priority = v.priority ?? 0;
  k.isRuleArea = v.ruleArea !== undefined || v.placementArea !== undefined;
  if (v.ruleArea) {
    k.doNotAllowTracks = v.ruleArea.tracks;
    k.doNotAllowVias = v.ruleArea.vias;
    k.doNotAllowPads = v.ruleArea.pads;
    k.doNotAllowZoneFills = v.ruleArea.copperPour;
    k.doNotAllowFootprints = v.ruleArea.footprints;
  }
  if (v.placementArea) {
    k.placementEnabled = v.placementArea.enabled;
    k.placementSourceType = v.placementArea.sourceType;
    k.placementSource = v.placementArea.source;
  }
  k.locked = v.locked ?? false;
  if (v.uuid) k.uuid = v.uuid;
}

function zoneOfView(
  v: PcbZone,
  inFootprint: boolean,
  nets: Map<number, string>,
  copperLayerCount: number,
): KZone {
  const k = v.k ?? newZone(inFootprint);
  applyZone(k, v, nets, copperLayerCount);
  return k;
}

// ---------------------------------------------------------------------------
// Text boxes, tables, images, dimensions, barcodes, points, groups
// ---------------------------------------------------------------------------

function textBoxView(k: KPcbTextBox, t: FpTransform | null): PcbTextBox {
  const box: PcbTextBox = {
    text: k.text,
    margins: { left: k.marginLeft, top: k.marginTop, right: k.marginRight, bottom: k.marginBottom },
    angle: k.angle !== 0 ? k.angle : undefined,
    layer: layerName(k.layer),
    uuid: k.uuid,
    face: k.fontName || undefined,
    size: { x: k.size.x, y: k.size.y },
    thickness: k.autoThickness ? undefined : k.thickness,
    bold: k.bold,
    italic: k.italic,
    justify: justifyWords(k),
    border: k.borderEnabled,
    strokeWidth: k.stroke.width,
    strokeType: k.stroke.type,
    knockout: k.knockout,
    locked: k.locked,
    source: NO_SOURCE,
    k,
  };
  if (k.shape === 'rectangle') {
    box.start = toBoard(k.start, t);
    box.end = toBoard(k.end, t);
  } else {
    box.pts = pointsOf(k.outline ?? [], t);
  }
  return box;
}

function applyTextBox(k: KPcbTextBox, v: PcbTextBox, t: FpTransform | null): void {
  k.text = v.text;
  if (v.start && v.end) {
    if (
      k.shape !== 'rectangle' ||
      !sameVec(toBoard(k.start, t), v.start) ||
      !sameVec(toBoard(k.end, t), v.end)
    ) {
      k.shape = 'rectangle';
      k.start = toLocal(v.start, t);
      k.end = toLocal(v.end, t);
    }
  } else if (v.pts) {
    if (k.shape !== 'poly' || !sameVecs(pointsOf(k.outline ?? [], t), v.pts)) {
      k.shape = 'poly';
      k.outline = outlineOf(v.pts, t);
    }
  }
  k.marginLeft = v.margins.left;
  k.marginTop = v.margins.top;
  k.marginRight = v.margins.right;
  k.marginBottom = v.margins.bottom;
  k.angle = v.angle ?? 0;
  if (layerName(k.layer) !== v.layer) k.layer = layerId(v.layer);
  k.fontName = v.face ?? '';
  k.size = { x: v.size.x, y: v.size.y };
  if (v.thickness === undefined) k.autoThickness = true;
  else {
    k.autoThickness = false;
    k.thickness = v.thickness;
  }
  k.bold = v.bold ?? false;
  k.italic = v.italic ?? false;
  if (!sameStrings(justifyWords(k), v.justify)) applyJustify(k, v.justify, undefined);
  k.borderEnabled = v.border;
  k.stroke = strokeOf(v.strokeWidth ?? k.stroke.width, v.strokeType, k.stroke);
  k.knockout = v.knockout ?? false;
  k.locked = v.locked ?? false;
  if (v.uuid) k.uuid = v.uuid;
}

function textBoxOfView(v: PcbTextBox, t: FpTransform | null): KPcbTextBox {
  const k = v.k ?? newTextBox();
  applyTextBox(k, v, t);
  return k;
}

function tableView(k: KPcbTable, t: FpTransform | null): PcbTable {
  const border = k.strokeExternal || k.strokeHeaderSeparator;
  const seps = k.strokeRows || k.strokeColumns;
  return {
    columnCount: k.colCount,
    layer: layerName(k.layer),
    uuid: k.uuid,
    locked: k.locked,
    borderExternal: k.strokeExternal,
    borderHeader: k.strokeHeaderSeparator,
    borderWidth: border ? k.borderStroke.width : undefined,
    borderStyle: border ? k.borderStroke.type : undefined,
    separatorRows: k.strokeRows,
    separatorCols: k.strokeColumns,
    separatorWidth: seps ? k.separatorsStroke.width : undefined,
    separatorStyle: seps ? k.separatorsStroke.type : undefined,
    columnWidths: [...k.colWidths],
    rowHeights: [...k.rowHeights],
    cells: k.cells.map(
      (c) =>
        ({ ...textBoxView(c, t), colSpan: c.colSpan, rowSpan: c.rowSpan, k: c }) as PcbTableCell,
    ),
    source: NO_SOURCE,
    k,
  };
}

function applyTable(k: KPcbTable, v: PcbTable, t: FpTransform | null): void {
  k.colCount = v.columnCount;
  if (layerName(k.layer) !== v.layer) k.layer = layerId(v.layer);
  k.locked = v.locked ?? false;
  k.strokeExternal = v.borderExternal;
  k.strokeHeaderSeparator = v.borderHeader;
  if (v.borderWidth !== undefined)
    k.borderStroke = strokeOf(v.borderWidth, v.borderStyle, k.borderStroke);
  k.strokeRows = v.separatorRows;
  k.strokeColumns = v.separatorCols;
  if (v.separatorWidth !== undefined)
    k.separatorsStroke = strokeOf(v.separatorWidth, v.separatorStyle, k.separatorsStroke);
  k.colWidths = [...v.columnWidths];
  k.rowHeights = [...v.rowHeights];
  k.cells = v.cells.map((c) => {
    const cell = (c.k as KPcbTableCell | undefined) ?? { ...newTextBox(), colSpan: 1, rowSpan: 1 };
    applyTextBox(cell, c, t);
    cell.colSpan = c.colSpan;
    cell.rowSpan = c.rowSpan;
    return cell;
  });
  if (v.uuid) k.uuid = v.uuid;
}

function imageView(k: KPcbReferenceImage): PcbImage {
  return {
    at: k.pos,
    layer: layerName(k.layer),
    scale: k.scale !== 1.0 ? k.scale : undefined,
    locked: k.locked,
    data: k.data,
    uuid: k.uuid,
    source: NO_SOURCE,
    k,
  };
}

function applyImage(k: KPcbReferenceImage, v: PcbImage): void {
  k.pos = v.at;
  if (layerName(k.layer) !== v.layer) k.layer = layerId(v.layer);
  k.scale = v.scale ?? 1.0;
  k.locked = v.locked ?? false;
  k.data = v.data;
  if (v.uuid) k.uuid = v.uuid;
}

function dimensionView(k: KPcbDimension, t: FpTransform | null): PcbDimension {
  const aligned = k.type === 'aligned' || k.type === 'orthogonal';
  const center = k.type === 'center';
  const format: DimensionFormat | undefined = center
    ? undefined
    : {
        prefix: k.prefix,
        suffix: k.suffix,
        units: k.unitsMode as DimUnitsMode,
        unitsFormat: k.unitsFormat as DimUnitsFormat,
        precision: k.precision as DimPrecision,
        overrideValue: k.overrideTextEnabled ? k.overrideText : undefined,
        suppressZeroes: k.suppressZeroes,
      };
  const style: DimensionStyle = {
    thickness: k.lineThickness,
    arrowLength: k.arrowLength,
    textPositionMode: k.textPositionMode as DimTextPosition,
    arrowDirection: aligned ? k.arrowDirection : undefined,
    extensionHeight: aligned ? k.extensionHeight : undefined,
    textFrame: k.type === 'leader' ? (k.textBorder as DimTextBorder) : undefined,
    extensionOffset: k.extensionOffset,
    keepTextAligned: k.keepTextAligned,
  };
  return {
    kind: k.type,
    layer: layerName(k.layer),
    locked: k.locked,
    uuid: k.uuid,
    start: k.start,
    end: k.end,
    height: aligned ? k.height : undefined,
    leaderLength: k.type === 'radial' ? k.leaderLength : undefined,
    orientation: k.type === 'orthogonal' ? k.orientation : undefined,
    format,
    style,
    text: center ? undefined : textView(k.text, 'user', null),
    source: NO_SOURCE,
    k,
  };
}

function applyDimension(k: KPcbDimension, v: PcbDimension, t: FpTransform | null): void {
  void t;
  k.type = v.kind;
  if (layerName(k.layer) !== v.layer) k.layer = layerId(v.layer);
  k.locked = v.locked ?? false;
  k.start = v.start;
  k.end = v.end;
  if (v.height !== undefined) k.height = v.height;
  if (v.leaderLength !== undefined) k.leaderLength = v.leaderLength;
  if (v.orientation !== undefined) k.orientation = v.orientation;
  if (v.format) {
    k.prefix = v.format.prefix;
    k.suffix = v.format.suffix;
    k.unitsMode = v.format.units;
    k.unitsFormat = v.format.unitsFormat;
    k.precision = v.format.precision;
    k.overrideTextEnabled = v.format.overrideValue !== undefined;
    k.overrideText = v.format.overrideValue ?? '';
    k.suppressZeroes = v.format.suppressZeroes ?? false;
  }
  k.lineThickness = v.style.thickness;
  k.arrowLength = v.style.arrowLength;
  k.textPositionMode = v.style.textPositionMode;
  if (v.style.arrowDirection) k.arrowDirection = v.style.arrowDirection;
  if (v.style.extensionHeight !== undefined) k.extensionHeight = v.style.extensionHeight;
  if (v.style.textFrame !== undefined) k.textBorder = v.style.textFrame;
  k.extensionOffset = v.style.extensionOffset;
  if (v.style.keepTextAligned !== undefined) k.keepTextAligned = v.style.keepTextAligned;
  if (v.text) {
    applyText(k.text, v.text, null, k.text.text);
    k.text.layer = k.layer;
    k.text.uuid = k.uuid;
    k.text.locked = k.locked;
  }
  if (v.uuid) k.uuid = v.uuid;
}

const BARCODE_KIND: Record<KPcbBarcode['kind'], BarcodeKind> = {
  code39: 'code39',
  code128: 'code128',
  datamatrix: 'datamatrix',
  qr: 'qr',
  microqr: 'microqr',
};

function barcodeView(k: KPcbBarcode): PcbBarcode {
  return {
    at: k.pos,
    angle: k.angle,
    layer: layerName(k.layer),
    width: k.width,
    height: k.height,
    text: k.text,
    textHeight: k.textHeight,
    kind: BARCODE_KIND[k.kind],
    ecc: k.ecc as BarcodeEcc,
    showText: k.showText,
    knockout: k.knockout,
    margin: k.margin,
    uuid: k.uuid,
    locked: k.locked,
    source: NO_SOURCE,
    k,
  };
}

function applyBarcode(k: KPcbBarcode, v: PcbBarcode): void {
  k.pos = v.at;
  k.angle = v.angle;
  if (layerName(k.layer) !== v.layer) k.layer = layerId(v.layer);
  k.width = v.width;
  k.height = v.height;
  k.text = v.text;
  k.textHeight = v.textHeight;
  k.kind = v.kind;
  k.ecc = v.ecc;
  k.showText = v.showText;
  k.knockout = v.knockout;
  k.margin = v.margin;
  k.locked = v.locked ?? false;
  if (v.uuid) k.uuid = v.uuid;
}

function pointView(k: KPcbPoint): PcbPoint {
  return {
    at: k.pos,
    size: k.size,
    layer: layerName(k.layer),
    uuid: k.uuid,
    locked: k.locked,
    source: NO_SOURCE,
    k,
  };
}

function applyPoint(k: KPcbPoint, v: PcbPoint): void {
  k.pos = v.at;
  k.size = v.size;
  if (layerName(k.layer) !== v.layer) k.layer = layerId(v.layer);
  k.locked = v.locked ?? false;
  if (v.uuid) k.uuid = v.uuid;
}

function groupView(k: KPcbGroup): PcbGroup {
  return {
    name: k.name,
    uuid: k.uuid,
    locked: k.locked,
    members: [...k.memberUuids],
    source: NO_SOURCE,
    k,
  };
}

function applyGroup(k: KPcbGroup, v: PcbGroup): void {
  k.name = v.name;
  k.locked = v.locked ?? false;
  if (!sameStrings(k.memberUuids, v.members)) k.memberUuids = [...v.members];
  if (v.uuid) k.uuid = v.uuid;
}

function modelView(m: KFp3DModel): Model3D {
  return {
    path: m.filename,
    offset: { ...m.offset },
    scale: { ...m.scale },
    rotate: { ...m.rotation },
    hide: !m.show,
    ...(m.opacity < 1 ? { opacity: m.opacity } : {}),
  };
}

function modelOfView(v: Model3D): KFp3DModel {
  return {
    filename: v.path,
    show: !v.hide,
    opacity: v.opacity ?? 1.0,
    offset: { ...v.offset },
    scale: { ...v.scale },
    rotation: { ...v.rotate },
  };
}

// ---------------------------------------------------------------------------
// Footprints
// ---------------------------------------------------------------------------

/** The `(attr …)` words `format( FOOTPRINT )` writes, in its order. */
function attrWords(k: KFootprint): string[] | undefined {
  const words: string[] = [];
  if (k.attributes & FP_SMD) words.push('smd');
  if (k.attributes & FP_THROUGH_HOLE) words.push('through_hole');
  if (k.attributes & FP_BOARD_ONLY) words.push('board_only');
  if (k.attributes & FP_EXCLUDE_FROM_POS_FILES) words.push('exclude_from_pos_files');
  if (k.attributes & FP_EXCLUDE_FROM_BOM) words.push('exclude_from_bom');
  if (k.allowMissingCourtyard) words.push('allow_missing_courtyard');
  if (k.attributes & FP_DNP) words.push('dnp');
  if (k.allowSolderMaskBridges) words.push('allow_soldermask_bridges');
  return words.length > 0 ? words : undefined;
}

function applyAttrWords(k: KFootprint, words: readonly string[] | undefined): void {
  const w = words ?? [];
  let bits = 0;
  if (w.includes('smd')) bits |= FP_SMD;
  if (w.includes('through_hole')) bits |= FP_THROUGH_HOLE;
  if (w.includes('board_only')) bits |= FP_BOARD_ONLY;
  if (w.includes('exclude_from_pos_files')) bits |= FP_EXCLUDE_FROM_POS_FILES;
  if (w.includes('exclude_from_bom')) bits |= FP_EXCLUDE_FROM_BOM;
  if (w.includes('dnp')) bits |= FP_DNP;
  k.attributes = bits;
  k.allowMissingCourtyard = w.includes('allow_missing_courtyard');
  k.allowSolderMaskBridges = w.includes('allow_soldermask_bridges');
}

/** `FOOTPRINT::ResolveTextVar` for the two names the old reader resolved on a board. */
function shownText(
  text: string,
  fp: { reference?: string; value?: string },
  local: boolean,
): string {
  if (local || !text.includes('${')) return text;
  return text.replaceAll('${REFERENCE}', fp.reference ?? '').replaceAll('${VALUE}', fp.value ?? '');
}

function footprintView(k: KFootprint, copperLayerCount: number, local = false): PcbFootprint {
  const angle = local ? 0 : k.orientation;
  const t: FpTransform | null = local ? null : { pos: k.at, angle };
  const fp: PcbFootprint = {
    lib: k.fpid,
    at: local ? { x: 0, y: 0 } : k.at,
    angle,
    layer: layerName(k.layer),
    descr: k.libDescription || undefined,
    tags: k.keywords || undefined,
    attributes: attrWords(k),
    netTiePadGroups: k.netTiePadGroups.length > 0 ? [...k.netTiePadGroups] : undefined,
    localClearance: k.localClearance,
    localSolderMaskMargin: k.localSolderMaskMargin,
    localSolderPasteMargin: k.localSolderPasteMargin,
    localSolderPasteMarginRatio: k.localSolderPasteMarginRatio,
    zoneConnection:
      k.localZoneConnection !== -1 ? zoneConnectionFromCode(k.localZoneConnection) : undefined,
    locked: k.locked,
    path: k.path || undefined,
    sheetname: k.sheetname || undefined,
    sheetfile: k.sheetfile || undefined,
    filters: k.filters || undefined,
    fields: [],
    pads: [],
    shapes: [],
    texts: [],
    points: [],
    barcodes: [],
    models: [],
    uuid: k.uuid,
    source: NO_SOURCE,
    k,
  };
  for (const field of k.fields) {
    if (field.fieldId === 'reference' || field.fieldId === 'value') {
      fp.texts.push(textView(field, field.fieldId, t));
      if (field.fieldId === 'reference') fp.reference = field.text;
      else fp.value = field.text;
    } else {
      fp.fields!.push({
        name: fieldCanonicalName(field),
        value: field.text,
        source: NO_SOURCE,
        k: field,
      });
    }
  }
  for (const gr of k.graphicalItems) {
    if (gr.kind === 'shape') fp.shapes.push(shapeView(gr.item, t));
    else if (gr.kind === 'text') fp.texts.push(textView(gr.item, 'user', t));
    else if (gr.kind === 'barcode') fp.barcodes.push(barcodeView(gr.item));
  }
  for (const pad of k.pads) fp.pads.push(padView(pad, t, copperLayerCount));
  for (const pt of k.points) fp.points.push(pointView(pt));
  for (const m of k.models) fp.models.push(modelView(m));
  // KiCad resolves text variables when rendering; ${REFERENCE}/${VALUE} are by
  // far the common ones on Fab layers — but not on a footprint-holder board.
  for (const tx of fp.texts) tx.text = shownText(tx.text, fp, local);
  return fp;
}

function applyFootprint(
  k: KFootprint,
  v: PcbFootprint,
  nets: Map<number, string>,
  copperLayerCount: number,
  seen: Set<object>,
): void {
  const t: FpTransform = { pos: v.at, angle: v.angle };
  k.fpid = v.lib;
  k.at = v.at;
  k.orientation = v.angle;
  if (layerName(k.layer) !== v.layer) k.layer = layerId(v.layer);
  k.libDescription = v.descr ?? '';
  k.keywords = v.tags ?? '';
  if (!sameStrings(attrWords(k), v.attributes)) applyAttrWords(k, v.attributes);
  k.netTiePadGroups = v.netTiePadGroups ? [...v.netTiePadGroups] : [];
  k.localClearance = v.localClearance;
  k.localSolderMaskMargin = v.localSolderMaskMargin;
  k.localSolderPasteMargin = v.localSolderPasteMargin;
  k.localSolderPasteMarginRatio = v.localSolderPasteMarginRatio;
  k.localZoneConnection =
    v.zoneConnection !== undefined ? ZONE_CONNECTION_CODE[v.zoneConnection] : -1;
  k.locked = v.locked ?? false;
  k.path = v.path ?? '';
  k.sheetname = v.sheetname ?? '';
  k.sheetfile = v.sheetfile ?? '';
  k.filters = v.filters ?? '';
  if (v.uuid) k.uuid = v.uuid;

  // Fields: the two mandatory texts from `texts`, the rest from `fields`; the
  // model's other mandatory fields (Datasheet, Description) appear in `fields`.
  const shown = { reference: v.reference, value: v.value };
  const fields: KPcbField[] = [];
  const mandatory = new Map<string, KPcbField>();
  for (const f of k.fields) if (f.fieldId !== 'user') mandatory.set(f.fieldId, f);
  const byRole = (role: 'reference' | 'value', tx: PcbTextItem | undefined): void => {
    const base = mandatory.get(role) ?? {
      ...newPcbText({ at: v.at, layer: k.layer }),
      fieldId: role,
      name: '',
    };
    if (tx) applyText(base, tx, t, shownText(base.text, shown, false));
    const wanted = role === 'reference' ? v.reference : v.value;
    if (wanted !== undefined && wanted !== base.text && (!tx || tx.text === base.text))
      base.text = wanted;
    fields.push(base);
  };
  byRole(
    'reference',
    v.texts.find((x) => x.kind === 'reference'),
  );
  byRole(
    'value',
    v.texts.find((x) => x.kind === 'value'),
  );
  const rest = new Map<string, KPcbField>();
  for (const f of k.fields)
    if (f.fieldId !== 'reference' && f.fieldId !== 'value') rest.set(fieldCanonicalName(f), f);
  const placed = new Set<KPcbField>();
  for (const f of v.fields ?? []) {
    let kf = f.k ?? rest.get(f.name);
    if (!kf || placed.has(kf)) {
      kf = {
        ...newPcbText({ at: v.at, layer: k.layer }),
        fieldId: 'user',
        name: f.name,
        visible: false,
      };
      kf.layer = F_Cu === k.layer ? kf.layer : kf.layer;
    }
    kf.text = f.value;
    if (kf.fieldId === 'user') kf.name = f.name;
    placed.add(kf);
    fields.push(kf);
  }
  // Mandatory fields the view does not list (Datasheet, Description) stay.
  for (const f of k.fields) {
    if (f.fieldId === 'datasheet' || f.fieldId === 'description') {
      if (!placed.has(f)) fields.splice(2, 0, f);
    }
  }
  k.fields = fields;

  // Graphical items: shapes, user texts and barcodes from the view; the kinds
  // the view does not model keep their place.
  const graphical: KFpGraphicalItem[] = [];
  for (const s of v.shapes)
    graphical.push({ kind: 'shape', item: dedupe(shapeOfView(s, t, nets), seen) });
  for (const tx of v.texts) {
    if (tx.kind !== 'user') continue;
    const kt = tx.k ?? newPcbText({ at: v.at, layer: k.layer });
    applyText(kt, tx, t, shownText(kt.text, shown, false));
    graphical.push({ kind: 'text', item: dedupe(kt, seen) });
  }
  for (const b of v.barcodes) {
    const kb = b.k ?? newBarcode();
    applyBarcode(kb, b);
    graphical.push({ kind: 'barcode', item: dedupe(kb, seen) });
  }
  for (const gr of k.graphicalItems) {
    if (
      gr.kind === 'textbox' ||
      gr.kind === 'table' ||
      gr.kind === 'image' ||
      gr.kind === 'dimension'
    )
      graphical.push(gr);
  }
  k.graphicalItems = graphical;
  k.pads = v.pads.map((p) => dedupe(padOfView(p, t, nets, copperLayerCount), seen));
  k.points = v.points.map((p) => {
    const kp = p.k ?? newPoint();
    applyPoint(kp, p);
    return dedupe(kp, seen);
  });
  k.models = v.models.map(modelOfView);
}

function newBarcode(): KPcbBarcode {
  return {
    locked: false,
    pos: { x: 0, y: 0 },
    angle: 0,
    layer: 17, // Dwgs_User
    width: pcbIUScale.mmToIU(40),
    height: pcbIUScale.mmToIU(40),
    text: '',
    textHeight: pcbIUScale.mmToIU(1.27),
    kind: 'qr',
    ecc: 'L',
    showText: true,
    knockout: false,
    margin: { x: 0, y: 0 },
    uuid: newKiid(),
  };
}

function newPoint(): KPcbPoint {
  return {
    pos: { x: 0, y: 0 },
    size: pcbIUScale.mmToIU(1.0),
    layer: F_Cu,
    uuid: newKiid(),
    locked: false,
  };
}

function newGroup(): KPcbGroup {
  return { name: '', uuid: newKiid(), locked: false, libId: '', memberUuids: [] };
}

function newImage(): KPcbReferenceImage {
  return { pos: { x: 0, y: 0 }, layer: F_Cu, scale: 1.0, locked: false, data: '', uuid: newKiid() };
}

function newTable(): KPcbTable {
  return {
    colCount: 0,
    uuid: newKiid(),
    locked: false,
    layer: F_Cu,
    strokeExternal: false,
    strokeHeaderSeparator: false,
    borderStroke: { width: 0, type: 'default' },
    strokeRows: false,
    strokeColumns: false,
    separatorsStroke: { width: 0, type: 'default' },
    colWidths: [],
    rowHeights: [],
    cells: [],
  };
}

function newDimension(): KPcbDimension {
  const arrowLength = pcbIUScale.milsToIU(50);
  return {
    type: 'aligned',
    locked: false,
    layer: 17,
    uuid: newKiid(),
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    height: 0,
    leaderLength: 0,
    orientation: 0,
    prefix: '',
    suffix: '',
    unitsMode: 0,
    unitsFormat: 1,
    precision: 4,
    overrideTextEnabled: false,
    overrideText: '',
    suppressZeroes: false,
    lineThickness: pcbIUScale.mmToIU(0.2),
    arrowLength,
    textPositionMode: 0,
    arrowDirection: 'outward',
    extensionHeight: Math.trunc(arrowLength * Math.sin((27.5 * Math.PI) / 180)),
    textBorder: 0,
    extensionOffset: 0,
    keepTextAligned: true,
    text: newPcbText(null),
    autoUnits: false,
  };
}

/**
 * A K item reached from two view items (a duplicate made by spreading the
 * view) is cloned for the second, so each view item writes its own.
 */
function dedupe<T extends object>(k: T, seen: Set<object>): T {
  if (!seen.has(k)) {
    seen.add(k);
    return k;
  }
  const copy = structuredClone(k) as T & { uuid?: string };
  if ('uuid' in copy) copy.uuid = newKiid();
  seen.add(copy);
  return copy;
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/** `Board` as a view of the parsed model; `board.k` is the model itself. */
export function boardFromKBoard(kb: KBoard, fileName?: string): Board {
  const cu = kb.copperLayerCount;
  const board: Board = {
    version: kb.fileFormatVersionAtLoad,
    thickness: kb.designSettings.boardThickness,
    legacyTeardrops: kb.legacyTeardrops,
    paper: paperOfPageInfo(kb.pageInfo),
    titleBlock: titleBlockView(kb.titleBlock),
    layers: layerTableView(kb),
    nets: kb.netNames,
    footprints: kb.footprints.map((fp) => footprintView(fp, cu)),
    tracks: [],
    arcs: [],
    vias: [],
    zones: kb.zones.map((z) => zoneView(z, cu)),
    shapes: [],
    texts: [],
    textBoxes: [],
    tables: [],
    images: [],
    dimensions: [],
    points: kb.points.map(pointView),
    barcodes: [],
    groups: kb.groups.map(groupView),
    fileName,
    source: NO_SOURCE,
    k: kb,
  };
  for (const t of kb.tracks) {
    if (t.kind === 'via') board.vias.push(viaView(t.item));
    else if (t.item.type === 'arc') board.arcs.push(arcView(t.item));
    else board.tracks.push(trackView(t.item));
  }
  for (const d of kb.drawings) {
    switch (d.kind) {
      case 'shape':
        board.shapes.push(shapeView(d.item, null));
        break;
      case 'text':
        board.texts.push(textView(d.item, 'user', null));
        break;
      case 'textbox':
        board.textBoxes.push(textBoxView(d.item, null));
        break;
      case 'table':
        board.tables.push(tableView(d.item, null));
        break;
      case 'image':
        board.images.push(imageView(d.item));
        break;
      case 'barcode':
        board.barcodes.push(barcodeView(d.item));
        break;
      case 'dimension':
        board.dimensions.push(dimensionView(d.item, null));
        break;
      case 'target':
        break;
    }
  }
  return board;
}

/** A library `(footprint …)` in its own frame, `readFootprintFile`'s view. */
export function footprintViewOfLibrary(k: KFootprint): PcbFootprint {
  return footprintView(k, 2, true);
}

/**
 * The view written back into the model: the editor's fields where they
 * differ from what the model would show, every item list rebuilt from the
 * view's (so deleted items go, added ones get a fresh K item), and the
 * model returned for the formatter.
 */
export function kboardFromBoard(board: Board): KBoard {
  const kb = board.k ?? emptyKBoard();
  const nets = board.nets;
  kb.netNames = nets;

  // Header.
  if (board.thickness !== undefined) kb.designSettings.boardThickness = board.thickness;
  kb.legacyTeardrops = board.legacyTeardrops ?? false;
  if (board.paper !== undefined && paperOfPageInfo(kb.pageInfo) !== board.paper)
    kb.pageInfo = pageInfoOfPaper(board.paper, kb.pageInfo);
  if (!sameTitleBlock(titleBlockView(kb.titleBlock), board.titleBlock))
    kb.titleBlock = titleBlockOfView(board.titleBlock);
  if (!sameLayerRows(layerTableView(kb), board.layers)) applyLayerTable(kb, board.layers);
  const cu = kb.copperLayerCount;

  const seen = new Set<object>();

  kb.footprints = board.footprints.map((fp) => {
    const k = dedupe(fp.k ?? newFootprint(), seen);
    applyFootprint(k, fp, nets, cu, seen);
    return k;
  });

  const drawings: KBoardDrawing[] = [];
  for (const s of board.shapes)
    drawings.push({ kind: 'shape', item: dedupe(shapeOfView(s, null, nets), seen) });
  for (const tx of board.texts)
    drawings.push({ kind: 'text', item: dedupe(textOfView(tx, null, F_Cu), seen) });
  for (const tb of board.textBoxes)
    drawings.push({ kind: 'textbox', item: dedupe(textBoxOfView(tb, null), seen) });
  for (const tb of board.tables) {
    const k = dedupe(tb.k ?? newTable(), seen);
    applyTable(k, tb, null);
    drawings.push({ kind: 'table', item: k });
  }
  for (const img of board.images) {
    const k = dedupe(img.k ?? newImage(), seen);
    applyImage(k, img);
    drawings.push({ kind: 'image', item: k });
  }
  for (const b of board.barcodes) {
    const k = dedupe(b.k ?? newBarcode(), seen);
    applyBarcode(k, b);
    drawings.push({ kind: 'barcode', item: k });
  }
  for (const d of board.dimensions) {
    const k = dedupe(d.k ?? newDimension(), seen);
    applyDimension(k, d, null);
    drawings.push({ kind: 'dimension', item: k });
  }
  for (const d of kb.drawings) if (d.kind === 'target') drawings.push(d);
  kb.drawings = drawings;

  const tracks: KBoardTrack[] = [];
  for (const t of board.tracks) {
    const k = dedupe(t.k ?? newTrack('segment'), seen);
    applyTrack(k, t, nets);
    tracks.push({ kind: 'track', item: k });
  }
  for (const a of board.arcs) {
    const k = dedupe(a.k ?? newTrack('arc'), seen);
    applyTrack(k, a, nets);
    tracks.push({ kind: 'track', item: k });
  }
  for (const v of board.vias) {
    const k = dedupe(v.k ?? newVia(), seen);
    applyVia(k, v, nets);
    tracks.push({ kind: 'via', item: k });
  }
  kb.tracks = tracks;

  kb.points = board.points.map((p) => {
    const k = dedupe(p.k ?? newPoint(), seen);
    applyPoint(k, p);
    return k;
  });
  kb.zones = board.zones.map((z) => dedupe(zoneOfView(z, false, nets, cu), seen));
  kb.groups = board.groups.map((g) => {
    const k = dedupe(g.k ?? newGroup(), seen);
    applyGroup(k, g);
    return k;
  });

  // Members are resolved again: a group may now name items that went away.
  kb.groupMembers = new Map();
  resolveGroups(kb);
  return kb;
}

/** `BOARD()`: what a board built by the editor from nothing starts as — a two-layer board with nothing on it. */
function emptyKBoard(): KBoard {
  return ParseBoard(
    '(kicad_pcb (version 20260206) (generator "ziroeda") (layers (0 "F.Cu" signal) (31 "B.Cu" signal)))',
  );
}

export type { BoardDesignSettingsFile };
