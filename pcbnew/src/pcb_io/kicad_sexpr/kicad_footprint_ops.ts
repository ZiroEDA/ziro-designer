// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT::SetOrientation`, `FOOTPRINT::Rotate` and `FOOTPRINT::Flip`
 * over the model (`KFootprint`), and the clone `PCB_IO_KICAD_SEXPR::
 * FootprintSave` makes before it formats a footprint into a `.kicad_mod`.
 *
 * The model keeps each child the way the FILE spells it, which is a mixed
 * frame (`format( const PCB_TEXT* )` :2276, `formatInternalUnits( …, parentFP )`
 * :467):
 *
 *   - **footprint-relative**: a shape's points, a text's position, a text
 *     box's corners, a table's cells. Rotating the footprint leaves these
 *     alone, because the formatter unrotates by the footprint orientation.
 *   - **board-absolute**: a pad's `(at … angle)` angle, a text's angle, a
 *     zone's outline and fills, a dimension, a reference image, a barcode, a
 *     point. These move with the footprint the way the C++ members do.
 *
 * So `SetOrientation` here is the C++ loop over the children with the
 * relative items skipped: not a shortcut, the same result the formatter would
 * write after the C++ rotated its absolute members.
 *
 * Two children are not fully mirrored, and both are said so where it happens:
 * a reference image's pixels (`REFERENCE_IMAGE::Flip` mirrors the bitmap; the
 * position and layer flip here, the PNG payload does not), and a table whose
 * cells sit at a non-cardinal angle (`PCB_TABLE::Flip` turns such cells into
 * polygons on the way through `EDA_SHAPE::rotate`; cardinal angles, which is
 * every table the table tool draws, follow the C++ exactly).
 */
import { EDA_ANGLE, ANGLE_180 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { FLIP_DIRECTION, MIRROR } from '@ziroeda/core/src/mirror.js';
import type { LayerDescr } from '../../board_file_model.js';
import { updateDimension } from '../../dimension_text.js';
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
  In_Cu,
  IsCopperLayer,
  PCB_LAYER_ID_COUNT,
  User_1,
} from '../../layer_ids.js';
import { LSET } from '../../lset.js';
import { applyDimension, dimensionView } from './board_view.js';
import {
  type CopperLayerProps,
  type KEdaText,
  type KFootprint,
  type KPad,
  type KPadstack,
  type KPcbBarcode,
  type KPcbDimension,
  type KPcbReferenceImage,
  type KPcbTable,
  type KPcbTableCell,
  type KPcbText,
  type KPcbTextBox,
  type KZone,
  PADSTACK_INNER_LAYERS,
  RECT_CHAMFER_BOTTOM_LEFT,
  RECT_CHAMFER_BOTTOM_RIGHT,
  RECT_CHAMFER_TOP_LEFT,
  RECT_CHAMFER_TOP_RIGHT,
  uniquePadstackLayers,
} from './kicad_board_items.js';
import type { KPcbShape, OutlineEntry } from './pcb_io_kicad_sexpr_items.js';

export { FLIP_DIRECTION };

// ---------------------------------------------------------------------------
// BOARD::FlipLayer
// ---------------------------------------------------------------------------

/** `::FlipLayer( aLayerId, aCopperLayersCount )` (common/layer_id.cpp:172). */
export function flipLayerId(aLayerId: number, aCopperLayersCount: number): number {
  switch (aLayerId) {
    case B_Cu:
      return F_Cu;
    case F_Cu:
      return B_Cu;
    case B_SilkS:
      return F_SilkS;
    case F_SilkS:
      return B_SilkS;
    case B_Adhes:
      return F_Adhes;
    case F_Adhes:
      return B_Adhes;
    case B_Mask:
      return F_Mask;
    case F_Mask:
      return B_Mask;
    case B_Paste:
      return F_Paste;
    case F_Paste:
      return B_Paste;
    case B_CrtYd:
      return F_CrtYd;
    case F_CrtYd:
      return B_CrtYd;
    case B_Fab:
      return F_Fab;
    case F_Fab:
      return B_Fab;
    default:
      // change internal layer if aCopperLayersCount is >= 4
      if (IsCopperLayer(aLayerId) && aCopperLayersCount >= 4) {
        const innerIndex = Math.trunc((aLayerId - In_Cu(1)) / 2);
        let flippedIndex = aCopperLayersCount - 3 - innerIndex;
        if (flippedIndex < 0) flippedIndex = 0;
        const maxIndex = aCopperLayersCount - 3;
        if (flippedIndex > maxIndex) flippedIndex = maxIndex;
        return In_Cu(1) + flippedIndex * 2;
      }
      // No change for the other layers
      return aLayerId;
  }
}

/**
 * `BOARD::recalcOpposites()` (board.cpp:862): every layer's opposite, the
 * free `FlipLayer` plus the front/back user layers a board paired by name or
 * by adjacency. `BOARD::FlipLayer( aLayer )` is then a lookup in it.
 */
