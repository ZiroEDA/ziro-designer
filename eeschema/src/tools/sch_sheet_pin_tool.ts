// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Editing a sheet's hierarchical pins. Counterpart: `eeschema/sch_sheet_pin.cpp`
 * (SCH_SHEET_PIN::ConstrainOnEdge / SetSide) and the SCH_SHEET_PIN_T branches of
 * `SCH_MOVE_TOOL`.
 *
 * A sheet pin is a port on the sheet's border, not a free item: it cannot leave
 * the rectangle. Dragging one runs `ConstrainOnEdge(pos, true)`, which picks the
 * border segment nearest the cursor, moves the pin to that edge, and clamps it
 * along the edge's length. Letting go on a different edge therefore *switches*
 * edges, which is how a pin is moved round a corner, and the pin's angle (the
 * file's side encoding) changes with it.
 *
 * Anything attached to the pin follows it, the same way a sheet resize brings
 * its wires along: a pin that is not connected to what it was is a silently
 * broken hierarchy.
 */

import type { Schematic, SchSheet, SheetPin, Vec2 } from '../types.js';
import { refId, sheetPinId } from './hittest.js';
import type { EditCommand } from './command.js';

/**
 * Which border a pin sits on, by name. The file stores it as an angle (the pin's
 * spin style), which `SheetSide` in build-graphics.ts already names; this is the
 * readable form the geometry below works in.
 */
export type SheetEdge = 'right' | 'top' | 'left' | 'bottom';

export const sideOfAngle = (angle: number): SheetEdge =>
  angle === 90 ? 'top' : angle === 180 ? 'left' : angle === 270 ? 'bottom' : 'right';

export const angleOfSide = (side: SheetEdge): number =>
  side === 'top' ? 90 : side === 'left' ? 180 : side === 'bottom' ? 270 : 0;

/** A sheet pin addressed the way the netlist and hit test address it. */
export interface SheetPinRef {
  sheet: number;
  pin: number;
}

/** Parse `<sheetRefId>:sheetpin<k>` back to the sheet and pin it names. */
export function parseSheetPinId(doc: Schematic, id: string): SheetPinRef | null {
  const m = /^(.*):sheetpin(\d+)$/.exec(id);
  if (!m) return null;
  const sheet = doc.sheets.findIndex((s, i) => refId('sheet', s.uuid, i) === m[1]);
  const pin = Number(m[2]);
  if (sheet === -1 || !doc.sheets[sheet]!.pins[pin]) return null;
  return { sheet, pin };
}

const dist2ToSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return (p.x - (a.x + t * dx)) ** 2 + (p.y - (a.y + t * dy)) ** 2;
};

/**
 * `SCH_SHEET_PIN::ConstrainOnEdge`. With `allowEdgeSwitch` the pin moves to
 * whichever border segment is nearest the cursor; without it, it stays on the
 * side it is already on. Either way it is clamped inside the sheet's bounds,
 * because a port that has slid off the border connects to nothing.
 *
 * The segments are walked in the order upstream appends them: top, right,
 * bottom, left.
 */
export function constrainOnEdge(
  sheet: SchSheet,
  pin: SheetPin,
  at: Vec2,
  allowEdgeSwitch: boolean,
): SheetPin {
  const left = sheet.at.x;
  const right = sheet.at.x + sheet.size.w;
  const top = sheet.at.y;
  const bottom = sheet.at.y + sheet.size.h;

  let side = sideOfAngle(pin.angle);
  if (allowEdgeSwitch) {
    const corners: [Vec2, Vec2, SheetEdge][] = [
      [{ x: left, y: top }, { x: right, y: top }, 'top'],
      [{ x: right, y: top }, { x: right, y: bottom }, 'right'],
      [{ x: right, y: bottom }, { x: left, y: bottom }, 'bottom'],
      [{ x: left, y: bottom }, { x: left, y: top }, 'left'],
    ];
    let best = Number.POSITIVE_INFINITY;
    for (const [a, b, s] of corners) {
      const d = dist2ToSegment(at, a, b);
      if (d < best) {
        best = d;
        side = s;
      }
    }
  }

  const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
  const pos: Vec2 =
    side === 'left'
      ? { x: left, y: clamp(at.y, top, bottom) }
      : side === 'right'
        ? { x: right, y: clamp(at.y, top, bottom) }
        : side === 'top'
          ? { x: clamp(at.x, left, right), y: top }
          : { x: clamp(at.x, left, right), y: bottom };

  return { ...pin, at: pos, angle: angleOfSide(side) };
}

const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/**
 * Move a sheet pin to `at`, constrained to its sheet's border, bringing along
 * whatever was connected to it.
 */
