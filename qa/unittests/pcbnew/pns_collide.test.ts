// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ITEM::Collide` / `ITEM::collideSimple` and `shouldWeConsiderHoleCollisions`.
 * Counterpart: `pcbnew/router/pns_item.cpp`.
 *
 * This is the router's single most consequential predicate: everything above it
 * — walkaround, shove, the obstacle search — is a strategy for reacting to what
 * it says. The tests below are organised around the decisions it makes in
 * order, because the order is itself load-bearing.
 *
 * The cases that are easy to get subtly wrong, and that each have a test whose
 * only job is to fail if someone "tidies" them:
 *
 * - **The `- 1` in the effective clearance.** Hulls are built to exactly the
 *   clearance, so touching a hull at exactly that distance must *not* collide.
 *   Off by one here and every walkaround path is a nanometre wrong.
 * - **The epsilon defaults to `false` when there is no search context**, even
 *   though the option's own default is `true`. A caller that passes no context
 *   gets the un-relaxed clearance.
 * - **A missing shape on the query layer returns false outright**, discarding
 *   collisions the hole recursion above it already put in the obstacle set. The
 *   set keeps them; the return value denies them.
 * - **Hole-to-hole collisions ignore nets entirely.** Two same-net holes still
 *   collide, because drills are a physical constraint and not an electrical one.
 * - **The two `IsKeepout` calls short-circuit**, so when the first says yes it
 *   is the *first* call's `enforce` that chooses between "exact boundary" and
 *   "no clearance at all".
 * - **A via's hole never collides with its own via**, and — because a `LINE`
 *   carries a *copy* of its via — nor does it collide with a geometrically
 *   identical copy of it. Pointer identity is not enough, so position, padstack,
 *   net and drill are all compared.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  makeCollisionSearchContext,
  ObstacleSet,
  setRouterIface,
  setShapeCollider,
  type CollisionNode,
  type KeepoutResult,
  type NetHandle,
  type PnsConstraint,
  type PnsRuleResolver,
} from '@ziroeda/pcbnew/src/router/pns_collision.js';
import { PnsItem, PnsKind, type PnsLineLike } from '@ziroeda/pcbnew/src/router/pns_item.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsHole } from '@ziroeda/pcbnew/src/router/pns_hole.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsVia } from '@ziroeda/pcbnew/src/router/pns_via.js';
import type { Shape } from '@ziroeda/pcbnew/src/drc/drc_geometry.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

// ----- stubs -------------------------------------------------------------------

class TestResolver implements PnsRuleResolver {
  physical = false;
  keepout: (a: PnsItem, b: PnsItem) => KeepoutResult = () => ({ keepout: false, enforce: false });
  nonPlatedSlot = false;
  inNetTie = false;
  netTieExcludes = false;
  netTieCalls: Vec2[] = [];

  clearance(): number {
    return 0;
  }

  hasUserDefinedPhysicalConstraint(): boolean {
    return this.physical;
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
    return this.inNetTie;
  }

  isNetTieExclusion(_item: PnsItem, pos: Vec2): boolean {
    this.netTieCalls.push(pos);
    return this.netTieExcludes;
  }

  isDrilledHole(): boolean {
    return false;
  }

  isNonPlatedSlot(): boolean {
    return this.nonPlatedSlot;
  }

  isKeepout(a: PnsItem, b: PnsItem): KeepoutResult {
    return this.keepout(a, b);
  }

  queryConstraint(): PnsConstraint | null {
    return null;
  }
}

class TestNode implements CollisionNode {
  resolver: PnsRuleResolver | null = new TestResolver();
  clearance = 0;
  /** What the last `getClearance` was told about the epsilon. */
  epsilonSeen: boolean | undefined;
  edgeExcludes = false;
  edgeCalls: Vec2[] = [];

  getRuleResolver(): PnsRuleResolver | null {
    return this.resolver;
  }

  getClearance(_a: PnsItem, _b: PnsItem, useClearanceEpsilon?: boolean): number {
    this.epsilonSeen = useClearanceEpsilon;
    return this.clearance;
  }

  queryEdgeExclusions(pos: Vec2): boolean {
    this.edgeCalls.push(pos);
    return this.edgeExcludes;
  }
}

