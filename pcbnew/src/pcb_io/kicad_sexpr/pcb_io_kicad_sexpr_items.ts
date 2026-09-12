// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_IO_KICAD_SEXPR_PARSER`'s item readers (pcb_io_kicad_sexpr_parser.cpp
 * from :3230): one function per `parseXxx`, in the C++ order, over the
 * token reader in pcb_io_kicad_sexpr_parser.ts. Split from the class only
 * for file size; they are its methods in all but syntax.
 *
 * Coordinates: a footprint child is stored in the file relative to its
 * footprint; the C++ turns it into board coordinates on read
 * (`RotatePoint( fpOrientation )` + `Move( fpPosition )`) and back on write
 * (`formatInternalUnits( pt, parentFP )`). Our model keeps children
 * footprint-relative, so a child coordinate here is the file's value taken
 * through BOTH steps — `fpRoundTrip` — which is byte for byte what KiCad's
 * write of its board coordinate gives, rounding included.
 */
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { pcbIUScale } from '@ziroeda/common/src/eda_units.js';
import { convertToNewOverbarNotation } from '@ziroeda/common/src/string_utils.js';
import { kiidFromString, newKiid } from '@ziroeda/common/src/kiid.js';
import { T, DSNLEXER, PARSE_ERROR, type Tok } from '@ziroeda/common/src/dsnlexer.js';
import { CalcArcCenter } from '@ziroeda/kimath/src/trigo.js';
import { GetArcAngle } from '@ziroeda/common/src/eda_shape.js';
import {
  B_Cu,
  B_Fab,
  B_Mask,
  Dwgs_User,
  Edge_Cuts,
  F_Cu,
  F_Fab,
  F_Mask,
  F_SilkS,
  IsCopperLayer,
  Margin,
  UNDEFINED_LAYER,
} from '../../layer_ids.js';
import { LSET } from '../../lset.js';
import type { PCB_IO_KICAD_SEXPR_PARSER } from './pcb_io_kicad_sexpr_parser.js';
import type { StrokeType } from '../../types.js';
import {
  type FieldT,
  type KEdaText,
  type KFp3DModel,
  type KPcbBarcode,
  type KPcbReferenceImage,
  type KPcbDimension,
  type KPcbTable,
  type KPcbTableCell,
  type KPcbText,
  type KPcbTextBox,
  type CopperLayerProps,
  type DrillProps,
  FP_BOARD_ONLY,
  FP_DNP,
  FP_EXCLUDE_FROM_BOM,
  FP_EXCLUDE_FROM_POS_FILES,
  FP_SMD,
  FP_THROUGH_HOLE,
  type KFootprint,
  type KFpUnitInfo,
  type GeneratorValue,
  type KPad,
  type KPcbField,
  type KPcbGenerator,
  type KPcbGroup,
  type KPcbPoint,
  type KPcbTarget,
  type KPcbTrack,
  type KPcbVia,
  type KZone,
  defaultTeardropParams,
  fieldCanonicalName,
  newPadstack,
  PADSTACK_ALL_LAYERS,
  PADSTACK_INNER_LAYERS,
  type PadShape,
  type PostMachiningProps,
  RECT_CHAMFER_BOTTOM_LEFT,
  RECT_CHAMFER_BOTTOM_RIGHT,
  RECT_CHAMFER_TOP_LEFT,
  RECT_CHAMFER_TOP_RIGHT,
  copperLayerProps,
  defaultEdaText,
  newPad,
  newPcbText,
} from './kicad_board_items.js';

/** `KiROUND`. */
const KiROUND = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

/** `LEGACY_ARC_FORMATTING`: the last version to use old arc formatting. */
export const LEGACY_ARC_FORMATTING = 20210925;
/** `DEFAULT_LINE_WIDTH` (board_design_settings.h:42), mm. */
const DEFAULT_LINE_WIDTH = 0.1;

/** The footprint a child is being read into: its placement, for `fpRoundTrip`. */
export interface ParentFP {
  at: Vec2;
  angle: number;
}

/**
 * The C++ read-then-write of a footprint child coordinate: `RotatePoint` by
 * the footprint's orientation and translate to the board (parse), then the
 * inverse (format). `RotatePoint` rounds, so this is not the identity — and
 * the file KiCad writes carries exactly this.
 */
export function fpRoundTrip(pt: Vec2, fp: ParentFP | null): Vec2 {
  if (!fp || fp.angle === 0) return pt;
  const rot = new EDA_ANGLE(fp.angle);
  const board = RotatePoint(pt, rot);
  board.x += fp.at.x;
  board.y += fp.at.y;
  const back = { x: board.x - fp.at.x, y: board.y - fp.at.y };
  return RotatePoint(back, new EDA_ANGLE(-fp.angle));
}

/** `STROKE_PARAMS` (include/stroke_params.h). */
export interface StrokeParams {
  width: number;
  type: StrokeType;
  /** `m_color`, `COLOR4D::UNSPECIFIED` when absent. */
  color?: { r: number; g: number; b: number; a: number };
}

/** An outline entry as `formatPolyPts` writes it: a vertex, or one arc. */
export type OutlineEntry = { xy: Vec2 } | { arc: { start: Vec2; mid: Vec2; end: Vec2 } };

/** `SHAPE_T`. */
export type ShapeT = 'segment' | 'rectangle' | 'arc' | 'circle' | 'poly' | 'bezier';

/** `FILL_T` as the parser sets it. */
export type FillT = 'no_fill' | 'filled_shape' | 'hatch' | 'reverse_hatch' | 'cross_hatch';

/** `PCB_SHAPE`, every member the parser sets and the formatter reads. */
export interface KPcbShape {
  shape: ShapeT;
  start: Vec2;
  end: Vec2;
  /** ARC: the centre, `m_arcCenter`; the mid as `GetArcMid()` will return it. */
  arcCenter?: Vec2;
  arcMid?: Vec2;
  /** BEZIER control points. */
  bezierC1?: Vec2;
  bezierC2?: Vec2;
  /** POLY: the outline, arcs kept. */
  outline?: OutlineEntry[];
  cornerRadius: number;
  stroke: StrokeParams;
  fill: FillT;
  locked: boolean;
  /** `m_layer`; a PCB_SHAPE is on one layer. */
  layer: number;
  /** `m_hasSolderMask`: `(layers …)` named the mask of the copper side too. */
  hasSolderMask: boolean;
  /** `GetLocalSolderMaskMargin()`. */
  solderMaskMargin?: number;
  net: NetRef;
  uuid: string;
  /** `IsProxyItem()`: a `gr_vector` / `gr_bbox` pad primitive. */
  proxy: boolean;
}

/**
 * `BOARD_CONNECTED_ITEM::GetNet()`: the net's name and code (`NETINFO_LIST`
 * numbering); null is the unconnected net, code 0.
 */
export type NetRef = { name: string; code: number } | null;

/** `STROKE_PARAMS_PARSER::ParseStroke` (common/stroke_params.cpp). */
export function parseStroke(p: PCB_IO_KICAD_SEXPR_PARSER, stroke: StrokeParams): void {
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      case 'width':
        stroke.width = p.parseBoardUnits('stroke width');
        p.NeedRIGHT();
        break;
      case 'type': {
        token = p.NextTok();
        switch (token) {
          case 'dash':
            stroke.type = 'dash';
            break;
          case 'dot':
            stroke.type = 'dot';
            break;
          case 'dash_dot':
            stroke.type = 'dash_dot';
            break;
          case 'dash_dot_dot':
            stroke.type = 'dash_dot_dot';
            break;
          case 'solid':
            stroke.type = 'solid';
            break;
          case 'default':
            stroke.type = 'default';
            break;
          default:
            p.Expecting('solid, dash, dash_dot, dash_dot_dot, dot or default');
        }
        p.NeedRIGHT();
        break;
      }
      case 'color': {
        const r = p.parseInt('red');
        const g = p.parseInt('green');
        const b = p.parseInt('blue');
        const a = p.parseDoubleNext('alpha');
        stroke.color = { r: r / 255.0, g: g / 255.0, b: b / 255.0, a };
        p.NeedRIGHT();
        break;
      }
      default:
        p.Expecting('width, type, or color');
    }
  }
}

/** `CurStrToKIID()` (:8695). */
export function CurStrToKIID(p: PCB_IO_KICAD_SEXPR_PARSER): string {
  let idStr = p.CurText();
  // Older files did not quote UUIDs
  if (idStr.startsWith('"') && idStr.endsWith('"')) idStr = idStr.slice(1, -1);
  return kiidFromString(idStr);
}

/** `parseOutlinePoints` into a list, through `parseOutlinePoints()` of the class. */
export function readOutline(p: PCB_IO_KICAD_SEXPR_PARSER, out: OutlineEntry[]): void {
  out.push(p.parseOutlinePoints());
}

/**
 * `EDA_SHAPE::SetArcGeometry( aStart, aMid, aEnd )` (eda_shape.cpp:1180):
 * the centre from the three points, and the ends swapped when the input
 * winding does not match — in which case `GetArcMid()` is recomputed from
 * the centre, otherwise the file's mid point is kept "to minimize churn".
 */
export function setArcGeometry(
  start: Vec2,
  mid: Vec2,
  end: Vec2,
): { start: Vec2; end: Vec2; center: Vec2; mid: Vec2 } {
  const center = CalcArcCenter(start, mid, end);
  // GetArcMid() with no cache: start rotated about the centre by -angle/2.
  const angle = GetArcAngle(start, end, center);
  const newMid = RotatePoint(start, center, new EDA_ANGLE(-angle.AsDegrees() / 2.0));
  const dx = newMid.x - mid.x;
  const dy = newMid.y - mid.y;
  const cx = newMid.x - center.x;
  const cy = newMid.y - center.y;
  if (dx * dx + dy * dy > cx * cx + cy * cy) {
    // Ends swapped: the cached mid no longer matches, so it is recomputed.
    const angle2 = GetArcAngle(end, start, center);
    const mid2 = RotatePoint(end, center, new EDA_ANGLE(-angle2.AsDegrees() / 2.0));
    return { start: end, end: start, center, mid: mid2 };
  }
  return { start, end, center, mid };
}

/** `parsePCB_SHAPE( aParent )` (:3230). */
export function parsePCB_SHAPE(p: PCB_IO_KICAD_SEXPR_PARSER, parentFP: ParentFP | null): KPcbShape {
  const stroke: StrokeParams = { width: 0, type: 'solid' };
  const shape: KPcbShape = {
    shape: 'segment',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    cornerRadius: 0,
    stroke,
    fill: 'no_fill',
    locked: false,
    // `PCB_SHAPE::PCB_SHAPE`: on F_Cu until the file says otherwise.
    layer: F_Cu,
    hasSolderMask: false,
    net: null,
    uuid: newKiid(),
    proxy: false,
  };
  let token: Tok;
  const pt = (): Vec2 => {
    const x = p.parseBoardUnits('X coordinate');
    const y = p.parseBoardUnits('Y coordinate');
    return { x, y };
  };

  const head = p.CurTok();
  switch (head) {
    case 'gr_arc':
    case 'fp_arc': {
      shape.shape = 'arc';
      token = p.NextTok();
      if (token === 'locked') {
        shape.locked = true;
        token = p.NextTok();
      }
      if (token !== T.LEFT) p.Expecting(T.LEFT);
      token = p.NextTok();
      if (p.requiredVersion <= LEGACY_ARC_FORMATTING) {
        // In legacy files the start keyword actually gives the arc center...
        if (token !== 'start') p.Expecting('start');
        const center = pt();
        p.NeedRIGHT();
        p.NeedLEFT();
        token = p.NextTok();
        // ... and the end keyword gives the start point of the arc
        if (token !== 'end') p.Expecting('end');
        const start = pt();
        p.NeedRIGHT();
        p.NeedLEFT();
        token = p.NextTok();
        if (token !== 'angle') p.Expecting('angle');
        const angle = p.parseDoubleNext('arc angle');
        p.NeedRIGHT();
        // `SetArcAngleAndEnd( angle, true )`: the end is the start rotated
        // about the centre by -angle, ends swapped for a negative angle.
        const legacy = setArcAngleAndEnd(start, center, angle);
        shape.start = legacy.start;
        shape.end = legacy.end;
        shape.arcCenter = center;
        const a = GetArcAngle(shape.start, shape.end, center);
        shape.arcMid = RotatePoint(shape.start, center, new EDA_ANGLE(-a.AsDegrees() / 2.0));
      } else {
        if (token !== 'start') p.Expecting('start');
        const arcStart = pt();
        p.NeedRIGHT();
        p.NeedLEFT();
        token = p.NextTok();
        if (token !== 'mid') p.Expecting('mid');
        const arcMid = pt();
        p.NeedRIGHT();
        p.NeedLEFT();
        token = p.NextTok();
        if (token !== 'end') p.Expecting('end');
        const arcEnd = pt();
        p.NeedRIGHT();
        const g = setArcGeometry(arcStart, arcMid, arcEnd);
        shape.start = g.start;
        shape.end = g.end;
        shape.arcCenter = g.center;
        shape.arcMid = g.mid;
      }
      break;
    }

    case 'gr_circle':
    case 'fp_circle':
      shape.shape = 'circle';
      token = p.NextTok();
      if (token === 'locked') {
        shape.locked = true;
        token = p.NextTok();
      }
      if (token !== T.LEFT) p.Expecting(T.LEFT);
      token = p.NextTok();
      if (token !== 'center') p.Expecting('center');
      shape.start = pt();
      p.NeedRIGHT();
      p.NeedLEFT();
      token = p.NextTok();
      if (token !== 'end') p.Expecting('end');
      shape.end = pt();
      p.NeedRIGHT();
      break;

    case 'gr_curve':
    case 'fp_curve':
      shape.shape = 'bezier';
      token = p.NextTok();
      if (token === 'locked') {
        shape.locked = true;
        token = p.NextTok();
      }
      if (token !== T.LEFT) p.Expecting(T.LEFT);
      token = p.NextTok();
      if (token !== 'pts') p.Expecting('pts');
      shape.start = p.parseXY();
      shape.bezierC1 = p.parseXY();
      shape.bezierC2 = p.parseXY();
      shape.end = p.parseXY();
      p.NeedRIGHT();
      break;

    case 'gr_bbox':
    case 'gr_rect':
    case 'fp_rect':
      shape.shape = 'rectangle';
      shape.proxy = head === 'gr_bbox';
      token = p.NextTok();
      if (token === 'locked') {
        shape.locked = true;
        token = p.NextTok();
      }
      if (token !== T.LEFT) p.Expecting(T.LEFT);
      token = p.NextTok();
      if (token !== 'start') p.Expecting('start');
      shape.start = pt();
      p.NeedRIGHT();
      p.NeedLEFT();
      token = p.NextTok();
      if (token !== 'end') p.Expecting('end');
      shape.end = pt();
      if (parentFP) {
        // Footprint shapes are stored in board-relative coordinates, but we want the
        // normalization to remain in footprint-relative coordinates.
      } else {
        // `Normalize()`: start the min corner, end the max.
        const s = shape.start;
        const e = shape.end;
        shape.start = { x: Math.min(s.x, e.x), y: Math.min(s.y, e.y) };
        shape.end = { x: Math.max(s.x, e.x), y: Math.max(s.y, e.y) };
      }
      p.NeedRIGHT();
      break;

    case 'gr_vector':
    case 'gr_line':
    case 'fp_line':
      shape.shape = 'segment';
      shape.proxy = head === 'gr_vector';
      token = p.NextTok();
      if (token === 'locked') {
        shape.locked = true;
        token = p.NextTok();
      }
      if (token !== T.LEFT) p.Expecting(T.LEFT);
      token = p.NextTok();
      if (token !== 'start') p.Expecting('start');
      shape.start = pt();
      p.NeedRIGHT();
      p.NeedLEFT();
      token = p.NextTok();
      if (token !== 'end') p.Expecting('end');
      shape.end = pt();
      p.NeedRIGHT();
      break;

    case 'gr_poly':
    case 'fp_poly': {
      shape.shape = 'poly';
      const outline: OutlineEntry[] = [];
      shape.outline = outline;
      token = p.NextTok();
      if (token === 'locked') {
        shape.locked = true;
        token = p.NextTok();
      }
      if (token !== T.LEFT) p.Expecting(T.LEFT);
      token = p.NextTok();
      if (token !== 'pts') p.Expecting('pts');
      for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) readOutline(p, outline);
      break;
    }

    default:
      if (parentFP) p.Expecting('fp_arc, fp_circle, fp_curve, fp_line, fp_poly or fp_rect');
      else
        p.Expecting('gr_arc, gr_circle, gr_curve, gr_vector, gr_line, gr_poly, gr_rect or gr_bbox');
  }

  let foundFill = false;

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      case 'angle': // legacy token; ignore value
        p.parseDoubleNext('arc angle');
        p.NeedRIGHT();
        break;
      case 'layer':
        shape.layer = p.parseBoardItemLayer();
        p.NeedRIGHT();
        break;
      case 'layers':
        // `PCB_SHAPE::SetLayerSet` (pcb_shape.cpp:256): the copper layer
        // becomes m_layer, a mask layer sets m_hasSolderMask.
        for (const layer of p.parseBoardItemLayersAsMask().Seq()) {
          if (IsCopperLayer(layer)) shape.layer = layer;
          else if (layer === F_Mask || layer === B_Mask) shape.hasSolderMask = true;
        }
        break;
      case 'solder_mask_margin':
        shape.solderMaskMargin = p.parseBoardUnits('local solder mask margin value');
        p.NeedRIGHT();
        break;
      case 'width': // legacy token
        stroke.width = p.parseBoardUnits('width');
        p.NeedRIGHT();
        break;
      case 'radius':
        shape.cornerRadius = p.parseBoardUnits('corner radius');
        p.NeedRIGHT();
        break;
      case 'stroke':
        parseStroke(p, stroke);
        break;
      case 'tstamp':
      case 'uuid':
        p.NextTok();
        shape.uuid = CurStrToKIID(p);
        p.NeedRIGHT();
        break;
      case 'fill':
        foundFill = true;
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();
          switch (token) {
            // T_yes was used to indicate filling when first introduced, so treat it like a
            // solid fill since that was the only fill available at the time.
            case 'yes':
            case 'solid':
              shape.fill = 'filled_shape';
              break;
            case 'none':
            case 'no':
              shape.fill = 'no_fill';
              break;
            case 'hatch':
              shape.fill = 'hatch';
              break;
            case 'reverse_hatch':
              shape.fill = 'reverse_hatch';
              break;
            case 'cross_hatch':
              shape.fill = 'cross_hatch';
              break;
            default:
              p.Expecting('yes, no, solid, none, hatch, reverse_hatch or cross_hatch');
          }
        }
        break;
      case 'status': // legacy token; ignore value
        p.parseHex();
        p.NeedRIGHT();
        break;
      // Handle "(locked)" from 5.99 development, and "(locked yes)" from modern times
      case 'locked':
        shape.locked = p.parseMaybeAbsentBool(true);
        break;
      case 'net':
        shape.net = p.parseNet();
        break;
      default:
        p.Expecting('layer, width, fill, tstamp, uuid, locked, net, status, or solder_mask_margin');
    }
  }

  if (!foundFill) {
    // Legacy versions didn't have a filled flag but allowed some shapes to indicate they
    // should be filled by specifying a 0 stroke-width.
    if (stroke.width === 0 && (shape.shape === 'rectangle' || shape.shape === 'circle')) {
      shape.fill = 'filled_shape';
    } else if (shape.shape === 'poly' && shape.layer !== Edge_Cuts) {
      // Polygons on non-Edge_Cuts layers were always filled.
      shape.fill = 'filled_shape';
    }
  }

  // Only filled shapes may have a zero line-width.  This is not permitted in KiCad but some
  // external tools can generate invalid files.
  if (stroke.width <= 0 && shape.fill === 'no_fill')
    stroke.width = pcbIUScale.mmToIU(DEFAULT_LINE_WIDTH);

  if (parentFP) {
    // `shape->Rotate( { 0, 0 }, parentFP->GetOrientation() ); shape->Move( parentFP->GetPosition() );`
    // and the inverse on write: every coordinate through `fpRoundTrip`.
    shape.start = fpRoundTrip(shape.start, parentFP);
    shape.end = fpRoundTrip(shape.end, parentFP);
    if (shape.arcCenter) shape.arcCenter = fpRoundTrip(shape.arcCenter, parentFP);
    if (shape.arcMid) shape.arcMid = fpRoundTrip(shape.arcMid, parentFP);
    if (shape.bezierC1) shape.bezierC1 = fpRoundTrip(shape.bezierC1, parentFP);
    if (shape.bezierC2) shape.bezierC2 = fpRoundTrip(shape.bezierC2, parentFP);
    if (shape.outline) {
      shape.outline = shape.outline.map((e) =>
        'xy' in e
          ? { xy: fpRoundTrip(e.xy, parentFP) }
          : {
              arc: {
                start: fpRoundTrip(e.arc.start, parentFP),
                mid: fpRoundTrip(e.arc.mid, parentFP),
                end: fpRoundTrip(e.arc.end, parentFP),
              },
            },
      );
    }
  }

  return shape;
}

