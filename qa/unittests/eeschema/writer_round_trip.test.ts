// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Does an edit to a modelled field actually reach the file?
 *
 * The writer patches each item's own source node rather than rebuilding it,
 * which keeps a save byte-stable but has a standing failure mode: a patcher
 * that only touches a child *when the source already has one* silently drops
 * any edit that introduces it. Six of those had been found one at a time, each
 * by a dialog that made a field editable and quietly did nothing.
 *
 * So this is the audit rather than another one-off: for each item kind, set a
 * field on a node that lacks it, round-trip through the writer and the reader,
 * and insist the value survives. The order each value is inserted at comes from
 * the matching `SCH_IO_KICAD_SEXPR::save*` in
 * eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.cpp.
 */
import { describe, it, expect } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr';
import { readSchematic, writeSchematic } from '@ziroeda/eeschema';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const sch = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114) (lib_symbols) ${body})`));
/** Write the model out and read it straight back, as a save/reload would. */
const roundTrip = (s: Schematic): Schematic => readSchematic(parse(serialize(writeSchematic(s))));

describe('a field set on a node that never had it', () => {
  it('keeps a junction’s diameter', () => {
    // saveJunction always prints (diameter …), between (at …) and (color …).
    const d = sch('(junction (at 10 10) (uuid "j1"))');
    const out = roundTrip({
      ...d,
      junctions: [{ ...d.junctions[0]!, diameter: mmToIU(1.0) }],
    });
    expect(out.junctions[0]!.diameter).toBe(mmToIU(1.0));
  });

  it('keeps a hierarchical label’s shape', () => {
    // saveText prints (shape …) before (at …) for global/hierarchical labels.
    const d = sch('(hierarchical_label "H" (at 10 10 0) (uuid "l1"))');
    const out = roundTrip({ ...d, labels: [{ ...d.labels[0]!, shape: 'output' }] });
    expect(out.labels[0]!.shape).toBe('output');
  });

  it('keeps a directive label’s pin length', () => {
    // saveText prints (length …) first for a directive label, then (shape …).
    const d = sch(`(netclass_flag "" (at 10 10 0) (shape round) (uuid "d1")
      (property "Netclass" "HV" (at 10 10 0)))`);
    const out = roundTrip({
      ...d,
      directiveLabels: [{ ...d.directiveLabels![0]!, pinLength: mmToIU(5) }],
    });
    expect(out.directiveLabels?.[0]?.pinLength).toBe(mmToIU(5));
  });

  it('keeps a directive label’s shape', () => {
    const d = sch(`(netclass_flag "" (at 10 10 0) (uuid "d1")
      (property "Netclass" "HV" (at 10 10 0)))`);
    const out = roundTrip({
      ...d,
      directiveLabels: [{ ...d.directiveLabels![0]!, shape: 'diamond' }],
    });
    expect(out.directiveLabels?.[0]?.shape).toBe('diamond');
  });

  it('keeps a text box’s margins', () => {
    // saveTextBox prints (margins l t r b) right after (size …); the writer
    // never emitted them at all, so a text inset was lost on save.
    const d = sch('(text_box "hi" (at 0 0 0) (size 10 5) (uuid "tb1"))');
    const m = { left: mmToIU(1), top: mmToIU(2), right: mmToIU(3), bottom: mmToIU(4) };
    const out = roundTrip({ ...d, textBoxes: [{ ...d.textBoxes[0]!, margins: m }] });
    expect(out.textBoxes[0]!.margins).toEqual(m);
  });

  it('keeps an image’s scale', () => {
    const d = sch('(image (at 0 0) (uuid "i1") (data "iVBORw0KGgo="))');
    const out = roundTrip({ ...d, images: [{ ...d.images[0]!, scale: 2 }] });
    expect(out.images[0]!.scale).toBe(2);
  });

  it('drops an image’s scale again when it goes back to 1', () => {
    // saveBitmap omits the token entirely at 1.0, so a stale one must not be
    // left behind after an image is scaled back.
    const d = sch('(image (at 0 0) (scale 2) (uuid "i1") (data "iVBORw0KGgo="))');
    const written = serialize(writeSchematic({ ...d, images: [{ ...d.images[0]!, scale: 1 }] }));
    expect(written).not.toContain('scale');
    expect(roundTrip({ ...d, images: [{ ...d.images[0]!, scale: 1 }] }).images[0]!.scale).toBe(1);
  });
});

describe('a bus entry’s size vector', () => {
  it('round-trips, signs and all', () => {
    // The signs are the entry's direction: the tool turns a stub through its
    // four orientations by rotating this vector, so losing them saved every
    // entry pointing the same way whichever way it was drawn. The writer did
    // not emit (size …) at all.
    const d = sch('(bus_entry (at 0 0) (size 2.54 2.54) (uuid "be1"))');
    const size = { x: mmToIU(-2.54), y: mmToIU(2.54) };
    const out = roundTrip({ ...d, busEntries: [{ ...d.busEntries[0]!, size }] });
    expect(out.busEntries[0]!.size).toEqual(size);
  });

  it('is written even when the source node had none', () => {
    const d = sch('(bus_entry (at 0 0) (uuid "be1"))');
    const size = { x: mmToIU(2.54), y: mmToIU(-2.54) };
    const out = roundTrip({ ...d, busEntries: [{ ...d.busEntries[0]!, size }] });
    expect(out.busEntries[0]!.size).toEqual(size);
  });
});

describe('fields that already round-tripped stay that way', () => {
  it('a wire’s stroke', () => {
    const d = sch('(wire (pts (xy 0 0) (xy 10 0)) (uuid "w1"))');
    const stroke = { width: mmToIU(0.5), type: 'dash' };
    const out = roundTrip({ ...d, lines: [{ ...d.lines[0]!, stroke }] });
    expect(out.lines[0]!.stroke).toEqual(stroke);
  });

  it('a no-connect’s position', () => {
    const d = sch('(no_connect (at 0 0) (uuid "n1"))');
    const at = { x: mmToIU(5), y: mmToIU(5) };
    const out = roundTrip({ ...d, noConnects: [{ ...d.noConnects[0]!, at }] });
    expect(out.noConnects[0]!.at).toEqual(at);
  });

  it('saving an untouched document is stable', () => {
    // The new inserts must not churn a file that already had these children:
    // writing, reading back and writing again has to give the same bytes.
    const d = sch(`(junction (at 10 10) (diameter 0.9) (uuid "j1"))
      (bus_entry (at 0 0) (size 2.54 2.54) (uuid "be1"))
      (hierarchical_label "H" (shape input) (at 10 10 0) (uuid "l1"))
      (text_box "hi" (at 0 0 0) (size 10 5) (margins 1 1 1 1) (uuid "tb1"))`);
    const once = serialize(writeSchematic(d));
    const twice = serialize(writeSchematic(readSchematic(parse(once))));
    expect(twice).toBe(once);
    // And the values are still the ones the file started with.
    const back = readSchematic(parse(once));
    expect(back.junctions[0]!.diameter).toBe(d.junctions[0]!.diameter);
    expect(back.busEntries[0]!.size).toEqual(d.busEntries[0]!.size);
    expect(back.labels[0]!.shape).toBe('input');
  });
});
