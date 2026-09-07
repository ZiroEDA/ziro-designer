// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The bezier tool: `BEZIER_GEOM_MANAGER` and the parts of
 * `DRAWING_TOOL::drawOneBezier` that decide what gets committed and what the
 * next curve starts with.
 *
 * Three things here are worth pinning because none of them would look wrong in
 * a screenshot until you tried to draw a second curve:
 *
 *  - the click order is start, **C1**, end, C2, not start, end, C1, C2. That is
 *    eeschema's order, and eeschema keeps it upstream too — the two editors
 *    really do differ;
 *  - the fourth click is *reflected about the end point* before it is stored,
 *    so the point the user clicked is not the point that reaches the file;
 *  - and the reflection is the whole reason the chaining works. Seeding the
 *    next curve's C1 with `end - ( C2 - end )` undoes the reflection exactly,
 *    landing it back on the clicked point, which is what makes two chained
 *    curves tangent at the joint.
 */
import { describe, expect, it } from 'vitest';
import {
  BezierGeomManager,
  BezierStep,
} from '@ziroeda/common/src/preview_items/bezier_geom_manager.js';
import {
  bezierChainSeed,
  bezierClick,
  bezierInFlight,
  bezierPreviewCurve,
  type BezierPoints,
} from '@ziroeda/pcbnew/src/bezier_tool.js';

const P = (x: number, y: number): { x: number; y: number } => ({ x, y });

describe('BEZIER_GEOM_MANAGER', () => {
  it('starts reset, and the first click puts all four points on the cursor', () => {
    // `setStart` assigns m_end, m_controlC1 and m_controlC2 as well, under the
    // comment "Prevents weird-looking loops if the control points aren't
    // initialized" — without it the preview after one click is a curve through
    // whatever the last one left behind.
    const m = new BezierGeomManager();
    expect(m.isReset()).toBe(true);
    expect(m.getBezierStep()).toBe(BezierStep.SET_START);

    m.addPoint(P(10, 10), true);
    expect(m.getBezierStep()).toBe(BezierStep.SET_CONTROL1);
    expect(m.getStart()).toEqual(P(10, 10));
    expect(m.getControlC1()).toEqual(P(10, 10));
    expect(m.getEnd()).toEqual(P(10, 10));
    expect(m.getControlC2()).toEqual(P(10, 10));
  });

  it('drags the end and C2 along with C1, so a straight line follows the cursor', () => {
    // `setControlC1` sets `m_end = m_controlC2 = m_controlC1`. A cubic whose
    // last three points coincide is a straight segment, which is exactly what
    // the user should see between click one and click two.
    const m = new BezierGeomManager();
    m.addPoint(P(0, 0), true);
    m.addPoint(P(100, 0), false);
    expect(m.getControlC1()).toEqual(P(100, 0));
    expect(m.getEnd()).toEqual(P(100, 0));
    expect(m.getControlC2()).toEqual(P(100, 0));
    // and the step has NOT moved, because lockIn was false
    expect(m.getBezierStep()).toBe(BezierStep.SET_CONTROL1);
  });

  it('refuses an end clicked on the start, and walks BACKWARDS a step', () => {
    // `setEnd` returns `m_end != m_start`, and `performStep( false )` decrements
    // rather than standing still. So the refusal costs the user their C1 too —
    // faithful, and the reason `bezierClick` drops a point instead of ignoring
    // the click.
    const m = new BezierGeomManager();
    m.addPoint(P(0, 0), true);
    m.addPoint(P(50, 50), true);
    expect(m.getBezierStep()).toBe(BezierStep.SET_END);
    m.addPoint(P(0, 0), true);
    expect(m.getBezierStep()).toBe(BezierStep.SET_CONTROL1);
  });

  it('reflects C2 about the end point', () => {
    // `return m_end - ( m_controlC2 - m_end )`.
    const m = new BezierGeomManager();
    m.addPoint(P(0, 0), true);
    m.addPoint(P(10, 0), true);
    m.addPoint(P(100, 0), true);
    m.addPoint(P(120, 30), true);
    expect(m.isComplete()).toBe(true);
    expect(m.getControlC2()).toEqual(P(80, -30));
  });

  it('backs a point out and re-accepts the raw cursor in the earlier step', () => {
    // `RemoveLastPoint`: `performStep( false )` then `acceptPoint( lastPoint )`,
    // so the preview shows the earlier step's geometry rather than a stale one.
    const m = new BezierGeomManager();
    m.addPoint(P(0, 0), true);
    m.addPoint(P(10, 0), true);
    expect(m.getBezierStep()).toBe(BezierStep.SET_END);
    m.removeLastPoint();
    expect(m.getBezierStep()).toBe(BezierStep.SET_CONTROL1);
    // re-accepted through setControlC1, which drags the end and C2 with it
    expect(m.getEnd()).toEqual(P(10, 0));
    expect(m.getControlC2()).toEqual(P(10, 0));
  });
});

