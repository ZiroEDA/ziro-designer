// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two Preferences panels KiCad keeps in `common/`, and the rule that we
 * keep exactly one of each.
 *
 * `PANEL_GAL_OPTIONS` and `PANEL_GRID_SETTINGS` are not any editor's. Every
 * app's Display Options page constructs and embeds the first
 * (`pagelayout_editor/dialogs/panel_pl_editor_display_options.cpp:38-40`,
 * `eeschema/dialogs/panel_eeschema_display_options.cpp`, and pcbnew's,
 * gerbview's and the footprint editor's), and every KIFACE's Grids page **is**
 * the second, constructed with that app's own `FRAME_T`:
 *
 *     return new PANEL_GRID_SETTINGS( aParent, this, frame, cfg, FRAME_PL_EDITOR );
 *     (pagelayout_editor/pl_editor.cpp:78)
 *
 * That is why porting the Drawing Sheet Editor's Preferences was not four new
 * files: two of its three pages already existed, inlined inside the schematic's,
 * where they had quietly drifted from KiCad. So the assertions here are of two
 * kinds — the data is KiCad's, and there is one copy of it.
 *
 * Both tables live in `.ts` modules rather than inside the `.tsx` panels
 * precisely so this file can read them as values. Scraping JSX as text cannot
 * tell a live range from a commented-out one, which is the trap
 * `ds_preferences.test.ts`' `statements()` helper exists to work around; a
 * value has no such ambiguity.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  GAL_GROUP_TITLES,
  GRID_DISPLAY_LABELS,
  GRID_MIN_SPACING_RANGE,
  GRID_SNAP_CHOICES,
  GRID_STYLE_CHOICES,
  GRID_THICKNESS_CHOICES,
  GRID_THICKNESS_RANGE,
} from '@ziroeda/designer/src/dialogs/prefs/gal_options.js';
import {
  GRID_GROUP_TITLES,
  OVERRIDE_ROWS,
  type GridFrameType,
} from '@ziroeda/designer/src/dialogs/prefs/grid_settings_rows.js';
import { EESCHEMA_DEFAULTS, PL_EDITOR_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** Every `.ts`/`.tsx` under a directory, recursively. */
function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(SRC, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourcesUnder(rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/**
 * The whole Preferences surface: the shared prefs code, plus **every** editor's
 * `prefs/` directory — found by walking `editors/`, not by listing the editors
 * that exist today. An editor that grows a `prefs/` directory tomorrow is
 * covered the moment it does, which is what stops this being a rule scoped to
 * the two editors the duplication was found in.
 *
 * Scoped to Preferences rather than to all of `designer/src` because the same
 * words are legitimately different controls elsewhere: `Cursor` is also a
 * hotkey category and a colour-layer name, and `Style:` is also
 * `DIALOG_TABLE_PROPERTIES`' own control, which upstream likewise writes
 * separately.
 */
const PREFS_DIRS = [
  'dialogs/prefs',
  ...readdirSync(join(SRC, 'editors'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `editors/${e.name}/prefs`)
    .filter((dir) => {
      try {
        readdirSync(join(SRC, dir));
        return true;
      } catch {
        return false;
      }
    }),
];

const SOURCES = PREFS_DIRS.flatMap((dir) => sourcesUnder(dir));

/** Which files contain `needle` as a *statement* — never in a comment. */
function filesWithStatement(needle: string): string[] {
  return SOURCES.filter((rel) =>
    read(rel)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
      .some((l) => l.includes(needle)),
  );
}

// --------------------------------------------------------- PANEL_GAL_OPTIONS

describe('PANEL_GAL_OPTIONS’ Grid Display group', () => {
  it('has the four controls of panel_gal_options_base.cpp, in its order', () => {
    // `m_gridStyleLabel` at :27, then the wxGridBagSizer's three rows at :49,
    // :63, :75. This whole group sits ABOVE the Cursor group we already had,
    // and having none of it is what made #619's G12 more than a detail.
    expect(GRID_DISPLAY_LABELS).toEqual([
      'Style:',
      'Grid thickness:',
      'Minimum grid spacing:',
      'Snap to grid:',
    ]);
  });

  it('sits above a Cursor group, and those are the panel’s only two headings', () => {
    expect(GAL_GROUP_TITLES).toEqual(['Grid Display', 'Cursor']);
  });

  it('offers KiCad’s three grid styles, in KiCad’s order with KiCad’s labels', () => {
    // gridStyleSelectMap (panel_gal_options.cpp:44-49) is DOTS=0, LINES=1,
    // SMALL_CROSS=2, and the radio buttons are in that order at
    // panel_gal_options_base.cpp:31-38.
    expect(GRID_STYLE_CHOICES).toEqual([
      ['dots', 'Dots'],
      ['lines', 'Lines'],
      ['crosses', 'Small crosses'],
    ]);
  });

  it('offers KiCad’s three snap modes, at KiCad’s selection indices', () => {
    // gridSnapConfigVals (panel_gal_options.cpp:52-57): ALWAYS=0,
    // WITH_GRID=1, NEVER=2, and the wxChoice's items at :77 in that order.
    // The index IS the stored value — TransferDataFromWindow assigns
    // `m_gridSnapOptions->GetSelection()` straight to `grid.snap` (:112).
    expect(GRID_SNAP_CHOICES).toEqual([
      [0, 'Always'],
      [1, 'When grid shown'],
      [2, 'Never'],
    ]);
  });

  it('offers grid thicknesses over KiCad’s range, at KiCad’s step, in KiCad’s format', () => {
    // gridThicknessMin/Max/Step = 0.5 / 10.0 / 0.5 (panel_gal_options.cpp:36-38),
    // appended as `wxString::Format( "%.1f", size )` (:65-73). Ours had a spin
    // control ranged 1..5, which could neither reach 0.5 nor 10.
    expect(GRID_THICKNESS_RANGE).toEqual({ min: 0.5, max: 10.0, step: 0.5 });
    expect(GRID_THICKNESS_CHOICES).toHaveLength(20);
    expect(GRID_THICKNESS_CHOICES[0]).toEqual([0.5, '0.5']);
    expect(GRID_THICKNESS_CHOICES[19]).toEqual([10, '10.0']);
    // Every step present, and every label the "%.1f" of its value.
    for (const [i, [value, label]] of GRID_THICKNESS_CHOICES.entries()) {
      expect(value).toBeCloseTo(0.5 + i * 0.5, 10);
      expect(label).toBe(value.toFixed(1));
    }
  });

  it('ranges the minimum grid spacing as the wxSpinCtrl is ranged', () => {
    // gridMinSpacingMin/Max/Step = 5 / 200 / 5 (panel_gal_options.cpp:40-42),
    // SetRange/SetIncrement at :77-78. Ours was 2..50 with no step.
    expect(GRID_MIN_SPACING_RANGE).toEqual({ min: 5, max: 200, step: 5 });
  });

  it('offers only values the settings objects can actually hold', () => {
    // A choice whose value the settings type rejects is a control that cannot
    // round-trip. Both editors that embed this panel are checked, because
    // "right in pl_editor, wrong in eeschema" is the bug shape here.
    for (const [name, defaults] of [
      ['eeschema', EESCHEMA_DEFAULTS],
      ['pl_editor', PL_EDITOR_DEFAULTS],
    ] as const) {
      const styles = GRID_STYLE_CHOICES.map(([v]) => v);
      expect(styles, name).toContain(defaults.window.grid.style);
      expect(
        GRID_SNAP_CHOICES.map(([v]) => v),
        name,
      ).toContain(defaults.window.grid.snap);
      // The default thickness and spacing must be reachable from the controls.
      expect(
        GRID_THICKNESS_CHOICES.map(([v]) => v),
        `${name} default line_width`,
      ).toContain(defaults.window.grid.line_width);
      expect(defaults.window.grid.min_spacing, name).toBeGreaterThanOrEqual(
        GRID_MIN_SPACING_RANGE.min,
      );
      expect(defaults.window.grid.min_spacing, name).toBeLessThanOrEqual(
        GRID_MIN_SPACING_RANGE.max,
      );
    }
  });
});

// ------------------------------------------------------ PANEL_GRID_SETTINGS

describe('PANEL_GRID_SETTINGS is parameterised on the frame, not copied per editor', () => {
  it('has the three group headings of panel_grid_settings_base.cpp', () => {
    expect(GRID_GROUP_TITLES).toEqual(['Grids', 'Fast Grid Switching', 'Grid Overrides']);
  });

  it('shows the Drawing Sheet Editor exactly Text and Graphics', () => {
    // The `else` fall-through of panel_grid_settings.cpp:53-92: vias hidden
    // outside pcbnew, connected and wires hidden outside the schematic frames.
    // FRAME_PL_EDITOR is neither, so two rows survive.
    expect(OVERRIDE_ROWS.FRAME_PL_EDITOR).toEqual([
      ['text', 'Text:'],
      ['graphics', 'Graphics:'],
    ]);
  });

  it('shows the Schematic Editor four rows, and never the vias row', () => {
    // Asserted separately from pl_editor's: one table serving both is only
    // safe if BOTH answers are pinned, and the schematic's is the one a
    // pl_editor-shaped change would silently break.
    expect(OVERRIDE_ROWS.FRAME_SCH).toEqual([
      ['connected', 'Connected items:'],
      ['wires', 'Wires:'],
      ['text', 'Text:'],
      ['graphics', 'Graphics:'],
    ]);
    for (const frame of Object.keys(OVERRIDE_ROWS) as GridFrameType[]) {
      const keys = OVERRIDE_ROWS[frame].map(([k]) => k);
      if (frame !== 'FRAME_PCB_EDITOR') expect(keys, frame).not.toContain('vias');
    }
  });

  it('relabels the connected and wires rows only where KiCad relabels them', () => {
    // SetLabel( _( "Pads:" ) ) at :57 and _( "Footprints/pads:" ) /
    // _( "Tracks:" ) at :67-68 — nowhere else.
    const labelOf = (frame: GridFrameType, key: string): string | undefined =>
      OVERRIDE_ROWS[frame].find(([k]) => k === key)?.[1];
    expect(labelOf('FRAME_FOOTPRINT_EDITOR', 'connected')).toBe('Pads:');
    expect(labelOf('FRAME_PCB_EDITOR', 'connected')).toBe('Footprints/pads:');
    expect(labelOf('FRAME_PCB_EDITOR', 'wires')).toBe('Tracks:');
    expect(labelOf('FRAME_SCH', 'connected')).toBe('Connected items:');
    expect(labelOf('FRAME_SCH', 'wires')).toBe('Wires:');
  });

  it('gives gerbview no overrides group at all', () => {
    // m_overridesLabel and m_staticline3 hidden too (:82-90) — the heading
    // goes with the rows, which is why an empty list has to mean "no group".
    expect(OVERRIDE_ROWS.FRAME_GERBER).toEqual([]);
  });

  it('shows each editor only rows its own settings object can store', () => {
    // The other half of the frame table: a row shown for a key the settings
    // do not carry is a checkbox that writes nowhere.
    const shown = (frame: GridFrameType): string[] => OVERRIDE_ROWS[frame].map(([k]) => k);
    expect(shown('FRAME_PL_EDITOR').sort()).toEqual(
      Object.keys(PL_EDITOR_DEFAULTS.window.grid.overrides).sort(),
    );
    expect(shown('FRAME_SCH').sort()).toEqual(
      Object.keys(EESCHEMA_DEFAULTS.window.grid.overrides).sort(),
    );
  });
});

// ------------------------------------------------------------- one copy each

describe('there is one implementation of each, and both consumers use it', () => {
  it('sweeps every editor’s Preferences directory, not a fixed list of them', () => {
    // If this ever collapses to the shared directory alone, every "exactly one
    // file" assertion below becomes trivially true.
    expect(PREFS_DIRS).toContain('dialogs/prefs');
    expect(PREFS_DIRS).toContain('editors/drawingsheet/prefs');
    expect(PREFS_DIRS).toContain('editors/schematic/prefs');
    expect(PREFS_DIRS.length).toBeGreaterThan(3);
    expect(SOURCES.length).toBeGreaterThan(15);
  });

  /** Every page that upstream builds out of one of the shared panels. */
  const GRID_PAGES = [
    'editors/schematic/prefs/PanelEeschemaGrids.tsx',
    'editors/drawingsheet/prefs/PanelPlEditorGrids.tsx',
  ];
  const DISPLAY_PAGES = [
    'editors/schematic/prefs/PanelEeschemaDisplayOptions.tsx',
    'editors/drawingsheet/prefs/PanelPlEditorDisplayOptions.tsx',
  ];

  it('every Grids page renders the shared panel and declares no controls of its own', () => {
    for (const rel of GRID_PAGES) {
      const src = read(rel);
      expect(src, rel).toContain("from '../../../dialogs/prefs/PanelGridSettings.js'");
      expect(src, rel).toContain('<PanelGridSettings');
      // The tell that a copy has grown back: a page that renders the shared
      // panel has no group of its own to title.
      for (const title of GRID_GROUP_TITLES)
        expect(src, `${rel} declares its own "${title}" group`).not.toContain(`title="${title}"`);
    }
  });

  /**
   * `PANEL_COLOR_SETTINGS` is the third panel `common/` owns, and the one where
   * the interesting half of the rule is the NEGATIVE half. Exactly two of the
   * four Colors pages derive from it:
   *
   *     class PANEL_EESCHEMA_COLOR_SETTINGS : public PANEL_COLOR_SETTINGS
   *     class PANEL_GERBVIEW_COLOR_SETTINGS : public PANEL_COLOR_SETTINGS
   *     class PANEL_SYM_COLOR_SETTINGS      : public PANEL_SYM_COLOR_SETTINGS_BASE
   *     class PANEL_PL_EDITOR_COLOR_SETTINGS: public PANEL_PL_EDITOR_COLOR_SETTINGS_BASE
   *
   * The last two are plain `wxPanel`s with no swatch grid at all — the Symbol
   * Editor's is two radio buttons choosing WHICH settings object the frame
   * asks, and the Drawing Sheet Editor's is a single `wxChoice`. So "unify all
   * four Colors pages" is a wrong reading that this test exists to fail: doing
   * it would invent a per-layer override for two editors that have none.
   */
  const COLOR_SUBCLASSES = [
    'editors/schematic/prefs/PanelEeschemaColorSettings.tsx',
    'editors/gerbview/prefs/PanelGerbviewColorSettings.tsx',
  ];
  const COLOR_NON_SUBCLASSES = [
    'editors/symbol/prefs/PanelSymbolEditorColorSettings.tsx',
    'editors/drawingsheet/prefs/PanelPlEditorColorSettings.tsx',
  ];

  it('both PANEL_COLOR_SETTINGS subclasses render the shared panel', () => {
    for (const rel of COLOR_SUBCLASSES) {
      const src = read(rel);
      expect(src, rel).toContain("from '../../../dialogs/prefs/PanelColorSettings.js'");
      expect(src, rel).toContain('<PanelColorSettings');
      // The tell that a copy has grown back: the swatch grid's own markup,
      // which belongs to the shared panel and to nothing else.
      expect(src, `${rel} rebuilds the swatch grid`).not.toContain('ze-colorgrid');
      expect(src, `${rel} rebuilds the control row`).not.toContain('ze-colorpage-controls');
    }
  });

  it('the two pages that are not that class do not borrow it', () => {
    for (const rel of COLOR_NON_SUBCLASSES) {
      const src = read(rel);
      expect(src, `${rel} is not a PANEL_COLOR_SETTINGS upstream`).not.toContain(
        '<PanelColorSettings',
      );
      // Neither page has a swatch anywhere: no layer list, no per-layer
      // override, nothing to checkerboard against a background layer.
      expect(src, `${rel} grew a swatch grid`).not.toContain('ColorSwatch');
    }
  });

  it('every Display Options page embeds the shared GAL panel', () => {
    for (const rel of DISPLAY_PAGES) {
      const src = read(rel);
      expect(src, rel).toContain("from '../../../dialogs/prefs/PanelGalOptions.js'");
      expect(src, rel).toContain('<PanelGalOptions');
      for (const title of GAL_GROUP_TITLES)
        expect(src, `${rel} declares its own "${title}" group`).not.toContain(`title="${title}"`);
    }
  });

  it('lets no page hardcode a heading either shared panel owns', () => {
    // The duplication shape, swept over the whole Preferences surface rather
    // than over the two consumers: a page that grows its own copy of either
    // panel writes `<Group title="Grid Display">` to do it. Matching the JSX
    // prop rather than the bare word is what keeps this precise — `Cursor` is
    // also a colour-layer name on the schematic's Colors page
    // (`common/layer_id.cpp`), and `Grids` is also a page label.
    for (const title of [...GAL_GROUP_TITLES, ...GRID_GROUP_TITLES]) {
      const files = filesWithStatement(`title="${title}"`).concat(
        filesWithStatement(`title={'${title}'}`),
      );
      expect(files, `"${title}" is hardcoded in ${files.join(', ')}`).toEqual([]);
    }
  });

  it('renders every one of those headings from the shared tables', () => {
    // The other half: banning the literal is only worth anything if the
    // headings still reach the screen. Each is rendered by exactly one panel,
    // by index into its table.
    const gal = read('dialogs/prefs/PanelGalOptions.tsx');
    for (const i of GAL_GROUP_TITLES.keys())
      expect(gal, `GAL_GROUP_TITLES[${i}]`).toContain(`<Group title={GAL_GROUP_TITLES[${i}]}>`);
    const grid = read('dialogs/prefs/PanelGridSettings.tsx');
    // ...except the Grids heading itself, which is NOT a headed group: it is
    // `bSizerLeftCol->Add( m_gridsLabel, 0, wxTOP|wxRIGHT|wxLEFT, 5 )`
    // (`panel_grid_settings_base.cpp:27`) with no `wxStaticLine` after it — the
    // one group label on that page without a rule under it. It still comes from
    // the shared table, which is what this test is for.
    expect(grid, 'GRID_GROUP_TITLES[0]').toContain('{GRID_GROUP_TITLES[0]}');
    expect(grid, 'GRID_GROUP_TITLES[0] draws a rule').toContain('ze-noline');
    for (const i of [...GRID_GROUP_TITLES.keys()].slice(1))
      expect(grid, `GRID_GROUP_TITLES[${i}]`).toContain(`<Group title={GRID_GROUP_TITLES[${i}]}>`);
  });

  it('names each Grid Display control label in exactly one source file', () => {
    for (const label of GRID_DISPLAY_LABELS) {
      const files = filesWithStatement(`'${label}'`).concat(filesWithStatement(`"${label}"`));
      expect(files, `"${label}" is written in ${files.join(', ')}`).toHaveLength(1);
      expect(files[0]).toBe('dialogs/prefs/gal_options.ts');
    }
  });

  it('keeps the frame table out of the panels that consume it', () => {
    // The table is the panel's whole per-editor behaviour. If a page ever
    // spells a row out itself, that page has stopped being parameterised.
    for (const rel of [...GRID_PAGES, 'dialogs/prefs/PanelGridSettings.tsx']) {
      if (rel === 'dialogs/prefs/PanelGridSettings.tsx') continue;
      const src = read(rel);
      for (const [, label] of OVERRIDE_ROWS.FRAME_SCH)
        expect(src, `${rel} spells "${label}"`).not.toContain(`'${label}'`);
    }
    // And the one place it does live is a `.ts`, so it stays assertable.
    expect(filesWithStatement("'Connected items:'")).toEqual([
      'dialogs/prefs/grid_settings_rows.ts',
    ]);
  });
});
