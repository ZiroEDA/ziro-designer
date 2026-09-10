// SPDX-License-Identifier: BSL-1.0
// Clipper2 1.3.0, Angus Johnson 2010-2023 (http://www.angusj.com), ported to
// TypeScript for ZiroEDA. Boost Software License 1.0.
/**
 * `clipper.offset.cpp`: path inflation/shrinking, as KiCad 10.0.5 ships it.
 * Names follow upstream so the two read side by side; USINGZ only copies a
 * Z tag along and is left out. The delta callback is not used by KiCad and
 * is not ported.
 */

import {
  type Path64,
  type PathD,
  type Paths64,
  type Point64,
  type PointD,
  type Rect64,
  ClipType,
  EndType,
  FillRule,
  INT64_MAX,
  INT64_MIN,
  JoinType,
  MAX_COORD,
  MIN_COORD,
  PI,
  area,
  crossProductD,
  dotProductD,
  invalidRect64,
  point64,
  ptEq,
  rect64,
  rectAsPath,
  rectHeight,
  rectIsValid,
  rectWidth,
  stripDuplicates,
} from './clipper.core.js';
import { type PolyTree64, Clipper64 } from './clipper.engine.js';
import { acos, atan2, cos, hypot, log10, sin } from '../math/libm.js';

const default_arc_tolerance = 0.25;
const floating_point_tolerance = 1e-12;

const toggleBoolIf = (val: boolean, condition: boolean): boolean => (condition ? !val : val);

function getMultiBounds(paths: Paths64, recList: Rect64[]): void {
  for (const path of paths) {
    if (path.length < 1) {
      recList.push(invalidRect64());
      continue;
    }
    const x = path[0]!.x;
    const y = path[0]!.y;
    const r = rect64(x, y, x, y);
    for (const pt of path) {
      if (pt.y > r.bottom) r.bottom = pt.y;
      else if (pt.y < r.top) r.top = pt.y;
      if (pt.x > r.right) r.right = pt.x;
      else if (pt.x < r.left) r.left = pt.x;
    }
    recList.push(r);
  }
}

function validateBounds(recList: Rect64[], delta: number): boolean {
  const int_delta = Math.trunc(delta);
  const big = MAX_COORD - int_delta;
  const small = MIN_COORD + int_delta;
  for (const r of recList) {
    if (!rectIsValid(r)) continue;
    if (r.left < small || r.right > big || r.top < small || r.bottom > big) return false;
  }
  return true;
}

function getLowestClosedPathIdx(boundsList: Rect64[]): number {
  let i = -1;
  let result = -1;
  const botPt: Point64 = { x: INT64_MAX, y: INT64_MIN };
  for (const r of boundsList) {
    ++i;
    if (!rectIsValid(r)) continue;
    if (r.bottom > botPt.y || (r.bottom === botPt.y && r.left < botPt.x)) {
      botPt.x = r.left;
      botPt.y = r.bottom;
      result = i;
    }
  }
  return result;
}

function getUnitNormal(pt1: Point64, pt2: Point64): PointD {
  if (ptEq(pt1, pt2)) return { x: 0, y: 0 };
  let dx = pt2.x - pt1.x;
  let dy = pt2.y - pt1.y;
  const inverse_hypot = 1.0 / hypot(dx, dy);
  dx *= inverse_hypot;
  dy *= inverse_hypot;
  return { x: dy, y: -dx };
}

const almostZero = (value: number, epsilon = 0.001): boolean => Math.abs(value) < epsilon;

/** `Hypot`: the offsetter's own, `sqrt(x*x + y*y)` — not libm's. */
const hypotNaive = (x: number, y: number): number => Math.sqrt(x * x + y * y);

function normalizeVector(vec: PointD): PointD {
  const h = hypotNaive(vec.x, vec.y);
  if (almostZero(h)) return { x: 0, y: 0 };
  const inverseHypot = 1 / h;
  return { x: vec.x * inverseHypot, y: vec.y * inverseHypot };
}

const getAvgUnitVector = (vec1: PointD, vec2: PointD): PointD =>
  normalizeVector({ x: vec1.x + vec2.x, y: vec1.y + vec2.y });

