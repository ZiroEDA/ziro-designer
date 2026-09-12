// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOX2< Vec >` (`libs/kimath/include/math/box2.h`): a bounding box as an
 * origin plus a size, with the `m_init` flag that makes a default box "no box
 * yet" rather than a point at the origin.
 *
 * The C++ is one template over the vector type; what the type decides is the
 * arithmetic - an `int` box halves by integer division and clamps through
 * `KiCheckedCast< int64_t, int >`, a `double` box does neither. That is the
 * whole difference between {@link BOX2I} and {@link BOX2D}, so it is the one
 * thing the subclasses supply.
 *
 * `coord_type` is a plain number in both; `Vec` is the `{ x, y }` record the
 * rest of kimath uses. Methods that return a box return a NEW box, as the
 * C++ by-value returns do; the chaining mutators (`Normalize`, `Inflate`,
 * `Merge`) return `this`.
 */

import type { Vec2, VECTOR2I } from './vector2.js';
import { KiCheckedCast, INT_MAX, KiROUND } from './util.js';
import {
  ANGLE_0,
  ANGLE_90,
  ANGLE_180,
  ANGLE_270,
  ANGLE_360,
  EDA_ANGLE,
} from '../geometry/eda_angle.js';
import { RotatePoint, SegmentIntersectsSegment } from '../trigo.js';

/** `ROT_EPSILON( 0.000000001, DEGREES_T )`, the "this is really cardinal" tolerance. */
const ROT_EPSILON = new EDA_ANGLE(0.000000001);
const ROT_PARALLEL = [ANGLE_0, ANGLE_180, ANGLE_360];
const ROT_PERPENDICULAR = [ANGLE_0, ANGLE_90, ANGLE_270];

export abstract class BOX2 {
  protected m_Pos: VECTOR2I; // Rectangle Origin
  protected m_Size: VECTOR2I; // Rectangle Size
  protected m_init: boolean; // Is the rectangle initialized

  /**
   * `BOX2()` is the uninitialised box; `BOX2( aPos, aSize )` range-checks the
   * far corner and normalises.
   */
  constructor(aPos?: Vec2, aSize: Vec2 = { x: 0, y: 0 }) {
    if (aPos === undefined) {
      this.m_Pos = { x: 0, y: 0 };
      this.m_Size = { x: 0, y: 0 };
      this.m_init = false;
    } else {
      this.m_Pos = { x: aPos.x, y: aPos.y };
      this.m_Size = { x: aSize.x, y: aSize.y };
      this.m_init = true;
      // Range check
      this.checked(this.m_Pos.x + this.m_Size.x);
      this.checked(this.m_Pos.y + this.m_Size.y);
      this.Normalize();
    }
  }

  // ---- what the vector type decides ------------------------------------

  /** A box of the same kind: the `BOX2<Vec>` copy/return the C++ makes. */
  protected abstract make(aPos?: Vec2, aSize?: Vec2): this;
  /** `KiCheckedCast< ecoord_type, coord_type >`: clamp into `int`, or the identity for doubles. */
  protected abstract checked(v: number): number;
  /** `v / 2` in the coordinate type: integer division for `int`. */
  protected abstract half(v: number): number;

  /** `BOX2( *this )`. */
  Clone(): this {
    const b = this.make();
    b.m_Pos = { x: this.m_Pos.x, y: this.m_Pos.y };
    b.m_Size = { x: this.m_Size.x, y: this.m_Size.y };
    b.m_init = this.m_init;
    return b;
  }

  /** `SetMaximum`: the whole coordinate space, invertible. */
  abstract SetMaximum(): void;

  Centre(): Vec2 {
    return {
      x: this.checked(this.m_Pos.x + this.half(this.m_Size.x)),
      y: this.checked(this.m_Pos.y + this.half(this.m_Size.y)),
    };
  }

