// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rotate / mirror command for placed symbols.
 *
 * Grounded in KiCad's SCH_SYMBOL::Rotate / MirrorHorizontally / MirrorVertically:
 *  - the symbol's orientation (angle + mirror) is advanced via the same transform
 *    algebra KiCad uses (see geom/transform.ts);
 *  - the symbol's position is rotated/mirrored about a center point;
 *  - fields are *translated* by the symbol's position delta (they do not spin),
 *    keeping their offset from the symbol and staying readable.
 *
 * The center is captured at construction so undo is exact (the inverse op about the
 * same center restores positions and fields). Rotation's inverse is the opposite
 * spin; a mirror is its own inverse.
 */

import type {
  Schematic,
  SchSymbol,
  SchField,
  SchDirectiveLabel,
  SchImage,
  SchLabel,
  SchSheet,
  SchTable,
  SheetPin,
  LibGraphic,
  LibSymbol,
  TextEffects,
  Vec2,
} from '../types.js';
import { rotateOrientation, mirrorOrientation } from '@ziroeda/common/src/transform.js';
import { nearestHalfGridPosition } from '@ziroeda/common/src/eda_draw_frame.js';
import { CalcArcCenter } from '@ziroeda/kimath/src/trigo.js';
import { fieldId, refId, sheetPinId } from './hittest.js';
import { alignBoxes, type ItemBox } from './sch_align_tool.js';
import { normalizeTable } from './table_layout.js';
import { angleOfSide, constrainOnEdge, sideOfAngle, type SheetEdge } from './sch_sheet_pin_tool.js';
import { hasCellSelection, promoteCellSelection } from './table_cells.js';
import type { EditCommand } from './command.js';

/**
 * The schematic's default grid step, 50 mil, which is what
 * `GetNearestHalfGridPosition` halves when no caller says otherwise. The live
 * grid is a per-window setting (`es.window.grid`), so the editor passes its own.
 */
export const DEFAULT_GRID_IU = 12700; // 1.27 mm = 50 mil, in schematic IU (100 nm)

export type TransformOp = 'rotateCW' | 'rotateCCW' | 'mirrorX' | 'mirrorY';

const INVERSE: Record<TransformOp, TransformOp> = {
  rotateCW: 'rotateCCW',
  rotateCCW: 'rotateCW',
  mirrorX: 'mirrorX',
  mirrorY: 'mirrorY',
};

/** Rotate a point 90° about a center (CCW unless `cw`), KiCad's RotatePoint. */
function rotatePoint(p: Vec2, c: Vec2, cw: boolean): Vec2 {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  // Screen space is +Y-down: CCW (mathematical) is (x,y) -> (y, -x).
  return cw ? { x: c.x - dy, y: c.y + dx } : { x: c.x + dy, y: c.y - dx };
}

/** Apply the same rigid rotation/mirror that moves the body to an arbitrary point. */
function movePoint(p: Vec2, op: TransformOp, center: Vec2): Vec2 {
  if (op === 'rotateCW' || op === 'rotateCCW') return rotatePoint(p, center, op === 'rotateCW');
  if (op === 'mirrorX') return { x: p.x, y: 2 * center.y - p.y }; // flip Y
  return { x: 2 * center.x - p.x, y: p.y }; // mirrorY: flip X
}

/**
 * Rotate / mirror one symbol about `center`, body and fields together.
 *
 * Exported because a symbol attached to the cursor turns the same way a placed
 * one does: Place Next Symbol Unit carries a copy of an existing symbol, so R /
 * X / Y during that placement must spin the copy's fields with it rather than
 * reset it to a library-default orientation.
 */
export function transformSymbol(s: SchSymbol, op: TransformOp, center: Vec2): SchSymbol {
  const at = movePoint(s.at, op, center);
  const orient =
    op === 'rotateCW'
      ? rotateOrientation({ angle: s.angle, mirror: s.mirror }, true)
      : op === 'rotateCCW'
        ? rotateOrientation({ angle: s.angle, mirror: s.mirror }, false)
        : op === 'mirrorX'
          ? mirrorOrientation({ angle: s.angle, mirror: s.mirror }, 'x')
          : mirrorOrientation({ angle: s.angle, mirror: s.mirror }, 'y');

  // `SCH_SYMBOL::Rotate` (sch_symbol.cpp:2837), `::MirrorHorizontally` (:2801) and
  // `::MirrorVertically` (:2819) all transform `m_pos` alone and then *translate*
  // each field by the symbol's own delta ("move the fields to the new position
  // because the symbol itself has moved"). The fields do not orbit the centre.
  //
  // The consequence upstream intends: rotating a single symbol turns it about its
  // own position, so the delta is zero and the fields do not move at all — the
  // reference stays on the side of the body the user put it on, turn after turn.
  const dx = at.x - s.at.x;
  const dy = at.y - s.at.y;
  const fields =
    dx === 0 && dy === 0
      ? s.fields
      : s.fields.map((f: SchField) =>
          f.at ? { ...f, at: { x: f.at.x + dx, y: f.at.y + dy } } : f,
        );
  const next: { -readonly [K in keyof SchSymbol]: SchSymbol[K] } = {
    ...s,
    at,
    angle: orient.angle,
    fields,
  };
  if (orient.mirror) next.mirror = orient.mirror;
  else delete next.mirror;
  return next;
}

