// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Editing wire/bus stroke (DIALOG_WIRE_BUS_PROPERTIES) and junction diameter
 * (DIALOG_JUNCTION_PROPS): replaceLine / replaceJunction with the lossless
 * writer patches for `(stroke …)` and `(diameter …)`.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { replaceLine, replaceJunction } from '@ziroeda/eeschema/src/tools/mutate.js';
import { mmToIU, iuToMM } from '@ziroeda/common/src/eda_units.js';

const SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (wire (pts (xy 50 50) (xy 80 50)) (stroke (width 0) (type default)) (uuid "w-1"))
  (junction (at 80 50) (diameter 0) (uuid "j-1"))
)`;
const load = () => readSchematic(parse(SCH));

describe('wire stroke edit', () => {
  it('sets width and style and round-trips', () => {
    const doc = load();
    const orig = doc.lines[0]!;
    const after = replaceLine(0, {
      ...orig,
      stroke: { width: mmToIU(0.25), type: 'dash' },
    }).apply(doc);
    expect(iuToMM(after.lines[0]!.stroke!.width)).toBeCloseTo(0.25);
    expect(after.lines[0]!.stroke!.type).toBe('dash');
    const text = serializeSchematic(after);
    expect(text).toContain('(width 0.25)');
    expect(text).toContain('(type dash)');
  });

  it('is undoable', () => {
    const doc = load();
    const cmd = replaceLine(0, { ...doc.lines[0]!, stroke: { width: mmToIU(0.5), type: 'solid' } });
    const after = cmd.apply(doc);
    const undone = cmd.invert(doc).apply(after);
    expect(undone.lines[0]!.stroke!.width).toBe(0);
    expect(undone.lines[0]!.stroke!.type).toBe('default');
  });
});

describe('junction diameter edit', () => {
  it('sets the diameter and round-trips', () => {
    const doc = load();
    const after = replaceJunction(0, { ...doc.junctions[0]!, diameter: mmToIU(0.9) }).apply(doc);
    expect(iuToMM(after.junctions[0]!.diameter)).toBeCloseTo(0.9);
    expect(serializeSchematic(after)).toContain('(diameter 0.9)');
  });
});

// DIALOG_WIRE_BUS_PROPERTIES / DIALOG_JUNCTION_PROPS colour swatch: an explicit
// (color r g b a) writes and reads back losslessly.
describe('stroke and junction colour', () => {
  it('writes a wire stroke colour and reads it back', () => {
    const doc = load();
    const after = replaceLine(0, {
      ...doc.lines[0]!,
      stroke: { width: 0, type: 'default', color: [255, 0, 0, 1] },
    }).apply(doc);
    expect(serializeSchematic(after)).toContain('(color 255 0 0 1)');
    const reread = readSchematic(parse(serializeSchematic(after)));
    expect(reread.lines[0]!.stroke!.color).toEqual([255, 0, 0, 1]);
  });

  it('clears a wire stroke colour back to (0 0 0 0)', () => {
    const withColor = readSchematic(
      parse(`(kicad_sch (version 20231120) (generator "test")
        (wire (pts (xy 50 50) (xy 80 50)) (stroke (width 0) (type default) (color 1 2 3 1)) (uuid "w-1")))`),
    );
    expect(withColor.lines[0]!.stroke!.color).toEqual([1, 2, 3, 1]);
    const cleared = replaceLine(0, {
      ...withColor.lines[0]!,
      stroke: { width: 0, type: 'default' },
    }).apply(withColor);
    const reread = readSchematic(parse(serializeSchematic(cleared)));
    expect(reread.lines[0]!.stroke!.color).toBeUndefined();
  });

  it('writes a junction colour and reads it back', () => {
    const doc = load();
    const after = replaceJunction(0, {
      ...doc.junctions[0]!,
      color: [0, 128, 255, 1],
    }).apply(doc);
    expect(serializeSchematic(after)).toContain('(color 0 128 255 1)');
    const reread = readSchematic(parse(serializeSchematic(after)));
    expect(reread.junctions[0]!.color).toEqual([0, 128, 255, 1]);
  });
});