  /**
   * Compute the bounding box from a given list of points.
   */
  Compute(aPointList: readonly Vec2[]): void {
    if (!aPointList.length) return;

    let vminx = aPointList[0]!.x;
    let vminy = aPointList[0]!.y;
    let vmaxx = vminx;
    let vmaxy = vminy;

    for (const p of aPointList) {
      vminx = Math.min(vminx, p.x);
      vminy = Math.min(vminy, p.y);
      vmaxx = Math.max(vmaxx, p.x);
      vmaxy = Math.max(vmaxy, p.y);
    }

    this.SetOrigin({ x: vminx, y: vminy });
    this.SetSize({ x: vmaxx - vminx, y: vmaxy - vminy });
  }

  /**
   * Move the rectangle by the \a aMoveVector.
   */
  Move(aMoveVector: Vec2): void {
    this.m_Pos.x += aMoveVector.x;
    this.m_Pos.y += aMoveVector.y;
  }

  /**
   * Ensure that the height and width are positive.
   */
  Normalize(): this {
    if (this.m_Size.y < 0) {
      this.m_Size.y = -this.m_Size.y;
      this.m_Pos.y = this.checked(this.m_Pos.y - this.m_Size.y);
    }

    if (this.m_Size.x < 0) {
      this.m_Size.x = -this.m_Size.x;
      this.m_Pos.x = this.checked(this.m_Pos.x - this.m_Size.x);
    }

    return this;
  }

  /**
   * @return true if \a aPoint is inside the boundary box. A point on a edge is seen as inside.
   */
  Contains(aPoint: Vec2): boolean;
  Contains(x: number, y: number): boolean;
  Contains(aRect: BOX2): boolean;
  Contains(a: Vec2 | number | BOX2, y?: number): boolean {
    if (a instanceof BOX2) return this.Contains(a.GetOrigin()) && this.Contains(a.GetEnd());
    if (typeof a === 'number') return this.Contains({ x: a, y: y! });

    let relx = a.x - this.m_Pos.x;
    let rely = a.y - this.m_Pos.y;
    let sizex = this.m_Size.x;
    let sizey = this.m_Size.y;

    if (sizex < 0) {
      sizex = -sizex;
      relx += sizex;
    }

    if (sizey < 0) {
      sizey = -sizey;
      rely += sizey;
    }

    return relx >= 0 && rely >= 0 && rely <= sizey && relx <= sizex;
  }

  GetSize(): Vec2 {
    return this.m_Size;
  }
  GetX(): number {
    return this.m_Pos.x;
  }
  GetY(): number {
    return this.m_Pos.y;
  }

  GetOrigin(): Vec2 {
    return this.m_Pos;
  }
  GetPosition(): Vec2 {
    return this.m_Pos;
  }
  GetEnd(): VECTOR2I {
    return { x: this.GetRight(), y: this.GetBottom() };
  }

  GetWidth(): number {
    return this.m_Size.x;
  }
  GetHeight(): number {
    return this.m_Size.y;
  }
  GetRight(): number {
    return this.checked(this.m_Pos.x + this.m_Size.x);
  }
  GetBottom(): number {
    return this.checked(this.m_Pos.y + this.m_Size.y);
  }

  // Compatibility aliases
  GetLeft(): number {
    return this.GetX();
  }
  GetTop(): number {
    return this.GetY();
  }
  GetCenter(): Vec2 {
    return this.Centre();
  }

  /**
   * @return the width or height, whichever is greater.
   */
  GetSizeMax(): number {
    return this.m_Size.x > this.m_Size.y ? this.m_Size.x : this.m_Size.y;
  }

  SetOrigin(pos: Vec2): void;
  SetOrigin(x: number, y: number): void;
  SetOrigin(a: Vec2 | number, y?: number): void {
    if (typeof a === 'number') {
      this.SetOrigin({ x: a, y: y! });
      return;
    }
    this.m_Pos = { x: a.x, y: a.y };
    this.m_init = true;
  }

  SetSize(size: Vec2): void;
  SetSize(w: number, h: number): void;
  SetSize(a: Vec2 | number, h?: number): void {
    if (typeof a === 'number') {
      this.SetSize({ x: a, y: h! });
      return;
    }
    this.m_Size = { x: a.x, y: a.y };
    this.m_init = true;
  }