export function boardOpposites(
  descrs: ReadonlyMap<number, LayerDescr>,
  copperLayerCount: number,
): Map<number, number> {
  const opposite = new Map<number, number>();
  const typeOf = (l: number): LayerDescr['type'] => descrs.get(l)?.type ?? 'undefined';
  // `m_userName` is the canonical name when the board never renamed the layer.
  const userName = (l: number): string => {
    const d = descrs.get(l);
    return d ? d.userName || d.name : '';
  };
  const afterFirstDot = (s: string): string => {
    const i = s.indexOf('.');
    return i < 0 ? '' : s.slice(i + 1);
  };

  for (let layer = F_Cu; layer < PCB_LAYER_ID_COUNT; ++layer)
    opposite.set(layer, flipLayerId(layer, copperLayerCount));

  // Match up similary-named front/back user layers
  for (let layer = User_1; layer <= PCB_LAYER_ID_COUNT; layer += 2) {
    if (opposite.get(layer) !== layer) continue; // already paired
    const type = typeOf(layer);
    if (type !== 'front' && type !== 'back') continue;

    const principalName = afterFirstDot(userName(layer));

    for (let ii = layer + 2; ii <= PCB_LAYER_ID_COUNT; ii += 2) {
      if (opposite.get(ii) !== ii) continue; // already paired
      const t2 = typeOf(ii);
      if (t2 !== 'front' && t2 !== 'back') continue;
      if (type === t2) continue;

      const candidate = afterFirstDot(userName(ii));

      if (candidate !== '' && candidate === principalName) {
        opposite.set(layer, ii);
        opposite.set(ii, layer);
        break;
      }
    }
  }

  // Match up non-custom-named consecutive front/back user layer pairs
  for (let layer = User_1; layer < PCB_LAYER_ID_COUNT - 2; layer += 2) {
    const next = layer + 2;

    // ignore already-matched layers
    if (opposite.get(layer) !== layer || opposite.get(next) !== next) continue;

    // ignore layer pairs that aren't consecutive front/back
    if (typeOf(layer) !== 'front' || typeOf(next) !== 'back') continue;

    const renamed = (l: number): boolean => {
      const d = descrs.get(l);
      return !!d && d.userName !== '' && d.userName !== d.name;
    };
    if (renamed(layer) && renamed(next)) {
      opposite.set(layer, next);
      opposite.set(next, layer);
    }
  }

  return opposite;
}

/** `BOARD::FlipLayer( aLayer )` (board.cpp:922) as a function of the board's table. */
export const boardFlipLayer =
  (opposites: ReadonlyMap<number, number>) =>
  (layer: number): number =>
    opposites.get(layer) ?? layer;

/**
 * `BOARD_ITEM::IsSideSpecific()` (board_item.cpp:193): the item's layers meet
 * `LSET::SideSpecificMask()`, or its principal layer is a front/back user layer.
 */
function isSideSpecific(
  layerSet: LSET,
  principal: number,
  descrs: ReadonlyMap<number, LayerDescr>,
): boolean {
  if (layerSet.and(LSET.SideSpecificMask()).any()) return true;
  const type = descrs.get(principal)?.type;
  return type === 'front' || type === 'back';
}

// ---------------------------------------------------------------------------
// The board a footprint is flipped against
// ---------------------------------------------------------------------------

/** What `FOOTPRINT::Flip` asks its `GetBoard()` for. */
export interface FlipBoard {
  copperLayerCount: number;
  layerDescrs: ReadonlyMap<number, LayerDescr>;
}

interface Ctx {
  flip: (layer: number) => number;
  descrs: ReadonlyMap<number, LayerDescr>;
}

const ctxOf = (board: FlipBoard): Ctx => ({
  flip: boardFlipLayer(boardOpposites(board.layerDescrs, board.copperLayerCount)),
  descrs: board.layerDescrs,
});

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const deg = (v: number): EDA_ANGLE => new EDA_ANGLE(v);

/** `MIRROR( aPoint, aMirrorRef, aFlipDirection )`, returning the point. */
function mirrored(p: Vec2, ref: Vec2, dir: FLIP_DIRECTION): Vec2 {
  const out = { x: p.x, y: p.y };
  MIRROR(out, ref, dir);
  return out;
}

const rotated = (p: Vec2, centre: Vec2, angle: EDA_ANGLE): Vec2 => RotatePoint(p, centre, angle);

/** `SHAPE_LINE_CHAIN::Mirror` over an outline as the file keeps it, arcs included. */
function mirrorOutline(outline: OutlineEntry[], ref: Vec2, dir: FLIP_DIRECTION): OutlineEntry[] {
  return outline.map((e) =>
    'xy' in e
      ? { xy: mirrored(e.xy, ref, dir) }
      : {
          arc: {
            start: mirrored(e.arc.start, ref, dir),
            mid: mirrored(e.arc.mid, ref, dir),
            end: mirrored(e.arc.end, ref, dir),
          },
        },
  );
}

/** `SHAPE_LINE_CHAIN::Rotate` over an outline as the file keeps it. */
function rotateOutline(outline: OutlineEntry[], centre: Vec2, angle: EDA_ANGLE): OutlineEntry[] {
  return outline.map((e) =>
    'xy' in e
      ? { xy: rotated(e.xy, centre, angle) }
      : {
          arc: {
            start: rotated(e.arc.start, centre, angle),
            mid: rotated(e.arc.mid, centre, angle),
            end: rotated(e.arc.end, centre, angle),
          },
        },
  );
}

const hJustNeg = (j: KEdaText['hJustify']): KEdaText['hJustify'] =>
  j === 'left' ? 'right' : j === 'right' ? 'left' : 'center';
const vJustNeg = (j: KEdaText['vJustify']): KEdaText['vJustify'] =>
  j === 'top' ? 'bottom' : j === 'bottom' ? 'top' : 'center';

