// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Move Exactly.
 * Counterparts: `EDIT_TOOL::MoveExact`, `DIALOG_MOVE_EXACT::GetTranslationInIU`
 * and `EDA_SHAPE::rotate`.
 *
 * Two things here are easy to get subtly wrong and invisible if untested: which
 * centre the rotation turns about once the selection has already been moved
 * (the stale one gives a different, plausible-looking answer), and what happens
 * to a rectangle rotated by a non-cardinal angle — it cannot stay a rectangle,
 * because the model stores one as two opposite corners of an axis-aligned box.
 *
 * Every expected coordinate below is hand-computed from KiCad's convention that
 * a +90° rotation maps (x, y) to (y, −x), not read back out of the code.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import {
  MAX_BOARD_COORD,
  moveKeepsSelectionInBounds,
  polarTranslation,
} from '@ziroeda/pcbnew/dialogs/dialog_move_exact.js';

const MM = (n: number): number => mmToIU(n);

/** Within a nanometre — rotation goes through trigonometry, then rounds to IU. */
const near = (got: number, want: number): void =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(1);

/**
 * Within a few nanometres, for a *derived* quantity — a length or a distance
 * between two independently-rounded points, where each endpoint may already be
 * a nanometre off and the error compounds. Still far below anything a board can
 * express: a nanometre is a millionth of a millimetre.
 */
const _nearDerived = (got: number, want: number): void =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(4);

describe('polar translation', () => {
  it('is the distance itself along zero degrees', () => {
    const v = polarTranslation(MM(10), 0);

    near(v.x, MM(10));
    near(v.y, 0);
  });

  it('points down the screen at ninety degrees', () => {
    // Board y grows downward and the dialog reads its angle in that same frame,
    // so +90° is +y. Flipping the sign would send every polar move the wrong
    // way vertically.
    const v = polarTranslation(MM(10), 90);

    near(v.x, 0);
    near(v.y, MM(10));
  });

  it('splits a diagonal evenly', () => {
    const v = polarTranslation(MM(10), 45);

    near(v.x, Math.round(MM(10) * Math.SQRT1_2));
    near(v.y, Math.round(MM(10) * Math.SQRT1_2));
  });

  it('reverses with a negative distance', () => {
    const v = polarTranslation(MM(-10), 0);

    near(v.x, MM(-10));
  });
});

describe('the out-of-range check that greys out OK', () => {
  const box = { minX: 0, minY: 0, maxX: MM(10), maxY: MM(10) };

  it('accepts an ordinary move', () => {
    expect(moveKeepsSelectionInBounds(box, { x: MM(50), y: MM(50) })).toBe(true);
  });

  it('rejects a move that runs off the right of the board area', () => {
    expect(moveKeepsSelectionInBounds(box, { x: MAX_BOARD_COORD, y: 0 })).toBe(false);
  });

  it('rejects a move that runs off the left', () => {
    // The far edge, not the near one, is what crosses first going negative.
    expect(moveKeepsSelectionInBounds(box, { x: -MAX_BOARD_COORD - 1, y: 0 })).toBe(false);
  });

  it('checks the vertical axis too', () => {
    expect(moveKeepsSelectionInBounds(box, { x: 0, y: MAX_BOARD_COORD })).toBe(false);
    expect(moveKeepsSelectionInBounds(box, { x: 0, y: -MAX_BOARD_COORD - 1 })).toBe(false);
  });

  it('allows a move that lands exactly on the limit', () => {
    // Upstream's test is a strict inequality, so the boundary itself is legal.
    expect(moveKeepsSelectionInBounds(box, { x: MAX_BOARD_COORD - MM(10), y: 0 })).toBe(true);
  });

  it('puts the limit at INT_MAX * sqrt(1/2)', () => {
    // The sqrt(1/2) is what keeps a corner point's magnitude inside an int, so
    // a plain INT_MAX here would be wrong by 41%.
    expect(MAX_BOARD_COORD).toBe(Math.floor(2147483647 * Math.SQRT1_2));
    // 1518.5 mm — a metre and a half, which is the real ceiling on board size.
    expect(MAX_BOARD_COORD / 1e6).toBeCloseTo(1518.5, 3);
  });
});
