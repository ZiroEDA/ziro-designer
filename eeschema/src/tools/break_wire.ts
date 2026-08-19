// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Break Wire and Slice. Counterparts:
 * `SCH_MOVE_TOOL::preprocessBreakOrSliceSelection` and the `BREAK` / `SLICE`
 * arms of `SCH_MOVE_TOOL::Main` (eeschema/tools/sch_move_tool.cpp),
 * `SCH_LINE_WIRE_BUS_TOOL::BreakSegment` (eeschema/tools/sch_line_wire_bus_tool.cpp)
 * and `SCH_LINE::BreakAt` (eeschema/sch_line.cpp).
 *
 * Both actions split a selected segment in two and then immediately start a
 * drag; they are not standalone edits, which is why upstream routes them
 * through the *move* tool rather than the edit tool. The only difference
 * between them is what ends up selected afterwards, and that difference is the
 * whole feature:
 *
 *  - **Break** ("Divide into connected segments") selects *both* halves, the
 *    original by its new end and the new one by its new start. The two inner
 *    ends are therefore dragged together and the wire stays electrically whole
 *    — you get a corner where there was a straight run.
 *  - **Slice** ("Divide into unconnected segments") selects only the original
 *    half. Its end drags away and the new half stays put, so the net is cut.
 *
 * `SCH_LINE::BreakAt` is deliberately blunt: it duplicates the segment, sets
 * the copy's start to the break point and the original's end to the same point.
 * It does not check that the point lies on the segment, and neither do we —
 * upstream passes the *grid-snapped* cursor, which on a fine grid can sit
 * slightly off an angled wire, and the result is a bent pair that the drag then
 * resolves. Clamping it onto the segment would be a different tool.
 *
 * Which point is used follows upstream's `useCursorForSingleLine`: break one
 * selected segment at the cursor, but break several at their own midpoints,
 * since one cursor cannot be on all of them.
 *
 * Not modelled: upstream's re-entrant case, where Break is invoked again
 * without leaving the move tool and skips segments already placed
 * (`IS_BROKEN && !IS_NEW`). Those flags are live tool state rather than
 * anything in the file, and our move is a single command rather than a
 * standing tool, so each invocation starts from the committed document.
 */

import type { Schematic, SchLine, Vec2 } from '../types.js';
import { refId } from './hittest.js';
import { nodeWithUuid } from './build.js';
import { newKiid } from '@ziroeda/common/src/kiid.js';
import type { MoveSpec } from './connect.js';
import type { EditCommand } from './command.js';

/** `SCH_MOVE_TOOL::MOVE_MODE`, restricted to the two split modes. */
export type BreakMode = 'break' | 'slice';

export interface BreakPlan {
  /** The split itself. Apply this, then start a drag with the ids below. */
  readonly command: EditCommand;
  /**
   * Segments whose **end** the drag carries — `ENDPOINT` upstream. Always the
   * original halves, in both modes.
   */
  readonly dragEnd: readonly string[];
  /**
   * Segments whose **start** the drag carries — `STARTPOINT`. The new halves,
   * and only in break mode; slice leaves them unselected so the net parts.
   */
  readonly dragStart: readonly string[];
  /**
   * Where the drag begins. Upstream stores this in `m_breakPos` and seeds
   * `m_cursor` from it so the very first motion is measured from the break
   * rather than from wherever the pointer happened to be.
   */
  readonly at: Vec2 | null;
  /**
   * The drag to run against the *split* document.
   *
   * It carries nothing but the two flag sets, which is the whole of what
   * upstream's selection holds after `preprocessBreakOrSliceSelection`: a fresh
   * break point sits mid-span, so there is no junction, pin or label there to
   * pick up. Anything that later lands on that point is the post-drop cleanup's
   * business, not the plan's.
   */
  readonly spec: MoveSpec;
}

/** `SCH_LINE::GetMidPoint`. */
export const segmentMidPoint = (line: SchLine): Vec2 => ({
  x: Math.round((line.start.x + line.end.x) / 2),
  y: Math.round((line.start.y + line.end.y) / 2),
});

