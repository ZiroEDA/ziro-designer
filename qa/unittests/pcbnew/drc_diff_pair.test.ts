// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Differential pair coupling.
 * Counterpart: `drc_test_provider_diff_pair_coupling.cpp`.
 *
 * Three things carry the weight here, and each surprised me:
 *
 * 1. **A pair is discovered by name.** Nothing in the file declares one. The
 *    suffix matcher walks the name *backwards* over digits and underscores, so
 *    the polarity mark need not be the last character — `USB_D_P_1` pairs with
 *    `USB_D_N_1`. It also means `CLKP`/`CLKN` works with no separator at all.
 * 2. **The gap is measured on the overlap.** Two tracks of a pair are rarely
 *    aligned end to end, so both are clipped to the span over which they
 *    actually run alongside each other before anything is measured.
 * 3. **The gap check hides behind the uncoupled check.** A gap violation is
 *    reported only when the pair is already failing its uncoupled length, or
 *    when there is no uncoupled rule at all. This looks like a bug and is not;
 *    there is a test for it precisely so nobody "fixes" it.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  commonParallelProjection,
  coupledSpans,
  evaluateDiffPair,
  matchDpSuffix,
  type DpTrack,
} from '@ziroeda/pcbnew/src/drc/drc_diff_pair.js';
import { type DrcOptions, runDrc } from '@ziroeda/pcbnew/src/drc/drc_engine.js';
import type { Board, PcbTrack } from '@ziroeda/pcbnew/src/types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const MM = (n: number): number => mmToIU(n);
const P = (x: number, y: number): Vec2 => ({ x: MM(x), y: MM(y) });
const EMPTY = { kind: 'list' as const, items: [] };

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

describe('the measured gap', () => {
  const track = (a: Vec2, b: Vec2, width = MM(0.2), layer = 'F.Cu'): DpTrack => ({
    a,
    b,
    width,
    layer,
  });

  it('is edge to edge, not centreline to centreline', () => {
    // Centrelines 0.4 apart, two 0.2-wide tracks: 0.4 - 0.1 - 0.1 = 0.2. What a
    // fabricator calls the gap.
    const spans = coupledSpans([track(P(0, 0), P(50, 0))], [track(P(0, 0.4), P(50, 0.4))]);

    expect(spans).toHaveLength(1);
    expect(spans[0]?.gap).toBe(MM(0.2));
  });

  it('grows when the tracks are wider apart', () => {
    const spans = coupledSpans([track(P(0, 0), P(50, 0))], [track(P(0, 1), P(50, 1))]);

    expect(spans[0]?.gap).toBe(MM(0.8));
  });

  it('is measured only over the overlap, so the length is the shared part', () => {
    const spans = coupledSpans([track(P(0, 0), P(50, 0))], [track(P(10, 0.4), P(30, 0.4))]);

    expect(spans[0]?.length).toBe(MM(20));
  });

  it('ignores a track on another layer', () => {
    expect(
      coupledSpans([track(P(0, 0), P(50, 0))], [track(P(0, 0.4), P(50, 0.4), MM(0.2), 'B.Cu')]),
    ).toEqual([]);
  });

  it('ignores a segment barely longer than an internal unit', () => {
    // At that size the direction is numerical noise: it is "parallel" to
    // everything and the projection it produces is meaningless.
    expect(
      coupledSpans(
        [{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, width: MM(0.2), layer: 'F.Cu' }],
        [track(P(0, 0.4), P(50, 0.4))],
      ),
    ).toEqual([]);
  });
});

