// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `POLYGON_TRIANGULATION` (`geometry/polygon_triangulation.h`): the ear-cut
 * tessellation of one fractured outline into a `TRIANGULATED_POLYGON`. Based
 * on Mapbox's earcut, with KiCad's subdivision, null-triangle removal and
 * polygon-splitting fallbacks.
 *
 * `TRIANGULATESIMPLIFICATIONLEVEL` and `TRIANGULATEMINIMUMAREA` are the
 * ADVANCED_CFG defaults (advanced_config.cpp:301-302), data.
 */

import type { Vec2, VECTOR2I } from '../math/vector2.js';
import type { SHAPE_LINE_CHAIN } from './shape_line_chain.js';
import type { TRIANGULATED_POLYGON } from './shape_poly_set.js';
import { Vertex, VertexSet } from './vertex_set.js';

/** `ADVANCED_CFG::m_TriangulateSimplificationLevel`. */
export const TRIANGULATESIMPLIFICATIONLEVEL = 50;
/** `ADVANCED_CFG::m_TriangulateMinimumArea`. */
export const TRIANGULATEMINIMUMAREA = 1000;

export class POLYGON_TRIANGULATION extends VertexSet {
  private m_vertices_original_size: number;
  private m_result: TRIANGULATED_POLYGON;

  constructor(aResult: TRIANGULATED_POLYGON) {
    super(TRIANGULATESIMPLIFICATIONLEVEL);
    this.m_vertices_original_size = 0;
    this.m_result = aResult;
  }

  TesselatePolygon(aPoly: SHAPE_LINE_CHAIN, aHintData: TRIANGULATED_POLYGON | null): boolean {
    const bbox = aPoly.BBox();
    this.setBoundingBox({
      x: bbox.GetX(),
      y: bbox.GetY(),
      width: bbox.GetWidth(),
      height: bbox.GetHeight(),
    });
    this.m_result.Clear();

    if (!bbox.GetWidth() || !bbox.GetHeight()) return true;

    /// Place the polygon Vertices into a circular linked list
    /// and check for lists that have only 0, 1 or 2 elements and
    /// therefore cannot be polygons
    const firstVertex = this.createList(aPoly.CPoints());

    for (const pt of aPoly.CPoints()) this.m_result.AddVertex(pt);

    if (!firstVertex || firstVertex.prev === firstVertex.next) return true;

    this.m_vertices_original_size = this.vertices.length;

    firstVertex.updateList();

    if (aHintData && aHintData.Vertices().length === this.vertices.length) {
      this.m_result.SetTriangles(aHintData.Triangles());
      return true;
    } else {
      const retval = this.earcutList(firstVertex);

      this.vertices.length = 0;
      return retval;
    }
  }

  /**
   * Simplify the line chain by removing points that are too close to each other.
   */
  private simplifyList(aStart: Vertex | null): Vertex | null {
    if (!aStart || aStart.next === aStart.prev) return aStart;

    let p: Vertex | null = aStart;
    let next: Vertex | null = p.next;
    let retval = aStart;
    let count = 0;

    let sq_dist = TRIANGULATESIMPLIFICATIONLEVEL;
    sq_dist *= sq_dist;

    do {
      const dx = next!.x - p!.x;
      const dy = next!.y - p!.y;

      if (dx * dx + dy * dy < sq_dist) {
        if (next === aStart) {
          retval = p!;
          aStart.remove();
          count++;
          break;
        }

        next = next!.next;
        p!.next.remove();
        count++;
        retval = p!;
      } else {
        p = next;
        next = next!.next;
      }
    } while (p !== aStart && next && p);

    if (count) return retval;

    return null;
  }

