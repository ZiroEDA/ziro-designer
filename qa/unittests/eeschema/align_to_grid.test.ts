// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Align Items to Grid, counterparts SCH_MOVE_TOOL::AlignToGrid and
 * AlignSchematicItemsToGrid: which way each kind of item is pulled onto the
 * grid, and that it goes as a *drag* so wiring comes with it.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  alignToGridCommand,
  alignToGridPoint,
  mostCommonGridShift,
} from '@ziroeda/eeschema/src/tools/align_to_grid.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mmToIU, iuToMM } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic, Vec2 } from '@ziroeda/eeschema/src/types.js';

const rawR = readFileSync(
  fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)),
  'utf8',
);
const R = readSymbolLib(parse(rawR))[0]!;
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);
const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})\n${body}\n)`));

const at = (xmm: number, ymm: number): Vec2 => ({ x: mmToIU(xmm), y: mmToIU(ymm) });
const GRID = mmToIU(1.27); // KiCad's 50 mil schematic grid
const wire = (uuid: string, a: Vec2, b: Vec2): string =>
  `(wire (pts (xy ${iuToMM(a.x)} ${iuToMM(a.y)}) (xy ${iuToMM(b.x)} ${iuToMM(b.y)}))
     (stroke (width 0) (type default)) (uuid "${uuid}"))`;
const lineId = (d: Schematic, i: number): string => refId('line', d.lines[i]!.uuid, i);
const run = (d: Schematic, ids: Set<string>): Schematic =>
  alignToGridCommand(d, ids, LIB, GRID)?.apply(d) ?? d;
const onGrid = (v: number): boolean => v % GRID === 0;

describe('the grid point itself', () => {
  it('rounds to the nearest multiple, both ways', () => {
    expect(alignToGridPoint(at(1.0, 1.0), GRID)).toEqual(at(1.27, 1.27));
    expect(alignToGridPoint(at(0.5, 0.5), GRID)).toEqual({ x: 0, y: 0 });
    expect(alignToGridPoint(at(2.54, 2.54), GRID)).toEqual(at(2.54, 2.54));
  });
});

describe('the majority shift', () => {
  it('is the one that lands the most points on the grid', () => {
    // Two points want the same shift, one wants another: the pair wins.
    const pts = [at(1.0, 0), at(2.27, 0), at(0, 0.4)];
    const shift = mostCommonGridShift(pts, GRID);
    expect(shift).toEqual({ x: mmToIU(1.27) - mmToIU(1.0), y: 0 });
  });

  it('is zero when everything is already on the grid', () => {
    expect(mostCommonGridShift([at(1.27, 2.54), at(0, 3.81)], GRID)).toEqual({ x: 0, y: 0 });
  });

  it('is zero for nothing at all', () => {
    expect(mostCommonGridShift([], GRID)).toEqual({ x: 0, y: 0 });
  });
});

describe('aligning a wire', () => {
  it('snaps each end on its own, so a half-off segment straightens', () => {
    const doc = sheet(wire('w1', at(1.0, 1.27), at(5.08, 1.27)));
    const out = run(doc, new Set([lineId(doc, 0)]));
    const l = out.lines[0]!;
    expect(onGrid(l.start.x)).toBe(true);
    expect(onGrid(l.start.y)).toBe(true);
    // The end was already on the grid and must not have been dragged along.
    expect(l.end).toEqual(at(5.08, 1.27));
  });

  it('leaves a wire that is already on the grid untouched', () => {
    const doc = sheet(wire('w1', at(1.27, 1.27), at(5.08, 1.27)));
    expect(alignToGridCommand(doc, new Set([lineId(doc, 0)]), LIB, GRID)).toBeNull();
  });
});

describe('aligning a symbol', () => {
  /** R at an off-grid position; both its pins are off by the same amount. */
  const withSymbol = (xmm: number, ymm: number) =>
    sheet(`
      (symbol (lib_id "R") (at ${xmm} ${ymm} 0) (unit 1) (uuid "r1")
        (property "Reference" "R1" (at ${xmm + 2} ${ymm - 1} 0))
        (property "Value" "R" (at ${xmm + 2} ${ymm + 1} 0)))`);

  it('moves it by the shift its pins agree on', () => {
    const doc = withSymbol(50.0, 50.0);
    const out = run(doc, new Set([refId('symbol', 'r1', 0)]));
    const s = out.symbols[0]!;
    // Both pins sit on the symbol's own axis, so they want the same shift and
    // the body lands on the grid with them.
    expect(onGrid(s.at.x)).toBe(true);
    expect(onGrid(s.at.y)).toBe(true);
  });

  it('takes a connected wire with it, as a drag rather than a move', () => {
    // The wire's far end is fixed; the end on the pin must follow the symbol,
    // which is the whole reason AlignToGrid runs in DRAG mode.
    const doc = sheet(`
      (symbol (lib_id "R") (at 50.0 50.0 0) (unit 1) (uuid "r1")
        (property "Reference" "R1" (at 52 49 0))
        (property "Value" "R" (at 52 51 0)))
      ${wire('w1', at(50.0, 46.19), at(50.0, 40))}`);
    const before = doc.lines[0]!.start;
    const out = run(doc, new Set([refId('symbol', 'r1', 0)]));
    const l = out.lines[0]!;
    expect(l.start).not.toEqual(before);
    // The far end stayed put: only the connected end was dragged.
    expect(l.end).toEqual(at(50.0, 40));
  });

  it('leaves the fields’ offsets from the body intact', () => {
    const doc = withSymbol(50.0, 50.0);
    const s0 = doc.symbols[0]!;
    const before = s0.fields.map((f) => ({
      dx: f.at!.x - s0.at.x,
      dy: f.at!.y - s0.at.y,
    }));
    const s1 = run(doc, new Set([refId('symbol', 'r1', 0)])).symbols[0]!;
    const after = s1.fields.map((f) => ({ dx: f.at!.x - s1.at.x, dy: f.at!.y - s1.at.y }));
    expect(after).toEqual(before);
  });
});

describe('aligning the other kinds', () => {
  it('snaps a junction', () => {
    const doc = sheet('(junction (at 1.0 1.0) (diameter 0) (color 0 0 0 0) (uuid "j1"))');
    const out = run(doc, new Set([refId('junction', 'j1', 0)]));
    expect(out.junctions[0]!.at).toEqual(at(1.27, 1.27));
  });

  it('snaps a label', () => {
    const doc = sheet('(label "NET" (at 1.0 1.0 0) (uuid "l1"))');
    const out = run(doc, new Set([refId('label', 'l1', 0)]));
    expect(out.labels[0]!.at).toEqual(at(1.27, 1.27));
  });

  it('snaps free text, which has nothing to stay connected to', () => {
    const doc = sheet('(text "note" (at 1.0 1.0 0) (uuid "t1"))');
    const out = run(doc, new Set([refId('label', 't1', 0)]));
    expect(out.labels[0]!.at).toEqual(at(1.27, 1.27));
  });

  it('snaps a no-connect', () => {
    const doc = sheet('(no_connect (at 1.0 1.0) (uuid "n1"))');
    const out = run(doc, new Set([refId('noconnect', 'n1', 0)]));
    expect(out.noConnects[0]!.at).toEqual(at(1.27, 1.27));
  });
});

describe('the command as a whole', () => {
  it('is null when the selection is already aligned', () => {
    const doc = sheet(wire('w1', at(1.27, 1.27), at(5.08, 1.27)));
    expect(alignToGridCommand(doc, new Set([lineId(doc, 0)]), LIB, GRID)).toBeNull();
  });

  it('is null when nothing is selected', () => {
    const doc = sheet(wire('w1', at(1.0, 1.0), at(5.0, 1.0)));
    expect(alignToGridCommand(doc, new Set(), LIB, GRID)).toBeNull();
  });

  it('undoes back to exactly what was there', () => {
    const doc = sheet(`
      (junction (at 1.0 1.0) (diameter 0) (color 0 0 0 0) (uuid "j1"))
      ${wire('w1', at(1.0, 1.0), at(5.0, 1.0))}`);
    const ids = new Set([lineId(doc, 0), refId('junction', 'j1', 0)]);
    const cmd = alignToGridCommand(doc, ids, LIB, GRID)!;
    const after = cmd.apply(doc);
    expect(after).not.toEqual(doc);
    expect(cmd.invert(doc).apply(after)).toEqual(doc);
  });

  it('leaves an unselected item where it is', () => {
    const doc = sheet(`
      (junction (at 1.0 1.0) (diameter 0) (color 0 0 0 0) (uuid "j1"))
      (junction (at 3.0 3.0) (diameter 0) (color 0 0 0 0) (uuid "j2"))`);
    const out = run(doc, new Set([refId('junction', 'j1', 0)]));
    expect(out.junctions[1]!.at).toEqual(at(3.0, 3.0));
  });
});
