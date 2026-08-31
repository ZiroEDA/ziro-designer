// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_DRAW_FRAME::AddStandardSubMenus` (`common/eda_draw_frame.cpp:709-726`)
 * and the two menus it installs, `ZOOM_MENU` and `GRID_MENU`.
 *
 * The point of the module is that there is ONE of it, because upstream it is
 * one method on the base frame. So these tests are written against two frames
 * with different zoom tables, different grid tables and different IU scales,
 * and assert that the same function serves both.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  STANDARD_SUBMENU_ORDER,
  gridSubMenu,
  standardSubMenuEntries,
  zoomSubMenu,
} from '@ziroeda/designer/src/ui/standard_submenus.js';
import { evaluateConditionalMenu, menuEntry } from '@ziroeda/designer/src/ui/conditional_menu.js';
import {
  GRID_SIZE_LIST,
  gridEntryOf,
  type GridEntry,
} from '@ziroeda/designer/src/ui/grid_settings.js';
import { ZOOM_LIST, zoomPresetLabel } from '@ziroeda/designer/src/ui/zoom_settings.js';
import { PCB_IU_PER_MM, PL_IU_PER_MM } from '@ziroeda/common';

const noop = (): void => {};
const PCB_GRIDS: GridEntry[] = GRID_SIZE_LIST.pcbnew.map(gridEntryOf);
const PL_GRIDS: GridEntry[] = GRID_SIZE_LIST.pl_editor.map(gridEntryOf);

const gridSpec = {
  gridSizes: PCB_GRIDS,
  gridIndex: 0,
  primaryUnits: 'mm' as const,
  iuPerMM: PCB_IU_PER_MM,
  gridOrigin: noop,
  setGrid: noop,
};

describe('ZOOM_MENU', () => {
  /** `zoom_menu.cpp:60-81` — one row per preset of the FRAME's own table. */
  it('is the frame’s own zoom table, and the two frames differ', () => {
    const pcb = zoomSubMenu('pcbnew', 1, noop);
    const pl = zoomSubMenu('pl_editor', 1, noop);
    expect(pcb.map((r) => r.label)).toEqual(ZOOM_LIST.pcbnew.map(zoomPresetLabel));
    expect(pl.map((r) => r.label)).toEqual(ZOOM_LIST.pl_editor.map(zoomPresetLabel));
    // If these were the same table the test above could not fail on a wrong
    // app argument, so pin that they are not.
    expect(pcb.map((r) => r.label)).not.toEqual(pl.map((r) => r.label));
  });

  /** `fabs( zoomList[jj] - zoom ) / zoom < 0.1` — one row ticked, or none. */
  it('ticks the row within 10 % of the current zoom, and only that one', () => {
    const rows = zoomSubMenu('pcbnew', 1.05, noop);
    expect(rows.filter((r) => r.checked)).toHaveLength(1);
    expect(rows.find((r) => r.checked)?.label).toBe('Zoom: 1.00');
    // 1.25 sits between the 1.00 and 1.50 presets, 20 % from each, so no row
    // is within the 10 % window and the menu ticks nothing at all.
    expect(zoomSubMenu('pcbnew', 1.25, noop).filter((r) => r.checked)).toHaveLength(0);
  });

  it('zooms to the picked preset', () => {
    const setZoom = vi.fn();
    const rows = zoomSubMenu('pcbnew', 1, setZoom);
    rows[3]?.action?.();
    expect(setZoom).toHaveBeenCalledWith(ZOOM_LIST.pcbnew[3]);
  });
});

