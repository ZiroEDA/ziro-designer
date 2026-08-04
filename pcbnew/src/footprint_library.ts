// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reading footprint libraries off a filesystem: the `fp-lib-table` files
 * themselves, and the `.pretty` directories they point at.
 * Counterparts: `LIBRARY_MANAGER::loadTables` / `loadNestedTables`
 * (common/libraries/library_manager.cpp), the file constructor of
 * `LIBRARY_TABLE` (library_table.cpp), and `FP_CACHE::Load` /
 * `PCB_IO_KICAD_SEXPR::FootprintEnumerate` / `FootprintLoad` /
 * `GetLibraryTimestamp` (pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.cpp).
 *
 * pcbnew stays pure, so every filesystem touch goes through {@link
 * FootprintLibraryFs}. The interface is shaped by what upstream actually needs,
 * not by what is convenient: `wxDir` enumeration, whole-file reads, and the
 * `st_mtime`/`st_size` pair that `KIPLATFORM::IO::TimestampDir` sums.
 *
 * ## A library is loaded whole or not at all — but a bad file is only skipped
 *
 * `FP_CACHE::Load` parses every `.kicad_mod` in the directory and collects the
 * failures into one message, then throws it. `FootprintEnumerate` catches that
 * and *still* returns the footprints that parsed. So one corrupt file costs you
 * that footprint and nothing else. A library table is the opposite: one
 * malformed row and the table reports no libraries at all.
 *
 * ## The cached footprint is renamed after its file, not after its contents
 *
 * `FP_CACHE::Load` overwrites each parsed footprint's `LIB_ID` with
 * `LIB_ID( "", <filename stem> )`, discarding whatever name the file's own
 * `(footprint "…")` header carried. A footprint in `R_0805.kicad_mod` is called
 * `R_0805` even if the header says otherwise, which is why enumerating a library
 * and loading from it agree. We patch the source node as well as the model, so
 * the rename survives a save instead of quietly reverting.
 *
 * ## Two wildcards, two meanings
 *
 * Enumeration and timestamping filter the same directory with the same
 * `*.kicad_mod` spec through two different matchers. `wxDir` on POSIX is
 * case-sensitive and treats a leading dot as an ordinary character; `fnmatch`
 * with `FNM_CASEFOLD | FNM_PERIOD` is case-insensitive and refuses to match a
 * leading dot with a wildcard. So a hidden `.old.kicad_mod` is loaded as a
 * footprint but contributes nothing to the timestamp, and a `R_0805.KICAD_MOD`
 * does the reverse. Both are reproduced.
 */

import { parse } from '@ziroeda/sexpr/src/parser.js';
import { isList, str } from '@ziroeda/sexpr/src/types.js';
import {
  NESTED_TABLE_ROW_TYPE,
  absolutePath,
  expandLibraryUri,
  findLibraryRowForFpid,
  parseLibraryTable,
  type LibraryTable,
  type LibraryTableScope,
  type LibraryTableSet,
  type LibraryTableType,
  type UriVarResolver,
} from './fp_lib_table.js';
import { fpidItemName } from './netlist_reader/pcb_netlist.js';
import { readFootprintFile } from './read-board.js';
import type { PcbFootprint } from './types.js';

/** `FILEEXT::FootprintLibraryTableFileName`. */
export const FP_LIB_TABLE_FILE_NAME = 'fp-lib-table';

/** `FILEEXT::KiCadFootprintFileExtension`, with its dot. */
const FOOTPRINT_FILE_SUFFIX = '.kicad_mod';

/**
 * One entry of a directory, carrying what `TimestampDir` reads out of `lstat`.
 * The provider is expected to have followed symlinks already, as the POSIX
 * implementation does with its `readlink` step.
 */
export interface LibraryDirEntry {
  /** File name including extension, as the directory holds it. */
  name: string;
  /** `S_ISREG`: false for a subdirectory, which contributes no timestamp. */
  isFile: boolean;
  /** `st_mtime`, whole seconds since the epoch. */
  mtimeSeconds: number;
  /** `st_size`, in bytes. */
  size: number;
}

