// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_DIMENSION_PROPERTIES's window (dialog_dimension_properties.cpp) on its base, over live
 * dimensions: the boxes the constructor leaves per type, the override / preview / position-mode /
 * keep-aligned bindings, and the base's choice lists.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  DIALOG_DIMENSION_PROPERTIES,
  DialogDimensionProperties,
  type DimensionValues,
} from '@ziroeda/pcbnew/dialogs/dialog_dimension_properties.js';
import type { PCB_DIMENSION_BASE } from '@ziroeda/pcbnew/pcb_dimension.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

afterEach(cleanup);

/** Verbatim from demos/cm5_minima. */
const ORTHO = `(dimension
    (type orthogonal)
    (layer "Dwgs.User")
    (uuid "5db1e4c4-a4eb-4089-b0a3-868253fe7188")
    (pts (xy 113.6 58.975) (xy 113.35 28.975))
    (height 12.85)
    (orientation 1)
    (format (prefix "") (suffix "") (units 2) (units_format 1) (precision 4)
      (suppress_zeroes yes))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (arrow_direction outward) (extension_height 0.58642) (extension_offset 0.5)
      (keep_text_aligned yes))
    (gr_text "30" (at 125.3 43.975 90) (layer "Dwgs.User")
      (uuid "5db1e4c4-a4eb-4089-b0a3-868253fe7188")
      (effects (font (size 1 1) (thickness 0.15)))))`;

const LEADER = `(dimension
    (type leader)
    (layer "Cmts.User")
    (uuid "bd892614-315c-4158-b663-af4718d7e6a1")
    (pts (xy 152.94971 67.310695) (xy 156.29971 63.960695))
    (format (prefix "") (suffix "") (units 0) (units_format 0) (precision 4)
      (override_value "0.3mm Thickness"))
    (style (thickness 0.1) (arrow_length 1.27) (text_position_mode 0)
      (text_frame 0) (extension_offset 0.5))
    (gr_text "0.3mm Thickness" (at 168.99971 63.960695 0) (layer "Cmts.User")
      (uuid "bd892614-315c-4158-b663-af4718d7e6a1")
      (effects (font (size 1 1) (thickness 0.15)))))`;

const read = (aDimension: string): BOARD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen")
    (17 "Dwgs.User" user "User.Drawings") (19 "Cmts.User" user "User.Comments"))
  (net 0 "")
  ${aDimension}
)`);

function show(aDimension: string) {
  const board = read(aDimension);
  const dialog = new DIALOG_DIMENSION_PROPERTIES(
    new TEST_PCB_FRAME(board),
    board.Drawings()[0] as PCB_DIMENSION_BASE,
  );
  const onApply = vi.fn();
  render(
    <DialogDimensionProperties
      dialog={dialog}
      units="mm"
      layers={['Dwgs.User', 'Cmts.User']}
      layerColor={() => '#fff'}
      layerLabel={(l: string) => l}
      onApply={onApply}
      onClose={() => {}}
    />,
  );
  return (): DimensionValues => {
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    return onApply.mock.calls[0]![0];
  };
}

const textbox = (aName: string) => screen.getByRole('textbox', { name: aName }) as HTMLInputElement;

describe('DIALOG_DIMENSION_PROPERTIES window', () => {
  it('an orthogonal dimension shows Format, Text and Line, not Leader Format', () => {
    show(ORTHO);
    expect(screen.getByText('Dimension Format')).toBeTruthy();
    expect(screen.getByText('Dimension Text')).toBeTruthy();
    expect(screen.getByText('Dimension Line')).toBeTruthy();
    expect(screen.queryByText('Leader Format')).toBeNull();
    expect(screen.getByText('Extension line overshoot:')).toBeTruthy();
  });

  it('a leader shows its own box, with its override in the leader text, and no position mode', () => {
    show(LEADER);
    expect(screen.getByText('Leader Format')).toBeTruthy();
    expect(textbox('Leader text').value).toBe('0.3mm Thickness');
    expect(screen.queryByText('Position mode:')).toBeNull();
    expect(screen.queryByText('Extension line overshoot:')).toBeNull();
  });

  it('Value is the measurement until Override value is checked', () => {
    const ok = show(ORTHO);
    expect(textbox('Value').disabled).toBe(true);
    expect(textbox('Value').value).toBe('30');
    fireEvent.click(screen.getByLabelText('Override value'));
    expect(textbox('Value').disabled).toBe(false);
    fireEvent.change(textbox('Value'), { target: { value: 'REF' } });
    expect(ok().overrideValue).toBe('REF');
  });

  it('the preview is the dimension with the dialog’s prefix and suffix', () => {
    show(ORTHO);
    fireEvent.change(textbox('Prefix'), { target: { value: 'L=' } });
    fireEvent.change(textbox('Suffix'), { target: { value: ' max' } });
    expect(screen.getByText('L=30 mm max')).toBeTruthy();
  });

  it('Keep aligned greys the orientation, and the position follows Manual', () => {
    show(ORTHO);
    expect(textbox('Orientation').disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Keep aligned with dimension'));
    expect(textbox('Orientation').disabled).toBe(false);
    expect(textbox('Position X').disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Position mode' }));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Manual' }));
    expect(textbox('Position X').disabled).toBe(false);
  });

  it('Precision offers the base’s ten entries, and Text frame its three', () => {
    show(ORTHO);
    fireEvent.click(screen.getByRole('button', { name: 'Precision' }));
    expect(screen.getAllByRole('option')).toHaveLength(10);
    cleanup();
    show(LEADER);
    const frame = screen.getByRole('button', { name: 'Text frame' });
    fireEvent.click(frame);
    expect(
      within(document.body)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['None', 'Rectangle', 'Circle']);
  });
});
