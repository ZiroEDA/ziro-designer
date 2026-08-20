// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The project folder's file allowlist, against `s_allowedExtensionsToList`.
 *
 * `PROJECT_TREE_PANE` shows only what matches (`project_tree_pane.cpp:266`), so
 * this table decides what a user can see at all. Getting it wrong is invisible
 * in the good direction — a file that should list and does not looks like an
 * empty folder, not like a bug.
 *
 * The interesting cases are the ones that look like mistakes and are not.
 */
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_FILE_PATTERNS,
  NO_FILES_FOUND,
  isListedFile,
} from '@ziroeda/designer/src/fs/allowlist.js';

describe('the allowlist is upstream’s table, in upstream’s order', () => {
  it('has the 38 patterns the array has', () => {
    // A count is a weak assertion on its own; it is here so that dropping one
    // while adding another cannot pass the spot-checks below.
    expect(ALLOWED_FILE_PATTERNS).toHaveLength(38);
  });

  it('starts and ends where upstream does', () => {
    expect(ALLOWED_FILE_PATTERNS[0]).toBe('^.*\\.pro$');
    expect(ALLOWED_FILE_PATTERNS.at(-1)).toBe('^.*\\.kicad_jobset');
  });

  it('does not carry the empty-folder sentinel as an extension', () => {
    // `^no KiCad files found` sits in the same array upstream (:268) but is a
    // row, not a pattern. Listing a file called "no KiCad files found" would be
    // the bug if it were included here.
    expect(ALLOWED_FILE_PATTERNS.some((p) => p.includes('no KiCad'))).toBe(false);
    expect(NO_FILES_FOUND).toBe('no KiCad files found');
    expect(isListedFile('no KiCad files found')).toBe(false);
  });
});

describe('what a project folder shows', () => {
  for (const name of [
    'board.kicad_pro',
    'sheet.kicad_sch',
    'board.kicad_pcb',
    'lib.kicad_sym',
    'notes.md',
    'readme.txt',
    'datasheet.pdf',
    'bom.csv',
    'top.gbr',
    'drill.drl',
    'panel.zip',
  ]) {
    it(`lists ${name}`, () => expect(isListedFile(name)).toBe(true));
  }

  for (const name of ['spec.docx', 'photo.png', 'archive.tar', 'Makefile', 'notes']) {
    it(`hides ${name}`, () => expect(isListedFile(name)).toBe(false));
  }
});

describe('the parts that look like mistakes and are upstream’s', () => {
  it('hides a board whose name begins with a dollar, and shows one that does not', () => {
    // `^[^$].*\.kicad_pcb$` — four patterns open this way. Backup and lock
    // files are what it excludes.
    expect(isListedFile('board.kicad_pcb')).toBe(true);
    expect(isListedFile('$board.kicad_pcb')).toBe(false);
    expect(isListedFile('$old.brd')).toBe(false);
    expect(isListedFile('$rules.kicad_dru')).toBe(false);
    expect(isListedFile('$sheet.kicad_wks')).toBe(false);
    // …and only those four. A dollar-prefixed schematic still lists, because
    // `^.*\.kicad_sch$` does not exclude it.
    expect(isListedFile('$sheet.kicad_sch')).toBe(true);
  });

  it('matches .kicad_jobset anywhere in the name, because that pattern has no $', () => {
    // The last entry is `^.*\.kicad_jobset` — no anchor. Ported deliberately:
    // correcting it would be the port diverging from what KiCad does.
    expect(isListedFile('run.kicad_jobset')).toBe(true);
    expect(isListedFile('run.kicad_jobset.bak')).toBe(true);
    // Every other pattern is anchored, so the same trick does not work on them.
    expect(isListedFile('board.kicad_pcb.bak')).toBe(false);
  });

  it('is case-sensitive, as wxRegEx is here without wxRE_ICASE', () => {
    expect(isListedFile('board.kicad_pcb')).toBe(true);
    expect(isListedFile('BOARD.KICAD_PCB')).toBe(false);
  });

  it('reads the Protel families as character classes, not as literals', () => {
    // `^.*\.gb[alops]$` and friends — five letters each, and nothing else.
    for (const ext of ['gba', 'gbl', 'gbo', 'gbp', 'gbs']) {
      expect(isListedFile(`board.${ext}`), ext).toBe(true);
    }
    expect(isListedFile('board.gbx')).toBe(false);
    // `^.*\.g[0-9]{1,2}$` — one or two digits, not three.
    expect(isListedFile('board.g1')).toBe(true);
    expect(isListedFile('board.g12')).toBe(true);
    expect(isListedFile('board.g123')).toBe(false);
  });
});
