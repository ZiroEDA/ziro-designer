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
  });

  it('hatch40: a hatched zone comes back as the same 1037-vertex web', () => {
    const { kicad, ours } = refill('hatch40');
    expect(ours.zones[0]!.fills[0]!.polys).toEqual(kicad[0]![0]!.polys);
    expect(kicad[0]![0]!.polys[0]!.length).toBe(1037);
  });
});
