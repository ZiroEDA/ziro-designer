// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Cleanup Tracks & Vias, geometric passes: `TRACKS_CLEANER::cleanup` and the
 * `CleanupBoard` sequence around it.
 *
 * Most of what is pinned here looks like a bug on first reading and is not:
 * duplicate removal that no checkbox can switch off, more report rows than
 * removals, a dry run that finds strictly less than the real run, and a merge
 * test that lets an unnetted track through checks a netted one fails.
 *
 * The upstream regression boards (issue2904, issue5093, issue8883 …) are not in
 * this repo, and upstream's own harness passes `aDryRun = true` for both of its
 * runs, so it never exercises the mutating path at all. These boards are built
 * by hand instead, one behaviour each.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { segApproxCollinear } from '@ziroeda/kimath/src/geometry/seg.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { cleanupErrorText } from '@ziroeda/pcbnew/src/cleanup_item.js';
import {
  cleanupTrackGeometry,
  type TrackGeometryCleanupOptions,
} from '@ziroeda/pcbnew/src/tracks_cleaner.js';
import { Reporter } from '@ziroeda/common/src/reporter.js';
import type {
  Board,
  PcbArcTrack,
  PcbFootprint,
  PcbPad,
  PcbTrack,
  PcbVia,
} from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };
const P = (x: number, y: number) => ({ x, y });

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 2, name: 'B.Cu', kind: 'signal' },
    { id: 37, name: 'F.Mask', kind: 'user' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'N1'],
    [2, 'N2'],
  ]),
  footprints: [],
  tracks: [],
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
  barcodes: [],
  groups: [],
  source: EMPTY,
  ...over,
});

const track = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  over: Partial<PcbTrack> = {},
): PcbTrack => ({ start, end, width: 200, layer: 'F.Cu', net: 1, source: EMPTY, ...over });

const arc = (
  start: { x: number; y: number },
  mid: { x: number; y: number },
  end: { x: number; y: number },
  over: Partial<PcbArcTrack> = {},
): PcbArcTrack => ({
  start,
  mid,
  end,
  width: 200,
  layer: 'F.Cu',
  net: 1,
  source: EMPTY,
  ...over,
});

const via = (at: { x: number; y: number }, over: Partial<PcbVia> = {}): PcbVia => ({
  at,
  size: 600,
  drill: 300,
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net: 1,
  source: EMPTY,
  ...over,
});

/** One SMD pad on F.Cu, as its own footprint, so its id is `pad:<n>:0`. */
const padFootprint = (at: { x: number; y: number }, over: Partial<PcbPad> = {}): PcbFootprint =>
  ({
    lib: 'test:pad',
    at,
    angle: 0,
    layer: 'F.Cu',
    pads: [
      {
        number: '1',
        type: 'smd',
        shape: 'rect',
        at,
        angle: 0,
        size: P(1000, 1000),
        layers: ['F.Cu', 'F.Mask'],
        net: 1,
        source: EMPTY,
        ...over,
      },
    ],
    texts: [],
    shapes: [],
    source: EMPTY,
  }) as unknown as PcbFootprint;

const run = (b: Board, opts: Partial<TrackGeometryCleanupOptions> = {}) =>
  cleanupTrackGeometry(b, { dryRun: false, ...opts });

const codes = (items: { code: string }[]): string[] => items.map((i) => i.code);

// ---------------------------------------------------------------------------

describe('CLEANUP_ITEM report codes', () => {
  it('spells the nine track messages exactly as upstream does', () => {
    // These are `_HKI` msgids — the translation catalogue is keyed by the
    // literal, so "fixing" the hyphen in "co-linear" would drop every
    // translation of that row on the floor.
    expect(cleanupErrorText('shorting_track')).toBe('Remove track shorting two nets');
    expect(cleanupErrorText('shorting_via')).toBe('Remove via shorting two nets');
    expect(cleanupErrorText('redundant_via')).toBe('Remove redundant via');
    expect(cleanupErrorText('duplicate_track')).toBe('Remove duplicate track');
    expect(cleanupErrorText('merge_tracks')).toBe('Merge co-linear tracks');
    expect(cleanupErrorText('dangling_track')).toBe('Remove track not connected at both ends');
    expect(cleanupErrorText('dangling_via')).toBe('Remove via connected on less than 2 layers');
    expect(cleanupErrorText('zero_length_track')).toBe('Remove zero-length track');
    expect(cleanupErrorText('track_in_pad')).toBe('Remove track inside pad');
  });

  it('fills in the row title from the code, as the constructor does', () => {
    const res = run(board({ tracks: [track(P(0, 0), P(0, 0))] }), { removeNullSegments: true });

    // A row with no title is a row the dialog lists as blank.
    expect(res.items[0]?.title).toBe('Remove zero-length track');
    expect(res.items[0]?.items).toEqual(['track:0']);
  });
});

