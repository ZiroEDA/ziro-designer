// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Minimum connection width: `DRCE_CONNECTION_WIDTH`.
 * Counterpart: `POLYGON_TEST` in `drc_test_provider_connection_width.cpp`.
 *
 * A neck is where one connected piece of copper is pinched thin — a zone that
 * necks down between two knockouts, a pour reaching a pad through a gap. The
 * copper is continuous, so nothing about clearance is violated; it is simply
 * too narrow to carry what it is meant to.
 *
 * ## Not the same question as a sliver
 *
 * `drc_sliver.ts` asks where a region tapers to a *point*. This asks where two
 * parts of the same outline pass close to each other while the copper between
 * them stays substantial on both sides. A sliver has one sharp vertex; a neck
 * has two ordinary ones facing each other across a gap that never opens.
 *
 * ## Finding the pairs
 *
 * Comparing every vertex against every other is quadratic and a filled zone has
 * tens of thousands. Instead the outline goes into a `VertexSet`, whose Morton
 * index makes "vertices near this one" a bounded walk along a second linked
 * list. Each candidate then has to survive four tests, in this order because
 * each is dearer than the last:
 *
 * 1. **Not adjacent.** `|Δi| > 1` — neighbouring vertices of an outline are
 *    always close together and never a neck.
 * 2. **Within the limit, and not coincident.** The squared distance does the
 *    work; zero would be a fracture point rather than a neck.
 * 3. **The chord runs through copper** (`locallyInside`), which is what makes
 *    this a pinch in the material rather than two edges passing on opposite
 *    sides of a hole.
 * 4. **Both sides are substantial.** See below.
 *
 * The starting vertex must additionally be *concave* — upstream's
 * `if( locallyInside( prev, next ) ) return nullptr`. A convex vertex cannot be
 * one shoulder of a neck.
 *
 * ## What "substantial" means, and why it is the whole test
 *
 * Cutting the polygon along the chord leaves two pieces. `isSubstantial` walks
 * each one and asks whether it ever wanders more than the limit in *both* x and
 * y before returning to the other end of the chord. If a piece never does, it
 * is not a piece of copper the neck is connecting — it is a wrinkle in the
 * outline, and reporting it would bury a real board in noise.
 *
 * That both-axes rule is the part worth reading twice. A long thin piece that
 * runs a hundred times the limit in x but never leaves the limit in y is *not*
 * substantial, because it is itself just a neck seen end-on. Requiring only one
 * axis would make every straight run of copper its own violation.
 *
 * ## The first four tests are filters, not behaviour
 *
 * Worth stating because it looks like a gap in the tests otherwise: on real
 * geometry those four reject only candidates `isSubstantial` would reject
 * anyway, so removing any one of them changes no answer. That is not an
 * accident — they are ordered cheapest-first precisely because the last test is
 * the dear one, and a zone fill has tens of thousands of vertices with an O(n)
 * walk behind each. They earn their place on cost, not on outcome.
 *
 * Checked rather than assumed: a C-shape whose two tips nearly touch is
 * rejected by the concave test, the chord test *and* substantiality
 * independently. They are kept because deleting a filter from a hot path to
 * satisfy a mutation score would be the wrong trade.
 *
 * ## The nearest match wins
 *
 * Where several vertices qualify, the closest is taken, and both ends plus
 * their immediate neighbours are then struck out of the search. Without that a
 * single neck reports once per vertex along both of its shoulders.
 */
import { VertexSet, type Vertex } from '@ziroeda/kimath/src/geometry/vertex_set.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** One pinch point: the two facing vertices and the span between them. */
export interface Neck {
  /** The two shoulders of the neck. */
  a: Vec2;
  b: Vec2;
  /** Midpoint of the span — where the marker goes. */
  at: Vec2;
  /** How wide the copper actually is here. */
  width: number;
}

