// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Arrow-key nudging during a move, and the axis lock that comes with it.
 * Counterpart: the `m_lastKeyboardCursorPositionValid` block of
 * `SCH_MOVE_TOOL::doMoveSelection` (eeschema/tools/sch_move_tool.cpp), driven by
 * `ACTIONS::cursorUp` / `cursorDown` / `cursorLeft` / `cursorRight`.
 *
 * An arrow pressed while something is on the cursor steps it one grid square,
 * with object snapping switched off for that step (`grid.SetSnap( false )`) so
 * the item lands on the grid rather than being pulled onto a nearby pin.
 *
 * The part that is easy to miss is the **axis lock**. Nudging with an arrow does
 * not merely step the cursor: it pins the *other* coordinate to where it was, so
 * a keyboard nudge cannot drift off-axis when the mouse is jogged afterwards.
 * The state machine is small but has one asymmetry worth stating plainly, since
 * "toggle the lock" is the obvious wrong reading:
 *
 *  - Left or Right locks the **horizontal** axis (y is frozen); Up or Down locks
 *    the **vertical** axis (x is frozen).
 *  - Pressing the *opposite* key on the axis you are already locked to releases
 *    the lock — Left then Right frees it again.
 *  - Pressing the *same* key keeps it. Repeated Lefts keep stepping left.
 *  - Pressing a key for the *other* axis switches the lock rather than clearing
 *    it, because the "already locked to this axis" test fails and the else arm
 *    simply assigns the new axis. Locked horizontally, one Up leaves you locked
 *    vertically, not free.
 *
 * `lastArrowKeyAction` is recorded on every arrow, whether or not the lock
 * changed, so the "opposite key" test always compares against the immediately
 * preceding arrow.
 */

import type { Vec2 } from '../types.js';

/** `SCH_MOVE_TOOL::AXIS_LOCK`. */
export type AxisLock = 'none' | 'horizontal' | 'vertical';

/** The four `ACTIONS::cursor*` directions. */
export type ArrowKey = 'left' | 'right' | 'up' | 'down';

const HORIZONTAL: readonly ArrowKey[] = ['left', 'right'];

const isOpposite = (a: ArrowKey | null, b: ArrowKey): boolean =>
  (a === 'left' && b === 'right') ||
  (a === 'right' && b === 'left') ||
  (a === 'up' && b === 'down') ||
  (a === 'down' && b === 'up');

/**
 * The lock after one arrow press, given the lock before it and the arrow before
 * that.
 */
export function axisLockAfterArrow(
  lock: AxisLock,
  lastKey: ArrowKey | null,
  key: ArrowKey,
): AxisLock {
  const axis: AxisLock = HORIZONTAL.includes(key) ? 'horizontal' : 'vertical';
  // Already locked to this axis: the opposite key releases, the same key holds.
  if (lock === axis) return isOpposite(lastKey, key) ? 'none' : axis;
  // Unlocked, or locked to the other axis: take this one.
  return axis;
}

/** One arrow step: a single grid square in that direction. */
export function arrowStep(cursor: Vec2, key: ArrowKey, grid: number): Vec2 {
  switch (key) {
    case 'left':
      return { x: cursor.x - grid, y: cursor.y };
    case 'right':
      return { x: cursor.x + grid, y: cursor.y };
    case 'up':
      return { x: cursor.x, y: cursor.y - grid };
    case 'down':
      return { x: cursor.x, y: cursor.y + grid };
  }
}

/**
 * Freeze the coordinate the lock holds, taking it from the previous cursor.
 *
 * Upstream applies this *after* the cursor has been recomputed, to the mouse
 * path as well as the keyboard one — which is the point of the lock: once an
 * arrow has fixed the axis, moving the mouse cannot pull the item off it.
 */
export function applyAxisLock(cursor: Vec2, prev: Vec2, lock: AxisLock): Vec2 {
  if (lock === 'horizontal') return { x: cursor.x, y: prev.y };
  if (lock === 'vertical') return { x: prev.x, y: cursor.y };
  return cursor;
}

/** `EE_GRID_HELPER::Align` with snapping off: the nearest grid square. */
export const alignToGrid = (p: Vec2, grid: number): Vec2 => ({
  x: Math.round(p.x / grid) * grid,
  y: Math.round(p.y / grid) * grid,
});

/** The running state a move keeps for the keyboard. */
export interface ArrowNudgeState {
  readonly cursor: Vec2;
  readonly lock: AxisLock;
  readonly lastKey: ArrowKey | null;
}

/**
 * One arrow press against the whole state: step, re-align to the grid, update
 * the lock, then hold the locked axis at its previous value.
 */
export function nudge(state: ArrowNudgeState, key: ArrowKey, grid: number): ArrowNudgeState {
  const lock = axisLockAfterArrow(state.lock, state.lastKey, key);
  const stepped = alignToGrid(arrowStep(state.cursor, key, grid), grid);
  return { cursor: applyAxisLock(stepped, state.cursor, lock), lock, lastKey: key };
}
