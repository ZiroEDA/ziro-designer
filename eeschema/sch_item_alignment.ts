// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The grid-snap geometry of `AlignSchematicItemsToGrid` —
 * `eeschema/sch_item_alignment.cpp`.
 *
 * Upstream's own `AlignSchematicItemsToGrid` fuses this geometry with the
 * per-item drag loop that applies it (a `SCH_COMMIT`, `m_doMoveItem`, the
 * connected-drag-items callback) in one function; here that loop is
 * `tools/align_to_grid.ts`'s `alignToGridCommand`, which imports the two pure
 * functions below rather than duplicating them. `MoveSchematicItem`
 * (`sch_item_alignment.cpp`'s other function, the per-`EDA_ITEM`-type move
 * dispatch used by both alignment and drag) has no separate port here: our
 * move dispatch lives in `tools/move.ts`/`tools/connect.ts`
 * (`moveWithConnections`/`planMove`), reused as-is rather than duplicated for
 * alignment.
 */

import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { ENDPOINT, SELECTED, STARTPOINT } from '@ziroeda/common/eda_item_flags.js';
import type { GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { SCH_ITEM } from './sch_item.js';
import type { SCH_LINE } from './sch_line.js';
import type { SCH_SCREEN } from './sch_screen.js';
import type { SCH_SHEET } from './sch_sheet.js';
import type { SCH_SHEET_PIN } from './sch_sheet_pin.js';
import type { EE_GRID_HELPER } from './tools/ee_grid_helper.js';
import type { Vec2 } from './types.js';

/** `EE_GRID_HELPER::AlignGrid`: the nearest multiple of the grid step. */
export const alignToGridPoint = (p: Vec2, grid: number): Vec2 => ({
  x: Math.round(p.x / grid) * grid,
  y: Math.round(p.y / grid) * grid,
});

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

// -----------------------------------------------------------------------------------------------
// sch_item_alignment.{h,cpp} on the live model
// -----------------------------------------------------------------------------------------------

/** `SCH_ALIGNMENT_CALLBACKS` (sch_item_alignment.h): what the caller does for each move. */
export interface SCH_ALIGNMENT_CALLBACKS {
  m_doMoveItem: (aItem: EDA_ITEM, aDelta: VECTOR2I) => void;
  m_getConnectedDragItems: ((aItem: SCH_ITEM, aPoint: VECTOR2I, aList: EDA_ITEM[]) => void) | null;
  m_updateItem: ((aItem: EDA_ITEM) => void) | null;
}

/**
 * `MoveSchematicItem` (sch_item_alignment.cpp:35): move \a aItem by \a aDelta as a drag moves it,
 * a line only at its flagged ends and a sheet pin along its sheet's edge.
 */
export function MoveSchematicItem(aItem: EDA_ITEM, aDelta: VECTOR2I): void {
  switch (aItem.Type()) {
    case KICAD_T.SCH_LINE_T: {
      const line = aItem as SCH_LINE;

      if (aItem.HasFlag(STARTPOINT)) line.MoveStart(aDelta);

      if (aItem.HasFlag(ENDPOINT)) line.MoveEnd(aDelta);

      break;
    }

    case KICAD_T.SCH_SHEET_PIN_T: {
      const pin = aItem as SCH_SHEET_PIN;
      const stored = pin.GetStoredPos();
      pin.SetStoredPos({ x: stored.x + aDelta.x, y: stored.y + aDelta.y });
      pin.ConstrainOnEdge(pin.GetStoredPos(), true);
      break;
    }

    default:
      (aItem as SCH_ITEM).Move(aDelta);
      break;
  }
}

const vkey = (p: VECTOR2I): string => `${p.x},${p.y}`;
const vzero = (p: VECTOR2I): boolean => p.x === 0 && p.y === 0;
const vsub = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });

/**
 * `AlignSchematicItemsToGrid` (sch_item_alignment.cpp:61): move \a aItems onto \a aGrid's
 * \a aSelectionGrid, wires end by end with what hangs off them, sheets corner by corner with their
 * pins, everything else by the most common shift of its connection points.
 */
