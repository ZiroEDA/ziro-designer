// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reader: S-expression AST -> typed Board model.
 *
 * The faithful counterpart to KiCad's `PCB_IO_KICAD_SEXPR_PARSER`
 * (pcbnew/pcb_io/sexpr/pcb_io_sexpr_parser.cpp). Semantics ported
 * for pre-affine-transform files (version < FIRST_FP_AFFINE_TRANSFORM =
 * 20260616, i.e. every KiCad 9 and earlier board):
 *  - footprint children store FP-relative positions; board coords are
 *    `fpPos + RotatePoint(local, fpAngle)` (parser's RebakeFromLib /
 *    SetFPRelativePosition path);
 *  - pad and fp-text angles in the file are board-frame ABSOLUTE
 *    (parsePAD: "The pad angle in the file is a board frame absolute value");
 *  - RotatePoint (libs/kimath/src/trigo.cpp): x' = x·cos + y·sin,
 *    y' = y·cos − x·sin.
 */

import { head, isList, type SList } from '@ziroeda/sexpr/src/types.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  arg,
  args,
  boolField,
  childNamed,
  childrenNamed,
  maybeAbsentBool,
  maybeAbsentBoolOf,
  numArg,
  stringField,
  numberField,
} from '@ziroeda/sexpr/src/query.js';
import type {
  Board,
  DimensionFormat,
  DimensionKind,
  DimensionStyle,
  DimPrecision,
  DimTextBorder,
  DimTextPosition,
  DimUnitsFormat,
  DimUnitsMode,
  Model3D,
  PadPrimitive,
  PadShape,
  PadType,
  PcbDimension,
  PcbFootprint,
  PcbPad,
  PcbPoint,
  PcbShape,
  PcbImage,
  PcbTable,
  PcbTableCell,
  PcbTextBox,
  PcbTextItem,
  PcbZone,
  PcbZoneFill,
  BarcodeEcc,
  BarcodeKind,
  PcbBarcode,
  PlacementSourceType,
  StrokeType,
  TeardropParams,
  UnconnectedLayerMode,
} from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { zoneConnectionFromCode, type ZoneConnection } from './zone_connection.js';
import type { FrontBackOptBool } from './types.js';
import { readDrillSlot, readPostMachining } from './padstack_drill.js';
import { pcbFillModeFromToken } from './shape_fill.js';

/**
 * `PCB_IO_KICAD_SEXPR_PARSER::parseMaybeAbsentBool( aDefaultValue )`
 * (pcb_io_kicad_sexpr_parser.cpp:265), bound to pcbnew's dialect: unlike
 * eeschema's twin, it also accepts `true`/`false` (:274, :276).
 *
 * `undefined` means the token was absent altogether, which is *not* the same as
 * the token being present with its default value.
 */
const maybeAbsent = (parent: SList, name: string, whenPresent: boolean): boolean | undefined =>
  maybeAbsentBool(parent, name, whenPresent, 'yes-no-true-false');

/**
 * `(teardrops …)` on a pad or via.
 * Counterpart: `PCB_IO_KICAD_SEXPR_PARSER::parseTEARDROP_PARAMETERS`.
 *
 * Every field has a default, so a partial token still yields a complete set —
 * and `prefer_zone_connections` is stored inverted, as upstream does.
 */
/**
 * `parseOptBool()`: `yes`/`no`/`none`, where `none` is the empty optional — the
 * third state, "take the board stackup's setting".
 */
const optBoolOf = (node: SList | undefined): boolean | undefined => {
  const w = node ? arg(node, 0) : undefined;
  return w === 'yes' || w === 'true' ? true : w === 'no' || w === 'false' ? false : undefined;
};

/**
 * `parseFrontBackOptBool( aAllowLegacyFormat )`
 * (pcb_io_kicad_sexpr_parser.cpp:7698-7762): either `(front yes) (back none)`
 * children, or — for `(tenting …)` alone — the bare words `front`, `back` and
 * `none` that KiCad wrote before the sides could differ.
 */
function frontBackOptBoolOf(
  node: SList | undefined,
  allowLegacy = false,
): FrontBackOptBool | undefined {
  // No token at all: the via has no opinion, which is the same state as one
  // whose sides are both `none` — and the writer emits neither.
  if (!node) return undefined;
  const front = childNamed(node, 'front');
  const back = childNamed(node, 'back');
  if (front || back) return { front: optBoolOf(front), back: optBoolOf(back) };

  if (!allowLegacy) return {};
  const words = args(node);
  // `none` resets BOTH, whatever came before it.
  if (words.includes('none')) return {};
  return { front: words.includes('front') || undefined, back: words.includes('back') || undefined };
}

function readTeardropParams(node: SList | undefined): TeardropParams | undefined {
  if (!node) return undefined;

  // TEARDROP_PARAMETERS's constructor.
  const p: TeardropParams = {
    enabled: false,
    allowUseTwoTracks: true,
    tdOnPadsInZones: false,
    bestLengthRatio: 0.5,
    tdMaxLen: mmToIU(1.0),
    bestWidthRatio: 1.0,
    tdMaxWidth: mmToIU(2.0),
    curvedEdges: false,
    widthtoSizeFilterRatio: 0.9,
  };

  const numChild = (name: string): number | undefined => {
    const c = childNamed(node, name);
    return c ? (numArg(c, 0) ?? undefined) : undefined;
  };

  // parseTEARDROP_PARAMETERS. Every one of these is parseMaybeAbsentBool, and
  // `prefer_zone_connections` is the only one whose default is false.
  p.enabled = maybeAbsent(node, 'enabled', true) ?? p.enabled; // :682
  p.allowUseTwoTracks = maybeAbsent(node, 'allow_two_segments', true) ?? p.allowUseTwoTracks; // :686

  const preferZone = maybeAbsent(node, 'prefer_zone_connections', false); // :690
  if (preferZone !== undefined) p.tdOnPadsInZones = !preferZone;

  p.bestLengthRatio = numChild('best_length_ratio') ?? p.bestLengthRatio;
  p.bestWidthRatio = numChild('best_width_ratio') ?? p.bestWidthRatio;
  p.widthtoSizeFilterRatio = numChild('filter_ratio') ?? p.widthtoSizeFilterRatio;

  const maxLen = numChild('max_length');
  if (maxLen !== undefined) p.tdMaxLen = mmToIU(maxLen);

  const maxWidth = numChild('max_width');
  if (maxWidth !== undefined) p.tdMaxWidth = mmToIU(maxWidth);

  const curved = maybeAbsent(node, 'curved_edges', true); // :720
  if (curved !== undefined) p.curvedEdges = curved;
  // Legacy: a non-zero segment count meant "curved".
  else if (numChild('curve_points') !== undefined)
    p.curvedEdges = (numChild('curve_points') ?? 0) > 0;

  return p;
}

const ptAt = (node: SList | undefined, from = 0): Vec2 | undefined => {
  if (!node) return undefined;
  const x = numArg(node, from);
  const y = numArg(node, from + 1);
  if (x === undefined || y === undefined) return undefined;
  return { x: mmToIU(x), y: mmToIU(y) };
};

