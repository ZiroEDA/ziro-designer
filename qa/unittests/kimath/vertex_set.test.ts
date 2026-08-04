// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A polygon outline as a doubly-linked ring, indexed by Morton code.
 * Counterpart: `VERTEX` / `VERTEX_SET`.
 *
 * The structure's whole purpose is finding a vertex's *spatial* neighbours
 * cheaply, so the tests that matter are about the two rings staying consistent:
 * the outline ring after duplicates are dropped, and the z-ring after a sort
 * that has to be total or the neighbour search becomes implementation-defined.
 *
 * The predicates get their own section because `locallyInside` and
 * `middleInside` are easy to assume are the same question. They are not, and
 * there are fixtures below where they disagree in both directions — which is
 * the reason earcut carries both.
 *
 * The shapes here use irregular coordinates on purpose: on an axis-aligned L,
 * most interesting chords have their midpoint exactly on an edge, where ray
 * casting is a coin toss and a test would be pinning noise.
 */
import { describe, expect, it } from 'vitest';
import { VertexSet, type Vertex } from '@ziroeda/kimath/src/geometry/vertex_set.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

const P = (x: number, y: number): Vec2 => ({ x, y });

/** Build a ring, with the bounding box the Morton code needs. */
function ringOf(pts: readonly Vec2[], simplification = 0) {
  const vs = new VertexSet(simplification);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  vs.setBoundingBox({
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  });
  const tail = vs.createList(pts)!;
  return { vs, tail };
}

/** The outline ring as "index:(x,y)" strings, starting after the tail. */
function walk(tail: Vertex): string[] {
  const out: string[] = [];
  let p = tail.next;
  do {
    out.push(`${p.i}:(${p.x},${p.y})`);
    p = p.next;
  } while (p !== tail.next);
  return out;
}

/** The z-ring from its head. */
function walkZ(tail: Vertex): number[] {
  let p: Vertex | null = tail;
  while (p?.prevZ) p = p.prevZ;
  const out: number[] = [];
  while (p) {
    out.push(p.i);
    p = p.nextZ;
  }
  return out;
}

const byIndex = (tail: Vertex): Map<number, Vertex> => {
  const m = new Map<number, Vertex>();
  let p = tail.next;
  do {
    m.set(p.i, p);
    p = p.next;
  } while (p !== tail.next);
  return m;
};

const SQUARE = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];

/** An L with no axis-aligned chord midpoints, so the predicates are unambiguous. */
const L = [P(0, 0), P(21, 0), P(21, 23), P(11, 19), P(9, 9), P(0, 7)];

