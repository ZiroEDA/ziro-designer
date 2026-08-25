// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * How close the cursor has to be for pl_editor to consider it on something.
 *
 * [data] Three different numbers, each hardcoded upstream at its own call
 * site. Ours had one number — 6 — at all three, which is not any of them: a
 * click was twice as forgiving as KiCad's on an item and a quarter less on an
 * edit handle.
 */

/**
 * `HITTEST_THRESHOLD_PIXELS` in `pl_selection_tool.cpp:44` — the ordinary
 * click, the right-click hover selection and the box-drag's click fallback all
 * go through `SelectPoint`.
 */
export const SELECT_THRESHOLD_PX = 3;

/**
 * `HITTEST_THRESHOLD_PIXELS` in `pl_edit_tool.cpp:414`, a *different* constant
 * with the same name, used by `InteractiveDelete`'s motion handler
 * (`:443`). The delete tool is deliberately more forgiving than the pointer.
 */
export const DELETE_THRESHOLD_PX = 5;

/**
 * `EDIT_POINT::POINT_SIZE` (`include/tool/edit_points.h:194`), which
 * `EDIT_POINTS::FindPoint` converts to world units and hands to
 * `WithinPoint` (`common/tool/edit_points.cpp:58-78`).
 */
export const EDIT_POINT_SIZE_PX = 8;

/**
 * `EDIT_POINT::WithinPoint` (`common/tool/edit_points.cpp:37-45`):
 *
 *     VECTOR2I topLeft     = GetPosition() - aSize;
 *     VECTOR2I bottomRight = GetPosition() + aSize;
 *     return ( aPoint.x > topLeft.x && aPoint.y > topLeft.y &&
 *              aPoint.x < bottomRight.x && aPoint.y < bottomRight.y );
 *
 * A square, not a circle, and the comparisons are STRICT — a cursor exactly on
 * the box edge is outside it.
 */
export function withinPoint(
  point: { x: number; y: number },
  at: { x: number; y: number },
  size: number,
): boolean {
  return (
    at.x > point.x - size && at.y > point.y - size && at.x < point.x + size && at.y < point.y + size
  );
}

/**
 * A screen-pixel threshold in world units, which is what every call site
 * actually wants: `KiROUND( getView()->ToWorld( HITTEST_THRESHOLD_PIXELS ) )`
 * (pl_edit_tool.cpp:443) and the same shape in `FindPoint`.
 *
 * `dpr` is GAL's `m_scaleFactor`: our view scale is device pixels per world
 * unit, so a threshold quoted in logical pixels has to be scaled before it is
 * divided down.
 */
export function thresholdToWorld(px: number, viewScale: number, dpr = 1): number {
  return (px * dpr) / viewScale;
}

/**
 * Does arming this right-toolbar tool clear the selection?
 *
 * Both placement entry points open with `m_toolMgr->RunAction(
 * ACTIONS::selectionClear )` — `PL_DRAWING_TOOLS::PlaceItem`
 * (pl_drawing_tools.cpp:77) and `::DrawShape` (:243). Nothing else does:
 * `ZOOM_TOOL::Main` only pushes itself (zoom_tool.cpp:65), and
 * `PL_EDIT_TOOL::InteractiveDelete` runs a `PICKER_TOOL` that adds its own
 * hover pick to the selection rather than emptying it (pl_edit_tool.cpp:417-440).
 *
 * So picking Draw Lines with a rectangle selected empties the Properties pane
 * in a real pl_editor; ours left the rectangle selected under the new tool.
 */
export function toolClearsSelection(toolId: string): boolean {
  return PLACEMENT_TOOLS.has(toolId);
}

/** The four `PL_ACTIONS` that route to `PlaceItem` / `DrawShape`. */
const PLACEMENT_TOOLS: ReadonlySet<string> = new Set([
  'dsAddLine', // PL_ACTIONS::drawLine
  'dsAddRect', // PL_ACTIONS::drawRectangle
  'dsAddText', // PL_ACTIONS::placeText
  'dsAddBitmap', // PL_ACTIONS::placeImage
]);
