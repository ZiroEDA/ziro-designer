// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Does every edit undo — and redo — exactly?
 *
 * `EditCommand` is our functional spelling of KiCad's commit/undo model: a
 * command applies itself and produces its inverse *against the document as it
 * was before*. `History` then leans on that inverse twice over — once to undo,
 * and again (inverting the inverse) to rebuild the redo step.
 *
 * So each command owes two properties, and the second is the one that rots
 * quietly: a command whose inverse is right but whose *inverse's* inverse is
 * not will undo correctly and then redo something else. Nothing in a per-
 * feature test notices that, because it takes three applications to see.
 *
 *   undo: invert(before).apply(apply(before))            === before
 *   redo: invert(before).invert(after).apply(before)     === after
 *
 * This is the audit across the command surface rather than a test per feature.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import type { Schematic, LibSymbol } from '@ziroeda/eeschema/src/types.js';
import { History, type EditCommand } from '@ziroeda/eeschema/src/tools/command.js';
import { addItems, deleteByIds, placeSymbol } from '@ziroeda/eeschema/src/tools/mutate.js';
import { moveItems, moveWithConnections } from '@ziroeda/eeschema/src/tools/move.js';
import { orthoMove } from '@ziroeda/eeschema/src/tools/ortho.js';
import { planMove } from '@ziroeda/eeschema/src/tools/connect.js';
import { transformItems } from '@ziroeda/eeschema/src/tools/transform.js';
import { setSymbolUnit } from '@ziroeda/eeschema/src/tools/symbol_unit.js';
import { setBodyStyle } from '@ziroeda/eeschema/src/tools/body_style.js';
import { setAttribute } from '@ziroeda/eeschema/src/tools/set_attribute.js';
import { autoplaceFields } from '@ziroeda/eeschema/src/tools/autoplace_fields.js';
import { groupItemsCommand } from '@ziroeda/eeschema/src/tools/sch_group_tool.js';
import { makeWire, makeJunction, makeLabel } from '@ziroeda/eeschema/src/tools/build.js';
import { refId, sheetPinId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const rawR = readFileSync(
  fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)),
  'utf8',
);
const R = readSymbolLib(parse(rawR))[0]!;
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);
const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });

