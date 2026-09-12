// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/libs/kimath/geometry/test_shape_nearest_points.cpp`
 * (SHAPE_NEAREST_POINTS_TEST), transcribed against the SHAPE family.
 */
import { describe, expect, it } from 'vitest';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_CIRCLE } from '@ziroeda/kimath/src/geometry/shape_circle.js';
import { SHAPE_COMPOUND } from '@ziroeda/kimath/src/geometry/shape_compound.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_RECT } from '@ziroeda/kimath/src/geometry/shape_rect.js';
import { SHAPE_SEGMENT } from '@ziroeda/kimath/src/geometry/shape_segment.js';
import { EuclideanNormI, ResizeI, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): VECTOR2I => ({ x, y });
const norm = (a: VECTOR2I, b: VECTOR2I): number => EuclideanNormI({ x: b.x - a.x, y: b.y - a.y });

describe('SHAPE_NEAREST_POINTS_TEST', () => {
  // Circle to Circle tests
  it('NearestPoints_CircleToCircle_Separate', () => {
    const circleA = new SHAPE_CIRCLE(V(0, 0), 5);
    const circleB = new SHAPE_CIRCLE(V(20, 0), 5);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = circleA.NearestPoints(circleB, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(5, 0));
    expect(ptB).toEqual(V(15, 0));
  });

  it('NearestPoints_CircleToCircle_Concentric', () => {
    const circleA = new SHAPE_CIRCLE(V(0, 0), 5);
    const circleB = new SHAPE_CIRCLE(V(0, 0), 10);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = circleA.NearestPoints(circleB, ptA, ptB);

    expect(result).toBe(true);
    // For concentric circles, points should be on arbitrary direction (positive X by convention)
    expect(ptA).toEqual(V(5, 0));
    expect(ptB).toEqual(V(10, 0));
  });

  it('NearestPoints_CircleToCircle_Overlapping', () => {
    const circleA = new SHAPE_CIRCLE(V(0, 0), 5);
    const circleB = new SHAPE_CIRCLE(V(6, 0), 5);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = circleA.NearestPoints(circleB, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(5, 0));
    expect(ptB).toEqual(V(1, 0));
  });

  // Circle to Rectangle tests
  it('NearestPoints_CircleToRect_Outside', () => {
    const circle = new SHAPE_CIRCLE(V(-10, 5), 3);
    const rect = new SHAPE_RECT(V(0, 0), V(10, 10));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = circle.NearestPoints(rect, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(-7, 5));
    expect(ptB).toEqual(V(0, 5));
  });

  it('NearestPoints_CircleToRect_Inside', () => {
    const circle = new SHAPE_CIRCLE(V(5, 5), 2);
    const rect = new SHAPE_RECT(V(0, 0), V(10, 10));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = circle.NearestPoints(rect, ptA, ptB);

    expect(result).toBe(true);
    // Circle center is inside rectangle, should find nearest edge
    // Center at (5,5) is equidistant from left/right edges (5 units) and top/bottom edges (5 units)
    // Implementation should choose one consistently - likely left edge based on min comparison
    expect(ptA).toEqual(V(3, 5));
    expect(ptB).toEqual(V(0, 5));
  });

  // Circle to Segment tests
  it('NearestPoints_CircleToSegment', () => {
    const circle = new SHAPE_CIRCLE(V(0, 5), 2);
    const segment = new SHAPE_SEGMENT(V(-5, 0), V(5, 0));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = circle.NearestPoints(segment, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(0, 3));
    expect(ptB).toEqual(V(0, 0));
  });

  it('NearestPoints_CircleToSegment_CenterOnSegment', () => {
    const circle = new SHAPE_CIRCLE(V(0, 0), 3);
    const segment = new SHAPE_SEGMENT(V(-5, 0), V(5, 0));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = circle.NearestPoints(segment, ptA, ptB);

    expect(result).toBe(true);
    // When center is on segment, should pick perpendicular direction
    expect(ptA).toEqual(V(0, 3));
    expect(ptB).toEqual(V(0, 0));
  });

  // Rectangle to Rectangle tests
  it('NearestPoints_RectToRect_Separate', () => {
    const rectA = new SHAPE_RECT(V(0, 0), V(5, 5));
    const rectB = new SHAPE_RECT(V(10, 0), V(25, 25));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = rectA.NearestPoints(rectB, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(5, 0));
    expect(ptB).toEqual(V(10, 0));
  });

  it('NearestPoints_RectToRect_Corner', () => {
    const rectA = new SHAPE_RECT(V(0, 0), V(5, 5));
    const rectB = new SHAPE_RECT(V(7, 7), V(25, 25));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = rectA.NearestPoints(rectB, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(5, 5));
    expect(ptB).toEqual(V(7, 7));
  });

  // Line Chain tests
  it('NearestPoints_LineChainToLineChain', () => {
    const chainA = new SHAPE_LINE_CHAIN();
    chainA.Append(V(0, 0));
    chainA.Append(V(10, 0));
    chainA.Append(V(10, 10));

    const chainB = new SHAPE_LINE_CHAIN();
    chainB.Append(V(5, 5));
    chainB.Append(V(15, 5));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = chainA.NearestPoints(chainB, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(10, 5));
    expect(ptB).toEqual(V(10, 5));
  });

  it('NearestPoints_LineChainWithArc', () => {
    const chainA = new SHAPE_LINE_CHAIN();
    chainA.Append(V(0, 0));
    chainA.Append(V(10, 0));

    const chainB = new SHAPE_LINE_CHAIN();
    chainB.Append(new SHAPE_ARC(V(5, 10), V(10, 5), V(15, 10), 0));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = chainA.NearestPoints(chainB, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(10, 0));
    expect(ptB).toEqual(V(10, 10));
  });

  // Arc tests
  it('NearestPoints_ArcToArc', () => {
    const arcA = new SHAPE_ARC(V(0, 0), V(5, 5), V(10, 0), 0);
    const arcB = new SHAPE_ARC(V(15, 0), V(20, 5), V(25, 0), 0);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const distSq = { value: 0 };
    const result = arcA.NearestPoints(arcB, ptA, ptB, distSq);

    expect(result).toBe(true);
    // Points should be on the arcs closest to each other
    expect(ptA.x <= 10 && ptA.x >= 0).toBe(true);
    expect(ptB.x >= 15 && ptB.x <= 25).toBe(true);
  });

  it('NearestPoints_ArcToCircle', () => {
    const arc = new SHAPE_ARC(V(0, 0), V(5, 5), V(10, 0), 0);
    const circle = new SHAPE_CIRCLE(V(5, 10), 3);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const distSq = { value: 0 };
    const result = arc.NearestPoints(circle, ptA, ptB, distSq);

    expect(result).toBe(true);
    // Arc point should be at or near the top of the arc
    expect(ptA.y >= 0).toBe(true);
    // Circle point should be at bottom of circle
    expect(ptB).toEqual(V(5, 7));
  });

  // Segment tests
  it('NearestPoints_SegmentToSegment', () => {
    const segA = new SHAPE_SEGMENT(new SEG(V(0, 0), V(10, 0)), 2);
    const segB = new SHAPE_SEGMENT(new SEG(V(5, 5), V(5, 15)), 2);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = segA.NearestPoints(segB, ptA, ptB);

    expect(result).toBe(true);
    // Points should account for segment width
    expect(ptA).toEqual(V(5, 1));
    expect(ptB).toEqual(V(5, 4));
  });

  it('NearestPoints_SegmentToCircle', () => {
    const segment = new SHAPE_SEGMENT(new SEG(V(0, 0), V(10, 0)), 4);
    const circle = new SHAPE_CIRCLE(V(5, 10), 3);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = segment.NearestPoints(circle, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(5, 2));
    expect(ptB).toEqual(V(5, 7));
  });

  // Compound Shape tests
  it('NearestPoints_CompoundShapes', () => {
    const compoundA = new SHAPE_COMPOUND();
    compoundA.AddShape(new SHAPE_CIRCLE(V(0, 0), 5));
    compoundA.AddShape(new SHAPE_RECT(V(10, 0), V(5, 5)));

    const compoundB = new SHAPE_COMPOUND();
    compoundB.AddShape(new SHAPE_CIRCLE(V(20, 0), 3));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = compoundA.NearestPoints(compoundB, ptA, ptB);

    expect(result).toBe(true);
    // Should find nearest points between rectangle in A and circle in B
    expect(ptA).toEqual(V(10, 0));
    expect(ptB).toEqual(V(17, 0));
  });

  // Polygon Set tests
  it('NearestPoints_PolySetToCircle', () => {
    const polySet = new SHAPE_POLY_SET();
    polySet.NewOutline();
    polySet.Append(V(0, 0));
    polySet.Append(V(10, 0));
    polySet.Append(V(10, 10));
    polySet.Append(V(0, 10));

    const circle = new SHAPE_CIRCLE(V(15, 5), 3);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = polySet.NearestPoints(circle, ptA, ptB);

    expect(result).toBe(true);
    expect(ptB).toEqual(V(12, 5));
  });

  // Missing Basic Shape Combinations
  it('NearestPoints_RectToSegment', () => {
    const rect = new SHAPE_RECT(V(0, 0), V(10, 10));
    const segment = new SHAPE_SEGMENT(V(15, 5), V(25, 5));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = rect.NearestPoints(segment, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(10, 5));
    expect(ptB).toEqual(V(15, 5));
  });

  it('NearestPoints_RectToLineChain', () => {
    const rect = new SHAPE_RECT(V(0, 0), V(5, 5));

    const chain = new SHAPE_LINE_CHAIN();
    chain.Append(V(10, 0));
    chain.Append(V(15, 5));
    chain.Append(V(10, 10));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = rect.NearestPoints(chain, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(5, 0));
    expect(ptB).toEqual(V(10, 0));
  });

  it('NearestPoints_SegmentToLineChain', () => {
    const segment = new SHAPE_SEGMENT(new SEG(V(0, 0), V(100, 0)), 20);

    const chain = new SHAPE_LINE_CHAIN();
    chain.Append(V(50, 100));
    chain.Append(V(150, 100));
    chain.Append(V(150, 50));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = segment.NearestPoints(chain, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(107, 7));
    expect(ptB).toEqual(V(150, 50));
  });

  it('NearestPoints_CircleToLineChain', () => {
    const circle = new SHAPE_CIRCLE(V(0, 0), 3);

    const chain = new SHAPE_LINE_CHAIN();
    chain.Append(V(10, -5));
    chain.Append(V(10, 0));
    chain.Append(V(10, 5));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = circle.NearestPoints(chain, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(3, 0));
    expect(ptB).toEqual(V(10, 0));
  });

  it('NearestPoints_ArcToRect', () => {
    const arc = new SHAPE_ARC(V(0, 0), V(5, 5), V(10, 0), 0);
    const rect = new SHAPE_RECT(V(150, 2), V(50, 6));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const distSq = { value: 0 };
    const result = arc.NearestPoints(rect, ptA, ptB, distSq);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(10, 0));
    expect(ptB).toEqual(V(50, 2));
  });

  it('NearestPoints_ArcToSegment', () => {
    const arc = new SHAPE_ARC(V(0, 0), V(0, 10), V(0, 20), 0); // Semicircle
    const segment = new SEG(V(15, 10), V(25, 10));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const distSq = { value: 0 };
    const result = arc.NearestPoints(segment, ptA, ptB, distSq);

    expect(result).toBe(true);
    // Arc point should be on the rightmost part of the arc
    expect(ptA.x >= 0).toBe(true);
    expect(ptB).toEqual(V(15, 10));
  });

  it('NearestPoints_ArcToLineChain', () => {
    const arc = new SHAPE_ARC(V(0, 0), V(5, 5), V(10, 0), 0);

    const chain = new SHAPE_LINE_CHAIN();
    chain.Append(V(5, 15));
    chain.Append(V(5, 10));
    chain.Append(V(15, 10));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = chain.NearestPoints(arc, ptB, ptA);

    expect(result).toBe(true);
    // Arc point should be near the top of the arc
    expect(ptA).toEqual(V(5, 5));
    expect(ptB).toEqual(V(5, 10));
  });

  // Distance and Symmetry Validation Tests
  it('NearestPoints_DistanceValidation', () => {
    const circleA = new SHAPE_CIRCLE(V(0, 0), 5);
    const circleB = new SHAPE_CIRCLE(V(20, 0), 3);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = circleA.NearestPoints(circleB, ptA, ptB);

    expect(result).toBe(true);

    // Calculate expected distance: center distance - both radii
    const expectedDistance = 20 - 5 - 3; // 12
    const actualDistance = norm(ptA, ptB);

    expect(actualDistance).toBe(expectedDistance);
  });

  it('NearestPoints_SymmetryTest', () => {
    const rectA = new SHAPE_RECT(V(0, 0), V(5, 5));
    const circleB = new SHAPE_CIRCLE(V(10, 2), 2);

    // Test A->B
    const ptA1 = V(0, 0);
    const ptB1 = V(0, 0);
    const result1 = rectA.NearestPoints(circleB, ptA1, ptB1);

    // Test B->A
    const ptA2 = V(0, 0);
    const ptB2 = V(0, 0);
    const result2 = circleB.NearestPoints(rectA, ptA2, ptB2);

    expect(result1 && result2).toBe(true);

    // Distance should be the same both ways
    const dist1 = norm(ptA1, ptB1);
    const dist2 = norm(ptA2, ptB2);

    expect(dist1).toBe(dist2);

    // Points should be swapped (ptA1 should equal ptB2, ptB1 should equal ptA2)
    expect(ptA1).toEqual(ptB2);
    expect(ptB1).toEqual(ptA2);
  });

  it('NearestPoints_MinimumDistanceValidation', () => {
    const segment = new SHAPE_SEGMENT(new SEG(V(0, 0), V(10, 0)), 0);
    const circle = new SHAPE_CIRCLE(V(5, 5), 2);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = segment.NearestPoints(circle, ptA, ptB);

    expect(result).toBe(true);

    // Verify that this is indeed the minimum distance by checking nearby points
    const minDist = norm(ptA, ptB);

    // Check a few other points on the segment
    for (let x = 0; x <= 10; x += 2) {
      const testPt = V(x, 0);
      const c = circle.GetCenter();
      const r = ResizeI({ x: testPt.x - c.x, y: testPt.y - c.y }, circle.GetRadius());
      const circleClosest = V(c.x + r.x, c.y + r.y);
      const testDist = norm(testPt, circleClosest);

      expect(
        minDist,
        `Found shorter distance at x=${x}: ${testDist} vs ${minDist}`,
      ).toBeLessThanOrEqual(testDist);
    }
  });

  // Complex Line Chain Tests
  it('NearestPoints_LineChainWithMixedArcs', () => {
    const chainA = new SHAPE_LINE_CHAIN();
    chainA.Append(V(0, 0));
    chainA.Append(V(10, 0));
    chainA.Append(new SHAPE_ARC(V(10, 0), V(15, 5), V(20, 0), 0));
    chainA.Append(V(30, 0));

    const circle = new SHAPE_CIRCLE(V(15, 15), 3);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = chainA.NearestPoints(circle, ptA, ptB);

    expect(result).toBe(true);
    expect(ptB).toEqual(V(15, 12));
  });

  // Degenerate Shape Tests
  it('NearestPoints_DegenerateShapes_ZeroWidthRect', () => {
    const rectA = new SHAPE_RECT(V(0, 0), V(0, 10)); // Zero width
    const circle = new SHAPE_CIRCLE(V(5, 5), 2);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = rectA.NearestPoints(circle, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(0, 5));
    expect(ptB).toEqual(V(3, 5));
  });

  it('NearestPoints_DegenerateShapes_ZeroLengthSegment', () => {
    const zeroSeg = new SHAPE_SEGMENT(V(5, 5), V(5, 5)); // Point segment
    const circle = new SHAPE_CIRCLE(V(10, 5), 3);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = circle.NearestPoints(zeroSeg, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(7, 5));
    expect(ptB).toEqual(V(5, 5));
  });

  it('NearestPoints_SinglePointLineChain', () => {
    const singlePoint = new SHAPE_LINE_CHAIN();
    singlePoint.Append(V(0, 0));

    const circle = new SHAPE_CIRCLE(V(5, 0), 2);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = singlePoint.NearestPoints(circle, ptA, ptB);

    expect(result).toBe(false);
  });

  // Negative Coordinate Tests
  it('NearestPoints_NegativeCoordinates', () => {
    const circleA = new SHAPE_CIRCLE(V(-10, -5), 3);
    const rect = new SHAPE_RECT(V(0, -2), V(5, 4));

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = circleA.NearestPoints(rect, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(-7, -4));
    expect(ptB).toEqual(V(0, -2));
  });

  // Edge case tests
  it('NearestPoints_IdenticalShapes', () => {
    const circleA = new SHAPE_CIRCLE(V(5, 5), 3);
    const circleB = new SHAPE_CIRCLE(V(5, 5), 3);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = circleA.NearestPoints(circleB, ptA, ptB);

    expect(result).toBe(true);
    // Identical concentric circles - should return arbitrary points
    expect(ptA).toEqual(V(8, 5));
    expect(ptB).toEqual(V(8, 5));
  });

  it('NearestPoints_ZeroSizeShapes', () => {
    const circleA = new SHAPE_CIRCLE(V(0, 0), 0);
    const circleB = new SHAPE_CIRCLE(V(10, 0), 5);

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = circleA.NearestPoints(circleB, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(0, 0));
    expect(ptB).toEqual(V(5, 0));
  });

  it('NearestPoints_VeryCloseShapes', () => {
    const circleA = new SHAPE_CIRCLE(V(0, 0), 5);
    const circleB = new SHAPE_CIRCLE(V(10, 0), 5); // Just touching

    const ptA = V(0, 0);
    const ptB = V(0, 0);
    const result = circleA.NearestPoints(circleB, ptA, ptB);

    expect(result).toBe(true);
    expect(ptA).toEqual(V(5, 0));
    expect(ptB).toEqual(V(5, 0));
  });
});
