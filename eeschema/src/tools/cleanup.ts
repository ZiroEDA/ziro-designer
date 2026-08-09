// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Post-edit schematic cleanup, ported from KiCad's `SCHEMATIC::CleanUp` and
 * `SCH_LINE::MergeOverlap` (eeschema/schematic.cpp, eeschema/sch_line.cpp).
 *
 * KiCad runs this after every edit (as part of `RecalculateConnections`): it
 * merges pairs of wires that are colinear, the same layer/stroke, and either
 * overlap or touch end-to-end with no junction at the touch point, so two
 * segments drawn or dragged into a straight line become a single wire, exactly
 * as in the desktop app. This is the model side; the caller applies it after a
 * move/draw commit.
 *
 * Only the wire/bus merge is ported here (the user-visible "two wires in a line
 * stay separate" bug); junction/no-connect de-duplication is a separate concern.
 */

import type { Schematic, SchLine, SchJunction, Vec2, LibSymbol } from '../types.js';
import { makeWireWithUuid, makeBus, makeJunction, newUuid } from './build.js';
import { pruneGroupMembers } from './sch_group_tool.js';
import type { EditCommand } from './command.js';
import { isExplicitJunction, isExplicitJunctionNeeded } from './junction_helpers.js';
import { deleteByIds } from './mutate.js';
import { refId } from './hittest.js';

const eq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** KiCad's `less`: order points left-to-right, then bottom-to-top (x, then y). */
function less(a: Vec2, b: Vec2): boolean {
  if (a.x === b.x) return a.y < b.y;
  return a.x < b.x;
}

/** True if there is an explicit junction dot exactly at `p`. */
function junctionAt(junctions: readonly SchJunction[], p: Vec2): boolean {
  return junctions.some((j) => eq(j.at, p));
}

/** Two lines share a layer if they are the same kind (wire vs bus). */
function sameLayer(a: SchLine, b: SchLine): boolean {
  return a.kind === b.kind;
}

/** KiCad's SCH_LINE::IsStrokeEquivalent: equal width and equal (or both default) style. */
function strokeEquivalent(a: SchLine, b: SchLine): boolean {
  const wa = a.stroke?.width ?? 0;
  const wb = b.stroke?.width ?? 0;
  if (wa !== wb) return false;
  const ta = a.stroke?.type ?? 'default';
  const tb = b.stroke?.type ?? 'default';
  return ta === tb;
}

/**
 * Faithful port of `SCH_LINE::MergeOverlap`: if `first` and `second` are colinear
 * and overlap (or touch end-to-end with no junction at the touch point), return
 * the merged span [start,end]; otherwise null. `aCheckJunctions` mirrors KiCad.
 */
function mergeOverlap(
  first: SchLine,
  second: SchLine,
  junctions: readonly SchJunction[],
  checkJunctions: boolean,
): { start: Vec2; end: Vec2 } | null {
  if (first === second || !sameLayer(first, second)) return null;

  let leftmostStart = second.start;
  let leftmostEnd = second.end;
  let rightmostStart = first.start;
  let rightmostEnd = first.end;

  // Place each line's start to the left-and-below its end.
  if (!eq(leftmostStart, less(leftmostStart, leftmostEnd) ? leftmostStart : leftmostEnd)) {
    [leftmostStart, leftmostEnd] = [leftmostEnd, leftmostStart];
  }
  if (!eq(rightmostStart, less(rightmostStart, rightmostEnd) ? rightmostStart : rightmostEnd)) {
    [rightmostStart, rightmostEnd] = [rightmostEnd, rightmostStart];
  }

  // leftmost = the line starting farthest left; swap if needed.
  if (less(rightmostStart, leftmostStart)) {
    [leftmostStart, rightmostStart] = [rightmostStart, leftmostStart];
    [leftmostEnd, rightmostEnd] = [rightmostEnd, leftmostEnd];
  }

  const otherStart = rightmostStart;
  const otherEnd = rightmostEnd;

  if (less(rightmostEnd, leftmostEnd)) {
    rightmostStart = leftmostStart;
    rightmostEnd = leftmostEnd;
  }

  // End one before the beginning of the other -> no overlap possible.
  if (less(leftmostEnd, otherStart)) return null;

  // Trivial case: identical span.
  if (eq(leftmostStart, otherStart) && eq(leftmostEnd, otherEnd)) {
    return { start: leftmostStart, end: leftmostEnd };
  }

  // Colinearity test (KiCad's exact integer form).
  let colinear = false;
  if (leftmostStart.y === leftmostEnd.y && otherStart.y === otherEnd.y) {
    colinear = leftmostStart.y === otherStart.y; // horizontal
  } else if (leftmostStart.x === leftmostEnd.x && otherStart.x === otherEnd.x) {
    colinear = leftmostStart.x === otherStart.x; // vertical
  } else {
    const dx = leftmostEnd.x - leftmostStart.x;
    const dy = leftmostEnd.y - leftmostStart.y;
    colinear =
      (otherStart.y - leftmostStart.y) * dx === (otherStart.x - leftmostStart.x) * dy &&
      (otherEnd.y - leftmostStart.y) * dx === (otherEnd.x - leftmostStart.x) * dy;
  }
  if (!colinear) return null;

  // True overlap always merges; colinear touching segments only merge if there is
  // no junction where they meet.
  const touching = eq(leftmostEnd, rightmostStart);
  if (touching && checkJunctions && junctionAt(junctions, leftmostEnd)) return null;

  return { start: leftmostStart, end: rightmostEnd };
}

/** Build a merged wire/bus over `span`, preserving `template`'s kind, with a fresh uuid. */
function mergedLine(template: SchLine, span: { start: Vec2; end: Vec2 }): SchLine {
  return template.kind === 'bus'
    ? makeBus(span.start, span.end)
    : makeWireWithUuid(span.start, span.end, newUuid());
}

/**
 * Merge all colinear touching/overlapping wires and buses, looping until stable
 * (KiCad's `while( changed )` in CleanUp). Returns a new schematic; unchanged if
 * nothing merged.
 */
/**
 * KiCad-faithful wire cleanup after an edit (SCHEMATIC::CleanUp): split wires where
 * another wire tees into their middle, add junction dots where three wires meet or
 * a tee forms, drop unneeded junctions and zero-length wires, and merge colinear
 * wires that are not separated by a junction/vertex. Wires are kept whole through a
 * tee (KiCad does not split them); a junction marks the connection instead.
 */
export function mergeColinearWires(
  sch: Schematic,
  libById?: ReadonlyMap<string, LibSymbol>,
  /** Points a dot must not be re-added to; see `EditCommand.noAutoJunctionsAt`. */
  noAutoJunctionsAt?: readonly Vec2[],
): Schematic {
  const suppressed = new Set((noAutoJunctionsAt ?? []).map((p) => `${p.x},${p.y}`));
  let lines: SchLine[] = sch.lines.slice();
  const junctions: SchJunction[] = sch.junctions.slice();
  let changed = true;
  let any = false;
  const mark = () => {
    changed = true;
    any = true;
  };
  // The evolving document the junction predicates analyze (pins, sheet pins,
  // bus entries and labels come from `sch`; lines/junctions are the working
  // copies).
  const current = (): Schematic => ({ ...sch, lines, junctions });

  while (changed) {
    changed = false;

    // One snapshot per pass rather than one per predicate call. It holds the
    // *live* `lines` and `junctions` arrays, so a junction pushed below is
    // visible through it; only the merge step replaces `lines` outright, and
    // that is the last thing a pass does.
    const doc = current();

    // 1. Drop zero-length wires/buses.
    const zi = lines.findIndex(
      (l) => (l.kind === 'wire' || l.kind === 'bus') && eq(l.start, l.end),
    );
    if (zi >= 0) {
      lines.splice(zi, 1);
      mark();
      continue;
    }

    // 2. Junctions: add where needed, remove where no longer legitimate,
    //    SCH_SCREEN::IsExplicitJunction, which accounts for pins, buses, bus
    //    entries and labels, so a dot where a pin meets mid-wire or three
    //    buses tee survives.
    const ji = junctions.findIndex((j) => !isExplicitJunction(doc, libById, j.at));
    if (ji >= 0) {
      junctions.splice(ji, 1);
      mark();
      continue;
    }
    const need = new Set(junctions.map((j) => `${j.at.x},${j.at.y}`));
    let added = false;
    for (const l of lines) {
      if (l.kind !== 'wire' && l.kind !== 'bus') continue;
      for (const p of [l.start, l.end]) {
        const key = `${p.x},${p.y}`;
        if (!need.has(key) && !suppressed.has(key) && isExplicitJunctionNeeded(doc, libById, p)) {
          junctions.push(makeJunction(p));
          need.add(key);
          added = true;
        }
      }
    }
    if (added) {
      mark();
      continue;
    }

    // 3. Merge two colinear same-layer wires when nothing (junction/third end) lies
    //    between them (mergeOverlap already refuses to bridge a junction touch-point).
    // Every merge this pass can find, not just the first.
    //
    // Upstream's loop marks a merged pair `STRUCT_DELETED`, `break`s the
    // *inner* loop only, and carries on scanning; it re-collects the line list
    // at the top of each `while( changed )` pass, so a freshly merged segment
    // is considered next time round.
    //
    // Restarting the whole `while` after a single merge — as this did — makes
    // the cost quadratic in the number of merges, because steps 1 to 3 above
    // re-run each time and step 3 asks `isExplicitJunctionNeeded` about every
    // wire endpoint on the sheet. Dropping a dragged part on the coldfire demo
    // merges about 150 segments, so the sheet was analysed 150 times over.
    let merged = false;
    const dead = new Set<SchLine>();
    const born: SchLine[] = [];
    for (let a = 0; a < lines.length; a++) {
      const first = lines[a]!;
      if (dead.has(first)) continue;
      if (first.kind !== 'wire' && first.kind !== 'bus') continue;
      for (let b = a + 1; b < lines.length; b++) {
        const second = lines[b]!;
        if (dead.has(second)) continue;
        if (second.kind !== 'wire' && second.kind !== 'bus') continue;
        if (!sameLayer(first, second) || !strokeEquivalent(first, second)) continue;

        const dup =
          (eq(first.start, second.start) && eq(first.end, second.end)) ||
          (eq(first.start, second.end) && eq(first.end, second.start));
        if (dup) {
          dead.add(second);
          merged = true;
          continue;
        }

        // `mergeOverlap` is the whole test, exactly as upstream's loop has it:
        // a true overlap always merges, and only two segments that *touch*
        // end-to-end are held apart, by a junction at the touch point.
        //
        // There used to be an extra guard here refusing any merge with a
        // junction or a third wire's endpoint strictly inside the merged span.
        // Nothing upstream does that, and it is what left a drag's rubber-band
        // stub stacked on the wire it overlaps: the stub runs from the junction
        // the drag was pinned to, so the wire it covers almost always has
        // something teeing off its far end.
        const span = mergeOverlap(first, second, junctions, true);
        if (span) {
          dead.add(first);
          dead.add(second);
          born.push(mergedLine(first, span));
          merged = true;
          break; // this line is spoken for; go on to the next one
        }
      }
    }
    if (merged) {
      lines = lines.filter((l) => !dead.has(l));
      lines.push(...born);
    }
    if (merged) {
      mark();
    }
  }

  return any ? { ...sch, lines, junctions } : sch;
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

/**
 * `SCH_EDIT_TOOL::DoDelete` for a selection that may contain junction dots.
 *
 * A junction is not deleted like anything else. Upstream flags it and comes
 * back to it at the end, where `HasFlag( STRUCT_DELETED )` short-circuits the
 * "is it still needed" test, so a dot the user asked to remove goes whether or
 * not the tee under it would ask for one:
 *
 *     if( junction->HasFlag( STRUCT_DELETED ) || !screen->IsExplicitJunction( point ) )
 *         m_frame->DeleteJunction( &commit, junction );
 *
 * and `DeleteJunction` fuses the wires that met there so the tee stops being a
 * tee. Without that second half the dot reappears on the next cleanup pass,
 * which is what "junction dots cannot be deleted" was.
 */
export function deleteItems(sch: Schematic, ids: ReadonlySet<string>): EditCommand {
  const points = sch.junctions
    .filter((j, i) => ids.has(refId('junction', j.uuid, i)))
    .map((j) => j.at);
  const drop = deleteByIds(ids);
  if (points.length === 0) return drop;
  return {
    label: drop.label,
    apply: (doc) => dissolveJunctionsAt(drop.apply(doc), points),
    invert: (before) => restoreTo(before, drop.label),
    // The dot the user removed must not be put back by the cleanup that runs in
    // the same undo step.
    noAutoJunctionsAt: points,
  };
}

/**
 * Wrap a command so post-edit cleanup (wire merge) runs as part of the same
 * undoable step, mirroring KiCad where `RecalculateConnections`/`CleanUp` is part
 * of the edit's commit. Undo restores the exact pre-edit document (a snapshot,
 * like KiCad's PICKED_ITEMS_LIST), since a merge is not reversible field-by-field.
 */
export function withCleanup(
  cmd: EditCommand,
  libById?: ReadonlyMap<string, LibSymbol>,
): EditCommand {
  return {
    label: cmd.label,
    // Post-commit cleanup: colinear wire merge, then group-member pruning so
    // deleting items drops them from any group (empty groups stop serializing).
    apply: (doc) =>
      pruneGroupMembers(mergeColinearWires(cmd.apply(doc), libById, cmd.noAutoJunctionsAt)),
    invert: (before) => restoreTo(before, cmd.label),
  };
}

function restoreTo(target: Schematic, label: string): EditCommand {
  return {
    label,
    apply: () => target,
    invert: (current) => restoreTo(current, label),
  };
}
