// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Dragging a many-pinned part: the 90-degree elbows have to fan out neatly, and
 * above all they have to stay on their own wires.
 *
 * `SCH_MOVE_TOOL::orthoLineDrag` sets each elbow back one grid step further
 * from the moved end than the last, "so a group of wires all needing their
 * offset one grid movement further out from each other" do not overlap:
 *
 *     int xMove = ( xLength - ( xBendCount * lineGrid.x ) )
 *                     * sign( selectedEnd.x - unselectedEnd.x );
 *     ...
 *     xBendCount += yMoveBit;
 *
 * Nothing bounds that counter upstream, and nothing needs to: the move loop
 * applies one grid step per *frame* and mutates in place, so a wire that bent on
 * one frame is collapsed or parallel on the next and takes an earlier branch.
 * Few wires reach the elbow branch at once, and the counter resets every frame.
 *
 * Ours is a pure function of the untouched sheet, re-derived per frame, so every
 * connected wire arrives in one pass — 99 of them on a 100-pin part. The
 * set-back then far exceeded the wires themselves and flipped sign, throwing
 * elbows onto the far side: measured on the coldfire demo, a 5 mm drag of U102
 * moved an existing wire endpoint 77 mm and scattered 144 segments across
 * 278 x 128 mm of sheet.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { planMove } from '@ziroeda/eeschema/src/tools/connect.js';
import { orthoMove } from '@ziroeda/eeschema/src/tools/ortho.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { mmToIU, iuToMM } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic, Vec2 } from '@ziroeda/eeschema/src/types.js';

const LIB = new Map<string, LibSymbol>();

/**
 * A sheet with `n` pins down its left edge, each fed by a horizontal wire
 * `len` mm long with a free far end — the shape that forces the elbow branch
 * for every one of them.
 */
