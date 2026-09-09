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
import { fillZone, fillZones, zoneClearanceOf } from '@ziroeda/pcbnew/src/zone_filler.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type {
  Board,
  PadPrimitive,
  PcbFootprint,
  PcbPad,
  PcbTextItem,
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
    // `fillZones`, not `fillZone`: the knockout is the other zone's FILLED
    // area, so it has to have been poured first. That ordering is upstream's
    // (`fill_item_dependency`), and it is why a zone is never asked to knock
    // itself out of a neighbour that has not been filled yet.
    const b = board({
      zones: [
        zone(),
        zone({
          net: 2,
          priority: 1,
          uuid: 'z2',
          outline: [
            { x: MM(10), y: MM(10) },
            { x: MM(20), y: MM(10) },
            { x: MM(20), y: MM(20) },
            { x: MM(10), y: MM(20) },
          ],
        }),
      ],
    });
    const out = fillZones(b);
    // 10 x 10 mm knocked out, plus clearance around it.
    expect(1600 - area(out.zones[0]!.fills[0]!.polys)).toBeGreaterThan(100);
  });

  it('but an EMPTY higher-priority zone knocks out nothing', () => {
    // `ZONE::TransformShapeToPolygon`: "if( !m_FilledPolysList.count( aLayer ) )
    // return". A zone with nothing poured on this layer removes no copper —
    // knocking out its OUTLINE instead takes away everywhere it could have
    // reached, which on a board of overlapping pours is most of the board.
    const b = board({
      zones: [
        zone(),
        zone({
          net: 2,
          priority: 1,
          uuid: 'z2',
          outline: [
            { x: MM(10), y: MM(10) },
            { x: MM(20), y: MM(10) },
            { x: MM(20), y: MM(20) },
            { x: MM(10), y: MM(20) },
          ],
        }),
      ],
    });
    expect(area(fillZone(b, 0)[0]!.polys)).toBeCloseTo(1600, 0);
  });

  it('breaks a priority tie on the uuid, as HigherPriority does', () => {
    // `return m_Uuid > aOther->m_Uuid` — two ordinary zones of equal priority
    // on different nets are not peers. One wins; both filling the overlap is a
    // short.
    const overlap = [
      { x: MM(10), y: MM(10) },
      { x: MM(20), y: MM(10) },
      { x: MM(20), y: MM(20) },
      { x: MM(10), y: MM(20) },
    ];
    const pair = (first: string, second: string): Board =>
      board({
        zones: [zone({ uuid: first }), zone({ net: 2, uuid: second, outline: overlap })],
      });

    // 'b' > 'a', so the second zone wins and eats into the first.
    const secondWins = fillZones(pair('a', 'b'));
    expect(1600 - area(secondWins.zones[0]!.fills[0]!.polys)).toBeGreaterThan(100);

    // Swap the ids and the first zone wins instead: it is poured whole, and the
    // second — which lies entirely inside it — is left with nothing at all.
    const firstWins = fillZones(pair('b', 'a'));
    expect(area(firstWins.zones[0]!.fills[0]!.polys)).toBeCloseTo(1600, 0);
    expect(firstWins.zones[1]!.fills).toHaveLength(0);
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

// -----------------------------------------------------------------------------
// the shape of a thermal relief
// -----------------------------------------------------------------------------

/** Is `p` inside the fill? Ray cast over every ring, holes cancelling. */
const filled = (polys: { x: number; y: number }[][], p: { x: number; y: number }): boolean => {
  let crossings = 0;
  for (const ring of polys)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
        crossings++;
    }
  return crossings % 2 === 1;
};

/** A same-net pad in the middle of the pour, thermally relieved. */
const relieved = (over: Partial<PcbPad>): Board =>
  board({
    zones: [zone()],
    footprints: [
      footprint([
        {
          ...pad({ x: MM(20), y: MM(20) }, 1, MM(3)),
          type: 'thru_hole',
          layers: ['*.Cu'],
          ...over,
        },
      ]),
    ],
  });

/** Where the fill sits on a circle of radius `r` around the pad, in 5° steps. */
const ringProfile = (polys: { x: number; y: number }[][], r: number): boolean[] => {
  const out: boolean[] = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg * Math.PI) / 180;
    out.push(filled(polys, { x: MM(20) + Math.cos(a) * r, y: MM(20) + Math.sin(a) * r }));
  }
  return out;
};

/**
 * The angles, in degrees, at the middle of each filled run of `ringProfile`.
 *
 * The angle is the SAMPLING one, `(cos a, sin a)` in board coordinates where y
 * runs down the screen. `RotatePoint` turns the other way, so a pad at +30°
 * puts its spokes at sampling angles 90k − 30.
 */