/** KiCad RotatePoint (trigo.cpp): screen coords, angle in degrees. */
export function rotatePcb(p: Vec2, angleDeg: number): Vec2 {
  if (angleDeg === 0) return p;
  const a = (angleDeg * Math.PI) / 180;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const x = Math.round(p.y * s + p.x * c);
  const y = Math.round(p.y * c - p.x * s);
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

interface FpTransform {
  pos: Vec2;
  angle: number;
}

/** Footprint-child position -> board coords (legacy RebakeFromLib path). */
const toBoard = (local: Vec2, t: FpTransform | null): Vec2 => {
  if (!t) return local;
  const r = rotatePcb(local, t.angle);
  return { x: r.x + t.pos.x, y: r.y + t.pos.y };
};

/**
 * `(point (at x y) (size s) (layer L) (uuid …))`, `parsePCB_POINT`
 * (`pcb_io_kicad_sexpr_parser.cpp:8582-8628`).
 *
 * Every token is optional in the grammar — the parser only rejects what is not
 * one of the four — and a `PCB_POINT` constructed with none of them is at the
 * origin with `DEFAULT_PT_SIZE_MM` (`pcb_point.cpp:41`) and no layer, so those
 * are what an absent token leaves behind here.
 *
 * **No footprint transform, even inside a footprint.** Every other child does
 * one: `parsePCB_SHAPE` finishes with
 *
 *     shape->Rotate( { 0, 0 }, parentFP->GetOrientation() );
 *     shape->Move( parentFP->GetPosition() );        (`…_parser.cpp:3649-3652`)
 *
 * and `format( const PCB_SHAPE* )` unwinds it by passing `parentFP` to
 * `formatInternalUnits`. `parsePCB_POINT` takes no parent at all — it is the
 * only child parser with an empty signature — and `format( const PCB_POINT* )`
 * prints `GetPosition()` through the *one-argument* overload
 * (`pcb_io_kicad_sexpr.cpp:1158`). Both halves are missing, not one, so this is
 * the convention rather than an upstream oversight: a footprint's points are
 * stored in absolute board coordinates and read back as they are written.
 *
 * We baked them through the placement here, which round-tripped (the writer
 * unbaked) but put the marker in the wrong place on screen for any footprint
 * that was not at the origin unrotated.
 */
function readPoint(item: SList): PcbPoint {
  return {
    at: ptAt(childNamed(item, 'at')) ?? { x: 0, y: 0 },
    size: mmOrUndef(item, 'size') ?? DEFAULT_POINT_SIZE,
    layer: layerOf(item),
    uuid: uuidOf(item),
    source: item,
  };
}

/** `DEFAULT_PT_SIZE_MM = 1.0` (`pcbnew/pcb_point.cpp:42`), in IU. */
export const DEFAULT_POINT_SIZE = mmToIU(1.0);

/**
 * `PCB_BARCODE`'s constructor defaults (`pcb_barcode.cpp:61-71`), for the
 * tokens a `(barcode …)` node leaves out. The grammar makes every one of them
 * optional — `parsePCB_BARCODE` only rejects what is not one of its eleven
 * heads — so an absent token has to fall back to what the freshly-constructed
 * item already holds.
 */
export const BARCODE_DEFAULTS = {
  /** `m_width`/`m_height`, both `pcbIUScale.mmToIU( 40 )`. */
  size: mmToIU(40),
  /** `m_layer = Dwgs_User`, the last line of the constructor body. */
  layer: 'Dwgs.User',
  /** `m_kind( BARCODE_T::QR_CODE )`. */
  kind: 'qr' as BarcodeKind,
  /** `m_errorCorrection( BARCODE_ECC_T::L )`. */
  ecc: 'L' as BarcodeEcc,
  /**
   * `m_text` is a default-constructed `PCB_TEXT`, so its height is `EDA_TEXT`'s
   * `DEFAULT_SIZE_TEXT` — 50 mils (`eda_text.cpp:105`, `eda_text.h:81`).
   * The barcode constructor never calls `SetTextSize`; the *tool* does, from
   * `bds.GetTextSize( layer ).y` (`drawing_tool.cpp:1532`), which is a board
   * setting and so not a default of the item.
   */
  textHeight: mmToIU(1.27),
} as const;

/**
 * `(barcode …)`, `PCB_IO_KICAD_SEXPR_PARSER::parsePCB_BARCODE`
 * (`…_parser.cpp:3979-4117`). Read identically at board level (T_barcode,
 * :1237) and inside a footprint (:5559).
 *
 * Like `readPoint`, and unlike every graphic, there is **no footprint
 * transform**: `parsePCB_BARCODE` never touches `aParent` beyond handing it to
 * the constructor, and `format( const PCB_BARCODE* )` prints `GetPosition()`
 * through the one-argument `formatInternalUnits` (`pcb_io_kicad_sexpr.cpp:2208`).
 * A footprint's barcode is stored in absolute board coordinates.
 *
 * Nothing about the *symbol* is read, because nothing about it is written: the
 * parser ends with `barcode->AssembleBarcode()` (:4113) and the modules are
 * recomputed from `text`, `kind` and `ecc` on every load.
 */
function readBarcode(item: SList): PcbBarcode {
  const at = childNamed(item, 'at');
  const size = childNamed(item, 'size');
  const margins = childNamed(item, 'margins');
  const type = childNamed(item, 'type');
  const eccLevel = childNamed(item, 'ecc_level');
  const textNode = childNamed(item, 'text');
  const hide = childNamed(item, 'hide');
  const knockout = childNamed(item, 'knockout');

  return {
    at: ptAt(at) ?? { x: 0, y: 0 },
    // `(at x y angle)`: the third field is optional, and read as a plain double
    // rather than through the angle parser (:4003-4004).
    angle: (at ? numArg(at, 2) : undefined) ?? 0,
    layer: layerOf(item) || BARCODE_DEFAULTS.layer,
    width: (size ? ptAt(size)?.x : undefined) ?? BARCODE_DEFAULTS.size,
    height: (size ? ptAt(size)?.y : undefined) ?? BARCODE_DEFAULTS.size,
    text: (textNode ? arg(textNode, 0) : undefined) ?? '',
    textHeight: mmOrUndef(item, 'text_height') ?? BARCODE_DEFAULTS.textHeight,
    kind: BARCODE_KIND_TOKENS[(type ? arg(type, 0) : undefined) ?? ''] ?? BARCODE_DEFAULTS.kind,
    ecc:
      BARCODE_ECC_TOKENS[(eccLevel ? arg(eccLevel, 0) : undefined) ?? ''] ?? BARCODE_DEFAULTS.ecc,
    // `(hide …)` is the negation of what we store: `SetShowText( !parseBool() )`.
    showText: hide ? arg(hide, 0) === 'no' : true,
    knockout: knockout ? arg(knockout, 0) !== 'no' : false,
    margin: (margins ? ptAt(margins) : undefined) ?? { x: 0, y: 0 },
    uuid: uuidOf(item),
    locked: maybeAbsent(item, 'locked', true),
    source: item,
  };
}

/**
 * The `(type …)` spellings the parser accepts (:4045-4059). Three of the five
 * have an accepted alias, and the writer emits only the first of each pair
 * (`pcb_io_kicad_sexpr.cpp:2225-2229`) — so a file written elsewhere may use
 * the alias and must still load.
 */
const BARCODE_KIND_TOKENS: Readonly<Record<string, BarcodeKind>> = {
  code39: 'code39',
  code128: 'code128',
  datamatrix: 'datamatrix',
  data_matrix: 'datamatrix',
  qr: 'qr',
  qrcode: 'qr',
  microqr: 'microqr',
  micro_qr: 'microqr',
};

/** `(ecc_level …)` (:4067-4076): either case is accepted. */
const BARCODE_ECC_TOKENS: Readonly<Record<string, BarcodeEcc>> = {
  L: 'L',
  l: 'L',
  M: 'M',
  m: 'M',
  Q: 'Q',
  q: 'Q',
  H: 'H',
  h: 'H',
};

const layerOf = (node: SList): string => {
  const l = childNamed(node, 'layer');
  if (l) return arg(l, 0) ?? '';
  // `(layers "F.Cu" "F.Mask")`: PCB_TRACK::SetLayerSet keeps the copper one.
  const ls = childNamed(node, 'layers');
  return ls ? (args(ls).find((n) => /\.Cu$/.test(n)) ?? args(ls)[0] ?? '') : '';
};

/**
 * The solder-mask layer a copper item's `(layers …)` names, if any.
 * PCB_TRACK::HasSolderMask is precisely this being present.
 */
const maskLayerOf = (node: SList): string | undefined => {
  const ls = childNamed(node, 'layers');
  return ls ? args(ls).find((n) => /\.Mask$/.test(n)) : undefined;
};

/**
 * `(zone_connect N)`, `static_cast<int>( ZONE_CONNECTION )`: 0 NONE, 1 THERMAL,
 * 2 FULL, 3 THT_THERMAL (zones.h:46-53). The token's absence is what "inherit
 * the footprint's, then Board Setup's" is — NOT a zero, which is a real
 * override meaning "this pad is not covered at all".
 */
const zoneConnectOf = (node: SList): ZoneConnection | undefined =>
  zoneConnectionFromCode(numberField(node, 'zone_connect'));

/** A millimetre child in IU, or undefined when the token is absent. */
const mmOrUndef = (node: SList, name: string): number | undefined => {
  const v = numberField(node, name);
  return v === undefined ? undefined : mmToIU(v);
};

/** `(solder_mask_margin …)` in IU. */
const maskMarginOf = (node: SList): number | undefined => {
  const v = numberField(node, 'solder_mask_margin');
  return v === undefined ? undefined : mmToIU(v);
};

const uuidOf = (node: SList): string | undefined =>
  stringField(node, 'uuid') ?? stringField(node, 'tstamp');

/**
 * `(gr_text_box "…" …)`, PCB_IO_KICAD_SEXPR_PARSER::parseTextBoxContent.
 *
 * The box is two corners normally and a `(pts …)` polygon once a non-cardinal
 * rotation has turned it into one, exactly as `gr_rect` behaves. Both forms are
 * kept as they were found: converting a polygon back to corners would lose the
 * rotation, which is the whole reason it became a polygon.
 */
function readTextBox(item: SList): PcbTextBox | null {
  const marginsNode = childNamed(item, 'margins');
  const m = (i: number): number => (marginsNode ? mmToIU(numArg(marginsNode, i) ?? 0) : 0);
  const fx = readTextEffects(item);
  const angleNode = childNamed(item, 'angle');
  const angle = angleNode ? numArg(angleNode, 0) : undefined;
  const borderNode = childNamed(item, 'border');
  const knockoutNode = childNamed(item, 'knockout');

  const box: PcbTextBox = {
    text: arg(item, 0) ?? '',
    margins: { left: m(0), top: m(1), right: m(2), bottom: m(3) },
    angle,
    layer: stringField(item, 'layer') ?? '',
    uuid: uuidOf(item),
    size: fx.size,
    thickness: fx.thickness,
    bold: fx.bold,
    italic: fx.italic,
    justify: fx.justify,
    // `(border …)` is written explicitly both ways; a box with no token at all
    // is a border, matching PCB_TEXTBOX's constructor.
    border: borderNode ? arg(borderNode, 0) !== 'no' : true,
    strokeWidth: mmToIU(strokeWidth(item)),
    strokeType: strokeType(item),
    knockout: knockoutNode ? arg(knockoutNode, 0) !== 'no' : undefined,
    source: item,
  };

  const start = ptAt(childNamed(item, 'start'));
  const end = ptAt(childNamed(item, 'end'));
  if (start && end) {
    box.start = start;
    box.end = end;
  } else {
    const pts = readPts(childNamed(item, 'pts'), null);
    if (pts.length === 0) return null; // neither form: not a box we can round-trip
    box.pts = pts;
  }
  return box;
}

/**
 * `(image …)`, PCB_IO_KICAD_SEXPR_PARSER::parsePCB_REFERENCE_IMAGE.
 *
 * `(data …)` is base64 split across many quoted strings at the MIME width of
 * 76. That split is a transport detail, so the pieces are joined here and the
 * writer re-splits them — a model holding the chunks would make every consumer
 * deal with the wrapping.
 */
function readImage(item: SList): PcbImage | null {
  const at = ptAt(childNamed(item, 'at'));
  if (!at) return null;
  const dataNode = childNamed(item, 'data');
  const data = dataNode ? args(dataNode).join('') : '';
  const scaleNode = childNamed(item, 'scale');
  return {
    at,
    layer: stringField(item, 'layer') ?? '',
    // Absent means 1: the serializer writes `(scale …)` only when it differs.
    scale: scaleNode ? numArg(scaleNode, 0) : undefined,
    data,
    uuid: uuidOf(item),
    source: item,
  };
}

/**
 * `(table …)`, PCB_IO_KICAD_SEXPR_PARSER::parsePCB_TABLE.
 *
 * The cells reuse the text box reader, because upstream serialises a
 * `PCB_TABLECELL` through `format(PCB_TEXTBOX*)` — a cell *is* a text box, plus
 * `(span …)`. Note the shared writer withholds `(border …)` and `(stroke …)`
 * from a cell, so a cell read here falls back to the text box defaults for
 * those; the table's own border and separators are what actually draw lines.
 */
function readTable(item: SList): PcbTable | null {
  const borderNode = childNamed(item, 'border');
  const sepNode = childNamed(item, 'separators');
  const widths = childNamed(item, 'column_widths');
  const heights = childNamed(item, 'row_heights');
  const cellsNode = childNamed(item, 'cells');

  const cells: PcbTableCell[] = [];
  if (cellsNode) {
    for (const c of cellsNode.items) {
      if (!isList(c) || head(c) !== 'table_cell') continue;
      const box = readTextBox(c);
      if (!box) continue;
      const spanNode = childNamed(c, 'span');
      cells.push({
        ...box,
        colSpan: (spanNode ? numArg(spanNode, 0) : undefined) ?? 1,
        rowSpan: (spanNode ? numArg(spanNode, 1) : undefined) ?? 1,
      });
    }
  }

  const nums = (node: SList | undefined): number[] =>
    node
      ? node.items
          .slice(1)
          .map((n) => (n.kind === 'atom' ? Number(n.value) : Number.NaN))
          .filter((n) => Number.isFinite(n))
          .map((n) => mmToIU(n))
      : [];

  return {
    columnCount: numberField(item, 'column_count') ?? 0,
    layer: stringField(item, 'layer') ?? '',
    uuid: uuidOf(item),
    borderExternal: borderNode ? boolField(borderNode, 'external') : false,
    borderHeader: borderNode ? boolField(borderNode, 'header') : false,
    borderWidth: borderNode ? mmOrUndef2(borderNode) : undefined,
    borderStyle: borderNode ? strokeType(borderNode) : undefined,
    separatorRows: sepNode ? boolField(sepNode, 'rows') : false,
    separatorCols: sepNode ? boolField(sepNode, 'cols') : false,
    separatorWidth: sepNode ? mmOrUndef2(sepNode) : undefined,
    separatorStyle: sepNode ? strokeType(sepNode) : undefined,
    columnWidths: nums(widths),
    rowHeights: nums(heights),
    cells,
    source: item,
  };
}

/** The `(stroke (width …))` of a `border`/`separators` block, when present. */
const mmOrUndef2 = (node: SList): number | undefined => {
  const stroke = childNamed(node, 'stroke');
  if (!stroke) return undefined;
  const w = numberField(stroke, 'width');
  return w === undefined ? undefined : mmToIU(w);
};

/**
 * `(dimension (type …) …)`, PCB_IO_KICAD_SEXPR_PARSER::parseDIMENSION.
 *
 * Which children are present is decided by the kind, and it is not a free
 * choice: a centre dimension has neither a `(format …)` nor text because it
 * measures nothing, and every aligned-only field is *also* written for an
 * orthogonal dimension because upstream's `PCB_DIM_ORTHOGONAL` derives from
 * `PCB_DIM_ALIGNED`, so its `dynamic_cast` succeeds for both.
 */
function readDimension(item: SList): PcbDimension | null {
  const typeNode = childNamed(item, 'type');
  const kindArg = typeNode ? arg(typeNode, 0) : undefined;
  const KINDS: DimensionKind[] = ['aligned', 'orthogonal', 'leader', 'center', 'radial'];
  const kind = KINDS.find((k) => k === kindArg);
  if (!kind) return null; // an unknown type is not a dimension we can round-trip

  const pts = childNamed(item, 'pts');
  const xys = pts ? pts.items.filter((n): n is SList => isList(n) && head(n) === 'xy') : [];
  const start = ptAt(xys[0]);
  const end = ptAt(xys[1]);
  if (!start || !end) return null;

  const fmtNode = childNamed(item, 'format');
  const format: DimensionFormat | undefined = fmtNode
    ? {
        prefix: stringField(fmtNode, 'prefix') ?? '',
        suffix: stringField(fmtNode, 'suffix') ?? '',
        units: (numberField(fmtNode, 'units') ?? 3) as DimUnitsMode,
        unitsFormat: (numberField(fmtNode, 'units_format') ?? 1) as DimUnitsFormat,
        precision: (numberField(fmtNode, 'precision') ?? 4) as DimPrecision,
        overrideValue: stringField(fmtNode, 'override_value'),
        // parseMaybeAbsentBool( true ) at :4727; absent is
        // PCB_DIMENSION_BASE's m_suppressZeroes( false ) (pcb_dimension.cpp:160).
        suppressZeroes: maybeAbsent(fmtNode, 'suppress_zeroes', true) ?? false,
      }
    : undefined;

  const styleNode = childNamed(item, 'style');
  const arrowDirNode = styleNode ? childNamed(styleNode, 'arrow_direction') : undefined;
  const arrowDir = arrowDirNode ? arg(arrowDirNode, 0) : undefined;
  const style: DimensionStyle = {
    thickness: styleNode ? (mmOrUndef(styleNode, 'thickness') ?? 0) : 0,
    arrowLength: styleNode ? (mmOrUndef(styleNode, 'arrow_length') ?? 0) : 0,
    textPositionMode: (styleNode
      ? (numberField(styleNode, 'text_position_mode') ?? 0)
      : 0) as DimTextPosition,
    arrowDirection: arrowDir === 'inward' || arrowDir === 'outward' ? arrowDir : undefined,
    extensionHeight: styleNode ? mmOrUndef(styleNode, 'extension_height') : undefined,
    textFrame: styleNode
      ? (numberField(styleNode, 'text_frame') as DimTextBorder | undefined)
      : undefined,
    extensionOffset: styleNode ? (mmOrUndef(styleNode, 'extension_offset') ?? 0) : 0,
    // parseMaybeAbsentBool( true ) at :4802.
    //
    // Absent stays `false` here, which is *not* PCB_DIMENSION_BASE's
    // constructor default (pcb_dimension.cpp:165 sets it true; only
    // PCB_DIM_LEADER clears it at :1361). Upstream writes the token only when
    // it is true (pcb_io_kicad_sexpr.cpp:986), so a non-leader dimension that
    // lost the token reads back as true in KiCad and as false here. That is a
    // separate defect from this one — the per-type constructor default — and
    // fixing it belongs with the item defaults, not with the token grammar.
    keepTextAligned: styleNode
      ? (maybeAbsent(styleNode, 'keep_text_aligned', true) ?? false)
      : undefined,
  };

  const textNode = childNamed(item, 'gr_text');
  const text = textNode
    ? (readPcbText(textNode, 'user', arg(textNode, 0) ?? '', null) ?? undefined)
    : undefined;

  return {
    kind,
    layer: stringField(item, 'layer') ?? '',
    uuid: uuidOf(item),
    start,
    end,
    height: mmOrUndef(item, 'height'),
    leaderLength: mmOrUndef(item, 'leader_length'),
    orientation: numberField(item, 'orientation'),
    format,
    style,
    text,
    source: item,
  };
}

/** `(pts (xy …) (arc (start)(mid)(end)) …)` -> polyline, arcs tessellated. */
function readPts(pts: SList | undefined, t: FpTransform | null): Vec2[] {
  const out: Vec2[] = [];
  if (!pts) return out;
  for (const item of pts.items) {
    if (!isList(item)) continue;
    const h = head(item);
    if (h === 'xy') {
      const p = ptAt(item);
      if (p) out.push(toBoard(p, t));
    } else if (h === 'arc') {
      const start = ptAt(childNamed(item, 'start'));
      const mid = ptAt(childNamed(item, 'mid'));
      const end = ptAt(childNamed(item, 'end'));
      if (start && mid && end) {
        for (const p of tessellateArc(start, mid, end)) out.push(toBoard(p, t));
      }
    }
  }
  return out;
}

/** Sample a 3-point arc into a polyline (~5° steps), endpoints exact. */
export function tessellateArc(start: Vec2, mid: Vec2, end: Vec2): Vec2[] {
  const c = arcCenter(start, mid, end);
  if (!c) return [start, mid, end];
  const r = Math.hypot(start.x - c.x, start.y - c.y);
  const a0 = Math.atan2(start.y - c.y, start.x - c.x);
  const am = Math.atan2(mid.y - c.y, mid.x - c.x);
  const a1 = Math.atan2(end.y - c.y, end.x - c.x);
  // Sweep from a0 through am to a1: pick the direction that passes mid.
  const ccwSweep = (from: number, to: number): number => {
    let d = to - from;
    while (d < 0) d += Math.PI * 2;
    return d;
  };
  const sweepCCW = ccwSweep(a0, a1);
  const midCCW = ccwSweep(a0, am);
  const useCCW = midCCW <= sweepCCW;
  const sweep = useCCW ? sweepCCW : sweepCCW - Math.PI * 2;
  const steps = Math.max(2, Math.min(96, Math.ceil(Math.abs(sweep) / (Math.PI / 36))));
  const pts: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps;
    pts.push({ x: Math.round(c.x + r * Math.cos(a)), y: Math.round(c.y + r * Math.sin(a)) });
  }
  pts[0] = start;
  pts[pts.length - 1] = end;
  return pts;
}

