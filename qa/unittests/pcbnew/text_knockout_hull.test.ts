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
 * The tolerance is half a micron: the four decimals the oracle printed.
 * The same call runs here, on the live PCB_TEXT the parser builds.
 */
import { describe, it, expect } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);
const TOL = MM(0.0005);

/** The demo's text, with its angle and thickness open to the test. */
const hull = (angle = 90, thickness = 0.3048) => {
  const b = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (gr_text "Complex hierarchy\\nDemo" (at 182 63 ${angle}) (layer "B.Cu")
    (uuid "00000000-0000-4000-8000-000000000001")
    (effects (font (size 2.032 1.524) (thickness ${thickness})) (justify mirror))))`);
  const t = b.Drawings()[0]!;
  const ps = new SHAPE_POLY_SET();
  t.TransformShapeToPolygon(ps, t.GetLayer(), 0, MM(0.005), ERROR_LOC.ERROR_OUTSIDE);
  expect(ps.OutlineCount()).toBe(1);
  // buildBoundingHull: an oriented rectangle, four corners.
  expect(ps.Outline(0).PointCount()).toBe(4);
  const bb = ps.BBox();
  return { x0: bb.GetX(), x1: bb.GetRight(), y0: bb.GetY(), y1: bb.GetBottom() };
};

describe('text knockout hull', () => {
  it('lands where KiCad 10.0.5 puts it on complex_hierarchy', () => {
    const b = hull();
    expect(Math.abs(b.x0 - MM(179.0964))).toBeLessThan(TOL);
    expect(Math.abs(b.x1 - MM(184.7202))).toBeLessThan(TOL);
    expect(Math.abs(b.y0 - MM(52.462))).toBeLessThan(TOL);
    expect(Math.abs(b.y1 - MM(73.6103))).toBeLessThan(TOL);
  });

  it('is a 90° turn away from the same block laid out flat', () => {
    // The hull is oriented: rotating the item swaps which board axis carries
    // the string and which carries the two lines.
    const turned = hull(0);
    expect(Math.abs(turned.x1 - turned.x0 - (MM(73.6103) - MM(52.462)))).toBeLessThan(2 * TOL);
    expect(Math.abs(turned.y1 - turned.y0 - (MM(184.7202) - MM(179.0964)))).toBeLessThan(2 * TOL);
  });

  it('moves by the pen fudge alone when the thickness is cleared', () => {
    // `getLinePositions` reads the stored thickness: drop it and the block
    // shifts by `thickness * 0.052` across the lines — it does NOT stay put.
    const thin = hull(90, 0);
    const thick = hull();
    expect((thin.x0 + thin.x1) / 2 - (thick.x0 + thick.x1) / 2).toBeCloseTo(MM(0.3048) * 0.052, -2);
  });
});
