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
import type { LIB_ID } from '@ziroeda/common/lib_id.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { DESIGN_BLOCK_CONTROL, TreeNodeLibId } from '@ziroeda/common/tool/design_block_control.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import type { DESIGN_BLOCK_PANE } from '@ziroeda/common/widgets/design_block_pane.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_ACTIONS } from './sch_actions.js';
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
  return TreeNodeLibId(aNode);
}

// ---------------------------------------------------------------------------------------------
// The live tool. The functional menu above is the record window's and goes when it switches.
// ---------------------------------------------------------------------------------------------

/** `SCH_DESIGN_BLOCK_CONTROL` (eeschema/tools/sch_design_block_control.{h,cpp}). */
export class SCH_DESIGN_BLOCK_CONTROL extends DESIGN_BLOCK_CONTROL {
  private m_editFrame: SCH_EDIT_FRAME | null = null;

  constructor() {
    super('eeschema.SchDesignBlockControl');
  }

  override Init(): boolean {
    this.m_editFrame = this.getEditFrame<SCH_EDIT_FRAME>();
    this.m_frame = this.m_editFrame;
    this.m_framesToNotify = [FRAME_T.FRAME_PCB_EDITOR];

    const isInLibrary = (aSel: SELECTION): boolean => this.selIsInLibrary(aSel);

    const isDesignBlock = (aSel: SELECTION): boolean => this.selIsDesignBlock(aSel);

    const hasSelection = (_aSel: SELECTION): boolean =>
      !this.m_editFrame!.GetCurrentSelection().Empty();

    const S_C = SELECTION_CONDITIONS;
    const ctxMenu = this.m_menu.GetMenu();
    this.AddContextMenuItems(ctxMenu);

    ctxMenu.AddItem(SCH_ACTIONS.placeDesignBlock, isDesignBlock, 50);
    ctxMenu.AddSeparator(50);

    ctxMenu.AddItem(SCH_ACTIONS.editDesignBlockProperties, isDesignBlock, 100);
    ctxMenu.AddItem(SCH_ACTIONS.saveSheetAsDesignBlock, isInLibrary, 100);
    ctxMenu.AddItem(
      SCH_ACTIONS.saveSelectionAsDesignBlock,
      S_C.And(isInLibrary, hasSelection),
      100,
    );
    ctxMenu.AddItem(SCH_ACTIONS.updateDesignBlockFromSheet, isDesignBlock, 100);
    ctxMenu.AddItem(
      SCH_ACTIONS.updateDesignBlockFromSelection,
      S_C.And(isDesignBlock, hasSelection),
      100,
    );
    ctxMenu.AddItem(SCH_ACTIONS.deleteDesignBlock, isDesignBlock, 100);
    ctxMenu.AddSeparator(100);

    return true;
  }

  *SaveSheetAsDesignBlock(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const current = this.getCurrentTreeNode();

    if (!current) return -1;

    // This can be modified as a result of the save operation so copy it
    const libId = TreeNodeLibId(current);

    const saved = yield* this.RunMainStackModal(() =>
      this.m_editFrame!.SaveSheetAsDesignBlock(
        libId.GetLibNickname(),
        this.m_editFrame!.GetCurrentSheet(),
      ),
    );

    if (!saved) return -1;

    this.notifyOtherFrames();

    return 0;
  }

  *SaveSelectionAsDesignBlock(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const current = this.getCurrentTreeNode();

    if (!current) return -1;

    // This can be modified as a result of the save operation so copy it
    const libId = TreeNodeLibId(current);

    const saved = yield* this.RunMainStackModal(() =>
      this.m_editFrame!.SaveSelectionAsDesignBlock(libId.GetLibNickname()),
    );

    if (!saved) return -1;

    this.notifyOtherFrames();

    return 0;
  }

  *UpdateDesignBlockFromSheet(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const current = this.getCurrentTreeNode();

    if (!current) return -1;

    // This can be modified as a result of the save operation so copy it
    const libId = TreeNodeLibId(current);

    const saved = yield* this.RunMainStackModal(() =>
      this.m_editFrame!.UpdateDesignBlockFromSheet(libId, this.m_editFrame!.GetCurrentSheet()),
    );

    if (!saved) return -1;

    this.notifyOtherFrames();

    return 0;
  }

  *UpdateDesignBlockFromSelection(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const current = this.getCurrentTreeNode();

    if (!current) return -1;

    // This can be modified as a result of the save operation so copy it
    const libId = TreeNodeLibId(current);

    const saved = yield* this.RunMainStackModal(() =>
      this.m_editFrame!.UpdateDesignBlockFromSelection(libId),
    );

    if (!saved) return -1;

    this.notifyOtherFrames();

    return 0;
  }

  protected override setTransitions(): void {
    super.setTransitions();

    this.Go(this.SaveSheetAsDesignBlock, SCH_ACTIONS.saveSheetAsDesignBlock.MakeEvent());
    this.Go(this.SaveSelectionAsDesignBlock, SCH_ACTIONS.saveSelectionAsDesignBlock.MakeEvent());
    this.Go(this.UpdateDesignBlockFromSheet, SCH_ACTIONS.updateDesignBlockFromSheet.MakeEvent());
    this.Go(
      this.UpdateDesignBlockFromSelection,
      SCH_ACTIONS.updateDesignBlockFromSelection.MakeEvent(),
    );
    this.Go(this.DeleteDesignBlock, SCH_ACTIONS.deleteDesignBlock.MakeEvent());
    this.Go(this.EditDesignBlockProperties, SCH_ACTIONS.editDesignBlockProperties.MakeEvent());
  }

  protected getDesignBlockPane(): DESIGN_BLOCK_PANE | null {
    return this.m_editFrame!.GetDesignBlockPane();
  }
}
