// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Gerber Viewer > Grids — the shared `PANEL_GRID_SETTINGS` with
 * `FRAME_GERBER`.
 *
 * There is no new panel to test: the page IS the component the schematic's and
 * the Drawing Sheet Editor's Grids pages are. What is worth pinning is the
 * three things gerbview contributes to it, and the one thing that makes it do
 * anything at all — the frame reading `window.grid` out of `gerbview.json`
 * rather than off the module table.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GERBVIEW_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';
import { OVERRIDE_ROWS } from '@ziroeda/common/dialogs/panel_grid_settings.js';
import { DEFAULT_GRID_INDEX, GRID_SIZE_LIST } from '@ziroeda/common/settings/grid_settings_ui.js';
import { gerbIUScale, GERB_IU_PER_MM } from '@ziroeda/common';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { CreateKiWindow, type GBR_PREFS_CONTEXT } from '@ziroeda/gerbview/gerbview.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

/**
 * The Grids page `CreateKiWindow( PANEL_GBR_GRIDS )` makes, called with a
 * working copy in inches: the PANEL_GRID_SETTINGS element and the props it is
 * built with.
 */
function gridsPage(): Record<string, unknown> {
  const gerbview = structuredClone(GERBVIEW_DEFAULTS);
  gerbview.system.units = 'in';
  const page = CreateKiWindow(FRAME_T.PANEL_GBR_GRIDS)!;
  const element = page.Panel({ ctx: { gerbview } as unknown as GBR_PREFS_CONTEXT });
  return (element as unknown as { props: Record<string, unknown> }).props;
}
const FRAME = read('../../gerbview/gerbview_frame_ui.tsx');

/**
 * The frame with its comments blanked, for the NEGATIVE assertions only.
 * `gerbview_drawing_sheet.test.ts` does the same thing for the same reason: a
 * "the frame no longer reaches for X" check that reads prose finds X in the
 * comment SAYING it no longer reaches for it, and fails for writing the
 * explanation down.
 */
const FRAME_CODE = FRAME.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('what gerbview contributes to PANEL_GRID_SETTINGS', () => {
  /**
   * `new PANEL_GRID_SETTINGS( aParent, this, frame, cfg, FRAME_GERBER )`
   * (`gerbview/gerbview.cpp:90`). The frame type is the fifth argument and it
   * subtracts here rather than selecting: the constructor hides the Grid
   * Overrides heading, its rule and every row for FRAME_GERBER
   * (`common/dialogs/panel_grid_settings.cpp:62-90`), so this page is the
   * Grids list and Fast Grid Switching and nothing else.
   */
  it('shows no Grid Overrides row, because gerbview has none', () => {
    expect(OVERRIDE_ROWS.FRAME_GERBER).toEqual([]);
    expect(gridsPage().frameType).toBe('FRAME_GERBER');
    // …and the settings object carries none either, so the page cannot grow
    // one by accident.
    expect(Object.keys(GERBVIEW_DEFAULTS.window.grid.overrides)).toEqual([]);
  });

  /**
   * The `UNITS_PROVIDER` is the KIFACE, `UNITS_PROVIDER( gerbIUScale,
   * EDA_UNITS::MM )` (`gerbview.cpp:60-61`), whose unit is then overwritten
   * with the live frame's — `SetUserUnits( frame->GetUserUnits() )` (`:87`).
   * So the scale is gerbview's own 1e5 IU/mm and the unit is `system.units`.
   */
  it('reads rows at gerbview’s own IU scale, in the frame’s unit', () => {
    expect(GERB_IU_PER_MM).toBe(1e5);
    expect(gerbIUScale.IU_PER_MM).toBe(GERB_IU_PER_MM);
    expect(gridsPage().iuScale).toBe(gerbIUScale);
    expect(gridsPage().units).toBe('in');
  });

  /** `DefaultGridSizeList()`'s gerbview row, and `defaultGridIdx` = 15. */
  it('starts on the grid app_settings.cpp gives gerbview', () => {
    expect(GERBVIEW_DEFAULTS.window.grid.sizes.map((g) => g.x)).toEqual(
      GRID_SIZE_LIST.gerbview.map((g) => g.x),
    );
    expect(GERBVIEW_DEFAULTS.window.grid.last_size_idx).toBe(DEFAULT_GRID_INDEX.gerbview);
    expect(GERBVIEW_DEFAULTS.window.grid.fast_grid_1).toBe(DEFAULT_GRID_INDEX.gerbview);
    expect(GERBVIEW_DEFAULTS.window.grid.fast_grid_2).toBe(DEFAULT_GRID_INDEX.gerbview + 1);
  });

  /**
   * Four of gerbview's grids are NOT square — `1.5 x 2.5 mm` and three with a
   * zero Y (`app_settings.cpp`'s gerbview row). A default list that had
   * squared them would be a different set of grids, and the Grids page shows
   * both columns.
   */
  it('keeps the four non-square rows upstream’s row really has', () => {
    const odd = GERBVIEW_DEFAULTS.window.grid.sizes.filter((g) => g.x !== g.y);
    expect(odd.length).toBe(4);
    expect(odd.map((g) => `${g.x} x ${g.y}`)).toEqual([
      '1.5 mm x 2.5 mm',
      '0.05 mm x 0.0 mm',
      '0.025 mm x 0.0 mm',
      '0.01 mm x 0.0 mm',
    ]);
  });
});

/**
 * The half that makes the page mean anything. `PANEL_GRID_SETTINGS` edits
 * `GRID_SETTINGS::grids` — add, edit, remove and reorder all write `m_grids`
 * back into `gridCfg.grids` (`panel_grid_settings.cpp:190-192`) — so a frame
 * that drew `DefaultGridSizeList()` instead would let the page look like it
 * worked and change nothing. That is the same defect the toolbars had before
 * `useToolbarEntries`, and it is why this is checked per occurrence.
 *
 * Source text, because `qa`'s tsconfig sets no `--jsx` and the frame is a
 * `.tsx`.
 */
describe('the frame draws the grids the page edits', () => {
  // The list, the current row and the write-back are the settings bridge's
  // now, run in gerbview_settings_bridge.test.ts.

  it('reaches for neither the module table nor a local useState', () => {
    // `GRID_SIZE_LIST.gerbview` was the list, and `useState(DEFAULT_GRID_INDEX
    // .gerbview)` the row. Either one back is the page doing nothing.
    expect(FRAME_CODE).not.toContain('GRID_SIZE_LIST.gerbview');
    expect(FRAME_CODE).not.toContain('useState(DEFAULT_GRID_INDEX');
  });

  /**
   * `COMMON_TOOLS::GridProperties` is nothing but `ShowPreferences( _( "Grids" ),
   * <frame name> )` and a return (`common/tool/common_tools.cpp:609-634`), so
   * the grid selector's "Edit Grids..." row opens THIS page. It used to be a
   * row that swallowed the click.
   */
  it('the Edit Grids... row opens this page', () => {
    // ShowPreferences( _( "Grids" ), _( "Gerber Viewer" ) ) arrives at the
    // frame's presenter, which looks the page up (prefs_initial_page.test.tsx).
    expect(FRAME).toContain('setPrefsOpen({ page: aPage, parent: aParentPage })');
    // The page looks it up: the Preferences dialog is the program's.
    const PAGE = read('editors/gerbview/GerberViewer.tsx');
    expect(PAGE).toContain("{...(page === '' ? {} : { initialPage: pageFor(page, parent) })}");
    expect(PAGE).toContain('frameOwner="gerbview"');
  });
});