/** Bounding box of a ring, for the Morton index. */
function boxOf(pts: readonly Vec2[]): { x: number; y: number; width: number; height: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * `POLYGON_TEST::isSubstantial`: does the piece cut off between `a` and `b`
 * wander more than `limit` in *both* axes before it gets back?
 *
 * Walking all the way round to `a` again counts as substantial: that means the
 * chord did not separate anything, so there is nothing insubstantial about it.
 */
function isSubstantial(vs: VertexSet, a: Vertex, b: Vertex, limit: number, total: number): boolean {
  const sweep = (forward: boolean): boolean => {
    let xChange = false;
    let yChange = false;
    let checked = 0;
    const p0 = a;
    let p = forward ? vs.getNextOutlineVertex(p0) : vs.getPrevOutlineVertex(p0);

    while (!vs.samePoint(p, b) && !vs.samePoint(p, a) && checked < total && !(xChange && yChange)) {
      if (Math.abs(p.x - p0.x) > limit) xChange = true;
      if (Math.abs(p.y - p0.y) > limit) yChange = true;
      p = forward ? vs.getNextOutlineVertex(p) : vs.getPrevOutlineVertex(p);
      checked++;
    }

    // Came all the way round: the chord separated nothing.
    if (vs.samePoint(p, a)) return true;
    return xChange && yChange;
  };

  // Upstream returns early if the forward sweep fails, so the backward one is
  // only reached when the forward side is substantial.
  return sweep(true) && sweep(false);
}

/**
 * `POLYGON_TEST::getKink`: the nearest vertex forming a neck with `pt`, if any.
 */
function getKink(vs: VertexSet, pt: Vertex, limit: number, total: number): Vertex | null {
  // A neck's shoulders are concave. A convex vertex is a corner of the copper,
  // not a pinch in it.
  if (vs.locallyInside(pt.prev, pt.next)) return null;

  const maxZ = vs.zOrder(pt.x + limit, pt.y + limit);
  const minZ = vs.zOrder(pt.x - limit, pt.y - limit);
  const limit2 = limit * limit;

  let minDist = Number.POSITIVE_INFINITY;
  let found: Vertex | null = null;

  const consider = (p: Vertex): void => {
    const deltaI = Math.abs(p.i - pt.i);
    const dx = p.x - pt.x;
    const dy = p.y - pt.y;
    const dist2 = dx * dx + dy * dy;

    if (
      deltaI > 1 &&
      dist2 < limit2 &&
      dist2 < minDist &&
      dist2 > 0 &&
      vs.locallyInside(p, pt) &&
      isSubstantial(vs, p, pt, limit, total) &&
      isSubstantial(vs, pt, p, limit, total)
    ) {
      minDist = dist2;
      found = p;
    }
  };

  // The Morton curve has seams, so a single hop is not enough — walk the whole
  // code range the limit box spans, in both directions.
  for (let p = pt.nextZ; p && p.z <= maxZ; p = p.nextZ) consider(p);
  for (let p = pt.prevZ; p && p.z >= minZ; p = p.prevZ) consider(p);

  return found;
}

/**
 * Every neck on one closed outline narrower than `limit`.
 *
 * `limit` is the minimum width *already reduced by the epsilon slack*: the
 * caller decides how much approximation to forgive, as upstream's
 * `testWidth = aMinWidth - epsilon` does.
 */
export function findNecks(pts: readonly Vec2[], limit: number): Neck[] {
  if (limit <= 0 || pts.length < 4) return [];

  const vs = new VertexSet(0);
  vs.setBoundingBox(boxOf(pts));
  const tail = vs.createList(pts);
  if (!tail) return [];
  tail.updateList();

  const total = vs.vertices.length;
  const out: Neck[] = [];
  const seen = new Set<Vertex>();
  const pairs = new Set<string>();

  let p = tail.next;
  const start = p;
  do {
    if (!seen.has(p)) {
      const match = getKink(vs, p, limit, total);

      if (match && !seen.has(match)) {
        // Upstream's key is the ordered pair, not a normalised one, and that
        // is enough: striking both shoulders out below means the same neck is
        // never approached from the other end to begin with.
        const key = `${p.i}:${match.i}`;
        if (!pairs.has(key)) {
          pairs.add(key);
          // Strike out both ends and their neighbours, or the neck reports
          // once per vertex along each shoulder.
          seen.add(p);
          seen.add(match);
          seen.add(p.next);
          seen.add(p.prev);
          seen.add(match.next);
          seen.add(match.prev);

          const dx = p.x - match.x;
          const dy = p.y - match.y;
          out.push({
            a: { x: p.x, y: p.y },
            b: { x: match.x, y: match.y },
            at: { x: Math.round((p.x + match.x) / 2), y: Math.round((p.y + match.y) / 2) },
            width: Math.round(Math.sqrt(dx * dx + dy * dy)),
          });
        }
      }
    }
    p = p.next;
  } while (p !== start);

  return out;
}
