// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PROJECT_TREE_ITEM::Activate` and the classification before it, against
 * `kicad/project_tree_item.cpp` and `kicad/project_tree_pane.cpp`.
 *
 * Every expectation is transcribed from the C++ - the branch a type takes is
 * written out here, never fetched by calling `activationFor` a second time.
 */

import { describe, expect, it } from 'vitest';
import {
  TREE_FILE_TYPE_EXT,
  type Activation,
  type TreeFileType,
  activationFor,
  activationForFile,
  canDelete,
  canRename,
  projectFileContext,
  runActivation,
  treeFileType,
} from '@ziroeda/designer/src/home/file_activation.js';

describe("addItemToProjectTree's classification loop", () => {
  it('gives each extension the type GetFileExt names it for', () => {
    expect(treeFileType('board.kicad_pcb')).toBe('SEXPR_PCB');
    expect(treeFileType('board.brd')).toBe('LEGACY_PCB');
    expect(treeFileType('sheet.kicad_sch')).toBe('SEXPR_SCHEMATIC');
    expect(treeFileType('sheet.sch')).toBe('LEGACY_SCHEMATIC');
    expect(treeFileType('blinky.kicad_pro')).toBe('JSON_PROJECT');
    expect(treeFileType('blinky.pro')).toBe('LEGACY_PROJECT');
    expect(treeFileType('notes.pdf')).toBe('PDF');
    expect(treeFileType('readme.txt')).toBe('TXT');
    expect(treeFileType('readme.md')).toBe('MD');
    expect(treeFileType('board.net')).toBe('NET');
    expect(treeFileType('sim.cir')).toBe('NET_SPICE');
    expect(treeFileType('drc.rpt')).toBe('REPORT');
    expect(treeFileType('board.drl')).toBe('DRILL');
    expect(treeFileType('board.nc')).toBe('DRILL_NC');
    expect(treeFileType('board.xnc')).toBe('DRILL_XNC');
    expect(treeFileType('sheet.kicad_wks')).toBe('DRAWING_SHEET');
    expect(treeFileType('R_0805.kicad_mod')).toBe('FOOTPRINT_FILE');
    expect(treeFileType('device.kicad_sym')).toBe('SEXPR_SYMBOL_LIB_FILE');
    expect(treeFileType('device.lib')).toBe('SCHEMATIC_LIBFILE');
    expect(treeFileType('board.kicad_dru')).toBe('DESIGN_RULES');
    expect(treeFileType('project.zip')).toBe('ZIP_ARCHIVE');
    expect(treeFileType('build.kicad_jobset')).toBe('JOBSET_FILE');
    expect(treeFileType('assign.cmp')).toBe('CMP_LINK');
    expect(treeFileType('board-top.pos')).toBe('FP_PLACE');
    expect(treeFileType('plot.svg')).toBe('SVG');
    expect(treeFileType('bom.csv')).toBe('CSV');
    expect(treeFileType('doc.html')).toBe('HTML');
  });

  it('reads the gerber regex, not a list of gerber extensions', () => {
    // FILEEXT::GerberFileExtensionsRegex, "(gbr|gko|pho|(g[tb][alops])|(gm?\\d\\d*)|(gp[tb]))".
    for (const name of [
      'board.gbr',
      'board.gko',
      'board.pho',
      'board.gtl',
      'board.gbs',
      'board.gtp',
      'board.gpt',
      'board.gpb',
      'board.g1',
      'board.g12',
      'board.gm1',
      'board.gm13',
    ]) {
      expect(treeFileType(name)).toBe('GERBER');
    }
  });

  it('does not let the gerber regex swallow a gerber job file', () => {
    // GERBER is earlier in the enum than GERBER_JOB_FILE, so it gets first
    // refusal - but the pattern is anchored, and "gbrjob" is not "gbr".
    expect(treeFileType('board.gbrjob')).toBe('GERBER_JOB_FILE');
  });

  it('anchors at a dot, so kicad_pro is not pro and kicad_sch is not sch', () => {
    // "^.*\\." + ext + "$": the character before the extension must be a dot.
    // LEGACY_PROJECT (.pro) is earlier in the enum than JSON_PROJECT
    // (.kicad_pro), so getting this wrong would call every project a legacy one.
    expect(treeFileType('blinky.kicad_pro')).not.toBe('LEGACY_PROJECT');
    expect(treeFileType('sheet.kicad_sch')).not.toBe('LEGACY_SCHEMATIC');
    expect(treeFileType('board.kicad_pcb')).not.toBe('LEGACY_PCB');
  });

  it('is case-insensitive, as wxRE_ICASE makes it', () => {
    expect(treeFileType('BOARD.KICAD_PCB')).toBe('SEXPR_PCB');
    expect(treeFileType('Notes.Pdf')).toBe('PDF');
  });

  it('answers UNKNOWN for a name no member matches', () => {
    expect(treeFileType('archive.tar.gz')).toBe('UNKNOWN');
    expect(treeFileType('Makefile')).toBe('UNKNOWN');
    expect(treeFileType('kicad_pcb')).toBe('UNKNOWN');
  });

  it('calls a .htm UNKNOWN, because FILEEXT::HtmlFileExtension is "html"', () => {
    // s_allowedExtensionsToList lists both `.htm` and `.html`, so the tree
    // shows a `.htm`; GetFileExt only knows `.html`, so the `.htm` reaches
    // Activate as UNKNOWN and takes the default branch. Upstream's own quirk.
    expect(treeFileType('doc.htm')).toBe('UNKNOWN');
    expect(treeFileType('doc.html')).toBe('HTML');
  });

  it('has no entry for the four types GetFileExt returns wxEmptyString for', () => {
    const listed = TREE_FILE_TYPE_EXT.map(([t]) => t);
    for (const t of ['ROOT', 'UNKNOWN', 'DIRECTORY'] as TreeFileType[])
      expect(listed).not.toContain(t);
    // And the loop starts at LEGACY_PROJECT, which is the first entry.
    expect(listed[0]).toBe('LEGACY_PROJECT');
    // 31 members between LEGACY_PROJECT and MAX, less ROOT (before the start)
    // and the three that answer wxEmptyString: UNKNOWN and DIRECTORY.
    expect(listed).toHaveLength(29);
  });
});

