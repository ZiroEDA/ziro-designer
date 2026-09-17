// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SHAPE_POLY_SET` (`geometry/shape_poly_set.h`, `src/geometry/shape_poly_set.cpp`):
 * a set of polygons, each an outline followed by its holes, every contour a
 * `SHAPE_LINE_CHAIN`. Boolean operations and offsetting go through Clipper2
 * with KiCad's Z bookkeeping so arcs survive them; fracturing, the corner
 * operations and the cache-friendly fracture are the bodies in
 * `shape_poly_set_algorithms.ts`, which were ported (and oracle-checked)
 * over bare point rings first and build new chains exactly as the C++ does.
 *
 * The `TransformXToPolygon( SHAPE_POLY_SET&, ... )` functions of
 * `convert_basic_shapes_to_polygon.cpp` live at the bottom of this file
 * because they append to the class.
 */

import {
  ECOORD_MAX,
  EuclideanNormI,
  ResizeI,
  type Vec2,
  type VECTOR2I,
  divideI,
} from '../math/vector2.js';
import { INT_MAX, KiROUND, rescale } from '../math/util.js';
import { EDA_ANGLE, EDA_ANGLE_T, FULL_CIRCLE } from './eda_angle.js';
import type { FLIP_DIRECTION } from '../core/mirror.js';
import { BOX2I, type BOX2D } from '../math/box2.js';
import {
  ClipType,
  EndType,
  FillRule,
  JoinType,
  PI,
  type Path64,
  type Paths64,
  stdSort,
} from '../clipper2/clipper.core.js';
import {
  Clipper64,
  PolyPath64,
  type PolyTree64,
  type ZCallback64,
} from '../clipper2/clipper.engine.js';
import { ClipperOffset } from '../clipper2/clipper.offset.js';
import { acos, atan2, cos, hypot, sin } from '../math/libm.js';
import { mmh3HashToString } from '../mmh3_hash.js';
import { SEG } from './seg.js';
import { type OutInt, SHAPE, SHAPE_HOOKS, SHAPE_LINE_CHAIN_BASE, SHAPE_TYPE } from './shape.js';
import { SHAPE_ARC } from './shape_arc.js';
import { SHAPE_CIRCLE } from './shape_circle.js';
import { CLIPPER_Z_VALUE, type Point64Z, SHAPE_LINE_CHAIN } from './shape_line_chain.js';
import { SHAPE_SEGMENT } from './shape_segment.js';
import { getArcToSegmentCount } from './geometry_utils.js';
import { POLYGON_TRIANGULATION } from './polygon_triangulation.js';
import { RTree, RTreeIntReal } from '../thirdparty/rtree.js';
import {
  ERROR_LOC,
  circleToEndSegmentDeltaRadius,
  transformArcToPolygon as transformArcToRings,
  transformCircleToPolygonSet as transformCircleToRing,
  transformOvalToPolygon as transformOvalToRings,
  transformRingToPolygon as transformRingToRings,
  transformRoundChamferedRectToPolygon as transformRoundChamferedRectToRing,
  transformTrapezoidToPolygon as transformTrapezoidToRing,
} from '../convert_basic_shapes_to_polygon.js';

/** `SHAPE_POLY_SET::POLYGON`: an outline followed by its holes. */
export type POLYGON = SHAPE_LINE_CHAIN[];

/**
 * `CORNER_STRATEGY` (shape_poly_set.h): how a corner is treated when a
 * polygon is inflated. Deflating never spikes, but inflating can throw long
 * spikes off an acute corner, which is why the zone filler picks its strategy
 * deliberately.
 */
export enum CornerStrategy {
  /** Just extend the edges; leaves large spikes on acute angles. */
  ALLOW_ACUTE_CORNERS = 0,
  /** Acute angles are chamfered. */
  CHAMFER_ACUTE_CORNERS = 1,
  /** Acute angles are rounded. */
  ROUND_ACUTE_CORNERS = 2,
  /** All angles are chamfered. */
  CHAMFER_ALL_CORNERS = 3,
  /** All angles are rounded. */
  ROUND_ALL_CORNERS = 4,
}

/** `CORNER_MODE` for chamferFilletPolygon. */
export enum CornerMode {
  CHAMFERED = 0,
  FILLETED = 1,
}

/**
 * Structure to hold the necessary information in order to index a vertex on a
 * SHAPE_POLY_SET object: the polygon index, the contour index relative to the
 * polygon and the vertex index relative the contour.
 */
export class VERTEX_INDEX {
  m_polygon = -1; /*!< m_polygon is the index of the polygon. */
  m_contour = -1; /*!< m_contour is the index of the contour relative to the polygon. */
  m_vertex = -1; /*!< m_vertex is the index of the vertex relative to the contour. */
}

/** `TRIANGULATED_POLYGON::TRI`: one triangle, a SHAPE over its parent's vertices. */
export class TRI extends SHAPE_LINE_CHAIN_BASE {
  a: number;
  b: number;
  c: number;
  parent: TRIANGULATED_POLYGON | null;

  constructor(_a = 0, _b = 0, _c = 0, aParent: TRIANGULATED_POLYGON | null = null) {
    super(SHAPE_TYPE.SH_POLY_SET_TRIANGLE);
    this.a = _a;
    this.b = _b;
    this.c = _c;
    this.parent = aParent;
  }

  Rotate(aAngle: EDA_ANGLE, aCenter: Vec2 = { x: 0, y: 0 }): void {}

  Move(aVector: Vec2): void {}

  IsSolid(): boolean {
    return true;
  }

  IsClosed(): boolean {
    return true;
  }

  BBox(aClearance = 0): BOX2I {
    const v = this.parent!.m_vertices;
    const bbox = new BOX2I(v[this.a]!, { x: 0, y: 0 });
    bbox.Merge(v[this.b]!);
    bbox.Merge(v[this.c]!);

    if (aClearance !== 0) bbox.Inflate(aClearance);

    return bbox;
  }

  GetPoint(aIndex: number): VECTOR2I {
    const v = this.parent!.m_vertices;
    switch (aIndex) {
      case 0:
        return v[this.a]!;
      case 1:
        return v[this.b]!;
      case 2:
        return v[this.c]!;
      default:
        return { x: 0, y: 0 }; // wxCHECK( false, VECTOR2I() )
    }
  }

  GetSegment(aIndex: number): SEG {
    const v = this.parent!.m_vertices;
    switch (aIndex) {
      case 0:
        return new SEG(v[this.a]!, v[this.b]!);
      case 1:
        return new SEG(v[this.b]!, v[this.c]!);
      case 2:
        return new SEG(v[this.c]!, v[this.a]!);
      default:
        return new SEG(); // wxCHECK( false, SEG() )
    }
  }

  GetPointCount(): number {
    return 3;
  }
  GetSegmentCount(): number {
    return 3;
  }

  Area(): number {
    const v = this.parent!.m_vertices;
    const aa = v[this.a]!;
    const bb = v[this.b]!;
    const cc = v[this.c]!;

    const ba = { x: bb.x - aa.x, y: bb.y - aa.y };
    const cb = { x: cc.x - bb.x, y: cc.y - bb.y };

    return Math.abs((cb.x * ba.y - cb.y * ba.x) * 0.5);
  }
}

export class TRIANGULATED_POLYGON {
  private m_sourceOutline: number;
  private m_triangles: TRI[] = [];
  m_vertices: VECTOR2I[] = [];

  constructor(aSourceOutline: number);
  constructor(aOther: TRIANGULATED_POLYGON);
  constructor(a: number | TRIANGULATED_POLYGON) {
    if (typeof a === 'number') {
      this.m_sourceOutline = a;
      return;
    }

    this.m_sourceOutline = a.m_sourceOutline;
    this.m_vertices = a.m_vertices.map((p) => ({ x: p.x, y: p.y }));
    this.m_triangles = a.m_triangles.map((t) => new TRI(t.a, t.b, t.c, this));
  }

  Clear(): void {
    this.m_vertices = [];
    this.m_triangles = [];
  }

  GetTriangle(index: number, a: VECTOR2I, b: VECTOR2I, c: VECTOR2I): void {
    const tri = this.m_triangles[index]!;
    a.x = this.m_vertices[tri.a]!.x;
    a.y = this.m_vertices[tri.a]!.y;
    b.x = this.m_vertices[tri.b]!.x;
    b.y = this.m_vertices[tri.b]!.y;
    c.x = this.m_vertices[tri.c]!.x;
    c.y = this.m_vertices[tri.c]!.y;
  }

  /** `operator=`. */
  assign(aOther: TRIANGULATED_POLYGON): this {
    this.m_sourceOutline = aOther.m_sourceOutline;
    this.m_vertices = aOther.m_vertices.map((p) => ({ x: p.x, y: p.y }));
    this.m_triangles = aOther.m_triangles.map((t) => new TRI(t.a, t.b, t.c, this));
    return this;
  }

  AddTriangle(a: number, b: number, c: number): void {
    this.m_triangles.push(new TRI(a, b, c, this));
  }

  AddVertex(aP: Vec2): void {
    this.m_vertices.push({ x: aP.x, y: aP.y });
  }

  GetTriangleCount(): number {
    return this.m_triangles.length;
  }

  GetSourceOutlineIndex(): number {
    return this.m_sourceOutline;
  }

  SetSourceOutlineIndex(aIndex: number): void {
    this.m_sourceOutline = aIndex;
  }

  Triangles(): readonly TRI[] {
    return this.m_triangles;
  }

  SetTriangles(aTriangles: readonly TRI[]): void {
    this.m_triangles = aTriangles.map((t) => new TRI(t.a, t.b, t.c, this));
  }

  Vertices(): readonly VECTOR2I[] {
    return this.m_vertices;
  }

  SetVertices(aVertices: readonly Vec2[]): void {
    this.m_vertices = aVertices.map((p) => ({ x: p.x, y: p.y }));
  }

  GetVertexCount(): number {
    return this.m_vertices.length;
  }

  Move(aVec: Vec2): void {
    for (const vertex of this.m_vertices) {
      vertex.x += aVec.x;
      vertex.y += aVec.y;
    }
  }
}

/**
 * Base class for iterating over all vertices in a given SHAPE_POLY_SET.
 */
export class ITERATOR {
  m_poly!: SHAPE_POLY_SET;
  m_currentPolygon = 0;
  m_currentContour = 0;
  m_currentVertex = 0;
  m_lastPolygon = 0;
  m_iterateHoles = false;

  /**
   * @return true if the current vertex is the last one of the current contour
   *         (outline or hole); false otherwise.
   */
  IsEndContour(): boolean {
    return (
      this.m_currentVertex + 1 ===
      this.m_poly.CPolygon(this.m_currentPolygon)[this.m_currentContour]!.PointCount()
    );
  }

  /**
   * @return true if the current outline is the last one; false otherwise.
   */
  IsLastPolygon(): boolean {
    return this.m_currentPolygon === this.m_lastPolygon;
  }

  /** `operator bool()`. */
  valid(): boolean {
    if (this.m_currentPolygon < this.m_lastPolygon) return true;

    if (this.m_currentPolygon !== this.m_poly.OutlineCount() - 1) return false;

    const currentPolygon = this.m_poly.CPolygon(this.m_currentPolygon);

    return (
      this.m_currentContour < currentPolygon.length - 1 ||
      this.m_currentVertex < currentPolygon[this.m_currentContour]!.PointCount()
    );
  }

  /**
   * Advance the indices of the current vertex/outline/contour, checking whether the
   * vertices in the holes have to be iterated through.
   */
  Advance(): void {
    // Advance vertex index
    this.m_currentVertex++;

    // Check whether the user wants to iterate through the vertices of the holes
    // and behave accordingly
    if (this.m_iterateHoles) {
      // If the last vertex of the contour was reached, advance the contour index
      if (
        this.m_currentVertex >=
        this.m_poly.CPolygon(this.m_currentPolygon)[this.m_currentContour]!.PointCount()
      ) {
        this.m_currentVertex = 0;
        this.m_currentContour++;

        // If the last contour of the current polygon was reached, advance the
        // outline index
        const totalContours = this.m_poly.CPolygon(this.m_currentPolygon).length;

        if (this.m_currentContour >= totalContours) {
          this.m_currentContour = 0;
          this.m_currentPolygon++;
        }
      }
    } else {
      // If the last vertex of the outline was reached, advance to the following polygon
      if (this.m_currentVertex >= this.m_poly.CPolygon(this.m_currentPolygon)[0]!.PointCount()) {
        this.m_currentVertex = 0;
        this.m_currentPolygon++;
      }
    }
  }

  Get(): VECTOR2I {
    return this.m_poly
      .Polygon(this.m_currentPolygon)
      [this.m_currentContour]!.CPoint(this.m_currentVertex);
  }

  GetIndex(): VERTEX_INDEX {
    const index = new VERTEX_INDEX();

    index.m_polygon = this.m_currentPolygon;
    index.m_contour = this.m_currentContour;
    index.m_vertex = this.m_currentVertex;

    return index;
  }

  *[Symbol.iterator](): IterableIterator<VECTOR2I> {
    while (this.valid()) {
      yield this.Get();
      this.Advance();
    }
  }
}

/**
 * Base class for iterating over all segments in a given SHAPE_POLY_SET.
 */
export class SEGMENT_ITERATOR {
  m_poly!: SHAPE_POLY_SET;
  m_currentPolygon = 0;
  m_currentContour = 0;
  m_currentSegment = 0;
  m_lastPolygon = 0;
  m_iterateHoles = false;

  /**
   * @return true if the current outline is the last one.
   */
  IsLastPolygon(): boolean {
    return this.m_currentPolygon === this.m_lastPolygon;
  }

  /** `operator bool()`. */
  valid(): boolean {
    return this.m_currentPolygon <= this.m_lastPolygon;
  }

  /**
   * Advance the indices of the current vertex/outline/contour, checking whether the
   * vertices in the holes have to be iterated through.
   */
  Advance(): void {
    // Advance vertex index
    this.m_currentSegment++;
    let last: number;

    // Check whether the user wants to iterate through the vertices of the holes
    // and behave accordingly.
    if (this.m_iterateHoles) {
      last = this.m_poly.CPolygon(this.m_currentPolygon)[this.m_currentContour]!.SegmentCount();

      // If the last vertex of the contour was reached, advance the contour index.
      if (this.m_currentSegment >= last) {
        this.m_currentSegment = 0;
        this.m_currentContour++;

        // If the last contour of the current polygon was reached, advance the
        // outline index.
        const totalContours = this.m_poly.CPolygon(this.m_currentPolygon).length;

        if (this.m_currentContour >= totalContours) {
          this.m_currentContour = 0;
          this.m_currentPolygon++;
        }
      }
    } else {
      last = this.m_poly.CPolygon(this.m_currentPolygon)[0]!.SegmentCount();

      // If the last vertex of the outline was reached, advance to the following
      // polygon
      if (this.m_currentSegment >= last) {
        this.m_currentSegment = 0;
        this.m_currentPolygon++;
      }
    }
  }

  Get(): SEG {
    return this.m_poly
      .Polygon(this.m_currentPolygon)
      [this.m_currentContour]!.Segment(this.m_currentSegment);
  }

  GetIndex(): VERTEX_INDEX {
    const index = new VERTEX_INDEX();

    index.m_polygon = this.m_currentPolygon;
    index.m_contour = this.m_currentContour;
    index.m_vertex = this.m_currentSegment;

    return index;
  }

  /**
   * @param aOther is an iterator pointing to another segment.
   * @return true if both iterators point to the same segment of the same contour of
   *         the same polygon of the same polygon set; false otherwise.
   */
  IsAdjacent(aOther: SEGMENT_ITERATOR): boolean {
    // Check that both iterators point to the same contour of the same polygon of the
    // same polygon set.
    if (
      this.m_poly === aOther.m_poly &&
      this.m_currentPolygon === aOther.m_currentPolygon &&
      this.m_currentContour === aOther.m_currentContour
    ) {
      // Compute the total number of segments.
      const numSeg = this.m_poly
        .CPolygon(this.m_currentPolygon)
        [this.m_currentContour]!.SegmentCount();

      // Compute the difference of the segment indices. If it is exactly one, they
      // are adjacent. The only missing case where they also are adjacent is when
      // the segments are the first and last one, in which case the difference
      // always equals the total number of segments minus one.
      const indexDiff = Math.abs(this.m_currentSegment - aOther.m_currentSegment);

      return indexDiff === 1 || indexDiff === numSeg - 1;
    }

    return false;
  }

  *[Symbol.iterator](): IterableIterator<SEG> {
    while (this.valid()) {
      yield this.Get();
      this.Advance();
    }
  }
}

/** `HASH_128` as its hex string. */
export type HASH_128 = string;

const EMPTY_HASH: HASH_128 = '00000000000000000000000000000000';

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * A thread-local table to avoid repetitive calculations of the coefficient
 * 1.0 - cos( M_PI / aCircleSegCount )
 * aCircleSegCount is most of time <= 64 and usually 8, 12, 16, 32
 */
const SEG_CNT_MAX = 64;
const arc_tolerance_factor: number[] = new Array(SEG_CNT_MAX + 1).fill(0);

/** `TRIANGULATESIMPLIFICATIONLEVEL` / `ENABLECACHEFRIENDLYFRACTURE` (ADVANCED_CFG defaults). */
const TRIANGULATESIMPLIFICATIONLEVEL = 50;
const ENABLECACHEFRIENDLYFRACTURE = true;

/**
 * Represent a set of closed polygons. Polygons may be nonconvex, self-intersecting
 * and have holes. Provides boolean operations (using Clipper library as the backend).
 */
export class SHAPE_POLY_SET extends SHAPE {
  protected m_polys: POLYGON[] = [];
  protected m_triangulatedPolys: TRIANGULATED_POLYGON[] = [];
  protected m_triangulationValid = false;

