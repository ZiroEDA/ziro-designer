// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TWO_POINT_GEOMETRY_MANAGER` (`include/preview_items/two_point_geom_manager.h`)
 * — the whole state of the line, rectangle and circle tools.
 *
 * The point of these is the snap: `GetVectorSnapped45` / `GetVectorSnapped90`
 * do **not** preserve the vector's length, and a projection onto the nearest
 * 45° ray — which is what the PCB editor used to do — does. On a grid that
 * difference is the whole bug.
 */
import { describe, expect, it } from 'vitest';
import {
  LeaderMode,
  TwoPointGeomManager,
} from '@ziroeda/common/src/preview_items/two_point_geom_manager.js';

describe('the unconstrained case', () => {
  it('takes the end exactly as given', () => {
    const mgr = new TwoPointGeomManager();
    mgr.setOrigin({ x: 100, y: 200 });
    mgr.setEnd({ x: 700, y: 250 });

    expect(mgr.getEnd()).toEqual({ x: 700, y: 250 });
  });
});

describe('LEADER_MODE::DEG45', () => {
  it('equalises the components rather than keeping the length', () => {
    const mgr = new TwoPointGeomManager();
    mgr.setAngleSnap(LeaderMode.DEG45);
    mgr.setOrigin({ x: 0, y: 0 });
    // (300, 200): neither |x| > 2|y| nor |y| > 2|x|, and |x| > |y|, so
    // `newVec.y = copysign( x, y )` → (300, 300). A length-preserving
    // projection would give (255, 255) — off a 100-unit grid, and shorter.
    mgr.setEnd({ x: 300, y: 200 });

    expect(mgr.getEnd()).toEqual({ x: 300, y: 300 });
  });

  it('drops to the axis when one component dominates', () => {
    const mgr = new TwoPointGeomManager();
    mgr.setAngleSnap(LeaderMode.DEG45);
    mgr.setOrigin({ x: 0, y: 0 });
    // |x| > 2|y| → `newVec.y = 0`.
    mgr.setEnd({ x: 1000, y: 100 });

    expect(mgr.getEnd()).toEqual({ x: 1000, y: 0 });
  });

  it('is idempotent, which is why drawShape may snap before handing it in', () => {
    const mgr = new TwoPointGeomManager();
    mgr.setAngleSnap(LeaderMode.DEG45);
    mgr.setOrigin({ x: 0, y: 0 });
    mgr.setEnd({ x: 300, y: 200 });
    const once = mgr.getEnd();
    mgr.setEnd(once);

    expect(mgr.getEnd()).toEqual(once);
  });
});

describe('LEADER_MODE::DEG90', () => {
  it('keeps the larger component and zeroes the other', () => {
    const mgr = new TwoPointGeomManager();
    mgr.setAngleSnap(LeaderMode.DEG90);
    mgr.setOrigin({ x: 0, y: 0 });
    mgr.setEnd({ x: 100, y: 400 });

    expect(mgr.getEnd()).toEqual({ x: 0, y: 400 });
  });

  it('gives the tie to horizontal', () => {
    // `GetVectorSnapped90`'s test is `absVec.x >= absVec.y`, so a perfect
    // diagonal snaps flat, not upright.
    const mgr = new TwoPointGeomManager();
    mgr.setAngleSnap(LeaderMode.DEG90);
    mgr.setOrigin({ x: 0, y: 0 });
    mgr.setEnd({ x: 400, y: 400 });

    expect(mgr.getEnd()).toEqual({ x: 400, y: 0 });
  });
});

describe('IsReset and IsEmpty', () => {
  it('starts reset, and Reset clears only the origin flag', () => {
    const mgr = new TwoPointGeomManager();
    expect(mgr.isReset()).toBe(true);

    mgr.setOrigin({ x: 5, y: 5 });
    expect(mgr.isReset()).toBe(false);

    mgr.reset();
    expect(mgr.isReset()).toBe(true);
    // `Reset()` touches `m_originSet` and nothing else, so the last origin is
    // still readable — the assistant's `IsReset()` guard is what stops it
    // being drawn.
    expect(mgr.getOrigin()).toEqual({ x: 5, y: 5 });
  });

  it('IsEmpty is what makes a second click in the same spot end the shape', () => {
    const mgr = new TwoPointGeomManager();
    mgr.setOrigin({ x: 10, y: 10 });
    mgr.setEnd({ x: 10, y: 10 });
    expect(mgr.isEmpty()).toBe(true);

    mgr.setEnd({ x: 10, y: 11 });
    expect(mgr.isEmpty()).toBe(false);
  });
});
