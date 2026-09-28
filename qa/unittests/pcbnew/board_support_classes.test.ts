// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The header-level classes a BOARD carries — `PAGE_INFO`, `BOARD_STACKUP`,
 * `PCB_PLOT_PARAMS` (with its parser) and `EMBEDDED_FILES` — against
 * KiCad's own output. `qa/fixtures/board_support_oracle.json` holds what
 * KiCad 10.0.5's python `pcbnew` wrote for each case (the script is in
 * the commit message): a board-file round trip for the classes python
 * does not wrap, the python API for `PCB_PLOT_PARAMS`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { DSNLEXER } from '@ziroeda/common/dsnlexer.js';
import {
  EMBEDDED_FILES,
  EMBEDDED_FILE,
  FILE_TYPE,
  ParseEmbedded,
} from '@ziroeda/common/embedded_files.js';
import { Prettify } from '@ziroeda/common/io/kicad/kicad_io_utils.js';
import { PAGE_INFO, PAGE_SIZE_TYPE } from '@ziroeda/common/page_info.js';
import { STRING_FORMATTER } from '@ziroeda/common/richio.js';
import { B_Cu, F_Cu, F_Fab, Edge_Cuts, In1_Cu, In2_Cu } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import {
  DXF_OUTLINE_MODE,
  DXF_UNITS,
  PLOT_FORMAT,
  PLOT_TEXT_MODE,
} from '@ziroeda/common/plotters/plotter.js';
import { BOARD_DESIGN_SETTINGS } from '@ziroeda/pcbnew/board_design_settings.js';
import { BOARD_STACKUP } from '@ziroeda/pcbnew/board_stackup_manager/board_stackup.js';
import { PCB_PLOT_PARAMS, PCB_PLOT_PARAMS_PARSER } from '@ziroeda/pcbnew/pcb_plot_params.js';

const oracle = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../fixtures/board_support_oracle.json', import.meta.url)),
    'utf8',
  ),
) as Record<string, unknown>;

/** A `(setup …)` child as the board file lays it out: prettified at its depth, then cut out. */
function setupSection(
  aPrint: (out: STRING_FORMATTER) => void,
  aStart: string,
  aEnd: string,
): string {
  const out = new STRING_FORMATTER();
  out.Print('(kicad_pcb (setup ');
  aPrint(out);
  out.Print(`${aEnd}))`);
  const text = Prettify(out.GetString());
  const i = text.indexOf(aStart);
  const j = text.indexOf(aEnd, i);
  return text.slice(i, j).trimEnd();
}

describe('PAGE_INFO', () => {
  it('formats the four paper forms as KiCad writes them', () => {
    const fmt = (p: PAGE_INFO): string => {
      const out = new STRING_FORMATTER();
      p.Format(out);
      return out.GetString();
    };

    const user = new PAGE_INFO(PAGE_SIZE_TYPE.User);
    user.SetWidthMils((100.25 * 1000) / 25.4);
    user.SetHeightMils((50.5 * 1000) / 25.4);
    expect(fmt(user)).toBe(oracle.paper_user);

    expect(fmt(new PAGE_INFO(PAGE_SIZE_TYPE.A3, true))).toBe(oracle.paper_a3p);
    expect(fmt(new PAGE_INFO(PAGE_SIZE_TYPE.A4))).toBe(oracle.paper_a4);

    // `(paper "User" 100 200 portrait)`: the parser sets the sizes, then SetPortrait( true ),
    // which swaps nothing because the sizes already made it portrait; a custom page never
    // writes the keyword.
    const userp = new PAGE_INFO(PAGE_SIZE_TYPE.User);
    userp.SetWidthMils((100 * 1000) / 25.4);
    userp.SetHeightMils((200 * 1000) / 25.4);
    userp.SetPortrait(true);
    expect(fmt(userp)).toBe(oracle.paper_userp);
    expect(userp.GetWidthMils()).toBeCloseTo(3937.007874, 6);
  });

  it('SetType by name is case-insensitive and reports an unknown name', () => {
    const p = new PAGE_INFO();
    expect(p.IsDefault()).toBe(true); // A3 landscape
    expect(p.SetType('a4', true)).toBe(true);
    expect(p.GetTypeAsString()).toBe('A4');
    expect(p.IsPortrait()).toBe(true);
    expect(p.GetWidthMils()).toBe(8268);
    expect(p.GetHeightMils()).toBe(11693);
    expect(p.SetType('USLETTER')).toBe(true); // magic_enum case_insensitive
    expect(p.GetTypeAsString()).toBe('USLetter');
    expect(p.SetType('Bogus')).toBe(false);
    expect(p.GetTypeAsString()).toBe('USLetter'); // untouched
    // int GetWidthIU truncates
    expect(p.SetType('A4', true)).toBe(true);
    expect(p.GetHeightIU(pcbIUScale.IU_PER_MILS)).toBe(Math.trunc(11693 * pcbIUScale.IU_PER_MILS));
  });

  it('SetWidthMils turns a standard page into a custom one', () => {
    const p = new PAGE_INFO(PAGE_SIZE_TYPE.A3);
    p.SetWidthMils(5);
    expect(p.IsCustom()).toBe(true);
    expect(p.GetWidthMils()).toBe(10); // clampWidth
    expect(p.IsPortrait()).toBe(true); // 11693 > 10
  });
});

