// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PNS_PCBNEW_RULE_RESOLVER` over the live DRC_ENGINE.
 * Counterpart: `pcbnew/router/pns_kicad_iface.cpp:863-979` (`Clearance`),
 * `:535-787` (`QueryConstraint`), `:790-860` (the caches).
 *
 * - **`rv` only climbs**, and is the worst case across the overlapping layers.
 * - **Hole-to-hole and hole clearance are an `if/else if`; copper clearance is
 *   not in the chain.** A plated hole collects both.
 * - **Physical clearances are outside the net-aware block**, so a
 *   `physical_clearance` rule reaches a same-net pair.
 * - **The epsilon is subtracted only from a strictly positive value.**
 * - **Three caches on three schedules.**
 *
 * Every number comes through `DRC_ENGINE::EvalRules` on a real board, so the
 * board's own implicit rules (the Default netclass clearance) apply too.
 */
import { describe, expect, it, vi } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import {
  defaultShapeCollider,
  getShapeCollider,
} from '@ziroeda/kimath/src/geometry/shape_collisions.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { DRC_ENGINE } from '@ziroeda/pcbnew/drc/drc_engine.js';
import type { NETINFO_ITEM } from '@ziroeda/pcbnew/netinfo_item.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import {
  PNS_KICAD_IFACE,
  PNS_PCBNEW_RULE_RESOLVER,
} from '@ziroeda/pcbnew/router/pns_kicad_iface.js';
import { PnsHole } from '@ziroeda/pcbnew/router/pns_hole.js';
import type { PnsBoardItem, PnsItem } from '@ziroeda/pcbnew/router/pns_item.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/router/pns_layerset.js';
import { PnsConstraintType } from '@ziroeda/pcbnew/router/pns_node.js';
import { PnsSegment } from '@ziroeda/pcbnew/router/pns_segment.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);
const V = (x: number, y: number): Vec2 => ({ x: MM(x), y: MM(y) });

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (net 0 "") (net 1 "A") (net 2 "B")
  (gr_line (start 0 50) (end 50 50) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts")
    (uuid "00000000-0000-4000-8000-000000000001"))
  (footprint "T" (layer "F.Cu") (at 0 0) (uuid "00000000-0000-4000-8000-000000000002")
    (pad "1" thru_hole circle (at 0 0) (size 1 1) (drill 0.5) (layers "*.Cu") (net 1 "A")
      (uuid "00000000-0000-4000-8000-000000000003"))
    (pad "2" thru_hole circle (at 10 0) (size 1 1) (drill 0.5) (layers "*.Cu") (net 2 "B")
      (uuid "00000000-0000-4000-8000-000000000004"))))`;

interface Fixture {
  board: BOARD;
  resolver: PNS_PCBNEW_RULE_RESOLVER;
  engine: DRC_ENGINE;
  A: NETINFO_ITEM;
  B: NETINFO_ITEM;
  eps: number;
  /** The Default netclass clearance the engine applies to every copper pair. */
  netclass: number;
}

/** A board, its engine loaded with `aRules` (a .kicad_dru body), and a resolver on it. */
function resolverWith(aRules: string): Fixture {
  const board = ParseBoard(BOARD_TEXT, 'r.kicad_pcb');
  board.BuildListOfNets();
  board.BuildConnectivity();

  const engine = new DRC_ENGINE(board, board.GetDesignSettings());
  engine.InitEngine(`(version 1)\n${aRules}`, 'r.kicad_dru');
  board.GetDesignSettings().m_DRCEngine = engine;

  const iface = new PNS_KICAD_IFACE(board);
  const resolver = new PNS_PCBNEW_RULE_RESOLVER(board, iface);

  return {
    board,
    resolver,
    engine,
    A: board.FindNet('A')!,
    B: board.FindNet('B')!,
    eps: board.GetDesignSettings().GetDRCEpsilon(),
    netclass: board.GetDesignSettings().m_NetSettings.GetDefaultNetclass().GetClearance(),
  };
}

const rule = (aName: string, aType: string, aMinMM: number): string =>
  `(rule "${aName}" (constraint ${aType} (min ${aMinMM}mm)))`;

function seg(a: Vec2, b: Vec2, net: NETINFO_ITEM | null, layer = 0): PnsSegment {
  const s = new PnsSegment({ seg: { a, b }, width: MM(0.1) }, net);
  s.setLayers(new PnsLayerRange(layer));
  return s;
}

function hole(at: Vec2, net: NETINFO_ITEM | null, parent: object | null = null): PnsHole {
  const h = new PnsHole({ kind: 'circle', c: at, r: MM(0.25) });
  h.setNet(net);
  h.setLayers(new PnsLayerRange(0, 1));
  if (parent) h.setParent(parent as unknown as PnsBoardItem);
  return h;
}

/** `bothOwned` needs an owner on each side; any object will do. */
function own<T extends PnsItem>(aItem: T): T {
  aItem.setOwner({});
  return aItem;
}

const pads = (f: Fixture) => f.board.Footprints()[0]!.Pads();

// ---------------------------------------------------------------------------------
describe('PNS_PCBNEW_RULE_RESOLVER: clearance', () => {
  it('reads the clearance out of the rule set, less the epsilon', () => {
    const f = resolverWith(rule('wide', 'clearance', 1));

    expect(f.resolver.clearance(seg(V(0, 0), V(1, 0), f.A), seg(V(0, 5), V(1, 5), f.B))).toBe(
      MM(1) - f.eps,
    );
    expect(
      f.resolver.clearance(seg(V(0, 0), V(1, 0), f.A), seg(V(0, 5), V(1, 5), f.B), false),
    ).toBe(MM(1));
  });

  it('takes the largest of every constraint that applies, not the last', () => {
    const f = resolverWith(
      `${rule('wide', 'clearance', 1)}\n${rule('phys', 'physical_clearance', 2)}`,
    );

    expect(
      f.resolver.clearance(seg(V(0, 0), V(1, 0), f.A), seg(V(0, 5), V(1, 5), f.B), false),
    ).toBe(MM(2));
  });

  it('gives a same-net pair no clearance at all', () => {
    const f = resolverWith(rule('wide', 'clearance', 1));

    // -1 is `collideSimple`'s "do not even test", not a zero clearance.
    expect(f.resolver.clearance(seg(V(0, 0), V(1, 0), f.A), seg(V(0, 5), V(1, 5), f.A))).toBe(-1);
  });

  it('lets a physical_clearance rule reach across a same-net pair', () => {
    const f = resolverWith(
      `${rule('wide', 'clearance', 1)}\n${rule('phys', 'physical_clearance', 2)}`,
    );

    expect(
      f.resolver.clearance(seg(V(0, 0), V(1, 0), f.A), seg(V(0, 5), V(1, 5), f.A), false),
    ).toBe(MM(2));
  });

  const HOLE_RULES = [rule('h2h', 'hole_to_hole', 3), rule('hc', 'hole_clearance', 2)].join('\n');

  it('asks hole-to-hole for two drilled holes (IsDrilledHole reads the parent pad)', () => {
    const f = resolverWith(HOLE_RULES);
    const [p1, p2] = pads(f);
    const a = hole(V(0, 0), f.A, p1);
    const b = hole(V(10, 0), f.B, p2);

    expect(f.resolver.isDrilledHole(a)).toBe(true);
    expect(f.resolver.clearance(a, b, false)).toBe(MM(3));
  });

  it('is not a drilled hole when the parent has no drilled hole', () => {
    const f = resolverWith(HOLE_RULES);
    const smd = f.board.Footprints()[0]!.Pads()[0]!;
    smd.SetDrillSize({ x: 0, y: 0 });

    expect(f.resolver.isDrilledHole(hole(V(0, 0), f.A, smd))).toBe(false);
  });

  it('asks hole clearance when only one side is drilled', () => {
    const f = resolverWith(HOLE_RULES);
    const a = hole(V(0, 0), f.A, pads(f)[0]);
    const b = hole(V(10, 0), f.B);

    expect(f.resolver.isDrilledHole(b)).toBe(false);
    expect(f.resolver.clearance(a, b, false)).toBe(MM(2));
  });

  it('folds copper clearance in for holes too — there is no `else` in front of it', () => {
    const f = resolverWith(`${rule('h2h', 'hole_to_hole', 0.3)}\n${rule('cl', 'clearance', 4)}`);
    const [p1, p2] = pads(f);

    expect(f.resolver.clearance(hole(V(0, 0), f.A, p1), hole(V(10, 0), f.B, p2), false)).toBe(
      MM(4),
    );
  });

  it('never goes below zero when the epsilon exceeds the clearance', () => {
    const f = resolverWith(rule('tiny', 'clearance', 0.0001));
    const ds = f.board.GetDesignSettings();
    ds.m_NetSettings.GetDefaultNetclass().SetClearance(0);

    const r = new PNS_PCBNEW_RULE_RESOLVER(f.board, new PNS_KICAD_IFACE(f.board));
    expect(MM(0.0001)).toBeLessThan(f.eps);
    expect(r.clearance(seg(V(0, 0), V(1, 0), f.A), seg(V(0, 5), V(1, 5), f.B))).toBe(0);
  });

  it('takes the *other* item’s layers when one side is a board edge (isEdge)', () => {
    const f = resolverWith(rule('edge', 'edge_clearance', 3));
    const edgeShape = f.board.Drawings()[0]!;
    const edge = seg(V(0, 50), V(50, 50), null, 0);
    edge.setLayers(new PnsLayerRange(0, 1));
    edge.setParent(edgeShape as unknown as PnsBoardItem);
    const track = seg(V(0, 40), V(50, 40), f.A, 1);

    expect(f.resolver.clearance(edge, track, false)).toBe(MM(3));
  });

  it('applies the Default netclass clearance when no custom rule matches', () => {
    const f = resolverWith('');

    expect(f.netclass).toBeGreaterThan(0);
    expect(
      f.resolver.clearance(seg(V(0, 0), V(1, 0), f.A), seg(V(0, 5), V(1, 5), f.B), false),
    ).toBe(f.netclass);
  });

  it('treats an ignored rule as -1', () => {
    const f = resolverWith('(rule "off" (severity ignore) (constraint clearance (min 9mm)))');

    const c = f.resolver.queryConstraint(
      PnsConstraintType.CT_CLEARANCE,
      seg(V(0, 0), V(1, 0), f.A),
      seg(V(0, 5), V(1, 5), f.B),
      0,
    );

    expect(c?.value.min).toBe(-1);
    // `DRC_CONSTRAINT::GetName()` is `rule '%s'`.
    expect(c?.ruleName).toBe("rule 'off'");
  });

  it('answers nothing for a constraint type it has no mapping for', () => {
    const f = resolverWith(rule('wide', 'clearance', 1));

    expect(
      f.resolver.queryConstraint(
        99 as PnsConstraintType,
        seg(V(0, 0), V(1, 0), f.A),
        seg(V(0, 5), V(1, 5), f.B),
        0,
      ),
    ).toBeNull();
  });

  it('evaluates an item with no board item through a dummy track on the item’s net', () => {
    const f = resolverWith(
      `(rule "netA" (condition "A.NetName == 'A'") (constraint clearance (min 5mm)))`,
    );

    expect(
      f.resolver.clearance(seg(V(0, 0), V(1, 0), f.A), seg(V(0, 5), V(1, 5), f.B), false),
    ).toBe(MM(5));
    // Clearance rules are tried both ways round, so B against A matches too;
    // against an unconnected item (the orphaned net) the rule does not apply.
    expect(
      f.resolver.clearance(seg(V(0, 0), V(1, 0), f.B), seg(V(0, 5), V(1, 5), f.A), false),
    ).toBe(MM(5));
    expect(
      f.resolver.clearance(seg(V(0, 0), V(1, 0), f.B), seg(V(0, 5), V(1, 5), null), false),
    ).toBe(f.netclass);
  });
});

// ---------------------------------------------------------------------------------
describe('PNS_PCBNEW_RULE_RESOLVER: nets and diff pairs', () => {
  it('reads codes and names off the NETINFO_ITEM', () => {
    const f = resolverWith('');

    expect(f.resolver.netCode(f.A)).toBe(1);
    expect(f.resolver.netName(f.B)).toBe('B');
    expect(f.resolver.netCode(null)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------------
describe('PNS_PCBNEW_RULE_RESOLVER: the caches', () => {
  const evalCount = (f: Fixture) => vi.spyOn(f.engine, 'EvalRules');

  it('caches by identity when both items are owned, and is symmetric', () => {
    const f = resolverWith(rule('wide', 'clearance', 1));
    const spy = evalCount(f);
    const a = own(seg(V(0, 0), V(1, 0), f.A));
    const b = own(seg(V(0, 5), V(1, 5), f.B));

    f.resolver.clearance(a, b);
    const after = spy.mock.calls.length;
    expect(after).toBeGreaterThan(0);

    f.resolver.clearance(a, b);
    f.resolver.clearance(b, a);
    expect(spy.mock.calls.length).toBe(after);
  });

  it('caches unowned items by their properties, so two clones share an entry', () => {
    const f = resolverWith(rule('wide', 'clearance', 1));
    const spy = evalCount(f);

    f.resolver.clearance(seg(V(0, 0), V(1, 0), f.A), seg(V(0, 5), V(1, 5), f.B));
    const after = spy.mock.calls.length;

    f.resolver.clearance(seg(V(0, 0), V(2, 0), f.A), seg(V(0, 9), V(2, 9), f.B));
    expect(spy.mock.calls.length).toBe(after);
  });

  it('keeps the two clearance caches separate', () => {
    const f = resolverWith(rule('wide', 'clearance', 1));
    const spy = evalCount(f);
    const ownedA = own(seg(V(0, 0), V(1, 0), f.A));
    const ownedB = own(seg(V(0, 5), V(1, 5), f.B));
    const tempA = seg(V(0, 0), V(1, 0), f.A);
    const tempB = seg(V(0, 5), V(1, 5), f.B);

    f.resolver.clearance(ownedA, ownedB);
    f.resolver.clearance(tempA, tempB);
    const after = spy.mock.calls.length;

    // Only the property-keyed one is dropped, so the owned pair still hits.
    f.resolver.clearTemporaryCaches();
    f.resolver.clearance(ownedA, ownedB);
    expect(spy.mock.calls.length).toBe(after);

    f.resolver.clearance(tempA, tempB);
    expect(spy.mock.calls.length).toBeGreaterThan(after);
  });

  it('drops an identity entry when either side is named dirty', () => {
    const f = resolverWith(rule('wide', 'clearance', 1));
    const spy = evalCount(f);
    const a = own(seg(V(0, 0), V(1, 0), f.A));
    const b = own(seg(V(0, 5), V(1, 5), f.B));

    f.resolver.clearance(a, b);
    const after = spy.mock.calls.length;

    f.resolver.clearCacheForItems([b]);
    f.resolver.clearance(a, b);
    expect(spy.mock.calls.length).toBeGreaterThan(after);
  });

  it('does nothing at all for an empty dirty list', () => {
    const f = resolverWith(rule('wide', 'clearance', 1));
    const spy = evalCount(f);
    const a = own(seg(V(0, 0), V(1, 0), f.A));
    const b = own(seg(V(0, 5), V(1, 5), f.B));

    f.resolver.clearance(a, b);
    const after = spy.mock.calls.length;

    f.resolver.clearCacheForItems([]);
    f.resolver.clearance(a, b);
    expect(spy.mock.calls.length).toBe(after);
  });

  it('memoises hulls per (item, clearance, thickness, layer) and evicts them by item', () => {
    const f = resolverWith('');
    const s = seg(V(0, 0), V(1, 0), f.A);

    const first = f.resolver.hullCache(s, 100, 0, 0);
    expect(f.resolver.hullCache(s, 100, 0, 0)).toBe(first);
    expect(f.resolver.hullCache(s, 200, 0, 0)).not.toBe(first);

    f.resolver.clearCacheForItems([s]);
    expect(f.resolver.hullCache(s, 100, 0, 0)).not.toBe(first);
  });

  it('does NOT install a shape collider as a side effect of being constructed', () => {
    const before = getShapeCollider();
    const f = resolverWith(rule('wide', 'clearance', 1));

    f.resolver.clearance(seg(V(0, 0), V(1, 0), f.A), seg(V(0, 5), V(1, 5), f.B));

    expect(getShapeCollider()).toBe(before);
    expect(getShapeCollider()).toBe(defaultShapeCollider);
  });

  it('memoises HasUserDefinedPhysicalConstraint until clearCaches', () => {
    // Only a rule WITH a condition counts (drc_engine.cpp:2412).
    const f = resolverWith(
      `(rule "phys" (condition "A.NetName == 'A'") (constraint physical_clearance (min 2mm)))`,
    );
    const spy = vi.spyOn(f.engine, 'HasUserDefinedPhysicalConstraint');

    expect(f.resolver.hasUserDefinedPhysicalConstraint()).toBe(true);
    f.resolver.hasUserDefinedPhysicalConstraint();
    expect(spy).toHaveBeenCalledTimes(1);

    f.resolver.clearCaches();
    f.resolver.hasUserDefinedPhysicalConstraint();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
