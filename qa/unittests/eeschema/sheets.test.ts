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
  repairPageNumbersOnLoad,
  sheetFile,
  sheetName,
} from '@ziroeda/eeschema/src/project.js';
import { comparePageNum } from '@ziroeda/eeschema/src/tools/sch_sheet_path.js';
import { existsSync, readFileSync } from 'node:fs';
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

  it('breaks a page-number tie by placement order, the virtual page number, not file order', () => {
    // Two siblings stored on the same page. `HIERARCHY_TREE::OnCompareItems`
    // is `SCH_SHEET_PATH::ComparePageNum` (sch_sheet_path.cpp:226-245): equal
    // pages fall through to the virtual page number, which `BuildSheetList`
    // hands out in `SCH_SCREEN::GetSheets` order - by x, then y - so the one
    // further LEFT on the canvas comes first even though the file lists it
    // second. Sorting the file's own order was stable on the wrong key.
    const ROOT = 'root-uuid';
    const tied = readSchematic(
      parse(`(kicad_sch (version 20230121) (generator eeschema) (uuid "${ROOT}") (lib_symbols)
        (sheet (at 50 10) (size 20 20) (uuid "u-right")
          (property "Sheetname" "Right" (at 0 0 0))
          (property "Sheetfile" "right.kicad_sch" (at 0 0 0))
          (instances (project "p" (path "/${ROOT}" (page "7")))))
        (sheet (at 10 10) (size 20 20) (uuid "u-left")
          (property "Sheetname" "Left" (at 0 0 0))
          (property "Sheetfile" "left.kicad_sch" (at 0 0 0))
          (instances (project "p" (path "/${ROOT}" (page "7")))))
        (sheet_instances (path "/" (page "1"))))`),
    );
    const docs = new Map([
      ['main.kicad_sch', tied],
      ['right.kicad_sch', doc('')],
      ['left.kicad_sch', doc('')],
    ]);
    const tree = buildSheetTree(docs, 'main.kicad_sch');
    expect(tree.children.map((c) => c.name)).toEqual(['Left', 'Right']);
  });

  it('ComparePageNum: numeric before text, text by StrNumCmp (case-sensitive, natural)', () => {
    expect(comparePageNum('2', '10')).toBeLessThan(0);
    expect(comparePageNum('10', 'A')).toBeLessThan(0);
    expect(comparePageNum('', '1')).toBeGreaterThan(0);
    expect(comparePageNum('A2', 'A10')).toBeLessThan(0);
    // StrNumCmp is a plain codepoint compare outside digit runs: 'B' < 'a'.
    // The localeCompare this used to call folded case and put 'a' first.
    expect(comparePageNum('B', 'a')).toBeLessThan(0);
    expect(comparePageNum('a', 'A')).toBeGreaterThan(0);
  });

  describe('RepairPageNumbers on load (files-io.cpp:441-446)', () => {
    const ROOT = 'root-uuid';
    const withPages = (pages: Record<string, string | null>, at: Record<string, number>) =>
      readSchematic(
        parse(`(kicad_sch (version 20230121) (generator eeschema) (uuid "${ROOT}") (lib_symbols)
          ${Object.keys(pages)
            .map(
              (n) => `(sheet (at ${at[n]} 10) (size 20 20) (uuid "u-${n}")
            (property "Sheetname" "${n}" (at 0 0 0))
            (property "Sheetfile" "${n}.kicad_sch" (at 0 0 0))
            (instances (project "p" (path "/${ROOT}"${
              pages[n] === null ? '' : ` (page "${pages[n]}")`
            }))))`,
            )
            .join('\n')}
          (sheet_instances (path "/" (page "1"))))`),
      );
    const withDocs = (root: ReturnType<typeof withPages>, names: string[]) =>
      new Map([
        ['main.kicad_sch', root],
        ...names.map((n) => [`${n}.kicad_sch`, doc('')] as const),
      ]);

    it('reassigns a duplicated page to the lowest unused number, keeping the first claimant', () => {
      // KiCad's own cm5_minima demo: USB and PCIe-M2 both stored as page 7,
      // USB placed further left. USB keeps 7; PCIe-M2 takes 2, the first
      // number nobody holds. A running eeschema shows "PCIe-M2 (page 2)".
      const root = withPages(
        { USB: '7', HDMI: '5', CM5: '3', IO: '6', Ethernet: '4', PCIe: '7', DSI: '8' },
        { USB: 10, HDMI: 20, CM5: 30, IO: 40, Ethernet: 50, PCIe: 60, DSI: 70 },
      );
      const docs = withDocs(root, ['USB', 'HDMI', 'CM5', 'IO', 'Ethernet', 'PCIe', 'DSI']);
      const { docs: fixed, repaired } = repairPageNumbersOnLoad(docs, 'main.kicad_sch');
      expect(repaired).toBe(true);
      const tree = buildSheetTree(fixed, 'main.kicad_sch');
      expect(tree.children.map((c) => `${c.name} ${c.page}`)).toEqual([
        'PCIe 2',
        'CM5 3',
        'Ethernet 4',
        'HDMI 5',
        'IO 6',
        'USB 7',
        'DSI 8',
      ]);
      // The untouched documents are the same objects; only the root changed.
      expect(fixed.get('USB.kicad_sch')).toBe(docs.get('USB.kicad_sch'));
      expect(fixed.get('main.kicad_sch')).not.toBe(root);
    });

    it("reserves every stored number first, so a fix never takes a later sheet's page", () => {
      // The root is page 1. A and B both "2"; C holds "3". B must NOT get 3 -
      // it is C's - so it gets 4. `reservedPageIds` is filled before any
      // reassignment, and 1 is the root's.
      const root = withPages({ A: '2', B: '2', C: '3' }, { A: 10, B: 20, C: 30 });
      const { docs: fixed } = repairPageNumbersOnLoad(
        withDocs(root, ['A', 'B', 'C']),
        'main.kicad_sch',
      );
      const tree = buildSheetTree(fixed, 'main.kicad_sch');
      expect(tree.page).toBe('1');
      expect(tree.children.map((c) => `${c.name} ${c.page}`)).toEqual(['A 2', 'C 3', 'B 4']);
    });

    it('fills a blank page the same way, and leaves a clean hierarchy untouched', () => {
      const blank = withPages({ A: '2', B: null, C: '4' }, { A: 10, B: 20, C: 30 });
      // B has an instance record with no (page ...); it takes 3, the first
      // number neither the root (1), A nor C holds.
      const r1 = repairPageNumbersOnLoad(withDocs(blank, ['A', 'B', 'C']), 'main.kicad_sch');
      expect(r1.repaired).toBe(true);
      expect(buildSheetTree(r1.docs, 'main.kicad_sch').children.map((c) => c.page)).toEqual([
        '2',
        '3',
        '4',
      ]);

      const clean = withPages({ A: '2', B: '3' }, { A: 10, B: 20 });
      const docs = withDocs(clean, ['A', 'B']);
      const r2 = repairPageNumbersOnLoad(docs, 'main.kicad_sch');
      expect(r2.repaired).toBe(false);
      expect(r2.docs.get('main.kicad_sch')).toBe(clean);
    });

    it('seeds 1..N in placement order when nothing is numbered, without raising the box', () => {
      const none = withPages({ B: null, A: null }, { B: 50, A: 10 });
      // The root's own (sheet_instances) says page 1 - strip it so ALL are empty.
      const bare = { ...none, sheetInstances: [] };
      const { docs: fixed, repaired } = repairPageNumbersOnLoad(
        withDocs(bare, ['A', 'B']),
        'main.kicad_sch',
      );
      // SetInitialPageNumbers is not `repairedPageNumbers`: no information box.
      expect(repaired).toBe(false);
      const tree = buildSheetTree(fixed, 'main.kicad_sch');
      expect(tree.children.map((c) => `${c.name} ${c.page}`)).toEqual(['A 2', 'B 3']);
    });

    // KiCad's own demo, read from the installed reference — absent on CI, so
    // the test is skipped there rather than failing on a path it cannot see.
    const CM5_DIR = '/home/akshay/kicad-reference/demos/cm5_minima';
    it.skipIf(!existsSync(CM5_DIR))(
      'the demo itself: cm5_minima loads with PCIe-M2 on page 2',
      () => {
        const dir = CM5_DIR;
        const load = (f: string) => readSchematic(parse(readFileSync(`${dir}/${f}`, 'utf8')));
        const files = [
          'CM5_MINIMA_3',
          'CM5',
          'DSI_CSI',
          'Ethernet',
          'HDMI',
          'IO',
          'PCIe-M2',
          'USB',
        ];
        const docs = new Map(files.map((f) => [`${f}.kicad_sch`, load(`${f}.kicad_sch`)]));
        const before = buildSheetTree(docs, 'CM5_MINIMA_3.kicad_sch');
        expect(before.children.filter((c) => c.page === '7').map((c) => c.name)).toEqual([
          'USB',
          'PCIe-M2',
        ]);
        const { docs: fixed, repaired } = repairPageNumbersOnLoad(docs, 'CM5_MINIMA_3.kicad_sch');
        expect(repaired).toBe(true);
        const tree = buildSheetTree(fixed, 'CM5_MINIMA_3.kicad_sch');
        expect(tree.children.map((c) => `${c.name} (page ${c.page})`)).toEqual([
          'PCIe-M2 (page 2)',
          'CM5 (page 3)',
          'Ethernet (page 4)',
          'HDMI (page 5)',
          'IO (page 6)',
          'USB (page 7)',
          'DSI_CSI (page 8)',
        ]);
      },
    );
  });

  it('survives a recursive sheet reference', () => {
    const selfRef = doc(`(sheet (at 10 10) (size 20 20) (uuid "sx")
      (property "Sheetname" "Loop" (at 0 0 0)) (property "Sheetfile" "loop.kicad_sch" (at 0 0 0)))`);
    const tree = buildSheetTree(new Map([['loop.kicad_sch', selfRef]]), 'loop.kicad_sch');
    expect(tree.children.length).toBe(1);
    expect(tree.children[0]!.children.length).toBe(0); // cycle cut
  });
});
