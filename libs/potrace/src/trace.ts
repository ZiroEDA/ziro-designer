// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2001-2017 Peter Selinger. Ported by ZiroEDA and contributors.
/**
 * `thirdparty/potrace/src/trace.cpp`: transform jaggy paths into smooth
 * curves. Per path: `calc_sums` → `calc_lon` → `bestpolygon` →
 * `adjust_vertices` → (`reverse` for a negative path) → `smooth` →
 * `opticurve`.
 *
 * Every `int` expression the C divides is truncated (`idiv`); `double`
 * expressions are the same IEEE operations in the same order, so the curve
 * comes out bit-identical. `SAFE_CALLOC` cannot fail here, so neither can a
 * stage, and `process_path` always returns 0.
 */
import {
  abs,
  type dpoint_t,
  floordiv,
  idiv,
  interval,
  min,
  mod,
  type point_t,
  sign,
  sq,
} from '../include/auxiliary.js';
import {
  privcurve_init,
  privcurve_to_curve,
  type path_t,
  type privcurve_t,
  type privpath_t,
  type sums_t,
} from './curve.js';
import { POTRACE_CORNER, POTRACE_CURVETO, type potrace_param_t } from './potracelib.js';

/** it suffices that this is longer than any path; it need not be really infinite [data] */
const INFTY = 10000000;
/** the cosine of 179 degrees [data] */
const COS179 = -0.999847695156;

/* ---------------------------------------------------------------------- */
/* auxiliary functions */

/**
 * `dorth_infty( p0, p2 )`: a direction that is 90 degrees counterclockwise
 * from p2-p0, but then restricted to one of the major wind directions.
 */
function dorth_infty(p0: dpoint_t, p2: dpoint_t): point_t {
  return { x: -sign(p2.y - p0.y), y: sign(p2.x - p0.x) };
}

/** `dpara( p0, p1, p2 )`: (p1-p0)x(p2-p0), the area of the parallelogram. */
function dpara(p0: dpoint_t, p1: dpoint_t, p2: dpoint_t): number {
  const x1 = p1.x - p0.x;
  const y1 = p1.y - p0.y;
  const x2 = p2.x - p0.x;
  const y2 = p2.y - p0.y;

  return x1 * y2 - x2 * y1;
}

/**
 * `ddenom( p0, p2 )`: ddenom/dpara have the property that the square of
 * radius 1 centered at p1 intersects the line p0p2 iff
 * |dpara(p0,p1,p2)| <= ddenom(p0,p2).
 */
function ddenom(p0: dpoint_t, p2: dpoint_t): number {
  const r = dorth_infty(p0, p2);

  return r.y * (p2.x - p0.x) - r.x * (p2.y - p0.y);
}

/** `cyclic( a, b, c )`: 1 if a <= b < c < a, in a cyclic sense (mod n). */
function cyclic(a: number, b: number, c: number): boolean {
  if (a <= c) return a <= b && b < c;
  else return a <= b || b < c;
}

/**
 * `pointslope( pp, i, j, ctr, dir )`: determine the center and slope of the
 * line i..j. Assume i<j. Needs "sum" components of p to be set.
 */
function pointslope(pp: privpath_t, i: number, j: number, ctr: dpoint_t, dir: dpoint_t): void {
  // assume i<j
  const n = pp.len;
  const sums = pp.sums;
  let r = 0; // rotations from i to j

  while (j >= n) {
    j -= n;
    r += 1;
  }
  while (i >= n) {
    i -= n;
    r -= 1;
  }
  while (j < 0) {
    j += n;
    r -= 1;
  }
  while (i < 0) {
    i += n;
    r += 1;
  }

  const x = sums[j + 1]!.x - sums[i]!.x + r * sums[n]!.x;
  const y = sums[j + 1]!.y - sums[i]!.y + r * sums[n]!.y;
  const x2 = sums[j + 1]!.x2 - sums[i]!.x2 + r * sums[n]!.x2;
  const xy = sums[j + 1]!.xy - sums[i]!.xy + r * sums[n]!.xy;
  const y2 = sums[j + 1]!.y2 - sums[i]!.y2 + r * sums[n]!.y2;
  const k = j + 1 - i + r * n;

  ctr.x = x / k;
  ctr.y = y / k;

  let a = (x2 - (x * x) / k) / k;
  const b = (xy - (x * y) / k) / k;
  let c = (y2 - (y * y) / k) / k;

  const lambda2 = (a + c + Math.sqrt((a - c) * (a - c) + 4 * b * b)) / 2; // larger e.value

  // now find e.vector for lambda2
  a -= lambda2;
  c -= lambda2;

  let l: number;

  if (Math.abs(a) >= Math.abs(c)) {
    l = Math.sqrt(a * a + b * b);

    if (l !== 0) {
      dir.x = -b / l;
      dir.y = a / l;
    }
  } else {
    l = Math.sqrt(c * c + b * b);

    if (l !== 0) {
      dir.x = -c / l;
      dir.y = b / l;
    }
  }

  if (l === 0) {
    // sometimes this can happen when k=4: the two eigenvalues coincide
    dir.x = dir.y = 0;
  }
}

