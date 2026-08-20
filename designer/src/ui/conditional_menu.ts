// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CONDITIONAL_MENU` — `common/tool/conditional_menu.cpp`.
 *
 * Every KiCad tool menu is built this way: each tool that has something to
 * contribute calls `AddItem( action, condition, order )` on the SAME menu
 * object, from its own `Init()`, and the menu is re-evaluated against the live
 * selection every time it is popped up. Two rules do all the work:
 *
 *   - **order** (`addEntry`, :210-221) — a new entry is inserted after every
 *     entry whose order is less than or equal to its own, so the list is sorted
 *     ascending and ties keep their insertion order. This is what lets three
 *     unrelated files interleave their rows without knowing about each other.
 *
 *   - **separator elision** (`Evaluate`, :128-190) — `menu_count` counts the
 *     rows emitted since the last separator that was actually drawn, and a
 *     separator with `menu_count == 0` is skipped. So a group that conditions
 *     itself away takes its rule with it, and the menu never opens on a rule.
 *     Note what `menu_count` is NOT: it is not per order-group. A separator
 *     draws if *anything* preceded it since the last one, even from a lower
 *     group.
 *
 * Writing the evaluated shape out by hand instead — `if (hasSelection) push(…)`
 * — is how a menu quietly stops matching: the conditions end up spelled once in
 * the layout rather than once per row, and a rule that should vanish stays.
 */
import type { MenuItem } from './menu_types.js';

/** One `CONDITIONAL_MENU::ENTRY`. */
export interface ConditionalEntry {
  /** The row, or omitted for `ENTRY::SEPARATOR`. */
  item?: MenuItem;
  /** `AddSeparator( order )`. */
  separator?: boolean;
  /** The `aOrder` argument. Entries are drawn in ascending order. */
  order: number;
  /** The `SELECTION_CONDITION`, already evaluated against the selection. */
  when?: boolean;
}

/** `AddItem( aAction, aCondition, aOrder )`. */
export function menuEntry(item: MenuItem, order: number, when = true): ConditionalEntry {
  return { item, order, when };
}

/** `AddSeparator( aOrder )`. */
export function menuSeparator(order: number): ConditionalEntry {
  return { separator: true, order };
}

/**
 * `CONDITIONAL_MENU::Evaluate` — sort by order, drop the entries whose
 * condition is false, and drop every separator that has nothing in front of it.
 */
export function evaluateConditionalMenu(entries: readonly ConditionalEntry[]): MenuItem[] {
  const sorted = [...entries]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.order - b.e.order || a.i - b.i)
    .map(({ e }) => e);

  const out: MenuItem[] = [];
  let menuCount = 0;

  for (const entry of sorted) {
    if (entry.separator) {
      if (menuCount) out.push({ sep: true });
      menuCount = 0;
      continue;
    }
    if (entry.when === false || !entry.item) continue;
    out.push(entry.item);
    menuCount++;
  }

  return out;
}
