// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Connectivity node under the cursor". Counterpart:
 * `SCH_SELECTION_TOOL::GetNode` (eeschema/tools/sch_selection_tool.cpp), the
 * pick used by the net-highlight tools rather than the ordinary selection
 * collector.
 *
 * Two things make it different from `hitTest`:
 *
 *  - it collects only `connectedTypes` (sch_selection_tool.cpp:509), power
 *    symbols, pins, wires, buses, bus entries, labels, sheet pins and
 *    junctions. Anything else (a symbol body, a sheet, a text box) is
 *    invisible to it, so clicking one falls through to whatever connectable
 *    item is also in range instead of reading as "no connection".
 *  - it retries at growing thresholds { 0, max/4, max/2, max } and returns the
 *    first threshold that finds anything, so an exact hit always beats a
 *    nearby one.
 *
 * The ids returned are connectivity node ids, the very ids `computeNetlist`
 * emits (`<symbolRef>:pin<k>`, `<sheetRef>:sheetpin<k>`, wire/label/junction
 * refIds), so the caller can look the net straight up in `netByItem`.
 */

import type { LibSymbol, Schematic, Vec2 } from '../types.js';
import { localToWorld, symbolTransform } from '@ziroeda/common/src/transform.js';
import { refId } from './hittest.js';
import { contains, inflate, labelBox, type BBox } from './bbox.js';

export type NodeHitKind =
  | 'pin'
  | 'wire'
  | 'bus'
  | 'busentry'
  | 'label'
  | 'sheetpin'
  | 'junction'
  | 'noconnect';

export interface NodeHit {
  /** Connectivity node id, identical to `computeNetlist`'s ids. */
  id: string;
  kind: NodeHitKind;
}

/** Distance from point p to segment ab. */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The pin's body end (the non-connection end), in symbol-local space,
 *  the same mapping the painter uses for the pin line. */
function pinRoot(at: Vec2, angle: number, length: number): Vec2 {
  switch (((angle % 360) + 360) % 360) {
    case 0:
      return { x: at.x + length, y: at.y };
    case 90:
      return { x: at.x, y: at.y - length };
    case 180:
      return { x: at.x - length, y: at.y };
    case 270:
      return { x: at.x, y: at.y + length };
    default:
      return at;
  }
}

/** A sheet pin's clickable box: its flag text hanging off the sheet border. */
function sheetPinBox(at: Vec2, name: string, size: number): BBox {
  const w = Math.max(1, name.length) * size * 0.7;
  return { minX: at.x - w, minY: at.y - size, maxX: at.x + w, maxY: at.y + size };
}

/**
 * The connectable item under `p`, or null. `thresholdMax` is the widest slop
 * to accept (world IU), upstream's max(HITTEST_THRESHOLD_PIXELS, grid size).
 */
export function getNode(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  p: Vec2,
  thresholdMax: number,
): NodeHit | null {
  for (const threshold of [0, thresholdMax / 4, thresholdMax / 2, thresholdMax]) {
    const hit = collectAt(sch, libById, p, threshold);
    if (hit) return hit;
  }
  return null;
}

/**
 * One collector pass at a fixed threshold. Within a pass the precise items are
 * tested before the sprawling ones (a pin before the power-symbol body that
 * carries it, a junction before the wires crossing it), which is upstream's
 * `connectedTypes` ordering with its ambiguity resolved the same way
 * GuessSelectionCandidates would.
 */
