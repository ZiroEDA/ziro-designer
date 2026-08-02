// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What happens to the wiring the moment a move or drag is dropped.
 *
 * Counterpart: the block at the end of `SCH_MOVE_TOOL::moveItem`'s commit
 * (eeschema/tools/sch_move_tool.cpp), which runs — in this order —
 *
 *  1. a junction at every point the moved items *vacated*, where one is now
 *     needed (the `aInternalPoints` loop);
 *  2. `SCH_LINE_WIRE_BUS_TOOL::TrimOverLappingWires` over the drag set, which
 *     deletes the span of a wire that a moved item now covers end to end;
 *  3. `SCH_LINE_WIRE_BUS_TOOL::AddJunctionsIfNeeded` over the same set
 *     (`SCH_SCREEN::GetNeededJunctions`);
 *  4. `trimDanglingLines`, for a drag but not a slice: the stubs a drag left
 *     hanging;
 *  5. `SCH_EDIT_FRAME::AutoRotateItem` on each moved item;
 *  6. `SCHEMATIC::CleanUp`.
 *
 * (6) already runs on every edit here, through `withCleanup`. This module is
 * (1)–(4), which had no counterpart: a drop left overlapping wires whole,
 * junctions unmade at the points it created and unremoved at the points it
 * vacated, and stubs dangling.
 *
 * (5) is **not** ported. It turns a label whose `AutoRotateOnPlacement()` is
 * set, and that flag is not part of the file format — upstream keeps it in
 * memory only (`SCH_LABEL_BASE::m_autoRotateOnPlacement`), so a reloaded
 * schematic has it false on every label and `AutoRotateItem` does nothing.
 * Our label model has no field for it at all, so honouring it after a move
 * needs a session-only flag on `SchLabel` first; that is its own change.
 *
 * The drag set is *not* the selection. Upstream copies the selection and adds
 * `m_newDragLines` (the rubber-band stubs) and `m_changedDragLines` (wires
 * whose endpoint was dragged), because those are exactly the wires whose
 * geometry the drop changed.
 */

import type { LibSymbol, Schematic, SchLine, Vec2 } from '../types.js';
import { onSegment } from '../connectivity/segment_index.js';
import { wireDangleStates } from '../connectivity/dangling.js';
import { connectionPoints, type MoveSpec } from './connect.js';
import type { EditCommand } from './command.js';
import { isExplicitJunctionNeeded } from './junction_helpers.js';
import { makeJunction } from './build.js';
import { refId } from './hittest.js';

const eq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const key = (p: Vec2): string => `${p.x},${p.y}`;

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
 * `SCH_LINE_WIRE_BUS_TOOL::TrimOverLappingWires`: for each moved *non-line*
 * connectable item, any wire that its connection points touch at exactly two
 * places has the span between those two trimmed away.
 *
 * Exactly two: one touch is an ordinary connection, and three or more means the
 * item straddles the wire in a way there is no single span to remove.
 */
export function trimOverlappingWires(
  doc: Schematic,
  ids: ReadonlySet<string>,
  libById: ReadonlyMap<string, LibSymbol>,
): Schematic {
  let out = doc;

  const perItem: Vec2[][] = [];
  const push = (id: string): void => {
    const pts = connectionPoints(doc, libById, new Set([id]));
    if (pts.length > 0) perItem.push(pts);
  };
  // Lines are skipped (`item->Type() == SCH_LINE_T` continues upstream).
  doc.symbols.forEach((s, i) => {
    if (ids.has(refId('symbol', s.uuid, i))) push(refId('symbol', s.uuid, i));
  });
  doc.sheets.forEach((s, i) => {
    if (ids.has(refId('sheet', s.uuid, i))) push(refId('sheet', s.uuid, i));
  });
  doc.busEntries.forEach((b, i) => {
    if (ids.has(refId('busentry', b.uuid, i))) push(refId('busentry', b.uuid, i));
  });

  for (const pts of perItem) {
    // Re-read the lines each time: an earlier trim may have split them.
    for (const line of out.lines.slice()) {
      if (line.kind !== 'wire') continue;
      const hits: Vec2[] = [];
      for (const pt of pts) {
        if (onSegment(pt, line.start, line.end)) hits.push(pt);
        if (hits.length > 2) break;
      }
      if (hits.length === 2) out = trimWire(out, hits[0]!, hits[1]!);
    }
  }
  return out;
}

/**
 * `SCH_SCREEN::GetNeededJunctions`: the points among these items' connections
 * where a junction dot is now required.
 *
 * A moved *line* also picks up every connection point in the rest of the sheet
 * that its new span passes through — that is how dragging a wire across a pin
 * makes the dot appear under it.
 */
