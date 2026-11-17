// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_SHAPE_PROPERTIES's window (dialog_shape_properties.cpp) on its base: the notebook the
 * shape type keeps, a typed control rewriting the other pages, Rounded rectangle and its radius,
 * the technical-layers greying, and the Error List.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  DIALOG_SHAPE_PROPERTIES,
  DialogShapeProperties,
} from '@ziroeda/pcbnew/dialogs/dialog_shape_properties.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

afterEach(cleanup);

let board: BOARD;

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  (gr_rect (start 0 0) (end 10 6) (stroke (width 0.2) (type solid)) (fill no) (layer "F.SilkS")
    (uuid "00000000-0000-4000-8000-000000000001"))
  (gr_line (start 0 10) (end 10 10) (stroke (width 0.2) (type solid)) (layer "F.Cu")
    (uuid "00000000-0000-4000-8000-000000000002"))
)`);
});

function show(aIndex: number) {
  const dialog = new DIALOG_SHAPE_PROPERTIES(
    new TEST_PCB_FRAME(board),
    board.Drawings()[aIndex] as PCB_SHAPE,
  );
  const onApplied = vi.fn();
  render(
    <DialogShapeProperties
      dialog={dialog}
      layers={['F.Cu', 'F.SilkS']}
      layerColor={() => '#fff'}
      layerLabel={(l: string) => l}
      onApplied={onApplied}
      onClose={() => {}}
    />,
  );
  return { onApplied };
}

const panel = (aTab: string) => {
  const tab = screen.getByRole('tab', { name: aTab });
  const panels = screen.getAllByRole('tabpanel');
  const tabs = screen.getAllByRole('tab');
  return panels[tabs.indexOf(tab)]!;
};

describe('DIALOG_SHAPE_PROPERTIES window', () => {
  it('a rectangle keeps its three pages, titled by its friendly name', () => {
    show(0);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'By Corners',
      'By Corner and Size',
      'By Center and Size',
    ]);
    expect(screen.getByText('Rectangle Properties')).toBeTruthy();
    expect(screen.getByText('Fill:')).toBeTruthy();
  });

  it('an end point typed on By Corners rewrites By Corner and Size', () => {
    show(0);
    const corners = within(panel('By Corners'));
    fireEvent.change(corners.getAllByRole('textbox', { name: 'X:' })[1]!, {
      target: { value: '14' },
    });
    const size = within(panel('By Corner and Size'));
    expect((size.getAllByRole('textbox', { name: 'X:' })[1] as HTMLInputElement).value).toBe('14');
  });

  it('a line has no Fill and no Rounded rectangle', () => {
    show(1);
    expect(screen.queryByText('Fill:')).toBeNull();
    expect(screen.queryByLabelText('Rounded rectangle')).toBeNull();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'By Endpoints',
      'By Length and Angle',
      'By Start/Midpoint',
    ]);
  });

  it('a corner radius checks Rounded rectangle, and unchecking empties it', () => {
    show(0);
    const radius = () => screen.getByRole('textbox', { name: 'Corner radius' }) as HTMLInputElement;
    const rounded = () => screen.getByLabelText('Rounded rectangle') as HTMLInputElement;
    fireEvent.change(radius(), { target: { value: '1' } });
    expect(rounded().checked).toBe(true);
    fireEvent.click(rounded());
    expect(radius().value).toBe('');
  });

  it('Solder mask lives on outer copper only, and its expansion with it', () => {
    show(1);
    const mask = () => screen.getByLabelText('Solder mask') as HTMLInputElement;
    const expansion = () => screen.getByRole('textbox', { name: 'Expansion' }) as HTMLInputElement;
    expect(mask().disabled).toBe(false);
    expect(expansion().disabled).toBe(true);
    fireEvent.click(mask());
    expect(expansion().disabled).toBe(false);
  });

  it('OK on a zero-width unfilled rectangle raises the Error List and applies nothing', () => {
    const { onApplied } = show(0);
    fireEvent.change(screen.getByRole('textbox', { name: 'Line width' }), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByText('Error List')).toBeTruthy();
    expect(
      screen.getByText('Line width must be greater than zero for an unfilled rectangle.'),
    ).toBeTruthy();
    expect(onApplied).not.toHaveBeenCalled();
  });
});
