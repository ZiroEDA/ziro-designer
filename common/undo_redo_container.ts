// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `UNDO_REDO`, `ITEM_PICKER`, `PICKED_ITEMS_LIST` and `UNDO_REDO_CONTAINER`
 * (include/undo_redo_container.h, common/undo_redo_container.cpp): one undo
 * command is a list of pickers, each naming an item, what happened to it and,
 * for a change, the copy holding its previous state.
 *
 * `BASE_SCREEN` is eeschema's; a board has none and passes null.
 */
import { asEdaGroup } from './eda_group.js';
import type { EDA_ITEM } from './eda_item.js';
import { UR_TRANSIENT, type EDA_ITEM_FLAGS } from './eda_item_flags.js';
import { type KIID, niluuid } from './kiid.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';

/** The screen an item belongs to: eeschema's BASE_SCREEN; a board passes null. */
export type BASE_SCREEN_LIKE = object;

/**
 * Type of undo/redo operations
 *
 * Each type must be redo/undone by a specific operation.
 */
export enum UNDO_REDO {
  UNSPECIFIED = 0, // illegal
  CHANGED, // params of items have a value changed: undo is made by exchange
  // values with a copy of these values
  NEWITEM, // new item, undo by changing in deleted
  DELETED, // deleted item, undo by changing in deleted
  LIBEDIT, // Specific to the component editor (symbol_editor creates a full copy
  // of the current component when changed)
  LIB_RENAME, // As LIBEDIT, but old copy should be removed from library
  DRILLORIGIN, // origin changed (like CHANGED, contains the origin and a copy)
  GRIDORIGIN, // origin changed (like CHANGED, contains the origin and a copy)
  PAGESETTINGS, // page settings or title block changes
  REPEAT_ITEM, // storage entry for the editor's global repeatItems list
}

export class ITEM_PICKER {
  private m_pickerFlags: EDA_ITEM_FLAGS; /* A copy of m_flags member. Currently used only to flag
   * transient items. */
  private m_undoRedoStatus: UNDO_REDO; /* type of operation to undo/redo for this item */
  private m_pickedItem!: EDA_ITEM | null; /* Pointer on the schematic or board item that is concerned
   * (picked), or in undo redo commands, the copy of an
   * edited item. */
  private m_pickedItemType!: KICAD_T; /* type of schematic or board item that is concerned */
  private m_link: EDA_ITEM | null; /* Pointer on another item. Used in undo redo command
   * used when a duplicate exists i.e. when an item is
   * modified, and the copy of initial item exists (the
   * duplicate) m_Item points the duplicate (i.e the old
   * copy of an active item) and m_Link points the active
   * item in schematic */
  private m_groupId: KIID = niluuid; /* Id of the parent group */
  private m_groupMembers: KIID[] = []; /* Ids of the members of a group */
  private m_screen: BASE_SCREEN_LIKE | null; /* For new and deleted items the screen the item should
   * be added to/removed from. */

  constructor();
  constructor(aScreen: BASE_SCREEN_LIKE | null, aItem: EDA_ITEM | null, aStatus?: UNDO_REDO);
  constructor(
    aScreen: BASE_SCREEN_LIKE | null = null,
    aItem: EDA_ITEM | null = null,
    aUndoRedoStatus: UNDO_REDO = UNDO_REDO.UNSPECIFIED,
  ) {
    this.m_undoRedoStatus = aUndoRedoStatus;
    this.SetItem(aItem);
    this.m_pickerFlags = 0;
    this.m_link = null;
    this.m_screen = aScreen;
  }

  /** The copy `std::vector<ITEM_PICKER>` makes of a picker. */
  clone(): ITEM_PICKER {
    const c = new ITEM_PICKER(this.m_screen, null, this.m_undoRedoStatus);
    c.m_pickerFlags = this.m_pickerFlags;
    c.m_pickedItem = this.m_pickedItem;
    c.m_pickedItemType = this.m_pickedItemType;
    c.m_link = this.m_link;
    c.m_groupId = this.m_groupId;
    c.m_groupMembers = [...this.m_groupMembers];
    return c;
  }

  GetItem(): EDA_ITEM | null {
    return this.m_pickedItem;
  }

  SetItem(aItem: EDA_ITEM | null): void {
    this.m_pickedItem = null;
    this.m_pickedItemType = KICAD_T.TYPE_NOT_INIT;

    if (aItem) {
      this.m_pickedItem = aItem;
      this.m_pickedItemType = aItem.Type();

      const group = asEdaGroup(aItem);
      if (group) this.m_groupMembers = group.GetGroupMemberIds();

      this.m_groupId = aItem.GetParentGroupId();
    }
  }

  SetStatus(aStatus: UNDO_REDO): void {
    this.m_undoRedoStatus = aStatus;
  }
  GetStatus(): UNDO_REDO {
    return this.m_undoRedoStatus;
  }