/** Everything pcbnew needs from a filesystem to read footprint libraries. */
export interface FootprintLibraryFs {
  /** `wxDir`: the entries of a directory, or null if it cannot be opened. */
  listDirectory(path: string): readonly LibraryDirEntry[] | null;
  /** A whole file as text, or null if it cannot be read. */
  readFile(path: string): string | null;
  /**
   * `WX_FILENAME::ResolvePossibleSymlinks`, used only as the identity a nested
   * table is deduplicated by. Returning the path unchanged is valid; it just
   * means two rows reaching one table by different symlinks are not spotted.
   */
  realPath?(path: string): string;
}

/* -------------------------------------------------------------------------- */
/*  Library tables on disk                                                     */
/* -------------------------------------------------------------------------- */

/** `wxFileName::GetSize()` counts bytes, and a UTF-8 character can be four. */
function utf8ByteLength(text: string): number {
  let n = 0;

  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }

  return n;
}

/**
 * `LIBRARY_TABLE( const wxFileName&, aScope, aExpectedType )`.
 *
 * A file of one byte or less is accepted as an *empty* table and takes the
 * expected type on trust — which means a zero-length `fp-lib-table` read through
 * {@link loadFootprintLibraryTables}, where no type is expected, ends up typed
 * as nothing and is then discarded by the caller's type check. One byte is
 * allowed so a lone byte-order mark still counts as empty.
 */
export function loadLibraryTable(
  fs: FootprintLibraryFs,
  path: string,
  scope: LibraryTableScope,
  expectedType?: LibraryTableType,
): LibraryTable {
  const resolved = fs.realPath ? fs.realPath(path) : path;
  const text = fs.readFile(resolved);

  if (text === null) {
    return {
      path: resolved,
      scope,
      ok: false,
      errorDescription: `The library table path '${resolved}' does not exist`,
      rows: [],
    };
  }

  if (utf8ByteLength(text) <= 1)
    return { path: resolved, scope, type: expectedType, ok: true, rows: [] };

  const table = parseLibraryTable(text, scope);
  table.path = resolved;

  if (table.ok && expectedType !== undefined && table.type !== expectedType) {
    return {
      path: resolved,
      scope,
      ok: false,
      errorDescription: 'The library table is of wrong type',
      rows: [],
    };
  }

  return table;
}

const dirName = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
};

/**
 * `LIBRARY_MANAGER::loadNestedTables`: follow every `Table` row and collect the
 * tables it names, keyed by the row's unexpanded URI.
 *
 * The nested URI is expanded and made absolute against `cwd` *before* being made
 * absolute against the parent table's directory, so the second step never does
 * anything: a relative nested-table URI resolves against the process working
 * directory, not against the table that referenced it, despite the comment
 * upstream saying otherwise. Reproduced rather than repaired.
 */
function loadNestedTables(
  fs: FootprintLibraryFs,
  rootTable: LibraryTable,
  resolve: UriVarResolver,
  cwd: string,
  children: Map<string, LibraryTable>,
): void {
  const seen = new Set<string>();

  const processOneTable = (table: LibraryTable): void => {
    seen.add(table.path);

    if (!table.ok) return;

    for (const row of table.rows) {
      if (row.type !== NESTED_TABLE_ROW_TYPE) continue;

      const expanded = expandLibraryUri(row.uri, resolve, cwd);
      const file = absolutePath(expanded, dirName(table.path));
      const src = fs.realPath ? fs.realPath(file) : file;

      if (seen.has(src)) {
        row.ok = false;
        row.errorDescription = 'A reference to this library table already exists';
        continue;
      }

      const child = loadLibraryTable(fs, file, rootTable.scope);

      processOneTable(child);

      if (!child.ok) {
        row.ok = false;
        row.errorDescription = child.errorDescription;
      }

      children.set(row.uri, child);
    }
  };

  processOneTable(rootTable);
}

export interface LoadFootprintTablesOptions {
  fs: FootprintLibraryFs;
  /** Directory holding the global `fp-lib-table` (KiCad's user settings path). */
  globalPath?: string;
  /** The project directory; omit when no project is open. */
  projectPath?: string;
  resolve: UriVarResolver;
  /** What a relative URI is made absolute against. */
  cwd: string;
}

