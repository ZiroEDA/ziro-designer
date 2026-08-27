// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readFootprintFile } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeFootprint } from '@ziroeda/pcbnew/src/write-footprint.js';
import {
  fpItemId,
  hitTestFootprint,
  footprintBBox,
  footprintTextOnly,
  moveFootprintItems,
  rotateFootprintItems,
  mirrorFootprintItems,
  deleteFootprintItems,
  itemsInBox,
  setFootprintReference,
  setFootprintValue,
  setFootprintDescription,
  footprintStringChild,
  addPad,
  patchPad,
  addShape,
} from '@ziroeda/pcbnew/src/edit-footprint.js';
import type { PcbPad, PcbShape } from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };
import { pcbMmToIU as mmToIU, pcbIuToMM as iuToMM } from '@ziroeda/common/src/eda_units.js';
import { measureText } from '@ziroeda/common/src/font/stroke_font.js';

/** `KiROUND`: half away from zero. */
const kiRound = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

// A two-pad footprint with a silk line and a reference, in local coords.
const SRC = `(footprint "R"
	(version 20241229) (generator "pcbnew") (generator_version "9.0")
	(layer "F.Cu")
	(property "Reference" "REF**" (at 0 -1.5 0) (layer "F.SilkS")
		(effects (font (size 1 1) (thickness 0.15))))
	(property "Value" "R" (at 0 1.5 0) (layer "F.Fab")
		(effects (font (size 1 1) (thickness 0.15))))
	(pad "1" smd roundrect (at -0.8 0) (size 0.9 0.95) (layers "F.Cu" "F.Paste" "F.Mask")
		(roundrect_rratio 0.25) (pinfunction "A") (pintype "passive"))
	(pad "2" smd roundrect (at 0.8 0) (size 0.9 0.95) (layers "F.Cu" "F.Paste" "F.Mask")
		(roundrect_rratio 0.25))
	(fp_line (start -0.5 -0.6) (end 0.5 -0.6) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
)
`;

const read = () => readFootprintFile(parse(SRC))!;
const at = (fp: ReturnType<typeof read>, kind: 'pad' | 'text', i: number) =>
  kind === 'pad' ? fp.pads[i]!.at : fp.texts[i]!.at;

