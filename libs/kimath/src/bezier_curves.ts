// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * BEZIER_POLY, the flatness-driven tessellator KiCad uses to turn Bezier
 * control points into a polyline. Counterpart: `libs/kimath/src/bezier_curves.cpp`.
 *
 * The cubic path is not a naive uniform subdivision: it follows Hain et al.'s
 * parabolic approximation, splitting at inflection points first and falling back
 * to recursive halving where the parabolic step is not valid. Uniform sampling
 * would put far more points on the flat parts of a teardrop's flank and far
 * fewer on its tight curl, so the two do not produce comparable outlines.
 */

import { KiROUND } from './math/util.js';
import type { Vec2, VECTOR2I } from './math/vector2.js';

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
const sqNorm = (a: Vec2): number => a.x * a.x + a.y * a.y;
const norm = (a: Vec2): number => Math.hypot(a.x, a.y);
/** a + t * (b - a), the de Casteljau lerp used throughout subdivide(). */
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + t * (b.x - a.x),
  y: a.y + t * (b.y - a.y),
});

/** approx_int / approx_inv_int, the quadratic arc-length approximations. */
const approxInt = (x: number): number => {
  const d = 0.6744897501960817;
  const d4 = d * d * d * d;
  return x / (1.0 - d + (d4 + x * x * 0.25) ** 0.25);
};

const approxInvInt = (x: number): number => {
  const p = 0.39538816;
  return x * (1.0 - p + Math.sqrt(p * p + 0.25 * x * x));
};

/** BEZIER_POLY: 3 control points for a quadratic, 4 for a cubic. */
export class BezierPoly {
  ctrlPts: Vec2[];

  constructor(ctrlPts: Vec2[]);
  constructor(start: Vec2, ctrl1: Vec2, ctrl2: Vec2, end: Vec2);
  constructor(a: Vec2[] | Vec2, b?: Vec2, c?: Vec2, d?: Vec2) {
    this.ctrlPts = Array.isArray(a)
      ? a.map((p) => ({ x: p.x, y: p.y }))
      : [a, b!, c!, d!].map((p) => ({ x: p.x, y: p.y }));
  }

  private isNaN(): boolean {
    return this.ctrlPts.some((p) => Number.isNaN(p.x) || Number.isNaN(p.y));
  }

  /** BEZIER_POLY::isFlat. */
  private isFlat(maxError: number): boolean {
    const p = this.ctrlPts;

    if (p.length === 3) {
      const D21 = sub(p[1]!, p[0]!);
      const D31 = sub(p[2]!, p[0]!);
      const t = dot(D21, D31) / sqNorm(D31);
      const u = Math.min(Math.max(t, 0.0), 1.0);
      const q = { x: p[0]!.x + u * D31.x, y: p[0]!.y + u * D31.y };
      return 0.5 * norm(sub(p[1]!, q)) <= maxError;
    }

    const delta = sub(p[3]!, p[0]!);
    const D21 = sub(p[1]!, p[0]!);
    const D31 = sub(p[2]!, p[0]!);

    const cross1 = cross(delta, D21);
    const cross2 = cross(delta, D31);

    const invDeltaSq = 1.0 / sqNorm(delta);
    const d1 = cross1 * cross1 * invDeltaSq;
    const d2 = cross2 * cross2 * invDeltaSq;

    const factor = cross1 * cross2 > 0.0 ? 3.0 / 4.0 : 4.0 / 9.0;
    const f2 = factor * factor;
    const tol = maxError * maxError;

    return d1 * f2 <= tol && d2 * f2 <= tol;
  }

  /** BEZIER_POLY::eval, the curve point at parameter t. */
  private eval(t: number): Vec2 {
    const p = this.ctrlPts;
    const omt = 1.0 - t;
    const omt2 = omt * omt;

    if (p.length === 3) {
      return {
        x: omt2 * p[0]!.x + 2.0 * omt * t * p[1]!.x + t * t * p[2]!.x,
        y: omt2 * p[0]!.y + 2.0 * omt * t * p[1]!.y + t * t * p[2]!.y,
      };
    }

    const omt3 = omt * omt2;
    const t2 = t * t;
    const t3 = t * t2;
    return {
      x: omt3 * p[0]!.x + 3.0 * t * omt2 * p[1]!.x + 3.0 * t2 * omt * p[2]!.x + t3 * p[3]!.x,
      y: omt3 * p[0]!.y + 3.0 * t * omt2 * p[1]!.y + 3.0 * t2 * omt * p[2]!.y + t3 * p[3]!.y,
    };
  }