// ---------------------------------------------------------------------------
// The children: Rotate
// ---------------------------------------------------------------------------

/**
 * `PCB_TEXT::Rotate` (pcb_text.cpp:445) for a footprint text, whose position
 * the file keeps relative: only the (absolute) angle moves.
 */
function rotateFpText(t: KPcbText, angle: EDA_ANGLE): void {
  t.angle = deg(t.angle).add(angle).Normalize().AsDegrees();
}

/** `PCB_TEXT::KeepUpright()` (pcb_text.cpp:374). */
function keepUpright(t: KPcbText): void {
  if (!t.keepUpright) return;

  const newAngle = deg(t.angle).Normalize();
  const needsFlipped = newAngle.AsDegrees() >= 180;

  if (needsFlipped) {
    t.hJustify = hJustNeg(t.hJustify);
    t.vJustify = vJustNeg(t.vJustify);
    t.angle = newAngle.add(ANGLE_180).Normalize().AsDegrees();
  }
}

/** `PAD::Rotate` (pad.cpp:2155): the file's position is relative; the angle is absolute. */
function rotatePad(p: KPad, angle: EDA_ANGLE): void {
  p.orientation = deg(p.orientation).add(angle).Normalize().AsDegrees();
}

/** `ZONE::Rotate` (zone.cpp:1120): outline and fills, which the file keeps absolute. */
function rotateZone(z: KZone, centre: Vec2, angle: EDA_ANGLE): void {
  z.outline = z.outline.map((o) => rotateOutline(o, centre, angle));
  for (const f of z.filledPolygons) f.outline = rotateOutline(f.outline, centre, angle);
}

/** `PCB_DIMENSION_BASE::Rotate` (pcb_dimension.cpp:557). */
function rotateDimension(d: KPcbDimension, centre: Vec2, angle: EDA_ANGLE): void {
  d.text.angle = deg(d.text.angle).add(angle).Normalize().AsDegrees();
  d.text.pos = rotated(d.text.pos, centre, angle);
  d.start = rotated(d.start, centre, angle);
  d.end = rotated(d.end, centre, angle);
  updateK(d);
}

/**
 * `REFERENCE_IMAGE::Rotate` (reference_image.cpp:283): the position moves;
 * each 90° step would also rotate the bitmap, which the PNG payload here does
 * not follow.
 */
function rotateImage(img: KPcbReferenceImage, centre: Vec2, angle: EDA_ANGLE): void {
  img.pos = rotated(img.pos, centre, angle);
}

/** `PCB_BARCODE::Rotate` (pcb_barcode.cpp:296). */
function rotateBarcode(b: KPcbBarcode, centre: Vec2, angle: EDA_ANGLE): void {
  b.pos = rotated(b.pos, centre, angle);
  b.angle = deg(b.angle).add(angle).AsDegrees();
}

// ---------------------------------------------------------------------------
// The children: Flip
// ---------------------------------------------------------------------------

/**
 * `PCB_TEXT::Flip` (pcb_text.cpp:478) for a footprint text: the relative
 * position mirrors about the footprint, which is the origin of that frame.
 */
function flipFpText(t: KPcbText, dir: FLIP_DIRECTION, ctx: Ctx): void {
  if (dir === FLIP_DIRECTION.LEFT_RIGHT) {
    t.pos = { x: -t.pos.x, y: t.pos.y };
    t.angle = deg(-t.angle).AsDegrees();
  } else {
    t.pos = { x: t.pos.x, y: -t.pos.y };
    t.angle = ANGLE_180.sub(deg(t.angle)).AsDegrees();
  }

  t.layer = ctx.flip(t.layer);

  if (isSideSpecific(new LSET([t.layer]), t.layer, ctx.descrs)) t.mirrored = !t.mirrored;
}

/** `mirrorBitFlags` (pad.cpp:1489). */
function mirrorBitFlags(bits: number, a: number, b: number): number {
  const temp = (bits & a) !== 0;
  let out = bits;
  if (out & b) out |= a;
  else out &= ~a;
  if (temp) out |= b;
  else out &= ~b;
  return out;
}

/** `PADSTACK::FlipLayers( aBoard )` (padstack.cpp:1476). */
function flipPadstackLayers(ps: KPadstack, flip: (l: number) => number): void {
  if (ps.mode === 'front_inner_back') {
    const old = ps.copperProps;
    const next = new Map<number, CopperLayerProps>();
    const take = (l: number): CopperLayerProps => old.get(l) ?? { ...defaultCopper(old) };
    next.set(flip(F_Cu), take(F_Cu));
    next.set(PADSTACK_INNER_LAYERS, take(PADSTACK_INNER_LAYERS));
    next.set(flip(B_Cu), take(B_Cu));
    ps.copperProps = next;
  } else if (ps.mode === 'custom') {
    const next = new Map<number, CopperLayerProps>();
    for (const [layer, props] of ps.copperProps) next.set(flip(layer), props);
    ps.copperProps = next;
  }

  const mask = ps.frontOuterLayers;
  ps.frontOuterLayers = ps.backOuterLayers;
  ps.backOuterLayers = mask;

  ps.drill.start = flip(ps.drill.start);
  ps.drill.end = flip(ps.drill.end);

  ps.secondaryDrill.start = flip(ps.secondaryDrill.start);
  ps.secondaryDrill.end = flip(ps.secondaryDrill.end);

  ps.tertiaryDrill.start = flip(ps.tertiaryDrill.start);
  ps.tertiaryDrill.end = flip(ps.tertiaryDrill.end);

  const pm = ps.frontPostMachining;
  ps.frontPostMachining = ps.backPostMachining;
  ps.backPostMachining = pm;
}

