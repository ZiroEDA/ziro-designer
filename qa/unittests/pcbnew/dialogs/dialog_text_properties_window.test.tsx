// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_TEXT_PROPERTIES's window (dialog_text_properties.cpp) on its base: what the constructor
 * shows for a board text and for a footprint's field, the auto-thickness button and the
 * bold / thickness coupling, Enter as OK, and the syntax help link.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GetPenSizeForBold, GetPenSizeForNormal } from '@ziroeda/common/gr_text.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { layerBoxName } from '@ziroeda/pcbnew/pcb_layer_box_selector.js';
import {
  DialogTextProperties,
  type TextValues,
  type TextWindowShape,
} from '@ziroeda/pcbnew/dialogs/dialog_text_properties.js';

afterEach(cleanup);

const MM = 1_000_000;

const VALUES: TextValues = {
  text: 'HELLO',
  face: '',
  x: 0,
  y: 0,
  orientation: 0,
  layer: 'F.SilkS',
  width: 1 * MM,
  height: 1 * MM,
  autoThickness: false,
  thickness: 0.15 * MM,
  bold: false,
  italic: false,
  mirrored: false,
  hJustify: 'center',
  vJustify: 'center',
  hidden: false,
  knockout: false,
  locked: false,
  keepUpright: true,
};

const BOARD_TEXT: TextWindowShape = {
  title: 'Text Properties',
  multiLine: true,
  textLabel: 'Reference designator:',
  posXLabel: 'Position X:',
  posYLabel: 'Position Y:',
  lockedShown: true,
  visibleShown: false,
  keepUprightShown: false,
  statusLine: null,
};

const REFERENCE: TextWindowShape = {
  title: 'Footprint Reference Properties',
  multiLine: false,
  textLabel: 'Reference:',
  posXLabel: 'Offset X:',
  posYLabel: 'Offset Y:',
  lockedShown: true,
  visibleShown: true,
  keepUprightShown: true,
  statusLine: 'Footprint R1 (10k), front side, rotated 0.0 deg',
};

/** The board the layer box names its layers off, as the frame's would. */
const BOARD_FOR_NAMES = new BOARD();

function show(aShape: TextWindowShape, aValues: Partial<TextValues> = {}) {
  const onApply = vi.fn();
  render(
    <DialogTextProperties
      initial={{ ...VALUES, ...aValues }}
      shape={aShape}
      units="mm"
      layers={['F.SilkS', 'Dwgs.User']}
      layerColor={() => '#fff'}
      layerLabel={(l: string) => layerBoxName(BOARD_FOR_NAMES, l)}
      onApply={onApply}
      onClose={() => {}}
    />,
  );
  return { onApply, applied: (): TextValues => onApply.mock.calls[0]![0] };
}

const textbox = (aName: string) => screen.getByRole('textbox', { name: aName }) as HTMLInputElement;
const ok = () => fireEvent.click(screen.getByRole('button', { name: 'OK' }));

describe('DIALOG_TEXT_PROPERTIES window', () => {
  it('names the layers as the board does - F.Silkscreen, User.Drawings - not F.SilkS (blinky555, I-11)', () => {
    // PCB_LAYER_BOX_SELECTOR -> PCB_LAYER_PRESENTATION::getLayerName -> BOARD::GetLayerName.
    show(BOARD_TEXT);
    expect(screen.getAllByText('F.Silkscreen').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('F.SilkS')).toEqual([]);
  });

  it('a board text has the multi-line control and no Show, Keep upright or status line', () => {
    show(BOARD_TEXT);
    expect(screen.getByText('Text Properties')).toBeTruthy();
    expect(textbox('Text').tagName).toBe('TEXTAREA');
    expect(screen.queryByLabelText('Show')).toBeNull();
    expect(screen.queryByLabelText('Keep upright')).toBeNull();
    expect(screen.getByText('Position X:')).toBeTruthy();
  });

  it('a footprint reference is the single line, with Offset, Show, Keep upright and its footprint', () => {
    show(REFERENCE);
    expect(screen.getByText('Footprint Reference Properties')).toBeTruthy();
    expect(textbox('Reference').tagName).toBe('INPUT');
    expect(screen.getByLabelText('Show')).toBeTruthy();
    expect(screen.getByLabelText('Keep upright')).toBeTruthy();
    expect(screen.getByText('Offset X:')).toBeTruthy();
    expect(screen.getByText('Footprint R1 (10k), front side, rotated 0.0 deg')).toBeTruthy();
  });

  it('Enter in the single line is OK, and Show writes back as not hidden', () => {
    const { applied } = show(REFERENCE);
    fireEvent.click(screen.getByLabelText('Show'));
    fireEvent.keyDown(textbox('Reference'), { key: 'Enter' });
    expect(applied().hidden).toBe(true);
  });

  it('auto thickness sets the pen from the size, disables the field, and follows a new size', () => {
    const { applied } = show(BOARD_TEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust the text thickness' }));
    expect(textbox('Thickness').disabled).toBe(true);
    fireEvent.change(textbox('Height'), { target: { value: '0.5' } });
    ok();
    expect(applied().autoThickness).toBe(true);
    expect(applied().thickness).toBe(GetPenSizeForNormal(0.5 * MM));
  });

  it('Bold sets the bold pen, and a thickness nearer the bold pen checks Bold', () => {
    const { applied } = show(BOARD_TEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    ok();
    expect(applied().bold).toBe(true);
    expect(applied().thickness).toBe(GetPenSizeForBold(1 * MM));

    cleanup();
    const second = show(BOARD_TEXT);
    fireEvent.change(textbox('Thickness'), {
      target: { value: String(GetPenSizeForBold(1 * MM) / MM) },
    });
    ok();
    expect(second.applied().bold).toBe(true);
  });

  it('the Syntax help link opens KiCad’s help table', () => {
    show(BOARD_TEXT);
    fireEvent.click(screen.getByText('Syntax help'));
    expect(screen.getByText('Syntax Help')).toBeTruthy();
  });
});