/**
 * `LIBRARY_MANAGER::loadTables` for the footprint table, global then project.
 *
 * A table whose leading keyword is not `fp_lib_table` is dropped with a warning
 * rather than being reported as an error, and so is an empty file — the file
 * constructor gives an empty table no type at all, and no type fails the same
 * check that a `sym_lib_table` fails.
 */
export function loadFootprintLibraryTables(opts: LoadFootprintTablesOptions): LibraryTableSet {
  const { fs, resolve, cwd } = opts;
  const children = new Map<string, LibraryTable>();

  const load = (dir: string | undefined, scope: LibraryTableScope): LibraryTable | undefined => {
    if (dir === undefined) return undefined;

    // An unreadable file is skipped by the `IsFileReadable` guard upstream, and
    // by the type check below here — both end at "this scope has no table".
    const table = loadLibraryTable(fs, `${dir}/${FP_LIB_TABLE_FILE_NAME}`, scope);

    if (table.type !== 'footprint') return undefined;

    loadNestedTables(fs, table, resolve, cwd, children);
    return table;
  };

  return {
    global: load(opts.globalPath, 'global'),
    project: load(opts.projectPath, 'project'),
    children,
  };
}

/* -------------------------------------------------------------------------- */
/*  A `.pretty` directory                                                      */
/* -------------------------------------------------------------------------- */

/** `FP_CACHE`, minus the invalidation machinery. */
export interface FootprintLibrary {
  /** The expanded, absolute directory the library was read from. */
  path: string;
  /** Filename stem to footprint, in the order upstream's ordered map yields. */
  footprints: Map<string, PcbFootprint>;
  /** `FP_CACHE::GetTimestamp` as of the load; zero for an empty library. */
  timestamp: number;
  /** Accumulated per-file failures; the footprints that parsed are still here. */
  errorDescription?: string;
}

/** `wxDir::GetFirst( …, "*.kicad_mod" )` on POSIX: case-sensitive, dotfiles in. */
const isFootprintFileName = (name: string): boolean => name.endsWith(FOOTPRINT_FILE_SUFFIX);

/**
 * `KIPLATFORM::IO::TimestampDir( aLibPath, "*.kicad_mod" )`: the sum over the
 * library's footprint files of `st_mtime * 1000 + st_size`. Deliberately not an
 * ordered quantity — two timestamps either match or they do not.
 */
export function footprintLibraryTimestamp(fs: FootprintLibraryFs, libPath: string): number {
  const entries = fs.listDirectory(libPath);

  if (entries === null) return 0;

  let timestamp = 0;

  for (const entry of entries) {
    // FNM_PERIOD: a wildcard does not match a leading dot.
    if (entry.name.startsWith('.')) continue;
    // FNM_CASEFOLD: unlike enumeration, the match here ignores case.
    if (!entry.name.toLowerCase().endsWith(FOOTPRINT_FILE_SUFFIX)) continue;
    if (!entry.isFile) continue;

    timestamp += entry.mtimeSeconds * 1000;
    timestamp += entry.size;
  }

  return timestamp;
}

/**
 * `FOOTPRINT::SetFPID( LIB_ID( "", aName ) )` as `FP_CACHE::Load` applies it.
 * The source node's name atom is rewritten too: `writeFootprintNode` emits the
 * source's own header when there is one, so patching only the model would let
 * the old name come back the moment the footprint were saved.
 */
function setFootprintLibId(fp: PcbFootprint, name: string): void {
  fp.lib = name;

  const items = fp.source.items;

  for (let i = 1; i < items.length; i++) {
    if (isList(items[i]!)) continue;
    items[i] = str(name);
    return;
  }
}

/**
 * `FP_CACHE::Load`: parse every footprint file in a `.pretty` directory.
 *
 * The timestamp is only taken when at least one footprint file was found —
 * upstream computes it inside the `wxDir::GetFirst` branch — so an empty library
 * caches a timestamp of zero. That is harmless only because `TimestampDir` of an
 * empty library is also zero.
 */
