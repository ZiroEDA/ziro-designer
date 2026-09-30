// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_DESIGN_BLOCK_CONTROL` (eeschema/tools/sch_design_block_control.cpp) on
 * `DESIGN_BLOCK_CONTROL` (common/tool/design_block_control.cpp): the Design
 * Blocks tree's context menu — which rows appear for the node under the
 * pointer — and the commands behind them, each run on the frame and followed
 * by `notifyOtherFrames` (a `MAIL_RELOAD_LIB` to the board editor).
 */
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { type LibTreeNode, LibTreeNodeType } from '@ziroeda/common/lib_tree_model.js';
import type { MenuItem } from '@ziroeda/common/tool/action_menu_types.js';
import {
  type ConditionalEntry,
  evaluateConditionalMenu,
  menuEntry,
  menuSeparator,
} from '@ziroeda/common/tool/conditional_menu.js';

/** `SCH_ACTIONS` / `ACTIONS` names, FriendlyName and the id the handler receives. [data] */
export const SCH_DESIGN_BLOCK_ACTIONS = {
  pinLibrary: 'Pin Library',
  unpinLibrary: 'Unpin Library',
  newLibrary: 'New Library...',
  placeDesignBlock: 'Place Design Block',
  editDesignBlockProperties: 'Properties...',
  saveSheetAsDesignBlock: 'Save Current Sheet as Design Block...',
  saveSelectionAsDesignBlock: 'Save Selection as Design Block...',
  updateDesignBlockFromSheet: 'Update Design Block from Current Sheet',
  updateDesignBlockFromSelection: 'Update Design Block from Selection',
  deleteDesignBlock: 'Delete Design Block',
  hideLibraryTree: 'Hide Library Tree',
} as const;

export type SCH_DESIGN_BLOCK_ACTION = keyof typeof SCH_DESIGN_BLOCK_ACTIONS;

function row(
  aAction: (aId: SCH_DESIGN_BLOCK_ACTION) => void,
  aId: SCH_DESIGN_BLOCK_ACTION,
  aWhen: boolean,
  aOrder: number,
): ConditionalEntry {
  const item: MenuItem = {
    label: SCH_DESIGN_BLOCK_ACTIONS[aId],
    icon: aId,
    action: () => aAction(aId),
  };
  return menuEntry(item, aOrder, aWhen);
}

/**
 * The context menu for \a aNode (the tree's current node, or null):
 * `DESIGN_BLOCK_CONTROL::AddContextMenuItems` (orders 1 and 400) and
 * `SCH_DESIGN_BLOCK_CONTROL::Init` (orders 50 and 100).
 *
 * @param aHasSelection `!m_editFrame->GetCurrentSelection().Empty()`.
 */
export function SchDesignBlockContextMenu(
  aNode: LibTreeNode | null,
  aHasSelection: boolean,
  aAction: (aId: SCH_DESIGN_BLOCK_ACTION) => void,
): MenuItem[] {
  const isLibrary = aNode?.type === LibTreeNodeType.LIBRARY;
  const pinnedLib = isLibrary && aNode!.pinned;
  const unpinnedLib = isLibrary && !aNode!.pinned;
  // selIsInLibrary / selIsDesignBlock
  const isInLibrary = !!aNode && (isLibrary || aNode.type === LibTreeNodeType.ITEM);
  const isDesignBlock = aNode?.type === LibTreeNodeType.ITEM;

  return evaluateConditionalMenu([
    row(aAction, 'pinLibrary', unpinnedLib, 1),
    row(aAction, 'unpinLibrary', pinnedLib, 1),
    row(aAction, 'newLibrary', true, 1),
    menuSeparator(2),

    row(aAction, 'placeDesignBlock', isDesignBlock, 50),
    menuSeparator(50),

    row(aAction, 'editDesignBlockProperties', isDesignBlock, 100),
    row(aAction, 'saveSheetAsDesignBlock', isInLibrary, 100),
    row(aAction, 'saveSelectionAsDesignBlock', isInLibrary && aHasSelection, 100),
    row(aAction, 'updateDesignBlockFromSheet', isDesignBlock, 100),
    row(aAction, 'updateDesignBlockFromSelection', isDesignBlock && aHasSelection, 100),
    row(aAction, 'deleteDesignBlock', isDesignBlock, 100),
    menuSeparator(100),

    menuSeparator(400),
    row(aAction, 'hideLibraryTree', true, 400),
  ]);
}

/** The node's LIB_ID: `current->m_LibId` (a library node's has no item name). */
export function DesignBlockNodeLibId(aNode: LibTreeNode): LIB_ID {
  return new LIB_ID(
    aNode.libNickname,
    aNode.type === LibTreeNodeType.ITEM ? aNode.libItemName : '',
  );
}
