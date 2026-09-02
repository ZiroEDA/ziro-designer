// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Snap to grid" — `GAL_DISPLAY_OPTIONS::m_gridSnapping`, and the one method
 * that acts on it.
 *
 *     bool GetGridSnapping() const
 *     {
 *         return m_options.m_gridSnapping == KIGFX::GRID_SNAPPING::ALWAYS ||
 *                  ( m_gridVisibility && m_options.m_gridSnapping == KIGFX::GRID_SNAPPING::WITH_GRID );
 *     }
 *     (`include/gal/graphics_abstraction_layer.h:815-819`)
 *
 * Every editor's Display Options page has drawn this choice for as long as the
 * page has existed, and until this sweep **nothing read it**. That is the worse
 * half of the dead-control family: the combo was not greyed, so it looked live,
 * stored a value, and did nothing.
 *
 * Two of the four were not merely inert but actively wrong. The Drawing Sheet
 * Editor and the Gerber Viewer snapped on `showGrid` ALONE, which is
 * `GRID_SNAPPING::WITH_GRID` hardcoded — where the setting's default is
 * `ALWAYS` — so hiding the grid silently stopped the cursor snapping. The
 * schematic snapped unconditionally, which IS `ALWAYS`, so it was right by
 * accident at the default and wrong at the other two options.
 *
 * The rule this file exists to hold is the one that made the Symbol Editor read
 * `eeschema.json` for a year: **each canvas asks its OWN app's settings
 * object.** So the per-editor assertions are per editor and not a single scan —
 * "right in pl_editor, wrong in eeschema" is the shape this codebase produces
 * most, and one aggregate check cannot see it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { gridSnappingEnabled, type GridSnapping } from '@ziroeda/designer/src/ui/grid_cursor.js';
import { GRID_SNAP_CHOICES } from '@ziroeda/designer/src/dialogs/prefs/gal_options.js';
import {
  EESCHEMA_DEFAULTS,
  GERBVIEW_DEFAULTS,
  PL_EDITOR_DEFAULTS,
  SYMBOL_EDITOR_DEFAULTS,
} from '@ziroeda/designer/src/prefs/settings.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

// ------------------------------------------------------------------ the predicate

describe('GAL::GetGridSnapping', () => {
  it('ALWAYS ignores whether the grid is shown', () => {
    expect(gridSnappingEnabled(0, true)).toBe(true);
    expect(gridSnappingEnabled(0, false)).toBe(true);
  });

  it('WITH_GRID follows Show Grid, which is the only option that does', () => {
    expect(gridSnappingEnabled(1, true)).toBe(true);
    expect(gridSnappingEnabled(1, false)).toBe(false);
  });

  it('NEVER falls out of both arms', () => {
    expect(gridSnappingEnabled(2, true)).toBe(false);
    expect(gridSnappingEnabled(2, false)).toBe(false);
  });

  it('covers exactly the three options the page offers', () => {
    // The choice and the predicate must agree on the domain: a fourth option
    // on the page would be a value with no arm, and an arm with no option is a
    // state the user cannot reach.
    const values = GRID_SNAP_CHOICES.map(([v]) => v as GridSnapping);
    expect(values).toEqual([0, 1, 2]);
    expect(GRID_SNAP_CHOICES.map(([, l]) => l)).toEqual(['Always', 'When grid shown', 'Never']);
  });

  it('is written once, beside the rest of GAL_DISPLAY_OPTIONS', () => {
    // Upstream it is one method on the GAL and every canvas calls the same
    // one. Four copies of `snap === 0 || (show && snap === 1)` is how three of
    // them end up agreeing and the fourth does not.
    const canvases = Object.values(CANVAS);
    for (const rel of canvases) expect(read(rel), rel).not.toMatch(/snap\s*===\s*0\s*\|\|/);
  });
});

describe('every app defaults to ALWAYS, so the sweep changed no default', () => {
  it.each([
    ['eeschema', EESCHEMA_DEFAULTS.window.grid.snap],
    ['symbol_editor', SYMBOL_EDITOR_DEFAULTS.window.grid.snap],
    ['pl_editor', PL_EDITOR_DEFAULTS.window.grid.snap],
    ['gerbview', GERBVIEW_DEFAULTS.window.grid.snap],
  ])('%s', (_app, snap) => {
    // `PARAM<int>( aJsonPath + ".grid.snap", …, 0 )`
    // (`common/settings/app_settings.cpp:561-562`) — 0 is GRID_SNAPPING::ALWAYS
    // for every app alike. A fresh profile therefore snaps with the grid hidden,
    // which is what pl_editor and gerbview stopped doing.
    expect(snap).toBe(0);
    expect(gridSnappingEnabled(snap as GridSnapping, false)).toBe(true);
  });
});

