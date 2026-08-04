// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Previous / Next Marker. Counterpart: `RC_TREE_MODEL::PrevMarker` and
 * `NextMarker` (common/rc_item.cpp), driven by `SCH_INSPECTION_TOOL::PrevMarker`
 * / `NextMarker`, which raise the ERC dialog and step its tree.
 *
 * The list walked is the *displayed* one — the tree holds the markers that
 * survive the dialog's filters, so stepping skips whatever is filtered out
 * rather than selecting a row nobody can see.
 *
 * Three behaviours here are deliberate and are what the tests pin, because
 * each is the kind of thing "improved" by accident:
 *
 *  - **neither direction wraps.** At the last marker `nextMarker` stays null
 *    and the selection simply holds; the same at the first going back. The
 *    loops in `rc_item.cpp` can only ever assign a candidate they have already
 *    passed, so there is no path back to the other end;
 *  - **with nothing selected the two directions disagree.** Next selects the
 *    *first* marker (`trigger` starts true when there is no current node),
 *    Prev selects the *last* (the loop never breaks, so `prevMarker` ends up
 *    holding the final candidate). That asymmetry is not a bug to smooth over;
 *  - **a selected child row counts as its marker.** `while( currentNode &&
 *    m_Type != MARKER ) currentNode = m_Parent` walks up first, so stepping
 *    from a violation's detail line moves to the next *marker*, not the next
 *    line.
 */

/**
 * The next marker after `current`, or null to leave the selection alone.
 *
 * `order` is the displayed markers, identified however the caller identifies
 * them; `current` is the one selected now, or null for no selection.
 */
export function nextMarker<T>(order: readonly T[], current: T | null | undefined): T | null {
  if (current === null || current === undefined) return order[0] ?? null;
  const at = order.indexOf(current);
  // A selected marker that is no longer displayed (filtered out from under the
  // selection) stops Next dead: `trigger` starts false and nothing in the tree
  // ever matches, so no candidate is taken. Prev, walking the other way, ends
  // up on the last one instead — the same asymmetry as the empty selection.
  if (at < 0) return null;
  return order[at + 1] ?? null;
}

/** The marker before `current`, or null to leave the selection alone. */
export function prevMarker<T>(order: readonly T[], current: T | null | undefined): T | null {
  if (current === null || current === undefined) return order[order.length - 1] ?? null;
  const at = order.indexOf(current);
  if (at < 0) return order[order.length - 1] ?? null;
  return at === 0 ? null : (order[at - 1] ?? null);
}
