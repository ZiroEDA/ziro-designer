// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview.json` both ways: the page's settings slice into the
 * GERBVIEW_SETTINGS the frame reads, and the fields the frame's tools write
 * back. Upstream this is one object that `JSON_SETTINGS::Load` fills and
 * `Store` writes; here the file is the slice.
 *
 * The grids are why this exists as a test: Preferences > Gerber Viewer >
 * Grids edits the slice, and the frame must draw what the page edited - the
 * list, the current row - and write the row back when its selector changes.
 */
import { describe, expect, it } from 'vitest';
import { CROSS_HAIR_MODE } from '@ziroeda/common/gal/gal_display_options.js';
import { GERBVIEW_SETTINGS } from '@ziroeda/gerbview/gerbview_settings.js';
import { GERBER_DRAW_LAYER, GERBVIEW_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import { graphicLayerKey } from '@ziroeda/gerbview/dialogs/panel_gerbview_color_settings.js';
import type { GERBVIEW_FRAME } from '@ziroeda/gerbview/gerbview_frame.js';
import {
  loadGerbviewColors,
  loadGerbviewSettings,
  storeGerbviewSettings,
} from '@ziroeda/gerbview/gerbview_settings_bridge.js';
import { GERBVIEW_DEFAULTS, type GerbviewSettings } from '@ziroeda/designer/src/prefs/settings.js';

const slice = (): GerbviewSettings => structuredClone(GERBVIEW_DEFAULTS);

describe('loadGerbviewSettings', () => {
  it('takes the grid list and the current row from gerbview.json', () => {
    const json = slice();
    json.window.grid.sizes = [
      { name: '', x: '1.0 mm', y: '1.0 mm' },
      { name: '', x: '0.25 mm', y: '0.25 mm' },
    ];
    json.window.grid.last_size_idx = 1;
    const cfg = new GERBVIEW_SETTINGS();

    loadGerbviewSettings(cfg, json);

    expect(cfg.m_Window.grid.grids.map((g) => [g.x, g.y])).toEqual([
      ['1.0 mm', '1.0 mm'],
      ['0.25 mm', '0.25 mm'],
    ]);
    expect(cfg.m_Window.grid.last_size_idx).toBe(1);
  });

  it('fills the SAME object, so the frame config() keeps its identity', () => {
    const cfg = new GERBVIEW_SETTINGS();
    const grid = cfg.m_Window.grid;

    loadGerbviewSettings(cfg, slice());

    expect(cfg.m_Window.grid).toBe(grid);
  });

  it('maps the stored style and crosshair names to their enums', () => {
    // grid.style is 0 dots, 1 lines, 2 crosses (app_settings.cpp).
    const json = slice();
    json.window.grid.style = 'crosses';
    json.window.cursor.crosshair = '45';
    const cfg = new GERBVIEW_SETTINGS();

    loadGerbviewSettings(cfg, json);

    expect(cfg.m_Window.grid.style).toBe(2);
    expect(cfg.m_Window.cursor.cross_hair_mode).toBe(CROSS_HAIR_MODE.FULLSCREEN_DIAGONAL);
  });
});

describe('storeGerbviewSettings', () => {
  it('reports no change for a frame nobody touched, so a mount does not commit', () => {
    const json = slice();
    const cfg = new GERBVIEW_SETTINGS();
    loadGerbviewSettings(cfg, json);

    expect(storeGerbviewSettings(cfg, json)).toBe(false);
    expect(json).toEqual(slice());
  });

  it("writes the Map Gerber Layers dialog's Store Choice, and reads it back", () => {
    // `gerber_to_pcb_layers` / `gerber_to_pcb_copperlayers_count`
    // (gerbview_settings.cpp:74-78), which OnStoreSetup fills.
    const json = slice();
    const cfg = new GERBVIEW_SETTINGS();
    loadGerbviewSettings(cfg, json);

    cfg.m_BoardLayersCount = 6;
    cfg.m_GerberToPcbLayerMapping = [0, 4, -1, -2];

    expect(storeGerbviewSettings(cfg, json)).toBe(true);
    expect(json.gerber_to_pcb_copperlayers_count).toBe(6);
    expect(json.gerber_to_pcb_layers).toEqual([0, 4, -1, -2]);
    // A copy, not the frame's own array.
    expect(json.gerber_to_pcb_layers).not.toBe(cfg.m_GerberToPcbLayerMapping);
    expect(storeGerbviewSettings(cfg, json)).toBe(false);

    const back = new GERBVIEW_SETTINGS();
    loadGerbviewSettings(back, json);
    expect(back.m_BoardLayersCount).toBe(6);
    expect(back.m_GerberToPcbLayerMapping).toEqual([0, 4, -1, -2]);
  });

  it('notices a changed id in a stored mapping of the same length', () => {
    const json = slice();
    const cfg = new GERBVIEW_SETTINGS();
    json.gerber_to_pcb_layers = [0, 2];
    loadGerbviewSettings(cfg, json);

    cfg.m_GerberToPcbLayerMapping = [0, 4];

    expect(storeGerbviewSettings(cfg, json)).toBe(true);
    expect(json.gerber_to_pcb_layers).toEqual([0, 4]);
  });

  it('writes a grid change back to gerbview.json', () => {
    const json = slice();
    const cfg = new GERBVIEW_SETTINGS();
    loadGerbviewSettings(cfg, json);

    cfg.m_Window.grid.last_size_idx = json.window.grid.last_size_idx + 1;

    expect(storeGerbviewSettings(cfg, json)).toBe(true);
    expect(json.window.grid.last_size_idx).toBe(GERBVIEW_DEFAULTS.window.grid.last_size_idx + 1);
  });

  it('writes the toggles the tools flip, and the crosshair mode by name', () => {
    const json = slice();
    const cfg = new GERBVIEW_SETTINGS();
    loadGerbviewSettings(cfg, json);

    cfg.m_Display.m_DisplayPolygonsFill = !json.display.polygons_fill;
    cfg.m_Appearance.show_dcodes = !json.appearance.show_dcodes;
    cfg.m_Window.cursor.cross_hair_mode = CROSS_HAIR_MODE.FULLSCREEN_CROSS;

    expect(storeGerbviewSettings(cfg, json)).toBe(true);
    expect(json.display.polygons_fill).toBe(!GERBVIEW_DEFAULTS.display.polygons_fill);
    expect(json.appearance.show_dcodes).toBe(!GERBVIEW_DEFAULTS.appearance.show_dcodes);
    expect(json.window.cursor.crosshair).toBe('full');
  });
});

/**
 * The colour store, which the Layers Manager and Preferences > Gerber Viewer >
 * Colors both write, into the frame's COLOR_SETTINGS - every row, so a reset
 * override goes back to the theme's colour instead of keeping the last one.
 */
describe('loadGerbviewColors', () => {
  const frameOn = (aCs: COLOR_SETTINGS): GERBVIEW_FRAME =>
    ({ GetColorSettings: () => aCs }) as unknown as GERBVIEW_FRAME;
  const css = (c: { r: number; g: number; b: number }): string =>
    `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;

  it('puts an override on its row and the fixed layer on its id', () => {
    const cs = new COLOR_SETTINGS();

    loadGerbviewColors(frameOn(cs), {
      [graphicLayerKey(3)]: 'rgb(1, 2, 3)',
      'gerbview.dcodes': 'rgb(4, 5, 6)',
    });

    expect(css(cs.GetColor(GERBER_DRAW_LAYER(3)))).toBe('1,2,3');
    expect(css(cs.GetColor(GERBVIEW_LAYER_ID.LAYER_DCODES))).toBe('4,5,6');
  });

  it('returns a reset row, and a reset fixed layer, to the theme default', () => {
    const cs = new COLOR_SETTINGS();
    const defaultRow = css(cs.GetDefaultColor(GERBER_DRAW_LAYER(3)));
    const defaultDcodes = css(cs.GetDefaultColor(GERBVIEW_LAYER_ID.LAYER_DCODES));

    loadGerbviewColors(frameOn(cs), {
      [graphicLayerKey(3)]: 'rgb(1, 2, 3)',
      'gerbview.dcodes': 'rgb(4, 5, 6)',
    });
    loadGerbviewColors(frameOn(cs), {});

    expect(defaultRow).not.toBe('1,2,3');
    expect(css(cs.GetColor(GERBER_DRAW_LAYER(3)))).toBe(defaultRow);
    expect(css(cs.GetColor(GERBVIEW_LAYER_ID.LAYER_DCODES))).toBe(defaultDcodes);
  });
});
