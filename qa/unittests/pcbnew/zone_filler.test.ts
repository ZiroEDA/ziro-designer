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
  points: [],
  barcodes: [],
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
  tables: [],
  images: [],
  points: [],
  barcodes: [],
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

  describe('the board edge', () => {
    /**
     * A rectangular Edge.Cuts outline 1 mm outside the 40 x 40 pour, so the
     * board is 42 x 42 and the pour has 1 mm of room before the edge matters.
     */
    const edgeRect = (inset: number): Board['shapes'][number] => ({
      kind: 'rect',
      start: { x: -MM(inset), y: -MM(inset) },
      end: { x: MM(40 + inset), y: MM(40 + inset) },
      width: MM(0.1),
      fillMode: 'none',
      layer: 'Edge.Cuts',
      source: EMPTY,
    });

    it('insets the pour by the EDGE clearance, not the copper one', () => {
      // "A item on the Edge_Cuts or Margin is always seen as on any layer", and
      // it is measured against EDGE_CLEARANCE_CONSTRAINT. The board edge runs
      // 0.25 mm outside the pour, so a 0.5 mm edge clearance eats 0.25 mm all
      // the way round: 40 - 2(0.25) = 39.5 a side.
      const b = board({ zones: [zone()], shapes: [edgeRect(0.25)] });
      expect(area(fillZone(b, 0)[0]!.polys)).toBeCloseTo(39.5 * 39.5, 0);
    });

    it('takes the clearance from the caller, not from a constant', () => {
      const b = board({ zones: [zone()], shapes: [edgeRect(0.25)] });
      // 1 mm edge clearance eats 0.75 mm a side.
      expect(area(fillZone(b, 0, { edgeClearance: MM(1) })[0]!.polys)).toBeCloseTo(38.5 * 38.5, 0);
    });

    it('measures from the CENTRELINE — the outline stroke is ignored', () => {
      // `ignoreLineWidths = true` for Edge.Cuts and only for Edge.Cuts. A
      // 2 mm-wide outline must give the same answer as a hairline one.
      const thin = board({ zones: [zone()], shapes: [edgeRect(0.25)] });
      const fat = board({
        zones: [zone()],
        shapes: [{ ...edgeRect(0.25), width: MM(2) }],
      });
      expect(area(fillZone(fat, 0)[0]!.polys)).toBeCloseTo(area(fillZone(thin, 0)[0]!.polys), 0);
    });

    it('reaches a zone on a layer the outline is not on', () => {
      // The whole point of "always seen as on any layer": an Edge.Cuts graphic
      // is not on B.Cu, and it still knocks a B.Cu pour out.
      const b = board({
        zones: [zone({ layers: ['B.Cu'] })],
        shapes: [edgeRect(0.25)],
      });
      expect(area(fillZone(b, 0)[0]!.polys)).toBeCloseTo(39.5 * 39.5, 0);
    });

    it('Margin knocks out too, and keeps its line width', () => {
      // Margin takes the same EDGE_CLEARANCE, but `ignoreLineWidths` stays
      // false, so its stroke is part of the obstacle.
      const hair = board({
        zones: [zone()],
        shapes: [{ ...edgeRect(0.25), layer: 'Margin' }],
      });
      const fat = board({
        zones: [zone()],
        shapes: [{ ...edgeRect(0.25), layer: 'Margin', width: MM(2) }],
      });
      expect(area(fillZone(fat, 0)[0]!.polys)).toBeLessThan(area(fillZone(hair, 0)[0]!.polys));
    });
  });

  describe("board graphics on the pour's own layer", () => {
    const bar = (layer: string, net = 0): Board['shapes'][number] => ({
      kind: 'line',
      start: { x: MM(10), y: MM(20) },
      end: { x: MM(30), y: MM(20) },
      width: MM(1),
      fillMode: 'none',
      layer,
      net,
      source: EMPTY,
    });

    it('a different-net graphic is knocked out at the copper clearance', () => {
      const b = board({ zones: [zone()], shapes: [bar('F.Cu', 2)] });
      const lost = 1600 - area(fillZone(b, 0)[0]!.polys);
      // A 20 mm bar, 1 mm wide, plus 0.5 mm clearance either side: 20 x 2 mm
      // of copper gone, plus the rounded caps.
      expect(lost).toBeGreaterThan(40);
      expect(lost).toBeLessThan(46);
    });

    it('a graphic on another copper layer is left alone', () => {
      const b = board({ zones: [zone()], shapes: [bar('B.Cu', 2)] });
      expect(area(fillZone(b, 0)[0]!.polys)).toBeCloseTo(1600, 0);
    });

    it('a SAME-net graphic takes no clearance, only its own footprint', () => {
      // The CLEARANCE_CONSTRAINT upgrade is for a different-net item; a
      // same-net one falls back to the physical clearance, which is 0.
      const b = board({ zones: [zone()], shapes: [bar('F.Cu', 1)] });
      const lost = 1600 - area(fillZone(b, 0)[0]!.polys);
      // The bar's own 20 x 1 mm and nothing more.
      expect(lost).toBeGreaterThan(19);
      expect(lost).toBeLessThan(22);
    });
  });

  it('is knocked out by a barcode — by its BOX, not by its modules', () => {
    // `zone_filler.cpp:1765-1770`:
    //
    //     case PCB_BARCODE_T:
    //         barcode->GetBoundingHull( aHoles, aLayer, aGap, m_maxError, ERROR_OUTSIDE );
    //
    // `GetBoundingHull`, not `TransformShapeToPolygon`. Every other item hands
    // the filler its own outline; a barcode hands it two RECTANGLES — one
    // round the symbol, one round the text. Copper is kept out of the whole
    // box rather than threaded between the modules, which is the only useful
    // answer: a pour reaching into a QR code's light squares makes it
    // unreadable, and the modules are not where the scanner looks anyway.
    const bc = {
      at: { x: MM(20), y: MM(20) },
      angle: 0,
      layer: 'F.Cu',
      width: MM(8),
      height: MM(8),
      text: 'ZIRO',
      textHeight: MM(1.27),
      kind: 'qr' as const,
      ecc: 'L' as const,
      showText: false,
      knockout: false,
      margin: { x: 0, y: 0 },
      source: EMPTY,
    };
    const filled = area(fillZone(board({ zones: [zone()], barcodes: [bc] }), 0)[0]!.polys);

    // 8 x 8 mm plus 0.5 mm clearance each side is a 9 x 9 mm bite = 81 mm²,
    // less a little at the rounded corners. A knockout that followed the
    // MODULES would take roughly half of the 64 mm² — nowhere near this.
    expect(1600 - filled).toBeGreaterThan(78);
    expect(1600 - filled).toBeLessThan(81.1);
  });

  it('and only on its own layer', () => {
    const bc = {
      at: { x: MM(20), y: MM(20) },
      angle: 0,
      layer: 'B.Cu',
      width: MM(8),
      height: MM(8),
      text: 'ZIRO',
      textHeight: MM(1.27),
      kind: 'qr' as const,
      ecc: 'L' as const,
      showText: false,
      knockout: false,
      margin: { x: 0, y: 0 },
      source: EMPTY,
    };

    expect(area(fillZone(board({ zones: [zone()], barcodes: [bc] }), 0)[0]!.polys)).toBeCloseTo(
      1600,
      0,
    );
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

  describe('island removal asks what TOUCHES the copper', () => {
    /**
     * `FindIsolatedCopperIslands` (zone_filler.cpp:943-1050) asks whether any
     * same-net copper actually touches an outline. This used to ask whether a
     * same-net anchor POINT fell inside the outline's outer ring — ignoring
     * its holes, and taking one point per item.
     */
    it('a track crossing a region anchors it, wherever the track STARTS', () => {
      // The pour is split in two by a different-net bar. A same-net track runs
      // from the left half into the right half; its start is on the left, so
      // one anchor per item would leave the right half an island.
      const b = board({
        zones: [zone()],
        tracks: [
          {
            start: { x: MM(20), y: 0 },
            end: { x: MM(20), y: MM(40) },
            width: MM(3),
            layer: 'F.Cu',
            net: 2,
            source: EMPTY,
          },
          {
            start: { x: MM(5), y: MM(10) },
            end: { x: MM(35), y: MM(10) },
            width: MM(0.5),
            layer: 'F.Cu',
            net: 1,
            source: EMPTY,
          },
        ],
      });
      // Both halves survive: roughly the 40 x 40 less the bar and its clearance.
      expect(area(fillZone(b, 0)[0]!.polys)).toBeGreaterThan(1400);
    });

    it('drops the half no same-net copper reaches', () => {
      // The same board with the same-net track stopping short of the bar: the
      // right half touches nothing on net 1 and goes.
      const b = board({
        zones: [zone()],
        tracks: [
          {
            start: { x: MM(20), y: 0 },
            end: { x: MM(20), y: MM(40) },
            width: MM(3),
            layer: 'F.Cu',
            net: 2,
            source: EMPTY,
          },
          {
            start: { x: MM(5), y: MM(10) },
            end: { x: MM(15), y: MM(10) },
            width: MM(0.5),
            layer: 'F.Cu',
            net: 1,
            source: EMPTY,
          },
        ],
      });
      // Only the left half, so a bit under half the 1600.
      const filled = area(fillZone(b, 0)[0]!.polys);
      expect(filled).toBeGreaterThan(600);
      expect(filled).toBeLessThan(800);
    });

    it('keeps a pour that reaches nothing at all', () => {
      // "skip island removal on layers where every outline is an island
      // (unconnected pour — must be preserved as-is)". A zone with same-net
      // copper somewhere on the board but none of it touching the pour would
      // otherwise vanish entirely.
      const b = board({
        zones: [zone()],
        tracks: [
          // On the net, but far outside the 40 x 40 outline.
          {
            start: { x: MM(100), y: MM(100) },
            end: { x: MM(110), y: MM(100) },
            width: MM(0.5),
            layer: 'F.Cu',
            net: 1,
            source: EMPTY,
          },
        ],
      });
      expect(area(fillZone(b, 0)[0]!.polys)).toBeCloseTo(1600, 0);
    });
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

  describe('a spoke is kept only if it reaches copper', () => {
    /**
     * `zone_filler.cpp:2978-3016`. The tip of each spoke is tested against the
     * pour with every clearance hole already subtracted; a spoke pointing into
     * a neighbour's clearance is dropped.
     *
     * Two 2 mm pads 3 mm apart on a 40 x 40 pour: a GND one at (18.5,20) on
     * the zone's own net and another at (21.5,20). Their edges are 1 mm
     * apart, and with 0.5 mm of clearance owed to each there is no copper
     * left between them — so the GND pad's +x spoke tip, at 20.005, lands
     * inside the neighbour's clearance hole, which runs from 20.0.
     */
    const facing = (otherNet: number): Board =>
      board({
        zones: [zone()],
        footprints: [
          footprint([
            pad({ x: MM(18.5), y: MM(20) }, 1),
            { ...pad({ x: MM(21.5), y: MM(20) }, otherNet), number: '2' },
          ]),
        ],
      });

    /** The spoke count, read off the copper a spoke adds back. */
    const spokeArea = (b: Board): number => {
      const withSpokes = area(fillZone(b, 0)[0]!.polys);
      // The same board with thermals off: pads solidly connected leave no
      // relief at all, so compare against a NO-connection pour instead.
      const noSpokes = area(
        fillZone({ ...b, zones: [{ ...b.zones[0]!, padConnection: 'none' }] }, 0)[0]!.polys,
      );
      return withSpokes - noSpokes;
    };

    it('drops the one aimed at a different-net pad', () => {
      // Four spokes at 0.5 mm wide crossing a 0.5 mm relief is ~1 mm² of
      // copper; three is ~0.75. The difference between the two boards is one
      // spoke, and it is the difference that matters, not the absolute.
      const blocked = spokeArea(facing(2));
      const clear = spokeArea(
        board({ zones: [zone()], footprints: [footprint([pad({ x: MM(18.5), y: MM(20) }, 1)])] }),
      );

      expect(blocked).toBeGreaterThan(0);
      // One spoke short of the unobstructed pad's four.
      expect(blocked).toBeLessThan(clear * 0.85);
      expect(blocked).toBeGreaterThan(clear * 0.6);
    });

    it('keeps all four when the neighbour is on the SAME net', () => {
      // A same-net pad takes a thermal relief of its own rather than a
      // clearance hole, and the two pads\' spokes meet — the second arm of
      // upstream\'s test, "hit-test against other spokes".
      const same = spokeArea(facing(1));
      const clear = spokeArea(
        board({ zones: [zone()], footprints: [footprint([pad({ x: MM(18.5), y: MM(20) }, 1)])] }),
      );
      expect(same).toBeGreaterThan(clear * 0.85);
    });

    it('drops every spoke of a pad walled off from the pour', () => {
      // A different-net track boxing the pad in 2.2 mm out on all four sides.
      // Each spoke tip is at 1.505 mm and every wall's clearance hole starts
      // at 1.2 mm, so no tip lands on copper and no spoke is kept.
      const wall = (
        a: { x: number; y: number },
        b: { x: number; y: number },
      ): Board['tracks'][number] => ({
        start: a,
        end: b,
        width: MM(1),
        layer: 'F.Cu',
        net: 2,
        source: EMPTY,
      });
      const walled = board({
        zones: [zone()],
        footprints: [footprint([pad({ x: MM(20), y: MM(20) }, 1)])],
        tracks: [
          wall({ x: MM(16), y: MM(17.8) }, { x: MM(24), y: MM(17.8) }),
          wall({ x: MM(16), y: MM(22.2) }, { x: MM(24), y: MM(22.2) }),
          wall({ x: MM(17.8), y: MM(16) }, { x: MM(17.8), y: MM(24) }),
          wall({ x: MM(22.2), y: MM(16) }, { x: MM(22.2), y: MM(24) }),
        ],
      });
      const withThermals = area(fillZone(walled, 0)[0]!.polys);
      const noConnection = area(
        fillZone({ ...walled, zones: [{ ...walled.zones[0]!, padConnection: 'none' }] }, 0)[0]!
          .polys,
      );
      // Not one spoke of copper added back.
      expect(withThermals).toBeCloseTo(noConnection, 3);
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