export function AlignSchematicItemsToGrid(
  aScreen: SCH_SCREEN,
  aItems: readonly EDA_ITEM[],
  aGrid: EE_GRID_HELPER,
  aSelectionGrid: GRID_HELPER_GRIDS,
  aCallbacks: SCH_ALIGNMENT_CALLBACKS,
): void {
  // When both sheets are selected, wires drag with pins. When only one sheet is selected,
  // pins stay at the original Y so wires stretch horizontally without skewing. When wires
  // are also selected, they align independently and pins follow their endpoints.
  //
  // We record original wire endpoints and query the R-tree before moving each sheet, then
  // update storedPos after the move to prevent double-movement.
  interface WireEndpoint {
    wire: SCH_LINE;
    endpointFlag: number; // STARTPOINT or ENDPOINT
  }

  const pinPosToWires = new Map<string, WireEndpoint[]>();

  // Wires may move while processing earlier sheets, so we save their original positions.
  const originalWireEndpoints = new Map<SCH_LINE, { start: VECTOR2I; end: VECTOR2I }>();

  for (const item of aScreen.Items().OfType(KICAD_T.SCH_LINE_T)) {
    const line = item as SCH_LINE;
    originalWireEndpoints.set(line, { start: line.GetStartPoint(), end: line.GetEndPoint() });
  }

  const selectedSheetPinPositions = new Set<string>();

  for (const item of aItems) {
    if (item.Type() === KICAD_T.SCH_SHEET_T) {
      for (const pin of (item as SCH_SHEET).GetPins())
        selectedSheetPinPositions.add(vkey(pin.GetPosition()));
    }
  }

  for (const item of aItems) {
    if (item.Type() === KICAD_T.SCH_LINE_T) {
      const line = item as SCH_LINE;
      const add = (aPt: VECTOR2I, aFlag: number) => {
        const k = vkey(aPt);
        if (!pinPosToWires.has(k)) pinPosToWires.set(k, []);
        pinPosToWires.get(k)!.push({ wire: line, endpointFlag: aFlag });
      };

      if (selectedSheetPinPositions.has(vkey(line.GetStartPoint())))
        add(line.GetStartPoint(), STARTPOINT);

      if (selectedSheetPinPositions.has(vkey(line.GetEndPoint())))
        add(line.GetEndPoint(), ENDPOINT);
    }
  }

  for (const item of aItems) {
    if (item.Type() === KICAD_T.SCH_LINE_T) {
      const line = item as SCH_LINE;
      const flags = [STARTPOINT, ENDPOINT];
      const pts = [line.GetStartPoint(), line.GetEndPoint()];

      for (let ii = 0; ii < 2; ++ii) {
        const drag_items: EDA_ITEM[] = [item];
        line.ClearFlags();
        line.SetFlags(SELECTED);
        line.SetFlags(flags[ii]!);

        aCallbacks.m_getConnectedDragItems?.(line, pts[ii]!, drag_items);

        const unique_items = new Set<EDA_ITEM>(drag_items);

        const delta = vsub(aGrid.AlignGrid(pts[ii]!, aSelectionGrid), pts[ii]!);

        if (!vzero(delta)) {
          for (const dragItem of unique_items) {
            if (dragItem.GetParent()?.IsSelected()) continue;

            aCallbacks.m_doMoveItem(dragItem, delta);
          }
        }
      }
    } else if (item.Type() === KICAD_T.SCH_FIELD_T || item.Type() === KICAD_T.SCH_TEXT_T) {
      const delta = vsub(aGrid.AlignGrid(item.GetPosition(), aSelectionGrid), item.GetPosition());

      if (!vzero(delta)) aCallbacks.m_doMoveItem(item, delta);
    } else if (item.Type() === KICAD_T.SCH_SHEET_T) {
      const sheet = item as SCH_SHEET;
      const topLeft = sheet.GetPosition();
      const bottomRight = { x: topLeft.x + sheet.GetSize().x, y: topLeft.y + sheet.GetSize().y };
      const tl_delta = vsub(aGrid.AlignGrid(topLeft, aSelectionGrid), topLeft);
      const br_delta = vsub(aGrid.AlignGrid(bottomRight, aSelectionGrid), bottomRight);

      // Query connected items before moving the sheet since R-tree needs original positions.
      const originalPinPositions = new Map<SCH_SHEET_PIN, VECTOR2I>();
      const pinDragItems = new Map<SCH_SHEET_PIN, EDA_ITEM[]>();

      for (const pin of sheet.GetPins()) {
        originalPinPositions.set(pin, pin.GetPosition());
        pinDragItems.set(pin, []);
        aCallbacks.m_getConnectedDragItems?.(pin, pin.GetPosition(), pinDragItems.get(pin)!);
      }

      if (!vzero(tl_delta) || !vzero(br_delta)) {
        aCallbacks.m_doMoveItem(sheet, tl_delta);

        const newSize = {
          x: sheet.GetSize().x - tl_delta.x + br_delta.x,
          y: sheet.GetSize().y - tl_delta.y + br_delta.y,
        };
        sheet.SetSize(newSize);

        aCallbacks.m_updateItem?.(sheet);
      }

      for (const pin of sheet.GetPins()) pin.SetStoredPos(pin.GetPosition());

      for (const pin of sheet.GetPins()) {
        const originalPos = originalPinPositions.get(pin)!;
        const pinPos = pin.GetPosition();
        let targetPos: VECTOR2I;
        let canDragWires = true;

        // If the pin was connected to a selected wire, follow that wire's aligned position.
        const wires = pinPosToWires.get(vkey(originalPos));

        if (wires && wires.length > 0) {
          const we = wires[0]!;

          if (we.endpointFlag === STARTPOINT) targetPos = we.wire.GetStartPoint();
          else targetPos = we.wire.GetEndPoint();
        } else {
          // Check if any connected wire has its other end at an unselected item.
          for (const dragItem of pinDragItems.get(pin)!) {
            if (dragItem.Type() !== KICAD_T.SCH_LINE_T) continue;

            const wire = dragItem as SCH_LINE;
            const orig = originalWireEndpoints.get(wire);

            if (!orig) continue;

            const otherEnd = vkey(orig.start) === vkey(originalPos) ? orig.end : orig.start;

            if (!selectedSheetPinPositions.has(vkey(otherEnd))) {
              canDragWires = false;
              break;
            }
          }

          if (!canDragWires && pinDragItems.get(pin)!.length > 0) {
            // Keep pin at original Y so the wire stretches horizontally without skewing.
            targetPos = { x: pinPos.x, y: originalPos.y };
          } else {
            targetPos = aGrid.AlignGrid(pinPos, aSelectionGrid);
          }
        }

        const delta = vsub(targetPos, pinPos);
        const totalDelta = vsub(targetPos, originalPos);

        if (!vzero(delta)) aCallbacks.m_doMoveItem(pin, delta);

        for (const dragItem of pinDragItems.get(pin)!) {
          if (dragItem.GetParent()?.IsSelected()) continue;

          if (!vzero(totalDelta)) aCallbacks.m_doMoveItem(dragItem, totalDelta);
        }
      }
    } else {
      const schItem = item as SCH_ITEM;
      const connections = schItem.GetConnectionPoints();
      const drag_items: EDA_ITEM[] = [];

      if (aCallbacks.m_getConnectedDragItems) {
        for (const point of connections)
          aCallbacks.m_getConnectedDragItems(schItem, point, drag_items);
      }

      // std::map<VECTOR2I, int>: counted per shift; ties keep the first to reach the count.
      const shifts = new Map<string, number>();
      let most_common: VECTOR2I = { x: 0, y: 0 };
      let max_count = 0;

      for (const conn of connections) {
        const gridpt = vsub(aGrid.AlignGrid(conn, aSelectionGrid), conn);
        const k = vkey(gridpt);
        shifts.set(k, (shifts.get(k) ?? 0) + 1);

        if (shifts.get(k)! > max_count) {
          most_common = gridpt;
          max_count = shifts.get(vkey(most_common))!;
        }
      }

      if (!vzero(most_common)) {
        aCallbacks.m_doMoveItem(item, most_common);

        for (const dragItem of drag_items) {
          if (dragItem.GetParent()?.IsSelected()) continue;

          aCallbacks.m_doMoveItem(dragItem, most_common);
        }
      }
    }
  }
}
