// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LINE::DragArc` (`pcbnew/router/pns_line.cpp:863-1092`), now that
 * `CIRCLE::ConstructFromTanTanPt` exists.
 *
 * The fixture is upstream's own shape for this: a straight run into a quarter
 * arc into another straight run. The arc runs from (0,0) to (1e6,1e6) about
 * (0,1e6), so its tangent at the start is horizontal and its tangent at the end
 * is vertical, and the two tangent lines meet at the corner (1e6, 0). Every
 * assertion below is about *that corner*, because the whole function is "fit
 * the largest circle you can into this corner that still passes through the
 * cursor".
 *
 * What is worth pinning, in the order the function decides it:
 *
 * - **The five early returns leave the line alone**, which is what the
 *   unimplemented default used to do for all of them, so a regression that
 *   silently reverted the port would still pass a shape-only test. These check
 *   the *reachable* ones.
 * - **Whether a neighbouring segment counts as the tangent line.** With only
 *   the first neighbour collinear, the arc may eat into that leg but the far
 *   end is pinned; with both collinear it can swallow both.
 * - **The cursor is clamped twice** — into the triangle, then out onto the
 *   maximal circle — and both clamps are silent, so the only evidence is that
 *   an absurd cursor produces the *original* arc rather than a wild one.
 * - **A new arc shorter than `m_MaxTrackLengthToKeep` is dropped**, leaving a
 *   sharp corner. That branch is easy to lose because it looks like a failure.
 */
