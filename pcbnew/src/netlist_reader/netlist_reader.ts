// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The front door of "Import Netlist": sniff a netlist file's dialect, read the
 * two line-oriented dialects, and fold a CvPcb `.cmp` footprint-link file over
 * the result. Counterparts: `pcbnew/netlist_reader/netlist_reader.cpp`
 * (NETLIST_READER::GuessNetlistFileType, NETLIST_READER::GetNetlistReader,
 * CMP_READER::Load) and `pcbnew/netlist_reader/legacy_netlist_reader.cpp`
 * (LEGACY_NETLIST_READER). The s-expression dialect is parsed by
 * {@link parseKicadNetlist} in `kicad_netlist_reader.ts`; everything here is the
 * pre-s-expression world that KiCad still accepts.
 *
 * ## Why this is written against raw lines and not a tokeniser
 *
 * The legacy and OrcadPCB2 dialects are not s-expressions even though they are
 * full of parentheses: upstream only ever looks at the *first character* of a
 * trimmed line to decide what it is, and counts nesting from that one character.
 * `(    1 VCC )` therefore counts as one level *deeper*, never as balanced, and
 * a stray `)` inside a value can never unbalance anything. Handing these files
 * to a real s-expression parser changes which lines are components and which are
 * pins, so the line-and-first-character state machine is the specification here,
 * not an implementation detail.
 *
 * ## Upstream behaviour reproduced deliberately, including the bugs
 *
 * - A `{ … }` comment that opens *and closes* on one line leaves the reader in
 *   "comment in progress" state anyway (`LoadNetlist` sets `is_comment = true`
 *   and never clears it on that path), so everything up to the next `}` is
 *   swallowed. Real files close the footprint-filter block with a lone `}`,
 *   which is exactly what makes this survive in the wild.
 * - `loadFootprintFilters` ends the section on `strncasecmp( line,
 *   "$endfootprintlist", 4 )` — four characters. Any `$end…` line that is not
 *   `$endlist` closes it.
 * - Every footprint-filter line has its first character dropped (`line + 1`),
 *   because upstream assumes the one-space indent the exporter writes.
 * - `CMP_READER::Load` matches `IdModule  =` with two spaces, so a hand-tidied
 *   `.cmp` file silently assigns no footprint — and an entry with no `IdModule`
 *   at all *clears* the assignment rather than leaving it alone.
 * - Upstream throws "Invalid footprint ID" when `LIB_ID::Parse( fp, true )`
 *   returns >= 0. With `aFix` set that call cannot fail: the only error path is
 *   a library nickname containing ':', and the nickname is by construction the
 *   text before the first ':'. The throw is unreachable, so this port has no
 *   equivalent rather than inventing a validity rule upstream does not enforce.
 *
 * ## Where malformed input stops the read
 *
 * Missing words in a legacy component or pin line throw (upstream
 * THROW_PARSE_ERROR); everything else is absorbed. A duplicate reference
 * designator is *not* rejected — both components are added and every later
 * lookup by reference resolves to the first, so the second gets no nets. A pin
 * naming a component that does not exist is skipped in silence, because DNP and
 * "exclude from board" symbols legitimately appear in nets but not in the
 * component list.
 */

import { kiidFromString, kiidPathAsString } from '@ziroeda/common/src/kiid.js';
import { COMPONENT, NETLIST } from './pcb_netlist.js';
import { parseKicadNetlist } from './kicad_netlist_reader.js';
import { parse } from '@ziroeda/sexpr/src/parser.js';

/** NETLIST_READER::NETLIST_FILE_T. */
export type NetlistFileType = 'unknown' | 'orcad' | 'legacy' | 'kicad';

/** THROW_PARSE_ERROR: the netlist is not readable and the import must stop. */
export class NetlistParseError extends Error {
  constructor(
    message: string,
    /** 1-based line number, as LINE_READER::LineNumber() reports it. */
    readonly lineNumber: number,
  ) {
    super(`${message} (line ${lineNumber})`);
    this.name = 'NetlistParseError';
  }
}

