// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EE_GRID_HELPER` - `eeschema/tools/ee_grid_helper.{h,cpp}`, a subclass of the
 * one `GRID_HELPER` in `common/tool/grid_helper.ts`, exactly as upstream
 * derives it. The anchor list, the flags and the grid are the base's; this file
 * adds eeschema's anchor collection (`computeAnchors`) and its own
 * `nearestAnchor`.
 *
 * With `GRID_CONNECTABLE` it is what makes the cursor snap to connection
 * anchors - symbol pins, wire endpoints, junctions, label anchors - so items
 * land exactly on each other and stay electrically connected, instead of only
 * snapping to the background grid.
 *
 * ### Over the plain `Schematic`
 *
 * The schematic here is plain data, not `SCH_ITEM`s, so:
 *
 *  - `queryVisible` + the `computeAnchors( item )` loop is
 *    {@link EE_GRID_HELPER.computeAnchors}, over the whole sheet, with a
 *    predicate on item ids standing in for `aSkip` (or for the selection);
 *  - an anchor's `items` list is empty. `nearestAnchor` reads it only to drop
 *    anchors of non-connectable items under `GRID_CONNECTABLE`, and no anchor
 *    collected here comes from one: graphic lines are skipped outright
 *    (`!aIncludeText`), and text is never collected.
 *
 * ### Not ported
 *
 *  - `BestSnapAnchor` / `BestDragOrigin`. The canvas still asks the reduced
 *    question "the nearest `SNAPPABLE` anchor within a screen radius, else the
 *    grid" through {@link nearestSnapAnchor}; upstream's version prefers the
 *    grid node when it is also in range, and adds snap lines.
 *  - the `SCH_LINE_T` point-on-line anchor (`VERTICAL` / `HORIZONTAL`), which
 *    needs `aRefPos` - the cursor - while the canvas collects one list per
 *    sheet edit, not per mouse move.
 *  - `GetGridSize` / `GetItemGrid` overrides: grid overrides are not wired in
 *    the schematic editor, so the base's single grid is upstream's answer.
 */

import {
  type ANCHOR,
  ANCHOR_FLAGS,
  GRID_HELPER,
  GRID_HELPER_GRIDS,
} from '@ziroeda/common/tool/grid_helper.js';
import { localToWorld, symbolTransform } from '@ziroeda/kimath/src/transform.js';
import type { LibSymbol, SchSymbol, Schematic, Vec2 } from '../types.js';
import { schSymbolLibraryName } from '../lib_symbol_compare.js';
import { refId } from './hittest.js';

/** `SCH_SYMBOL::GetConnectionPoints()`: the pin tips through the placement transform. */
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

export class EE_GRID_HELPER extends GRID_HELPER {
  /**
   * `EE_GRID_HELPER::computeAnchors` (cpp:436-548) for every item whose id
   * passes `aInclude` - `queryVisible`'s set minus `aSkip`, or a selection.
   * `aFrom` and `aIncludeText` are upstream's defaults, false.
   *
   * - `SCH_SYMBOL_T` / `SCH_SHEET_T`: the position as `ORIGIN`, then the
   *   connection points (pins, sheet pins) as `SNAPPABLE | CORNER`;
   * - `SCH_JUNCTION_T`, `SCH_NO_CONNECT_T`, `SCH_LINE_T` (wires and buses
   *   only - a graphic line is skipped), the four label types and
   *   `SCH_BUS_WIRE_ENTRY_T`: the connection points, `SNAPPABLE | CORNER`;
   * - `SCH_TEXT_T`: nothing - `SCH_ITEM::IsConnectable()` is false and
   *   `aIncludeText` is off.
   */
  computeAnchors(
    aSch: Schematic,
    aLibById: ReadonlyMap<string, LibSymbol>,
    aInclude: (aId: string) => boolean,
  ): void {
    const add = (aPos: Vec2, aFlags: number): void => this.addAnchor(aPos, aFlags, []);
    const conn = ANCHOR_FLAGS.SNAPPABLE | ANCHOR_FLAGS.CORNER;

    aSch.symbols.forEach((sym, i) => {
      if (!aInclude(refId('symbol', sym.uuid, i))) return;
      add(sym.at, ANCHOR_FLAGS.ORIGIN);
      for (const p of symbolPins(sym, aLibById.get(schSymbolLibraryName(sym)))) add(p, conn);
    });
    aSch.lines.forEach((l, i) => {
      // "Don't add anchors for graphic lines unless we're including text,
      // they may be on a non-connectable grid"
      if (l.kind === 'polyline') return;
      if (!aInclude(refId('line', l.uuid, i))) return;
      add(l.start, conn);
      add(l.end, conn);
    });
    aSch.junctions.forEach((j, i) => {
      if (aInclude(refId('junction', j.uuid, i))) add(j.at, conn);
    });
    aSch.labels.forEach((l, i) => {
      if (l.kind === 'text') return;
      if (aInclude(refId('label', l.uuid, i))) add(l.at, conn);
    });
    aSch.sheets.forEach((sh, i) => {
      if (!aInclude(refId('sheet', sh.uuid, i))) return;
      add(sh.at, ANCHOR_FLAGS.ORIGIN);
      for (const p of sh.pins) add(p.at, conn);
    });
    aSch.busEntries.forEach((be, i) => {
      if (!aInclude(refId('busentry', be.uuid, i))) return;
      add(be.at, conn);
      add({ x: be.at.x + be.size.x, y: be.at.y + be.size.y }, conn);
    });
    aSch.noConnects.forEach((nc, i) => {
      if (aInclude(refId('noconnect', nc.uuid, i))) add(nc.at, conn);
    });
  }

