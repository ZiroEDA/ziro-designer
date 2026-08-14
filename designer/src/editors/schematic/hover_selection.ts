// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Hover selections, `SELECTION::SetIsHover` / `IsHover`.
 *
 * A right-click that lands on something not already selected picks it up only
 * so the context menu has something to aim at, and marks what it picked as
 * disposable. `SCH_SELECTION_TOOL::Main` (sch_selection_tool.cpp:992):
 *
 *     if( m_selection.Empty() )
 *     {
 *         ClearSelection();
 *         SelectPoint( evt->Position(), { SCH_LOCATE_ANY_T }, nullptr, &selCancelled );
 *         m_selection.SetIsHover( true );
 *     }
 *     …
 *     if( !selCancelled )
 *         m_menu->ShowContextMenu( m_selection );
 *
 * Two things follow, and both are visible. Every action that runs off a hover
 * selection throws it away when it finishes (`if( selection.IsHover() ) …
 * selectionClear`). And the point editor never brings its handles up on one —
 * so right-clicking a sheet cold gives a menu over a highlighted sheet with no
 * resize grips, while right-clicking a sheet that a left-click already selected
 * keeps the grips, because that branch never runs and the selection is left
 * alone, flag included.
 *
 * The flag is kept here as *the set it applies to* rather than as a boolean.
 * Upstream's lives on the selection object and dies with it; holding the set
 * gives the same lifetime for free, since any other selection is a different
 * set and stops matching.
 *
 * This is a plain module rather than component state because qa compiles `.ts`
 * only, and a rule nobody can test is a rule that quietly rots.
 */

/** A selection and, when it is a hover one, the set that hover applies to. */
export interface HoverSelection {
  readonly selection: ReadonlySet<string>;
  readonly hover: ReadonlySet<string> | null;
}

/** Whether the current selection is the disposable one a right-click made. */
export const isHoverSelection = (state: HoverSelection): boolean =>
  state.hover !== null && state.hover === state.selection;

/**
 * The selection after a right-click on `hitId` (null for empty canvas).
 *
 * An item that is already selected is not re-picked and its flag is not
 * touched, so right-clicking the same thing twice does not turn a hover
 * selection into a real one.
 *
 * `promote` is the caller's group promotion — a right-click on a grouped item
 * selects the group, not the item.
 */
export function rightClickSelection(
  state: HoverSelection,
  hitId: string | null,
  promote: (id: string) => Iterable<string>,
): HoverSelection {
  if (hitId === null || state.selection.has(hitId)) return state;
  const hover: ReadonlySet<string> = new Set(promote(hitId));
  return { selection: hover, hover };
}

/**
 * Whether the point editor should show its handles.
 *
 * `SCH_POINT_EDITOR::Main` needs exactly one selected item of an editable type
 * and refuses one still being drawn:
 *
 *     if( selection.Size() != 1 || !selection.Front()->IsType( pointEditorTypes ) )
 *         return 0;
 *     if( selection.Front()->IsNew() )
 *         return 0;
 *
 * The type test is the caller's (`pointEditTarget`); what is decided here is
 * the count, the mid-draw state and the hover.
 */
export function editHandlesVisible(state: HoverSelection, stillDrawing: boolean): boolean {
  return state.selection.size === 1 && !stillDrawing && !isHoverSelection(state);
}
