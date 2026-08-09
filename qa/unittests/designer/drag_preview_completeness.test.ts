// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A drag splits the sheet in two: a static base recorded without the moving
 * items, and a preview redrawn every frame with only them. The split has to be
 * *exhaustive* — anything in neither half is invisible for the length of the
 * gesture.
 *
 * `movingIds` is built from the move plan, and a plan cannot name the segments
 * an orthogonal drag invents while it runs: `SCH_MOVE_TOOL::orthoLineDrag`
 * creates its 90-degree bends inside the command, with fresh uuids, every time
 * the command is rebuilt — once per pointer move. They were in neither half, so
 * dragging a symbol off the axis of its wire drew no bend until the drop.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, readSymbolLib, refId } from '@ziroeda/eeschema';
import { planMove } from '@ziroeda/eeschema/src/tools/connect.js';
import { orthoMove } from '@ziroeda/eeschema/src/tools/ortho.js';
import {
  dragSplit,
  movingIds,
  sameIds,
} from '@ziroeda/designer/src/editors/schematic/moving_ids.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/src/types.js';

const rawR = readFileSync(
  fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)),
  'utf8',
);
const R = readSymbolLib(parse(rawR))[0]!;
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);
const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));

/** R1 with a wire running down from its lower pin. */
const base: Schematic = readSchematic(
  parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})
    (symbol (lib_id "R") (at 100 100 0) (unit 1) (uuid "r1")
      (property "Reference" "R1" (at 105 100 0))
      (property "Value" "10k" (at 107 100 0)))
    (wire (pts (xy 100 103.81) (xy 100 120)) (stroke (width 0) (type default)) (uuid "w1")))`),
);

const sel = new Set([refId('symbol', 'r1', 0)]);
const spec = planMove(base, LIB, sel);

/** The document as the ghost shows it, part-way through a drag. */
const ghost = (dx: number, dy: number): Schematic =>
  orthoMove(base, spec, { x: mmToIU(dx), y: mmToIU(dy) }, LIB).apply(base);

/**
 * Every line in `doc` that neither half of the split would draw.
 *
 * The base is recorded from the unmoved sheet with `hiddenItems: moving`, so it
 * draws a line it already had and that is not moving. The preview draws
 * whatever `onlyItems` names. A line in neither is invisible.
 */
const missing = (doc: Schematic, preview: ReadonlySet<string>): string[] => {
  const moving = movingIds(spec);
  const baseUuids = new Set(base.lines.map((l) => l.uuid));
  const out: string[] = [];
  doc.lines.forEach((l, i) => {
    const id = refId('line', l.uuid, i);
    const byBase = baseUuids.has(l.uuid) && !moving.has(id);
    if (!byBase && !preview.has(id)) out.push(id);
  });
  return out;
};

describe('the preview draws everything the move created', () => {
  it('an ortho drag sideways adds a bend the plan never named', () => {
    // Dragging perpendicular to the wire is what makes the bend appear.
    const doc = ghost(-5, 0);
    const created = doc.lines.filter((l) => !base.lines.some((b) => b.uuid === l.uuid));
    expect(created.length).toBeGreaterThan(0);

    const plan = movingIds(spec);
    // None of them is in the plan: that is the bug.
    for (const l of created) {
      const i = doc.lines.indexOf(l);
      expect(plan.has(refId('line', l.uuid, i))).toBe(false);
    }
  });

  it('and previewIds picks them up', () => {
    const doc = ghost(-5, 0);
    const ids = dragSplit(movingIds(spec), base, doc).preview;
    for (const l of doc.lines) {
      const i = doc.lines.indexOf(l);
      const id = refId('line', l.uuid, i);
      const wasInBase = base.lines.some((b) => b.uuid === l.uuid);
      // Everything is drawn by exactly one half: the base keeps what it had and
      // is not moving; the preview takes the rest.
      if (!wasInBase) expect(ids.has(id), `created line ${l.uuid} not previewed`).toBe(true);
    }
  });

  it('leaves nothing on the sheet undrawn', () => {
    const doc = ghost(-5, 0);
    // With the plan alone, the bend is drawn by neither half — that is exactly
    // what "the extra segment does not appear until you drop it" was.
    expect(missing(doc, movingIds(spec)).length).toBeGreaterThan(0);
    // With the diff, every line has a home.
    expect(missing(doc, dragSplit(movingIds(spec), base, doc).preview)).toEqual([]);
  });

  it('still includes everything the plan already named', () => {
    // A superset, never a replacement.
    const doc = ghost(-5, 0);
    const ids = dragSplit(movingIds(spec), base, doc).preview;
    for (const id of movingIds(spec)) expect(ids.has(id)).toBe(true);
  });

  it('adds nothing when the drag creates nothing', () => {
    // Dragging *along* the wire just stretches it: no bend, so the preview set
    // is exactly the plan and the base recording stays valid.
    const doc = ghost(0, -5);
    const created = doc.lines.filter((l) => !base.lines.some((b) => b.uuid === l.uuid));
    expect(created).toEqual([]);
    expect([...dragSplit(movingIds(spec), base, doc).preview].sort()).toEqual(
      [...movingIds(spec)].sort(),
    );
  });

  it('picks up junctions a move drops in, not just lines', () => {
    const doc = ghost(-5, 0);
    const ids = dragSplit(movingIds(spec), base, doc).preview;
    doc.junctions.forEach((j, i) => {
      if (!base.junctions.some((b) => b.uuid === j.uuid))
        expect(ids.has(refId('junction', j.uuid, i))).toBe(true);
    });
  });
});

describe('a wire the drag reshapes without the plan naming it', () => {
  // `orthoLineDrag` prefers to lengthen or shorten an unselected neighbour that
  // runs along the drag rather than add a bend. That wire is nowhere in the
  // plan, so the base kept drawing it at its old length: frozen for the whole
  // gesture, snapping into place on release.
  const withNeighbour: Schematic = readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})
      (symbol (lib_id "R") (at 100 100 0) (unit 1) (uuid "r1")
        (property "Reference" "R1" (at 105 100 0))
        (property "Value" "10k" (at 107 100 0)))
      (wire (pts (xy 100 103.81) (xy 120 103.81)) (stroke (width 0) (type default)) (uuid "h1"))
      (wire (pts (xy 120 103.81) (xy 120 130)) (stroke (width 0) (type default)) (uuid "v1")))`),
  );

  it('is in the split, so it is drawn once and in the right place', () => {
    const sel2 = new Set([refId('symbol', 'r1', 0)]);
    const spec2 = planMove(withNeighbour, LIB, sel2);
    const doc = orthoMove(withNeighbour, spec2, { x: 0, y: mmToIU(5) }, LIB).apply(withNeighbour);

    const geom = (l: { start: { x: number; y: number }; end: { x: number; y: number } }) =>
      `${l.start.x},${l.start.y},${l.end.x},${l.end.y}`;
    const was = new Map(withNeighbour.lines.map((l) => [l.uuid!, geom(l)]));
    const reshaped = doc.lines.filter((l) => was.has(l.uuid!) && was.get(l.uuid!) !== geom(l));
    expect(reshaped.length).toBeGreaterThan(0);

    const plan = movingIds(spec2);
    const split = dragSplit(plan, withNeighbour, doc).preview;
    for (const l of reshaped) {
      const id = refId('line', l.uuid, doc.lines.indexOf(l));
      // Not in the plan...
      const inPlan = plan.has(id);
      // ...but always in the split.
      expect(split.has(id), `reshaped wire ${l.uuid} missing from the split`).toBe(true);
      if (!inPlan) expect(split.has(id)).toBe(true);
    }
  });
});

describe('the split keeps its identity while it is unchanged', () => {
  it('sameIds compares contents, not references', () => {
    // The base recording is keyed on this set by reference; a fresh Set every
    // frame would re-record the whole sheet on every pointer move.
    expect(sameIds(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameIds(new Set(['a']), new Set(['a', 'b']))).toBe(false);
    expect(sameIds(new Set(['a', 'b']), new Set(['a', 'c']))).toBe(false);
  });

  it('and a steady drag hides the same items each frame', () => {
    // Only `hidden` has to be stable: the base recording is keyed on it by
    // reference, and a fresh set every frame would re-record the whole sheet on
    // every pointer move — the one cost this whole split exists to avoid.
    // `preview` carries the freshly-minted bend uuids and is re-recorded anyway.
    const a = dragSplit(movingIds(spec), base, ghost(-5, 0));
    const b = dragSplit(movingIds(spec), base, ghost(-6.27, 0));
    expect(sameIds(a.hidden, b.hidden)).toBe(true);
    expect(sameIds(a.preview, b.preview)).toBe(false);
  });
});
