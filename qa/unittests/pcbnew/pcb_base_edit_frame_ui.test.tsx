// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `usePcbItemDialogs` (`pcbnew/pcb_base_edit_frame_ui.tsx`): the window
 * half of PCB_BASE_EDIT_FRAME's `Show…Dialog` methods, shared by every
 * PCB_BASE_EDIT_FRAME window. Each hook draws its dialog on the live item;
 * Cancel answers false and writes nothing, OK runs the model's
 * TransferDataFromWindow.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { DIALOG_PAD_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_pad_properties.js';
import { DIALOG_TEXT_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_text_properties.js';
import { FOOTPRINT_EDIT_FRAME } from '@ziroeda/pcbnew/footprint_edit_frame.js';
import { FOOTPRINT_LIBRARY_STORE } from '@ziroeda/pcbnew/footprint_library_adapter.js';
import { usePcbItemDialogs } from '@ziroeda/pcbnew/pcb_base_edit_frame_ui.js';
import { attachFootprintFrameCanvas } from './support/footprint_frame_canvas.js';

afterEach(cleanup);

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const FP = `(footprint "R" (layer "F.Cu") (uuid "${U(10)}")
  (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS") (uuid "${U(11)}"))
  (property "Value" "R" (at 0 1 0) (layer "F.Fab") (uuid "${U(12)}"))
  (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (uuid "${U(13)}")))`;

let frame: FOOTPRINT_EDIT_FRAME;
let hooks: ReturnType<typeof usePcbItemDialogs>['hooks'];
let pointEntry: ReturnType<typeof usePcbItemDialogs>['pointEntry'];

function Host(): JSX.Element {
  const dialogs = usePcbItemDialogs({
    units: 'mm',
    board: () => frame.GetBoard(),
    layerColor: () => '#ffffff',
    background: '#000000',
  });
  hooks = dialogs.hooks;
  pointEntry = dialogs.pointEntry;
  return <>{dialogs.node}</>;
}

beforeEach(async () => {
  const store = new FOOTPRINT_LIBRARY_STORE({
    footprintText: () => Promise.reject(new Error('none')),
    flipLeftRight: () => false,
  });
  store.AddProjectLibrary('Lib', 'Lib.pretty', [{ fileName: 'R.kicad_mod', text: FP }]);
  frame = new FOOTPRINT_EDIT_FRAME({ fpEdit: () => {} });
  frame.SetFootprintLibAdapter(store);
  attachFootprintFrameCanvas(frame);
  await frame.LoadFootprintFromLibrary(new LIB_ID('Lib', 'R'));
});

const button = (aLabel: string): HTMLButtonElement =>
  Array.from(document.querySelectorAll('.ze-modal button')).find(
    (b) => b.textContent === aLabel,
  ) as HTMLButtonElement;

describe('usePcbItemDialogs', () => {
  it('the text dialog: Cancel answers false and leaves the field alone', async () => {
    render(<Host />);
    const field = frame.GetBoard()!.GetFirstFootprint()!.GetFields()[0]!;
    let answer: Promise<boolean> | null = null;

    act(() => {
      answer = hooks.showTextPropertiesDialog(new DIALOG_TEXT_PROPERTIES(frame, field));
    });
    expect(document.querySelector('.ze-modal')).not.toBeNull();

    act(() => fireEvent.click(button('Cancel')));

    expect(await answer!).toBe(false);
    expect(document.querySelector('.ze-modal')).toBeNull();
    expect(field.GetText()).toBe('R1');
  });

  it('the text dialog: OK answers what TransferDataFromWindow answered', async () => {
    render(<Host />);
    const field = frame.GetBoard()!.GetFirstFootprint()!.GetFields()[0]!;
    let answer: Promise<boolean> | null = null;

    act(() => {
      answer = hooks.showTextPropertiesDialog(new DIALOG_TEXT_PROPERTIES(frame, field));
    });
    act(() => fireEvent.click(button('OK')));

    expect(await answer!).toBe(true);
    expect(document.querySelector('.ze-modal')).toBeNull();
  });

  it("the text dialog's layer box names the field's layer as the board does (blinky555, I-11)", () => {
    // F.SilkS is the Reference's layer; the board calls it F.Silkscreen
    // (PCB_LAYER_PRESENTATION::getLayerName -> BOARD::GetLayerName).
    render(<Host />);
    const field = frame.GetBoard()!.GetFirstFootprint()!.GetFields()[0]!;
    act(() => {
      void hooks.showTextPropertiesDialog(new DIALOG_TEXT_PROPERTIES(frame, field));
    });
    const modal = document.querySelector('.ze-modal')!;
    expect(modal.textContent).toContain('F.Silkscreen');
    expect(modal.textContent).not.toContain('F.SilkS ');
    act(() => fireEvent.click(button('Cancel')));
  });

  it('the pad dialog opens on the live pad and closes on Cancel', () => {
    render(<Host />);
    const pad = frame.GetBoard()!.GetFirstFootprint()!.Pads()[0]!;

    act(() => hooks.showPadPropertiesDialog(new DIALOG_PAD_PROPERTIES(frame, pad)));
    expect(document.querySelector('.ze-modal')).not.toBeNull();

    act(() => fireEvent.click(button('Cancel')));
    expect(document.querySelector('.ze-modal')).toBeNull();
  });
});

describe('the point-entry presenter (COMMON_TOOLS::GridOrigin)', () => {
  it('opens WX_PT_ENTRY_DIALOG with its title and value, and resolves with the point typed', async () => {
    render(<Host />);
    let answer: { x: number; y: number } | null | undefined;
    act(() => {
      void pointEntry('Grid Origin', 'X:', 'Y:', { x: 1_000_000, y: 2_000_000 }, true).then(
        (v) => (answer = v),
      );
    });
    expect(document.body.textContent).toContain('Grid Origin');
    const x = screen.getByRole('textbox', { name: 'X:' }) as HTMLInputElement;
    expect(x.value).toBe('1');
    fireEvent.change(x, { target: { value: '3' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    });
    expect(answer).toEqual({ x: 3_000_000, y: 2_000_000 });
  });
});
