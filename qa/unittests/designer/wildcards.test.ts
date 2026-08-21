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
import {
  FILE_MANAGER_FILTERS,
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

describe('FILE_MANAGER_FILTERS, the one deliberate departure', () => {
  it("is openProject's three, then KiCad's own All files row", () => {
    expect(FILE_MANAGER_FILTERS.map((f) => f.label)).toStrictEqual([
      'All KiCad project files (*.kicad_pro; *.pro)',
      'KiCad project files (*.kicad_pro)',
      'KiCad legacy project files (*.pro)',
      'All files (*)',
    ]);
  });

  it('opens on the same first entry, so the default is still projects only', () => {
    // wx selects the first wildcard, so adding a row at the end changes what
    // can be reached and not what the window shows when it opens.
    expect(FILE_MANAGER_FILTERS[0]).toStrictEqual(OPEN_PROJECT_FILTERS[0]);
  });

  it('adds exactly one row, and it is the all-files one', () => {
    expect(FILE_MANAGER_FILTERS).toHaveLength(OPEN_PROJECT_FILTERS.length + 1);
    expect(FILE_MANAGER_FILTERS.filter((f) => f.extensions.length === 0)).toHaveLength(1);
  });
});