describe('zero-length segments', () => {
  it('reports and removes a track whose two ends coincide', () => {
    const b = board({ tracks: [track(P(0, 0), P(0, 0)), track(P(0, 0), P(10000, 0))] });
    const res = run(b, { removeNullSegments: true });

    expect(codes(res.items)).toEqual(['zero_length_track']);
    // If the removal did not happen the board would still carry an invisible,
    // unselectable segment that DRC keeps tripping over.
    expect(res.board.tracks.map((t) => t.end)).toEqual([P(10000, 0)]);
  });

  it('leaves the pass switched off when removeNullSegments is not asked for', () => {
    // `removeNullSegments` is `aMergeSegments || aRemoveMisConnected`; with both
    // checkboxes clear a zero-length track survives a cleanup run untouched.
    const res = run(board({ tracks: [track(P(0, 0), P(0, 0))] }));

    expect(res.items).toEqual([]);
    expect(res.board.tracks).toHaveLength(1);
  });

  it('reports a closed arc, because IsNull() does not exclude arcs', () => {
    // `IsNull()` is `Type() == PCB_VIA_T || m_Start == m_End`, and the caller
    // only guards vias — so a full-circle arc is destroyed by this pass. That
    // is upstream's behaviour and a port that spared arcs would keep geometry
    // KiCad deletes.
    const b = board({ arcs: [arc(P(0, 0), P(5000, 5000), P(0, 0))] });
    const res = run(b, { removeNullSegments: true });

    expect(codes(res.items)).toEqual(['zero_length_track']);
    expect(res.items[0]?.items).toEqual(['arc:0']);
    expect(res.board.arcs).toHaveLength(0);
  });

  it('never reports a via, whose start and end always coincide', () => {
    // `IsNull()` is true for every via, which is exactly why the caller tests
    // `Type() != PCB_VIA_T` first. Drop that guard and the pass eats the board.
    const res = run(board({ vias: [via(P(0, 0))] }), { removeNullSegments: true });

    expect(res.items).toEqual([]);
    expect(res.board.vias).toHaveLength(1);
  });
});

describe('duplicate segments', () => {
  const three = () =>
    board({
      tracks: [
        track(P(0, 0), P(10000, 0)),
        track(P(0, 0), P(10000, 0)),
        track(P(0, 0), P(10000, 0)),
      ],
    });

  it('reports three rows and removes two of three identical tracks', () => {
    const res = run(three());

    // A finds B and C and is pushed once per partner; B then finds only C,
    // because A is now both IS_DELETED and SKIP_STRUCT; C finds nothing. The
    // asymmetry is what makes the *last* member of a duplicate group survive.
    expect(codes(res.items)).toEqual(['duplicate_track', 'duplicate_track', 'duplicate_track']);
    expect(res.items.map((i) => i.items)).toEqual([['track:0'], ['track:0'], ['track:1']]);
    expect(res.board.tracks).toHaveLength(1);
  });

  it('runs whether or not co-linear merging is asked for', () => {
    // Step 2 folds the duplicate pass into the merge call and step 4 runs it on
    // its own when merging is off; there is no checkbox that turns it off, and
    // wiring one is the single likeliest way to get this port wrong.
    for (const mergeSegments of [false, true]) {
      const res = run(three(), { mergeSegments });

      expect(codes(res.items)).toEqual(['duplicate_track', 'duplicate_track', 'duplicate_track']);
      expect(res.board.tracks).toHaveLength(1);
    }
  });

  it('counts a reversed duplicate, because IsPointOnEnds tests both ends', () => {
    const b = board({ tracks: [track(P(0, 0), P(10000, 0)), track(P(10000, 0), P(0, 0))] });
    const res = run(b);

    expect(codes(res.items)).toEqual(['duplicate_track']);
    expect(res.board.tracks).toHaveLength(1);
  });

  it('does not count a track that is one IU off', () => {
    // `IsPointOnEnds( p, 0 )` is exact integer equality, not a tolerance. A port
    // that used the DRC epsilon here would delete real, distinct copper.
    const b = board({ tracks: [track(P(0, 0), P(10000, 0)), track(P(0, 0), P(10001, 0))] });

    expect(run(b).items).toEqual([]);
  });

  it('does not count tracks that differ only in width or only in layer', () => {
    const widths = board({
      tracks: [track(P(0, 0), P(10000, 0)), track(P(0, 0), P(10000, 0), { width: 300 })],
    });
    const layers = board({
      tracks: [track(P(0, 0), P(10000, 0)), track(P(0, 0), P(10000, 0), { layer: 'B.Cu' })],
    });

    expect(run(widths).items).toEqual([]);
    expect(run(layers).items).toEqual([]);
  });

  it('excludes arcs from the duplicate pass entirely', () => {
    // The branch is `Type() == PCB_TRACE_T`, so two identical arcs are left
    // alone even though they are as duplicated as two identical traces.
    const one = arc(P(0, 0), P(5000, 2000), P(10000, 0));
    const res = run(board({ arcs: [one, { ...one }] }));

    expect(res.items).toEqual([]);
    expect(res.board.arcs).toHaveLength(2);
  });
});