/** A sheet with a symbol, two wires meeting a pin, a junction and a label. */
const doc = (): Schematic =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})
      (symbol (lib_id "R") (at 50.8 50.8 0) (unit 1) (uuid "r1")
        (property "Reference" "R1" (at 53.34 49.53 0))
        (property "Value" "10k" (at 53.34 52.07 0)))
      (wire (pts (xy 50.8 46.99) (xy 50.8 40.64)) (stroke (width 0) (type default)) (uuid "w1"))
      (wire (pts (xy 50.8 40.64) (xy 60.96 40.64)) (stroke (width 0) (type default)) (uuid "w2"))
      (junction (at 50.8 40.64) (diameter 0) (color 0 0 0 0) (uuid "j1"))
      (label "NET" (at 60.96 40.64 0) (uuid "l1")))`),
  );

const symId = (d: Schematic) => refId('symbol', d.symbols[0]!.uuid, 0);
const wireId = (d: Schematic, i: number) => refId('line', d.lines[i]!.uuid, i);

/** Every command under audit, built against a fresh document. */
const CASES: { name: string; build: (d: Schematic) => EditCommand | null }[] = [
  { name: 'addItems', build: () => addItems({ lines: [makeWire(at(0, 0), at(10, 0))] }) },
  {
    name: 'addItems (junction + label)',
    build: () =>
      addItems({
        junctions: [makeJunction(at(20, 20))],
        labels: [makeLabel('label', 'N', at(20, 20))],
      }),
  },
  { name: 'deleteByIds (symbol)', build: (d) => deleteByIds(new Set([symId(d)])) },
  { name: 'deleteByIds (wire)', build: (d) => deleteByIds(new Set([wireId(d, 0)])) },
  {
    name: 'deleteByIds (several)',
    build: (d) => deleteByIds(new Set([wireId(d, 0), wireId(d, 1), refId('junction', 'j1', 0)])),
  },
  { name: 'placeSymbol', build: () => placeSymbol(R, at(80, 80)) },
  { name: 'moveItems', build: (d) => moveItems(new Set([symId(d)]), at(2.54, 0)) },
  {
    name: 'moveWithConnections',
    build: (d) => moveWithConnections(planMove(d, LIB, new Set([symId(d)])), at(2.54, 0)),
  },
  {
    name: 'orthoMove',
    build: (d) => orthoMove(d, planMove(d, LIB, new Set([symId(d)])), at(2.54, 2.54), LIB),
  },
  {
    name: 'transformItems (rotateCW)',
    build: (d) => transformItems(new Set([symId(d)]), 'rotateCW'),
  },
  {
    name: 'transformItems (mirrorX)',
    build: (d) => transformItems(new Set([symId(d)]), 'mirrorX'),
  },
  { name: 'setSymbolUnit', build: () => setSymbolUnit(0, 2) },
  { name: 'setBodyStyle', build: () => setBodyStyle(0, 2) },
  // setAttribute *toggles*: it works out the new state itself, so there is no
  // fourth argument to pass.
  { name: 'setAttribute (dnp)', build: (d) => setAttribute(d, new Set([symId(d)]), 'dnp') },
  { name: 'setAttribute (bom)', build: (d) => setAttribute(d, new Set([symId(d)]), 'bom') },
  { name: 'setAttribute (board)', build: (d) => setAttribute(d, new Set([symId(d)]), 'board') },
  { name: 'setAttribute (sim)', build: (d) => setAttribute(d, new Set([symId(d)]), 'sim') },
  {
    name: 'autoplaceFields',
    build: (d) =>
      autoplaceFields(d, new Set([symId(d)]), LIB, { allowRejustify: true, alignToGrid: true }),
  },
  { name: 'groupItems', build: (d) => groupItemsCommand(new Set([symId(d), wireId(d, 0)])) },
];

describe('undo restores the document exactly', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const before = doc();
      const cmd = c.build(before);
      expect(cmd, `${c.name} produced no command`).not.toBeNull();
      const after = cmd!.apply(before);
      expect(cmd!.invert(before).apply(after)).toEqual(before);
    });
  }
});

describe('redo re-applies the document exactly', () => {
  for (const c of CASES) {
    it(c.name, () => {
      // The redo step is the *inverse of the inverse*, which is a third
      // application and the one a per-feature test never reaches.
      const before = doc();
      const cmd = c.build(before);
      const after = cmd!.apply(before);
      const undoCmd = cmd!.invert(before);
      const redoCmd = undoCmd.invert(after);
      expect(redoCmd.apply(before)).toEqual(after);
    });
  }
});

describe('through the History stack', () => {
  for (const c of CASES) {
    it(`${c.name} survives undo then redo`, () => {
      const before = doc();
      const h = new History();
      const cmd = c.build(before);
      const after = h.execute(before, cmd!);
      const undone = h.undo(after);
      expect(undone).toEqual(before);
      const redone = h.redo(undone!);
      expect(redone).toEqual(after);
    });
  }

  it('a command that changes nothing still round-trips', () => {
    const before = doc();
    const h = new History();
    const after = h.execute(before, moveItems(new Set([symId(before)]), { x: 0, y: 0 }));
    expect(h.undo(after)).toEqual(before);
  });

  it('two commands undo in reverse order', () => {
    const before = doc();
    const h = new History();
    const one = h.execute(before, moveItems(new Set([symId(before)]), at(2.54, 0)));
    const two = h.execute(one, transformItems(new Set([symId(one)]), 'rotateCW'));
    expect(h.undo(two)).toEqual(one);
    expect(h.undo(one)).toEqual(before);
  });
});

describe('what the audit turned up', () => {
  const threeWires = (): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols)
        (wire (pts (xy 0 0) (xy 10 0)) (stroke (width 0) (type default)) (uuid "w1"))
        (wire (pts (xy 10 0) (xy 20 0)) (stroke (width 0) (type default)) (uuid "w2"))
        (wire (pts (xy 20 0) (xy 30 0)) (stroke (width 0) (type default)) (uuid "w3")))`),
    );

  it('puts a deleted item back at its own index, not on the end', () => {
    // The array order is the order the writer emits items in, so appending
    // turns delete-then-undo into a reordered file. And `refId` falls back to
    // the index for an item with no uuid, so appending changes identity too.
    const before = threeWires();
    const cmd = deleteByIds(new Set([refId('line', 'w1', 0)]));
    const undone = cmd.invert(before).apply(cmd.apply(before));
    expect(undone.lines.map((l) => l.uuid)).toEqual(['w1', 'w2', 'w3']);
  });

  it('puts a deleted middle item back in the middle', () => {
    const before = threeWires();
    const cmd = deleteByIds(new Set([refId('line', 'w2', 1)]));
    const undone = cmd.invert(before).apply(cmd.apply(before));
    expect(undone.lines.map((l) => l.uuid)).toEqual(['w1', 'w2', 'w3']);
  });

  const withPins = (): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols)
        (sheet (at 10 10) (size 20 20) (uuid "s1")
          (property "Sheetname" "Sub" (at 10 9 0))
          (property "Sheetfile" "sub.kicad_sch" (at 10 31 0))
          (pin "A" input (at 10 15 180) (uuid "p1"))
          (pin "B" input (at 10 20 180) (uuid "p2"))))`),
    );

  it('restores a deleted sheet pin at all', () => {
    // A sheet pin is an item of its own, so Delete on one removes just it —
    // but the inverse only ever collected whole sheets, so the pin was gone
    // for good. Nothing short of reloading the file brought it back.
    const before = withPins();
    const shId = refId('sheet', 's1', 0);
    const cmd = deleteByIds(new Set([sheetPinId(shId, 0)]));
    const after = cmd.apply(before);
    expect(after.sheets[0]!.pins.map((p) => p.name)).toEqual(['B']);
    const undone = cmd.invert(before).apply(after);
    expect(undone.sheets[0]!.pins.map((p) => p.name)).toEqual(['A', 'B']);
    expect(undone).toEqual(before);
  });

  it('restores a pin deleted from the middle of the list', () => {
    const before = withPins();
    const shId = refId('sheet', 's1', 0);
    const cmd = deleteByIds(new Set([sheetPinId(shId, 1)]));
    const undone = cmd.invert(before).apply(cmd.apply(before));
    expect(undone.sheets[0]!.pins.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('does not double-restore a pin whose sheet was deleted too', () => {
    // The pin comes back inside the sheet; collecting it separately as well
    // would insert it twice.
    const before = withPins();
    const shId = refId('sheet', 's1', 0);
    const cmd = deleteByIds(new Set([shId, sheetPinId(shId, 0)]));
    const after = cmd.apply(before);
    expect(after.sheets).toHaveLength(0);
    expect(cmd.invert(before).apply(after)).toEqual(before);
  });
});
