// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_SELECTION_TOOL::OnIdle` (sch_selection_tool.cpp): with nothing running, it reads the
 * modifier keys from `wxGetMouseState()` and shows what a click would do - ADD with Shift,
 * SUBTRACT with Ctrl+Shift (`SELECTION_TOOL::setModifiersState`, selection_tool.cpp:56-57).
 *
 * Our `wxGetMouseState` answered the buttons only, so the modifiers always read false and the
 * three modifier cursors never showed; and when they were asked for, the cursor store had no
 * entry for them (Sentry 157822773).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { WXK, wxGetMouseState, wxSetKeyState } from '@ziroeda/wx/wx_event.js';
import { schFrame, schToolHarness } from './support/sch_tool_harness.js';

const keys = (aShift: boolean, aCtrl: boolean, aAlt = false): void => {
  wxSetKeyState(WXK.WXK_SHIFT, aShift);
  wxSetKeyState(WXK.WXK_CONTROL, aCtrl);
  wxSetKeyState(WXK.WXK_ALT, aAlt);
};

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => {
  keys(false, false);
  SetPgm(null);
});

describe('wxGetMouseState', () => {
  it('reports the modifier keys the platform holds, as GTK does from its one mask', () => {
    // One key at a time, so a flag read from the wrong key shows.
    keys(true, false);
    const s = wxGetMouseState();
    expect([s.ShiftDown(), s.ControlDown(), s.RawControlDown(), s.AltDown()]).toEqual([
      true,
      false,
      false,
      false,
    ]);

    keys(false, false, true);
    const a = wxGetMouseState();
    expect([a.ShiftDown(), a.ControlDown(), a.RawControlDown(), a.AltDown()]).toEqual([
      false,
      false,
      false,
      true,
    ]);

    keys(false, true);
    const c = wxGetMouseState();
    expect([c.ShiftDown(), c.ControlDown(), c.RawControlDown(), c.AltDown()]).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
});

describe('SCH_SELECTION_TOOL::OnIdle', () => {
  const idleCursor = (aShift: boolean, aCtrl: boolean): KICURSOR | null => {
    const h = schToolHarness(schFrame({}));
    keys(aShift, aCtrl);
    h.frame.GetToolManager()!.GetTool(SCH_SELECTION_TOOL)!.OnIdle();
    return h.h.shape;
  };

  it('shows ADD while Shift is held', () => {
    expect(idleCursor(true, false)).toBe(KICURSOR.ADD);
  });

  it('shows SUBTRACT while Ctrl+Shift is held', () => {
    expect(idleCursor(true, true)).toBe(KICURSOR.SUBTRACT);
  });

  it('shows the plain arrow with no modifier', () => {
    expect(idleCursor(false, false)).toBe(KICURSOR.ARROW);
  });
});
