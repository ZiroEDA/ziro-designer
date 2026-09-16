// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOARD_COMMIT` (pcbnew/board_commit.h, board_commit.cpp): the one way a
 * board is edited. Every tool stages its adds, removes and modifies on a
 * commit; `Push` applies them to the BOARD, the connectivity, the teardrops,
 * the view and the selection, and files one undo entry; `Revert` puts the
 * staged items back.
 *
 * Three collaborators are later stages': KIGFX::PCB_VIEW (5), reached
 * through the tool manager's view when there is one, as in the C++ QA tests
 * where there is none; PCB_SELECTION_TOOL and ZONE_FILLER_TOOL (3), looked
 * up by their tool names, absent until registered — the C++ guards the
 * selection tool the same way in Push. PCBNEW_SETTINGS comes from the frame.
 */
import { CHANGE_TYPE, COMMIT, type COMMIT_LINE } from '@ziroeda/common/src/commit.js';
import type { EDA_ITEM } from '@ziroeda/common/src/eda_item.js';
import { RECURSE_MODE } from '@ziroeda/common/src/eda_item.js';
import { STRUCT_DELETED, UR_TRANSIENT } from '@ziroeda/common/src/eda_item_flags.js';
import { FRAME_T } from '@ziroeda/common/src/frame_type.js';
import { PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import {
  EVENTS,
  TOOL_ACTIONS,
  TOOL_EVENT,
  TOOL_EVENT_CATEGORY,
} from '@ziroeda/common/src/tool/tool_event.js';
import { TOOL_ACTION_SCOPE } from '@ziroeda/common/src/tool/tool_action.js';
import type { TOOL_BASE } from '@ziroeda/common/src/tool/tool_base.js';
import type { TOOL_MANAGER } from '@ziroeda/common/src/tool/tool_manager.js';
import {
  ITEM_PICKER,
  PICKED_ITEMS_LIST,
  UNDO_REDO,
} from '@ziroeda/common/src/undo_redo_container.js';
import type { BASE_SCREEN_LIKE } from '@ziroeda/common/src/undo_redo_container.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { BOARD } from './board.js';
import type { BOARD_ITEM } from './board_item.js';
import { ADD_MODE, REMOVE_MODE } from './board_item_container.js';
import type { FOOTPRINT } from './footprint.js';
import type { PAD } from './pad.js';
import { PCB_BASE_FRAME } from './pcb_base_frame.js';
import {
  PCB_BASE_EDIT_FRAME,
  PCB_SELECTION_TOOL_NAME,
  type PCB_VIEW_LIKE,
} from './pcb_base_edit_frame.js';
import type { PCB_FIELD } from './pcb_field.js';
import type { PCB_GROUP } from './pcb_group.js';
import type { PCB_TRACK, PCB_VIA } from './pcb_track.js';
import { SHOW_WITH_VIA_ALWAYS } from './pcbnew_settings.js';
import { TEARDROP_MANAGER } from './teardrop/teardrop.js';
import { PCB_ACTIONS } from './tools/pcb_actions.js';
import type { ZONE } from './zone.js';

export const SKIP_UNDO = 0x0001;
export const APPEND_UNDO = 0x0002;
export const SKIP_SET_DIRTY = 0x0004;
export const SKIP_CONNECTIVITY = 0x0008;
export const ZONE_FILL_OP = 0x0010;
export const SKIP_TEARDROPS = 0x0020;
export const SKIP_ENTERED_GROUP = 0x0040;

/** `PCB_SELECTION_TOOL` as the commit uses it; the class is stage 3's. */
export interface PCB_SELECTION_TOOL_FOR_COMMIT {
  GetEnteredGroup(): PCB_GROUP | null;
  RemoveItemFromSel(aItem: BOARD_ITEM, aQuietMode?: boolean): void;
  GetSelection(): { GetItems(): EDA_ITEM[] };
  RebuildSelection(): void;
}

/** `ZONE_FILLER_TOOL` as the commit uses it; the class is stage 3's. */
export const ZONE_FILLER_TOOL_NAME = 'pcbnew.ZoneFiller';

export interface ZONE_FILLER_TOOL_FOR_COMMIT {
  DirtyZone(aZone: ZONE): void;
}

/** `PCB_TOOL_BASE::IsBoardEditor/IsFootprintEditor`, as a TOOL_BASE may carry them. */
interface PCB_TOOL_BASE_LIKE {
  IsBoardEditor(): boolean;
  IsFootprintEditor(): boolean;
}

function isPcbToolBase(aTool: TOOL_BASE): aTool is TOOL_BASE & PCB_TOOL_BASE_LIKE {
  return (
    typeof (aTool as unknown as PCB_TOOL_BASE_LIKE).IsBoardEditor === 'function' &&
    typeof (aTool as unknown as PCB_TOOL_BASE_LIKE).IsFootprintEditor === 'function'
  );
}

export class BOARD_COMMIT extends COMMIT {
  private m_toolMgr: TOOL_MANAGER;
  private m_isBoardEditor: boolean;
  private m_isFootprintEditor: boolean;

  constructor(aTool: TOOL_BASE);
  constructor(aFrame: PCB_BASE_FRAME);
  constructor(aMgr: TOOL_MANAGER);
  constructor(aMgr: TOOL_MANAGER, aIsBoardEditor: boolean, aIsFootprintEditor: boolean);
  constructor(
    a: TOOL_BASE | PCB_BASE_FRAME | TOOL_MANAGER,
    aIsBoardEditor?: boolean,
    aIsFootprintEditor?: boolean,
  ) {
    super();

    if (a instanceof PCB_BASE_FRAME) {
      this.m_toolMgr = a.GetToolManager()!;
      this.m_isBoardEditor = a.IsType(FRAME_T.FRAME_PCB_EDITOR);
      this.m_isFootprintEditor = a.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR);
      return;
    }

    if ('GetManager' in a && typeof (a as TOOL_BASE).GetManager === 'function') {
      const tool = a as TOOL_BASE;
      this.m_toolMgr = tool.GetManager()!;
      this.m_isBoardEditor = false;
      this.m_isFootprintEditor = false;

      if (isPcbToolBase(tool)) {
        this.m_isBoardEditor = tool.IsBoardEditor();
        this.m_isFootprintEditor = tool.IsFootprintEditor();
      }

      return;
    }

    const mgr = a as TOOL_MANAGER;
    this.m_toolMgr = mgr;

    if (aIsBoardEditor !== undefined) {
      this.m_isBoardEditor = aIsBoardEditor;
      this.m_isFootprintEditor = aIsFootprintEditor!;
      return;
    }

    this.m_isBoardEditor = false;
    this.m_isFootprintEditor = false;

    const holder = mgr.GetToolHolder();
    const frame = holder instanceof PCB_BASE_FRAME ? holder : null;

    if (frame?.IsType(FRAME_T.FRAME_PCB_EDITOR)) this.m_isBoardEditor = true;
    else if (frame?.IsType(FRAME_T.FRAME_FOOTPRINT_EDITOR)) this.m_isFootprintEditor = true;
  }

  GetBoard(): BOARD {
    return this.m_toolMgr.GetModel() as unknown as BOARD;
  }

  private view(): PCB_VIEW_LIKE | null {
    return (this.m_toolMgr.GetView() as PCB_VIEW_LIKE | null) ?? null;
  }

  private frame(): PCB_BASE_FRAME | null {
    const holder = this.m_toolMgr.GetToolHolder();
    return holder instanceof PCB_BASE_FRAME ? holder : null;
  }

  private selTool(): PCB_SELECTION_TOOL_FOR_COMMIT | null {
    return this.m_toolMgr.FindTool(
      PCB_SELECTION_TOOL_NAME,
    ) as unknown as PCB_SELECTION_TOOL_FOR_COMMIT | null;
  }

  protected override stageItem(
    aItem: EDA_ITEM,
    aChangeType: number,
    aScreen: BASE_SCREEN_LIKE | null,
    aRecurse: RECURSE_MODE,
  ): COMMIT {
    if (aRecurse === RECURSE_MODE.RECURSE) {
      if (aItem.Type() === KICAD_T.PCB_GROUP_T) {
        const group = aItem as PCB_GROUP;

        for (const member of group.GetItems()) this.Stage(member, aChangeType, aScreen, aRecurse);
      }
    }

    if (
      this.m_isBoardEditor &&
      (aChangeType & CHANGE_TYPE.CHT_TYPE) === CHANGE_TYPE.CHT_REMOVE &&
      aItem.IsBOARD_ITEM() &&
      (aItem as BOARD_ITEM).GetParentFootprint()
    ) {
      if (!this.m_deletedItems.has(aItem, aScreen))
        this.makeEntry(aItem, aChangeType, this.makeImage(aItem), aScreen);

      return this;
    }

    return super.stageItem(aItem, aChangeType, null, RECURSE_MODE.NO_RECURSE);
  }

  private propagateDamage(
    aChangedItem: BOARD_ITEM,
    aStaleZones: ZONE[] | null,
    aStaleRuleAreas: BOX2I[],
  ): void {
    if (!aChangedItem) {
      console.assert(false);
      return;
    }

    if (aStaleZones && aChangedItem.Type() === KICAD_T.PCB_ZONE_T)
      aStaleZones.push(aChangedItem as ZONE);

    aChangedItem.RunOnChildren(
      (child) => this.propagateDamage(child, aStaleZones, aStaleRuleAreas),
      RECURSE_MODE.NO_RECURSE,
    );

    const board = this.m_toolMgr.GetModel() as unknown as BOARD;
    const damageBBox = aChangedItem.GetBoundingBox();
    let damageLayers = aChangedItem.GetLayerSet();

    if (this.m_isBoardEditor && aChangedItem.Type() === KICAD_T.PCB_ZONE_T) {
      // A named zone can have custom DRC rules targetting it.
      if ((aChangedItem as ZONE).GetZoneName() !== '') aStaleRuleAreas.push(damageBBox);
    }

    if (aStaleZones) {
      if (damageLayers.test(PCB_LAYER_ID.Edge_Cuts) || damageLayers.test(PCB_LAYER_ID.Margin))
        damageLayers = LSET.PhysicalLayersMask();
      else damageLayers = damageLayers.and(LSET.AllCuMask());

      if (damageLayers.any()) {
        for (const zone of board.Zones()) {
          if (zone.GetIsRuleArea()) continue;

          if (
            zone.GetLayerSet().and(damageLayers).any() &&
            zone.GetBoundingBox().Intersects(damageBBox)
          )
            aStaleZones.push(zone);
        }
      }
    }
  }

  override Push(aMessage = '', aCommitFlags = 0): void {
    const view = this.view();
    const board = this.m_toolMgr.GetModel() as unknown as BOARD;
    const frame = this.frame();
    const selTool = this.selTool();
    const enteredGroup =
      selTool && !(aCommitFlags & SKIP_ENTERED_GROUP) ? selTool.GetEnteredGroup() : null;

    // Notification info
    const undoList = new PICKED_ITEMS_LIST();
    let itemsDeselected = false;
    let selectedModified = false;

    const removedItems = new Set<EDA_ITEM>();

    // Dirty flags and lists
    let solderMaskDirty = false;
    let autofillZones = false;
    let updateBoardBoundingBox = false;
    const staleTeardropPadsAndVias: BOARD_ITEM[] = [];
    const staleTeardropTracks = new Set<PCB_TRACK>();
    const staleZonesStorage: ZONE[] = [];
    let staleZones: ZONE[] | null = null;
    const staleRuleAreas: BOX2I[] = [];

    if (this.Empty()) return;

    undoList.SetDescription(aMessage);

    const teardropMgr = new TEARDROP_MANAGER(board, this.m_toolMgr);
    const connectivity = board.GetConnectivity();

    // Note: frame == nullptr happens in QA tests

    const bulkAddedItems: BOARD_ITEM[] = [];
    const bulkRemovedItems: BOARD_ITEM[] = [];
    const itemsChanged: BOARD_ITEM[] = [];

    if (
      this.m_isBoardEditor &&
      !(aCommitFlags & ZONE_FILL_OP) &&
      frame &&
      frame.GetPcbNewSettings().m_AutoRefillZones
    ) {
      autofillZones = true;
      staleZones = staleZonesStorage;

      for (const zone of board.Zones()) zone.CacheBoundingBox();
    }

    for (const entry of this.m_entries) {
      if (!entry.m_item || !entry.m_item.IsBOARD_ITEM()) continue;

      const boardItem = entry.m_item as BOARD_ITEM;

      if (this.m_isBoardEditor) {
        if (
          boardItem.Type() === KICAD_T.PCB_VIA_T ||
          boardItem.Type() === KICAD_T.PCB_FOOTPRINT_T ||
          boardItem.IsOnLayer(PCB_LAYER_ID.F_Mask) ||
          boardItem.IsOnLayer(PCB_LAYER_ID.B_Mask)
        ) {
          solderMaskDirty = true;
        }

        if (boardItem.GetLayer() === PCB_LAYER_ID.Edge_Cuts) {
          updateBoardBoundingBox = true;
        }

        if (!(aCommitFlags & SKIP_TEARDROPS)) {
          if (boardItem.Type() === KICAD_T.PCB_FOOTPRINT_T) {
            for (const pad of (boardItem as FOOTPRINT).Pads()) staleTeardropPadsAndVias.push(pad);
          } else if (
            boardItem.Type() === KICAD_T.PCB_PAD_T ||
            boardItem.Type() === KICAD_T.PCB_VIA_T
          ) {
            staleTeardropPadsAndVias.push(boardItem);
          } else if (
            boardItem.Type() === KICAD_T.PCB_TRACE_T ||
            boardItem.Type() === KICAD_T.PCB_ARC_T
          ) {
            const track = boardItem as PCB_TRACK;

            staleTeardropTracks.add(track);

            const connectedPads: PAD[] = [];
            const connectedVias: PCB_VIA[] = [];

            connectivity.GetConnectedPadsAndVias(track, connectedPads, connectedVias);

            for (const pad of connectedPads) staleTeardropPadsAndVias.push(pad);

            for (const via of connectedVias) staleTeardropPadsAndVias.push(via);
          }
        }
      }

      if (
        boardItem.IsSelected() ||
        (this.m_isFootprintEditor && boardItem === board.GetFirstFootprint())
      )
        selectedModified = true;
    }

    // Old teardrops must be removed before connectivity is rebuilt
    if (staleTeardropPadsAndVias.length > 0 || staleTeardropTracks.size > 0)
      teardropMgr.RemoveTeardrops(this, staleTeardropPadsAndVias, staleTeardropTracks);

    const updateComponentClasses = (boardItem: BOARD_ITEM): void => {
      if (boardItem.Type() !== KICAD_T.PCB_FOOTPRINT_T) return;

      const footprint = boardItem as FOOTPRINT;
      this.GetBoard().GetComponentClassManager().RebuildRequiredCaches(footprint);
    };

    // We don't know that anything will be added to the entered group, but it does no harm to
    // add it to the commit anyway.
    if (enteredGroup) this.Modify(enteredGroup);

    // The entered group's Modify may have appended an entry; the C++ range-for over a
    // std::vector sees it, and so does this index loop.
    for (let idx = 0; idx < this.m_entries.length; idx++) {
      const entry: COMMIT_LINE = this.m_entries[idx]!;

      if (!entry.m_item || !entry.m_item.IsBOARD_ITEM()) continue;

      const boardItem = entry.m_item as BOARD_ITEM;
      const changeType = entry.m_type & CHANGE_TYPE.CHT_TYPE;
      const changeFlags = entry.m_type & CHANGE_TYPE.CHT_FLAGS;

      switch (changeType) {
        case CHANGE_TYPE.CHT_ADD:
          if (enteredGroup && boardItem.IsGroupableType() && !boardItem.GetParentGroup())
            enteredGroup.AddItem(boardItem);

          if (!(aCommitFlags & SKIP_UNDO))
            undoList.PushItem(new ITEM_PICKER(null, boardItem, UNDO_REDO.NEWITEM));

          if (!(changeFlags & CHANGE_TYPE.CHT_DONE)) {
            if (this.m_isFootprintEditor) {
              const parentFP = board.GetFirstFootprint();
              if (parentFP) parentFP.Add(boardItem);
            } else {
              board.Add(boardItem, ADD_MODE.BULK_INSERT); // handles connectivity
              bulkAddedItems.push(boardItem);
            }
          }

          if (boardItem.Type() !== KICAD_T.PCB_MARKER_T)
            this.propagateDamage(boardItem, staleZones, staleRuleAreas);

          if (view && boardItem.Type() !== KICAD_T.PCB_NETINFO_T) view.Add(boardItem);

          updateComponentClasses(boardItem);

          break;

        case CHANGE_TYPE.CHT_REMOVE: {
          const parentGroup = boardItem.GetParentGroup();

          if (!(aCommitFlags & SKIP_UNDO)) {
            const status =
              boardItem.Type() === KICAD_T.PCB_FIELD_T ? UNDO_REDO.CHANGED : UNDO_REDO.DELETED;
            const itemWrapper = new ITEM_PICKER(null, boardItem, status);
            itemWrapper.SetLink(entry.m_copy);
            entry.m_copy = null; // We've transferred ownership to the undo list
            undoList.PushItem(itemWrapper);
          }

          if (boardItem.IsSelected()) {
            if (selTool) selTool.RemoveItemFromSel(boardItem, true /* quiet mode */);

            itemsDeselected = true;
          }

          removedItems.add(boardItem);

          if (parentGroup && !(parentGroup.AsEdaItem().GetFlags() & STRUCT_DELETED))
            parentGroup.RemoveItem(boardItem);

          if (boardItem.Type() !== KICAD_T.PCB_MARKER_T)
            this.propagateDamage(boardItem, staleZones, staleRuleAreas);

          switch (boardItem.Type()) {
            case KICAD_T.PCB_FIELD_T:
              (boardItem as PCB_FIELD).SetVisible(false);

              if (view) view.Update(boardItem);

              break;

            case KICAD_T.PCB_TEXT_T:
            case KICAD_T.PCB_PAD_T:
            case KICAD_T.PCB_SHAPE_T:
            case KICAD_T.PCB_REFERENCE_IMAGE_T:
            case KICAD_T.PCB_GENERATOR_T:
            case KICAD_T.PCB_TEXTBOX_T:
            case KICAD_T.PCB_BARCODE_T:
            case KICAD_T.PCB_TABLE_T:
            case KICAD_T.PCB_TRACE_T:
            case KICAD_T.PCB_ARC_T:
            case KICAD_T.PCB_VIA_T:
            case KICAD_T.PCB_DIM_ALIGNED_T:
            case KICAD_T.PCB_DIM_CENTER_T:
            case KICAD_T.PCB_DIM_RADIAL_T:
            case KICAD_T.PCB_DIM_ORTHOGONAL_T:
            case KICAD_T.PCB_DIM_LEADER_T:
            case KICAD_T.PCB_TARGET_T:
            case KICAD_T.PCB_MARKER_T:
            case KICAD_T.PCB_POINT_T:
            case KICAD_T.PCB_ZONE_T:
            case KICAD_T.PCB_FOOTPRINT_T:
            case KICAD_T.PCB_GROUP_T:
              if (view) view.Remove(boardItem);

              if (!(changeFlags & CHANGE_TYPE.CHT_DONE)) {
                if (this.m_isFootprintEditor) {
                  const parentFP = board.GetFirstFootprint();
                  if (parentFP) parentFP.Remove(boardItem);
                } else {
                  const parentFP = boardItem.GetParentFootprint();

                  if (parentFP) {
                    parentFP.Remove(boardItem);
                  } else {
                    board.Remove(boardItem, REMOVE_MODE.BULK);
                    bulkRemovedItems.push(boardItem);
                  }
                }
              }

              break;

            // Metadata items
            case KICAD_T.PCB_NETINFO_T:
              board.Remove(boardItem, REMOVE_MODE.BULK);
              bulkRemovedItems.push(boardItem);
              break;

            default: // other types do not need to (or should not) be handled
              console.assert(false);
              break;
          }

          // Removed items are owned by undo/redo, but a hidden field still belongs to its footprint
          if (boardItem.Type() !== KICAD_T.PCB_FIELD_T) boardItem.SetFlags(UR_TRANSIENT);

          break;
        }

        case CHANGE_TYPE.CHT_MODIFY: {
          const boardItemCopy = entry.m_copy as BOARD_ITEM;

          if (!(aCommitFlags & SKIP_UNDO)) {
            const itemWrapper = new ITEM_PICKER(null, boardItem, UNDO_REDO.CHANGED);
            itemWrapper.SetLink(entry.m_copy);
            entry.m_copy = null; // We've transferred ownership to the undo list
            undoList.PushItem(itemWrapper);
          }

          if (!(aCommitFlags & SKIP_CONNECTIVITY)) {
            connectivity.MarkItemNetAsDirty(boardItemCopy);
            connectivity.Update(boardItem);
          }

          if (boardItem.Type() !== KICAD_T.PCB_MARKER_T) {
            this.propagateDamage(boardItemCopy, staleZones, staleRuleAreas); // before
            this.propagateDamage(boardItem, staleZones, staleRuleAreas); // after
          }

          updateComponentClasses(boardItem);

          if (view && boardItem.Type() !== KICAD_T.PCB_NETINFO_T) view.Update(boardItem);

          itemsChanged.push(boardItem);
          break;
        }

        default:
          throw new Error(`UNIMPLEMENTED_FOR( ${boardItem.GetClass()} )`);
      }

      // Delete any copies we still have ownership of
      entry.m_copy = null;

      boardItem.ClearEditFlags();
      boardItem.RunOnChildren((item) => {
        item.ClearEditFlags();
      }, RECURSE_MODE.RECURSE);
    } // ... and regenerate them.

    // Deselection above keys off the SELECTED flag on the removed item itself, but the selection
    // may separately hold an owned descendant such as a pad, field or table cell.  Descendants
    // are freed along with the removed parent, so prune them here or the selection keeps a
    // dangling pointer that the next repaint dereferences.
    if (selTool && removedItems.size > 0) {
      for (const selectedItem of [...selTool.GetSelection().GetItems()]) {
        for (
          let ancestor: EDA_ITEM | null = selectedItem;
          ancestor;
          ancestor = ancestor.GetParent()
        ) {
          if (removedItems.has(ancestor)) {
            selTool.RemoveItemFromSel(selectedItem as BOARD_ITEM, true /* quiet mode */);
            itemsDeselected = true;
            break;
          }
        }
      }
    }

    // Invalidate component classes
    board.GetComponentClassManager().InvalidateComponentClasses();

    if (this.m_isBoardEditor) {
      const originalCount = this.m_entries.length;

      if (aCommitFlags & SKIP_CONNECTIVITY) {
        connectivity.ClearRatsnest();
        connectivity.ClearLocalRatsnest();
      } else {
        connectivity.RecalculateRatsnest(this);
        board.UpdateRatsnestExclusions();
        connectivity.ClearLocalRatsnest();

        // frame->GetCanvas()->RedrawRatsnest(): the canvas is stage 5's

        board.OnRatsnestChanged();
      }

      if (solderMaskDirty) {
        if (frame) frame.HideSolderMask();
      }

      if (updateBoardBoundingBox && view) {
        const outline = board.BoardOutline();

        if (outline) {
          board.UpdateBoardOutline();

          if (view.HasItem(outline)) view.Update(outline);
          else view.Add(outline);
        }
      }

      const cfg = frame ? frame.GetPcbNewSettings() : null;

      if (cfg) {
        if (
          staleRuleAreas.length > 0 &&
          (cfg.m_Display.m_TrackClearance === SHOW_WITH_VIA_ALWAYS || cfg.m_Display.m_PadClearance)
        ) {
          if (view)
            view.UpdateCollidingItems(staleRuleAreas, [
              KICAD_T.PCB_TRACE_T,
              KICAD_T.PCB_ARC_T,
              KICAD_T.PCB_VIA_T,
              KICAD_T.PCB_PAD_T,
            ]);
        }
      }

      if (staleTeardropPadsAndVias.length > 0 || staleTeardropTracks.size > 0) {
        teardropMgr.UpdateTeardrops(this, staleTeardropPadsAndVias, staleTeardropTracks);

        // UpdateTeardrops() can modify the ratsnest data. So rebuild this ratsnest data
        connectivity.RecalculateRatsnest(this);
      }

      // Log undo items for any connectivity or teardrop changes
      for (let i = originalCount; i < this.m_entries.length; ++i) {
        const entry = this.m_entries[i]!;
        let boardItem: BOARD_ITEM | null = null;
        let boardItemCopy: BOARD_ITEM | null = null;

        if (entry.m_item?.IsBOARD_ITEM()) boardItem = entry.m_item as BOARD_ITEM;

        if (entry.m_copy?.IsBOARD_ITEM()) boardItemCopy = entry.m_copy as BOARD_ITEM;

        if (!boardItem) {
          console.assert(false);
          continue;
        }

        if (!(aCommitFlags & SKIP_UNDO)) {
          const itemWrapper = new ITEM_PICKER(
            null,
            boardItem,
            this.convertToUndoRedo(entry.m_type & CHANGE_TYPE.CHT_TYPE),
          );
          itemWrapper.SetLink(boardItemCopy);
          undoList.PushItem(itemWrapper);
        } else {
          entry.m_copy = null;
        }

        if (view && boardItem.Type() !== KICAD_T.PCB_NETINFO_T) {
          if ((entry.m_type & CHANGE_TYPE.CHT_TYPE) === CHANGE_TYPE.CHT_ADD) view.Add(boardItem);
          else if ((entry.m_type & CHANGE_TYPE.CHT_TYPE) === CHANGE_TYPE.CHT_REMOVE)
            view.Remove(boardItem);
          else view.Update(boardItem);
        }
      }
    }

    if (bulkAddedItems.length > 0 || bulkRemovedItems.length > 0 || itemsChanged.length > 0)
      board.OnItemsCompositeUpdate(bulkAddedItems, bulkRemovedItems, itemsChanged);

    if (frame) {
      if (!(aCommitFlags & SKIP_UNDO)) {
        if (frame instanceof PCB_BASE_EDIT_FRAME) {
          if (aCommitFlags & APPEND_UNDO)
            frame.AppendCopyToUndoList(undoList, UNDO_REDO.UNSPECIFIED);
          else frame.SaveCopyInUndoList(undoList, UNDO_REDO.UNSPECIFIED);
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

    if (itemsDeselected) this.m_toolMgr.PostEvent(EVENTS.UnselectedEvent);

    if (autofillZones) {
      const zoneFillerTool = this.m_toolMgr.FindTool(
        ZONE_FILLER_TOOL_NAME,
      ) as unknown as ZONE_FILLER_TOOL_FOR_COMMIT | null;

      if (zoneFillerTool) {
        for (const zone of staleZones!) zoneFillerTool.DirtyZone(zone);
      }

      this.m_toolMgr.PostAction(PCB_ACTIONS.zoneFillDirty);
    }

    this.m_toolMgr.PostAction(PCB_ACTIONS.rehatchShapes);

    if (selectedModified) this.m_toolMgr.ProcessEvent(EVENTS.SelectedItemsModified);

    if (frame) {
      if (!(aCommitFlags & SKIP_SET_DIRTY)) frame.OnModify();
      else frame.Update3DView(true, frame.GetPcbNewSettings().m_Display.m_Live3DRefresh);

      // Ensure the message panel is updated after committing changes.
      // By default (i.e. if no event posted), display the updated board info
      if (!itemsDeselected && !autofillZones && !selectedModified) {
        frame.SetMsgPanel(board);
      }
    }

    this.clear();
  }

  protected override undoLevelItem(aItem: EDA_ITEM): EDA_ITEM {
    // Easiest way to disallow both a parent and one of its children appearing in the list
    // is to only ever add the parent when either can be legal (ie: in the board editor).
    if (this.m_isBoardEditor && aItem.IsBOARD_ITEM()) {
      const footprint = (aItem as BOARD_ITEM).GetParentFootprint();
      if (footprint) return footprint;
    }

    const parent = aItem.GetParent();

    if (parent && parent.Type() === KICAD_T.PCB_TABLE_T) return parent;

    return aItem;
  }

  protected override makeImage(aItem: EDA_ITEM): EDA_ITEM {
    return BOARD_COMMIT.MakeImage(aItem);
  }

  static MakeImage(aItem: EDA_ITEM): EDA_ITEM {
    const clone = aItem.Clone();
    clone.SetFlags(UR_TRANSIENT);

    return clone;
  }

  override Revert(): void {
    const view = this.view();
    const board = this.m_toolMgr.GetModel() as unknown as BOARD;
    const connectivity = board.GetConnectivity();

    board.IncrementTimeStamp(); // clear caches

    const updateComponentClasses = (boardItem: BOARD_ITEM): void => {
      if (boardItem.Type() !== KICAD_T.PCB_FOOTPRINT_T) return;

      const footprint = boardItem as FOOTPRINT;
      this.GetBoard().GetComponentClassManager().RebuildRequiredCaches(footprint);
    };

    const bulkAddedItems: BOARD_ITEM[] = [];
    const bulkRemovedItems: BOARD_ITEM[] = [];
    const itemsChanged: BOARD_ITEM[] = [];
    const itemsToDelete: BOARD_ITEM[] = [];

    for (const entry of this.m_entries) {
      if (!entry.m_item || !entry.m_item.IsBOARD_ITEM()) continue;

      const boardItem = entry.m_item as BOARD_ITEM;
      const changeType = entry.m_type & CHANGE_TYPE.CHT_TYPE;
      const changeFlags = entry.m_type & CHANGE_TYPE.CHT_FLAGS;

      switch (changeType) {
        case CHANGE_TYPE.CHT_ADD:
          if (changeFlags & CHANGE_TYPE.CHT_DONE) {
            if (boardItem.Type() !== KICAD_T.PCB_NETINFO_T) view?.Remove(boardItem);

            connectivity.Remove(boardItem);

            if (this.m_isFootprintEditor) {
              const parentFP = board.GetFirstFootprint();
              if (parentFP) parentFP.Remove(boardItem);
            } else {
              board.Remove(boardItem, REMOVE_MODE.BULK);
              bulkRemovedItems.push(boardItem);
            }
          }

          // Defer deletion until after OnItemsCompositeUpdate so that
          // board listeners do not receive dangling pointers.
          itemsToDelete.push(boardItem);
          entry.m_item = null as unknown as EDA_ITEM;
          continue;

        case CHANGE_TYPE.CHT_REMOVE: {
          if (!(changeFlags & CHANGE_TYPE.CHT_DONE)) break;

          if (boardItem.Type() !== KICAD_T.PCB_NETINFO_T) view?.Add(boardItem);

          if (this.m_isFootprintEditor) {
            const parentFP = board.GetFirstFootprint();
            if (parentFP) parentFP.Add(boardItem, ADD_MODE.INSERT);
          } else {
            board.Add(boardItem, ADD_MODE.INSERT);
            bulkAddedItems.push(boardItem);
          }

          updateComponentClasses(boardItem);
          break;
        }

        case CHANGE_TYPE.CHT_MODIFY: {
          if (boardItem.Type() !== KICAD_T.PCB_NETINFO_T) view?.Remove(boardItem);

          connectivity.Remove(boardItem);

          console.assert(entry.m_copy?.IsBOARD_ITEM());
          const boardItemCopy = entry.m_copy as BOARD_ITEM;
          boardItem.SwapItemData(boardItemCopy);

          if (boardItem.Type() !== KICAD_T.PCB_NETINFO_T) view?.Add(boardItem);

          connectivity.Add(boardItem);
          itemsChanged.push(boardItem);

          updateComponentClasses(boardItem);
          break;
        }

        default:
          throw new Error(`UNIMPLEMENTED_FOR( ${boardItem.GetClass()} )`);
      }

      // Delete any copies we still have ownership of
      entry.m_copy = null;

      boardItem.ClearEditFlags();
    }

    // Invalidate component classes
    board.GetComponentClassManager().InvalidateComponentClasses();

    if (bulkAddedItems.length > 0 || bulkRemovedItems.length > 0 || itemsChanged.length > 0)
      board.OnItemsCompositeUpdate(bulkAddedItems, bulkRemovedItems, itemsChanged);

    if (this.m_isBoardEditor) {
      for (const item of itemsToDelete) connectivity.Remove(item);
    }

    // delete item: nothing to free here

    if (this.m_isBoardEditor) {
      connectivity.RecalculateRatsnest();
      board.UpdateRatsnestExclusions();
      board.OnRatsnestChanged();
    }

    const selTool = this.selTool();
    selTool?.RebuildSelection();

    // Property panel needs to know about the reselect
    this.m_toolMgr.PostEvent(EVENTS.SelectedItemsModified);

    this.clear();
  }
}
