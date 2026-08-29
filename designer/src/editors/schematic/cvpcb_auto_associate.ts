// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Automatic footprint association from `.equ` files. Counterpart:
 * `cvpcb/auto_associate.cpp` (`GetQuotedText`, `sortListbyCmpValue`,
 * `CVPCB_MAINFRAME::buildEquivalenceList`, `CVPCB_MAINFRAME::
 * AutomaticFootprintMatching`), reading through `GetLine`
 * (`common/string_utils.cpp:803-816`).
 *
 * An equivalence file is a lookup table from a symbol **value** to a footprint
 * LIB_ID. The manual (eeschema.txt:4433-4460) gives the syntax:
 *
 *     '<symbol value>' '<footprint library>:<footprint name>'
 *
 * "Each name/value must be surrounded by single quotes ( ' ) and separated by
 * one or more spaces. Lines starting with # are comments." Both halves of that
 * sentence are `GetLine` plus `GetQuotedText` and neither is a tokenizer, which
 * is why the edge cases below are what they are.
 *
 * ## What the reader actually accepts
 *
 * `GetLine` (string_utils.cpp:803-816) drops a line whose **first byte** is
 * `#`, `\n`, `\r` or NUL, then `strtok( Line, "\n\r" )` truncates it at the
 * first carriage return or newline. So:
 *
 *  - `# 'A' 'B'` is a comment, but `<space># 'A' 'B'` is **not** — the `#` test
 *    is `Line[0]`, not a trimmed prefix, and a `#` anywhere else is ordinary
 *    text. An indented comment that happens to carry two quoted words is an
 *    equivalence.
 *  - the read is `fgets( Line, 1024, File )`, so a line longer than 1023 bytes
 *    is **split**: the tail is handed to the loop as a line of its own, and is
 *    re-tested against the `#` rule. {@link fgetsLines} reproduces that.
 *
 * `GetQuotedText` (auto_associate.cpp:53-68) then finds the first `'`, the
 * next `'` after it, returns what is between and advances the cursor past the
 * closing quote. Applied twice per line (`:145-153`), with an empty result on
 * either call skipping the line. Consequences, all of them upstream's:
 *
 *  - anything before, between or after the quoted pairs is ignored, so
 *    `junk 'A' junk 'B' junk` is a valid equivalence. There is no separator
 *    rule to violate; the manual's "one or more spaces" is a convention.
 *  - `''` is empty and skips the line, and so does a line with only one quoted
 *    word or an unterminated quote.
 *  - a third quoted word on the line is never read.
 *
 * Finally `value.Replace( " ", "_" )` (`:155`) turns every space in the *file's*
 * value into an underscore. The symbol's value is **not** put through it, so a
 * schematic value containing a space can never be matched by an `.equ` file —
 * an upstream oddity, faithfully kept.
 *
 * ## The order rule, where the manual and the source disagree
 *
 * The manual says (eeschema.txt:4446-4449) that Move Up / Move Down set a
 * priority and that "the footprint from the last matching equivalence file will
 * override earlier equivalence files". **10.0.5 does not do that**, and the
 * loop that would have to is right there at `auto_associate.cpp:211-273`:
 *
 *  - every file's entries are appended in list order (`:88-164`) and the whole
 *    list is sorted by value (`:184`); nothing is ever replaced or de-duped, so
 *    a value in two files produces two entries;
 *  - a value with more than one entry sets `equ_is_unique = false` (`:220-228`)
 *    for all of them, so the unique-match branch (`:231`) never fires;
 *  - the ambiguity is then resolved by the **symbol's footprint filters**
 *    (`:247-254`) — which is what upstream's own comment at `:205-208` says the
 *    duplicates are for ("so one can use multiple equivList for polar and
 *    non-polar caps for example");
 *  - and a symbol with NO footprint filters takes `found = ( filtercount == 0 )`
 *    (`:250`), i.e. it accepts the **first** entry of that value it reaches and
 *    breaks (`:267-272`). Not the last.
 *
 * So order matters in exactly one direction and it is the opposite of the
 * manual's: earlier wins. It is also only *weakly* defined upstream, because
 * `std::sort` is not stable — for a list of 16 entries or fewer libstdc++ runs
 * insertion sort alone and equal values keep their file order, but a longer
 * list is partitioned by quicksort first and the order among equal values is
 * unspecified. {@link sortEquivalences} therefore uses a **stable** sort, which
 * agrees with upstream wherever upstream is defined and is deterministic
 * everywhere else. Where the ambiguity is real, upstream's own answer is to add
 * footprint filters to the symbol, not to reorder the files.
 */

import { hasFootprintInfo } from '../../widgets/footprint_list.js';
import type { CvpcbComponent } from './cvpcb_components.js';
import { associateFootprint, footprintOf, type CvpcbAssociations } from './cvpcb_commands.js';

/** One line of a `.equ` file (`FOOTPRINT_EQUIVALENCE`, auto_associate.h:35-42). */
export interface FootprintEquivalence {
  /** `m_ComponentValue` — the symbol value, spaces already underscored. */
  value: string;
  /** `m_FootprintFPID` — "Library:Footprint". */
  footprint: string;
}

/**
 * `GetQuotedText` (auto_associate.cpp:53-68) — the text between the next pair
 * of single quotes, and the rest of the line after the closing one.
 *
 * `rest` is the caller's `text` **unchanged** when either quote is missing:
 * upstream only assigns `text = shrt.Mid( i + 1 )` on the success path
 * (`:66`), so a failed read leaves the cursor where it was. Nothing depends on
 * it — both call sites abandon the line on an empty result — but a port that
 * consumed the line on failure would be inventing behaviour.
 */
export function getQuotedText(text: string): { quoted: string; rest: string } {
  const i = text.indexOf("'");
  if (i < 0) return { quoted: '', rest: text };

  const shrt = text.slice(i + 1);
  const j = shrt.indexOf("'");
  if (j < 0) return { quoted: '', rest: text };

  return { quoted: shrt.slice(0, j), rest: shrt.slice(j + 1) };
}

/**
 * `fgets( Line, sizeof( Line ), File )` with `char line[1024]`
 * (auto_associate.cpp:82, `:139`) — the file cut into the buffers the read
 * loop actually sees.
 *
 * Each entry ends after a `\n` **or** at 1023 bytes, whichever comes first, and
 * keeps its terminator, because `GetLine` tests `Line[0]` against `\n` and
 * `\r` before `strtok` removes them. The limit is in bytes, not characters:
 * `fgets` counts bytes and `From_UTF8` decodes afterwards, so a split can land
 * inside a multi-byte character exactly as it does upstream.
 *
 * A file ending in a newline produces no trailing empty entry, because the next
 * `fgets` returns NULL rather than an empty string.
 */
export function fgetsLines(text: string, limit = 1023): string[] {
  const bytes = new TextEncoder().encode(text);
  const decoder = new TextDecoder();
  const out: string[] = [];
  let start = 0;

  while (start < bytes.length) {
    let end = start;
    while (end < bytes.length && end - start < limit && bytes[end] !== 0x0a) end++;
    // The newline belongs to the buffer fgets fills.
    if (end < bytes.length && end - start < limit && bytes[end] === 0x0a) end++;
    out.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }

  return out;
}

/**
 * One `.equ` file's equivalences, in file order — `buildEquivalenceList`'s
 * inner loop (auto_associate.cpp:139-161) over `GetLine`.
 */
export function parseEquivalenceFile(text: string): FootprintEquivalence[] {
  const out: FootprintEquivalence[] = [];

  for (const buffer of fgetsLines(text)) {
    // GetLine's `do … while( Line[0] == '#' || Line[0] == '\n' ||
    // Line[0] == '\r' || Line[0] == 0 )` — the comment and blank-line rule,
    // tested on the first character alone.
    const first = buffer.charAt(0);
    if (first === '#' || first === '\n' || first === '\r' || first === '') continue;

    // strtok( Line, "\n\r" ), then `if( *line == 0 ) continue;` (`:141`).
    const line = buffer.split(/[\n\r]/)[0] ?? '';
    if (line === '') continue;

    const value = getQuotedText(line);
    if (value.quoted === '') continue;

    const footprint = getQuotedText(value.rest);
    if (footprint.quoted === '') continue;

    out.push({
      // `value.Replace( wxT( " " ), wxT( "_" ) )` (`:155`).
      value: value.quoted.split(' ').join('_'),
      footprint: footprint.quoted,
    });
  }

  return out;
}

/** `_( "Equivalence file '%s' could not be found." )` (auto_associate.cpp:107). */
export function equFileNotFoundMessage(name: string): string {
  return `Equivalence file '${name}' could not be found.`;
}

/** `_( "Equivalence File Load Error" )` (auto_associate.cpp:180). */
export const EQU_LOAD_ERROR_TITLE = 'Equivalence File Load Error';

/** `_( "CvPcb Warning" )` (auto_associate.cpp:300). */
export const CVPCB_WARNING_TITLE = 'CvPcb Warning';

/**
 * `CVPCB_MAINFRAME::buildEquivalenceList` (auto_associate.cpp:79-167) — every
 * equivalence of every file the project lists, in list order, with the errors
 * upstream collects rather than throws.
 *
 * `read` stands in for the SEARCH_STACK lookup at `:91-118`: it answers the
 * file's text, or null for "no such file", and a null adds
 * {@link equFileNotFoundMessage} to `errors`. The messages are joined with a
 * blank line (`\n\n`, `:110-114`) by the caller.
 *
 * The name in the message is `fn.GetFullName()` — the **base name**, not the
 * path that was looked up.
 */
export function buildEquivalenceList(
  files: readonly string[],
  read: (name: string) => string | null,
): { list: FootprintEquivalence[]; errors: string[] } {
  const list: FootprintEquivalence[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const text = read(file);
    if (text === null) {
      errors.push(equFileNotFoundMessage(file.split(/[\\/]/).pop() ?? file));
      continue;
    }
    list.push(...parseEquivalenceFile(text));
  }

  return { list, errors };
}

/**
 * `std::sort( …, sortListbyCmpValue )` (auto_associate.cpp:73-76, `:184`) —
 * by value **descending**, `wxString::Cmp` being a plain code-unit comparison.
 *
 * Stable, deliberately: see the module header. Sorting at all is not cosmetic —
 * the duplicate test at `:224-228` only looks at the two neighbours, so it is
 * the sort that makes "this value appears more than once" visible.
 */
export function sortEquivalences(list: readonly FootprintEquivalence[]): FootprintEquivalence[] {
  return [...list].sort((a, b) => (a.value < b.value ? 1 : a.value > b.value ? -1 : 0));
}

/**
 * `wxString::Matches` — the whole string against a mask of `*` (any run) and
 * `?` (any one character), **case sensitively**.
 *
 * Not the pane's footprint filter. `FOOTPRINT_FILTER` scores through
 * EDA_COMBINED_MATCHER, which folds case and will fall back to a substring
 * match; `:253` calls `wxString::Matches` directly, which does neither. The
 * same `fp_filters` glob can therefore offer a footprint in the right-hand pane
 * and decline to disambiguate it here.
 */
export function matchesWildcard(text: string, mask: string): boolean {
  const escaped = mask
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '.')
    .replace(/\*/g, '.*');
  try {
    return new RegExp(`^${escaped}$`).test(text);
  } catch {
    return false;
  }
}

