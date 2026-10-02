// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A differential pair, routed end to end through the session.
 *
 * `pns_diff_pair_nets.test.ts` pins that a pair can START. This is the rest
 * of `ROUTER_TOOL::performRouting` in `PNS_MODE_ROUTE_DIFF_PAIR`: `Move`
 * proposes both lanes, the head snaps onto the target pair, `FixRoute` ends
 * the run and `CommitRouting` hands the segments over.
 *
 * What stopped it before: `DEFAULT_ROUTER_SIZES` was all zeros where
 * `SIZES_SETTINGS`' constructor has 125000 / 180000 for the pair, so a session
 * without design settings gave the placer a gap of 0 and `routeHead` could
 * fit no gateways — `Move` was false on every board.
 */
import { describe, expect, it } from 'vitest';
import { describePreview, fakeView, previewItems } from './pns_preview_view.js';
import { parse } from '@ziroeda/sexpr/index.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PnsSession } from '@ziroeda/pcbnew/router/router_tool.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { TEST_PCB_FRAME } from './support/test_pcb_frame.js';
import { DEFAULT_ROUTER_SIZES, PnsRouterMode } from '@ziroeda/pcbnew/router/pns_router.js';

const MM = 1_000_000;

/** CLK_P over CLK_N, 1 mm apart, two parts 10 mm apart. */
const DP_BOARD = `(kicad_pcb (version 20240108) (generator "t")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "") (net 1 "/CLK_P") (net 2 "/CLK_N")
  (footprint "L:F" (layer "F.Cu") (at 100 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "/CLK_P"))
    (pad "2" smd rect (at 0 1) (size 1 1) (layers "F.Cu") (net 2 "/CLK_N")))
  (footprint "L:F" (layer "F.Cu") (at 110 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "/CLK_P"))
    (pad "2" smd rect (at 0 1) (size 1 1) (layers "F.Cu") (net 2 "/CLK_N")))
)`;

const board = (): BOARD => ParseBoard(DP_BOARD);

/** The session's board: its interface commits onto it (`SetHostTool`). */
let current: BOARD;

/** The board's tracks, as plain records. */
const routedTracks = (aBoard: BOARD) =>
  aBoard
    .Tracks()
    .filter((t) => t.Type() === KICAD_T.PCB_TRACE_T)
    .map((t) => ({
      start: { ...t.GetStart() },
      end: { ...t.GetEnd() },
      width: t.GetWidth(),
      net: t.GetNetCode(),
      layer: LSET.Name(t.GetLayer()),
    }));

const dpSession = (): PnsSession => {
  current = board();
  return new PnsSession(current, {
    commitHost: new TEST_PCB_FRAME(current),
    trackWidth: 200_000,
    mode: PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR,
    view: fakeView().view,
  });
};

describe('SIZES_SETTINGS’ constructor', () => {
  it('is the router’s default, not zeros', () => {
    // pns_sizes_settings.h:41-56. [data]
    expect(DEFAULT_ROUTER_SIZES.diffPairWidth).toBe(125000);
    expect(DEFAULT_ROUTER_SIZES.diffPairGap).toBe(180000);
    expect(DEFAULT_ROUTER_SIZES.diffPairViaGap).toBe(180000);
    expect(DEFAULT_ROUTER_SIZES.diffPairViaGapSameAsTraceGap).toBe(true);
    expect(DEFAULT_ROUTER_SIZES.trackWidth).toBe(155000);
    expect(DEFAULT_ROUTER_SIZES.viaDiameter).toBe(600000);
    expect(DEFAULT_ROUTER_SIZES.viaDrill).toBe(250000);
  });
});

describe('a differential pair, start to commit', () => {
  it('Move proposes both lanes and puts them on the overlay', () => {
    const s = dpSession();
    expect(s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu')).toBe(true);

    expect(s.move({ x: 105 * MM, y: 100.5 * MM })).toBe(true);
    // `movePlacing` displays each LINE of `Traces()` with PNS_HEAD_TRACE.
    const lanes = previewItems(s).map(describePreview);
    // One ROUTER_PREVIEW_ITEM per lane, each the head at the pair's lane width.
    expect(lanes).toHaveLength(2);
    expect(lanes.every((p) => p.head && !p.isVia && p.width === 125000)).toBe(true);

    // `EraseView` before each `Move`: the overlay holds THIS head, not the sum
    // of every head so far. Two lanes of the same shape again, not twice as
    // many items.
    const count = previewItems(s).length;
    s.move({ x: 105 * MM, y: 100.5 * MM });
    expect(previewItems(s).length).toBe(count);
  });

  it('snaps onto the target pair, finishes on FixRoute, and commits both lanes', () => {
    const s = dpSession();
    s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu');
    s.move({ x: 105 * MM, y: 100.5 * MM });
    expect(s.move({ x: 110 * MM, y: 100 * MM })).toBe(true);
    // `m_snapOnTarget`: the head found the far pair, so FixRoute ends the run
    // (`true` is "done", not "ok").
    expect(s.fix({ x: 110 * MM, y: 100 * MM })).toBe(true);

    const result = s.commit();
    expect(result.ok).toBe(true);
    const tracks = routedTracks(current);

    const p = tracks.filter((t) => t.net === 1);
    const n = tracks.filter((t) => t.net === 2);
    expect(p.length).toBeGreaterThan(0);
    expect(n.length).toBe(p.length);
    expect(tracks.every((t) => t.width === 125000 && t.layer === 'F.Cu')).toBe(true);
    // Each lane runs from its own pad to its own pad. (BOARD_COMMIT inserts each
    // new track at the front, so a lane's order on the board is reversed.)
    const ends = (lane: typeof p) => lane.flatMap((t) => [t.start, t.end]);
    expect(ends(p)).toContainEqual({ x: 100 * MM, y: 100 * MM });
    expect(ends(p)).toContainEqual({ x: 110 * MM, y: 100 * MM });
    expect(ends(n)).toContainEqual({ x: 100 * MM, y: 101 * MM });
    expect(ends(n)).toContainEqual({ x: 110 * MM, y: 101 * MM });
    // The coupled run: the two lanes' long middle segments sit width + gap
    // apart, centre to centre — 125000 + 180000 = 305000, to the IU rounding
    // of a 45° approach.
    const longest = (lane: typeof p) =>
      lane.reduce((a, b) =>
        Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y) >
        Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y)
          ? b
          : a,
      );
    const dy = Math.abs(longest(n).start.y - longest(p).start.y);
    expect(Math.abs(dy - 305000)).toBeLessThanOrEqual(2000);
  });

  it('a caller may state the pair’s own width and gap', () => {
    current = board();
    const s = new PnsSession(current, {
      commitHost: new TEST_PCB_FRAME(current),
      mode: PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR,
      diffPairWidth: 200_000,
      diffPairGap: 250_000,
      view: fakeView().view,
    });
    s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu');
    s.move({ x: 110 * MM, y: 100 * MM });
    expect(previewItems(s).every((q) => describePreview(q).width === 200_000)).toBe(true);
  });
});