export function moveSheetPin(doc: Schematic, ref: SheetPinRef, at: Vec2): Schematic {
  const sheet = doc.sheets[ref.sheet];
  const pin = sheet?.pins[ref.pin];
  if (!sheet || !pin) return doc;

  const moved = constrainOnEdge(sheet, pin, at, true);
  if (same(moved.at, pin.at) && moved.angle === pin.angle) return doc;

  const from = pin.at;
  const to = moved.at;
  const sheets = doc.sheets.map((s, i) =>
    i === ref.sheet ? { ...s, pins: s.pins.map((p, k) => (k === ref.pin ? moved : p)) } : s,
  );

  // Wires and no-connects that were sitting on the pin come with it, or the
  // hierarchy is quietly broken while still looking connected.
  let lines = doc.lines;
  if (
    lines.some(
      (l) => (l.kind === 'wire' || l.kind === 'bus') && (same(l.start, from) || same(l.end, from)),
    )
  )
    lines = lines.map((l) => {
      if (l.kind !== 'wire' && l.kind !== 'bus') return l;
      const start = same(l.start, from) ? to : l.start;
      const end = same(l.end, from) ? to : l.end;
      return start === l.start && end === l.end ? l : { ...l, start, end };
    });

  let noConnects = doc.noConnects;
  if (noConnects.some((nc) => same(nc.at, from)))
    noConnects = noConnects.map((nc) => (same(nc.at, from) ? { ...nc, at: to } : nc));

  return { ...doc, sheets, lines, noConnects };
}

/** One undo step for a completed sheet-pin drag. */
export function moveSheetPinCommand(after: Schematic): EditCommand {
  return {
    label: 'Move Sheet Pin',
    apply(doc: Schematic): Schematic {
      const out = { ...doc, sheets: after.sheets };
      return {
        ...out,
        ...(after.lines !== doc.lines ? { lines: after.lines } : {}),
        ...(after.noConnects !== doc.noConnects ? { noConnects: after.noConnects } : {}),
      };
    },
    invert: (before: Schematic) => moveSheetPinCommand(before),
  };
}

/** Replace a sheet pin outright (its name, shape, or text attributes). */
export function replaceSheetPin(ref: SheetPinRef, next: SheetPin): EditCommand {
  return {
    label: 'Edit Sheet Pin',
    apply(doc: Schematic): Schematic {
      const sheet = doc.sheets[ref.sheet];
      if (!sheet) return doc;
      return {
        ...doc,
        sheets: doc.sheets.map((s, i) =>
          i === ref.sheet ? { ...s, pins: s.pins.map((p, k) => (k === ref.pin ? next : p)) } : s,
        ),
      };
    },
    invert(before: Schematic): EditCommand {
      return replaceSheetPin(ref, before.sheets[ref.sheet]!.pins[ref.pin]!);
    },
  };
}

/** Delete a sheet pin (Del on a selected pin). */
export function deleteSheetPin(ref: SheetPinRef): EditCommand {
  return {
    label: 'Delete Sheet Pin',
    apply(doc: Schematic): Schematic {
      const sheet = doc.sheets[ref.sheet];
      if (!sheet) return doc;
      return {
        ...doc,
        sheets: doc.sheets.map((s, i) =>
          i === ref.sheet ? { ...s, pins: s.pins.filter((_, k) => k !== ref.pin) } : s,
        ),
      };
    },
    invert(before: Schematic): EditCommand {
      const pin = before.sheets[ref.sheet]!.pins[ref.pin]!;
      return {
        label: 'Delete Sheet Pin',
        apply: (doc: Schematic): Schematic => ({
          ...doc,
          sheets: doc.sheets.map((s, i) =>
            i === ref.sheet
              ? { ...s, pins: [...s.pins.slice(0, ref.pin), pin, ...s.pins.slice(ref.pin)] }
              : s,
          ),
        }),
        invert: () => deleteSheetPin(ref),
      };
    },
  };
}

/**
 * `SCH_SHEET::CleanupSheet`: drop the pins that no longer name a hierarchical
 * label inside the sheet.
 *
 * A sheet pin is the parent's end of a connection whose other end is a
 * hierarchical label in the child. Rename or delete the label and the pin is
 * left connecting to nothing, which ERC reports but nothing removes. This is
 * the removal, and it matches names case-insensitively, as upstream's
 * CmpNoCase does.
 *
 * `childLabels` is the hierarchical labels of the sheet's own document, which
 * the caller reads: a sheet's contents live in another file.
 */
export function cleanupSheetPins(
  doc: Schematic,
  sheetIndex: number,
  childLabels: readonly string[],
): EditCommand | null {
  const sheet = doc.sheets[sheetIndex];
  if (!sheet) return null;
  const keep = new Set(childLabels.map((t) => t.toLowerCase()));
  const pins = sheet.pins.filter((p) => keep.has(p.name.toLowerCase()));
  if (pins.length === sheet.pins.length) return null;

  return {
    label: 'Cleanup Sheet Pins',
    apply(d: Schematic): Schematic {
      return {
        ...d,
        sheets: d.sheets.map((s, i) => (i === sheetIndex ? { ...s, pins } : s)),
      };
    },
    invert(before: Schematic): EditCommand {
      const original = before.sheets[sheetIndex]!.pins;
      return {
        label: 'Cleanup Sheet Pins',
        apply: (d: Schematic): Schematic => ({
          ...d,
          sheets: d.sheets.map((s, i) => (i === sheetIndex ? { ...s, pins: original } : s)),
        }),
        invert: () => cleanupSheetPins(doc, sheetIndex, childLabels)!,
      };
    },
  };
}

/** The hierarchical labels of a document, the names a sheet's pins must match. */
export const hierarchicalLabelNames = (doc: Schematic): string[] =>
  doc.labels.filter((l) => l.kind === 'hierarchical_label').map((l) => l.text);

/** Every sheet pin's selection id, for the selection filter and box select. */
export function allSheetPinIds(doc: Schematic): string[] {
  return doc.sheets.flatMap((s, i) =>
    s.pins.map((_, k) => sheetPinId(refId('sheet', s.uuid, i), k)),
  );
}
