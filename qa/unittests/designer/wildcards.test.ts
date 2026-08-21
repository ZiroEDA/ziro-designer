// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The file chooser's type combo, against `common/wildcards_and_files_ext.cpp`
 * and the two call sites in `kicad/tools/kicad_manager_control.cpp`.
 *
 * Every expectation below is a literal transcribed from the C++, never
 * `fileFilter(...)` called again: a filter list checked against the function
 * that built it agrees with itself whatever the wording is.
 */

import { describe, expect, it } from 'vitest';
import {
  NEW_PROJECT_FOLDER_FILTERS,
  OPEN_PROJECT_FILTERS,
  allFilesWildcard,
  fileFilter,
} from '@ziroeda/designer/src/fs/wildcards.js';

describe('AddFileExtListToFilter', () => {
  it('joins the extensions with "; ", each starred and dotted', () => {
    // wildcards_and_files_ext.cpp:85-102.
    expect(fileFilter('KiCad project files', ['kicad_pro']).label).toBe(
      'KiCad project files (*.kicad_pro)',
    );
    expect(fileFilter('All KiCad project files', ['kicad_pro', 'pro']).label).toBe(
      'All KiCad project files (*.kicad_pro; *.pro)',
    );
  });

  it('an empty list is the all-files case', () => {
    // FILEEXT::AllFilesWildcard() is `_( "All files" ) + AddFileExtListToFilter( {} )`
    // (wildcards_and_files_ext.cpp:234). Ours filters by extension rather than
    // by matching a pattern, so "everything" is the empty extension list.
    expect(allFilesWildcard().label).toBe('All files (*)');
    expect(allFilesWildcard().extensions).toStrictEqual([]);
  });
});

describe('Open Existing Project', () => {
  /**
   *     wxString wildcard = FILEEXT::AllProjectFilesWildcard()
   *                         + "|" + FILEEXT::ProjectFileWildcard()
   *                         + "|" + FILEEXT::LegacyProjectFileWildcard();
   *
   * kicad_manager_control.cpp:488-490, in that order - wx selects the first.
   */
  it('offers exactly the three project wildcards, in openProject order', () => {
    expect(OPEN_PROJECT_FILTERS.map((f) => f.label)).toStrictEqual([
      'All KiCad project files (*.kicad_pro; *.pro)',
      'KiCad project files (*.kicad_pro)',
      'KiCad legacy project files (*.pro)',
    ]);
    expect(OPEN_PROJECT_FILTERS.map((f) => f.extensions)).toStrictEqual([
      ['kicad_pro', 'pro'],
      ['kicad_pro'],
      ['pro'],
    ]);
  });

  it('does not offer "All files" - openProject never builds that wildcard', () => {
    // The list above is the whole of it, and the guard right after the dialog
    // rejects anything that is not a project file anyway:
    //   if( !pro.Exists() || (   pro.GetExt() != FILEEXT::ProjectFileExtension
    //                         && pro.GetExt() != FILEEXT::LegacyProjectFileExtension ) )
    //       return -1;
    // (kicad_manager_control.cpp:508-513). An "All files" row here would be a
    // control upstream does not have.
    expect(OPEN_PROJECT_FILTERS.some((f) => f.extensions.length === 0)).toBe(false);
  });
});

describe('New Project Folder', () => {
  /**
   *     wxFileDialog dlg( m_frame, title, default_dir, wxEmptyString,
   *                       FILEEXT::ProjectFileWildcard(),
   *                       wxFD_SAVE | wxFD_OVERWRITE_PROMPT );
   *
   * kicad_manager_control.cpp:281-285. One wildcard, not three: a new project
   * is a `.kicad_pro`, and there is no creating a legacy `.pro`.
   */
  it('offers the project wildcard alone', () => {
    expect(NEW_PROJECT_FOLDER_FILTERS.map((f) => f.label)).toStrictEqual([
      'KiCad project files (*.kicad_pro)',
    ]);
    expect(NEW_PROJECT_FOLDER_FILTERS.map((f) => f.extensions)).toStrictEqual([['kicad_pro']]);
  });

  it('is not the same list Open Project uses', () => {
    expect(NEW_PROJECT_FOLDER_FILTERS.length).toBe(1);
    expect(OPEN_PROJECT_FILTERS.length).toBe(3);
  });
});
