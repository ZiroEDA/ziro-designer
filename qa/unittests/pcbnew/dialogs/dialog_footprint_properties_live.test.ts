// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_FOOTPRINT_PROPERTIES on a live FOOTPRINT (dialog_footprint_properties.cpp).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { DIALOG_FOOTPRINT_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_footprint_properties.js';
import { FP_DNP, FP_SMD, FP_THROUGH_HOLE } from '@ziroeda/pcbnew/footprint.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { ZONE_CONNECTION } from '@ziroeda/pcbnew/zones.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

let board: BOARD;
let frame: TEST_PCB_FRAME;
const fp = () => board.Footprints()[0]!;
const dlg = () => new DIALOG_FOOTPRINT_PROPERTIES(frame, fp());

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (7 "B.SilkS" user "B.Silkscreen"))
  (net 0 "")
  (footprint "Lib:R_0805" (layer "F.Cu") (uuid "10000000-0000-4000-8000-000000000001") (at 10 20 90)
    (attr smd exclude_from_bom dnp)
    (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS") (uuid "10000000-0000-4000-8000-000000000002"))
    (property "Value" "10k" (at 0 1 0) (layer "F.SilkS") (uuid "10000000-0000-4000-8000-000000000003"))
    (pad "1" smd rect (at -1 0) (size 1 1.2) (layers "F.Cu") (uuid "10000000-0000-4000-8000-000000000004"))))`);
  frame = new TEST_PCB_FRAME(board);
});

describe('DIALOG_FOOTPRINT_PROPERTIES', () => {
  it('reads the footprint', () => {
    expect(dlg().TransferDataToWindow()).toMatchObject({
      reference: 'R1',
      value: '10k',
      x: MM(10),
      y: MM(20),
      orientation: 90,
      side: 'front',
      footprintType: 'smd',
      doNotPopulate: true,
      excludeFromBom: true,
      excludeFromPosFiles: false,
      localClearance: null,
      zoneConnection: 'inherited',
    });
  });

  it('writes back as one undo step', () => {
    const v = dlg().TransferDataToWindow();
    expect(
      dlg().TransferDataFromWindow({
        ...v,
        reference: 'R7',
        value: '22k',
        x: MM(15),
        footprintType: 'through_hole',
        doNotPopulate: false,
        localClearance: MM(0.2),
        zoneConnection: 'full',
      }),
    ).toEqual({ ok: true });
    const f = fp();
    expect(f.GetReference()).toBe('R7');
    expect(f.GetValue()).toBe('22k');
    expect(f.GetPosition()).toEqual({ x: MM(15), y: MM(20) });
    expect(f.GetAttributes() & FP_THROUGH_HOLE).toBeTruthy();
    expect(f.GetAttributes() & FP_SMD).toBe(0);
    expect(f.GetAttributes() & FP_DNP).toBe(0);
    expect(f.GetLocalClearance()).toBe(MM(0.2));
    expect(f.GetLocalZoneConnection()).toBe(ZONE_CONNECTION.FULL);
    expect(frame.GetUndoCommandCount()).toBe(1);
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), doNotPopulate: true });
    expect(fp().GetAttributes() & FP_DNP).toBeTruthy();
    frame.RestoreCopyFromUndoList();
    frame.RestoreCopyFromUndoList();
    expect(fp().GetReference()).toBe('R1');
    expect(fp().GetPosition()).toEqual({ x: MM(10), y: MM(20) });
  });

  it('rotates about the anchor, carrying the pads', () => {
    const v = dlg().TransferDataToWindow();
    const padBefore = fp().Pads()[0]!.GetPosition();
    dlg().TransferDataFromWindow({ ...v, orientation: 0 });
    expect(fp().GetOrientation().AsDegrees()).toBe(0);
    expect(fp().GetPosition()).toEqual({ x: MM(10), y: MM(20) });
    expect(fp().Pads()[0]!.GetPosition()).not.toEqual(padBefore);
  });

  it('flips to the back in the frame’s flip direction', () => {
    frame.settings.m_FlipDirection = FLIP_DIRECTION.LEFT_RIGHT;
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, side: 'back' });
    expect(fp().GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
    expect(fp().Pads()[0]!.IsOnLayer(PCB_LAYER_ID.B_Cu)).toBe(true);
  });

  it('refuses a negative clearance override, changing nothing', () => {
    const v = dlg().TransferDataToWindow();
    expect(dlg().TransferDataFromWindow({ ...v, localClearance: -1 }).ok).toBe(false);
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('writes DNP and the exclusions to the current variant, keeping the base flags', () => {
    board.AddVariant('Lite');
    board.SetCurrentVariant('Lite');
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, doNotPopulate: false, excludeFromPosFiles: true });
    expect(fp().GetDNPForVariant('Lite')).toBe(false);
    expect(fp().GetExcludedFromPosFilesForVariant('Lite')).toBe(true);
    // The base attribute keeps DNP.
    expect(fp().GetAttributes() & FP_DNP).toBeTruthy();
  });

  it('leaves the courtyard exemption alone: it is not this dialog’s', () => {
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, allowMissingCourtyard: true });
    expect(fp().AllowMissingCourtyard()).toBe(false);
  });
});