/**
 * `EDA_TEXT::FlipHJustify`: swap left and right, leaving centre alone.
 *
 * Centre is deliberately untouched — upstream tests the two outer cases and
 * falls through on anything else, so a centred label stays centred through any
 * number of rotations.
 */
export function flipHJustify(
  justify: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!justify) return justify;
  if (!justify.includes('left') && !justify.includes('right')) return justify;
  return justify.map((t) => (t === 'left' ? 'right' : t === 'right' ? 'left' : t));
}

/**
 * The minimum a rotation needs. Labels, directive labels and free text are
 * separate types in the model but share exactly this, and the rule reads
 * nothing else.
 */
interface TextLike {
  readonly angle: number;
  readonly effects?: TextEffects;
}

/** Schematic text is only ever horizontal or vertical; the other two directions
 *  come from the horizontal justify, which is why rotation flips it. */
const isVertical = (angle: number): boolean => angle === 90;

/**
 * `SCH_TEXT::Rotate90`.
 *
 * Not a position change: a label rotates *in place*, about itself. Which way it
 * ends up facing is carried by the angle (0 or 90) together with the horizontal
 * justify, and that pair is what `labelSpin` reads back as a SPIN_STYLE. So one
 * quarter turn toggles the angle, and flips the justify on exactly one of the
 * two half-turns — otherwise four rotations would not return the label to where
 * it started.
 */
export function rotateText90<T extends TextLike>(item: T, clockwise: boolean): T {
  const vertical = isVertical(item.angle);
  const flip = (!vertical && clockwise) || (vertical && !clockwise);
  const effects = flip
    ? { ...(item.effects ?? { hidden: false }), justify: flipHJustify(item.effects?.justify) }
    : item.effects;
  return { ...item, angle: vertical ? 0 : 90, effects } as T;
}

/**
 * `SCH_TEXT::MirrorSpinStyle`: the same justify flip without the angle change.
 *
 * `leftRight` is upstream's `!vertical` — true for the Mirror **Horizontally**
 * command, false for Mirror Vertically. Note that this is not the name of our
 * op: our `mirrorY` is Mirror Horizontally (it flips X). See `isLeftRight`.
 */
export function mirrorTextSpin<T extends TextLike>(item: T, leftRight: boolean): T {
  const vertical = isVertical(item.angle);
  if (!((!vertical && leftRight) || (vertical && !leftRight))) return item;
  return {
    ...item,
    effects: {
      ...(item.effects ?? { hidden: false }),
      justify: flipHJustify(item.effects?.justify),
    },
  } as T;
}

/**
 * `EDA_TEXT::FlipHJustify` on an item's effects, leaving the item alone when
 * there is nothing to swap — so a text box with no `(justify …)` does not gain
 * an empty `(effects …)` node on the way through a mirror.
 */
function flipEffectsHJustify<T extends { readonly effects?: TextEffects }>(item: T): T {
  const justify = flipHJustify(item.effects?.justify);
  if (justify === item.effects?.justify) return item;
  return { ...item, effects: { ...(item.effects ?? { hidden: false }), justify } };
}

/**
 * Which of our two mirror ops is the *left-right* one.
 *
 * `SCH_EDIT_TOOL::Mirror` reads `vertical = event matches mirrorV` and passes
 * `MirrorSpinStyle( !vertical )` (sch_edit_tool.cpp:1341). Our `mirrorX` is the
 * mirrorV command (SchematicEditor.tsx:5278 maps mirrorV → 'mirrorX'; it flips Y
 * and sets SYM_MIRROR_X), so `mirrorY` — the mirrorH command — is the left-right
 * one. The call site used to pass `op === 'mirrorX'`, i.e. exactly backwards:
 * mirroring a horizontal label with X did nothing and with Y flipped it.
 */
const isLeftRight = (op: TransformOp): boolean => op === 'mirrorY';

/** Apply one op to a text-like item, in place. */
function transformTextItem<T extends TextLike>(item: T, op: TransformOp): T {
  if (op === 'rotateCW') return rotateText90(item, true);
  if (op === 'rotateCCW') return rotateText90(item, false);
  return mirrorTextSpin(item, isLeftRight(op));
}

/**
 * `SCH_DIRECTIVE_LABEL::MirrorSpinStyle` (sch_label.cpp:1745), which runs the
 * whole rule at the *opposite* handedness to a plain label: "the text is in fact
 * a graphic shape … so the mirroring is not exactly similar to a SCH_TEXT item",
 * hence `SCH_TEXT::MirrorSpinStyle( !aLeftRight )`.
 *
 * Upstream carries a label's spin as (text angle 0|90) + horizontal justify, so
 * the spin flip lands on the justify. A `SchDirectiveLabel` has no justify of its
 * own: its spin is the whole file angle, 0/90/180/270, which `spinOfAngle` reads
 * back and `directiveGraphic` points the stick with. The same flip is therefore a
 * half turn here — RIGHT↔LEFT is 0↔180, UP↔BOTTOM is 90↔270. Sharing the label
 * path meant a mirror only ever fabricated an empty `effects` on it, and the flag
 * kept pointing the way it did before.
 *
 * The fields then flip their horizontal justify and mirror about the label's own
 * anchor along the mirror axis — that half keys off `aLeftRight` undoubled.
 */
