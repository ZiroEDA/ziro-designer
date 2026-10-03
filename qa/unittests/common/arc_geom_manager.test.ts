// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ARC_GEOM_MANAGER` (`common/preview_items/arc_geom_manager.cpp`) — pcbnew's
 * arc, which is **centre → start → swept angle** and not eeschema's
 * start/end/bow-through.
 *
 * Every expectation is derived from the C++ by hand. The board's Y grows
 * downward, so a point *below* the centre is at a *positive* screen angle;
 * where that matters the trace is written out.
 */
import { describe, expect, it } from 'vitest';
import { ARC_GEOM_MANAGER, ARC_STEPS } from '@ziroeda/common/preview_items/arc_geom_manager.js';

/** One click: the motion that precedes it, then the click. */
function click(mgr: ARC_GEOM_MANAGER, p: { x: number; y: number }): void {
  mgr.AddPoint(p, false);
  mgr.AddPoint(p, true);
}

describe('the click order', () => {
  it('takes the CENTRE first, not the arc start', () => {
    const mgr = new ARC_GEOM_MANAGER();
    expect(mgr.GetStep()).toBe(ARC_STEPS.SET_ORIGIN);

    click(mgr, { x: 1000, y: 2000 });

    expect(mgr.GetOrigin()).toEqual({ x: 1000, y: 2000 });
    expect(mgr.GetStep()).toBe(ARC_STEPS.SET_START);
  });

  it('the second click fixes the radius and the start angle', () => {
    const mgr = new ARC_GEOM_MANAGER();
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 1000, y: 0 });

    expect(mgr.GetRadius()).toBe(1000);
    expect(mgr.GetStep()).toBe(ARC_STEPS.SET_ANGLE);
    // Straight out along +x: the start of the arc is the point clicked.
    expect(mgr.GetStartRadiusEnd()).toEqual({ x: 1000, y: 0 });
  });

  it('a zero radius is refused, and a refused click steps BACK', () => {
    // `return m_radius != 0.0;` reaches `performStep( accepted )`, and
    // `MULTISTEP_GEOM_MANAGER::performStep( false )` **decrements**. So a
    // second click on the centre does not merely fail to advance — it drops
    // the arc back to waiting for a centre.
    const mgr = new ARC_GEOM_MANAGER();
    click(mgr, { x: 500, y: 500 });
    click(mgr, { x: 500, y: 500 });

    expect(mgr.GetStep()).toBe(ARC_STEPS.SET_ORIGIN);
  });

  it('the third click completes it', () => {
    const mgr = new ARC_GEOM_MANAGER();
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 1000, y: 0 });
    click(mgr, { x: 0, y: 1000 });

    expect(mgr.IsComplete()).toBe(true);
  });

  it('the end sits on the RADIUS, not on the cursor', () => {
    // The radius is already fixed, so a third click twice as far out still
    // lands the arc's end on the circle: `GetEndRadiusEnd` is built from
    // m_radius and m_endAngle, never from the cursor.
    const mgr = new ARC_GEOM_MANAGER();
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 1000, y: 0 });
    mgr.AddPoint({ x: 0, y: 4000 }, false);

    expect(mgr.GetEndRadiusEnd()).toEqual({ x: 0, y: 1000 });
  });
});