/**
 * FILE_LINE_READER::ReadLine: each line keeps its trailing newline, and reading
 * stops at end of file. A file ending in a newline yields no extra empty line,
 * while a file whose last line is unterminated still yields it. The retained
 * newline matters — the filter and `.cmp` readers slice raw lines by index and
 * lean on a trailing trim to remove it.
 */
function readLines(text: string): string[] {
  const lines: string[] = [];

  for (let start = 0; start < text.length; ) {
    const nl = text.indexOf('\n', start);
    const end = nl === -1 ? text.length : nl + 1;
    lines.push(text.slice(start, end));
    start = end;
  }

  return lines;
}

/** The whitespace StrPurge and wxString::Trim strip; deliberately not   et al. */
const WHITESPACE = ' \t\n\r\f\v';

/** StrPurge: drop leading and trailing whitespace, in place upstream. */
function strPurge(text: string): string {
  let begin = 0;
  let end = text.length;

  while (begin < end && WHITESPACE.includes(text[begin]!)) begin++;
  while (end > begin && WHITESPACE.includes(text[end - 1]!)) end--;

  return text.slice(begin, end);
}

/** wxString::Trim( true ) + Trim( false ), the two-sided trim upstream spells out. */
const trimBothEnds = (text: string): string => strPurge(text);

/**
 * strtok( …, " ()\t\n" ): split into words on space, tab, newline and *both*
 * parentheses, discarding empties. Carriage return is not a delimiter upstream
 * and is not one here either — the callers purge the line first, which is what
 * keeps CRLF files working.
 */
function strTok(text: string): string[] {
  return text.split(/[ ()\t\n]+/).filter((word) => word !== '');
}

/** wxString::AfterFirst: empty when the character is absent. */
function afterFirst(text: string, ch: string): string {
  const i = text.indexOf(ch);
  return i === -1 ? '' : text.slice(i + 1);
}

/** wxString::BeforeLast: empty when the character is absent. */
function beforeLast(text: string, ch: string): string {
  const i = text.lastIndexOf(ch);
  return i === -1 ? '' : text.slice(0, i);
}

/** strncasecmp( line, prefix, prefix.length ) == 0, ASCII-cased like the C call. */
function startsWithNoCase(line: string, prefix: string): boolean {
  return line.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
}

/**
 * NETLIST_READER::GuessNetlistFileType. Every line is tested until one dialect
 * matches, so a leading comment or blank does not defeat detection, and the
 * legacy header wins over the other two when a line somehow matches more than
 * one. The patterns search anywhere in the line rather than anchoring at its
 * start, which is why an indented `(export` is still recognised.
 */
