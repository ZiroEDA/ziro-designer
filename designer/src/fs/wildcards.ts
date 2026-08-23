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

import type { ChooserFilter } from './chooser_types.js';

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
 * What the "New Project Folder" dialog offers.
 *
 * The window `KICAD_MANAGER_CONTROL::NewProject` puts up after the template
 * selector passes one wildcard and no more:
 *
 *     wxFileDialog dlg( m_frame, title, default_dir, wxEmptyString,
 *                       FILEEXT::ProjectFileWildcard(),
 *                       wxFD_SAVE | wxFD_OVERWRITE_PROMPT );
 *
 * (`kicad/tools/kicad_manager_control.cpp:281-285`). A new project is a
 * `.kicad_pro` and nothing else, so there is no "all project files" entry and
 * no legacy `.pro` - you cannot create one of those.
 */
export const NEW_PROJECT_FOLDER_FILTERS: readonly ChooserFilter[] = [projectFileWildcard()];

/** `FILEEXT::DrillFileWildcard` (`:406-410`). `DrillFileExtension` is "drl". */
export const drillFileWildcard = (): ChooserFilter =>
  fileFilter('Drill files', ['drl', 'nc', 'xnc', 'txt']);

/**
 * `FILEEXT::DrawingSheetFileWildcard` (`wildcards_and_files_ext.cpp:390-394`):
 * "Drawing sheet files" over the one `kicad_wks` extension.
 */
export const drawingSheetWildcard = (): ChooserFilter =>
  fileFilter('Drawing sheet files', ['kicad_wks']);

/** `FILEEXT::ZipFileWildcard` (`:521-524`). */
export const zipFileWildcard = (): ChooserFilter => fileFilter('Zip file', ['zip']);

/** `FILEEXT::GerberJobFileWildcard` (`:539-542`). The extension is "gbrjob". */
export const gerberJobFileWildcard = (): ChooserFilter => fileFilter('Gerber job file', ['gbrjob']);

/**
 * Open Autodetected File(s).
 *
 *     return LoadFileOrShowDialog( aFileName, FILEEXT::AllFilesWildcard(),
 *                                  _( "Open Autodetected File(s)" ), 2 );
 *                                          gerbview/files.cpp:200-205
 *
 * ONE filter, and it is All files — autodetection is the whole point of the
 * entry, so narrowing it would defeat it. Ours offered the Gerber list here,
 * which is both the wrong set and the wrong idea.
 */
export const GERBVIEW_AUTODETECT_FILTERS: readonly ChooserFilter[] = [allFilesWildcard()];

/**
 * Open Gerber File(s) — `GERBVIEW_FRAME::LoadGerberFiles`
 * (`gerbview/files.cpp:208-247`), which builds fourteen entries by hand and
 * ends with All files.
 *
 * The first entry is upstream's `g*` catch-all, and its comment says why:
 * "Mainly internal copper layers do not have specific extension, and filenames
 * are like *.g1, *.g2 *.gb1 ...". The LABEL is that verbatim, because a label
 * is data. The extension list behind it cannot be — a browser file picker
 * matches literal extensions and has no glob — so it carries the concrete
 * `g*` names GerbView's own special entries below enumerate, plus the numbered
 * ones that comment names. A file with an extension outside that set is still
 * reachable through the All files entry at the end, exactly as on a platform
 * where the glob fails to match.
 */
export const GERBVIEW_GERBER_FILTERS: readonly ChooserFilter[] = [
  {
    label: 'Gerber files (*.g*; *.pho)',
    extensions: [
      'gbr',
      'gbx',
      'gtl',
      'gbl',
      'gbs',
      'gts',
      'gbo',
      'gto',
      'gbp',
      'gtp',
      'gko',
      'gpt',
      'gpb',
      'gm1',
      'gm2',
      'gm3',
      'gm4',
      'gm5',
      'gm6',
      'gm7',
      'gm8',
      'gm9',
      'g1',
      'g2',
      'g3',
      'g4',
      'g5',
      'g6',
      'g7',
      'g8',
      'g9',
      'gb1',
      'gb2',
      'gb3',
      'gt1',
      'gt2',
      'gt3',
      'pho',
    ],
  },
  fileFilter('Top layer', ['gtl']),
  fileFilter('Bottom layer', ['gbl']),
  fileFilter('Bottom solder resist', ['gbs']),
  fileFilter('Top solder resist', ['gts']),
  fileFilter('Bottom overlay', ['gbo']),
  fileFilter('Top overlay', ['gto']),
  fileFilter('Bottom paste', ['gbp']),
  fileFilter('Top paste', ['gtp']),
  fileFilter('Keep-out layer', ['gko']),
  fileFilter('Mechanical layers', ['gm1', 'gm2', 'gm3', 'gm4', 'gm5', 'gm6', 'gm7', 'gm8', 'gm9']),
  fileFilter('Top Pad Master', ['gpt']),
  fileFilter('Bottom Pad Master', ['gpb']),
  allFilesWildcard(),
];

/**
 * Open NC (Excellon) Drill File(s) — `GERBVIEW_FRAME::LoadExcellonFiles`
 * (`gerbview/files.cpp:250-258`): the drill wildcard, then All files.
 */
export const GERBVIEW_DRILL_FILTERS: readonly ChooserFilter[] = [
  drillFileWildcard(),
  allFilesWildcard(),
];

/**
 * Open Gerber Job File — `GERBVIEW_FRAME::LoadGerberJobFile`
 * (`gerbview/job_file_reader.cpp:190-195`). One filter and NO All files entry,
 * unlike the two above; that asymmetry is upstream's.
 */
export const GERBVIEW_JOB_FILTERS: readonly ChooserFilter[] = [gerberJobFileWildcard()];

/**
 * Open Zip File — `GERBVIEW_FRAME::LoadZipArchiveFile`
 * (`gerbview/files.cpp:660-663`). One filter, again with no All files.
 */
export const GERBVIEW_ZIP_FILTERS: readonly ChooserFilter[] = [zipFileWildcard()];

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
