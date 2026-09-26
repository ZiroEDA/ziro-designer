// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Align Items to Grid. Counterparts: `SCH_MOVE_TOOL::AlignToGrid`
 * (eeschema/tools/sch_move_tool.cpp) and `AlignSchematicItemsToGrid`
 * (eeschema/sch_item_alignment.cpp).
 *
 * The action drags each selected item onto the grid *as a drag*, not a move —
 * connected wires come with it, so a symbol nudged half a grid step takes its
 * wiring along instead of tearing free of it. That is why upstream flips
 * `m_mode` to DRAG around each `moveItem` call.
 *
 * How far each item moves depends on what it is:
 *
 *  - a **wire** is aligned one *end at a time*, each end snapping
 *    independently, so a segment with one end off-grid straightens rather than
 *    sliding;
 *  - a **field or free text** just snaps its own position, having nothing to
 *    stay connected to;
 *  - **anything else** — symbols, junctions, labels, no-connects, bus entries —
 *    snaps by the shift that lands the *most* of its connection points on the
 *    grid. A symbol whose pins are all off by the same amount moves by that
 *    amount; one whose pins disagree follows the majority, which is what keeps
 *    the most connections intact.
 *
 * Sheets are left out for now: upstream aligns a sheet's two corners
 * independently (so it resizes) and then reconciles each pin against the wires
 * that were dragged with it, keeping a pin at its original Y when a connected
 * wire would otherwise skew. That is a recent upstream fix with a test of its
 * own (qa/tests/eeschema/test_issue22864_align_sheet_pins.cpp) and wants
 * porting as its own piece; a selected sheet is skipped rather than
 * half-aligned.
 */

import type { LibSymbol, Schematic, Vec2 } from '../types.js';
import { connectionPoints, planMove, planMoveFromPoints } from './connect.js';
import { moveWithConnections } from './move.js';
import { refId } from './hittest.js';
import type { EditCommand } from './command.js';

/** `EE_GRID_HELPER::AlignGrid`: the nearest multiple of the grid step. */
export const alignToGridPoint = (p: Vec2, grid: number): Vec2 => ({
  x: Math.round(p.x / grid) * grid,
  y: Math.round(p.y / grid) * grid,
});

const isZero = (d: Vec2): boolean => d.x === 0 && d.y === 0;
const key = (p: Vec2): string => `${p.x},${p.y}`;

/**
 * The shift that snaps the most of `points` onto the grid — upstream's
 * `shifts` histogram, whose winner is the most common delta.
 *
 * Ties go to the first shift to reach the running maximum, which is the order
 * the connection points come in, exactly as the `>` comparison upstream leaves
 * the incumbent in place.
 */
export function mostCommonGridShift(points: readonly Vec2[], grid: number): Vec2 {
  let best: Vec2 = { x: 0, y: 0 };
  let bestCount = 0;
  const counts = new Map<string, { shift: Vec2; n: number }>();
  for (const p of points) {
    const aligned = alignToGridPoint(p, grid);
    const shift = { x: aligned.x - p.x, y: aligned.y - p.y };
    const k = key(shift);
    const entry = counts.get(k) ?? { shift, n: 0 };
    entry.n++;
    counts.set(k, entry);
    if (entry.n > bestCount) {
      bestCount = entry.n;
      best = entry.shift;
    }
  }
  return best;
}

/**
 * Build the sequence of drags that aligns `ids` to the grid.
 *
 * Each step is a connection-aware move of one item (and whatever the drag
 * pulls along), applied in turn — upstream likewise calls `moveItem` per item
 * inside one commit, so later items see the earlier ones' effect.
 */
export function alignToGridCommand(
  doc: Schematic,
  ids: ReadonlySet<string>,
  libById: Map<string, LibSymbol>,
  grid: number,
): EditCommand | null {
  /**
   * One alignment step: what moves, and by how much. `point` marks a wire-end
   * drag, where the moving thing is that endpoint rather than a whole item.
   */
  const steps: { ids: Set<string>; delta: Vec2; point?: Vec2 }[] = [];

  // Wires: each end on its own, so a half-off segment straightens.
  doc.lines.forEach((l, i) => {
    const id = refId('line', l.uuid, i);
    if (!ids.has(id)) return;
    for (const end of [l.start, l.end]) {
      const aligned = alignToGridPoint(end, grid);
      const delta = { x: aligned.x - end.x, y: aligned.y - end.y };
      if (!isZero(delta)) steps.push({ ids: new Set([id]), delta, point: end });
    }
  });

  // Free text has no connections, so it simply snaps.
  doc.labels.forEach((l, i) => {
    const id = refId('label', l.uuid, i);
    if (!ids.has(id) || l.kind !== 'text') return;
    const aligned = alignToGridPoint(l.at, grid);
    const delta = { x: aligned.x - l.at.x, y: aligned.y - l.at.y };
    if (!isZero(delta)) steps.push({ ids: new Set([id]), delta });
  });

  // Everything else moves by the shift that snaps the most of its connection
  // points. Sheets are skipped (see the note at the top of this file).
  const byMajority = (id: string): void => {
    const pts = connectionPoints(doc, libById, new Set([id]));
    if (pts.length === 0) return;
    const delta = mostCommonGridShift(pts, grid);
    if (!isZero(delta)) steps.push({ ids: new Set([id]), delta });
  };
  doc.symbols.forEach((s, i) => {
    const id = refId('symbol', s.uuid, i);
    if (ids.has(id)) byMajority(id);
  });
  doc.junctions.forEach((j, i) => {
    const id = refId('junction', j.uuid, i);
    if (ids.has(id)) byMajority(id);
  });
  doc.labels.forEach((l, i) => {
    const id = refId('label', l.uuid, i);
    if (ids.has(id) && l.kind !== 'text') byMajority(id);
  });
  (doc.directiveLabels ?? []).forEach((d, i) => {
    const id = refId('directive', d.uuid, i);
    if (ids.has(id)) byMajority(id);
  });
  doc.noConnects.forEach((nc, i) => {
    const id = refId('noconnect', nc.uuid, i);
    if (ids.has(id)) byMajority(id);
  });
  doc.busEntries.forEach((be, i) => {
    const id = refId('busentry', be.uuid, i);
    if (ids.has(id)) byMajority(id);
  });

  if (steps.length === 0) return null;

  return {
    label: 'Align Items to Grid',
    apply(d: Schematic): Schematic {
      let out = d;
      for (const step of steps) {
        // Re-plan against the document as it now stands: an earlier step may
        // have moved a wire this one connects to.
        const spec = step.point
          ? // A wire end: nothing moves whole, the endpoint does, and the wire
            // picks up STARTPOINT/ENDPOINT from that.
            planMoveFromPoints(out, libById, new Set(), [step.point])
          : planMove(out, libById, step.ids);
        out = moveWithConnections(spec, step.delta).apply(out);
      }
      return out;
    },
    invert(before: Schematic): EditCommand {
      // The steps compose and re-plan, so the way back is the document as it
      // was — the same snapshot rule withCleanup uses.
      return {
        label: 'Align Items to Grid',
        apply: () => before,
        invert: () => alignToGridCommand(doc, ids, libById, grid)!,
      };
    },
  };
}