/**
 * `quadform_t`: an (affine) quadratic form, a symmetric 3x3 matrix; its value
 * at (x,y) is v^t Q v, v = (x,y,1)^t.
 */
type quadform_t = number[][];

const newQuadform = (): quadform_t => [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];

/** `quadform( Q, w )`: apply quadratic form Q to vector w = (w.x,w.y). */
function quadform(Q: quadform_t, w: dpoint_t): number {
  const v = [w.x, w.y, 1];
  let sum = 0.0;

  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) sum += v[i]! * Q[i]![j]! * v[j]!;
  }

  return sum;
}

/** `xprod( p1, p2 )`: p1 x p2, in `int`. */
function xprod(p1: point_t, p2: point_t): number {
  return p1.x * p2.y - p1.y * p2.x;
}

/** `cprod( p0, p1, p2, p3 )`: (p1-p0)x(p3-p2). */
function cprod(p0: dpoint_t, p1: dpoint_t, p2: dpoint_t, p3: dpoint_t): number {
  const x1 = p1.x - p0.x;
  const y1 = p1.y - p0.y;
  const x2 = p3.x - p2.x;
  const y2 = p3.y - p2.y;

  return x1 * y2 - x2 * y1;
}

/** `iprod( p0, p1, p2 )`: (p1-p0)*(p2-p0). */
function iprod(p0: dpoint_t, p1: dpoint_t, p2: dpoint_t): number {
  const x1 = p1.x - p0.x;
  const y1 = p1.y - p0.y;
  const x2 = p2.x - p0.x;
  const y2 = p2.y - p0.y;

  return x1 * x2 + y1 * y2;
}

/** `iprod1( p0, p1, p2, p3 )`: (p1-p0)*(p3-p2). */
function iprod1(p0: dpoint_t, p1: dpoint_t, p2: dpoint_t, p3: dpoint_t): number {
  const x1 = p1.x - p0.x;
  const y1 = p1.y - p0.y;
  const x2 = p3.x - p2.x;
  const y2 = p3.y - p2.y;

  return x1 * x2 + y1 * y2;
}

/** `ddist( p, q )`: distance between two points. */
function ddist(p: dpoint_t, q: dpoint_t): number {
  return Math.sqrt(sq(p.x - q.x) + sq(p.y - q.y));
}

/** `bezier( t, p0, p1, p2, p3 )`: point of a bezier curve. */
function bezier(t: number, p0: dpoint_t, p1: dpoint_t, p2: dpoint_t, p3: dpoint_t): dpoint_t {
  const s = 1 - t;

  return {
    x: s * s * s * p0.x + 3 * (s * s * t) * p1.x + 3 * (t * t * s) * p2.x + t * t * t * p3.x,
    y: s * s * s * p0.y + 3 * (s * s * t) * p1.y + 3 * (t * t * s) * p2.y + t * t * t * p3.y,
  };
}

/**
 * `tangent( p0, p1, p2, p3, q0, q1 )`: the point t in [0..1] on the (convex)
 * bezier curve (p0,p1,p2,p3) which is tangent to q1-q0. Return -1.0 if there
 * is no solution in [0..1].
 */
function tangent(
  p0: dpoint_t,
  p1: dpoint_t,
  p2: dpoint_t,
  p3: dpoint_t,
  q0: dpoint_t,
  q1: dpoint_t,
): number {
  // (1-t)^2 A + 2(1-t)t B + t^2 C = 0
  const A = cprod(p0, p1, q0, q1);
  const B = cprod(p1, p2, q0, q1);
  const C = cprod(p2, p3, q0, q1);

  // a t^2 + b t + c = 0
  const a = A - 2 * B + C;
  const b = -2 * A + 2 * B;
  const c = A;

  const d = b * b - 4 * a * c;

  if (a === 0 || d < 0) return -1.0;

  const s = Math.sqrt(d);

  const r1 = (-b + s) / (2 * a);
  const r2 = (-b - s) / (2 * a);

  if (r1 >= 0 && r1 <= 1) return r1;
  else if (r2 >= 0 && r2 <= 1) return r2;
  else return -1.0;
}

/* ---------------------------------------------------------------------- */
/* Preparation: fill in the sum* fields of a path (used for later rapid
 * summing). */
function calc_sums(pp: privpath_t): number {
  const n = pp.len;

  pp.sums = Array.from({ length: n + 1 }, (): sums_t => ({ x: 0, y: 0, x2: 0, xy: 0, y2: 0 }));

  // origin
  pp.x0 = pp.pt[0]!.x;
  pp.y0 = pp.pt[0]!.y;

  // preparatory computation for later fast summing
  for (let i = 0; i < n; i++) {
    const x = pp.pt[i]!.x - pp.x0;
    const y = pp.pt[i]!.y - pp.y0;
    const s0 = pp.sums[i]!;
    const s1 = pp.sums[i + 1]!;

    s1.x = s0.x + x;
    s1.y = s0.y + y;
    s1.x2 = s0.x2 + x * x;
    s1.xy = s0.xy + x * y;
    s1.y2 = s0.y2 + y * y;
  }

  return 0;
}

