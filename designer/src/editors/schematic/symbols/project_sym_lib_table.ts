// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The project's symbol library table. Counterpart: `eeschema/symbol_lib_table.cpp`
 * (SYMBOL_LIB_TABLE / LIB_TABLE_ROW), the `sym-lib-table` file that maps a
 * library *nickname* to a `.kicad_sym` file.
 *
 * SYMBOL_LIB_TABLE resolves a LIB_ID's nickname through the **project** table
 * first and the global one after, so a project that ships its own symbols — as
 * most of KiCad's demos do — registers them here and nowhere else:
 *
 *     (sym_lib_table
 *       (lib (name "kit-dev-coldfire-xilinx_5213")(type "KiCad")
 *            (uri "${KIPRJMOD}/kit-dev-coldfire-xilinx_5213.kicad_sym")…))
 *
 * Without reading it, every symbol those projects place resolves to nothing and
 * TestLibSymbolIssues reports the library as unconfigured once per symbol.
 * The hosted libraries stand in for the global table, as they do for footprints.
 */

import { parse } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import type { LibSymbol } from '@ziroeda/eeschema/src/types.js';
import { parseFpLibTable, type FpLibRow } from '../../footprint/fp_lib_table.js';

/** A project file as the editor holds it. */
export interface ProjectFile {
  name: string;
  text: string;
}

/** Read the project's `sym-lib-table`, if it has one. The row grammar is the
 *  same `(lib (name …)(type …)(uri …))` as the footprint table's. */
export function projectSymLibTable(files: readonly ProjectFile[]): FpLibRow[] {
  const file = files.find((f) => /(^|\/)sym-lib-table$/i.test(f.name.replace(/\\/g, '/')));
  return file ? parseFpLibTable(file.text) : [];
}

/**
 * The symbols each project-registered library holds.
 *
 * A row's URI is resolved the way LIB_TABLE_ROW does for a project table: only
 * `${KIPRJMOD}` (and its legacy `$(KIPRJMOD)` spelling) is expanded, and it
 * means "next to the project", so the file is matched inside the project by
 * path. A row whose file is absent or unreadable is reported through
 * `unloaded`, which is what `IsLibraryLoaded` false plus `GetFullURI` gives
 * TestLibSymbolIssues.
 */
export function projectSymbolLibraries(files: readonly ProjectFile[]): {
  /** nickname -> the symbol names it holds (the symbol library table half). */
  symbolLibs: Map<string, Set<string>>;
  /** "nickname:name" -> the library's copy, for the mismatch comparison. */
  librarySymbols: Map<string, LibSymbol>;
  /** nickname -> URI, for a registered row whose file would not load. */
  unloaded: Map<string, string>;
} {
  const symbolLibs = new Map<string, Set<string>>();
  const librarySymbols = new Map<string, LibSymbol>();
  const unloaded = new Map<string, string>();

  for (const row of projectSymLibTable(files)) {
    if (row.disabled) continue;
    const file = findProjectFile(files, row.uri);
    if (!file) {
      unloaded.set(row.name, row.uri);
      continue;
    }
    let symbols: LibSymbol[];
    try {
      symbols = readSymbolLib(parse(file.text));
    } catch {
      unloaded.set(row.name, row.uri);
      continue;
    }
    const names = new Set<string>();
    for (const sym of symbols) {
      // A LIB_SYMBOL's id inside a .kicad_sym is its bare name; the nickname
      // comes from the row, never from the file.
      const name = sym.libId.includes(':')
        ? sym.libId.slice(sym.libId.indexOf(':') + 1)
        : sym.libId;
      names.add(name);
      librarySymbols.set(`${row.name}:${name}`, sym);
    }
    symbolLibs.set(row.name, names);
  }

  return { symbolLibs, librarySymbols, unloaded };
}

/** A table row paired with the project file its URI resolves to. */
export interface ResolvedSymLib {
  row: FpLibRow;
  file: ProjectFile;
}

/**
 * Every row of the project table that resolves to a file, disabled ones
 * included — the caller decides what a disabled row means, as upstream does
 * (`HasLibrary( nickname, true )` is a separate question from `FindRowByURI`).
 * This is the *only* list of the project's symbol libraries: a `.kicad_sym` no
 * row points at is a file, not a library.
 */
export function resolvedProjectSymLibs(files: readonly ProjectFile[]): ResolvedSymLib[] {
  const out: ResolvedSymLib[] = [];
  for (const row of projectSymLibTable(files)) {
    const file = findProjectFile(files, row.uri);
    if (file) out.push({ row, file });
  }
  return out;
}

/**
 * SYMBOL_LIBRARY_ADAPTER::FindRowByURI, the lookup MAIL_LIB_EDIT does when the
 * project manager asks the symbol editor to open a `.kicad_sym`: which table row
 * points at this file? None means the file is not a library, and upstream says
 * so rather than opening it anyway.
 */
