// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A polygon outline as a doubly-linked ring, indexed by Morton code.
 * Counterpart: `VERTEX` / `VERTEX_SET` (libs/kimath/geometry/vertex_set.*),
 * itself derived from earcut.
 *
 * ## Why a linked list and not an array
 *
 * The point of this structure is answering "which other vertex of this same
 * outline is near *this* one" without comparing every pair. Each vertex sits in
 * two rings at once: `next`/`prev` follow the outline, and `nextZ`/`prevZ`
 * follow **Morton order** — the interleaved bits of the vertex's x and y, which
 * puts points that are close in the plane close in a single number. Walking the
 * z-ring outwards from a vertex until the code leaves a bounding box therefore
 * visits its spatial neighbours and almost nothing else.
 *
 * Nothing else we have does that. `SHAPE_POLY_SET` answers questions about
 * whole polygons; this answers questions about a polygon's *relationship with
 * itself*, which is what the minimum-connection-width check needs.
 *
 * ## What is ported and what is not
 *
 * Upstream's `VERTEX_SET` also carries the earcut triangulation — `isEar`,
 * `inTriangle`, `split`, Steiner points. None of that is here: nothing in this
 * codebase triangulates, and porting a triangulator to leave it uncalled would
 * be worse than not porting it. What is here is the ring, the Morton index, and
 * the geometric predicates the connection-width test uses. `middleInside` is
 * included because it is half of the inside/outside pair and costs four lines,
 * but it too has no caller yet.
 *
 * ## Winding is normalised on the way in
 *
 * `createList` reverses the input if its shoelace sum is positive, so the ring
 * always ends up wound the same way whatever the caller passed. Every predicate
 * below reads orientation — `locallyInside` in particular — so this is not
 * tidiness, it is what makes the predicates mean one thing.
 */
import type { Vec2 } from '../math/vector2.js';

export interface Box2 {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One point of an outline, linked into both rings.
 *
 * Mutable and self-referential by design: this is a linked list, and the whole
 * reason it exists is that the links are walked rather than rebuilt.
 */
export class Vertex {
  /** Index of this point in the *original* chain, which splits do not renumber. */
  readonly i: number;
  readonly x: number;
  readonly y: number;
  /** Morton code, filled in lazily by `updateOrder`. */
  z = 0;
  next!: Vertex;
  prev!: Vertex;
  nextZ: Vertex | null = null;
  prevZ: Vertex | null = null;
  private readonly parent: VertexSet;

  constructor(i: number, x: number, y: number, parent: VertexSet) {
    this.i = i;
    this.x = x;
    this.y = y;
    this.parent = parent;
  }

  /** Same *place*, not the same vertex — an outline may revisit a point. */
  equals(other: Vertex): boolean {
    return this.x === other.x && this.y === other.y;
  }

  /** Unlink from both rings. */
  remove(): void {
    this.next.prev = this.prev;
    this.prev.next = this.next;
    if (this.prevZ) this.prevZ.nextZ = this.nextZ;
    if (this.nextZ) this.nextZ.prevZ = this.prevZ;
    this.nextZ = null;
    this.prevZ = null;
  }

  /**
   * Fill in the Morton code, once.
   *
   * Upstream's `if( !z )` guard, kept: a code of 0 is the bounding box's own
   * corner and recomputing it is harmless, so the guard is about not paying for
   * the work twice rather than about correctness.
   */
  updateOrder(): void {
    if (!this.z) this.z = this.parent.zOrder(this.x, this.y);
  }

  /**
   * Drop coincident points, assign every Morton code, then rebuild the z-ring.
   *
   * Must be called before any z-ring walk: `createList` leaves `nextZ`/`prevZ`
   * entirely unset, so a search that skipped this would silently visit nothing
   * and report no neighbours — a false negative that looks exactly like a clean
   * board.
   */
  updateList(): void {
    let p = this.next;

    while (p !== this) {
      if (p.equals(p.next)) {
        p = p.prev;
        p.next.remove();
        if (p === p.next) break;
      }
      p.updateOrder();
      p = p.next;
    }

    this.updateOrder();
    this.zSort();
  }

