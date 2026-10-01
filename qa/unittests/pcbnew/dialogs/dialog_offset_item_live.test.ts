// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_OFFSET_ITEM (pcbnew/dialogs/dialog_offset_item.cpp). KiCad has no qa
 * for it; each expectation is read off the C++ line it cites.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DIALOG_OFFSET_ITEM } from '@ziroeda/pcbnew/dialogs/dialog_offset_item.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = 1_000_000;

let frame: TEST_PCB_FRAME;
let offset: { x: number; y: number };
let dlg: DIALOG_OFFSET_ITEM;

function make(aOffset: { x: number; y: number }, units: 'mm' | 'in' | 'mils' = 'mm'): void {
  frame = new TEST_PCB_FRAME(
    ParseBoard(
      '(kicad_pcb (version 20241229) (generator "t") (layers (0 "F.Cu" signal) (2 "B.Cu" signal)))',
    ),
  );
  frame.SetUserUnits(units);
  offset = aOffset;
  dlg = new DIALOG_OFFSET_ITEM(frame, offset);
}

beforeEach(() => make({ x: -10 * MM, y: 0 }));

describe('DIALOG_OFFSET_ITEM controls (dialog_offset_item_base.cpp)', () => {
  it('starts with polar ticked and "Offset X:" / "Offset Y:" until the data is transferred', () => {
    expect(dlg.m_polarCoords).toBe(true);
    expect(dlg.GetXLabel()).toBe('Offset X:');
    expect(dlg.GetYLabel()).toBe('Offset Y:');
    expect(dlg.m_xOffset.GetText()).toBe('0');
    expect(dlg.m_yOffset.GetText()).toBe('0');
  });

  it('TransferDataToWindow shows the original offset in polar form (:129-140)', () => {
    dlg.TransferDataToWindow();
    expect(dlg.GetXLabel()).toBe('Distance:');
    expect(dlg.GetYLabel()).toBe('Angle:');
    expect(dlg.GetYUnitLabel()).toBe('°');
    // (-10 mm, 0) is 10 mm at 180 degrees (ToPolar: EDA_ANGLE( VECTOR2D( x, y ) ) is -180
    // for a vector along -x with y == 0); pcbnew shows a relative angle negated (:76)
    expect(dlg.m_xOffset.GetText()).toBe('10');
    expect(dlg.m_yOffset.GetText()).toBe('180');
  });

  it('with polar unticked it shows x and y, in the frame units (:129-132)', () => {
    make({ x: 3 * MM, y: 4 * MM }, 'mils');
    dlg.m_polarCoords = false;
    dlg.TransferDataToWindow();
    expect(dlg.m_xOffset.GetText()).toBe('118.11024');
    expect(dlg.m_yOffset.GetText()).toBe('157.48031');
    expect(dlg.GetXUnitLabel()).toBe('mils');
  });

  it('unticking polar gives Offset X/Y, in the frame units (:104-113)', () => {
    dlg.TransferDataToWindow();
    dlg.OnPolarChanged(false);
    expect(dlg.GetXLabel()).toBe('Offset X:');
    expect(dlg.GetYUnitLabel()).toBe('mm');
    expect(dlg.m_clearXToolTip).toBe('Reset to the current X offset from the reference position.');
    expect(dlg.m_clearYToolTip).toBe('Reset to the current Y offset from the reference position.');
  });
});

describe('DIALOG_OFFSET_ITEM::TransferDataFromWindow (:142-160)', () => {
  it("writes the offset back into the caller's vector, polar (:145-151)", () => {
    dlg.TransferDataToWindow();
    expect(dlg.TransferDataFromWindow()).toBe(true);
    expect(offset).toEqual({ x: -10 * MM, y: 0 });
  });

  it('a typed polar offset becomes the vector it describes', () => {
    dlg.TransferDataToWindow();
    dlg.SetEntryText(dlg.m_xOffset, '2');
    // a displayed angle of 90 is counter-clockwise on screen: up the Y-down board
    dlg.SetEntryText(dlg.m_yOffset, '90');
    dlg.TransferDataFromWindow();
    expect(offset).toEqual({ x: 0, y: -2 * MM });
  });

  it('a typed Cartesian offset is read as IU (:153-156)', () => {
    dlg.TransferDataToWindow();
    dlg.OnPolarChanged(false);
    dlg.SetEntryText(dlg.m_xOffset, '1.5');
    dlg.SetEntryText(dlg.m_yOffset, '-2');
    dlg.TransferDataFromWindow();
    expect(offset).toEqual({ x: 1.5 * MM, y: -2 * MM });
  });

  it('the original is kept: Reset goes back to it, not to what was written (:46)', () => {
    dlg.TransferDataToWindow();
    dlg.OnPolarChanged(false);
    dlg.SetEntryText(dlg.m_xOffset, '5');
    dlg.TransferDataFromWindow();
    dlg.OnClear('x');
    expect(dlg.m_xOffset.GetText()).toBe('-10');
  });
});

