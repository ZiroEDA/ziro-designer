// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Best-fit realignment of two point sets. Counterpart: `common/item_realignment.cpp`
 * (ORTHO_ITEM_REALIGNER) over `include/item_realignment.h`.
 *
 * This is what compensates for a library footprint whose anchor moved or whose
 * body was rotated between revisions: given the old and new positions of the same
 * pads, it works out the transform that puts the replacement footprint's pads back
 * where the board's copper already is. Identifying *which* points correspond is the
 * caller's job (see pcbnew's computeFootprintShift, which pairs pads by number).
 *
 * Rotation is snapped to a multiple of 90°, on purpose: a pad nudged by a few
 * microns would otherwise read as a tiny rotation of the whole footprint.
 */

import {
  EDA_ANGLE,
  ANGLE_0,
  ANGLE_45,
  ANGLE_90,
  ANGLE_180,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

/** ITEM_REALIGNER_BASE::TRANSFORM, rotation about the origin, then translation. */
export interface REALIGN_TRANSFORM {
  rotation: EDA_ANGLE;
  translation: VECTOR2I;
}

const ANGLE_135 = new EDA_ANGLE(135);
const ANGLE_225 = new EDA_ANGLE(225);
const ANGLE_315 = new EDA_ANGLE(315);
const ANGLE_270 = new EDA_ANGLE(270);

/** Snap90Degrees, the nearest quarter turn. */
function snap90Degrees(angle: EDA_ANGLE): EDA_ANGLE {
  const a = angle.Normalized();
  if (a.AsDegrees() < ANGLE_45.AsDegrees()) return ANGLE_0.Clone();
  if (a.AsDegrees() < ANGLE_135.AsDegrees()) return ANGLE_90.Clone();
  if (a.AsDegrees() < ANGLE_225.AsDegrees()) return ANGLE_180.Clone();
  if (a.AsDegrees() < ANGLE_315.AsDegrees()) return ANGLE_270.Clone();
  return ANGLE_0.Clone();
}

const norm = (v: VECTOR2I): number => Math.hypot(v.x, v.y);
const sub = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });

/**
 * ORTHO_ITEM_REALIGNER::GetTransform, the transform to apply to the NEW points
 * (`ptsB`) to best align them onto the OLD ones (`ptsA`). Both lists must be the
 * same length and index-matched. Returns null when no usable baseline exists (all
 * candidate point pairs coincide), which the caller reads as "no shift".
 */
export function orthoRealignTransform(
  ptsA: readonly VECTOR2I[],
  ptsB: readonly VECTOR2I[],
): REALIGN_TRANSFORM | null {
  if (ptsA.length !== ptsB.length) return null;

  const epsilon = 10;
  let bestRotation: EDA_ANGLE | null = null;

  // First find a good baseline, two matching points in each set that are not
  // coincident.
  for (let firstPtIdx = 0; firstPtIdx < ptsA.length && !bestRotation; firstPtIdx++) {
    for (let secondPtIdx = firstPtIdx; secondPtIdx < ptsA.length; secondPtIdx++) {
      const baselineA = sub(ptsA[secondPtIdx]!, ptsA[firstPtIdx]!);
      const baselineB = sub(ptsB[secondPtIdx]!, ptsB[firstPtIdx]!);

      // If either baseline is too short, it's not a good candidate for alignment.
      if (norm(baselineA) < epsilon) continue;
      if (norm(baselineB) < epsilon) continue;

      bestRotation = EDA_ANGLE.fromVector(baselineB).sub(EDA_ANGLE.fromVector(baselineA));
      break;
    }
  }

  // Failed to find any suitable baseline.
  if (!bestRotation) return null;

  // Snap the baseline rotation to the nearest 90 degrees.
  const rotation = snap90Degrees(bestRotation);

  // Rotate the new points backwards so they are rotationally aligned to the old.
  const rotatedPtsB = ptsB.map((pt) => RotatePoint(pt, { x: 0, y: 0 }, rotation));

  // Find whether a translation aligns more than half the points. Fewer than half is
  // no good: that happens when a DIP footprint or two-row symbol is widened. When
  // one exists, lock to the matching points and ignore the outliers.
  let bestPadIdx: number | null = null;
  let bestPadMatches = 0;

  for (let padIdx = 0; padIdx < ptsA.length; padIdx++) {
    const translation = sub(ptsA[padIdx]!, rotatedPtsB[padIdx]!);
    let matches = 0;
    for (let i = 0; i < ptsA.length; i++) {
      const rotated = rotatedPtsB[i]!;
      const moved = { x: rotated.x + translation.x, y: rotated.y + translation.y };
      if (norm(sub(ptsA[i]!, moved)) < epsilon) matches++;
    }
    if (matches > bestPadMatches) {
      bestPadMatches = matches;
      bestPadIdx = padIdx;
    }
  }

  if (bestPadIdx !== null && bestPadMatches > Math.floor(ptsA.length / 2)) {
    return { rotation, translation: sub(ptsA[bestPadIdx]!, rotatedPtsB[bestPadIdx]!) };
  }

  // Otherwise fix nothing and take the mean displacement, the least-squares
  // minimising translation.
  let totalX = 0;
  let totalY = 0;
  for (let i = 0; i < ptsA.length; i++) {
    totalX += ptsA[i]!.x - rotatedPtsB[i]!.x;
    totalY += ptsA[i]!.y - rotatedPtsB[i]!.y;
  }

  // VECTOR2I division truncates toward zero, component-wise.
  const n = ptsA.length;
  return {
    rotation,
    translation: { x: Math.trunc(totalX / n), y: Math.trunc(totalY / n) },
  };
}
