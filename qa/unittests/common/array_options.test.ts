// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Array placement and numbering.
 * Counterparts: `common/array_options.cpp`, `common/array_axis.cpp` and
 * `AlphabeticFromIndex`.
 *
 * The numbering is the half most likely to be subtly wrong, because the
 * alphabetic schemes are *not* plain base-26: the column after Z is AA, not BA,
 * since A doubles as the first symbol and an implicit leading zero. A test that
 * only checks the first ten items never reaches the carry and proves nothing
 * about it.
 */
import { describe, expect, it } from 'vitest';
import {
  alphabeticFromIndex,
  axisItemNumber,
  axisNumberingOffset,
  circularItemNumber,
  circularTransform,
  gridArraySize,
  gridCoords,
  gridItemNumber,
  gridTransform,
  type ArrayGridOptions,
} from '@ziroeda/common/src/array_options.js';

const grid = (over: Partial<ArrayGridOptions> = {}): ArrayGridOptions => ({
  nx: 3,
  ny: 2,
  delta: { x: 100, y: 50 },
  ...over,
});

describe('numbering an axis', () => {
  it('counts numerically by default', () => {
    expect([0, 1, 2, 9, 10, 11].map((n) => axisItemNumber({}, n))).toEqual([
      '0',
      '1',
      '2',
      '9',
      '10',
      '11',
    ]);
  });

  it('starts where it is told and steps by what it is told', () => {
    expect([0, 1, 2].map((n) => axisItemNumber({ offset: 5, step: 2 }, n))).toEqual([
      '5',
      '7',
      '9',
    ]);
  });

  it('counts in hex', () => {
    expect([9, 10, 15, 16].map((n) => axisItemNumber({ type: 'hex' }, n))).toEqual([
      '9',
      'A',
      'F',
      '10',
    ]);
  });

  it('carries from Z to AA, not to BA', () => {
    // The one that catches a plain base-26 implementation: A is both the first
    // symbol and the implicit leading zero, as in a spreadsheet column.
    const a = { type: 'alphaFull' as const };

    expect(axisItemNumber(a, 0)).toBe('A');
    expect(axisItemNumber(a, 25)).toBe('Z');
    expect(axisItemNumber(a, 26)).toBe('AA');
    expect(axisItemNumber(a, 27)).toBe('AB');
    expect(axisItemNumber(a, 51)).toBe('AZ');
    expect(axisItemNumber(a, 52)).toBe('BA');
  });

  it('skips the letters that misread on a silkscreen', () => {
    // I, O, S, Q, X and Z are out: too easily read as 1, 0, 5, 0, a cross, 2.
    const a = { type: 'alphaNoIOSQXZ' as const };
    const first20 = Array.from({ length: 20 }, (_, n) => axisItemNumber(a, n)).join('');

    expect(first20).toBe('ABCDEFGHJKLMNPRTUVWY');
    expect(first20).not.toContain('I');
    expect(first20).not.toContain('O');
    expect(first20).not.toContain('Q');
  });

  it('lowercases when asked', () => {
    expect(axisItemNumber({ type: 'alphaFull', useLowercase: true }, 26)).toBe('aa');
  });

  it('reads a starting designator back to an index', () => {
    const a = { type: 'alphaFull' as const };

    expect(axisNumberingOffset(a, 'A')).toBe(0);
    expect(axisNumberingOffset(a, 'Z')).toBe(25);
    expect(axisNumberingOffset(a, 'AA')).toBe(26);
    expect(axisNumberingOffset({}, '42')).toBe(42);
  });

  it('round-trips a designator through the index and back', () => {
    const a = { type: 'alphaFull' as const };

    for (const s of ['A', 'M', 'Z', 'AA', 'AB', 'BZ', 'CA']) {
      expect(axisItemNumber({ ...a, offset: axisNumberingOffset(a, s)!, step: 0 }, 0)).toBe(s);
    }
  });

  it('accepts a lowercase start for an alphabetic axis', () => {
    expect(axisNumberingOffset({ type: 'alphaFull' }, 'c')).toBe(2);
  });

  it('refuses a designator the alphabet does not hold', () => {
    // How the dialog tells a typo from a valid start.
    expect(axisNumberingOffset({ type: 'alphaNoIOSQXZ' }, 'I')).toBeNull();
    expect(axisNumberingOffset({}, 'abc')).toBeNull();
    expect(axisNumberingOffset({}, '')).toBeNull();
  });

  it('builds from an explicit alphabet too', () => {
    expect(alphabeticFromIndex(3, '01', false)).toBe('11');
  });
});