const getPerpendic = (pt: Point64, norm: PointD, delta: number): Point64 =>
  point64(pt.x + norm.x * delta, pt.y + norm.y * delta);

const getPerpendicD = (pt: Point64, norm: PointD, delta: number): PointD => ({
  x: pt.x + norm.x * delta,
  y: pt.y + norm.y * delta,
});

function negatePath(path: PathD): void {
  for (const pt of path) {
    pt.x = -pt.x;
    pt.y = -pt.y;
  }
}

const translatePoint = (pt: PointD, dx: number, dy: number): PointD => ({
  x: pt.x + dx,
  y: pt.y + dy,
});

const reflectPoint = (pt: PointD, pivot: PointD): PointD => ({
  x: pivot.x + (pivot.x - pt.x),
  y: pivot.y + (pivot.y - pt.y),
});

function intersectPoint(pt1a: PointD, pt1b: PointD, pt2a: PointD, pt2b: PointD): PointD {
  if (pt1a.x === pt1b.x) {
    if (pt2a.x === pt2b.x) return { x: 0, y: 0 };
    const m2 = (pt2b.y - pt2a.y) / (pt2b.x - pt2a.x);
    const b2 = pt2a.y - m2 * pt2a.x;
    return { x: pt1a.x, y: m2 * pt1a.x + b2 };
  }
  if (pt2a.x === pt2b.x) {
    const m1 = (pt1b.y - pt1a.y) / (pt1b.x - pt1a.x);
    const b1 = pt1a.y - m1 * pt1a.x;
    return { x: pt2a.x, y: m1 * pt2a.x + b1 };
  }
  const m1 = (pt1b.y - pt1a.y) / (pt1b.x - pt1a.x);
  const b1 = pt1a.y - m1 * pt1a.x;
  const m2 = (pt2b.y - pt2a.y) / (pt2b.x - pt2a.x);
  const b2 = pt2a.y - m2 * pt2a.x;
  if (m1 === m2) return { x: 0, y: 0 };
  const x = (b2 - b1) / (m1 - m2);
  return { x, y: m1 * x + b1 };
}

/** `Ellipse` from clipper.h, as the single-point offset calls it. */
export function ellipse(center: Point64, radiusX: number, radiusY = 0, steps = 0): Path64 {
  if (radiusX <= 0) return [];
  if (radiusY <= 0) radiusY = radiusX;
  if (steps <= 2) steps = Math.trunc(PI * Math.sqrt((radiusX + radiusY) / 2));
  const si = sin((2 * PI) / steps);
  const co = cos((2 * PI) / steps);
  let dx = co;
  let dy = si;
  const result: Path64 = [];
  result.push(point64(center.x + radiusX, center.y));
  for (let i = 1; i < steps; ++i) {
    result.push(point64(center.x + radiusX * dx, center.y + radiusY * dy));
    const x = dx * co - dy * si;
    dy = dy * co + dx * si;
    dx = x;
  }
  return result;
}

class Group {
  paths_in: Paths64;
  is_hole_list: boolean[] = [];
  bounds_list: Rect64[] = [];
  lowest_path_idx = -1;
  is_reversed = false;

  constructor(
    paths: Paths64,
    readonly join_type: JoinType,
    readonly end_type: EndType,
  ) {
    const is_joined = end_type === EndType.Polygon || end_type === EndType.Joined;
    this.paths_in = paths.map((p) => stripDuplicates(p, is_joined));

    getMultiBounds(this.paths_in, this.bounds_list);

    if (end_type === EndType.Polygon) {
      for (const path of this.paths_in) this.is_hole_list.push(area(path) < 0);
      this.lowest_path_idx = getLowestClosedPathIdx(this.bounds_list);
      // the lowermost path must be an outer path, so if its orientation is negative,
      // then flag the whole group is 'reversed' (will negate delta etc.)
      this.is_reversed = this.lowest_path_idx >= 0 && this.is_hole_list[this.lowest_path_idx]!;
      if (this.is_reversed) this.is_hole_list = this.is_hole_list.map((h) => !h);
    } else {
      this.lowest_path_idx = -1;
      this.is_reversed = false;
      this.is_hole_list = this.paths_in.map(() => false);
    }
  }
}