/* ---------------------------------------------------------------------- */
/* Stage 1: determine the straight subpaths (Sec. 2.2.1). Fill in the "lon"
 * component of a path object (based on pt/len). For each i, lon[i] is the
 * furthest index such that a straight line can be drawn from i to lon[i].
 *
 * A "constraint" means that future points must satisfy
 * xprod(constraint[0], cur) >= 0 and xprod(constraint[1], cur) <= 0. */
function calc_lon(pp: privpath_t): number {
  const pt = pp.pt;
  const n = pp.len;
  const ct = [0, 0, 0, 0];
  const constraint: point_t[] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  const cur: point_t = { x: 0, y: 0 };
  const off: point_t = { x: 0, y: 0 };
  const pivk = new Array<number>(n).fill(0); // pivk[n]
  const nc = new Array<number>(n).fill(0); // nc[n]: next corner
  const dk: point_t = { x: 0, y: 0 }; // direction of k-k1

  /* initialize the nc data structure. Point from each point to the furthest
   * future point to which it is connected by a vertical or horizontal
   * segment. */
  let k = 0;

  for (let i = n - 1; i >= 0; i--) {
    if (pt[i]!.x !== pt[k]!.x && pt[i]!.y !== pt[k]!.y) k = i + 1; // necessarily i<n-1 in this case

    nc[i] = k;
  }

  pp.lon = new Array<number>(n).fill(0);

  /* determine pivot points: for each i, let pivk[i] be the furthest k such
   * that all j with i<j<k lie on a line connecting i,k. */
  for (let i = n - 1; i >= 0; i--) {
    ct[0] = ct[1] = ct[2] = ct[3] = 0;

    // keep track of "directions" that have occurred
    let dir = idiv(
      3 + 3 * (pt[mod(i + 1, n)]!.x - pt[i]!.x) + (pt[mod(i + 1, n)]!.y - pt[i]!.y),
      2,
    );
    ct[dir]!++;

    constraint[0]!.x = 0;
    constraint[0]!.y = 0;
    constraint[1]!.x = 0;
    constraint[1]!.y = 0;

    // find the next k such that no straight line from i to k
    k = nc[i]!;
    let k1 = i;
    let foundk = false;

    while (true) {
      dir = idiv(3 + 3 * sign(pt[k]!.x - pt[k1]!.x) + sign(pt[k]!.y - pt[k1]!.y), 2);
      ct[dir]!++;

      // if all four "directions" have occurred, cut this path
      if (ct[0] && ct[1] && ct[2] && ct[3]) {
        pivk[i] = k1;
        foundk = true;
        break;
      }

      cur.x = pt[k]!.x - pt[i]!.x;
      cur.y = pt[k]!.y - pt[i]!.y;

      // see if current constraint is violated
      if (xprod(constraint[0]!, cur) < 0 || xprod(constraint[1]!, cur) > 0) break; // constraint_viol

      // else, update constraint
      if (abs(cur.x) <= 1 && abs(cur.y) <= 1) {
        // no constraint
      } else {
        off.x = cur.x + (cur.y >= 0 && (cur.y > 0 || cur.x < 0) ? 1 : -1);
        off.y = cur.y + (cur.x <= 0 && (cur.x < 0 || cur.y < 0) ? 1 : -1);

        if (xprod(constraint[0]!, off) >= 0) constraint[0] = { ...off };

        off.x = cur.x + (cur.y <= 0 && (cur.y < 0 || cur.x < 0) ? 1 : -1);
        off.y = cur.y + (cur.x >= 0 && (cur.x > 0 || cur.y < 0) ? 1 : -1);

        if (xprod(constraint[1]!, off) <= 0) constraint[1] = { ...off };
      }

      k1 = k;
      k = nc[k1]!;

      if (!cyclic(k, i, k1)) break;
    }

    if (foundk) continue;

    // constraint_viol:
    /* k1 was the last "corner" satisfying the current constraint, and k is
     * the first one violating it. We now need to find the last point along
     * k1..k which satisfied the constraint. */
    dk.x = sign(pt[k]!.x - pt[k1]!.x);
    dk.y = sign(pt[k]!.y - pt[k1]!.y);
    cur.x = pt[k1]!.x - pt[i]!.x;
    cur.y = pt[k1]!.y - pt[i]!.y;

    /* find largest integer j such that xprod(constraint[0], cur+j*dk) >= 0
     * and xprod(constraint[1], cur+j*dk) <= 0. Use bilinearity of xprod. */
    const a = xprod(constraint[0]!, cur);
    const b = xprod(constraint[0]!, dk);
    const c = xprod(constraint[1]!, cur);
    const d = xprod(constraint[1]!, dk);

    /* find largest integer j such that a+j*b>=0 and c+j*d<=0. This can be
     * solved with integer arithmetic. */
    let j = INFTY;

    if (b < 0) j = floordiv(a, -b);

    if (d > 0) j = min(j, floordiv(-c, d));

    pivk[i] = mod(k1 + j, n);
  }

  /* clean up: for each i, let lon[i] be the largest k such that for all i'
   * with i<=i'<k, i'<k<=pivk[i']. */
  let j = pivk[n - 1]!;
  pp.lon[n - 1] = j;

  for (let i = n - 2; i >= 0; i--) {
    if (cyclic(i + 1, pivk[i]!, j)) j = pivk[i]!;

    pp.lon[i] = j;
  }

  for (let i = n - 1; cyclic(mod(i + 1, n), j, pp.lon[i]!); i--) pp.lon[i] = j;

  return 0;
}

