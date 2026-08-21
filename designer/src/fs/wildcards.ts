// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The strings in the file chooser's type combo.
 *
 * `common/wildcards_and_files_ext.cpp`. KiCad never writes one of these by
 * hand either: every wxFileDialog asks `FILEEXT::SomethingWildcard()`, which
 * builds the label from a translated noun phrase and the extension list, so
 * `KiCad project files (*.kicad_pro)` reads the same in all 93 of them.
 *
 * Ported the same way round — {@link fileFilter} is `AddFileExtListToFilter`
 * (`:85`), and each exported filter below is one `FILEEXT::` function — so a
 * caller names the filter it wants rather than typing a label. The alternative
 * is 93 chances to write `Kicad Project Files (*.kicad_pro)` with the wrong
 * capitalisation.
 *
 * Only the wildcards that have a caller are here. Adding one means reading its
 * function in that file, not guessing at its wording.
 */

import type { ChooserFilter } from './chooser_filter.js';

/**
 * `AddFileExtListToFilter`, which is where the ` (*.a; *.b)` suffix comes
 * from.
 *
 * The separator is `; ` (`:102`). An empty extension list is upstream's "all
 * files" case, which on this platform is `*.*`; here it is the empty list,
 * because the chooser filters by extension rather than by matching a pattern.
 */
export function fileFilter(label: string, extensions: readonly string[]): ChooserFilter {
  if (extensions.length === 0) return { label: `${label} (*)`, extensions: [] };
  return {
    label: `${label} (${extensions.map((e) => `*.${e}`).join('; ')})`,
    extensions,
  };
}

/** `FILEEXT::AllFilesWildcard` (`:234`). */
export const allFilesWildcard = (): ChooserFilter => fileFilter('All files', []);

/** `FILEEXT::ProjectFileWildcard` (`:247`). */
export const projectFileWildcard = (): ChooserFilter =>
  fileFilter('KiCad project files', ['kicad_pro']);

/** `FILEEXT::LegacyProjectFileWildcard` (`:253`). */
export const legacyProjectFileWildcard = (): ChooserFilter =>
  fileFilter('KiCad legacy project files', ['pro']);

/** `FILEEXT::AllProjectFilesWildcard` (`:260`). */
export const allProjectFilesWildcard = (): ChooserFilter =>
  fileFilter('All KiCad project files', ['kicad_pro', 'pro']);

/**
 * What Open Existing Project offers, in upstream's order.
 *
 * `KICAD_MANAGER_CONTROL::openProject` joins exactly these three with `|`
 * (`kicad/tools/kicad_manager_control.cpp:488-490`), so the combo opens on
 * "All KiCad project files" — the first entry is the one wx selects.
 */
export const OPEN_PROJECT_FILTERS: readonly ChooserFilter[] = [
  allProjectFilesWildcard(),
  projectFileWildcard(),
  legacyProjectFileWildcard(),
];

/**
 * What **our** Open Project window offers — `openProject`'s three, and then
 * "All files".
 *
 * This is a deliberate departure, and it is the only one in this file, so it
 * is worth being exact about what it is and is not.
 *
 * `KICAD_MANAGER_CONTROL::openProject` does not offer an all-files entry
 * (`kicad/tools/kicad_manager_control.cpp:488-490`), and the guard right after
 * the dialog rejects anything that is not a project file:
 *
 *     if( !pro.Exists() || (   pro.GetExt() != FILEEXT::ProjectFileExtension
 *                           && pro.GetExt() != FILEEXT::LegacyProjectFileExtension ) )
 *         return -1;
 *
 * So on the desktop this window opens projects and nothing else. It can afford
 * to: a KiCad user who wants to look at the `.rpt` beside their board opens
 * their desktop's file manager, which KiCad neither ships nor needs to.
 *
 * We ship no desktop, and this window is the only way into the account's
 * files — it is the file manager as well as the project-open dialog, a job the
 * upstream `wxFileDialog` does not have. `FILEEXT::AllFilesWildcard()` is
 * KiCad's own string for that entry (`wildcards_and_files_ext.cpp:234`), used
 * by GerbView's "Open Autodetected File(s)" and by the manager's own "Edit
 * File in Text Editor" (`kicad/kicad_manager_frame.cpp:1175`) — so the row is
 * upstream's, even though upstream never puts it in *this* combo.
 *
 * Choosing it does not weaken the guard, it relocates it: a file that is not a
 * project still cannot *be* a project, so accepting one opens the project it
 * belongs to and then activates the file inside it, which is
 * `PROJECT_TREE_ITEM::Activate` — the same switch the project tree uses.
 * {@link OPEN_PROJECT_FILTERS} stays exactly as upstream writes it, so the
 * difference between the two lists is the whole of the difference.
 */
export const FILE_MANAGER_FILTERS: readonly ChooserFilter[] = [
  ...OPEN_PROJECT_FILTERS,
  allFilesWildcard(),
];
