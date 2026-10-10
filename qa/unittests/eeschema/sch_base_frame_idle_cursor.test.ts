/**
 * SCH_BASE_FRAME's wxEVT_IDLE handler (sch_base_frame.cpp:135-146) hands the
 * idle to SCH_SELECTION_TOOL::OnIdle, which puts the selection cursor back once
 * no tool is running. Without it a cursor a tool set stays: the move tool's
 * WARNING (SCH_DRAG_NET_COLLISION_MONITOR::AdjustCursor, a drag shorting two
 * nets) outlived the move, Escape and undo.
 *
 * A page has no idle event; the frame runs it after each canvas event, as
 * PCB_BASE_EDIT_FRAME's does.
 */
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { wxEVT_MOTION, wxMouseEvent } from '@ziroeda/common/wx/wx_event.js';
import type { TOOL_DISPATCHER } from '@ziroeda/common/draw_panel_gal.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schToolHarness } from './support/sch_tool_harness.js';

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

describe('SCH_BASE_FRAME idle -> SCH_SELECTION_TOOL::OnIdle', () => {
  it('a cursor a finished tool left is replaced by the selection cursor on the next canvas event', () => {
    const h = schToolHarness();
    expect(h.frame.ToolStackIsEmpty()).toBe(true);

    h.h.shape = KICURSOR.WARNING;
    (h.dispatcher() as TOOL_DISPATCHER).DispatchWxEvent(new wxMouseEvent(wxEVT_MOTION));

    expect(h.h.shape).toBe(KICURSOR.ARROW);
  });
});