/** A stand-in for `LINE`, which is not ported yet. */
class TestLine extends PnsItem implements PnsLineLike {
  constructor(
    private readonly w: number,
    private readonly v: PnsItem | null,
    private readonly sh: Shape | null,
  ) {
    super(PnsKind.LINE_T);
  }

  endsWithVia(): boolean {
    return this.v !== null;
  }

  via(): PnsItem {
    return this.v as PnsItem;
  }

  width(): number {
    return this.w;
  }

  override shape(): Shape | null {
    return this.sh;
  }

  clone(): TestLine {
    const l = new TestLine(this.w, this.v, this.sh);
    l.copyFrom(this);
    return l;
  }
}

/** An item that reports a hole but no copper — for the missing-shape path. */
class HollowItem extends PnsItem {
  constructor(private readonly h: PnsHole) {
    super(PnsKind.VIA_T);
    h.setParentPadVia(this);
  }

  override shape(): Shape | null {
    return null;
  }

  override hasHole(): boolean {
    return true;
  }

  override hole(): PnsHole {
    return this.h;
  }

  clone(): HollowItem {
    const c = new HollowItem(this.h);
    c.copyFrom(this);
    return c;
  }
}

// ----- fixtures ----------------------------------------------------------------

const onLayer0 = <T extends PnsItem>(item: T): T => {
  item.setLayers(new PnsLayerRange(0));
  return item;
};

/** A horizontal zero-width segment at height `y`. */
const hSeg = (y: number, net: NetHandle, width = 0): PnsSegment =>
  onLayer0(new PnsSegment({ seg: { a: { x: 0, y }, b: { x: 1000, y } }, width }, net));

const via = (at: Vec2, net: NetHandle, diameter = 600, drill = 300): PnsVia =>
  onLayer0(new PnsVia(at, new PnsLayerRange(0), diameter, drill, net));

afterEach(() => {
  setRouterIface(null);
  setShapeCollider(null);
});

// ----- the clearance arithmetic -------------------------------------------------

describe('the effective clearance', () => {
  it('is one unit short of the rule, so touching a hull exactly does not collide', () => {
    const node = new TestNode();
    node.clearance = 10;

    const a = hSeg(0, 1);
    expect(a.collide(hSeg(8, 2), node, 0)).toBe(true); // gap 8 < 9
    expect(a.collide(hSeg(9, 2), node, 0)).toBe(false); // gap 9, not < 9
    expect(a.collide(hSeg(100, 2), node, 0)).toBe(false);
  });

  it('overlapping shapes collide at any clearance, including zero', () => {
    const node = new TestNode();
    node.clearance = 0;
    expect(hSeg(0, 1).collide(hSeg(0, 2), node, 0)).toBe(true);
  });

  it('a negative clearance from the resolver means "never collide"', () => {
    const node = new TestNode();
    node.clearance = -1;
    expect(hSeg(0, 1).collide(hSeg(0, 2), node, 0)).toBe(false);
  });

  it('half of each LINE width is added, truncated', () => {
    const node = new TestNode();
    node.clearance = 10;

    const shape: Shape = { kind: 'stadium', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, r: 0 };
    // width 201 -> 100, not 100.5
    const line = onLayer0(new TestLine(201, null, shape));
    line.setNet(1);

    expect(line.collide(hSeg(108, 2), node, 0)).toBe(true); // 108 < 10 + 100 - 1
    expect(line.collide(hSeg(109, 2), node, 0)).toBe(false);
    // A width of 200 would give the same 100, so the truncation is only visible
    // as "201 does not buy an extra half unit".
    const even = onLayer0(new TestLine(200, null, shape));
    even.setNet(1);
    expect(even.collide(hSeg(108, 2), node, 0)).toBe(true);
    expect(even.collide(hSeg(109, 2), node, 0)).toBe(false);
  });
});

// ----- the epsilon default ------------------------------------------------------

