// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `qa/tests/libs/kimath/geometry/test_shape_poly_set.cpp` (ShapePolySet),
 * `test_shape_poly_set_iterator.cpp` (PolygonIterator),
 * `test_shape_poly_set_collision.cpp` (SPSCollision),
 * `test_shape_poly_set_distance.cpp` (SPSDistance),
 * `test_shape_poly_set_split_outlines.cpp` (ShapePolySetSplitOutlines) and
 * `test_shape_poly_set_arcs.cpp` (CurvedPolys), transcribed against the
 * `SHAPE_POLY_SET` class.
 */
import { describe, expect, it } from 'vitest';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import {
  BuildHSeg,
  BuildHollowSquare,
  BuildPolyset,
  BuildSquareChain,
  CommonTestData,
  IsWithin,
} from './fixtures_geometry.js';
import { CheckUnorderedMatches, IsPolySetValid } from './geom_test_utils.js';

const V = (x: number, y: number): VECTOR2I => ({ x, y });

describe('ShapePolySet', () => {
  it('RemoveNullSegments', () => {
    const base_set = new SHAPE_POLY_SET();

    base_set.NewOutline();
    base_set.Append(0, 0, -1, -1, true);
    base_set.Append(0, 10, -1, -1, true);
    base_set.Append(10, 10, -1, -1, true);
    base_set.Append(10, 10, -1, -1, true);
    base_set.Append(10, 10, -1, -1, true);
    base_set.Append(10, 10, -1, -1, true);
    base_set.Append(10, 0, -1, -1, true);

    let removed = base_set.RemoveNullSegments();

    expect(removed).toBe(3);
    expect(base_set.VertexCount()).toBe(4);

    base_set.DeletePolygon(0);

    base_set.NewOutline();
    base_set.Append(0, 0, -1, -1, true);
    base_set.Append(0, 10, -1, -1, true);
    base_set.Append(0, 10, -1, -1, true);
    base_set.Append(10, 10, -1, -1, true);
    base_set.Append(10, 10, -1, -1, true);
    base_set.Append(10, 0, -1, -1, true);
    base_set.Append(10, 0, -1, -1, true);
    base_set.Append(0, 0, -1, -1, true);

    removed = base_set.RemoveNullSegments();

    expect(removed).toBe(4);
    expect(base_set.VertexCount()).toBe(4);
  });

  it('GetNeighbourIndexes', () => {
    const base_set = new SHAPE_POLY_SET();

    base_set.NewOutline();
    base_set.Append(0, 0, -1, -1, true);
    base_set.Append(0, 10, -1, -1, true);
    base_set.Append(10, 10, -1, -1, true);
    base_set.Append(10, 0, -1, -1, true);

    // Check we're testing what we think
    expect(base_set.OutlineCount()).toBe(1);
    expect(base_set.FullPointCount()).toBe(4);

    const prev = { value: 0 };
    const next = { value: 0 };
    let ok = false;

    ok = base_set.GetNeighbourIndexes(0, prev, next);
    expect(ok).toBe(true);
    expect(prev.value).toBe(3);
    expect(next.value).toBe(1);

    ok = base_set.GetNeighbourIndexes(1, prev, next);
    expect(ok).toBe(true);
    expect(prev.value).toBe(0);
    expect(next.value).toBe(2);

    ok = base_set.GetNeighbourIndexes(2, prev, next);
    expect(ok).toBe(true);
    expect(prev.value).toBe(1);
    expect(next.value).toBe(3);

    ok = base_set.GetNeighbourIndexes(3, prev, next);
    expect(ok).toBe(true);
    expect(prev.value).toBe(2);
    expect(next.value).toBe(0);

    ok = base_set.GetNeighbourIndexes(4, prev, next);
    expect(ok).toBe(false);

    ok = base_set.GetNeighbourIndexes(-1, prev, next);
    expect(ok).toBe(false);
  });

  it('GetNeighbourIndexes_MultiOutline', () => {
    const base_set = new SHAPE_POLY_SET();

    base_set.NewOutline();
    base_set.Append(0, 0, -1, -1, true);
    base_set.Append(0, 10, -1, -1, true);
    base_set.Append(10, 10, -1, -1, true);
    base_set.Append(10, 0, -1, -1, true);

    base_set.NewOutline();
    base_set.Append(20, 0, -1, -1, true);
    base_set.Append(20, 10, -1, -1, true);
    base_set.Append(30, 10, -1, -1, true);
    base_set.Append(30, 0, -1, -1, true);

    // Check we're testing what we think
    expect(base_set.OutlineCount()).toBe(2);
    expect(base_set.FullPointCount()).toBe(8);

    const next = { value: 0 };
    const prev = { value: 0 };
    let ok = false;

    // Can we still get outline 0?
    ok = base_set.GetNeighbourIndexes(0, prev, next);
    expect(ok).toBe(true);
    expect(prev.value).toBe(3);
    expect(next.value).toBe(1);

    // End out outline 0
    ok = base_set.GetNeighbourIndexes(3, prev, next);
    expect(ok).toBe(true);
    expect(prev.value).toBe(2);
    expect(next.value).toBe(0);

    // Check outline 1
    ok = base_set.GetNeighbourIndexes(4, prev, next);
    expect(ok).toBe(true);
    expect(prev.value).toBe(7);
    expect(next.value).toBe(5);

    // End out outline 1
    ok = base_set.GetNeighbourIndexes(7, prev, next);
    expect(ok).toBe(true);
    expect(prev.value).toBe(6);
    expect(next.value).toBe(4);

    // Bad indexes
    ok = base_set.GetNeighbourIndexes(8, prev, next);
    expect(ok).toBe(false);
    ok = base_set.GetNeighbourIndexes(-1, prev, next);
    expect(ok).toBe(false);
  });
});