/** Circumcentre of three points, or null when collinear. */
export function arcCenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
}

function readTextEffects(item: SList): {
  size: Vec2;
  thickness?: number;
  bold?: boolean;
  italic?: boolean;
  mirror?: boolean;
  justify?: string[];
  hidden?: boolean;
} {
  const effects = childNamed(item, 'effects');
  const font = effects ? childNamed(effects, 'font') : undefined;
  const sizeNode = font ? childNamed(font, 'size') : undefined;
  const size = ptAt(sizeNode) ?? { x: mmToIU(1.27), y: mmToIU(1.27) };
  const thicknessMM = font ? numberField(font, 'thickness') : undefined;
  const justifyNode = effects ? childNamed(effects, 'justify') : undefined;
  const justify = justifyNode ? args(justifyNode) : undefined;
  return {
    // (size h w): height first, match the schematic reader convention of {x: w, y: h}.
    size: { x: size.y, y: size.x },
    thickness: thicknessMM !== undefined ? mmToIU(thicknessMM) : undefined,
    // parseEDA_TEXT: bold and italic are parseMaybeAbsentBool( true ) at :803
    // and :807, and real KiCad files write them bare — `(font (size 1 1)
    // (thickness 0.2) bold)`.
    bold: font ? (maybeAbsent(font, 'bold', true) ?? false) : undefined,
    italic: font ? (maybeAbsent(font, 'italic', true) ?? false) : undefined,
    mirror: justify?.includes('mirror'),
    justify,
    // parseEDA_TEXT's own `hide` at :841, inside `(effects …)` — the pre-v7
    // location. `undefined` keeps it distinct from the item-level token.
    hidden: effects ? maybeAbsent(effects, 'hide', true) : undefined,
  };
}

