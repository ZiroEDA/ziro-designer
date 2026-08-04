// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every board footprint against the library it came from.
 * Counterpart: `DRC_TEST_PROVIDER_LIBRARY_PARITY::Run` in
 * `pcbnew/drc/drc_test_provider_library_parity.cpp`, reached through
 * `FOOTPRINT_LIBRARY_ADAPTER` / `LIBRARY_MANAGER_ADAPTER`.
 *
 * Two codes, and the split is the whole point. `lib_footprint_issues` says the
 * library could not be consulted — the nickname is not configured, the library
 * is off, the footprint is not in it. `lib_footprint_mismatch` says the library
 * *was* consulted and the board's copy has drifted from it. The first is a setup
 * problem, the second a design one, and Board Setup gives them separate
 * severities so a house that vendors its libraries can demote one without
 * losing the other.
 *
 * The comparison itself is {@link footprintNeedsUpdate} in `footprint_diff.ts`,
 * in `drc` mode. Nothing here re-implements it.
 *
 * ## "Loaded" means the whole library parsed, not that the directory exists
 *
 * Upstream's load status is set by `FOOTPRINT_LIBRARY_ADAPTER::LoadOne`, which
 * calls `FootprintEnumerate( …, aBestEfforts = false )` and records
 * `LOAD_ERROR` if it throws. `FootprintEnumerate` throws when *any* file in the
 * directory failed to parse, even though it also returns the ones that did. So
 * a single corrupt `.kicad_mod` marks the entire library unloaded, and every
 * footprint drawn from it is then reported as "not enabled in the current
 * configuration" — not as a parse failure, and never as a mismatch. Surprising,
 * and reproduced: {@link FootprintLibrary.errorDescription} is exactly that
 * accumulated failure list.
 *
 * ## The third message can never be printed
 *
 * `Run()` tests `!HasLibrary( lib, true )` and then `!IsLibraryLoaded( lib )`.
 * `HasLibrary( lib, true )` is `fetchIfLoaded( lib ).has_value() && !disabled`,
 * and `fetchIfLoaded` yields a value under precisely the condition
 * `IsLibraryLoaded` reports. Reaching the second test therefore requires the
 * library to be loaded, which makes the test false every time — "The footprint
 * library '%s' was not found at '%s'" is unreachable, and an unreadable library
 * is announced by the *previous* branch as though the user had switched it off.
 * The branch is kept, dead, because deleting it would be a repair rather than a
 * port.
 *
 * ## Reading a library costs a directory scan, so it happens once
 *
 * Upstream loads each library once (asynchronously, at startup) and answers from
 * `PreloadedFootprints` afterwards; `Run()`'s own `libFootprintCache` is a
 * second cache on top of that. One cache keyed by nickname reproduces both: a
 * board with two hundred resistors reads the resistor library exactly once, and
 * a per-`LIB_ID` cache over an in-memory `Map` lookup would buy nothing.
 */

import { unescapeString } from '@ziroeda/common/src/string_utils.js';
import { footprintNeedsUpdate } from '../footprint_diff.js';
import {
  expandLibraryUri,
  findLibraryRow,
  libraryRowFullUri,
  type LibraryTableRow,
  type LibraryTableSet,
  type UriVarResolver,
} from '../fp_lib_table.js';
import {
  getLibraryFootprint,
  loadFootprintLibrary,
  type FootprintLibrary,
  type FootprintLibraryFs,
} from '../footprint_library.js';
import { fpidItemName, fpidLibNickname } from '../netlist_reader/pcb_netlist.js';
import type { Board } from '../types.js';
import type { DrcViolation } from './drc_engine.js';

/**
 * What the check needs to reach the libraries. Upstream takes this from the open
 * `PROJECT`; supplying it is what says a project is loaded at all.
 */
export interface LibraryParityOptions {
  fs: FootprintLibraryFs;
  /** The global and project `fp-lib-table`s, already read. */
  tables: LibraryTableSet;
  resolve: UriVarResolver;
  /** What a relative library URI is made absolute against. */
  cwd: string;
}

