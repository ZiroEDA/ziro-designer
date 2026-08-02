// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Create Array: repeat a selection in a grid or around a circle.
 * Counterparts: `ARRAY_TOOL::CreateArray` and `ARRAY_CREATOR`.
 *
 * Where each copy goes is decided in common (array_options.ts); this makes the
 * copies and puts them on the board.
 *
 * The original is one of the array's items, not a thing the array is built
 * around: it receives array position 0's transform like any other. That matters
 * for a *centred* grid and for a circular array with an angle offset, where
 * position 0 is not the identity — leaving the original where it was would put
 * the whole array off by that amount.
 *
 * Upstream reaches the same geometry by the other route: it iterates its array
 * indices in reverse and hands the *last* one to the original, so the original's
 * untransformed position is still available while the copies are being made off
 * it. The set of occupied positions is identical either way; the difference is
 * only which item keeps the original's identity, and keeping it at position 0
 * is the less surprising of the two.
 */

import {
  boardSelectionBBox,
  duplicateBoardItems,
  moveBoardItems,
  rotateBoardItemsBy,
} from './edit-board.js';
import {
  circularArraySize,
  circularTransform,
  gridArraySize,
  gridTransform,
  type ArrayCircularOptions,
  type ArrayGridOptions,
  type ArrayTransform,
} from '@ziroeda/common/src/array_options.js';
import type { Board } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

export type ArraySpec =
  | { kind: 'grid'; options: ArrayGridOptions }
  | { kind: 'circular'; options: ArrayCircularOptions };

export interface CreateArrayResult {
  board: Board;
  /** Copies added; the original is not counted. */
  added: number;
}

/** How many items the array has in total, the original included. */
export function arraySize(spec: ArraySpec): number {
  return spec.kind === 'grid' ? gridArraySize(spec.options) : circularArraySize(spec.options);
}

/** The transform for copy `n`, given where the selection currently sits. */
export function arrayTransform(spec: ArraySpec, n: number, pos: Vec2): ArrayTransform {
  return spec.kind === 'grid'
    ? gridTransform(spec.options, n)
    : circularTransform(spec.options, n, pos);
}

/**
 * `ARRAY_CREATOR::Invoke`.
 *
 * Each copy is duplicated from the *original* selection rather than from the
 * previous copy, so a rounding error in one placement cannot accumulate along
 * the array — and so a circular array's last item lands where the geometry says
 * rather than a little short of it.
 */
export function createArray(
  board: Board,
  selection: Iterable<string>,
  spec: ArraySpec,
): CreateArrayResult {
  const ids = [...selection];
  if (ids.length === 0) return { board, added: 0 };

  const total = arraySize(spec);
  // Only the degenerate case is refused. An array of *one* is not degenerate:
  // upstream still applies position 0's transform to it, so a single-point
  // circular array with an angle offset nudges the item round the centre. A
  // zero-point one would divide by zero working that angle out.
  if (total < 1) return { board, added: 0 };

  // Circular placement turns about a centre, so it needs to know where the
  // selection is now. The grid does not — its offsets are relative.
  const bbox = boardSelectionBBox(board, new Set(ids));
  const pos: Vec2 = bbox
    ? { x: Math.round((bbox.minX + bbox.maxX) / 2), y: Math.round((bbox.minY + bbox.maxY) / 2) }
    : { x: 0, y: 0 };

  let next = board;
  let added = 0;

  /** Turn a placed group about its own new centre. */
  const spin = (b: Board, group: ReadonlySet<string>, degrees: number): Board => {
    if (degrees === 0) return b;
    // The offset has already carried the group round the circle, so rotating
    // about the array centre again would move it a second time.
    const box = boardSelectionBBox(b, group);
    if (!box) return b;
    return rotateBoardItemsBy(b, group, degrees, {
      x: Math.round((box.minX + box.maxX) / 2),
      y: Math.round((box.minY + box.maxY) / 2),
    });
  };

  // The copies are made first, while the original is still where the transforms
  // were computed from; the original is placed last.
  for (let n = 1; n < total; n++) {
    const t = arrayTransform(spec, n, pos);

    // Duplicate takes the offset directly, so the copy lands in place rather
    // than being made at the original's position and moved afterwards.
    const dup = duplicateBoardItems(next, new Set(ids), t.offset);
    if (dup.ids.length === 0) continue;

    next = spin(dup.board, new Set(dup.ids), t.rotation);
    added++;
  }

  const first = arrayTransform(spec, 0, pos);
  const originals = new Set(ids);

  if (first.offset.x !== 0 || first.offset.y !== 0) {
    next = moveBoardItems(next, originals, first.offset);
  }
  next = spin(next, originals, first.rotation);

  return { board: next, added };
}
