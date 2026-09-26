// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The PCB editor threw "Pgm() called before the PGM_BASE was set" whenever it
 * was the first frame to open. `PCB_EDIT_FRAME::SetBoard` joins the board to
 * `Prj()`, which is `Pgm().GetSettingsManager().Prj()`, and PcbEditor called it
 * on its first render - while `installPgm()` ran only later, in the canvas
 * effect. KiCad's `PGM_BASE::InitPgm` runs before any frame exists.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SetPgm } from '@ziroeda/common/pgm_base.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { PCB_EDIT_FRAME } from '@ziroeda/designer/src/editors/pcb/pcb_edit_frame.js';

afterEach(() => SetPgm(null));

const makeFrame = () =>
  new PCB_EDIT_FRAME({
    settings: () => new PCBNEW_SETTINGS(),
    onModify: () => {},
    onUndoRedoIncomplete: () => {},
    createDrcDialog: () => {
      throw new Error('no DRC dialog here');
    },
    isSingle: () => true,
    fetchNetlistFromSchematic: () => false,
    schematicNetlistText: () => null,
    projectText: () => null,
    onEditItemRequest: () => {},
    showExchangeFootprintsDialog: () => {},
    findDialogRects: () => [],
    setViewCenter: () => {},
  });

describe('PCB_EDIT_FRAME needs the PGM_BASE before its first SetBoard', () => {
  it('reproduces the report: no PGM_BASE, and SetBoard throws', () => {
    SetPgm(null);
    expect(() => makeFrame().SetBoard(new BOARD(), false)).toThrow(
      'Pgm() called before the PGM_BASE was set',
    );
  });

  it('with the PGM_BASE installed first, SetBoard joins the board to the project', () => {
    SetPgm(null);
    installPgm();
    const frame = makeFrame();
    const board = new BOARD();
    frame.SetBoard(board, false);
    expect(board.GetProject()).toBe(frame.Prj());
  });

  it('PcbEditor installs it before it constructs the frame', () => {
    // qa cannot render PcbEditor, so this pins the order in its source: the
    // first installPgm() call comes before `new PCB_EDIT_FRAME(`.
    const src = readFileSync(
      resolve(process.cwd(), '../designer/src/editors/pcb/PcbEditor.tsx'),
      'utf8',
    );
    const install = src.indexOf('installPgm();');
    const construct = src.indexOf('new PCB_EDIT_FRAME(');
    expect(install).toBeGreaterThan(0);
    expect(construct).toBeGreaterThan(0);
    expect(install).toBeLessThan(construct);
  });
});

describe('PGM_BASE::InitPgm runs at program start, before any frame', () => {
  it('main.tsx installs it before the app renders', () => {
    const main = readFileSync(resolve(process.cwd(), '../designer/src/main.tsx'), 'utf8');
    const init = main.indexOf('InitPgm();');
    const render = main.indexOf('createRoot(');
    expect(init).toBeGreaterThan(0);
    expect(init).toBeLessThan(render);
  });

  it('is installed once, and the PCB editor builds on the same object', async () => {
    const { InitPgm } = await import('@ziroeda/designer/src/pgm_app.js');
    SetPgm(null);
    const first = InitPgm();
    expect(InitPgm()).toBe(first);
    expect(installPgm()).toBe(first);
  });
});
