// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The project tree's right-click menu, against `PROJECT_TREE_PANE::onRight`
 * (`kicad/project_tree_pane.cpp:816-1119`).
 *
 * Nothing pinned this menu before - not a label, not a condition - so every
 * divergence found in the audit could have been introduced, or re-introduced,
 * without a single test moving.
 *
 * Labels below are literals transcribed from the C++, never read back out of
 * the module.
 */

import { describe, expect, it } from 'vitest';
import {
  type TreeMenu,
  type TreeMenuSelectionItem,
  projectTreeMenu,
} from '@ziroeda/designer/src/home/project_tree_menu.js';
import type { TreeFileType } from '@ziroeda/designer/src/home/file_activation.js';

const sel = (type: TreeFileType, isTreeRoot = false): TreeMenuSelectionItem => ({
  type,
  isTreeRoot,
});
/** The row ids in order, with separators, which is what the menu *looks* like. */
const ids = (m: TreeMenu): string[] => m.map((e) => (e === 'separator' ? '--' : e.id));
const has = (m: TreeMenu, id: string): boolean => m.some((e) => e !== 'separator' && e.id === id);
const entry = (m: TreeMenu, id: string) =>
  m.find((e): e is Exclude<typeof e, 'separator'> => e !== 'separator' && e.id === id);

describe('an empty selection', () => {
  it('builds no menu at all', () => {
    //     if( selection.size() == 0 )
    //         return;
    // (:850-851), and the popup is only shown when it has rows (:1117).
    expect(projectTreeMenu([])).toStrictEqual([]);
  });
});

describe('Move to Trash and Rename are ABSENT, not greyed, for the protected types', () => {
  /**
   * One test per type, named for the type - the same per-occurrence shape the
   * CanDelete tests use, and for the same reason: each of these is separately
   * load-bearing, and `.kicad_pcb` losing its guard is a different bug from
   * `.kicad_sch` losing it.
   *
   * `can_delete = item->CanDelete()` (:876) and the row is only appended
   * `if( can_delete )` (:1004) - so it is not on the menu, rather than on it
   * and disabled.
   */
  const protectedTypes: TreeFileType[] = [
    'DIRECTORY',
    'LEGACY_PROJECT',
    'JSON_PROJECT',
    'LEGACY_SCHEMATIC',
    'SEXPR_SCHEMATIC',
    'LEGACY_PCB',
    'SEXPR_PCB',
    'DRAWING_SHEET',
    'FOOTPRINT_FILE',
    'SCHEMATIC_LIBFILE',
    'SEXPR_SYMBOL_LIB_FILE',
    'DESIGN_RULES',
  ];

  for (const type of protectedTypes) {
    it(`${type}: no Move to Trash row`, () => {
      expect(has(projectTreeMenu([sel(type)]), 'moveToTrash')).toBe(false);
    });

    it(`${type}: no Rename row`, () => {
      expect(has(projectTreeMenu([sel(type)]), 'renameFile')).toBe(false);
    });
  }

  it('a plain file DOES get both, so the guard is not simply always on', () => {
    const m = projectTreeMenu([sel('TXT')]);
    expect(has(m, 'moveToTrash')).toBe(true);
    expect(has(m, 'renameFile')).toBe(true);
  });
});

describe('the delete row', () => {
  it('is labelled "Move to Trash" - the Windows string is not shipped', () => {
    // #ifdef __WINDOWS__ "Delete" #else "Move to Trash" (:1019-1025).
    const e = entry(projectTreeMenu([sel('TXT')]), 'moveToTrash');
    expect(e?.label).toBe('Move to Trash');
  });

  it('carries the trash bitmap', () => {
    expect(entry(projectTreeMenu([sel('TXT')]), 'moveToTrash')?.icon).toBe('trash');
  });

  it('says "file and its content" for one and "files and their contents" for many', () => {
    expect(entry(projectTreeMenu([sel('TXT')]), 'moveToTrash')?.help).toBe(
      'Delete the file and its content',
    );
    expect(entry(projectTreeMenu([sel('TXT'), sel('MD')]), 'moveToTrash')?.help).toBe(
      'Delete the files and their contents',
    );
  });
});

