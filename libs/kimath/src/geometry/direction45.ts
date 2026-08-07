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
   * DIRECTION_45::BuildInitialTrace (CORNER_MODE::MITERED_45), the two-segment
   * trace from `p0` to `p1`: one axis-aligned run and one diagonal, in whichever
   * order this direction implies (or `startDiagonal` when it is undefined). A
   * straight, diagonal or degenerate target needs only the single segment.
   */
  buildInitialTrace(p0: Vec2, p1: Vec2, startDiagonal = false): Vec2[] {
    const diagonalFirst = this.dir === Directions.UNDEFINED ? startDiagonal : this.isDiagonal();

    const w = Math.abs(p1.x - p0.x);
    const h = Math.abs(p1.y - p0.y);
    const sw = sign(p1.x - p0.x);
    const sh = sign(p1.y - p0.y);

    // One segment does it when the run is straight, diagonal, or empty.
    if (w === 0 || h === 0 || h === w) return [p0, p1];

    const mp0 = w > h ? { x: (w - h) * sw, y: 0 } : { x: 0, y: sh * (h - w) };
    const mp1 = w > h ? { x: h * sw, y: h * sh } : { x: sw * w, y: sh * w };
    const mid = diagonalFirst ? mp1 : mp0;

    return [p0, { x: p0.x + mid.x, y: p0.y + mid.y }, p1];
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
