// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The footprint library table. Counterpart: `common/fp_lib_table.cpp`
 * (FP_LIB_TABLE / LIB_TABLE_ROW), the `fp-lib-table` file that maps a library
 * *nickname* to a `.pretty` directory.
 *
 * Two rules from upstream matter here, and both are strict:
 *
 *  - **A library exists only if a table row registers it.** A `.pretty`
 *    directory sitting next to the project is not a library; FP_LIB_TABLE
 *    resolves an FPID's nickname through the project table then the global
 *    one, and an unregistered directory resolves to nothing (cvpcb then marks
 *    the assignment with SYMBOLS_LISTBOX's warning colour).
 *  - **The nickname is the row's, not the directory's.** The ECC83 demo stores
 *    `Footprints:Valve_ECC-83-1` because its table names
 *    `${KIPRJMOD}/footprints.pretty` "Footprints".
 *
 * Only the project table lives in a file here; the hosted libraries stand in
 * for the global table, and their nicknames are the index's library names.
 */

import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from './libraries/library_table.js';

/** A LIB_TABLE_ROW: `(lib (name "X")(type "KiCad")(uri "…")(options "")(descr ""))`. */
export interface FpLibRow {
  name: string;
  type: string;
  uri: string;
  options: string;
  descr: string;
  /** `(disabled)`, the row's "Enable" checkbox; a disabled row is not loaded. */
  disabled?: boolean;
  /** `(hidden)`, the row's "Show" checkbox (symbol tables only). */
  hidden?: boolean;
}

/**
 * Parse an `fp-lib-table` file through LIBRARY_TABLE. Malformed text yields no
 * rows (upstream's whole-table rejection); a row with no name is dropped and a
 * row with no type reads as "KiCad", as this reader always has.
 */
export function parseFpLibTable(text: string): FpLibRow[] {
  return fpLibRowsOf(new LIBRARY_TABLE(true, text, LIBRARY_TABLE_SCOPE.PROJECT));
}

/** A LIBRARY_TABLE's rows as the editor's records. */
export function fpLibRowsOf(table: LIBRARY_TABLE): FpLibRow[] {
  return table
    .Rows()
    .map((r) => ({
      name: r.Nickname(),
      type: r.Type() || 'KiCad',
      uri: r.URI(),
      options: r.Options(),
      descr: r.Description(),
      disabled: r.Disabled(),
      ...(r.Hidden() ? { hidden: true } : {}),
    }))
    .filter((r) => r.name);
}

/** The editor's records as a LIBRARY_TABLE of the given type (`LIBRARY_TABLE::InsertRow`). */
export function libraryTableOf(
  rows: readonly FpLibRow[],
  type: LIBRARY_TABLE_TYPE,
  scope = LIBRARY_TABLE_SCOPE.PROJECT,
): LIBRARY_TABLE {
  const table = LIBRARY_TABLE.Empty(scope, type);

  for (const r of rows) {
    const row = table.InsertRow();
    row.SetNickname(r.name);
    row.SetType(r.type || 'KiCad');
    row.SetURI(r.uri);
    row.SetOptions(r.options);
    row.SetDescription(r.descr);
    row.SetDisabled(!!r.disabled);
    row.SetHidden(!!r.hidden);
  }

  return table;
}

/** Write the rows back as an `fp-lib-table` file (LIBRARY_TABLE::Save's text). */
export function serializeFpLibTable(rows: readonly FpLibRow[]): string {
  return libraryTableOf(rows, LIBRARY_TABLE_TYPE.FOOTPRINT).FormatForSave();
}

/** The `.pretty` directory a row's URI points at, without the extension
 *  ("${KIPRJMOD}/footprints.pretty" -> "footprints"). */
export function rowPrettyDir(row: FpLibRow): string {
  const uri = row.uri.replace(/\\/g, '/').replace(/\/+$/, '');
  const base = uri.split('/').pop() ?? '';
  return /\.pretty$/i.test(base) ? base.replace(/\.pretty$/i, '') : '';
}

/** The `.pretty` directory of a project footprint path ("proj/foo.pretty/x.kicad_mod"
 *  -> "foo"), or '' when the file is not inside one. */
export function prettyDirOf(path: string): string {
  const m = /([^/]+)\.pretty\//i.exec(path.replace(/\\/g, '/'));
  return m?.[1] ?? '';
}

/**
 * The nickname a project `.kicad_mod` path is reachable under, the enabled
 * table row whose URI points at its `.pretty` directory. Returns '' when no
 * row registers that directory: unregistered libraries do not exist, exactly
 * as FP_LIB_TABLE::FindRow finds nothing for them.
 */
export function projectLibraryNickname(rows: readonly FpLibRow[], path: string): string {
  const dir = prettyDirOf(path);
  if (!dir) return '';
  const row = rows.find((r) => !r.disabled && rowPrettyDir(r).toLowerCase() === dir.toLowerCase());
  return row ? row.name : '';
}

/** Read the project's `fp-lib-table` out of its files, if it has one. */
export function projectFpLibTable(files: readonly { name: string; text: string }[]): FpLibRow[] {
  const file = files.find((f) => /(^|\/)fp-lib-table$/i.test(f.name.replace(/\\/g, '/')));
  return file ? parseFpLibTable(file.text) : [];
}

/** Path of the project's `fp-lib-table`, existing or to be created (it sits
 *  next to the `.kicad_pro`). */
export function projectFpLibTablePath(files: readonly { name: string; text: string }[]): string {
  const existing = files.find((f) => /(^|\/)fp-lib-table$/i.test(f.name.replace(/\\/g, '/')));
  if (existing) return existing.name;
  const pro = files.find((f) => /\.kicad_pro$/i.test(f.name))?.name.replace(/\\/g, '/');
  const dir = pro?.includes('/') ? pro.slice(0, pro.lastIndexOf('/') + 1) : '';
  return `${dir}fp-lib-table`;
}

/** The `.pretty` directories present in the project, with the nickname (if any)
 *  each is registered under, what "Add Existing" offers. */
export function projectPrettyDirs(
  files: readonly { name: string; text: string }[],
  rows: readonly FpLibRow[],
): { dir: string; path: string; registeredAs: string }[] {
  const seen = new Map<string, string>();
  for (const f of files) {
    const norm = f.name.replace(/\\/g, '/');
    if (!/\.kicad_mod$/i.test(norm)) continue;
    const dir = prettyDirOf(norm);
    if (!dir || seen.has(dir)) continue;
    const at = norm.toLowerCase().indexOf(`${dir.toLowerCase()}.pretty/`);
    seen.set(dir, norm.slice(0, at + dir.length + '.pretty'.length));
  }
  return [...seen].map(([dir, path]) => ({
    dir,
    path,
    registeredAs: rows.find((r) => rowPrettyDir(r).toLowerCase() === dir.toLowerCase())?.name ?? '',
  }));
}
