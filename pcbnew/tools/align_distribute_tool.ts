// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ALIGN_DISTRIBUTE_TOOL` (`pcbnew/tools/align_distribute_tool.cpp`,
 * `align_distribute_tool.h`): Align to Left / Horizontal Center / Right /
 * Top / Vertical Center / Bottom and the four Distribute commands, on the live
 * BOARD through a BOARD_COMMIT, with the "Align/Distribute" submenu its Init
 * adds to the selection tool's menu. The spacing maths is kimath's
 * (`geometry/distribute.ts`).
 *
 * `std::sort` is not stable and `Array.prototype.sort` is; for ties the order
 * can differ. Upstream's lists here are small enough (< 16) that libstdc++
 * insertion-sorts them, which is stable, so the two agree.
 */
import { BITMAPS } from '@ziroeda/common/bitmaps/bitmaps_list.js';
import { CHANGE_TYPE } from '@ziroeda/common/commit.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { CONDITIONAL_MENU } from '@ziroeda/common/tool/conditional_menu.js';
import type { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  deltasForDistributeByGaps as GetDeltasForDistributeByGaps,
  deltasForDistributeByPoints as GetDeltasForDistributeByPoints,
} from '@ziroeda/kimath/src/geometry/distribute.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { BOARD_ITEM_CONTAINER } from '../board_item_container.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import type { PCB_SELECTION_TOOL } from './pcb_selection_tool.js';

type ITEM_BOX = [BOARD_ITEM, BOX2I];
type COMPARE = (lhs: ITEM_BOX, rhs: ITEM_BOX) => boolean;

/** A `std::sort` comparator (strict less-than) as an `Array.sort` one. */
const byLess =
  (aLess: COMPARE) =>
  (a: ITEM_BOX, b: ITEM_BOX): number =>
    aLess(a, b) ? -1 : aLess(b, a) ? 1 : 0;

function getBoundingBox(aItem: BOARD_ITEM): BOX2I {
  if (aItem.Type() === KICAD_T.PCB_FOOTPRINT_T)
    return (aItem as unknown as FOOTPRINT).GetBoundingBox(false);
  else return aItem.GetBoundingBox();
}

export class ALIGN_DISTRIBUTE_TOOL extends TOOL_INTERACTIVE {
  private m_selectionTool: PCB_SELECTION_TOOL | null = null;
  private m_placementMenu: CONDITIONAL_MENU | null = null;
  private m_frame: PCB_BASE_FRAME | null = null;

  constructor() {
    super('pcbnew.Placement');
  }

  /// @copydoc TOOL_INTERACTIVE::Reset()
  override Reset(_aReason: RESET_REASON): void {}

  /// @copydoc TOOL_INTERACTIVE::Init()
  override Init(): boolean {
    // Find the selection tool, so they can cooperate
    this.m_selectionTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as unknown as PCB_SELECTION_TOOL;
    this.m_frame = this.getEditFrame<PCB_BASE_FRAME>();

    // Create a context menu and make it available through selection tool
    this.m_placementMenu = new CONDITIONAL_MENU(this);
    this.m_placementMenu.SetIcon(BITMAPS.align_items);
    this.m_placementMenu.SetUntranslatedTitle('Align/Distribute');

    const canAlign = SELECTION_CONDITIONS.MoreThan(1);
    const canDistribute = SELECTION_CONDITIONS.MoreThan(2);

    // Add all align/distribute commands
    this.m_placementMenu.AddItem(PCB_ACTIONS.alignLeft, canAlign);
    this.m_placementMenu.AddItem(PCB_ACTIONS.alignCenterX, canAlign);
    this.m_placementMenu.AddItem(PCB_ACTIONS.alignRight, canAlign);

    this.m_placementMenu.AddSeparator(canAlign);
    this.m_placementMenu.AddItem(PCB_ACTIONS.alignTop, canAlign);
    this.m_placementMenu.AddItem(PCB_ACTIONS.alignCenterY, canAlign);
    this.m_placementMenu.AddItem(PCB_ACTIONS.alignBottom, canAlign);

    this.m_placementMenu.AddSeparator(canDistribute);
    this.m_placementMenu.AddItem(PCB_ACTIONS.distributeHorizontallyCenters, canDistribute);
    this.m_placementMenu.AddItem(PCB_ACTIONS.distributeHorizontallyGaps, canDistribute);
    this.m_placementMenu.AddItem(PCB_ACTIONS.distributeVerticallyCenters, canDistribute);
    this.m_placementMenu.AddItem(PCB_ACTIONS.distributeVerticallyGaps, canDistribute);

    const selToolMenu = this.m_selectionTool.GetToolMenu().GetMenu();
    selToolMenu.AddMenu(this.m_placementMenu, SELECTION_CONDITIONS.MoreThan(1), 100);

    return true;
  }