describe('the four clicks of the tool', () => {
  it('locks in start, C1 and end, then commits on the fourth', () => {
    let locked: { x: number; y: number }[] = [];
    for (const p of [P(0, 0), P(0, 100), P(300, 100)]) {
      const r = bezierClick(locked, p);
      expect(r.kind).toBe('continue');
      if (r.kind === 'continue') locked = r.locked;
    }
    expect(locked).toEqual([P(0, 0), P(0, 100), P(300, 100)]);

    const done = bezierClick(locked, P(320, 40));
    expect(done.kind).toBe('commit');
    if (done.kind !== 'commit') return;
    // File order is start, C1, C2, end — and the C2 stored is the REFLECTION of
    // the clicked (320, 40) about the end (300, 100), i.e. (280, 160). A tool
    // that stored the click itself would put the handle on the wrong side of
    // the joint, and every chained curve after it would kink.
    expect(done.points).toEqual([P(0, 0), P(0, 100), P(280, 160), P(300, 100)]);
  });

  it('drops the locked C1 when the end is clicked on the start', () => {
    const locked = [P(0, 0), P(50, 50)];
    const r = bezierClick(locked, P(0, 0));
    expect(r).toEqual({ kind: 'continue', locked: [P(0, 0)] });
  });

  it('previews nothing before the first click', () => {
    expect(bezierInFlight([], null)).toBeNull();
    expect(bezierInFlight([], P(5, 5))).toBeNull();
  });

  it('previews the step the cursor is on', () => {
    // Two points locked in means the cursor is dragging the END, and `setEnd`
    // pins C2 to it: the preview is a curve from the start through C1 to the
    // cursor, with no second handle yet.
    const live = bezierInFlight([P(0, 0), P(0, 100)], P(300, 100));
    expect(live?.step).toBe(BezierStep.SET_END);
    expect(live?.points).toEqual([P(0, 0), P(0, 100), P(300, 100), P(300, 100)]);
  });
});

describe('what the preview may stroke, and when', () => {
  it('strokes nothing until the END has been locked in', () => {
    // Before SET_END the manager has the end and BOTH control points sitting on
    // C1, so the cubic it describes is a straight line lying exactly under the
    // dashed arm. Stroking it puts a second line on the same pixels in the
    // layer's colour at the shape's full width, and the tool looks like it is
    // drawing straight lines rather than curves.
    expect(bezierPreviewCurve(bezierInFlight([], { x: 5, y: 5 }))).toBeNull();
    expect(bezierPreviewCurve(bezierInFlight([{ x: 0, y: 0 }], { x: 5, y: 5 }))).toBeNull();
  });

  it('and strokes it from SET_END on, which is when upstream adds it', () => {
    const live = bezierInFlight([P(0, 0), P(0, 100)], P(300, 100));
    expect(live?.step).toBe(BezierStep.SET_END);
    expect(bezierPreviewCurve(live)).toEqual(live?.points);
  });

  it('but the ARMS are not gated on it — the first one shows from SET_CONTROL1', () => {
    // `if( step >= SET_CONTROL1 ) DrawLineDashed( start, GetControlC1(), … )`.
    // The arm is the only thing on screen at that step, and it has to be:
    // without it the first click leaves no feedback at all.
    const live = bezierInFlight([P(0, 0)], P(50, 50));
    expect(live?.step).toBe(BezierStep.SET_CONTROL1);
    expect(live?.points[0]).toEqual(P(0, 0));
    expect(live?.points[1]).toEqual(P(50, 50));
  });
});

describe('chaining one curve into the next', () => {
  it('seeds the next curve with the end and the point the cursor was on', () => {
    // The seeded C1 is `end - ( C2 - end )`, which un-does the reflection: the
    // curve committed above was finished with the cursor at (320, 40), and that
    // is where the next curve's C1 starts. Not (280, 160), the stored C2 — that
    // would bend the new curve back the way the old one came.
    const points: BezierPoints = [P(0, 0), P(0, 100), P(280, 160), P(300, 100)];
    expect(bezierChainSeed(points)).toEqual([P(300, 100), P(320, 40)]);
  });

  it('seeds only the start when the last curve ended flat', () => {
    // `if( bezierRef.GetEnd() != bezierRef.GetBezierC2() )` — a curve whose C2
    // landed on its end has no direction to continue in, so the user picks a
    // fresh C1 rather than inheriting a zero-length arm.
    const points: BezierPoints = [P(0, 0), P(0, 100), P(300, 100), P(300, 100)];
    expect(bezierChainSeed(points)).toEqual([P(300, 100)]);
  });

  it('and a chained curve leaves the joint along the line it arrived on', () => {
    // The property the whole reflection exists for, stated as a property rather
    // than as coordinates: the incoming tangent at the joint is `end - C2`, the
    // outgoing one is `C1' - start'`, and they must be the same vector.
    const first: BezierPoints = [P(0, 0), P(0, 100), P(280, 160), P(300, 100)];
    const seed = bezierChainSeed(first);
    const incoming = { x: first[3].x - first[2].x, y: first[3].y - first[2].y };
    const outgoing = { x: seed[1]!.x - seed[0]!.x, y: seed[1]!.y - seed[0]!.y };
    expect(outgoing).toEqual(incoming);
  });
});
