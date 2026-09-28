// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The constants the five plot backends used to each declare for themselves.
 * They have one declaration now, so they need one test: a wrong value here
 * moves PostScript, SVG, PDF, PNG and DXF output at once, and until this file
 * existed nothing pinned the values at all — plot_ps, plot_svg and plot_dxf
 * route every use through the symbol, so changing it was invisible to them.
 */

import { describe, it, expect } from 'vitest';

import { DO_NOT_SET_LINE_WIDTH, USE_DEFAULT_LINE_WIDTH } from '@ziroeda/common/plotters/plotter.js';
import {
  DEFAULT_DASH_LENGTH_RATIO,
  DEFAULT_GAP_LENGTH_RATIO,
  plotterRenderSettings,
} from '@ziroeda/common/render_settings.js';
import { fixed } from '@ziroeda/common/plotters/fmt.js';

import { PLOTTER } from '@ziroeda/common/plotters/plotter.js';
import { PS_PLOTTER } from '@ziroeda/common/plotters/PS_plotter.js';
import { SVG_PLOTTER } from '@ziroeda/common/plotters/SVG_plotter.js';
import { PDF_PLOTTER } from '@ziroeda/common/plotters/PDF_plotter.js';
import { DXF_PLOTTER } from '@ziroeda/common/plotters/DXF_plotter.js';

describe('PLOTTER line-width sentinels', () => {
  it('are the values plotter.h:139-140 declares', () => {
    expect(DO_NOT_SET_LINE_WIDTH).toBe(-2);
    expect(USE_DEFAULT_LINE_WIDTH).toBe(-1);
  });

  it('are distinct, and negative so neither can collide with a real width', () => {
    expect(DO_NOT_SET_LINE_WIDTH).not.toBe(USE_DEFAULT_LINE_WIDTH);
    expect(DO_NOT_SET_LINE_WIDTH).toBeLessThan(0);
    expect(USE_DEFAULT_LINE_WIDTH).toBeLessThan(0);
  });

  it('are PLOTTER statics, inherited by every class in the tree', () => {
    expect(PLOTTER.DO_NOT_SET_LINE_WIDTH).toBe(DO_NOT_SET_LINE_WIDTH);
    expect(PLOTTER.USE_DEFAULT_LINE_WIDTH).toBe(USE_DEFAULT_LINE_WIDTH);

    for (const cls of [PS_PLOTTER, PDF_PLOTTER, SVG_PLOTTER, DXF_PLOTTER]) {
      expect(cls.DO_NOT_SET_LINE_WIDTH).toBe(DO_NOT_SET_LINE_WIDTH);
      expect(cls.USE_DEFAULT_LINE_WIDTH).toBe(USE_DEFAULT_LINE_WIDTH);
      expect(new cls(null, (b: Uint8Array) => b)).toBeInstanceOf(PLOTTER);
    }
  });
});

describe('RENDER_SETTINGS dash geometry', () => {
  it('defaults to the ISO 128-2 ratios of render_settings.cpp:32-33', () => {
    expect(DEFAULT_DASH_LENGTH_RATIO).toBe(12);
    expect(DEFAULT_GAP_LENGTH_RATIO).toBe(3);
  });

  it('applies GetDashLength / GetDotLength / GetGapLength at correction 1.0', () => {
    const rs = plotterRenderSettings();
    // (12 - 1) * w, max(1 - 1, 0.2) * w, (3 + 1) * w — render_settings.cpp:65-83.
    expect(rs.GetDashLength(100)).toBe(1100);
    expect(rs.GetDotLength(100)).toBeCloseTo(20, 10);
    expect(rs.GetGapLength(100)).toBe(400);
    expect(rs.GetDefaultPenWidth()).toBe(0);
  });

  it('floors the dash and gap at one width, so a hairline still dashes', () => {
    const rs = plotterRenderSettings({ dashLengthRatio: 1, gapLengthRatio: 0 });
    expect(rs.GetDashLength(100)).toBe(100);
    expect(rs.GetGapLength(100)).toBe(100);
  });
});

describe('fmt {:.Nf}', () => {
  it('emits exactly the precision it is asked for', () => {
    expect(fixed(1.5, 0)).toBe('2');
    expect(fixed(1.5, 1)).toBe('1.5');
    expect(fixed(1.5, 4)).toBe('1.5000');
    expect(fixed(1, 6)).toBe('1.000000');
  });

  it('rounds ties to even, as %.*f does and toFixed does not', () => {
    expect(fixed(0.5, 0)).toBe('0');
    expect(fixed(1.5, 0)).toBe('2');
    expect(fixed(2.5, 0)).toBe('2');
    expect(fixed(0.125, 2)).toBe('0.12');
    expect(fixed(0.375, 2)).toBe('0.38');
  });

  it('keeps the sign of a negative zero, which PDF depends on', () => {
    expect(fixed(-0, 3)).toBe('-0.000');
    expect(fixed(-1e-9, 3)).toBe('-0.000');
    expect(fixed(0, 3)).toBe('0.000');
  });
});