describe('DIALOG_OFFSET_ITEM::OnClear (:46-78)', () => {
  it('Reset X in polar mode shows the original distance, Y the original angle', () => {
    dlg.TransferDataToWindow();
    dlg.SetEntryText(dlg.m_xOffset, '99');
    dlg.SetEntryText(dlg.m_yOffset, '12');
    dlg.OnClear('x');
    dlg.OnClear('y');
    expect(dlg.m_xOffset.GetText()).toBe('10');
    expect(dlg.m_yOffset.GetText()).toBe('180');
  });

  it('Reset in Cartesian mode shows the original x and y', () => {
    make({ x: 3 * MM, y: 4 * MM });
    dlg.TransferDataToWindow();
    dlg.OnPolarChanged(false);
    dlg.SetEntryText(dlg.m_xOffset, '99');
    dlg.SetEntryText(dlg.m_yOffset, '99');
    dlg.OnClear('x');
    dlg.OnClear('y');
    expect(dlg.m_xOffset.GetText()).toBe('3');
    expect(dlg.m_yOffset.GetText()).toBe('4');
  });
});

describe('DIALOG_OFFSET_ITEM::OnPolarChanged (:80-127)', () => {
  it('Cartesian to polar and back keeps the distance (:84-100)', () => {
    make({ x: 3 * MM, y: 4 * MM });
    dlg.m_polarCoords = false;
    dlg.TransferDataToWindow();
    dlg.OnPolarChanged(true);
    expect(dlg.m_xOffset.GetText()).toBe('5');
    expect(dlg.m_yOffset.GetText()).toBe('-53.1301');
  });

  it('an unchanged pair restores the remembered values (:92-96)', () => {
    dlg.TransferDataToWindow();
    dlg.SetEntryText(dlg.m_xOffset, '10');
    dlg.SetEntryText(dlg.m_yOffset, '400');
    dlg.OnPolarChanged(false);
    dlg.OnPolarChanged(true);
    expect(dlg.m_yOffset.GetText()).toBe('-400');
  });
});

describe('DIALOG_OFFSET_ITEM::OnPolarChanged, one entry changed (:84)', () => {
  it('a change of x alone is enough to recompute, and so is a change of y alone', () => {
    dlg.OnPolarChanged(false);
    dlg.SetEntryText(dlg.m_xOffset, '3');
    dlg.SetEntryText(dlg.m_yOffset, '0');
    dlg.OnPolarChanged(true);
    expect(dlg.m_xOffset.GetText()).toBe('3');
    dlg.OnPolarChanged(false);
    dlg.SetEntryText(dlg.m_xOffset, '0');
    dlg.SetEntryText(dlg.m_yOffset, '3');
    dlg.OnPolarChanged(true);
    expect(dlg.m_xOffset.GetText()).toBe('3');
  });
});

describe('DIALOG_OFFSET_ITEM::OnTextFocusLost (:38-45)', () => {
  it('an entry left blank is reset to 0', () => {
    dlg.SetEntryText(dlg.m_yOffset, '');
    dlg.OnTextFocusLost(dlg.m_yOffset);
    expect(dlg.m_yOffset.GetText()).toBe('0');
  });

  it('an entry with text is left alone', () => {
    dlg.SetEntryText(dlg.m_yOffset, '7');
    dlg.OnTextFocusLost(dlg.m_yOffset);
    expect(dlg.m_yOffset.GetText()).toBe('7');
  });
});
