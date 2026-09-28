// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GROUP_TOOL` (`common/tool/group_tool.cpp`, `common/tool/group_tool.h`): the
 * base of `PCB_GROUP_TOOL` and `SCH_GROUP_TOOL` - Ungroup, Add to Group,
 * Remove from Group, Enter / Leave Group and the Group Properties dialog, plus
 * the "Grouping" submenu (`GROUP_CONTEXT_MENU`) it adds to the selection
 * tool's context menu. `Group`, `PickNewMember` and the three item hooks are
 * the editors'.
 *
 * `DIALOG_GROUP_PROPERTIES` is not ported; the frame supplies it through
 * `SetGroupPropertiesDialogFactory`, as `COMMON_CONTROL`'s frames present
 * Preferences. `ShowInfoBarWarning` is asked of the frame structurally
 * (`GROUP_TOOL_FRAME`) until `EDA_BASE_FRAME` has its infobar calls.
 */
import type { COMMIT } from '../commit.js';
import type { EDA_DRAW_FRAME } from '../eda_draw_frame.js';
import { asEdaGroup, type EDA_GROUP } from '../eda_group.js';
import { type EDA_ITEM, type EDA_ITEMS, RECURSE_MODE } from '../eda_item.js';
import { BITMAPS } from '../bitmaps/bitmaps_list.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ACTION_MENU } from './action_menu.js';
import { ACTIONS } from './actions.js';
import { SELECTION } from './selection.js';
import { SELECTION_CONDITIONS } from './selection_conditions.js';
import type { SELECTION_TOOL } from './selection_tool.js';
import type { RESET_REASON } from './tool_base.js';
import { EVENTS, type TOOL_EVENT } from './tool_event.js';
import { SYNC_HANDLER, TOOL_INTERACTIVE } from './tool_interactive.js';

/** The frame, with the one `EDA_BASE_FRAME` call not yet on our base class. */
export type GROUP_TOOL_FRAME = EDA_DRAW_FRAME & {
  ShowInfoBarWarning(aWarningMsg: string, aShowCloseButton?: boolean): void;
};

/** `DIALOG_GROUP_PROPERTIES` as `GroupProperties` drives it: a modeless dialog. */
export interface DIALOG_GROUP_PROPERTIES {
  Show(aShow: boolean): void;
  Destroy(): void;
}

export type DIALOG_GROUP_PROPERTIES_FACTORY = (
  aFrame: GROUP_TOOL_FRAME,
  aGroup: EDA_GROUP,
  aCommit: COMMIT,
) => DIALOG_GROUP_PROPERTIES;

let s_groupPropertiesFactory: DIALOG_GROUP_PROPERTIES_FACTORY | null = null;

/** Install the view that builds `DIALOG_GROUP_PROPERTIES`. */
export function SetGroupPropertiesDialogFactory(
  aFactory: DIALOG_GROUP_PROPERTIES_FACTORY | null,
): void {
  s_groupPropertiesFactory = aFactory;
}

const isGroupType = (aItem: EDA_ITEM): boolean =>
  aItem.Type() === KICAD_T.PCB_GROUP_T || aItem.Type() === KICAD_T.SCH_GROUP_T;

/** `GROUP_CONTEXT_MENU::update`'s four enables, over one selection. */
export interface GROUP_MENU_STATE {
  group: boolean;
  ungroup: boolean;
  addToGroup: boolean;
  removeFromGroup: boolean;
}

/**
 * `GROUP_CONTEXT_MENU::update()` (group_tool.cpp:67-105): Group needs two or
 * more items; Ungroup a selected group; Add to Group exactly one group plus
 * an item in no group; Remove from Group an item in a group.
 */
export function GroupMenuState(aSelection: Iterable<EDA_ITEM> | null): GROUP_MENU_STATE {
  let selectionCount = 0;
  let hasGroup = false;
  let hasMember = false;
  let onlyOneGroup = false;
  let hasUngroupedItems = false;

  if (aSelection !== null) {
    for (const item of aSelection) {
      selectionCount++;

      if (isGroupType(item)) {
        // Only allow one group to be selected for adding to existing group
        if (hasGroup) {
          onlyOneGroup = false;
        } else {
          onlyOneGroup = true;
          hasGroup = true;
        }
      } else if (!item.GetParentGroup()) {
        hasUngroupedItems = true;
      }

      if (item.GetParentGroup()) hasMember = true;
    }
  }

  return {
    group: selectionCount >= 2,
    ungroup: hasGroup,
    addToGroup: onlyOneGroup && hasUngroupedItems,
    removeFromGroup: hasMember,
  };
}