  private m_hash: HASH_128 = EMPTY_HASH;
  private m_hashValid = false;

  constructor();
  constructor(aRect: BOX2D);
  constructor(aOutline: SHAPE_LINE_CHAIN);
  constructor(aPolygon: POLYGON);
  constructor(aOther: SHAPE_POLY_SET);
  constructor(a?: BOX2D | SHAPE_LINE_CHAIN | POLYGON | SHAPE_POLY_SET) {
    super(SHAPE_TYPE.SH_POLY_SET);

    if (a === undefined) return;

    if (a instanceof SHAPE_POLY_SET) {
      this.m_polys = a.m_polys.map((poly) => poly.map((c) => new SHAPE_LINE_CHAIN(c)));

      if (a.IsTriangulationUpToDate()) {
        for (let i = 0; i < a.TriangulatedPolyCount(); i++) {
          const poly = a.TriangulatedPolygon(i);
          this.m_triangulatedPolys.push(new TRIANGULATED_POLYGON(poly));
        }

        this.m_hash = a.GetHash();
        this.m_hashValid = true;
        this.m_triangulationValid = true;
      } else {
        this.m_hash = EMPTY_HASH;
        this.m_hashValid = false;
        this.m_triangulationValid = false;
      }

      return;
    }

    if (a instanceof SHAPE_LINE_CHAIN) {
      this.AddOutline(a);
      return;
    }

    if (Array.isArray(a)) {
      this.AddPolygon(a);
      return;
    }

    // SHAPE_POLY_SET( const BOX2D& aRect )
    this.NewOutline();
    this.Append({ x: Math.trunc(a.GetLeft()), y: Math.trunc(a.GetTop()) });
    this.Append({ x: Math.trunc(a.GetRight()), y: Math.trunc(a.GetTop()) });
    this.Append({ x: Math.trunc(a.GetRight()), y: Math.trunc(a.GetBottom()) });
    this.Append({ x: Math.trunc(a.GetLeft()), y: Math.trunc(a.GetBottom()) });
    this.Outline(0).SetClosed(true);
  }

  /** `operator=`. */
  assign(aOther: SHAPE_POLY_SET): this {
    this.m_polys = aOther.m_polys.map((poly) => poly.map((c) => new SHAPE_LINE_CHAIN(c)));
    this.m_triangulatedPolys = [];

    if (aOther.IsTriangulationUpToDate()) {
      for (let i = 0; i < aOther.TriangulatedPolyCount(); i++) {
        const poly = aOther.TriangulatedPolygon(i);
        this.m_triangulatedPolys.push(new TRIANGULATED_POLYGON(poly));
      }

      this.m_hash = aOther.m_hash;
      this.m_hashValid = aOther.m_hashValid;
      this.m_triangulationValid = aOther.m_triangulationValid;
    } else {
      this.m_hash = EMPTY_HASH;
      this.m_hashValid = false;
      this.m_triangulationValid = false;
    }

    return this;
  }

  /**
   * Build a polygon triangulation, needed to draw a polygon on OpenGL and in some
   * other calculations
   * @param aPartition = true to created a trinagulation in a partition on a grid
   * This is needed for large polygons with holes (dramatically speed up calculations)
   * Smaller polygons without holes can be better with aPartition = false.
   * (Note: in partition mode, the grid size is hard coded to 1e7 IU: 1cm in pcbnew)
   * @param aSimplify = force the triangulation to simplify the polygon first
   */
  CacheTriangulation(aPartition = true, aSimplify = false): void {
    this.cacheTriangulation(aPartition, aSimplify, null);
  }

  IsTriangulationUpToDate(): boolean {
    if (!this.m_triangulationValid) return false;

    if (!this.m_hashValid) return false;

    const hash = this.checksum();

    return hash === this.m_hash;
  }

  GetHash(): HASH_128 {
    if (!this.m_hashValid) return this.checksum();

    return this.m_hash;
  }

  override HasIndexableSubshapes(): boolean {
    return this.IsTriangulationUpToDate();
  }

  override GetIndexableSubshapeCount(): number {
    let n = 0;

    for (const t of this.m_triangulatedPolys) n += t.GetTriangleCount();

    return n;
  }

  override GetIndexableSubshapes(aSubshapes: SHAPE[]): void {
    for (const tpoly of this.m_triangulatedPolys) {
      for (const tri of tpoly.Triangles()) aSubshapes.push(tri);
    }
  }

  /**
   * Convert a global vertex index ---i.e., a number that globally identifies a vertex in a
   * concatenated list of all vertices in all contours--- and get the index of the vertex
   * relative to the contour relative to the polygon in which it is.
   *
   * @param aGlobalIdx is the global index of the vertex.
   * @param aRelativeIndices is the object that will contain the indices of the polygon,
   *                         contour and vertex.
   * @return true if the global index is correct; false otherwise.
   */
  GetRelativeIndices(aGlobalIdx: number, aRelativeIndices: VERTEX_INDEX): boolean {
    let polygonIdx = 0;
    let contourIdx = 0;
    let vertexIdx = 0;

    let currentGlobalIdx = 0;

    for (polygonIdx = 0; polygonIdx < this.OutlineCount(); polygonIdx++) {
      const currentPolygon = this.CPolygon(polygonIdx);

      for (contourIdx = 0; contourIdx < currentPolygon.length; contourIdx++) {
        const currentContour = currentPolygon[contourIdx]!;
        const totalPoints = currentContour.PointCount();

        for (vertexIdx = 0; vertexIdx < totalPoints; vertexIdx++) {
          // Check if the current vertex is the globally indexed as aGlobalIdx
          if (currentGlobalIdx === aGlobalIdx) {
            aRelativeIndices.m_polygon = polygonIdx;
            aRelativeIndices.m_contour = contourIdx;
            aRelativeIndices.m_vertex = vertexIdx;

            return true;
          }

          // Advance
          currentGlobalIdx++;
        }
      }
    }

    return false;
  }

  /**
   * Compute the global index of a vertex from the relative indices of polygon, contour and
   * vertex.
   */
  GetGlobalIndex(aRelativeIndices: VERTEX_INDEX, aGlobalIdx: OutInt): boolean {
    const selectedVertex = aRelativeIndices.m_vertex;
    const selectedContour = aRelativeIndices.m_contour;
    const selectedPolygon = aRelativeIndices.m_polygon;

    // Check whether the vertex indices make sense in this poly set
    if (
      selectedPolygon < this.m_polys.length &&
      selectedContour < this.m_polys[selectedPolygon]!.length &&
      selectedVertex < this.m_polys[selectedPolygon]![selectedContour]!.PointCount()
    ) {
      let currentPolygon: POLYGON;

      aGlobalIdx.value = 0;

      for (let polygonIdx = 0; polygonIdx < selectedPolygon; polygonIdx++) {
        currentPolygon = this.Polygon(polygonIdx);

        for (let contourIdx = 0; contourIdx < currentPolygon.length; contourIdx++)
          aGlobalIdx.value += currentPolygon[contourIdx]!.PointCount();
      }

      currentPolygon = this.Polygon(selectedPolygon);

      for (let contourIdx = 0; contourIdx < selectedContour; contourIdx++)
        aGlobalIdx.value += currentPolygon[contourIdx]!.PointCount();

      aGlobalIdx.value += selectedVertex;

      return true;
    }

    return false;
  }

  override Clone(): SHAPE {
    return new SHAPE_POLY_SET(this);
  }

  CloneDropTriangulation(): SHAPE_POLY_SET {
    const r = new SHAPE_POLY_SET();
    r.m_polys = this.m_polys.map((poly) => poly.map((c) => new SHAPE_LINE_CHAIN(c)));
    r.m_hash = EMPTY_HASH;
    r.m_hashValid = false;
    r.m_triangulationValid = false;
    return r;
  }

  /**
   * Creates a new empty polygon in the set and returns its index.
   */
  NewOutline(): number {
    const empty_path = new SHAPE_LINE_CHAIN();
    const poly: POLYGON = [];
    empty_path.SetClosed(true);
    poly.push(empty_path);
    this.m_polys.push(poly);
    return this.m_polys.length - 1;
  }

  /**
   * Creates a new hole in a given outline.
   */
  NewHole(aOutline = -1): number {
    const empty_path = new SHAPE_LINE_CHAIN();

    empty_path.SetClosed(true);

    // Default outline is the last one
    if (aOutline < 0) aOutline += this.m_polys.length;

    // Add hole to the selected outline
    this.m_polys[aOutline]!.push(empty_path);

    return this.m_polys[this.m_polys.length - 1]!.length - 2;
  }

  /**
   * Adds a new outline to the set and returns its index.
   */
  AddOutline(aOutline: SHAPE_LINE_CHAIN): number {
    const poly: POLYGON = [];

    poly.push(new SHAPE_LINE_CHAIN(aOutline));

    // This is an assertion because if it's generated by KiCad code, it probably
    // indicates a bug elsewhere that should be fixed, but we also auto-fix it here
    // for SWIG plugins that might mess it up
    if (!aOutline.IsClosed()) poly[poly.length - 1]!.SetClosed(true);

    this.m_polys.push(poly);

    return this.m_polys.length - 1;
  }

  /**
   * Adds a new hole to the given outline (default: last) and returns its index.
   */
  AddHole(aHole: SHAPE_LINE_CHAIN, aOutline = -1): number {
    if (aOutline < 0) aOutline += this.m_polys.length;

    const poly = this.m_polys[aOutline]!;

    poly.push(new SHAPE_LINE_CHAIN(aHole));

    return poly.length - 2;
  }

  /**
   * Adds a new polygon to the set and returns its index.
   */
  AddPolygon(apolygon: POLYGON): number {
    this.m_polys.push(apolygon.map((c) => new SHAPE_LINE_CHAIN(c)));

    return this.m_polys.length - 1;
  }

  /**
   * Return the area of this poly set
   */
  Area(): number {
    let area = 0.0;

    for (let i = 0; i < this.OutlineCount(); i++) {
      area += this.Outline(i).Area(true);

      for (let j = 0; j < this.HoleCount(i); j++) area -= this.Hole(i, j).Area(true);
    }

    return area;
  }

  /**
   * Count the number of arc shapes present
   */
  ArcCount(): number {
    let retval = 0;

    for (const poly of this.m_polys) {
      for (let i = 0; i < poly.length; i++) retval += poly[i]!.ArcCount();
    }

    return retval;
  }

  /**
   * Append all the arcs in this polyset to \a aArcBuffer
   */
  GetArcs(aArcBuffer: SHAPE_ARC[]): void {
    for (const poly of this.m_polys) {
      for (let i = 0; i < poly.length; i++) {
        for (const arc of poly[i]!.CArcs()) aArcBuffer.push(new SHAPE_ARC(arc));
      }
    }
  }

  /**
   * Removes all arc references from all the outlines and holes in the polyset.
   */
  ClearArcs(): void {
    for (const poly of this.m_polys) {
      for (let i = 0; i < poly.length; i++) poly[i]!.ClearArcs();
    }
  }

  /**
   * Appends a vertex at the end of the given outline/hole (default: the last outline)
   *
   * @param x is the x coordinate of the new vertex.
   * @param y is the y coordinate of the new vertex.
   * @param aOutline is the index of the polygon.
   * @param aHole is the index of the hole (-1 for the main outline),
   * @param aAllowDuplication is a flag to indicate whether it is allowed to add this vertex
   *                          even if it is duplicated.
   * @return the number of vertices in the outline/hole.
   */
  Append(
    x: number,
    y: number,
    aOutline?: number,
    aHole?: number,
    aAllowDuplication?: boolean,
  ): number;
  /**
   * Merge polygons from two sets.
   */
  Append(aSet: SHAPE_POLY_SET): void;
  /**
   * Append a vertex at the end of the given outline/hole (default: the last outline)
   */
  Append(aP: Vec2, aOutline?: number, aHole?: number): void;
  /**
   * Append an arc to the polygon
   */
  Append(aArc: SHAPE_ARC, aOutline?: number, aHole?: number, aMaxError?: number): number;
  Append(
    a: number | SHAPE_POLY_SET | Vec2 | SHAPE_ARC,
    b?: number,
    c?: number,
    d?: number | boolean,
    e?: boolean,
  ): number | void {
    if (a instanceof SHAPE_POLY_SET) {
      for (const poly of a.m_polys) this.m_polys.push(poly.map((ch) => new SHAPE_LINE_CHAIN(ch)));
      return;
    }

    if (a instanceof SHAPE_ARC) return this.appendArc(a, b ?? -1, c ?? -1, d as number | undefined);

    if (typeof a === 'number')
      return this.appendXY(a, b as number, c ?? -1, (d as number | undefined) ?? -1, e ?? false);

    this.appendXY(a.x, a.y, b ?? -1, c ?? -1, false);
  }

  private appendXY(
    x: number,
    y: number,
    aOutline: number,
    aHole: number,
    aAllowDuplication: boolean,
  ): number {
    if (aOutline < 0) aOutline += this.m_polys.length;

    let idx: number;

    if (aHole < 0) idx = 0;
    else idx = aHole + 1;

    this.m_polys[aOutline]![idx]!.Append(x, y, aAllowDuplication);

    return this.m_polys[aOutline]![idx]!.PointCount();
  }

  private appendArc(
    aArc: SHAPE_ARC,
    aOutline: number,
    aHole: number,
    aMaxError: number | undefined,
  ): number {
    if (aOutline < 0) aOutline += this.m_polys.length;

    let idx: number;

    if (aHole < 0) idx = 0;
    else idx = aHole + 1;

    if (aMaxError !== undefined) this.m_polys[aOutline]![idx]!.Append(aArc, aMaxError);
    else this.m_polys[aOutline]![idx]!.Append(aArc);

    return this.m_polys[aOutline]![idx]!.PointCount();
  }

  /**
   * Adds a vertex in the globally indexed position \a aGlobalIndex.
   *
   * @param aGlobalIndex is the global index of the position in which the new vertex will be
   *                     inserted.
   * @param aNewVertex is the new inserted vertex.
   */
  InsertVertex(aGlobalIndex: number, aNewVertex: Vec2): void {
    const index = new VERTEX_INDEX();

    if (aGlobalIndex < 0) aGlobalIndex = 0;

    if (aGlobalIndex >= this.TotalVertices()) {
      this.Append(aNewVertex);
    } else {
      // Assure the position to be inserted exists; throw an exception otherwise
      if (this.GetRelativeIndices(aGlobalIndex, index))
        this.m_polys[index.m_polygon]![index.m_contour]!.Insert(index.m_vertex, aNewVertex);
      else throw new RangeError('aGlobalIndex-th vertex does not exist');
    }
  }

  /**
   * Return the index-th vertex in a given hole outline within a given outline
   */
  CVertex(aIndex: number, aOutline: number, aHole: number): VECTOR2I;
  /**
   * Return the aGlobalIndex-th vertex in the poly set
   */
  CVertex(aGlobalIndex: number): VECTOR2I;
  /**
   * Return the index-th vertex in a given hole outline within a given outline
   */
  CVertex(aIndex: VERTEX_INDEX): VECTOR2I;
  CVertex(a: number | VERTEX_INDEX, aOutline?: number, aHole?: number): VECTOR2I {
    if (a instanceof VERTEX_INDEX) return this.CVertex(a.m_vertex, a.m_polygon, a.m_contour - 1);

    if (aOutline === undefined) {
      const index = new VERTEX_INDEX();

      // Assure the passed index references a legal position; abort otherwise
      if (!this.GetRelativeIndices(a, index))
        throw new RangeError('aGlobalIndex-th vertex does not exist');

      return this.m_polys[index.m_polygon]![index.m_contour]!.CPoint(index.m_vertex);
    }

    if (aOutline < 0) aOutline += this.m_polys.length;

    let idx: number;

    if (aHole! < 0) idx = 0;
    else idx = aHole! + 1;

    return this.m_polys[aOutline]![idx]!.CPoint(a);
  }

  /**
   * Return the global indexes of the previous and the next corner of the \a aGlobalIndex-th
   * corner of a contour in the polygon set.
   *
   * They are often aGlobalIndex-1 and aGlobalIndex+1, but not for the first and last corner
   * of the contour.
   */
  GetNeighbourIndexes(aGlobalIndex: number, aPrevious?: OutInt, aNext?: OutInt): boolean {
    const index = new VERTEX_INDEX();

    // If the edge does not exist, throw an exception, it is an illegal access memory error
    if (!this.GetRelativeIndices(aGlobalIndex, index)) return false;

    // Calculate the previous and next index of aGlobalIndex, corresponding to
    // the same contour;
    const inext = new VERTEX_INDEX();
    inext.m_polygon = index.m_polygon;
    inext.m_contour = index.m_contour;
    inext.m_vertex = index.m_vertex;

    const lastpoint = this.m_polys[index.m_polygon]![index.m_contour]!.SegmentCount();

    if (index.m_vertex === 0) {
      index.m_vertex = lastpoint - 1;
      inext.m_vertex = 1;
    } else if (index.m_vertex === lastpoint) {
      index.m_vertex--;
      inext.m_vertex = 0;
    } else {
      inext.m_vertex++;
      index.m_vertex--;

      if (inext.m_vertex === lastpoint) inext.m_vertex = 0;
    }

    if (aPrevious) {
      const previous = { value: 0 };
      this.GetGlobalIndex(index, previous);
      aPrevious.value = previous.value;
    }

    if (aNext) {
      const next = { value: 0 };
      this.GetGlobalIndex(inext, next);
      aNext.value = next.value;
    }

    return true;
  }

