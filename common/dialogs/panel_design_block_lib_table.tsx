// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Manage Design Block Libraries. Counterpart: `common/dialogs/panel_design_block_lib_table.cpp`
 * (PANEL_DESIGN_BLOCK_LIB_TABLE in DIALOG_EDIT_LIBRARY_TABLES, opened by
 * ACTIONS::showDesignBlockLibTable): the shared library-table panel (`lib_table_panel.tsx`) with
 * the design block table's differences - the `(design_block_lib_table` preamble, the Show column
 * (DESIGN_BLOCK_GRID_TRICKS::SupportsVisibilityColumn), and a row checked by finding its
 * `.kicad_blocks` folder.
 *
 * As the symbol and footprint tables have it, a library's place is its page: the Global page is
 * the user's own table, its libraries in the account's Design Blocks folder; the Project page's are
 * in the project. The add button's row is a new, empty `.kicad_blocks` there
 * (DESIGN_BLOCK_IO::CreateLibrary's directory), made on OK. The Global page's KiCad row chains
 * the stock table, empty until KiCad ships design blocks; upstream's panel has no Reset Libraries.
 */
import type { JSX } from 'react';
import { useRef } from 'react';
import { DisplayErrorMessage } from '../confirm.js';
import { LIB_LOADED, LibTablePanel, libNotFound } from './lib_table_panel.js';
import {
  LIBRARY_TABLE,
  type LIBRARY_TABLE_ROW,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '../libraries/library_table.js';
import { PATHS } from '../paths.js';
import { PgmOrNull } from '../pgm_base.js';
import { findProjectFile, projectRelativePath, projectRoot } from '../project_paths.js';
import { KiCadDesignBlockLibPathExtension } from '../wildcards_and_files_ext.js';
import { wxDirEnumerate, wxDirExists, wxFileExists, wxMkdir } from '@ziroeda/wx/filefn.js';
import { PANEL_DESIGN_BLOCK_LIB_TABLE_BASE } from './panel_design_block_lib_table_base.js';

type ProjectFile = { name: string; text: string };

interface Props {
  /** The open project's files; null with no project open, which shows the global table alone. */
  projectFiles: readonly ProjectFile[] | null;
  /**
   * The project's folders that hold no file (the project store's `emptyFolders`), by the same
   * project-relative names its files have: a new library before its first design block.
   */
  emptyFolders?: readonly string[];
  /**
   * OK with a changed project table: its file, and the new, empty libraries' folders the add
   * button made in the project.
   */
  onSave: (aTable: ProjectFile, aFolders: string[]) => void;
  onClose: () => void;
}

const TABLE_FILE_NAME = 'design-block-lib-table';

/** The `design-block-lib-table` anchors `${KIPRJMOD}` for a folder with no `.kicad_pro`. */
const TABLE_ANCHOR = /(^|\/)design-block-lib-table$/i;

/** The account's Design Blocks folder: a global library of the user's own is a folder in it. */
const ACCOUNT_DESIGN_BLOCKS = PATHS.GetDefaultUserDesignBlocksPath();

const LIBRARY_DIR = new RegExp(`\\.${KiCadDesignBlockLibPathExtension}$`, 'i');

/** Whether \a aUri names a library in the account's Design Blocks folder. */
const isAccountLibrary = (aUri: string): boolean => aUri.startsWith(`${ACCOUNT_DESIGN_BLOCKS}/`);

/** A `${KIPRJMOD}` / `$(KIPRJMOD)` reference: the only kind a project file can answer. */
const isProjectRelative = (aUri: string): boolean => /^\$[{(]KIPRJMOD[})]/i.test(aUri);

/** Where the project's table is, or goes: beside the `.kicad_pro`. */
export function projectDesignBlockLibTablePath(aFiles: readonly ProjectFile[]): string {
  // projectRoot answers with its trailing slash, or '' for the top.
  return `${projectRoot(aFiles, TABLE_ANCHOR)}${TABLE_FILE_NAME}`;
}

/** The project's `design-block-lib-table` as a LIBRARY_TABLE; an empty one when there is none. */
function projectTableOf(aFiles: readonly ProjectFile[]): LIBRARY_TABLE {
  const path = projectDesignBlockLibTablePath(aFiles);
  const file = aFiles.find((f) => f.name === path);

  if (!file) {
    const table = LIBRARY_TABLE.Empty(LIBRARY_TABLE_SCOPE.PROJECT, LIBRARY_TABLE_TYPE.DESIGN_BLOCK);
    table.SetPath(path);
    return table;
  }

  return LIBRARY_TABLE.FromFile(
    path,
    file.text,
    LIBRARY_TABLE_SCOPE.PROJECT,
    LIBRARY_TABLE_TYPE.DESIGN_BLOCK,
  );
}

export function DialogDesignBlockLibTable({
  projectFiles,
  emptyFolders = [],
  onSave,
  onClose,
}: Props): JSX.Element {
  /** The new project libraries' folders the add button made, by project-relative name, until OK. */
  const made = useRef(new Set<string>());
  /** The account folders the add button's rows on the Global page name: made on OK. */
  const madeGlobal = useRef(new Set<string>());
  const files = (): readonly ProjectFile[] => projectFiles ?? [];

  /** The row's folder, by the project-relative name its files would have. */
  const folderOf = (aUri: string): string =>
    projectRelativePath(aUri, projectRoot(files(), TABLE_ANCHOR)).replace(/\/+$/, '');

  /** Whether the row's library folder is in the project: holding a file, or an empty one. */
  const dirExists = (aRow: LIBRARY_TABLE_ROW): boolean => {
    const dir = folderOf(aRow.URI()).toLowerCase();

    if (dir === '') return false;

    if ([...emptyFolders, ...made.current].some((d) => d.toLowerCase() === dir)) return true;

    return files().some((f) => f.name.replace(/\\/g, '/').toLowerCase().startsWith(`${dir}/`));
  };

  /** OK, before the global table is saved: each account library a new row names, made. */
  const makeAccountLibraries = (aRows: readonly LIBRARY_TABLE_ROW[]): void => {
    for (const row of aRows) {
      const path = row.URI();

      if (!madeGlobal.current.has(path) || wxDirExists(path)) continue;

      if (!wxMkdir(path))
        DisplayErrorMessage(
          `Could not create the library folder '${path}'.\n` +
            'Make sure you have write permissions and try again.',
        );
    }
  };

  const globalTable =
    PgmOrNull()
      ?.GetLibraryManager()
      .Table(LIBRARY_TABLE_TYPE.DESIGN_BLOCK, LIBRARY_TABLE_SCOPE.GLOBAL) ??
    LIBRARY_TABLE.Empty(LIBRARY_TABLE_SCOPE.GLOBAL, LIBRARY_TABLE_TYPE.DESIGN_BLOCK);

  return (
    <LibTablePanel
      Base={PANEL_DESIGN_BLOCK_LIB_TABLE_BASE}
      title="Design Block Libraries"
      type={LIBRARY_TABLE_TYPE.DESIGN_BLOCK}
      preamble="(design_block_lib_table"
      supportsVisibilityColumn
      dirVarBase="DESIGN_BLOCK_DIR"
      globalTable={globalTable}
      projectTable={projectFiles ? projectTableOf(projectFiles) : undefined}
      checkRow={(row) => {
        if (row.Type() === 'KiCad' && isAccountLibrary(row.URI()))
          return wxDirExists(row.URI()) || madeGlobal.current.has(row.URI())
            ? LIB_LOADED
            : libNotFound(`Design block library '${row.URI()}' not found.`);

        if (row.Type() !== 'KiCad' || !isProjectRelative(row.URI())) return undefined;

        return dirExists(row)
          ? LIB_LOADED
          : libNotFound(`Design block library '${row.URI()}' not found.`);
      }}
      nestedTableExists={(row) =>
        isProjectRelative(row.URI())
          ? !!findProjectFile(files(), row.URI(), TABLE_ANCHOR)
          : wxFileExists(PgmOrNull()?.GetLibraryManager().GetFullURI(row, true) ?? row.URI())
      }
      existing={(rows, scope) => {
        const named = new Set(rows.map((r) => r.URI()));

        // The account's folder: its libraries no row of the global table names yet.
        if (scope === 'global')
          return (wxDirEnumerate(ACCOUNT_DESIGN_BLOCKS) ?? [])
            .filter((e) => e.isDir && LIBRARY_DIR.test(e.name))
            .filter((e) => !named.has(`${ACCOUNT_DESIGN_BLOCKS}/${e.name}`))
            .map((e) => ({
              name: e.name.replace(LIBRARY_DIR, ''),
              uri: `${ACCOUNT_DESIGN_BLOCKS}/${e.name}`,
              label: e.name,
            }));

        // The project's: the library folders it holds that no row names.
        const prefix = projectRoot(files(), TABLE_ANCHOR);
        const dirs = new Set<string>();

        for (const f of files()) {
          const name = f.name.replace(/\\/g, '/');

          if (!name.startsWith(prefix)) continue;

          const first = name.slice(prefix.length).split('/')[0]!;

          if (LIBRARY_DIR.test(first)) dirs.add(first);
        }

        return [...dirs]
          .filter((d) => !named.has(`\${KIPRJMOD}/${d}`))
          .map((d) => ({
            name: d.replace(LIBRARY_DIR, ''),
            uri: `\${KIPRJMOD}/${d}`,
            label: d,
          }));
      }}
      newLibraryUri={(scope, nickname) => {
        const dir = `${nickname}.${KiCadDesignBlockLibPathExtension}`;

        if (scope === 'global') {
          const uri = `${ACCOUNT_DESIGN_BLOCKS}/${dir}`;
          madeGlobal.current.add(uri);
          return uri;
        }

        const uri = `\${KIPRJMOD}/${dir}`;
        made.current.add(folderOf(uri));
        return uri;
      }}
      beforeGlobalSave={makeAccountLibraries}
      onSave={(table) => {
        const named = new Set(table.Rows().map((r) => folderOf(r.URI()).toLowerCase()));
        // A made folder no row names any more is not made.
        const folders = [...made.current].filter((d) => named.has(d.toLowerCase()));

        onSave(
          { name: projectDesignBlockLibTablePath(files()), text: table.FormatForSave() },
          folders,
        );
      }}
      onClose={onClose}
    />
  );
}
