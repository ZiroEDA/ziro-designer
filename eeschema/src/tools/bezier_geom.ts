// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Drawing a bezier: `EDA_SHAPE`'s edit states, which is all the tool is.
 *
 * `SCH_ACTIONS::drawBezier` runs the generic `SCH_DRAWING_TOOLS::DrawShape`,
 * and every shape it draws is driven by three `EDA_SHAPE` hooks — `beginEdit`
 * on the first click, `calcEdit` on every mouse move, and `continueEdit` on
 * each click after the first, which returns false when the shape is done. For a
 * bezier that is four clicks and a counter:
 *
 *     void EDA_SHAPE::beginEdit( const VECTOR2I& aPosition )
 *     case SHAPE_T::BEZIER:
 *         SetStart( aPosition ); SetEnd( aPosition );
 *         SetBezierC1( aPosition ); SetBezierC2( aPosition );
 *         m_editState = 1;
 *
 *     bool EDA_SHAPE::continueEdit( const VECTOR2I& aPosition )
 *     case SHAPE_T::BEZIER:
 *         if( m_editState == 3 ) return false;
 *         m_editState++;
 *         return true;
 *
 *     void EDA_SHAPE::calcEdit( const VECTOR2I& aPosition )
 *     case SHAPE_T::BEZIER:
 *         switch( m_editState )
 *         {
 *         case 1: SetBezierC2( aPosition ); SetEnd( aPosition ); break;
 *         case 2: SetBezierC1( aPosition ); break;
 *         case 3: SetBezierC2( aPosition ); break;
 *         }
 *
 * so the gesture reads straight off the three cases:
 *
 *   1. click the start, and a **straight line** follows the cursor — state 1
 *      drags the end point with C2 stuck to it, which is a degenerate cubic;
 *   2. click the far end, and the line is fixed. Now the cursor drags C1, so
 *      moving to either side **bows the line into a C** towards that side;
 *   3. click to set C1. Now the cursor drags C2, so moving to the other side
 *      **pulls the far half back into an S**;
 *   4. click to set C2, and the curve is finished.
 *
 * Point order is start, **end**, C1, C2 — the two ends first, then the two
 * handles. Not start, C1, end, C2: that is KiCad master, which replaced this
 * whole path with `EE_GRAPHIC_TOOL::DrawBezier` and a `BEZIER_GEOM_MANAGER`
 * that also reflects the last click about the end point and auto-chains the
 * next curve off it. 9.0.8 does none of that, and neither does this.
 *
 * The functions are pure — each returns the next state — so the canvas can hold
 * one in a ref and the tests can drive the whole gesture without a canvas.
 */

import type { Vec2 } from '../types.js';

/**
 * A bezier under construction: `m_editState` plus the four points of the
 * `EDA_SHAPE` it is filling in.
 */
export interface BezierDraw {
  /** 1 after the first click, then 2, then 3; a click at 3 finishes. */
  state: number;
  start: Vec2;
  c1: Vec2;
  c2: Vec2;
  end: Vec2;
}

/** `beginEdit`: the first click puts all four points on the cursor. */
export function beginBezier(p: Vec2): BezierDraw {
  return { state: 1, start: p, c1: p, c2: p, end: p };
}

/** `calcEdit`: what the cursor drags, which depends on the state. */
export function calcBezier(g: BezierDraw, p: Vec2): BezierDraw {
  switch (g.state) {
    // The end, with C2 pinned to it — a cubic whose last two points coincide
    // with the end, which draws as a straight line.
    case 1:
      return { ...g, c2: p, end: p };
    case 2:
      return { ...g, c1: p };
    case 3:
      return { ...g, c2: p };
    default:
      return g;
  }
}

/**
 * `continueEdit`: the click that ends state 3 ends the shape. Returns the next
 * state, or null when the curve is finished and ready to commit.
 */
export function continueBezier(g: BezierDraw): BezierDraw | null {
  return g.state === 3 ? null : { ...g, state: g.state + 1 };
}

/** The four points in file order, as `makeBezier` takes them. */
export function bezierPoints(g: BezierDraw): [Vec2, Vec2, Vec2, Vec2] {
  return [g.start, g.c1, g.c2, g.end];
}