describe('GRID_MENU', () => {
  /** `ACTIONS::gridOrigin` is the first row, then a rule, then the grids. */
  it('opens with Grid Origin and a rule', () => {
    const rows = gridSubMenu(gridSpec);
    expect(rows[0]?.label).toBe('Grid Origin...');
    expect(rows[1]?.sep).toBe(true);
    expect(rows).toHaveLength(2 + PCB_GRIDS.length);
  });

  it('ticks grid.last_size_idx and nothing else', () => {
    const rows = gridSubMenu({ ...gridSpec, gridIndex: 3 }).slice(2);
    expect(rows.map((r) => r.checked)).toEqual(rows.map((_r, i) => i === 3));
  });

  it('picks the grid by its index in the frame’s table', () => {
    const setGrid = vi.fn();
    gridSubMenu({ ...gridSpec, setGrid })
      .slice(2)[5]
      ?.action?.();
    expect(setGrid).toHaveBeenCalledWith(5);
  });

  /**
   * The IU scale is the frame's, and it decides the row's precision. Two
   * frames, two scales, two different strings for the same 0.5 mm grid — which
   * is why the scale is a parameter and not a constant in the module.
   */
  it('formats the rows at the frame’s own IU scale', () => {
    const one: GridEntry[] = [{ name: '', x: '0.5 mm', y: '0.5 mm' }];
    const pcb = gridSubMenu({ ...gridSpec, gridSizes: one, primaryUnits: 'mils' }).slice(2);
    const pl = gridSubMenu({
      ...gridSpec,
      gridSizes: one,
      primaryUnits: 'mils',
      iuPerMM: PL_IU_PER_MM,
    }).slice(2);
    expect(pcb[0]?.label).toBe('19.69 mils (0.5000 mm)');
    expect(pl[0]?.label).toBe('19.69 mils (0.5000 mm)');
    // The tables themselves differ, which is the thing a caller gets wrong.
    expect(PL_GRIDS).not.toEqual(PCB_GRIDS);
  });
});

describe('AddStandardSubMenus', () => {
  const spec = { ...gridSpec, zoomApp: 'pcbnew' as const, zoom: 1, setZoom: noop };

  /**
   *     aMenu.AddSeparator( 1000 );
   *     aMenu.AddMenu( zoomMenu.get(), ShowAlways, 1000 );
   *     aMenu.AddMenu( gridMenu.get(), ShowAlways, 1000 );
   */
  it('is a separator then Zoom then Grid, all at order 1000', () => {
    const entries = standardSubMenuEntries(spec);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.separator).toBe(true);
    expect(entries[1]?.item?.label).toBe('Zoom');
    expect(entries[2]?.item?.label).toBe('Grid');
    expect(entries.map((e) => e.order)).toEqual([1000, 1000, 1000]);
    expect(STANDARD_SUBMENU_ORDER).toBe(1000);
  });

  /** Both are `SELECTION_CONDITIONS::ShowAlways`, so neither is conditioned. */
  it('shows both whatever is selected', () => {
    for (const e of standardSubMenuEntries(spec).slice(1)) expect(e.when).not.toBe(false);
  });

  /**
   * Order 1000 is what puts them last. Anything a tool adds at a lower order —
   * EDIT_TOOL's @150 rows, PCB_SELECTION_TOOL's @1 rows — sorts in front.
   */
  it('sorts after every lower-order row a tool contributes', () => {
    const items = evaluateConditionalMenu([
      ...standardSubMenuEntries(spec),
      menuEntry({ label: 'Select All' }, 150),
      menuEntry({ label: 'Get and Move Footprint' }, -1),
    ]);
    expect(items.map((i) => i.sep ?? i.label)).toEqual([
      'Get and Move Footprint',
      'Select All',
      true,
      'Zoom',
      'Grid',
    ]);
  });

  /**
   * The separator obeys the elision rule like any other: a menu that is ONLY
   * these two rows opens on Zoom, not on a rule.
   */
  it('drops its own separator when nothing precedes it', () => {
    const items = evaluateConditionalMenu(standardSubMenuEntries(spec));
    expect(items.map((i) => i.label)).toEqual(['Zoom', 'Grid']);
  });
});

describe('the launchers that install it', () => {
  const read = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(`../../../designer/src/${rel}`, import.meta.url)), 'utf8');

  /**
   * The point of the module. Upstream this is one base-frame method; a second
   * copy of the Zoom or Grid rows in an editor is the drift it exists to stop,
   * and that is exactly what the Drawing Sheet Editor had.
   */
  it.each([
    ['the drawing sheet', 'editors/drawingsheet/ds_context_menu.ts'],
    ['the PCB editor', 'editors/pcb/PcbEditor.tsx'],
  ])('%s calls the shared one and builds no rows of its own', (_name, rel) => {
    const src = read(rel);
    expect(src).toContain('standardSubMenuEntries({');
    // Per-occurrence, not per-file: the giveaway of a local copy is the label
    // of GRID_MENU's first row, which only the shared module may spell.
    expect(src).not.toContain('Grid Origin...');
    expect(src).not.toContain('zoomPresetLabel');
  });
});
