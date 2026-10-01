// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_PUSH_PAD_PROPERTIES (pcbnew/dialogs/dialog_push_pad_properties.cpp) and
 * DIALOG_ENUM_PADS (dialog_enum_pads.cpp). KiCad has no qa for them; each
 * expectation is read off the C++ line it cites.
 */
import { describe, expect, it } from 'vitest';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import {
  DEFAULT_PAD_ENUMERATION_PARAMS,
  DIALOG_ENUM_PADS,
} from '@ziroeda/pcbnew/dialogs/dialog_enum_pads.js';
import {
  DIALOG_PUSH_PAD_PROPERTIES,
  wxID_CANCEL,
} from '@ziroeda/pcbnew/dialogs/dialog_push_pad_properties.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const frame = (aType: FRAME_T): TEST_PCB_FRAME => {
  const f = new TEST_PCB_FRAME(
    ParseBoard(
      '(kicad_pcb (version 20241229) (generator "t") (layers (0 "F.Cu" signal) (2 "B.Cu" signal)))',
    ),
    aType,
  );
  return f;
};

describe('DIALOG_PUSH_PAD_PROPERTIES', () => {
  it('has the four filters ticked, as the base file says (_base.cpp:23-37)', () => {
    const d = new DIALOG_PUSH_PAD_PROPERTIES(frame(FRAME_T.FRAME_PCB_EDITOR));
    expect([
      d.GetPadShapeFilter(),
      d.GetPadLayerFilter(),
      d.GetPadOrientFilter(),
      d.GetPadTypeFilter(),
    ]).toEqual([true, true, true, true]);
  });

  it('each getter reads its own check box (.h:35-38)', () => {
    const d = new DIALOG_PUSH_PAD_PROPERTIES(frame(FRAME_T.FRAME_PCB_EDITOR));
    d.m_Pad_Shape_Filter_CB = false;
    expect(d.GetPadShapeFilter()).toBe(false);
    expect(d.GetPadLayerFilter()).toBe(true);
    d.m_Pad_Layer_Filter_CB = false;
    expect(d.GetPadLayerFilter()).toBe(false);
    expect(d.GetPadOrientFilter()).toBe(true);
    d.m_Pad_Orient_Filter_CB = false;
    expect(d.GetPadOrientFilter()).toBe(false);
    expect(d.GetPadTypeFilter()).toBe(true);
    d.m_Pad_Type_Filter_CB = false;
    expect(d.GetPadTypeFilter()).toBe(false);
  });

  it('shows the Apply button in the board editor, hides it in the footprint editor (:35-36)', () => {
    expect(new DIALOG_PUSH_PAD_PROPERTIES(frame(FRAME_T.FRAME_PCB_EDITOR)).m_applyShown).toBe(true);
    expect(new DIALOG_PUSH_PAD_PROPERTIES(frame(FRAME_T.FRAME_FOOTPRINT_EDITOR)).m_applyShown).toBe(
      false,
    );
  });

  it('OK ends the dialog with 0, Apply with 1, and the frame is told it was modified (:46-65)', () => {
    const f = frame(FRAME_T.FRAME_PCB_EDITOR);
    let modified = 0;
    f.OnModify = (): void => {
      modified++;
    };
    const d = new DIALOG_PUSH_PAD_PROPERTIES(f);
    expect(d.PadPropertiesAccept('ok')).toBe(0);
    expect(d.PadPropertiesAccept('apply')).toBe(1);
    expect(modified).toBe(2);
  });

  it('a dismissal is wxID_CANCEL, which is neither 0 nor 1', () => {
    expect(wxID_CANCEL).not.toBe(0);
    expect(wxID_CANCEL).not.toBe(1);
  });
});

describe('DIALOG_ENUM_PADS', () => {
  it('starts from the parameters it was given (:31-34)', () => {
    const d = new DIALOG_ENUM_PADS({ startNumber: 7, step: 3, prefix: 'AB' });
    expect([d.m_padStartNum, d.m_padNumStep, d.m_padPrefix]).toEqual([7, 3, 'AB']);
  });

  it('with no prefix the prefix entry is empty (:36, value_or( "" ))', () => {
    expect(new DIALOG_ENUM_PADS({ ...DEFAULT_PAD_ENUMERATION_PARAMS }).m_padPrefix).toBe('');
  });

  it("writes the three entries back into the caller's parameters (:44-52)", () => {
    const params = { startNumber: 1, step: 1 } as {
      startNumber: number;
      step: number;
      prefix?: string;
    };
    const d = new DIALOG_ENUM_PADS(params);
    d.m_padStartNum = 20;
    d.m_padNumStep = 5;
    d.m_padPrefix = 'X';
    expect(d.TransferDataFromWindow()).toBe(true);
    expect(params).toEqual({ startNumber: 20, step: 5, prefix: 'X' });
  });

  it('leaves the parameters alone until OK (:44)', () => {
    const params = { startNumber: 1, step: 1 };
    const d = new DIALOG_ENUM_PADS(params);
    d.m_padStartNum = 20;
    expect(params.startNumber).toBe(1);
  });
});