describe('the clearance epsilon', () => {
  it('is false when there is no search context, despite the option defaulting true', () => {
    const node = new TestNode();
    hSeg(0, 1).collide(hSeg(50, 2), node, 0);
    expect(node.epsilonSeen).toBe(false);
  });

  it('is the option when a context is given', () => {
    const node = new TestNode();
    const ctx = makeCollisionSearchContext(new ObstacleSet());
    hSeg(0, 1).collide(hSeg(50, 2), node, 0, ctx);
    expect(node.epsilonSeen).toBe(true);

    const off = makeCollisionSearchContext(new ObstacleSet(), { useClearanceEpsilon: false });
    hSeg(0, 1).collide(hSeg(50, 2), node, 0, off);
    expect(node.epsilonSeen).toBe(false);
  });
});

// ----- the early exits ----------------------------------------------------------

describe('the early exits', () => {
  it('an item never collides with itself', () => {
    const node = new TestNode();
    node.clearance = 1000;
    const s = hSeg(0, 1);
    expect(s.collide(s, node, 0)).toBe(false);
  });

  it('items on disjoint layers never collide, whatever their geometry', () => {
    const node = new TestNode();
    node.clearance = 1000;
    const a = hSeg(0, 1);
    const b = hSeg(0, 2);
    b.setLayers(new PnsLayerRange(31));
    expect(a.collide(b, node, 0)).toBe(false);
  });
});

// ----- nets ---------------------------------------------------------------------

describe('nets', () => {
  it('same-net items skip clearance entirely', () => {
    const node = new TestNode();
    node.clearance = 1000;
    expect(hSeg(0, 7).collide(hSeg(0, 7), node, 0)).toBe(false);
  });

  it('the null net handle is not a net, so two netless items do collide', () => {
    const node = new TestNode();
    node.clearance = 1000;
    expect(hSeg(0, null).collide(hSeg(0, null), node, 0)).toBe(true);
  });

  it('net handle 0 *is* a net — it is not the null handle', () => {
    const node = new TestNode();
    node.clearance = 1000;
    expect(hSeg(0, 0).collide(hSeg(0, 0), node, 0)).toBe(false);
  });

  it('differentNetsOnly: false makes same-net items collide', () => {
    const node = new TestNode();
    node.clearance = 1000;
    const ctx = makeCollisionSearchContext(new ObstacleSet(), { differentNetsOnly: false });
    expect(hSeg(0, 7).collide(hSeg(0, 7), node, 0, ctx)).toBe(true);
  });

  it('a user-defined physical rule overrides the same-net skip', () => {
    const node = new TestNode();
    node.clearance = 1000;
    expect(hSeg(0, 7).collide(hSeg(0, 7), node, 0)).toBe(false);

    (node.resolver as TestResolver).physical = true;
    expect(hSeg(0, 7).collide(hSeg(0, 7), node, 0)).toBe(true);
  });

  it('a free pad skips clearance on either side, and a physical rule overrides that too', () => {
    const node = new TestNode();
    node.clearance = 1000;

    const free = hSeg(0, 1);
    free.setIsFreePad();
    expect(free.collide(hSeg(0, 2), node, 0)).toBe(false);
    expect(hSeg(0, 2).collide(free, node, 0)).toBe(false);

    (node.resolver as TestResolver).physical = true;
    expect(free.collide(hSeg(0, 2), node, 0)).toBe(true);
  });
});

// ----- keepouts -----------------------------------------------------------------

