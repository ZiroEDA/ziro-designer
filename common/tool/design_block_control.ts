// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DESIGN_BLOCK_CONTROL` (common/tool/design_block_control.{h,cpp}): the Design Blocks tree's
 * library actions - pin, unpin, new library, delete, properties, hide the tree - shared by the
 * schematic and board editors' design block tools.
 */
import type { EDA_DRAW_FRAME } from '../eda_draw_frame.js';
import type { FRAME_T } from '../frame_type.js';
import { LIB_ID } from '../lib_id.js';
import { type LibTreeNode, LibTreeNodeType } from '../lib_tree_model.js';
import type { MAIL_PAYLOAD } from '../kiway_mail.js';
import { MAIL_T } from '../mail_type.js';
import { LIB_TYPE_T } from '../project.js';
import type { DESIGN_BLOCK_PANE } from '../widgets/design_block_pane.js';
import { ACTIONS } from './actions.js';
import type { CONDITIONAL_MENU } from './conditional_menu.js';
import type { COROUTINE_BODY } from './coroutine.js';
import type { SELECTION } from './selection.js';
import { SELECTION_CONDITIONS } from './selection_conditions.js';
import type { RESET_REASON } from './tool_base.js';
import type { TOOL_EVENT } from './tool_event.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from './tool_interactive.js';

/** `current->m_LibId`: the row's LIB_ID (a library row has no item name). */
export function TreeNodeLibId(aNode: LibTreeNode): LIB_ID {
  return new LIB_ID(
    aNode.libNickname,
    aNode.type === LibTreeNodeType.ITEM ? aNode.libItemName : '',
  );
}

export abstract class DESIGN_BLOCK_CONTROL extends TOOL_INTERACTIVE {
  /// Notify other frames that the design block lib table has changed
  protected m_framesToNotify: FRAME_T[] = [];

  protected m_frame: EDA_DRAW_FRAME | null = null;

  override Reset(_aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<EDA_DRAW_FRAME>();
  }

  AddContextMenuItems(aMenu: CONDITIONAL_MENU): void {
    const pinnedLib = (_aSel: SELECTION): boolean => {
      //
      const current = this.getCurrentTreeNode();
      return !!current && current.type === LibTreeNodeType.LIBRARY && current.pinned;
    };

    const unpinnedLib = (_aSel: SELECTION): boolean => {
      const current = this.getCurrentTreeNode();
      return !!current && current.type === LibTreeNodeType.LIBRARY && !current.pinned;
    };

    aMenu.AddItem(ACTIONS.pinLibrary, unpinnedLib, 1);
    aMenu.AddItem(ACTIONS.unpinLibrary, pinnedLib, 1);
    aMenu.AddItem(ACTIONS.newLibrary, SELECTION_CONDITIONS.ShowAlways, 1);
    aMenu.AddSeparator(2);

    aMenu.AddSeparator(400);
    aMenu.AddItem(ACTIONS.hideLibraryTree, SELECTION_CONDITIONS.ShowAlways, 400);
  }

  PinLibrary(_aEvent: TOOL_EVENT): number {
    const current = this.getCurrentTreeNode();

    if (current && !current.pinned) {
      this.m_frame!.Prj().PinLibrary(
        TreeNodeLibId(current).GetLibNickname(),
        LIB_TYPE_T.DESIGN_BLOCK_LIB,
      );
      current.pinned = true;
      this.getDesignBlockPane()!.RefreshLibs();
      this.notifyOtherFrames();

      return 0;
    }

    return -1;
  }

  UnpinLibrary(_aEvent: TOOL_EVENT): number {
    const current = this.getCurrentTreeNode();

    if (current?.pinned) {
      this.m_frame!.Prj().UnpinLibrary(
        TreeNodeLibId(current).GetLibNickname(),
        LIB_TYPE_T.DESIGN_BLOCK_LIB,
      );
      current.pinned = false;
      this.getDesignBlockPane()!.RefreshLibs();
      this.notifyOtherFrames();

      return 0;
    }

    return -1;
  }

  *NewLibrary(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const name = yield* this.RunMainStackModal(() =>
      this.getDesignBlockPane()!.CreateNewDesignBlockLibrary('New Design Block Library'),
    );

    if (name) {
      this.notifyOtherFrames();
      return 0;
    }

    return -1;
  }

  *DeleteDesignBlock(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const current = this.getCurrentTreeNode();

    if (!current) return -1;

    const libId = TreeNodeLibId(current);

    if (
      yield* this.RunMainStackModal(() =>
        this.getDesignBlockPane()!.DeleteDesignBlockFromLibrary(libId, true),
      )
    ) {
      this.notifyOtherFrames();
      return 0;
    }

    return -1;
  }

  *EditDesignBlockProperties(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const current = this.getCurrentTreeNode();

    if (!current) return -1;

    const libId = TreeNodeLibId(current);

    if (
      yield* this.RunMainStackModal(() =>
        this.getDesignBlockPane()!.EditDesignBlockProperties(libId),
      )
    ) {
      this.notifyOtherFrames();
      return 0;
    }

    return -1;
  }

  HideLibraryTree(_aEvent: TOOL_EVENT): number {
    this.m_frame!.ToggleLibraryTree();
    return 0;
  }

  protected selIsInLibrary(_aSel: SELECTION): boolean {
    const current = this.getCurrentTreeNode();
    return (
      !!current &&
      (current.type === LibTreeNodeType.LIBRARY || current.type === LibTreeNodeType.ITEM)
    );
  }

  protected selIsDesignBlock(_aSel: SELECTION): boolean {
    const current = this.getCurrentTreeNode();
    return !!current && current.type === LibTreeNodeType.ITEM;
  }

  protected getSelectedLibId(): LIB_ID {
    this.getDesignBlockPane()!.GetSelectedLibId();

    return new LIB_ID();
  }

  protected override setTransitions(): void {
    this.Go(SYNC_HANDLER(this.PinLibrary), ACTIONS.pinLibrary.MakeEvent());
    this.Go(SYNC_HANDLER(this.UnpinLibrary), ACTIONS.unpinLibrary.MakeEvent());
    this.Go(this.NewLibrary, ACTIONS.newLibrary.MakeEvent());
    this.Go(SYNC_HANDLER(this.HideLibraryTree), ACTIONS.hideLibraryTree.MakeEvent());
  }

  protected abstract getDesignBlockPane(): DESIGN_BLOCK_PANE | null;

  protected getCurrentTreeNode(): LibTreeNode | null {
    const libTree = this.getDesignBlockPane()?.GetDesignBlockPanel().GetLibTree() ?? null;
    return libTree ? libTree.GetCurrentTreeNode() : null;
  }

  protected notifyOtherFrames(): void {
    const payload: MAIL_PAYLOAD = { value: '' };

    for (const frame of this.m_framesToNotify)
      this.m_frame!.Kiway()?.ExpressMail(frame, MAIL_T.MAIL_RELOAD_LIB, payload);
  }
}