  /** BEZIER_POLY::subdivide, de Casteljau at t. */
  private subdivide(t: number): [BezierPoly, BezierPoly] {
    const p = this.ctrlPts;

    if (p.length === 3) {
      const shared = this.eval(t);
      return [
        new BezierPoly([p[0]!, lerp(p[0]!, p[1]!, t), shared]),
        new BezierPoly([shared, lerp(p[1]!, p[2]!, t), p[2]!]),
      ];
    }

    const leftCtrl1 = lerp(p[0]!, p[1]!, t);
    const tmp = lerp(p[1]!, p[2]!, t);
    const leftCtrl2 = lerp(leftCtrl1, tmp, t);
    const rightCtrl2 = lerp(p[2]!, p[3]!, t);
    const rightCtrl1 = lerp(tmp, rightCtrl2, t);
    const shared = lerp(leftCtrl2, rightCtrl1, t);

    return [
      new BezierPoly([p[0]!, leftCtrl1, leftCtrl2, shared]),
      new BezierPoly([shared, rightCtrl1, rightCtrl2, p[3]!]),
    ];
  }

  /** BEZIER_POLY::numberOfInflectionPoints; -1 for the ambiguous cases. */
  private numberOfInflectionPoints(): number {
    const p = this.ctrlPts;
    const D21 = sub(p[1]!, p[0]!);
    const D32 = sub(p[2]!, p[1]!);
    const D43 = sub(p[3]!, p[2]!);

    const cross1 = cross(D21, D32) * cross(D32, D43);
    const cross2 = cross(D21, D32) * cross(D21, D43);

    if (cross1 < 0.0) return 1;
    if (cross2 > 0.0) return 0;

    const b1 = dot(D21, D32) > 0.0;
    const b2 = dot(D32, D43) > 0.0;

    if (b1 !== b2) return 0;

    // Rare: potentially 2 or 0 inflection points.
    return -1;
  }

  /** BEZIER_POLY::thirdControlPointDeviation. */
  private thirdControlPointDeviation(): number {
    const p = this.ctrlPts;
    const delta = sub(p[1]!, p[0]!);
    const lenSq = sqNorm(delta);

    if (lenSq < 1e-6) return 0.0;

    const len = Math.sqrt(lenSq);
    const r = (p[1]!.y - p[0]!.y) / len;
    const s = (p[0]!.x - p[1]!.x) / len;
    const u = (p[1]!.x * p[0]!.y - p[0]!.x * p[1]!.y) / len;

    return Math.abs(r * p[2]!.x + s * p[2]!.y + u);
  }

  /** BEZIER_POLY::findInflectionPoints; returns the count, filling t1/t2. */
  private findInflectionPoints(): { count: number; t1: number; t2: number } {
    const p = this.ctrlPts;
    const A = {
      x: -p[0]!.x + 3 * p[1]!.x - 3 * p[2]!.x + p[3]!.x,
      y: -p[0]!.y + 3 * p[1]!.y - 3 * p[2]!.y + p[3]!.y,
    };
    const B = {
      x: 3 * p[0]!.x - 6 * p[1]!.x + 3 * p[2]!.x,
      y: 3 * p[0]!.y - 6 * p[1]!.y + 3 * p[2]!.y,
    };
    const C = { x: -3 * p[0]!.x + 3 * p[1]!.x, y: -3 * p[0]!.y + 3 * p[1]!.y };

    const a = 3 * cross(A, B);
    const b = 3 * cross(A, C);
    const c = cross(B, C);

    const r2 = b * b - 4 * a * c;

    if (r2 >= 0.0 && a !== 0.0) {
      const r = Math.sqrt(r2);
      let t1 = (-b + r) / (2 * a);
      let t2 = (-b - r) / (2 * a);

      if (t1 > 0.0 && t1 < 1.0 && t2 > 0.0 && t2 < 1.0) {
        if (t1 > t2) [t1, t2] = [t2, t1];
        return { count: t2 - t1 > 0.00001 ? 2 : 1, t1, t2 };
      }

      if (t1 > 0.0 && t1 < 1.0) return { count: 1, t1, t2: 0.0 };
      if (t2 > 0.0 && t2 < 1.0) return { count: 1, t1: t2, t2: 0.0 };
    }

    return { count: 0, t1: 0.0, t2: 0.0 };
  }

  /** BEZIER_POLY::recursiveSegmentation, plain halving to the flatness bound. */
  private recursiveSegmentation(output: Vec2[], threshold: number): void {
    const stack: BezierPoly[] = [new BezierPoly(this.ctrlPts)];

    while (stack.length > 0) {
      const bezier = stack[stack.length - 1]!;
      const p = bezier.ctrlPts;

      if (p[3]!.x === p[0]!.x && p[3]!.y === p[0]!.y) {
        stack.pop(); // Zero-length segment.
      } else if (bezier.isFlat(threshold)) {
        output.push(p[3]!);
        stack.pop();
      } else {
        const [left, right] = bezier.subdivide(0.5);
        stack[stack.length - 1] = right;
        stack.push(left);
      }
    }
  }