describe("Activate's switch", () => {
  it('sends a board to the PCB editor, and a foreign board to editOtherPCB', () => {
    expect(activationFor('SEXPR_PCB', { isProjectBoard: true })).toStrictEqual({
      kind: 'editPcb',
    });
    expect(activationFor('SEXPR_PCB', { isProjectBoard: false })).toStrictEqual({
      kind: 'editOtherPcb',
    });
    expect(activationFor('LEGACY_PCB', { isProjectBoard: true })).toStrictEqual({
      kind: 'editPcb',
    });
  });

  it('splits a schematic three ways: root, in-hierarchy, standalone', () => {
    expect(activationFor('SEXPR_SCHEMATIC', { isRootSchematic: true })).toStrictEqual({
      kind: 'editSchematic',
    });
    expect(
      activationFor('SEXPR_SCHEMATIC', { isRootSchematic: false, isInSchematicHierarchy: true }),
    ).toStrictEqual({ kind: 'navigateToSheet' });
    expect(
      activationFor('SEXPR_SCHEMATIC', { isRootSchematic: false, isInSchematicHierarchy: false }),
    ).toStrictEqual({ kind: 'editOtherSchematic' });
  });

  it('ignores the hierarchy once the file is the root sheet', () => {
    // Upstream only scans in the else branch, so isInSchematicHierarchy must
    // not be able to turn the root sheet into a navigation.
    expect(
      activationFor('SEXPR_SCHEMATIC', { isRootSchematic: true, isInSchematicHierarchy: true }),
    ).toStrictEqual({ kind: 'editSchematic' });
  });

  it('opens a project, unless it is the row the project is already loaded from', () => {
    expect(activationFor('JSON_PROJECT', { isTreeRoot: false })).toStrictEqual({
      kind: 'loadProject',
    });
    expect(activationFor('LEGACY_PROJECT', { isTreeRoot: false })).toStrictEqual({
      kind: 'loadProject',
    });
    expect(activationFor('JSON_PROJECT', { isTreeRoot: true })).toStrictEqual({ kind: 'none' });
  });

  it('sends all five gerber and drill types to viewGerbers', () => {
    for (const t of [
      'GERBER',
      'GERBER_JOB_FILE',
      'DRILL',
      'DRILL_NC',
      'DRILL_XNC',
    ] as TreeFileType[]) {
      expect(activationFor(t)).toStrictEqual({ kind: 'viewGerbers' });
    }
  });

  it('sends the four text types to the text editor, and marks it impossible', () => {
    // KICAD_MANAGER_ACTIONS::openTextEditor runs Pgm().GetTextEditor(), an
    // external program. There is none in a browser.
    for (const t of ['NET', 'TXT', 'MD', 'REPORT'] as TreeFileType[]) {
      expect(activationFor(t)).toStrictEqual({ kind: 'openTextEditor', impossible: true });
    }
  });

  it('keeps HTML and PDF apart, as two different system calls', () => {
    expect(activationFor('HTML')).toStrictEqual({
      kind: 'launchDefaultBrowser',
      impossible: true,
    });
    expect(activationFor('PDF')).toStrictEqual({ kind: 'openPdf', impossible: true });
  });

  it('sends a footprint, a symbol library and a drawing sheet to their editors', () => {
    expect(activationFor('FOOTPRINT_FILE')).toStrictEqual({ kind: 'editFootprint' });
    expect(activationFor('SEXPR_SYMBOL_LIB_FILE')).toStrictEqual({ kind: 'editSymbol' });
    expect(activationFor('SCHEMATIC_LIBFILE')).toStrictEqual({ kind: 'editSymbol' });
    expect(activationFor('DRAWING_SHEET')).toStrictEqual({ kind: 'editDrawingSheet' });
  });

  it('opens a jobset file and toggles a directory', () => {
    expect(activationFor('JOBSET_FILE')).toStrictEqual({ kind: 'openJobsFile' });
    expect(activationFor('DIRECTORY')).toStrictEqual({ kind: 'toggleDirectory' });
  });

  it('drops everything with no case label of its own into default:', () => {
    // These seven types exist in TREE_FILE_TYPE and are listed by
    // s_allowedExtensionsToList, and the switch has no label for any of them -
    // so a .cir, a .csv or a .kicad_dru reaches wxLaunchDefaultApplication.
    for (const t of [
      'NET_SPICE',
      'CMP_LINK',
      'FP_PLACE',
      'SVG',
      'CSV',
      'DESIGN_RULES',
      'ZIP_ARCHIVE',
      'UNKNOWN',
    ] as TreeFileType[]) {
      expect(activationFor(t)).toStrictEqual({
        kind: 'launchDefaultApplication',
        impossible: true,
      });
    }
  });

  it('leaves the schematic and board branches to editOther when no project is loaded', () => {
    // The file manager's case: nothing is loaded, so nothing is the project's
    // own root sheet or board, and the context defaults say so.
    expect(activationFor('SEXPR_SCHEMATIC')).toStrictEqual({ kind: 'editOtherSchematic' });
    expect(activationFor('SEXPR_PCB')).toStrictEqual({ kind: 'editOtherPcb' });
  });
});