export function mirrorDirectiveLabel(d: SchDirectiveLabel, leftRight: boolean): SchDirectiveLabel {
  const a = ((d.angle % 360) + 360) % 360;
  const vertical = a === 90 || a === 270;
  // SCH_TEXT::MirrorSpinStyle( !aLeftRight ): flip a horizontal spin on the
  // up-down mirror and a vertical one on the left-right mirror, not the reverse.
  const angle = (vertical ? leftRight : !leftRight) ? (a + 180) % 360 : a;
  const fields = d.fields.map((f: SchField) => {
    const next: { -readonly [K in keyof SchField]: SchField[K] } = { ...f };
    if ((leftRight && !isVertical(f.angle)) || (!leftRight && isVertical(f.angle))) {
      next.effects = {
        ...(f.effects ?? { hidden: false }),
        justify: directiveFieldJustify(f.effects?.justify),
      };
    }
    if (f.at) {
      next.at = leftRight
        ? { x: 2 * d.at.x - f.at.x, y: f.at.y }
        : { x: f.at.x, y: 2 * d.at.y - f.at.y };
    }
    return next;
  });
  return { ...d, angle, fields };
}

/**
 * The field rule inside `SCH_DIRECTIVE_LABEL::MirrorSpinStyle`: LEFT becomes
 * RIGHT and *anything else* — centre included — becomes LEFT. Upstream's `else`
 * arm is unconditional here, unlike `EDA_TEXT::FlipHJustify`'s two-sided swap,
 * so this deliberately is not `flipHJustify`.
 */
function directiveFieldJustify(justify: readonly string[] | undefined): readonly string[] {
  const to = justify?.includes('left') ? 'right' : 'left';
  const rest = (justify ?? []).filter((t) => t !== 'left' && t !== 'right' && t !== 'center');
  return [to, ...rest];
}

/** Rotate shares the label path; only the mirror is a directive label's own. */
function transformDirectiveLabel(d: SchDirectiveLabel, op: TransformOp): SchDirectiveLabel {
  if (op === 'rotateCW') return rotateText90(d, true);
  if (op === 'rotateCCW') return rotateText90(d, false);
  return mirrorDirectiveLabel(d, isLeftRight(op));
}

/**
 * One shape, every point that defines it (`SCH_SHAPE::Rotate`).
 *
 * A circle keeps its radius and only its centre moves; an arc carries its mid
 * point so the bulge survives; the rest are point lists.
 */
function transformGraphic(g: LibGraphic, op: TransformOp, center: Vec2): LibGraphic {
  switch (g.kind) {
    case 'rectangle': {
      const a = movePoint(g.start, op, center);
      const b = movePoint(g.end, op, center);
      return {
        ...g,
        start: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
        end: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
      };
    }
    case 'circle':
      return { ...g, center: movePoint(g.center, op, center) };
    case 'arc':
      return {
        ...g,
        start: movePoint(g.start, op, center),
        mid: movePoint(g.mid, op, center),
        end: movePoint(g.end, op, center),
      };
    case 'polyline':
    case 'bezier':
      return { ...g, points: g.points.map((p) => movePoint(p, op, center)) };
    case 'text':
      return { ...g, at: movePoint(g.at, op, center) };
    default:
      return g;
  }
}

/**
 * `SELECTION::GetCenter` (common/tool/selection.cpp:92), which we got wrong
 * three ways at once.
 *
 *  - the boxes merged are each item's **`GetBoundingBox()`**, not its anchor
 *    point. A wire pair whose anchors happen to coincide has a real extent;
 *  - `SCH_TEXT_T` and `SCH_LABEL_LOCATE_ANY_T` are **excluded** from the merge,
 *    with the reason spelled out upstream: "otherwise rotating the selection
 *    will also translate it". A label's box is wide and lopsided, so counting
 *    it drags the whole group sideways on every turn;
 *  - when the selection is *nothing but* text the box is not used at all and
 *    the centre is the mean of the items' own positions.
 *
 * The result is then snapped by the caller — see `transformCenter`.
 *
 * Our `label` kind covers SCH_TEXT and every SCH_LABEL_BASE except the
 * directive, and `directive` is the last of them, so those two are the excluded
 * set. A text *box* is SCH_TEXTBOX_T and is deliberately not excluded.
 */
function selectionCenter(boxes: readonly ItemBox[]): Vec2 {
  const isText = (b: ItemBox): boolean => b.kind === 'label' || b.kind === 'directive';
  if (boxes.every(isText)) {
    // `center += item->GetPosition(); center = center / size` on VECTOR2I, so
    // the division truncates toward zero rather than rounding.
    let x = 0;
    let y = 0;
    for (const b of boxes) {
      x += b.anchor.x;
      y += b.anchor.y;
    }
    return { x: Math.trunc(x / boxes.length), y: Math.trunc(y / boxes.length) };
  }
  const merged = boxes.filter((b) => !isText(b));
  const minX = Math.min(...merged.map((b) => b.box.minX));
  const maxX = Math.max(...merged.map((b) => b.box.maxX));
  const minY = Math.min(...merged.map((b) => b.box.minY));
  const maxY = Math.max(...merged.map((b) => b.box.maxY));
  // BOX2I::GetCenter is GetOrigin() + GetSize() / 2 on integers, so it too
  // truncates rather than rounding.
  return { x: minX + Math.trunc((maxX - minX) / 2), y: minY + Math.trunc((maxY - minY) / 2) };
}

/** The `LibGraphic` a graphic selection id names. */
function graphicById(doc: Schematic, id: string): LibGraphic | undefined {
  const i = doc.graphics.findIndex((_g, k) => refId('graphic', undefined, k) === id);
  return i < 0 ? undefined : doc.graphics[i];
}

