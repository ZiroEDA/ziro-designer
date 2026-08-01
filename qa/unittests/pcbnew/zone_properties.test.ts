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
  zoneAt,
  type ZoneValues,
} from '@ziroeda/pcbnew/src/zone_properties.js';
import { fillZone } from '@ziroeda/pcbnew/src/zone_filler.js';
import type { Board, PcbZone } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const load = (text: string): Board => readBoard(parse(text));
const roundTrip = (b: Board): Board => load(serializeBoard(b));

const SRC = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (net 0 "")
  (net 1 "GND")
  (net 2 "VCC")
  (zone (net 1) (net_name "GND") (layer "F.Cu") (uuid "z1") (hatch edge 0.5)
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
    expect(zone(roundTrip(edit({ net: 2 }))).net).toBe(2);
  });

  it('changes a single layer, and spreads onto several', () => {
    expect(zone(roundTrip(edit({ layers: ['B.Cu'] }))).layers).toEqual(['B.Cu']);

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
    const flat = (bd: Board) => serializeBoard(bd).replace(/\s+/g, ' ');
    expect(flat(edit({ islandRemovalMode: 'never' }))).not.toContain('island_area_min');
    expect(flat(edit({ islandRemovalMode: 'always' }))).not.toContain('island_removal_mode');
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
    expect(out.zones[0]!.uuid).toBe('z1');
    expect(out.zones[0]!.netName).toBe('GND');
  });

  it('survives a collect/apply round with no edits', () => {
    const once = edit({ clearance: MM(0.3) });
    const again = applyZoneValues(once, 0, collectZoneValues(zone(once)));
    expect(again).toBe(once);
  });
});

describe('island removal reaches the filler', () => {
  const EMPTY = { kind: 'list' as const, items: [] };

  const pad = (at: { x: number; y: number }, net: number, size: number) => ({
    number: '1',
    type: 'smd' as const,
    shape: 'rect' as const,
    at,
    angle: 0,
    size: { x: MM(size), y: MM(size) },
    layers: ['F.Cu'],
    net,
    source: EMPTY,
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
        models: [],
        source: EMPTY,
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
        source: EMPTY,
      },
    ],
    shapes: [],
    texts: [],
    groups: [],
    source: EMPTY,
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