export function neededJunctions(
  doc: Schematic,
  ids: ReadonlySet<string>,
  libById: ReadonlyMap<string, LibSymbol>,
): Vec2[] {
  const pts: Vec2[] = connectionPoints(doc, libById, ids).slice();

  const movedLines = doc.lines.filter((l, i) => ids.has(refId('line', l.uuid, i)));
  if (movedLines.length > 0) {
    // GetConnections(): every connection point on the sheet.
    const all = connectionPoints(
      doc,
      libById,
      new Set([
        ...doc.symbols.map((s, i) => refId('symbol', s.uuid, i)),
        ...doc.lines.map((l, i) => refId('line', l.uuid, i)),
        ...doc.junctions.map((j, i) => refId('junction', j.uuid, i)),
        ...doc.labels.map((l, i) => refId('label', l.uuid, i)),
        ...(doc.directiveLabels ?? []).map((d, i) => refId('directive', d.uuid, i)),
        ...doc.noConnects.map((n, i) => refId('noconnect', n.uuid, i)),
        ...doc.sheets.map((s, i) => refId('sheet', s.uuid, i)),
        ...doc.busEntries.map((b, i) => refId('busentry', b.uuid, i)),
      ]),
    );
    for (const line of movedLines)
      for (const pt of all) if (onSegment(pt, line.start, line.end)) pts.push(pt);
  }

  // Drop duplicates, then keep only the points that actually need a dot.
  const seen = new Set<string>();
  const out: Vec2[] = [];
  for (const p of pts) {
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    if (isExplicitJunctionNeeded(doc, libById, p)) out.push(p);
  }
  return out;
}

/** `SCH_LINE_WIRE_BUS_TOOL::AddJunctionsIfNeeded` over a set of items. */
export function addJunctionsIfNeeded(
  doc: Schematic,
  ids: ReadonlySet<string>,
  libById: ReadonlyMap<string, LibSymbol>,
): Schematic {
  const wanted = neededJunctions(doc, ids, libById);
  const have = new Set(doc.junctions.map((j) => key(j.at)));
  const add = wanted.filter((p) => !have.has(key(p)));
  if (add.length === 0) return doc;
  return { ...doc, junctions: [...doc.junctions, ...add.map((p) => makeJunction(p))] };
}

/**
 * The `aInternalPoints` loop: a junction at each point the moved items left
 * behind, if what remains there still needs one.
 *
 * Moving one of three wires off a tee leaves the other two crossing without a
 * dot; upstream puts the dot in as the move commits rather than waiting for the
 * next edit.
 */
export function junctionsAtVacatedPoints(
  doc: Schematic,
  points: readonly Vec2[],
  libById: ReadonlyMap<string, LibSymbol>,
): Schematic {
  const have = new Set(doc.junctions.map((j) => key(j.at)));
  const add: Vec2[] = [];
  for (const p of points) {
    if (have.has(key(p))) continue;
    if (!isExplicitJunctionNeeded(doc, libById, p)) continue;
    have.add(key(p));
    add.push(p);
  }
  if (add.length === 0) return doc;
  return { ...doc, junctions: [...doc.junctions, ...add.map((p) => makeJunction(p))] };
}

/**
 * `SCH_MOVE_TOOL::trimDanglingLines`: remove the wires a drag left hanging.
 *
 * Two kinds go, and only these two:
 *  - a wire that was *broken* by the drag and is now dangling, since the split
 *    left it running past the break point;
 *  - a *new* rubber-band stub with both ends dangling, which connects nothing.
 *
 * A wire with one end still connected is carrying a connection and stays, and
 * anything still selected is left alone (upstream returns early on
 * `aChangedItem->IsSelected()`).
 */
export function trimDanglingLines(
  doc: Schematic,
  brokenUuids: ReadonlySet<string>,
  newUuids: ReadonlySet<string>,
  libById: Map<string, LibSymbol>,
  selected: ReadonlySet<string> = new Set(),
): Schematic {
  const dangles = wireDangleStates(doc, libById);

  const doomed = new Set<number>();
  doc.lines.forEach((l, i) => {
    if (l.kind !== 'wire') return;
    if (selected.has(refId('line', l.uuid, i))) return;
    const d = dangles.get(i);
    if (!d) return;
    if (l.uuid === undefined) return;
    if (brokenUuids.has(l.uuid)) {
      if (d.start || d.end) doomed.add(i);
    } else if (newUuids.has(l.uuid) && d.start && d.end) {
      doomed.add(i);
    }
  });
  if (doomed.size === 0) return doc;
  return { ...doc, lines: doc.lines.filter((_l, i) => !doomed.has(i)) };
}

