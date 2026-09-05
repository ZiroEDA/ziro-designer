// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Drawing Sheet Editor's Preferences.
 *
 * The Preferences dialog was opened on a running pl_editor and photographed.
 * Under `Drawing Sheet Editor` it has four pages — Display Options, Grids,
 * Colors, Toolbars (`pagelayout_editor/pl_editor.cpp:68, 71, 82, 85`). We had
 * **none** of them: a local modal of this editor's own, carrying two controls.
 *
 * Three of the four are now pages of the shared `PreferencesDialog`; the fourth
 * is declared absent with its reason in `dialogs/prefs/registry.ts`, and
 * `prefs_page_book.test.ts` is what makes that declaration binding. This file
 * holds the rest:
 *
 *  - **No "Use a black background" control exists anywhere upstream.**
 *    `m_BlackBackground` is the field, its `PARAM`, and the frame's load/save
 *    and nothing else (pl_editor_settings.h:48, pl_editor_settings.cpp:42, 50,
 *    pl_editor_frame.cpp:541, 562). Grepping the whole of `pagelayout_editor`
 *    for `SetDrawBgColor` finds `LoadSettings` and the two lines of the
 *    printout that force white paper — no action, no menu item, no checkbox.
 *    Ours had one. It must not come back with the new pages.
 *  - **The crosshair is a three-way radio plus a separate checkbox**
 *    (`common/dialogs/panel_gal_options_base.cpp:102-114`), not one checkbox.
 *    Running the two together also made `CROSS_HAIR_MODE::CROSS_HAIR_45` — a
 *    mode `ui/grid_cursor.ts` has always been able to draw — unreachable.
 *  - **A control that displays a value and then discards it** is the failure
 *    the whole pl_editor audit exists to catch (the PCB Calculator bug), so
 *    both cursor writes are still traced from the control to `pl_editor.json`.
 *
 * These assertions were written against `DrawingSheetEditor.tsx`, where the two
 * controls used to live. They are **re-scoped, not weakened**: the controls
 * moved into `PANEL_GAL_OPTIONS`, so the same five facts are now proved where
 * they landed, and the editor is checked for having stopped holding a copy.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
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

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

const EDITOR = read('editors/drawingsheet/DrawingSheetEditor.tsx');
const GAL_PANEL = read('dialogs/prefs/PanelGalOptions.tsx');
const DS_DISPLAY = read('editors/drawingsheet/prefs/PanelPlEditorDisplayOptions.tsx');
const SHELL = read('dialogs/PreferencesDialog.tsx');

/** Statements only: a commented-out line must not satisfy any of these. */
function statements(src: string, needle: string): string[] {
  return src
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
    .filter((l) => l.includes(needle));
}

