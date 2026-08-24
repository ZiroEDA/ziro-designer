// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The chooser's *data* types, split out of `FileChooser.tsx` for the same
 * reason `toolbar_types.ts` was split out of `Toolbar.tsx` and `menu_types.ts`
 * out of `MenuBar.tsx`: a plain data module that imports a type from a `.tsx`
 * is outside `qa`'s tsconfig, which compiles `.ts` only. Vitest resolves it and
 * passes; CI's `tsc` does not, and reports `--jsx is not set`.
 *
 * `wildcards.ts` is exactly that kind of module — it is nothing but filter
 * data — and it took this import down with it the moment a test reached it.
 *
 * `chooser_places.ts` is the same kind of module and took the same fall: it is
 * nothing but the sidebar's rows, and naming `ChooserPlace` from the `.tsx`
 * broke qa's tsc the moment a test reached it.
 *
 * `FileChooser.tsx` re-exports these, so existing importers are unaffected.
 */

import type { FileSystem } from './filesystem.js';

/** One entry of the type combo at the bottom right. */
export interface ChooserFilter {
  /** The whole string the combo shows — `KiCad project files (*.kicad_pro)`. */
  readonly label: string;
  /** Lowercase extensions without the dot. Empty means everything. */
  readonly extensions: readonly string[];
}

/**
 * One row of the places sidebar.
 *
 * Upstream this is a `GtkPlacesSidebar` row, and upstream's rows are Home,
 * Desktop, Documents, Downloads and Other Locations — places on a computer.
 * This tree has one root and no computer, so the caller says what its places
 * are and the widget only draws them. A place may bring its own
 * {@link FileSystem}: "Recent" and "Demos" are listings rather than folders of
 * the account's tree, so they are not reachable by a path into it.
 */
export interface ChooserPlace {
  /** Stable id, used as the selected-place key. */
  readonly id: string;
  /** The row's text. */
  readonly label: string;
  /** A `TreeIcon` name — one of KiCad's own manager bitmaps. */
  readonly icon: string;
  /** The tree this place browses. Defaults to the chooser's own. */
  readonly fs?: FileSystem;
  /** Where in that tree to land. Defaults to its root. */
  readonly path?: string;
  /**
   * The highest folder this place can be navigated to. Defaults to the tree's
   * own root.
   *
   * A Save As from inside a board shows Projects holding THAT board and no
   * other, so that the two answers on offer are "this project" and "the shared
   * folder for this kind of file" — and neither the breadcrumb nor Back can
   * climb out to a sibling board. Upstream has no counterpart because upstream
   * has a filesystem and a user who typed the path; here every project in the
   * account is one click away in the same tree.
   */
  readonly root?: string;
  /**
   * Activating a project here opens it instead of walking into it.
   *
   * A project folder is a document as well as a folder, and which of the two a
   * double-click means depends on the place. In the account's tree it is a
   * folder — you walk in and find the files. In Templates it is neither: a
   * template's manifest carries no file list, so walking in could only ever
   * show an empty folder, which is what a person reads as "it is broken".
   */
  readonly activateOpens?: boolean;
  /**
   * What accepting a path in this place means. Defaults to the chooser's own
   * {@link FileChooserProps.onAccept}.
   *
   * A place that brings its own {@link FileSystem} brings paths that mean
   * nothing to the caller's tree — `/simulation/amplifier_ac` names a demo, not
   * a project of the account — so what to do with one has to travel with the
   * tree it came from. Upstream needs none of this because there is only ever
   * one tree: `KICAD_MANAGER_CONTROL::OpenDemoProject` is literally
   * `openProject( PATHS::GetStockDemosPath() )` — the same dialog and the same
   * `LoadProject` as Open Project, pointed at a different starting directory
   * (kicad/tools/kicad_manager_control.cpp:519). Splitting the one tree into
   * places is ours, so re-joining them at the accept is ours to do too.
   */
  readonly onAccept?: (path: string) => void;
  /**
   * Whether a file can be SAVED here. False for every place that brings its own
   * {@link FileSystem}, because those are listings rather than folders of the
   * account's tree and their `write` refuses.
   *
   * GTK gates this in the widget rather than at the write: a
   * `GtkPlacesSidebar` row that is not a save target leaves the Save button
   * insensitive and says so, instead of letting a person type a name, press
   * Save, and meet an error. Recent is the row everyone tries — it is a list of
   * things you opened, not somewhere on the disk.
   */
  readonly writable?: boolean;
}
