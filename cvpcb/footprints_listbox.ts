// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `cvpcb/footprints_listbox.cpp` (`FOOTPRINTS_LISTBOX`).
 */

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
