// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PANEL_ZONE_PROPERTIES (pcbnew/dialogs/panel_zone_properties.cpp), the logic
 * half: what `TransferZoneSettingsToWindow` shows for a zone's settings, what
 * `AcceptOptions` writes back, and the two events that leave the panel as a
 * name or a net is edited.
 *
 * Expected values are read off the C++: the defaults are ZONE_SETTINGS's
 * (0.5 mm clearance, 0.25 mm minimum width, 0.5 mm thermal gap and spokes).
 */
import { describe, expect, it, vi } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PANEL_ZONE_PROPERTIES } from '@ziroeda/pcbnew/dialogs/panel_zone_properties.js';
import { NETINFO_ITEM } from '@ziroeda/pcbnew/netinfo_item.js';
import { ZONE } from '@ziroeda/pcbnew/zone.js';
import { ZONE_CONNECTION } from '@ziroeda/pcbnew/zones.js';
import { ZONE_FILL_MODE, ZONE_SETTINGS } from '@ziroeda/pcbnew/zone_settings.js';
import { ZONE_SETTINGS_BAG } from '@ziroeda/pcbnew/zone_settings_bag.js';
import { TEARDROP_TYPE } from '@ziroeda/pcbnew/teardrop/teardrop_parameters.js';

const mm = (n: number): number => pcbIUScale.mmToIU(n);

function boardWithZones(names: string[]) {
  const board = new BOARD();
  board.Add(new NETINFO_ITEM(board, 'GND', 1));
  const zones = names.map((name) => {
    const z = new ZONE(board);
    for (const p of [
      { x: 0, y: 0 },
      { x: 1e6, y: 0 },
      { x: 1e6, y: 1e6 },
    ])
      z.AppendCorner(p, -1);
    z.SetLayer(PCB_LAYER_ID.F_Cu);
    z.SetZoneName(name);
    board.Add(z);
    return z;
  });
  const bag = new ZONE_SETTINGS_BAG(board);
  const events = { name: 0, net: 0, errors: [] as string[] };
  const panel = new PANEL_ZONE_PROPERTIES({ GetBoard: () => board }, bag, true, {
    ZoneNameUpdate: () => events.name++,
    ZoneNetUpdate: () => events.net++,
    DisplayErrorMessage: (m) => events.errors.push(m),
  });
  const clones = bag.GetClonedZoneList();
  return { board, bag, panel, clones, events, zones };
}

describe('PANEL_ZONE_PROPERTIES.SetZone / TransferZoneSettingsToWindow', () => {
  it("shows the zone's settings: name, net, distances, choices", () => {
    const { panel, clones } = boardWithZones(['pour']);
    panel.SetZone(clones[0]!);
    const v = panel.GetValues()!;

    expect(v.name).toBe('pour');
    expect(v.net).toBe(0);
    expect(v.clearance).toBe(mm(0.5));
    expect(v.minThickness).toBe(mm(0.25));
    expect(v.thermalGap).toBe(mm(0.5));
    expect(v.thermalBridgeWidth).toBe(mm(0.5));
    // m_PadInZoneOpt: THERMAL is selection 1 ("Thermal reliefs").
    expect(v.padConnection).toBe('thermal');
    expect(v.cornerSmoothing).toBe('none');
    expect(v.layers).toEqual(['F.Cu']);
  });

  it('no zone: nothing shown (Enable( false ))', () => {
    const { panel } = boardWithZones(['a']);
    panel.SetZone(null);
    expect(panel.GetValues()).toBeNull();
    expect(panel.GetZone()).toBeNull();
  });

  it('a zone with no net never has islands removed: "Never" is shown', () => {
    const { panel, clones } = boardWithZones(['a']);
    panel.SetZone(clones[0]!);
    // ZONE_SETTINGS defaults to ISLAND_REMOVAL_MODE::ALWAYS; net 0 forces the display to Never.
    expect(panel.GetValues()!.islandRemovalMode).toBe('never');
  });

  it("a teardrop's zone is shown with no smoothing, fixed pad connection and solid fill", () => {
    const { panel, clones, bag } = boardWithZones(['td']);
    const settings = bag.GetZoneSettings(clones[0]!)!;
    settings.m_TeardropType = TEARDROP_TYPE.TD_VIAPAD;
    settings.SetCornerSmoothingType(ZONE_SETTINGS.SMOOTHING_FILLET);
    settings.SetPadConnection(ZONE_CONNECTION.NONE);
    panel.SetZone(clones[0]!);
    expect(panel.IsTeardrop()).toBe(true);
    const v = panel.GetValues()!;
    expect(v.cornerSmoothing).toBe('none');
    expect(v.padConnection).toBe('full');
    expect(v.fillMode).toBe('solid');
  });
});