const spokeAnglesAt = (polys: { x: number; y: number }[][], r: number): number[] => {
  const p = ringProfile(polys, r);
  const start = p.indexOf(false);
  if (start < 0) return [];

  const runs: number[][] = [];
  for (let k = 0; k < p.length; k++) {
    const i = (start + k) % p.length;
    if (!p[i]) continue;
    if (k > 0 && p[(start + k - 1) % p.length]) runs[runs.length - 1]!.push(k);
    else runs.push([k]);
  }
  return runs
    .map((run) => ((((start + (run[0]! + run[run.length - 1]!) / 2) * 5) % 360) + 360) % 360)
    .sort((a, b) => a - b);
};

describe('the thermal spoke angle', () => {
  // "45° will produce an X (the default for circular pads and circular-anchored
  // custom shaped pads), while 90° will produce a + (the default for all other
  // shapes)" — PAD::SetThermalSpokeAngle, pad.h:750.
  const sampleR = MM(1.6); // inside the relief, outside the pad

  it('puts an X on a round pad', () => {
    const fill = fillZone(relieved({ shape: 'circle' }), 0)[0]!.polys;
    expect(spokeAnglesAt(fill, sampleR)).toEqual([45, 135, 225, 315]);
  });

  it('puts a + on a rectangular one', () => {
    const fill = fillZone(relieved({ shape: 'rect' }), 0)[0]!.polys;
    expect(spokeAnglesAt(fill, sampleR)).toEqual([0, 90, 180, 270]);
  });

  it("takes the pad's own (thermal_bridge_angle …) over either default", () => {
    const fill = fillZone(relieved({ shape: 'circle', thermalSpokeAngle: 90 }), 0)[0]!.polys;
    expect(spokeAnglesAt(fill, sampleR)).toEqual([0, 90, 180, 270]);
  });

  it('turns with the pad', () => {
    // The four spokes are built about the pad's own axes and then rotated by
    // its orientation, so a rectangle at 30° carries its + around with it.
    const fill = fillZone(relieved({ shape: 'rect', angle: 30 }), 0)[0]!.polys;
    // RotatePoint turns clockwise on screen, so a +30° pad reads back at 90k−30.
    expect(spokeAnglesAt(fill, sampleR)).toEqual([60, 150, 240, 330]);
  });
});

describe("a thermally connected pad's own hole", () => {
  // "Ensure additive changes (thermal stubs …) do not add copper … inside the
  // clearance holes" — every thermalConnectionPad's drill joins clearanceHoles
  // at gap 0, and is subtracted after the spokes are in (zone_filler.cpp:3130).
  const withDrill = (): Board =>
    relieved({ shape: 'circle', drill: { oblong: false, w: MM(1.5), h: MM(1.5) } });

  it('is empty even though four spokes cross it', () => {
    const fill = fillZone(withDrill(), 0)[0]!.polys;
    expect(filled(fill, { x: MM(20), y: MM(20) })).toBe(false);
    // Just outside the drill, along a spoke, there IS copper: the hole is the
    // drill and nothing more.
    const d = MM(0.75) + MM(0.1);
    expect(filled(fill, { x: MM(20) + d * Math.SQRT1_2, y: MM(20) + d * Math.SQRT1_2 })).toBe(true);
  });

  it('is not knocked out with a clearance ring around it', () => {
    // The gap is 0. A pad whose hole took the zone clearance too would eat
    // 0.5 mm of the spokes' roots.
    const fill = fillZone(withDrill(), 0)[0]!.polys;
    const justOutside = MM(0.75) + MM(0.05);
    expect(
      filled(fill, {
        x: MM(20) + justOutside * Math.SQRT1_2,
        y: MM(20) + justOutside * Math.SQRT1_2,
      }),
    ).toBe(true);
  });

  it('stays filled when the pad is connected solidly instead', () => {
    // A FULL connection is not in thermalConnectionPads, so nothing knocks its
    // hole out and the pour runs straight over it.
    const b = relieved({ shape: 'circle', drill: { oblong: false, w: MM(1.5), h: MM(1.5) } });
    const solid = { ...b, zones: [{ ...b.zones[0]!, padConnection: 'full' as const }] };
    expect(filled(fillZone(solid, 0)[0]!.polys, { x: MM(20), y: MM(20) })).toBe(true);
  });
});

