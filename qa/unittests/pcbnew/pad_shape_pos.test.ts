// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `(drill … (offset x y))` moves the pad's COPPER, not its hole.
 *
 *     VECTOR2I PAD::ShapePos( PCB_LAYER_ID aLayer ) const
 *     {
 *         if( GetOffset( aLayer ) == VECTOR2I( 0, 0 ) ) return m_pos;
 *         VECTOR2I loc_offset = GetOffset( aLayer );
 *         RotatePoint( loc_offset, GetOrientation() );
 *         return m_pos + loc_offset;
 *     }
 *
 * while `GetEffectiveHoleShape()` builds its `SHAPE_SEGMENT` from `m_pos`. Every
 * TO-92 on the `complex_hierarchy` demo carries a 0.4 mm offset, and the pour's
 * reliefs and spokes were 0.4 mm off around all of them when the pair was the
 * other way round.
 *
 * The three expected positions are KiCad 10.0.5's own answers for that board,
 * read back through `pad.ShapePos( pcbnew.F_Cu )`.
 */
import { describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

/** One TO-92 pad 1 in a footprint at the origin, so its position is board-absolute. */
const padAt = (x: number, y: number, angle: number, drill = '(drill 0.75 (offset 0 0.4))'): PAD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (net 0 "")
  (footprint "TO-92" (layer "F.Cu") (uuid "aaaaaaaa-0000-4000-8000-000000000001") (at 0 0)
    (pad "1" thru_hole rect (at ${x} ${y} ${angle}) (size 1.1 1.8) ${drill} (layers "*.Cu")
      (uuid "aaaaaaaa-0000-4000-8000-000000000002"))))`)
    .Footprints()[0]!
    .Pads()[0]!;

/** The centre of the box the pad's F.Cu copper covers. */
const copperCentre = (p: PAD): { x: number; y: number } =>
  p.GetEffectivePolygon(PCB_LAYER_ID.F_Cu, ERROR_LOC.ERROR_INSIDE).BBox().Centre();

describe('PAD::ShapePos', () => {
  it('answers what KiCad answers for complex_hierarchy, at every orientation', () => {
    // Q201 pad 1: (at 131.445 115.316 0), offset (0, 0.4) -> (131.445, 115.716)
    expect(padAt(131.445, 115.316, 0).ShapePos(PCB_LAYER_ID.F_Cu)).toEqual({
      x: MM(131.445),
      y: MM(115.716),
    });
    // U101 pad 1: (at 124.206 70.866 90), offset (0, 0.4) -> (124.606, 70.866)
    expect(padAt(124.206, 70.866, 90).ShapePos(PCB_LAYER_ID.F_Cu)).toEqual({
      x: MM(124.606),
      y: MM(70.866),
    });
    // Q203 pad 1: (at 151.765 123.825 180), offset (0, 0.4) -> (151.765, 123.425)
    expect(padAt(151.765, 123.825, 180).ShapePos(PCB_LAYER_ID.F_Cu)).toEqual({
      x: MM(151.765),
      y: MM(123.425),
    });
  });

  it('leaves a pad with no offset exactly on its position', () => {
    const p = padAt(10, 10, 0, '(drill 0.75)');
    expect(p.ShapePos(PCB_LAYER_ID.F_Cu)).toEqual(p.GetPosition());
  });

  it('puts the copper on ShapePos and the hole on the position', () => {
    const p = padAt(10, 10, 0);
    expect(copperCentre(p)).toEqual({ x: MM(10), y: MM(10.4) });
    expect(p.GetEffectiveHoleShape()!.Centre()).toEqual({ x: MM(10), y: MM(10) });
  });

  it('turns the offset with the pad, so the copper leads the rotation', () => {
    // RotatePoint( (0, 0.4), 90° ) is (0.4, 0) in KiCad's y-down frame.
    expect(copperCentre(padAt(10, 10, 90))).toEqual({ x: MM(10.4), y: MM(10) });
  });
});
