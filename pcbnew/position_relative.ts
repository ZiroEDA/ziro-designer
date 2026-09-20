// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Position Relative To: put the selection at a typed offset from a reference
 * point, rather than displacing it by a typed amount.
 * Counterparts: `POSITION_RELATIVE_TOOL` and `DIALOG_POSITION_RELATIVE`.
 *
 * The distinction from Move Exactly is the whole point of the tool. Move
 * Exactly says "shift this by 5 mm"; Position Relative says "put this 5 mm from
 * that". So the displacement is computed, not typed:
 *
 *     delta = reference + offset − selectionAnchor
 *
 * which lands the selection's own anchor exactly `offset` away from the
 * reference. Typing the same offset twice is therefore idempotent, where Move
 * Exactly would move twice as far.
 */

import { moveBoardItems, parseBoardItemId } from './edit-board.js';
import { itemAnchorPoint } from './move_exact.js';
import type { Board } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `DIALOG_POSITION_RELATIVE::ANCHOR_TYPE`. */
export type PositionAnchorType = 'gridOrigin' | 'userOrigin' | 'item' | 'point';

/**
 * `PCB_SELECTION::GetTopLeftItem`: the leftmost item, ties broken by the
 * highest — smallest x, then smallest y.
 *
 * Compared by each item's *anchor*, not by its bounding box, so a long track
 * running left is ranked by where it starts. With `footprintsOnly` the scan
 * ignores everything else and yields nothing when the selection holds no
 * footprint, which is what makes the tiered preference below work.
 *
 * An exact tie in both coordinates keeps the first item seen, as upstream's
 * strict `<` comparisons do.
 */
export function topLeftItem(
  board: Board,
  selection: Iterable<string>,
  footprintsOnly = false,
): string | null {
  let bestId: string | null = null;
  let best: Vec2 | null = null;

  for (const id of selection) {
    if (footprintsOnly && parseBoardItemId(id)?.kind !== 'footprint') continue;

    const p = itemAnchorPoint(board, id);
    if (!p) continue;

    if (!best || p.x < best.x || (p.x === best.x && p.y < best.y)) {
      bestId = id;
      best = p;
    }
  }

  return bestId;
}

/**
 * Which item the selection is positioned *by*, from
 * `POSITION_RELATIVE_TOOL::PositionRelative`: footprints first, then pads, then
 * anything at all — each tier resolved by top-left within itself.
 *
 * The tiers exist because the anchor is what the user is aiming: given a
 * footprint and some stray silkscreen, "put this 5 mm from that" means the
 * footprint, and measuring from the silkscreen instead would be surprising.
 */
export function selectionAnchorId(board: Board, selection: Iterable<string>): string | null {
  const ids = [...selection];

  const footprint = topLeftItem(board, ids, true);
  if (footprint) return footprint;

  const pads = ids.filter((id) => parseBoardItemId(id)?.kind === 'pad');
  if (pads.length > 0) {
    const pad = topLeftItem(board, pads);
    if (pad) return pad;
  }

  return topLeftItem(board, ids);
}

/** Where that anchor sits. */
export function selectionAnchorPosition(board: Board, selection: Iterable<string>): Vec2 | null {
  const id = selectionAnchorId(board, selection);
  return id ? itemAnchorPoint(board, id) : null;
}

/**
 * `moveSelectionBy`: a selected pad moves its whole parent footprint, since a
 * pad cannot be repositioned independently of the footprint it belongs to.
 * Upstream deduplicates so a footprint with three selected pads still moves
 * once; a Set does that here.
 *
 * Upstream keeps pads separate when the free-pads setting is on (or in the
 * footprint editor). We have no such setting, so promotion is unconditional —
 * noted rather than silently assumed.
 */
export function promotePadsToFootprints(selection: Iterable<string>): Set<string> {
  const out = new Set<string>();

  for (const id of selection) {
    const r = parseBoardItemId(id);
    out.add(r?.kind === 'pad' ? `footprint:${r.index}` : id);
  }

  return out;
}

export interface PositionRelativeOptions {
  /** Where to measure from — `getAnchorPos()`. */
  reference: Vec2;
  /** How far from it to land, in IU. */
  offset: Vec2;
}

/** `POSITION_RELATIVE_TOOL::RelativeItemSelectionMove`. */
export function positionRelative(
  board: Board,
  selection: Iterable<string>,
  opts: PositionRelativeOptions,
): Board {
  const ids = [...selection];
  if (ids.length === 0) return board;

  const anchor = selectionAnchorPosition(board, ids);
  if (!anchor) return board;

  // The anchor is read *before* promotion, from the selection as the user made
  // it: upstream computes m_selectionAnchor from the raw selection and only
  // promotes inside the move. A selected pad therefore positions its footprint
  // by the pad's own location, which is the point of selecting the pad.
  const delta = {
    x: opts.reference.x + opts.offset.x - anchor.x,
    y: opts.reference.y + opts.offset.y - anchor.y,
  };

  return moveBoardItems(board, promotePadsToFootprints(ids), delta);
}