/**
 * `EDA_SHAPE::SetArcAngleAndEnd( aAngle, aCheckNegativeAngle = true )`
 * (eda_shape.cpp): the end is the start rotated about the centre by
 * -angle; a negative angle swaps the ends.
 */
function setArcAngleAndEnd(
  start: Vec2,
  center: Vec2,
  angleDeg: number,
): { start: Vec2; end: Vec2 } {
  const normalized = new EDA_ANGLE(angleDeg).Normalize720();
  const end = RotatePoint(start, center, new EDA_ANGLE(-normalized.AsDegrees()));
  if (angleDeg < 0) return { start: end, end: start };
  return { start, end };
}

export { DSNLEXER };

/** `PCB_SHAPE::GetLayerSet()` (pcb_shape.cpp:237): the layer, plus its side's mask when `m_hasSolderMask`. */
export function shapeLayerSet(shape: { layer: number; hasSolderMask: boolean }): LSET {
  const layermask = new LSET([shape.layer]);
  if (shape.hasSolderMask) {
    if (layermask.test(F_Cu)) layermask.set(F_Mask);
    if (layermask.test(B_Cu)) layermask.set(B_Mask);
  }
  return layermask;
}

// ---------------------------------------------------------------------------
// EDA_TEXT, PCB_TEXT, PCB_FIELD (:736, :862, :3757, :3838)
// ---------------------------------------------------------------------------

/** `parseEDA_TEXT( aText )` (:736): after `(effects`, through its `)`. */
export function parseEDA_TEXT(p: PCB_IO_KICAD_SEXPR_PARSER, text: KEdaText): void {
  // These are not written out if center/center and/or no mirror,
  // so we have to make sure we start that way.
  // (these parameters will be set in T_justify section, when existing)
  text.hJustify = 'center';
  text.vJustify = 'center';
  text.mirrored = false;

  // In version 20210606 the notation for overbars was changed from `~...~` to `~{...}`.
  // We need to convert the old syntax to the new one.
  if (p.requiredVersion < 20210606) text.text = convertToNewOverbarNotation(text.text);

  // Prior to v5.0 text size was omitted from file format if equal to 60mils
  // Now, it is always explicitly written to file
  let foundTextSize = false;

  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token === T.LEFT) token = p.NextTok();
    switch (token) {
      case 'font':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) continue;
          switch (token) {
            case 'face':
              p.NeedSYMBOL();
              text.fontName = p.CurText();
              p.NeedRIGHT();
              break;
            case 'size': {
              const y = p.parseBoardUnits('text height');
              const x = p.parseBoardUnits('text width');
              text.size = { x, y };
              p.NeedRIGHT();
              foundTextSize = true;
              break;
            }
            case 'line_spacing':
              text.lineSpacing = p.parseDoubleNext('line spacing');
              p.NeedRIGHT();
              break;
            case 'thickness':
              text.thickness = p.parseBoardUnits('text thickness');
              text.autoThickness = false;
              p.NeedRIGHT();
              break;
            case 'bold':
              text.bold = p.parseMaybeAbsentBool(true);
              break;
            case 'italic':
              text.italic = p.parseMaybeAbsentBool(true);
              break;
            case 'color': {
              // Read by EDA_TEXT's own parsers (the schematic); a board file
              // never carries it, but the grammar allows it.
              const r = p.parseInt('red');
              const g = p.parseInt('green');
              const b = p.parseInt('blue');
              const a = p.parseDoubleNext('alpha');
              text.color = { r: r / 255, g: g / 255, b: b / 255, a };
              p.NeedRIGHT();
              break;
            }
            default:
              p.Expecting('face, size, line_spacing, thickness, bold, or italic');
          }
        }
        break;

      case 'justify':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) continue;
          switch (token) {
            case 'left':
              text.hJustify = 'left';
              break;
            case 'right':
              text.hJustify = 'right';
              break;
            case 'top':
              text.vJustify = 'top';
              break;
            case 'bottom':
              text.vJustify = 'bottom';
              break;
            case 'mirror':
              text.mirrored = true;
              break;
            default:
              p.Expecting('left, right, top, bottom, or mirror');
          }
        }
        break;

      case 'hide': {
        // In older files, the hide token appears bare, and indicates hide==true.
        // In newer files, it will be an explicit bool in a list like (hide yes)
        const hide = p.parseMaybeAbsentBool(true);
        text.visible = !hide;
        break;
      }

      case 'href':
        p.NeedSYMBOLorNUMBER();
        text.hyperlink = p.CurText();
        p.NeedRIGHT();
        break;

      default:
        p.Expecting('font, justify, or hide');
    }
  }

  // Text size was not specified in file, force legacy default units
  // 60mils is 1.524mm
  if (!foundTextSize) {
    const defaultTextSize = 1.524 * pcbIUScale.IU_PER_MM;
    text.size = { x: defaultTextSize, y: defaultTextSize };
  }
}

/** `parseRenderCache( text )` (:862): after `(render_cache`, through its `)`. */
export function parseRenderCache(p: PCB_IO_KICAD_SEXPR_PARSER, text: KEdaText): void {
  p.NeedSYMBOLorNUMBER();
  const cacheText = p.CurText();
  const cacheAngle = p.parseDoubleNext('render cache angle');
  const glyphs: OutlineEntry[][][] = [];
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    if (token !== 'polygon') p.Expecting('polygon');
    const poly: OutlineEntry[][] = [];
    for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
      if (token !== T.LEFT) p.Expecting(T.LEFT);
      token = p.NextTok();
      if (token !== 'pts') p.Expecting('pts');
      const chain: OutlineEntry[] = [];
      for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) readOutline(p, chain);
      poly.push(chain);
    }
    glyphs.push(poly);
  }
  text.renderCache = { text: cacheText, angle: cacheAngle, glyphs };
}

/**
 * `parsePCB_TEXT( aParent, aBaseText )` (:3757): after `gr_text` / `fp_text`,
 * through the `)`. Returns the text, and for a footprint whether it is the
 * reference or value field, a hidden user text turned into a field, or a
 * plain text.
 */
export function parsePCB_TEXT(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  parentFP: ParentFPText | null,
  baseText: KPcbText | null = null,
  isDimensionText = false,
): { text: KPcbText; fieldId?: FieldT } {
  let text: KPcbText;
  let fieldId: FieldT | undefined;
  let token = p.NextTok();

  // If a base text is provided, we have a derived text already parsed and just need to update it
  if (baseText) {
    text = baseText;
  } else if (parentFP) {
    switch (token) {
      case 'reference':
        fieldId = 'reference';
        break;
      case 'value':
        fieldId = 'value';
        break;
      case 'user':
        break;
      default:
        throw new Error(`Cannot handle footprint text type ${p.CurText()}`);
    }
    text = newPcbText(parentFP);
    token = p.NextTok();
  } else {
    text = newPcbText(null);
  }

  // Legacy bare locked token
  if (token === 'locked') {
    text.locked = true;
    token = p.NextTok();
  }

  if (!DSNLEXER.IsSymbol(token) && token !== T.NUMBER) p.Expecting('text value');

  let value = p.CurText();
  value = value.replaceAll('%V', '${VALUE}');
  value = value.replaceAll('%R', '${REFERENCE}');
  text.text = value;

  p.NeedLEFT();

  parsePCB_TEXT_effects(p, text, parentFP, isDimensionText);

  if (parentFP) {
    // Convert hidden footprint text (which is no longer supported) into a hidden field
    if (!text.visible && fieldId === undefined) fieldId = 'user';
  } else {
    // Hidden PCB text is no longer supported
    text.visible = true;
  }

  return { text, fieldId };
}

/** The footprint a text is being read into, for `parsePCB_TEXT_effects`. */
export interface ParentFPText extends ParentFP {
  layer: number;
}

/** `parsePCB_TEXT_effects( aText, aBaseText )` (:3838): after the text value's `(`. */
export function parsePCB_TEXT_effects(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  text: KPcbText,
  parentFP: ParentFPText | null,
  isDimensionText = false,
): void {
  let hasAngle = false; // Old files do not have a angle specified.
  // in this case it is 0 expected to be 0
  let hasPos = false;

  // By default, texts in footprints have a locked rotation (i.e. rot = -90 ... 90 deg)
  if (parentFP) text.keepUpright = true;

  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token === T.LEFT) token = p.NextTok();
    switch (token) {
      case 'at': {
        hasPos = true;
        const x = p.parseBoardUnits('X coordinate');
        const y = p.parseBoardUnits('Y coordinate');
        text.pos = { x, y };
        token = p.NextTok();
        if (p.CurTok() === T.NUMBER) {
          text.angle = p.parseDouble();
          hasAngle = true;
          token = p.NextTok();
        }
        // Legacy location of this token; presence implies true
        if (parentFP && p.CurTok() === 'unlocked') {
          text.keepUpright = false;
          token = p.NextTok();
        }
        if (token !== T.RIGHT) p.Expecting(T.RIGHT);
        break;
      }
      case 'layer':
        text.layer = p.parseBoardItemLayer();
        token = p.NextTok();
        if (token === 'knockout') {
          text.knockout = true;
          token = p.NextTok();
        }
        if (token !== T.RIGHT) p.Expecting(T.RIGHT);
        break;
      case 'tstamp':
      case 'uuid':
        p.NextTok();
        text.uuid = CurStrToKIID(p);
        p.NeedRIGHT();
        break;
      case 'hide': {
        // In older files, the hide token appears bare, and indicates hide==true.
        // In newer files, it will be an explicit bool in a list like (hide yes)
        const hide = p.parseMaybeAbsentBool(true);
        if (parentFP) text.visible = !hide;
        else p.Expecting('layer, effects, locked, render_cache, uuid or tstamp');
        break;
      }
      case 'locked':
        // Newer list-enclosed locked
        text.locked = p.parseBool();
        p.NeedRIGHT();
        break;
      // Confusingly, "unlocked" is not the opposite of "locked", but refers to "keep upright"
      case 'unlocked':
        if (parentFP) text.keepUpright = !p.parseBool();
        else p.Expecting('layer, effects, locked, render_cache or tstamp');
        p.NeedRIGHT();
        break;
      case 'effects':
        parseEDA_TEXT(p, text);
        break;
      case 'render_cache':
        parseRenderCache(p, text);
        break;
      default:
        if (parentFP) p.Expecting('layer, hide, effects, locked, render_cache or tstamp');
        else p.Expecting('layer, effects, locked, render_cache or tstamp');
    }
  }

  // If there is no orientation defined, then it is the default value of 0 degrees.
  if (!hasAngle) text.angle = 0;

  if (parentFP && !isDimensionText) {
    // make PCB_TEXT rotation relative to the parent footprint.
    // It was read as absolute rotation from file
    // Note: this is not rue for PCB_DIMENSION items that use the board
    // coordinates
    const relative = text.angle - parentFP.angle;

    // Move and rotate the text to its board coordinates (`PCB_TEXT::Rotate`:
    // the position rotated, the angle added back and normalised) — and then
    // the write reads `GetTextAngle()` absolute and `GetTextPos()` taken back
    // through `formatInternalUnits( pos, parentFP )`.
    const absolute = new EDA_ANGLE(relative + parentFP.angle).Normalize().AsDegrees();
    text.angle = absolute;

    const rot = new EDA_ANGLE(parentFP.angle);
    const boardPos = RotatePoint(text.pos, rot);
    // Only move offset from parent position if we read a position from the file.
    // These positions are relative to the parent footprint. If we don't have a position
    // then the text defaults to the parent position and moving again will double it.
    if (hasPos) {
      boardPos.x += parentFP.at.x;
      boardPos.y += parentFP.at.y;
    }
    const back = { x: boardPos.x - parentFP.at.x, y: boardPos.y - parentFP.at.y };
    text.pos = RotatePoint(back, new EDA_ANGLE(-parentFP.angle));
  }
}

// ---------------------------------------------------------------------------
// FP_3DMODEL (:912)
// ---------------------------------------------------------------------------

/** `parse3DModel()` (:912): after `model`, through the `)`. */
export function parse3DModel(p: PCB_IO_KICAD_SEXPR_PARSER): KFp3DModel {
  p.NeedSYMBOLorNUMBER();
  const n3D: KFp3DModel = {
    filename: p.CurText(),
    show: true,
    opacity: 1.0,
    offset: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
  const xyz = (): { x: number; y: number; z: number } => {
    p.NeedLEFT();
    const token = p.NextTok();
    if (token !== 'xyz') p.Expecting('xyz');
    const x = p.parseDoubleNext('x value');
    const y = p.parseDoubleNext('y value');
    const z = p.parseDoubleNext('z value');
    p.NeedRIGHT(); // xyz
    p.NeedRIGHT(); // the list
    return { x, y, z };
  };
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token === T.LEFT) token = p.NextTok();
    switch (token) {
      case 'at': {
        // Prior to KiCad v5, model offset was designated by "at", and the
        // units were in inches. Now we use mm, but support reading of legacy files
        const v = xyz();
        n3D.offset = { x: v.x * 25.4, y: v.y * 25.4, z: v.z * 25.4 };
        break;
      }
      case 'hide': {
        const hide = p.parseMaybeAbsentBool(true);
        n3D.show = !hide;
        break;
      }
      case 'opacity':
        n3D.opacity = p.parseDoubleNext('opacity value');
        p.NeedRIGHT();
        break;
      case 'offset':
        n3D.offset = xyz();
        break;
      case 'scale':
        n3D.scale = xyz();
        break;
      case 'rotate':
        n3D.rotation = xyz();
        break;
      default:
        p.Expecting('at, hide, opacity, offset, scale, or rotate');
    }
  }
  return n3D;
}

// ---------------------------------------------------------------------------
// PCB_REFERENCE_IMAGE (:3659), PCB_BARCODE (:3979)
// ---------------------------------------------------------------------------

/** `parsePCB_REFERENCE_IMAGE( aParent )` (:3659). */
export function parsePCB_REFERENCE_IMAGE(p: PCB_IO_KICAD_SEXPR_PARSER): KPcbReferenceImage {
  const bitmap: KPcbReferenceImage = {
    pos: { x: 0, y: 0 },
    layer: F_Cu,
    scale: 1.0,
    locked: false,
    data: '',
    uuid: newKiid(),
  };
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      case 'at': {
        const x = p.parseBoardUnits('X coordinate');
        const y = p.parseBoardUnits('Y coordinate');
        bitmap.pos = { x, y };
        p.NeedRIGHT();
        break;
      }
      case 'layer':
        bitmap.layer = p.parseBoardItemLayer();
        p.NeedRIGHT();
        break;
      case 'scale': {
        bitmap.scale = p.parseDoubleNext('image scale factor');
        // `std::isnormal`: zero, subnormal, inf or nan reset to 1.
        if (
          !Number.isFinite(bitmap.scale) ||
          bitmap.scale === 0 ||
          Math.abs(bitmap.scale) < 2.2250738585072014e-308
        )
          bitmap.scale = 1.0;
        p.NeedRIGHT();
        break;
      }
      case 'data': {
        token = p.NextTok();
        let data = '';
        while (token !== T.RIGHT) {
          if (!DSNLEXER.IsSymbol(token)) p.Expecting('base64 image data');
          data += p.CurText();
          token = p.NextTok();
        }
        bitmap.data = data;
        break;
      }
      case 'locked': {
        // This has only ever been (locked yes) format
        bitmap.locked = p.parseBool();
        p.NeedRIGHT();
        break;
      }
      case 'uuid':
        p.NextTok();
        bitmap.uuid = CurStrToKIID(p);
        p.NeedRIGHT();
        break;
      default:
        p.Expecting('at, layer, scale, data, locked or uuid');
    }
  }
  return bitmap;
}

