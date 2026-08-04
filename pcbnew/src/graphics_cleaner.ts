// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Cleanup Graphics: drop zero-size and duplicated graphics.
 * Counterpart: `GRAPHICS_CLEANER::cleanupShapes`, `isNullShape` and
 * `areEquivalent` (pcbnew/graphics_cleaner.cpp).
 *
 * ## What "equivalent" means here, and what it ignores
 *
 * Two shapes are duplicates if their **kind, layer and width** match exactly
 * and their defining points coincide within the DRC epsilon. Fill, stroke type,
 * solder-mask layer and locked state are not compared at all — so a filled
 * rectangle and an unfilled one drawn over it are duplicates, and the filled
 * one can be the copy that goes. That is upstream's rule; a port that also
 * compared fill would quietly refuse to remove shapes KiCad removes.
 *
 * The comparison is per-defining-point and *not* geometric, which has visible
 * consequences worth stating rather than discovering:
 *
 * - A rectangle is orientation-sensitive: `(0,0)-(10,10)` and `(10,10)-(0,0)`
 *   cover the same area and are not duplicates.
 * - A circle compares its stored circumference point, not its radius, so two
 *   identical circles drawn from different angles are not duplicates.
 * - An arc compares centre, start and end but **not** the mid point, so a minor
 *   arc and the major arc over the same chord count as duplicates and one is
 *   deleted. That is an upstream bug and it is mirrored here: a board cleaned
 *   in KiCad and a board cleaned here have to end up the same, and diverging
 *   "for the better" is how the two stop agreeing.
 * - Polygons are never deduplicated. Upstream has an unimplemented TODO in that
 *   branch and returns false.
 *
 * ## Only the redundant-shape pass
 *
 * `GRAPHICS_CLEANER` has three further passes — `mergeRects`, `fixBoardOutlines`
 * and `connectBoardShapes` — which are not here. They need primitives the port
 * does not have (infinite-line intersection, net-tie pad groups) and, in
 * `connectBoardShapes`' case, upstream's start order comes from a
 * pointer-ordered `std::set` and is not reproducible even between two runs of
 * KiCad. They are separate work rather than approximations.
 */
import { BezierPoly } from '@ziroeda/kimath/src/bezier_curves.js';
import { boardItemId, deleteBoardItems } from './edit-board.js';
import type { Board, PcbShape } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** `BOARD_DESIGN_SETTINGS::GetDRCEpsilon()`, 0.0005 mm. */
export const DRC_EPSILON = 500;
/** `ARC_HIGH_DEF`, the default `m_MaxError`. */
export const ARC_HIGH_DEF = 5000;

export type CleanupCode = 'null_graphic' | 'duplicate_graphic';

export interface CleanupItem {
  code: CleanupCode;
  /** The board item id of the shape that would be removed. */
  id: string;
  message: string;
}

const MESSAGES: Record<CleanupCode, string> = {
  null_graphic: 'Remove zero-size graphic',
  duplicate_graphic: 'Remove duplicated graphic',
};

/**
 * `equivalent( a, b, epsilon )`.
 *
 * A **per-axis box test with a strict `<`**, not a Euclidean distance. Two
 * consequences that a distance-based port gets wrong in both directions: a
 * delta of exactly the epsilon on one axis is *not* equivalent, while 495 on
 * both axes is — even though those points are 700 apart.
 */
export function equivalentPt(a: Vec2, b: Vec2, epsilon: number): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}

const ORIGIN: Vec2 = { x: 0, y: 0 };
const startOf = (s: PcbShape): Vec2 => s.start ?? s.pts?.[0] ?? ORIGIN;
const endOf = (s: PcbShape): Vec2 => s.end ?? s.pts?.[s.pts.length - 1] ?? ORIGIN;

