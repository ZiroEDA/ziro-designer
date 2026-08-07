// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS_PCBNEW_RULE_RESOLVER` over this repo's DRC rules engine.
 * Counterpart: `pcbnew/router/pns_kicad_iface.cpp:865-981` (`Clearance`),
 * `:537-790` (`QueryConstraint`), `:792-848` (the caches).
 *
 * What is pinned here is the arithmetic that decides how far a routed track
 * must stay from everything else, and the caching that decides how often that
 * arithmetic is redone:
 *
 * - **`rv` only climbs.** A constraint that does not resolve leaves the running
 *   value alone rather than zeroing it, and the answer is the worst case across
 *   every layer in the overlap.
 * - **Hole-to-hole and hole clearance are an `if/else if`; copper clearance is
 *   not in the chain.** A plated hole collects both.
 * - **Physical clearances are outside the net-aware block**, so a
 *   `physical_clearance` rule applies to a same-net pair as well — and that is
 *   the only way a same-net pair gets anything but `-1`.
 * - **The epsilon is subtracted only from a strictly positive value**, so `-1`
 *   survives intact.
 * - **Three caches on three schedules.** The identity-keyed one for board
 *   items, the property-keyed one for the router's throwaways, the hull one for
 *   geometry. `clearTemporaryCaches` touches only the middle;
 *   `clearCacheForItems` only the outer two.
 */
import { describe, expect, it } from 'vitest';
import { buildDrcRuleEngine } from '@ziroeda/pcbnew/src/drc/drc_rules_engine.js';
import { PnsBoardRuleResolver } from '@ziroeda/pcbnew/src/router/pns_rule_resolver.js';
import {
  defaultShapeCollider,
  getShapeCollider,
  PnsConstraintType,
} from '@ziroeda/pcbnew/src/router/pns_collision.js';
import { PnsHole } from '@ziroeda/pcbnew/src/router/pns_hole.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import type { PnsResolverHost } from '@ziroeda/pcbnew/src/router/pns_rule_resolver.js';
import type { DrcRule } from '@ziroeda/pcbnew/src/drc/drc_rule.js';
import type { DrcEvalItem } from '@ziroeda/pcbnew/src/drc/drc_rules_engine.js';
import type { PnsItem } from '@ziroeda/pcbnew/src/router/pns_item.js';
import type { NetHandle } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const V = (x: number, y: number): Vec2 => ({ x, y });

const NET_A: NetHandle = { name: 'A' };
const NET_B: NetHandle = { name: 'B' };

/**
 * A host that answers every board question from plain fields, and counts the
 * `evalItem` calls — which is one per `queryConstraint`, and therefore the
 * window onto whether a cache was hit.
 */
class TestHost implements PnsResolverHost {
  rules: DrcRule[] = [];
  epsilon = 0;
  edges = new Set<PnsItem>();
  drilled = new Set<PnsItem>();
  evalItemCalls = 0;

  engine() {
    return buildDrcRuleEngine(this.rules, []);
  }

  boardLayer(aPnsLayer: number): string | undefined {
    return aPnsLayer === 0 ? 'F.Cu' : `In${aPnsLayer}.Cu`;
  }

  evalItem(aItem: PnsItem): DrcEvalItem | null {
    this.evalItemCalls++;
    return {
      type: 'Track',
      layer: 'F.Cu',
      netName: String((aItem.net() as { name?: string })?.name ?? ''),
    };
  }

  clearanceEpsilon(): number {
    return this.epsilon;
  }

  isEdge(aItem: PnsItem): boolean {
    return this.edges.has(aItem);
  }

  hasDrilledHole(aItem: PnsItem): boolean {
    return this.drilled.has(aItem);
  }
}

function rule(name: string, type: DrcRule['constraints'][number]['type'], min: number): DrcRule {
  return { name, constraints: [{ type, value: { min } }] };
}

function seg(a: Vec2, b: Vec2, net: NetHandle = NET_A, layer = 0): PnsSegment {
  const s = new PnsSegment({ seg: { a, b }, width: 100 }, net);
  s.setLayers(new PnsLayerRange(layer));
  return s;
}

function hole(at: Vec2, r = 100, net: NetHandle = NET_A, layer = 0): PnsHole {
  const h = new PnsHole({ kind: 'circle', c: at, r });
  h.setNet(net);
  h.setLayers(new PnsLayerRange(layer));
  return h;
}

/** `bothOwned` needs an owner on each side; any object will do. */
function own<T extends PnsItem>(aItem: T): T {
  aItem.setOwner({});
  return aItem;
}