  /**
   * Check whether the \a aPolygonIndex-th polygon in the set is self intersecting.
   */
  IsPolygonSelfIntersecting(aPolygonIndex: number): boolean {
    const segments: SEG[] = [];

    for (const s of this.CIterateSegmentsWithHoles(aPolygonIndex)) segments.push(s);

    stdSort(segments, (a, b) => {
      const min_a_x = Math.min(a.A.x, a.B.x);
      const min_b_x = Math.min(b.A.x, b.B.x);

      if (min_a_x !== min_b_x) return min_a_x < min_b_x;

      const min_a_y = Math.min(a.A.y, a.B.y);
      const min_b_y = Math.min(b.A.y, b.B.y);

      return min_a_y < min_b_y;
    });

    for (let it = 0; it < segments.length; ++it) {
      const firstSegment = segments[it]!;

      // Iterate through all remaining segments.
      const max_x = Math.max(firstSegment.A.x, firstSegment.B.x);
      const max_y = Math.max(firstSegment.A.y, firstSegment.B.y);

      // Start in the next segment, we don't want to check collision between a segment and itself
      for (let innerIterator = it + 1; innerIterator < segments.length; innerIterator++) {
        const secondSegment = segments[innerIterator]!;
        const min_x = Math.min(secondSegment.A.x, secondSegment.B.x);
        const min_y = Math.min(secondSegment.A.y, secondSegment.B.y);

        // We are ordered in minimum point order, so checking the static max (first segment) against
        // the ordered min will tell us if any of the following segments are withing the BBox
        if (max_x < min_x || (max_x === min_x && max_y < min_y)) break;

        const index_diff = Math.abs(firstSegment.Index() - secondSegment.Index());
        const adjacent = index_diff === 1 || index_diff === segments.length - 1;

        // Check whether the two segments built collide, only when they are not adjacent.
        if (!adjacent && firstSegment.Collide(secondSegment, 0)) return true;
      }
    }

    return false;
  }

  /**
   * Check whether any of the polygons in the set is self intersecting.
   */
  IsSelfIntersecting(): boolean {
    for (let polygon = 0; polygon < this.m_polys.length; polygon++) {
      if (this.IsPolygonSelfIntersecting(polygon)) return true;
    }

    return false;
  }

  /**
   * Return the number of triangulated polygons
   */
  TriangulatedPolyCount(): number {
    return this.m_triangulatedPolys.length;
  }

  /**
   * Return the number of outlines in the set
   */
  OutlineCount(): number {
    return this.m_polys.length;
  }

  /**
   * Return the number of vertices in a given outline/hole.
   */
  VertexCount(aOutline = -1, aHole = -1): number {
    if (this.m_polys.length === 0)
      // Empty poly set
      return 0;

    if (aOutline < 0)
      // Use last outline
      aOutline += this.m_polys.length;

    let idx: number;

    if (aHole < 0) idx = 0;
    else idx = aHole + 1;

    if (aOutline >= this.m_polys.length)
      // not existing outline
      return 0;

    if (idx >= this.m_polys[aOutline]!.length)
      // not existing hole
      return 0;

    return this.m_polys[aOutline]![idx]!.PointCount();
  }

  /**
   * Return the number of points in the shape poly set.
   * mainly for reports
   */
  FullPointCount(): number {
    let full_count = 0;

    if (this.m_polys.length === 0)
      // Empty poly set
      return full_count;

    for (let ii = 0; ii < this.OutlineCount(); ii++) {
      // the first polygon in m_polys[ii] is the main contour,
      // only others are holes:
      for (let idx = 0; idx <= this.HoleCount(ii); idx++) {
        full_count += this.m_polys[ii]![idx]!.PointCount();
      }
    }

    return full_count;
  }

  /**
   * Return the number of holes in a given outline.
   */
  HoleCount(aOutline: number): number {
    if (aOutline < 0 || aOutline >= this.m_polys.length || this.m_polys[aOutline]!.length < 2)
      return 0;

    // the first polygon in m_polys[aOutline] is the main contour,
    // only others are holes:
    return this.m_polys[aOutline]!.length - 1;
  }

  /**
   * Return the reference to aIndex-th outline in the set.
   */
  Outline(aIndex: number): SHAPE_LINE_CHAIN {
    return this.m_polys[aIndex]![0]!;
  }

  /**
   * Return a subset of the polygons in this set, the ones between \a aFirstPolygon and
   * \a aLastPolygon.
   *
   * @param aFirstPolygon is the first polygon to be included in the returned set.
   * @param aLastPolygon is the last polygon to be excluded of the returned set.
   * @return a set containing the polygons between \a aFirstPolygon (included)
   *         and \a aLastPolygon (excluded).
   */
  Subset(aFirstPolygon: number, aLastPolygon: number): SHAPE_POLY_SET {
    const newPolySet = new SHAPE_POLY_SET();

    for (let index = aFirstPolygon; index < aLastPolygon; index++)
      newPolySet.m_polys.push(this.Polygon(index).map((c) => new SHAPE_LINE_CHAIN(c)));

    return newPolySet;
  }

  UnitSet(aPolygonIndex: number): SHAPE_POLY_SET {
    return this.Subset(aPolygonIndex, aPolygonIndex + 1);
  }

  /**
   * Return the reference to aHole-th hole in the aIndex-th outline.
   */
  Hole(aOutline: number, aHole: number): SHAPE_LINE_CHAIN {
    return this.m_polys[aOutline]![aHole + 1]!;
  }

  /**
   * Return the aIndex-th subpolygon in the set.
   */
  Polygon(aIndex: number): POLYGON {
    return this.m_polys[aIndex]!;
  }

  TriangulatedPolygon(aIndex: number): TRIANGULATED_POLYGON {
    return this.m_triangulatedPolys[aIndex]!;
  }

  COutline(aIndex: number): SHAPE_LINE_CHAIN {
    return this.m_polys[aIndex]![0]!;
  }

  CHole(aOutline: number, aHole: number): SHAPE_LINE_CHAIN {
    return this.m_polys[aOutline]![aHole + 1]!;
  }

  CPolygon(aIndex: number): POLYGON {
    return this.m_polys[aIndex]!;
  }

  CPolygons(): readonly POLYGON[] {
    return this.m_polys;
  }

  /**
   * Return an object to iterate through the points of the polygons between \a aFirst and
   * \a aLast.
   *
   * @param aFirst is the first polygon whose points will be iterated.
   * @param aLast is the last polygon whose points will be iterated.
   * @param aIterateHoles is a flag to indicate whether the points of the holes should be
   *                      iterated.
   * @return ITERATOR - the iterator.
   */
  Iterate(aFirst?: number, aLast?: number, aIterateHoles = false): ITERATOR {
    const iter = new ITERATOR();

    if (aFirst === undefined) {
      aFirst = 0;
      aLast = this.OutlineCount() - 1;
    } else if (aLast === undefined) {
      aLast = aFirst;
    }

    iter.m_poly = this;
    iter.m_currentPolygon = aFirst;
    iter.m_lastPolygon = aLast < 0 ? this.OutlineCount() - 1 : aLast;
    iter.m_currentContour = 0;
    iter.m_currentVertex = 0;
    iter.m_iterateHoles = aIterateHoles;

    return iter;
  }

  /**
   * @param aOutline is the index of the polygon to be iterated.
   * @return an iterator object to visit all points in the main outline of the aOutline-th
   *         polygon, as well as those of all its holes.
   */
  IterateWithHoles(aOutline?: number): ITERATOR {
    if (aOutline === undefined) return this.Iterate(0, this.OutlineCount() - 1, true);
    return this.Iterate(aOutline, aOutline, true);
  }

  CIterate(aFirst?: number, aLast?: number, aIterateHoles = false): ITERATOR {
    return this.Iterate(aFirst, aLast, aIterateHoles);
  }

  CIterateWithHoles(aOutline?: number): ITERATOR {
    return this.IterateWithHoles(aOutline);
  }

  IterateFromVertexWithHoles(aGlobalIdx: number): ITERATOR {
    // Build iterator
    const iter = this.IterateWithHoles();

    // Get the relative indices of the globally indexed vertex
    const indices = new VERTEX_INDEX();

    if (!this.GetRelativeIndices(aGlobalIdx, indices))
      throw new RangeError('aGlobalIndex-th vertex does not exist');

    // Adjust where the iterator is pointing
    iter.m_currentPolygon = indices.m_polygon;
    iter.m_currentContour = indices.m_contour;
    iter.m_currentVertex = indices.m_vertex;

    return iter;
  }

  /**
   * Return an iterator object, for iterating between aFirst and aLast outline, with or
   * without holes (default: without)
   */
  IterateSegments(aFirst?: number, aLast?: number, aIterateHoles = false): SEGMENT_ITERATOR {
    const iter = new SEGMENT_ITERATOR();

    if (aFirst === undefined) {
      aFirst = 0;
      aLast = this.OutlineCount() - 1;
    } else if (aLast === undefined) {
      aLast = aFirst;
    }

    iter.m_poly = this;
    iter.m_currentPolygon = aFirst;
    iter.m_lastPolygon = aLast < 0 ? this.OutlineCount() - 1 : aLast;
    iter.m_currentContour = 0;
    iter.m_currentSegment = 0;
    iter.m_iterateHoles = aIterateHoles;

    return iter;
  }

  CIterateSegments(aFirst?: number, aLast?: number, aIterateHoles = false): SEGMENT_ITERATOR {
    return this.IterateSegments(aFirst, aLast, aIterateHoles);
  }

  /**
   * Return an iterator object, for all outlines in the set (with holes).
   */
  IterateSegmentsWithHoles(aOutline?: number): SEGMENT_ITERATOR {
    if (aOutline === undefined) return this.IterateSegments(0, this.OutlineCount() - 1, true);
    return this.IterateSegments(aOutline, aOutline, true);
  }

  CIterateSegmentsWithHoles(aOutline?: number): SEGMENT_ITERATOR {
    return this.IterateSegmentsWithHoles(aOutline);
  }

  BooleanAdd(b: SHAPE_POLY_SET): void;
  BooleanAdd(a: SHAPE_POLY_SET, b: SHAPE_POLY_SET): void;
  BooleanAdd(a: SHAPE_POLY_SET, b?: SHAPE_POLY_SET): void {
    if (b) this.booleanOp3(ClipType.Union, a, b);
    else this.booleanOp(ClipType.Union, a);
  }

  BooleanSubtract(b: SHAPE_POLY_SET): void;
  BooleanSubtract(a: SHAPE_POLY_SET, b: SHAPE_POLY_SET): void;
  BooleanSubtract(a: SHAPE_POLY_SET, b?: SHAPE_POLY_SET): void {
    if (b) this.booleanOp3(ClipType.Difference, a, b);
    else this.booleanOp(ClipType.Difference, a);
  }

  BooleanIntersection(b: SHAPE_POLY_SET): void;
  BooleanIntersection(a: SHAPE_POLY_SET, b: SHAPE_POLY_SET): void;
  BooleanIntersection(a: SHAPE_POLY_SET, b?: SHAPE_POLY_SET): void {
    if (b) this.booleanOp3(ClipType.Intersection, a, b);
    else this.booleanOp(ClipType.Intersection, a);
  }

  BooleanXor(b: SHAPE_POLY_SET): void;
  BooleanXor(a: SHAPE_POLY_SET, b: SHAPE_POLY_SET): void;
  BooleanXor(a: SHAPE_POLY_SET, b?: SHAPE_POLY_SET): void {
    if (b) this.booleanOp3(ClipType.Xor, a, b);
    else this.booleanOp(ClipType.Xor, a);
  }

  /**
   * Extract all contours from this polygon set, then recreate polygons with holes.
   * Essentially XOR, but faster.  Self-intersecting polygons are not supported.
   */
  RebuildHolesFromContours(): void {
    const contours: SHAPE_LINE_CHAIN[] = [];

    for (const poly of this.m_polys) for (const c of poly) contours.push(c);

    const parentToChildren = new Map<number, Set<number>>();
    const childToParents = new Map<number, Set<number>>();

    const getSet = (m: Map<number, Set<number>>, k: number): Set<number> => {
      let s = m.get(k);
      if (!s) {
        s = new Set();
        m.set(k, s);
      }
      return s;
    };

    for (const contour of contours) contour.GenerateBBoxCache();

    for (let i = 0; i < contours.length; i++) {
      const outline = contours[i]!;

      for (let j = 0; j < contours.length; j++) {
        if (i === j) continue;

        const candidate = contours[j]!;
        const pt0 = candidate.CPoint(0);

        if (outline.PointInside(pt0, 0, true)) {
          getSet(parentToChildren, i).add(j);
          getSet(childToParents, j).add(i);
        }
      }
    }

    const topLevelParents = new Set<number>();

    for (let i = 0; i < contours.length; i++) {
      if (getSet(childToParents, i).size === 0) {
        topLevelParents.add(i);
      }
    }

    const result = new SHAPE_POLY_SET();

    const setEquals = (a: Set<number>, b: Set<number>): boolean => {
      if (a.size !== b.size) return false;
      for (const v of a) if (!b.has(v)) return false;
      return true;
    };

    const process = (myId: number, parentOutlineId: number, path: number[]): void => {
      const relParents = new Set(getSet(childToParents, myId));

      for (const pathId of path) relParents.delete(pathId);

      let myOutline = -1;

      const isOutline = path.length % 2 === 0;

      if (isOutline) {
        const outlineId = result.AddOutline(contours[myId]!);
        myOutline = outlineId;
      } else {
        result.AddHole(contours[myId]!, parentOutlineId);
      }

      const it = parentToChildren.get(myId);

      if (it) {
        const thisPath = [...path, myId];

        const thisPathSet = new Set(thisPath);

        // std::set iterates in ascending order
        for (const childId of [...it].sort((x, y) => x - y)) {
          const childPathSet = getSet(childToParents, childId);

          if (!setEquals(thisPathSet, childPathSet)) continue; // Only interested in immediate children

          process(childId, myOutline, thisPath);
        }
      }
    };

    for (const topParentId of [...topLevelParents].sort((x, y) => x - y)) {
      process(topParentId, -1, []);
    }

    this.assign(result);
  }

  private booleanOp(aType: ClipType, aOtherShape: SHAPE_POLY_SET): void {
    this.booleanOp3(aType, this, aOtherShape);
  }

  private booleanOp3(aType: ClipType, aShape: SHAPE_POLY_SET, aOtherShape: SHAPE_POLY_SET): void {
    if (
      (aShape.OutlineCount() > 1 || aOtherShape.OutlineCount() > 0) &&
      (aShape.ArcCount() > 0 || aOtherShape.ArcCount() > 0)
    ) {
      // wxFAIL_MSG( "Boolean ops on curved polygons are not supported. You should call ClearArcs() before carrying out the boolean operation." );
      console.warn(
        'Boolean ops on curved polygons are not supported. You should call ClearArcs() before carrying out the boolean operation.',
      );
    }

    const c = new Clipper64();

    const zValues: CLIPPER_Z_VALUE[] = [];
    const arcBuffer: SHAPE_ARC[] = [];
    const newIntersectPoints = new Map<string, CLIPPER_Z_VALUE>();

    const paths: Path64[] = [];
    const clips: Path64[] = [];

    for (const poly of aShape.m_polys) {
      for (let i = 0; i < poly.length; i++) {
        paths.push(poly[i]!.convertToClipper2(i === 0, zValues, arcBuffer));
      }
    }

    for (const poly of aOtherShape.m_polys) {
      for (let i = 0; i < poly.length; i++) {
        clips.push(poly[i]!.convertToClipper2(i === 0, zValues, arcBuffer));
      }
    }

    c.addSubject(paths);
    c.addClip(clips);

    const solution = new PolyPath64();

    const callback: ZCallback64 = (e1bot, e1top, e2bot, e2top, pt) => {
      const arcIndex = (aZvalue: number, aCompareVal = -1): number => {
        let retval: number;

        retval = zValues[aZvalue]!.m_SecondArcIdx;

        if (retval === -1 || (aCompareVal > 0 && retval !== aCompareVal))
          retval = zValues[aZvalue]!.m_FirstArcIdx;

        return retval;
      };

      const arcSegment = (aBottomZ: number, aTopZ: number): number => {
        let retval = arcIndex(aBottomZ);

        if (retval !== -1) {
          if (retval !== arcIndex(aTopZ, retval)) retval = -1; // Not an arc segment as the two indices do not match
        }

        return retval;
      };

      const e1ArcSegmentIndex = arcSegment(e1bot.z ?? 0, e1top.z ?? 0);
      const e2ArcSegmentIndex = arcSegment(e2bot.z ?? 0, e2top.z ?? 0);

      const newZval = new CLIPPER_Z_VALUE();

      if (e1ArcSegmentIndex !== -1) {
        newZval.m_FirstArcIdx = e1ArcSegmentIndex;
        newZval.m_SecondArcIdx = e2ArcSegmentIndex;
      } else {
        newZval.m_FirstArcIdx = e2ArcSegmentIndex;
        newZval.m_SecondArcIdx = -1;
      }

      const z_value_ptr = zValues.length;
      zValues.push(newZval);

      // Only worry about arc segments for later processing
      if (newZval.m_FirstArcIdx !== -1) newIntersectPoints.set(`${pt.x},${pt.y}`, newZval);

      pt.z = z_value_ptr;
      //@todo amend X,Y values to true intersection between arcs or arc and segment
    };

    c.SetZCallback(callback); // register callback

    c.executeTree(aType, FillRule.NonZero, solution);

    this.importTree(solution, zValues, arcBuffer);
  }

  /**
   * Perform outline inflation/deflation, using round corners.
   *
   * Polygons can have holes, but not linked holes with main outlines, if aFactor < 0.
   * For those polygons, the negative inflation create some unwanted artifacts.
   */
  InflateWithLinkedHoles(
    aFactor: number,
    aCornerStrategy: CornerStrategy,
    aMaxError: number,
  ): void {
    this.Unfracture();
    this.Inflate(aFactor, aCornerStrategy, aMaxError);
    this.Fracture();
  }

