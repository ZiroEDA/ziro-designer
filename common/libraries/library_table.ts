// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LIBRARY_TABLE` (common/libraries/library_table.cpp), as far as it is ported:
 * the options column's `ParseOptions` / `FormatOptions`, which every library
 * table and DIALOG_PLUGIN_OPTIONS read and write. Moved here from
 * pcbnew/fp_lib_table.ts on 09-26; the rest of the class is still each
 * table's own.
 */

const OPT_SEP = '|';

/** ASCII `isspace`, the classification `ParseOptions` skips leading run with. */
const isSpace = (ch: string): boolean => ch === ' ' || (ch >= '\t' && ch <= '\r');

/**
 * `LIBRARY_TABLE::ParseOptions`: `a=1|b=2` into a map. Whitespace is skipped
 * only at the *start* of each pair, so `a = 1` gives the key `a ` and the value
 * ` 1`; a `\|` is an escaped separator; a pair with no `=` maps to the empty
 * string, which is how a valueless flag is recorded.
 */
export function parseLibraryTableOptions(optionsList: string): Map<string, string> {
  const props = new Map<string, string>();
  let cp = 0;
  const end = optionsList.length;

  while (cp < end) {
    let pair = '';

    while (cp < end && isSpace(optionsList[cp]!)) cp++;

    while (cp < end) {
      if (optionsList[cp] === '\\' && cp + 1 < end && optionsList[cp + 1] === OPT_SEP) {
        cp++;
        pair += optionsList[cp++];
      } else if (optionsList[cp] === OPT_SEP) {
        cp++;
        break;
      } else {
        pair += optionsList[cp++];
      }
    }

    if (pair.length === 0) continue;

    const eqNdx = pair.indexOf('=');

    if (eqNdx !== -1) props.set(pair.slice(0, eqNdx), pair.slice(eqNdx + 1));
    else props.set(pair, '');
  }

  return props;
}

/**
 * `LIBRARY_TABLE::FormatOptions`. Keys come out sorted because upstream walks a
 * `std::map`, and only the *value* has its separators escaped — a key
 * containing `|` is emitted raw and will not survive a re-parse.
 */
export function formatLibraryTableOptions(properties: ReadonlyMap<string, string>): string {
  let ret = '';

  for (const name of [...properties.keys()].sort()) {
    const value = properties.get(name)!;

    if (ret.length) ret += OPT_SEP;

    ret += name;

    if (value.length) {
      ret += '=';

      for (const ch of value) {
        if (ch === OPT_SEP) ret += '\\';
        ret += ch;
      }
    }
  }

  return ret;
}