describe('keepouts', () => {
  it('an enforced keepout gives a zero clearance: exact boundary, no margin', () => {
    const node = new TestNode();
    node.clearance = 1000;
    (node.resolver as TestResolver).keepout = () => ({ keepout: true, enforce: true });

    expect(hSeg(0, 1).collide(hSeg(0, 2), node, 0)).toBe(true); // touching
    expect(hSeg(0, 1).collide(hSeg(5, 2), node, 0)).toBe(false); // 5 units apart
  });

  it('an unenforced keepout suppresses the collision altogether', () => {
    const node = new TestNode();
    node.clearance = 1000;
    (node.resolver as TestResolver).keepout = () => ({ keepout: true, enforce: false });
    expect(hSeg(0, 1).collide(hSeg(0, 2), node, 0)).toBe(false);
  });

  it('the two calls short-circuit, so the first "yes" decides the enforcement', () => {
    const node = new TestNode();
    node.clearance = 1000;

    const item = hSeg(0, 1);
    const head = hSeg(0, 2);

    // (item, head) says yes-but-not-enforced; (head, item) would say yes-and-
    // enforced. Short-circuiting means the second is never asked.
    let secondCalled = false;
    (node.resolver as TestResolver).keepout = (a, b) => {
      if (a === item && b === head) return { keepout: true, enforce: false };
      secondCalled = true;
      return { keepout: true, enforce: true };
    };

    expect(item.collide(head, node, 0)).toBe(false);
    expect(secondCalled).toBe(false);
  });

  it('the reversed call is consulted when the first says no', () => {
    const node = new TestNode();
    node.clearance = 1000;

    const item = hSeg(0, 1);
    const head = hSeg(0, 2);

    (node.resolver as TestResolver).keepout = (a) =>
      a === head ? { keepout: true, enforce: true } : { keepout: false, enforce: false };

    expect(item.collide(head, node, 0)).toBe(true);
  });

  it('the keepout test is not reached at all when an earlier branch matched', () => {
    const node = new TestNode();
    node.clearance = 1000;

    let asked = 0;
    (node.resolver as TestResolver).keepout = () => {
      asked++;
      return { keepout: false, enforce: false };
    };

    hSeg(0, 7).collide(hSeg(0, 7), node, 0); // same net: short-circuits before keepouts
    expect(asked).toBe(0);

    // Different nets: both directions are asked, in that order.
    hSeg(0, 1).collide(hSeg(0, 2), node, 0);
    expect(asked).toBe(2);
  });
});

// ----- the router interface -----------------------------------------------------

describe('the router interface', () => {
  it('an item not flashed on the other one’s layers cannot collide', () => {
    const node = new TestNode();
    node.clearance = 1000;
    expect(hSeg(0, 1).collide(hSeg(0, 2), node, 0)).toBe(true);

    setRouterIface({ isFlashedOnLayer: () => false });
    expect(hSeg(0, 1).collide(hSeg(0, 2), node, 0)).toBe(false);
  });

  it('is asked about both items, in both directions', () => {
    const node = new TestNode();
    node.clearance = 1000;

    const item = hSeg(0, 1);
    const head = hSeg(0, 2);
    const asked: PnsItem[] = [];

    setRouterIface({
      isFlashedOnLayer: (i) => {
        asked.push(i);
        return true;
      },
    });

    expect(item.collide(head, node, 0)).toBe(true);
    expect(asked).toEqual([item, head]);
  });
});

// ----- the override -------------------------------------------------------------

describe('overrideClearance', () => {
  it('replaces the resolver’s answer when it is not negative', () => {
    const node = new TestNode();
    node.clearance = 0;

    const ctx = makeCollisionSearchContext(new ObstacleSet(), { overrideClearance: 50 });
    expect(hSeg(0, 1).collide(hSeg(48, 2), node, 0, ctx)).toBe(true); // 48 < 49
    expect(hSeg(0, 1).collide(hSeg(49, 2), node, 0, ctx)).toBe(false);
  });

  it('a negative override falls through to the resolver', () => {
    const node = new TestNode();
    node.clearance = 1000;
    const ctx = makeCollisionSearchContext(new ObstacleSet(), { overrideClearance: -1 });
    expect(hSeg(0, 1).collide(hSeg(48, 2), node, 0, ctx)).toBe(true);
    expect(node.epsilonSeen).toBe(true);
  });
});

// ----- the obstacle set ---------------------------------------------------------

describe('recording into a search context', () => {
  it('records head, item and the clearance that was used', () => {
    const node = new TestNode();
    node.clearance = 1000;

    const item = hSeg(0, 1);
    const head = hSeg(0, 2);
    const obstacles = new ObstacleSet();

    expect(item.collide(head, node, 0, makeCollisionSearchContext(obstacles))).toBe(true);
    expect(obstacles.size()).toBe(1);

    const obs = obstacles.first();
    expect(obs?.head).toBe(head);
    expect(obs?.item).toBe(item);
    expect(obs?.clearance).toBe(1000);
    expect(obs?.distFirst).toBe(0);
    expect(obs?.maxFanoutWidth).toBe(0);
  });

  it('the same pair reported twice is one obstacle', () => {
    const node = new TestNode();
    node.clearance = 1000;

    const item = hSeg(0, 1);
    const head = hSeg(0, 2);
    const obstacles = new ObstacleSet();
    const ctx = makeCollisionSearchContext(obstacles);

    item.collide(head, node, 0, ctx);
    item.collide(head, node, 0, ctx);
    expect(obstacles.size()).toBe(1);

    // ... but the reversed pair is a different obstacle.
    head.collide(item, node, 0, ctx);
    expect(obstacles.size()).toBe(2);
  });
});

