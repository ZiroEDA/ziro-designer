// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What ZONE_FILLER does that the kicad-cli fixtures (zone_fill_kicad_exact_live)
 * have no board for: a zone's cutouts, a zone's per-layer hatch offset, and a
 * keepout rule area. Each was pinned on the view board's pour before it was
 * deleted; these are the same claims on the live filler.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import { pcbMmToIU as MM } from '@ziroeda/common/eda_units.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { ZONE } from '@ziroeda/pcbnew/zone.js';
import { fillAll, filledArea, filledRings, fillLive, loadForFill } from './support/live_fill.js';

beforeAll(async () => {
  await EMBEDDED_FILES.InitCodec();
});

const mm2 = (aArea: number): number => aArea / (MM(1) * MM(1));

describe('a zone with a cutout (parseZONE: polygons after the first are holes)', () => {
  const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "t")
  (general (thickness 1.6)) (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "") (net 1 "GND")
  (gr_rect (start 80 80) (end 130 130) (stroke (width 0.1) (type default)) (fill no) (layer "Edge.Cuts"))
  (zone (net 1) (net_name "GND") (layer "F.Cu") (uuid "aaaaaaaa-0000-4000-8000-000000000001") (hatch edge 0.5)
    (connect_pads (clearance 0.5)) (min_thickness 0.25)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5) (island_removal_mode 1))
    (polygon (pts (xy 90 90) (xy 120 90) (xy 120 120) (xy 90 120)))
    (polygon (pts (xy 100 100) (xy 110 100) (xy 110 110) (xy 100 110))))
)`;

  it('is filled outside the hole and not inside it', () => {
    const zone = fillLive(BOARD_TEXT).Zones()[0]!;
    // 30 x 30 less the 10 x 10 cutout, less the min_thickness/2 apron on both
    // rings: under 820, and over the 700 a pour that lost more than the hole
    // cannot reach.
    const a = mm2(filledArea(zone));
    expect(a).toBeLessThan(820);
    expect(a).toBeGreaterThan(700);
  });
});

describe('a zone’s hatch offset (addHatchFillTypeOnZone, zone_filler.cpp:3929-3958)', () => {
  const TEXT = (
    aLayers: string,
    aProps = '',
  ): string => `(kicad_pcb (version 20241229) (generator "test")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup)
  (net 0 "")
  (zone
    (net 0) (net_name "") (layers ${aLayers}) (uuid "aaaaaaaa-0000-4000-8000-000000000002") (hatch edge 0.5)
    (connect_pads (clearance 0.5))
    (min_thickness 0.25)
    (fill yes (mode hatch) (thermal_gap 0.5) (thermal_bridge_width 0.5)
      (hatch_thickness 1) (hatch_gap 2) (hatch_orientation 0)
      (hatch_smoothing_level 0) (hatch_smoothing_value 0.1)
      (hatch_min_hole_area 0.3) (island_removal_mode 1))
    ${aProps}
    (polygon (pts (xy 0 0) (xy 20 0) (xy 20 20) (xy 0 20)))
  )
)`;

  /** A short stable signature of a zone's fill on one layer: vertex count and a hash. */
  const signature = (aZone: ZONE, aLayer: string, aBoard: BOARD): string => {
    let h = 0;
    let n = 0;
    for (const ring of filledRings(aZone, aBoard.GetLayerID(aLayer)))
      for (const v of ring) {
        h = (Math.imul(h ^ v.x, 0x01000193) ^ v.y) >>> 0;
        n++;
      }
    return `${n}:${h.toString(16)}`;
  };
  const fill = (aLayers: string, aProps = ''): { zone: ZONE; board: BOARD } => {
    const board = fillLive(TEXT(aLayers, aProps));
    return { zone: board.Zones()[0]!, board };
  };
  const at = (aLayer: string, x: number, y: number): string =>
    `(property (layer "${aLayer}") (hatch_position (xy ${x} ${y})))`;

  it('shifts the hatch grid on the layer it names', () => {
    const plain = fill('"F.Cu"');
    const shifted = fill('"F.Cu"', at('F.Cu', 1, 1));
    expect(signature(plain.zone, 'F.Cu', plain.board)).not.toBe('0:0');
    expect(signature(shifted.zone, 'F.Cu', shifted.board)).not.toBe(
      signature(plain.zone, 'F.Cu', plain.board),
    );
  });

  it('leaves a layer it does not name alone, per layer of a two-layer zone', () => {
    const plain = fill('"F.Cu" "B.Cu"');
    const shifted = fill('"F.Cu" "B.Cu"', at('B.Cu', 7, 7));
    expect(signature(shifted.zone, 'F.Cu', shifted.board)).toBe(
      signature(plain.zone, 'F.Cu', plain.board),
    );
    expect(signature(shifted.zone, 'B.Cu', shifted.board)).not.toBe(
      signature(plain.zone, 'B.Cu', plain.board),
    );
  });

  it('applies the offset modulo the grid pitch (hatch_thickness + hatch_gap = 3 mm)', () => {
    // `hole.Move( offset.x % gridsize, … )`: 7 mm and 1 mm are the same shift.
    const one = fill('"F.Cu"', at('F.Cu', 1, 1));
    const seven = fill('"F.Cu"', at('F.Cu', 7, 7));
    expect(signature(seven.zone, 'F.Cu', seven.board)).toBe(signature(one.zone, 'F.Cu', one.board));
  });
});

describe('a keepout rule area against a pour', () => {
  const ALL_FORBIDDEN = `(keepout (tracks not_allowed) (vias not_allowed) (pads not_allowed) (copperpour not_allowed) (footprints not_allowed))`;
  const src = (opts: { keepout?: string; islandMode?: string; priority?: number } = {}): string => `
