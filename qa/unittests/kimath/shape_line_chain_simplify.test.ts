// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SHAPE_LINE_CHAIN::Simplify( int aTolerance )`
 * (`libs/kimath/src/geometry/shape_line_chain.cpp:2749-2841`).
 *
 * `ZONE_CREATE_HELPER::OnComplete` runs it on every zone and polygon the user
 * draws, as `chain.Simplify( true )` — the `bool` promoting to a tolerance of
 * **1 IU** on this overload. The traces below are stepped through the C++ by
 * hand; the algorithm is a greedy run collapse, not a pairwise collinearity
 * test, and the two differ on where the walk restarts.
 */
import { describe, expect, it } from 'vitest';
import { simplifyLineChain } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';

const pts = (chain: readonly { x: number; y: number }[]): [number, number][] =>
  chain.map((p) => [p.x, p.y]);

describe('simplifyLineChain', () => {
  /**
   * A rectangle with a redundant corner half way along its bottom edge.
   *
   * startIdx 0 walks end to index 3 — (50,0) is on (0,0)→(100,0) but not on
   * (0,0)→(100,100) — so the walk restarts at index 2 and (50,0) is dropped.
   */
  it('drops a point collinear with its neighbours on a closed chain', () => {
    const out = simplifyLineChain(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      true,
      1,
    );

    expect(pts(out)).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]);
  });

  /** A duplicate is trivially on the chord, so even a zero tolerance drops it. */
  it('drops a duplicated vertex at tolerance 0', () => {
    const out = simplifyLineChain(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      true,
      0,
    );

    expect(pts(out)).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
  });

  it('leaves a chain with a genuine corner alone', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(pts(simplifyLineChain(square, true, 1))).toEqual(pts(square));
  });

  it('returns a copy below three points', () => {
    // `if( PointCount() < 3 ) return;`
    const two = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];
    const out = simplifyLineChain(two, true, 1);
    expect(pts(out)).toEqual(pts(two));
    expect(out[0]).not.toBe(two[0]);
  });

  /**
   * The walk can stop before the end: with (0,0),(50,0),(100,0),(100,50) the
   * run collapse restarts at index 2, which is `n - 2`, and an open chain
   * breaks there — so (100,50) is only in the result because of the tail
   * fix-up. A closed chain has no such rule, since it wraps.
   */
  it('appends the end point a stopped walk never reached', () => {
    const out = simplifyLineChain(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ],
      false,
      1,
    );
    expect(pts(out)).toEqual([
      [0, 0],
      [100, 0],
      [100, 50],
    ]);
  });

  it('keeps an open chain’s original end point', () => {
    // "If we are not closed, then the start and end points of the original
    // line need to be the start and end points of the new line."
    const out = simplifyLineChain(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
      false,
      1,
    );
    expect(pts(out)).toEqual([
      [0, 0],
      [100, 0],
    ]);
  });
});