function readPcbText(
  item: SList,
  kind: PcbTextItem['kind'],
  text: string,
  t: FpTransform | null,
): PcbTextItem | null {
  const at = childNamed(item, 'at');
  const pos = ptAt(at);
  if (!pos) return null;
  const angle = at ? (numArg(at, 2) ?? 0) : 0;
  const fx = readTextEffects(item);
  // `hide` sits at the item level (parsePCB_TEXT_effects :3913) and, in older
  // files, inside `(effects …)` (parseEDA_TEXT :841). Both are
  // parseMaybeAbsentBool( true ), so a bare `hide` — which is how KiCad wrote
  // it before v7, and how bitmap2component still writes it — means hidden.
  // `(effects …)` is written after the item-level token, so upstream's token
  // loop lets the later one win.
  const hide = fx.hidden ?? maybeAbsent(item, 'hide', true) ?? false;
  // Footprint text (t != null) keeps upright unless it carries `unlocked`
  // (either positional after the angle in `at`, or a child `(unlocked yes)`).
  const unlockedNode = childNamed(item, 'unlocked');
  const unlocked =
    (at ? args(at).includes('unlocked') : false) ||
    (unlockedNode ? arg(unlockedNode, 0) !== 'no' : false);
  return {
    kind,
    text,
    at: toBoard(pos, t),
    angle,
    layer: layerOf(item),
    size: fx.size,
    thickness: fx.thickness,
    bold: fx.bold,
    italic: fx.italic,
    mirror: fx.mirror,
    justify: fx.justify,
    keepUpright: t !== null && !unlocked,
    hide,
    knockout: childNamed(item, 'layer')
      ? args(childNamed(item, 'layer')!).includes('knockout')
      : false,
    uuid: uuidOf(item),
    source: item,
  };
}

/**
 * The net table of the board currently being read, or null outside one.
 *
 * `parseNet` resolves a net *name* against `m_board`, which the parser has at
 * every call. A `.kicad_mod` read on its own has no board, and a graphic in one
 * carries no net, so the null case is the honest one rather than a gap.
 */
let readingNets: Map<number, string> | null = null;

/**
 * `PCB_IO_KICAD_SEXPR_PARSER::parseNet`, the copper-graphic case.
 *
 * Two spellings, and both are still read. A file written before 10.0 carries a
 * net **code** — `(net 5)` — which the parser calls authoritative; 10.0 and
 * later write the net **name**, `(net "/uart/SDA")`. Reading only the number
 * would silently drop the net on every board KiCad 10 has saved, which is all
 * the ones that have it.
 *
 * The name is resolved against the board's own `(net …)` declarations by the
 * caller, which is the only place the table is in hand.
 */
function shapeNet(item: SList): number | undefined {
  const node = childNamed(item, 'net');
  if (!node) return undefined;

  // Legacy files (pre-10.0) carry a net code, and the parser calls it
  // authoritative. `numArg` answers only for an actual number, so a name never
  // reaches here as a NaN.
  const code = numArg(node, 0);
  if (code !== undefined) return code;

  const name = arg(node, 0);
  if (name === undefined || readingNets === null) return undefined;

  for (const [c, n] of readingNets) if (n === name) return c;

  // `FindNet` missed, so upstream *creates* the net and adds it to the board
  // rather than dropping the reference. A code the file never declared is
  // still a net the copper belongs to, and two shapes naming it must land on
  // the same one.
  let free = 1;
  while (readingNets.has(free)) free++;
  readingNets.set(free, name);
  return free;
}

function readShape(item: SList, t: FpTransform | null): PcbShape | null {
  const h = head(item) ?? '';
  const kind = h.replace(/^(gr_|fp_)/, '');
  if (!['line', 'arc', 'circle', 'rect', 'poly', 'curve'].includes(kind)) return null;
  const numChild = (node: SList | undefined, name: string): number | undefined => {
    const c = node ? childNamed(node, name) : undefined;
    return c ? numArg(c, 0) : undefined;
  };
  const fillNode = childNamed(item, 'fill');
  const fillVal = fillNode ? arg(fillNode, 0) : undefined;
  const net = shapeNet(item);
  const s: PcbShape = {
    ...(net !== undefined ? { net } : {}),
    ...(net !== undefined && readingNets?.has(net) ? { netName: readingNets.get(net)! } : {}),

    kind: kind as PcbShape['kind'],
    width: mmToIU(strokeWidth(item)),
    strokeType: strokeType(item),
    // `(radius …)` is a rounded RECTANGLE's, and the parser accepts it only
    // there (T_radius in parsePCB_SHAPE, :3554-3558).
    cornerRadius: kind === 'rect' ? mmOrUndef(item, 'radius') : undefined,
    fillMode: pcbFillModeFromToken(fillVal),
    layer: layerOf(item),
    maskLayer: maskLayerOf(item),
    solderMaskMargin: maskMarginOf(item),
    uuid: uuidOf(item),
    source: item,
  };
  const start = ptAt(childNamed(item, 'start')) ?? ptAt(childNamed(item, 'center'));
  const end = ptAt(childNamed(item, 'end'));
  const mid = ptAt(childNamed(item, 'mid'));
  if (kind === 'circle') {
    const c = ptAt(childNamed(item, 'center'));
    if (c) s.center = toBoard(c, t);
    if (end) s.end = toBoard(end, t);
  } else {
    if (start) s.start = toBoard(start, t);
    if (end) s.end = toBoard(end, t);
    if (mid) s.mid = toBoard(mid, t);
  }
  if (kind === 'poly' || kind === 'curve') s.pts = readPts(childNamed(item, 'pts'), t);
  return s;
}

