// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Solving creepage between two nets.
 * Counterparts: `CREEPAGE_GRAPH::AddNetElements`, `GeneratePaths`,
 * `ConnectChildren`, `DRC_TEST_PROVIDER_CREEPAGE::testCreepage`.
 *
 * The geometry answers "how far from this shape to that one". This assembles
 * those answers and asks what actually matters: how far a leakage current must
 * crawl to get from *any* part of one net to *any* part of another.
 *
 * Two properties carry the file, and both fail in the dangerous direction —
 * they make the reported distance too *short*, on the check whose entire
 * purpose is high-voltage safety:
 *
 * 1. **An obstacle must lengthen the route**, or the mill slot someone cut
 *    specifically to pass a safety test counts for nothing.
 * 2. **Sliding along a rim must cost what it costs.** A path that lands on one
 *    side of a round cutout and departs from the other has *travelled round
 *    it*, and must be charged the arc length. Charge the chord — or nothing —
 *    and a board reports a creepage it does not have.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { creepageDistance } from '@ziroeda/pcbnew/src/drc/drc_creepage.js';
import type { CreepShape } from '@ziroeda/pcbnew/src/drc/creepage_graph.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const MM = (n: number): number => mmToIU(n);
const P = (x: number, y: number): Vec2 => ({ x: MM(x), y: MM(y) });

const bp = (x: number, y: number): CreepShape => ({ kind: 'be-point', pos: P(x, y) });
const bc = (x: number, y: number, r: number): CreepShape => ({
  kind: 'be-circle',
  pos: P(x, y),
  radius: MM(r),
});
const cu = (x1: number, y1: number, x2: number, y2: number, w: number): CreepShape => ({
  kind: 'cu-segment',
  start: P(x1, y1),
  end: P(x2, y2),
  width: MM(w),
});

const OUTLINE = [P(0, 0), P(60, 0), P(60, 30), P(0, 30)];
/** Two 1 mm tracks whose facing ends are 30 mm apart, so 29 mm surface to surface. */
const NET_A = [cu(5, 15, 15, 15, 1)];
const NET_B = [cu(45, 15, 55, 15, 1)];
const DIRECT = MM(29);

const solve = (
  holes: Vec2[][],
  edges: CreepShape[],
  target = MM(300),
  nets: [number, CreepShape[]][] = [
    [1, NET_A],
    [2, NET_B],
  ],
) =>
  creepageDistance(
    { surface: { outline: OUTLINE, holes }, edges, copperByNet: new Map(nets) },
    1,
    2,
    target,
  );

describe('across open board', () => {
  it('is the gap between the copper surfaces', () => {
    // Centre to centre is 30; each track gives up half a millimetre of it.
    expect(solve([], [])?.distance).toBeCloseTo(DIRECT, -3);
  });

  it('reports the route, so a marker can be drawn along it', () => {
    expect(solve([], [])?.path).toEqual([P(15.5, 15), P(44.5, 15)]);
  });
});

describe('an obstacle in the way', () => {
  const SLOT: Vec2[][] = [[P(28, 5), P(32, 5), P(32, 25), P(28, 25)]];
  const CORNERS = [bp(28, 5), bp(32, 5), bp(32, 25), bp(28, 25)];

  it('lengthens the route rather than leaving it alone', () => {
    // The whole reason anyone mills a slot: it moves the two nets no further
    // apart, and makes the surface path go round.
    const result = solve(SLOT, CORNERS);

    expect(result).not.toBeNull();
    expect(result!.distance).toBeGreaterThan(DIRECT);
  });

  it('routes round the end of it', () => {
    // Past the slot's near corners rather than through it. The two copper
    // endpoints carry sub-micron detail from the tangent maths, so what is
    // pinned is the turn the route takes, which is the claim that matters.
    const path = solve(SLOT, CORNERS)!.path;

    expect(path).toHaveLength(4);
    expect(path[1]).toEqual(P(28, 5));
    expect(path[2]).toEqual(P(32, 5));
  });

  it('reports no route at all when nothing offers a way round', () => {
    // With no board-edge shapes there is nowhere to turn. Saying "no route" is
    // the honest answer; inventing a straight line through the slot would be
    // the dangerous one.
    expect(solve(SLOT, [])).toBeNull();
  });
});