/** The `SchSheet` a sheet selection id names. */
function sheetById(doc: Schematic, id: string): SchSheet | undefined {
  const i = doc.sheets.findIndex((sh, k) => refId('sheet', sh.uuid, k) === id);
  return i < 0 ? undefined : doc.sheets[i];
}

/**
 * `EDA_ITEM::GetPosition()` for one selected item — the anchor a single-item
 * mirror turns about (`sch_edit_tool.cpp:1404`).
 *
 * `alignBoxes` already carries each kind's anchor and it is upstream's
 * `GetPosition()` in every case but one: `EDA_SHAPE::getPosition`
 * (eda_shape.cpp:432) answers an arc with its *computed centre*, not with its
 * first stored point.
 */
function itemPosition(doc: Schematic, b: ItemBox): Vec2 {
  if (b.kind === 'graphic') {
    const g = graphicById(doc, b.id);
    if (g?.kind === 'arc') {
      const c = CalcArcCenter(g.start, g.mid, g.end);
      return { x: Math.round(c.x), y: Math.round(c.y) };
    }
  }
  return b.anchor;
}

/** BOX2I::GetCenter, which truncates toward zero on integers. */
const boxCenter = (b: ItemBox['box']): Vec2 => ({
  x: b.minX + Math.trunc((b.maxX - b.minX) / 2),
  y: b.minY + Math.trunc((b.maxY - b.minY) / 2),
});

/** A sheet's body rectangle, `BOX2I( m_pos, m_size )`. */
const sheetBodyCenter = (sh: SchSheet): Vec2 => ({
  x: sh.at.x + Math.trunc(sh.size.w / 2),
  y: sh.at.y + Math.trunc(sh.size.h / 2),
});

/** `SCH_TABLE::GetCenter` (sch_table.cpp:124): the box over every cell corner. */
function tableCenter(t: SchTable): Vec2 {
  const xs = t.cells.flatMap((c) => [c.start.x, c.end.x]);
  const ys = t.cells.flatMap((c) => [c.start.y, c.end.y]);
  if (xs.length === 0) return { x: 0, y: 0 };
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX + Math.trunc((maxX - minX) / 2), y: minY + Math.trunc((maxY - minY) / 2) };
}

/**
 * The point a transform turns about.
 *
 * Upstream has two entirely separate answers and we only ever had the second.
 *
 * **One item** (`sch_edit_tool.cpp:1004-1010` for rotate, `:1404` for mirror):
 * a connectable item turns about its own `GetPosition()`, anything else about
 * the half-grid-snapped centre of its bounding box; then several types override
 * that in their own `case`. A `SCH_LINE` is the loud one — it rotates about
 * whichever endpoint is *not* selected, and with both flags set that is the end
 * point (`:1064-1077`), so a wire pivots on one end rather than on its middle.
 * A mirror ignores all of it and uses `GetPosition()` for everything except a
 * sheet.
 *
 * **More than one** (`:1171`, `:1417`): `GetNearestHalfGridPosition(
 * selection.GetCenter() )`. Missing that snap is what left a rotated group half
 * a grid step off, so its wires no longer met the pins they were drawn to.
 */
function transformCenter(
  doc: Schematic,
  op: TransformOp,
  boxes: readonly ItemBox[],
  singleId: string | undefined,
  grid: number,
): Vec2 {
  const snapHalf = (p: Vec2): Vec2 => nearestHalfGridPosition(p, grid);
  const one = singleId === undefined ? undefined : boxes.find((b) => b.id === singleId);

  if (one) {
    if (op === 'mirrorX' || op === 'mirrorY') {
      // "Mirror the sheet on itself. Sheets do not have a anchor point."
      // (The bounding box upstream merges here is the body plus the sheet's
      // field boxes; we measure the body alone, which we do not draw fields
      // outside of.)
      if (one.kind === 'sheet') {
        const sh = sheetById(doc, one.id);
        return sh ? snapHalf(sheetBodyCenter(sh)) : snapHalf(boxCenter(one.box));
      }
      return itemPosition(doc, one);
    }
    switch (one.kind) {
      case 'line': {
        // `if( line->HasFlag( STARTPOINT ) ) rotPoint = line->GetEndPoint();`
        // — undo leaves both flags clear, so the tool sets both, and the first
        // arm wins. A lone wire pivots on its end point.
        const i = doc.lines.findIndex((l, k) => refId('line', l.uuid, k) === one.id);
        return i < 0 ? one.anchor : doc.lines[i]!.end;
      }
      case 'sheet': {
        // `GetNearestHalfGridPosition( sheet->GetRotationCenter() )`, and
        // GetRotationCenter is `BOX2I( m_pos, m_size ).GetCenter()`.
        const sh = sheetById(doc, one.id);
        return sh ? snapHalf(sheetBodyCenter(sh)) : snapHalf(boxCenter(one.box));
      }
      case 'table': {
        const t = doc.tables.find((tt, k) => refId('table', tt.uuid, k) === one.id);
        return t ? snapHalf(tableCenter(t)) : snapHalf(boxCenter(one.box));
      }
      default:
        // Connectable items rotate about their anchor; everything else about
        // the snapped centre of its box.
        return one.connectable ? itemPosition(doc, one) : snapHalf(boxCenter(one.box));
    }
  }

  if (boxes.length === 0) return { x: 0, y: 0 };
  return snapHalf(selectionCenter(boxes));
}