  /**
   * Iterate through the list to remove NULL triangles if they exist.
   *
   * This should only be called as a last resort when tesselation fails
   * as the NULL triangles are inserted as Steiner points to improve the
   * triangulation regularity of polygons
   */
  private removeNullTriangles(aStart: Vertex): Vertex | null {
    let retval: Vertex | null = null;
    let count = 0;

    const simplified = this.simplifyList(aStart);

    if (simplified) {
      retval = simplified;
      aStart = simplified;
    }

    let p = aStart.next;

    while (p !== aStart && p.next && p.prev) {
      // We make a dummy triangle that is actually part of the existing line segment
      // and measure its area.  This will not be exactly zero due to floating point
      // errors.  We then look for areas that are less than 4 times the area of the
      // dummy triangle.  For small triangles, this is a small number
      const tmp = new Vertex(0, 0.5 * (p.prev.x + p.next.x), 0.5 * (p.prev.y + p.next.y), this);
      const null_area = 4.0 * Math.abs(this.area(p.prev, tmp, p.next));

      if (p.equals(p.next) || Math.abs(this.area(p.prev, p, p.next)) <= null_area) {
        // This is a spike, remove it, leaving only one point
        if (p.next.equals(p.prev)) p.next.remove();

        p = p.prev;
        p.next.remove();
        retval = p;
        ++count;

        if (p === p.next) break;

        // aStart was removed above, so we need to reset it
        if (!aStart.next) aStart = p.prev;

        continue;
      }

      p = p.next;
    }

    /// We've removed all possible triangles
    if (!p.next || p.next === p || p.next === p.prev) return p;

    // We needed an end point above that wouldn't be removed, so
    // here we do the final check for this as a Steiner point
    const tmp = new Vertex(0, 0.5 * (p.prev.x + p.next.x), 0.5 * (p.prev.y + p.next.y), this);
    const null_area = 4.0 * Math.abs(this.area(p.prev, tmp, p.next));

    if (Math.abs(this.area(p.prev, p, p.next)) <= null_area) {
      retval = p.next;
      p.remove();
      ++count;
    }

    return retval;
  }

  /**
   * Walk through a circular linked list starting at \a aPoint.
   *
   * For each point, test to see if the adjacent vertices are the "ear" of a triangle.
   * If so, remove the ear and add it to the triangulated polygon.
   */
  private earcutList(aPoint: Vertex | null, pass = 0): boolean {
    if (!aPoint) return true;

    let stop = aPoint;
    let prev: Vertex;
    let next: Vertex;
    let internal_pass = 1;

    while (aPoint.prev !== aPoint.next) {
      prev = aPoint.prev;
      next = aPoint.next;

      if (aPoint.isEar()) {
        // Tiny ears cannot be seen on the screen
        if (!this.isTooSmall(aPoint)) {
          this.m_result.AddTriangle(prev.i, aPoint.i, next.i);
        }

        aPoint.remove();

        // Skip one vertex as the triangle will account for the prev node
        aPoint = next.next;
        stop = next.next;

        continue;
      }

      const nextNext = next.next;

      if (
        !prev.equals(nextNext) &&
        this.intersects(prev, aPoint, next, nextNext) &&
        this.locallyInside(prev, nextNext) &&
        this.locallyInside(nextNext, prev)
      ) {
        this.m_result.AddTriangle(prev.i, aPoint.i, nextNext.i);

        // remove two nodes involved
        next.remove();
        aPoint.remove();

        aPoint = nextNext;
        stop = nextNext;

        continue;
      }

      aPoint = next;

      /*
       * We've searched all the vertices without finding an ear.  This should mean
       * that there are self-intersecting vertices and the polygon contains points
       * that are outside the boundary.  We attempt to fix this by removing points that
       * are colinear or by subdividing the polygon.
       */
      if (aPoint === stop && aPoint.prev !== aPoint.next) {
        let newPoint: Vertex | null = null;

        // Removing null triangles will remove steiner points as well as colinear points
        // that are three in a row.  Because our next step is to subdivide the polygon,
        // we need to allow it to add the subdivided points first.  This is why we only
        // run the RemoveNullTriangles function after the first pass.
        // `internal_pass == 2 && ( newPoint = RemoveNullTriangles( aPoint ) )`
        newPoint = internal_pass === 2 ? this.removeNullTriangles(aPoint) : null;

        if (newPoint) {
          // There are no remaining triangles in the list
          if (newPoint.next === newPoint.prev) break;

          aPoint = newPoint;
          stop = newPoint;
          continue;
        }

        ++internal_pass;

        // This will subdivide the polygon 2 times.  The first pass will add enough points
        // such that each edge is less than the average edge length.  If this doesn't work
        // The next pass will remove the null triangles (above) and subdivide the polygon
        // again, this time adding one point to each long edge (and thereby changing the locations)
        if (internal_pass < 4) {
          this.subdividePolygon(aPoint, internal_pass);
          continue;
        }

        // If we don't have any NULL triangles left, cut the polygon in two and try again
        if (!this.splitPolygon(aPoint)) return false;

        break;
      }
    }

    // Check to see if we are left with only three points in the polygon
    if (aPoint.next && aPoint.prev === aPoint.next.next) {
      // Three concave points will never be able to be triangulated because they were
      // created by an intersecting polygon, so just drop them.
      if (this.area(aPoint.prev, aPoint, aPoint.next) >= 0) return true;
    }

    /*
     * At this point, our polygon should be fully tessellated.
     */
    if (aPoint.prev !== aPoint.next) return Math.abs(aPoint.area()) > TRIANGULATEMINIMUMAREA;

    return true;
  }

