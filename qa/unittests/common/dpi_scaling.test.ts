// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DPI_SCALING` / `DPI_SCALING_COMMON` (common/dpi_scaling*.cpp) and
 * `GAL_DISPLAY_OPTIONS_IMPL` (common/gal_display_options_common.cpp).
 * Expectations are the C++'s: the default factor is 1.0 (dpi_scaling.cpp:44),
 * the sources are tried config > GDK_SCALE > window > default
 * (dpi_scaling_common.cpp:86-116), and GAL's grid pen is
 * m_scaleFactor * line_width + 0.25 (graphics_abstraction_layer.cpp:124).
 */
import { DPI_SCALING } from '@ziroeda/common/dpi_scaling.js';
import { DPI_SCALING_COMMON } from '@ziroeda/common/dpi_scaling_common.js';
import { GAL_DISPLAY_OPTIONS_IMPL } from '@ziroeda/common/gal_display_options_common.js';
import { GAL } from '@ziroeda/common/gal/graphics_abstraction_layer.js';
import {
  CROSS_HAIR_MODE,
  GRID_SNAPPING,
  GRID_STYLE,
} from '@ziroeda/common/gal/gal_display_options.js';
import { WINDOW_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import { SetEnvVarLookup } from '@ziroeda/common/wx/utils.js';
import { afterEach, describe, expect, it } from 'vitest';

const config = (canvas_scale: number) => ({ m_Appearance: { canvas_scale } });

afterEach(() => SetEnvVarLookup(() => undefined));

describe('DPI_SCALING', () => {
  it('bounds and default are the C++ constants', () => {
    expect(DPI_SCALING.GetMaxScaleFactor()).toBe(6.0);
    expect(DPI_SCALING.GetMinScaleFactor()).toBe(1.0);
    expect(DPI_SCALING.GetDefaultScaleFactor()).toBe(1.0);
  });
});

describe('DPI_SCALING_COMMON', () => {
  const hidpi = { devicePixelRatio: 2 };

  it('a configured scale wins over everything', () => {
    SetEnvVarLookup((n) => (n === 'GDK_SCALE' ? '3' : undefined));
    expect(new DPI_SCALING_COMMON(config(1.5), hidpi).GetScaleFactor()).toBe(1.5);
  });

  it('then GDK_SCALE, then the window, then 1.0', () => {
    SetEnvVarLookup((n) => (n === 'GDK_SCALE' ? '3' : undefined));
    expect(new DPI_SCALING_COMMON(config(0), hidpi).GetScaleFactor()).toBe(3);
    SetEnvVarLookup(() => undefined);
    expect(new DPI_SCALING_COMMON(config(0), hidpi).GetScaleFactor()).toBe(2);
    expect(new DPI_SCALING_COMMON(config(0), null).GetScaleFactor()).toBe(1);
    expect(new DPI_SCALING_COMMON(config(0), hidpi).GetContentScaleFactor()).toBe(2);
  });

  it('is automatic unless the config states a scale; SetDpiConfig writes it', () => {
    const cfg = config(0);
    const dpi = new DPI_SCALING_COMMON(cfg, null);
    expect(dpi.GetCanvasIsAutoScaled()).toBe(true);
    dpi.SetDpiConfig(false, 1.25);
    expect(cfg.m_Appearance.canvas_scale).toBe(1.25);
    expect(dpi.GetCanvasIsAutoScaled()).toBe(false);
    dpi.SetDpiConfig(true, 1.25);
    expect(cfg.m_Appearance.canvas_scale).toBe(0);
    expect(new DPI_SCALING_COMMON(null, null).GetCanvasIsAutoScaled()).toBe(true);
  });
});

describe('GAL_DISPLAY_OPTIONS_IMPL', () => {
  it('reads the window settings through the CFG_MAPs', () => {
    const w = new WINDOW_SETTINGS();
    w.grid.style = 2;
    w.grid.snap = 1;
    w.grid.line_width = 2;
    w.grid.min_spacing = 12;
    w.cursor.cross_hair_mode = CROSS_HAIR_MODE.FULLSCREEN_DIAGONAL;
    w.cursor.always_show_cursor = false;

    const o = new GAL_DISPLAY_OPTIONS_IMPL();
    o.ReadWindowSettings(w);
    expect(o.m_gridStyle).toBe(GRID_STYLE.SMALL_CROSS);
    expect(o.m_gridSnapping).toBe(GRID_SNAPPING.WITH_GRID);
    expect(o.m_gridLineWidth).toBe(2);
    expect(o.m_gridMinSpacing).toBe(12);
    expect(o.GetCursorMode()).toBe(CROSS_HAIR_MODE.FULLSCREEN_DIAGONAL);
    expect(o.m_forceDisplayCursor).toBe(false);

    const back = new WINDOW_SETTINGS();
    o.WriteConfig(back);
    expect([back.grid.style, back.grid.snap, back.grid.line_width]).toEqual([2, 1, 2]);
  });

  it('starts at the default scale, and takes the window scale from ReadCommonConfig', () => {
    const o = new GAL_DISPLAY_OPTIONS_IMPL();
    expect(o.m_scaleFactor).toBe(1.0);
    o.ReadCommonConfig({ ...config(0), m_Graphics: { aa_mode: 2 } }, { devicePixelRatio: 2 });
    expect(o.m_scaleFactor).toBe(2);
    expect(o.antialiasing_mode).toBe(2);
  });

  it('gives GAL the grid pen KiCad does: 1.25 at scale 1 for a width of 1', () => {
    const o = new GAL_DISPLAY_OPTIONS_IMPL();
    o.ReadCommonConfig({ ...config(0), m_Graphics: { aa_mode: 0 } }, null);
    const w = new WINDOW_SETTINGS();
    w.grid.line_width = 1;
    const gal = new GAL(o);
    o.ReadWindowSettings(w);
    expect(gal.GetGridLineWidth()).toBe(1.25);
  });
});