/**
 * `LOAD_STATUS::LOADED` for one row: the `.pretty` directory was read and every
 * file in it parsed.
 *
 * A row naming an IO plugin we do not have reports unloaded rather than being
 * read as though it were a `.pretty` directory. That is the same stance
 * `loadFootprintFromLibraries` takes, and it lands in the same branch a missing
 * directory does — which is honest, because we genuinely cannot say whether such
 * a footprint matches its library.
 */
function loadIfKicad(opts: LibraryParityOptions, row: LibraryTableRow): FootprintLibrary | null {
  // PCB_IO_MGR::EnumFromStr matches plugin names case-insensitively.
  if (row.type.toLowerCase() !== 'kicad') return null;

  const library = loadFootprintLibrary(opts.fs, expandLibraryUri(row.uri, opts.resolve, opts.cwd));

  return library.errorDescription === undefined ? library : null;
}

/**
 * `DRC_TEST_PROVIDER_LIBRARY_PARITY::Run`.
 *
 * Violations come out in board-footprint order, one per footprint at most:
 * every branch below either reports and stops considering that footprint, or
 * falls through to the comparison.
 */
export function checkLibraryParity(board: Board, opts: LibraryParityOptions): DrcViolation[] {
  const out: DrcViolation[] = [];

  /** Nickname to library, `null` once it is known not to load. */
  const cache = new Map<string, FootprintLibrary | null>();

  const libraryOf = (nickname: string, row: LibraryTableRow): FootprintLibrary | null => {
    const hit = cache.get(nickname);
    if (hit !== undefined) return hit;

    const library = loadIfKicad(opts, row);
    cache.set(nickname, library);
    return library;
  };

  for (const fp of board.footprints) {
    const libName = fpidLibNickname(fp.lib);
    const fpName = fpidItemName(fp.lib);

    // A footprint with no nickname at all — a legacy LIB_ID, or one the user has
    // cleared. Not much we can do here.
    if (!libName) continue;

    const issue = (message: string): void => {
      out.push({
        code: 'lib_footprint_issues',
        message,
        pos: fp.at,
        items: [{ desc: `Footprint ${fp.reference ?? fp.lib}`, pos: fp.at }],
      });
    };

    // `GetRow` searches with aIncludeInvalid, so a nickname whose nested table
    // failed to load is still found — the user is told why the library is
    // unusable rather than that it does not exist.
    const row = findLibraryRow(opts.tables, libName);

    if (row === undefined) {
      issue(
        `The current configuration does not include the footprint library '${unescapeString(libName)}'`,
      );
      continue;
    }

    const library = libraryOf(libName, row);
    // HasLibrary( libName, true ).
    const enabled = library !== null && !row.disabled;

    if (!enabled) {
      issue(
        `The footprint library '${unescapeString(libName)}' is not enabled in the current configuration`,
      );
      continue;
    }

    // IsLibraryLoaded( libName ). Unreachable — see the file docblock. The URI
    // here is `GetFullURI( row, true )`, expanded but *not* made absolute, which
    // is a different string from the one the library was actually read from.
    if (library === null) {
      issue(
        `The footprint library '${unescapeString(libName)}' was not found at ` +
          `'${libraryRowFullUri(row, opts.resolve)}'`,
      );
      continue;
    }

    const libFootprint = getLibraryFootprint(library, fpName);

    // Neither of the messages below unescapes, though the three above do.
    if (libFootprint === null) {
      issue(`Footprint '${fpName}' not found in library '${libName}'`);
    } else if (footprintNeedsUpdate(fp, libFootprint, 'drc')) {
      out.push({
        code: 'lib_footprint_mismatch',
        message: `Footprint '${fpName}' does not match copy in library '${libName}'`,
        pos: fp.at,
        items: [{ desc: `Footprint ${fp.reference ?? fp.lib}`, pos: fp.at }],
      });
    }
  }

  return out;
}
