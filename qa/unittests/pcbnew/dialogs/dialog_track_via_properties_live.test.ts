// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_TRACK_VIA_PROPERTIES on live PCB_TRACK / PCB_ARC / PCB_VIA items
 * (dialog_track_via_properties.cpp). Every expectation is read off the C++:
 * the folds from TransferDataToWindow (:255-533), the writes from
 * TransferDataFromWindow (:1221-1600), the net change and its two questions
 * from :1602-1677.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { KiDialogRequest } from '@ziroeda/common/kidialog.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  DIALOG_TRACK_VIA_PROPERTIES,
  TRACK_VIA_DO_NOT_SHOW_KEYS,
  type TrackViaValues,
} from '@ziroeda/pcbnew/dialogs/dialog_track_via_properties.js';
import {
  BACKDRILL_MODE,
  PAD_DRILL_POST_MACHINING_MODE,
  PADSTACK,
  UNCONNECTED_LAYER_MODE,
} from '@ziroeda/pcbnew/padstack.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PCB_ARC, PCB_TRACK, PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import { VIATYPE } from '@ziroeda/pcbnew/pcb_track_types.js';
import { IPC4761_PRESET } from '@ziroeda/pcbnew/via_protection_ui_mixin.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);
const L = PADSTACK.ALL_LAYERS;

const U = {
  t1: '10000000-0000-4000-8000-000000000001',
  t2: '10000000-0000-4000-8000-000000000002',
  a1: '10000000-0000-4000-8000-000000000003',
  v1: '10000000-0000-4000-8000-000000000004',
  v2: '10000000-0000-4000-8000-000000000005',
  p1: '20000000-0000-4000-8000-000000000003',
  p2: '20000000-0000-4000-8000-000000000004',
};

let board: BOARD;
let frame: TEST_PCB_FRAME;

const item = <T extends PCB_TRACK>(uuid: string): T =>
  board.Tracks().find((t) => t.m_Uuid === uuid) as T;
const pad = (uuid: string) =>
  board
    .Footprints()[0]!
    .Pads()
    .find((p) => p.m_Uuid === uuid)!;
const dlg = (...uuids: string[]) =>
  new DIALOG_TRACK_VIA_PROPERTIES(
    frame,
    uuids.map((u) => item(u)),
  );