  Offset(dx: number, dy: number): void;
  Offset(offset: Vec2): void;
  Offset(a: Vec2 | number, dy?: number): void {
    if (typeof a === 'number') {
      this.m_Pos.x += a;
      this.m_Pos.y += dy!;
      return;
    }
    this.Offset(a.x, a.y);
  }

  GetWithOffset(aMoveVector: Vec2): this {
    const ret = this.Clone();
    ret.Move(aMoveVector);
    return ret;
  }

  SetX(val: number): void {
    this.SetOrigin(val, this.m_Pos.y);
  }
  SetY(val: number): void {
    this.SetOrigin(this.m_Pos.x, val);
  }
  SetWidth(val: number): void {
    this.SetSize(val, this.m_Size.y);
  }
  SetHeight(val: number): void {
    this.SetSize(this.m_Size.x, val);
  }

  SetEnd(x: number, y: number): void;
  SetEnd(pos: Vec2): void;
  SetEnd(a: Vec2 | number, y?: number): void {
    if (typeof a === 'number') {
      this.SetEnd({ x: a, y: y! });
      return;
    }
    this.SetSize({ x: a.x - this.m_Pos.x, y: a.y - this.m_Pos.y });
  }

  /**
   * @return true if the argument rectangle intersects this rectangle.
   *         (i.e. if the 2 rectangles have at least a common point)
   */
  Intersects(aRect: BOX2): boolean;
  /**
   * @return true if this rectangle intersects a line from \a aPoint1 to \a aPoint2
   */
  Intersects(aPoint1: Vec2, aPoint2: Vec2): boolean;
  /**
   * @return true if this rectangle intersects a rotated rect given by \a aRect and
   *         \a aRotation.
   */
  Intersects(aRect: BOX2, aRotation: EDA_ANGLE): boolean;
  Intersects(a: BOX2 | Vec2, b?: Vec2 | EDA_ANGLE): boolean {
    if (a instanceof BOX2) {
      if (b instanceof EDA_ANGLE) return this.intersectsRotated(a, b);
      return this.intersectsBox(a);
    }
    return this.intersectsSegment(a, b as Vec2);
  }

  private intersectsBox(aRect: BOX2): boolean {
    // this logic taken from wxWidgets' geometry.cpp file:
    const me = this.Clone();
    const rect = aRect.Clone();
    me.Normalize(); // ensure size is >= 0
    rect.Normalize(); // ensure size is >= 0

    // calculate the left common area coordinate:
    const left = Math.max(me.m_Pos.x, rect.m_Pos.x);
    // calculate the right common area coordinate:
    const right = Math.min(me.m_Pos.x + me.m_Size.x, rect.m_Pos.x + rect.m_Size.x);
    // calculate the upper common area coordinate:
    const top = Math.max(me.m_Pos.y, rect.m_Pos.y);
    // calculate the lower common area coordinate:
    const bottom = Math.min(me.m_Pos.y + me.m_Size.y, rect.m_Pos.y + rect.m_Size.y);

    // if a common area exists, it must have a positive (null accepted) size
    return left <= right && top <= bottom;
  }

  /**
   * @return the intersection of this rectangle and \a aRect, or an empty box at the origin.
   */
  Intersect(aRect: BOX2): this {
    const me = this.Clone();
    const rect = aRect.Clone();
    me.Normalize(); // ensure size is >= 0
    rect.Normalize(); // ensure size is >= 0

    const topLeft = {
      x: Math.max(me.m_Pos.x, rect.m_Pos.x),
      y: Math.max(me.m_Pos.y, rect.m_Pos.y),
    };
    const bottomRight = {
      x: Math.min(me.m_Pos.x + me.m_Size.x, rect.m_Pos.x + rect.m_Size.x),
      y: Math.min(me.m_Pos.y + me.m_Size.y, rect.m_Pos.y + rect.m_Size.y),
    };

    if (topLeft.x < bottomRight.x && topLeft.y < bottomRight.y)
      return this.make(topLeft, { x: bottomRight.x - topLeft.x, y: bottomRight.y - topLeft.y });
    return this.make({ x: 0, y: 0 }, { x: 0, y: 0 });
  }