describe('travelling along a rim', () => {
  // A round cutout between the two nets. The route lands on the rim, goes
  // round, and leaves — and the going round has to be paid for.
  const R = 8;
  const HOLE: Vec2[][] = [[P(30 - R, 15), P(30, 15 - R), P(30 + R, 15), P(30, 15 + R)]];

  it('costs the arc length, not the chord across it', () => {
    const result = solve(HOLE, [bc(30, 15, R)]);

    expect(result).not.toBeNull();
    const [from, on, off, to] = result!.path;
    const chord = Math.hypot(on!.x - off!.x, on!.y - off!.y);
    const arc = MM(R) * 2 * Math.asin(chord / (2 * MM(R)));

    // Both middle points really are on the rim, or this measures nothing.
    expect(Math.hypot(on!.x - MM(30), on!.y - MM(15))).toBeCloseTo(MM(R), -4);
    expect(Math.hypot(off!.x - MM(30), off!.y - MM(15))).toBeCloseTo(MM(R), -4);

    // The two legs are measured from the route itself, and the total must be
    // those plus the *arc*. Deriving the legs by subtracting the arc from the
    // total instead would make this an identity and prove nothing — which is
    // exactly what it did until a mutation walked straight through it.
    const legs =
      Math.hypot(on!.x - from!.x, on!.y - from!.y) + Math.hypot(to!.x - off!.x, to!.y - off!.y);

    expect(result!.distance).toBeCloseTo(legs + arc, -3);
    expect(result!.distance).not.toBeCloseTo(legs + chord, -3);
    expect(arc).toBeGreaterThan(chord);
  });

  it('still comes out longer than going straight would have been', () => {
    // The sanity check that catches a free slide: charge nothing for the rim
    // and this drops *below* the unobstructed distance, which is impossible.
    expect(solve(HOLE, [bc(30, 15, R)])!.distance).toBeGreaterThan(DIRECT);
  });
});

describe('what the solver declines to answer', () => {
  it('says nothing when a net has no copper', () => {
    expect(solve([], [], MM(300), [[1, NET_A]])).toBeNull();
    expect(solve([], [], MM(300), [[2, NET_B]])).toBeNull();
  });

  it('says nothing when the target is zero or less', () => {
    // Zero is how the check is switched off, and a negative target would make
    // the bounded search meaningless.
    expect(solve([], [], 0)).toBeNull();
    expect(solve([], [], -MM(5))).toBeNull();
  });

  it('says nothing when both nets reach the board edge but not each other', () => {
    // Each net finds a landing point, so the graph is populated — but the two
    // halves never join. The search must report that rather than the distance
    // to whichever fragment it got to.
    const far = solve([], [bp(18, 15), bp(42, 15)], MM(20));

    expect(far).toBeNull();
  });

  it('says nothing when the nets are further apart than the target', () => {
    // The bound is what keeps the graph from becoming every shape against
    // every other; a route longer than the creepage asked for is not
    // interesting.
    expect(solve([], [], MM(10))).toBeNull();
  });

  it('finds the route once the target reaches far enough', () => {
    expect(solve([], [], MM(40))?.distance).toBeCloseTo(DIRECT, -3);
  });
});

describe('one net’s own pieces', () => {
  it('cost nothing to move between, however far apart they are', () => {
    // A net is one conductor. Adding a second, distant track to net A must not
    // change the answer — the virtual node reaches both for free, and the
    // search still measures from the nearer.
    const spread: [number, CreepShape[]][] = [
      [1, [cu(5, 15, 15, 15, 1), cu(5, 2, 15, 2, 1)]],
      [2, NET_B],
    ];

    expect(solve([], [], MM(300), spread)?.distance).toBeCloseTo(DIRECT, -3);
  });

  it('are not measured against each other', () => {
    // Two pieces of the *same* net 1 mm apart would otherwise be the shortest
    // path in the graph and swamp the real answer.
    const close: [number, CreepShape[]][] = [
      [1, [cu(5, 15, 15, 15, 1), cu(5, 16.5, 15, 16.5, 1)]],
      [2, NET_B],
    ];

    expect(solve([], [], MM(300), close)?.distance).toBeCloseTo(DIRECT, -3);
  });
});
