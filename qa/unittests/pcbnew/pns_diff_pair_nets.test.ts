// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOARD::DpCoupledNet` and `PNS_PCBNEW_RULE_RESOLVER::DpNetPair`
 * (`pcbnew/board.cpp`, `pns_kicad_iface.cpp:2790-2823`) on `PNS_KICAD_IFACE`.
 *
 * These two were the reason differential-pair routing could not start. The
 * placer was ported, `ROUTER::SetMode` reached it, and
 * `isStartingPointRoutable` asked `findDpPrimitivePair` for the pair — which
 * asks the rule resolver, which asks the board interface, which had no such
 * method. Every item answered "unable to find complementary differential pair
 * nets", including items that plainly were half of one.
 *
 * The orientation is the part worth pinning: `DpNetPair` returns the pair with
 * `netP` as the POSITIVE half whichever half the user grabbed, which is what
 * lets `findDpPrimitivePair` say `pair.primP()` is always on P.
 */
import { describe, expect, it } from 'vitest';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import {
  PNS_KICAD_IFACE,
  PNS_PCBNEW_RULE_RESOLVER,
} from '@ziroeda/pcbnew/router/pns_kicad_iface.js';
import { PnsSession } from '@ziroeda/pcbnew/router/router_tool.js';
import { PnsRouterMode } from '@ziroeda/pcbnew/router/pns_router.js';
import { PnsSegment } from '@ziroeda/pcbnew/router/pns_segment.js';

const MM = 1_000_000;

/** Two footprints whose pads are a `/CLK_P` + `/CLK_N` pair. */
const DP_BOARD = `(kicad_pcb (version 20240108) (generator "t")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "") (net 1 "/CLK_P") (net 2 "/CLK_N") (net 3 "/LONE_P") (net 4 "/GND")
  (footprint "L:F" (layer "F.Cu") (at 100 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "/CLK_P"))
    (pad "2" smd rect (at 0 1) (size 1 1) (layers "F.Cu") (net 2 "/CLK_N"))
    (pad "3" smd rect (at 0 3) (size 1 1) (layers "F.Cu") (net 3 "/LONE_P")))
  (footprint "L:F" (layer "F.Cu") (at 110 100)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "/CLK_P"))
    (pad "2" smd rect (at 0 1) (size 1 1) (layers "F.Cu") (net 2 "/CLK_N")))
)`;

const board = (): BOARD => ParseBoard(DP_BOARD);

/** `BOARD::DpCoupledNet` and the resolver's diff-pair answers live on PNS_PCBNEW_RULE_RESOLVER. */
function resolverOn(aBoard: BOARD): PNS_PCBNEW_RULE_RESOLVER {
  return new PNS_PCBNEW_RULE_RESOLVER(aBoard, new PNS_KICAD_IFACE(aBoard));
}

/** A segment on `aNet`, which is all `dpNetPair` reads off an item. */
function itemOnNet(aBoard: BOARD, aNetCode: number): PnsSegment {
  const seg = new PnsSegment({ a: { x: 0, y: 0 }, b: { x: MM, y: 0 } }, aBoard.FindNet(aNetCode));
  seg.setLayer(0);
  return seg;
}

describe('dpCoupledNet', () => {
  const b = board();
  const iface = resolverOn(b);
  const nameOf = (code: number): string => iface.netName(iface.dpCoupledNet(b.FindNet(code)));

  it('pairs P with N and N with P', () => {
    expect(nameOf(1)).toBe('/CLK_N');
    expect(nameOf(2)).toBe('/CLK_P');
  });

  it('answers nothing for a net that is not half of a pair', () => {
    // Net 0 is the unconnected net; its name is empty.
    expect(iface.dpCoupledNet(b.FindNet(0))).toBeNull();
  });

  it('answers nothing for a NAMED net with no polarity', () => {
    // `/GND` and not net 0, because the two are caught by different guards and
    // only this one reaches the polarity test. `MatchDpSuffix` returns 0 with
    // an EMPTY complement, and an empty name is a net that exists — net 0 —
    // so dropping the polarity check pairs every ordinary net with the
    // unconnected one.
    expect(iface.dpCoupledNet(b.FindNet(4))).toBeNull();
  });

  it('answers nothing when the complement is not on the board', () => {
    // `/LONE_P` has the right suffix and no `/LONE_N` anywhere, and
    // `BOARD::FindNet` returning null is what makes it not a pair.
    expect(iface.dpCoupledNet(b.FindNet(3))).toBeNull();
  });
});

describe('dpNetPair', () => {
  const b = board();
  const iface = resolverOn(b);

  it('orients the pair so netP is the positive half, whichever half is held', () => {
    // `else { netNameN = netNameP; netNameP = netNameCoupled; }` — the r == -1
    // arm, which swaps.
    for (const held of [1, 2]) {
      const pair = iface.dpNetPair(itemOnNet(b, held));

      expect(pair, `held net ${held}`).not.toBeNull();
      expect(iface.netName(pair!.netP)).toBe('/CLK_P');
      expect(iface.netName(pair!.netN)).toBe('/CLK_N');
    }
  });

  it('is null for an item on a net with no polarity', () => {
    expect(iface.dpNetPair(itemOnNet(b, 0))).toBeNull();
  });

  it('is null when only one half of the pair exists', () => {
    // `if( !netInfoP || !netInfoN ) return false`.
    expect(iface.dpNetPair(itemOnNet(b, 3))).toBeNull();
  });

  it('is null for an item with no net at all', () => {
    const seg = new PnsSegment({ a: { x: 0, y: 0 }, b: { x: MM, y: 0 } }, null);
    expect(iface.dpNetPair(seg)).toBeNull();
  });
});

describe('dpNetPolarity', () => {
  const b = board();
  const iface = resolverOn(b);

  it('is MatchDpSuffix’s own +1 / -1 / 0', () => {
    expect(iface.dpNetPolarity(b.FindNet(1))).toBe(1);
    expect(iface.dpNetPolarity(b.FindNet(2))).toBe(-1);
    expect(iface.dpNetPolarity(b.FindNet(0))).toBe(0);
    expect(iface.dpNetPolarity(b.FindNet(4))).toBe(0);
  });
});

describe('a differential-pair route can start at all', () => {
  it('starts on a pad of a real pair', () => {
    // The whole point of the two hooks above: `isStartingPointRoutable` asks
    // `findDpPrimitivePair`, which asks `dpNetPair`. Before it existed this
    // returned false on every board in the world.
    const s = new PnsSession(board(), {
      trackWidth: 200_000,
      mode: PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR,
    });

    expect(s.start({ x: 100 * MM, y: 100 * MM }, 'F.Cu')).toBe(true);
    expect(s.failureReason).toBe('');
    expect(s.pnsRouter.placer()).not.toBeNull();
  });

  it('still refuses a net that is not half of a pair, with upstream’s words', () => {
    const s = new PnsSession(board(), {
      trackWidth: 200_000,
      mode: PnsRouterMode.PNS_MODE_ROUTE_DIFF_PAIR,
    });

    // The `/LONE_P` pad, whose complement is not on the board.
    expect(s.start({ x: 100 * MM, y: 103 * MM }, 'F.Cu')).toBe(false);
    expect(s.failureReason).toMatch(/Unable to find complementary differential pair nets/);
  });
});