describe('BOARD_STACKUP', () => {
  it('BuildDefaultStackupList for a 1.6 mm four-layer board writes what KiCad writes', () => {
    const bds = new BOARD_DESIGN_SETTINGS();
    bds.SetCopperLayerCount(4);
    bds.SetBoardThickness(pcbIUScale.mmToIU(1.6));
    // The file's (layers …) enables the 4 copper + the standard technical layers only.
    bds.SetEnabledLayers(new LSET(bds.GetEnabledLayers()).ClearUserDefinedLayers());
    const stackup = bds.GetStackupDescriptor();
    stackup.RemoveAll();
    stackup.BuildDefaultStackupList(bds, bds.GetCopperLayerCount());

    expect(stackup.GetCount()).toBe(13);
    expect(
      setupSection((out) => stackup.FormatBoardStackup(out), '(stackup', '(pad_to_mask_clearance'),
    ).toBe(oracle.stackup4_default_text);

    // BuildBoardThicknessFromStackup: 4 x 0.035 + 3 x 0.48 + 2 x 0.01 = 1.6
    expect(stackup.BuildBoardThicknessFromStackup()).toBe(pcbIUScale.mmToIU(1.6));

    // GetLayerDistance: every copper and dielectric from the first layer through the second,
    // in full — an OUTER end counts its whole copper; only an internal end counts half.
    expect(stackup.GetLayerDistance(F_Cu, B_Cu)).toBe(pcbIUScale.mmToIU(0.035 * 4 + 0.48 * 3));
    expect(stackup.GetLayerDistance(In2_Cu, In1_Cu)).toBe(
      Math.trunc(pcbIUScale.mmToIU(0.035) / 2) * 2 + pcbIUScale.mmToIU(0.48),
    );
    expect(stackup.GetLayerDistance(B_Cu, In1_Cu)).toBe(stackup.GetLayerDistance(In1_Cu, B_Cu));
  });

  it('copies deeply and compares member-wise', () => {
    const a = new BOARD_STACKUP();
    a.BuildDefaultStackupList(null, 2);
    const b = BOARD_STACKUP.copyOf(a);
    expect(b.equals(a)).toBe(true);
    b.GetList()[3]!.SetThickness(1);
    expect(a.GetList()[3]!.GetThickness()).not.toBe(1);
    expect(b.equals(a)).toBe(false);
    b.assign(a);
    expect(b.equals(a)).toBe(true);
    expect(b.GetList()[3]).not.toBe(a.GetList()[3]);
  });

  it('SynchronizeWithBoard reports a removed layer and keeps the surviving values', () => {
    const bds = new BOARD_DESIGN_SETTINGS();
    bds.SetCopperLayerCount(4);
    const stackup = bds.GetStackupDescriptor();
    stackup.BuildDefaultStackupList(bds);
    stackup.GetStackupLayer(3)!.SetThickness(123456); // F.Cu
    expect(stackup.SynchronizeWithBoard(bds)).toBe(false);
    expect(stackup.GetStackupLayer(3)!.GetThickness()).toBe(123456);

    bds.SetCopperLayerCount(2);
    expect(stackup.SynchronizeWithBoard(bds)).toBe(true);
    expect(stackup.GetStackupLayer(3)!.GetThickness()).toBe(123456);
    expect(stackup.GetCount()).toBe(9);
  });
});

