// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The pieces the draggers stand on: `LINE::DragCorner`/`DragSegment` as
 * methods, `SHAPE_LINE_CHAIN::Split`, `DIRECTION_45`'s preferred-ending-direction
 * hint, and `MOUSE_TRAIL_TRACER`'s three dragger-facing members.
 *
 * What is worth pinning:
 *
 * - **`DragCorner`'s `wxCHECK_RET( aIndex >= 0 )` is a no-op, not a throw.**
 *   `COMPONENT_DRAGGER` feeds it −1 on every connection whose pad anchor is not
 *   a vertex and depends on the line coming back untouched.
 * - **`DragSegment( …, aFreeAngle = true )` does nothing** in a release build.
 * - **The preferred ending direction is only consulted when it is defined**, so
 *   adding the parameter cannot change any existing caller.
 * - **`Split`'s tolerance is 2 IU and its endpoint guard.**
 * - **`AddTrailPoint` truncates the trail where it doubles back**, which is the
 *   only reason `GetTrailLeadVector` stays a *lead* rather than drifting.
 */
import { describe, expect, it } from 'vitest';
import { PnsLine, PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import {
  chainSplit,
  lineDragArc,
  lineDragCorner,
  lineDragSegment,
} from '@ziroeda/pcbnew/src/router/pns_line_drag.js';
import { PnsMouseTrailTracer } from '@ziroeda/pcbnew/src/router/pns_mouse_trail_tracer.js';
import { dragCorner, dragCornerInternal } from '@ziroeda/pcbnew/src/router/pns_line.js';
import { Direction45, Directions } from '@ziroeda/kimath/src/geometry/direction45.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

function line(points: Vec2[], width = 100): PnsLine {
  const l = new PnsLine();
  l.setShape(PnsLineChain.fromPoints(points));
  l.setWidth(width);
  return l;
}

describe('LINE::DragCorner as a method', () => {
  it('moves the named corner', () => {
    const l = line([V(0, 0), V(1000, 0), V(2000, 0)]);

    lineDragCorner(l, V(2000, 1000), 2);

    expect(l.cLastPoint()).toEqual(V(2000, 1000));
  });

  it('leaves the line untouched for a negative index (wxCHECK_RET)', () => {
    const l = line([V(0, 0), V(1000, 0), V(2000, 0)]);
    const before = l.cLine().points();

    lineDragCorner(l, V(9999, 9999), -1);

    expect(l.cLine().points()).toEqual(before);
  });

  it('honours the line’s own snap threshold', () => {
    // Segments 0 and 1 are obtuse neighbours meeting at (1000, 0), so a drag
    // that lands within the threshold of that intersection snaps back onto it.
    const pts = [V(0, 0), V(1000, 0), V(2000, 1000), V(3000, 1000)];

    const plain = line(pts);
    lineDragCorner(plain, V(1050, 30), 1);

    expect(plain.cLine().points()).not.toEqual(pts);

    const snapping = line(pts);
    snapping.setSnapThreshhold(200);
    lineDragCorner(snapping, V(1050, 30), 1);

    // The threshold is read off the LINE, not passed in: with it, the corner
    // snaps back to where it was and the line is unchanged.
    expect(snapping.cLine().points()).toEqual(pts);
  });
});

describe('LINE::DragSegment as a method', () => {
  it('slides the named segment', () => {
    const l = line([V(0, 0), V(1000, 0), V(2000, 0), V(3000, 0)]);

    lineDragSegment(l, V(1500, 1000), 1);

    expect(
      l
        .cLine()
        .points()
        .some((p) => p.y !== 0),
    ).toBe(true);
  });

  it('does nothing in free-angle mode, as the release build does', () => {
    const l = line([V(0, 0), V(1000, 0), V(2000, 0), V(3000, 0)]);
    const before = l.cLine().points();

    lineDragSegment(l, V(1500, 1000), 1, true);

    expect(l.cLine().points()).toEqual(before);
  });
});

describe('LINE::DragArc on a chain with no arcs', () => {
  it('leaves the line unchanged, via the `ArcIndex < 0` early return', () => {
    // `DragArc` proper is exercised in `pns_line_drag_arc.test.ts`. This case
    // stays here because it is the one every *other* drag fixture would hit.
    const l = line([V(0, 0), V(1000, 0)]);
    const before = l.cLine().points();

    lineDragArc(l, V(500, 500), 0);

    expect(l.cLine().points()).toEqual(before);
  });
});

describe('dragCornerInternal: the preferred ending direction', () => {
  const origin = [V(0, 0), V(1000, 0), V(2000, 0)];
  const target = V(2500, 2000);

  it('is ignored when undefined, so existing callers are unaffected', () => {
    expect(dragCornerInternal(origin, target, Direction45.UNDEFINED)).toEqual(
      dragCornerInternal(origin, target),
    );
  });

  it('lets an earlier segment index win when its trace ends the asked-for way', () => {
    // Unhinted, the scan rejects i = 1 (its trace leaves S, neither matching
    // dStart nor obtuse to dPrev) and re-cuts from i = 0.
    expect(dragCornerInternal(origin, target)).toEqual([V(0, 0), V(500, 0), V(2500, 2000)]);

    // The i = 1 trace *ends* SE, so naming SE stops the scan there and keeps
    // the corner at (1000, 0).
    expect(dragCornerInternal(origin, target, Direction45.of(Directions.SE))).toEqual([
      V(0, 0),
      V(1000, 0),
      V(1000, 500),
      V(2500, 2000),
    ]);
  });

  it('falls back to the unhinted trace when the hint is unreachable', () => {
    // No trace this drag can build ends heading north.
    expect(dragCornerInternal(origin, target, Direction45.of(Directions.N))).toEqual(
      dragCornerInternal(origin, target),
    );
  });

  it('reaches dragCorner through its trailing parameter', () => {
    expect(dragCorner(origin, target, 2, false, 0, Direction45.of(Directions.SE))).toEqual(
      dragCornerInternal(origin, target, Direction45.of(Directions.SE)),
    );
  });
});

describe('SHAPE_LINE_CHAIN::Split', () => {
  it('inserts a vertex on the segment the point lies on', () => {
    const c = PnsLineChain.fromPoints([V(0, 0), V(1000, 0)]);

    expect(chainSplit(c, V(400, 0))).toBe(1);
    expect(c.points()).toEqual([V(0, 0), V(400, 0), V(1000, 0)]);
  });

  it('has a 2 IU tolerance, not "nearest segment"', () => {
    const c = PnsLineChain.fromPoints([V(0, 0), V(1000, 0)]);

    expect(chainSplit(c, V(400, 1))).toBe(1);

    const far = PnsLineChain.fromPoints([V(0, 0), V(1000, 0)]);

    expect(chainSplit(far, V(400, 2))).toBe(-1);
    expect(far.pointCount()).toBe(2);
  });

  it('never splits at an existing corner', () => {
    const c = PnsLineChain.fromPoints([V(0, 0), V(1000, 0), V(1000, 1000)]);

    expect(chainSplit(c, V(1000, 0))).toBe(1);
    expect(c.pointCount()).toBe(3);
  });

  it('answers -1 for a point off the chain', () => {
    const c = PnsLineChain.fromPoints([V(0, 0), V(1000, 0)]);

    expect(chainSplit(c, V(400, 5000))).toBe(-1);
  });
});

describe('MOUSE_TRAIL_TRACER, the dragger-facing subset', () => {
  it('has no lead vector until there are two points', () => {
    const t = new PnsMouseTrailTracer();

    expect(t.getTrailLeadVector()).toEqual(V(0, 0));

    t.addTrailPoint(V(100, 100));
    expect(t.getTrailLeadVector()).toEqual(V(0, 0));

    t.addTrailPoint(V(400, 500));
    expect(t.getTrailLeadVector()).toEqual(V(300, 400));
  });

  it('measures from the first point of the trail, not the previous one', () => {
    const t = new PnsMouseTrailTracer();

    t.addTrailPoint(V(0, 0));
    t.addTrailPoint(V(1000, 0));
    t.addTrailPoint(V(1000, 1000));

    expect(t.getTrailLeadVector()).toEqual(V(1000, 1000));
  });

  it('truncates the trail where it doubles back onto itself', () => {
    const t = new PnsMouseTrailTracer();

    // Four segments out, then a step that lands exactly on segment 0. With the
    // default tolerance of 0 only an exact re-touch triggers the truncation.
    t.addTrailPoint(V(0, 0));
    t.addTrailPoint(V(1000, 0));
    t.addTrailPoint(V(1000, 1000));
    t.addTrailPoint(V(2000, 1000));
    t.addTrailPoint(V(2000, 2000));
    expect(t.trail().pointCount()).toBe(5);

    t.addTrailPoint(V(500, 0));

    // Sliced to segment 0 (points 0..0), then the new point appended.
    expect(t.trail().points()).toEqual([V(0, 0), V(500, 0)]);
    expect(t.getTrailLeadVector()).toEqual(V(500, 0));
  });

  it('does not truncate on the two most recent segments', () => {
    const t = new PnsMouseTrailTracer();

    t.addTrailPoint(V(0, 0));
    t.addTrailPoint(V(1000, 0));
    t.addTrailPoint(V(2000, 0));
    t.addTrailPoint(V(3000, 0));
    // Lands on the last segment; the `i < segmentCount() - 2` bound excludes it.
    t.addTrailPoint(V(2500, 0));

    expect(t.trail().cPoint(0)).toEqual(V(0, 0));
  });

  it('clear() drops the trail and the forced flags', () => {
    const t = new PnsMouseTrailTracer();

    t.addTrailPoint(V(0, 0));
    t.addTrailPoint(V(1000, 1000));
    t.clear();

    expect(t.trail().pointCount()).toBe(0);
    expect(t.isForced()).toBe(false);
    expect(t.isManuallyForced()).toBe(false);
  });
});