// ----- lines with vias ----------------------------------------------------------

describe('a head line with a via on the end', () => {
  it('collides through the via even when the line itself is clear', () => {
    const node = new TestNode();
    node.clearance = 10;

    const attached = via({ x: 5000, y: 0 }, 1);
    const shape: Shape = { kind: 'stadium', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, r: 0 };
    const line = onLayer0(new TestLine(0, attached, shape));
    line.setNet(1);

    // A segment far from the line's own body, but sitting on the via.
    const target = onLayer0(new PnsSegment({ a: { x: 5000, y: 0 }, b: { x: 6000, y: 0 } }, 2));

    expect(line.collide(target, node, 0)).toBe(true);
  });

  it('does the same when the line is the item rather than the head', () => {
    const node = new TestNode();
    node.clearance = 10;

    const attached = via({ x: 5000, y: 0 }, 1);
    const shape: Shape = { kind: 'stadium', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, r: 0 };
    const line = onLayer0(new TestLine(0, attached, shape));
    line.setNet(1);

    const target = onLayer0(new PnsSegment({ a: { x: 5000, y: 0 }, b: { x: 6000, y: 0 } }, 2));

    expect(target.collide(line, node, 0)).toBe(true);
  });
});

// ----- holes --------------------------------------------------------------------

describe('holes', () => {
  it('a via’s hole never collides with its own via', () => {
    const node = new TestNode();
    node.clearance = 1000;

    const v = via({ x: 0, y: 0 }, 1);
    const hole = v.hole() as PnsHole;
    hole.setLayers(new PnsLayerRange(0));

    expect(hole.collide(v, node, 0)).toBe(false);
    expect(v.collide(hole, node, 0)).toBe(false);
  });

  it('two geometrically identical vias’ holes are treated as the same hole', () => {
    const node = new TestNode();
    node.clearance = 1000;

    const a = via({ x: 0, y: 0 }, 1);
    const b = via({ x: 0, y: 0 }, 1);
    (a.hole() as PnsHole).setLayers(new PnsLayerRange(0));
    (b.hole() as PnsHole).setLayers(new PnsLayerRange(0));

    expect((a.hole() as PnsHole).collide(b.hole() as PnsHole, node, 0)).toBe(false);
  });

  it('...but a different drill makes them two real holes again', () => {
    const node = new TestNode();
    node.clearance = 1000;

    const a = via({ x: 0, y: 0 }, 1, 600, 300);
    const b = via({ x: 0, y: 0 }, 1, 600, 200);
    (a.hole() as PnsHole).setLayers(new PnsLayerRange(0));
    (b.hole() as PnsHole).setLayers(new PnsLayerRange(0));

    expect((a.hole() as PnsHole).collide(b.hole() as PnsHole, node, 0)).toBe(true);
  });

  it('...and so does a different net, or a different position', () => {
    const node = new TestNode();
    node.clearance = 1000;

    const a = via({ x: 0, y: 0 }, 1);
    const differentNet = via({ x: 0, y: 0 }, 2);
    const movedApart = via({ x: 10, y: 0 }, 1);

    for (const other of [differentNet, movedApart]) {
      (a.hole() as PnsHole).setLayers(new PnsLayerRange(0));
      (other.hole() as PnsHole).setLayers(new PnsLayerRange(0));
      expect((a.hole() as PnsHole).collide(other.hole() as PnsHole, node, 0)).toBe(true);
    }
  });

  it('hole-to-hole collisions ignore nets: two same-net holes still collide', () => {
    const node = new TestNode();
    node.clearance = 0; // so only actual overlap can collide

    const a = via({ x: 0, y: 0 }, 7, 600, 300);
    const b = via({ x: 10, y: 0 }, 7, 600, 200);
    (a.hole() as PnsHole).setLayers(new PnsLayerRange(0));
    (b.hole() as PnsHole).setLayers(new PnsLayerRange(0));

    expect((a.hole() as PnsHole).collide(b.hole() as PnsHole, node, 0)).toBe(true);
  });

  it('the head’s hole is skipped on a same-net item unless a physical rule applies', () => {
    const node = new TestNode();
    node.clearance = 1000;

    const v = via({ x: 0, y: 0 }, 7);
    (v.hole() as PnsHole).setLayers(new PnsLayerRange(0));
    const sameNet = hSeg(0, 7);

    expect(sameNet.collide(v, node, 0)).toBe(false);

    (node.resolver as TestResolver).physical = true;
    expect(sameNet.collide(v, node, 0)).toBe(true);
  });

  it('a missing shape returns false while leaving what the hole already found', () => {
    const node = new TestNode();
    node.clearance = 1000;

    const hole = PnsHole.makeCircularHole({ x: 0, y: 0 }, 100, new PnsLayerRange(0));
    const hollow = onLayer0(new HollowItem(hole));
    hollow.setNet(3);

    const head = hSeg(0, 2);
    const obstacles = new ObstacleSet();

    expect(hollow.collide(head, node, 0, makeCollisionSearchContext(obstacles))).toBe(false);
    expect(obstacles.size()).toBe(1);
    expect(obstacles.first()?.item).toBe(hole);
    expect(obstacles.first()?.head).toBe(head);
  });
});