  private intersectsSegment(aPoint1: Vec2, aPoint2: Vec2): boolean {
    if (this.Contains(aPoint1) || this.Contains(aPoint2)) return true;

    const point2 = { x: this.GetEnd().x, y: this.GetOrigin().y };
    const point4 = { x: this.GetOrigin().x, y: this.GetEnd().y };

    //Only need to test 3 sides since a straight line can't enter and exit on same side
    if (SegmentIntersectsSegment(aPoint1, aPoint2, this.GetOrigin(), point2)) return true;

    if (SegmentIntersectsSegment(aPoint1, aPoint2, point2, this.GetEnd())) return true;

    if (SegmentIntersectsSegment(aPoint1, aPoint2, this.GetEnd(), point4)) return true;

    return false;
  }

  private intersectsRotated(aRect: BOX2, aRotation: EDA_ANGLE): boolean {
    if (!this.m_init) return false;

    const rotation = aRotation.Clone();
    rotation.Normalize();

    /*
     * Most rectangles will be axis aligned.  It is quicker to check for this case and pass
     * the rect to the simpler intersection test.
     */

    // Test for non-rotated rectangle
    for (const ii of ROT_PARALLEL) {
      if (rotation.sub(ii).abs().lt(ROT_EPSILON)) return this.intersectsBox(aRect);
    }

    // Test for rectangle rotated by multiple of 90 degrees
    for (const jj of ROT_PERPENDICULAR) {
      if (rotation.sub(jj).abs().lt(ROT_EPSILON)) {
        const rotRect = this.make();

        // Rotate the supplied rect by 90 degrees
        rotRect.SetOrigin(aRect.Centre());
        rotRect.Inflate(aRect.GetHeight(), aRect.GetWidth());
        return this.intersectsBox(rotRect);
      }
    }

    /* There is some non-orthogonal rotation.
     * There are three cases to test:
     * A) One point of this rect is inside the rotated rect
     * B) One point of the rotated rect is inside this rect
     * C) One of the sides of the rotated rect intersect this
     */

    const corners: VECTOR2I[] = [
      { x: this.GetLeft(), y: this.GetTop() },
      { x: this.GetRight(), y: this.GetTop() },
      { x: this.GetRight(), y: this.GetBottom() },
      { x: this.GetLeft(), y: this.GetBottom() },
    ];

    /* Test A : Any corners exist in rotated rect? */
    const rCentre = aRect.Centre();

    for (let i = 0; i < 4; i++) {
      let delta = { x: corners[i]!.x - rCentre.x, y: corners[i]!.y - rCentre.y };
      delta = RotatePoint(delta, rotation.negate());
      delta.x += rCentre.x;
      delta.y += rCentre.y;

      if (aRect.Contains(delta)) return true;
    }

    /* Test B : Any corners of rotated rect exist in this one? */
    const w = this.checked(this.half(aRect.GetWidth()));
    const h = this.checked(this.half(aRect.GetHeight()));

    // Construct corners around center of shape
    corners[0] = { x: -w, y: -h };
    corners[1] = { x: w, y: -h };
    corners[2] = { x: w, y: h };
    corners[3] = { x: -w, y: h };

    // Rotate and test each corner
    for (let j = 0; j < 4; j++) {
      const c = RotatePoint(corners[j]!, rotation);
      corners[j] = { x: c.x + rCentre.x, y: c.y + rCentre.y };

      if (this.Contains(corners[j]!)) return true;
    }

    /* Test C : Any sides of rotated rect intersect this */
    if (
      this.intersectsSegment(corners[0]!, corners[1]!) ||
      this.intersectsSegment(corners[1]!, corners[2]!) ||
      this.intersectsSegment(corners[2]!, corners[3]!) ||
      this.intersectsSegment(corners[3]!, corners[0]!)
    ) {
      return true;
    }

    return false;
  }

