// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The concrete router items a node stores: segment, arc, via, virtual via,
 * solid and hole.
 * Counterparts: `pns_segment.h`, `pns_arc.h/.cpp`, `pns_via.h/.cpp`,
 * `pns_solid.h/.cpp`, `pns_hole.h/.cpp`.
 *
 * The asymmetries below are the ones that would otherwise be smoothed over by a
 * reasonable person reading the port, so each has a test whose only purpose is
 * to fail when someone does:
 *
 * - **A half width is truncated, everywhere.** Upstream halves widths with
 *   integer division in every collision and every bounding box, so a 3-unit
 *   track has a 1-unit radius and not 1.5. The difference shows up as a
 *   clearance that is a nanometre wrong in exactly the direction that lets a
 *   violation through.
 * - **`SEGMENT::Clone` keeps the unique id; `ARC::Clone` does not.** One
 *   copy-constructs, the other assigns seven named fields and the uid is not
 *   among them.
 * - **`SOLID`'s copy constructor does not copy the offset.** Eight members are
 *   listed and that is not one of them.
 * - **`VIA::padstackMatches` is asymmetric.** Upstream's `std::equal` walks only
 *   the *left* via's slot list, so a plain via can match a custom-stack one in
 *   one direction and not the other.
 * - **`effectiveLayer` is the whole padstack mechanism.** Shapes are keyed by
 *   padstack slot, not by board layer, and a normal via keeps everything under
 *   slot 0 — including the answer to `shape(-1)`.
 */
import { describe, expect, it } from 'vitest';
import { LineMarker, PnsKind } from '@ziroeda/pcbnew/src/router/pns_item.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsArc } from '@ziroeda/pcbnew/src/router/pns_arc.js';
import { PnsHole } from '@ziroeda/pcbnew/src/router/pns_hole.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsVia, PnsVVia, ViaStackMode } from '@ziroeda/pcbnew/src/router/pns_via.js';

// ----- SEGMENT ------------------------------------------------------------------

describe('PnsSegment', () => {
  const make = (width = 100): PnsSegment =>
    new PnsSegment({ seg: { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } }, width }, 7);

  it('is a stadium of half its width, truncated', () => {
    expect(make(100).shape(-1)).toEqual({
      kind: 'stadium',
      a: { x: 0, y: 0 },
      b: { x: 1000, y: 0 },
      r: 50,
    });

    const odd = make(3).shape(-1);
    expect(odd?.kind === 'stadium' ? odd.r : null).toBe(1); // not 1.5
  });

  it('the bare-segment constructor gives zero width, and a bare one is empty', () => {
    const s = new PnsSegment({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, 3);
    expect(s.width()).toBe(0);
    expect(s.net()).toBe(3);

    const empty = new PnsSegment();
    expect(empty.net()).toBeNull();
    expect(empty.seg()).toEqual({ a: { x: 0, y: 0 }, b: { x: 0, y: 0 } });
  });

  it('copies its geometry in, so later edits to the source do not reach it', () => {
    const source = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
    const s = new PnsSegment(source, 1);
    source.b.x = 999;
    expect(s.seg().b.x).toBe(10);
  });

  it('anchor 0 is A and anything else is B', () => {
    const s = make();
    expect(s.anchorCount()).toBe(2);
    expect(s.anchor(0)).toEqual({ x: 0, y: 0 });
    expect(s.anchor(1)).toEqual({ x: 1000, y: 0 });
    expect(s.anchor(7)).toEqual({ x: 1000, y: 0 });
  });

  it('setEnds and swapEnds move the geometry without touching the width', () => {
    const s = make(120);
    s.setEnds({ x: 1, y: 2 }, { x: 3, y: 4 });
    expect(s.seg()).toEqual({ a: { x: 1, y: 2 }, b: { x: 3, y: 4 } });

    s.swapEnds();
    expect(s.seg()).toEqual({ a: { x: 3, y: 4 }, b: { x: 1, y: 2 } });
    expect(s.width()).toBe(120);
  });

  it('cLine is the two-point chain', () => {
    expect(make().cLine()).toEqual([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ]);
  });

  it('clone keeps the unique id, the state, and belongs to nobody', () => {
    const s = make(80);
    s.setLayers(new PnsLayerRange(0, 3));
    s.mark(LineMarker.MK_HEAD);
    s.setRank(4);
    s.setOwner({});

    const c = s.clone();
    expect(c.uid()).toBe(s.uid());
    expect(c.width()).toBe(80);
    expect(c.seg()).toEqual(s.seg());
    expect([c.layers().start(), c.layers().end()]).toEqual([0, 3]);
    expect(c.marker()).toBe(LineMarker.MK_HEAD);
    expect(c.rank()).toBe(4);
    expect(c.owner()).toBeNull();

    c.setEnds({ x: 5, y: 5 }, { x: 6, y: 6 });
    expect(s.seg().a).toEqual({ x: 0, y: 0 });
  });

  it('classOf is the kind test', () => {
    expect(PnsSegment.classOf(make())).toBe(true);
    expect(PnsSegment.classOf(null)).toBe(false);
    expect(PnsSegment.classOf(new PnsSolid())).toBe(false);
  });
});

