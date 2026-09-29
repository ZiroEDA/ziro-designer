// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/schematic_undo_redo.cpp`: `SCH_EDIT_FRAME`'s undo/redo half, on the live
 * items - `SaveCopyInUndoList` (both overloads), `PutDataInPreviousState`,
 * `RollbackSchematicFromUndo` and `ClearUndoORRedoList`.
 *
 * Functions to undo and redo edit commands.
 *
 *  m_UndoList and m_RedoList handle a std::vector of PICKED_ITEMS_LIST.  Each PICKED_ITEMS_LIST
 *  handles a std::vector of ITEM_PICKER that store the list of schematic items that are concerned
 *  by the command to undo or redo and is created for each command to undo/redo).  Each picker has
 *  a pointer pointing to an item to undo or redo (in fact: deleted, added or modified), and has a
 *  pointer to a copy of this item, when this item has been modified (the old values of parameters
 *  are therefore saved).
 *
 *  there are 3 cases:
 *  - delete item(s) command
 *  - change item(s) command
 *  - add item(s) command
 *
 *  Undo command
 *  - delete item(s) command:
 *       =>  deleted items are moved in undo list
 *
 *  - change item(s) command
 *      => A copy of item(s) is made (a DrawPickedStruct list of wrappers)
 *      the .m_Link member of each wrapper points the modified item.
 *      the .m_Item member of each wrapper points the old copy of this item.
 *
 *  - add item(s) command
 *      =>A list of item(s) is made. The .m_Item member of each wrapper points
 *        the new item.
 *
 *  Redo command
 *  - delete item(s) old command:
 *      => deleted items are moved into m_tree
 *
 *  - change item(s) command
 *      => the copy of item(s) is moved in Undo list
 *
 *  - add item(s) command
 *      => The list of item(s) is used to create a deleted list in undo
 *         list(same as a delete command)
 *
 * A TypeScript class cannot be split across files the way one C++ class's methods are
 * split across `.cpp` files, so this is `SCH_UNDO_REDO_MIXIN`, mixed into `SCH_EDIT_FRAME`
 * by `sch_edit_frame.ts` with `applyMixins` - the pattern `pcbnew/undo_redo.ts` uses.  Each
 * method takes `this: SCH_EDIT_FRAME`.
 *
 * Not here: the `PAGESETTINGS` command (`DS_PROXY_UNDO_ITEM` is not ported; such a picker
 * is skipped), and the view calls (`ClearHiddenFlags`, the canvas refresh): the live frame
 * has no view yet.
 */

import { UNDO_REDO_LIST } from '@ziroeda/common/eda_base_frame.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { UR_TRANSIENT } from '@ziroeda/common/eda_item_flags.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { ITEM_PICKER, PICKED_ITEMS_LIST, UNDO_REDO } from '@ziroeda/common/undo_redo_container.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_COMMIT } from './sch_commit.js';
import type { SCH_EDIT_FRAME } from './sch_edit_frame.js';
import type { SCH_FIELD } from './sch_field.js';
import { SCH_GROUP } from './sch_group.js';
import { SCH_ITEM } from './sch_item.js';
import type { SCH_SCREEN } from './sch_screen.js';
import type { SCH_SHEET } from './sch_sheet.js';
import type { SCH_SYMBOL } from './sch_symbol.js';
import { SCH_CLEANUP_FLAGS } from './schematic.js';

/** `IGNORE_PARENT_GROUP`: `Duplicate`'s addToParentGroup = false. */
const IGNORE_PARENT_GROUP = false;

/** `dynamic_cast<SCH_ITEM*>`. */
const asSchItem = (aItem: EDA_ITEM | null): SCH_ITEM | null =>
  aItem instanceof SCH_ITEM ? aItem : null;

