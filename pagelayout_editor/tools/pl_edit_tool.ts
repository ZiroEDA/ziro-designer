// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/tools/pl_edit_tool.h` + `pl_edit_tool.cpp`:
 * `PL_EDIT_TOOL` — move, undo / redo, cut / copy / paste, delete, and append
 * a drawing sheet file.
 *
 * `InteractiveDelete` (`ACTIONS::deleteTool`) runs `PICKER_TOOL`, which is
 * not in common/tool yet (STRUCTURE.md): it is not registered. The clipboard
 * (`SaveClipboard`, `GetClipboardUTF8`, `GetImageFromClipboard`,
 * common/clipboard.cpp) is the frame host's.
 */
import { BITMAP_BASE } from '@ziroeda/common/bitmap_base.js';
import {
  type DS_DATA_ITEM,
  DS_DATA_ITEM_BITMAP,
} from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import type { DS_DRAW_ITEM_BASE } from '@ziroeda/common/drawing_sheet/ds_draw_item.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { IS_MOVING, IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import {
  BUT_LEFT,
  BUT_RIGHT,
  EVENTS,
  TA_UNDO_REDO_PRE,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { PL_EDITOR_FRAME } from '../pl_editor_frame.js';
import { PL_ACTIONS } from './pl_actions.js';
import type { PL_SELECTION } from './pl_selection.js';
import { PL_SELECTION_TOOL } from './pl_selection_tool.js';

export class PL_EDIT_TOOL extends TOOL_INTERACTIVE {
  private m_frame: PL_EDITOR_FRAME | null;
  private m_selectionTool: PL_SELECTION_TOOL | null;

  ///< Flag determining if anything is being dragged right now.
  private m_moveInProgress: boolean;

  ///< Used for chaining commands.
  private m_moveOffset: VECTOR2I;

  ///< Last cursor position (needed for getModificationPoint() to avoid changes
  ///< of edit reference point).
  private m_cursor: VECTOR2I;

  constructor() {
    super('plEditor.InteractiveEdit');
    this.m_frame = null;
    this.m_selectionTool = null;
    this.m_moveInProgress = false;
    this.m_moveOffset = { x: 0, y: 0 };
    this.m_cursor = { x: 0, y: 0 };
  }

  /**
   * `getViewControls()` as the `VIEW_CONTROLS` it is: the manager's type
   * names only the calls the manager itself makes (STRUCTURE.md).
   */
  private viewControls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  /// @copydoc TOOL_INTERACTIVE::Init()
  override Init(): boolean {
    this.m_frame = this.getEditFrame<PL_EDITOR_FRAME>();
    this.m_selectionTool = this.m_toolMgr!.GetTool(PL_SELECTION_TOOL);

    console.assert(
      this.m_selectionTool !== null,
      'plEditor.InteractiveSelection tool is not available',
    );

    const ctxMenu = this.m_menu.GetMenu();

    // cancel current tool goes in main context menu at the top if present
    ctxMenu.AddItem(ACTIONS.cancelInteractive, SELECTION_CONDITIONS.ShowAlways, 1);

    ctxMenu.AddSeparator(200);
    ctxMenu.AddItem(ACTIONS.doDelete, SELECTION_CONDITIONS.NotEmpty, 200);

    // Finally, add the standard zoom/grid items
    this.m_frame.AddStandardSubMenus(this.m_menu);

    //
    // Add editing actions to the selection tool menu
    //
    const selToolMenu = this.m_selectionTool!.GetToolMenu().GetMenu();

    selToolMenu.AddItem(PL_ACTIONS.move, SELECTION_CONDITIONS.NotEmpty, 250);

    selToolMenu.AddSeparator(250);
    selToolMenu.AddItem(ACTIONS.cut, SELECTION_CONDITIONS.NotEmpty, 250);
    selToolMenu.AddItem(ACTIONS.copy, SELECTION_CONDITIONS.NotEmpty, 250);
    selToolMenu.AddItem(ACTIONS.paste, SELECTION_CONDITIONS.ShowAlways, 250);
    selToolMenu.AddItem(ACTIONS.doDelete, SELECTION_CONDITIONS.NotEmpty, 250);

    return true;
  }

