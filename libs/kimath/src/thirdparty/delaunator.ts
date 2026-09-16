// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `thirdparty/delaunator/delaunator.hpp` + `.cpp`: the Delaunay triangulator
 * the ratsnest is built on (RN_NET::TRIANGULATOR_STATE). This is KiCad's copy
 * of delaunator-cpp, not the npm package: its `clockwise` guard, its
 * `Point::equal` span test and its introsort of the ids are what decide the
 * triangle order, and the ratsnest edges come out in that order.
 */
import { stdSort } from '../clipper2/clipper.core.js';

export const INVALID_INDEX = Number.MAX_SAFE_INTEGER;

export class Point {
  constructor(
    private m_x = 0,
    private m_y = 0,
  ) {}

  x(): number {
    return this.m_x;
  }
  y(): number {
    return this.m_y;
  }

  magnitude2(): number {
    return this.m_x * this.m_x + this.m_y * this.m_y;
  }

  static determinant(p1: Point, p2: Point): number {
    return p1.m_x * p2.m_y - p1.m_y * p2.m_x;
  }

  static vector(p1: Point, p2: Point): Point {
    return new Point(p2.m_x - p1.m_x, p2.m_y - p1.m_y);
  }

  static dist2(p1: Point, p2: Point): number {
    const vec = Point.vector(p1, p2);
    return vec.m_x * vec.m_x + vec.m_y * vec.m_y;
  }

  static equal(p1: Point, p2: Point, span: number): boolean {
    const dist = Point.dist2(p1, p2) / span;

    // ABELL - This number should be examined to figure how how
    // it correlates with the breakdown of calculating determinants.
    return dist < 1e-20;
  }
}

//@see https://stackoverflow.com/questions/33333363/built-in-mod-vs-custom-mod-function-improve-the-performance-of-modulus-op/33333636#33333636
function fast_mod(i: number, c: number): number {
  return i >= c ? i % c : i;
}

// Kahan and Babuska summation, Neumaier variant; accumulates less FP error
function sum(x: number[]): number {
  let s = x[0]!;
  let err = 0.0;

  for (let i = 1; i < x.length; i++) {
    const k = x[i]!;
    const m = s + k;

    err += Math.abs(s) >= Math.abs(k) ? s - m + k : k - m + s;
    s = m;
  }
  return s + err;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function circumradius(p1: Point, p2: Point, p3: Point): number {
  const d = Point.vector(p1, p2);
  const e = Point.vector(p1, p3);

  const bl = d.magnitude2();
  const cl = e.magnitude2();
  const det = Point.determinant(d, e);

  const radius = new Point(
    ((e.y() * bl - d.y() * cl) * 0.5) / det,
    ((d.x() * cl - e.x() * bl) * 0.5) / det,
  );

  if ((bl > 0.0 || bl < 0.0) && (cl > 0.0 || cl < 0.0) && (det > 0.0 || det < 0.0))
    return radius.magnitude2();
  return Number.MAX_VALUE;
}

export function clockwise(p0: Point, p1: Point, p2: Point): boolean {
  const v0 = Point.vector(p0, p1);
  const v1 = Point.vector(p0, p2);
  const det = Point.determinant(v0, v1);
  const d = v0.magnitude2() + v1.magnitude2();

  if (det === 0) {
    return false;
  }

  const reldet = Math.abs(d / det);

  if (reldet > 1e14) return false;

  return det < 0;
}

function counterclockwise(p0: Point, p1: Point, p2: Point): boolean {
  const v0 = Point.vector(p0, p1);
  const v1 = Point.vector(p0, p2);
  const det = Point.determinant(v0, v1);
  const d = v0.magnitude2() + v1.magnitude2();

  if (det === 0) return false;

  const reldet = Math.abs(d / det);

  if (reldet > 1e14) return false;

  return det > 0;
}

function counterclockwise6(
  px: number,
  py: number,
  qx: number,
  qy: number,
  rx: number,
  ry: number,
): boolean {
  return counterclockwise(new Point(px, py), new Point(qx, qy), new Point(rx, ry));
}

function circumcenter(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): Point {
  const dx = bx - ax;
  const dy = by - ay;
  const ex = cx - ax;
  const ey = cy - ay;

  const bl = dx * dx + dy * dy;
  const cl = ex * ex + ey * ey;
  //ABELL - This is suspect for div-by-0.
  const d = dx * ey - dy * ex;

  const x = ax + ((ey * bl - dy * cl) * 0.5) / d;
  const y = ay + ((dx * cl - ex * bl) * 0.5) / d;

  return new Point(x, y);
}

function in_circle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number,
): boolean {
  const dx = ax - px;
  const dy = ay - py;
  const ex = bx - px;
  const ey = by - py;
  const fx = cx - px;
  const fy = cy - py;

  const ap = dx * dx + dy * dy;
  const bp = ex * ex + ey * ey;
  const cp = fx * fx + fy * fy;

  return dx * (ey * cp - bp * fy) - dy * (ex * cp - bp * fx) + ap * (ex * fy - ey * fx) < 0.0;
}

