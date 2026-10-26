// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Group tool. Counterpart: `eeschema/tools/sch_group_tool.cpp` (SCH_GROUP_TOOL)
 * + `common/tool/group_tool.cpp` (GROUP_TOOL), Group Items / Ungroup Items:
 *
 *  - Group: the groupable selected items (those with uuids) become the members
 *    of a fresh SCH_GROUP; fewer than two groupable items is a no-op, and an
 *    item already in a group *moves* into the new one (the old group is
 *    modified in the same commit). The new group is what's selected after.
 *  - Ungroup: every selected group is removed and its members stay behind
 *    (selected). Nested member groups survive intact.
 *  - Selection promotion (SCH_SELECTION_TOOL group handling): clicking a
 *    member selects the whole top-level group, so the promotion helper expands
 *    a selection to every member of every touched group, transitively.
 *
 * Selection ids are item uuids (refId returns the uuid when present), so group
 * members and selection ids share one namespace.
 */

import type { COMMIT } from '@ziroeda/common/commit.js';
import type { EDA_GROUP } from '@ziroeda/common/eda_group.js';
import { type EDA_ITEM, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import * as KIPLATFORM_UI from '@ziroeda/kiplatform/ui.js';
import { STATUS_TEXT_POPUP, StatusPopupPanel } from '@ziroeda/common/status_popup.js';
import { ACTIONS, EVENTS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { GROUP_TOOL } from '@ziroeda/common/tool/group_tool.js';
import { PICKER_TOOL } from '@ziroeda/common/tool/picker_tool.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_BASE_FRAME } from '../sch_base_frame.js';
import { SCH_COMMIT } from '../sch_commit.js';
import { SCH_GROUP } from '../sch_group.js';
import type { SCH_ITEM } from '../sch_item.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import { SCH_SELECTION } from './sch_selection.js';
import { SCH_SELECTION_TOOL } from './sch_selection_tool.js';
import type { Schematic } from '../types.js';

/** Every item uuid a group member can reference (groups included, for nesting). */
/**
 * Every uuid that may be a group member.
 *
 * This is not only the gate on *forming* a group: `pruneGroupMembers` drops any
 * member uuid that is not in here, so a kind missing from this list is not
 * merely ungroupable — a group that already contains one, written by KiCad,
 * loses that member on the next edit and on the next save. A missing arm here
 * is silent data loss on a file we did not author.
 *
 * Only sheet graphics are deliberately absent, and they are absent for a real
 * reason: they carry no typed uuid, so there is nothing to record.
 */
export function collectItemUuids(doc: Schematic): Set<string> {
  const out = new Set<string>();
  const add = (u?: string): void => {
    if (u) out.add(u);
  };
  doc.symbols.forEach((i) => add(i.uuid));
  doc.lines.forEach((i) => add(i.uuid));
  doc.junctions.forEach((i) => add(i.uuid));
  doc.noConnects.forEach((i) => add(i.uuid));
  doc.labels.forEach((i) => add(i.uuid));
  doc.sheets.forEach((i) => add(i.uuid));
  doc.busEntries.forEach((i) => add(i.uuid));
  doc.images.forEach((i) => add(i.uuid));
  // Sheet-level graphic shapes are render-only pass-throughs without typed
  // uuids yet; they simply can't join groups until that changes.
  doc.textBoxes.forEach((i) => add(i.uuid));
  doc.tables.forEach((i) => add(i.uuid));
  (doc.directiveLabels ?? []).forEach((i) => add(i.uuid));
  doc.groups.forEach((g) => add(g.uuid));
  return out;
}

/** Whether any selected id belongs to (or is) a group, the Ungroup enable test. */
export function selectionHasGroup(doc: Schematic, ids: ReadonlySet<string>): boolean {
  return doc.groups.some(
    (g) => (g.uuid !== undefined && ids.has(g.uuid)) || g.members.some((m) => ids.has(m)),
  );
}

/** Drop member uuids whose item no longer exists (delete keeps groups tidy;
 *  a group emptied this way stops being written, per saveGroup). */
export function pruneGroupMembers(doc: Schematic): Schematic {
  if (doc.groups.length === 0) return doc;
  const valid = collectItemUuids(doc);
  let dirty = false;
  const groups = doc.groups.map((g) => {
    const members = g.members.filter((m) => valid.has(m));
    if (members.length !== g.members.length) {
      dirty = true;
      return { ...g, members };
    }
    return g;
  });
  return dirty ? { ...doc, groups } : doc;
}

// -----------------------------------------------------------------------------------------------
// SCH_GROUP_TOOL (sch_group_tool.{h,cpp}) on the live model
// -----------------------------------------------------------------------------------------------

/** `SCH_GROUP_TOOL`: GROUP_TOOL for schematic and symbol items. */
export class SCH_GROUP_TOOL extends GROUP_TOOL {
  protected createCommit(): COMMIT {
    return new SCH_COMMIT(this.m_toolMgr!);
  }

  protected getGroupFromItem(aItem: EDA_ITEM): EDA_GROUP | null {
    if (aItem.Type() === KICAD_T.SCH_GROUP_T) return aItem as unknown as EDA_GROUP;

    return null;
  }

  protected canGroupItem(aItem: EDA_ITEM | null, aErrorMsg: { value: string }): boolean {
    if (!aItem || !aItem.IsSCH_ITEM()) {
      aErrorMsg.value = 'Some selected items cannot be grouped.';
      return false;
    }

    const isSymbolEditor = this.m_frame!.GetFrameType() === FRAME_T.FRAME_SCH_SYMBOL_EDITOR;
    const schItem = aItem as SCH_ITEM;

    if (isSymbolEditor) {
      if (schItem.GetParentSymbol()) {
        aErrorMsg.value = 'Child items cannot be grouped separately from their parent item.';
        return false;
      }
    } else {
      if (schItem.GetParent() && schItem.GetParent()!.Type() !== KICAD_T.SCH_SCREEN_T) {
        aErrorMsg.value = 'Child items cannot be grouped separately from their parent item.';
        return false;
      }
    }

    if (!schItem.IsGroupableType()) {
      aErrorMsg.value = 'Some selected items cannot be grouped.';
      return false;
    }

    return true;
  }

  *PickNewMember(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const isSymbolEditor = this.m_frame!.GetFrameType() === FRAME_T.FRAME_SCH_SYMBOL_EDITOR;
    const selTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!;
    const picker = this.m_toolMgr!.GetTool(PICKER_TOOL)!;

    const statusPopup = new STATUS_TEXT_POPUP();
    let done = false;

    if (this.m_propertiesDialog) this.m_propertiesDialog.Show(false);

    this.Activate();

    statusPopup.SetText('Click on new member...');

    picker.SetClickHandler(() => {
      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      const sel = selTool.RequestSelection();

      if (sel.Empty()) return true; // still looking for an item

      statusPopup.Hide();

      if (this.m_propertiesDialog) {
        let elem: EDA_ITEM = sel.Front()!;

        if (!isSymbolEditor) {
          while (elem.GetParent() && elem.GetParent()!.Type() !== KICAD_T.SCH_SCREEN_T)
            elem = elem.GetParent()!;
        }

        this.m_propertiesDialog.DoAddMember(elem);
        this.m_propertiesDialog.Show(true);
      }

      return false; // got our item; don't need any more
    });

    picker.SetMotionHandler(() => {
      const at = KIPLATFORM_UI.GetMousePosition();
      statusPopup.Move({ x: at.x + 20, y: at.y - 50 });
    });

    picker.SetCancelHandler(() => {
      if (this.m_propertiesDialog) this.m_propertiesDialog.Show(true);

      statusPopup.Hide();
    });

    picker.SetFinalizeHandler(() => {
      done = true;
    });

    const at = KIPLATFORM_UI.GetMousePosition();
    statusPopup.Move({ x: at.x + 20, y: at.y - 50 });
    statusPopup.Popup();
    this.m_frame!.GetCanvas()?.SetStatusPopup(StatusPopupPanel(statusPopup));

    this.m_toolMgr!.RunAction(ACTIONS.pickerTool, aEvent);

    while (!done) {
      // Pass events unless we receive a null event, then we must shut down
      const evt = yield* this.Wait();

      if (evt) evt.SetPassEvent();
      else break;
    }

    picker.ClearHandlers();
    this.m_frame!.GetCanvas()?.SetStatusPopup(null);

    return 0;
  }

  Group(_aEvent: TOOL_EVENT): number {
    const isSymbolEditor = this.m_frame!.GetFrameType() === FRAME_T.FRAME_SCH_SYMBOL_EDITOR;
    const selTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!;
    // a copy: SCH_SELECTION selection = selTool->RequestSelection()
    const selection = new SCH_SELECTION().assign(selTool.RequestSelection());
    const errorMsg = { value: '' };

    // Iterate from the back so we don't have to worry about removals.
    for (let ii = selection.GetSize() - 1; ii >= 0; --ii) {
      const item = selection.at(ii)!;

      if (!this.canGroupItem(item, errorMsg)) selection.Remove(item);
    }

    if (selection.GetSize() < 2) {
      if (errorMsg.value !== '') this.m_frame!.ShowInfoBarWarning(errorMsg.value);

      return 0;
    }

    const group = new SCH_GROUP();
    const screen = (this.m_frame as unknown as SCH_BASE_FRAME).GetScreen();

    if (isSymbolEditor)
      group.SetParent((this.m_frame as unknown as SYMBOL_EDIT_FRAME).GetCurSymbol());
    else group.SetParent(screen);

    for (const eda_item of selection.GetItems()) {
      const existingGroup = eda_item.GetParentGroup();

      if (existingGroup)
        this.m_commit!.Modify(existingGroup.AsEdaItem(), screen, RECURSE_MODE.NO_RECURSE);

      this.m_commit!.Modify(eda_item, screen, RECURSE_MODE.NO_RECURSE);
      group.AddItem(eda_item);
    }

    this.m_commit!.Add(group, screen);
    this.m_commit!.Push('Group Items');

    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
    this.m_toolMgr!.RunAction(ACTIONS.selectItem, group.AsEdaItem());

    this.m_toolMgr!.PostEvent(EVENTS.SelectedItemsModified);
    this.m_frame!.OnModify();

    if (errorMsg.value !== '') this.m_frame!.ShowInfoBarWarning(errorMsg.value);

    return 0;
  }
}
