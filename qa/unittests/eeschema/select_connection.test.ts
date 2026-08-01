// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Select/Expand Connection (Ctrl+4), counterpart
 * SCH_SELECTION_TOOL::SelectConnection: the three-stage widening walk, what
 * each stage is allowed to cross, and the endpoint walk drawn items get
 * instead.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  addItems,
  makeWire,
  makeBus,
  makeBusEntry,
  makeJunction,
  makeLabel,
  placeSymbol,
  refId,
} from '@ziroeda/eeschema/src/tools/index.js';
import {
  expandConnectionGraphically,
  expandConnectionWithGraph,
  selectConnection,
} from '@ziroeda/eeschema/src/tools/select_connection.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Schematic, LibSymbol } from '@ziroeda/eeschema/src/types.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));
const libMap = (sch: Schematic) =>
  new Map<string, LibSymbol>(sch.libSymbols.map((l) => [l.libId, l]));

// A 2-pin part (R): pin tips at (0, ∓3.81) mm from the placement origin.
const R = readSymbolLib(
  parse(readFileSync(fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)), 'utf8')),
)[0]!;

const lineId = (sch: Schematic, i: number) => refId('line', sch.lines[i]!.uuid, i);
const symId = (sch: Schematic, i: number) => refId('symbol', sch.symbols[i]!.uuid, i);

/**
 * Three wires in a row with a junction between the first two, and an R hanging
 * off the far end:
 *
 *   (0,0)--w0--(10,0)--w1--(20,0)--w2--(30,0)   J at (10,0)   R pin at (30,0)
 */
function chain(): Schematic {
  let sch = EMPTY();
  sch = addItems({
    lines: [
      makeWire(at(0, 0), at(10, 0)),
      makeWire(at(10, 0), at(20, 0)),
      makeWire(at(20, 0), at(30, 0)),
    ],
    junctions: [makeJunction(at(10, 0))],
  }).apply(sch);
  // A fourth wire into the junction, so it really is one (3+ exits).
  sch = addItems({ lines: [makeWire(at(10, 0), at(10, 10))] }).apply(sch);
  // R placed so that its lower pin lands on (30, 0).
  sch = placeSymbol(R, at(30, 3.81)).apply(sch);
  return sch;
}

describe('expandConnectionWithGraph', () => {
  it('stops at a junction on the first pass', () => {
    const sch = chain();
    const got = expandConnectionWithGraph(sch, libMap(sch), [lineId(sch, 1)], 'junction');
    // w1 runs from the junction to (20,0); it may take w2 (nothing stops it
    // there) but must not cross the junction into w0.
    expect(got.has(lineId(sch, 2))).toBe(true);
    expect(got.has(lineId(sch, 0))).toBe(false);
    expect(got.has(lineId(sch, 3))).toBe(false);
  });

  it('does not pull a symbol in on the junction pass', () => {
    const sch = chain();
    const got = expandConnectionWithGraph(sch, libMap(sch), [lineId(sch, 1)], 'junction');
    // Ctrl+4 on a wire gives you the wire, not the parts at the end of it.
    expect(got.has(symId(sch, 0))).toBe(false);
  });

  it('crosses the junction but stops at the pin on the second pass', () => {
    const sch = chain();
    const got = expandConnectionWithGraph(sch, libMap(sch), [lineId(sch, 1)], 'pin');
    expect(got.has(lineId(sch, 0))).toBe(true);
    expect(got.has(lineId(sch, 3))).toBe(true);
    // The pin at (30,0) is a stop point, and its symbol comes along.
    expect(got.has(symId(sch, 0))).toBe(true);
  });

  it('takes everything reachable on the last pass', () => {
    const sch = chain();
    const got = expandConnectionWithGraph(sch, libMap(sch), [lineId(sch, 1)], 'never');
    for (let i = 0; i < 4; i++) expect(got.has(lineId(sch, i))).toBe(true);
    expect(got.has(symId(sch, 0))).toBe(true);
  });

  it('starts a selected symbol at its pins', () => {
    const sch = chain();
    const got = expandConnectionWithGraph(sch, libMap(sch), [symId(sch, 0)], 'junction');
    // The symbol was selected, so this pass may pull symbols in — and the wire
    // its pin sits on comes with it.
    expect(got.has(lineId(sch, 2))).toBe(true);
  });

  it('never crosses from a wire onto a bus', () => {
    let sch = EMPTY();
    sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0)), makeBus(at(10, 0), at(10, 20))],
    }).apply(sch);
    const got = expandConnectionWithGraph(sch, libMap(sch), [lineId(sch, 0)], 'never');
    expect(got.has(lineId(sch, 1))).toBe(false);
  });

  it('stops at a label, which is a named connection point', () => {
    let sch = EMPTY();
    sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0)), makeWire(at(10, 0), at(20, 0))],
      labels: [makeLabel('label', 'CLK', at(10, 0))],
    }).apply(sch);
    const got = expandConnectionWithGraph(sch, libMap(sch), [lineId(sch, 0)], 'junction');
    expect(got.has(lineId(sch, 1))).toBe(false);
    // …and takes everything once nothing stops it.
    const all = expandConnectionWithGraph(sch, libMap(sch), [lineId(sch, 0)], 'never');
    expect(all.has(lineId(sch, 1))).toBe(true);
  });

  it('stops at a bus entry, where the net name changes', () => {
    // A[7..0] on the bus, A7 on the wire: the entry spans a connectivity
    // change, so the walk must not run through it onto the bus.
    let sch = EMPTY();
    sch = addItems({
      lines: [makeBus(at(0, 0), at(0, 20)), makeWire(at(2.54, 12.54), at(20, 12.54))],
      busEntries: [makeBusEntry(at(0, 10))],
    }).apply(sch);
    const entryId = refId('busentry', sch.busEntries[0]!.uuid, 0);
    const got = expandConnectionWithGraph(sch, libMap(sch), [lineId(sch, 1)], 'never');
    expect(got.has(entryId)).toBe(true);
    expect(got.has(lineId(sch, 0))).toBe(false);
  });

  it('honours the selection filter', () => {
    const sch = chain();
    const got = expandConnectionWithGraph(sch, libMap(sch), [lineId(sch, 1)], 'never', {
      passesFilter: (id) => id !== symId(sch, 0),
    });
    expect(got.has(symId(sch, 0))).toBe(false);
    expect(got.has(lineId(sch, 0))).toBe(true);
  });

  it('returns nothing when the selection holds no connectable item', () => {
    const sch = chain();
    expect(expandConnectionWithGraph(sch, libMap(sch), ['no-such-id'], 'never').size).toBe(0);
  });
});

