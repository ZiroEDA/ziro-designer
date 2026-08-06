// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ITEM::collideSimple`'s location-dependent slow path, driven by the real
 * `SHAPE::Collide` rather than by a stand-in.
 * Counterparts: `pcbnew/router/pns_item.cpp` and
 * `libs/kimath/src/geometry/shape_collisions.cpp`.
 *
 * The item model shipped with a collider that reproduced the *verdict* exactly
 * and reported `location: null`, and `collideSimple` threw rather than guess
 * when a rule resolver asked a question that depends on where two shapes met.
 * These tests are the two halves of closing that: the throw is still there for a
 * collider that cannot say, and it is gone — with the location KiCad would have
 * reported — for one that can.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  setRouterIface,
  setShapeCollider,
  type CollisionNode,
  type KeepoutResult,
  type NetHandle,
  type PnsConstraint,
  type PnsRuleResolver,
} from '@ziroeda/pcbnew/src/router/pns_collision.js';
import { installLocatingShapeCollider } from '@ziroeda/pcbnew/src/router/pns_shape_collider.js';
import type { PnsItem } from '@ziroeda/pcbnew/src/router/pns_item.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsVia } from '@ziroeda/pcbnew/src/router/pns_via.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

// ----- stubs -------------------------------------------------------------------

class TestResolver implements PnsRuleResolver {
  nonPlatedSlot = false;
  inNetTie = false;
  netTieExcludes = false;
  netTieCalls: Vec2[] = [];

  clearance(): number {
    return 0;
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

  isNetTieExclusion(_item: PnsItem, aPos: Vec2): boolean {
    this.netTieCalls.push(aPos);
    return this.netTieExcludes;
  }

  isDrilledHole(): boolean {
    return false;
  }

  isNonPlatedSlot(): boolean {
    return this.nonPlatedSlot;
  }

  isKeepout(): KeepoutResult {
    return { keepout: false, enforce: false };
  }

  queryConstraint(): PnsConstraint | null {
    return null;
  }
}

class TestNode implements CollisionNode {
  resolver = new TestResolver();
  clearance = 0;
  edgeExcludes = false;
  edgeCalls: Vec2[] = [];

  getRuleResolver(): PnsRuleResolver {
    return this.resolver;
  }

  getClearance(): number {
    return this.clearance;
  }

  queryEdgeExclusions(aPos: Vec2): boolean {
    this.edgeCalls.push(aPos);
    return this.edgeExcludes;
  }
}

const onLayer0 = <T extends PnsItem>(aItem: T): T => {
  aItem.setLayers(new PnsLayerRange(0));
  return aItem;
};

/** A horizontal zero-width segment at height `y`, running from x = 0 to x = 1000. */
const hSeg = (aY: number, aNet: NetHandle): PnsSegment =>
  onLayer0(new PnsSegment({ seg: { a: { x: 0, y: aY }, b: { x: 1000, y: aY } }, width: 0 }, aNet));

afterEach(() => {
  setRouterIface(null);
  setShapeCollider(null);
});

// ----- the two halves ----------------------------------------------------------

describe('the castellation and net-tie path', () => {
  it('still throws under the default collider, which cannot say where', () => {
    const node = new TestNode();
    node.clearance = 10;
    node.resolver.nonPlatedSlot = true;

    expect(() => hSeg(0, 1).collide(hSeg(8, 2), node, 0)).toThrow(/collision location/);
  });

  it('works once a location-capable collider is installed', () => {
    installLocatingShapeCollider();

    const node = new TestNode();
    node.clearance = 10;
    node.resolver.nonPlatedSlot = true;

    // Effective clearance is 10 - 1 = 9, and the two centrelines are 8 apart.
    expect(hSeg(0, 1).collide(hSeg(8, 2), node, 0)).toBe(true);
    expect(node.edgeCalls).toHaveLength(1);

    // `a.collide( b )` makes *b* the head, and `collideSimple` calls the
    // collider head-first — so the location is a point on `hSeg( 8 )`, not on
    // the item that was asked. All four of `SEG::NearestPoint`'s candidates are
    // 8 away here, so the strict `<` keeps the first: the head's `A` endpoint.
    expect(node.edgeCalls[0]).toEqual({ x: 0, y: 8 });
  });

  it('cancels the collision when the exclusion is at that point', () => {
    installLocatingShapeCollider();

    const node = new TestNode();
    node.clearance = 10;
    node.resolver.nonPlatedSlot = true;
    node.edgeExcludes = true;

    expect(hSeg(0, 1).collide(hSeg(8, 2), node, 0)).toBe(false);
  });

  it('hands a net-tie resolver the same point', () => {
    installLocatingShapeCollider();

    const node = new TestNode();
    node.clearance = 10;
    node.resolver.inNetTie = true;

    expect(hSeg(0, 1).collide(hSeg(8, 2), node, 0)).toBe(true);
    expect(node.resolver.netTieCalls).toEqual([{ x: 0, y: 8 }]);
  });

  it('reports a via collision at the midpoint of the two centres', () => {
    // A via is a `SHAPE_CIRCLE`, and two of those report the midpoint of their
    // centres — a point 150 from each, well outside both 300-diameter pads.
    installLocatingShapeCollider();

    const node = new TestNode();
    node.clearance = 200;
    node.resolver.inNetTie = true;

    const head = onLayer0(new PnsVia({ x: 0, y: 0 }, new PnsLayerRange(0), 300, 100, 1));
    const item = onLayer0(new PnsVia({ x: 300, y: 0 }, new PnsLayerRange(0), 300, 100, 2));

    expect(item.collide(head, node, 0)).toBe(true);
    expect(node.resolver.netTieCalls).toContainEqual({ x: 150, y: 0 });
  });
});