export class SCH_UNDO_REDO_MIXIN {
  /**
   * Create a copy of the current schematic item, and put it in the undo list.
   *
   *  flag_type_command =
   *      - UNDO_REDO::CHANGED
   *      - UNDO_REDO::NEWITEM
   *      - UNDO_REDO::DELETED
   *
   * If it is a delete command, items are put on list with the .Flags member set to
   * UNDO_REDO::DELETED.
   *
   * @note Edit wires and buses is a bit complex.
   * because when a new wire is added, a lot of modifications in wire list is made
   * (wire concatenation): modified items, deleted items and new items
   * so flag_type_command is UNDO_REDO::WIRE_IMAGE: the struct ItemToCopy is a list of
   * wires saved in Undo List (for Undo or Redo commands, saved wires will be exchanged
   * with current wire list
   */
  SaveCopyInUndoList(
    this: SCH_EDIT_FRAME,
    aScreen: SCH_SCREEN,
    aItem: SCH_ITEM,
    aCommandType: UNDO_REDO,
    aAppend: boolean,
  ): void;
  /**
   * Create a new entry in undo list of commands.
   *
   * @param aItemsList the list of items modified by the command to undo
   * @param aTypeCommand the command type (see enum UNDO_REDO)
   * @param aAppend set to true to add the item(s) to the top of the undo stack
   */
  SaveCopyInUndoList(
    this: SCH_EDIT_FRAME,
    aItemsList: PICKED_ITEMS_LIST,
    aTypeCommand: UNDO_REDO,
    aAppend: boolean,
  ): void;
  SaveCopyInUndoList(
    this: SCH_EDIT_FRAME,
    a: SCH_SCREEN | PICKED_ITEMS_LIST,
    b: SCH_ITEM | UNDO_REDO,
    c: UNDO_REDO | boolean,
    d?: boolean,
  ): void {
    if (a instanceof PICKED_ITEMS_LIST) {
      this.saveListInUndoList(a, b as UNDO_REDO, c as boolean);
      return;
    }

    const aScreen = a as SCH_SCREEN;
    const aItem = b as SCH_ITEM;
    const aCommandType = c as UNDO_REDO;
    const aAppend = d ?? false;
    let commandToUndo: PICKED_ITEMS_LIST | null = null;

    if (!aItem) return; // wxCHECK

    const lastUndo = this.PopCommandFromUndoList();

    // If the last stack was empty, use that one instead of creating a new stack
    if (lastUndo) {
      if (aAppend || !lastUndo.GetCount()) commandToUndo = lastUndo;
      else this.PushCommandToUndoList(lastUndo);
    }

    if (!commandToUndo) commandToUndo = new PICKED_ITEMS_LIST();

    const itemWrapper = new ITEM_PICKER(aScreen, aItem, aCommandType);
    itemWrapper.SetFlags(aItem.GetFlags());

    switch (aCommandType) {
      case UNDO_REDO.CHANGED /* Create a copy of item */:
        itemWrapper.SetLink(aItem.Duplicate(IGNORE_PARENT_GROUP, null, true));
        commandToUndo.PushItem(itemWrapper);
        break;

      case UNDO_REDO.NEWITEM:
      case UNDO_REDO.DELETED:
        commandToUndo.PushItem(itemWrapper);
        break;

      default:
        console.assert(false, `SaveCopyInUndoList() error (unknown code ${aCommandType})`);
        break;
    }

    if (commandToUndo.GetCount()) {
      /* Save the copy in undo list */
      this.PushCommandToUndoList(commandToUndo);

      /* Clear redo list, because after new save there is no redo to do */
      this.ClearUndoORRedoList(UNDO_REDO_LIST.REDO_LIST);
    }
  }