describe('activationForFile', () => {
  it('is the classification and the switch, in that order', () => {
    expect(activationForFile('notes.pdf')).toStrictEqual({ kind: 'openPdf', impossible: true });
    expect(activationForFile('R_0805.kicad_mod')).toStrictEqual({ kind: 'editFootprint' });
    expect(activationForFile('board.gtl')).toStrictEqual({ kind: 'viewGerbers' });
    expect(activationForFile('board.kicad_pcb', { isProjectBoard: true })).toStrictEqual({
      kind: 'editPcb',
    });
  });

  it('is what the tree could not do before: every listable file now answers', () => {
    // The pane carried six regexes - pcb, sch, sym, mod, wks, pro - and a
    // double click on anything else did nothing at all. None of these six
    // names had a branch, and all six have one now.
    for (const name of [
      'notes.pdf',
      'readme.txt',
      'readme.md',
      'drc.rpt',
      'board.gbr',
      'build.kicad_jobset',
    ]) {
      expect(activationForFile(name).kind).not.toBe('none');
    }
  });
});

describe('projectFileContext (frame->PcbFileName / SchFileName)', () => {
  it('calls the file named after the project its board and its root sheet', () => {
    expect(projectFileContext('demo/demo.kicad_pcb', 'demo.kicad_pro')).toStrictEqual({
      isProjectBoard: true,
      isRootSchematic: false,
    });
    expect(projectFileContext('demo/demo.kicad_sch', 'demo.kicad_pro')).toStrictEqual({
      isProjectBoard: false,
      isRootSchematic: true,
    });
  });

  it('knows the legacy pair too - PcbLegacyFileName and SchLegacyFileName', () => {
    expect(projectFileContext('demo/demo.brd', 'demo.kicad_pro').isProjectBoard).toBe(true);
    expect(projectFileContext('demo/demo.sch', 'demo.kicad_pro').isRootSchematic).toBe(true);
  });

  it("says no to the project next door's board, which is editOtherPCB", () => {
    // A project folder may hold several projects; the tree lists every one's
    // .kicad_pcb, and only the loaded project's is `editPCB`.
    const ctx = projectFileContext('demo/other.kicad_pcb', 'demo.kicad_pro');
    expect(ctx.isProjectBoard).toBe(false);
    expect(activationFor('SEXPR_PCB', ctx)).toStrictEqual({ kind: 'editOtherPcb' });
  });

  it('takes the project name with or without its extension', () => {
    expect(projectFileContext('demo.kicad_pcb', 'demo').isProjectBoard).toBe(true);
    expect(projectFileContext('demo.kicad_pcb', 'demo.kicad_pro').isProjectBoard).toBe(true);
  });

  it('matches case-insensitively, as the rest of this does', () => {
    expect(projectFileContext('Demo/DEMO.kicad_pcb', 'demo.kicad_pro').isProjectBoard).toBe(true);
  });

  it('is not fooled by a sub-sheet that merely lives in the project folder', () => {
    expect(projectFileContext('demo/power.kicad_sch', 'demo.kicad_pro').isRootSchematic).toBe(
      false,
    );
  });
});

