// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The cursor of the five `MICROWAVE_TOOL` tools: `drawMicrowaveInductor`'s
 * `setCursor` (microwave_tool.cpp) is `PENCIL` on every event; the four
 * footprint tools run `doInteractiveItemPlacement`, whose `setCursor` is `PENCIL`
 * until `newItem` exists and `PLACE` from then on (pcb_tool_base.cpp).
 */
import { describe, expect, it } from 'vitest';
import { kiCursor } from '@ziroeda/common/gal/kicursors.js';
import { boardToolCursor } from '@ziroeda/pcbnew/cursors.js';

const FOOTPRINT_TOOLS = [
  'microwaveCreateGap',
  'microwaveCreateStub',
  'microwaveCreateStubArc',
  'microwaveCreateFunctionShape',
];

describe('MICROWAVE_TOOL cursors', () => {
  it('the inductor tool is the pencil, whatever else is going on', () => {
    expect(boardToolCursor('microwaveCreateLine')).toBe(kiCursor('PENCIL'));
    expect(boardToolCursor('microwaveCreateLine', { microwavePlacing: true })).toBe(
      kiCursor('PENCIL'),
    );
  });

  it.each(
    FOOTPRINT_TOOLS,
  )('%s is the pencil until an item rides the pointer, then PLACE', (tool) => {
    expect(boardToolCursor(tool)).toBe(kiCursor('PENCIL'));
    expect(boardToolCursor(tool, { microwavePlacing: true })).toBe(kiCursor('PLACE'));
  });

  it('PENCIL and PLACE are different cursors', () => {
    expect(kiCursor('PENCIL')).not.toBe(kiCursor('PLACE'));
  });
});
