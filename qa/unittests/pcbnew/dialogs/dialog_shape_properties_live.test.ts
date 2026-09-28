// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_SHAPE_PROPERTIES on a live PCB_SHAPE (dialog_shape_properties.cpp).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SHAPE_T, UI_FILL_MODE } from '@ziroeda/common/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LINE_STYLE } from '@ziroeda/common/stroke_params.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { DIALOG_SHAPE_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_shape_properties.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

let board: BOARD;
let frame: TEST_PCB_FRAME;
const shape = (i: number) => board.Drawings()[i] as PCB_SHAPE;
const dlg = (i: number) => new DIALOG_SHAPE_PROPERTIES(frame, shape(i));

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (1 "F.Mask" user))
  (net 0 "")
  (net 1 "GND")
  (gr_rect (start 0 0) (end 10 6) (stroke (width 0.2) (type dash)) (fill no) (layer "F.SilkS")
    (uuid "00000000-0000-4000-8000-000000000001"))
  (gr_line (start 0 10) (end 10 10) (stroke (width 0.2) (type solid)) (layer "F.Cu") (net 1)
    (uuid "00000000-0000-4000-8000-000000000002"))
  (gr_circle (center 20 20) (end 22 20) (stroke (width 0.1) (type solid)) (fill no) (layer "F.SilkS")
    (uuid "00000000-0000-4000-8000-000000000003"))
)`);
  frame = new TEST_PCB_FRAME(board);
});

describe('DIALOG_SHAPE_PROPERTIES', () => {
  it('reads a rectangle', () => {
    expect(dlg(0).TransferDataToWindow()).toMatchObject({
      kind: 'rect',
      start: { x: 0, y: 0 },
      end: { x: MM(10), y: MM(6) },
      lineWidth: MM(0.2),
      strokeType: 'dash',
      fillMode: 'none',
      layer: 'F.SilkS',
      cornerRadius: 0,
      hasMask: false,
      maskMargin: null,
    });
  });

  it('writes a rectangle back as one undo step', () => {
    const v = dlg(0).TransferDataToWindow();
    expect(
      dlg(0).TransferDataFromWindow({
        ...v,
        end: { x: MM(20), y: MM(8) },
        cornerRadius: MM(1),
        fillMode: 'solid',
        strokeType: 'dot',
        lineWidth: MM(0.3),
      }),
    ).toEqual({ ok: true });
    const s = shape(0);
    expect(s.GetEnd()).toEqual({ x: MM(20), y: MM(8) });
    expect(s.GetCornerRadius()).toBe(MM(1));
    expect(s.GetFillModeProp()).toBe(UI_FILL_MODE.SOLID);
    expect(s.GetLineStyle()).toBe(LINE_STYLE.DOT);
    expect(s.GetWidth()).toBe(MM(0.3));
    expect(frame.GetUndoCommandCount()).toBe(1);
    frame.RestoreCopyFromUndoList();
    expect(shape(0).GetEnd()).toEqual({ x: MM(10), y: MM(6) });
  });

  it('refuses what Validate() refuses, changing nothing', () => {
    const v = dlg(0).TransferDataToWindow();
    const zero = dlg(0).TransferDataFromWindow({ ...v, end: v.start });
    expect(zero).toEqual({ ok: false, message: 'Rectangle cannot be zero-sized.' });
    const radius = dlg(0).TransferDataFromWindow({ ...v, cornerRadius: MM(4) });
    expect(radius.message).toMatch(/Corner radius/);
    const width = dlg(0).TransferDataFromWindow({ ...v, lineWidth: 0 });
    expect(width.message).toMatch(/unfilled rectangle/);
    // A filled rectangle may have no outline.
    expect(dlg(0).TransferDataFromWindow({ ...v, lineWidth: 0, fillMode: 'solid' }).ok).toBe(true);
    expect(frame.GetUndoCommandCount()).toBe(1);
  });

  it('a copper graphic keeps its net; moved off copper it has none', () => {
    const v = dlg(1).TransferDataToWindow();
    expect(v.net).toBe(1);
    dlg(1).TransferDataFromWindow({ ...v, layer: 'F.SilkS' });
    expect(shape(1).GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    expect(shape(1).GetNetCode()).toBe(0);
  });

  it('a circle is its centre and a rim point; the type never changes', () => {
    const v = dlg(2).TransferDataToWindow();
    expect(v.center).toEqual({ x: MM(20), y: MM(20) });
    dlg(2).TransferDataFromWindow({ ...v, kind: 'rect', end: { x: MM(23), y: MM(20) } });
    expect(shape(2).GetShape()).toBe(SHAPE_T.CIRCLE);
    expect(shape(2).GetRadius()).toBe(MM(3));
  });

  it('the solder mask flag and its margin override', () => {
    const v = dlg(1).TransferDataToWindow();
    dlg(1).TransferDataFromWindow({ ...v, hasMask: true, maskMargin: MM(0.05) });
    expect(shape(1).HasSolderMask()).toBe(true);
    expect(shape(1).GetLocalSolderMaskMargin()).toBe(MM(0.05));
    dlg(1).TransferDataFromWindow({ ...dlg(1).TransferDataToWindow(), maskMargin: null });
    expect(shape(1).GetLocalSolderMaskMargin()).toBeUndefined();
  });
});