const EPSILON = Number.EPSILON;

function check_pts_equal(x1: number, y1: number, x2: number, y2: number): boolean {
  return Math.abs(x1 - x2) <= EPSILON && Math.abs(y1 - y2) <= EPSILON;
}

// monotonically increases with real angle, but doesn't need expensive trigonometry
function pseudo_angle(dx: number, dy: number): number {
  const p = dx / (Math.abs(dx) + Math.abs(dy));
  return (dy > 0.0 ? 3.0 - p : 1.0 + p) / 4.0; // [0..1)
}

export class Delaunator {
  readonly coords: readonly number[];
  private m_points: Point[];

  // 'triangles' stores the indices to the 'X's of the input
  // 'coords'.
  triangles: number[] = [];

  // 'halfedges' store indices into 'triangles'.  If halfedges[X] = Y,
  // It says that there's an edge from X to Y where a) X and Y are
  // both indices into triangles and b) X and Y are indices into different
  // triangles in the array.  This allows you to get from a triangle to
  // its adjacent triangle.  If the a triangle edge has no adjacent triangle,
  // its half edge will be INVALID_INDEX.
  halfedges: number[] = [];

  hull_prev: number[] = [];
  hull_next: number[] = [];

  // This contains indexes into the triangles array.
  hull_tri: number[] = [];
  hull_start = 0;

  private m_hash: number[] = [];
  private m_center: Point = new Point();
  private m_hash_size = 0;
  private m_edge_stack: number[] = [];