export function loadFootprintLibrary(fs: FootprintLibraryFs, libPath: string): FootprintLibrary {
  const footprints = new Map<string, PcbFootprint>();
  const entries = fs.listDirectory(libPath);

  if (entries === null) {
    return {
      path: libPath,
      footprints,
      timestamp: 0,
      errorDescription: `Footprint library '${libPath}' not found.`,
    };
  }

  const matching = entries.filter((e) => isFootprintFileName(e.name));

  if (matching.length === 0) return { path: libPath, footprints, timestamp: 0 };

  const failures: string[] = [];

  for (const entry of matching) {
    const fullPath = `${libPath}/${entry.name}`;
    const fail = (detail: string): void => {
      failures.push(`Unable to read file '${fullPath}'\n${detail}`);
    };

    const text = fs.readFile(fullPath);

    if (text === null) {
      fail('');
      continue;
    }

    let footprint: PcbFootprint | null = null;

    try {
      footprint = readFootprintFile(parse(text));
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
      continue;
    }

    if (footprint === null) {
      fail('');
      continue;
    }

    const fpName = entry.name.slice(0, -FOOTPRINT_FILE_SUFFIX.length);
    setFootprintLibId(footprint, fpName);

    // boost::ptr_map::insert leaves an existing key alone, so the first file wins.
    if (!footprints.has(fpName)) footprints.set(fpName, footprint);
  }

  const library: FootprintLibrary = {
    path: libPath,
    footprints,
    timestamp: footprintLibraryTimestamp(fs, libPath),
  };

  if (failures.length) library.errorDescription = failures.join('\n\n');

  return library;
}

/**
 * `PCB_IO_KICAD_SEXPR::FootprintEnumerate`, the names that parsed. Sorted,
 * because upstream reads them out of an ordered map keyed by name.
 */
export function footprintLibraryNames(library: FootprintLibrary): string[] {
  return [...library.footprints.keys()].sort();
}

/**
 * `PCB_IO_KICAD_SEXPR::GetEnumeratedFootprint`: the library's own footprint, not
 * a copy. `FootprintLoad` clones before handing it out; callers that intend to
 * edit want the same, since two calls here return the same object.
 */
export function getLibraryFootprint(
  library: FootprintLibrary,
  footprintName: string,
): PcbFootprint | null {
  return library.footprints.get(footprintName) ?? null;
}

/** `FP_CACHE::IsModified` for a library nothing has written to since loading. */
export function footprintLibraryIsModified(
  fs: FootprintLibraryFs,
  library: FootprintLibrary,
): boolean {
  return footprintLibraryTimestamp(fs, library.path) !== library.timestamp;
}

/* -------------------------------------------------------------------------- */
/*  Table plus library: resolving a LIB_ID                                     */
/* -------------------------------------------------------------------------- */

export interface LoadFootprintOptions {
  fs: FootprintLibraryFs;
  tables: LibraryTableSet;
  resolve: UriVarResolver;
  cwd: string;
  /** A full LIB_ID, "Library:Footprint". */
  fpid: string;
}

/**
 * Resolve a LIB_ID to a footprint: find the row, expand its URI, read the
 * `.pretty` directory, take the entry. `LIBRARY_MANAGER_ADAPTER::loadIfNeeded`
 * followed by `PCB_IO::FootprintLoad`.
 *
 * A *disabled* library still loads. Nothing on the load path consults the flag —
 * it is checked only by `HasLibrary( …, aCheckEnabled )`, which the browse and
 * pick paths use and the resolve path does not.
 *
 * Rows naming any plugin other than `KiCad` return null: the other IO plugins
 * are not ported, and guessing would be worse than admitting it.
 */
export function loadFootprintFromLibraries(opts: LoadFootprintOptions): PcbFootprint | null {
  const row = findLibraryRowForFpid(opts.tables, opts.fpid);

  if (row === undefined) return null;
  // PCB_IO_MGR::EnumFromStr matches plugin names case-insensitively.
  if (row.type.toLowerCase() !== 'kicad') return null;

  const libPath = expandLibraryUri(row.uri, opts.resolve, opts.cwd);
  const library = loadFootprintLibrary(opts.fs, libPath);

  return getLibraryFootprint(library, fpidItemName(opts.fpid));
}