/** `parsePCB_BARCODE( aParent )` (:3979). */
export function parsePCB_BARCODE(p: PCB_IO_KICAD_SEXPR_PARSER): KPcbBarcode {
  const barcode: KPcbBarcode = {
    locked: false,
    pos: { x: 0, y: 0 },
    angle: 0,
    layer: F_SilkS,
    width: 0,
    height: 0,
    text: '',
    textHeight: 0,
    kind: 'code39',
    ecc: 'L',
    showText: true,
    knockout: false,
    margin: { x: 0, y: 0 },
    uuid: newKiid(),
  };
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      case 'at': {
        const x = p.parseBoardUnits('X coordinate');
        const y = p.parseBoardUnits('Y coordinate');
        barcode.pos = { x, y };
        token = p.NextTok();
        if (p.CurTok() === T.NUMBER) {
          barcode.angle = p.parseDouble();
          p.NeedRIGHT();
        } else if (token !== T.RIGHT) p.Expecting(T.RIGHT);
        break;
      }
      case 'layer':
        barcode.layer = p.parseBoardItemLayer();
        p.NeedRIGHT();
        break;
      case 'size': {
        barcode.width = p.parseBoardUnits('barcode width');
        barcode.height = p.parseBoardUnits('barcode height');
        p.NeedRIGHT();
        break;
      }
      case 'text':
        if (p.NextTok() !== T.STRING) p.Expecting(T.STRING);
        barcode.text = p.CurText();
        p.NeedRIGHT();
        break;
      case 'text_height':
        barcode.textHeight = p.parseBoardUnits('barcode text height');
        p.NeedRIGHT();
        break;
      case 'type': {
        p.NeedSYMBOL();
        const kind = p.CurText();
        if (kind === 'code39') barcode.kind = 'code39';
        else if (kind === 'code128') barcode.kind = 'code128';
        else if (kind === 'datamatrix' || kind === 'data_matrix') barcode.kind = 'datamatrix';
        else if (kind === 'qr' || kind === 'qrcode') barcode.kind = 'qr';
        else if (kind === 'microqr' || kind === 'micro_qr') barcode.kind = 'microqr';
        else p.Expecting('barcode type');
        p.NeedRIGHT();
        break;
      }
      case 'ecc_level': {
        p.NeedSYMBOL();
        const ecc = p.CurText().toUpperCase();
        if (ecc === 'L' || ecc === 'M' || ecc === 'Q' || ecc === 'H') barcode.ecc = ecc;
        else p.Expecting('ecc level');
        p.NeedRIGHT();
        break;
      }
      case 'locked':
        barcode.locked = p.parseMaybeAbsentBool(true);
        break;
      case 'tstamp':
      case 'uuid':
        p.NextTok();
        barcode.uuid = CurStrToKIID(p);
        p.NeedRIGHT();
        break;
      case 'hide':
        barcode.showText = !p.parseBool();
        p.NeedRIGHT();
        break;
      case 'knockout':
        barcode.knockout = p.parseBool();
        p.NeedRIGHT();
        break;
      case 'margins': {
        const x = p.parseBoardUnits('margin X');
        const y = p.parseBoardUnits('margin Y');
        barcode.margin = { x, y };
        p.NeedRIGHT();
        break;
      }
      default:
        p.Expecting(
          'at, layer, size, text, text_height, type, ecc_level, locked, hide, knockout, margins or uuid',
        );
    }
  }
  return barcode;
}

// ---------------------------------------------------------------------------
// PCB_TEXTBOX / PCB_TABLECELL / PCB_TABLE (:4122-4500)
// ---------------------------------------------------------------------------

/** `PCB_TEXTBOX::GetLegacyTextMargin()` (pcb_textbox.cpp:193). */
const legacyTextMargin = (strokeWidth: number, textHeight: number): number =>
  KiROUND(strokeWidth / 2.0) + KiROUND(textHeight * 0.75);

/** `PCB_TEXTBOX::PCB_TEXTBOX( aParent )`. */
export function newTextBox(): KPcbTextBox {
  const t: KPcbTextBox = {
    ...defaultEdaText(),
    shape: 'rectangle',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    marginLeft: 0,
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    // `PCB_SHAPE( …, SHAPE_T::RECTANGLE )`: a default stroke.
    stroke: { width: 0, type: 'default' },
    borderEnabled: true,
    knockout: false,
    layer: F_Cu,
    locked: false,
    uuid: newKiid(),
  };
  t.hJustify = 'left';
  t.vJustify = 'center';
  const m = legacyTextMargin(t.stroke.width, t.size.y);
  t.marginLeft = t.marginTop = t.marginRight = t.marginBottom = m;
  return t;
}

/** `parseTextBoxContent( aTextBox )` (:4148): after `gr_text_box` / `fp_text_box` / `table_cell`. */
export function parseTextBoxContent(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  textbox: KPcbTextBox,
  parentFP: ParentFP | null,
  cell: KPcbTableCell | null,
): void {
  const stroke: StrokeParams = { width: -1, type: 'solid' };
  let foundMargins = false;

  let token = p.NextTok();
  // Legacy locked
  if (token === 'locked') {
    textbox.locked = true;
    token = p.NextTok();
  }
  if (!DSNLEXER.IsSymbol(token) && token !== T.NUMBER) p.Expecting('text value');
  textbox.text = p.CurText();

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      case 'locked':
        textbox.locked = p.parseMaybeAbsentBool(true);
        break;
      case 'start': {
        let x = p.parseBoardUnits('X coordinate');
        let y = p.parseBoardUnits('Y coordinate');
        textbox.start = { x, y };
        p.NeedRIGHT();
        p.NeedLEFT();
        token = p.NextTok();
        if (token !== 'end') p.Expecting('end');
        x = p.parseBoardUnits('X coordinate');
        y = p.parseBoardUnits('Y coordinate');
        textbox.end = { x, y };
        p.NeedRIGHT();
        break;
      }
      case 'pts': {
        textbox.shape = 'poly';
        const outline: OutlineEntry[] = [];
        textbox.outline = outline;
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) readOutline(p, outline);
        break;
      }
      case 'angle':
        // Set the angle of the text only, the coordinates of the box (a polygon) are
        // already at the right position, and must not be rotated
        textbox.angle = p.parseDoubleNext('text box angle');
        p.NeedRIGHT();
        break;
      case 'stroke':
        parseStroke(p, stroke);
        break;
      case 'border':
        textbox.borderEnabled = p.parseBool();
        p.NeedRIGHT();
        break;
      case 'margins': {
        const m = p.parseMargins();
        textbox.marginLeft = m.left;
        textbox.marginTop = m.top;
        textbox.marginRight = m.right;
        textbox.marginBottom = m.bottom;
        foundMargins = true;
        p.NeedRIGHT();
        break;
      }
      case 'layer':
        textbox.layer = p.parseBoardItemLayer();
        p.NeedRIGHT();
        break;
      case 'knockout':
        if (cell)
          p.Expecting(
            'locked, start, pts, angle, width, margins, layer, effects, span, render_cache, uuid or tstamp',
          );
        else textbox.knockout = p.parseBool();
        p.NeedRIGHT();
        break;
      case 'span':
        if (cell) {
          cell.colSpan = p.parseInt('column span');
          cell.rowSpan = p.parseInt('row span');
        } else {
          p.Expecting(
            'locked, start, pts, angle, width, stroke, border, margins, knockout, layer, effects, render_cache, uuid or tstamp',
          );
        }
        p.NeedRIGHT();
        break;
      case 'tstamp':
      case 'uuid':
        p.NextTok();
        textbox.uuid = CurStrToKIID(p);
        p.NeedRIGHT();
        break;
      case 'effects':
        parseEDA_TEXT(p, textbox);
        break;
      case 'render_cache':
        parseRenderCache(p, textbox);
        break;
      default:
        if (cell)
          p.Expecting(
            'locked, start, pts, angle, width, margins, layer, effects, span, render_cache, uuid or tstamp',
          );
        else
          p.Expecting(
            'locked, start, pts, angle, width, stroke, border, margins, knockout,layer, effects, render_cache, uuid or tstamp',
          );
    }
  }

  textbox.stroke = stroke;

  if (p.requiredVersion < 20230825) {
    // compat, we move to an explicit flag
    textbox.borderEnabled = stroke.width >= 0;
  }

  if (!foundMargins) {
    const margin = legacyTextMargin(stroke.width, textbox.size.y);
    textbox.marginLeft = margin;
    textbox.marginTop = margin;
    textbox.marginRight = margin;
    textbox.marginBottom = margin;
  }

  if (parentFP) {
    // `aTextBox->Rotate( { 0, 0 }, fpOrientation ); Move( fpPosition )` and the
    // inverse on write. A cardinal rotation keeps the rectangle; the text angle
    // goes `( angle + θ ).Normalize()` and is written `( - θ ).Normalize720()`.
    textbox.start = fpRoundTrip(textbox.start, parentFP);
    textbox.end = fpRoundTrip(textbox.end, parentFP);
    if (textbox.outline)
      textbox.outline = textbox.outline.map((e) =>
        'xy' in e
          ? { xy: fpRoundTrip(e.xy, parentFP) }
          : {
              arc: {
                start: fpRoundTrip(e.arc.start, parentFP),
                mid: fpRoundTrip(e.arc.mid, parentFP),
                end: fpRoundTrip(e.arc.end, parentFP),
              },
            },
      );
    const absolute = new EDA_ANGLE(textbox.angle + parentFP.angle).Normalize().AsDegrees();
    textbox.angle = new EDA_ANGLE(absolute - parentFP.angle).Normalize720().AsDegrees();
  }
}

/** `parsePCB_TEXTBOX( aParent )` (:4122). */
export function parsePCB_TEXTBOX(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  parentFP: ParentFP | null,
): KPcbTextBox {
  const textbox = newTextBox();
  parseTextBoxContent(p, textbox, parentFP, null);
  return textbox;
}

/** `parsePCB_TABLECELL( aParent )` (:4135). */
export function parsePCB_TABLECELL(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  parentFP: ParentFP | null,
): KPcbTableCell {
  const cell: KPcbTableCell = { ...newTextBox(), colSpan: 1, rowSpan: 1 };
  parseTextBoxContent(p, cell, parentFP, cell);
  return cell;
}

/** `parsePCB_TABLE( aParent )` (:4333). */
export function parsePCB_TABLE(p: PCB_IO_KICAD_SEXPR_PARSER, parentFP: ParentFP | null): KPcbTable {
  const table: KPcbTable = {
    colCount: -1,
    uuid: newKiid(),
    locked: false,
    layer: F_Cu,
    strokeExternal: true,
    strokeHeaderSeparator: true,
    borderStroke: { width: -1, type: 'solid' },
    strokeRows: true,
    strokeColumns: true,
    separatorsStroke: { width: -1, type: 'solid' },
    colWidths: [],
    rowHeights: [],
    cells: [],
  };
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      case 'column_count':
        table.colCount = p.parseInt('column count');
        p.NeedRIGHT();
        break;
      case 'uuid':
        p.NextTok();
        table.uuid = CurStrToKIID(p);
        p.NeedRIGHT();
        break;
      case 'locked':
        table.locked = p.parseBool();
        p.NeedRIGHT();
        break;
      case 'angle': // legacy token no longer used
        p.NeedRIGHT();
        break;
      case 'layer':
        table.layer = p.parseBoardItemLayer();
        p.NeedRIGHT();
        break;
      case 'column_widths':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok())
          table.colWidths.push(p.parseBoardUnitsCur());
        break;
      case 'row_heights':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok())
          table.rowHeights.push(p.parseBoardUnitsCur());
        break;
      case 'cells':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);
          token = p.NextTok();
          if (token !== 'table_cell') p.Expecting('table_cell');
          table.cells.push(parsePCB_TABLECELL(p, parentFP));
        }
        break;
      case 'border':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);
          token = p.NextTok();
          switch (token) {
            case 'external':
              table.strokeExternal = p.parseBool();
              p.NeedRIGHT();
              break;
            case 'header':
              table.strokeHeaderSeparator = p.parseBool();
              p.NeedRIGHT();
              break;
            case 'stroke':
              parseStroke(p, table.borderStroke);
              break;
            default:
              p.Expecting('external, header or stroke');
          }
        }
        break;
      case 'separators':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);
          token = p.NextTok();
          switch (token) {
            case 'rows':
              table.strokeRows = p.parseBool();
              p.NeedRIGHT();
              break;
            case 'cols':
              table.strokeColumns = p.parseBool();
              p.NeedRIGHT();
              break;
            case 'stroke':
              parseStroke(p, table.separatorsStroke);
              break;
            default:
              p.Expecting('rows, cols, or stroke');
          }
        }
        break;
      default:
        p.Expecting('columns, layer, col_widths, row_heights, border, separators, header or cells');
    }
  }
  return table;
}

// ---------------------------------------------------------------------------
// PCB_DIMENSION_BASE (:4503)
// ---------------------------------------------------------------------------

