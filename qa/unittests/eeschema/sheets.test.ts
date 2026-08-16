// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Hierarchical sheets: SCH_SHEET parsing/round-trip, sheet-pin connectivity,
 * and the project hierarchy helpers (SCH_SHEET_LIST equivalent).
 */
import { describe, it, expect } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, writeSchematic } from '@ziroeda/eeschema';
import {
  buildSheetTree,
  findRootFile,
  sheetFile,
  sheetName,
} from '@ziroeda/eeschema/src/project.js';
import { moveItems } from '@ziroeda/eeschema/src/tools/move.js';
import { runErc } from '@ziroeda/eeschema/src/connectivity/erc.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const SHEET = `(sheet (at 100 50) (size 40 30)
  (stroke (width 0.1524) (type solid)) (fill (color 255 255 194 1.0))
  (uuid "sh-1")
  (property "Sheetname" "Power" (at 100 49.2 0) (effects (font (size 1.27 1.27)) (justify left bottom)))
  (property "Sheetfile" "power.kicad_sch" (at 100 80.6 0) (effects (font (size 1.27 1.27)) (justify left top)))
  (pin "VIN" input (at 100 60 180) (effects (font (size 1.27 1.27)) (justify left)) (uuid "sp-1"))
  (pin "VOUT" output (at 140 60 0) (effects (font (size 1.27 1.27)) (justify right)) (uuid "sp-2")))`;

const doc = (body: string) =>
  readSchematic(parse(`(kicad_sch (version 20230121) (generator eeschema) (lib_symbols) ${body})`));

describe('SCH_SHEET model', () => {
  it('parses the rectangle, fields, fill, and pins', () => {
    const d = doc(SHEET);
    expect(d.sheets.length).toBe(1);
    const sh = d.sheets[0]!;
    expect(sh.at).toEqual({ x: mmToIU(100), y: mmToIU(50) });
    expect(sh.size).toEqual({ w: mmToIU(40), h: mmToIU(30) });
    expect(sheetName(sh)).toBe('Power');
    expect(sheetFile(sh)).toBe('power.kicad_sch');
    expect(sh.fillColor).toEqual([255, 255, 194, 1]);
    expect(sh.pins.length).toBe(2);
    expect(sh.pins[0]!.name).toBe('VIN');
    expect(sh.pins[0]!.shape).toBe('input');
    expect(sh.pins[0]!.angle).toBe(180); // left side
    expect(sh.pins[1]!.at).toEqual({ x: mmToIU(140), y: mmToIU(60) });
  });

  it('round-trips unchanged and moves as one rigid part', () => {
    const d = doc(SHEET);
    expect(serialize(writeSchematic(d))).toBe(
      serialize(writeSchematic(readSchematic(writeSchematic(d)))),
    );

    const delta = { x: mmToIU(10), y: mmToIU(-5) };
    const moved = moveItems(new Set(['sh-1']), delta).apply(d);
    const sh = moved.sheets[0]!;
    expect(sh.at).toEqual({ x: mmToIU(110), y: mmToIU(45) });
    expect(sh.pins[0]!.at).toEqual({ x: mmToIU(110), y: mmToIU(55) });
    expect(sh.fields[0]!.at).toEqual({ x: mmToIU(110), y: mmToIU(44.2) });
    // And the file reflects it.
    const re = readSchematic(writeSchematic(moved));
    expect(re.sheets[0]!.at).toEqual({ x: mmToIU(110), y: mmToIU(45) });
    expect(re.sheets[0]!.pins[0]!.at).toEqual({ x: mmToIU(110), y: mmToIU(55) });
  });

  it('sheet pins join the netlist, so a wire into one is neither dangling nor an ERC fault', () => {
    // Wire from a sheet pin to nothing else: exempt from single-sheet ERC checks.
    const d = doc(`${SHEET} (wire (pts (xy 140 60) (xy 160 60)) (uuid "w1"))
      (label "VOUT" (at 160 60 0) (uuid "l1"))`);
    const violations = runErc(d, new Map());
    expect(violations.filter((v) => v.code === 'label_dangling')).toEqual([]);
    expect(violations.filter((v) => v.code === 'isolated_pin_label')).toEqual([]);
  });
});

describe('project hierarchy (SCH_SHEET_LIST equivalent)', () => {
  const root = doc(`(sheet (at 10 10) (size 20 20) (uuid "s1")
      (property "Sheetname" "Power" (at 0 0 0)) (property "Sheetfile" "power.kicad_sch" (at 0 0 0)))
    (sheet (at 50 10) (size 20 20) (uuid "s2")
      (property "Sheetname" "Amp" (at 0 0 0)) (property "Sheetfile" "amp.kicad_sch" (at 0 0 0)))`);
  const power = doc(`(sheet (at 10 10) (size 20 20) (uuid "s3")
      (property "Sheetname" "Reg" (at 0 0 0)) (property "Sheetfile" "reg.kicad_sch" (at 0 0 0)))`);
  const amp = doc('');
  const reg = doc('');
  const docs = new Map([
    ['main.kicad_sch', root],
    ['power.kicad_sch', power],
    ['amp.kicad_sch', amp],
    ['reg.kicad_sch', reg],
  ]);

  it('finds the root from the .kicad_pro name, or as the unreferenced sheet', () => {
    expect(findRootFile(docs, 'main.kicad_pro')).toBe('main.kicad_sch');
    expect(findRootFile(docs)).toBe('main.kicad_sch'); // nothing references it
  });

  it('builds the nested tree with display names from Sheetname', () => {
    const tree = buildSheetTree(docs, 'main.kicad_sch');
    expect(tree.file).toBe('main.kicad_sch');
    expect(tree.path).toBe('/'); // root instance path
    expect(tree.children.map((c) => c.name)).toEqual(['Power', 'Amp']);
    expect(tree.children.map((c) => c.path)).toEqual(['/s1/', '/s2/']);
    expect(tree.children[0]!.children.map((c) => c.name)).toEqual(['Reg']);
    expect(tree.children[0]!.children[0]!.file).toBe('reg.kicad_sch');
    expect(tree.children[0]!.children[0]!.path).toBe('/s1/s3/'); // chained UUIDs
  });

  it('gives each instance of a shared file a distinct path (complex hierarchy)', () => {
    // KiCad's complex_hierarchy demo: the root instantiates ampli_ht.kicad_sch
    // twice (vertical + horizontal), same file, two SCH_SHEET_PATHs.
    const rootTwice = doc(`(sheet (at 10 10) (size 20 20) (uuid "v")
        (property "Sheetname" "ampli_ht_vertical" (at 0 0 0)) (property "Sheetfile" "ampli_ht.kicad_sch" (at 0 0 0)))
      (sheet (at 50 10) (size 20 20) (uuid "h")
        (property "Sheetname" "ampli_ht_horizontal" (at 0 0 0)) (property "Sheetfile" "ampli_ht.kicad_sch" (at 0 0 0)))`);
    const tree = buildSheetTree(
      new Map([
        ['complex.kicad_sch', rootTwice],
        ['ampli_ht.kicad_sch', doc('')],
      ]),
      'complex.kicad_sch',
    );
    expect(tree.children.map((c) => c.file)).toEqual(['ampli_ht.kicad_sch', 'ampli_ht.kicad_sch']); // same file
    expect(tree.children.map((c) => c.path)).toEqual(['/v/', '/h/']); // distinct paths
    expect(new Set(tree.children.map((c) => c.path)).size).toBe(2);
  });

  it('orders siblings by stored page number, not by placement order in the file', () => {
    // Same bug as the real kit-dev-coldfire-xilinx_5213 demo: the sheet symbols
    // are placed in the file with "inout_user" before "xilinx", but xilinx is
    // page 2 and inout_user is page 3 - the tree must show xilinx first.
    const ROOT = 'root-uuid';
    const misordered = readSchematic(
      parse(`(kicad_sch (version 20230121) (generator eeschema) (uuid "${ROOT}") (lib_symbols)
        (sheet (at 10 10) (size 20 20) (uuid "u-inout")
          (property "Sheetname" "inout_user" (at 0 0 0))
          (property "Sheetfile" "inout_user.kicad_sch" (at 0 0 0))
          (instances (project "p" (path "/${ROOT}" (page "3")))))
        (sheet (at 50 10) (size 20 20) (uuid "u-xilinx")
          (property "Sheetname" "xilinx" (at 0 0 0))
          (property "Sheetfile" "xilinx.kicad_sch" (at 0 0 0))
          (instances (project "p" (path "/${ROOT}" (page "2")))))
        (sheet_instances (path "/" (page "1"))))`),
    );
    const docs = new Map([
      ['main.kicad_sch', misordered],
      ['inout_user.kicad_sch', doc('')],
      ['xilinx.kicad_sch', doc('')],
    ]);
    const tree = buildSheetTree(docs, 'main.kicad_sch');
    expect(tree.page).toBe('1');
    expect(tree.children.map((c) => c.name)).toEqual(['xilinx', 'inout_user']);
    expect(tree.children.map((c) => c.page)).toEqual(['2', '3']);
  });

  it('seeds page numbers from canvas position when none are stored at all', () => {
    // The actual kit-dev-coldfire-xilinx_5213 demo (a pre-page-number-tracking
    // KiCad file, no (instances ...) or (sheet_instances ...) anywhere): every
    // page comes back '' from the file, so SetInitialPageNumbers's fallback
    // has to seed 1/2/3 itself, in canvas x-position order - inout_user's
    // sheet symbol is placed in the file before xilinx's, but xilinx sits to
    // its left on the canvas, so xilinx must still show up first, as page 2.
    const ROOT = 'root-uuid';
    const noPageNumbers = readSchematic(
      parse(`(kicad_sch (version 20230121) (generator eeschema) (uuid "${ROOT}") (lib_symbols)
        (sheet (at 50 10) (size 20 20) (uuid "u-inout")
          (property "Sheetname" "inout_user" (at 0 0 0))
          (property "Sheetfile" "inout_user.kicad_sch" (at 0 0 0)))
        (sheet (at 10 10) (size 20 20) (uuid "u-xilinx")
          (property "Sheetname" "xilinx" (at 0 0 0))
          (property "Sheetfile" "xilinx.kicad_sch" (at 0 0 0))))`),
    );
    const docs = new Map([
      ['main.kicad_sch', noPageNumbers],
      ['inout_user.kicad_sch', doc('')],
      ['xilinx.kicad_sch', doc('')],
    ]);
    const tree = buildSheetTree(docs, 'main.kicad_sch');
    expect(tree.page).toBe('1');
    expect(tree.children.map((c) => c.name)).toEqual(['xilinx', 'inout_user']);
    expect(tree.children.map((c) => c.page)).toEqual(['2', '3']);
  });

  it('leaves pages blank and keeps file order when even one page number is stored', () => {
    // AllSheetPageNumbersEmpty is all-or-nothing: a single stored page number
    // anywhere skips the auto-numbering fallback entirely, same as upstream -
    // it must not half-seed the rest.
    const ROOT = 'root-uuid';
    const partial = readSchematic(
      parse(`(kicad_sch (version 20230121) (generator eeschema) (uuid "${ROOT}") (lib_symbols)
        (sheet (at 50 10) (size 20 20) (uuid "u-inout")
          (property "Sheetname" "inout_user" (at 0 0 0))
          (property "Sheetfile" "inout_user.kicad_sch" (at 0 0 0)))
        (sheet (at 10 10) (size 20 20) (uuid "u-xilinx")
          (property "Sheetname" "xilinx" (at 0 0 0))
          (property "Sheetfile" "xilinx.kicad_sch" (at 0 0 0))
          (instances (project "p" (path "/${ROOT}" (page "2"))))))`),
    );
    const docs = new Map([
      ['main.kicad_sch', partial],
      ['inout_user.kicad_sch', doc('')],
      ['xilinx.kicad_sch', doc('')],
    ]);
    const tree = buildSheetTree(docs, 'main.kicad_sch');
    expect(tree.page).toBe(''); // root's own page was never stored
    // xilinx's stored "2" still sorts first; inout_user's unset page falls
    // in behind it (ComparePageNum: numeric always before non-numeric/empty).
    expect(tree.children.map((c) => c.name)).toEqual(['xilinx', 'inout_user']);
    expect(tree.children.map((c) => c.page)).toEqual(['2', '']);
  });

  it('survives a recursive sheet reference', () => {
    const selfRef = doc(`(sheet (at 10 10) (size 20 20) (uuid "sx")
      (property "Sheetname" "Loop" (at 0 0 0)) (property "Sheetfile" "loop.kicad_sch" (at 0 0 0)))`);
    const tree = buildSheetTree(new Map([['loop.kicad_sch', selfRef]]), 'loop.kicad_sch');
    expect(tree.children.length).toBe(1);
    expect(tree.children[0]!.children.length).toBe(0); // cycle cut
  });
});
