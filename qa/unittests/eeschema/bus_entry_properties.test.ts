// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A bus entry's stroke is editable, counterpart SCH_EDIT_TOOL::Properties,
 * which groups SCH_BUS_WIRE_ENTRY_T with SCH_LINE_T and SCH_JUNCTION_T so an
 * entry opens the same DIALOG_WIRE_BUS_PROPERTIES a wire does.
 *
 * The writer half is the point: writeBusEntry patched `at` and `size` but never
 * `(stroke ...)`, so an edit would have been lost on save. That is the seventh
 * instance of the same shape the writer audit found, and it was latent only
 * because nothing could edit an entry yet.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { replaceBusEntry } from '@ziroeda/eeschema/src/tools/mutate.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const sheet = (body: string): Schematic =>
  readSchematic(parse(`(kicad_sch (version 20250114)\n${body}\n)`));

/** An entry whose node already carries a stroke child. */
const withStroke = (): Schematic =>
  sheet(`(bus_entry (at 10 10) (size 2.54 2.54)
     (stroke (width 0) (type default)) (uuid "be-1"))`);

/** An entry whose node has no stroke child at all — the harder case. */
const withoutStroke = (): Schematic =>
  sheet(`(bus_entry (at 10 10) (size 2.54 2.54) (uuid "be-2"))`);

describe('replaceBusEntry', () => {
  it('swaps the entry and leaves its neighbours alone', () => {
    const d = sheet(
      [
        `(bus_entry (at 10 10) (size 2.54 2.54) (uuid "be-1"))`,
        `(bus_entry (at 20 20) (size 2.54 2.54) (uuid "be-2"))`,
      ].join('\n'),
    );
    const next = { ...d.busEntries[0]!, stroke: { width: mmToIU(0.5), type: 'solid' } };
    const after = replaceBusEntry(0, next).apply(d);
    expect(after.busEntries[0]!.stroke?.width).toBe(mmToIU(0.5));
    expect(after.busEntries[1]!.uuid).toBe('be-2');
    expect(after.busEntries[1]!.stroke?.width).toBeUndefined();
  });

  it('undoes exactly', () => {
    const d = withStroke();
    const next = { ...d.busEntries[0]!, stroke: { width: mmToIU(0.5), type: 'solid' } };
    const cmd = replaceBusEntry(0, next);
    const back = cmd.invert(d).apply(cmd.apply(d));
    expect(back.busEntries[0]!.stroke).toEqual(d.busEntries[0]!.stroke);
  });

  it('redoes — invert(before).invert(after) reproduces the edit', () => {
    const d = withStroke();
    const next = { ...d.busEntries[0]!, stroke: { width: mmToIU(0.5), type: 'solid' } };
    const cmd = replaceBusEntry(0, next);
    const after = cmd.apply(d);
    const undo = cmd.invert(d);
    const redo = undo.invert(after);
    expect(redo.apply(undo.apply(after)).busEntries[0]!.stroke?.width).toBe(mmToIU(0.5));
  });
});

describe('the stroke reaches the file', () => {
  it('patches a node that already has a stroke child', () => {
    const d = withStroke();
    const next = { ...d.busEntries[0]!, stroke: { width: mmToIU(0.5), type: 'dash' } };
    const text = serializeSchematic(replaceBusEntry(0, next).apply(d));
    expect(text).toContain('(type dash)');
    expect(text).not.toContain('(type default)');
  });

  it('adds one to a node that has none', () => {
    // The failure mode the writer audit named: patching only when the source
    // already had the child, so an edit to an absent field vanishes.
    const d = withoutStroke();
    expect(d.busEntries[0]!.stroke?.type).toBeUndefined();
    const next = { ...d.busEntries[0]!, stroke: { width: mmToIU(0.5), type: 'dot' } };
    const text = serializeSchematic(replaceBusEntry(0, next).apply(d));
    expect(text).toContain('(type dot)');
  });

  it('survives a round trip back through the reader', () => {
    const d = withoutStroke();
    const next = { ...d.busEntries[0]!, stroke: { width: mmToIU(0.5), type: 'dot' } };
    const reloaded = readSchematic(parse(serializeSchematic(replaceBusEntry(0, next).apply(d))));
    expect(reloaded.busEntries[0]!.stroke?.type).toBe('dot');
    expect(reloaded.busEntries[0]!.stroke?.width).toBe(mmToIU(0.5));
  });

  it('leaves an untouched entry byte-stable', () => {
    const d = withStroke();
    const before = serializeSchematic(d);
    // Identity replace: nothing changed, nothing should move.
    expect(serializeSchematic(replaceBusEntry(0, { ...d.busEntries[0]! }).apply(d))).toBe(before);
  });

  it('keeps the position and size the patch already handled', () => {
    const d = withStroke();
    const next = { ...d.busEntries[0]!, stroke: { width: mmToIU(0.5), type: 'solid' } };
    const reloaded = readSchematic(parse(serializeSchematic(replaceBusEntry(0, next).apply(d))));
    expect(reloaded.busEntries[0]!.at).toEqual(d.busEntries[0]!.at);
    expect(reloaded.busEntries[0]!.size).toEqual(d.busEntries[0]!.size);
  });
});
