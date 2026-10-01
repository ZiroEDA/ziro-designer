// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * TRACKS_CLEANER (pcbnew/tracks_cleaner.cpp) on the live BOARD: every pass
 * CleanupBoard runs, the dry run against the real one, and the undo step.
 *
 * Several expectations look like bugs and are upstream's: duplicate removal
 * that no checkbox switches off, a reference track reported once per partner it
 * finds, and a merge refused because of a pad on the shared point.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Reporter } from '@ziroeda/common/reporter.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { BOARD_COMMIT } from '@ziroeda/pcbnew/board_commit.js';
import { CLEANUP_ITEM, CLEANUP_RC_CODE, cleanupErrorText } from '@ziroeda/pcbnew/cleanup_item.js';
import type { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { TRACKS_CLEANER } from '@ziroeda/pcbnew/tracks_cleaner.js';
import { TEST_PCB_FRAME } from './support/test_pcb_frame.js';

let uid = 0;
const U = (): string => `00000000-0000-4000-8000-${String(++uid).padStart(12, '0')}`;

const seg = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  net = 1,
  o: { w?: number; layer?: string; locked?: boolean } = {},
) =>
  `(segment (start ${x1} ${y1}) (end ${x2} ${y2}) (width ${o.w ?? 0.25}) (layer "${o.layer ?? 'F.Cu'}")${o.locked ? ' (locked yes)' : ''} (net ${net}) (uuid "${U()}"))`;

const via = (x: number, y: number, net = 1, kind = '') =>
  `(via ${kind}(at ${x} ${y}) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net ${net}) (uuid "${U()}"))`;

const smdPad = (x: number, y: number, net = 1, size = 2) =>
  `(footprint "t:smd" (layer "F.Cu") (uuid "${U()}") (at ${x} ${y})
    (pad "1" smd rect (at 0 0) (size ${size} ${size}) (layers "F.Cu") (net ${net} "N${net}") (uuid "${U()}")))`;

const thtPad = (x: number, y: number, net = 1) =>
  `(footprint "t:tht" (layer "F.Cu") (uuid "${U()}") (at ${x} ${y})
    (pad "1" thru_hole circle (at 0 0) (size 1.7 1.7) (drill 1) (layers "*.Cu") (net ${net} "N${net}") (uuid "${U()}")))`;