/**
 * The segments a break acts on: every selected line, in document order.
 *
 * Upstream takes any `SCH_LINE_T` in the selection, so graphic polylines split
 * as readily as wires and buses — the Slice context-menu entry is enabled for
 * the line tool as well as the wire/bus tool for exactly that reason.
 */
export function breakableLines(
  sch: Schematic,
  ids: ReadonlySet<string>,
): { key: string; index: number; line: SchLine }[] {
  const out: { key: string; index: number; line: SchLine }[] = [];
  sch.lines.forEach((line, index) => {
    const key = refId('line', line.uuid, index);
    if (ids.has(key)) out.push({ key, index, line });
  });
  return out;
}

/** The second half of a split: a duplicate of `line` running break -> old end. */
export function brokenHalf(line: SchLine, at: Vec2): SchLine {
  const uuid = newKiid();
  return { ...line, start: at, end: line.end, uuid, source: nodeWithUuid(line.source, uuid) };
}

/**
 * Split every selected segment, returning the command and the drag that should
 * follow it.
 *
 * Returns `null` when nothing is selected that can be split, which is
 * upstream's early `if( lines.empty() ) return;`.
 */
export function planBreakWire(
  sch: Schematic,
  ids: ReadonlySet<string>,
  cursor: Vec2,
  mode: BreakMode,
): BreakPlan | null {
  const targets = breakableLines(sch, ids);
  if (targets.length === 0) return null;

  // One segment breaks under the cursor; several break at their own midpoints.
  const useCursor = targets.length === 1;

  const shortened = new Map<number, Vec2>();
  const added: SchLine[] = [];
  const dragEnd: string[] = [];
  const dragStart: string[] = [];
  let at: Vec2 | null = null;

  for (const { key, index, line } of targets) {
    const point = useCursor ? cursor : segmentMidPoint(line);
    // `m_breakPos` takes the first break only, and only in break mode.
    if (mode === 'break' && at === null) at = point;

    shortened.set(index, point);
    const half = brokenHalf(line, point);
    added.push(half);

    dragEnd.push(key);
    if (mode === 'break')
      dragStart.push(refId('line', half.uuid, sch.lines.length + added.length - 1));
  }

  return {
    command: splitLinesCommand(mode, shortened, added),
    dragEnd,
    dragStart,
    at: at ?? (useCursor ? cursor : null),
    spec: {
      fullIds: new Set<string>(),
      wireStart: new Set(dragStart),
      wireEnd: new Set(dragEnd),
      newWires: [],
      labelRides: [],
      splits: [],
    },
  };
}

/**
 * Shorten the originals and append their new halves as one undoable step.
 *
 * The inverse restores each original's end point and drops the added halves by
 * index, rather than by uuid: an added half is always at the tail of
 * `doc.lines`, so removing a fixed count from the end is both correct and
 * stable under the index-fallback ids that uuid-less items rely on.
 */
export function splitLinesCommand(
  mode: BreakMode,
  shortened: ReadonlyMap<number, Vec2>,
  added: readonly SchLine[],
): EditCommand {
  const label = mode === 'break' ? 'Break Wire' : 'Slice Wire';
  return {
    label,
    apply(doc: Schematic): Schematic {
      const lines = doc.lines.map((l, i) => {
        const end = shortened.get(i);
        return end ? { ...l, end } : l;
      });
      return { ...doc, lines: [...lines, ...added] };
    },
    invert(before: Schematic): EditCommand {
      const restore = new Map<number, Vec2>();
      for (const i of shortened.keys()) {
        const original = before.lines[i];
        if (original) restore.set(i, original.end);
      }
      return {
        label: `Undo ${label}`,
        apply(doc: Schematic): Schematic {
          const kept = doc.lines.slice(0, doc.lines.length - added.length);
          return {
            ...doc,
            lines: kept.map((l, i) => {
              const end = restore.get(i);
              return end ? { ...l, end } : l;
            }),
          };
        },
        invert(): EditCommand {
          return splitLinesCommand(mode, shortened, added);
        },
      };
    },
  };
}