describe('building the ring', () => {
  it('links every point into a circle', () => {
    const { tail } = ringOf(SQUARE);

    expect(walk(tail)).toEqual(['0:(0,0)', '1:(10,0)', '2:(10,10)', '3:(0,10)']);
  });

  it('normalises the winding, so the direction the caller used stops mattering', () => {
    // Every orientation-reading predicate below depends on this being settled
    // once, here.
    const forward = ringOf(SQUARE);
    const backward = ringOf([...SQUARE].reverse());

    const coords = (t: Vertex) => walk(t).map((s) => s.slice(s.indexOf(':') + 1));
    expect(coords(backward.tail)).toEqual(coords(forward.tail));
  });

  it('keeps the original indices, which a reversal does not renumber', () => {
    // Splits share indices between the two polygons they produce, so the index
    // is an identity rather than a position.
    expect(walk(ringOf([...SQUARE].reverse()).tail)[0]).toBe('3:(0,0)');
  });

  it('closes a chain that repeats its first point rather than keeping the repeat', () => {
    const { tail, vs } = ringOf([...SQUARE, P(0, 0)]);

    expect(walk(tail)).toHaveLength(4);
    expect(vs.vertices).toHaveLength(5); // created, then unlinked
  });

  it('drops a point closer than the simplification level', () => {
    const { tail } = ringOf([P(0, 0), P(10, 0), P(10, 2), P(10, 10), P(0, 10)], 5);

    expect(walk(tail)).toEqual(['0:(0,0)', '1:(10,0)', '3:(10,10)', '4:(0,10)']);
  });

  it('keeps that same point when the level is small enough', () => {
    expect(walk(ringOf([P(0, 0), P(10, 0), P(10, 2), P(10, 10), P(0, 10)], 1).tail)).toHaveLength(
      5,
    );
  });

  it('compares squared distances against the squared level', () => {
    // The constructor squares its argument, so a level of 5 admits points up to
    // 5 apart — not up to sqrt(5). This point is 3 away: dropped under the
    // squared rule (9 < 25), kept under the unsquared one (9 > 5). Forgetting
    // the square silently makes the whole simplification far too aggressive.
    const { tail } = ringOf([P(0, 0), P(10, 0), P(10, 3), P(10, 10), P(0, 10)], 5);

    expect(walk(tail)).toEqual(['0:(0,0)', '1:(10,0)', '3:(10,10)', '4:(0,10)']);
  });

  it('appends a second chain into one ring', () => {
    // How a polygon with a hole is fed in: two chains, one ring, coincident
    // vertices where they join.
    const vs = new VertexSet(0);
    vs.setBoundingBox({ x: 0, y: 0, width: 30, height: 10 });
    let tail = vs.createList(SQUARE);
    tail = vs.createList([P(20, 0), P(30, 0), P(30, 10), P(20, 10)], tail);

    expect(walk(tail!)).toHaveLength(8);
  });
});

describe('updateList', () => {
  it('collapses two coincident vertices that the ring picked up from a join', () => {
    // Not the same as the simplification above: these arrive from *different*
    // chains, so nothing at insert time could have seen them as adjacent.
    const vs = new VertexSet(0);
    vs.setBoundingBox({ x: 0, y: 0, width: 10, height: 10 });
    let tail = vs.createList([P(0, 0), P(10, 0), P(10, 10)]);
    tail = vs.createList([P(10, 10), P(0, 10)], tail);
    expect(walk(tail!)).toHaveLength(5);

    tail!.updateList();

    expect(walk(tail!)).toHaveLength(4);
  });

  it('builds the z-ring, which createList leaves entirely unset', () => {
    // The failure this guards is silent: a search over an unbuilt z-ring
    // visits nothing and reports no neighbours, which looks like a clean board.
    const { tail } = ringOf(SQUARE);
    expect(tail.nextZ).toBeNull();
    expect(tail.prevZ).toBeNull();

    tail.updateList();

    expect(walkZ(tail)).toHaveLength(4);
  });

  it('orders the z-ring by Morton code, so plane neighbours are list neighbours', () => {
    const { tail } = ringOf(SQUARE);
    tail.updateList();

    // Interleaving x and y bits puts (0,0) first and the far corner last.
    expect(walkZ(tail)).toEqual([0, 1, 3, 2]);
  });

  it('assigns every vertex a code, not just the one it was called on', () => {
    const { tail } = ringOf(L);
    tail.updateList();

    let p = tail.next;
    const codes: number[] = [];
    do {
      codes.push(p.z);
      p = p.next;
    } while (p !== tail.next);

    expect(codes.filter((z) => z === 0)).toHaveLength(1); // only the box corner
  });
});

