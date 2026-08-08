// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SHAPE_ARC::ConstructFromStartEndCenter` and the `SHAPE_LINE_CHAIN` surgery
 * that was blocked on it: `splitArc`, `amendArc`, both arc arms of `Slice`, and
 * the arc arm of `Split`.
 * Counterparts: `libs/kimath/src/geometry/shape_arc.cpp:216-245` and
 * `shape_line_chain.cpp:274-365, 1218-1224, 1437-1513`.
 *
 * The point of `ConstructFromStartEndCenter` is that it re-cuts an arc onto new
 * endpoints *through the centre it already had*, so the piece that survives is
 * still curved. The invariant asserted throughout is therefore about the sweep,
 * not about exact concyclicity: the re-cut arc turns the same way as the
 * original and by less than it, where the chord a naive port would leave turns
 * not at all. Exact concyclicity does **not** hold, because the endpoints these
 * callers hand over are polyline vertices that straddle the true arc — see the
 * second test for the arithmetic.
 */
import { describe, expect, it } from 'vitest';
import { PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import {
  arcIsCCW,
  arcIsClockwise,
  constructArcFromStartEndAngle,
  constructArcFromStartEndCenter,
  shapeArcCenter,
  arcCentralAngle,
  arcRadius,
} from '@ziroeda/pcbnew/src/router/shape_arc_ops.js';
import { chainSplit } from '@ziroeda/pcbnew/src/router/pns_line_drag.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('SHAPE_ARC::ConstructFromStartEndCenter', () => {
  it('picks between the two arcs the same start, end and centre name', () => {
    // Start due east of the centre, end due north-on-screen (negative y). The
    // counter-clockwise sweep from east to that point the short way and the
    // clockwise sweep the long way round are different arcs through the same
    // two points; only the mid point tells them apart.
    const c = V(0, 0);
    const s = V(1000000, 0);
    const e = V(0, -1000000);

    const ccw = constructArcFromStartEndCenter(s, e, c, false);
    const cw = constructArcFromStartEndCenter(s, e, c, true);

    expect(ccw.arcMid).not.toEqual(cw.arcMid);

    // Both mid points are on the circle — to within the rounding of the integer
    // `RotatePoint` overload, which is a sub-IU wobble and is upstream's.
    expect(dist(ccw.arcMid, c)).toBeCloseTo(1000000, 0);
    expect(dist(cw.arcMid, c)).toBeCloseTo(1000000, 0);

    // ...and they are diametrically opposite.
    expect(Math.abs(dist(ccw.arcMid, cw.arcMid) - 2000000)).toBeLessThan(2);

    // And the handedness comes back out the way it went in.
    expect(arcIsCCW(ccw)).toBe(true);
    expect(arcIsClockwise(cw)).toBe(true);
  });

  it('re-cuts an arc onto a point of its own polyline, keeping the curve', () => {
    // This is what `amendArc` and both `Slice` arms are for. The new endpoint is
    // a vertex of the original arc's *polyline*, and the re-cut sweeps about
    // half the original angle in the same direction — where a chord between the
    // endpoints would sweep nothing.
    const original = constructArcFromStartEndAngle(V(0, 0), V(1000000, 1000000), new EDA_ANGLE(90));
    const centre = shapeArcCenter(original);
    const chain = new PnsLineChain();

    chain.appendArcShape(original);

    const mid = chain.cPoint(Math.floor(chain.pointCount() / 2));
    const cut = constructArcFromStartEndCenter(original.p0, mid, centre, arcIsClockwise(original));

    const whole = arcCentralAngle(original).AsDegrees();
    const half = arcCentralAngle(cut).AsDegrees();

    expect(Math.sign(half)).toBe(Math.sign(whole));
    expect(Math.abs(half)).toBeLessThan(Math.abs(whole));
    expect(Math.abs(half)).toBeGreaterThan(Math.abs(whole) / 4);

    // The re-cut arc does *not* land exactly back on the original circle, and
    // that is upstream's behaviour rather than a defect of this port: the
    // requested endpoint is a polyline vertex, and `ConvertToPolyline` grows the
    // radius by half the achieved error so the polyline straddles the true arc.
    // The mid point is therefore placed on the requested centre's circle while
    // the far endpoint sits on the original's, and re-deriving a centre from the
    // three of them lands between the two. The radius survives to well under a
    // couple of percent; the centre moves by a few thousand IU on a 1 mm arc.
    expect(arcRadius(cut)).toBeGreaterThan(arcRadius(original) * 0.98);
    expect(arcRadius(cut)).toBeLessThan(arcRadius(original) * 1.02);
    expect(dist(shapeArcCenter(cut), centre)).toBeLessThan(20000);
  });

  it('treats coincident endpoints as a full turn one way and a point the other', () => {
    // `angle` comes out 0° counter-clockwise and −360° clockwise, and the mid
    // point is the start rotated by minus half of that: unmoved, or all the way
    // round to the far side.
    const c = V(0, 0);
    const s = V(1000000, 0);

    expect(constructArcFromStartEndCenter(s, s, c, false).arcMid).toEqual(s);
    expect(constructArcFromStartEndCenter(s, s, c, true).arcMid).toEqual(V(-1000000, 0));
  });

  it('carries the requested width and nothing else', () => {
    const a = constructArcFromStartEndCenter(V(1000, 0), V(0, 1000), V(0, 0), false, 250);

    expect(a.width).toBe(250);
    expect(a.p0).toEqual(V(1000, 0));
    expect(a.p1).toEqual(V(0, 1000));
    expect(constructArcFromStartEndCenter(V(1000, 0), V(0, 1000), V(0, 0), false).width).toBe(0);
  });
});

