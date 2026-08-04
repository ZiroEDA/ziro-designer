// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Non-Copper Zone Properties (DIALOG_NON_COPPER_ZONES_EDITOR): the subset of a
 * zone's settings a technical-layer zone actually has, the hatch defaults the
 * dialog invents on open, and the copper-only settings it must leave alone.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  applyNonCopperZoneValues,
  collectNonCopperZoneValues,
  nonCopperZoneValuesError,
  type NonCopperZoneValues,
} from '@ziroeda/pcbnew/src/non_copper_zone_properties.js';
import type { Board, PcbZone } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const load = (text: string): Board => readBoard(parse(text));
const roundTrip = (b: Board): Board => load(serializeBoard(b));
const zone = (b: Board): PcbZone => b.zones[0]!;
const flat = (b: Board): string => serializeBoard(b).replace(/\s+/g, ' ').replace(/ \)/g, ')');

/** A zone on a technical layer. `fill` replaces the whole `(fill …)` child. */
const src = (fill = '(fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))'): string => `
(kicad_pcb (version 20240108) (generator test)
  (layers (0 "F.Cu" signal) (36 "F.SilkS" user) (44 "Edge.Cuts" user))
  (net 0 "")
  (zone (net 0) (net_name "") (layer "F.SilkS") (uuid "nc") (hatch edge 0.5)
    (connect_pads (clearance 0.5))
    (min_thickness 0.25)
    ${fill}
    (polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10))))
)`;

describe('collect (TransferDataToWindow)', () => {
  it('reads the outline and fill-width settings', () => {
    const v = collectNonCopperZoneValues(zone(load(src())));

    expect(v.layers).toEqual(['F.SilkS']);
    expect(v.hatchStyle).toBe('edge');
    expect(v.hatchPitch).toBe(MM(0.5));
    expect(v.minThickness).toBe(MM(0.25));
    expect(v.cornerSmoothing).toBe('none');
    expect(v.fillMode).toBe('solid');
  });

  it('invents a hatch width and gap for a zone that has never been hatched', () => {
    // Stored zeroes would fail the "at least the minimum width" check the
    // moment the user picked the hatched style, so the dialog seeds 4x and 6x
    // the minimum width, floored at 1 mm and 1.5 mm.
    const v = collectNonCopperZoneValues(zone(load(src())));
    expect(v.hatchThickness).toBe(MM(1.0)); // max(0.25*4, 1.0) = 1.0
    expect(v.hatchGap).toBe(MM(1.5)); // max(0.25*6, 1.5) = 1.5
  });

  it('lets a large minimum width beat the 1 mm / 1.5 mm floors', () => {
    const v = collectNonCopperZoneValues(zone(load(src().replace('0.25)', '1)'))));
    expect(v.minThickness).toBe(MM(1));
    expect(v.hatchThickness).toBe(MM(4));
    expect(v.hatchGap).toBe(MM(6));
  });

  it('raises a stored hatch width that is under the minimum width', () => {
    // The clamp bites before the user touches anything; drop it and OK would
    // be refused on a form the user never edited.
    const v = collectNonCopperZoneValues(
      zone(load(src('(fill yes (mode hatch) (hatch_thickness 0.1) (hatch_gap 0.1))'))),
    );
    expect(v.hatchThickness).toBe(MM(0.25));
    expect(v.hatchGap).toBe(MM(0.25));
  });

  it('shows a copper-thieving fill as solid', () => {
    // The style choice offers only solid and hatched, and thieving falls into
    // the `default:` arm — so OK demotes the zone.
    const thieving = load(src('(fill yes (mode thieving) (thieving (type dots) (size 0.5)))'));
    expect(zone(thieving).fillMode).toBe('thieving');
    expect(collectNonCopperZoneValues(zone(thieving)).fillMode).toBe('solid');
  });
});

describe('validation', () => {
  const base = collectNonCopperZoneValues(zone(load(src())));

  it('holds the hatch pitch to ZONE_BORDER_HATCH_{MIN,MAX}DIST_MM', () => {
    expect(nonCopperZoneValuesError({ ...base, hatchPitch: MM(0.09) })?.kind).toBe('min');
    expect(nonCopperZoneValuesError({ ...base, hatchPitch: MM(2.01) })?.kind).toBe('max');
    expect(nonCopperZoneValuesError({ ...base, hatchPitch: MM(0.5) })).toBeNull();
  });

  it('checks the hatch width and gap only for a hatched fill', () => {
    const narrow: NonCopperZoneValues = { ...base, hatchThickness: MM(0.1), hatchGap: MM(0.1) };
    // Solid: the numbers are stored but never validated.
    expect(nonCopperZoneValuesError(narrow)).toBeNull();
    expect(nonCopperZoneValuesError({ ...narrow, fillMode: 'hatch' })).toEqual({
      field: 'hatchWidth',
      kind: 'min',
      bound: MM(0.25),
    });
    expect(
      nonCopperZoneValuesError({ ...narrow, fillMode: 'hatch', hatchThickness: MM(1) }),
    ).toEqual({ field: 'hatchGap', kind: 'min', bound: MM(0.25) });
  });

  it('refuses a zone with no layer, after the numeric checks', () => {
    // Upstream's layer test is the last thing TransferDataFromWindow does, so
    // a bad pitch is reported ahead of it.
    expect(nonCopperZoneValuesError({ ...base, layers: [] })).toEqual({
      field: 'layers',
      kind: 'empty',
      bound: 0,
    });
    expect(nonCopperZoneValuesError({ ...base, layers: [], hatchPitch: 0 })?.field).toBe(
      'hatchPitch',
    );
  });

  it('applies nothing at all when the values are refused', () => {
    const b = load(src());
    expect(applyNonCopperZoneValues(b, 0, { ...base, layers: [] })).toBe(b);
  });
});

