// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `NODE::QueryColliding`, `NODE::CheckColliding` and `NODE::NearestObstacle`.
 * Counterpart: `pcbnew/router/pns_node.cpp:186-531`.
 *
 * These three are what the shove algorithm is written against, so the things
 * worth pinning are the ones a reasonable person would "clean up":
 *
 * - **`NearestObstacle` deduplicates by item across the whole line.** Upstream
 *   builds its per-segment `SEGMENT` as a stack temporary *inside* the loop, so
 *   every obstacle carries the same `m_head` address and `std::set<OBSTACLE>`
 *   — keyed on `(head, item)` — collapses twelve segments hitting one pad into
 *   one obstacle. The port reuses one scratch segment object to reproduce it.
 * - **The filter order in `DEFAULT_OBSTACLE_VISITOR`.** Kind, self, caller
 *   filter, override, collide, limit. The caller's filter runs *before* the
 *   override test and therefore sees items the branch has deleted; the override
 *   test runs *before* `Collide`, which is what stops a deleted item being
 *   inserted into the obstacle set by `Collide` itself.
 * - **The limit is checked after the insert, and only when it is `> 0`.** A
 *   limit of zero does not stop the scan.
 * - **`QueryColliding` returns the size of the whole set**, not the number this
 *   call added, so accumulating callers over-count.
 * - **`CheckColliding` returns `*obstacles.begin()`.** Upstream that is
 *   whichever item sits lowest in memory; here it is the first one found, and
 *   this is the only place the difference is visible.
 * - **The `INT_MAX` fallback** returns `obstacles[0]` carrying the fields
 *   `Collide` wrote, not the sentinel.
 */
import { describe, expect, it } from 'vitest';
import {
  ObstacleSet,
  type CollisionSearchOptions,
  type NetHandle,
  type Obstacle,
  type PnsRuleResolver,
} from '@ziroeda/pcbnew/src/router/pns_collision.js';
import { PnsItemSet } from '@ziroeda/pcbnew/src/router/pns_itemset.js';
import { PnsKind } from '@ziroeda/pcbnew/src/router/pns_item.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsLine, PnsLineChain } from '@ziroeda/pcbnew/src/router/pns_line_item.js';
import { PnsNode } from '@ziroeda/pcbnew/src/router/pns_node.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsVVia, PnsVia } from '@ziroeda/pcbnew/src/router/pns_via.js';
import { itemHull } from '@ziroeda/pcbnew/src/router/pns_item_hull.js';
import type { PnsItem } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

const NET_A: NetHandle = { name: 'A' };
const NET_B: NetHandle = { name: 'B' };

/**
 * A resolver that answers one clearance for everything and counts what it is
 * asked. The hull-cache counter is the lever the dedup tests pull: upstream
 * primes exactly one hull per obstacle, so the count *is* the obstacle count.
 */
class CountingResolver implements PnsRuleResolver {
  clearanceValue: number;
  clearanceCalls = 0;
  hullCalls: { item: PnsItem; clearance: number }[] = [];

  constructor(aClearance = 0) {
    this.clearanceValue = aClearance;
  }

  clearance(): number {
    this.clearanceCalls++;
    return this.clearanceValue;
  }

  hullCache(item: PnsItem, clearance: number, walkaroundThickness: number, layer: number) {
    this.hullCalls.push({ item, clearance });
    return itemHull(item, clearance, walkaroundThickness, layer);
  }

  dpCoupledNet(): NetHandle {
    return null;
  }
  dpNetPolarity(): number {
    return 0;
  }
  dpNetPair(): null {
    return null;
  }
  netCode(): number {
    return 0;
  }
  netName(): string {
    return '';
  }
  isInNetTie(): boolean {
    return false;
  }
  isNetTieExclusion(): boolean {
    return false;
  }
  isDrilledHole(): boolean {
    return false;
  }
  isNonPlatedSlot(): boolean {
    return false;
  }
  isKeepout() {
    return { keepout: false, enforce: false };
  }
  queryConstraint(): null {
    return null;
  }
}

interface SegOpts {
  net?: NetHandle;
  layer?: number;
  width?: number;
}

function seg(a: Vec2, b: Vec2, opts: SegOpts = {}): PnsSegment {
  const s = new PnsSegment({ seg: { a, b }, width: opts.width ?? 100 }, opts.net ?? NET_A);
  s.setLayers(new PnsLayerRange(opts.layer ?? 0));
  return s;
}

