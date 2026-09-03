// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Draw selected child items" — `m_Selection.draw_selected_children`
 * (`eeschema_settings.cpp:438-439`), default TRUE.
 *
 * Selecting a symbol lights its reference and value too, and selecting a sheet
 * lights its fields and pins. `SCH_SELECTION_TOOL::highlight()` walks the item's
 * children and marks each SELECTED; this flag decides whether the painter then
 * gives them a halo. Three sites, all inside the shadow pass:
 *
 *     if( drawingShadows && !…draw_selected_children ) return;   // a PIN's name
 *                                                               // and number (:1131)
 *     if( !drawingShadows || …draw_selected_children )           // a SYMBOL's fields (:2702)
 *     if( !drawingShadows || …draw_selected_children )           // a SHEET's fields
 *                                                               // and pins (:3102)
 *
 * The asymmetry in the second and third is the whole behaviour: `!drawingShadows
 * ||` means the children are always drawn NORMALLY and the flag governs only
 * their HALO. Off, a selected symbol glows on its body and pin lines alone and
 * its text stays perfectly visible — it is not a "hide the fields" option, and a
 * port that read it as one would make the setting destructive.
 *
 * The counting is deliberately relative: the shadow pass runs inside a whole
 * document render, so an absolute number of strokes would pin every other
 * painter in the file as well. What matters is that turning the flag off
 * REMOVES strokes and turning it on adds them back, with the parent's own halo
 * unchanged either way.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import {
  DEFAULT_RENDER_OPTS,
  renderSchematic,
  setVectorText,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import { EESCHEMA_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';

function spy(): { strokes: number; fills: number; ctx: CanvasRenderingContext2D } {
  const n = { strokes: 0, fills: 0 };
  const noop = (): void => {};
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    setTransform: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    arc: noop,
    bezierCurveTo: noop,
    clip: noop,
    drawImage: noop,
    fillText: noop,
    strokeRect: () => {
      n.strokes++;
    },
    fillRect: () => {
      n.fills++;
    },
    fill: () => {
      n.fills++;
    },
    stroke: () => {
      n.strokes++;
    },
  };
  return {
    get strokes() {
      return n.strokes;
    },
    get fills() {
      return n.fills;
    },
    ctx: ctx as unknown as CanvasRenderingContext2D,
  } as unknown as { strokes: number; fills: number; ctx: CanvasRenderingContext2D };
}

/**
 * FOUR documents, one per site, and that is the point.
 *
 * My first version used a single document holding all of them and asserted
 * "fewer strokes with the flag off". Every one of the four gates could then be
 * deleted on its own and the test still passed, because the other three kept
 * the inequality true. A coarse aggregate cannot localise: it says the feature
 * exists somewhere, which is not what a per-site guard needs pinned.
 *
 * Each document below contains exactly ONE kind of selectable child, so each
 * assertion answers for exactly one `if` in the painter.
 */
const LIB = (pinName: string, pinNumber: string): string => `(lib_symbols
      (symbol "L:R" (pin_names (offset 1.016)) (in_bom yes) (on_board yes)
        (property "Reference" "R" (at 2 0 90))
        (property "Value" "R" (at 0 0 90))
        (symbol "R_0_1"
          (rectangle (start -1 2.54) (end 1 -2.54)
            (stroke (width 0.254) (type default)) (fill (type none))))
        (symbol "R_1_1"
          (pin passive line (at 0 3.81 270) (length 1.27)
            (name "${pinName}" (effects (font (size 1.27 1.27))))
            (number "${pinNumber}" (effects (font (size 1.27 1.27))))))))`;

const SYM_UUID = '11111111-1111-1111-1111-111111111111';
const SHEET_UUID = '22222222-2222-2222-2222-222222222222';

/** A symbol whose PIN has a name and a number, and whose fields are hidden. */
const DOC_PIN_LABELS = readSchematic(
  parse(`(kicad_sch (version 20250114) ${LIB('A', '1')}
    (symbol (lib_id "L:R") (at 50 50 0) (unit 1) (uuid "${SYM_UUID}")
      (property "Reference" "R1" (at 53 48 0)
        (effects (font (size 1.27 1.27)) (hide yes)))
      (property "Value" "10k" (at 53 52 0)
        (effects (font (size 1.27 1.27)) (hide yes)))))`),
);

/** A symbol with VISIBLE fields, whose pin has neither name nor number. */
const DOC_SYM_FIELDS = readSchematic(
  parse(`(kicad_sch (version 20250114) ${LIB('~', '~')}
    (symbol (lib_id "L:R") (at 50 50 0) (unit 1) (uuid "${SYM_UUID}")
      (property "Reference" "R1" (at 53 48 0) (effects (font (size 1.27 1.27))))
      (property "Value" "10k" (at 53 52 0) (effects (font (size 1.27 1.27)))))) `),
);

/** A sheet with two visible fields and NO pins. */
const DOC_SHEET_FIELDS = readSchematic(
  parse(`(kicad_sch (version 20250114) (lib_symbols)
    (sheet (at 100 100) (size 30 20)
      (stroke (width 0.1524) (type solid)) (fill (color 0 0 0 0.0))
      (uuid "${SHEET_UUID}")
      (property "Sheetname" "sub" (at 100 99 0) (effects (font (size 1.27 1.27))))
      (property "Sheetfile" "sub.kicad_sch" (at 100 121 0)
        (effects (font (size 1.27 1.27))))))`),
);

/** A sheet with a PIN and both fields hidden. */
const DOC_SHEET_PINS = readSchematic(
  parse(`(kicad_sch (version 20250114) (lib_symbols)
    (sheet (at 100 100) (size 30 20)
      (stroke (width 0.1524) (type solid)) (fill (color 0 0 0 0.0))
      (uuid "${SHEET_UUID}")
      (property "Sheetname" "sub" (at 100 99 0)
        (effects (font (size 1.27 1.27)) (hide yes)))
      (property "Sheetfile" "sub.kicad_sch" (at 100 121 0)
        (effects (font (size 1.27 1.27)) (hide yes)))
      (pin "IN" input (at 100 105 180)
        (effects (font (size 1.27 1.27)) (justify right))
        (uuid "33333333-3333-3333-3333-333333333333"))))`),
);

const paint = (
  doc: ReturnType<typeof readSchematic>,
  drawSelectedChildren: boolean,
  sel: string[],
): number => {
  const s = spy();
  setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      doc,
      { scale: 0.0005, offsetX: 0, offsetY: 0 },
      KICAD_DEFAULT,
      900,
      600,
      new Set(sel),
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        drawSelectedChildren,
        showDrawingSheet: false,
        showPageLimits: false,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
      },
    );
  } finally {
    setVectorText(false);
  }
  return s.strokes;
};

