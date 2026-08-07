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

/** Twice the unsigned area, used only to pick the smallest enclosing ring. */
function absArea2(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j]!.x - poly[i]!.x) * (poly[j]!.y + poly[i]!.y);
  }
  return Math.abs(s);
}

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
 * Nesting is resolved by depth: a ring inside an odd number of others is a hole,
 * and it belongs to the smallest ring containing it. That covers a pour with
 * several islands each having its own clearances, and an island sitting inside a
 * hole — which is what a plane split around a connector produces.
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
  const depth = valid.map((r, i) => {
    let d = 0;
    for (let j = 0; j < valid.length; j++) {
      if (j !== i && pointInPolygon(r[0]!, valid[j]!)) d++;
    }
    return d;
  });
  const area = valid.map(absArea2);

  for (let i = 0; i < valid.length; i++) {
    if (depth[i]! % 2 !== 0) continue; // odd depth: this ring is a hole

    const holes: (readonly Pt[])[] = [];
    for (let j = 0; j < valid.length; j++) {
      if (j === i || depth[j]! % 2 === 0) continue;
      if (!pointInPolygon(valid[j]![0]!, valid[i]!)) continue;
      // Belongs to the smallest ring that contains it, so a hole inside an
      // island inside a hole is attached to the island and not to the outside.
      let smallest = i;
      for (let k = 0; k < valid.length; k++) {
        if (k === j || depth[k]! % 2 !== 0) continue;
        if (pointInPolygon(valid[j]![0]!, valid[k]!) && area[k]! < area[smallest]!) smallest = k;
      }
      if (smallest === i) holes.push(valid[j]!);
    }
    emit(valid[i]!, holes, out);
  }
  return out;
}