  /** `SaveCopyInUndoList( const PICKED_ITEMS_LIST&, UNDO_REDO, bool )`. */
  private saveListInUndoList(
    this: SCH_EDIT_FRAME,
    aItemsList: PICKED_ITEMS_LIST,
    aTypeCommand: UNDO_REDO,
    aAppend: boolean,
  ): void {
    let commandToUndo: PICKED_ITEMS_LIST | null = null;

    if (!aItemsList.GetCount()) return;

    const lastUndo = this.PopCommandFromUndoList();

    // If the last stack was empty, use that one instead of creating a new stack
    if (lastUndo) {
      if (aAppend || !lastUndo.GetCount()) commandToUndo = lastUndo;
      else this.PushCommandToUndoList(lastUndo);
    }

    if (!commandToUndo) {
      commandToUndo = new PICKED_ITEMS_LIST();
      commandToUndo.SetDescription(aItemsList.GetDescription());
    }

    // Copy picker list:
    if (!commandToUndo.GetCount()) {
      commandToUndo.CopyList(aItemsList);

      for (const item of this.GetRepeatItems()) {
        const repeatItemClone = item.Clone();
        repeatItemClone.SetFlags(UR_TRANSIENT);

        const repeatItemPicker = new ITEM_PICKER(null, repeatItemClone, UNDO_REDO.REPEAT_ITEM);
        commandToUndo.PushItem(repeatItemPicker);
      }
    } else {
      // Unless we are appending, in which case, get the picker items
      for (let ii = 0; ii < aItemsList.GetCount(); ii++)
        commandToUndo.PushItem(aItemsList.GetItemWrapper(ii));
    }

    // Verify list, and creates data if needed
    for (let ii = 0; ii < commandToUndo.GetCount(); ii++) {
      const sch_item = asSchItem(commandToUndo.GetPickedItem(ii));

      // Common items implemented in EDA_DRAW_FRAME will not be SCH_ITEMs.
      if (!sch_item) continue;

      let command = commandToUndo.GetPickedItemStatus(ii);

      if (command === UNDO_REDO.UNSPECIFIED) {
        command = aTypeCommand;
        commandToUndo.SetPickedItemStatus(command, ii);
      }

      switch (command) {
        case UNDO_REDO.CHANGED:
          /* If needed, create a copy of item, and put in undo list
           * in the picker, as link
           * If this link is not null, the copy is already done
           */
          if (commandToUndo.GetPickedItemLink(ii) === null)
            commandToUndo.SetPickedItemLink(
              sch_item.Duplicate(IGNORE_PARENT_GROUP, null, true),
              ii,
            );

          console.assert(commandToUndo.GetPickedItemLink(ii) !== null);
          break;

        case UNDO_REDO.NEWITEM:
        case UNDO_REDO.DELETED:
        case UNDO_REDO.PAGESETTINGS:
        case UNDO_REDO.REPEAT_ITEM:
          break;

        default:
          console.assert(false, `Unknown undo/redo command ${command}`);
          break;
      }
    }

    if (commandToUndo.GetCount()) {
      /* Save the copy in undo list */
      this.PushCommandToUndoList(commandToUndo);

      /* Clear redo list, because after new save there is no redo to do */
      this.ClearUndoORRedoList(UNDO_REDO_LIST.REDO_LIST);
    }
  }

