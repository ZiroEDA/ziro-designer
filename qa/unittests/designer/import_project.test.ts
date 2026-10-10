// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * File > Import Non-KiCad Project: what is imported from the files chosen
 * (designer/src/home/import_project.ts). The flow end to end - menu, chooser,
 * new project, the board editor importing an EAGLE board - was run in headless
 * Chrome (qa/probes/import_project_probe.mjs) on KiCad's
 * Adafruit-AHT20-PCB fixture.
 */
import { describe, expect, it } from 'vitest';
import {
  IMPORT_FORMATS,
  IMPORT_FORMAT_ORDER,
  acceptFor,
  altiumProjectDocuments,
  importProjectFiles,
  planImport,
  targetProjectName,
  type PickedImportFile,
} from '@ziroeda/designer/src/home/import_project.js';

const f = (name: string, text = ''): PickedImportFile => ({
  name,
  bytes: new TextEncoder().encode(text),
});
const none = new Set<string>();

describe('the formats, as kicad/import_project.cpp has them', () => {
  it('the menu rows, in kicad/menubar.cpp order', () => {
    expect(IMPORT_FORMAT_ORDER.map((k) => IMPORT_FORMATS[k].menuLabel)).toEqual([
      'Altium Project...',
      'CADSTAR Project...',
      'EAGLE Project...',
      'EasyEDA (JLCEDA) Std Backup...',
      'EasyEDA (JLCEDA) Pro Project...',
      'PADS Project...',
      'gEDA / Lepton EDA Project...',
    ]);
  });

  it('the wildcards (wildcards_and_files_ext.cpp:288-353)', () => {
    expect(IMPORT_FORMATS.altium.wildcard().label).toBe('Altium Project files (*.PrjPcb)');
    expect(IMPORT_FORMATS.cadstar.wildcard().label).toBe('CADSTAR Archive files (*.csa; *.cpa)');
    expect(IMPORT_FORMATS.eagle.wildcard().label).toBe('Eagle XML files (*.sch; *.brd)');
    expect(IMPORT_FORMATS.easyeda.wildcard().label).toBe(
      'EasyEDA (JLCEDA) Std backup archive (*.zip)',
    );
    expect(IMPORT_FORMATS.easyedapro.wildcard().label).toBe(
      'EasyEDA (JLCEDA) Pro files (*.epro; *.zip)',
    );
    expect(IMPORT_FORMATS.pads.wildcard().label).toBe('PADS ASCII files (*.asc; *.txt)');
    expect(IMPORT_FORMATS.geda.wildcard().label).toBe(
      'gEDA / Lepton EDA project files (*.prj; *.sch; *.pcb)',
    );
  });
});

describe('planImport', () => {
  it('EAGLE: the .sch is the input, the .brd beside it the board', () => {
    const plan = planImport('eagle', [f('A.brd'), f('A.sch'), f('other.brd')], none)!;
    expect(plan.input.name).toBe('A.sch');
    expect(plan.projectName).toBe('A');
    expect(plan.board?.name).toBe('A.brd');
    expect(plan.schematics.map((s) => s.name)).toEqual(['A.sch']);
  });

  it('EAGLE board alone: imported, no schematic', () => {
    const plan = planImport('eagle', [f('A.brd')], none)!;
    expect(plan.board?.name).toBe('A.brd');
    expect(plan.schematics).toEqual([]);
  });

  it('EasyEDA: INPUT is the input file for both halves', () => {
    const plan = planImport('easyeda', [f('proj.zip')], none)!;
    expect(plan.board?.name).toBe('proj.zip');
    expect(plan.schematics.map((s) => s.name)).toEqual(['proj.zip']);
  });

  it('gEDA: a .pcb input is a board on its own (ImportFiles); a .sch input finds its .pcb', () => {
    const board = planImport('geda', [f('b.pcb')], none)!;
    expect(board.input.name).toBe('b.pcb');
    expect(board.board?.name).toBe('b.pcb');
    expect(board.schematics).toEqual([]);
    // Both chosen: the wildcard's order (prj, sch, pcb) makes the sheet the
    // input, and ImportIndividualFile( PCB_T ) finds the board beside it.
    const both = planImport('geda', [f('b.pcb'), f('b.sch')], none)!;
    expect(both.input.name).toBe('b.sch');
    expect(both.board?.name).toBe('b.pcb');
    expect(both.schematics.map((s) => s.name)).toEqual(['b.sch']);
  });

  it('nothing the wildcard admits: no plan', () => {
    expect(planImport('cadstar', [f('a.brd')], none)).toBeNull();
  });

  it('Altium: the .PrjPcb names its documents (Windows paths), matched among the files chosen', () => {
    const prj =
      '[Design]\r\nVersion=1.0\r\n[Document1]\r\nDocumentPath=Board\\\\Main.PcbDoc\r\n[Document2]\r\nDocumentPath=Sheet1.SchDoc\r\n[Document3]\r\nDocumentPath=Sheet2.SCHDOC\r\n[Document4]\r\nDocumentPath=Lib.PcbLib\r\n[Generic_SmartPDF]\r\nDocumentPath=ignored.PcbDoc\r\n';
    const plan = planImport(
      'altium',
      [f('Proj.PrjPcb', prj), f('main.pcbdoc'), f('Sheet1.SchDoc')],
      none,
    )!;
    expect(plan.board?.name).toBe('main.pcbdoc');
    expect(plan.schematics.map((s) => s.name)).toEqual(['Sheet1.SchDoc']);
    // Named by the project, not chosen: said, rather than imported half.
    expect(plan.missing).toEqual(['Sheet2.SCHDOC']);
  });

  it('altiumProjectDocuments: the first board-like document is the board; groups other than DocumentN are not documents', () => {
    expect(
      altiumProjectDocuments(
        '[Document1]\nDocumentPath=a.CSPcbDoc\n[Document2]\nDocumentPath=b.PcbDoc\n[DocumentX]\nDocumentPath=c.SchDoc\n',
      ),
    ).toEqual({ pcb: 'a.CSPcbDoc', sch: [] });
  });
});

describe('the new project', () => {
  it('named for the input file; FindEmptyTargetDir suffixes _1, _2 when taken', () => {
    expect(targetProjectName('Board.brd', new Set())).toBe('Board');
    expect(targetProjectName('Board.brd', new Set(['Board', 'Board_1']))).toBe('Board_2');
  });

  it("the project file only - CreateNewProject's no-stub-files - plus the board the editor imports into", () => {
    const withBoard = importProjectFiles(planImport('eagle', [f('A.sch'), f('A.brd')], none)!);
    expect(withBoard.map((x) => x.name)).toEqual(['A/A.kicad_pro', 'A/A.kicad_pcb']);
    const pro = JSON.parse(withBoard[0]!.text);
    expect(pro.meta.filename).toBe('A.kicad_pro');
    // No root sheet: nothing was created for one.
    expect(pro.sheets).toEqual([]);
    const schOnly = importProjectFiles(
      planImport(
        'altium',
        [f('P.PrjPcb', '[Document1]\nDocumentPath=s.SchDoc\n'), f('s.SchDoc')],
        none,
      )!,
    );
    expect(schOnly.map((x) => x.name)).toEqual(['P/P.kicad_pro']);
  });

  it('the chooser offers the input and its siblings', () => {
    expect(acceptFor('eagle')).toBe('.sch,.brd');
    expect(acceptFor('altium')).toBe('.PrjPcb,.SchDoc,.PcbDoc,.CSPcbDoc,.CMPcbDoc,.SWPcbDoc');
    expect(acceptFor('easyeda')).toBe('.zip');
  });
});
