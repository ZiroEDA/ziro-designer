// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIRECTION_45, the eight-way direction the 45° routing regime is built on.
 * Counterpart: `libs/kimath/include/geometry/direction45.h` and
 * `libs/kimath/src/geometry/direction_45.cpp`.
 *
 * North is "up" for the user, which is *negative* y in world space, so every
 * constructor negates y before working out the octant, keep that in mind when
 * comparing against the enum: `Directions.N` is the direction of a segment whose
 * end sits above its start on screen.
 *
 * Only the MITERED_45 corner mode is ported: that is what the interactive drag
 * builds. The rounded (arc-filleted) modes belong with arc routing.
 */

import type { Vec2 } from '../math/vector2.js';

/** DIRECTION_45::Directions. */
export enum Directions {
  N = 0,
  NE = 1,
  E = 2,
  SE = 3,
  S = 4,
  SW = 5,
  W = 6,
  NW = 7,
  LAST = 8,
  UNDEFINED = -1,
}

/**
 * DIRECTION_45::CORNER_MODE. Only MITERED_45 is implemented by
 * `buildInitialTrace` (see the file comment); the whole enum is spelled out
 * because `PNS::ROUTING_SETTINGS` persists the value, and a setting that could
 * only ever hold its default would not round-trip a KiCad-written file.
 *
 * `buildInitialTrace` now also implements MITERED_90 — see its docblock. The
 * rounded modes remain unbuilt, and every *predicate* the router runs on this
 * enum (LINE_PLACER tests for a 90° mode when snapping to a hull, and for a
 * 45° mode when enabling SMART_PADS) is exact for all four values regardless.
 */
export enum CornerMode {
  /** H/V/45 with mitered corners (default). */
  MITERED_45 = 0,
  /** H/V/45 with filleted corners. */
  ROUNDED_45 = 1,
  /** H/V only (90-degree corners). */
  MITERED_90 = 2,
  /** H/V with filleted corners. */
  ROUNDED_90 = 3,
}

/** Is this one of the two 90°-corner modes? `is90mode`, `direction_45.cpp:41`. */
export const isCornerMode90 = (aMode: CornerMode): boolean =>
  aMode === CornerMode.ROUNDED_90 || aMode === CornerMode.MITERED_90;

/** DIRECTION_45::AngleType, a bit mask, as upstream tests it with `&`. */
export enum AngleType {
  ANG_OBTUSE = 0x01,
  ANG_RIGHT = 0x02,
  ANG_ACUTE = 0x04,
  ANG_STRAIGHT = 0x08,
  ANG_HALF_FULL = 0x10,
  ANG_UNDEFINED = 0x20,
}

const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

export class Direction45 {
  readonly dir: Directions;
  /** Routing on 90° increments rather than 45° (Left/Right turn by two octants). */
  private readonly deg90: boolean;

  private constructor(dir: Directions, deg90 = false) {
    this.dir = dir;
    this.deg90 = deg90;
  }

  /** DIRECTION_45( Directions ). */
  static of(dir: Directions = Directions.UNDEFINED, deg90 = false): Direction45 {
    return new Direction45(dir, deg90);
  }

  /** DIRECTION_45( VECTOR2I ), rounds to the nearest octant. */
  static fromVector(v: Vec2, deg90 = false): Direction45 {
    return new Direction45(construct(v.x, -v.y), deg90);
  }

  /** DIRECTION_45( SEG ). */
  static fromSeg(a: Vec2, b: Vec2, deg90 = false): Direction45 {
    return Direction45.fromVector({ x: b.x - a.x, y: b.y - a.y }, deg90);
  }

  static readonly UNDEFINED = new Direction45(Directions.UNDEFINED);

  equals(other: Direction45): boolean {
    return this.dir === other.dir;
  }

  isDefined(): boolean {
    return this.dir !== Directions.UNDEFINED;
  }

  /** Diagonal directions are the odd ones (NE, SE, SW, NW). */
  isDiagonal(): boolean {
    return this.dir % 2 === 1;
  }

  /** Turn right by 45° (or 90° in 90° mode). */
  right(): Direction45 {
    if (this.dir === Directions.UNDEFINED) return Direction45.UNDEFINED;
    const step = this.deg90 ? 2 : 1;
    return new Direction45((this.dir + step) % Directions.LAST, this.deg90);
  }

  /** Turn left by 45° (or 90° in 90° mode). */
  left(): Direction45 {
    if (this.dir === Directions.UNDEFINED) return Direction45.UNDEFINED;
    const step = this.deg90 ? 2 : 1;
    return new Direction45((this.dir + Directions.LAST - step) % Directions.LAST, this.deg90);
  }