// ----- castellation and net ties ------------------------------------------------

describe('the location-dependent slow path', () => {
  const atOrigin = (): void => {
    setShapeCollider((a, b, clearance) => {
      const d = a.kind === 'stadium' && b.kind === 'stadium' ? Math.abs(a.a.y - b.a.y) : 0;
      return { collides: d === 0 || d < clearance, actual: d, location: { x: 42, y: 43 } };
    });
  };

  it('throws rather than guess when the collider cannot say where they met', () => {
    const node = new TestNode();
    node.clearance = 1000;
    (node.resolver as TestResolver).nonPlatedSlot = true;

    expect(() => hSeg(0, 1).collide(hSeg(0, 2), node, 0)).toThrow(/collision location/);
  });

  it('is not entered at all when neither castellation nor a net tie applies', () => {
    const node = new TestNode();
    node.clearance = 1000;
    expect(hSeg(0, 1).collide(hSeg(0, 2), node, 0)).toBe(true);
  });

  it('a castellation exclusion at the collision point cancels the collision', () => {
    atOrigin();
    const node = new TestNode();
    node.clearance = 1000;
    (node.resolver as TestResolver).nonPlatedSlot = true;

    node.edgeExcludes = false;
    expect(hSeg(0, 1).collide(hSeg(0, 2), node, 0)).toBe(true);
    expect(node.edgeCalls).toEqual([{ x: 42, y: 43 }]);

    node.edgeExcludes = true;
    expect(hSeg(0, 1).collide(hSeg(0, 2), node, 0)).toBe(false);
  });

  it('a parent board item on Edge.Cuts also puts us on the slow path', () => {
    atOrigin();
    const node = new TestNode();
    node.clearance = 1000;
    node.edgeExcludes = true;

    const item = hSeg(0, 1);
    item.setParent({ layer: 'Edge.Cuts' });
    expect(item.collide(hSeg(0, 2), node, 0)).toBe(false);

    item.setParent({ layer: 'F.Cu' });
    expect(item.collide(hSeg(0, 2), node, 0)).toBe(true);
  });

  it('a net-tie exclusion at the collision point cancels the collision', () => {
    atOrigin();
    const node = new TestNode();
    node.clearance = 1000;
    const resolver = node.resolver as TestResolver;
    resolver.inNetTie = true;

    resolver.netTieExcludes = false;
    expect(hSeg(0, 1).collide(hSeg(0, 2), node, 0)).toBe(true);
    expect(resolver.netTieCalls).toEqual([{ x: 42, y: 43 }]);

    resolver.netTieExcludes = true;
    expect(hSeg(0, 1).collide(hSeg(0, 2), node, 0)).toBe(false);
  });
});