function solid(at: Vec2, r = 250, opts: { net?: NetHandle; layer?: number } = {}): PnsSolid {
  const s = new PnsSolid();
  s.setNet(opts.net ?? NET_B);
  s.setLayers(new PnsLayerRange(opts.layer ?? 0));
  s.setShape({ kind: 'circle', c: V(0, 0), r });
  s.setPos(at);
  return s;
}

function line(points: Vec2[], opts: SegOpts = {}): PnsLine {
  const l = new PnsLine();
  l.setShape(PnsLineChain.fromPoints(points));
  l.setWidth(opts.width ?? 100);
  l.setLayers(new PnsLayerRange(opts.layer ?? 0));
  l.setNet(opts.net ?? NET_A);
  return l;
}

/** A node with a counting resolver and a wide enough search radius. */
function nodeWith(aClearance = 0): { node: PnsNode; resolver: CountingResolver } {
  const node = new PnsNode();
  const resolver = new CountingResolver(aClearance);
  node.setRuleResolver(resolver);
  return { node, resolver };
}

/** Every obstacle in a fresh query, as `(head, item)` pairs. */
function query(
  node: PnsNode,
  item: PnsItem,
  opts?: CollisionSearchOptions,
): { count: number; obstacles: readonly Obstacle[] } {
  const set = new ObstacleSet();
  const count = node.queryColliding(item, set, opts);
  return { count, obstacles: set.items() };
}

