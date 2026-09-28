// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_NON_COPPER_ZONES_EDITOR on a live ZONE, as
 * PCB_EDIT_FRAME::Edit_Zone_Params drives it (edit_zone_helpers.cpp:41-85).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  DIALOG_NON_COPPER_ZONES_EDITOR,
  NO_LAYER_SELECTED,
} from '@ziroeda/pcbnew/dialogs/dialog_non_copper_zones_properties.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { ZONE } from '@ziroeda/pcbnew/zone.js';
import {
  ZONE_BORDER_DISPLAY_STYLE,
  ZONE_FILL_MODE,
  ZONE_SETTINGS,
} from '@ziroeda/pcbnew/zone_settings.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);
const Z = '60000000-0000-4000-8000-000000000001';

let board: BOARD;
let frame: TEST_PCB_FRAME;
// By uuid: undo swaps the item back in at the end of the list.
const zone = (): ZONE => board.Zones().find((z) => z.m_Uuid === Z)!;
const dlg = () => new DIALOG_NON_COPPER_ZONES_EDITOR(frame, zone());

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (7 "B.SilkS" user "B.Silkscreen"))
  (net 0 "")
  (zone (net 0) (net_name "") (layer "F.SilkS") (uuid "${Z}")
    (hatch edge 0.5)
    (connect_pads (clearance 0))
    (min_thickness 0.3)
    (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10)))))`);
  frame = new TEST_PCB_FRAME(board);
});

describe('DIALOG_NON_COPPER_ZONES_EDITOR', () => {
  it('reads the zone; an unset hatch gets a plausible width and gap', () => {
    // A parsed zone starts from ZONE_SETTINGS' own defaults (zone_settings.cpp:53-57);
    // zero them to reach the dialog's invented pair.
    zone().SetHatchThickness(0);
    zone().SetHatchGap(0);
    expect(dlg().TransferDataToWindow()).toEqual({
      layers: ['F.SilkS'],
      locked: false,
      hatchStyle: 'edge',
      hatchPitch: MM(0.5),
      cornerSmoothing: 'none',
      cornerRadius: 0,
      minThickness: MM(0.3),
      fillMode: 'solid',
      // max( 0.3 * 4, 1.0 ) and max( 0.3 * 6, 1.5 ) mm (:236-248).
      hatchThickness: MM(1.2),
      hatchGap: MM(1.8),
      hatchOrientation: 0,
      hatchSmoothingLevel: 0,
      hatchSmoothingValue: 0.1,
    });
  });

  it('floors the invented width at 1 mm and gap at 1.5 mm', () => {
    zone().SetMinThickness(MM(0.1));
    zone().SetHatchThickness(0);
    zone().SetHatchGap(0);
    expect(dlg().TransferDataToWindow()).toMatchObject({
      hatchThickness: MM(1),
      hatchGap: MM(1.5),
    });
  });

  it('raises a stored hatch narrower than the minimum width', () => {
    zone().SetHatchThickness(MM(0.2));
    zone().SetHatchGap(MM(0.25));
    expect(dlg().TransferDataToWindow()).toMatchObject({
      hatchThickness: MM(0.3),
      hatchGap: MM(0.3),
    });
  });

  it('writes back as one undo step', () => {
    const r = dlg().TransferDataFromWindow({
      ...dlg().TransferDataToWindow(),
      layers: ['F.SilkS', 'B.SilkS'],
      locked: true,
      hatchStyle: 'full',
      hatchPitch: MM(1),
      cornerSmoothing: 'chamfer',
      cornerRadius: MM(0.4),
      minThickness: MM(0.2),
      fillMode: 'hatch',
      hatchThickness: MM(0.5),
      hatchGap: MM(0.6),
      hatchOrientation: 270,
      hatchSmoothingLevel: 2,
      hatchSmoothingValue: 0.5,
    });
    expect(r.ok).toBe(true);
    const z = zone();
    expect(z.GetLayerSet().test(PCB_LAYER_ID.B_SilkS)).toBe(true);
    expect(z.IsLocked()).toBe(true);
    expect(z.GetHatchStyle()).toBe(ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_FULL);
    expect(z.GetBorderHatchPitch()).toBe(MM(1));
    expect(z.GetCornerSmoothingType()).toBe(ZONE_SETTINGS.SMOOTHING_CHAMFER);
    expect(z.GetCornerRadius()).toBe(MM(0.4));
    expect(z.GetMinThickness()).toBe(MM(0.2));
    expect(z.GetFillMode()).toBe(ZONE_FILL_MODE.HATCH_PATTERN);
    expect(z.GetHatchThickness()).toBe(MM(0.5));
    expect(z.GetHatchGap()).toBe(MM(0.6));
    // Not normalised here, unlike the copper panel (:356).
    expect(z.GetHatchOrientation().AsDegrees()).toBe(270);
    expect(z.GetHatchSmoothingLevel()).toBe(2);
    expect(z.GetHatchSmoothingValue()).toBe(0.5);
    expect(frame.GetUndoCommandCount()).toBe(1);
    frame.RestoreCopyFromUndoList();
    expect(zone().GetMinThickness()).toBe(MM(0.3));
  });

  it('zeroes the corner radius with no smoothing', () => {
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), cornerRadius: MM(1) });
    expect(zone().GetCornerRadius()).toBe(0);
  });

  it('keeps the hatch numbers on a solid zone', () => {
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), hatchGap: MM(2) });
    expect(zone().GetFillMode()).toBe(ZONE_FILL_MODE.POLYGONS);
    expect(zone().GetHatchGap()).toBe(MM(2));
  });

  it('checks the hatch against the window minimum width only when hatched', () => {
    const v = { ...dlg().TransferDataToWindow(), hatchThickness: MM(0.1), hatchGap: MM(0.1) };
    expect(dlg().TransferDataFromWindow(v).ok).toBe(true);
    expect(dlg().TransferDataFromWindow({ ...v, fillMode: 'hatch' }).ok).toBe(false);
    expect(
      dlg().TransferDataFromWindow({ ...v, fillMode: 'hatch', hatchThickness: MM(0.3) }).ok,
    ).toBe(false);
    expect(dlg().TransferDataFromWindow({ ...v, fillMode: 'hatch', hatchGap: MM(0.3) }).ok).toBe(
      false,
    );
    expect(frame.GetUndoCommandCount()).toBe(1);
  });

  it.each([MM(0.1) - 1, MM(2) + 1])('refuses a border hatch pitch of %d', (pitch) => {
    expect(
      dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), hatchPitch: pitch }).ok,
    ).toBe(false);
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('refuses no layers', () => {
    expect(dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), layers: [] })).toEqual({
      ok: false,
      message: NO_LAYER_SELECTED,
    });
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('the settings become the board default zone settings', () => {
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), hatchPitch: MM(1.5) });
    expect(board.GetDesignSettings().GetDefaultZoneSettings().m_BorderHatchPitch).toBe(MM(1.5));
  });
});