/**
 * Fixture for the Iterator test suite. It contains an instance of the common data, three
 * polysets with null segments and a vector containing their points.
 */
class IteratorFixture {
  common = new CommonTestData();

  // Polygons to test whether the RemoveNullSegments method works
  lastNullSegmentPolySet = new SHAPE_POLY_SET();
  firstNullSegmentPolySet = new SHAPE_POLY_SET();
  insideNullSegmentPolySet = new SHAPE_POLY_SET();

  // Null segments points
  nullPoints: VECTOR2I[] = [];

  constructor() {
    this.nullPoints.push(V(100, 100));
    this.nullPoints.push(V(0, 100));
    this.nullPoints.push(V(0, 0));

    // Create a polygon with its last segment null
    const polyLine = new SHAPE_LINE_CHAIN();
    polyLine.Append(this.nullPoints[0]!);
    polyLine.Append(this.nullPoints[1]!);
    polyLine.Append(this.nullPoints[2]!);
    polyLine.Append(this.nullPoints[2]!, true);
    polyLine.SetClosed(true);

    this.lastNullSegmentPolySet.AddOutline(polyLine);

    // Create a polygon with its first segment null
    polyLine.Clear();
    polyLine.Append(this.nullPoints[0]!);
    polyLine.Append(this.nullPoints[0]!, true);
    polyLine.Append(this.nullPoints[1]!);
    polyLine.Append(this.nullPoints[2]!);
    polyLine.SetClosed(true);

    this.firstNullSegmentPolySet.AddOutline(polyLine);

    // Create a polygon with an inside segment null
    polyLine.Clear();
    polyLine.Append(this.nullPoints[0]!);
    polyLine.Append(this.nullPoints[1]!);
    polyLine.Append(this.nullPoints[1]!, true);
    polyLine.Append(this.nullPoints[2]!);
    polyLine.SetClosed(true);

    this.insideNullSegmentPolySet.AddOutline(polyLine);
  }
}

