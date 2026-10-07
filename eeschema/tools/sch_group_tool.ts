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
import * as KIPLATFORM_UI from '@ziroeda/common/kiplatform/ui.js';
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
import type { Schematic, SchGroup } from '../types.js';
import type { EditCommand } from './command.js';
import { newKiid } from '@ziroeda/common/kiid.js';
import { list, atom, str } from '@ziroeda/sexpr/types.js';

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

/** Build a fresh SchGroup (SCH_GROUP constructor + AddItem). */
function makeGroup(members: readonly string[], name = ''): SchGroup {
  const uuid = newKiid();
  return {
    name,
    uuid,
    members,
    source: list(
      atom('group'),
      str(name),
      list(atom('uuid'), str(uuid)),
      list(atom('members'), ...[...members].sort().map(str)),
    ),
  };
}

/** Snapshot-restore of the groups array (the inverse of any group edit). */
function restoreGroups(saved: readonly SchGroup[]): EditCommand {
  return {
    label: 'Group Items',
    apply(doc: Schematic): Schematic {
      return { ...doc, groups: saved };
    },
    invert(before: Schematic): EditCommand {
      return restoreGroups(before.groups);
    },
  };
}

/**
 * Group Items (SCH_GROUP_TOOL::Group): the selected ids that are groupable
 * item uuids become one new group; members leave any group they were in.
 */
export function groupItemsCommand(ids: ReadonlySet<string>): EditCommand {
  return {
    label: 'Group Items',
    apply(doc: Schematic): Schematic {
      const valid = collectItemUuids(doc);
      const members = [...ids].filter((id) => valid.has(id));
      if (members.length < 2) return doc; // canGroupItem gate: nothing to group
      const memberSet = new Set(members);
      // An item joining the new group leaves its old one (AddItem reparents).
      const groups = doc.groups.map((g) =>
        g.members.some((m) => memberSet.has(m))
          ? { ...g, members: g.members.filter((m) => !memberSet.has(m)) }
          : g,
      );
      return { ...doc, groups: [...groups, makeGroup(members)] };
    },
    invert(before: Schematic): EditCommand {
      return restoreGroups(before.groups);
    },
  };
}

/**
 * Ungroup Items (GROUP_TOOL::Ungroup): every group touched by the selection,
 * selected directly by uuid or through any selected member, is removed;
 * members stay behind.
 */
export function ungroupItemsCommand(ids: ReadonlySet<string>): EditCommand {
  return {
    label: 'Ungroup Items',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        groups: doc.groups.filter(
          (g) => !(g.uuid && ids.has(g.uuid)) && !g.members.some((m) => ids.has(m)),
        ),
      };
    },
    invert(before: Schematic): EditCommand {
      const cmd = restoreGroups(before.groups);
      return { ...cmd, label: 'Ungroup Items' };
    },
  };
}

/**
 * The symbol a child id belongs to, or null when the id is not one.
 *
 * Children are addressed as `<symbolRefId>:field<k>` and `<symbolRefId>:pin<n>`
 * (see `hittest.ts`), so the parent is the part before the marker.
 */
function parentSymbolOf(id: string): string | null {
  for (const marker of [':field', ':pin']) {
    const at = id.lastIndexOf(marker);
    if (at > 0) return id.slice(0, at);
  }
  return null;
}

/**
 * Selection promotion: expand `ids` so that touching any member (or a group's
 * own uuid) selects every member of that group, resolving nested groups
 * transitively, the whole-group selection SCH_SELECTION_TOOL produces.
 */
export function expandSelectionToGroups(
  doc: Schematic,
  ids: ReadonlySet<string>,
): ReadonlySet<string> {
  if (doc.groups.length === 0) return ids;
  const byUuid = new Map(doc.groups.filter((g) => g.uuid).map((g) => [g.uuid!, g]));
  const members = new Set(doc.groups.flatMap((g) => g.members));
  // A hit on a child of a symbol looks the group up from the *symbol*, which is
  // what a group actually holds. `SCH_SELECTION_TOOL::filterCollectedItems`:
  //
  //   SCH_ITEM* start = item;
  //   if( !m_isSymbolEditor && sym ) start = sym;
  //   if( EDA_GROUP* top = SCH_GROUP::TopLevelGroup( start, … ) ) …
  //
  // Without it a field is not a group member — the symbol is — so clicking a
  // grouped symbol's reference selected the text alone and let it be dragged
  // out of the group it was supposed to be locked into.
  //
  // Only when the symbol is in a group, since `start` is upstream's lookup key
  // and nothing more: a field of an ungrouped symbol is still selected, and
  // moved, on its own.
  const out = new Set<string>(ids);
  for (const id of ids) {
    if (members.has(id) || byUuid.has(id)) continue;
    const parent = parentSymbolOf(id);
    if (parent !== null && members.has(parent)) out.add(parent);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of doc.groups) {
      const touched = (g.uuid && out.has(g.uuid)) || g.members.some((m) => out.has(m));
      if (!touched) continue;
      // Mark the group itself selected, so a parent group holding it as a
      // member is touched on the next pass (top-level group promotion).
      if (g.uuid && !out.has(g.uuid)) {
        out.add(g.uuid);
        changed = true;
      }
      for (const m of g.members) {
        if (!out.has(m)) {
          out.add(m);
          changed = true;
        }
        // A member that is itself a group brings its own members along.
        const nested = byUuid.get(m);
        if (nested) {
          for (const nm of nested.members) {
            if (!out.has(nm)) {
              out.add(nm);
              changed = true;
            }
          }
        }
      }
    }
  }
  return out;
}