// ----- ARC ----------------------------------------------------------------------

describe('PnsArc', () => {
  const make = (width = 100): PnsArc =>
    new PnsArc({ p0: { x: -100, y: 0 }, arcMid: { x: 0, y: 100 }, p1: { x: 100, y: 0 }, width }, 7);

  it('is a stroked arc through its three points, with a truncated half width', () => {
    const s = make(100).shape(-1);
    expect(s?.kind).toBe('arc');

    if (s?.kind === 'arc') {
      expect(s.r).toBe(50);
      expect(s.c.x).toBeCloseTo(0, 6);
      expect(s.c.y).toBeCloseTo(0, 6);
      expect(s.rad).toBeCloseTo(100, 6);
    }

    const odd = make(3).shape(-1);
    expect(odd?.kind === 'arc' ? odd.r : null).toBe(1); // not 1.5
  });

  it('anchor 0 is the start and anything else is the end', () => {
    const a = make();
    expect(a.anchorCount()).toBe(2);
    expect(a.anchor(0)).toEqual({ x: -100, y: 0 });
    expect(a.anchor(1)).toEqual({ x: 100, y: 0 });
    expect(a.anchor(9)).toEqual({ x: 100, y: 0 });
  });

  it('clone does NOT keep the unique id, unlike a segment', () => {
    const a = make();
    a.setLayers(new PnsLayerRange(0, 3));
    a.mark(LineMarker.MK_HEAD);
    a.setRank(2);

    const c = a.clone();
    expect(c.uid()).not.toBe(a.uid());
    expect(c.net()).toBe(7);
    expect([c.layers().start(), c.layers().end()]).toEqual([0, 3]);
    expect(c.marker()).toBe(LineMarker.MK_HEAD);
    expect(c.rank()).toBe(2);
    expect(c.cArc()).toEqual(a.cArc());
  });

  it('fromParentArc carries the parent’s net, layers, marker and rank', () => {
    const parent = make();
    parent.setLayers(new PnsLayerRange(1, 2));
    parent.mark(LineMarker.MK_VIOLATION);
    parent.setRank(6);

    const child = PnsArc.fromParentArc(parent, {
      p0: { x: 0, y: 0 },
      arcMid: { x: 5, y: 5 },
      p1: { x: 10, y: 0 },
      width: 20,
    });

    expect(child.net()).toBe(7);
    expect([child.layers().start(), child.layers().end()]).toEqual([1, 2]);
    expect(child.marker()).toBe(LineMarker.MK_VIOLATION);
    expect(child.rank()).toBe(6);
    expect(child.width()).toBe(20);
  });

  it('setWidth leaves the three points alone', () => {
    const a = make(100);
    a.setWidth(40);
    expect(a.width()).toBe(40);
    expect(a.cArc().p0).toEqual({ x: -100, y: 0 });
  });

  it('classOf is the kind test', () => {
    expect(PnsArc.classOf(make())).toBe(true);
    expect(PnsArc.classOf(new PnsSegment())).toBe(false);
  });
});