  /**
   * @return true if this rectangle intersects the circle defined by \a aCenter and \a aRadius.
   */
  IntersectsCircle(aCenter: Vec2, aRadius: number): boolean {
    if (!this.m_init) return false;

    const closest = this.NearestPoint(aCenter);

    const dx = aCenter.x - closest.x;
    const dy = aCenter.y - closest.y;

    const r = aRadius;

    return dx * dx + dy * dy <= r * r;
  }

  /**
   * @return true if this rectangle intersects the edge of a circle defined by \a aCenter
   *         and \a aRadius.
   */
  IntersectsCircleEdge(aCenter: Vec2, aRadius: number, aWidth: number): boolean {
    if (!this.m_init) return false;

    const me = this.Clone();
    me.Normalize(); // ensure size is >= 0

    // Test if the circle intersects at all
    if (!this.IntersectsCircle(aCenter, aRadius + this.half(aWidth))) return false;

    const farpt = this.FarthestPointTo(aCenter);
    // Farthest point must be further than the inside of the line
    const fx = farpt.x - aCenter.x;
    const fy = farpt.y - aCenter.y;

    const r = aRadius - aWidth / 2;

    return fx * fx + fy * fy > r * r;
  }

  Format(): string {
    return `( box corner ( xy ${this.m_Pos.x} ${this.m_Pos.y} ) w ${this.m_Size.x} h ${this.m_Size.y} )`;
  }

  /**
   * Inflates the rectangle horizontally by \a dx and vertically by \a dy. If \a dx
   * and/or \a dy is negative the rectangle is deflated.
   */
  Inflate(dx: number, dy: number): this;
  /**
   * Inflate the rectangle horizontally and vertically by \a aDelta. If \a aDelta
   * is negative the rectangle is deflated.
   */
  Inflate(aDelta: number): this;
  Inflate(dx: number, dy?: number): this {
    if (dy === undefined) return this.Inflate(dx, dx);

    if (this.m_Size.x >= 0) {
      if (this.m_Size.x < -2 * dx) {
        // Don't allow deflate to eat more width than we have,
        this.m_Pos.x = this.checked(this.m_Pos.x + this.half(this.m_Size.x));
        this.m_Size.x = 0;
      } else {
        // The inflate is valid.
        this.m_Pos.x -= dx;
        this.m_Size.x += 2 * dx;
      }
    } // size.x < 0:
    else {
      if (this.m_Size.x > 2 * dx) {
        // Don't allow deflate to eat more width than we have,
        this.m_Pos.x = this.checked(this.m_Pos.x - this.half(this.m_Size.x));
        this.m_Size.x = 0;
      } else {
        // The inflate is valid.
        this.m_Pos.x += dx;
        this.m_Size.x -= 2 * dx; // m_Size.x <0: inflate when dx > 0
      }
    }

    if (this.m_Size.y >= 0) {
      if (this.m_Size.y < -2 * dy) {
        // Don't allow deflate to eat more height than we have,
        this.m_Pos.y = this.checked(this.m_Pos.y + this.half(this.m_Size.y));
        this.m_Size.y = 0;
      } else {
        // The inflate is valid.
        this.m_Pos.y -= dy;
        this.m_Size.y += 2 * dy;
      }
    } // size.y < 0:
    else {
      if (this.m_Size.y > 2 * dy) {
        // Don't allow deflate to eat more height than we have,
        this.m_Pos.y = this.checked(this.m_Pos.y - this.half(this.m_Size.y));
        this.m_Size.y = 0;
      } else {
        // The inflate is valid.
        this.m_Pos.y += dy;
        this.m_Size.y -= 2 * dy; // m_Size.y <0: inflate when dy > 0
      }
    }

    return this;
  }

  /**
   * Get a new rectangle that is this one, inflated by \a aDx and \a aDy.
   */
  GetInflated(aDx: number, aDy?: number): this {
    const ret = this.Clone();
    ret.Inflate(aDx, aDy ?? aDx);
    return ret;
  }