export function guessNetlistFileType(text: string): NetlistFileType {
  // Our legacy netlist format starts by "# EESchema Netlist ".
  const reLegacy = /#[ \t]+EESchema[ \t]+Netlist[ \t]+/i;
  // Our new netlist format starts by "(export (version ". Case sensitive upstream.
  const reKicad = /[ ]*\(export(\s+\(version)?/;
  // OrcadPCB2 starts by "( {", followed by a comment that varies by tool.
  const reOrcad = /[ ]*\([ \t]+\{+/i;

  for (const line of readLines(text)) {
    if (reLegacy.test(line)) return 'legacy';
    if (reKicad.test(line)) return 'kicad';
    if (reOrcad.test(line)) return 'orcad';
  }

  return 'unknown';
}

/**
 * `KIID_PATH( text ).AsString()`: split on '/', drop the empty steps, and put
 * each step through KIID's string constructor. A legacy netlist writes the old
 * eight-digit timestamps (`/32568D1E`), which only become comparable with the
 * board's `(path …)` once expanded to the UUID they stand for — the board
 * updater matches a component to a footprint by comparing those strings, so
 * keeping the file's text here would leave every legacy import unmatchable.
 *
 * The one departure from `AsString()` is the empty path: it returns `""`
 * upstream and `"/"` here, because `"/"` is what the s-expression reader stores
 * for a root-sheet component and both readers feed the same model.
 */
function legacyKiidPath(text: string): string {
  return kiidPathAsString(text.split('/').filter(Boolean).map(kiidFromString));
}

/**
 * LEGACY_NETLIST_READER::loadComponent. One line such as
 * `( /68183921-93a5-49ac-91b0-49d05a0e1647 $noname R20 4.7K {Lib=R}`, read as
 * five whitespace-or-parenthesis separated words: symbol path, footprint name,
 * reference, value and an optional `{Lib=…}` comment. The first four are
 * mandatory; a missing one aborts the whole import. Unlike the s-expression
 * dialect, the path here already ends at the symbol itself, which is why the
 * component gets no unit UUIDs of its own.
 *
 * `$noname` is the exporter's placeholder for "no footprint yet" and becomes an
 * empty FPID, to be filled in later from the `.cmp` file.
 */
function loadLegacyComponent(netlist: NETLIST, text: string, lineNumber: number): COMPONENT {
  // strncpy into char[1024]; a longer line is silently truncated.
  const words = strTok(text.slice(0, 1023));

  const need = (index: number, message: string): string => {
    const word = words[index];
    if (word === undefined) throw new NetlistParseError(message, lineNumber);
    return word;
  };

  const path = legacyKiidPath(need(0, 'Cannot parse time stamp in symbol section of netlist.'));
  const footprintWord = need(1, 'Cannot parse footprint name in symbol section of netlist.');
  const reference = need(2, 'Cannot parse reference designator in symbol section of netlist.');
  const value = need(3, 'Cannot parse value in symbol section of netlist.');

  // The footprint name will have to be looked up in the *.cmp file.
  const footprintName = footprintWord === '$noname' ? '' : footprintWord;

  // The fifth word is `{Lib=C}`, an optional comment. Both wxString accessors
  // return empty when their character is missing, so `{Lib=R` yields no name.
  const nameWord = words[4];
  const name = nameWord === undefined ? '' : beforeLast(afterFirst(nameWord, '='), '}');

  // LIB_ID::SetLibItemName only: the legacy format has no library nickname.
  const component = new COMPONENT(footprintName, reference, value, path, []);
  component.SetName(name);
  netlist.AddComponent(component);

  return component;
}

/**
 * LEGACY_NETLIST_READER::loadNet. One line such as `(    1 VCC )` read as pin
 * number then net name; `?` in the first position of the net name is the
 * exporter's "this pin is unconnected" marker and becomes an empty net.
 */
function loadLegacyNet(component: COMPONENT, text: string, lineNumber: number): void {
  // strncpy into char[256] with an explicit terminator at [255].
  const words = strTok(text.slice(0, 255));

  const pinName = words[0];

  if (pinName === undefined) {
    throw new NetlistParseError(
      'Cannot parse pin name in symbol net section of netlist.',
      lineNumber,
    );
  }

  const netWord = words[1];

  if (netWord === undefined) {
    throw new NetlistParseError(
      'Cannot parse net name in symbol net section of netlist.',
      lineNumber,
    );
  }

  const netName = netWord.startsWith('?') ? '' : netWord;

  component.AddNet(pinName, netName, '', '');
}

/**
 * LEGACY_NETLIST_READER::loadFootprintFilters, the `{ Allowed footprints …`
 * block. Filters accumulate until `$endlist` hands them to the component named
 * by the most recent `$component`; the section ends at any `$end…` line that is
 * not `$endlist`, because upstream compares only four characters of
 * `$endfootprintlist`.
 *
 * Lines here are *not* purged, and a filter line loses its first character to
 * `line + 1` — upstream is peeling off the single space the exporter indents
 * with, so an unindented filter comes back with its first character missing.
 *
 * Returns the index of the line after the section.
 */
function loadFootprintFilters(netlist: NETLIST, lines: string[], from: number): number {
  let filters: string[] = [];
  let component: COMPONENT | null = null;
  let i = from;

  for (; i < lines.length; i++) {
    const line = lines[i]!;

    if (startsWithNoCase(line, '$endlist')) {
      // End of list for the current component. Upstream only wxASSERTs here, so
      // a stray $endlist is a crash there; refusing the file is the closest we
      // can get without inventing a recovery upstream does not have.
      if (!component) {
        throw new NetlistParseError(
          'Footprint filter list ended before any symbol was named.',
          i + 1,
        );
      }

      component.SetFootprintFilters(filters);
      component = null;
      filters = [];
      continue;
    }

    // strncasecmp( line, "$endfootprintlist", 4 ): four characters only.
    if (startsWithNoCase(line, '$end')) return i + 1;

    if (startsWithNoCase(line, '$component')) {
      // New component reference found; skip "$component " and trim.
      const cmpRef = trimBothEnds(line.slice(11));

      component = netlist.GetComponentByReference(cmpRef);

      // Cannot happen if the netlist is valid.
      if (component === null) {
        throw new NetlistParseError(
          `Cannot find symbol ${cmpRef} in footprint filter section of netlist.`,
          i + 1,
        );
      }
    } else {
      // Add new filter to list, less the exporter's one-character indent.
      filters.push(trimBothEnds(line.slice(1)));
    }
  }

  // Ran off the end without $endfootprintlist: the pending filters are dropped,
  // exactly as upstream drops them when its read loop runs out of lines.
  return i;
}

/** Options mirroring NETLIST_READER's m_loadFootprintFilters flag. */
export interface LegacyNetlistOptions {
  /** Read the `{ Allowed footprints …` block. NETLIST_READER sets this true. */
  loadFootprintFilters?: boolean;
}

/**
 * LEGACY_NETLIST_READER::LoadNetlist, the KiCad legacy and OrcadPCB2 formats.
 *
 * The nesting counter only ever sees the first character of a purged line, and
 * a pin line both increments it (it starts with `(`) and decrements it again
 * once consumed. So the levels are: 1 = inside the file's opening `(`, 2 = a
 * component header, 3 = one pin of that component. A line whose first character
 * is neither parenthesis — including the `}` a comment resolves to — leaves the
 * counter alone and is skipped.
 */
export function loadLegacyNetlist(
  text: string,
  netlist: NETLIST,
  options: LegacyNetlistOptions = {},
): void {
  const loadFilters = options.loadFootprintFilters ?? true;
  const lines = readLines(text);

  let state = 0;
  let isComment = false;
  let component: COMPONENT | null = null;

  for (let i = 0; i < lines.length; i++) {
    let line = strPurge(lines[i]!);

    if (isComment) {
      // Test for end of the current comment.
      const close = line.indexOf('}');
      if (close === -1) continue;

      line = line.slice(close);
      isComment = false;
    }

    if (line.startsWith('{')) {
      // Start Comment or Pcbnew info section.
      isComment = true;

      if (loadFilters && state === 0 && startsWithNoCase(line, '{ Allowed footprints')) {
        // Note that isComment stays set: the block's closing `}` is a line of
        // its own and is consumed by the branch above on the next iteration.
        i = loadFootprintFilters(netlist, lines, i + 1) - 1;
        continue;
      }

      const close = line.indexOf('}');
      if (close === -1) continue;

      // Upstream does not clear isComment here even though the comment closed on
      // this line, so the next `}` in the file is treated as this one's end.
      line = line.slice(close);
    }

    if (line.startsWith('(')) state++;
    if (line.startsWith(')')) state--;

    if (state === 2) {
      component = loadLegacyComponent(netlist, line, i + 1);
      continue;
    }

    if (state >= 3) {
      // Pad descriptions are read here. Reaching this without a component means
      // the file skipped the header line, which upstream only wxASSERTs.
      if (!component) {
        throw new NetlistParseError('Pin description found before any symbol.', i + 1);
      }

      loadLegacyNet(component, line, i + 1);
      state--;
    }
  }
}

/**
 * CMP_READER::Load, the CvPcb `.cmp` footprint-link file:
 *
 *     BeginCmp
 *     TimeStamp = /32307DE2/AA450F67;
 *     Reference = C1;
 *     ValeurCmp = 47uF;
 *     IdModule  = CP6;
 *     EndCmp
 *
 * Each field's value is whatever sits between the first `=` and the last `;`.
 * `TimeStamp` is read and discarded upstream — components are matched by
 * reference designator only — so it is not read at all here.
 *
 * When the netlist already carries a *different*, non-empty footprint for the
 * component, that one is kept as the alternate FPID so CvPcb can offer the user
 * the choice; the `.cmp` value always wins the primary slot, including when it
 * is empty.
 *
 * @returns false if any reference in the file is absent from the netlist, which
 *   is the normal case for a symbol deleted from the schematic and is reported
 *   as a warning rather than an error.
 */
export function loadCmpFootprintLinks(text: string, netlist: NETLIST): boolean {
  const lines = readLines(text);
  let ok = true;

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.startsWith('BeginCmp')) continue;

    // Begin component description.
    let reference = '';
    let footprint = '';

    for (i++; i < lines.length; i++) {
      const buffer = lines[i]!;

      if (buffer.startsWith('EndCmp')) break;

      // Store string value, stored between '=' and ';' delimiters.
      const value = trimBothEnds(beforeLast(afterFirst(buffer, '='), ';'));

      if (buffer.startsWith('Reference')) reference = value;
      else if (buffer.startsWith('IdModule  =')) footprint = value;
    }

    // Find the corresponding item in component list.
    const component = netlist.GetComponentByReference(reference);

    // The corresponding component could no longer exist in the netlist. This
    // happens when it is removed from the schematic and still exists in the
    // footprint assignment list, which is usual during the life of a design.
    if (!component) {
      ok = false;
      continue;
    }

    // For checking purposes, keep the existing FPID in the alternate copy when
    // it differs from the one read from the .cmp file.
    if (footprint !== component.GetFPID() && component.GetFPID() !== '') {
      component.SetAltFPID(component.GetFPID());
    }

    component.SetFPID(footprint);
  }

  return ok;
}

/** Everything NETLIST_READER::GetNetlistReader needs to pick and drive a reader. */
export interface LoadNetlistOptions extends LegacyNetlistOptions {
  /** Contents of the CvPcb `.cmp` footprint link file, when one was given. */
  cmpText?: string;
}

/** What the import produced, alongside the dialect that was detected. */
export interface LoadNetlistResult {
  netlist: NETLIST;
  type: NetlistFileType;
  /**
   * CMP_READER::Load's return: false when the `.cmp` file names a reference the
   * netlist does not have. True when no `.cmp` file was supplied.
   */
  allLinksFound: boolean;
}

/**
 * NETLIST_READER::GetNetlistReader followed by LoadNetlist: detect the dialect,
 * read it, then apply the footprint links.
 *
 * The s-expression path sorts each component's pins by pin name once the links
 * are applied, so a dump of it compares against a legacy dump — upstream does
 * this only when a `.cmp` file is present, and so does this.
 *
 * @returns null for an unrecognised format, matching the null reader upstream
 *   returns, which the dialog turns into "not a valid netlist file".
 */
export function loadNetlist(
  text: string,
  options: LoadNetlistOptions = {},
): LoadNetlistResult | null {
  const type = guessNetlistFileType(text);
  const netlist = new NETLIST();
  let allLinksFound = true;

  switch (type) {
    case 'legacy':
    case 'orcad':
      loadLegacyNetlist(text, netlist, options);

      if (options.cmpText !== undefined) {
        allLinksFound = loadCmpFootprintLinks(options.cmpText, netlist);
      }

      break;

    case 'kicad':
      parseKicadNetlist(parse(text), netlist);

      if (options.cmpText !== undefined) {
        allLinksFound = loadCmpFootprintLinks(options.cmpText, netlist);

        // Sort the component pins so they are in the same order as the legacy
        // format, which makes the two dumps comparable.
        for (const component of netlist.Components()) component.SortPins();
      }

      break;

    default:
      return null;
  }

  return { netlist, type, allLinksFound };
}