/**
 * `SCH_SHEET_PIN::Rotate` (sch_sheet_pin.cpp:250) and `::MirrorVertically` /
 * `::MirrorHorizontally` (:220/:235).
 *
 * A sheet pin cannot leave its sheet's border, so it is not moved by the rigid
 * transform at all: it is rotated, dropped back onto whichever edge is nearest
 * through `ConstrainOnEdge`, and then — because that alone would pile every pin
 * at a corner — mirrored back along the edge it landed on. Which mirror depends
 * on how far it turned: the same side re-mirrors about the centre, the opposite
 * side keeps its offset.
 *
 * `sheet` must already be the *transformed* sheet: `ConstrainOnEdge` measures
 * against the rectangle, and upstream updates `m_pos`/`m_size` before the pin
 * loop for exactly that reason.
 */
function transformSheetPin(
  pin: SheetPin,
  sheet: SchSheet,
  op: TransformOp,
  center: Vec2,
): SheetPin {
  const OPPOSITE: Record<SheetEdge, SheetEdge> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  };
  const side = sideOfAngle(pin.angle);

  if (op === 'mirrorX') {
    // MirrorVertically: the y mirrors, TOP and BOTTOM swap, and `SetSide` then
    // plants the pin on that edge of the (already mirrored) sheet.
    const flipped = side === 'top' || side === 'bottom' ? OPPOSITE[side] : side;
    const y =
      flipped === 'top'
        ? sheet.at.y
        : flipped === 'bottom'
          ? sheet.at.y + sheet.size.h
          : 2 * center.y - pin.at.y;
    return { ...pin, at: { x: pin.at.x, y }, angle: angleOfSide(flipped) };
  }
  if (op === 'mirrorY') {
    const flipped = side === 'left' || side === 'right' ? OPPOSITE[side] : side;
    const x =
      flipped === 'left'
        ? sheet.at.x
        : flipped === 'right'
          ? sheet.at.x + sheet.size.w
          : 2 * center.x - pin.at.x;
    return { ...pin, at: { x, y: pin.at.y }, angle: angleOfSide(flipped) };
  }

  const delta = { x: pin.at.x - center.x, y: pin.at.y - center.y };
  const moved = constrainOnEdge(sheet, pin, movePoint(pin.at, op, center), true);
  const to = sideOfAngle(moved.angle);
  const vertical = to === 'top' || to === 'bottom';
  if (to === side) {
    return vertical
      ? { ...moved, at: { x: center.x - delta.x, y: moved.at.y } }
      : { ...moved, at: { x: moved.at.x, y: center.y - delta.y } };
  }
  if (to === OPPOSITE[side]) {
    return vertical
      ? { ...moved, at: { x: center.x + delta.x, y: moved.at.y } }
      : { ...moved, at: { x: moved.at.x, y: center.y + delta.y } };
  }
  return moved;
}

/**
 * `SCH_SHEET::Rotate` (sch_sheet.cpp:1070), `::MirrorVertically` (:1112) and
 * `::MirrorHorizontally` (:1132). R, X and Y did nothing at all to a sheet
 * before this, although a sheet has always been selectable.
 *
 * A sheet is an axis-aligned rectangle, so the rotation turns the *size vector*
 * as well as the position and then re-normalises a negative extent back onto
 * the anchor. Mirroring keeps the size and slides the anchor to the far corner.
 *
 * The `AUTOPLACE_AUTO`/`AUTOPLACE_MANUAL` arm re-runs `AutoplaceFields`; we do
 * not model that state (audit finding 11), so this is always the else arm —
 * "Move the fields to the new position because the parent itself has moved".
 */
function transformSheet(sh: SchSheet, op: TransformOp, center: Vec2): SchSheet {
  let at: Vec2;
  let size = sh.size;

  if (op === 'rotateCW' || op === 'rotateCCW') {
    at = movePoint(sh.at, op, center);
    // `RotatePoint( &m_size.x, &m_size.y, … )` turns the extent as a free
    // vector, about the origin rather than about the centre.
    const v = movePoint({ x: sh.size.w, y: sh.size.h }, op, { x: 0, y: 0 });
    let w = v.x;
    let h = v.y;
    if (w < 0) {
      at = { x: at.x + w, y: at.y };
      w = -w;
    }
    if (h < 0) {
      at = { x: at.x, y: at.y + h };
      h = -h;
    }
    size = { w, h };
  } else if (op === 'mirrorX') {
    // `MIRROR( m_pos.y, aCenter ); m_pos.y -= m_size.y;`
    at = { x: sh.at.x, y: 2 * center.y - sh.at.y - sh.size.h };
  } else {
    at = { x: 2 * center.x - sh.at.x - sh.size.w, y: sh.at.y };
  }

  const moved: SchSheet = { ...sh, at, size };
  // "Pins must be rotated first as that's how we determine vertical vs
  // horizontal orientation for auto-placement."
  const pins = sh.pins.map((p) => transformSheetPin(p, moved, op, center));
  const dx = at.x - sh.at.x;
  const dy = at.y - sh.at.y;
  const fields =
    dx === 0 && dy === 0
      ? sh.fields
      : sh.fields.map((f) => (f.at ? { ...f, at: { x: f.at.x + dx, y: f.at.y + dy } } : f));
  return { ...moved, pins, fields };
}

