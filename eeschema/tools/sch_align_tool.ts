// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Align to top / bottom / left / right / middle / centre. Counterpart:
 * `eeschema/tools/sch_align_tool.cpp` (SCH_ALIGN_TOOL).
 *
 * Each item moves on one axis until the chosen edge of its bounding box meets a
 * target value. What makes this more than "take the minimum" is how the target
 * is chosen (`selectTarget`), in this order:
 *
 *   1. an item under the cursor, so you can point at the one to align to;
 *   2. otherwise a locked item, since a locked item will not move and
 *      everything else has to come to it;
 *   3. otherwise the outermost item, which is the first after sorting.
 *
 * Locked items are never moved, only used as the target. And a connectable
 * item's delta is snapped so it lands on the grid (`adjustDeltaForGrid`):
 * aligning a symbol to a text box must not leave its pins between grid points,
 * where nothing will connect to them.
 */

import { BITMAPS } from '@ziroeda/common/bitmaps/bitmaps_list.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { IS_MOVING } from '@ziroeda/common/eda_item_flags.js';
import { CONDITIONAL_MENU } from '@ziroeda/common/tool/conditional_menu.js';
import { GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import { SELECTION_CONDITIONS } from '@ziroeda/common/tool/selection_conditions.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { stdSort } from '@ziroeda/kimath/src/clipper2/clipper.core.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { SCH_COLLECTOR } from '../sch_collectors.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_ITEM } from '../sch_item.js';
import { EE_GRID_HELPER } from './ee_grid_helper.js';
import { SCH_ACTIONS } from './sch_actions.js';
import { SCH_LINE_WIRE_BUS_TOOL } from './sch_line_wire_bus_tool.js';
import { SCH_SELECTION } from './sch_selection.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';

type ITEM_BOX = [SCH_ITEM, BOX2I];

/** `SCH_ALIGN_TOOL`: align the selection's edges or centres to a target item. */
export class SCH_ALIGN_TOOL extends SCH_TOOL_BASE<SCH_EDIT_FRAME> {
  private m_alignMenu: CONDITIONAL_MENU | null = null;

  constructor() {
    super('eeschema.Align');
  }

  override Init(): boolean {
    super.Init();

    if (!this.m_alignMenu) {
      this.m_alignMenu = new CONDITIONAL_MENU(this);
      this.m_alignMenu.SetIcon(BITMAPS.align_items);
      this.m_alignMenu.SetUntranslatedTitle('Align');

      const canAlign = SELECTION_CONDITIONS.MoreThan(1);

      this.m_alignMenu.AddItem(SCH_ACTIONS.alignLeft, canAlign);
      this.m_alignMenu.AddItem(SCH_ACTIONS.alignCenterX, canAlign);
      this.m_alignMenu.AddItem(SCH_ACTIONS.alignRight, canAlign);

      this.m_alignMenu.AddSeparator(canAlign);
      this.m_alignMenu.AddItem(SCH_ACTIONS.alignTop, canAlign);
      this.m_alignMenu.AddItem(SCH_ACTIONS.alignCenterY, canAlign);
      this.m_alignMenu.AddItem(SCH_ACTIONS.alignBottom, canAlign);
    }

    const selToolMenu = this.m_selectionTool!.GetToolMenu().GetMenu();
    selToolMenu.AddMenu(this.m_alignMenu, SELECTION_CONDITIONS.MoreThan(1), 100);

    this.setTransitions();

    return true;
  }

  private selectTarget(
    aItems: ITEM_BOX[],
    aLocked: ITEM_BOX[],
    aGetValue: (aItem: ITEM_BOX) => number,
  ): number {
    const cursorPos = this.getViewControls()!.GetCursorPosition();

    if (aLocked.length > 0) {
      for (const item of aLocked) {
        if (item[1].Contains(cursorPos)) return aGetValue(item);
      }

      return aGetValue(aLocked[0]!);
    }

    for (const item of aItems) {
      if (item[1].Contains(cursorPos)) return aGetValue(item);
    }

    return aGetValue(aItems[0]!);
  }

  GetSelections(
    aItemsToAlign: ITEM_BOX[],
    aLockedItems: ITEM_BOX[],
    aCompare: (aLhs: ITEM_BOX, aRhs: ITEM_BOX) => boolean,
  ): number {
    const selection = this.m_selectionTool!.RequestSelection(SCH_COLLECTOR.MovableItems);

    for (const item of selection.GetItems()) {
      if (!item.IsSCH_ITEM()) continue;

      const schItem = item as SCH_ITEM;

      if (schItem.GetParent()?.IsSelected()) continue;

      const bbox = schItem.GetBoundingBox();

      if (schItem.IsLocked()) aLockedItems.push([schItem, bbox]);
      else aItemsToAlign.push([schItem, bbox]);
    }

    // std::sort: libstdc++'s, unstable, so equal keys keep KiCad's order
    stdSort(aItemsToAlign, aCompare);
    stdSort(aLockedItems, aCompare);

    return aItemsToAlign.length;
  }

  private moveItem(aItem: SCH_ITEM, aDelta: VECTOR2I, aCommit: SCH_COMMIT): void {
    if (aDelta.x === 0 && aDelta.y === 0) return;

    const delta = this.adjustDeltaForGrid(aItem, aDelta);

    if (delta.x === 0 && delta.y === 0) return;

    aCommit.Modify(aItem, this.m_frame!.GetScreen(), RECURSE_MODE.RECURSE);
    aItem.Move(delta);
    aItem.ClearFlags(IS_MOVING);
    this.updateItem(aItem, true);
  }

  private adjustDeltaForGrid(aItem: SCH_ITEM, aDelta: VECTOR2I): VECTOR2I {
    if (aDelta.x === 0 && aDelta.y === 0) return aDelta;

    const grid = new EE_GRID_HELPER(this.m_toolMgr);
    const gridType = grid.GetItemGrid(aItem);

    if (gridType !== GRID_HELPER_GRIDS.GRID_CONNECTABLE) return aDelta;

    const pos = aItem.GetPosition();
    const desiredPos = { x: pos.x + aDelta.x, y: pos.y + aDelta.y };
    const snappedPos = grid.AlignGrid(desiredPos, gridType);

    return { x: snappedPos.x - pos.x, y: snappedPos.y - pos.y };
  }

  protected override setTransitions(): void {
    this.Go(SYNC_HANDLER(this.AlignTop), SCH_ACTIONS.alignTop.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignBottom), SCH_ACTIONS.alignBottom.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignLeft), SCH_ACTIONS.alignLeft.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignRight), SCH_ACTIONS.alignRight.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignCenterX), SCH_ACTIONS.alignCenterX.MakeEvent());
    this.Go(SYNC_HANDLER(this.AlignCenterY), SCH_ACTIONS.alignCenterY.MakeEvent());
  }

  /** The six Align* bodies (sch_align_tool.cpp:187-401) differ only in axis, edge and message. */
  private align(
    aCompare: (aLhs: ITEM_BOX, aRhs: ITEM_BOX) => boolean,
    aValue: (aItem: ITEM_BOX) => number,
    aVertical: boolean,
    aMessage: string,
  ): number {
    const itemsToAlign: ITEM_BOX[] = [];
    const lockedItems: ITEM_BOX[] = [];

    if (!this.GetSelections(itemsToAlign, lockedItems, aCompare)) return 0;

    const commit = new SCH_COMMIT(this.m_toolMgr!);

    const target = this.selectTarget(itemsToAlign, lockedItems, aValue);

    for (const item of itemsToAlign) {
      const difference = target - aValue(item);
      this.moveItem(item[0], aVertical ? { x: 0, y: difference } : { x: difference, y: 0 }, commit);
    }

    this.doAlignCleanup(commit, itemsToAlign);

    commit.Push(aMessage);
    return 0;
  }

  AlignTop(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].GetTop() < rhs[1].GetTop(),
      (item) => item[1].GetTop(),
      true,
      'Align to Top',
    );
  }

  AlignBottom(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].GetBottom() > rhs[1].GetBottom(),
      (item) => item[1].GetBottom(),
      true,
      'Align to Bottom',
    );
  }

  AlignLeft(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].GetLeft() < rhs[1].GetLeft(),
      (item) => item[1].GetLeft(),
      false,
      'Align to Left',
    );
  }

  AlignRight(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].GetRight() > rhs[1].GetRight(),
      (item) => item[1].GetRight(),
      false,
      'Align to Right',
    );
  }

  AlignCenterX(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].Centre().x < rhs[1].Centre().x,
      (item) => item[1].Centre().x,
      false,
      'Align to Middle',
    );
  }

  AlignCenterY(_aEvent: TOOL_EVENT): number {
    return this.align(
      (lhs, rhs) => lhs[1].Centre().y < rhs[1].Centre().y,
      (item) => item[1].Centre().y,
      true,
      'Align to Center',
    );
  }

  private doAlignCleanup(aCommit: SCH_COMMIT, aItems: ITEM_BOX[]): void {
    const lwbTool = this.m_toolMgr!.GetTool(SCH_LINE_WIRE_BUS_TOOL)!;

    const alignedItems = new SCH_SELECTION();

    for (const item of aItems) alignedItems.Add(item[0]);

    lwbTool.TrimOverLappingWires(aCommit, alignedItems);
    lwbTool.AddJunctionsIfNeeded(aCommit, alignedItems);

    for (const item of this.m_frame!.GetScreen()!.Items()) item.ClearTempFlags();

    this.m_frame!.Schematic().CleanUp(aCommit);

    for (const item of this.m_frame!.GetScreen()!.Items()) item.ClearEditFlags();
  }
}
