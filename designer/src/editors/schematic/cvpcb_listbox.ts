// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The three Assign Footprints panes, as pure functions over their rows.
 * Counterparts: `cvpcb/symbols_listbox.cpp`, `cvpcb/library_listbox.cpp` and
 * `cvpcb/footprints_listbox.cpp` (all three deriving from
 * `ITEMS_LISTBOX_BASE`, `cvpcb/listboxes.h`).
 *
 * Upstream keeps three near-identical listbox classes and the parts that are
 * *literally* identical - `OnChar`'s type-ahead is copied word for word into
 * all three files - are one function here, called from the one `VirtualList`
 * the dialog renders all three panes with. See `typeAheadRow`.
 *
 * These live outside the `.tsx` for the reason `nextUnassociated` does: a
 * closure inside a React component cannot be tested, and every rule in this
 * file is a rule about a list the user is looking at, which is exactly the
 * class of thing that silently drifts.
 */

import { PINNING_SYMBOL } from '../../widgets/lib_tree_model_adapter.js';
import { strNumCmp } from '@ziroeda/common/src/string_utils.js';

/**
 * `CVPCB_MAINFRAME::BuildLibrariesList` (cvpcb_mainframe.cpp:1005-1046) — the
 * "Footprint Libraries" pane's rows.
 *
 * Not the order the library table hands them over in, which is what this used
 * to show. Pinned libraries come first, each prefixed with
 * `LIB_TREE_MODEL_ADAPTER::GetPinningSymbol()`, then the rest; **both** groups
 * are sorted with `StrNumCmp( lhs, rhs, true )` - the comparator upstream
 * names "the same sorting algorithm as LIB_TREE_NODE::AssignIntrinsicRanks",
 * so the pane matches the order the symbol/footprint choosers use.
 *
 * The two `std::set`s also deduplicate, and a nickname that is somehow in both
 * the project's pinned list and the session's is inserted once.
 */
export function buildLibrariesList(
  nicknames: readonly string[],
  pinned: readonly string[] = [],
): string[] {
  const isPinned = new Set(pinned);
  const pinnedMatches = new Set<string>();
  const otherMatches = new Set<string>();

  for (const nickname of nicknames) {
    if (isPinned.has(nickname)) pinnedMatches.add(nickname);
    else otherMatches.add(nickname);
  }

  const sort = (set: Set<string>): string[] => [...set].sort((a, b) => strNumCmp(a, b, true));

  return [...sort(pinnedMatches).map((n) => PINNING_SYMBOL + n), ...sort(otherMatches)];
}

/**
 * `LIBRARY_LISTBOX::GetSelectedLibrary` (library_listbox.cpp:63-77) — the
 * nickname a row stands for, with the leading blank and the pinning mark taken
 * back off.
 */
export function selectedLibraryOf(row: string | undefined): string {
  if (!row) return '';
  const name = row.replace(/^\s+/, '');
  return name.startsWith(PINNING_SYMBOL) ? name.slice(PINNING_SYMBOL.length) : name;
}

/**
 * `FOOTPRINTS_LISTBOX::GetSelectedFootprint` (footprints_listbox.cpp:63-75) —
 * the `Lib:Footprint` half of a `"%3d Lib:Footprint"` row: trim, then
 * everything after the first space.
 */
export function rowFootprintId(row: string | undefined): string {
  if (!row) return '';
  const trimmed = row.trim();
  const at = trimmed.indexOf(' ');
  return at < 0 ? '' : trimmed.slice(at + 1);
}

