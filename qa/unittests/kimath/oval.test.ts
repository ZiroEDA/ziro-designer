// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/libs/kimath/geometry/test_oval.cpp` (Oval), transcribed against
 * `KIGEOM_GetOvalKeyPoints`.
 */
import { describe, expect, it } from 'vitest';
import { ANGLE_45 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KIGEOM_GetOvalKeyPoints, OVAL_KEY_POINTS } from '@ziroeda/kimath/src/geometry/oval.js';
import {
  PT_CENTER,
  PT_END,
  PT_MID,
  PT_QUADRANT,
  TYPED_POINT2I,
} from '@ziroeda/kimath/src/geometry/point_types.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { GetRotated } from '@ziroeda/kimath/src/trigo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): VECTOR2I => ({ x, y });
const TP = (p: [number, number], t: number): TYPED_POINT2I => new TYPED_POINT2I(V(p[0], p[1]), t);
const fmt = (p: TYPED_POINT2I): string => `(${p.m_point.x}, ${p.m_point.y}) t=${p.m_types}`;

/**
 * Check that two collections contain the same elements, ignoring order.
 *
 * I.e. expected contains everything in actual and vice versa.
 *
 * The collections lengths are also checked to weed out unexpected duplicates.
 */
function CHECK_COLLECTIONS_SAME_UNORDERED(
  expected: TYPED_POINT2I[],
  actual: TYPED_POINT2I[],
): void {
  for (const p of expected) {
    expect(
      actual.some((a) => a.equals(p)),
      `Expected item not found: ${fmt(p)}; actual: ${actual.map(fmt).join(' ')}`,
    ).toBe(true);
  }

  for (const p of actual) {
    expect(
      expected.some((e) => e.equals(p)),
      `Unexpected item: ${fmt(p)}`,
    ).toBe(true);
  }

  expect(expected.length).toBe(actual.length);
}

interface OVAL_POINTS_TEST_CASE {
  m_oval: SHAPE_SEGMENT;
  m_expected_points: TYPED_POINT2I[];
}

function DoOvalPointTestChecks(testcase: OVAL_POINTS_TEST_CASE): void {
  const expected_points = testcase.m_expected_points;

  const actual_points = KIGEOM_GetOvalKeyPoints(
    testcase.m_oval,
    OVAL_KEY_POINTS.OVAL_ALL_KEY_POINTS,
  );

  CHECK_COLLECTIONS_SAME_UNORDERED(expected_points, actual_points);
}

describe('Oval', () => {
  it('SimpleOvalVertical', () => {
    const testcase: OVAL_POINTS_TEST_CASE = {
      m_oval: new SHAPE_SEGMENT(new SEG(V(0, -1000), V(0, 1000)), 1000),
      m_expected_points: [
        TP([0, 0], PT_CENTER),
        // Main points
        TP([0, 1500], PT_QUADRANT),
        TP([0, -1500], PT_QUADRANT),
        TP([500, 0], PT_MID),
        TP([-500, 0], PT_MID),
        // Cap centres
        TP([0, 1000], PT_CENTER),
        TP([0, -1000], PT_CENTER),
        // Side segment ends
        TP([500, 1000], PT_END),
        TP([500, -1000], PT_END),
        TP([-500, 1000], PT_END),
        TP([-500, -1000], PT_END),
        // No quadrants
      ],
    };

    DoOvalPointTestChecks(testcase);
  });

  it('SimpleOvalHorizontal', () => {
    const testcase: OVAL_POINTS_TEST_CASE = {
      m_oval: new SHAPE_SEGMENT(new SEG(V(-1000, 0), V(1000, 0)), 1000),
      m_expected_points: [
        TP([0, 0], PT_CENTER),
        // Main points
        TP([0, 500], PT_MID),
        TP([0, -500], PT_MID),
        TP([1500, 0], PT_QUADRANT),
        TP([-1500, 0], PT_QUADRANT),
        // Cap centres
        TP([1000, 0], PT_CENTER),
        TP([-1000, 0], PT_CENTER),
        // Side segment ends
        TP([1000, 500], PT_END),
        TP([1000, -500], PT_END),
        TP([-1000, 500], PT_END),
        TP([-1000, -500], PT_END),
        // No quadrants
      ],
    };

    DoOvalPointTestChecks(testcase);
  });

  it('SimpleOval45Degrees', () => {
    // In this case, it's useful to keep in mind the hypotenuse of
    // isoceles right-angled triangles is sqrt(2) times the length of the sides
    //  500 / sqrt(2) = 354
    // 1000 / sqrt(2) = 707
    // 1500 / sqrt(2) = 1061
    // 2000 / sqrt(2) = 1414

    const testcase: OVAL_POINTS_TEST_CASE = {
      m_oval: new SHAPE_SEGMENT(
        new SEG(GetRotated(V(-1500, 0), ANGLE_45), GetRotated(V(1500, 0), ANGLE_45)),
        1000,
      ),
      m_expected_points: [
        TP([0, 0], PT_CENTER),
        // Main points
        TP([1414, -1414], PT_END),
        TP([-1414, 1414], PT_END),
        TP([354, 354], PT_MID),
        TP([-354, -354], PT_MID),
        // Side segment ends
        TP([-1414, 707], PT_END),
        TP([1414, -707], PT_END),
        TP([-707, 1414], PT_END),
        TP([707, -1414], PT_END),
        // Cap centres
        TP([1061, -1061], PT_CENTER),
        TP([-1061, 1061], PT_CENTER),
        // Extremum points (always one of NSEW of a cap centre because 45 degrees)
        TP([-1061 - 500, 1061], PT_QUADRANT),
        TP([-1061, 1061 + 500], PT_QUADRANT),
        TP([1061 + 500, -1061], PT_QUADRANT),
        TP([1061, -1061 - 500], PT_QUADRANT),
      ],
    };

    DoOvalPointTestChecks(testcase);
  });
});