export class GROUP_CONTEXT_MENU extends ACTION_MENU {
  private m_selectionTool: SELECTION_TOOL | null = null;

  constructor() {
    super(true);

    this.SetIcon(BITMAPS.group); // fixme
    this.SetTitle('Grouping');

    this.Add(ACTIONS.group);
    this.Add(ACTIONS.ungroup);
    this.Add(ACTIONS.addToGroup);
    this.Add(ACTIONS.removeFromGroup);
  }

  protected override create(): ACTION_MENU {
    const menu = new GROUP_CONTEXT_MENU();
    menu.SetSelectionTool(this.m_selectionTool);
    return menu;
  }

  SetSelectionTool(aTool: SELECTION_TOOL | null): void {
    this.m_selectionTool = aTool;
  }

  protected override update(): void {
    const s = GroupMenuState(this.m_selectionTool ? this.m_selectionTool.GetSelection() : null);

    this.Enable(ACTIONS.group.GetUIId(), s.group);
    this.Enable(ACTIONS.ungroup.GetUIId(), s.ungroup);
    this.Enable(ACTIONS.addToGroup.GetUIId(), s.addToGroup);
    this.Enable(ACTIONS.removeFromGroup.GetUIId(), s.removeFromGroup);
  }
}

export abstract class GROUP_TOOL extends TOOL_INTERACTIVE {
  protected m_frame: GROUP_TOOL_FRAME | null = null;
  protected m_propertiesDialog: DIALOG_GROUP_PROPERTIES | null = null;
  protected m_selectionTool: SELECTION_TOOL | null = null;
  protected m_commit: COMMIT | null = null;

  constructor() {
    super('common.Groups');
  }

  override Reset(_aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<GROUP_TOOL_FRAME>();
    this.m_commit = this.createCommit();
  }

  /// @copydoc TOOL_BASE::Init()
  override Init(): boolean {
    this.m_frame = this.getEditFrame<GROUP_TOOL_FRAME>();
    this.m_commit = this.createCommit();

    // Find the selection tool, so they can cooperate
    this.m_selectionTool = this.m_toolMgr!.FindTool(
      'common.InteractiveSelection',
    ) as SELECTION_TOOL | null;

    if (!this.m_selectionTool) return false;

    const selToolMenu = this.m_selectionTool.GetToolMenu();

    const groupMenu = new GROUP_CONTEXT_MENU();
    groupMenu.SetTool(this);
    groupMenu.SetSelectionTool(this.m_selectionTool);
    selToolMenu.RegisterSubMenu(groupMenu);

    selToolMenu.GetMenu().AddMenu(groupMenu, SELECTION_CONDITIONS.NotEmpty, 100);

    return true;
  }

  GroupProperties(aEvent: TOOL_EVENT): number {
    const group = aEvent.Parameter<EDA_GROUP>();

    if (this.m_propertiesDialog) this.m_propertiesDialog.Destroy();

    this.m_propertiesDialog = s_groupPropertiesFactory
      ? s_groupPropertiesFactory(this.m_frame!, group, this.m_commit!)
      : null;

    this.m_propertiesDialog?.Show(true);

    return 0;
  }

  /**
   * Invoke the picker tool to select a new member of the group.
   */
  abstract PickNewMember(aEvent: TOOL_EVENT): number;

  ///< Group selected items.
  abstract Group(aEvent: TOOL_EVENT): number;

  ///< Ungroup selected items.
  Ungroup(_aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.GetSelection();
    const toSelect: EDA_ITEMS = [];

    if (selection.Empty()) this.m_toolMgr!.RunAction(ACTIONS.selectionCursor);

    const selCopy = new SELECTION(selection);
    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    for (const item of selCopy) {
      const group = asEdaGroup(item);

      if (group) {
        group.AsEdaItem().SetSelected();
        this.m_commit!.Remove(group.AsEdaItem(), this.m_frame!.GetScreen());

        for (const member of group.GetItems()) {
          this.m_commit!.Modify(member, this.m_frame!.GetScreen(), RECURSE_MODE.NO_RECURSE);
          toSelect.push(member);
        }

        group.RemoveAll();
      }
    }

    this.m_commit!.Push('Ungroup Items');

    this.m_toolMgr!.RunAction<EDA_ITEMS>(ACTIONS.selectItems, toSelect);

    this.m_toolMgr!.PostEvent(EVENTS.SelectedItemsModified);
    this.m_frame!.OnModify();

    return 0;
  }