  /** A unit vector in world coordinates (y grows downwards). */
  toVector(): Vec2 {
    switch (this.dir) {
      case Directions.N:
        return { x: 0, y: -1 };
      case Directions.S:
        return { x: 0, y: 1 };
      case Directions.E:
        return { x: 1, y: 0 };
      case Directions.W:
        return { x: -1, y: 0 };
      case Directions.NE:
        return { x: 1, y: -1 };
      case Directions.NW:
        return { x: -1, y: -1 };
      case Directions.SE:
        return { x: 1, y: 1 };
      case Directions.SW:
        return { x: -1, y: 1 };
      default:
        return { x: 0, y: 0 };
    }
  }

  /** DIRECTION_45::Angle. */
  angle(other: Direction45): AngleType {
    if (this.dir === Directions.UNDEFINED || other.dir === Directions.UNDEFINED)
      return AngleType.ANG_UNDEFINED;

    const d = Math.abs(this.dir - other.dir);
    if (d === 1 || d === 7) return AngleType.ANG_OBTUSE;
    if (d === 2 || d === 6) return AngleType.ANG_RIGHT;
    if (d === 3 || d === 5) return AngleType.ANG_ACUTE;
    if (d === 4) return AngleType.ANG_HALF_FULL;
    return AngleType.ANG_STRAIGHT;
  }

  isObtuse(other: Direction45): boolean {
    return this.angle(other) === AngleType.ANG_OBTUSE;
  }

  /**
   * `DIRECTION_45::BuildInitialTrace` (`direction_45.cpp:24-101`, `:222-235`):
   * the two-segment trace from `p0` to `p1`, one axis-aligned run and one
   * diagonal (or, in a 90° mode, two axis-aligned runs), in whichever order this
   * direction implies — or `startDiagonal` when it is undefined.
   *
   * The single-segment shortcut is *not* symmetric between the modes. Upstream
   * guards the `h === w` case with `!is90mode` (`:46`), because a 45° mode can
   * draw an exact diagonal in one segment while a 90° mode still needs its two
   * axis-aligned legs to get there. Dropping that guard turns every square
   * displacement into an illegal diagonal in 90° mode.
   *
   * In 90° mode the leg is chosen by `startDiagonal === (h >= w)` (`:58`), which
   * reads oddly — there is no diagonal involved — but it is what makes the
   * posture toggle still flip which axis is travelled first.
   *
   * The rounded (arc-filleted) modes are not ported; see the file docblock. They
   * build as their mitered counterparts, which is the shape of the corner minus
   * the fillet.
   */
  buildInitialTrace(
    p0: Vec2,
    p1: Vec2,
    startDiagonal = false,
    cornerMode: CornerMode = CornerMode.MITERED_45,
  ): Vec2[] {
    const diagonalFirst = this.dir === Directions.UNDEFINED ? startDiagonal : this.isDiagonal();

    const w = Math.abs(p1.x - p0.x);
    const h = Math.abs(p1.y - p0.y);
    const sw = sign(p1.x - p0.x);
    const sh = sign(p1.y - p0.y);
    const is90 = isCornerMode90(cornerMode);

    // One segment does it when the run is straight or empty — and, in a 45°
    // mode only, when it is an exact diagonal.
    if (w === 0 || h === 0 || (!is90 && h === w)) return [p0, p1];

    if (is90) {
      const mp0 = diagonalFirst === h >= w ? { x: w * sw, y: 0 } : { x: 0, y: sh * h };
      return [p0, { x: p0.x + mp0.x, y: p0.y + mp0.y }, p1];
    }

    const mp0 = w > h ? { x: (w - h) * sw, y: 0 } : { x: 0, y: sh * (h - w) };
    const mp1 = w > h ? { x: h * sw, y: h * sh } : { x: sw * w, y: sh * w };
    const mid = diagonalFirst ? mp1 : mp0;

    return [p0, { x: p0.x + mid.x, y: p0.y + mid.y }, p1];
  }

  /** `DIRECTION_45::Format`, for messages and test failures. */
  format(): string {
    return Directions[this.dir] ?? 'UNDEFINED';
  }
}

/** DIRECTION_45::construct_, the octant of a vector, y already negated. */
function construct(x: number, y: number): Directions {
  if (x === 0 && y === 0) return Directions.UNDEFINED;

  let mag = 360 - (180 / Math.PI) * Math.atan2(y, x) + 90;
  if (mag >= 360) mag -= 360;
  if (mag < 0) mag += 360;

  let dir = Math.trunc((mag + 22.5) / 45);
  if (dir >= Directions.LAST) dir -= Directions.LAST;
  if (dir < 0) dir += Directions.LAST;
  return dir as Directions;
}
