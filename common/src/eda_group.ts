// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/eda_group.h` / `eda_group.cpp`: a set of EDA_ITEMs (i.e., without
 * duplicates).
 *
 * The group parent is always board/sheet, not logical parent group. The group is transparent
 * container - e.g., its position is derived from the position of its members.  A selection
 * containing a group implicitly contains its members. However other operations on sets of
 * items, like committing, updating the view, etc the set is explicit.
 *
 * `PCB_GROUP` and `SCH_GROUP` inherit this beside their item base; see
 * `applyMixins`. A derived constructor calls `initEdaGroup()`.
 */

import type { EDA_ITEM } from './eda_item.js';
import type { KIID } from './kiid.js';
import { LIB_ID } from './lib_id.js';

export abstract class EDA_GROUP {
  protected m_items!: Set<EDA_ITEM>; // Members of the group (no ownership)
  protected m_name!: string; // Optional group name
  protected m_designBlockLibId!: LIB_ID; // Optional link to a design block

  /** The mixin's field initialisation; a derived constructor calls it. */
  protected initEdaGroup(): void {
    this.m_items = new Set();
    this.m_name = '';
    this.m_designBlockLibId = new LIB_ID();
  }

  abstract AsEdaItem(): EDA_ITEM;

  GetName(): string {
    return this.m_name;
  }
  SetName(aName: string): void {
    this.m_name = aName;
  }

  GetItems(): Set<EDA_ITEM> {
    return this.m_items;
  }

  /**
   * Test if an item is a direct or nested member of this group.
   */
  ContainsItem(aItem: EDA_ITEM | null): boolean {
    if (!aItem) return false;

    const visitedGroups = new Set<EDA_GROUP>();
    const pendingGroups: EDA_GROUP[] = [];

    pendingGroups.push(this);

    while (pendingGroups.length) {
      const group = pendingGroups.pop()!;

      if (visitedGroups.has(group)) continue;
      visitedGroups.add(group);

      for (const member of group.GetItems()) {
        if (member === aItem) return true;

        const childGroup = asEdaGroup(member);
        if (childGroup) pendingGroups.push(childGroup);
      }
    }

    return false;
  }

  /**
   * Add item to group. Does not take ownership of item.
   */
  AddItem(aItem: EDA_ITEM): void {
    if (!aItem) return; // wxCHECK_RET( "Nullptr added to group." )
    if (aItem === this.AsEdaItem()) return; // wxCHECK_RET( "Group added to itself." )

    const group = asEdaGroup(aItem);
    if (group) {
      if (group.ContainsItem(this.AsEdaItem())) return; // wxCHECK_RET( "Ancestor group added to group." )
    }

    // Items can only be in one group at a time
    const parentGroup = aItem.GetParentGroup();
    if (parentGroup) parentGroup.RemoveItem(aItem);

    this.m_items.add(aItem);
    aItem.SetParentGroup(this);
  }

  /**
   * Remove item from group.
   */
  RemoveItem(aItem: EDA_ITEM): void {
    if (!aItem) return; // wxCHECK_RET( "Nullptr removed from group." )

    if (this.m_items.delete(aItem)) aItem.SetParentGroup(null);
  }

  RemoveAll(): void {
    for (const item of this.m_items) item.SetParentGroup(null);

    this.m_items.clear();
  }

  GetGroupMemberIds(): KIID[] {
    const members: KIID[] = [];

    for (const item of this.m_items) members.push(item.m_Uuid);

    return members;
  }

  HasDesignBlockLink(): boolean {
    return this.m_designBlockLibId.IsValid();
  }

  SetDesignBlockLibId(aLibId: LIB_ID): void {
    this.m_designBlockLibId = aLibId;
  }
  GetDesignBlockLibId(): LIB_ID {
    return this.m_designBlockLibId;
  }
}

/** `dynamic_cast<EDA_GROUP*>( aItem )`: the item when it mixes in EDA_GROUP. */
export function asEdaGroup(aItem: EDA_ITEM | null | undefined): EDA_GROUP | null {
  if (aItem && typeof (aItem as unknown as EDA_GROUP).AsEdaItem === 'function')
    return aItem as unknown as EDA_GROUP;
  return null;
}
