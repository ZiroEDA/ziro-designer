// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SHAPE_T::BEZIER`: a **cubic**, stored as four control points.
 *
 * The bezier tool did not produce one. It flattened a *quadratic* — one control
 * point, three clicks — into a twenty-five point polyline:
 *
 *     g = makePolyline(quadPolyline(ds.points[0]!, p, ds.points[1]!));
 *
 * so the item in the file was a `(polyline)` of twenty-five vertices, and the
 * point editor, which gives one handle per stored point, put a handle on every
 * one of them. Upstream gives exactly four, because there are exactly four
 * points to give them to:
 *
 *     aPoints.AddPoint( m_bezier.GetStart() );
 *     aPoints.AddPoint( m_bezier.GetBezierC1() );
 *     aPoints.AddPoint( m_bezier.GetBezierC2() );
 *     aPoints.AddPoint( m_bezier.GetEnd() );
 *
 * and the drawing gesture is four clicks, in `BEZIER_GEOM_MANAGER`'s order:
 * `SET_START`, `SET_CONTROL1`, `SET_END`, `SET_CONTROL2`.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { makeBezier } from '@ziroeda/eeschema/src/tools/build-graphics.js';
import { hitTest } from '@ziroeda/eeschema/src/tools/hittest.js';
import {
  dragHandle,
  editHandles,
  pointEditTarget,
} from '@ziroeda/eeschema/src/tools/point_editor.js';
import {
  BEZIER_COMPLETE,
  BEZIER_SET_CONTROL1,
  BEZIER_SET_CONTROL2,
  BEZIER_SET_END,
  BEZIER_SET_START,
  bezierAddPoint,
  bezierC2,
  bezierChainFrom,
  bezierIsComplete,
  bezierRemoveLastPoint,
  bezierSetCursor,
  bezierShapePoints,
  newBezierGeom,
} from '@ziroeda/eeschema/src/tools/bezier_geom.js';
import type { LibSymbol, Schematic, Vec2 } from '@ziroeda/eeschema/src/types.js';

const at = (x: number, y: number): Vec2 => ({ x: mmToIU(x), y: mmToIU(y) });

/** A shallow S-curve: the control points sit well off the curve itself. */
const START = at(50, 100);
const C1 = at(70, 60);
const C2 = at(110, 140);
const END = at(130, 100);

const SRC = `(kicad_sch (version 20250114) (paper "A4") (lib_symbols)
  (bezier (pts (xy 50 100) (xy 70 60) (xy 110 140) (xy 130 100))
    (stroke (width 0) (type default)) (fill (type none)) (uuid "bz1")))`;

const doc = (): Schematic => readSchematic(parse(SRC));
const noLibs = new Map<string, LibSymbol>();

