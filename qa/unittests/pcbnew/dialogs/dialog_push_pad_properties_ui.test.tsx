// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The windows of DIALOG_PUSH_PAD_PROPERTIES, DIALOG_ENUM_PADS and
 * DIALOG_FP_EDIT_PAD_TABLE (their _base.cpp sizer trees), wired to the dialog
 * objects.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { DIALOG_ENUM_PADS } from '@ziroeda/pcbnew/dialogs/dialog_enum_pads.js';
import { DialogEnumPads } from '@ziroeda/pcbnew/dialogs/dialog_enum_pads_ui.js';
import {
  COL_NUMBER,
  DIALOG_FP_EDIT_PAD_TABLE,
} from '@ziroeda/pcbnew/dialogs/dialog_fp_edit_pad_table.js';
import { DialogFpEditPadTable } from '@ziroeda/pcbnew/dialogs/dialog_fp_edit_pad_table_ui.js';
import {
  DIALOG_PUSH_PAD_PROPERTIES,
  wxID_CANCEL,
} from '@ziroeda/pcbnew/dialogs/dialog_push_pad_properties.js';
import { DialogPushPadProperties } from '@ziroeda/pcbnew/dialogs/dialog_push_pad_properties_ui.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

afterEach(cleanup);

const BOARD = `(kicad_pcb (version 20241229) (generator "t")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (footprint "R" (layer "F.Cu") (at 60 30) (uuid "00000000-0000-4000-8000-000000000001")
    (property "Reference" "R" (at 0 0 0) (layer "F.SilkS") (uuid "00000000-0000-4000-8000-000000000002")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "V" (at 0 0 0) (layer "F.Fab") (uuid "00000000-0000-4000-8000-000000000003")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "10" smd rect (at -3 0) (size 1.5 1.5) (layers "F.Cu") (uuid "00000000-0000-4000-8000-000000000011"))
    (pad "2" smd rect (at 0 0) (size 1.5 1.5) (layers "F.Cu") (uuid "00000000-0000-4000-8000-000000000012"))))`;

const frame = (aType = FRAME_T.FRAME_PCB_EDITOR): TEST_PCB_FRAME => {
  const f = new TEST_PCB_FRAME(ParseBoard(BOARD), aType);
  f.SetScreen(new PCB_SCREEN({ x: 297e6, y: 210e6 }));
  f.SetCanvas({
    // `GetViewControls()->GetCursorPosition()`, which UpdateStatusBar reads.
    GetViewControls: () => ({ GetCursorPosition: () => ({ x: 0, y: 0 }) }),
    GetView: () => new Proxy({} as Record<string, unknown>, { get: () => () => null }),
    ForceRefresh: () => {},
    Refresh: () => {},
    GetGAL: () => null,
  } as unknown as PCB_DRAW_PANEL_GAL);
  return f;
};