describe('Switch to this Project', () => {
  it('appears on another project’s row, with a separator under it', () => {
    const m = projectTreeMenu([sel('JSON_PROJECT')]);
    expect(ids(m)[0]).toBe('switchToProject');
    expect(ids(m)[1]).toBe('--');
  });

  it('carries upstream’s label, help and bitmap', () => {
    const e = entry(projectTreeMenu([sel('JSON_PROJECT')]), 'switchToProject');
    expect(e?.label).toBe('Switch to this Project');
    expect(e?.help).toBe('Close all editors, and switch to the selected project');
    expect(e?.icon).toBe('open_project');
  });

  it('does NOT appear on the project’s own root row', () => {
    //     if( item->GetId() == m_TreeProject->GetRootItem() )
    //         can_switch_to_project = false;
    expect(has(projectTreeMenu([sel('JSON_PROJECT', true)]), 'switchToProject')).toBe(false);
  });

  it('does not appear for anything that is not a project', () => {
    for (const t of ['TXT', 'DIRECTORY', 'SEXPR_PCB', 'PDF', 'ZIP_ARCHIVE'] as TreeFileType[])
      expect(has(projectTreeMenu([sel(t)]), 'switchToProject')).toBe(false);
  });

  it('does not appear for a multiple selection', () => {
    // ":854-860" strips it along with New Directory and Rename.
    expect(
      has(projectTreeMenu([sel('JSON_PROJECT'), sel('JSON_PROJECT')]), 'switchToProject'),
    ).toBe(false);
  });
});

describe('New Directory...', () => {
  it('appears on the project root row and on a directory', () => {
    expect(has(projectTreeMenu([sel('JSON_PROJECT', true)]), 'newDirectory')).toBe(true);
    expect(has(projectTreeMenu([sel('DIRECTORY')]), 'newDirectory')).toBe(true);
  });

  it('carries upstream’s label, help and bitmap', () => {
    const e = entry(projectTreeMenu([sel('DIRECTORY')]), 'newDirectory');
    expect(e?.label).toBe('New Directory...');
    expect(e?.help).toBe('Create a New Directory');
    expect(e?.icon).toBe('directory');
  });

  it('does NOT appear on an ordinary file, which is where ours used to draw it greyed', () => {
    for (const t of ['TXT', 'SEXPR_PCB', 'SEXPR_SCHEMATIC', 'PDF', 'GERBER'] as TreeFileType[])
      expect(has(projectTreeMenu([sel(t)]), 'newDirectory')).toBe(false);
  });

  it('does not appear on another project’s row', () => {
    // The non-root branch clears it (:900-904).
    expect(has(projectTreeMenu([sel('JSON_PROJECT')]), 'newDirectory')).toBe(false);
  });
});

describe('Edit in a Text Viewer', () => {
  it('is offered for an ordinary file, a board and a schematic', () => {
    // can_edit starts true and only DIRECTORY, ZIP_ARCHIVE, PDF and
    // JOBSET_FILE clear it - so a .kicad_pcb IS offered upstream.
    for (const t of ['TXT', 'SEXPR_PCB', 'SEXPR_SCHEMATIC', 'GERBER'] as TreeFileType[])
      expect(has(projectTreeMenu([sel(t)]), 'editInTextEditor')).toBe(true);
  });

  it('is not offered for a directory, a zip, a pdf or a jobset', () => {
    for (const t of ['DIRECTORY', 'ZIP_ARCHIVE', 'PDF', 'JOBSET_FILE'] as TreeFileType[])
      expect(has(projectTreeMenu([sel(t)]), 'editInTextEditor')).toBe(false);
  });

  it('keeps upstream’s help string and bitmap', () => {
    const e = entry(projectTreeMenu([sel('TXT')]), 'editInTextEditor');
    expect(e?.help).toBe('Open the file in a Text Editor');
    expect(e?.icon).toBe('editor');
    expect(entry(projectTreeMenu([sel('TXT'), sel('MD')]), 'editInTextEditor')?.help).toBe(
      'Open files in a Text Editor',
    );
  });
});

