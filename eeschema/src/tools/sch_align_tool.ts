// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Align to top / bottom / left / right / middle / centre. Counterpart:
 * `eeschema/tools/sch_align_tool.cpp` (SCH_ALIGN_TOOL).
 *
 * Each item moves on one axis until the chosen edge of its bounding box meets a
 * target value. What makes this more than "take the minimum" is how the target
 * is chosen (`selectTarget`), in this order:
 *
 *   1. an item under the cursor, so you can point at the one to align to;
 *   2. otherwise a locked item, since a locked item will not move and
 *      everything else has to come to it;
 *   3. otherwise the outermost item, which is the first after sorting.
 *
 * Locked items are never moved, only used as the target. And a connectable
 * item's delta is snapped so it lands on the grid (`adjustDeltaForGrid`):
 * aligning a symbol to a text box must not leave its pins between grid points,
 * where nothing will connect to them.
 */

import type { LibSymbol, Schematic, Vec2 } from '../types.js';
import { refId } from './hittest.js';
import { symbolBodyBBox, labelBox, sheetPinBBox, type BBox } from './bbox.js';
import { directiveBox } from './directive_label.js';
import { imageSizeIU } from './image_size.js';
import { moveItems } from './move.js';
import { composeCommands, type EditCommand } from './command.js';

/** The six alignments, named as SCH_ACTIONS names them. */
export type AlignMode = 'top' | 'bottom' | 'left' | 'right' | 'centerX' | 'centerY';

export const ALIGN_LABELS: Record<AlignMode, string> = {
  top: 'Align to Top',
  bottom: 'Align to Bottom',
  left: 'Align to Left',
  right: 'Align to Right',
  centerX: 'Align to Middle',
  centerY: 'Align to Center',
};

/** One selected item: what to move, where it is, and whether it may move. */
export interface ItemBox {
  id: string;
  box: BBox;
  /** The item's own anchor, which the grid snap is applied to. */
  anchor: Vec2;
  /** Locked items act as the target but are never moved. */
  locked: boolean;
  /** Connectable items snap to the grid; graphics and text do not. */
  connectable: boolean;
}

const boxOf = (a: Vec2, b: Vec2): BBox => ({
  minX: Math.min(a.x, b.x),
  minY: Math.min(a.y, b.y),
  maxX: Math.max(a.x, b.x),
  maxY: Math.max(a.y, b.y),
});

/**
 * Every selected item with its bounding box, the same set `SCH_COLLECTOR::
 * MovableItems` collects. Fields and pins are skipped: upstream drops any item
 * whose parent is also selected, and ours are only ever selected alongside it.
 */
export function alignBoxes(
  doc: Schematic,
  ids: ReadonlySet<string> | null,
  libById: Map<string, LibSymbol>,
): ItemBox[] {
  const out: ItemBox[] = [];
  const add = (id: string, box: BBox, anchor: Vec2, connectable: boolean, locked = false): void => {
    // A null id set means "every item", which is what the whole-sheet extent
    // wants; alignment always passes a real selection.
    if (ids === null || ids.has(id)) out.push({ id, box, anchor, locked, connectable });
  };

  doc.symbols.forEach((s, i) =>
    add(
      refId('symbol', s.uuid, i),
      symbolBodyBBox(s, libById.get(s.libId)),
      s.at,
      true,
      !!s.locked,
    ),
  );
  doc.lines.forEach((l, i) =>
    add(refId('line', l.uuid, i), boxOf(l.start, l.end), l.start, l.kind !== 'polyline'),
  );
  doc.junctions.forEach((j, i) => add(refId('junction', j.uuid, i), boxOf(j.at, j.at), j.at, true));
  doc.noConnects.forEach((n, i) =>
    add(refId('noconnect', n.uuid, i), boxOf(n.at, n.at), n.at, true),
  );
  doc.labels.forEach((l, i) => add(refId('label', l.uuid, i), labelBox(l), l.at, true));
  (doc.directiveLabels ?? []).forEach((d, i) =>
    add(refId('directive', d.uuid, i), directiveBox(d), d.at, true),
  );
  doc.busEntries.forEach((b, i) =>
    add(
      refId('busentry', b.uuid, i),
      boxOf(b.at, { x: b.at.x + b.size.x, y: b.at.y + b.size.y }),
      b.at,
      true,
    ),
  );
  doc.sheets.forEach((s, i) => {
    const box = boxOf(s.at, { x: s.at.x + s.size.w, y: s.at.y + s.size.h });
    // A sheet's pins hang off its border, so they are part of its extent.
    for (const p of s.pins) {
      const pb = sheetPinBBox(p);
      box.minX = Math.min(box.minX, pb.minX);
      box.minY = Math.min(box.minY, pb.minY);
      box.maxX = Math.max(box.maxX, pb.maxX);
      box.maxY = Math.max(box.maxY, pb.maxY);
    }
    add(refId('sheet', s.uuid, i), box, s.at, true);
  });
  doc.textBoxes.forEach((t, i) =>
    add(refId('textbox', t.uuid, i), boxOf(t.start, t.end), t.start, false),
  );
  // A table's extent is its cells': the table node itself carries only column
  // widths and row heights, so an empty table has no geometry to align to.
  doc.tables.forEach((t, i) => {
    if (!t.cells.length) return;
    const box: BBox = {
      minX: Math.min(...t.cells.map((c) => Math.min(c.start.x, c.end.x))),
      minY: Math.min(...t.cells.map((c) => Math.min(c.start.y, c.end.y))),
      maxX: Math.max(...t.cells.map((c) => Math.max(c.start.x, c.end.x))),
      maxY: Math.max(...t.cells.map((c) => Math.max(c.start.y, c.end.y))),
    };
    add(refId('table', t.uuid, i), box, { x: box.minX, y: box.minY }, false);
  });
  doc.images.forEach((im, i) => {
    const s = imageSizeIU(im);
    add(
      refId('image', im.uuid, i),
      boxOf(
        { x: im.at.x - s.w / 2, y: im.at.y - s.h / 2 },
        { x: im.at.x + s.w / 2, y: im.at.y + s.h / 2 },
      ),
      im.at,
      false,
    );
  });
  doc.graphics.forEach((g, i) => {
    const id = refId('graphic', undefined, i);
    switch (g.kind) {
      case 'rectangle':
        add(id, boxOf(g.start, g.end), g.start, false);
        break;
      case 'circle':
        add(
          id,
          boxOf(
            { x: g.center.x - g.radius, y: g.center.y - g.radius },
            { x: g.center.x + g.radius, y: g.center.y + g.radius },
          ),
          g.center,
          false,
        );
        break;
      case 'arc': {
        // The three stored points bound the arc closely enough to align by.
        const b = boxOf(g.start, g.end);
        b.minX = Math.min(b.minX, g.mid.x);
        b.minY = Math.min(b.minY, g.mid.y);
        b.maxX = Math.max(b.maxX, g.mid.x);
        b.maxY = Math.max(b.maxY, g.mid.y);
        add(id, b, g.start, false);
        break;
      }
      case 'polyline':
      case 'bezier': {
        const first = g.points[0];
        if (!first) break;
        const b = boxOf(first, first);
        for (const p of g.points) {
          b.minX = Math.min(b.minX, p.x);
          b.minY = Math.min(b.minY, p.y);
          b.maxX = Math.max(b.maxX, p.x);
          b.maxY = Math.max(b.maxY, p.y);
        }
        add(id, b, first, false);
        break;
      }
      case 'text':
        add(id, boxOf(g.at, g.at), g.at, false);
        break;
    }
  });
  return out;
}

