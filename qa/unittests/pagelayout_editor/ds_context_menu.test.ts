// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DSP-14 — the Drawing Sheet Editor's canvas context menu, which did not exist:
 * a real right-click on our canvas added no element to the DOM at all, so
 * `PL_ACTIONS::move` had no UI home and `Zoom ▸` / `Grid ▸` were unreachable.
 *
 * The two forms below are what the driven audit captured out of real pl_editor
 * 10.0.5 (`shots/k_ctxmenu_empty.png`, `shots/k_ctx_zoom.png`), and they follow
 * from `CONDITIONAL_MENU::Evaluate` (`common/tool/conditional_menu.cpp:128-190`)
 * over the entries `PL_SELECTION_TOOL::Init`, `PL_EDIT_TOOL::Init` and
 * `EDA_DRAW_FRAME::AddStandardSubMenus` put in.
 */
import { describe, expect, it, vi } from 'vitest';
// `ZOOM_MENU` and `GRID_MENU` were a third copy inside ds_context_menu.ts.
// Upstream they are installed by ONE base-frame method,
// `EDA_DRAW_FRAME::AddStandardSubMenus`, so they live in one shared module and
// the test reads them from there — the same rows the PCB editor's menu ends
// with.
import { gridSubMenu, zoomSubMenu } from '@ziroeda/common/eda_draw_frame_submenus.js';
// Both of these used to be a second copy inside ds_context_menu.ts. They are
// `common/` helpers upstream, so there is one copy now and the test reads it
// from where it lives.
import { gridChoiceLabel, secondaryUnits } from '@ziroeda/common/settings/grid_settings_ui.js';
import { PCB_IU_PER_MM, PL_IU_PER_MM } from '@ziroeda/common';
import {
  ZOOM_LIST,
  nextZoomPreset,
  zoomPresetLabel,
  isZoomPresetChecked,
} from '@ziroeda/common/settings/zoom_settings.js';
import type { MenuItem } from '@ziroeda/common/tool/action_menu_types.js';
import { PL_EDITOR_DEFAULTS } from '@ziroeda/designer/src/prefs/settings.js';

const noop = (): void => {};

/** The menu as a user reads it: labels, with a separator as `—`. */
const shape = (items: MenuItem[]): string[] =>
  items.map((it) => (it.sep ? '—' : `${it.label}${it.submenu ? ' ▸' : ''}`));

/**
 * The grid list the menu is handed. `GRID_MENU` reads `GRID_SETTINGS::grids`
 * off the settings object, not `DefaultGridSizeList()`, which is what makes
 * Preferences > Drawing Sheet Editor > Grids able to change these rows. The
 * default the editor seeds that setting with is the pl_editor row of the table.
 */
const PL_GRIDS = PL_EDITOR_DEFAULTS.window.grid.sizes;

const state = { zoom: 1, gridIndex: 4, gridSizes: PL_GRIDS, primaryUnits: 'mils' as const };

describe('the Zoom submenu (ZOOM_MENU)', () => {
  it('is pl_editor’s twenty-entry table, in order', () => {
    const rows = zoomSubMenu('pl_editor', 1, noop);
    expect(rows).toHaveLength(20);
    expect(rows[0]?.label).toBe('Zoom: 0.02');
    expect(rows[rows.length - 1]?.label).toBe('Zoom: 220.00');
    expect(ZOOM_LIST.pl_editor.map(zoomPresetLabel)).toEqual(rows.map((r) => r.label));
  });

  it('ticks the row nearest the current zoom, within 10 %', () => {
    // zoom_menu.cpp:71-80 — fabs( zoomList[jj] - zoom ) / zoom < 0.1.
    const rows = zoomSubMenu('pl_editor', 1.05, noop);
    expect(rows.filter((r) => r.checked).map((r) => r.label)).toEqual(['Zoom: 1.00']);
    expect(isZoomPresetChecked(1.0, 1.2)).toBe(false);
  });

  it('jumps straight to the picked preset', () => {
    const setZoom = vi.fn();
    zoomSubMenu('pl_editor', 1, setZoom)[9]?.action?.();
    expect(setZoom).toHaveBeenCalledWith(2.2);
  });
});

