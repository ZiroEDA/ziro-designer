// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/** DIALOG_ASSIGN_NETCLASS (common/dialogs/dialog_assign_netclass.cpp). */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DialogAssignNetclass,
  GetNetclassPatternForSet,
  matchingNets,
  UpgradeGlobStarToRegex,
} from '@ziroeda/common/dialogs/dialog_assign_netclass.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';
import { harnessCanvas } from '../pcbnew/support/pcb_tool_harness.js';

afterEach(cleanup);

describe('GetNetclassPatternForSet', () => {
  it('one net is itself', () => {
    expect(GetNetclassPatternForSet(new Set(['/USB_D+']))).toBe('/USB_D+');
  });

  it('several share their common prefix as prefix(a|b), natural-sorted', () => {
    expect(GetNetclassPatternForSet(new Set(['/SDA10', '/SDA2', '/SCL']))).toBe('/S(CL|DA2|DA10)');
  });

  it('a bare "/" prefix is not factored out', () => {
    expect(GetNetclassPatternForSet(new Set(['/A', '/B']))).toBe('/A|/B');
  });

  it('a glob star not after a dot becomes a regex star', () => {
    expect(UpgradeGlobStarToRegex('D*')).toBe('D.*');
    expect(UpgradeGlobStarToRegex('D.*')).toBe('D.*');
  });
});

describe('the matching report', () => {
  it('lists the candidates the pattern matches, anchored at both ends', () => {
    expect(matchingNets('GND', ['GND', 'AGND', 'GND2'])).toEqual(['GND']);
    expect(matchingNets('', ['GND'])).toEqual([]);
  });
});

describe('DialogAssignNetclass', () => {
  const dlg = (onOk = vi.fn(), frame: 'pcb' | 'schematic' = 'pcb') =>
    render(
      <DialogAssignNetclass
        frame={frame}
        netNames={new Set(['GND'])}
        candidateNetNames={['GND', 'VCC']}
        netClasses={['Power', 'Signal']}
        onOk={onOk}
        onCancel={() => {}}
      />,
    );

  it('proposes the pattern, picks the first non-Default class, and reports the matches', () => {
    const onOk = vi.fn();
    dlg(onOk);
    expect((screen.getByLabelText('Pattern') as HTMLInputElement).value).toBe('GND');
    expect(document.body.innerHTML).toContain('Currently matching nets:');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onOk).toHaveBeenCalledWith('GND', 'Power');
  });

  it('names the frame’s own Setup dialog in the note', () => {
    dlg(vi.fn(), 'pcb');
    expect(screen.getByText(/Board Setup > Project\./)).toBeTruthy();
    cleanup();
    dlg(vi.fn(), 'schematic');
    expect(screen.getByText(/Schematic Setup > Project\./)).toBeTruthy();
  });

  it('an empty pattern assigns nothing', () => {
    const onOk = vi.fn();
    dlg(onOk);
    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onOk).not.toHaveBeenCalled();
  });
});

describe('the board editor runs BOARD_EDITOR_CONTROL::AssignNetclass', () => {
  // BOARD_EDITOR_CONTROL::AssignNetclass (board_editor_control.cpp:2117-2190).
  const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
    (general (thickness 1.6) (legacy_teardrops no)) (paper "A4")
    (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
    (setup (pad_to_mask_clearance 0))
    (net 0 "") (net 1 "SIG") (net 2 "Net-(R1-Pad1)")
    (segment (start 0 0) (end 5 0) (width 0.25) (layer "F.Cu") (net 1))
    (segment (start 0 2) (end 5 2) (width 0.25) (layer "F.Cu") (net 1))
    (segment (start 0 4) (end 5 4) (width 0.25) (layer "F.Cu") (net 2)))`;

  const frameWith = () => {
    installPgm();
    const settings = new PCBNEW_SETTINGS();
    const errors: string[] = [];
    const dialogs: { names: string[]; preview: (n: readonly string[]) => void }[] = [];
    let answer = true;
    const frame = new PCB_EDIT_FRAME({
      settings: () => settings,
      onModify: () => {},
      showInfoBarError: (aMsg: string) => errors.push(aMsg),
      showAssignNetclassDialog: (
        aNames: ReadonlySet<string>,
        _aCandidates: ReadonlySet<string>,
        aPreview: (n: readonly string[]) => void,
      ) => {
        dialogs.push({ names: [...aNames], preview: aPreview });
        return Promise.resolve(answer);
      },
    } as unknown as PCB_EDIT_FRAME_HOOKS);
    const board = ParseBoard(BOARD_TEXT);
    // OnBoardLoaded's connectivity: SelectAllItemsOnNet walks it.
    board.BuildConnectivity();
    frame.SetBoard(board, false);
    // The frame's canvas: RequestSelection's collector guide asks the VIEW.
    const { view, controls } = harnessCanvas(board, frame, {
      mouse: { x: -1e9, y: -1e9 },
      forced: null,
    });
    frame.GetToolManager()!.SetEnvironment(board, view, controls, settings as never, frame);
    const run = (aIndex: number): void => {
      const sel = frame.GetSelectionTool();
      sel.ClearSelection(true);
      sel.AddItemToSel(board.Tracks()[aIndex]!, true);
      frame.GetToolManager()!.RunAction(PCB_ACTIONS.assignNetClass);
    };
    return { frame, board, errors, dialogs, run, setAnswer: (a: boolean) => (answer = a) };
  };

  it('refuses a selection whose nets are all auto-generated', () => {
    const h = frameWith();
    h.run(2);
    expect(h.errors).toEqual(['Selection contains no items with labeled nets.']);
    expect(h.dialogs).toEqual([]);
  });

  it('selects the nets, opens on their names, and its previewer selects a net', () => {
    const h = frameWith();
    h.run(0);
    expect(h.dialogs.map((d) => d.names)).toEqual([['SIG']]);
    // RunAction( selectNet, code ): both SIG tracks.
    expect(h.frame.GetSelectionTool().GetSelection().Size()).toBe(2);

    h.dialogs[0]!.preview(['Net-(R1-Pad1)']);
    // By uuid: a failed comparison of the items themselves prints the whole board.
    const items = h.frame.GetSelectionTool().GetSelection().Items();
    expect(items.map((i) => i.m_Uuid)).toEqual([h.board.Tracks()[2]!.m_Uuid]);
  });

  it('resynchronises the nets with their classes after OK, and not after Cancel', async () => {
    const h = frameWith();
    const sync = vi.spyOn(h.board, 'SynchronizeNetsAndNetClasses');
    h.setAnswer(false);
    h.run(0);
    await Promise.resolve();
    expect(sync).not.toHaveBeenCalled();
    h.setAnswer(true);
    h.run(0);
    await Promise.resolve();
    expect(sync).toHaveBeenCalledWith(false);
  });
});
