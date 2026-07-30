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

import { parse } from '@ziroeda/sexpr';
import { arg, childNamed, childrenNamed } from '@ziroeda/sexpr/src/query.js';

/** A LIB_TABLE_ROW: `(lib (name "X")(type "KiCad")(uri "…")(options "")(descr ""))`. */
export interface FpLibRow {
  name: string;
  type: string;
  uri: string;
  options: string;
  descr: string;
  /** `(disabled)`, the row's "Enable" checkbox; a disabled row is not loaded. */
  disabled?: boolean;
}

/** Parse an `fp-lib-table` file. Malformed text yields no rows. */
export function parseFpLibTable(text: string): FpLibRow[] {
  let root: ReturnType<typeof parse>;
  try {
    root = parse(text);
  } catch {
    return [];
  }
  const field = (lib: Parameters<typeof childNamed>[0], key: string): string => {
    const node = childNamed(lib, key);
    return node ? (arg(node, 0) ?? '') : '';
  };
  return childrenNamed(root, 'lib')
    .map((lib) => ({
      name: field(lib, 'name'),
      type: field(lib, 'type') || 'KiCad',
      uri: field(lib, 'uri'),
      options: field(lib, 'options'),
      descr: field(lib, 'descr'),
      disabled: !!childNamed(lib, 'disabled'),
    }))
    .filter((r) => r.name);
}

/** Write the rows back as an `fp-lib-table` file (FP_LIB_TABLE::Format). */
export function serializeFpLibTable(rows: readonly FpLibRow[]): string {
  const q = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const lines = rows.map(
    (r) =>
      `\t(lib (name ${q(r.name)})(type ${q(r.type || 'KiCad')})(uri ${q(r.uri)})` +
      `(options ${q(r.options)})(descr ${q(r.descr)})${r.disabled ? '(disabled)' : ''})`,
  );
  return `(fp_lib_table\n\t(version 7)\n${lines.join('\n')}${lines.length ? '\n' : ''})\n`;
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
