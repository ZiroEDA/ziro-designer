// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `TOOL_EVENT::Position()` is a VECTOR2D (tool_event.h). SCH_SELECTION_TOOL::Main hands it to
 * `CollectHits( SCH_COLLECTOR&, const VECTOR2I& aWhere, ... )` and `SelectPoint( const VECTOR2I&
 * ... )` (sch_selection_tool.cpp:550-553, 639), and the VECTOR2I casting constructor truncates it
 * (vector2d.h:89-111) - a whole point is what reaches SCH_LINE::HitTest.
 *
 * Ours handed the fraction on, and TestSegmentHit's general case (a slanted wire) forms
 * SEG::SquaredDistance in 64-bit integers, which BigInt refuses for a fraction: the same throw
 * Sentry 157832627 reported from the board editor.
 */
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { MD_CTRL, TA_MOUSE_MOTION } from '@ziroeda/common/tool/tool_event.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_LINE_WIRE_BUS_TOOL } from '@ziroeda/eeschema/tools/sch_line_wire_bus_tool.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { click, MM, mouse, schFrame, schToolHarness } from './support/sch_tool_harness.js';

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

describe('SCH_SELECTION_TOOL::Main, a click', () => {
  it('selects a slanted wire under a pointer that sits between two IU', () => {
    const h = schToolHarness(schFrame({}));
    const wire = new SCH_LINE({ x: 100 * MM, y: 100 * MM }, SCH_LAYER_ID.LAYER_WIRE);
    wire.SetEndPoint({ x: 140 * MM, y: 127 * MM });
    h.frame.AddToScreen(wire, h.frame.GetScreen());

    // Halfway along it, as a zoomed view maps a pixel: not a whole IU.
    click(h, { x: 120 * MM + 0.3, y: 113.5 * MM + 0.7 });

    const selection = h.frame.GetToolManager()!.GetTool(SCH_SELECTION_TOOL)!.GetSelection();
    expect(selection.GetItems()).toEqual([wire]);
  });
});

describe('SCH_LINE_WIRE_BUS_TOOL::doDrawSegments, grid snapping off', () => {
  // `VECTOR2I cursorPos = grid.BestSnapAnchor( eventPosition, ... )` (sch_line_wire_bus_tool.cpp):
  // with Ctrl held GRID_HELPER hands the point back unsnapped, and the VECTOR2I it lands in is
  // what truncates it. Ours kept the fraction, and PreviewJunctions' IsPointOnSegment threw on
  // the preview segment (Sentry JAVASCRIPT-REACT-14, 10-28). Two casts now stand in the way - the
  // call site's and EE_GRID_HELPER::BestSnapAnchor's own (f1cd77e45) - so this fails only when
  // both are gone: a guard on the pair, not on either one.
  it('draws a wire across another from a pointer between two IU', () => {
    const h = schToolHarness(schFrame({}));
    const across = new SCH_LINE({ x: 120 * MM, y: 90 * MM }, SCH_LAYER_ID.LAYER_WIRE);
    across.SetEndPoint({ x: 120 * MM, y: 130 * MM });
    h.frame.AddToScreen(across, h.frame.GetScreen());
    const mgr = h.frame.GetToolManager()!;

    // The hotkey starts the wire where the pointer is (TOOL_MANAGER hands the action the cursor).
    h.h.mouse = { x: 100 * MM + 0.4, y: 110 * MM + 0.3 };
    mgr.RunAction(SCH_ACTIONS.drawWire);
    mouse(h, TA_MOUSE_MOTION, { x: 140 * MM + 0.6, y: 110 * MM + 0.2 }, MD_CTRL);

    const tool = mgr.GetTool(SCH_LINE_WIRE_BUS_TOOL)!;
    const wires = (tool as unknown as { m_wires: SCH_LINE[] }).m_wires;
    // The start was snapped (no Ctrl on the hotkey): the 50 mil grid point nearest it.
    expect(wires[0]!.GetStartPoint()).toEqual({ x: 79 * 12700, y: 87 * 12700 });
    // The end was not, and the VECTOR2I truncated it.
    expect(wires.at(-1)!.GetEndPoint()).toEqual({ x: 140 * MM, y: 110 * MM });
  });
});