/** `isNullShape`: a shape with no extent, which is invisible and unselectable. */
export function isNullShape(
  shape: PcbShape,
  epsilon = DRC_EPSILON,
  maxError = ARC_HIGH_DEF,
): boolean {
  switch (shape.kind) {
    case 'line':
    case 'rect':
    case 'arc':
      return equivalentPt(startOf(shape), endOf(shape), epsilon);

    case 'circle':
      // Upstream tests `GetRadius() == 0`, which is unreachable: `GetRadius`
      // clamps with `std::max(1, KiROUND(radius))`. So a circle is never null,
      // and returning false here is the faithful answer rather than an
      // oversight — a port that measured the radius itself would delete
      // circles KiCad keeps.
      return false;

    case 'poly':
      return (shape.pts?.length ?? 0) === 0;

    case 'curve': {
      const ctrl = shape.pts ?? [];
      if (ctrl.length < 4) return ctrl.length < 2;

      const flattened = new BezierPoly(ctrl[0]!, ctrl[1]!, ctrl[2]!, ctrl[3]!).getPoly(maxError);

      // Flattened to a single segment, it is a segment: compare its ends.
      // Fewer than two points is a point. Three or more is never null however
      // short the curve is.
      if (flattened.length === 2) return equivalentPt(startOf(shape), endOf(shape), epsilon);
      return flattened.length < 2;
    }

    default:
      return false;
  }
}

/** `areEquivalent`: are these two shapes duplicates of one another? */
export function areEquivalent(a: PcbShape, b: PcbShape, epsilon = DRC_EPSILON): boolean {
  if (a.kind !== b.kind || a.layer !== b.layer || a.width !== b.width) return false;

  switch (a.kind) {
    case 'line':
    case 'rect':
      return (
        equivalentPt(startOf(a), startOf(b), epsilon) && equivalentPt(endOf(a), endOf(b), epsilon)
      );

    case 'circle':
      // Centre and the stored circumference point, not the radius.
      return (
        equivalentPt(a.center ?? ORIGIN, b.center ?? ORIGIN, epsilon) &&
        equivalentPt(endOf(a), endOf(b), epsilon)
      );

    case 'arc':
      // Centre, start and end — deliberately not the mid point.
      return (
        equivalentPt(a.center ?? ORIGIN, b.center ?? ORIGIN, epsilon) &&
        equivalentPt(startOf(a), startOf(b), epsilon) &&
        equivalentPt(endOf(a), endOf(b), epsilon)
      );

    case 'curve': {
      const pa = a.pts ?? [];
      const pb = b.pts ?? [];
      if (pa.length < 4 || pb.length < 4) return false;
      return [0, 1, 2, 3].every((i) => equivalentPt(pa[i]!, pb[i]!, epsilon));
    }

    // Upstream's POLY branch is an unimplemented TODO returning false.
    default:
      return false;
  }
}

export interface CleanupGraphicsOptions {
  epsilon?: number;
  maxError?: number;
  /** Report what would change without changing it. */
  dryRun?: boolean;
}

/**
 * `cleanupShapes`, plus the board rebuild upstream leaves to `BOARD_COMMIT`.
 *
 * The scan order is upstream's and it decides *which* of a duplicate pair
 * survives: for each shape, every **later** shape is compared against it, so
 * the earlier one is kept and the removal is reported against the later. A
 * reversed scan would delete the same number of shapes and keep different ones.
 *
 * A null shape is reported and then skipped **without being marked deleted**,
 * so it never becomes a duplicate base. Two coincident zero-size shapes are
 * therefore both reported as null rather than one null and one duplicate.
 */
export function cleanupGraphics(
  board: Board,
  opts: CleanupGraphicsOptions = {},
): { board: Board; items: CleanupItem[] } {
  const epsilon = opts.epsilon ?? DRC_EPSILON;
  const maxError = opts.maxError ?? ARC_HIGH_DEF;

  const items: CleanupItem[] = [];
  const deleted = new Set<number>();

  for (let i = 0; i < board.shapes.length; i++) {
    if (deleted.has(i)) continue;
    const shape = board.shapes[i]!;

    if (isNullShape(shape, epsilon, maxError)) {
      items.push({
        code: 'null_graphic',
        id: boardItemId('shape', i),
        message: MESSAGES.null_graphic,
      });
      continue;
    }

    for (let j = i + 1; j < board.shapes.length; j++) {
      if (deleted.has(j)) continue;
      const other = board.shapes[j]!;

      if (areEquivalent(shape, other, epsilon)) {
        items.push({
          code: 'duplicate_graphic',
          id: boardItemId('shape', j),
          message: MESSAGES.duplicate_graphic,
        });
        // Marked deleted immediately, so a third identical shape is compared
        // against the first rather than against a shape already on its way out.
        deleted.add(j);
      }
    }
  }

  if (opts.dryRun || items.length === 0) return { board, items };

  return { board: deleteBoardItems(board, new Set(items.map((it) => it.id))), items };
}