  /** BEZIER_POLY::cubicParabolicApprox, Hain et al. */
  private cubicParabolicApprox(output: Vec2[], maxError: number): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let c: BezierPoly = this;

    for (;;) {
      if (c.isNaN()) break;

      if (c.isFlat(maxError)) {
        output.push(c.ctrlPts[3]!);
        break;
      }

      const d = c.thirdControlPointDeviation();

      // No deviation gives no valid split parameter; halve instead of dividing by zero.
      if (d === 0.0) {
        c.recursiveSegmentation(output, maxError);
        break;
      }

      const t = 2 * Math.sqrt(maxError / (3.0 * d)); // Formula 2 in Hain et al.

      if (t > 1.0) {
        c.recursiveSegmentation(output, maxError);
        break;
      }

      const [b1, b2] = c.subdivide(t);

      // The first subsegment should now be exactly at the flatness bound.
      if (b1.isFlat(maxError)) output.push(b1.ctrlPts[3]!);
      else b1.recursiveSegmentation(output, maxError);

      c = b2;
    }
  }

  /** BEZIER_POLY::getQuadPoly. */
  private getQuadPoly(output: Vec2[], maxError: number): void {
    const p = this.ctrlPts;
    const ddx = 2 * p[1]!.x - p[0]!.x - p[2]!.x;
    const ddy = 2 * p[1]!.y - p[0]!.y - p[2]!.y;
    const u0 = (p[1]!.x - p[0]!.x) * ddx + (p[1]!.y - p[0]!.y) * ddy;
    const u2 = (p[2]!.x - p[1]!.x) * ddx + (p[2]!.y - p[1]!.y) * ddy;
    const crs = (p[2]!.x - p[0]!.x) * ddy - (p[2]!.y - p[0]!.y) * ddx;
    const x0 = u0 / crs;
    const x2 = u2 / crs;
    const scale = Math.abs(crs) / (Math.hypot(ddx, ddy) * Math.abs(x2 - x0));

    const a0 = approxInt(x0);
    const a2 = approxInt(x2);

    const n = Math.ceil(0.5 * Math.abs(a2 - a0) * Math.sqrt(scale / maxError));

    const v0 = approxInvInt(a0);
    const v2 = approxInvInt(a2);

    output.push(p[0]!);

    for (let ii = 0; ii < n; ++ii) {
      const u = approxInvInt(a0 + ((a2 - a0) * ii) / n);
      output.push(this.eval((u - v0) / (v2 - v0)));
    }

    output.push(p[2]!);
  }

  /** BEZIER_POLY::getCubicPoly. */
  private getCubicPoly(output: Vec2[], maxError: number): void {
    output.push(this.ctrlPts[0]!);

    if (this.numberOfInflectionPoints() === 0) {
      this.cubicParabolicApprox(output, maxError);
      return;
    }

    const first = this.findInflectionPoints();

    if (first.count === 2) {
      // Divide at the smallest inflection point first.
      const [sub1, tmp1] = this.subdivide(first.t1);

      sub1.cubicParabolicApprox(output, maxError);

      const second = tmp1.findInflectionPoints();

      if (second.count === 0) {
        output.push(tmp1.ctrlPts[3]!);
        return;
      }

      const [sub2, sub3] = tmp1.subdivide(second.t1);

      // Segment the middle, parabolic-approximate the tail.
      sub2.recursiveSegmentation(output, maxError);
      sub3.cubicParabolicApprox(output, maxError);
    } else if (first.count === 1) {
      const [sub1, sub2] = this.subdivide(first.t1);
      sub1.cubicParabolicApprox(output, maxError);
      sub2.cubicParabolicApprox(output, maxError);
    } else {
      this.cubicParabolicApprox(output, maxError);
    }
  }

  /** BEZIER_POLY::GetPoly( std::vector<VECTOR2D>&, double ). */
  getPolyD(maxError: number): Vec2[] {
    const output: Vec2[] = [];
    const err = maxError <= 0.0 ? 10.0 : maxError;

    if (this.ctrlPts.length === 3) this.getQuadPoly(output, err);
    else if (this.ctrlPts.length === 4) this.getCubicPoly(output, err);

    return output;
  }

  /** BEZIER_POLY::GetPoly( std::vector<VECTOR2I>&, int ), the rounded form. */
  getPoly(maxError: number): VECTOR2I[] {
    return this.getPolyD(maxError).map((p) => ({ x: KiROUND(p.x), y: KiROUND(p.y) }));
  }
}