/**
 * `SCH_TABLE::Rotate` (sch_table.cpp:226): turn every cell, then `Normalize()`.
 *
 * Mirroring is deliberately a no-op upstream — "We could mirror all the cells,
 * but it doesn't seem useful...." (:213/:219) — and stays one here.
 *
 * `compensate` is the `Move` that follows the rotation in both call sites: a
 * table has no anchor point, so the rotation is allowed to put it wherever the
 * grid re-layout lands and the table is then slid back onto the centre the
 * rotation was supposed to give it (`sch_edit_tool.cpp:1127` for one item,
 * `:1226` for a group).
 */
function transformTable(
  t: SchTable,
  op: TransformOp,
  center: Vec2,
  compensate: (before: Vec2, after: Vec2) => Vec2,
): SchTable {
  if (op === 'mirrorX' || op === 'mirrorY') return t;
  const before = tableCenter(t);
  const turned = normalizeTable({
    ...t,
    cells: t.cells.map((c) => ({
      ...c,
      start: movePoint(c.start, op, center),
      end: movePoint(c.end, op, center),
      // `SCH_TEXTBOX::Rotate` toggles the text angle (sch_textbox.cpp:142).
      angle: (c.angle ?? 0) === 90 ? 0 : 90,
    })),
  });
  const d = compensate(before, tableCenter(turned));
  if (d.x === 0 && d.y === 0) return turned;
  return {
    ...turned,
    cells: turned.cells.map((c) => ({
      ...c,
      start: { x: c.start.x + d.x, y: c.start.y + d.y },
      end: { x: c.end.x + d.x, y: c.end.y + d.y },
    })),
  };
}

/**
 * `SCH_BITMAP::Rotate` / `::MirrorVertically` / `::MirrorHorizontally`
 * (sch_bitmap.cpp:135/123/129), which delegate to `REFERENCE_IMAGE::Rotate` and
 * `::Flip` (common/reference_image.cpp:283/268).
 *
 * Only the geometric half is portable. Upstream also turns the *pixels*:
 * `BITMAP_BASE::Rotate`/`::Mirror` (bitmap_base.cpp:514/497) rewrite the
 * wxImage and clear the cached PNG bytes, so the file is written out
 * re-encoded — there is no rotation token in `(image …)` to carry it. Doing the
 * same here means decoding and re-encoding a PNG inside a synchronous, pure
 * `EditCommand`, which is its own change; until then a lone image barely moves
 * on R (its rotation centre is its own snapped centre) while a group rotate
 * does carry it round correctly.
 */
const transformImage = (im: SchImage, op: TransformOp, center: Vec2): SchImage => ({
  ...im,
  at: movePoint(im.at, op, center),
});

/**
 * A label, a hierarchical/global label or a free text inside a *group*
 * transform: `SCH_TEXT::Rotate` (sch_text.cpp:201), `SCH_LABEL_BASE::Rotate`
 * (sch_label.cpp:483) and `SCH_TEXT::MirrorHorizontally` / `::MirrorVertically`
 * (:123/:162).
 *
 * These are not the functions the single-item arm calls. With one item selected
 * `SCH_EDIT_TOOL` runs `Rotate90` / `MirrorSpinStyle`, which turn the label
 * where it stands; with more than one it falls through to the generic
 * `item->Rotate( rotPoint, … )`, which *also* moves it. So a label caught in a
 * group rotate used to be the only thing left behind while everything around it
 * swung round it.
 *
 * The spin half is identical between the two — `SCH_TEXT::MirrorHorizontally`
 * flips the justify on a horizontal text exactly as `MirrorSpinStyle( true )`
 * does — so only the position is added here.
 */
function transformLabelAbout(l: SchLabel, op: TransformOp, center: Vec2): SchLabel {
  const at = movePoint(l.at, op, center);
  if (op === 'mirrorX' || op === 'mirrorY') return { ...mirrorTextSpin(l, isLeftRight(op)), at };
  // `SCH_TEXT::Rotate` spins with `Rotate90( false )` — hard-coded, not the
  // command's direction, so a group rotate turns free text the same way either
  // way round. `SCH_LABEL_BASE::Rotate` overrides it with `Rotate90( !aRotateCCW )`,
  // which is the command's direction. Our free text is the `text` kind.
  return { ...rotateText90(l, l.kind === 'text' ? false : op === 'rotateCW'), at };
}

/**
 * A directive label inside a group transform: `SCH_DIRECTIVE_LABEL::
 * MirrorHorizontally` (sch_label.cpp:1776) and `::MirrorVertically` (:1804),
 * with rotation inherited from `SCH_LABEL_BASE::Rotate`.
 *
 * The flag's spin turns the same way it does alone — `GetSpinStyle().MirrorX()`
 * swaps UP and BOTTOM on the *horizontal* mirror, which is the same inversion
 * `MirrorSpinStyle` makes — so `mirrorDirectiveLabel` still decides the angle.
 * What the group path adds, and what differs from `MirrorSpinStyle`, is the
 * position: the flag moves, and each field keeps its offset by being mirrored
 * about the flag's *old* anchor and then translated onto the new one. The
 * vertical mirror also leaves the fields' justify alone, where `MirrorSpinStyle`
 * flips it.
 */
