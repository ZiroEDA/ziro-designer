// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/libs/kimath/geometry/test_shape_compound_collision.cpp`
 * (SCompoundCollision), transcribed against `SHAPE_COMPOUND`.
 */
import { describe, expect, it } from 'vitest';
import type { SHAPE } from '@ziroeda/kimath/src/geometry/shape.js';
import { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import { SHAPE_COMPOUND } from '@ziroeda/kimath/src/geometry/shape_compound.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): VECTOR2I => ({ x, y });

/**
 * Fixture for the Collision test suite. It contains an instance of the common data and two
 * vectors containing colliding and non-colliding points.
 */
class ShapeCompoundCollisionFixture {
  shapesA: SHAPE[] = [];
  shapesB: SHAPE[] = [];
  shapesC: SHAPE[] = [];

  compoundA: SHAPE_COMPOUND;
  compoundB: SHAPE_COMPOUND;
  compoundC: SHAPE_COMPOUND;

  constructor() {
    this.shapesA.push(new SHAPE_CIRCLE(V(0, 0), 100));
    this.shapesA.push(new SHAPE_CIRCLE(V(80, 0), 100));

    this.shapesB.push(new SHAPE_CIRCLE(V(0, 80), 100));
    this.shapesB.push(new SHAPE_CIRCLE(V(80, 80), 100));

    this.shapesC.push(new SHAPE_CIRCLE(V(0, 280), 100));
    this.shapesC.push(new SHAPE_CIRCLE(V(80, 280), 100));

    this.compoundA = new SHAPE_COMPOUND(this.shapesA);
    this.compoundB = new SHAPE_COMPOUND(this.shapesB);
    this.compoundC = new SHAPE_COMPOUND(this.shapesC);
  }
}

describe('SCompoundCollision', () => {
  const f = new ShapeCompoundCollisionFixture();
  const { shapesA, shapesB, shapesC, compoundA, compoundB, compoundC } = f;

  it('ShapeCompoundCollide', () => {
    const actual = { value: 0 };
    // Check points on corners
    expect(compoundA.Collide(compoundB, 0, actual)).toBe(true);
    expect(actual.value).toBe(0);

    expect(compoundA.Collide(compoundC, 0, actual)).toBe(false);
    expect(actual.value).toBe(0);

    expect(compoundA.Collide(compoundC, 100, actual)).toBe(true);
    expect(actual.value).toBe(80);

    expect(shapesA[0]!.Collide(compoundB, 0)).toBe(true);
    expect(shapesA[1]!.Collide(compoundB, 0)).toBe(true);
    expect(compoundB.Collide(shapesA[0]!, 0)).toBe(true);
    expect(compoundB.Collide(shapesA[1]!, 0)).toBe(true);

    expect(shapesB[0]!.Collide(compoundA, 0)).toBe(true);
    expect(shapesB[1]!.Collide(compoundA, 0)).toBe(true);
    expect(compoundA.Collide(shapesB[0]!, 0)).toBe(true);
    expect(compoundA.Collide(shapesB[1]!, 0)).toBe(true);

    expect(shapesC[0]!.Collide(compoundA, 0)).toBe(false);
    expect(shapesC[1]!.Collide(compoundA, 0)).toBe(false);
    expect(compoundA.Collide(shapesC[0]!, 0)).toBe(false);
    expect(compoundA.Collide(shapesC[1]!, 0)).toBe(false);

    expect(shapesA[0]!.Collide(compoundC, 0)).toBe(false);
    expect(shapesA[1]!.Collide(compoundC, 0)).toBe(false);
    expect(compoundC.Collide(shapesA[0]!, 0)).toBe(false);
    expect(compoundC.Collide(shapesA[1]!, 0)).toBe(false);

    expect(shapesC[0]!.Collide(compoundA, 100, actual)).toBe(true);
    expect(actual.value).toBe(80);
    expect(shapesC[1]!.Collide(compoundA, 100, actual)).toBe(true);
    expect(actual.value).toBe(80);
    expect(compoundA.Collide(shapesC[0]!, 100, actual)).toBe(true);
    expect(actual.value).toBe(80);
    expect(compoundA.Collide(shapesC[1]!, 100, actual)).toBe(true);
    expect(actual.value).toBe(80);
  });
});
