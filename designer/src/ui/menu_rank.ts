// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Ranked context menus, KiCad's `CONDITIONAL_MENU`.
 *
 * KiCad does not build a context menu in reading order. Every tool files its
 * entries under a rank (`AddItem`'s last argument) and the menu is the ranks
 * concatenated, with the separators declared as entries of their own —
 * so an entry's position is decided by the rank its tool chose, not by which
 * tool happened to run first. Ports that push items in source order end up with
 * menus that read almost right and are wrong in ways nobody can see until they
 * are held next to KiCad's.
 *
 * Two rules make the output match:
 *
 *   - `addEntry` inserts *after* everything of the same rank, so within a rank
 *     the order is the order the tools registered in. A stable sort reproduces
 *     that from insertion order.
 *   - a separator is emitted only when something was added since the last one
 *     (`CONDITIONAL_MENU::Evaluate`):
 *
 *         case ENTRY::SEPARATOR:
 *             if( menu_count ) AppendSeparator();
 *             menu_count = 0;
 *
 *     which is what collapses the gap a hidden block would otherwise leave —
 *     and why a menu whose middle conditions all fail has no double lines in it.
 */
import type { MenuItem } from './menu_types.js';

/** An entry and the rank it was filed under. */
export interface RankedItem {
  readonly order: number;
  readonly item: MenuItem;
}

/**
 * Concatenate `entries` by rank, inserting a separator at each rank in
 * `separators` that has something in front of it.
 *
 * A separator rank means "before the first entry of that rank or later", which
 * is where a declared `AddSeparator( n )` lands once the entries are sorted.
 */
export function assembleMenu(
  entries: readonly RankedItem[],
  separators: readonly number[],
): MenuItem[] {
  // Array.prototype.sort is stable, which is the whole point: within one rank
  // the entries must stay in the order they were added.
  const sorted = [...entries].sort((a, b) => a.order - b.order);
  const out: MenuItem[] = [];
  let since = 0;
  let next = 0;
  for (const { order, item } of sorted) {
    while (next < separators.length && separators[next]! <= order) {
      if (since > 0) {
        out.push({ sep: true });
        since = 0;
      }
      next++;
    }
    out.push(item);
    since++;
  }
  return out;
}
