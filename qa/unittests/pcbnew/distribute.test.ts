// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Distributing items evenly.
 * Counterpart: `libs/kimath/src/geometry/distribute.cpp`. The tool that
 * feeds it is pinned in `tools/align_distribute_tool.test.ts`.
 *
 * By *gaps* and by *centres* are genuinely different operations, not two
 * spellings of one. Equal gaps leave items of different sizes unevenly spaced;
 * equal centres leave them unevenly separated. They agree whenever the two
 * *end* items are the same size — whatever the middle looks like — so the
 * fixture below deliberately gives them different widths. A fixture without
 * that passes under either algorithm and proves nothing; mine did, until the
 * divergence test caught it.
 */
import { describe, expect, it } from 'vitest';
import {
  deltasForDistributeByGaps,
  deltasForDistributeByPoints,
} from '@ziroeda/kimath/src/geometry/distribute.js';

describe('the maths', () => {
  it('leaves fewer than three items alone', () => {
    expect(deltasForDistributeByGaps([[0, 10]])).toEqual([0]);
    expect(
      deltasForDistributeByGaps([
        [0, 10],
        [20, 30],
      ]),
    ).toEqual([0, 0]);
    expect(deltasForDistributeByPoints([0, 100])).toEqual([0, 0]);
  });

  it('never moves the first or last item', () => {
    const d = deltasForDistributeByGaps([
      [0, 10],
      [15, 40],
      [90, 100],
    ]);

    expect(d[0]).toBe(0);
    expect(d[d.length - 1]).toBe(0);
  });

  it('equalises gaps, not positions', () => {
    // Spans 0-10, 15-40 (25 wide), 90-100. Space between inner edges is
    // 90-10 = 80, less the 25 the middle item occupies: 55 of gap over two
    // gaps, so 27.5 each. The middle item starts at 10 + 27.5 → 38 (rounded).
    const d = deltasForDistributeByGaps([
      [0, 10],
      [15, 40],
      [90, 100],
    ]);

    expect(15 + d[1]!).toBe(38);
  });

  it('equalises points regardless of size', () => {
    const d = deltasForDistributeByPoints([0, 10, 100]);

    // Midpoint of 0 and 100 is 50, so the middle point moves from 10 to 50.
    expect(10 + d[1]!).toBe(50);
  });

  it('does not stack rounding error across a long row', () => {
    // Ten points over a span that does not divide evenly: the last moved
    // point must still land where the exact arithmetic puts it.
    const positions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 1000];
    const d = deltasForDistributeByPoints(positions);
    const moved = positions.map((p, i) => p + d[i]!);

    expect(moved[8]).toBe(Math.round((8 * 1000) / 9));
  });
});
