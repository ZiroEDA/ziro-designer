// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text boxes in the board model, and their file format.
 * Counterparts: `PCB_TEXTBOX` (pcbnew/pcb_textbox.h),
 * `PCB_IO_KICAD_SEXPR::format(PCB_TEXTBOX*)` and `parseTextBoxContent`.
 *
 * A `PCB_TEXTBOX` is an `EDA_SHAPE` and an `EDA_TEXT` at once — a rectangle
 * that wraps text inside itself — which is why it is its own item rather than
 * a graphic with a string attached.
 *
 * Two things decide whether a file survives a round trip:
 *
 * - **The shape is corners or a polygon, never both.** A non-cardinal rotation
 *   turns the box into a `(pts …)` polygon exactly as it does a `gr_rect`, and
 *   converting one back to corners would throw the rotation away.
 * - **`(border …)` and `(knockout …)` are written explicitly both ways.**
 *   Upstream's `FormatBool` always emits, unlike the many flags that vanish
 *   when false — and a reader that meets no `(border …)` at all defaults to
 *   *true*, so dropping a `no` inverts it.
 *
 * The rectangle fixture is verbatim from KiCad's own
 * `qa/data/pcbnew/api_kitchen_sink.kicad_pcb`. The rotated one is synthetic:
 * there is no angled `gr_text_box` anywhere in the reference tree, so its
 * layout is derived from the serializer rather than observed.
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LINE_STYLE } from '@ziroeda/common/stroke_params.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_TEXTBOX } from '@ziroeda/pcbnew/pcb_textbox.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { flatText, writtenNode } from './support/written_node.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

/** Verbatim from KiCad's api_kitchen_sink.kicad_pcb. */
const BOX = `(gr_text_box "Box\\no\\nCharacters"
    (start 116.9 49.9)
    (end 127.3 55.45)
    (margins 1.0025 1.0025 1.0025 1.0025)
    (layer "F.SilkS")
    (uuid "e767597a-10fe-4c42-aa00-6a6954af3954")
    (effects (font (size 0.9 0.9) (thickness 0.17) (bold yes)) (justify top))
    (border yes)
    (stroke (width 0.12) (type dot))
    (knockout no))`;

/** Synthetic: no rotated gr_text_box exists in the reference tree. */
const ROTATED = `(gr_text_box "Turned"
    (pts (xy 10 10) (xy 30 12) (xy 28 20) (xy 8 18))
    (margins 1 1 1 1)
    (angle 12.5)
    (layer "Cmts.User")
    (uuid "aaaaaaaa-0000-0000-0000-000000000001")
    (effects (font (size 1 1) (thickness 0.15)))
    (border no)
    (stroke (width 0.1) (type solid))
    (knockout yes))`;