  /** `inflate2`: private upstream; the ring delegates reach it. */
  inflate2(
    aAmount: number,
    aCircleSegCount: number,
    aCornerStrategy: CornerStrategy,
    aSimplify = false,
  ): void {
    const c = new ClipperOffset();

    // N.B. see the Clipper documentation for jtSquare/jtMiter/jtRound.  They are poorly named
    // and are not what you'd think they are.
    // http://www.angusj.com/delphi/clipper/documentation/Docs/Units/ClipperLib/Types/JoinType.htm
    let joinType = JoinType.Round; // The way corners are offsetted
    let miterLimit = 2.0; // Smaller value when using jtMiter for joinType

    switch (aCornerStrategy) {
      case CornerStrategy.ALLOW_ACUTE_CORNERS:
        joinType = JoinType.Miter;
        miterLimit = 10; // Allows large spikes
        break;

      case CornerStrategy.CHAMFER_ACUTE_CORNERS: // Acute angles are chamfered
        joinType = JoinType.Miter;
        break;

      case CornerStrategy.ROUND_ACUTE_CORNERS: // Acute angles are rounded
        joinType = JoinType.Miter;
        break;

      case CornerStrategy.CHAMFER_ALL_CORNERS: // All angles are chamfered.
        joinType = JoinType.Square;
        break;

      case CornerStrategy.ROUND_ALL_CORNERS: // All angles are rounded.
        joinType = JoinType.Round;
        break;
    }

    const zValues: CLIPPER_Z_VALUE[] = [];
    const arcBuffer: SHAPE_ARC[] = [];

    for (const poly of this.m_polys) {
      const paths: Paths64 = [];

      for (let i = 0; i < poly.length; i++)
        paths.push(poly[i]!.convertToClipper2(i === 0, zValues, arcBuffer));

      c.addPaths(paths, joinType, EndType.Polygon);
    }

    // Calculate the arc tolerance (arc error) from the seg count by circle. The seg count is
    // nn = M_PI / acos(1.0 - c.ArcTolerance / abs(aAmount))
    // http://www.angusj.com/delphi/clipper/documentation/Docs/Units/ClipperLib/Classes/ClipperOffset/Properties/ArcTolerance.htm
    if (aCircleSegCount < 6)
      // avoid incorrect aCircleSegCount values
      aCircleSegCount = 6;

    let coeff: number;

    if (aCircleSegCount > SEG_CNT_MAX || arc_tolerance_factor[aCircleSegCount] === 0) {
      coeff = 1.0 - cos(PI / aCircleSegCount);

      if (aCircleSegCount <= SEG_CNT_MAX) arc_tolerance_factor[aCircleSegCount] = coeff;
    } else {
      coeff = arc_tolerance_factor[aCircleSegCount]!;
    }

    c.arcTolerance(Math.abs(aAmount) * coeff);
    c.miterLimit(miterLimit);

    const tree = new PolyPath64();

    if (aSimplify) {
      const paths = c.executePaths(aAmount);

      // `Clipper2Lib::SimplifyPaths( paths, std::abs( aAmount ) * coeff, true )`
      // returns a new Paths64 and the C++ drops it (shape_poly_set.cpp:1009),
      // so what aSimplify actually does is run the offset's own union a
      // second time, FillRule::Positive, un-reversed.

      const c2 = new Clipper64();
      c2.preserveCollinear(false);
      c2.reverseSolution(false);
      c2.addSubject(paths);
      c2.executeTree(ClipType.Union, FillRule.Positive, tree);
    } else {
      c.executeTree(aAmount, tree);
    }

    this.importTree(tree, zValues, arcBuffer);
  }

  private inflateLine2(
    aLine: SHAPE_LINE_CHAIN,
    aAmount: number,
    aCircleSegCount: number,
    aCornerStrategy: CornerStrategy,
    aSimplify = false,
  ): void {
    const c = new ClipperOffset();

    // N.B. see the Clipper documentation for jtSquare/jtMiter/jtRound.  They are poorly named
    // and are not what you'd think they are.
    // http://www.angusj.com/delphi/clipper/documentation/Docs/Units/ClipperLib/Types/JoinType.htm
    let joinType = JoinType.Round; // The way corners are offsetted
    let miterLimit = 2.0; // Smaller value when using jtMiter for joinType

    switch (aCornerStrategy) {
      case CornerStrategy.ALLOW_ACUTE_CORNERS:
        joinType = JoinType.Miter;
        miterLimit = 10; // Allows large spikes
        break;

      case CornerStrategy.CHAMFER_ACUTE_CORNERS: // Acute angles are chamfered
        joinType = JoinType.Miter;
        break;

      case CornerStrategy.ROUND_ACUTE_CORNERS: // Acute angles are rounded
        joinType = JoinType.Miter;
        break;

      case CornerStrategy.CHAMFER_ALL_CORNERS: // All angles are chamfered.
        joinType = JoinType.Square;
        break;

      case CornerStrategy.ROUND_ALL_CORNERS: // All angles are rounded.
        joinType = JoinType.Round;
        break;
    }

    const zValues: CLIPPER_Z_VALUE[] = [];
    const arcBuffer: SHAPE_ARC[] = [];

    const path = aLine.convertToClipper2(true, zValues, arcBuffer);
    c.addPath(path, joinType, EndType.Butt);

    // Calculate the arc tolerance (arc error) from the seg count by circle. The seg count is
    // nn = M_PI / acos(1.0 - c.ArcTolerance / abs(aAmount))
    // http://www.angusj.com/delphi/clipper/documentation/Docs/Units/ClipperLib/Classes/ClipperOffset/Properties/ArcTolerance.htm
    if (aCircleSegCount < 6)
      // avoid incorrect aCircleSegCount values
      aCircleSegCount = 6;

    let coeff: number;

    if (aCircleSegCount > SEG_CNT_MAX || arc_tolerance_factor[aCircleSegCount] === 0) {
      coeff = 1.0 - cos(PI / aCircleSegCount);

      if (aCircleSegCount <= SEG_CNT_MAX) arc_tolerance_factor[aCircleSegCount] = coeff;
    } else {
      coeff = arc_tolerance_factor[aCircleSegCount]!;
    }

    c.arcTolerance(Math.abs(aAmount) * coeff);
    c.miterLimit(miterLimit);

    const tree = new PolyPath64();

    if (aSimplify) {
      const paths2 = c.executePaths(aAmount);

      // `SimplifyPaths( paths2, ..., false )`: result dropped, as in inflate2.

      const c2 = new Clipper64();
      c2.preserveCollinear(false);
      c2.reverseSolution(false);
      c2.addSubject(paths2);
      c2.executeTree(ClipType.Union, FillRule.Positive, tree);
    } else {
      c.executeTree(aAmount, tree);
    }

    this.importTree(tree, zValues, arcBuffer);
  }

  /**
   * Perform outline inflation/deflation.
   *
   * Polygons can have holes, but not linked holes with main outlines, if aAmount < 0.
   * For those polygons, the negative inflation create some unwanted artifacts.
   */
  Inflate(
    aAmount: number,
    aCornerStrategy: CornerStrategy,
    aMaxError: number,
    aSimplify = false,
  ): void {
    const segCount = getArcToSegmentCount(Math.abs(aAmount), aMaxError, FULL_CIRCLE.AsDegrees());
    this.inflate2(aAmount, segCount, aCornerStrategy, aSimplify);
  }

  Deflate(aAmount: number, aCornerStrategy: CornerStrategy, aMaxError: number): void {
    this.Inflate(-aAmount, aCornerStrategy, aMaxError);
  }

  OffsetLineChain(
    aLine: SHAPE_LINE_CHAIN,
    aAmount: number,
    aCornerStrategy: CornerStrategy,
    aMaxError: number,
    aSimplify: boolean,
  ): void {
    const segCount = getArcToSegmentCount(Math.abs(aAmount), aMaxError, FULL_CIRCLE.AsDegrees());
    this.inflateLine2(aLine, aAmount, segCount, aCornerStrategy, aSimplify);
  }

  private importPolyPath(
    aPolyPath: PolyPath64,
    aZValueBuffer: CLIPPER_Z_VALUE[],
    aArcBuffer: SHAPE_ARC[],
  ): void {
    if (!aPolyPath.isHole()) {
      const paths: POLYGON = [];
      paths.push(new SHAPE_LINE_CHAIN(aPolyPath.polygon as Point64Z[], aZValueBuffer, aArcBuffer));

      for (const child of aPolyPath.childs) {
        paths.push(new SHAPE_LINE_CHAIN(child.polygon as Point64Z[], aZValueBuffer, aArcBuffer));

        for (const grandchild of child.childs)
          this.importPolyPath(grandchild, aZValueBuffer, aArcBuffer);
      }

      this.m_polys.push(paths);
    }
  }

  private importTree(
    tree: PolyTree64,
    aZValueBuffer: CLIPPER_Z_VALUE[],
    aArcBuffer: SHAPE_ARC[],
  ): void {
    this.m_polys = [];

    for (const n of tree.childs) this.importPolyPath(n, aZValueBuffer, aArcBuffer);
  }

  private importPaths(
    aPath: Paths64,
    aZValueBuffer: CLIPPER_Z_VALUE[],
    aArcBuffer: SHAPE_ARC[],
  ): void {
    this.m_polys = [];
    let path: POLYGON = [];

    for (const n of aPath) {
      if (clipperArea(n) > 0) {
        if (path.length) this.m_polys.push(path);

        path = [];
      } else {
        if (!path.length) continue; // wxCHECK2_MSG( "Cannot add a hole before an outline" )
      }

      path.push(new SHAPE_LINE_CHAIN(n as Point64Z[], aZValueBuffer, aArcBuffer));
    }

    if (path.length) this.m_polys.push(path);
  }

  /**
   * Convert a single outline slitted ("fractured") polygon into a set ouf outlines
   * with holes.
   */
  private fractureSingle(paths: POLYGON): void {
    if (ENABLECACHEFRIENDLYFRACTURE) {
      fractureSingleCacheFriendly(paths);
      return;
    }

    fractureSingleSlow(paths);
  }

  /**
   * Convert a set of polygons with holes to a single outline with "slits"/"fractures"
   * connecting the outer ring to the inner holes.
   *
   * @param aSimplify is true to run Simplify() first.
   */
  Fracture(aSimplify = true): void {
    if (aSimplify) this.Simplify(); // remove overlapping holes/degeneracy

    for (const paths of this.m_polys) this.fractureSingle(paths);
  }

  /**
   * `unfractureSingle` (shape_poly_set.cpp:1675), as it actually behaves.
   *
   * It copies the ring, runs `SHAPE_LINE_CHAIN::Simplify()` on it and then
   * means to cut out every edge that has an exact reverse twin (the slits)
   * by looking each edge up in an `unordered_set<EDGE, EDGE::HASH>` whose
   * equality is "reverse of". But `EDGE::HASH` hashes (A.x, B.x, A.y, B.y)
   * in order, so an edge and its twin hash differently and `find` only
   * meets the twin when the two happen to share a bucket. Nothing is cut,
   * the single cycle is walked back into one outline, and it is the
   * `Simplify()` that `Unfracture` runs next (a union) that turns the slits
   * back into holes. The oracle boards agree with this reading.
   */
  private unfractureSingle(aPoly: POLYGON): void {
    const lc = new SHAPE_LINE_CHAIN(aPoly[0]!);
    lc.Simplify();

    aPoly.length = 0;
    aPoly.push(lc);
  }

  /**
   * Convert a single outline slitted ("fractured") polygon into a set ouf outlines
   * with holes.
   */
  Unfracture(): void {
    for (const path of this.m_polys) this.unfractureSingle(path);

    this.Simplify(); // remove overlapping holes/degeneracy
  }

  /**
   * Return true if the polygon set has any holes.
   */
  HasHoles(): boolean {
    // Iterate through all the polygons on the set
    for (const paths of this.m_polys) {
      // If any of them has more than one contour, it is a hole.
      if (paths.length > 1) return true;
    }

    // Return false if and only if every polygon has just one outline, without holes.
    return false;
  }

  /**
   * Return true if the polygon set has any holes that touch share a vertex.
   */
  HasTouchingHoles(): boolean {
    for (let i = 0; i < this.OutlineCount(); i++) {
      if (this.hasTouchingHoles(this.CPolygon(i))) return true;
    }

    return false;
  }

  private hasTouchingHoles(aPoly: POLYGON): boolean {
    const ptHashes = new Set<string>();

    for (const lc of aPoly) {
      for (const pt of lc.CPoints()) {
        const ptHash = `${pt.x},${pt.y}`;

        if (ptHashes.has(ptHash)) return true;

        ptHashes.add(ptHash);
      }
    }

    return false;
  }

  private isExteriorWaist(aSegA: SEG, aSegB: SEG): boolean {
    const da = { x: aSegA.B.x - aSegA.A.x, y: aSegA.B.y - aSegA.A.y };
    const axis = Math.abs(da.x) >= Math.abs(da.y) ? 0 : 1;

    const pts: VECTOR2I[] = [aSegA.A, aSegA.B, aSegB.A, aSegB.B];
    pts.sort((p, q) => {
      if (axis === 0) return p.x - q.x || p.y - q.y;
      return p.y - q.y || p.x - q.x;
    });

    const s = pts[1]!;
    const e = pts[2]!;

    // Check if there is polygon material on either side of the overlapping segments
    // Get the midpoint between s and e for testing
    const midpoint = divideI({ x: s.x + e.x, y: s.y + e.y }, 2);

    // Create perpendicular offset vector to check both sides
    const segDir = { x: e.x - s.x, y: e.y - s.y };

    if (EuclideanNormI(segDir) > 25) {
      const perp = ResizeI({ x: -segDir.y, y: segDir.x }, 10);

      // Test points on both sides of the overlapping segment
      const side1 = this.PointInside({ x: midpoint.x + perp.x, y: midpoint.y + perp.y });
      const side2 = this.PointInside({ x: midpoint.x - perp.x, y: midpoint.y - perp.y });

      // Only return true if both sides are outside the polygon
      // This is the case for non-fractured segments
      if (!side1 && !side2) {
        return true;
      }
    }

    return false;
  }

  private splitCollinearOutlines(): void {
    for (let polyIdx = 0; polyIdx < this.m_polys.length; ++polyIdx) {
      let changed = true;

      while (changed) {
        changed = false;

        const outline = this.m_polys[polyIdx]![0]!;
        const count = outline.PointCount();

        // RTree<intptr_t, intptr_t, 2, intptr_t>
        const rtree = new RTreeIntReal<number>(2);

        for (let i = 0; i < count; ++i) {
          const a = outline.CPoint(i);
          const b = outline.CPoint((i + 1) % count);
          const min = [Math.min(a.x, b.x), Math.min(a.y, b.y)];
          const max = [Math.max(a.x, b.x), Math.max(a.y, b.y)];
          rtree.Insert(min, max, i);
        }

        let found = false;
        let segA = -1;
        let segB = -1;

        for (let i = 0; i < count && !found; ++i) {
          const a = outline.CPoint(i);
          const b = outline.CPoint((i + 1) % count);
          const seg = new SEG(a, b);
          const min = [Math.min(a.x, b.x), Math.min(a.y, b.y)];
          const max = [Math.max(a.x, b.x), Math.max(a.y, b.y)];

          const visitor = (j: number): boolean => {
            if (j === i || j === (i + 1) % count || j === (i + count - 1) % count) return true;

            const oa = outline.CPoint(j);
            const ob = outline.CPoint((j + 1) % count);
            const other = new SEG(oa, ob);

            // Skip segments that share start/end points.  This is the case for
            // fractured segments
            if (samePoint(oa, a) && samePoint(ob, b)) return true;

            if (samePoint(oa, b) && samePoint(ob, a)) return true;

            if (seg.ApproxCollinear(other, 10) && this.isExteriorWaist(seg, other)) {
              segA = i;
              segB = j;
              found = true;
              return false;
            }

            return true;
          };

          rtree.Search(min, max, visitor);
        }

        if (!found) break;

        const a0 = segA;
        const a1 = (segA + 1) % outline.PointCount();
        const b0 = segB;
        const b1 = (segB + 1) % outline.PointCount();

        const lc1 = new SHAPE_LINE_CHAIN();
        let idx = a1;
        lc1.Append(outline.CPoint(idx));

        while (idx !== b0) {
          idx = (idx + 1) % outline.PointCount();
          lc1.Append(outline.CPoint(idx));
        }

        lc1.SetClosed(true);

        const lc2 = new SHAPE_LINE_CHAIN();
        idx = b1;
        lc2.Append(outline.CPoint(idx));

        while (idx !== a0) {
          idx = (idx + 1) % outline.PointCount();
          lc2.Append(outline.CPoint(idx));
        }

        lc2.SetClosed(true);

        this.m_polys[polyIdx]![0] = lc1;
        const np: POLYGON = [];
        np.push(lc2);
        this.m_polys.push(np);
        changed = true;
      }
    }
  }

