// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_TEXTBOX_PROPERTIES on a live PCB_TEXTBOX
 * (dialog_textbox_properties.cpp): the controls and OK as one BOARD_COMMIT.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { GR_TEXT_H_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { LINE_STYLE } from '@ziroeda/common/stroke_params.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { DIALOG_TEXTBOX_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_textbox_properties.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PCB_TEXTBOX } from '@ziroeda/pcbnew/pcb_textbox.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

let board: BOARD;
let frame: TEST_PCB_FRAME;
const tb = () => board.Drawings()[0] as PCB_TEXTBOX;
const dlg = () => new DIALOG_TEXTBOX_PROPERTIES(frame, tb());

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  (gr_text_box "Box" (start 10 10) (end 30 20) (margins 1 1 1 1) (layer "F.SilkS")
    (uuid "00000000-0000-4000-8000-000000000001")
    (effects (font (size 1.5 1.5) (thickness 0.2)) (justify left top))
    (border yes) (stroke (width 0.15) (type dash)))
)`);
  frame = new TEST_PCB_FRAME(board);
});

describe('DIALOG_TEXTBOX_PROPERTIES', () => {
  it('reads the item', () => {
    expect(dlg().TransferDataToWindow()).toMatchObject({
      text: 'Box',
      layer: 'F.SilkS',
      width: MM(1.5),
      height: MM(1.5),
      thickness: MM(0.2),
      horizJustify: 'left',
      vertJustify: 'top',
      border: true,
      borderWidth: MM(0.15),
      borderStyle: 'dash',
    });
  });

  it('writes it back as one undo step', () => {
    const v = dlg().TransferDataToWindow();
    expect(
      dlg().TransferDataFromWindow({
        ...v,
        text: 'New',
        horizJustify: 'right',
        borderStyle: 'dot',
        borderWidth: MM(0.3),
        border: false,
      }),
    ).toEqual({ ok: true });
    expect(tb().GetText()).toBe('New');
    expect(tb().GetHorizJustify()).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
    expect(tb().GetStroke().GetLineStyle()).toBe(LINE_STYLE.DOT);
    expect(tb().GetStroke().GetWidth()).toBe(MM(0.3));
    expect(tb().IsBorderEnabled()).toBe(false);
    expect(frame.GetUndoCommandCount()).toBe(1);
    frame.RestoreCopyFromUndoList();
    expect(tb().GetText()).toBe('Box');
    expect(tb().GetStroke().GetLineStyle()).toBe(LINE_STYLE.DASH);
  });

  it('grows the box to the minimum the text needs (GetMinSize)', () => {
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, width: MM(10), height: MM(10) });
    const min = tb().GetMinSize();
    expect(Math.abs(tb().GetEnd().y - tb().GetStart().y)).toBeGreaterThanOrEqual(min.y);
    expect(tb().GetEnd().y).toBeGreaterThan(MM(20));
  });

  it('a zero thickness is automatic, and stays automatic', () => {
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, thickness: 0 });
    expect(tb().GetAutoThickness()).toBe(true);
    expect(dlg().TransferDataToWindow().thickness).toBe(0);
  });

  it('does not write margins or knockout, which the C++ dialog has no control for', () => {
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, marginLeft: MM(3), knockout: !v.knockout });
    expect(tb().GetMarginLeft()).toBe(MM(1));
    expect(tb().IsKnockout()).toBe(v.knockout);
  });

  it('refuses an out-of-range size', () => {
    const v = dlg().TransferDataToWindow();
    expect(dlg().TransferDataFromWindow({ ...v, height: 0 }).ok).toBe(false);
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('a named face sets the font; the empty face is the stroke font', () => {
    const v = dlg().TransferDataToWindow();
    expect(v.face).toBe('');
    dlg().TransferDataFromWindow({ ...v, face: 'Sans Serif' });
    expect(tb().GetFont()?.GetName()).toBe('Sans Serif');
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), face: '' });
    expect(dlg().TransferDataToWindow().face).toBe('');
  });
});
