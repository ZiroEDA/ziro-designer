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