/** `parseDIMENSION( aParent )` (:4503). */
export function parseDIMENSION(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  parentFP: ParentFPText | null,
): KPcbDimension {
  let locked = false;
  let token = p.NextTok();
  // Free 'locked' token from 6.0/7.0 formats
  if (token === 'locked') {
    locked = true;
    token = p.NextTok();
  }
  // skip value that used to be saved
  if (token !== T.LEFT) p.NeedLEFT();
  token = p.NextTok();

  let isLegacyDimension = false;
  let isStyleKnown = false;

  // `PCB_DIMENSION_BASE::PCB_DIMENSION_BASE` (pcb_dimension.cpp:152) and
  // `PCB_DIM_ALIGNED::PCB_DIM_ALIGNED` (:848) defaults.
  const arrowLength = pcbIUScale.milsToIU(50);
  const dim: KPcbDimension = {
    type: 'aligned',
    locked: false,
    layer: Dwgs_User,
    uuid: newKiid(),
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    height: 0,
    leaderLength: 0,
    orientation: 0,
    prefix: '',
    suffix: '',
    unitsMode: 0, // INCH
    unitsFormat: 1, // BARE_SUFFIX
    precision: 4, // X_XXXX
    overrideTextEnabled: false,
    overrideText: '',
    suppressZeroes: false,
    lineThickness: pcbIUScale.mmToIU(0.2),
    arrowLength,
    textPositionMode: 0, // OUTSIDE
    arrowDirection: 'outward',
    // `m_arrowLength * s_arrowAngle.Sin()`, s_arrowAngle = 27.5 degrees, truncated.
    extensionHeight: Math.trunc(arrowLength * Math.sin((27.5 * Math.PI) / 180)),
    textBorder: 0,
    extensionOffset: 0,
    keepTextAligned: true,
    text: newPcbText(null),
    autoUnits: false,
  };

  // Old format
  if (token === 'width') {
    isLegacyDimension = true;
    dim.type = 'aligned';
    dim.lineThickness = p.parseBoardUnits('dimension width value');
    p.NeedRIGHT();
  } else {
    if (token !== 'type') p.Expecting('type');
    switch (p.NextTok()) {
      case 'aligned':
        dim.type = 'aligned';
        break;
      case 'orthogonal':
        dim.type = 'orthogonal';
        break;
      case 'leader':
        dim.type = 'leader';
        break;
      case 'center':
        dim.type = 'center';
        break;
      case 'radial':
        dim.type = 'radial';
        break;
      default:
        throw new Error(`Cannot parse unknown dimension type ${p.CurText()}`);
    }
    p.NeedRIGHT();
    // Before parsing further, set default properites for old KiCad file
    // versions that didnt have these properties:
    dim.arrowDirection = 'outward';
  }

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      case 'layer':
        dim.layer = p.parseBoardItemLayer();
        p.NeedRIGHT();
        break;
      case 'tstamp':
      case 'uuid':
        p.NextTok();
        dim.uuid = CurStrToKIID(p);
        p.NeedRIGHT();
        break;
      case 'gr_text': {
        // In old pcb files, when parsing the text we do not yet know
        // if the text is kept aligned or not, and its DIM_TEXT_POSITION option.
        // Leave the text not aligned for now to read the text angle, and no
        // constraint for DIM_TEXT_POSITION in this case.
        // It will be set aligned (or not) later
        const isAligned = dim.keepTextAligned;
        const tDimPos = dim.textPositionMode;
        if (!isStyleKnown) {
          dim.textPositionMode = 2; // MANUAL
          dim.keepTextAligned = false;
        }
        // The dimension IS the PCB_TEXT in the C++: the members the text
        // block sets (layer, uuid, locked) are the dimension's own.
        dim.text.layer = dim.layer;
        dim.text.uuid = dim.uuid;
        dim.text.locked = dim.locked;
        parsePCB_TEXT(p, null, dim.text, true);
        dim.layer = dim.text.layer;
        dim.uuid = dim.text.uuid;
        dim.locked = dim.text.locked;
        if (isLegacyDimension) {
          // `FetchUnitsFromString`: the units suffix of the text, else automatic.
          const units = fetchUnitsFromString(dim.text.text);
          if (units === null) dim.autoUnits = true;
          dim.unitsMode = units ?? 0;
        }
        if (!isStyleKnown) {
          dim.keepTextAligned = isAligned;
          dim.textPositionMode = tDimPos;
        }
        break;
      }
      // New format: feature points
      case 'pts':
        dim.start = p.parseXY();
        dim.end = p.parseXY();
        p.NeedRIGHT();
        break;
      case 'height': {
        const height = p.parseBoardUnits('dimension height value');
        p.NeedRIGHT();
        if (dim.type === 'orthogonal' || dim.type === 'aligned') dim.height = height;
        break;
      }
      case 'leader_length': {
        const length = p.parseBoardUnits('leader length value');
        p.NeedRIGHT();
        if (dim.type === 'radial') dim.leaderLength = length;
        break;
      }
      case 'orientation': {
        let orientation = p.parseInt('orthogonal dimension orientation');
        p.NeedRIGHT();
        if (dim.type === 'orthogonal') {
          orientation = Math.min(Math.max(orientation, 0), 1);
          dim.orientation = orientation;
        }
        break;
      }
      case 'format':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          switch (token) {
            case T.LEFT:
              continue;
            case 'prefix':
              p.NeedSYMBOLorNUMBER();
              dim.prefix = p.CurText();
              p.NeedRIGHT();
              break;
            case 'suffix':
              p.NeedSYMBOLorNUMBER();
              dim.suffix = p.CurText();
              p.NeedRIGHT();
              break;
            case 'units': {
              let mode = p.parseInt('dimension units mode');
              mode = Math.max(0, Math.min(4, mode));
              dim.unitsMode = mode;
              p.NeedRIGHT();
              break;
            }
            case 'units_format': {
              let format = p.parseInt('dimension units format');
              format = Math.min(Math.max(format, 0), 3);
              dim.unitsFormat = format;
              p.NeedRIGHT();
              break;
            }
            case 'precision':
              dim.precision = p.parseInt('dimension precision');
              p.NeedRIGHT();
              break;
            case 'override_value':
              p.NeedSYMBOLorNUMBER();
              dim.overrideTextEnabled = true;
              dim.overrideText = p.CurText();
              p.NeedRIGHT();
              break;
            case 'suppress_zeroes':
              dim.suppressZeroes = p.parseMaybeAbsentBool(true);
              break;
            default:
              p.Expecting(
                'prefix, suffix, units, units_format, precision, override_value, suppress_zeroes',
              );
          }
        }
        break;
      case 'style':
        isStyleKnown = true;
        // new format: default to keep text aligned off unless token is present
        dim.keepTextAligned = false;
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          switch (token) {
            case T.LEFT:
              continue;
            case 'thickness':
              dim.lineThickness = p.parseBoardUnits('extension line thickness value');
              p.NeedRIGHT();
              break;
            case 'arrow_direction': {
              token = p.NextTok();
              if (token === 'inward') dim.arrowDirection = 'inward';
              else if (token === 'outward') dim.arrowDirection = 'outward';
              else p.Expecting('inward or outward');
              p.NeedRIGHT();
              break;
            }
            case 'arrow_length':
              dim.arrowLength = p.parseBoardUnits('arrow length value');
              p.NeedRIGHT();
              break;
            case 'text_position_mode': {
              let mode = p.parseInt('text position mode');
              mode = Math.max(0, Math.min(3, mode));
              dim.textPositionMode = mode;
              p.NeedRIGHT();
              break;
            }
            case 'extension_height':
              if (dim.type !== 'aligned' && dim.type !== 'orthogonal')
                throw new Error('Invalid extension_height token');
              dim.extensionHeight = p.parseBoardUnits('extension height value');
              p.NeedRIGHT();
              break;
            case 'extension_offset':
              dim.extensionOffset = p.parseBoardUnits('extension offset value');
              p.NeedRIGHT();
              break;
            case 'keep_text_aligned':
              dim.keepTextAligned = p.parseMaybeAbsentBool(true);
              break;
            case 'text_frame': {
              if (dim.type !== 'leader') throw new Error('Invalid text_frame token');
              let textFrame = p.parseInt('text frame mode');
              textFrame = Math.min(Math.max(textFrame, 0), 3);
              dim.textBorder = textFrame;
              p.NeedRIGHT();
              break;
            }
            default:
              p.Expecting(
                'thickness, arrow_length, arrow_direction, text_position_mode, extension_height, extension_offset',
              );
          }
        }
        break;
      // Old format: feature1 stores a feature line.  We only care about the origin.
      case 'feature1': {
        p.NeedLEFT();
        token = p.NextTok();
        if (token !== 'pts') p.Expecting('pts');
        dim.start = p.parseXY();
        p.parseXY(); // Ignore second point
        p.NeedRIGHT();
        p.NeedRIGHT();
        break;
      }
      // Old format: feature2 stores a feature line.  We only care about the end point.
      case 'feature2': {
        p.NeedLEFT();
        token = p.NextTok();
        if (token !== 'pts') p.Expecting('pts');
        dim.end = p.parseXY();
        p.parseXY(); // Ignore second point
        p.NeedRIGHT();
        p.NeedRIGHT();
        break;
      }
      case 'crossbar': {
        p.NeedLEFT();
        token = p.NextTok();
        if (token === 'pts') {
          // If we have a crossbar, we know we're an old aligned dim
          // Old style: calculate height from crossbar
          const point1 = p.parseXY();
          const point2 = p.parseXY();
          // `PCB_DIM_ALIGNED::UpdateHeight( point2, point1 )` — Yes, backwards intentionally
          dim.height = alignedHeightFromCrossbar(dim, point2, point1);
          p.NeedRIGHT();
        }
        p.NeedRIGHT();
        break;
      }
      // Arrow: no longer saved; no-op
      case 'arrow1a':
      case 'arrow1b':
      case 'arrow2a':
      case 'arrow2b':
        p.NeedLEFT();
        token = p.NextTok();
        if (token !== 'pts') p.Expecting('pts');
        p.parseXY();
        p.parseXY();
        p.NeedRIGHT();
        p.NeedRIGHT();
        break;
      // Handle (locked yes) from modern times
      case 'locked': {
        // Unsure if we ever wrote out (locked) for dimensions, so use maybeAbsent just in case
        dim.locked = p.parseMaybeAbsentBool(true);
        break;
      }
      default:
        p.Expecting(
          'layer, tstamp, uuid, gr_text, feature1, feature2, crossbar, arrow1a, arrow1b, arrow2a, or arrow2b',
        );
    }
  }

  if (locked) dim.locked = true;

  // `dim->Update()`: the text and geometry recomputed from the measurement —
  // done by the formatter side (`updateDimension`) so the model keeps what
  // the file said until it is written.
  void parentFP;
  return dim;
}

/**
 * `EDA_UNIT_UTILS::FetchUnitsFromString` (common/eda_units.cpp:88) mapped to
 * `DIM_UNITS_MODE` (INCH 0, MILS 1, MM 2): the unit designator after the
 * number, two characters significant; null when it names none of the three.
 */
function fetchUnitsFromString(text: string): number | null {
  const buf = text.trim();
  let brk = 0;
  while (brk < buf.length) {
    const c = buf[brk]!;
    if (!((c >= '0' && c <= '9') || c === '.' || c === ',' || c === '-' || c === '+')) break;
    ++brk;
  }
  // Check the unit designator (2 ch significant)
  const unit = buf.slice(brk).trimStart().slice(0, 2).toLowerCase();
  if (unit === 'mm') return 2;
  if (unit === 'mi' || unit === 'th') return 1; // "mils" or "thou"
  if (unit === 'in' || unit === '"') return 0;
  return null;
}

/**
 * `PCB_DIM_ALIGNED::UpdateHeight( aCrossbarStart, aCrossbarEnd )`
 * (pcb_dimension.cpp:937): the crossbar's distance from the start, signed
 * by which side of the crossbar it lies.
 */
function alignedHeightFromCrossbar(
  dim: KPcbDimension,
  crossbarStart: Vec2,
  crossbarEnd: Vec2,
): number {
  const height = { x: crossbarStart.x - dim.start.x, y: crossbarStart.y - dim.start.y };
  const crossBar = { x: crossbarEnd.x - crossbarStart.x, y: crossbarEnd.y - crossbarStart.y };
  const norm = Math.hypot(height.x, height.y);
  // `m_height` is an int: the double truncated.
  if (height.x * crossBar.y - height.y * crossBar.x > 0) return Math.trunc(-norm);
  return Math.trunc(norm);
}

// ---------------------------------------------------------------------------
// PAD (:5786), parsePAD_option (:6489), parsePostMachining (:6554), parsePadstack (:6607)
// ---------------------------------------------------------------------------

const PAD_SHAPE_TOKENS: Record<string, PadShape> = {
  circle: 'circle',
  rect: 'rectangle',
  oval: 'oval',
  trapezoid: 'trapezoid',
  // Note: the shape can be PAD_SHAPE::ROUNDRECT or PAD_SHAPE::CHAMFERED_RECT
  // (if chamfer parameters are found later in pad descr.)
  roundrect: 'roundrect',
  custom: 'custom',
};

/** `parsePAD( aParent )` (:5786): after `pad`, through the `)`. */
export function parsePAD(p: PCB_IO_KICAD_SEXPR_PARSER, parentFP: ParentFP | null): KPad {
  let foundNet = false;
  const pad = newPad();
  const ps = pad.padstack;
  const all = (): CopperLayerProps => copperLayerProps(ps, PADSTACK_ALL_LAYERS);

  p.NeedSYMBOLorNUMBER();
  pad.number = p.CurText();

  let token = p.NextTok();
  switch (token) {
    case 'thru_hole':
      pad.attribute = 'pth';
      // The drill token is usually missing if 0 drill size is specified.
      // Emulate it using 1 nm drill size to avoid errors.
      // Drill size cannot be set to 0 in newer versions.
      ps.drill.size = { x: 1, y: 1 };
      break;
    case 'smd':
      pad.attribute = 'smd';
      // Default PAD object is thru hole with drill.
      // SMD pads have no hole
      ps.drill.size = { x: 0, y: 0 };
      break;
    case 'connect':
      pad.attribute = 'conn';
      // CONN pads have no hole
      ps.drill.size = { x: 0, y: 0 };
      break;
    case 'np_thru_hole':
      pad.attribute = 'npth';
      break;
    default:
      p.Expecting('thru_hole, smd, connect, or np_thru_hole');
  }

  token = p.NextTok();
  {
    const shape = typeof token === 'string' ? PAD_SHAPE_TOKENS[token] : undefined;
    if (!shape) p.Expecting('circle, rectangle, roundrect, oval, trapezoid or custom');
    all().shape.shape = shape;
  }

  let thermalBrAngleOverride: number | undefined;

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token === 'locked') {
      // Pad locking is now a session preference
      token = p.NextTok();
    }
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();

    switch (token) {
      case 'size': {
        const x = p.parseBoardUnits('width value');
        const y = p.parseBoardUnits('height value');
        all().shape.size = { x, y };
        p.NeedRIGHT();
        break;
      }
      case 'at': {
        const x = p.parseBoardUnits('X coordinate');
        const y = p.parseBoardUnits('Y coordinate');
        // `SetFPRelativePosition( pt )`, read back as `GetFPRelativePosition()`.
        pad.at = fpRoundTrip({ x, y }, parentFP);
        token = p.NextTok();
        if (token === T.NUMBER) {
          pad.orientation = p.parseDouble();
          p.NeedRIGHT();
        } else if (token !== T.RIGHT) {
          p.Expecting(') or angle value');
        }
        break;
      }
      case 'rect_delta': {
        const x = p.parseBoardUnits('rectangle delta width');
        const y = p.parseBoardUnits('rectangle delta height');
        all().shape.trapezoidDeltaSize = { x, y };
        p.NeedRIGHT();
        break;
      }
      case 'drill': {
        let haveWidth = false;
        const drillSize = { ...ps.drill.size };
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();
          switch (token) {
            case 'oval':
              ps.drill.shape = 'oblong';
              break;
            case T.NUMBER: {
              if (!haveWidth) {
                drillSize.x = p.parseBoardUnitsCur();
                // If height is not defined the width and height are the same.
                drillSize.y = drillSize.x;
                haveWidth = true;
              } else {
                drillSize.y = p.parseBoardUnitsCur();
              }
              break;
            }
            case 'offset': {
              const x = p.parseBoardUnits('drill offset x');
              const y = p.parseBoardUnits('drill offset y');
              all().shape.offset = { x, y };
              p.NeedRIGHT();
              break;
            }
            default:
              p.Expecting('oval, size, or offset');
          }
        }
        // This fixes a bug caused by setting the default PAD drill size to a value other
        // than 0 used to fix a bunch of debug assertions even though it is defined as a
        // through hole pad.  Wouldn't a though hole pad with no drill be a surface mount
        // pad (or a conn pad which is a smd pad with no solder paste)?
        if (pad.attribute !== 'smd' && pad.attribute !== 'conn') ps.drill.size = drillSize;
        else ps.drill.size = { x: 0, y: 0 };
        break;
      }
      case 'backdrill':
        parseSecondaryDrill(p, ps.secondaryDrill, 'backdrill size');
        break;
      case 'tertiary_drill':
        parseSecondaryDrill(p, ps.tertiaryDrill, 'tertiary drill size');
        break;
      case 'layers':
        ps.layerSet = p.parseBoardItemLayersAsMask();
        break;
      case 'net': {
        foundNet = true;
        token = p.NextTok();
        // Legacy files (pre-10.0) will have a netcode written before the netname.  This netcode
        // is authoratative (though may be mapped by getNetCode() to prevent collisions).
        let foundNetcode = false;
        if (DSNLEXER.IsNumber(token)) {
          // `SetNetCode( code, aNoAssert )`: fails (no net) when the code is unknown.
          pad.net = p.netByCode(p.getNetCode(Number.parseInt(p.CurText(), 10)));
          if (pad.net) foundNetcode = true;
          token = p.NextTok();
        }
        if (!DSNLEXER.IsSymbol(token)) {
          p.Expecting('net name');
          break;
        }
        let netName = p.CurText();
        // Convert overbar syntax from `~...~` to `~{...}`.  These were left out of the
        // first merge so the version is a bit later.
        if (p.requiredVersion < 20210606) netName = convertToNewOverbarNotation(netName);
        if (foundNetcode) {
          // `SetNetCode( NETINFO_LIST::ORPHANED )` when the name does not match the code's.
          if (netName !== pad.net!.name) pad.net = { name: '', code: -1 };
        } else {
          pad.net = { name: netName, code: p.addNet(netName) };
        }
        p.NeedRIGHT();
        break;
      }
      case 'pinfunction':
        p.NeedSYMBOLorNUMBER();
        pad.pinFunction = p.CurText();
        p.NeedRIGHT();
        break;
      case 'pintype':
        p.NeedSYMBOLorNUMBER();
        pad.pinType = p.CurText();
        p.NeedRIGHT();
        break;
      case 'die_length':
        pad.padToDieLength = p.parseBoardUnits('die_length');
        p.NeedRIGHT();
        break;
      case 'die_delay': {
        if (p.requiredVersion <= 20250926) pad.padToDieDelay = p.parseBoardUnits('die_delay');
        else pad.padToDieDelay = p.parseBoardUnits('die_delay', 'time');
        p.NeedRIGHT();
        break;
      }
      case 'solder_mask_margin': {
        // `SetLocalSolderMaskMargin`: both outer mask layers of the padstack.
        const v = p.parseBoardUnits('local solder mask margin value');
        p.NeedRIGHT();
        // In pre-9.0 files "0" meant inherit.
        const margin = p.requiredVersion <= 20240201 && v === 0 ? undefined : v;
        ps.frontOuterLayers.solderMaskMargin = margin;
        ps.backOuterLayers.solderMaskMargin = margin;
        break;
      }
      case 'solder_paste_margin': {
        const v = p.parseBoardUnits('local solder paste margin value');
        p.NeedRIGHT();
        // In pre-9.0 files "0" meant inherit.
        const margin = p.requiredVersion <= 20240201 && v === 0 ? undefined : v;
        ps.frontOuterLayers.solderPasteMargin = margin;
        ps.backOuterLayers.solderPasteMargin = margin;
        break;
      }
      case 'solder_paste_margin_ratio': {
        const v = p.parseDoubleNext('local solder paste margin ratio value');
        p.NeedRIGHT();
        // In pre-9.0 files "0" meant inherit.
        const ratio = p.requiredVersion <= 20240201 && v === 0 ? undefined : v;
        ps.frontOuterLayers.solderPasteMarginRatio = ratio;
        ps.backOuterLayers.solderPasteMarginRatio = ratio;
        break;
      }
      case 'clearance': {
        // `SetLocalClearance`: `m_padStack.Clearance()`, the F_Cu copper entry.
        const v = p.parseBoardUnits('local clearance value');
        p.NeedRIGHT();
        // In pre-9.0 files "0" meant inherit.
        copperLayerProps(ps, F_Cu).clearance =
          p.requiredVersion <= 20240201 && v === 0 ? undefined : v;
        break;
      }
      case 'teardrops':
        p.parseTEARDROP_PARAMETERS(pad.teardrops);
        break;
      case 'zone_connect':
        // `SetLocalZoneConnection`: `m_padStack.ZoneConnection()`, the F_Cu entry.
        copperLayerProps(ps, F_Cu).zoneConnection = p.parseInt('zone connection value');
        p.NeedRIGHT();
        break;
      case 'thermal_width': // legacy token
      case 'thermal_bridge_width':
        copperLayerProps(ps, F_Cu).thermalSpokeWidth = p.parseBoardUnits(token);
        p.NeedRIGHT();
        break;
      case 'thermal_bridge_angle':
        thermalBrAngleOverride = p.parseDoubleNext('thermal spoke angle');
        p.NeedRIGHT();
        break;
      case 'thermal_gap':
        copperLayerProps(ps, F_Cu).thermalGap = p.parseBoardUnits('thermal relief gap value');
        p.NeedRIGHT();
        break;
      case 'roundrect_rratio':
        all().shape.roundRectRadiusRatio = p.parseDoubleNext('roundrect radius ratio');
        p.NeedRIGHT();
        break;
      case 'chamfer_ratio':
        all().shape.chamferedRectRatio = p.parseDoubleNext('chamfer ratio');
        if (all().shape.chamferedRectRatio > 0) all().shape.shape = 'chamfered_rect';
        p.NeedRIGHT();
        break;
      case 'chamfer': {
        const chamfers = parseChamferList(p);
        all().shape.chamferedRectPositions = chamfers;
        if (chamfers !== 0) all().shape.shape = 'chamfered_rect';
        break;
      }
      case 'property':
        while (token !== T.RIGHT) {
          token = p.NextTok();
          switch (token) {
            case 'pad_prop_bga':
              pad.property = 'bga';
              break;
            case 'pad_prop_fiducial_glob':
              pad.property = 'fiducial_glbl';
              break;
            case 'pad_prop_fiducial_loc':
              pad.property = 'fiducial_local';
              break;
            case 'pad_prop_testpoint':
              pad.property = 'testpoint';
              break;
            case 'pad_prop_castellated':
              pad.property = 'castellated';
              break;
            case 'pad_prop_heatsink':
              pad.property = 'heatsink';
              break;
            case 'pad_prop_mechanical':
              pad.property = 'mechanical';
              break;
            case 'pad_prop_pressfit':
              pad.property = 'pressfit';
              break;
            case 'none':
              pad.property = 'none';
              break;
            case T.RIGHT:
              break;
            default:
              // Currently: skip unknown property
              break;
          }
        }
        break;
      case 'options':
        parsePAD_option(p, pad);
        break;
      case 'padstack':
        parsePadstack(p, pad);
        break;
      case 'primitives':
        parsePrimitives(p, all().customShapes);
        break;
      case 'remove_unused_layers': {
        const remove = p.parseMaybeAbsentBool(true);
        // `SetRemoveUnconnected( remove )`.
        ps.unconnectedLayerMode = remove ? 'remove_all' : 'keep_all';
        break;
      }
      case 'keep_end_layers': {
        const keep = p.parseMaybeAbsentBool(true);
        // `SetKeepTopBottom( keep )`.
        ps.unconnectedLayerMode = keep ? 'remove_except_start_and_end' : 'remove_all';
        break;
      }
      case 'tenting': {
        const [front, back] = p.parseFrontBackOptBool(true);
        ps.frontOuterLayers.hasSolderMask = front;
        ps.backOuterLayers.hasSolderMask = back;
        break;
      }
      case 'zone_layer_connections': {
        pad.zoneLayerForceFlashed = new Set();
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          const layer = p.lookUpLayerCur();
          if (!IsCopperLayer(layer)) p.Expecting('copper layer name');
          pad.zoneLayerForceFlashed.add(layer);
        }
        break;
      }
      // Continue to process "(locked)" format which was output during 5.99 development
      case 'locked':
        // Pad locking is now a session preference
        p.parseMaybeAbsentBool(true);
        break;
      case 'tstamp':
      case 'uuid':
        p.NextTok();
        pad.uuid = CurStrToKIID(p);
        p.NeedRIGHT();
        break;
      case 'front_post_machining':
        parsePostMachining(p, ps.frontPostMachining);
        break;
      case 'back_post_machining':
        parsePostMachining(p, ps.backPostMachining);
        break;
      default:
        p.Expecting(
          'at, locked, drill, layers, net, die_length, roundrect_rratio, solder_mask_margin, solder_paste_margin, solder_paste_margin_ratio, uuid, clearance, tstamp, primitives, remove_unused_layers, keep_end_layers, pinfunction, pintype, zone_connect, thermal_width, thermal_gap, padstack, teardrops, front_post_machining, or back_post_machining',
        );
    }
  }

  if (!foundNet) {
    // Make sure default netclass is correctly assigned to pads that don't define a net.
    pad.net = null;
  }

  if (thermalBrAngleOverride !== undefined) {
    all().thermalSpokeAngle = thermalBrAngleOverride;
  } else {
    // This is here because custom pad anchor shape isn't known before reading (options
    const s = all().shape;
    if (s.shape === 'circle') all().thermalSpokeAngle = 45;
    else if (s.shape === 'custom' && s.anchorShape === 'circle') {
      if (p.requiredVersion <= 20211014)
        all().thermalSpokeAngle = 90; // 6.0
      else all().thermalSpokeAngle = 45;
    } else all().thermalSpokeAngle = 90;
  }

  // `CanHaveNumber()`: aperture pads (no copper) and NPTH pads get no number.
  const isAperture = ps.layerSet.and(LSET.AllCuMask()).none();
  if (isAperture || pad.attribute === 'npth') pad.number = '';

  // Zero-sized pads are likely algorithmically unsafe.
  if (all().shape.size.x <= 0 || all().shape.size.y <= 0) {
    all().shape.size = { x: pcbIUScale.mmToIU(0.001), y: pcbIUScale.mmToIU(0.001) };
    p.m_parseWarnings.push(`Invalid zero-sized pad pinned to 1µm in file: ${p.CurSource()}`);
  }

  return pad;
}

