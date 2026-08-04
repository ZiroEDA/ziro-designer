// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Zone filling (ZONE_FILLER): the pour keeps clearance from other nets, opens a
 * thermal relief around its own pads and bridges back to them with spokes, and
 * drops islands that reach nothing.
 */
import { PCB_IU_PER_MM } from '@ziroeda/common/src/eda_units.js';
import { describe, it, expect } from 'vitest';
import { fillZone, fillZones } from '@ziroeda/pcbnew/src/zone_filler.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type {
  Board,
  PadPrimitive,
  PcbFootprint,
  PcbPad,
  PcbZone,
} from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };
const MM = (n: number): number => mmToIU(n);

const pad = (at: { x: number; y: number }, net: number, size = MM(2)): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at,
  angle: 0,
  size: { x: size, y: size },
  layers: ['F.Cu'],
  net,
  source: EMPTY,
});
const footprint = (pads: PcbPad[]): PcbFootprint => ({
  lib: 'R',
  at: { x: 0, y: 0 },
  angle: 0,
  layer: 'F.Cu',
  pads,
  shapes: [],
  texts: [],
  models: [],
  source: EMPTY,
});

/** A 40 x 40 mm pour on F.Cu, net 1, with KiCad's default fill settings. */
const zone = (over: Partial<PcbZone> = {}): PcbZone => ({
  net: 1,
  layers: ['F.Cu'],
  outline: [
    { x: 0, y: 0 },
    { x: MM(40), y: 0 },
    { x: MM(40), y: MM(40) },
    { x: 0, y: MM(40) },
  ],
  fills: [],
  padConnection: 'thermal',
  clearance: MM(0.5),
  minThickness: MM(0.25),
  thermalGap: MM(0.5),
  thermalBridgeWidth: MM(0.5),
  filled: true,
  priority: 0,
  source: EMPTY,
  ...over,
});

