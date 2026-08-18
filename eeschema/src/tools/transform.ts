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
  LibGraphic,
  TextEffects,
  Vec2,
} from '../types.js';
import { rotateOrientation, mirrorOrientation } from '@ziroeda/common/src/transform.js';
import { refId } from './hittest.js';
import { hasCellSelection, promoteCellSelection } from './table_cells.js';
import type { EditCommand } from './command.js';

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
 * Anchor points of everything selected, whatever kind it is.
 *
 * This used to look at symbols alone, which made the centre `{0,0}` for any
 * selection without one — so a pair of wires rotated about the page origin
 * rather than about themselves.
 */
function selectionPoints(doc: Schematic, ids: ReadonlySet<string>): Vec2[] {
  const pts: Vec2[] = [];
  doc.symbols.forEach((s, i) => {
    if (ids.has(refId('symbol', s.uuid, i))) pts.push(s.at);
  });
  doc.lines.forEach((l, i) => {
    if (ids.has(refId('line', l.uuid, i))) pts.push(l.start, l.end);
  });
  doc.junctions.forEach((j, i) => {
    if (ids.has(refId('junction', j.uuid, i))) pts.push(j.at);
  });
  doc.noConnects.forEach((n, i) => {
    if (ids.has(refId('noconnect', n.uuid, i))) pts.push(n.at);
  });
  doc.busEntries.forEach((b, i) => {
    if (ids.has(refId('busentry', b.uuid, i)))
      pts.push(b.at, { x: b.at.x + b.size.x, y: b.at.y + b.size.y });
  });
  doc.textBoxes.forEach((t, i) => {
    if (ids.has(refId('textbox', t.uuid, i))) pts.push(t.start, t.end);
  });
  doc.labels.forEach((l, i) => {
    if (ids.has(refId('label', l.uuid, i))) pts.push(l.at);
  });
  return pts;
}

/** Bounding-box center of the selection (snapped is the caller's job). */
function selectionCenter(doc: Schematic, ids: ReadonlySet<string>): Vec2 {
  const pts = selectionPoints(doc, ids);
  if (pts.length === 0) return { x: 0, y: 0 };
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  return { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) };
}

/**
 * Rotate or mirror every selected symbol about the selection center. For a single
 * symbol the center is its own position, so only its orientation changes (KiCad's
 * single-item behaviour). `center` may be supplied to keep undo exact.
 */
export function transformItems(
  rawIds: ReadonlySet<string>,
  op: TransformOp,
  center?: Vec2,
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
      const c = center ?? selectionCenter(doc, ids);
      return {
        ...doc,
        symbols: doc.symbols.map((s, i) =>
          ids.has(refId('symbol', s.uuid, i)) ? transformSymbol(s, op, c) : s,
        ),
        // Labels, hierarchical/global labels and free text all rotate in place
        // via Rotate90 / MirrorSpinStyle rather than about the selection centre
        // (SCH_EDIT_TOOL::Rotate's SCH_TEXT_T ... SCH_DIRECTIVE_LABEL_T arm).
        // Until now R, X and Y simply did nothing to any of them.
        labels: doc.labels.map((l, i) =>
          ids.has(refId('label', l.uuid, i)) ? transformTextItem(l, op) : l,
        ),
        directiveLabels: doc.directiveLabels?.map((d, i) =>
          ids.has(refId('directive', d.uuid, i)) ? transformDirectiveLabel(d, op) : d,
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
      };
    },
    invert(before: Schematic): EditCommand {
      // Reuse the same center so the inverse exactly retraces the positions.
      return transformItems(ids, INVERSE[op], center ?? selectionCenter(before, ids));
    },
  };
}