/* ---------------------------------------------------------------------- */
/* Stage 2: calculate the optimal polygon (Sec. 2.2.2-2.2.4). */

/**
 * `penalty3( pp, i, j )`: the penalty of an edge from i to j in the given
 * path. This needs the "lon" and "sum*" data. Assumes 0<=i<j<=n.
 */
function penalty3(pp: privpath_t, i: number, j: number): number {
  const n = pp.len;
  const pt = pp.pt;
  const sums = pp.sums;
  let x: number;
  let y: number;
  let x2: number;
  let xy: number;
  let y2: number;
  let k: number;
  let r = 0; // rotations from i to j

  if (j >= n) {
    j -= n;
    r = 1;
  }

  // critical inner loop: the "if" gives a 4.6 percent speedup
  if (r === 0) {
    x = sums[j + 1]!.x - sums[i]!.x;
    y = sums[j + 1]!.y - sums[i]!.y;
    x2 = sums[j + 1]!.x2 - sums[i]!.x2;
    xy = sums[j + 1]!.xy - sums[i]!.xy;
    y2 = sums[j + 1]!.y2 - sums[i]!.y2;
    k = j + 1 - i;
  } else {
    x = sums[j + 1]!.x - sums[i]!.x + sums[n]!.x;
    y = sums[j + 1]!.y - sums[i]!.y + sums[n]!.y;
    x2 = sums[j + 1]!.x2 - sums[i]!.x2 + sums[n]!.x2;
    xy = sums[j + 1]!.xy - sums[i]!.xy + sums[n]!.xy;
    y2 = sums[j + 1]!.y2 - sums[i]!.y2 + sums[n]!.y2;
    k = j + 1 - i + n;
  }

  const px = (pt[i]!.x + pt[j]!.x) / 2.0 - pt[0]!.x;
  const py = (pt[i]!.y + pt[j]!.y) / 2.0 - pt[0]!.y;
  const ey = pt[j]!.x - pt[i]!.x;
  const ex = -(pt[j]!.y - pt[i]!.y);

  const a = (x2 - 2 * x * px) / k + px * px;
  const b = (xy - x * py - y * px) / k + px * py;
  const c = (y2 - 2 * y * py) / k + py * py;

  const s = ex * ex * a + 2 * ex * ey * b + ey * ey * c;

  return Math.sqrt(s);
}

/**
 * `bestpolygon( pp )`: find the optimal polygon. Fill in the m and po
 * components. Non-cyclic version: assumes i=0 is in the polygon.
 */
function bestpolygon(pp: privpath_t): number {
  const n = pp.len;
  const pen = new Array<number>(n + 1).fill(0); // pen[n+1]: penalty vector
  const prev = new Array<number>(n + 1).fill(0); // prev[n+1]: best path pointer vector
  const clip0 = new Array<number>(n).fill(0); // clip0[n]: longest segment pointer, non-cyclic
  const clip1 = new Array<number>(n + 1).fill(0); // clip1[n+1]: backwards segment pointer, non-cyclic
  const seg0 = new Array<number>(n + 1).fill(0); // seg0[m+1]: forward segment bounds, m<=n
  const seg1 = new Array<number>(n + 1).fill(0); // seg1[m+1]: backward segment bounds, m<=n

  // calculate clipped paths
  for (let i = 0; i < n; i++) {
    let c = mod(pp.lon[mod(i - 1, n)]! - 1, n);

    if (c === i) c = mod(i + 1, n);

    if (c < i) clip0[i] = n;
    else clip0[i] = c;
  }

  /* calculate backwards path clipping, non-cyclic. j <= clip0[i] iff
   * clip1[j] <= i, for i,j=0..n. */
  let j = 1;

  for (let i = 0; i < n; i++) {
    while (j <= clip0[i]!) {
      clip1[j] = i;
      j++;
    }
  }

  // calculate seg0[j] = longest path from 0 with j segments
  let i = 0;

  for (j = 0; i < n; j++) {
    seg0[j] = i;
    i = clip0[i]!;
  }

  seg0[j] = n;
  const m = j;

  // calculate seg1[j] = longest path to n with m-j segments
  i = n;

  for (j = m; j > 0; j--) {
    seg1[j] = i;
    i = clip1[i]!;
  }

  seg1[0] = 0;

  /* now find the shortest path with m segments, based on penalty3. */
  pen[0] = 0;

  for (j = 1; j <= m; j++) {
    for (i = seg1[j]!; i <= seg0[j]!; i++) {
      let best = -1;

      for (let k = seg0[j - 1]!; k >= clip1[i]!; k--) {
        const thispen = penalty3(pp, k, i) + pen[k]!;

        if (best < 0 || thispen < best) {
          prev[i] = k;
          best = thispen;
        }
      }

      pen[i] = best;
    }
  }

  pp.m = m;
  pp.po = new Array<number>(m).fill(0);

  // read off shortest path
  for (i = n, j = m - 1; i > 0; j--) {
    i = prev[i]!;
    pp.po[j] = i;
  }

  return 0;
}

