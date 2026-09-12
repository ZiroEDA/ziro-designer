// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/libs/kimath/geometry/test_poly_triangulation.cpp`
 * (PolygonTriangulation), transcribed against `POLYGON_TRIANGULATION`. The
 * thread-safety and wall-clock cases are kept as plain repetitions: there are
 * no threads here and a timing assertion flakes under load.
 */
import { describe, expect, it } from 'vitest';
import { POLYGON_TRIANGULATION } from '@ziroeda/kimath/src/geometry/polygon_triangulation.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import {
  SHAPE_POLY_SET,
  TRIANGULATED_POLYGON,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): VECTOR2I => ({ x, y });

// Helper class to properly manage TRIANGULATED_POLYGON lifecycle
class TRIANGULATION_TEST_FIXTURE {
  private m_result = new TRIANGULATED_POLYGON(0);

  GetResult(): TRIANGULATED_POLYGON {
    return this.m_result;
  }

  CreateTriangulator(): POLYGON_TRIANGULATION {
    return new POLYGON_TRIANGULATION(this.m_result);
  }
}

// Helper function to create a simple square
function createSquare(size = 100, offset: VECTOR2I = V(0, 0)): SHAPE_LINE_CHAIN {
  const chain = new SHAPE_LINE_CHAIN();
  chain.Append(offset.x, offset.y);
  chain.Append(offset.x + size, offset.y);
  chain.Append(offset.x + size, offset.y + size);
  chain.Append(offset.x, offset.y + size);
  chain.SetClosed(true);
  return chain;
}

// Helper function to create a triangle
function createTriangle(size = 100, offset: VECTOR2I = V(0, 0)): SHAPE_LINE_CHAIN {
  const chain = new SHAPE_LINE_CHAIN();
  chain.Append(offset.x, offset.y);
  chain.Append(offset.x + size, offset.y);
  chain.Append(offset.x + Math.trunc(size / 2), offset.y + size);
  chain.SetClosed(true);
  return chain;
}

// Helper function to create a complex concave polygon
function createConcavePolygon(size = 100): SHAPE_LINE_CHAIN {
  const chain = new SHAPE_LINE_CHAIN();
  chain.Append(0, 0);
  chain.Append(size, 0);
  chain.Append(size, Math.trunc(size / 2));
  chain.Append(Math.trunc(size / 2), Math.trunc(size / 2)); // Create concave section
  chain.Append(Math.trunc(size / 2), size);
  chain.Append(0, size);
  chain.SetClosed(true);
  return chain;
}