/** `std::unordered_map::operator[]` on a missing key: a default-constructed entry. */
function defaultCopper(m: Map<number, CopperLayerProps>): CopperLayerProps {
  const any = m.values().next().value;
  return any
    ? { ...any, shape: { ...any.shape }, customShapes: [] }
    : ({ shape: {} as CopperLayerProps['shape'], customShapes: [] } as CopperLayerProps);
}

/**
 * `PAD::Flip` (pad.cpp:1476). The file's `(at …)` is footprint-relative, so
 * the position mirrors about the origin of that frame; the angle is absolute
 * and the footprint's own orientation is zero while its pads flip
 * (footprint.cpp:2956), so `SetFPRelativeOrientation( -GetFPRelativeOrientation() )`
 * is a plain negation.
 */
function flipPad(p: KPad, dir: FLIP_DIRECTION, ctx: Ctx): void {
  p.at = mirrored(p.at, { x: 0, y: 0 }, dir);

  const ps = p.padstack;
  for (const layer of uniquePadstackLayers(ps)) {
    const props = ps.copperProps.get(layer);
    if (!props) continue;
    props.shape.offset = mirrored(props.shape.offset, { x: 0, y: 0 }, dir);
    props.shape.trapezoidDeltaSize = mirrored(props.shape.trapezoidDeltaSize, { x: 0, y: 0 }, dir);
  }

  p.orientation = deg(-p.orientation).Normalize().AsDegrees();

  for (const layer of uniquePadstackLayers(ps)) {
    const props = ps.copperProps.get(layer);
    if (!props) continue;
    let bits = props.shape.chamferedRectPositions;
    if (dir === FLIP_DIRECTION.LEFT_RIGHT) {
      bits = mirrorBitFlags(bits, RECT_CHAMFER_TOP_LEFT, RECT_CHAMFER_TOP_RIGHT);
      bits = mirrorBitFlags(bits, RECT_CHAMFER_BOTTOM_LEFT, RECT_CHAMFER_BOTTOM_RIGHT);
    } else {
      bits = mirrorBitFlags(bits, RECT_CHAMFER_TOP_LEFT, RECT_CHAMFER_BOTTOM_LEFT);
      bits = mirrorBitFlags(bits, RECT_CHAMFER_TOP_RIGHT, RECT_CHAMFER_BOTTOM_RIGHT);
    }
    props.shape.chamferedRectPositions = bits;
  }

  flipPadstackLayers(ps, ctx.flip);

  // Flip pads layers after padstack geometry
  const flipped = new LSET();
  for (const layer of ps.layerSet.Seq()) flipped.set(ctx.flip(layer));
  ps.layerSet = flipped;

  // Flip the basic shapes, in custom pads (`PAD::FlipPrimitives`, :1540)
  for (const layer of uniquePadstackLayers(ps)) {
    const props = ps.copperProps.get(layer);
    if (!props) continue;
    for (const primitive of props.customShapes) {
      edaShapeFlip(primitive, { x: 0, y: 0 }, dir);
      primitive.layer = ctx.flip(primitive.layer);
    }
  }
}

/** `EDA_SHAPE::flip` (eda_shape.cpp:998) over the file's spelling of a shape. */
function edaShapeFlip(s: KPcbShape, centre: Vec2, dir: FLIP_DIRECTION): void {
  switch (s.shape) {
    case 'segment':
    case 'rectangle':
    case 'circle':
      s.start = mirrored(s.start, centre, dir);
      s.end = mirrored(s.end, centre, dir);
      break;

    case 'arc': {
      s.start = mirrored(s.start, centre, dir);
      s.end = mirrored(s.end, centre, dir);
      if (s.arcCenter) s.arcCenter = mirrored(s.arcCenter, centre, dir);
      if (s.arcMid) s.arcMid = mirrored(s.arcMid, centre, dir);
      const start = s.start;
      s.start = s.end;
      s.end = start;
      break;
    }

    case 'poly':
      if (s.outline) s.outline = mirrorOutline(s.outline, centre, dir);
      break;

    case 'bezier':
      s.start = mirrored(s.start, centre, dir);
      s.end = mirrored(s.end, centre, dir);
      if (s.bezierC1) s.bezierC1 = mirrored(s.bezierC1, centre, dir);
      if (s.bezierC2) s.bezierC2 = mirrored(s.bezierC2, centre, dir);
      break;
  }
}

/** `PCB_SHAPE::Flip` (pcb_shape.cpp:579) for a footprint shape, whose points are relative. */
function flipFpShape(s: KPcbShape, dir: FLIP_DIRECTION, ctx: Ctx): void {
  edaShapeFlip(s, { x: 0, y: 0 }, dir);
  s.layer = ctx.flip(s.layer);
}