describe('PANEL_ZONE_PROPERTIES.TransferZoneSettingsFromWindow (AcceptOptions)', () => {
  it("writes the fields into the zone's settings in the bag", () => {
    const { panel, clones, bag } = boardWithZones(['a']);
    panel.SetZone(clones[0]!);
    panel.SetValues({
      clearance: mm(0.3),
      minThickness: mm(0.2),
      thermalBridgeWidth: mm(0.4),
      padConnection: 'full',
      cornerSmoothing: 'fillet',
      cornerRadius: mm(1),
      locked: true,
    });

    expect(panel.TransferZoneSettingsFromWindow()).toBe(true);
    const s = bag.GetZoneSettings(clones[0]!)!;
    expect(s.m_ZoneClearance).toBe(mm(0.3));
    expect(s.m_ZoneMinThickness).toBe(mm(0.2));
    expect(s.m_ThermalReliefSpokeWidth).toBe(mm(0.4));
    expect(s.GetPadConnection()).toBe(ZONE_CONNECTION.FULL);
    expect(s.GetCornerSmoothingType()).toBe(ZONE_SETTINGS.SMOOTHING_FILLET);
    expect(s.GetCornerRadius()).toBe(mm(1));
    expect(s.m_Locked).toBe(true);
  });

  it('smoothing "None" writes a zero radius whatever the radius field holds', () => {
    const { panel, clones, bag } = boardWithZones(['a']);
    panel.SetZone(clones[0]!);
    panel.SetValues({ cornerSmoothing: 'none', cornerRadius: mm(2) });
    panel.TransferZoneSettingsFromWindow();
    expect(bag.GetZoneSettings(clones[0]!)!.GetCornerRadius()).toBe(0);
  });

  it('refuses a thermal spoke narrower than the minimum width, and says so', () => {
    const { panel, clones, bag, events } = boardWithZones(['a']);
    panel.SetZone(clones[0]!);
    panel.SetValues({ minThickness: mm(0.5), thermalBridgeWidth: mm(0.3) });

    expect(panel.TransferZoneSettingsFromWindow()).toBe(false);
    expect(events.errors).toEqual([
      'Thermal spoke width cannot be smaller than the minimum width.',
    ]);
    // The settings are written up to the refusing check, and the name/net not at all.
    expect(bag.GetZoneSettings(clones[0]!)!.m_Name).toBe('a');
  });

  it('refuses a minimum width below ZONE_THICKNESS_MIN_VALUE_MM (0.001 mm) without a message', () => {
    const { panel, clones, events } = boardWithZones(['a']);
    panel.SetZone(clones[0]!);
    panel.SetValues({ minThickness: mm(0.0001) });
    expect(panel.TransferZoneSettingsFromWindow()).toBe(false);
    expect(events.errors).toEqual([]);
  });

  it('aUseExportableSetupOnly stops before the name and the fill mode', () => {
    const { panel, clones, bag } = boardWithZones(['a']);
    panel.SetZone(clones[0]!);
    panel.SetValues({ name: 'renamed', fillMode: 'hatch', clearance: mm(0.9) });
    // The name event has already written the name; the fill mode is what stays behind.
    expect(panel.AcceptOptions(true)).toBe(true);
    const s = bag.GetZoneSettings(clones[0]!)!;
    expect(s.m_ZoneClearance).toBe(mm(0.9));
    expect(s.m_FillMode).toBe(ZONE_FILL_MODE.POLYGONS);
    expect(panel.AcceptOptions(false)).toBe(true);
    expect(bag.GetZoneSettings(clones[0]!)!.m_FillMode).toBe(ZONE_FILL_MODE.HATCH_PATTERN);
  });

  it("SetZone transfers the previous zone's fields before showing the next", () => {
    const { panel, clones, bag } = boardWithZones(['a', 'b']);
    panel.SetZone(clones[0]!);
    panel.SetValues({ clearance: mm(0.77) });
    panel.SetZone(clones[1]!);

    expect(bag.GetZoneSettings(clones[0]!)!.m_ZoneClearance).toBe(mm(0.77));
    // ...and the second's own are shown, not the first's.
    expect(panel.GetValues()!.clearance).toBe(mm(0.5));
  });
});

