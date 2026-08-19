// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Connectable-point snapping, the model side of KiCad's EE_GRID_HELPER::BestSnapAnchor
 * with GRID_CONNECTABLE: when drawing or moving, the cursor snaps to nearby
 * connection anchors (symbol pins, wire endpoints, junctions, label anchors) so
 * items land exactly on each other and stay electrically connected, instead of
 * only snapping to the background grid.
 */

import type { Schematic, LibSymbol, SchSymbol, Vec2 } from '../types.js';
import { symbolTransform, localToWorld } from '@ziroeda/common/src/transform.js';
import { refId } from './hittest.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';

/** All connection points of a placed symbol (pin tips through the placement transform). */
function symbolPins(sym: SchSymbol, lib: LibSymbol | undefined): Vec2[] {
  if (!lib) return [];
  const t = symbolTransform(sym.angle, sym.mirror);
  const out: Vec2[] = [];
  for (const u of lib.units) {
    if (
      (u.unit !== 0 && u.unit !== sym.unit) ||
      (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
    )
      continue;
    for (const pin of u.pins) out.push(localToWorld(sym.at, t, pin.at));
  }
  return out;
}

/**
 * Collect every connectable anchor on the sheet: symbol pins, wire/bus endpoints,
 * junctions and label anchors. Ids of items being moved can be excluded so a moved
 * item does not snap to its own anchors.
 */
export function collectAnchors(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  exclude?: ReadonlySet<string>,
): Vec2[] {
  const pts: Vec2[] = [];
  sch.symbols.forEach((sym, i) => {
    if (!exclude?.has(refId('symbol', sym.uuid, i)))
      pts.push(...symbolPins(sym, libById.get(schSymbolLibraryName(sym))));
  });
  sch.lines.forEach((l, i) => {
    if (!exclude?.has(refId('line', l.uuid, i))) {
      pts.push(l.start);
      pts.push(l.end);
    }
  });
  sch.junctions.forEach((j, i) => {
    if (!exclude?.has(refId('junction', j.uuid, i))) pts.push(j.at);
  });
  // GRID_CONNECTABLE snaps to connectable items only; SCH_TEXT is not one
  // (SCH_ITEM::IsConnectable() is false and SCH_TEXT never overrides it).
  sch.labels.forEach((l, i) => {
    if (l.kind === 'text') return;
    if (!exclude?.has(refId('label', l.uuid, i))) pts.push(l.at);
  });
  // GRID_CONNECTABLE also snaps to sheet pins, bus-entry ends and no-connects.
  sch.sheets.forEach((sh, i) => {
    if (!exclude?.has(refId('sheet', sh.uuid, i))) for (const p of sh.pins) pts.push(p.at);
  });
  sch.busEntries.forEach((be, i) => {
    if (!exclude?.has(refId('busentry', be.uuid, i))) {
      pts.push(be.at);
      pts.push({ x: be.at.x + be.size.x, y: be.at.y + be.size.y });
    }
  });
  sch.noConnects.forEach((nc, i) => {
    if (!exclude?.has(refId('noconnect', nc.uuid, i))) pts.push(nc.at);
  });
  return pts;
}

/** The connection points of the selected items only (used as move reference points). */
export function selectionAnchors(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  ids: ReadonlySet<string>,
): Vec2[] {
  const pts: Vec2[] = [];
  sch.symbols.forEach((sym, i) => {
    if (ids.has(refId('symbol', sym.uuid, i)))
      pts.push(...symbolPins(sym, libById.get(schSymbolLibraryName(sym))));
  });
  sch.lines.forEach((l, i) => {
    if (ids.has(refId('line', l.uuid, i))) {
      pts.push(l.start);
      pts.push(l.end);
    }
  });
  sch.junctions.forEach((j, i) => {
    if (ids.has(refId('junction', j.uuid, i))) pts.push(j.at);
  });
  sch.labels.forEach((l, i) => {
    if (l.kind === 'text') return; // not connectable
    if (ids.has(refId('label', l.uuid, i))) pts.push(l.at);
  });
  return pts;
}

/**
 * Nearest anchor to `p` within `maxDist` (IU), or null.
 *
 * `EE_GRID_HELPER::nearestAnchor` (eeschema/tools/ee_grid_helper.cpp:553). This is
 * a **private member of the subclass**, not of `GRID_HELPER`: the base
 * (include/tool/grid_helper.h:55) owns the anchor list and the flags, and each
 * editor searches it its own way. So does pcbnew's same-named function in
 * pcb_cursor_snap.ts, and the two searches are genuinely different --
 * `EE_GRID_HELPER`'s takes a `GRID_HELPER_GRIDS` and drops anchors whose item
 * fails `IsConnectable()` for GRID_CONNECTABLE (or passes it, for GRID_GRAPHICS),
 * while `PCB_GRID_HELPER`'s (pcbnew/tools/pcb_grid_helper.cpp:1966) has no such
 * filter, collects every anchor tied for nearest, and then asks the snap manager
 * which of them the user has activated. Flattening the two would mean inventing
 * a filter neither editor has.
 */
export function nearestAnchor(p: Vec2, anchors: readonly Vec2[], maxDist: number): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = maxDist * maxDist;
  for (const a of anchors) {
    const dx = a.x - p.x;
    const dy = a.y - p.y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}
