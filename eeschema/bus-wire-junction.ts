// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Two of `SCH_EDIT_FRAME`'s wire/junction edits — `eeschema/bus-wire-junction.cpp`.
 *
 * That file has four functions upstream: `TestDanglingEnds` and
 * `UpdateHopOveredWires` are view-side (dangling-end display state and the
 * hop-over redraw) and stay in `designer/.../render/renderer.ts` for stage E2.
 * `TrimWire` and `DeleteJunction` are the model-side pair ported here.
 */

import type { Schematic, SchLine, Vec2 } from './types.js';
import { onSegment } from './connectivity/segment_index.js';
import { mergeOverlap, mergedLine, sameLayer } from './tools/cleanup.js';

const eq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * `SCH_EDIT_FRAME::TrimWire`: delete the run of wire between two points that
 * both lie on one wire.
 *
 * A symbol dropped so that two of its pins land on the same wire has bridged
 * that span itself; leaving the wire under it makes a redundant parallel
 * connection. The wire is broken at both points and the middle piece removed,
 * so what is left are the two outer stubs.
 *
 * A wire is left alone when the two points are exactly its own ends — that
 * would delete the wire outright rather than trim it.
 */
export function trimWire(doc: Schematic, start: Vec2, end: Vec2): Schematic {
  if (eq(start, end)) return doc;

  for (const line of doc.lines) {
    // Only wires; TrimWire filters on LAYER_WIRE.
    if (line.kind !== 'wire') continue;
    if (!onSegment(start, line.start, line.end) || !onSegment(end, line.start, line.end)) continue;
    // Don't remove entire wires.
    if (
      (eq(line.start, start) && eq(line.end, end)) ||
      (eq(line.start, end) && eq(line.end, start))
    )
      continue;

    // Break at both points and drop the piece between them; the outer stubs
    // survive, and a zero-length stub is cleaned up by SCHEMATIC::CleanUp.
    const [a, b] = onSegment(start, line.start, end) ? [start, end] : [end, start];
    const first = { ...line, end: a };
    const last = { ...line, start: b };
    const kept: SchLine[] = [];
    for (const l of doc.lines) {
      if (l !== line) {
        kept.push(l);
        continue;
      }
      if (!eq(first.start, first.end)) kept.push(first);
      if (!eq(last.start, last.end)) kept.push(last);
    }
    return { ...doc, lines: kept };
  }
  return doc;
}

/**
 * `SCH_EDIT_FRAME::DeleteJunction`: take a junction dot out *and* fuse the
 * colinear wires that met on it.
 *
 * Removing the dot on its own does nothing lasting, because the tee it sat on
 * is still a tee — `CleanUp` looks at the point, finds a junction is needed
 * again, and puts one straight back. Upstream never hits that, because deleting
 * the dot dissolves the tee first:
 *
 *     alg::for_all_pairs( lines.begin(), lines.end(),
 *             [&]( SCH_LINE* firstLine, SCH_LINE* secondLine )
 *             {
 *                 ...
 *                 if( SCH_LINE* new_line = secondLine->MergeOverlap( screen, firstLine, false ) )
 *
 * Note the `false`: `aCheckJunctions` is off, so the merge is allowed to bridge
 * the very point the junction was on — which is the whole manoeuvre. Two
 * segments that met end to end there become one wire running through, the third
 * wire now ends in the middle of it, and no junction is needed any more.
 *
 * Identical duplicate wires at the point are dropped rather than merged, as
 * upstream's first arm does.
 */
export function dissolveJunctionsAt(sch: Schematic, points: readonly Vec2[]): Schematic {
  if (points.length === 0) return sch;
  let lines = sch.lines.slice();
  let changed = false;

  for (const point of points) {
    // "line->IsEndPoint( aJunction->GetPosition() )": only wires and buses that
    // actually *end* on the point take part; one merely passing through does not.
    const dead = new Set<SchLine>();
    const born: SchLine[] = [];
    const at = lines.filter(
      (l) => (l.kind === 'wire' || l.kind === 'bus') && (eq(l.start, point) || eq(l.end, point)),
    );

    for (let a = 0; a < at.length; a++) {
      const first = at[a]!;
      if (dead.has(first)) continue;
      for (let b = a + 1; b < at.length; b++) {
        const second = at[b]!;
        if (dead.has(second) || !sameLayer(first, second)) continue;

        // "Remove identical lines".
        if (
          (eq(first.start, second.start) && eq(first.end, second.end)) ||
          (eq(first.start, second.end) && eq(first.end, second.start))
        ) {
          dead.add(first);
          changed = true;
          break;
        }

        // The junction is gone, so it may not hold the merge apart: `false`.
        const span = mergeOverlap(first, second, [], false);
        if (span) {
          dead.add(first);
          dead.add(second);
          born.push(mergedLine(first, span));
          changed = true;
          break;
        }
      }
    }

    if (dead.size || born.length) {
      lines = lines.filter((l) => !dead.has(l));
      lines.push(...born);
    }
  }

  return changed ? { ...sch, lines } : sch;
}