function transformDirectiveLabelAbout(
  d: SchDirectiveLabel,
  op: TransformOp,
  center: Vec2,
): SchDirectiveLabel {
  const at = movePoint(d.at, op, center);
  const field = (f: SchField, next: SchField): SchField =>
    f.at
      ? {
          ...next,
          at:
            op === 'mirrorY' || op === 'rotateCW' || op === 'rotateCCW'
              ? { x: at.x + (d.at.x - f.at.x), y: f.at.y }
              : { x: f.at.x, y: at.y + (d.at.y - f.at.y) },
        }
      : next;

  if (op === 'mirrorY') {
    // MirrorHorizontally: the fields' horizontal justify swaps both ways
    // (`FlipHJustify`, not MirrorSpinStyle's unconditional "anything else
    // becomes LEFT"), and it swaps for every field regardless of its angle.
    return {
      ...d,
      angle: mirrorDirectiveLabel(d, true).angle,
      at,
      fields: d.fields.map((f) => field(f, flipEffectsHJustify(f))),
    };
  }
  if (op === 'mirrorX') {
    // MirrorVertically touches no justify at all.
    return {
      ...d,
      angle: mirrorDirectiveLabel(d, false).angle,
      at,
      fields: d.fields.map((f) => field(f, f)),
    };
  }
  // `SCH_LABEL_BASE::Rotate`: spin the flag, rotate each field about the flag's
  // own (old) anchor with `SCH_FIELD::Rotate`, then translate both by the
  // anchor's delta.
  const cw = op === 'rotateCW';
  const spun = rotateText90(d, cw);
  const dx = at.x - d.at.x;
  const dy = at.y - d.at.y;
  return {
    ...spun,
    at,
    fields: d.fields.map((f) => {
      const turned = rotateText90(f, cw);
      if (!f.at) return turned;
      const p = movePoint(f.at, op, d.at);
      return { ...turned, at: { x: p.x + dx, y: p.y + dy } };
    }),
  };
}

/**
 * `SCH_FIELD` alone (`sch_edit_tool.cpp:1088-1100` / `:1364-1375`).
 *
 * A selected field does **not** move: a rotate only toggles its text angle
 * between horizontal and vertical, and a mirror only flips the justify on the
 * mirrored axis. Both then set the parent's `AUTOPLACE_NONE`, which we cannot
 * record (audit finding 11).
 */
function transformField(f: SchField, op: TransformOp): SchField {
  if (op === 'rotateCW' || op === 'rotateCCW') {
    return { ...f, angle: f.angle === 90 ? 0 : 90 };
  }
  if (op === 'mirrorY') return flipEffectsHJustify(f);
  // `GetFlippedAlignment( GetVertJustify() )` on the vertical mirror.
  return flipVJustify(f);
}

/** `EDA_TEXT::FlipVJustify`'s pair: top and bottom swap, centre stays. */
function flipVJustify<T extends { readonly effects?: TextEffects }>(item: T): T {
  const justify = item.effects?.justify;
  if (!justify || (!justify.includes('top') && !justify.includes('bottom'))) return item;
  return {
    ...item,
    effects: {
      ...(item.effects ?? { hidden: false }),
      justify: justify.map((t) => (t === 'top' ? 'bottom' : t === 'bottom' ? 'top' : t)),
    },
  };
}

/**
 * Rotate or mirror every selected item about the transform centre.
 *
 * `center` may be supplied to keep undo exact; `grid` is the window's grid step,
 * which the half-grid snap of a multi-item centre is derived from.
 */
