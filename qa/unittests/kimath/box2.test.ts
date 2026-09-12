// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/libs/kimath/math/test_box2.cpp` (BOX2TESTS), transcribed. The
 * `Constexpr` case is the same expectations evaluated at run time.
 */
import { describe, expect, it } from 'vitest';
import { BOX2D, BOX2I } from '@ziroeda/kimath/src/math/box2.js';

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tol = 0.000001): void => {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tol);
};

describe('BOX2TESTS', () => {
  it('DefaultConstructor', () => {
    const box = new BOX2I();
    expect(box.GetPosition()).toEqual({ x: 0, y: 0 });
    expect(box.GetSize()).toEqual({ x: 0, y: 0 });
  });

  it('BasicInt', () => {
    const box = new BOX2I({ x: 1, y: 2 }, { x: 3, y: 4 });
    expect(box.GetPosition()).toEqual({ x: 1, y: 2 });
    expect(box.GetSize()).toEqual({ x: 3, y: 4 });

    // Check the equality operator
    expect(box.equals(new BOX2I({ x: 1, y: 2 }, { x: 3, y: 4 }))).toBe(true);

    // Inflate in-place
    const inflated = box.Clone();
    inflated.Inflate(1);
    expect(inflated.GetPosition()).toEqual({ x: 0, y: 1 });
    expect(inflated.GetSize()).toEqual({ x: 5, y: 6 });

    // GetInflated
    const inflated2 = box.GetInflated(1);
    expect(inflated2.equals(inflated)).toBe(true);
  });

  it('Constexpr', () => {
    const box_1_2__3_4 = new BOX2I({ x: 1, y: 2 }, { x: 3, y: 4 });
    expect(box_1_2__3_4.GetPosition()).toEqual({ x: 1, y: 2 });
    expect(box_1_2__3_4.GetSize()).toEqual({ x: 3, y: 4 });

    const box0_1__5_6 = box_1_2__3_4.GetInflated(1);
    expect(box0_1__5_6.GetPosition()).toEqual({ x: 0, y: 1 });
    expect(box0_1__5_6.GetSize()).toEqual({ x: 5, y: 6 });

    expect(box_1_2__3_4.SquaredDiagonal()).toBeLessThan(box0_1__5_6.SquaredDiagonal());

    const box1_2__100_4 = box_1_2__3_4.GetWithOffset({ x: 100, y: 0 }).Merge(box_1_2__3_4);
    expect(box1_2__100_4.GetPosition()).toEqual({ x: 1, y: 2 });
    expect(box1_2__100_4.GetSize()).toEqual({ x: 103, y: 4 });
  });

  it('BasicDouble', () => {
    const box = new BOX2D({ x: 1.0, y: 2.0 }, { x: 3.0, y: 4.0 });

    // Inflate by non-integer amount
    const inflated = box.Clone().Inflate(1.5);
    near(inflated.GetPosition(), { x: -0.5, y: 0.5 });
    near(inflated.GetSize(), { x: 6.0, y: 7.0 });
  });

  it('ByCorners', () => {
    const boxByCorners = BOX2I.ByCorners({ x: 1, y: 2 }, { x: 3, y: 4 });
    const boxByPosSize = new BOX2I({ x: 1, y: 2 }, { x: 2, y: 2 });
    expect(boxByCorners.equals(boxByPosSize)).toBe(true);
  });

  it('ByCentre', () => {
    const boxByCenter = BOX2I.ByCenter({ x: 100, y: 100 }, { x: 20, y: 20 });
    const boxByPosSize = new BOX2I({ x: 90, y: 90 }, { x: 20, y: 20 });
    expect(boxByCenter.equals(boxByPosSize)).toBe(true);
  });

  it('test_closest_point_to', () => {
    const box = new BOX2D({ x: 1, y: 2 }, { x: 3, y: 4 });

    // check all quadrants
    near(box.NearestPoint({ x: 0, y: 0 }), { x: 1, y: 2 }); // top left
    near(box.NearestPoint({ x: 2, y: 0 }), { x: 2, y: 2 }); // top
    near(box.NearestPoint({ x: 6, y: 0 }), { x: 4, y: 2 }); // top right
    near(box.NearestPoint({ x: 6, y: 5 }), { x: 4, y: 5 }); // right
    near(box.NearestPoint({ x: 6, y: 7 }), { x: 4, y: 6 }); // bottom right
    near(box.NearestPoint({ x: 3, y: 7 }), { x: 3, y: 6 }); // bottom
    near(box.NearestPoint({ x: 0, y: 7 }), { x: 1, y: 6 }); // bottom left
    near(box.NearestPoint({ x: 0, y: 3 }), { x: 1, y: 3 }); // left
    near(box.NearestPoint({ x: 2, y: 4 }), { x: 2, y: 4 }); // inside
  });

  it('test_farthest_point_to', () => {
    const box = new BOX2D({ x: 1, y: 2 }, { x: 3, y: 4 });

    // note: the farthest point always is on a corner of the box
    // outside:
    near(box.FarthestPointTo({ x: 0, y: 0 }), { x: 4, y: 6 }); // top left
    near(box.FarthestPointTo({ x: 6, y: 0 }), { x: 1, y: 6 }); // top right
    near(box.FarthestPointTo({ x: 6, y: 7 }), { x: 1, y: 2 }); // bottom right
    near(box.FarthestPointTo({ x: 0, y: 7 }), { x: 4, y: 2 }); // bottom left
    // inside:
    near(box.FarthestPointTo({ x: 2, y: 3 }), { x: 4, y: 6 }); // top left
    near(box.FarthestPointTo({ x: 3, y: 3 }), { x: 1, y: 6 }); // top right
    near(box.FarthestPointTo({ x: 3, y: 5 }), { x: 1, y: 2 }); // bottom right
    near(box.FarthestPointTo({ x: 2, y: 5 }), { x: 4, y: 2 }); // bottom left
  });

  it('test_intersects_circle', () => {
    const box = new BOX2D({ x: 1, y: 2 }, { x: 6, y: 8 });

    expect(box.IntersectsCircle({ x: 4, y: 6 }, 5)).toBe(true); // box inside circle (touching corners)
    expect(box.IntersectsCircle({ x: 4, y: 6 }, 6)).toBe(true); // box completely inside circle
    expect(box.IntersectsCircle({ x: 4, y: 6 }, 2)).toBe(true); // circle completely inside box
    expect(box.IntersectsCircle({ x: 14, y: 6 }, 5)).toBe(false); // circle outside box
  });

  it('test_intersects_circle_edge', () => {
    const box = new BOX2D({ x: 1, y: 2 }, { x: 6, y: 8 });

    expect(box.IntersectsCircleEdge({ x: 4, y: 6 }, 5, 1)).toBe(true); // box touching edge
    expect(box.IntersectsCircleEdge({ x: 4, y: 6 }, 6, 1)).toBe(false); // box completely inside circle
    expect(box.IntersectsCircleEdge({ x: 4, y: 6 }, 2, 1)).toBe(true); // circle completely inside box
    expect(box.IntersectsCircleEdge({ x: 14, y: 6 }, 5, 1)).toBe(false); // circle outside box
  });
});

