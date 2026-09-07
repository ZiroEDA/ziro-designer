// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DRAWING_TOOL::DrawBezier` and `drawOneBezier` — the click sequence, the
 * preview geometry, and the rule that chains one curve into the next.
 * Counterpart: `pcbnew/tools/drawing_tool.cpp`.
 *
 * The geometry itself is not here: it is {@link BezierGeomManager} in
 * `common/`, exactly as upstream keeps it in `common/preview_items/`. What is
 * here is the part `drawOneBezier` owns — which clicks lock in, what the
 * committed shape's four points are, and what the *next* curve starts with.
 *
 * The state a caller holds is a plain list of locked-in points, so a canvas can
 * keep it in the same ref every other drawing tool uses and Esc can drop it
 * with `[]`. The manager is rebuilt from that list on demand rather than held,
 * which is cheap (four `addPoint` calls) and means the preview and the commit
 * cannot drift apart: both read the same replay.
 *
 * ## Chaining
 *
 * `DrawBezier`'s loop is the reason the C2 reflection exists:
 *
 *     startingPoint = bezierRef.GetEnd();
 *     if( bezierRef.GetEnd() != bezierRef.GetBezierC2() )
 *         startingC1 = bezierRef.GetEnd() - ( bezierRef.GetBezierC2() - bezierRef.GetEnd() );
 *
 * and `drawOneBezier` locks both of those in before the user clicks again. Work
 * it through with `C2 = 2·end − clicked` and the seeded C1 comes out at
 * `clicked` — the very point the cursor was on when the curve finished. So the
 * next curve leaves the joint along the same line the last one arrived on, and
 * the two are tangent without the user aiming for it.
 *
 * The guard is not decoration: a curve whose C2 landed exactly on its end has
 * no direction to continue in, so the next one is seeded with the start alone
 * and the user picks a fresh C1.
 *
 * ## What is left out, and why it costs nothing
 *
 * Upstream's double-click "use the current point for all remaining points" is
 * not ported. It is a shortcut, not a capability: the one thing it can produce
 * that four ordinary clicks cannot is a curve whose C2 sits on its end, and
 * clicking the fourth point on the third does exactly that. No other drawing
 * tool here binds double-click either, so binding it for this one alone would
 * be the odd behaviour.
 */

import { BezierGeomManager, BezierStep } from '@ziroeda/common/src/index.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** The four control points of a `(gr_curve (pts …))`, in file order. */
export type BezierPoints = [Vec2, Vec2, Vec2, Vec2];

/** The curve as it stands, with the cursor supplying the step's live point. */
export interface BezierInFlight {
  readonly points: BezierPoints;
  /** Which point the cursor is currently dragging. */
  readonly step: BezierStep;
}

const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * Replay the locked-in points into a manager, then feed the cursor without
 * locking it in — `AddPoint( cursorPos, false )`, the motion case.
 */
function replay(locked: readonly Vec2[], cursor: Vec2 | null): BezierGeomManager {
  const m = new BezierGeomManager();
  for (const p of locked) m.addPoint(p, true);
  if (cursor) m.addPoint(cursor, false);
  return m;
}

/**
 * The bezier the preview should draw, or null before the first click.
 *
 * `locked` is the accepted clicks so far (0-3 of them) and `cursor` the snapped
 * mouse position. The C2 returned is the real one, already reflected.
 */
export function bezierInFlight(
  locked: readonly Vec2[],
  cursor: Vec2 | null,
): BezierInFlight | null {
  if (locked.length === 0 && !cursor) return null;
  const m = replay(locked, cursor);
  if (m.isReset()) return null;
  return {
    points: [m.getStart(), m.getControlC1(), m.getControlC2(), m.getEnd()],
    step: m.getBezierStep(),
  };
}

/**
 * The curve the preview should STROKE, or null while there is nothing to stroke
 * yet.
 *
 * `drawOneBezier` builds the `PCB_SHAPE` from the first click, but it only puts
 * it in the preview group once the manager reaches `SET_END`:
 *
 *     if( bezierManager.GetStep() == KIGFX::PREVIEW::BEZIER_GEOM_MANAGER::SET_END )
 *         preview.Add( bezier.get() );
 *
 * and that is not a detail. Before `SET_END` the manager has the end and both
 * control points sitting on C1, so the "curve" is a straight line lying exactly
 * under the dashed arm. Drawing it anyway puts two strokes on the same pixels,
 * one of them in the layer's colour at the shape's full width — which reads as
 * the tool drawing a straight line instead of a curve, because that is what it
 * is doing.
 *
 * The arms are the assistant's and are drawn at every step from
 * `SET_CONTROL1` on; only the curve waits.
 */
export function bezierPreviewCurve(live: BezierInFlight | null): BezierPoints | null {
  if (!live || live.step < BezierStep.SET_END) return null;
  return live.points;
}

/** What one left click does to the locked-in list. */
export type BezierClick =
  /** Still drawing: this is the new locked list. */
  | { readonly kind: 'continue'; readonly locked: Vec2[] }
  /** Finished: commit `points`, then start the next curve from `next`. */
  | { readonly kind: 'commit'; readonly points: BezierPoints; readonly next: Vec2[] };

/**
 * One left click of the bezier tool.
 *
 * The only click that can be refused is the end point: `setEnd` returns
 * `m_end != m_start`, and a rejected point makes `performStep` walk the manager
 * *backwards*. So clicking the end exactly on the start does not merely do
 * nothing — it un-locks C1 and leaves the user choosing it again, which is what
 * dropping the last entry here reproduces.
 */
export function bezierClick(locked: readonly Vec2[], at: Vec2): BezierClick {
  const step = locked.length as BezierStep;

  if (step === BezierStep.SET_END && !same(at, locked[0]!))
    return { kind: 'continue', locked: [...locked, at] };

  if (step === BezierStep.SET_END) return { kind: 'continue', locked: locked.slice(0, -1) };

  if (step < BezierStep.SET_CONTROL2) return { kind: 'continue', locked: [...locked, at] };

  const m = replay(locked, null);
  m.addPoint(at, true);
  const points: BezierPoints = [m.getStart(), m.getControlC1(), m.getControlC2(), m.getEnd()];
  return { kind: 'commit', points, next: bezierChainSeed(points) };
}

/**
 * `DrawBezier`'s `startingPoint` / `startingC1`, as a locked-in list for the
 * next curve — one point when the last curve ended flat, two when it did not.
 */
export function bezierChainSeed(points: BezierPoints): Vec2[] {
  const [, , c2, end] = points;
  if (same(end, c2)) return [end];
  return [end, { x: end.x - (c2.x - end.x), y: end.y - (c2.y - end.y) }];
}
