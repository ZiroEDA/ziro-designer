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

  it('swaps imperial for metric rather than cycling all three', () => {
    // COMMON_TOOLS::ToggleUnits is a two-way switch that returns to
    // m_imperialUnit, initially inches. The three-way cycle is the units
    // TOOLBAR button, which is a separate control.
    expect(BRANCH).toContain("toggles.has('unitsInches') || toggles.has('unitsMils')");
    expect(BRANCH).toContain("imperial ? 'unitsMm' : lastImperialRef.current");
  });

  it('remembers which imperial unit you were in', () => {
    expect(EDITOR).toContain(
      "const lastImperialRef = useRef<'unitsInches' | 'unitsMils'>('unitsInches');",
    );
    expect(EDITOR).toContain("if (toggles.has('unitsInches')) lastImperialRef.current");
  });

  it('stops the browser acting on the key', () => {
    // Ctrl+U is View Source in every browser.
    expect(BRANCH).toContain('e.preventDefault()');
  });
});
