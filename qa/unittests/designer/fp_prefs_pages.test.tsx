// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Footprint Editor's nine Preferences pages, **rendered**.
 *
 * The same argument `ds_prefs_pages.test.tsx` makes: a page can be in `PAGES`,
 * have a factory case, own a reset slice and be built from a correct table, and
 * still never appear — a bad dynamic import, a panel that throws, a page id the
 * shell cannot resolve. This opens the dialog on each one and reads what came
 * out.
 *
 * Two things here that the drawing sheet's file has no equivalent of, and both
 * are where this heading's parity actually lives:
 *
 *  - the pages that are the SAME upstream class as the PCB Editor's, shown in
 *    their footprint-editor form: Display Options with an empty simplebook
 *    page, Origins & Axes with the Display Origin group hidden, Editing Options
 *    with the board half hidden and Magnetic Points as two checkboxes;
 *  - the three pages that are this editor's own and are grids.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PreferencesDialog } from '@ziroeda/designer/src/dialogs/PreferencesDialog.js';
import { resetPrefsPanelCache } from '@ziroeda/designer/src/dialogs/prefs/lazy_pages.js';
import { GAL_GROUP_TITLES } from '@ziroeda/designer/src/dialogs/prefs/gal_options.js';
import { OVERRIDE_ROWS } from '@ziroeda/designer/src/dialogs/prefs/grid_settings_rows.js';
import { shippedUnder } from '@ziroeda/designer/src/dialogs/prefs/registry.js';
import { FPEDIT_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';
import { fpColorRows } from '@ziroeda/designer/src/editors/footprint/fpColorLayers.js';
import { GRAPHICS_ROWS } from '@ziroeda/designer/src/editors/footprint/graphics_defaults.js';

afterEach(() => {
  cleanup();
  resetPrefsPanelCache();
});

type FpPage =
  | 'fp-display'
  | 'fp-grids'
  | 'fp-origins'
  | 'fp-editing'
  | 'fp-colors'
  | 'fp-toolbars'
  | 'fp-defaults'
  | 'fp-graphics'
  | 'fp-userlayers';

/**
 * Something only that page renders, to wait on. Each is a control the page
 * would not have if the wrong panel came back, so waiting on it is also a check
 * that the id resolved to the right module.
 */
const ANCHOR: Record<FpPage, string> = {
  'fp-display': 'Clearance Outlines',
  'fp-grids': 'Fast Grid Switching',
  'fp-origins': 'X Axis',
  'fp-editing': 'Magnetic Points',
  // `PANEL_COLOR_SETTINGS`' own control is labelled "Theme:" — "Color theme:"
  // is `PANEL_SYM_COLOR_SETTINGS`/`PANEL_PL_EDITOR_COLOR_SETTINGS`, which are
  // a theme choice and no swatch grid.
  'fp-colors': 'Theme:',
  'fp-toolbars': 'Custom Toolbars',
  'fp-defaults': 'Default Text Items for New Footprints',
  'fp-graphics': 'Default Properties for New Graphic Items',
  'fp-userlayers': 'User layers:',
};

/**
 * Open Preferences on a page and wait for its lazily-imported panel.
 *
 * The budget is `ds_prefs_pages.test.tsx`' argument with bigger numbers: the
 * FIRST open in a run compiles the whole lazily imported chain — the dialog,
 * the registry, this editor's factory and every panel it names — and later ones
 * take tens of milliseconds. Measured here at ~9 s for the first and ~40 ms
 * after, on a machine with another build running. A tight budget would be a
 * wall-clock assertion on vitest's transform rather than on anything this file
 * tests, and `SLOW` has to clear it or vitest's own per-test default cuts in
 * first — which is what made `ds_prefs_pages.test.tsx`' 15 s findBy budget
 * unreachable behind a 5 s test.
 */
async function openPage(id: FpPage): Promise<void> {
  render(<PreferencesDialog onClose={() => {}} initialPage={id} />);
  await screen.findByText(ANCHOR[id], { exact: false }, { timeout: 30000 });
}

const panelText = (): string =>
  document.querySelector('.ze-prefs-panel')?.textContent?.replace(/\s+/g, ' ') ?? '';

/** The labels a `Combo` offers — see the note in `ds_prefs_pages.test.tsx`. */
const comboOptions = (root: ParentNode = document): string[] =>
  Array.from(root.querySelectorAll('.ze-combo-ghost')).map((o) => o.textContent ?? '');

/** vitest's own per-test budget, which has to clear `openPage`'s. */
const SLOW = 60000;

describe('the heading is complete', () => {
  it('ships all nine rows `ShowPreferences` adds', () => {
    // `common/eda_base_frame.cpp:1667-1675`, in source order.
    expect(shippedUnder('Footprint Editor')).toEqual([
      'Display Options',
      'Grids',
      'Origins & Axes',
      'Editing Options',
      'Colors',
      'Toolbars',
      'Footprint Defaults',
      'Graphics Defaults',
      'User Layer Names',
    ]);
  });
});

describe('Footprint Editor > Display Options', () => {
  it(
    'is the GAL panel plus the two groups outside the simplebook',
    async () => {
      await openPage('fp-display');
      const text = panelText();
      // `m_galOptionsSizer`, always present.
      for (const title of GAL_GROUP_TITLES) expect(text).toContain(title);
      // `bSizerPads`, which lives in `bSizer11` and so is drawn by BOTH frames.
      expect(text).toContain('Pads');
      expect(text).toContain('Use via color for normal through hole padstacks');
      expect(text).toContain('Clearance Outlines');
      expect(text).toContain('Show pad clearance');
    },
    SLOW,
  );

  it(
    'draws NOTHING from the simplebook: this frame gets the empty page',
    async () => {
      await openPage('fp-display');
      const text = panelText();
      // `m_optionsBook->SetSelection( m_isPCBEdit ? 1 : 0 )` and page 0 is a
      // bare `wxPanel` (`panel_display_options_base.cpp:88-97`). Every string
      // below is on page 1 and must not appear here.
      for (const pcbOnly of [
        'Annotations',
        'Net names:',
        'Show pad numbers',
        'Selection && Highlighting',
        'Cross-probing',
        'Refresh 3D view automatically',
      ]) {
        expect(text, `${pcbOnly} is on the PCB page of the book`).not.toContain(pcbOnly);
      }
    },
    SLOW,
  );
});

describe('Footprint Editor > Grids', () => {
  it(
    'lists this editor’s grids, from the settings and not from the unit',
    async () => {
      await openPage('fp-grids');
      const text = panelText();
      expect(text).toContain('Grids');
      expect(text).toContain('Fast Grid Switching');
      // `defaultGridIdx` 15 for `fpedit` — `0.5 mm`, printed at pcbnew's
      // precision with the imperial pair in brackets.
      expect(text).toContain('0.5000 mm');
    },
    SLOW,
  );

  it(
    'shows exactly the override rows FRAME_FOOTPRINT_EDITOR shows',
    async () => {
      await openPage('fp-grids');
      const text = panelText();
      for (const [, label] of OVERRIDE_ROWS.FRAME_FOOTPRINT_EDITOR) expect(text).toContain(label);
      // `m_checkGridOverrideVias->Show( false )` outside pcbnew, and connected
      // and wires are hidden outside the schematic frames — connected being
      // re-shown as "Pads:" is why that row IS here under another name.
      expect(text).not.toContain('Vias:');
      expect(text).not.toContain('Tracks:');
      expect(text).not.toContain('Connected items:');
    },
    SLOW,
  );
});

describe('Footprint Editor > Origins & Axes', () => {
  it(
    'is X Axis and Y Axis, with the Display Origin group hidden',
    async () => {
      await openPage('fp-origins');
      const text = panelText();
      expect(text).toContain('X Axis');
      expect(text).toContain('Increases right');
      expect(text).toContain('Increases left');
      expect(text).toContain('Y Axis');
      expect(text).toContain('Increases up');
      expect(text).toContain('Increases down');
      // `m_displayOrigin->Show( m_frameType == FRAME_PCB_EDITOR )`
      // (`panel_pcbnew_display_origin.cpp:37`) — the heading and all three
      // radios go with it.
      expect(text).not.toContain('Display Origin');
      expect(text).not.toContain('Page origin');
      expect(text).not.toContain('Drill/place file origin');
      expect(text).not.toContain('Grid origin');
    },
    SLOW,
  );
});

describe('Footprint Editor > Editing Options', () => {
  it(
    'shows the universal group and the footprint page of the book',
    async () => {
      await openPage('fp-editing');
      const text = panelText();
      expect(text).toContain('Constrain actions to H, V, 45 degrees');
      expect(text).toContain('Step for rotate commands:');
      expect(text).toContain('Arc editing mode:');
      // The book's page 0.
      expect(text).toContain('Magnetic Points');
      expect(text).toContain('Magnetic pads');
      expect(text).toContain('Magnetic graphics');
      // `m_stHint1` and its table.
      expect(text).toContain('Left Click Mouse Commands');
      expect(text).toContain('Clarify selection from menu');
    },
    SLOW,
  );

  it(
    'labels the rotation entry with UNIT_BINDER’s degree sign, next to the entry',
    async () => {
      await openPage('fp-editing');
      // `m_rotationAngle` is a UNIT_BINDER on `EDA_UNITS::DEGREES`
      // (`panel_edit_options.cpp:38-45`), and `SetUnits` writes
      // `EDA_UNIT_UTILS::GetLabel( DEGREES )` -- `°` (`eda_units.cpp:153`) --
      // over the `_("deg")` wxFormBuilder put in `_base.cpp:49`.
      const row = Array.from(document.querySelectorAll('.ze-prefs-panel .ze-pref-row')).find(
        (r) => r.querySelector('.lbl')?.textContent === 'Step for rotate commands:',
      );
      expect(row, 'the rotation row').toBeDefined();
      expect(row?.querySelector('.unit')?.textContent).toBe('°');
      // Not the placeholder. ("45 degrees" on the checkbox above is a different
      // row, which is why this reads the row and not the whole page.)
      expect(row?.textContent).not.toContain('deg');
      // The units label is the entry's NEXT sibling, not a cell stranded past
      // some wider control in the same column: `bSizerRotationStep` is a
      // wxBoxSizer, so nothing between them can push it right.
      const entry = row?.querySelector('input[type="text"]');
      expect(entry?.nextElementSibling?.className).toBe('unit');
    },
    SLOW,
  );

  it(
    'stacks the arc-mode label above a full-width choice',
    async () => {
      await openPage('fp-editing');
      // `Add( m_arcEditModeLabel, 0, wxLEFT, 5 )`, a `(0, 3)` spacer, then
      // `Add( m_arcEditMode, 0, wxEXPAND|wxBOTTOM|wxRIGHT|wxLEFT, 5 )`
      // (`panel_edit_options_base.cpp:59-71`) -- two Add()s of a VERTICAL
      // sizer, so the choice is as wide as the column and not a cell beside
      // the label.
      const stacked = document.querySelector('.ze-prefs-panel .ze-pref-stacked');
      expect(stacked, 'the arc-mode block is not a .ze-pref-row').not.toBeNull();
      expect(stacked?.querySelector('.lbl')?.textContent).toBe('Arc editing mode:');
      expect(stacked?.querySelector('.ze-combo')).not.toBeNull();
      // [data] the `(0, 3)` spacer, twice: once above the label and once
      // between it and the choice.
      const style = (stacked as HTMLElement | null)?.style;
      expect(style?.gap).toBe('3px');
      expect(style?.marginTop).toBe('3px');
      // Every choice upstream offers, in upstream's order.
      expect(comboOptions(stacked ?? document)).toEqual([
        'Keep center, adjust radius',
        'Keep endpoints or direction of starting point',
        'Keep center and radius, adjust endpoints',
      ]);
    },
    SLOW,
  );

  it(
    'hides the board half and the Ctrl row’s second radio',
    async () => {
      await openPage('fp-editing');
      const text = panelText();
      // `m_sizerBoardEdit->Show( !m_isFootprintEditor )`
      // (`panel_edit_options.cpp:43`).
      for (const boardOnly of [
        'Track mouse-drag mode:',
        'Flip board items:',
        'Allow free pads',
        'Ratsnest',
        'Automatically refill zones',
        'Snap to pads:',
      ]) {
        expect(text, `${boardOnly} is in m_sizerBoardEdit or the PCB book page`).not.toContain(
          boardOnly,
        );
      }
      // `m_rbHighlightNet->Show( false )` for this frame (`:65-68`), with
      // `m_rbToggleSel` forced on.
      expect(text).toContain('Toggle selection');
      expect(text).not.toContain('Highlight net');
    },
    SLOW,
  );
});

describe('Footprint Editor > Colors', () => {
  it(
    'draws the swatch grid in createSwatches’ order',
    async () => {
      await openPage('fp-colors');
      const text = panelText();
      // The three copper rows come first, before the sorted GAL run.
      const rows = fpColorRows();
      expect(rows.slice(0, 3).map((r) => r.name)).toEqual(['F.Cu', 'Internal Layers', 'B.Cu']);
      for (const r of rows) expect(text).toContain(r.name);
      // `m_optOverrideColors->Hide()` — absent, not greyed.
      expect(text).not.toContain('Override individual item colors');
    },
    SLOW,
  );

  it(
    'excludes the five via and pad-hole layers m_validLayers skips',
    async () => {
      await openPage('fp-colors');
      const text = panelText();
      for (const gone of ['Via holes', 'Via hole walls', 'Plated holes', 'Plated hole walls']) {
        expect(text, `${gone} is one of the five m_validLayers skips`).not.toContain(gone);
      }
      // ...but "Non-plated holes" IS in the list: `board.plated_hole` is
      // LAYER_NON_PLATEDHOLES, which is not one of the five.
      expect(text).toContain('Non-plated holes');
    },
    SLOW,
  );
});

describe('Footprint Editor > Footprint Defaults', () => {
  it(
    'splits the one text-item list into two grids by position',
    async () => {
      await openPage('fp-defaults');
      const text = panelText();
      expect(text).toContain('Default Field Properties for New Footprints');
      expect(text).toContain('Reference designator');
      expect(text).toContain('Default Text Items for New Footprints');
      // The upper grid has a Show column and the lower does not, because
      // everything past index 1 is written back visible.
      expect(text).toContain('Show');
      expect(text).toContain('Text Items');
    },
    SLOW,
  );

  it(
    'seeds the fields from the settings, not from a constant',
    async () => {
      await openPage('fp-defaults');
      const [ref, value] = FPEDIT_DEFAULTS.design_settings.default_footprint_text_items;
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>('.ze-fp-fieldprops input[type="text"]'),
      ).map((i) => i.value);
      expect(inputs[0]).toBe(ref?.text);
      expect(inputs[1]).toBe(value?.text);
      // The third default item — `${REFERENCE}` on F.Fab — is the lower grid's
      // one row on a fresh install.
      const items = Array.from(
        document.querySelectorAll<HTMLInputElement>('.ze-fp-textitems input[type="text"]'),
      ).map((i) => i.value);
      expect(items).toEqual(
        FPEDIT_DEFAULTS.design_settings.default_footprint_text_items.slice(2).map((t) => t.text),
      );
    },
    SLOW,
  );

  it(
    'puts every layer in the cell, not the ones a footprint board has',
    async () => {
      await openPage('fp-defaults');
      // `GRID_CELL_LAYER_SELECTOR( nullptr, {} )` — a null frame, so
      // `getEnabledLayers()` is `LSET::AllLayersMask()` and `UIOrder()` yields
      // 95 rows. See `fp_layer_choices.test.ts` for the list itself; this is
      // the assertion that the PAGE reaches it.
      const cell = document.querySelector('.ze-fp-fieldprops td:last-child');
      const offered = comboOptions(cell ?? document);
      expect(offered).toHaveLength(95);
      expect(offered[0]).toBe('F.Cu');
      expect(offered.at(-1)).toBe('User.45');
      // The renamed ones are shown by `LayerName`, stored by `LSET::Name`.
      expect(offered).toContain('F.Silkscreen');
      expect(offered).not.toContain('F.SilkS');
    },
    SLOW,
  );

  it('is two 610 px grids, not two that fill the dialog', () => {
    // `SetColSize` 240/60/150 with `SetRowLabelSize( 160 )`, and 460/150
    // (`panel_fp_editor_field_defaults_base.cpp:42-52`, `:93-95`) — every
    // width stated, so both grids stop at 610 and the page is empty to the
    // right of them. Column 0 was taking the slack instead, which stretched
    // Value across the dialog and pushed Layer to the far edge.
    const css = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');
    const rule = (selector: string): string => {
      for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g))
        if ((m[1] ?? '').split(',').some((sel) => sel.trim() === selector)) return m[2] ?? '';
      return '';
    };
    expect(rule('.ze-fp-fieldprops')).toMatch(/width:\s*610px/);
    expect(rule('.ze-fp-fieldprops')).toMatch(/table-layout:\s*fixed/);
    expect(rule('.ze-fp-fieldprops th:nth-child(2)')).toMatch(/width:\s*240px/);
    expect(rule('.ze-fp-textitems th:first-child')).toMatch(/width:\s*460px/);
  });
});

