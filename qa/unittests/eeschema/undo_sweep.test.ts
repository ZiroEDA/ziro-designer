// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Undo puts the document back, for every command that can change it.
 *
 * The `EditCommand` contract is two halves — `apply` and `invert(before)` — and
 * they are written in different places by different people at different times.
 * When they drift, nothing throws: the edit works, undo appears to work, and
 * some part of the document quietly stays changed.
 *
 * That is not hypothetical. `deleteByIds` gained the rule that Delete on a
 * table cell *clears its text* rather than removing the cell; its invert only
 * knew how to put removed items back, so undo of a cleared cell left it empty.
 * Caught by a mutation pass, not by the feature's own tests, which is luck
 * again.
 *
 * So this asserts the property directly, for each command, on a document
 * holding one of every item kind:
 *
 *     serialize(invert(d).apply(apply(d))) === serialize(d)
 *
 * Compared as *serialized text*, not by object identity: a command is free to
 * rebuild items, and what matters is that the file is the file it was.
 *
 * Each case also asserts the command actually changed something. A command
 * that does nothing undoes perfectly, and would sit here looking like coverage.
 *
 * The last test is the one that keeps this honest: it reads the tools directory
 * for every exported `EditCommand` factory and fails when one is neither
 * covered here nor excused by name. A sweep whose registry silently stops
 * growing is worse than none.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import {
  deleteByIds,
  replaceGraphic,
  replaceImage,
  replaceJunction,
  replaceLabel,
  replaceLine,
  replaceSheet,
  replaceTable,
  replaceTextBox,
  replaceSymbol,
  replaceBusEntry,
  replaceDirectiveLabel,
} from '@ziroeda/eeschema/src/tools/mutate.js';
import { moveItems } from '@ziroeda/eeschema/src/tools/move.js';
import { transformItems } from '@ziroeda/eeschema/src/tools/transform.js';
import { swapItems } from '@ziroeda/eeschema/src/tools/swap_items.js';
import { tableCellsCommand, rowColCommand } from '@ziroeda/eeschema/src/tools/table_edit.js';
import { tableCellId } from '@ziroeda/eeschema/src/tools/table_cells.js';
import type { EditCommand } from '@ziroeda/eeschema/src/tools/command.js';
import type { LibGraphic, Schematic } from '@ziroeda/eeschema/src/types.js';

type GraphicRect = Extract<LibGraphic, { kind: 'rectangle' }>;

const FIXTURE = `(kicad_sch (version 20250114) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "L:R" (pin_numbers (hide yes)) (pin_names (offset 0))
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1" (rectangle (start -1 -2) (end 1 2)
        (stroke (width 0) (type default)) (fill (type none))))))
  (junction (at 10 10) (diameter 0.9) (color 1 2 3 1) (uuid "j-1"))
  (no_connect (at 20 10) (uuid "nc-1"))
  (bus_entry (at 30 10) (size 2.54 2.54)
    (stroke (width 0.1) (type solid) (color 0 0 0 0)) (uuid "be-1"))
  (wire (pts (xy 40 10) (xy 50 10))
    (stroke (width 0.2) (type dash) (color 1 0 0 1)) (uuid "w-1"))
  (label "NET" (at 60 10 0) (effects (font (size 1.27 1.27)) (justify left bottom))
    (uuid "l-1"))
  (netclass_flag "HS" (length 2.54) (shape round) (at 70 10 0)
    (effects (font (size 1.27 1.27))) (uuid "d-1")
    (property "Netclass" "HS" (at 70 10 0) (effects (font (size 1.27 1.27)))))
  (rectangle (start 10 20) (end 20 25)
    (stroke (width 0.1) (type solid)) (fill (type none)) (uuid "g-1"))
  (text_box "boxed" (exclude_from_sim no) (at 10 30 0) (size 20 10)
    (margins 0.5 0.5 0.5 0.5)
    (stroke (width 0.1) (type solid)) (fill (type none))
    (effects (font (size 1.27 1.27)) (justify left top)) (uuid "tb-1"))
  (table (column_count 2) (border (external yes) (header yes))
    (separators (rows yes) (cols yes))
    (column_widths 20 20) (row_heights 10 10) (uuid "t-1")
    (cells
      (table_cell "a" (exclude_from_sim no) (at 40 30 0) (size 20 10) (span 1 1)
        (margins 0.5 0.5 0.5 0.5) (effects (font (size 1.27 1.27)) (justify left top)))
      (table_cell "b" (exclude_from_sim no) (at 60 30 0) (size 20 10) (span 1 1)
        (margins 0.5 0.5 0.5 0.5) (effects (font (size 1.27 1.27)) (justify left top)))
      (table_cell "c" (exclude_from_sim no) (at 40 40 0) (size 20 10) (span 1 1)
        (margins 0.5 0.5 0.5 0.5) (effects (font (size 1.27 1.27)) (justify left top)))
      (table_cell "d" (exclude_from_sim no) (at 60 40 0) (size 20 10) (span 1 1)
        (margins 0.5 0.5 0.5 0.5) (effects (font (size 1.27 1.27)) (justify left top)))))
  (symbol (lib_id "L:R") (at 10 50 0) (unit 1)
    (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "s-1")
    (property "Reference" "R1" (at 12 48 0) (effects (font (size 1.27 1.27)))))
  (symbol (lib_id "L:R") (at 30 50 0) (unit 1)
    (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid "s-2")
    (property "Reference" "R2" (at 32 48 0) (effects (font (size 1.27 1.27)))))
  (sheet (at 60 50) (size 20 20) (stroke (width 0.1) (type solid))
    (fill (color 0 0 0 0.0)) (uuid "sh-1")
    (property "Sheetname" "sub" (at 60 49 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "sub.kicad_sch" (at 60 71 0)
      (effects (font (size 1.27 1.27))))))`;

