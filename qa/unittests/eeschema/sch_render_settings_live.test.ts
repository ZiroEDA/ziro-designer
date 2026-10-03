// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_RENDER_SETTINGS (sch_render_settings.cpp/.h): the constructor's pens, LoadColors, and
 * the colour queries. Every number below is read off the C++ and default_values.h.
 */
import { GAL_LAYER_ID, SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { COLOR_SETTINGS } from '@ziroeda/common/settings/color_settings.js';
import {
  setEeschemaSettingsProvider,
  EESCHEMA_DEFAULTS,
} from '@ziroeda/eeschema/eeschema_settings.js';
import { SCH_RENDER_SETTINGS, asSchRenderSettings } from '@ziroeda/eeschema/sch_render_settings.js';
import { TRANSFORM } from '@ziroeda/kimath/src/transform.js';
import { afterEach, describe, expect, it } from 'vitest';

const [DEFAULT_THEME, CLASSIC_THEME] = COLOR_SETTINGS.CreateBuiltinColorSettings();

afterEach(() => setEeschemaSettingsProvider(() => EESCHEMA_DEFAULTS));

describe('SCH_RENDER_SETTINGS', () => {
  it("starts with KiCad's pens: 6 mil lines, ISO 128-2 dashes, a 0.0212 mm floor", () => {
    const s = new SCH_RENDER_SETTINGS();
    expect(s.GetDefaultPenWidth()).toBe(6 * 254);
    expect(s.GetDashLengthRatio()).toBe(12);
    expect(s.GetGapLengthRatio()).toBe(3);
    expect(s.GetMinPenWidth()).toBe(212); // KiROUND( 0.0212 * 10000 )
    expect(s.m_SymbolLineWidth).toBe(6 * 254);
    expect(s.m_PinSymbolSize).toBe((50 * 254) / 2);
    expect(s.m_LabelSizeRatio).toBe(0.375);
    expect(s.m_TextOffsetRatio).toBe(0.15);
    expect(s.GetDanglingIndicatorThickness()).toBe(508); // m_defaultPenWidth / 3
  });

  it('starts with what the header initialises', () => {
    const s = new SCH_RENDER_SETTINGS();
    expect([s.m_IsSymbolEditor, s.m_ShowUnit, s.m_ShowBodyStyle]).toEqual([false, 0, 0]);
    expect([s.m_ShowPinsElectricalType, s.m_ShowHiddenPins, s.m_ShowHiddenFields]).toEqual([
      true,
      true,
      true,
    ]);
    expect([s.m_ShowVisibleFields, s.m_ShowPinNumbers, s.m_ShowPinNames]).toEqual([
      true,
      false,
      false,
    ]);
    expect([s.m_ShowPinAltIcons, s.m_ShowDisabled, s.m_ShowGraphicsDisabled]).toEqual([
      false,
      false,
      false,
    ]);
    expect([s.m_ShowConnectionPoints, s.m_OverrideItemColors]).toEqual([false, false]);
  });

  it("loads the schematic layers' colours, and the schematic's aux colour for LAYER_AUX_ITEMS", () => {
    const s = new SCH_RENDER_SETTINGS();
    s.LoadColors(DEFAULT_THEME!);
    // builtin_color_themes.h:32
    expect(s.GetBackgroundColor()).toEqual({ r: 245 / 255, g: 244 / 255, b: 239 / 255, a: 1 });
    expect(s.GetColor(null, SCH_LAYER_ID.LAYER_SCHEMATIC_GRID)).toEqual({
      r: 181 / 255,
      g: 181 / 255,
      b: 181 / 255,
      a: 1,
    });
    // The theme's own LAYER_AUX_ITEMS is white (:159); the schematic's aux items are black (:31).
    expect(s.GetColor(null, GAL_LAYER_ID.LAYER_AUX_ITEMS)).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    // A GAL layer comes from the theme too.
    expect(s.GetColor(null, GAL_LAYER_ID.LAYER_DRAWINGSHEET)).toEqual(
      DEFAULT_THEME!.GetColor(GAL_LAYER_ID.LAYER_DRAWINGSHEET),
    );
  });

  it('reads override_item_colors from the theme', () => {
    const s = new SCH_RENDER_SETTINGS();
    CLASSIC_THEME!.SetOverrideSchItemColors(true);
    s.LoadColors(CLASSIC_THEME!);
    expect(s.m_OverrideItemColors).toBe(true);
    CLASSIC_THEME!.SetOverrideSchItemColors(false);
  });

  it('answers white for a layer it has no colour for', () => {
    const s = new SCH_RENDER_SETTINGS();
    expect(s.GetColor(null, SCH_LAYER_ID.LAYER_WIRE)).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(s.GetBackgroundColor()).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('calls a background dark below half brightness', () => {
    const s = new SCH_RENDER_SETTINGS();
    expect(s.IsBackgroundDark()).toBe(false); // no background colour yet
    s.LoadColors(DEFAULT_THEME!);
    expect(s.IsBackgroundDark()).toBe(false);
    s.SetBackgroundColor({ r: 0.2, g: 0.2, b: 0.2, a: 1 });
    expect(s.IsBackgroundDark()).toBe(true);
    s.SetBackgroundColor({ r: 0.5, g: 0.5, b: 0.5, a: 1 }); // 0.5 * 1.003: not below
    expect(s.IsBackgroundDark()).toBe(false);
  });

  it('inserts a transparent black grid colour when there is none (std::map::operator[])', () => {
    const s = new SCH_RENDER_SETTINGS();
    expect(s.GetGridColor()).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(s.GetCursorColor()).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(s.GetColor(null, SCH_LAYER_ID.LAYER_SCHEMATIC_GRID)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('shows the page limits by eeschema.json, never when printing', () => {
    const s = new SCH_RENDER_SETTINGS();
    expect(s.GetShowPageLimits()).toBe(true);
    s.SetIsPrinting(true);
    expect(s.GetShowPageLimits()).toBe(false);
    s.SetIsPrinting(false);
    setEeschemaSettingsProvider(() => ({
      ...EESCHEMA_DEFAULTS,
      appearance: { ...EESCHEMA_DEFAULTS.appearance, show_page_limits: false },
    }));
    expect(s.GetShowPageLimits()).toBe(false);
  });

  it('transforms through m_Transform', () => {
    const s = new SCH_RENDER_SETTINGS();
    s.m_Transform = new TRANSFORM(0, 1, -1, 0);
    expect(s.TransformCoordinate({ x: 10, y: 3 })).toEqual({ x: 3, y: -10 });
  });

  it('is what a dynamic_cast to SCH_RENDER_SETTINGS finds', () => {
    const s = new SCH_RENDER_SETTINGS();
    expect(asSchRenderSettings(s)).toBe(s);
    expect(asSchRenderSettings(null)).toBe(null);
  });
});
