// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/pl_editor_undo_redo.cpp`: the `PL_EDITOR_FRAME` members
 * it defines, bound on the class. Every entry is a `DS_PROXY_UNDO_ITEM`
 * (`common/drawing_sheet/ds_proxy_undo_item.cpp`), a whole serialised copy of
 * the data model, so undo is "swap the model back".
 */

import { DS_PROXY_UNDO_ITEM } from '@ziroeda/common/drawing_sheet/ds_proxy_undo_item.js';
import { UNDO_REDO_LIST } from '@ziroeda/common/eda_base_frame.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { ITEM_PICKER, PICKED_ITEMS_LIST, UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { PL_EDITOR_FRAME } from './pl_editor_frame.js';
import { PL_SELECTION_TOOL } from './tools/pl_selection_tool.js';

// ---- the PL_EDITOR_FRAME members pl_editor_undo_redo.cpp defines -------------

/** `PL_EDITOR_FRAME::SaveCopyInUndoList()`. */
export function SaveCopyInUndoList(self: PL_EDITOR_FRAME): void {
  const lastcmd = new PICKED_ITEMS_LIST();
  const copyItem = new DS_PROXY_UNDO_ITEM(self);
  const wrapper = new ITEM_PICKER(self.GetScreen(), copyItem, UNDO_REDO.LIBEDIT);

  lastcmd.PushItem(wrapper);
  self.PushCommandToUndoList(lastcmd);

  // Clear redo list, because after new save there is no redo to do.
  self.ClearUndoORRedoList(UNDO_REDO_LIST.REDO_LIST);
}

/**
 * Redo the last edit:
 * - Place the current edited layout in undo list
 * - Get previous version of the current edited layput
 */
export function GetLayoutFromRedoList(self: PL_EDITOR_FRAME): void {
  const selTool = self.GetToolManager()!.GetTool(PL_SELECTION_TOOL)!;

  if (self.GetRedoCommandCount() <= 0) return;

  const redoWrapper = self.PopCommandFromRedoList()!.PopItem();
  const redoItem = redoWrapper.GetItem() as DS_PROXY_UNDO_ITEM;
  const pageSettingsAndTitleBlock = redoItem.Type() === KICAD_T.WS_PROXY_UNDO_ITEM_PLUS_T;

  const undoCmd = new PICKED_ITEMS_LIST();
  const undoItem = new DS_PROXY_UNDO_ITEM(pageSettingsAndTitleBlock ? self : null);
  const undoWrapper = new ITEM_PICKER(self.GetScreen(), undoItem);

  undoCmd.PushItem(undoWrapper);
  self.PushCommandToUndoList(undoCmd);

  selTool.ClearSelection();
  redoItem.Restore(self, self.GetCanvas()!.GetView());
  selTool.RebuildSelection();

  if (pageSettingsAndTitleBlock)
    self.HardRedraw(); // items based off of corners will need re-calculating
  else self.GetCanvas()!.Refresh();

  self.OnModify();
}

/**
 * Undo the last edit:
 * - Place the current layout in Redo list
 * - Get previous version of the current edited layout
 */
export function GetLayoutFromUndoList(self: PL_EDITOR_FRAME): void {
  const selTool = self.GetToolManager()!.GetTool(PL_SELECTION_TOOL)!;

  if (self.GetUndoCommandCount() <= 0) return;

  const undoWrapper = self.PopCommandFromUndoList()!.PopItem();
  const undoItem = undoWrapper.GetItem() as DS_PROXY_UNDO_ITEM;
  const pageSettingsAndTitleBlock = undoItem.Type() === KICAD_T.WS_PROXY_UNDO_ITEM_PLUS_T;

  const redoCmd = new PICKED_ITEMS_LIST();
  const redoItem = new DS_PROXY_UNDO_ITEM(pageSettingsAndTitleBlock ? self : null);
  const redoWrapper = new ITEM_PICKER(self.GetScreen(), redoItem);

  redoCmd.PushItem(redoWrapper);
  self.PushCommandToRedoList(redoCmd);

  selTool.ClearSelection();
  undoItem.Restore(self, self.GetCanvas()!.GetView());
  selTool.RebuildSelection();

  if (pageSettingsAndTitleBlock)
    self.HardRedraw(); // items based off of corners will need re-calculating
  else self.GetCanvas()!.Refresh();

  self.OnModify();
}

/**
 * Remove the last command in Undo List.
 * Used to clean the uUndo stack after a cancel command
 */
export function RollbackFromUndo(self: PL_EDITOR_FRAME): void {
  const selTool = self.GetToolManager()!.GetTool(PL_SELECTION_TOOL)!;

  if (self.GetUndoCommandCount() <= 0) return;

  const undoWrapper = self.PopCommandFromUndoList()!.PopItem();
  const undoItem = undoWrapper.GetItem() as DS_PROXY_UNDO_ITEM;
  const pageSettingsAndTitleBlock = undoItem.Type() === KICAD_T.WS_PROXY_UNDO_ITEM_PLUS_T;

  selTool.ClearSelection();
  undoItem.Restore(self, self.GetCanvas()!.GetView());
  selTool.RebuildSelection();

  if (pageSettingsAndTitleBlock) {
    self.GetToolManager()!.RunAction(ACTIONS.zoomFitScreen);
    self.HardRedraw(); // items based off of corners will need re-calculating
  } else self.GetCanvas()!.Refresh();
}
