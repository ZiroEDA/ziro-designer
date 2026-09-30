// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Differential pair discovery and coupling geometry.
 * Counterparts: `DRC_ENGINE::MatchDpSuffix` and `commonParallelProjection`
 * (`pns_diff_pair.cpp:821`).
 *
 * Two things carry the weight here, and each surprised me:
 *
 * 1. **A pair is discovered by name.** Nothing in the file declares one. The
 *    suffix matcher walks the name *backwards* over digits and underscores, so
 *    the polarity mark need not be the last character — `USB_D_P_1` pairs with
 *    `USB_D_N_1`. It also means `CLKP`/`CLKN` works with no separator at all.
 * 2. **The gap is measured on the overlap.** Two tracks of a pair are rarely
 *    aligned end to end, so both are clipped to the span over which they
 *    actually run alongside each other before anything is measured.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/drc/drc_engine.js';
import { commonParallelProjection } from '@ziroeda/pcbnew/router/pns_diff_pair.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const MM = (n: number): number => mmToIU(n);
/** The view-side spelling of `DRC_ENGINE::MatchDpSuffix`'s answer. */
const matchDpSuffix = (name: string) => {
  const m = DRC_ENGINE.MatchDpSuffix(name);
  return { polarity: m.polarity, complement: m.complementNet, baseName: m.baseDpName };
};
const P = (x: number, y: number): Vec2 => ({ x: MM(x), y: MM(y) });

describe('finding a pair by name', () => {
  it('reads a trailing P or N', () => {
    expect(matchDpSuffix('CLK_P')).toMatchObject({ polarity: 1, complement: 'CLK_N' });
    expect(matchDpSuffix('CLK_N')).toMatchObject({ polarity: -1, complement: 'CLK_P' });
  });

  it('reads a trailing + or -', () => {
    expect(matchDpSuffix('USB_D+')).toMatchObject({ polarity: 1, complement: 'USB_D-' });
    expect(matchDpSuffix('USB_D-')).toMatchObject({ polarity: -1, complement: 'USB_D+' });
  });

  it('needs no separator before the mark', () => {
    expect(matchDpSuffix('CLKP')).toMatchObject({ polarity: 1, complement: 'CLKN' });
  });

  it('walks back over digits and underscores, so the mark need not be last', () => {
    // The single most surprising rule, and the reason a plain "ends with P"
    // test would be wrong.
    expect(matchDpSuffix('USB_D_P_1')).toMatchObject({ polarity: 1, complement: 'USB_D_N_1' });
    expect(matchDpSuffix('A_N_12')).toMatchObject({ polarity: -1, complement: 'A_P_12' });
  });

  it('reports the base name, which names the pair itself', () => {
    expect(matchDpSuffix('CLK_P').baseName).toBe('CLK_');
  });

  it('finds no polarity in an ordinary net name', () => {
    expect(matchDpSuffix('DATA').polarity).toBe(0);
    expect(matchDpSuffix('NET1').polarity).toBe(0);
    expect(matchDpSuffix('GND').polarity).toBe(0);
  });

  it('finds none in a name whose only mark is at the front', () => {
    // +5V: the walk starts at the end and stops on 'V' immediately.
    expect(matchDpSuffix('+5V').polarity).toBe(0);
  });

  it('offers no complement at all when there is no polarity', () => {
    // The contract the caller relies on: a name with no polarity must not come
    // back with a plausible-looking complement to go looking for. Nothing today
    // would follow one — the engine tests the polarity first — but a half-built
    // answer is the kind of thing a later caller trusts.
    expect(matchDpSuffix('DATA')).toEqual({ polarity: 0, complement: '', baseName: '' });
    expect(matchDpSuffix('NET1').complement).toBe('');
  });
});

describe('clipping two tracks to where they run together', () => {
  it('keeps only the overlapping span', () => {
    const clipped = commonParallelProjection(
      { a: P(0, 0), b: P(10, 0) },
      { a: P(3, 1), b: P(20, 1) },
    );

    expect(clipped?.pClip.a).toEqual(P(3, 0));
    expect(clipped?.pClip.b).toEqual(P(10, 0));
  });

  it('projects the clip onto the other track too', () => {
    const clipped = commonParallelProjection(
      { a: P(0, 0), b: P(10, 0) },
      { a: P(3, 1), b: P(20, 1) },
    );

    expect(clipped?.nClip.a).toEqual(P(3, 1));
    expect(clipped?.nClip.b).toEqual(P(10, 1));
  });

  it('reports nothing when one track is entirely past the other', () => {
    // Not a coupled pair here: they are merely both on the board.
    expect(
      commonParallelProjection({ a: P(0, 0), b: P(10, 0) }, { a: P(20, 1), b: P(30, 1) }),
    ).toBeNull();
  });
});