  /**
   * Modify the position and size of the rectangle in order to contain \a aRect
   * (or the given point).
   */
  Merge(aRect: BOX2): this;
  Merge(aPoint: Vec2): this;
  Merge(a: BOX2 | Vec2): this {
    if (a instanceof BOX2) {
      if (!this.m_init) {
        if (a.m_init) {
          this.m_Pos = { x: a.m_Pos.x, y: a.m_Pos.y };
          this.m_Size = { x: a.m_Size.x, y: a.m_Size.y };
          this.m_init = true;
        }
        return this;
      }

      this.Normalize(); // ensure width and height >= 0
      const rect = a.Clone();
      rect.Normalize(); // ensure width and height >= 0
      const end = this.GetEnd();
      const rect_end = rect.GetEnd();

      // Change origin and size in order to contain the given rect
      this.m_Pos.x = Math.min(this.m_Pos.x, rect.m_Pos.x);
      this.m_Pos.y = Math.min(this.m_Pos.y, rect.m_Pos.y);
      end.x = Math.max(end.x, rect_end.x);
      end.y = Math.max(end.y, rect_end.y);
      this.SetEnd(end);
      return this;
    }

    if (!this.m_init) {
      this.m_Pos = { x: a.x, y: a.y };
      this.m_Size = { x: 0, y: 0 };
      this.m_init = true;
      return this;
    }

    this.Normalize(); // ensure width and height >= 0
    const end = this.GetEnd();

    // Change origin and size in order to contain the given rectangle.
    this.m_Pos.x = Math.min(this.m_Pos.x, a.x);
    this.m_Pos.y = Math.min(this.m_Pos.y, a.y);
    end.x = Math.max(end.x, a.x);
    end.y = Math.max(end.y, a.y);
    this.SetEnd(end);
    return this;
  }

  /**
   * Useful to calculate bounding box of rotated items, when rotation is not cardinal.
   * @return the bounding box of this, after rotation.
   */
  GetBoundingBoxRotated(aRotCenter: VECTOR2I, aAngle: EDA_ANGLE): this {
    const origin = this.GetOrigin();
    const end = this.GetEnd();

    // Build the corners list
    const corners: VECTOR2I[] = [
      { x: origin.x, y: origin.y },
      { x: origin.x, y: end.y },
      { x: end.x, y: end.y },
      { x: end.x, y: origin.y },
    ];

    // Rotate all corners, to find the bounding box
    for (let ii = 0; ii < 4; ii++) corners[ii] = RotatePoint(corners[ii]!, aRotCenter, aAngle);

    // Find the corners bounding box
    const start = { x: corners[0]!.x, y: corners[0]!.y };
    const stop = { x: corners[0]!.x, y: corners[0]!.y };

    for (let ii = 1; ii < 4; ii++) {
      start.x = Math.min(start.x, corners[ii]!.x);
      start.y = Math.min(start.y, corners[ii]!.y);
      stop.x = Math.max(stop.x, corners[ii]!.x);
      stop.y = Math.max(stop.y, corners[ii]!.y);
    }

    const bbox = this.make();
    bbox.SetOrigin(start);
    bbox.SetEnd(stop);

    return bbox;
  }

  /**
   * Return the area of the rectangle.
   */
  GetArea(): number {
    return this.GetWidth() * this.GetHeight();
  }

  /**
   * Return the length of the diagonal of the rectangle.
   */
  Diagonal(): number {
    return Math.hypot(this.m_Size.x, this.m_Size.y);
  }

  /**
   * Return the square of the length of the diagonal of the rectangle.
   * When all you need is a comparison, this is faster than Diagonal().
   */
  SquaredDiagonal(): number {
    return this.m_Size.x * this.m_Size.x + this.m_Size.y * this.m_Size.y;
  }