// `refId` returns the BARE uuid when an item has one —
// `return uuid ?? `${kind}:idx:${index}`` (`eeschema/src/tools/hittest.ts:314-316`)
// — so a selection id is not prefixed. Writing `symbol:<uuid>` matched nothing
// and every count came out equal, which is what an id typo looks like rather
// than a bug in the code under test.

describe('each of the painter’s four child guards, on its own', () => {
  it('a pin’s name and number (sch_painter.cpp:1131)', () => {
    expect(paint(DOC_PIN_LABELS, false, [SYM_UUID])).toBeLessThan(
      paint(DOC_PIN_LABELS, true, [SYM_UUID]),
    );
  });

  it('a symbol’s fields (:2702)', () => {
    expect(paint(DOC_SYM_FIELDS, false, [SYM_UUID])).toBeLessThan(
      paint(DOC_SYM_FIELDS, true, [SYM_UUID]),
    );
  });

  it('a sheet’s fields (:3102)', () => {
    expect(paint(DOC_SHEET_FIELDS, false, [SHEET_UUID])).toBeLessThan(
      paint(DOC_SHEET_FIELDS, true, [SHEET_UUID]),
    );
  });

  it('a sheet’s pins (:3102, the same guard)', () => {
    expect(paint(DOC_SHEET_PINS, false, [SHEET_UUID])).toBeLessThan(
      paint(DOC_SHEET_PINS, true, [SHEET_UUID]),
    );
  });
});

describe('what the flag must NOT do', () => {
  it('changes nothing when nothing is selected', () => {
    // All four sites are guarded by `drawingShadows`, so with no selection
    // there is no shadow pass for the flag to reach. A setting that moved this
    // would be reaching into the NORMAL pass — the "hide the fields"
    // misreading, which would make the option destructive.
    for (const doc of [DOC_PIN_LABELS, DOC_SYM_FIELDS, DOC_SHEET_FIELDS, DOC_SHEET_PINS])
      expect(paint(doc, false, [])).toBe(paint(doc, true, []));
  });

  it('leaves the parent’s own halo alone', () => {
    // Off, the symbol is still haloed — just less of it. Equality with the
    // unselected count would mean the flag had turned the whole shadow pass
    // off rather than its child half.
    expect(paint(DOC_SYM_FIELDS, false, [SYM_UUID])).toBeGreaterThan(
      paint(DOC_SYM_FIELDS, true, []),
    );
  });

  it('still haloes a child picked ON ITS OWN', () => {
    // `highlight()` marked THAT item; the flag is about a child glowing
    // because its PARENT was picked. Selecting the sheet pin alone must glow
    // whatever the flag says.
    // A sheet pin's id is NOT its uuid: `sheetPinId` is
    // `` `${sheetRefId}:sheetpin${index}` `` (`hittest.ts:44-45`). Three id
    // shapes live in this one area — a bare uuid, `${kind}:idx:${i}` for an
    // item without one, and this — and picking the wrong one produces a test
    // that passes its no-op case and nothing else.
    const pin = `${SHEET_UUID}:sheetpin0`;
    expect(paint(DOC_SHEET_PINS, false, [pin])).toBe(paint(DOC_SHEET_PINS, true, [pin]));
    expect(paint(DOC_SHEET_PINS, false, [pin])).toBeGreaterThan(paint(DOC_SHEET_PINS, false, []));
  });
});

describe('the default is upstream’s', () => {
  it('is TRUE, unlike fill_shapes beside it', () => {
    // `PARAM<bool>( "selection.draw_selected_children", …, true )` against
    // `PARAM<bool>( "selection.fill_shapes", …, false )` — the two neighbours
    // on this page default opposite ways, which is easy to copy wrongly.
    expect(EESCHEMA_DEFAULTS.selection.draw_selected_children).toBe(true);
    expect(EESCHEMA_DEFAULTS.selection.fill_shapes).toBe(false);
    expect(DEFAULT_RENDER_OPTS.drawSelectedChildren).toBe(true);
  });
});
