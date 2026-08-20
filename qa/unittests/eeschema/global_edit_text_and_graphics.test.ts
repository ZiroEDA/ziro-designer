// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit Text & Graphics Properties, counterpart
 * dialog_global_edit_text_and_graphics.cpp: what each scope box visits, how the
 * filters narrow it, and the rule that an indeterminate action changes nothing.
 */
import { describe, it, expect } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr';
import { readSchematic, writeSchematic } from '@ziroeda/eeschema';
import {
  emptyScope,
  globalEdit,
  globalEditCommand,
  type GlobalEditScope,
} from '@ziroeda/eeschema/src/tools/global_edit_text_and_graphics.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

const SCH = `(kicad_sch (version 20231120) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R" (property "Reference" "R" (at 0 0 0)) (symbol "R_0_1"))
    (symbol "power:GND" (power) (property "Reference" "#PWR" (at 0 0 0)) (symbol "GND_0_1")))
  (junction (at 20 20) (diameter 0) (uuid "j0"))
  (wire (pts (xy 0 0) (xy 20 0)) (stroke (width 0) (type default)) (uuid "w0"))
  (bus (pts (xy 0 10) (xy 20 10)) (stroke (width 0) (type default)) (uuid "b0"))
  (polyline (pts (xy 0 30) (xy 20 30)) (stroke (width 0) (type default)) (uuid "g0"))
  (label "CLK" (at 5 0 0) (effects (font (size 1.27 1.27))) (uuid "l0"))
  (hierarchical_label "DIN" (at 5 5 0) (shape input) (effects (font (size 1.27 1.27))) (uuid "l1"))
  (global_label "VCC" (at 5 8 0) (shape input) (effects (font (size 1.27 1.27))) (uuid "l2"))
  (symbol (lib_id "Device:R") (at 30 30 0) (unit 1) (uuid "s0")
    (property "Reference" "R1" (at 30 28 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 30 32 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "R_0805" (at 30 34 0) (effects (font (size 1.27 1.27)) hide)))
  (symbol (lib_id "power:GND") (at 60 60 0) (unit 1) (uuid "s1")
    (property "Reference" "#PWR01" (at 60 58 0) (effects (font (size 1.27 1.27))))
    (property "Value" "GND" (at 60 62 0) (effects (font (size 1.27 1.27)))))
  (sheet (at 80 80) (size 20 20) (stroke (width 0) (type solid)) (fill (color 0 0 0 0.0))
    (uuid "sh0")
    (property "Sheetname" "Child" (at 80 79 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "child.kicad_sch" (at 80 101 0) (effects (font (size 1.27 1.27))))
    (pin "DIN" input (at 80 85 180) (effects (font (size 1.27 1.27))) (uuid "sp0"))))`;

const doc = (): Schematic => readSchematic(parse(SCH));
const scope = (over: Partial<GlobalEditScope>): GlobalEditScope => ({ ...emptyScope(), ...over });
const SIZE = mmToIU(2);
const sizeOf = (fx: { fontSize?: readonly [number, number] } | undefined): number | undefined =>
  fx?.fontSize?.[0];
const field = (d: Schematic, si: number, key: string) =>
  d.symbols[si]!.fields.find((f) => f.key === key);