describe('PolygonIterator', () => {
  const f = new IteratorFixture();
  const common = f.common;

  /** Checks whether the iteration on the vertices of a common polygon is correct. */
  it('VertexIterator', () => {
    let vertexIndex = 0;

    for (
      const iterator = common.holeyPolySet.IterateWithHoles();
      iterator.valid();
      iterator.Advance()
    ) {
      expect(iterator.Get()).toEqual(common.holeyPoints[vertexIndex]);
      vertexIndex++;
    }

    expect(vertexIndex).toBe(12);
  });

  /** Checks whether the iteration on the segments of a common polygon is correct. */
  it('SegmentIterator', () => {
    let segmentIndex = 0;

    for (
      const iterator = common.holeyPolySet.IterateSegmentsWithHoles();
      iterator.valid();
      iterator.Advance()
    ) {
      const segment = iterator.Get();

      expect(segment.A).toEqual(common.holeySegments[segmentIndex]!.A);
      expect(segment.B).toEqual(common.holeySegments[segmentIndex]!.B);

      segmentIndex++;
    }

    expect(segmentIndex).toBe(12);
  });

  /** Checks whether the iteration on the segments of an empty polygon is correct. */
  it('EmptyPolygon', () => {
    for (
      const iterator = common.emptyPolySet.IterateSegmentsWithHoles();
      iterator.valid();
      iterator.Advance()
    ) {
      expect.fail('Empty set is being iterated!');
    }
  });

  /** Checks whether the iteration on the segments of a polygon with one vertex is correct. */
  it('UniqueVertex', () => {
    const iterator = common.uniqueVertexPolySet.IterateSegmentsWithHoles();

    const segment = iterator.Get();
    expect(segment.A).toEqual(common.uniquePoints[0]);
    expect(segment.B).toEqual(common.uniquePoints[0]);

    iterator.Advance();

    expect(iterator.valid()).toBe(false);
  });

  /** Checks whether the counting of the total number of vertices is correct. */
  it('TotalVertices', () => {
    expect(common.emptyPolySet.TotalVertices()).toBe(0);
    expect(common.uniqueVertexPolySet.TotalVertices()).toBe(1);
    expect(common.solidPolySet.TotalVertices()).toBe(0);
    expect(common.holeyPolySet.TotalVertices()).toBe(12);
  });

  /** Checks whether the removal of null segments, wherever they are placed, is correct. */
  it('RemoveNullSegments', () => {
    const polygonSets = [
      f.lastNullSegmentPolySet,
      f.firstNullSegmentPolySet,
      f.insideNullSegmentPolySet,
    ];

    for (const original of polygonSets) {
      const polygonSet = new SHAPE_POLY_SET(original);
      expect(polygonSet.TotalVertices()).toBe(4);
      expect(polygonSet.RemoveNullSegments()).toBe(1);
      expect(polygonSet.TotalVertices()).toBe(3);

      expect(polygonSet.CVertex(0)).toEqual(f.nullPoints[0]);
      expect(polygonSet.CVertex(1)).toEqual(f.nullPoints[1]);
      expect(polygonSet.CVertex(2)).toEqual(f.nullPoints[2]);
    }
  });
});

/**
 * Fixture for the Collision test suite. It contains an instance of the common data and two
 * vectors containing colliding and non-colliding points.
 */
class CollisionFixture {
  common = new CommonTestData();

  // Vectors containing colliding and non-colliding points
  collidingPoints: VECTOR2I[] = [];
  nonCollidingPoints: VECTOR2I[] = [];

  // tuple of segment under test, collision result, and intersection point
  segs: [SEG, boolean, VECTOR2I][] = [];