describe('a sheet-level bezier', () => {
  it('is read into graphics', () => {
    // `case T_bezier: screen->Append( parseSchBezier() );` — it used to fall
    // through unread, so nothing could draw or edit it.
    expect(doc().graphics.map((g) => g.kind)).toEqual(['bezier']);
  });

  it('with its four control points, in file order', () => {
    const g = doc().graphics[0]!;
    expect(g.kind === 'bezier' && g.points).toEqual([START, C1, C2, END]);
  });

  it('and round-trips exactly once through the file', () => {
    // Read into `graphics` *and* left in the source would write it twice, the
    // way rule areas once doubled on every save.
    const text = serializeSchematic(doc());
    expect(text.match(/\(bezier/g) ?? []).toHaveLength(1);
    expect(readSchematic(parse(text)).graphics.map((g) => g.kind)).toEqual(['bezier']);
  });

  it('an edited control point reaches the file', () => {
    const d = doc();
    const g = d.graphics[0]!;
    if (g.kind !== 'bezier') throw new Error('expected a bezier');
    const moved = { ...g, points: [START, at(70, 40), C2, END] };
    const back = readSchematic(parse(serializeSchematic({ ...d, graphics: [moved] }))).graphics[0]!;
    expect(back.kind === 'bezier' && back.points[1]).toEqual(at(70, 40));
  });
});

describe('the factory', () => {
  it('stores start, C1, C2, end in that order', () => {
    const g = makeBezier(START, C1, C2, END);
    expect(g.kind === 'bezier' && g.points).toEqual([START, C1, C2, END]);
  });

  it('and a drawn one survives a save and load', () => {
    const d = readSchematic(parse(`(kicad_sch (version 20250114) (paper "A4") (lib_symbols))`));
    const drawn = makeBezier(START, C1, C2, END);
    const back = readSchematic(parse(serializeSchematic({ ...d, graphics: [drawn] }))).graphics[0]!;
    expect(back.kind === 'bezier' && back.points).toEqual([START, C1, C2, END]);
  });
});

describe('its edit points', () => {
  it('are four, one per control point', () => {
    // Not twenty-five. This is the whole complaint.
    const d = doc();
    const t = pointEditTarget(d, 'graphic:idx:0');
    expect(t).not.toBe(null);
    expect(editHandles(d, t!)).toHaveLength(4);
  });

  it('sit on the control points, including the two off the curve', () => {
    const d = doc();
    const hs = editHandles(d, pointEditTarget(d, 'graphic:idx:0')!);
    expect(hs.map((h) => h.at)).toEqual([START, C1, C2, END]);
  });

  it('and every one of them is a point, not an edge', () => {
    // `MakePoints` adds four points and no lines; the two it does add are
    // indicator lines, which are drawn and never grabbed.
    const d = doc();
    const hs = editHandles(d, pointEditTarget(d, 'graphic:idx:0')!);
    expect(hs.every((h) => h.kind === 'point')).toBe(true);
  });

  it('dragging one moves that control point alone', () => {
    const d = doc();
    const t = pointEditTarget(d, 'graphic:idx:0')!;
    const hs = editHandles(d, t);
    const out = dragHandle(d, t, hs[1]!, at(70, 30));
    const g = out.graphics[0]!;
    expect(g.kind === 'bezier' && g.points).toEqual([START, at(70, 30), C2, END]);
  });
});

describe('drawing one (BEZIER_GEOM_MANAGER)', () => {
  /** Click the four points of a gesture, in the manager's order. */
  const draw = (...pts: Vec2[]) => pts.reduce((g, p) => bezierAddPoint(g, p), newBezierGeom());

  it('takes four clicks, one per step', () => {
    let g = newBezierGeom();
    expect(g.step).toBe(BEZIER_SET_START);
    g = bezierAddPoint(g, START);
    expect(g.step).toBe(BEZIER_SET_CONTROL1);
    g = bezierAddPoint(g, C1);
    expect(g.step).toBe(BEZIER_SET_END);
    g = bezierAddPoint(g, END);
    expect(g.step).toBe(BEZIER_SET_CONTROL2);
    expect(bezierIsComplete(g)).toBe(false);
    g = bezierAddPoint(g, at(150, 60));
    expect(g.step).toBe(BEZIER_COMPLETE);
    expect(bezierIsComplete(g)).toBe(true);
  });

  it('reflects the fourth click about the end point to get C2', () => {
    // `GetControlC2()` is `m_end - ( m_controlC2 - m_end )`, so a click 20 mm
    // right and 40 mm up of the end puts C2 20 mm left and 40 mm down of it.
    // Taking the click as C2 — what we did — bent the tail the other way, so
    // the gesture that draws an S in KiCad drew a C here.
    const g = draw(START, C1, END, at(150, 60));
    expect(bezierC2(g)).toEqual(at(110, 140));
    expect(bezierShapePoints(g)).toEqual([START, C1, at(110, 140), END]);
  });

  it('so the cursor lands on the next segment’s C1', () => {
    // Which is the reason the reflection exists: "so that the cursor will be
    // on the C1 point of the next bezier".
    const click = at(150, 60);
    expect(bezierChainFrom(draw(START, C1, END, click)).c1).toEqual(click);
  });

  it('previews a whole cubic from the first click, never a control polygon', () => {
    // Every acceptor seeds the points it has not been given, so `ApplyToShape`
    // always has four. The stages before the curve exists collapse onto a
    // straight line by themselves.
    const p0 = bezierSetCursor(bezierAddPoint(newBezierGeom(), START), at(60, 90));
    expect(bezierShapePoints(p0)).toEqual([START, at(60, 90), at(60, 90), at(60, 90)]);
    // At SET_END the curve is already bending towards C1 while the far end
    // follows the cursor — where ours drew two bare segments until click four.
    const p1 = bezierSetCursor(draw(START, C1), at(130, 100));
    expect(bezierShapePoints(p1)).toEqual([START, C1, END, END]);
  });

  it('does not advance when the end is clicked on the start point', () => {
    // `bool setEnd(…) { …; return m_end != m_start; }` — a rejected point
    // steps the manager back, so the gesture waits for a usable end.
    const g = bezierAddPoint(draw(START, C1), START);
    expect(g.step).toBe(BEZIER_SET_CONTROL1);
  });

  it('Backspace takes the last point back a step', () => {
    // ACTIONS::deleteLastPoint -> `aBehavior.RemoveLastPoint()`.
    const g = bezierRemoveLastPoint(draw(START, C1, END));
    expect(g.step).toBe(BEZIER_SET_END);
    // and the point it steps back to follows the cursor again
    expect(bezierShapePoints(bezierSetCursor(g, at(120, 90)))[3]).toEqual(at(120, 90));
  });

  it('chains the next curve off the end, tangent-continuous', () => {
    const done = draw(START, C1, END, at(150, 60));
    const next = bezierChainFrom(done);
    // start = the finished curve's end, C1 = the mirror of its last arm, so
    // two clicks (end, C2) finish the second segment rather than four.
    expect(next.start).toEqual(END);
    expect(next.step).toBe(BEZIER_SET_END);
    // C1 continuity: the arm leaving END points the same way the arm arriving
    // at it did.
    const arriving = { x: END.x - bezierC2(done).x, y: END.y - bezierC2(done).y };
    const leaving = { x: next.c1.x - END.x, y: next.c1.y - END.y };
    expect(arriving.x * leaving.y - arriving.y * leaving.x).toBe(0);
    expect(arriving.x * leaving.x + arriving.y * leaving.y).toBeGreaterThan(0);
  });

  it('and chains with only a start when the last arm had no length', () => {
    // "if( bezier->GetEnd() != bezier->GetBezierC2() )" — a C2 clicked on the
    // end point leaves no direction to continue, so nothing is pre-seeded.
    const next = bezierChainFrom(draw(START, C1, END, END));
    expect(next.start).toEqual(END);
    expect(next.step).toBe(BEZIER_SET_CONTROL1);
  });

  it('and a chained curve is committed as a plain four-point bezier', () => {
    const first = draw(START, C1, END, at(150, 60));
    const second = bezierAddPoint(bezierAddPoint(bezierChainFrom(first), at(190, 100)), at(210, 60));
    const [p0, c1, c2, p1] = bezierShapePoints(second);
    const g = makeBezier(p0, c1, c2, p1);
    expect(g.kind === 'bezier' && g.points).toEqual([END, at(150, 60), at(170, 140), at(190, 100)]);
  });
});

describe('selecting it', () => {
  it('hits on the curve, which does not pass through its control points', () => {
    // At t = 0.5 the curve is at the average of the four points weighted
    // 1:3:3:1, which for this S-curve is its midpoint — nowhere near C1 or C2.
    const mid = {
      x: (START.x + 3 * C1.x + 3 * C2.x + END.x) / 8,
      y: (START.y + 3 * C1.y + 3 * C2.y + END.y) / 8,
    };
    expect(hitTest(doc(), noLibs, mid, mmToIU(0.5))?.kind).toBe('graphic');
  });

  it('and misses out at a control point, where nothing is drawn', () => {
    // Hit-testing the control polygon instead — which is what ours did — makes
    // the curve grabbable along a line it is not drawn on, and the further the
    // controls are from the curve the wronger it gets.
    expect(hitTest(doc(), noLibs, C1, mmToIU(0.5))).toBe(null);
    expect(hitTest(doc(), noLibs, C2, mmToIU(0.5))).toBe(null);
  });

  it('and still hits at either end, which are on the curve', () => {
    expect(hitTest(doc(), noLibs, START, mmToIU(0.5))?.kind).toBe('graphic');
    expect(hitTest(doc(), noLibs, END, mmToIU(0.5))?.kind).toBe('graphic');
  });
});
