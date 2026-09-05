// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The places sidebar every file dialog draws.
 *
 * Upstream this is `GtkPlacesSidebar`, and GTK builds it once for every
 * `wxFileDialog` in the process — Home, Desktop, Documents, Downloads, Other
 * Locations, the same rows in the project manager's dialog and in an editor's.
 * Ours was assembled inside `HomePage`, so it existed in exactly one window and
 * every other file dialog opened with no sidebar at all: a bare tree, with no
 * way to reach Recent and no name for the root you were standing in.
 *
 * This tree has one root and no computer, so the rows are ours to choose:
 * Recent, Projects, Demos and Templates. Every dialog lists all four, and each
 * one says whether a file may be SAVED into it — which is the other half of
 * what GTK's sidebar does. Recent is a list of things you opened rather than
 * somewhere on the disk; Demos and Templates are read-only catalogues; only
 * the account's own tree takes a write. `listFileSystem` already refuses those
 * writes, but a dialog that lets a person type a name and press Save before
 * saying so has gated nothing.
 */

import { listProjects } from '../home/projectStore.js';
import type { ChooserPlace } from './chooser_types.js';
import { listFileSystem } from './list_fs.js';
import type { FileSystem } from './filesystem.js';

/**
 * `Recent`, as a tree rather than a flat list.
 *
 * `below` delegates everything under a project folder to the account's own
 * tree, which is what makes walking into a recent project show its files
 * instead of an empty folder — and what makes a path picked in here a real
 * path in the account, so the caller needs no special case for it.
 */
/**
 * The account's tree with the shared folders hidden from its root.
 *
 * Templates, Symbols, Footprints and 3D Models sit at the root beside the
 * projects, because the account's tree is this app's file manager and that is
 * where they live. In **Open Existing Project** they are noise of the worst
 * kind: four rows that look exactly like the thing being asked for and can
 * never be it. The dialog already refuses to accept one -- they are `folder`,
 * not `project` -- so all they do is push the projects down the list.
 *
 * Only the root, and only `list`. Everything else delegates, so a path picked
 * here is still a real path in the account and walking into a project still
 * shows its files.
 *
 * Deliberately NOT used by New Project Folder, which lists the same root: there
 * the four names are the reserved ones, and somebody about to create a project
 * called "Templates" is better off seeing that it is taken than finding out
 * when the save collides.
 */
export function projectsOnlyFileSystem(below: FileSystem): FileSystem {
  const hidden = new Set(Object.values(USER_DIRS).map((p) => p.replace(/^\/+/, '')));
  return {
    ...below,
    async list(dir) {
      const entries = await below.list(dir);
      // The root is the only level they appear at, and a project of the same
      // name would be a different path -- so comparing the path rather than the
      // name is what keeps a project called "Symbols" visible.
      return entries.filter((e) => !(hidden.has(e.name) && e.path === `/${e.name}`));
    },
  };
}

export function recentFileSystem(below: FileSystem): FileSystem {
  return listFileSystem(
    async () => ({
      files: (await listProjects())
        .filter((p) => p.lastOpenedAt !== undefined)
        .map((p) => ({
          name: p.name,
          // A project is a folder and a folder shows no size.
          size: 0,
          modified: p.lastOpenedAt ?? p.updatedAt,
        })),
    }),
    { below },
  );
}
/**
 * The rows a file dialog over the account's tree gets.
 *
 * Two, and both are the account's own content.
 *
 * Upstream's sidebar is a `GtkPlacesSidebar`: Recent, Home, Desktop, Downloads,
 * Trash, Other Locations - the COMPUTER's places - plus the one shortcut
 * `openProject` adds, `dlg.AddShortcut( PATHS::GetDefaultUserProjectsPath() )`
 * (kicad/tools/kicad_manager_control.cpp:493). It has no Demos row and no
 * Templates row: demos are reached through `File > Open Demo Project` and
 * templates through the template selector, both separate windows.
 *
 * Ours had both as rows, and they were the wrong shape twice over. They are
 * served from the CDN, identical for every account and never writable, so a
 * file manager showed folders nobody can change; and the stock half of
 * Templates sat in the same list as the user's own, which said a bundled
 * template could be renamed. On a desktop that distinction is buried deep
 * enough that nobody meets it - here it was the second row of a two-row
 * sidebar.
 *
 * The rule the tree follows now: what a person can change is what the file
 * manager shows. Everything read-only reaches them through the window that
 * owns it, which is where upstream puts it too.
 */