// ----- VIA ----------------------------------------------------------------------

describe('PnsVia.effectiveLayer', () => {
  const through = (): PnsVia => new PnsVia({ x: 0, y: 0 }, new PnsLayerRange(0, 31), 600, 300, 1);

  it('funnels everything into slot 0 for a normal via, including layer -1', () => {
    const v = through();
    expect(v.effectiveLayer(-1)).toBe(0);
    expect(v.effectiveLayer(0)).toBe(0);
    expect(v.effectiveLayer(17)).toBe(0);
    expect(v.uniqueShapeLayers()).toEqual([0]);
  });

  it('keeps the two ends and folds everything between them into one inner slot', () => {
    const v = through();
    v.setStackMode(ViaStackMode.FRONT_INNER_BACK);

    expect(v.effectiveLayer(0)).toBe(0);
    expect(v.effectiveLayer(31)).toBe(31);
    expect(v.effectiveLayer(5)).toBe(1);
    expect(v.effectiveLayer(-1)).toBe(1);
    expect(v.uniqueShapeLayers()).toEqual([0, 1, 31]);
  });

  it('falls back to the start layer when there is no room for an inner slot', () => {
    const v = new PnsVia({ x: 0, y: 0 }, new PnsLayerRange(0, 1), 600, 300, 1);
    v.setStackMode(ViaStackMode.FRONT_INNER_BACK);

    expect(v.effectiveLayer(0)).toBe(0);
    expect(v.effectiveLayer(1)).toBe(1);
    expect(v.effectiveLayer(5)).toBe(0); // no inner layer exists
  });

  it('a custom stack keys by layer, and answers a layer it does not span with its start', () => {
    const v = new PnsVia({ x: 0, y: 0 }, new PnsLayerRange(2, 5), 600, 300, 1);
    v.setStackMode(ViaStackMode.CUSTOM);

    expect(v.effectiveLayer(3)).toBe(3);
    expect(v.effectiveLayer(9)).toBe(2);
    expect(v.effectiveLayer(-1)).toBe(2);
    expect(v.uniqueShapeLayers()).toEqual([2, 3, 4, 5]);
  });

  it('reports that it varies by layer, which is what drives relevantShapeLayers', () => {
    expect(through().hasUniqueShapeLayers()).toBe(true);
  });
});

