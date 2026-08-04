// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Move Exactly: translate and rotate a selection by typed values.
 * Counterparts: `EDIT_TOOL::MoveExact` and `DIALOG_MOVE_EXACT`.
 *
 * The order is translate-then-rotate, and the rotation centre moves with the
 * translation. Doing it the other way round gives a different answer for any
 * non-zero rotation, which is why upstream advances `selCenter` by the
 * translation before rotating and why this does the same.
 *
 * One thing deliberately not ported: `MoveExact` contains
 *
 *     EDA_ANGLE angle = rotation;
 *     if( !…m_DisplayInvertYAxis ) rotation = -rotation;
 *     … boardItem->Rotate( …, angle );
 *
 * The negation lands on `rotation`, but every `Rotate` call uses `angle`, the
 * copy taken before it, and `rotation` is never read again — so the flip has no
 * effect on the result. The dialog's angle is applied as typed. This is noted
 * because the line looks load-bearing and is not.
 */

import {
  boardSelectionBBox,
  moveBoardItems,
  parseBoardItemId,
  rotateBoardItemsBy,
} from './edit-board.js';
import { arcCenter } from './read-board.js';
import type { Board, PcbShape } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `ROTATION_ANCHOR` (dialog_move_exact.h). */
export type RotationAnchor = 'itemAnchor' | 'selectionCenter' | 'userOrigin' | 'auxOrigin';

export interface MoveExactOptions {
  /** Translation in IU. */
  translation: Vec2;
  /** Degrees. */
  rotation?: number;
  /** What the rotation turns about; see `defaultRotationAnchor`. */
  anchor?: RotationAnchor;
  /** Required by their matching anchors; without one the rotation is skipped. */
  userOrigin?: Vec2;
  auxOrigin?: Vec2;
}

/**
 * `DIALOG_MOVE_EXACT::GetTranslationInIU` with the polar checkbox ticked: a
 * distance and a bearing become a vector.
 *
 * The y sign is *not* flipped. The dialog reads its angle in the same y-down
 * frame the board is stored in, so the plain sine is what upstream stores.
 */
export function polarTranslation(distance: number, angleDeg: number): Vec2 {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: Math.round(distance * Math.cos(rad)),
    y: Math.round(distance * Math.sin(rad)),
  };
}

/**
 * The furthest a coordinate may sit from the origin: `INT_MAX * M_SQRT1_2`,
 * about 1518 mm. The √½ is there so that a point at the corner of the legal
 * square still has a magnitude an int can hold.
 */
export const MAX_BOARD_COORD = Math.floor(2147483647 * Math.SQRT1_2);

/**
 * `DIALOG_MOVE_EXACT::OnTextChanged`: whether the typed translation would push
 * the selection outside the largest representable board area. Upstream greys
 * out OK and reddens the two entries when this is false.
 *
 * Only the translation is checked, not the rotation — same as upstream, which
 * validates the numbers the user typed into the X and Y boxes.
 */
export function moveKeepsSelectionInBounds(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  translation: Vec2,
): boolean {
  return (
    bbox.minX + translation.x >= -MAX_BOARD_COORD &&
    bbox.maxX + translation.x <= MAX_BOARD_COORD &&
    bbox.minY + translation.y >= -MAX_BOARD_COORD &&
    bbox.maxY + translation.y <= MAX_BOARD_COORD
  );
}

/**
 * Which anchor the dialog preselects, from `EDIT_TOOL::MoveExact`:
 * `selection.Size() > 1 ? ROTATE_AROUND_SEL_CENTER : ROTATE_AROUND_ITEM_ANCHOR`.
 *
 * For a single item the two produce identical geometry — the selection centre
 * *is* that item's centre — so this only decides which radio button opens
 * checked. It still matters, because the user sees it and may rotate several
 * items afterwards without touching it.
 */
export function defaultRotationAnchor(selectionSize: number): RotationAnchor {
  return selectionSize > 1 ? 'selectionCenter' : 'itemAnchor';
}

/**
 * `EDA_SHAPE::getPosition`. A graphic's anchor is not its centre: an arc
 * anchors at the centre it turns about, a polygon at its first vertex, and
 * everything else at its start point — which for a circle *is* its centre,
 * since KiCad stores a circle as centre-plus-a-point-on-it.
 */
