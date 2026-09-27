// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `cvpcb/listbox_base.cpp` (`ITEMS_LISTBOX_BASE`, `cvpcb/listboxes.h`): what
 * the three panes share.
 */

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
