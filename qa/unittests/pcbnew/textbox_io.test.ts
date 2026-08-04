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
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard, buildTextBoxNode } from '@ziroeda/pcbnew/src/write-board.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board, PcbTextBox } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

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

const read = (...extra: string[]): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (44 "Edge.Cuts" user) (39 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  ${extra.join('\n  ')}
)`),
  );
const only = (src: string): PcbTextBox => read(src).textBoxes[0]!;

describe('reading a text box', () => {
  it('reads the text, keeping its newlines', () => {
    expect(only(BOX).text).toBe('Box\no\nCharacters');
  });

  it('reads the corners', () => {
    const b = only(BOX);

    expect(b.start).toEqual({ x: MM(116.9), y: MM(49.9) });
    expect(b.end).toEqual({ x: MM(127.3), y: MM(55.45) });
    expect(b.pts).toBeUndefined();
  });

  it('reads the margins in file order: left, top, right, bottom', () => {
    const b = read(BOX.replace('(margins 1.0025 1.0025 1.0025 1.0025)', '(margins 1 2 3 4)'))
      .textBoxes[0]!;

    expect(b.margins).toEqual({ left: MM(1), top: MM(2), right: MM(3), bottom: MM(4) });
  });

  it('reads the layer, uuid and text effects', () => {
    const b = only(BOX);

    expect(b.layer).toBe('F.SilkS');
    expect(b.uuid).toBe('e767597a-10fe-4c42-aa00-6a6954af3954');
    expect(b.size).toEqual({ x: MM(0.9), y: MM(0.9) });
    expect(b.thickness).toBe(MM(0.17));
    expect(b.bold).toBe(true);
    expect(b.justify).toEqual(['top']);
  });

  it('reads the border, stroke and knockout', () => {
    const b = only(BOX);

    expect(b.border).toBe(true);
    expect(b.strokeWidth).toBe(MM(0.12));
    expect(b.strokeType).toBe('dot');
    expect(b.knockout).toBe(false);
  });

  it('defaults to a border when the file says nothing', () => {
    // PCB_TEXTBOX's constructor enables the border, so a missing token is not
    // the same as `(border no)`.
    const b = read(BOX.replace('(border yes)', '')).textBoxes[0]!;

    expect(b.border).toBe(true);
  });

  it('reads a rotated box as a polygon, not as corners', () => {
    const b = only(ROTATED);

    expect(b.start).toBeUndefined();
    expect(b.pts).toHaveLength(4);
    expect(b.pts![0]).toEqual({ x: MM(10), y: MM(10) });
    expect(b.angle).toBe(12.5);
  });

  it('leaves the angle absent rather than zero on an upright box', () => {
    // Upstream omits `(angle …)` when it is zero, and writing one back would
    // add a token the original file did not have.
    expect(only(BOX).angle).toBeUndefined();
  });

  it('skips a box with neither corners nor points', () => {
    const broken = BOX.replace('(start 116.9 49.9)', '').replace('(end 127.3 55.45)', '');

    expect(read(broken).textBoxes).toHaveLength(0);
  });

  it('does not mistake one for a gr_text', () => {
    expect(read(BOX).texts).toHaveLength(0);
  });
});

describe('round-tripping through the writer', () => {
  it('gives an untouched box back unchanged', () => {
    const out = serializeBoard(read(BOX));
    const back = readBoard(parse(out));

    expect(back.textBoxes).toHaveLength(1);
    expect(back.textBoxes[0]!.start).toEqual({ x: MM(116.9), y: MM(49.9) });
    expect(out).toContain('(knockout no)');
    expect(out).toContain('(type dot)');
  });

  it('keeps a rotated box a polygon', () => {
    const back = readBoard(parse(serializeBoard(read(ROTATED))));

    expect(back.textBoxes[0]!.pts).toHaveLength(4);
    expect(back.textBoxes[0]!.angle).toBe(12.5);
  });

  it('keeps boxes when other items are edited around them', () => {
    const b = read(BOX, ROTATED);
    b.texts.push({
      kind: 'user',
      text: 'hello',
      at: { x: 0, y: 0 },
      angle: 0,
      layer: 'F.SilkS',
      size: { x: MM(1), y: MM(1) },
      source: { kind: 'list', items: [] },
    });
    const back = readBoard(parse(serializeBoard(b)));

    expect(back.textBoxes).toHaveLength(2);
    expect(back.texts.some((t) => t.text === 'hello')).toBe(true);
  });

  it('drops a deleted box and keeps the rest, in model order', () => {
    const b = read(BOX, ROTATED);
    b.textBoxes.splice(0, 1);
    const back = readBoard(parse(serializeBoard(b)));

    expect(back.textBoxes).toHaveLength(1);
    expect(back.textBoxes[0]!.text).toBe('Turned');
  });
});

describe('building a box from scratch', () => {
  const base = (over: Partial<PcbTextBox> = {}): PcbTextBox => ({
    text: 'hi',
    start: { x: 0, y: 0 },
    end: { x: MM(10), y: MM(5) },
    margins: { left: MM(1), top: MM(1), right: MM(1), bottom: MM(1) },
    layer: 'F.SilkS',
    size: { x: MM(1), y: MM(1) },
    border: true,
    strokeWidth: MM(0.1),
    source: { kind: 'list', items: [] },
    ...over,
  });
  const text = (t: PcbTextBox): string => serialize(buildTextBoxNode(t));

  it('writes corners for a rectangle', () => {
    const s = text(base());

    expect(s).toContain('(start 0 0)');
    expect(s).toContain('(end 10 5)');
    expect(s).not.toContain('(pts');
  });

  it('writes points for a polygon, and no corners', () => {
    const s = text(
      base({
        start: undefined,
        end: undefined,
        pts: [
          { x: 0, y: 0 },
          { x: MM(1), y: 0 },
        ],
      }),
    );

    expect(s).toContain('(pts');
    expect(s).not.toContain('(start');
    expect(s).not.toContain('(end');
  });

  it('prefers the polygon when somehow given both', () => {
    // Upstream switches on the shape, so it can never emit both; if a caller
    // sets both, the polygon is the one carrying the rotation.
    const s = text(
      base({
        pts: [
          { x: 0, y: 0 },
          { x: MM(1), y: 0 },
        ],
      }),
    );

    expect(s).toContain('(pts');
    expect(s).not.toContain('(start');
  });

  it('writes border and knockout both ways, never omitting them', () => {
    // A missing `(border …)` reads back as true, so `no` has to be written.
    expect(text(base({ border: false }))).toContain('(border no)');
    expect(text(base({ border: true }))).toContain('(border yes)');
    expect(text(base({ knockout: false }))).toContain('(knockout no)');
    expect(text(base({ knockout: true }))).toContain('(knockout yes)');
  });

  it('writes an angle only when there is one', () => {
    expect(text(base({ angle: 30 }))).toContain('(angle 30)');
    expect(text(base())).not.toContain('(angle');
  });

  it('writes the margins in file order', () => {
    const s = text(base({ margins: { left: MM(1), top: MM(2), right: MM(3), bottom: MM(4) } }));

    expect(s).toContain('(margins 1 2 3 4)');
  });

  it('round-trips a built box back through the reader', () => {
    const b = read();
    b.textBoxes.push(base({ uuid: 'abc', knockout: true, strokeType: 'dash' }));
    const back = readBoard(parse(serializeBoard(b)));

    expect(back.textBoxes).toHaveLength(1);
    expect(back.textBoxes[0]!.text).toBe('hi');
    expect(back.textBoxes[0]!.knockout).toBe(true);
    expect(back.textBoxes[0]!.strokeType).toBe('dash');
    expect(back.textBoxes[0]!.margins.left).toBe(MM(1));
  });
});