const board = (over: Partial<Board>): Board => ({
  version: 20241229,
  layers: [],
  nets: new Map([
    [1, 'GND'],
    [2, 'VCC'],
  ]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  groups: [],
  source: EMPTY,
  ...over,
});

/** Total filled area in mm², holes (wound the other way) subtracting. */
const area = (polys: { x: number; y: number }[][]): number => {
  let total = 0;
  for (const poly of polys) {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
      a += (poly[j]!.x + poly[i]!.x) * (poly[j]!.y - poly[i]!.y);
    total += a / 2;
  }
  return Math.abs(total) / (PCB_IU_PER_MM * PCB_IU_PER_MM);
};

describe('zone filler', () => {
  it('pours the whole outline when nothing is in the way', () => {
    const b = board({ zones: [zone()] });
    const fills = fillZone(b, 0);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.layer).toBe('F.Cu');
    expect(area(fills[0]!.polys)).toBeCloseTo(1600, 0); // 40 x 40
  });

  it('keeps clearance from another net, leaving a hole around it', () => {
    const b = board({
      zones: [zone()],
      footprints: [footprint([pad({ x: MM(20), y: MM(20) }, 2)])],
    });
    const filled = area(fillZone(b, 0)[0]!.polys);
    // A 2 mm pad plus 0.5 mm clearance all round: a 3 x 3 mm bite, with rounded
    // corners, so a little less than 9 mm².
    expect(filled).toBeLessThan(1600);
    expect(1600 - filled).toBeGreaterThan(8);
    expect(1600 - filled).toBeLessThan(9.5);
  });

  it('opens a thermal relief around its own pad and bridges back with spokes', () => {
    const b = board({
      zones: [zone()],
      footprints: [footprint([pad({ x: MM(20), y: MM(20) }, 1)])],
    });
    const filled = area(fillZone(b, 0)[0]!.polys);
    // The relief ring is knocked out (2 mm pad + 0.5 mm gap = 3 x 3) but four
    // 0.5 mm spokes are added back across it, so less is removed than a plain
    // clearance hole of the same size.
    expect(1600 - filled).toBeGreaterThan(4);
    expect(1600 - filled).toBeLessThan(8.5);
  });

  it('a solid connection leaves the pad fully covered', () => {
    const b = board({
      zones: [zone({ padConnection: 'full' })],
      footprints: [footprint([pad({ x: MM(20), y: MM(20) }, 1)])],
    });
    expect(area(fillZone(b, 0)[0]!.polys)).toBeCloseTo(1600, 0);
  });

  it('keeps clearance from a track on another net', () => {
    const b = board({
      zones: [zone()],
      tracks: [
        {
          start: { x: 0, y: MM(20) },
          end: { x: MM(40), y: MM(20) },
          width: MM(1),
          layer: 'F.Cu',
          net: 2,
          source: EMPTY,
        },
      ],
    });
    const fills = fillZone(b, 0);
    // The track cuts the pour clean in two.
    expect(fills[0]!.polys.length).toBe(2);
    // 40 mm long, 1 mm wide + 0.5 mm either side = 2 mm of copper removed.
    expect(1600 - area(fills[0]!.polys)).toBeGreaterThan(75);
  });

  it('drops an island that reaches nothing on the net', () => {
    // A track on another net splits the pour; the net's only pad is in the
    // upper half, so the lower half is an island and goes.
    const b = board({
      zones: [zone()],
      footprints: [footprint([pad({ x: MM(20), y: MM(5) }, 1)])],
      tracks: [
        {
          start: { x: 0, y: MM(20) },
          end: { x: MM(40), y: MM(20) },
          width: MM(1),
          layer: 'F.Cu',
          net: 2,
          source: EMPTY,
        },
      ],
    });
    const fills = fillZone(b, 0);
    // What is left is the half holding the pad: every ring, the outer one and
    // the four the spokes cut the thermal relief into, lies above the track.
    expect(fills[0]!.polys.every((ring) => ring.every((p) => p.y < MM(21)))).toBe(true);
    // Just under half the pour: 40 x ~19.5 mm, less the relief.
    expect(area(fills[0]!.polys)).toBeGreaterThan(700);
    expect(area(fills[0]!.polys)).toBeLessThan(790);
  });

  it('a higher-priority zone knocks this one out', () => {
    const b = board({
      zones: [
        zone(),
        zone({
          net: 2,
          priority: 1,
          outline: [
            { x: MM(10), y: MM(10) },
            { x: MM(20), y: MM(10) },
            { x: MM(20), y: MM(20) },
            { x: MM(10), y: MM(20) },
          ],
        }),
      ],
    });
    // 10 x 10 mm knocked out, plus clearance around it.
    expect(1600 - area(fillZone(b, 0)[0]!.polys)).toBeGreaterThan(100);
  });

  it('fillZones writes the polygons into every zone and its source', () => {
    const b = board({
      zones: [zone()],
      footprints: [footprint([pad({ x: MM(20), y: MM(20) }, 2)])],
    });
    const out = fillZones(b);
    expect(out.zones[0]!.fills).toHaveLength(1);
    expect(out.zones[0]!.fills[0]!.polys.length).toBeGreaterThan(0);
    const items = out.zones[0]!.source.items;
    expect(
      items.some(
        (i) => 'items' in i && (i.items[0] as { value?: string })?.value === 'filled_polygon',
      ),
    ).toBe(true);
  });

  it('writes the fill fractured, with no holes left for KiCad to fill in', () => {
    // A pad of another net in the middle punches a hole clean through the pour.
    const b = board({
      zones: [zone()],
      footprints: [footprint([pad({ x: MM(20), y: MM(20) }, 2)])],
    });
    const polys = fillZone(b, 0)[0]!.polys;
    // Fractured: one ring, not an outline plus a hole. Every ring is wound the
    // same way, so a reader filling each one draws the pour, not a solid slab.
    expect(polys).toHaveLength(1);
    const ring = polys[0]!;
    // The slit doubles back, so the ring visits the hole and returns.
    expect(ring.length).toBeGreaterThan(8);
    // And the area is still the pour less the pad's clearance bite.
    expect(area(polys)).toBeLessThan(1600);
    expect(1600 - area(polys)).toBeGreaterThan(8);
  });

  it('prunes a neck thinner than the zone minimum thickness', () => {
    // Two pads of another net, 0.15 mm apart, leave a 0.15 mm neck of copper
    // between their clearance bites. The zone's min thickness is 0.25 mm, so
    // postKnockoutMinWidthPrune takes the neck out and the pour splits in two.
    const gap = MM(0.15);
    const padSize = MM(4);
    const b = board({
      zones: [zone()],
      footprints: [
        footprint([
          pad({ x: MM(20), y: MM(10) }, 2, padSize),
          pad({ x: MM(20), y: MM(10) + padSize + MM(1) + gap }, 2, padSize),
        ]),
      ],
    });
    const fills = fillZone(b, 0);
    // The neck is gone: what remains does not bridge between the two bites.
    const ringsCrossingTheNeck = fills[0]!.polys.filter((ring) =>
      ring.some((p) => Math.abs(p.x - MM(20)) < MM(0.5) && p.y > MM(14) && p.y < MM(15)),
    );
    expect(ringsCrossingTheNeck).toHaveLength(0);
  });

  it('smooths the outline before pouring, when the zone asks for it', () => {
    const plain = area(fillZone(board({ zones: [zone()] }), 0)[0]!.polys);

    const chamfered = area(
      fillZone(board({ zones: [zone({ cornerSmoothing: 'chamfer', cornerRadius: MM(2) })] }), 0)[0]!
        .polys,
    );
    // Four corners cut back by 2 mm: 4 triangles of 2 mm².
    expect(plain - chamfered).toBeCloseTo(8, 1);

    const filleted = area(
      fillZone(board({ zones: [zone({ cornerSmoothing: 'fillet', cornerRadius: MM(2) })] }), 0)[0]!
        .polys,
    );
    // Rounding keeps more copper than cutting the corner straight off.
    expect(filleted).toBeGreaterThan(chamfered);
    expect(filleted).toBeLessThan(plain);
  });

  it('hatches a zone into webbing instead of solid copper', () => {
    const solid = area(fillZone(board({ zones: [zone()] }), 0)[0]!.polys);
    const hatched = fillZone(
      board({
        zones: [
          zone({
            fillMode: 'hatch',
            hatchThickness: MM(1),
            hatchGap: MM(2),
            hatchHoleMinArea: 0.3,
          }),
        ],
      }),
      0,
    );
    const webbing = area(hatched[0]!.polys);
    // A 1 mm web on a 3 mm pitch keeps well under half the copper.
    expect(webbing).toBeLessThan(solid * 0.6);
    expect(webbing).toBeGreaterThan(0);
    // It is one connected mesh: fracture joins every hole to the outline, so
    // the whole grid comes back as a single ring with a great many points.
    expect(hatched[0]!.polys).toHaveLength(1);
    expect(hatched[0]!.polys[0]!.length).toBeGreaterThan(100);
  });

  it('a wider hatch gap leaves less copper', () => {
    const fill = (gap: number): number =>
      area(
        fillZone(
          board({
            zones: [zone({ fillMode: 'hatch', hatchThickness: MM(1), hatchGap: gap })],
          }),
          0,
        )[0]!.polys,
      );
    expect(fill(MM(3))).toBeLessThan(fill(MM(1.5)));
  });

  describe('copper thieving', () => {
    const thieved = (over: Record<string, unknown>) =>
      fillZone(
        board({
          zones: [
            zone({
              fillMode: 'thieving',
              thieving: {
                pattern: 'dots',
                elementSize: MM(1),
                gap: MM(2),
                lineWidth: MM(0.5),
                stagger: false,
                orientation: 0,
                ...over,
              },
            }),
          ],
        }),
        0,
      );

    it('replaces the pour with a field of separate dots', () => {
      const polys = thieved({})[0]!.polys;
      // A 40 mm zone on a 3 mm pitch: order of 13 x 13 dots, each its own ring.
      expect(polys.length).toBeGreaterThan(100);
      // Each dot is about 1 mm across, so the copper left is a small fraction.
      expect(area(polys)).toBeLessThan(1600 * 0.15);
      expect(area(polys)).toBeGreaterThan(0);
    });

    it('squares cover more copper than dots of the same size', () => {
      expect(area(thieved({ pattern: 'squares' })[0]!.polys)).toBeGreaterThan(
        area(thieved({ pattern: 'dots' })[0]!.polys),
      );
    });

    it('a wider gap leaves fewer stamps', () => {
      expect(thieved({ gap: MM(6) })[0]!.polys.length).toBeLessThan(
        thieved({ gap: MM(2) })[0]!.polys.length,
      );
    });

    it('staggering shifts alternate rows without changing the count much', () => {
      const straight = thieved({ stagger: false })[0]!.polys.length;
      const staggered = thieved({ stagger: true })[0]!.polys.length;
      expect(Math.abs(straight - staggered)).toBeLessThan(straight * 0.3);
    });

    it('crosshatch leaves a connected mesh rather than separate stamps', () => {
      const polys = thieved({ pattern: 'hatch' })[0]!.polys;
      // Voids are subtracted from the pour, and fracture ties it into one ring.
      expect(polys).toHaveLength(1);
      expect(area(polys)).toBeLessThan(1600);
      expect(area(polys)).toBeGreaterThan(0);
    });

    it('a malformed pattern fills nothing rather than looping forever', () => {
      expect(thieved({ gap: 0 })).toEqual([]);
      expect(thieved({ elementSize: 0 })).toEqual([]);
    });
  });

  it("takes a custom pad's spoke templates instead of the four axis spokes", () => {
    // Same pad either way, only the number of templates differs, so the relief
    // knocked out is identical and the spokes are the only variable.
    const vector = (x: number, y: number): PadPrimitive => ({
      kind: 'gr_vector',
      start: { x: 0, y: 0 },
      end: { x, y },
      width: 0,
      fill: false,
    });
    const custom = (primitives: PadPrimitive[]): PcbPad => ({
      ...pad({ x: MM(20), y: MM(20) }, 1, MM(4)),
      shape: 'custom',
      primitives,
    });
    const filled = (primitives: PadPrimitive[]): number =>
      area(
        fillZone(board({ zones: [zone()], footprints: [footprint([custom(primitives)])] }), 0)[0]!
          .polys,
      );

    const two = filled([vector(MM(2), 0), vector(-MM(2), 0)]);
    const four = filled([vector(MM(2), 0), vector(-MM(2), 0), vector(0, MM(2)), vector(0, -MM(2))]);
    // Each spoke adds copper back across the relief, so four bridge more than two.
    expect(four).toBeGreaterThan(two);
  });

  it('ignores a spoke template with neither end in the pad', () => {
    const stray: PcbPad = {
      ...pad({ x: MM(20), y: MM(20) }, 1, MM(4)),
      shape: 'custom',
      primitives: [
        {
          kind: 'gr_vector',
          start: { x: MM(30), y: MM(30) },
          end: { x: MM(35), y: MM(35) },
          width: 0,
          fill: false,
        },
      ],
    };
    // No usable template: the relief is opened with no bridge across it at all.
    const fills = fillZone(board({ zones: [zone()], footprints: [footprint([stray])] }), 0);
    expect(fills).toHaveLength(1);
    expect(area(fills[0]!.polys)).toBeLessThan(1600);
  });

  it('leaves a zone alone when it is set not to fill', () => {
    const b = board({ zones: [zone({ filled: false, fills: [] })] });
    expect(fillZones(b).zones[0]!.fills).toEqual([]);
  });
});