/** `_( "%lu footprint/symbol equivalences found." )` (auto_associate.cpp:187). */
export function equivalencesFoundMessage(count: number): string {
  return `${count} footprint/symbol equivalences found.`;
}

/** `_( "Component %s: footprint %s not found in any of the project footprint
 *  libraries." )` (auto_associate.cpp:257-259). */
export function footprintNotFoundMessage(reference: string, fpid: string): string {
  return `Component ${reference}: footprint ${fpid} not found in any of the project footprint libraries.`;
}

/** What {@link automaticFootprintMatching} leaves behind. */
export interface AutoAssociateResult {
  state: CvpcbAssociations;
  /**
   * The text status field 0 is left showing, or null when nothing was written
   * there at all.
   *
   * Two ways to get null, and they are different states rather than one:
   * `AutomaticFootprintMatching` returns at `:176-177` on an empty netlist
   * **before** `SetStatusText`, and every `AssociateFootprint` ends in
   * `DisplayStatus()` (cvpcb_mainframe.cpp:674), which rewrites field 0 with
   * the filter line (`:850`). So the equivalences count survives on screen
   * only when the run associated nothing — which is exactly the case a project
   * with no `.equ` file is in.
   */
  status: string | null;
  /** The `_( "CvPcb Warning" )` box's body, or '' for no box (`:299-300`). */
  warning: string;
}

