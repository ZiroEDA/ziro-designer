// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { addItems, makeWire, makeBus, makeJunction } from '@ziroeda/eeschema/src/tools/index.js';
import { mergeColinearWires, withCleanup } from '@ziroeda/eeschema/src/tools/cleanup.js';
import { History } from '@ziroeda/eeschema/src/tools/command.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));

describe('mergeColinearWires (KiCad SchematicCleanUp / MergeOverlap)', () => {
  it('merges two colinear touching wires into one', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0)), makeWire(at(10, 0), at(20, 0))],
    }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    expect(merged.lines.length).toBe(1);
    const l = merged.lines[0]!;
    const xs = [l.start.x, l.end.x].sort((a, b) => a - b);
    expect(xs).toEqual([mmToIU(0), mmToIU(20)]);
  });

  it('merges overlapping colinear wires', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(15, 0)), makeWire(at(10, 0), at(25, 0))],
    }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    expect(merged.lines.length).toBe(1);
    const l = merged.lines[0]!;
    const xs = [l.start.x, l.end.x].sort((a, b) => a - b);
    expect(xs).toEqual([mmToIU(0), mmToIU(25)]);
  });

  it('removes a non-explicit junction on two collinear wires and merges them (KiCad CleanUp)', () => {
    // KiCad AnalyzePoint: two collinear wires have only 2 exit angles, so the point
    // is not an explicit junction -> CleanUp deletes the dot and merges the wires.
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0)), makeWire(at(10, 0), at(20, 0))],
      junctions: [makeJunction(at(10, 0))],
    }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    expect(merged.lines.length).toBe(1);
    expect(merged.junctions.length).toBe(0);
  });

  it('adds a junction where a wire tees in, keeping the through-wire whole', () => {
    // A vertical wire ending on the middle of a horizontal wire: KiCad keeps the
    // horizontal wire as one segment and just adds a junction dot at the tee.
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0)), makeWire(at(10, 0), at(10, 10))],
    }).apply(EMPTY());
    const out = mergeColinearWires(sch);
    expect(out.lines.length).toBe(2); // through-wire stays whole
    expect(out.junctions.some((j) => j.at.x === mmToIU(10) && j.at.y === 0)).toBe(true);
  });

  it('does NOT merge perpendicular wires meeting at a corner', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0)), makeWire(at(10, 0), at(10, 10))],
    }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    expect(merged.lines.length).toBe(2);
  });

  it('does NOT merge a wire and a bus that are colinear (different layers)', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0)), makeBus(at(10, 0), at(20, 0))],
    }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    expect(merged.lines.length).toBe(2);
  });

  it('removes an exact duplicate wire', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(10, 0)), makeWire(at(10, 0), at(0, 0))],
    }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    expect(merged.lines.length).toBe(1);
  });

  it('withCleanup merges as part of the edit and undo restores the pre-merge state', () => {
    const base = EMPTY();
    const history = new History();
    // Add a wire that is colinear-touching an existing one; cleanup should merge them.
    const withFirst = history.execute(
      base,
      withCleanup(addItems({ lines: [makeWire(at(0, 0), at(10, 0))] })),
    );
    expect(withFirst.lines.length).toBe(1);
    const merged = history.execute(
      withFirst,
      withCleanup(addItems({ lines: [makeWire(at(10, 0), at(20, 0))] })),
    );
    expect(merged.lines.length).toBe(1); // merged into a single wire
    // Undo the second edit: back to the single original wire (0..10), not the merged span.
    const undone = history.undo(merged)!;
    expect(undone.lines.length).toBe(1);
    const l = undone.lines[0]!;
    const xs = [l.start.x, l.end.x].sort((a, b) => a - b);
    expect(xs).toEqual([mmToIU(0), mmToIU(10)]);
    // Redo restores the merged wire.
    const redone = history.redo(undone)!;
    expect(redone.lines.length).toBe(1);
    const rxs = [redone.lines[0]!.start.x, redone.lines[0]!.end.x].sort((a, b) => a - b);
    expect(rxs).toEqual([mmToIU(0), mmToIU(20)]);
  });

  it('collapses a chain of three colinear segments', () => {
    const sch = addItems({
      lines: [
        makeWire(at(0, 0), at(10, 0)),
        makeWire(at(10, 0), at(20, 0)),
        makeWire(at(20, 0), at(30, 0)),
      ],
    }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    expect(merged.lines.length).toBe(1);
    const l = merged.lines[0]!;
    const xs = [l.start.x, l.end.x].sort((a, b) => a - b);
    expect(xs).toEqual([mmToIU(0), mmToIU(30)]);
  });
});

describe('a pass merges everything it can find, not just the first pair', () => {
  /**
   * Upstream marks a merged pair deleted, `break`s the *inner* loop only and
   * carries on scanning, re-collecting the line list at the top of each
   * `while( changed )` pass. Restarting the whole cleanup after one merge — as
   * this used to — is quadratic in the number of merges, because the junction
   * analysis re-runs over every wire endpoint on the sheet each time. Dropping a
   * dragged part on a 100-pin symbol merges about 150 segments, and the sheet
   * was analysed 150 times over: 3.4 seconds of frozen UI.
   *
   * The risk in batching them is that merging many pairs at once might not
   * settle where merging them one at a time would. These pin that it does.
   */
  const chain = (n: number): Schematic =>
    addItems({
      lines: Array.from({ length: n }, (_, i) => makeWire(at(i * 10, 0), at((i + 1) * 10, 0))),
    }).apply(EMPTY());

  it('collapses a long chain to a single wire', () => {
    // Needs cascading: each merge produces a segment that must merge again.
    const merged = mergeColinearWires(chain(12));
    expect(merged.lines.length).toBe(1);
    const l = merged.lines[0]!;
    const xs = [l.start.x, l.end.x].sort((a, b) => a - b);
    expect(xs).toEqual([mmToIU(0), mmToIU(120)]);
  });

  it('collapses several independent chains in the same sheet', () => {
    // Three parallel runs of four segments: a pass that stopped at the first
    // merge would still get here eventually, but this pins that batching does
    // not let one row swallow another.
    const rows = [0, 20, 40];
    const sch = addItems({
      lines: rows.flatMap((y) =>
        Array.from({ length: 4 }, (_, i) => makeWire(at(i * 10, y), at((i + 1) * 10, y))),
      ),
    }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    expect(merged.lines.length).toBe(3);
    for (const y of rows) {
      const row = merged.lines.find((l) => l.start.y === mmToIU(y));
      expect(row, `no wire left on row ${y}`).toBeDefined();
      const xs = [row!.start.x, row!.end.x].sort((a, b) => a - b);
      expect(xs).toEqual([mmToIU(0), mmToIU(40)]);
    }
  });

  it('leaves a chain broken where a tee puts a junction', () => {
    // The junction still has to survive the batch: a dot between two collinear
    // segments holds them apart, however many other merges happen that pass.
    const sch = addItems({
      lines: [
        ...Array.from({ length: 6 }, (_, i) => makeWire(at(i * 10, 0), at((i + 1) * 10, 0))),
        makeWire(at(30, 0), at(30, 20)),
      ],
    }).apply(EMPTY());
    const merged = mergeColinearWires(sch);
    const horizontal = merged.lines.filter((l) => l.start.y === l.end.y);
    expect(horizontal.length).toBe(2);
    expect(merged.junctions.some((j) => j.at.x === mmToIU(30) && j.at.y === 0)).toBe(true);
  });
});
