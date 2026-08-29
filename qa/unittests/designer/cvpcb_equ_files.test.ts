// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The footprint association file LIST: where it is persisted, how a `.equ` file
 * is found, and what the five buttons of Manage Footprint Association Files do
 * to it.
 *
 * Counterparts: `common/project/project_file.cpp:72-73`
 * (`cvpcb.equivalence_files`, a `PARAM_PATH_LIST`) and
 * `cvpcb/dialogs/dialog_config_equfiles.cpp` (the handlers).
 *
 * The move tests use a THREE-row list with the moved row in the middle,
 * because a two-row list cannot tell "swap with the neighbour" from "reverse
 * the list", and the guard tests select the row the guard is about — a
 * selection in the middle can never reach `selections[0] == 0`.
 */
import { describe, it, expect } from 'vitest';
import {
  addEquFile,
  equFileExistsMessage,
  equFilePathFor,
  moveEquFilesDown,
  moveEquFilesUp,
  readEquFile,
  removeEquFiles,
  type EquFileList,
} from '@ziroeda/designer/src/editors/schematic/cvpcb_equ_files.js';
import {
  readEquivalenceFiles,
  readEquivalenceFilesText,
  writeEquivalenceFilesText,
} from '@ziroeda/designer/src/editors/schematic/project_settings.js';

const PRO = JSON.stringify(
  {
    cvpcb: { equivalence_files: ['${KIPRJMOD}/a.equ', '${KIPRJMOD}/b.equ'] },
    meta: { filename: 'Proj.kicad_pro', version: 3 },
    text_variables: { FOO: 'bar' },
  },
  null,
  2,
);

const project = [
  { name: 'Proj/Proj.kicad_pro', text: PRO },
  { name: 'Proj/a.equ', text: "'R' 'Lib:R_A'\n" },
  { name: 'Proj/sub/c.equ', text: "'C' 'Lib:C_C'\n" },
];

describe('cvpcb.equivalence_files (project_file.cpp:72-73)', () => {
  it('reads the list in file order', () => {
    expect(readEquivalenceFilesText(PRO)).toEqual(['${KIPRJMOD}/a.equ', '${KIPRJMOD}/b.equ']);
    expect(readEquivalenceFiles(project)).toEqual(['${KIPRJMOD}/a.equ', '${KIPRJMOD}/b.equ']);
  });

  it('a project with no key, or unreadable JSON, has no association files', () => {
    expect(readEquivalenceFilesText('{}')).toEqual([]);
    expect(readEquivalenceFilesText('not json')).toEqual([]);
    expect(readEquivalenceFiles([])).toEqual([]);
  });

  it('drops a non-string entry rather than carrying it into the reader', () => {
    expect(readEquivalenceFilesText('{"cvpcb":{"equivalence_files":["a.equ",7,null]}}')).toEqual([
      'a.equ',
    ]);
  });

  it('writes the list back and preserves every other key', () => {
    const out = writeEquivalenceFilesText(PRO, ['${KIPRJMOD}/z.equ']);
    expect(out).not.toBeNull();
    const j = JSON.parse(out as string);
    expect(j.cvpcb.equivalence_files).toEqual(['${KIPRJMOD}/z.equ']);
    expect(j.text_variables).toEqual({ FOO: 'bar' });
    expect(j.meta.filename).toBe('Proj.kicad_pro');
  });

  it('creates the section when the project has none', () => {
    const out = writeEquivalenceFilesText('{"meta":{"version":3}}', ['a.equ']);
    expect(JSON.parse(out as string).cvpcb.equivalence_files).toEqual(['a.equ']);
  });

  it('stores unix separators, like PARAM_PATH_LIST::toFileFormat', () => {
    // parameters.h:207-212 — `ret.Replace( "\\", "/" )` on the way out.
    const out = writeEquivalenceFilesText(PRO, ['${KIPRJMOD}\\sub\\d.equ']);
    expect(JSON.parse(out as string).cvpcb.equivalence_files).toEqual(['${KIPRJMOD}/sub/d.equ']);
  });

  it('an unparseable project is left alone rather than rewritten', () => {
    expect(writeEquivalenceFilesText('not json', ['a.equ'])).toBeNull();
  });
});

describe('finding a listed .equ file in the project', () => {
  it('resolves ${KIPRJMOD} against the folder the .kicad_pro is in', () => {
    expect(readEquFile(project, '${KIPRJMOD}/a.equ')).toBe("'R' 'Lib:R_A'\n");
    expect(readEquFile(project, '${KIPRJMOD}/sub/c.equ')).toBe("'C' 'Lib:C_C'\n");
  });

  it('accepts the legacy $(KIPRJMOD) spelling', () => {
    expect(readEquFile(project, '$(KIPRJMOD)/a.equ')).toBe("'R' 'Lib:R_A'\n");
  });

  it('and the absolute account path the file chooser hands back', () => {
    expect(readEquFile(project, '/Proj/a.equ')).toBe("'R' 'Lib:R_A'\n");
  });

  it('answers null for a file the project has not got', () => {
    expect(readEquFile(project, '${KIPRJMOD}/gone.equ')).toBeNull();
    // Exactly, not loosely: `${KIPRJMOD}/c.equ` is the project ROOT's c.equ,
    // never the one in `sub/`.
    expect(readEquFile(project, '${KIPRJMOD}/c.equ')).toBeNull();
  });
});

