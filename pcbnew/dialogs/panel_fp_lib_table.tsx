// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Manage Footprint Libraries. Counterpart: `pcbnew/dialogs/panel_fp_lib_table.cpp`
 * (PANEL_FP_LIB_TABLE in DIALOG_EDIT_LIBRARY_TABLES, opened by
 * ACTIONS::showFootprintLibTable): the shared library-table panel
 * (`lib_table_panel.tsx`) with the footprint table's differences -
 * `FP_GRID_TRICKS` has no Show column (TransferDataToWindow hides it: "No
 * visibility control for footprint libraries yet") and the `(fp_lib_table`
 * preamble, the substitutions list always shows `KICAD10_FOOTPRINT_DIR`, and
 * a row is checked by finding its `.pretty` folder.
 *
 * Registering a library here is what makes it exist: FP_LIB_TABLE resolves an
 * FPID's nickname through these tables, so a `.pretty` folder that no row
 * points at is not a library and every assignment into it stays unresolved.
 *
 * Web deltas (the panel's file comment has the shared ones): the global table
 * is the hosted library set and read-only; "Add Existing" lists the `.pretty`
 * folders already in the project instead of opening a directory picker.
 */
import { type JSX, useRef } from 'react';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { ChooseLocalFolder } from '@ziroeda/wx/dirdlg.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
  type LIBRARY_TABLE_ROW,
} from '@ziroeda/common/libraries/library_table.js';
import {
  findProjectFile,
  projectRelativePath,
  projectRoot,
} from '@ziroeda/common/project_paths.js';
import {
  AddFootprintLibraryToProject,
  fpLibRowsOf,
  projectFpLibTablePath,
  prettyDirOf,
  projectPrettyDirs,
  rowPrettyDir,
  type FpLibRow,
} from '@ziroeda/common/fp_lib_table.js';
import {
  hostedLibraryTable,
  LIB_LOADED,
  LibTablePanel,
  libNotFound,
} from '@ziroeda/common/dialogs/lib_table_panel.js';

import { PANEL_FP_LIB_TABLE_BASE } from './panel_fp_lib_table_base.js';
interface Props {
  /**
   * The open project's files (footprints, the table, the `.kicad_pro`); null with no project open, which shows the
   * global table alone.
   */
  projectFiles: readonly { name: string; text: string }[] | null;
  /** Nicknames of the hosted (global) libraries. */
  globalLibraries: readonly string[];
  /** Where the hosted libraries are served from (their "Library Path"). */
  globalBase: string;
  /**
   * OK: the project table's new rows, and the library folders "Add Existing" took off the
   * computer that a row still names - to be written into the project with the table.
   */
  onSave: (rows: FpLibRow[], files: { name: string; text: string }[]) => void;
  onClose: () => void;
}

/** The `fp-lib-table` anchors `${KIPRJMOD}` for a folder with no `.kicad_pro`. */
const FP_LIB_TABLE_ANCHOR = /(^|\/)fp-lib-table$/i;

/** A `${KIPRJMOD}` / `$(KIPRJMOD)` reference: the only kind a project file can answer. */
const isProjectRelative = (aUri: string): boolean => /^\$[{(]KIPRJMOD[})]/i.test(aUri);

/** The project's `fp-lib-table` as a LIBRARY_TABLE; an empty one when there is none. */
function projectTableOf(files: NonNullable<Props['projectFiles']>): LIBRARY_TABLE {
  const path = projectFpLibTablePath(files);
  const file = files.find((f) => f.name === path);

  if (!file) {
    const table = LIBRARY_TABLE.Empty(LIBRARY_TABLE_SCOPE.PROJECT, LIBRARY_TABLE_TYPE.FOOTPRINT);
    table.SetPath(path);
    return table;
  }

  return LIBRARY_TABLE.FromFile(
    path,
    file.text,
    LIBRARY_TABLE_SCOPE.PROJECT,
    LIBRARY_TABLE_TYPE.FOOTPRINT,
  );
}

export function DialogFpLibTable({
  projectFiles,
  globalLibraries,
  globalBase,
  onSave,
  onClose,
}: Props): JSX.Element {
  /** The folders "Add Existing" took off the computer, held until OK. */
  const staged = useRef<{ name: string; text: string }[]>([]);
  /** The project's files as they will be on OK: the checks and the list see the held ones. */
  const files = (): readonly { name: string; text: string }[] => [
    ...(projectFiles ?? []),
    ...staged.current,
  ];

  /** Whether the project holds a file under the row's `.pretty` folder. */
  const dirExists = (aRow: LIBRARY_TABLE_ROW): boolean => {
    const dir = projectRelativePath(aRow.URI(), projectRoot(files(), FP_LIB_TABLE_ANCHOR))
      .replace(/\/+$/, '')
      .toLowerCase();

    return (
      dir !== '' &&
      files().some((f) => f.name.replace(/\\/g, '/').toLowerCase().startsWith(`${dir}/`))
    );
  };

  /** `browseLibrariesHandler`: a `.pretty` folder on the computer, held for OK. */
  const pick = async () => {
    const folder = await ChooseLocalFolder();

    if (!folder) return [];

    const decoder = new TextDecoder();
    const added = AddFootprintLibraryToProject(files(), {
      name: folder.name,
      files: folder.files.map((f) => ({ path: f.path, text: decoder.decode(f.bytes) })),
    });

    if (!added.ok) {
      DisplayErrorMessage(added.error);
      return [];
    }

    // The table is this dialog's to write; only the library's own files are held.
    const libFiles = added.files.filter((f) => !FP_LIB_TABLE_ANCHOR.test(f.name));
    const libDir = libFiles[0]!.name.split('/').slice(-2, -1)[0]!;
    staged.current = [...staged.current, ...libFiles];

    return [{ name: added.nickname, uri: `\${KIPRJMOD}/${libDir}`, label: libDir }];
  };

  /** The held folders some row of \a aRows still names: the ones OK writes. */
  const kept = (aRows: readonly FpLibRow[]) => {
    const dirs = new Set(aRows.map((r) => rowPrettyDir(r).toLowerCase()).filter(Boolean));

    return staged.current.filter((f) => dirs.has(prettyDirOf(f.name).toLowerCase()));
  };

  return (
    <LibTablePanel
      Base={PANEL_FP_LIB_TABLE_BASE}
      title="Footprint Libraries"
      type={LIBRARY_TABLE_TYPE.FOOTPRINT}
      preamble="(fp_lib_table"
      supportsVisibilityColumn={false}
      dirVarBase="FOOTPRINT_DIR"
      globalTable={hostedLibraryTable(
        LIBRARY_TABLE_TYPE.FOOTPRINT,
        globalLibraries,
        (name) => `${globalBase}/${name}.pretty`,
      )}
      projectTable={projectFiles ? projectTableOf(projectFiles) : undefined}
      checkRow={(row) => {
        if (row.Type() !== 'KiCad' || !isProjectRelative(row.URI())) return undefined;

        // PCB_IO_KICAD_SEXPR's FP_CACHE::Load: "Footprint library '%s' not found."
        return dirExists(row)
          ? LIB_LOADED
          : libNotFound(`Footprint library '${row.URI()}' not found.`);
      }}
      nestedTableExists={(row) =>
        isProjectRelative(row.URI()) && !!findProjectFile(files(), row.URI(), FP_LIB_TABLE_ANCHOR)
      }
      existing={(rows, scope) => {
        if (scope !== 'project') return [];

        // A folder whose name a row's `.pretty` already has is registered.
        const registered = new Set(
          rows.map((r) =>
            rowPrettyDir({
              name: '',
              type: '',
              uri: r.URI(),
              options: '',
              descr: '',
            }).toLowerCase(),
          ),
        );
        return projectPrettyDirs(files(), [])
          .filter((d) => !registered.has(d.dir.toLowerCase()))
          .map((d) => ({
            name: d.dir,
            uri: `\${KIPRJMOD}/${d.dir}.pretty`,
            label: `${d.dir}.pretty`,
          }));
      }}
      // Footprint libraries in the account are not here yet: a folder only joins the project.
      browse={{ label: 'KiCad (folder) from Computer...', pick, scopes: ['project'] }}
      onSave={(table) => {
        const rows = fpLibRowsOf(table);
        onSave(rows, kept(rows));
      }}
      onClose={onClose}
    />
  );
}
