// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/libs/kimath/geometry/test_shape_line_chain_collision.cpp`
 * (SHAPE_LINE_CHAIN_COLLIDE_TEST), transcribed against `SHAPE_LINE_CHAIN`.
 */
import { describe, expect, it } from 'vitest';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): VECTOR2I => ({ x, y });

describe('SHAPE_LINE_CHAIN_COLLIDE_TEST', () => {
  it('Collide_LineToLine', () => {
    const lineA = new SHAPE_LINE_CHAIN();
    lineA.Append(V(0, 0));
    lineA.Append(V(10, 0));

    const lineB = new SHAPE_LINE_CHAIN();
    lineB.Append(V(5, 5));
    lineB.Append(V(5, -5));

    const location = V(0, 0);
    const actual = { value: 0 };
    const collided = lineA.Collide(lineB, 0, actual, location);

    expect(collided).toBe(true);
    expect(actual.value).toBe(0);
    expect(location).toEqual(V(5, 0));
  });

  it('Collide_LineToArc', () => {
    const lineA = new SHAPE_LINE_CHAIN();
    lineA.Append(V(0, 0));
    lineA.Append(V(10, 0));

    const arcB = new SHAPE_LINE_CHAIN();
    arcB.Append(new SHAPE_ARC(V(5, 5), V(6, 4), V(7, 0), 0));

    const location = V(0, 0);
    const actual = { value: 0 };
    const collided = lineA.Collide(arcB, 0, actual, location);

    expect(collided).toBe(true);
    expect(actual.value).toBe(0);
    expect(location).toEqual(V(7, 0));
  });

  it('Collide_ArcToArc', () => {
    const arcA = new SHAPE_LINE_CHAIN();
    arcA.Append(new SHAPE_ARC(V(0, 0), V(10, 0), V(5, 5), 0));

    const arcB = new SHAPE_LINE_CHAIN();
    arcB.Append(new SHAPE_ARC(V(5, 5), V(5, -5), V(10, 0), 0));

    const location = V(0, 0);
    const actual = { value: 0 };
    const collided = arcA.Collide(arcB, 0, actual, location);

    expect(collided).toBe(true);
    expect(actual.value).toBe(0);
    expect(location).toEqual(V(5, 5));
  });

  it('Collide_WithClearance', () => {
    const lineA = new SHAPE_LINE_CHAIN();
    lineA.Append(V(0, 0));
    lineA.Append(V(10, 0));

    const lineB = new SHAPE_LINE_CHAIN();
    lineB.Append(V(5, 6));
    lineB.Append(V(-5, 6));

    const location = V(0, 0);
    const actual = { value: 0 };
    const collided = lineA.Collide(lineB, 7, actual, location);

    expect(collided).toBe(true);
    expect(actual.value).toBe(6);
    expect(location).toEqual(V(0, 0));
  });

  it('Collide_NoClearance', () => {
    const lineA = new SHAPE_LINE_CHAIN();
    lineA.Append(V(0, 0));
    lineA.Append(V(10, 0));

    const lineB = new SHAPE_LINE_CHAIN();
    lineB.Append(V(5, 6));
    lineB.Append(V(-5, 6));

    const location = V(0, 0);
    const actual = { value: 0 };
    const collided = lineA.Collide(lineB, 0, actual, location);

    expect(collided).toBe(false);
    expect(actual.value).toBe(0);
  });
});