describe('PnsVia geometry', () => {
  const through = (): PnsVia => new PnsVia({ x: 10, y: 20 }, new PnsLayerRange(0, 31), 600, 300, 1);

  it('is a circle of half its diameter, on any layer', () => {
    const v = through();
    expect(v.shape(-1)).toEqual({ kind: 'circle', c: { x: 10, y: 20 }, r: 300 });
    expect(v.shape(17)).toEqual({ kind: 'circle', c: { x: 10, y: 20 }, r: 300 });
  });

  it('a default-constructed via has dummy sizes and no shape at all', () => {
    const v = new PnsVia();
    expect(v.drill()).toBe(1);
    expect(v.diameter(-1)).toBe(2);
    expect(v.shape(-1)).toBeNull();
  });

  it('setDiameter creates the slot’s shape and then resizes it', () => {
    const v = new PnsVia();
    v.setDiameter(-1, 800);
    expect(v.shape(-1)).toEqual({ kind: 'circle', c: { x: 0, y: 0 }, r: 400 });

    v.setDiameter(-1, 900);
    expect(v.shape(-1)).toEqual({ kind: 'circle', c: { x: 0, y: 0 }, r: 450 });
    expect(v.diameter(-1)).toBe(900);
  });

  it('an absent slot falls back to the first diameter stored', () => {
    const v = new PnsVia({ x: 0, y: 0 }, new PnsLayerRange(0, 3), 600, 300, 1);
    v.setStackMode(ViaStackMode.CUSTOM);
    // Only slot 0 was ever filled, but layer 2 maps to slot 2.
    expect(v.effectiveLayer(2)).toBe(2);
    expect(v.diameter(2)).toBe(600);
  });

  it('setPos moves the shapes and the hole together', () => {
    const v = through();
    v.setPos({ x: 100, y: 200 });

    expect(v.shape(-1)).toEqual({ kind: 'circle', c: { x: 100, y: 200 }, r: 300 });
    expect(v.hole()?.shape(-1)).toEqual({ kind: 'circle', c: { x: 100, y: 200 }, r: 150 });
  });

  it('setDrill resizes the hole, halving with truncation', () => {
    const v = through();
    v.setDrill(301);
    expect(v.drill()).toBe(301);
    expect(v.hole()?.radius()).toBe(150);
  });

  it('setHoleLayers reaches through to the hole', () => {
    const v = through();
    v.setHoleLayers(new PnsLayerRange(0, 3));
    expect([v.holeLayers().start(), v.holeLayers().end()]).toEqual([0, 3]);
    expect([v.hole()?.layers().start(), v.hole()?.layers().end()]).toEqual([0, 3]);
  });

  it('owns its hole and is its parent pad', () => {
    const v = through();
    expect(v.hasHole()).toBe(true);
    expect(v.hole()?.owner()).toBe(v);
    expect(v.hole()?.parentPadVia()).toBe(v);
  });

  it('makeHandle carries position, layers and net', () => {
    const h = through().makeHandle();
    expect(h.valid).toBe(true);
    expect(h.pos).toEqual({ x: 10, y: 20 });
    expect([h.layers.start(), h.layers.end()]).toEqual([0, 31]);
    expect(h.net).toBe(1);
  });

  it('has a single anchor, its centre, whatever index is asked for', () => {
    const v = through();
    expect(v.anchorCount()).toBe(1);
    expect(v.anchor(0)).toEqual({ x: 10, y: 20 });
    expect(v.anchor(5)).toEqual({ x: 10, y: 20 });
  });

  it('connectsLayer is the layer span, unless the mode says ends only', () => {
    const v = through();
    expect(v.connectsLayer(17)).toBe(true);

    v.setUnconnectedLayerMode('start_end_only');
    expect(v.connectsLayer(17)).toBe(false);
    expect(v.connectsLayer(0)).toBe(true);
    expect(v.connectsLayer(31)).toBe(true);
  });

  it('clone keeps the uid and rebuilds a fresh circular hole from the drill', () => {
    const v = through();
    v.setRank(3);
    v.mark(LineMarker.MK_HEAD);

    const c = v.clone();
    expect(c.uid()).toBe(v.uid());
    expect(c.pos()).toEqual({ x: 10, y: 20 });
    expect(c.drill()).toBe(300);
    expect(c.rank()).toBe(3);
    expect(c.marker()).toBe(LineMarker.MK_HEAD);
    expect(c.shape(-1)).toEqual({ kind: 'circle', c: { x: 10, y: 20 }, r: 300 });

    expect(c.hole()).not.toBe(v.hole());
    expect(c.hole()?.radius()).toBe(150);
    expect(c.hole()?.parentPadVia()).toBe(c);
  });
});

describe('PnsVia.padstackMatches', () => {
  const normal = (diameter: number): PnsVia =>
    new PnsVia({ x: 0, y: 0 }, new PnsLayerRange(0, 3), diameter, 300, 1);

  it('two plain vias of the same size match', () => {
    expect(normal(600).padstackMatches(normal(600))).toBe(true);
  });

  it('two plain vias of different sizes do not', () => {
    expect(normal(600).padstackMatches(normal(800))).toBe(false);
  });

  it('is asymmetric across stack modes, because upstream walks only the left list', () => {
    const plain = normal(600);
    const custom = normal(600);
    custom.setStackMode(ViaStackMode.CUSTOM); // slots 0,1,2,3

    // Left is the plain one: its single slot 0 matches the custom via's first,
    // and slot 0's diameter is the same on both.
    expect(plain.padstackMatches(custom)).toBe(true);

    // Left is the custom one: four slots against one is not a match.
    expect(custom.padstackMatches(plain)).toBe(false);
  });
});

