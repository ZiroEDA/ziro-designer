// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ReadHotKeyConfig` (common/hotkeys_basic.cpp), the reader behind
 * PANEL_HOTKEYS_EDITOR's "Import Hotkeys...".
 *
 *     file.ReadAll( &input );
 *     input.Replace( "\r\n", "\n" );  // Convert Windows files to Unix line-ends
 *     wxStringTokenizer fileTokenizer( input, "\n", wxTOKEN_STRTOK );
 *
 *     while( fileTokenizer.HasMoreTokens() )
 *     {
 *         wxStringTokenizer lineTokenizer( fileTokenizer.GetNextToken(), "\t" );
 *
 *         wxString cmdName   = lineTokenizer.GetNextToken();
 *         wxString primary   = lineTokenizer.GetNextToken();
 *         wxString secondary = lineTokenizer.GetNextToken();
 *
 *         if( !cmdName.IsEmpty() )
 *             aHotKeys[cmdName.ToStdString()] = { KeyCodeFromKeyName( primary ),
 *                                                 KeyCodeFromKeyName( secondary ) };
 *     }
 *
 * So the format is one command per line, tab-separated:
 *
 *     eeschema.InteractiveDrawing.drawWire<TAB>W<TAB>
 *
 * `wxTOKEN_STRTOK` is what a tab delimiter gets by default - wxTOKEN_DEFAULT is
 * STRTOK when the delimiters are whitespace, and a tab is whitespace - so empty
 * tokens are skipped rather than returned. A blank line is skipped for the same
 * reason, which is why upstream needs no comment or blank-line handling.
 *
 * Two things are ours rather than upstream's:
 *
 *   - Keys stay as their printed names. `KeyCodeFromKeyName` exists because
 *     wxWidgets binds integers; a browser binds `KeyboardEvent.key`, and the
 *     table already holds "Ctrl+S" rather than a keycode.
 *
 *   - The caller is told how many names matched. Upstream's `count()` check
 *     drops an unknown name silently, which it can afford because the file it
 *     reads was written by the same action names it is reading into. A file
 *     from a real KiCad names actions we do not have, and a button that
 *     silently does nothing is indistinguishable from a broken one.
 */

/** One line of the file: the command's name, its key, and its alternate. */
export interface ImportedHotkey {
  keys: string;
  alt: string;
}

/**
 * `ReadHotKeyConfig`'s parse, on the file's text.
 *
 * Returns a map keyed on the command name exactly as the file spells it; it is
 * the caller that decides which of those names it recognises.
 */
export function parseHotkeyFile(text: string): Map<string, ImportedHotkey> {
  const out = new Map<string, ImportedHotkey>();

  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    // wxTOKEN_STRTOK: empty tokens are skipped, so a command with no key and a
    // command with only an alternate cannot be told apart - upstream's reader
    // has the same blind spot, and writes both as trailing tabs.
    const parts = line.split('\t').filter((p) => p !== '');
    const cmdName = parts[0]?.trim() ?? '';
    if (cmdName === '') continue;

    out.set(cmdName, { keys: parts[1]?.trim() ?? '', alt: parts[2]?.trim() ?? '' });
  }

  return out;
}

/** What an import did, so the dialog can say so rather than appear inert. */
export interface ImportResult {
  /** The overrides to overlay, keyed the way HOTKEY_STORE keys its map. */
  overrides: Record<string, string | null>;
  /** How many of the file's lines named a command this app has. */
  matched: number;
  /** How many lines the file had. */
  total: number;
}

/**
 * `ImportHotKeys`'s overlay:
 *
 *     for( HOTKEY_SECTION& section: m_hotkeyStore.GetSections() )
 *         for( HOTKEY& hotkey: section.m_HotKeys )
 *             if( importedHotKeys.count( hotkey.m_Actions[0]->GetName() ) )
 *                 hotkey.m_EditKeycode = importedHotKeys[...].first;
 *
 * The store is walked and the file consulted, not the other way round, so a
 * name the file has and the app does not is ignored - and a command the file
 * omits keeps whatever it is bound to now, rather than being unbound.
 */
export function importOntoNames(
  file: ReadonlyMap<string, ImportedHotkey>,
  names: readonly string[],
): ImportResult {
  const overrides: Record<string, string | null> = {};
  let matched = 0;

  for (const name of names) {
    const hit = file.get(name);
    if (!hit) continue;
    matched++;
    // An empty key in the file is a command deliberately bound to nothing,
    // which is `null` here and an empty keycode upstream.
    overrides[name] = hit.keys === '' ? null : hit.keys;
  }

  return { overrides, matched, total: file.size };
}
