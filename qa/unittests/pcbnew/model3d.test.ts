// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint 3D model references: `parse3DModel` into FOOTPRINT::Models().
 */
import { describe, it, expect } from 'vitest';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (footprint "Test:Cap"
    (layer "F.Cu")
    (at 100 50 90)
    (pad "1" thru_hole circle (at 0 0) (size 1.5 1.5) (drill 0.8) (layers "*.Cu" "*.Mask"))
    (model "\${KICAD6_3DMODEL_DIR}/Capacitor_THT.3dshapes/CP_Axial.wrl"
      (offset (xyz 0 0 0.5))
      (scale (xyz 1 1 1))
      (rotate (xyz 0 0 90))))
  (footprint "Test:NoModel"
    (layer "B.Cu")
    (at 120 60 0)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "B.Cu")))
)`;

describe('footprint 3D models', () => {
  it('parses (model …) path, offset, scale, rotate', () => {
    const b = ParseBoard(BOARD);
    expect(b.Footprints().length).toBe(2);
    const m = b.Footprints()[0]!.Models();
    expect(m.length).toBe(1);
    expect(m[0]!.m_Filename).toContain('CP_Axial.wrl');
    expect(m[0]!.m_Filename).toContain('${KICAD6_3DMODEL_DIR}');
    expect(m[0]!.m_Offset).toEqual({ x: 0, y: 0, z: 0.5 });
    expect(m[0]!.m_Scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(m[0]!.m_Rotation).toEqual({ x: 0, y: 0, z: 90 });
    expect(m[0]!.m_Show).toBe(true);
  });

  it('footprints without a model get an empty list', () => {
    expect(ParseBoard(BOARD).Footprints()[1]!.Models()).toEqual([]);
  });

  // PCB_IO_KICAD_SEXPR_PARSER::parse3DModel: the legacy `(at (xyz …))` offset
  // variant is in inches, upstream multiplies by 25.4 into mm.
  it('converts legacy (at (xyz …)) offsets from inches to mm', () => {
    const b = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
        (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
        (footprint "Test:Legacy" (layer "F.Cu") (at 0 0)
          (model "x.wrl" (at (xyz 0.1 0 -0.05)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))))`);
    const m = b.Footprints()[0]!.Models()[0]!;
    expect(m.m_Offset.x).toBeCloseTo(2.54);
    expect(m.m_Offset.y).toBeCloseTo(0);
    expect(m.m_Offset.z).toBeCloseTo(-1.27);
  });

  it('parses (opacity …) like FP_3DMODEL::m_Opacity', () => {
    const b = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
        (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
        (footprint "Test:Ghost" (layer "F.Cu") (at 0 0)
          (model "x.wrl" (opacity 0.4) (offset (xyz 0 0 0))))
        (footprint "Test:Solid" (layer "F.Cu") (at 5 0)
          (model "y.wrl" (offset (xyz 0 0 0)))))`);
    expect(b.Footprints()[0]!.Models()[0]!.m_Opacity).toBeCloseTo(0.4);
    // FP_3DMODEL's own default (footprint.h): fully opaque.
    expect(b.Footprints()[1]!.Models()[0]!.m_Opacity).toBe(1);
  });
});