  /**
   * Restore an undo or redo command to put data pointed by \a aList in the previous state.
   *
   * @param aList a PICKED_ITEMS_LIST pointer to the list of items to undo/redo
   */
  PutDataInPreviousState(this: SCH_EDIT_FRAME, aList: PICKED_ITEMS_LIST): void {
    const bulkAddedItems: SCH_ITEM[] = [];
    const bulkRemovedItems: SCH_ITEM[] = [];
    const bulkChangedItems: SCH_ITEM[] = [];
    let updateVariantCtrl = false;
    let dirtyConnectivity = false;
    let rebuildHierarchyNavigator = false;
    let refreshHierarchy = false;
    let connectivityCleanUp = SCH_CLEANUP_FLAGS.NO_CLEANUP;
    let sheets = this.Schematic().Hierarchy();
    let clearedRepeatItems = false;

    // Undo in the reverse order of list creation: (this can allow stacked changes like the
    // same item can be changed and deleted in the same complex command).
    for (let ii = aList.GetCount() - 1; ii >= 0; ii--) {
      const status = aList.GetPickedItemStatus(ii);
      const eda_item = aList.GetPickedItem(ii)!;
      const screen = aList.GetScreenForItem(ii) as SCH_SCREEN | null;
      const undoSheet = sheets.FindSheetForScreen(screen as SCH_SCREEN);

      eda_item.SetFlags(aList.GetPickerFlags(ii));
      eda_item.ClearEditFlags();
      eda_item.ClearTempFlags();

      // Set connectable object connectivity status.
      const propagateConnectivityDamage = (schItem: SCH_ITEM): void => {
        if (schItem.IsConnectable()) {
          schItem.SetConnectivityDirty();

          if (schItem.Type() === KICAD_T.SCH_SYMBOL_T) {
            const symbol = schItem as SCH_SYMBOL;

            for (const pin of symbol.GetPins(undoSheet)) pin.SetConnectivityDirty();
          } else if (schItem.Type() === KICAD_T.SCH_SHEET_T) {
            const sheet = schItem as SCH_SHEET;

            for (const pin of sheet.GetPins()) pin.SetConnectivityDirty();
          }

          this.m_highlightedConnChanged = true;
          dirtyConnectivity = true;

          // Do a local clean up if there are any connectable objects in the commit
          if (connectivityCleanUp === SCH_CLEANUP_FLAGS.NO_CLEANUP)
            connectivityCleanUp = SCH_CLEANUP_FLAGS.LOCAL_CLEANUP;

          // Do a full rebauild of the connectivity if there is a sheet in the commit
          if (schItem.Type() === KICAD_T.SCH_SHEET_T)
            connectivityCleanUp = SCH_CLEANUP_FLAGS.GLOBAL_CLEANUP;
        } else if (schItem.Type() === KICAD_T.SCH_RULE_AREA_T) {
          dirtyConnectivity = true;
        }
      };

      const schItem = asSchItem(eda_item);

      if (status === UNDO_REDO.NEWITEM) {
        if (schItem) propagateConnectivityDamage(schItem);

        // If we are removing the current sheet, get out first
        if (eda_item.Type() === KICAD_T.SCH_SHEET_T) {
          rebuildHierarchyNavigator = true;
          refreshHierarchy = true;

          // SCH_ACTIONS::leaveSheet when the sheet's screen is the current one: the live
          // frame has no tool actions yet.
        }

        this.RemoveFromScreen(eda_item, screen);
        aList.SetPickedItemStatus(UNDO_REDO.DELETED, ii);

        bulkRemovedItems.push(schItem!);
      } else if (status === UNDO_REDO.DELETED) {
        if (eda_item.Type() === KICAD_T.SCH_SHEET_T) {
          rebuildHierarchyNavigator = true;
          refreshHierarchy = true;
        }

        if (schItem) propagateConnectivityDamage(schItem);

        // deleted items are re-inserted on undo
        this.AddToScreen(eda_item, screen);
        aList.SetPickedItemStatus(UNDO_REDO.NEWITEM, ii);

        bulkAddedItems.push(schItem!);
      } else if (status === UNDO_REDO.PAGESETTINGS) {
        // DS_PROXY_UNDO_ITEM::Restore: not ported (see the header).
      } else if (status === UNDO_REDO.REPEAT_ITEM) {
        if (!clearedRepeatItems) {
          this.ClearRepeatItemsList();
          clearedRepeatItems = true;
        }

        if (schItem) {
          propagateConnectivityDamage(schItem);
          this.AddCopyForRepeatItem(schItem);

          if (schItem.Type() === KICAD_T.SCH_SHEET_T) {
            rebuildHierarchyNavigator = true;
            refreshHierarchy = true;
          }
        }
      } else if (schItem) {
        const itemCopy = asSchItem(aList.GetPickedItemLink(ii));

        if (!itemCopy) continue; // wxCHECK2

        if (schItem.HasConnectivityChanges(itemCopy, this.GetCurrentSheet()))
          propagateConnectivityDamage(schItem);

        // The root sheet is a pseudo object that owns the root screen object but is not on
        // the root screen so do not attempt to remove it from the screen it owns.
        if (schItem !== this.Schematic().Root()) this.RemoveFromScreen(schItem, screen);

        switch (status) {
          case UNDO_REDO.CHANGED: {
            if (schItem.Type() === KICAD_T.SCH_SHEET_T) {
              const origSheet = schItem as SCH_SHEET;
              const copySheet = itemCopy as SCH_SHEET;

              if (
                origSheet.GetName() !== copySheet.GetName() ||
                origSheet.GetFileName() !== copySheet.GetFileName() ||
                origSheet.HasPageNumberChanges(copySheet)
              ) {
                rebuildHierarchyNavigator = true;
              }

              // Sheet name changes do not require rebuilding the hiearchy.
              if (
                origSheet.GetFileName() !== copySheet.GetFileName() ||
                origSheet.HasPageNumberChanges(copySheet)
              ) {
                refreshHierarchy = true;
              }

              updateVariantCtrl = true;
            }

            if (schItem.Type() === KICAD_T.SCH_SYMBOL_T) updateVariantCtrl = true;

            schItem.SwapItemData(itemCopy);

            bulkChangedItems.push(schItem);

            // Special cases for items which have instance data
            if (
              schItem.GetParent() &&
              schItem.GetParent()!.Type() === KICAD_T.SCH_SYMBOL_T &&
              schItem.Type() === KICAD_T.SCH_FIELD_T
            ) {
              const field = schItem as SCH_FIELD;
              const symbol = schItem.GetParent() as SCH_SYMBOL;

              if (field.GetId() === FIELD_T.REFERENCE) {
                // Lazy eval of sheet list; this is expensive even when unsorted
                if (sheets.length === 0) sheets = this.Schematic().Hierarchy();

                const sheet = sheets.FindSheetForScreen(screen!);
                symbol.SetRef(sheet, field.GetText());
              }

              bulkChangedItems.push(symbol);
            }

            break;
          }

          default:
            console.assert(false, `Unknown undo/redo command ${status}`);
            break;
        }

        if (schItem.Type() === KICAD_T.SCH_SYMBOL_T) {
          const sym = schItem as SCH_SYMBOL;
          sym.UpdatePins();
        }

        if (schItem !== this.Schematic().Root()) this.AddToScreen(schItem, screen);
      }
    }

    // We have now swapped all the group parent and group member pointers.  But it is a
    // risky proposition to bet on the pointers being invariant, so validate them all.
    //
    // Two passes: restore each item's parent group first, then rebuild each group's members.
    // The rebuild comes last so a member keeps its group even if its item was restored before it.
    for (let ii = 0; ii < aList.GetCount(); ++ii) {
      const wrapper = aList.GetItemWrapper(ii);

      if (wrapper.GetStatus() === UNDO_REDO.DELETED) continue;

      const parentGroup = this.Schematic().ResolveItem(wrapper.GetGroupId(), null, true);
      wrapper.GetItem()!.SetParentGroup(parentGroup instanceof SCH_GROUP ? parentGroup : null);
    }

    for (let ii = 0; ii < aList.GetCount(); ++ii) {
      const wrapper = aList.GetItemWrapper(ii);

      if (wrapper.GetStatus() === UNDO_REDO.DELETED) continue;

      const group = wrapper.GetItem();

      if (group instanceof SCH_GROUP) {
        // Items list may contain dodgy pointers, so don't use RemoveAll().  AddItem() also
        // re-links each member back to the group.
        group.GetItems().clear();

        for (const member of wrapper.GetGroupMembers()) {
          const memberItem = this.Schematic().ResolveItem(member, null, true);

          if (memberItem) group.AddItem(memberItem);
        }
      }

      // And prepare for a redo by updating group info based on current image
      const item = wrapper.GetLink();

      if (item) wrapper.SetLink(item);
    }

    // Notify our listeners
    if (bulkAddedItems.length > 0) this.Schematic().OnItemsAdded(bulkAddedItems);

    if (bulkRemovedItems.length > 0) this.Schematic().OnItemsRemoved(bulkRemovedItems);

    if (bulkChangedItems.length > 0) this.Schematic().OnItemsChanged(bulkChangedItems);

    if (refreshHierarchy) this.Schematic().RefreshHierarchy();

    if (dirtyConnectivity) {
      const localCommit = new SCH_COMMIT(this.GetToolManager()!);

      this.RecalculateConnections(localCommit, connectivityCleanUp);

      // (a `let` the closure above assigns: TS narrows it to its initial value here)
      if ((connectivityCleanUp as SCH_CLEANUP_FLAGS) === SCH_CLEANUP_FLAGS.GLOBAL_CLEANUP)
        this.SetSheetNumberAndCount();

      // Restore hop over shapes of wires, if any
      if (this.Schematic().Settings().GetHopOverScale() > 0.0) {
        for (const item of this.GetScreen()!.Items()) {
          if (item.Type() !== KICAD_T.SCH_LINE_T) continue;

          const line = item as unknown as { IsWire(): boolean; IsBus(): boolean };

          if (line.IsWire() || line.IsBus()) this.UpdateHopOveredWires(item);
        }
      }
    }

    // Update the hierarchy navigator when there are sheet changes.
    if (rebuildHierarchyNavigator) this.UpdateHierarchyNavigator();

    if (updateVariantCtrl) {
      this.Schematic().LoadVariants();
      this.UpdateVariantSelectionCtrl(this.Schematic().GetVariantNamesForUI());
    }
  }

