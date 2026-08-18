// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rotate and mirror across the geometric item kinds — the second half of the
 * transform sweep (the first, for text items, is transform_text.test.ts).
 *
 * Upstream gives each kind its own arm of SCH_EDIT_TOOL::Rotate but they share
 * one rule: move every point that defines the item, `head->Rotate( rotPoint,
 * !clockwise )`. What differs is which points those are, so the sweep is one
 * case per kind rather than one per feature.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { serializeSchematic } from '@ziroeda/eeschema';
import { transformItems } from '@ziroeda/eeschema/src/tools/transform.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic, Vec2 } from '@ziroeda/eeschema/src/types.js';

const GRID = mmToIU(1.27);
/** On-grid coordinates: an off-grid fixture measures the snap, not the feature. */
const g = (n: number): number => n * GRID;
const at = (x: number, y: number): Vec2 => ({ x: g(x), y: g(y) });

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

/** Rotate about an explicit centre so the assertions are exact. */
const rot = (d: Schematic, ids: Set<string>, centre: Vec2, cw = true): Schematic =>
  transformItems(ids, cw ? 'rotateCW' : 'rotateCCW', centre).apply(d);

describe('a wire', () => {
  const wire = () => sheet(`(wire (pts (xy ${10 * 1.27} 0) (xy ${20 * 1.27} 0)) (uuid "w-1"))`);
  const id = (d: Schematic) => new Set([refId('line', d.lines[0]!.uuid, 0)]);

  it('rotates both endpoints, not just one', () => {
    const d = wire();
    const after = rot(d, id(d), { x: 0, y: 0 });
    // Clockwise about the origin: (x,0) -> (0,x).
    expect(after.lines[0]!.start).toEqual(at(0, 10));
    expect(after.lines[0]!.end).toEqual(at(0, 20));
  });

  it('turns a horizontal run into a vertical one', () => {
    const d = wire();
    const after = rot(d, id(d), { x: 0, y: 0 });
    expect(after.lines[0]!.start.x).toBe(after.lines[0]!.end.x);
  });

  it('four turns return it exactly', () => {
    let d = wire();
    const ids = id(d);
    for (let i = 0; i < 4; i++) d = rot(d, ids, { x: 0, y: 0 });
    expect(d.lines[0]!.start).toEqual(at(10, 0));
    expect(d.lines[0]!.end).toEqual(at(20, 0));
  });
});

describe('a junction and a no-connect', () => {
  it('rotate their position about the centre', () => {
    const d = sheet(
      [
        `(junction (at ${10 * 1.27} 0) (diameter 0) (uuid "j-1"))`,
        `(no_connect (at ${20 * 1.27} 0) (uuid "n-1"))`,
      ].join('\n'),
    );
    const ids = new Set([refId('junction', 'j-1', 0), refId('noconnect', 'n-1', 0)]);
    const after = rot(d, ids, { x: 0, y: 0 });
    expect(after.junctions[0]!.at).toEqual(at(0, 10));
    expect(after.noConnects[0]!.at).toEqual(at(0, 20));
  });
});

describe('a bus entry', () => {
  const entry = () =>
    sheet(`(bus_entry (at ${10 * 1.27} 0) (size ${2 * 1.27} ${2 * 1.27})
       (stroke (width 0) (type default)) (uuid "be-1"))`);
  const id = () => new Set([refId('busentry', 'be-1', 0)]);

  it('turns the stub as well as moving the anchor', () => {
    // The size is the stub's *direction*: rotating the anchor while leaving the
    // size alone would leave the entry pointing its original way.
    const d = entry();
    const after = rot(d, id(), { x: 0, y: 0 });
    expect(after.busEntries[0]!.at).toEqual(at(0, 10));
    expect(after.busEntries[0]!.size).toEqual({ x: g(-2), y: g(2) });
  });

  it('keeps the stub length', () => {
    const d = entry();
    const before = d.busEntries[0]!.size;
    const after = rot(d, id(), { x: 0, y: 0 }).busEntries[0]!.size;
    expect(Math.hypot(after.x, after.y)).toBeCloseTo(Math.hypot(before.x, before.y), 6);
  });
});