/** The `(backdrill (size …) (layers start end))` / `(tertiary_drill …)` lists. */
function parseSecondaryDrill(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  drill: DrillProps,
  sizeName: string,
): void {
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      case 'size': {
        const size = p.parseBoardUnits(sizeName);
        drill.size = { x: size, y: size };
        p.NeedRIGHT();
        break;
      }
      case 'layers': {
        p.NextTok();
        drill.start = p.lookUpLayerCur();
        p.NextTok();
        drill.end = p.lookUpLayerCur();
        p.NeedRIGHT();
        break;
      }
      default:
        p.Expecting('size or layers');
    }
  }
}

/** The `(chamfer top_left …)` list, after `chamfer`, through the `)`. */
function parseChamferList(p: PCB_IO_KICAD_SEXPR_PARSER): number {
  let chamfers = 0;
  for (;;) {
    const token = p.NextTok();
    switch (token) {
      case 'top_left':
        chamfers |= RECT_CHAMFER_TOP_LEFT;
        break;
      case 'top_right':
        chamfers |= RECT_CHAMFER_TOP_RIGHT;
        break;
      case 'bottom_left':
        chamfers |= RECT_CHAMFER_BOTTOM_LEFT;
        break;
      case 'bottom_right':
        chamfers |= RECT_CHAMFER_BOTTOM_RIGHT;
        break;
      case T.RIGHT:
        return chamfers;
      default:
        p.Expecting(
          'chamfer_top_left chamfer_top_right chamfer_bottom_left or chamfer_bottom_right',
        );
    }
  }
}

/** The `(primitives …)` list: `gr_*` shapes, the bbox and vector ones as proxies. */
function parsePrimitives(p: PCB_IO_KICAD_SEXPR_PARSER, out: KPcbShape[]): void {
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token === T.LEFT) token = p.NextTok();
    switch (token) {
      case 'gr_arc':
      case 'gr_line':
      case 'gr_circle':
      case 'gr_rect':
      case 'gr_poly':
      case 'gr_curve':
      case 'gr_bbox':
      case 'gr_vector':
        out.push(parsePCB_SHAPE(p, null));
        break;
      default:
        p.Expecting('gr_line, gr_arc, gr_circle, gr_curve, gr_rect, gr_bbox or gr_poly');
    }
  }
}

/** `parsePAD_option( aPad )` (:6489): the `(options …)` list. */
function parsePAD_option(p: PCB_IO_KICAD_SEXPR_PARSER, pad: KPad): void {
  const all = copperLayerProps(pad.padstack, PADSTACK_ALL_LAYERS);
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      case 'anchor':
        token = p.NextTok();
        // Custom shaped pads have a "anchor pad", which is the reference for connection calculations.
        // Because this is an anchor, only the 2 very basic shapes are managed: circle and rect.
        switch (token) {
          case 'circle':
            all.shape.anchorShape = 'circle';
            break;
          case 'rect':
            all.shape.anchorShape = 'rectangle';
            break;
          default:
            p.Expecting('circle or rect');
        }
        p.NeedRIGHT();
        break;
      case 'clearance':
        token = p.NextTok();
        // Custom shaped pads have a clearance area that is the pad shape (like usual pads) or the
        // convex hull of the pad shape.
        switch (token) {
          case 'outline':
            pad.padstack.customShapeInZoneMode = 'outline';
            break;
          case 'convexhull':
            pad.padstack.customShapeInZoneMode = 'convexhull';
            break;
          default:
            p.Expecting('outline or convexhull');
        }
        p.NeedRIGHT();
        break;
      default:
        p.Expecting('anchor or clearance');
    }
  }
}

/** `parsePostMachining( aProps )` (:6554). */
export function parsePostMachining(p: PCB_IO_KICAD_SEXPR_PARSER, props: PostMachiningProps): void {
  // The mode token (counterbore/countersink) comes first
  let token = p.NextTok();
  switch (token) {
    case 'counterbore':
      props.mode = 'counterbore';
      break;
    case 'countersink':
      props.mode = 'countersink';
      break;
    default:
      p.Expecting('counterbore or countersink');
  }
  // Parse optional properties
  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      case 'size':
        props.size = p.parseBoardUnits('post machining size');
        p.NeedRIGHT();
        break;
      case 'depth':
        props.depth = p.parseBoardUnits('post machining depth');
        p.NeedRIGHT();
        break;
      case 'angle':
        props.angle = KiROUND(p.parseDoubleNext('post machining angle') * 10.0);
        p.NeedRIGHT();
        break;
      default:
        p.Expecting('size, depth, or angle');
    }
  }
}

/** `parsePadstack( aPad )` (:6607): the `(padstack …)` list. */
function parsePadstack(p: PCB_IO_KICAD_SEXPR_PARSER, pad: KPad): void {
  const ps = pad.padstack;
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      case 'mode':
        token = p.NextTok();
        switch (token) {
          case 'front_inner_back':
            ps.mode = 'front_inner_back';
            break;
          case 'custom':
            ps.mode = 'custom';
            break;
          default:
            p.Expecting('front_inner_back or custom');
        }
        p.NeedRIGHT();
        break;
      case 'layer': {
        p.NextTok();
        let curLayer: number;
        if (p.CurText() === 'Inner') {
          if (ps.mode !== 'front_inner_back')
            throw new Error(
              `Invalid padstack layer in file: ${p.CurSource()} line: ${p.CurLineNumber()}`,
            );
          curLayer = PADSTACK_INNER_LAYERS;
        } else {
          curLayer = p.lookUpLayerCur();
        }
        if (!IsCopperLayer(curLayer))
          throw new Error(
            `Invalid padstack layer '${p.CurText()}' in file '${p.CurSource()}' at line ${p.CurLineNumber()}.`,
          );

        // Reset layer properties to default that are omitted when default in the formatter
        const props = copperLayerProps(ps, curLayer);
        props.shape.offset = { x: 0, y: 0 };
        props.shape.trapezoidDeltaSize = { x: 0, y: 0 };

        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);
          token = p.NextTok();
          switch (token) {
            case 'shape': {
              token = p.NextTok();
              const shape = typeof token === 'string' ? PAD_SHAPE_TOKENS[token] : undefined;
              if (!shape) p.Expecting('circle, rectangle, roundrect, oval, trapezoid or custom');
              props.shape.shape = shape;
              p.NeedRIGHT();
              break;
            }
            case 'size': {
              const x = p.parseBoardUnits('width value');
              const y = p.parseBoardUnits('height value');
              props.shape.size = { x, y };
              p.NeedRIGHT();
              break;
            }
            case 'offset': {
              const x = p.parseBoardUnits('drill offset x');
              const y = p.parseBoardUnits('drill offset y');
              props.shape.offset = { x, y };
              p.NeedRIGHT();
              break;
            }
            case 'rect_delta': {
              const x = p.parseBoardUnits('rectangle delta width');
              const y = p.parseBoardUnits('rectangle delta height');
              props.shape.trapezoidDeltaSize = { x, y };
              p.NeedRIGHT();
              break;
            }
            case 'roundrect_rratio':
              props.shape.roundRectRadiusRatio = p.parseDoubleNext('roundrect radius ratio');
              p.NeedRIGHT();
              break;
            case 'chamfer_ratio': {
              const ratio = p.parseDoubleNext('chamfer ratio');
              props.shape.chamferedRectRatio = ratio;
              if (ratio > 0) props.shape.shape = 'chamfered_rect';
              p.NeedRIGHT();
              break;
            }
            case 'chamfer': {
              const chamfers = parseChamferList(p);
              props.shape.chamferedRectPositions = chamfers;
              if (chamfers !== 0) props.shape.shape = 'chamfered_rect';
              break;
            }
            case 'thermal_bridge_width':
              props.thermalSpokeWidth = p.parseBoardUnits('thermal relief spoke width');
              p.NeedRIGHT();
              break;
            case 'thermal_gap':
              props.thermalGap = p.parseBoardUnits('thermal relief gap value');
              p.NeedRIGHT();
              break;
            case 'thermal_bridge_angle':
              // `padstack.SetThermalSpokeAngle( angle )`: the ALL_LAYERS entry.
              copperLayerProps(ps, PADSTACK_ALL_LAYERS).thermalSpokeAngle =
                p.parseDoubleNext('thermal spoke angle');
              p.NeedRIGHT();
              break;
            case 'zone_connect':
              props.zoneConnection = p.parseInt('zone connection value');
              p.NeedRIGHT();
              break;
            case 'clearance':
              props.clearance = p.parseBoardUnits('local clearance value');
              p.NeedRIGHT();
              break;
            case 'tenting': {
              const [front, back] = p.parseFrontBackOptBool(true);
              ps.frontOuterLayers.hasSolderMask = front;
              ps.backOuterLayers.hasSolderMask = back;
              break;
            }
            case 'options':
              for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
                if (token !== T.LEFT) p.Expecting(T.LEFT);
                token = p.NextTok();
                switch (token) {
                  case 'anchor':
                    token = p.NextTok();
                    switch (token) {
                      case 'circle':
                        props.shape.anchorShape = 'circle';
                        break;
                      case 'rect':
                        props.shape.anchorShape = 'rectangle';
                        break;
                      default:
                        // Currently, because pad options is a moving target
                        // just skip unknown keywords
                        break;
                    }
                    p.NeedRIGHT();
                    break;
                  case 'clearance':
                    token = p.NextTok();
                    // TODO: m_customShapeInZoneMode is not per-layer at the moment
                    p.NeedRIGHT();
                    break;
                  default:
                    // Currently, because pad options is a moving target
                    // just skip unknown keywords
                    for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
                      /* skip */
                    }
                }
              }
              break;
            case 'primitives':
              parsePrimitives(p, props.customShapes);
              break;
            default:
              // Not strict-parsing padstack layers yet
              continue;
          }
        }
        break;
      }
      default:
        p.Expecting('mode or layer');
    }
  }
}

// ---------------------------------------------------------------------------
// FOOTPRINT (:4987), parseFootprintStackup (:5713), parseFootprintVariant (:566)
// ---------------------------------------------------------------------------

/** `LEGACY_NET_TIES` (pcb_io_kicad_sexpr.h). */
const LEGACY_NET_TIES = 20220914;

/** `FOOTPRINT::FOOTPRINT( BOARD* )` (footprint.cpp:84), with the four mandatory fields. */
export function newFootprint(): KFootprint {
  const mk = (id: FieldT, name: string, layer: number, visible: boolean): KPcbField => ({
    ...newPcbText(null),
    keepUpright: true,
    layer,
    visible,
    fieldId: id,
    name,
  });
  return {
    fpid: '',
    initialComments: null,
    fileFormatVersionAtLoad: 0,
    locked: false,
    placed: false,
    layer: F_Cu,
    uuid: newKiid(),
    at: { x: 0, y: 0 },
    orientation: 0,
    libDescription: '',
    keywords: '',
    fields: [
      mk('reference', 'Reference', F_SilkS, true),
      mk('value', 'Value', F_Fab, true),
      mk('datasheet', 'Datasheet', F_Fab, false),
      mk('description', 'Description', F_Fab, false),
    ],
    componentClasses: [],
    filters: '',
    path: '',
    sheetname: '',
    sheetfile: '',
    unitInfo: [],
    localZoneConnection: -1, // INHERITED
    attributes: 0,
    allowMissingCourtyard: false,
    allowSolderMaskBridges: false,
    stackupMode: 'expand_inner_layers',
    stackupLayers: new LSET([F_Cu, 4, B_Cu]),
    privateLayers: new LSET(),
    netTiePadGroups: [],
    duplicatePadNumbersAreJumpers: false,
    jumperPadGroups: [],
    graphicalItems: [],
    points: [],
    pads: [],
    zones: [],
    groups: [],
    variants: [],
    embeddedFiles: { files: new Map(), areFontsEmbedded: false },
    models: [],
  };
}

/** What the footprint parser needs from the board: its copper count, for `FixUpPadsForBoard`. */
export interface BoardContext {
  copperLayerCount: number;
}

/**
 * `parseFOOTPRINT_unchecked( aInitialComments )` (:4987): after `footprint` /
 * `module`, through the `)`. `board` is null when reading a library file.
 */
