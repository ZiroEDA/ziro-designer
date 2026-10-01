// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_EDIT_FRAME runs PAD_TOOL: registered with the board editor's tools
 * (pcb_edit_frame.cpp:958), its dialogs reached through the frame's hooks.
 * Driven end to end on a real frame: a pad selected, Push Pad Properties run
 * from the tool manager, the dialog answered, the other footprint's pad changed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import type { DIALOG_PUSH_PAD_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_push_pad_properties.js';
import { wxID_CANCEL } from '@ziroeda/pcbnew/dialogs/dialog_push_pad_properties.js';
import type { PAD } from '@ziroeda/pcbnew/pad.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_EDIT_FRAME, type PCB_EDIT_FRAME_HOOKS } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import { PAD_TOOL } from '@ziroeda/pcbnew/tools/pad_tool.js';
import { PCB_ACTIONS } from '@ziroeda/pcbnew/tools/pcb_actions.js';

const U = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

// Two placements of one library footprint; R1's pad is 2 x 2 mm, R2's 1 x 1.
const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "")
  (footprint "Lib:R" (layer "F.Cu") (uuid "${U(1)}") (at 10 10)
    (property "Reference" "R1" (at 0 -3 0) (layer "F.Cu") (uuid "${U(2)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu") (uuid "${U(3)}"))
  )
  (footprint "Lib:R" (layer "F.Cu") (uuid "${U(4)}") (at 30 10)
    (property "Reference" "R2" (at 0 -3 0) (layer "F.Cu") (uuid "${U(5)}")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (uuid "${U(6)}"))
  )
)
`;

beforeAll(() => {
  installPgm();
});

function setup(answer: number | null) {
  const asked: DIALOG_PUSH_PAD_PROPERTIES[] = [];
  const settings = new PCBNEW_SETTINGS();
  const hooks = {
    settings: () => settings,
    onModify: () => {},
    updateProperties: () => {},
    ...(answer === null
      ? {}
      : {
          showPushPadPropertiesDialog: async (aDialog: DIALOG_PUSH_PAD_PROPERTIES) => {
            asked.push(aDialog);
            return answer;
          },
        }),
  } as unknown as PCB_EDIT_FRAME_HOOKS;
  const f = new PCB_EDIT_FRAME(hooks);
  const board = ParseBoard(BOARD_TEXT);
  f.SetBoard(board);
  // The footprint's own pad, not BOARD::ResolveItem: a commit's undo image
  // re-caches its cloned pads under the same KIIDs (FOOTPRINT::Add on a copy
  // whose parent is still the board), so a lookup by id after a push can
  // return the undo copy.
  const pad = (aRef: string): PAD =>
    board
      .Footprints()
      .find((fp) => fp.GetReference() === aRef)!
      .Pads()[0]!;
  return { f, asked, pad };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const size = (p: PAD) => ({ ...p.GetSize(p.GetLayer()) });

describe('PCB_EDIT_FRAME registers PAD_TOOL', () => {
  it('is the board editor tool named pcbnew.PadTool', () => {
    const { f } = setup(null);
    expect(f.GetToolManager()!.FindTool('pcbnew.PadTool')).toBeInstanceOf(PAD_TOOL);
  });

  it('Push Pad Properties reaches the dialog; Apply pushes to identical footprints', async () => {
    // dialog_push_pad_properties.cpp:35-36, 53-54: wxID_APPLY is "Change Pads
    // on Identical Footprints" and returns 1; pad_tool.cpp reads 1 as
    // edit_Same_Modules.
    const { f, asked, pad } = setup(1);
    f.GetSelectionTool().AddItemToSel(pad('R1') as never, true);
    f.GetToolManager()!.RunAction(PCB_ACTIONS.pushPadSettings);
    await flush();
    expect(asked).toHaveLength(1);
    expect(size(pad('R2'))).toEqual(size(pad('R1')));
  });

  it('OK is "Change Pads on Current Footprint": the other copy is untouched', async () => {
    const { f, pad } = setup(0);
    const before = size(pad('R2'));
    f.GetSelectionTool().AddItemToSel(pad('R1') as never, true);
    f.GetToolManager()!.RunAction(PCB_ACTIONS.pushPadSettings);
    await flush();
    expect(size(pad('R2'))).toEqual(before);
  });

  it('a dismissed dialog changes nothing', async () => {
    const { f, pad } = setup(wxID_CANCEL);
    const before = size(pad('R2'));
    f.GetSelectionTool().AddItemToSel(pad('R1') as never, true);
    f.GetToolManager()!.RunAction(PCB_ACTIONS.pushPadSettings);
    await flush();
    expect(size(pad('R2'))).toEqual(before);
  });

  it('with no dialog hook the frame answers Cancel, as a closed dialog would', async () => {
    const { f } = setup(null);
    await expect(f.ShowPushPadPropertiesDialog({} as DIALOG_PUSH_PAD_PROPERTIES)).resolves.toBe(
      wxID_CANCEL,
    );
  });
});
