// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDIT_FRAME::LoadSettings` (eeschema_config.cpp:263) and the `EDA_DRAW_FRAME::LoadSettings`
 * half it chains to (eda_draw_frame.cpp:874-882), which the schematic canvas runs once it exists.
 *
 * SCH_RENDER_SETTINGS' constructor shows pin electrical types; the schematic editor turns them
 * (and forced pin numbers) off here, which is why KiCad's schematic never shows "Passive" beside
 * a pin. And the antialiasing mode is COMMON_SETTINGS' `graphics.antialiasing_mode`, default 2,
 * read into the frame's GAL options - without it the schematic drew with antialiasing off.
 */
import type { COMMON_SETTINGS_LIKE } from '@ziroeda/common/pgm_base.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { GAL_ANTIALIASING_MODE } from '@ziroeda/common/gal/gal_display_options.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { afterEach, describe, expect, it } from 'vitest';
import { schFrame, schToolHarness } from './support/sch_tool_harness.js';

afterEach(() => SetPgm(null));

function common(aMode: number): COMMON_SETTINGS_LIKE {
  return {
    m_Appearance: { canvas_scale: 0 },
    m_Graphics: { aa_mode: aMode },
  } as unknown as COMMON_SETTINGS_LIKE;
}

describe('SCH_EDIT_FRAME::LoadSettings', () => {
  it('turns off the pin electrical types and forced pin numbers the render settings start with', () => {
    SetPgm(new PGM_BASE(common(2), new SETTINGS_MANAGER()));
    const h = schToolHarness(schFrame());
    const rs = h.frame.GetRenderSettings()!;
    rs.m_ShowPinNumbers = true;
    expect(rs.m_ShowPinsElectricalType).toBe(true);

    h.frame.LoadSettings(h.frame.config()!);

    expect([rs.m_ShowPinsElectricalType, rs.m_ShowPinNumbers]).toEqual([false, false]);
  });

  it('takes the alternate-pin icons from the appearance settings', () => {
    SetPgm(new PGM_BASE(common(2), new SETTINGS_MANAGER()));
    const h = schToolHarness(schFrame());
    const cfg = h.frame.config()!;

    h.frame.LoadSettings(cfg);

    expect(h.frame.GetRenderSettings()!.m_ShowPinAltIcons).toBe(
      h.frame.eeconfig()!.appearance.show_pin_alt_icons,
    );
  });

  it('reads the antialiasing mode from COMMON_SETTINGS into the GAL options', () => {
    for (const mode of [GAL_ANTIALIASING_MODE.AA_HIGHQUALITY, GAL_ANTIALIASING_MODE.AA_FAST]) {
      SetPgm(new PGM_BASE(common(mode), new SETTINGS_MANAGER()));
      const h = schToolHarness(schFrame());

      h.frame.LoadSettings(h.frame.config()!);

      expect(h.frame.GetGalDisplayOptions().antialiasing_mode).toBe(mode);
    }
  });

  it('forces the grid axes off', () => {
    SetPgm(new PGM_BASE(common(2), new SETTINGS_MANAGER()));
    const h = schToolHarness(schFrame());
    const cfg = h.frame.config()!;
    cfg.m_Window.grid.axes_enabled = true;

    h.frame.LoadSettings(cfg);

    expect(h.frame.GetGalDisplayOptions().m_axesEnabled).toBe(false);
  });

  /**
   * The frame's units, which the toolbar's units group and every dialog's UNIT_BINDER read:
   * system.units' default is one branch of APP_SETTINGS_BASE (app_settings.cpp:228-238) and
   * eeschema (filename "eeschema", eeschema_settings.cpp:177) is on its imperial side - mils.
   */
  it('opens in mils, the units the toolbar and the dialogs both read', () => {
    SetPgm(new PGM_BASE(common(2), new SETTINGS_MANAGER()));
    const h = schToolHarness(schFrame());

    h.frame.LoadSettings(h.frame.config()!);

    expect(h.frame.GetUserUnits()).toBe('mils');
  });

  it('switches its units through COMMON_TOOLS, and Ctrl+U returns to the last imperial unit', () => {
    SetPgm(new PGM_BASE(common(2), new SETTINGS_MANAGER()));
    const h = schToolHarness(schFrame());
    const mgr = h.frame.GetToolManager()!;
    h.frame.LoadSettings(h.frame.config()!);

    mgr.RunAction(ACTIONS.millimetersUnits);
    expect(h.frame.GetUserUnits()).toBe('mm');
    mgr.RunAction(ACTIONS.inchesUnits);
    expect(h.frame.GetUserUnits()).toBe('in');
    mgr.RunAction(ACTIONS.toggleUnits);
    expect(h.frame.GetUserUnits()).toBe('mm');
    mgr.RunAction(ACTIONS.toggleUnits);
    expect(h.frame.GetUserUnits()).toBe('in');
  });
});