  constructor(in_coords: readonly number[]) {
    this.coords = in_coords;
    const n = in_coords.length >> 1;
    this.m_points = [];
    for (let i = 0; i < n; i++)
      this.m_points.push(new Point(in_coords[2 * i]!, in_coords[2 * i + 1]!));
    const coords = this.coords;
    const m_points = this.m_points;

    const ids: number[] = [];
    for (let i = 0; i < n; i++) ids.push(i);

    let max_x = -Number.MAX_VALUE;
    let max_y = -Number.MAX_VALUE;
    let min_x = Number.MAX_VALUE;
    let min_y = Number.MAX_VALUE;
    for (const p of m_points) {
      min_x = Math.min(p.x(), min_x);
      min_y = Math.min(p.y(), min_y);
      max_x = Math.max(p.x(), max_x);
      max_y = Math.max(p.y(), max_y);
    }

    const width = max_x - min_x;
    const height = max_y - min_y;
    const span = width * width + height * height; // Everything is square dist.

    const center = new Point((min_x + max_x) / 2, (min_y + max_y) / 2);

    let i0 = INVALID_INDEX;
    let i1 = INVALID_INDEX;
    let i2 = INVALID_INDEX;

    // pick a seed point close to the centroid
    let min_dist = Number.MAX_VALUE;
    for (let i = 0; i < m_points.length; ++i) {
      const p = m_points[i]!;
      const d = Point.dist2(center, p);
      if (d < min_dist) {
        i0 = i;
        min_dist = d;
      }
    }

    const p0 = m_points[i0]!;

    min_dist = Number.MAX_VALUE;

    // find the point closest to the seed
    for (let i = 0; i < n; i++) {
      if (i === i0) continue;
      const d = Point.dist2(p0, m_points[i]!);
      if (d < min_dist && d > 0.0) {
        i1 = i;
        min_dist = d;
      }
    }

    const p1 = m_points[i1]!;

    let min_radius = Number.MAX_VALUE;

    // find the third point which forms the smallest circumcircle
    // with the first two
    for (let i = 0; i < n; i++) {
      if (i === i0 || i === i1) continue;

      const r = circumradius(p0, p1, m_points[i]!);
      if (r < min_radius) {
        i2 = i;
        min_radius = r;
      }
    }

    if (!(min_radius < Number.MAX_VALUE)) {
      throw new Error('not triangulation');
    }

    const p2 = m_points[i2]!;

    if (counterclockwise(p0, p1, p2)) {
      const t = i1;
      i1 = i2;
      i2 = t;
    }

    const i0x = p0.x();
    const i0y = p0.y();
    const i1x = m_points[i1]!.x();
    const i1y = m_points[i1]!.y();
    const i2x = m_points[i2]!.x();
    const i2y = m_points[i2]!.y();

    this.m_center = circumcenter(i0x, i0y, i1x, i1y, i2x, i2y);

    // Calculate the distances from the center once to avoid having to
    // calculate for each compare.  This used to be done in the comparator,
    // but GCC 7.5+ would copy the comparator to iterators used in the
    // sort, and this was excruciatingly slow when there were many points
    // because you had to copy the vector of distances.
    const dists: number[] = [];
    for (const p of m_points) dists.push(dist(p.x(), p.y(), this.m_center.x(), this.m_center.y()));

    // sort the points by distance from the seed triangle circumcenter
    stdSort(ids, (i, j) => dists[i]! < dists[j]!);

    // initialize a hash table for storing edges of the advancing convex hull
    this.m_hash_size = Math.ceil(Math.sqrt(n));
    this.m_hash = new Array(this.m_hash_size).fill(INVALID_INDEX);

    // initialize arrays for tracking the edges of the advancing convex hull
    this.hull_prev = new Array(n).fill(0);
    this.hull_next = new Array(n).fill(0);
    this.hull_tri = new Array(n).fill(0);

    this.hull_start = i0;

    let hull_size = 3;

    this.hull_next[i0] = this.hull_prev[i2] = i1;
    this.hull_next[i1] = this.hull_prev[i0] = i2;
    this.hull_next[i2] = this.hull_prev[i1] = i0;

    this.hull_tri[i0] = 0;
    this.hull_tri[i1] = 1;
    this.hull_tri[i2] = 2;

    this.m_hash[this.hash_key(i0x, i0y)] = i0;
    this.m_hash[this.hash_key(i1x, i1y)] = i1;
    this.m_hash[this.hash_key(i2x, i2y)] = i2;

    this.add_triangle(i0, i1, i2, INVALID_INDEX, INVALID_INDEX, INVALID_INDEX);
    let xp = Number.NaN;
    let yp = Number.NaN;

    // Go through points based on distance from the center.
    for (let k = 0; k < n; k++) {
      const i = ids[k]!;
      const x = coords[2 * i]!;
      const y = coords[2 * i + 1]!;

      // skip near-duplicate points
      if (k > 0 && check_pts_equal(x, y, xp, yp)) continue;
      xp = x;
      yp = y;

      //ABELL - This is dumb.  We have the indices.  Use them.
      // skip seed triangle points
      if (
        check_pts_equal(x, y, i0x, i0y) ||
        check_pts_equal(x, y, i1x, i1y) ||
        check_pts_equal(x, y, i2x, i2y)
      )
        continue;

      // find a visible edge on the convex hull using edge hash
      let start = 0;

      const key = this.hash_key(x, y);
      for (let j = 0; j < this.m_hash_size; j++) {
        start = this.m_hash[fast_mod(key + j, this.m_hash_size)]!;

        // ABELL - Not sure how hull_next[start] could ever equal start
        // I *think* hull_next is just a representation of the hull in one
        // direction.
        if (start !== INVALID_INDEX && start !== this.hull_next[start]) break;
      }

      //ABELL
      // Make sure what we found is on the hull.
      console.assert(this.hull_prev[start] !== start);
      console.assert(this.hull_prev[start] !== INVALID_INDEX);

      start = this.hull_prev[start]!;
      let e = start;
      let q: number;

      // Advance until we find a place in the hull where our current point
      // can be added.
      while (true) {
        q = this.hull_next[e]!;
        if (
          Point.equal(m_points[i]!, m_points[e]!, span) ||
          Point.equal(m_points[i]!, m_points[q]!, span)
        ) {
          e = INVALID_INDEX;
          break;
        }
        if (
          counterclockwise6(
            x,
            y,
            coords[2 * e]!,
            coords[2 * e + 1]!,
            coords[2 * q]!,
            coords[2 * q + 1]!,
          )
        )
          break;
        e = q;
        if (e === start) {
          e = INVALID_INDEX;
          break;
        }
      }

      // ABELL
      // This seems wrong.  Perhaps we should check what's going on?
      if (e === INVALID_INDEX)
        // likely a near-duplicate point; skip it
        continue;

      // add the first triangle from the point
      let t = this.add_triangle(
        e,
        i,
        this.hull_next[e]!,
        INVALID_INDEX,
        INVALID_INDEX,
        this.hull_tri[e]!,
      );

      this.hull_tri[i] = this.legalize(t + 2); // Legalize the triangle we just added.
      this.hull_tri[e] = t;
      hull_size++;

      // walk forward through the hull, adding more triangles and
      // flipping recursively
      let next = this.hull_next[e]!;
      while (true) {
        q = this.hull_next[next]!;
        if (
          !counterclockwise6(
            x,
            y,
            coords[2 * next]!,
            coords[2 * next + 1]!,
            coords[2 * q]!,
            coords[2 * q + 1]!,
          )
        )
          break;
        t = this.add_triangle(next, i, q, this.hull_tri[i]!, INVALID_INDEX, this.hull_tri[next]!);
        this.hull_tri[i] = this.legalize(t + 2);
        this.hull_next[next] = next; // mark as removed
        hull_size--;
        next = q;
      }

      // walk backward from the other side, adding more triangles and flipping
      if (e === start) {
        while (true) {
          q = this.hull_prev[e]!;
          if (
            !counterclockwise6(
              x,
              y,
              coords[2 * q]!,
              coords[2 * q + 1]!,
              coords[2 * e]!,
              coords[2 * e + 1]!,
            )
          )
            break;
          t = this.add_triangle(q, i, e, INVALID_INDEX, this.hull_tri[e]!, this.hull_tri[q]!);
          this.legalize(t + 2);
          this.hull_tri[q] = t;
          this.hull_next[e] = e; // mark as removed
          hull_size--;
          e = q;
        }
      }

      // update the hull indices
      this.hull_prev[i] = e;
      this.hull_start = e;
      this.hull_prev[next] = i;
      this.hull_next[e] = i;
      this.hull_next[i] = next;

      this.m_hash[this.hash_key(x, y)] = i;
      this.m_hash[this.hash_key(coords[2 * e]!, coords[2 * e + 1]!)] = e;
    }
    void hull_size;
  }

