// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Triangulating filled areas that have holes in them.
 *
 * ### Why the schematic did not need this
 *
 * `tessellate.ts`'s ear clipper takes one simple polygon, which was enough for
 * the schematic: a filled area there is a symbol body, small and convex and
 * never perforated.
 *
 * A board is not that. `drawBoard` fills zones, pads and vias with **`nonzero`**
 * winding, and a copper pour is full of holes — thermal reliefs, clearance
 * around every pad and via, keepouts — arriving as extra rings wound against the
 * outline. Triangulating each ring on its own fills all of them solid, so a
 * ground plane swallows its own clearances.
 *
 * ### Why earcut rather than our own
 *
 * The bridging this needs (cut a channel from each hole to the outline so the
 * pair becomes one ring) is deceptively hard. A hand-rolled version got one
 * hole, three holes, nested islands and concave outlines right and still
 * produced 40,496 units of area where 9,100 was correct on a 25-clearance grid
 * — which is what a real pour looks like. The failure is silent and geometric.
 * earcut is the standard solution, is ISC-licensed, and is vendored under
 * `vendor/` rather than added as a dependency. See NOTICE.md.
 *
 * This module is the part earcut does not do: sorting a flat set of rings into
 * outlines and their holes. earcut is told which rings are holes; it does not
 * work that out.
 *
 * ### A ring is a hole because of its winding, never because it is nested
 *
 * `nonzero` and `evenodd` disagree precisely here, and it is the whole reason
 * this file exists in the shape it does. Under `evenodd` any ring inside another
 * is a hole. Under `nonzero` a ring is a hole only when it is wound *against*
 * the rings enclosing it, so that the winding number inside it cancels to zero;
 * a ring nested inside another with the *same* winding stays solid, and the two
 * read as a union.
 *
 * That distinction is not academic on a board. Every bucket in `buildScene` is
 * one `Path2D` holding many independent shapes — the whole layer's pads in
 * `pads`, its vias in `vias` — and those shapes overlap constantly: a thermal
 * pad with four paste windows over it, a fanout pad under a plane tie, the
 * anchor and primitives of a custom pad. All of them are wound the same way, so
 * `nonzero` unions them, which is what Canvas2D does and what KiCad draws.
 * Deciding by nesting instead punched every overlapping pad out of the pad
 * beneath it and let the solder-mask and paste layers *below* show through the
 * gap — a copper pad reading as lavender rather than red.
 *
 * So the rule below is the winding number itself: sum the windings of every ring
 * containing a ring's interior, plus its own. Non-zero is filled and becomes an
 * outline; zero is a hole and is attached to the smallest ring around it.
 * Fractured pours (KiCad writes `filled_polygon` already fractured, so its rings
 * never nest) and genuine outline-plus-hole sets both come out unchanged.
 */

import earcut from './vendor/earcut.js';
import type { Pt } from './tessellate.js';

/**
 * Ray-cast containment. A point exactly on the boundary is not promised either
 * answer, which is fine here: rings from `buildScene` nest strictly, a hole
 * never shares an edge with its outline.
 */
function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Twice the signed area; its sign is the ring's winding direction. */
function signedArea2(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j]!.x - poly[i]!.x) * (poly[j]!.y + poly[i]!.y);
  }
  return s;
}

/** Twice the unsigned area, used only to pick the smallest enclosing ring. */
const absArea2 = (poly: readonly Pt[]): number => Math.abs(signedArea2(poly));

/** Triangulate one outline with its holes, appending points to `out`. */
function emit(outline: readonly Pt[], holes: readonly (readonly Pt[])[], out: Pt[]): void {
  const coords: number[] = [];
  const ringOf: Pt[] = [];
  for (const p of outline) {
    coords.push(p.x, p.y);
    ringOf.push(p);
  }
  const holeIndices: number[] = [];
  for (const h of holes) {
    holeIndices.push(ringOf.length); // in vertices, not coordinates
    for (const p of h) {
      coords.push(p.x, p.y);
      ringOf.push(p);
    }
  }
  for (const i of earcut(coords, holeIndices.length > 0 ? holeIndices : null, 2)) {
    out.push(ringOf[i]!);
  }
}

/**
 * Triangulate a set of closed rings under `nonzero`, honouring holes.
 *
 * Returns a flat list of points, three per triangle, so a caller can walk it in
 * threes straight into `Scene.triangle`.
 *
 * A ring is a hole when the winding number just inside it is zero — its own
 * winding cancelled by the rings around it — and solid otherwise. Every solid
 * ring is triangulated as an outline carrying the holes immediately inside it,
 * so a pour with several islands, an island sitting inside a hole (a plane split
 * around a connector) and a pad overlapping another pad all come out right.
 *
 * Two solid rings that overlap without either containing the other are each
 * triangulated whole, so the shared area is covered twice rather than unioned.
 * That is deliberate: containment is judged from one representative vertex, and
 * dropping a ring believed redundant would erase whatever part of it stuck out.
 * Overlapping opaque fills are identical either way, and KiCad draws each pad as
 * its own primitive, so it blends translucent overlaps the same way.
 */
export function triangulateRings(rings: readonly (readonly Pt[])[]): Pt[] {
  const valid = rings.filter((r) => r.length >= 3);
  if (valid.length === 0) return [];

  const out: Pt[] = [];
  if (valid.length === 1) {
    emit(valid[0]!, [], out);
    return out;
  }

  // A vertex is a good enough representative: rings here nest strictly, so it
  // avoids needing a guaranteed-interior point.
  const inside = valid.map((r, i) =>
    valid.map((other, j) => j !== i && pointInPolygon(r[0]!, other)),
  );
  const winding = valid.map((r) => (signedArea2(r) > 0 ? 1 : -1));
  const area = valid.map(absArea2);

  // The winding number of the region immediately inside each ring: its own turn
  // plus every ring enclosing it. Zero means the enclosing rings cancel it out,
  // which under `nonzero` is exactly what a hole is.
  const windingNumber = valid.map((_, i) => {
    let w = winding[i]!;
    for (let j = 0; j < valid.length; j++) if (inside[i]![j]) w += winding[j]!;
    return w;
  });

  /** The smallest ring enclosing ring `i`, or -1 when it is outermost. */
  const parentOf = (i: number): number => {
    let best = -1;
    for (let j = 0; j < valid.length; j++) {
      if (!inside[i]![j]) continue;
      if (best < 0 || area[j]! < area[best]!) best = j;
    }
    return best;
  };
  const parent = valid.map((_, i) => parentOf(i));

  for (let i = 0; i < valid.length; i++) {
    if (windingNumber[i] === 0) continue; // a hole; emitted with its outline

    const holes: (readonly Pt[])[] = [];
    for (let j = 0; j < valid.length; j++) {
      if (windingNumber[j] !== 0) continue;
      if (parent[j] === i) holes.push(valid[j]!);
    }
    emit(valid[i]!, holes, out);
  }
  return out;
}
