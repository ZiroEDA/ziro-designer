// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which board tools pull the crosshair onto items, and which leave it on the
 * grid.
 *
 * `PCB_PICKER_TOOL::Main` (`pcb_picker_tool.cpp:38-52`) asks
 * `PCB_GRID_HELPER::BestSnapAnchor` and forces the cursor onto its answer
 * only `if( m_snap )`. Three pickers switch that off before they start:
 *
 *     BOARD_INSPECTION_TOOL::LocalRatsnestTool   board_inspection_tool.cpp:2297
 *     BOARD_INSPECTION_TOOL::HighlightNetTool    board_inspection_tool.cpp:303
 *     PCB_CONTROL::DeleteItemCursor              pcb_control.cpp:834
 *         -> picker->SetSnapping( false );
 *
 * With `m_snap` off nothing calls `ForceCursorPosition`, so the drawn
 * crosshair is `WX_VIEW_CONTROLS::GetCursorPosition()` with
 * `m_snappingEnabled` at its constructor default of true
 * (`view_controls.cpp:64`): `GetGridPoint( m_cursorPos )`, the grid and
 * nothing else. The click itself uses `controls->GetMousePosition()`, the
 * raw pointer, so what the pick hits is what is under the mouse, not what
 * the crosshair sits on.
 *
 * Ours routed both pickers through `bestSnapAnchor` with the drawing tools,
 * so the crosshair leapt onto pads as the ratsnest tool passed over them.
 */
const NO_SNAP_PICKERS: ReadonlySet<string> = new Set(['localRatsnestTool', 'deleteTool']);

/** True when the tool's crosshair follows the grid only, never an item. */
export const pickerSnapsToGridOnly = (tool: string): boolean => NO_SNAP_PICKERS.has(tool);
