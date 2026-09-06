// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text and Shape properties for board graphics (DIALOG_TEXT_PROPERTIES,
 * DIALOG_SHAPE_PROPERTIES).
 */
import { describe, it, expect } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr/src/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  applyShapeValues,
  applyTextValues,
  collectShapeValues,
  collectTextValues,
  shapeAt,
  shapePointsUsed,
  textAt,
  type ShapeValues,
  type TextValues,
} from '@ziroeda/pcbnew/src/graphic_properties.js';
import type { Board, PcbShape } from '@ziroeda/pcbnew/src/types.js';
import { buildBoardShapeNode } from '@ziroeda/pcbnew/src/write-board.js';

const MM = (n: number): number => mmToIU(n);
const load = (text: string): Board => readBoard(parse(text));
const roundTrip = (b: Board): Board => load(serializeBoard(b));
const flat = (b: Board): string => serializeBoard(b).replace(/\s+/g, ' ').replace(/ \)/g, ')');

const SRC = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (gr_text "hello" (at 10 20 30) (layer "F.SilkS") (uuid "x1")
    (effects (font (size 1.5 1) (thickness 0.2) (bold yes)) (justify left)))
  (gr_line (start 0 0) (end 10 0) (stroke (width 0.15) (type dash)) (layer "F.SilkS") (uuid "s1"))
  (gr_circle (center 30 30) (end 35 30) (stroke (width 0.1) (type solid)) (fill solid)
    (layer "B.SilkS") (uuid "s2"))
  (gr_arc (start 40 40) (mid 45 45) (end 50 40) (stroke (width 0.1) (type solid))
    (layer "Edge.Cuts") (uuid "s3"))
)`;

describe('resolution', () => {
  const b = load(SRC);

  it('finds a single text or shape, and refuses ambiguity', () => {
    expect(textAt(b, ['text:0'])).toBe(0);
    expect(textAt(b, [])).toBeNull();
    expect(shapeAt(b, ['shape:1'])).toBe(1);
    expect(shapeAt(b, ['shape:0', 'shape:1'])).toBeNull();
    expect(shapeAt(b, ['text:0'])).toBeNull();
  });
});

describe('text', () => {
  const b = load(SRC);
  const base = collectTextValues(b.texts[0]!);
  const edit = (over: Partial<TextValues>): Board => applyTextValues(b, 0, { ...base, ...over });
  const txt = (bd: Board) => bd.texts[0]!;

  it('reads the glyph box with height and width the right way round', () => {
    // The file says `(size 1.5 1)`, which is height 1.5, width 1.
    expect(base.height).toBe(MM(1.5));
    expect(base.width).toBe(MM(1));
    expect(base.thickness).toBe(MM(0.2));
    expect(base.bold).toBe(true);
    expect(base.italic).toBe(false);
    expect(base.orientation).toBe(30);
    expect(base.layer).toBe('F.SilkS');
  });

  it('is a no-op when nothing changed', () => {
    expect(applyTextValues(b, 0, base)).toBe(b);
  });

  it('changes the string', () => {
    expect(txt(roundTrip(edit({ text: 'goodbye' }))).text).toBe('goodbye');
  });

  it('writes the font size back height-first', () => {
    const out = edit({ width: MM(2), height: MM(3) });
    expect(flat(out)).toContain('(size 3 2)');

    const back = txt(roundTrip(out));
    expect(back.size).toEqual({ x: MM(2), y: MM(3) });
  });

  it('changes position, orientation and layer', () => {
    const out = txt(roundTrip(edit({ x: MM(5), y: MM(6), orientation: 90, layer: 'B.SilkS' })));

    expect(out.at).toEqual({ x: MM(5), y: MM(6) });
    expect(out.angle).toBe(90);
    expect(out.layer).toBe('B.SilkS');
  });

  it('toggles bold, italic and thickness', () => {
    const out = txt(roundTrip(edit({ bold: false, italic: true, thickness: MM(0.3) })));

    expect(out.bold).toBeFalsy();
    expect(out.italic).toBe(true);
    expect(out.thickness).toBe(MM(0.3));
  });

  it('keeps the existing justification when toggling mirror', () => {
    // The fixture is left-justified; mirroring must not throw that away.
    const on = edit({ mirrored: true });
    expect(flat(on)).toContain('(justify left mirror)');

    const off = applyTextValues(on, 0, { ...collectTextValues(txt(on)), mirrored: false });
    expect(flat(off)).toContain('(justify left)');
    expect(flat(off)).not.toContain('mirror');
  });

  it('hides and knocks out, dropping the tokens again', () => {
    const on = edit({ hidden: true, knockout: true });
    expect(txt(roundTrip(on)).hide).toBe(true);
    expect(txt(roundTrip(on)).knockout).toBe(true);

    const off = applyTextValues(on, 0, {
      ...collectTextValues(txt(on)),
      hidden: false,
      knockout: false,
    });
    expect(flat(off)).not.toContain('(hide');
    expect(flat(off)).not.toContain('(knockout');
  });

  it('locks and unlocks', () => {
    const locked = edit({ locked: true });
    expect(txt(roundTrip(locked)).locked).toBe(true);
    const back = applyTextValues(locked, 0, { ...collectTextValues(txt(locked)), locked: false });
    expect(flat(back)).not.toContain('(locked');
  });

  it('leaves the shapes and the uuid alone', () => {
    const out = roundTrip(edit({ text: 'x' }));
    expect(out.texts[0]!.uuid).toBe('x1');
    expect(out.shapes).toHaveLength(3);
  });
});

describe('shapePointsUsed', () => {
  it('names the points each kind owns', () => {
    expect(shapePointsUsed('line')).toEqual({ start: true, end: true, mid: false, center: false });
    expect(shapePointsUsed('arc')).toEqual({ start: true, end: true, mid: true, center: false });
    expect(shapePointsUsed('circle')).toEqual({
      start: false,
      end: true,
      mid: false,
      center: true,
    });
    expect(shapePointsUsed('poly')).toEqual({
      start: false,
      end: false,
      mid: false,
      center: false,
    });
  });
});

describe('shape', () => {
  const b = load(SRC);
  const lineBase = collectShapeValues(b.shapes[0]!);
  const editLine = (over: Partial<ShapeValues>): Board =>
    applyShapeValues(b, 0, { ...lineBase, ...over });
  const sh = (bd: Board, i = 0) => bd.shapes[i]!;

  it('reads the stroke, including its dash type', () => {
    expect(lineBase.lineWidth).toBe(MM(0.15));
    expect(lineBase.strokeType).toBe('dash');
    expect(lineBase.fillMode).toBe('none');
    expect(lineBase.layer).toBe('F.SilkS');
    expect(lineBase.start).toEqual({ x: 0, y: 0 });
    expect(lineBase.end).toEqual({ x: MM(10), y: 0 });
  });

  it('is a no-op when nothing changed', () => {
    expect(applyShapeValues(b, 0, lineBase)).toBe(b);
  });

  it('moves the endpoints and changes the stroke', () => {
    const out = sh(
      roundTrip(
        editLine({
          start: { x: MM(1), y: MM(2) },
          end: { x: MM(9), y: MM(8) },
          lineWidth: MM(0.25),
          strokeType: 'dot',
        }),
      ),
    );

    expect(out.start).toEqual({ x: MM(1), y: MM(2) });
    expect(out.end).toEqual({ x: MM(9), y: MM(8) });
    expect(out.width).toBe(MM(0.25));
    expect(out.strokeType).toBe('dot');
  });

  it('writes only the points the kind owns', () => {
    // A line has no mid or center; supplying them must not add tokens.
    const out = editLine({ mid: { x: MM(99), y: MM(99) }, center: { x: MM(99), y: MM(99) } });
    const line = flat(out).split('(gr_circle')[0];

    expect(line).not.toContain('(mid');
    expect(line).not.toContain('(center');
  });

  it('edits a circle through its centre and radius point', () => {
    const circle = b.shapes[1]!;
    const base = collectShapeValues(circle);
    const out = sh(
      roundTrip(
        applyShapeValues(b, 1, {
          ...base,
          center: { x: MM(31), y: MM(31) },
          end: { x: MM(38), y: MM(31) },
        }),
      ),
      1,
    );

    expect(out.center).toEqual({ x: MM(31), y: MM(31) });
    expect(out.end).toEqual({ x: MM(38), y: MM(31) });
  });

  it('edits an arc’s mid point', () => {
    const base = collectShapeValues(b.shapes[2]!);
    const out = sh(
      roundTrip(applyShapeValues(b, 2, { ...base, mid: { x: MM(45), y: MM(48) } })),
      2,
    );

    expect(out.mid).toEqual({ x: MM(45), y: MM(48) });
  });

  it('builds the fill token for the three shapes that have one, and no others', () => {
    // The builder is what a NEWLY DRAWN shape goes through, having no source to
    // copy. `format( const PCB_SHAPE* )` (pcb_io_kicad_sexpr.cpp:1071-1097)
    // writes the token for a POLY, a RECTANGLE or a CIRCLE — and for those three
    // always, `(fill no)` included — so a fresh segment must not sprout one and
    // a fresh unfilled circle must not lose one.
    const built = (s: Partial<PcbShape> & Pick<PcbShape, 'kind'>): string =>
      serialize(
        buildBoardShapeNode({
          width: 2e5,
          fillMode: 'none',
          layer: 'F.SilkS',
          source: { kind: 'list', items: [] },
          start: { x: 0, y: 0 },
          end: { x: 1e6, y: 0 },
          ...s,
        } as PcbShape),
      );

    expect(built({ kind: 'line' })).not.toContain('(fill');
    expect(built({ kind: 'arc', mid: { x: 5e5, y: 5e5 } })).not.toContain('(fill');
    expect(built({ kind: 'rect' })).toContain('(fill no)');
    expect(built({ kind: 'circle', center: { x: 0, y: 0 } })).toContain('(fill no)');
    expect(built({ kind: 'circle', center: { x: 0, y: 0 }, fillMode: 'solid' })).toContain(
      '(fill yes)',
    );
    expect(built({ kind: 'poly', pts: [], fillMode: 'hatch' })).toContain('(fill hatch)');
  });

  it('reads every (fill …) word the parser accepts', () => {
    // pcb_io_kicad_sexpr_parser.cpp:3580-3600. `yes` is the 2017 spelling of
    // `solid` and `no` of `none`; the three hatch words are their own modes, and
    // reading them as "not filled" is what silently unfilled a hatched graphic.
    const withFill = (word: string): Board => load(SRC.replace('(fill solid)', `(fill ${word})`));
    expect(withFill('yes').shapes[1]?.fillMode).toBe('solid');
    expect(withFill('solid').shapes[1]?.fillMode).toBe('solid');
    expect(withFill('no').shapes[1]?.fillMode).toBe('none');
    expect(withFill('none').shapes[1]?.fillMode).toBe('none');
    expect(withFill('hatch').shapes[1]?.fillMode).toBe('hatch');
    expect(withFill('reverse_hatch').shapes[1]?.fillMode).toBe('reverse_hatch');
    expect(withFill('cross_hatch').shapes[1]?.fillMode).toBe('cross_hatch');
  });

  it('leaves a hatched shape alone when the edit is about something else', () => {
    // The bug this replaces: the mode came back as `false`, and the next edit —
    // any edit — wrote `(fill no)` over it. A layer change must not touch it.
    const hatched = load(SRC.replace('(fill solid)', '(fill reverse_hatch)'));
    const base = collectShapeValues(hatched.shapes[1]!);
    const moved = applyShapeValues(hatched, 1, { ...base, layer: 'F.SilkS' });
    expect(moved.shapes[1]?.fillMode).toBe('reverse_hatch');
    expect(roundTrip(moved).shapes[1]?.fillMode).toBe('reverse_hatch');
  });

  it('writes the fill MODE, and only on a shape that can carry one', () => {
    // `format( const PCB_SHAPE* )` (pcb_io_kicad_sexpr.cpp:1071-1097) writes the
    // token for a POLY, a RECTANGLE or a CIRCLE — "the filled flag represents if
    // a solid fill is present on circles, rectangles and polygons" — and never
    // for a segment or an arc.
    // shapes[0] is the gr_line, so everything before `(gr_circle` in the file is
    // the segment's own node.
    const filled = editLine({ fillMode: 'solid' });
    expect(flat(filled).split('(gr_circle')[0]).not.toContain('(fill');
    expect(sh(roundTrip(filled)).fillMode).toBe('none');

    // The circle keeps all five UI_FILL_MODE values through the file. The three
    // hatch modes are the ones a boolean lost: they read back as unfilled and
    // were then written out as `(fill no)`.
    for (const mode of ['solid', 'none', 'hatch', 'reverse_hatch', 'cross_hatch'] as const) {
      const base = collectShapeValues(b.shapes[1]!);
      const out = applyShapeValues(b, 1, { ...base, fillMode: mode });
      expect(roundTrip(out).shapes[1]?.fillMode, `fill mode ${mode}`).toBe(mode);
    }
  });

  it('changes the layer', () => {
    expect(sh(roundTrip(editLine({ layer: 'B.SilkS' }))).layer).toBe('B.SilkS');
  });

  it('opens and closes a solder mask window', () => {
    const on = editLine({ hasMask: true, maskMargin: MM(0.1) });
    expect(flat(on)).toContain('(layers "F.SilkS" "F.Mask")');
    expect(flat(on)).toContain('(solder_mask_margin 0.1)');

    const back = sh(roundTrip(on));
    expect(back.layer).toBe('F.SilkS');
    expect(back.maskLayer).toBe('F.Mask');

    const off = applyShapeValues(on, 0, {
      ...collectShapeValues(back),
      hasMask: false,
      maskMargin: null,
    });
    expect(flat(off)).toContain('(layer "F.SilkS")');
    expect(flat(off).split('(gr_circle')[0]).not.toContain('F.Mask');
    expect(sh(roundTrip(off)).maskLayer).toBeUndefined();
  });

  it('locks and unlocks', () => {
    const locked = editLine({ locked: true });
    expect(sh(roundTrip(locked)).locked).toBe(true);
  });

  it('leaves the other shapes alone', () => {
    const out = roundTrip(editLine({ lineWidth: MM(0.5) }));

    expect(sh(out, 1).width).toBe(MM(0.1));
    expect(sh(out, 2).mid).toEqual({ x: MM(45), y: MM(45) });
    expect(sh(out).uuid).toBe('s1');
  });

  it('survives a collect/apply round with no edits', () => {
    const once = editLine({ lineWidth: MM(0.5) });
    expect(applyShapeValues(once, 0, collectShapeValues(sh(once)))).toBe(once);
  });
});