export class ClipperOffset {
  private delta_ = 0.0;
  private group_delta_ = 0.0;
  private temp_lim_ = 0.0;
  private steps_per_rad_ = 0.0;
  private step_sin_ = 0.0;
  private step_cos_ = 0.0;
  private join_type_ = JoinType.Square;
  private end_type_ = EndType.Polygon;

  private miter_limit_: number;
  private arc_tolerance_: number;
  private preserve_collinear_: boolean;
  private reverse_solution_: boolean;
  private error_code_ = 0;
  private readonly groups_: Group[] = [];
  private norms: PathD = [];
  private path_out: Path64 = [];
  private solution: Paths64 = [];

  constructor(
    miter_limit = 2.0,
    arc_tolerance = 0.0,
    preserve_collinear = false,
    reverse_solution = false,
  ) {
    this.miter_limit_ = miter_limit;
    this.arc_tolerance_ = arc_tolerance;
    this.preserve_collinear_ = preserve_collinear;
    this.reverse_solution_ = reverse_solution;
  }

  errorCode(): number {
    return this.error_code_;
  }
  miterLimit(v: number): void {
    this.miter_limit_ = v;
  }
  arcTolerance(v: number): void {
    this.arc_tolerance_ = v;
  }
  preserveCollinear(v: boolean): void {
    this.preserve_collinear_ = v;
  }
  reverseSolution(v: boolean): void {
    this.reverse_solution_ = v;
  }
  clear(): void {
    this.groups_.length = 0;
    this.norms = [];
  }

  addPath(path: Path64, jt_: JoinType, et_: EndType): void {
    this.addPaths([path], jt_, et_);
  }

  addPaths(paths: Paths64, jt_: JoinType, et_: EndType): void {
    if (paths.length === 0) return;
    this.groups_.push(new Group(paths, jt_, et_));
  }

  private buildNormals(path: Path64): void {
    this.norms = [];
    if (path.length === 0) return;
    const stop = path.length - 1;
    for (let i = 0; i !== stop; ++i) this.norms.push(getUnitNormal(path[i]!, path[i + 1]!));
    this.norms.push(getUnitNormal(path[stop]!, path[0]!));
  }

  private doBevel(path: Path64, j: number, k: number): void {
    let pt1: PointD;
    let pt2: PointD;
    const norms = this.norms;
    if (j === k) {
      const abs_delta = Math.abs(this.group_delta_);
      pt1 = { x: path[j]!.x - abs_delta * norms[j]!.x, y: path[j]!.y - abs_delta * norms[j]!.y };
      pt2 = { x: path[j]!.x + abs_delta * norms[j]!.x, y: path[j]!.y + abs_delta * norms[j]!.y };
    } else {
      pt1 = {
        x: path[j]!.x + this.group_delta_ * norms[k]!.x,
        y: path[j]!.y + this.group_delta_ * norms[k]!.y,
      };
      pt2 = {
        x: path[j]!.x + this.group_delta_ * norms[j]!.x,
        y: path[j]!.y + this.group_delta_ * norms[j]!.y,
      };
    }
    this.path_out.push(point64(pt1.x, pt1.y));
    this.path_out.push(point64(pt2.x, pt2.y));
  }