describe('PANEL_ZONE_PROPERTIES events', () => {
  it('a name edit reaches the settings, the zone and the overview at once (OnZoneNameChanged)', () => {
    const { panel, clones, bag, events } = boardWithZones(['a']);
    panel.SetZone(clones[0]!);
    panel.SetValues({ name: 'plane' });

    expect(events.name).toBe(1);
    expect(clones[0]!.GetZoneName()).toBe('plane');
    expect(bag.GetZoneSettings(clones[0]!)!.m_Name).toBe('plane');
  });

  it('a net edit reaches the settings and the zone, and remembers the island choice (onNetSelector)', () => {
    const { panel, clones, bag, events } = boardWithZones(['a']);
    panel.SetZone(clones[0]!);

    panel.SetValues({ net: 1 });
    expect(events.net).toBe(1);
    expect(bag.GetZoneSettings(clones[0]!)!.m_Netcode).toBe(1);
    expect(clones[0]!.GetNetCode()).toBe(1);
    // A net makes the island choice live again: the settings' own, "Always".
    expect(panel.GetValues()!.islandRemovalMode).toBe('always');

    panel.SetValues({ islandRemovalMode: 'area' });
    panel.SetValues({ net: 0 });
    expect(panel.GetValues()!.islandRemovalMode).toBe('never');
    // The choice made before the net went is what comes back with one.
    panel.SetValues({ net: 1 });
    expect(panel.GetValues()!.islandRemovalMode).toBe('area');
  });

  it('with allowNetSpec false the net is not written or announced', () => {
    const board = new BOARD();
    const z = new ZONE(board);
    z.AppendCorner({ x: 0, y: 0 }, -1);
    z.AppendCorner({ x: 1, y: 0 }, -1);
    z.AppendCorner({ x: 1, y: 1 }, -1);
    z.SetLayer(PCB_LAYER_ID.F_Cu);
    board.Add(z);
    const bag = new ZONE_SETTINGS_BAG(board);
    const net = vi.fn();
    const panel = new PANEL_ZONE_PROPERTIES({ GetBoard: () => board }, bag, false, {
      ZoneNetUpdate: net,
    });
    panel.SetZone(bag.GetClonedZoneList()[0]!);
    panel.SetValues({ net: 1 });
    expect(net).not.toHaveBeenCalled();
    expect(bag.GetZoneSettings(bag.GetClonedZoneList()[0]!)!.m_Netcode).toBe(0);
  });

  it('notifies its subscribers on every change', () => {
    const { panel, clones } = boardWithZones(['a']);
    const seen = vi.fn();
    const off = panel.Subscribe(seen);
    panel.SetZone(clones[0]!);
    panel.SetValues({ locked: true });
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    panel.SetValues({ locked: false });
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
