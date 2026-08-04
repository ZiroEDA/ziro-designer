// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The selection halo (designer/src/editors/schematic/render/renderer.ts
 * drawSelectionShadows), against SCH_PAINTER drawing selected items on
 * LAYER_SELECTION_SHADOWS at getShadowWidth() extra width.
 *
 * The completeness guard here is the point. Six item kinds could be selected
 * and drew **no halo at all** — a text box, a table, an image, a graphic shape,
 * a bus entry and a directive label. Clicking one updated the properties panel
 * and Delete removed it, but nothing on screen said it was picked. A selection
 * you cannot see is the quietest kind of broken, and no per-feature test can
 * see it either: every one of those kinds *drew*, it just never glowed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { refId } from '@ziroeda/eeschema/src/tools/hittest.js';
import {
  renderSchematic,
  DEFAULT_RENDER_OPTS,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

interface Call {
  op: string;
  args: unknown[];
}

/** Path2D stand-in: node has none, and the grid path is not what we assert on. */
class FakePath2D {
  rect(): void {}
  moveTo(): void {}
  lineTo(): void {}
}

const origPath2D = globalThis.Path2D;
beforeAll(() => {
  (globalThis as { Path2D?: unknown }).Path2D = FakePath2D;
});
afterAll(() => {
  (globalThis as { Path2D?: unknown }).Path2D = origPath2D;
});

/** A 2D context stand-in recording every method call and property set. */
function recorder(): CanvasRenderingContext2D & { __calls: Call[] } {
  const calls: Call[] = [];
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === '__calls') return calls;
        if (prop === 'strokeStyle' || prop === 'fillStyle') {
          const last = [...calls].reverse().find((c) => c.op === `set:${String(prop)}`);
          return last?.args[0];
        }
        if (prop === 'canvas') return { width: 800, height: 600 };
        return (...args: unknown[]) => calls.push({ op: String(prop), args });
      },
      set(_t, prop, value) {
        calls.push({ op: `set:${String(prop)}`, args: [value] });
        return true;
      },
    },
  ) as CanvasRenderingContext2D & { __calls: Call[] };
}

/** One of every kind that can be selected, spread out so nothing overlaps. */
const SCH = `(kicad_sch (version 20250114) (generator "test") (paper "A4")
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
      (property "Value" "R" (at 0 -2 0) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1"
        (rectangle (start -1.02 2.54) (end 1.02 -2.54)
          (stroke (width 0.254) (type default)) (fill (type none)))
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1")))))
  (symbol (lib_id "Device:R") (at 10 10 0) (unit 1) (uuid "r1")
    (property "Reference" "R1" (at 12 9 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 12 11 0) (effects (font (size 1.27 1.27)))))
  (wire (pts (xy 30 10) (xy 40 10)) (uuid "w1"))
  (junction (at 50 10) (uuid "j1"))
  (no_connect (at 60 10) (uuid "nc1"))
  (label "CLK" (at 70 10 0) (effects (font (size 1.27 1.27))) (uuid "l1"))
  (bus_entry (at 80 10) (size 2.54 2.54) (stroke (width 0) (type default)) (uuid "be1"))
  (text_box "note" (at 10 30 0) (size 10 6)
    (stroke (width 0) (type solid)) (fill (type none))
    (effects (font (size 1.27 1.27)) (justify left top)) (uuid "tb1"))
  (rectangle (start 30 30) (end 40 36)
    (stroke (width 0.254) (type default)) (fill (type none)) (uuid "g1"))
  (netclass_flag "HV" (length 2.54) (shape round) (at 50 30 0)
    (effects (font (size 1.27 1.27)) (justify left)) (uuid "d1")
    (property "Netclass" "HV" (at 50 30 0) (effects (font (size 1.27 1.27)))))
  (table (column_count 1) (border (external yes) (header no))
    (separators (rows no) (cols no))
    (column_widths 10) (row_heights 6)
    (cells
      (table_cell "c" (exclude_from_sim no) (at 70 30 0) (size 10 6)
        (fill (type none)) (effects (font (size 1.27 1.27)) (justify left top))
        (uuid "tc1"))))
  (sheet (at 90 30) (size 10 6) (stroke (width 0) (type solid))
    (fill (color 0 0 0 0.0)) (uuid "sh1")
    (property "Sheetname" "sub" (at 90 29 0) (effects (font (size 1.27 1.27))))
    (property "Sheetfile" "sub.kicad_sch" (at 90 37 0) (effects (font (size 1.27 1.27))))))`;

const doc = (): Schematic => readSchematic(parse(SCH));

/**
 * The calls made while the shadow colour was the active stroke or fill. A halo
 * is drawn by re-stroking the item's own geometry in that colour, so "did this
 * kind glow?" is "were any drawing calls issued under it?".
 */
function shadowCalls(selection: ReadonlySet<string>): Call[] {
  const ctx = recorder();
  renderSchematic(
    ctx,
    doc(),
    { scale: 0.002, offsetX: 0, offsetY: 0 },
    KICAD_DEFAULT,
    2000,
    2000,
    selection,
    undefined,
    { ...DEFAULT_RENDER_OPTS, showPageLimits: false, showDrawingSheet: false },
  );
  const shadow = KICAD_DEFAULT.selectionShadow;
  const out: Call[] = [];
  let active = false;
  for (const c of ctx.__calls) {
    if (c.op === 'set:strokeStyle' || c.op === 'set:fillStyle') {
      active = c.args[0] === shadow;
      continue;
    }
    if (active && ['stroke', 'fill', 'strokeRect', 'fillRect', 'arc', 'lineTo'].includes(c.op)) {
      out.push(c);
    }
  }
  return out;
}

describe('the halo reaches every selectable kind', () => {
  const d = doc();
  const cases: [string, string][] = [
    ['symbol', 'r1'],
    ['wire', 'w1'],
    ['junction', 'j1'],
    ['no-connect', 'nc1'],
    ['label', 'l1'],
    ['sheet', 'sh1'],
    // The six that drew nothing at all.
    ['bus entry', 'be1'],
    ['text box', 'tb1'],
    ['graphic', refId('graphic', undefined, 0)],
    ['directive label', 'd1'],
    ['table', refId('table', d.tables[0]!.uuid, 0)],
  ];

  for (const [name, id] of cases) {
    it(`draws a halo for a selected ${name}`, () => {
      expect(shadowCalls(new Set([id])).length, name).toBeGreaterThan(0);
    });
  }

  it('draws nothing in the shadow colour with an empty selection', () => {
    // The guard above would pass for a renderer that painted the whole sheet in
    // the shadow colour; this is what stops that reading.
    expect(shadowCalls(new Set())).toHaveLength(0);
  });
});