function shapeAnchor(s: PcbShape): Vec2 | null {
  if (s.kind === 'arc')
    return s.center ?? (s.start && s.mid && s.end ? arcCenter(s.start, s.mid, s.end) : null);
  if (s.kind === 'circle') return s.center ?? s.start ?? null;
  if (s.kind === 'poly') return s.pts?.[0] ?? null;
  return s.start ?? null;
}

/**
 * `BOARD_ITEM::GetPosition` — the item's own anchor, which is what
 * `ROTATE_AROUND_ITEM_ANCHOR` turns about.
 *
 * This is deliberately *not* the bounding-box centre. A track anchors at its
 * start, not its midpoint, so rotating one about its anchor pins one end and
 * swings the other; using the centre instead would spin it about the middle,
 * which is a different result and not what the menu entry says.
 */
export function itemAnchorPoint(board: Board, id: string): Vec2 | null {
  const r = parseBoardItemId(id);
  if (!r) return null;

  switch (r.kind) {
    case 'track':
      return board.tracks[r.index]?.start ?? null;
    case 'arc': {
      // PCB_ARC::GetPosition computes the arc centre from the three points.
      const a = board.arcs[r.index];
      return a ? arcCenter(a.start, a.mid, a.end) : null;
    }
    case 'via':
      return board.vias[r.index]?.at ?? null;
    case 'text':
      return board.texts[r.index]?.at ?? null;
    case 'footprint':
      return board.footprints[r.index]?.at ?? null;
    case 'pad':
      return board.footprints[r.index]?.pads[r.sub ?? -1]?.at ?? null;
    case 'shape': {
      const s = board.shapes[r.index];
      return s ? shapeAnchor(s) : null;
    }
    case 'zone':
      // ZONE::GetPosition is the first corner of the outline.
      return board.zones[r.index]?.outline?.[0] ?? null;
    case 'textbox': {
      // EDA_SHAPE::getPosition for a RECTANGLE is its first corner; a rotated
      // box has none, so its first polygon point stands in.
      const t = board.textBoxes[r.index];
      if (!t) return null;
      return t.start ?? t.pts?.[0] ?? null;
    }
    case 'table': {
      // A table has no coordinates of its own; its position is where its first
      // cell starts.
      const tb = board.tables[r.index];
      const first = tb?.cells[0];
      if (!first) return null;
      return first.start ?? first.pts?.[0] ?? null;
    }
    case 'dimension':
      // PCB_DIMENSION_BASE::GetPosition() is GetStart() — the first feature
      // point, not the centre of the drawn lines and not the text.
      return board.dimensions[r.index]?.start ?? null;
    default:
      return null;
  }
}

/** `EDIT_TOOL::MoveExact`. */
export function moveExact(
  board: Board,
  selection: Iterable<string>,
  opts: MoveExactOptions,
): Board {
  const ids = new Set(selection);
  if (ids.size === 0) return board;

  const { translation, rotation = 0 } = opts;
  const anchor = opts.anchor ?? defaultRotationAnchor(ids.size);

  let next = board;

  if (translation.x !== 0 || translation.y !== 0) next = moveBoardItems(next, ids, translation);

  if (rotation === 0) return next;

  if (anchor === 'itemAnchor') {
    // Each item turns about its own anchor, so a multi-item selection rotates
    // its items where they stand rather than swinging them around each other.
    for (const id of ids) {
      const c = itemAnchorPoint(next, id);
      if (c) next = rotateBoardItemsBy(next, new Set([id]), rotation, c);
    }
    return next;
  }

  let centre: Vec2 | null | undefined;

  if (anchor === 'userOrigin') {
    centre = opts.userOrigin;
  } else if (anchor === 'auxOrigin') {
    centre = opts.auxOrigin;
  } else {
    // The selection centre *after* the move: upstream advances `selCenter` by
    // the translation before rotating, so the two compose as the dialog reads
    // them — move the selection there, then spin it about where it now sits.
    const b = boardSelectionBBox(next, ids);
    centre = b
      ? { x: Math.round((b.minX + b.maxX) / 2), y: Math.round((b.minY + b.maxY) / 2) }
      : null;
  }

  if (!centre) return next;

  return rotateBoardItemsBy(next, ids, rotation, centre);
}
