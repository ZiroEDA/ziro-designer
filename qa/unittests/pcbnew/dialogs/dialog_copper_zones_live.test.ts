// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_COPPER_ZONE + PANEL_ZONE_PROPERTIES on a live ZONE, as
 * PCB_EDIT_FRAME::Edit_Zone_Params drives them (edit_zone_helpers.cpp:41-85).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { DIALOG_COPPER_ZONE } from '@ziroeda/pcbnew/dialogs/panel_zone_properties.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { ZONE } from '@ziroeda/pcbnew/zone.js';
import {
  ISLAND_REMOVAL_MODE,
  ZONE_BORDER_DISPLAY_STYLE,
  ZONE_FILL_MODE,
  ZONE_SETTINGS,
} from '@ziroeda/pcbnew/zone_settings.js';
import { ZONE_CONNECTION } from '@ziroeda/pcbnew/zones.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

let board: BOARD;
let frame: TEST_PCB_FRAME;
const POUR = '30000000-0000-4000-8000-000000000001';
// By uuid: undo swaps the item back in at the end of the list.
const zone = (): ZONE => board.Zones().find((z) => z.m_Uuid === POUR)!;
const dlg = (z = zone()) => new DIALOG_COPPER_ZONE(frame, z);

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (net 0 "")
  (net 1 "GND")
  (net 2 "VCC")
  (zone (net 1) (net_name "GND") (layer "F.Cu") (uuid "30000000-0000-4000-8000-000000000001") (name "pour")
    (hatch edge 0.5)
    (priority 3)
    (connect_pads (clearance 0.3))
    (min_thickness 0.25)
    (fill (thermal_gap 0.5) (thermal_bridge_width 0.5) (island_removal_mode 2) (island_area_min 10))
    (polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10))))
  (zone (net 2) (net_name "VCC") (layer "B.Cu") (uuid "30000000-0000-4000-8000-000000000002") (name "other")
    (hatch edge 0.5)
    (connect_pads (clearance 0.3))
    (min_thickness 0.25)
    (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 20 0) (xy 30 0) (xy 30 10) (xy 20 10)))))`);
  frame = new TEST_PCB_FRAME(board);
});

describe('DIALOG_COPPER_ZONE', () => {
  it('reads the zone over the default zone settings', () => {
    expect(dlg().TransferDataToWindow()).toMatchObject({
      name: 'pour',
      net: 1,
      layers: ['F.Cu'],
      clearance: MM(0.3),
      minThickness: MM(0.25),
      padConnection: 'thermal',
      hatchStyle: 'edge',
      hatchPitch: MM(0.5),
      islandRemovalMode: 'area',
      islandAreaMin: 10,
      fillMode: 'solid',
      priority: 3,
    });
  });

  it('writes back as one undo step', () => {
    const v = dlg().TransferDataToWindow();
    const r = dlg().TransferDataFromWindow({
      ...v,
      name: 'gnd pour',
      net: 2,
      layers: ['F.Cu', 'B.Cu'],
      clearance: MM(0.5),
      padConnection: 'thru_hole_only',
      hatchStyle: 'full',
      hatchPitch: MM(1),
      cornerSmoothing: 'fillet',
      cornerRadius: MM(0.2),
      islandRemovalMode: 'never',
      fillMode: 'hatch',
      hatchThickness: MM(0.3),
      hatchGap: MM(0.4),
      hatchOrientation: 270,
      locked: true,
    });
    expect(r.ok).toBe(true);
    const z = zone();
    expect(z.GetZoneName()).toBe('gnd pour');
    expect(z.GetNetCode()).toBe(2);
    expect(z.GetLayerSet().test(PCB_LAYER_ID.B_Cu)).toBe(true);
    expect(z.GetLocalClearance()).toBe(MM(0.5));
    expect(z.GetPadConnection()).toBe(ZONE_CONNECTION.THT_THERMAL);
    expect(z.GetHatchStyle()).toBe(ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_FULL);
    expect(z.GetBorderHatchPitch()).toBe(MM(1));
    expect(z.GetCornerSmoothingType()).toBe(ZONE_SETTINGS.SMOOTHING_FILLET);
    expect(z.GetCornerRadius()).toBe(MM(0.2));
    expect(z.GetIslandRemovalMode()).toBe(ISLAND_REMOVAL_MODE.NEVER);
    expect(z.GetFillMode()).toBe(ZONE_FILL_MODE.HATCH_PATTERN);
    expect(z.GetHatchThickness()).toBe(MM(0.3));
    // NormalizeAngle180( 270 )
    expect(z.GetHatchOrientation().AsDegrees()).toBe(-90);
    expect(z.IsLocked()).toBe(true);
    expect(z.GetAssignedPriority()).toBe(3);
    expect(frame.GetUndoCommandCount()).toBe(1);
    frame.RestoreCopyFromUndoList();
    expect(zone().GetZoneName()).toBe('pour');
    expect(zone().GetNetCode()).toBe(1);
  });

  it('the settings become the board default, net orphaned', () => {
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), clearance: MM(0.7) });
    const d = board.GetDesignSettings().GetDefaultZoneSettings();
    expect(d.m_ZoneClearance).toBe(MM(0.7));
    expect(d.m_Netcode).toBe(-1);
  });

  it('a name already in use is made unique', () => {
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), name: 'other' });
    expect(zone().GetZoneName()).not.toBe('other');
    expect(zone().GetZoneName()).toMatch(/^other/);
  });

  it('corner radius is zeroed with no smoothing', () => {
    dlg().TransferDataFromWindow({
      ...dlg().TransferDataToWindow(),
      cornerSmoothing: 'none',
      cornerRadius: MM(1),
    });
    expect(zone().GetCornerRadius()).toBe(0);
  });

  it('islands area is mm² in the window, IU² on the zone', () => {
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), islandAreaMin: 2 });
    expect(zone().GetMinIslandArea()).toBe(2 * MM(1) * MM(1));
  });

  it('refuses no layers, before anything else', () => {
    const r = dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), layers: [] });
    expect(r).toEqual({ ok: false, message: 'No layer selected.' });
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('refuses a spoke narrower than the minimum width', () => {
    const r = dlg().TransferDataFromWindow({
      ...dlg().TransferDataToWindow(),
      thermalBridgeWidth: MM(0.2),
    });
    expect(r.ok).toBe(false);
    expect(r.message).toBe('Thermal spoke width cannot be smaller than the minimum width.');
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it.each([
    ['clearance', -1],
    ['clearance', MM(100) + 1],
    ['minThickness', MM(0.025) - 1],
    ['cornerRadius', -1],
    ['hatchPitch', MM(0.1) - 1],
    ['hatchPitch', MM(2) + 1],
  ] as const)('refuses %s = %d', (key, value) => {
    const v = { ...dlg().TransferDataToWindow(), [key]: value };
    expect(dlg().TransferDataFromWindow(v).ok).toBe(false);
  });

  it('checks the hatch against the minimum width only when the zone was already hatched', () => {
    const v = { ...dlg().TransferDataToWindow(), fillMode: 'hatch' as const, hatchGap: MM(0.1) };
    expect(dlg().TransferDataFromWindow({ ...v, hatchThickness: MM(0.3) }).ok).toBe(true);
    // Now hatched: the same gap under the 0.25 mm minimum is refused.
    expect(
      dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), hatchGap: MM(0.1) }).ok,
    ).toBe(false);
  });

  it('replaces the hatch offset overrides', () => {
    dlg().TransferDataFromWindow({
      ...dlg().TransferDataToWindow(),
      layerProperties: { 'F.Cu': { x: MM(1), y: MM(2) } },
    });
    expect(zone().LayerProperties().get(PCB_LAYER_ID.F_Cu)?.hatching_offset).toEqual({
      x: MM(1),
      y: MM(2),
    });
    expect(dlg().TransferDataToWindow().layerProperties).toEqual({
      'F.Cu': { x: MM(1), y: MM(2) },
    });
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), layerProperties: {} });
    expect(zone().LayerProperties().get(PCB_LAYER_ID.F_Cu)?.hatching_offset).toBeUndefined();
  });
});
