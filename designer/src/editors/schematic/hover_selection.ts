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

import {
  type ItemRef,
  type ScanTypes,
  type Schematic,
  selectPoint,
  trimToScanTypes,
} from '@ziroeda/eeschema';

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

/** A resolved command target and the selection state that resolving it left. */
export interface RequestedSelection {
  /** The ids the command acts on — empty means there is nothing to do. */
  readonly target: ReadonlySet<string>;
  /** What the selection becomes: the pick, the trim, or the state unchanged. */
  readonly state: HoverSelection;
}

const NOTHING: ReadonlySet<string> = new Set<string>();

/**
 * `SCH_SELECTION_TOOL::RequestSelection` (sch_selection_tool.cpp:1945-1994):
 * where **every** editing command gets the items it acts on.
 *
 *     if( m_selection.Empty() )
 *     {
 *         VECTOR2D cursorPos = getViewControls()->GetCursorPosition( true );
 *         ClearSelection();
 *         SelectPoint( cursorPos, aScanTypes );
 *         m_selection.SetIsHover( true );
 *         m_selection.ClearReferencePoint();
 *     }
 *     else        // Trim an existing selection by aFilterList
 *     {
 *         for( int i = (int) m_selection.GetSize() - 1; i >= 0; --i )
 *         {
 *             EDA_ITEM* item = (EDA_ITEM*) m_selection.GetItem( i );
 *             if( !item->IsType( aScanTypes ) )
 *             {
 *                 unselect( item );
 *                 anyUnselected = true;
 *             }
 *         }
 *     }
 *
 * This is why hovering an unselected symbol and pressing R rotates it: R is not
 * special, it is one of two dozen commands that ask here. Delete, move, drag,
 * duplicate, properties and the rest all inherit the same behaviour from the
 * same function, which is the reason it has to be one function here too.
 *
 * `candidates` is what `collectAndGuess` found under the cursor, closest first;
 * `resolve` is the rest of what `SelectPoint` does once a candidate wins — the
 * Selection Filter and group promotion, both of which need the editor's live
 * settings. Whatever comes back is marked as a hover selection, and
 * `clearHoverSelection` throws it away when the command finishes.
 */
export function requestSelection(
  doc: Schematic,
  state: HoverSelection,
  scanTypes: ScanTypes,
  candidates: readonly ItemRef[],
  resolve: (id: string) => Iterable<string>,
): RequestedSelection {
  if (state.selection.size === 0) {
    const hit = selectPoint(candidates, scanTypes);
    if (hit === null) return { target: NOTHING, state: { selection: NOTHING, hover: null } };
    const hover: ReadonlySet<string> = new Set(resolve(hit.id));
    // A pick the Selection Filter rejects outright leaves nothing selected,
    // exactly as `SelectPoint` returning false does.
    if (hover.size === 0) return { target: NOTHING, state: { selection: NOTHING, hover: null } };
    return { target: hover, state: { selection: hover, hover } };
  }
  const trimmed = trimToScanTypes(doc, state.selection, scanTypes);
  if (trimmed === state.selection) return { target: state.selection, state };
  // The trim branch never touches `SetIsHover`, so a hover selection that gets
  // trimmed is still a hover selection and still gets cleared on finish.
  return {
    target: trimmed,
    state: { selection: trimmed, hover: isHoverSelection(state) ? trimmed : null },
  };
}

/**
 * The other half, run once the command is done:
 *
 *     if( selection.IsHover() )
 *         m_toolMgr->RunAction( ACTIONS::selectionClear );
 *
 * — sch_edit_tool.cpp:1278 (Rotate), :1491 (Mirror), :2502 (AutoplaceFields),
 * :2561 (Change Body Style), :2571 (Properties), :3421 (CleanupSheetPins),
 * :3614 (SetAttribute); sch_editor_control.cpp:1772 (doCopy/Duplicate),
 * :1849 (CopyAsText), :2852; sch_move_tool.cpp:1110 (`aUnselect`).
 *
 * So a hover-driven rotate does not leave the symbol selected afterwards. A
 * selection the user made themselves is left alone.
 */
export function clearHoverSelection(state: HoverSelection): HoverSelection {
  return isHoverSelection(state) ? { selection: NOTHING, hover: null } : state;
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
