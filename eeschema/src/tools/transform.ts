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

import type { Schematic, SchSymbol, SchField, LibGraphic, TextEffects, Vec2 } from '../types.js';
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

  // The symbol and its name fields are one rigid part: orbit each field's position
  // about the same center as the body. The field text orientation then turns with the
  // symbol via GetDrawRotation at render time, so position + text rotate together.
  const fields = s.fields.map((f: SchField) =>
    f.at ? { ...f, at: movePoint(f.at, op, center) } : f,
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
 * `leftRight` is true for a horizontal mirror (X), false for a vertical one.
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

/** Apply one op to a text-like item, in place. */
function transformTextItem<T extends TextLike>(item: T, op: TransformOp): T {
  if (op === 'rotateCW') return rotateText90(item, true);
  if (op === 'rotateCCW') return rotateText90(item, false);
  // MirrorHorizontally is the left-right one (X); MirrorVertically is not.
  return mirrorTextSpin(item, op === 'mirrorX');
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
          ids.has(refId('directive', d.uuid, i)) ? transformTextItem(d, op) : d,
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
          return { ...t, start, end, angle };
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