describe('PnsVVia', () => {
  it('is virtual, half-drilled, and reports no hole at all', () => {
    const v = new PnsVVia({ x: 5, y: 6 }, 2, 600, 9);

    expect(v.kind()).toBe(PnsKind.VIA_T);
    expect(v.isVirtual()).toBe(true);
    expect(v.hasHole()).toBe(false);
    expect(v.drill()).toBe(300);
    expect(v.net()).toBe(9);
    expect([v.layers().start(), v.layers().end()]).toEqual([2, 2]);
    expect(v.shape(-1)).toEqual({ kind: 'circle', c: { x: 5, y: 6 }, r: 300 });
  });

  it('still owns the hole its base built; it is simply never reported', () => {
    const v = new PnsVVia({ x: 0, y: 0 }, 0, 600, 1);
    expect(v.hole()).not.toBeNull();
    expect(v.hasHole()).toBe(false);
  });
});

// ----- SOLID --------------------------------------------------------------------

describe('PnsSolid', () => {
  const pad = (): PnsSolid => {
    const s = new PnsSolid();
    s.setLayers(new PnsLayerRange(0));
    s.setShape({ kind: 'circle', c: { x: 0, y: 0 }, r: 250 });
    s.setPos({ x: 0, y: 0 });
    return s;
  };

  it('with no declared anchors, its own position is the only one', () => {
    const s = pad();
    s.setPos({ x: 10, y: 20 });
    expect(s.anchorCount()).toBe(1);
    expect(s.anchor(0)).toEqual({ x: 10, y: 20 });
  });

  it('with declared anchors, those are the anchors', () => {
    const s = pad();
    s.setAnchorPoints([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    expect(s.anchorCount()).toBe(2);
    expect(s.anchor(1)).toEqual({ x: 2, y: 2 });
  });

  it('setPos carries the shape and the hole with it', () => {
    const s = pad();
    s.setHole(PnsHole.makeCircularHole({ x: 0, y: 0 }, 100, new PnsLayerRange(0)));
    s.setPos({ x: 30, y: 40 });

    expect(s.shape(-1)).toEqual({ kind: 'circle', c: { x: 30, y: 40 }, r: 250 });
    expect(s.hole()?.shape(-1)).toEqual({ kind: 'circle', c: { x: 30, y: 40 }, r: 100 });
  });

  it('taking a hole makes the solid its owner, its parent pad, and its layer span', () => {
    const s = pad();
    s.setLayers(new PnsLayerRange(0, 3));
    const h = PnsHole.makeCircularHole({ x: 0, y: 0 }, 100, new PnsLayerRange());
    s.setHole(h);

    expect(s.hasHole()).toBe(true);
    expect(h.owner()).toBe(s);
    expect(h.parentPadVia()).toBe(s);
    expect([h.layers().start(), h.layers().end()]).toEqual([0, 3]);
  });

  it('has no hole until given one', () => {
    expect(pad().hasHole()).toBe(false);
    expect(pad().hole()).toBeNull();
  });

  it('clone copies the state but drops the offset, as upstream does', () => {
    const s = pad();
    s.setOffset({ x: 7, y: 8 });
    s.setPadToDie(11);
    s.setPadToDieDelay(12);
    s.setRank(3);
    s.setPos({ x: 30, y: 40 });
    s.setAnchorPoints([{ x: 1, y: 1 }]);

    const c = s.clone();
    expect(c.pos()).toEqual({ x: 30, y: 40 });
    expect(c.getPadToDie()).toBe(11);
    expect(c.getPadToDieDelay()).toBe(12);
    expect(c.rank()).toBe(3);
    expect(c.anchorPoints()).toEqual([{ x: 1, y: 1 }]);
    expect(c.offset()).toEqual({ x: 0, y: 0 });
  });

  it('a cloned solid’s hole is its own', () => {
    const s = pad();
    s.setHole(PnsHole.makeCircularHole({ x: 0, y: 0 }, 100, new PnsLayerRange(0)));

    const c = s.clone();
    expect(c.hole()).not.toBe(s.hole());
    expect(c.hole()?.parentPadVia()).toBe(c);
  });
});

// ----- HOLE ---------------------------------------------------------------------

describe('PnsHole', () => {
  it('makeCircularHole builds a circle on the given layers', () => {
    const h = PnsHole.makeCircularHole({ x: 10, y: 20 }, 100, new PnsLayerRange(0, 3));
    expect(h.kind()).toBe(PnsKind.HOLE_T);
    expect(h.shape(-1)).toEqual({ kind: 'circle', c: { x: 10, y: 20 }, r: 100 });
    expect([h.layers().start(), h.layers().end()]).toEqual([0, 3]);
    expect(h.radius()).toBe(100);
  });

  it('borrows its net from the pad or via it belongs to', () => {
    const h = PnsHole.makeCircularHole({ x: 0, y: 0 }, 100, new PnsLayerRange(0));
    h.setNet(1);
    expect(h.net()).toBe(1);

    const v = new PnsVia({ x: 0, y: 0 }, new PnsLayerRange(0), 600, 300, 42);
    h.setParentPadVia(v);
    expect(h.net()).toBe(42);
  });

  it('falls back to its parent pad’s board item when it has none directly', () => {
    const board = { layer: 'F.Cu' };
    const v = new PnsVia({ x: 0, y: 0 }, new PnsLayerRange(0), 600, 300, 1);
    v.setParent(board);

    const h = PnsHole.makeCircularHole({ x: 0, y: 0 }, 100, new PnsLayerRange(0));
    expect(h.boardItem()).toBeNull();

    h.setParentPadVia(v);
    expect(h.boardItem()).toBe(board);

    const own = { layer: 'B.Cu' };
    h.setParent(own);
    expect(h.boardItem()).toBe(own);
  });

  it('setCenter, setRadius and move all rewrite the circle', () => {
    const h = PnsHole.makeCircularHole({ x: 0, y: 0 }, 100, new PnsLayerRange(0));

    h.setCenter({ x: 5, y: 6 });
    expect(h.shape(-1)).toEqual({ kind: 'circle', c: { x: 5, y: 6 }, r: 100 });

    h.setRadius(50);
    expect(h.radius()).toBe(50);

    h.move({ x: 1, y: 2 });
    expect(h.shape(-1)).toEqual({ kind: 'circle', c: { x: 6, y: 8 }, r: 50 });
  });

  it('refuses the circle-only accessors on a non-circular hole', () => {
    const slot = new PnsHole({ kind: 'stadium', a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, r: 50 });
    expect(() => slot.radius()).toThrow(/non-circular/);
    expect(() => slot.setRadius(1)).toThrow(/non-circular/);
    expect(() => slot.setCenter({ x: 0, y: 0 })).toThrow(/non-circular/);

    // Moving one, though, works for any shape.
    slot.move({ x: 1, y: 1 });
    expect(slot.shape(-1)).toEqual({
      kind: 'stadium',
      a: { x: 1, y: 1 },
      b: { x: 11, y: 1 },
      r: 50,
    });
  });

  it('clone keeps layers, rank and marker, and belongs to nobody and to no pad', () => {
    const v = new PnsVia({ x: 0, y: 0 }, new PnsLayerRange(0), 600, 300, 1);
    const h = PnsHole.makeCircularHole({ x: 0, y: 0 }, 100, new PnsLayerRange(0, 3));
    h.setParentPadVia(v);
    h.setOwner(v);
    h.setRank(5);
    h.mark(LineMarker.MK_VIOLATION);

    const c = h.clone();
    expect([c.layers().start(), c.layers().end()]).toEqual([0, 3]);
    expect(c.rank()).toBe(5);
    expect(c.marker()).toBe(LineMarker.MK_VIOLATION);
    expect(c.owner()).toBeNull();
    expect(c.parentPadVia()).toBeNull();
  });
});