  private splitSelfTouchingOutlines(): void {
    for (let polyIdx = 0; polyIdx < this.m_polys.length; ++polyIdx) {
      let changed = true;

      while (changed) {
        changed = false;

        const outline = this.m_polys[polyIdx]![0]!;
        const count = outline.PointCount();

        if (count < 4) break;

        let insertSegIdx = -1;
        let insertVertIdx = -1;

        // For small polygons, direct O(n²) search is faster than R-tree overhead
        const RTREE_THRESHOLD = 32;

        if (count < RTREE_THRESHOLD) {
          for (let vertIdx = 0; vertIdx < count && insertSegIdx < 0; ++vertIdx) {
            const pt = outline.CPoint(vertIdx);
            const prevSeg = (vertIdx + count - 1) % count;

            for (let segIdx = 0; segIdx < count; ++segIdx) {
              // Skip adjacent segments
              if (segIdx === prevSeg || segIdx === vertIdx) continue;

              const a = outline.CPoint(segIdx);
              const b = outline.CPoint((segIdx + 1) % count);

              // SquaredDistance returns 0 only when pt lies exactly on the
              // segment.  Clipper2 rounds corridor-cut vertices to integer
              // coordinates; they can land within 1nm of an endpoint but are
              // not true pinch points.
              if (
                !samePoint(pt, a) &&
                !samePoint(pt, b) &&
                new SEG(a, b).SquaredDistance(pt) === 0
              ) {
                insertSegIdx = segIdx;
                insertVertIdx = vertIdx;
                break;
              }
            }
          }
        } else {
          const rtree = new RTree<number>(2);

          for (let i = 0; i < count; ++i) {
            const a = outline.CPoint(i);
            const b = outline.CPoint((i + 1) % count);
            const bmin = [Math.min(a.x, b.x), Math.min(a.y, b.y)];
            const bmax = [Math.max(a.x, b.x), Math.max(a.y, b.y)];
            rtree.Insert(bmin, bmax, i);
          }

          for (let vertIdx = 0; vertIdx < count && insertSegIdx < 0; ++vertIdx) {
            const pt = outline.CPoint(vertIdx);
            const prevSeg = (vertIdx + count - 1) % count;
            const bmin = [pt.x, pt.y];
            const bmax = [pt.x, pt.y];

            rtree.Search(bmin, bmax, (segIdx: number): boolean => {
              if (segIdx === prevSeg || segIdx === vertIdx) return true;

              const a = outline.CPoint(segIdx);
              const b = outline.CPoint((segIdx + 1) % count);

              // SquaredDistance returns 0 only when pt lies exactly on the
              // segment.  Clipper2 rounds corridor-cut vertices to integer
              // coordinates; they can land within 1nm of an endpoint but
              // are not true pinch points.
              if (
                !samePoint(pt, a) &&
                !samePoint(pt, b) &&
                new SEG(a, b).SquaredDistance(pt) === 0
              ) {
                insertSegIdx = segIdx;
                insertVertIdx = vertIdx;
                return false;
              }

              return true;
            });
          }
        }

        if (insertSegIdx < 0) break;

        // Split the polygon at the pinch point into two separate polygons.
        // Polygon 1: vertices from (insertSegIdx+1) to insertVertIdx
        // Polygon 2: vertices from insertVertIdx to insertSegIdx
        const splitStart1 = (insertSegIdx + 1) % count;

        // Calculate sizes for each polygon
        let size1: number;
        let size2: number;

        if (insertVertIdx >= splitStart1) size1 = insertVertIdx - splitStart1 + 1;
        else size1 = count - splitStart1 + insertVertIdx + 1;

        if (insertSegIdx >= insertVertIdx) size2 = insertSegIdx - insertVertIdx + 1;
        else size2 = count - insertVertIdx + insertSegIdx + 1;

        if (size1 < 3 || size2 < 3) break;

        const poly1 = new SHAPE_LINE_CHAIN();
        const poly2 = new SHAPE_LINE_CHAIN();

        let idx = splitStart1;

        for (let i = 0; i < size1; ++i) {
          poly1.Append(outline.CPoint(idx));
          idx = (idx + 1) % count;
        }

        poly1.SetClosed(true);

        idx = insertVertIdx;

        for (let i = 0; i < size2; ++i) {
          poly2.Append(outline.CPoint(idx));
          idx = (idx + 1) % count;
        }

        poly2.SetClosed(true);

        this.m_polys[polyIdx]![0] = poly1;
        const np: POLYGON = [];
        np.push(poly2);
        this.m_polys.push(np);
        changed = true;
      }
    }
  }

  /**
   * Simplify the polyset (merges overlapping polys, eliminates degeneracy/self-intersections)
   */
  Simplify(): void {
    this.splitCollinearOutlines();

    const empty = new SHAPE_POLY_SET();
    this.booleanOp(ClipType.Union, empty);
  }

  /**
   * Simplifies the lines in the polyset.  This checks intermediate points to see if they are
   * collinear with their neighbors, and removes them if they are.
   *
   * @param aMaxError is the maximum error to allow when simplifying the lines.
   */
  SimplifyOutlines(aMaxError = 0): void {
    for (const paths of this.m_polys) {
      for (const path of paths) {
        path.Simplify(aMaxError);
      }
    }
  }

  /**
   * Convert a set of slitted polygons to a set of polygons with holes, or
   * normalize the shapes it contains.
   *
   * @return the polygon count (always >= 1, because there is at least one polygon)
   *         There are new polygons only if the polygon count is > 1.
   */
  NormalizeAreaOutlines(): number {
    // We are expecting only one main outline, but this main outline can have holes
    // if holes: combine holes and remove them from the main outline.
    // Note also we are usingin polygon
    // calculations, but it is not mandatory. It is used mainly
    // because there is usually only very few vertices in area outlines
    const outline = this.Polygon(0);
    const holesBuffer = new SHAPE_POLY_SET();

    // Move holes stored in outline to holesBuffer:
    // The first SHAPE_LINE_CHAIN is the main outline, others are holes
    while (outline.length > 1) {
      holesBuffer.AddOutline(outline[outline.length - 1]!);
      outline.pop();
    }

    this.Simplify();

    // If any hole, subtract it to main outline
    if (holesBuffer.OutlineCount()) {
      holesBuffer.Simplify();
      this.BooleanSubtract(holesBuffer);
    }

    // In degenerate cases, simplify might return no outlines
    if (this.OutlineCount() > 0) this.RemoveNullSegments();

    return this.OutlineCount();
  }

  /// @copydoc SHAPE::Format()
  override Format(aCplusPlus = true): string {
    let ss = 'SHAPE_LINE_CHAIN poly; \n';

    for (let i = 0; i < this.m_polys.length; i++) {
      for (let j = 0; j < this.m_polys[i]!.length; j++) {
        ss += `{ auto tmp = ${this.m_polys[i]![j]!.Format()};\n`;

        if (j === 0) {
          ss += ' poly.AddOutline(tmp); } \n';
        } else {
          ss += ' poly.AddHole(tmp); } \n';
        }
      }
    }

    return ss;
  }

  /// @copydoc SHAPE::Parse()
  override Parse(aStream: string): boolean {
    const tokens = aStream.trim().split(/\s+/);
    let pos = 0;
    const next = (): string => tokens[pos++] ?? '';
    const atoi = (s: string): number => {
      const v = Number.parseInt(s, 10);
      return Number.isNaN(v) ? 0 : v;
    };

    let tmp = next();

    if (tmp !== 'polyset') return false;

    tmp = next();

    const n_polys = atoi(tmp);

    if (n_polys < 0) return false;

    for (let i = 0; i < n_polys; i++) {
      const paths: POLYGON = [];

      tmp = next();

      if (tmp !== 'poly') return false;

      tmp = next();
      const n_outlines = atoi(tmp);

      if (n_outlines < 0) return false;

      for (let j = 0; j < n_outlines; j++) {
        const outline = new SHAPE_LINE_CHAIN();
        outline.SetClosed(true);

        tmp = next();
        const n_vertices = atoi(tmp);

        for (let v = 0; v < n_vertices; v++) {
          const p = { x: 0, y: 0 };

          tmp = next();
          p.x = atoi(tmp);
          tmp = next();
          p.y = atoi(tmp);
          outline.Append(p);
        }

        paths.push(outline);
      }

      this.m_polys.push(paths);
    }

    return true;
  }

  Move(aVector: Vec2): void {
    for (const poly of this.m_polys) {
      for (const path of poly) path.Move(aVector);
    }

    for (const tri of this.m_triangulatedPolys) tri.Move(aVector);

    this.m_hash = this.checksum();
    this.m_hashValid = true;
  }

  Mirror(aRef: Vec2, aFlipDirection: FLIP_DIRECTION): void {
    for (const poly of this.m_polys) {
      for (const path of poly) path.Mirror(aRef, aFlipDirection);
    }

    if (this.m_triangulationValid) this.CacheTriangulation();
  }

  /**
   * Rotate all vertices by a given angle.
   *
   * @param aCenter is the rotation center.
   * @param aAngle is the rotation angle.
   */
  Rotate(aAngle: EDA_ANGLE, aCenter: Vec2 = { x: 0, y: 0 }): void {
    for (const poly of this.m_polys) {
      for (const path of poly) path.Rotate(aAngle, aCenter);
    }

    // Don't re-cache if the triangulation is already invalid
    if (this.m_triangulationValid) this.CacheTriangulation();
  }

  IsSolid(): boolean {
    return true;
  }

  BBox(aClearance = 0): BOX2I {
    let bb = new BOX2I();

    for (let i = 0; i < this.m_polys.length; i++) {
      if (i === 0) bb = this.m_polys[i]![0]!.BBox();
      else bb.Merge(this.m_polys[i]![0]!.BBox());
    }

    bb.Inflate(aClearance);
    return bb;
  }

  /**
   * Check if point aP lies on an edge or vertex of some of the outlines or holes.
   *
   * @param aP is the point to check.
   * @return true if the point lies on the edge of any polygon.
   */
  PointOnEdge(aP: Vec2, aAccuracy = 0): boolean {
    // Iterate through all the polygons in the set
    for (const polygon of this.m_polys) {
      // Iterate through all the line chains in the polygon
      for (const lineChain of polygon) {
        if (lineChain.PointOnEdge(aP, aAccuracy)) return true;
      }
    }

    return false;
  }

  /**
   * Check if the boundary of shape (this) lies closer to the shape \a aShape than \a aClearance,
   * indicating a collision.
   *
   * @param aShape shape to check collision against
   * @param aClearance minimum clearance
   * @param aActual [out] an optional pointer to an int to store the actual distance in the
   *                event of a collision.
   * @param aLocation [out] an option pointer to a point to store a nearby location in the
   *                  event of a collision.
   * @return true, if there is a collision.
   */
  override CollideShape(
    aShape: SHAPE,
    aClearance = 0,
    aActual?: OutInt,
    aLocation?: VECTOR2I,
  ): boolean {
    // A couple of simple cases are worth trying before we fall back on triangulation.

    if (aShape.Type() === SHAPE_TYPE.SH_SEGMENT) {
      const segment = aShape as SHAPE_SEGMENT;
      const extra = Math.trunc(segment.GetWidth() / 2);

      if (this.CollideSeg(segment.GetSeg(), aClearance + extra, aActual, aLocation)) {
        if (aActual) aActual.value = Math.max(0, aActual.value - extra);

        return true;
      }

      return false;
    }

    if (aShape.Type() === SHAPE_TYPE.SH_CIRCLE) {
      const circle = aShape as SHAPE_CIRCLE;
      const extra = circle.GetRadius();

      if (this.CollidePoint(circle.GetCenter(), aClearance + extra, aActual, aLocation)) {
        if (aActual) aActual.value = Math.max(0, aActual.value - extra);

        return true;
      }

      return false;
    }

    this.CacheTriangulation(false);

    let actual = INT_MAX;
    let location: VECTOR2I = { x: 0, y: 0 };

    for (const tpoly of this.m_triangulatedPolys) {
      for (const tri of tpoly.Triangles()) {
        if (aActual || aLocation) {
          const triActual = { value: 0 };
          const triLocation: VECTOR2I = { x: 0, y: 0 };

          if (aShape.CollideShape(tri, aClearance, triActual, triLocation)) {
            if (triActual.value < actual) {
              actual = triActual.value;
              location = triLocation;
            }
          }
        } // A much faster version of above
        else {
          if (aShape.CollideShape(tri, aClearance)) return true;
        }
      }
    }

    if (actual < INT_MAX) {
      if (aActual) aActual.value = Math.max(0, actual);

      if (aLocation) {
        aLocation.x = location.x;
        aLocation.y = location.y;
      }

      return true;
    }

    return false;
  }

  /**
   * Check whether the point \a aP is either inside or on the edge of the polygon set.
   *
   * Note that prior to Jul 2020 we considered the edge to *not* be part of the polygon.
   * However, most other shapes (rects, circles, segments, etc.) include their edges and
   * the difference was causing issues when used for DRC.
   *
   * (NB: in the case of DRC, the edge of a polygon should be considered part of the polygon
   * because a clearance violation with the edge is also a violation with the polygon.  It is
   * also important that the clearance check not include the edge where the edges of the two
   * items are in contact so that we do not report clearance violations for items that are
   * touching, e.g. a track and a zone that are connected.)
   *
   * @param aP is the VECTOR2I point whose collision with respect to the poly set will be tested.
   * @param aClearance is the security distance; if the point lies closer to a vertex than
   *                   aClearance distance, then there is a collision.
   * @param aActual an optional pointer to an int to store the actual distance in the event
   *                of a collision.
   * @return true if the point aP collides with the polygon; false in any other case.
   */
  override CollidePoint(aP: Vec2, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    if (this.IsEmpty() || this.VertexCount() === 0) return false;

    const nearest: VECTOR2I = { x: 0, y: 0 };
    const dist_sq = this.SquaredDistanceNearest(aP, false, aLocation ? nearest : undefined);

    if (dist_sq === 0 || dist_sq < aClearance * aClearance) {
      if (aLocation) {
        aLocation.x = nearest.x;
        aLocation.y = nearest.y;
      }

      if (aActual) aActual.value = Math.trunc(Math.sqrt(dist_sq));

      return true;
    }

    return false;
  }

  /**
   * Check whether the segment \a aSeg collides with the polygon set (or its edge).
   */
  CollideSeg(aSeg: SEG, aClearance = 0, aActual?: OutInt, aLocation?: VECTOR2I): boolean {
    const nearest: VECTOR2I = { x: 0, y: 0 };
    const dist_sq = this.SquaredDistanceToSeg(aSeg, aLocation ? nearest : undefined);

    if (dist_sq === 0 || dist_sq < aClearance * aClearance) {
      if (aLocation) {
        aLocation.x = nearest.x;
        aLocation.y = nearest.y;
      }

      if (aActual) aActual.value = Math.trunc(Math.sqrt(dist_sq));

      return true;
    }

    return false;
  }

  /**
   * Check whether \a aPoint collides with any vertex of any of the contours of the polygon.
   *
   * @param aPoint is the VECTOR2I point whose collision with respect to the polygon
   *               will be tested.
   * @param aClearance is the security distance; if \a aPoint lies closer to a vertex than
   *                   aClearance distance, then there is a collision.
   * @param aClosestVertex is the index of the closes vertex to \a aPoint.
   * @return bool - true if there is a collision, false in any other case.
   */
  CollideVertex(aPoint: Vec2, aClosestVertex?: VERTEX_INDEX, aClearance = 0): boolean {
    // Shows whether there was a collision
    let collision = false;

    // Difference vector between each vertex and aPoint.
    let distance_squared: number;
    let clearance_squared = aClearance * aClearance;

    for (const iterator = this.CIterateWithHoles(); iterator.valid(); iterator.Advance()) {
      // Get the difference vector between current vertex and aPoint
      const v = iterator.Get();
      const dx = v.x - aPoint.x;
      const dy = v.y - aPoint.y;

      // Compute distance
      distance_squared = dx * dx + dy * dy;

      // Check for collisions
      if (distance_squared <= clearance_squared) {
        if (!aClosestVertex) return true;

        collision = true;

        // Update clearance to look for closer vertices
        clearance_squared = distance_squared;

        // Store the indices that identify the vertex
        const idx = iterator.GetIndex();
        aClosestVertex.m_polygon = idx.m_polygon;
        aClosestVertex.m_contour = idx.m_contour;
        aClosestVertex.m_vertex = idx.m_vertex;
      }
    }

    return collision;
  }

  /**
   * Check whether aPoint collides with any edge of any of the contours of the polygon.
   *
   * @param aPoint is the VECTOR2I point whose collision with respect to the polygon
   *               will be tested.
   * @param aClearance is the security distance; if \a aPoint lies closer to a vertex than
   *                   aClearance distance, then there is a collision.
   * @param aClosestVertex is the index of the closes vertex to \a aPoint.
   * @return bool - true if there is a collision, false in any other case.
   */
  CollideEdge(aPoint: Vec2, aClosestVertex?: VERTEX_INDEX, aClearance = 0): boolean {
    // Shows whether there was a collision
    let collision = false;
    let clearance_squared = aClearance * aClearance;

    for (const iterator = this.CIterateSegmentsWithHoles(); iterator.valid(); iterator.Advance()) {
      const currentSegment = iterator.Get();
      const distance_squared = currentSegment.SquaredDistance(aPoint);

      // Check for collisions
      if (distance_squared <= clearance_squared) {
        if (!aClosestVertex) return true;

        collision = true;

        // Update clearance to look for closer edges
        clearance_squared = distance_squared;

        // Store the indices that identify the vertex
        const idx = iterator.GetIndex();
        aClosestVertex.m_polygon = idx.m_polygon;
        aClosestVertex.m_contour = idx.m_contour;
        aClosestVertex.m_vertex = idx.m_vertex;
      }
    }

    return collision;
  }

  override PointInside(aPt: Vec2, aAccuracy = 0, aUseBBoxCache = false): boolean {
    for (let idx = 0; idx < this.OutlineCount(); idx++) {
      if (this.COutline(idx).PointInside(aPt, aAccuracy, aUseBBoxCache)) return true;
    }

    return false;
  }

  /**
   * Construct BBoxCaches for Contains(), below.
   *
   * @note These caches **must** be built before a group of calls to Contains().  They are
   *       **not** kept up-to-date by editing actions.
   */
  BuildBBoxCaches(): void {
    for (let polygonIdx = 0; polygonIdx < this.OutlineCount(); polygonIdx++) {
      this.COutline(polygonIdx).GenerateBBoxCache();

      for (let holeIdx = 0; holeIdx < this.HoleCount(polygonIdx); holeIdx++)
        this.CHole(polygonIdx, holeIdx).GenerateBBoxCache();
    }
  }