function sheetWithPins(n: number, len: number): Schematic {
  const y = (i: number) => 60 + i * 2.54;
  const pins = Array.from(
    { length: n },
    (_, i) => `(pin "P${i}" input (at 100 ${y(i)} 180) (uuid "p${i}"))`,
  );
  const wires = Array.from(
    { length: n },
    (_, i) =>
      `(wire (pts (xy ${100 - len} ${y(i)}) (xy 100 ${y(i)})) (stroke (width 0) (type default)) (uuid "w${i}"))`,
  );
  return readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (sheet (at 100 50) (size 40 ${n * 2.54 + 20}) (uuid "sh1")
        (property "Sheetname" "S" (at 100 49 0))
        (property "Sheetfile" "s.kicad_sch" (at 100 ${60 + n * 2.54 + 15} 0))
        ${pins.join('\n        ')})
      ${wires.join('\n      ')})`),
  );
}

const dragDown = (doc: Schematic, mm: number): Schematic => {
  const sel = new Set([refId('sheet', 'sh1', 0)]);
  const spec = planMove(doc, LIB, sel);
  return orthoMove(doc, spec, { x: 0, y: mmToIU(mm) }, LIB).apply(doc);
};

/** The furthest any point of the result strays outside the original sheet extent. */
function overrun(before: Schematic, after: Schematic): number {
  const pts = (d: Schematic): Vec2[] => d.lines.flatMap((l) => [l.start, l.end]);
  const b = pts(before);
  const minX = Math.min(...b.map((p) => p.x));
  const maxX = Math.max(...b.map((p) => p.x));
  let worst = 0;
  for (const p of pts(after)) worst = Math.max(worst, minX - p.x, p.x - maxX);
  return worst;
}

describe('a wide fan of wires off one part', () => {
  it('keeps every elbow on its own wire', () => {
    // 40 pins, wires only 10 mm long: the set-back would reach 50 mm unclamped.
    const before = sheetWithPins(40, 10);
    const after = dragDown(before, 2.54);
    // Nothing may end up outside the horizontal span the wires already covered.
    expect(iuToMM(overrun(before, after))).toBeLessThanOrEqual(0.01);
  });

  it('never sends a wire further than the wire is long', () => {
    const before = sheetWithPins(40, 10);
    const after = dragDown(before, 2.54);
    const was = new Map(before.lines.map((l) => [l.uuid!, l]));
    for (const l of after.lines) {
      const b = was.get(l.uuid!);
      if (!b) continue;
      const moved = Math.max(
        Math.hypot(l.start.x - b.start.x, l.start.y - b.start.y),
        Math.hypot(l.end.x - b.end.x, l.end.y - b.end.y),
      );
      // A wire can be translated by the drag and set back along itself, and no
      // more: 10 mm of wire plus the 2.54 mm drag.
      expect(iuToMM(moved), `wire ${l.uuid} moved too far`).toBeLessThanOrEqual(10 + 2.54 + 0.01);
    }
  });

  it('fans every bundle, whether or not the risers would have collided', () => {
    // The counter is unconditional upstream — it is advanced for every wire that
    // bends, and it starts at 1, not 0:
    //
    //     int xBendCount = 1;
    //     int yBendCount = 1;
    //     performItemMove( selection, delta, aCommit, xBendCount, yBendCount, grid );
    //     ...
    //     xBendCount += yMoveBit;
    //
    // So even a drag too small for any two risers to touch comes out as a
    // staircase, and that staircase is the look. Offsetting only on a measured
    // collision — which this used to do — left every elbow on the moving end and
    // no fan at all.
    const before = sheetWithPins(6, 40);
    const after = dragDown(before, 1.27);
    const created = after.lines.filter((l) => !before.lines.some((b) => b.uuid === l.uuid));
    const elbowX = [...new Set(created.filter((l) => l.start.x === l.end.x).map((l) => l.start.x))];
    expect(elbowX).toHaveLength(6);
    elbowX.sort((a, b) => b - a);
    for (let i = 1; i < elbowX.length; i++) expect(elbowX[i - 1]! - elbowX[i]!).toBe(mmToIU(1.27));
    // The first is one grid in from the moving end, where `xBendCount = 1` puts it.
    expect(elbowX[0]).toBe(mmToIU(100 - 1.27));
  });

  it('and folds the offset back into each wire rather than overshooting it', () => {
    // 40 wires only 10 mm long: the raw counter reaches 40 grid steps (50 mm)
    // and flips `xMove`'s sign, which is what threw elbows onto the far side of
    // the sheet. Each wire holds 6 steps, so the offsets cycle 1..6.
    const before = sheetWithPins(40, 10);
    const after = dragDown(before, 2.54);
    const created = after.lines.filter((l) => !before.lines.some((b) => b.uuid === l.uuid));
    const elbowX = [...new Set(created.filter((l) => l.start.x === l.end.x).map((l) => l.start.x))];
    // Every offset lands strictly inside the wire's own span, never on either end.
    for (const x of elbowX) {
      expect(x).toBeGreaterThan(mmToIU(90));
      expect(x).toBeLessThan(mmToIU(100));
    }
    // ...and no offset is used by more than a sixth of the wires, so nothing
    // piles up on one line the way clamping made it.
    const perX = new Map<number, number>();
    for (const l of created.filter((l) => l.start.x === l.end.x))
      perX.set(l.start.x, (perX.get(l.start.x) ?? 0) + 1);
    expect(Math.max(...perX.values())).toBeLessThanOrEqual(7);
  });

  it('but fans, one grid at a time, as soon as they would collide', () => {
    // Drag further than the wires are apart and every riser now spans its
    // neighbour's row, so each one has to step clear of the last.
    const before = sheetWithPins(6, 40);
    const after = dragDown(before, 7.62); // 3 grid steps, wires 2.54 mm apart
    const created = after.lines.filter((l) => !before.lines.some((b) => b.uuid === l.uuid));
    const elbowX = [...new Set(created.filter((l) => l.start.x === l.end.x).map((l) => l.start.x))];
    expect(elbowX.length).toBeGreaterThan(1);
    elbowX.sort((a, b) => b - a);
    for (let i = 1; i < elbowX.length; i++) expect(elbowX[i - 1]! - elbowX[i]!).toBe(mmToIU(1.27));
  });

  it('leaves a wire whose far end runs along the drag alone', () => {
    // The branch before the elbow one: a parallel neighbour absorbs the move by
    // lengthening, and no new segment appears at all.
    const n = 6;
    const y = (i: number) => 60 + i * 2.54;
    const doc = readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols)
        (sheet (at 100 50) (size 40 40) (uuid "sh1")
          (property "Sheetname" "S" (at 100 49 0))
          (property "Sheetfile" "s.kicad_sch" (at 100 95 0))
          ${Array.from({ length: n }, (_, i) => `(pin "P${i}" input (at 100 ${y(i)} 180) (uuid "p${i}"))`).join('\n          ')})
        ${Array.from({ length: n }, (_, i) => `(wire (pts (xy 60 ${y(i)}) (xy 100 ${y(i)})) (stroke (width 0) (type default)) (uuid "w${i}"))`).join('\n        ')}
        ${Array.from({ length: n }, (_, i) => `(wire (pts (xy 60 ${y(i)}) (xy 60 ${20 + i})) (stroke (width 0) (type default)) (uuid "v${i}"))`).join('\n        ')})`),
    );
    const after = dragDown(doc, 2.54);
    expect(after.lines.length).toBe(doc.lines.length);
  });
});

