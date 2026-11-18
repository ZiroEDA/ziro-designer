// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The board editor's toolbar state follows the TOOL_MANAGER's stack (hooks.toolStackChanged).
 *
 * A second X over a pad after a route finished restarts the router at the cursor: MainLoop sees
 * IsActivate() and pops, and the transition pushes it again - in one tick. The sync compared the
 * push against a ref that only moves at render, so it still read the pre-pop tool, dropped the
 * push, and left the selection tool queued; that state's arming effect then popped the router it
 * had just restarted (uartbridge, U-16, reproduced headless). Every request now moves the ref at
 * once. pcb_edit_frame_ui.tsx cannot be imported here, so the obligation is read per call site.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const UI = readFileSync(join(__dirname, '../../../pcbnew/pcb_edit_frame_ui.tsx'), 'utf8');

describe('toolStackChanged', () => {
  const start = UI.indexOf('toolStackChanged: () => {');
  const body = UI.slice(start, UI.indexOf('fetchNetlistFromSchematic:', start));

  it('moves activeToolRef with every tool it asks for, before the render', () => {
    expect(start).toBeGreaterThan(0);
    expect(body).toMatch(
      /const want = \(aTool: string\): void => \{\s*activeToolRef\.current = aTool;\s*setActiveTool\(aTool\);/,
    );
    // and asks only through it
    expect(body.match(/setActiveTool\(/g)).toHaveLength(1);
    expect(body).toMatch(/if \(activeToolRef\.current !== pushed\) want\(pushed\);/);
    expect(body).toMatch(/want\(selectModeRef\.current\);/);
  });
});
