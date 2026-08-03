// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Can every kind of item be moved, deleted and undone?
 *
 * These three go through per-kind dispatch — `moveItems` handles symbols, wires,
 * junctions and labels itself and hands the rest to `moveRigidItems`, while
 * `deleteByIds` filters twelve arrays by hand. A kind missed by any of them
 * fails *silently*: the item is selectable and looks live, and the drag simply
 * does nothing.
 *
 * So this is the matrix, one row per kind, rather than trusting that each was
 * remembered as the model grew. It is a regression net as much as a test: the
 * next item kind added to the model should get a row here and will fail until
 * it is wired into all three.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { moveItems, deleteByIds } from '@ziroeda/eeschema';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic, Vec2 } from '@ziroeda/eeschema/src/types.js';

const rawR = readFileSync(
  fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)),
  'utf8',
);
const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})\n${body}\n)`));

const DELTA: Vec2 = { x: mmToIU(2.54), y: mmToIU(1.27) };

/**
 * One row of the matrix: a sheet holding exactly one item of this kind, the id
 * that selects it, how many of them the document has, and a point that must
 * move when the item does.
 */
interface Row {
  kind: string;
  doc: () => Schematic;
  id: (d: Schematic) => string;
  count: (d: Schematic) => number;
  anchor: (d: Schematic) => Vec2;
}

const ROWS: Row[] = [
  {
    kind: 'symbol',
    doc: () =>
      sheet(`(symbol (lib_id "R") (at 50.8 50.8 0) (unit 1) (uuid "x1")
        (property "Reference" "R1" (at 53.34 49.53 0))
        (property "Value" "R" (at 53.34 52.07 0)))`),
    id: (d) => refId('symbol', d.symbols[0]!.uuid, 0),
    count: (d) => d.symbols.length,
    anchor: (d) => d.symbols[0]!.at,
  },
  {
    kind: 'wire',
    doc: () =>
      sheet('(wire (pts (xy 0 0) (xy 10 0)) (stroke (width 0) (type default)) (uuid "x1"))'),
    id: (d) => refId('line', d.lines[0]!.uuid, 0),
    count: (d) => d.lines.length,
    anchor: (d) => d.lines[0]!.start,
  },
  {
    kind: 'junction',
    doc: () => sheet('(junction (at 10 10) (diameter 0) (color 0 0 0 0) (uuid "x1"))'),
    id: (d) => refId('junction', d.junctions[0]!.uuid, 0),
    count: (d) => d.junctions.length,
    anchor: (d) => d.junctions[0]!.at,
  },
  {
    kind: 'no-connect',
    doc: () => sheet('(no_connect (at 10 10) (uuid "x1"))'),
    id: (d) => refId('noconnect', d.noConnects[0]!.uuid, 0),
    count: (d) => d.noConnects.length,
    anchor: (d) => d.noConnects[0]!.at,
  },
  {
    kind: 'label',
    doc: () => sheet('(label "NET" (at 10 10 0) (uuid "x1"))'),
    id: (d) => refId('label', d.labels[0]!.uuid, 0),
    count: (d) => d.labels.length,
    anchor: (d) => d.labels[0]!.at,
  },
  {
    kind: 'global label',
    doc: () => sheet('(global_label "G" (shape input) (at 10 10 0) (uuid "x1"))'),
    id: (d) => refId('label', d.labels[0]!.uuid, 0),
    count: (d) => d.labels.length,
    anchor: (d) => d.labels[0]!.at,
  },
  {
    kind: 'free text',
    doc: () => sheet('(text "note" (at 10 10 0) (uuid "x1"))'),
    id: (d) => refId('label', d.labels[0]!.uuid, 0),
    count: (d) => d.labels.length,
    anchor: (d) => d.labels[0]!.at,
  },
  {
    kind: 'directive label',
    doc: () =>
      sheet(`(netclass_flag "" (length 2.54) (shape round) (at 10 10 0) (uuid "x1")
        (property "Netclass" "HV" (at 10 10 0)))`),
    id: (d) => refId('directive', d.directiveLabels![0]!.uuid, 0),
    count: (d) => (d.directiveLabels ?? []).length,
    anchor: (d) => d.directiveLabels![0]!.at,
  },
  {
    kind: 'sheet',
    doc: () =>
      sheet(`(sheet (at 10 10) (size 20 20) (uuid "x1")
        (property "Sheetname" "Sub" (at 10 9 0))
        (property "Sheetfile" "sub.kicad_sch" (at 10 31 0))
        (pin "A" input (at 10 15 180) (uuid "p1")))`),
    id: (d) => refId('sheet', d.sheets[0]!.uuid, 0),
    count: (d) => d.sheets.length,
    anchor: (d) => d.sheets[0]!.at,
  },
  {
    kind: 'bus entry',
    doc: () => sheet('(bus_entry (at 10 10) (size 2.54 2.54) (uuid "x1"))'),
    id: (d) => refId('busentry', d.busEntries[0]!.uuid, 0),
    count: (d) => d.busEntries.length,
    anchor: (d) => d.busEntries[0]!.at,
  },
  {
    kind: 'image',
    doc: () => sheet('(image (at 10 10) (uuid "x1") (data "iVBORw0KGgo="))'),
    id: (d) => refId('image', d.images[0]!.uuid, 0),
    count: (d) => d.images.length,
    anchor: (d) => d.images[0]!.at,
  },
  {
    kind: 'text box',
    doc: () => sheet('(text_box "hi" (at 10 10 0) (size 10 5) (uuid "x1"))'),
    id: (d) => refId('textbox', d.textBoxes[0]!.uuid, 0),
    count: (d) => d.textBoxes.length,
    anchor: (d) => d.textBoxes[0]!.start,
  },
  {
    kind: 'graphic (rectangle)',
    doc: () =>
      sheet('(rectangle (start 10 10) (end 20 20) (stroke (width 0) (type default)) (uuid "x1"))'),
    id: (d) => refId('graphic', undefined, 0),
    count: (d) => d.graphics.length,
    anchor: (d) => {
      const g = d.graphics[0]!;
      return g.kind === 'rectangle' ? g.start : { x: 0, y: 0 };
    },
  },
];

describe('every item kind moves', () => {
  for (const row of ROWS) {
    it(row.kind, () => {
      const before = row.doc();
      expect(row.count(before), `${row.kind} did not parse`).toBe(1);
      const anchor = row.anchor(before);
      const after = moveItems(new Set([row.id(before)]), DELTA).apply(before);
      // A kind missed by the move dispatch leaves the item exactly where it was.
      expect(row.anchor(after)).toEqual({ x: anchor.x + DELTA.x, y: anchor.y + DELTA.y });
    });
  }
});

describe('every item kind deletes', () => {
  for (const row of ROWS) {
    it(row.kind, () => {
      const before = row.doc();
      const after = deleteByIds(new Set([row.id(before)])).apply(before);
      expect(row.count(after)).toBe(0);
    });
  }
});

describe('every item kind comes back on undo', () => {
  for (const row of ROWS) {
    it(`${row.kind}, after a delete`, () => {
      const before = row.doc();
      const cmd = deleteByIds(new Set([row.id(before)]));
      expect(cmd.invert(before).apply(cmd.apply(before))).toEqual(before);
    });

    it(`${row.kind}, after a move`, () => {
      const before = row.doc();
      const cmd = moveItems(new Set([row.id(before)]), DELTA);
      expect(cmd.invert(before).apply(cmd.apply(before))).toEqual(before);
    });
  }
});

describe('the matrix covers the model', () => {
  it('has a row for every array a schematic carries', () => {
    // If the model grows an item array, it needs a row above — and wiring into
    // the move and delete dispatch — or it will be silently inert.
    const covered = new Set([
      'symbols',
      'lines',
      'junctions',
      'noConnects',
      'labels',
      'directiveLabels',
      'sheets',
      'busEntries',
      'images',
      'textBoxes',
      'graphics',
      // Tables are selectable but their cells are still unported (#178); they
      // are exercised by the table tests rather than here.
      'tables',
      // Groups are not items in their own right: they name members by uuid.
      'groups',
      // The library cache is not placed geometry.
      'libSymbols',
      // Nor is this: per-sheet-path page numbers, document metadata rather
      // than something you can select and drag.
      'sheetInstances',
    ]);
    const doc = sheet('(junction (at 10 10) (diameter 0) (color 0 0 0 0) (uuid "x1"))');
    const arrays = Object.entries(doc)
      .filter(([, v]) => Array.isArray(v))
      .map(([k]) => k);
    expect(arrays.filter((a) => !covered.has(a))).toEqual([]);
  });
});
