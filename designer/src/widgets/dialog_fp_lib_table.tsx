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
import type { JSX } from 'react';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
  type LIBRARY_TABLE_ROW,
} from '@ziroeda/common/libraries/library_table.js';
import { findProjectFile, projectRelativePath, projectRoot } from '../fs/project_paths.js';
import {
  fpLibRowsOf,
  projectFpLibTablePath,
  projectPrettyDirs,
  rowPrettyDir,
  type FpLibRow,
} from '../editors/footprint/fp_lib_table.js';
import { hostedLibraryTable, LIB_LOADED, LibTablePanel, libNotFound } from './lib_table_panel.js';

interface Props {
  /** The open project's files (footprints, the table, the `.kicad_pro`). */
  projectFiles: readonly { name: string; text: string }[];
  /** Nicknames of the hosted (global) libraries. */
  globalLibraries: readonly string[];
  /** Where the hosted libraries are served from (their "Library Path"). */
  globalBase: string;
  /** OK: the project table's new rows. */
  onSave: (rows: FpLibRow[]) => void;
  onClose: () => void;
}

/** The `fp-lib-table` anchors `${KIPRJMOD}` for a folder with no `.kicad_pro`. */
const FP_LIB_TABLE_ANCHOR = /(^|\/)fp-lib-table$/i;

/** A `${KIPRJMOD}` / `$(KIPRJMOD)` reference: the only kind a project file can answer. */
const isProjectRelative = (aUri: string): boolean => /^\$[{(]KIPRJMOD[})]/i.test(aUri);

/** The project's `fp-lib-table` as a LIBRARY_TABLE; an empty one when there is none. */
function projectTableOf(files: Props['projectFiles']): LIBRARY_TABLE {
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
  /** Whether the project holds a file under the row's `.pretty` folder. */
  const dirExists = (aRow: LIBRARY_TABLE_ROW): boolean => {
    const dir = projectRelativePath(aRow.URI(), projectRoot(projectFiles, FP_LIB_TABLE_ANCHOR))
      .replace(/\/+$/, '')
      .toLowerCase();

    return (
      dir !== '' &&
      projectFiles.some((f) => f.name.replace(/\\/g, '/').toLowerCase().startsWith(`${dir}/`))
    );
  };

  return (
    <LibTablePanel
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
      projectTable={projectTableOf(projectFiles)}
      checkRow={(row) => {
        if (row.Type() !== 'KiCad' || !isProjectRelative(row.URI())) return undefined;

        // PCB_IO_KICAD_SEXPR's FP_CACHE::Load: "Footprint library '%s' not found."
        return dirExists(row)
          ? LIB_LOADED
          : libNotFound(`Footprint library '${row.URI()}' not found.`);
      }}
      nestedTableExists={(row) =>
        isProjectRelative(row.URI()) &&
        !!findProjectFile(projectFiles, row.URI(), FP_LIB_TABLE_ANCHOR)
      }
      existing={(rows) => {
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
        return projectPrettyDirs(projectFiles, [])
          .filter((d) => !registered.has(d.dir.toLowerCase()))
          .map((d) => ({
            name: d.dir,
            uri: `\${KIPRJMOD}/${d.dir}.pretty`,
            label: `${d.dir}.pretty`,
          }));
      }}
      onSave={(table) => onSave(fpLibRowsOf(table))}
      onClose={onClose}
    />
  );
}
