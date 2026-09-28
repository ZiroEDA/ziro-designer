// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EESCHEMA_HELPERS::LoadSchematic`'s two pure pieces (eeschema_helpers.cpp):
 * the format-by-extension dispatch, and the root-sheet display-name
 * resolution against a project's top-level-sheets list.
 */
import {
  chooseSchFileFormat,
  resolveRootSheetName,
  SCH_FILE_T,
} from '@ziroeda/eeschema/eeschema_helpers.js';
import { TOP_LEVEL_SHEET_INFO } from '@ziroeda/common/project/project_file.js';
import { describe, expect, it } from 'vitest';

describe('chooseSchFileFormat', () => {
  it('picks SCH_KICAD for a .kicad_sch file', () => {
    expect(chooseSchFileFormat('board.kicad_sch')).toBe(SCH_FILE_T.SCH_KICAD);
  });

  it('is case-insensitive on the extension', () => {
    expect(chooseSchFileFormat('BOARD.KICAD_SCH')).toBe(SCH_FILE_T.SCH_KICAD);
  });

  it('picks SCH_LEGACY for a .sch file', () => {
    expect(chooseSchFileFormat('board.sch')).toBe(SCH_FILE_T.SCH_LEGACY);
  });

  it('falls back to SCH_LEGACY for any other extension', () => {
    expect(chooseSchFileFormat('board.txt')).toBe(SCH_FILE_T.SCH_LEGACY);
    expect(chooseSchFileFormat('board')).toBe(SCH_FILE_T.SCH_LEGACY);
  });
});

describe('resolveRootSheetName', () => {
  it('returns the matching top-level-sheet entry name by absolute path', () => {
    const sheets = [
      new TOP_LEVEL_SHEET_INFO('', 'Power', 'power.kicad_sch'),
      new TOP_LEVEL_SHEET_INFO('', 'Main', 'board.kicad_sch'),
    ];
    expect(resolveRootSheetName(sheets, '/Proj/', '/Proj/board.kicad_sch')).toBe('Main');
  });

  it('falls back to "Root" when nothing matches', () => {
    const sheets = [new TOP_LEVEL_SHEET_INFO('', 'Power', 'power.kicad_sch')];
    expect(resolveRootSheetName(sheets, '/Proj/', '/Proj/board.kicad_sch')).toBe('Root');
  });

  it('falls back to "Root" when the list is empty', () => {
    expect(resolveRootSheetName([], '/Proj/', '/Proj/board.kicad_sch')).toBe('Root');
  });

  it('skips an entry with an empty name even if its path matches', () => {
    const sheets = [new TOP_LEVEL_SHEET_INFO('', '', 'board.kicad_sch')];
    expect(resolveRootSheetName(sheets, '/Proj/', '/Proj/board.kicad_sch')).toBe('Root');
  });
});