  BBoxFromCaches(): BOX2I {
    let bb = new BOX2I();

    for (let i = 0; i < this.m_polys.length; i++) {
      if (i === 0) bb = this.m_polys[i]![0]!.GetCachedBBox().Clone();
      else bb.Merge(this.m_polys[i]![0]!.GetCachedBBox());
    }

    return bb;
  }

  /**
   * Return true if a given subpolygon contains the point \a aP.
   *
   * @param aP is the point to check
   * @param aSubpolyIndex is the subpolygon to check, or -1 to check all
   * @param aAccuracy accuracy in internal units
   * @param aUseBBoxCaches gives faster performance when multiple calls are made with no
   *                       editing in between, but the caller **must** cache the bbox caches
   *                       before calling (via BuildBBoxCaches(), above)
   * @return true if \a aP is inside aSubpolyIndex-th polygon; false in any other case.
   */
  Contains(aP: Vec2, aSubpolyIndex = -1, aAccuracy = 0, aUseBBoxCaches = false): boolean {
    if (this.m_polys.length === 0) return false;

    // If there is a polygon specified, check the condition against that polygon
    if (aSubpolyIndex >= 0)
      return this.containsSingle(aP, aSubpolyIndex, aAccuracy, aUseBBoxCaches);

    // In any other case, check it against all polygons in the set
    for (let polygonIdx = 0; polygonIdx < this.OutlineCount(); polygonIdx++) {
      if (this.containsSingle(aP, polygonIdx, aAccuracy, aUseBBoxCaches)) return true;
    }

    return false;
  }

  /**
   * Return true if the set is empty (no polygons at all)
   */
  IsEmpty(): boolean {
    return this.m_polys.length === 0;
  }

  /**
   * Delete the \a aGlobalIndex-th vertex.
   */
  RemoveVertex(aGlobalIndex: number): void;
  /**
   * Delete the vertex indexed by \a aRelativeIndices (index of polygon, contour and vertex).
   */
  RemoveVertex(aRelativeIndices: VERTEX_INDEX): void;
  RemoveVertex(a: number | VERTEX_INDEX): void {
    if (a instanceof VERTEX_INDEX) {
      this.m_polys[a.m_polygon]![a.m_contour]!.Remove(a.m_vertex);
      return;
    }

    const index = new VERTEX_INDEX();

    // Assure the to be removed vertex exists, abort otherwise
    if (this.GetRelativeIndices(a, index)) this.RemoveVertex(index);
    else throw new RangeError('aGlobalIndex-th vertex does not exist');
  }

  /**
   * Remove all outlines & holes (clears) the polygon set.
   */
  RemoveAllContours(): void {
    this.m_polys = [];
    this.m_triangulatedPolys = [];
    this.m_triangulationValid = false;
  }

  /**
   * Delete the \a aContourIdx-th contour of the \a aPolygonIdx-th polygon in the set.
   */
  RemoveContour(aContourIdx: number, aPolygonIdx = -1): void {
    // Default polygon is the last one
    if (aPolygonIdx < 0) aPolygonIdx += this.m_polys.length;

    this.m_polys[aPolygonIdx]!.splice(aContourIdx, 1);
  }

  /**
   * Delete the \a aOutlineIdx-th outline of the set including its contours and holes.
   */
  RemoveOutline(aOutlineIdx: number): void {
    this.m_polys.splice(aOutlineIdx, 1);
  }

  /**
   * Look for null segments; ie, segments whose ends are exactly the same and deletes them.
   *
   * @return the number of deleted segments.
   */
  RemoveNullSegments(): number {
    let removed = 0;

    const iterator = this.IterateWithHoles();

    let contourStart = iterator.Get();
    let segmentStart: VECTOR2I;
    let segmentEnd: VECTOR2I;

    let indexStart: VERTEX_INDEX;
    const indices_to_remove: VERTEX_INDEX[] = [];

    while (iterator.valid()) {
      // Obtain first point and its index
      segmentStart = iterator.Get();
      indexStart = iterator.GetIndex();

      // Obtain last point
      if (iterator.IsEndContour()) {
        segmentEnd = contourStart;

        // Advance
        iterator.Advance();

        // If we have rolled into the next contour, remember its position
        // segmentStart and segmentEnd remain valid for comparison here
        if (iterator.valid()) contourStart = iterator.Get();
      } else {
        // Advance
        iterator.Advance();

        // If we have reached the end of the SHAPE_POLY_SET, something is broken here
        if (!iterator.valid()) return removed; // wxCHECK_MSG( "Invalid polygon. Reached end without noticing." )

        segmentEnd = iterator.Get();
      }

      // Remove segment start if both points are equal
      if (samePoint(segmentStart, segmentEnd)) {
        indices_to_remove.push(indexStart);
        removed++;
      }
    }

    // Proceed in reverse direction to remove the vertices because they are stored as absolute indices in a vector
    // Removing in reverse order preserves the remaining index values
    for (let i = indices_to_remove.length - 1; i >= 0; --i)
      this.RemoveVertex(indices_to_remove[i]!);

    return removed;
  }

  /**
   * Accessor function to set the position of a specific point.
   */
  SetVertex(aIndex: VERTEX_INDEX, aPos: Vec2): void;
  /**
   * Set the vertex based on the global index.  Throws if the index doesn't exist.
   */
  SetVertex(aGlobalIndex: number, aPos: Vec2): void;
  SetVertex(a: VERTEX_INDEX | number, aPos: Vec2): void {
    if (a instanceof VERTEX_INDEX) {
      this.m_polys[a.m_polygon]![a.m_contour]!.SetPoint(a.m_vertex, aPos);
      return;
    }

    const index = new VERTEX_INDEX();

    if (this.GetRelativeIndices(a, index)) this.SetVertex(index, aPos);
    else throw new RangeError('aGlobalIndex-th vertex does not exist');
  }

  TotalVertices(): number {
    let c = 0;

    for (const poly of this.m_polys) {
      for (const path of poly) c += path.PointCount();
    }

    return c;
  }

  /**
   * Delete \a aIdx-th polygon from the set.
   */
  DeletePolygon(aIdx: number): void {
    this.m_polys.splice(aIdx, 1);
  }

  /**
   * Delete \a aIdx-th polygon and its triangulation data from the set.
   * If called with \a aUpdateHash false, the hash must be updated by the caller.
   */
  DeletePolygonAndTriangulationData(aIdx: number, aUpdateHash = true): void {
    this.m_polys.splice(aIdx, 1);

    if (this.m_triangulationValid) {
      for (let ii = this.m_triangulatedPolys.length - 1; ii >= 0; --ii) {
        const triangleSet = this.m_triangulatedPolys[ii]!;

        if (triangleSet.GetSourceOutlineIndex() === aIdx) this.m_triangulatedPolys.splice(ii, 1);
        else if (triangleSet.GetSourceOutlineIndex() > aIdx)
          triangleSet.SetSourceOutlineIndex(triangleSet.GetSourceOutlineIndex() - 1);
      }

      if (aUpdateHash) {
        this.m_hash = this.checksum();
        this.m_hashValid = true;
      }
    }
  }

  UpdateTriangulationDataHash(): void {
    this.m_hash = this.checksum();
    this.m_hashValid = true;
  }

  /**
   * Return a chamfered version of the \a aIndex-th polygon.
   */
  ChamferPolygon(aDistance: number, aIndex: number): POLYGON {
    return this.chamferFilletPolygon(CornerMode.CHAMFERED, aDistance, aIndex, 0);
  }

  /**
   * Return a filleted version of the \a aIndex-th polygon.
   */
  FilletPolygon(aRadius: number, aErrorMax: number, aIndex: number): POLYGON {
    return this.chamferFilletPolygon(CornerMode.FILLETED, aRadius, aIndex, aErrorMax);
  }

  /**
   * Return a chamfered version of the polygon set.
   */
  Chamfer(aDistance: number): SHAPE_POLY_SET {
    const chamfered = new SHAPE_POLY_SET();

    for (let idx = 0; idx < this.m_polys.length; idx++)
      chamfered.m_polys.push(this.ChamferPolygon(aDistance, idx));

    return chamfered;
  }

  /**
   * Return a filleted version of the polygon set.
   */
  Fillet(aRadius: number, aErrorMax: number): SHAPE_POLY_SET {
    const filleted = new SHAPE_POLY_SET();

    for (let idx = 0; idx < this.m_polys.length; idx++)
      filleted.m_polys.push(this.FilletPolygon(aRadius, aErrorMax, idx));

    return filleted;
  }

  /**
   * `SHAPE_POLY_SET::chamferFilletPolygon` (corner_operations.cpp): replace
   * every corner of every contour with either a straight cut (chamfer) or an
   * arc (fillet). Both are limited to half of the shorter adjacent edge, so a
   * corner can never eat its neighbour, and both leave parallel edges alone.
   */
  private chamferFilletPolygon(
    aMode: CornerMode,
    aDistance: number,
    aIndex: number,
    aErrorMax: number,
  ): POLYGON {
    // Null segments create serious issues in calculations. Remove them:
    this.RemoveNullSegments();

    const currentPoly = this.Polygon(aIndex).map((c) => new SHAPE_LINE_CHAIN(c));
    const newPoly: POLYGON = [];

    // If the chamfering distance is zero, then the polygon remain intact.
    if (aDistance === 0) {
      return currentPoly;
    }

    // If we are chamfering, we will call it with distance defined as the argument aDistance;
    // if we are filleting, we will call it with radius defined as the argument aDistance.
    const distance = aDistance;
    const radius = aDistance;

    const chamfered = aMode === CornerMode.CHAMFERED;

    // Iterate through all the contours (outline and holes) of the polygon.
    for (const currContour of currentPoly) {
      // Generate a new contour in the new polygon
      const newContour = new SHAPE_LINE_CHAIN();

      // Iterate through the vertices of the contour
      for (let currVertex = 0; currVertex < currContour.PointCount(); currVertex++) {
        // Current vertex
        const x1 = currContour.CPoint(currVertex).x;
        const y1 = currContour.CPoint(currVertex).y;

        // Indices for the previous and next vertices.
        let prevVertex: number;
        let nextVertex: number;

        // Previous and next vertices indices computation. Necessary to manage the edge cases.
        if (currVertex === 0) prevVertex = currContour.PointCount() - 1;
        else prevVertex = currVertex - 1;

        if (currVertex === currContour.PointCount() - 1) nextVertex = 0;
        else nextVertex = currVertex + 1;

        // Previous vertex computation
        const xa = currContour.CPoint(prevVertex).x - x1;
        const ya = currContour.CPoint(prevVertex).y - y1;

        // Next vertex computation
        const xb = currContour.CPoint(nextVertex).x - x1;
        const yb = currContour.CPoint(nextVertex).y - y1;

        // Avoid segments that will generate nans below
        if (Math.abs(xa + xb) < Number.EPSILON && Math.abs(ya + yb) < Number.EPSILON) continue;

        // Compute the new distances
        const lena = hypot(xa, ya);
        const lenb = hypot(xb, yb);

        // Make the final computations depending on the mode selected, chamfered or filleted.
        if (chamfered) {
          let distance2 = distance;

          // Chamfer one half of an edge at most
          if (0.5 * lena < distance2) distance2 = 0.5 * lena;

          if (0.5 * lenb < distance2) distance2 = 0.5 * lenb;

          const nx1 = KiROUND((distance2 * xa) / lena);
          const ny1 = KiROUND((distance2 * ya) / lena);

          newContour.Append(x1 + nx1, y1 + ny1);

          const nx2 = KiROUND((distance2 * xb) / lenb);
          const ny2 = KiROUND((distance2 * yb) / lenb);

          newContour.Append(x1 + nx2, y1 + ny2);
        } // Filleted
        else {
          const cosine = (xa * xb + ya * yb) / (lena * lenb);
          let radius2 = radius;
          const denom = Math.sqrt(2.0 / (1 + cosine) - 1);

          // Do nothing in case of parallel edges
          if (!Number.isFinite(denom)) continue;

          // Limit rounding distance to one half of an edge
          if (0.5 * lena * denom < radius2) radius2 = 0.5 * lena * denom;

          if (0.5 * lenb * denom < radius2) radius2 = 0.5 * lenb * denom;

          // Calculate fillet arc absolute center point (xc, yc)
          let k = radius2 / Math.sqrt(0.5 * (1 - cosine));
          const lenab = Math.sqrt(
            (xa / lena + xb / lenb) * (xa / lena + xb / lenb) +
              (ya / lena + yb / lenb) * (ya / lena + yb / lenb),
          );
          const xc = x1 + (k * (xa / lena + xb / lenb)) / lenab;
          const yc = y1 + (k * (ya / lena + yb / lenb)) / lenab;

          // Calculate arc start and end vectors
          k = radius2 / Math.sqrt(2 / (1 + cosine) - 1);
          const xs = x1 + (k * xa) / lena - xc;
          const ys = y1 + (k * ya) / lena - yc;
          const xe = x1 + (k * xb) / lenb - xc;
          const ye = y1 + (k * yb) / lenb - yc;

          // Cosine of arc angle
          let argument = (xs * xe + ys * ye) / (radius2 * radius2);

          // Make sure the argument is in [-1,1], interval in which the acos function is
          // defined
          if (argument < -1) argument = -1;
          else if (argument > 1) argument = 1;

          const arcAngle = acos(argument);
          // `GetArcToSegmentCount( radius, aErrorMax, EDA_ANGLE( arcAngle, RADIANS_T ) )`
          // takes `int aRadius`: the double radius truncates on the way in.
          const segments = getArcToSegmentCount(
            Math.trunc(radius2),
            aErrorMax,
            new EDA_ANGLE(arcAngle, EDA_ANGLE_T.RADIANS_T).AsDegrees(),
          );

          let deltaAngle = arcAngle / segments;
          const startAngle = atan2(-ys, xs);

          // Flip arc for inner corners
          if (xa * yb - ya * xb <= 0) deltaAngle *= -1;

          let nx = xc + xs;
          let ny = yc + ys;

          if (Number.isNaN(nx) || Number.isNaN(ny)) continue;

          newContour.Append(KiROUND(nx), KiROUND(ny));

          // Store the previous added corner to make a sanity check
          let prevX = KiROUND(nx);
          let prevY = KiROUND(ny);

          for (let j = 0; j < segments; j++) {
            nx = xc + cos(startAngle + (j + 1) * deltaAngle) * radius2;
            ny = yc - sin(startAngle + (j + 1) * deltaAngle) * radius2;

            if (Number.isNaN(nx) || Number.isNaN(ny)) continue;

            // Sanity check: the rounding can produce repeated corners; do not add them.
            if (KiROUND(nx) !== prevX || KiROUND(ny) !== prevY) {
              newContour.Append(KiROUND(nx), KiROUND(ny));
              prevX = KiROUND(nx);
              prevY = KiROUND(ny);
            }
          }
        }
      }

      // Close the current contour and add it the new polygon
      newContour.SetClosed(true);
      newPoly.push(newContour);
    }

    return newPoly;
  }

  /**
   * Compute the minimum distance between the \a aIndex-th polygon and \a aPoint.
   */
  SquaredDistanceToPolygon(aPoint: Vec2, aIndex: number, aNearest?: VECTOR2I): number;
  /**
   * Compute the minimum distance between the aIndex-th polygon and aSegment with a
   * possible width.
   */
  SquaredDistanceToPolygon(aSegment: SEG, aIndex: number, aNearest?: VECTOR2I): number;
  SquaredDistanceToPolygon(a: Vec2 | SEG, aPolygonIndex: number, aNearest?: VECTOR2I): number {
    if (a instanceof SEG) {
      // Check if the segment is fully-contained.  If so, its midpoint is a good-enough nearest point.
      if (
        this.containsSingle(a.A, aPolygonIndex, 1) &&
        this.containsSingle(a.B, aPolygonIndex, 1)
      ) {
        if (aNearest) {
          const m = divideI({ x: a.A.x + a.B.x, y: a.A.y + a.B.y }, 2);
          aNearest.x = m.x;
          aNearest.y = m.y;
        }

        return 0;
      }

      const iterator = this.CIterateSegmentsWithHoles(aPolygonIndex);
      let minDistance = iterator.Get().SquaredDistance(a);

      if (aNearest) {
        const p = iterator.Get().NearestPoint(a);
        aNearest.x = p.x;
        aNearest.y = p.y;
      }

      for (iterator.Advance(); iterator.valid() && minDistance > 0; iterator.Advance()) {
        const currentDistance = iterator.Get().SquaredDistance(a);

        if (currentDistance < minDistance) {
          if (aNearest) {
            const p = iterator.Get().NearestPoint(a);
            aNearest.x = p.x;
            aNearest.y = p.y;
          }

          minDistance = currentDistance;
        }
      }

      // Return the maximum of minDistance and zero
      return minDistance < 0 ? 0 : minDistance;
    }

    // We calculate the min dist between the segment and each outline segment.  However, if the
    // segment to test is inside the outline, and does not cross any edge, it can be seen outside
    // the polygon.  Therefore test if a segment end is inside (testing only one end is enough).
    // Use an accuracy of "1" to say that we don't care if it's exactly on the edge or not.
    if (this.containsSingle(a, aPolygonIndex, 1)) {
      if (aNearest) {
        aNearest.x = a.x;
        aNearest.y = a.y;
      }

      return 0;
    }

    const iterator = this.CIterateSegmentsWithHoles(aPolygonIndex);

    let minDistance = iterator.Get().SquaredDistance(a);

    if (aNearest) {
      const p = iterator.Get().NearestPoint(a);
      aNearest.x = p.x;
      aNearest.y = p.y;
    }

    for (iterator.Advance(); iterator.valid() && minDistance > 0; iterator.Advance()) {
      const currentDistance = iterator.Get().SquaredDistance(a);

      if (currentDistance < minDistance) {
        if (aNearest) {
          const p = iterator.Get().NearestPoint(a);
          aNearest.x = p.x;
          aNearest.y = p.y;
        }

        minDistance = currentDistance;
      }
    }

    return minDistance;
  }

