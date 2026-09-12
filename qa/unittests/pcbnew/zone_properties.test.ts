// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Copper Zone Properties (PANEL_ZONE_PROPERTIES): the fields it edits, and the
 * source patching that makes each one reach the file.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  applyZoneValues,
  collectZoneValues,
  uniqueZonePriority,
  zoneAt,
  type ZoneValues,
} from '@ziroeda/pcbnew/src/zone_properties.js';
import { fillZone } from '@ziroeda/pcbnew/src/zone_filler.js';
import type { Board, PcbZone } from '@ziroeda/pcbnew/src/types.js';
import { U } from './support/written_node.js';

const MM = (n: number): number => mmToIU(n);
const load = (text: string): Board => readBoard(parse(text));
const roundTrip = (b: Board): Board => load(serializeBoard(b));

const SRC = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (net 0 "")
  (net 1 "GND")
  (net 2 "VCC")
  (zone (net 1) (net_name "GND") (layer "F.Cu") (uuid "${U('z1')}") (hatch edge 0.5)
    (connect_pads (clearance 0.5))
    (min_thickness 0.25)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 0 0) (xy 40 0) (xy 40 40) (xy 0 40))))
)`;

const zone = (b: Board): PcbZone => b.zones[0]!;

describe('zoneAt', () => {
  const b = load(SRC);

  it('finds a single selected zone', () => {
    expect(zoneAt(b, ['zone:0'])).toBe(0);
    expect(zoneAt(b, ['track:0', 'zone:0'])).toBe(0);
  });

  it('refuses an ambiguous or empty selection', () => {
    expect(zoneAt(b, [])).toBeNull();
    expect(zoneAt(b, ['track:0'])).toBeNull();
    expect(zoneAt(b, ['zone:0', 'zone:1'])).toBeNull();
  });
});

describe('collect (TransferDataToWindow)', () => {
  it('reads the zone, filling in ZONE_SETTINGS defaults for absent fields', () => {
    const v = collectZoneValues(zone(load(SRC)));

    expect(v.net).toBe(1);
    expect(v.layers).toEqual(['F.Cu']);
    expect(v.clearance).toBe(MM(0.5));
    expect(v.minThickness).toBe(MM(0.25));
    expect(v.padConnection).toBe('thermal');
    expect(v.thermalGap).toBe(MM(0.5));
    expect(v.hatchStyle).toBe('edge');
    expect(v.cornerSmoothing).toBe('none');
    expect(v.islandRemovalMode).toBe('always');
    expect(v.fillMode).toBe('solid');
    expect(v.filled).toBe(true);
    expect(v.priority).toBe(0);
    expect(v.name).toBe('');
  });
});

describe('apply', () => {
  const b = load(SRC);
  const base = collectZoneValues(zone(b));
  const edit = (over: Partial<ZoneValues>): Board => applyZoneValues(b, 0, { ...base, ...over });

  it('is a no-op when nothing changed', () => {
    expect(applyZoneValues(b, 0, base)).toBe(b);
  });

  it('sets the zone name, and drops it again when cleared', () => {
    const named = edit({ name: 'GndPour' });
    expect(zone(roundTrip(named)).name).toBe('GndPour');

    const cleared = applyZoneValues(named, 0, { ...collectZoneValues(zone(named)), name: '' });
    expect(zone(roundTrip(cleared)).name).toBeUndefined();
    expect(serializeBoard(cleared).replace(/\s+/g, ' ')).not.toContain('(name ');
  });

  it('changes the net', () => {
    // By name: a 10.0 file carries no codes, so the reader numbers the names
    // as it meets them and the only item's net comes back as 1.
    const out = roundTrip(edit({ net: 2 }));
    expect(out.nets.get(zone(out).net)).toBe('VCC');
  });

  it('changes a single layer, and spreads onto several', () => {
    expect(zone(roundTrip(edit({ layers: ['B.Cu'] }))).layers).toEqual(['B.Cu']);

    // "Always enumerate every layer for a zone on a copper layer"
    // (pcb_io_kicad_sexpr.cpp:2883): no `*.Cu` wildcard for a copper zone.
    const multi = edit({ layers: ['F.Cu', 'B.Cu'] });
    const flat = serializeBoard(multi).replace(/\s+/g, ' ').replace(/ \)/g, ')');
    expect(flat).toContain('(layers "F.Cu" "B.Cu")');
    // The single-layer spelling must not survive alongside it.
    expect(flat).not.toContain('(layer "F.Cu")');
    expect(zone(roundTrip(multi)).layers).toEqual(['F.Cu', 'B.Cu']);
  });

  it('changes the clearances and thermal settings', () => {
    const out = zone(
      roundTrip(
        edit({
          clearance: MM(0.3),
          minThickness: MM(0.2),
          thermalGap: MM(0.4),
          thermalBridgeWidth: MM(0.35),
        }),
      ),
    );

    expect(out.clearance).toBe(MM(0.3));
    expect(out.minThickness).toBe(MM(0.2));
    expect(out.thermalGap).toBe(MM(0.4));
    expect(out.thermalBridgeWidth).toBe(MM(0.35));
  });

  it('changes the pad connection mode, both spellings', () => {
    expect(zone(roundTrip(edit({ padConnection: 'full' }))).padConnection).toBe('full');
    expect(zone(roundTrip(edit({ padConnection: 'none' }))).padConnection).toBe('none');
    expect(zone(roundTrip(edit({ padConnection: 'thru_hole_only' }))).padConnection).toBe(
      'thru_hole_only',
    );
  });

  it('changes the border display and pitch', () => {
    const out = zone(roundTrip(edit({ hatchStyle: 'full', hatchPitch: MM(1) })));
    expect(out.hatchStyle).toBe('full');
    expect(out.hatchPitch).toBe(MM(1));
  });

  it('changes corner smoothing and its radius', () => {
    const out = zone(roundTrip(edit({ cornerSmoothing: 'fillet', cornerRadius: MM(1) })));
    expect(out.cornerSmoothing).toBe('fillet');
    expect(out.cornerRadius).toBe(MM(1));
  });

  it('drops the smoothing tokens when set back to none', () => {
    const on = edit({ cornerSmoothing: 'chamfer', cornerRadius: MM(1) });
    const off = applyZoneValues(on, 0, {
      ...collectZoneValues(zone(on)),
      cornerSmoothing: 'none',
      cornerRadius: 0,
    });

    expect(serializeBoard(off).replace(/\s+/g, ' ')).not.toContain('(smoothing');
    expect(zone(roundTrip(off)).cornerSmoothing).toBe('none');
  });

  it('changes the island removal mode and its area limit', () => {
    const never = zone(roundTrip(edit({ islandRemovalMode: 'never' })));
    expect(never.islandRemovalMode).toBe('never');

    const area = zone(roundTrip(edit({ islandRemovalMode: 'area', islandAreaMin: 4 })));
    expect(area.islandRemovalMode).toBe('area');
    expect(area.islandAreaMin).toBe(4);
  });

  it('writes the area limit only in the area mode', () => {
    // `(island_removal_mode %d)` is written unconditionally (:3022); the area
    // follows only for AREA (:3025).
    const flat = (bd: Board) => serializeBoard(bd).replace(/\s+/g, ' ');
    expect(flat(edit({ islandRemovalMode: 'never' }))).not.toContain('island_area_min');
    expect(flat(edit({ islandRemovalMode: 'always' }))).toContain('(island_removal_mode 0)');
    expect(flat(edit({ islandRemovalMode: 'always' }))).not.toContain('island_area_min');
    expect(flat(edit({ islandRemovalMode: 'area', islandAreaMin: 4 }))).toContain(
      '(island_area_min 4)',
    );
  });

  it('changes the fill mode, and drops the hatch tokens on the way back to solid', () => {
    const hatched = edit({
      fillMode: 'hatch',
      hatchThickness: MM(0.5),
      hatchGap: MM(1),
      hatchOrientation: 45,
    });
    const back = zone(roundTrip(hatched));

    expect(back.fillMode).toBe('hatch');
    expect(back.hatchThickness).toBe(MM(0.5));
    expect(back.hatchGap).toBe(MM(1));
    expect(back.hatchOrientation).toBe(45);

    const solid = applyZoneValues(hatched, 0, {
      ...collectZoneValues(zone(hatched)),
      fillMode: 'solid',
    });
    expect(serializeBoard(solid).replace(/\s+/g, ' ')).not.toContain('hatch_thickness');
    expect(zone(roundTrip(solid)).fillMode).toBe('solid');
  });

  it('changes the priority, and drops it at zero', () => {
    const p = edit({ priority: 3 });
    expect(zone(roundTrip(p)).priority).toBe(3);

    const zeroed = applyZoneValues(p, 0, { ...collectZoneValues(zone(p)), priority: 0 });
    expect(serializeBoard(zeroed).replace(/\s+/g, ' ')).not.toContain('(priority');
  });

  it('locks and unlocks', () => {
    const locked = edit({ locked: true });
    expect(zone(roundTrip(locked)).locked).toBe(true);

    const unlocked = applyZoneValues(locked, 0, {
      ...collectZoneValues(zone(locked)),
      locked: false,
    });
    expect(zone(roundTrip(unlocked)).locked).toBeFalsy();
  });

  it('leaves the outline and everything else in the file alone', () => {
    const out = roundTrip(edit({ clearance: MM(0.3) }));

    expect(out.zones[0]!.outline).toEqual(b.zones[0]!.outline);
    expect(out.zones[0]!.uuid).toBe(U('z1'));
    expect(out.zones[0]!.netName).toBe('GND');
  });

  it('survives a collect/apply round with no edits', () => {
    const once = edit({ clearance: MM(0.3) });
    const again = applyZoneValues(once, 0, collectZoneValues(zone(once)));
    expect(again).toBe(once);
  });
});

describe('island removal reaches the filler', () => {
  const pad = (at: { x: number; y: number }, net: number, size: number) => ({
    number: '1',
    type: 'smd' as const,
    shape: 'rect' as const,
    at,
    angle: 0,
    size: { x: MM(size), y: MM(size) },
    layers: ['F.Cu'],
    net,
  });

  /**
   * A dumbbell pour: two 10 mm squares joined by a 1 mm neck. A same-net pad
   * anchors the left square; a foreign pad on the neck is knocked out with
   * enough clearance to sever it, so the right square becomes a real island.
   */
  const dumbbell = (mode: PcbZone['islandRemovalMode'], areaMin?: number): Board => ({
    version: 20240108,
    layers: [],
    nets: new Map([
      [0, ''],
      [1, 'GND'],
      [2, 'VCC'],
    ]),
    footprints: [
      {
        lib: 'R',
        at: { x: 0, y: 0 },
        angle: 0,
        layer: 'F.Cu',
        pads: [pad({ x: MM(5), y: MM(5) }, 1, 2), pad({ x: MM(15), y: MM(5) }, 2, 0.5)],
        shapes: [],
        texts: [],
        points: [],
        barcodes: [],
        models: [],
      },
    ],
    tracks: [],
    arcs: [],
    vias: [],
    zones: [
      {
        net: 1,
        layers: ['F.Cu'],
        outline: [
          { x: 0, y: 0 },
          { x: MM(10), y: 0 },
          { x: MM(10), y: MM(4.5) },
          { x: MM(20), y: MM(4.5) },
          { x: MM(20), y: 0 },
          { x: MM(30), y: 0 },
          { x: MM(30), y: MM(10) },
          { x: MM(20), y: MM(10) },
          { x: MM(20), y: MM(5.5) },
          { x: MM(10), y: MM(5.5) },
          { x: MM(10), y: MM(10) },
          { x: 0, y: MM(10) },
        ],
        fills: [],
        padConnection: 'full',
        clearance: MM(0.5),
        minThickness: MM(0.25),
        islandRemovalMode: mode,
        islandAreaMin: areaMin,
      },
    ],
    shapes: [],
    texts: [],
    dimensions: [],
    textBoxes: [],
    tables: [],
    images: [],
    points: [],
    barcodes: [],
    groups: [],
  });

  const polyCount = (b: Board): number => fillZone(b, 0)[0]?.polys.length ?? 0;

  it('ALWAYS drops the severed lobe and keeps the anchored one', () => {
    expect(polyCount(dumbbell('always'))).toBe(1);
  });

  it('NEVER keeps both', () => {
    expect(polyCount(dumbbell('never'))).toBe(2);
  });

  it('AREA keeps an island at or above the limit', () => {
    // The severed lobe is 10 x 10 mm = 100 mm².
    expect(polyCount(dumbbell('area', 50))).toBe(2);
  });

  it('AREA drops an island below the limit', () => {
    expect(polyCount(dumbbell('area', 400))).toBe(1);
  });
});

/**
 * `ZONE_CREATE_HELPER::setUniquePriority` — the priority the Draw Filled Zone
 * tool opens its dialog with.
 */
describe('uniqueZonePriority', () => {
  const board = (zones: Partial<PcbZone>[]): Board => ({
    ...load(SRC),
    zones: zones.map((z) => ({
      net: 0,
      netName: '',
      layers: ['F.Cu'],
      outline: [],
      fills: [],
      ...z,
    })) as PcbZone[],
  });

  it('is 0 on a board with no copper zones', () => {
    expect(uniqueZonePriority(board([]))).toBe(0);
  });

  it('takes the first GAP, not one past the highest', () => {
    // The priorities go into a `std::set`, which iterates ascending, and the
    // loop breaks at the first index that does not match its own value.
    expect(uniqueZonePriority(board([{ priority: 0 }, { priority: 1 }, { priority: 3 }]))).toBe(2);
  });

  it('counts up when the run is unbroken', () => {
    expect(uniqueZonePriority(board([{ priority: 0 }, { priority: 1 }]))).toBe(2);
  });

  it('ignores rule areas, teardrops and non-copper zones', () => {
    // "zone->GetTeardropAreaType() == TD_NONE && ( layers & AllCuMask ).any()
    // && !zone->GetIsRuleArea()" — none of the three competes for the copper a
    // new zone is about to pour.
    const b = board([
      {
        priority: 0,
        ruleArea: { tracks: true, vias: true, pads: true, copperPour: false, footprints: false },
      },
      { priority: 1, teardropType: 'viapad' },
      { priority: 2, layers: ['F.SilkS'] },
    ]);
    expect(uniqueZonePriority(b)).toBe(0);
  });

  it('each exclusion is load-bearing on its own', () => {
    // The case above cannot tell the three guards apart: drop all of them and
    // the set is { 0, 1, 2 }, whose first gap is 3 — a different number, but
    // only by luck of the ordering. Each pair below is ONE real copper zone at
    // 0 with one excluded zone at 1, so the answer is 1 while its guard holds
    // and 2 the moment it does not.
    const withOne = (extra: Partial<PcbZone>): number =>
      uniqueZonePriority(board([{ priority: 0 }, { priority: 1, ...extra }]));

    expect(withOne({ layers: ['F.SilkS'] })).toBe(1);
    expect(withOne({ teardropType: 'viapad' })).toBe(1);
    expect(
      withOne({
        ruleArea: { tracks: true, vias: true, pads: true, copperPour: false, footprints: false },
      }),
    ).toBe(1);
    // …and a plain copper zone at 1 really does push it to 2.
    expect(withOne({})).toBe(2);
  });

  it('treats a zone with no stated priority as 0', () => {
    expect(uniqueZonePriority(board([{}]))).toBe(1);
  });
});