describe('merging co-linear segments', () => {
  const pair = (over: Partial<Board> = {}) =>
    board({
      tracks: [
        track(P(0, 0), P(10000, 0), { uuid: 'seg-a' }),
        track(P(10000, 0), P(20000, 0), { uuid: 'seg-b' }),
      ],
      ...over,
    });

  it('merges an end-to-end pair into the earlier track, keeping its uuid', () => {
    const res = run(pair(), { mergeSegments: true });

    expect(codes(res.items)).toEqual(['merge_tracks']);
    // Both items are named, seg1 first: the dialog highlights the pair.
    expect(res.items[0]?.items).toEqual(['track:0', 'track:1']);
    expect(res.board.tracks).toHaveLength(1);
    // `*aSeg1 = dummy_seg` goes through `EDA_ITEM::operator=`, which does not
    // copy the KIID — losing the uuid here would orphan every reference to the
    // surviving track.
    expect(res.board.tracks[0]?.uuid).toBe('seg-a');
    expect(res.board.tracks[0]?.width).toBe(200);
    expect(res.board.tracks[0]?.start).toEqual(P(0, 0));
    expect(res.board.tracks[0]?.end).toEqual(P(20000, 0));
  });

  it('does nothing when merging is not asked for', () => {
    expect(run(pair()).items).toEqual([]);
  });

  it('takes the merged diagonal from seg1 alone', () => {
    // `(s.x > e.x) == (s.y > e.y)` picks min→max, otherwise (minX,maxY)→(maxX,minY).
    // seg1 here runs *backwards* along the descending diagonal, so the merged
    // segment does not simply inherit its direction.
    const descending = board({
      tracks: [track(P(10000, 10000), P(0, 0)), track(P(10000, 10000), P(20000, 20000))],
    });
    const merged = run(descending, { mergeSegments: true }).board.tracks[0];

    expect(merged?.start).toEqual(P(0, 0));
    expect(merged?.end).toEqual(P(20000, 20000));

    const antiDiagonal = board({
      tracks: [track(P(0, 10000), P(10000, 0)), track(P(10000, 0), P(20000, -10000))],
    });
    const other = run(antiDiagonal, { mergeSegments: true }).board.tracks[0];

    expect(other?.start).toEqual(P(0, 10000));
    expect(other?.end).toEqual(P(20000, -10000));
  });

  it('refuses when a third track branches off the shared point', () => {
    // The T-stub sets p1e and p2s — a popcount of 2, so it survives the "node in
    // the centre" test — and is then caught by the rule that every attachment
    // point must still be an endpoint of the merged segment. Merging anyway
    // would silently disconnect the stub.
    const res = run(pair({ tracks: [...pair().tracks, track(P(10000, 0), P(10000, 10000))] }), {
      mergeSegments: true,
    });

    expect(res.items).toEqual([]);
    expect(res.board.tracks).toHaveLength(3);
  });

  it('refuses when more than two distinct points carry attachments', () => {
    const res = run(
      pair({
        tracks: [
          ...pair().tracks,
          track(P(10000, 0), P(10000, 10000)),
          track(P(0, 0), P(0, 10000)),
        ],
      }),
      { mergeSegments: true },
    );

    // p1s, p1e and p2s are all set, and `popcount( flags ) > 2` rejects before
    // the geometry is even computed.
    expect(res.items).toEqual([]);
  });

  it('refuses on the popcount rule alone, where the endpoint rule would allow it', () => {
    // The two traces *overlap* rather than abut, sharing (0,0), so the merged
    // segment is A itself and every attachment point is still an endpoint of it
    // — the "every flag must survive" rule is satisfied. What refuses the merge
    // is `popcount( flags ) > 2`: the stub at (0,0) sets p1s *and* p2s, the stub
    // at (20000,0) sets p1e, and the mask counts bits rather than distinct
    // locations. This is the only shape of board where the two rules disagree,
    // so without it the popcount test is dead weight.
    const overlapping = board({
      tracks: [
        track(P(0, 0), P(20000, 0)),
        track(P(0, 0), P(10000, 0)),
        track(P(0, 0), P(0, 10000)),
        track(P(20000, 0), P(20000, 10000)),
      ],
    });
    const res = run(overlapping, { mergeSegments: true });

    expect(res.items).toEqual([]);
    expect(res.board.tracks).toHaveLength(4);
  });

  it('refuses when a pad sits on the shared point', () => {
    // A pad is not a track, so its bit is set by `HitTest` at `(width + 1) / 2`
    // rather than by exact endpoint equality — a different code path to the
    // T-junction above, and the one that protects real routing into a pad.
    const res = run(pair({ footprints: [padFootprint(P(10000, 0))] }), { mergeSegments: true });

    expect(res.items).toEqual([]);
    expect(res.board.tracks).toHaveLength(2);
  });

  it('refuses when a via sits on the shared point', () => {
    const res = run(pair({ vias: [via(P(10000, 0))] }), { mergeSegments: true });

    expect(res.items).toEqual([]);
  });

  it('merges an unnetted pair even through a T-junction', () => {
    // `GetConnectedItems` drops items with `Net() <= 0` before it clusters, so
    // an unnetted segment gets an empty cluster, every attachment test is
    // vacuous, and the merge goes through checks a netted pair fails. Pinned
    // because it is the one case where "no net" is not the same as "some net".
    const res = run(
      board({
        tracks: [
          track(P(0, 0), P(10000, 0), { net: 0 }),
          track(P(10000, 0), P(20000, 0), { net: 0 }),
          track(P(10000, 0), P(10000, 10000), { net: 0 }),
        ],
      }),
      { mergeSegments: true },
    );

    expect(codes(res.items)).toEqual(['merge_tracks']);
    expect(res.board.tracks[0]?.end).toEqual(P(20000, 0));
  });

  it('refuses the whole segment when a different-width track is attached to it', () => {
    // Necking down between pads: any connected trace of another width, at either
    // end, takes the segment out of the pass. The blocked segment is seg1 of the
    // pair that would otherwise merge, so the pair is never even considered.
    const necked = board({
      tracks: [
        track(P(0, 0), P(10000, 0)),
        track(P(10000, 0), P(20000, 0)),
        track(P(0, 0), P(0, -10000), { width: 400 }),
      ],
    });

    expect(run(necked, { mergeSegments: true }).items).toEqual([]);
    // …and without the wide stub the same two tracks do merge, so the test is
    // pinning the width rule rather than some other refusal.
    expect(codes(run(pair(), { mergeSegments: true }).items)).toEqual(['merge_tracks']);
  });

  it('never merges arcs or vias', () => {
    const res = run(
      board({
        arcs: [
          arc(P(0, 0), P(5000, 100), P(10000, 0)),
          arc(P(10000, 0), P(15000, 100), P(20000, 0)),
        ],
      }),
      { mergeSegments: true },
    );

    expect(res.items).toEqual([]);
    expect(res.board.arcs).toHaveLength(2);
  });
});