describe('a graphic shape', () => {
  it('a rectangle keeps its corners ordered after the turn', () => {
    const d = sheet(
      `(rectangle (start ${2 * 1.27} ${2 * 1.27}) (end ${6 * 1.27} ${4 * 1.27})
         (stroke (width 0) (type default)) (fill (type none)) (uuid "r-1"))`,
    );
    const after = rot(d, new Set([refId('graphic', undefined, 0)]), { x: 0, y: 0 });
    const r = after.graphics[0]!;
    if (r.kind !== 'rectangle') throw new Error('expected a rectangle');
    expect(r.start.x).toBeLessThan(r.end.x);
    expect(r.start.y).toBeLessThan(r.end.y);
    // A 4x2 box becomes 2x4.
    expect(r.end.x - r.start.x).toBe(g(2));
    expect(r.end.y - r.start.y).toBe(g(4));
  });

  it('a circle moves its centre and keeps its radius', () => {
    const d = sheet(
      `(circle (center ${10 * 1.27} 0) (radius ${3 * 1.27})
         (stroke (width 0) (type default)) (fill (type none)) (uuid "c-1"))`,
    );
    const after = rot(d, new Set([refId('graphic', undefined, 0)]), { x: 0, y: 0 });
    const c = after.graphics[0]!;
    if (c.kind !== 'circle') throw new Error('expected a circle');
    expect(c.center).toEqual(at(0, 10));
    expect(c.radius).toBe(g(3));
  });

  it('an arc carries its mid point, so the bulge survives', () => {
    const d = sheet(
      `(arc (start ${2 * 1.27} 0) (mid ${4 * 1.27} ${2 * 1.27}) (end ${6 * 1.27} 0)
         (stroke (width 0) (type default)) (fill (type none)) (uuid "a-1"))`,
    );
    const after = rot(d, new Set([refId('graphic', undefined, 0)]), { x: 0, y: 0 });
    const a = after.graphics[0]!;
    if (a.kind !== 'arc') throw new Error('expected an arc');
    // The mid must not stay collinear with the ends, or the arc has flattened.
    const collinear =
      (a.end.x - a.start.x) * (a.mid.y - a.start.y) ===
      (a.end.y - a.start.y) * (a.mid.x - a.start.x);
    expect(collinear).toBe(false);
  });
});

describe('a text box', () => {
  it('rotates its corners and toggles its angle', () => {
    const d = sheet(
      `(text_box "hi" (at ${2 * 1.27} ${2 * 1.27} 0) (size ${4 * 1.27} ${2 * 1.27})
         (stroke (width 0) (type solid)) (fill (type none))
         (effects (font (size 1.27 1.27))) (uuid "tb-1"))`,
    );
    const after = rot(d, new Set([refId('textbox', 'tb-1', 0)]), { x: 0, y: 0 });
    const t = after.textBoxes[0]!;
    expect(t.angle).toBe(90);
    expect(t.start.x).toBeLessThan(t.end.x);
    expect(t.start.y).toBeLessThan(t.end.y);
  });
});

describe('the selection centre', () => {
  it('is the selection, not the page origin, when no symbol is selected', () => {
    // selectionCenter used to look at symbols alone and return {0,0} for any
    // selection without one, so a pair of wires orbited the page corner.
    const d = sheet(
      [
        `(wire (pts (xy ${10 * 1.27} ${10 * 1.27}) (xy ${12 * 1.27} ${10 * 1.27})) (uuid "w-1"))`,
        `(wire (pts (xy ${10 * 1.27} ${12 * 1.27}) (xy ${12 * 1.27} ${12 * 1.27})) (uuid "w-2"))`,
      ].join('\n'),
    );
    const ids = new Set([refId('line', 'w-1', 0), refId('line', 'w-2', 1)]);
    const after = transformItems(ids, 'rotateCW').apply(d);
    // Centre is (11,11) in grid units; everything stays within a grid square or
    // two of it rather than being flung across the page.
    for (const l of after.lines) {
      for (const p of [l.start, l.end]) {
        expect(Math.abs(p.x - g(11))).toBeLessThanOrEqual(g(1));
        expect(Math.abs(p.y - g(11))).toBeLessThanOrEqual(g(1));
      }
    }
  });
});

