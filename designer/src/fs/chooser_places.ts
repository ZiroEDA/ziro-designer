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

import { loadDemos } from '../home/demos.js';
import { listProjects } from '../home/projectStore.js';
import { loadTemplates } from '../home/templates.js';
import { listUserTemplates } from '../home/user_templates.js';
import {
  deleteUserTemplateFile,
  listUserTemplateFiles,
  readUserTemplateFile,
  renameUserTemplateFile,
  writeUserTemplateFile,
} from '../home/user_template_files.js';
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
 * `Demos`, as a real tree.
 *
 * A demo's id is a path — `simulation/amplifier_ac` — and its manifest carries
 * the files it is made of, so the listing has three levels: the directory the
 * demos are grouped under, the demo project inside it, and that project's own
 * files inside that. `projects` says which of the synthesised folders are the
 * demos themselves, since nothing about `simulation/amplifier_ac` tells them
 * apart from `simulation`.
 *
 * The manifest names the files but not their sizes or dates — those bytes are
 * on the CDN until the demo is opened — so both columns say nothing rather
 * than `0 bytes` and `Jan 1, 1970`, which read as data the listing does not
 * have.
 */
export function demosFileSystem(): FileSystem {
  return listFileSystem(
    async () => {
      const demos = await loadDemos();
      return {
        files: demos.flatMap((d) =>
          d.files.map((rel) => ({ name: `${d.id}/${rel}`, size: null, modified: null })),
        ),
        projects: new Set(demos.map((d) => `/${d.id}`)),
      };
    },
    { leafKind: 'file' },
  );
}

/**
 * `Templates` — both roots, the way `BuildTemplateList` scans both, PLUS the
 * loose files the user templates root holds.
 *
 * A template's manifest carries no file list, so a template is a LEAF: there
 * is nothing to show inside one, and the place says so rather than offering a
 * folder that opens empty.
 *
 * The loose files are the other half of the same directory. `PATHS::GetUserTemplatesPath()`
 * is a real folder — `~/.local/share/kicad/<ver>/template/` on Linux, asked of
 * a real wxFileDialog in qa/probes/savedlg_probe.cpp — and `Files_io` saves
 * drawing sheets straight into it (pagelayout_editor/files.cpp:199-202). So
 * this place is not a read-only catalogue: it lists template folders you cannot
 * change and files you can.
 */
export function templatesFileSystem(): FileSystem {
  return listFileSystem(
    async () => {
      const [bundled, mine, loose] = await Promise.all([
        loadTemplates(),
        listUserTemplates(),
        listUserTemplateFiles(),
      ]);
      return {
        files: [
          // The template folders carry no size or date — those bytes are on the
          // CDN until the template is used — so both columns say nothing rather
          // than `0 bytes` and `Jan 1, 1970`.
          ...[...bundled, ...mine].map((t) => ({ name: t.id, size: null, modified: null })),
          // A loose file has both, because we wrote it.
          ...loose.map((f) => ({
            name: f.path,
            size: f.text.length,
            modified: f.updatedAt,
          })),
        ],
        // A template is a leaf; a loose file is a file. `leafKind` says one
        // thing for the whole listing, so the files are marked here instead.
        fileLeaves: new Set(loose.map((f) => `/${f.path}`)),
      };
    },
    {
      files: {
        read: readUserTemplateFile,
        write: writeUserTemplateFile,
        rename: renameUserTemplateFile,
        remove: deleteUserTemplateFile,
      },
    },
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
    // Recent first, as GtkPlacesSidebar puts it: it is the row above Home, and
    // the one a person reaches for most. Not a save target — GTK's Recent is a
    // list of things you opened, not a folder.
    { id: 'recent', label: 'Recent', icon: 'recent', fs: recentFileSystem(accountFs) },
    // The account's own tree, and the only row a file can be saved into. It
    // brings no `fs` of its own, which is how the chooser knows.
    { id: 'projects', label: 'Projects', icon: 'open_project' },
    { id: 'demos', label: 'Demos', icon: 'open_project_demo', fs: demosFileSystem() },
    {
      id: 'templates',
      label: 'Templates',
      icon: 'new_project_from_template',
      fs: templatesFileSystem(),
      // A template has no listable contents, so a double-click takes it rather
      // than walking into an empty folder.
      activateOpens: true,
      // ...but it IS a directory, and a drawing sheet saved from pl_editor goes
      // into it (pagelayout_editor/files.cpp:199-202). The default rule —
      // "only the row with no fs of its own" — reads this row as a catalogue,
      // which it was until it grew loose files.
      writable: true,
    },
  ];
}