const doc = (): Schematic => readSchematic(parse(FIXTURE));
const cell = (k: number): string => tableCellId('t-1', k);
const shift = (p: { x: number; y: number }) => ({ x: p.x + 12700, y: p.y });

/** Each entry makes a command that genuinely changes `d`. */
const CASES: [string, (d: Schematic) => EditCommand | null][] = [
  ['deleteByIds (an item)', () => deleteByIds(new Set(['j-1']))],
  ['deleteByIds (a table cell — clears its text)', () => deleteByIds(new Set([cell(0)]))],
  ['deleteByIds (mixed)', () => deleteByIds(new Set(['j-1', 'nc-1', cell(1)]))],
  ['moveItems', () => moveItems(new Set(['s-1', 'w-1', 'l-1']), { x: 12700, y: 0 })],
  [
    'moveItems (a cell, promoted to its table)',
    () => moveItems(new Set([cell(0)]), { x: 12700, y: 0 }),
  ],
  ['transformItems', () => transformItems(new Set(['s-1', 'l-1']), 'rotateCCW')],
  ['swapItems', (d) => swapItems(d, new Set(['s-1', 's-2']))],
  ['tableCellsCommand (merge)', (d) => tableCellsCommand(d, [cell(0), cell(1)], 'merge')],
  [
    'tableCellsCommand (unmerge)',
    (d) => {
      const merged = tableCellsCommand(d, [cell(0), cell(1)], 'merge')!.apply(d);
      return tableCellsCommand(merged, [cell(0)], 'unmerge');
    },
  ],
  ['rowColCommand (add row)', (d) => rowColCommand(d, [cell(0)], 'addRowAbove')],
  ['rowColCommand (delete row)', (d) => rowColCommand(d, [cell(0)], 'deleteRows')],
  [
    'replaceJunction',
    (d) => replaceJunction(0, { ...d.junctions[0]!, at: shift(d.junctions[0]!.at) }),
  ],
  ['replaceLine', (d) => replaceLine(0, { ...d.lines[0]!, start: shift(d.lines[0]!.start) })],
  ['replaceLabel', (d) => replaceLabel(0, { ...d.labels[0]!, text: 'OTHER' })],
  ['replaceTextBox', (d) => replaceTextBox(0, { ...d.textBoxes[0]!, text: 'changed' })],
  ['replaceTable', (d) => replaceTable(0, { ...d.tables[0]!, borderExternal: false })],
  ['replaceSymbol', (d) => replaceSymbol(0, { ...d.symbols[0]!, at: shift(d.symbols[0]!.at) })],
  ['replaceSheet', (d) => replaceSheet(0, { ...d.sheets[0]!, at: shift(d.sheets[0]!.at) })],
  [
    'replaceBusEntry',
    (d) => replaceBusEntry(0, { ...d.busEntries[0]!, at: shift(d.busEntries[0]!.at) }),
  ],
  [
    'replaceGraphic',
    (d) =>
      // A rectangle: widening it is a change every writer arm has to carry.
      replaceGraphic(0, { ...(d.graphics[0]! as GraphicRect), end: { x: 300000, y: 250000 } }),
  ],
  [
    'replaceDirectiveLabel',
    (d) =>
      replaceDirectiveLabel(0, { ...d.directiveLabels![0]!, at: shift(d.directiveLabels![0]!.at) }),
  ],
];

