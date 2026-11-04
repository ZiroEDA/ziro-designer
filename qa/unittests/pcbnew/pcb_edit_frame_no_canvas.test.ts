// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A key while the board editor has no canvas (Sentry JAVASCRIPT-REACT-1A, 11-04).
 *
 * KiCad's tool events come from EDA_DRAW_PANEL_GAL, so PCB_SELECTION_TOOL::OnIdle can call
 * `m_frame->GetCanvas()->SetCurrentCursor(...)` unguarded (pcb_selection_tool.cpp:272-289). Ours
 * also hands the window's keys to the dispatcher, and the GAL panel is null before its first
 * build and between a lost WebGL context and its restore: a key then threw "Cannot read
 * properties of null (reading 'SetCurrentCursor')" from the idle pass after the dispatch.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { wxEVT_CHAR_HOOK, wxKeyEvent } from '@ziroeda/wx/wx_event.js';
import { PCB_EDIT_FRAME } from '@ziroeda/pcbnew/pcb_edit_frame.js';
import type { PCB_DRAW_PANEL_GAL } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { PCB_SCREEN } from '@ziroeda/pcbnew/pcb_screen.js';
import { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';
import type { GATED_DISPATCHER } from '@ziroeda/pcbnew/tools/window_action_bridge.js';

const BOARD = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6))
  (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
)
`;

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function frame(): PCB_EDIT_FRAME {
  const f = new PCB_EDIT_FRAME({
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
    showExchangeFootprintsDialog: () => {},
    findDialogRects: () => [],
    setViewCenter: () => {},
    editZoneParams: () => {},
    selectCopperLayerPair: () => {},
    updatePcbFromSchematic: () => {},
    showInfoBarError: () => {},
  });
  f.SetBoard(ParseBoard(BOARD, '/p/x.kicad_pcb'), false);
  f.SetScreen(new PCB_SCREEN({ x: 297000000, y: 210000000 }));
  return f;
}

/** A plain key, as the window's char hook hands one past its own chain. */
function key(): wxKeyEvent {
  const ev = new wxKeyEvent(wxEVT_CHAR_HOOK);
  ev.m_keyCode = 'Q'.charCodeAt(0);
  return ev;
}

function dispatcher(aFrame: PCB_EDIT_FRAME): GATED_DISPATCHER {
  return aFrame.GetToolDispatcher() as unknown as GATED_DISPATCHER;
}

describe('PCB_EDIT_FRAME, a key with no canvas', () => {
  it('passes the key on instead of handing it to the tools', () => {
    const f = frame();
    expect(f.GetCanvas()).toBeNull();

    const ev = key();
    expect(() => dispatcher(f).DispatchToTools(ev)).not.toThrow();
    expect(ev.GetSkipped()).toBe(true);

    const ev2 = key();
    expect(() => dispatcher(f).DispatchWxEvent(ev2)).not.toThrow();
    expect(ev2.GetSkipped()).toBe(true);
  });

  it('still reaches the tools, and their idle pass, once a canvas is there', () => {
    const f = frame();
    const cursors: KICURSOR[] = [];
    f.SetCanvas({
      SetCurrentCursor: (c: KICURSOR) => cursors.push(c),
      // What the manager's UpdateUI reads after the event (EDA_DRAW_FRAME::UpdateStatusBar).
      GetViewControls: () => ({ GetCursorPosition: () => ({ x: 0, y: 0 }) }),
      GetGAL: () => null,
    } as unknown as PCB_DRAW_PANEL_GAL);

    dispatcher(f).DispatchToTools(key());

    // PCB_SELECTION_TOOL::OnIdle with no modifier down: the plain arrow.
    expect(cursors).toEqual([KICURSOR.ARROW]);
  });
});