/** The edge each mode aligns, and the axis it moves along. */
const EDGE: Record<AlignMode, { value: (b: BBox) => number; axis: 'x' | 'y' }> = {
  top: { value: (b) => b.minY, axis: 'y' },
  bottom: { value: (b) => b.maxY, axis: 'y' },
  left: { value: (b) => b.minX, axis: 'x' },
  right: { value: (b) => b.maxX, axis: 'x' },
  centerX: { value: (b) => (b.minX + b.maxX) / 2, axis: 'x' },
  centerY: { value: (b) => (b.minY + b.maxY) / 2, axis: 'y' },
};

/** Sort order per mode: the outermost item first, so it is the fallback target. */
const OUTERMOST: Record<AlignMode, (a: number, b: number) => number> = {
  top: (a, b) => a - b,
  bottom: (a, b) => b - a,
  left: (a, b) => a - b,
  right: (a, b) => b - a,
  centerX: (a, b) => a - b,
  centerY: (a, b) => a - b,
};

const contains = (b: BBox, p: Vec2): boolean =>
  p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/**
 * `selectTarget`: the item under the cursor wins; failing that a locked item,
 * since it will not move; failing that the outermost.
 */
function targetValue(items: ItemBox[], locked: ItemBox[], mode: AlignMode, cursor?: Vec2): number {
  const value = EDGE[mode].value;
  if (locked.length) {
    if (cursor) {
      const hit = locked.find((i) => contains(i.box, cursor));
      if (hit) return value(hit.box);
    }
    return value(locked[0]!.box);
  }
  if (cursor) {
    const hit = items.find((i) => contains(i.box, cursor));
    if (hit) return value(hit.box);
  }
  return value(items[0]!.box);
}

/**
 * Align the selection. `cursor` is where the action was invoked from, which
 * decides the target when it lands on one of the items; omit it and the
 * outermost item is used.
 */
export function alignItems(
  doc: Schematic,
  ids: ReadonlySet<string>,
  libById: Map<string, LibSymbol>,
  mode: AlignMode,
  gridSize: number,
  cursor?: Vec2,
): EditCommand | null {
  const all = alignBoxes(doc, ids, libById);
  const items = all.filter((i) => !i.locked);
  const locked = all.filter((i) => i.locked);
  if (items.length === 0) return null;

  const { value, axis } = EDGE[mode];
  const order = OUTERMOST[mode];
  items.sort((a, b) => order(value(a.box), value(b.box)));
  locked.sort((a, b) => order(value(a.box), value(b.box)));

  const target = targetValue(items, locked, mode, cursor);

  const moves: EditCommand[] = [];
  for (const item of items) {
    let d = target - value(item.box);
    if (d === 0) continue;
    if (item.connectable && gridSize > 0) {
      // adjustDeltaForGrid: snap where the item lands, not the distance it
      // travels, so a connectable item stays on grid however far it moved.
      const from = axis === 'x' ? item.anchor.x : item.anchor.y;
      d = Math.round((from + d) / gridSize) * gridSize - from;
      if (d === 0) continue;
    }
    moves.push(moveItems(new Set([item.id]), axis === 'x' ? { x: d, y: 0 } : { x: 0, y: d }));
  }
  if (moves.length === 0) return null;
  return composeCommands(ALIGN_LABELS[mode], moves);
}