/* ---------------------------------------------------------------------- */
/* Stage 3: vertex adjustment (Sec. 2.3.1). */

/**
 * `adjust_vertices( pp )`: calculate the intersection of the two "optimal"
 * line segments, then move it into the unit square if it lies outside.
 */
function adjust_vertices(pp: privpath_t): number {
  const m = pp.m;
  const po = pp.po;
  const n = pp.len;
  const pt = pp.pt;
  const x0 = pp.x0;
  const y0 = pp.y0;
  const ctr: dpoint_t[] = Array.from({ length: m }, () => ({ x: 0, y: 0 })); // ctr[m]
  const dir: dpoint_t[] = Array.from({ length: m }, () => ({ x: 0, y: 0 })); // dir[m]
  const q: quadform_t[] = Array.from({ length: m }, newQuadform); // q[m]
  const v = [0, 0, 0];
  let d: number;
  const s: dpoint_t = { x: 0, y: 0 };

  privcurve_init(pp.curve, m);

  // calculate "optimal" point-slope representation for each line segment
  for (let i = 0; i < m; i++) {
    let j = po[mod(i + 1, m)]!;
    j = mod(j - po[i]!, n) + po[i]!;
    pointslope(pp, po[i]!, j, ctr[i]!, dir[i]!);
  }

  /* represent each line segment as a singular quadratic form; the distance of
   * a point (x,y) from the line segment will be (x,y,1)Q(x,y,1)^t, where
   * Q=q[i]. */
  for (let i = 0; i < m; i++) {
    d = sq(dir[i]!.x) + sq(dir[i]!.y);

    if (d === 0.0) {
      for (let j = 0; j < 3; j++) {
        for (let k = 0; k < 3; k++) q[i]![j]![k] = 0;
      }
    } else {
      v[0] = dir[i]!.y;
      v[1] = -dir[i]!.x;
      v[2] = -v[1]! * ctr[i]!.y - v[0]! * ctr[i]!.x;

      for (let l = 0; l < 3; l++) {
        for (let k = 0; k < 3; k++) q[i]![l]![k] = (v[l]! * v[k]!) / d;
      }
    }
  }

  /* now calculate the "intersections" of consecutive segments. Instead of
   * using the actual intersection, we find the point within a given unit
   * square which minimizes the square distance to the two lines. */
  for (let i = 0; i < m; i++) {
    const Q = newQuadform();
    const w: dpoint_t = { x: 0, y: 0 };

    // let s be the vertex, in coordinates relative to x0/y0
    s.x = pt[po[i]!]!.x - x0;
    s.y = pt[po[i]!]!.y - y0;

    // intersect segments i-1 and i
    const j = mod(i - 1, m);

    // add quadratic forms
    for (let l = 0; l < 3; l++) {
      for (let k = 0; k < 3; k++) Q[l]![k] = q[j]![l]![k]! + q[i]![l]![k]!;
    }

    while (true) {
      // minimize the quadratic form Q on the unit square; find intersection
      const det = Q[0]![0]! * Q[1]![1]! - Q[0]![1]! * Q[1]![0]!;

      if (det !== 0.0) {
        w.x = (-Q[0]![2]! * Q[1]![1]! + Q[1]![2]! * Q[0]![1]!) / det;
        w.y = (Q[0]![2]! * Q[1]![0]! - Q[1]![2]! * Q[0]![0]!) / det;
        break;
      }

      /* matrix is singular - lines are parallel. Add another, orthogonal
       * axis, through the center of the unit square */
      if (Q[0]![0]! > Q[1]![1]!) {
        v[0] = -Q[0]![1]!;
        v[1] = Q[0]![0]!;
      } else if (Q[1]![1]!) {
        v[0] = -Q[1]![1]!;
        v[1] = Q[1]![0]!;
      } else {
        v[0] = 1;
        v[1] = 0;
      }

      d = sq(v[0]!) + sq(v[1]!);
      v[2] = -v[1]! * s.y - v[0]! * s.x;

      for (let l = 0; l < 3; l++) {
        for (let k = 0; k < 3; k++) Q[l]![k]! += (v[l]! * v[k]!) / d;
      }
    }

    let dx = Math.abs(w.x - s.x);
    let dy = Math.abs(w.y - s.y);

    if (dx <= 0.5 && dy <= 0.5) {
      pp.curve.vertex[i]!.x = w.x + x0;
      pp.curve.vertex[i]!.y = w.y + y0;
      continue;
    }

    /* the minimum was not in the unit square; now minimize quadratic on
     * boundary of square */
    let minv = quadform(Q, s);
    let xmin = s.x;
    let ymin = s.y;

    if (Q[0]![0]! !== 0.0) {
      for (let z = 0; z < 2; z++) {
        // value of the y-coordinate
        w.y = s.y - 0.5 + z;
        w.x = -(Q[0]![1]! * w.y + Q[0]![2]!) / Q[0]![0]!;
        dx = Math.abs(w.x - s.x);
        const cand = quadform(Q, w);

        if (dx <= 0.5 && cand < minv) {
          minv = cand;
          xmin = w.x;
          ymin = w.y;
        }
      }
    }

    // fixx:
    if (Q[1]![1]! !== 0.0) {
      for (let z = 0; z < 2; z++) {
        // value of the x-coordinate
        w.x = s.x - 0.5 + z;
        w.y = -(Q[1]![0]! * w.x + Q[1]![2]!) / Q[1]![1]!;
        dy = Math.abs(w.y - s.y);
        const cand = quadform(Q, w);

        if (dy <= 0.5 && cand < minv) {
          minv = cand;
          xmin = w.x;
          ymin = w.y;
        }
      }
    }

    // corners: check four corners
    for (let l = 0; l < 2; l++) {
      for (let k = 0; k < 2; k++) {
        w.x = s.x - 0.5 + l;
        w.y = s.y - 0.5 + k;
        const cand = quadform(Q, w);

        if (cand < minv) {
          minv = cand;
          xmin = w.x;
          ymin = w.y;
        }
      }
    }

    pp.curve.vertex[i]!.x = xmin + x0;
    pp.curve.vertex[i]!.y = ymin + y0;
  }

  return 0;
}