  /**
   * Free the undo or redo list from \a aList element.
   *
   * - Wrappers are deleted.
   * - data pointed by wrappers are deleted if not in use in schematic
   *   i.e. when they are copy of a schematic item or they are no more in use (DELETED)
   *
   * @param whichList = the UNDO_REDO_CONTAINER to clear
   * @param aItemCount = the count of items to remove. < 0 for all items
   * items are removed from the beginning of the list.
   * So this function can be called to remove old commands
   */
  ClearUndoORRedoList(this: SCH_EDIT_FRAME, whichList: UNDO_REDO_LIST, aItemCount = -1): void {
    if (aItemCount === 0) return;

    const list = whichList === UNDO_REDO_LIST.UNDO_LIST ? this.m_undoList : this.m_redoList;

    if (aItemCount < 0) {
      list.ClearCommandList();
    } else {
      for (let ii = 0; ii < aItemCount; ii++) {
        if (list.m_CommandsList.length === 0) break;

        const curr_cmd = list.m_CommandsList.shift()!;

        curr_cmd.ClearListAndDeleteItems(() => {});
      }
    }
  }

  /**
   * Free the undo or redo list from \a List element.
   *
   * This is the last undo entry, popped and put back: `RollbackSchematicFromUndo`.
   */
  RollbackSchematicFromUndo(this: SCH_EDIT_FRAME): void {
    let undo = this.PopCommandFromUndoList();

    // Skip empty frames
    while (undo && !undo.GetCount()) undo = this.PopCommandFromUndoList();

    if (undo) {
      this.PutDataInPreviousState(undo);
      undo.ClearListAndDeleteItems(() => {});

      const selTool = this.GetToolManager()?.FindTool(
        'eeschema.InteractiveSelection',
      ) as unknown as {
        RebuildSelection(): void;
      } | null;

      selTool?.RebuildSelection();
    }
  }
}
