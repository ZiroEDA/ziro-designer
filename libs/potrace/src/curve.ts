// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2001-2017 Peter Selinger. Ported by ZiroEDA and contributors.
/**
 * `thirdparty/potrace/src/curve.cpp` + `include/curve.h`: the private path
 * and curve records, and their constructors.
 *
 * `path_free`, `pathlist_free` and `privcurve_free_members` release C memory;
 * the garbage collector does that here, so they are absent.
 */
import type { dpoint_t, point_t } from '../include/auxiliary.js';
import type { potrace_curve_t, potrace_path_t } from './potracelib.js';

/** `privcurve_t`. */
export interface privcurve_t {
  /** number of segments */
  n: number;
  /** tag[n]: POTRACE_CORNER or POTRACE_CURVETO */
  tag: number[];
  /** c[n][i]: control points. c[n][0] is unused for tag[n]=POTRACE_CORNER */
  c: dpoint_t[][];
  /** have the following fields been initialized? */
  alphacurve: number;
  /** for POTRACE_CORNER, this equals c[1] */
  vertex: dpoint_t[];
  /** only for POTRACE_CURVETO */
  alpha: number[];
  /** "uncropped" alpha parameter - for debug output only */
  alpha0: number[];
  beta: number[];
}

/** `sums_t`. */
export interface sums_t {
  x: number;
  y: number;
  x2: number;
  xy: number;
  y2: number;
}

/** `potrace_privpath_t`, alias `privpath_t`. */
export interface privpath_t {
  len: number;
  /** pt[len]: path as extracted from bitmap */
  pt: point_t[];
  /** lon[len]: (i,lon[i]) = longest straight line from i */
  lon: number[];
  /** origin for sums */
  x0: number;
  y0: number;
  /** sums[len+1]: cache for fast summing */
  sums: sums_t[];
  /** length of optimal polygon */
  m: number;
  /** po[m]: optimal polygon */
  po: number[];
  /** curve[m]: array of curve elements */
  curve: privcurve_t;
  /** ocurve[om]: array of curve elements */
  ocurve: privcurve_t;
  /** final curve: this points to either curve or ocurve. */
  fcurve: privcurve_t | null;
}

/** `path_t` is `potrace_path_t`. */
export type path_t = potrace_path_t;

const zeroPoint = (): dpoint_t => ({ x: 0, y: 0 });

/** A `privcurve_t` after `memset( curve, 0, ... )`. */
function emptyCurve(): privcurve_t {
  return { n: 0, tag: [], c: [], alphacurve: 0, vertex: [], alpha: [], alpha0: [], beta: [] };
}

/** `path_new()`: a zeroed path with a zeroed private part. */
export function path_new(): path_t {
  const priv: privpath_t = {
    len: 0,
    pt: [],
    lon: [],
    x0: 0,
    y0: 0,
    sums: [],
    m: 0,
    po: [],
    curve: emptyCurve(),
    ocurve: emptyCurve(),
    fcurve: null,
  };

  return {
    area: 0,
    sign: '',
    curve: { n: 0, tag: [], c: [] },
    next: null,
    childlist: null,
    sibling: null,
    priv,
  };
}

/**
 * `privcurve_init( curve, n )`: `memset` to zero, then `calloc` every array,
 * so each starts at 0 / the origin. Always succeeds here.
 */
export function privcurve_init(curve: privcurve_t, n: number): number {
  Object.assign(curve, emptyCurve());
  curve.n = n;
  curve.tag = new Array<number>(n).fill(0);
  curve.c = Array.from({ length: n }, () => [zeroPoint(), zeroPoint(), zeroPoint()]);
  curve.vertex = Array.from({ length: n }, zeroPoint);
  curve.alpha = new Array<number>(n).fill(0);
  curve.alpha0 = new Array<number>(n).fill(0);
  curve.beta = new Array<number>(n).fill(0);
  return 0;
}

/** `privcurve_to_curve( pc, c )`: share `n`, `tag` and `c` with the public curve. */
export function privcurve_to_curve(pc: privcurve_t, c: potrace_curve_t): void {
  c.n = pc.n;
  c.tag = pc.tag;
  c.c = pc.c;
}