export function transformItems(
  rawIds: ReadonlySet<string>,
  op: TransformOp,
  center?: Vec2,
  grid: number = DEFAULT_GRID_IU,
): EditCommand {
  // sch_edit_tool's rotatable/mirrorable type list is annotated
  // "will be promoted to parent table(s)". A cell cannot leave its table, so a
  // selected cell stands for its table here. Done at the engine rather than at
  // each call site, so no caller can forget it.
  const ids = hasCellSelection(rawIds) ? promoteCellSelection(rawIds) : rawIds;
  return {
    label: op.startsWith('rotate') ? 'Rotate' : 'Mirror',
    apply(doc: Schematic): Schematic {
      if (ids.size === 0) return doc;
      const libById = new Map<string, LibSymbol>(doc.libSymbols.map((l) => [l.libId, l]));
      const boxes = alignBoxes(doc, ids, libById);
      // `principalItemCount == 1` / `selection.GetSize() == 1`. Fields and sheet
      // pins carry no box of their own, so they are counted off the id set.
      const single = ids.size === 1 ? [...ids][0] : undefined;
      const c = center ?? transformCenter(doc, op, boxes, single, grid);
      const snapHalf = (p: Vec2): Vec2 => nearestHalfGridPosition(p, grid);
      return {
        ...doc,
        symbols: doc.symbols.map((s, i) => {
          const id = refId('symbol', s.uuid, i);
          const turned = ids.has(id) ? transformSymbol(s, op, c) : s;
          // A field selected on its own is an item in its own right, and
          // upstream skips it when its parent is selected too ("parent will
          // rotate us").
          if (ids.has(id)) return turned;
          const fields = turned.fields.map((f, k) =>
            ids.has(fieldId(id, k)) ? transformField(f, op) : f,
          );
          return fields.some((f, k) => f !== turned.fields[k]) ? { ...turned, fields } : turned;
        }),
        // Alone, a label turns where it stands (`Rotate90` / `MirrorSpinStyle`,
        // the SCH_TEXT_T … SCH_DIRECTIVE_LABEL_T arm of the single-item
        // switch). In a group it goes through `item->Rotate( rotPoint, … )`
        // instead, which moves it as well — and it never did.
        labels: doc.labels.map((l, i) =>
          ids.has(refId('label', l.uuid, i))
            ? single !== undefined
              ? transformTextItem(l, op)
              : transformLabelAbout(l, op, c)
            : l,
        ),
        directiveLabels: doc.directiveLabels?.map((d, i) =>
          ids.has(refId('directive', d.uuid, i))
            ? single !== undefined
              ? transformDirectiveLabel(d, op)
              : transformDirectiveLabelAbout(d, op, c)
            : d,
        ),
        // The geometric kinds share one rule: move every point that defines
        // them (`head->Rotate( rotPoint, !clockwise )` and its mirror pair).
        lines: doc.lines.map((l, i) =>
          ids.has(refId('line', l.uuid, i))
            ? { ...l, start: movePoint(l.start, op, c), end: movePoint(l.end, op, c) }
            : l,
        ),
        junctions: doc.junctions.map((j, i) =>
          ids.has(refId('junction', j.uuid, i)) ? { ...j, at: movePoint(j.at, op, c) } : j,
        ),
        noConnects: doc.noConnects.map((n, i) =>
          ids.has(refId('noconnect', n.uuid, i)) ? { ...n, at: movePoint(n.at, op, c) } : n,
        ),
        // A bus entry is an anchor plus a signed extent, and the extent is the
        // stub's direction — so both ends move and the size is re-derived,
        // rather than the anchor moving and the stub still pointing its old way.
        busEntries: doc.busEntries.map((b, i) => {
          if (!ids.has(refId('busentry', b.uuid, i))) return b;
          const at = movePoint(b.at, op, c);
          const far = movePoint({ x: b.at.x + b.size.x, y: b.at.y + b.size.y }, op, c);
          return { ...b, at, size: { x: far.x - at.x, y: far.y - at.y } };
        }),
        textBoxes: doc.textBoxes.map((t, i) => {
          if (!ids.has(refId('textbox', t.uuid, i))) return t;
          const a = movePoint(t.start, op, c);
          const b = movePoint(t.end, op, c);
          // The corners may swap under a rotation or mirror; start is top-left.
          const start = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
          const end = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
          const angle = op.startsWith('rotate') ? (t.angle === 90 ? 0 : 90) : t.angle;
          // `SCH_TEXTBOX::MirrorHorizontally` / `::MirrorVertically`
          // (sch_textbox.cpp:109/124) mirror the shape and then note that "text is
          // NOT really mirrored; it just has its justification flipped" — but only
          // when the text reads *along* the mirror axis: H flips a horizontal box,
          // V flips a vertical one. Until now the corners moved and the text stayed
          // hard against the same edge, so a left-justified box mirrored into a box
          // whose text sat on the wrong side of it.
          const flipsText = op === 'mirrorY' ? t.angle === 0 : op === 'mirrorX' && t.angle === 90;
          const box = { ...t, start, end, angle };
          return flipsText ? flipEffectsHJustify(box) : box;
        }),
        graphics: doc.graphics.map((g, i) =>
          ids.has(refId('graphic', undefined, i)) ? transformGraphic(g, op, c) : g,
        ),
        // A sheet, an image and a table were all selectable and all silently
        // ignored: R, X and Y did nothing whatever to them.
        sheets: doc.sheets.map((sh, i) => {
          const id = refId('sheet', sh.uuid, i);
          if (ids.has(id)) return transformSheet(sh, op, c);
          // A sheet pin selected without its parent turns within the sheet,
          // about the sheet's own body centre rather than about the selection
          // ("rotate within parent", sch_edit_tool.cpp:1200 / :1425).
          const own = sheetBodyCenter(sh);
          const pins = sh.pins.map((p, k) =>
            ids.has(sheetPinId(id, k)) ? transformSheetPin(p, sh, op, own) : p,
          );
          return pins.some((p, k) => p !== sh.pins[k]) ? { ...sh, pins } : sh;
        }),
        images: doc.images.map((im, i) =>
          ids.has(refId('image', im.uuid, i))
            ? // `head->Rotate( rotPoint, clockwise )` — the one type in the
              // single-item switch whose direction is *not* negated
              // (sch_edit_tool.cpp:1140).
              transformImage(im, single !== undefined ? INVERSE[op] : op, c)
            : im,
        ),
        tables: doc.tables.map((t, i) =>
          ids.has(refId('table', t.uuid, i))
            ? transformTable(t, op, c, (before, after) =>
                single !== undefined
                  ? { x: c.x - snapHalf(after).x, y: c.y - snapHalf(after).y }
                  : (() => {
                      const want = movePoint(before, op, c);
                      return { x: want.x - after.x, y: want.y - after.y };
                    })(),
              )
            : t,
        ),
      };
    },
    invert(before: Schematic): EditCommand {
      // Reuse the same center so the inverse exactly retraces the positions.
      if (center) return transformItems(ids, INVERSE[op], center, grid);
      const libById = new Map<string, LibSymbol>(before.libSymbols.map((l) => [l.libId, l]));
      const boxes = alignBoxes(before, ids, libById);
      const single = ids.size === 1 ? [...ids][0] : undefined;
      return transformItems(
        ids,
        INVERSE[op],
        transformCenter(before, op, boxes, single, grid),
        grid,
      );
    },
  };
}
