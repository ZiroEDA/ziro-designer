// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Manage Symbol Libraries. Counterpart: `eeschema/dialogs/panel_sym_lib_table.cpp`
 * (PANEL_SYM_LIB_TABLE in DIALOG_EDIT_LIBRARY_TABLES, opened by
 * ACTIONS::showSymbolLibTable): the shared library-table panel
 * (`lib_table_panel.tsx`) with the symbol table's differences -
 * `SYMBOL_GRID_TRICKS` has the Show column and the `(sym_lib_table` preamble,
 * the substitutions list always shows `KICAD10_SYMBOL_DIR`, and a row is
 * checked by finding its `.kicad_sym`.
 *
 * Registering a library here is what makes it exist: SYMBOL_LIB_TABLE resolves a
 * LIB_ID's nickname through the project table then the global one, so a
 * `.kicad_sym` sitting in the project folder is not a library and every symbol
 * placed from it stays unresolved. This dialog is the only way to register one,
 * which is why the file listing under "Add Existing" writes a row rather than
 * quietly treating the file as usable.
 *
 * Web deltas (the panel's file comment has the shared ones): the global table
 * is the hosted library set and read-only; "Add Existing" lists the
 * `.kicad_sym` files already in the project instead of opening a file picker.
 */
import type { JSX } from 'react';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
  type LIBRARY_TABLE_ROW,
} from '@ziroeda/common/libraries/library_table.js';
import { findProjectFile } from '@ziroeda/common/project_paths.js';
import { fpLibRowsOf, type FpLibRow } from '@ziroeda/common/fp_lib_table.js';
import {
  projectSymLibTablePath,
  projectSymbolFiles,
  rowSymLibName,
} from '@ziroeda/eeschema/project_sym_lib_table.js';
import {
  hostedLibraryTable,
  LIB_LOADED,
  LibTablePanel,
  libNotFound,
} from '@ziroeda/common/dialogs/lib_table_panel.js';

interface Props {
  /** The open project's files (`.kicad_sym`, the table, the `.kicad_pro`). */
  projectFiles: readonly { name: string; text: string }[];
  /** Nicknames of the hosted (global) libraries. */
  globalLibraries: readonly string[];
  /** Where the hosted libraries are served from (their "Library Path"). */
  globalBase: string;
  /** OK: the project table's new rows. */
  onSave: (rows: FpLibRow[]) => void;
  onClose: () => void;
}

/** The `sym-lib-table` anchors `${KIPRJMOD}` for a folder with no `.kicad_pro`. */
const SYM_LIB_TABLE_ANCHOR = /(^|\/)sym-lib-table$/i;

/** A `${KIPRJMOD}` / `$(KIPRJMOD)` reference: the only kind a project file can answer. */
const isProjectRelative = (aUri: string): boolean => /^\$[{(]KIPRJMOD[})]/i.test(aUri);

/** The project's `sym-lib-table` as a LIBRARY_TABLE; an empty one when there is none. */
function projectTableOf(files: Props['projectFiles']): LIBRARY_TABLE {
  const path = projectSymLibTablePath(files);
  const file = files.find((f) => f.name === path);

  if (!file) {
    const table = LIBRARY_TABLE.Empty(LIBRARY_TABLE_SCOPE.PROJECT, LIBRARY_TABLE_TYPE.SYMBOL);
    table.SetPath(path);
    return table;
  }

  return LIBRARY_TABLE.FromFile(
    path,
    file.text,
    LIBRARY_TABLE_SCOPE.PROJECT,
    LIBRARY_TABLE_TYPE.SYMBOL,
  );
}

export function DialogSymLibTable({
  projectFiles,
  globalLibraries,
  globalBase,
  onSave,
  onClose,
}: Props): JSX.Element {
  const rowFile = (aRow: LIBRARY_TABLE_ROW) =>
    findProjectFile(projectFiles, aRow.URI(), SYM_LIB_TABLE_ANCHOR);

  return (
    <LibTablePanel
      title="Symbol Libraries"
      type={LIBRARY_TABLE_TYPE.SYMBOL}
      preamble="(sym_lib_table"
      supportsVisibilityColumn
      dirVarBase="SYMBOL_DIR"
      globalTable={hostedLibraryTable(
        LIBRARY_TABLE_TYPE.SYMBOL,
        globalLibraries,
        (name) => `${globalBase}/${name}.kicad_sym`,
      )}
      projectTable={projectTableOf(projectFiles)}
      checkRow={(row) => {
        if (row.Type() !== 'KiCad' || !isProjectRelative(row.URI())) return undefined;

        // SCH_IO_KICAD_SEXPR_LIB_CACHE::Load: "Library '%s' not found."
        return rowFile(row) ? LIB_LOADED : libNotFound(`Library '${row.URI()}' not found.`);
      }}
      nestedTableExists={(row) => isProjectRelative(row.URI()) && !!rowFile(row)}
      existing={(rows) => {
        // A file whose name a row's `.kicad_sym` already has is registered.
        const registered = new Set(
          rows.map((r) =>
            rowSymLibName({
              name: '',
              type: '',
              uri: r.URI(),
              options: '',
              descr: '',
            }).toLowerCase(),
          ),
        );
        return projectSymbolFiles(projectFiles, [])
          .filter((d) => !registered.has(d.file.toLowerCase()))
          .map((d) => ({
            name: d.file,
            uri: `\${KIPRJMOD}/${d.file}.kicad_sym`,
            label: `${d.file}.kicad_sym`,
          }));
      }}
      onSave={(table) => onSave(fpLibRowsOf(table))}
      onClose={onClose}
    />
  );
}