export function parseFOOTPRINT(
  p: PCB_IO_KICAD_SEXPR_PARSER,
  board: BoardContext | null,
  initialComments: string[] | null = null,
): KFootprint {
  const footprint = newFootprint();
  footprint.initialComments = initialComments;
  let attributes = 0;

  let token = p.NextTok();
  if (!DSNLEXER.IsSymbol(token) && token !== T.NUMBER) p.Expecting('symbol|number');
  const name = p.CurText();
  // `LIB_ID::Parse( name, true )` rejects illegal characters; the id is kept as written.
  footprint.fpid = name;

  // The footprint's placement is read early enough (the `at` precedes every
  // child in a KiCad-written file) for the children to take it; a child
  // before `at` would be transformed by the default, exactly as upstream.
  const parentFP = (): ParentFPText => ({
    at: footprint.at,
    angle: footprint.orientation,
    layer: footprint.layer,
  });

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token === T.LEFT) token = p.NextTok();
    switch (token) {
      case 'version': {
        // Theoretically a footprint nested in a PCB could declare its own version, though
        // as of writing this comment we don't do that. Just in case, take the greater
        // version.
        const thisVersion = p.parseInt('version');
        p.NeedRIGHT();
        p.raiseRequiredVersion(thisVersion);
        footprint.fileFormatVersionAtLoad = thisVersion;
        break;
      }
      case 'generator':
        // We currently ignore the generator when parsing. It is included in the file for manual
        // indication of where the footprint came from.
        p.NeedSYMBOL();
        p.NeedRIGHT();
        break;
      case 'generator_version':
        p.NeedSYMBOL();
        p.NeedRIGHT();
        break;
      case 'locked':
        footprint.locked = p.parseMaybeAbsentBool(true);
        break;
      case 'placed':
        footprint.placed = p.parseMaybeAbsentBool(true);
        break;
      case 'layer': {
        // Footprints can be only on the front side or the back side.
        // but because we can find some stupid layer in file, ensure a
        // acceptable layer is set for the footprint
        const layer = p.parseBoardItemLayer();
        footprint.layer = layer === B_Cu ? B_Cu : F_Cu;
        p.NeedRIGHT();
        break;
      }
      case 'stackup':
        parseFootprintStackup(p, footprint);
        break;
      case 'tedit':
        p.parseHex();
        p.NeedRIGHT();
        break;
      case 'tstamp':
      case 'uuid':
        p.NextTok();
        footprint.uuid = CurStrToKIID(p);
        p.NeedRIGHT();
        break;
      case 'at': {
        const x = p.parseBoardUnits('X coordinate');
        const y = p.parseBoardUnits('Y coordinate');
        footprint.at = { x, y };
        token = p.NextTok();
        if (token === T.NUMBER) {
          footprint.orientation = p.parseDouble();
          p.NeedRIGHT();
        } else if (token !== T.RIGHT) {
          p.Expecting(T.RIGHT);
        }
        break;
      }
      case 'descr':
        p.NeedSYMBOLorNUMBER(); // some symbols can be 0508, so a number is also a symbol here
        footprint.libDescription = p.CurText();
        p.NeedRIGHT();
        break;
      case 'tags':
        p.NeedSYMBOLorNUMBER(); // some symbols can be 0508, so a number is also a symbol here
        footprint.keywords = p.CurText();
        p.NeedRIGHT();
        break;
      case 'property': {
        p.NeedSYMBOL();
        const pName = p.CurText();
        p.NeedSYMBOL();
        const pValue = p.CurText();

        // Prior to PCB fields, we used to use properties for special values instead of
        // using (keyword_example "value")
        if (p.requiredVersion < 20230620) {
          // Skip legacy non-field properties sent from symbols that should not be kept
          // in footprints.
          if (pName === 'ki_keywords' || pName === 'ki_locked') {
            p.NeedRIGHT();
            break;
          }
          // Description from symbol (not the fooprint library description stored in (descr) )
          // used to be stored as a reserved key value
          if (pName === 'ki_description') {
            footprint.fields.find((f) => f.fieldId === 'description')!.text = pValue;
            p.NeedRIGHT();
            break;
          }
          // Sheet file and name used to be stored as properties invisible to the user
          if (pName === 'Sheetfile' || pName === 'Sheet file') {
            footprint.sheetfile = pValue;
            p.NeedRIGHT();
            break;
          }
          if (pName === 'Sheetname' || pName === 'Sheet name') {
            footprint.sheetname = pValue;
            p.NeedRIGHT();
            break;
          }
        }

        let field: KPcbField;
        let unused = false;
        // 8.0.0rc3 had a bug where these properties were mistakenly added to the footprint as
        // fields, this will remove them as fields but still correctly set the footprint filters
        if (pName === 'ki_fp_filters') {
          footprint.filters = pValue;
          // Use the text effect parsing function because it will handle ki_fp_filters as a
          // property with no text effects, but will also handle parsing the text effects.
          // We just drop the effects if they're present.
          field = { ...newPcbText(parentFP()), fieldId: 'user', name: pName };
          unused = true;
        } else if (pName === 'Footprint') {
          // Until V9, footprints had a Footprint field that usually (but not always)
          // duplicated the footprint's LIB_ID.  In V9 this was removed.  Parse it
          // like any other, but don't add it to anything.
          field = { ...newPcbText(parentFP()), fieldId: 'user', name: pName };
          unused = true;
        } else {
          // `HasField( pName )` / `GetField( pName )`: by canonical name.
          const existing = footprint.fields.find((f) => fieldCanonicalName(f) === pName);
          if (existing) {
            field = existing;
            field.text = pValue;
          } else {
            field = { ...newPcbText(parentFP()), fieldId: 'user', name: pName };
            footprint.fields.push(field);
            field.text = pValue;
            field.layer = footprint.layer === F_Cu ? F_Fab : B_Fab;
            // `field->StyleFromSettings( bds, true )` — the project's fab text
            // defaults; the file always carries effects for a field it writes.
          }
        }
        // Hide the field by default if it is a legacy field that did not have
        // text effects applied, since hide is a negative effect
        if (p.requiredVersion < 20230620) field.visible = false;
        else field.visible = true;

        parsePCB_TEXT_effects(p, field, parentFP());
        void unused;
        break;
      }
      case 'path':
        p.NeedSYMBOLorNUMBER(); // Paths can be numerical so a number is also a symbol here
        footprint.path = p.CurText();
        p.NeedRIGHT();
        break;
      case 'sheetname':
        p.NeedSYMBOL();
        footprint.sheetname = p.CurText();
        p.NeedRIGHT();
        break;
      case 'sheetfile':
        p.NeedSYMBOL();
        footprint.sheetfile = p.CurText();
        p.NeedRIGHT();
        break;
      case 'units': {
        const unitInfos: KFpUnitInfo[] = [];
        // (units (unit (name "A") (pins "1" "2" ...)) ...)
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();
          if (token === 'unit') {
            const info: KFpUnitInfo = { unitName: '', pins: [] };
            for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
              if (token === T.LEFT) token = p.NextTok();
              if (token === 'name') {
                p.NeedSYMBOLorNUMBER();
                info.unitName = p.CurText();
                p.NeedRIGHT();
              } else if (token === 'pins') {
                // Parse a flat list of quoted numbers or symbols until ')'
                for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
                  if (token === T.STRING || token === T.NUMBER) info.pins.push(p.CurText());
                  else p.Expecting('pin number');
                }
              } else {
                // Unknown sub-token inside unit; skip its list if any
                p.skipCurrent();
              }
            }
            unitInfos.push(info);
          } else {
            // Unknown entry under units; skip
            p.skipCurrent();
          }
        }
        if (unitInfos.length) footprint.unitInfo = unitInfos;
        break;
      }
      case 'autoplace_cost90':
      case 'autoplace_cost180':
        p.parseInt('legacy auto-place cost');
        p.NeedRIGHT();
        break;
      case 'private_layers': {
        const privateLayers = new LSET();
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          const id = p.layerIndexOf(p.CurText());
          if (id !== undefined) privateLayers.set(id);
          else p.Expecting('layer name');
        }
        if (p.requiredVersion < 20220427) {
          privateLayers.set(Edge_Cuts, false);
          privateLayers.set(Margin, false);
        }
        footprint.privateLayers = privateLayers;
        break;
      }
      case 'net_tie_pad_groups':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok())
          footprint.netTiePadGroups.push(p.CurText());
        break;
      case 'duplicate_pad_numbers_are_jumpers':
        footprint.duplicatePadNumbersAreJumpers = p.parseBool();
        p.NeedRIGHT();
        break;
      case 'jumper_pad_groups': {
        // This should only be formatted if there is at least one group
        const groups = footprint.jumperPadGroups;
        let currentGroup: Set<string> | null = null;
        for (token = p.NextTok(); currentGroup || token !== T.RIGHT; token = p.NextTok()) {
          switch (token) {
            case T.LEFT:
              currentGroup = new Set();
              groups.push(currentGroup);
              break;
            case T.STRING:
              if (currentGroup) currentGroup.add(p.CurText());
              break;
            case T.RIGHT:
              currentGroup = null;
              break;
            default:
              p.Expecting('list of pad names');
          }
        }
        break;
      }
      case 'solder_mask_margin':
        footprint.localSolderMaskMargin = p.parseBoardUnits('local solder mask margin value');
        p.NeedRIGHT();
        // In pre-9.0 files "0" meant inherit.
        if (p.requiredVersion <= 20240201 && footprint.localSolderMaskMargin === 0)
          footprint.localSolderMaskMargin = undefined;
        break;
      case 'solder_paste_margin':
        footprint.localSolderPasteMargin = p.parseBoardUnits('local solder paste margin value');
        p.NeedRIGHT();
        if (p.requiredVersion <= 20240201 && footprint.localSolderPasteMargin === 0)
          footprint.localSolderPasteMargin = undefined;
        break;
      case 'solder_paste_ratio': // legacy token
      case 'solder_paste_margin_ratio':
        footprint.localSolderPasteMarginRatio = p.parseDoubleNext(
          'local solder paste margin ratio value',
        );
        p.NeedRIGHT();
        if (p.requiredVersion <= 20240201 && footprint.localSolderPasteMarginRatio === 0)
          footprint.localSolderPasteMarginRatio = undefined;
        break;
      case 'clearance':
        footprint.localClearance = p.parseBoardUnits('local clearance value');
        p.NeedRIGHT();
        if (p.requiredVersion <= 20240201 && footprint.localClearance === 0)
          footprint.localClearance = undefined;
        break;
      case 'zone_connect':
        footprint.localZoneConnection = p.parseInt('zone connection value');
        p.NeedRIGHT();
        break;
      case 'thermal_width':
      case 'thermal_gap':
        // Interestingly, these have never been exposed in the GUI
        p.parseBoardUnits(token);
        p.NeedRIGHT();
        break;
      case 'attr':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          switch (token) {
            case 'virtual': // legacy token prior to version 20200826
              attributes |= FP_EXCLUDE_FROM_POS_FILES | FP_EXCLUDE_FROM_BOM;
              break;
            case 'through_hole':
              attributes |= FP_THROUGH_HOLE;
              break;
            case 'smd':
              attributes |= FP_SMD;
              break;
            case 'board_only':
              attributes |= FP_BOARD_ONLY;
              break;
            case 'exclude_from_pos_files':
              attributes |= FP_EXCLUDE_FROM_POS_FILES;
              break;
            case 'exclude_from_bom':
              attributes |= FP_EXCLUDE_FROM_BOM;
              break;
            case 'allow_missing_courtyard':
              footprint.allowMissingCourtyard = true;
              break;
            case 'dnp':
              attributes |= FP_DNP;
              break;
            case 'allow_soldermask_bridges':
              footprint.allowSolderMaskBridges = true;
              break;
            default:
              p.Expecting(
                'through_hole, smd, virtual, board_only, exclude_from_pos_files, exclude_from_bom or allow_solder_mask_bridges',
              );
          }
        }
        footprint.attributes = attributes;
        break;
      case 'fp_text': {
        const { text, fieldId } = parsePCB_TEXT(p, parentFP());
        if (fieldId === 'reference' || fieldId === 'value') {
          // `footprint->Reference() = PCB_FIELD( *text, REFERENCE )`, uuid kept.
          const target = footprint.fields.find((f) => f.fieldId === fieldId)!;
          Object.assign(target, text, { fieldId, name: target.name });
        } else if (fieldId === 'user') {
          // Fields other than reference and value aren't treated specially,
          // and can be created if the fp_text was hidden on the board,
          // so just add those to the footprint as normal.
          const fieldName = `Field${footprint.fields.length}`;
          footprint.fields.push({ ...text, fieldId: 'user', name: fieldName });
        } else {
          footprint.graphicalItems.push({ kind: 'text', item: text });
        }
        break;
      }
      case 'fp_text_box':
        footprint.graphicalItems.push({ kind: 'textbox', item: parsePCB_TEXTBOX(p, parentFP()) });
        break;
      case 'table':
        footprint.graphicalItems.push({ kind: 'table', item: parsePCB_TABLE(p, parentFP()) });
        break;
      case 'fp_arc':
      case 'fp_circle':
      case 'fp_curve':
      case 'fp_rect':
      case 'fp_line':
      case 'fp_poly':
        footprint.graphicalItems.push({ kind: 'shape', item: parsePCB_SHAPE(p, parentFP()) });
        break;
      case 'image':
        footprint.graphicalItems.push({ kind: 'image', item: parsePCB_REFERENCE_IMAGE(p) });
        break;
      case 'barcode':
        footprint.graphicalItems.push({ kind: 'barcode', item: parsePCB_BARCODE(p) });
        break;
      case 'dimension':
        footprint.graphicalItems.push({ kind: 'dimension', item: parseDIMENSION(p, parentFP()) });
        break;
      case 'pad':
        footprint.pads.push(parsePAD(p, parentFP()));
        break;
      case 'model':
        footprint.models.push(parse3DModel(p));
        break;
      case 'zone': {
        const zone = parseZONE(p, parentFP());
        if (zone.outline.length === 0 || zone.outline[0]!.length === 0) break;
        footprint.zones.push(zone);
        break;
      }
      case 'group':
        footprint.groups.push(parseGROUP(p));
        break;
      case 'point':
        footprint.points.push(parsePCB_POINT(p));
        break;
      case 'embedded_fonts':
        footprint.embeddedFiles.areFontsEmbedded = p.parseBool();
        p.NeedRIGHT();
        break;
      case 'embedded_files':
        try {
          p.ParseEmbeddedInto(footprint.embeddedFiles);
        } catch (e) {
          if (e instanceof PARSE_ERROR) p.m_parseWarnings.push(e.message);
          else throw e;
        }
        break;
      case 'component_classes': {
        const names = new Set<string>();
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);
          token = p.NextTok();
          if (token !== 'class') p.Expecting('class');
          p.NeedSYMBOLorNUMBER();
          names.add(p.CurText());
          p.NeedRIGHT();
        }
        // `std::unordered_set` — the formatter walks the resolved class's
        // constituents, which `COMPONENT_CLASS_MANAGER` keeps name-sorted.
        footprint.componentClasses = [...names].sort();
        break;
      }
      case 'variant':
        parseFootprintVariant(p, footprint);
        break;
      default:
        p.Expecting(
          'at, descr, locked, placed, tedit, tstamp, uuid, variant, autoplace_cost90, autoplace_cost180, attr, clearance, embedded_files, fp_arc, fp_circle, fp_curve, fp_line, fp_poly, fp_rect, fp_text, pad, group, generator, model, path, solder_mask_margin, solder_paste_margin, solder_paste_margin_ratio, tags, thermal_gap, version, zone, zone_connect, or component_classes',
        );
    }
  }

  // `footprint->FixUpPadsForBoard( m_board )` (footprint.cpp:4826).
  if (board && footprint.stackupMode === 'expand_inner_layers') {
    const boardCopper = LSET.AllCuMask(board.copperLayerCount);
    for (const pad of footprint.pads) {
      if (pad.attribute === 'pth') pad.padstack.layerSet = pad.padstack.layerSet.or(boardCopper);
    }
  }

  // In legacy files the lack of attributes indicated a through-hole component which was by
  // default excluded from pos files.  However there was a hack to look for SMD pads and
  // consider those "mislabeled through-hole components" and therefore include them in place
  // files.  We probably don't want to get into that game so we'll just include them by
  // default and let the user change it if required.
  if (p.requiredVersion < 20200826 && attributes === 0) attributes |= FP_THROUGH_HOLE;

  if (p.requiredVersion <= LEGACY_NET_TIES) {
    if (footprint.keywords.startsWith('net tie')) {
      const padGroup = footprint.pads.map((pad) => pad.number).join(', ');
      if (padGroup !== '') footprint.netTiePadGroups.push(padGroup);
    }
  }

  footprint.attributes = attributes;
  return footprint;
}

/** `parseFootprintStackup( aFootprint )` (:5713). */
function parseFootprintStackup(p: PCB_IO_KICAD_SEXPR_PARSER, footprint: KFootprint): void {
  // If we have a stackup list at all, we must be in custom layer mode
  const layers = new LSET();
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (p.CurTok() !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      case 'layer': {
        p.NeedSYMBOLorNUMBER();
        const id = p.layerIndexOf(p.CurText());
        if (id === undefined) p.Expecting('layer name');
        layers.set(id);
        p.NeedRIGHT();
        break;
      }
      default:
        p.Expecting('layer');
    }
  }
  // Check that the copper layers are sensible and contiguous
  const gotCuLayers = layers.and(LSET.AllCuMask());
  if (gotCuLayers.count() % 2 !== 0)
    throw new Error(
      `Invalid stackup in footprint: odd number of copper layers (${gotCuLayers.count()}).`,
    );
  const expectedCuLayers = LSET.AllCuMask(gotCuLayers.count());
  if (!gotCuLayers.equals(expectedCuLayers))
    throw new Error('Invalid stackup in footprint: copper layers are not contiguous.');
  if (layers.and(LSET.AllTechMask()).count() > 0)
    throw new Error(
      'Invalid stackup in footprint: technology layers are implicit in footprints and should not be specified in the stackup.',
    );
  footprint.stackupMode = 'custom_layers';
  footprint.stackupLayers = layers;
}