  SetFlags(aFlags: EDA_ITEM_FLAGS): void {
    this.m_pickerFlags = aFlags;
  }
  GetFlags(): EDA_ITEM_FLAGS {
    return this.m_pickerFlags;
  }

  SetLink(aItem: EDA_ITEM | null): void {
    this.m_link = aItem;

    if (aItem) {
      const group = asEdaGroup(aItem);
      if (group) this.m_groupMembers = group.GetGroupMemberIds();

      this.m_groupId = aItem.GetParentGroupId();
    }
  }
  GetLink(): EDA_ITEM | null {
    return this.m_link;
  }
  GetGroupId(): KIID {
    return this.m_groupId;
  }
  GetGroupMembers(): KIID[] {
    return this.m_groupMembers;
  }

  GetScreen(): BASE_SCREEN_LIKE | null {
    return this.m_screen;
  }
}

/**
 * A holder to handle information on schematic or board items.
 *
 * The information held is a pointer on each item, and the command made.
 */
export class PICKED_ITEMS_LIST {
  private m_description = '';
  private m_ItemsList: ITEM_PICKER[] = [];

  /**
   * Push \a aItem to the top of the list.
   *
   * @param aItem Picker to push on to the list.
   */
  PushItem(aItem: ITEM_PICKER): void {
    this.m_ItemsList.push(aItem.clone());
  }

  /**
   * @return The picker removed from the top of the list.
   */
  PopItem(): ITEM_PICKER {
    let item = new ITEM_PICKER();

    if (this.m_ItemsList.length !== 0) {
      item = this.m_ItemsList[this.m_ItemsList.length - 1]!;
      this.m_ItemsList.pop();
    }

    return item;
  }

  /**
   * @return True if \a aItem is found in the pick list.
   */
  ContainsItem(aItem: EDA_ITEM): boolean {
    for (const picker of this.m_ItemsList) {
      if (picker.GetItem() === aItem) return true;
    }

    return false;
  }

  /**
   * @return Index of the searched item. If the item is not stored in the list, negative value
   *         is returned.
   */
  FindItem(aItem: EDA_ITEM): number {
    for (let i = 0; i < this.m_ItemsList.length; i++) {
      if (this.m_ItemsList[i]!.GetItem() === aItem) return i;
    }

    return -1;
  }

  /**
   * Delete only the list of pickers NOT the picked data itself.
   */
  ClearItemsList(): void {
    this.m_ItemsList = [];
  }

  /**
   * Delete the list of pickers AND the data pointed by #m_PickedItem or #m_PickedItemLink
   * according to the type of undo/redo command recorded.
   */
  ClearListAndDeleteItems(aItemDeleter: (aItem: EDA_ITEM) => void): void {
    while (this.GetCount() > 0) {
      const wrapper = this.PopItem();

      if (wrapper.GetItem() === null)
        // No more items in list.
        break;

      // The Link is an undo construct; it is always owned by the undo/redo container
      if (wrapper.GetLink()) aItemDeleter(wrapper.GetLink()!);

      if (wrapper.GetFlags() & UR_TRANSIENT) {
        aItemDeleter(wrapper.GetItem()!);
      } else if (wrapper.GetStatus() === UNDO_REDO.DELETED) {
        // This should really be replaced with UR_TRANSIENT, but currently many clients
        // (eeschema in particular) abuse this to achieve non-undo-related deletions.
        aItemDeleter(wrapper.GetItem()!);
      }
    }
  }

  /**
   * @return The count of pickers stored in this list.
   */
  GetCount(): number {
    return this.m_ItemsList.length;
  }

  /**
   * Reverse the order of pickers stored in this list.
   *
   * This is useful when pop a list from Undo to Redo (and vice-versa) because
   * sometimes undo (or redo) a command needs to keep the order of successive
   * changes.  Obviously, undo and redo are in reverse order
   */
  ReversePickersListOrder(): void {
    const tmp: ITEM_PICKER[] = [];

    while (this.m_ItemsList.length > 0) {
      tmp.push(this.m_ItemsList[this.m_ItemsList.length - 1]!);
      this.m_ItemsList.pop();
    }

    this.m_ItemsList = tmp;
  }

  /**
   * @return The picker of a picked item.
   * @param aIdx Index of the picker in the picked list if this picker does not exist,
   *             a picker is returned, with its members set to 0 or NULL.
   */
  GetItemWrapper(aIdx: number): ITEM_PICKER {
    const picker = this.m_ItemsList[aIdx];
    if (!picker) throw new RangeError(`PICKED_ITEMS_LIST: no picker at ${aIdx}`); // std::vector::at
    return picker;
  }

  /**
   * @return A pointer to the picked item.
   * @param aIdx Index of the picked item in the picked list.
   */
  GetPickedItem(aIdx: number): EDA_ITEM | null {
    if (aIdx < this.m_ItemsList.length) return this.m_ItemsList[aIdx]!.GetItem();

    return null;
  }