// ---------------------------------------------------------------------------------
describe('NODE::QueryColliding', () => {
  it('finds a foreign solid in the way, with the query item as the head', () => {
    const { node } = nodeWith();
    const pad = solid(V(1000, 0));
    node.addSolid(pad);

    const head = seg(V(900, 0), V(1100, 0));
    const { count, obstacles } = query(node, head);

    expect(count).toBe(1);
    expect(obstacles[0]?.item).toBe(pad);
    expect(obstacles[0]?.head).toBe(head);
  });

  it('answers nothing at all when the *query* item is virtual', () => {
    const { node } = nodeWith();
    node.addSolid(solid(V(0, 0)));

    // A VVIA exists to give shove something to push on; it is not a probe.
    // Note the *foreign* net: a same-net pair would answer nothing anyway,
    // which would make the early return look load-bearing when it was not.
    const vvia = new PnsVVia(V(0, 0), 0, 400, NET_A);
    const set = new ObstacleSet();

    expect(node.queryColliding(vvia, set)).toBe(0);
    expect(set.empty()).toBe(true);
  });

  it('applies the kind mask to candidates — but not to what Collide inserts below it', () => {
    const { node } = nodeWith();
    const pad = solid(V(1000, 0));
    const v = new PnsVia(V(1000, 0), new PnsLayerRange(0, 3), 400, 200, NET_B);
    node.addSolid(pad);
    node.addVia(v);

    const head = seg(V(900, 0), V(1100, 0));

    // The mask is the visitor's first test, so the pad is never offered. The
    // via's *hole* is a separate index item that the mask also rejects — and it
    // still ends up in the set, because `collideSimple` recurses into the
    // candidate's hole and inserts on its own account, well below the visitor.
    const vias = query(node, head, { kindMask: PnsKind.VIA_T }).obstacles.map((o) => o.item);
    expect(vias).toContain(v);
    expect(vias).toContain(v.hole());
    expect(vias).not.toContain(pad);

    expect(query(node, head, { kindMask: PnsKind.SOLID_T }).obstacles.map((o) => o.item)).toEqual([
      pad,
    ]);
  });

  it('never collides an item with itself', () => {
    const { node } = nodeWith();
    const s = seg(V(0, 0), V(1000, 0));
    node.addSegment(s);

    expect(query(node, s).count).toBe(0);
  });

  it('honours a caller filter', () => {
    const { node } = nodeWith();
    const near = solid(V(1000, 0));
    const far = solid(V(1000, 300));
    node.addSolid(near);
    node.addSolid(far);

    const head = seg(V(900, 0), V(1100, 300));
    const seen: PnsItem[] = [];
    const { obstacles } = query(node, head, {
      filter: (i) => {
        seen.push(i);
        return i === near;
      },
    });

    expect(seen).toContain(far);
    expect(obstacles.map((o) => o.item)).toEqual([near]);
  });

  it('stops the scan once `limitCount` obstacles are in the set', () => {
    const { node } = nodeWith();
    node.addSolid(solid(V(1000, 0)));
    node.addSolid(solid(V(1000, 200)));

    const head = seg(V(900, 0), V(1100, 200));

    expect(query(node, head).count).toBe(2);
    expect(query(node, head, { limitCount: 1 }).count).toBe(1);
  });

  it('lets the set overshoot the limit, because the count is checked after the insert', () => {
    const { node } = nodeWith();
    node.addSolid(solid(V(1000, 0)));

    // One candidate, two inserts: `collideSimple`'s special case for the head
    // via's hole records `(hole, pad)` before the via's own shape records
    // `(via, pad)`. The limit is only consulted afterwards, so it is a soft cap
    // rather than a bound on the set.
    const head = new PnsVia(V(1000, 0), new PnsLayerRange(0, 3), 400, 200, NET_A);

    expect(query(node, head, { limitCount: 1 }).count).toBe(2);
  });

  it('does NOT stop on a limit of zero — the test is `> 0`', () => {
    const { node } = nodeWith();
    node.addSolid(solid(V(1000, 0)));
    node.addSolid(solid(V(1000, 200)));

    const head = seg(V(900, 0), V(1100, 200));

    expect(query(node, head, { limitCount: 0 }).count).toBe(2);
  });

  it('returns the size of the whole set, not the number this call added', () => {
    const { node } = nodeWith();
    node.addSolid(solid(V(1000, 0)));
    node.addSolid(solid(V(3000, 0)));

    const set = new ObstacleSet();

    // Two probes, one shared set. The second call adds one obstacle and
    // reports two — which is exactly why `CheckColliding` can only ask "is n
    // non-zero" of the number it accumulates.
    expect(node.queryColliding(seg(V(900, 0), V(1100, 0)), set)).toBe(1);
    expect(node.queryColliding(seg(V(2900, 0), V(3100, 0)), set)).toBe(2);
  });

  it('searches the root as well from a branch, minus what the branch removed', () => {
    const { node: root } = nodeWith();
    const kept = solid(V(1000, 0));
    const removed = solid(V(1000, 200));
    root.addSolid(kept);
    root.addSolid(removed);

    const branch = root.branch();
    branch.removeSolid(removed);

    const head = seg(V(900, 0), V(1100, 200));

    expect(query(root, head).obstacles.map((o) => o.item)).toEqual([kept, removed]);
    expect(query(branch, head).obstacles.map((o) => o.item)).toEqual([kept]);
  });

  it('runs the caller filter BEFORE the override test, so the filter sees removed items', () => {
    const { node: root } = nodeWith();
    const removed = solid(V(1000, 0));
    root.addSolid(removed);

    const branch = root.branch();
    branch.removeSolid(removed);

    const head = seg(V(900, 0), V(1100, 0));
    const seen: PnsItem[] = [];
    const { obstacles } = query(branch, head, {
      filter: (i) => {
        seen.push(i);
        return true;
      },
    });

    // The filter was offered the overridden item...
    expect(seen).toContain(removed);
    // ...and the override test still kept it out of the results.
    expect(obstacles).toEqual([]);
  });

  it('uses *this* node’s max clearance for the root pass too', () => {
    // A clearance wide enough that the two really do collide: what is being
    // pinned is the *proximity radius* of the index query, so the pair has to
    // be one the collide would accept if it were ever offered.
    const { node: root } = nodeWith(5000);
    root.addSolid(solid(V(4000, 0)));

    expect(query(root, seg(V(0, 0), V(100, 0))).count).toBe(1);

    const branch = root.branch();
    // The radius is read off the branch for both passes, never off the root —
    // whose own 0.8 mm default would have found this.
    branch.setMaxClearance(1);

    expect(query(branch, seg(V(0, 0), V(100, 0))).count).toBe(0);
  });
});

