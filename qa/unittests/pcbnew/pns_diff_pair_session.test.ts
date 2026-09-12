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
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { applyPnsChanges, PnsSession } from '@ziroeda/pcbnew/src/router/pns_session.js';
import { DEFAULT_ROUTER_SIZES, PnsRouterMode } from '@ziroeda/pcbnew/src/router/pns_router.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

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

const board = (): Board => readBoard(parse(DP_BOARD));

const dpSession = (): PnsSession =>
  new PnsSession(board(), { trackWidth: 200_000, mode: PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR });

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
    const nets = new Set(s.preview.map((p) => p.net));
    expect(nets).toEqual(new Set([1, 2]));
    expect(s.preview.every((p) => p.head)).toBe(true);
    expect(s.preview.every((p) => p.kind === 'track' && p.width === 125000)).toBe(true);

    // `EraseView` before each `Move`: the overlay holds THIS head, not the sum
    // of every head so far. Two lanes of the same shape again, not twice as
    // many items.
    const count = s.preview.length;
    s.move({ x: 105 * MM, y: 100.5 * MM });
    expect(s.preview.length).toBe(count);
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
    const after = applyPnsChanges(board(), result.changes);

    const p = after.tracks.filter((t) => t.net === 1);
    const n = after.tracks.filter((t) => t.net === 2);
    expect(p.length).toBeGreaterThan(0);
    expect(n.length).toBe(p.length);
    expect(after.tracks.every((t) => t.width === 125000 && t.layer === 'F.Cu')).toBe(true);
    // Each lane runs from its own pad to its own pad.
    expect(p[0]!.start).toEqual({ x: 100 * MM, y: 100 * MM });
    expect(p.at(-1)!.end).toEqual({ x: 110 * MM, y: 100 * MM });
    expect(n[0]!.start).toEqual({ x: 100 * MM, y: 101 * MM });
    expect(n.at(-1)!.end).toEqual({ x: 110 * MM, y: 101 * MM });
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
    const s = new PnsSession(board(), {
      mode: PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR,
      diffPairWidth: 200_000,
      diffPairGap: 250_000,
    });
    s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu');
    s.move({ x: 110 * MM, y: 100 * MM });
    expect(s.preview.every((q) => q.kind === 'track' && q.width === 200_000)).toBe(true);
  });
});