  SquaredDistance(aP: Vec2): number;
  /**
   * Return the square of the minimum distance between self and box \a aBox
   */
  SquaredDistance(aBox: BOX2): number;
  SquaredDistance(a: Vec2 | BOX2): number {
    if (a instanceof BOX2) {
      let s = 0;

      if (a.m_Pos.x + a.m_Size.x < this.m_Pos.x) {
        const d = a.m_Pos.x + a.m_Size.x - this.m_Pos.x;
        s += d * d;
      } else if (a.m_Pos.x > this.m_Pos.x + this.m_Size.x) {
        const d = a.m_Pos.x - this.m_Size.x - this.m_Pos.x;
        s += d * d;
      }

      if (a.m_Pos.y + a.m_Size.y < this.m_Pos.y) {
        const d = a.m_Pos.y + a.m_Size.y - this.m_Pos.y;
        s += d * d;
      } else if (a.m_Pos.y > this.m_Pos.y + this.m_Size.y) {
        const d = a.m_Pos.y - this.m_Size.y - this.m_Pos.y;
        s += d * d;
      }

      return s;
    }

    const x2 = this.m_Pos.x + this.m_Size.x;
    const y2 = this.m_Pos.y + this.m_Size.y;
    const xdiff = Math.max(a.x < this.m_Pos.x ? this.m_Pos.x - a.x : this.m_Pos.x - x2, 0);
    const ydiff = Math.max(a.y < this.m_Pos.y ? this.m_Pos.y - a.y : this.m_Pos.y - y2, 0);
    return xdiff * xdiff + ydiff * ydiff;
  }

  Distance(aP: Vec2): number;
  Distance(aBox: BOX2): number;
  Distance(a: Vec2 | BOX2): number {
    return Math.sqrt(a instanceof BOX2 ? this.SquaredDistance(a) : this.SquaredDistance(a));
  }

  /**
   * Return the point in this rect that is closest to the provided point
   */
  NearestPoint(aPoint: Vec2): Vec2 {
    const me = this.Clone();
    me.Normalize(); // ensure size is >= 0

    // Determine closest point to the circle centre within this rect
    const nx = Math.min(Math.max(aPoint.x, me.GetLeft()), me.GetRight());
    const ny = Math.min(Math.max(aPoint.y, me.GetTop()), me.GetBottom());

    return { x: nx, y: ny };
  }

  /**
   * Return the point in this rect that is farthest from the provided point
   */
  FarthestPointTo(aPoint: Vec2): Vec2 {
    const me = this.Clone();
    me.Normalize(); // ensure size is >= 0

    const center = me.GetCenter();

    const fx = aPoint.x < center.x ? me.GetRight() : me.GetLeft();
    const fy = aPoint.y < center.y ? me.GetBottom() : me.GetTop();

    return { x: fx, y: fy };
  }

  /** `operator==`: equal after both are normalised. */
  equals(aOther: BOX2): boolean {
    const t1 = this.Clone();
    const t2 = aOther.Clone();
    t1.Normalize();
    t2.Normalize();
    return (
      t1.m_Pos.x === t2.m_Pos.x &&
      t1.m_Pos.y === t2.m_Pos.y &&
      t1.m_Size.x === t2.m_Size.x &&
      t1.m_Size.y === t2.m_Size.y
    );
  }

  IsValid(): boolean {
    return this.m_init;
  }
}

/** `BOX2< VECTOR2I >`: `int` coordinates, `int64_t` size and arithmetic. */
export class BOX2I extends BOX2 {
  protected make(aPos?: Vec2, aSize?: Vec2): this {
    return new BOX2I(aPos, aSize) as this;
  }
  protected checked(v: number): number {
    return KiCheckedCast(v);
  }
  protected half(v: number): number {
    return Math.trunc(v / 2);
  }

  /** `ByCorners`: the box spanning two corners, normalised. */
  static ByCorners(aCorner1: Vec2, aCorner2: Vec2): BOX2I {
    return new BOX2I(aCorner1, { x: aCorner2.x - aCorner1.x, y: aCorner2.y - aCorner1.y });
  }

  /** `ByCenter`: the box of `aSize` centred on `aCenter`. */
  static ByCenter(aCenter: Vec2, aSize: Vec2): BOX2I {
    return new BOX2I(
      { x: aCenter.x - Math.trunc(aSize.x / 2), y: aCenter.y - Math.trunc(aSize.y / 2) },
      aSize,
    );
  }