// ---------------------------------------------------------------------------------
describe('NODE::NearestObstacle: the shared scratch segment', () => {
  /**
   * The headline. A twelve-segment line running the length of one long
   * obstacle collides with it from every segment, and upstream's stack-slot
   * reuse collapses all twelve into a single `OBSTACLE`. The hull cache is
   * primed exactly once per obstacle, so counting its calls counts obstacles.
   */
  it('collapses one obstacle hit by every segment of a line into a single obstacle', () => {
    const { node, resolver } = nodeWith(200);
    const wall = seg(V(0, 400), V(12000, 400), { net: NET_B });
    node.addSegment(wall);

    const pts: Vec2[] = [];
    for (let i = 0; i <= 12; i++) pts.push(V(i * 1000, 300));

    const l = line(pts);
    const obs = node.nearestObstacle(l);

    expect(obs?.item).toBe(wall);
    // One obstacle, therefore one primed hull — not twelve.
    expect(resolver.hullCalls).toHaveLength(1);
    expect(resolver.hullCalls[0]?.item).toBe(wall);
    // The hull is grown by the rule clearance plus **half** the line's width:
    // the other half sits on the far side of the line's own centreline, which
    // is the arithmetic that makes a centreline clear of the hull leave a
    // track edge exactly at the clearance.
    expect(resolver.hullCalls[0]?.clearance).toBe(200 + 50);
  });

  it('keeps distinct obstacles distinct — the dedup is by item, not a cap of one', () => {
    const { node, resolver } = nodeWith(200);
    const a = solid(V(2000, 400), 250);
    const b = solid(V(9000, 400), 250);
    node.addSolid(a);
    node.addSolid(b);

    const pts: Vec2[] = [];
    for (let i = 0; i <= 12; i++) pts.push(V(i * 1000, 300));

    node.nearestObstacle(line(pts));

    expect(resolver.hullCalls.map((h) => h.item)).toEqual([a, b]);
  });

  it('keys the line’s via separately, so one item can be two obstacles', () => {
    const { node, resolver } = nodeWith(200);
    const wall = seg(V(0, 400), V(4000, 400), { net: NET_B });
    node.addSegment(wall);

    const l = line([V(0, 300), V(1000, 300), V(2000, 300)]);
    const v = new PnsVia(V(2000, 300), new PnsLayerRange(0, 3), 600, 300, NET_A);
    l.appendVia(v);

    node.nearestObstacle(l);

    // Three obstacles against the one wall, because there are three distinct
    // heads: the scratch segment, the line's via, and — inserted by
    // `collideSimple`'s "special case for the head via's hole" — that via's
    // hole. Each primes a line hull *and* a via hull, because the line ends
    // with a via. Six primes for one obstacle item.
    expect(resolver.hullCalls).toHaveLength(6);
    expect(new Set(resolver.hullCalls.map((h) => h.item))).toEqual(new Set([wall]));
  });

  it('returns null when nothing is in the way', () => {
    const { node } = nodeWith(200);
    node.addSolid(solid(V(50000, 50000)));

    expect(node.nearestObstacle(line([V(0, 0), V(1000, 0)]))).toBeNull();
  });

  it('picks the obstacle the line meets first', () => {
    const { node } = nodeWith(200);
    const near = solid(V(2000, 0), 250);
    const far = solid(V(8000, 0), 250);
    node.addSolid(far);
    node.addSolid(near);

    const obs = node.nearestObstacle(line([V(0, 0), V(10000, 0)]));

    expect(obs?.item).toBe(near);
    expect(obs?.distFirst).toBeGreaterThan(0);
  });

  it('falls back to obstacles[0] with the fields Collide wrote, not the sentinel', () => {
    const { node } = nodeWith(200);
    const pad = solid(V(0, 0), 2000);
    node.addSolid(pad);

    // A line entirely inside the obstacle's hull crosses it nowhere, so every
    // intersection test fails and the reduction never fires.
    const obs = node.nearestObstacle(line([V(-100, 0), V(100, 0)]));

    expect(obs?.item).toBe(pad);
    expect(obs?.distFirst).toBe(0);
    expect(obs?.ipFirst).toEqual({ x: 0, y: 0 });
    expect(obs?.distFirst).not.toBe(Number.MAX_SAFE_INTEGER);
  });

  it('throws rather than guessing when there is no rule resolver', () => {
    const node = new PnsNode();
    node.addSolid(solid(V(1000, 0)));

    // `NearestObstacle` dereferences the resolver unguarded upstream, two
    // lines after `GetClearance` happily tolerates a null one.
    expect(() => node.nearestObstacle(line([V(0, 0), V(2000, 0)]))).toThrow(/rule resolver/);
  });
});