describe('dry run versus real run', () => {
  const chain = () =>
    board({
      tracks: [
        track(P(0, 0), P(10000, 0)),
        track(P(10000, 0), P(20000, 0)),
        track(P(20000, 0), P(30000, 0)),
      ],
    });

  it('finds one merge on a dry run and two on a real one, for the same board', () => {
    // One scan collects (A,B) and (B,C); applying (A,B) flags B, so (B,C) is
    // skipped. A real run then rewrites A's geometry, the next iteration sees A
    // touching C, and merges again. A dry run rewrote nothing, so there is
    // nothing more to find. The two counts *should* differ; a port that made
    // them agree has stopped mirroring upstream.
    const dry = cleanupTrackGeometry(chain(), { dryRun: true, mergeSegments: true });
    const real = cleanupTrackGeometry(chain(), { dryRun: false, mergeSegments: true });

    expect(codes(dry.items)).toEqual(['merge_tracks']);
    expect(codes(real.items)).toEqual(['merge_tracks', 'merge_tracks']);
    expect(real.board.tracks).toHaveLength(1);
    expect(real.board.tracks[0]?.end).toEqual(P(30000, 0));
  });

  it('reports zero-length and duplicate tracks on a dry run without removing them', () => {
    // `removeItems` is gated on `!m_dryRun` for both passes. A dry run that
    // deleted would make the dialog's first press destructive, and the user
    // never gets to press "Update PCB".
    const nulls = board({ tracks: [track(P(0, 0), P(0, 0))] });
    const dupes = board({ tracks: [track(P(0, 0), P(10000, 0)), track(P(0, 0), P(10000, 0))] });

    const nullRes = cleanupTrackGeometry(nulls, { dryRun: true, removeNullSegments: true });
    const dupeRes = cleanupTrackGeometry(dupes, { dryRun: true });

    expect(codes(nullRes.items)).toEqual(['zero_length_track']);
    expect(nullRes.board.tracks).toHaveLength(1);
    expect(codes(dupeRes.items)).toEqual(['duplicate_track']);
    expect(dupeRes.board.tracks).toHaveLength(2);
  });

  it('leaves the input board untouched on a dry run', () => {
    const b = chain();
    const before = JSON.stringify(b.tracks);
    const res = cleanupTrackGeometry(b, { dryRun: true, mergeSegments: true });

    // The dialog runs the cleaner twice against the same board and only the
    // second run may modify it; a dry run that mutated would make "Build
    // changes" destructive.
    expect(res.board).toBe(b);
    expect(JSON.stringify(b.tracks)).toBe(before);
  });

  it('reports the two progress lines with the mode-appropriate wording', () => {
    const dry = new Reporter();
    const real = new Reporter();

    cleanupTrackGeometry(board(), { dryRun: true, reporter: dry });
    cleanupTrackGeometry(board(), { dryRun: false, reporter: real });

    expect(dry.lines.map((l) => l.message)).toEqual([
      'Checking null tracks and vias...',
      'Checking redundant tracks...',
    ]);
    expect(real.lines.map((l) => l.message)).toEqual([
      'Removing null tracks and vias...',
      'Removing redundant tracks...',
    ]);
  });
});