/**
 * The account tree's shared folders — KiCad's own user-data layout.
 *
 * `~/.local/share/kicad/<ver>/` holds one folder per KIND of thing a user
 * makes, and every one of these is a real `PATHS::` function:
 *
 *     projects     GetDefaultUserProjectsPath()     (paths.cpp:137)
 *     template     GetUserTemplatesPath()           (:355 via getUserDocumentPath)
 *     symbols      GetDefaultUserSymbolsPath()      (:82)
 *     footprints   GetDefaultUserFootprintsPath()   (:93)
 *     3dmodels     GetDefaultUser3DModelsPath()     (:115)
 *
 * They are FOLDERS of the one account tree, siblings of the project folders,
 * not separate stores. That is the whole point: on a desktop a drawing sheet
 * can live in the project directory, in the user templates directory, or
 * anywhere on the disk — three storage AREAS. This tree has one, so "shared
 * across projects" is a different folder rather than a different place, and the
 * file manager can show every byte the account owns.
 *
 * What is NOT here is anything derived from a single project. Gerbers plot into
 * the project's own `gerbers/` or they download, which is what we already do
 * (`dialog_plot_pcb.tsx:93,121-133`) and what KiCad does, its plot directory
 * being made relative to the project (dialog_plot.cpp:827-832) with no outputs
 * root anywhere. A shared outputs folder would pool every board's gerbers into
 * one bucket, which is the mess it was meant to prevent, moved.
 */
export const USER_DIRS = {
  templates: '/Templates',
  symbols: '/Symbols',
  footprints: '/Footprints',
  models3d: '/3D Models',
} as const;

/** Which shared folder a document kind belongs in. */
export type AssetKind = keyof typeof USER_DIRS;

/**
 * The rows one dialog gets: the project, and the shared folder for this kind.
 *
 * Upstream's sidebar is a `GtkPlacesSidebar` — Recent, Home, Desktop, Trash,
 * Other Locations, the COMPUTER's places — plus the one shortcut `openProject`
 * adds, `dlg.AddShortcut( PATHS::GetDefaultUserProjectsPath() )`
 * (kicad/tools/kicad_manager_control.cpp:493). It has no Demos row and no
 * Templates row: demos are reached through `File > Open Demo Project` and
 * templates through the template selector, both separate windows.
 *
 * Ours listed Demos and Templates as rows and they were the wrong shape twice
 * over — served from the CDN, identical for every account, never writable, so
 * the file manager showed folders nobody can change; and the stock half of
 * Templates sat in the same list as the user's own, which said a bundled
 * template could be renamed.
 *
 * Two rules, and between them the window answers "where may this go?" before
 * the user has clicked anything:
 *
 *   SAVE   Projects holds the CURRENT project and nothing else, clamped so the
 *          breadcrumb cannot climb to a sibling board. With the kind's own
 *          folder beside it, the offer is exactly "this project" or "shared".
 *   OPEN   Projects holds every project, because reading is not gated: a sheet
 *          or a symbol opens from any project, with or without one open.
 *
 * In both, the OTHER kinds' folders are absent — a drawing sheet has no reason
 * to see Footprints.
 *
 * There is no Recent row. GTK has one because its sidebar is the only ordering
 * a file dialog offers; ours sorts the project list by any column, which is the
 * same thing done in the place a person is already looking.
 */
export function chooserPlacesFor(opts: {
  /** The shared folder this document kind belongs in, if it has one. */
  kind?: AssetKind;
  mode: 'open' | 'save';
  /** The open project's folder, e.g. `/MyBoard`. Null when none is open. */
  projectDir?: string | null;
}): readonly ChooserPlace[] {
  const { kind, mode, projectDir } = opts;
  const places: ChooserPlace[] = [];

  if (mode === 'save' && projectDir) {
    places.push({
      id: 'projects',
      // The project's own name, because the row IS that project now rather than
      // the list it came from.
      label: projectDir.replace(/^\/+/, '') || 'Project',
      icon: 'open_project',
      path: projectDir,
      root: projectDir,
    });
  } else if (mode === 'open' || !kind) {
    // Saving with no project open has no project to save INTO, so the row is
    // left out rather than offered and refused — unless there is no shared
    // folder either, which is the project manager saving a project itself.
    places.push({ id: 'projects', label: 'Projects', icon: 'open_project' });
  }

  if (kind) {
    places.push({
      id: kind,
      label: KIND_LABELS[kind],
      icon: kind === 'templates' ? 'new_project_from_template' : 'open_project',
      path: USER_DIRS[kind],
      root: USER_DIRS[kind],
    });
  }

  return places;
}

const KIND_LABELS: Record<AssetKind, string> = {
  templates: 'Templates',
  symbols: 'Symbols',
  footprints: 'Footprints',
  models3d: '3D Models',
};