describe('scope', () => {
  it('changes only the references when only References is ticked', () => {
    const d = globalEdit(doc(), new Map(), {
      scope: scope({ references: true }),
      action: { textSizeIU: SIZE },
    });
    expect(sizeOf(field(d, 0, 'Reference')?.effects)).toBe(SIZE);
    expect(sizeOf(field(d, 0, 'Value')?.effects)).toBe(mmToIU(1.27));
  });

  it('treats other fields as everything that is not Reference or Value', () => {
    const d = globalEdit(doc(), new Map(), {
      scope: scope({ otherFields: true }),
      action: { textSizeIU: SIZE },
    });
    expect(sizeOf(field(d, 0, 'Footprint')?.effects)).toBe(SIZE);
    expect(sizeOf(field(d, 0, 'Reference')?.effects)).toBe(mmToIU(1.27));
  });

  it('separates wires from buses', () => {
    const d = globalEdit(doc(), new Map(), {
      scope: scope({ wires: true }),
      action: { lineWidthIU: mmToIU(0.3) },
    });
    expect(d.lines[0]!.stroke?.width).toBe(mmToIU(0.3));
    expect(d.lines[1]!.stroke?.width).toBe(0);
  });

  it('counts a plain label as a wire label and a bus label as a bus one', () => {
    const withBusLabel = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols)
        (label "CLK" (at 0 0 0) (effects (font (size 1.27 1.27))) (uuid "l0"))
        (label "D[7..0]" (at 0 5 0) (effects (font (size 1.27 1.27))) (uuid "l1")))`),
    );
    const wires = globalEdit(withBusLabel, new Map(), {
      scope: scope({ wires: true }),
      action: { textSizeIU: SIZE },
    });
    expect(sizeOf(wires.labels[0]!.effects)).toBe(SIZE);
    expect(sizeOf(wires.labels[1]!.effects)).toBe(mmToIU(1.27));
  });

  it('picks out global and hierarchical labels by kind', () => {
    const d = globalEdit(doc(), new Map(), {
      scope: scope({ globalLabels: true }),
      action: { textSizeIU: SIZE },
    });
    expect(sizeOf(d.labels.find((l) => l.text === 'VCC')?.effects)).toBe(SIZE);
    expect(sizeOf(d.labels.find((l) => l.text === 'DIN')?.effects)).toBe(mmToIU(1.27));
  });

  it('gives the sheet border the line controls and the background the fill', () => {
    const d = globalEdit(doc(), new Map(), {
      scope: scope({ sheetBorders: true }),
      action: { lineWidthIU: mmToIU(0.4), fillColor: [1, 2, 3, 1] },
    });
    expect(d.sheets[0]!.stroke?.width).toBe(mmToIU(0.4));
    expect(d.sheets[0]!.fillColor).toEqual([1, 2, 3, 1]);
  });

  it('reaches sheet pins and sheet fields separately', () => {
    const pins = globalEdit(doc(), new Map(), {
      scope: scope({ sheetPins: true }),
      action: { textSizeIU: SIZE },
    });
    expect(sizeOf(pins.sheets[0]!.pins[0]!.effects)).toBe(SIZE);
    expect(sizeOf(pins.sheets[0]!.fields[0]!.effects)).toBe(mmToIU(1.27));

    const titles = globalEdit(doc(), new Map(), {
      scope: scope({ sheetTitles: true }),
      action: { textSizeIU: SIZE },
    });
    expect(sizeOf(titles.sheets[0]!.fields.find((f) => f.key === 'Sheetname')?.effects)).toBe(SIZE);
    expect(sizeOf(titles.sheets[0]!.fields.find((f) => f.key === 'Sheetfile')?.effects)).toBe(
      mmToIU(1.27),
    );
  });

  it('takes notes lines under schematic text and graphics, not under wires', () => {
    const d = globalEdit(doc(), new Map(), {
      scope: scope({ schTextAndGraphics: true }),
      action: { lineWidthIU: mmToIU(0.5) },
    });
    expect(d.lines[2]!.stroke?.width).toBe(mmToIU(0.5));
    expect(d.lines[0]!.stroke?.width).toBe(0);
  });

  it('leaves the document untouched when nothing is in scope', () => {
    const before = doc();
    expect(
      globalEdit(before, new Map(), { scope: emptyScope(), action: { textSizeIU: SIZE } }),
    ).toBe(before);
  });
});

describe('action', () => {
  it('leaves alone everything the action does not mention', () => {
    const before = doc();
    const d = globalEdit(before, new Map(), {
      scope: scope({ references: true, values: true }),
      action: { italic: true },
    });
    // Italic set, size and bold untouched — the whole point of the
    // indeterminate state.
    const ref = field(d, 0, 'Reference');
    expect(ref?.effects?.italic).toBe(true);
    expect(sizeOf(ref?.effects)).toBe(mmToIU(1.27));
    expect(ref?.effects?.bold).toBeUndefined();
  });

  it('turns a fill off when the fill colour is unspecified', () => {
    // Upstream: an UNSPECIFIED fill colour is FILL_T::NO_FILL, not a colourless
    // fill.
    const filled = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols)
        (rectangle (start 0 0) (end 10 10) (stroke (width 0) (type default))
          (fill (type color) (color 1 2 3 1)) (uuid "g0")))`),
    );
    const d = globalEdit(filled, new Map(), {
      scope: scope({ schTextAndGraphics: true }),
      action: { fillColor: null },
    });
    const rect = d.graphics[0]!;
    expect(rect.kind === 'text' ? undefined : rect.fill?.type).toBe('none');
  });

  it('sets a junction diameter and colour through the wire scope', () => {
    const d = globalEdit(doc(), new Map(), {
      scope: scope({ wires: true }),
      action: { junctionSizeIU: mmToIU(1), junctionColor: [9, 9, 9, 1] },
    });
    expect(d.junctions[0]!.diameter).toBe(mmToIU(1));
    expect(d.junctions[0]!.color).toEqual([9, 9, 9, 1]);
  });

  it('makes a field visible or hidden', () => {
    const d = globalEdit(doc(), new Map(), {
      scope: scope({ otherFields: true }),
      action: { visible: true },
    });
    expect(field(d, 0, 'Footprint')?.effects?.hidden).toBe(false);
  });

  it('turns a label to a spin style, which is an angle in our model', () => {
    const d = globalEdit(doc(), new Map(), {
      scope: scope({ globalLabels: true }),
      action: { orientation: 2 },
    });
    expect(d.labels.find((l) => l.text === 'VCC')?.angle).toBe(180);
  });
});