  /// @copydoc TOOL_INTERACTIVE::Reset()
  Reset(aReason: RESET_REASON): void {
    if (aReason === RESET_REASON.MODEL_RELOAD) this.m_frame = this.getEditFrame<PL_EDITOR_FRAME>();
  }

  /// The "move" event loop
  *Main(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const frame = this.m_frame!;
    const controls = this.viewControls();

    const originalCursorPos = controls.GetCursorPosition();

    // Be sure that there is at least one item that we can move. If there's no selection try
    // looking for the stuff under mouse cursor (i.e. Kicad old-style hover selection).
    const selection = yield* this.m_selectionTool!.RequestSelection();
    let unselect = selection.IsHover();

    if (selection.Empty() || this.m_moveInProgress) return 0;

    const unique_peers = new Set<DS_DATA_ITEM>();

    for (const item of selection) {
      const drawItem = item as DS_DRAW_ITEM_BASE;
      unique_peers.add(drawItem.GetPeer()!);
    }

    frame.PushTool(aEvent);

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    controls.ShowCursor(true);
    controls.SetAutoPan(true);

    let restore_state = false;
    let chain_commands = false;
    let evt: TOOL_EVENT | null = aEvent;
    let prevPos: VECTOR2I = { x: 0, y: 0 };

    // The fmt::format_error catch is n/a: the serializer does not throw.
    if (!selection.Front()!.IsNew()) frame.SaveCopyInUndoList();

    // Main loop: keep receiving events
    do {
      frame.GetCanvas()!.SetCurrentCursor(KICURSOR.MOVING);

      if (
        evt.IsAction(PL_ACTIONS.move) ||
        evt.IsMotion() ||
        evt.IsDrag(BUT_LEFT) ||
        evt.IsAction(ACTIONS.refreshPreview)
      ) {
        //------------------------------------------------------------------------
        // Start a move operation
        //
        if (!this.m_moveInProgress) {
          // Apply any initial offset in case we're coming from a previous command.
          //
          for (const item of unique_peers) this.moveItem(item, this.m_moveOffset);

          // Set up the starting position and move/drag offset
          //
          this.m_cursor = controls.GetCursorPosition();

          if (selection.HasReferencePoint()) {
            const ref = selection.GetReferencePoint();
            const delta = { x: this.m_cursor.x - ref.x, y: this.m_cursor.y - ref.y };

            // Drag items to the current cursor position
            for (const item of unique_peers) this.moveItem(item, delta);

            selection.SetReferencePoint(this.m_cursor);
          } else if (selection.Size() === 1) {
            // Set the current cursor position to the first dragged item origin,
            // so the movement vector can be computed later
            this.updateModificationPoint(selection);
            this.m_cursor = originalCursorPos;
          } else {
            this.updateModificationPoint(selection);
          }

          controls.SetCursorPosition(this.m_cursor, false);

          prevPos = this.m_cursor;
          controls.SetAutoPan(true);
          this.m_moveInProgress = true;
        }

        //------------------------------------------------------------------------
        // Follow the mouse
        //
        this.m_cursor = controls.GetCursorPosition();
        const delta = { x: this.m_cursor.x - prevPos.x, y: this.m_cursor.y - prevPos.y };
        selection.SetReferencePoint(this.m_cursor);

        this.m_moveOffset = {
          x: this.m_moveOffset.x + delta.x,
          y: this.m_moveOffset.y + delta.y,
        };
        prevPos = this.m_cursor;

        for (const item of unique_peers) this.moveItem(item, delta);

        this.m_toolMgr!.PostEvent(EVENTS.SelectedItemsMoved);
      }
      //------------------------------------------------------------------------
      // Handle cancel
      //
      else if (evt.IsCancelInteractive() || evt.IsActivate()) {
        if (evt.IsCancelInteractive()) frame.GetHost()?.DismissInfoBar();

        if (this.m_moveInProgress) {
          if (evt.IsActivate()) {
            // Allowing other tools to activate during a move runs the risk of race
            // conditions in which we try to spool up both event loops at once.

            frame.GetHost()?.ShowInfoBarMsg('Press <ESC> to cancel move.');

            evt.SetPassEvent(false);
            continue;
          }

          evt.SetPassEvent(false);
          restore_state = true;
        }

        break;
      }
      //------------------------------------------------------------------------
      // Handle TOOL_ACTION special cases
      //
      else if (evt.Action() === TA_UNDO_REDO_PRE) {
        unselect = true;
        break;
      } else if (evt.IsAction(ACTIONS.doDelete)) {
        evt.SetPassEvent();
        // Exit on a delete; there will no longer be anything to drag.
        break;
      } else if (evt.IsAction(ACTIONS.duplicate)) {
        if (selection.Front()!.IsNew()) {
          // This doesn't really make sense; we'll just end up dragging a stack of
          // objects so we ignore the duplicate and just carry on.
          continue;
        }

        // Move original back and exit.  The duplicate will run in its own loop.
        restore_state = true;
        unselect = false;
        chain_commands = true;
        break;
      }
      //------------------------------------------------------------------------
      // Handle context menu
      //
      else if (evt.IsClick(BUT_RIGHT)) {
        this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
      }
      //------------------------------------------------------------------------
      // Handle drop
      //
      else if (evt.IsMouseUp(BUT_LEFT) || evt.IsClick(BUT_LEFT)) {
        break; // Finish
      } else {
        evt.SetPassEvent();
      }

      controls.SetAutoPan(this.m_moveInProgress);
      // biome-ignore lint/suspicious/noAssignInExpressions: upstream's do { } while( ( evt = Wait() ) ), which each `continue` above relies on
    } while ((evt = yield* this.Wait())); //Should be assignment not equality test

    controls.ForceCursorPosition(false);
    controls.ShowCursor(false);
    controls.SetAutoPan(false);

    if (!chain_commands) this.m_moveOffset = { x: 0, y: 0 };

    selection.ClearReferencePoint();

    for (const item of selection) item.ClearEditFlags();

    if (restore_state) frame.RollbackFromUndo();
    else frame.OnModify();

    if (unselect) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
    else this.m_toolMgr!.PostEvent(EVENTS.SelectedEvent);

    this.m_moveInProgress = false;
    frame.PopTool(aEvent);
    return 0;
  }

