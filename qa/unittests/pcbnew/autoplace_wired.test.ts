// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Place > Auto-Place Footprints (`menubar_pcb_editor.cpp:339-346`) reaches
 * AUTOPLACE_TOOL. `pcb_edit_frame_ui.tsx` is a `.tsx` `qa` cannot compile, so
 * this reads it as text, like `import_graphics_wired.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const MENUBAR = read('../../../pcbnew/menubar_pcb_editor.ts');
const EDITOR = read('../../../pcbnew/pcb_edit_frame_ui.tsx');
const FRAME = read('../../../pcbnew/pcb_edit_frame.ts');

describe('Place > Auto-Place Footprints', () => {
  it('both rows dispatch, in KiCad order (off-board first)', () => {
    const off = MENUBAR.indexOf("h.action('autoplaceOffboard')");
    const sel = MENUBAR.indexOf("h.action('autoplaceSelected')");
    expect(off).toBeGreaterThan(0);
    expect(sel).toBeGreaterThan(off);
    expect(MENUBAR).not.toMatch(/Place (Off-Board|Selected) Footprints', disabled/);
  });

  it('each row runs the matching PCB_ACTIONS action, which AUTOPLACE_TOOL takes', () => {
    // The tool itself (selection, locks, off-board, the infobar error, the
    // commit) is pinned in ar_autoplacer.test.ts through TOOL_MANAGER.
    expect(EDITOR).toMatch(
      /case 'autoplaceSelected':\s*runAction\(PCB_ACTIONS\.autoplaceSelectedComponents\);/,
    );
    expect(EDITOR).toMatch(
      /case 'autoplaceOffboard':\s*runAction\(PCB_ACTIONS\.autoplaceOffboardComponents\);/,
    );
    // `m_toolManager->RegisterTool( new AUTOPLACE_TOOL )` (pcb_edit_frame.cpp:971).
    expect(FRAME).toContain('this.m_toolManager.RegisterTool(new AUTOPLACE_TOOL());');
  });
});
