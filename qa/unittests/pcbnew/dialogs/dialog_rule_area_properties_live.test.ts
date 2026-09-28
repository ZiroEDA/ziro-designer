// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_RULE_AREA_PROPERTIES on a live rule-area ZONE, as
 * PCB_EDIT_FRAME::Edit_Zone_Params drives it (edit_zone_helpers.cpp:41-85).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  DIALOG_RULE_AREA_PROPERTIES,
  NO_LAYERS_SELECTED,
} from '@ziroeda/pcbnew/dialogs/dialog_rule_area_properties.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { ZONE } from '@ziroeda/pcbnew/zone.js';
import { PLACEMENT_SOURCE_T, ZONE_BORDER_DISPLAY_STYLE } from '@ziroeda/pcbnew/zone_settings.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);
const AREA = '40000000-0000-4000-8000-000000000001';

let board: BOARD;
let frame: TEST_PCB_FRAME;
// By uuid: undo swaps the item back in at the end of the list.
const area = (): ZONE => board.Zones().find((z) => z.m_Uuid === AREA)!;
const dlg = () => new DIALOG_RULE_AREA_PROPERTIES(frame, area());

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (net 0 "")
  (zone (net 0) (net_name "") (layer "F.Cu") (uuid "${AREA}") (name "keep")
    (hatch full 0.5)
    (connect_pads (clearance 0))
    (min_thickness 0.25)
    (keepout (tracks not_allowed) (vias allowed) (pads allowed) (copperpour not_allowed) (footprints allowed))
    (placement (enabled yes) (sheetname "/power/"))
    (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10))))
  (zone (net 0) (net_name "") (layer "F.Cu") (uuid "40000000-0000-4000-8000-000000000002") (name "other")
    (hatch edge 0.5)
    (connect_pads (clearance 0))
    (min_thickness 0.25)
    (keepout (tracks not_allowed) (vias allowed) (pads allowed) (copperpour allowed) (footprints allowed))
    (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 20 0) (xy 30 0) (xy 30 10) (xy 20 10)))))`);
  frame = new TEST_PCB_FRAME(board);
});

describe('DIALOG_RULE_AREA_PROPERTIES', () => {
  it('reads the rule area', () => {
    expect(dlg().TransferDataToWindow()).toEqual({
      doNotAllowTracks: true,
      doNotAllowVias: false,
      doNotAllowPads: false,
      doNotAllowCopperPour: true,
      doNotAllowFootprints: false,
      placementEnabled: true,
      placementSourceType: 'sheetname',
      placementSource: '/power/',
      name: 'keep',
      locked: false,
      layers: ['F.Cu'],
      hatchStyle: 'full',
      hatchPitch: MM(0.5),
    });
  });

  it('writes back as one undo step', () => {
    const r = dlg().TransferDataFromWindow({
      ...dlg().TransferDataToWindow(),
      doNotAllowTracks: false,
      doNotAllowVias: true,
      doNotAllowPads: true,
      doNotAllowCopperPour: false,
      doNotAllowFootprints: true,
      placementEnabled: true,
      placementSourceType: 'group',
      placementSource: 'G1',
      layers: ['F.Cu', 'B.Cu'],
      hatchStyle: 'edge',
      hatchPitch: MM(1),
      locked: true,
    });
    expect(r.ok).toBe(true);
    const z = area();
    expect(z.GetIsRuleArea()).toBe(true);
    expect(z.GetDoNotAllowTracks()).toBe(false);
    expect(z.GetDoNotAllowVias()).toBe(true);
    expect(z.GetDoNotAllowPads()).toBe(true);
    expect(z.GetDoNotAllowZoneFills()).toBe(false);
    expect(z.GetDoNotAllowFootprints()).toBe(true);
    expect(z.GetPlacementAreaSourceType()).toBe(PLACEMENT_SOURCE_T.GROUP_PLACEMENT);
    expect(z.GetPlacementAreaSource()).toBe('G1');
    expect(z.GetLayerSet().test(PCB_LAYER_ID.B_Cu)).toBe(true);
    expect(z.GetHatchStyle()).toBe(ZONE_BORDER_DISPLAY_STYLE.DIAGONAL_EDGE);
    expect(z.GetBorderHatchPitch()).toBe(MM(1));
    expect(z.IsLocked()).toBe(true);
    expect(frame.GetUndoCommandCount()).toBe(1);
    frame.RestoreCopyFromUndoList();
    expect(area().GetDoNotAllowTracks()).toBe(true);
  });

  it('pushes an undo step even when nothing changed', () => {
    dlg().TransferDataFromWindow(dlg().TransferDataToWindow());
    expect(frame.GetUndoCommandCount()).toBe(1);
  });

  it('zeroes the priority', () => {
    area().SetAssignedPriority(4);
    dlg().TransferDataFromWindow(dlg().TransferDataToWindow());
    expect(area().GetAssignedPriority()).toBe(0);
  });

  it('makes a changed name unique, and leaves an unchanged one alone', () => {
    area().SetZoneName('other');
    dlg().TransferDataFromWindow(dlg().TransferDataToWindow());
    // Unchanged: still colliding (issue 23131).
    expect(area().GetZoneName()).toBe('other');
    area().SetZoneName('keep');
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), name: 'other' });
    expect(area().GetZoneName()).toBe('other_1');
  });

  it('refuses no layers', () => {
    const r = dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), layers: [] });
    expect(r).toEqual({ ok: false, message: NO_LAYERS_SELECTED });
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it.each([MM(0.1) - 1, MM(2) + 1])('refuses a hatch pitch of %d', (pitch) => {
    const r = dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), hatchPitch: pitch });
    expect(r.ok).toBe(false);
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('the settings become the board default zone settings', () => {
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), hatchPitch: MM(1.5) });
    const d = board.GetDesignSettings().GetDefaultZoneSettings();
    expect(d.m_BorderHatchPitch).toBe(MM(1.5));
    expect(d.GetIsRuleArea()).toBe(true);
    expect(d.m_Netcode).toBe(-1);
  });
});