/** Whether any selected id belongs to (or is) a group, the Ungroup enable test. */
export function selectionHasGroup(doc: Schematic, ids: ReadonlySet<string>): boolean {
  return doc.groups.some(
    (g) => (g.uuid !== undefined && ids.has(g.uuid)) || g.members.some((m) => ids.has(m)),
  );
}

/** The group uuids that are themselves selected (a selected id == a group uuid). */
function selectedGroupUuids(doc: Schematic, ids: ReadonlySet<string>): string[] {
  return doc.groups.filter((g) => g.uuid !== undefined && ids.has(g.uuid)).map((g) => g.uuid!);
}

/** Groupable selected items not already in any group and not a group themselves. */
function ungroupedSelectedItems(doc: Schematic, ids: ReadonlySet<string>): string[] {
  const valid = collectItemUuids(doc);
  const memberOf = new Set(doc.groups.flatMap((g) => g.members));
  const groupUuids = new Set(doc.groups.map((g) => g.uuid).filter((u): u is string => !!u));
  return [...ids].filter((id) => valid.has(id) && !memberOf.has(id) && !groupUuids.has(id));
}

/**
 * Add to Group enable (GROUP_TOOL::update: onlyOneGroup && hasUngroupedItems),
 * exactly one group selected plus at least one groupable, ungrouped item.
 */
export function canAddToGroup(doc: Schematic, ids: ReadonlySet<string>): boolean {
  return selectedGroupUuids(doc, ids).length === 1 && ungroupedSelectedItems(doc, ids).length > 0;
}

/** Remove from Group enable (hasMember): a selected id is a member of some group. */
export function canRemoveFromGroup(doc: Schematic, ids: ReadonlySet<string>): boolean {
  const memberOf = new Set(doc.groups.flatMap((g) => g.members));
  for (const id of ids) if (memberOf.has(id)) return true;
  return false;
}

/**
 * Add Items to Group (GROUP_TOOL::AddToGroup): the ungrouped selected items join
 * the single selected group. A no-op unless exactly one group is selected.
 */
export function addToGroupCommand(ids: ReadonlySet<string>): EditCommand {
  return {
    label: 'Add Items to Group',
    apply(doc: Schematic): Schematic {
      const groups = selectedGroupUuids(doc, ids);
      if (groups.length !== 1) return doc;
      const gUuid = groups[0]!;
      const toAdd = ungroupedSelectedItems(doc, ids);
      if (toAdd.length === 0) return doc;
      return {
        ...doc,
        groups: doc.groups.map((g) =>
          g.uuid === gUuid ? { ...g, members: [...g.members, ...toAdd] } : g,
        ),
      };
    },
    invert(before: Schematic): EditCommand {
      return restoreGroups(before.groups);
    },
  };
}

/**
 * Remove Items from Group (GROUP_TOOL::RemoveFromGroup): drop the selected items
 * from their parent groups; a group left with fewer than two members dissolves.
 */
export function removeFromGroupCommand(ids: ReadonlySet<string>): EditCommand {
  return {
    label: 'Remove Items from Group',
    apply(doc: Schematic): Schematic {
      let changed = false;
      const trimmed = doc.groups.map((g) => {
        const members = g.members.filter((m) => !ids.has(m));
        if (members.length !== g.members.length) {
          changed = true;
          return { ...g, members };
        }
        return g;
      });
      if (!changed) return doc;
      // Groups with < 2 members are removed (the ">= 2" invariant).
      return { ...doc, groups: trimmed.filter((g) => g.members.length >= 2) };
    },
    invert(before: Schematic): EditCommand {
      return restoreGroups(before.groups);
    },
  };
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