describe('undo restores the document', () => {
  for (const [name, make] of CASES) {
    it(name, () => {
      const before = doc();
      const cmd = make(before);
      expect(cmd, `${name} produced no command — the case tests nothing`).not.toBeNull();
      const after = cmd!.apply(before);
      const text = serializeSchematic(before);

      // A command that changes nothing undoes perfectly and proves nothing.
      expect(serializeSchematic(after), `${name} changed nothing`).not.toBe(text);
      expect(serializeSchematic(cmd!.invert(before).apply(after))).toBe(text);
    });
  }

  it('and redo puts it back again', () => {
    // invert(invert) is the redo path the History uses, and it is a separate
    // code path from apply.
    for (const [name, make] of CASES) {
      const before = doc();
      const cmd = make(before)!;
      const after = cmd.apply(before);
      const undone = cmd.invert(before).apply(after);
      const redone = cmd.invert(before).invert(after).apply(undone);
      expect(serializeSchematic(redone), `${name} did not redo`).toBe(serializeSchematic(after));
    }
  });
});

describe('the registry keeps up with the tools', () => {
  /**
   * Every `EditCommand` factory must be exercised *somewhere*. Swept here for
   * the general undo property, or named in a test of its own — several have
   * one that asserts undo already, and duplicating them here would be worse
   * than pointing at them.
   *
   * What this refuses to allow is a factory mentioned in no test at all: a
   * command nothing ever applies, whose invert nobody has ever run.
   */
  /**
   * Factories no test calls today. The list is debt, not an exemption: it
   * exists so a *newly* untested factory cannot hide among the old ones, and
   * the assertion below fails once an entry gains a test and should go.
   *
   * All five original entries were cleared in the commit that added
   * `untested_commands.test.ts` (#407). Empty is the goal state, and staying
   * empty is the guard's whole job.
   */
  const KNOWN_UNTESTED: Record<string, string> = {};

  it('every EditCommand factory is exercised by some test', () => {
    const toolsDir = fileURLToPath(new URL('../../../eeschema/src/tools/', import.meta.url));
    const names = new Set<string>();
    for (const file of readdirSync(toolsDir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(`${toolsDir}${file}`, 'utf8');
      // The parameter list is often multi-line, so the scan looks for the name
      // and then for the return type within a bounded window rather than
      // trying to match the parentheses.
      for (const m of src.matchAll(/export function (\w+)\(([\s\S]{0,400}?)\): EditCommand/g))
        names.add(m[1]!);
    }
    expect(names.size, 'found no factories — the scan stopped working').toBeGreaterThan(20);

    const testsDir = fileURLToPath(new URL('../', import.meta.url));
    let corpus = '';
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(`${dir}${e.name}/`);
        // This file names every factory it excuses, so counting itself would
        // make the KNOWN_UNTESTED list report itself as covered.
        else if (e.name.endsWith('.ts') && e.name !== 'undo_sweep.test.ts')
          corpus += readFileSync(`${dir}${e.name}`, 'utf8');
      }
    };
    walk(testsDir);

    // Swept here counts as covered: CASES names each factory it exercises.
    const swept = CASES.map(([n]) => n.split(' ')[0]!);
    const untested = [...names].filter(
      (n) => !swept.includes(n) && !KNOWN_UNTESTED[n] && !new RegExp(`\\b${n}\\b`).test(corpus),
    );
    expect(untested, `EditCommand factories no test ever calls: ${untested.join(', ')}`).toEqual(
      [],
    );

    // The known list is debt, not an exemption: it exists so a *new* untested
    // factory cannot hide among the old ones. Anything still on it should be
    // covered, and shrinking it is the point.
    const nowCovered = Object.keys(KNOWN_UNTESTED).filter(
      (n) => swept.includes(n) || new RegExp(`\\b${n}\\b`).test(corpus),
    );
    expect(nowCovered, `these now have tests — take them off KNOWN_UNTESTED`).toEqual([]);
  });
});