  /**
   * Compute the minimum distance squared between aPoint and all the polygons in the set.
   * Squared distances are used because they avoid the cost of doing square-roots.
   *
   * @param aPoint is the point whose distance to the set has to be measured.
   * @param aOutlineOnly is only for compatibility with SHAPE, if true it will fail
   * @param aNearest [out] an optional pointer to be filled in with the point on the
   *                 polyset which is closest to aPoint.
   * @return The minimum distance squared between aPoint and all the polygons in the set.
   *         If the point is contained in any of the polygons, the distance is zero.
   */
  SquaredDistanceNearest(aPoint: Vec2, aOutlineOnly: boolean, aNearest?: VECTOR2I): number {
    // wxASSERT_MSG( !aOutlineOnly, "Warning: SHAPE_POLY_SET::SquaredDistance does not yet support aOutlineOnly==true" );

    let currentDistance_sq: number;
    let minDistance_sq = ECOORD_MAX;
    const nearest: VECTOR2I = { x: 0, y: 0 };

    // Iterate through all the polygons and get the minimum distance.
    for (let polygonIdx = 0; polygonIdx < this.m_polys.length; polygonIdx++) {
      currentDistance_sq = this.SquaredDistanceToPolygon(
        aPoint,
        polygonIdx,
        aNearest ? nearest : undefined,
      );

      if (currentDistance_sq < minDistance_sq) {
        if (aNearest) {
          aNearest.x = nearest.x;
          aNearest.y = nearest.y;
        }

        minDistance_sq = currentDistance_sq;
      }
    }

    return minDistance_sq;
  }

  override SquaredDistance(aPoint: Vec2, aOutlineOnly = false): number {
    return this.SquaredDistanceNearest(aPoint, aOutlineOnly, undefined);
  }

  /**
   * Compute the minimum distance squared between aSegment and all the polygons in the set.
   */
  SquaredDistanceToSeg(aSegment: SEG, aNearest?: VECTOR2I): number {
    let currentDistance_sq: number;
    let minDistance_sq = ECOORD_MAX;
    const nearest: VECTOR2I = { x: 0, y: 0 };

    // Iterate through all the polygons and get the minimum distance.
    for (let polygonIdx = 0; polygonIdx < this.m_polys.length; polygonIdx++) {
      currentDistance_sq = this.SquaredDistanceToPolygon(
        aSegment,
        polygonIdx,
        aNearest ? nearest : undefined,
      );

      if (currentDistance_sq < minDistance_sq) {
        if (aNearest) {
          aNearest.x = nearest.x;
          aNearest.y = nearest.y;
        }

        minDistance_sq = currentDistance_sq;
      }
    }

    return minDistance_sq;
  }

  /**
   * Check whether the \a aGlobalIndex-th vertex belongs to a hole.
   *
   * @param aGlobalIdx is the index of the vertex.
   * @return true if the globally indexed \a aGlobalIdx-th vertex belongs to a hole.
   */
  IsVertexInHole(aGlobalIdx: number): boolean {
    const index = new VERTEX_INDEX();

    // Get the polygon and contour where the vertex is. If the vertex does not exist, return false
    if (!this.GetRelativeIndices(aGlobalIdx, index)) return false;

    // The contour is a hole if its index is greater than zero
    return index.m_contour > 0;
  }

  /**
   * Build a SHAPE_POLY_SET with holes built from a set of oriented paths: the outlines
   * are counter-clockwise, the holes clockwise (or the reverse; only the relative
   * orientation matters).
   */
  BuildPolysetFromOrientedPaths(aPaths: readonly SHAPE_LINE_CHAIN[], aEvenOdd = false): void {
    const clipper = new Clipper64();
    const tree = new PolyPath64();
    const paths: Paths64 = [];

    for (const path of aPaths) {
      const lc: Path64 = [];

      for (let i = 0; i < path.PointCount(); i++)
        lc.push({ x: path.CPoint(i).x, y: path.CPoint(i).y });

      paths.push(lc);
    }

    clipper.addSubject(paths);
    clipper.executeTree(ClipType.Union, aEvenOdd ? FillRule.EvenOdd : FillRule.NonZero, tree);

    const zValues: CLIPPER_Z_VALUE[] = [];
    const arcBuffer: SHAPE_ARC[] = [];

    this.importTree(tree, zValues, arcBuffer);
  }

  TransformToPolygon(aBuffer: SHAPE_POLY_SET, aError: number, aErrorLoc: ERROR_LOC): void {
    aBuffer.Append(this);
  }

  /**
   * Generate hatch lines for the polygon set.
   *
   * @param aSlopes is the list of slopes of the hatch lines.
   * @param aSpacing is the spacing between the hatch lines.
   * @param aLineLength is the length of the hatch lines (-1 for whole segment).
   */
  GenerateHatchLines(aSlopes: readonly number[], aSpacing: number, aLineLength: number): SEG[] {
    const hatchLines: SEG[] = [];

    if (this.OutlineCount() === 0 || this.TotalVertices() === 0) return hatchLines;

    // define range for hatch lines
    let min_x = this.CVertex(0).x;
    let max_x = this.CVertex(0).x;
    let min_y = this.CVertex(0).y;
    let max_y = this.CVertex(0).y;

    for (const v of this.CIterateWithHoles()) {
      if (v.x < min_x) min_x = v.x;

      if (v.x > max_x) max_x = v.x;

      if (v.y < min_y) min_y = v.y;

      if (v.y > max_y) max_y = v.y;
    }

    const sortEndsByDescendingX = (ref: VECTOR2I, tst: VECTOR2I): boolean => tst.x < ref.x;

    for (let slope of aSlopes) {
      let max_a: number;
      let min_a: number;

      if (slope > 0) {
        max_a = KiROUND(max_y - slope * min_x);
        min_a = KiROUND(min_y - slope * max_x);
      } else {
        max_a = KiROUND(max_y - slope * max_x);
        min_a = KiROUND(min_y - slope * min_x);
      }

      min_a = Math.trunc(min_a / aSpacing) * aSpacing;

      // loop through hatch lines
      const pointbuffer: VECTOR2I[] = [];

      for (let a = min_a; a < max_a; a += aSpacing) {
        pointbuffer.length = 0;

        // Iterate through all vertices
        for (const seg of this.CIterateSegmentsWithHoles()) {
          const pt: VECTOR2I = { x: 0, y: 0 };

          if (seg.IntersectsLine(slope, a, pt)) {
            // If the intersection point is outside the polygon, skip it
            if (pt.x < min_x || pt.x > max_x || pt.y < min_y || pt.y > max_y) continue;

            // Add the intersection point to the buffer
            pointbuffer.push({ x: KiROUND(pt.x), y: KiROUND(pt.y) });
          }
        }

        // sort points in order of descending x (if more than 2) to
        // ensure the starting point and the ending point of the same segment
        // are stored one just after the other.
        if (pointbuffer.length > 2) stdSort(pointbuffer, sortEndsByDescendingX);

        // creates lines or short segments inside the complex polygon
        for (let ip = 0; ip + 1 < pointbuffer.length; ip++) {
          const p1 = pointbuffer[ip]!;
          const p2 = pointbuffer[ip + 1]!;

          // Avoid duplicated intersections or segments
          if (samePoint(p1, p2)) continue;

          const candidate = new SEG(p1, p2);
          const mid = {
            x: Math.trunc((candidate.A.x + candidate.B.x) / 2),
            y: Math.trunc((candidate.A.y + candidate.B.y) / 2),
          };

          // Check if segment is inside the polygon by checking its middle point
          if (this.Contains(mid, -1, 1, true)) {
            let dx = p2.x - p1.x;

            // Push only one line for diagonal hatch or for small lines < twice
            // the line length; else push 2 small lines
            if (aLineLength === -1 || Math.abs(dx) < 2 * aLineLength) {
              hatchLines.push(candidate);
            } else {
              const dy = p2.y - p1.y;
              slope = dy / dx;

              if (dx > 0) dx = aLineLength;
              else dx = -aLineLength;

              const x1 = KiROUND(p1.x + dx);
              const x2 = KiROUND(p2.x - dx);
              const y1 = KiROUND(p1.y + dx * slope);
              const y2 = KiROUND(p2.y - dx * slope);

              hatchLines.push(new SEG(p1.x, p1.y, x1, y1));
              hatchLines.push(new SEG(p2.x, p2.y, x2, y2));
            }
          }
        }
      }
    }

    return hatchLines;
  }

  /**
   * Scale the polygon set by the given factors around the given centre.
   */
  Scale(aScaleFactorX: number, aScaleFactorY: number, aCenter: Vec2): void {
    for (const poly of this.m_polys) {
      for (const path of poly) {
        for (let i = 0; i < path.PointCount(); i++) {
          const pt = path.CPoint(i);
          const vecx = (pt.x - aCenter.x) * aScaleFactorX;
          const vecy = (pt.y - aCenter.y) * aScaleFactorY;
          path.SetPoint(i, { x: KiROUND(aCenter.x + vecx), y: KiROUND(aCenter.y + vecy) });
        }
      }
    }

    if (this.m_triangulationValid) this.CacheTriangulation();
  }

  protected cacheTriangulation(
    aPartition: boolean,
    aSimplify: boolean,
    aHintData: TRIANGULATED_POLYGON[] | null,
  ): void {
    if (this.m_triangulationValid && this.m_hashValid) {
      if (this.m_hash === this.checksum()) return;
    }

    // Invalidate, in case anything goes wrong below
    this.m_triangulationValid = false;
    this.m_hashValid = false;

    const triangulate = (
      polySet: SHAPE_POLY_SET,
      forOutline: number,
      dest: TRIANGULATED_POLYGON[],
      hintData: TRIANGULATED_POLYGON[] | null,
    ): boolean => {
      let triangulationValid = false;
      let pass = 0;
      let index = 0;

      if (hintData && hintData.length !== polySet.OutlineCount()) hintData = null;

      while (polySet.OutlineCount() > 0) {
        if (dest.length && dest[dest.length - 1]!.GetTriangleCount() === 0) dest.pop();

        dest.push(new TRIANGULATED_POLYGON(forOutline));
        const tess = new POLYGON_TRIANGULATION(dest[dest.length - 1]!);

        // If the tessellation fails, we re-fracture the polygon, which will
        // first simplify the system before fracturing and removing the holes
        // This may result in multiple, disjoint polygons.
        if (!tess.TesselatePolygon(polySet.Polygon(0)[0]!, hintData ? hintData[index]! : null)) {
          ++pass;

          if (pass === 1) {
            polySet.SimplifyOutlines(TRIANGULATESIMPLIFICATIONLEVEL);
          }
          // In Clipper2, there is only one type of simplification
          else {
            break;
          }

          triangulationValid = false;
          hintData = null;
          continue;
        }

        polySet.DeletePolygon(0);
        index++;
        triangulationValid = true;
      }

      return triangulationValid;
    };

    this.m_triangulatedPolys = [];

    if (aPartition) {
      for (let ii = 0; ii < this.OutlineCount(); ++ii) {
        // This partitions into regularly-sized grids (1cm in Pcbnew)
        const flattened = new SHAPE_POLY_SET(this.Outline(ii));

        for (let jj = 0; jj < this.HoleCount(ii); ++jj) flattened.AddHole(this.Hole(ii, jj));

        flattened.ClearArcs();

        if (flattened.HasHoles() || flattened.IsSelfIntersecting()) {
          // Fracture first to merge holes into the outline before splitting
          // self-touching outlines.  If splitSelfTouchingOutlines runs first,
          // the new split polygon gets no holes and its triangles span the
          // knockout areas.
          flattened.Fracture();
          flattened.splitSelfTouchingOutlines();
        } else if (aSimplify) flattened.Simplify();

        const partitions = partitionPolyIntoRegularCellGrid(flattened, 1e7);

        // This pushes the triangulation for all polys in partitions
        // to be referenced to the ii-th polygon
        if (!triangulate(partitions, ii, this.m_triangulatedPolys, aHintData)) {
          // wxLogTrace( TRIANGULATE_TRACE, "Failed to triangulate partitioned polygon %d", ii );
        } else {
          this.m_hash = this.checksum();
          this.m_hashValid = true;
          // Set valid flag only after everything has been updated
          this.m_triangulationValid = true;
        }
      }
    } else {
      const tmpSet = new SHAPE_POLY_SET(this);

      tmpSet.ClearArcs();
      tmpSet.Fracture();
      tmpSet.splitSelfTouchingOutlines();

      if (!triangulate(tmpSet, -1, this.m_triangulatedPolys, aHintData)) {
        // wxLogTrace( TRIANGULATE_TRACE, "Failed to triangulate polygon" );
      } else {
        this.m_hash = this.checksum();
        this.m_hashValid = true;
        // Set valid flag only after everything has been updated
        this.m_triangulationValid = true;
      }
    }
  }

  private checksum(): HASH_128 {
    // MMH3_HASH hash( 0x68AF835D ), fed int32 by int32: little-endian words
    let count = 1;

    for (const outline of this.m_polys) {
      count += 1;

      for (const lc of outline) count += 1 + 2 * lc.PointCount();
    }

    const words = new Int32Array(count);
    let n = 0;
    words[n++] = this.m_polys.length;

    for (const outline of this.m_polys) {
      words[n++] = outline.length;

      for (const lc of outline) {
        const pc = lc.PointCount();
        words[n++] = pc;

        for (let i = 0; i < pc; i++) {
          const pt = lc.CPoint(i);
          words[n++] = pt.x;
          words[n++] = pt.y;
        }
      }
    }

    return mmh3HashToString(littleEndianBytes(words), 0x68af835d);
  }

  /**
   * Check whether the point \a aP is inside the \a aSubpolyIndex-th polygon of the polyset. If
   * the points lies on an edge, the polygon is considered to contain it.
   */
  private containsSingle(
    aP: Vec2,
    aSubpolyIndex: number,
    aAccuracy: number,
    aUseBBoxCaches = false,
  ): boolean {
    // Check that the point is inside the outline
    if (this.m_polys[aSubpolyIndex]![0]!.PointInside(aP, aAccuracy)) {
      // Check that the point is not in any of the holes
      for (let holeIdx = 0; holeIdx < this.HoleCount(aSubpolyIndex); holeIdx++) {
        const hole = this.CHole(aSubpolyIndex, holeIdx);

        // If the point is inside a hole it is outside of the polygon.  Do not use aAccuracy
        // here as it's meaning would be inverted.
        if (hole.PointInside(aP, 1, aUseBBoxCaches)) return false;
      }

      return true;
    }

    return false;
  }
}

SHAPE_HOOKS.newPolySet = () => new SHAPE_POLY_SET();

// ---------------------------------------------------------------------------
// fractureSingleCacheFriendly / fractureSingleSlow (shape_poly_set.cpp:1210-1660)

/** `FractureEdge`: one directed edge of the working chain, `m_next` an index. */
interface FractureEdge {
  m_p1: VECTOR2I;
  m_p2: VECTOR2I;
  m_next: number;
}

/** `FractureEdge::matches`: does the horizontal line at `y` cross this edge? */
const fractureEdgeMatches = (e: FractureEdge, y: number): boolean =>
  (y >= e.m_p1.y || y >= e.m_p2.y) && (y <= e.m_p1.y || y <= e.m_p2.y);

/**
 * `processHole`: cut the hole open to the nearest edge to the left of its
 * leftmost point, along the horizontal through that point. Every edge before
 * the hole's own is a candidate: the holes are taken left to right, so all
 * of those are already part of the outline.
 */
function processHole(
  edges: FractureEdge[],
  provokingIndex: number,
  edgeIndex: number,
  bridgeIndex: number,
): FractureEdge | null {
  const edge = edges[edgeIndex]!;
  const x = edge.m_p1.x;
  const y = edge.m_p1.y;
  let min_dist = INT_MAX;
  let x_nearest = 0;

  let e_nearest: FractureEdge | null = null;

  // Since this function is run for all holes left to right, no need to
  // check for any edge beyond the provoking one because they will always be
  // further to the right, and unconnected to the outline anyway.
  for (let i = 0; i < provokingIndex; i++) {
    const e = edges[i]!;
    // Don't consider this edge if it can't be bridged to, or faces left.
    if (!fractureEdgeMatches(e, y)) continue;

    let x_intersect: number;

    if (e.m_p1.y === e.m_p2.y) {
      // horizontal edge
      x_intersect = Math.max(e.m_p1.x, e.m_p2.x);
    } else {
      x_intersect = e.m_p1.x + rescale(e.m_p2.x - e.m_p1.x, y - e.m_p1.y, e.m_p2.y - e.m_p1.y);
    }

    const dist = x - x_intersect;

    if (dist >= 0 && dist < min_dist) {
      min_dist = dist;
      x_nearest = x_intersect;
      e_nearest = e;
    }
  }

  if (e_nearest) {
    const outline2hole_index = bridgeIndex;
    const hole2outline_index = bridgeIndex + 1;
    const split_index = bridgeIndex + 2;
    // Make an edge between the split outline edge and the hole...
    edges[outline2hole_index] = { m_p1: { x: x_nearest, y }, m_p2: edge.m_p1, m_next: edgeIndex };
    // ...between the hole and the edge...
    edges[hole2outline_index] = { m_p1: edge.m_p1, m_p2: { x: x_nearest, y }, m_next: split_index };
    // ...and between the split outline edge and the rest.
    edges[split_index] = {
      m_p1: { x: x_nearest, y },
      m_p2: e_nearest.m_p2,
      m_next: e_nearest.m_next,
    };

    // Perform the actual outline edge split
    e_nearest.m_p2 = { x: x_nearest, y };
    e_nearest.m_next = outline2hole_index;

    let last = edge;
    for (; last.m_next !== edgeIndex; last = edges[last.m_next]!);
    last.m_next = hole2outline_index;
  }

  return e_nearest;
}

