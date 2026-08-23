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
 * This tree has one root and no computer, so the rows are ours to choose. The
 * two that name a FILE are here; Demos and Templates stay in the project
 * manager, because activating one of those opens a whole project rather than
 * handing back a path, which is not a thing an editor's Open can do with it.
 */

import { listProjects } from '../home/projectStore.js';
import type { ChooserPlace } from './FileChooser.js';
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
 * Recent first, as `GtkPlacesSidebar` puts it — it is the row above Home, and
 * the one a person reaches for most. Neither row brings its own `onAccept`:
 * both hand back a path in the account's tree, so the dialog's own accept is
 * right for them.
 */
export function standardChooserPlaces(accountFs: FileSystem): readonly ChooserPlace[] {
  return [
    { id: 'recent', label: 'Recent', icon: 'recent', fs: recentFileSystem(accountFs) },
    { id: 'projects', label: 'Projects', icon: 'open_project' },
  ];
}
