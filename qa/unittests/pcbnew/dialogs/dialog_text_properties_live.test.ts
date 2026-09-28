// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_TEXT_PROPERTIES on a live PCB_TEXT (dialog_text_properties.cpp):
 * the controls read off the item, and OK as one BOARD_COMMIT.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { DIALOG_TEXT_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_text_properties.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

let board: BOARD;
let frame: TEST_PCB_FRAME;
const text = () => board.Drawings()[0] as PCB_TEXT;
const dlg = () => new DIALOG_TEXT_PROPERTIES(frame, text());

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  (gr_text "Hello" (at 10 20 450) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000001")
    (effects (font (size 1.5 1.2) (thickness 0.2) bold) (justify left top)))
)`);
  frame = new TEST_PCB_FRAME(board);
});

describe('TransferDataToWindow', () => {
  it('reads every control off the item', () => {
    const v = dlg().TransferDataToWindow();
    expect(v).toMatchObject({
      text: 'Hello',
      face: '',
      x: MM(10),
      y: MM(20),
      layer: 'F.SilkS',
      width: MM(1.2),
      height: MM(1.5),
      autoThickness: false,
      thickness: MM(0.2),
      bold: true,
      italic: false,
      mirrored: false,
      hJustify: 'left',
      vJustify: 'top',
      locked: false,
    });
  });

  it('shows the angle normalised to (-180, 180] (Normalize180)', () => {
    // 450 degrees in the file is 90 in the box.
    expect(dlg().TransferDataToWindow().orientation).toBe(90);
  });

  it('an automatic thickness shows the pen it is drawn with', () => {
    text().SetAutoThickness(true);
    const v = dlg().TransferDataToWindow();
    expect(v.autoThickness).toBe(true);
    expect(v.thickness).toBe(text().GetEffectiveTextPenWidth());
  });
});

describe('TransferDataFromWindow', () => {
  it('writes the controls back as one undo step', () => {
    const v = dlg().TransferDataToWindow();
    const r = dlg().TransferDataFromWindow({
      ...v,
      text: 'World',
      x: MM(30),
      width: MM(2),
      height: MM(2),
      layer: 'F.Cu',
      hJustify: 'right',
      vJustify: 'center',
      mirrored: true,
      italic: true,
      orientation: -90,
    });
    expect(r).toEqual({ ok: true });
    const t = text();
    expect(t.GetText()).toBe('World');
    expect(t.GetPosition()).toEqual({ x: MM(30), y: MM(20) });
    expect(t.GetTextSize()).toEqual({ x: MM(2), y: MM(2) });
    expect(t.GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
    expect(t.GetHorizJustify()).toBe(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
    expect(t.GetVertJustify()).toBe(GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER);
    expect(t.IsMirrored()).toBe(true);
    expect(t.IsItalic()).toBe(true);
    // SetTextAngle( angle.Normalize() ): -90 is stored as 270.
    expect(t.GetTextAngle().AsDegrees()).toBe(270);
    expect(frame.GetUndoCommandCount()).toBe(1);

    frame.RestoreCopyFromUndoList();
    expect(text().GetText()).toBe('Hello');
    expect(text().GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
  });

  it('escapes a double quote for the file (CTX_QUOTED_STR), and an empty text changes nothing', () => {
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, text: 'a "b"' });
    expect(text().GetText()).toBe('a {dblquote}b{dblquote}');
    dlg().TransferDataFromWindow({ ...v, text: '' });
    expect(text().GetText()).toBe('a {dblquote}b{dblquote}');
  });

  it('auto thickness stores a zero', () => {
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, autoThickness: true });
    expect(text().GetTextThickness()).toBe(0);
    expect(text().GetAutoThickness()).toBe(true);
  });

  it('clamps a pen too wide for the size, and says so', () => {
    const v = dlg().TransferDataToWindow();
    const r = dlg().TransferDataFromWindow({ ...v, thickness: MM(1) });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/clamped/);
    // ClampTextPenSize: a quarter of the smaller side (1.2 mm).
    expect(text().GetTextThickness()).toBe(MM(0.3));
  });

  it('refuses a size outside TEXT_MIN_SIZE_MM..TEXT_MAX_SIZE_MM, changing nothing', () => {
    const v = dlg().TransferDataToWindow();
    expect(dlg().TransferDataFromWindow({ ...v, width: MM(300) }).ok).toBe(false);
    expect(text().GetTextSize().x).toBe(MM(1.2));
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('a named face sets the font; the empty face is the stroke font', () => {
    const v = dlg().TransferDataToWindow();
    dlg().TransferDataFromWindow({ ...v, face: 'Sans Serif' });
    expect(text().GetFont()?.GetName()).toBe('Sans Serif');
    dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), face: '' });
    expect(dlg().TransferDataToWindow().face).toBe('');
  });
});
