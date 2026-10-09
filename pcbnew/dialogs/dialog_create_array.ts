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

import type { ARRAY_OPTIONS } from '@ziroeda/common/array_options.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { ARRAY_CIRCULAR_OPTIONS, ARRAY_GRID_OPTIONS } from '@ziroeda/common/array_options.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';

/** `const ARRAY_OPTIONS&`: a grid or a circular array. */
export type ArraySpec = ARRAY_OPTIONS;

/** How many items the array has in total, the original included. */
export function arraySize(spec: ArraySpec): number {
  return spec.GetArraySize();
}

/** The transform for copy `n`, given where the selection currently sits. */
export function arrayTransform(spec: ArraySpec, n: number, pos: Vec2): ARRAY_OPTIONS.TRANSFORM {
  return spec.GetTransform(n, pos);
}

// --- DIALOG_CREATE_ARRAY::TransferDataFromWindow (was array_settings.ts) ---

export type ArrayMode = 'grid' | 'circular';

export interface ArraySettings {
  mode: ArrayMode;

  // Grid
  nx: number;
  ny: number;
  dxIU: number;
  dyIU: number;
  offsetXIU: number;
  offsetYIU: number;
  stagger: number;
  staggerRows: boolean;
  centred: boolean;

  // Circular
  count: number;
  centreXIU: number;
  centreYIU: number;
  /** Degrees between copies; 0 divides a full turn evenly. */
  angle: number;
  angleOffset: number;
  clockwise: boolean;
  rotateItems: boolean;

  /**
   * "Arrange selection" rather than "Create copies"
   * (`m_radioBtnArrangeSelection`, :570). Absent is upstream's default, off.
   */
  arrangeSelection?: boolean;
  /**
   * "Assign unique reference designators" (`m_radioBtnUniqueRefs`, :571).
   * Absent is upstream's default, on (`m_FootprintReannotate = true`, :90).
   */
  reannotateFootprints?: boolean;
}

export const DEFAULT_ARRAY_SETTINGS: ArraySettings = {
  mode: 'grid',
  nx: 5,
  ny: 5,
  dxIU: mmToIU(2.54),
  dyIU: mmToIU(2.54),
  offsetXIU: 0,
  offsetYIU: 0,
  stagger: 1,
  staggerRows: true,
  centred: false,
  count: 4,
  centreXIU: 0,
  centreYIU: 0,
  angle: 0,
  angleOffset: 0,
  clockwise: false,
  rotateItems: false,
};

/** How many items the settings describe, the original included. */
export function arrayItemCount(s: ArraySettings): number {
  return s.mode === 'grid' ? s.nx * s.ny : s.count;
}

/**
 * Whether the settings describe an array that can be built.
 *
 * A count of zero is the one that matters: a zero-point circular array has no
 * angle to divide, and a grid with a zero dimension has no items. Upstream
 * validates each count field and refuses the dialog rather than producing
 * nothing silently.
 */
export function arraySettingsValid(s: ArraySettings): boolean {
  if (s.mode === 'grid') return s.nx >= 1 && s.ny >= 1;
  return s.count >= 1;
}

/** `TransferDataFromWindow`: the settings as the engine wants them. */
export function arraySpecFrom(s: ArraySettings): ArraySpec {
  const spec = arrayGeometryFrom(s);
  spec.SetShouldArrangeSelection(s.arrangeSelection ?? false);
  spec.SetSShouldReannotateFootprints(s.reannotateFootprints ?? true);
  return spec;
}

/** The grid or circle half of `TransferDataFromWindow`. */
function arrayGeometryFrom(s: ArraySettings): ArraySpec {
  if (s.mode === 'grid') {
    const grid = new ARRAY_GRID_OPTIONS();
    grid.m_nx = s.nx;
    grid.m_ny = s.ny;
    grid.m_delta = { x: s.dxIU, y: s.dyIU };
    grid.m_offset = { x: s.offsetXIU, y: s.offsetYIU };
    grid.m_stagger = s.stagger;
    grid.m_stagger_rows = s.staggerRows;
    grid.m_centred = s.centred;
    return grid;
  }

  const circ = new ARRAY_CIRCULAR_OPTIONS();
  circ.m_nPts = s.count;
  circ.m_centre = { x: s.centreXIU, y: s.centreYIU };
  circ.m_angle = new EDA_ANGLE(s.angle);
  circ.m_angleOffset = new EDA_ANGLE(s.angleOffset);
  circ.m_clockwise = s.clockwise;
  circ.m_rotateItems = s.rotateItems;
  return circ;
}