  /**
   * Prefer locked items to unlocked items. Secondly, prefer items under the
   * cursor to other items.
   */
  private selectTarget(
    aItems: ITEM_BOX[],
    aLocked: ITEM_BOX[],
    aGetValue: (aVal: ITEM_BOX) => number,
  ): number {
    const curPos = this.getViewControls()!.GetCursorPosition();

    // Prefer locked items to unlocked items.
    // Secondly, prefer items under the cursor to other items.

    if (aLocked.length >= 1) {
      for (const item of aLocked) {
        if (item[1].Contains(curPos)) return aGetValue(item);
      }

      return aGetValue(aLocked[0]!);
    }

    for (const item of aItems) {
      if (item[1].Contains(curPos)) return aGetValue(item);
    }

    return aGetValue(aItems[0]!);
  }

  /**
   * Populate two vectors with the sorted selection and sorted locked items.
   *
   * Returns the size of aItemsToAlign()
   */
  GetSelections(aItemsToAlign: ITEM_BOX[], aLockedItems: ITEM_BOX[], aCompare: COMPARE): number {
    const selection = this.m_selectionTool!.RequestSelection((_aPt, aCollector) => {
      // Iterate from the back so we don't have to worry about removals.
      for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
        const item = aCollector.At(i)!;

        if (item.Type() === KICAD_T.PCB_MARKER_T) aCollector.Remove(item);
      }
    });

    let allPads = true;
    let currentParent: BOARD_ITEM_CONTAINER | null = null;
    let differentParents = false;
    const allowFreePads =
      this.m_selectionTool!.IsFootprintEditor() ||
      this.m_frame!.GetPcbNewSettings().m_AllowFreePads;

    for (const item of selection) {
      if (!item.IsBOARD_ITEM()) continue;

      if (item.Type() !== KICAD_T.PCB_PAD_T) allPads = false;

      const boardItem = item as BOARD_ITEM;
      let parent: BOARD_ITEM_CONTAINER | null = boardItem.GetParentFootprint();

      if (!parent) parent = boardItem.GetBoard();

      if (!currentParent) currentParent = parent;
      else if (parent !== currentParent) differentParents = true;
    }

    const addToList = (list: ITEM_BOX[], item: BOARD_ITEM, parentFp: FOOTPRINT | null): void => {
      const listItem: BOARD_ITEM = parentFp ? parentFp : item;

      for (const [candidate] of list) {
        if (candidate === listItem) return;
      }

      list.push([listItem, getBoundingBox(item)]);
    };

    for (const item of selection) {
      if (!item.IsBOARD_ITEM() || item.Type() === KICAD_T.PCB_TABLECELL_T) continue;

      const boardItem = item as BOARD_ITEM;

      if (
        boardItem.Type() === KICAD_T.PCB_PAD_T &&
        (!allowFreePads || (allPads && differentParents))
      ) {
        const parentFp = boardItem.GetParentFootprint();

        if (parentFp?.IsLocked()) addToList(aLockedItems, boardItem, parentFp);
        else addToList(aItemsToAlign, boardItem, parentFp);

        continue;
      }

      if (boardItem.IsLocked()) addToList(aLockedItems, boardItem, null);
      else addToList(aItemsToAlign, boardItem, null);
    }

    aItemsToAlign.sort(byLess(aCompare));
    aLockedItems.sort(byLess(aCompare));

