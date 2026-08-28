// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Two things the Drawing Sheet Editor's Preferences had that upstream's does
 * not, and one it could not reach.
 *
 * The Preferences dialog was opened on a running pl_editor and photographed.
 * Under `Drawing Sheet Editor` it has four pages — Display Options, Grids,
 * Colors, Toolbars (`pagelayout_editor/pl_editor.cpp:68, 71, 82, 85`) — and we
 * have none of them; that is issue #619's G12 and is still open. What this file
 * holds is the part that was not "small" but wrong:
 *
 *  - **No "Use a black background" control exists anywhere in it.**
 *    `m_BlackBackground` is the field, its `PARAM`, and the frame's load/save
 *    and nothing else (pl_editor_settings.h:48, pl_editor_settings.cpp:42, 50,
 *    pl_editor_frame.cpp:541, 562). Grepping the whole of `pagelayout_editor`
 *    for `SetDrawBgColor` finds `LoadSettings` and the two lines of the
 *    printout that force white paper — no action, no menu item, no checkbox.
 *    The setting can only be changed by editing `pl_editor.json`. Ours had a
 *    checkbox for it.
 *  - **The crosshair is a three-way radio plus a separate checkbox**
 *    (`common/dialogs/panel_gal_options_base.cpp:102-114`), not one checkbox.
 *    Running the two together also made `CROSS_HAIR_MODE::CROSS_HAIR_45` — a
 *    mode `ui/grid_cursor.ts` has always been able to draw — unreachable.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALWAYS_SHOW_CROSSHAIRS_LABEL,
  CROSSHAIR_MODE_CHOICES,
  crosshairSegments,
} from '@ziroeda/designer/src/ui/grid_cursor.js';

describe('PANEL_GAL_OPTIONS’ Cursor group', () => {
  it('offers three shapes, in KiCad’s order with KiCad’s labels', () => {
    expect(CROSSHAIR_MODE_CHOICES).toEqual([
      ['small', 'Small crosshairs'],
      ['full', 'Full window crosshairs'],
      ['45', '45 degree crosshairs'],
    ]);
  });

  it('keeps "Always show crosshairs" as its own control', () => {
    expect(ALWAYS_SHOW_CROSSHAIRS_LABEL).toBe('Always show crosshairs');
    // The label we had ran the two controls together into one sentence.
    expect(ALWAYS_SHOW_CROSSHAIRS_LABEL).not.toContain('full-window');
  });

  it('every offered shape is one the renderer actually draws', () => {
    // A control that writes a setting nothing reads is the failure this whole
    // audit exists to catch. `crosshairSegments` is what paints the cursor.
    for (const [mode] of CROSSHAIR_MODE_CHOICES) {
      const segs = crosshairSegments(mode, { x: 100, y: 100 }, 800, 600, 1);
      expect(segs.length, `${mode} draws nothing`).toBeGreaterThan(0);
    }
  });

  it('draws the three shapes differently from one another', () => {
    const shape = (m: 'small' | 'full' | '45'): string =>
      JSON.stringify(crosshairSegments(m, { x: 100, y: 100 }, 800, 600, 1));
    expect(shape('small')).not.toBe(shape('full'));
    expect(shape('full')).not.toBe(shape('45'));
    expect(shape('small')).not.toBe(shape('45'));
  });
});

const EDITOR = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx', import.meta.url),
  ),
  'utf8',
);

/** Statements only: a commented-out line must not satisfy any of these. */
function statements(src: string, needle: string): string[] {
  return src
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
    .filter((l) => l.includes(needle));
}

describe('the Preferences modal', () => {
  it('no longer offers a black-background checkbox', () => {
    expect(statements(EDITOR, 'Use a black background')).toHaveLength(0);
    expect(statements(EDITOR, 'onBlackBackground')).toHaveLength(0);
  });

  it('still reads the setting at load, as LoadSettings does', () => {
    // Removing the control must not remove the value: `SetDrawBgColor(
    // cfg->m_BlackBackground ? BLACK : WHITE )` still runs.
    expect(statements(EDITOR, 'plCfg.black_background')).toHaveLength(1);
    expect(statements(EDITOR, 'blackBackground={blackBackground}')).toHaveLength(1);
  });

  it('renders the shape radio from the shared list rather than a local copy', () => {
    expect(statements(EDITOR, 'CROSSHAIR_MODE_CHOICES.map')).toHaveLength(1);
    expect(statements(EDITOR, 'type="radio"')).toHaveLength(1);
  });

  it('passes the mode through to the canvas instead of a boolean', () => {
    expect(statements(EDITOR, 'crosshairMode={plCfg.window.cursor.crosshair}')).toHaveLength(1);
    expect(statements(EDITOR, 'fullCrosshair')).toHaveLength(0);
  });
});