describe('risers never lie on top of each other', () => {
  /**
   * The property the offset is *for*. `performItemMove` walks the selection
   * through `GetItemsSortedByTypeAndXY( aDelta.x >= 0, aDelta.y >= 0 )` — by X
   * then Y, each in the direction of the drag — so the offsets are handed out
   * in geometric order and the fan comes out monotonic rather than in file
   * order.
   *
   * Upstream advances the counter for every bending wire whether or not the
   * risers would actually touch. It can: only a handful of wires reach that
   * branch per frame. Every connected wire reaches it in one pass here, so the
   * counter is advanced on a real collision instead — same purpose, and it
   * keeps each elbow as near the moving end as it can be. Blind advancement
   * pushed elbows right back to the anchored end, which is where net labels
   * sit: 33 of 74 risers cut through label text on the coldfire demo.
   */
  const shuffled = [3, 0, 6, 1, 7, 4, 2, 5];
  const y = (i: number) => 60 + i * 2.54;

  /** Eight equal-length wires into pins down a sheet edge, declared out of order. */
  const doc = (): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols)
        (sheet (at 100 50) (size 40 40) (uuid "sh1")
          (property "Sheetname" "S" (at 100 49 0))
          (property "Sheetfile" "s.kicad_sch" (at 100 95 0))
          ${shuffled.map((i) => `(pin "P${i}" input (at 100 ${y(i)} 180) (uuid "p${i}"))`).join('\n          ')})
        ${shuffled.map((i) => `(wire (pts (xy 50 ${y(i)}) (xy 100 ${y(i)})) (stroke (width 0) (type default)) (uuid "w${i}"))`).join('\n        ')})`),
    );

  /** Every created riser, as an axis-aligned segment. */
  const risers = (mm: number) => {
    const before = doc();
    const after = dragDown(before, mm);
    const had = new Set(before.lines.map((l) => l.uuid));
    return after.lines
      .filter((l) => !had.has(l.uuid) && l.start.x === l.end.x)
      .map((l) => ({
        x: l.start.x,
        y0: Math.min(l.start.y, l.end.y),
        y1: Math.max(l.start.y, l.end.y),
      }));
  };

  for (const mm of [1.27, 2.54, 5.08, -2.54, -7.62]) {
    it(`no two overlap dragging ${mm} mm`, () => {
      const rs = risers(mm);
      expect(rs.length).toBe(8);
      for (let i = 0; i < rs.length; i++) {
        for (let j = i + 1; j < rs.length; j++) {
          const a = rs[i]!;
          const b = rs[j]!;
          const share = a.x === b.x && Math.max(a.y0, b.y0) < Math.min(a.y1, b.y1);
          expect(share, `risers ${i} and ${j} overlap at x=${a.x}`).toBe(false);
        }
      }
    });
  }

  it('and a drag wider than the spacing produces a monotonic staircase', () => {
    // Every riser spans several rows, so each must clear the one before it.
    const xs = [...new Set(risers(7.62).map((r) => r.x))].sort((a, b) => b - a);
    expect(xs.length).toBeGreaterThan(1);
    for (let i = 1; i < xs.length; i++) expect(xs[i - 1]! - xs[i]!).toBe(mmToIU(1.27));
  });
});
