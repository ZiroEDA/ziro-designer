// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `common/tool/grid_helper.cpp` and `common/preview_items/snap_indicator.cpp`.
 * Every expectation is worked by hand from the C++, never read back off the
 * code under test.
 */
import { describe, expect, it } from 'vitest';
import { computeNearest, GRID_HELPER } from '@ziroeda/common/tool/grid_helper.js';
import {
  cornerIconPlan,
  pickSnapIcon,
  quadrantPointIconPlan,
} from '@ziroeda/common/preview_items/snap_indicator.js';
import {
  PT_CORNER,
  PT_END,
  PT_MID,
  PT_NONE,
  PT_ON_ELEMENT,
  PT_QUADRANT,
} from '@ziroeda/kimath/src/geometry/point_types.js';

describe('computeNearest (GRID_HELPER::computeNearest, grid_helper.cpp:445-450)', () => {
  it('rounds half away from zero, both directions', () => {
    // KiROUND((7-0)/5) = KiROUND(1.4) = 1 -> 5; KiROUND((3-0)/5) = KiROUND(0.6) = 1 -> 5
    expect(computeNearest({ x: 7, y: 3 }, { x: 5, y: 5 }, { x: 0, y: 0 })).toEqual({ x: 5, y: 5 });
    // KiROUND(-1.4) = -1 -> -5; KiROUND(-0.6) = -1 -> -5
    expect(computeNearest({ x: -7, y: -3 }, { x: 5, y: 5 }, { x: 0, y: 0 })).toEqual({
      x: -5,
      y: -5,
    });
  });

  it('rounds about a non-zero offset', () => {
    // KiROUND((7-2)/5) = KiROUND(1) = 1 -> 5+2=7; KiROUND((3-2)/5) = KiROUND(0.2) = 0 -> 0+2=2
    expect(computeNearest({ x: 7, y: 3 }, { x: 5, y: 5 }, { x: 2, y: 2 })).toEqual({ x: 7, y: 2 });
  });
});

describe('GRID_HELPER::Align (grid_helper.cpp:453-477), manual (no TOOL_MANAGER) mode', () => {
  it('is a no-op when the grid cannot be used', () => {
    const h = new GRID_HELPER();
    h.SetGridSize({ x: 10, y: 10 });
    h.SetUseGrid(false);
    expect(h.Align({ x: 7, y: 3 })).toEqual({ x: 7, y: 3 });
  });

  it('rounds onto a 10 x 10 grid at the origin', () => {
    const h = new GRID_HELPER();
    h.SetGridSize({ x: 10, y: 10 });
    // GetGrid() KiROUNDs the grid size itself: KiROUND(10) = 10.
    // computeNearest({7,3},{10,10},{0,0}): KiROUND(0.7)=1 -> 10; KiROUND(0.3)=0 -> 0
    expect(h.Align({ x: 7, y: 3 })).toEqual({ x: 10, y: 0 });
  });

  it('lets the auxiliary axis win a coordinate closer to the raw cursor than the grid node', () => {
    const h = new GRID_HELPER();
    h.SetGridSize({ x: 10, y: 10 });
    h.SetAuxAxes(true, { x: 3, y: 3 });
    // nearest = computeNearest({4,4},{10,10},{0,0}) = {0,0} (KiROUND(0.4) = 0 both axes).
    // |aux.x-4|=1 < |nearest.x-4|=4 -> x becomes 3; same for y.
    expect(h.Align({ x: 4, y: 4 })).toEqual({ x: 3, y: 3 });
  });

  it('clearing the auxiliary axis falls back to the plain grid round', () => {
    const h = new GRID_HELPER();
    h.SetGridSize({ x: 10, y: 10 });
    h.SetAuxAxes(true, { x: 3, y: 3 });
    h.SetAuxAxes(false);
    expect(h.Align({ x: 4, y: 4 })).toEqual({ x: 0, y: 0 });
  });
});

describe('GRID_HELPER::AlignGrid( aPoint, aGrid, aOffset ) (grid_helper.cpp:434-442)', () => {
  it('KiROUNDs the grid and offset before computeNearest, not after', () => {
    const h = new GRID_HELPER();
    // KiROUND(2.6) = 3; computeNearest({4,4},{3,3},{0,0}): KiROUND(4/3)=KiROUND(1.333)=1 -> 3
    expect(h.AlignGrid({ x: 4, y: 4 }, { x: 2.6, y: 2.6 }, { x: 0, y: 0 })).toEqual({ x: 3, y: 3 });
  });
});