/** A straight run in, a quarter arc, a straight run out. */
function withArc(): PnsLineChain {
  const c = new PnsLineChain();

  c.appendPoint(V(-1000000, 0));
  c.appendArcShape(constructArcFromStartEndAngle(V(0, 0), V(1000000, 1000000), new EDA_ANGLE(90)));
  c.appendPoint(V(2000000, 1000000));

  return c;
}

describe('SHAPE_LINE_CHAIN::Slice through an arc', () => {
  it('starting inside an arc keeps the remainder of it as an arc', () => {
    const c = withArc();
    const start = 3; // strictly inside the arc
    const startPt = { ...c.cPoint(start) };
    const wholeArc = c.arc(0);

    const s = c.slice(start, c.pointCount() - 1);

    // The partial arc is the *only* arc in the result, and it begins where the
    // cut fell rather than where the original arc did.
    expect(s.arcCount()).toBe(1);
    expect(s.arc(0).p0).toEqual(startPt);
    expect(s.arc(0).p1).toEqual(wholeArc.p1);

    // Still curving the same way and by less than the whole, i.e. still an arc
    // and not the chord. (The re-derived centre drifts a few thousand IU; see
    // the `ConstructFromStartEndCenter` test above for why.)
    const whole = arcCentralAngle(wholeArc).AsDegrees();
    const part = arcCentralAngle(s.arc(0)).AsDegrees();

    expect(Math.sign(part)).toBe(Math.sign(whole));
    expect(Math.abs(part)).toBeLessThan(Math.abs(whole));
    expect(arcRadius(s.arc(0))).toBeGreaterThan(arcRadius(wholeArc) * 0.98);

    // The slice starts on the cut point and ends on the chain's last point.
    expect(s.cPoint(0)).toEqual(startPt);
    expect(s.cLastPoint()).toEqual(V(2000000, 1000000));
  });

  it('ending inside an arc keeps the leading part of it as an arc', () => {
    const c = withArc();
    const end = 3;
    const endPt = { ...c.cPoint(end) };
    const wholeArc = c.arc(0);

    const s = c.slice(0, end);

    expect(s.arcCount()).toBe(1);
    expect(s.arc(0).p0).toEqual(wholeArc.p0);

    // Upstream takes `m_points[aEndIndex]` as the new end — the requested end
    // vertex, not the last vertex copied. Here they coincide, and the assertion
    // pins which one is meant.
    expect(s.arc(0).p1).toEqual(endPt);

    const whole = arcCentralAngle(wholeArc).AsDegrees();
    const part = arcCentralAngle(s.arc(0)).AsDegrees();

    expect(Math.sign(part)).toBe(Math.sign(whole));
    expect(Math.abs(part)).toBeLessThan(Math.abs(whole));
    expect(arcRadius(s.arc(0))).toBeGreaterThan(arcRadius(wholeArc) * 0.98);

    expect(s.cPoint(0)).toEqual(V(-1000000, 0));
    expect(s.cLastPoint()).toEqual(endPt);
  });

  it('still copies a whole arc through untouched', () => {
    // The arm that was already ported; here to catch a regression from the two
    // that were not.
    const c = withArc();
    const s = c.slice(0, c.pointCount() - 1);

    expect(s.arcCount()).toBe(1);
    expect(s.arc(0).p0).toEqual(V(0, 0));
    expect(s.arc(0).p1).toEqual(V(1000000, 1000000));
    expect(s.points()).toEqual(c.points());
  });
});

describe('SHAPE_LINE_CHAIN::Split inside an arc', () => {
  it('inserts the point as a shared vertex between two halves of the arc', () => {
    const c = withArc();

    // A point that really is on the arc's polyline, so `Split` finds a segment
    // within its 2 IU tolerance.
    const on = { ...c.cPoint(3) };
    const before = c.arcCount();

    // Nudge off the vertex by 1 IU so `Split` does not short-circuit on "the
    // point is already a vertex" and instead takes the arc-segment arm.
    const at = chainSplit(c, V(on.x + 1, on.y));

    expect(at).toBeGreaterThan(0);
    expect(c.arcCount()).toBe(before + 1);

    // The inserted vertex belongs to both halves: the first arc ends there and
    // the second begins there.
    expect(c.isSharedPt(at)).toBe(true);
    expect(c.arc(0).p1).toEqual(c.cPoint(at));
    expect(c.arc(1).p0).toEqual(c.cPoint(at));

    // Both halves are on the original circle, and between them they still span
    // the original arc.
    expect(c.arc(0).p0).toEqual(V(0, 0));
    expect(c.arc(1).p1).toEqual(V(1000000, 1000000));
  });

  it('leaves a split on a straight segment as a plain point', () => {
    const c = withArc();
    const before = c.arcCount();

    const at = chainSplit(c, V(-500000, 0));

    expect(at).toBe(1);
    expect(c.arcCount()).toBe(before);
    expect(c.isPtOnArc(1)).toBe(false);
    expect(c.cPoint(1)).toEqual(V(-500000, 0));
  });
});