describe('a grid array', () => {
  it('is nx by ny items', () => {
    expect(gridArraySize(grid())).toBe(6);
  });

  it('walks rows first by default', () => {
    expect([0, 1, 2, 3].map((n) => gridCoords(grid(), n))).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
    ]);
  });

  it('walks columns first when told to', () => {
    // The axis size becomes ny, so it wraps after 2 rather than 3.
    const o = grid({ horizontalThenVertical: false });

    expect([0, 1, 2].map((n) => gridCoords(o, n))).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
  });

  it('snakes when alternate rows are reversed', () => {
    // Row 1 runs the other way, so item 3 sits above item 2 rather than
    // starting the row again from the left.
    const o = grid({ reverseNumberingAlternate: true });

    expect(gridCoords(o, 3)).toEqual({ x: 2, y: 1 });
    expect(gridCoords(o, 5)).toEqual({ x: 0, y: 1 });
  });

  it('places items at multiples of the pitch', () => {
    const o = grid();

    expect(gridTransform(o, 0).offset).toEqual({ x: 0, y: 0 });
    expect(gridTransform(o, 1).offset).toEqual({ x: 100, y: 0 });
    expect(gridTransform(o, 3).offset).toEqual({ x: 0, y: 50 });
    expect(gridTransform(o, 4).offset).toEqual({ x: 100, y: 50 });
  });

  it('never rotates anything', () => {
    expect(gridTransform(grid(), 4).rotation).toBe(0);
  });

  it('skews each row by the offset', () => {
    // A per-row shift along the other axis: row 1 starts 10 to the right.
    const o = grid({ offset: { x: 10, y: 0 } });

    expect(gridTransform(o, 3).offset).toEqual({ x: 10, y: 50 });
    expect(gridTransform(o, 4).offset).toEqual({ x: 110, y: 50 });
  });

  it('centres the array on the original when asked', () => {
    // Extent is 2*100 by 1*50, so everything shifts back by (100, 25) and the
    // original ends up in the middle rather than at the top-left corner.
    const o = grid({ centred: true });

    expect(gridTransform(o, 0).offset).toEqual({ x: -100, y: -25 });
    expect(gridTransform(o, 5).offset).toEqual({ x: 100, y: 25 });
  });

  it('staggers every other row by half the pitch', () => {
    // Stagger 2 splits the rows into two phases; row 1 shifts by delta.x/2.
    const o = grid({ stagger: 2 });

    expect(gridTransform(o, 0).offset.x).toBe(0);
    expect(gridTransform(o, 3).offset.x).toBe(50);
  });

  it('staggers the other way for a negative stagger', () => {
    const o = grid({ stagger: -2 });

    expect(gridTransform(o, 3).offset.x).toBe(-50);
  });

  it('ignores a stagger of one, which is no stagger at all', () => {
    expect(gridTransform(grid({ stagger: 1 }), 3).offset.x).toBe(0);
  });

  it('staggers columns instead when told to', () => {
    const o = grid({ stagger: 2, staggerRows: false });

    // Column 1 shifts along y rather than row 1 shifting along x.
    expect(gridTransform(o, 1).offset.x).toBe(100);
    expect(gridTransform(o, 3).offset.x).toBe(0);
  });

  it('numbers straight through by default', () => {
    expect([0, 1, 4].map((n) => gridItemNumber(grid(), n))).toEqual(['0', '1', '4']);
  });

  it('numbers by row and column when asked', () => {
    // "B3" style: the primary axis gives the letter, the secondary the digit.
    const o = grid({
      twoDArrayNumbering: true,
      priAxis: { type: 'alphaFull' },
      secAxis: { type: 'numeric' },
    });

    expect(gridItemNumber(o, 0)).toBe('A0');
    expect(gridItemNumber(o, 1)).toBe('B0');
    expect(gridItemNumber(o, 3)).toBe('A1');
  });
});

describe('a circular array', () => {
  const centre = { x: 0, y: 0 };

  it('divides a full turn evenly when no angle is given', () => {
    // Four points at 90° apart. The start is at (100, 0) and KiCad's rotation
    // is clockwise on screen, so the first step goes to (0, -100).
    const o = { nPts: 4, centre };
    const at = (n: number) => circularTransform(o, n, { x: 100, y: 0 }).offset;

    expect(at(0)).toEqual({ x: 0, y: 0 });
    expect(at(1)).toEqual({ x: -100, y: -100 });
    expect(at(2)).toEqual({ x: -200, y: 0 });
    expect(at(3)).toEqual({ x: -100, y: 100 });
  });

  it('steps by a given angle instead', () => {
    const o = { nPts: 3, angle: 90, centre };

    expect(circularTransform(o, 1, { x: 100, y: 0 }).offset).toEqual({ x: -100, y: -100 });
  });

  it('reverses for a clockwise array', () => {
    const ccw = circularTransform({ nPts: 4, centre }, 1, { x: 100, y: 0 }).offset;
    const cw = circularTransform({ nPts: 4, centre, clockwise: true }, 1, { x: 100, y: 0 }).offset;

    expect(cw).not.toEqual(ccw);
    expect(cw).toEqual({ x: -100, y: 100 });
  });

  it('applies an angle offset to every copy, including the first', () => {
    // The offset turns the whole array, so even copy 0 moves — which is why the
    // original is left in place and copy 0's transform is never applied.
    const o = { nPts: 4, angleOffset: 90, centre };

    expect(circularTransform(o, 0, { x: 100, y: 0 }).offset).not.toEqual({ x: 0, y: 0 });
  });

  it('does not turn the copies unless asked', () => {
    expect(circularTransform({ nPts: 4, centre }, 1, { x: 100, y: 0 }).rotation).toBe(0);
  });

  it('turns each copy by its own angle when asked', () => {
    const o = { nPts: 4, centre, rotateItems: true };

    expect(circularTransform(o, 1, { x: 100, y: 0 }).rotation).toBe(90);
    expect(circularTransform(o, 2, { x: 100, y: 0 }).rotation).toBe(180);
  });

  it('numbers with its own axis', () => {
    expect(circularItemNumber({ nPts: 3, centre, axis: { type: 'alphaFull' } }, 1)).toBe('B');
  });
});
