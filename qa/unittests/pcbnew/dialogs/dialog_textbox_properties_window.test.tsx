// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_TEXTBOX_PROPERTIES's window (dialog_textbox_properties.cpp) on its base, over a live
 * PCB_TEXTBOX: onBorderChecked's default width and greying, onAutoTextThickness, and the syntax
 * help link.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { GetPenSizeForNormal } from '@ziroeda/common/gr_text.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  DIALOG_TEXTBOX_PROPERTIES,
  DialogTextBoxProperties,
  type TextBoxValues,
} from '@ziroeda/pcbnew/dialogs/dialog_textbox_properties.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PCB_TEXTBOX } from '@ziroeda/pcbnew/pcb_textbox.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

afterEach(cleanup);

const MM = (n: number): number => pcbIUScale.mmToIU(n);

let board: BOARD;
let frame: TEST_PCB_FRAME;

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  (gr_text_box "Box" (start 10 10) (end 30 20) (margins 1 1 1 1) (layer "F.SilkS")
    (uuid "00000000-0000-4000-8000-000000000001")
    (effects (font (size 1.5 1.5) (thickness 0.2)) (justify left top))
    (border no) (stroke (width 0) (type solid)))
)`);
  frame = new TEST_PCB_FRAME(board);
});

function show() {
  const dialog = new DIALOG_TEXTBOX_PROPERTIES(frame, board.Drawings()[0] as PCB_TEXTBOX);
  const onApply = vi.fn();
  render(
    <DialogTextBoxProperties
      dialog={dialog}
      initial={dialog.TransferDataToWindow()}
      units="mm"
      layers={['F.SilkS']}
      layerColor={() => '#fff'}
      layerLabel={(l: string) => l}
      onApply={onApply}
      onClose={() => {}}
    />,
  );
  return (): TextBoxValues => {
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    return onApply.mock.calls[0]![0];
  };
}

const textbox = (aName: string) => screen.getByRole('textbox', { name: aName }) as HTMLInputElement;

describe('DIALOG_TEXTBOX_PROPERTIES window', () => {
  it('Border enables its width and style, and a zero width takes the layer line thickness', () => {
    const ok = show();
    expect(textbox('Border width').disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Border'));
    expect(textbox('Border width').disabled).toBe(false);
    const v = ok();
    expect(v.border).toBe(true);
    expect(v.borderWidth).toBe(
      board.GetDesignSettings().GetLineThickness(LSET_NameToLayer('F.SilkS')),
    );
    expect(v.borderWidth).toBeGreaterThan(0);
  });

  it('auto thickness takes the pen for the size and greys the field', () => {
    const ok = show();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust the text thickness' }));
    expect(textbox('Thickness').disabled).toBe(true);
    const v = ok();
    expect(v.autoThickness).toBe(true);
    expect(v.thickness).toBe(GetPenSizeForNormal(MM(1.5)));
  });

  it('the Syntax help link opens KiCad’s help table', () => {
    show();
    fireEvent.click(screen.getByText('Syntax help'));
    expect(screen.getByText('Syntax Help')).toBeTruthy();
  });
});

describe('DIALOG_TEXTBOX_PROPERTIES_BASE', () => {
  it('has no Knockout and no margins: those are property-manager entries', () => {
    show();
    expect(screen.queryByLabelText('Knockout')).toBeNull();
    expect(screen.queryByText(/margin/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
  });
});