  private doSquare(path: Path64, j: number, k: number): void {
    const norms = this.norms;
    let vec: PointD;
    if (j === k) vec = { x: norms[j]!.y, y: -norms[j]!.x };
    else
      vec = getAvgUnitVector(
        { x: -norms[k]!.y, y: norms[k]!.x },
        { x: norms[j]!.y, y: -norms[j]!.x },
      );

    const abs_delta = Math.abs(this.group_delta_);
    const gd = this.group_delta_;

    // now offset the original vertex delta units along unit vector
    let ptQ: PointD = { x: path[j]!.x, y: path[j]!.y };
    ptQ = translatePoint(ptQ, abs_delta * vec.x, abs_delta * vec.y);
    // get perpendicular vertices
    const pt1 = translatePoint(ptQ, gd * vec.y, gd * -vec.x);
    const pt2 = translatePoint(ptQ, gd * -vec.y, gd * vec.x);
    // get 2 vertices along one edge offset
    const pt3 = getPerpendicD(path[k]!, norms[k]!, gd);
    if (j === k) {
      const pt4: PointD = { x: pt3.x + vec.x * gd, y: pt3.y + vec.y * gd };
      const pt = intersectPoint(pt1, pt2, pt3, pt4);
      //get the second intersect point through reflecion
      const r = reflectPoint(pt, ptQ);
      this.path_out.push(point64(r.x, r.y));
      this.path_out.push(point64(pt.x, pt.y));
    } else {
      const pt4 = getPerpendicD(path[j]!, norms[k]!, gd);
      const pt = intersectPoint(pt1, pt2, pt3, pt4);
      this.path_out.push(point64(pt.x, pt.y));
      //get the second intersect point through reflecion
      const r = reflectPoint(pt, ptQ);
      this.path_out.push(point64(r.x, r.y));
    }
  }

  private doMiter(path: Path64, j: number, k: number, cos_a: number): void {
    const norms = this.norms;
    const q = this.group_delta_ / (cos_a + 1);
    this.path_out.push(
      point64(
        path[j]!.x + (norms[k]!.x + norms[j]!.x) * q,
        path[j]!.y + (norms[k]!.y + norms[j]!.y) * q,
      ),
    );
  }

  private doRound(path: Path64, j: number, k: number, angle: number): void {
    const norms = this.norms;
    const pt = path[j]!;
    let offsetVec: PointD = {
      x: norms[k]!.x * this.group_delta_,
      y: norms[k]!.y * this.group_delta_,
    };

    if (j === k) offsetVec = { x: -offsetVec.x, y: -offsetVec.y };
    this.path_out.push(point64(pt.x + offsetVec.x, pt.y + offsetVec.y));
    const steps = Math.trunc(Math.ceil(this.steps_per_rad_ * Math.abs(angle))); // #448, #456
    for (let i = 1; i < steps; ++i) {
      // ie 1 less than steps
      offsetVec = {
        x: offsetVec.x * this.step_cos_ - this.step_sin_ * offsetVec.y,
        y: offsetVec.x * this.step_sin_ + offsetVec.y * this.step_cos_,
      };
      this.path_out.push(point64(pt.x + offsetVec.x, pt.y + offsetVec.y));
    }
    this.path_out.push(getPerpendic(path[j]!, norms[j]!, this.group_delta_));
  }

  private offsetPoint(path: Path64, j: number, k: number): void {
    // Let A = change in angle where edges join
    // A == 0: ie no change in angle (flat join)
    // A == PI: edges 'spike'
    // sin(A) < 0: right turning
    // cos(A) < 0: change in angle is more than 90 degree
    if (ptEq(path[j]!, path[k]!)) return;

    const norms = this.norms;
    let sin_a = crossProductD(norms[j]!, norms[k]!);
    const cos_a = dotProductD(norms[j]!, norms[k]!);
    if (sin_a > 1.0) sin_a = 1.0;
    else if (sin_a < -1.0) sin_a = -1.0;

    if (Math.abs(this.group_delta_) <= floating_point_tolerance) {
      this.path_out.push({ x: path[j]!.x, y: path[j]!.y });
      return;
    }

    if (cos_a > -0.99 && sin_a * this.group_delta_ < 0) {
      // test for concavity first (#593)
      // is concave
      this.path_out.push(getPerpendic(path[j]!, norms[k]!, this.group_delta_));
      // this extra point is the only (simple) way to ensure that
      // path reversals are fully cleaned with the trailing clipper
      this.path_out.push({ x: path[j]!.x, y: path[j]!.y }); // (#405)
      this.path_out.push(getPerpendic(path[j]!, norms[j]!, this.group_delta_));
    } else if (cos_a > 0.999 && this.join_type_ !== JoinType.Round) {
      // almost straight - less than 2.5 degree (#424, #482, #526 & #724)
      this.doMiter(path, j, k, cos_a);
    } else if (this.join_type_ === JoinType.Miter) {
      // miter unless the angle is sufficiently acute to exceed ML
      if (cos_a > this.temp_lim_ - 1) this.doMiter(path, j, k, cos_a);
      else this.doSquare(path, j, k);
    } else if (this.join_type_ === JoinType.Round) this.doRound(path, j, k, atan2(sin_a, cos_a));
    else if (this.join_type_ === JoinType.Bevel) this.doBevel(path, j, k);
    else this.doSquare(path, j, k);
  }

