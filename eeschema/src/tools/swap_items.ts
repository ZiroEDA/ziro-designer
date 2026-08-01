// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Swap (Alt+S). Counterpart: `SCH_EDIT_TOOL::Swap`
 * (eeschema/tools/sch_edit_tool.cpp).
 *
 * With two items selected this exchanges their positions, which is the obvious
 * reading. With more it is a *rotation*: upstream walks the selection swapping
 * each item with the next, so the positions cycle round rather than the first
 * and last exchanging. Three items A, B, C end up at B's, C's and A's places.
 *
 * Some kinds carry orientation with their position and would be wrong without
 * it: a sheet pin swapped to the opposite border keeps pointing the way it did,
 * and a label swapped across a junction reads back into the wire it came from.
 * So sides and spin styles travel with the positions.
 */

import type { Schematic, Vec2 } from '../types.js';
import { refId } from './hittest.js';
import { moveItems } from './move.js';
import { parseSheetPinId } from './sch_sheet_pin_tool.js';
import { composeCommands, type EditCommand } from './command.js';

/** What a swap can move, and where it currently is. */
interface Swappable {
  id: string;
  at: Vec2;
  /** Label kind or 'sheetpin', for the extras that travel with the position. */
  kind: string;
  /** The stored angle, which is a label's spin style and a pin's side. */
  angle: number;
  /** Sheet pins may only swap among pins of the same sheet. */
  sheet?: number;
}

/**
 * The selected items a swap can act on, in selection order.
 *
 * JavaScript Sets iterate in insertion order, so the selection's own order is
 * the order the user built it in, which is what
 * `GetItemsSortedBySelectionOrder` gives upstream.
 */