export function findSymLibRowByUri(
  files: readonly ProjectFile[],
  path: string,
): FpLibRow | undefined {
  const wanted = path.replace(/\\/g, '/').toLowerCase();
  return resolvedProjectSymLibs(files).find(
    ({ file }) => file.name.replace(/\\/g, '/').toLowerCase() === wanted,
  )?.row;
}

/** Write the rows back as a `sym-lib-table` file (SYMBOL_LIB_TABLE::Format). */
export function serializeSymLibTable(rows: readonly FpLibRow[]): string {
  const q = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const lines = rows.map(
    (r) =>
      `\t(lib (name ${q(r.name)})(type ${q(r.type || 'KiCad')})(uri ${q(r.uri)})` +
      `(options ${q(r.options)})(descr ${q(r.descr)})${r.disabled ? '(disabled)' : ''})`,
  );
  return `(sym_lib_table\n\t(version 7)\n${lines.join('\n')}${lines.length ? '\n' : ''})\n`;
}

/** Path of the project's `sym-lib-table`, existing or to be created (it sits
 *  next to the `.kicad_pro`). */
export function projectSymLibTablePath(files: readonly ProjectFile[]): string {
  const existing = files.find((f) => /(^|\/)sym-lib-table$/i.test(f.name.replace(/\\/g, '/')));
  if (existing) return existing.name;
  const pro = files.find((f) => /\.kicad_pro$/i.test(f.name))?.name.replace(/\\/g, '/');
  const dir = pro?.includes('/') ? pro.slice(0, pro.lastIndexOf('/') + 1) : '';
  return `${dir}sym-lib-table`;
}

/** The `.kicad_sym` file a row's URI points at, without the extension
 *  ("${KIPRJMOD}/proj.kicad_sym" -> "proj"). */
export function rowSymLibName(row: FpLibRow): string {
  const base = row.uri.replace(/\\/g, '/').split('/').pop() ?? '';
  return /\.kicad_sym$/i.test(base) ? base.replace(/\.kicad_sym$/i, '') : '';
}

/**
 * The `.kicad_sym` files in the project, with the nickname (if any) each is
 * registered under. This is what "Add Existing" offers — listing a file is not
 * the same as resolving one, and an unregistered file stays unusable until a row
 * points at it.
 */
export function projectSymbolFiles(
  files: readonly ProjectFile[],
  rows: readonly FpLibRow[],
): { file: string; path: string; registeredAs: string }[] {
  const seen = new Map<string, string>();
  for (const f of files) {
    const norm = f.name.replace(/\\/g, '/');
    if (!/\.kicad_sym$/i.test(norm)) continue;
    const base = (norm.split('/').pop() ?? '').replace(/\.kicad_sym$/i, '');
    if (base && !seen.has(base)) seen.set(base, norm);
  }
  return [...seen].map(([file, path]) => ({
    file,
    path,
    registeredAs:
      rows.find((r) => rowSymLibName(r).toLowerCase() === file.toLowerCase())?.name ?? '',
  }));
}

/**
 * What `${KIPRJMOD}` stands for: the folder the project's own files sit in.
 * The table lives next to the `.kicad_pro`, so either one anchors it. A project
 * opened as a flat file list has no prefix at all, and the root is ''.
 */
function projectRoot(files: readonly ProjectFile[]): string {
  const norm = (n: string): string => n.replace(/\\/g, '/');
  const anchor =
    files.find((f) => /(^|\/)sym-lib-table$/i.test(norm(f.name)))?.name ??
    files.find((f) => /\.kicad_pro$/i.test(norm(f.name)))?.name;
  const path = anchor ? norm(anchor) : '';
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
}

/**
 * The project file a `${KIPRJMOD}`-relative URI points at, resolved exactly.
 *
 * `${KIPRJMOD}` is a real path, so the row's URI names one file and only that
 * file: `${KIPRJMOD}/foo.kicad_sym` is the `foo.kicad_sym` at the project root,
 * never a same-named file in a subfolder. Matching loosely would let a row
 * silently resolve to a library the engineer never registered, which is the
 * whole thing the table exists to prevent.
 */
function findProjectFile(files: readonly ProjectFile[], uri: string): ProjectFile | undefined {
  const rel = uri
    .replace(/\\/g, '/')
    .replace(/^\$\{KIPRJMOD\}\/?/i, '')
    .replace(/^\$\(KIPRJMOD\)\/?/i, '')
    .replace(/^\.\//, '');
  if (!rel) return undefined;
  const wanted = `${projectRoot(files)}${rel}`.toLowerCase();
  return files.find((f) => f.name.replace(/\\/g, '/').toLowerCase() === wanted);
}
