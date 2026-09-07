// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `POLYGON_GEOM_MANAGER` (`common/preview_items/polygon_geom_manager.cpp`), the
 * corner-by-corner outline behind Draw Polygon, Add Zone, Add Rule Area and
 * Zone Cutout — one tool upstream, `DRAWING_TOOL::DrawZone`.
 *
 * The expectations below are derived from the C++ by hand, not from a run of
 * this port. Each dogleg case states the intermediate values (`prevA`, `lineA`,
 * `angDiff`, `bendEnd`) it was worked out from, so a moved number has to be
 * argued against `build45DegLeader` rather than re-baselined.
 */
import { describe, expect, it } from 'vitest';
import {
  LeaderMode,
  PolygonGeomManager,
  type PolygonGeomClient,
} from '@ziroeda/common/src/preview_items/polygon_geom_manager.js';

interface Log {
  firstPoint: number;
  geometry: number;
  complete: number;
}

function mgrWith(vetoFirst = false): { mgr: PolygonGeomManager; log: Log } {
  const log: Log = { firstPoint: 0, geometry: 0, complete: 0 };
  const client: PolygonGeomClient = {
    onFirstPoint: () => {
      log.firstPoint++;
      return !vetoFirst;
    },
    onGeometryChange: () => {
      log.geometry++;
    },
    onComplete: () => {
      log.complete++;
    },
  };
  return { mgr: new PolygonGeomManager(client), log };
}

const pts = (chain: readonly { x: number; y: number }[]): [number, number][] =>
  chain.map((p) => [p.x, p.y]);

/**
 * One click of the tool: the motion that precedes it, then the click.
 *
 * The motion is not decoration. `AddPoint` reads the **leader chain**, not the
 * point it is handed — `m_lockedPoints.Append( m_leaderPts.CPoints()[n-2] )` —
 * so a click with no motion before it locks in the previous cursor position.
 * That is upstream's own behaviour and is pinned on its own below; the event
 * loop feeds `SetCursorPosition` on every `evt->IsMotion()`, so this is the
 * sequence a real click arrives in.
 */
function click(mgr: PolygonGeomManager, p: { x: number; y: number }): void {
  mgr.setCursorPosition(p);
  mgr.addPoint(p);
}

describe('LEADER_MODE::DIRECT', () => {
  it('locks in exactly the clicked corners', () => {
    const { mgr } = mgrWith();
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 100, y: 0 });
    click(mgr, { x: 100, y: 100 });

    // The tail of the leader is appended, not the raw cursor — and its first
    // element is the corner already locked in. `SHAPE_LINE_CHAIN::Append`'s
    // duplicate suppression is the only thing stopping every corner doubling.
    expect(pts(mgr.getLockedInPoints())).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
  });

  it('a click with no motion before it locks in the stale leader end', () => {
    const { mgr } = mgrWith();
    click(mgr, { x: 0, y: 0 });
    mgr.setCursorPosition({ x: 100, y: 0 });
    // No `SetCursorPosition` for this one: `AddPoint`'s argument is ignored
    // whenever the leader has more than one point, which it always does once
    // the outline has started.
    mgr.addPoint({ x: 999, y: 999 });

    expect(pts(mgr.getLockedInPoints())).toEqual([
      [0, 0],
      [100, 0],
    ]);
  });

  it('leaves the loop chain empty and the leader a single segment', () => {
    const { mgr } = mgrWith();
    mgr.addPoint({ x: 0, y: 0 });
    mgr.setCursorPosition({ x: 70, y: 40 });

    expect(pts(mgr.getLeaderLinePoints())).toEqual([
      [0, 0],
      [70, 40],
    ]);
    // `m_loopPts.Clear()` — the closing edge is straight, so `POLYGON_ITEM`
    // gets it from the contour closing itself rather than from a chain.
    expect(mgr.getLoopLinePoints()).toHaveLength(0);
  });
});

