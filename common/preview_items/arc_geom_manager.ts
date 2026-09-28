// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ARC_GEOM_MANAGER` — pcbnew's arc, built from a **centre, a start point and
 * a swept angle**. Counterparts: `include/preview_items/arc_geom_manager.h`
 * and `common/preview_items/arc_geom_manager.cpp`.
 *
 * The click order is the thing to get right, and it is not the obvious one:
 *
 *   1. click the **centre** (`SET_ORIGIN`);
 *   2. the cursor drags the radius; click fixes the **start** and the radius
 *      (`SET_START`);
 *   3. the cursor sweeps the angle; click fixes the **end** (`SET_ANGLE`).
 *
 * This is not eeschema's arc. `SCH_DRAWING_TOOLS::DrawShape` takes start, end
 * and then a point to bow through, driving `EDA_SHAPE::calcEdit`; pcbnew never
 * asks for a point on the arc at all. Ours had transcribed the eeschema order
 * into the board editor, so the first click landed the centre of nothing and
 * the radius was whatever the second click happened to be from the first.
 *
 * ### The posture rule
 *
 * `m_clockwise` is chosen for the user while the swept angle is small, and
 * *locks* once it passes 90° either way — so dragging out past a quarter turn
 * settles the direction and coming back inside 90° unlocks it again. `/`
 * (`PCB_ACTIONS::arcPosture`) flips it and locks it deliberately. Without the
 * lock the arc would flip inside out every time the cursor crossed the start
 * radius, which is what makes a hand-rolled version feel wrong even when the
 * geometry is right.
 *
 * ### Angles are screen angles
 *
 * `EDA_ANGLE( VECTOR2I )` is `atan2( y, x )` on a **Y-down** board, and
 * `GetStartRadiusEnd` rotates by `-m_startAngle` to get back. Every negation
 * below is upstream's; none is a sign fix.
 */