  /**
   * @return A pointer to the picked item's screen.
   * @param aIdx Index of the picked item in the picked list.
   */
  GetScreenForItem(aIdx: number): BASE_SCREEN_LIKE | null {
    if (aIdx < this.m_ItemsList.length) return this.m_ItemsList[aIdx]!.GetScreen();

    return null;
  }

  /**
   * @return link of the picked item, or null if does not exist.
   * @param aIdx Index of the picked item in the picked list.
   */
  GetPickedItemLink(aIdx: number): EDA_ITEM | null {
    if (aIdx < this.m_ItemsList.length) return this.m_ItemsList[aIdx]!.GetLink();

    return null;
  }

  /**
   * @return The type of undo/redo operation associated to the picked item,
   *          or UNSPECIFIED if does not exist.
   * @param aIdx Index of the picked item in the picked list.
   */
  GetPickedItemStatus(aIdx: number): UNDO_REDO {
    if (aIdx < this.m_ItemsList.length) return this.m_ItemsList[aIdx]!.GetStatus();

    return UNDO_REDO.UNSPECIFIED;
  }

  /**
   * Return the value of the picker flag.
   *
   * @param aIdx Index of the picker in the picked list.
   * @return The value stored in the picker, if the picker exists, or 0 if does not exist.
   */
  GetPickerFlags(aIdx: number): EDA_ITEM_FLAGS {
    if (aIdx < this.m_ItemsList.length) return this.m_ItemsList[aIdx]!.GetFlags();

    return 0;
  }

  /**
   * @param aItem A pointer to the item to pick.
   * @param aIdx Index of the picker in the picked list.
   * @return True if the picker exists or false if does not exist.
   */
  SetPickedItem(aItem: EDA_ITEM | null, aIdx: number): boolean {
    if (aIdx < this.m_ItemsList.length) {
      this.m_ItemsList[aIdx]!.SetItem(aItem);
      return true;
    }

    return false;
  }

  /**
   * Set the link associated to a given picked item.
   *
   * @param aLink is the link to the item associated to the picked item.
   * @param aIdx is index of the picker in the picked list.
   * @return true if the picker exists, or false if does not exist.
   */
  SetPickedItemLink(aLink: EDA_ITEM | null, aIdx: number): boolean {
    if (aIdx < this.m_ItemsList.length) {
      this.m_ItemsList[aIdx]!.SetLink(aLink);
      return true;
    }

    return false;
  }

  /**
   * Set the type of undo/redo operation for a given picked item.
   *
   * @param aStatus The type of undo/redo operation associated to the picked item
   * @param aIdx Index of the picker in the picked list
   * @return True if the picker exists or false if does not exist
   */
  SetPickedItemStatus(aStatus: UNDO_REDO, aIdx: number): boolean {
    if (aIdx < this.m_ItemsList.length) {
      this.m_ItemsList[aIdx]!.SetStatus(aStatus);
      return true;
    }

    return false;
  }

  /**
   * Set the flags of the picker (usually to the picked item m_flags value).
   *
   * @param aFlags The flag value to save in picker.
   * @param aIdx Index of the picker in the picked list.
   * @return True if the picker exists or false if does not exist.
   */
  SetPickerFlags(aFlags: EDA_ITEM_FLAGS, aIdx: number): boolean {
    if (aIdx < this.m_ItemsList.length) {
      this.m_ItemsList[aIdx]!.SetFlags(aFlags);
      return true;
    }

    return false;
  }

  /**
   * Remove one entry (one picker) from the list of picked items.
   *
   * @param aIdx Index of the picker in the picked list.
   * @return True if ok or false if did not exist.
   */
  RemovePicker(aIdx: number): boolean {
    if (aIdx >= this.m_ItemsList.length) return false;

    this.m_ItemsList.splice(aIdx, 1);
    return true;
  }

  /**
   * Copy all data from aSource to the list.
   *
   * Items picked are not copied. just pointer in them are copied.
   *
   * @param aSource The list of items to copy to the list.
   */
  CopyList(aSource: PICKED_ITEMS_LIST): void {
    this.m_ItemsList = aSource.m_ItemsList.map((p) => p.clone()); // Vector's copy
  }

  GetDescription(): string {
    return this.m_description;
  }
  SetDescription(aDescription: string): void {
    this.m_description = aDescription;
  }
}

/**
 * A holder to handle a list of undo (or redo) commands.
 */
export class UNDO_REDO_CONTAINER {
  m_CommandsList: PICKED_ITEMS_LIST[] = []; // the list of possible undo/redo commands

  PushCommand(aItem: PICKED_ITEMS_LIST): void {
    this.m_CommandsList.push(aItem);
  }

  PopCommand(): PICKED_ITEMS_LIST | null {
    if (this.m_CommandsList.length !== 0) {
      const item = this.m_CommandsList[this.m_CommandsList.length - 1]!;
      this.m_CommandsList.pop();
      return item;
    }

    return null;
  }

  ClearCommandList(): void {
    this.m_CommandsList = [];
  }
}