describe('filters', () => {
  it('narrows by parent reference designator', () => {
    const d = globalEdit(doc(), new Map(), {
      scope: scope({ values: true }),
      filters: { reference: 'R*' },
      action: { textSizeIU: SIZE },
    });
    expect(sizeOf(field(d, 0, 'Value')?.effects)).toBe(SIZE);
    expect(sizeOf(field(d, 1, 'Value')?.effects)).toBe(mmToIU(1.27));
  });

  it('narrows by parent symbol type', () => {
    const libs = new Map(doc().libSymbols.map((l) => [l.libId, l]));
    const d = globalEdit(doc(), libs, {
      scope: scope({ values: true }),
      filters: { symbolType: 'power' },
      action: { textSizeIU: SIZE },
    });
    expect(sizeOf(field(d, 1, 'Value')?.effects)).toBe(SIZE);
    expect(sizeOf(field(d, 0, 'Value')?.effects)).toBe(mmToIU(1.27));
  });

  it('narrows by field name, which only applies to other fields', () => {
    const d = globalEdit(doc(), new Map(), {
      scope: scope({ otherFields: true, values: true }),
      filters: { fieldName: 'Foot*' },
      action: { textSizeIU: SIZE },
    });
    expect(sizeOf(field(d, 0, 'Footprint')?.effects)).toBe(SIZE);
    // Values are in scope in their own right and the name filter does not touch
    // them, exactly as visitItem is written.
    expect(sizeOf(field(d, 0, 'Value')?.effects)).toBe(SIZE);
  });

  it('takes a field along when its parent symbol is the selected item', () => {
    const d = globalEdit(doc(), new Map(), {
      scope: scope({ references: true }),
      filters: { selected: new Set(['s0']) },
      action: { textSizeIU: SIZE },
    });
    expect(sizeOf(field(d, 0, 'Reference')?.effects)).toBe(SIZE);
    expect(sizeOf(field(d, 1, 'Reference')?.effects)).toBe(mmToIU(1.27));
  });

  it('matches nothing when a net filter is set with no netlist to resolve it', () => {
    const before = doc();
    expect(
      globalEdit(before, new Map(), {
        scope: scope({ wires: true }),
        filters: { net: 'CLK' },
        action: { lineWidthIU: mmToIU(0.3) },
      }),
    ).toBe(before);
  });

  it('keeps only the items on the named net', () => {
    const d = globalEdit(doc(), new Map(), {
      scope: scope({ wires: true }),
      filters: { net: 'CLK' },
      netOfItem: (id) => (id === 'w0' ? 'CLK' : 'GND'),
      action: { lineWidthIU: mmToIU(0.3) },
    });
    expect(d.lines[0]!.stroke?.width).toBe(mmToIU(0.3));
    expect(d.junctions[0]!.diameter).toBe(0);
  });
});

describe('the command and the writer', () => {
  it('is null when the sweep matched nothing', () => {
    expect(
      globalEditCommand(doc(), new Map(), { scope: emptyScope(), action: { textSizeIU: SIZE } }),
    ).toBeNull();
  });

  it('round-trips every property it can set', () => {
    const cmd = globalEditCommand(doc(), new Map(), {
      scope: scope({
        references: true,
        wires: true,
        sheetBorders: true,
        sheetPins: true,
        schTextAndGraphics: true,
      }),
      action: {
        textSizeIU: SIZE,
        bold: true,
        lineWidthIU: mmToIU(0.3),
        junctionSizeIU: mmToIU(1),
      },
    })!;
    const after = cmd.apply(doc());
    const text = serialize(writeSchematic(after));
    const reread = readSchematic(parse(text));
    expect(sizeOf(field(reread, 0, 'Reference')?.effects)).toBe(SIZE);
    expect(field(reread, 0, 'Reference')?.effects?.bold).toBe(true);
    expect(reread.lines[0]!.stroke?.width).toBe(mmToIU(0.3));
    expect(reread.junctions[0]!.diameter).toBe(mmToIU(1));
    expect(reread.sheets[0]!.stroke?.width).toBe(mmToIU(0.3));
    expect(sizeOf(reread.sheets[0]!.pins[0]!.effects)).toBe(SIZE);
  });

  it('undoes cleanly', () => {
    const before = doc();
    const cmd = globalEditCommand(before, new Map(), {
      scope: scope({ references: true }),
      action: { textSizeIU: SIZE },
    })!;
    const after = cmd.apply(before);
    expect(cmd.invert(before).apply(after)).toEqual(before);
  });
});