describe('the posture rule', () => {
  it('follows the shorter way round while the sweep is under a quarter turn', () => {
    const mgr = new ARC_GEOM_MANAGER();
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 1000, y: 0 }); // start angle 0°

    // A cursor just below +x is +45° on screen. ccw = 45, cw = 315, so the
    // shorter way is counter-clockwise and `m_clockwise` goes false.
    mgr.AddPoint({ x: 1000, y: 1000 }, false);
    expect(mgr.GetSubtended().AsDegrees()).toBeCloseTo(-45, 6);

    // And just above +x is −45° → normalised 315: ccw = 315, cw = 45, so it
    // flips to clockwise and the sweep comes back the other way.
    mgr.AddPoint({ x: 1000, y: -1000 }, false);
    expect(mgr.GetSubtended().AsDegrees()).toBeCloseTo(45, 6);
  });

  it('locks past 90° WITHOUT re-choosing the direction, and unlocks inside it', () => {
    const mgr = new ARC_GEOM_MANAGER();
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 1000, y: 0 }); // start angle 0°

    // End angle 135°. `ccwAngle` = 135, `cwAngle` = |135 − 360| = 225, and
    // `min( 135, 225 ) >= 90` takes the FIRST arm — which sets
    // `m_directionLocked` and leaves `m_clockwise` at its default, true. So
    // the arc keeps going clockwise the long way round rather than snapping to
    // the shorter counter-clockwise 135. That "locks whatever it already had"
    // is the branch, and reading it as "locks the shorter way" is the mistake
    // it invites.
    mgr.AddPoint({ x: -1000, y: 1000 }, false);
    expect(mgr.GetSubtended().AsDegrees()).toBeCloseTo(225, 6);

    // Back inside a quarter turn and the else-if unlocks it again —
    // `abs( GetSubtended() ) < ANGLE_90`. That motion itself still reports the
    // locked posture; the unlock only shows on the NEXT one.
    mgr.AddPoint({ x: 1000, y: -1000 }, false);
    expect(mgr.GetSubtended().AsDegrees()).toBeCloseTo(45, 6);

    // Now free again, so 45° below +x picks the shorter counter-clockwise way
    // and reports −45. Still locked it would have to go the long way round and
    // report +315, which is what makes the unlock observable at all.
    mgr.AddPoint({ x: 1000, y: 1000 }, false);
    expect(mgr.GetSubtended().AsDegrees()).toBeCloseTo(-45, 6);
  });

  it('ToggleClockwise flips the sweep and locks it', () => {
    const mgr = new ARC_GEOM_MANAGER();
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 1000, y: 0 });
    mgr.AddPoint({ x: 1000, y: 1000 }, false);
    expect(mgr.GetSubtended().AsDegrees()).toBeCloseTo(-45, 6);

    mgr.ToggleClockwise();

    expect(mgr.GetSubtended().AsDegrees()).toBeCloseTo(315, 6);

    // And it LOCKS: `m_directionLocked = true`. Moving back to the same 45°
    // must not let the automatic rule take the posture away again — without
    // the lock this motion would re-choose counter-clockwise and report −45.
    mgr.AddPoint({ x: 1000, y: 1000 }, false);
    expect(mgr.GetSubtended().AsDegrees()).toBeCloseTo(315, 6);
  });
});

describe('angle snapping', () => {
  it('rounds the start angle to the nearest 45° when on', () => {
    // `snapAngle( a ) = ANGLE_45 * KiROUND( a / ANGLE_45 )`.
    const mgr = new ARC_GEOM_MANAGER();
    mgr.SetAngleSnap(true);
    click(mgr, { x: 0, y: 0 });
    // 1000, 100 is 5.71°, which rounds to 0 — the radius keeps its unsnapped
    // length, only the angle moves.
    click(mgr, { x: 1000, y: 100 });

    expect(mgr.GetStartRadiusEnd().y).toBe(0);
  });

  it('leaves the angle alone when off', () => {
    const mgr = new ARC_GEOM_MANAGER();
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 1000, y: 100 });

    expect(mgr.GetStartRadiusEnd().y).not.toBe(0);
  });
});

describe('RemoveLastPoint', () => {
  it('steps back a stage', () => {
    const mgr = new ARC_GEOM_MANAGER();
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 1000, y: 0 });
    expect(mgr.GetStep()).toBe(ARC_STEPS.SET_ANGLE);

    mgr.RemoveLastPoint();

    expect(mgr.GetStep()).toBe(ARC_STEPS.SET_START);
  });
});
