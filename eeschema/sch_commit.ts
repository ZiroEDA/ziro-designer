// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_commit.h` / `sch_commit.cpp`: `SCH_COMMIT`, the one way a schematic (or,
 * in the symbol editor, a library symbol) is edited on the live items.  Tools stage their
 * adds, removes and modifies; `Push` applies them to the screens, files one undo entry with
 * the frame and recalculates the connectivity; `Revert` puts the staged items back.
 *
 * The frame, the view and the selection tool are reached the way upstream reaches them,
 * through the tool manager - `GetToolHolder()`, `GetView()`, the tool registered as
 * `eeschema.InteractiveSelection` - and each may be absent (a bare `TOOL_MANAGER`, as in
 * KiCad's own QA).  What the commit calls on them is {@link SCH_EDIT_FRAME_FOR_COMMIT},
 * {@link SYMBOL_EDIT_FRAME_FOR_COMMIT} and {@link SCH_SELECTION_TOOL_FOR_COMMIT}; the
 * frame classes are not live yet (only `SCH_EDIT_FRAME`'s undo half is, in
 * `schematic_undo_redo.ts`).
 */

import { CHANGE_TYPE, COMMIT } from '@ziroeda/common/commit.js';
import type { EDA_BASE_FRAME } from '@ziroeda/common/eda_base_frame.js';
import { type EDA_ITEM, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import {
  EDA_ITEM_ALL_FLAGS,
  ENDPOINT,
  SELECTED,
  SELECTED_BY_DRAG,
  STARTPOINT,
} from '@ziroeda/common/eda_item_flags.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { TOOL_ACTION_SCOPE } from '@ziroeda/common/tool/tool_action.js';
import { RESET_REASON, type TOOL_BASE } from '@ziroeda/common/tool/tool_base.js';
import {
  EVENTS,
  TOOL_ACTIONS,
  TOOL_EVENT,
  TOOL_EVENT_CATEGORY,
} from '@ziroeda/common/tool/tool_event.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import {
  type BASE_SCREEN_LIKE,
  ITEM_PICKER,
  PICKED_ITEMS_LIST,
  UNDO_REDO,
} from '@ziroeda/common/undo_redo_container.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { LIB_SYMBOL } from './lib_symbol.js';
import type { SCH_FIELD } from './sch_field.js';
import { SCH_GROUP } from './sch_group.js';
import { SCH_ITEM } from './sch_item.js';
import type { SCH_SCREEN } from './sch_screen.js';
import type { SCH_SHEET } from './sch_sheet.js';
import { SCH_SHEET_LIST, type SCH_SHEET_PATH } from './sch_sheet_path.js';
import type { SCH_SYMBOL } from './sch_symbol.js';
import { SCH_CLEANUP_FLAGS, type SCHEMATIC } from './schematic.js';

export const SKIP_UNDO = 0x0001;
export const APPEND_UNDO = 0x0002;
export const SKIP_SET_DIRTY = 0x0004;

/**
 * `SCH_SELECTION_TOOL`'s registered name: `SELECTION_TOOL( "common.InteractiveSelection" )`
 * (sch_selection_tool.cpp:178), what `GetTool<SCH_SELECTION_TOOL>()` finds.
 */
export const SCH_SELECTION_TOOL_NAME = 'common.InteractiveSelection';

/** What the commit asks of `SCH_SELECTION_TOOL`. */
export interface SCH_SELECTION_TOOL_FOR_COMMIT {
  GetEnteredGroup(): SCH_GROUP | null;
  RemoveItemFromSel(aItem: EDA_ITEM, aQuietMode?: boolean): void;
  RebuildSelection(): void;
}

/** What the commit asks of `SCH_EDIT_FRAME`. */
export interface SCH_EDIT_FRAME_FOR_COMMIT {
  IsType(aType: FRAME_T): boolean;
  GetScreen(): SCH_SCREEN | null;
  GetCurrentSheet(): SCH_SHEET_PATH;
  UpdateHopOveredWires(aItem: SCH_ITEM): void;
  UpdateItem(aItem: EDA_ITEM, isAddOrDelete?: boolean, aUpdateRtree?: boolean): void;
  SaveCopyInUndoList(
    aItemsList: PICKED_ITEMS_LIST,
    aTypeCommand: UNDO_REDO,
    aAppend: boolean,
  ): void;
  RecalculateConnections(aCommit: SCH_COMMIT | null, aCleanupFlags: SCH_CLEANUP_FLAGS): void;
  UpdateHierarchyNavigator(): void;
  OnModify(): void;
  GetCanvas?(): { Refresh(): void } | null;
}

/** What the commit asks of `SYMBOL_EDIT_FRAME`. */
export interface SYMBOL_EDIT_FRAME_FOR_COMMIT {
  IsType(aType: FRAME_T): boolean;
  GetCurSymbol(): LIB_SYMBOL | null;
  SetCurSymbol(aSymbol: LIB_SYMBOL, aUpdateZoom: boolean): void;
  PushSymbolToUndoList(aDescription: string, aSymbolCopy: LIB_SYMBOL): void;
  OnModify(): void;
  GetCanvas?(): { Refresh(): void } | null;
}

/** `SCH_TOOL_BASE<SCH_BASE_FRAME>`: a tool that knows whether it runs in the symbol editor. */
interface SCH_TOOL_BASE_LIKE {
  GetManager(): TOOL_MANAGER | null;
  IsSymbolEditor(): boolean;
}

function isSchToolBase(a: unknown): a is SCH_TOOL_BASE_LIKE {
  return (
    typeof (a as SCH_TOOL_BASE_LIKE).GetManager === 'function' &&
    typeof (a as SCH_TOOL_BASE_LIKE).IsSymbolEditor === 'function'
  );
}

/** `dynamic_cast<SCH_ITEM*>`. */
const asSchItem = (aItem: EDA_ITEM | null): SCH_ITEM | null =>
  aItem instanceof SCH_ITEM ? aItem : null;

export class SCH_COMMIT extends COMMIT {
  private m_toolMgr: TOOL_MANAGER;
  private m_isLibEditor: boolean;

  constructor(aToolMgr: TOOL_MANAGER);
  constructor(aTool: TOOL_BASE);
  /**
   * `SCH_COMMIT( EDA_DRAW_FRAME* )`, widened to `EDA_BASE_FRAME`: the live `SCH_EDIT_FRAME`
   * is not a draw frame yet, and all the constructor asks is the tool manager and the type.
   */
  constructor(aFrame: EDA_BASE_FRAME);
  constructor(a: TOOL_MANAGER | TOOL_BASE | EDA_BASE_FRAME) {
    super();

    if (isSchToolBase(a)) {
      // SCH_COMMIT( SCH_TOOL_BASE<SCH_BASE_FRAME>* aTool )
      this.m_toolMgr = a.GetManager()!;
      this.m_isLibEditor = a.IsSymbolEditor();
    } else if (typeof (a as EDA_BASE_FRAME).GetToolManager === 'function') {
      // SCH_COMMIT( EDA_DRAW_FRAME* aFrame )
      const frame = a as EDA_BASE_FRAME;
      this.m_toolMgr = frame.GetToolManager()!;
      this.m_isLibEditor = frame.IsType(FRAME_T.FRAME_SCH_SYMBOL_EDITOR);
    } else {
      // SCH_COMMIT( TOOL_MANAGER* aToolMgr )
      this.m_toolMgr = a as TOOL_MANAGER;
      const frame = this.m_toolMgr.GetToolHolder() as unknown as { IsType?(t: FRAME_T): boolean };
      this.m_isLibEditor = !!frame?.IsType?.(FRAME_T.FRAME_SCH_SYMBOL_EDITOR);
    }
  }

  private schFrame(): SCH_EDIT_FRAME_FOR_COMMIT | null {
    return this.m_toolMgr.GetToolHolder() as unknown as SCH_EDIT_FRAME_FOR_COMMIT | null;
  }

  private symbolFrame(): SYMBOL_EDIT_FRAME_FOR_COMMIT | null {
    return this.m_toolMgr.GetToolHolder() as unknown as SYMBOL_EDIT_FRAME_FOR_COMMIT | null;
  }

  private selTool(): SCH_SELECTION_TOOL_FOR_COMMIT | null {
    return this.m_toolMgr.FindTool(
      SCH_SELECTION_TOOL_NAME,
    ) as unknown as SCH_SELECTION_TOOL_FOR_COMMIT | null;
  }

  protected override stageItem(
    aItem: EDA_ITEM,
    aChangeType: number,
    aScreen: BASE_SCREEN_LIKE | null,
    aRecurse: RECURSE_MODE,
  ): COMMIT {
    if (!aItem) return this; // wxCHECK( aItem, *this )

    if (aRecurse === RECURSE_MODE.RECURSE) {
      if (aItem instanceof SCH_GROUP) {
        for (const member of aItem.GetItems()) this.Stage(member, aChangeType, aScreen, aRecurse);
      }
    }

    // IS_SELECTED flag should not be set on undo items which were added for a drag operation.
    if (aItem.IsSelected() && aItem.HasFlag(SELECTED_BY_DRAG)) {
      aItem.ClearSelected();
      super.stageItem(aItem, aChangeType, aScreen, RECURSE_MODE.NO_RECURSE);
      aItem.SetSelected();
    } else {
      super.stageItem(aItem, aChangeType, aScreen, RECURSE_MODE.NO_RECURSE);
    }

    return this;
  }

  private pushLibEdit(aMessage: string, aCommitFlags: number): void {
    // Symbol editor just saves copies of the whole symbol, so grab the first and discard the rest
    const first = this.m_entries[0]!;
    const symbol = first.m_item instanceof LIB_SYMBOL ? first.m_item : null;
    let copy = first.m_copy instanceof LIB_SYMBOL ? first.m_copy : null;

    if (symbol) {
      const view = this.m_toolMgr.GetView();

      if (view) {
        view.Update(symbol);

        symbol.RunOnChildren((aChild: SCH_ITEM) => {
          view.Update(aChild);
        }, RECURSE_MODE.NO_RECURSE);
      }

      const frame = this.symbolFrame();

      if (frame) {
        if (!(aCommitFlags & SKIP_UNDO)) {
          if (copy) {
            frame.PushSymbolToUndoList(aMessage, copy);
            copy = null; // we've transferred ownership to the undo stack
          }
        }
      }
    }

    this.m_toolMgr.PostEvent(
      new TOOL_EVENT(
        TOOL_EVENT_CATEGORY.TC_MESSAGE,
        TOOL_ACTIONS.TA_MODEL_CHANGE,
        TOOL_ACTION_SCOPE.AS_GLOBAL,
      ),
    );
    this.m_toolMgr.ProcessEvent(EVENTS.SelectedItemsModified);
  }

  private pushSchEdit(aMessage: string, aCommitFlags: number): void {
    // Objects potentially interested in changes:
    const undoList = new PICKED_ITEMS_LIST();
    const view = this.m_toolMgr.GetView();

    const frame = this.schFrame();
    const currentScreen = frame ? frame.GetScreen() : null;
    const selTool = this.selTool();
    const enteredGroup = selTool ? selTool.GetEnteredGroup() : null;
    let itemsDeselected = false;
    let selectedModified = false;
    let dirtyConnectivity = false;
    let refreshHierarchy = false;
    let connectivityCleanUp = SCH_CLEANUP_FLAGS.NO_CLEANUP;

    if (this.Empty()) return;

    undoList.SetDescription(aMessage);

    let schematic: SCHEMATIC | null = null;
    const bulkAddedItems: SCH_ITEM[] = [];
    const bulkRemovedItems: SCH_ITEM[] = [];
    const itemsChanged: SCH_ITEM[] = [];

    const updateConnectivityFlag = (schItem: SCH_ITEM): void => {
      if (schItem.IsConnectable() || schItem.Type() === KICAD_T.SCH_RULE_AREA_T) {
        dirtyConnectivity = true;

        // Do a local clean up if there are any connectable objects in the commit.
        if (connectivityCleanUp === SCH_CLEANUP_FLAGS.NO_CLEANUP)
          connectivityCleanUp = SCH_CLEANUP_FLAGS.LOCAL_CLEANUP;

        // Do a full rebuild of the connectivity if there is a sheet in the commit.
        if (schItem.Type() === KICAD_T.SCH_SHEET_T)
          connectivityCleanUp = SCH_CLEANUP_FLAGS.GLOBAL_CLEANUP;
      }
    };

    // We don't know that anything will be added to the entered group, but it does no harm to
    // add it to the commit anyway.
    if (enteredGroup) this.Modify(enteredGroup, frame!.GetScreen());

    // Handle wires with Hop Over shapes:
    for (const entry of this.m_entries) {
      const schCopyItem = asSchItem(entry.m_copy);
      const schItem = asSchItem(entry.m_item);

      if (schCopyItem && schCopyItem.Type() === KICAD_T.SCH_LINE_T)
        frame?.UpdateHopOveredWires(schCopyItem);

      if (schItem && schItem.Type() === KICAD_T.SCH_LINE_T) frame?.UpdateHopOveredWires(schItem);
    }

    // Modify() appends to m_entries, so collect first and stage after the loop.
    const removedItemGroups: [EDA_ITEM, BASE_SCREEN_LIKE | null][] = [];

    for (const entry of this.m_entries) {
      const schItem = asSchItem(entry.m_item);
      const changeType = entry.m_type & CHANGE_TYPE.CHT_TYPE;

      if (!schItem) continue; // wxCHECK2

      const group = schItem.GetParentGroup();

      if (changeType === CHANGE_TYPE.CHT_REMOVE && group)
        removedItemGroups.push([group.AsEdaItem(), entry.m_screen]);
    }

    for (const [group, screen] of removedItemGroups) this.Modify(group, screen);

    for (const entry of this.m_entries) {
      const changeType = entry.m_type & CHANGE_TYPE.CHT_TYPE;
      const changeFlags = entry.m_type & CHANGE_TYPE.CHT_FLAGS;
      const schItem = asSchItem(entry.m_item);
      const screen = entry.m_screen as SCH_SCREEN | null;

      if (!schItem) continue; // wxCHECK2
      if (!screen) continue; // wxCHECK2

      if (!schematic) schematic = schItem.Schematic();

      if (schItem.IsSelected()) {
        selectedModified = true;
      } else {
        schItem.RunOnChildren((aChild: SCH_ITEM) => {
          if (aChild.IsSelected()) selectedModified = true;
        }, RECURSE_MODE.NO_RECURSE);
      }

      switch (changeType) {
        case CHANGE_TYPE.CHT_ADD: {
          if (enteredGroup && schItem.IsGroupableType() && !schItem.GetParentGroup())
            selTool!.GetEnteredGroup()!.AddItem(schItem);

          updateConnectivityFlag(schItem);

          if (!(aCommitFlags & SKIP_UNDO))
            undoList.PushItem(new ITEM_PICKER(screen, schItem, UNDO_REDO.NEWITEM));

          if (!(changeFlags & CHANGE_TYPE.CHT_DONE)) {
            if (!screen.CheckIfOnDrawList(schItem))
              // don't want a loop!
              screen.Append(schItem);

            if (view && screen === currentScreen) view.Add(schItem);
          }

          if (frame && screen === currentScreen) frame.UpdateItem(schItem, true, true);
          else screen.Update(schItem);

          bulkAddedItems.push(schItem);

          if (schItem.Type() === KICAD_T.SCH_SHEET_T) refreshHierarchy = true;

          break;
        }

        case CHANGE_TYPE.CHT_REMOVE: {
          updateConnectivityFlag(schItem);

          if (!(aCommitFlags & SKIP_UNDO)) {
            const itemWrapper = new ITEM_PICKER(screen, schItem, UNDO_REDO.DELETED);
            itemWrapper.SetLink(entry.m_copy);
            entry.m_copy = null; // We've transferred ownership to the undo list
            undoList.PushItem(itemWrapper);
          }

          if (schItem.IsSelected()) {
            if (selTool) selTool.RemoveItemFromSel(schItem, true /* quiet mode */);

            itemsDeselected = true;
          }

          if (schItem.Type() === KICAD_T.SCH_FIELD_T) {
            (schItem as SCH_FIELD).SetVisible(false);
            break;
          }

          const group = schItem.GetParentGroup();

          if (group) group.RemoveItem(schItem);

          if (!(changeFlags & CHANGE_TYPE.CHT_DONE)) {
            screen.Remove(schItem);

            if (view && screen === currentScreen) view.Remove(schItem);
          }

          if (frame && screen === currentScreen) frame.UpdateItem(schItem, true, true);
          else screen.Update(schItem);

          if (schItem.Type() === KICAD_T.SCH_SHEET_T) refreshHierarchy = true;

          bulkRemovedItems.push(schItem);
          break;
        }

        case CHANGE_TYPE.CHT_MODIFY: {
          const itemCopy = entry.m_copy as SCH_ITEM;
          const currentSheet = frame ? frame.GetCurrentSheet() : null;

          if (
            itemCopy.HasConnectivityChanges(schItem, currentSheet) ||
            itemCopy.Type() === KICAD_T.SCH_RULE_AREA_T
          ) {
            updateConnectivityFlag(schItem);
          }

          if (schItem.Type() === KICAD_T.SCH_SYMBOL_T) {
            const origSymbol = itemCopy as SCH_SYMBOL;
            const modSymbol = schItem as SCH_SYMBOL;

            if (origSymbol.GetPins().length !== modSymbol.GetPins().length)
              connectivityCleanUp = SCH_CLEANUP_FLAGS.GLOBAL_CLEANUP;
          }

          if (!(aCommitFlags & SKIP_UNDO)) {
            const itemWrapper = new ITEM_PICKER(screen, schItem, UNDO_REDO.CHANGED);
            itemWrapper.SetLink(entry.m_copy);
            entry.m_copy = null; // We've transferred ownership to the undo list
            undoList.PushItem(itemWrapper);
          }

          if (schItem.Type() === KICAD_T.SCH_SHEET_T) {
            const modifiedSheet = schItem as SCH_SHEET;
            const originalSheet = itemCopy as SCH_SHEET;

            if (originalSheet.HasPageNumberChanges(modifiedSheet)) refreshHierarchy = true;
          }

          if (frame && screen === currentScreen) frame.UpdateItem(schItem, false, true);
          else screen.Update(schItem);

          itemsChanged.push(schItem);
          break;
        }

        default:
          console.assert(false);
          break;
      }

      // Delete any copies we still have ownership of
      entry.m_copy = null;

      // Clear all flags but SELECTED and others used to move and rotate commands,
      // after edition (selected items must keep their selection flag).
      const selected_mask = SELECTED | STARTPOINT | ENDPOINT;
      schItem.ClearFlags(EDA_ITEM_ALL_FLAGS - selected_mask);

      if (schItem.Type() === KICAD_T.SCH_SHEET_T || schItem.Type() === KICAD_T.SCH_SYMBOL_T) {
        schItem.RunOnChildren((child: SCH_ITEM) => {
          child.ClearFlags(EDA_ITEM_ALL_FLAGS - selected_mask);
        }, RECURSE_MODE.NO_RECURSE);
      }
    }

    if (schematic) {
      if (bulkAddedItems.length > 0) schematic.OnItemsAdded(bulkAddedItems);

      if (bulkRemovedItems.length > 0) schematic.OnItemsRemoved(bulkRemovedItems);

      if (itemsChanged.length > 0) schematic.OnItemsChanged(itemsChanged);

      if (refreshHierarchy) {
        schematic.RefreshHierarchy();

        if (frame) frame.UpdateHierarchyNavigator();
      }
    }

    if (!(aCommitFlags & SKIP_UNDO)) {
      if (frame) {
        if (undoList.GetCount() > 0)
          frame.SaveCopyInUndoList(undoList, UNDO_REDO.UNSPECIFIED, false);

        if (dirtyConnectivity) frame.RecalculateConnections(this, connectivityCleanUp);
      }
    }

    this.m_toolMgr.PostEvent(
      new TOOL_EVENT(
        TOOL_EVENT_CATEGORY.TC_MESSAGE,
        TOOL_ACTIONS.TA_MODEL_CHANGE,
        TOOL_ACTION_SCOPE.AS_GLOBAL,
      ),
    );

    if (itemsDeselected) this.m_toolMgr.PostEvent(EVENTS.UnselectedEvent);

    if (selectedModified) this.m_toolMgr.ProcessEvent(EVENTS.SelectedItemsModified);
  }

  override Push(aMessage = 'A commit', aCommitFlags = 0): void {
    if (this.Empty()) return;

    if (this.m_isLibEditor) this.pushLibEdit(aMessage, aCommitFlags);
    else this.pushSchEdit(aMessage, aCommitFlags);

    const frame = this.m_toolMgr.GetToolHolder() as unknown as {
      OnModify?(): void;
      GetCanvas?(): { Refresh(): void } | null;
    } | null;

    if (frame) {
      if (!(aCommitFlags & SKIP_SET_DIRTY)) frame.OnModify?.();

      frame.GetCanvas?.()?.Refresh();
    }

    this.clear();
  }

  protected override undoLevelItem(aItem: EDA_ITEM): EDA_ITEM {
    const parent = aItem.GetParent();

    if (this.m_isLibEditor) return this.symbolFrame()!.GetCurSymbol()!;

    if (
      parent?.IsType([
        KICAD_T.SCH_SYMBOL_T,
        KICAD_T.SCH_TABLE_T,
        KICAD_T.SCH_SHEET_T,
        KICAD_T.SCH_LABEL_LOCATE_ANY_T,
      ])
    )
      return parent;

    return aItem;
  }

  protected override makeImage(aItem: EDA_ITEM): EDA_ITEM {
    if (this.m_isLibEditor) {
      const frame = this.symbolFrame()!;
      let symbol = frame.GetCurSymbol()!;
      const selected: string[] = [];

      // Cloning will clear the selected flags, but we want to keep them.
      for (const item of symbol.GetDrawItems()) {
        if (item.IsSelected()) selected.push(item.m_Uuid);
      }

      symbol = LIB_SYMBOL.copyOf(symbol);

      // Restore selected flags.
      for (const item of symbol.GetDrawItems()) {
        if (selected.includes(item.m_Uuid)) item.SetSelected();
      }

      return symbol;
    }

    return aItem.Clone();
  }

  private revertLibEdit(): void {
    if (this.Empty()) return;

    // Symbol editor just saves copies of the whole symbol, so grab the first and discard the rest
    const frame = this.symbolFrame();
    const first = this.m_entries[0]!;
    const copy = first.m_copy instanceof LIB_SYMBOL ? first.m_copy : null;
    const selTool = this.selTool();

    if (frame && copy) {
      frame.SetCurSymbol(copy, false);
      this.m_toolMgr.ResetTools(RESET_REASON.MODEL_RELOAD);
    }

    if (selTool) selTool.RebuildSelection();

    this.clear();
  }

  override Revert(): void {
    const view = this.m_toolMgr.GetView();
    const frame = this.schFrame();
    const selTool = this.selTool();
    let sheets = new SCH_SHEET_LIST();

    if (this.m_entries.length === 0) return;

    if (this.m_isLibEditor) {
      this.revertLibEdit();
      return;
    }

    let schematic: SCHEMATIC | null = null;
    const bulkAddedItems: SCH_ITEM[] = [];
    const bulkRemovedItems: SCH_ITEM[] = [];
    const itemsChanged: SCH_ITEM[] = [];

    for (const ent of this.m_entries) {
      const changeType = ent.m_type & CHANGE_TYPE.CHT_TYPE;
      const changeFlags = ent.m_type & CHANGE_TYPE.CHT_FLAGS;
      const item = asSchItem(ent.m_item);
      const copy = asSchItem(ent.m_copy);
      const screen = ent.m_screen as SCH_SCREEN | null;

      if (!item || !screen) continue; // wxCHECK2

      if (!schematic) schematic = item.Schematic();

      switch (changeType) {
        case CHANGE_TYPE.CHT_ADD:
          if (!(changeFlags & CHANGE_TYPE.CHT_DONE)) break;

          if (view) view.Remove(item);

          screen.Remove(item);
          bulkRemovedItems.push(item);
          break;

        case CHANGE_TYPE.CHT_REMOVE:
          item.SetConnectivityDirty();

          if (!(changeFlags & CHANGE_TYPE.CHT_DONE)) break;

          if (view) view.Add(item);

          screen.Append(item);
          bulkAddedItems.push(item);
          break;

        case CHANGE_TYPE.CHT_MODIFY: {
          if (!copy) break; // wxCHECK2

          if (view) view.Remove(item);

          const unselect = !item.IsSelected();

          item.SwapItemData(copy);

          if (unselect) {
            item.ClearSelected();
            item.RunOnChildren((aChild: SCH_ITEM) => {
              aChild.ClearSelected();
            }, RECURSE_MODE.NO_RECURSE);
          }

          // Special cases for items which have instance data
          if (
            item.GetParent() &&
            item.GetParent()!.Type() === KICAD_T.SCH_SYMBOL_T &&
            item.Type() === KICAD_T.SCH_FIELD_T
          ) {
            const field = item as SCH_FIELD;
            const symbol = item.GetParent() as SCH_SYMBOL;

            if (field.GetId() === FIELD_T.REFERENCE) {
              // Lazy eval of sheet list; this is expensive even when unsorted
              if (sheets.length === 0) sheets = schematic!.Hierarchy();

              const sheet = sheets.FindSheetForScreen(screen);
              symbol.SetRef(sheet, field.GetText());
            }
          }

          // This must be called before any calls that require stable object pointers.
          screen.Update(item);

          // This hack is to prevent incorrectly parented symbol pins from breaking the
          // connectivity algorithm.
          if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
            const symbol = item as SCH_SYMBOL;
            symbol.UpdatePins();

            const graph = schematic!.ConnectionGraph();

            const symbolCopy = copy as SCH_SYMBOL;
            graph.RemoveItem(symbolCopy);

            for (const pin of symbolCopy.GetPins()) graph.RemoveItem(pin);
          }

          item.SetConnectivityDirty();

          if (view) view.Add(item);

          break;
        }

        default:
          console.assert(false);
          break;
      }
    }

    if (schematic) {
      if (bulkAddedItems.length > 0) schematic.OnItemsAdded(bulkAddedItems);

      if (bulkRemovedItems.length > 0) schematic.OnItemsRemoved(bulkRemovedItems);

      if (itemsChanged.length > 0) schematic.OnItemsChanged(itemsChanged);
    }

    if (selTool) selTool.RebuildSelection();

    if (frame) frame.RecalculateConnections(null, SCH_CLEANUP_FLAGS.NO_CLEANUP);

    this.clear();
  }
}
