// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every movable item kind moves, on every move path.
 *
 * `SCH_COLLECTOR::MovableItems` (eeschema/sch_collectors.cpp) lists junctions,
 * no-connects, both bus entries, lines, bitmaps, shapes, text, text boxes,
 * tables, every label kind, directive labels, fields, symbols, sheet pins and
 * sheets. `SCH_MOVE_TOOL` translates all of them the same way.
 *
 * We have three appliers and each one used to repeat the list, so they drifted:
 * the ortho drag path rewrote only symbols, wires, junctions and labels, which
 * meant dragging a hierarchical sheet did nothing at all even though M (Move)
 * moved it, and text boxes, bus entries, images, shapes and tables would not
 * move on any path. They now share `moveRigidItems`.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import { planMove } from '@ziroeda/eeschema/src/tools/connect.js';
import { orthoMove } from '@ziroeda/eeschema/src/tools/ortho.js';
import { moveWithConnections, moveItems } from '@ziroeda/eeschema/src/tools/move.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

const DOC = `(kicad_sch (version 20250114) (generator "x") (lib_symbols)
  (sheet (at 50 50) (size 30 20) (uuid "sh1")
    (property "Sheetname" "Sub" (at 50 49.4 0))
    (property "Sheetfile" "sub.kicad_sch" (at 50 70.6 0))
    (pin "A" input (at 50 55 180) (uuid "sp1")))
  (no_connect (at 100 50) (uuid "nc1"))
  (text_box "note" (at 100 60 0) (size 20 10) (uuid "tb1"))
  (bus_entry (at 100 80) (size 2.54 2.54) (uuid "be1"))
  (image (at 140 50) (scale 1) (uuid "im1") (data "iVBORw0KGgo="))
  (rectangle (start 170 50) (end 180 60) (uuid "r1"))
  (netclass_flag "HS" (at 200 50 0) (length 2.54) (uuid "nf1"))
  (text "free" (at 140 70 0) (uuid "tx1"))
  (label "L1" (at 160 50 0) (uuid "lb1"))
  (junction (at 160 60) (uuid "j1"))
)`;

const LIBS = new Map();
const D = { x: mmToIU(10), y: 0 };
type Doc = ReturnType<typeof readSchematic>;
type P = { x: number; y: number };

/** Each kind, its selection id, and the anchor point that must follow a move. */
const KINDS: { name: string; id: (d: Doc) => string; at: (d: Doc) => P | undefined }[] = [
  { name: 'sheet', id: (d) => refId('sheet', d.sheets[0]?.uuid, 0), at: (d) => d.sheets[0]?.at },
  {
    name: 'no-connect',
    id: (d) => refId('noconnect', d.noConnects[0]?.uuid, 0),
    at: (d) => d.noConnects[0]?.at,
  },
  {
    name: 'text box',
    id: (d) => refId('textbox', d.textBoxes[0]?.uuid, 0),
    at: (d) => d.textBoxes[0]?.start,
  },
  {
    name: 'bus entry',
    id: (d) => refId('busentry', d.busEntries[0]?.uuid, 0),
    at: (d) => d.busEntries[0]?.at,
  },
  { name: 'image', id: (d) => refId('image', d.images[0]?.uuid, 0), at: (d) => d.images[0]?.at },
  {
    name: 'shape',
    id: () => refId('graphic', undefined, 0),
    at: (d) => (d.graphics[0] as { start?: P })?.start,
  },
  {
    name: 'netclass flag',
    id: (d) => refId('directive', d.directiveLabels?.[0]?.uuid, 0),
    at: (d) => d.directiveLabels?.[0]?.at,
  },
  // Free text parses into `labels` with kind 'text', ahead of the label itself.
  {
    name: 'free text',
    id: (d) => refId('label', d.labels[0]?.uuid, 0),
    at: (d) => d.labels[0]?.at,
  },
  { name: 'label', id: (d) => refId('label', d.labels[1]?.uuid, 1), at: (d) => d.labels[1]?.at },
  {
    name: 'junction',
    id: (d) => refId('junction', d.junctions[0]?.uuid, 0),
    at: (d) => d.junctions[0]?.at,
  },
];

const sch = readSchematic(parse(DOC));

