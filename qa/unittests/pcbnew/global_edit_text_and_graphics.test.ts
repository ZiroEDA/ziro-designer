// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit > Edit Text & Graphics Properties: GLOBAL_EDIT_TOOL::EditTextAndGraphics
 * and DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS (dialog_global_edit_text_and_graphics.cpp)
 * on a live BOARD. KiCad has no qa for it; each expectation cites its line.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { GetPenSizeForNormal } from '@ziroeda/common/gr_text.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { INDETERMINATE_ACTION } from '@ziroeda/common/widgets/ui_common.js';
import { LAYER_CLASS } from '@ziroeda/pcbnew/board_design_settings.js';
import type { DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS } from '@ziroeda/pcbnew/dialogs/dialog_global_edit_text_and_graphics.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { GLOBAL_EDIT_TOOL } from '@ziroeda/pcbnew/tools/global_edit_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { byUuid, type TOOL_HARNESS, toolHarness, U } from './support/pcb_tool_harness.js';
import { GLOBAL_EDIT_TEST_FRAME } from './support/global_edit_test_frame.js';

const MM = (n: number): number => Math.round(n * 1_000_000);

// R1 (Lib:R) and C1 (Lib:C), each with Reference on F.SilkS, Value on F.Fab
// and a silk line; a board text (30) and a board silk line (31).
const fp = (ref: string, lib: string, n: number, x: number) => `
  (footprint "${lib}" (layer "F.Cu") (uuid "${U(n)}") (at ${x} 30)
    (property "Reference" "${ref}" (at 0 -3 0) (layer "F.SilkS") (uuid "${U(n + 1)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "V" (at 0 3 0) (layer "F.Fab") (uuid "${U(n + 2)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (fp_line (start -1 -1) (end 1 -1) (stroke (width 0.12) (type solid)) (layer "F.SilkS") (uuid "${U(n + 3)}")))`;

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen") (13 "F.Fab" user) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  ${fp('R1', 'Lib:R', 1, 60)}
  ${fp('C1', 'Lib:C', 10, 80)}
  (gr_text "T" (at 40 50) (layer "F.SilkS") (uuid "${U(30)}") (effects (font (size 1 1) (thickness 0.15))))
  (gr_line (start 10 50) (end 20 50) (stroke (width 0.1) (type solid)) (layer "F.SilkS") (uuid "${U(31)}"))
)
`;

class FRAME extends GLOBAL_EDIT_TEST_FRAME {
  dialog: DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS | null = null;
  override ShowGlobalEditTextAndGraphicsDialog(
    aDialog: DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS,
  ): void {
    this.dialog = aDialog;
  }
}

let h: TOOL_HARNESS<FRAME>;

beforeEach(() => {
  h = toolHarness(
    BOARD_TEXT,
    (aBoard) => new FRAME(aBoard),
    () => [new GLOBAL_EDIT_TOOL()],
  );
  h.mgr.ResetTools(RESET_REASON.MODEL_RELOAD);
});

function open(): DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS {
  h.mgr.RunAction(PCB_ACTIONS.editTextAndGraphics);
  const dlg = h.frame.dialog!;
  dlg.TransferDataToWindow();
  return dlg;
}

const footprint = (n: number): FOOTPRINT => byUuid(h.board, n) as unknown as FOOTPRINT;
const ref = (n: number): EDA_TEXT => footprint(n).Reference() as unknown as EDA_TEXT;
const value = (n: number): EDA_TEXT => footprint(n).Value() as unknown as EDA_TEXT;
const shape = (n: number): PCB_SHAPE => byUuid(h.board, n) as unknown as PCB_SHAPE;
const text = (n: number): EDA_TEXT => byUuid(h.board, n) as unknown as EDA_TEXT;

describe('DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS', () => {
  it('opens with every action "-- leave unchanged --" (:161-176)', () => {
    const dlg = open();
    expect(dlg.m_textWidth.GetText()).toBe(INDETERMINATE_ACTION);
    expect(dlg.m_lineWidth.IsIndeterminate()).toBe(true);
    expect([dlg.m_bold, dlg.m_italic, dlg.m_keepUpright, dlg.m_visible]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(dlg.m_LayerCtrl).toBe(PCB_LAYER_ID.UNDEFINED_LAYER);
  });

  it('a text height on Reference designators only, one undo step (:363-367)', () => {
    const dlg = open();
    dlg.m_references = true;
    dlg.m_textHeight.SetValue(MM(1.5));
    const undo = h.frame.GetUndoCommandCount();
    expect(dlg.TransferDataFromWindow()).toBe(true);
    expect(ref(1).GetTextSize()).toEqual({ x: MM(1), y: MM(1.5) });
    expect(value(1).GetTextSize().y).toBe(MM(1));
    expect(text(30).GetTextSize().y).toBe(MM(1));
    expect(h.frame.GetUndoCommandCount()).toBe(undo + 1);
  });

  it('line thickness reaches footprint and board graphics by their own boxes (:424-432)', () => {
    const dlg = open();
    dlg.m_footprintGraphics = true;
    dlg.m_lineWidth.SetValue(MM(0.2));
    dlg.TransferDataFromWindow();
    expect(shape(4).GetWidth()).toBe(MM(0.2));
    expect(shape(31).GetWidth()).toBe(MM(0.1));
  });

  it('PCB graphic items alone leaves footprint graphics alone', () => {
    const dlg = open();
    dlg.m_boardGraphics = true;
    dlg.m_lineWidth.SetValue(MM(0.2));
    dlg.TransferDataFromWindow();
    expect(shape(31).GetWidth()).toBe(MM(0.2));
    expect(shape(4).GetWidth()).toBe(MM(0.12));
  });

  it('an undetermined Bold leaves a bold text bold', () => {
    text(30).SetBold(true);
    const dlg = open();
    dlg.m_boardText = true;
    dlg.m_textHeight.SetValue(MM(1.5));
    dlg.TransferDataFromWindow();
    expect(text(30).IsBold()).toBe(true);
  });

  it('Bold set from its tri-state; unset leaves it (:377-378)', () => {
    const dlg = open();
    dlg.m_boardText = true;
    dlg.m_bold = true;
    dlg.TransferDataFromWindow();
    expect(text(30).IsBold()).toBe(true);
    expect(text(30).IsItalic()).toBe(false);
  });

  it('the parent reference filter is a wildcard (:466-473)', () => {
    const dlg = open();
    dlg.m_references = true;
    dlg.m_referenceFilterOpt = true;
    dlg.m_referenceFilter = 'C*';
    dlg.m_textHeight.SetValue(MM(1.5));
    dlg.TransferDataFromWindow();
    expect(ref(10).GetTextSize().y).toBe(MM(1.5));
    expect(ref(1).GetTextSize().y).toBe(MM(1));
  });

  it('the library-link filter matches lib:name (:475-482)', () => {
    const dlg = open();
    dlg.m_references = true;
    dlg.m_footprintFilterOpt = true;
    dlg.m_footprintFilter = 'Lib:R';
    dlg.m_textHeight.SetValue(MM(1.5));
    dlg.TransferDataFromWindow();
    expect(ref(1).GetTextSize().y).toBe(MM(1.5));
    expect(ref(10).GetTextSize().y).toBe(MM(1));
  });

  it('the layer filter (:459-463)', () => {
    const dlg = open();
    dlg.m_references = true;
    dlg.m_values = true;
    dlg.m_layerFilterOpt = true;
    dlg.m_layerFilter = PCB_LAYER_ID.F_Fab;
    dlg.m_textHeight.SetValue(MM(1.5));
    dlg.TransferDataFromWindow();
    expect(value(1).GetTextSize().y).toBe(MM(1.5));
    expect(ref(1).GetTextSize().y).toBe(MM(1));
  });

  it('refuses a text size outside the limits (:490-498)', () => {
    const dlg = open();
    dlg.m_references = true;
    dlg.m_textWidth.SetValue(1);
    expect(dlg.ValidationError()).not.toBe(null);
    expect(dlg.TransferDataFromWindow()).toBe(false);
    expect(ref(1).GetTextSize().x).toBe(MM(1));
  });

  it('auto thickness follows the size: the normal pen of min( w, h ) (:340-356)', () => {
    const dlg = open();
    dlg.m_textWidth.SetValue(MM(2));
    dlg.m_textHeight.SetValue(MM(1.5));
    dlg.OnAutoTextThickness(true);
    expect(dlg.m_thickness.GetValue()).toBe(GetPenSizeForNormal(MM(1.5)));
    expect(dlg.ThicknessEnabled()).toBe(false);
  });

  it('auto thickness with an unchanged size shows "(auto)" (:333-334)', () => {
    const dlg = open();
    dlg.OnAutoTextThickness(true);
    expect(dlg.m_thickness.GetText()).toBe('(auto)');
  });

  it('layer defaults restyle from Board Setup (:438-441)', () => {
    const bds = h.board.GetDesignSettings();
    bds.m_TextSize[LAYER_CLASS.LAYER_CLASS_SILK] = { x: MM(1.2), y: MM(1.3) };
    const dlg = open();
    dlg.m_boardText = true;
    dlg.m_setToSpecifiedValues = false;
    dlg.TransferDataFromWindow();
    expect(text(30).GetTextSize()).toEqual({ x: MM(1.2), y: MM(1.3) });
  });

  it('labels the defaults radio for dimensions (:320-326)', () => {
    const dlg = open();
    expect(dlg.LayerDefaultsLabel()).toBe('Set to layer default values:');
    dlg.m_boardDimensions = true;
    expect(dlg.LayerDefaultsLabel()).toBe('Set to layer and dimension default values:');
  });

  it('keeps the parent filters for the next open (:151-155)', () => {
    let dlg = open();
    dlg.m_referenceFilter = 'U*';
    dlg.OnClose();
    dlg = open();
    expect(dlg.m_referenceFilter).toBe('U*');
  });
});
