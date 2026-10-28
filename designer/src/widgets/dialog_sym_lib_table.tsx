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
 * is the library manager's - the user's own, chaining the hosted set - and the
 * hosted set alone, read-only, before the manager has one; "Add Existing" lists the
 * `.kicad_sym` files already in the project instead of opening a file picker.
 */
import { type JSX, useRef } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { kicadSymbolLibWildcard } from '@ziroeda/common/wildcards_and_files_ext.js';
import { acceptAttribute, openFileDialog } from '../fs/open_file_dialog.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
  type LIBRARY_TABLE_ROW,
} from '@ziroeda/common/libraries/library_table.js';
import { findProjectFile } from '@ziroeda/common/project_paths.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { fpLibRowsOf, type FpLibRow } from '@ziroeda/common/fp_lib_table.js';
import {
  AddSymbolLibraryToProject,
  projectSymLibTablePath,
  projectSymbolFiles,
  rowSymLibName,
} from '@ziroeda/eeschema/project_sym_lib_table.js';
import {
  hostedLibraryTable,
  LIB_LOADED,
  type LIB_TABLE_SCOPE,
  LibTablePanel,
  libNotFound,
} from '@ziroeda/common/dialogs/lib_table_panel.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { SCH_IO_KICAD_SEXPR_LIB_CACHE } from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr_lib_cache.js';
import { wxDirEnumerate, wxFileExists, wxWriteFileSync } from '@ziroeda/wx/filefn.js';
import { USER_DIRS } from '../fs/chooser_places.js';

import type { HOSTED_LIBRARY } from '@ziroeda/common/libraries/library_manager.js';
import { PANEL_SYM_LIB_TABLE_BASE } from '@ziroeda/eeschema/dialogs/panel_sym_lib_table_base.js';
interface Props {
  /**
   * The open project's files (`.kicad_sym`, the table, the `.kicad_pro`); null with no project open, which shows the
   * global table alone.
   */
  projectFiles: readonly { name: string; text: string }[] | null;
  /** The hosted (global) libraries: nicknames and descriptions. */
  globalLibraries: readonly HOSTED_LIBRARY[];
  /** Where the hosted libraries are served from (their "Library Path"). */
  globalBase: string;
  /**
   * OK: the project table's new rows, and the library files "Add Existing" took off the
   * computer that a row still names - to be written into the project with the table.
   */
  onSave: (rows: FpLibRow[], files: { name: string; text: string }[]) => void;
  onClose: () => void;
}

/** The `sym-lib-table` anchors `${KIPRJMOD}` for a folder with no `.kicad_pro`. */
const SYM_LIB_TABLE_ANCHOR = /(^|\/)sym-lib-table$/i;

/** A `${KIPRJMOD}` / `$(KIPRJMOD)` reference: the only kind a project file can answer. */
const isProjectRelative = (aUri: string): boolean => /^\$[{(]KIPRJMOD[})]/i.test(aUri);

/** The account's Symbols folder, `GetDefaultUserSymbolsPath()`'s: where a global library lives. */
const ACCOUNT_SYMBOLS = USER_DIRS.symbols;

/** A row naming a library in the account's folder. */
const isAccountLibrary = (aUri: string): boolean => aUri.startsWith(`${ACCOUNT_SYMBOLS}/`);

/** A new library's text: `CreateLibrary`'s empty file. */
const emptyLibrary = (): string => SCH_IO_KICAD_SEXPR_LIB_CACHE.FormatLibrary([]);

