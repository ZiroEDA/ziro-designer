// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The oriented bounding hull a pour keeps clear of around copper lettering —
 * `PCB_TEXT::TransformShapeToPolygon` → `buildBoundingHull`.
 *
 * The expectation is not derived from this code. It is what the installed
 * KiCad 10.0.5 answers for the `B.Cu` text on the `complex_hierarchy` demo,
 * asked through its own Python API:
 *
 *     t.TransformShapeToPolygon( ps, t.GetLayer(), 0, 5000, pcbnew.ERROR_OUTSIDE )
 *     ->  (179.0964, 73.6103) (179.0964, 52.462) (184.7202, 52.462) (184.7202, 73.6103)
 *
 * A two-line mirrored label turned 90°, which is the shape that exposed the
 * placement bug: with the block positioned by `size / 2` the hull came out
 * 0.196 mm to one side, and the pour cut its 5.6 x 21 mm hole in the wrong
 * place — 8 mm² of copper on the wrong side of the letters.
 *
 * The tolerance is half a micron: the hull is measured off the stroke
 * polygons `TransformOvalToPolygon` builds, inflated by the same `maxError`
 * (5 µm here) upstream applies under ERROR_OUTSIDE, so what is left is the
 * rounding of a vertex to a whole unit and the four decimals the oracle
 * printed.
 */
import { describe, it, expect } from 'vitest';
import { textShapes } from '@ziroeda/pcbnew/src/text_geometry.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { PcbTextItem } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const TOL = MM(0.0005);

/**
 *     (gr_text "Complex hierarchy\nDemo"
 *       (at 182 63 90) (layer "B.Cu")
 *       (effects (font (size 2.032 1.524) (thickness 0.3048)) (justify mirror)))
 */
const text = (over: Partial<PcbTextItem> = {}): PcbTextItem => ({
  kind: 'user',
  text: 'Complex hierarchy\nDemo',
  at: { x: MM(182), y: MM(63) },
  angle: 90,
  layer: 'B.Cu',
  // The reader swaps the file's `(size height width)` into (width, height).
  size: { x: MM(1.524), y: MM(2.032) },
  thickness: MM(0.3048),
  justify: ['mirror'],
  mirror: true,
  ...over,
});

const box = (t: PcbTextItem) => {
  const shapes = textShapes(t, MM(0.005));
  expect(shapes).toHaveLength(1);
  const pts = (shapes[0] as { pts: { x: number; y: number }[] }).pts;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

describe('text knockout hull', () => {
  it('lands where KiCad 10.0.5 puts it on complex_hierarchy', () => {
    const b = box(text());
    expect(Math.abs(b.x0 - MM(179.0964))).toBeLessThan(TOL);
    expect(Math.abs(b.x1 - MM(184.7202))).toBeLessThan(TOL);
    expect(Math.abs(b.y0 - MM(52.462))).toBeLessThan(TOL);
    expect(Math.abs(b.y1 - MM(73.6103))).toBeLessThan(TOL);
  });

  it('is a 90° turn away from the same block laid out flat', () => {
    // The hull is oriented: rotating the item swaps which board axis carries
    // the string and which carries the two lines.
    const turned = box(text({ angle: 0 }));
    expect(Math.abs(turned.x1 - turned.x0 - (MM(73.6103) - MM(52.462)))).toBeLessThan(2 * TOL);
    expect(Math.abs(turned.y1 - turned.y0 - (MM(184.7202) - MM(179.0964)))).toBeLessThan(2 * TOL);
  });

  it('moves by the pen fudge alone when the thickness is cleared', () => {
    // `getLinePositions` reads the stored thickness: drop it and the block
    // shifts by `thickness * 0.052` across the lines and the hull narrows by
    // the pen it is grown with — it does NOT stay put, and it does not move by
    // the effective pen KiCad would still stroke it with.
    const thin = box(text({ thickness: 0 }));
    const thick = box(text());
    // Across the lines (board x here) the block centre moves by the fudge — to
    // 50 units, since the two pens round their stroke caps to different segment
    // counts and that moves the hull's edges by a few tens of units as well.
    expect((thin.x0 + thin.x1) / 2 - (thick.x0 + thick.x1) / 2).toBeCloseTo(MM(0.3048) * 0.052, -2);
  });

  it('gives a hidden text no hull at all', () => {
    // "if( text->IsVisible() )" guards the knockout in `addKnockout`.
    expect(textShapes(text({ hide: true }), MM(0.005))).toHaveLength(0);
  });
});