describe('the Grid submenu (GRID_MENU)', () => {
  it('opens with Grid Origin and a rule, then the eight pl_editor grids', () => {
    const rows = gridSubMenu({
      gridSizes: PL_GRIDS,
      gridIndex: 4,
      primaryUnits: 'mils',
      iuPerMM: PL_IU_PER_MM,
      gridOrigin: noop,
      setGrid: noop,
    });
    expect(rows[0]?.label).toBe('Grid Origin...');
    expect(rows[1]?.sep).toBe(true);
    expect(rows).toHaveLength(10);
  });

  it('spells a row in both unit systems, as the audit read them off KiCad', () => {
    // Preferences ▸ Drawing Sheet Editor ▸ Grids, captured:
    //   196.85 mils (5.0000 mm) … 19.69 mils (0.5000 mm) … 3.94 mils (0.1000 mm)
    const rows = gridSubMenu({
      gridSizes: PL_GRIDS,
      gridIndex: 4,
      primaryUnits: 'mils',
      iuPerMM: PL_IU_PER_MM,
      gridOrigin: noop,
      setGrid: noop,
    }).slice(2);
    expect(rows[0]?.label).toBe('196.85 mils (5.0000 mm)');
    expect(rows[4]?.label).toBe('19.69 mils (0.5000 mm)');
    expect(rows[7]?.label).toBe('3.94 mils (0.1000 mm)');
  });

  it('quotes the other unit system, whichever the frame is in', () => {
    // EDA_DRAW_FRAME::GetUnitPair (eda_draw_frame.cpp:1400-1420).
    expect(secondaryUnits('mm')).toBe('mils');
    expect(secondaryUnits('mils')).toBe('mm');
    expect(secondaryUnits('in')).toBe('mm');
    // A GRID row, not a bare string: `GRID` carries an x and a y, and the
    // label collapses them only when the two print the same.
    expect(gridChoiceLabel({ x: '0.50 mm', y: '0.50 mm' }, 'mm', PL_IU_PER_MM)).toBe(
      '0.5000 mm (19.69 mils)',
    );
    // The four gerbview defaults that are not square print both axes —
    // `GRID::MessageText` returns "%s x %s" when the formatted strings differ
    // (`common/settings/grid_settings.cpp:41-44`). This entry is what makes
    // GerbView's grid box as wide as it is.
    expect(gridChoiceLabel({ x: '1.5 mm', y: '2.5 mm' }, 'mm', PCB_IU_PER_MM)).toBe(
      '1.5000 mm x 2.5000 mm (59.06 mils x 98.43 mils)',
    );
  });

  it('ticks grid.last_size_idx and nothing else', () => {
    const rows = gridSubMenu({
      gridSizes: PL_GRIDS,
      gridIndex: 4,
      primaryUnits: 'mils',
      iuPerMM: PL_IU_PER_MM,
      gridOrigin: noop,
      setGrid: noop,
    });
    expect(rows.filter((r) => r.checked).map((r) => r.label)).toEqual(['19.69 mils (0.5000 mm)']);
  });
});

describe('nextZoomPreset (COMMON_TOOLS::doZoomInOut)', () => {
  const L = ZOOM_LIST.pl_editor;

  it('lands on the first entry at least 1.3x away', () => {
    // 1.0 * 1.3 = 1.3, and the next entry at or above it is 2.2.
    expect(nextZoomPreset(L, 1.0, true)).toBe(2.2);
    // 1.0 / 1.3 = 0.769, and the last entry at or below it is 0.6.
    expect(nextZoomPreset(L, 1.0, false)).toBe(0.6);
  });

  it('pegs to the end of the list rather than running off it', () => {
    expect(nextZoomPreset(L, 220, true)).toBe(220);
    expect(nextZoomPreset(L, 0.022, false)).toBe(0.022);
  });

  it('always moves off an off-table zoom', () => {
    expect(nextZoomPreset(L, 1.19, true)).toBe(2.2);
    expect(nextZoomPreset(L, 1.19, false)).toBe(0.6);
  });
});