describe('selectConnection', () => {
  it('skips a stage that would add nothing', () => {
    // A lone wire with no junction and no pin on it: the junction pass adds
    // nothing, so the key must not appear to do nothing — it falls through to a
    // pass that does.
    let sch = EMPTY();
    sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0)), makeWire(at(10, 0), at(20, 0))],
    }).apply(sch);
    const got = selectConnection(sch, libMap(sch), [lineId(sch, 0)]);
    expect(got.has(lineId(sch, 1))).toBe(true);
  });

  it('keeps the original selection', () => {
    const sch = chain();
    const got = selectConnection(sch, libMap(sch), [lineId(sch, 1)]);
    expect(got.has(lineId(sch, 1))).toBe(true);
  });

  it('widens one stage at a time when pressed repeatedly', () => {
    const sch = chain();
    const first = selectConnection(sch, libMap(sch), [lineId(sch, 1)]);
    const second = selectConnection(sch, libMap(sch), first);
    // The first press stopped at the junction; the second crosses it.
    expect(first.has(lineId(sch, 0))).toBe(false);
    expect(second.has(lineId(sch, 0))).toBe(true);
    expect(second.size).toBeGreaterThan(first.size);
  });

  it('settles once everything reachable is in', () => {
    const sch = chain();
    let sel = selectConnection(sch, libMap(sch), [lineId(sch, 1)]);
    for (let i = 0; i < 5; i++) sel = selectConnection(sch, libMap(sch), sel);
    const again = selectConnection(sch, libMap(sch), sel);
    expect([...again].sort()).toEqual([...sel].sort());
  });

  it('drops items the walk has nothing to do with', () => {
    // RequestSelection( expandConnectionGraphTypes ): an image cannot expand
    // and is not carried along either.
    const sch = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols)
        (wire (pts (xy 0 0) (xy 10 0)) (uuid "w0"))
        (wire (pts (xy 10 0) (xy 20 0)) (uuid "w1"))
        (image (at 50 50) (uuid "i0") (data "iVBORw0KGgo=")))`),
    );
    const got = selectConnection(sch, new Map(), ['w0', 'i0']);
    expect(got.has('w1')).toBe(true);
    expect(got.has('i0')).toBe(false);
  });

  it('leaves an empty selection alone', () => {
    const sch = chain();
    expect(selectConnection(sch, libMap(sch), []).size).toBe(0);
  });
});

describe('expandConnectionGraphically', () => {
  it('grows a drawn outline through its shared endpoints', () => {
    const sch = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols)
        (polyline (pts (xy 0 0) (xy 10 0)) (uuid "p0"))
        (polyline (pts (xy 10 0) (xy 10 10)) (uuid "p1"))
        (polyline (pts (xy 50 50) (xy 60 50)) (uuid "p2")))`),
    );
    const got = expandConnectionGraphically(sch, ['p0']);
    expect(got.has('p1')).toBe(true);
    expect(got.has('p2')).toBe(false);
  });

  it('does not join a notes line to a wire that touches it', () => {
    const sch = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols)
        (polyline (pts (xy 0 0) (xy 10 0)) (uuid "p0"))
        (wire (pts (xy 10 0) (xy 20 0)) (uuid "w0")))`),
    );
    expect(expandConnectionGraphically(sch, ['p0']).has('w0')).toBe(false);
  });

  it('is what a selected notes line gets from Ctrl+4', () => {
    const sch = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols)
        (polyline (pts (xy 0 0) (xy 10 0)) (uuid "p0"))
        (polyline (pts (xy 10 0) (xy 10 10)) (uuid "p1")))`),
    );
    expect(selectConnection(sch, new Map(), ['p0']).has('p1')).toBe(true);
  });
});
