// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > Drawing Sheet Editor > Colors has to change what is DRAWN:
 * the frame's DS_PAINTER must hold the stored theme's colours, not a value the
 * control writes and nothing reads. The chain is upstream's:
 *
 *   PL_DRAW_PANEL_GAL::PL_DRAW_PANEL_GAL / PL_EDITOR_FRAME::CommonSettingsChanged
 *       m_painter->GetSettings()->LoadColors( ::GetColorSettings( cfg->m_ColorTheme ) )
 *                                    pl_draw_panel_gal.cpp:57-59, pl_editor_frame.cpp:641-650
 *   DS_RENDER_SETTINGS::LoadColors   ds_painter.cpp:58-69
 *       m_backgroundColor = LAYER_SCHEMATIC_BACKGROUND, m_pageBorderColor =
 *       LAYER_SCHEMATIC_GRID, m_normalColor = LAYER_SCHEMATIC_DRAWINGSHEET
 *
 * The two built-ins differ in all three layers, so no assertion here can pass
 * on a shared value: Default is beige / rgb(181,181,181) / rgb(132,0,0) and
 * Classic is WHITE / DARKGRAY / RED (`builtin_color_themes.h`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseColor4d, toCss } from '@ziroeda/common/gal/color4d.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import type { DS_RENDER_SETTINGS } from '@ziroeda/common/drawing_sheet/ds_proxy_view_item.js';
import { PGM_BASE, SetPgm } from '@ziroeda/common/pgm_base.js';
import { EDA_UNITS_INT } from '@ziroeda/common/settings/app_settings.js';
import { loadPlEditorColors } from '@ziroeda/pagelayout_editor/pl_editor_settings_bridge.js';
import { colorSettingsFor } from '@ziroeda/designer/src/editors/drawingsheet/DrawingSheetEditor.js';
import { KICAD_CLASSIC, KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import { settings } from '@ziroeda/designer/src/prefs/settings.js';
import { type Harness, makeHarness } from '../pagelayout_editor/pl_editor_fixture.js';

beforeEach(() => {
  SetPgm(new PGM_BASE());
  DS_DATA_MODEL.SetAltInstance(new DS_DATA_MODEL());
});

afterEach(() => {
  DS_DATA_MODEL.SetAltInstance(null);
  SetPgm(null);
});

const css = (s: string): string => toCss(parseColor4d(s));

function painted(aTheme: string): { h: Harness; rs: DS_RENDER_SETTINGS } {
  const h = makeHarness(EDA_UNITS_INT.MM);
  loadPlEditorColors(h.frame, colorSettingsFor(aTheme));
  const rs = h.view.GetPainter().GetSettings() as DS_RENDER_SETTINGS;
  return { h, rs };
}

describe('the painter holds the colours of the stored theme', () => {
  it('KiCad Default: beige background, grey page border, dark red sheet', () => {
    const { rs } = painted('_builtin_default');

    expect(toCss(rs.GetBackgroundColor())).toBe(css(KICAD_DEFAULT.background));
    expect(toCss(rs.m_pageBorderColor)).toBe(css(KICAD_DEFAULT.grid));
    expect(toCss(rs.GetColor(null, 0))).toBe(css(KICAD_DEFAULT.pageFrame));
  });

  it('KiCad Classic changes all three', () => {
    const { rs } = painted('_builtin_classic');

    expect(toCss(rs.GetBackgroundColor())).toBe(css(KICAD_CLASSIC.background));
    expect(toCss(rs.GetBackgroundColor())).not.toBe(css(KICAD_DEFAULT.background));
    expect(toCss(rs.m_pageBorderColor)).toBe(css(KICAD_CLASSIC.grid));
    expect(toCss(rs.GetColor(null, 0))).toBe(css(KICAD_CLASSIC.pageFrame));
  });

  it('a User-theme override moves the sheet ink off both built-ins', () => {
    settings.setUserColors({ pageFrame: 'rgb(1, 2, 3)' });
    try {
      const { rs } = painted('user');
      expect(toCss(rs.GetColor(null, 0))).toBe(css('rgb(1, 2, 3)'));
    } finally {
      settings.resetUserColors();
    }
  });

  it('a second load repaints without a new frame', () => {
    const { h, rs } = painted('_builtin_default');

    loadPlEditorColors(h.frame, colorSettingsFor('_builtin_classic'));

    expect(toCss(rs.GetBackgroundColor())).toBe(css(KICAD_CLASSIC.background));
  });
});
