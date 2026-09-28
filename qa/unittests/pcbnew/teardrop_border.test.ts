// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * ZONE_BORDER_DISPLAY_STYLE::INVISIBLE_BORDER on teardrop zones — the style
 * upstream's writer has no token for, so the reader has to restore it.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/index.js';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { Board } from '@ziroeda/pcbnew/types.js';

const load = (text: string): Board => readBoard(parse(text));

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
  it('the view shows a teardrop zone’s `none` as invisible', () => {
    // The parser reads NO_HATCH (it has no token for INVISIBLE_BORDER); the
    // view says 'invisible' for any teardrop area, as the painter draws it.
    const z = load(TEARDROP_ZONE).zones[0]!;

    expect(z.teardropType).toBe('viapad');
    expect(z.hatchStyle).toBe('invisible');
  });

  it('leaves a plain zone’s `none` alone', () => {
    const b = load(`(kicad_pcb (version 20240108)
      (zone (net 1) (net_name "N1") (layer "F.Cu") (hatch none 0.5)
        (connect_pads (clearance 0.5)) (min_thickness 0.25)
        (fill yes) (polygon (pts (xy 0 0) (xy 5 0) (xy 5 5))))
    )`);

    expect(b.zones[0]!.hatchStyle).toBe('none');
    expect(b.zones[0]!.teardropType).toBeUndefined();
  });

  it('keeps edge and full styles intact', () => {
    const b = load(`(kicad_pcb (version 20240108)
      (zone (net 1) (layer "F.Cu") (hatch edge 0.5)
        (fill yes) (polygon (pts (xy 0 0) (xy 5 0) (xy 5 5))))
      (zone (net 1) (layer "F.Cu") (hatch full 0.5)
        (fill yes) (polygon (pts (xy 0 0) (xy 5 0) (xy 5 5))))
    )`);

    expect(b.zones.map((z) => z.hatchStyle)).toEqual(['edge', 'full']);
  });
});
