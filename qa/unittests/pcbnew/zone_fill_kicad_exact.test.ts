// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The pour, vertex for vertex against `kicad-cli pcb drc --refill-zones`.
 *
 * The boards under `qa/data/zone_fill/` carry the fills KiCad 10.0.5 wrote
 * for them (see the README there). Filling them again here has to reproduce
 * every `filled_polygon` in sequence — the same Clipper2, the same
 * `fillCopperZone` order of operations, the same `Fracture` slits.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PCB_IU_PER_MM as IU } from '@ziroeda/common/src/eda_units.js';
import {
  netClassClearanceMM,
  type NetClassesData,
} from '@ziroeda/common/src/project/net_settings.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import {
  fillZones,
  zoneClearanceOf,
  type ZoneFillOptions,
} from '@ziroeda/pcbnew/src/zone_filler.js';
import { parse } from '@ziroeda/sexpr/src/index.js';

const DATA = resolve(__dirname, '../../data/zone_fill');

/** `BOARD_DESIGN_SETTINGS` as the project file states it, the way the editor passes it. */
function optionsFor(stem: string, nets: Map<number, string>): ZoneFillOptions {
  let rules: Record<string, number> = {};
  let classes: { name: string; clearance?: number }[] = [];
  let patterns: { pattern: string; netclass: string }[] = [];
  try {
    const pro = JSON.parse(readFileSync(resolve(DATA, `${stem}.kicad_pro`), 'utf8'));
    rules = pro.board?.design_settings?.rules ?? {};
    classes = pro.net_settings?.classes ?? [];
    patterns = pro.net_settings?.netclass_patterns ?? [];
  } catch {
    /* no project: KiCad's defaults */
  }
  const netClasses: NetClassesData = {
    classes: classes.map((c) => ({
      name: c.name,
      clearance: c.clearance === undefined ? '' : String(c.clearance),
    })) as unknown as NetClassesData['classes'],
    assignments: patterns.map((a) => ({ pattern: a.pattern, netClass: a.netclass })),
    netColors: {},
  };
  const minClearance = Math.round((rules.min_clearance ?? 0) * IU);
  return {
    maxError: Math.round((rules.max_error ?? 0.005) * IU),
    edgeClearance: Math.round((rules.min_copper_edge_clearance ?? 0.5) * IU),
    holeClearance: Math.round((rules.min_hole_clearance ?? 0) * IU),
    holeToHoleMin: Math.round((rules.min_hole_to_hole ?? 0.25) * IU),
    minClearance,
    worstNetClassClearance: Math.round(Math.max(0, ...classes.map((c) => c.clearance ?? 0)) * IU),
    clearanceOf: zoneClearanceOf({
      minClearance,
      netClassClearance: (net: number) => {
        const mm = netClassClearanceMM(nets.get(net) ?? '', netClasses);
        return mm === undefined ? undefined : Math.round(mm * IU);
      },
    }),
  };
}

const refill = (stem: string) => {
  const board = readBoard(
    parse(readFileSync(resolve(DATA, `${stem}_kicad_cli.kicad_pcb`), 'utf8')),
  );
  const kicad = board.zones.map((z) => z.fills.map((f) => ({ layer: f.layer, polys: f.polys })));
  const ours = fillZones(board, optionsFor(stem, board.nets));
  return { kicad, ours };
};

describe("the pour is KiCad's, vertex for vertex", () => {
  it('ecc83-pp: one GND pour on B.Cu, 1759 vertices, thermal pads and a board edge', () => {
    const { kicad, ours } = refill('ecc83-pp');
    expect(ours.zones).toHaveLength(kicad.length);
    ours.zones.forEach((z, i) => {
      for (const k of kicad[i]!) {
        const f = z.fills.find((x) => x.layer === k.layer);
        expect(f, k.layer).toBeDefined();
        expect(f!.polys).toEqual(k.polys);
      }
    });
    expect(kicad[0]![0]!.polys[0]!.length).toBe(1759);
  }, 60_000);

  it('StickHub: five pours on two layers — fillet smoothing, an arc board edge, arc tracks', () => {
    // What this one pins that ecc83 does not: `SHAPE_POLY_SET::Fillet` on the
    // smoothed outline (radius 0.5), the board outline's arcs through
    // `SHAPE_ARC::ConvertToPolyline`, `PCB_ARC` knockouts, the item bounding
    // boxes that decide which copper below the pour is skipped, and
    // `Fracture()`'s Simplify — the Clipper pass that decides where every
    // ring starts. Without the last, 5 of its 11 rings come out rotated.
    const { kicad, ours } = refill('StickHub');
    expect(ours.zones).toHaveLength(kicad.length);
    let rings = 0;
    ours.zones.forEach((z, i) => {
      for (const k of kicad[i]!) {
        const f = z.fills.find((x) => x.layer === k.layer);
        expect(f, `zone ${i} ${k.layer}`).toBeDefined();
        expect(f!.polys, `zone ${i} ${k.layer}`).toEqual(k.polys);
        rings += k.polys.length;
      }
    });
    expect(rings).toBe(11);
  }, 60_000);

  // Three hatched zones with copper in them — the hatch40 web has none — each
  // pinning a branch `fillCopperZone` takes only for HATCH_PATTERN:
  //  - hatchpads: thermal pads and vias get RINGS (`buildHatchZoneThermalRings`)
  //    that the webbing reaches instead of the pad, a via's spokes, a same-net
  //    NONE pad routed through the clearance knockouts, and no
  //    `connect_nearby_polys`;
  //  - hatchfull: the same layout with `connect_pads yes` — pads unknocked,
  //    and every via a DISC in the set the hatch holes must not swallow, so
  //    the holes around the 0.5 mm vias are dropped for that reason instead;
  //  - hatchsmall: 0.5 mm vias at hatch-hole centres with rings small enough
  //    to sit inside one, so seven holes are dropped to keep them on the web.
  for (const stem of ['hatchpads', 'hatchfull', 'hatchsmall']) {
    it(`${stem}: a hatched zone with thermal pads and vias, ring for ring`, () => {
      const { kicad, ours } = refill(stem);
      expect(ours.zones[0]!.fills[0]!.polys).toEqual(kicad[0]![0]!.polys);
      expect(kicad[0]![0]!.polys[0]!.length).toBeGreaterThan(1000);
    });
  }

  it('custompads: custom pads — an off-centre polygon, a convex-hull clearance, spoke templates', () => {
    // Five custom pads on the hatch40 outline poured solid: a polygon whose
    // box is not centred on the anchor (the spokes start at the box centre,
    // `buildSpokesFromOrigin`), one at 20° with `(clearance convexhull)`, a
    // different-net one, a rect + two stroked lines, and one with three
    // `gr_vector` spoke templates of which one lies outside the pad.
    const { kicad, ours } = refill('custompads');
    expect(ours.zones[0]!.fills[0]!.polys).toEqual(kicad[0]![0]!.polys);
    expect(kicad[0]![0]!.polys[0]!.length).toBeGreaterThan(500);
  });

  it('hatch40: a hatched zone comes back as the same 1037-vertex web', () => {
    const { kicad, ours } = refill('hatch40');
    expect(ours.zones[0]!.fills[0]!.polys).toEqual(kicad[0]![0]!.polys);
    expect(kicad[0]![0]!.polys[0]!.length).toBe(1037);
  });
});