describe('footprint editing', () => {
  it('bounding box spans the pads once the text is hidden', () => {
    const fp = read();
    for (const t of fp.texts) t.hide = true;
    const box = footprintBBox(fp)!;
    expect(iuToMM(box.minX)).toBeCloseTo(-1.25, 3); // pad1 left edge: -0.8 - 0.45
    expect(iuToMM(box.maxX)).toBeCloseTo(1.25, 3);
  });

  it('bounding box includes the text box, not just the text anchor', () => {
    // `FOOTPRINT::GetBoundingBox( aIncludeText = true )` (pcbnew/footprint.cpp)
    // merges `text->GetBoundingBox()` for every visible text; the reference
    // "REF**" at 1 mm is wider than the 2.5 mm pad span, so it, not the pads,
    // sets minX/maxX. Growing by `t.at` alone left it at the pads.
    //
    // Derived from the C++, not from our own box:
    //   EDA_TEXT::GetTextBox -> FONT::StringBoundaryLimits (font.cpp:451-478)
    //     w = advance
    //       - KiROUND( size.x * INTER_CHAR )        stroke_font.cpp:207,283
    //       + 2 * KiROUND( thickness * 1.5 )        font.cpp:469
    //   with thickness = GetEffectiveTextPenWidth() = the stored 0.15 mm
    //   (> 1, so it wins outright), and a CENTER-justified box placed at
    //     bbox.SetX( bbox.GetX() - ( bbox.GetWidth() - italicOffset ) / 2 )
    //   i.e. C++ integer division, hence Math.trunc.
    const size = mmToIU(1);
    const thickness = mmToIU(0.15);
    const w = measureText('REF**', size) - kiRound(size * 0.2) + 2 * kiRound(thickness * 1.5);
    const box = footprintBBox(read())!;
    expect(box.minX).toBeCloseTo(-Math.trunc(w / 2), 6);
    expect(box.maxX).toBeCloseTo(w - Math.trunc(w / 2), 6);
    // …and that really is outside the pads, so this is not the old answer.
    expect(box.minX).toBeLessThan(mmToIU(-1.25));
    expect(box.maxX).toBeGreaterThan(mmToIU(1.25));
  });

  it('hit-tests a pad, a line and empty space', () => {
    const fp = read();
    expect(hitTestFootprint(fp, { x: mmToIU(-0.8), y: 0 }, 0)).toBe(fpItemId('pad', 0));
    expect(hitTestFootprint(fp, { x: mmToIU(0.8), y: 0 }, 0)).toBe(fpItemId('pad', 1));
    expect(hitTestFootprint(fp, { x: 0, y: mmToIU(-0.6) }, mmToIU(0.05))).toBe(
      fpItemId('shape', 0),
    );
    expect(hitTestFootprint(fp, { x: mmToIU(5), y: mmToIU(5) }, 0)).toBeNull();
  });

  it('box-selects overlapping items', () => {
    const ids = itemsInBox(read(), mmToIU(-2), mmToIU(-2), mmToIU(2), mmToIU(2));
    expect(ids).toContain(fpItemId('pad', 0));
    expect(ids).toContain(fpItemId('pad', 1));
    expect(ids).toContain(fpItemId('shape', 0));
  });

  it('moves a pad and the change survives a serialize round-trip', () => {
    const moved = moveFootprintItems(read(), new Set([fpItemId('pad', 0)]), {
      x: mmToIU(1),
      y: mmToIU(2),
    });
    expect(iuToMM(moved.pads[0]!.at.x)).toBeCloseTo(0.2, 6);
    expect(iuToMM(moved.pads[0]!.at.y)).toBeCloseTo(2, 6);
    const reread = readFootprintFile(parse(serializeFootprint(moved)))!;
    expect(iuToMM(reread.pads[0]!.at.x)).toBeCloseTo(0.2, 6);
    expect(iuToMM(reread.pads[0]!.at.y)).toBeCloseTo(2, 6);
    // The untouched pad and its unmodelled fields (pinfunction) survive.
    expect(iuToMM(reread.pads[1]!.at.x)).toBeCloseTo(0.8, 6);
    expect(serializeFootprint(moved)).toContain('(pinfunction "A")');
  });

  it('rotates a pad 90° CCW about the origin', () => {
    const rot = rotateFootprintItems(read(), new Set([fpItemId('pad', 0)]), true, { x: 0, y: 0 });
    // (-0.8, 0) rotated +90 (KiCad RotatePoint): (x,y) -> (y, -x) => (0, 0.8).
    expect(iuToMM(rot.pads[0]!.at.x)).toBeCloseTo(0, 6);
    expect(iuToMM(rot.pads[0]!.at.y)).toBeCloseTo(0.8, 6);
    expect(rot.pads[0]!.angle).toBe(90);
    const reread = readFootprintFile(parse(serializeFootprint(rot)))!;
    expect(reread.pads[0]!.angle).toBe(90);
  });

  it('mirrors pads across the Y axis', () => {
    const m = mirrorFootprintItems(read(), new Set([fpItemId('pad', 0), fpItemId('pad', 1)]), {
      x: 0,
      y: 0,
    });
    expect(iuToMM(m.pads[0]!.at.x)).toBeCloseTo(0.8, 6);
    expect(iuToMM(m.pads[1]!.at.x)).toBeCloseTo(-0.8, 6);
  });

  it('edits reference, value and description losslessly', () => {
    let fp = read();
    fp = setFootprintReference(fp, 'R1');
    fp = setFootprintValue(fp, '10k');
    fp = setFootprintDescription(fp, 'A 10k resistor');
    expect(fp.reference).toBe('R1');
    expect(fp.value).toBe('10k');
    const reread = readFootprintFile(parse(serializeFootprint(fp)))!;
    expect(reread.reference).toBe('R1');
    expect(reread.value).toBe('10k');
    expect(footprintStringChild(reread, 'descr')).toBe('A 10k resistor');
    // Untouched geometry + unmodelled pad fields survive.
    expect(reread.pads).toHaveLength(2);
    expect(serializeFootprint(fp)).toContain('(pinfunction "A")');
  });

  it('adds a new through-hole pad that serializes canonically', () => {
    const pad: PcbPad = {
      number: '3',
      type: 'thru_hole',
      shape: 'circle',
      at: { x: mmToIU(2), y: 0 },
      angle: 0,
      size: { x: mmToIU(1.524), y: mmToIU(1.524) },
      drill: { oblong: false, w: mmToIU(0.762), h: mmToIU(0.762) },
      layers: ['*.Cu', '*.Mask'],
      source: { kind: 'list', items: [] },
    };
    const fp = addPad(read(), pad);
    const reread = readFootprintFile(parse(serializeFootprint(fp)))!;
    expect(reread.pads).toHaveLength(3);
    const p = reread.pads[2]!;
    expect(p.number).toBe('3');
    expect(p.type).toBe('thru_hole');
    expect(p.shape).toBe('circle');
    expect(iuToMM(p.size.x)).toBeCloseTo(1.524, 4);
    expect(iuToMM(p.drill!.w)).toBeCloseTo(0.762, 4);
    expect(p.layers).toEqual(['*.Cu', '*.Mask']);
    // The earlier pads (with pinfunction) are untouched.
    expect(serializeFootprint(fp)).toContain('(pinfunction "A")');
  });

  it('patches an existing pad, keeping unmodelled fields', () => {
    const fp = read();
    const edited = patchPad(fp.pads[0]!, {
      number: '7',
      shape: 'rect',
      size: { x: mmToIU(1.2), y: mmToIU(1.4) },
    });
    const fp2 = { ...fp, pads: fp.pads.map((p, i) => (i === 0 ? edited : p)) };
    const reread = readFootprintFile(parse(serializeFootprint(fp2)))!;
    const p = reread.pads[0]!;
    expect(p.number).toBe('7');
    expect(p.shape).toBe('rect');
    expect(iuToMM(p.size.x)).toBeCloseTo(1.2, 4);
    expect(iuToMM(p.size.y)).toBeCloseTo(1.4, 4);
    // pinfunction/pintype on pad 1 were not modelled but must survive the edit.
    const out = serializeFootprint(fp2);
    expect(out).toContain('(pinfunction "A")');
    expect(out).toContain('(pintype "passive")');
  });

  it('adds silk graphics (line + circle) that round-trip on their layer', () => {
    const line: PcbShape = {
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: mmToIU(1), y: 0 },
      width: mmToIU(0.1),
      fill: false,
      layer: 'F.SilkS',
      source: EMPTY,
    };
    const circle: PcbShape = {
      kind: 'circle',
      center: { x: 0, y: 0 },
      end: { x: mmToIU(0.5), y: 0 },
      width: mmToIU(0.1),
      fill: false,
      layer: 'F.SilkS',
      source: EMPTY,
    };
    const fp = addShape(addShape(read(), line), circle);
    const reread = readFootprintFile(parse(serializeFootprint(fp)))!;
    expect(reread.shapes.filter((s) => s.kind === 'line')).toHaveLength(2); // the original + the new one
    const c = reread.shapes.find((s) => s.kind === 'circle')!;
    expect(c.layer).toBe('F.SilkS');
    expect(iuToMM(Math.hypot(c.end!.x - c.center!.x, c.end!.y - c.center!.y))).toBeCloseTo(0.5, 4);
  });

  it('deletes selected items and reindexes', () => {
    const d = deleteFootprintItems(read(), new Set([fpItemId('pad', 0)]));
    expect(d.pads).toHaveLength(1);
    expect(iuToMM(d.pads[0]!.at.x)).toBeCloseTo(0.8, 6); // old pad 2 is now pad 0
    void at; // (helper kept for readability of intent)
  });
});