const strokeWidth = (item: SList): number => {
  const stroke = childNamed(item, 'stroke');
  if (stroke) return numberField(stroke, 'width') ?? 0;
  return numberField(item, 'width') ?? 0;
};

/** `(stroke (type …))`, LINE_STYLE; absent for a legacy `(width …)` graphic. */
const strokeType = (item: SList): StrokeType | undefined => {
  const stroke = childNamed(item, 'stroke');
  const type = stroke ? childNamed(stroke, 'type') : undefined;
  const word = type ? arg(type, 0) : undefined;
  return word === 'solid' ||
    word === 'dash' ||
    word === 'dot' ||
    word === 'dash_dot' ||
    word === 'dash_dot_dot' ||
    word === 'default'
    ? word
    : undefined;
};

/**
 * `(remove_unused_layers …)` / `(keep_end_layers …)` / `(start_end_only …)`,
 * PADSTACK's UNCONNECTED_LAYER_MODE, as `parsePAD` and `parsePCB_VIA` read it.
 *
 * The tokens are the deprecated *pair of setters*, not the enum, so they are
 * applied in file order: `SetKeepTopBottom` overwrites whatever
 * `SetRemoveUnconnected` just chose. Two upstream asymmetries are reproduced:
 *
 * - a **pad** applies both truth values (`(keep_end_layers no)` alone lands on
 *   `remove_all`, even after `(remove_unused_layers no)`), whereas a **via**
 *   acts only when the value is true and ignores an explicit `no` entirely;
 * - `start_end_only` exists on the via side only.
 *
 * `undefined` means the node carried none of them, which keeps an untouched
 * item's source node out of the writer's way.
 */
type UnconnectedLayerToken = 'remove_unused_layers' | 'keep_end_layers' | 'start_end_only';

function readUnconnectedLayerMode(item: SList, forVia: boolean): UnconnectedLayerMode | undefined {
  let mode: UnconnectedLayerMode | undefined;
  const known = (name: string | undefined): name is UnconnectedLayerToken =>
    name === 'remove_unused_layers' || name === 'keep_end_layers' || name === 'start_end_only';

  // Skip items[0], the node's own head token.
  for (let i = 1; i < item.items.length; i++) {
    const child = item.items[i]!;

    // parseMaybeAbsentBool( true ) at :6366 and :6373 (pad), :7497, :7503 and
    // :7509 (via). A bare positional token is the third shape it accepts.
    if (child.kind === 'atom') {
      if (!known(child.value)) continue;
      applyMode(child.value, true);
      continue;
    }

    if (!isList(child)) continue;

    const name = head(child);
    if (!known(name)) continue;

    const value = maybeAbsentBoolOf(child, true, 'yes-no-true-false');

    applyMode(name, value);
  }

  return mode;

  function applyMode(name: UnconnectedLayerToken, value: boolean): void {
    if (forVia && !value) return;

    if (name === 'remove_unused_layers') mode = value ? 'remove_all' : 'keep_all';
    else if (name === 'keep_end_layers')
      mode = value ? 'remove_except_start_and_end' : 'remove_all';
    else mode = 'start_end_only';
  }
}

function readPad(item: SList, t: FpTransform | null): PcbPad | null {
  const positional = args(item);
  const number = positional[0] ?? '';
  const type = (positional[1] ?? 'smd') as PadType;
  const shape = (positional[2] ?? 'circle') as PadShape;
  const at = childNamed(item, 'at');
  const pos = ptAt(at);
  if (!pos) return null;
  const size = ptAt(childNamed(item, 'size')) ?? { x: 0, y: 0 };
  const layersNode = childNamed(item, 'layers');
  const drillNode = childNamed(item, 'drill');
  let drill: PcbPad['drill'];
  if (drillNode) {
    const nums = args(drillNode)
      .filter((a) => a !== 'oval')
      .map(Number);
    const w = mmToIU(nums[0] ?? 0);
    drill = {
      oblong: args(drillNode).includes('oval'),
      w,
      h: nums[1] !== undefined ? mmToIU(nums[1]) : w,
      offset: ptAt(childNamed(drillNode, 'offset')),
    };
  } else if (type === 'thru_hole' || type === 'np_thru_hole') {
    // parsePAD: a missing drill token on a through pad means a 1 nm hole.
    drill = { oblong: false, w: 1, h: 1 };
  }
  const primsNode = childNamed(item, 'primitives');
  const primitives: PadPrimitive[] = [];
  if (primsNode) {
    for (const p of primsNode.items) {
      if (!isList(p)) continue;
      const ph = head(p) ?? '';
      if (!['gr_poly', 'gr_line', 'gr_circle', 'gr_arc', 'gr_rect', 'gr_vector'].includes(ph))
        continue;
      const fillNode = childNamed(p, 'fill');
      const fillVal = fillNode ? arg(fillNode, 0) : undefined;
      primitives.push({
        kind: ph as PadPrimitive['kind'],
        pts: childNamed(p, 'pts') ? readPts(childNamed(p, 'pts'), null) : undefined,
        start: ptAt(childNamed(p, 'start')),
        mid: ptAt(childNamed(p, 'mid')),
        end: ptAt(childNamed(p, 'end')),
        center: ptAt(childNamed(p, 'center')),
        width: mmToIU(strokeWidth(p)),
        fill: fillVal === 'yes' || fillVal === 'solid',
      });
    }
  }
  const chamferNode = childNamed(item, 'chamfer');
  return {
    number,
    type,
    shape,
    at: toBoard(pos, t),
    angle: at ? (numArg(at, 2) ?? 0) : 0,
    size,
    drill,
    layers: layersNode ? args(layersNode) : [],
    roundrectRatio: numberField(item, 'roundrect_rratio'),
    chamferRatio: numberField(item, 'chamfer_ratio'),
    chamfer: chamferNode ? args(chamferNode) : undefined,
    delta: ptAt(childNamed(item, 'rect_delta')),
    net: childNamed(item, 'net') ? numArg(childNamed(item, 'net')!, 0) : undefined,
    pinFunction: childNamed(item, 'pinfunction')
      ? arg(childNamed(item, 'pinfunction')!, 0)
      : undefined,
    pinType: childNamed(item, 'pintype') ? arg(childNamed(item, 'pintype')!, 0) : undefined,
    // `(property pad_prop_…)`, PAD::GetProperty. Only the token is kept; the
    // courtyard check needs `pad_prop_heatsink`, which it exempts.
    padProperty: childNamed(item, 'property') ? arg(childNamed(item, 'property')!, 0) : undefined,
    primitives: primitives.length > 0 ? primitives : undefined,
    localClearance: mmOrUndef(item, 'clearance'),
    localSolderMaskMargin: mmOrUndef(item, 'solder_mask_margin'),
    localSolderPasteMargin: mmOrUndef(item, 'solder_paste_margin'),
    localSolderPasteMarginRatio: numberField(item, 'solder_paste_margin_ratio'),
    zoneConnection: zoneConnectOf(item),
    thermalBridgeWidth: mmOrUndef(item, 'thermal_bridge_width'),
    thermalGap: mmOrUndef(item, 'thermal_gap'),
    padToDieLength: mmOrUndef(item, 'die_length'),
    teardrops: readTeardropParams(childNamed(item, 'teardrops')),
    unconnectedLayerMode: readUnconnectedLayerMode(item, false),
    backdrill: readDrillSlot(item, 'backdrill', mmToIU),
    tertiaryDrill: readDrillSlot(item, 'tertiary_drill', mmToIU),
    frontPostMachining: readPostMachining(item, 'front_post_machining', mmToIU),
    backPostMachining: readPostMachining(item, 'back_post_machining', mmToIU),
    uuid: uuidOf(item),
    source: item,
  };
}

/**
 * Read a standalone `.kicad_mod` file (a top-level `(footprint …)` node) into a
 * footprint in its own LOCAL frame, the form the Footprint Editor works in.
 * A library footprint carries no board placement, so children keep their stored
 * (footprint-relative) coordinates: no transform is baked in and the anchor sits
 * at the origin. This is the library-cache load path of KiCad's
 * `PCB_IO_KICAD_SEXPR_PARSER::parseFOOTPRINT` (the footprint is not re-based onto
 * a board), as opposed to `readFootprint`, which bakes children to board coords.
 */
export function readFootprintFile(root: SList): PcbFootprint | null {
  const h = head(root);
  if (h !== 'footprint' && h !== 'module') return null;
  return readFootprint(root, true);
}

/**
 * A `(footprint …)` node read in BOARD context: children are baked from
 * footprint-local to board coordinates through the node's `(at …)` placement, the
 * same path the board reader takes. This is how a library footprint becomes a
 * board footprint (KiCad's `LoadFootprintFromProject` + `FOOTPRINT::SetPosition`,
 * used by BOARD_NETLIST_UPDATER::addNewFootprint).
 */