/**
 * `fractureSingleCacheFriendly`, which is what `m_EnableCacheFriendlyFracture`
 * (default true) selects: turn one outline-plus-holes polygon into a single
 * ring, joining each hole to the outline with a zero-width slit at the hole's
 * leftmost point (the FIRST of equal-x points), holes taken in order of that
 * x, then their top y.
 */
function fractureSingleCacheFriendly(paths: POLYGON): void {
  const edges: FractureEdge[] = [];
  let outline = true;

  if (paths.length === 1) return;

  let total_point_count = 0;

  for (const path of paths) total_point_count += path.PointCount();

  if (total_point_count > INT_MAX) {
    console.warn('Polygon has more points than int limit');
    return;
  }

  // Sort the paths by their lowest X bound before processing them.
  // This ensures the processing order for processEdge() is correct.
  interface PathInfo {
    path_or_provoking_index: number;
    leftmost: number;
    x: number;
    y_or_bridge: number;
  }

  const sorted_paths: PathInfo[] = [];
  const paths_count = paths.length;

  for (let path_index = 0; path_index < paths_count; path_index++) {
    const path = paths[path_index]!;
    const points = path.CPoints();
    const point_count = points.length;
    let x_min = INT_MAX;
    let y_min = INT_MAX;
    let leftmost = -1;

    for (let point_index = 0; point_index < point_count; point_index++) {
      const point = points[point_index]!;
      if (point.x < x_min) {
        x_min = point.x;
        leftmost = point_index;
      }
      if (point.y < y_min) y_min = point.y;
    }

    sorted_paths.push({
      path_or_provoking_index: path_index,
      leftmost,
      x: x_min,
      y_or_bridge: y_min,
    });
  }

  // `std::sort( begin + 1, end )`: the outline stays first.
  const holesSorted = sorted_paths.slice(1);
  stdSort(holesSorted, (a, b) => {
    if (a.x === b.x) return a.y_or_bridge < b.y_or_bridge;
    return a.x < b.x;
  });
  sorted_paths.splice(1, holesSorted.length, ...holesSorted);

  let edge_index = 0;

  for (const path_info of sorted_paths) {
    const path = paths[path_info.path_or_provoking_index]!;
    const points = path.CPoints();
    const point_count = points.length;

    // Index of the provoking (first) edge for this path
    const provoking_edge = edge_index;

    for (let i = 0; i < point_count - 1; i++) {
      edges.push({ m_p1: points[i]!, m_p2: points[i + 1]!, m_next: edge_index + 1 });
      edge_index++;
    }

    // Create last edge looping back to the provoking one.
    edges.push({ m_p1: points[point_count - 1]!, m_p2: points[0]!, m_next: provoking_edge });
    edge_index++;

    if (!outline) {
      // Repurpose the path sorting data structure to schedule the leftmost edge
      // for merging to the outline, which will in turn merge the rest of the path.
      path_info.path_or_provoking_index = provoking_edge;
      path_info.y_or_bridge = edge_index;

      // Reserve 3 additional edges to bridge with the outline.
      edge_index += 3;
      edges.length = edge_index;
    }

    outline = false; // first path is always the outline
  }

  for (let k = 1; k < sorted_paths.length; k++) {
    const it = sorted_paths[k]!;
    const edge = processHole(
      edges,
      it.path_or_provoking_index,
      it.path_or_provoking_index + it.leftmost,
      it.y_or_bridge,
    );

    // If we can't handle the hole, the zone is broken (maybe)
    if (!edge) {
      console.warn('Broken polygon, dropping path');

      return;
    }
  }

  paths.length = 1;
  const newPath = paths[0]!;

  newPath.Clear();
  newPath.SetClosed(true);

  // Root edge is always at index 0
  let e = edges[0]!;

  for (; e.m_next !== 0; e = edges[e.m_next]!) newPath.Append(e.m_p1);

  newPath.Append(e.m_p1);
}

/** `FractureEdgeSlow`: one directed edge of the working chain. */
interface FractureEdgeSlow {
  m_connected: boolean;
  m_p1: VECTOR2I;
  m_p2: VECTOR2I;
  m_next: FractureEdgeSlow | null;
}

const fractureEdgeSlow = (connected: boolean, p1: VECTOR2I, p2: VECTOR2I): FractureEdgeSlow => ({
  m_connected: connected,
  m_p1: p1,
  m_p2: p2,
  m_next: null,
});

/** `FractureEdgeSlow::matches`. */
const fractureEdgeSlowMatches = (e: FractureEdgeSlow, y: number): boolean =>
  (y >= e.m_p1.y || y >= e.m_p2.y) && (y <= e.m_p1.y || y <= e.m_p2.y);

/**
 * `processEdge`: cut `edge`'s hole open to the nearest connected edge to its
 * left, along the horizontal at its first point, and splice the hole into
 * the chain. Returns how many edges became connected, or 0 if the polygon is
 * broken.
 */
function processEdge(edges: FractureEdgeSlow[], edge: FractureEdgeSlow): number {
  const x = edge.m_p1.x;
  const y = edge.m_p1.y;
  let min_dist = INT_MAX;
  let x_nearest = 0;

  let e_nearest: FractureEdgeSlow | null = null;

  for (const e of edges) {
    if (!fractureEdgeSlowMatches(e, y)) continue;

    let x_intersect: number;

    if (e.m_p1.y === e.m_p2.y) {
      // horizontal edge
      x_intersect = Math.max(e.m_p1.x, e.m_p2.x);
    } else {
      x_intersect = e.m_p1.x + rescale(e.m_p2.x - e.m_p1.x, y - e.m_p1.y, e.m_p2.y - e.m_p1.y);
    }

    const dist = x - x_intersect;

    if (dist >= 0 && dist < min_dist && e.m_connected) {
      min_dist = dist;
      x_nearest = x_intersect;
      e_nearest = e;
    }
  }

  if (e_nearest?.m_connected) {
    let count = 0;

    const lead1 = fractureEdgeSlow(true, { x: x_nearest, y }, { x, y });
    const lead2 = fractureEdgeSlow(true, { x, y }, { x: x_nearest, y });
    const split_2 = fractureEdgeSlow(true, { x: x_nearest, y }, e_nearest.m_p2);

    edges.push(split_2);
    edges.push(lead1);
    edges.push(lead2);

    const link = e_nearest.m_next;

    e_nearest.m_p2 = { x: x_nearest, y };
    e_nearest.m_next = lead1;
    lead1.m_next = edge;

    let last = edge;
    for (; last.m_next !== edge; last = last.m_next!) {
      last.m_connected = true;
      count++;
    }

    last.m_connected = true;
    last.m_next = lead2;
    lead2.m_next = split_2;
    split_2.m_next = link;

    return count + 1;
  }

  return 0;
}

/** `fractureSingleSlow`: the pre-cache-friendly fracture, holes taken leftmost first. */
function fractureSingleSlow(paths: POLYGON): void {
  const edges: FractureEdgeSlow[] = [];
  const border_edges: FractureEdgeSlow[] = [];
  let root: FractureEdgeSlow | null = null;

  let first = true;

  if (paths.length === 1) return;

  let num_unconnected = 0;

  for (const path of paths) {
    const points = path.CPoints();
    const pointCount = points.length;

    let prev: FractureEdgeSlow | null = null;
    let first_edge: FractureEdgeSlow | null = null;

    let x_min = INT_MAX;

    for (let i = 0; i < pointCount; i++) {
      if (points[i]!.x < x_min) x_min = points[i]!.x;

      // Do not use path.CPoint() here; open-coding it using the local variables "points"
      // and "pointCount" gives a non-trivial performance boost to zone fill times.
      const fe = fractureEdgeSlow(first, points[i]!, points[i + 1 === pointCount ? 0 : i + 1]!);

      if (!root) root = fe;

      if (!first_edge) first_edge = fe;

      if (prev) prev.m_next = fe;

      if (i === pointCount - 1) fe.m_next = first_edge;

      prev = fe;
      edges.push(fe);

      if (!first) {
        if (fe.m_p1.x === x_min) border_edges.push(fe);
      }

      if (!fe.m_connected) num_unconnected++;
    }

    first = false; // first path is always the outline
  }

  // keep connecting holes to the main outline, until there's no holes left...
  while (num_unconnected > 0) {
    let x_min = INT_MAX;

    let smallestX: FractureEdgeSlow | null = null;

    // find the left-most hole edge and merge with the outline
    for (const border_edge of border_edges) {
      const xt = border_edge.m_p1.x;

      if (xt <= x_min && !border_edge.m_connected) {
        x_min = xt;
        smallestX = border_edge;
      }
    }

    const num_processed = processEdge(edges, smallestX!);

    // If we can't handle the edge, the zone is broken (maybe)
    if (!num_processed) {
      console.warn('Broken polygon, dropping path');

      return;
    }

    num_unconnected -= num_processed;
  }

  paths.length = 0;
  const newPath = new SHAPE_LINE_CHAIN();

  newPath.SetClosed(true);

  let e: FractureEdgeSlow;

  for (e = root!; e.m_next !== root; e = e.m_next!) newPath.Append(e.m_p1);

  newPath.Append(e.m_p1);

  paths.push(newPath);
}

/** `Clipper2Lib::Area( path )`. */
function clipperArea(path: Path64): number {
  const cnt = path.length;
  if (cnt < 3) return 0.0;
  let a = 0.0;
  let prev = path[cnt - 1]!;
  for (const pt of path) {
    a += (prev.y + pt.y) * (prev.x - pt.x);
    prev = pt;
  }
  return a * 0.5;
}

/**
 * `partitionPolyIntoRegularCellGrid` (shape_poly_set.cpp): cut a polygon into a
 * checkerboard of cells so each cell triangulates independently.
 */
function partitionPolyIntoRegularCellGrid(aPoly: SHAPE_POLY_SET, aSize: number): SHAPE_POLY_SET {
  const bb = aPoly.BBox();

  const w = bb.GetWidth();
  const h = bb.GetHeight();

  if (w === 0.0 || h === 0.0) return aPoly;

  let n_cells_x: number;
  let n_cells_y: number;

  if (w > h) {
    n_cells_x = Math.trunc(w / aSize);
    n_cells_y = Math.floor((h / w) * n_cells_x) + 1;
  } else {
    n_cells_y = Math.trunc(h / aSize);
    n_cells_x = Math.floor((w / h) * n_cells_y) + 1;
  }

  const ps1 = new SHAPE_POLY_SET(aPoly);
  const ps2 = new SHAPE_POLY_SET(aPoly);
  const maskSetOdd = new SHAPE_POLY_SET();
  const maskSetEven = new SHAPE_POLY_SET();

  for (let yy = 0; yy < n_cells_y; yy++) {
    for (let xx = 0; xx < n_cells_x; xx++) {
      // `p.x = bb.GetX() + w * xx / n_cells_x`: double, narrowed to int
      const p = {
        x: Math.trunc(bb.GetX() + (w * xx) / n_cells_x),
        y: Math.trunc(bb.GetY() + (h * yy) / n_cells_y),
      };

      const p2 = {
        x: Math.trunc(bb.GetX() + (w * (xx + 1)) / n_cells_x),
        y: Math.trunc(bb.GetY() + (h * (yy + 1)) / n_cells_y),
      };

      const mask = new SHAPE_LINE_CHAIN();
      mask.Append({ x: p.x, y: p.y });
      mask.Append({ x: p2.x, y: p.y });
      mask.Append({ x: p2.x, y: p2.y });
      mask.Append({ x: p.x, y: p2.y });
      mask.SetClosed(true);

      if ((xx ^ yy) & 1) maskSetOdd.AddOutline(mask);
      else maskSetEven.AddOutline(mask);
    }
  }

  ps1.BooleanIntersection(maskSetOdd);
  ps2.BooleanIntersection(maskSetEven);
  ps1.Fracture();
  ps2.Fracture();

  for (let i = 0; i < ps2.OutlineCount(); i++) ps1.AddOutline(ps2.COutline(i));

  if (ps1.OutlineCount()) return ps1;
  return aPoly;
}

// ---------------------------------------------------------------------------
// The SHAPE_POLY_SET forms of convert_basic_shapes_to_polygon.cpp. The ring
// computations are the oracle-checked ones; these append them the way the
// C++ appends - `NewOutline()` then `Append( x, y )` per point, so a closing
// duplicate survives exactly as it does upstream.

function appendRingAsOutline(aBuffer: SHAPE_POLY_SET, ring: readonly Vec2[]): void {
  aBuffer.NewOutline();
  for (const p of ring) aBuffer.Append(p.x, p.y);
}

/**
 * `TransformCircleToPolygon( SHAPE_POLY_SET& aBuffer, ... )`.
 */
export function TransformCircleToPolygon(
  aBuffer: SHAPE_POLY_SET,
  aCenter: Vec2,
  aRadius: number,
  aError: number,
  aErrorLoc: ERROR_LOC,
  aMinSegCount = 0,
): void {
  appendRingAsOutline(
    aBuffer,
    transformCircleToRing(aCenter, aRadius, aError, aErrorLoc, aMinSegCount),
  );
}

/**
 * `TransformOvalToPolygon( SHAPE_POLY_SET& aBuffer, ... )`.
 */
export function TransformOvalToPolygon(
  aBuffer: SHAPE_POLY_SET,
  aStart: Vec2,
  aEnd: Vec2,
  aWidth: number,
  aError: number,
  aErrorLoc: ERROR_LOC,
  aMinSegCount = 0,
): void {
  for (const poly of transformOvalToRings(aStart, aEnd, aWidth, aError, aErrorLoc, aMinSegCount)) {
    poly.forEach((ring, i) => {
      const c = new SHAPE_LINE_CHAIN();
      for (const p of ring) c.Append(p);
      c.SetClosed(true);
      if (i === 0) aBuffer.AddOutline(c);
      else aBuffer.AddHole(c);
    });
  }
}

/**
 * `TransformTrapezoidToPolygon( SHAPE_POLY_SET& aBuffer, ... )`.
 */
export function TransformTrapezoidToPolygon(
  aBuffer: SHAPE_POLY_SET,
  aPosition: Vec2,
  aSize: Vec2,
  aRotation: EDA_ANGLE,
  aDeltaX: number,
  aDeltaY: number,
  aInflate: number,
  aError: number,
  aErrorLoc: ERROR_LOC,
): void {
  appendRingAsOutline(
    aBuffer,
    transformTrapezoidToRing(
      aPosition,
      aSize,
      aRotation,
      aDeltaX,
      aDeltaY,
      aInflate,
      aError,
      aErrorLoc,
    ),
  );
}

/**
 * `TransformRoundChamferedRectToPolygon( SHAPE_POLY_SET& aBuffer, ... )`.
 */
export function TransformRoundChamferedRectToPolygon(
  aBuffer: SHAPE_POLY_SET,
  aPosition: Vec2,
  aSize: Vec2,
  aRotation: EDA_ANGLE,
  aCornerRadius: number,
  aChamferRatio: number,
  aChamferCorners: number,
  aInflate: number,
  aError: number,
  aErrorLoc: ERROR_LOC,
): void {
  appendRingAsOutline(
    aBuffer,
    transformRoundChamferedRectToRing(
      aPosition,
      aSize,
      aRotation,
      aCornerRadius,
      aChamferRatio,
      aChamferCorners,
      aInflate,
      aError,
      aErrorLoc,
    ),
  );
}

/**
 * `TransformRingToPolygon( SHAPE_POLY_SET& aBuffer, ... )`.
 */
export function TransformRingToPolygon(
  aBuffer: SHAPE_POLY_SET,
  aCentre: Vec2,
  aRadius: number,
  aWidth: number,
  aError: number,
  aErrorLoc: ERROR_LOC,
): void {
  const rings = transformRingToRings(aCentre, aRadius, aWidth, aError, aErrorLoc);
  rings.forEach((ring, i) => {
    const c = new SHAPE_LINE_CHAIN();
    for (const p of ring) c.Append(p);
    c.SetClosed(true);
    if (i === 0) aBuffer.AddOutline(c);
    else aBuffer.AddHole(c);
  });
}

/**
 * `TransformArcToPolygon( SHAPE_POLY_SET& aBuffer, ... )`.
 */
export function TransformArcToPolygon(
  aBuffer: SHAPE_POLY_SET,
  aStart: Vec2,
  aMid: Vec2,
  aEnd: Vec2,
  aWidth: number,
  aError: number,
  aErrorLoc: ERROR_LOC,
): void {
  // `polyshape.NewOutline()` then `outline.Append( pt )` per point: the inner edge ends where
  // the start cap began, and that last point stays (Append only refuses a repeat of the LAST
  // point), so the outline carries a closing duplicate exactly as the C++ one does.
  for (const poly of transformArcToRings(aStart, aMid, aEnd, aWidth, aError, aErrorLoc)) {
    const polyshape = new SHAPE_POLY_SET();
    poly.forEach((ring, i) => {
      if (i === 0) {
        polyshape.NewOutline();
        for (const p of ring) polyshape.Append(p.x, p.y);
      } else {
        const c = new SHAPE_LINE_CHAIN();
        for (const p of ring) c.Append(p);
        c.SetClosed(true);
        polyshape.AddHole(c);
      }
    });
    aBuffer.Append(polyshape);
  }
}

export { circleToEndSegmentDeltaRadius };

/** The platform is little-endian (every browser and node we run on); the words' bytes as the hash reads them. */
const IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function littleEndianBytes(aWords: Int32Array): Uint8Array {
  if (IS_LITTLE_ENDIAN) return new Uint8Array(aWords.buffer, aWords.byteOffset, aWords.byteLength);

  const bytes = new Uint8Array(aWords.length * 4);
  const view = new DataView(bytes.buffer);

  for (let i = 0; i < aWords.length; i++) view.setInt32(i * 4, aWords[i]!, true);

  return bytes;
}