  ///< Add selection to group.
  AddToGroup(_aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.GetSelection();

    let group: EDA_GROUP | null = null;
    const toAdd: EDA_ITEMS = [];
    const errorMsg = { value: '' };

    for (const item of selection) {
      if (isGroupType(item)) {
        // Only allow one group to be selected for adding to existing group
        if (group !== null) return 0;

        group = asEdaGroup(item);
      } else if (!item.GetParentGroup() && this.canGroupItem(item, errorMsg)) {
        toAdd.push(item);
      }
    }

    if (!group || toAdd.length === 0) {
      if (errorMsg.value !== '') this.m_frame!.ShowInfoBarWarning(errorMsg.value);

      return 0;
    }

    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    this.m_commit!.Modify(group.AsEdaItem(), this.m_frame!.GetScreen(), RECURSE_MODE.NO_RECURSE);

    for (const item of toAdd) {
      const existingGroup = item.GetParentGroup();

      if (existingGroup !== group) {
        this.m_commit!.Modify(item, this.m_frame!.GetScreen());

        if (existingGroup)
          this.m_commit!.Modify(
            existingGroup.AsEdaItem(),
            this.m_frame!.GetScreen(),
            RECURSE_MODE.NO_RECURSE,
          );

        group.AddItem(item);
      }
    }

    this.m_commit!.Push('Add Items to Group');

    this.m_selectionTool!.AddItemToSel(group.AsEdaItem());
    this.m_toolMgr!.PostEvent(EVENTS.SelectedItemsModified);
    this.m_frame!.OnModify();

    if (errorMsg.value !== '') this.m_frame!.ShowInfoBarWarning(errorMsg.value);

    return 0;
  }

  ///< Remove selection from group.
  RemoveFromGroup(_aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.GetSelection();

    if (selection.Empty()) this.m_toolMgr!.RunAction(ACTIONS.selectionCursor);

    const affectedGroups = new Set<EDA_GROUP>();

    for (const item of selection) {
      const group = item.GetParentGroup();

      if (group) {
        this.m_commit!.Modify(
          group.AsEdaItem(),
          this.m_frame!.GetScreen(),
          RECURSE_MODE.NO_RECURSE,
        );
        this.m_commit!.Modify(item, this.m_frame!.GetScreen());
        group.RemoveItem(item);
        affectedGroups.add(group);
      }
    }

    for (const group of affectedGroups) {
      if (group.GetItems().size < 2) {
        group.RemoveAll();
        this.m_commit!.Remove(group.AsEdaItem(), this.m_frame!.GetScreen());
      }
    }

    this.m_commit!.Push('Remove Group Items');

    this.m_toolMgr!.PostEvent(EVENTS.SelectedItemsModified);
    this.m_frame!.OnModify();

    return 0;
  }

  ///< Restrict selection to only member of the group.
  EnterGroup(_aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.GetSelection();

    if (selection.Size() === 1 && isGroupType(selection.at(0)!)) this.m_selectionTool!.EnterGroup();

    return 0;
  }

  ///< Leave the current group (deselect its members and select the group as a whole).
  LeaveGroup(_aEvent: TOOL_EVENT): number {
    this.m_selectionTool!.ExitGroup(true /* Select the group */);
    return 0;
  }

  ///< Set up handlers for various events.
  protected setTransitions(): void {
    this.Go(SYNC_HANDLER(this.GroupProperties), ACTIONS.groupProperties.MakeEvent());
    this.Go(SYNC_HANDLER(this.PickNewMember), ACTIONS.pickNewGroupMember.MakeEvent());

    this.Go(SYNC_HANDLER(this.Group), ACTIONS.group.MakeEvent());
    this.Go(SYNC_HANDLER(this.Ungroup), ACTIONS.ungroup.MakeEvent());
    this.Go(SYNC_HANDLER(this.AddToGroup), ACTIONS.addToGroup.MakeEvent());
    this.Go(SYNC_HANDLER(this.RemoveFromGroup), ACTIONS.removeFromGroup.MakeEvent());
    this.Go(SYNC_HANDLER(this.EnterGroup), ACTIONS.groupEnter.MakeEvent());
    this.Go(SYNC_HANDLER(this.LeaveGroup), ACTIONS.groupLeave.MakeEvent());
  }

  ///< Check if an item can be a direct member of a group; `aErrorMsg.value` is wxString&.
  protected abstract canGroupItem(aItem: EDA_ITEM, aErrorMsg: { value: string }): boolean;

  ///< Get the correctly casted group type from the item.
  /// Works around our lack of working dynamic_cast.
  protected abstract getGroupFromItem(aItem: EDA_ITEM): EDA_GROUP | null;

  ///< Subclasses implement to provide correct *_COMMIT object type
  protected abstract createCommit(): COMMIT;
}