/* ---------------------------------------------------------------------- */
/* Stage 4: smoothing and corner analysis (Sec. 2.3.3) */

/** `reverse( curve )`: reverse orientation of a path (its vertices). */
function reverse(curve: privcurve_t): void {
  const m = curve.n;

  for (let i = 0, j = m - 1; i < j; i++, j--) {
    const tmp = curve.vertex[i]!;
    curve.vertex[i] = curve.vertex[j]!;
    curve.vertex[j] = tmp;
  }
}

/** `smooth( curve, alphamax )`. Always succeeds. */
function smooth(curve: privcurve_t, alphamax: number): void {
  const m = curve.n;

  // examine each vertex and find its best fit
  for (let i = 0; i < m; i++) {
    const j = mod(i + 1, m);
    const k = mod(i + 2, m);
    const p4 = interval(1 / 2.0, curve.vertex[k]!, curve.vertex[j]!);
    let alpha: number;

    const denom = ddenom(curve.vertex[i]!, curve.vertex[k]!);

    if (denom !== 0.0) {
      let dd = dpara(curve.vertex[i]!, curve.vertex[j]!, curve.vertex[k]!) / denom;
      dd = Math.abs(dd);
      alpha = dd > 1 ? 1 - 1.0 / dd : 0;
      alpha = alpha / 0.75;
    } else {
      alpha = 4 / 3.0;
    }

    curve.alpha0[j] = alpha; // remember "original" value of alpha

    if (alpha >= alphamax) {
      // pointed corner
      curve.tag[j] = POTRACE_CORNER;
      curve.c[j]![1] = { ...curve.vertex[j]! };
      curve.c[j]![2] = p4;
    } else {
      if (alpha < 0.55) alpha = 0.55;
      else if (alpha > 1) alpha = 1;

      const p2 = interval(0.5 + 0.5 * alpha, curve.vertex[i]!, curve.vertex[j]!);
      const p3 = interval(0.5 + 0.5 * alpha, curve.vertex[k]!, curve.vertex[j]!);
      curve.tag[j] = POTRACE_CURVETO;
      curve.c[j]![0] = p2;
      curve.c[j]![1] = p3;
      curve.c[j]![2] = p4;
    }

    curve.alpha[j] = alpha; // store the "cropped" value of alpha
    curve.beta[j] = 0.5;
  }

  curve.alphacurve = 1;
}

/* ---------------------------------------------------------------------- */
/* Stage 5: Curve optimization (Sec. 2.4) */

/** `opti_t`: the result of opti_penalty. */
interface opti_t {
  /** penalty */
  pen: number;
  /** curve parameters */
  c: dpoint_t[];
  /** curve parameters */
  t: number;
  s: number;
  /** curve parameter */
  alpha: number;
}

const newOpti = (): opti_t => ({
  pen: 0,
  c: [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ],
  t: 0,
  s: 0,
  alpha: 0,
});

const copyOpti = (o: opti_t): opti_t => ({
  pen: o.pen,
  c: [{ ...o.c[0]! }, { ...o.c[1]! }],
  t: o.t,
  s: o.s,
  alpha: o.alpha,
});

/**
 * `opti_penalty( pp, i, j, res, opttolerance, convc, areac )`: calculate best
 * fit from i+.5 to j+.5. Assume i<j (cyclically). Return 0 and set badness and
 * parameters (alpha, beta), if possible. Return 1 if impossible.
 */