  private moveItem(aItem: DS_DATA_ITEM, aDelta: VECTOR2I): void {
    const start = aItem.GetStartPosIU();
    aItem.MoveToIU({ x: start.x + aDelta.x, y: start.y + aDelta.y });

    for (const item of aItem.GetDrawItems()) {
      this.getView()!.Update(item);
      item.SetFlags(IS_MOVING);
    }
  }

  ///< Return the right modification point (e.g. for rotation), depending on the number of
  ///< selected items.
  private updateModificationPoint(aSelection: PL_SELECTION): boolean {
    if (this.m_moveInProgress && aSelection.HasReferencePoint()) return false;

    // When there is only one item selected, the reference point is its position...
    if (aSelection.Size() === 1) {
      aSelection.SetReferencePoint(aSelection.Front()!.GetPosition());
    }
    // ...otherwise modify items with regard to the grid-snapped cursor position
    else {
      this.m_cursor = this.viewControls().GetCursorPosition(true);
      aSelection.SetReferencePoint(this.m_cursor);
    }

    return true;
  }

  ImportDrawingSheetContent(_aEvent: TOOL_EVENT): number {
    this.m_toolMgr!.RunAction(ACTIONS.cancelInteractive);

    void this.m_frame!.Files_io('ID_APPEND_DESCR_FILE');

    return 0;
  }