  /**
   * Check whether a triangle is too small to matter.
   */
  private isTooSmall(aPoint: Vertex): boolean {
    const min_area = TRIANGULATEMINIMUMAREA;
    const prev_sq_len =
      (aPoint.prev.x - aPoint.x) * (aPoint.prev.x - aPoint.x) +
      (aPoint.prev.y - aPoint.y) * (aPoint.prev.y - aPoint.y);
    const next_sq_len =
      (aPoint.next.x - aPoint.x) * (aPoint.next.x - aPoint.x) +
      (aPoint.next.y - aPoint.y) * (aPoint.next.y - aPoint.y);
    const opp_sq_len =
      (aPoint.next.x - aPoint.prev.x) * (aPoint.next.x - aPoint.prev.x) +
      (aPoint.next.y - aPoint.prev.y) * (aPoint.next.y - aPoint.prev.y);

    return prev_sq_len < min_area || next_sq_len < min_area || opp_sq_len < min_area;
  }

  /**
   * Inserts a new vertex halfway between each existing pair of vertices.
   */
  private subdividePolygon(aStart: Vertex, pass = 0): void {
    let p = aStart;

    // std::set< std::pair< VERTEX*, double >, VertexComparator >: descending
    // by length; equal lengths compare equal and the later insert is DROPPED
    // by the set (std::set keeps the first of equivalent keys).
    const longest: { first: Vertex; second: number }[] = [];
    let avg = 0.0;

    do {
      const len = (p.x - p.next.x) * (p.x - p.next.x) + (p.y - p.next.y) * (p.y - p.next.y);

      if (!longest.some((e) => e.second === len)) longest.push({ first: p, second: len });

      avg += len;
      p = p.next;
    } while (p !== aStart);

    longest.sort((a, b) => b.second - a.second);

    avg /= longest.length;

    for (const it of longest) {
      if (!(it.second > avg)) break;

      const a = it.first;
      const b = a.next;
      let last = a;

      // We adjust the number of divisions based on the pass in order to progressively
      // subdivide the polygon when triangulation fails
      const divisions = Math.trunc(avg / it.second + 2 + pass);
      const step = 1.0 / divisions;

      for (let i = 1; i < divisions; i++) {
        const x = a.x * (1.0 - step * i) + b.x * (step * i);
        const y = a.y * (1.0 - step * i) + b.y * (step * i);
        // VECTOR2I( x, y ): double -> int truncates
        last = this.insertTriVertex({ x: Math.trunc(x), y: Math.trunc(y) }, last);
      }
    }

    // update z-order of the vertices
    aStart.updateList();
  }

  /**
   * If we cannot find an ear to slice in the current polygon list, we
   * use this to split the polygon into two separate lists and slice them each
   * independently.  This is assured to generate at least one new ear if the
   * split is successful
   */
  private splitPolygon(start: Vertex): boolean {
    let origPoly = start;

    // If we have fewer than 4 points, we cannot split the polygon
    if (!start || !start.next || start.next === start.prev || start.next.next === start.prev) {
      return true;
    }

    // Our first attempts to split the polygon will be at overlapping points.
    // These are natural split points and we only need to switch the loop directions
    // to generate two new loops.  Since they are overlapping, we are do not
    // need to create a new segment to disconnect the two loops.
    do {
      const overlapPoints: Vertex[] = [];
      let z_pt = origPoly;

      while (z_pt.prevZ && z_pt.prevZ.equals(origPoly)) z_pt = z_pt.prevZ;

      overlapPoints.push(z_pt);

      while (z_pt.nextZ && z_pt.nextZ.equals(origPoly)) {
        z_pt = z_pt.nextZ;
        overlapPoints.push(z_pt);
      }

      if (
        overlapPoints.length !== 2 ||
        overlapPoints[0]!.next === overlapPoints[1] ||
        overlapPoints[0]!.prev === overlapPoints[1]
      ) {
        origPoly = origPoly.next;
        continue;
      }

      if (
        overlapPoints[0]!.area(overlapPoints[1]!) < 0 ||
        overlapPoints[1]!.area(overlapPoints[0]!) < 0
      ) {
        origPoly = origPoly.next;
        continue;
      }

      const t = overlapPoints[0]!.next;
      overlapPoints[0]!.next = overlapPoints[1]!.next;
      overlapPoints[1]!.next = t;
      overlapPoints[0]!.next.prev = overlapPoints[0]!;
      overlapPoints[1]!.next.prev = overlapPoints[1]!;

      overlapPoints[0]!.updateList();
      overlapPoints[1]!.updateList();

      const retval = this.earcutList(overlapPoints[0]!) && this.earcutList(overlapPoints[1]!);

      return retval;
    } while (origPoly !== start);

    // If we've made it through the split algorithm and we still haven't found a
    // set of overlapping points, we need to create a new segment to split the polygon
    // into two separate polygons.  We do this by finding the two vertices that form
    // a valid line (does not cross the existing polygon)
    do {
      let marker = origPoly.next.next;

      while (marker !== origPoly.prev) {
        // Find a diagonal line that is wholly enclosed by the polygon interior
        if (origPoly.next && origPoly.i !== marker.i && this.goodSplit(origPoly, marker)) {
          const newPoly = origPoly.split(marker);

          origPoly.updateList();
          newPoly.updateList();

          const retval = this.earcutList(origPoly) && this.earcutList(newPoly);

          return retval;
        }

        marker = marker.next;
      }

      origPoly = origPoly.next;
    } while (origPoly !== start);

    return false;
  }

