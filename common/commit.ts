// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `COMMIT` (include/commit.h, common/commit.cpp): a set of staged changes to
 * a model — items added, removed or modified — that `Push()` applies with an
 * undo entry, or `Revert()` undoes. `BOARD_COMMIT` and `SCH_COMMIT` are the
 * two models' subclasses.
 */
import { asEdaGroup } from './eda_group.js';
import { type EDA_ITEM, RECURSE_MODE } from './eda_item.js';
import { STRUCT_DELETED } from './eda_item_flags.js';
import { type BASE_SCREEN_LIKE, type PICKED_ITEMS_LIST, UNDO_REDO } from './undo_redo_container.js';

///< Types of changes
export enum CHANGE_TYPE {
  CHT_ADD = 1,
  CHT_REMOVE = 2,
  CHT_MODIFY = 4,
  CHT_TYPE = CHT_ADD | CHT_REMOVE | CHT_MODIFY,

  CHT_DONE = 32, ///< Flag to indicate the change is already applied
  CHT_FLAGS = CHT_DONE,
}

/** One staged change. */
export interface COMMIT_LINE {
  m_item: EDA_ITEM | null; ///< Main item that is added/deleted/modified
  m_copy: EDA_ITEM | null; ///< Optional copy of the item
  m_type: number; ///< Modification type (a CHANGE_TYPE or-ed with its flags)
  m_screen: BASE_SCREEN_LIKE | null;
}

/** `std::set<std::pair<EDA_ITEM*, BASE_SCREEN*>>`. */
class ITEM_SCREEN_SET {
  private readonly m_map = new Map<EDA_ITEM, Set<BASE_SCREEN_LIKE | null>>();

  has(aItem: EDA_ITEM, aScreen: BASE_SCREEN_LIKE | null): boolean {
    return this.m_map.get(aItem)?.has(aScreen) ?? false;
  }
  add(aItem: EDA_ITEM, aScreen: BASE_SCREEN_LIKE | null): void {
    let screens = this.m_map.get(aItem);
    if (!screens) {
      screens = new Set();
      this.m_map.set(aItem, screens);
    }
    screens.add(aScreen);
  }
  clear(): void {
    this.m_map.clear();
  }
}

/**
 * Represent a set of changes (additions, deletions or modifications) of a data model
 * (e.g. the BOARD) class.
 *
 * The changes are not immediately applied to the model; they are staged and applied on
 * Push(), which also creates the undo entry.
 */
export abstract class COMMIT {
  protected m_addedItems = new ITEM_SCREEN_SET();
  protected m_changedItems = new ITEM_SCREEN_SET();
  protected m_deletedItems = new ITEM_SCREEN_SET();
  protected m_entries: COMMIT_LINE[] = [];

  /// Add a new item to the model.
  Add(aItem: EDA_ITEM, aScreen: BASE_SCREEN_LIKE | null = null): COMMIT {
    return this.Stage(aItem, CHANGE_TYPE.CHT_ADD, aScreen);
  }

  /// Notify observers that aItem has been added.
  Added(aItem: EDA_ITEM, aScreen: BASE_SCREEN_LIKE | null = null): COMMIT {
    return this.Stage(aItem, CHANGE_TYPE.CHT_ADD | CHANGE_TYPE.CHT_DONE, aScreen);
  }

  /// Remove a new item from the model.
  Remove(aItem: EDA_ITEM, aScreen: BASE_SCREEN_LIKE | null = null): COMMIT {
    return this.Stage(aItem, CHANGE_TYPE.CHT_REMOVE, aScreen);
  }

  ///< Notify observers that aItem has been removed
  Removed(aItem: EDA_ITEM, aScreen: BASE_SCREEN_LIKE | null = null): COMMIT {
    return this.Stage(aItem, CHANGE_TYPE.CHT_REMOVE | CHANGE_TYPE.CHT_DONE, aScreen);
  }

  /**
   * Modify a given item in the model.
   *
   * @note Must be called before modification is performed.
   */
  Modify(
    aItem: EDA_ITEM,
    aScreen: BASE_SCREEN_LIKE | null = null,
    aRecurse: RECURSE_MODE = RECURSE_MODE.NO_RECURSE,
  ): COMMIT {
    return this.Stage(aItem, CHANGE_TYPE.CHT_MODIFY, aScreen, aRecurse);
  }

  /**
   * Create an undo entry for an item that has been already modified.
   *
   * @note Requires a copy done before the modification.
   */
  Modified(aItem: EDA_ITEM, aCopy: EDA_ITEM, aScreen: BASE_SCREEN_LIKE | null = null): COMMIT {
    if (this.undoLevelItem(aItem) !== aItem)
      console.assert(false, "We've no way to get a copy of the undo level item at this point");
    else this.makeEntry(aItem, CHANGE_TYPE.CHT_MODIFY, aCopy, aScreen);

    return this;
  }