// ------------------------------------------------------------- one canvas each

/** Where each editor snaps, and which settings object is the right one there. */
const CANVAS: Record<string, string> = {
  eeschema: 'editors/schematic/components/SchematicCanvas.tsx',
  symbol_editor: 'editors/symbol/grid.ts',
  pl_editor: 'editors/drawingsheet/DrawingSheetCanvas.tsx',
  gerbview: 'editors/gerbview/GerberCanvas.tsx',
};

/** The settings-object expression each canvas must reach for. */
const OWN_SNAP: Record<string, string> = {
  eeschema: 'settings.eeschema.window.grid.snap',
  symbol_editor: 'cfg.window.grid.snap',
  pl_editor: 'plCfg.window.grid.snap',
  gerbview: 'gbrCfg.window.grid.snap',
};

describe('each canvas asks GetGridSnapping, with its own settings', () => {
  it.each(Object.keys(CANVAS))('%s calls the shared predicate', (app) => {
    const src = read(CANVAS[app] as string);
    expect(src, `${app} does not call gridSnappingEnabled`).toContain('gridSnappingEnabled(');
    expect(src).toContain(OWN_SNAP[app] as string);
  });

  it.each(Object.keys(CANVAS))('%s reaches for no other app’s snap setting', (app) => {
    // The bug this is here for: the Symbol Editor read
    // `settings.eeschema.window.cursor` and `.grid.style` for a year, so the
    // controls on ITS page were a second set of switches over the schematic's
    // file. One app's canvas naming another app's settings object is that,
    // every time.
    const src = read(CANVAS[app] as string);
    const others = ['eeschema', 'symbolEditor', 'plEditor', 'gerbview'].filter(
      (o) => !(OWN_SNAP[app] as string).includes(o),
    );
    for (const other of others)
      expect(src, `${app} reads ${other}'s snap`).not.toContain(
        `settings.${other}.window.grid.snap`,
      );
  });

  it('the schematic no longer snaps unconditionally', () => {
    // It was `const snap = (p) => ({ x: round(p.x / GRID) * GRID, … })` with no
    // test at all — ALWAYS hardcoded, so two of the three options were inert.
    const src = read(CANVAS.eeschema as string);
    // Whitespace-insensitive on purpose: the formatter decides where this
    // wraps, and an assertion that pins indentation fails on a reformat rather
    // than on the behaviour it is about.
    expect(src).toMatch(/snapping\s*\?\s*\{\s*x:\s*Math\.round\(p\.x \/ GRID\)/);
    expect(src).toMatch(/:\s*p;/);
  });

  it('the drawing sheet no longer ties snapping to Show Grid', () => {
    // It was `showGrid && gridIU > 0`, i.e. WITH_GRID hardcoded.
    const src = read(CANVAS.pl_editor as string);
    expect(src).toContain('snapping && gridIU > 0');
    expect(src).not.toContain('showGrid && gridIU > 0');
  });

  it('gerbview no longer ties its crosshair to Show Grid', () => {
    // It was `sg && g > 0`, where `sg` was `showGrid` off the same ref.
    const src = read(CANVAS.gerbview as string);
    expect(src).toContain('sn && g > 0');
    expect(src).not.toMatch(
      /const \{ showGrid: sg[^}]*\} = gridRef\.current;\s*\n\s*const snapped/,
    );
  });
});

// ------------------------------------------------------------------- the pages

describe('the choice is drawn live, because it now is', () => {
  it.each([
    ['schematic', 'editors/schematic/prefs/PanelEeschemaDisplayOptions.tsx'],
    ['symbol', 'editors/symbol/prefs/PanelSymbolEditorDisplayOptions.tsx'],
    ['drawing sheet', 'editors/drawingsheet/prefs/PanelPlEditorDisplayOptions.tsx'],
    ['gerbview', 'editors/gerbview/prefs/PanelGerbviewDisplayOptions.tsx'],
  ])('%s embeds the shared PANEL_GAL_OPTIONS over its own window slice', (_name, rel) => {
    const src = read(rel);
    expect(src).toContain('<PanelGalOptions');
    // The shared panel takes no `disabled`, and none of these four ever greyed
    // the choice — which is why the defect was invisible. If a page ever needs
    // to grey it again, that is a deliberate change and this is where it shows.
    const at = src.indexOf('<PanelGalOptions');
    expect(src.slice(at, src.indexOf('/>', at))).not.toContain('disabled');
  });
});