// Helper function to validate triangulation result with comprehensive checks
function validateTriangulation(
  result: TRIANGULATED_POLYGON,
  original: SHAPE_LINE_CHAIN,
  strict = true,
): boolean {
  // Basic validation
  if (result.GetVertexCount() === 0) return false;

  const triangleCount = result.GetTriangleCount();
  if (triangleCount === 0) return false;

  // Validate triangle topology
  for (let i = 0; i < triangleCount; i++) {
    const triangle = result.Triangles()[i]!;

    // Check valid vertex indices
    if (
      triangle.a >= result.GetVertexCount() ||
      triangle.b >= result.GetVertexCount() ||
      triangle.c >= result.GetVertexCount()
    ) {
      return false;
    }

    // Triangle vertices should not be the same
    if (triangle.a === triangle.b || triangle.b === triangle.c || triangle.a === triangle.c)
      return false;

    // Check triangle area is positive (counter-clockwise orientation)
    if (strict && triangle.Area() <= 0) return false;
  }

  // Validate that original vertices are preserved
  if (strict && result.GetVertexCount() >= original.PointCount()) {
    const vertices = result.Vertices();
    for (let i = 0; i < original.PointCount(); i++) {
      let found = false;
      for (let j = 0; j < vertices.length; j++) {
        if (vertices[j]!.x === original.CPoint(i).x && vertices[j]!.y === original.CPoint(i).y) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
  }

  return true;
}

describe('PolygonTriangulation', () => {
  // Core functionality tests
  it('BasicTriangleTriangulation', () => {
    const fixture = new TRIANGULATION_TEST_FIXTURE();
    const triangulator = fixture.CreateTriangulator();

    const triangle = createTriangle();

    const success = triangulator.TesselatePolygon(triangle, null);

    expect(success).toBe(true);
    expect(fixture.GetResult().GetVertexCount()).toBe(3);
    expect(fixture.GetResult().GetTriangleCount()).toBe(1);
    expect(validateTriangulation(fixture.GetResult(), triangle)).toBe(true);
  });

  it('BasicSquareTriangulation', () => {
    const fixture = new TRIANGULATION_TEST_FIXTURE();
    const triangulator = fixture.CreateTriangulator();

    const square = createSquare();

    const success = triangulator.TesselatePolygon(square, null);

    expect(success).toBe(true);
    expect(fixture.GetResult().GetVertexCount()).toBe(4);
    expect(fixture.GetResult().GetTriangleCount()).toBe(2);
    expect(validateTriangulation(fixture.GetResult(), square)).toBe(true);
  });

  it('ConcavePolygonTriangulation', () => {
    const fixture = new TRIANGULATION_TEST_FIXTURE();
    const triangulator = fixture.CreateTriangulator();

    const concave = createConcavePolygon(100000);

    const success = triangulator.TesselatePolygon(concave, null);

    expect(success).toBe(true);

    const result = fixture.GetResult();
    const isValid = validateTriangulation(result, concave);
    const triangleCount = result.GetTriangleCount();

    expect(isValid).toBe(true);
    // L-shaped concave polygons should have 4 triangles
    expect(triangleCount).toBe(4);
  });

  it('HintDataOptimization', () => {
    // First triangulation without hint
    const fixture1 = new TRIANGULATION_TEST_FIXTURE();
    const triangulator1 = fixture1.CreateTriangulator();
    const square = createSquare();

    const success1 = triangulator1.TesselatePolygon(square, null);
    expect(success1).toBe(true);

    // Second triangulation with hint data from first
    const fixture2 = new TRIANGULATION_TEST_FIXTURE();
    const triangulator2 = fixture2.CreateTriangulator();

    const success2 = triangulator2.TesselatePolygon(square, fixture1.GetResult());
    expect(success2).toBe(true);

    // Results should be identical when hint is applicable
    expect(fixture1.GetResult().GetVertexCount()).toBe(fixture2.GetResult().GetVertexCount());
    expect(fixture1.GetResult().GetTriangleCount()).toBe(fixture2.GetResult().GetTriangleCount());
  });

  it('HintDataInvalidation', () => {
    // Create hint data with different vertex count
    const hintFixture = new TRIANGULATION_TEST_FIXTURE();
    const hintTriangulator = hintFixture.CreateTriangulator();
    const triangle = createTriangle();
    hintTriangulator.TesselatePolygon(triangle, null);

    // Try to use hint with different polygon (should ignore hint)
    const fixture = new TRIANGULATION_TEST_FIXTURE();
    const triangulator = fixture.CreateTriangulator();
    const square = createSquare();

    const success = triangulator.TesselatePolygon(square, hintFixture.GetResult());
    expect(success).toBe(true);
    expect(validateTriangulation(fixture.GetResult(), square)).toBe(true);
  });

  // Degenerate case handling
  it('DegeneratePolygons', () => {
    const fixture = new TRIANGULATION_TEST_FIXTURE();
    const triangulator = fixture.CreateTriangulator();

    // Test empty polygon
    const empty = new SHAPE_LINE_CHAIN();
    let success = triangulator.TesselatePolygon(empty, null);
    expect(success).toBe(true); // Should handle gracefully

    // Test single point
    const fixture2 = new TRIANGULATION_TEST_FIXTURE();
    const triangulator2 = fixture2.CreateTriangulator();
    const singlePoint = new SHAPE_LINE_CHAIN();
    singlePoint.Append(0, 0);
    singlePoint.SetClosed(true);
    success = triangulator2.TesselatePolygon(singlePoint, null);
    expect(success).toBe(true); // Should handle gracefully

    // Test two points (line segment)
    const fixture3 = new TRIANGULATION_TEST_FIXTURE();
    const triangulator3 = fixture3.CreateTriangulator();
    const line = new SHAPE_LINE_CHAIN();
    line.Append(0, 0);
    line.Append(100, 0);
    line.SetClosed(true);
    success = triangulator3.TesselatePolygon(line, null);
    expect(success).toBe(true); // Should handle gracefully
  });

  it('ZeroAreaPolygon', () => {
    const fixture = new TRIANGULATION_TEST_FIXTURE();
    const triangulator = fixture.CreateTriangulator();

    // Create a polygon with zero area (all points collinear)
    const zeroArea = new SHAPE_LINE_CHAIN();
    zeroArea.Append(0, 0);
    zeroArea.Append(100, 0);
    zeroArea.Append(50, 0);
    zeroArea.Append(25, 0);
    zeroArea.SetClosed(true);

    const success = triangulator.TesselatePolygon(zeroArea, null);

    expect(success).toBe(true); // Should handle gracefully without crashing
  });

  // Memory management and lifecycle tests
  it('MemoryManagement', () => {
    // Test that multiple triangulations properly manage memory
    for (let i = 0; i < 100; i++) {
      const fixture = new TRIANGULATION_TEST_FIXTURE();
      const triangulator = fixture.CreateTriangulator();

      const poly = createSquare(100 + i, V(i, i));
      const success = triangulator.TesselatePolygon(poly, null);

      expect(success, `i=${i}`).toBe(true);
      expect(validateTriangulation(fixture.GetResult(), poly, false), `i=${i}`).toBe(true);
    }
  });

  it('LargePolygonStressTest', () => {
    const fixture = new TRIANGULATION_TEST_FIXTURE();
    const triangulator = fixture.CreateTriangulator();

    // Create a large polygon (regular polygon with many vertices)
    const largePoly = new SHAPE_LINE_CHAIN();
    const numVertices = 1000;
    const radius = 10000;

    for (let i = 0; i < numVertices; i++) {
      const angle = (2.0 * Math.PI * i) / numVertices;
      const x = Math.trunc(radius * Math.cos(angle));
      const y = Math.trunc(radius * Math.sin(angle));
      largePoly.Append(x, y);
    }
    largePoly.SetClosed(true);

    const success = triangulator.TesselatePolygon(largePoly, null);

    expect(success).toBe(true);
    if (success) {
      expect(validateTriangulation(fixture.GetResult(), largePoly, false)).toBe(true);
      expect(fixture.GetResult().GetTriangleCount()).toBeGreaterThan(0);
    }
  });

  // Thread safety tests (following SHAPE_POLY_SET patterns); sequential here
  it('ConcurrentTriangulation', () => {
    const numThreads = 4;
    const numTriangulationsPerThread = 10;

    for (let t = 0; t < numThreads; t++) {
      for (let i = 0; i < numTriangulationsPerThread; i++) {
        const fixture = new TRIANGULATION_TEST_FIXTURE();
        const triangulator = fixture.CreateTriangulator();

        // Create unique polygon for each thread/iteration
        const poly = createSquare(100 + t * 10 + i, V(t * 100, i * 100));

        const success = triangulator.TesselatePolygon(poly, null);
        expect(
          success && validateTriangulation(fixture.GetResult(), poly, false),
          `t=${t} i=${i}`,
        ).toBe(true);
      }
    }
  });

  // Edge case and robustness tests
  it('SelfIntersectingPolygon', () => {
    const fixture = new TRIANGULATION_TEST_FIXTURE();
    const triangulator = fixture.CreateTriangulator();

    // Create a bowtie (self-intersecting polygon)
    const bowtie = new SHAPE_LINE_CHAIN();
    bowtie.Append(0, 0);
    bowtie.Append(100, 100);
    bowtie.Append(100, 0);
    bowtie.Append(0, 100);
    bowtie.SetClosed(true);

    const success = triangulator.TesselatePolygon(bowtie, null);

    // Algorithm should handle self-intersecting polygons
    expect(success).toBe(true);
    if (success) {
      expect(validateTriangulation(fixture.GetResult(), bowtie, false)).toBe(true);
    }
  });

  /**
   * Test case for GitLab issue #18083: Self-intersecting filled shape is not completely filled.
   *
   * A self-touching polygon where one vertex lies on a non-adjacent edge creates a "pinch point".
   * The polygon appears to form a figure-8 shape that should be fully filled on both sides.
   *
   * The polygon from the issue has points: (165,87), (179,87), (174,94), (169,87), (167,94)
   * where vertex (169,87) lies on the segment from (165,87) to (179,87).
   *
   * This test verifies that the triangulation correctly fills both regions of the self-touching
   * polygon by checking that the total triangulated area equals the sum of both triangular lobes.
   */
  it('Issue18083_SelfIntersectingPolygonArea', () => {
    const polySet = new SHAPE_POLY_SET();
    const outline = new SHAPE_LINE_CHAIN();

    // Coordinates from the issue (converted to internal units: 1mm = 1000000)
    const SCALE = 1000000;
    outline.Append(165 * SCALE, 87 * SCALE);
    outline.Append(179 * SCALE, 87 * SCALE);
    outline.Append(174 * SCALE, 94 * SCALE);
    outline.Append(169 * SCALE, 87 * SCALE);
    outline.Append(167 * SCALE, 94 * SCALE);
    outline.SetClosed(true);

    polySet.AddOutline(outline);

    // Verify the polygon is detected as self-intersecting
    expect(polySet.IsSelfIntersecting()).toBe(true);

    // Triangulate via SHAPE_POLY_SET
    polySet.CacheTriangulation(false);
    expect(polySet.IsTriangulationUpToDate()).toBe(true);

    // Calculate the triangulated area
    let triangulatedArea = 0.0;

    for (let ii = 0; ii < polySet.TriangulatedPolyCount(); ii++) {
      const triPoly = polySet.TriangulatedPolygon(ii);

      for (const tri of triPoly.Triangles()) triangulatedArea += Math.abs(tri.Area());
    }

    // The expected total area is 49 mm² (14 mm² + 35 mm² for the two triangular lobes)
    // Triangle 1: (165,87) - (169,87) - (167,94) = base 4mm, height 7mm = 14 mm²
    // Triangle 2: (169,87) - (179,87) - (174,94) = base 10mm, height 7mm = 35 mm²
    const expectedAreaMmSq = 49.0 * SCALE * SCALE;

    // The triangulated area should match the expected area
    expect(
      Math.abs(triangulatedArea - expectedAreaMmSq) < expectedAreaMmSq * 0.01,
      'Triangulated area should match expected area of 49 mm²',
    ).toBe(true);
  });

  it('NearlyCollinearVertices', () => {
    const fixture = new TRIANGULATION_TEST_FIXTURE();
    const triangulator = fixture.CreateTriangulator();

    // Create a polygon with vertices that are nearly collinear
    const nearlyCollinear = new SHAPE_LINE_CHAIN();
    nearlyCollinear.Append(0, 0);
    nearlyCollinear.Append(1000000, 0);
    nearlyCollinear.Append(2000000, 1); // Very small deviation
    nearlyCollinear.Append(3000000, 0);
    nearlyCollinear.Append(1500000, 1000000);
    nearlyCollinear.SetClosed(true);

    const success = triangulator.TesselatePolygon(nearlyCollinear, null);

    expect(success).toBe(true);
    if (success) {
      expect(validateTriangulation(fixture.GetResult(), nearlyCollinear, false)).toBe(true);
    }
  });

  it('DuplicateVertices', () => {
    const fixture = new TRIANGULATION_TEST_FIXTURE();
    const triangulator = fixture.CreateTriangulator();

    // Create a square with duplicate vertices
    const duplicate = new SHAPE_LINE_CHAIN();
    duplicate.Append(0, 0);
    duplicate.Append(0, 0); // Duplicate
    duplicate.Append(100, 0);
    duplicate.Append(100, 0); // Duplicate
    duplicate.Append(100, 100);
    duplicate.Append(100, 100); // Duplicate
    duplicate.Append(0, 100);
    duplicate.Append(0, 100); // Duplicate
    duplicate.SetClosed(true);

    const success = triangulator.TesselatePolygon(duplicate, null);

    expect(success).toBe(true);
    if (success) {
      expect(validateTriangulation(fixture.GetResult(), duplicate, false)).toBe(true);
    }
  });

  it('ExtremeCoordinates', () => {
    const fixture = new TRIANGULATION_TEST_FIXTURE();
    const triangulator = fixture.CreateTriangulator();

    // Test with very large coordinates
    const extreme = new SHAPE_LINE_CHAIN();
    const large = 1000000000; // 1 billion
    extreme.Append(0, 0);
    extreme.Append(large, 0);
    extreme.Append(large, large);
    extreme.Append(0, large);
    extreme.SetClosed(true);

    const success = triangulator.TesselatePolygon(extreme, null);

    expect(success).toBe(true);
    if (success) {
      expect(validateTriangulation(fixture.GetResult(), extreme, false)).toBe(true);
    }
  });

  // Error recovery and cleanup tests
  it('ErrorRecoveryAndCleanup', () => {
    const fixture = new TRIANGULATION_TEST_FIXTURE();
    const triangulator = fixture.CreateTriangulator();

    // Try a series of operations, some of which might fail
    const testPolygons: SHAPE_LINE_CHAIN[] = [];

    // Valid polygon
    testPolygons.push(createSquare());

    // Degenerate polygon
    const degenerate = new SHAPE_LINE_CHAIN();
    degenerate.Append(0, 0);
    degenerate.SetClosed(true);
    testPolygons.push(degenerate);

    // Another valid polygon
    testPolygons.push(createTriangle());

    for (const poly of testPolygons) {
      // Each triangulation should start with a clean state
      let success = triangulator.TesselatePolygon(poly, null);
      // Even if triangulation fails, it should not crash
      success ||= fixture.GetResult().GetTriangleCount() > 0;
      expect(success).toBe(true);
    }
  });

  // Integration tests with TRIANGULATED_POLYGON interface
  it('TriangulatedPolygonInterface', () => {
    const fixture = new TRIANGULATION_TEST_FIXTURE();
    const triangulator = fixture.CreateTriangulator();

    const square = createSquare();
    const success = triangulator.TesselatePolygon(square, null);

    expect(success).toBe(true);

    const result = fixture.GetResult();

    // Test GetTriangle method
    if (result.GetTriangleCount() > 0) {
      const a = V(0, 0);
      const b = V(0, 0);
      const c = V(0, 0);
      result.GetTriangle(0, a, b, c);

      // Vertices should be valid points from the square
      expect(a.x >= 0 && a.x <= 100 && a.y >= 0 && a.y <= 100).toBe(true);
      expect(b.x >= 0 && b.x <= 100 && b.y >= 0 && b.y <= 100).toBe(true);
      expect(c.x >= 0 && c.x <= 100 && c.y >= 0 && c.y <= 100).toBe(true);
    }

    // Test triangle iteration
    for (const tri of result.Triangles()) {
      expect(tri.GetPointCount()).toBe(3);
      expect(tri.GetSegmentCount()).toBe(3);
      expect(tri.Area()).toBeGreaterThan(0);
      expect(tri.IsClosed()).toBe(true);
      expect(tri.IsSolid()).toBe(true);
    }
  });

  it('SourceOutlineIndexTracking', () => {
    // Test that source outline index is properly maintained
    const expectedOutlineIndex = 5;

    // Create triangulated polygon with specific source index
    const result = new TRIANGULATED_POLYGON(expectedOutlineIndex);
    const localTriangulator = new POLYGON_TRIANGULATION(result);

    const triangle = createTriangle();
    const success = localTriangulator.TesselatePolygon(triangle, null);

    expect(success).toBe(true);
    expect(result.GetSourceOutlineIndex()).toBe(expectedOutlineIndex);
  });

  // Performance regression: only the success of each size is asserted here
  it('PerformanceRegression', () => {
    // Test various polygon sizes to ensure performance scales reasonably
    const testSizes = [10, 50, 100, 500, 1000];

    for (const size of testSizes) {
      const fixture = new TRIANGULATION_TEST_FIXTURE();
      const triangulator = fixture.CreateTriangulator();

      // Create regular polygon
      const poly = new SHAPE_LINE_CHAIN();
      for (let i = 0; i < size; i++) {
        const angle = (2.0 * Math.PI * i) / size;
        const x = Math.trunc(1000 * Math.cos(angle));
        const y = Math.trunc(1000 * Math.sin(angle));
        poly.Append(x, y);
      }
      poly.SetClosed(true);

      const success = triangulator.TesselatePolygon(poly, null);

      expect(success, `size=${size}`).toBe(true);
    }
  });
});
