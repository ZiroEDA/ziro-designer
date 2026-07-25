/**
 * Footprint helpers. Counterpart: `pcbnew/footprint_utils.cpp`.
 *
 * ComputeFootprintShift answers the question a footprint replacement has to ask:
 * the library's copy of this footprint may have had its anchor moved or its body
 * rotated since the board was laid out, so where does the replacement have to go
 * for its pads to land on the copper that is already routed?
 */

import { orthoRealignTransform } from '@ziroeda/common/src/item_realignment.js';
import { EDA_ANGLE, ANGLE_0 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { rotatePcb } from './read-board.js';
import type { PcbFootprint } from './types.js';

export interface FootprintShift {
  shift: VECTOR2I;
  angleShift: EDA_ANGLE;
}

/**
 * PAD::GetFPRelativePosition — a pad's position in its footprint's own frame,
 * recovered from the board-absolute position this model stores (the inverse of the
 * reader's `toBoard`).
 */
const padRelativePosition = (fp: PcbFootprint, pad: { at: VECTOR2I }): VECTOR2I =>
  rotatePcb({ x: pad.at.x - fp.at.x, y: pad.at.y - fp.at.y }, -fp.angle);

/**
 * The pads of a footprint whose number is unique within it, keyed by number. A
 * repeated number tells us nothing about which pad corresponds to which in the
 * other footprint, so those are dropped — pad numbers cover 99% of cases.
 */
function uniquelyNumberedPads(fp: PcbFootprint): Map<string, VECTOR2I> {
  const result = new Map<string, VECTOR2I>();
  const seenDuplicate = new Set<string>();

  for (const pad of fp.pads) {
    const number = pad.number;
    if (seenDuplicate.has(number)) continue;
    if (result.has(number)) {
      result.delete(number);
      seenDuplicate.add(number);
      continue;
    }
    result.set(number, padRelativePosition(fp, pad));
  }

  return result;
}

/**
 * ComputeFootprintShift — the position and orientation shift to apply to `next` so
 * its pads sit where `existing`'s pads sit. Returns null when no useful pair of
 * pads is shared, which callers read as "place it exactly where the old one was".
 */
export function computeFootprintShift(
  existing: PcbFootprint,
  next: PcbFootprint,
): FootprintShift | null {
  const existingPads = uniquelyNumberedPads(existing);
  const newPads = uniquelyNumberedPads(next);

  const existingPoints: VECTOR2I[] = [];
  const newPoints: VECTOR2I[] = [];

  // The matching points are the ones with the same unique pad number in both.
  for (const [number, pos] of existingPads) {
    const other = newPads.get(number);
    if (!other) continue;
    existingPoints.push(pos);
    newPoints.push(other);
  }

  const transform = orthoRealignTransform(existingPoints, newPoints);
  if (!transform) return null;

  return {
    shift: RotatePoint(transform.translation, new EDA_ANGLE(existing.angle)),
    angleShift: transform.rotation.equals(ANGLE_0) ? ANGLE_0.Clone() : transform.rotation,
  };
}