export function readBoardFootprint(root: SList): PcbFootprint | null {
  const h = head(root);
  if (h !== 'footprint' && h !== 'module') return null;
  return readFootprint(root, false);
}

function readFootprint(item: SList, local = false): PcbFootprint | null {
  const lib = arg(item, 0) ?? '';
  const at = childNamed(item, 'at');
  // `(at …)` is optional. `parseFOOTPRINT` (`pcb_io_kicad_sexpr_parser.cpp:5110`)
  // handles it as one case of its token loop and calls `SetPosition` only when
  // it is present, so a footprint without one keeps FOOTPRINT's constructed
  // origin — (0, 0). This reader used to reject such a node outright, which
  // silently dropped it; GerbView writes exactly one, the `(footprint "slot"
  // (pad …))` its drill-slot export emits (`gerbview/export_to_pcbnew.cpp:347`).
  const pos = ptAt(at) ?? { x: 0, y: 0 };
  const angle = local ? 0 : at ? (numArg(at, 2) ?? 0) : 0;
  // On a board, children are baked to board coords through the placement
  // transform (legacy RebakeFromLib); a library footprint keeps local coords.
  const t: FpTransform | null = local ? null : { pos, angle };
  const attrNode = childNamed(item, 'attr');
  // parseFOOTPRINT, T_net_tie_pad_groups: every argument is one group string,
  // stored verbatim. The empty-string group is kept rather than dropped —
  // IsNetTie() distinguishes "no groups" from "one empty group" only by looking
  // at the strings, and both must survive a round trip.
  const netTieNode = childNamed(item, 'net_tie_pad_groups');
  const fp: PcbFootprint = {
    lib,
    at: pos,
    angle,
    layer: layerOf(item),
    descr: stringField(item, 'descr'),
    tags: stringField(item, 'tags'),
    attributes: attrNode ? args(attrNode) : undefined,
    netTiePadGroups: netTieNode ? args(netTieNode) : undefined,
    localClearance: mmOrUndef(item, 'clearance'),
    localSolderMaskMargin: mmOrUndef(item, 'solder_mask_margin'),
    localSolderPasteMargin: mmOrUndef(item, 'solder_paste_margin'),
    localSolderPasteMarginRatio: numberField(item, 'solder_paste_margin_ratio'),
    zoneConnection: zoneConnectOf(item),
    // parseFOOTPRINT, parseMaybeAbsentBool( true ) at :5074. Legacy `(module …)`
    // wrote it as a bare `locked` token.
    locked: maybeAbsent(item, 'locked', true) ?? false,
    path: stringField(item, 'path'),
    sheetname: stringField(item, 'sheetname'),
    sheetfile: stringField(item, 'sheetfile'),
    fields: [],
    pads: [],
    shapes: [],
    texts: [],
    points: [],
    barcodes: [],
    models: [],
    uuid: uuidOf(item),
    source: item,
  };
  for (const child of item.items) {
    if (!isList(child)) continue;
    const h = head(child) ?? '';
    if (h === 'pad') {
      const pad = readPad(child, t);
      if (pad) fp.pads.push(pad);
    } else if (h === 'model') {
      const m = readModel(child);
      if (m) fp.models.push(m);
    } else if (h === 'barcode') {
      // `parseFOOTPRINT`, T_barcode (`…_parser.cpp:5559-5563`).
      fp.barcodes.push(readBarcode(child));
    } else if (h === 'point') {
      // `parseFOOTPRINT`, T_point (`…_parser.cpp:5606-5610`). Unprefixed, not
      // `fp_point`: the same token a board uses.
      fp.points.push(readPoint(child));
    } else if (h.startsWith('fp_') && h !== 'fp_text' && h !== 'fp_text_box') {
      const s = readShape(child, t);
      if (s) fp.shapes.push(s);
    } else if (h === 'fp_text') {
      const kindArg = arg(child, 0);
      const kind = kindArg === 'reference' ? 'reference' : kindArg === 'value' ? 'value' : 'user';
      const text = arg(child, 1) ?? '';
      const tx = readPcbText(child, kind, text, t);
      if (tx) fp.texts.push(tx);
      if (kind === 'reference') fp.reference = text;
      if (kind === 'value') fp.value = text;
    } else if (h === 'property') {
      // KiCad 8+: Reference/Value are footprint properties with text semantics.
      const key = arg(child, 0);
      const value = arg(child, 1) ?? '';
      if (key === 'Reference' || key === 'Value') {
        const tx = readPcbText(child, key === 'Reference' ? 'reference' : 'value', value, t);
        if (tx) fp.texts.push(tx);
        if (key === 'Reference') fp.reference = value;
        else fp.value = value;
      } else if (key === 'ki_fp_filters') {
        // FOOTPRINT::SetFilters, a bare property, not a field with text. (8.0.0rc3
        // wrote it as a field by mistake; either way it is only the filters.)
        fp.filters = value;
      } else if (key !== undefined) {
        // Before PCB fields (file version < 20230620) these reserved keys stood in
        // for what are now their own tokens (parseFOOTPRINT, T_property). They are
        // still kept in `fields` so the writer emits them back untouched, but the
        // typed value is what consumers read, RESERVED_FOOTPRINT_PROPERTIES lists
        // the names that are therefore *not* user fields.
        if (key === 'Sheetname' || key === 'Sheet name') fp.sheetname ??= value;
        else if (key === 'Sheetfile' || key === 'Sheet file') fp.sheetfile ??= value;
        fp.fields?.push({ name: key, value, source: child });
      }
    }
  }
  // KiCad resolves text variables when rendering; ${REFERENCE}/${VALUE} are
  // by far the common ones on Fab layers.
  //
  // But NOT on a footprint-holder board. `FOOTPRINT::ResolveTextVar` opens with
  //
  //     if( GetBoard() && GetBoard()->GetBoardUse() == BOARD_USE::FPHOLDER )
  //         return false;
  //
  // (`pcbnew/footprint.cpp:1185-1188`), and the resolver `PCB_TEXT::GetShownText`
  // then falls through to the board's, which knows no such token either — so
  // the footprint editor and the chooser's footprint preview, whose boards are
  // both FPHOLDER (`footprint_preview_panel.cpp`: `SetBoardUse( FPHOLDER )`),
  // paint the literal `${REFERENCE}`. `local` is exactly that distinction here:
  // it is set by `readFootprintFile`, the library load, and clear by the board
  // reader.
  if (!local) {
    for (const tx of fp.texts) {
      if (tx.text.includes('${')) {
        tx.text = tx.text
          .replaceAll('${REFERENCE}', fp.reference ?? '')
          .replaceAll('${VALUE}', fp.value ?? '');
      }
    }
  }
  return fp;
}

// A footprint's `(model …)` 3D reference (PCB_IO_KICAD_SEXPR_PARSER::parse3DModel).
// Offset/scale/rotate stay in the file's native units (mm, unitless, degrees),
// the 3D viewer applies KiCad's transform. The legacy `(at (xyz …))` variant is
// in *inches*: upstream multiplies it by 25.4 into mm.
function readModel(item: SList): Model3D | null {
  const path = arg(item, 0);
  if (!path) return null;
  const xyzOf = (
    node: SList | undefined,
    def: number,
    mul = 1,
  ): { x: number; y: number; z: number } => {
    const inner = node ? childNamed(node, 'xyz') : undefined;
    return {
      x: inner ? (numArg(inner, 0) ?? def) * mul : def,
      y: inner ? (numArg(inner, 1) ?? def) * mul : def,
      z: inner ? (numArg(inner, 2) ?? def) * mul : def,
    };
  };
  const offsetNode = childNamed(item, 'offset');
  const opacityNode = childNamed(item, 'opacity');
  const opacity = opacityNode ? numArg(opacityNode, 0) : undefined;
  return {
    path,
    offset: offsetNode ? xyzOf(offsetNode, 0) : xyzOf(childNamed(item, 'at'), 0, 25.4), // legacy `at` is in inches
    scale: xyzOf(childNamed(item, 'scale'), 1),
    rotate: xyzOf(childNamed(item, 'rotate'), 0),
    // parse3DModel, parseMaybeAbsentBool( true ) at :955.
    hide: maybeAbsent(item, 'hide', true) ?? false,
    ...(opacity !== undefined && opacity < 1 ? { opacity } : {}),
  };
}

