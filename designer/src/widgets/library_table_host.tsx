// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The program's answer to `KIFACE::CreateKiWindow( DIALOG_SCH_LIBRARY_TABLE )` and
 * `( DIALOG_PCB_LIBRARY_TABLE )` (eeschema.cpp, pcbnew.cpp): Manage Symbol Libraries and Manage
 * Footprint Libraries, which `COMMON_CONTROL::ShowLibraryTable` raises from any frame. Upstream
 * the kiface that owns the table puts the dialog up over whichever frame asked; here the program
 * does, over the open project's files, and OK writes the project table - with any library
 * "Add Existing" brought in off the computer - into the project.
 */
import { type JSX, useEffect, useState } from 'react';
import type { HOSTED_LIBRARY } from '@ziroeda/common/libraries/library_manager.js';
import { projectFpLibTablePath, serializeFpLibTable } from '@ziroeda/common/fp_lib_table.js';
import {
  projectSymLibTablePath,
  serializeSymLibTable,
} from '@ziroeda/eeschema/project_sym_lib_table.js';
import { DialogFpLibTable } from '@ziroeda/pcbnew/dialogs/panel_fp_lib_table.js';
import { loadIndex } from '../editors/schematic/symbols/index.js';
import { fetchLibraryIndex, libraryBase } from '../libraryHosts.js';
import { DialogSymLibTable } from './dialog_sym_lib_table.js';

type ProjectFile = { name: string; text: string };

export function LibraryTableHost({
  kind,
  projectFiles,
  onWrite,
  onClose,
}: {
  kind: 'symbol' | 'footprint';
  /** The open project's files; null with none open, when only the global table shows. */
  projectFiles: readonly ProjectFile[] | null;
  /** The project table and the libraries brought in, into the open project. */
  onWrite: (files: ProjectFile[]) => void;
  onClose: () => void;
}): JSX.Element | null {
  // The global table's stand-in: the hosted library set, by nickname (and, for symbols, description). Upstream the global tables
  // are loaded at program start (PGM_KICAD::OnPgmInit), so the dialog never opens before them;
  // here they wait on the hosted index, and the dialog, whose pages are built once, waits too.
  // For symbols, loadIndex also reads the user's own table into the library manager.
  const [globalLibraries, setGlobalLibraries] = useState<readonly HOSTED_LIBRARY[] | null>(null);

  useEffect(() => {
    let live = true;
    // The symbol index carries each library's stock-table description; the footprint index's
    // `descr` is per footprint, a list, and its libraries' own are not in it.
    const libraries: Promise<HOSTED_LIBRARY[]> =
      kind === 'symbol'
        ? loadIndex()
            .then(() => fetchLibraryIndex<HOSTED_LIBRARY>('symbols'))
            .then((index) => index.map(({ name, descr }) => ({ name, descr })))
        : fetchLibraryIndex<{ name: string }>('footprints').then((index) =>
            index.map(({ name }) => ({ name })),
          );

    void libraries
      .then((index) => live && setGlobalLibraries(index))
      // An index that cannot be had leaves the global page empty rather than no dialog at all.
      .catch(() => live && setGlobalLibraries([]));
    return () => {
      live = false;
    };
  }, [kind]);

  if (!globalLibraries) return null;

  // onSave comes only for a changed project table, so `projectFiles` is a project's there.
  if (kind === 'symbol')
    return (
      <DialogSymLibTable
        projectFiles={projectFiles}
        globalLibraries={globalLibraries}
        globalBase={libraryBase.symbols}
        onSave={(rows, files) => {
          onWrite([
            { name: projectSymLibTablePath(projectFiles ?? []), text: serializeSymLibTable(rows) },
            ...files,
          ]);
          onClose();
        }}
        onClose={onClose}
      />
    );

  return (
    <DialogFpLibTable
      projectFiles={projectFiles}
      globalLibraries={globalLibraries}
      globalBase={libraryBase.footprints}
      onSave={(rows, files) => {
        onWrite([
          { name: projectFpLibTablePath(projectFiles ?? []), text: serializeFpLibTable(rows) },
          ...files,
        ]);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