  /**
   * Rebuild the z-ring in Morton order.
   *
   * Ties break on x, then y, then the original index, so the order is total.
   * That matters more than it looks: the connection-width search walks until
   * the code leaves a range, and an unstable order there makes which neighbour
   * it finds depend on sort implementation.
   */
  zSort(): void {
    const queue: Vertex[] = [this];
    for (let p = this.next; p && p !== this; p = p.next) queue.push(p);

    queue.sort((a, b) => {
      if (a.z !== b.z) return a.z - b.z;
      if (a.x !== b.x) return a.x - b.x;
      if (a.y !== b.y) return a.y - b.y;
      return a.i - b.i;
    });

    let prevElem: Vertex | null = null;
    for (const elem of queue) {
      if (prevElem) prevElem.nextZ = elem;
      elem.prevZ = prevElem;
      prevElem = elem;
    }
    if (prevElem) prevElem.nextZ = null;
  }

  /**
   * Signed area of the ring from here, optionally stopping early at `end`.
   *
   * When it does stop early the walk has traced an open chain, so the last term
   * closes it back to the start — the area of the polygon you would get by
   * joining `end` to here. Without that the answer is not an area of anything.
   */
  area(end?: Vertex): number {
    let p: Vertex = this;
    let a = 0;

    do {
      a += (p.x + p.next.x) * (p.next.y - p.y);
      p = p.next;
    } while (p !== this && p !== end);

    if (p !== this) a += (p.x + this.x) * (this.y - p.y);

    return a / 2;
  }
}

/** `VERTEX_SET`: owns the vertices and the bounding box the Morton code needs. */
export class VertexSet {
  /**
   * Squared distance below which a point is dropped as a duplicate of the last.
   * Upstream squares the constructor argument; so does this.
   */
  private readonly simplificationLevel: number;
  private bbox: Box2 = { x: 0, y: 0, width: 0, height: 0 };
  readonly vertices: Vertex[] = [];

  constructor(simplificationLevel = 0) {
    this.simplificationLevel = simplificationLevel * simplificationLevel;
  }

  /**
   * The box the Morton code is computed against.
   *
   * Must be set before `createList`, and must actually contain the points: the
   * code is a position *within this box* quantised to 15 bits per axis, so a
   * box that does not enclose the outline clamps every outlying point to the
   * same code and collapses the spatial index into a linear scan.
   */
  setBoundingBox(box: Box2): void {
    this.bbox = box;
  }

  /** Link one point into the outline ring after `last`. */
  insertVertex(index: number, pt: Vec2, last: Vertex | null): Vertex {
    const p = new Vertex(index, pt.x, pt.y, this);
    this.vertices.push(p);

    if (!last) {
      p.prev = p;
      p.next = p;
    } else {
      p.next = last.next;
      p.prev = last;
      last.next.prev = p;
      last.next = p;
    }
    return p;
  }

  /**
   * Build a ring from a closed chain of points, returning its tail.
   *
   * The shoelace sum decides direction: a positive sum means the points are
   * wound the way this structure does not want, so they go in backwards. Every
   * orientation-reading predicate below depends on that being settled here.
   */
  createList(points: readonly Vec2[], tail: Vertex | null = null): Vertex | null {
    let out = tail;
    let sum = 0;

    for (let i = 0; i < points.length; i++) {
      const p1 = points[i]!;
      const p2 = points[(i + 1) % points.length]!;
      sum += (p2.x - p1.x) * (p2.y + p1.y);
    }

    let lastPt: Vec2 = { x: 0, y: 0 };
    let first = true;

    const addVertex = (i: number): void => {
      const pt = points[i]!;
      const dx = pt.x - lastPt.x;
      const dy = pt.y - lastPt.y;
      if (first || dx * dx + dy * dy > this.simplificationLevel) {
        out = this.insertVertex(i, pt, out);
        lastPt = pt;
        first = false;
      }
    };

    if (sum > 0) for (let i = points.length - 1; i >= 0; i--) addVertex(i);
    else for (let i = 0; i < points.length; i++) addVertex(i);

    // A chain given with its first point repeated at the end closes onto
    // itself; drop the repeat rather than carry a zero-length edge.
    if (out && out.equals(out.next)) out.next.remove();

    return out;
  }