  constructor() {
    // Create points colliding with the poly set.

    // Inside the polygon
    this.collidingPoints.push(V(10, 90));

    // Inside the polygon, but on a re-entrant angle of a hole
    this.collidingPoints.push(V(15, 16));

    // On a hole edge => inside the polygon
    this.collidingPoints.push(V(40, 25));

    // On the outline edge => inside the polygon
    this.collidingPoints.push(V(0, 10));

    // Create points not colliding with the poly set.

    // Completely outside of the polygon
    this.nonCollidingPoints.push(V(200, 200));

    // Inside the outline and inside a hole => outside the polygon
    this.nonCollidingPoints.push(V(15, 12));

    // Seg crossing the edge
    this.segs.push([new SEG(V(90, 90), V(110, 110)), true, V(100, 100)]);
    this.segs.push([new SEG(V(110, 110), V(90, 90)), true, V(100, 100)]);
    this.segs.push([new SEG(V(50, -10), V(50, 50)), true, V(50, 0)]);
    this.segs.push([new SEG(V(50, 50), V(50, -10)), true, V(50, 0)]);

    // Seg fully inside
    this.segs.push([new SEG(V(80, 80), V(90, 90)), true, V(85, 85)]);
    this.segs.push([new SEG(V(90, 90), V(80, 80)), true, V(85, 85)]);

    // Seg fully outside
    this.segs.push([new SEG(V(110, 110), V(120, 120)), false, V(0, 0)]);

    // Seg touching
    this.segs.push([new SEG(V(100, 100), V(110, 110)), true, V(100, 100)]);
    this.segs.push([new SEG(V(110, 110), V(100, 100)), true, V(100, 100)]);
  }
}

describe('SPSCollision', () => {
  const f = new CollisionFixture();
  const common = f.common;

  /** Simple dummy test to check that HasHoles() definition is right */
  it('HasHoles', () => {
    expect(common.solidPolySet.HasHoles()).toBe(false);
    expect(common.holeyPolySet.HasHoles()).toBe(true);
  });

  /**
   * This test checks basic behaviour of PointOnEdge, testing if points on corners, outline edges
   * and hole edges are detected as colliding.
   */
  it('PointOnEdge', () => {
    // Check points on corners
    expect(common.holeyPolySet.PointOnEdge(V(0, 50))).toBe(true);

    // Check points on outline edges
    expect(common.holeyPolySet.PointOnEdge(V(0, 10))).toBe(true);

    // Check points on hole edges
    expect(common.holeyPolySet.PointOnEdge(V(10, 11))).toBe(true);

    // Check points inside a hole -> not in edge
    expect(common.holeyPolySet.PointOnEdge(V(12, 12))).toBe(false);

    // Check points inside the polygon and outside any hole -> not on edge
    expect(common.holeyPolySet.PointOnEdge(V(90, 90))).toBe(false);

    // Check points outside the polygon -> not on edge
    expect(common.holeyPolySet.PointOnEdge(V(200, 200))).toBe(false);
  });

  /**
   * This test checks that the function Contains, whose behaviour has been updated to also manage
   * holey polygons, does the right work.
   */
  it('pointInPolygonSet', () => {
    // Check that the set contains the points that collide with it
    for (const point of f.collidingPoints) {
      expect(common.holeyPolySet.Contains(point), `Point {${point.x}, ${point.y} }`).toBe(true);
    }

    // Check that the set does not contain any point outside of it
    for (const point of f.nonCollidingPoints) {
      expect(common.holeyPolySet.Contains(point), `Point {${point.x}, ${point.y} }`).toBe(false);
    }
  });

  /** This test checks the behaviour of the Collide (with a point) method. */
  it('Collide', () => {
    // When clearance = 0, the behaviour should be the same as with Contains

    // Check that the set collides with the colliding points
    for (const point of f.collidingPoints) {
      expect(common.holeyPolySet.Collide(point, 0), `Point {${point.x}, ${point.y} }`).toBe(true);
    }

    // Check that the set does not collide with the non colliding points
    for (const point of f.nonCollidingPoints) {
      expect(common.holeyPolySet.Collide(point, 0), `Point {${point.x}, ${point.y} }`).toBe(false);
    }

    // Checks with clearance > 0

    // Point at the offset zone outside of the outline => collision!
    expect(common.holeyPolySet.Collide(V(-1, 10), 5)).toBe(true);

    // Point at the offset zone outside of a hole => collision!
    expect(common.holeyPolySet.Collide(V(11, 11), 5)).toBe(true);
  });

  /**
   * This test checks the behaviour of the CollideVertex method, testing whether the collision with
   * vertices is well detected
   */
  it('CollideVertex', () => {
    // Check that the set collides with the colliding points
    for (const point of common.holeyPoints) {
      expect(
        common.holeyPolySet.CollideVertex(point, undefined, 0),
        ` Point ${point.x}, ${point.y} does not collide with holeyPolySet polygon`,
      ).toBe(true);
    }
  });

  it('CollideVertexWithClearance', () => {
    // Check that the set collides with the colliding points
    for (const point of common.holeyPoints)
      expect(common.holeyPolySet.CollideVertex(V(point.x + 1, point.y + 1), undefined, 2)).toBe(
        true,
      );
  });

  /** Check that SHAPE_POLY_SET::Collide does the right thing for segments */
  it('CollideSegments', () => {
    for (const [seg, expectedResult, expectedLocation] of f.segs) {
      const location = V(0, 0);

      expect(common.holeyPolySet.Collide(seg, 0, undefined, location)).toBe(expectedResult);

      if (expectedResult) expect(location).toEqual(expectedLocation);
    }
  });

  // regression for keepout collision location reported at the origin
  it('CollideSegmentLocationNearMiss', () => {
    const square = new SHAPE_POLY_SET();
    const outline = new SHAPE_LINE_CHAIN();
    outline.Append(1000, 1000);
    outline.Append(2000, 1000);
    outline.Append(2000, 2000);
    outline.Append(1000, 2000);
    outline.SetClosed(true);
    square.AddOutline(outline);

    const clearance = 100;

    // first segment sits outside the first iterated edge
    const nearMisses = [
      new SEG(V(1400, 950), V(1600, 950)),
      new SEG(V(1400, 2050), V(1600, 2050)),
      new SEG(V(950, 1400), V(950, 1600)),
      new SEG(V(2050, 1400), V(2050, 1600)),
    ];

    for (const seg of nearMisses) {
      const ctx = `seg (${seg.A.x}, ${seg.A.y}) -> (${seg.B.x}, ${seg.B.y})`;
      const actual = { value: -1 };
      const location = V(-1, -1);

      expect(square.Collide(seg, clearance, actual, location), ctx).toBe(true);
      expect(location, ctx).not.toEqual(V(0, 0));
      expect(square.PointOnEdge(location), ctx).toBe(true);
      expect(actual.value, ctx).toBe(50);
    }
  });
});

