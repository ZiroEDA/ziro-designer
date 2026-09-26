// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Unfold Bus (C). Counterpart: `SCH_LINE_WIRE_BUS_TOOL::UnfoldBus` and
 * `doUnfoldBus` (eeschema/tools/sch_line_wire_bus_tool.cpp), with the member
 * list that `BUS_UNFOLD_MENU` offers.
 *
 * Pulling one signal out of a bus is three items placed together: a bus entry
 * on the bus, a label naming the member at the entry's far end, and a wire the
 * user then draws away from it. Doing that by hand means placing an entry,
 * getting it exactly on the bus, and typing the member name correctly; the
 * point of the tool is that none of those can go wrong.
 *
 * The entry lands on the bus segment's nearest point rather than at the cursor.
 * A bus entry that is merely *near* the bus is not connected to it, and the
 * whole unfold would silently produce a floating net.
 */

import type { Schematic, SchLine, Vec2 } from '../types.js';
import { expandBusLabel } from '../connectivity/bus.js';
import { makeBusEntry, DEFAULT_ENTRY_SIZE } from './build-graphics.js';
import { makeLabel } from './build.js';
import { refId } from './hittest.js';
import type { EditCommand } from './command.js';

/** The nearest point on a segment to `p` (SEG::NearestPoint). */
export function nearestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { ...a };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: Math.round(a.x + t * dx), y: Math.round(a.y + t * dy) };
}

/**
 * The members a bus line carries, which is what `BUS_UNFOLD_MENU` lists.
 *
 * A bus takes its members from the label naming it, so a bus with no label
 * carries nothing that can be named and the menu is empty. Labels are matched
 * by touching the line, the same way connectivity matches them.
 */
export function busUnfoldMembers(
  doc: Schematic,
  busIndex: number,
  aliases?: ReadonlyMap<string, readonly string[]>,
): string[] {
  const bus = doc.lines[busIndex];
  if (!bus || bus.kind !== 'bus') return [];

  const onLine = (p: Vec2): boolean => {
    const near = nearestPointOnSegment(p, bus.start, bus.end);
    return near.x === p.x && near.y === p.y;
  };

  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of doc.labels) {
    if (!onLine(l.at)) continue;
    const info = expandBusLabel(l.text, aliases);
    if (!info) continue;
    for (const m of info.members) {
      if (seen.has(m)) continue;
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

/** Where the unfolded wire starts, so the caller can begin drawing from it. */
export interface BusUnfold {
  command: EditCommand;
  /** The bus entry's far end: the label's position and the wire's start. */
  wireStart: Vec2;
}

/**
 * Unfold `net` out of the bus at `at`: a bus entry on the bus, and a label
 * naming the member at its far end.
 *
 * The entry's direction follows which side of the bus the cursor is on, so
 * unfolding downward from a horizontal bus does not run the entry back up
 * through it.
 */
export function unfoldBus(
  doc: Schematic,
  busIndex: number,
  at: Vec2,
  net: string,
  defaultTextSize?: number,
): BusUnfold | null {
  const bus = doc.lines[busIndex];
  if (!bus || bus.kind !== 'bus' || net === '') return null;

  // The entry has to be *on* the bus, not near it, or nothing connects.
  const origin = nearestPointOnSegment(at, bus.start, bus.end);

  // Away from the bus, on the side the cursor was: a horizontal bus unfolds up
  // or down, a vertical one left or right, and a diagonal takes the default.
  const horizontal = bus.start.y === bus.end.y;
  const vertical = bus.start.x === bus.end.x;
  const size: Vec2 = horizontal
    ? { x: DEFAULT_ENTRY_SIZE, y: at.y < origin.y ? -DEFAULT_ENTRY_SIZE : DEFAULT_ENTRY_SIZE }
    : vertical
      ? { x: at.x < origin.x ? -DEFAULT_ENTRY_SIZE : DEFAULT_ENTRY_SIZE, y: DEFAULT_ENTRY_SIZE }
      : { x: DEFAULT_ENTRY_SIZE, y: DEFAULT_ENTRY_SIZE };

  const entry = makeBusEntry(origin, size);
  const wireStart: Vec2 = { x: origin.x + size.x, y: origin.y + size.y };
  const label = makeLabel('label', net, wireStart, {
    ...(defaultTextSize ? { fontSize: defaultTextSize } : {}),
  });

  return {
    wireStart,
    command: {
      label: 'Unfold from Bus',
      apply(d: Schematic): Schematic {
        return { ...d, busEntries: [...d.busEntries, entry], labels: [...d.labels, label] };
      },
      invert(before: Schematic): EditCommand {
        return {
          label: 'Unfold from Bus',
          apply: (d: Schematic): Schematic => ({
            ...d,
            busEntries: before.busEntries,
            labels: before.labels,
          }),
          invert: () => unfoldBus(doc, busIndex, at, net, defaultTextSize)!.command,
        };
      },
    },
  };
}

/** The bus line under `p`, if any: what the C hotkey unfolds from. */
export function busForUnfolding(doc: Schematic, p: Vec2, tolerance: number): number {
  let best = -1;
  let bestD = tolerance;
  doc.lines.forEach((l: SchLine, i) => {
    if (l.kind !== 'bus') return;
    const near = nearestPointOnSegment(p, l.start, l.end);
    const d = Math.hypot(near.x - p.x, near.y - p.y);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Selection id of a bus line, for callers that work from a selection. */
export const busLineId = (doc: Schematic, index: number): string =>
  refId('line', doc.lines[index]?.uuid, index);