(kicad_pcb (version 20240108) (generator test)
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (net 1 "GND")
  (footprint "R" (layer "F.Cu") (at 5 5)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "GND")))
  (zone (net 1) (net_name "GND") (layer "F.Cu") (uuid "aaaaaaaa-0000-4000-8000-000000000003") (hatch edge 0.5)
    ${opts.priority !== undefined ? `(priority ${opts.priority})` : ''}
    (connect_pads (clearance 0.2))
    (min_thickness 0.25)
    (fill yes ${opts.islandMode ?? '(island_removal_mode 1)'} (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 0 0) (xy 20 0) (xy 20 20) (xy 0 20))))
  ${
    opts.keepout
      ? `(zone (net 0) (net_name "") (layer "F.Cu") (uuid "aaaaaaaa-0000-4000-8000-000000000004") (name "noCopper") (hatch edge 0.5)
    (min_thickness 0.25)
    ${opts.keepout}
    (fill yes)
    (polygon (pts (xy 12 0) (xy 20 0) (xy 20 20) (xy 12 20))))`
      : ''
  }
)`;
  const pour = (b: BOARD): ZONE => b.Zones().find((z) => !z.GetIsRuleArea())!;
  const area = (b: BOARD): number => filledArea(pour(b));

  it('never pours the rule area itself', () => {
    const b = fillLive(src({ keepout: ALL_FORBIDDEN }));
    expect(filledArea(b.Zones().find((z) => z.GetIsRuleArea())!)).toBe(0);
  });

  it('knocks a copperpour keepout out of a pour that overlaps it', () => {
    const without = area(fillLive(src()));
    expect(without).toBeGreaterThan(0);
    expect(area(fillLive(src({ keepout: ALL_FORBIDDEN })))).toBeLessThan(without);
  });

  it('leaves the pour alone when copperpour is allowed', () => {
    const allowed = `(keepout (tracks not_allowed) (vias not_allowed) (pads allowed) (copperpour allowed) (footprints allowed))`;
    expect(area(fillLive(src({ keepout: allowed })))).toBe(area(fillLive(src())));
  });

  it('knocks out regardless of priority, unlike an ordinary zone', () => {
    // Upstream tests GetIsRuleArea before the priority branch.
    const b = loadForFill(src({ keepout: ALL_FORBIDDEN, priority: 5 }));
    expect(area(fillAll(b))).toBeLessThan(area(fillLive(src({ priority: 5 }))));
  });

  it('uses the bare outline, with no clearance added', () => {
    // "Keepouts use outline with no clearance": the area starts at x = 12 mm,
    // and the copper may reach it but not pass it.
    const b = fillLive(src({ keepout: ALL_FORBIDDEN }));
    const xs = filledRings(pour(b)).flatMap((r) => r.map((p) => p.x));
    expect(Math.max(...xs)).toBeCloseTo(MM(12), -4);
  });
});

describe('island removal (ZONE_FILLER::Fill, the island loop)', () => {
  /**
   * A dumbbell pour: two 10 mm squares joined by a 1 mm neck. A same-net pad
   * anchors the left square; a foreign pad on the neck is knocked out with
   * enough clearance to sever it, so the right square becomes a real island.
   */
  const dumbbell = (aMode: string): BOARD =>
    fillLive(`(kicad_pcb (version 20240108) (generator test)
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (net 0 "") (net 1 "GND") (net 2 "VCC")
  (footprint "R" (layer "F.Cu") (at 0 0)
    (pad "1" smd rect (at 5 5) (size 2 2) (layers "F.Cu") (net 1 "GND"))
    (pad "1" smd rect (at 15 5) (size 0.5 0.5) (layers "F.Cu") (net 2 "VCC")))
  (zone (net 1) (net_name "GND") (layer "F.Cu") (uuid "aaaaaaaa-0000-4000-8000-000000000005") (hatch edge 0.5)
    (connect_pads yes (clearance 0.5))
    (min_thickness 0.25)
    (fill yes ${aMode} (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 0 0) (xy 10 0) (xy 10 4.5) (xy 20 4.5) (xy 20 0) (xy 30 0) (xy 30 10)
      (xy 20 10) (xy 20 5.5) (xy 10 5.5) (xy 10 10) (xy 0 10)))))`);
  const pieces = (b: BOARD): number => filledRings(b.Zones()[0]!).length;

  it('ALWAYS drops the severed lobe and keeps the anchored one', () => {
    expect(pieces(dumbbell('(island_removal_mode 0)'))).toBe(1);
  });

  it('NEVER keeps both', () => {
    expect(pieces(dumbbell('(island_removal_mode 1)'))).toBe(2);
  });

  it('AREA keeps an island at or above the limit, and drops one below it', () => {
    // The severed lobe is 10 x 10 mm = 100 mm².
    expect(pieces(dumbbell('(island_removal_mode 2) (island_area_min 50)'))).toBe(2);
    expect(pieces(dumbbell('(island_removal_mode 2) (island_area_min 400)'))).toBe(1);
  });
});