import { describe, expect, it } from 'vitest';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { lineDragArc } from '@ziroeda/pcbnew/src/router/pns_line_drag.js';
import { PnsLine, PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import {
  arcRadius,
  constructArcFromStartEndAngle,
  shapeArcCenter,
} from '@ziroeda/pcbnew/src/router/shape_arc_ops.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

/** `SHAPE::MIN_PRECISION_IU`, the tolerance upstream's own circle tests use. */
const near = (got: number, want: number): void => {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(4);
};

/**
 * Straight run, quarter arc, straight run. Only the *first* neighbour is
 * collinear with the arc's tangent there: the run out of (1e6,1e6) is
 * horizontal while the arc leaves vertically, so `useChainEnd` is false and the
 * arc's far endpoint is pinned.
 */
function oneLegCollinear(): PnsLine {
  const c = new PnsLineChain();

  c.appendPoint(V(-1000000, 0));
  c.appendArcShape(constructArcFromStartEndAngle(V(0, 0), V(1000000, 1000000), new EDA_ANGLE(90)));
  c.appendPoint(V(2000000, 1000000));

  const l = new PnsLine();

  l.setShape(c);
  l.setWidth(100);

  return l;
}

/** The same arc, but with the outgoing run vertical, so both legs are tangent. */
function bothLegsCollinear(): PnsLine {
  const c = new PnsLineChain();

  c.appendPoint(V(-1000000, 0));
  c.appendArcShape(constructArcFromStartEndAngle(V(0, 0), V(1000000, 1000000), new EDA_ANGLE(90)));
  c.appendPoint(V(1000000, 2000000));

  const l = new PnsLine();

  l.setShape(c);
  l.setWidth(100);

  return l;
}

/** An index that is definitely on the arc — the fixture's arc spans 1..10. */
const ON_ARC = 3;

describe('LINE::DragArc — the early returns', () => {
  it('leaves the line alone for an out-of-range index', () => {
    const l = oneLegCollinear();
    const before = l.cLine().points();

    lineDragArc(l, V(900000, 100000), -1);
    expect(l.cLine().points()).toEqual(before);

    lineDragArc(l, V(900000, 100000), 99);
    expect(l.cLine().points()).toEqual(before);
  });

  it('leaves the line alone at a vertex that is not on an arc', () => {
    // Index 0 is the straight run's own start; `ArcIndex` is −1 there.
    const l = oneLegCollinear();
    const before = l.cLine().points();

    lineDragArc(l, V(900000, 100000), 0);

    expect(l.cLine().points()).toEqual(before);
  });

  it('leaves a chain with no arcs at all alone', () => {
    const l = new PnsLine();

    l.setShape(PnsLineChain.fromPoints([V(0, 0), V(1000, 0)]));

    const before = l.cLine().points();

    lineDragArc(l, V(500, 500), 0);

    expect(l.cLine().points()).toEqual(before);
  });
});

describe('LINE::DragArc — the new arc', () => {
  it('passes through the cursor and stays tangent to both lines', () => {
    const l = oneLegCollinear();

    lineDragArc(l, V(900000, 100000), ON_ARC);

    const arc = l.cLine().arc(0);

    // The arc mid *is* the cursor: the circle was constructed to pass through
    // it, and the new arc is the part of that circle between the two tangent
    // points, so its own midpoint is where the drag put it.
    near(arc.arcMid.x, 900000);
    near(arc.arcMid.y, 100000);

    // Tangency: the start lands on the horizontal line y = 0 and the end on the
    // vertical line x = 1e6, which are the two tangent lines of the corner.
    expect(arc.p0.y).toBe(0);
    expect(arc.p1.x).toBe(1000000);

    // And the centre is one radius from each of those lines.
    const centre = shapeArcCenter(arc);
    const radius = arcRadius(arc);

    near(centre.y, radius);
    near(1000000 - centre.x, radius);
  });

  it('shrinks the arc when dragged toward the corner', () => {
    const l = oneLegCollinear();

    lineDragArc(l, V(900000, 100000), ON_ARC);

    // The original radius is 1e6; pulling the cursor into the corner leaves a
    // much tighter fillet.
    expect(arcRadius(l.cLine().arc(0))).toBeLessThan(400000);
  });

  it('keeps the untouched prefix and suffix, and the line width', () => {
    const l = oneLegCollinear();

    lineDragArc(l, V(900000, 100000), ON_ARC);

    // Upstream rebuilds with `Slice`/`Append` rather than through a flattened
    // point array, so the vertices either side of the arc survive verbatim.
    expect(l.cLine().cPoint(0)).toEqual(V(-1000000, 0));
    expect(l.cLine().cLastPoint()).toEqual(V(2000000, 1000000));
    // `SHAPE_LINE_CHAIN::SetWidth` has no counterpart here; the width lives on
    // the LINE and has to survive `setShape`.
    expect(l.width()).toBe(100);
  });
});

describe('LINE::DragArc — the two silent cursor clamps', () => {
  it('a cursor far outside the corner triangle gives back the original arc', () => {
    // (3e6, -3e6) is on the far side of both tangent lines. Upstream projects
    // it onto whichever of the three bounding segments is nearest, which lands
    // it on the maximal circle — so the answer is the arc it started with.
    const l = oneLegCollinear();
    const before = l.cLine().arc(0);

    lineDragArc(l, V(3000000, -3000000), ON_ARC);

    const after = l.cLine().arc(0);

    near(after.p0.x, before.p0.x);
    near(after.p0.y, before.p0.y);
    near(after.p1.x, before.p1.x);
    near(after.p1.y, before.p1.y);
    near(arcRadius(after), arcRadius(before));
  });

  it('a cursor inside the maximal circle is pushed back out onto it', () => {
    // (5e5, 5e5) is inside the arc's own circle. Upstream replaces it with the
    // nearest point on the circumference — via the **VECTOR2I** overload of
    // `CIRCLE::NearestPoint`, which is why kimath needed one; the double
    // overload in `shape_collisions.ts` hands back a fractional point.
    const l = oneLegCollinear();

    lineDragArc(l, V(500000, 500000), ON_ARC);

    near(arcRadius(l.cLine().arc(0)), 1000000);
  });
});

describe('LINE::DragArc — the rebuild short-circuits', () => {
  it('drops the arc entirely when the new one is shorter than the stub limit', () => {
    // `m_MaxTrackLengthToKeep` is 0.0005 mm — 500 IU. A cursor 100 IU off the
    // corner produces tangent points closer together than that, and upstream
    // emits prefix + suffix with no arc at all rather than a sliver.
    const l = oneLegCollinear();

    lineDragArc(l, V(999900, 100), ON_ARC);

    expect(l.cLine().arcCount()).toBe(0);
    // What is left is the sharp corner the arc used to round off: the far
    // anchor of the leg it was allowed to eat, the pinned arc end, and the
    // outgoing run.
    expect(l.cLine().points()).toEqual([V(-1000000, 0), V(1000000, 1000000), V(2000000, 1000000)]);
  });

  it('swallows both legs when both neighbours are tangent and the drag is wide', () => {
    // With `useChainStart` and `useChainEnd` both true the arc may grow into
    // either leg, and a new endpoint within 500 IU of the leg's far anchor
    // snaps onto it — taking the whole leg with it. The result is a single arc
    // spanning the entire line.
    const l = bothLegsCollinear();

    lineDragArc(l, V(500000, 900000), ON_ARC);

    const arc = l.cLine().arc(0);

    expect(arc.p0).toEqual(V(-1000000, 0));
    expect(arc.p1).toEqual(V(1000000, 2000000));
    expect(l.cLine().cPoint(0)).toEqual(V(-1000000, 0));
    expect(l.cLine().cLastPoint()).toEqual(V(1000000, 2000000));
  });

  it('still pins the far end when only one neighbour is tangent', () => {
    // The same wide drag on the one-leg fixture cannot move the arc's far
    // endpoint, because that end has no collinear neighbour to eat into.
    const l = oneLegCollinear();

    lineDragArc(l, V(900000, 100000), ON_ARC);

    expect(l.cLine().cLastPoint()).toEqual(V(2000000, 1000000));
    expect(l.cLine().arc(0).p1.x).toBe(1000000);
  });
});