  /**
   * `computeAnchors`'s `SCH_PIN_T` arm (cpp:519-524), for pins handed in on
   * their own: `SNAPPABLE | ORIGIN` at each pin's position.
   */
  computePinAnchors(aPins: readonly Vec2[]): void {
    for (const p of aPins) this.addAnchor(p, ANCHOR_FLAGS.SNAPPABLE | ANCHOR_FLAGS.ORIGIN, []);
  }

  /** The collected anchors - `m_anchors`, which upstream's own tests read as a friend. */
  GetAnchors(): readonly ANCHOR[] {
    return this.m_anchors;
  }

  /**
   * `EE_GRID_HELPER::nearestAnchor` (cpp:553-586): the nearest anchor carrying
   * every flag in `aFlags`, first found winning a tie. Under `GRID_CONNECTABLE`
   * an anchor of a non-connectable item is dropped, and under `GRID_GRAPHICS`
   * one of a connectable item; an anchor with no items is never filtered - and
   * see the file comment on why none here carries one.
   *
   * A member of the subclass, not of `GRID_HELPER`: pcbnew's
   * (`PCB_GRID_HELPER::nearestAnchor`) has no grid filter at all.
   */
  nearestAnchor(aPos: Vec2, aFlags: number, _aGrid: GRID_HELPER_GRIDS): ANCHOR | null {
    let minDist = Number.MAX_VALUE;
    let best: ANCHOR | null = null;

    for (const a of this.m_anchors) {
      if ((aFlags & a.flags) !== aFlags) continue;

      const dist = a.Distance(aPos);

      if (dist < minDist) {
        minDist = dist;
        best = a;
      }
    }

    return best;
  }
}

/**
 * The anchor half of `EE_GRID_HELPER::BestSnapAnchor` (cpp:131-219), reduced:
 * the nearest `SNAPPABLE` anchor, if it is closer than `aSnapRange`
 * (`nearest->Distance( aOrigin ) < snapDist.EuclideanNorm()`), else null - and
 * the caller falls back to the grid. See the file comment for what the full
 * method adds.
 */
export function nearestSnapAnchor(
  aHelper: EE_GRID_HELPER,
  aPos: Vec2,
  aSnapRange: number,
  aGrid: GRID_HELPER_GRIDS = GRID_HELPER_GRIDS.GRID_CONNECTABLE,
): Vec2 | null {
  const nearest = aHelper.nearestAnchor(aPos, ANCHOR_FLAGS.SNAPPABLE, aGrid);

  return nearest && nearest.Distance(aPos) < aSnapRange ? nearest.pos : null;
}

/**
 * An {@link EE_GRID_HELPER} loaded with every anchor on the sheet except those
 * of `aSkip` - `BestSnapAnchor`'s `queryVisible( bb, aSkip )` + `computeAnchors`
 * loop, over the whole sheet rather than the snap box. A move passes the items
 * it drags (and the wires that rubber-band with them) so a moved point never
 * snaps back onto something moving with it.
 */
export function sheetAnchors(
  aSch: Schematic,
  aLibById: ReadonlyMap<string, LibSymbol>,
  aSkip?: ReadonlySet<string>,
): EE_GRID_HELPER {
  const helper = new EE_GRID_HELPER();

  helper.computeAnchors(aSch, aLibById, (aId) => !aSkip?.has(aId));

  return helper;
}

/**
 * The `SNAPPABLE` anchors of the selected items alone - the points a move tests
 * against {@link sheetAnchors} to decide whether the whole move should snap.
 */
export function selectionSnapPoints(
  aSch: Schematic,
  aLibById: ReadonlyMap<string, LibSymbol>,
  aIds: ReadonlySet<string>,
): Vec2[] {
  const helper = new EE_GRID_HELPER();

  helper.computeAnchors(aSch, aLibById, (aId) => aIds.has(aId));

  return helper
    .GetAnchors()
    .filter((a) => a.flags & ANCHOR_FLAGS.SNAPPABLE)
    .map((a) => a.pos);
}