import {
  ANGLE_0,
  ANGLE_45,
  ANGLE_90,
  ANGLE_360,
  EDA_ANGLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { MultistepGeomManager } from './multistep_geom_manager.js';

/** `ARC_GEOM_MANAGER::ARC_STEPS`. */
export enum ArcStep {
  /** Waiting to lock in the origin — the arc's **centre**. */
  SET_ORIGIN = 0,
  /** Waiting to lock in the arc start point, which also fixes the radius. */
  SET_START = 1,
  /** Waiting to lock in the arc end point. */
  SET_ANGLE = 2,
  COMPLETE = 3,
}

/** `snapAngle`: `ANGLE_45 * KiROUND( aAngle / ANGLE_45 )`. */
function snapAngle(angle: EDA_ANGLE): EDA_ANGLE {
  return ANGLE_45.multiply(KiROUND(angle.AsDegrees() / ANGLE_45.AsDegrees()));
}

/**
 * `VECTOR2I vec( (int) m_radius, 0 ); RotatePoint( vec, -aAngle ); origin + vec`
 * — shared by `GetStartRadiusEnd` and `GetEndRadiusEnd`.
 *
 * The radius is **truncated** to an integer first, exactly as the C `(int)`
 * cast does, and the rotation goes through kimath's own `RotatePoint` so the
 * two cannot drift.
 */
function radiusEnd(origin: Vec2, radius: number, angle: EDA_ANGLE): Vec2 {
  const vec = RotatePoint({ x: Math.trunc(radius), y: 0 }, angle);
  return { x: origin.x + vec.x, y: origin.y + vec.y };
}

/** `ARC_GEOM_MANAGER`. */
export class ArcGeomManager extends MultistepGeomManager {
  private clockwise_ = true;
  private origin_: Vec2 = { x: 0, y: 0 };
  private radius_ = 0;
  private startAngle_: EDA_ANGLE = new EDA_ANGLE(0);
  private endAngle_: EDA_ANGLE = new EDA_ANGLE(0);
  private angleSnap_ = false;
  private directionLocked_ = false;

  protected getMaxStep(): number {
    return ArcStep.COMPLETE;
  }

  /** `GetStep()`. */
  getArcStep(): ArcStep {
    return this.getStep() as ArcStep;
  }

  protected acceptPoint(pt: Vec2): boolean {
    switch (this.getArcStep()) {
      case ArcStep.SET_ORIGIN:
        return this.setOrigin(pt);
      case ArcStep.SET_START:
        return this.setStart(pt);
      case ArcStep.SET_ANGLE:
        return this.setEnd(pt);
      default:
        return false;
    }
  }

  /** `SetClockwise` — also locks the direction, as an explicit choice does. */
  setClockwise(cw: boolean): void {
    this.clockwise_ = cw;
    this.directionLocked_ = true;
    this.setGeometryChanged();
  }

  /** `ToggleClockwise` — `PCB_ACTIONS::arcPosture`, the `/` key. */
  toggleClockwise(): void {
    this.clockwise_ = !this.clockwise_;
    this.directionLocked_ = true;
    this.setGeometryChanged();
  }

  /** `SetAngleSnap` — a bool here, set from `angleSnap != LEADER_MODE::DIRECT`. */
  setAngleSnap(snap: boolean): void {
    this.angleSnap_ = snap;
  }

  /** `GetOrigin` — the arc's centre. */
  getOrigin(): Vec2 {
    return this.origin_;
  }

  /** `GetStartRadiusEnd` — where the first radius line meets the arc. */
  getStartRadiusEnd(): Vec2 {
    return radiusEnd(this.origin_, this.radius_, this.startAngle_.negate());
  }

  /** `GetEndRadiusEnd`. */
  getEndRadiusEnd(): Vec2 {
    return radiusEnd(this.origin_, this.radius_, this.endAngle_.negate());
  }

  /** `GetRadius`. */
  getRadius(): number {
    return this.radius_;
  }

  /** `GetStartAngle` — negated, and turned back a full turn when clockwise. */
  getStartAngle(): EDA_ANGLE {
    let angle = this.startAngle_.Clone();
    if (this.clockwise_) angle = angle.sub(ANGLE_360);
    return angle.negate();
  }

  /** `GetSubtended` — the swept angle, signed by the posture. */
  getSubtended(): EDA_ANGLE {
    let angle = this.endAngle_.sub(this.startAngle_);

    if (this.endAngle_.AsDegrees() <= this.startAngle_.AsDegrees()) angle = angle.add(ANGLE_360);

    if (this.clockwise_) angle = angle.sub(ANGLE_360);

    return angle.negate();
  }

  private setOrigin(origin: Vec2): boolean {
    this.origin_ = { x: origin.x, y: origin.y };
    this.startAngle_ = new EDA_ANGLE(0);
    this.endAngle_ = new EDA_ANGLE(0);
    return true;
  }

  private setStart(end: Vec2): boolean {
    const radVec = { x: end.x - this.origin_.x, y: end.y - this.origin_.y };

    this.radius_ = Math.hypot(radVec.x, radVec.y);
    this.startAngle_ = EDA_ANGLE.fromVector(radVec);

    if (this.angleSnap_) this.startAngle_ = snapAngle(this.startAngle_);

    // Normalise to 0..360.
    while (this.startAngle_.AsDegrees() < ANGLE_0.AsDegrees())
      this.startAngle_ = this.startAngle_.add(ANGLE_360);

    this.endAngle_ = this.startAngle_.Clone();

    // A zero radius is a bad point, so the step does not advance.
    return this.radius_ !== 0;
  }

  private setEnd(cursor: Vec2): boolean {
    const radVec = { x: cursor.x - this.origin_.x, y: cursor.y - this.origin_.y };

    this.endAngle_ = EDA_ANGLE.fromVector(radVec);

    if (this.angleSnap_) this.endAngle_ = snapAngle(this.endAngle_);

    while (this.endAngle_.AsDegrees() < ANGLE_0.AsDegrees())
      this.endAngle_ = this.endAngle_.add(ANGLE_360);

    if (!this.directionLocked_) {
      let ccwAngle = this.endAngle_.sub(this.startAngle_);

      if (this.endAngle_.AsDegrees() <= this.startAngle_.AsDegrees())
        ccwAngle = ccwAngle.add(ANGLE_360);

      const cwAngle = new EDA_ANGLE(Math.abs(ccwAngle.sub(ANGLE_360).AsDegrees()));

      // Past a quarter turn either way the user has said which way round they
      // mean, so stop second-guessing them.
      if (Math.min(ccwAngle.AsDegrees(), cwAngle.AsDegrees()) >= ANGLE_90.AsDegrees())
        this.directionLocked_ = true;
      else this.clockwise_ = cwAngle.AsDegrees() < ccwAngle.AsDegrees();
    } else if (Math.abs(this.getSubtended().AsDegrees()) < ANGLE_90.AsDegrees()) {
      this.directionLocked_ = false;
    }

    // An end on the start is a bad point.
    return this.endAngle_.AsDegrees() !== this.startAngle_.AsDegrees();
  }
}