/** The project's `sym-lib-table` as a LIBRARY_TABLE; an empty one when there is none. */
function projectTableOf(files: NonNullable<Props['projectFiles']>): LIBRARY_TABLE {
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
  /** The library files "Add Existing" took off the computer for the project, held until OK. */
  const staged = useRef<{ name: string; text: string }[]>([]);
  /** Those it took for the account's folder, by the path each will have there. */
  const stagedGlobal = useRef<{ path: string; text: string }[]>([]);
  /**
   * The paths handed to rows the add button made: the new libraries OK creates. A row whose
   * file has gone missing is not one of them, and keeps its "not found".
   */
  const newLibraries = useRef(new Set<string>());
  /** Whether an account library's file is there, or held to be written on OK. */
  const accountFileExists = (aPath: string): boolean =>
    wxFileExists(aPath) || stagedGlobal.current.some((f) => f.path === aPath);
  /** The project's files as they will be on OK: the checks and the list see the held ones. */
  const files = (): readonly { name: string; text: string }[] => [
    ...(projectFiles ?? []),
    ...staged.current,
  ];
  const rowFile = (aRow: LIBRARY_TABLE_ROW) =>
    findProjectFile(files(), aRow.URI(), SYM_LIB_TABLE_ANCHOR);

  /** The browser's picker over `.kicad_sym`, the hidden input where it has none. */
  const chooseFiles = async (): Promise<File[]> => {
    const filters = [kicadSymbolLibWildcard()];
    let viaInput: Promise<File[]> | null = null;
    const files = await openFileDialog(filters, {
      multiple: true,
      fallback: () => {
        viaInput = new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = true;
          input.accept = acceptAttribute(filters);
          input.addEventListener('cancel', () => resolve([]));
          input.addEventListener('change', () => resolve(Array.from(input.files ?? [])));
          input.click();
        });
      },
    });

    return viaInput ? await viaInput : files;
  };

  /** `browseLibrariesHandler`: `.kicad_sym` files on the computer, held for OK. */
  const pick = async (aScope: LIB_TABLE_SCOPE) => {
    const picked = await chooseFiles();
    const rows: { name: string; uri: string; label: string }[] = [];

    // The Global page's: the file goes into the account's folder, under its own name.
    if (aScope === 'global') {
      for (const file of picked) {
        const path = `${ACCOUNT_SYMBOLS}/${file.name}`;
        const libName = file.name.replace(/\.kicad_sym$/i, '');

        // SYMBOL_EDIT_FRAME::AddLibraryFile's refusal of a name already taken.
        if (accountFileExists(path)) {
          DisplayErrorMessage(`Library '${libName}' already exists.`);
          continue;
        }

        stagedGlobal.current = [...stagedGlobal.current, { path, text: await file.text() }];
        rows.push({ name: LIB_ID.FixIllegalChars(libName, true), uri: path, label: file.name });
      }

      return rows;
    }

    for (const file of picked) {
      const added = AddSymbolLibraryToProject(
        files(),
        { name: file.name, text: await file.text() },
        globalLibraries.map((l) => l.name),
      );

      if (!added.ok) {
        DisplayErrorMessage(added.error);
        continue;
      }

      // The table is this dialog's to write; only the library file is held.
      const libFiles = added.files.filter((f) => !SYM_LIB_TABLE_ANCHOR.test(f.name));
      staged.current = [...staged.current, ...libFiles];
      rows.push({ name: added.nickname, uri: `\${KIPRJMOD}/${file.name}`, label: file.name });
    }

    return rows;
  };

  /**
   * The project files OK writes with the table: the held ones some row of \a aRows still names,
   * and an empty library for each row the add button made whose file the project lacks.
   */
  const kept = (aRows: readonly FpLibRow[]) => {
    const names = new Set(aRows.map((r) => rowSymLibName(r).toLowerCase()).filter(Boolean));
    const held = staged.current.filter((f) =>
      names.has((f.name.split('/').pop() ?? '').replace(/\.kicad_sym$/i, '').toLowerCase()),
    );
    const tablePath = projectSymLibTablePath(projectFiles ?? []);
    const dir = tablePath.includes('/') ? tablePath.slice(0, tablePath.lastIndexOf('/') + 1) : '';
    const created = aRows
      .filter(
        (r) =>
          newLibraries.current.has(r.uri) && !findProjectFile(files(), r.uri, SYM_LIB_TABLE_ANCHOR),
      )
      .map((r) => ({
        name: `${dir}${r.uri.replace(/^\$[{(]KIPRJMOD[})]\//i, '')}`,
        text: emptyLibrary(),
      }));

    return [...held, ...created];
  };

  /**
   * OK, before the global table is saved: each account library a row names that is not there
   * yet - one Add Existing took off the computer, or a new one the add button made - written.
   */
  const writeAccountLibraries = (aRows: readonly LIBRARY_TABLE_ROW[]): void => {
    for (const row of aRows) {
      const path = row.URI();

      if (!isAccountLibrary(path) || wxFileExists(path)) continue;

      const held = stagedGlobal.current.find((f) => f.path === path)?.text;
      const text = held ?? (newLibraries.current.has(path) ? emptyLibrary() : null);

      if (text === null) continue;

      if (!wxWriteFileSync(path, new TextEncoder().encode(text)))
        DisplayErrorMessage(
          `Could not create the library file '${path}'.\n` +
            'Make sure you have write permissions and try again.',
        );
    }
  };

  return (
    <LibTablePanel
      Base={PANEL_SYM_LIB_TABLE_BASE}
      title="Symbol Libraries"
      type={LIBRARY_TABLE_TYPE.SYMBOL}
      preamble="(sym_lib_table"
      supportsVisibilityColumn
      dirVarBase="SYMBOL_DIR"
      globalTable={
        PgmOrNull()
          ?.GetLibraryManager()
          .Table(LIBRARY_TABLE_TYPE.SYMBOL, LIBRARY_TABLE_SCOPE.GLOBAL) ??
        hostedLibraryTable(
          LIBRARY_TABLE_TYPE.SYMBOL,
          globalLibraries,
          (name) => `${globalBase}/${name}.kicad_sym`,
        )
      }
      projectTable={projectFiles ? projectTableOf(projectFiles) : undefined}
      checkRow={(row) => {
        if (row.Type() === 'KiCad' && isAccountLibrary(row.URI()))
          return accountFileExists(row.URI())
            ? LIB_LOADED
            : libNotFound(`Library '${row.URI()}' not found.`);

        if (row.Type() !== 'KiCad' || !isProjectRelative(row.URI())) return undefined;

        // SCH_IO_KICAD_SEXPR_LIB_CACHE::Load: "Library '%s' not found."
        return rowFile(row) ? LIB_LOADED : libNotFound(`Library '${row.URI()}' not found.`);
      }}
      nestedTableExists={(row) =>
        isProjectRelative(row.URI())
          ? !!rowFile(row)
          : // The user's table chaining the stock one: a file the program's mounts answer.
            wxFileExists(PgmOrNull()?.GetLibraryManager().GetFullURI(row, true) ?? row.URI())
      }
      existing={(rows, scope) => {
        // The account's folder: its libraries no row of the global table names yet.
        if (scope === 'global') {
          const named = new Set(rows.map((r) => r.URI()));

          return (wxDirEnumerate(ACCOUNT_SYMBOLS) ?? [])
            .filter((e) => !e.isDir && /\.kicad_sym$/i.test(e.name))
            .filter((e) => !named.has(`${ACCOUNT_SYMBOLS}/${e.name}`))
            .map((e) => ({
              name: e.name.replace(/\.kicad_sym$/i, ''),
              uri: `${ACCOUNT_SYMBOLS}/${e.name}`,
              label: e.name,
            }));
        }

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
        return projectSymbolFiles(files(), [])
          .filter((d) => !registered.has(d.file.toLowerCase()))
          .map((d) => ({
            name: d.file,
            uri: `\${KIPRJMOD}/${d.file}.kicad_sym`,
            label: `${d.file}.kicad_sym`,
          }));
      }}
      browse={{ label: 'KiCad from Computer...', pick }}
      newLibraryUri={(scope, nickname) => {
        const uri =
          scope === 'global'
            ? `${ACCOUNT_SYMBOLS}/${nickname}.kicad_sym`
            : `\${KIPRJMOD}/${nickname}.kicad_sym`;

        newLibraries.current.add(uri);
        return uri;
      }}
      beforeGlobalSave={writeAccountLibraries}
      onSave={(table) => {
        const rows = fpLibRowsOf(table);
        onSave(rows, kept(rows));
      }}
      onClose={onClose}
    />
  );
}
