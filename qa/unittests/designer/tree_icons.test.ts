// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The project tree's row icons, against `PROJECT_TREE::LoadIcons`
 * (`kicad/project_tree.cpp:110-140`).
 *
 * Thirty entries of data KiCad hardcodes. Nothing pinned any of them before,
 * so the nine we had and the folder-with-magnifier we drew on everything else
 * could sit there indefinitely without a test moving.
 *
 * Each expectation is the `BITMAPS::` enumerator from the C++, written out -
 * never read back from the table under test.
 */

import { describe, expect, it } from 'vitest';
import {
  TREE_FILE_TYPE_EXT,
  type TreeFileType,
} from '@ziroeda/designer/src/home/file_activation.js';
import { treeIconFor, treeIconForType } from '@ziroeda/designer/src/home/project_tree.js';

/**
 * LoadIcons in order, transcribed. The `images.push_back` list starts at
 * LEGACY_PROJECT because `SetState` indexes it with `m_type - 1`.
 */
const LOAD_ICONS: readonly (readonly [TreeFileType, string])[] = [
  ['LEGACY_PROJECT', 'project'],
  ['JSON_PROJECT', 'project_kicad'],
  ['LEGACY_SCHEMATIC', 'icon_eeschema_24'],
  ['SEXPR_SCHEMATIC', 'icon_eeschema_24'],
  ['LEGACY_PCB', 'icon_pcbnew_24'],
  ['SEXPR_PCB', 'icon_pcbnew_24'],
  ['GERBER', 'icon_gerbview_24'],
  ['GERBER_JOB_FILE', 'file_gerber_job'],
  ['HTML', 'file_html'],
  ['PDF', 'file_pdf'],
  ['TXT', 'editor'],
  ['MD', 'editor'],
  ['NET', 'netlist'],
  ['NET_SPICE', 'file_cir'],
  ['UNKNOWN', 'unknown'],
  ['DIRECTORY', 'directory'],
  ['CMP_LINK', 'icon_cvpcb_24'],
  ['REPORT', 'tools'],
  ['FP_PLACE', 'file_pos'],
  ['DRILL', 'file_drl'],
  ['DRILL_NC', 'file_drl'],
  ['DRILL_XNC', 'file_drl'],
  ['SVG', 'file_svg'],
  ['CSV', 'file_csv'],
  ['DRAWING_SHEET', 'icon_pagelayout_editor_24'],
  ['FOOTPRINT_FILE', 'module'],
  ['SCHEMATIC_LIBFILE', 'library'],
  ['SEXPR_SYMBOL_LIB_FILE', 'library'],
  ['DESIGN_RULES', 'editor'],
  ['ZIP_ARCHIVE', 'zip'],
  ['JOBSET_FILE', 'editor'],
];

describe('LoadIcons, entry by entry', () => {
  // One test per entry, named for the type: a table compared whole would say
  // "expected 31 items to equal 31 items" and leave you to find the row.
  for (const [type, bitmap] of LOAD_ICONS) {
    it(`${type} carries BITMAPS::${bitmap}`, () => {
      expect(treeIconForType(type)).toBe(bitmap);
    });
  }

  it('the root row carries BITMAPS::project, image index 0', () => {
    // AddRoot( fn.GetFullName(), TREE_FILE_TYPE::ROOT, TREE_FILE_TYPE::ROOT )
    // (project_tree_pane.cpp:747) asks for image 0, and image 0 is the first
    // push - LEGACY_PROJECT's. ROOT has no bitmap of its own.
    expect(treeIconForType('ROOT')).toBe('project');
  });

  it('covers every type the classification loop can return', () => {
    for (const [type] of TREE_FILE_TYPE_EXT) expect(treeIconForType(type)).not.toBe('');
    expect(treeIconForType('UNKNOWN')).not.toBe('');
    expect(treeIconForType('DIRECTORY')).not.toBe('');
  });
});

