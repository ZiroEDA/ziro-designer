// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * File > Fabrication Outputs: BOARD_EDITOR_CONTROL::GenerateDrillFiles and
 * GeneratePosFile (bound in board_editor_control.cpp:2311-2312) open their
 * dialogs modally through the frame.
 */
import { describe, expect, it } from 'vitest';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';

function frame(aShown: string[]): PCB_EDIT_FRAME {
  installPgm();
  const settings = new PCBNEW_SETTINGS();
  const f = new PCB_EDIT_FRAME({
    settings: () => settings,
    onModify: () => {},
    showGenDrillDialog: () => {
      aShown.push('drill');
      return Promise.resolve();
    },
    showGenFootprintPositionDialog: () => {
      aShown.push('pos');
      return Promise.resolve();
    },
  } as unknown as PCB_EDIT_FRAME_HOOKS);
  f.SetBoard(
    ParseBoard(
      '(kicad_pcb (version 20241229) (generator "pcbnew") (layers (0 "F.Cu" signal) (2 "B.Cu" signal)))',
    ),
    false,
  );
  return f;
}

describe('Fabrication Outputs', () => {
  it('generateDrillFiles shows DIALOG_GENDRILL', () => {
    const shown: string[] = [];
    frame(shown).GetToolManager()!.RunAction(PCB_ACTIONS.generateDrillFiles);
    expect(shown).toEqual(['drill']);
  });

  it('generatePosFile shows DIALOG_GEN_FOOTPRINT_POSITION', () => {
    const shown: string[] = [];
    frame(shown).GetToolManager()!.RunAction(PCB_ACTIONS.generatePosFile);
    expect(shown).toEqual(['pos']);
  });
});