describe('apply', () => {
  const b = load(src());
  const base = collectNonCopperZoneValues(zone(b));
  const edit = (over: Partial<NonCopperZoneValues>): Board =>
    applyNonCopperZoneValues(b, 0, { ...base, ...over });

  it('changes the outline style, pitch, minimum width and lock', () => {
    const out = zone(
      roundTrip(
        edit({ hatchStyle: 'full', hatchPitch: MM(1), minThickness: MM(0.4), locked: true }),
      ),
    );

    expect(out.hatchStyle).toBe('full');
    expect(out.hatchPitch).toBe(MM(1));
    expect(out.minThickness).toBe(MM(0.4));
    expect(out.locked).toBe(true);
  });

  it('moves the zone to another technical layer', () => {
    expect(zone(roundTrip(edit({ layers: ['Edge.Cuts'] }))).layers).toEqual(['Edge.Cuts']);
  });

  it('writes corner smoothing, and zeroes the radius when it is switched off', () => {
    const on = edit({ cornerSmoothing: 'fillet', cornerRadius: MM(1) });
    expect(zone(roundTrip(on)).cornerSmoothing).toBe('fillet');
    expect(zone(roundTrip(on)).cornerRadius).toBe(MM(1));

    const off = applyNonCopperZoneValues(on, 0, {
      ...collectNonCopperZoneValues(zone(on)),
      cornerSmoothing: 'none',
    });
    // The radius is forced to 0 whatever the control still holds, and both
    // tokens go — a stale (radius …) would come back on the next fillet.
    // Checked on the model, not the reloaded board: dropping the token makes
    // a reload read 0 back regardless of what the zone in memory holds.
    expect(zone(off).cornerRadius).toBe(0);
    expect(flat(off)).not.toContain('(smoothing');
    expect(flat(off)).not.toContain('(radius');
  });

  it('writes the hatch parameters only for a hatched fill', () => {
    const hatched = edit({
      fillMode: 'hatch',
      hatchThickness: MM(0.6),
      hatchGap: MM(1.2),
      hatchOrientation: 45,
    });
    const back = zone(roundTrip(hatched));

    expect(back.fillMode).toBe('hatch');
    expect(back.hatchThickness).toBe(MM(0.6));
    expect(back.hatchGap).toBe(MM(1.2));
    expect(back.hatchOrientation).toBe(45);

    const solid = applyNonCopperZoneValues(hatched, 0, {
      ...collectNonCopperZoneValues(zone(hatched)),
      fillMode: 'solid',
    });
    expect(flat(solid)).not.toContain('hatch_thickness');
    expect(flat(solid)).not.toContain('(mode hatch)');
    expect(zone(roundTrip(solid)).fillMode).toBe('solid');
  });

  it('writes the hatch smoothing pair only above level 0', () => {
    const smooth = edit({ fillMode: 'hatch', hatchSmoothingLevel: 2, hatchSmoothingValue: 0.2 });
    expect(flat(smooth)).toContain('(hatch_smoothing_level 2)');

    const flatOff = applyNonCopperZoneValues(smooth, 0, {
      ...collectNonCopperZoneValues(zone(smooth)),
      hatchSmoothingLevel: 0,
    });
    expect(flat(flatOff)).not.toContain('hatch_smoothing_level');
    expect(flat(flatOff)).not.toContain('hatch_smoothing_value');
  });

  it('leaves the copper-only settings the form never shows', () => {
    // Thermal relief, clearance and island removal belong to the copper form.
    // Rebuilding the fill node instead of patching it would drop them.
    const rich = load(
      src(
        '(fill yes (thermal_gap 0.7) (thermal_bridge_width 0.6) (island_removal_mode 2) (island_area_min 4))',
      ),
    );
    const out = applyNonCopperZoneValues(rich, 0, {
      ...collectNonCopperZoneValues(zone(rich)),
      hatchStyle: 'none',
    });
    const back = zone(roundTrip(out));

    expect(back.thermalGap).toBe(MM(0.7));
    expect(back.thermalBridgeWidth).toBe(MM(0.6));
    expect(back.islandRemovalMode).toBe('area');
    expect(back.islandAreaMin).toBe(4);
    expect(back.clearance).toBe(MM(0.5));
  });

  it('does not touch the zone name, which the form has no field for', () => {
    const named = load(src().replace('(uuid "nc")', '(uuid "nc") (name "silk guard")'));
    const out = applyNonCopperZoneValues(named, 0, collectNonCopperZoneValues(zone(named)));
    expect(zone(roundTrip(out)).name).toBe('silk guard');
  });

  it('demotes a copper-thieving zone to solid on OK', () => {
    // Mirroring upstream's omission: the choice cannot express thieving, so
    // the mode is written back as whatever the choice says.
    const thieving = load(src('(fill yes (mode thieving) (thieving (type dots) (size 0.5)))'));
    const out = applyNonCopperZoneValues(thieving, 0, collectNonCopperZoneValues(zone(thieving)));
    expect(zone(roundTrip(out)).fillMode).toBe('solid');
  });
});