/** Which wires the drop changed, beyond the selection itself. */
export interface DragSet {
  /** Stub wires the drag created (`m_newDragLines`). */
  readonly newLineUuids: ReadonlySet<string>;
  /** Wires whose endpoint the drag moved (`m_changedDragLines`). */
  readonly changedLineUuids: ReadonlySet<string>;
  /** Wires the drag split (`IS_BROKEN`). */
  readonly brokenLineUuids: ReadonlySet<string>;
  /** Points the moved items left behind (`aInternalPoints`). */
  readonly vacatedPoints: readonly Vec2[];
}

/**
 * Work out the drag set by comparing the sheet before and after the move.
 *
 * Upstream tracks it with flags as the drag runs (`m_newDragLines`,
 * `m_changedDragLines`, `IS_BROKEN`). Our move is a pure function producing a
 * new document, so the same three sets fall out of a diff: wires that appeared,
 * wires whose geometry changed, and — from the plan — the wires a label split.
 * That also catches the extra bend segments an orthogonal drag creates, which
 * never appear in the plan.
 */
export function dragSetFromMove(
  before: Schematic,
  after: Schematic,
  spec: { readonly splits: readonly { readonly lineUuid: string; readonly newUuid: string }[] },
  libById: ReadonlyMap<string, LibSymbol>,
  selection: ReadonlySet<string>,
): DragSet {
  const broken = new Set<string>();
  for (const s of spec.splits) {
    broken.add(s.lineUuid);
    broken.add(s.newUuid);
  }

  const wasThere = new Map<string, string>();
  for (const l of before.lines)
    if (l.uuid !== undefined) wasThere.set(l.uuid, `${key(l.start)}|${key(l.end)}`);

  const newLineUuids = new Set<string>();
  const changedLineUuids = new Set<string>();
  for (const l of after.lines) {
    if (l.uuid === undefined) continue;
    const geo = wasThere.get(l.uuid);
    // A split half is broken, not new: trimDanglingLines treats the two
    // differently (a broken line goes on *either* end dangling).
    if (geo === undefined) {
      if (!broken.has(l.uuid)) newLineUuids.add(l.uuid);
    } else if (geo !== `${key(l.start)}|${key(l.end)}`) {
      changedLineUuids.add(l.uuid);
    }
  }

  return {
    newLineUuids,
    changedLineUuids,
    brokenLineUuids: broken,
    // The selection's connection points *before* it moved: what it vacated.
    vacatedPoints: connectionPoints(before, libById, selection),
  };
}

/**
 * The whole post-drop block, in upstream's order, over the document the move
 * already produced.
 *
 * `dragLike` is upstream's `isDragLike && !isSlice`: a plain move (M) leaves
 * wires behind by design, so its stubs are not trimmed.
 */
export function postMoveCleanup(
  doc: Schematic,
  selection: ReadonlySet<string>,
  drag: DragSet,
  libById: Map<string, LibSymbol>,
  dragLike: boolean,
): Schematic {
  let out = junctionsAtVacatedPoints(doc, drag.vacatedPoints, libById);

  // The drag set: the selection plus the wires the drag made or reshaped.
  const dragIds = new Set(selection);
  out.lines.forEach((l, i) => {
    if (l.uuid === undefined) return;
    if (drag.newLineUuids.has(l.uuid) || drag.changedLineUuids.has(l.uuid))
      dragIds.add(refId('line', l.uuid, i));
  });

  out = trimOverlappingWires(out, dragIds, libById);
  out = addJunctionsIfNeeded(out, dragIds, libById);
  if (dragLike)
    out = trimDanglingLines(out, drag.brokenLineUuids, drag.newLineUuids, libById, selection);
  // AutoRotateItem would come next; see the note at the top of this file.
  return out;
}

/**
 * Wrap a move command so the post-drop block runs inside the same undoable
 * step, as it does inside upstream's `SCH_COMMIT`.
 *
 * `dragLike` is false for a plain move (M), which leaves connected wires behind
 * by design and so must not have its stubs trimmed.
 *
 * Undo restores the pre-move document wholesale. The cleanup deletes and adds
 * wires that the move command itself knows nothing about, so its own inverse
 * can no longer describe the way back — the same reason `withCleanup` snapshots.
 */
export function withPostMoveCleanup(
  cmd: EditCommand,
  spec: MoveSpec,
  libById: Map<string, LibSymbol>,
  selection: ReadonlySet<string>,
  dragLike: boolean,
): EditCommand {
  return {
    label: cmd.label,
    apply(doc: Schematic): Schematic {
      const moved = cmd.apply(doc);
      const drag = dragSetFromMove(doc, moved, spec, libById, selection);
      return postMoveCleanup(moved, selection, drag, libById, dragLike);
    },
    invert(before: Schematic): EditCommand {
      return {
        label: cmd.label,
        apply: () => before,
        invert: () => withPostMoveCleanup(cmd, spec, libById, selection, dragLike),
      };
    },
  };
}