function opti_penalty(
  pp: privpath_t,
  i: number,
  j: number,
  res: opti_t,
  opttolerance: number,
  convc: number[],
  areac: number[],
): number {
  const m = pp.curve.n;
  const vertex = pp.curve.vertex;
  const cc = pp.curve.c;

  // check convexity, corner-freeness, and maximum bend < 179 degrees

  if (i === j) return 1; // sanity - a full loop can never be an opticurve

  let k = i;
  const i1 = mod(i + 1, m);
  let k1 = mod(k + 1, m);
  const conv = convc[k1]!;

  if (conv === 0) return 1;

  let d = ddist(vertex[i]!, vertex[i1]!);

  for (k = k1; k !== j; k = k1) {
    k1 = mod(k + 1, m);
    const k2 = mod(k + 2, m);

    if (convc[k1] !== conv) return 1;

    if (sign(cprod(vertex[i]!, vertex[i1]!, vertex[k1]!, vertex[k2]!)) !== conv) return 1;

    if (
      iprod1(vertex[i]!, vertex[i1]!, vertex[k1]!, vertex[k2]!) <
      d * ddist(vertex[k1]!, vertex[k2]!) * COS179
    )
      return 1;
  }

  // the curve we're working in:
  const p0 = cc[mod(i, m)]![2]!;
  let p1 = vertex[mod(i + 1, m)]!;
  let p2 = vertex[mod(j, m)]!;
  const p3 = cc[mod(j, m)]![2]!;

  // determine its area
  let area = areac[j]! - areac[i]!;
  area -= dpara(vertex[0]!, cc[i]![2]!, cc[j]![2]!) / 2;

  if (i >= j) area += areac[m]!;

  /* find intersection o of p0p1 and p2p3. Let t,s such that o =
   * interval(t,p0,p1) = interval(s,p3,p2). Let A be the area of the triangle
   * (p0,o,p3). */
  const A1 = dpara(p0, p1, p2);
  const A2 = dpara(p0, p1, p3);
  const A3 = dpara(p0, p2, p3);
  // A4 = dpara(p1, p2, p3);
  const A4 = A1 + A3 - A2;

  if (A2 === A1) return 1; // this should never happen

  let t = A3 / (A3 - A4);
  const s = A2 / (A2 - A1);
  const A = (A2 * t) / 2.0;

  if (A === 0.0) return 1; // this should never happen

  const R = area / A; // relative area
  const alpha = 2 - Math.sqrt(4 - R / 0.3); // overall alpha for p0-o-p3 curve

  res.c[0] = interval(t * alpha, p0, p1);
  res.c[1] = interval(s * alpha, p3, p2);
  res.alpha = alpha;
  res.t = t;
  res.s = s;

  p1 = res.c[0]!;
  p2 = res.c[1]!; // the proposed curve is now (p0,p1,p2,p3)

  res.pen = 0;

  // calculate penalty
  // check tangency with edges
  for (k = mod(i + 1, m); k !== j; k = k1) {
    k1 = mod(k + 1, m);
    t = tangent(p0, p1, p2, p3, vertex[k]!, vertex[k1]!);

    if (t < -0.5) return 1;

    const pt = bezier(t, p0, p1, p2, p3);
    d = ddist(vertex[k]!, vertex[k1]!);

    if (d === 0.0) return 1; // this should never happen

    const d1 = dpara(vertex[k]!, vertex[k1]!, pt) / d;

    if (Math.abs(d1) > opttolerance) return 1;

    if (iprod(vertex[k]!, vertex[k1]!, pt) < 0 || iprod(vertex[k1]!, vertex[k]!, pt) < 0) return 1;

    res.pen += sq(d1);
  }

  // check corners
  for (k = i; k !== j; k = k1) {
    k1 = mod(k + 1, m);
    t = tangent(p0, p1, p2, p3, cc[k]![2]!, cc[k1]![2]!);

    if (t < -0.5) return 1;

    const pt = bezier(t, p0, p1, p2, p3);
    d = ddist(cc[k]![2]!, cc[k1]![2]!);

    if (d === 0.0) return 1; // this should never happen

    let d1 = dpara(cc[k]![2]!, cc[k1]![2]!, pt) / d;
    let d2 = dpara(cc[k]![2]!, cc[k1]![2]!, vertex[k1]!) / d;
    d2 *= 0.75 * pp.curve.alpha[k1]!;

    if (d2 < 0) {
      d1 = -d1;
      d2 = -d2;
    }

    if (d1 < d2 - opttolerance) return 1;

    if (d1 < d2) res.pen += sq(d1 - d2);
  }

  return 0;
}

/**
 * `opticurve( pp, opttolerance )`: optimize the path p, replacing sequences
 * of Bezier segments by a single segment when possible.
 */
