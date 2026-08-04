// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit Text and Graphics Properties.
 * Counterpart: `DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS`.
 *
 * Most of what is pinned below is something a reasonable engineer would "fix" if
 * they ported from the dialog's labels rather than from its code: a bold
 * checkbox that silently overwrites the thickness field next to it, a "set to
 * layer defaults" that pointedly refuses to use the Layer combo above it, a
 * reference filter that lets every board item through, and a table whose cells
 * are edited while the table itself is not.
 *
 * Every apply is round-tripped through `serializeBoard` + `readBoard` wherever
 * persistence is the point, because the writer emits each item's stored source
 * verbatim: an edit that is not also patched into the source renders perfectly
 * and then vanishes on save, with nothing else failing.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  DEFAULT_GLOBAL_TEXT_GFX_OPTIONS as DEFAULTS,
  applyGlobalTextAndGraphicsEdit,
  autoTextThicknessDisplay,
  countGlobalTextAndGraphicsTargets,
  effectiveTextPenWidth,
  getPenSizeForBold,
  getPenSizeForNormal,
  globalTextGfxSizesValid,
  setAutoThickness,
  setBoldOnText,
  styleTextFromSettings,
  textGfxLayerClass,
  type GlobalTextGfxContext,
  type GlobalTextGfxOptions,
  type TextGfxDefaultsIU,
} from '@ziroeda/pcbnew/src/global_edit_text_and_graphics.js';
import type { Board, PcbTextItem } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

/**
 * One footprint carrying every kind of text the model can hold, plus one of
 * each board item this dialog reaches. `${REFERENCE}` is stored raw in the file
 * and resolved to "R1" by the reader, which is exactly the case the scope
 * checkboxes have to key off the *unresolved* text for.
 */
const BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  (footprint "Resistor_SMD:R_0805"
    (layer "F.Cu")
    (uuid "22222222-0000-0000-0000-00000000fp01")
    (at 100 100)
    (property "Reference" "R1" (at 0 -2 0) (layer "F.SilkS")
      (uuid "22222222-0000-0000-0000-000000000001")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "10k" (at 0 2 0) (layer "F.Fab")
      (uuid "22222222-0000-0000-0000-000000000002")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Datasheet" "http://x" (at 0 0 0) (unlocked yes) (layer "F.Fab") (hide yes)
      (uuid "22222222-0000-0000-0000-000000000003")
      (effects (font (size 1 1) (thickness 0.15))))
    (fp_text user "\${REFERENCE}" (at 0 4 0) (layer "F.Fab")
      (uuid "22222222-0000-0000-0000-000000000004")
      (effects (font (size 1 1) (thickness 0.15))))
    (fp_text user "note" (at 0 6 0) (unlocked yes) (layer "F.SilkS")
      (uuid "22222222-0000-0000-0000-000000000005")
      (effects (font (size 1 1) (thickness 0.15) (italic yes))))
    (fp_line (start -1 -1) (end 1 -1) (stroke (width 0.12) (type dash)) (layer "F.SilkS")
      (uuid "22222222-0000-0000-0000-000000000006"))
    (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu" "F.Mask" "F.Paste")
      (uuid "22222222-0000-0000-0000-000000000007")))
  (gr_text "label" (at 40 40) (layer "F.SilkS")
    (uuid "11111111-0000-0000-0000-000000000004")
    (effects (font (size 1 1) (thickness 0.15)) (justify left mirror)))
  (gr_text_box "boxed"
    (start 50 50) (end 60 55)
    (margins 1 1 1 1)
    (layer "B.SilkS")
    (uuid "11111111-0000-0000-0000-000000000005")
    (effects (font (size 1 1) (thickness 0.15)))
    (border yes)
    (stroke (width 0.12) (type solid))
    (knockout no))
  (gr_line (start 0 0) (end 5 5) (stroke (width 0.1) (type dot)) (layer "Edge.Cuts")
    (uuid "11111111-0000-0000-0000-000000000003"))
  (table
    (column_count 1)
    (uuid "11111111-0000-0000-0000-000000000007")
    (layer "F.SilkS")
    (border (external yes) (header no) (stroke (width 0.05) (type solid)))
    (separators (rows no) (cols no))
    (column_widths 10)
    (row_heights 5)
    (cells
      (table_cell "c"
        (start 90 90) (end 100 95)
        (margins 1 1 1 1)
        (span 1 1)
        (layer "F.SilkS")
        (uuid "11111111-0000-0000-0000-000000000008")
        (effects (font (size 1 1))))))
  (dimension (type orthogonal) (layer "Dwgs.User")
    (uuid "11111111-0000-0000-0000-000000000006")
    (pts (xy 70 70) (xy 80 70)) (height 5) (orientation 0)
    (format (prefix "") (suffix "") (units 3) (units_format 0) (precision 4))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (extension_height 0.5) (extension_offset 0.5) (keep_text_aligned yes))
    (gr_text "10" (at 75 66 0) (layer "Dwgs.User")
      (uuid "11111111-0000-0000-0000-000000000009")
      (effects (font (size 1 1) (thickness 0.15)))))
  (group "g" (uuid "33333333-0000-0000-0000-0000000000g1")
    (members "22222222-0000-0000-0000-00000000fp01"))
)`;

const read = (): Board => readBoard(parse(BOARD));

/** Serialise and re-read, so only what actually reached the file survives. */
const saved = (b: Board): Board => readBoard(parse(serializeBoard(b)));

/**
 * The serialised text from `open` to the end of the file. Crude, but enough to
 * ask "does *this* node carry a token" without the rest of the board answering
 * for it — the board has strokes and `unlocked` flags elsewhere on purpose.
 */
const nodeText = (b: Board, open: string): string => {
  const s = serializeBoard(b);
  const i = s.indexOf(open);
  expect(i).toBeGreaterThanOrEqual(0);
  return s.slice(i);
};

const opts = (over: Partial<GlobalTextGfxOptions> = {}): GlobalTextGfxOptions => ({
  ...DEFAULTS,
  ...over,
});

/**
 * Deliberately distinct per class, so which row was consulted is visible in the
 * result. Real defaults would leave silk and fab indistinguishable.
 */
const DEF: TextGfxDefaultsIU = {
  silk: {
    lineThickness: MM(0.11),
    textSize: { x: MM(1.1), y: MM(2.1) },
    textThickness: MM(0.21),
    textItalic: true,
    textUpright: true,
  },
  copper: {
    lineThickness: MM(0.12),
    textSize: { x: MM(1.2), y: MM(2.2) },
    textThickness: MM(0.22),
    textItalic: false,
    textUpright: false,
  },
  edges: {
    lineThickness: MM(0.13),
    textSize: { x: MM(1.3), y: MM(2.3) },
    textThickness: MM(0.23),
    textItalic: false,
    textUpright: false,
  },
  courtyard: {
    lineThickness: MM(0.14),
    textSize: { x: MM(1.4), y: MM(2.4) },
    textThickness: MM(0.24),
    textItalic: false,
    textUpright: false,
  },
  fab: {
    lineThickness: MM(0.15),
    textSize: { x: MM(1.5), y: MM(2.5) },
    textThickness: MM(0.25),
    textItalic: false,
    textUpright: false,
  },
  other: {
    lineThickness: MM(0.16),
    textSize: { x: MM(1.6), y: MM(2.6) },
    textThickness: MM(0.26),
    textItalic: false,
    textUpright: false,
  },
};

const CTX: GlobalTextGfxContext = {
  defaults: DEF,
  dimensionDefaults: {
    unitsMode: 2,
    unitsFormat: 2,
    precision: 3,
    suppressZeroes: true,
    textPosition: 1,
    keepTextAligned: false,
  },
};

const fpText = (b: Board, uuidTail: string): PcbTextItem =>
  b.footprints[0]!.texts.find((t) => t.uuid?.endsWith(uuidTail))!;

// ---------------------------------------------------------------------------

describe('the layer class an item falls into', () => {
  it('follows GetLayerClass first-match-wins, including the two orderings that matter', () => {
    // Silk before everything; copper is every *.Cu, inners included.
    expect(textGfxLayerClass('F.SilkS')).toBe('silk');
    expect(textGfxLayerClass('B.SilkS')).toBe('silk');
    expect(textGfxLayerClass('F.Cu')).toBe('copper');
    expect(textGfxLayerClass('In7.Cu')).toBe('copper');
    expect(textGfxLayerClass('Edge.Cuts')).toBe('edges');
    // Courtyard is tested BEFORE fab upstream. Swap them and F.CrtYd still
    // lands on courtyard, but only because neither name matches the other —
    // the pinning that catches a reorder is that both keep their own class.
    expect(textGfxLayerClass('F.CrtYd')).toBe('courtyard');
    expect(textGfxLayerClass('B.CrtYd')).toBe('courtyard');
    expect(textGfxLayerClass('F.Fab')).toBe('fab');
    expect(textGfxLayerClass('B.Fab')).toBe('fab');
  });

  it('drops everything unlisted into `other`, masks and user layers alike', () => {
    // A port that mapped mask or paste onto silk would quietly restyle them.
    for (const l of ['F.Mask', 'B.Paste', 'F.Adhes', 'Dwgs.User', 'Cmts.User', 'User.9', 'Margin'])
      expect(textGfxLayerClass(l)).toBe('other');
  });
});

describe('pen sizes derived from the glyph box', () => {
  it('is the size over five for bold and over eight for normal', () => {
    // Get the divisors backwards and every bold text comes out hairline.
    expect(getPenSizeForBold(MM(1))).toBe(MM(0.2));
    expect(getPenSizeForNormal(MM(1))).toBe(MM(0.125));
  });

  it('treats a stored thickness of exactly one IU as unset', () => {
    // The guard is `<= 1`, not `=== 0`. A `< 1` guard reports 1 IU as the pen
    // width and the text renders invisibly thin.
    expect(effectiveTextPenWidth({ thickness: 1, size: { x: MM(1), y: MM(1) } })).toBe(MM(0.125));
    expect(effectiveTextPenWidth({ thickness: MM(0.3), size: { x: MM(2), y: MM(2) } })).toBe(
      MM(0.3),
    );
  });

  it('clamps to a quarter of the smaller dimension', () => {
    // A thick pen on tiny text would otherwise report wider than the glyphs.
    expect(effectiveTextPenWidth({ thickness: MM(5), size: { x: MM(1), y: MM(1) } })).toBe(
      MM(0.25),
    );
  });
});

describe('the setters that are not plain assignments', () => {
  it('rewrites the thickness when bold actually changes, and only then', () => {
    const t = { bold: false, thickness: MM(0.3), size: { x: MM(2), y: MM(1) } };
    // min(x, y) — not the width, not the height.
    expect(setBoldOnText(t, true).thickness).toBe(getPenSizeForBold(MM(1)));
    // Already bold: SetBold's `if (m_Bold != aBold)` makes this a no-op, which
    // is what keeps a second identical apply from re-deriving the width again.
    expect(setBoldOnText({ ...t, bold: true }, true).thickness).toBe(MM(0.3));
  });

  it('stores zero for auto thickness and leaves an already-auto text alone', () => {
    const t = { thickness: MM(0.3), size: { x: MM(1), y: MM(1) } };
    expect(setAutoThickness(t, true).thickness).toBe(0);
    // GetAutoThickness() is `thickness == 0`, and an absent token reads as 0,
    // so turning auto on twice must not disturb anything.
    const already = { size: { x: MM(1), y: MM(1) } };
    expect(setAutoThickness(already, true)).toBe(already);
    // Turning it off materialises the width the renderer was already using.
    expect(setAutoThickness({ thickness: 0, size: { x: MM(1), y: MM(1) } }, false).thickness).toBe(
      MM(0.125),
    );
  });
});

describe('setting specified values', () => {
  it('writes text width and height independently', () => {
    // Two controls, two components. `SetTextSize(VECTOR2I(w, GetTextSize().y))`
    // — writing both from one control would silently square every text.
    const b = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ boardText: true, textWidth: MM(3) }),
      CTX,
    ).board;
    expect(b.texts[0]!.size).toEqual({ x: MM(3), y: MM(1) });

    const c = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ boardText: true, textHeight: MM(4) }),
      CTX,
    ).board;
    expect(c.texts[0]!.size).toEqual({ x: MM(1), y: MM(4) });
  });

  it('lets bold overwrite the thickness typed next to it', () => {
    // Upstream applies bold AFTER thickness and SetBold rewrites the stroke
    // width. Reorder the two and this returns 0.4 mm, which is what a port
    // written from the dialog layout produces.
    const b = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ boardText: true, thickness: MM(0.4), bold: true }),
      CTX,
    ).board;
    expect(b.texts[0]!.thickness).toBe(getPenSizeForBold(MM(1)));
    expect(b.texts[0]!.bold).toBe(true);
  });

  it('turns "auto thickness + bold" into an explicit bold pen width', () => {
    // Auto sets 0, then bold overwrites it. Only auto *without* bold yields a
    // genuine zero — and then the token has to leave the file entirely.
    const bolded = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ boardText: true, autoTextThickness: true, bold: true }),
      CTX,
    ).board;
    expect(bolded.texts[0]!.thickness).toBe(getPenSizeForBold(MM(1)));

    const auto = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ boardText: true, autoTextThickness: true }),
      CTX,
    ).board;
    expect(auto.texts[0]!.thickness).toBe(0);
    // EDA_TEXT::Format emits (thickness …) only when it is non-zero. Writing
    // `(thickness 0)` is not what KiCad produces and dirties every diff.
    expect(serializeBoard(auto)).not.toContain('(thickness 0)');
    expect(saved(auto).texts[0]!.thickness).toBeUndefined();
  });

  it('gives a text box both the text treatment and the line width', () => {
    // PCB_TEXTBOX is an EDA_TEXT *and* a PCB_SHAPE, so both casts fire. A port
    // that switches on one type per item drops one of the two.
    const b = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ boardText: true, textHeight: MM(3), lineWidth: MM(0.5) }),
      CTX,
    ).board;
    const box = saved(b).textBoxes[0]!;
    expect(box.size.y).toBe(MM(3));
    expect(box.strokeWidth).toBe(MM(0.5));
    // The stroke *type* is preserved — only the width is written.
    expect(box.strokeType).toBe('solid');
  });

  it('gives a dimension the text treatment and the line thickness but no stroke', () => {
    // PCB_DIMENSION_BASE is a PCB_TEXT and not a PCB_SHAPE. Routing it down the
    // shape branch would add a `(stroke …)` KiCad never writes on a dimension.
    const b = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ boardDimensions: true, textHeight: MM(3), lineWidth: MM(0.5) }),
      CTX,
    ).board;
    const d = saved(b).dimensions[0]!;
    expect(d.text!.size.y).toBe(MM(3));
    expect(d.style.thickness).toBe(MM(0.5));
    expect(nodeText(b, '(dimension')).not.toContain('(stroke');
  });

  it('preserves a shape stroke type while changing only its width', () => {
    const b = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ boardGraphics: true, lineWidth: MM(0.5) }),
      CTX,
    ).board;
    const s = saved(b).shapes[0]!;
    expect(s.width).toBe(MM(0.5));
    // `stroke.SetWidth` touches the width alone; rebuilding the node from
    // scratch would reset a dotted board outline to solid.
    expect(s.strokeType).toBe('dot');
  });

  it('moves an item to the chosen layer, keeping its knockout modifier', () => {
    const b = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ boardText: true, layer: 'B.SilkS' }),
      CTX,
    ).board;
    expect(saved(b).texts[0]!.layer).toBe('B.SilkS');
    // Knockout lives *inside* the layer token, so a naive `(layer "X")` rewrite
    // silently clears it. The board text box carries `(knockout no)`; the point
    // is that the layer patch does not disturb whatever modifier is there.
    expect(saved(b).textBoxes[0]!.knockout).toBe(false);
  });

  it('keeps the justify words, which carry the mirror flag', () => {
    // Regenerating `(justify …)` from the model would drop `left` and unmirror
    // the text, neither of which this dialog edits.
    const b = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ boardText: true, textHeight: MM(3) }),
      CTX,
    ).board;
    const t = saved(b).texts[0]!;
    expect(t.justify).toEqual(['left', 'mirror']);
    expect(t.mirror).toBe(true);
  });

  it('applies visibility to fields only', () => {
    const b = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ references: true, footprintTexts: true, visible: false }),
      CTX,
    ).board;
    const after = saved(b);
    // Reference is a PCB_FIELD: the label reads "Visible (fields only)".
    expect(fpText(after, '0001').hide).toBe(true);
    // A plain fp_text is not a field, however plainly the model carries `hide`.
    expect(fpText(after, '0005').hide).toBe(false);
  });

  it('writes keep-upright for footprint text and never for board text', () => {
    const b = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ boardText: true, footprintTexts: true, keepUpright: true }),
      CTX,
    ).board;
    // The file stores the inverse: `unlocked` means "do not keep upright", so
    // the token has to be removed, and the round trip is the only proof of it.
    expect(fpText(saved(b), '0005').keepUpright).toBe(true);
    expect(nodeText(b, '(fp_text user "note"')).not.toContain('(unlocked');
    // gr_text has no upright concept; upstream guards the whole assignment on
    // `if (parentFP)`. This has to be asserted on the *unsaved* board: the
    // reader forces keepUpright false for board text whatever the model said,
    // so a save would launder the mistake and hide it.
    expect(b.texts[0]!.keepUpright).toBe(false);
    // And writing `unlocked` onto one adds a token KiCad never emits there.
    expect(nodeText(b, '(gr_text "label"')).not.toContain('(unlocked');
  });

  it('adds `unlocked` back when keep-upright is turned off', () => {
    const b = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ footprintTexts: true, keepUpright: false }),
      CTX,
    ).board;
    // Round-tripping is the only proof: the model flag alone would be lost.
    expect(fpText(saved(b), '0005').keepUpright).toBe(false);
  });
});

describe('setting layer defaults', () => {
  const layerDefaults = (over: Partial<GlobalTextGfxOptions> = {}): Board =>
    applyGlobalTextAndGraphicsEdit(read(), opts({ setToSpecifiedValues: false, ...over }), CTX)
      .board;

  it('reads the item’s own layer and ignores the Layer combo entirely', () => {
    // The whole specified-values panel is disabled in this branch, the Layer
    // combo included, so "set to layer defaults" NEVER moves an item.
    const b = layerDefaults({ boardText: true, layer: 'B.Cu', textHeight: MM(9) });
    const t = saved(b).texts[0]!;
    expect(t.layer).toBe('F.SilkS');
    expect(t.size).toEqual(DEF.silk.textSize);
    expect(t.thickness).toBe(DEF.silk.textThickness);
    expect(t.italic).toBe(DEF.silk.textItalic);
  });

  it('never recomputes the mirrored flag', () => {
    // `StyleFromSettings( bds, /* aCheckSide */ false )` — every other caller in
    // the tree passes true. Getting it backwards un-mirrors every back text and
    // mirrors every front one.
    const b = layerDefaults({ boardText: true });
    expect(saved(b).texts[0]!.mirror).toBe(true);
  });

  it('never touches bold', () => {
    // A bold text keeps its flag and gets the class's normal-weight thickness
    // written over it, so it renders bold-flagged with a normal pen.
    const start = read();
    start.texts[0] = { ...start.texts[0]!, bold: true };
    const b = applyGlobalTextAndGraphicsEdit(
      start,
      opts({ setToSpecifiedValues: false, boardText: true }),
      CTX,
    ).board;
    expect(b.texts[0]!.bold).toBe(true);
    expect(b.texts[0]!.thickness).toBe(DEF.silk.textThickness);
  });

  it('gives keep-upright to footprint text and not to board text', () => {
    const b = layerDefaults({ boardText: true, footprintTexts: true });
    expect(fpText(saved(b), '0005').keepUpright).toBe(DEF.silk.textUpright);
    // `if (GetParentFootprint()) SetKeepUpright(…)` — and this has to be
    // asserted before the save, because the reader forces board text to false
    // whatever the model held and would launder the mistake away.
    expect(b.texts[0]!.keepUpright).toBe(false);
  });

  it('styles a text box with the shape width and the text body together', () => {
    // PCB_TEXTBOX::StyleFromSettings calls PCB_SHAPE's first and then repeats
    // the PCB_TEXT body. The box is on B.SilkS, so both come from `silk`.
    const box = saved(layerDefaults({ boardText: true })).textBoxes[0]!;
    expect(box.strokeWidth).toBe(DEF.silk.lineThickness);
    expect(box.size).toEqual(DEF.silk.textSize);
    expect(box.italic).toBe(true);
  });

  it('styles an Edge.Cuts graphic from the edges row the grid never shows', () => {
    // The grid displays line thickness only for Edge Cuts and Courtyards, but
    // all six classes are fully populated upstream.
    expect(saved(layerDefaults({ boardGraphics: true })).shapes[0]!.width).toBe(
      DEF.edges.lineThickness,
    );
  });

  it('gives a dimension the text body, the line thickness and the seven settings', () => {
    const d = saved(layerDefaults({ boardDimensions: true })).dimensions[0]!;
    // Dwgs.User is `other`, and the class comes from the DIMENSION's layer.
    expect(d.text!.size).toEqual(DEF.other.textSize);
    expect(d.style.thickness).toBe(DEF.other.lineThickness);
    expect(d.style.textPositionMode).toBe(1);
    expect(d.style.keepTextAligned).toBe(false);
    expect(d.format!.units).toBe(2);
    expect(d.format!.unitsFormat).toBe(2);
    expect(d.format!.precision).toBe(3);
    expect(d.format!.suppressZeroes).toBe(true);
  });

  it('picks a dimension’s class from the dimension’s layer, not its text’s', () => {
    // Upstream's dimension IS the text, so `GetLayer()` there is the
    // dimension's. The two can disagree in this model, and reading the text's
    // layer would style a Dwgs.User dimension from the silk row.
    const start = read();
    const d0 = start.dimensions[0]!;
    start.dimensions[0] = { ...d0, text: { ...d0.text!, layer: 'F.SilkS' } };
    const d = applyGlobalTextAndGraphicsEdit(
      start,
      opts({ setToSpecifiedValues: false, boardDimensions: true }),
      CTX,
    ).board.dimensions[0]!;
    expect(d.text!.size).toEqual(DEF.other.textSize);
    expect(d.style.thickness).toBe(DEF.other.lineThickness);
  });

  it('leaves the dimension tokens it does not own byte-identical', () => {
    // `(style …)` and `(format …)` are patched child by child, not rebuilt, so
    // the arrow length, extension height and empty prefix survive.
    const out = serializeBoard(layerDefaults({ boardDimensions: true }));
    expect(out).toContain('(arrow_length 1.27)');
    expect(out).toContain('(extension_height 0.5)');
  });
});

describe('the table', () => {
  it('edits the cells and never the table itself', () => {
    // Upstream's PCB_TABLE_T branch runs on the children only, so the table's
    // layer, border stroke and separator stroke are untouched in both branches.
    // A port that styles the table alongside its cells diverges on save.
    const b = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ boardText: true, layer: 'B.Cu', lineWidth: MM(0.9), textHeight: MM(3) }),
      CTX,
    ).board;
    const t = saved(b).tables[0]!;
    expect(t.layer).toBe('F.SilkS');
    expect(t.borderWidth).toBe(MM(0.05));
    expect(t.cells[0]!.layer).toBe('B.Cu');
    expect(t.cells[0]!.size.y).toBe(MM(3));
  });

  it('reaches cells through the text checkbox, never the graphics one', () => {
    const b = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ boardGraphics: true, textHeight: MM(3) }),
      CTX,
    ).board;
    expect(b.tables[0]!.cells[0]!.size.y).toBe(MM(1));
  });
});

describe('the scope checkboxes', () => {
  it('reaches a ${REFERENCE} literal through the References box', () => {
    // The reader resolved the text to "R1", so the raw literal has to be
    // recovered from the source node; comparing the resolved text matches
    // nothing and the box appears to do nothing.
    const b = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ references: true, bold: true }),
      CTX,
    ).board;
    expect(fpText(b, '0004').bold).toBe(true);
    // Reference itself, obviously.
    expect(fpText(b, '0001').bold).toBe(true);
    // "note" is a plain fp_text and is not in scope of the References box.
    expect(fpText(b, '0005').bold).toBe(false);
    // Nor is the Value field, nor the board text.
    expect(fpText(b, '0002').bold).toBe(false);
    expect(b.texts[0]!.bold).toBe(false);
  });

  it('edits footprint graphics under their own box and not the text one', () => {
    const b = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ footprintGraphics: true, lineWidth: MM(0.4) }),
      CTX,
    ).board;
    const s = saved(b).footprints[0]!.shapes[0]!;
    expect(s.width).toBe(MM(0.4));
    // The dashed style survives — only the width is written.
    expect(s.strokeType).toBe('dash');
    // Pads are not graphics, and the text box does not reach shapes.
    expect(
      applyGlobalTextAndGraphicsEdit(
        read(),
        opts({ footprintTexts: true, lineWidth: MM(0.4) }),
        CTX,
      ).board.footprints[0]!.shapes[0]!.width,
    ).toBe(MM(0.12));
  });

  it('styles a footprint graphic from its own layer class', () => {
    // The fp_line is on F.SilkS while the footprint is on F.Cu: the item's
    // layer decides, never the footprint's.
    const b = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ setToSpecifiedValues: false, footprintGraphics: true }),
      CTX,
    ).board;
    expect(saved(b).footprints[0]!.shapes[0]!.width).toBe(DEF.silk.lineThickness);
  });

  it('visits a ${REFERENCE} literal once when both boxes are ticked', () => {
    // The chain is `if (footprintTexts) … else if (references && raw == …)`.
    // Two independent ifs would visit it twice; the count is what shows it.
    expect(
      countGlobalTextAndGraphicsTargets(
        read(),
        opts({ references: true, footprintTexts: true }),
        CTX,
      ),
    ).toBe(3); // Reference field, the ${REFERENCE} fp_text, and "note"
  });

  it('keeps board graphics, text and dimensions in separate boxes', () => {
    expect(countGlobalTextAndGraphicsTargets(read(), opts({ boardGraphics: true }), CTX)).toBe(1);
    // Board text is gr_text + gr_text_box + one table cell.
    expect(countGlobalTextAndGraphicsTargets(read(), opts({ boardText: true }), CTX)).toBe(3);
    expect(countGlobalTextAndGraphicsTargets(read(), opts({ boardDimensions: true }), CTX)).toBe(1);
  });

  it('never touches pads, tracks, vias or zones', () => {
    const before = read();
    const b = applyGlobalTextAndGraphicsEdit(
      before,
      opts({
        references: true,
        values: true,
        footprintTexts: true,
        footprintGraphics: true,
        boardText: true,
        boardGraphics: true,
        boardDimensions: true,
        lineWidth: MM(0.9),
      }),
      CTX,
    ).board;
    expect(b.footprints[0]!.pads).toBe(before.footprints[0]!.pads);
  });

  it('hides the whole board loop in the footprint editor', () => {
    // `m_isBoardEditor` gates the three board checkboxes and the drawings loop.
    expect(
      countGlobalTextAndGraphicsTargets(
        read(),
        opts({ boardText: true, boardGraphics: true, boardDimensions: true, isBoardEditor: false }),
        CTX,
      ),
    ).toBe(0);
  });
});

describe('the filter gauntlet', () => {
  it('lets an item with no parent footprint through a reference filter', () => {
    // `if (FOOTPRINT* fp = GetParentFootprint())` — the test only happens when
    // there IS one. Rejecting the no-footprint case silently drops every board
    // item and looks exactly like the filter working.
    expect(
      countGlobalTextAndGraphicsTargets(
        read(),
        opts({ boardText: true, referenceFilterOpt: true, referenceFilter: 'U*' }),
        CTX,
      ),
    ).toBe(3);
  });

  it('matches references case-insensitively, as a glob', () => {
    // WildCompareString is called with case_sensitive = false, and upstream
    // folds with MakeUpper() on both sides.
    // References selects two items here: the Reference field and the fp_text
    // whose raw text is the literal ${REFERENCE}.
    const pass = opts({ references: true, referenceFilterOpt: true, referenceFilter: 'r*' });
    expect(countGlobalTextAndGraphicsTargets(read(), pass, CTX)).toBe(2);
    expect(countGlobalTextAndGraphicsTargets(read(), { ...pass, referenceFilter: 'U*' }, CTX)).toBe(
      0,
    );
    // No escaping and no character classes: '.' is an ordinary character, so
    // "R." matches the two-character reference "R." and not "R1".
    expect(countGlobalTextAndGraphicsTargets(read(), { ...pass, referenceFilter: 'R.' }, CTX)).toBe(
      0,
    );
  });

  it('treats an enabled filter with an empty box as no filter at all', () => {
    // Upstream tests `!IsEmpty()`. A pattern of '' would otherwise match only
    // the empty string and reject everything.
    expect(
      countGlobalTextAndGraphicsTargets(
        read(),
        opts({ references: true, referenceFilterOpt: true, referenceFilter: '' }),
        CTX,
      ),
    ).toBe(2);
  });

  it('matches the footprint filter against the LIB_ID', () => {
    const base = opts({ references: true, footprintFilterOpt: true });
    expect(
      countGlobalTextAndGraphicsTargets(read(), { ...base, footprintFilter: 'Resistor*' }, CTX),
    ).toBe(2);
    // `?` is exactly one character, so this pins "R_0805" and not "R_08".
    expect(
      countGlobalTextAndGraphicsTargets(read(), { ...base, footprintFilter: '*:R_????' }, CTX),
    ).toBe(2);
    expect(
      countGlobalTextAndGraphicsTargets(read(), { ...base, footprintFilter: 'Capacitor*' }, CTX),
    ).toBe(0);
  });

  it('rejects an item on the wrong layer only when the filter is on', () => {
    const base = opts({ references: true, footprintTexts: true });
    expect(countGlobalTextAndGraphicsTargets(read(), base, CTX)).toBe(3);
    expect(
      countGlobalTextAndGraphicsTargets(
        read(),
        { ...base, layerFilterOpt: true, layerFilter: 'F.Fab' },
        CTX,
      ),
    ).toBe(1);
    // An unset layer is UNDEFINED_LAYER, which disables the filter even though
    // the checkbox is ticked.
    expect(countGlobalTextAndGraphicsTargets(read(), { ...base, layerFilterOpt: true }, CTX)).toBe(
      3,
    );
  });

  it('escalates one level to the parent footprint, then up the group chain', () => {
    const base = opts({ references: true, footprintTexts: true, selectedItemsFilter: true });
    // Nothing selected: nothing passes.
    expect(countGlobalTextAndGraphicsTargets(read(), base, { ...CTX })).toBe(0);
    // The text itself.
    expect(
      countGlobalTextAndGraphicsTargets(read(), base, {
        ...CTX,
        isSelected: (id) => id === 'fptext:0:0',
      }),
    ).toBe(1);
    // The footprint — one level up, and it carries all three texts with it.
    expect(
      countGlobalTextAndGraphicsTargets(read(), base, {
        ...CTX,
        isSelected: (id) => id === 'footprint:0',
      }),
    ).toBe(3);
    // The group. The walk starts from the candidate we ended up with — the
    // FOOTPRINT — so it is the footprint's group that is searched, not the
    // text's. Starting the walk from the item would find nothing here.
    expect(
      countGlobalTextAndGraphicsTargets(read(), base, {
        ...CTX,
        isSelected: (id) => id === '33333333-0000-0000-0000-0000000000g1',
      }),
    ).toBe(3);
  });
});

describe('the apply as a whole', () => {
  it('rejects out-of-range text sizes and changes nothing', () => {
    // TEXT_MIN_SIZE_MM 0.001 .. TEXT_MAX_SIZE_MM 250. Upstream returns false
    // and the dialog stays open.
    const before = read();
    const r = applyGlobalTextAndGraphicsEdit(
      before,
      opts({ boardText: true, textWidth: MM(300) }),
      CTX,
    );
    expect(r.error).toBeDefined();
    expect(r.board).toBe(before);
    expect(globalTextGfxSizesValid(opts({ textHeight: MM(0.0005) }))).toBe(false);
    // An indeterminate field never blocks the apply.
    expect(globalTextGfxSizesValid(opts())).toBe(true);
    // Line width and thickness are not validated at all.
    expect(globalTextGfxSizesValid(opts({ lineWidth: -MM(5), thickness: -MM(5) }))).toBe(true);
  });

  it('returns the same board reference when nothing matched', () => {
    // No scope box ticked: no undo entry, no dirty flag.
    const before = read();
    expect(applyGlobalTextAndGraphicsEdit(before, opts(), CTX).board).toBe(before);
  });

  it('is idempotent: a second identical apply changes nothing', () => {
    // SetBold, SetItalic and SetAutoThickness are all guarded on the current
    // value. A port that recomputes unconditionally re-derives the thickness on
    // every run and drifts.
    const one = applyGlobalTextAndGraphicsEdit(
      read(),
      opts({ boardText: true, bold: true }),
      CTX,
    ).board;
    const two = applyGlobalTextAndGraphicsEdit(one, opts({ boardText: true, bold: true }), CTX);
    expect(two.changed).toBe(0);
    expect(two.board).toBe(one);
  });

  it('reports the count the filters selected', () => {
    const r = applyGlobalTextAndGraphicsEdit(read(), opts({ boardText: true, italic: true }), CTX);
    expect(r.changed).toBe(3);
    expect(countGlobalTextAndGraphicsTargets(read(), opts({ boardText: true }), CTX)).toBe(3);
  });
});

describe('the dialog’s auto-thickness display', () => {
  it('shows a number only when both sizes are determinate', () => {
    // Cosmetic and entirely separate from what is applied, which is 0. Null
    // stands for upstream's literal "(auto)" placeholder.
    expect(autoTextThicknessDisplay(opts({ autoTextThickness: true }))).toBeNull();
    expect(
      autoTextThicknessDisplay(
        opts({ autoTextThickness: true, textWidth: MM(2), textHeight: MM(1) }),
      ),
    ).toBe(getPenSizeForNormal(MM(1)));
    expect(
      autoTextThicknessDisplay(
        opts({ autoTextThickness: true, textWidth: MM(2), textHeight: MM(1), bold: true }),
      ),
    ).toBe(getPenSizeForBold(MM(1)));
    // The button is unchecked: the field shows INDETERMINATE_ACTION.
    expect(autoTextThicknessDisplay(opts({ textWidth: MM(2), textHeight: MM(1) }))).toBeNull();
  });
});

describe('styleTextFromSettings on its own', () => {
  it('leaves the mirrored flag alone unless a caller asks for the side check', () => {
    const t: PcbTextItem = {
      kind: 'user',
      text: 'x',
      at: { x: 0, y: 0 },
      angle: 0,
      layer: 'B.SilkS',
      size: { x: MM(1), y: MM(1) },
      mirror: false,
      source: { kind: 'list', items: [] },
    };
    expect(styleTextFromSettings(t, 'B.SilkS', false, DEF).mirror).toBe(false);
    // The footprint loader and the parser do pass true; this dialog never does.
    expect(styleTextFromSettings(t, 'B.SilkS', false, DEF, true).mirror).toBe(true);
  });
});
