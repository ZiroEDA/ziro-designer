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
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { click, MM, schFrame, schToolHarness } from './support/sch_tool_harness.js';

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