const read = (...extra: string[]): BOARD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user) (5 "F.SilkS" user "F.Silkscreen")
    (17 "Cmts.User" user "User.Comments"))
  (net 0 "")
  ${extra.join('\n  ')}
)`);
const boxes = (b: BOARD): PCB_TEXTBOX[] =>
  b.Drawings().filter((d) => d.Type() === KICAD_T.PCB_TEXTBOX_T) as PCB_TEXTBOX[];
const only = (src: string): PCB_TEXTBOX => boxes(read(src))[0]!;

describe('reading a text box (parsePCB_TEXTBOX)', () => {
  it('reads the text, keeping its newlines', () => {
    expect(only(BOX).GetText()).toBe('Box\no\nCharacters');
  });

  it('reads the corners', () => {
    const b = only(BOX);

    expect(b.GetShape()).toBe(SHAPE_T.RECTANGLE);
    expect(b.GetStart()).toEqual({ x: MM(116.9), y: MM(49.9) });
    expect(b.GetEnd()).toEqual({ x: MM(127.3), y: MM(55.45) });
  });

  it('reads the margins in file order: left, top, right, bottom', () => {
    const b = only(BOX.replace('(margins 1.0025 1.0025 1.0025 1.0025)', '(margins 1 2 3 4)'));

    expect([b.GetMarginLeft(), b.GetMarginTop(), b.GetMarginRight(), b.GetMarginBottom()]).toEqual([
      MM(1),
      MM(2),
      MM(3),
      MM(4),
    ]);
  });

  it('reads the layer, uuid and text effects', () => {
    const b = only(BOX);

    expect(b.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    expect(b.m_Uuid).toBe('e767597a-10fe-4c42-aa00-6a6954af3954');
    expect(b.GetTextSize()).toEqual({ x: MM(0.9), y: MM(0.9) });
    expect(b.GetTextThickness()).toBe(MM(0.17));
    expect(b.IsBold()).toBe(true);
    expect(b.GetVertJustify()).toBe(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP);
  });

  it('reads the border, stroke and knockout', () => {
    const b = only(BOX);

    expect(b.IsBorderEnabled()).toBe(true);
    expect(b.GetWidth()).toBe(MM(0.12));
    expect(b.GetLineStyle()).toBe(LINE_STYLE.DOT);
    expect(b.IsKnockout()).toBe(false);
  });

  it('defaults to a border when the file says nothing', () => {
    // PCB_TEXTBOX's constructor enables the border, so a missing token is not
    // the same as `(border no)`.
    expect(only(BOX.replace('(border yes)', '')).IsBorderEnabled()).toBe(true);
  });

  it('reads a rotated box as a polygon, not as corners', () => {
    const b = only(ROTATED);

    expect(b.GetShape()).toBe(SHAPE_T.POLY);
    expect(b.GetPolyShape().COutline(0).PointCount()).toBe(4);
    expect(b.GetPolyShape().COutline(0).CPoint(0)).toEqual({ x: MM(10), y: MM(10) });
    expect(b.GetTextAngle().AsDegrees()).toBe(12.5);
  });

  it('keeps a box with neither corners nor points, where the constructor left it', () => {
    // `parsePCB_TEXTBOX_base` never insists on a corner token; a box the file
    // does not position is the PCB_TEXTBOX constructor's, at the origin.
    const broken = BOX.replace('(start 116.9 49.9)', '').replace('(end 127.3 55.45)', '');

    expect(boxes(read(broken))).toHaveLength(1);
    expect(only(broken).GetStart()).toEqual({ x: 0, y: 0 });
  });

  it('does not mistake one for a gr_text', () => {
    expect(
      read(BOX)
        .Drawings()
        .filter((d) => d.Type() === KICAD_T.PCB_TEXT_T),
    ).toHaveLength(0);
  });
});

describe('round-tripping through the writer', () => {
  it('gives an untouched box back unchanged', () => {
    const out = FormatBoard(read(BOX));
    const back = boxes(ParseBoard(out));

    expect(back).toHaveLength(1);
    expect(back[0]!.GetStart()).toEqual({ x: MM(116.9), y: MM(49.9) });
    expect(out).toContain('(knockout no)');
    expect(out).toContain('(type dot)');
  });

  it('keeps a rotated box a polygon', () => {
    const back = boxes(ParseBoard(FormatBoard(read(ROTATED))))[0]!;

    expect(back.GetShape()).toBe(SHAPE_T.POLY);
    expect(back.GetPolyShape().COutline(0).PointCount()).toBe(4);
    expect(back.GetTextAngle().AsDegrees()).toBe(12.5);
  });

  it('drops a deleted box and keeps the rest, in board order', () => {
    const b = read(BOX, ROTATED);
    b.Remove(boxes(b)[0]!);
    const back = boxes(ParseBoard(FormatBoard(b)));

    expect(back).toHaveLength(1);
    expect(back[0]!.GetText()).toBe('Turned');
  });
});

describe('writing a box built from scratch (format( PCB_TEXTBOX* ))', () => {
  /** A 10 x 5 mm box with 1 mm margins on F.SilkS, put on its own board. */
  const build = (edit: (t: PCB_TEXTBOX) => void = () => {}): string => {
    const board = read();
    const t = new PCB_TEXTBOX(board);
    t.SetText('hi');
    t.SetLayer(PCB_LAYER_ID.F_SilkS);
    t.SetStart({ x: 0, y: 0 });
    t.SetEnd({ x: MM(10), y: MM(5) });
    t.SetMarginLeft(MM(1));
    t.SetMarginTop(MM(1));
    t.SetMarginRight(MM(1));
    t.SetMarginBottom(MM(1));
    edit(t);
    board.Add(t);
    return flatText(writtenNode(board, 'gr_text_box'));
  };

  it('writes corners for a rectangle', () => {
    const s = build();

    expect(s).toContain('(start 0 0)');
    expect(s).toContain('(end 10 5)');
    expect(s).not.toContain('(pts');
  });

  it('writes points for a polygon, and no corners', () => {
    const s = build((t) => {
      t.SetShape(SHAPE_T.POLY);
      t.GetPolyShape().NewOutline();
      t.GetPolyShape().Append(0, 0);
      t.GetPolyShape().Append(MM(1), 0);
      t.GetPolyShape().Append(MM(1), MM(1));
    });

    expect(s).toContain('(pts');
    expect(s).not.toContain('(start');
    expect(s).not.toContain('(end');
  });

  it('writes border and knockout both ways, never omitting them', () => {
    // A missing `(border …)` reads back as true, so `no` has to be written.
    expect(build((t) => t.SetBorderEnabled(false))).toContain('(border no)');
    expect(build((t) => t.SetBorderEnabled(true))).toContain('(border yes)');
    expect(build((t) => t.SetIsKnockout(false))).toContain('(knockout no)');
    expect(build((t) => t.SetIsKnockout(true))).toContain('(knockout yes)');
  });

  it('writes an angle only when there is one', () => {
    expect(build((t) => t.SetTextAngleDegrees(30))).toContain('(angle 30)');
    expect(build()).not.toContain('(angle');
  });

  it('writes the margins in file order', () => {
    const s = build((t) => {
      t.SetMarginTop(MM(2));
      t.SetMarginRight(MM(3));
      t.SetMarginBottom(MM(4));
    });

    expect(s).toContain('(margins 1 2 3 4)');
  });

  it('round-trips a built box back through the reader', () => {
    const board = read();
    const t = new PCB_TEXTBOX(board);
    t.SetText('hi');
    t.SetLayer(PCB_LAYER_ID.F_SilkS);
    t.SetEnd({ x: MM(10), y: MM(5) });
    t.SetMarginLeft(MM(1));
    t.SetIsKnockout(true);
    t.SetLineStyle(LINE_STYLE.DASH);
    board.Add(t);
    const back = boxes(ParseBoard(FormatBoard(board)));

    expect(back).toHaveLength(1);
    expect(back[0]!.GetText()).toBe('hi');
    expect(back[0]!.IsKnockout()).toBe(true);
    expect(back[0]!.GetLineStyle()).toBe(LINE_STYLE.DASH);
    expect(back[0]!.GetMarginLeft()).toBe(MM(1));
  });
});
