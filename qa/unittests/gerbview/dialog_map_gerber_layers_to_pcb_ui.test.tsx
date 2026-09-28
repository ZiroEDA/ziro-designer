// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The two GerbView layer dialogs drawn: DIALOG_MAP_GERBER_LAYERS_TO_PCB_BASE
 * (`dialog_map_gerber_layers_to_pcb_base.cpp`) and SELECT_LAYER_DIALOG
 * (`dialog_select_one_pcb_layer.cpp`), over their engine halves, plus the
 * `wxOK | wxCANCEL` KICAD_MESSAGE_DIALOG the map dialog asks first.
 *
 * The engine's behaviour is pinned in gerbview_frame.test.ts; this pins that
 * the page shows it and that each control reaches its handler.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageDialogOkCancel } from '@ziroeda/common/dialogs/dialog_message.js';
import { DIALOG_MAP_GERBER_LAYERS_TO_PCB } from '@ziroeda/gerbview/dialogs/dialog_map_gerber_layers_to_pcb.js';
import { DialogMapGerberLayersToPcb } from '@ziroeda/gerbview/dialogs/dialog_map_gerber_layers_to_pcb_ui.js';
import { SELECT_LAYER_DIALOG } from '@ziroeda/gerbview/dialogs/dialog_select_one_pcb_layer.js';
import { DialogSelectOnePcbLayer } from '@ziroeda/gerbview/dialogs/dialog_select_one_pcb_layer_ui.js';
import type { GERBVIEW_FRAME } from '@ziroeda/gerbview/gerbview_frame.js';
import { GERBVIEW_SETTINGS } from '@ziroeda/gerbview/gerbview_settings.js';

afterEach(cleanup);

/** Just what the dialog asks of its parent: two loaded files, no X2, no known names. */
function fakeFrame(aMessages: string[]): GERBVIEW_FRAME {
  const cfg = new GERBVIEW_SETTINGS();
  const files = ['/tmp/one.xyz', '/tmp/two.xyz'];
  const images = {
    GetGbrImage: (i: number) =>
      i < files.length ? { m_FileName: files[i], m_FileFunction: null, m_IsX2_file: false } : null,
  };

  return {
    gvconfig: () => cfg,
    GetGerberLayout: () => ({ GetImagesList: () => images }),
    Host: () => ({
      MessageBox: (m: string) => {
        aMessages.push(m);
        return Promise.resolve();
      },
      OkCancelMessageDialog: () => Promise.resolve(false),
    }),
    SelectPCBLayer: (aDefault: number) => Promise.resolve(aDefault === -2 ? 0 : aDefault),
  } as unknown as GERBVIEW_FRAME;
}

describe('DialogMapGerberLayersToPcb', () => {
  let messages: string[];
  let dlg: DIALOG_MAP_GERBER_LAYERS_TO_PCB;

  beforeEach(async () => {
    DIALOG_MAP_GERBER_LAYERS_TO_PCB.m_exportBoardCopperLayersCount = 2;
    messages = [];
    dlg = new DIALOG_MAP_GERBER_LAYERS_TO_PCB(fakeFrame(messages));
    await dlg.initDialog();
  });

  it('is titled "Layer Selection" and draws one row per file', () => {
    render(<DialogMapGerberLayersToPcb dlg={dlg} onClose={() => {}} />);

    expect(screen.getByRole('dialog', { name: 'Layer Selection' })).toBeTruthy();
    expect(screen.getByText('Layer 1:')).toBeTruthy();
    expect(screen.getByText('two.xyz')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '...' })).toHaveLength(2);
    const mapped = screen.getAllByText('Do not export');
    expect(mapped.map((e) => e.classList.contains('blue'))).toEqual([true, true]);
  });

  it('greys Get Stored Choice until Store Choice is pressed', () => {
    render(<DialogMapGerberLayersToPcb dlg={dlg} onClose={() => {}} />);
    const get = screen.getByRole('button', { name: 'Get Stored Choice' }) as HTMLButtonElement;

    expect(get.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Store Choice' }));
    expect(get.disabled).toBe(false);
  });

  it('"..." runs OnSelectLayer and repaints the row in fuchsia', async () => {
    render(<DialogMapGerberLayersToPcb dlg={dlg} onClose={() => {}} />);

    fireEvent.click(screen.getAllByRole('button', { name: '...' })[1]!);

    const row = await screen.findByText('F.Cu');
    expect(row.classList.contains('fuchsia')).toBe(true);
  });

  it('Reset repaints every row "Do not export"', async () => {
    render(<DialogMapGerberLayersToPcb dlg={dlg} onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: '...' })[0]!);
    await screen.findByText('F.Cu');

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getAllByText('Do not export')).toHaveLength(2);
  });

  it('OK closes only when TransferDataFromWindow allows it; Cancel closes', () => {
    const onClose = vi.fn();
    render(<DialogMapGerberLayersToPcb dlg={dlg} onClose={onClose} />);

    dlg.m_layersLookUpTable[0] = 6; // In2.Cu on a 2-layer board
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(messages).toHaveLength(1);

    dlg.m_layersLookUpTable[0] = 0;
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose.mock.calls).toEqual([[true], [false]]);
  });
});

describe('DialogSelectOnePcbLayer', () => {
  const make = (aDefault: number): SELECT_LAYER_DIALOG =>
    new SELECT_LAYER_DIALOG({} as GERBVIEW_FRAME, aDefault, 2, '"a.gbr"');

  it('titles itself with the file, and lays the radio box out in 12 rows', () => {
    const { container } = render(<DialogSelectOnePcbLayer dlg={make(-2)} onClose={() => {}} />);

    expect(screen.getByRole('dialog', { name: 'Select Layer: "a.gbr"' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(22);
    const grid = container.ownerDocument.querySelector('.ze-selectlayer-grid') as HTMLElement;
    expect(grid.style.gridTemplateRows).toBe('repeat(12, auto)');
    expect((screen.getByRole('radio', { name: 'Do not export' }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('picking a radio button is OK, with that layer (:163-166)', () => {
    const dlg = make(-2);
    const onClose = vi.fn();
    render(<DialogSelectOnePcbLayer dlg={dlg} onClose={onClose} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Edge.Cuts' }));

    expect(onClose.mock.calls).toEqual([[true]]);
    expect(dlg.GetSelectedLayer()).toBe(25);
  });

  it('Cancel keeps the default layer', () => {
    const dlg = make(2);
    const onClose = vi.fn();
    render(<DialogSelectOnePcbLayer dlg={dlg} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose.mock.calls).toEqual([[false]]);
    expect(dlg.GetSelectedLayer()).toBe(2);
  });
});

describe('MessageDialogOkCancel', () => {
  it('GTK order, Cancel then OK, OK the default; each answers its own way', () => {
    const onResult = vi.fn();
    render(
      <MessageDialogOkCancel
        caption="Automatic Layer Assignment"
        message="m"
        onResult={onResult}
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Cancel', 'OK']);
    expect(buttons[1]!.classList.contains('primary')).toBe(true);

    fireEvent.click(buttons[1]!);
    fireEvent.click(buttons[0]!);
    expect(onResult.mock.calls).toEqual([[true], [false]]);
  });
});