describe('locked and filtered items', () => {
  it('skips a locked track in the duplicate pass, so the locked copy survives', () => {
    // The outer guard drops the locked track as a *reference*, but nothing stops
    // it being a *partner* — so the unlocked copy is the one reported and
    // removed. Reversing that would delete copper the user pinned.
    const b = board({
      tracks: [track(P(0, 0), P(10000, 0), { locked: true }), track(P(0, 0), P(10000, 0))],
    });
    const res = run(b);

    expect(res.items.map((i) => i.items)).toEqual([['track:1']]);
    expect(res.board.tracks[0]?.locked).toBe(true);
  });

  it('refuses a merge when either segment is locked', () => {
    // `testMergeCollinearSegments` checks both, and the candidate scan checks
    // neither — so the refusal has to come from the test, not from the scan.
    const b = board({
      tracks: [track(P(0, 0), P(10000, 0)), track(P(10000, 0), P(20000, 0), { locked: true })],
    });

    expect(run(b, { mergeSegments: true }).items).toEqual([]);
  });

  it('treats a track inside a locked group as locked', () => {
    const b = board({
      tracks: [track(P(0, 0), P(10000, 0), { uuid: 'in-group' }), track(P(0, 0), P(10000, 0))],
      groups: [{ name: 'g', uuid: 'g-1', locked: true, members: ['in-group'], source: EMPTY }],
    });

    expect(run(b).items.map((i) => i.items)).toEqual([['track:1']]);
  });

  it('EXCLUDES the items the filter returns true for', () => {
    // The polarity reads backwards and is upstream's: `filterItem() == true`
    // means "leave this one alone".
    const b = board({
      tracks: [track(P(0, 0), P(10000, 0)), track(P(0, 0), P(10000, 0))],
    });
    const res = run(b, { filter: (id) => id === 'track:0' });

    expect(res.items.map((i) => i.items)).toEqual([['track:1']]);
  });
});

