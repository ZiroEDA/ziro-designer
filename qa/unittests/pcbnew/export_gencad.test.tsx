// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * File > Export > GenCAD...: DIALOG_GENCAD_EXPORT_OPTIONS
 * (`dialog_gencad_export_options.cpp`) and `BOARD_EDITOR_CONTROL::ExportGenCAD`
 * (`export_gencad.cpp`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KiDialogRequest } from '@ziroeda/common/kidialog.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import {
  DIALOG_GENCAD_EXPORT_OPTIONS,
  GENCAD_DO_NOT_SHOW_KEYS,
  GENCAD_EXPORT_OPT,
} from '@ziroeda/pcbnew/dialogs/dialog_gencad_export_options.js';
import { DialogGencadExportOptions } from '@ziroeda/pcbnew/dialogs/dialog_gencad_export_options_ui.js';
import { writeGenCad } from '@ziroeda/pcbnew/exporters/export_gencad_writer.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';

afterEach(() => cleanup());

const TEXT = readFileSync(
  resolve(__dirname, '../../data/pcbnew/resave/interf_u.kicad_pcb'),
  'utf8',
);

function dialogFrame(aExisting: string[] = [], aAnswer: 'ok' | 'cancel' = 'cancel') {
  const asked: KiDialogRequest[] = [];
  return {
    asked,
    frame: {
      GetBoardFileName: () => 'boards/interf_u.kicad_pcb',
      FileExists: (aPath: string) => aExisting.includes(aPath),
      ShowKiDialog: (aRequest: KiDialogRequest) => {
        asked.push(aRequest);
        return Promise.resolve(aAnswer);
      },
    },
  };
}

describe('DIALOG_GENCAD_EXPORT_OPTIONS', () => {
  it('starts on the board file name with a .cad extension, every option off', () => {
    const dlg = new DIALOG_GENCAD_EXPORT_OPTIONS(dialogFrame().frame, 'Export to GenCAD');
    dlg.TransferDataToWindow();

    expect(dlg.GetFileName()).toBe('boards/interf_u.cad');
    for (const opt of [0, 1, 2, 3, 4]) expect(dlg.GetOption(opt)).toBe(false);
  });

  it('keeps a name already typed', () => {
    const dlg = new DIALOG_GENCAD_EXPORT_OPTIONS(dialogFrame().frame, 'Export to GenCAD');
    dlg.m_outputFileName = 'out/x.cad';
    dlg.TransferDataToWindow();

    expect(dlg.GetFileName()).toBe('out/x.cad');
  });

  it('a new file is accepted without asking', async () => {
    const { frame, asked } = dialogFrame([]);
    const dlg = new DIALOG_GENCAD_EXPORT_OPTIONS(frame, 'Export to GenCAD');
    dlg.TransferDataToWindow();

    expect(await dlg.TransferDataFromWindow()).toBe(true);
    expect(asked).toEqual([]);
  });

  it('an existing file asks the KIDIALOG, Overwrite on OK, with a do-not-show key', async () => {
    const no = dialogFrame(['boards/interf_u.cad'], 'cancel');
    const dlgNo = new DIALOG_GENCAD_EXPORT_OPTIONS(no.frame, 'Export to GenCAD');
    dlgNo.TransferDataToWindow();
    expect(await dlgNo.TransferDataFromWindow()).toBe(false);

    const yes = dialogFrame(['boards/interf_u.cad'], 'ok');
    const dlgYes = new DIALOG_GENCAD_EXPORT_OPTIONS(yes.frame, 'Export to GenCAD');
    dlgYes.TransferDataToWindow();
    expect(await dlgYes.TransferDataFromWindow()).toBe(true);

    expect(no.asked).toEqual([
      {
        caption: 'Confirmation',
        message: 'File boards/interf_u.cad already exists.',
        icon: 'warning',
        labels: { ok: 'Overwrite' },
        doNotShowKey: GENCAD_DO_NOT_SHOW_KEYS.overwrite,
      },
    ]);
  });
});

