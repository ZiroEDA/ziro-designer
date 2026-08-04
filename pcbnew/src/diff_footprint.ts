// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Board vs library diff": fetch a placed footprint's library original and say
 * how the two differ.
 * Counterpart: `BOARD_INSPECTION_TOOL::DiffFootprint`
 * (`pcbnew/tools/board_inspection_tool.cpp`), whose Summary page this produces.
 *
 * The comparison itself lives in `footprint_diff.ts`; what is here is the half
 * that has to go and find the other footprint, and the four things upstream
 * says when it cannot. The dialog — the Summary page's markup, the "Manage
 * Footprint Libraries" link, and the Visual page that renders the two
 * footprints on top of each other — is designer's, so this returns the
 * resolved library footprint rather than drawing anything with it.
 *
 * ## "Not included in the current configuration" is not only about the table
 *
 * Upstream asks `HasLibrary( libName, false )`, which is true only for a
 * library the manager has actually *loaded*: a nickname absent from the table,
 * a row whose plugin is one we cannot read, and a row whose directory has gone
 * missing all answer the same "not included in the current configuration",
 * even though only the first is really a configuration problem. The disabled
 * check comes second, so a library that is both disabled and missing reports
 * as missing. Reproduced in that order.
 *
 * Having no library manager to ask, this models "loaded" as "the `.pretty`
 * directory can be listed" — the only thing a pure function can observe. A
 * library that lists but whose footprint files are corrupt stays loaded, and
 * costs you only the footprints that failed to parse, which is what
 * `FootprintEnumerate` does with `FP_CACHE::Load`'s failures.
 */

import {
  expandLibraryUri,
  findLibraryRowForFpid,
  type LibraryTableRow,
  type LibraryTableSet,
  type UriVarResolver,
} from './fp_lib_table.js';
import { footprintDifferences } from './footprint_diff.js';
import {
  getLibraryFootprint,
  loadFootprintLibrary,
  type FootprintLibraryFs,
} from './footprint_library.js';
import { fpidItemName, fpidLibNickname } from './netlist_reader/pcb_netlist.js';
import type { PcbFootprint } from './types.js';

/** How far the library original got before it could be compared. */
export type LibraryFootprintStatus =
  /** `HasLibrary( …, false )` was false: no row, no reader, or no directory. */
  | 'library-not-configured'
  /** The row is there and readable, and switched off. */
  | 'library-not-enabled'
  /** The library loaded and does not hold this footprint. */
  | 'item-not-found'
  | 'found';

export interface ResolvedLibraryFootprint {
  status: LibraryFootprintStatus;
  /** The LIB_ID's nickname, empty for a legacy bare footprint name. */
  library: string;
  /** The LIB_ID's item name. */
  libraryItem: string;
  /** The table row, when one was found — even a disabled or unreadable one. */
  row?: LibraryTableRow;
  /** The library's own footprint object; null unless `status` is `found`. */
  footprint: PcbFootprint | null;
}

export interface LibraryFootprintQuery {
  fs: FootprintLibraryFs;
  tables: LibraryTableSet;
  resolve: UriVarResolver;
  /** What a relative library URI is made absolute against. */
  cwd: string;
}

/** `PCB_IO_MGR::EnumFromStr` matches plugin names without regard to case. */
const KICAD_PLUGIN = 'kicad';

/**
 * Find the library original of a placed footprint, by the LIB_ID it carries.
 *
 * Split out from {@link diffFootprintAgainstLibrary} because the DRC library
 * parity check needs the same four outcomes under its own wording, and because
 * this is the only part of the diff that touches a filesystem.
 */
export function resolveLibraryFootprint(
  query: LibraryFootprintQuery,
  fpid: string,
): ResolvedLibraryFootprint {
  const library = fpidLibNickname(fpid);
  const libraryItem = fpidItemName(fpid);
  const row = findLibraryRowForFpid(query.tables, fpid);
  const missing = (status: LibraryFootprintStatus): ResolvedLibraryFootprint => ({
    status,
    library,
    libraryItem,
    row,
    footprint: null,
  });

  if (row === undefined) return missing('library-not-configured');

  // A row naming a plugin we have no reader for can never reach LOADED, so it
  // is reported the same way an absent row is.
  if (row.type.toLowerCase() !== KICAD_PLUGIN) return missing('library-not-configured');

  const path = expandLibraryUri(row.uri, query.resolve, query.cwd);

  if (query.fs.listDirectory(path) === null) return missing('library-not-configured');

  // Only now, exactly as upstream asks `HasLibrary( …, true )` only after
  // `HasLibrary( …, false )`.
  if (row.disabled) return missing('library-not-enabled');

  const footprint = getLibraryFootprint(loadFootprintLibrary(query.fs, path), libraryItem);

  if (footprint === null) return missing('item-not-found');

  return { status: 'found', library, libraryItem, row, footprint };
}

export interface FootprintDiffReport {
  status: LibraryFootprintStatus;
  library: string;
  libraryItem: string;
  /**
   * The Summary page's body, in upstream's order and wording: either the one
   * sentence explaining why there is nothing to compare, or every difference
   * found, or the single line that says there were none.
   */
  messages: string[];
  /** True only when the library original was read and matches. */
  identical: boolean;
  /** The library original, for the Visual page. Null when it was not found. */
  libraryFootprint: PcbFootprint | null;
}

/**
 * `BOARD_INSPECTION_TOOL::DiffFootprint`'s Summary page.
 *
 * Always the *report* comparison: upstream passes no compare flags here, so
 * the design attributes and the local overrides that DRC suppresses are all
 * listed. A footprint carrying a bare library name ("R_0805" with no nickname)
 * resolves against the empty nickname and finds nothing, which is why it comes
 * back as an unconfigured library rather than as a search across every library.
 */
export function diffFootprintAgainstLibrary(
  query: LibraryFootprintQuery,
  footprint: PcbFootprint,
): FootprintDiffReport {
  const resolved = resolveLibraryFootprint(query, footprint.lib);
  const report = (messages: string[], identical = false): FootprintDiffReport => ({
    status: resolved.status,
    library: resolved.library,
    libraryItem: resolved.libraryItem,
    messages,
    identical,
    libraryFootprint: resolved.footprint,
  });

  switch (resolved.status) {
    case 'library-not-configured':
      return report(['The library is not included in the current configuration.']);

    case 'library-not-enabled':
      return report(['The library is not enabled in the current configuration.']);

    case 'item-not-found':
      return report([`The library no longer contains the item ${resolved.libraryItem}.`]);

    case 'found': {
      const differences = footprintDifferences(footprint, resolved.footprint!, 'report');

      return differences.length === 0
        ? report(['No relevant differences detected.'], true)
        : report(differences);
    }
  }
}
