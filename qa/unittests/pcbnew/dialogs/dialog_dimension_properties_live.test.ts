// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_DIMENSION_PROPERTIES on a live dimension (dialog_dimension_properties.cpp).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { DIALOG_DIMENSION_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_dimension_properties.js';
import type { PCB_DIM_ALIGNED, PCB_DIM_LEADER } from '@ziroeda/pcbnew/pcb_dimension.js';
import { DIM_ARROW_DIRECTION, DIM_UNITS_MODE } from '@ziroeda/pcbnew/pcb_dimension_types.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

let board: BOARD;
let frame: TEST_PCB_FRAME;
const ortho = () => board.Drawings()[0] as PCB_DIM_ALIGNED;
const leader = () => board.Drawings()[1] as PCB_DIM_LEADER;
const dlg = (i: 0 | 1) => new DIALOG_DIMENSION_PROPERTIES(frame, i === 0 ? ortho() : leader());

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (17 "Dwgs.User" user "User.Drawings") (19 "Cmts.User" user "User.Comments"))
  (net 0 "")
  (dimension (type orthogonal) (layer "Dwgs.User") (uuid "10000000-0000-4000-8000-000000000002")
    (pts (xy 113.6 58.975) (xy 113.35 28.975)) (height 12.85) (orientation 1)
    (format (prefix "R ") (suffix " typ") (units 3) (units_format 0) (precision 4) (suppress_zeroes yes))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0) (arrow_direction outward)
      (extension_height 0.58642) (extension_offset 0.5) (keep_text_aligned yes))
    (gr_text "30" (at 125.3 43.975 90) (layer "Dwgs.User") (uuid "10000000-0000-4000-8000-000000000004")
      (effects (font (size 1 1) (thickness 0.15)))))
  (dimension (type leader) (layer "Cmts.User") (uuid "10000000-0000-4000-8000-000000000003")
    (pts (xy 152.9 67.3) (xy 156.2 63.9))
    (format (prefix "") (suffix "") (units 0) (units_format 0) (precision 4) (override_value "0.3mm Thickness"))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0) (text_frame 1) (extension_offset 0.5))
    (gr_text "0.3mm Thickness" (at 168.9 63.9 0) (layer "Cmts.User") (uuid "10000000-0000-4000-8000-000000000005")
      (effects (font (size 1 1) (thickness 0.15)))))
)`);
  frame = new TEST_PCB_FRAME(board);
});

describe('DIALOG_DIMENSION_PROPERTIES', () => {
  it('reads a measured dimension', () => {
    expect(dlg(0).TransferDataToWindow()).toMatchObject({
      layer: 'Dwgs.User',
      prefix: 'R ',
      suffix: ' typ',
      overrideValue: undefined,
      units: 3,
      unitsFormat: 0,
      precision: 4,
      suppressZeroes: true,
      arrowDirection: 'outward',
      lineThickness: MM(0.1),
      extensionOvershoot: MM(0.58642),
      keepTextAligned: true,
      textWidth: MM(1),
    });
  });

  it('reads a leader, with its override and text frame', () => {
    const v = dlg(1).TransferDataToWindow();
    expect(v.overrideValue).toBe('0.3mm Thickness');
    expect(v.textFrame).toBe(1);
  });

  it('writes back as one undo step, and re-derives the label (Update)', () => {
    const v = dlg(0).TransferDataToWindow();
    const r = dlg(0).TransferDataFromWindow({
      ...v,
      prefix: 'L ',
      units: 2,
      unitsFormat: 1,
      precision: 2,
      arrowDirection: 'inward',
      extensionOvershoot: MM(1),
    });
    expect(r).toEqual({ ok: true });
    const d = ortho();
    expect(d.GetPrefix()).toBe('L ');
    expect(d.GetUnitsMode()).toBe(DIM_UNITS_MODE.MM);
    expect(d.GetArrowDirection()).toBe(DIM_ARROW_DIRECTION.INWARD);
    expect(d.GetExtensionHeight()).toBe(MM(1));
    // The label follows the new format: the new prefix and the unit, with the
    // file's suppress_zeroes trimming 30.00 to 30.
    expect(d.GetText()).toBe('L 30 mm typ');
    expect(frame.GetUndoCommandCount()).toBe(1);
    frame.RestoreCopyFromUndoList();
    expect(ortho().GetPrefix()).toBe('R ');
  });

  it('switches the override on and off', () => {
    const v = dlg(0).TransferDataToWindow();
    dlg(0).TransferDataFromWindow({ ...v, overrideValue: 'custom' });
    expect(ortho().GetOverrideTextEnabled()).toBe(true);
    // updateText wraps the override in the prefix and suffix too.
    expect(ortho().GetText()).toBe('R custom typ');
    dlg(0).TransferDataFromWindow({ ...dlg(0).TransferDataToWindow(), overrideValue: undefined });
    expect(ortho().GetOverrideTextEnabled()).toBe(false);
  });

  it('moves the text only in MANUAL mode', () => {
    const v = dlg(0).TransferDataToWindow();
    dlg(0).TransferDataFromWindow({ ...v, textX: MM(10), textY: MM(10) });
    expect(ortho().GetTextPos().x).not.toBe(MM(10));
    dlg(0).TransferDataFromWindow({ ...v, textPositionMode: 2, textX: MM(10), textY: MM(10) });
    expect(ortho().GetTextPos()).toEqual({ x: MM(10), y: MM(10) });
  });

  it('writes the text frame on a leader only, and never the lock', () => {
    const v = dlg(1).TransferDataToWindow();
    dlg(1).TransferDataFromWindow({ ...v, textFrame: 2, locked: true });
    expect(leader().GetTextBorder()).toBe(2);
    // DIALOG_DIMENSION_PROPERTIES_BASE has no Locked control.
    expect(leader().IsLocked()).toBe(false);
  });
});