  /// Add a change of the item aItem of type aChangeType to the change list.
  Stage(
    aItem: EDA_ITEM,
    aChangeType: number,
    aScreen?: BASE_SCREEN_LIKE | null,
    aRecurse?: RECURSE_MODE,
  ): COMMIT;
  Stage(container: EDA_ITEM[], aChangeType: number, aScreen?: BASE_SCREEN_LIKE | null): COMMIT;
  Stage(aItems: PICKED_ITEMS_LIST, aModFlag?: UNDO_REDO, aScreen?: BASE_SCREEN_LIKE | null): COMMIT;
  Stage(
    a: EDA_ITEM | EDA_ITEM[] | PICKED_ITEMS_LIST,
    b: number = UNDO_REDO.UNSPECIFIED,
    aScreen: BASE_SCREEN_LIKE | null = null,
    aRecurse: RECURSE_MODE = RECURSE_MODE.NO_RECURSE,
  ): COMMIT {
    if (Array.isArray(a)) return this.stageContainer(a, b, aScreen);
    if (isPickedItemsList(a)) return this.stagePickedItems(a, b as UNDO_REDO, aScreen);
    return this.stageItem(a, b, aScreen, aRecurse);
  }

  /** `Stage( EDA_ITEM*, CHANGE_TYPE, BASE_SCREEN*, RECURSE_MODE )`. */
  protected stageItem(
    aItem: EDA_ITEM,
    aChangeType: number,
    aScreen: BASE_SCREEN_LIKE | null,
    _aRecurse: RECURSE_MODE,
  ): COMMIT {
    let flags = aChangeType & CHANGE_TYPE.CHT_FLAGS;
    let changeType = aChangeType & CHANGE_TYPE.CHT_TYPE;
    const undoItem = this.undoLevelItem(aItem);

    if (undoItem !== aItem) {
      changeType = CHANGE_TYPE.CHT_MODIFY;

      // CHT_DONE means the original add/remove was already applied to the child, but that
      // semantic doesn't carry over when we remap to a modify of the parent
      flags &= ~CHANGE_TYPE.CHT_DONE;
    }

    console.assert(changeType !== CHANGE_TYPE.CHT_MODIFY || (flags & CHANGE_TYPE.CHT_DONE) === 0);

    switch (changeType) {
      case CHANGE_TYPE.CHT_ADD:
        if (this.m_addedItems.has(aItem, aScreen)) break;

        this.makeEntry(aItem, CHANGE_TYPE.CHT_ADD | flags, null, aScreen);
        break;

      case CHANGE_TYPE.CHT_REMOVE: {
        if (this.m_deletedItems.has(aItem, aScreen)) break;

        this.makeEntry(aItem, CHANGE_TYPE.CHT_REMOVE | flags, this.makeImage(aItem), aScreen);

        const parentGroup = aItem.GetParentGroup();
        if (parentGroup) {
          if (parentGroup.AsEdaItem().GetFlags() & STRUCT_DELETED)
            this.Modify(parentGroup.AsEdaItem(), aScreen, RECURSE_MODE.NO_RECURSE);
        }

        break;
      }

      case CHANGE_TYPE.CHT_MODIFY:
        if (this.m_addedItems.has(aItem, aScreen)) break;

        if (this.m_changedItems.has(undoItem, aScreen)) break;

        this.makeEntry(undoItem, CHANGE_TYPE.CHT_MODIFY | flags, this.makeImage(undoItem), aScreen);
        break;

      default:
        throw new Error(`UNIMPLEMENTED_FOR( ${undoItem.GetClass()} )`);
    }

    return this;
  }

  /** `Stage( std::vector<EDA_ITEM*>&, CHANGE_TYPE, BASE_SCREEN* )`. */
  protected stageContainer(
    container: EDA_ITEM[],
    aChangeType: number,
    aScreen: BASE_SCREEN_LIKE | null,
  ): COMMIT {
    for (const item of container) this.Stage(item, aChangeType, aScreen);

    return this;
  }

  /** `Stage( const PICKED_ITEMS_LIST&, UNDO_REDO, BASE_SCREEN* )`. */
  protected stagePickedItems(
    aItems: PICKED_ITEMS_LIST,
    aModFlag: UNDO_REDO,
    aScreen: BASE_SCREEN_LIKE | null,
  ): COMMIT {
    for (let i = 0; i < aItems.GetCount(); i++) {
      let change_type = aItems.GetPickedItemStatus(i);
      const item = aItems.GetPickedItem(i)!;

      if (change_type === UNDO_REDO.UNSPECIFIED) change_type = aModFlag;

      const copy = aItems.GetPickedItemLink(i);
      if (copy) {
        console.assert(change_type === UNDO_REDO.CHANGED);

        // There was already a copy created, so use it
        this.Modified(item, copy, aScreen);
      } else {
        this.Stage(item, this.convertFromUndoRedo(change_type), aScreen);
      }
    }

    return this;
  }