describe('runActivation', () => {
  it('runs the handler the branch names, and only that one', () => {
    const calls: string[] = [];
    const handlers = {
      loadProject: () => calls.push('loadProject'),
      editPcb: () => calls.push('editPcb'),
      editSymbol: () => calls.push('editSymbol'),
      viewGerbers: () => calls.push('viewGerbers'),
      handOff: () => calls.push('handOff'),
    };
    expect(runActivation({ kind: 'editPcb' }, handlers)).toBe(true);
    expect(calls).toStrictEqual(['editPcb']);
  });

  it('folds the three schematic branches onto one handler', () => {
    const seen: string[] = [];
    const handlers = { editSchematic: (a: Activation) => seen.push(a.kind) };
    for (const kind of ['editSchematic', 'navigateToSheet', 'editOtherSchematic'] as const)
      expect(runActivation({ kind }, handlers)).toBe(true);
    // and the handler is told which of the three it was
    expect(seen).toStrictEqual(['editSchematic', 'navigateToSheet', 'editOtherSchematic']);
  });

  it('folds the four system branches onto handOff, naming each one', () => {
    const seen: string[] = [];
    const handlers = { handOff: (a: Activation) => seen.push(a.kind) };
    expect(runActivation({ kind: 'openTextEditor', impossible: true }, handlers)).toBe(true);
    expect(runActivation({ kind: 'openPdf', impossible: true }, handlers)).toBe(true);
    expect(runActivation({ kind: 'launchDefaultBrowser', impossible: true }, handlers)).toBe(true);
    expect(runActivation({ kind: 'launchDefaultApplication', impossible: true }, handlers)).toBe(
      true,
    );
    expect(seen).toStrictEqual([
      'openTextEditor',
      'openPdf',
      'launchDefaultBrowser',
      'launchDefaultApplication',
    ]);
  });

  it('reports false when the call site has no handler for the branch', () => {
    expect(runActivation({ kind: 'openJobsFile' }, {})).toBe(false);
    expect(runActivation({ kind: 'viewGerbers' }, { editPcb: () => {} })).toBe(false);
  });

  it('reports true for `none`, which is upstream doing nothing on purpose', () => {
    expect(runActivation({ kind: 'none' }, {})).toBe(true);
  });

  it('has a handler for every branch a file can produce', () => {
    // The bug this whole module replaces was a call site that answered six
    // types and silently ignored the rest. Nothing a real file can classify as
    // may fall through runActivation unhandled.
    const everything = {
      loadProject: () => {},
      openJobsFile: () => {},
      toggleDirectory: () => {},
      editSchematic: () => {},
      editPcb: () => {},
      viewGerbers: () => {},
      editDrawingSheet: () => {},
      editFootprint: () => {},
      editSymbol: () => {},
      handOff: () => {},
    };
    for (const [type] of TREE_FILE_TYPE_EXT)
      expect(runActivation(activationFor(type), everything)).toBe(true);
    expect(runActivation(activationFor('UNKNOWN'), everything)).toBe(true);
  });
});