describe('SPSDistance', () => {
  /// Mock up a conversion function
  const IU_PER_MM = 1e3;

  const Millimeter2iu = (mm: number): number =>
    Math.trunc(mm < 0 ? mm * IU_PER_MM - 0.5 : mm * IU_PER_MM + 0.5);

  interface SPS_DISTANCE_TO_SEG_CASE {
    m_case_name: string;
    /// list of lists of polygon points
    m_polyset: SHAPE_POLY_SET;
    /// the segment to check distance to
    m_seg: SEG;
    m_seg_width: number;
    /// The expected answer
    m_exp_dist: number;
  }

  function GetSPSSegDistCases(): SPS_DISTANCE_TO_SEG_CASE[] {
    const cases: SPS_DISTANCE_TO_SEG_CASE[] = [];

    // Single 10mm square at origin
    const square_10mm_0_0 = BuildPolyset([BuildSquareChain(Millimeter2iu(10))]);

    // Double square: 10mm each, one at (0, 0), one at (10, 0)
    const squares_10mm_0_0_and_20_0 = BuildPolyset([
      BuildSquareChain(Millimeter2iu(10)),
      BuildSquareChain(Millimeter2iu(10), V(Millimeter2iu(20), Millimeter2iu(0))),
    ]);

    // Hollow square: 10mm hole in 20mm square, at origin
    const hollow_square_20_10_at_0_0 = BuildHollowSquare(Millimeter2iu(20), Millimeter2iu(10));
    void hollow_square_20_10_at_0_0;

    cases.push({
      m_case_name: 'Square poly -> 1D segment',
      m_polyset: square_10mm_0_0,
      m_seg: BuildHSeg(V(Millimeter2iu(0), Millimeter2iu(15)), Millimeter2iu(10)),
      m_seg_width: Millimeter2iu(0), // 1-d segment
      m_exp_dist: Millimeter2iu(10),
    });

    cases.push({
      m_case_name: 'Square poly -> 2D (thick) segment',
      m_polyset: square_10mm_0_0,
      m_seg: BuildHSeg(V(Millimeter2iu(0), Millimeter2iu(15)), Millimeter2iu(10)),
      m_seg_width: Millimeter2iu(2), // thick segment
      m_exp_dist: Millimeter2iu(9),
    });

    cases.push({
      m_case_name: 'Two Squares poly -> 2D segment (nearest second square)',
      m_polyset: squares_10mm_0_0_and_20_0,
      m_seg: BuildHSeg(V(Millimeter2iu(15), Millimeter2iu(15)), Millimeter2iu(10)),
      m_seg_width: Millimeter2iu(2), // thick segment
      m_exp_dist: Millimeter2iu(9), // from line to second square
    });

    cases.push({
      m_case_name: 'Square poly -> one intersect',
      m_polyset: square_10mm_0_0,
      m_seg: BuildHSeg(V(Millimeter2iu(-5), Millimeter2iu(0)), Millimeter2iu(10)),
      m_seg_width: Millimeter2iu(0), // 1-d segment
      m_exp_dist: Millimeter2iu(0), // intersect
    });

    cases.push({
      m_case_name: 'Square poly -> multiple intersection',
      m_polyset: square_10mm_0_0,
      m_seg: BuildHSeg(V(Millimeter2iu(-5), Millimeter2iu(0)), Millimeter2iu(20)),
      m_seg_width: Millimeter2iu(0), // 1-d segment
      m_exp_dist: Millimeter2iu(0), // intersect
    });

    cases.push({
      m_case_name: 'Square poly -> 1D seg touching',
      m_polyset: square_10mm_0_0,
      // touch left side at (-5, 0)
      m_seg: BuildHSeg(V(Millimeter2iu(-10), Millimeter2iu(0)), Millimeter2iu(5)),
      m_seg_width: Millimeter2iu(0), // 2D segment
      m_exp_dist: Millimeter2iu(0), // intersect
    });

    cases.push({
      m_case_name: 'Square poly -> 2D seg (end cap is nearest)',
      m_polyset: square_10mm_0_0,
      m_seg: BuildHSeg(V(Millimeter2iu(-20), Millimeter2iu(0)), Millimeter2iu(10)),
      m_seg_width: Millimeter2iu(2), // 2D segment, 1mm cap radius
      m_exp_dist: Millimeter2iu(4), // 4mm short, 5mm to wire end, -1mm radius
    });

    return cases;
  }

  /** Check segment distances */
  it('SegDistance', () => {
    for (const c of GetSPSSegDistCases()) {
      const polyset = new SHAPE_POLY_SET(c.m_polyset);

      const dist =
        Math.trunc(Math.sqrt(polyset.SquaredDistanceToSeg(c.m_seg))) -
        Math.trunc(c.m_seg_width / 2);

      // right answer?
      expect(IsWithin(dist, c.m_exp_dist, 1), `${c.m_case_name}: ${dist} vs ${c.m_exp_dist}`).toBe(
        true,
      );
    }
  });
});

