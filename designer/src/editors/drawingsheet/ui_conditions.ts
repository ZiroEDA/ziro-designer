// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PL_EDITOR_FRAME::setupUIConditions` (pl_editor_frame.cpp:305-368) — the
 * table that decides which menu rows and toolbar buttons are greyed out, and
 * which paint checked.
 *
 * Upstream this is one table read by both the menu and the toolbar, because an
 * `ACTION_TOOLBAR` button and a menu row share the action's
 * `ACTION_CONDITIONS`. Ours has to be one module for the same reason: a rule
 * restated at two call sites drifts at one of them.
 *
 * `.ts` and not part of the frame component so the suite can execute the rules
 * rather than grep for them.
 */

/** How deep the two stacks are — `GetUndoCommandCount()` / `GetRedoCommandCount()`. */
export interface HistoryDepth {
  readonly undo: number;
  readonly redo: number;
}

/**
 * What the frame knows about which interactive tool is running. Upstream reads
 * this off `TOOLS_HOLDER::m_toolStack` and the selection's edit flags; ours
 * keeps the same two facts in React state.
 */
export interface ToolState {
  /** The armed right-toolbar tool. `'select'` is "nothing pushed". */
  readonly activeTool: string;
  /** An item is being dragged — `IS_MOVING` on the selection front. */
  readonly moving: boolean;
  /** A shape is mid-placement — `IS_NEW` on the selection front. */
  readonly drawing: boolean;
}

/**
 * `ENABLE( cond.UndoAvailable() )` / `RedoAvailable()`
 * (pl_editor_frame.cpp:319-320), which resolve to `GetUndoCommandCount() > 0`
 * and `GetRedoCommandCount() > 0` (editor_conditions.cpp:169-178).
 */
export function undoEnabled(depth: HistoryDepth): boolean {
  return depth.undo > 0;
}

export function redoEnabled(depth: HistoryDepth): boolean {
  return depth.redo > 0;
}

/**
 * `ENABLE( SELECTION_CONDITIONS::Idle && cond.NoActiveTool() )` on
 * `ACTIONS::paste` (pl_editor_frame.cpp:326).
 *
 * `NoActiveTool` is `ToolStackIsEmpty()` (editor_conditions.cpp:195-198): a
 * drawing tool, the delete tool and the zoom-area tool all `PushTool`
 * (pl_drawing_tools.cpp:81, :245; pl_edit_tool.cpp:128), so any of them armed
 * greys Paste out. `Idle` is the selection carrying none of
 * `IS_NEW | IS_PASTED | IS_MOVING` (selection_conditions.cpp:47-52), which
 * covers the moment between the two clicks of a placement and a drag in
 * progress.
 *
 * Cut, Copy and Delete take `SELECTION_CONDITIONS::NotEmpty` instead
 * (:328-331) — those are already wired.
 */
export function pasteEnabled(tools: ToolState): boolean {
  return tools.activeTool === 'select' && !tools.moving && !tools.drawing;
}

/**
 * The toolbar's half of the same table. `ACTION_TOOLBAR::RefreshBitmaps` walks
 * the action manager's conditions, so a top-toolbar Undo greys out with the
 * Edit menu's row and never separately.
 */
export function toolbarDisabledIds(depth: HistoryDepth): ReadonlySet<string> {
  const out = new Set<string>();

  if (!undoEnabled(depth)) out.add('undo');
  if (!redoEnabled(depth)) out.add('redo');

  return out;
}
