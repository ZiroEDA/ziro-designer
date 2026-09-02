// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Grid Display group — `GAL_DISPLAY_OPTIONS::m_gridStyle`,
 * `m_gridLineWidth` and `m_gridMinSpacing` — reaching the canvas that paints
 * the grid.
 *
 * `PANEL_GAL_OPTIONS` draws these three for every frame that constructs it, and
 * upstream needs no wiring test: the panel writes the frame's own
 * `GAL_DISPLAY_OPTIONS`, `NotifyChanged()` fires, and every GAL reads the same
 * struct it was handed. Ours are four independent canvases, so the wiring is
 * per file and drifted — the schematic and the Symbol Editor passed all three
 * to `drawGrid`, and the Drawing Sheet Editor and the Gerber Viewer passed
 * NONE, falling through to `DEFAULT_GRID_APPEARANCE`.
 *
 * That fall-through is why the defect had no visible tell. An omitted option is
 * not a crash and not a blank grid: it is dots at width 1 and spacing 10, which
 * is exactly what the page says when it is untouched. The control was drawn
 * enabled — `PanelGalOptions.tsx` contains no `disabled` at all — so it looked
 * live, stored a value, and painted the default forever.
 *
 * Two rules, and they are separate on purpose:
 *
 *  1. all three reach the painter. `lineWidthPx` alone is the mutant that made
 *     me write this: `gridPenWidths` is the only one of the three whose absence
 *     changes a stroke width rather than the whole lattice, so a test that
 *     checks "some appearance is passed" passes with it missing.
 *  2. each canvas asks its OWN app's settings object. This is the rule that let
 *     the Symbol Editor read `eeschema.json` for a year, and it is why the
 *     assertions below are per editor rather than one aggregate scan — "right
 *     in pl_editor, wrong in gerbview" is invisible to a single sweep.
 *
 * The painter's own behaviour is not re-tested here; `grid_axis_skip.test.ts`
 * already paints all three styles through a recording context, so what was
 * missing was only the wiring that reaches it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  EESCHEMA_DEFAULTS,
  GERBVIEW_DEFAULTS,
  PL_EDITOR_DEFAULTS,
  SYMBOL_EDITOR_DEFAULTS,
} from '@ziroeda/designer/src/prefs/settings.js';
import { DEFAULT_GRID_APPEARANCE } from '@ziroeda/designer/src/ui/grid_cursor.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/**
 * The four editors whose Preferences draw the Grid Display group, and the file
 * where each reads its settings object.
 *
 * The PCB and footprint editors are absent because they draw no such group:
 * `PcbnewSettings.window.grid` has no `style`/`line_width`/`min_spacing`, and
 * the PCB Display Options page ports only the Cross-probing group. A canvas
 * with no page to disagree with cannot drift.
 */
const OWNERS: [editor: string, file: string, cfg: string][] = [
  ['schematic', 'editors/schematic/SchematicEditor.tsx', 'es'],
  ['symbol editor', 'editors/symbol/SymbolEditor.tsx', 'symCfg'],
  ['gerbview', 'editors/gerbview/GerberCanvas.tsx', 'gbrCfg'],
  ['pl_editor', 'editors/drawingsheet/DrawingSheetCanvas.tsx', 'plCfg'],
];

/** The other three apps' settings hooks, for the wrong-object check. */
const HOOKS: Record<string, string> = {
  schematic: 'useEeschemaSettings',
  'symbol editor': 'useSymbolEditorSettings',
  gerbview: 'useGerbviewSettings',
  pl_editor: 'usePlEditorSettings',
};

describe('Grid Display reaches the canvas', () => {
  it.each(OWNERS)('%s reads all three of its own grid appearance keys', (_name, rel, cfg) => {
    const src = read(rel);
    for (const key of ['style', 'line_width', 'min_spacing']) {
      // Anchored on the cfg identifier, so a file that reads the key off some
      // other app's object does not satisfy this.
      expect(src, `${rel} never reads ${cfg}.window.grid.${key}`).toMatch(
        new RegExp(`\\b${cfg}\\.window\\.grid\\.${key}\\b`),
      );
    }
  });

  it.each(OWNERS)('%s asks no other app for its grid', (name, rel) => {
    const src = read(rel);
    for (const [other, hook] of Object.entries(HOOKS)) {
      if (other === name) continue;
      expect(src, `${rel} reaches for ${other}'s settings`).not.toMatch(
        new RegExp(`\\b${hook}\\b`),
      );
    }
  });
});

describe('the two canvases that pass the options straight to drawGrid', () => {
  // The schematic and the Symbol Editor go through a renderer options object,
  // so their names are the renderer's; these two call `drawGrid` in the
  // component and are the pair that was omitting the fields entirely.
  const DIRECT: [editor: string, file: string][] = [
    ['gerbview', 'editors/gerbview/GerberCanvas.tsx'],
    ['pl_editor', 'editors/drawingsheet/DrawingSheetCanvas.tsx'],
  ];

  it.each(DIRECT)('%s names all three in its drawGrid call', (_name, rel) => {
    const src = read(rel);
    // The call spans lines, and `[\s\S]` rather than an indentation-sensitive
    // pattern: an assertion that fails when biome rewraps the argument list is
    // not about the behaviour it claims to be.
    const call = src.match(/drawGrid\([\s\S]*?\n\s*\);/);
    expect(call, `${rel} has no drawGrid call`).not.toBeNull();
    const text = call?.[0] ?? '';
    expect(text).toMatch(/\bstyle:/);
    expect(text).toMatch(/\blineWidthPx:/);
    expect(text).toMatch(/\bminSpacingPx:/);
  });
});

describe('the defaults the omission was hiding behind', () => {
  it('is the same triple in every app, which is why nothing looked wrong', () => {
    // `DEFAULT_GRID_APPEARANCE` and all four settings files agree, so a canvas
    // that passed nothing painted precisely what an untouched page promised.
    // That agreement is upstream's (`gal_display_options.cpp:49-56` against the
    // `.grid.*` params in `app_settings.cpp:549-562`), not a coincidence to
    // preserve by accident.
    for (const [name, d] of [
      ['eeschema', EESCHEMA_DEFAULTS],
      ['symbol_editor', SYMBOL_EDITOR_DEFAULTS],
      ['gerbview', GERBVIEW_DEFAULTS],
      ['pl_editor', PL_EDITOR_DEFAULTS],
    ] as const) {
      expect(d.window.grid.style, name).toBe(DEFAULT_GRID_APPEARANCE.style);
      expect(d.window.grid.line_width, name).toBe(DEFAULT_GRID_APPEARANCE.lineWidthPx);
      expect(d.window.grid.min_spacing, name).toBe(DEFAULT_GRID_APPEARANCE.minSpacingPx);
    }
  });
});
