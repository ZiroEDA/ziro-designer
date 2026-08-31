// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_SELECTION_CONDITIONS`, the predicates a frame hands to
 * `TOOL_MANAGER::SetConditions` to decide whether a command is available
 * (`pcbnew/tools/pcb_selection_conditions.cpp`).
 *
 * Only the two lock conditions are ported here, because they are the two the
 * toolbar reads on every selection change — plus `BOARD::IsEmpty()`, which is
 * what `EDIT_TOOL::Init`'s `noItemsCondition` asks.
 */
import { parseBoardItemId } from './edit-board.js';
import type { Board } from './types.js';

/**
 * `BOARD_ITEM::IsLocked()` (`board_item.cpp:106`) with its two overrides.
 *
 *     if( EDA_GROUP* group = GetParentGroup() )
 *         if( group->AsEdaItem()->IsLocked() ) return true;
 *     return m_isLocked;
 *
 * `FOOTPRINT::IsLocked()` (`footprint.h:564`) overrides that and reads only its
 * own FP_is_LOCKED bit, so a footprint inside a locked group is not itself
 * locked. `PAD::IsLocked()` (`pad.cpp:330`) goes the other way and adds its
 * parent footprint on top of the base rule.
 */
export function itemIsLocked(board: Board, id: string): boolean {
  const ref = parseBoardItemId(id);
  if (ref === null) return false;

  // A footprint reads its own bit and nothing else.
  if (ref.kind === 'footprint') return board.footprints[ref.index]?.locked === true;

  // A pad is locked when its footprint is, before anything else.
  if (ref.kind === 'pad' && board.footprints[ref.index]?.locked === true) return true;

  if (inLockedGroup(board, id)) return true;

  switch (ref.kind) {
    case 'track':
      return board.tracks[ref.index]?.locked === true;
    case 'arc':
      return board.arcs[ref.index]?.locked === true;
    case 'via':
      return board.vias[ref.index]?.locked === true;
    case 'zone':
      return board.zones[ref.index]?.locked === true;
    case 'shape':
      return board.shapes[ref.index]?.locked === true;
    case 'text':
      return board.texts[ref.index]?.locked === true;
    case 'textbox':
      return board.textBoxes[ref.index]?.locked === true;
    case 'table':
      return board.tables[ref.index]?.locked === true;
    case 'image':
      return board.images[ref.index]?.locked === true;
    case 'dimension':
      return board.dimensions[ref.index]?.locked === true;
    case 'group':
      return board.groups[ref.index]?.locked === true;
    case 'fptext':
      return board.footprints[ref.index]?.texts[ref.sub ?? 0]?.locked === true;
    default:
      // 'pad' with an unlocked footprint: no lock of its own in this model.
      return false;
  }
}

/** Whether any group holding `id` as a member is itself locked. */
function inLockedGroup(board: Board, id: string): boolean {
  return board.groups.some((g) => g.locked === true && g.members.includes(id));
}

/**
 * `PCB_SELECTION_CONDITIONS::HasLockedItems` — true when *any* selected item is
 * locked, which is what enables Unlock.
 */
export function hasLockedItems(board: Board, selection: Iterable<string>): boolean {
  for (const id of selection) {
    if (itemIsLocked(board, id)) return true;
  }
  return false;
}

/**
 * `PCB_SELECTION_CONDITIONS::HasUnlockedItems` — true when *any* selected item
 * is unlocked, which is what enables Lock. Both are false on an empty
 * selection, so both buttons grey out with nothing selected.
 */
export function hasUnlockedItems(board: Board, selection: Iterable<string>): boolean {
  for (const id of selection) {
    if (!itemIsLocked(board, id)) return true;
  }
  return false;
}

/**
 * `BOARD::IsEmpty()` (`pcbnew/board.cpp:606-609`).
 *
 *     return m_drawings.empty() && m_footprints.empty() && m_tracks.empty()
 *            && m_zones.empty() && m_points.empty();
 *
 * `m_drawings` is the board-scope graphics container, so it covers the shapes,
 * texts, text boxes, tables, images and dimensions our `Board` keeps in six
 * separate arrays; `m_tracks` covers tracks, arcs and vias. `m_groups` is NOT
 * in the list upstream and so is not here — a board holding nothing but an
 * empty group counts as empty either way. We have no `m_points` counterpart.
 *
 * The one caller is `EDIT_TOOL::Init`'s `noItemsCondition`
 * (`edit_tool.cpp:732-735`), which gates Select All and Unselect All in the
 * canvas context menu:
 *
 *     return frame()->GetBoard() && !frame()->GetBoard()->IsEmpty();
 *
 * Note what it does not look at: the SELECTION. Both rows are live whenever the
 * board has anything on it, whether or not something is selected.
 */
export function boardIsEmpty(board: Board): boolean {
  return (
    board.footprints.length === 0 &&
    board.tracks.length === 0 &&
    board.arcs.length === 0 &&
    board.vias.length === 0 &&
    board.zones.length === 0 &&
    board.shapes.length === 0 &&
    board.texts.length === 0 &&
    board.textBoxes.length === 0 &&
    board.tables.length === 0 &&
    board.images.length === 0 &&
    board.dimensions.length === 0
  );
}
