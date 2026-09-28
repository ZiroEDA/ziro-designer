// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_PAD_PROPERTIES on a live PAD (dialog_pad_properties.cpp).
 *
 * Every expectation is derived from the C++, not from a run: positions from
 * the footprint transform (KiCad's RotatePoint turns (1, 0) by 90 degrees to
 * (0, -1)), the layer sets from transferDataToPad's switch (:2171-2263).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { DIALOG_PAD_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_pad_properties.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import {
  PAD_ATTRIB,
  PAD_SHAPE,
  PADSTACK,
  UNCONNECTED_LAYER_MODE,
} from '@ziroeda/pcbnew/padstack.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { ZONE_CONNECTION } from '@ziroeda/pcbnew/zones.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);
const L = PADSTACK.ALL_LAYERS;

let board: BOARD;
let frame: TEST_PCB_FRAME;
const pad = (fp = 0, i = 0): PAD => board.Footprints()[fp]!.Pads()[i]!;
// By uuid after an undo: the restored copy may come back at another index.
const padByUuid = (uuid: string): PAD =>
  board
    .Footprints()[0]!
    .Pads()
    .find((p) => p.m_Uuid === uuid)!;
const dlg = (p = pad()) => new DIALOG_PAD_PROPERTIES(frame, p);

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (1 "F.Mask" user) (3 "B.Mask" user)
    (13 "F.Paste" user) (15 "B.Paste" user))
  (net 0 "")
  (net 1 "GND")
  (net 2 "VCC")
  (footprint "Lib:J" (layer "F.Cu") (uuid "20000000-0000-4000-8000-000000000001") (at 10 20 90)
    (property "Reference" "J1" (at 0 0 0) (layer "F.SilkS") (uuid "20000000-0000-4000-8000-000000000002"))
    (pad "1" thru_hole rect (at 1 0 90) (size 2 1.2) (drill 0.8) (layers "*.Cu" "*.Mask")
      (net 1 "GND") (uuid "20000000-0000-4000-8000-000000000003"))
    (pad "2" smd trapezoid (at 3 0 90) (size 2 1.2) (rect_delta 0.2 0.3) (layers "F.Cu" "F.Mask")
      (uuid "20000000-0000-4000-8000-000000000004")))
  (footprint "Lib:R" (layer "B.Cu") (uuid "20000000-0000-4000-8000-000000000011") (at 30 40 0)
    (property "Reference" "R1" (at 0 0 0) (layer "B.SilkS") (uuid "20000000-0000-4000-8000-000000000012"))
    (pad "1" smd rect (at 1 2 90) (size 1 1.5) (layers "B.Cu" "B.Mask" "B.Paste")
      (uuid "20000000-0000-4000-8000-000000000013"))))`);
  frame = new TEST_PCB_FRAME(board);
});

describe('DIALOG_PAD_PROPERTIES', () => {
  it('reads the pad: absolute position, footprint-relative orientation', () => {
    expect(dlg().TransferDataToWindow()).toMatchObject({
      number: '1',
      net: 1,
      type: 'thru_hole',
      shape: 'rect',
      // (1, 0) turned 90 degrees is (0, -1), about the anchor (10, 20).
      x: MM(10),
      y: MM(19),
      // The file's pad angle is board-absolute: 90 against the footprint's 90.
      orientation: 0,
      sizeX: MM(2),
      sizeY: MM(1.2),
      // A rect has no meaningful rounding, so the constructor zeroes it (:202-207).
      roundrectRatio: 0,
      holeW: MM(0.8),
      holeH: MM(0.8),
      holeOblong: false,
      layers: ['*.Cu', '*.Mask'],
      unconnectedLayerMode: 'keep_all',
      zoneConnection: 'inherited',
      padToDieLength: null,
    });
  });

  it('writes back as one undo step, orientation footprint-relative', () => {
    const v = dlg().TransferDataToWindow();
    const r = dlg().TransferDataFromWindow({
      ...v,
      number: '7',
      net: 2,
      x: MM(12),
      y: MM(19),
      orientation: 45,
      sizeX: MM(2.5),
      localClearance: MM(0.1),
      zoneConnection: 'none',
      padToDieLength: MM(0.3),
    });
    expect(r.ok).toBe(true);
    const p = pad();
    expect(p.GetNumber()).toBe('7');
    expect(p.GetNetCode()).toBe(2);
    expect(p.GetPosition()).toEqual({ x: MM(12), y: MM(19) });
    // SetFPRelativeOrientation( 45 ) on a footprint at 90.
    expect(p.GetOrientation().AsDegrees()).toBe(135);
    expect(p.GetSize(L)).toEqual({ x: MM(2.5), y: MM(1.2) });
    expect(p.GetLocalClearance()).toBe(MM(0.1));
    expect(p.GetLocalZoneConnection()).toBe(ZONE_CONNECTION.NONE);
    expect(p.GetPadToDieLength()).toBe(MM(0.3));
    expect(frame.GetUndoCommandCount()).toBe(1);
    frame.RestoreCopyFromUndoList();
    const restored = padByUuid('20000000-0000-4000-8000-000000000003');
    expect(restored.GetNumber()).toBe('1');
    expect(restored.GetOrientation().AsDegrees()).toBe(90);
  });

  it('writes the design settings master pad, without a net', () => {
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, number: '9', sizeX: MM(3) });
    const master = board.GetDesignSettings().m_Pad_Master;
    expect(master.GetNumber()).toBe('9');
    expect(master.GetSize(L).x).toBe(MM(3));
    expect(master.GetNetCode()).toBe(0);
    expect(master.GetAttribute()).toBe(PAD_ATTRIB.PTH);
  });

  it('an NPTH pad loses its number and net', () => {
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, type: 'np_thru_hole' });
    expect(pad().GetAttribute()).toBe(PAD_ATTRIB.NPTH);
    expect(pad().GetNumber()).toBe('');
    expect(pad().GetNetCode()).toBe(0);
  });

  it('an SMD pad loses its hole', () => {
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, type: 'smd', layers: ['F.Cu', 'F.Mask'] });
    expect(pad().GetAttribute()).toBe(PAD_ATTRIB.SMD);
    expect(pad().GetDrillSize()).toEqual({ x: 0, y: 0 });
    expect(
      pad()
        .GetLayerSet()
        .equals(new LSET([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.F_Mask])),
    ).toBe(true);
  });

  it('a PTH pad with any copper gets all copper, in the radio row its mode names', () => {
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({
      ...v,
      layers: ['F.Cu', 'F.Mask'],
      unconnectedLayerMode: 'remove_except_start_and_end',
    });
    const set = pad().GetLayerSet();
    expect(set.and(LSET.AllCuMask()).equals(LSET.AllCuMask())).toBe(true);
    expect(set.test(PCB_LAYER_ID.F_Mask)).toBe(true);
    expect(set.test(PCB_LAYER_ID.B_Mask)).toBe(false);
    expect(pad().GetUnconnectedLayerMode()).toBe(
      UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END,
    );
  });

  it('a PTH pad with no copper keeps none, and the mode resets', () => {
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, layers: ['F.Mask'], unconnectedLayerMode: 'remove_all' });
    expect(pad().GetLayerSet().and(LSET.AllCuMask()).none()).toBe(true);
    expect(pad().GetUnconnectedLayerMode()).toBe(UNCONNECTED_LAYER_MODE.KEEP_ALL);
  });

  it('refuses a through-hole pad with no hole (padValuesOK)', () => {
    const v = dlg().TransferDataToWindow();
    const r = dlg().TransferDataFromWindow({ ...v, holeW: 0, number: '5' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Error: Through hole pad has no hole.');
    expect(pad().GetNumber()).toBe('1');
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('refuses a negative spoke width', () => {
    const v = dlg().TransferDataToWindow();
    expect(dlg().TransferDataFromWindow({ ...v, thermalBridgeWidth: -1 }).ok).toBe(false);
  });

  it('clamps a trapezoid delta to the pad size (:2012-2034)', () => {
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, shape: 'trapezoid', deltaX: MM(5), deltaY: 0 });
    expect(pad().GetShape(L)).toBe(PAD_SHAPE.TRAPEZOID);
    // delta.x > size.y becomes size.y - 2.
    expect(pad().GetDelta(L)).toEqual({ x: MM(1.2) - 2, y: 0 });
    dlg().TransferDataFromWindow({
      ...dlg().TransferDataToWindow(),
      deltaX: 0,
      deltaY: -MM(5),
    });
    expect(pad().GetDelta(L)).toEqual({ x: 0, y: -MM(2) + 2 });
  });

  it('shows one trapezoid axis: X when it is set (:898-908)', () => {
    expect(dlg(pad(0, 1)).TransferDataToWindow()).toMatchObject({
      shape: 'trapezoid',
      deltaX: MM(0.2),
      deltaY: 0,
    });
  });

  it('a pad newly made round-rect with no ratio takes the IPC one (:1062-1068)', () => {
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, shape: 'roundrect' });
    expect(pad().GetShape(L)).toBe(PAD_SHAPE.ROUNDRECT);
    // min( 0.25 mm, 1.2 mm * 0.25 ) / 1.2 mm
    expect(pad().GetRoundRectRadiusRatio(L)).toBeCloseTo(0.25 / 1.2, 12);
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), roundrectRatio: 0.4 });
    expect(pad().GetRoundRectRadiusRatio(L)).toBe(0.4);
  });

  it('swaps a default spoke angle when the shape moves to or from a circle', () => {
    expect(pad().GetThermalSpokeAngle().AsDegrees()).toBe(90);
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), shape: 'circle' });
    expect(pad().GetThermalSpokeAngle().AsDegrees()).toBe(45);
    // A circle takes its size from the X box alone (:2000-2003).
    expect(pad().GetSize(L)).toEqual({ x: MM(2), y: MM(2) });
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), shape: 'oval' });
    expect(pad().GetThermalSpokeAngle().AsDegrees()).toBe(90);
  });

  it('a flipped footprint shows its pad front-side and writes it back to the back', () => {
    const p = pad(1);
    const v = dlg(p).TransferDataToWindow();
    expect(v.layers).toEqual(['F.Cu', 'F.Mask', 'F.Paste']);
    expect(v.x).toBe(p.GetPosition().x);
    expect(v.y).toBe(p.GetPosition().y);
    dlg(p).TransferDataFromWindow(v);
    expect(
      p
        .GetLayerSet()
        .equals(new LSET([PCB_LAYER_ID.B_Cu, PCB_LAYER_ID.B_Mask, PCB_LAYER_ID.B_Paste])),
    ).toBe(true);
    expect(p.GetPosition()).toEqual({ x: v.x, y: v.y });
  });

  it('KiCad 10.0.5: OK on a flipped footprint pad negates its relative orientation', () => {
    // initValues shows GetFPRelativeOrientation() unflipped (:670), while OK
    // writes it and then flips the pad (:1740, :1765), which negates it. The
    // C++ decides, so a no-change OK turns a relative 90 into -90 (270).
    const p = pad(1);
    const rel = p.GetFPRelativeOrientation().AsDegrees();
    expect(rel).not.toBe(0);
    dlg(p).TransferDataFromWindow(dlg(p).TransferDataToWindow());
    expect(p.GetFPRelativeOrientation().AsDegrees()).toBe((360 - rel) % 360);
  });
});