describe('ShapePolySetSplitOutlines', () => {
  it('SplitCoincidentOutlineOppositeDirection', () => {
    // ASCII art representation of the polygon:
    //   1-----------------0
    //   |                 |
    //   |                 |
    //   |    4------5     |
    //   |    |      |     |
    //  2/9--3/8     |     |
    //   |    |      |     |
    //   10---7------6----11

    const poly = new SHAPE_POLY_SET();
    const outline1 = new SHAPE_LINE_CHAIN([
      7600000, 9000000, 6600000, 9000000, 6600000, 8750000, 7000000, 8750000, 7000000, 9000000,
      7250000, 9000000, 7250000, 8500000, 7000000, 8500000, 7000000, 8750000, 6600000, 8750000,
      6600000, 8000000, 7600000, 8000000,
    ]);
    outline1.SetClosed(true);
    poly.AddOutline(outline1);

    poly.Simplify();

    expect(poly.OutlineCount()).toBe(1);
    expect(poly.Outline(0).PointCount()).toBe(10); //Why is this 10?  I think it should probably be 8
    expect(IsPolySetValid(poly)).toBe(true);
  });

  it('SplitCoincidentOutlineSameDirection', () => {
    // This polygon has a self-intersecting/overlapping path that creates
    // coincident edges going in the same direction (points 7→2 and 2→7)
    // Original coordinates (scaled): 0:(99,83) 1:(93,89) 2:(80,86) 3:(94,85)
    // 4:(96,87) 5:(96,86) 6:(95,85) 7:(94,85) repeated points: 7:(94,85) 2:(80,86)

    const poly = new SHAPE_POLY_SET();
    const outline1 = new SHAPE_LINE_CHAIN([
      9912310, 8325057, 9288816, 8948550, 8000000, 8567586, 9428364, 8547698, 9585009, 8652365,
      9613140, 8624234, 9471719, 8482813, 9428364, 8547698, 8000000, 8567586,
    ]);
    outline1.SetClosed(true);
    poly.AddOutline(outline1);

    poly.Simplify();

    expect(poly.OutlineCount()).toBe(1);
    expect(poly.Outline(0).PointCount()).toBe(7);
    expect(IsPolySetValid(poly)).toBe(true);
  });
});