  get_hull_area(): number {
    const hull_area: number[] = [];
    let e = this.hull_start;
    do {
      hull_area.push(
        (this.coords[2 * e]! - this.coords[2 * this.hull_prev[e]!]!) *
          (this.coords[2 * e + 1]! + this.coords[2 * this.hull_prev[e]! + 1]!),
      );
      e = this.hull_next[e]!;
    } while (e !== this.hull_start);
    return sum(hull_area);
  }

  get_triangle_area(): number {
    const vals: number[] = [];
    const coords = this.coords;
    const triangles = this.triangles;
    for (let i = 0; i < triangles.length; i += 3) {
      const ax = coords[2 * triangles[i]!]!;
      const ay = coords[2 * triangles[i]! + 1]!;
      const bx = coords[2 * triangles[i + 1]!]!;
      const by = coords[2 * triangles[i + 1]! + 1]!;
      const cx = coords[2 * triangles[i + 2]!]!;
      const cy = coords[2 * triangles[i + 2]! + 1]!;
      const val = Math.abs((by - ay) * (cx - bx) - (bx - ax) * (cy - by));
      vals.push(val);
    }
    return sum(vals);
  }

  private legalize(aIn: number): number {
    let a = aIn;
    let i = 0;
    let ar = 0;
    this.m_edge_stack.length = 0;
    const coords = this.coords;
    const triangles = this.triangles;
    const halfedges = this.halfedges;

    // recursion eliminated with a fixed-size stack
    while (true) {
      const b = halfedges[a]!;

      /* if the pair of triangles doesn't satisfy the Delaunay condition
       * (p1 is inside the circumcircle of [p0, pl, pr]), flip them,
       * then do the same check/flip recursively for the new pair of triangles
       *
       *           pl                    pl
       *          /||\                  /  \
       *       al/ || \bl            al/    \a
       *        /  ||  \              /      \
       *       /  a||b  \    flip    /___ar___\
       *     p0\   ||   /p1   =>   p0\---bl---/p1
       *        \  ||  /              \      /
       *       ar\ || /br             b\    /br
       *          \||/                  \  /
       *           pr                    pr
       */
      const a0 = 3 * Math.floor(a / 3);
      ar = a0 + ((a + 2) % 3);

      if (b === INVALID_INDEX) {
        if (i > 0) {
          i--;
          a = this.m_edge_stack[i]!;
          continue;
        } else {
          //i = INVALID_INDEX;
          break;
        }
      }

      const b0 = 3 * Math.floor(b / 3);
      const al = a0 + ((a + 1) % 3);
      const bl = b0 + ((b + 2) % 3);

      const p0 = triangles[ar]!;
      const pr = triangles[a]!;
      const pl = triangles[al]!;
      const p1 = triangles[bl]!;

      const illegal = in_circle(
        coords[2 * p0]!,
        coords[2 * p0 + 1]!,
        coords[2 * pr]!,
        coords[2 * pr + 1]!,
        coords[2 * pl]!,
        coords[2 * pl + 1]!,
        coords[2 * p1]!,
        coords[2 * p1 + 1]!,
      );

      if (illegal) {
        triangles[a] = p1;
        triangles[b] = p0;

        const hbl = halfedges[bl]!;

        // Edge swapped on the other side of the hull (rare).
        // Fix the halfedge reference
        if (hbl === INVALID_INDEX) {
          let e = this.hull_start;
          do {
            if (this.hull_tri[e] === bl) {
              this.hull_tri[e] = a;
              break;
            }
            e = this.hull_prev[e]!;
          } while (e !== this.hull_start);
        }
        this.link(a, hbl);
        this.link(b, halfedges[ar]!);
        this.link(ar, bl);
        const br = b0 + ((b + 1) % 3);

        if (i < this.m_edge_stack.length) {
          this.m_edge_stack[i] = br;
        } else {
          this.m_edge_stack.push(br);
        }
        i++;
      } else {
        if (i > 0) {
          i--;
          a = this.m_edge_stack[i]!;
          continue;
        } else {
          break;
        }
      }
    }
    return ar;
  }

  private hash_key(x: number, y: number): number {
    const dx = x - this.m_center.x();
    const dy = y - this.m_center.y();
    return fast_mod(
      Math.round(Math.floor(pseudo_angle(dx, dy) * this.m_hash_size)),
      this.m_hash_size,
    );
  }

  private add_triangle(
    i0: number,
    i1: number,
    i2: number,
    a: number,
    b: number,
    c: number,
  ): number {
    const t = this.triangles.length;
    this.triangles.push(i0);
    this.triangles.push(i1);
    this.triangles.push(i2);
    this.link(t, a);
    this.link(t + 1, b);
    this.link(t + 2, c);
    return t;
  }

  private link(a: number, b: number): void {
    const s = this.halfedges.length;
    if (a === s) {
      this.halfedges.push(b);
    } else if (a < s) {
      this.halfedges[a] = b;
    } else {
      throw new Error('Cannot link edge');
    }
    if (b !== INVALID_INDEX) {
      const s2 = this.halfedges.length;
      if (b === s2) {
        this.halfedges.push(a);
      } else if (b < s2) {
        this.halfedges[b] = a;
      } else {
        throw new Error('Cannot link edge');
      }
    }
  }
}