function resolverWith(aRules: DrcRule[]): { host: TestHost; resolver: PnsBoardRuleResolver } {
  const host = new TestHost();
  host.rules = aRules;
  return { host, resolver: new PnsBoardRuleResolver(host) };
}

// ---------------------------------------------------------------------------------
describe('PnsBoardRuleResolver: clearance', () => {
  it('reads the clearance straight out of the rule set', () => {
    const { resolver } = resolverWith([rule('board setup', 'clearance', 200)]);

    expect(resolver.clearance(seg(V(0, 0), V(1000, 0)), seg(V(0, 500), V(1000, 500), NET_B))).toBe(
      200,
    );
  });

  it('takes the largest of every constraint that applies, not the last', () => {
    const { resolver } = resolverWith([
      rule('board setup', 'clearance', 200),
      rule('physical', 'physical_clearance', 500),
    ]);

    expect(resolver.clearance(seg(V(0, 0), V(1000, 0)), seg(V(0, 500), V(1000, 500), NET_B))).toBe(
      500,
    );
  });

  it('gives a same-net pair no clearance at all', () => {
    const { resolver } = resolverWith([rule('board setup', 'clearance', 200)]);

    // -1 is `collideSimple`'s "do not even test", not a zero clearance.
    expect(resolver.clearance(seg(V(0, 0), V(1000, 0)), seg(V(0, 500), V(1000, 500)))).toBe(-1);
  });

  it('lets a physical_clearance rule reach across a same-net pair', () => {
    const { resolver } = resolverWith([
      rule('board setup', 'clearance', 200),
      rule('physical', 'physical_clearance', 500),
    ]);

    // The net-aware block is skipped, but the physical query below it is not.
    expect(resolver.clearance(seg(V(0, 0), V(1000, 0)), seg(V(0, 500), V(1000, 500)))).toBe(500);
  });

  const HOLE_RULES: DrcRule[] = [
    rule('h2h', 'hole_to_hole', 700),
    rule('hc', 'hole_clearance', 300),
    rule('cl', 'clearance', 100),
  ];

  it('asks hole-to-hole for two drilled holes', () => {
    const { host, resolver } = resolverWith(HOLE_RULES);
    const a = hole(V(0, 0));
    const b = hole(V(1000, 0), 100, NET_B);
    host.drilled.add(a);
    host.drilled.add(b);

    // The `if` arm. Hole clearance sits in its `else` and is never asked — but
    // the copper clearance below has no `else` in front of it, so it is folded
    // in anyway and simply loses, being smaller.
    expect(resolver.clearance(a, b)).toBe(700);
  });

  it('folds copper clearance in for holes too — there is no `else` in front of it', () => {
    const { host, resolver } = resolverWith([
      rule('h2h', 'hole_to_hole', 300),
      rule('cl', 'clearance', 900),
    ]);
    const a = hole(V(0, 0));
    const b = hole(V(1000, 0), 100, NET_B);
    host.drilled.add(a);
    host.drilled.add(b);

    // Upstream's comment: "No 'else'; plated holes get both HOLE_CLEARANCE and
    // CLEARANCE." Chaining the copper test onto the hole tests would cap this
    // at 300.
    expect(resolver.clearance(a, b)).toBe(900);
  });

  it('asks hole clearance when only one side is drilled', () => {
    const { host, resolver } = resolverWith(HOLE_RULES);
    const a = hole(V(0, 0));
    const b = hole(V(1000, 0), 100, NET_B);
    host.drilled.add(a);

    expect(resolver.clearance(a, b)).toBe(300);
  });

  it('cannot tell a drilled hole from an undrilled twin, because the temp key does not carry drilling', () => {
    const { host, resolver } = resolverWith(HOLE_RULES);
    const a = hole(V(0, 0));
    const drilled = hole(V(1000, 0), 100, NET_B);
    const undrilled = hole(V(1000, 0), 100, NET_B);
    host.drilled.add(a);
    host.drilled.add(drilled);

    expect(resolver.clearance(a, drilled)).toBe(700);

    // `TEMP_CLEARANCE_CACHE_KEY::SIDE` carries the board item, net, layer span,
    // kind and free-pad flag — and nothing else. Two property-identical holes
    // therefore share one entry whatever their drills say, and the second
    // query gets the first's answer. Upstream's, and it is why the temporary
    // cache exists at all: it is a bet that the six fields determine the rules.
    expect(resolver.clearance(a, undrilled)).toBe(700);

    // Give them an owner and the identity-keyed cache tells them apart.
    resolver.clearCaches();
    expect(resolver.clearance(own(a), own(undrilled))).toBe(300);
  });

  it('subtracts the epsilon from a positive value only', () => {
    const { host, resolver } = resolverWith([rule('board setup', 'clearance', 200)]);
    host.epsilon = 30;

    expect(resolver.clearance(seg(V(0, 0), V(1000, 0)), seg(V(0, 500), V(1000, 500), NET_B))).toBe(
      170,
    );
    // The same-net -1 is not 170 units below itself.
    expect(resolver.clearance(seg(V(0, 0), V(1000, 0)), seg(V(0, 500), V(1000, 500)))).toBe(-1);
    // ...and the flag is part of the cache key, so the un-relaxed answer is
    // still available.
    expect(
      resolver.clearance(seg(V(0, 0), V(1000, 0)), seg(V(0, 500), V(1000, 500), NET_B), false),
    ).toBe(200);
  });

  it('never goes below zero when the epsilon exceeds the clearance', () => {
    const { host, resolver } = resolverWith([rule('board setup', 'clearance', 20)]);
    host.epsilon = 500;

    expect(resolver.clearance(seg(V(0, 0), V(1000, 0)), seg(V(0, 500), V(1000, 500), NET_B))).toBe(
      0,
    );
  });

  it('takes the *other* item’s layers when one side is a board edge', () => {
    const { host, resolver } = resolverWith([rule('edge', 'edge_clearance', 400)]);

    const edge = seg(V(0, 0), V(1000, 0), NET_B, 0);
    const track = seg(V(0, 200), V(1000, 200), NET_A, 0);
    host.edges.add(edge);

    // The edge clearance rule is only reached because `isEdge` says so.
    expect(resolver.clearance(edge, track)).toBe(400);
  });

  it('returns zero when no rule matches at all', () => {
    const { resolver } = resolverWith([]);

    // `rv` starts at 0 and nothing raised it; the same-net escape does not
    // apply across two nets.
    expect(resolver.clearance(seg(V(0, 0), V(1000, 0)), seg(V(0, 500), V(1000, 500), NET_B))).toBe(
      0,
    );
  });

  it('treats an ignored rule as -1', () => {
    const { resolver } = resolverWith([
      {
        name: 'off',
        severity: 'ignore',
        constraints: [{ type: 'clearance', value: { min: 900 } }],
      },
    ]);

    const c = resolver.queryConstraint(
      PnsConstraintType.CT_CLEARANCE,
      seg(V(0, 0), V(1000, 0)),
      seg(V(0, 500), V(1000, 500), NET_B),
      0,
    );

    expect(c?.value.min).toBe(-1);
  });

  it('answers nothing for a constraint type it has no host mapping for', () => {
    const { resolver } = resolverWith([rule('board setup', 'clearance', 200)]);

    // CT_DIFF_PAIR_GAP maps; the enum values that do not are the `default:
    // return false` arm, and there must be no fall-through to a default type.
    expect(
      resolver.queryConstraint(
        99 as PnsConstraintType,
        seg(V(0, 0), V(1000, 0)),
        seg(V(0, 500), V(1000, 500)),
        0,
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------------
describe('PnsBoardRuleResolver: the caches', () => {
  it('caches by identity when both items are owned, and is symmetric', () => {
    const { host, resolver } = resolverWith([rule('board setup', 'clearance', 200)]);
    const a = own(seg(V(0, 0), V(1000, 0)));
    const b = own(seg(V(0, 500), V(1000, 500), NET_B));

    expect(resolver.clearance(a, b)).toBe(200);
    const after = host.evalItemCalls;
    expect(after).toBeGreaterThan(0);

    expect(resolver.clearance(a, b)).toBe(200);
    // `Clearance(b, a)` must hit the same entry — upstream sorts the two
    // pointers for exactly this reason.
    expect(resolver.clearance(b, a)).toBe(200);
    expect(host.evalItemCalls).toBe(after);
  });

  it('caches unowned items by their properties, so two clones share an entry', () => {
    const { host, resolver } = resolverWith([rule('board setup', 'clearance', 200)]);
    const a = seg(V(0, 0), V(1000, 0));
    const b = seg(V(0, 500), V(1000, 500), NET_B);

    expect(resolver.clearance(a, b)).toBe(200);
    const after = host.evalItemCalls;

    // A different object with the same board item, net, layers, kind and
    // free-pad flag — the router makes these by the thousand.
    const aClone = seg(V(0, 0), V(2000, 0));
    const bClone = seg(V(0, 900), V(2000, 900), NET_B);

    expect(resolver.clearance(aClone, bClone)).toBe(200);
    expect(host.evalItemCalls).toBe(after);
  });

  it('keeps the two clearance caches separate', () => {
    const { host, resolver } = resolverWith([rule('board setup', 'clearance', 200)]);
    const ownedA = own(seg(V(0, 0), V(1000, 0)));
    const ownedB = own(seg(V(0, 500), V(1000, 500), NET_B));
    const tempA = seg(V(0, 0), V(1000, 0));
    const tempB = seg(V(0, 500), V(1000, 500), NET_B);

    resolver.clearance(ownedA, ownedB);
    resolver.clearance(tempA, tempB);
    const after = host.evalItemCalls;

    // Only the property-keyed one is dropped, so the owned pair still hits.
    resolver.clearTemporaryCaches();
    resolver.clearance(ownedA, ownedB);
    expect(host.evalItemCalls).toBe(after);

    resolver.clearance(tempA, tempB);
    expect(host.evalItemCalls).toBeGreaterThan(after);
  });

  it('drops an identity entry when either side is named dirty', () => {
    const { host, resolver } = resolverWith([rule('board setup', 'clearance', 200)]);
    const a = own(seg(V(0, 0), V(1000, 0)));
    const b = own(seg(V(0, 500), V(1000, 500), NET_B));

    resolver.clearance(a, b);
    const after = host.evalItemCalls;

    // Naming the *second* item must evict too — the sweep tests both sides.
    resolver.clearCacheForItems([b]);
    resolver.clearance(a, b);
    expect(host.evalItemCalls).toBeGreaterThan(after);
  });

  it('does nothing at all for an empty dirty list', () => {
    const { host, resolver } = resolverWith([rule('board setup', 'clearance', 200)]);
    const a = own(seg(V(0, 0), V(1000, 0)));
    const b = own(seg(V(0, 500), V(1000, 500), NET_B));

    resolver.clearance(a, b);
    const after = host.evalItemCalls;

    resolver.clearCacheForItems([]);
    resolver.clearance(a, b);
    expect(host.evalItemCalls).toBe(after);
  });

  it('memoises hulls per (item, clearance, thickness, layer) and evicts them by item', () => {
    const { resolver } = resolverWith([]);
    const s = seg(V(0, 0), V(1000, 0));

    const first = resolver.hullCache(s, 100, 0, 0);
    expect(resolver.hullCache(s, 100, 0, 0)).toBe(first);
    // A different clearance is a different key.
    expect(resolver.hullCache(s, 200, 0, 0)).not.toBe(first);

    resolver.clearCacheForItems([s]);
    expect(resolver.hullCache(s, 100, 0, 0)).not.toBe(first);
  });

  it('does NOT install a shape collider as a side effect of being constructed', () => {
    const before = getShapeCollider();
    const { resolver } = resolverWith([rule('board setup', 'clearance', 200)]);

    resolver.clearance(seg(V(0, 0), V(1000, 0)), seg(V(0, 500), V(1000, 500), NET_B));

    // The location-capable collider is a process-wide singleton. A resolver
    // that installed one would make the collision *verdict* depend on which
    // objects had been constructed and in what order — and the default
    // collider's honest `location: null`, which makes `collideSimple` throw on
    // the castellation and net-tie paths, is exactly the signal that should
    // stay audible. Callers install it explicitly via
    // `installLocatingShapeCollider()`.
    expect(getShapeCollider()).toBe(before);
    expect(getShapeCollider()).toBe(defaultShapeCollider);
  });

  it('clearCaches drops everything, including the physical-constraint memo', () => {
    const host = new TestHost();
    host.rules = [rule('board setup', 'clearance', 200)];

    let physicalAsked = 0;
    const withMemo: PnsResolverHost = {
      ...host,
      engine: () => host.engine(),
      boardLayer: (l) => host.boardLayer(l),
      evalItem: (i) => host.evalItem(i),
      hasUserDefinedPhysicalConstraint: () => {
        physicalAsked++;
        return false;
      },
    };
    const resolver = new PnsBoardRuleResolver(withMemo);

    resolver.hasUserDefinedPhysicalConstraint();
    resolver.hasUserDefinedPhysicalConstraint();
    expect(physicalAsked).toBe(1);

    resolver.clearCaches();
    resolver.hasUserDefinedPhysicalConstraint();
    expect(physicalAsked).toBe(2);
  });
});