/** `PCB_TEXTBOX::Flip` (pcb_textbox.cpp:574): the shape half about `centre`, then the text half. */
function flipTextBoxAbout(tb: KPcbTextBox, centre: Vec2, dir: FLIP_DIRECTION, ctx: Ctx): void {
  // PCB_SHAPE::Flip: a text box is a RECTANGLE or a POLY.
  if (tb.shape === 'rectangle') {
    tb.start = mirrored(tb.start, centre, dir);
    tb.end = mirrored(tb.end, centre, dir);
  } else if (tb.outline) {
    tb.outline = mirrorOutline(tb.outline, centre, dir);
  }
  tb.layer = ctx.flip(tb.layer);

  if (dir === FLIP_DIRECTION.LEFT_RIGHT) tb.angle = deg(-tb.angle).AsDegrees();
  else tb.angle = ANGLE_180.sub(deg(tb.angle)).AsDegrees();

  if (isSideSpecific(new LSET([tb.layer]), tb.layer, ctx.descrs)) tb.mirrored = !tb.mirrored;
}

/** `ZONE::Flip` (zone.cpp:1131): outline and fills mirrored, every layer flipped. */
function flipZone(z: KZone, centre: Vec2, dir: FLIP_DIRECTION, ctx: Ctx): void {
  // ZONE::Mirror
  z.outline = z.outline.map((o) => mirrorOutline(o, centre, dir));
  for (const f of z.filledPolygons) f.outline = mirrorOutline(f.outline, centre, dir);

  const flipped = new LSET();
  for (const layer of z.layerSet.Seq()) flipped.set(ctx.flip(layer));
  z.layerSet = flipped;

  const props = new Map(z.layerProperties);
  for (const [oldLayer, properties] of props) z.layerProperties.set(ctx.flip(oldLayer), properties);

  for (const f of z.filledPolygons) f.layer = ctx.flip(f.layer);
}

/** `PCB_DIMENSION_BASE::Mirror` (pcb_dimension.cpp:584) with the subclass height rules. */
function mirrorDimension(d: KPcbDimension, axis: Vec2, dir: FLIP_DIRECTION, ctx: Ctx): void {
  // PCB_DIM_ALIGNED::Mirror (:923) / PCB_DIM_ORTHOGONAL::Mirror (:1163)
  if (d.type === 'aligned') d.height = -d.height;
  else if (d.type === 'orthogonal') {
    // Only reverse the height if the height is aligned with the flip
    if (d.orientation === 0 && dir === FLIP_DIRECTION.TOP_BOTTOM) d.height = -d.height;
    else if (d.orientation === 1 && dir === FLIP_DIRECTION.LEFT_RIGHT) d.height = -d.height;
  }

  d.text.pos = mirrored(d.text.pos, axis, dir);

  // invert angle
  d.text.angle = deg(-d.text.angle).AsDegrees();

  d.start = mirrored(d.start, axis, dir);
  d.end = mirrored(d.end, axis, dir);

  if (isSideSpecific(new LSET([d.layer]), d.layer, ctx.descrs)) d.text.mirrored = !d.text.mirrored;

  updateK(d);
}

/** `PCB_DIMENSION_BASE::Flip` (pcb_dimension.cpp:576). */
function flipDimension(d: KPcbDimension, centre: Vec2, dir: FLIP_DIRECTION, ctx: Ctx): void {
  mirrorDimension(d, centre, dir, ctx);
  d.layer = ctx.flip(d.layer);
  d.text.layer = d.layer;
}

/** `PCB_DIMENSION_BASE::Update()`: geometry and text re-derived, through the view's port. */
function updateK(d: KPcbDimension): void {
  applyDimension(d, updateDimension(dimensionView(d, null)), null);
}

/**
 * `PCB_REFERENCE_IMAGE::Flip` (pcb_reference_image.cpp:246): the position
 * mirrors and the layer flips. `REFERENCE_IMAGE::Flip` also mirrors the
 * bitmap; the PNG payload is kept as read.
 */
function flipImage(img: KPcbReferenceImage, centre: Vec2, dir: FLIP_DIRECTION, ctx: Ctx): void {
  img.pos = mirrored(img.pos, centre, dir);
  img.layer = ctx.flip(img.layer);
}

/** `PCB_BARCODE::Flip` (pcb_barcode.cpp:305). */
function flipBarcode(b: KPcbBarcode, centre: Vec2, dir: FLIP_DIRECTION, ctx: Ctx): void {
  b.pos = mirrored(b.pos, centre, dir);
  if (dir === FLIP_DIRECTION.TOP_BOTTOM) b.angle = deg(b.angle).add(ANGLE_180).AsDegrees();
  b.layer = ctx.flip(b.layer);
}

