// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOARD::DpCoupledNet` and `PNS_PCBNEW_RULE_RESOLVER::DpNetPair`
 * (`pcbnew/board.cpp`, `pns_kicad_iface.cpp:2790-2823`) on `PnsBoardIface`.
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
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { PnsBoardIface } from '@ziroeda/pcbnew/src/router/pns_board_iface.js';
import { PnsSession } from '@ziroeda/pcbnew/src/router/pns_session.js';
import { PnsRouterMode } from '@ziroeda/pcbnew/src/router/pns_router.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

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

const board = (): Board => readBoard(parse(DP_BOARD));

/** A segment on `aNet`, which is all `dpNetPair` reads off an item. */
function itemOnNet(iface: PnsBoardIface, aNetCode: number): PnsSegment {
  const seg = new PnsSegment({ a: { x: 0, y: 0 }, b: { x: MM, y: 0 } }, iface.netHandle(aNetCode));
  seg.setLayer(0);
  return seg;
}

describe('dpCoupledNet', () => {
  const iface = new PnsBoardIface(board());
  const nameOf = (code: number): string =>
    iface.getNetName(iface.dpCoupledNet(iface.netHandle(code)));

  it('pairs P with N and N with P', () => {
    expect(nameOf(1)).toBe('/CLK_N');
    expect(nameOf(2)).toBe('/CLK_P');
  });

  it('answers nothing for a net that is not half of a pair', () => {
    // Net 0 is the unconnected net; its name is empty.
    expect(iface.dpCoupledNet(iface.netHandle(0))).toBeNull();
  });

  it('answers nothing for a NAMED net with no polarity', () => {
    // `/GND` and not net 0, because the two are caught by different guards and
    // only this one reaches the polarity test. `MatchDpSuffix` returns 0 with
    // an EMPTY complement, and an empty name is a net that exists — net 0 —
    // so dropping the polarity check pairs every ordinary net with the
    // unconnected one.
    expect(iface.dpCoupledNet(iface.netHandle(4))).toBeNull();
  });

  it('answers nothing when the complement is not on the board', () => {
    // `/LONE_P` has the right suffix and no `/LONE_N` anywhere, and
    // `BOARD::FindNet` returning null is what makes it not a pair.
    expect(iface.dpCoupledNet(iface.netHandle(3))).toBeNull();
  });
});

describe('dpNetPair', () => {
  const iface = new PnsBoardIface(board());

  it('orients the pair so netP is the positive half, whichever half is held', () => {
    // `else { netNameN = netNameP; netNameP = netNameCoupled; }` — the r == -1
    // arm, which swaps.
    for (const held of [1, 2]) {
      const pair = iface.dpNetPair(itemOnNet(iface, held));

      expect(pair, `held net ${held}`).not.toBeNull();
      expect(iface.getNetName(pair!.netP)).toBe('/CLK_P');
      expect(iface.getNetName(pair!.netN)).toBe('/CLK_N');
    }
  });

  it('is null for an item on a net with no polarity', () => {
    expect(iface.dpNetPair(itemOnNet(iface, 0))).toBeNull();
  });

  it('is null when only one half of the pair exists', () => {
    // `if( !netInfoP || !netInfoN ) return false`.
    expect(iface.dpNetPair(itemOnNet(iface, 3))).toBeNull();
  });

  it('is null for an item with no net at all', () => {
    const seg = new PnsSegment({ a: { x: 0, y: 0 }, b: { x: MM, y: 0 } }, null);
    expect(iface.dpNetPair(seg)).toBeNull();
  });
});

describe('dpNetPolarity', () => {
  const iface = new PnsBoardIface(board());

  it('is MatchDpSuffix’s own +1 / -1 / 0', () => {
    expect(iface.dpNetPolarity(iface.netHandle(1))).toBe(1);
    expect(iface.dpNetPolarity(iface.netHandle(2))).toBe(-1);
    expect(iface.dpNetPolarity(iface.netHandle(0))).toBe(0);
    expect(iface.dpNetPolarity(iface.netHandle(4))).toBe(0);
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