/**
 * `CVPCB_MAINFRAME::AutomaticFootprintMatching` (auto_associate.cpp:170-304).
 *
 * The match is on the symbol's **value**, case-insensitively (`CmpNoCase`,
 * `:215`), and the four ways a symbol ends up with a footprint are, in the
 * order they are tried:
 *
 *  1. the value has exactly one entry in the list and that footprint exists —
 *     no ambiguity, take it (`:231-237`);
 *  2. the value has several entries: the first one whose footprint exists
 *     **and** matches one of the symbol's `fp_filters` (`:247-272`) — with no
 *     filters at all, `found` starts true and the first existing footprint
 *     wins;
 *  3. failing that, `fpid_candidate`, the first existing footprint of that
 *     value, whatever the filters said (`:279-284`);
 *  4. failing even that, and only when the symbol has **exactly one**
 *     footprint filter, the filter itself read as an FPID (`:287-296`).
 *
 * A symbol that already has a footprint is skipped entirely (`:202-203`) — the
 * manual says so too (eeschema.txt:4467-4469, "symbols that already have
 * footprints assigned will not be updated"). "Already has" is read from the
 * live netlist, so an assignment made earlier in this session counts.
 *
 * `firstAssoc` is `AssociateFootprint`'s `aNewEntry` (`:194`, `:233`), false
 * from the second association on, so the **whole run is one undo entry**: a
 * mis-aimed auto-assign is one Ctrl+Z, not one per symbol.
 *
 * Every equivalence whose footprint is missing from the libraries adds a line
 * to the warning box (`:255-265`) — once per (symbol, equivalence) pair, so a
 * value listed in three files with three missing footprints reports three
 * lines against the same symbol.
 */