/** Every question asked, answered with `answer`. */
const asker = (answer: 'ok' | 'cancel') => {
  const asked: KiDialogRequest[] = [];
  const ask = (r: KiDialogRequest) => {
    asked.push(r);
    return answer;
  };
  return { asked, ask };
};

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (4 "In1.Cu" signal) (6 "In2.Cu" signal) (2 "B.Cu" signal)
    (1 "F.Mask" user) (3 "B.Mask" user))
  (net 0 "")
  (net 1 "GND")
  (net 2 "VCC")
  (footprint "Lib:J" (layer "F.Cu") (uuid "20000000-0000-4000-8000-000000000001") (at 50 0)
    (property "Reference" "J1" (at 0 0 0) (layer "F.SilkS") (uuid "20000000-0000-4000-8000-000000000002"))
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Mask") (net 1 "GND") (uuid "${U.p1}"))
    (pad "2" smd rect (at 0 3) (size 1 1) (layers "F.Cu" "F.Mask") (net 2 "VCC") (uuid "${U.p2}")))
  (segment (start 0 0) (end 10 0) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U.t1}"))
  (segment (start 10 0) (end 50 0) (width 0.5) (layer "F.Cu") (net 1) (uuid "${U.t2}"))
  (arc (start 0 10) (mid 5 15) (end 10 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "${U.a1}"))
  (via (at 0 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "${U.v1}"))
  (via blind (at 20 20) (size 0.6) (drill 0.3) (layers "F.Cu" "In1.Cu") (net 2) (uuid "${U.v2}")))`);
  board.BuildConnectivity();
  frame = new TEST_PCB_FRAME(board);
});

describe('DIALOG_TRACK_VIA_PROPERTIES::TransferDataToWindow', () => {
  it('seeds from the first track and blanks what the rest disagree on', () => {
    const v = dlg(U.t1, U.t2).TransferDataToWindow();
    expect(v.startX).toBeUndefined();
    expect(v.startY).toBe(0);
    expect(v.endX).toBeUndefined();
    expect(v.trackWidth).toBeUndefined();
    expect(v.layer).toBe('F.Cu');
    expect(v.net).toBe(1);
    expect(v.locked).toBe(false);
    expect(v.hasMask).toBe(false);
  });

  it("an arc's start and end are read like a straight track's (:270-290)", () => {
    const v = dlg(U.a1).TransferDataToWindow();
    expect(v.startX).toBe(0);
    expect(v.startY).toBe(MM(10));
    expect(v.endX).toBe(MM(10));
    expect(v.endY).toBe(MM(10));
  });

  it('a mixed net and mixed lock read as indeterminate', () => {
    item(U.t1).SetLocked(true);
    const v = dlg(U.t1, U.v2).TransferDataToWindow();
    expect(v.net).toBeUndefined();
    expect(v.locked).toBeUndefined();
  });

  it('two tracks with no local mask margin read as INDETERMINATE (:315)', () => {
    expect(dlg(U.t1).TransferDataToWindow().maskMargin).toBeNull();
    expect(dlg(U.t1, U.t2).TransferDataToWindow().maskMargin).toBeUndefined();
    item(U.t1).SetLocalSolderMaskMargin(MM(0.1));
    item(U.t2).SetLocalSolderMaskMargin(MM(0.1));
    expect(dlg(U.t1, U.t2).TransferDataToWindow().maskMargin).toBe(MM(0.1));
  });

  it('folds the vias: type, layers, sizes, and the first via for curved edges', () => {
    item<PCB_VIA>(U.v1).GetTeardropParams().m_CurvedEdges = true;
    item<PCB_VIA>(U.v2).GetTeardropParams().m_CurvedEdges = false;
    const v = dlg(U.v1, U.v2).TransferDataToWindow();
    expect(v.viaType).toBeUndefined();
    expect(v.startLayer).toBe('F.Cu');
    expect(v.endLayer).toBeUndefined();
    expect(v.viaDiameter).toBeUndefined();
    expect(v.viaDrill).toBeUndefined();
    expect(v.tdCurvedEdges).toBe(true);
    // No tracks: the track boxes stay unread.
    expect(v.trackWidth).toBeUndefined();
    expect(v.layer).toBeUndefined();

    const one = dlg(U.v2).TransferDataToWindow();
    expect(one.viaType).toBe('blind');
    expect(one.startLayer).toBe('F.Cu');
    expect(one.endLayer).toBe('In1.Cu');
    expect(one.viaDiameter).toBe(MM(0.6));
    expect(one.viaDrill).toBe(MM(0.3));
    expect(one.viaNotFree).toBe(true);
  });

  it('mixed annular-ring modes select the fourth row, start and end only (:423-429)', () => {
    item<PCB_VIA>(U.v2).Padstack().SetUnconnectedLayerMode(UNCONNECTED_LAYER_MODE.REMOVE_ALL);
    expect(dlg(U.v2).TransferDataToWindow().annularRings).toBe('remove_all');
    expect(dlg(U.v1, U.v2).TransferDataToWindow().annularRings).toBe('start_end_only');
  });

  it('reads the IPC-4761 preset, and leaves a mixed one unset', () => {
    // A pre-20250228 file reads covering, plugging, filling and capping as
    // OFF but tenting as unset (parser :7422-7430): no preset, so CUSTOM.
    expect(dlg(U.v2).TransferDataToWindow().protection).toBeUndefined();
    const tent = (uuid: string, front: boolean, back: boolean) => {
      const ps = item<PCB_VIA>(uuid).Padstack();
      ps.FrontOuterLayers().has_solder_mask = front;
      ps.BackOuterLayers().has_solder_mask = back;
    };
    tent(U.v1, true, false);
    tent(U.v2, false, false);
    expect(dlg(U.v1).TransferDataToWindow().protection).toBe(IPC4761_PRESET.IA);
    expect(dlg(U.v2).TransferDataToWindow().protection).toBe(IPC4761_PRESET.NONE);
    expect(dlg(U.v1, U.v2).TransferDataToWindow().protection).toBeUndefined();
    tent(U.v2, true, false);
    expect(dlg(U.v1, U.v2).TransferDataToWindow().protection).toBe(IPC4761_PRESET.IA);
  });

  it('reads a bottom backdrill, and a plain via as None with empty boxes', () => {
    const plain = dlg(U.v1).TransferDataToWindow();
    expect(plain.backdrill).toBe(BACKDRILL_MODE.NO_BACKDRILL);
    expect(plain.backdrillBackSize).toBeNull();
    expect(plain.backdrillBackLayer).toBeUndefined();
    expect(plain.topPostMachine).toBe('none');

    const ter = item<PCB_VIA>(U.v1).Padstack().TertiaryDrill();
    ter.start = PCB_LAYER_ID.B_Cu;
    ter.end = PCB_LAYER_ID.In2_Cu;
    ter.size = { x: MM(0.5), y: MM(0.5) };
    const v = dlg(U.v1).TransferDataToWindow();
    expect(v.backdrill).toBe(BACKDRILL_MODE.BACKDRILL_BOTTOM);
    expect(v.backdrillBackSize).toBe(MM(0.5));
    expect(v.backdrillBackLayer).toBe('In2.Cu');
    expect(v.backdrillFrontSize).toBeNull();
  });

  it('a countersink with no angle shows 82 degrees (onTopPostMachineChange)', () => {
    const pm = item<PCB_VIA>(U.v1).Padstack().FrontPostMachining();
    pm.mode = PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK;
    pm.size = MM(1);
    const v = dlg(U.v1).TransferDataToWindow();
    expect(v.topPostMachine).toBe('countersink');
    expect(v.topPostMachineSize1).toBe(MM(1));
    expect(v.topPostMachineSize2).toBe(82);
    // The angle is stored in tenths of a degree (:683).
    pm.angle = 900;
    expect(dlg(U.v1).TransferDataToWindow().topPostMachineSize2).toBe(90);
  });
});

describe('DIALOG_TRACK_VIA_PROPERTIES::TransferDataFromWindow', () => {
  it('writes the determinate boxes as one undo step', async () => {
    const d = dlg(U.t1, U.t2);
    const v = d.TransferDataToWindow();
    const r = await d.TransferDataFromWindow({ ...v, trackWidth: MM(0.3), locked: true });
    expect(r.ok).toBe(true);
    expect(item(U.t1).GetWidth()).toBe(MM(0.3));
    expect(item(U.t2).GetWidth()).toBe(MM(0.3));
    expect(item(U.t2).IsLocked()).toBe(true);
    // The mixed start X box was left alone.
    expect(item(U.t2).GetStartX()).toBe(MM(10));
    expect(frame.GetUndoCommandCount()).toBe(1);
    frame.RestoreCopyFromUndoList();
    expect(item(U.t2).GetWidth()).toBe(MM(0.5));
  });

  it("an indeterminate box leaves each item's own value", async () => {
    const d = dlg(U.t1, U.t2);
    await d.TransferDataFromWindow(d.TransferDataToWindow());
    expect(item(U.t1).GetWidth()).toBe(MM(0.25));
    expect(item(U.t2).GetWidth()).toBe(MM(0.5));
  });

  it("moves an arc's end with the End boxes (:1232-1242)", async () => {
    const d = dlg(U.a1);
    await d.TransferDataFromWindow({ ...d.TransferDataToWindow(), endX: MM(12) });
    expect(item<PCB_ARC>(U.a1).GetEnd()).toEqual({ x: MM(12), y: MM(10) });
    expect(item<PCB_ARC>(U.a1).GetMid()).toEqual({ x: MM(5), y: MM(15) });
  });

  it('writes the layer, the solder mask and an empty margin as none', async () => {
    item(U.t1).SetLocalSolderMaskMargin(MM(0.1));
    const d = dlg(U.t1);
    await d.TransferDataFromWindow({
      ...d.TransferDataToWindow(),
      layer: 'B.Cu',
      hasMask: true,
      maskMargin: null,
    });
    expect(item(U.t1).GetLayer()).toBe(PCB_LAYER_ID.B_Cu);
    expect(item(U.t1).HasSolderMask()).toBe(true);
    expect(item(U.t1).GetLocalSolderMaskMargin()).toBeUndefined();
  });

  it('writes the via type, layer pair, size and free flag', async () => {
    const d = dlg(U.v1);
    await d.TransferDataFromWindow({
      ...d.TransferDataToWindow(),
      viaType: 'micro',
      startLayer: 'F.Cu',
      endLayer: 'In1.Cu',
      viaDiameter: MM(0.5),
      viaDrill: MM(0.2),
      viaNotFree: false,
      annularRings: 'remove_all',
    });
    const via = item<PCB_VIA>(U.v1);
    expect(via.GetViaType()).toBe(VIATYPE.MICROVIA);
    expect(via.TopLayer()).toBe(PCB_LAYER_ID.F_Cu);
    expect(via.BottomLayer()).toBe(PCB_LAYER_ID.In1_Cu);
    expect(via.Padstack().Size(L)).toEqual({ x: MM(0.5), y: MM(0.5) });
    expect(via.GetDrillValue()).toBe(MM(0.2));
    expect(via.GetIsFree()).toBe(true);
    expect(via.Padstack().UnconnectedLayerMode()).toBe(UNCONNECTED_LAYER_MODE.REMOVE_ALL);
  });

  it("OK on mixed vias gives them the first via's padstack (:335, :1535)", async () => {
    const d = dlg(U.v1, U.v2);
    await d.TransferDataFromWindow(d.TransferDataToWindow());
    // The drill box was INDETERMINATE and is not written, but the None
    // post-machining row marks the padstack dirty, so v2 takes v1's stack.
    expect(item<PCB_VIA>(U.v2).GetDrillValue()).toBe(MM(0.4));
    expect(item<PCB_VIA>(U.v2).Padstack().Size(L).x).toBe(MM(0.8));
    expect(item<PCB_VIA>(U.v2).Padstack().FrontPostMachining().mode).toBe(
      PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED,
    );
  });

  it('writes a backdrill and a countersink', async () => {
    const d = dlg(U.v1);
    await d.TransferDataFromWindow({
      ...d.TransferDataToWindow(),
      backdrill: BACKDRILL_MODE.BACKDRILL_BOTTOM,
      backdrillBackSize: MM(0.5),
      backdrillBackLayer: 'In2.Cu',
      topPostMachine: 'countersink',
      topPostMachineSize1: MM(1),
      topPostMachineSize2: 90,
    });
    const ps = item<PCB_VIA>(U.v1).Padstack();
    expect(ps.TertiaryDrill().start).toBe(PCB_LAYER_ID.B_Cu);
    expect(ps.TertiaryDrill().end).toBe(PCB_LAYER_ID.In2_Cu);
    expect(ps.TertiaryDrill().size).toEqual({ x: MM(0.5), y: MM(0.5) });
    expect(ps.SecondaryDrill().start).toBe(PCB_LAYER_ID.UNDEFINED_LAYER);
    expect(ps.FrontPostMachining().mode).toBe(PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK);
    expect(ps.FrontPostMachining().size).toBe(MM(1));
    // KiROUND( 90 * 10 ): tenths of a degree, depth untouched.
    expect(ps.FrontPostMachining().angle).toBe(900);
    expect(ps.FrontPostMachining().depth).toBe(0);
  });

  it('applies an IPC-4761 preset, and leaves the flags for an unset one', async () => {
    const d = dlg(U.v1);
    await d.TransferDataFromWindow({
      ...d.TransferDataToWindow(),
      protection: IPC4761_PRESET.IVB,
    });
    const ps = item<PCB_VIA>(U.v1).Padstack();
    expect(ps.FrontOuterLayers().has_solder_mask).toBe(true);
    expect(ps.BackOuterLayers().has_solder_mask).toBe(true);
    expect(ps.FrontOuterLayers().has_plugging).toBe(true);
    expect(ps.BackOuterLayers().has_plugging).toBe(true);
    expect(ps.FrontOuterLayers().has_covering).toBe(false);
    expect(ps.Drill().is_filled).toBe(false);

    const d2 = dlg(U.v1);
    await d2.TransferDataFromWindow({ ...d2.TransferDataToWindow(), protection: undefined });
    expect(ps.FrontOuterLayers().has_plugging).toBe(true);
  });

  it("writes the via's teardrop parameters, percentages as ratios", async () => {
    const d = dlg(U.v1);
    await d.TransferDataFromWindow({
      ...d.TransferDataToWindow(),
      tdEnabled: true,
      tdAllowTwoTracks: false,
      tdCurvedEdges: true,
      tdMaxLen: MM(2),
      tdMaxWidth: MM(3),
      tdBestLengthPct: 40,
      tdBestWidthPct: 80,
      tdFilterPct: 70,
    });
    const td = item<PCB_VIA>(U.v1).GetTeardropParams();
    expect(td.m_Enabled).toBe(true);
    expect(td.m_AllowUseTwoTracks).toBe(false);
    expect(td.m_CurvedEdges).toBe(true);
    expect(td.m_TdMaxLen).toBe(MM(2));
    expect(td.m_TdMaxWidth).toBe(MM(3));
    expect(td.m_BestLengthRatio).toBeCloseTo(0.4, 12);
    expect(td.m_BestWidthRatio).toBeCloseTo(0.8, 12);
    expect(td.m_WidthtoSizeFilterRatio).toBeCloseTo(0.7, 12);
  });

  it('refuses a via hole as big as the via, and a zero track width', async () => {
    const d = dlg(U.v1);
    const r = await d.TransferDataFromWindow({
      ...d.TransferDataToWindow(),
      viaDrill: MM(0.8),
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/diameter/i);
    expect(item<PCB_VIA>(U.v1).GetDrillValue()).toBe(MM(0.4));

    const t = dlg(U.t1);
    const w = await t.TransferDataFromWindow({ ...t.TransferDataToWindow(), trackWidth: 0 });
    expect(w).toEqual({ ok: false, message: 'Track width must be at least 0.001 mm.' });
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('a net change moves the connected tracks and, once asked, the touched pad', async () => {
    const d = dlg(U.t2);
    const { asked, ask } = asker('ok');
    await d.TransferDataFromWindow({ ...d.TransferDataToWindow(), net: 2 }, ask);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      caption: 'Confirmation',
      message: 'Changing the net will also update J1 pad 1 to VCC.',
      labels: { ok: 'Change Nets', cancel: 'Leave Nets Unchanged' },
      doNotShowKey: TRACK_VIA_DO_NOT_SHOW_KEYS.padChange,
    });
    expect(item(U.t2).GetNetCode()).toBe(2);
    // Connected through (10, 0) and (0, 0), not selected.
    expect(item(U.t1).GetNetCode()).toBe(2);
    expect(item(U.v1).GetNetCode()).toBe(2);
    expect(item(U.a1).GetNetCode()).toBe(1);
    expect(pad(U.p1).GetNetCode()).toBe(2);
    expect(frame.GetUndoCommandCount()).toBe(1);
    // The connected, unselected track and the pad are in the same undo step.
    frame.RestoreCopyFromUndoList();
    expect(item(U.t1).GetNetCode()).toBe(1);
    expect(pad(U.p1).GetNetCode()).toBe(1);
  });

  it('touching a pad already on the new net is not a short (:1636-1637)', async () => {
    const d = dlg(U.t2);
    const { asked, ask } = asker('ok');
    await d.TransferDataFromWindow(
      { ...d.TransferDataToWindow(), net: 2, trackWidth: MM(5.2) },
      ask,
    );
    expect(asked.map((r) => r.doNotShowKey)).toEqual([TRACK_VIA_DO_NOT_SHOW_KEYS.padChange]);
    expect(item(U.t2).GetNetCode()).toBe(2);
  });

  it('"Leave Nets Unchanged" keeps every net but still applies the rest', async () => {
    const d = dlg(U.t2);
    const { ask } = asker('cancel');
    await d.TransferDataFromWindow(
      { ...d.TransferDataToWindow(), net: 2, trackWidth: MM(0.3) },
      ask,
    );
    expect(item(U.t2).GetNetCode()).toBe(1);
    expect(item(U.t1).GetNetCode()).toBe(1);
    expect(pad(U.p1).GetNetCode()).toBe(1);
    expect(item(U.t2).GetWidth()).toBe(MM(0.3));
  });

  it('a short with another net asks, and "Cancel Changes" reverts everything', async () => {
    const d = dlg(U.t2);
    const { asked, ask } = asker('cancel');
    // 5.2 mm wide reaches pad 2 (VCC), 2.5 mm off the track's end.
    const r = await d.TransferDataFromWindow(
      { ...d.TransferDataToWindow(), trackWidth: MM(5.2) },
      ask,
    );
    expect(r.ok).toBe(true);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      message: 'Applying these changes will short net GND with VCC.',
      labels: { ok: 'Apply Anyway', cancel: 'Cancel Changes' },
      doNotShowKey: TRACK_VIA_DO_NOT_SHOW_KEYS.shortingNets,
    });
    expect(item(U.t2).GetWidth()).toBe(MM(0.5));
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('"Apply Anyway" keeps the short', async () => {
    const d = dlg(U.t2);
    const { ask } = asker('ok');
    await d.TransferDataFromWindow({ ...d.TransferDataToWindow(), trackWidth: MM(5.2) }, ask);
    expect(item(U.t2).GetWidth()).toBe(MM(5.2));
    expect(pad(U.p2).GetNetCode()).toBe(2);
  });

  it('an indeterminate net changes no net, even with pads touching', async () => {
    const d = dlg(U.t2, U.v2);
    const { asked, ask } = asker('ok');
    const v: TrackViaValues = d.TransferDataToWindow();
    expect(v.net).toBeUndefined();
    await d.TransferDataFromWindow(v, ask);
    expect(asked).toHaveLength(0);
    expect(item(U.t2).GetNetCode()).toBe(1);
    expect(item(U.v2).GetNetCode()).toBe(2);
  });
});
