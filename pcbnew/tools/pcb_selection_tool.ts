// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a right-click does to the selection before the context menu opens.
 *
 * `PCB_SELECTION_TOOL::Main` (pcbnew/tools/pcb_selection_tool.cpp:359-379):
 *
 *     else if( evt->IsClick( BUT_RIGHT ) )
 *     {
 *         m_disambiguateTimer.Stop();
 *
 *         // Right click? if there is any object - show the context menu
 *         bool selectionCancelled = false;
 *
 *         if( m_selection.Empty() )
 *         {
 *             selectPoint( evt->Position(), false, &selectionCancelled );
 *             m_selection.SetIsHover( true );
 *         }
 *
 *         // Show selection before opening menu
 *         m_frame->GetCanvas()->ForceRefresh();
 *
 *         if( !selectionCancelled )
 *         {
 *             m_toolMgr->VetoContextMenuMouseWarp();
 *             m_menu->ShowContextMenu( m_selection );
 *         }
 *     }
 *
 * The whole rule is the one `if`. A non-empty selection is never re-picked, so
 * what sits under the pointer does not matter: right-clicking a footprint's
 * reference text, one of its pads or a silkscreen line while the footprint is
 * selected gives the *footprint's* menu, and right-clicking bare canvas gives
 * the selection's menu too rather than clearing it.
 *
 * This is deliberately **not** eeschema's rule. `SCH_SELECTION_TOOL::Main`
 * (eeschema/tools/sch_selection_tool.cpp:643-672) has a second branch that
 * re-picks when the click lands more than a grid square outside the selection's
 * bounding box and there is something there to pick — the comment says "the user
 * likely meant to get the context menu for that item". pcbnew has no such
 * branch, and adding one here would be inventing behaviour.
 *
 * A module of its own because `PcbEditor.tsx` cannot be compiled by qa's tsc
 * (no `--jsx`), and a rule with no test is a rule that drifts back — this one
 * already had.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { SelectionFilter } from '../dialogs/dialog_filter_selection.js';
import type { FOOTPRINT } from '../footprint.js';

/**
 * The item a right-click should pick up before the menu opens, or `null` for
 * "leave the selection exactly as it is".
 *
 * `hit` is the top candidate of the editor's hit test — what `selectPoint`
 * would land on — or null over bare canvas. What the caller then does with the
 * id is `selectPoint`'s own business: the Selection Filter and group promotion
 * both live there and neither is a property of this rule.
 */
export function contextMenuPick(selection: ReadonlySet<string>, hit: string | null): string | null {
  return selection.size > 0 ? null : hit;
}

/**
 * `itemIsIncludedByFilter` (pcb_selection_tool.cpp:3227-3274): whether a live
 * item survives Filter Selection. Inclusive - a type the dialog has no box
 * for (a pad, a group, a reference image, a point) is dropped.
 */
export function itemIsIncludedByFilter(
  aItem: BOARD_ITEM,
  aFilterOptions: SelectionFilter,
): boolean {
  switch (aItem.Type()) {
    case KICAD_T.PCB_FOOTPRINT_T:
      return (
        aFilterOptions.footprints &&
        (aFilterOptions.lockedFootprints || !(aItem as FOOTPRINT).IsLocked())
      );

    case KICAD_T.PCB_TRACE_T:
    case KICAD_T.PCB_ARC_T:
      return aFilterOptions.tracks;

    case KICAD_T.PCB_VIA_T:
      return aFilterOptions.vias;

    case KICAD_T.PCB_ZONE_T:
      return aFilterOptions.zones;

    case KICAD_T.PCB_SHAPE_T:
    case KICAD_T.PCB_TARGET_T:
    case KICAD_T.PCB_DIM_ALIGNED_T:
    case KICAD_T.PCB_DIM_CENTER_T:
    case KICAD_T.PCB_DIM_RADIAL_T:
    case KICAD_T.PCB_DIM_ORTHOGONAL_T:
    case KICAD_T.PCB_DIM_LEADER_T:
      if (aItem.GetLayer() === PCB_LAYER_ID.Edge_Cuts) return aFilterOptions.boardOutline;
      else return aFilterOptions.techLayers;

    case KICAD_T.PCB_FIELD_T:
    case KICAD_T.PCB_TEXT_T:
    case KICAD_T.PCB_TEXTBOX_T:
    case KICAD_T.PCB_TABLE_T:
    case KICAD_T.PCB_TABLECELL_T:
      return aFilterOptions.text;

    default:
      // Filter dialog is inclusive, not exclusive.  If it's not included, then it doesn't
      // get selected.
      return false;
  }
}

/**
 * `PCB_SELECTION_TOOL::filterSelection`'s OK branch (:3277-3311): the
 * selection's board items that pass, in selection order - what it
 * re-selects after clearing the selection.
 */
export function filterSelectionItems(
  aSelection: Iterable<EDA_ITEM>,
  aFilterOptions: SelectionFilter,
): BOARD_ITEM[] {
  const out: BOARD_ITEM[] = [];

  for (const i of aSelection) {
    if (!i.IsBOARD_ITEM()) continue;

    const item = i as BOARD_ITEM;

    if (itemIsIncludedByFilter(item, aFilterOptions)) out.push(item);
  }

  return out;
}
