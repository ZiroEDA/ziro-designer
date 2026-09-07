// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { makeWire, makeLabel } from '@ziroeda/eeschema/src/tools/build.js';
import { addItems } from '@ziroeda/eeschema/src/tools/mutate.js';
import { lassoSelect } from '@ziroeda/eeschema/src/tools/boxselect.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { lassoIsInside } from '@ziroeda/common/src/preview_items/selection_area.js';

const EMPTY = () => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));
const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const libById = new Map();

describe('lassoSelect', () => {
  it('selects items the polygon encloses and skips those outside', () => {
    const inside = makeLabel('label', 'IN', at(20, 20));
    const outside = makeLabel('label', 'OUT', at(80, 80));
    const doc = addItems({ labels: [inside, outside] }).apply(EMPTY());
    // A square loosely around (20,20) only.
    const poly = [at(10, 10), at(40, 10), at(40, 40), at(10, 40)];
    const ids = lassoSelect(doc, libById, poly);
    expect(ids.has(inside.uuid!)).toBe(true);
    expect(ids.has(outside.uuid!)).toBe(false);
  });

  it('selects a wire the polygon crosses (touching semantics)', () => {
    const wire = makeWire(at(0, 25), at(50, 25));
    const doc = addItems({ lines: [wire] }).apply(EMPTY());
    // A small box straddling the wire near its middle.
    const poly = [at(20, 20), at(30, 20), at(30, 30), at(20, 30)];
    const ids = lassoSelect(doc, libById, poly);
    expect(ids.has(wire.uuid!)).toBe(true);
  });

  it('returns nothing for a degenerate polygon', () => {
    const doc = addItems({ labels: [makeLabel('label', 'X', at(5, 5))] }).apply(EMPTY());
    expect(lassoSelect(doc, libById, [at(0, 0), at(1, 1)]).size).toBe(0);
  });

  it('honours the winding: a window lasso takes only what is fully inside', () => {
    // `SelectMultiple` is handed `aArea.GetMode()`, which `selectLasso` sets
    // from the signed area every frame (`sch_selection_tool.cpp:2352-2367`).
    // The wire runs 0..50 mm and the lasso covers 20..30, so it crosses the
    // band and is not inside it: greedy takes it, a window select does not.
    const wire = makeWire(at(0, 25), at(50, 25));
    const doc = addItems({ lines: [wire] }).apply(EMPTY());
    const box = [at(20, 20), at(30, 20), at(30, 30), at(20, 30)];

    expect(lassoSelect(doc, libById, box, false).has(wire.uuid!)).toBe(true);
    expect(lassoSelect(doc, libById, box, true).has(wire.uuid!)).toBe(false);

    // …and one drawn round the whole wire is taken by both.
    const around = [at(-10, 10), at(60, 10), at(60, 40), at(-10, 40)];
    expect(lassoSelect(doc, libById, around, false).has(wire.uuid!)).toBe(true);
    expect(lassoSelect(doc, libById, around, true).has(wire.uuid!)).toBe(true);
  });

  it('the winding a lasso is drawn with is the mode it selects in', () => {
    // The two halves that had drifted: `lassoIsInside` coloured the band and
    // nothing fed it to the selection. Clockwise in KiCad's y-down world is a
    // positive signed area, and that is the window select.
    const wire = makeWire(at(0, 25), at(50, 25));
    const doc = addItems({ lines: [wire] }).apply(EMPTY());
    const cw = [at(20, 20), at(30, 20), at(30, 30), at(20, 30)];
    const ccw = [...cw].reverse();

    expect(lassoIsInside(cw)).toBe(true);
    expect(lassoIsInside(ccw)).toBe(false);
    expect(lassoSelect(doc, libById, cw, lassoIsInside(cw)).has(wire.uuid!)).toBe(false);
    expect(lassoSelect(doc, libById, ccw, lassoIsInside(ccw)).has(wire.uuid!)).toBe(true);
  });
});
