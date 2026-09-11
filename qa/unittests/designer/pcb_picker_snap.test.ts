// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A board picker with `SetSnapping( false )` keeps its crosshair on the grid.
 *
 * `PCB_PICKER_TOOL::Main` asks `BestSnapAnchor` only `if( m_snap )`
 * (`pcb_picker_tool.cpp:38-52`), and the local ratsnest and delete pickers
 * switch it off (`board_inspection_tool.cpp:2297`, `pcb_control.cpp:834`).
 * Ours sent both through `bestSnapAnchor` with the drawing tools, so the
 * ratsnest crosshair leapt onto every pad it passed.
 */
import { describe, expect, it } from 'vitest';
import { pickerSnapsToGridOnly } from '@ziroeda/designer/src/editors/pcb/picker_snap.js';

describe('pickers that SetSnapping( false )', () => {
  it.each(['localRatsnestTool', 'deleteTool'])('%s follows the grid only', (tool) => {
    expect(pickerSnapsToGridOnly(tool)).toBe(true);
  });
});

describe('the tools that keep BestSnapAnchor', () => {
  // `DRAWING_TOOL`, `PCB_POINT_EDITOR`, the via tool: every one of these calls
  // `BestSnapAnchor` itself, so a table that swept them in would take the
  // item snap off the pencil.
  it.each([
    'drawLine',
    'drawVia',
    'placeText',
    'placePoint',
    'routeSingleTrack',
    'select',
  ])('%s is not in the table', (tool) => {
    expect(pickerSnapsToGridOnly(tool)).toBe(false);
  });
});
