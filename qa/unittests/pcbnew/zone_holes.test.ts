// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A zone's cutouts — the `(polygon …)`s after the first.
 *
 * `parseZONE` (pcb_io_kicad_sexpr_parser.cpp:8288-8310): "The first polygon is
 * the main outline. Others are holes inside the main outline." Ours read the
 * first and dropped the rest, so a cutout filled over, a saved zone lost it
 * (the writer emits the zone from the model), and a corner drag rewrote every
 * polygon node with the outline's points. #13's zone-hole item.
 *
 * No board in the corpus has one — which is how vertex-identical fills on
 * every corpus board and a dropped cutout were both true.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { fillZone } from '@ziroeda/pcbnew/src/zone_filler.js';
import { moveBoardItems, moveZoneCorner } from '@ziroeda/pcbnew/src/edit-board.js';
import { PCB_IU_PER_MM as MM } from '@ziroeda/common/src/eda_units.js';

const BOARD = `(kicad_pcb (version 20241229) (generator "t")
  (general (thickness 1.6)) (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "") (net 1 "GND")
  (gr_rect (start 80 80) (end 130 130) (stroke (width 0.1) (type default)) (fill no) (layer "Edge.Cuts"))
  (zone (net 1) (net_name "GND") (layer "F.Cu") (uuid "z") (hatch edge 0.5)
    (connect_pads (clearance 0.5)) (min_thickness 0.25)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 90 90) (xy 120 90) (xy 120 120) (xy 90 120)))
    (polygon (pts (xy 100 100) (xy 110 100) (xy 110 110) (xy 100 110))))
)`;

const area = (polys: { x: number; y: number }[][]): number => {
  let total = 0;
  for (const poly of polys) {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
      a += (poly[j]!.x + poly[i]!.x) * (poly[j]!.y - poly[i]!.y);
    total += a / 2;
  }
  return Math.abs(total) / (MM * MM);
};

describe('a zone with a cutout', () => {
  it('reads the outline and the hole as two rings', () => {
    const z = readBoard(parse(BOARD)).zones[0]!;
    expect(z.outline?.length).toBe(4);
    expect(z.holes?.length).toBe(1);
    expect(z.holes?.[0]?.[0]).toEqual({ x: 100 * MM, y: 100 * MM });
  });

  it('writes both polygons back, outline first', () => {
    const b = readBoard(parse(BOARD));
    // A zone with no source node — one the zone dialog rebuilt, or a new one —
    // is what `buildZoneNode` writes from the model; a read one hands its own
    // text through, holes and all, whichever way the writer is bent.
    const rebuilt = {
      ...b,
      zones: b.zones.map((z) => ({ ...z, source: { kind: 'list' as const, items: [] } })),
    };
    const moved = moveBoardItems(rebuilt, new Set(['zone:0']), { x: MM, y: 0 });
    const out = serializeBoard(moved);
    const polys = [...out.matchAll(/\(polygon\s*\(pts\s*\(xy ([\d.]+) ([\d.]+)\)/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(polys).toEqual([
      [91, 90],
      [101, 100],
    ]);
  });

  it('is filled outside the hole and not inside it', () => {
    const b = readBoard(parse(BOARD));
    const fill = fillZone(b, 0)[0]!.polys;
    // 30 x 30 less the 10 x 10 cutout, less the 0.5 mm edge inset on both
    // rings (min_thickness / 2 out and back in, netting to a clearance-shaped
    // apron): well under 900 and well over the 800 a pour with no hole cannot
    // reach.
    const a = area(fill);
    expect(a).toBeLessThan(820);
    expect(a).toBeGreaterThan(700);
  });

  it('keeps the hole when a corner of the outline is dragged', () => {
    const b = readBoard(parse(BOARD));
    const dragged = moveZoneCorner(b, 0, 0, { x: 85 * MM, y: 85 * MM });
    const out = serializeBoard(dragged);
    expect(out).toContain('(xy 85 85)');
    expect(out).toContain('(xy 100 100)');
    expect(dragged.zones[0]!.holes?.length).toBe(1);
  });
});
