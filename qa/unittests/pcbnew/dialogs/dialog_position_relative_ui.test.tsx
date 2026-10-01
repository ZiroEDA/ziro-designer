// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The window of DIALOG_POSITION_RELATIVE and DIALOG_OFFSET_ITEM
 * (dialog_position_relative_base.cpp, dialog_offset_item_base.cpp): the
 * controls the sizer trees build, wired to the dialog objects' handlers.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import { TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { DIALOG_OFFSET_ITEM } from '@ziroeda/pcbnew/dialogs/dialog_offset_item.js';
import { DialogOffsetItem } from '@ziroeda/pcbnew/dialogs/dialog_offset_item_ui.js';
import {
  ANCHOR_TYPE,
  DIALOG_POSITION_RELATIVE,
} from '@ziroeda/pcbnew/dialogs/dialog_position_relative.js';
import { DialogPositionRelativeModeless } from '@ziroeda/pcbnew/dialogs/dialog_position_relative_ui.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = 1_000_000;

class STUB_POSREL extends TOOL_INTERACTIVE {
  moves: { anchor: Vec2; translation: Vec2 }[] = [];

  constructor() {
    super('pcbnew.PositionRelative');
  }
  override Init(): boolean {
    return true;
  }
  override Reset(_r: RESET_REASON): void {}
  protected override setTransitions(): void {}
  GetSelectionAnchorPosition(): Vec2 {
    return { x: 0, y: 0 };
  }
  RelativeItemSelectionMove(aAnchor: Vec2, aTranslation: Vec2): number {
    this.moves.push({ anchor: aAnchor, translation: aTranslation });
    return 0;
  }
}

let frame: TEST_PCB_FRAME;
let posrel: STUB_POSREL;

beforeEach(() => {
  DIALOG_POSITION_RELATIVE.s_anchorType = ANCHOR_TYPE.ANCHOR_ITEM;
  frame = new TEST_PCB_FRAME(
    ParseBoard(
      '(kicad_pcb (version 20241229) (generator "t") (layers (0 "F.Cu" signal) (2 "B.Cu" signal)))',
    ),
  );
  frame.SetScreen(new PCB_SCREEN({ x: 297e6, y: 210e6 }));
  posrel = new STUB_POSREL();
  frame.GetToolManager()!.RegisterTool(posrel);
  frame.GetToolManager()!.InitTools();
});

afterEach(cleanup);

const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;

