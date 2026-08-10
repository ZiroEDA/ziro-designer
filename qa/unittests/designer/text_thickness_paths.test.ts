// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `(font (thickness …))` reaching every draw path that upstream gives one.
 *
 * `SCH_PAINTER::getTextThickness` enumerates exactly which items get their own
 * `GetEffectiveTextPenWidth`:
 *
 *     case SCH_FIELD_T:                       … SCH_FIELD
 *     case SCH_TEXT_T:                        … SCH_TEXT
 *     case SCH_LABEL_T: … SCH_SHEET_PIN_T:    … SCH_LABEL_BASE
 *     case SCH_TEXTBOX_T: case SCH_TABLECELL_T: … SCH_TEXTBOX
 *
 * and pins are deliberately **not** in that list — their text comes from the
 * pin's own attributes, so threading a `TextEffects` pen into them would be
 * inventing behaviour rather than porting it.
 *
 * #507 wired the label painter. This is the sweep for the rest, and it is a
 * sweep on purpose: one behaviour with an independent walk per item kind is the
 * shape #354/#356/#358/#359 all had, and doing the call sites one at a time as
 * they are noticed is how the label path ended up being the only one that
 * worked.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  renderSchematic,
  DEFAULT_RENDER_OPTS,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';

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

/** Every `lineWidth` the render set, in order. */
function lineWidths(doc: Schematic): number[] {
  const widths: number[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'canvas') return { width: 900, height: 700 };
        if (prop === 'strokeStyle' || prop === 'fillStyle') return '#000';
        return () => {};
      },
      set(_t, prop, value) {
        if (prop === 'lineWidth' && typeof value === 'number') widths.push(value);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  renderSchematic(
    ctx,
    doc,
    { scale: 0.002, offsetX: 0, offsetY: 0 },
    KICAD_DEFAULT,
    2000,
    2000,
    new Set(),
    undefined,
    {
      ...DEFAULT_RENDER_OPTS,
      showPageLimits: false,
      showDrawingSheet: false,
    },
  );
  return widths;
}

/** A distinctive pen no default or bold rule would produce. */
const PEN = mmToIU(0.9);

const withThickness = (thick: boolean): Schematic => {
  const t = thick ? ' (thickness 0.9)' : '';
  return readSchematic(
    parse(`(kicad_sch (version 20250114) (generator "test") (paper "A4") (lib_symbols)
      (text "free" (at 10 10 0) (effects (font (size 1.27 1.27)${t})) (uuid "t1"))
      (text_box "boxed" (at 10 30 0) (size 20 10)
        (stroke (width 0) (type solid)) (fill (type none))
        (effects (font (size 1.27 1.27)${t}) (justify left top)) (uuid "tb1"))
      (sheet (at 60 10) (size 20 12) (stroke (width 0) (type solid)) (fill (color 0 0 0 0.0))
        (uuid "sh1")
        (property "Sheetname" "sub" (at 60 9 0) (effects (font (size 1.27 1.27)${t})))
        (property "Sheetfile" "sub.kicad_sch" (at 60 23 0) (effects (font (size 1.27 1.27)${t}))))
      (netclass_flag "HV" (length 2.54) (shape round) (at 60 40 0)
        (effects (font (size 1.27 1.27)) (justify left)) (uuid "d1")
        (property "Netclass" "HV" (at 60 40 0) (effects (font (size 1.27 1.27)${t})))))`),
  );
};

describe('an explicit pen reaches the draw paths upstream gives one to', () => {
  it('is used, and is not something the default or bold rule could produce', () => {
    // The guard has to be a value no other rule yields, or "it drew at 0.9 mm"
    // proves nothing.
    const off = lineWidths(withThickness(false));
    expect(off).not.toContain(PEN);

    const on = lineWidths(withThickness(true));
    expect(on).toContain(PEN);
  });

  it('and reaches more than one of them', () => {
    // Free text, a text box, two sheet fields and a directive-label field all
    // carry it in this fixture. If only the label painter honoured it — the
    // state before this change — exactly one path would use the pen.
    const on = lineWidths(withThickness(true));
    expect(on.filter((w) => w === PEN).length).toBeGreaterThan(1);
  });
});