  /**
   * Delete the selected items, or the item under the cursor.
   */
  *DoDelete(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const selection = yield* this.m_selectionTool!.RequestSelection();

    if (selection.Size() === 0) return 0;

    // Do not delete an item if it is currently a new item being created to avoid a crash
    // In this case the selection contains only one item.
    const currItem = selection.Front() as DS_DRAW_ITEM_BASE;

    if (currItem.GetFlags() & IS_NEW) return 0;

    this.m_frame!.SaveCopyInUndoList();

    while (selection.Front()) {
      const drawItem = selection.Front() as DS_DRAW_ITEM_BASE;
      const dataItem = drawItem.GetPeer()!;
      DS_DATA_MODEL.GetTheInstance().Remove(dataItem);

      for (const item of dataItem.GetDrawItems()) {
        // Note: repeat items won't be selected but must be removed & deleted

        if (item.IsSelected()) this.m_selectionTool!.RemoveItemFromSel(item);

        this.getView()!.Remove(item);
      }
    }

    this.m_frame!.OnModify();

    return 0;
  }

  Undo(_aEvent: TOOL_EVENT): number {
    this.m_frame!.GetLayoutFromUndoList();
    return 0;
  }

  Redo(_aEvent: TOOL_EVENT): number {
    this.m_frame!.GetLayoutFromRedoList();
    return 0;
  }

  *Cut(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    let retVal = yield* this.Copy(aEvent);

    if (retVal === 0) retVal = yield* this.DoDelete(aEvent);

    return retVal;
  }

  *Copy(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const selection = yield* this.m_selectionTool!.RequestSelection();
    const items: DS_DATA_ITEM[] = [];
    const model = DS_DATA_MODEL.GetTheInstance();

    if (selection.GetSize() === 0) return 0;

    for (const item of selection.GetItems()) items.push((item as DS_DRAW_ITEM_BASE).GetPeer()!);

    const sexpr = model.SaveInString(items);

    if (this.m_frame!.GetHost()?.SaveClipboard(sexpr)) return 0;
    else return -1;
  }

  Paste(_aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.GetSelection();
    const model = DS_DATA_MODEL.GetTheInstance();
    const host = this.m_frame!.GetHost();

    const clipImg = host?.GetImageFromClipboard() ?? null;

    if (clipImg) {
      const image = new BITMAP_BASE();
      image.SetImage(clipImg);
      const dataItem = new DS_DATA_ITEM_BITMAP(image);
      model.Append(dataItem);
    } else {
      this.m_selectionTool!.ClearSelection();

      const clipText = host?.GetClipboardUTF8() ?? '';
      model.SetPageLayout(clipText, true, 'clipboard');
    }

    // Build out draw items and select the first of each data item
    for (const dataItem of model.GetItems()) {
      if (dataItem.GetDrawItems().length === 0) {
        dataItem.SyncDrawItems(null, this.getView());
        dataItem.GetDrawItems()[0]!.SetSelected();
      }
    }

    this.m_selectionTool!.RebuildSelection();

    if (!selection.Empty()) {
      selection.SetReferencePoint((selection.GetTopLeftItem() as EDA_ITEM).GetPosition());
      this.m_toolMgr!.PostAction(PL_ACTIONS.move);
    }

    return 0;
  }

  ///< Set up handlers for various events.
  protected setTransitions(): void {
    this.Go(this.Main, PL_ACTIONS.move.MakeEvent());

    this.Go(
      SYNC_HANDLER(this.ImportDrawingSheetContent),
      PL_ACTIONS.appendImportedDrawingSheet.MakeEvent(),
    );

    this.Go(SYNC_HANDLER(this.Undo), ACTIONS.undo.MakeEvent());
    this.Go(SYNC_HANDLER(this.Redo), ACTIONS.redo.MakeEvent());

    this.Go(this.Cut, ACTIONS.cut.MakeEvent());
    this.Go(this.Copy, ACTIONS.copy.MakeEvent());
    this.Go(SYNC_HANDLER(this.Paste), ACTIONS.paste.MakeEvent());
    this.Go(this.DoDelete, ACTIONS.doDelete.MakeEvent());

    // ACTIONS::deleteTool -> InteractiveDelete waits on PICKER_TOOL.
  }
}