function makeBoard(...items: string[]): BOARD {
  const b = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (net 0 "") (net 1 "N1") (net 2 "N2")
  ${items.join('\n  ')})`);
  b.BuildConnectivity();
  return b;
}

interface RunOpts {
  dryRun?: boolean;
  shorts?: boolean;
  vias?: boolean;
  merge?: boolean;
  dangling?: boolean;
  inPad?: boolean;
  danglingVias?: boolean;
  filter?: (t: unknown) => boolean;
}

function run(board: BOARD, o: RunOpts = {}) {
  const frame = new TEST_PCB_FRAME(board);
  const commit = new BOARD_COMMIT(frame);
  const cleaner = new TRACKS_CLEANER(board, commit);
  if (o.filter) cleaner.SetFilter(o.filter);
  const items: CLEANUP_ITEM[] = [];
  const reporter = new Reporter();
  cleaner.CleanupBoard(
    o.dryRun ?? false,
    items,
    o.shorts ?? false,
    o.vias ?? false,
    o.merge ?? false,
    o.dangling ?? false,
    o.inPad ?? false,
    o.danglingVias ?? false,
    reporter,
  );
  if (!(o.dryRun ?? false)) commit.Push('Board cleanup');
  return { items, frame, reporter, codes: items.map((i) => i.GetErrorCode()) };
}

const C = CLEANUP_RC_CODE;
const tracks = (b: BOARD): PCB_TRACK[] =>
  b.Tracks().filter((t) => t.Type() === KICAD_T.PCB_TRACE_T);
const vias = (b: BOARD): PCB_TRACK[] => b.Tracks().filter((t) => t.Type() === KICAD_T.PCB_VIA_T);

beforeEach(() => {
  uid = 0;
});

describe('CLEANUP_ITEM', () => {
  it('spells the nine track messages exactly as upstream does, in enum order', () => {
    expect(
      [
        C.CLEANUP_SHORTING_TRACK,
        C.CLEANUP_SHORTING_VIA,
        C.CLEANUP_REDUNDANT_VIA,
        C.CLEANUP_DUPLICATE_TRACK,
        C.CLEANUP_MERGE_TRACKS,
        C.CLEANUP_DANGLING_TRACK,
        C.CLEANUP_DANGLING_VIA,
        C.CLEANUP_ZERO_LENGTH_TRACK,
        C.CLEANUP_TRACK_IN_PAD,
      ].map(cleanupErrorText),
    ).toEqual([
      'Remove track shorting two nets',
      'Remove via shorting two nets',
      'Remove redundant via',
      'Remove duplicate track',
      'Merge co-linear tracks',
      'Remove track not connected at both ends',
      'Remove via connected on less than 2 layers',
      'Remove zero-length track',
      'Remove track inside pad',
    ]);
    expect(C.CLEANUP_TRACK_IN_PAD - C.CLEANUP_SHORTING_TRACK).toBe(8);
  });

  it('takes its title from the code', () => {
    expect(new CLEANUP_ITEM(C.CLEANUP_REDUNDANT_VIA).GetErrorText(true)).toBe(
      'Remove redundant via',
    );
  });
});

describe('zero-length segments', () => {
  it('are reported and removed when merging is asked for', () => {
    const b = makeBoard(seg(10, 10, 10, 10), seg(20, 10, 30, 10));
    const { codes } = run(b, { merge: true });
    expect(codes).toContain(C.CLEANUP_ZERO_LENGTH_TRACK);
    expect(tracks(b)).toHaveLength(1);
  });

  it('also when only shorting-track removal is asked for (removeNullSegments)', () => {
    const b = makeBoard(seg(10, 10, 10, 10));
    expect(run(b, { shorts: true }).codes).toEqual([C.CLEANUP_ZERO_LENGTH_TRACK]);
  });

  it('are left alone when neither is asked for', () => {
    const b = makeBoard(seg(10, 10, 10, 10));
    expect(run(b, {}).codes).toEqual([]);
    expect(tracks(b)).toHaveLength(1);
  });
});

describe('duplicate segments', () => {
  it('three identical tracks give three rows and two removals', () => {
    const b = makeBoard(seg(10, 10, 20, 10), seg(10, 10, 20, 10), seg(10, 10, 20, 10));
    const { codes } = run(b, {});
    expect(codes).toEqual([
      C.CLEANUP_DUPLICATE_TRACK,
      C.CLEANUP_DUPLICATE_TRACK,
      C.CLEANUP_DUPLICATE_TRACK,
    ]);
    expect(tracks(b)).toHaveLength(1);
  });

  it('runs whether or not merging is asked for, and counts a reversed copy', () => {
    const b = makeBoard(seg(10, 10, 20, 10), seg(20, 10, 10, 10));
    expect(run(b, { merge: false }).codes).toEqual([C.CLEANUP_DUPLICATE_TRACK]);
    expect(tracks(b)).toHaveLength(1);
  });

  it('does not count a copy of another width or on another layer', () => {
    const b = makeBoard(
      seg(10, 10, 20, 10),
      seg(10, 10, 20, 10, 1, { w: 0.3 }),
      seg(10, 10, 20, 10, 1, { layer: 'B.Cu' }),
    );
    expect(run(b, {}).codes).toEqual([]);
  });

  it('keeps a locked copy', () => {
    const b = makeBoard(seg(10, 10, 20, 10, 1, { locked: true }), seg(10, 10, 20, 10));
    run(b, {});
    expect(tracks(b)).toHaveLength(1);
    expect(tracks(b)[0]!.IsLocked()).toBe(true);
  });
});

describe('merging co-linear segments', () => {
  it('merges an end-to-end pair into the first, which spans both', () => {
    const b = makeBoard(seg(10, 10, 20, 10), seg(20, 10, 30, 10));
    const first = tracks(b)[0]!;
    const { codes, items } = run(b, { merge: true });
    expect(codes).toEqual([C.CLEANUP_MERGE_TRACKS]);
    expect(items[0]!.GetMainItemID()).toBe(first.m_Uuid);
    expect(tracks(b)).toEqual([first]);
    expect([first.GetStart(), first.GetEnd()]).toEqual([
      { x: 10_000_000, y: 10_000_000 },
      { x: 30_000_000, y: 10_000_000 },
    ]);
  });

  it('merges a chain of three into one, iterating until nothing merges', () => {
    const b = makeBoard(seg(10, 10, 20, 10), seg(20, 10, 30, 10), seg(30, 10, 40, 10));
    run(b, { merge: true });
    expect(tracks(b)).toHaveLength(1);
    expect(tracks(b)[0]!.GetEnd()).toEqual({ x: 40_000_000, y: 10_000_000 });
  });

  it("takes a diagonal from seg1's direction", () => {
    const b = makeBoard(seg(10, 20, 20, 10), seg(20, 10, 30, 0));
    run(b, { merge: true });
    const t = tracks(b)[0]!;
    expect([t.GetStart(), t.GetEnd()]).toEqual([
      { x: 10_000_000, y: 20_000_000 },
      { x: 30_000_000, y: 0 },
    ]);
  });

  it('refuses when a third track branches off the shared point', () => {
    const b = makeBoard(seg(10, 10, 20, 10), seg(20, 10, 30, 10), seg(20, 10, 20, 20));
    expect(run(b, { merge: true }).codes).toEqual([]);
    expect(tracks(b)).toHaveLength(3);
  });

  it('refuses at an end where a track of another width is attached', () => {
    const b = makeBoard(seg(10, 10, 20, 10), seg(20, 10, 30, 10, 1, { w: 0.5 }));
    expect(run(b, { merge: true }).codes).toEqual([]);
  });

  it('refuses the whole segment when a different-width track hangs off its FAR end (necking down)', () => {
    const b = makeBoard(
      seg(10, 10, 20, 10),
      seg(20, 10, 30, 10),
      seg(10, 10, 10, 0, 1, { w: 0.5 }),
    );
    expect(run(b, { merge: true }).codes).toEqual([]);
    expect(tracks(b)).toHaveLength(3);
  });

  it('refuses on the popcount rule alone, where the endpoint rule would allow it', () => {
    // seg2 contains seg1 and shares its start: attachments at 10 (p1s and p2s) and
    // at 30 (p2e) are three flags on two points, both on the merged ends.
    const b = makeBoard(
      seg(10, 10, 20, 10),
      seg(10, 10, 30, 10),
      smdPad(10, 10, 1, 0.3),
      smdPad(30, 10, 1, 0.3),
    );
    expect(run(b, { merge: true }).codes).toEqual([]);
    expect(tracks(b)).toHaveLength(2);
  });

  it('refuses when a pad sits on the shared point', () => {
    const b = makeBoard(seg(10, 10, 20, 10), seg(20, 10, 30, 10), smdPad(20, 10, 1, 0.3));
    expect(run(b, { merge: true }).codes).toEqual([]);
  });

  it('refuses when either segment is locked', () => {
    const b = makeBoard(seg(10, 10, 20, 10, 1, { locked: true }), seg(20, 10, 30, 10));
    expect(run(b, { merge: true }).codes).toEqual([]);
  });

  it('never merges when not asked to', () => {
    const b = makeBoard(seg(10, 10, 20, 10), seg(20, 10, 30, 10));
    expect(run(b, {}).codes).toEqual([]);
    expect(tracks(b)).toHaveLength(2);
  });
});

describe('redundant vias', () => {
  it('of two identical vias one goes', () => {
    const b = makeBoard(via(10, 10), via(10, 10));
    expect(run(b, { vias: true }).codes).toEqual([C.CLEANUP_REDUNDANT_VIA]);
    expect(vias(b)).toHaveLength(1);
  });

  it('a through via on a through-hole pad goes, and its row names the pad too', () => {
    const b = makeBoard(via(10, 10), thtPad(10, 10));
    const { items } = run(b, { vias: true });
    expect(items.map((i) => i.GetErrorCode())).toEqual([C.CLEANUP_REDUNDANT_VIA]);
    expect(items[0]!.GetAuxItemID()).toBe(b.Footprints()[0]!.Pads()[0]!.m_Uuid);
    expect(vias(b)).toHaveLength(0);
  });

  it('two vias at one place but of different types both stay', () => {
    const b = makeBoard(via(10, 10), via(10, 10, 1, 'blind '));
    expect(run(b, { vias: true }).codes).toEqual([]);
    expect(vias(b)).toHaveLength(2);
  });

  it('a via on an SMD pad stays', () => {
    const b = makeBoard(via(10, 10), smdPad(10, 10));
    expect(run(b, { vias: true }).codes).toEqual([]);
  });

  it('nothing happens to vias when not asked', () => {
    const b = makeBoard(via(10, 10), via(10, 10));
    expect(run(b, {}).codes).toEqual([]);
    expect(vias(b)).toHaveLength(2);
  });
});

describe('shorting tracks', () => {
  // A track touching one foreign pad is not a short: RecalculateRatsnest's
  // PropagateNets gives it the pad's net on load. A short needs a conflicting
  // cluster, two pads of different nets joined by copper.
  it('a track joining two pads of different nets goes', () => {
    const b = makeBoard(smdPad(10, 10, 1), smdPad(20, 10, 2), seg(10, 10, 20, 10, 1));
    expect(run(b, { shorts: true }).codes).toEqual([C.CLEANUP_SHORTING_TRACK]);
    expect(tracks(b)).toHaveLength(0);
  });

  it('a via of one net on a track of another is a shorting VIA, and the track a shorting track', () => {
    const b = makeBoard(
      smdPad(10, 10, 1),
      smdPad(30, 10, 2),
      seg(10, 10, 20, 10, 1),
      via(20, 10, 1),
      seg(20, 10, 30, 10, 2),
    );
    const { codes } = run(b, { shorts: true, dryRun: true });
    // Board order, a row per foreign-net contact: the net-1 track touches the
    // net-2 track at x=20; the via touches the net-2 track; the net-2 track
    // touches both the net-1 track and the via, so it is reported twice.
    expect(codes).toEqual([
      C.CLEANUP_SHORTING_TRACK,
      C.CLEANUP_SHORTING_VIA,
      C.CLEANUP_SHORTING_TRACK,
      C.CLEANUP_SHORTING_TRACK,
    ]);
    expect(b.Tracks()).toHaveLength(3);
  });

  it('same-net contacts are left alone', () => {
    const b = makeBoard(seg(10, 10, 20, 10, 1), smdPad(20, 10, 1));
    expect(run(b, { shorts: true }).codes).toEqual([]);
  });
});

describe('tracks inside pads', () => {
  it('a track wholly inside one pad goes', () => {
    const b = makeBoard(seg(9.8, 10, 10.2, 10), smdPad(10, 10, 1, 2));
    expect(run(b, { inPad: true }).codes).toEqual([C.CLEANUP_TRACK_IN_PAD]);
    expect(tracks(b)).toHaveLength(0);
  });

  it('a track whose ends are in the pad but whose width is not stays (the polygon test)', () => {
    const b = makeBoard(seg(9.8, 10, 10.2, 10, 1, { w: 3 }), smdPad(10, 10, 1, 2));
    expect(run(b, { inPad: true }).codes).toEqual([]);
    expect(tracks(b)).toHaveLength(1);
  });

  it('a track that leaves the pad stays', () => {
    const b = makeBoard(seg(10, 10, 20, 10), smdPad(10, 10, 1, 2), smdPad(20, 10, 1, 2));
    expect(run(b, { inPad: true }).codes).toEqual([]);
  });
});

describe('dangling tracks and vias', () => {
  it('a chain hanging off a pad is removed back to the pad, one pass at a time', () => {
    const b = makeBoard(smdPad(10, 10), seg(10, 10, 20, 10), seg(20, 10, 20, 20));
    const { codes } = run(b, { dangling: true });
    expect(codes).toEqual([C.CLEANUP_DANGLING_TRACK, C.CLEANUP_DANGLING_TRACK]);
    expect(tracks(b)).toHaveLength(0);
  });

  it('a track between two pads stays', () => {
    const b = makeBoard(smdPad(10, 10), smdPad(20, 10), seg(10, 10, 20, 10));
    expect(run(b, { dangling: true }).codes).toEqual([]);
  });

  it('a lone via is dangling only when vias are asked for', () => {
    expect(run(makeBoard(via(10, 10)), { dangling: true }).codes).toEqual([]);
    expect(run(makeBoard(via(10, 10)), { danglingVias: true }).codes).toEqual([
      C.CLEANUP_DANGLING_VIA,
    ]);
  });

  it('deleting a dangling track re-runs the merge pass when merging is asked for', () => {
    // The stub at x=20 blocks the merge; once it is gone the two halves join.
    const b = makeBoard(
      smdPad(10, 10),
      smdPad(30, 10),
      seg(10, 10, 20, 10),
      seg(20, 10, 30, 10),
      seg(20, 10, 20, 20),
    );
    const { codes } = run(b, { dangling: true, merge: true });
    expect(codes).toEqual([C.CLEANUP_DANGLING_TRACK, C.CLEANUP_MERGE_TRACKS]);
    expect(tracks(b)).toHaveLength(1);
  });
});

describe('dry run, filter, reporter and undo', () => {
  it('a dry run reports without touching the board', () => {
    const b = makeBoard(seg(10, 10, 20, 10), seg(20, 10, 30, 10), seg(40, 40, 40, 40));
    const { codes, frame } = run(b, { merge: true, dryRun: true });
    expect(codes).toEqual([C.CLEANUP_ZERO_LENGTH_TRACK, C.CLEANUP_MERGE_TRACKS]);
    expect(tracks(b)).toHaveLength(3);
    expect(tracks(b)[0]!.GetEnd()).toEqual({ x: 20_000_000, y: 10_000_000 });
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('leaves no IS_DELETED / SKIP_STRUCT flag behind on a dry run', () => {
    const b = makeBoard(seg(10, 10, 20, 10), seg(10, 10, 20, 10));
    run(b, { dryRun: true, merge: true });
    for (const t of b.Tracks()) expect(t.GetFlags()).toBe(0);
  });

  it('the filter EXCLUDES the items it returns true for', () => {
    const b = makeBoard(seg(10, 10, 10, 10), seg(30, 30, 30, 30));
    const [skip, other] = tracks(b) as [PCB_TRACK, PCB_TRACK];
    const otherId = other.m_Uuid;
    const { items } = run(b, { merge: true, filter: (t) => t === skip });
    expect(items.map((i) => i.GetMainItemID())).toEqual([otherId]);
    expect(tracks(b)).toEqual([skip]);
  });

  it("reports the progress lines in the mode's wording", () => {
    const b = makeBoard(seg(10, 10, 20, 10));
    const dry = run(b, {
      dryRun: true,
      merge: true,
      shorts: true,
      inPad: true,
      dangling: true,
    }).reporter.lines.map((l) => l.message);
    expect(dry).toEqual([
      'Checking null tracks and vias...',
      'Checking redundant tracks...',
      'Checking shorting tracks...',
      'Checking tracks in pads...',
      'Checking dangling tracks and vias...',
    ]);
    const real = run(makeBoard(seg(10, 10, 20, 10)), {
      dangling: true,
      danglingVias: true,
    }).reporter.lines.map((l) => l.message);
    expect(real).toEqual(
      [
        'Removing null tracks and vias...',
        'Removing redundant tracks...',
        'Removing dangling tracks...',
        'Removing dangling vias...',
        'Merging collinear tracks...',
      ].slice(0, 4),
    );
  });

  it('a real run is one undo step that puts everything back', () => {
    const b = makeBoard(seg(10, 10, 20, 10), seg(20, 10, 30, 10), seg(40, 40, 40, 40));
    const { frame } = run(b, { merge: true });
    expect(tracks(b)).toHaveLength(1);
    expect(frame.GetUndoCommandCount()).toBe(1);
    frame.RestoreCopyFromUndoList();
    expect(tracks(b)).toHaveLength(3);
    expect(
      tracks(b)
        .find((t) => t.GetStart().x === 10_000_000)!
        .GetEnd(),
    ).toEqual({ x: 20_000_000, y: 10_000_000 });
  });
});