/** `parseFootprintVariant( aFootprint )` (:566). */
function parseFootprintVariant(p: PCB_IO_KICAD_SEXPR_PARSER, footprint: KFootprint): void {
  // (variant (name "VariantA") (dnp yes) (exclude_from_bom yes) (exclude_from_pos_files yes)
  //   (field (name "Value") (value "100nF")))
  let variantName = '';
  let hasDnp = false;
  let dnp = false;
  let hasExcludeFromBOM = false;
  let excludeFromBOM = false;
  let hasExcludeFromPosFiles = false;
  let excludeFromPosFiles = false;
  const fields: [string, string][] = [];

  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token === T.LEFT) token = p.NextTok();
    switch (token) {
      case 'name':
        p.NeedSYMBOL();
        variantName = p.CurText();
        p.NeedRIGHT();
        break;
      case 'dnp':
        dnp = p.parseMaybeAbsentBool(true);
        hasDnp = true;
        break;
      case 'exclude_from_bom':
        excludeFromBOM = p.parseMaybeAbsentBool(true);
        hasExcludeFromBOM = true;
        break;
      case 'exclude_from_pos_files':
        excludeFromPosFiles = p.parseMaybeAbsentBool(true);
        hasExcludeFromPosFiles = true;
        break;
      case 'field': {
        let fieldName = '';
        let fieldValue = '';
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();
          if (token === 'name') {
            p.NeedSYMBOL();
            fieldName = p.CurText();
            p.NeedRIGHT();
          } else if (token === 'value') {
            p.NeedSYMBOL();
            fieldValue = p.CurText();
            p.NeedRIGHT();
          } else {
            p.Expecting('name or value');
          }
        }
        if (fieldName !== '') fields.push([fieldName, fieldValue]);
        break;
      }
      default:
        p.Expecting('name, dnp, exclude_from_bom, exclude_from_pos_files, or field');
    }
  }

  if (variantName === '') return;

  // `AddVariant`: a `std::map` by name; an existing one is returned.
  let variant = footprint.variants.find((v) => v.name === variantName);
  if (!variant) {
    variant = { name: variantName, fields: new Map() };
    footprint.variants.push(variant);
    footprint.variants.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  if (hasDnp) variant.dnp = dnp;
  if (hasExcludeFromBOM) variant.excludedFromBOM = excludeFromBOM;
  if (hasExcludeFromPosFiles) variant.excludedFromPosFiles = excludeFromPosFiles;
  for (const [fieldName, fieldValue] of fields) variant.fields.set(fieldName, fieldValue);
  variant.fields = new Map(
    [...variant.fields.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

// ---------------------------------------------------------------------------
// PCB_GROUP (:6975), PCB_GENERATOR (:7062)
// ---------------------------------------------------------------------------

/** `parseGROUP_members( aGroupInfo )` (:6960). */
function parseGROUP_members(p: PCB_IO_KICAD_SEXPR_PARSER, out: string[]): void {
  let token: Tok;
  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    // This token is the Uuid of the item in the group.
    // Since groups are serialized at the end of the file/footprint, the Uuid should already
    // have been seen and exist in the board.
    out.push(kiidFromString(p.CurText()));
  }
}

/** `parseGROUP( aParent )` (:6975). */
export function parseGROUP(p: PCB_IO_KICAD_SEXPR_PARSER): KPcbGroup {
  const groupInfo: KPcbGroup = {
    name: '',
    uuid: newKiid(),
    locked: false,
    libId: '',
    memberUuids: [],
  };
  let token: Tok;
  for (token = p.NextTok(); token !== T.LEFT; token = p.NextTok()) {
    if (token === T.STRING) groupInfo.name = p.CurText();
    else if (token === 'locked') groupInfo.locked = true;
    else p.Expecting('group name or locked');
  }
  for (; token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      // From formats [20200811, 20231215), 'id' was used instead of 'uuid'
      case 'id':
      case 'uuid':
        p.NextTok();
        groupInfo.uuid = CurStrToKIID(p);
        p.NeedRIGHT();
        break;
      case 'lib_id': {
        token = p.NextTok();
        if (!DSNLEXER.IsSymbol(token) && token !== T.NUMBER) p.Expecting('symbol|number');
        // Some symbol LIB_IDs have the '/' character escaped which can break
        // symbol links.  The '/' character is no longer an illegal LIB_ID character so
        // it doesn't need to be escaped.
        groupInfo.libId = p.CurText().replaceAll('{slash}', '/');
        p.NeedRIGHT();
        break;
      }
      case 'locked':
        groupInfo.locked = p.parseBool();
        p.NeedRIGHT();
        break;
      case 'members':
        parseGROUP_members(p, groupInfo.memberUuids);
        break;
      default:
        p.Expecting('uuid, locked, lib_id, or members');
    }
  }
  return groupInfo;
}

/** `parseGENERATOR( aParent )` (:7062). Returns null for a ghost tuning pattern. */
export function parseGENERATOR(p: PCB_IO_KICAD_SEXPR_PARSER): KPcbGenerator | null {
  const genInfo: KPcbGenerator = {
    name: '',
    uuid: newKiid(),
    locked: false,
    libId: '',
    memberUuids: [],
    generatorType: '',
    layer: F_Cu,
    properties: [],
  };
  p.NeedLEFT();
  let token = p.NextTok();
  // For formats [20231007, 20231215), 'id' was used instead of 'uuid'
  if (token !== 'uuid' && token !== 'id') p.Expecting('uuid');
  p.NextTok();
  genInfo.uuid = CurStrToKIID(p);
  p.NeedRIGHT();

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      case 'type':
        p.NeedSYMBOL();
        genInfo.generatorType = p.CurText();
        p.NeedRIGHT();
        break;
      case 'name':
        p.NeedSYMBOL();
        genInfo.name = p.CurText();
        p.NeedRIGHT();
        break;
      case 'locked':
        token = p.NextTok();
        genInfo.locked = token === 'yes';
        p.NeedRIGHT();
        break;
      case 'layer':
        genInfo.layer = p.parseBoardItemLayer();
        p.NeedRIGHT();
        break;
      case 'members':
        parseGROUP_members(p, genInfo.memberUuids);
        break;
      default: {
        const pName = p.CurText();
        const tok1 = p.NextTok();
        // `STRING_ANY_MAP::emplace`: the first value for a key wins.
        const put = (value: GeneratorValue): void => {
          if (!genInfo.properties.some((e) => e.key === pName))
            genInfo.properties.push({ key: pName, value });
        };
        switch (tok1) {
          case 'yes':
            put({ kind: 'bool', value: true });
            p.NeedRIGHT();
            break;
          case 'no':
            put({ kind: 'bool', value: false });
            p.NeedRIGHT();
            break;
          case T.NUMBER: {
            put({ kind: 'number', value: p.parseDouble() });
            p.NeedRIGHT();
            break;
          }
          case T.STRING: {
            put({ kind: 'string', value: p.CurText() });
            p.NeedRIGHT();
            break;
          }
          case T.LEFT: {
            p.NeedSYMBOL();
            const tok2 = p.CurTok();
            switch (tok2) {
              case 'xy': {
                const x = p.parseBoardUnits('X coordinate');
                const y = p.parseBoardUnits('Y coordinate');
                put({ kind: 'xy', value: { x, y } });
                p.NeedRIGHT();
                p.NeedRIGHT();
                break;
              }
              case 'pts': {
                const chain: OutlineEntry[] = [];
                for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok())
                  readOutline(p, chain);
                p.NeedRIGHT();
                put({ kind: 'pts', value: chain });
                break;
              }
              default:
                p.Expecting('xy or pts');
            }
            break;
          }
          default:
            p.Expecting('a number, symbol, string or (');
        }
      }
    }
  }
  // Previous versions had bugs which could save ghost tuning patterns.  Ignore them.
  if (genInfo.generatorType === 'tuning_pattern' && genInfo.memberUuids.length === 0) return null;
  // `std::map<wxString, wxAny>`: the formatter walks the properties in key order.
  genInfo.properties.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return genInfo;
}

// ---------------------------------------------------------------------------
// PCB_TRACK (:7312), PCB_ARC (:7210), PCB_VIA (:7407), parseViastack (:7766)
// ---------------------------------------------------------------------------

/** `PCB_TRACK::SetLayerSet` (pcb_track.cpp:1536): the copper layer, and the mask flag. */
function trackSetLayerSet(track: { layer: number; hasSolderMask: boolean }, set: LSET): void {
  for (const layer of set.Seq()) {
    if (IsCopperLayer(layer)) track.layer = layer;
    else if (layer === F_Mask || layer === B_Mask) track.hasSolderMask = true;
  }
}

/** `PCB_TRACK::GetLayerSet()` (pcb_track.cpp:1549). */
export function trackLayerSet(track: { layer: number; hasSolderMask: boolean }): LSET {
  const layermask = new LSET([track.layer]);
  if (track.hasSolderMask) {
    if (layermask.test(F_Cu)) layermask.set(F_Mask);
    else if (layermask.test(B_Cu)) layermask.set(B_Mask);
  }
  return layermask;
}

/** `parsePCB_TRACK()` (:7312) and `parseARC()` (:7210). Null for a track off copper. */
export function parsePCB_TRACK(p: PCB_IO_KICAD_SEXPR_PARSER, isArc: boolean): KPcbTrack | null {
  // `PCB_TRACK::PCB_TRACK`: width from the default netclass (unused here), F_Cu.
  const track: KPcbTrack = {
    type: isArc ? 'arc' : 'segment',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    width: pcbIUScale.mmToIU(0.2),
    locked: false,
    layer: F_Cu,
    hasSolderMask: false,
    net: null,
    uuid: newKiid(),
  };
  if (isArc) track.mid = { x: 0, y: 0 };
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    // Legacy locked flag
    if (token === 'locked') {
      track.locked = true;
      token = p.NextTok();
    }
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      case 'start': {
        const x = p.parseBoardUnits('start x');
        const y = p.parseBoardUnits('start y');
        track.start = { x, y };
        p.NeedRIGHT();
        break;
      }
      case 'mid': {
        if (!isArc)
          p.Expecting('start, end, width, layer, solder_mask_margin, net, tstamp, uuid or locked');
        const x = p.parseBoardUnits('mid x');
        const y = p.parseBoardUnits('mid y');
        track.mid = { x, y };
        p.NeedRIGHT();
        break;
      }
      case 'end': {
        const x = p.parseBoardUnits('end x');
        const y = p.parseBoardUnits('end y');
        track.end = { x, y };
        p.NeedRIGHT();
        break;
      }
      case 'width':
        track.width = p.parseBoardUnits('width');
        p.NeedRIGHT();
        break;
      case 'layer':
        track.layer = p.parseBoardItemLayer();
        p.NeedRIGHT();
        break;
      case 'layers':
        trackSetLayerSet(track, p.parseLayersForCuItemWithSoldermask());
        break;
      case 'solder_mask_margin':
        track.solderMaskMargin = p.parseBoardUnits('local solder mask margin value');
        p.NeedRIGHT();
        break;
      case 'net':
        track.net = p.parseNet();
        break;
      case 'tstamp':
      case 'uuid':
        p.NextTok();
        track.uuid = CurStrToKIID(p);
        p.NeedRIGHT();
        break;
      // We continue to parse the status field but it is no longer written
      case 'status':
        p.parseHex();
        p.NeedRIGHT();
        break;
      case 'locked':
        track.locked = p.parseMaybeAbsentBool(true);
        break;
      default:
        if (isArc)
          p.Expecting(
            'start, mid, end, width, layer, solder_mask_margin, net, tstamp, uuid or status',
          );
        else
          p.Expecting('start, end, width, layer, solder_mask_margin, net, tstamp, uuid or locked');
    }
  }
  if (!IsCopperLayer(track.layer)) {
    // No point in asserting; these usually come from hand-edited boards
    return null;
  }
  return track;
}

/** `UNDEFINED_DRILL_DIAMETER` (pcb_track.h). */
export const UNDEFINED_DRILL_DIAMETER = -1;

/** `IsCopperLayerLowerThan( aLayerA, aLayerB )` (layer_ids.h:824). */
export function IsCopperLayerLowerThan(a: number, b: number): boolean {
  if (a === b) return false;
  if (a === B_Cu) return true;
  if (b === B_Cu) return false;
  return a > b;
}

/** `PCB_VIA::PCB_VIA( BOARD_ITEM* )` (pcb_track.cpp:108). */
export function newVia(): KPcbVia {
  const ps = newPadstack();
  ps.drill.start = F_Cu;
  ps.drill.end = B_Cu;
  // `SetDrillDefault()`
  ps.drill.size = { x: UNDEFINED_DRILL_DIAMETER, y: UNDEFINED_DRILL_DIAMETER };
  ps.unconnectedLayerMode = 'keep_all';
  // Padstack layerset is not used for vias right now
  ps.layerSet = new LSET();
  // For now, vias are always circles
  copperLayerProps(ps, PADSTACK_ALL_LAYERS).shape.shape = 'circle';
  return {
    viaType: 'through',
    at: { x: 0, y: 0 },
    padstack: ps,
    drill: UNDEFINED_DRILL_DIAMETER,
    layer1: F_Cu,
    layer2: B_Cu,
    locked: false,
    isFree: false,
    zoneLayerForceFlashed: new Set(),
    teardrops: defaultTeardropParams(),
    net: null,
    uuid: newKiid(),
  };
}

/** `PCB_VIA::SetLayerPair` + `SanitizeLayers` (pcb_track.cpp:1643, :1725). */
export function viaSetLayerPair(via: KPcbVia, top: number, bottom: number): void {
  let start = top;
  let end = bottom;
  if (via.viaType === 'through') {
    start = F_Cu;
    end = B_Cu;
  }
  if (!IsCopperLayerLowerThan(end, start)) [start, end] = [end, start];
  via.padstack.drill.start = start;
  via.padstack.drill.end = end;
  via.layer1 = start;
  via.layer2 = end;
}

/** `parsePCB_VIA()` (:7407). */
export function parsePCB_VIA(p: PCB_IO_KICAD_SEXPR_PARSER): KPcbVia {
  const via = newVia();
  const ps = via.padstack;
  // File format default is no-token == no-feature.
  ps.unconnectedLayerMode = 'keep_all';
  // Versions before 10.0 had no protection features other than tenting, so those features must
  // be interpreted as OFF in legacy boards, not as unspecified (aka: inherit from board stackup)
  if (p.requiredVersion < 20250228) {
    ps.frontOuterLayers.hasCovering = false;
    ps.backOuterLayers.hasCovering = false;
    ps.frontOuterLayers.hasPlugging = false;
    ps.backOuterLayers.hasPlugging = false;
    ps.drill.isFilled = false;
    ps.drill.isCapped = false;
  }
  let pairTop = F_Cu;
  let pairBottom = B_Cu;
  let pairSet = false;

  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    // Legacy locked
    if (token === 'locked') {
      via.locked = true;
      token = p.NextTok();
    }
    if (token === T.LEFT) token = p.NextTok();
    switch (token) {
      case 'blind':
        via.viaType = 'blind';
        break;
      case 'buried':
        via.viaType = 'buried';
        break;
      case 'micro':
        via.viaType = 'micro';
        break;
      case 'at': {
        const x = p.parseBoardUnits('start x');
        const y = p.parseBoardUnits('start y');
        via.at = { x, y };
        p.NeedRIGHT();
        break;
      }
      case 'size': {
        const w = p.parseBoardUnits('via width');
        copperLayerProps(ps, PADSTACK_ALL_LAYERS).shape.size = { x: w, y: w };
        p.NeedRIGHT();
        break;
      }
      case 'drill':
        via.drill = p.parseBoardUnits('drill diameter');
        ps.drill.size = { x: via.drill, y: via.drill };
        p.NeedRIGHT();
        break;
      case 'layers': {
        p.NextTok();
        const layer1 = p.lookUpLayerCur();
        p.NextTok();
        const layer2 = p.lookUpLayerCur();
        pairTop = layer1;
        pairBottom = layer2;
        pairSet = true;
        if (layer1 === UNDEFINED_LAYER || layer2 === UNDEFINED_LAYER) p.Expecting('layer name');
        p.NeedRIGHT();
        break;
      }
      case 'net':
        via.net = p.parseNet();
        break;
      case 'remove_unused_layers':
        if (p.parseMaybeAbsentBool(true)) ps.unconnectedLayerMode = 'remove_all';
        break;
      case 'keep_end_layers':
        if (p.parseMaybeAbsentBool(true)) ps.unconnectedLayerMode = 'remove_except_start_and_end';
        break;
      case 'start_end_only':
        if (p.parseMaybeAbsentBool(true)) ps.unconnectedLayerMode = 'start_end_only';
        break;
      case 'zone_layer_connections': {
        via.zoneLayerForceFlashed = new Set();
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          const layer = p.lookUpLayerCur();
          if (!IsCopperLayer(layer)) p.Expecting('copper layer name');
          via.zoneLayerForceFlashed.add(layer);
        }
        break;
      }
      case 'padstack':
        parseViastack(p, via);
        break;
      case 'teardrops':
        p.parseTEARDROP_PARAMETERS(via.teardrops);
        break;
      case 'tenting': {
        const [front, back] = p.parseFrontBackOptBool(true);
        ps.frontOuterLayers.hasSolderMask = front;
        ps.backOuterLayers.hasSolderMask = back;
        break;
      }
      case 'covering': {
        const [front, back] = p.parseFrontBackOptBool();
        ps.frontOuterLayers.hasCovering = front;
        ps.backOuterLayers.hasCovering = back;
        break;
      }
      case 'plugging': {
        const [front, back] = p.parseFrontBackOptBool();
        ps.frontOuterLayers.hasPlugging = front;
        ps.backOuterLayers.hasPlugging = back;
        break;
      }
      case 'filling':
        ps.drill.isFilled = p.parseOptBool();
        p.NeedRIGHT();
        break;
      case 'capping':
        ps.drill.isCapped = p.parseOptBool();
        p.NeedRIGHT();
        break;
      case 'tstamp':
      case 'uuid':
        p.NextTok();
        via.uuid = CurStrToKIID(p);
        p.NeedRIGHT();
        break;
      // We continue to parse the status field but it is no longer written
      case 'status':
        p.parseHex();
        p.NeedRIGHT();
        break;
      case 'locked':
        via.locked = p.parseMaybeAbsentBool(true);
        break;
      case 'free':
        via.isFree = p.parseMaybeAbsentBool(true);
        break;
      case 'backdrill':
        parseSecondaryDrill(p, ps.secondaryDrill, 'backdrill size');
        break;
      case 'tertiary_drill':
        parseSecondaryDrill(p, ps.tertiaryDrill, 'tertiary drill size');
        break;
      case 'front_post_machining':
        parsePostMachining(p, ps.frontPostMachining);
        break;
      case 'back_post_machining':
        parsePostMachining(p, ps.backPostMachining);
        break;
      default:
        p.Expecting(
          'blind, micro, at, size, drill, layers, net, free, tstamp, uuid, status, teardrops, backdrill, tertiary_drill, front_post_machining, or back_post_machining',
        );
    }
  }
  // `SetLayerPair` runs when `(layers …)` is read; the via type may be set
  // after it in the file (it never is in a KiCad-written one), and
  // `SanitizeLayers` reads the type of that moment.
  if (pairSet) viaSetLayerPair(via, pairTop, pairBottom);
  return via;
}

/** `parseViastack( aVia )` (:7766). */
function parseViastack(p: PCB_IO_KICAD_SEXPR_PARSER, via: KPcbVia): void {
  const ps = via.padstack;
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token !== T.LEFT) p.Expecting(T.LEFT);
    token = p.NextTok();
    switch (token) {
      case 'mode':
        token = p.NextTok();
        switch (token) {
          case 'front_inner_back':
            ps.mode = 'front_inner_back';
            break;
          case 'custom':
            ps.mode = 'custom';
            break;
          default:
            p.Expecting('front_inner_back or custom');
        }
        p.NeedRIGHT();
        break;
      case 'layer': {
        p.NextTok();
        let curLayer: number;
        if (p.CurText() === 'Inner') {
          if (ps.mode !== 'front_inner_back')
            throw new Error(
              `Invalid padstack layer in file: ${p.CurSource()} line: ${p.CurLineNumber()}`,
            );
          curLayer = PADSTACK_INNER_LAYERS;
        } else {
          curLayer = p.lookUpLayerCur();
        }
        if (!IsCopperLayer(curLayer))
          throw new Error(
            `Invalid padstack layer '${p.CurText()}' in file '${p.CurSource()}' at line ${p.CurLineNumber()}.`,
          );
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);
          token = p.NextTok();
          switch (token) {
            case 'size': {
              const diameter = p.parseBoardUnits('via width');
              copperLayerProps(ps, curLayer).shape.size = { x: diameter, y: diameter };
              p.NeedRIGHT();
              break;
            }
            default:
              // Currently only supporting custom via diameter per layer, not other properties
              p.Expecting('size');
          }
        }
        break;
      }
      default:
        p.Expecting('mode or layer');
    }
  }
}

