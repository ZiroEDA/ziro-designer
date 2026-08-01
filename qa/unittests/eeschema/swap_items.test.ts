// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Swap (Alt+S), SCH_EDIT_TOOL::Swap.
 *
 * Two items exchange places, which is obvious. More than two *rotate*, which is
 * not: upstream walks the selection swapping each item with the next, so the
 * positions cycle rather than the first and last exchanging.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { refId, sheetPinId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { swapItems, canSwap } from '@ziroeda/eeschema/src/tools/swap_items.js';
import { sideOfAngle } from '@ziroeda/eeschema/src/tools/sch_sheet_pin_tool.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const mm = (v: number): number => mmToIU(v);

const DOC = `(kicad_sch (version 20250114) (generator "x") (lib_symbols)
  (junction (at 10 10) (uuid "j1"))
  (junction (at 20 20) (uuid "j2"))
  (junction (at 30 30) (uuid "j3"))
  (label "L1" (at 40 10 0) (uuid "lb1"))
  (label "L2" (at 50 10 180) (uuid "lb2"))
  (sheet (at 60 60) (size 30 20) (uuid "sh1")
    (property "Sheetname" "S" (at 60 59 0))
    (property "Sheetfile" "s.kicad_sch" (at 60 81 0))
    (pin "A" input (at 90 65 0) (uuid "p1"))
    (pin "B" input (at 60 70 180) (uuid "p2")))
)`;

const sch = readSchematic(parse(DOC));
const J = [0, 1, 2].map((i) => refId('junction', `j${i + 1}`, i));
const L = [0, 1].map((i) => refId('label', `lb${i + 1}`, i));
const SHEET = refId('sheet', 'sh1', 0);
const P = [0, 1].map((k) => sheetPinId(SHEET, k));

describe('swapping two items', () => {
  it('exchanges their positions', () => {
    const out = swapItems(sch, new Set([J[0]!, J[1]!]))!.apply(sch);
    expect(out.junctions[0]!.at).toEqual({ x: mm(20), y: mm(20) });
    expect(out.junctions[1]!.at).toEqual({ x: mm(10), y: mm(10) });
    // The third is untouched.
    expect(out.junctions[2]!.at).toEqual({ x: mm(30), y: mm(30) });
  });
});

describe('swapping more than two', () => {
  it('rotates the positions rather than exchanging the ends', () => {
    // A, B, C end up at B's, C's and A's places.
    const out = swapItems(sch, new Set([J[0]!, J[1]!, J[2]!]))!.apply(sch);
    expect(out.junctions[0]!.at).toEqual({ x: mm(20), y: mm(20) });
    expect(out.junctions[1]!.at).toEqual({ x: mm(30), y: mm(30) });
    expect(out.junctions[2]!.at).toEqual({ x: mm(10), y: mm(10) });
  });

  it('follows the order the selection was built in', () => {
    // Sets iterate in insertion order, which is the selection order upstream
    // sorts by; a different order gives a different rotation.
    const out = swapItems(sch, new Set([J[2]!, J[1]!, J[0]!]))!.apply(sch);
    expect(out.junctions[2]!.at).toEqual({ x: mm(20), y: mm(20) });
    expect(out.junctions[1]!.at).toEqual({ x: mm(10), y: mm(10) });
    expect(out.junctions[0]!.at).toEqual({ x: mm(30), y: mm(30) });
  });
});

describe('orientation travels with the position', () => {
  it('swaps label spin styles, so a swapped label does not read backwards', () => {
    const out = swapItems(sch, new Set([L[0]!, L[1]!]))!.apply(sch);
    expect(out.labels[0]!.angle).toBe(180);
    expect(out.labels[1]!.angle).toBe(0);
  });

  it('swaps sheet pin sides, so a swapped pin is not on the wrong border', () => {
    const out = swapItems(sch, new Set([P[0]!, P[1]!]))!.apply(sch);
    const pins = out.sheets[0]!.pins;
    expect(sideOfAngle(pins[0]!.angle)).toBe('left');
    expect(sideOfAngle(pins[1]!.angle)).toBe('right');
    // And their positions really did exchange.
    expect(pins[0]!.at).toEqual({ x: mm(60), y: mm(70) });
    expect(pins[1]!.at).toEqual({ x: mm(90), y: mm(65) });
  });
});

describe('what a swap refuses', () => {
  it('needs at least two items', () => {
    expect(swapItems(sch, new Set([J[0]!]))).toBeNull();
    expect(swapItems(sch, new Set())).toBeNull();
    expect(canSwap(sch, new Set([J[0]!]))).toBe(false);
  });

  it('will not mix sheet pins with anything else', () => {
    // A pin is constrained to its own sheet's border; swapping it with a
    // junction would put it somewhere it cannot be.
    expect(swapItems(sch, new Set([P[0]!, J[0]!]))).toBeNull();
  });

  it('does nothing when the positions already coincide', () => {
    const same = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols)
        (junction (at 10 10) (uuid "a"))
        (junction (at 10 10) (uuid "b")))`),
    );
    expect(
      swapItems(same, new Set([refId('junction', 'a', 0), refId('junction', 'b', 1)])),
    ).toBeNull();
  });
});

describe('undo and saving', () => {
  it('puts everything back exactly', () => {
    const cmd = swapItems(sch, new Set([J[0]!, J[1]!, J[2]!]))!;
    const back = cmd.invert(sch).apply(cmd.apply(sch));
    expect(back.junctions.map((j) => j.at)).toEqual(sch.junctions.map((j) => j.at));
  });

  it('restores label angles on undo', () => {
    const cmd = swapItems(sch, new Set([L[0]!, L[1]!]))!;
    const back = cmd.invert(sch).apply(cmd.apply(sch));
    expect(back.labels.map((l) => l.angle)).toEqual(sch.labels.map((l) => l.angle));
  });

  it('survives a save', () => {
    const out = swapItems(sch, new Set([P[0]!, P[1]!]))!.apply(sch);
    const reread = readSchematic(parse(serializeSchematic(out)));
    expect(reread.sheets[0]!.pins.map((p) => p.at)).toEqual(out.sheets[0]!.pins.map((p) => p.at));
    expect(reread.sheets[0]!.pins.map((p) => p.angle)).toEqual(
      out.sheets[0]!.pins.map((p) => p.angle),
    );
  });
});