  /**
   * The Morton code of a point: x and y quantised to 15 bits within the
   * bounding box, then bit-interleaved.
   *
   * Interleaving is what makes one number stand in for two dimensions —
   * numbers that are close share a high-bit prefix, which is to say they are
   * close in the plane. The converse does not hold (the curve has seams), which
   * is why callers search a *range* of codes rather than trusting a single hop.
   */
  zOrder(ax: number, ay: number): number {
    const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
    // The zero-extent guards are ours, not upstream's, and they are not
    // cosmetic. A single-point or perfectly flat outline gives the box no
    // width, and the point sitting exactly on the origin then divides 0 by 0 —
    // NaN, which compares false against everything and quietly scrambles the
    // z-ring rather than failing. Collapsing the whole degenerate axis to zero
    // costs the index nothing it had to give on such an outline anyway.
    const limitX = this.bbox.width === 0 ? 0 : clamp((ax - this.bbox.x) / this.bbox.width);
    const limitY = this.bbox.height === 0 ? 0 : clamp((ay - this.bbox.y) / this.bbox.height);

    let x = Math.trunc(limitX * 32767);
    let y = Math.trunc(limitY * 32767);

    x = (x | (x << 8)) & 0x00ff00ff;
    x = (x | (x << 4)) & 0x0f0f0f0f;
    x = (x | (x << 2)) & 0x33333333;
    x = (x | (x << 1)) & 0x55555555;

    y = (y | (y << 8)) & 0x00ff00ff;
    y = (y | (y << 4)) & 0x0f0f0f0f;
    y = (y | (y << 2)) & 0x33333333;
    y = (y | (y << 1)) & 0x55555555;

    // Bit 29 at the very most — 15 bits per axis interleave to 30 — so this
    // cannot come out negative however the two are packed. A `>>> 0` here is
    // dead weight; mutation testing said so, and it is gone.
    return x | (y << 1);
  }

  /** Twice the signed area of the triangle p-q-r; negative is one turn direction. */
  area(p: Vertex, q: Vertex, r: Vertex): number {
    return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  }

  /** Two vertices at the same place — not necessarily the same vertex. */
  samePoint(a: Vertex | null, b: Vertex | null): boolean {
    return a !== null && b !== null && a.x === b.x && a.y === b.y;
  }

  /**
   * The next vertex *along the outline*, stepping over fracture points.
   *
   * A polygon with holes reaches them through a pair of coincident vertices
   * joined by a zero-width bridge. Following `next` blindly at such a point
   * turns onto the bridge and walks the hole instead of the outline. The tests
   * here identify that case by its signature — a z-neighbour at the same place
   * whose own neighbour matches ours, on a horizontal edge, which is how the
   * fracturer makes them — and hop across.
   */
  getNextOutlineVertex(pt: Vertex): Vertex {
    const nz = pt.nextZ;
    const pz = pt.prevZ;

    if (this.samePoint(pt, nz) && this.samePoint(pt.next, nz!.prev) && pt.y === pt.next.y)
      return nz!.next;

    if (this.samePoint(pt, pz) && this.samePoint(pt.next, pz!.prev) && pt.y === pt.next.y)
      return pz!.next;

    return pt.next;
  }

  /** `getNextOutlineVertex` the other way. Note it tests one condition fewer. */
  getPrevOutlineVertex(pt: Vertex): Vertex {
    const nz = pt.nextZ;
    const pz = pt.prevZ;

    if (this.samePoint(pt, nz) && pt.y === pt.prev.y) return nz!.prev;
    if (this.samePoint(pt, pz) && pt.y === pt.prev.y) return pz!.prev;

    return pt.prev;
  }

  /**
   * Whether the segment a→b leaves `a` heading into the polygon.
   *
   * Local, as the name says: it decides using only `a`'s own corner, so it is
   * cheap and says nothing about whether the *rest* of the segment stays
   * inside. Callers that need that pair it with `middleInside`.
   */
  locallyInside(a: Vertex, b: Vertex): boolean {
    const an = this.getNextOutlineVertex(a);
    const ap = this.getPrevOutlineVertex(a);

    if (this.area(ap, a, an) < 0) return this.area(a, b, an) >= 0 && this.area(a, ap, b) >= 0;
    return this.area(a, b, ap) < 0 || this.area(a, an, b) < 0;
  }

  /**
   * Whether the *midpoint* of a→b is inside the polygon, by ray casting.
   *
   * The complement of `locallyInside`: that one is exact near `a` and blind
   * further out, this one samples one point far from either end. Neither alone
   * proves a chord lies inside; together they are what earcut settles for.
   */
  middleInside(a: Vertex, b: Vertex): boolean {
    let p: Vertex = a;
    let inside = false;
    const px = (a.x + b.x) / 2;
    const py = (a.y + b.y) / 2;

    do {
      if (
        p.y > py !== p.next.y > py &&
        px < ((p.next.x - p.x) * (py - p.y)) / (p.next.y - p.y) + p.x
      )
        inside = !inside;
      p = p.next;
    } while (p !== a);

    return inside;
  }
}