  SetMaximum(): void {
    // We want to be able to invert the box, so don't use lowest()
    this.m_Pos.x = this.m_Pos.y = -INT_MAX;
    this.m_Size.x = this.m_Size.y = INT_MAX + INT_MAX;
    this.m_init = true;
  }
}

/** `BOX2< VECTOR2D >`: `double` everywhere. */
export class BOX2D extends BOX2 {
  protected make(aPos?: Vec2, aSize?: Vec2): this {
    return new BOX2D(aPos, aSize) as this;
  }
  protected checked(v: number): number {
    return v;
  }
  protected half(v: number): number {
    return v / 2;
  }

  static ByCorners(aCorner1: Vec2, aCorner2: Vec2): BOX2D {
    return new BOX2D(aCorner1, { x: aCorner2.x - aCorner1.x, y: aCorner2.y - aCorner1.y });
  }

  static ByCenter(aCenter: Vec2, aSize: Vec2): BOX2D {
    return new BOX2D({ x: aCenter.x - aSize.x / 2, y: aCenter.y - aSize.y / 2 }, aSize);
  }

  SetMaximum(): void {
    this.m_Pos.x = this.m_Pos.y = -Number.MAX_VALUE / 2.0;
    this.m_Size.x = this.m_Size.y = Number.MAX_VALUE;
    this.m_init = true;
  }
}

/** `std::optional< BOX2I >`. */
export type OPT_BOX2I = BOX2I | undefined;

const clampD = (v: number): number => Math.min(Math.max(v, -INT_MAX), INT_MAX);

/**
 * `BOX2ISafe( const BOX2D& )`: a double box clamped into `int` range, the
 * far corner kept as a 64-bit difference.
 */
export function BOX2ISafe(aInput: BOX2D): BOX2I;
/** `BOX2ISafe( const VECTOR2D& aPos, const VECTOR2D& aSize )`. */
export function BOX2ISafe(aPos: Vec2, aSize: Vec2): BOX2I;
export function BOX2ISafe(a: BOX2D | Vec2, aSize?: Vec2): BOX2I {
  if (a instanceof BOX2D) {
    const left = Math.trunc(clampD(a.GetLeft()));
    const top = Math.trunc(clampD(a.GetTop()));
    const right = Math.trunc(clampD(a.GetRight()));
    const bottom = Math.trunc(clampD(a.GetBottom()));
    return new BOX2I({ x: left, y: top }, { x: right - left, y: bottom - top });
  }

  const size = aSize!;

  if (
    Number.isInteger(a.x) &&
    Number.isInteger(a.y) &&
    Number.isInteger(size.x) &&
    Number.isInteger(size.y)
  ) {
    // the integral overload: the far corner clamped, the size re-derived
    const right = Math.min(Math.max(a.x + size.x, -INT_MAX), INT_MAX);
    const bottom = Math.min(Math.max(a.y + size.y, -INT_MAX), INT_MAX);
    return new BOX2I(a, { x: right - a.x, y: bottom - a.y });
  }

  const left = Math.trunc(clampD(a.x));
  const top = Math.trunc(clampD(a.y));
  const right = Math.trunc(clampD(a.x + size.x));
  const bottom = Math.trunc(clampD(a.y + size.y));
  return new BOX2I({ x: left, y: top }, { x: right - left, y: bottom - top });
}

/**
 * Check if a BOX2 is safe for use with BOX2D
 * (probably BOX2D or BOX2L)
 */
export function IsBOX2Safe(aInput: BOX2): boolean {
  return (
    aInput.GetLeft() >= -INT_MAX &&
    aInput.GetTop() >= -INT_MAX &&
    aInput.GetRight() <= INT_MAX &&
    aInput.GetBottom() <= INT_MAX
  );
}

/* KiROUND specialization for double -> int boxes */
export function KiROUND_BOX2(aBoxD: BOX2D): BOX2I {
  const o = aBoxD.GetOrigin();
  const s = aBoxD.GetSize();
  return new BOX2I({ x: KiROUND(o.x), y: KiROUND(o.y) }, { x: KiROUND(s.x), y: KiROUND(s.y) });
}