function readZone(item: SList): PcbZone {
  const netNode = childNamed(item, 'net');
  const layersNode = childNamed(item, 'layers');
  const layerNode = childNamed(item, 'layer');
  const layers = layersNode ? args(layersNode) : layerNode ? [arg(layerNode, 0) ?? ''] : [];
  const fills: PcbZoneFill[] = [];
  for (const fp of childrenNamed(item, 'filled_polygon')) {
    const layer = stringField(fp, 'layer') ?? layers[0] ?? '';
    const pts = readPts(childNamed(fp, 'pts'), null);
    if (pts.length < 3) continue;
    const existing = fills.find((f) => f.layer === layer);
    if (existing) existing.polys.push(pts);
    else fills.push({ layer, polys: [pts] });
  }
  // The zone boundary `(polygon (pts …))`, drawn as the border, and larger
  // than the (clearance-inset) fill.
  const polyNode = childNamed(item, 'polygon');
  const outline = polyNode ? readPts(childNamed(polyNode, 'pts'), null) : [];
  // `(hatch <style> <pitch>)`, border display style + hatch pitch (mm).
  const hatchNode = childNamed(item, 'hatch');
  const hatchWord = hatchNode ? arg(hatchNode, 0) : undefined;
  const hatchWordStyle: PcbZone['hatchStyle'] =
    hatchWord === 'none' ? 'none' : hatchWord === 'full' ? 'full' : hatchWord ? 'edge' : undefined;
  const hatchPitch = hatchNode ? mmToIU(Number(arg(hatchNode, 1) ?? 0)) : 0;
  // Fill parameters (ZONE_SETTINGS). The defaults are pcbnew/zones.h's, which is
  // what a zone written without them means.
  const connectNode = childNamed(item, 'connect_pads');
  const connectWord = connectNode ? arg(connectNode, 0) : undefined;
  const padConnection: PcbZone['padConnection'] =
    connectWord === 'no'
      ? 'none'
      : connectWord === 'yes'
        ? 'full'
        : connectWord === 'thru_hole_only'
          ? 'thru_hole_only'
          : 'thermal';
  const mmChild = (node: SList | undefined, name: string): number | undefined => {
    const c = node ? childNamed(node, name) : undefined;
    const v = c ? numArg(c, 0) : undefined;
    return v === undefined ? undefined : mmToIU(v);
  };
  const numChild = (node: SList | undefined, name: string): number | undefined => {
    const c = node ? childNamed(node, name) : undefined;
    return c ? numArg(c, 0) : undefined;
  };
  const fillNode = childNamed(item, 'fill');
  const priorityNode = childNamed(item, 'priority');
  // `(attr (teardrop (type padvia|track_end)))`, ZONE::SetTeardropAreaType.
  const teardropType: PcbZone['teardropType'] = (() => {
    const attr = childNamed(item, 'attr');
    const td = attr ? childNamed(attr, 'teardrop') : undefined;
    const type = td ? childNamed(td, 'type') : undefined;
    const word = type ? arg(type, 0) : undefined;
    return word === 'padvia' ? 'viapad' : word === 'track_end' ? 'trackend' : undefined;
  })();
  return {
    net: netNode ? (numArg(netNode, 0) ?? 0) : 0,
    netName: stringField(item, 'net_name'),
    name: stringField(item, 'name'),
    layers,
    fills,
    outline: outline.length >= 3 ? outline : undefined,
    // The generator sets INVISIBLE_BORDER, which upstream's writer spells as
    // `none` — so a saved teardrop loses it. Restore it on read: a bright
    // full-opacity border traced around every flare is not what the feature
    // looks like in pcbnew, and the next commit would regenerate it anyway.
    hatchStyle: teardropType ? ('invisible' as const) : hatchWordStyle,
    hatchPitch,
    padConnection,
    clearance: mmChild(connectNode, 'clearance') ?? mmToIU(0.5),
    minThickness: mmChild(item, 'min_thickness') ?? mmToIU(0.25),
    thermalGap: mmChild(fillNode, 'thermal_gap') ?? mmToIU(0.5),
    thermalBridgeWidth: mmChild(fillNode, 'thermal_bridge_width') ?? mmToIU(0.5),
    cornerSmoothing: (() => {
      const node = fillNode ? childNamed(fillNode, 'smoothing') : undefined;
      const w = node ? arg(node, 0) : undefined;
      return w === 'chamfer' ? 'chamfer' : w === 'fillet' ? 'fillet' : 'none';
    })(),
    cornerRadius: mmChild(fillNode, 'radius') ?? 0,
    fillMode: (() => {
      const node = fillNode ? childNamed(fillNode, 'mode') : undefined;
      const w = node ? arg(node, 0) : undefined;
      return w === 'hatch' ? 'hatch' : w === 'thieving' ? 'thieving' : 'solid';
    })(),
    thieving: (() => {
      const node = fillNode ? childNamed(fillNode, 'thieving') : undefined;
      if (!node) return undefined;
      const typeWord = arg(childNamed(node, 'type') ?? node, 0);
      return {
        pattern:
          typeWord === 'squares'
            ? ('squares' as const)
            : typeWord === 'hatch'
              ? ('hatch' as const)
              : ('dots' as const),
        elementSize: mmChild(node, 'size') ?? 0,
        gap: mmChild(node, 'gap') ?? 0,
        lineWidth: mmChild(node, 'width') ?? 0,
        stagger: arg(childNamed(node, 'stagger') ?? node, 0) === 'yes',
        orientation: numChild(node, 'orientation') ?? 0,
      };
    })(),
    hatchThickness: mmChild(fillNode, 'hatch_thickness') ?? 0,
    hatchGap: mmChild(fillNode, 'hatch_gap') ?? 0,
    hatchOrientation: numChild(fillNode, 'hatch_orientation') ?? 0,
    hatchSmoothingLevel: numChild(fillNode, 'hatch_smoothing_level') ?? 0,
    hatchSmoothingValue: numChild(fillNode, 'hatch_smoothing_value') ?? 0,
    hatchHoleMinArea: numChild(fillNode, 'hatch_min_hole_area') ?? 0.3,
    // A zone's own `(property (layer …) (hatch_position (xy X Y)))` entries.
    // They sit directly under the zone, not inside `(fill …)`, and only a
    // property that carries a hatch_position counts as an override.
    layerProperties: (() => {
      const out: Record<string, { x: number; y: number }> = {};
      for (const prop of childrenNamed(item, 'property')) {
        const layerNode = childNamed(prop, 'layer');
        const layer = layerNode ? arg(layerNode, 0) : undefined;
        const hatch = childNamed(prop, 'hatch_position');
        const xy = hatch ? childNamed(hatch, 'xy') : undefined;
        const x = xy ? numArg(xy, 0) : undefined;
        const y = xy ? numArg(xy, 1) : undefined;
        if (layer && x !== undefined && y !== undefined)
          out[layer] = { x: mmToIU(x), y: mmToIU(y) };
      }
      return Object.keys(out).length ? out : undefined;
    })(),
    filled: fillNode ? arg(fillNode, 0) === 'yes' : false,
    islandRemovalMode: (() => {
      const v = numChild(fillNode, 'island_removal_mode');
      return v === 1 ? ('never' as const) : v === 2 ? ('area' as const) : ('always' as const);
    })(),
    // Stored in mm², not IU: upstream divides by IU_PER_MM when writing it.
    islandAreaMin: numChild(fillNode, 'island_area_min') ?? 10,
    priority: priorityNode ? (numArg(priorityNode, 0) ?? 0) : 0,
    teardropType,
    ruleArea: (() => {
      // "keepout" now means rule area, but the file token stayed the same.
      const ko = childNamed(item, 'keepout');

      if (!ko) {
        // The parser's `placement` case calls SetIsRuleArea( true ) as well,
        // and — unlike the `keepout` case — touches none of the do-not-allow
        // flags, so they stand at the default zone settings the parser's ZONE
        // was constructed from: tracks, vias and pads forbidden, copper pour
        // and footprints allowed (ZONE_SETTINGS::ZONE_SETTINGS).
        if (!childNamed(item, 'placement')) return undefined;
        return { tracks: true, vias: true, pads: true, copperPour: false, footprints: false };
      }

      // pads and footprints post-date the token, so a file written before them
      // has neither — upstream initialises both to allowed rather than
      // inheriting whatever the last zone had.
      const flag = (name: string): boolean => {
        const c = childNamed(ko, name);
        return c ? arg(c, 0) === 'not_allowed' : false;
      };

      return {
        tracks: flag('tracks'),
        vias: flag('vias'),
        pads: flag('pads'),
        copperPour: flag('copperpour'),
        footprints: flag('footprints'),
      };
    })(),
    placementArea: (() => {
      const node = childNamed(item, 'placement');
      if (!node) return undefined;

      // Upstream walks the children in order and lets each name token
      // overwrite both the type and the source, so when a hand-edited file
      // names two sources the *last* one wins. Absent all three, the ZONE
      // constructor's SHEETNAME and an empty name stand.
      let sourceType: PlacementSourceType = 'sheetname';
      let source = '';
      let enabled = false;

      for (const child of node.items) {
        if (!isList(child)) continue;
        const name = head(child);
        if (name === 'enabled') enabled = arg(child, 0) === 'yes';
        else if (name === 'sheetname' || name === 'component_class' || name === 'group') {
          sourceType = name;
          source = arg(child, 0) ?? '';
        }
      }

      return { enabled, sourceType, source };
    })(),
    uuid: uuidOf(item),
    source: item,
  };
}