describe('CanDelete: the twelve types KiCad refuses to delete or rename', () => {
  /**
   * One test per type, named for the type.
   *
   * A single "the protected types are protected" assertion over an array would
   * report `expected [11 items] to equal [12 items]` when one fell off the
   * list, which does not say WHICH. This rule is per-occurrence - each type is
   * separately load-bearing, and `.kicad_sch` dropping out is a different bug
   * from `.kicad_dru` dropping out - so each gets its own named test.
   *
   * Every one of these is a line of the `if` in
   * `kicad/project_tree_item.cpp:81-96`.
   */
  it('a DIRECTORY cannot be deleted or renamed', () => {
    expect(canDelete('DIRECTORY')).toBe(false);
    expect(canRename('DIRECTORY')).toBe(false);
  });

  it('a LEGACY_PROJECT (.pro) cannot be deleted or renamed', () => {
    expect(canDelete('LEGACY_PROJECT')).toBe(false);
    expect(canRename('LEGACY_PROJECT')).toBe(false);
  });

  it('a JSON_PROJECT (.kicad_pro) cannot be deleted or renamed', () => {
    expect(canDelete('JSON_PROJECT')).toBe(false);
    expect(canRename('JSON_PROJECT')).toBe(false);
  });

  it('a LEGACY_SCHEMATIC (.sch) cannot be deleted or renamed', () => {
    expect(canDelete('LEGACY_SCHEMATIC')).toBe(false);
    expect(canRename('LEGACY_SCHEMATIC')).toBe(false);
  });

  it('a SEXPR_SCHEMATIC (.kicad_sch) cannot be deleted or renamed', () => {
    expect(canDelete('SEXPR_SCHEMATIC')).toBe(false);
    expect(canRename('SEXPR_SCHEMATIC')).toBe(false);
  });

  it('a LEGACY_PCB (.brd) cannot be deleted or renamed', () => {
    expect(canDelete('LEGACY_PCB')).toBe(false);
    expect(canRename('LEGACY_PCB')).toBe(false);
  });

  it('a SEXPR_PCB (.kicad_pcb) cannot be deleted or renamed', () => {
    expect(canDelete('SEXPR_PCB')).toBe(false);
    expect(canRename('SEXPR_PCB')).toBe(false);
  });

  it('a DRAWING_SHEET (.kicad_wks) cannot be deleted or renamed', () => {
    expect(canDelete('DRAWING_SHEET')).toBe(false);
    expect(canRename('DRAWING_SHEET')).toBe(false);
  });

  it('a FOOTPRINT_FILE (.kicad_mod) cannot be deleted or renamed', () => {
    expect(canDelete('FOOTPRINT_FILE')).toBe(false);
    expect(canRename('FOOTPRINT_FILE')).toBe(false);
  });

  it('a SCHEMATIC_LIBFILE (.lib) cannot be deleted or renamed', () => {
    expect(canDelete('SCHEMATIC_LIBFILE')).toBe(false);
    expect(canRename('SCHEMATIC_LIBFILE')).toBe(false);
  });

  it('a SEXPR_SYMBOL_LIB_FILE (.kicad_sym) cannot be deleted or renamed', () => {
    expect(canDelete('SEXPR_SYMBOL_LIB_FILE')).toBe(false);
    expect(canRename('SEXPR_SYMBOL_LIB_FILE')).toBe(false);
  });

  it('a DESIGN_RULES (.kicad_dru) cannot be deleted or renamed', () => {
    expect(canDelete('DESIGN_RULES')).toBe(false);
    expect(canRename('DESIGN_RULES')).toBe(false);
  });

  it('and nothing else is protected - the list is a deny list of exactly twelve', () => {
    // `return true;` is the last line of CanDelete, so every type NOT in the
    // `if` is deletable. Naming them here means a type quietly added to the
    // deny list is caught too, not only one quietly removed.
    for (const t of [
      'GERBER',
      'GERBER_JOB_FILE',
      'HTML',
      'PDF',
      'TXT',
      'MD',
      'NET',
      'NET_SPICE',
      'UNKNOWN',
      'CMP_LINK',
      'REPORT',
      'FP_PLACE',
      'DRILL',
      'DRILL_NC',
      'DRILL_XNC',
      'SVG',
      'CSV',
      'ZIP_ARCHIVE',
      'JOBSET_FILE',
    ] as TreeFileType[]) {
      expect({ type: t, canDelete: canDelete(t) }).toStrictEqual({ type: t, canDelete: true });
    }
  });

  it('reaches the right answer from a file name, which is how the pane asks', () => {
    // The pane holds names, not types, so the two have to compose.
    expect(canDelete(treeFileType('demo.kicad_pcb'))).toBe(false);
    expect(canDelete(treeFileType('demo.kicad_sch'))).toBe(false);
    expect(canDelete(treeFileType('demo.kicad_dru'))).toBe(false);
    expect(canDelete(treeFileType('R_0805.kicad_mod'))).toBe(false);
    expect(canDelete(treeFileType('notes.txt'))).toBe(true);
    expect(canDelete(treeFileType('plot.gbr'))).toBe(true);
  });
});
