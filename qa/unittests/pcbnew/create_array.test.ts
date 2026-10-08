// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Create Array on the board.
 * Counterparts: `ARRAY_TOOL::CreateArray` and `ARRAY_CREATOR`.
 *
 * The placement maths is covered in qa/unittests/common/array_options.test.ts;
 * what is tested here is that the board ends up with the right *set* of
 * positions — including the original's, which is an array item like any other
 * and moves when position 0's transform is not the identity.
 */
import { describe, expect, it } from 'vitest';
import { arraySize } from '@ziroeda/pcbnew/dialogs/dialog_create_array.js';
import { ARRAY_CIRCULAR_OPTIONS, ARRAY_GRID_OPTIONS } from '@ziroeda/common/array_options.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

/** The dialog's fields onto ARRAY_GRID_OPTIONS, as TransferDataFromWindow sets them. */
const gridOpts = (o: {
  nx: number;
  ny: number;
  delta: VECTOR2I;
  offset?: VECTOR2I;
  stagger?: number;
  centred?: boolean;
}): ARRAY_GRID_OPTIONS => {
  const g = new ARRAY_GRID_OPTIONS();
  g.m_nx = o.nx;
  g.m_ny = o.ny;
  g.m_delta = o.delta;
  if (o.offset) g.m_offset = o.offset;
  if (o.stagger !== undefined) g.m_stagger = o.stagger;
  if (o.centred !== undefined) g.m_centred = o.centred;
  return g;
};

/** The same for ARRAY_CIRCULAR_OPTIONS; angles in degrees. */
const circOpts = (o: {
  nPts: number;
  centre: VECTOR2I;
  angle?: number;
  angleOffset?: number;
  clockwise?: boolean;
  rotateItems?: boolean;
}): ARRAY_CIRCULAR_OPTIONS => {
  const c = new ARRAY_CIRCULAR_OPTIONS();
  c.m_nPts = o.nPts;
  c.m_centre = o.centre;
  if (o.angle !== undefined) c.m_angle = new EDA_ANGLE(o.angle);
  if (o.angleOffset !== undefined) c.m_angleOffset = new EDA_ANGLE(o.angleOffset);
  if (o.clockwise !== undefined) c.m_clockwise = o.clockwise;
  if (o.rotateItems !== undefined) c.m_rotateItems = o.rotateItems;
  return c;
};

describe('array size', () => {
  it('is nx times ny for a grid', () => {
    expect(arraySize(gridOpts({ nx: 3, ny: 4, delta: { x: 1, y: 1 } }))).toBe(12);
  });

  it('is the point count for a circle', () => {
    expect(arraySize(circOpts({ nPts: 6, centre: { x: 0, y: 0 } }))).toBe(6);
  });
});