describe('the dialog window', () => {
  it('lists the five options in GENCAD_EXPORT_OPT order and writes them back', () => {
    const dlg = new DIALOG_GENCAD_EXPORT_OPTIONS(dialogFrame().frame, 'Export to GenCAD');
    render(
      <DialogGencadExportOptions
        dialog={dlg}
        onBrowse={() => Promise.resolve(null)}
        onResult={vi.fn()}
      />,
    );

    const labels = [...document.querySelectorAll('.ze-gencad-opts label')].map(
      (l) => l.textContent,
    );
    expect(labels).toEqual([
      'Flip bottom footprint padstacks',
      'Generate unique pin names',
      'Generate a new shape for each footprint instance (do not reuse shapes)',
      'Use drill/place file origin as origin',
      'Save the origin coordinates in the file',
    ]);

    fireEvent.click(screen.getByLabelText('Generate unique pin names'));
    expect(dlg.GetOption(GENCAD_EXPORT_OPT.UNIQUE_PIN_NAMES)).toBe(true);
    expect((screen.getByLabelText('Output File:') as HTMLInputElement).value).toBe(
      'boards/interf_u.cad',
    );
  });

  it('Browse puts the chosen path in the field', async () => {
    const dlg = new DIALOG_GENCAD_EXPORT_OPTIONS(dialogFrame().frame, 'Export to GenCAD');
    render(
      <DialogGencadExportOptions
        dialog={dlg}
        onBrowse={() => Promise.resolve('fab/board.cad')}
        onResult={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Browse'));
    await new Promise((r) => setTimeout(r, 0));

    expect(dlg.GetFileName()).toBe('fab/board.cad');
  });
});

describe('BOARD_EDITOR_CONTROL::ExportGenCAD', () => {
  function frameWith(aConfigure: (d: DIALOG_GENCAD_EXPORT_OPTIONS) => boolean) {
    installPgm();
    const written: [string, string][] = [];
    const frame = new PCB_EDIT_FRAME({
      settings: () => new PCBNEW_SETTINGS(),
      onModify: () => {},
      showGencadExportOptionsDialog: (d: DIALOG_GENCAD_EXPORT_OPTIONS) => {
        d.TransferDataToWindow();
        return Promise.resolve(aConfigure(d));
      },
      writeTextFile: (aPath: string, aText: string) => {
        written.push([aPath, aText]);
        return true;
      },
    } as unknown as PCB_EDIT_FRAME_HOOKS);
    const board = ParseBoard(TEXT);
    board.SetFileName('interf_u.kicad_pcb');
    frame.SetBoard(board, false);
    return { frame, board, written };
  }

  const run = async (frame: PCB_EDIT_FRAME): Promise<void> => {
    frame.GetToolManager()!.RunAction(PCB_ACTIONS.exportGenCAD);
    await new Promise((r) => setTimeout(r, 0));
  };

  it('writes the GENCAD_EXPORTER text for the options chosen, to the chosen file', async () => {
    const { frame, board, written } = frameWith((d) => {
      d.SetOption(GENCAD_EXPORT_OPT.INDIVIDUAL_SHAPES, true);
      d.SetOption(GENCAD_EXPORT_OPT.UNIQUE_PIN_NAMES, true);
      return true;
    });
    await run(frame);

    expect(written.map(([p]) => p)).toEqual(['interf_u.cad']);
    expect(written[0]![1]).toBe(
      writeGenCad(board, { useIndividualShapes: true, useUniquePins: true }),
    );
  });

  it('the drill/place origin becomes the plot offset; stored when asked', async () => {
    const { frame, board, written } = frameWith((d) => {
      d.SetOption(GENCAD_EXPORT_OPT.USE_AUX_ORIGIN, true);
      d.SetOption(GENCAD_EXPORT_OPT.STORE_ORIGIN_COORDS, true);
      d.SetOption(GENCAD_EXPORT_OPT.FLIP_BOTTOM_PADS, true);
      return true;
    });
    await run(frame);
    const aux = board.GetDesignSettings().GetAuxOrigin();

    expect(aux).not.toEqual({ x: 0, y: 0 });
    expect(written[0]![1]).toBe(
      writeGenCad(board, { plotOffset: aux, storeOriginCoords: true, flipBottomPads: true }),
    );
  });

  it('Cancel writes nothing', async () => {
    const { frame, written } = frameWith(() => false);
    await run(frame);

    expect(written).toEqual([]);
  });
});