/** The three appliers, keyed by how the editor reaches them. */
const PATHS: { name: string; run: (ids: Set<string>) => Doc }[] = [
  {
    // Left-drag, and G, at the default 90 degree line mode. This is the one the
    // sheet bug was in.
    name: 'orthoMove (drag)',
    run: (ids) => orthoMove(sch, planMove(sch, LIBS, ids), D, LIBS).apply(sch),
  },
  {
    name: 'moveWithConnections (drag, free line mode)',
    run: (ids) => moveWithConnections(planMove(sch, LIBS, ids), D).apply(sch),
  },
  { name: 'moveItems (M)', run: (ids) => moveItems(ids, D).apply(sch) },
];

describe('every movable item kind moves, on every path', () => {
  for (const path of PATHS) {
    describe(path.name, () => {
      for (const k of KINDS) {
        it(`moves a ${k.name}`, () => {
          const before = k.at(sch);
          expect(before, `${k.name} did not parse`).toBeDefined();
          const after = k.at(path.run(new Set([k.id(sch)])));
          expect(after).toBeDefined();
          expect(after!.x - before!.x).toBe(D.x);
          expect(after!.y - before!.y).toBe(D.y);
        });
      }
    });
  }

  it('carries a sheet’s pins and fields with it', () => {
    const ids = new Set([refId('sheet', sch.sheets[0]!.uuid, 0)]);
    const out = orthoMove(sch, planMove(sch, LIBS, ids), D, LIBS).apply(sch);
    const before = sch.sheets[0]!;
    const after = out.sheets[0]!;
    expect(after.pins[0]!.at.x - before.pins[0]!.at.x).toBe(D.x);
    expect(after.fields[0]!.at!.x - before.fields[0]!.at!.x).toBe(D.x);
  });

  it('leaves unselected items alone', () => {
    const ids = new Set([refId('sheet', sch.sheets[0]!.uuid, 0)]);
    const out = orthoMove(sch, planMove(sch, LIBS, ids), D, LIBS).apply(sch);
    expect(out.noConnects[0]!.at).toEqual(sch.noConnects[0]!.at);
    expect(out.images[0]!.at).toEqual(sch.images[0]!.at);
    expect(out.textBoxes[0]!.start).toEqual(sch.textBoxes[0]!.start);
  });

  it('leaves untouched arrays identical, not just equal', () => {
    // A drag runs a move on every pointer event. If the untouched arrays came
    // back as fresh copies, everything downstream that compares by identity
    // (memoised renders, connectivity caches) would see them change each frame.
    const ids = new Set([refId('sheet', sch.sheets[0]!.uuid, 0)]);
    const out = orthoMove(sch, planMove(sch, LIBS, ids), D, LIBS).apply(sch);
    expect(out.sheets).not.toBe(sch.sheets); // this one did move
    expect(out.noConnects).toBe(sch.noConnects);
    expect(out.busEntries).toBe(sch.busEntries);
    expect(out.images).toBe(sch.images);
    expect(out.textBoxes).toBe(sch.textBoxes);
    expect(out.tables).toBe(sch.tables);
    expect(out.graphics).toBe(sch.graphics);
  });

  it('leaves the optional directiveLabels field exactly as it found it', () => {
    // The field is optional on Schematic, though the reader always fills it in,
    // so a move must neither drop it nor replace it with a fresh empty array.
    const plain = readSchematic(
      parse('(kicad_sch (version 1) (lib_symbols) (junction (at 10 10)))'),
    );
    const ids = new Set([refId('junction', plain.junctions[0]?.uuid, 0)]);
    const out = orthoMove(plain, planMove(plain, LIBS, ids), D, LIBS).apply(plain);
    expect(out.directiveLabels).toBe(plain.directiveLabels);
  });

  it('undoes exactly, on the drag path', () => {
    for (const k of KINDS) {
      const ids = new Set([k.id(sch)]);
      const cmd = orthoMove(sch, planMove(sch, LIBS, ids), D, LIBS);
      const back = cmd.invert(sch).apply(cmd.apply(sch));
      expect(k.at(back), `${k.name} did not come back`).toEqual(k.at(sch));
    }
  });
});