describe('CurvedPolys', () => {
  /**
   * Simplify the polygon a large number of times and check that the area
   * does not change and also that the arcs are the same before and after
   */
  it('TestSimplify', () => {
    const testData = new CommonTestData();

    const polysToTest: [string, SHAPE_POLY_SET][] = [
      ['Case 1: Single polygon', testData.holeyCurvedPolySingle],
      ['Case 2: Wraparound polygon', testData.curvedPolyWrapRound],
      //[ "Case 3: Multi polygon", testData.holeyCurvedPolyMulti ] // This test fails right now:
      // clipper seems to not handle
      // multiple outlines correctly
    ];

    for (const [name, original] of polysToTest) {
      const testPoly = new SHAPE_POLY_SET(original);

      const originalArea = testPoly.Area();

      const originalArcs: SHAPE_ARC[] = [];
      testPoly.GetArcs(originalArcs);

      for (let i = 1; i <= 3; i++) {
        const ctx = `${name}: Simplify Iteration ${i}`;
        testPoly.Simplify();

        const foundArcs: SHAPE_ARC[] = [];
        testPoly.GetArcs(foundArcs);

        expect(IsPolySetValid(testPoly), ctx).toBe(true);
        expect(testPoly.Area(), ctx).toBe(originalArea);
        expect(foundArcs.length, ctx).toBe(originalArcs.length);
        const { unmatchedExpected, unmatchedFound } = CheckUnorderedMatches(
          originalArcs,
          foundArcs,
          // We accept that the arcs could be reversed after Simplify
          (aA, aB) => aA.equals(aB) || aA.Reversed().equals(aB),
        );
        expect(
          unmatchedExpected.map((a) => a.Format()),
          ctx,
        ).toEqual([]);
        expect(
          unmatchedFound.map((a) => a.Format()),
          ctx,
        ).toEqual([]);
      }
    }
  });

  /** Check intersection and union between two polygons */
  it('TestIntersectUnion', () => {
    const testData = new CommonTestData();

    const polysToTest: [string, SHAPE_POLY_SET][] = [
      ['Case 1: Single polygon', testData.holeyCurvedPolySingle],
      //[ "Case 2: Multi polygon", testData.holeyCurvedPolyMulti ] // This test fails right now:
      // clipper seems to not handle
      // multiple outlines correctly
    ];

    for (const [name, original] of polysToTest) {
      const testPoly = new SHAPE_POLY_SET(original);
      const opPoly = new SHAPE_POLY_SET(testData.holeyCurvedPolyInter);

      // Remove all arcs before any booleanOps
      // @todo Remove the below two lines when boolean ops can be carried out on curved polys
      opPoly.ClearArcs();
      testPoly.ClearArcs();

      expect(IsPolySetValid(testPoly), name).toBe(true);
      expect(IsPolySetValid(opPoly), name).toBe(true);

      const testPolyArea = testPoly.Area();
      const opPolyArea = opPoly.Area();

      const intersectionPoly = new SHAPE_POLY_SET(testPoly);
      intersectionPoly.BooleanIntersection(opPoly);
      const intersectArea = intersectionPoly.Area();

      expect(IsPolySetValid(intersectionPoly), name).toBe(true);

      const unionPoly = new SHAPE_POLY_SET(testPoly);
      unionPoly.BooleanAdd(opPoly);
      const unionArea = unionPoly.Area();

      expect(IsPolySetValid(unionPoly), name).toBe(true);

      // Acceptable error of 0.01% (fails at 0.001% for some - this is a Clipper limitation)
      const lhs = testPolyArea + opPolyArea - intersectArea;
      expect(Math.abs(lhs - unionArea) / Math.abs(unionArea), name).toBeLessThanOrEqual(0.01 / 100);
    }
  });

  /** Test SHAPE_POLY_SET::ClearArcs */
  it('TestClearArcs', () => {
    const testData = new CommonTestData();

    const polysToTest: [string, SHAPE_POLY_SET][] = [
      ['Case 1: Single polygon', testData.holeyCurvedPolySingle],
      ['Case 2: Intersect polygon', testData.holeyCurvedPolyInter],
      ['Case 3: Multi polygon', testData.holeyCurvedPolyMulti],
    ];

    for (const [name, original] of polysToTest) {
      const testPoly = new SHAPE_POLY_SET(original);
      const originalArea = testPoly.Area();
      testPoly.ClearArcs();

      expect(IsPolySetValid(testPoly), name).toBe(true);
      expect(testPoly.Area(), name).toBe(originalArea); // Area should not have changed

      const arcBuffer: SHAPE_ARC[] = [];
      testPoly.GetArcs(arcBuffer);

      expect(arcBuffer.length, name).toBe(0); // All arcs should have been removed
    }
  });
});

describe('SHAPE_POLY_SET::splitCollinearOutlines', () => {
  // Two squares joined by a zero-width waist (the outline runs along y = 0
  // from x = 10 to 20 and back). `CacheTriangulation` simplifies first, and
  // `splitCollinearOutlines` finds the waist through its segment R-tree and
  // cuts the outline in two. KiCad's python 10.0.5 reports
  // `TriangulatedPolyCount() == 2` for these points.
  it('splits a waisted outline into two polygons before triangulating', () => {
    const ps = new SHAPE_POLY_SET();
    ps.NewOutline();
    const pts: [number, number][] = [
      [0, 0],
      [10, 0],
      [20, 0],
      [30, 0],
      [30, 10],
      [20, 10],
      [20, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    for (const [x, y] of pts) ps.Append(x * 1000, y * 1000);

    ps.CacheTriangulation();

    expect(ps.TriangulatedPolyCount()).toBe(2);
    // Each half is a square: two triangles apiece.
    let triangles = 0;
    for (let i = 0; i < ps.TriangulatedPolyCount(); i++)
      triangles += ps.TriangulatedPolygon(i)!.GetTriangleCount();
    expect(triangles).toBe(4);
  });
});