// ---------------------------------------------------------------------------
// ZONE (:7863)
// ---------------------------------------------------------------------------

/** `ZONE::ZONE( aParent )` with `ZONE_SETTINGS().ExportSetting` (zone_settings.cpp:40-94). */
export function newZone(inFootprint: boolean): KZone {
  const minThickness = pcbIUScale.mmToIU(0.25);
  return {
    net: null,
    locked: false,
    layerSet: new LSET([F_Cu]),
    uuid: newKiid(),
    name: '',
    hatchStyle: 'edge',
    hatchPitch: pcbIUScale.mmToIU(0.5),
    priority: 0,
    isTeardropArea: false,
    teardropType: 'padvia',
    padConnection: 1, // THERMAL
    localClearance: pcbIUScale.mmToIU(0.5),
    minThickness,
    // Zones living in footprints have the rule area option
    isRuleArea: inFootprint,
    doNotAllowTracks: true,
    doNotAllowVias: true,
    doNotAllowPads: true,
    doNotAllowZoneFills: false,
    doNotAllowFootprints: false,
    placementEnabled: false,
    placementSourceType: 'sheetname',
    placementSource: '',
    isFilled: false,
    fillMode: 'polygons',
    thermalReliefGap: pcbIUScale.mmToIU(0.5),
    thermalReliefSpokeWidth: pcbIUScale.mmToIU(0.5),
    cornerSmoothingType: 0,
    cornerRadius: 0,
    islandRemovalMode: 0,
    minIslandArea: 10 * pcbIUScale.IU_PER_MM * pcbIUScale.IU_PER_MM,
    hatchThickness: Math.max(minThickness * 4, pcbIUScale.mmToIU(1.0)),
    hatchGap: Math.max(minThickness * 6, pcbIUScale.mmToIU(1.5)),
    hatchOrientation: 0,
    hatchSmoothingLevel: 0,
    hatchSmoothingValue: 0.1,
    hatchBorderAlgorithm: 1,
    hatchHoleMinArea: 0.15,
    layerProperties: new Map(),
    outline: [],
    filledPolygons: [],
  };
}

/** `ZONE::GetFirstLayer()` (zone.cpp:540): the first in UI order, else the first set. */
export function zoneFirstLayer(z: KZone): number {
  if (z.layerSet.count() === 0) return UNDEFINED_LAYER;
  const ui = z.layerSet.UIOrder();
  if (ui.length) return ui[0]!;
  return z.layerSet.Seq()[0]!;
}

/** `parseZONE( aParent )` (:7863). */
export function parseZONE(p: PCB_IO_KICAD_SEXPR_PARSER, parentFP: ParentFP | null): KZone {
  let hatchStyle: KZone['hatchStyle'] = 'none';
  let hatchPitch = pcbIUScale.mmToIU(0.5);
  let token: Tok;
  let legacyNetnameFromFile = ''; // the (non-authoratative) zone net name found in a legacy file

  const zone = newZone(parentFP !== null);
  zone.priority = 0;
  // This is the default for board files:
  zone.islandRemovalMode = 0;

  for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    // legacy locked
    if (token === 'locked') {
      zone.locked = true;
      token = p.NextTok();
    }
    if (token === T.LEFT) token = p.NextTok();
    switch (token) {
      case 'net':
        zone.net = p.parseNet();
        break;
      case 'net_name':
        p.NeedSYMBOLorNUMBER();
        legacyNetnameFromFile = p.CurText();
        p.NeedRIGHT();
        break;
      case 'layer': // keyword for zones that are on only one layer
        zone.layerSet = new LSET([p.parseBoardItemLayer()]);
        p.NeedRIGHT();
        break;
      case 'layers': {
        // keyword for zones that can live on a set of layers
        const set = p.parseBoardItemLayersAsMask();
        if (set.count() > 0) zone.layerSet = set;
        break;
      }
      case 'property':
        p.parseZoneLayerProperty(zone.layerProperties);
        break;
      case 'tstamp':
      case 'uuid':
        p.NextTok();
        zone.uuid = CurStrToKIID(p);
        p.NeedRIGHT();
        break;
      case 'hatch':
        token = p.NextTok();
        if (token !== 'none' && token !== 'edge' && token !== 'full')
          p.Expecting('none, edge, or full');
        hatchStyle = token === 'edge' ? 'edge' : token === 'full' ? 'full' : 'none';
        hatchPitch = p.parseBoardUnits('hatch pitch');
        p.NeedRIGHT();
        break;
      case 'priority':
        zone.priority = p.parseInt('zone priority');
        p.NeedRIGHT();
        break;
      case 'connect_pads':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();
          switch (token) {
            case 'yes':
              zone.padConnection = 2; // ZONE_CONNECTION::FULL
              break;
            case 'no':
              zone.padConnection = 0; // ZONE_CONNECTION::NONE
              break;
            case 'thru_hole_only':
              zone.padConnection = 3; // ZONE_CONNECTION::THT_THERMAL
              break;
            case 'clearance':
              zone.localClearance = p.parseBoardUnits('zone clearance');
              p.NeedRIGHT();
              break;
            default:
              p.Expecting('yes, no, or clearance');
          }
        }
        break;
      case 'min_thickness':
        zone.minThickness = p.parseBoardUnits('min_thickness');
        p.NeedRIGHT();
        break;
      case 'filled_areas_thickness':
        // A new zone fill strategy was added in v6 (the stroked fill is not
        // supported any more; the token is read and let go).
        p.parseBool();
        p.NeedRIGHT();
        break;
      case 'fill':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();
          switch (token) {
            case 'yes':
              zone.isFilled = true;
              break;
            case 'mode':
              token = p.NextTok();
              if (token !== 'segment' && token !== 'hatch' && token !== 'polygon')
                p.Expecting('segment, hatch or polygon');
              zone.fillMode = token === 'hatch' ? 'hatch_pattern' : 'polygons';
              p.NeedRIGHT();
              break;
            case 'hatch_thickness':
              zone.hatchThickness = p.parseBoardUnits('hatch_thickness');
              p.NeedRIGHT();
              break;
            case 'hatch_gap':
              zone.hatchGap = p.parseBoardUnits('hatch_gap');
              p.NeedRIGHT();
              break;
            case 'hatch_orientation':
              zone.hatchOrientation = p.parseDoubleNext('hatch_orientation');
              p.NeedRIGHT();
              break;
            case 'hatch_smoothing_level':
              zone.hatchSmoothingLevel = p.parseDoubleNext('hatch_smoothing_level');
              p.NeedRIGHT();
              break;
            case 'hatch_smoothing_value':
              zone.hatchSmoothingValue = p.parseDoubleNext('hatch_smoothing_value');
              p.NeedRIGHT();
              break;
            case 'hatch_border_algorithm':
              token = p.NextTok();
              if (token !== 'hatch_thickness' && token !== 'min_thickness')
                p.Expecting('hatch_thickness or min_thickness');
              zone.hatchBorderAlgorithm = token === 'hatch_thickness' ? 1 : 0;
              p.NeedRIGHT();
              break;
            case 'hatch_min_hole_area':
              zone.hatchHoleMinArea = p.parseDoubleNext('hatch_min_hole_area');
              p.NeedRIGHT();
              break;
            case 'arc_segments':
              p.parseInt('arc segment count');
              p.NeedRIGHT();
              break;
            case 'thermal_gap':
              zone.thermalReliefGap = p.parseBoardUnits('thermal_gap');
              p.NeedRIGHT();
              break;
            case 'thermal_bridge_width':
              zone.thermalReliefSpokeWidth = p.parseBoardUnits('thermal_bridge_width');
              p.NeedRIGHT();
              break;
            case 'smoothing':
              switch (p.NextTok()) {
                case 'none':
                  zone.cornerSmoothingType = 0;
                  break;
                case 'chamfer':
                  if (!zone.isRuleArea) zone.cornerSmoothingType = 1; // smoothing has meaning only for filled zones
                  break;
                case 'fillet':
                  if (!zone.isRuleArea) zone.cornerSmoothingType = 2;
                  break;
                default:
                  p.Expecting('none, chamfer, or fillet');
              }
              p.NeedRIGHT();
              break;
            case 'radius': {
              const tmp = p.parseBoardUnits('corner radius');
              if (!zone.isRuleArea) zone.cornerRadius = tmp; // smoothing has meaning only for filled zones
              p.NeedRIGHT();
              break;
            }
            case 'island_removal_mode': {
              const tmp = p.parseInt('island_removal_mode');
              if (tmp >= 0 && tmp <= 2) zone.islandRemovalMode = tmp;
              p.NeedRIGHT();
              break;
            }
            case 'island_area_min': {
              const area = p.parseBoardUnits('island_area_min');
              zone.minIslandArea = area * pcbIUScale.IU_PER_MM;
              p.NeedRIGHT();
              break;
            }
            default:
              p.Expecting(
                'mode, arc_segments, thermal_gap, thermal_bridge_width, hatch_thickness, hatch_gap, hatch_orientation, hatch_smoothing_level, hatch_smoothing_value, hatch_border_algorithm, hatch_min_hole_area, smoothing, radius, island_removal_mode, or island_area_min',
              );
          }
        }
        break;
      case 'placement':
        zone.isRuleArea = true;
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();
          switch (token) {
            case 'sheetname':
              zone.placementSourceType = 'sheetname';
              p.NeedSYMBOL();
              zone.placementSource = p.CurText();
              break;
            case 'component_class':
              zone.placementSourceType = 'component_class';
              p.NeedSYMBOL();
              zone.placementSource = p.CurText();
              break;
            case 'group':
              zone.placementSourceType = 'group';
              p.NeedSYMBOL();
              zone.placementSource = p.CurText();
              break;
            case 'enabled':
              token = p.NextTok();
              if (token === 'yes') zone.placementEnabled = true;
              else if (token === 'no') zone.placementEnabled = false;
              else p.Expecting('yes or no');
              break;
            default:
              p.Expecting('enabled, sheetname, component_class, or group');
          }
          p.NeedRIGHT();
        }
        break;
      case 'keepout':
        // "keepout" now means rule area, but the file token stays the same
        zone.isRuleArea = true;
        // Initialize these two because their tokens won't appear in older files:
        zone.doNotAllowPads = false;
        zone.doNotAllowFootprints = false;
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();
          const allowed = (): boolean => {
            const t = p.NextTok();
            if (t !== 'allowed' && t !== 'not_allowed') p.Expecting('allowed or not_allowed');
            return t === 'not_allowed';
          };
          switch (token) {
            case 'tracks':
              zone.doNotAllowTracks = allowed();
              break;
            case 'vias':
              zone.doNotAllowVias = allowed();
              break;
            case 'copperpour':
              zone.doNotAllowZoneFills = allowed();
              break;
            case 'pads':
              zone.doNotAllowPads = allowed();
              break;
            case 'footprints':
              zone.doNotAllowFootprints = allowed();
              break;
            default:
              p.Expecting('tracks, vias or copperpour');
          }
          p.NeedRIGHT();
        }
        break;
      case 'polygon': {
        const outline: OutlineEntry[] = [];
        p.NeedLEFT();
        token = p.NextTok();
        if (token !== 'pts') p.Expecting('pts');
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) readOutline(p, outline);
        p.NeedRIGHT();
        // Remark: The first polygon is the main outline.
        // Others are holes inside the main outline.
        zone.outline.push(outline);
        break;
      }
      case 'filled_polygon': {
        // "(filled_polygon (pts"
        p.NeedLEFT();
        token = p.NextTok();
        let filledLayer: number;
        if (token === 'layer') {
          filledLayer = p.parseBoardItemLayer();
          p.NeedRIGHT();
          token = p.NextTok();
          if (token !== T.LEFT) p.Expecting(T.LEFT);
          token = p.NextTok();
        } else {
          // for legacy, single-layer zones
          filledLayer = zoneFirstLayer(zone);
        }
        let island = false;
        if (token === 'island') {
          island = p.parseMaybeAbsentBool(true);
          p.NeedLEFT();
          token = p.NextTok();
        }
        if (token !== 'pts') p.Expecting('pts');
        const chain: OutlineEntry[] = [];
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) readOutline(p, chain);
        p.NeedRIGHT();
        zone.filledPolygons.push({ layer: filledLayer, island, outline: chain });
        break;
      }
      case 'fill_segments': {
        // Legacy segment fill: read and let go (the converted fill is not reproducible here).
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token !== T.LEFT) p.Expecting(T.LEFT);
          token = p.NextTok();
          if (token !== 'pts') p.Expecting('pts');
          p.parseXY();
          p.parseXY();
          p.NeedRIGHT();
        }
        break;
      }
      case 'name':
        p.NextTok();
        zone.name = p.CurText();
        p.NeedRIGHT();
        break;
      case 'attr':
        for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
          if (token === T.LEFT) token = p.NextTok();
          switch (token) {
            case 'teardrop':
              for (token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
                if (token === T.LEFT) token = p.NextTok();
                switch (token) {
                  case 'type':
                    token = p.NextTok();
                    if (token === 'padvia') zone.teardropType = 'padvia';
                    else if (token === 'track_end') zone.teardropType = 'track_end';
                    else p.Expecting('padvia or track_end');
                    zone.isTeardropArea = true;
                    p.NeedRIGHT();
                    break;
                  default:
                    p.Expecting('type');
                }
              }
              break;
            default:
              p.Expecting('teardrop');
          }
        }
        break;
      case 'locked':
        zone.locked = p.parseBool();
        p.NeedRIGHT();
        break;
      default:
        p.Expecting(
          'net, layer/layers, tstamp, hatch, priority, connect_pads, min_thickness, fill, polygon, filled_polygon, fill_segments, attr, locked, uuid, or name',
        );
    }
  }

  const numCorners = zone.outline.reduce((n, o) => n + o.length, 0);
  const isOnCopper = zone.layerSet.and(LSET.AllCuMask()).count() > 0;
  if (numCorners > 2) {
    if (!isOnCopper) zone.net = null;
    // Set hatch here, after outlines corners are read
    zone.hatchStyle = hatchStyle;
    zone.hatchPitch = hatchPitch;
  }

  // Ensure keepout and non copper zones do not have a net
  // (which have no sense for these zones)
  // the netcode 0 is used for these zones
  const zoneHasNet = isOnCopper && !zone.isRuleArea;
  if (!zoneHasNet) zone.net = null;

  // In legacy files, ensure the zone net name is valid, and matches the net code
  if (legacyNetnameFromFile !== '' && (zone.net?.name ?? '') !== legacyNetnameFromFile) {
    // Can happens which old boards, with nonexistent nets ...
    // or after being edited by hand
    // We try to fix the mismatch.
    const existing = p.findNet(legacyNetnameFromFile);
    if (existing !== undefined) {
      // An existing net has the same net name. use it for the zone
      zone.net = { name: legacyNetnameFromFile, code: existing };
    } else {
      // Not existing net: add a new net to keep track of the zone netname
      const newnetcode = p.getNetCount();
      const code = p.addNet(legacyNetnameFromFile, newnetcode);
      // Store the new code mapping
      p.pushValueIntoMap(newnetcode, code);
      // and update the zone netcode
      zone.net = { name: legacyNetnameFromFile, code };
    }
  }

  void parentFP;
  return zone;
}

// ---------------------------------------------------------------------------
// PCB_POINT (:8582), PCB_TARGET (:8632)
// ---------------------------------------------------------------------------

/** `parsePCB_POINT()` (:8582). */
export function parsePCB_POINT(p: PCB_IO_KICAD_SEXPR_PARSER): KPcbPoint {
  const point: KPcbPoint = {
    pos: { x: 0, y: 0 },
    size: 0,
    layer: F_Cu,
    uuid: newKiid(),
    locked: false,
  };
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token === T.LEFT) token = p.NextTok();
    switch (token) {
      case 'at': {
        const x = p.parseBoardUnits('point x position');
        const y = p.parseBoardUnits('point y position');
        point.pos = { x, y };
        p.NeedRIGHT();
        break;
      }
      case 'size':
        point.size = p.parseBoardUnits('point size');
        p.NeedRIGHT();
        break;
      case 'layer':
        point.layer = p.parseBoardItemLayer();
        p.NeedRIGHT();
        break;
      case 'uuid':
        p.NextTok();
        point.uuid = CurStrToKIID(p);
        p.NeedRIGHT();
        break;
      default:
        p.Expecting('at, size, layer or uuid');
    }
  }
  return point;
}

/** `parsePCB_TARGET()` (:8632). */
export function parsePCB_TARGET(p: PCB_IO_KICAD_SEXPR_PARSER): KPcbTarget {
  const target: KPcbTarget = {
    shape: 0,
    pos: { x: 0, y: 0 },
    size: 0,
    width: 0,
    layer: Edge_Cuts,
    uuid: newKiid(),
  };
  for (let token = p.NextTok(); token !== T.RIGHT; token = p.NextTok()) {
    if (token === T.LEFT) token = p.NextTok();
    switch (token) {
      case 'x':
        target.shape = 1;
        break;
      case 'plus':
        target.shape = 0;
        break;
      case 'at': {
        const x = p.parseBoardUnits('target x position');
        const y = p.parseBoardUnits('target y position');
        target.pos = { x, y };
        p.NeedRIGHT();
        break;
      }
      case 'size':
        target.size = p.parseBoardUnits('target size');
        p.NeedRIGHT();
        break;
      case 'width':
        target.width = p.parseBoardUnits('target thickness');
        p.NeedRIGHT();
        break;
      case 'layer':
        target.layer = p.parseBoardItemLayer();
        p.NeedRIGHT();
        break;
      case 'tstamp':
      case 'uuid':
        p.NextTok();
        target.uuid = CurStrToKIID(p);
        p.NeedRIGHT();
        break;
      default:
        p.Expecting('x, plus, at, size, width, layer, uuid, or tstamp');
    }
  }
  return target;
}
