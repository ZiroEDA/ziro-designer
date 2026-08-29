// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Drawing Sheet Editor's Preferences pages, **rendered**.
 *
 * Everything else about these pages is checked as data or as source text, and
 * both have the same blind spot: the level-table at the top of
 * `docs/editor-status.md` calls it E1, "anything the code does not say, such as
 * a control that renders but is never reached". A page can be in `PAGES`, have
 * a factory case, own a reset slice and be built from a correct table, and
 * still never appear — a bad dynamic import, a panel that throws, a page id the
 * shell cannot resolve. The PCB Calculator passed 99/99 engine vectors with
 * five panels giving wrong answers because nobody had typed into a box.
 *
 * So this opens the dialog on each of pl_editor's three pages and reads what
 * came out. It is the difference between "the table says FRAME_PL_EDITOR shows
 * Text and Graphics" and "the page on screen shows Text and Graphics".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PreferencesDialog } from '@ziroeda/designer/src/dialogs/PreferencesDialog.js';
import { resetPrefsPanelCache } from '@ziroeda/designer/src/dialogs/prefs/lazy_pages.js';
import {
  GAL_GROUP_TITLES,
  GRID_DISPLAY_LABELS,
  GRID_SNAP_CHOICES,
  GRID_STYLE_CHOICES,
  GRID_THICKNESS_CHOICES,
} from '@ziroeda/designer/src/dialogs/prefs/gal_options.js';
import { OVERRIDE_ROWS } from '@ziroeda/designer/src/dialogs/prefs/grid_settings_rows.js';
import { PL_EDITOR_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';

afterEach(() => {
  cleanup();
  // The shell caches a constructed panel, as a wxTreebook keeps a realised
  // page. Without this the second test in a file would assert against the
  // first's DOM.
  resetPrefsPanelCache();
});

/**
 * Something only that page renders, to wait on. Each is a control the page
 * would not have if the wrong panel came back, so waiting on it is also a
 * check that the id resolved to the right module.
 */
const ANCHOR: Record<'ds-display' | 'ds-grids' | 'ds-colors', string> = {
  'ds-display': GRID_DISPLAY_LABELS[0],
  'ds-grids': 'Fast Grid Switching',
  'ds-colors': 'Color theme:',
};

/** Open Preferences on a page and wait for its lazily-imported panel. */
async function openPage(id: 'ds-display' | 'ds-grids' | 'ds-colors'): Promise<void> {
  render(<PreferencesDialog onClose={() => {}} initialPage={id} />);
  // `AddLazySubPage`: the panel is constructed on first open, so nothing is in
  // the DOM synchronously. `findBy*` retries until it is.
  //
  // The timeout is raised off `findBy`'s 1000 ms default because that default
  // is a WALL-CLOCK assertion on vitest's first transform of the lazily
  // imported page module, not on anything this file is testing: the FIRST
  // `openPage` in a run spends ~1 s compiling that chain and every later one
  // takes ~30 ms. Growing the chain by one module — which porting
  // `DIALOG_GRID_SETTINGS` did — pushed exactly one test over it, which is the
  // shape CLAUDE.md names as a flake rather than a failure. 5 s was still not
  // enough under the FULL suite, where the transform competes with every other
  // worker; the budget is deliberately far larger than the work, because a
  // number that has to be tuned is the assertion this comment says it is not.
  await screen.findByText(ANCHOR[id], { exact: false }, { timeout: 15000 });
}

const panelText = (): string =>
  document.querySelector('.ze-prefs-panel')?.textContent?.replace(/\s+/g, ' ') ?? '';

describe('Drawing Sheet Editor > Display Options', () => {
  it('renders the Grid Display group above the Cursor group', async () => {
    await openPage('ds-display');
    const text = panelText();
    for (const title of GAL_GROUP_TITLES) expect(text, title).toContain(title);
    // Order matters: `mainSizer` adds Grid Display first and Cursor second
    // (`panel_gal_options_base.cpp:17` then `:96`). Ours had only the second.
    expect(text.indexOf(GAL_GROUP_TITLES[0])).toBeLessThan(text.indexOf(GAL_GROUP_TITLES[1]));
  });

  it('renders all four Grid Display controls, which the old modal had none of', async () => {
    await openPage('ds-display');
    for (const label of GRID_DISPLAY_LABELS) expect(panelText(), label).toContain(label);
  });

  it('offers the grid styles as radio buttons, not a dropdown', async () => {
    await openPage('ds-display');
    // `wxRB_GROUP` of three `wxRadioButton`s (`panel_gal_options_base.cpp:31-38`).
    for (const [, label] of GRID_STYLE_CHOICES) {
      const input = screen.getByLabelText(label);
      expect(input.getAttribute('type'), label).toBe('radio');
    }
  });

  it('offers every grid thickness the wxChoice offers', async () => {
    await openPage('ds-display');
    const options = Array.from(document.querySelectorAll('option')).map((o) => o.textContent);
    for (const [, label] of GRID_THICKNESS_CHOICES) expect(options, label).toContain(label);
  });

  it('offers KiCad’s three snap modes', async () => {
    await openPage('ds-display');
    const options = Array.from(document.querySelectorAll('option')).map((o) => o.textContent);
    for (const [, label] of GRID_SNAP_CHOICES) expect(options, label).toContain(label);
  });

  it('shows the crosshair radio and its separate checkbox', async () => {
    await openPage('ds-display');
    expect(screen.getByLabelText('Small crosshairs').getAttribute('type')).toBe('radio');
    expect(screen.getByLabelText('45 degree crosshairs').getAttribute('type')).toBe('radio');
    expect(screen.getByLabelText('Always show crosshairs').getAttribute('type')).toBe('checkbox');
  });

  it('offers no black-background control', async () => {
    await openPage('ds-display');
    expect(panelText().toLowerCase()).not.toContain('black background');
  });
});

describe('Drawing Sheet Editor > Grids', () => {
  it('renders the three groups of PANEL_GRID_SETTINGS', async () => {
    await openPage('ds-grids');
    const text = panelText();
    for (const title of ['Grids', 'Fast Grid Switching', 'Grid Overrides'])
      expect(text, title).toContain(title);
  });

  it('lists this editor’s grids, from the settings and not from the unit', async () => {
    await openPage('ds-grids');
    // `m_currentGridCtrl`, a wxListBox (`panel_grid_settings_base.cpp:29`), so
    // the rows are options and not the text fields they used to be.
    const options = Array.from(document.querySelectorAll('select.ze-gridlist option')).map(
      (o) => o.textContent,
    );
    expect(options).toHaveLength(PL_EDITOR_DEFAULTS.window.grid.sizes.length);

    // `RebuildGridSizes`' `_( "%s%s (%s)" )` (`panel_grid_settings.cpp:139-143`):
    // the optional name, the size in the frame's unit, then in the other one.
    // Written out rather than computed, and re-derived from the C++ rather than
    // read off the page: pl_editor opens in MILS (`app_settings.cpp:228-238`)
    // and counts microns, so it is NOT the eeschema short form —
    // `MessageTextFromValue` gives mils two decimals and mm four
    // (`common/eda_units.cpp:445-460`). 5 mm is 196.8503937 mils.
    expect(options[0]).toBe('196.85 mils (5.0000 mm)');
    expect(options[4]).toBe('19.69 mils (0.5000 mm)');
  });

  it('shows exactly the override rows FRAME_PL_EDITOR shows', async () => {
    await openPage('ds-grids');
    const text = panelText();
    for (const [, label] of OVERRIDE_ROWS.FRAME_PL_EDITOR) expect(text, label).toContain(label);
    // And the three the constructor hides for this frame. This is the assertion
    // the frame table exists for: a shared panel that showed everything to
    // everyone would pass every test above and be wrong here.
    for (const label of ['Connected items:', 'Wires:', 'Vias:'])
      expect(text, `${label} must be hidden for FRAME_PL_EDITOR`).not.toContain(label);
  });
});

describe('Drawing Sheet Editor > Colors', () => {
  it('is one Color theme: choice, with no swatch grid', async () => {
    await openPage('ds-colors');
    expect(panelText()).toContain('Color theme:');
    // `PANEL_PL_EDITOR_COLOR_SETTINGS` does not derive from
    // `PANEL_COLOR_SETTINGS`; its base file is a label and a wxChoice and
    // nothing else (`panel_pl_editor_color_settings_base.cpp:14-32`). A swatch
    // grid here would be an invention.
    expect(document.querySelectorAll('.ze-pref-colorrow')).toHaveLength(0);
    expect(document.querySelectorAll('select')).toHaveLength(1);
  });

  it('offers the theme KiCad’s ResetPanel selects', async () => {
    await openPage('ds-colors');
    // `m_themes->SetStringSelection( _( "KiCad Default" ) )`
    // (`panel_pl_editor_color_settings.cpp:84`).
    const options = Array.from(document.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toContain('KiCad Default');
  });
});

describe('the pages are reachable at all', () => {
  it('every Drawing Sheet Editor page renders something', async () => {
    // The blunt version of the whole file: a page id in `PAGES` whose panel
    // cannot be imported leaves the panel pane empty, and nothing that reads
    // the registry as data would notice.
    for (const id of ['ds-display', 'ds-grids', 'ds-colors'] as const) {
      await openPage(id);
      expect(panelText().length, id).toBeGreaterThan(20);
      cleanup();
      resetPrefsPanelCache();
    }
  });
});
