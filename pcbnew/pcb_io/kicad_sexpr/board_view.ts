// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The editor's `Board` (types.ts) as a view of KiCad's own `BOARD`.
 *
 * `boardFromBOARD` derives every editor-facing field from the item classes
 * `PCB_IO_KICAD_SEXPR_PARSER` built — the same fields, in the same units and
 * frames, that the reader has always produced (footprint children
 * board-absolute, layers by canonical name, nets by code, arcs in polygons as
 * the chain's points) — and keeps the class item on each view item as `k`.
 * `boardToBOARD` writes the view back: for each item it derives the field
 * again from `k` and, only where the editor's value differs, calls the C++
 * setter the edit stands for. An untouched item therefore writes the bytes
 * it was read from, and the BOARD — not a text tree — is what
 * `PCB_IO_KICAD_SEXPR` formats.
 *
 * What the view does not model (design settings, stackup, plot parameters,
 * padstack layers other than the front, viastacks, render caches, variants,
 * embedded files, generators, a footprint's text boxes, tables and zones)
 * simply stays on the class and is written unchanged.
 */
import { EMBEDDED_FILES } from '@ziroeda/common/src/embedded_files.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/src/eda_shape.js';
import type { EDA_TEXT } from '@ziroeda/common/src/eda_text.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/src/font/text_attributes.js';
import { kiidPathAsString, kiidFromString, newKiid, type KIID } from '@ziroeda/common/src/kiid.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { LIB_ID } from '@ziroeda/common/src/lib_id.js';
import {
  MAX_PAGE_SIZE_PCBNEW_MM,
  MIN_PAGE_SIZE_MM,
  PAGE_INFO,
  PAGE_SIZE_TYPE,
} from '@ziroeda/common/src/page_info.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/src/stroke_params.js';
import { FormatDouble2Str } from '@ziroeda/common/src/string_utils.js';
import { TITLE_BLOCK } from '@ziroeda/common/src/title_block.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { ANGLE_0, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { Polygon } from '@ziroeda/kimath/src/geometry/shape_poly_set_algorithms.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Vec2, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import { FIELD_T } from '@ziroeda/common/src/template_fieldnames.js';
import { BOARD } from '../../board.js';
import { ADD_MODE, REMOVE_MODE } from '../../board_item_container.js';
import type { BOARD_ITEM } from '../../board_item.js';
import type { BOARD_CONNECTED_ITEM } from '../../board_connected_item.js';
import { LAYER, LAYER_T } from '../../board_types.js';
import {
  FOOTPRINT,
  FOOTPRINT_STACKUP,
  FP_3DMODEL,
  FP_BOARD_ONLY,
  FP_DNP,
  FP_EXCLUDE_FROM_BOM,
  FP_EXCLUDE_FROM_POS_FILES,
  FP_SMD,
  FP_THROUGH_HOLE,
} from '../../footprint.js';
import {
  B_Cu,
  B_Fab,
  B_Mask,
  F_Cu,
  F_Fab,
  F_Mask,
  IsCopperLayer,
  LSET_Name,
  LSET_NameToLayer,
  UNDEFINED_LAYER,
  User_1,
} from '../../layer_ids.js';
import { LSET } from '../../lset.js';
import { NETINFO_ITEM, NETINFO_LIST } from '../../netinfo.js';
import { PAD } from '../../pad.js';
import type { PcbDrillSlot, PcbPostMachining } from '../../padstack_drill.js';
import {
  defaultThermalSpokeAngle,
  PAD_ATTRIB,
  PAD_DRILL_POST_MACHINING_MODE,
  PAD_DRILL_SHAPE,
  PAD_PROP,
  PAD_SHAPE,
  PADSTACK,
  type PADSTACK_DRILL_PROPS,
  type PADSTACK_POST_MACHINING_PROPS,
  UNCONNECTED_LAYER_MODE,
} from '../../padstack.js';
import { BARCODE_ECC_T, BARCODE_T, PCB_BARCODE } from '../../pcb_barcode.js';
import {
  PCB_DIM_ALIGNED,
  PCB_DIM_CENTER,
  PCB_DIM_LEADER,
  PCB_DIM_ORTHOGONAL,
  PCB_DIM_RADIAL,
  type PCB_DIMENSION_BASE,
  type PCB_DIM_ORTHOGONAL_DIR,
} from '../../pcb_dimension.js';
import {
  DIM_ARROW_DIRECTION,
  type DIM_PRECISION,
  type DIM_TEXT_BORDER,
  type DIM_TEXT_POSITION,
  type DIM_UNITS_FORMAT,
  type DIM_UNITS_MODE,
} from '../../pcb_dimension_types.js';
import { PCB_FIELD } from '../../pcb_field.js';
import { PCB_GROUP } from '../../pcb_group.js';
import { PCB_POINT } from '../../pcb_point.js';
import { PCB_REFERENCE_IMAGE } from '../../pcb_reference_image.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TABLE, PCB_TABLECELL } from '../../pcb_table.js';
import { PCB_TEXT } from '../../pcb_text.js';
import { PCB_TEXTBOX } from '../../pcb_textbox.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA, UNDEFINED_DRILL_DIAMETER, VIATYPE } from '../../pcb_track.js';
import { TEARDROP_PARAMETERS } from '../../teardrop/teardrop_parameters.js';
import { TEARDROP_TYPE } from '../../teardrop/teardrop_types.js';
import { type BoardItemKind, boardItemId } from '../../edit-board.js';
import type {
  BarcodeEcc,
  BarcodeKind,
  Board,
  DimensionFormat,
  DimensionKind,
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
import { ZONE } from '../../zone.js';
import {
  ISLAND_REMOVAL_MODE,
  PLACEMENT_SOURCE_T,
  ZONE_BORDER_DISPLAY_STYLE,
  ZONE_FILL_MODE,
  ZONE_LAYER_PROPERTIES,
  ZONE_SETTINGS,
} from '../../zone_settings.js';
import { ZONE_CONNECTION } from '../../zones.js';
import { ZONE_CONNECTION_CODE, zoneConnectionFromCode } from '../../zone_connection.js';
import type { PcbFillMode } from '../../shape_fill.js';
import { base64Decode } from './pcb_io_kicad_sexpr_items.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from './pcb_io_kicad_sexpr_parser.js';

// ---------------------------------------------------------------------------
// Small conversions
// ---------------------------------------------------------------------------

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

const copyVec = (v: Vec2): VECTOR2I => ({ x: v.x, y: v.y });

const layerName = (id: number): string => (id === UNDEFINED_LAYER ? '' : LSET_Name(id));

/** A canonical layer name back to its id; an unknown name is UNDEFINED. */
const layerId = (name: string): PCB_LAYER_ID => {
  if (name === '') return UNDEFINED_LAYER as PCB_LAYER_ID;
  return LSET_NameToLayer(name) as PCB_LAYER_ID;
};

/** `GetLayerSet()`'s mask half, as the reader has always given it (`maskLayerOf`). */
const maskLayerNameOf = (item: {
  HasSolderMask(): boolean;
  GetLayerSet(): LSET;
}): string | undefined => {
  if (!item.HasSolderMask()) return undefined;
  for (const l of item.GetLayerSet().Seq()) if (l === F_Mask || l === B_Mask) return LSET_Name(l);
  return undefined;
};

/** A chain's points, as the reader gives an outline (an arc is its approximation). */
function pointsOfChain(chain: SHAPE_LINE_CHAIN): Vec2[] {
  const out: Vec2[] = [];
  const n = chain.PointCount();
  for (let i = 0; i < n; i++) {
    const p = chain.CPoint(i);
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** The reverse: an edited point list becomes a plain closed chain (an arc, once edited, is its points). */
function chainOf(pts: readonly Vec2[]): SHAPE_LINE_CHAIN {
  const chain = new SHAPE_LINE_CHAIN();
  for (const p of pts) chain.Append(p.x, p.y);
  chain.SetClosed(true);
  return chain;
}

function polySetOf(
  outline: readonly Vec2[],
  holes: readonly (readonly Vec2[])[] = [],
): SHAPE_POLY_SET {
  const poly = new SHAPE_POLY_SET();
  poly.AddOutline(chainOf(outline));
  for (const h of holes) poly.AddHole(chainOf(h));
  return poly;
}

/** `(pts …)` of a polygon shape / text box / zone outline, or nothing. */
function outlinePoints(poly: SHAPE_POLY_SET): Vec2[] {
  if (poly.OutlineCount() === 0) return [];
  return pointsOfChain(poly.Outline(0));
}

const STROKE_TYPE_OF_STYLE: Record<number, StrokeType> = {
  [LINE_STYLE.DEFAULT]: 'default',
  [LINE_STYLE.SOLID]: 'solid',
  [LINE_STYLE.DASH]: 'dash',
  [LINE_STYLE.DOT]: 'dot',
  [LINE_STYLE.DASHDOT]: 'dash_dot',
  [LINE_STYLE.DASHDOTDOT]: 'dash_dot_dot',
};
const STYLE_OF_STROKE_TYPE: Record<StrokeType, LINE_STYLE> = {
  default: LINE_STYLE.DEFAULT,
  solid: LINE_STYLE.SOLID,
  dash: LINE_STYLE.DASH,
  dot: LINE_STYLE.DOT,
  dash_dot: LINE_STYLE.DASHDOT,
  dash_dot_dot: LINE_STYLE.DASHDOTDOT,
};

const strokeType = (s: STROKE_PARAMS): StrokeType =>
  STROKE_TYPE_OF_STYLE[s.GetLineStyle()] ?? 'solid';

/** A stroke with the view's width and type; the colour, which the view does not model, stays. */
function applyStroke(
  prev: STROKE_PARAMS,
  width: number,
  type: StrokeType | undefined,
): STROKE_PARAMS {
  const s = new STROKE_PARAMS(width, type ? STYLE_OF_STROKE_TYPE[type] : prev.GetLineStyle());
  s.SetColor(prev.GetColor());
  return s;
}

/** `const_cast<KIID&>( item->m_Uuid ) = …`. */
const setUuid = (item: BOARD_ITEM, uuid: string): void => {
  (item as { m_Uuid: KIID }).m_Uuid = uuid;
};

// ---------------------------------------------------------------------------
// Nets
// ---------------------------------------------------------------------------

/** The view's `net` for a connected item: the code, or nothing below 1. */
const netCodeOf = (item: BOARD_CONNECTED_ITEM): number | undefined =>
  item.GetNetCode() > 0 ? item.GetNetCode() : undefined;

/**
 * The view's net codes against the board's: `NETINFO_LIST::AppendNet` keeps
 * codes consecutive, so a code the view made up (a paste allotting 7 on a
 * board of three nets) lands on another — the parser's `m_netCodes` map for
 * the same reason (`pushValueIntoMap`).
 */
type NetCodes = Map<number, number>;

/**
 * A view net code back onto the item, through the board's net table: the
 * `NETINFO_ITEM` of that code, or the unconnected one. A code the table does
 * not know is what the old model spelled `{ name: '', code }` — it writes as
 * `(net "")`, which is the orphaned item.
 */
function setNet(
  item: BOARD_CONNECTED_ITEM,
  code: number | undefined,
  board: BOARD,
  codes: NetCodes,
): void {
  if (code === undefined || code <= 0) {
    item.SetNet(board.FindNet(0) ?? NETINFO_LIST.OrphanedItem());
    return;
  }
  item.SetNet(board.FindNet(codes.get(code) ?? code) ?? NETINFO_LIST.OrphanedItem());
}

/** `NETINFO_LIST` as the view's `code -> name` map. */
function netsView(board: BOARD): Map<number, string> {
  const nets = new Map<number, string>();
  for (const [, net] of board.GetNetInfo().NetsByNetcode())
    nets.set(net.GetNetCode(), net.GetNetname());
  return nets;
}

/**
 * The view's map written into the net table: a name the table lacks is
 * appended (`new NETINFO_ITEM( board, name )`, `board->Add`), a code whose
 * name moved is renamed. Nets the view dropped stay — a 10.0 file has no net
 * table, so nothing is written for them. Returns the view's code for each
 * net against the code the table gave it.
 */
function applyNets(board: BOARD, nets: Map<number, string>): NetCodes {
  const codes: NetCodes = new Map();
  for (const [code, name] of nets) {
    const byCode = board.FindNet(code);
    if (byCode && byCode.GetNetname() === name) {
      codes.set(code, code);
      continue;
    }
    const byName = board.FindNet(name);
    if (byName) {
      codes.set(code, byName.GetNetCode());
      continue;
    }
    if (byCode && code !== 0) {
      byCode.SetNetname(name);
      codes.set(code, code);
      continue;
    }
    const net = new NETINFO_ITEM(board, name, code);
    board.Add(net, ADD_MODE.INSERT, true);
    codes.set(code, net.GetNetCode());
  }
  return codes;
}

// ---------------------------------------------------------------------------
// Layers: the `(layers …)` tokens of a multi-layer item, `formatLayers` (:1549)
// ---------------------------------------------------------------------------

/**
 * The `(layers …)` tokens KiCad writes for a layer set, wildcards and all —
 * `formatLayers( aLayerMask, aEnumerateLayers, aIsZone )` (:1549). With
 * `enumerate` no wildcard is used ("Always enumerate every layer for a zone on
 * a copper layer", :2883).
 */
export function layerTokens(
  layerMaskIn: LSET,
  copperLayerCount: number,
  isZone = false,
  enumerate = false,
): string[] {
  const cu_all = LSET.AllCuMask();
  const fr_bk = new LSET([B_Cu, F_Cu]);
  const cu_board_mask = LSET.AllCuMask(copperLayerCount);
  let layerMask = new LSET(layerMaskIn);
  const out: string[] = [];
  if (!enumerate) {
    // If all copper layers present on the board are enabled, then output the wildcard
    if (layerMask.and(cu_board_mask).equals(cu_board_mask)) {
      out.push('*.Cu');
      layerMask = layerMask.and(cu_all.not());
    } else if (layerMask.and(cu_board_mask).equals(fr_bk)) {
      out.push(isZone ? 'F&B.Cu' : '*.Cu');
      layerMask = layerMask.and(fr_bk.not());
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
        layerMask = layerMask.and(set.not());
      }
    }
  }
  // output any individual layers not handled in wildcard combos above
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
export function paperOfPageInfo(p: PAGE_INFO): string {
  if (p.IsCustom())
    return `User ${FormatDouble2Str((p.GetWidthMils() * 25.4) / 1000.0)} ${FormatDouble2Str((p.GetHeightMils() * 25.4) / 1000.0)}`;
  return p.IsPortrait() ? `${p.GetTypeAsString()} portrait` : p.GetTypeAsString();
}

/** `parsePAGE_INFO` (:1728) over the view's token. */
export function pageInfoOfPaper(paper: string, prev: PAGE_INFO): PAGE_INFO {
  const parts = paper.trim().split(/\s+/);
  const word = parts[0] ?? '';
  const pageInfo = new PAGE_INFO();
  if (!pageInfo.SetType(word)) return prev;
  if (pageInfo.GetType() === PAGE_SIZE_TYPE.User) {
    let width = Number(parts[1] ?? Number.NaN);
    let height = Number(parts[2] ?? Number.NaN);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return prev;
    // Perform some controls to avoid crashes if the size is edited by hands
    if (width < MIN_PAGE_SIZE_MM) width = MIN_PAGE_SIZE_MM;
    else if (width > MAX_PAGE_SIZE_PCBNEW_MM) width = MAX_PAGE_SIZE_PCBNEW_MM;
    if (height < MIN_PAGE_SIZE_MM) height = MIN_PAGE_SIZE_MM;
    else if (height > MAX_PAGE_SIZE_PCBNEW_MM) height = MAX_PAGE_SIZE_PCBNEW_MM;
    pageInfo.SetWidthMils((width * 1000.0) / 25.4);
    pageInfo.SetHeightMils((height * 1000.0) / 25.4);
  }
  if (parts.includes('portrait')) pageInfo.SetPortrait(true);
  return pageInfo;
}

type ViewTitleBlock = NonNullable<Board['titleBlock']>;

function titleBlockView(tb: TITLE_BLOCK): ViewTitleBlock | undefined {
  const raw: string[] = [];
  for (let i = 0; i < 9; i++) raw.push(tb.GetComment(i)); // TITLE_BLOCK::Format writes nine
  while (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
  const comments = raw.some((c) => c) ? raw : undefined;
  if (!tb.GetTitle() && !tb.GetDate() && !tb.GetRevision() && !tb.GetCompany() && !comments)
    return undefined;
  return {
    title: tb.GetTitle() || undefined,
    date: tb.GetDate() || undefined,
    rev: tb.GetRevision() || undefined,
    company: tb.GetCompany() || undefined,
    comments,
  };
}

function titleBlockOfView(v: ViewTitleBlock | undefined): TITLE_BLOCK {
  const tb = new TITLE_BLOCK();
  if (!v) return tb;
  tb.SetTitle(v.title ?? '');
  tb.SetDate(v.date ?? '');
  tb.SetRevision(v.rev ?? '');
  tb.SetCompany(v.company ?? '');
  (v.comments ?? []).forEach((c, i) => tb.SetComment(i, c ?? ''));
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

/** `LAYER::ShowType` / `LAYER::ParseType`: the words the file uses. */
const LAYER_TYPE_WORDS: Record<number, string> = {
  [LAYER_T.LT_SIGNAL]: 'signal',
  [LAYER_T.LT_POWER]: 'power',
  [LAYER_T.LT_MIXED]: 'mixed',
  [LAYER_T.LT_JUMPER]: 'jumper',
  [LAYER_T.LT_AUX]: 'auxiliary',
  [LAYER_T.LT_FRONT]: 'front',
  [LAYER_T.LT_BACK]: 'back',
};

/** The `(layers …)` rows as `formatBoardLayers` (:659) writes them. */
function layerTableView(board: BOARD): PcbLayerDef[] {
  const rows: PcbLayerDef[] = [];
  const row = (layer: number, kind: string): PcbLayerDef => {
    const user = board.GetLayerName(layer);
    return {
      id: layer,
      name: LSET_Name(layer),
      kind,
      ...(user !== LSET_Name(layer) ? { userName: user } : {}),
    };
  };
  for (const layer of board.GetEnabledLayers().CuStack()) {
    rows.push(row(layer, LAYER.ShowType(board.GetLayerType(layer))));
  }
  for (const layer of board.GetEnabledLayers().TechAndUserUIOrder()) {
    let printType = false;
    if (layer >= User_1) {
      if (IsCopperLayer(layer)) printType = true;
      const t = board.GetLayerType(layer);
      if (t === LAYER_T.LT_FRONT || t === LAYER_T.LT_BACK) printType = true;
    }
    rows.push(row(layer, printType ? LAYER.ShowType(board.GetLayerType(layer)) : 'user'));
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

/** `parseLayers` (:2258) over the view's rows: the enabled set, copper count and descriptors. */
function applyLayerTable(board: BOARD, rows: readonly PcbLayerDef[]): void {
  const enabled = new LSET();
  let copper = 0;
  const seen = new Set<number>();
  for (const r of rows) {
    const id = r.id >= 0 && LSET_Name(r.id) === r.name ? r.id : LSET_NameToLayer(r.name);
    if (id < 0 || seen.has(id)) continue;
    seen.add(id);
    const layer = new LAYER();
    layer.m_name = LSET_Name(id);
    layer.m_userName = r.userName && r.userName !== LSET_Name(id) ? r.userName : '';
    layer.m_number = id;
    layer.m_type = LAYER.ParseType(r.kind);
    layer.m_visible = board.IsLayerVisible(id as PCB_LAYER_ID);
    board.SetLayerDescr(id as PCB_LAYER_ID, layer);
    enabled.set(id);
    if (IsCopperLayer(id)) copper++;
  }
  // A BOARD never has fewer than two copper layers (`SetCopperLayerCount`
  // enables `AllCuMask( count )`, and the parser rejects a smaller count), so
  // a view with no layer table keeps the model's F.Cu and B.Cu.
  if (copper < 2) {
    for (const id of [F_Cu, B_Cu]) {
      if (enabled.test(id)) continue;
      enabled.set(id);
    }
    copper = 2;
  }
  board.SetCopperLayerCount(copper);
  board.SetEnabledLayers(enabled);
}

// ---------------------------------------------------------------------------
// Texts: EDA_TEXT / PCB_TEXT / PCB_FIELD
// ---------------------------------------------------------------------------

/** The `EDA_TEXT` half a PCB_TEXT and a PCB_TEXTBOX share, as the view reads and writes it. */
type TextLike = Pick<
  EDA_TEXT,
  | 'GetHorizJustify'
  | 'GetVertJustify'
  | 'SetHorizJustify'
  | 'SetVertJustify'
  | 'IsMirrored'
  | 'SetMirrored'
  | 'SetFont'
  | 'SetUnresolvedFontName'
  | 'ResolveFont'
  | 'IsBold'
  | 'IsItalic'
>;

/** The `(justify …)` words `EDA_TEXT::Format` writes, or none. */
function justifyWords(t: TextLike): string[] | undefined {
  const h = t.GetHorizJustify();
  const v = t.GetVertJustify();
  if (
    !t.IsMirrored() &&
    h === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER &&
    v === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER
  )
    return undefined;
  const words: string[] = [];
  if (h !== GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER)
    words.push(h === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT ? 'left' : 'right');
  if (v !== GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER)
    words.push(v === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP ? 'top' : 'bottom');
  if (t.IsMirrored()) words.push('mirror');
  return words;
}

function applyJustify(
  t: TextLike,
  words: readonly string[] | undefined,
  mirror: boolean | undefined,
): void {
  const w = words ?? [];
  t.SetHorizJustify(
    w.includes('left')
      ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
      : w.includes('right')
        ? GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT
        : GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER,
  );
  t.SetVertJustify(
    w.includes('top')
      ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP
      : w.includes('bottom')
        ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM
        : GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER,
  );
  t.SetMirrored(mirror ?? w.includes('mirror'));
}

/** The font of a `(face …)` name, resolved against the board's embedded fonts as the parser does. */
function setFace(t: TextLike, face: string | undefined, board: BOARD | null): void {
  if (!face) {
    t.SetFont(null);
    return;
  }
  t.SetUnresolvedFontName(face);
  t.ResolveFont(board ? board.GetFontFiles() : null);
}

function textView(k: PCB_TEXT, kind: PcbTextItem['kind']): PcbTextItem {
  const justify = justifyWords(k);
  const size = k.GetTextSize();
  return {
    kind,
    text: k.GetText(),
    at: copyVec(k.GetTextPos()),
    angle: k.GetTextAngle().AsDegrees(),
    layer: layerName(k.GetLayer()),
    face: k.GetFontName() || undefined,
    size: { x: size.x, y: size.y },
    thickness: k.GetTextThickness() === 0 ? undefined : k.GetTextThickness(),
    bold: k.IsBold(),
    italic: k.IsItalic(),
    mirror: justify?.includes('mirror'),
    justify,
    keepUpright: k.IsKeepUpright(),
    hide: !k.IsVisible(),
    knockout: k.IsKnockout(),
    locked: k.IsLocked(),
    uuid: k.m_Uuid,
    k,
  };
}

/** The view's fields back into the text, where they differ from what it would show. */
function applyText(k: PCB_TEXT, v: PcbTextItem, keepShownText: string): void {
  if (v.text !== keepShownText) k.SetText(v.text);
  if (!sameVec(k.GetTextPos(), v.at)) k.SetTextPos(copyVec(v.at));
  if (k.GetTextAngle().AsDegrees() !== v.angle) k.SetTextAngle(new EDA_ANGLE(v.angle));
  if (layerName(k.GetLayer()) !== v.layer) k.SetLayer(layerId(v.layer));
  k.SetBold(v.bold ?? false);
  k.SetItalic(v.italic ?? false);
  if ((k.GetFontName() || undefined) !== v.face) setFace(k, v.face, k.GetBoard());
  const size = k.GetTextSize();
  if (size.x !== v.size.x || size.y !== v.size.y) k.SetTextSize({ x: v.size.x, y: v.size.y });
  // `SetAutoThickness( true )` is `SetTextThickness( 0 )`.
  k.SetTextThickness(v.thickness ?? 0);
  if (!sameStrings(justifyWords(k), v.justify) || (v.mirror ?? false) !== k.IsMirrored())
    applyJustify(k, v.justify, v.mirror);
  k.SetKeepUpright(v.keepUpright ?? false);
  k.SetVisible(!(v.hide ?? false));
  k.SetIsKnockout(v.knockout ?? false);
  k.SetLocked(v.locked ?? false);
  if (v.uuid) setUuid(k, v.uuid);
}

/** A text the editor made without a model: `PCB_TEXT( parent )`, then the fields. */
function textOfView(v: PcbTextItem, parent: BOARD_ITEM | null): PCB_TEXT {
  const k = v.k ?? new PCB_TEXT(parent);
  applyText(k, v, k.GetText());
  return k;
}

// ---------------------------------------------------------------------------
// Shapes: PCB_SHAPE
// ---------------------------------------------------------------------------

const SHAPE_KIND: Record<number, PcbShape['kind']> = {
  [SHAPE_T.SEGMENT]: 'line',
  [SHAPE_T.RECTANGLE]: 'rect',
  [SHAPE_T.ARC]: 'arc',
  [SHAPE_T.CIRCLE]: 'circle',
  [SHAPE_T.POLY]: 'poly',
  [SHAPE_T.BEZIER]: 'curve',
};
const SHAPE_OF_KIND: Record<PcbShape['kind'], SHAPE_T> = {
  line: SHAPE_T.SEGMENT,
  rect: SHAPE_T.RECTANGLE,
  arc: SHAPE_T.ARC,
  circle: SHAPE_T.CIRCLE,
  poly: SHAPE_T.POLY,
  curve: SHAPE_T.BEZIER,
};
const FILL_MODE: Record<number, PcbFillMode> = {
  [FILL_T.NO_FILL]: 'none',
  [FILL_T.FILLED_SHAPE]: 'solid',
  [FILL_T.HATCH]: 'hatch',
  [FILL_T.REVERSE_HATCH]: 'reverse_hatch',
  [FILL_T.CROSS_HATCH]: 'cross_hatch',
};
const FILL_OF_MODE: Record<PcbFillMode, FILL_T> = {
  none: FILL_T.NO_FILL,
  solid: FILL_T.FILLED_SHAPE,
  hatch: FILL_T.HATCH,
  reverse_hatch: FILL_T.REVERSE_HATCH,
  cross_hatch: FILL_T.CROSS_HATCH,
};

function shapePoints(k: PCB_SHAPE): Vec2[] | undefined {
  if (k.GetShape() === SHAPE_T.POLY) return outlinePoints(k.GetPolyShape());
  if (k.GetShape() === SHAPE_T.BEZIER)
    return [k.GetStart(), k.GetBezierC1(), k.GetBezierC2(), k.GetEnd()].map(copyVec);
  return undefined;
}

function shapeView(k: PCB_SHAPE): PcbShape {
  const kind = SHAPE_KIND[k.GetShape()] ?? 'line';
  const net = netCodeOf(k);
  const s: PcbShape = {
    ...(net !== undefined ? { net, netName: k.GetNetname() } : {}),
    kind,
    width: k.GetStroke().GetWidth(),
    strokeType: strokeType(k.GetStroke()),
    cornerRadius: kind === 'rect' && k.GetCornerRadius() !== 0 ? k.GetCornerRadius() : undefined,
    fillMode: FILL_MODE[k.GetFillMode()] ?? 'none',
    layer: layerName(k.GetLayer()),
    maskLayer: maskLayerNameOf(k),
    solderMaskMargin: k.GetLocalSolderMaskMargin(),
    locked: k.IsLocked(),
    uuid: k.m_Uuid,
    k,
  };
  if (kind === 'circle') {
    s.center = copyVec(k.GetStart());
    s.end = copyVec(k.GetEnd());
  } else if (kind !== 'curve') {
    s.start = copyVec(k.GetStart());
    s.end = copyVec(k.GetEnd());
    if (kind === 'arc') s.mid = copyVec(k.GetArcMid());
  }
  const pts = shapePoints(k);
  if (pts) s.pts = pts;
  return s;
}

function applyShape(k: PCB_SHAPE, v: PcbShape, board: BOARD, codes: NetCodes): void {
  if (k.GetShape() !== SHAPE_OF_KIND[v.kind]) k.SetShape(SHAPE_OF_KIND[v.kind]);
  const start = v.kind === 'circle' ? v.center : v.start;
  const end = v.end;
  let geometryChanged = false;
  if (start && !sameVec(k.GetStart(), start)) {
    k.SetStart(copyVec(start));
    geometryChanged = true;
  }
  if (end && !sameVec(k.GetEnd(), end)) {
    k.SetEnd(copyVec(end));
    geometryChanged = true;
  }
  if (v.kind === 'arc' && v.mid && (geometryChanged || !sameVec(k.GetArcMid(), v.mid))) {
    // `SetArcGeometry( start, mid, end )`: the centre follows the three points.
    k.SetArcGeometry(k.GetStart(), copyVec(v.mid), k.GetEnd());
  }
  if (v.kind === 'poly' || v.kind === 'curve') {
    const pts = v.pts ?? [];
    if (!sameVecs(shapePoints(k), pts)) {
      if (v.kind === 'poly') k.SetPolyPoints(pts.map(copyVec));
      else if (pts.length >= 4) {
        k.SetStart(copyVec(pts[0]!));
        k.SetBezierC1(copyVec(pts[1]!));
        k.SetBezierC2(copyVec(pts[2]!));
        k.SetEnd(copyVec(pts[3]!));
        k.RebuildBezierToSegmentsPointsList(k.GetWidth());
      }
    }
  }
  const stroke = k.GetStroke();
  if (stroke.GetWidth() !== v.width || (v.strokeType && strokeType(stroke) !== v.strokeType))
    k.SetStroke(applyStroke(stroke, v.width, v.strokeType));
  if (v.kind === 'rect') k.SetCornerRadius(v.cornerRadius ?? 0);
  k.SetFillMode(FILL_OF_MODE[v.fillMode]);
  if (layerName(k.GetLayer()) !== v.layer) k.SetLayer(layerId(v.layer));
  k.SetHasSolderMask(v.maskLayer !== undefined);
  k.SetLocalSolderMaskMargin(v.solderMaskMargin);
  k.SetLocked(v.locked ?? false);
  setNet(k, v.net, board, codes);
  if (v.uuid) setUuid(k, v.uuid);
}

function shapeOfView(
  v: PcbShape,
  parent: BOARD_ITEM | null,
  board: BOARD,
  codes: NetCodes,
): PCB_SHAPE {
  const k = v.k ?? new PCB_SHAPE(parent);
  applyShape(k, v, board, codes);
  return k;
}

// ---------------------------------------------------------------------------
// Pads
// ---------------------------------------------------------------------------

const PAD_TYPE: Record<number, PadType> = {
  [PAD_ATTRIB.PTH]: 'thru_hole',
  [PAD_ATTRIB.SMD]: 'smd',
  [PAD_ATTRIB.CONN]: 'connect',
  [PAD_ATTRIB.NPTH]: 'np_thru_hole',
};
const PAD_ATTRIB_OF_TYPE: Record<PadType, PAD_ATTRIB> = {
  thru_hole: PAD_ATTRIB.PTH,
  smd: PAD_ATTRIB.SMD,
  connect: PAD_ATTRIB.CONN,
  np_thru_hole: PAD_ATTRIB.NPTH,
};
const PAD_SHAPE_VIEW: Record<number, PadShape> = {
  [PAD_SHAPE.CIRCLE]: 'circle',
  [PAD_SHAPE.RECTANGLE]: 'rect',
  [PAD_SHAPE.OVAL]: 'oval',
  [PAD_SHAPE.TRAPEZOID]: 'trapezoid',
  [PAD_SHAPE.ROUNDRECT]: 'roundrect',
  [PAD_SHAPE.CHAMFERED_RECT]: 'roundrect',
  [PAD_SHAPE.CUSTOM]: 'custom',
};
const PAD_SHAPE_OF_VIEW: Record<PadShape, PAD_SHAPE> = {
  circle: PAD_SHAPE.CIRCLE,
  rect: PAD_SHAPE.RECTANGLE,
  oval: PAD_SHAPE.OVAL,
  trapezoid: PAD_SHAPE.TRAPEZOID,
  roundrect: PAD_SHAPE.ROUNDRECT,
  custom: PAD_SHAPE.CUSTOM,
};
const PAD_PROPERTY: Record<number, string | undefined> = {
  [PAD_PROP.NONE]: undefined,
  [PAD_PROP.BGA]: 'pad_prop_bga',
  [PAD_PROP.FIDUCIAL_GLBL]: 'pad_prop_fiducial_glob',
  [PAD_PROP.FIDUCIAL_LOCAL]: 'pad_prop_fiducial_loc',
  [PAD_PROP.TESTPOINT]: 'pad_prop_testpoint',
  [PAD_PROP.HEATSINK]: 'pad_prop_heatsink',
  [PAD_PROP.CASTELLATED]: 'pad_prop_castellated',
  [PAD_PROP.MECHANICAL]: 'pad_prop_mechanical',
  [PAD_PROP.PRESSFIT]: 'pad_prop_pressfit',
};
const CHAMFER_WORDS: [number, string][] = [
  [1, 'top_left'],
  [2, 'top_right'],
  [4, 'bottom_left'],
  [8, 'bottom_right'],
];
const UNCONNECTED_MODE_VIEW: Record<number, UnconnectedLayerMode> = {
  [UNCONNECTED_LAYER_MODE.KEEP_ALL]: 'keep_all',
  [UNCONNECTED_LAYER_MODE.REMOVE_ALL]: 'remove_all',
  [UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END]: 'remove_except_start_and_end',
  [UNCONNECTED_LAYER_MODE.START_END_ONLY]: 'start_end_only',
};
const UNCONNECTED_MODE_OF_VIEW: Record<UnconnectedLayerMode, UNCONNECTED_LAYER_MODE> = {
  keep_all: UNCONNECTED_LAYER_MODE.KEEP_ALL,
  remove_all: UNCONNECTED_LAYER_MODE.REMOVE_ALL,
  remove_except_start_and_end: UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END,
  start_end_only: UNCONNECTED_LAYER_MODE.START_END_ONLY,
};

const drillSlotView = (d: PADSTACK_DRILL_PROPS): PcbDrillSlot | undefined =>
  d.size.x > 0 ? { size: d.size.x, start: layerName(d.start), end: layerName(d.end) } : undefined;

function applyDrillSlot(d: PADSTACK_DRILL_PROPS, v: PcbDrillSlot | undefined): void {
  if (!v) {
    d.size = { x: 0, y: 0 };
    return;
  }
  d.size = { x: v.size, y: v.size };
  d.start = layerId(v.start);
  d.end = layerId(v.end);
}

const postMachiningView = (p: PADSTACK_POST_MACHINING_PROPS): PcbPostMachining | undefined =>
  p.mode === undefined || p.mode === PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED
    ? undefined
    : {
        mode: p.mode === PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE ? 'counterbore' : 'countersink',
        ...(p.size > 0 ? { size: p.size } : {}),
        ...(p.depth > 0 ? { depth: p.depth } : {}),
        ...(p.angle > 0 ? { angle: p.angle } : {}),
      };

function applyPostMachining(
  p: PADSTACK_POST_MACHINING_PROPS,
  v: PcbPostMachining | undefined,
): void {
  if (!v) {
    p.mode = PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED;
    return;
  }
  p.mode =
    v.mode === 'counterbore'
      ? PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE
      : PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK;
  p.size = v.size ?? 0;
  p.depth = v.depth ?? 0;
  p.angle = v.angle ?? 0;
}

/** `isDefaultTeardropParameters( tdParams )` (pcb_io_kicad_sexpr.cpp:766). */
function isDefaultTeardropParameters(td: TEARDROP_PARAMETERS): boolean {
  return td.equals(new TEARDROP_PARAMETERS());
}

const teardropsView = (td: TEARDROP_PARAMETERS): TeardropParams | undefined =>
  isDefaultTeardropParameters(td)
    ? undefined
    : {
        enabled: td.m_Enabled,
        allowUseTwoTracks: td.m_AllowUseTwoTracks,
        tdOnPadsInZones: td.m_TdOnPadsInZones,
        bestLengthRatio: td.m_BestLengthRatio,
        tdMaxLen: td.m_TdMaxLen,
        bestWidthRatio: td.m_BestWidthRatio,
        tdMaxWidth: td.m_TdMaxWidth,
        curvedEdges: td.m_CurvedEdges,
        widthtoSizeFilterRatio: td.m_WidthtoSizeFilterRatio,
      };

function applyTeardrops(td: TEARDROP_PARAMETERS, v: TeardropParams | undefined): void {
  if (!v) {
    td.assign(new TEARDROP_PARAMETERS());
    return;
  }
  td.m_Enabled = v.enabled;
  td.m_AllowUseTwoTracks = v.allowUseTwoTracks;
  td.m_TdOnPadsInZones = v.tdOnPadsInZones;
  td.m_BestLengthRatio = v.bestLengthRatio;
  td.m_TdMaxLen = v.tdMaxLen;
  td.m_BestWidthRatio = v.bestWidthRatio;
  td.m_TdMaxWidth = v.tdMaxWidth;
  td.m_CurvedEdges = v.curvedEdges;
  td.m_WidthtoSizeFilterRatio = v.widthtoSizeFilterRatio;
}

const PRIMITIVE_KIND = (p: PCB_SHAPE): PadPrimitive['kind'] | undefined => {
  switch (p.GetShape()) {
    case SHAPE_T.SEGMENT:
      return p.IsProxyItem() ? 'gr_vector' : 'gr_line';
    case SHAPE_T.RECTANGLE:
      return p.IsProxyItem() ? undefined : 'gr_rect';
    case SHAPE_T.ARC:
      return 'gr_arc';
    case SHAPE_T.CIRCLE:
      return 'gr_circle';
    case SHAPE_T.POLY:
      return 'gr_poly';
    default:
      return undefined;
  }
};

function primitivesView(shapes: readonly PCB_SHAPE[]): PadPrimitive[] | undefined {
  const out: PadPrimitive[] = [];
  for (const p of shapes) {
    const kind = PRIMITIVE_KIND(p);
    if (!kind) continue;
    out.push({
      kind,
      pts: p.GetShape() === SHAPE_T.POLY ? outlinePoints(p.GetPolyShape()) : undefined,
      start: p.GetShape() === SHAPE_T.CIRCLE ? undefined : copyVec(p.GetStart()),
      mid: p.GetShape() === SHAPE_T.ARC ? copyVec(p.GetArcMid()) : undefined,
      end: copyVec(p.GetEnd()),
      center: p.GetShape() === SHAPE_T.CIRCLE ? copyVec(p.GetStart()) : undefined,
      width: p.GetStroke().GetWidth(),
      fill: p.GetFillMode() === FILL_T.FILLED_SHAPE,
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

/** `PCB_SHAPE( nullptr, SHAPE_T::… )` for each primitive: the pad owns them, parentless. */
function primitivesOfView(prims: readonly PadPrimitive[]): PCB_SHAPE[] {
  return prims.map((p) => {
    const k = new PCB_SHAPE(null);
    k.SetIsProxyItem(p.kind === 'gr_vector');
    switch (p.kind) {
      case 'gr_line':
      case 'gr_vector':
        k.SetShape(SHAPE_T.SEGMENT);
        k.SetStart(copyVec(p.start ?? { x: 0, y: 0 }));
        k.SetEnd(copyVec(p.end ?? { x: 0, y: 0 }));
        break;
      case 'gr_rect':
        k.SetShape(SHAPE_T.RECTANGLE);
        k.SetStart(copyVec(p.start ?? { x: 0, y: 0 }));
        k.SetEnd(copyVec(p.end ?? { x: 0, y: 0 }));
        break;
      case 'gr_arc':
        k.SetShape(SHAPE_T.ARC);
        k.SetArcGeometry(
          copyVec(p.start ?? { x: 0, y: 0 }),
          copyVec(p.mid ?? p.start ?? { x: 0, y: 0 }),
          copyVec(p.end ?? { x: 0, y: 0 }),
        );
        break;
      case 'gr_circle':
        k.SetShape(SHAPE_T.CIRCLE);
        k.SetStart(copyVec(p.center ?? { x: 0, y: 0 }));
        k.SetEnd(copyVec(p.end ?? { x: 0, y: 0 }));
        break;
      case 'gr_poly':
        k.SetShape(SHAPE_T.POLY);
        k.SetPolyPoints((p.pts ?? []).map(copyVec));
        break;
    }
    k.SetStroke(new STROKE_PARAMS(p.width, LINE_STYLE.SOLID));
    k.SetFillMode(p.fill ? FILL_T.FILLED_SHAPE : FILL_T.NO_FILL);
    return k;
  });
}

function padView(k: PAD, copperLayerCount: number): PcbPad {
  const ps = k.Padstack();
  const ALL = PADSTACK.ALL_LAYERS;
  const shape = k.GetShape(ALL);
  const size = k.GetSize(ALL);
  const offset = k.GetOffset(ALL);
  const delta = k.GetDelta(ALL);
  const drill = k.GetDrillSize();
  const zc = k.GetLocalZoneConnection();
  return {
    number: k.GetNumber(),
    type: PAD_TYPE[k.GetAttribute()] ?? 'smd',
    shape: PAD_SHAPE_VIEW[shape] ?? 'circle',
    at: copyVec(k.GetPosition()),
    angle: k.GetOrientation().AsDegrees(),
    size: { x: size.x, y: size.y },
    drill:
      drill.x > 0 || drill.y > 0
        ? {
            oblong: k.GetDrillShape() === PAD_DRILL_SHAPE.OBLONG,
            w: drill.x,
            h: drill.y,
            ...(offset.x !== 0 || offset.y !== 0 ? { offset: { x: offset.x, y: offset.y } } : {}),
          }
        : undefined,
    layers: layerTokens(k.GetLayerSet(), copperLayerCount),
    roundrectRatio:
      shape === PAD_SHAPE.ROUNDRECT || shape === PAD_SHAPE.CHAMFERED_RECT
        ? k.GetRoundRectRadiusRatio(ALL)
        : undefined,
    chamferRatio: shape === PAD_SHAPE.CHAMFERED_RECT ? k.GetChamferRectRatio(ALL) : undefined,
    chamfer:
      shape === PAD_SHAPE.CHAMFERED_RECT && k.GetChamferPositions(ALL) !== 0
        ? CHAMFER_WORDS.filter(([bit]) => k.GetChamferPositions(ALL) & bit).map(([, w]) => w)
        : undefined,
    delta: delta.x !== 0 || delta.y !== 0 ? { x: delta.x, y: delta.y } : undefined,
    net: netCodeOf(k),
    pinFunction: k.GetPinFunction() || undefined,
    padProperty: PAD_PROPERTY[k.GetProperty()],
    pinType: k.GetPinType() || undefined,
    primitives: shape === PAD_SHAPE.CUSTOM ? primitivesView(k.GetPrimitives(ALL)) : undefined,
    localClearance: k.GetLocalClearance(),
    localSolderMaskMargin: k.GetLocalSolderMaskMargin(),
    localSolderPasteMargin: k.GetLocalSolderPasteMargin(),
    localSolderPasteMarginRatio: k.GetLocalSolderPasteMarginRatio(),
    zoneConnection: zc !== ZONE_CONNECTION.INHERITED ? zoneConnectionFromCode(zc) : undefined,
    thermalBridgeWidth: k.GetLocalThermalSpokeWidthOverride(),
    thermalGap: k.GetLocalThermalGapOverride(),
    thermalSpokeAngle: k.GetThermalSpokeAngle().AsDegrees(),
    anchorShape:
      shape === PAD_SHAPE.CUSTOM
        ? k.GetAnchorPadShape(ALL) === PAD_SHAPE.RECTANGLE
          ? 'rect'
          : 'circle'
        : undefined,
    padToDieLength: k.GetPadToDieLength() !== 0 ? k.GetPadToDieLength() : undefined,
    backdrill: drillSlotView(ps.SecondaryDrill()),
    tertiaryDrill: drillSlotView(ps.TertiaryDrill()),
    frontPostMachining: postMachiningView(ps.FrontPostMachining()),
    backPostMachining: postMachiningView(ps.BackPostMachining()),
    teardrops: teardropsView(k.GetTeardropParams()),
    unconnectedLayerMode:
      k.GetUnconnectedLayerMode() === UNCONNECTED_LAYER_MODE.KEEP_ALL
        ? undefined
        : UNCONNECTED_MODE_VIEW[k.GetUnconnectedLayerMode()],
    uuid: k.m_Uuid,
    k,
  };
}

function applyPad(
  k: PAD,
  v: PcbPad,
  board: BOARD,
  codes: NetCodes,
  copperLayerCount: number,
): void {
  const ps = k.Padstack();
  const ALL = PADSTACK.ALL_LAYERS;
  k.SetNumber(v.number);
  k.SetAttribute(PAD_ATTRIB_OF_TYPE[v.type]);
  // `SetShape( ALL_LAYERS, … )`: a chamfered rect is a roundrect with corners.
  if (PAD_SHAPE_VIEW[k.GetShape(ALL)] !== v.shape) k.SetShape(ALL, PAD_SHAPE_OF_VIEW[v.shape]);
  if (v.shape === 'roundrect') {
    const positions = v.chamfer
      ? CHAMFER_WORDS.filter(([, w]) => v.chamfer!.includes(w)).reduce((m, [bit]) => m | bit, 0)
      : 0;
    k.SetChamferPositions(ALL, positions);
    k.SetShape(ALL, positions !== 0 ? PAD_SHAPE.CHAMFERED_RECT : PAD_SHAPE.ROUNDRECT);
    if (v.roundrectRatio !== undefined) k.SetRoundRectRadiusRatio(ALL, v.roundrectRatio);
    if (v.chamferRatio !== undefined) k.SetChamferRectRatio(ALL, v.chamferRatio);
  }
  if (!sameVec(k.GetPosition(), v.at)) k.SetPosition(copyVec(v.at));
  if (k.GetOrientation().AsDegrees() !== v.angle) k.SetOrientation(new EDA_ANGLE(v.angle));
  const size = k.GetSize(ALL);
  if (size.x !== v.size.x || size.y !== v.size.y) k.SetSize(ALL, { x: v.size.x, y: v.size.y });
  if (v.drill) {
    k.SetDrillSize({ x: v.drill.w, y: v.drill.h });
    k.SetDrillShape(v.drill.oblong ? PAD_DRILL_SHAPE.OBLONG : PAD_DRILL_SHAPE.CIRCLE);
    k.SetOffset(ALL, v.drill.offset ? copyVec(v.drill.offset) : { x: 0, y: 0 });
  } else {
    k.SetDrillSize({ x: 0, y: 0 });
    k.SetOffset(ALL, { x: 0, y: 0 });
  }
  if (!sameStrings(layerTokens(k.GetLayerSet(), copperLayerCount), v.layers))
    k.SetLayerSet(layerSetOfTokens(v.layers));
  k.SetDelta(ALL, v.delta ? copyVec(v.delta) : { x: 0, y: 0 });
  setNet(k, v.net, board, codes);
  k.SetPinFunction(v.pinFunction ?? '');
  k.SetPinType(v.pinType ?? '');
  k.SetProperty(
    (Number(
      Object.entries(PAD_PROPERTY).find(([, word]) => word === v.padProperty)?.[0] ?? PAD_PROP.NONE,
    ) as PAD_PROP) ?? PAD_PROP.NONE,
  );
  if (v.shape === 'custom') {
    k.SetAnchorPadShape(ALL, v.anchorShape === 'rect' ? PAD_SHAPE.RECTANGLE : PAD_SHAPE.CIRCLE);
    if (!samePrimitives(primitivesView(k.GetPrimitives(ALL)), v.primitives))
      k.ReplacePrimitives(ALL, primitivesOfView(v.primitives ?? []));
  }
  k.SetLocalClearance(v.localClearance);
  k.SetLocalSolderMaskMargin(v.localSolderMaskMargin);
  k.SetLocalSolderPasteMargin(v.localSolderPasteMargin);
  k.SetLocalSolderPasteMarginRatio(v.localSolderPasteMarginRatio);
  k.SetLocalZoneConnection(
    v.zoneConnection !== undefined
      ? (ZONE_CONNECTION_CODE[v.zoneConnection] as ZONE_CONNECTION)
      : ZONE_CONNECTION.INHERITED,
  );
  k.SetLocalThermalSpokeWidthOverride(v.thermalBridgeWidth);
  k.SetLocalThermalGapOverride(v.thermalGap);
  // `thermalSpokeAngle` undefined is the view saying "the file stated none",
  // and `types.ts` says what that resolves to: `defaultThermalSpokeAngle`,
  // which is the rule the PARSER applies
  // (`pcb_io_kicad_sexpr_parser.cpp:6442-6469`) - 90 degrees for anything but
  // a circle. Leaving the padstack alone instead hands the pad the PADSTACK
  // constructor's seed of 45 (`padstack.cpp:54`), so a rect pad built from a
  // view got an X where a rect pad read from a file gets a +.
  const spokeAngle = v.thermalSpokeAngle ?? defaultThermalSpokeAngle(v.shape, v.anchorShape);

  if (k.GetThermalSpokeAngle().AsDegrees() !== spokeAngle)
    k.SetThermalSpokeAngle(new EDA_ANGLE(spokeAngle));
  k.SetPadToDieLength(v.padToDieLength ?? 0);
  applyDrillSlot(ps.SecondaryDrill(), v.backdrill);
  applyDrillSlot(ps.TertiaryDrill(), v.tertiaryDrill);
  applyPostMachining(ps.FrontPostMachining(), v.frontPostMachining);
  applyPostMachining(ps.BackPostMachining(), v.backPostMachining);
  applyTeardrops(k.GetTeardropParams(), v.teardrops);
  k.SetUnconnectedLayerMode(UNCONNECTED_MODE_OF_VIEW[v.unconnectedLayerMode ?? 'keep_all']);
  if (v.uuid) setUuid(k, v.uuid);
}

// ---------------------------------------------------------------------------
// Tracks, arcs, vias
// ---------------------------------------------------------------------------

function trackView(k: PCB_TRACK): PcbTrack {
  return {
    start: copyVec(k.GetStart()),
    end: copyVec(k.GetEnd()),
    width: k.GetWidth(),
    layer: layerName(k.GetLayer()),
    // `GetNetCode()`: the code, 0 unconnected, -1 with no NETINFO_ITEM at all.
    net: k.GetNetCode(),
    maskLayer: maskLayerNameOf(k),
    solderMaskMargin: k.GetLocalSolderMaskMargin(),
    locked: k.IsLocked(),
    uuid: k.m_Uuid,
    k,
  };
}

function arcView(k: PCB_ARC): PcbArcTrack {
  return { ...trackView(k), mid: copyVec(k.GetMid()), k } as PcbArcTrack;
}

function applyTrack(k: PCB_TRACK, v: PcbTrack | PcbArcTrack, board: BOARD, codes: NetCodes): void {
  if (!sameVec(k.GetStart(), v.start)) k.SetStart(copyVec(v.start));
  if (!sameVec(k.GetEnd(), v.end)) k.SetEnd(copyVec(v.end));
  if ('mid' in v && k instanceof PCB_ARC && !sameVec(k.GetMid(), v.mid)) k.SetMid(copyVec(v.mid));
  if (k.GetWidth() !== v.width) k.SetWidth(v.width);
  if (layerName(k.GetLayer()) !== v.layer) k.SetLayer(layerId(v.layer));
  k.SetHasSolderMask(v.maskLayer !== undefined);
  k.SetLocalSolderMaskMargin(v.solderMaskMargin);
  setNet(k, v.net, board, codes);
  k.SetLocked(v.locked ?? false);
  if (v.uuid) setUuid(k, v.uuid);
}

const viaOptView = (
  front: boolean | undefined,
  back: boolean | undefined,
): { front?: boolean; back?: boolean } | undefined =>
  front === undefined && back === undefined ? undefined : { front, back };

const VIA_KIND: Record<number, PcbVia['kind']> = {
  [VIATYPE.THROUGH]: 'through',
  [VIATYPE.BLIND]: 'blind',
  [VIATYPE.BURIED]: 'buried',
  [VIATYPE.MICROVIA]: 'micro',
};
const VIATYPE_OF_KIND: Record<PcbVia['kind'], VIATYPE> = {
  through: VIATYPE.THROUGH,
  blind: VIATYPE.BLIND,
  buried: VIATYPE.BURIED,
  micro: VIATYPE.MICROVIA,
};

function viaView(k: PCB_VIA): PcbVia {
  const ps = k.Padstack();
  const [layer1, layer2] = k.LayerPair();
  return {
    at: copyVec(k.GetStart()),
    size: k.GetWidth(F_Cu as PCB_LAYER_ID),
    drill: k.GetDrill() === UNDEFINED_DRILL_DIAMETER ? 0 : k.GetDrill(),
    layers: [layerName(layer1), layerName(layer2)],
    kind: VIA_KIND[k.GetViaType()] ?? 'through',
    net: k.GetNetCode(),
    teardrops: teardropsView(k.GetTeardropParams()),
    tenting: viaOptView(
      ps.FrontOuterLayers().has_solder_mask,
      ps.BackOuterLayers().has_solder_mask,
    ),
    covering: viaOptView(ps.FrontOuterLayers().has_covering, ps.BackOuterLayers().has_covering),
    plugging: viaOptView(ps.FrontOuterLayers().has_plugging, ps.BackOuterLayers().has_plugging),
    capping: ps.Drill().is_capped,
    filling: ps.Drill().is_filled,
    backdrill: drillSlotView(ps.SecondaryDrill()),
    tertiaryDrill: drillSlotView(ps.TertiaryDrill()),
    frontPostMachining: postMachiningView(ps.FrontPostMachining()),
    backPostMachining: postMachiningView(ps.BackPostMachining()),
    unconnectedLayerMode:
      ps.UnconnectedLayerMode() === UNCONNECTED_LAYER_MODE.KEEP_ALL
        ? undefined
        : UNCONNECTED_MODE_VIEW[ps.UnconnectedLayerMode()],
    locked: k.IsLocked(),
    uuid: k.m_Uuid,
    k,
  };
}

function applyVia(k: PCB_VIA, v: PcbVia, board: BOARD, codes: NetCodes): void {
  const ps = k.Padstack();
  if (!sameVec(k.GetStart(), v.at)) k.SetPosition(copyVec(v.at));
  if (k.GetWidth(F_Cu as PCB_LAYER_ID) !== v.size) k.SetWidth(PADSTACK.ALL_LAYERS, v.size);
  if (!(k.GetDrill() === UNDEFINED_DRILL_DIAMETER && v.drill === 0) && k.GetDrill() !== v.drill)
    k.SetDrill(v.drill);
  const [layer1, layer2] = k.LayerPair();
  if (
    layerName(layer1) !== v.layers[0] ||
    layerName(layer2) !== v.layers[1] ||
    VIA_KIND[k.GetViaType()] !== v.kind
  ) {
    k.SetViaType(VIATYPE_OF_KIND[v.kind]);
    k.SetLayerPair(layerId(v.layers[0]), layerId(v.layers[1]));
  }
  setNet(k, v.net, board, codes);
  applyTeardrops(k.GetTeardropParams(), v.teardrops);
  ps.FrontOuterLayers().has_solder_mask = v.tenting?.front;
  ps.BackOuterLayers().has_solder_mask = v.tenting?.back;
  ps.FrontOuterLayers().has_covering = v.covering?.front;
  ps.BackOuterLayers().has_covering = v.covering?.back;
  ps.FrontOuterLayers().has_plugging = v.plugging?.front;
  ps.BackOuterLayers().has_plugging = v.plugging?.back;
  ps.Drill().is_capped = v.capping;
  ps.Drill().is_filled = v.filling;
  applyDrillSlot(ps.SecondaryDrill(), v.backdrill);
  applyDrillSlot(ps.TertiaryDrill(), v.tertiaryDrill);
  applyPostMachining(ps.FrontPostMachining(), v.frontPostMachining);
  applyPostMachining(ps.BackPostMachining(), v.backPostMachining);
  ps.SetUnconnectedLayerMode(UNCONNECTED_MODE_OF_VIEW[v.unconnectedLayerMode ?? 'keep_all']);
  k.SetLocked(v.locked ?? false);
  if (v.uuid) setUuid(k, v.uuid);
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

const PAD_CONNECTION_WORD: Record<number, NonNullable<PcbZone['padConnection']>> = {
  [ZONE_CONNECTION.NONE]: 'none',
  [ZONE_CONNECTION.THERMAL]: 'thermal',
  [ZONE_CONNECTION.FULL]: 'full',
  [ZONE_CONNECTION.THT_THERMAL]: 'thru_hole_only',
};
const PAD_CONNECTION_OF_WORD: Record<NonNullable<PcbZone['padConnection']>, ZONE_CONNECTION> = {
  none: ZONE_CONNECTION.NONE,
  thermal: ZONE_CONNECTION.THERMAL,
  full: ZONE_CONNECTION.FULL,
  thru_hole_only: ZONE_CONNECTION.THT_THERMAL,
};
const HATCH_STYLE_WORD: Record<number, NonNullable<PcbZone['hatchStyle']>> = {
  [ZONE_BORDER_DISPLAY_STYLE.NO_HATCH]: 'none',
  [ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE]: 'edge',
  [ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_FULL]: 'full',
  [ZONE_BORDER_DISPLAY_STYLE.INVISIBLE_BORDER]: 'invisible',
};
const HATCH_STYLE_OF_WORD: Record<NonNullable<PcbZone['hatchStyle']>, ZONE_BORDER_DISPLAY_STYLE> = {
  none: ZONE_BORDER_DISPLAY_STYLE.NO_HATCH,
  edge: ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
  full: ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_FULL,
  invisible: ZONE_BORDER_DISPLAY_STYLE.INVISIBLE_BORDER,
};
const PLACEMENT_SOURCE_VIEW: Record<number, PlacementSourceType> = {
  [PLACEMENT_SOURCE_T.SHEETNAME]: 'sheetname',
  [PLACEMENT_SOURCE_T.COMPONENT_CLASS]: 'component_class',
  [PLACEMENT_SOURCE_T.GROUP_PLACEMENT]: 'group',
  [PLACEMENT_SOURCE_T.DESIGN_BLOCK]: 'sheetname',
};
const PLACEMENT_SOURCE_OF_VIEW: Record<PlacementSourceType, PLACEMENT_SOURCE_T> = {
  sheetname: PLACEMENT_SOURCE_T.SHEETNAME,
  component_class: PLACEMENT_SOURCE_T.COMPONENT_CLASS,
  group: PLACEMENT_SOURCE_T.GROUP_PLACEMENT,
};

function zoneFillsView(k: ZONE): PcbZoneFill[] {
  const fills: PcbZoneFill[] = [];
  for (const layer of k.GetLayerSet().Seq()) {
    const fv = k.GetFilledPolysList(layer as PCB_LAYER_ID);
    for (let ii = 0; ii < fv.OutlineCount(); ++ii) {
      const pts = pointsOfChain(fv.COutline(ii));
      if (pts.length < 3) continue;
      const name = layerName(layer);
      const existing = fills.find((f) => f.layer === name);
      if (existing) existing.polys.push(pts);
      else fills.push({ layer: name, polys: [pts] });
    }
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

/** The outline and its holes: "The first polygon is the main outline. Others are holes inside the main outline." */
function zoneRings(k: ZONE): { outline: Vec2[]; holes: Vec2[][] } {
  const poly = k.Outline();
  if (poly.OutlineCount() === 0) return { outline: [], holes: [] };
  const outline = pointsOfChain(poly.Outline(0));
  const holes: Vec2[][] = [];
  for (let i = 0; i < poly.HoleCount(0); i++) {
    const h = pointsOfChain(poly.Hole(0, i));
    if (h.length >= 3) holes.push(h);
  }
  return { outline, holes };
}

function zoneView(k: ZONE, copperLayerCount: number): PcbZone {
  const { outline, holes } = zoneRings(k);
  const layerProperties: Record<string, { x: number; y: number }> = {};
  for (const [layer, props] of k.LayerProperties()) {
    if (props.hatching_offset) layerProperties[layerName(layer)] = copyVec(props.hatching_offset);
  }
  const layers = k.GetLayerSet();
  const net = k.GetNetCode();
  return {
    net: net > 0 ? net : 0,
    netName: net > 0 ? k.GetNetname() : undefined,
    name: k.GetZoneName() || undefined,
    layers:
      layers.count() > 1
        ? layerTokens(layers, copperLayerCount, true, layers.and(LSET.AllCuMask()).any())
        : layers.Seq().map(layerName),
    fills: zoneFillsView(k),
    outline: outline.length >= 3 ? outline : undefined,
    ...(holes.length ? { holes } : {}),
    hatchStyle: k.IsTeardropArea() ? 'invisible' : (HATCH_STYLE_WORD[k.GetHatchStyle()] ?? 'none'),
    hatchPitch: k.GetBorderHatchPitch(),
    padConnection: PAD_CONNECTION_WORD[k.GetPadConnection()] ?? 'thermal',
    clearance: k.GetLocalClearance(),
    minThickness: k.GetMinThickness(),
    thermalGap: k.GetThermalReliefGap(),
    thermalBridgeWidth: k.GetThermalReliefSpokeWidth(),
    cornerSmoothing:
      k.GetCornerSmoothingType() === ZONE_SETTINGS.SMOOTHING_CHAMFER
        ? 'chamfer'
        : k.GetCornerSmoothingType() === ZONE_SETTINGS.SMOOTHING_FILLET
          ? 'fillet'
          : 'none',
    cornerRadius: k.GetCornerRadius(),
    fillMode: k.GetFillMode() === ZONE_FILL_MODE.HATCH_PATTERN ? 'hatch' : 'solid',
    hatchThickness: k.GetHatchThickness(),
    hatchGap: k.GetHatchGap(),
    hatchOrientation: k.GetHatchOrientation().AsDegrees(),
    hatchSmoothingLevel: k.GetHatchSmoothingLevel(),
    hatchSmoothingValue: k.GetHatchSmoothingValue(),
    hatchHoleMinArea: k.GetHatchHoleMinArea(),
    layerProperties: Object.keys(layerProperties).length ? layerProperties : undefined,
    filled: k.IsFilled(),
    islandRemovalMode:
      k.GetIslandRemovalMode() === ISLAND_REMOVAL_MODE.NEVER
        ? 'never'
        : k.GetIslandRemovalMode() === ISLAND_REMOVAL_MODE.AREA
          ? 'area'
          : 'always',
    // Stored in mm², not IU: upstream divides by IU_PER_MM when writing it.
    // The view keeps mm²; the model keeps IU² (`SetMinIslandArea( area * IU_PER_MM )`).
    islandAreaMin: k.GetMinIslandArea() / (pcbIUScale.IU_PER_MM * pcbIUScale.IU_PER_MM),
    priority: k.GetAssignedPriority(),
    teardropType: k.IsTeardropArea()
      ? k.GetTeardropAreaType() === TEARDROP_TYPE.TD_VIAPAD
        ? 'viapad'
        : 'trackend'
      : undefined,
    ruleArea: k.GetIsRuleArea()
      ? {
          tracks: k.GetDoNotAllowTracks(),
          vias: k.GetDoNotAllowVias(),
          pads: k.GetDoNotAllowPads(),
          copperPour: k.GetDoNotAllowZoneFills(),
          footprints: k.GetDoNotAllowFootprints(),
        }
      : undefined,
    placementArea: k.GetIsRuleArea()
      ? {
          enabled: k.GetPlacementAreaEnabled(),
          sourceType: PLACEMENT_SOURCE_VIEW[k.GetPlacementAreaSourceType()] ?? 'sheetname',
          source: k.GetPlacementAreaSource(),
        }
      : undefined,
    locked: k.IsLocked(),
    uuid: k.m_Uuid,
    k,
  };
}

function applyZone(
  k: ZONE,
  v: PcbZone,
  board: BOARD,
  codes: NetCodes,
  copperLayerCount: number,
): void {
  setNet(k, v.net, board, codes);
  k.SetZoneName(v.name ?? '');
  const layers = k.GetLayerSet();
  const derivedLayers =
    layers.count() > 1
      ? layerTokens(layers, copperLayerCount, true, layers.and(LSET.AllCuMask()).any())
      : layers.Seq().map(layerName);
  if (!sameStrings(derivedLayers, v.layers)) k.SetLayerSet(layerSetOfTokens(v.layers));
  if (!sameFills(zoneFillsView(k), v.fills)) {
    for (const layer of k.GetLayerSet().Seq())
      k.SetFilledPolysList(layer as PCB_LAYER_ID, new SHAPE_POLY_SET());
    for (const f of v.fills) {
      const poly = new SHAPE_POLY_SET();
      for (const ring of f.polys) poly.AddOutline(chainOf(ring));
      k.SetFilledPolysList(layerId(f.layer), poly);
    }
  }
  const { outline: derivedOutline, holes: derivedHoles } = zoneRings(k);
  const viewOutline = v.outline ?? [];
  const viewHoles = v.holes ?? [];
  const sameRings =
    sameVecs(derivedOutline.length >= 3 ? derivedOutline : [], viewOutline) &&
    derivedHoles.length === viewHoles.length &&
    derivedHoles.every((h, i) => sameVecs(h, viewHoles[i]));
  if (!sameRings) {
    k.SetOutline(viewOutline.length > 0 ? polySetOf(viewOutline, viewHoles) : new SHAPE_POLY_SET());
  }
  const wasTeardrop = k.IsTeardropArea();
  k.SetTeardropAreaType(
    v.teardropType === undefined
      ? TEARDROP_TYPE.TD_NONE
      : v.teardropType === 'viapad'
        ? TEARDROP_TYPE.TD_VIAPAD
        : TEARDROP_TYPE.TD_TRACKEND,
  );
  // A loaded teardrop keeps the style its file says (the view shows it as
  // `invisible` regardless); one the generator just made is
  // `SetBorderDisplayStyle( INVISIBLE_BORDER, … )` (teardrop.cpp:81), which
  // the writer spells `none`.
  let style = k.GetHatchStyle();
  if (v.hatchStyle !== undefined && v.hatchStyle !== 'invisible')
    style = HATCH_STYLE_OF_WORD[v.hatchStyle];
  else if (v.hatchStyle === 'invisible' && !k.IsTeardropArea())
    style = ZONE_BORDER_DISPLAY_STYLE.NO_HATCH;
  else if (v.hatchStyle === 'invisible' && !v.k) style = ZONE_BORDER_DISPLAY_STYLE.INVISIBLE_BORDER;
  void wasTeardrop;
  const pitch = v.hatchPitch ?? k.GetBorderHatchPitch();
  if (style !== k.GetHatchStyle() || pitch !== k.GetBorderHatchPitch())
    k.SetBorderDisplayStyle(style, pitch, false);
  k.SetPadConnection(PAD_CONNECTION_OF_WORD[v.padConnection ?? 'thermal']);
  if (v.clearance !== undefined) k.SetLocalClearance(v.clearance);
  if (v.minThickness !== undefined) k.SetMinThickness(v.minThickness);
  if (v.thermalGap !== undefined) k.SetThermalReliefGap(v.thermalGap);
  if (v.thermalBridgeWidth !== undefined) k.SetThermalReliefSpokeWidth(v.thermalBridgeWidth);
  k.SetCornerSmoothingType(
    v.cornerSmoothing === 'chamfer'
      ? ZONE_SETTINGS.SMOOTHING_CHAMFER
      : v.cornerSmoothing === 'fillet'
        ? ZONE_SETTINGS.SMOOTHING_FILLET
        : ZONE_SETTINGS.SMOOTHING_NONE,
  );
  if (v.cornerRadius !== undefined) k.SetCornerRadius(v.cornerRadius);
  k.SetFillMode(v.fillMode === 'hatch' ? ZONE_FILL_MODE.HATCH_PATTERN : ZONE_FILL_MODE.POLYGONS);
  if (v.hatchThickness !== undefined) k.SetHatchThickness(v.hatchThickness);
  if (v.hatchGap !== undefined) k.SetHatchGap(v.hatchGap);
  if (
    v.hatchOrientation !== undefined &&
    k.GetHatchOrientation().AsDegrees() !== v.hatchOrientation
  )
    k.SetHatchOrientation(new EDA_ANGLE(v.hatchOrientation));
  if (v.hatchSmoothingLevel !== undefined) k.SetHatchSmoothingLevel(v.hatchSmoothingLevel);
  if (v.hatchSmoothingValue !== undefined) k.SetHatchSmoothingValue(v.hatchSmoothingValue);
  if (v.hatchHoleMinArea !== undefined) k.SetHatchHoleMinArea(v.hatchHoleMinArea);
  {
    const wanted = v.layerProperties ?? {};
    for (const [layer, props] of k.LayerProperties()) {
      if (!(layerName(layer) in wanted)) props.hatching_offset = undefined;
    }
    for (const [name, xy] of Object.entries(wanted)) {
      const id = layerId(name);
      const prev = k.LayerProperties().get(id);
      if (prev) prev.hatching_offset = copyVec(xy);
      else k.LayerProperties().set(id, new ZONE_LAYER_PROPERTIES(copyVec(xy)));
    }
  }
  k.SetIsFilled(v.filled ?? false);
  k.SetIslandRemovalMode(
    v.islandRemovalMode === 'never'
      ? ISLAND_REMOVAL_MODE.NEVER
      : v.islandRemovalMode === 'area'
        ? ISLAND_REMOVAL_MODE.AREA
        : ISLAND_REMOVAL_MODE.ALWAYS,
  );
  if (v.islandAreaMin !== undefined)
    k.SetMinIslandArea(v.islandAreaMin * pcbIUScale.IU_PER_MM * pcbIUScale.IU_PER_MM);
  k.SetAssignedPriority(v.priority ?? 0);
  k.SetIsRuleArea(v.ruleArea !== undefined || v.placementArea !== undefined);
  if (v.ruleArea) {
    k.SetDoNotAllowTracks(v.ruleArea.tracks);
    k.SetDoNotAllowVias(v.ruleArea.vias);
    k.SetDoNotAllowPads(v.ruleArea.pads);
    k.SetDoNotAllowZoneFills(v.ruleArea.copperPour);
    k.SetDoNotAllowFootprints(v.ruleArea.footprints);
  }
  if (v.placementArea) {
    k.SetPlacementAreaEnabled(v.placementArea.enabled);
    k.SetPlacementAreaSourceType(PLACEMENT_SOURCE_OF_VIEW[v.placementArea.sourceType]);
    k.SetPlacementAreaSource(v.placementArea.source);
  }
  k.SetLocked(v.locked ?? false);
  if (v.uuid) setUuid(k, v.uuid);
}

function zoneOfView(
  v: PcbZone,
  parent: BOARD | FOOTPRINT,
  board: BOARD,
  codes: NetCodes,
  copperLayerCount: number,
): ZONE {
  const k = v.k ?? new ZONE(parent);
  applyZone(k, v, board, codes, copperLayerCount);
  return k;
}

// ---------------------------------------------------------------------------
// Text boxes, tables, images, dimensions, barcodes, points, groups
// ---------------------------------------------------------------------------

/**
 * A text box's `(angle …)`: the text angle, footprint-relative for a
 * footprint's child (`format( const PCB_TEXTBOX* )`, :2361).
 */
function textBoxAngle(k: PCB_TEXTBOX): number {
  const parentFP = k.GetParentFootprint();
  let angle = k.GetTextAngle();
  if (parentFP) {
    angle = angle.sub(parentFP.GetOrientation());
    angle.Normalize720();
  }
  return angle.AsDegrees();
}

function textBoxView(k: PCB_TEXTBOX): PcbTextBox {
  const angle = textBoxAngle(k);
  const size = k.GetTextSize();
  const box: PcbTextBox = {
    text: k.GetText(),
    margins: {
      left: k.GetMarginLeft(),
      top: k.GetMarginTop(),
      right: k.GetMarginRight(),
      bottom: k.GetMarginBottom(),
    },
    angle: angle !== 0 ? angle : undefined,
    layer: layerName(k.GetLayer()),
    uuid: k.m_Uuid,
    face: k.GetFontName() || undefined,
    size: { x: size.x, y: size.y },
    thickness: k.GetTextThickness() === 0 ? undefined : k.GetTextThickness(),
    bold: k.IsBold(),
    italic: k.IsItalic(),
    justify: justifyWords(k),
    border: k.IsBorderEnabled(),
    strokeWidth: k.GetStroke().GetWidth(),
    strokeType: strokeType(k.GetStroke()),
    knockout: k.IsKnockout(),
    locked: k.IsLocked(),
    k,
  };
  if (k.GetShape() === SHAPE_T.RECTANGLE) {
    box.start = copyVec(k.GetStart());
    box.end = copyVec(k.GetEnd());
  } else {
    box.pts = outlinePoints(k.GetPolyShape());
  }
  return box;
}

function applyTextBox(k: PCB_TEXTBOX, v: PcbTextBox): void {
  if (k.GetText() !== v.text) k.SetText(v.text);
  // The polygon wins when a view somehow carries both: it is the form a
  // rotated box takes, and in the parser a `(pts …)` after `(start …)` wins too.
  if (v.pts) {
    if (k.GetShape() !== SHAPE_T.POLY || !sameVecs(outlinePoints(k.GetPolyShape()), v.pts)) {
      k.SetShape(SHAPE_T.POLY);
      k.SetPolyPoints(v.pts.map(copyVec));
    }
  } else if (v.start && v.end) {
    if (
      k.GetShape() !== SHAPE_T.RECTANGLE ||
      !sameVec(k.GetStart(), v.start) ||
      !sameVec(k.GetEnd(), v.end)
    ) {
      k.SetShape(SHAPE_T.RECTANGLE);
      k.SetStart(copyVec(v.start));
      k.SetEnd(copyVec(v.end));
    }
  }
  k.SetMarginLeft(v.margins.left);
  k.SetMarginTop(v.margins.top);
  k.SetMarginRight(v.margins.right);
  k.SetMarginBottom(v.margins.bottom);
  if (textBoxAngle(k) !== (v.angle ?? 0)) {
    // As the parser: "Set the angle of the text only, the coordinates of the
    // box (a polygon) are already at the right position, and must not be rotated".
    const parentFP = k.GetParentFootprint();
    let angle = new EDA_ANGLE(v.angle ?? 0);
    if (parentFP) angle = angle.add(parentFP.GetOrientation());
    PCB_TEXT.prototype.SetTextAngle.call(k, angle);
  }
  if (layerName(k.GetLayer()) !== v.layer) k.SetLayer(layerId(v.layer));
  k.SetBold(v.bold ?? false);
  k.SetItalic(v.italic ?? false);
  if ((k.GetFontName() || undefined) !== v.face) setFace(k, v.face, k.GetBoard());
  const size = k.GetTextSize();
  if (size.x !== v.size.x || size.y !== v.size.y) k.SetTextSize({ x: v.size.x, y: v.size.y });
  // `SetAutoThickness( true )` is `SetTextThickness( 0 )`.
  k.SetTextThickness(v.thickness ?? 0);
  if (!sameStrings(justifyWords(k), v.justify)) applyJustify(k, v.justify, undefined);
  k.SetBorderEnabled(v.border);
  const stroke = k.GetStroke();
  const width = v.strokeWidth ?? stroke.GetWidth();
  if (stroke.GetWidth() !== width || (v.strokeType && strokeType(stroke) !== v.strokeType))
    k.SetStroke(applyStroke(stroke, width, v.strokeType));
  k.SetIsKnockout(v.knockout ?? false);
  k.SetLocked(v.locked ?? false);
  if (v.uuid) setUuid(k, v.uuid);
}

function textBoxOfView(v: PcbTextBox, parent: BOARD_ITEM | null): PCB_TEXTBOX {
  const k = v.k ?? new PCB_TEXTBOX(parent);
  applyTextBox(k, v);
  return k;
}

function tableView(k: PCB_TABLE): PcbTable {
  const border = k.StrokeExternal() || k.StrokeHeaderSeparator();
  const seps = k.StrokeRows() || k.StrokeColumns();
  const columnWidths: number[] = [];
  for (let col = 0; col < k.GetColCount(); ++col) columnWidths.push(k.GetColWidth(col));
  const rowHeights: number[] = [];
  for (let row = 0; row < k.GetRowCount(); ++row) rowHeights.push(k.GetRowHeight(row));
  return {
    columnCount: k.GetColCount(),
    layer: layerName(k.GetLayer()),
    uuid: k.m_Uuid,
    locked: k.IsLocked(),
    borderExternal: k.StrokeExternal(),
    borderHeader: k.StrokeHeaderSeparator(),
    borderWidth: border ? k.GetBorderStroke().GetWidth() : undefined,
    borderStyle: border ? strokeType(k.GetBorderStroke()) : undefined,
    separatorRows: k.StrokeRows(),
    separatorCols: k.StrokeColumns(),
    separatorWidth: seps ? k.GetSeparatorsStroke().GetWidth() : undefined,
    separatorStyle: seps ? strokeType(k.GetSeparatorsStroke()) : undefined,
    columnWidths,
    rowHeights,
    cells: k.GetCells().map(
      (c) =>
        ({
          ...textBoxView(c),
          colSpan: c.GetColSpan(),
          rowSpan: c.GetRowSpan(),
          k: c,
        }) as PcbTableCell,
    ),
    k,
  };
}

function applyTable(k: PCB_TABLE, v: PcbTable): void {
  k.SetColCount(v.columnCount);
  if (layerName(k.GetLayer()) !== v.layer) k.SetLayer(layerId(v.layer));
  k.SetLocked(v.locked ?? false);
  k.SetStrokeExternal(v.borderExternal);
  k.SetStrokeHeaderSeparator(v.borderHeader);
  if (v.borderWidth !== undefined)
    k.SetBorderStroke(applyStroke(k.GetBorderStroke(), v.borderWidth, v.borderStyle));
  k.SetStrokeRows(v.separatorRows);
  k.SetStrokeColumns(v.separatorCols);
  if (v.separatorWidth !== undefined)
    k.SetSeparatorsStroke(applyStroke(k.GetSeparatorsStroke(), v.separatorWidth, v.separatorStyle));
  v.columnWidths.forEach((w, i) => k.SetColWidth(i, w));
  v.rowHeights.forEach((h, i) => k.SetRowHeight(i, h));
  const cells = v.cells.map((c) => {
    const cell = (c.k as PCB_TABLECELL | undefined) ?? new PCB_TABLECELL(k);
    applyTextBox(cell, c);
    cell.SetColSpan(c.colSpan);
    cell.SetRowSpan(c.rowSpan);
    return cell;
  });
  const same = cells.length === k.GetCells().length && cells.every((c, i) => c === k.GetCells()[i]);
  if (!same) {
    k.ClearCells();
    for (const cell of cells) k.AddCell(cell);
  }
  if (v.uuid) setUuid(k, v.uuid);
}

/** `wxBase64Encode`, the way `FormatStreamData` spells the bytes (without the line breaks). */
function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function imageView(k: PCB_REFERENCE_IMAGE): PcbImage {
  const refImage = k.GetReferenceImage();
  return {
    at: copyVec(k.GetPosition()),
    layer: layerName(k.GetLayer()),
    scale: refImage.GetImageScale() !== 1.0 ? refImage.GetImageScale() : undefined,
    locked: k.IsLocked(),
    data: base64Encode(refImage.GetImage().SaveImageData() ?? new Uint8Array(0)),
    uuid: k.m_Uuid,
    k,
  };
}

function applyImage(k: PCB_REFERENCE_IMAGE, v: PcbImage): void {
  const refImage = k.GetReferenceImage();
  if (!sameVec(k.GetPosition(), v.at)) k.SetPosition(copyVec(v.at));
  if (layerName(k.GetLayer()) !== v.layer) k.SetLayer(layerId(v.layer));
  if (refImage.GetImageScale() !== (v.scale ?? 1.0)) refImage.SetImageScale(v.scale ?? 1.0);
  k.SetLocked(v.locked ?? false);
  if (base64Encode(refImage.GetImage().SaveImageData() ?? new Uint8Array(0)) !== v.data)
    refImage.GetImage().ReadImageFile(base64Decode(v.data));
  if (v.uuid) setUuid(k, v.uuid);
}

const DIMENSION_KIND = (k: PCB_DIMENSION_BASE): DimensionKind => {
  // must be tested before aligned, because ortho is derived from aligned
  if (k instanceof PCB_DIM_ORTHOGONAL) return 'orthogonal';
  if (k instanceof PCB_DIM_ALIGNED) return 'aligned';
  if (k instanceof PCB_DIM_LEADER) return 'leader';
  if (k instanceof PCB_DIM_CENTER) return 'center';
  return 'radial';
};

function newDimension(kind: DimensionKind, parent: BOARD_ITEM | null): PCB_DIMENSION_BASE {
  switch (kind) {
    case 'aligned':
      return new PCB_DIM_ALIGNED(parent);
    case 'orthogonal':
      return new PCB_DIM_ORTHOGONAL(parent);
    case 'leader':
      return new PCB_DIM_LEADER(parent);
    case 'center':
      return new PCB_DIM_CENTER(parent);
    case 'radial':
      return new PCB_DIM_RADIAL(parent);
  }
}

export function dimensionView(k: PCB_DIMENSION_BASE): PcbDimension {
  const kind = DIMENSION_KIND(k);
  const aligned = k instanceof PCB_DIM_ALIGNED ? k : null;
  const center = kind === 'center';
  const format: DimensionFormat | undefined = center
    ? undefined
    : {
        prefix: k.GetPrefix(),
        suffix: k.GetSuffix(),
        units: k.GetUnitsMode() as number as DimUnitsMode,
        unitsFormat: k.GetUnitsFormat() as number as DimUnitsFormat,
        precision: k.GetPrecision() as number as DimPrecision,
        overrideValue: k.GetOverrideTextEnabled() ? k.GetOverrideText() : undefined,
        suppressZeroes: k.GetSuppressZeroes(),
      };
  const style: DimensionStyle = {
    thickness: k.GetLineThickness(),
    arrowLength: k.GetArrowLength(),
    textPositionMode: k.GetTextPositionMode() as number as DimTextPosition,
    arrowDirection: aligned
      ? k.GetArrowDirection() === DIM_ARROW_DIRECTION.INWARD
        ? 'inward'
        : 'outward'
      : undefined,
    extensionHeight: aligned ? aligned.GetExtensionHeight() : undefined,
    textFrame:
      k instanceof PCB_DIM_LEADER ? (k.GetTextBorder() as number as DimTextBorder) : undefined,
    extensionOffset: k.GetExtensionOffset(),
    keepTextAligned: k.GetKeepTextAligned(),
  };
  return {
    kind,
    layer: layerName(k.GetLayer()),
    locked: k.IsLocked(),
    uuid: k.m_Uuid,
    start: copyVec(k.GetStart()),
    end: copyVec(k.GetEnd()),
    height: aligned ? aligned.GetHeight() : undefined,
    leaderLength: k instanceof PCB_DIM_RADIAL ? k.GetLeaderLength() : undefined,
    orientation: k instanceof PCB_DIM_ORTHOGONAL ? (k.GetOrientation() as number) : undefined,
    format,
    style,
    text: center ? undefined : textView(k, 'user'),
    k,
  };
}

export function applyDimension(k: PCB_DIMENSION_BASE, v: PcbDimension): void {
  if (layerName(k.GetLayer()) !== v.layer) k.SetLayer(layerId(v.layer));
  k.SetLocked(v.locked ?? false);
  if (!sameVec(k.GetStart(), v.start)) k.SetStart(copyVec(v.start));
  if (!sameVec(k.GetEnd(), v.end)) k.SetEnd(copyVec(v.end));
  if (v.height !== undefined && k instanceof PCB_DIM_ALIGNED && k.GetHeight() !== v.height)
    k.SetHeight(v.height);
  if (v.leaderLength !== undefined && k instanceof PCB_DIM_RADIAL)
    k.SetLeaderLength(v.leaderLength);
  if (v.orientation !== undefined && k instanceof PCB_DIM_ORTHOGONAL)
    k.SetOrientation(v.orientation as number as PCB_DIM_ORTHOGONAL_DIR);
  if (v.format) {
    k.SetPrefix(v.format.prefix);
    k.SetSuffix(v.format.suffix);
    k.SetUnitsMode(v.format.units as number as DIM_UNITS_MODE);
    k.SetUnitsFormat(v.format.unitsFormat as number as DIM_UNITS_FORMAT);
    k.SetPrecision(v.format.precision as number as DIM_PRECISION);
    k.SetOverrideTextEnabled(v.format.overrideValue !== undefined);
    k.SetOverrideText(v.format.overrideValue ?? '');
    k.SetSuppressZeroes(v.format.suppressZeroes ?? false);
  }
  k.SetLineThickness(v.style.thickness);
  k.SetArrowLength(v.style.arrowLength);
  k.SetTextPositionMode(v.style.textPositionMode as number as DIM_TEXT_POSITION);
  if (v.style.arrowDirection)
    k.SetArrowDirection(
      v.style.arrowDirection === 'inward'
        ? DIM_ARROW_DIRECTION.INWARD
        : DIM_ARROW_DIRECTION.OUTWARD,
    );
  if (v.style.extensionHeight !== undefined && k instanceof PCB_DIM_ALIGNED)
    k.SetExtensionHeight(v.style.extensionHeight);
  if (v.style.textFrame !== undefined && k instanceof PCB_DIM_LEADER)
    k.SetTextBorder(v.style.textFrame as number as DIM_TEXT_BORDER);
  k.SetExtensionOffset(v.style.extensionOffset);
  if (v.style.keepTextAligned !== undefined) k.SetKeepTextAligned(v.style.keepTextAligned);
  if (v.text) {
    applyText(k, { ...v.text, layer: v.layer, locked: v.locked, uuid: undefined }, k.GetText());
  }
  if (v.uuid) setUuid(k, v.uuid);
  k.Update();
}

/**
 * The dimension for a view: the model it carries when its kind still fits,
 * else a new one of the right class (a kind change is a new item in KiCad).
 */
function dimensionOfView(v: PcbDimension, parent: BOARD_ITEM | null): PCB_DIMENSION_BASE {
  let k = v.k;
  if (!k || DIMENSION_KIND(k) !== v.kind) {
    const fresh = newDimension(v.kind, parent);
    if (k) setUuid(fresh, k.m_Uuid);
    k = fresh;
  }
  applyDimension(k, v);
  return k;
}

const BARCODE_KIND: Record<number, BarcodeKind> = {
  [BARCODE_T.CODE_39]: 'code39',
  [BARCODE_T.CODE_128]: 'code128',
  [BARCODE_T.DATA_MATRIX]: 'datamatrix',
  [BARCODE_T.QR_CODE]: 'qr',
  [BARCODE_T.MICRO_QR_CODE]: 'microqr',
};
const BARCODE_T_OF_KIND: Record<BarcodeKind, BARCODE_T> = {
  code39: BARCODE_T.CODE_39,
  code128: BARCODE_T.CODE_128,
  datamatrix: BARCODE_T.DATA_MATRIX,
  qr: BARCODE_T.QR_CODE,
  microqr: BARCODE_T.MICRO_QR_CODE,
};
const BARCODE_ECC: Record<number, BarcodeEcc> = {
  [BARCODE_ECC_T.L]: 'L',
  [BARCODE_ECC_T.M]: 'M',
  [BARCODE_ECC_T.Q]: 'Q',
  [BARCODE_ECC_T.H]: 'H',
};
const BARCODE_ECC_T_OF: Record<BarcodeEcc, BARCODE_ECC_T> = {
  L: BARCODE_ECC_T.L,
  M: BARCODE_ECC_T.M,
  Q: BARCODE_ECC_T.Q,
  H: BARCODE_ECC_T.H,
};

function barcodeView(k: PCB_BARCODE): PcbBarcode {
  return {
    at: copyVec(k.GetPosition()),
    angle: k.GetAngle().AsDegrees(),
    layer: layerName(k.GetLayer()),
    width: k.GetWidth(),
    height: k.GetHeight(),
    text: k.GetText(),
    textHeight: k.GetTextSize(),
    kind: BARCODE_KIND[k.GetKind()] ?? 'qr',
    ecc: BARCODE_ECC[k.GetErrorCorrection()] ?? 'L',
    showText: k.GetShowText(),
    knockout: k.IsKnockout(),
    margin: copyVec(k.GetMargin()),
    uuid: k.m_Uuid,
    locked: k.IsLocked(),
    k,
  };
}

function applyBarcode(k: PCB_BARCODE, v: PcbBarcode): void {
  // `AssembleBarcode()` is what the dialog runs after an edit; an untouched
  // barcode keeps the symbol the parser assembled.
  const before = barcodeView(k);
  if (!sameVec(k.GetPosition(), v.at)) k.SetPosition(copyVec(v.at));
  if (k.GetAngle().AsDegrees() !== v.angle) k.SetOrientation(v.angle);
  if (layerName(k.GetLayer()) !== v.layer) k.SetLayer(layerId(v.layer));
  if (before.width !== v.width) k.SetWidth(v.width);
  if (before.height !== v.height) k.SetHeight(v.height);
  if (before.text !== v.text) k.SetText(v.text);
  if (before.textHeight !== v.textHeight) k.SetTextSize(v.textHeight);
  if (before.kind !== v.kind) k.SetKind(BARCODE_T_OF_KIND[v.kind]);
  if (before.ecc !== v.ecc) k.SetErrorCorrection(BARCODE_ECC_T_OF[v.ecc]);
  if (before.showText !== v.showText) k.SetShowText(v.showText);
  if (before.knockout !== v.knockout) k.SetIsKnockout(v.knockout);
  if (!sameVec(before.margin, v.margin)) k.SetMargin(copyVec(v.margin));
  k.SetLocked(v.locked ?? false);
  if (v.uuid) setUuid(k, v.uuid);
  const symbol =
    before.width !== v.width ||
    before.height !== v.height ||
    before.text !== v.text ||
    before.textHeight !== v.textHeight ||
    before.kind !== v.kind ||
    before.ecc !== v.ecc ||
    before.showText !== v.showText ||
    !sameVec(before.margin, v.margin);
  if (symbol) k.AssembleBarcode();
}

function pointView(k: PCB_POINT): PcbPoint {
  return {
    at: copyVec(k.GetPosition()),
    size: k.GetSize(),
    layer: layerName(k.GetLayer()),
    uuid: k.m_Uuid,
    locked: k.IsLocked(),
    k,
  };
}

function applyPoint(k: PCB_POINT, v: PcbPoint): void {
  if (!sameVec(k.GetPosition(), v.at)) k.SetPosition(copyVec(v.at));
  k.SetSize(v.size);
  if (layerName(k.GetLayer()) !== v.layer) k.SetLayer(layerId(v.layer));
  k.SetLocked(v.locked ?? false);
  if (v.uuid) setUuid(k, v.uuid);
}

function groupView(k: PCB_GROUP): PcbGroup {
  const members: string[] = [];
  for (const item of k.GetItems()) members.push(item.m_Uuid);
  return {
    name: k.GetName(),
    uuid: k.m_Uuid,
    locked: k.IsLocked(),
    members,
    k,
  };
}

/** `PCB_GROUP::AddItem` for every member the view names — resolved on the board, once every item is there. */
function applyGroupMembers(k: PCB_GROUP, v: PcbGroup, board: BOARD): void {
  const current: string[] = [];
  for (const item of k.GetItems()) current.push(item.m_Uuid);
  if (sameStrings(current, v.members)) return;
  k.RemoveAll();
  for (const uuid of v.members) {
    const item = board.ResolveItem(uuid, true);
    if (item && item !== k) k.AddItem(item);
  }
}

function applyGroup(k: PCB_GROUP, v: PcbGroup): void {
  k.SetName(v.name);
  k.SetLocked(v.locked ?? false);
  if (v.uuid) setUuid(k, v.uuid);
}

function modelView(m: FP_3DMODEL): Model3D {
  return {
    path: m.m_Filename,
    offset: { ...m.m_Offset },
    scale: { ...m.m_Scale },
    rotate: { ...m.m_Rotation },
    hide: !m.m_Show,
    ...(m.m_Opacity < 1 ? { opacity: m.m_Opacity } : {}),
  };
}

function modelOfView(v: Model3D): FP_3DMODEL {
  const m = new FP_3DMODEL();
  m.m_Filename = v.path;
  m.m_Show = !v.hide;
  m.m_Opacity = v.opacity ?? 1.0;
  m.m_Offset = { ...v.offset };
  m.m_Scale = { ...v.scale };
  m.m_Rotation = { ...v.rotate };
  return m;
}

const sameModel = (m: FP_3DMODEL, v: Model3D): boolean =>
  m.m_Filename === v.path &&
  m.m_Show === !v.hide &&
  m.m_Opacity === (v.opacity ?? 1.0) &&
  m.m_Offset.x === v.offset.x &&
  m.m_Offset.y === v.offset.y &&
  m.m_Offset.z === v.offset.z &&
  m.m_Scale.x === v.scale.x &&
  m.m_Scale.y === v.scale.y &&
  m.m_Scale.z === v.scale.z &&
  m.m_Rotation.x === v.rotate.x &&
  m.m_Rotation.y === v.rotate.y &&
  m.m_Rotation.z === v.rotate.z;

// ---------------------------------------------------------------------------
// Footprints
// ---------------------------------------------------------------------------

/** The `(attr …)` words `format( FOOTPRINT )` writes, in its order. */
function attrWords(k: FOOTPRINT): string[] | undefined {
  const words: string[] = [];
  const a = k.GetAttributes();
  if (a & FP_SMD) words.push('smd');
  if (a & FP_THROUGH_HOLE) words.push('through_hole');
  if (a & FP_BOARD_ONLY) words.push('board_only');
  if (a & FP_EXCLUDE_FROM_POS_FILES) words.push('exclude_from_pos_files');
  if (a & FP_EXCLUDE_FROM_BOM) words.push('exclude_from_bom');
  if (k.AllowMissingCourtyard()) words.push('allow_missing_courtyard');
  if (a & FP_DNP) words.push('dnp');
  if (k.AllowSolderMaskBridges()) words.push('allow_soldermask_bridges');
  return words.length > 0 ? words : undefined;
}

function applyAttrWords(k: FOOTPRINT, words: readonly string[] | undefined): void {
  const w = words ?? [];
  let bits = 0;
  if (w.includes('smd')) bits |= FP_SMD;
  if (w.includes('through_hole')) bits |= FP_THROUGH_HOLE;
  if (w.includes('board_only')) bits |= FP_BOARD_ONLY;
  if (w.includes('exclude_from_pos_files')) bits |= FP_EXCLUDE_FROM_POS_FILES;
  if (w.includes('exclude_from_bom')) bits |= FP_EXCLUDE_FROM_BOM;
  if (w.includes('dnp')) bits |= FP_DNP;
  k.SetAttributes(bits);
  k.SetAllowMissingCourtyard(w.includes('allow_missing_courtyard'));
  k.SetAllowSolderMaskBridges(w.includes('allow_soldermask_bridges'));
}

/** `FOOTPRINT::ResolveTextVar` for the two names the reader has always resolved on a board. */
function shownText(
  text: string,
  fp: { reference?: string; value?: string },
  local: boolean,
): string {
  if (local || !text.includes('${')) return text;
  return text.replaceAll('${REFERENCE}', fp.reference ?? '').replaceAll('${VALUE}', fp.value ?? '');
}

function footprintView(k: FOOTPRINT, copperLayerCount: number, local = false): PcbFootprint {
  const zc = k.GetLocalZoneConnection();
  const fp: PcbFootprint = {
    lib: k.GetFPID().Format(),
    at: copyVec(k.GetPosition()),
    angle: k.GetOrientation().AsDegrees(),
    layer: layerName(k.GetLayer()),
    descr: k.GetLibDescription() || undefined,
    tags: k.GetKeywords() || undefined,
    attributes: attrWords(k),
    netTiePadGroups: k.GetNetTiePadGroups().length > 0 ? [...k.GetNetTiePadGroups()] : undefined,
    localClearance: k.GetLocalClearance(),
    localSolderMaskMargin: k.GetLocalSolderMaskMargin(),
    localSolderPasteMargin: k.GetLocalSolderPasteMargin(),
    localSolderPasteMarginRatio: k.GetLocalSolderPasteMarginRatio(),
    zoneConnection: zc !== ZONE_CONNECTION.INHERITED ? zoneConnectionFromCode(zc) : undefined,
    locked: k.IsLocked(),
    path: k.GetPath().length > 0 ? kiidPathAsString(k.GetPath()) : undefined,
    sheetname: k.GetSheetname() || undefined,
    sheetfile: k.GetSheetfile() || undefined,
    filters: k.GetFilters() || undefined,
    fields: [],
    pads: [],
    shapes: [],
    texts: [],
    points: [],
    barcodes: [],
    models: [],
    uuid: k.m_Uuid,
    k,
  };
  for (const field of k.GetFields()) {
    if (!field) continue;
    if (field.GetId() === FIELD_T.REFERENCE || field.GetId() === FIELD_T.VALUE) {
      const kind = field.GetId() === FIELD_T.REFERENCE ? 'reference' : 'value';
      fp.texts.push(textView(field, kind));
      if (kind === 'reference') fp.reference = field.GetText();
      else fp.value = field.GetText();
    } else {
      fp.fields!.push({ name: field.GetCanonicalName(), value: field.GetText(), k: field });
    }
  }
  for (const gr of k.GraphicalItems()) {
    if (gr.Type() === KICAD_T.PCB_SHAPE_T) fp.shapes.push(shapeView(gr as PCB_SHAPE));
    else if (gr.Type() === KICAD_T.PCB_BARCODE_T) fp.barcodes.push(barcodeView(gr as PCB_BARCODE));
    else if (gr.Type() === KICAD_T.PCB_TEXT_T) fp.texts.push(textView(gr as PCB_TEXT, 'user'));
  }
  for (const pad of k.Pads()) fp.pads.push(padView(pad, copperLayerCount));
  for (const pt of k.Points()) fp.points.push(pointView(pt));
  for (const m of k.Models()) fp.models.push(modelView(m));
  // KiCad resolves text variables when rendering; ${REFERENCE}/${VALUE} are by
  // far the common ones on Fab layers — but not on a footprint-holder board.
  for (const tx of fp.texts) tx.text = shownText(tx.text, fp, local);
  return fp;
}

/**
 * The item a view child stands for on `fp`: its own model when that is a
 * child of `fp`; on a copy of the footprint (`FOOTPRINT( const FOOTPRINT& )`
 * keeps every child's uuid), the copy's child of the same uuid.
 */
function childOf<T extends BOARD_ITEM>(
  fp: FOOTPRINT,
  k: T | undefined,
  list: readonly T[],
): T | undefined {
  if (!k) return undefined;
  if (k.GetParent() === fp) return k;
  return list.find((c) => c.m_Uuid === k.m_Uuid);
}

function applyFootprint(
  k: FOOTPRINT,
  v: PcbFootprint,
  board: BOARD,
  codes: NetCodes,
  copperLayerCount: number,
  seen: Seen,
): void {
  if (k.GetFPID().Format() !== v.lib) k.SetFPIDAsString(v.lib);
  // `SetPosition` / `SetOrientation` carry every child, so a view whose
  // children are already where the placement says (the common case) must
  // not move them twice: the placement is applied while the children are
  // the model's own, and the view's positions are written over them after.
  if (!sameVec(k.GetPosition(), v.at)) k.SetPosition(copyVec(v.at));
  if (k.GetOrientation().AsDegrees() !== v.angle) k.SetOrientation(new EDA_ANGLE(v.angle));
  if (layerName(k.GetLayer()) !== v.layer) k.SetLayer(layerId(v.layer));
  k.SetLibDescription(v.descr ?? '');
  k.SetKeywords(v.tags ?? '');
  if (!sameStrings(attrWords(k), v.attributes)) applyAttrWords(k, v.attributes);
  if (!sameStrings(k.GetNetTiePadGroups(), v.netTiePadGroups ?? [])) {
    k.ClearNetTiePadGroups();
    for (const g of v.netTiePadGroups ?? []) k.AddNetTiePadGroup(g);
  }
  k.SetLocalClearance(v.localClearance);
  k.SetLocalSolderMaskMargin(v.localSolderMaskMargin);
  k.SetLocalSolderPasteMargin(v.localSolderPasteMargin);
  k.SetLocalSolderPasteMarginRatio(v.localSolderPasteMarginRatio);
  k.SetLocalZoneConnection(
    v.zoneConnection !== undefined
      ? (ZONE_CONNECTION_CODE[v.zoneConnection] as ZONE_CONNECTION)
      : ZONE_CONNECTION.INHERITED,
  );
  k.SetLocked(v.locked ?? false);
  const path = v.path ?? '';
  if (kiidPathAsString(k.GetPath()) !== path)
    k.SetPath(
      path === ''
        ? []
        : path
            .split('/')
            .filter((s) => s !== '')
            .map(kiidFromString),
    );
  k.SetSheetname(v.sheetname ?? '');
  k.SetSheetfile(v.sheetfile ?? '');
  k.SetFilters(v.filters ?? '');
  if (v.uuid) setUuid(k, v.uuid);

  // Fields: the two mandatory texts from `texts`, the rest from `fields`; the
  // model's other mandatory fields (Datasheet, Description) appear in `fields`.
  const shown = { reference: v.reference, value: v.value };
  const byRole = (role: 'reference' | 'value', tx: PcbTextItem | undefined): void => {
    const field = role === 'reference' ? k.Reference() : k.Value();
    if (tx) applyText(field, { ...tx, uuid: tx.uuid }, shownText(field.GetText(), shown, false));
    const wanted = role === 'reference' ? v.reference : v.value;
    if (wanted !== undefined && wanted !== field.GetText() && (!tx || tx.text === field.GetText()))
      field.SetText(wanted);
  };
  byRole(
    'reference',
    v.texts.find((x) => x.kind === 'reference'),
  );
  byRole(
    'value',
    v.texts.find((x) => x.kind === 'value'),
  );
  const fields: PCB_FIELD[] = [k.Reference(), k.Value()];
  const rest = new Map<string, PCB_FIELD>();
  for (const f of k.GetFields()) {
    if (!f) continue;
    if (f.GetId() !== FIELD_T.REFERENCE && f.GetId() !== FIELD_T.VALUE)
      rest.set(f.GetCanonicalName(), f);
  }
  const placed = new Set<PCB_FIELD>();
  for (const f of v.fields ?? []) {
    let kf = childOf(k, f.k, k.GetFields()) ?? rest.get(f.name);
    if (!kf || placed.has(kf)) {
      // `BOARD_NETLIST_UPDATER::updateFootprintParameters` (:607-620): a new
      // PCB_FIELD, hidden, on the parent's fab layer, at the anchor, then
      // `StyleFromSettings( bds, true )` — the fab class of a default
      // BOARD_DESIGN_SETTINGS (board_design_settings.cpp:111-116), since the
      // project's own text defaults are not part of the board model.
      kf = new PCB_FIELD(k, FIELD_T.USER, f.name);
      kf.SetVisible(false);
      kf.SetLayer((k.GetLayer() === F_Cu ? F_Fab : B_Fab) as PCB_LAYER_ID);
      kf.SetTextPos(copyVec(k.GetPosition()));
      kf.SetTextSize({ x: pcbIUScale.mmToIU(1.0), y: pcbIUScale.mmToIU(1.0) });
      kf.SetTextThickness(pcbIUScale.mmToIU(0.15));
      kf.SetItalic(false);
      kf.SetKeepUpright(false);
      kf.SetMirrored(k.GetLayer() !== F_Cu);
    }
    if (kf.GetText() !== f.value) kf.SetText(f.value);
    if (kf.GetId() === FIELD_T.USER && kf.GetName() !== f.name) kf.SetName(f.name);
    placed.add(kf);
    fields.push(kf);
  }
  // Mandatory fields the view does not list (Datasheet, Description) stay.
  for (const f of k.GetFields()) {
    if (!f) continue;
    if (f.GetId() === FIELD_T.DATASHEET || f.GetId() === FIELD_T.DESCRIPTION) {
      if (!placed.has(f)) fields.splice(2, 0, f);
    }
  }
  syncChildren(k, k.GetFields(), fields);

  // Graphical items: shapes, user texts and barcodes from the view; the kinds
  // the view does not model keep their place.
  const graphical: BOARD_ITEM[] = [];
  const currentGraphics = k.GraphicalItems();
  for (const s of v.shapes) {
    const own = childOf(k, s.k, currentGraphics as PCB_SHAPE[]);
    graphical.push(seen.take(shapeOfView({ ...s, k: own }, k, board, codes), k));
  }
  for (const tx of v.texts) {
    if (tx.kind !== 'user') continue;
    const own = childOf(k, tx.k, currentGraphics as PCB_TEXT[]) ?? new PCB_TEXT(k);
    applyText(own, tx, shownText(own.GetText(), shown, false));
    graphical.push(seen.take(own, k));
  }
  for (const b of v.barcodes) {
    const own = childOf(k, b.k, currentGraphics as PCB_BARCODE[]) ?? new PCB_BARCODE(k);
    applyBarcode(own, b);
    graphical.push(seen.take(own, k));
  }
  for (const gr of currentGraphics) {
    const t = gr.Type();
    if (t !== KICAD_T.PCB_SHAPE_T && t !== KICAD_T.PCB_TEXT_T && t !== KICAD_T.PCB_BARCODE_T)
      graphical.push(gr);
  }
  syncChildren(k, currentGraphics, graphical);

  const currentPads = k.Pads();
  const pads = v.pads.map((p) => {
    const own = childOf(k, p.k, currentPads) ?? new PAD(k);
    applyPad(own, p, board, codes, copperLayerCount);
    return seen.take(own, k);
  });
  syncChildren(k, currentPads, pads);

  const currentPoints = k.Points();
  const points = v.points.map((p) => {
    const own = childOf(k, p.k, currentPoints) ?? new PCB_POINT(k);
    applyPoint(own, p);
    return seen.take(own, k);
  });
  syncChildren(k, currentPoints, points);

  const models = k.Models();
  if (models.length !== v.models.length || !models.every((m, i) => sameModel(m, v.models[i]!))) {
    models.length = 0;
    for (const m of v.models) k.Add3DModel(modelOfView(m));
  }
}

/**
 * A container's child list made to be `wanted`: children no longer wanted
 * are `Remove`d, new ones `Add`ed (`APPEND`, connectivity skipped — the
 * board's connectivity is rebuilt by its owner), the order of the survivors
 * kept. `list` is the container's own array, read before any change.
 */
function syncChildren<T extends BOARD_ITEM>(
  container: BOARD | FOOTPRINT,
  list: readonly T[],
  wanted: readonly T[],
): void {
  const wantedSet = new Set<T>(wanted);
  const bulk = container instanceof BOARD;
  for (const item of [...list]) {
    if (!wantedSet.has(item)) container.Remove(item, bulk ? REMOVE_MODE.BULK : REMOVE_MODE.NORMAL);
  }
  const have = new Set<T>(list);
  for (const item of wanted) {
    if (!have.has(item)) {
      container.Add(item, bulk ? ADD_MODE.BULK_APPEND : ADD_MODE.APPEND, true);
      have.add(item);
    }
  }
}

/**
 * Which model items the view has already claimed in this write. An item
 * reached from two view items (a duplicate made by spreading the view) is
 * `Duplicate()`d for the second — a second view of one item on the same
 * board is another item, with its own uuid. A borrowed item (a detached
 * view — a clipboard payload — whose items belong to another board's model)
 * is `Clone()`d and never written to; a clone keeps its identity.
 */
class Seen {
  private readonly items = new Set<BOARD_ITEM>();
  constructor(private readonly borrowed: boolean) {}

  take<T extends BOARD_ITEM>(k: T, parent: BOARD_ITEM | null): T {
    if (!this.items.has(k) && !this.borrowed) {
      this.items.add(k);
      return k;
    }
    const copy = (this.borrowed ? k.Clone() : k.Duplicate(false)) as T;
    copy.SetParent(parent);
    this.items.add(copy);
    return copy;
  }
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/**
 * The view object each model item was last in step with: the one
 * `boardFromBOARD` made from it, or the one `boardToBOARD` last applied to
 * it. The view is immutable -- an edit replaces the item's object and every
 * container above it -- so an item whose view object is still the registered
 * one has nothing to write back, and the write-back walks only what an edit
 * touched. Without this every commit and every autosave re-applied all
 * 100k items of a large board (0.5 s of `applyFootprint` for one moved part).
 */
const synced = new WeakMap<BOARD_ITEM, object>();

/** Note that `v` is the view `k` is in step with. */
function noteSynced<K extends BOARD_ITEM>(k: K, v: object): K {
  synced.set(k, v);
  return k;
}

/** Every item view of a board just derived, registered as in step. */
function noteBoardSynced(board: Board): void {
  for (const fp of board.footprints) if (fp.k) synced.set(fp.k, fp);
  for (const list of [
    board.tracks,
    board.arcs,
    board.vias,
    board.zones,
    board.shapes,
    board.texts,
    board.textBoxes,
    board.tables,
    board.images,
    board.dimensions,
    board.points,
    board.barcodes,
    board.groups,
  ] as { k?: BOARD_ITEM }[][])
    for (const it of list) if (it.k) synced.set(it.k, it);
}

/**
 * The copper layer count the registered views were derived against. A pad's
 * layer set is written back against the board's count (`*.Cu` is that many
 * layers), so a board whose count moved re-applies every item.
 */
const syncedCu = new WeakMap<BOARD, number>();

/**
 * `Board` as a view of the BOARD; `board.k` is the model itself.
 *
 * `aUnchanged`, when the caller knows which items a commit or an undo
 * touched (the BOARD_LISTENER's lists), says which did NOT move: those keep
 * the view object they are in step with (`synced`), so re-deriving the view
 * after an edit costs the edit's items, not the board's. A footprint's
 * children ride with it: the caller names the footprint when a pad moved.
 */
export function boardFromBOARD(
  kb: BOARD,
  fileName?: string,
  aUnchanged?: (k: BOARD_ITEM) => boolean,
): Board {
  const cu = kb.GetCopperLayerCount();
  const bds = kb.GetDesignSettings();
  const kept = <V extends object>(k: BOARD_ITEM): V | undefined =>
    aUnchanged?.(k) && syncedCu.get(kb) === cu ? (synced.get(k) as V | undefined) : undefined;
  const board: Board = {
    version: kb.GetFileFormatVersionAtLoad(),
    thickness: bds.GetBoardThickness(),
    legacyTeardrops: kb.LegacyTeardrops(),
    paper: paperOfPageInfo(kb.GetPageSettings()),
    titleBlock: titleBlockView(kb.GetTitleBlock()),
    layers: layerTableView(kb),
    nets: netsView(kb),
    gridOrigin: copyVec(bds.GetGridOrigin()),
    auxOrigin: copyVec(bds.GetAuxOrigin()),
    footprints: kb.Footprints().map((fp) => kept<PcbFootprint>(fp) ?? footprintView(fp, cu)),
    tracks: [],
    arcs: [],
    vias: [],
    zones: kb.Zones().map((z) => kept<PcbZone>(z) ?? zoneView(z, cu)),
    shapes: [],
    texts: [],
    textBoxes: [],
    tables: [],
    images: [],
    dimensions: [],
    points: kb.Points().map((p) => kept<PcbPoint>(p) ?? pointView(p)),
    barcodes: [],
    groups: kb.Groups().map((g) => kept<PcbGroup>(g) ?? groupView(g)),
    fileName,
    k: kb,
  };
  for (const t of kb.Tracks()) {
    if (t instanceof PCB_VIA) board.vias.push(kept<PcbVia>(t) ?? viaView(t));
    else if (t instanceof PCB_ARC) board.arcs.push(kept<PcbArcTrack>(t) ?? arcView(t));
    else board.tracks.push(kept<PcbTrack>(t) ?? trackView(t));
  }
  for (const d of kb.Drawings()) {
    switch (d.Type()) {
      case KICAD_T.PCB_SHAPE_T:
        board.shapes.push(kept<PcbShape>(d) ?? shapeView(d as PCB_SHAPE));
        break;
      case KICAD_T.PCB_TEXT_T:
        board.texts.push(kept<PcbTextItem>(d) ?? textView(d as PCB_TEXT, 'user'));
        break;
      case KICAD_T.PCB_TEXTBOX_T:
        board.textBoxes.push(kept<PcbTextBox>(d) ?? textBoxView(d as PCB_TEXTBOX));
        break;
      case KICAD_T.PCB_TABLE_T:
        board.tables.push(kept<PcbTable>(d) ?? tableView(d as PCB_TABLE));
        break;
      case KICAD_T.PCB_REFERENCE_IMAGE_T:
        board.images.push(kept<PcbImage>(d) ?? imageView(d as PCB_REFERENCE_IMAGE));
        break;
      case KICAD_T.PCB_BARCODE_T:
        board.barcodes.push(kept<PcbBarcode>(d) ?? barcodeView(d as PCB_BARCODE));
        break;
      case KICAD_T.PCB_DIM_ALIGNED_T:
      case KICAD_T.PCB_DIM_ORTHOGONAL_T:
      case KICAD_T.PCB_DIM_LEADER_T:
      case KICAD_T.PCB_DIM_CENTER_T:
      case KICAD_T.PCB_DIM_RADIAL_T:
        board.dimensions.push(kept<PcbDimension>(d) ?? dimensionView(d as PCB_DIMENSION_BASE));
        break;
      default:
        // PCB_TARGET: not modelled, stays on the board.
        break;
    }
  }
  noteBoardSynced(board);
  syncedCu.set(kb, cu);
  return board;
}

/**
 * A library `(footprint …)` in its own frame, `readFootprintFile`'s view: the
 * anchor at the origin, no rotation — what `FootprintSave` wrote, and what the
 * Footprint Editor works in.
 */
export function footprintViewOfLibrary(k: FOOTPRINT): PcbFootprint {
  if (!k.GetOrientation().IsZero()) k.SetOrientation(ANGLE_0);
  if (k.GetPosition().x !== 0 || k.GetPosition().y !== 0) k.SetPosition({ x: 0, y: 0 });
  return footprintView(k, 2, true);
}

/**
 * A footprint placed on a board, children in board coordinates through its
 * placement (the parser's `Rotate` + `Move`). The layer tokens of its pads
 * are derived for a two-layer board; `boardToBOARD` re-derives them against
 * the board it lands on.
 */
export function footprintViewOfBoard(k: FOOTPRINT, copperLayerCount = 2): PcbFootprint {
  return footprintView(k, copperLayerCount, false);
}

/**
 * The view written back into the model: the editor's fields where they
 * differ from what the model would show, every item list brought to the
 * view's (so deleted items go, added ones get a fresh class item), and the
 * BOARD returned for the formatter.
 */
export function boardToBOARD(board: Board): BOARD {
  const kb = board.k ?? emptyBOARD();
  // A board without a model of its own borrows its items' models from the
  // board they were copied out of; those are cloned, never written to.
  const seen = new Seen(!board.k);
  const bds = kb.GetDesignSettings();

  // Header.
  if (board.thickness !== undefined) bds.SetBoardThickness(board.thickness);
  kb.SetLegacyTeardrops(board.legacyTeardrops ?? false);
  if (board.gridOrigin) bds.SetGridOrigin(copyVec(board.gridOrigin));
  if (board.auxOrigin) bds.SetAuxOrigin(copyVec(board.auxOrigin));
  if (board.paper !== undefined && paperOfPageInfo(kb.GetPageSettings()) !== board.paper)
    kb.SetPageSettings(pageInfoOfPaper(board.paper, kb.GetPageSettings()));
  if (!sameTitleBlock(titleBlockView(kb.GetTitleBlock()), board.titleBlock))
    kb.SetTitleBlock(titleBlockOfView(board.titleBlock));
  if (!sameLayerRows(layerTableView(kb), board.layers)) applyLayerTable(kb, board.layers);
  const cu = kb.GetCopperLayerCount();
  const codes = applyNets(kb, board.nets);

  // Footprints. A footprint's children are written after the footprint is a
  // member of the board, so a child's net lookup sees the board's table.
  // A borrowed model (`seen` of a board without one) is cloned, so the clone
  // is what gets written and the registry says nothing about it.
  const fastPath = !!board.k && syncedCu.get(kb) === cu;
  const inStep = (v: { k?: BOARD_ITEM }): boolean =>
    fastPath && v.k !== undefined && synced.get(v.k) === v;
  const footprints = board.footprints.map((fp) => seen.take(fp.k ?? new FOOTPRINT(kb), kb));
  syncChildren(kb, kb.Footprints(), footprints);
  board.footprints.forEach((fp, i) => {
    if (inStep(fp)) return;
    applyFootprint(footprints[i]!, fp, kb, codes, cu, seen);
    synced.set(footprints[i]!, fp);
  });

  const drawings: BOARD_ITEM[] = [];
  for (const s of board.shapes)
    drawings.push(seen.take(inStep(s) ? s.k! : noteSynced(shapeOfView(s, kb, kb, codes), s), kb));
  for (const tx of board.texts)
    drawings.push(seen.take(inStep(tx) ? tx.k! : noteSynced(textOfView(tx, kb), tx), kb));
  for (const tb of board.textBoxes)
    drawings.push(seen.take(inStep(tb) ? tb.k! : noteSynced(textBoxOfView(tb, kb), tb), kb));
  for (const tb of board.tables) {
    const k = seen.take(tb.k ?? new PCB_TABLE(kb, -1), kb);
    if (!inStep(tb)) {
      applyTable(k, tb);
      synced.set(k, tb);
    }
    drawings.push(k);
  }
  for (const img of board.images) {
    const k = seen.take(img.k ?? new PCB_REFERENCE_IMAGE(kb), kb);
    if (!inStep(img)) {
      applyImage(k, img);
      synced.set(k, img);
    }
    drawings.push(k);
  }
  for (const b of board.barcodes) {
    const k = seen.take(b.k ?? new PCB_BARCODE(kb), kb);
    if (!inStep(b)) {
      applyBarcode(k, b);
      synced.set(k, b);
    }
    drawings.push(k);
  }
  for (const d of board.dimensions)
    drawings.push(seen.take(inStep(d) ? d.k! : noteSynced(dimensionOfView(d, kb), d), kb));
  for (const d of kb.Drawings()) if (d.Type() === KICAD_T.PCB_TARGET_T) drawings.push(d);
  syncChildren(kb, kb.Drawings(), drawings);

  const tracks: PCB_TRACK[] = [];
  for (const t of board.tracks) {
    const k = seen.take(t.k ?? new PCB_TRACK(kb), kb);
    if (!inStep(t)) {
      applyTrack(k, t, kb, codes);
      synced.set(k, t);
    }
    tracks.push(k);
  }
  for (const a of board.arcs) {
    const k = seen.take(a.k ?? new PCB_ARC(kb), kb);
    if (!inStep(a)) {
      applyTrack(k, a, kb, codes);
      synced.set(k, a);
    }
    tracks.push(k);
  }
  for (const v of board.vias) {
    const k = seen.take(v.k ?? new PCB_VIA(kb), kb);
    if (!inStep(v)) {
      applyVia(k, v, kb, codes);
      synced.set(k, v);
    }
    tracks.push(k);
  }
  syncChildren(kb, kb.Tracks(), tracks);

  const points = board.points.map((p) => {
    const k = seen.take(p.k ?? new PCB_POINT(kb), kb);
    if (!inStep(p)) {
      applyPoint(k, p);
      synced.set(k, p);
    }
    return k;
  });
  syncChildren(kb, kb.Points(), points);

  const zones = board.zones.map((z) =>
    seen.take(inStep(z) ? z.k! : noteSynced(zoneOfView(z, kb, kb, codes, cu), z), kb),
  );
  syncChildren(kb, kb.Zones(), zones);

  const groups = board.groups.map((g) => {
    const k = seen.take(g.k ?? new PCB_GROUP(kb), kb);
    if (!inStep(g)) {
      applyGroup(k, g);
      synced.set(k, g);
    }
    return k;
  });
  syncChildren(kb, kb.Groups(), groups);
  // Members are resolved again, now that every item is on the board: a
  // group may name items that went away.
  board.groups.forEach((g, i) => applyGroupMembers(groups[i]!, g, kb));
  kb.GroupsSanityCheck(true);

  kb.FinalizeBulkAdd([]);
  kb.FinalizeBulkRemove([]);
  if (board.k) syncedCu.set(kb, cu);
  return kb;
}

/**
 * A footprint's view back into a model of its own — `FOOTPRINT::Clone()` with
 * the editor's fields applied over it, its placement as the view says. The
 * Footprint Editor's view is in the footprint's own frame
 * (`footprintViewOfLibrary`), so that placement is the origin; what
 * `FootprintSave` then does to the clone is `footprintSaveClone`.
 */
export function footprintOfView(fp: PcbFootprint, board?: BOARD): FOOTPRINT {
  const holder = board ?? fp.k?.GetBoard() ?? emptyBOARD();
  const k = fp.k ? fp.k.Clone() : new FOOTPRINT(holder);
  if (!fp.k) holder.Add(k, ADD_MODE.APPEND, true);
  else k.SetParent(holder);
  applyFootprint(k, fp, holder, new Map(), holder.GetCopperLayerCount(), new Seen(false));
  return k;
}

/** `BOARD()`: what a board built by the editor from nothing starts as — a two-layer board with nothing on it. */
export function emptyBOARD(): BOARD {
  return new PCB_IO_KICAD_SEXPR_PARSER(
    '(kicad_pcb (version 20260206) (generator "ziroeda") (layers (0 "F.Cu" signal) (31 "B.Cu" signal)))',
    'empty board',
  ).Parse() as BOARD;
}

/**
 * The view id (`<kind>:<index>[:<sub>]`, `boardItemId`) of the view item that
 * wraps a BOARD_ITEM, or null when the item has no view row (a marker, a
 * footprint's field, a group's member reached by the group). The frame's
 * `OnEditItemRequest( BOARD_ITEM* )` arrives with the class instance; the
 * editor's selection speaks ids.
 */
export function viewIdOfBoardItem(board: Board, item: BOARD_ITEM): string | null {
  const scan = (kind: BoardItemKind, list: readonly { k?: BOARD_ITEM }[]): string | null => {
    const i = list.findIndex((v) => v.k === item);

    return i >= 0 ? boardItemId(kind, i) : null;
  };

  for (let i = 0; i < board.footprints.length; i++) {
    const fp = board.footprints[i]!;

    if (fp.k === item) return boardItemId('footprint', i);

    const pad = fp.pads.findIndex((p) => p.k === item);

    if (pad >= 0) return boardItemId('pad', i, pad);

    const text = fp.texts.findIndex((t) => t.k === item);

    if (text >= 0) return boardItemId('fptext', i, text);
  }

  return (
    scan('track', board.tracks) ??
    scan('arc', board.arcs) ??
    scan('via', board.vias) ??
    scan('zone', board.zones) ??
    scan('shape', board.shapes) ??
    scan('text', board.texts) ??
    scan('textbox', board.textBoxes) ??
    scan('table', board.tables) ??
    scan('image', board.images) ??
    scan('dimension', board.dimensions) ??
    scan('point', board.points) ??
    scan('barcode', board.barcodes) ??
    scan('group', board.groups)
  );
}

// ---------------------------------------------------------------------------
// The barcode's geometry as the view-side callers read it — the Canvas2D
// renderer, the Gerber plotter, snapping, hit-testing, the zone filler and the
// properties dialog. It is `PCB_BARCODE`'s own `AssembleBarcode` on a fresh
// item; nothing is computed here. The plain-object copy of that maths
// (`barcode_geometry.ts`) went 09-21.

/**
 * `SHAPE_POLY_SET`: a list of polygons, each an outline followed by its holes.
 * `Polygon` alone is one of those, so the set is `Polygon[]`.
 */
export type PolySet = Polygon[];

/** An axis-aligned box in IU, `BOX2I`. */
export interface BarcodeBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BarcodeGeometry {
  /**
   * `m_poly` — everything the painter fills, in board coordinates. Already
   * scaled, knocked out, mirrored and rotated.
   */
  poly: PolySet;
  /** `m_symbolPoly`, the modules alone, for the bounding hull. */
  symbolPoly: PolySet;
  /** `m_textPoly`, the human-readable line alone. */
  textPoly: PolySet;
  /** `m_bbox` — `m_poly`'s, which is what `GetBoundingBox` returns. */
  bbox: BarcodeBox;
  /** `m_lastError`; empty when the symbol encoded. */
  error: string;
}

function chainPoints(aChain: SHAPE_LINE_CHAIN): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < aChain.PointCount(); i++) {
    const p = aChain.CPoint(i);
    pts.push({ x: p.x, y: p.y });
  }
  return pts;
}

function polySetView(aSet: SHAPE_POLY_SET): PolySet {
  const out: PolySet = [];
  for (let i = 0; i < aSet.OutlineCount(); i++) {
    const rings: Vec2[][] = [chainPoints(aSet.COutline(i))];
    for (let h = 0; h < aSet.HoleCount(i); h++) rings.push(chainPoints(aSet.CHole(i, h)));
    out.push(rings);
  }
  return out;
}

function boxView(aBox: BOX2I): BarcodeBox {
  return { x1: aBox.GetLeft(), y1: aBox.GetTop(), x2: aBox.GetRight(), y2: aBox.GetBottom() };
}

const boxOfPolys = (aPolys: PolySet): BarcodeBox => {
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;
  for (const rings of aPolys)
    for (const ring of rings)
      for (const p of ring) {
        if (p.x < x1) x1 = p.x;
        if (p.y < y1) y1 = p.y;
        if (p.x > x2) x2 = p.x;
        if (p.y > y2) y2 = p.y;
      }
  return { x1, y1, x2, y2 };
};

/**
 * `AssembleBarcode` on a `PCB_BARCODE` built from the view. A fresh item every
 * time: the view may be the dialog's draft over a live item, or a test's
 * literal, and neither may be written back to `k`. The board is what
 * `IsBackLayer` needs for the mirror step; a view off `boardFromBOARD` carries
 * it through `k`.
 */
export function barcodeGeometry(
  v: PcbBarcode,
  aBoard: BOARD | null = v.k?.GetBoard() ?? null,
): BarcodeGeometry {
  const k = new PCB_BARCODE(aBoard);
  applyBarcode(k, v);
  k.AssembleBarcode();

  return {
    poly: polySetView(k.GetPolyShape()),
    symbolPoly: polySetView(k.GetSymbolPoly()),
    textPoly: polySetView(k.GetTextPoly()),
    bbox: boxView(k.GetBoundingBox()),
    error: k.GetLastError(),
  };
}

/**
 * `GetBoundingHull` (`pcb_barcode.cpp:690-723`): two rectangles, one round the
 * symbol and one round the text, rather than the modules themselves — which is
 * what `HitTest` collides against, so clicking a light module inside a QR code
 * selects it.
 */
export function barcodeHullBoxes(g: BarcodeGeometry, b: PcbBarcode): BarcodeBox[] {
  const boxes: BarcodeBox[] = [];
  const angle = new EDA_ANGLE(b.angle);
  const hull = (poly: PolySet): void => {
    if (!poly.length) return;
    const box = boxOfPolys(poly);
    const corners: Vec2[] = [
      { x: box.x1, y: box.y1 },
      { x: box.x2, y: box.y1 },
      { x: box.x2, y: box.y2 },
      { x: box.x1, y: box.y2 },
    ].map((p) => RotatePoint(p, b.at, angle));
    boxes.push(boxOfPolys([[corners]]));
  };

  hull(g.symbolPoly);
  hull(g.textPoly);
  return boxes;
}

/** Convenience for callers that only want the item's extent. */
export const barcodeBBox = (b: PcbBarcode): BarcodeBox => barcodeGeometry(b).bbox;