describe('equFilePathFor (OnAddFiles’s relativization, :214-238)', () => {
  it('writes ${KIPRJMOD}/… for a file under the project folder', () => {
    expect(equFilePathFor('/Proj/values.equ', project)).toBe('${KIPRJMOD}/values.equ');
    expect(equFilePathFor('/Proj/sub/c.equ', project)).toBe('${KIPRJMOD}/sub/c.equ');
  });

  it('keeps the path whole when it is not under the project folder', () => {
    // `if( filepath.IsEmpty() ) filepath = filenames[jj];` (`:235-236`).
    expect(equFilePathFor('/Shared/common.equ', project)).toBe('Shared/common.equ');
  });

  it('normalizes backslashes ("Use unix separators only.", :242)', () => {
    expect(equFilePathFor('\\Proj\\sub\\c.equ', project)).toBe('${KIPRJMOD}/sub/c.equ');
  });

  it('a project with no .kicad_pro has no root, so the path stays whole', () => {
    expect(equFilePathFor('/Proj/values.equ', [])).toBe('Proj/values.equ');
  });
});

describe('the five buttons of DIALOG_CONFIG_EQUFILES', () => {
  const list = (files: string[], selection: number[] = []): EquFileList => ({ files, selection });

  it('Add appends, and does not select what it added', () => {
    const out = addEquFile(list(['a.equ'], [0]), 'b.equ');
    expect(out.files).toEqual(['a.equ', 'b.equ']);
    expect(out.selection).toEqual([0]);
    expect(out.error).toBeNull();
  });

  it('Add refuses a duplicate and says so (:246-253)', () => {
    const out = addEquFile(list(['a.equ']), 'a.equ');
    expect(out.files).toEqual(['a.equ']);
    expect(out.error).toBe("File 'a.equ' already exists in list.");
    expect(out.error).toBe(equFileExistsMessage('a.equ'));
  });

  it('Add’s duplicate test is case sensitive, as wxFileName::IsCaseSensitive is here', () => {
    expect(addEquFile(list(['a.equ']), 'A.equ').files).toEqual(['a.equ', 'A.equ']);
  });

  it('Remove deletes every selected row and selects nothing after', () => {
    const out = removeEquFiles(list(['a', 'b', 'c'], [0, 2]));
    expect(out.files).toEqual(['b']);
    expect(out.selection).toEqual([]);
  });

  it('Remove with nothing selected is a no-op', () => {
    expect(removeEquFiles(list(['a', 'b']))).toEqual({ files: ['a', 'b'], selection: [] });
  });

  it('Move Up swaps with the row above and keeps the moved row selected', () => {
    const out = moveEquFilesUp(list(['a', 'b', 'c'], [1]));
    expect(out.files).toEqual(['b', 'a', 'c']);
    expect(out.selection).toEqual([0]);
  });

  it('Move Up does NOTHING when the selection includes the first row (:132-133)', () => {
    // Not "move the others and leave that one" - the whole command returns.
    const out = moveEquFilesUp(list(['a', 'b', 'c'], [0, 2]));
    expect(out.files).toEqual(['a', 'b', 'c']);
    expect(out.selection).toEqual([0, 2]);
  });

  it('Move Down swaps with the row below and keeps the moved row selected', () => {
    const out = moveEquFilesDown(list(['a', 'b', 'c'], [1]));
    expect(out.files).toEqual(['a', 'c', 'b']);
    expect(out.selection).toEqual([2]);
  });

  it('Move Down does NOTHING when the selection includes the last row (:159-161)', () => {
    const out = moveEquFilesDown(list(['a', 'b', 'c'], [0, 2]));
    expect(out.files).toEqual(['a', 'b', 'c']);
    expect(out.selection).toEqual([0, 2]);
  });

  it('a contiguous multi-row selection moves as a block, both ways', () => {
    // `for( ii = count-1; ii >= 0; ii-- )` on the way down and forwards on the
    // way up: the walk direction is what stops a block from eating itself.
    expect(moveEquFilesDown(list(['a', 'b', 'c', 'd'], [1, 2])).files).toEqual([
      'a',
      'd',
      'b',
      'c',
    ]);
    expect(moveEquFilesUp(list(['a', 'b', 'c', 'd'], [1, 2])).files).toEqual(['b', 'c', 'a', 'd']);
  });

  it('both moves are no-ops with nothing selected', () => {
    expect(moveEquFilesUp(list(['a', 'b']))).toEqual({ files: ['a', 'b'], selection: [] });
    expect(moveEquFilesDown(list(['a', 'b']))).toEqual({ files: ['a', 'b'], selection: [] });
  });
});
