// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_BASE_EDIT_FRAME` (pcbnew/pcb_base_edit_frame.h): the common base of
 * the board and footprint editors — here its undo/redo half, which is
 * `pcbnew/undo_redo.cpp` whole: the undo list is a stack of
 * PICKED_ITEMS_LIST commands, each item a picker with its status and, for a
 * change, the image the item is swapped with.
 *
 * The view calls (`view->Remove`/`Add`/`Update`) go through the canvas's view
 * when there is one; the C++ frame always has a canvas, ours does until the
 * KIGFX::VIEW port (#636 stage 5) through the designer's canvas. The
 * DRILLORIGIN/GRIDORIGIN/PAGESETTINGS commands need BOARD_EDITOR_CONTROL,
 * PCB_CONTROL and DS_PROXY_UNDO_ITEM (stage 3/6) and are pending.
 */
import { UNDO_REDO_LIST } from '@ziroeda/common/src/eda_base_frame.js';
import type { EDA_ITEM } from '@ziroeda/common/src/eda_item.js';
import { UR_TRANSIENT } from '@ziroeda/common/src/eda_item_flags.js';
import { FRAME_T } from '@ziroeda/common/src/frame_type.js';
import {
  EVENTS,
  TOOL_ACTIONS,
  TOOL_EVENT,
  TOOL_EVENT_CATEGORY,
} from '@ziroeda/common/src/tool/tool_event.js';
import { TOOL_ACTION_SCOPE } from '@ziroeda/common/src/tool/tool_action.js';
import { RESET_REASON } from '@ziroeda/common/src/tool/tool_base.js';
import {
  ITEM_PICKER,
  PICKED_ITEMS_LIST,
  UNDO_REDO,
} from '@ziroeda/common/src/undo_redo_container.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { BOARD_COMMIT } from './board_commit.js';
import { DEFAULT_THEME, GetColorSettings } from '@ziroeda/common/src/pgm_base.js';
import type { COLOR_SETTINGS } from '@ziroeda/common/src/settings/color_settings.js';
import type { BOARD } from './board.js';
import type { PCB_VIEW } from './pcb_view.js';
import type { BOARD_ITEM } from './board_item.js';
import { ADD_MODE, type BOARD_ITEM_CONTAINER, REMOVE_MODE } from './board_item_container.js';
import type { FOOTPRINT } from './footprint.js';
import { PCB_BASE_FRAME } from './pcb_base_frame.js';
import type { PCB_GROUP } from './pcb_group.js';
import type { PCB_TRACK } from './pcb_track.js';
import type { PROGRESS_REPORTER_LIKE } from './connectivity/connectivity_algo.js';
import { SHOW_WITH_VIA_ALWAYS } from './pcbnew_settings.js';
import { PCB_ACTIONS } from './tools/pcb_actions.js';
import type { ZONE } from './zone.js';

/** The selection tool the frame rebuilds after an undo; the class is stage 3's. */
export const PCB_SELECTION_TOOL_NAME = 'pcbnew.InteractiveSelection';

export interface PCB_SELECTION_TOOL_LIKE {
  RebuildSelection(): void;
}

// Enum to track the modification type of items. Used to enable bulk BOARD_LISTENER
// callbacks at the end of the undo / redo operation
enum ITEM_CHANGE_TYPE {
  ADDED,
  DELETED,
  CHANGED,
}

/**
 * Check whether the undo/redo list contains any items that could affect the board outline
 * or shape hatching.  Used to skip expensive post-processing when only tracks changed.
 */
function undoListContainsShapesOrFootprints(aList: PICKED_ITEMS_LIST): boolean {
  for (let ii = 0; ii < aList.GetCount(); ++ii) {
    switch (aList.GetPickedItem(ii)!.Type()) {
      case KICAD_T.PCB_SHAPE_T:
      case KICAD_T.PCB_FOOTPRINT_T:
      case KICAD_T.PCB_TEXT_T:
      case KICAD_T.PCB_TEXTBOX_T:
      case KICAD_T.PCB_FIELD_T:
        return true;

      default:
        break;
    }
  }

  return false;
}

export abstract class PCB_BASE_EDIT_FRAME extends PCB_BASE_FRAME {
  protected m_undoRedoBlocked = false;

  /** The canvas's view, as the undo code needs it (`KIGFX::PCB_VIEW`). */
  protected pcbView(): PCB_VIEW | null {
    return this.GetCanvas()?.GetView() ?? null;
  }

  override SetBoard(aBoard: BOARD | null, aReporter: PROGRESS_REPORTER_LIKE | null = null): void {
    const is_new_board = aBoard !== this.m_pcb;

    if (is_new_board) {
      if (this.m_toolManager) this.m_toolManager.ResetTools(RESET_REASON.MODEL_RELOAD);

      this.OnBoardChanging();

      this.GetCanvas()?.GetView().Clear();
      this.GetCanvas()?.GetView().InitPreview();
    }

    super.SetBoard(aBoard, aReporter);

    if (aBoard)
      this.GetCanvas()?.GetGAL().SetGridOrigin(aBoard.GetDesignSettings().GetGridOrigin());

    if (is_new_board) {
      // bds.m_DRCEngine = std::make_shared<DRC_ENGINE>( aBoard, &bds ): with the DRC engine (#636 stage 4)
    }

    // update the tool manager with the new board and its view.
    if (this.m_toolManager) {
      const canvas = this.GetCanvas();

      if (canvas && aBoard) {
        canvas.DisplayBoard(aBoard, aReporter);

        canvas.UpdateColors();
      }

      this.m_toolManager.SetEnvironment(
        aBoard,
        canvas?.GetView() ?? null,
        canvas?.GetViewControls() ?? null,
        this.config(),
        this,
      );

      if (is_new_board) this.m_toolManager.ResetTools(RESET_REASON.MODEL_RELOAD);
    }
  }

  /** `EDA_EVT_BOARD_CHANGING`, the event `SetBoard` raises before the swap. */
  protected OnBoardChanging(): void {}

  override GetColorSettings(_aForceRefresh = false): COLOR_SETTINGS {
    const cfg = this.GetPcbNewSettings();
    return GetColorSettings(cfg ? cfg.m_ColorTheme : DEFAULT_THEME);
  }

  /**
   * Put \a aItemsList into the undo list.
   */
  private saveCopyInUndoList(
    commandToUndo: PICKED_ITEMS_LIST,
    aItemsList: PICKED_ITEMS_LIST,
    aCommandType: UNDO_REDO,
  ): void {
    const preExisting = commandToUndo.GetCount();

    for (let ii = 0; ii < aItemsList.GetCount(); ii++)
      commandToUndo.PushItem(aItemsList.GetItemWrapper(ii));

    for (let ii = preExisting; ii < commandToUndo.GetCount(); ii++) {
      const item = commandToUndo.GetPickedItem(ii);
      let command = commandToUndo.GetPickedItemStatus(ii);

      if (command === UNDO_REDO.UNSPECIFIED) {
        command = aCommandType;
        commandToUndo.SetPickedItemStatus(command, ii);
      }

      console.assert(item !== null);

      switch (command) {
        case UNDO_REDO.CHANGED:
        case UNDO_REDO.DRILLORIGIN:
        case UNDO_REDO.GRIDORIGIN:
          // If we don't yet have a copy in the link, set one up
          if (!commandToUndo.GetPickedItemLink(ii))
            commandToUndo.SetPickedItemLink(BOARD_COMMIT.MakeImage(item!), ii);

          break;

        case UNDO_REDO.NEWITEM:
        case UNDO_REDO.DELETED:
        case UNDO_REDO.PAGESETTINGS:
          break;

        default:
          console.assert(false, `Unrecognized undo command: ${command.toString(16)}`);
          break;
      }
    }

    if (commandToUndo.GetCount()) {
      /* Save the copy in undo list */
      this.PushCommandToUndoList(commandToUndo);

      /* Clear redo list, because after a new command one cannot redo a command */
      this.ClearUndoORRedoList(UNDO_REDO_LIST.REDO_LIST);
    } else {
      // Should not occur
      console.assert(false);
    }
  }

  /**
   * Create a new entry in undo list of commands.
   *
   * @param aItemToCopy is the board item modified by the command to undo.
   * @param aTypeCommand is the command type (see enum UNDO_REDO).
   */
  SaveCopyInUndoList(aItem: EDA_ITEM, aCommandType: UNDO_REDO): void;
  /**
   * Create a new entry in undo list of commands.
   *
   * @param aItemsList is the list of items modified by the command to undo.
   * @param aTypeCommand is the command type (see enum UNDO_REDO)
   */
  SaveCopyInUndoList(aItemsList: PICKED_ITEMS_LIST, aCommandType: UNDO_REDO): void;
  SaveCopyInUndoList(a: EDA_ITEM | PICKED_ITEMS_LIST, aCommandType: UNDO_REDO): void {
    const commandToUndo = new PICKED_ITEMS_LIST();

    if (a instanceof PICKED_ITEMS_LIST) {
      commandToUndo.SetDescription(a.GetDescription());

      this.saveCopyInUndoList(commandToUndo, a, aCommandType);
      return;
    }

    const itemsList = new PICKED_ITEMS_LIST();

    itemsList.PushItem(new ITEM_PICKER(null, a, aCommandType));
    this.saveCopyInUndoList(commandToUndo, itemsList, aCommandType);
  }

  /**
   * As SaveCopyInUndoList, but appends the changes to the last undo item on the stack.
   */
  AppendCopyToUndoList(aItemsList: PICKED_ITEMS_LIST, aCommandType: UNDO_REDO): void {
    let commandToUndo = this.PopCommandFromUndoList();

    if (!commandToUndo) {
      commandToUndo = new PICKED_ITEMS_LIST();
      commandToUndo.SetDescription(aItemsList.GetDescription());
    }

    this.saveCopyInUndoList(commandToUndo, aItemsList, aCommandType);
  }

  /**
   * Redo the last edit:
   *  - Save the current board in Undo list
   *  - Get an old version of the board from Redo list
   */
  RestoreCopyFromUndoList(): void {
    if (this.UndoRedoBlocked()) return;

    if (this.GetUndoCommandCount() <= 0) return;

    // Inform tools that undo command was issued
    this.m_toolManager!.ProcessEvent(
      new TOOL_EVENT(
        TOOL_EVENT_CATEGORY.TC_MESSAGE,
        TOOL_ACTIONS.TA_UNDO_REDO_PRE,
        TOOL_ACTION_SCOPE.AS_GLOBAL,
      ),
    );

    // Get the old list
    const list = this.PopCommandFromUndoList()!;

    const shapesChanged = undoListContainsShapesOrFootprints(list);

    // Undo the command
    this.PutDataInPreviousState(list, shapesChanged);

    // Put the old list in RedoList
    list.ReversePickersListOrder();
    this.PushCommandToRedoList(list);

    this.OnModify();

    this.m_toolManager!.ProcessEvent(
      new TOOL_EVENT(
        TOOL_EVENT_CATEGORY.TC_MESSAGE,
        TOOL_ACTIONS.TA_UNDO_REDO_POST,
        TOOL_ACTION_SCOPE.AS_GLOBAL,
      ),
    );
    this.m_toolManager!.PostEvent(EVENTS.SelectedItemsModified);

    if (shapesChanged) {
      this.m_pcb!.UpdateBoardOutline();
      this.pcbView()?.Update(this.m_pcb!.BoardOutline());
    }

    this.GetCanvas()?.Refresh();
  }

  /**
   * Redo the last edit:
   *  - Save the current board in Undo list
   *  - Get an old version of the board from Redo list
   */
  RestoreCopyFromRedoList(): void {
    if (this.UndoRedoBlocked()) return;

    if (this.GetRedoCommandCount() === 0) return;

    // Inform tools that redo command was issued
    this.m_toolManager!.ProcessEvent(EVENTS.UndoRedoPreEvent);

    // Get the old list
    const list = this.PopCommandFromRedoList()!;

    const shapesChanged = undoListContainsShapesOrFootprints(list);

    // Redo the command
    this.PutDataInPreviousState(list, shapesChanged);

    // Put the old list in UndoList
    list.ReversePickersListOrder();
    this.PushCommandToUndoList(list);

    this.OnModify();

    this.m_toolManager!.ProcessEvent(EVENTS.UndoRedoPostEvent);
    this.m_toolManager!.PostEvent(EVENTS.SelectedItemsModified);

    if (shapesChanged) {
      this.m_pcb!.UpdateBoardOutline();
      this.pcbView()?.Update(this.m_pcb!.BoardOutline());
    }

    this.GetCanvas()?.Refresh();
  }

  /**
   * Performs an undo of the last edit **without** logging a corresponding redo.  Used to cancel
   * an in-progress operation.
   */
  RollbackFromUndo(): void {
    const undo = this.PopCommandFromUndoList()!;
    this.PutDataInPreviousState(undo);

    this.ClearListAndDeleteItems(undo);

    this.m_pcb!.UpdateBoardOutline();
    this.pcbView()?.Update(this.m_pcb!.BoardOutline());
    this.GetCanvas()?.Refresh();
  }

  /**
   * Used in undo or redo command.
   *
   * Put data pointed by List in the previous state, i.e. the state memorized by \a aList.
   *
   * @param aList a PICKED_ITEMS_LIST pointer to the list of items to undo/redo.
   * @param aRehatchShapes true to rehatch shapes after the operation.
   */
  PutDataInPreviousState(aList: PICKED_ITEMS_LIST, aRehatchShapes = true): void {
    let not_found = false;
    let reBuild_ratsnest = false;
    let deep_reBuild_ratsnest = false; // true later if pointers must be rebuilt
    let solder_mask_dirty = false;
    const current_show_ratsnest = this.GetPcbNewSettings().m_Display.m_ShowGlobalRatsnest;
    const dirty_rule_areas: BOX2I[] = [];

    const view = this.pcbView();
    const connectivity = this.GetBoard()!.GetConnectivity();

    this.GetBoard()!.IncrementTimeStamp(); // clear caches

    const item_changes = new Map<EDA_ITEM, ITEM_CHANGE_TYPE>();

    const clear_local_ratsnest_flags = (item: EDA_ITEM): void => {
      switch (item.Type()) {
        case KICAD_T.PCB_TRACE_T:
        case KICAD_T.PCB_ARC_T:
        case KICAD_T.PCB_VIA_T:
          (item as PCB_TRACK).SetLocalRatsnestVisible(current_show_ratsnest);
          break;

        case KICAD_T.PCB_ZONE_T:
          (item as ZONE).SetLocalRatsnestVisible(current_show_ratsnest);
          break;

        case KICAD_T.PCB_FOOTPRINT_T:
          for (const pad of (item as FOOTPRINT).Pads())
            pad.SetLocalRatsnestVisible(current_show_ratsnest);

          break;

        default:
          break;
      }
    };

    const update_item_change_state = (item: EDA_ITEM, change_type: ITEM_CHANGE_TYPE): void => {
      const item_itr = item_changes.get(item);

      if (item_itr === undefined) {
        // First time we've seen this item - tag the current change type
        item_changes.set(item, change_type);
        return;
      }

      // Update the item state based on the current and next change type
      switch (item_itr) {
        case ITEM_CHANGE_TYPE.ADDED:
          if (change_type === ITEM_CHANGE_TYPE.DELETED) {
            // The item was previously added, now deleted - as far as bulk callbacks
            // are concerned, the item has never existed
            item_changes.delete(item);
          } else if (change_type === ITEM_CHANGE_TYPE.ADDED) {
            // Error condition - added an already added item
            console.assert(false, 'UndoRedo: should not add already added item');
          }

          // For all other cases, the item remains as ADDED as seen by the bulk callbacks
          break;

        case ITEM_CHANGE_TYPE.DELETED:
          // This is an error condition - item has already been deleted so should not
          // be operated on further
          console.assert(false, 'UndoRedo: should not alter already deleted item');
          break;

        case ITEM_CHANGE_TYPE.CHANGED:
          if (change_type === ITEM_CHANGE_TYPE.DELETED) {
            item_changes.set(item, ITEM_CHANGE_TYPE.DELETED);
          } else if (change_type === ITEM_CHANGE_TYPE.ADDED) {
            // This is an error condition - item has already been changed so should not
            // be added
            console.assert(false, 'UndoRedo: should not add already changed item');
          }

          // Otherwise, item remains CHANGED
          break;
      }
    };

    // Undo in the reverse order of list creation: (this can allow stacked changes
    // like the same item can be changes and deleted in the same complex command

    // Restore changes in reverse order
    for (let ii = aList.GetCount() - 1; ii >= 0; ii--) {
      const eda_item = aList.GetPickedItem(ii)!;

      /* Test for existence of item on board.
       * It could be deleted, and no more on board:
       *   - if a call to SaveCopyInUndoList was forgotten in Pcbnew
       *   - in zones outlines, when a change in one zone merges this zone with an other
       * This test avoids a Pcbnew crash
       * Obviously, this test is not made for deleted items
       */
      const status = aList.GetPickedItemStatus(ii);

      if (
        status !== UNDO_REDO.DELETED &&
        status !== UNDO_REDO.DRILLORIGIN && // origin markers never on board
        status !== UNDO_REDO.GRIDORIGIN && // origin markers never on board
        status !== UNDO_REDO.PAGESETTINGS
      ) {
        // nor are page settings proxy items
        if (!this.GetBoard()!.ResolveItem(eda_item.m_Uuid, true)) {
          // Remove this non existent item
          aList.RemovePicker(ii);
          not_found = true;

          if (aList.GetCount() === 0) break;

          continue;
        }
      }

      // see if we must rebuild ratsnets and pointers lists
      switch (eda_item.Type()) {
        case KICAD_T.PCB_FOOTPRINT_T:
          deep_reBuild_ratsnest = true; // Pointers on pads can be invalid
          reBuild_ratsnest = true;
          break;

        case KICAD_T.PCB_ZONE_T:
        case KICAD_T.PCB_TRACE_T:
        case KICAD_T.PCB_ARC_T:
        case KICAD_T.PCB_VIA_T:
        case KICAD_T.PCB_PAD_T:
          reBuild_ratsnest = true;
          break;

        case KICAD_T.PCB_NETINFO_T:
          reBuild_ratsnest = true;
          deep_reBuild_ratsnest = true;
          break;

        default:
          break;
      }

      switch (eda_item.Type()) {
        case KICAD_T.PCB_FOOTPRINT_T:
          solder_mask_dirty = true;
          break;

        case KICAD_T.PCB_VIA_T:
          solder_mask_dirty = true;
          break;

        case KICAD_T.PCB_ZONE_T:
        case KICAD_T.PCB_TRACE_T:
        case KICAD_T.PCB_ARC_T:
        case KICAD_T.PCB_PAD_T:
        case KICAD_T.PCB_SHAPE_T: {
          const layers = (eda_item as BOARD_ITEM).GetLayerSet();

          if (layers.test(PCB_LAYER_ID.F_Mask) || layers.test(PCB_LAYER_ID.B_Mask))
            solder_mask_dirty = true;

          break;
        }

        default:
          break;
      }

      switch (aList.GetPickedItemStatus(ii)) {
        case UNDO_REDO.CHANGED /* Exchange old and new data for each item */:
          if (eda_item.IsBOARD_ITEM()) {
            let item = eda_item as BOARD_ITEM;
            const image = aList.GetPickedItemLink(ii) as BOARD_ITEM;
            let parent: BOARD_ITEM_CONTAINER = this.GetBoard()!;

            // The stored pointer can be stale if a swap (e.g. ExchangeFootprint)
            // replaced the live item earlier. Resolve by UUID to find the current one.
            const resolved = this.GetBoard()!.ResolveItem(item.m_Uuid, true);
            if (resolved) item = resolved;

            if (item.GetParentFootprint()) parent = item.GetParentFootprint()!;

            view?.Remove(item);
            parent.Remove(item, REMOVE_MODE.BULK);

            item.SwapItemData(image);

            clear_local_ratsnest_flags(item);
            item.ClearFlags(UR_TRANSIENT);
            image.SetFlags(UR_TRANSIENT);

            view?.Add(item);
            view?.Hide(item, false);
            parent.Add(item, ADD_MODE.BULK_INSERT);

            if (item.Type() === KICAD_T.PCB_ZONE_T && (item as ZONE).GetIsRuleArea()) {
              dirty_rule_areas.push(item.GetBoundingBox());
              dirty_rule_areas.push(image.GetBoundingBox());
            }

            update_item_change_state(item, ITEM_CHANGE_TYPE.CHANGED);
          }

          break;

        case UNDO_REDO.NEWITEM /* new items are deleted */:
          if (eda_item.IsBOARD_ITEM()) {
            const boardItem = eda_item as BOARD_ITEM;

            aList.SetPickedItemStatus(UNDO_REDO.DELETED, ii);

            const parentFP = boardItem.GetParentFootprint();
            if (parentFP) parentFP.Remove(boardItem);
            else this.GetModel()!.Remove(boardItem, REMOVE_MODE.BULK);

            update_item_change_state(eda_item, ITEM_CHANGE_TYPE.DELETED);

            if (eda_item.Type() !== KICAD_T.PCB_NETINFO_T) view?.Remove(eda_item);

            eda_item.SetFlags(UR_TRANSIENT);

            if (eda_item.Type() === KICAD_T.PCB_ZONE_T && (eda_item as ZONE).GetIsRuleArea())
              dirty_rule_areas.push(eda_item.GetBoundingBox());
          }

          break;

        case UNDO_REDO.DELETED /* deleted items are put in List, as new items */:
          if (eda_item.IsBOARD_ITEM()) {
            const boardItem = eda_item as BOARD_ITEM;

            aList.SetPickedItemStatus(UNDO_REDO.NEWITEM, ii);

            clear_local_ratsnest_flags(eda_item);
            eda_item.ClearFlags(UR_TRANSIENT);

            const parentFP = boardItem.GetParentFootprint();
            if (parentFP) parentFP.Add(boardItem);
            else this.GetModel()!.Add(boardItem, ADD_MODE.BULK_APPEND);

            update_item_change_state(eda_item, ITEM_CHANGE_TYPE.ADDED);

            if (eda_item.Type() !== KICAD_T.PCB_NETINFO_T) view?.Add(eda_item);

            if (eda_item.Type() === KICAD_T.PCB_ZONE_T && (eda_item as ZONE).GetIsRuleArea())
              dirty_rule_areas.push(eda_item.GetBoundingBox());
          }

          break;

        case UNDO_REDO.DRILLORIGIN:
        case UNDO_REDO.GRIDORIGIN: {
          // Warning: DRILLORIGIN and GRIDORIGIN undo/redo command create EDA_ITEMs
          // that cannot be casted to BOARD_ITEMs
          // BOARD_EDITOR_CONTROL::DoSetDrillOrigin / PCB_CONTROL::DoSetGridOrigin:
          // pending with those tools (#636 stage 3)
          throw new Error('PutDataInPreviousState: DRILLORIGIN/GRIDORIGIN pending (#636 stage 3)');
        }

        case UNDO_REDO.PAGESETTINGS:
          // DS_PROXY_UNDO_ITEM: pending with the drawing sheet (#636 stage 6)
          throw new Error('PutDataInPreviousState: PAGESETTINGS pending (#636 stage 6)');

        default:
          console.assert(
            false,
            `PutDataInPreviousState() error (unknown code ${aList.GetPickedItemStatus(ii)})`,
          );
          break;
      }

      if (eda_item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        const fp = eda_item as FOOTPRINT;
        fp.InvalidateComponentClassCache();
        this.m_pcb!.GetComponentClassManager().RebuildRequiredCaches(fp);
      }
    }

    if (not_found) this.ShowUndoRedoIncompleteMessage();

    // We have now swapped all the group parent and group member pointers.  But it is a
    // risky proposition to bet on the pointers being invariant, so validate them all.
    for (let ii = 0; ii < aList.GetCount(); ++ii) {
      const wrapper = aList.GetItemWrapper(ii);

      if (wrapper.GetStatus() === UNDO_REDO.DELETED) continue;

      const parentGroup = this.GetBoard()!.ResolveItem(wrapper.GetGroupId(), true);
      const parentPcbGroup =
        parentGroup?.Type() === KICAD_T.PCB_GROUP_T ? (parentGroup as PCB_GROUP) : null;
      wrapper.GetItem()!.SetParentGroup(parentPcbGroup);

      // Restore the group's member list, which BOARD::Remove() cleared above.
      if (parentPcbGroup) parentPcbGroup.GetItems().add(wrapper.GetItem()!);

      if (wrapper.GetItem()!.Type() === KICAD_T.PCB_GROUP_T) {
        const group = wrapper.GetItem() as PCB_GROUP;

        // Items list may contain dodgy pointers, so don't use RemoveAll()
        group.GetItems().clear();

        for (const member of wrapper.GetGroupMembers()) {
          const memberItem = this.GetBoard()!.ResolveItem(member, true);
          if (memberItem) group.AddItem(memberItem);
        }
      }

      // And prepare for a redo by updating group info based on current image
      const link = wrapper.GetLink();
      if (link) wrapper.SetLink(link);
    }

    if (this.IsType(FRAME_T.FRAME_PCB_EDITOR)) {
      if (
        dirty_rule_areas.length > 0 &&
        (this.GetPcbNewSettings().m_Display.m_TrackClearance === SHOW_WITH_VIA_ALWAYS ||
          this.GetPcbNewSettings().m_Display.m_PadClearance)
      ) {
        view?.UpdateCollidingItems(dirty_rule_areas, [
          KICAD_T.PCB_TRACE_T,
          KICAD_T.PCB_ARC_T,
          KICAD_T.PCB_VIA_T,
          KICAD_T.PCB_PAD_T,
        ]);
      }

      if (reBuild_ratsnest || deep_reBuild_ratsnest) {
        // Connectivity may have changed; rebuild internal caches to remove stale items
        this.GetBoard()!.BuildConnectivity();
        this.Compile_Ratsnest(false);
      }

      if (solder_mask_dirty) this.HideSolderMask();
    }

    this.GetBoard()!.GetComponentClassManager().InvalidateComponentClasses();

    const selTool = this.m_toolManager?.FindTool(
      PCB_SELECTION_TOOL_NAME,
    ) as PCB_SELECTION_TOOL_LIKE | null;
    selTool?.RebuildSelection();

    this.GetBoard()!.SanitizeNetcodes();

    // Invoke bulk BOARD_LISTENER callbacks
    const added_items: BOARD_ITEM[] = [];
    const deleted_items: BOARD_ITEM[] = [];
    const changed_items: BOARD_ITEM[] = [];

    for (const [item, changeType] of item_changes) {
      switch (changeType) {
        case ITEM_CHANGE_TYPE.ADDED:
          added_items.push(item as BOARD_ITEM);
          break;

        case ITEM_CHANGE_TYPE.DELETED:
          deleted_items.push(item as BOARD_ITEM);
          break;

        case ITEM_CHANGE_TYPE.CHANGED:
          changed_items.push(item as BOARD_ITEM);
          break;
      }
    }

    if (aRehatchShapes) this.GetToolManager()?.PostAction(PCB_ACTIONS.rehatchShapes);

    if (added_items.length > 0 || deleted_items.length > 0 || changed_items.length > 0)
      this.GetBoard()!.OnItemsCompositeUpdate(added_items, deleted_items, changed_items);
  }

  /**
   * `wxMessageBox( _( "Incomplete undo/redo operation: some items not found" ) )`:
   * the designer's frame shows it.
   */
  protected ShowUndoRedoIncompleteMessage(): void {}

  /**
   * Free the undo or redo list from \a aList element.
   *
   * - Wrappers are deleted.
   * - data pointed by wrappers are deleted if not in use in schematic
   *   i.e. when they are copy of a schematic item or they are no more in use (DELETED)
   *
   * @param whichList the #UNDO_REDO_CONTAINER to clear
   * @param aItemCount the count of items to remove. < 0 for all items items are removed
   *                   from the beginning of the list
   */
  override ClearUndoORRedoList(whichList: UNDO_REDO_LIST, aItemCount = -1): void {
    if (aItemCount === 0) return;

    const list = whichList === UNDO_REDO_LIST.UNDO_LIST ? this.m_undoList : this.m_redoList;

    if (aItemCount < 0) {
      list.ClearCommandList();
    } else {
      for (let ii = 0; ii < aItemCount; ii++) {
        if (list.m_CommandsList.length === 0) break;

        const curr_cmd = list.m_CommandsList[0]!;
        list.m_CommandsList.splice(0, 1);

        this.ClearListAndDeleteItems(curr_cmd);
      }
    }
  }

  ClearListAndDeleteItems(aList: PICKED_ITEMS_LIST): void {
    aList.ClearListAndDeleteItems((item: EDA_ITEM) => {
      console.assert(item.HasFlag(UR_TRANSIENT), 'Item on undo/redo list not owned by undo/redo!');
    });
  }

  /**
   * Check if the undo and redo operations are currently blocked.
   */
  UndoRedoBlocked(): boolean {
    return this.m_undoRedoBlocked;
  }

  /**
   * Enable/disable undo and redo operations.
   */
  UndoRedoBlock(aBlock = true): void {
    this.m_undoRedoBlocked = aBlock;
  }
}