export function swappableItems(doc: Schematic, ids: ReadonlySet<string>): Swappable[] {
  const byId = new Map<string, Swappable>();
  const add = (s: Swappable): void => {
    if (ids.has(s.id)) byId.set(s.id, s);
  };

  doc.symbols.forEach((s, i) =>
    add({ id: refId('symbol', s.uuid, i), at: s.at, kind: 'symbol', angle: s.angle }),
  );
  doc.labels.forEach((l, i) =>
    add({ id: refId('label', l.uuid, i), at: l.at, kind: l.kind, angle: l.angle }),
  );
  (doc.directiveLabels ?? []).forEach((d, i) =>
    add({ id: refId('directive', d.uuid, i), at: d.at, kind: 'directive', angle: d.angle }),
  );
  doc.junctions.forEach((j, i) =>
    add({ id: refId('junction', j.uuid, i), at: j.at, kind: 'junction', angle: 0 }),
  );
  doc.noConnects.forEach((n, i) =>
    add({ id: refId('noconnect', n.uuid, i), at: n.at, kind: 'noconnect', angle: 0 }),
  );
  doc.busEntries.forEach((b, i) =>
    add({ id: refId('busentry', b.uuid, i), at: b.at, kind: 'busentry', angle: 0 }),
  );
  doc.sheets.forEach((s, i) => {
    const shId = refId('sheet', s.uuid, i);
    add({ id: shId, at: s.at, kind: 'sheet', angle: 0 });
    s.pins.forEach((p, k) =>
      add({ id: `${shId}:sheetpin${k}`, at: p.at, kind: 'sheetpin', angle: p.angle, sheet: i }),
    );
  });
  doc.textBoxes.forEach((t, i) =>
    add({ id: refId('textbox', t.uuid, i), at: t.start, kind: 'textbox', angle: t.angle }),
  );
  doc.images.forEach((im, i) =>
    add({ id: refId('image', im.uuid, i), at: im.at, kind: 'image', angle: 0 }),
  );

  // Selection order, not document order.
  const out: Swappable[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Swap the selection's positions. Two items exchange; more than two rotate.
 *
 * A selection containing sheet pins may contain *only* sheet pins, and only
 * ones from the same sheet: a pin is constrained to its own sheet's border, so
 * swapping it onto another sheet would put it somewhere it cannot be.
 */
export function swapItems(doc: Schematic, ids: ReadonlySet<string>): EditCommand | null {
  const items = swappableItems(doc, ids);
  if (items.length < 2) return null;

  const pins = items.filter((i) => i.kind === 'sheetpin');
  if (pins.length > 0) {
    if (pins.length !== items.length) return null;
    const sheet = pins[0]!.sheet;
    if (pins.some((p) => p.sheet !== sheet)) return null;
  }

  // Each item takes the next one's place, so the positions cycle.
  const target = items.map((_, i) => items[(i + 1) % items.length]!);
  const cmds: EditCommand[] = [];

  for (let i = 0; i < items.length; i++) {
    const from = items[i]!;
    const to = target[i]!;
    // A sheet pin is not moved by a delta: it belongs to its sheet, so
    // moveItems would move the whole sheet. Its placement is set below,
    // alongside its side, the way SetPosition and SetSide are used upstream.
    if (from.kind === 'sheetpin') continue;
    const delta = { x: to.at.x - from.at.x, y: to.at.y - from.at.y };
    if (delta.x !== 0 || delta.y !== 0) cmds.push(moveItems(new Set([from.id]), delta));
  }

  // Orientation travels with the position for the kinds that carry it, or a
  // swapped pin points off the wrong edge and a swapped label reads backwards.
  const placements = items
    .map((from, i) => ({ from, at: target[i]!.at, angle: target[i]!.angle }))
    .filter(
      (p) =>
        (from2(p) && ORIENTED.has(p.from.kind)) ||
        (p.from.kind === 'sheetpin' && (p.at.x !== p.from.at.x || p.at.y !== p.from.at.y)),
    );
  if (placements.length)
    cmds.push(
      setPlacementsCommand(
        placements.map((p) => ({
          id: p.from.id,
          angle: p.angle,
          ...(p.from.kind === 'sheetpin' ? { at: p.at } : {}),
        })),
      ),
    );

  if (cmds.length === 0) return null;
  return composeCommands('Swap', cmds);
}

/** Kinds whose stored angle is an orientation the swap must carry. */
const ORIENTED = new Set([
  'sheetpin',
  'label',
  'global_label',
  'hierarchical_label',
  'text',
  'directive',
]);

/** True when the item's stored angle actually changes. */
const from2 = (p: { from: Swappable; angle: number }): boolean => p.angle !== p.from.angle;

/** One placement a swap applies: a new angle, and for a sheet pin a position too. */
interface Placement {
  id: string;
  angle: number;
  at?: Vec2;
}

/**
 * Set several items' orientations, and sheet pins' positions, in one step.
 * Sheet pins go here rather than through moveItems because they belong to their
 * sheet: a delta applied to a pin id would move the whole sheet.
 */
function setPlacementsCommand(placements: Placement[]): EditCommand {
  const wanted = new Map(placements.map((p) => [p.id, p]));
  return {
    label: 'Swap',
    apply(d: Schematic): Schematic {
      const labels = d.labels.map((l, i) => {
        const w = wanted.get(refId('label', l.uuid, i));
        return !w || w.angle === l.angle ? l : { ...l, angle: w.angle };
      });
      const directiveLabels = (d.directiveLabels ?? []).map((x, i) => {
        const w = wanted.get(refId('directive', x.uuid, i));
        return !w || w.angle === x.angle ? x : { ...x, angle: w.angle };
      });
      const sheets = d.sheets.map((s, i) => {
        const shId = refId('sheet', s.uuid, i);
        let touched = false;
        const pins = s.pins.map((p, k) => {
          const w = wanted.get(`${shId}:sheetpin${k}`);
          if (!w) return p;
          const at = w.at ?? p.at;
          if (w.angle === p.angle && at.x === p.at.x && at.y === p.at.y) return p;
          touched = true;
          return { ...p, angle: w.angle, at };
        });
        return touched ? { ...s, pins } : s;
      });
      return { ...d, labels, directiveLabels, sheets };
    },
    invert(before: Schematic): EditCommand {
      const back: Placement[] = [];
      for (const { id } of placements) {
        const sp = parseSheetPinId(before, id);
        if (sp) {
          const p = before.sheets[sp.sheet]!.pins[sp.pin]!;
          back.push({ id, angle: p.angle, at: p.at });
          continue;
        }
        const li = before.labels.findIndex((l, i) => refId('label', l.uuid, i) === id);
        if (li !== -1) {
          back.push({ id, angle: before.labels[li]!.angle });
          continue;
        }
        const di = (before.directiveLabels ?? []).findIndex(
          (x, i) => refId('directive', x.uuid, i) === id,
        );
        if (di !== -1) back.push({ id, angle: before.directiveLabels![di]!.angle });
      }
      return setPlacementsCommand(back);
    },
  };
}

/** Whether Alt+S has anything to do, for greying the menu item. */
export const canSwap = (doc: Schematic, ids: ReadonlySet<string>): boolean =>
  swapItems(doc, ids) !== null;