    return aItemsToAlign.length;
  }

  /**
   * The body every align command shares: the selections sorted by `aCompare`,
   * the target from `aGetValue`, each item moved by `aDelta( target, bbox )`.
   * Upstream repeats it in each of the six; only those three differ.
   */
  private align(
    aCompare: COMPARE,
    aGetValue: (aVal: ITEM_BOX) => number,
    aDelta: (aTarget: number, aBox: BOX2I) => { x: number; y: number },
    aMessage: string,
  ): number {
    const itemsToAlign: ITEM_BOX[] = [];
    const locked_items: ITEM_BOX[] = [];

    if (!this.GetSelections(itemsToAlign, locked_items, aCompare)) return 0;

    const commit = new BOARD_COMMIT(this.m_frame!);

    const target = this.selectTarget(itemsToAlign, locked_items, aGetValue);

    // Move the selected items
    for (const [item, bbox] of itemsToAlign) {
      if (item.GetParent()?.IsSelected()) continue;

      commit.Stage(item, CHANGE_TYPE.CHT_MODIFY);
      item.Move(aDelta(target, bbox));
    }

    commit.Push(aMessage);
    return 0;
  }

  /**
   * Set Y coordinate of the selected items to the value of the top-most selected item Y
   * coordinate.
   */
  AlignTop(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].GetTop() < rhs[1].GetTop(),
      (aVal) => aVal[1].GetTop(),
      (targetTop, bbox) => ({ x: 0, y: targetTop - bbox.GetTop() }),
      'Align to Top',
    );
  }

  /**
   * Sets Y coordinate of the selected items to the value of the bottom-most selected item Y
   * coordinate.
   */
  AlignBottom(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].GetBottom() > rhs[1].GetBottom(),
      (aVal) => aVal[1].GetBottom(),
      (targetBottom, bbox) => ({ x: 0, y: targetBottom - bbox.GetBottom() }),
      'Align to Bottom',
    );
  }

  /**
   * Sets X coordinate of the selected items to the value of the left-most selected item X
   * coordinate.
   */
  AlignLeft(_aEvent: TOOL_EVENT): number {
    // Because this tool uses bounding boxes and they aren't mirrored even when
    // the view is mirrored, we need to call the other one if mirrored.
    if (this.getView()!.IsMirroredX()) return this.doAlignRight();
    else return this.doAlignLeft();
  }

  private doAlignLeft(): number {
    return this.align(
      (lhs, rhs) => lhs[1].GetLeft() < rhs[1].GetLeft(),
      (aVal) => aVal[1].GetLeft(),
      (targetLeft, bbox) => ({ x: targetLeft - bbox.GetLeft(), y: 0 }),
      'Align to Left',
    );
  }

  /**
   * Sets X coordinate of the selected items to the value of the right-most selected item X
   * coordinate.
   */
  AlignRight(_aEvent: TOOL_EVENT): number {
    // Because this tool uses bounding boxes and they aren't mirrored even when
    // the view is mirrored, we need to call the other one if mirrored.
    if (this.getView()!.IsMirroredX()) return this.doAlignLeft();
    else return this.doAlignRight();
  }

  private doAlignRight(): number {
    return this.align(
      (lhs, rhs) => lhs[1].GetRight() > rhs[1].GetRight(),
      (aVal) => aVal[1].GetRight(),
      (targetRight, bbox) => ({ x: targetRight - bbox.GetRight(), y: 0 }),
      'Align to Right',
    );
  }

  /**
   * Set the x coordinate of the midpoint of each of the selected items to the value of the
   * x coordinate of the center of the middle selected item.
   */
  AlignCenterX(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].Centre().x < rhs[1].Centre().x,
      (aVal) => aVal[1].Centre().x,
      (targetX, bbox) => ({ x: targetX - bbox.Centre().x, y: 0 }),
      'Align to Middle',
    );
  }

  /**
   * Set the y coordinate of the midpoint of each of the selected items to the value of the
   * y coordinate of the center of the middle selected item.
   */
  AlignCenterY(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].Centre().y < rhs[1].Centre().y,
      (aVal) => aVal[1].Centre().y,
      (targetY, bbox) => ({ x: 0, y: targetY - bbox.Centre().y }),
      'Align to Center',
    );
  }

  /**
   * Distribute the selected items in some way
   */
  DistributeItems(aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.RequestSelection((_aPt, aCollector, sTool) => {
      sTool.FilterCollectorForMarkers(aCollector);
      sTool.FilterCollectorForHierarchy(aCollector, true);

      // Don't filter for free pads.  We want to allow for distributing other
      // items (such as a via) between two pads.
      // sTool->FilterCollectorForFreePads( aCollector );

      sTool.FilterCollectorForLockedItems(aCollector);
    });

    if (this.m_selectionTool!.ReportFilteredLockedItems()) return 0;

    // Need at least 3 items to distribute - one at each end and at least on in the middle
    if (selection.Size() < 3) return 0;

    const commit = new BOARD_COMMIT(this.m_frame!);
    let commitMsg: string;
    const itemsToDistribute: ITEM_BOX[] = [];

    for (const item of selection as Iterable<EDA_ITEM>) {
      if (!item.IsBOARD_ITEM()) continue;

      const boardItem = item as BOARD_ITEM;
      itemsToDistribute.push([boardItem, getBoundingBox(boardItem)]);
    }

    if (aEvent.Matches(PCB_ACTIONS.distributeHorizontallyCenters.MakeEvent())) {
      this.doDistributeCenters(true, itemsToDistribute, commit);
      commitMsg = PCB_ACTIONS.distributeHorizontallyCenters.GetFriendlyName();
    } else if (aEvent.Matches(PCB_ACTIONS.distributeHorizontallyGaps.MakeEvent())) {
      this.doDistributeGaps(true, itemsToDistribute, commit);
      commitMsg = PCB_ACTIONS.distributeHorizontallyGaps.GetFriendlyName();
    } else if (aEvent.Matches(PCB_ACTIONS.distributeVerticallyCenters.MakeEvent())) {
      this.doDistributeCenters(false, itemsToDistribute, commit);
      commitMsg = PCB_ACTIONS.distributeVerticallyCenters.GetFriendlyName();
    } else {
      this.doDistributeGaps(false, itemsToDistribute, commit);
      commitMsg = PCB_ACTIONS.distributeVerticallyGaps.GetFriendlyName();
    }

    commit.Push(commitMsg);
    return 0;
  }

  /**
   * Distributes selected items using an even spacing between their bounding boxe
   * in the x or y axis.
   *
   * @note If the total item widths exceed the available space, the overlaps will be
   *       distributed evenly.
   */
  private doDistributeGaps(aIsXAxis: boolean, aItems: ITEM_BOX[], aCommit: BOARD_COMMIT): void {
    // Sort by start position.
    // This is a simple way to get the items in a sensible order but it's not perfect.
    // It will fail if, say, there's a huge items that's bigger than the total span of
    // all the other items, but at that point a gap-equalising algorithm probably isn't
    // well-defined anyway.
    aItems.sort(
      byLess((a, b) =>
        aIsXAxis ? a[1].GetLeft() < b[1].GetLeft() : a[1].GetTop() < b[1].GetTop(),
      ),
    );

    // Consruct list of item spans in the relevant axis
    const itemSpans: [number, number][] = [];

    for (const [, box] of aItems) {
      const start = aIsXAxis ? box.GetLeft() : box.GetTop();
      const end = aIsXAxis ? box.GetRight() : box.GetBottom();
      itemSpans.push([start, end]);
    }

    // Get the deltas needed to distribute the items evenly
    const deltas = GetDeltasForDistributeByGaps(itemSpans);

    // Apply the deltas to the items
    for (let i = 1; i < aItems.length - 1; ++i) {
      const [item] = aItems[i]!;
      const delta = deltas[i]!;

      if (delta !== 0) {
        const deltaVec = aIsXAxis ? { x: delta, y: 0 } : { x: 0, y: delta };

        aCommit.Stage(item, CHANGE_TYPE.CHT_MODIFY);
        item.Move(deltaVec);
      }
    }
  }

  /**
   * Distribute selected items using an even spacing between the centers of their bounding
   * boxes.
   *
   * @note Using the centers of bounding box of items can give unsatisfactory visual results
   *       since items of differing widths will be placed with different gaps. Is only used
   *       if items overlap
   */
  private doDistributeCenters(aIsXAxis: boolean, aItems: ITEM_BOX[], aCommit: BOARD_COMMIT): void {
    aItems.sort(
      byLess((lhs, rhs) => {
        const lhsPos = aIsXAxis ? lhs[1].Centre().x : lhs[1].Centre().y;
        const rhsPos = aIsXAxis ? rhs[1].Centre().x : rhs[1].Centre().y;
        return lhsPos < rhsPos;
      }),
    );

    const itemCenters: number[] = [];

    for (const [, box] of aItems) {
      itemCenters.push(aIsXAxis ? box.Centre().x : box.Centre().y);
    }

    const deltas = GetDeltasForDistributeByPoints(itemCenters);

    // Apply the deltas to the items
    for (let i = 1; i < aItems.length - 1; ++i) {
      const [item] = aItems[i]!;
      const delta = deltas[i]!;

      if (delta !== 0) {
        const deltaVec = aIsXAxis ? { x: delta, y: 0 } : { x: 0, y: delta };

        aCommit.Stage(item, CHANGE_TYPE.CHT_MODIFY);
        item.Move(deltaVec);
      }
    }
  }

  ///< Set up handlers for various events.
  protected setTransitions(): void {
    this.Go(SYNC_HANDLER(this.AlignTop), PCB_ACTIONS.alignTop.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignBottom), PCB_ACTIONS.alignBottom.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignLeft), PCB_ACTIONS.alignLeft.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignRight), PCB_ACTIONS.alignRight.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignCenterX), PCB_ACTIONS.alignCenterX.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignCenterY), PCB_ACTIONS.alignCenterY.MakeEvent());

    this.Go(
      SYNC_HANDLER(this.DistributeItems),
      PCB_ACTIONS.distributeHorizontallyCenters.MakeEvent(),
    );
    this.Go(SYNC_HANDLER(this.DistributeItems), PCB_ACTIONS.distributeHorizontallyGaps.MakeEvent());
    this.Go(
      SYNC_HANDLER(this.DistributeItems),
      PCB_ACTIONS.distributeVerticallyCenters.MakeEvent(),
    );
    this.Go(SYNC_HANDLER(this.DistributeItems), PCB_ACTIONS.distributeVerticallyGaps.MakeEvent());
  }
}
