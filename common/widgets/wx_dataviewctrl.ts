// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `WX_DATAVIEWCTRL` (`include/widgets/wx_dataviewctrl.h`,
 * `common/widgets/wx_dataviewctrl.cpp`): KiCad's `wxDataViewCtrl` with the
 * tree walks wx lacks - previous/next item in display order and previous/next
 * sibling - which `LIB_TREE` drives its Up/Down keys with.
 *
 * Here the walks are functions over the three things they ask of the control
 * and its model: `GetModel()->GetParent`, `GetModel()->GetChildren` and
 * `IsExpanded`. `null` is the invalid `wxDataViewItem`, which is also the
 * model's root.
 *
 * `ExpandAll` / `CollapseAll` and `CancelPendingEnsureVisible` are the
 * control's own state and a GTK workaround; the tree components own the first
 * and have no use for the second. How a row is drawn (`GetAttr`) is
 * `rc_tree_style.ts`.
 */

/** What the walks read: the model's parent/children, and the control's expansion. */
export interface WX_DATAVIEW_MODEL<T> {
  /** `GetModel()->GetParent( aItem )`; null for a top-level item. */
  GetParent(aItem: T): T | null;
  /** `GetModel()->GetChildren( aItem, children )`; null asks for the top level. */
  GetChildren(aItem: T | null): readonly T[];
  /** `IsExpanded( aItem )`. */
  IsExpanded(aItem: T): boolean;
}

export function GetPrevSibling<T>(aModel: WX_DATAVIEW_MODEL<T>, aItem: T): T | null {
  const siblings = aModel.GetChildren(aModel.GetParent(aItem));
  const i = siblings.indexOf(aItem);

  if (i <= 0) return null;

  return siblings[i - 1] ?? null;
}

export function GetNextSibling<T>(aModel: WX_DATAVIEW_MODEL<T>, aItem: T): T | null {
  const siblings = aModel.GetChildren(aModel.GetParent(aItem));
  const i = siblings.indexOf(aItem);

  if (i < 0 || i === siblings.length - 1) return null;

  return siblings[i + 1] ?? null;
}

/**
 * `GetPrevItem`: the previous sibling - or its LAST CHILD when it is expanded,
 * one level only - else the parent.
 */
export function GetPrevItem<T>(aModel: WX_DATAVIEW_MODEL<T>, aItem: T): T | null {
  let prevItem = GetPrevSibling(aModel, aItem);

  if (prevItem === null) {
    prevItem = aModel.GetParent(aItem);
  } else if (aModel.IsExpanded(prevItem)) {
    const children = aModel.GetChildren(prevItem);

    if (children.length) prevItem = children[children.length - 1]!;
  }

  return prevItem;
}

/**
 * `GetNextItem`: with no item, the first top-level one; an expanded item's
 * first child; else the next sibling of the item or of the nearest ancestor
 * that has one.
 */
export function GetNextItem<T>(aModel: WX_DATAVIEW_MODEL<T>, aItem: T | null): T | null {
  if (aItem === null) {
    // No selection. Select the first.
    return aModel.GetChildren(null)[0] ?? null;
  }

  if (aModel.IsExpanded(aItem)) return aModel.GetChildren(aItem)[0] ?? null;

  // Walk up levels until we find one that has a next sibling.
  for (let walk: T | null = aItem; walk !== null; walk = aModel.GetParent(walk)) {
    const nextItem = GetNextSibling(aModel, walk);

    if (nextItem !== null) return nextItem;
  }

  return null;
}