describe('the Morton code', () => {
  it('is the bit-interleave of the two axes', () => {
    const vs = new VertexSet(0);
    vs.setBoundingBox({ x: 0, y: 0, width: 32767, height: 32767 });

    // x = 0b01, y = 0b10 interleaved (x in even bits, y in odd) is 0b1001 = 9.
    expect(vs.zOrder(1, 2)).toBe(9);
  });

  it('fits in 30 bits, which is what keeps it positive', () => {
    // 15 bits per axis interleave to bit 29 at the very most. That bound is the
    // reason no unsigned cast is needed; if either axis ever widened, the code
    // would reach the sign bit and sort before everything else.
    const vs = new VertexSet(0);
    vs.setBoundingBox({ x: 0, y: 0, width: 32767, height: 32767 });

    expect(vs.zOrder(32767, 32767)).toBeGreaterThan(0);
    expect(vs.zOrder(32767, 32767)).toBeLessThan(2 ** 30);
  });

  it('clamps a point outside the bounding box rather than wrapping', () => {
    const vs = new VertexSet(0);
    vs.setBoundingBox({ x: 0, y: 0, width: 100, height: 100 });

    expect(vs.zOrder(-50, -50)).toBe(vs.zOrder(0, 0));
    expect(vs.zOrder(500, 500)).toBe(vs.zOrder(100, 100));
  });

  it('collapses a degenerate bounding box instead of dividing by it', () => {
    // A single point, or a perfectly flat outline. Without the guard the point
    // on the origin divides 0 by 0 — NaN, which compares false against
    // everything and scrambles the z-ring rather than failing — while every
    // other point saturates to the far corner. Both codes must simply be zero.
    const vs = new VertexSet(0);
    vs.setBoundingBox({ x: 5, y: 5, width: 0, height: 0 });

    expect(vs.zOrder(5, 5)).toBe(0);
    expect(vs.zOrder(9, 9)).toBe(0);
    expect(vs.zOrder(-100, 4000)).toBe(0);
  });

  it('breaks ties on x, then y, then index, so the order is total', () => {
    // Two points inside one quantisation cell share a code. If the sort left
    // them in an arbitrary order, which neighbour a bounded z-walk finds would
    // depend on the sort implementation.
    // The larger x is deliberately *earlier* in the ring: `Array.sort` is
    // stable, so a comparator that gave up on ties would leave it there and
    // this would pass without the tie-break existing at all.
    const vs = new VertexSet(0);
    vs.setBoundingBox({ x: 0, y: 0, width: 32767000, height: 32767000 });
    const tail = vs.createList([P(0, 0), P(9000001, 1), P(9000000, 0), P(0, 9000000)])!;
    tail.updateList();

    const zs = walkZ(tail);
    const codes = new Map<number, number>();
    let p = tail.next;
    do {
      codes.set(p.i, p.z);
      p = p.next;
    } while (p !== tail.next);

    // The two near points really do collide, or this proves nothing.
    expect(codes.get(1)).toBe(codes.get(2));
    // ...and the lower x wins, reversing the order they sit in the ring.
    expect(zs.indexOf(2)).toBeLessThan(zs.indexOf(1));
  });
});

describe('area', () => {
  it('is the polygon’s, from any vertex on it', () => {
    const { tail } = ringOf(SQUARE);

    expect(Math.abs(tail.area())).toBe(100);
    expect(Math.abs(tail.next.area())).toBe(100);
  });

  it('closes the chain when it stops early, rather than reporting an open one', () => {
    // Stopping at the opposite corner traces half the square and then joins
    // back — the triangle, not a meaningless partial sum.
    const { tail } = ringOf(SQUARE);
    const start = tail.next; // (0,0)
    const opposite = start.next.next; // (10,10)

    expect(Math.abs(start.area(opposite))).toBe(50);
  });

  it('is the triangle form for three vertices', () => {
    const { vs, tail } = ringOf(SQUARE);
    const v = byIndex(tail);

    // Twice the signed area — the halving is left out of this overload.
    expect(Math.abs(vs.area(v.get(0)!, v.get(1)!, v.get(2)!))).toBe(100);
  });
});