/**
 * The "Filtered Footprints" selection after the list is rebuilt — which is
 * what a filter toggle, a keystroke in the search box, a library click and a
 * symbol click all do. `FOOTPRINTS_LISTBOX::SetFootprints`
 * (footprints_listbox.cpp:150-184) followed by its two callers'
 * identical tail, `CVPCB_MAINFRAME::OnSelectComponent`
 * (cvpcb_mainframe.cpp:478-497) and `onTextFilterChangedTimer` (`:448-476`):
 *
 *     m_footprintListBox->SetFootprints( … );
 *
 *     if( symbol && symbol->GetFPID().IsValid() )
 *         m_footprintListBox->SetSelectedFootprint( symbol->GetFPID() );
 *     else if( m_footprintListBox->GetSelection() >= 0 )
 *         m_footprintListBox->SetSelection( m_footprintListBox->GetSelection(), false );
 *
 * Three rules, in order, and we had none of them:
 *
 *  1. **The old row is remembered by its text, not its index.** `SetFootprints`
 *     records `m_footprintList[GetSelection()]` before the rebuild and restores
 *     it with `m_footprintList.Index( oldSelection )` after. Type one more
 *     character into the search box and the footprint you were looking at stays
 *     under the cursor if it survived the filter. We kept the row *number*, so
 *     the highlight jumped to whatever footprint had moved into that slot.
 *  2. **A row that did not survive falls back to row 0**, not to nothing.
 *  3. **A symbol with a footprint overrides both**, and a symbol *without* one
 *     leaves the pane with **nothing selected** - that is the `else if` branch,
 *     `Select( index, false )`, a deselect. It is why the real window shows an
 *     empty description line when you click an unassigned symbol, and why
 *     Enter does nothing until you have picked a footprint for it.
 *
 * `newList == m_footprintList` returns early, so a rebuild that changed nothing
 * skips rule 1 entirely and keeps the row it had; rules 2 and 3 still run.
 *
 * Known deliberate delta: `SetSelectedFootprint` compares `Item( i ).substr( 4 )`
 * against the FPID, which assumes the `"%3d "` prefix is exactly four
 * characters and therefore stops matching at row 1000 of a filtered list -
 * common here, where the hosted index holds fifteen thousand footprints. We
 * match on `GetSelectedFootprint`'s own rule (after the first space) instead,
 * which agrees with `substr( 4 )` for every row upstream gets right.
 */
export function footprintSelectionAfterRebuild(
  previous: readonly string[],
  previousSelected: number,
  next: readonly string[],
  symbolFootprint: string,
): number {
  let selection: number;

  if (rowsEqual(previous, next)) {
    // `if( newList == m_footprintList ) return;`
    selection = previousSelected;
  } else if (next.length === 0) {
    // `if( m_footprintList.GetCount() )` guards the SetSelection below it.
    selection = -1;
  } else {
    const old =
      previousSelected >= 0 && previousSelected < previous.length
        ? previous[previousSelected]!
        : '';
    const found = old ? next.indexOf(old) : -1;
    selection = found >= 0 ? found : 0;
  }

  if (symbolFootprint) {
    const want = symbolFootprint.toLowerCase();
    const at = next.findIndex((row) => rowFootprintId(row).toLowerCase() === want);
    return at >= 0 ? at : selection;
  }

  // `else if( GetSelection() >= 0 ) SetSelection( GetSelection(), false )`.
  return -1;
}

function rowsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((row, i) => row === b[i]);
}

/**
 * The type-ahead every pane has: a printable key jumps to the first row whose
 * name starts with it. `SYMBOLS_LISTBOX::OnChar` (symbols_listbox.cpp:137-186),
 * `FOOTPRINTS_LISTBOX::OnChar` (footprints_listbox.cpp:196-252) and
 * `LIBRARY_LISTBOX::OnChar` (library_listbox.cpp:132-181) are three copies of
 * this loop, character for character; this is the one copy.
 *
 *     text.Trim( false );                 // remove leading spaces in line
 *     for( ; jj < text.Len(); jj++ )      // skip line number
 *         if( text[jj] == ' ' ) break;
 *     for( ; jj < text.Len(); jj++ )      // skip blanks
 *         if( text[jj] != ' ' ) break;
 *     if( toupper( key ) == toupper( text[jj] ) ) { SetSelection( ii, true ); break; }
 *
 * So the character it matches on is the first one *after* the `"%3d "` line
 * number: `C` for symbol row `"  4       C1 - …"`, `C` for footprint row
 * `"  4 Capacitor_SMD:C_0805"`. It is not a prefix search and it does not
 * accumulate - each keystroke restarts from the top of the list.
 *
 * Home/End/Up/Down/PageUp/PageDown are `event.Skip()`ed to the list itself
 * before this runs; the caller keeps that split.
 *
 * **Upstream quirk, ported as-is:** a row with no space in it never matches,
 * because the first loop runs off the end and `text[jj]` is then the string's
 * terminator. Library rows are exactly that - `AppendLine` stores `" " + name`
 * and the trim takes the space back off - so type-ahead does nothing in the
 * "Footprint Libraries" pane of the real application either.
 */
export function typeAheadRow(rows: readonly string[], key: string): number | null {
  if (key.length !== 1) return null;
  const want = key.toUpperCase();

  for (let i = 0; i < rows.length; i++) {
    const text = rows[i]!.replace(/^\s+/, '');
    let jj = 0;
    while (jj < text.length && text[jj] !== ' ') jj++;
    while (jj < text.length && text[jj] === ' ') jj++;
    const startChar = text[jj];
    if (startChar !== undefined && startChar.toUpperCase() === want) return i;
  }

  return null;
}
