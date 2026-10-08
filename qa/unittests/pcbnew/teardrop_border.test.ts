// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A teardrop zone's border style on load. KiCad's writer has no token for
 * ZONE_BORDER_DISPLAY_STYLE::INVISIBLE_BORDER, so a teardrop zone is written
 * `(hatch none …)` and `parseZONE` reads that back as NO_HATCH: nothing in the
 * parser restores INVISIBLE_BORDER (only pcb_painter.cpp:3028 consults it).
 */
import { describe, it, expect } from 'vitest';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { TEARDROP_TYPE } from '@ziroeda/pcbnew/teardrop/teardrop_parameters.js';
import { ZONE_BORDER_DISPLAY_STYLE } from '@ziroeda/pcbnew/zone_settings.js';

/** A teardrop zone as KiCad writes it: `(hatch none …)` and the attr. */
const TEARDROP_ZONE = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (net 0 "")
  (net 1 "N1")
  (zone (net 1) (net_name "N1") (layer "F.Cu") (uuid "00000000-0000-4000-8000-000000000001")
    (hatch none 0) (priority 30000) (attr (teardrop (type padvia)))
    (connect_pads yes (clearance 0)) (min_thickness 0.0254) (filled_areas_thickness no)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5) (island_removal_mode 1))
    (polygon (pts (xy 10 10) (xy 11 10) (xy 11 11))))
)`;

// Generation and writing (INVISIBLE_BORDER, `(hatch none …)`) are
// TEARDROP_MANAGER's, pinned in teardrop_manager.test.ts.
describe('teardrop zone borders', () => {
  it('reads a teardrop zone’s `none` as NO_HATCH, as parseZONE does', () => {
    const z = ParseBoard(TEARDROP_ZONE).Zones()[0]!;

    expect(z.GetTeardropAreaType()).toBe(TEARDROP_TYPE.TD_VIAPAD);
    expect(z.GetHatchStyle()).toBe(ZONE_BORDER_DISPLAY_STYLE.NO_HATCH);
  });

  it('reads a plain zone’s `none` the same way', () => {
    const z = ParseBoard(`(kicad_pcb (version 20240108)
      (zone (net 1) (net_name "N1") (layer "F.Cu") (hatch none 0.5)
        (connect_pads (clearance 0.5)) (min_thickness 0.25)
        (fill yes) (polygon (pts (xy 0 0) (xy 5 0) (xy 5 5))))
    )`).Zones()[0]!;

    expect(z.GetHatchStyle()).toBe(ZONE_BORDER_DISPLAY_STYLE.NO_HATCH);
    expect(z.GetTeardropAreaType()).toBe(TEARDROP_TYPE.TD_NONE);
  });

  it('keeps edge and full styles intact', () => {
    const b = ParseBoard(`(kicad_pcb (version 20240108)
      (zone (net 1) (layer "F.Cu") (hatch edge 0.5)
        (fill yes) (polygon (pts (xy 0 0) (xy 5 0) (xy 5 5))))
      (zone (net 1) (layer "F.Cu") (hatch full 0.5)
        (fill yes) (polygon (pts (xy 0 0) (xy 5 0) (xy 5 5))))
    )`);

    expect(b.Zones().map((z) => z.GetHatchStyle())).toEqual([
      ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE,
      ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_FULL,
    ]);
  });
});