describe('Footprint Editor > Graphics Defaults', () => {
  it(
    'is the six layer classes and the shared dimensions panel',
    async () => {
      await openPage('fp-graphics');
      const text = panelText();
      for (const r of GRAPHICS_ROWS) expect(text).toContain(r.label);
      for (const col of ['Line Thickness', 'Text Width', 'Text Height', 'Text Thickness', 'Italic'])
        expect(text).toContain(col);
      // `PANEL_SETUP_DIMENSIONS`, added to this panel's own sizer.
      expect(text).toContain('Default Properties for New Dimension Objects');
      expect(text).toContain('Extension line offset:');
    },
    SLOW,
  );

  it(
    'has no Keep Upright column — that one is Board Setup’s',
    async () => {
      await openPage('fp-graphics');
      // `PANEL_SETUP_TEXT_AND_GRAPHICS` has six columns and this one five
      // (`panel_fp_editor_graphics_defaults_base.cpp:28`, `CreateGrid( 6, 5 )`).
      expect(panelText()).not.toContain('Keep Upright');
      const headers = Array.from(document.querySelectorAll('.ze-fp-gfxgrid thead th'));
      // Five columns plus the row-label column.
      expect(headers).toHaveLength(6);
    },
    SLOW,
  );

  it(
    'blanks the four text cells of Edge Cuts and Courtyards',
    async () => {
      await openPage('fp-graphics');
      const rows = Array.from(document.querySelectorAll('.ze-fp-gfxgrid tbody tr'));
      for (const [i, r] of GRAPHICS_ROWS.entries()) {
        const cells = Array.from(rows[i]?.querySelectorAll('td') ?? []);
        // Column 0 is the line width, which every row has.
        expect(cells[0]?.querySelector('input')).not.toBeNull();
        const disabled = cells.slice(1).filter((c) => c.classList.contains('ze-grid-disabled'));
        expect(disabled, `${r.label}`).toHaveLength(r.text ? 0 : 4);
      }
    },
    SLOW,
  );
});