  Unstage(aItem: EDA_ITEM, aScreen: BASE_SCREEN_LIKE | null): void {
    this.m_entries = this.m_entries.filter((line) => {
      if (line.m_item === aItem && line.m_screen === aScreen) {
        // Only new items which have never been committed can be unstaged
        console.assert(line.m_item.IsNew());

        return false;
      }

      return true;
    });
  }

  /// Execute the changes.
  abstract Push(aMessage?: string, aFlags?: number): void;

  /// Revert the commit by restoring the modified items state.
  abstract Revert(): void;

  Empty(): boolean {
    return this.m_entries.length === 0;
  }

  /// Returns status of an item.
  GetStatus(aItem: EDA_ITEM, aScreen: BASE_SCREEN_LIKE | null = null): number {
    const entry = this.findEntry(this.undoLevelItem(aItem), aScreen);
    return entry ? entry.m_type : 0;
  }

  GetFirst(): EDA_ITEM | null {
    return this.m_entries.length === 0 ? null : this.m_entries[0]!.m_item;
  }

  /// Should be called in Push() & Revert() methods
  protected clear(): void {
    this.m_addedItems.clear();
    this.m_changedItems.clear();
    this.m_deletedItems.clear();
    this.m_entries = [];
  }

  protected makeEntry(
    aItem: EDA_ITEM,
    aType: number,
    aCopy: EDA_ITEM | null = null,
    aScreen: BASE_SCREEN_LIKE | null = null,
  ): void {
    const ent: COMMIT_LINE = { m_item: aItem, m_type: aType, m_copy: aCopy, m_screen: aScreen };

    // N.B. Do not throw an assertion for multiple changed items.  An item can be changed
    // multiple times in a single commit such as when importing graphics and grouping them.

    switch (aType & CHANGE_TYPE.CHT_TYPE) {
      case CHANGE_TYPE.CHT_ADD:
        this.m_addedItems.add(aItem, aScreen);
        break;
      case CHANGE_TYPE.CHT_REMOVE:
        this.m_deletedItems.add(aItem, aScreen);
        break;
      case CHANGE_TYPE.CHT_MODIFY:
        this.m_changedItems.add(aItem, aScreen);
        break;
      default:
        console.assert(false);
        break;
    }

    this.m_entries.push(ent);
  }

  /**
   * Search for an entry describing change for a particular item.
   *
   * @return null if there is no related entry.
   */
  protected findEntry(
    aItem: EDA_ITEM,
    aScreen: BASE_SCREEN_LIKE | null = null,
  ): COMMIT_LINE | null {
    for (const entry of this.m_entries) {
      if (entry.m_item === aItem && entry.m_screen === aScreen) return entry;
    }

    return null;
  }

  protected abstract undoLevelItem(aItem: EDA_ITEM): EDA_ITEM;

  protected abstract makeImage(aItem: EDA_ITEM): EDA_ITEM;

  /** `convert( UNDO_REDO aType )`. */
  protected convertFromUndoRedo(aType: UNDO_REDO): CHANGE_TYPE {
    switch (aType) {
      case UNDO_REDO.NEWITEM:
        return CHANGE_TYPE.CHT_ADD;
      case UNDO_REDO.DELETED:
        return CHANGE_TYPE.CHT_REMOVE;
      case UNDO_REDO.CHANGED:
        return CHANGE_TYPE.CHT_MODIFY;
      default:
        console.assert(false);
        return CHANGE_TYPE.CHT_MODIFY;
    }
  }

  /** `convert( CHANGE_TYPE aType )`. */
  protected convertToUndoRedo(aType: number): UNDO_REDO {
    switch (aType) {
      case CHANGE_TYPE.CHT_ADD:
        return UNDO_REDO.NEWITEM;
      case CHANGE_TYPE.CHT_REMOVE:
        return UNDO_REDO.DELETED;
      case CHANGE_TYPE.CHT_MODIFY:
        return UNDO_REDO.CHANGED;
      default:
        console.assert(false);
        return UNDO_REDO.CHANGED;
    }
  }
}

function isPickedItemsList(a: object): a is PICKED_ITEMS_LIST {
  return typeof (a as PICKED_ITEMS_LIST).GetPickedItemStatus === 'function';
}