function opticurve(pp: privpath_t, opttolerance: number): number {
  const m = pp.curve.n;
  const pt = new Array<number>(m + 1).fill(0); // pt[m+1]
  const pen = new Array<number>(m + 1).fill(0); // pen[m+1]
  const len = new Array<number>(m + 1).fill(0); // len[m+1]
  const opt: opti_t[] = Array.from({ length: m + 1 }, newOpti); // opt[m+1]
  const o = newOpti();
  const convc = new Array<number>(m).fill(0); // conv[m]: pre-computed convexities
  const areac = new Array<number>(m + 1).fill(0); // cumarea[m+1]: cache for fast area computation

  // pre-calculate convexity: +1 = right turn, -1 = left turn, 0 = corner
  for (let i = 0; i < m; i++) {
    if (pp.curve.tag[i] === POTRACE_CURVETO) {
      convc[i] = sign(
        dpara(
          pp.curve.vertex[mod(i - 1, m)]!,
          pp.curve.vertex[i]!,
          pp.curve.vertex[mod(i + 1, m)]!,
        ),
      );
    } else {
      convc[i] = 0;
    }
  }

  // pre-calculate areas
  let area = 0.0;
  areac[0] = 0.0;
  const p0 = pp.curve.vertex[0]!;

  for (let i = 0; i < m; i++) {
    const i1 = mod(i + 1, m);

    if (pp.curve.tag[i1] === POTRACE_CURVETO) {
      const alpha = pp.curve.alpha[i1]!;
      area +=
        (0.3 *
          alpha *
          (4 - alpha) *
          dpara(pp.curve.c[i]![2]!, pp.curve.vertex[i1]!, pp.curve.c[i1]![2]!)) /
        2;
      area += dpara(p0, pp.curve.c[i]![2]!, pp.curve.c[i1]![2]!) / 2;
    }

    areac[i + 1] = area;
  }

  pt[0] = -1;
  pen[0] = 0;
  len[0] = 0;

  /* Fixme: we always start from a fixed point -- should find the best curve
   * cyclically */
  for (let j = 1; j <= m; j++) {
    // calculate best path from 0 to j
    pt[j] = j - 1;
    pen[j] = pen[j - 1]!;
    len[j] = len[j - 1]! + 1;

    for (let i = j - 2; i >= 0; i--) {
      const r = opti_penalty(pp, i, mod(j, m), o, opttolerance, convc, areac);

      if (r) break;

      if (len[j]! > len[i]! + 1 || (len[j] === len[i]! + 1 && pen[j]! > pen[i]! + o.pen)) {
        pt[j] = i;
        pen[j] = pen[i]! + o.pen;
        len[j] = len[i]! + 1;
        opt[j] = copyOpti(o);
      }
    }
  }

  const om = len[m]!;
  privcurve_init(pp.ocurve, om);
  const s = new Array<number>(om).fill(0);
  const t = new Array<number>(om).fill(0);

  let j = m;

  for (let i = om - 1; i >= 0; i--) {
    if (pt[j] === j - 1) {
      pp.ocurve.tag[i] = pp.curve.tag[mod(j, m)]!;
      pp.ocurve.c[i]![0] = { ...pp.curve.c[mod(j, m)]![0]! };
      pp.ocurve.c[i]![1] = { ...pp.curve.c[mod(j, m)]![1]! };
      pp.ocurve.c[i]![2] = { ...pp.curve.c[mod(j, m)]![2]! };
      pp.ocurve.vertex[i] = { ...pp.curve.vertex[mod(j, m)]! };
      pp.ocurve.alpha[i] = pp.curve.alpha[mod(j, m)]!;
      pp.ocurve.alpha0[i] = pp.curve.alpha0[mod(j, m)]!;
      pp.ocurve.beta[i] = pp.curve.beta[mod(j, m)]!;
      s[i] = t[i] = 1.0;
    } else {
      pp.ocurve.tag[i] = POTRACE_CURVETO;
      pp.ocurve.c[i]![0] = { ...opt[j]!.c[0]! };
      pp.ocurve.c[i]![1] = { ...opt[j]!.c[1]! };
      pp.ocurve.c[i]![2] = { ...pp.curve.c[mod(j, m)]![2]! };
      pp.ocurve.vertex[i] = interval(
        opt[j]!.s,
        pp.curve.c[mod(j, m)]![2]!,
        pp.curve.vertex[mod(j, m)]!,
      );
      pp.ocurve.alpha[i] = opt[j]!.alpha;
      pp.ocurve.alpha0[i] = opt[j]!.alpha;
      s[i] = opt[j]!.s;
      t[i] = opt[j]!.t;
    }

    j = pt[j]!;
  }

  // calculate beta parameters
  for (let i = 0; i < om; i++) {
    const i1 = mod(i + 1, om);
    pp.ocurve.beta[i] = s[i]! / (s[i]! + t[i1]!);
  }

  pp.ocurve.alphacurve = 1;

  return 0;
}

/* ---------------------------------------------------------------------- */

/**
 * `process_path( plist, param, progress )`: run every stage on each path of
 * the list and publish its final curve. Returns 0 on success.
 */
export function process_path(plist: path_t | null, param: potrace_param_t): number {
  // call downstream function with each path
  for (let p = plist; p !== null; p = p.next) {
    calc_sums(p.priv);
    calc_lon(p.priv);
    bestpolygon(p.priv);
    adjust_vertices(p.priv);

    // reverse orientation of negative paths
    if (p.sign === '-') reverse(p.priv.curve);

    smooth(p.priv.curve, param.alphamax);

    if (param.opticurve) {
      opticurve(p.priv, param.opttolerance);
      p.priv.fcurve = p.priv.ocurve;
    } else {
      p.priv.fcurve = p.priv.curve;
    }

    privcurve_to_curve(p.priv.fcurve, p.curve);
  }

  return 0;
}
