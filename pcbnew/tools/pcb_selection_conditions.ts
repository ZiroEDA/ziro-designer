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
import { parseBoardItemId } from '../edit-board.js';
import type { Board } from '../types.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import type { SELECTION_CONDITION } from '@ziroeda/common/tool/selection_conditions.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import { UNCONNECTED_NET as NETINFO_LIST_UNCONNECTED } from '../netinfo_list.js';

/** Whether any group holding `id` as a member is itself locked. */
function inLockedGroup(board: Board, id: string): boolean {
  return board.groups.some((g) => g.locked === true && g.members.includes(id));
}

/**
 * `PCB_SELECTION_CONDITIONS` (pcb_selection_conditions.cpp): the selection
 * predicates on live BOARD_ITEMs.
 */
export class PCB_SELECTION_CONDITIONS {
  /**
   * Create a functor that tests if selection contains items that belong exclusively to the same
   * net.
   */
  static SameNet(aAllowUnconnected = false): SELECTION_CONDITION {
    return (aSelection) => PCB_SELECTION_CONDITIONS.sameNetFunc(aSelection, aAllowUnconnected);
  }

  /** Create a functor that tests if selection contains items that belong exclusively to the same layer. */
  static SameLayer(): SELECTION_CONDITION {
    return (aSelection) => PCB_SELECTION_CONDITIONS.sameLayerFunc(aSelection);
  }

  static HasLockedItems(aSelection: SELECTION): boolean {
    for (const item of aSelection.Items()) {
      if (item.IsBOARD_ITEM() && (item as BOARD_ITEM).IsLocked()) return true;
    }

    return false;
  }

  static HasUnlockedItems(aSelection: SELECTION): boolean {
    for (const item of aSelection.Items()) {
      if (item.IsBOARD_ITEM() && !(item as BOARD_ITEM).IsLocked()) return true;
    }

    return false;
  }

  private static sameNetFunc(aSelection: SELECTION, aAllowUnconnected: boolean): boolean {
    if (aSelection.Empty()) return false;

    let netcode = -1; // -1 stands for 'net code is not yet determined'

    for (const aitem of aSelection) {
      let current_netcode = -1;

      const item = (aitem as BOARD_ITEM).IsConnected()
        ? (aitem as unknown as BOARD_CONNECTED_ITEM)
        : null;

      if (item) {
        current_netcode = item.GetNetCode();
      } else {
        if (!aAllowUnconnected) return false;
        // if it is not a BOARD_CONNECTED_ITEM, treat it as if there was no net assigned
        else current_netcode = 0;
      }

      if (netcode < 0) {
        netcode = current_netcode;

        if (netcode === NETINFO_LIST_UNCONNECTED && !aAllowUnconnected) return false;
      } else if (netcode !== current_netcode) {
        return false;
      }
    }

    return true;
  }

  private static sameLayerFunc(aSelection: SELECTION): boolean {
    if (aSelection.Empty()) return false;

    let layerSet = new LSET();
    layerSet.set();

    for (const i of aSelection) {
      const item = i as BOARD_ITEM;
      layerSet = layerSet.and(item.GetLayerSet());

      if (!layerSet.any())
        // there are no common layers left
        return false;
    }

    return true;
  }
}