describe('DialogPositionRelativeModeless (dialog_position_relative_base.cpp)', () => {
  it('draws nothing until the dialog is shown (it is modeless and kept between calls)', () => {
    const dlg = new DIALOG_POSITION_RELATIVE(frame);
    render(<DialogPositionRelativeModeless dialog={dlg} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => dlg.Show(true));
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => dlg.Hide());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('builds the controls the base file states, with the polar labels InitDialog gives them', () => {
    const dlg = new DIALOG_POSITION_RELATIVE(frame);
    render(<DialogPositionRelativeModeless dialog={dlg} />);
    act(() => dlg.Show(true));
    expect(screen.getByText('Position Relative To Reference Item')).toBeTruthy();
    expect(screen.getByText('Reference item: <none selected>')).toBeTruthy();
    for (const l of ['Use Local Origin', 'Use Grid Origin', 'Select Item...', 'Select Point...'])
      expect(screen.getByRole('button', { name: l })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Reset' })).toHaveLength(2);
    expect(screen.getByText('Distance:')).toBeTruthy();
    expect(screen.getByText('Angle:')).toBeTruthy();
    expect(screen.getByText('°')).toBeTruthy();
    expect((screen.getByLabelText('Use polar coordinates') as HTMLInputElement).checked).toBe(true);
    expect(input('ze-posrel-x').value).toBe('0');
    expect(input('ze-posrel-y').value).toBe('0');
  });

  it('the pick buttons carry the tooltip the base file gives Select Item...', () => {
    const dlg = new DIALOG_POSITION_RELATIVE(frame);
    render(<DialogPositionRelativeModeless dialog={dlg} />);
    act(() => dlg.Show(true));
    expect(screen.getByRole('button', { name: 'Select Item...' }).getAttribute('title')).toBe(
      'Click and select a board item.\nThe anchor position will be the position of the selected item.',
    );
  });

  it('Use Grid Origin changes the reference line (OnUseGridOriginClick)', () => {
    const dlg = new DIALOG_POSITION_RELATIVE(frame);
    render(<DialogPositionRelativeModeless dialog={dlg} />);
    act(() => dlg.Show(true));
    fireEvent.click(screen.getByRole('button', { name: 'Use Grid Origin' }));
    expect(screen.getByText('Reference location: grid origin')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use Local Origin' }));
    expect(screen.getByText('Reference location: local coordinates origin')).toBeTruthy();
  });

  it('unticking polar relabels the entries and the units (OnPolarChanged)', () => {
    const dlg = new DIALOG_POSITION_RELATIVE(frame);
    render(<DialogPositionRelativeModeless dialog={dlg} />);
    act(() => dlg.Show(true));
    fireEvent.click(screen.getByLabelText('Use polar coordinates'));
    expect(screen.getByText('Offset X:')).toBeTruthy();
    expect(screen.getByText('Offset Y:')).toBeTruthy();
    expect(screen.queryByText('°')).toBeNull();
    expect(screen.getAllByText('mm')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Reset' })[0]!.getAttribute('title')).toBe(
      'Reset to the current X offset from the reference position.',
    );
  });

  it('typing reaches the dialog, and a blank entry is 0 again on blur (OnTextFocusLost)', () => {
    const dlg = new DIALOG_POSITION_RELATIVE(frame);
    render(<DialogPositionRelativeModeless dialog={dlg} />);
    act(() => dlg.Show(true));
    fireEvent.change(input('ze-posrel-x'), { target: { value: '12' } });
    expect(dlg.m_xOffset.GetText()).toBe('12');
    fireEvent.change(input('ze-posrel-x'), { target: { value: '' } });
    fireEvent.blur(input('ze-posrel-x'));
    expect(input('ze-posrel-x').value).toBe('0');
  });

  it('OK moves the selection and hides the dialog; Enter in an entry is OK', () => {
    const dlg = new DIALOG_POSITION_RELATIVE(frame);
    render(<DialogPositionRelativeModeless dialog={dlg} />);
    act(() => dlg.Show(true));
    fireEvent.click(screen.getByRole('button', { name: 'Use Grid Origin' }));
    fireEvent.click(screen.getByLabelText('Use polar coordinates'));
    fireEvent.change(input('ze-posrel-x'), { target: { value: '3' } });
    fireEvent.change(input('ze-posrel-y'), { target: { value: '4' } });
    fireEvent.keyDown(input('ze-posrel-y'), { key: 'Enter' });
    expect(posrel.moves).toEqual([
      { anchor: { x: 0, y: 0 }, translation: { x: 3 * MM, y: 4 * MM } },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Cancel, the close box and Esc hide it without moving anything', () => {
    const dlg = new DIALOG_POSITION_RELATIVE(frame);
    render(<DialogPositionRelativeModeless dialog={dlg} />);
    act(() => dlg.Show(true));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(dlg.IsShown()).toBe(false);
    act(() => dlg.Show(true));
    fireEvent.click(screen.getByText('✕'));
    expect(dlg.IsShown()).toBe(false);
    act(() => dlg.Show(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dlg.IsShown()).toBe(false);
    expect(posrel.moves).toEqual([]);
  });

  it('puts the cursor in the X entry when it is shown (SetInitialFocus( m_xEntry ))', () => {
    const dlg = new DIALOG_POSITION_RELATIVE(frame);
    render(<DialogPositionRelativeModeless dialog={dlg} />);
    act(() => dlg.Show(true));
    expect(document.activeElement).toBe(input('ze-posrel-x'));
  });
});

describe('DialogOffsetItem (dialog_offset_item_base.cpp)', () => {
  const make = (): { dlg: DIALOG_OFFSET_ITEM; offset: { x: number; y: number } } => {
    const offset = { x: -10 * MM, y: 0 };
    return { dlg: new DIALOG_OFFSET_ITEM(frame, offset), offset };
  };

  it('builds the controls the base file states, with the original offset in polar form', () => {
    const { dlg } = make();
    render(<DialogOffsetItem dialog={dlg} onResult={() => {}} />);
    expect(screen.getByText('Offset Item')).toBeTruthy();
    expect(screen.getByText('Distance:')).toBeTruthy();
    expect(screen.getByText('Angle:')).toBeTruthy();
    expect(input('ze-offset-x').value).toBe('10');
    expect(input('ze-offset-y').value).toBe('180');
    expect(screen.getAllByRole('button', { name: 'Reset' })).toHaveLength(2);
    expect((screen.getByLabelText('Use polar coordinates') as HTMLInputElement).checked).toBe(true);
    expect(document.activeElement).toBe(input('ze-offset-x'));
  });

  it('OK writes the vector back and answers true', () => {
    const { dlg, offset } = make();
    const onResult = vi.fn();
    render(<DialogOffsetItem dialog={dlg} onResult={onResult} />);
    fireEvent.click(screen.getByLabelText('Use polar coordinates'));
    fireEvent.change(input('ze-offset-x'), { target: { value: '2.5' } });
    fireEvent.change(input('ze-offset-y'), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onResult).toHaveBeenCalledWith(true);
    expect(offset).toEqual({ x: 2.5 * MM, y: -1 * MM });
  });

  it('Cancel and Esc answer false and leave the vector', () => {
    const { dlg, offset } = make();
    const onResult = vi.fn();
    render(<DialogOffsetItem dialog={dlg} onResult={onResult} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onResult.mock.calls).toEqual([[false], [false]]);
    expect(offset).toEqual({ x: -10 * MM, y: 0 });
  });

  it('Reset puts the original back', () => {
    const { dlg } = make();
    render(<DialogOffsetItem dialog={dlg} onResult={() => {}} />);
    fireEvent.change(input('ze-offset-x'), { target: { value: '99' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset' })[0]!);
    expect(input('ze-offset-x').value).toBe('10');
  });
});
