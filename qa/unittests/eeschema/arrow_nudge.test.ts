// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Arrow-key nudging and the axis lock, counterpart the
 * m_lastKeyboardCursorPositionValid block of SCH_MOVE_TOOL::doMoveSelection.
 *
 * The lock is not a toggle, which is the reading these tests exist to pin down:
 * the opposite key releases, the same key holds, and a key for the other axis
 * *switches* rather than clearing.
 */
import { describe, it, expect } from 'vitest';
import {
  axisLockAfterArrow,
  applyAxisLock,
  arrowStep,
  alignToGrid,
  nudge,
  type ArrowNudgeState,
} from '@ziroeda/eeschema/src/tools/arrow_nudge.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Vec2 } from '@ziroeda/eeschema/src/types.js';

const GRID = mmToIU(1.27); // KiCad's 50 mil schematic grid
const at = (xmm: number, ymm: number): Vec2 => ({ x: mmToIU(xmm), y: mmToIU(ymm) });

describe('the axis lock state machine', () => {
  it('locks the horizontal axis on Left or Right', () => {
    expect(axisLockAfterArrow('none', null, 'left')).toBe('horizontal');
    expect(axisLockAfterArrow('none', null, 'right')).toBe('horizontal');
  });

  it('locks the vertical axis on Up or Down', () => {
    expect(axisLockAfterArrow('none', null, 'up')).toBe('vertical');
    expect(axisLockAfterArrow('none', null, 'down')).toBe('vertical');
  });

  it('releases when the opposite key on the same axis is pressed', () => {
    expect(axisLockAfterArrow('horizontal', 'left', 'right')).toBe('none');
    expect(axisLockAfterArrow('horizontal', 'right', 'left')).toBe('none');
    expect(axisLockAfterArrow('vertical', 'up', 'down')).toBe('none');
    expect(axisLockAfterArrow('vertical', 'down', 'up')).toBe('none');
  });

  it('holds when the same key is repeated', () => {
    expect(axisLockAfterArrow('horizontal', 'left', 'left')).toBe('horizontal');
    expect(axisLockAfterArrow('vertical', 'down', 'down')).toBe('vertical');
  });

  it('switches rather than clearing when the other axis is pressed', () => {
    // The "already locked to this axis" test fails, so the else arm assigns the
    // new axis outright. Locked horizontally, one Up leaves you locked
    // vertically — not free.
    expect(axisLockAfterArrow('horizontal', 'left', 'up')).toBe('vertical');
    expect(axisLockAfterArrow('vertical', 'up', 'left')).toBe('horizontal');
  });

  it('ignores an opposite key from the *other* axis', () => {
    // lastKey up, key left: different axes, so the opposite test never applies.
    expect(axisLockAfterArrow('horizontal', 'up', 'left')).toBe('horizontal');
  });

  it('compares against the immediately preceding arrow only', () => {
    // left, left, right -> the release test sees left then right, so it frees.
    let lock = axisLockAfterArrow('none', null, 'left');
    lock = axisLockAfterArrow(lock, 'left', 'left');
    expect(axisLockAfterArrow(lock, 'left', 'right')).toBe('none');
  });
});

describe('the step itself', () => {
  it('moves exactly one grid square, screen axes', () => {
    const c = at(10, 10);
    expect(arrowStep(c, 'left', GRID)).toEqual({ x: c.x - GRID, y: c.y });
    expect(arrowStep(c, 'right', GRID)).toEqual({ x: c.x + GRID, y: c.y });
    // Y grows downward in schematic coordinates, so Up subtracts.
    expect(arrowStep(c, 'up', GRID)).toEqual({ x: c.x, y: c.y - GRID });
    expect(arrowStep(c, 'down', GRID)).toEqual({ x: c.x, y: c.y + GRID });
  });

  it('aligns to the grid with snapping off', () => {
    expect(alignToGrid({ x: mmToIU(1.0), y: mmToIU(0.5) }, GRID)).toEqual({
      x: GRID,
      y: 0,
    });
  });
});

describe('holding the locked axis', () => {
  it('freezes y when locked horizontally', () => {
    expect(applyAxisLock(at(5, 9), at(1, 2), 'horizontal')).toEqual({
      x: mmToIU(5),
      y: mmToIU(2),
    });
  });

  it('freezes x when locked vertically', () => {
    expect(applyAxisLock(at(5, 9), at(1, 2), 'vertical')).toEqual({
      x: mmToIU(1),
      y: mmToIU(9),
    });
  });

  it('passes the cursor through when unlocked', () => {
    expect(applyAxisLock(at(5, 9), at(1, 2), 'none')).toEqual(at(5, 9));
  });
});

describe('a run of nudges', () => {
  // The origin must sit *on* the 1.27 mm grid, or the first align() moves it and
  // the test measures the snap instead of the step. 10 mm does not: it is
  // 7.87 grid squares.
  const ORIGIN = { x: 10 * GRID, y: 10 * GRID };
  const start = (): ArrowNudgeState => ({ cursor: ORIGIN, lock: 'none', lastKey: null });

  it('steps and locks on the first press', () => {
    const s = nudge(start(), 'right', GRID);
    expect(s.cursor).toEqual({ x: ORIGIN.x + GRID, y: ORIGIN.y });
    expect(s.lock).toBe('horizontal');
    expect(s.lastKey).toBe('right');
  });

  it('keeps travelling on repeats without drifting off the axis', () => {
    let s = start();
    for (let i = 0; i < 3; i++) s = nudge(s, 'right', GRID);
    expect(s.cursor).toEqual({ x: ORIGIN.x + 3 * GRID, y: ORIGIN.y });
    expect(s.lock).toBe('horizontal');
  });

  it('the opposite key steps back and frees the lock', () => {
    let s = nudge(start(), 'right', GRID);
    s = nudge(s, 'left', GRID);
    expect(s.cursor).toEqual(ORIGIN); // back where it began
    expect(s.lock).toBe('none');
  });

  it('a cross-axis press moves on the new axis and holds the old value', () => {
    // Locked horizontally, then Up: the lock becomes vertical, so x is held at
    // its previous value and only y steps.
    let s = nudge(start(), 'right', GRID);
    const beforeX = s.cursor.x;
    s = nudge(s, 'up', GRID);
    expect(s.lock).toBe('vertical');
    expect(s.cursor).toEqual({ x: beforeX, y: ORIGIN.y - GRID });
  });

  it('an off-grid start is pulled onto the grid by the first nudge', () => {
    // grid.SetSnap(false) then Align: the step lands on the grid rather than
    // carrying the original offset along.
    const off: ArrowNudgeState = {
      cursor: { x: 10 * GRID + 7, y: 10 * GRID + 3 },
      lock: 'none',
      lastKey: null,
    };
    const s = nudge(off, 'right', GRID);
    expect(s.cursor.x % GRID).toBe(0);
  });
});