  private offsetPolygon(path: Path64): void {
    this.path_out = [];
    for (let j = 0, k = path.length - 1; j < path.length; k = j, ++j) this.offsetPoint(path, j, k);
    this.solution.push(this.path_out);
  }

  private offsetOpenJoined(path: Path64): void {
    this.offsetPolygon(path);
    const reverse_path = path.slice().reverse();

    //rebuild normals // BuildNormals(path);
    this.norms.reverse();
    this.norms.push(this.norms[0]!);
    this.norms.shift();
    negatePath(this.norms);

    this.offsetPolygon(reverse_path);
  }

  private offsetOpenPath(path: Path64): void {
    // do the line start cap
    if (Math.abs(this.group_delta_) <= floating_point_tolerance)
      this.path_out.push({ x: path[0]!.x, y: path[0]!.y });
    else {
      switch (this.end_type_) {
        case EndType.Butt:
          this.doBevel(path, 0, 0);
          break;
        case EndType.Round:
          this.doRound(path, 0, 0, PI);
          break;
        default:
          this.doSquare(path, 0, 0);
          break;
      }
    }

    const highI = path.length - 1;
    // offset the left side going forward
    for (let j = 1, k = 0; j < highI; k = j, ++j) this.offsetPoint(path, j, k);

    // reverse normals
    const norms = this.norms;
    for (let i = highI; i > 0; --i) norms[i] = { x: -norms[i - 1]!.x, y: -norms[i - 1]!.y };
    norms[0] = norms[highI]!;

    // do the line end cap
    if (Math.abs(this.group_delta_) <= floating_point_tolerance)
      this.path_out.push({ x: path[highI]!.x, y: path[highI]!.y });
    else {
      switch (this.end_type_) {
        case EndType.Butt:
          this.doBevel(path, highI, highI);
          break;
        case EndType.Round:
          this.doRound(path, highI, highI, PI);
          break;
        default:
          this.doSquare(path, highI, highI);
          break;
      }
    }

    for (let j = highI, k = 0; j > 0; k = j, --j) this.offsetPoint(path, j, k);
    this.solution.push(this.path_out);
  }