describe('evaluating a pair', () => {
  const p: DpTrack[] = [{ a: P(0, 0), b: P(50, 0), width: MM(0.2), layer: 'F.Cu' }];
  const n: DpTrack[] = [{ a: P(0, 0.4), b: P(50, 0.4), width: MM(0.2), layer: 'F.Cu' }];

  it('counts a well-spaced run as fully coupled', () => {
    const r = evaluateDiffPair(p, n, { gapMin: MM(0.15), gapMax: MM(0.25) });

    expect(r.coupledLength).toBe(MM(50));
    expect(r.uncoupledLength).toBe(0);
    expect(r.gapViolations).toEqual([]);
  });

  it('does not count a run at the wrong spacing as coupled at all', () => {
    // Two tracks running alongside each other at the wrong gap are not a
    // coupled pair; they are two tracks near each other.
    const r = evaluateDiffPair(p, n, { gapMin: MM(0.5) });

    expect(r.coupledLength).toBe(0);
    expect(r.uncoupledLength).toBe(MM(50));
  });

  it('measures uncoupled length against the longer of the two nets', () => {
    const longP: DpTrack[] = [{ a: P(0, 0), b: P(80, 0), width: MM(0.2), layer: 'F.Cu' }];
    const r = evaluateDiffPair(longP, n, { gapMin: MM(0.15), gapMax: MM(0.25) });

    expect(r.totalLength).toBe(MM(80));
    expect(r.uncoupledLength).toBe(MM(30));
  });

  it('reports the uncoupled length only once it exceeds the maximum', () => {
    const longP: DpTrack[] = [{ a: P(0, 0), b: P(80, 0), width: MM(0.2), layer: 'F.Cu' }];

    expect(
      evaluateDiffPair(longP, n, { gapMin: MM(0.15), gapMax: MM(0.25), maxUncoupled: MM(40) })
        .uncoupledViolation,
    ).toBe(false);
    expect(
      evaluateDiffPair(longP, n, { gapMin: MM(0.15), gapMax: MM(0.25), maxUncoupled: MM(20) })
        .uncoupledViolation,
    ).toBe(true);
  });

  it('holds back gap violations while the uncoupled length is within its limit', () => {
    // Upstream's gate, and the thing most likely to be mistaken for a bug: a
    // pair that is mostly well coupled with one out-of-spec stretch reports
    // nothing, because that stretch is where a pair necessarily diverges.
    const r = evaluateDiffPair(p, n, { gapMin: MM(0.5), maxUncoupled: MM(100) });

    expect(r.gapViolations).toEqual([]);
  });

  it('releases them once the uncoupled length fails too', () => {
    const r = evaluateDiffPair(p, n, { gapMin: MM(0.5), maxUncoupled: MM(10) });

    expect(r.gapViolations.length).toBeGreaterThan(0);
    expect(r.gapViolations[0]?.failedMin).toBe(true);
  });

  it('reports them straight away when there is no uncoupled rule at all', () => {
    expect(evaluateDiffPair(p, n, { gapMin: MM(0.5) }).gapViolations.length).toBeGreaterThan(0);
  });

  it('separates a gap that is too wide from one that is too narrow', () => {
    const tooWide = evaluateDiffPair(p, n, { gapMax: MM(0.1) });

    expect(tooWide.gapViolations[0]?.failedMax).toBe(true);
    expect(tooWide.gapViolations[0]?.failedMin).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Through the engine
// ---------------------------------------------------------------------------

const track = (a: Vec2, b: Vec2, net: number, width = MM(0.2)): PcbTrack => ({
  start: a,
  end: b,
  width,
  layer: 'F.Cu',
  net,
  source: EMPTY,
});

const board = (tracks: PcbTrack[], names: [number, string][]): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([[0, ''], ...names]),
  footprints: [],
  tracks,
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  groups: [],
  source: EMPTY,
});

const OPTS: DrcOptions = {
  minClearance: 0,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

const dpCodes = ['diff_pair_gap_out_of_range', 'diff_pair_uncoupled_length_too_long'];
const dp = (b: Board, over: Partial<DrcOptions> = {}) =>
  runDrc(b, { ...OPTS, ...over }).filter((v) => dpCodes.includes(v.code));

describe('through the DRC engine', () => {
  const PAIR = [track(P(0, 0), P(50, 0), 1), track(P(0, 0.4), P(50, 0.4), 2)];
  const NAMES: [number, string][] = [
    [1, 'CLK_P'],
    [2, 'CLK_N'],
  ];

  it('says nothing about a pair spaced within its limits', () => {
    expect(dp(board(PAIR, NAMES), { diffPairGapMin: MM(0.1) })).toHaveLength(0);
  });

  it('reports a gap narrower than the minimum', () => {
    const found = dp(board(PAIR, NAMES), { diffPairGapMin: MM(0.5) });

    expect(found).toHaveLength(1);
    expect(found[0]?.code).toBe('diff_pair_gap_out_of_range');
    expect(found[0]?.message).toContain('CLK_');
  });

  it('leaves two nets that are not a pair alone', () => {
    // Same geometry, names with no polarity: nothing to be coupled.
    const notAPair: [number, string][] = [
      [1, 'DATA'],
      [2, 'GND'],
    ];

    expect(dp(board(PAIR, notAPair), { diffPairGapMin: MM(0.5) })).toHaveLength(0);
  });

  it('leaves a half-pair alone when its complement is not on the board', () => {
    const orphan: [number, string][] = [
      [1, 'CLK_P'],
      [2, 'UNRELATED'],
    ];

    expect(dp(board(PAIR, orphan), { diffPairGapMin: MM(0.5) })).toHaveLength(0);
  });

  it('reports each pair once, not once per half', () => {
    // Driven from the positive net only; otherwise P-then-N and N-then-P both
    // evaluate the same pair.
    expect(dp(board(PAIR, NAMES), { diffPairGapMin: MM(0.5) })).toHaveLength(1);
  });

  it('reports an uncoupled length over its maximum', () => {
    const stretched = [track(P(0, 0), P(80, 0), 1), track(P(0, 0.4), P(50, 0.4), 2)];
    const found = dp(board(stretched, NAMES), {
      diffPairGapMin: MM(0.1),
      diffPairMaxUncoupled: MM(10),
    });

    expect(found.some((v) => v.code === 'diff_pair_uncoupled_length_too_long')).toBe(true);
  });

  it('falls back to the board minimum clearance for the gap', () => {
    // Upstream's implicit netclass rule sets the diff-pair gap minimum to the
    // board's min clearance, so a board with nothing but netclasses still gets
    // the check.
    expect(dp(board(PAIR, NAMES), { minClearance: MM(0.5) })).toHaveLength(1);
  });

  it('has no maximum by default, so a wide pair is not a violation', () => {
    // The implicit rule sets a min and an opt but never a max. Reporting a
    // too-wide gap needs a custom rule.
    const wide = [track(P(0, 0), P(50, 0), 1), track(P(0, 5), P(50, 5), 2)];

    expect(dp(board(wide, NAMES), { diffPairGapMin: MM(0.1) })).toHaveLength(0);
    expect(dp(board(wide, NAMES), { diffPairGapMin: MM(0.1), diffPairGapMax: MM(1) })).toHaveLength(
      1,
    );
  });
});