describe('DialogPushPadProperties (dialog_push_pad_properties_base.cpp)', () => {
  it('has the Options box with the four filters ticked, and the three buttons', () => {
    const dlg = new DIALOG_PUSH_PAD_PROPERTIES(frame());
    render(<DialogPushPadProperties dialog={dlg} onResult={() => {}} />);
    expect(screen.getByText('Options')).toBeTruthy();
    for (const l of [
      'Do not modify pads having a different shape',
      'Do not modify pads having different layers',
      'Do not modify pads having a different orientation',
      'Do not modify pads having a different type',
    ])
      expect((screen.getByLabelText(l) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Change Pads on Current Footprint' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Change Pads on Identical Footprints' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('puts the buttons in GTK order: Cancel, Apply, OK', () => {
    const dlg = new DIALOG_PUSH_PAD_PROPERTIES(frame());
    render(<DialogPushPadProperties dialog={dlg} onResult={() => {}} />);
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual([
      'Cancel',
      'Change Pads on Identical Footprints',
      'Change Pads on Current Footprint',
    ]);
  });

  it('hides the Apply button in the footprint editor', () => {
    const dlg = new DIALOG_PUSH_PAD_PROPERTIES(frame(FRAME_T.FRAME_FOOTPRINT_EDITOR));
    render(<DialogPushPadProperties dialog={dlg} onResult={() => {}} />);
    expect(
      screen.queryByRole('button', { name: 'Change Pads on Identical Footprints' }),
    ).toBeNull();
  });

  it("a check box is the dialog's filter", () => {
    const dlg = new DIALOG_PUSH_PAD_PROPERTIES(frame());
    render(<DialogPushPadProperties dialog={dlg} onResult={() => {}} />);
    fireEvent.click(screen.getByLabelText('Do not modify pads having a different shape'));
    expect(dlg.GetPadShapeFilter()).toBe(false);
    fireEvent.click(screen.getByLabelText('Do not modify pads having different layers'));
    expect(dlg.GetPadLayerFilter()).toBe(false);
    fireEvent.click(screen.getByLabelText('Do not modify pads having a different orientation'));
    expect(dlg.GetPadOrientFilter()).toBe(false);
    fireEvent.click(screen.getByLabelText('Do not modify pads having a different type'));
    expect(dlg.GetPadTypeFilter()).toBe(false);
  });

  it('OK answers 0, Apply 1, Cancel and Esc wxID_CANCEL', () => {
    const dlg = new DIALOG_PUSH_PAD_PROPERTIES(frame());
    const onResult = vi.fn();
    render(<DialogPushPadProperties dialog={dlg} onResult={onResult} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change Pads on Current Footprint' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change Pads on Identical Footprints' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onResult.mock.calls).toEqual([[0], [1], [wxID_CANCEL], [wxID_CANCEL]]);
  });
});

describe('DialogEnumPads (dialog_enum_pads_base.cpp)', () => {
  it('has the notice, the prefix limited to 4 characters, and the two spin controls', () => {
    const dlg = new DIALOG_ENUM_PADS({ startNumber: 7, step: 3, prefix: 'AB' });
    render(<DialogEnumPads dialog={dlg} onResult={() => {}} />);
    expect(
      screen.getByText('Pad names are restricted to 4 characters (including number).'),
    ).toBeTruthy();
    const prefix = screen.getByLabelText('Pad name prefix:') as HTMLInputElement;
    expect(prefix.value).toBe('AB');
    expect(prefix.maxLength).toBe(4);
    expect((screen.getByLabelText('First pad number:') as HTMLInputElement).value).toBe('7');
    expect((screen.getByLabelText('Numbering step:') as HTMLInputElement).value).toBe('3');
    expect(document.activeElement).toBe(prefix);
  });

  it('OK writes the entries into the parameters and answers true', () => {
    const params = { startNumber: 1, step: 1 } as {
      startNumber: number;
      step: number;
      prefix?: string;
    };
    const dlg = new DIALOG_ENUM_PADS(params);
    const onResult = vi.fn();
    render(<DialogEnumPads dialog={dlg} onResult={onResult} />);
    fireEvent.change(screen.getByLabelText('Pad name prefix:'), { target: { value: 'P' } });
    fireEvent.change(screen.getByLabelText('First pad number:'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Numbering step:'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(params).toEqual({ startNumber: 12, step: 4, prefix: 'P' });
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it('Enter in the prefix entry is OK; Cancel and Esc answer false and leave the parameters', () => {
    const params = { startNumber: 1, step: 1 };
    const dlg = new DIALOG_ENUM_PADS(params);
    const onResult = vi.fn();
    render(<DialogEnumPads dialog={dlg} onResult={onResult} />);
    fireEvent.change(screen.getByLabelText('First pad number:'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onResult.mock.calls).toEqual([[false], [false]]);
    expect(params.startNumber).toBe(1);
    fireEvent.keyDown(screen.getByLabelText('Pad name prefix:'), { key: 'Enter' });
    expect(onResult).toHaveBeenLastCalledWith(true);
  });
});

describe('DialogFpEditPadTable (dialog_fp_edit_pad_table_base.cpp)', () => {
  const make = (): { dlg: DIALOG_FP_EDIT_PAD_TABLE; f: TEST_PCB_FRAME } => {
    const f = frame(FRAME_T.FRAME_FOOTPRINT_EDITOR);
    return { dlg: new DIALOG_FP_EDIT_PAD_TABLE(f, f.GetBoard()!.Footprints()[0]!), f };
  };

  it('has the summary line, a grid of the pads under eleven column labels, and OK / Cancel', () => {
    const { dlg } = make();
    render(<DialogFpEditPadTable dialog={dlg} onClose={() => {}} />);
    for (const l of ['Pad numbers:', 'Pad count:', 'Duplicate pads:'])
      expect(screen.getByText(l)).toBeTruthy();
    for (const c of [
      'Number',
      'Type',
      'Shape',
      'X Position',
      'Y Position',
      'Size X',
      'Size Y',
      'Drill X',
      'Drill Y',
      'Pad->Die Length',
      'Pad->Die Delay',
    ])
      expect(screen.getByText(c)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    // two pads, numbered 2 and 10
    const grid = within(screen.getByLabelText('Pads'));
    expect(grid.getByText('2')).toBeTruthy();
    expect(grid.getByText('10')).toBeTruthy();
  });

  it('fills in the summary labels from the pads', () => {
    const { dlg } = make();
    render(<DialogFpEditPadTable dialog={dlg} onClose={() => {}} />);
    expect(screen.getByText('2,10')).toBeTruthy();
    expect(screen.getByText('none')).toBeTruthy();
    expect(dlg.m_pin_count).toBe('2');
  });

  it('OK commits the grid and closes', () => {
    const { dlg, f } = make();
    const onClose = vi.fn();
    render(<DialogFpEditPadTable dialog={dlg} onClose={onClose} />);
    act(() => dlg.m_grid.SetCellValue(0, COL_NUMBER, '5'));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(
      f
        .GetBoard()!
        .Footprints()[0]!
        .Pads()
        .map((p) => p.GetNumber())
        .sort(),
    ).toEqual(['10', '5']);
    expect(f.GetUndoCommandCount()).toBe(1);
  });

  it('Cancel and Esc close, and put every pad back', () => {
    const { dlg, f } = make();
    const onClose = vi.fn();
    render(<DialogFpEditPadTable dialog={dlg} onClose={onClose} />);
    const pad = f
      .GetBoard()!
      .Footprints()[0]!
      .Pads()
      .find((p) => p.GetNumber() === '2')!;
    pad.SetNumber('77');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(pad.GetNumber()).toBe('2');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(f.GetUndoCommandCount()).toBe(0);
  });
});
