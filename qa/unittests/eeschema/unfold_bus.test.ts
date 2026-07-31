// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Unfold Bus (C): pulling one member out of a bus as an entry plus a label.
 *
 * The two things that must not go wrong are the ones the tool exists to
 * prevent: the entry landing near the bus instead of on it, and the member
 * list offering names the bus does not carry.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import {
  busUnfoldMembers,
  unfoldBus,
  busForUnfolding,
  nearestPointOnSegment,
} from '@ziroeda/eeschema/src/tools/unfold_bus.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const mm = (v: number): number => mmToIU(v);

// A horizontal bus labelled DATA[0..3], plus a plain wire that must not be
// mistaken for a bus.
const DOC = `(kicad_sch (version 20250114) (generator "x") (lib_symbols)
  (bus (pts (xy 20 30) (xy 80 30)) (uuid "b1"))
  (label "DATA[0..3]" (at 20 30 0) (uuid "lb1"))
  (wire (pts (xy 20 60) (xy 80 60)) (uuid "w1"))
)`;

const sch = readSchematic(parse(DOC));
const BUS = 0;

describe('the member list', () => {
  it('expands the bus label into its members', () => {
    expect(busUnfoldMembers(sch, BUS)).toEqual(['DATA0', 'DATA1', 'DATA2', 'DATA3']);
  });

  it('is empty for a bus with no label naming it', () => {
    // A bus takes its members from its label; without one there is nothing to
    // offer, and inventing names would be worse than an empty menu.
    const bare = readSchematic(
      parse('(kicad_sch (version 1) (lib_symbols) (bus (pts (xy 0 0) (xy 10 0)) (uuid "b")))'),
    );
    expect(busUnfoldMembers(bare, 0)).toEqual([]);
  });

  it('is empty for a wire, which carries no members', () => {
    expect(busUnfoldMembers(sch, 1)).toEqual([]);
  });

  it('does not repeat a member named by two labels', () => {
    const twice = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols)
        (bus (pts (xy 20 30) (xy 80 30)) (uuid "b"))
        (label "D[0..1]" (at 20 30 0) (uuid "l1"))
        (label "D[0..1]" (at 80 30 0) (uuid "l2")))`),
    );
    expect(busUnfoldMembers(twice, 0)).toEqual(['D0', 'D1']);
  });
});

describe('unfolding', () => {
  it('puts the entry on the bus, not merely near it', () => {
    // An entry near the bus is not connected to it, and the unfold would
    // silently make a floating net.
    const out = unfoldBus(sch, BUS, { x: mm(50), y: mm(34) }, 'DATA1')!;
    const doc = out.command.apply(sch);
    expect(doc.busEntries).toHaveLength(1);
    expect(doc.busEntries[0]!.at).toEqual({ x: mm(50), y: mm(30) });
  });

  it('names the label for the member and puts it at the entry’s far end', () => {
    const out = unfoldBus(sch, BUS, { x: mm(50), y: mm(34) }, 'DATA1')!;
    const doc = out.command.apply(sch);
    const label = doc.labels.at(-1)!;
    expect(label.text).toBe('DATA1');
    expect(label.at).toEqual(out.wireStart);
    const entry = doc.busEntries[0]!;
    expect(out.wireStart).toEqual({
      x: entry.at.x + entry.size.x,
      y: entry.at.y + entry.size.y,
    });
  });

  it('runs the entry away from the bus, on the side the cursor was', () => {
    // Unfolding downward must not send the entry back up through the bus.
    const down = unfoldBus(sch, BUS, { x: mm(50), y: mm(34) }, 'DATA1')!.command.apply(sch);
    const up = unfoldBus(sch, BUS, { x: mm(50), y: mm(26) }, 'DATA1')!.command.apply(sch);
    expect(down.busEntries[0]!.size.y).toBeGreaterThan(0);
    expect(up.busEntries[0]!.size.y).toBeLessThan(0);
  });

  it('refuses a wire, or an empty net name', () => {
    expect(unfoldBus(sch, 1, { x: mm(50), y: mm(60) }, 'DATA1')).toBeNull();
    expect(unfoldBus(sch, BUS, { x: mm(50), y: mm(34) }, '')).toBeNull();
  });

  it('undoes exactly, and the result saves', () => {
    const out = unfoldBus(sch, BUS, { x: mm(50), y: mm(34) }, 'DATA1')!;
    const after = out.command.apply(sch);
    const back = out.command.invert(sch).apply(after);
    expect(back.busEntries).toEqual(sch.busEntries);
    expect(back.labels).toEqual(sch.labels);

    const reread = readSchematic(parse(serializeSchematic(after)));
    expect(reread.busEntries).toHaveLength(1);
    expect(reread.labels.at(-1)!.text).toBe('DATA1');
  });
});

describe('finding the bus to unfold from', () => {
  it('picks the bus under the cursor and ignores wires', () => {
    expect(busForUnfolding(sch, { x: mm(50), y: mm(30) }, mm(2))).toBe(BUS);
    // On the wire, not the bus: nothing to unfold.
    expect(busForUnfolding(sch, { x: mm(50), y: mm(60) }, mm(2))).toBe(-1);
    expect(busForUnfolding(sch, { x: mm(50), y: mm(45) }, mm(2))).toBe(-1);
  });

  it('projects onto the segment rather than its infinite line', () => {
    // Past the end of the bus, the nearest point is the endpoint.
    expect(
      nearestPointOnSegment({ x: mm(200), y: mm(30) }, sch.lines[0]!.start, sch.lines[0]!.end),
    ).toEqual({ x: mm(80), y: mm(30) });
  });
});