function collectAt(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  p: Vec2,
  t: number,
): NodeHit | null {
  // --- pins (SCH_PIN_T): the whole pin line, not just the connection point ---
  for (let si = 0; si < sch.symbols.length; si++) {
    const sym = sch.symbols[si]!;
    const lib = libById.get(sym.libId);
    if (!lib) continue;
    const symId = refId('symbol', sym.uuid, si);
    const xf = symbolTransform(sym.angle, sym.mirror);
    let k = 0;
    for (const u of lib.units) {
      if (
        (u.unit !== 0 && u.unit !== sym.unit) ||
        (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
      )
        continue;
      for (const pin of u.pins) {
        const tip = localToWorld(sym.at, xf, pin.at);
        const root = localToWorld(sym.at, xf, pinRoot(pin.at, pin.angle, pin.length));
        if (distToSegment(p, tip, root) <= t) return { id: `${symId}:pin${k}`, kind: 'pin' };
        k++;
      }
    }
  }

  // --- junctions ---
  for (let i = 0; i < sch.junctions.length; i++) {
    const j = sch.junctions[i]!;
    const r = (j.diameter > 0 ? j.diameter : 9000) / 2 + t;
    if (Math.hypot(p.x - j.at.x, p.y - j.at.y) <= r)
      return { id: refId('junction', j.uuid, i), kind: 'junction' };
  }

  // --- labels (local / global / hierarchical / directive; not free text) ---
  for (let i = 0; i < sch.labels.length; i++) {
    const l = sch.labels[i]!;
    if (l.kind === 'text') continue; // graphic text is not connectable
    if (contains(inflate(labelBox(l), t), p))
      return { id: refId('label', l.uuid, i), kind: 'label' };
  }

  // --- sheet pins ---
  for (let si = 0; si < sch.sheets.length; si++) {
    const sh = sch.sheets[si]!;
    const shId = refId('sheet', sh.uuid, si);
    for (let k = 0; k < sh.pins.length; k++) {
      const pin = sh.pins[k]!;
      const size = pin.effects?.fontSize?.[0] ?? 12700;
      if (contains(inflate(sheetPinBox(pin.at, pin.name, size), t), p))
        return { id: `${shId}:sheetpin${k}`, kind: 'sheetpin' };
    }
  }

  // --- wire-to-bus entries ---
  for (let i = 0; i < sch.busEntries.length; i++) {
    const be = sch.busEntries[i]!;
    const end = { x: be.at.x + be.size.x, y: be.at.y + be.size.y };
    if (distToSegment(p, be.at, end) <= t)
      return { id: refId('busentry', be.uuid, i), kind: 'busentry' };
  }

  // --- no-connect flags ---
  for (let i = 0; i < sch.noConnects.length; i++) {
    const nc = sch.noConnects[i]!;
    const half = 6096 + t; // 24 mil in IU
    if (Math.abs(p.x - nc.at.x) <= half && Math.abs(p.y - nc.at.y) <= half)
      return { id: refId('noconnect', nc.uuid, i), kind: 'noconnect' };
  }

  // --- wires, then buses ---
  for (const kind of ['wire', 'bus'] as const) {
    for (let i = 0; i < sch.lines.length; i++) {
      const ln = sch.lines[i]!;
      if (ln.kind !== kind) continue;
      const tol = t + (ln.stroke && ln.stroke.width > 0 ? ln.stroke.width / 2 : 0);
      if (distToSegment(p, ln.start, ln.end) <= tol) return { id: refId('line', ln.uuid, i), kind };
    }
  }

  // --- power symbols (SCH_SYMBOL_LOCATE_POWER_T) -------------------------
  // A power flag's body and its visible fields stand in for its single pin
  // (sch_editor_control.cpp:1086, `pins.size() == 1` -> pins[0]->Connection()),
  // which is how clicking a GND flag highlights GND.
  for (let si = 0; si < sch.symbols.length; si++) {
    const sym = sch.symbols[si]!;
    const lib = libById.get(sym.libId);
    if (!lib?.isPower) continue;
    const symId = refId('symbol', sym.uuid, si);
    const xf = symbolTransform(sym.angle, sym.mirror);
    const box: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    let pins = 0;
    for (const u of lib.units) {
      if (
        (u.unit !== 0 && u.unit !== sym.unit) ||
        (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
      )
        continue;
      for (const g of u.graphics) {
        const pts =
          g.kind === 'rectangle'
            ? [g.start, g.end]
            : g.kind === 'circle'
              ? [
                  { x: g.center.x - g.radius, y: g.center.y - g.radius },
                  { x: g.center.x + g.radius, y: g.center.y + g.radius },
                ]
              : g.kind === 'arc'
                ? [g.start, g.mid, g.end]
                : g.kind === 'polyline' || g.kind === 'bezier'
                  ? g.points
                  : [g.at];
        for (const q of pts) {
          const w = localToWorld(sym.at, xf, q);
          box.minX = Math.min(box.minX, w.x);
          box.minY = Math.min(box.minY, w.y);
          box.maxX = Math.max(box.maxX, w.x);
          box.maxY = Math.max(box.maxY, w.y);
        }
      }
      pins += u.pins.length;
    }
    if (pins !== 1) continue; // upstream only maps single-pin power symbols
    // The Value field (the net name, "GND", "+5V") is drawn next to the body
    // and clicking it highlights too (item->Type() == SCH_FIELD_T branch).
    const value = sym.fields.find((f) => f.key === 'Value');
    if (value?.at && !value.effects?.hidden) {
      const h = value.effects?.fontSize?.[0] ?? 12700;
      const w = Math.max(1, value.value.length) * h * 0.7;
      box.minX = Math.min(box.minX, value.at.x - w / 2);
      box.maxX = Math.max(box.maxX, value.at.x + w / 2);
      box.minY = Math.min(box.minY, value.at.y - h);
      box.maxY = Math.max(box.maxY, value.at.y + h);
    }
    if (box.minX <= box.maxX && contains(inflate(box, t), p))
      return { id: `${symId}:pin0`, kind: 'pin' };
  }

  return null;
}
