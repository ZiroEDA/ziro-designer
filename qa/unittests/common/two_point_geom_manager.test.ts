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
  TWO_POINT_GEOMETRY_MANAGER,
} from '@ziroeda/common/preview_items/two_point_geom_manager.js';

describe('the unconstrained case', () => {
  it('takes the end exactly as given', () => {
    const mgr = new TWO_POINT_GEOMETRY_MANAGER();
    mgr.SetOrigin({ x: 100, y: 200 });
    mgr.SetEnd({ x: 700, y: 250 });

    expect(mgr.GetEnd()).toEqual({ x: 700, y: 250 });
  });
});

describe('LEADER_MODE::DEG45', () => {
  it('equalises the components rather than keeping the length', () => {
    const mgr = new TWO_POINT_GEOMETRY_MANAGER();
    mgr.SetAngleSnap(LeaderMode.DEG45);
    mgr.SetOrigin({ x: 0, y: 0 });
    // (300, 200): neither |x| > 2|y| nor |y| > 2|x|, and |x| > |y|, so
    // `newVec.y = copysign( x, y )` → (300, 300). A length-preserving
    // projection would give (255, 255) — off a 100-unit grid, and shorter.
    mgr.SetEnd({ x: 300, y: 200 });

    expect(mgr.GetEnd()).toEqual({ x: 300, y: 300 });
  });

  it('drops to the axis when one component dominates', () => {
    const mgr = new TWO_POINT_GEOMETRY_MANAGER();
    mgr.SetAngleSnap(LeaderMode.DEG45);
    mgr.SetOrigin({ x: 0, y: 0 });
    // |x| > 2|y| → `newVec.y = 0`.
    mgr.SetEnd({ x: 1000, y: 100 });

    expect(mgr.GetEnd()).toEqual({ x: 1000, y: 0 });
  });

  it('is idempotent, which is why drawShape may snap before handing it in', () => {
    const mgr = new TWO_POINT_GEOMETRY_MANAGER();
    mgr.SetAngleSnap(LeaderMode.DEG45);
    mgr.SetOrigin({ x: 0, y: 0 });
    mgr.SetEnd({ x: 300, y: 200 });
    const once = mgr.GetEnd();
    mgr.SetEnd(once);

    expect(mgr.GetEnd()).toEqual(once);
  });
});

describe('LEADER_MODE::DEG90', () => {
  it('keeps the larger component and zeroes the other', () => {
    const mgr = new TWO_POINT_GEOMETRY_MANAGER();
    mgr.SetAngleSnap(LeaderMode.DEG90);
    mgr.SetOrigin({ x: 0, y: 0 });
    mgr.SetEnd({ x: 100, y: 400 });

    expect(mgr.GetEnd()).toEqual({ x: 0, y: 400 });
  });

  it('gives the tie to horizontal', () => {
    // `GetVectorSnapped90`'s test is `absVec.x >= absVec.y`, so a perfect
    // diagonal snaps flat, not upright.
    const mgr = new TWO_POINT_GEOMETRY_MANAGER();
    mgr.SetAngleSnap(LeaderMode.DEG90);
    mgr.SetOrigin({ x: 0, y: 0 });
    mgr.SetEnd({ x: 400, y: 400 });

    expect(mgr.GetEnd()).toEqual({ x: 400, y: 0 });
  });
});

describe('IsReset and IsEmpty', () => {
  it('starts reset, and Reset clears only the origin flag', () => {
    const mgr = new TWO_POINT_GEOMETRY_MANAGER();
    expect(mgr.IsReset()).toBe(true);

    mgr.SetOrigin({ x: 5, y: 5 });
    expect(mgr.IsReset()).toBe(false);

    mgr.Reset();
    expect(mgr.IsReset()).toBe(true);
    // `Reset()` touches `m_originSet` and nothing else, so the last origin is
    // still readable — the assistant's `IsReset()` guard is what stops it
    // being drawn.
    expect(mgr.GetOrigin()).toEqual({ x: 5, y: 5 });
  });

  it('IsEmpty is what makes a second click in the same spot end the shape', () => {
    const mgr = new TWO_POINT_GEOMETRY_MANAGER();
    mgr.SetOrigin({ x: 10, y: 10 });
    mgr.SetEnd({ x: 10, y: 10 });
    expect(mgr.IsEmpty()).toBe(true);

    mgr.SetEnd({ x: 10, y: 11 });
    expect(mgr.IsEmpty()).toBe(false);
  });
});