describe('LEADER_MODE::DEG45', () => {
  /**
   * locked = [(0,0), (100,0)], cursor (200,50).
   *
   * `prevA` = angle of `GetVectorSnapped45( (100,0) )` = 0°; `lineVec` =
   * (100,50) so `lineA` = 26.565°, `horizontal` (|50| < |100|).
   * `angDiff` = 26.565 < 45 → `bendEnd`, and `prevA.Normalize90()` is 0, not
   * ±45, so it is not flipped. `bendEnd && horizontal && lineVec.x > 0`:
   * mid = ( end.x − |lineVec.y|, last.y ) = (150, 0).
   */
  it('bends the leader through a computed mid point', () => {
    const { mgr } = mgrWith();
    mgr.setLeaderMode(LeaderMode.DEG45);
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 100, y: 0 });
    mgr.setCursorPosition({ x: 200, y: 50 });

    expect(pts(mgr.getLeaderLinePoints())).toEqual([
      [100, 0],
      [150, 0],
      [200, 50],
    ]);
  });

  /**
   * The same state, loop chain: `build45DegLeader` on the *reversed* locked
   * chain, so last = (0,0) and prev = (100,0). `prevA` = angle of (−100,0) =
   * −180°; `lineA` = atan2(50,200) = 14.036°; `angDiff` =
   * |(14.036 + 180).Normalize180()| = 165.96, which is neither < 45 nor in
   * (90,135) → `bendEnd` false. Not flipped (−180 normalises to 0 on 90).
   * `!bendEnd && horizontal && lineVec.x > 0`:
   * mid = ( last.x + |lineVec.y|, end.y ) = (50, 50). Reversed for the chain.
   */
  it('builds the loop back to the FIRST corner, reversed', () => {
    const { mgr } = mgrWith();
    mgr.setLeaderMode(LeaderMode.DEG45);
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 100, y: 0 });
    mgr.setCursorPosition({ x: 200, y: 50 });

    expect(pts(mgr.getLoopLinePoints())).toEqual([
      [200, 50],
      [50, 50],
      [0, 0],
    ]);
  });

  it('a click locks in BOTH points of the dogleg', () => {
    const { mgr } = mgrWith();
    mgr.setLeaderMode(LeaderMode.DEG45);
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 100, y: 0 });
    click(mgr, { x: 200, y: 50 });

    // Three clicks, four corners: the bend is a corner of the polygon, which
    // is why `AddPoint` appends `CPoints()[count-2]` as well as the last.
    expect(pts(mgr.getLockedInPoints())).toEqual([
      [0, 0],
      [100, 0],
      [150, 0],
      [200, 50],
    ]);
  });
});

describe('LEADER_MODE::DEG90', () => {
  it('goes horizontal first, then vertical', () => {
    const { mgr } = mgrWith();
    mgr.setLeaderMode(LeaderMode.DEG90);
    mgr.addPoint({ x: 0, y: 0 });
    mgr.setCursorPosition({ x: 200, y: 50 });

    // `VECTOR2I mid( aEndPoint.x, lastPt.y )`.
    expect(pts(mgr.getLeaderLinePoints())).toEqual([
      [0, 0],
      [200, 0],
      [200, 50],
    ]);
    expect(pts(mgr.getLoopLinePoints())).toEqual([
      [200, 50],
      [200, 0],
      [0, 0],
    ]);
  });

  it('degenerates to one segment when the move is already orthogonal', () => {
    const { mgr } = mgrWith();
    mgr.setLeaderMode(LeaderMode.DEG90);
    mgr.addPoint({ x: 0, y: 0 });
    mgr.setCursorPosition({ x: 200, y: 0 });

    expect(pts(mgr.getLeaderLinePoints())).toEqual([
      [0, 0],
      [200, 0],
    ]);
  });
});

