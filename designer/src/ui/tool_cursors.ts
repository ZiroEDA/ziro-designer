// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The cursor an action wears, for the actions more than one editor has.
 *
 * Upstream a cursor belongs to the *tool*, and a tool that several frames
 * register is one class setting one `KICURSOR`. `ACTIONS::deleteTool` is the
 * clearest case: eeschema and the symbol editor share
 * `SCH_TOOL_BASE::InteractiveDelete` (`sch_tool_base.h:246-258`), pcbnew has
 * `PCB_CONTROL::DeleteItemCursor` (`pcb_control.cpp:833`) and pl_editor
 * `PL_EDIT_TOOL::DeleteItemCursor` (`pl_edit_tool.cpp:424`) — three separate
 * functions in three files, and all three say
 *
 *     picker->SetCursor( KICURSOR::REMOVE );
 *
 * So there is one answer per action, and it belongs in one place here rather
 * than in a ternary chain per canvas. It was five chains, and three of them
 * had no delete arm at all: the board editor, the footprint editor and the
 * symbol editor all showed a crosshair — or worse, the *pencil*, which reads
 * as a drawing tool — while the eraser only appeared in eeschema and the
 * drawing-sheet editor.
 *
 * **Scope: shared actions only.** A cursor that belongs to one editor's own
 * tool stays with that editor — eeschema's wire, bus and label cursors live in
 * `editors/schematic/cursors.ts`, which consults this for the shared ids and
 * answers the rest itself. This is not a registry of every cursor; it is the
 * set where two editors would otherwise have to agree by hand.
 */

import { kiCursor, type KiCursor } from './kicursors.js';

/**
 * Our tool ids are not all spelled alike: the one delete action is `delete` in
 * eeschema, `deleteTool` on the board and in the symbol and footprint editors,
 * and `dsDelete` in the drawing-sheet editor. All three spellings map to the
 * one action here. That divergence is ours, not KiCad's — upstream every one of
 * those toolbar rows is `ACTIONS::deleteTool` — and three names for one action
 * is precisely how the frames came to disagree about its cursor.
 */
const SHARED: Readonly<Record<string, KiCursor>> = {
  // `ACTIONS::deleteTool` — the eraser, in every frame that offers it.
  delete: 'REMOVE',
  deleteTool: 'REMOVE',
  dsDelete: 'REMOVE',
  // `ZOOM_TOOL::Main` (`zoom_tool.cpp:65-69`), which every canvas runs.
  zoomTool: 'ZOOM_IN',
  // `PCB_VIEWER_TOOLS::MeasureTool` (`pcb_viewer_tools.cpp:292`); the same
  // ruler eeschema, gerbview and the footprint frames all put up.
  measureTool: 'MEASURE',
  // `PCB_TOOL_BASE::doInteractiveItemPlacement`'s `setCursor` once an item
  // exists (`pcb_tool_base.cpp:121-128`), and the two origin pickers, which
  // set it outright (`pcb_control.cpp:791`, `board_editor_control.cpp:2309`).
  placePoint: 'PLACE',
  gridSetOrigin: 'PLACE',
  drillOrigin: 'PLACE',
};

/**
 * The `KICURSOR` this tool runs with in every editor that has it, or `null`
 * when the tool is one editor's own business.
 *
 * `null` rather than a fallback on purpose: what an editor shows for its *own*
 * tools differs — eeschema falls back to the pencil, the board editor to the
 * plain arrow — and a default here would quietly impose one of them on all of
 * them.
 */
export const sharedToolCursorName = (tool: string): KiCursor | null => SHARED[tool] ?? null;

/**
 * The CSS `cursor` for a tool: the shared answer when there is one, otherwise
 * whatever this editor shows for its own.
 *
 * `fallback` is a CSS value rather than a `KiCursor` because that is what the
 * editors actually differ on — the board editor's non-tool cursor is the plain
 * `default` arrow, the footprint editor's is `crosshair`.
 */
export const toolCursorCss = (tool: string, fallback: string): string => {
  const shared = sharedToolCursorName(tool);
  return shared ? kiCursor(shared) : fallback;
};
