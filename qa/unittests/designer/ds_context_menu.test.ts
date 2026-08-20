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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildDsContextMenu,
  dsGridSubmenu,
  dsZoomSubmenu,
  gridChoiceLabel,
  secondaryUnits,
  type DsContextMenuActions,
} from '@ziroeda/designer/src/editors/drawingsheet/ds_context_menu.js';
import {
  ZOOM_LIST,
  nextZoomPreset,
  zoomPresetLabel,
  isZoomPresetChecked,
} from '@ziroeda/designer/src/ui/zoom_settings.js';
import type { MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

const noop = (): void => {};
const actions = (over: Partial<DsContextMenuActions> = {}): DsContextMenuActions => ({
  move: noop,
  cut: noop,
  copy: noop,
  paste: noop,
  doDelete: noop,
  drawLine: noop,
  drawRectangle: noop,
  placeText: noop,
  placeImage: noop,
  gridOrigin: noop,
  setZoom: noop,
  setGrid: noop,
  ...over,
});

/** The menu as a user reads it: labels, with a separator as `—`. */
const shape = (items: MenuItem[]): string[] =>
  items.map((it) => (it.sep ? '—' : `${it.label}${it.submenu ? ' ▸' : ''}`));

const state = { zoom: 1, gridIndex: 4, primaryUnits: 'mils' as const };

describe('buildDsContextMenu', () => {
  it('with a selection, matches pl_editor row for row', () => {
    expect(shape(buildDsContextMenu({ ...state, hasSelection: true }, actions()))).toEqual([
      'Move',
      '—',
      'Cut',
      'Copy',
      'Paste',
      'Delete',
      '—',
      'Zoom ▸',
      'Grid ▸',
    ]);
  });

  it('with nothing selected, offers the four SELECTION_CONDITIONS::Empty tools', () => {
    // pl_selection_tool.cpp:60-64 — drawLine / drawRectangle / placeText /
    // placeImage are conditioned on an empty selection and are the only rows
    // that are. Paste is ShowAlways, so it survives into both forms.
    expect(shape(buildDsContextMenu({ ...state, hasSelection: false }, actions()))).toEqual([
      'Draw Lines',
      'Draw Rectangles',
      'Draw Text',
      'Place Bitmaps',
      '—',
      'Paste',
      '—',
      'Zoom ▸',
      'Grid ▸',
    ]);
  });

  it('never opens or closes on a separator (Evaluate drops an empty group’s rule)', () => {
    for (const hasSelection of [true, false]) {
      const items = buildDsContextMenu({ ...state, hasSelection }, actions());
      expect(items[0]?.sep).toBeFalsy();
      expect(items[items.length - 1]?.sep).toBeFalsy();
    }
  });

  it('carries the accelerators the rows print in KiCad', () => {
    const items = buildDsContextMenu({ ...state, hasSelection: true }, actions());
    const key = (label: string): string | undefined =>
      items.find((it) => it.label === label)?.shortcut;
    // PL_ACTIONS::move .DefaultHotkey( 'M' ) — pl_actions.cpp:84.
    expect(key('Move')).toBe('M');
    expect(key('Cut')).toBe('Ctrl+X');
    expect(key('Copy')).toBe('Ctrl+C');
    expect(key('Paste')).toBe('Ctrl+V');
    expect(key('Delete')).toBe('Delete');
  });

  it('runs the action the row names', () => {
    const move = vi.fn();
    const doDelete = vi.fn();
    const items = buildDsContextMenu({ ...state, hasSelection: true }, actions({ move, doDelete }));
    items.find((it) => it.label === 'Move')?.action?.();
    items.find((it) => it.label === 'Delete')?.action?.();
    expect(move).toHaveBeenCalledOnce();
    expect(doDelete).toHaveBeenCalledOnce();
  });
});

describe('the Zoom submenu (ZOOM_MENU)', () => {
  it('is pl_editor’s twenty-entry table, in order', () => {
    const rows = dsZoomSubmenu(1, noop);
    expect(rows).toHaveLength(20);
    expect(rows[0]?.label).toBe('Zoom: 0.02');
    expect(rows[rows.length - 1]?.label).toBe('Zoom: 220.00');
    expect(ZOOM_LIST.pl_editor.map(zoomPresetLabel)).toEqual(rows.map((r) => r.label));
  });

  it('ticks the row nearest the current zoom, within 10 %', () => {
    // zoom_menu.cpp:71-80 — fabs( zoomList[jj] - zoom ) / zoom < 0.1.
    const rows = dsZoomSubmenu(1.05, noop);
    expect(rows.filter((r) => r.checked).map((r) => r.label)).toEqual(['Zoom: 1.00']);
    expect(isZoomPresetChecked(1.0, 1.2)).toBe(false);
  });

  it('jumps straight to the picked preset', () => {
    const setZoom = vi.fn();
    dsZoomSubmenu(1, setZoom)[9]?.action?.();
    expect(setZoom).toHaveBeenCalledWith(2.2);
  });
});

describe('the Grid submenu (GRID_MENU)', () => {
  it('opens with Grid Origin and a rule, then the eight pl_editor grids', () => {
    const rows = dsGridSubmenu(4, 'mils', noop, noop);
    expect(rows[0]?.label).toBe('Grid Origin...');
    expect(rows[1]?.sep).toBe(true);
    expect(rows).toHaveLength(10);
  });

  it('spells a row in both unit systems, as the audit read them off KiCad', () => {
    // Preferences ▸ Drawing Sheet Editor ▸ Grids, captured:
    //   196.85 mils (5.0000 mm) … 19.69 mils (0.5000 mm) … 3.94 mils (0.1000 mm)
    const rows = dsGridSubmenu(4, 'mils', noop, noop).slice(2);
    expect(rows[0]?.label).toBe('196.85 mils (5.0000 mm)');
    expect(rows[4]?.label).toBe('19.69 mils (0.5000 mm)');
    expect(rows[7]?.label).toBe('3.94 mils (0.1000 mm)');
  });

  it('quotes the other unit system, whichever the frame is in', () => {
    // EDA_DRAW_FRAME::GetUnitPair (eda_draw_frame.cpp:1400-1420).
    expect(secondaryUnits('mm')).toBe('mils');
    expect(secondaryUnits('mils')).toBe('mm');
    expect(secondaryUnits('in')).toBe('mm');
    expect(gridChoiceLabel('0.50 mm', 'mm')).toBe('0.5000 mm (19.69 mils)');
  });

  it('ticks grid.last_size_idx and nothing else', () => {
    const rows = dsGridSubmenu(4, 'mils', noop, noop);
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

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the canvas actually raises it', () => {
  const CANVAS = read('../../../designer/src/editors/drawingsheet/DrawingSheetCanvas.tsx');
  const EDITOR = read('../../../designer/src/editors/drawingsheet/DrawingSheetEditor.tsx');

  it('suppresses the browser menu and asks the editor for KiCad’s', () => {
    const at = CANVAS.indexOf('onContextMenu={(e) => {');
    expect(at).toBeGreaterThan(-1);
    const body = CANVAS.slice(at, CANVAS.indexOf('}}', at));
    expect(body).toContain('e.preventDefault()');
    expect(body).toContain('onContextMenuRequest?.(');
    expect(body).toContain('pickDrawItem');
  });

  it('hover-selects only when the selection is empty', () => {
    // pl_selection_tool.cpp:125-129.
    const at = EDITOR.indexOf('const onCanvasContextMenu');
    expect(at).toBeGreaterThan(-1);
    const body = EDITOR.slice(at, EDITOR.indexOf('}, []);', at));
    expect(body).toContain('prev.size === 0 && hit !== null');
    expect(body).toContain('setCtxMenu({ x, y })');
  });

  it('renders the shared ContextMenu, not a private popup', () => {
    expect(EDITOR).toContain('import { MenuBar, ContextMenu,');
    expect(EDITOR).toContain('items={buildDsContextMenu(');
  });
});

describe('DSP-26 — Zoom In / Zoom Out step the table', () => {
  const CANVAS = read('../../../designer/src/editors/drawingsheet/DrawingSheetCanvas.tsx');

  it('no longer multiplies the scale by a constant', () => {
    // Ours measured Z 1.12 -> 3.83 over four Zoom In clicks: a constant x1.30
    // and four zooms that are nowhere in KiCad's table.
    expect(CANVAS).not.toContain('zoomStep(1.3)');
    expect(CANVAS).not.toContain('zoomStep(1 / 1.3)');
  });

  it('asks nextZoomPreset for pl_editor’s table', () => {
    expect(CANVAS).toContain('nextZoomPreset(ZOOM_LIST.pl_editor, now, zoomIn)');
    expect(CANVAS).toContain('zoomIn: () => zoomPresetStep(true)');
    expect(CANVAS).toContain('zoomOut: () => zoomPresetStep(false)');
  });

  it('reads the current zoom as a GAL zoom factor, not as a canvas scale', () => {
    // doZoomInOut starts from GetGAL()->GetZoomFactor(), which is what the
    // status bar's Z field prints and what the table's entries are in.
    expect(CANVAS).toContain('zoomFactorForScale(viewRef.current.scale, dpr, SCH_IU_PER_MM)');
  });

  it('sets the preset absolutely, holding the canvas centre', () => {
    // doZoomToPreset is VIEW::SetScale( zoomList[idx] ), not a relative step.
    // The preset now goes through clampViewScale on the way in, because
    // VIEW::SetScale clamps every scale it is handed (`common/view/view.cpp:583-588`)
    // - so what is asserted is that the value is the PRESET, absolutely, and
    // not a multiple of whatever the scale happened to be.
    expect(CANVAS).toContain('scaleForZoomFactor(factor, dpr, SCH_IU_PER_MM)');
    expect(CANVAS).not.toContain('v.scale *= factor');
  });

  /**
   * `PL_DRAW_PANEL_GAL`'s constructor runs
   * `m_view->SetScaleLimits( ZOOM_MAX_LIMIT_PLEDITOR, ZOOM_MIN_LIMIT_PLEDITOR )`
   * (`pagelayout_editor/pl_draw_panel_gal.cpp:63`) - 20 and 0.05 out of
   * `include/zoom_defines.h:56-58`. The clamp itself lives inside
   * `VIEW::SetScale`, so EVERY way of zooming is limited by it, which is why
   * all three of this canvas' zoom paths have to go through it and not just
   * the wheel.
   */
  it('clamps every zoom path, not only the wheel', () => {
    const clamps = [...CANVAS.matchAll(/clampViewScale\(/g)];
    expect(clamps.length).toBe(3);
    // …and every one of them names pl_editor's row, not another app's.
    expect([...CANVAS.matchAll(/clampViewScale\([\s\S]{0,120}?'(\w+)'/g)].map((m) => m[1])).toEqual(
      ['pl_editor', 'pl_editor', 'pl_editor'],
    );
  });
});