describe('the 16 vs 24 px split upstream makes', () => {
  it('uses the 24px schematic, board, gerber, cvpcb and drawing sheet bitmaps', () => {
    // LoadIcons asks for icon_eeschema_24, icon_pcbnew_24, icon_gerbview_24,
    // icon_cvpcb_24 and icon_pagelayout_editor_24. The _16 variants belong to
    // other controls; drawing them here was a real size difference, not a
    // rounding.
    expect(treeIconForType('SEXPR_SCHEMATIC')).toBe('icon_eeschema_24');
    expect(treeIconForType('SEXPR_PCB')).toBe('icon_pcbnew_24');
    expect(treeIconForType('GERBER')).toBe('icon_gerbview_24');
    expect(treeIconForType('CMP_LINK')).toBe('icon_cvpcb_24');
    expect(treeIconForType('DRAWING_SHEET')).toBe('icon_pagelayout_editor_24');
  });

  it('names no _16 bitmap anywhere in the table', () => {
    for (const [type] of LOAD_ICONS) expect(treeIconForType(type)).not.toMatch(/_16$/);
  });
});

describe('treeIconFor, from a file name', () => {
  it('routes a name through the same classification the double-click uses', () => {
    expect(treeIconFor('demo.kicad_pro')).toBe('project_kicad');
    expect(treeIconFor('demo.kicad_sch')).toBe('icon_eeschema_24');
    expect(treeIconFor('demo.kicad_pcb')).toBe('icon_pcbnew_24');
    expect(treeIconFor('R_0805.kicad_mod')).toBe('module');
    expect(treeIconFor('device.kicad_sym')).toBe('library');
    expect(treeIconFor('sheet.kicad_wks')).toBe('icon_pagelayout_editor_24');
  });

  it('gives the files a project folder is full of their own bitmaps', () => {
    // Every one of these drew `directory_browser` - a folder with a magnifier -
    // before this table existed.
    expect(treeIconFor('board-F_Cu.gbr')).toBe('icon_gerbview_24');
    expect(treeIconFor('board.gbrjob')).toBe('file_gerber_job');
    expect(treeIconFor('board.drl')).toBe('file_drl');
    expect(treeIconFor('board.nc')).toBe('file_drl');
    expect(treeIconFor('board.xnc')).toBe('file_drl');
    expect(treeIconFor('bom.csv')).toBe('file_csv');
    expect(treeIconFor('plot.svg')).toBe('file_svg');
    expect(treeIconFor('board-top.pos')).toBe('file_pos');
    expect(treeIconFor('assign.cmp')).toBe('icon_cvpcb_24');
    expect(treeIconFor('archive.zip')).toBe('zip');
    expect(treeIconFor('doc.html')).toBe('file_html');
    expect(treeIconFor('sim.cir')).toBe('file_cir');
    expect(treeIconFor('board.kicad_dru')).toBe('editor');
    expect(treeIconFor('build.kicad_jobset')).toBe('editor');
  });

  it('stops giving txt, md, rpt and net one shared glyph', () => {
    // Upstream uses three different bitmaps across these four; ours used one
    // (`datasheet`) for all of them.
    expect(treeIconFor('readme.txt')).toBe('editor');
    expect(treeIconFor('readme.md')).toBe('editor');
    expect(treeIconFor('drc.rpt')).toBe('tools');
    expect(treeIconFor('board.net')).toBe('netlist');
    expect(new Set(['editor', 'tools', 'netlist']).size).toBe(3);
  });

  it('falls back to BITMAPS::unknown, not to a folder', () => {
    // `type` is initialised to TREE_FILE_TYPE::UNKNOWN and LoadIcons gives that
    // its own bitmap. Ours answered `directory_browser`, which reads as a
    // folder on a row that is a file.
    expect(treeIconFor('archive.tar.gz')).toBe('unknown');
    expect(treeIconFor('Makefile')).toBe('unknown');
    expect(treeIconFor('doc.htm')).toBe('unknown');
  });

  it('never answers directory_browser or datasheet for a file', () => {
    // Neither is in LoadIcons at all: `directory_browser` belongs to the popup
    // menu's "Open Directory in File Explorer" row, and `datasheet` is not a
    // project-tree bitmap upstream in any form.
    for (const name of [
      'a.txt',
      'a.md',
      'a.rpt',
      'a.net',
      'a.gbr',
      'a.drl',
      'a.csv',
      'a.zip',
      'a.unknownext',
      'a.step',
    ]) {
      expect(treeIconFor(name)).not.toBe('directory_browser');
      expect(treeIconFor(name)).not.toBe('datasheet');
    }
  });
});