describe('undo', () => {
  it('retraces every kind exactly', () => {
    const d = sheet(
      [
        `(wire (pts (xy ${10 * 1.27} 0) (xy ${20 * 1.27} 0)) (uuid "w-1"))`,
        `(junction (at ${10 * 1.27} 0) (diameter 0) (uuid "j-1"))`,
        `(bus_entry (at ${4 * 1.27} 0) (size ${2 * 1.27} ${2 * 1.27})
           (stroke (width 0) (type default)) (uuid "be-1"))`,
      ].join('\n'),
    );
    const ids = new Set([
      refId('line', 'w-1', 0),
      refId('junction', 'j-1', 0),
      refId('busentry', 'be-1', 0),
    ]);
    const cmd = transformItems(ids, 'rotateCW');
    const back = cmd.invert(d).apply(cmd.apply(d));
    expect(back.lines[0]!.start).toEqual(d.lines[0]!.start);
    expect(back.lines[0]!.end).toEqual(d.lines[0]!.end);
    expect(back.junctions[0]!.at).toEqual(d.junctions[0]!.at);
    expect(back.busEntries[0]!.size).toEqual(d.busEntries[0]!.size);
  });
});

/**
 * `SCH_TEXTBOX::MirrorHorizontally` / `::MirrorVertically` (sch_textbox.cpp:109/124)
 * mirror the shape and then note that "text is NOT really mirrored; it just has
 * its justification flipped" — but only when the text reads *along* the mirror
 * axis: the H mirror flips a horizontal box, the V mirror a vertical one. We used
 * to move the corners and leave the effects untouched, so the text stayed hard
 * against the same edge and ended up on the wrong side of its own box.
 *
 * A wire rides along in the selection so the assertions read the axis off the
 * geometry rather than trusting either op's name.
 */
describe('mirroring a text box', () => {
  const box = (angle: number): Schematic =>
    sheet(
      [
        `(wire (pts (xy ${10 * 1.27} ${10 * 1.27}) (xy ${20 * 1.27} ${16 * 1.27})) (uuid "w-1"))`,
        `(text_box "hi" (at ${2 * 1.27} ${2 * 1.27} ${angle}) (size ${4 * 1.27} ${2 * 1.27})
           (stroke (width 0) (type solid)) (fill (type none))
           (effects (font (size 1.27 1.27)) (justify left top)) (uuid "tb-1"))`,
      ].join('\n'),
    );

  const mirror = (d: Schematic, op: 'mirrorX' | 'mirrorY'): Schematic =>
    transformItems(new Set([refId('line', 'w-1', 0), refId('textbox', 'tb-1', 0)]), op).apply(d);

  /** true when this op moved the wire in X — i.e. it is Mirror Horizontally. */
  const flipsX = (before: Schematic, after: Schematic): boolean =>
    before.lines[0]!.start.x !== after.lines[0]!.start.x;

  for (const op of ['mirrorX', 'mirrorY'] as const) {
    it(`${op}: a horizontal box flips its justify iff it is the X mirror`, () => {
      const d = box(0);
      const after = mirror(d, op);
      expect(after.textBoxes[0]!.effects?.justify).toEqual(
        flipsX(d, after) ? ['right', 'top'] : ['left', 'top'],
      );
    });

    it(`${op}: a vertical box flips its justify iff it is the Y mirror`, () => {
      const d = box(90);
      const after = mirror(d, op);
      expect(after.textBoxes[0]!.effects?.justify).toEqual(
        flipsX(d, after) ? ['left', 'top'] : ['right', 'top'],
      );
    });
  }

  it('leaves the vertical justify and the angle alone', () => {
    const d = box(0);
    const after = mirror(d, 'mirrorY').textBoxes[0]!;
    expect(after.effects?.justify).toContain('top');
    expect(after.angle).toBe(0);
  });

  it('is its own inverse', () => {
    const d = box(0);
    const ids = new Set([refId('line', 'w-1', 0), refId('textbox', 'tb-1', 0)]);
    const back = transformItems(ids, 'mirrorY').apply(transformItems(ids, 'mirrorY').apply(d));
    expect(back.textBoxes[0]!.effects?.justify).toEqual(['left', 'top']);
    expect(back.textBoxes[0]!.start).toEqual(d.textBoxes[0]!.start);
  });

  it('reaches the file', () => {
    const d = box(0);
    const after = mirror(d, 'mirrorY');
    expect(flipsX(d, after)).toBe(true);
    expect(serializeSchematic(after)).toContain('(justify right top)');
  });
});