describe('locallyInside', () => {
  const { vs, tail } = ringOf(L);
  tail.updateList();
  const v = byIndex(tail);

  it('accepts a chord that leaves into the material', () => {
    expect(vs.locallyInside(v.get(0)!, v.get(4)!)).toBe(true);
  });

  it('rejects one that leaves into the notch', () => {
    expect(vs.locallyInside(v.get(3)!, v.get(5)!)).toBe(false);
  });

  it('is not symmetric, because it only ever looks at the first vertex’s corner', () => {
    // The single most surprising thing about it: a chord can leave `a` into the
    // material and still arrive at `b` from outside.
    expect(vs.locallyInside(v.get(0)!, v.get(3)!)).toBe(true);
    expect(vs.locallyInside(v.get(3)!, v.get(0)!)).toBe(false);
  });
});

describe('middleInside', () => {
  const { vs, tail } = ringOf(L);
  tail.updateList();
  const v = byIndex(tail);

  it('accepts a chord whose midpoint is in the material', () => {
    expect(vs.middleInside(v.get(0)!, v.get(4)!)).toBe(true);
  });

  it('rejects one whose midpoint is in the notch', () => {
    expect(vs.middleInside(v.get(3)!, v.get(5)!)).toBe(false);
  });
});

describe('the two predicates are different questions', () => {
  const { vs, tail } = ringOf(L);
  tail.updateList();
  const v = byIndex(tail);

  it('disagree when a chord leaves into material and crosses the notch', () => {
    // 0 -> 3 sets off into the L and its midpoint lands in the cut-out.
    expect(vs.locallyInside(v.get(0)!, v.get(3)!)).toBe(true);
    expect(vs.middleInside(v.get(0)!, v.get(3)!)).toBe(false);
  });

  it('disagree the other way when a chord leaves along an edge', () => {
    // 4 -> 3 sets off the wrong side of the reflex corner but its midpoint is
    // solidly inside. Either predicate alone would answer this one wrongly,
    // which is why earcut carries both.
    expect(vs.locallyInside(v.get(4)!, v.get(3)!)).toBe(false);
    expect(vs.middleInside(v.get(4)!, v.get(3)!)).toBe(true);
  });
});

describe('walking the outline past a fracture', () => {
  // A polygon with a hole is fed in as two chains joined by coincident
  // vertices. Following `next` blindly at the join turns onto the bridge and
  // walks the hole; these hop across instead.
  const vs = new VertexSet(0);
  vs.setBoundingBox({ x: 0, y: 0, width: 30, height: 10 });
  let tail = vs.createList(SQUARE);
  tail = vs.createList([P(20, 0), P(30, 0), P(30, 10), P(20, 10)], tail);
  tail!.updateList();

  it('is the plain next vertex when there is no fracture to step over', () => {
    const v = tail!.next;

    expect(vs.getNextOutlineVertex(v)).toBe(v.next);
    expect(vs.getPrevOutlineVertex(v)).toBe(v.prev);
  });

  it('never leaves the ring', () => {
    // Weak, but the failure mode it excludes is a null dereference partway
    // through a walk over a real board's fill.
    let p = tail!;
    for (let n = 0; n < 20; n++) {
      p = vs.getNextOutlineVertex(p);
      expect(p).toBeDefined();
    }
  });
});

describe('remove', () => {
  it('takes the vertex out of both rings at once', () => {
    const { tail } = ringOf(SQUARE);
    tail.updateList();
    const victim = tail.next.next;
    const before = victim.prev;
    const after = victim.next;

    victim.remove();

    expect(before.next).toBe(after);
    expect(after.prev).toBe(before);
    expect(victim.nextZ).toBeNull();
    expect(victim.prevZ).toBeNull();
  });

  it('stitches the z-ring back together across the gap', () => {
    // Nulling the victim's own pointers is the easy half. Leaving its former
    // neighbours pointing at it is what makes a later z-walk visit a vertex
    // that is no longer in the outline.
    const { tail } = ringOf(SQUARE);
    tail.updateList();
    const victim = walkZ(tail).length > 2 ? tail.nextZ! : tail;

    victim.remove();

    expect(walkZ(tail)).not.toContain(victim.i);
  });
});