export function automaticFootprintMatching(
  state: CvpcbAssociations,
  components: readonly CvpcbComponent[],
  equivList: readonly FootprintEquivalence[],
  known: ReadonlySet<string>,
): AutoAssociateResult {
  // `if( m_netlist.IsEmpty() ) return;` — before the status text is written.
  if (components.length === 0) return { state, status: null, warning: '' };

  /** `m_FootprintsList->GetFootprintInfo( … )->GetFootprintName()`, or null. */
  const footprintName = (fpid: string): string | null =>
    hasFootprintInfo(known, fpid) ? fpid.slice(fpid.indexOf(':') + 1) : null;

  let next = state;
  let firstAssoc = true;
  let associated = 0;
  const errors: string[] = [];

  const associate = (index: number, fpid: string): void => {
    next = associateFootprint(next, components, index, fpid, firstAssoc);
    firstAssoc = false;
    associated++;
  };

  for (let kk = 0; kk < components.length; kk++) {
    const component = components[kk];
    if (!component) continue;

    let found = false;

    // "the component has already a footprint"
    if (footprintOf(next, component) !== '') continue;

    let fpidCandidate = '';

    for (let idx = 0; idx < equivList.length; idx++) {
      const equivItem = equivList[idx];
      if (!equivItem) continue;
      if (equivItem.value.toLowerCase() !== component.value.toLowerCase()) continue;

      const fp = footprintName(equivItem.footprint);

      let equIsUnique = true;
      if (idx + 1 < equivList.length && equivItem.value === equivList[idx + 1]?.value)
        equIsUnique = false;
      if (idx - 1 >= 0 && equivItem.value === equivList[idx - 1]?.value) equIsUnique = false;

      // "If the equivalence is unique, no ambiguity: use the association"
      if (fp !== null && equIsUnique) {
        associate(kk, equivItem.footprint);
        found = true;
        break;
      }

      // "Store the first candidate found in list, when equivalence is not unique"
      if (fp !== null && fpidCandidate === '') fpidCandidate = equivItem.footprint;

      if (fp !== null) {
        const filters = component.fpFilters;
        found = filters.length === 0; // "if no entries, do not filter"
        for (let jj = 0; jj < filters.length && !found; jj++)
          found = matchesWildcard(fp, filters[jj] ?? '');
      } else {
        errors.push(footprintNotFoundMessage(component.reference, equivItem.footprint));
      }

      if (found) {
        associate(kk, equivItem.footprint);
        break;
      }
    }

    if (found) continue;

    if (fpidCandidate !== '') {
      associate(kk, fpidCandidate);
      continue;
    }

    // "obviously the last chance: there's only one filter matching one footprint"
    if (component.fpFilters.length === 1) {
      const only = component.fpFilters[0] ?? '';
      if (footprintName(only) !== null) associate(kk, only);
    }
  }

  return {
    state: next,
    status: associated > 0 ? null : equivalencesFoundMessage(equivList.length),
    warning: errors.join('\n\n'),
  };
}
