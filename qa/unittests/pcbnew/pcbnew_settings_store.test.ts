// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `Kiface().KifaceSettings()` for pcbnew: ONE PCBNEW_SETTINGS object, loaded
 * from the `pcbnew.json` slice (`JSON_SETTINGS::Load`) and stored back into it
 * (`JSON_SETTINGS::Store`) - so what a tool writes into `config()` is what the
 * next reader sees, and what the next session opens on.
 */
import { describe, expect, it } from 'vitest';
import { LeaderMode as LEADER_MODE } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { ARC_EDIT_MODE } from '@ziroeda/common/frame_type.js';
import { CROSS_HAIR_MODE } from '@ziroeda/common/gal/gal_display_options.js';
import { EDA_UNITS_INT } from '@ziroeda/common/settings/app_settings.js';
import { EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { FLIP_DIRECTION } from '@ziroeda/core/mirror.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { installPgm } from '@ziroeda/designer/src/editors/pcb/pcb_canvas.js';
import { PCBNEW_DEFAULTS, deepMerge } from '@ziroeda/designer/src/prefs/settings.js';
import {
  loadPcbnewSettings,
  pcbnewSettingsOf,
  storePcbnewSettings,
} from '@ziroeda/pcbnew/pcb_edit_frame.js';
import type { PCBNEW_SETTINGS } from '@ziroeda/pcbnew/pcbnew_settings.js';

const fresh = (): typeof PCBNEW_DEFAULTS => structuredClone(PCBNEW_DEFAULTS);

describe('PCBNEW_SETTINGS load / store over the pcbnew.json slice', () => {
  it('a slice loaded and stored back again is unchanged', () => {
    const json = fresh();
    const cfg = pcbnewSettingsOf(json);
    expect(storePcbnewSettings(cfg, json)).toBe(false);
    expect(json).toEqual(PCBNEW_DEFAULTS);
  });

  it('what a tool writes into the object reaches the slice', () => {
    const json = fresh();
    const cfg = pcbnewSettingsOf(json);
    cfg.m_AngleSnapMode = LEADER_MODE.DEG90;
    cfg.m_ArcEditMode = ARC_EDIT_MODE.KEEP_CENTER_ENDS_ADJUST_ANGLE;
    cfg.m_Display.m_DisplayRatsnestLinesCurved = !json.pcb_display.ratsnest_curved;
    cfg.m_PolarCoords = !json.editing.polar_coords;
    cfg.m_RotationAngle = new EDA_ANGLE(45);
    cfg.m_FlipDirection = json.editing.flip_left_right
      ? FLIP_DIRECTION.TOP_BOTTOM
      : FLIP_DIRECTION.LEFT_RIGHT;
    cfg.m_CrossProbing.zoom_to_fit = !json.cross_probing.zoom_to_fit;

    expect(storePcbnewSettings(cfg, json)).toBe(true);

    const reread = pcbnewSettingsOf(json);
    expect(reread.m_AngleSnapMode).toBe(LEADER_MODE.DEG90);
    expect(reread.m_ArcEditMode).toBe(ARC_EDIT_MODE.KEEP_CENTER_ENDS_ADJUST_ANGLE);
    expect(reread.m_Display.m_DisplayRatsnestLinesCurved).toBe(
      cfg.m_Display.m_DisplayRatsnestLinesCurved,
    );
    expect(reread.m_PolarCoords).toBe(cfg.m_PolarCoords);
    expect(reread.m_RotationAngle.AsDegrees()).toBe(45);
    expect(reread.m_FlipDirection).toBe(cfg.m_FlipDirection);
    expect(reread.m_CrossProbing.zoom_to_fit).toBe(cfg.m_CrossProbing.zoom_to_fit);
    // A second store has nothing left to write.
    expect(storePcbnewSettings(cfg, json)).toBe(false);
  });

  it('a change to any one PARAM alone is reported, so the store is written', () => {
    const edits: ((c: PCBNEW_SETTINGS) => void)[] = [
      (c) => {
        c.m_PolarCoords = !c.m_PolarCoords;
      },
      (c) => {
        c.m_AngleSnapMode = LEADER_MODE.DEG45;
      },
      (c) => {
        c.m_ArcEditMode = ARC_EDIT_MODE.KEEP_ENDPOINTS_OR_START_DIRECTION;
      },
      (c) => {
        c.m_Display.m_DisplayRatsnestLinesCurved = !c.m_Display.m_DisplayRatsnestLinesCurved;
      },
      (c) => {
        c.m_ViewersDisplay.m_DisplayPadNumbers = !c.m_ViewersDisplay.m_DisplayPadNumbers;
      },
      (c) => {
        c.m_MagneticItems.pads = (c.m_MagneticItems.pads + 1) % 3;
      },
      (c) => {
        c.m_ESCClearsNetHighlight = !c.m_ESCClearsNetHighlight;
      },
      (c) => {
        c.m_System.units = EDA_UNITS_INT.MILS; // the default is MM
      },
      (c) => {
        c.m_System.last_metric_units = EDA_UNITS_INT.UM;
      },
      (c) => {
        c.m_System.last_imperial_units = EDA_UNITS_INT.INCH;
      },
      (c) => {
        c.m_Window.grid.last_size_idx += 1;
      },
      (c) => {
        c.m_Window.grid.fast_grid_1 += 1;
      },
      (c) => {
        c.m_Window.grid.fast_grid_2 += 1;
      },
      (c) => {
        c.m_Window.grid.show = !c.m_Window.grid.show;
      },
      (c) => {
        c.m_Window.grid.overrides_enabled = !c.m_Window.grid.overrides_enabled;
      },
      (c) => {
        c.m_Window.cursor.cross_hair_mode = CROSS_HAIR_MODE.FULLSCREEN_DIAGONAL;
      },
      (c) => {
        c.m_Window.cursor.always_show_cursor = !c.m_Window.cursor.always_show_cursor;
      },
      (c) => {
        c.m_AuiPanels.show_search = !c.m_AuiPanels.show_search;
      },
      (c) => {
        c.m_AuiPanels.show_net_inspector = !c.m_AuiPanels.show_net_inspector;
      },
      (c) => {
        c.m_ViewersDisplay.m_DisplayGraphicsFill = false;
      },
      (c) => {
        c.m_ViewersDisplay.m_DisplayTextFill = false;
      },
      (c) => {
        c.m_ViewersDisplay.m_DisplayPadFill = false;
      },
      (c) => {
        c.m_Display.m_DisplayPcbTrackFill = false;
      },
      (c) => {
        c.m_Display.m_DisplayViaFill = false;
      },
    ];

    for (const edit of edits) {
      const json = fresh();
      const cfg = pcbnewSettingsOf(json);
      edit(cfg);
      expect(storePcbnewSettings(cfg, json), edit.toString()).toBe(true);
    }
  });

  it("loads APP_SETTINGS_BASE's units, grid, cursor and panes from the slice", () => {
    const json = fresh();
    json.system.units = 'mils';
    json.system.last_metric_units = 'mm';
    json.system.last_imperial_units = 'in';
    json.window.grid.sizes = [{ name: 'Fine', x: '0.01 mm', y: '0.02 mm' }];
    json.window.grid.last_size_idx = 0;
    json.window.grid.fast_grid_1 = 3;
    json.window.grid.fast_grid_2 = 4;
    json.window.grid.style = 'crosses';
    json.window.grid.line_width = 2.5;
    json.window.grid.min_spacing = 17;
    json.window.grid.snap = 2;
    json.window.grid.show = false;
    json.window.grid.overrides_enabled = true;
    json.window.cursor.crosshair = 'full';
    json.window.cursor.always_show_cursor = false;
    json.aui.show_search = true;
    json.aui.show_net_inspector = true;

    const cfg = pcbnewSettingsOf(json);

    expect(cfg.m_System.units).toBe(EDA_UNITS_INT.MILS);
    expect(cfg.m_System.last_metric_units).toBe(EDA_UNITS_INT.MM);
    expect(cfg.m_System.last_imperial_units).toBe(EDA_UNITS_INT.INCH);
    const g = cfg.m_Window.grid;
    expect(g.grids.map((e) => [e.name, e.x, e.y])).toEqual([['Fine', '0.01 mm', '0.02 mm']]);
    expect([g.last_size_idx, g.fast_grid_1, g.fast_grid_2]).toEqual([0, 3, 4]);
    expect([g.style, g.line_width, g.min_spacing, g.snap]).toEqual([2, 2.5, 17, 2]);
    expect([g.show, g.overrides_enabled]).toEqual([false, true]);
    expect(cfg.m_Window.cursor.cross_hair_mode).toBe(CROSS_HAIR_MODE.FULLSCREEN_CROSS);
    expect(cfg.m_Window.cursor.always_show_cursor).toBe(false);
    expect([cfg.m_AuiPanels.show_search, cfg.m_AuiPanels.show_net_inspector]).toEqual([true, true]);
  });

  it('loads the fills; graphics_fill, read second, wins over graphic_items_fill', () => {
    const json = fresh();
    json.pcb_display.graphic_items_fill = true;
    json.pcb_display.graphics_fill = false;
    json.pcb_display.text_fill = false;
    json.pcb_display.pad_fill = false;
    json.pcb_display.track_fill = false;
    json.pcb_display.via_fill = false;

    const cfg = pcbnewSettingsOf(json);

    expect(cfg.m_ViewersDisplay.m_DisplayGraphicsFill).toBe(false);
    expect(cfg.m_ViewersDisplay.m_DisplayTextFill).toBe(false);
    expect(cfg.m_ViewersDisplay.m_DisplayPadFill).toBe(false);
    expect(cfg.m_Display.m_DisplayPcbTrackFill).toBe(false);
    expect(cfg.m_Display.m_DisplayViaFill).toBe(false);

    // Save writes the one value under both keys, each from the other value.
    cfg.m_ViewersDisplay.m_DisplayGraphicsFill = true;
    json.pcb_display.graphic_items_fill = false;
    storePcbnewSettings(cfg, json);
    expect([json.pcb_display.graphic_items_fill, json.pcb_display.graphics_fill]).toEqual([
      true,
      true,
    ]);
  });

  it('loading fills the object it is given, so every holder sees the change', () => {
    const cfg = pcbnewSettingsOf(fresh());
    const json = deepMerge(PCBNEW_DEFAULTS, {
      editing: { pcb_angle_snap_mode: LEADER_MODE.DEG45 },
    }) as typeof PCBNEW_DEFAULTS;
    expect(loadPcbnewSettings(cfg, json)).toBe(cfg);
    expect(cfg.m_AngleSnapMode).toBe(LEADER_MODE.DEG45);
  });

  it('installPgm keeps one registered object and reloads it in place', () => {
    installPgm();
    const first = PgmOrNull()!.GetSettingsManager().GetAppSettings<PCBNEW_SETTINGS>('pcbnew');
    installPgm();
    const second = PgmOrNull()!.GetSettingsManager().GetAppSettings<PCBNEW_SETTINGS>('pcbnew');
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });
});
