// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DSP-32 — `ACTIONS::toggleUnits` (Ctrl+U, common/tool/actions.cpp:1149-1156)
 * was simply not bound in this frame: the audit pressed it with the editor
 * focused and the status-bar unit stayed on inches.
 *
 * It has no menu row in pl_editor either — the units live on the left toolbar —
 * so there is nothing for `ui/menu_hotkeys.ts` to dispatch from, and it joins
 * the frame's other canvas keys (Escape, M) in the editor's own handler.
 *
 * WHAT THIS FILE CANNOT DO: there is no DOM test environment in this repo, so
 * this reads the handler's declarations rather than pressing the key.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PL_EDITOR_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';
import { switchUnits, toggleUnitsId } from '@ziroeda/designer/src/editors/drawingsheet/toggles.js';

const EDITOR = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx', import.meta.url),
  ),
  'utf8',
);

/** The Ctrl+U branch of the frame's keydown handler. */
const BRANCH = (() => {
  const at = EDITOR.indexOf("e.key.toLowerCase() === 'u'");
  expect(at, 'Ctrl+U is not bound').toBeGreaterThan(-1);
  const from = EDITOR.lastIndexOf('if (', at);
  return EDITOR.slice(from, EDITOR.indexOf('return;', at));
})();

describe('Ctrl+U — ACTIONS::toggleUnits', () => {
  it('needs Ctrl (or Cmd) and nothing else', () => {
    // A binding without Shift must not fire on Shift+key.
    expect(BRANCH).toContain('e.ctrlKey || e.metaKey');
    expect(BRANCH).toContain('!e.shiftKey');
    expect(BRANCH).toContain('!e.altKey');
  });

  it('matches the key case-insensitively', () => {
    // Never a bare `e.key === 'U'`: Caps Lock and Shift both change the case.
    expect(BRANCH).toContain("e.key.toLowerCase() === 'u'");
  });

  it('asks the settings which unit to swap to', () => {
    // The choice itself is `toggleUnitsId`, a pure function over
    // `pl_editor.json`, and it is exercised directly below rather than read as
    // text. What the branch has to do is CALL it — with the live settings, not
    // with a ref this component keeps, because `setupUnits`
    // (eda_draw_frame.cpp:1384-1387) restores both "last" units from the file.
    expect(BRANCH).toContain('toggleUnitsId(settings.plEditor)');
    expect(EDITOR).not.toContain('lastImperialRef');
  });

  it('swaps imperial for metric rather than cycling all three', () => {
    // COMMON_TOOLS::ToggleUnits (common_tools.cpp:671-677) is a two-way switch.
    // The three-way cycle is the units TOOLBAR button, a separate control.
    const mils = structuredClone(PL_EDITOR_DEFAULTS);
    expect(mils.system.units).toBe('mils'); // the frame's own default
    expect(toggleUnitsId(mils)).toBe('unitsMm');

    const mm = structuredClone(PL_EDITOR_DEFAULTS);
    mm.system.units = 'mm';
    expect(toggleUnitsId(mm)).toBe('unitsMils');
  });

  it('remembers which imperial unit you were in', () => {
    // m_imperialUnit, which is `system.last_imperial_units` on disk.
    const s = structuredClone(PL_EDITOR_DEFAULTS);
    switchUnits(s, 'unitsInches');
    switchUnits(s, 'unitsMm');
    expect(toggleUnitsId(s)).toBe('unitsInches');
  });

  it('stops the browser acting on the key', () => {
    // Ctrl+U is View Source in every browser.
    expect(BRANCH).toContain('e.preventDefault()');
  });
});