describe('closing the outline', () => {
  it('NewPointClosesOutline is exact, with no tolerance', () => {
    const { mgr } = mgrWith();
    click(mgr, { x: 1000, y: 2000 });
    click(mgr, { x: 5000, y: 2000 });

    expect(mgr.newPointClosesOutline({ x: 1000, y: 2000 })).toBe(true);
    // One internal unit away is a corner, not a close. A radius here would
    // steal every click placed near the start.
    expect(mgr.newPointClosesOutline({ x: 1001, y: 2000 })).toBe(false);
    // And it is the FIRST corner that closes, never the last.
    expect(mgr.newPointClosesOutline({ x: 5000, y: 2000 })).toBe(false);
  });

  it('an outline with no corners cannot be closed', () => {
    const { mgr } = mgrWith();
    expect(mgr.newPointClosesOutline({ x: 0, y: 0 })).toBe(false);
  });

  it('SetFinished reports to the client', () => {
    const { mgr, log } = mgrWith();
    mgr.addPoint({ x: 0, y: 0 });
    mgr.setFinished();
    expect(log.complete).toBe(1);
  });
});

describe('the client callbacks', () => {
  it('OnFirstPoint is asked once, and a veto refuses the corner', () => {
    const { mgr, log } = mgrWith(true);
    expect(mgr.addPoint({ x: 0, y: 0 })).toBe(false);
    expect(mgr.isPolygonInProgress()).toBe(false);
    expect(log.firstPoint).toBe(1);
  });

  it('OnFirstPoint is not asked again once the outline is running', () => {
    const { mgr, log } = mgrWith();
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 100, y: 0 });
    expect(log.firstPoint).toBe(1);
  });
});

describe('DeleteLastCorner', () => {
  it('returns the corner it removed and shortens the outline', () => {
    const { mgr } = mgrWith();
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 100, y: 0 });
    click(mgr, { x: 100, y: 100 });

    expect(mgr.deleteLastCorner()).toEqual({ x: 100, y: 100 });
    expect(pts(mgr.getLockedInPoints())).toEqual([
      [0, 0],
      [100, 0],
    ]);
  });

  it('returns null once there is nothing left to delete', () => {
    const { mgr } = mgrWith();
    mgr.addPoint({ x: 0, y: 0 });
    expect(mgr.deleteLastCorner()).toEqual({ x: 0, y: 0 });
    expect(mgr.deleteLastCorner()).toBeNull();
  });

  it('rebuilds the leader from the corner that is now last', () => {
    const { mgr } = mgrWith();
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 100, y: 0 });
    mgr.setCursorPosition({ x: 200, y: 50 });
    mgr.deleteLastCorner();

    // "update the new last segment (was previously locked in), reusing last
    // constraints" — the leader must start at (0,0) now, not at the deleted
    // (100,0).
    expect(pts(mgr.getLeaderLinePoints())).toEqual([
      [0, 0],
      [200, 50],
    ]);
  });
});

describe('Reset', () => {
  it('drops all three chains and reports the change', () => {
    const { mgr, log } = mgrWith();
    mgr.setLeaderMode(LeaderMode.DEG45);
    click(mgr, { x: 0, y: 0 });
    click(mgr, { x: 100, y: 0 });
    const before = log.geometry;

    mgr.reset();

    expect(mgr.isPolygonInProgress()).toBe(false);
    expect(mgr.getLockedInPoints()).toHaveLength(0);
    expect(mgr.getLeaderLinePoints()).toHaveLength(0);
    expect(mgr.getLoopLinePoints()).toHaveLength(0);
    expect(log.geometry).toBe(before + 1);
  });
});

describe('IsSelfIntersecting', () => {
  it('is false for a simple quadrilateral', () => {
    const { mgr } = mgrWith();
    for (const p of [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ])
      click(mgr, p);

    expect(mgr.isSelfIntersecting(false)).toBe(false);
  });

  it('is true for a bow tie', () => {
    const { mgr } = mgrWith();
    for (const p of [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ])
      click(mgr, p);

    expect(mgr.isSelfIntersecting(false)).toBe(true);
  });
});