describe('Footprint Editor > User Layer Names', () => {
  it(
    'offers 0..9 user layers and a Layer/Name grid',
    async () => {
      await openPage('fp-userlayers');
      const text = panelText();
      expect(text).toContain('User layers:');
      expect(text).toContain('User Layer Names');
      // `m_choiceUserLayersChoices` — ten rows, "0" … "9".
      const counts = comboOptions();
      for (const n of ['0', '1', '9']) expect(counts).toContain(n);
    },
    SLOW,
  );

  it(
    'offers the 49 layers its mask leaves, not eight',
    async () => {
      await openPage('fp-userlayers');
      // `AllCuMask() | AllTechMask()` plus Edge_Cuts and Margin
      // (`panel_fp_user_layer_names.cpp:160-164`): the four `*.User`
      // auxiliaries and User.1 … User.45 survive.
      // The grid starts empty — a fresh install has named no user layer — so
      // `m_bpAdd` is what puts a layer cell on the page.
      fireEvent.click(screen.getByLabelText('Add layer'));
      const cell = document.querySelector('.ze-fp-layernames tbody td:first-child');
      expect(cell, 'the added row').not.toBeNull();
      const offered = comboOptions(cell ?? document);
      expect(offered).toHaveLength(49);
      expect(offered[0]).toBe('User.Drawings');
      expect(offered.at(-1)).toBe('User.45');
      expect(offered).not.toContain('F.Cu');
    },
    SLOW,
  );
});