// Behaviour the C++ suite leaves to the header and the port has to get right on
// its own: integer halving, the uninitialised-box Merge, and the deflate floor.
describe('BOX2I semantics the template decides', () => {
  it('Centre truncates the half size like int division', () => {
    expect(new BOX2I({ x: 0, y: 0 }, { x: 3, y: 5 }).Centre()).toEqual({ x: 1, y: 2 });
    expect(new BOX2I({ x: -10, y: -10 }, { x: 3, y: 3 }).Centre()).toEqual({ x: -9, y: -9 });
    expect(new BOX2D({ x: 0, y: 0 }, { x: 3, y: 5 }).Centre()).toEqual({ x: 1.5, y: 2.5 });
  });

  it('a default box adopts the first Merge outright, and IsValid follows m_init', () => {
    const b = new BOX2I();
    expect(b.IsValid()).toBe(false);
    b.Merge({ x: 50, y: 60 });
    expect(b.IsValid()).toBe(true);
    expect(b.GetPosition()).toEqual({ x: 50, y: 60 });
    expect(b.GetSize()).toEqual({ x: 0, y: 0 });
    b.Merge(new BOX2I({ x: 10, y: 70 }, { x: 5, y: 5 }));
    expect(b.GetPosition()).toEqual({ x: 10, y: 60 });
    expect(b.GetEnd()).toEqual({ x: 50, y: 75 });
  });

  it('Inflate by a negative amount stops at zero size, centred', () => {
    const b = new BOX2I({ x: 0, y: 0 }, { x: 10, y: 10 });
    b.Inflate(-8);
    expect(b.GetSize()).toEqual({ x: 0, y: 0 });
    expect(b.GetPosition()).toEqual({ x: 5, y: 5 });
  });

  it('the constructor normalises a negative size', () => {
    const b = new BOX2I({ x: 10, y: 10 }, { x: -4, y: -6 });
    expect(b.GetPosition()).toEqual({ x: 6, y: 4 });
    expect(b.GetSize()).toEqual({ x: 4, y: 6 });
  });

  it('Contains is edge-inclusive; Intersects needs a shared point', () => {
    const b = new BOX2I({ x: 0, y: 0 }, { x: 10, y: 10 });
    expect(b.Contains({ x: 10, y: 10 })).toBe(true);
    expect(b.Contains({ x: 11, y: 10 })).toBe(false);
    expect(b.Intersects(new BOX2I({ x: 10, y: 10 }, { x: 5, y: 5 }))).toBe(true);
    expect(b.Intersects(new BOX2I({ x: 11, y: 11 }, { x: 5, y: 5 }))).toBe(false);
    // a segment through the box that has neither end inside
    expect(b.Intersects({ x: -5, y: 5 }, { x: 15, y: 5 })).toBe(true);
    expect(b.Intersects({ x: -5, y: 15 }, { x: 15, y: 15 })).toBe(false);
  });
});