describe('Rename', () => {
  it('is singular for one and plural for many', () => {
    expect(entry(projectTreeMenu([sel('TXT')]), 'renameFile')?.label).toBe('Rename File...');
    expect(entry(projectTreeMenu([sel('TXT'), sel('MD')]), 'renameFile')?.label).toBe(
      'Rename Files...',
    );
  });

  it('carries upstream’s help and bitmap', () => {
    const e = entry(projectTreeMenu([sel('TXT')]), 'renameFile');
    expect(e?.help).toBe('Rename file');
    expect(e?.icon).toBe('right');
  });

  it('is never offered for a project row, root or not', () => {
    // Both project cases set can_rename = false explicitly (:880).
    expect(has(projectTreeMenu([sel('JSON_PROJECT', true)]), 'renameFile')).toBe(false);
    expect(has(projectTreeMenu([sel('LEGACY_PROJECT')]), 'renameFile')).toBe(false);
  });
});

describe('Run Jobs', () => {
  it('appears for a single jobset file, with the exchange bitmap', () => {
    const e = entry(projectTreeMenu([sel('JOBSET_FILE')]), 'runJobs');
    expect(e?.label).toBe('Run Jobs');
    expect(e?.icon).toBe('exchange');
  });

  it('does not appear for anything else, nor for a multiple selection', () => {
    expect(has(projectTreeMenu([sel('TXT')]), 'runJobs')).toBe(false);
    expect(has(projectTreeMenu([sel('JOBSET_FILE'), sel('JOBSET_FILE')]), 'runJobs')).toBe(false);
  });
});

describe('the separator before Move to Trash', () => {
  it('is there when a row precedes it', () => {
    // :1010-1018 - only if switch/newdir/opendir/edit/rename put something up.
    expect(ids(projectTreeMenu([sel('TXT')]))).toStrictEqual([
      'editInTextEditor',
      'download',
      'renameFile',
      '--',
      'moveToTrash',
    ]);
  });

  it('is absent when Move to Trash is the only row', () => {
    // A multiple selection of PDFs: can_edit false (PDF), can_rename false
    // (multi, and CanRename(PDF) is true so the loop restores it) - the only
    // survivor is delete. Ours must not open with a leading rule.
    const m = projectTreeMenu([sel('PDF'), sel('PDF')]);
    expect(ids(m)[0]).not.toBe('--');
  });
});

describe('the multiple-selection quirk, ported as written', () => {
  it('lets the LAST item decide whether Move to Trash appears', () => {
    // `can_delete = item->CanDelete()` is an assignment inside the loop (:876),
    // not an and-equals, so the last item wins. Selecting a .txt and a board
    // therefore offers delete or not depending on which was selected last -
    // upstream's behaviour, and a "fix" here would show a row KiCad hides.
    expect(has(projectTreeMenu([sel('SEXPR_PCB'), sel('TXT')]), 'moveToTrash')).toBe(true);
    expect(has(projectTreeMenu([sel('TXT'), sel('SEXPR_PCB')]), 'moveToTrash')).toBe(false);
  });
});

describe('what is deliberately not here', () => {
  it('never draws "Open Directory in File Explorer"', () => {
    // There is no OS file manager and no folder to point one at.
    for (const t of ['DIRECTORY', 'JSON_PROJECT', 'TXT'] as TreeFileType[])
      expect(ids(projectTreeMenu([sel(t, true)]))).not.toContain('openDirectory');
  });

  it('has exactly one row of our own, and it is Download', () => {
    // Everything else on this menu is upstream's. If a second `ours` row ever
    // appears, this fails and someone has to justify it.
    const m = projectTreeMenu([sel('TXT')]);
    const mine = m.filter((e) => e !== 'separator' && e.ours);
    expect(mine).toHaveLength(1);
    expect(mine.map((e) => (e === 'separator' ? '' : e.id))).toStrictEqual(['download']);
  });
});
