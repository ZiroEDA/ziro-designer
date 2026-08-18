// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
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
import { padIsAperturePad } from './pad_enumerate.js';
import type { PcbFootprint } from './types.js';

export interface FootprintShift {
  shift: VECTOR2I;
  angleShift: EDA_ANGLE;
}

/**
 * `FOOTPRINT::GetUniquePadNumbers` (pcbnew/footprint.cpp:2532-2558) — the pad
 * numbers a footprint really offers, which is what "Filter by pin count"
 * compares against a symbol's netlist pin count and what
 * `FOOTPRINT_INFO::GetUniquePadCount` reports.
 *
 * Three kinds of pad are skipped, and every one of them is a pad a naive
 * "distinct numbers" count gets wrong:
 *
 *  - a pad with **no copper layer at all**, which is how the format expresses
 *    the extra shapes that build a complex solder-paste stencil. Ours already
 *    has this test as `PAD::IsAperturePad` (`(LayerSet() & AllCuMask()).none()`),
 *    so it is reused rather than written again.
 *  - a pad with an **empty number**, upstream's "usually mechanical, not
 *    electrical".
 *  - an **NPTH** pad, when called `DO_NOT_INCLUDE_NPTH` — which is how
 *    `footprint_info_impl.cpp:53` calls it, so it is the default here. This is
 *    the mounting-hole case: a footprint with plated mounting pads would
 *    otherwise report more pads than the symbol can ever have pins.
 */
export function uniquePadNumbers(fp: PcbFootprint, includeNpth = false): Set<string> {
  const usedNumbers = new Set<string>();

  for (const pad of fp.pads) {
    // Skip pads not on copper layers (used to build complex solder paste
    // shapes for instance).
    if (padIsAperturePad(pad)) continue;
    // Skip pads with no name, because they are usually "mechanical" pads,
    // not "electrical" pads.
    if (pad.number === '') continue;
    if (!includeNpth && pad.type === 'np_thru_hole') continue;
    usedNumbers.add(pad.number);
  }

  return usedNumbers;
}

/** `FOOTPRINT::GetUniquePadCount` — the size of {@link uniquePadNumbers}. */
export function uniquePadCount(fp: PcbFootprint, includeNpth = false): number {
  return uniquePadNumbers(fp, includeNpth).size;
}

/**
 * PAD::GetFPRelativePosition, a pad's position in its footprint's own frame,
 * recovered from the board-absolute position this model stores (the inverse of the
 * reader's `toBoard`).
 */
const padRelativePosition = (fp: PcbFootprint, pad: { at: VECTOR2I }): VECTOR2I =>
  rotatePcb({ x: pad.at.x - fp.at.x, y: pad.at.y - fp.at.y }, -fp.angle);

/**
 * The pads of a footprint whose number is unique within it, keyed by number. A
 * repeated number tells us nothing about which pad corresponds to which in the
 * other footprint, so those are dropped, pad numbers cover 99% of cases.
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
 * ComputeFootprintShift, the position and orientation shift to apply to `next` so
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
