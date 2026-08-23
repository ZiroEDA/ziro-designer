// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The file chooser's type combo, against `common/wildcards_and_files_ext.cpp`
 * and `KICAD_MANAGER_CONTROL::openProject`.
 *
 * Every expectation is a literal transcribed from the C++, never `fileFilter`
 * called again: a filter list checked against the function that built it agrees
 * with itself whatever the wording is.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
    // (wildcards_and_files_ext.cpp:234).
    expect(allFilesWildcard().label).toBe('All files (*)');
    expect(allFilesWildcard().extensions).toStrictEqual([]);
  });
});

describe('OPEN_PROJECT_FILTERS is openProject, unchanged', () => {
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

  it('does not gain an "All files" row - openProject never builds that wildcard', () => {
    // This is the transcription of upstream and must stay one. The window we
    // actually open is FILE_MANAGER_FILTERS below, and keeping the two apart is
    // what makes the departure legible.
    expect(OPEN_PROJECT_FILTERS.some((f) => f.extensions.length === 0)).toBe(false);
    expect(OPEN_PROJECT_FILTERS).toHaveLength(3);
  });
});

const HOME = readFileSync(
  fileURLToPath(new URL('../../../designer/src/home/HomePage.tsx', import.meta.url)),
  'utf8',
);

describe("the combo is openProject's three, and only those", () => {
  /**
   * There used to be a fourth row here, KiCad's own `AllFilesWildcard()`, on
   * the reasoning that this window is the account's only file manager and so
   * has a job upstream's does not.
   *
   * Akshay put the two combos side by side. KiCad's has three entries. Ours had
   * four, and the extra one is visible the moment you open it — which is the
   * whole test of whether a departure is defensible. It is gone.
   *
   * `openProject` builds the wildcard from exactly three
   * (kicad/tools/kicad_manager_control.cpp:486-488) and this window uses that
   * list directly now, so there is no second list to keep in step.
   */
  it('is the list Open Existing Project actually opens with', () => {
    expect(HOME).toContain('filters={OPEN_PROJECT_FILTERS}');
    expect(HOME, 'the file-manager list is back').not.toContain('FILE_MANAGER_FILTERS');
  });

  it('offers no all-files row anywhere in that combo', () => {
    // An empty extension list is what "match everything" looks like here, so
    // this catches a row added under any label.
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