describe('GRID_HELPER skip point (SetSkipPoint / ClearSkipPoint)', () => {
  it('starts at (0, 0), the VECTOR2I default, until ClearSkipPoint is called', () => {
    // grid_helper.cpp's constructor never touches m_skipPoint; only
    // ClearSkipPoint sets the INT_MIN sentinel.
    const h = new GRID_HELPER();
    h.SetSnapLineDirections([{ x: 1, y: 0 }]);
    h.SetSnapLineOrigin({ x: 0, y: 0 });
    h.SetSnapLineEnd({ x: 10, y: 0 });
    // The horizontal branch's candidate for this point is exactly (0, 0) - the
    // default skip point - so it is skipped and no other direction is active.
    expect(h.SnapToConstructionLines({ x: 3, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 }, 6)).toBeNull();

    h.ClearSkipPoint();
    expect(h.SnapToConstructionLines({ x: 3, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 }, 6)).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe('GRID_HELPER::SnapToConstructionLines (grid_helper.cpp:158-344)', () => {
  it('answers null with no snap-line origin', () => {
    const h = new GRID_HELPER();
    h.ClearSkipPoint();
    expect(
      h.SnapToConstructionLines({ x: 5, y: 1 }, { x: 6, y: 2 }, { x: 5, y: 5 }, 10),
    ).toBeNull();
  });

  it('picks the default axis direction with the smaller perpendicular distance, gridded', () => {
    const h = new GRID_HELPER();
    h.ClearSkipPoint();
    h.SetSnapLineOrigin({ x: 0, y: 0 }); // default directions: (1,0), (0,1)

    // Horizontal (1,0): perp = |delta.y| = 1; candidate = (aNearestGrid.x, origin.y) = (6, 0);
    //   candidateDistance = hypot(6-5, 0-1) = hypot(1,-1) ~= 1.414
    // Vertical   (0,1): perp = |delta.x| = 5; candidate = (origin.x, aNearestGrid.y) = (0, 2)
    // Horizontal's perp (1) is smaller, so it wins regardless of candidateDistance.
    expect(h.SnapToConstructionLines({ x: 5, y: 1 }, { x: 6, y: 2 }, { x: 5, y: 5 }, 10)).toEqual({
      x: 6,
      y: 0,
    });
  });

  it('keeps the raw (ungridded) projection when the grid is off', () => {
    const h = new GRID_HELPER();
    h.ClearSkipPoint();
    h.SetUseGrid(false);
    h.SetSnapLineOrigin({ x: 0, y: 0 });

    // canUseGrid() is false, so `candidate` stays the horizontal direction's
    // projection (5, 0) rather than being pulled onto aNearestGrid.
    expect(h.SnapToConstructionLines({ x: 5, y: 1 }, { x: 6, y: 2 }, { x: 5, y: 5 }, 10)).toEqual({
      x: 5,
      y: 0,
    });
  });

  it("an active direction's snap threshold is 1.5x, letting a farther point still snap", () => {
    // A single direction, so only the active-direction bonus decides whether
    // this passes at all - see the file comment on isolating it this way.
    const withoutEnd = new GRID_HELPER();
    withoutEnd.ClearSkipPoint();
    withoutEnd.SetSnapLineDirections([{ x: 1, y: 0 }]);
    withoutEnd.SetSnapLineOrigin({ x: 0, y: 0 });
    // perp = |delta.y| = 8 > snapRange (6): no active direction, so it is rejected.
    expect(
      withoutEnd.SnapToConstructionLines({ x: 3, y: 8 }, { x: 0, y: 0 }, { x: 1, y: 1 }, 6),
    ).toBeNull();

    const withEnd = new GRID_HELPER();
    withEnd.ClearSkipPoint();
    withEnd.SetSnapLineDirections([{ x: 1, y: 0 }]);
    withEnd.SetSnapLineOrigin({ x: 0, y: 0 });
    withEnd.SetSnapLineEnd({ x: 10, y: 0 }); // makes direction 0 active
    // Same perp (8), but the threshold is now 6 * 1.5 = 9, so it passes.
    // canUseGrid() is true, so the horizontal branch grids to (aNearestGrid.x, origin.y).
    expect(
      withEnd.SnapToConstructionLines({ x: 3, y: 8 }, { x: 0, y: 0 }, { x: 1, y: 1 }, 6),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe('SNAP_INDICATOR::pickSnapIcon (snap_indicator.cpp:156-184)', () => {
  it('takes the first matching point type, in the if/else-if order', () => {
    expect(pickSnapIcon(PT_CORNER | PT_END)).toBe('corner');
    expect(pickSnapIcon(PT_MID | PT_QUADRANT)).toBe('mid');
    expect(pickSnapIcon(PT_ON_ELEMENT)).toBe('on_element');
  });

  it('answers null for PT_NONE', () => {
    expect(pickSnapIcon(PT_NONE)).toBeNull();
  });
});

describe('the icon plans (snap_indicator.cpp:60-140)', () => {
  it('DrawCornerIcon: a filled node at the inset corner, two arms to the far edges', () => {
    // nodeRad = 16/8 = 2; corner = (100,100) - (8,8) + (2,2) = (94, 94)
    const plan = cornerIconPlan({ x: 100, y: 100 }, 16);
    expect(plan.fillCircle).toEqual({ pos: { x: 94, y: 94 }, r: 2 });
    expect(plan.lines).toEqual([
      { a: { x: 94, y: 94 }, b: { x: 108, y: 94 } }, // 94 + (16-2)
      { a: { x: 94, y: 94 }, b: { x: 94, y: 108 } },
    ]);
  });

  it('DrawQuadrantPointIcon: the node sits 6px above centre, the arc is the top half through it', () => {
    // nodeRadius = 2; quadPoint = (100,100) - (0, 8-2) = (100, 94)
    // arcRadius = 16 - 2*2 = 12; arcCenter = (100, 94) + (0, 12) = (100, 106)
    const plan = quadrantPointIconPlan({ x: 100, y: 100 }, 16);
    expect(plan.fillCircle).toEqual({ pos: { x: 100, y: 94 }, r: 2 });
    expect(plan.arc).toEqual({ center: { x: 100, y: 106 }, r: 12, startDeg: -160, sweepDeg: 140 });
  });
});