describe('the merged track survives serialization', () => {
  const BOARD = `(kicad_pcb (version 20240108) (generator pcbnew)
  (general (thickness 1.6))
  (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (net 1 "N1")
  (segment (start 0 0) (end 10 0) (width 0.2) (layer "F.Cu") (net 1) (uuid "aaa"))
  (segment (start 10 0) (end 20 0) (width 0.2) (layer "F.Cu") (net 1) (uuid "bbb"))
)`;

  it('patches (start …) / (end …) in the surviving segment and drops the other', () => {
    // The writer passes a track's own s-expression through, so a merge that
    // updated only the model would save the *old* endpoints and the merge would
    // silently undo itself on reload.
    const res = cleanupTrackGeometry(readBoard(parse(BOARD)), {
      dryRun: false,
      mergeSegments: true,
    });
    const text = serializeBoard(res.board);

    expect(text).toContain('(start 0 0)');
    expect(text).toContain('(end 20 0)');
    expect(text).not.toContain('(end 10 0)');
    expect(text.match(/\(segment/g)).toHaveLength(1);
    expect(text).toContain('"aaa"');
    expect(text).not.toContain('"bbb"');
  });
});

describe('SEG::ApproxCollinear at board scale', () => {
  // The line here runs from the origin to (1e9, 999999999) — a 1.4 m diagonal,
  // well inside KiCad's design space — and the probe segment is offset by very
  // nearly the 1.22 IU the threshold works out to after the integer rescale.
  const A1 = P(0, 0);
  const A2 = P(1000000000, 999999999);

  it('accepts the last offset inside the threshold', () => {
    expect(segApproxCollinear(A1, A2, P(732050806, 732050807), P(1732050806, 1732050806))).toBe(
      true,
    );
  });

  it('rejects the first offset outside it', () => {
    expect(segApproxCollinear(A1, A2, P(732050807, 732050808), P(1732050807, 1732050807))).toBe(
      false,
    );
  });

  it('disagrees with the same arithmetic done in doubles', () => {
    // The point of the BigInt: `det` is ~1.7e9 built from products of ~7e17,
    // which double arithmetic rounds by ±128 apiece. That is 250 times the gap
    // between two adjacent achievable values of `det²/l`, so at the threshold
    // the double answer is essentially arbitrary — here it says "not collinear"
    // where int64 says "collinear", and a merge KiCad performs would not happen.
    const naive = (b1: { x: number; y: number }, b2: { x: number; y: number }): boolean => {
      const p = A1.y - A2.y;
      const q = A2.x - A1.x;
      const r = -p * A1.x - q * A1.y;
      const l = p * p + q * q;
      const rescale = (det: number): number => Math.trunc((det * det + Math.floor(l / 2)) / l);
      return rescale(p * b1.x + q * b1.y + r) <= 1 && rescale(p * b2.x + q * b2.y + r) <= 1;
    };

    expect(naive(P(732050806, 732050807), P(1732050806, 1732050806))).toBe(false);
    expect(segApproxCollinear(A1, A2, P(732050806, 732050807), P(1732050806, 1732050806))).toBe(
      true,
    );
  });

  it('calls a zero-length longer segment not collinear', () => {
    // `l == 0` returns false rather than treating the degenerate case as a line,
    // which is what keeps a zero-length track out of every merge.
    expect(segApproxCollinear(P(5, 5), P(5, 5), P(5, 5), P(5, 5))).toBe(false);
  });
});