describe('which pads get a relief', () => {
  const twoPads = (padConnection: PcbZone['padConnection']): Board => {
    const b = board({
      zones: [zone({ padConnection })],
      footprints: [
        footprint([
          { ...pad({ x: MM(12), y: MM(20) }, 1, MM(3)), type: 'thru_hole', layers: ['*.Cu'] },
          { ...pad({ x: MM(28), y: MM(20) }, 1, MM(3)), type: 'smd' },
        ]),
      ],
    });
    return b;
  };

  /**
   * Is there a relief gap around the pad? Probed on the DIAGONAL: both pads
   * here are rectangles, so their spokes are the cardinal `+` and an axis
   * probe would land on one.
   */
  const hasRelief = (b: Board, x: number): boolean =>
    !filled(fillZone(b, 0)[0]!.polys, {
      x: x + MM(1.9) * Math.SQRT1_2,
      y: MM(20) + MM(1.9) * Math.SQRT1_2,
    });

  it('gives "thermal reliefs for PTH" a relief on the through pad only', () => {
    // ZONE_CONNECTION::THT_THERMAL becomes THERMAL on a PTH pad and FULL on
    // everything else (DRC_ENGINE::EvalZoneConnection).
    const b = twoPads('thru_hole_only');
    expect(hasRelief(b, MM(12))).toBe(true);
    expect(hasRelief(b, MM(28))).toBe(false);
  });

  it('relieves both when the zone simply says thermal', () => {
    const b = twoPads('thermal');
    expect(hasRelief(b, MM(12))).toBe(true);
    expect(hasRelief(b, MM(28))).toBe(true);
  });

  it("lets a pad's own (zone_connect …) override the zone", () => {
    // ZONE_CONNECTION_CONSTRAINT resolves pad, then footprint, then zone.
    const b = twoPads('thermal');
    const solidPad = {
      ...b,
      footprints: [
        {
          ...b.footprints[0]!,
          pads: [
            { ...b.footprints[0]!.pads[0]!, zoneConnection: 'full' as const },
            b.footprints[0]!.pads[1]!,
          ],
        },
      ],
    };
    expect(hasRelief(solidPad, MM(12))).toBe(false);
    expect(hasRelief(solidPad, MM(28))).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// when the islands are looked for
// -----------------------------------------------------------------------------

describe('island removal runs on the finished fill', () => {
  /**
   * `ZONE_FILLER::Fill` calls `FillIsolatedIslandsMap` after every
   * `fillCopperZone` has returned, so what it sees is the pruned, fractured
   * poly set. Asking before the prune reads a different board: a lobe hanging
   * off the pour by a neck THINNER than the zone's minimum thickness is still
   * attached at that moment, and survives a question it should have failed.
   *
   * Two 12 mm squares joined by a 0.1 mm neck, in a zone whose minimum
   * thickness is 0.5. The pad — the only same-net copper — is in the left one.
   */
  const dumbbell = (over: Partial<PcbZone> = {}): Board =>
    board({
      zones: [
        zone({
          minThickness: MM(0.5),
          padConnection: 'full',
          outline: [
            { x: MM(2), y: MM(2) },
            { x: MM(14), y: MM(2) },
            { x: MM(14), y: MM(7.95) },
            { x: MM(26), y: MM(7.95) },
            { x: MM(26), y: MM(2) },
            { x: MM(38), y: MM(2) },
            { x: MM(38), y: MM(14) },
            { x: MM(26), y: MM(14) },
            { x: MM(26), y: MM(8.05) },
            { x: MM(14), y: MM(8.05) },
            { x: MM(14), y: MM(14) },
            { x: MM(2), y: MM(14) },
          ],
          ...over,
        }),
      ],
      footprints: [footprint([pad({ x: MM(8), y: MM(8) }, 1, MM(2))])],
    });

  it('drops the lobe the min-width prune just severed', () => {
    const fill = fillZone(dumbbell(), 0)[0]!.polys;
    // The pad's own square survives; the far one is now an island.
    expect(filled(fill, { x: MM(5), y: MM(5) })).toBe(true);
    expect(filled(fill, { x: MM(35), y: MM(5) })).toBe(false);
  });

  it('keeps it when the mode is never', () => {
    const fill = fillZone(dumbbell({ islandRemovalMode: 'never' }), 0)[0]!.polys;
    expect(filled(fill, { x: MM(35), y: MM(5) })).toBe(true);
  });

  it('keeps even a tiny one when the mode is never', () => {
    // NEVER is not "AREA with the default limit": the far lobe here is 4 mm²,
    // under `island_area_min`'s 10, and it still stays.
    const small = (over: Partial<PcbZone>): Board => {
      const b = dumbbell(over);
      const z = b.zones[0]!;
      return {
        ...b,
        zones: [
          {
            ...z,
            outline: [
              { x: MM(2), y: MM(2) },
              { x: MM(14), y: MM(2) },
              { x: MM(14), y: MM(7.95) },
              { x: MM(26), y: MM(7.95) },
              { x: MM(26), y: MM(6) },
              { x: MM(28), y: MM(6) },
              { x: MM(28), y: MM(10) },
              { x: MM(26), y: MM(10) },
              { x: MM(26), y: MM(8.05) },
              { x: MM(14), y: MM(8.05) },
              { x: MM(14), y: MM(14) },
              { x: MM(2), y: MM(14) },
            ],
          },
        ],
      };
    };
    expect(
      filled(fillZone(small({ islandRemovalMode: 'never' }), 0)[0]!.polys, { x: MM(27), y: MM(8) }),
    ).toBe(true);
    expect(filled(fillZone(small({}), 0)[0]!.polys, { x: MM(27), y: MM(8) })).toBe(false);
  });

  it('keeps it when it is over the area limit', () => {
    // ISLAND_REMOVAL_MODE::AREA, `outline.Area( true ) < minArea`. The far
    // square is ~144 mm².
    const under = fillZone(dumbbell({ islandRemovalMode: 'area', islandAreaMin: 200 }), 0)[0]!
      .polys;
    const over = fillZone(dumbbell({ islandRemovalMode: 'area', islandAreaMin: 50 }), 0)[0]!.polys;
    expect(filled(under, { x: MM(35), y: MM(5) })).toBe(false);
    expect(filled(over, { x: MM(35), y: MM(5) })).toBe(true);
  });

  it('keeps a pour that reaches nothing at all', () => {
    // "skip island removal on layers where every outline is an island
    // (unconnected pour — must be preserved as-is)".
    const b = dumbbell();
    const orphan = { ...b, footprints: [footprint([pad({ x: MM(8), y: MM(8) }, 2, MM(2))])] };
    const fill = fillZone(orphan, 0)[0]!.polys;
    expect(filled(fill, { x: MM(35), y: MM(5) })).toBe(true);
    expect(filled(fill, { x: MM(5), y: MM(5) })).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// ERROR_OUTSIDE
// -----------------------------------------------------------------------------

describe('a knockout polygon is built OUTSIDE the shape it stands for', () => {
  /**
   * `TransformCircleToPolygon( …, ERROR_OUTSIDE )` and `TransformOvalToPolygon`
   * push the approximation outward — "The outer radius should be radius+aError"
   * — so the polygon is TANGENT to the true circle at the middle of every edge
   * and bulges past it at the vertices. A clearance knockout is then never
   * smaller than the clearance asked for.
   *
   * Inscribing instead puts the whole polygon inside the circle, and copper
   * comes up to one maxError closer than the rule allows on every arc. It is a
   * few microns; it is also the difference between a web that survives the
   * minimum-thickness prune and one that does not, which is how it showed up as
   * 170 mm² of copper KiCad does not pour.
   */
  const CLEARANCE = MM(0.3);
  const R = MM(0.85);

  /** The radius at which copper starts, looking out from `c` along `deg`. */
  const edgeRadius = (
    polys: { x: number; y: number }[][],
    c: { x: number; y: number },
    deg: number,
  ): number => {
    const a = (deg * Math.PI) / 180;
    for (let r = R; r < R + MM(1); r += MM(0.001))
      if (filled(polys, { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) })) return r;
    return Number.POSITIVE_INFINITY;
  };

  const withItem = (over: Partial<Board>): Board =>
    board({
      zones: [zone({ clearance: CLEARANCE, minThickness: MM(0.25) })],
      ...over,
    });

  it("never lets copper inside a round pad's clearance", () => {
    const b = withItem({
      footprints: [
        footprint([
          {
            ...pad({ x: MM(20), y: MM(20) }, 2, MM(1.7)),
            shape: 'circle',
          },
        ]),
      ],
    });
    const fill = fillZone(b, 0)[0]!.polys;
    const radii: number[] = [];
    for (let deg = 0; deg < 360; deg += 1)
      radii.push(edgeRadius(fill, { x: MM(20), y: MM(20) }, deg));

    // Tangent at the edge middles: the closest copper is the clearance itself,
    // to within the 1 µm sampling step.
    expect(Math.min(...radii)).toBeGreaterThanOrEqual(R + CLEARANCE - MM(0.0015));
    // And it really is tangent somewhere, not uniformly further out.
    expect(Math.min(...radii)).toBeLessThanOrEqual(R + CLEARANCE + MM(0.0015));

    // The vertices sit at HALF-steps, "to make segment approximations align
    // properly at 45-degrees", so an axis and a diagonal both cut an edge in
    // its middle — the tangent points, not the bulges.
    expect(radii[0]!).toBeLessThanOrEqual(R + CLEARANCE + MM(0.0015));
    expect(radii[45]!).toBeLessThanOrEqual(R + CLEARANCE + MM(0.0015));

    // The bulge at a vertex is the whole correction, and its size pins the
    // segment count. `GetArcToSegmentCount( 1.15 mm, 0.005 mm, 360° )`:
    // acos( 1 − 0.005/1.15 ) = 5.3431°, so one segment spans 10.686° and the
    // count is round( 360 / 10.686 ) = 34, rounded UP to the next multiple of
    // 8 = 40. The outer radius is then 1.15 / cos( 180°/40 ) = 1.153557 mm.
    expect(Math.max(...radii)).toBeGreaterThan(MM(1.1525));
    expect(Math.max(...radii)).toBeLessThan(MM(1.1546));
  });

  it("never lets copper inside a track's clearance, on the sides or the ends", () => {
    const b = withItem({
      tracks: [
        {
          start: { x: MM(16), y: MM(20) },
          end: { x: MM(24), y: MM(20) },
          width: MM(1.7),
          layer: 'F.Cu',
          net: 2,
          source: EMPTY,
        },
      ],
    });
    const fill = fillZone(b, 0)[0]!.polys;

    // The straight sides sit at EXACTLY the half width plus the clearance:
    // upstream clips the corrected shape back to a rectangle of the exact
    // half-width, so a track's flank never takes the arc correction.
    const side = edgeRadius(fill, { x: MM(20), y: MM(20) }, 90);
    expect(side).toBeGreaterThanOrEqual(R + CLEARANCE - MM(0.0015));
    expect(side).toBeLessThanOrEqual(R + CLEARANCE + MM(0.0015));
    // The cap is the circle case again, measured from the segment's end.
    const capRadii: number[] = [];
    for (let deg = -80; deg <= 80; deg += 1)
      capRadii.push(edgeRadius(fill, { x: MM(24), y: MM(20) }, deg));
    expect(Math.min(...capRadii)).toBeGreaterThanOrEqual(R + CLEARANCE - MM(0.0015));
  });
});

describe('a spoke is trimmed by the clearance holes it crosses', () => {
  /**
   * "the 'real' subtract-clearance-holes has to be done after the spokes are
   * added" (zone_filler.cpp:3020). A spoke runs from the pad centre out past
   * the relief; whatever sits between belongs to another net, and the pour's
   * clearance from it has to survive the spoke being unioned in.
   *
   * A 2 mm thermal gap makes the relief wide enough to put a different-net via
   * inside it. The via is offset so it nicks the SIDE of the downward spoke:
   * the spoke still runs the whole way — it is not cut in half and lost as an
   * island — and the copper the via's clearance covers still has to go.
   */
  const b = (): Board =>
    board({
      zones: [
        zone({
          thermalGap: MM(2),
          clearance: MM(0.5),
          thermalBridgeWidth: MM(0.5),
          minThickness: MM(0.25),
          islandRemovalMode: 'never',
        }),
      ],
      footprints: [
        footprint([
          {
            ...pad({ x: MM(20), y: MM(20) }, 1, MM(3)),
            shape: 'rect',
            type: 'thru_hole',
            layers: ['*.Cu'],
          },
        ]),
      ],
      vias: [
        {
          at: { x: MM(20.9), y: MM(22.5) },
          size: MM(0.4),
          drill: MM(0.2),
          layers: ['F.Cu', 'B.Cu'],
          kind: 'through',
          net: 2,
          source: EMPTY,
        },
      ],
    });

  it("cuts the spoke where the via's clearance reaches into it", () => {
    const fill = fillZone(b(), 0)[0]!.polys;
    // The rect pad's spokes are the cardinal +, so one runs straight down the
    // relief from (20, 20). Its far side is still copper.
    expect(filled(fill, { x: MM(19.9), y: MM(22.5) })).toBe(true);
    // The via's clearance — 0.2 mm of via and 0.5 mm of gap — reaches x 20.2,
    // and the copper inside it is gone even though a spoke was put there.
    expect(filled(fill, { x: MM(20.23), y: MM(22.5) })).toBe(false);
    // Just clear of the clearance, on the far side of the via, the pour is
    // back: nothing wider than the via's own hole was taken.
    expect(filled(fill, { x: MM(20.9), y: MM(22.5) })).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// the clearance the pour actually keeps
// -----------------------------------------------------------------------------

describe('CLEARANCE_CONSTRAINT', () => {
  /**
   * `DRC_ENGINE::EvalRules` (drc_engine.cpp:1902-1975) says outright that this
   * one cannot be an implicit rule "because they have to be max'ed with
   * netclass values": the netclass clearance is the base, a local clearance on
   * either item raises it, and the board minimum raises it again.
   *
   * The pour used the zone's own `(connect_pads (clearance …))` and nothing
   * else. `multichannel_mixer`'s zones state 0 there, so ours kept NO gap from
   * other nets at all while KiCad kept the netclass's 0.2 raised to the board
   * minimum's 0.3 — 34% too much copper on one layer.
   */
  const gapAround = (opts: Parameters<typeof fillZone>[2]): number => {
    const b = board({
      zones: [zone({ clearance: 0 })],
      footprints: [footprint([pad({ x: MM(20), y: MM(20) }, 2, MM(2))])],
    });
    const fill = fillZone(b, 0, opts)[0]!.polys;
    // Walk out along +x from the pad edge until copper starts.
    for (let d = 0; d < MM(2); d += MM(0.005))
      if (filled(fill, { x: MM(21) + d, y: MM(20) })) return d;
    return Number.POSITIVE_INFINITY;
  };

  it('takes the netclass clearance when the zone states none', () => {
    expect(
      gapAround({ clearanceOf: zoneClearanceOf({ netClassClearance: () => MM(0.4) }) }),
    ).toBeCloseTo(MM(0.4), -3);
  });

  it('raises it to the board minimum', () => {
    expect(
      gapAround({
        clearanceOf: zoneClearanceOf({ minClearance: MM(0.7), netClassClearance: () => MM(0.4) }),
      }),
    ).toBeCloseTo(MM(0.7), -3);
  });

  it("lets the zone's own clearance win when it is the largest", () => {
    const b = board({
      zones: [zone({ clearance: MM(0.9) })],
      footprints: [footprint([pad({ x: MM(20), y: MM(20) }, 2, MM(2))])],
    });
    const fill = fillZone(b, 0, {
      clearanceOf: zoneClearanceOf({ minClearance: MM(0.2), netClassClearance: () => MM(0.4) }),
    })[0]!.polys;
    let d = 0;
    for (; d < MM(2); d += MM(0.005)) if (filled(fill, { x: MM(21) + d, y: MM(20) })) break;
    expect(d).toBeCloseTo(MM(0.9), -3);
  });

  it('asks about BOTH nets, not just the other one', () => {
    // The netclass rules are conditioned on `A.hasExactNetclass(…)` and sorted
    // ascending before being added, so the largest matching one wins — which
    // over two items means the max of their two netclasses.
    const seen: number[] = [];
    gapAround({
      clearanceOf: zoneClearanceOf({
        netClassClearance: (net) => {
          seen.push(net);
          return MM(0.4);
        },
      }),
    });
    expect(seen).toContain(1); // the zone's net
    expect(seen).toContain(2); // the pad's
  });
});

// -----------------------------------------------------------------------------
// the boolean engine
// -----------------------------------------------------------------------------

describe('knockouts that overlap each other', () => {
  it('union rather than cancelling', () => {
    // Two different-net pads that overlap, which is what a footprint's own
    // pads and the track ending on one of them look like to the filler. Under
    // an even-odd fill rule the overlap comes back as COPPER; `booleanOp`
    // declares `FillRule::NonZero`, as SHAPE_POLY_SET does.
    const b = board({
      zones: [zone()],
      footprints: [
        footprint([
          pad({ x: MM(20), y: MM(20) }, 2, MM(4)),
          pad({ x: MM(21), y: MM(20) }, 2, MM(4)),
        ]),
      ],
    });
    const fill = fillZone(b, 0)[0]!.polys;
    expect(filled(fill, { x: MM(20.5), y: MM(20) })).toBe(false);
  });

  it('knock out the same copper whichever way round their outline runs', () => {
    // A stadium is built from the segment's direction, so a track drawn
    // right-to-left winds the other way from the same track drawn
    // left-to-right. The non-zero rule counts windings: without orienting them
    // first, one of the two would cancel against its neighbours instead of
    // joining them.
    const track = (a: { x: number; y: number }, z: { x: number; y: number }) => ({
      start: a,
      end: z,
      width: MM(1),
      layer: 'F.Cu',
      net: 2,
      source: EMPTY,
    });
    const forward = board({
      zones: [zone()],
      tracks: [
        track({ x: MM(10), y: MM(20) }, { x: MM(20), y: MM(20) }),
        track({ x: MM(20), y: MM(20) }, { x: MM(30), y: MM(20) }),
      ],
    });
    const reversed = board({
      zones: [zone()],
      tracks: [
        track({ x: MM(20), y: MM(20) }, { x: MM(10), y: MM(20) }),
        track({ x: MM(30), y: MM(20) }, { x: MM(20), y: MM(20) }),
      ],
    });
    expect(area(fillZone(reversed, 0)[0]!.polys)).toBeCloseTo(
      area(fillZone(forward, 0)[0]!.polys),
      3,
    );
    // And the join between them really is knocked out.
    expect(filled(fillZone(reversed, 0)[0]!.polys, { x: MM(20), y: MM(20) })).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// what makes an outline "not an island"
// -----------------------------------------------------------------------------

describe('a fill outline standing on its own pad', () => {
  it('is connected copper, not an island', () => {
    // `CN_CLUSTER::IsOrphaned()` is `m_originPad == nullptr`: an outline is
    // isolated only when nothing in its cluster is a PAD. So copper lying on a
    // same-net pad is connected even when it reaches nothing else at all.
    //
    // A 6 mm pad poured solid, with a different-net via knocking the middle of
    // it out and a ring of different-net track cutting the rest off from the
    // pour. What is left is an annulus of copper that touches only its own pad
    // — and whose CENTRE is inside the via's hole, so a test that spoke for the
    // pad with one point would drop it.
    const b = board({
      zones: [zone({ clearance: MM(0.3), padConnection: 'full' })],
      footprints: [footprint([{ ...pad({ x: MM(20), y: MM(20) }, 1, MM(6)), shape: 'circle' }])],
      vias: [
        {
          at: { x: MM(20), y: MM(20) },
          size: MM(2),
          drill: MM(1),
          layers: ['F.Cu', 'B.Cu'],
          kind: 'through',
          net: 2,
          source: EMPTY,
        },
      ],
      tracks: Array.from({ length: 32 }, (_, i) => {
        const a0 = (i * Math.PI) / 16;
        const a1 = ((i + 1) * Math.PI) / 16;
        const r = MM(4);
        return {
          start: { x: MM(20) + r * Math.cos(a0), y: MM(20) + r * Math.sin(a0) },
          end: { x: MM(20) + r * Math.cos(a1), y: MM(20) + r * Math.sin(a1) },
          width: MM(0.4),
          layer: 'F.Cu',
          net: 2,
          source: EMPTY,
        };
      }),
    });
    const fill = fillZone(b, 0)[0]!.polys;

    // The pad's centre is in the via's hole ...
    expect(filled(fill, { x: MM(20), y: MM(20) })).toBe(false);
    // ... and the annulus around it is still there.
    expect(filled(fill, { x: MM(22.4), y: MM(20) })).toBe(true);
    expect(filled(fill, { x: MM(20), y: MM(22.4) })).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// the bounding-box guards
// -----------------------------------------------------------------------------

describe('an item OUTSIDE the zone still keeps its clearance', () => {
  /**
   * Every knockout upstream builds is guarded by
   * `…->GetBoundingBox().Intersects( zone_boundingbox )`, where the zone's box
   * has been inflated by `m_worstClearance` — `BOARD::GetMaxClearanceValue`,
   * the largest gap any rule can ask for. Without a guard a small pour
   * polygonises every pad and track on the board; with one that is too tight,
   * an item just outside the outline stops insetting the pour and the fill runs
   * up to something it should be clear of.
   */
  it('insets the pour when a track sits well beyond the outline', () => {
    // The clearance is much larger than the track, so only a box grown by the
    // CLEARANCE reaches it. Growing by the item's own size is not enough.
    const b = board({
      zones: [zone({ clearance: MM(3) })],
      tracks: [
        {
          start: { x: MM(5), y: MM(-2) },
          end: { x: MM(35), y: MM(-2) },
          width: MM(0.4),
          layer: 'F.Cu',
          net: 2,
          source: EMPTY,
        },
      ],
    });
    const fill = fillZone(b, 0)[0]!.polys;

    // 3 mm of clearance plus 0.2 mm of half-width, out from y = -2.
    expect(filled(fill, { x: MM(20), y: MM(0.8) })).toBe(false);
    expect(filled(fill, { x: MM(20), y: MM(1.4) })).toBe(true);
  });

  it('and when a different-net pad does', () => {
    const b = board({
      zones: [zone({ clearance: MM(3) })],
      footprints: [footprint([pad({ x: MM(20), y: MM(-2) }, 2, MM(2))])],
    });
    const fill = fillZone(b, 0)[0]!.polys;

    // The pad's copper ends at y = -1; the clearance reaches 3 mm past it.
    expect(filled(fill, { x: MM(20), y: MM(1.7) })).toBe(false);
    expect(filled(fill, { x: MM(20), y: MM(2.3) })).toBe(true);
  });

  it('and when a via does', () => {
    const b = board({
      zones: [zone({ clearance: MM(3) })],
      vias: [
        {
          at: { x: MM(20), y: MM(-2) },
          size: MM(0.8),
          drill: MM(0.4),
          layers: ['F.Cu', 'B.Cu'],
          kind: 'through',
          net: 2,
          source: EMPTY,
        },
      ],
    });
    const fill = fillZone(b, 0)[0]!.polys;

    // 0.4 mm of via radius plus 3 mm, out from y = -2.
    expect(filled(fill, { x: MM(20), y: MM(1.1) })).toBe(false);
    expect(filled(fill, { x: MM(20), y: MM(1.7) })).toBe(true);
  });
});

describe('a teardrop outranks any ordinary zone', () => {
  it('knocks the pour out even from a zone of higher priority', () => {
    // `ZONE::HigherPriority` tests the teardrop flag FIRST: "Teardrops are
    // always higher priority than regular zones, so if one zone is a teardrop
    // and the other is not, then return higher priority as the teardrop". A
    // flare that lost to the pour it flares out of would be poured over.
    const flare: PcbZone = {
      ...zone({
        net: 2,
        priority: 0,
        uuid: 'td',
        teardropType: 'viapad',
        outline: [
          { x: MM(10), y: MM(10) },
          { x: MM(20), y: MM(10) },
          { x: MM(20), y: MM(20) },
          { x: MM(10), y: MM(20) },
        ],
      }),
      fills: [
        {
          layer: 'F.Cu',
          polys: [
            [
              { x: MM(10), y: MM(10) },
              { x: MM(20), y: MM(10) },
              { x: MM(20), y: MM(20) },
              { x: MM(10), y: MM(20) },
            ],
          ],
        },
      ],
    };
    const b = board({ zones: [zone({ priority: 5 }), flare] });

    // 10 x 10 mm of flare, plus the clearance round it.
    expect(1600 - area(fillZone(b, 0)[0]!.polys)).toBeGreaterThan(100);
  });
});

// -----------------------------------------------------------------------------
// copper text
// -----------------------------------------------------------------------------

describe('copper text is knocked out of the pour', () => {
  /**
   * `knockoutGraphicClearance` runs over every drawing and `addKnockout` has a
   * `PCB_TEXT_T` case (zone_filler.cpp:1735). Ours had no text knockout at all,
   * so a pour ran straight through the lettering on a copper layer — a short,
   * not a cosmetic difference. On `complex_hierarchy` a two-line B.Cu label was
   * 140 mm² of copper we filled and KiCad does not.
   *
   * And the shape is the text's ORIENTED BOUNDING RECTANGLE, not its glyphs:
   * `PCB_TEXT::TransformShapeToPolygon` hands the rendered text to
   * `buildBoundingHull`, which un-rotates it about the text position, takes an
   * axis-aligned `BBox( aClearance )` and rotates the four corners back.
   */
  const text = (over: Partial<PcbTextItem> = {}): PcbTextItem => ({
    kind: 'user',
    text: 'AB',
    at: { x: MM(20), y: MM(20) },
    angle: 0,
    layer: 'F.Cu',
    size: { x: MM(1.5), y: MM(2) },
    thickness: MM(0.3),
    source: EMPTY,
    ...over,
  });

  it('leaves a hole where a label sits', () => {
    const b = board({ zones: [zone()], texts: [text()] });
    const fill = fillZone(b, 0)[0]!.polys;
    expect(filled(fill, { x: MM(20), y: MM(20) })).toBe(false);
    // And the pour is intact well away from it.
    expect(filled(fill, { x: MM(30), y: MM(30) })).toBe(true);
  });

  it('reserves the whole block, not just the strokes', () => {
    // The hole is the RECTANGLE round the block, so a short line reserves as
    // much width as the long one above it. Probed at the far end of the short
    // line, where there is no glyph at all: a stroke-shaped knockout leaves
    // copper there, and `buildBoundingHull` does not.
    const b = board({
      zones: [zone()],
      texts: [text({ text: 'MMMMMMMMMM\nM', at: { x: MM(20), y: MM(20) } })],
    });
    const fill = fillZone(b, 0)[0]!.polys;

    // The lettering itself is gone either way.
    expect(filled(fill, { x: MM(20), y: MM(20) })).toBe(false);

    // 5 mm right of centre on the SECOND line's baseline: inside the block,
    // and nowhere near the single 'M'.
    expect(filled(fill, { x: MM(25), y: MM(21.6) })).toBe(false);
  });

  it('turns the rectangle with the text', () => {
    // A long label rotated 90° reserves a tall block, not a wide one.
    const long = 'LONG LABEL HERE';
    const flat = fillZone(board({ zones: [zone()], texts: [text({ text: long })] }), 0)[0]!.polys;
    const upright = fillZone(
      board({ zones: [zone()], texts: [text({ text: long, angle: 90 })] }),
      0,
    )[0]!.polys;

    // 6 mm along the text's own direction is inside the block either way.
    expect(filled(flat, { x: MM(26), y: MM(20) })).toBe(false);
    expect(filled(flat, { x: MM(20), y: MM(26) })).toBe(true);
    expect(filled(upright, { x: MM(26), y: MM(20) })).toBe(true);
    expect(filled(upright, { x: MM(20), y: MM(26) })).toBe(false);
  });

  it('ignores hidden text', () => {
    // "if( text->IsVisible() )".
    const b = board({ zones: [zone()], texts: [text({ hide: true })] });
    expect(filled(fillZone(b, 0)[0]!.polys, { x: MM(20), y: MM(20) })).toBe(true);
  });

  it("knocks out a footprint's text too", () => {
    // `knockoutGraphicClearance` is called for every footprint's drawings as
    // well as the board's.
    const fp = footprint([]);
    const b = board({ zones: [zone()], footprints: [{ ...fp, texts: [text()] }] });
    expect(filled(fillZone(b, 0)[0]!.polys, { x: MM(20), y: MM(20) })).toBe(false);
  });

  it('leaves text on another layer alone', () => {
    const b = board({ zones: [zone()], texts: [text({ layer: 'B.SilkS' })] });
    expect(filled(fillZone(b, 0)[0]!.polys, { x: MM(20), y: MM(20) })).toBe(true);
  });
});