/**
 * `FOOTPRINT::GetBoundingBox( bool aIncludeText )` and `FOOTPRINT::TextOnly()`
 * (`pcbnew/footprint.cpp:1749-1761, 1770+`).
 *
 * The `false` case has exactly one caller upstream —
 * `FOOTPRINT_PREVIEW_PANEL::fitToCurrentFootprint`, which passes `TextOnly()` —
 * and the chooser's footprint preview had no equivalent at all: it fitted the
 * whole scene, text and all, so the F.Fab value string (wider than the part on
 * most library footprints) decided the zoom and the part came out small.
 */
describe('the text-excluded bounding box', () => {
  it('drops the text and keeps the pads and graphics', () => {
    const withText = footprintBBox(read(), true)!;
    const without = footprintBBox(read(), false)!;

    // "REF**" at 1 mm is wider than the 2.5 mm pad span and sits above the silk
    // line, so excluding it must pull both the left edge and the top in.
    expect(without.minX).toBeGreaterThan(withText.minX);
    expect(without.minY).toBeGreaterThan(withText.minY);
    // What is left is the pads and the silk line: pad 1's left edge at
    // -0.8 - 0.45 mm, pad 2's right edge at 0.8 + 0.45 mm.
    expect(iuToMM(without.minX)).toBeCloseTo(-1.25, 3);
    expect(iuToMM(without.maxX)).toBeCloseTo(1.25, 3);
  });

  it('defaults to including it, which is what every other caller wants', () => {
    expect(footprintBBox(read())).toEqual(footprintBBox(read(), true));
  });
});

describe('TextOnly', () => {
  it('is false for a footprint with graphics', () => {
    expect(footprintTextOnly(read())).toBe(false);
  });

  it('is true for one whose only drawings are text', () => {
    const textish = readFootprintFile(
      parse(`(footprint "T" (version 20241229) (generator "t") (layer "F.Cu")
	(property "Reference" "REF**" (at 0 -1 0) (layer "F.SilkS")
		(effects (font (size 1 1) (thickness 0.15))))
	(pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu")))`),
    )!;

    // Pads are not drawings: `TextOnly` walks `m_drawings` only, so a
    // footprint that is nothing but pads answers true — deliberately, since
    // its caller is deciding whether the fit box may drop the text.
    expect(footprintTextOnly(textish)).toBe(true);
  });
});