  /**
   * Check if a segment joining two vertices lies fully inside the polygon.
   * To do this, we first ensure that the line isn't along the polygon edge.
   * Next, we know that if the line doesn't intersect the polygon, then it is
   * either fully inside or fully outside the polygon.  Next, we ensure that
   * the proposed split is inside the local area of the polygon at both ends
   * and the midpoint
   */
  private goodSplit(a: Vertex, b: Vertex): boolean {
    const a_on_edge = (a.nextZ && a.equals(a.nextZ)) || (a.prevZ && a.equals(a.prevZ));
    const b_on_edge = (b.nextZ && b.equals(b.nextZ)) || (b.prevZ && b.equals(b.prevZ));
    const no_intersect = a.next.i !== b.i && a.prev.i !== b.i && !this.intersectsPolygon(a, b);
    const local_split =
      this.locallyInside(a, b) && this.locallyInside(b, a) && this.middleInside(a, b);
    const same_dir = this.area(a.prev, a, b.prev) !== 0.0 || this.area(a, b.prev, b) !== 0.0;
    const has_len =
      a.equals(b) && this.area(a.prev, a, a.next) > 0 && this.area(b.prev, b, b.next) > 0;
    const pos_area = a.area(b) > 0 && b.area(a) > 0;

    return (
      no_intersect && local_split && (same_dir || has_len) && !a_on_edge && !b_on_edge && pos_area
    );
  }

  private sign(aVal: number): number {
    return (aVal > 0 ? 1 : 0) - (aVal < 0 ? 1 : 0);
  }

  /**
   * If p, q, and r are collinear and r lies between p and q, then return true
   */
  private overlapping(p: Vertex, q: Vertex, r: Vertex): boolean {
    return (
      q.x <= Math.max(p.x, r.x) &&
      q.x >= Math.min(p.x, r.x) &&
      q.y <= Math.max(p.y, r.y) &&
      q.y >= Math.min(p.y, r.y)
    );
  }

  /**
   * Check for intersection between two segments, end points included.
   */
  private intersects(p1: Vertex, q1: Vertex, p2: Vertex, q2: Vertex): boolean {
    const sign1 = this.sign(this.area(p1, q1, p2));
    const sign2 = this.sign(this.area(p1, q1, q2));
    const sign3 = this.sign(this.area(p2, q2, p1));
    const sign4 = this.sign(this.area(p2, q2, q1));

    if (sign1 !== sign2 && sign3 !== sign4) return true;

    if (sign1 === 0 && this.overlapping(p1, p2, q1)) return true;

    if (sign2 === 0 && this.overlapping(p1, q2, q1)) return true;

    if (sign3 === 0 && this.overlapping(p2, p1, q2)) return true;

    if (sign4 === 0 && this.overlapping(p2, q1, q2)) return true;

    return false;
  }

  /**
   * Check whether the segment from vertex a -> vertex b crosses any of the segments
   * of the polygon of which vertex a is a member.
   */
  private intersectsPolygon(a: Vertex, b: Vertex): boolean {
    for (let ii = 0; ii < this.m_vertices_original_size; ii++) {
      const p = this.vertices[ii]!;
      const q = this.vertices[(ii + 1) % this.m_vertices_original_size]!;

      if (p.i === a.i || p.i === b.i || q.i === a.i || q.i === b.i) continue;

      if (this.intersects(p, q, a, b)) return true;
    }

    return false;
  }

  /**
   * Create an entry in the vertices lookup and optionally inserts the newly created vertex
   * into an existing linked list.
   */
  private insertTriVertex(pt: VECTOR2I, last: Vertex): Vertex {
    this.m_result.AddVertex(pt);
    return this.insertVertex(this.m_result.GetVertexCount() - 1, pt, last);
  }
}

export type { Vec2 };