// ---------------------------------------------------------------------------------
describe('NODE::CheckColliding', () => {
  it('returns the first obstacle found, deterministically', () => {
    const { node } = nodeWith();
    const first = solid(V(1000, 0));
    const second = solid(V(1000, 200));
    node.addSolid(first);
    node.addSolid(second);

    const obs = node.checkColliding(seg(V(900, 0), V(1100, 200)));

    // Upstream this is `*std::set::begin()`, i.e. the lowest heap address.
    // Insertion order is what a garbage-collected language can offer, and it
    // is the one place the choice is observable.
    expect(obs?.item).toBe(first);
  });

  it('returns the *first* of several obstacles one candidate inserted', () => {
    const { node } = nodeWith();
    const pad = solid(V(1000, 0));
    node.addSolid(pad);

    // A via head against one pad inserts twice — `(hole, pad)` from
    // `collideSimple`'s head-hole special case, then `(via, pad)` — so the set
    // holds two entries before the limit is consulted. This is the case where
    // "which one does `*begin()` return" has an answer to get wrong.
    const head = new PnsVia(V(1000, 0), new PnsLayerRange(0, 3), 400, 200, NET_A);
    const obs = node.checkColliding(head);

    expect(obs?.head).toBe(head.hole());
    expect(obs?.head).not.toBe(head);
  });

  it('returns null when nothing collides', () => {
    const { node } = nodeWith();
    node.addSolid(solid(V(50000, 0)));

    expect(node.checkColliding(seg(V(0, 0), V(100, 0)))).toBeNull();
  });

  it('the kind-mask overload caps the search at one obstacle', () => {
    const { node } = nodeWith();
    node.addSolid(solid(V(1000, 0)));
    node.addSolid(solid(V(1000, 200)));

    const head = seg(V(900, 0), V(1100, 200));
    const seenCapped: PnsItem[] = [];
    const seenUncapped: PnsItem[] = [];

    // A filter is the only window onto how far the scan got. With the implicit
    // `limitCount = 1` the visitor stops the sub-index after the first hit.
    node.checkColliding(head, PnsKind.ANY_T);
    node.checkColliding(head, {
      filter: (i) => {
        seenCapped.push(i);
        return true;
      },
      limitCount: 1,
    });
    node.checkColliding(head, {
      filter: (i) => {
        seenUncapped.push(i);
        return true;
      },
      limitCount: -1,
    });

    // The options overload does *not* force a limit of one, which is why the
    // uncapped scan reaches further.
    expect(seenUncapped.length).toBeGreaterThan(seenCapped.length);
  });

  it('walks a LINE segment by segment and returns as soon as one hits', () => {
    const { node } = nodeWith();
    const early = solid(V(500, 0));
    const late = solid(V(5500, 0));
    node.addSolid(late);
    node.addSolid(early);

    const l = line([V(0, 0), V(1000, 0), V(6000, 0)]);
    const obs = node.checkColliding(l);

    // Segment 0 already hits `early`, so `late` is never queried at all.
    expect(obs?.item).toBe(early);
  });

  it('short-circuits an ITEM_SET on the first colliding member', () => {
    const { node } = nodeWith();
    const pad = solid(V(1000, 0));
    node.addSolid(pad);

    const set = new PnsItemSet();
    set.add(seg(V(0, 0), V(100, 0)));
    set.add(seg(V(900, 0), V(1100, 0)));

    expect(node.checkColliding(set)?.item).toBe(pad);
    expect(node.checkColliding(new PnsItemSet())).toBeNull();
  });
});

describe('NODE::NearestObstacle: the tie-break', () => {
  it('keeps the first of two obstacles the line reaches at the same distance', () => {
    // Upstream's scan is `if( dist < nearest_dist )`, strictly less. Two
    // obstacles the line meets at exactly the same distance therefore leave the
    // *earlier* one standing, where `<=` would let the later one displace it.
    // Nothing else in this file distinguishes the two, because a tie needs
    // deliberate symmetry: here the line runs between two identical solids
    // placed the same distance either side of it, so both crossings are at the
    // same path length and only the comparison decides which is returned.
    const { node } = nodeWith(200);

    const above = solid(V(3000, -400), 250, { net: NET_B });
    const below = solid(V(3000, 400), 250, { net: NET_B });
    node.addSolid(above);
    node.addSolid(below);

    const obs = node.nearestObstacle(line([V(0, 0), V(6000, 0)]));

    // Insertion order decides the tie, and the strict `<` preserves it.
    expect(obs?.item).toBe(above);
  });
});