describe('PCB_PLOT_PARAMS', () => {
  const fmt = (p: PCB_PLOT_PARAMS): string =>
    setupSection((out) => p.Format(out), '(pcbplotparams', '\n\t)\n');

  it('the defaults format as a new board writes them', () => {
    expect(fmt(new PCB_PLOT_PARAMS())).toBe(oracle.plotparams_default_text);
  });

  it('the setters clamp and the modified block matches', () => {
    const p = new PCB_PLOT_PARAMS();
    p.SetFormat(PLOT_FORMAT.PDF);
    p.SetGerberPrecision(5);
    p.SetSvgPrecision(9);
    p.SetOutputDirectory('out dir');
    p.SetMirror(true);
    p.SetDXFPlotMode(DXF_OUTLINE_MODE.SKETCH);
    p.SetTextMode(PLOT_TEXT_MODE.NATIVE);
    p.SetDXFPlotUnits(DXF_UNITS.MM);
    p.SetPlotOnAllLayersSequence(new LSET([Edge_Cuts, F_Fab]).SeqStackupForPlotting());
    expect(p.GetGerberPrecision()).toBe(oracle.plotparams_gerber_precision);
    expect(p.GetSvgPrecision()).toBe(oracle.plotparams_svg_precision);
    expect(fmt(p)).toBe(oracle.plotparams_modified_text);
    expect(p.IsSameAs(new PCB_PLOT_PARAMS())).toBe(false);
    expect(PCB_PLOT_PARAMS.copyOf(p).IsSameAs(p)).toBe(true);
  });

  it('parses a pre-20240819 block: legacy layer numbering, excludeedgelayer, viasonmask', () => {
    const text =
      '(pcbplotparams (layerselection 0x00010fc_ffffffff) (plot_on_all_layers_selection 0x0000000_00000000) (excludeedgelayer no) (viasonmask yes) (mode 2) (drillshape 1) (scaleselection 1) (outputdirectory ""))';
    const lexer = new DSNLEXER(text, 'test');
    lexer.NextTok(); // (
    lexer.NextTok(); // pcbplotparams
    const p = new PCB_PLOT_PARAMS();
    p.Parse(new PCB_PLOT_PARAMS_PARSER(lexer, 20240108));
    expect(p.GetLegacyPlotViaOnMaskLayer()).toBe(true);
    expect(fmt(p)).toBe(oracle.plotparams_legacy_text);
  });
});

describe('EMBEDDED_FILES', () => {
  it('round-trips a file through the codec and the parser', async () => {
    await EMBEDDED_FILES.InitCodec();

    const file = new EMBEDDED_FILE();
    file.name = 'note.txt';
    file.decompressedData = new TextEncoder().encode('hello embedded world\n'.repeat(50));
    expect(EMBEDDED_FILES.CompressAndEncode(file)).toBe(0);
    expect(file.data_hash).toMatch(/^[0-9A-F]{32}$/);

    const files = new EMBEDDED_FILES();
    files.AddFile(file);
    files.SetAreFontsEmbedded(true);

    const out = new STRING_FORMATTER();
    files.WriteEmbeddedFiles(out, true);
    const text = out.GetString();
    expect(text.startsWith('(embedded_files (file (name "note.txt")(type other)(data\n|')).toBe(
      true,
    );

    const lexer = new DSNLEXER(text, 'test');
    lexer.NextTok(); // (
    lexer.NextTok(); // embedded_files
    const back = new EMBEDDED_FILES();
    ParseEmbedded(lexer, back);
    const got = back.GetEmbeddedFile('note.txt');
    expect(got).not.toBeNull();
    expect(got!.type).toBe(FILE_TYPE.OTHER);
    expect(new TextDecoder().decode(got!.decompressedData)).toBe(
      file.decompressedData.length ? 'hello embedded world\n'.repeat(50) : '',
    );
    expect(got!.Validate()).toBe(true);

    // A corrupted checksum is a PARSE_ERROR at load, as in the C++.
    const bad = text.replace(/\(checksum "([0-9A-F]{31})[0-9A-F]"\)/, '(checksum "$10")');
    expect(bad).not.toBe(text);
    const lexer2 = new DSNLEXER(bad, 'test');
    lexer2.NextTok();
    lexer2.NextTok();
    expect(() => ParseEmbedded(lexer2, new EMBEDDED_FILES())).toThrow(/Checksum error/);
  });

  it('AddFile keeps the first of a duplicate name and the map iterates by name', () => {
    const files = new EMBEDDED_FILES();
    const b = new EMBEDDED_FILE();
    b.name = 'b';
    b.data_hash = 'first';
    const a = new EMBEDDED_FILE();
    a.name = 'a';
    const b2 = new EMBEDDED_FILE();
    b2.name = 'b';
    b2.data_hash = 'second';
    files.AddFile(b);
    files.AddFile(a);
    files.AddFile(b2);
    expect([...files.EmbeddedFileMap().keys()]).toEqual(['a', 'b']);
    expect(files.GetEmbeddedFile('b')!.data_hash).toBe('first');
    expect(files.HasFile('/some/dir/a')).toBe(true);
  });
});