// ---------------------------------------------------------------------------
// PCB_TABLE, whose cells the file keeps footprint-relative
// ---------------------------------------------------------------------------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `EDA_SHAPE::getBoundingBox()` (eda_shape.cpp:1344) for a cell, which is a rectangle or a polygon. */
function cellBBox(c: KPcbTableCell): Box {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const merge = (p: Vec2): void => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  if (c.shape === 'rectangle') {
    merge(c.start);
    merge({ x: c.end.x, y: c.start.y });
    merge(c.end);
    merge({ x: c.start.x, y: c.end.y });
  } else {
    for (const e of c.outline ?? []) {
      if ('xy' in e) merge(e.xy);
      else {
        merge(e.arc.start);
        merge(e.arc.mid);
        merge(e.arc.end);
      }
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  const inflate = Math.trunc(Math.max(0, c.stroke.width) / 2);
  return {
    x: minX - inflate,
    y: minY - inflate,
    w: maxX - minX + 2 * inflate,
    h: maxY - minY + 2 * inflate,
  };
}

/** `BOX2I::Merge`. */
function mergeBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** `BOX2I::GetCenter()`: `m_Pos + m_Size / 2` in integers. */
const boxCentre = (b: Box): Vec2 => ({
  x: b.x + Math.trunc(b.w / 2),
  y: b.y + Math.trunc(b.h / 2),
});

/** `PCB_TABLE::GetBoundingBox()` (pcb_table.cpp:460): the first and last cells. */
function tableBBox(t: KPcbTable): Box {
  const first = t.cells[0];
  const last = t.cells[t.cells.length - 1];
  if (!first || !last) return { x: 0, y: 0, w: 0, h: 0 };
  return mergeBox(cellBBox(first), cellBBox(last));
}

/** `EDA_SHAPE::getPosition()` for a cell. */
const cellPosition = (c: KPcbTableCell): Vec2 => {
  if (c.shape === 'poly') {
    const first = c.outline?.[0];
    if (first) return 'xy' in first ? first.xy : first.arc.start;
  }
  return c.start;
};

/** `PCB_TEXTBOX::Move` (pcb_textbox.cpp:522). */
function moveCell(c: KPcbTableCell, d: Vec2): void {
  if (c.shape === 'rectangle') {
    c.start = { x: c.start.x + d.x, y: c.start.y + d.y };
    c.end = { x: c.end.x + d.x, y: c.end.y + d.y };
  } else if (c.outline) {
    c.outline = c.outline.map((e) =>
      'xy' in e
        ? { xy: { x: e.xy.x + d.x, y: e.xy.y + d.y } }
        : {
            arc: {
              start: { x: e.arc.start.x + d.x, y: e.arc.start.y + d.y },
              mid: { x: e.arc.mid.x + d.x, y: e.arc.mid.y + d.y },
              end: { x: e.arc.end.x + d.x, y: e.arc.end.y + d.y },
            },
          },
    );
  }
}

/**
 * `PCB_TEXTBOX::Rotate` (pcb_textbox.cpp:529) for a rectangle at a cardinal
 * angle, which is what `EDA_SHAPE::rotate` keeps a rectangle (:957-962). A
 * non-cardinal angle turns the cell into a polygon upstream; that branch is
 * not followed, and `flipTable` says so.
 */
function rotateCell(c: KPcbTableCell, centre: Vec2, angle: EDA_ANGLE): void {
  if (c.shape === 'rectangle') {
    c.start = rotated(c.start, centre, angle);
    c.end = rotated(c.end, centre, angle);
  } else if (c.outline) {
    c.outline = rotateOutline(c.outline, centre, angle);
  }
  c.angle = deg(c.angle).add(angle).Normalize().AsDegrees();
}

const tableRowCount = (t: KPcbTable): number => Math.trunc(t.cells.length / t.colCount);
const tableCell = (t: KPcbTable, row: number, col: number): KPcbTableCell | undefined =>
  t.cells[row * t.colCount + col];

/** `PCB_TABLE::Normalize()` (pcb_table.cpp:147). */
function normalizeTable(t: KPcbTable): void {
  const cell0 = t.cells[0];
  if (!cell0) return;

  const cellAngle = deg(cell0.angle);

  const stableCenter = boxCentre(cellBBox(cell0));

  let cell0Width = t.colWidths[0] ?? 0;
  let cell0Height = t.rowHeights[0] ?? 0;

  if (cell0.colSpan > 1)
    for (let ii = 1; ii < cell0.colSpan; ++ii) cell0Width += t.colWidths[ii] ?? 0;
  if (cell0.rowSpan > 1)
    for (let ii = 1; ii < cell0.rowSpan; ++ii) cell0Height += t.rowHeights[ii] ?? 0;

  if (!cellAngle.IsZero())
    for (const cell of t.cells) rotateCell(cell, stableCenter, cellAngle.Invert());

  const unrotatedOrigin = {
    x: stableCenter.x - Math.trunc(cell0Width / 2),
    y: stableCenter.y - Math.trunc(cell0Height / 2),
  };

  let y = unrotatedOrigin.y;

  for (let row = 0; row < tableRowCount(t); ++row) {
    let x = unrotatedOrigin.x;
    const rowHeight = t.rowHeights[row] ?? 0;

    for (let col = 0; col < t.colCount; ++col) {
      const colWidth = t.colWidths[col] ?? 0;
      const cell = tableCell(t, row, col);
      if (!cell) continue;

      let cellWidth = colWidth;
      let cellHeight = rowHeight;

      if (cell.colSpan > 1 || cell.rowSpan > 1) {
        for (let ii = col + 1; ii < col + cell.colSpan; ++ii) cellWidth += t.colWidths[ii] ?? 0;
        for (let ii = row + 1; ii < row + cell.rowSpan; ++ii) cellHeight += t.rowHeights[ii] ?? 0;
      }

      const pos = { x, y };
      const end = { x: x + cellWidth, y: y + cellHeight };

      // `SetPosition( pos )` is `move( pos - getPosition() )`; `SetEnd( end )` sets it.
      const cur = cellPosition(cell);
      if (cur.x !== pos.x || cur.y !== pos.y)
        moveCell(cell, { x: pos.x - cur.x, y: pos.y - cur.y });
      if (cell.end.x !== end.x || cell.end.y !== end.y) cell.end = end;

      x += colWidth;
    }

    y += rowHeight;
  }

  if (!cellAngle.IsZero()) for (const cell of t.cells) rotateCell(cell, stableCenter, cellAngle);

  const newCenter = boxCentre(cellBBox(cell0));

  if (newCenter.x !== stableCenter.x || newCenter.y !== stableCenter.y) {
    const correction = { x: stableCenter.x - newCenter.x, y: stableCenter.y - newCenter.y };
    for (const cell of t.cells) moveCell(cell, correction);
  }
}

/** `PCB_TABLE::Rotate` (pcb_table.cpp:306). */
function rotateTable(t: KPcbTable, centre: Vec2, angle: EDA_ANGLE): void {
  if (t.cells.length === 0) return;
  for (const cell of t.cells) rotateCell(cell, centre, angle);
  normalizeTable(t);
}

/**
 * `PCB_TABLE::Flip` (pcb_table.cpp:318), about a centre in the cells' own
 * (footprint-relative) frame.
 */
function flipTable(t: KPcbTable, centre: Vec2, dir: FLIP_DIRECTION, ctx: Ctx): void {
  const cell0 = t.cells[0];
  if (!cell0) return;

  const originalBBox = tableBBox(t);

  const targetPos =
    dir === FLIP_DIRECTION.LEFT_RIGHT
      ? { x: 2 * centre.x - (originalBBox.x + originalBBox.w), y: originalBBox.y }
      : { x: originalBBox.x, y: 2 * centre.y - (originalBBox.y + originalBBox.h) };

  const originalAngle = deg(cell0.angle);

  if (!originalAngle.IsZero()) rotateTable(t, cellPosition(cell0), originalAngle.Invert());

  const tableOrigin = cellPosition(cell0);

  for (const cell of t.cells) flipTextBoxAbout(cell, tableOrigin, dir, ctx);

  const oldCells = [...t.cells];
  const rows = tableRowCount(t);

  if (dir === FLIP_DIRECTION.LEFT_RIGHT) {
    let rowOffset = 0;
    for (let row = 0; row < rows; ++row) {
      for (let col = 0; col < t.colCount; ++col)
        t.cells[rowOffset + col] = oldCells[rowOffset + t.colCount - 1 - col]!;
      rowOffset += t.colCount;
    }
    const newColWidths: number[] = [];
    for (let col = 0; col < t.colCount; ++col)
      newColWidths[col] = t.colWidths[t.colCount - 1 - col] ?? 0;
    t.colWidths = newColWidths;
  } else {
    for (let row = 0; row < rows; ++row) {
      for (let col = 0; col < t.colCount; ++col) {
        const oldRow = rows - 1 - row;
        t.cells[row * t.colCount + col] = oldCells[oldRow * t.colCount + col]!;
      }
    }
    const newRowHeights: number[] = [];
    for (let row = 0; row < rows; ++row) newRowHeights[row] = t.rowHeights[rows - 1 - row] ?? 0;
    t.rowHeights = newRowHeights;
  }

  t.layer = ctx.flip(t.layer);
  normalizeTable(t);

  if (!originalAngle.IsZero()) rotateTable(t, cellPosition(t.cells[0]!), originalAngle);

  const newBBox = tableBBox(t);
  const move = { x: targetPos.x - newBBox.x, y: targetPos.y - newBBox.y };
  for (const cell of t.cells) moveCell(cell, move);

  let localWidth = 0;
  for (let col = 0; col < t.colCount; ++col) localWidth += t.colWidths[col] ?? 0;

  let localHeight = 0;
  for (let row = 0; row < rows; ++row) localHeight += t.rowHeights[row] ?? 0;

  const isNowOnFrontSide = isFrontLayerId(t.layer);

  let translation: Vec2 = { x: 0, y: 0 };

  if (dir === FLIP_DIRECTION.TOP_BOTTOM) translation = { x: 0, y: -localHeight };
  else translation = { x: isNowOnFrontSide ? localWidth : -localWidth, y: 0 };

  translation = RotatePoint(translation, originalAngle);

  for (const cell of t.cells) moveCell(cell, translation);
}

/** `IsFrontLayer` (layer_ids.h:781). */
const isFrontLayerId = (l: number): boolean =>
  l === F_Cu ||
  l === F_Adhes ||
  l === F_Paste ||
  l === F_SilkS ||
  l === F_Mask ||
  l === F_CrtYd ||
  l === F_Fab;

// ---------------------------------------------------------------------------
// FOOTPRINT
// ---------------------------------------------------------------------------

/**
 * `FOOTPRINT::SetOrientation( aNewAngle )` (footprint.cpp:3101). The
 * relative children keep their file coordinates; the absolute ones rotate
 * about the footprint position by the change.
 */
export function footprintSetOrientation(k: KFootprint, aNewAngle: number): void {
  const angleChange = deg(aNewAngle).sub(deg(k.orientation)); // change in rotation

  k.orientation = deg(aNewAngle).Normalize180().AsDegrees();

  const rotationCenter = k.at;

  for (const field of k.fields) rotateFpText(field, angleChange);
  for (const pad of k.pads) rotatePad(pad, angleChange);
  for (const zone of k.zones) rotateZone(zone, rotationCenter, angleChange);

  for (const item of k.graphicalItems) {
    switch (item.kind) {
      case 'text':
        rotateFpText(item.item, angleChange);
        break;
      case 'dimension':
        rotateDimension(item.item, rotationCenter, angleChange);
        break;
      case 'image':
        rotateImage(item.item, rotationCenter, angleChange);
        break;
      case 'barcode':
        rotateBarcode(item.item, rotationCenter, angleChange);
        break;
      // A shape, a text box and a table are footprint-relative in the file.
      default:
        break;
    }
  }

  for (const point of k.points) point.pos = rotated(point.pos, rotationCenter, angleChange);
}

/** `FOOTPRINT::Rotate( aRotCentre, aAngle )` (footprint.cpp:2900). */
export function footprintRotate(k: KFootprint, aRotCentre: Vec2, aAngle: number): void {
  const angle = deg(aAngle);
  if (angle.IsZero()) return;

  const newOrientation = deg(k.orientation).add(angle);
  k.at = rotated(k.at, aRotCentre, angle);
  footprintSetOrientation(k, newOrientation.AsDegrees());

  for (const field of k.fields) keepUpright(field);

  for (const item of k.graphicalItems) if (item.kind === 'text') keepUpright(item.item);
}

/** `FOOTPRINT::Flip( aCentre, aFlipDirection )` (footprint.cpp:2932). */
export function footprintFlip(
  k: KFootprint,
  aCentre: Vec2,
  aFlipDirection: FLIP_DIRECTION,
  board: FlipBoard,
): void {
  const ctx = ctxOf(board);

  // Move footprint to its final position: mirror the Y position (around the X axis)
  k.at = mirrored(k.at, aCentre, FLIP_DIRECTION.TOP_BOTTOM);

  // Flip layer
  k.layer = ctx.flip(k.layer);

  // Calculate the new orientation, and then clear it for pad flipping.
  const newOrientation = deg(-k.orientation).Normalize180();
  k.orientation = 0;

  // Mirror fields to other side of board.
  for (const field of k.fields) flipFpText(field, FLIP_DIRECTION.TOP_BOTTOM, ctx);

  // Mirror pads to other side of board.
  for (const pad of k.pads) flipPad(pad, FLIP_DIRECTION.TOP_BOTTOM, ctx);

  // Now set the new orientation.
  k.orientation = newOrientation.AsDegrees();

  // Mirror zones to other side of board.
  for (const zone of k.zones) flipZone(zone, k.at, FLIP_DIRECTION.TOP_BOTTOM, ctx);

  // Reverse mirror footprint graphics and texts.
  for (const item of k.graphicalItems) {
    switch (item.kind) {
      case 'shape':
        flipFpShape(item.item, FLIP_DIRECTION.TOP_BOTTOM, ctx);
        break;
      case 'text':
        flipFpText(item.item, FLIP_DIRECTION.TOP_BOTTOM, ctx);
        break;
      case 'textbox':
        flipTextBoxAbout(item.item, { x: 0, y: 0 }, FLIP_DIRECTION.TOP_BOTTOM, ctx);
        break;
      case 'table':
        flipTable(item.item, { x: 0, y: 0 }, FLIP_DIRECTION.TOP_BOTTOM, ctx);
        break;
      case 'image':
        flipImage(item.item, k.at, FLIP_DIRECTION.TOP_BOTTOM, ctx);
        break;
      case 'barcode':
        flipBarcode(item.item, k.at, FLIP_DIRECTION.TOP_BOTTOM, ctx);
        break;
      case 'dimension':
        flipDimension(item.item, k.at, FLIP_DIRECTION.TOP_BOTTOM, ctx);
        break;
    }
  }

  // Points move but don't flip layer — the comment upstream; `PCB_POINT::Flip`
  // (pcb_point.cpp:140) mirrors and flips the layer, and it is what runs.
  for (const point of k.points) {
    point.pos = mirrored(point.pos, k.at, FLIP_DIRECTION.TOP_BOTTOM);
    point.layer = ctx.flip(point.layer);
  }

  // Now rotate 180 deg if required
  if (aFlipDirection === FLIP_DIRECTION.LEFT_RIGHT) footprintRotate(k, aCentre, 180);
}

/**
 * The clone `PCB_IO_KICAD_SEXPR::FootprintSave` formats (pcb_io_kicad_sexpr.cpp:3450):
 *
 *     footprint->SetOrientation( ANGLE_0 );
 *     if( footprint->GetLayer() != F_Cu )
 *         footprint->Flip( footprint->GetPosition(), cfg->m_FlipDirection );
 *     footprint->SetParent( nullptr ); footprint->SetParentGroup( nullptr );
 *     footprint->ClearAllNets();
 *
 * "It's orientation should be zero and it should be on the front layer."
 * `aFlipDirection` is `PCBNEW_SETTINGS::m_FlipDirection`, the editing
 * preference; `TOP_BOTTOM` is what runs with no settings at all.
 */
export function footprintSaveClone(
  k: KFootprint,
  board: FlipBoard,
  aFlipDirection: FLIP_DIRECTION = FLIP_DIRECTION.TOP_BOTTOM,
): void {
  footprintSetOrientation(k, 0);

  if (k.layer !== F_Cu) footprintFlip(k, k.at, aFlipDirection, board);

  // ClearAllNets
  for (const pad of k.pads) pad.net = null;
  for (const zone of k.zones) zone.net = null;
  for (const item of k.graphicalItems) if (item.kind === 'shape') item.item.net = null;
}
