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
  type BezierDraw,
  beginBezier,
  bezierPoints,
  calcBezier,
  continueBezier,
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

describe('drawing one (EDA_SHAPE edit states)', () => {
  /** Click through a whole gesture, the way the tool feeds it: calc, then continue. */
  const click = (g: BezierDraw, p: Vec2): BezierDraw | null => continueBezier(calcBezier(g, p));

  it('is four clicks: start, end, C1, C2', () => {
    // Not start, C1, end, C2. `beginEdit` arms state 1, `continueEdit` steps it
    // to 2 and 3, and the click that finds it at 3 finishes the curve.
    let g = beginBezier(START);
    expect(g.state).toBe(1);
    g = click(g, END)!;
    expect(g.state).toBe(2);
    g = click(g, C1)!;
    expect(g.state).toBe(3);
    expect(click(g, C2)).toBe(null);
  });

  it('and the first stage is a straight line following the cursor', () => {
    // "case 1: SetBezierC2( aPosition ); SetEnd( aPosition );" — C2 sits on the
    // end, so the cubic is degenerate and draws as a line. We used to show a
    // bare control polygon here instead.
    const g = calcBezier(beginBezier(START), END);
    expect(bezierPoints(g)).toEqual([START, START, END, END]);
  });

  it('then the cursor bends it into a C, endpoints fixed', () => {
    // "case 2: SetBezierC1( aPosition );" — only C1 moves, so both ends stay
    // where they were put and the line bows towards the cursor.
    const g = calcBezier(click(beginBezier(START), END)!, C1);
    expect(bezierPoints(g)).toEqual([START, C1, END, END]);
  });

  it('then the cursor bends the far half into an S', () => {
    // "case 3: SetBezierC2( aPosition );" — the raw cursor *is* C2. Master
    // reflects it about the end point (BEZIER_GEOM_MANAGER::GetControlC2), so
    // there the same move bends the tail the other way; 9.0.8 does not.
    const g = calcBezier(click(click(beginBezier(START), END)!, C1)!, C2);
    expect(bezierPoints(g)).toEqual([START, C1, C2, END]);
  });

  it('and commits a plain four-point bezier in file order', () => {
    let g = calcBezier(beginBezier(START), END);
    g = calcBezier(continueBezier(g)!, C1);
    g = calcBezier(continueBezier(g)!, C2);
    expect(continueBezier(g)).toBe(null);
    const [p0, c1, c2, p1] = bezierPoints(g);
    const shape = makeBezier(p0, c1, c2, p1);
    expect(shape.kind === 'bezier' && shape.points).toEqual([START, C1, C2, END]);
  });

  it('and nothing is chained onto the end of it', () => {
    // Master's DrawBezier re-enters the draw loop with the finished curve's end
    // pre-loaded as the next one's start. 9.0.8's DrawShape sets `item` back to
    // nullptr, so the tool waits for a fresh first click.
    const g = calcBezier(click(click(beginBezier(START), END)!, C1)!, C2);
    expect(continueBezier(g)).toBe(null);
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
