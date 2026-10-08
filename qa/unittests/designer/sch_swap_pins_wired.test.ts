// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Swap Pins reaches the editor, and the preference really gates it.
 *
 * `allow_unconstrained_pin_swaps` is checked in TWO places upstream — on the
 * menu entry's condition (`sch_selection_tool.cpp:385`) and again at the top of
 * the handler (`sch_edit_tool.cpp:1769-1770`) — so the tool cannot be reached
 * by a hotkey or a script when the preference is off. A port that checked only
 * the menu would look right and behave wrong.
 *
 * Read as source: `qa`'s tsconfig cannot compile a `.tsx`, which is the same
 * reason `clipboard_wired` and `canvas_props_wired` read theirs.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EDITOR = readFileSync(
  fileURLToPath(new URL('../../../eeschema/sch_edit_frame_ui.tsx', import.meta.url)),
  'utf8',
);

const PANEL = readFileSync(
  fileURLToPath(
    new URL(
      '../../../designer/src/editors/schematic/prefs/PanelEeschemaEditingOptions.tsx',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('the preference gates both halves', () => {
  it('gates the handler as well, not only the menu', () => {
    expect(EDITOR).toContain('if (!doc || !es.input.allow_unconstrained_pin_swaps) return;');
  });

  it('leaves the checkbox live, since something now reads it', () => {
    const at = PANEL.indexOf('Allow unconstrained pin swaps');
    expect(at).toBeGreaterThan(-1);
    // The props of that one control: up to the closing `/>` of its element.
    const props = PANEL.slice(at, PANEL.indexOf('/>', at));
    expect(props).not.toMatch(/\bdisabled\b/);
  });
});

describe('the handler', () => {
  it('runs the command the model builds, rather than editing here', () => {
    expect(EDITOR).toContain('swapPinsCommand(doc, libById, [...selection], project.current.root)');
  });

  it('shows upstream’s infobar when the symbol is shared', () => {
    expect(EDITOR).toContain('sharedPinSwapMessage(r)');
  });

  it('clears the selection, because the ids no longer name what was picked', () => {
    const at = EDITOR.indexOf("id === 'swapPins'");
    expect(at).toBeGreaterThan(-1);
    expect(EDITOR.slice(at, at + 900)).toContain('setSelection(new Set())');
  });
});