/** Read a parsed `.kicad_pcb` document into the typed Board model. */
export function readBoard(root: SList): Board {
  if (head(root) !== 'kicad_pcb') throw new Error('not a kicad_pcb document');
  const setupNode = childNamed(root, 'setup');
  const board: Board = {
    version: numberField(root, 'version') ?? 0,
    // `parseMaybeAbsentBool( true )` (pcb_io_kicad_sexpr_parser.cpp:1713-1715):
    // a bare `(legacy_teardrops)` means yes.
    legacyTeardrops: setupNode ? maybeAbsent(setupNode, 'legacy_teardrops', true) : undefined,
    // Full token ("A4", "A4 portrait", "User 200 150") so the Page Settings
    // dialog round-trips orientation and custom sizes; consumers split on
    // whitespace and use the first word for the size lookup.
    paper: (() => {
      const p = childNamed(root, 'paper');
      return p ? args(p).join(' ') : undefined;
    })(),
    titleBlock: (() => {
      const tb = childNamed(root, 'title_block');
      if (!tb) return undefined;
      // `(comment N "text")` rows; index 0 = comment 1.
      const comments: string[] = [];
      for (const c of childrenNamed(tb, 'comment')) {
        const n = numArg(c, 0);
        const text = arg(c, 1);
        if (n !== undefined && text !== undefined) comments[n - 1] = text;
      }
      return {
        title: stringField(tb, 'title'),
        date: stringField(tb, 'date'),
        rev: stringField(tb, 'rev'),
        company: stringField(tb, 'company'),
        comments: comments.length > 0 ? comments : undefined,
      };
    })(),
    layers: [],
    nets: new Map(),
    footprints: [],
    tracks: [],
    arcs: [],
    vias: [],
    zones: [],
    shapes: [],
    texts: [],
    textBoxes: [],
    tables: [],
    images: [],
    dimensions: [],
    points: [],
    barcodes: [],
    groups: [],
    source: root,
  };
  // `(locked yes)` child on tracks/vias/zones/graphics (PCB_IO writes it via
  // KICAD_FORMAT::FormatBool for every lockable item).
  //
  // Upstream is not uniform about *how* it reads the token, so neither are we.
  // `lockedOf` covers the items whose `case T_locked` is
  // parseMaybeAbsentBool( true ) — segments (:7389), arcs (:7294), vias
  // (:7591), graphic shapes (:3611), text boxes (:4181) and dimensions
  // (:4951) — where 5.99 wrote a bare `(locked)`. `lockedBoolOf` covers the
  // ones that call plain `parseBool()`: zones (:8448), groups (:7046), images
  // (:3730), tables (:4363) and board text (:3923). For those, `(locked)`
  // without an argument is an error upstream; we stay lenient there rather
  // than fail a load over a form nothing has ever written.
  const lockedOf = (item: SList): boolean | undefined => maybeAbsent(item, 'locked', true);
  const lockedBoolOf = (item: SList): boolean | undefined => {
    const n = childNamed(item, 'locked');
    return n ? arg(n, 0) !== 'no' : undefined;
  };
  const general = childNamed(root, 'general');
  if (general) {
    const th = numberField(general, 'thickness');
    if (th !== undefined) board.thickness = mmToIU(th);
  }
  const layersNode = childNamed(root, 'layers');
  if (layersNode) {
    for (const l of layersNode.items) {
      if (!isList(l)) continue;
      const id = Number(head(l));
      const rest = args(l);
      if (!Number.isFinite(id)) continue;
      board.layers.push({ id, name: rest[0] ?? '', kind: rest[1] ?? 'user', userName: rest[2] });
    }
  }
  // From here to the end of the pass, a `(net "name")` on a copper graphic can
  // be resolved — and, when the name is new, declared. The `(net …)` rows come
  // first in the file, which is the same order the C++ parser depends on.
  readingNets = board.nets;
  for (const item of root.items) {
    if (!isList(item)) continue;
    switch (head(item)) {
      case 'net': {
        const code = numArg(item, 0);
        if (code !== undefined) board.nets.set(code, arg(item, 1) ?? '');
        break;
      }
      case 'footprint':
      case 'module': {
        const fp = readFootprint(item);
        if (fp) board.footprints.push(fp);
        break;
      }
      case 'segment': {
        const start = ptAt(childNamed(item, 'start'));
        const end = ptAt(childNamed(item, 'end'));
        if (start && end) {
          board.tracks.push({
            start,
            end,
            width: mmToIU(numberField(item, 'width') ?? 0),
            layer: layerOf(item),
            net: numberField(item, 'net') ?? 0,
            maskLayer: maskLayerOf(item),
            solderMaskMargin: maskMarginOf(item),
            locked: lockedOf(item),
            uuid: uuidOf(item),
            source: item,
          });
        }
        break;
      }
      case 'arc': {
        const start = ptAt(childNamed(item, 'start'));
        const mid = ptAt(childNamed(item, 'mid'));
        const end = ptAt(childNamed(item, 'end'));
        if (start && mid && end) {
          board.arcs.push({
            start,
            mid,
            end,
            width: mmToIU(numberField(item, 'width') ?? 0),
            layer: layerOf(item),
            net: numberField(item, 'net') ?? 0,
            maskLayer: maskLayerOf(item),
            solderMaskMargin: maskMarginOf(item),
            locked: lockedOf(item),
            uuid: uuidOf(item),
            source: item,
          });
        }
        break;
      }
      case 'via': {
        const at = ptAt(childNamed(item, 'at'));
        if (!at) break;
        const layersN = childNamed(item, 'layers');
        const ls = layersN ? args(layersN) : ['F.Cu', 'B.Cu'];
        const positional = args(item);
        board.vias.push({
          at,
          size: mmToIU(numberField(item, 'size') ?? 0),
          drill: mmToIU(numberField(item, 'drill') ?? 0),
          layers: [ls[0] ?? 'F.Cu', ls[1] ?? 'B.Cu'],
          kind: positional.includes('micro')
            ? 'micro'
            : positional.includes('blind')
              ? 'blind'
              : 'through',
          net: numberField(item, 'net') ?? 0,
          teardrops: readTeardropParams(childNamed(item, 'teardrops')),
          tenting: frontBackOptBoolOf(childNamed(item, 'tenting'), true),
          covering: frontBackOptBoolOf(childNamed(item, 'covering')),
          plugging: frontBackOptBoolOf(childNamed(item, 'plugging')),
          capping: optBoolOf(childNamed(item, 'capping')),
          filling: optBoolOf(childNamed(item, 'filling')),
          backdrill: readDrillSlot(item, 'backdrill', mmToIU),
          tertiaryDrill: readDrillSlot(item, 'tertiary_drill', mmToIU),
          frontPostMachining: readPostMachining(item, 'front_post_machining', mmToIU),
          backPostMachining: readPostMachining(item, 'back_post_machining', mmToIU),
          unconnectedLayerMode: readUnconnectedLayerMode(item, true),
          locked: lockedOf(item),
          uuid: uuidOf(item),
          source: item,
        });
        break;
      }
      case 'zone':
        board.zones.push({ ...readZone(item), locked: lockedBoolOf(item) });
        break;
      case 'group': {
        // `(group "name" (uuid …) [(locked yes)] (members "uuid"…))`, PCB_GROUP.
        const membersNode = childNamed(item, 'members');
        board.groups.push({
          name: arg(item, 0) ?? '',
          uuid: uuidOf(item),
          locked: lockedBoolOf(item),
          members: membersNode ? args(membersNode) : [],
          source: item,
        });
        break;
      }
      case 'gr_line':
      case 'gr_arc':
      case 'gr_circle':
      case 'gr_rect':
      case 'gr_poly':
      case 'gr_curve': {
        const s = readShape(item, null);
        if (s) board.shapes.push({ ...s, locked: lockedOf(item) });
        break;
      }
      case 'gr_text': {
        const tx = readPcbText(item, 'user', arg(item, 0) ?? '', null);
        if (tx) board.texts.push({ ...tx, locked: lockedBoolOf(item) });
        break;
      }
      case 'gr_text_box': {
        const tb = readTextBox(item);
        if (tb) board.textBoxes.push({ ...tb, locked: lockedOf(item) });
        break;
      }
      case 'image': {
        const img = readImage(item);
        if (img) board.images.push({ ...img, locked: lockedBoolOf(item) });
        break;
      }
      case 'table': {
        const tb = readTable(item);
        if (tb) board.tables.push({ ...tb, locked: lockedBoolOf(item) });
        break;
      }
      case 'dimension': {
        const d = readDimension(item);
        if (d) board.dimensions.push({ ...d, locked: lockedOf(item) });
        break;
      }
      case 'barcode':
        // `parseBOARD_unchecked`, T_barcode (`…_parser.cpp:1237`).
        board.barcodes.push(readBarcode(item));
        break;
      case 'point':
        // `parseBOARD_unchecked`, T_point (`…_parser.cpp:1330`): a board's own
        // snap points, `BOARD::Points()`. Nothing transforms them — they are
        // already board coordinates.
        board.points.push(readPoint(item));
        break;
      default:
        break;
    }
  }
  // Cleared unconditionally: a `.kicad_mod` read after a board read must not
  // resolve its graphics against the board that happened to be parsed last.
  readingNets = null;
  return board;
}
