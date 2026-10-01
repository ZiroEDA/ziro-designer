// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_GROUP_TOOL` (`pcbnew/tools/pcb_group_tool.cpp`, `pcb_group_tool.h`):
 * GROUP_TOOL's board half - Group, PickNewMember and the three hooks - on the
 * live BOARD, committing through a BOARD_COMMIT. Ungroup, Add to Group,
 * Remove from Group, Enter / Leave Group and the Grouping submenu are the
 * base class's (`common/tool/group_tool.ts`).
 */
import type { COMMIT } from '@ziroeda/common/commit.js';
import type { EDA_GROUP } from '@ziroeda/common/eda_group.js';
import { type EDA_ITEM, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import * as KIPLATFORM_UI from '@ziroeda/common/kiplatform/ui.js';
import { STATUS_TEXT_POPUP } from '@ziroeda/common/status_popup.js';
import { ACTIONS, EVENTS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { GROUP_TOOL } from '@ziroeda/common/tool/group_tool.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '../board.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD_ITEM } from '../board_item.js';
import { PCB_GROUP } from '../pcb_group.js';
import { type PCB_PICKER_TOOL, popupFocus } from './pcb_picker_tool.js';
import type { PCB_SELECTION_TOOL } from './pcb_selection_tool.js';

export class PCB_GROUP_TOOL extends GROUP_TOOL {
  private selTool(): PCB_SELECTION_TOOL {
    return this.m_toolMgr!.FindTool('common.InteractiveSelection') as unknown as PCB_SELECTION_TOOL;
  }

  protected createCommit(): COMMIT {
    return new BOARD_COMMIT(
      this.m_toolMgr!,
      this.m_frame!.IsType(FRAME_T.FRAME_PCB_EDITOR),
      this.m_frame!.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR),
    );
  }

  protected canGroupItem(aItem: EDA_ITEM | null, aErrorMsg: { value: string }): boolean {
    if (!aItem?.IsBOARD_ITEM()) {
      aErrorMsg.value = 'Some selected items cannot be grouped.';
      return false;
    }

    const isFootprintEditor = this.m_frame!.GetFrameType() === FRAME_T.FRAME_FOOTPRINT_EDITOR;
    const boardItem = aItem as BOARD_ITEM;

    if (!isFootprintEditor && boardItem.GetParentFootprint()) {
      aErrorMsg.value = 'Footprint items cannot be grouped separately from their parent footprint.';
      return false;
    }

    if (!boardItem.IsGroupableType()) {
      aErrorMsg.value = 'Some selected items cannot be grouped.';
      return false;
    }

    return true;
  }

  protected getGroupFromItem(aItem: EDA_ITEM): EDA_GROUP | null {
    if (aItem.Type() === KICAD_T.PCB_GROUP_T) return aItem as unknown as PCB_GROUP;

    return null;
  }

  /**
   * Invoke the picker tool to select a new member of the group.
   */
  *PickNewMember(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const isFootprintEditor = this.m_frame!.GetFrameType() === FRAME_T.FRAME_FOOTPRINT_EDITOR;
    const selTool = this.selTool();
    const picker = this.m_toolMgr!.FindTool(
      'pcbnew.InteractivePicker',
    ) as unknown as PCB_PICKER_TOOL;

    const statusPopup = new STATUS_TEXT_POPUP();
    let done = false;

    if (this.m_propertiesDialog) this.m_propertiesDialog.Show(false);

    this.Activate();

    statusPopup.SetText('Click on new member...');

    picker.SetCursor(KICURSOR.BULLSEYE);
    picker.SetSnapping(false);
    picker.ClearHandlers();

    picker.SetClickHandler(() => {
      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      const sel = selTool.RequestSelection(() => {});

      if (sel.Empty()) return true; // still looking for an item

      statusPopup.Hide();

      if (this.m_propertiesDialog) {
        let elem: EDA_ITEM = sel.Front()!;

        if (!isFootprintEditor) {
          while (elem.GetParent() && elem.GetParent()!.Type() !== KICAD_T.PCB_T)
            elem = elem.GetParent()!;
        }

        this.m_propertiesDialog.DoAddMember(elem);
        this.m_propertiesDialog.Show(true);
      }

      return false; // got our item; don't need any more
    });

    picker.SetMotionHandler(() => {
      const at = KIPLATFORM_UI.GetMousePosition();
      statusPopup.Move({ x: at.x + 20, y: at.y - 50 });
    });

    picker.SetCancelHandler(() => {
      if (this.m_propertiesDialog) this.m_propertiesDialog.Show(true);

      statusPopup.Hide();
    });

    picker.SetFinalizeHandler(() => {
      done = true;
    });

    const at = KIPLATFORM_UI.GetMousePosition();
    statusPopup.Move({ x: at.x + 20, y: at.y - 50 });
    statusPopup.Popup();
    this.m_frame!.GetCanvas()?.SetStatusPopup(popupFocus(statusPopup));

    this.m_toolMgr!.RunAction(ACTIONS.pickerTool, aEvent);

    while (!done) {
      // Pass events unless we receive a null event, then we must shut down
      const evt = yield* this.Wait();

      if (evt) evt.SetPassEvent();
      else break;
    }

    picker.ClearHandlers();
    this.m_frame!.GetCanvas()?.SetStatusPopup(null);

    return 0;
  }

  ///< Group selected items.
  Group(_aEvent: TOOL_EVENT): number {
    const isFootprintEditor = this.m_frame!.GetFrameType() === FRAME_T.FRAME_FOOTPRINT_EDITOR;
    const selTool = this.selTool();
    const errorMsg = { value: '' };

    const selection = selTool.RequestSelection((_aPt, aCollector) => {
      // Iterate from the back so we don't have to worry about removals.
      for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
        const item = aCollector.At(i)!;

        if (!this.canGroupItem(item, errorMsg)) aCollector.Remove(item);
      }
    });

    if (selection.GetSize() < 2) {
      if (errorMsg.value !== '') this.m_frame!.ShowInfoBarWarning(errorMsg.value);

      return 0;
    }

    const board = this.getModel<BOARD>();
    let group: PCB_GROUP | null = null;

    if (isFootprintEditor) group = new PCB_GROUP(board.GetFirstFootprint());
    else group = new PCB_GROUP(board);

    for (const eda_item of selection) {
      if (eda_item.IsBOARD_ITEM()) {
        if ((eda_item as BOARD_ITEM).IsLocked()) group.SetLocked(true);
      }
    }

    for (const eda_item of selection) {
      if (eda_item.IsBOARD_ITEM()) {
        const existingGroup = eda_item.GetParentGroup();

        if (existingGroup)
          this.m_commit!.Modify(existingGroup.AsEdaItem(), null, RECURSE_MODE.NO_RECURSE);

        this.m_commit!.Modify(eda_item);
        group.AddItem(eda_item);
      }
    }

    this.m_commit!.Add(group);
    this.m_commit!.Push('Group Items');

    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
    this.m_toolMgr!.RunAction(ACTIONS.selectItem, group.AsEdaItem());

    this.m_toolMgr!.PostEvent(EVENTS.SelectedItemsModified);
    this.m_frame!.OnModify();

    if (errorMsg.value !== '') this.m_frame!.ShowInfoBarWarning(errorMsg.value);

    return 0;
  }
}