describe('the Cursor group’s two controls, where they now live', () => {
  it('renders the shape radio from the shared list rather than a local copy', () => {
    // Upstream this is a `wxRB_GROUP` of three `wxRadioButton`s, so a `wxChoice`
    // is already the wrong widget — and the list must be the one
    // `ui/grid_cursor.ts` publishes, not a second spelling of it. eeschema's
    // Display Options had a second spelling: `45° full window crosshairs`.
    expect(statements(GAL_PANEL, 'options={CROSSHAIR_MODE_CHOICES}')).toHaveLength(1);
    expect(statements(GAL_PANEL, '<Radio')).toHaveLength(2);
    for (const [, label] of CROSSHAIR_MODE_CHOICES)
      expect(statements(GAL_PANEL, `'${label}'`), label).toHaveLength(0);
  });

  it('keeps the checkbox separate, and labelled from the shared constant', () => {
    expect(statements(GAL_PANEL, 'label={ALWAYS_SHOW_CROSSHAIRS_LABEL}')).toHaveLength(1);
    expect(statements(GAL_PANEL, "'Always show")).toHaveLength(0);
  });

  it('is one panel, embedded by both editors that have a Display Options page', () => {
    // `PANEL_GAL_OPTIONS` is `common/` code precisely so there is one of it.
    for (const rel of [
      'editors/schematic/prefs/PanelEeschemaDisplayOptions.tsx',
      'editors/drawingsheet/prefs/PanelPlEditorDisplayOptions.tsx',
    ])
      expect(statements(read(rel), '<PanelGalOptions'), rel).toHaveLength(1);
  });

  it('writes both values back, from the control to pl_editor.json', () => {
    // The chain, each link asserted: the control mutates the working copy…
    expect(statements(GAL_PANEL, 'w.cursor.crosshair = v')).toHaveLength(1);
    expect(statements(GAL_PANEL, 'w.cursor.always_show_cursor = v')).toHaveLength(1);
    // …the Drawing Sheet Editor's page points that copy at PL_EDITOR_SETTINGS…
    expect(statements(DS_DISPLAY, 'win={plEditor.window}')).toHaveLength(1);
    expect(statements(DS_DISPLAY, 'update={(fn) => upPl((s) => fn(s.window))}')).toHaveLength(1);
    // …and OK commits it to the slice that is persisted as pl_editor.json.
    expect(
      statements(SHELL, 'settings.updatePlEditor((s) => Object.assign(s, draft.plEditor));'),
    ).toHaveLength(1);
  });

  it('leaves no second copy of the two controls in the editor', () => {
    // The local modal is gone; if it comes back this is what says so.
    expect(statements(EDITOR, 'CROSSHAIR_MODE_CHOICES')).toHaveLength(0);
    expect(statements(EDITOR, 'ALWAYS_SHOW_CROSSHAIRS_LABEL')).toHaveLength(0);
    expect(statements(EDITOR, 'function PreferencesDialog(')).toHaveLength(0);
  });
});

describe('the black background is still read and never written', () => {
  it('offers no checkbox for it, in the editor or on any of its pages', () => {
    for (const [name, src] of [
      ['DrawingSheetEditor.tsx', EDITOR],
      ['PanelPlEditorDisplayOptions.tsx', DS_DISPLAY],
      ['PanelPlEditorGrids.tsx', read('editors/drawingsheet/prefs/PanelPlEditorGrids.tsx')],
      [
        'PanelPlEditorColorSettings.tsx',
        read('editors/drawingsheet/prefs/PanelPlEditorColorSettings.tsx'),
      ],
      ['PanelGalOptions.tsx', GAL_PANEL],
    ] as const) {
      expect(statements(src, 'Use a black background'), name).toHaveLength(0);
      expect(statements(src, 'onBlackBackground'), name).toHaveLength(0);
      expect(statements(src, 'black_background ='), name).toHaveLength(0);
    }
  });

  it('still reads the setting at load, as LoadSettings does', () => {
    // Removing the control must not remove the value: `SetDrawBgColor(
    // cfg->m_BlackBackground ? BLACK : WHITE )` still runs.
    expect(statements(EDITOR, 'plCfg.black_background')).toHaveLength(1);
    expect(statements(EDITOR, 'blackBackground={blackBackground}')).toHaveLength(1);
  });
});

describe('the editor opens the shared dialog, not one of its own', () => {
  it('imports the shell every other launcher imports', () => {
    expect(statements(EDITOR, "from '../../dialogs/PreferencesDialog.js'")).toHaveLength(1);
    expect(statements(EDITOR, '<PreferencesDialog')).toHaveLength(1);
  });

  it('lands ACTIONS::gridProperties on the Grids page, not on the book’s first', () => {
    // `COMMON_TOOLS::GridProperties` for FRAME_PL_EDITOR is nothing but
    // `ShowPreferences( _( "Grids" ), _( "Drawing Sheet Editor" ) )`
    // (`common/tool/common_tools.cpp:609-634`), so an Edit Grids... that opened
    // the book at Common would not be the action at all.
    expect(statements(EDITOR, "setShowPrefs('ds-grids')")).toHaveLength(1);
    // …while the menu item passes no page, as upstream passes wxEmptyString.
    expect(statements(EDITOR, "setShowPrefs('default')")).toHaveLength(1);
  });

  it('passes the mode through to the canvas instead of a boolean', () => {
    expect(statements(EDITOR, 'crosshairMode={plCfg.window.cursor.crosshair}')).toHaveLength(1);
    expect(statements(EDITOR, 'fullCrosshair')).toHaveLength(0);
  });
});