  private doGroupOffset(group: Group): void {
    if (group.end_type === EndType.Polygon) {
      // a straight path (2 points) can now also be 'polygon' offset
      // where the ends will be treated as (180 deg.) joins
      if (group.lowest_path_idx < 0) this.delta_ = Math.abs(this.delta_);
      this.group_delta_ = group.is_reversed ? -this.delta_ : this.delta_;
    } else this.group_delta_ = Math.abs(this.delta_); // *0.5;

    const abs_delta = Math.abs(this.group_delta_);
    if (!validateBounds(group.bounds_list, abs_delta)) {
      this.error_code_ |= 1; // range_error_i
      return;
    }

    this.join_type_ = group.join_type;
    this.end_type_ = group.end_type;

    if (group.join_type === JoinType.Round || group.end_type === EndType.Round) {
      // calculate a sensible number of steps (for 360 deg for the given offset)
      // arcTol - when arc_tolerance_ is undefined (0), the amount of
      // curve imprecision that's allowed is based on the size of the
      // offset (delta). Obviously very large offsets will almost always
      // require much less precision. See also offset_triginometry2.svg
      const arcTol =
        this.arc_tolerance_ > floating_point_tolerance
          ? Math.min(abs_delta, this.arc_tolerance_)
          : log10(2 + abs_delta) * default_arc_tolerance;

      const steps_per_360 = Math.min(PI / acos(1 - arcTol / abs_delta), abs_delta * PI);
      this.step_sin_ = sin((2 * PI) / steps_per_360);
      this.step_cos_ = cos((2 * PI) / steps_per_360);
      if (this.group_delta_ < 0.0) this.step_sin_ = -this.step_sin_;
      this.steps_per_rad_ = steps_per_360 / (2 * PI);
    }

    for (let i = 0; i < group.paths_in.length; ++i) {
      const path_rect = group.bounds_list[i]!;
      const is_hole = group.is_hole_list[i]!;
      const path_in = group.paths_in[i]!;
      if (!rectIsValid(path_rect)) continue;
      const pathLen = path_in.length;
      this.path_out = [];

      if (pathLen === 1) {
        // single point
        if (this.group_delta_ < 1) continue;
        const pt = path_in[0]!;
        //single vertex so build a circle or square ...
        if (group.join_type === JoinType.Round) {
          const radius = abs_delta;
          const steps = Math.trunc(Math.ceil(this.steps_per_rad_ * 2 * PI)); //#617
          this.path_out = ellipse(pt, radius, radius, steps);
        } else {
          const d = Math.trunc(Math.ceil(abs_delta));
          const r = rect64(pt.x - d, pt.y - d, pt.x + d, pt.y + d);
          this.path_out = rectAsPath(r);
        }
        this.solution.push(this.path_out);
        continue;
      } // end of offsetting a single point

      // when shrinking outer paths, make sure they can shrink this far (#593)
      // also when shrinking holes, make sure they too can shrink this far (#715)
      if (
        this.group_delta_ > 0 === toggleBoolIf(is_hole, group.is_reversed) &&
        Math.min(rectWidth(path_rect), rectHeight(path_rect)) <= -this.group_delta_ * 2
      )
        continue;

      if (pathLen === 2 && group.end_type === EndType.Joined)
        this.end_type_ = group.join_type === JoinType.Round ? EndType.Round : EndType.Square;

      this.buildNormals(path_in);
      if (this.end_type_ === EndType.Polygon) this.offsetPolygon(path_in);
      else if (this.end_type_ === EndType.Joined) this.offsetOpenJoined(path_in);
      else this.offsetOpenPath(path_in);
    }
  }

  private checkReverseOrientation(): boolean {
    // nb: this assumes there's consistency in orientation between groups
    let is_reversed_orientation = false;
    for (const g of this.groups_)
      if (g.end_type === EndType.Polygon) {
        is_reversed_orientation = g.is_reversed;
        break;
      }
    return is_reversed_orientation;
  }

  private executeInternal(delta: number): void {
    this.error_code_ = 0;
    this.solution = [];
    if (this.groups_.length === 0) return;

    if (Math.abs(delta) < 0.5) {
      // ie: offset is insignificant
      for (const group of this.groups_) for (const p of group.paths_in) this.solution.push(p);
      return;
    }

    this.temp_lim_ = this.miter_limit_ <= 1 ? 2.0 : 2.0 / (this.miter_limit_ * this.miter_limit_);

    this.delta_ = delta;
    for (const g of this.groups_) {
      this.doGroupOffset(g);
      if (!this.error_code_) continue; // all OK
      this.solution = [];
    }
  }

  private trailingClipper(): { c: Clipper64; paths_reversed: boolean } | null {
    this.executeInternal(this.delta_);
    if (!this.solution.length) return null;

    const paths_reversed = this.checkReverseOrientation();
    //clean up self-intersections ...
    const c = new Clipper64();
    c.preserveCollinear(false);
    //the solution should retain the orientation of the input
    c.reverseSolution(this.reverse_solution_ !== paths_reversed);
    c.addSubject(this.solution);
    return { c, paths_reversed };
  }

  /** `Execute( double delta, Paths64& paths )`. */
  executePaths(delta: number): Paths64 {
    this.delta_ = delta;
    const t = this.trailingClipper();
    if (!t) return [];
    return t.c.executePaths(
      ClipType.Union,
      t.paths_reversed ? FillRule.Negative : FillRule.Positive,
    );
  }

  /** `Execute( double delta, PolyTree64& polytree )`. */
  executeTree(delta: number, polytree: PolyTree64): void {
    polytree.clear();
    this.delta_ = delta;
    const t = this.trailingClipper();
    if (!t) return;
    t.c.executeTree(
      ClipType.Union,
      t.paths_reversed ? FillRule.Negative : FillRule.Positive,
      polytree,
    );
  }
}
